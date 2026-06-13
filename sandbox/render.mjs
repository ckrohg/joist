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
 * A single root node (object) is accepted and wrapped in an array.
 *
 * Returns: { pageId, url, screenshot, styled } where `styled` is the computed-style probe
 * (null if --no-shot). Throws on any container/wp-cli failure (fail-loud).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Sandbox topology (matches docker-compose.yml) ---------------------------
export const PORT = Number(process.env.JOIST_LOCAL_PORT || 8001);
export const BASE = process.env.JOIST_LOCAL_BASE || `http://localhost:${PORT}`;
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
 * Inject an Elementor tree into a local page via direct postmeta + flush CSS.
 * @returns {{pageId:number, url:string}}
 */
export function injectTree(tree, { slug = 'joist-render', page = null, title = 'Joist Render' } = {}) {
  const arr = Array.isArray(tree) ? tree : [tree];
  // hand the JSON to the container as a mounted file (command-arg JSON is fragile w/ quotes/unicode)
  const work = mkdtempSync(join(tmpdir(), 'joist-render-'));
  const localFile = join(work, 'tree.json');
  writeFileSync(localFile, JSON.stringify(arr));
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
wp post meta update "$ID" _elementor_data "$(cat /tree.json)" --format=json >/dev/null 2>&1 \
  || wp post meta update "$ID" _elementor_data "$(cat /tree.json)" >/dev/null
wp post meta update "$ID" _elementor_edit_mode builder >/dev/null
wp post meta update "$ID" _wp_page_template elementor_canvas >/dev/null
wp post meta update "$ID" _elementor_template_type wp-page >/dev/null
wp post meta update "$ID" _elementor_version "$(wp plugin get elementor --field=version)" >/dev/null
# Elementor's OWN css regen — the front end renders styled only after this.
wp elementor flush_css >/dev/null 2>&1 || true
echo "RENDER_PAGE_ID=$ID"
`;
    const out = compose(
      ['run', '--rm', '-T', '-v', `${localFile}:/tree.json:ro`, CLI_SERVICE, '-c', script],
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
  const { pageId, url } = injectTree(tree, opts);
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
