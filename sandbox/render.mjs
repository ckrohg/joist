#!/usr/bin/env node
/**
 * @purpose Canonical LOCAL Elementor render primitive. Given an Elementor element
 * tree (JSON), create/update a page on the local Docker WordPress+Elementor sandbox,
 * force edit_mode=builder + canvas template, regenerate Elementor CSS, and return the
 * localhost URL + a screenshot. NO shared-host dependency — this is the entire point:
 * local Elementor = independence from the fragile shared host (georges232.sg-host.com).
 *
 * The write path is DIRECT POSTMETA via wp-cli inside the running `wpcli-1` container
 * (the self-contained fallback the task mandates): it needs no app-password, no Joist
 * REST hash-handshake, and no running plugin — only Elementor itself. Elementor's own
 * `wp elementor flush_css` regenerates the per-page CSS so the front end renders styled
 * (proven: heading color/size + button bg/radius/padding all computed correctly).
 *
 * Usage (library):
 *   import { render } from './render.mjs';
 *   const { url, screenshot, pageId } = await render(tree, { slug: 'my-page', shot: '/tmp/x.png' });
 *
 * Usage (CLI):
 *   node render.mjs --tree path/to/tree.json [--slug joist-render] [--page <id>]
 *                   [--shot /tmp/out.png] [--width 1200] [--no-shot]
 *   node render.mjs --tree -            # read tree JSON from stdin
 *
 * `tree` is the Elementor `_elementor_data` array (top-level = array of containers/sections).
 * A single root node (object) is accepted and wrapped in an array. Element `id`s are
 * stamped automatically when absent (ensureIds) — REQUIRED on the postmeta path so
 * Elementor's per-element CSS scoping does not collapse (clerk-hero loop finding).
 *
 * Returns: { pageId, url, screenshot, styled } where `styled` is the computed-style probe
 * (null if --no-shot). Throws on any container/wp-cli failure (fail-loud).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync as _rf } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAllowedBase, withRenderLock } from './host-guard.mjs'; // §0 SAFETY GUARD + render throttle

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Ensure every node carries a stable 7-char Elementor element `id` (mutates a copy).
 *
 * WHY THIS IS LOAD-BEARING (clerk-hero closed-loop finding, 2026-06-12):
 * Elementor's CSS generator scopes each widget's per-element rules to a
 * `.elementor-element-{id}` selector. On the DIRECT-POSTMETA write path we do NOT
 * run Document::save(), so nothing assigns ids. With an id-less tree, `flush_css`
 * emits BARE, un-scoped rules (e.g. plain `.elementor-button{...}`) and the LAST
 * one written wins for ALL same-type widgets via the cascade — so e.g. a purple
 * primary button silently collapses to a later ghost button's white, and per-
 * container `flex-direction:column` survives on only one container (the rest fall
 * back to Elementor's row default → layout breaks). Stamping ids here restores
 * correct per-element scoping. The Joist REST PUT path gets ids for free from
 * Document::save(); the raw-postmeta primitive must stamp them itself.
 */
export function ensureIds(tree) {
  const rid = () => randomBytes(4).toString('hex').slice(0, 7);
  const walk = (nodes) => nodes.map((n) => {
    const out = { ...n, id: n.id || rid() };
    if (Array.isArray(n.elements) && n.elements.length) out.elements = walk(n.elements);
    return out;
  });
  return walk(Array.isArray(tree) ? tree : [tree]);
}

// --- Sandbox topology (matches docker-compose.yml) ---------------------------
export const PORT = Number(process.env.JOIST_LOCAL_PORT || 8001);
// §0 SAFETY GUARD: guard the BASE at module load so a JOIST_LOCAL_BASE override can never stray
// onto a remote/paused host (localhost:8001 always passes; the local path is unaffected).
export const BASE = assertAllowedBase(process.env.JOIST_LOCAL_BASE || `http://localhost:${PORT}`);
const COMPOSE_DIR = __dirname;                       // sandbox/ holds docker-compose.yml
const CLI_SERVICE = process.env.JOIST_CLI_SERVICE || 'wpcli-1';
// Playwright lives in the grader's node_modules; reuse the proven install.
const GRADER_DIR = join(__dirname, '..', 'eval', 'grader');

