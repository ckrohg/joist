#!/usr/bin/env node
/**
 * @purpose Reproducible driver: clerk full-page HTML → one Elementor tree → LOCAL Docker
 * render (page 83). Fixes the two located full-page fidelity bugs:
 *
 *  (A) IMAGERY rendered as placeholder boxes. Root cause: image widgets pointed at bare
 *      static URLs with no WP attachment id, so Elementor's image_size:custom couldn't size
 *      them and far-down lazy images collapsed to height:0 and never decoded. Fix: import the
 *      42 captured assets as REAL WP media attachments (upload-assets-local.mjs → ids + dims),
 *      feed the transpiler a manifest carrying {url,id}; the imageWidget fix in transpile-html
 *      then emits image_size:custom + image_custom_dimension from the captured box.
 *
 *  (B) SECTION ORDER inverted — the "Clerk raises $50m" announcement bar rendered BELOW the
 *      nav (source has it ABOVE). Root cause: splitSiteParts() detached <header> into a site
 *      part and the ad-hoc full-page recompose prepended it at the very top, above the
 *      announcement bar that legitimately precedes <header> in source DOM order. Fix: for a
 *      single full-page render we DON'T split site parts (siteParts:false) — the header stays
 *      inline at its true DOM position, so announcement-above-nav holds by construction.
 *
 * Keeps the load-bearing pieces from prior rounds: id-stamping (render.mjs ensureIds) and the
 * Suisse webfont mu-plugin. NO shared host — local Docker sandbox only.
 *
 * Usage: node render-clerk-fullpage.mjs [--page 83] [--no-upload]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadAssetsLocal } from './upload-assets-local.mjs';
import { render } from './render.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const SNAP = join(__dirname, 'snapshots', 'clerk-fullpage');
const HTML = join(REPO, 'eval', 'grader', 'local-fidelity', 'clerk.html');
const CAP_MANIFEST = join(SNAP, 'assets-manifest.json');

function parseArgs(argv) {
  const a = { page: '83' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--no-upload') a.noUpload = true;
    else if (argv[i] === '--page') a.page = argv[++i];
    else if (argv[i] === '--width') a.width = Number(argv[++i]);
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const width = a.width || 1440;

  // 1. Import the 42 captured assets into WP media (ids + dims). Idempotent (re-uses by _joist_src).
  const uploadedPath = '/tmp/clerk-uploaded-manifest.json';
  let uploaded;
  if (a.noUpload && existsSync(uploadedPath)) {
    uploaded = JSON.parse(readFileSync(uploadedPath, 'utf8'));
    console.log(`[assets] reusing ${uploaded.length} pre-imported attachments`);
  } else {
    console.log('[assets] importing captured assets into WP media…');
    uploaded = uploadAssetsLocal(CAP_MANIFEST, uploadedPath);
    console.log(`[assets] imported ${uploaded.length} attachments (ids ${uploaded[0].id}…${uploaded[uploaded.length - 1].id})`);
  }
  // Enriched manifest: src → {url,id,width,height}. loadManifest accepts the object form.
  // width/height are the REAL attachment dims (from WP media meta) — the transpiler uses them to
  // derive each image widget's box height from the asset's true aspect ratio. Without this, a
  // bento card image whose <img> hadn't decoded at capture time reports a collapsed rect height
  // (~18px alt-line) → image_custom_dimension:{h:18} → Elementor crops an 18px sliver (empty card).
  const enriched = {};
  for (const r of uploaded) enriched[r.src] = { url: r.url, id: r.id, width: r.width, height: r.height };
  const enrichedPath = '/tmp/clerk-enriched-manifest.json';
  writeFileSync(enrichedPath, JSON.stringify(enriched, null, 2));

  // 2. Transpile with siteParts:false → header inline at true DOM order (fixes B).
  const outDir = '/tmp/clerk-fullpage-build';
  const tr = execFileSync('node', [
    join(REPO, 'eval', 'grader', 'transpile-html.mjs'),
    '--html', HTML, '--width', String(width),
    '--assets', enrichedPath, '--out', outDir, '--no-site-parts', '--dry-run',
  ], { encoding: 'utf8', cwd: join(REPO, 'eval', 'grader'), maxBuffer: 64 * 1024 * 1024 });
  console.log(tr.split('\n').filter((l) => /census|count|image|widget|PAIN|error|tree/i.test(l)).slice(0, 12).join('\n'));

  const tree = JSON.parse(readFileSync(join(outDir, 'tree.json'), 'utf8'));

  // 3. Render to the local sandbox (page 83). render() stamps ids (load-bearing) + flush_css.
  const shot = join(SNAP, 'clerk-fullpage-1440.png');
  const res = await render(tree, { page: a.page, slug: 'clerk-fullpage', title: 'Clerk Full Page', shot, width });
  console.log(`[render] page ${res.pageId} → ${res.url}`);
  console.log(`[render] screenshot ${shot}`);
  return res;
}

main().catch((e) => { console.error('render-clerk-fullpage FAILED:', e.message); process.exit(1); });
