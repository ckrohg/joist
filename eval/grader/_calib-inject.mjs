#!/usr/bin/env node
/**
 * @purpose CALIBRATION-ONLY local injector. The local Joist REST validator rejects the absolute-positioning
 * widget vocabulary (text-editor text_color/_flex_grow, html _offset_*, …) that build-absolute emits — but
 * ELEMENTOR ITSELF renders all of it fine. So we use the PROVEN canonical local primitive: direct postmeta
 * via wp-cli inside the docker container (sandbox/render.mjs's injectTree, the same path page 258 — the
 * already-calibrated projection-clone anchor — was built on). It writes _elementor_data (the tree) AND
 * _elementor_page_settings (build-absolute's custom_css: fonts/responsive/de-inline/full-bleed) so the
 * desktop render is faithful, then sets edit_mode=builder + canvas + flushes CSS. Reversible; commits nothing.
 *
 * Reads a build-absolute DRY-RUN dump ({elements:[root], page_settings:{custom_css}}). All assets were already
 * uploaded to the local WP media library during the (non-dry) build, so the tree's image URLs resolve locally.
 *
 * Usage: node _calib-inject.mjs --dump /tmp/abs-dry-<id>.json --page <id>
 *   env: JOIST_RENDER_SERIAL=1 (throttle). No host arg — postmeta path is localhost docker only.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPOSE_DIR = join(__dirname, '..', '..', 'sandbox');
const CLI_SERVICE = 'wpcli-1';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const dump = arg('dump'), pageId = arg('page');
if (!dump || !pageId) { console.error('need --dump --page'); process.exit(2); }

// stamp 7-char ids on every node (REQUIRED on raw-postmeta path — Elementor per-element CSS scoping collapses without them)
const rid = () => randomBytes(4).toString('hex').slice(0, 7);
const stamp = (nodes) => nodes.map((n) => { const o = { ...n, id: n.id || rid() }; if (Array.isArray(n.elements) && n.elements.length) o.elements = stamp(n.elements); return o; });

const payload = JSON.parse(readFileSync(dump, 'utf8'));
const tree = stamp(payload.elements || []);
const customCss = (payload.page_settings && payload.page_settings.custom_css) || '';

const work = mkdtempSync(join(tmpdir(), 'calib-inject-'));
const treeFile = join(work, 'tree.json');
const cssFile = join(work, 'custom.css');
writeFileSync(treeFile, JSON.stringify(tree));
writeFileSync(cssFile, customCss);
// eval-file: store the tree verbatim as _elementor_data, and the custom_css inside the
// PHP-serialized _elementor_page_settings array (the exact shape Elementor expects + the shape page 258 uses).
const metaFile = join(work, 'update-meta.php');
writeFileSync(metaFile, `<?php
$id = (int) $args[0];
$json = file_get_contents('/tree.json');
update_post_meta($id, '_elementor_data', wp_slash($json));
$css = file_get_contents('/custom.css');
$ps = get_post_meta($id, '_elementor_page_settings', true);
if (!is_array($ps)) $ps = array();
$ps['custom_css'] = $css;
update_post_meta($id, '_elementor_page_settings', $ps);
`);

const script = `
set -e
ID='${String(Number(pageId))}'
wp post get "$ID" --field=ID >/dev/null
wp eval-file /update-meta.php "$ID" >/dev/null
wp post meta update "$ID" _elementor_edit_mode builder >/dev/null
wp post meta update "$ID" _wp_page_template elementor_canvas >/dev/null
wp post meta update "$ID" _elementor_template_type wp-page >/dev/null
wp post meta update "$ID" _elementor_version "$(wp plugin get elementor --field=version)" >/dev/null
wp post meta delete "$ID" _elementor_element_cache >/dev/null 2>&1 || true
wp elementor flush_css >/dev/null 2>&1 || true
echo "INJECT_PAGE_ID=$ID"
`;
try {
  const out = execFileSync('docker', ['compose', 'run', '--rm', '-T',
    '-v', `${treeFile}:/tree.json:ro`,
    '-v', `${cssFile}:/custom.css:ro`,
    '-v', `${metaFile}:/update-meta.php:ro`,
    CLI_SERVICE, '-c', script], { cwd: COMPOSE_DIR, encoding: 'utf8', timeout: 110000, stdio: ['pipe', 'pipe', 'pipe'] });
  const m = out.match(/INJECT_PAGE_ID=(\d+)/);
  if (!m) throw new Error('no page id in wp-cli output:\n' + out);
  console.log(`injected ${tree.length} root node(s) + ${customCss.length} chars custom_css → page ${m[1]}`);
  console.log(`PAGE: http://localhost:8001/?page_id=${m[1]}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