function compose(args, opts = {}) {
  return execFileSync('docker', ['compose', ...args], {
    cwd: COMPOSE_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    timeout: opts.timeout || 100000, ...opts,
  });
}

/**
 * IMAGE-UPLOAD PRE-PASS (fusion-CONVERGENT path A, 2026-06-20). The transpiler emits image URLs as LOCAL
 * `file://…/assets/<hash>-image.jpg` paths (the downloaded originals) — which the browser/WP cannot load, so every
 * cloned image rendered BLANK. Make them paint by importing each asset into WP media via `wp media import` INSIDE the
 * container (app-password-free — same wp-cli mechanism as the postmeta writer; no REST, no Joist plugin) and swapping
 * each file:// URL for the real WP-media URL BEFORE the tree is written.
 *
 * IDEMPOTENT (the load-bearing safety property — host-overload incident): a naïve pass re-imports all images every
 * render, bloating the media library and triggering full thumbnail regen each time (the SiteGround-tanking class of
 * load). The pendingFiles are content-hash-named, so we dedup on `post_name=joist-<hash>`: an attachment with that
 * name already in the library is REUSED (no re-import, no regen); only genuinely-new assets import. Import-once,
 * reuse-forever across iterations.
 *
 * Walks the tree for any string value that is a `file://` URL (image widget settings.image.url, container
 * background_image.url, …), collects the unique local files, imports them in ONE container invocation (the assets dir
 * mounted at /assets), and returns a NEW tree with every file:// swapped to its WP-media URL. Files outside a single
 * common assets dir, or missing on disk, are left untouched (logged). No-op when the tree has no file:// URLs.
 */
export function uploadAndSwapMedia(tree) {
  const files = new Set();
  const collect = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(collect); return; }
    for (const [k, v] of Object.entries(n)) {
      if (typeof v === 'string' && v.startsWith('file://')) { try { files.add(fileURLToPath(v)); } catch { /* skip */ } }
      else if (v && typeof v === 'object') collect(v);
    }
  };
  collect(tree);
  const onDisk = [...files].filter((f) => existsSync(f));
  if (!onDisk.length) return { tree, imported: 0, reused: 0, map: {} };
  // group by directory; mount each unique dir and import its files in one container script per dir.
  const byDir = new Map();
  for (const f of onDisk) { const d = dirname(f); if (!byDir.has(d)) byDir.set(d, []); byDir.get(d).push(basename(f)); }
  const urlByFile = {}; let imported = 0, reused = 0;
  for (const [dir, names] of byDir) {
    // one script: for each basename, dedup on post_name=joist-<sanitized>; reuse URL on hit, else import + name it.
    // NO `set -e`: wp-cli subcommands legitimately exit non-zero (e.g. an empty `wp post list`), which under set -e
    // would abort the whole loop and import nothing. Each step is independently guarded instead.
    const script = `
for F in ${names.map((n) => `'${n.replace(/'/g, '')}'`).join(' ')}; do
  SLUG="joist-$(printf '%s' "$F" | tr -c 'a-zA-Z0-9' '-' | tr 'A-Z' 'a-z')"
  EXIST=$(wp post list --post_type=attachment --name="$SLUG" --field=ID 2>/dev/null | head -1)
  if [ -n "$EXIST" ]; then
    URL=$(wp eval "echo wp_get_attachment_url($EXIST);" 2>/dev/null)
    echo "REUSE|$F|$URL"
  else
    ID=$(wp media import "/assets/$F" --porcelain 2>/dev/null | tail -1)
    if [ -n "$ID" ]; then
      wp post update "$ID" --post_name="$SLUG" >/dev/null 2>&1 || true
      URL=$(wp eval "echo wp_get_attachment_url($ID);" 2>/dev/null)
      echo "IMPORT|$F|$URL"
    else
      echo "FAIL|$F|"
    fi
  fi
done
`;
    let out = '';
    try {
      out = compose(['run', '--rm', '-T', '-v', `${dir}:/assets:ro`, CLI_SERVICE, '-c', script], { timeout: 180000 });
    } catch (e) { console.error(`uploadAndSwapMedia: import failed for ${dir}: ${String(e.message || e).slice(0, 160)}`); continue; }
    for (const line of out.split('\n')) {
      const m = line.match(/^(REUSE|IMPORT)\|(.+?)\|(https?:\/\/\S+)$/);
      if (!m) continue;
      if (m[1] === 'IMPORT') imported++; else reused++;
      urlByFile[join(dir, m[2])] = m[3];
    }
  }
  // swap every file:// occurrence whose path resolved to a URL.
  const swap = (n) => {
    if (!n || typeof n !== 'object') return n;
    if (Array.isArray(n)) return n.map(swap);
    const out = {};
    for (const [k, v] of Object.entries(n)) {
      if (typeof v === 'string' && v.startsWith('file://')) { let p; try { p = fileURLToPath(v); } catch { p = null; } out[k] = (p && urlByFile[p]) ? urlByFile[p] : v; }
      else if (v && typeof v === 'object') out[k] = swap(v);
      else out[k] = v;
    }
    return out;
  };
  return { tree: swap(tree), imported, reused, map: urlByFile };
}

/**
 * Inject an Elementor tree into a local page via direct postmeta + flush CSS.
 * @returns {{pageId:number, url:string}}
 */
export function injectTree(tree, { slug = 'joist-render', page = null, title = 'Joist Render' } = {}) {
  // IMAGE-UPLOAD PRE-PASS: import any local file:// asset into WP media (idempotent) and swap to WP-media URLs so
  // cloned images actually paint. Reversible: JOIST_NO_MEDIA_UPLOAD=1 → keep file:// (old blank-image behavior).
  let inTree = tree;
  if (!process.env.JOIST_NO_MEDIA_UPLOAD) {
    const r = uploadAndSwapMedia(tree);
    inTree = r.tree;
    if (r.imported || r.reused) console.error(`[media] ${r.imported} imported, ${r.reused} reused → ${Object.keys(r.map).length} asset URLs swapped`);
  }
  // Stamp element ids BEFORE write — without them Elementor's CSS scoping collapses
  // (see ensureIds). This is the canonical correctness fix for the raw-postmeta path.
  const arr = ensureIds(inTree);
  // hand the JSON to the container as a mounted file (command-arg JSON is fragile w/ quotes/unicode)
  const work = mkdtempSync(join(tmpdir(), 'joist-render-'));
  const localFile = join(work, 'tree.json');
  writeFileSync(localFile, JSON.stringify(arr));
  // eval-file helper: read the mounted JSON from disk and store it verbatim as
  // _elementor_data (avoids ARG_MAX on large full-page trees; preserves Elementor's
  // expected slashed-JSON storage shape since we hand WP the raw string unmodified).
  const metaFile = join(work, 'update-meta.php');
  writeFileSync(metaFile, `<?php
$id = (int) $args[0];
$json = file_get_contents('/tree.json');
update_post_meta($id, '_elementor_data', wp_slash($json));
`);
  try {
    const script = `
set -e
SLUG='${slug.replace(/'/g, "")}'
PAGE='${page ? String(Number(page)) : ''}'
if [ -n "$PAGE" ]; then
  ID="$PAGE"
  wp post get "$ID" --field=ID >/dev/null 2>&1 || ID=$(wp post create --post_type=page --post_status=publish --post_title="${title.replace(/'/g, '')}" --import-id="$PAGE" --porcelain)
else
  ID=$(wp post list --post_type=page --name="$SLUG" --field=ID 2>/dev/null | head -1)
  [ -z "$ID" ] && ID=$(wp post create --post_type=page --post_status=publish --post_title="${title.replace(/'/g, '')}" --post_name="$SLUG" --porcelain)
fi
# Write _elementor_data from the MOUNTED FILE via eval-file, never as an argv —
# a full-page tree (100s of KB) blows past ARG_MAX with "$(cat …)" inlining.
# Elementor stores _elementor_data as the RAW JSON string (slashed), so we set it
# verbatim from the file rather than decode→re-encode (which would alter escaping).
wp eval-file /update-meta.php "$ID" >/dev/null
wp post meta update "$ID" _elementor_edit_mode builder >/dev/null
wp post meta update "$ID" _wp_page_template elementor_canvas >/dev/null
wp post meta update "$ID" _elementor_template_type wp-page >/dev/null
wp post meta update "$ID" _elementor_version "$(wp plugin get elementor --field=version)" >/dev/null
# Elementor 3.28 ships Element Caching ON by default: a render of cached element
# markup is stored in _elementor_element_cache and served to the front end IN PLACE
# of re-rendering _elementor_data. On the raw-postmeta write path we mutate
# _elementor_data directly, so a stale element cache would pin the OLD markup and our
# edit would never reach the front end (no Document::save() to invalidate it). Delete
# the cache postmeta on every write so the next front-end hit re-renders from the new
# tree. Harmless on <3.28 (meta simply absent).
wp post meta delete "$ID" _elementor_element_cache >/dev/null 2>&1 || true
# Elementor's OWN css regen — the front end renders styled only after this.
wp elementor flush_css >/dev/null 2>&1 || true
echo "RENDER_PAGE_ID=$ID"
`;
    const out = compose(
      ['run', '--rm', '-T',
        '-v', `${localFile}:/tree.json:ro`,
        '-v', `${metaFile}:/update-meta.php:ro`,
        CLI_SERVICE, '-c', script],
    );
    const m = out.match(/RENDER_PAGE_ID=(\d+)/);
    if (!m) throw new Error(`injectTree: no page id in wp-cli output:\n${out}`);
    const pageId = Number(m[1]);
    return { pageId, url: `${BASE}/?page_id=${pageId}` };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Screenshot a rendered URL + probe whether the widgets rendered styled.
 * Spawns the screenshot script from GRADER_DIR so `playwright` resolves.
 * @returns {{screenshot:string, styled:object}}
 */
export function snapshot(url, { shot = join(tmpdir(), 'joist-render.png'), width = 1200 } = {}) {
  // _render-shot.mjs lives in GRADER_DIR so Node resolves the shared `playwright` install.
  const out = execFileSync('node', [join(GRADER_DIR, '_render-shot.mjs'), url, shot, String(width)], {
    cwd: GRADER_DIR, encoding: 'utf8', timeout: 90000,
  });
  let styled = null;
  try { styled = JSON.parse(out); } catch { /* probe is best-effort */ }
  return { screenshot: shot, styled };
}

/**
 * Full primitive: inject tree → render → screenshot.
 * @param {object|Array} tree   Elementor _elementor_data (array, or single node).
 * @param {object} opts         { slug, page, title, shot, width, noShot }
 * @returns {Promise<{pageId:number, url:string, screenshot:string|null, styled:object|null}>}
 */
export async function render(tree, opts = {}) {
  // THROTTLE: the dominant host-overload cost is per-render Elementor CSS regeneration
  // (injectTree runs `wp elementor flush_css`). With JOIST_RENDER_SERIAL=1, withRenderLock
  // serializes concurrent renders so N parallel callers don't stampede one WP host's CSS regen.
  // Default (unset): runs immediately, byte-identical to before.
  const { pageId, url } = await withRenderLock(() => injectTree(tree, opts));
  if (opts.noShot) return { pageId, url, screenshot: null, styled: null };
  const { screenshot, styled } = snapshot(url, opts);
  return { pageId, url, screenshot, styled };
}

// --- CLI ---------------------------------------------------------------------
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--no-shot') a.noShot = true;
    else if (k.startsWith('--')) a[k.slice(2)] = argv[++i];
  }
  return a;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const a = parseArgs(process.argv.slice(2));
    if (!a.tree) {
      console.error('usage: node render.mjs --tree <file|-> [--slug s] [--page id] [--shot out.png] [--width 1200] [--no-shot]');
      process.exit(2);
    }
    const { readFileSync } = await import('node:fs');
    const raw = a.tree === '-' ? readFileSync(0, 'utf8') : readFileSync(a.tree, 'utf8');
    const tree = JSON.parse(raw);
    const res = await render(tree, {
      slug: a.slug || 'joist-render', page: a.page, title: a.title || 'Joist Render',
      shot: a.shot, width: a.width ? Number(a.width) : undefined, noShot: a.noShot,
    });
    console.log(JSON.stringify(res, null, 2));
  })().catch((e) => { console.error('render.mjs FAILED:', e.message); process.exit(1); });
}
