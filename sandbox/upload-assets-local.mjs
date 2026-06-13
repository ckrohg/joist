#!/usr/bin/env node
/**
 * @purpose Import captured page assets into the LOCAL Docker WP media library as real
 * attachments (so they carry attachment IDs + width/height metadata) and return an
 * enriched manifest mapping each `assets/<name>` ref → { url, id, width, height }.
 *
 * WHY (clerk full-page fidelity, 2026-06-12): the prior render copied assets to a static
 * `wp-content/uploads/clerk-assets/` dir and pointed image widgets at bare URLs with NO
 * attachment id. Elementor 3.28's image widget has no standalone width/height control —
 * only `image_size` + `image_custom_dimension`, and `custom` only works when the image is
 * a registered attachment (so Elementor can resolve a sized URL + stamp width/height on the
 * <img>). With URL-only images, far-down `loading="lazy"` images never reserved a box,
 * collapsed to height:0, never entered the lazy intersection, never decoded → rendered as
 * empty "placeholder boxes" (29 of 43). Importing as real attachments fixes the whole
 * chain: image.id + image_size:custom + the widget reserving the captured box.
 *
 * SVGs: WP blocks image/svg+xml upload by default. We allow it for THIS sandbox import
 * (local only) so framework/logo SVGs also become attachments with declared dimensions.
 *
 * Usage:  node upload-assets-local.mjs <manifest.json> [outManifest.json]
 *   manifest.json: { "assets/<name>": "/abs/path/to/file", ... }  (the capture manifest)
 * Returns (stdout JSON, also written to outManifest): array of
 *   { src:"assets/<name>", url, id, width, height }
 *
 * LOCAL SANDBOX ONLY — uses `wp media import` inside the wpcli-1 container.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPOSE_DIR = __dirname;
const CLI_SERVICE = process.env.JOIST_CLI_SERVICE || 'wpcli-1';

function compose(args) {
  return execFileSync('docker', ['compose', ...args], {
    cwd: COMPOSE_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Import every file in `manifest` into WP media. The whole staging dir is mounted into the
 * container once; a single eval-file PHP imports each file via media_handle_sideload so we
 * pay one container spin-up, not one per asset.
 * @param {Record<string,string>} manifest  { "assets/<name>": "/abs/src" }
 * @returns {Array<{src,url,id,width,height}>}
 */
export function uploadAssetsLocal(manifestPath, outPath) {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entries = Object.entries(raw); // [ ["assets/x.png", "/abs/x.png"], ... ]
  const stage = mkdtempSync(join(tmpdir(), 'joist-assets-'));
  // Stage files under their basename so the container path is stable + predictable.
  const list = entries.map(([src, file]) => {
    const name = basename(src);
    copyFileSync(file, join(stage, name));
    return { src, name };
  });
  // PHP: allow svg mime for this import, then sideload each staged file → collect id/url/dims.
  const php = `<?php
require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
add_filter('upload_mimes', function($m){ $m['svg']='image/svg+xml'; return $m; });
add_filter('wp_check_filetype_and_ext', function($d,$file,$fn){
  if (preg_match('/\\.svg$/i',$fn)) { $d['ext']='svg'; $d['type']='image/svg+xml'; }
  return $d;
}, 10, 3);
$names = json_decode(file_get_contents('/asset-list.json'), true);
$out = array();
foreach ($names as $row) {
  $name = $row['name']; $src = $row['src'];
  $path = '/assets-stage/' . $name;
  // Reuse an existing attachment with the same _joist_src so re-runs stay idempotent.
  $existing = get_posts(array('post_type'=>'attachment','meta_key'=>'_joist_src','meta_value'=>$src,'numberposts'=>1,'fields'=>'ids'));
  if (!empty($existing)) { $aid = $existing[0]; }
  else {
    $tmp = wp_tempnam($name);
    copy($path, $tmp);
    $file_array = array('name'=>$name, 'tmp_name'=>$tmp);
    $aid = media_handle_sideload($file_array, 0);
    if (is_wp_error($aid)) { @unlink($tmp); $out[] = array('src'=>$src,'error'=>$aid->get_error_message()); continue; }
    update_post_meta($aid, '_joist_src', $src);
  }
  $url = wp_get_attachment_url($aid);
  $meta = wp_get_attachment_metadata($aid);
  $w = isset($meta['width']) ? (int)$meta['width'] : 0;
  $h = isset($meta['height']) ? (int)$meta['height'] : 0;
  // SVGs have no width/height in attachment meta — read the viewBox/width attrs.
  if ((!$w || !$h) && preg_match('/\\.svg$/i',$name)) {
    $svg = @file_get_contents($path);
    if ($svg) {
      if (preg_match('/<svg[^>]*\\bwidth=["\\\']?([0-9.]+)/i',$svg,$mw)) $w = (int)round($mw[1]);
      if (preg_match('/<svg[^>]*\\bheight=["\\\']?([0-9.]+)/i',$svg,$mh)) $h = (int)round($mh[1]);
      if ((!$w||!$h) && preg_match('/viewBox=["\\\']?[0-9.]+\\s+[0-9.]+\\s+([0-9.]+)\\s+([0-9.]+)/i',$svg,$mv)) { $w=$w?:(int)round($mv[1]); $h=$h?:(int)round($mv[2]); }
    }
  }
  $out[] = array('src'=>$src, 'id'=>(int)$aid, 'url'=>$url, 'width'=>$w, 'height'=>$h);
}
echo "JOIST_ASSET_RESULT=" . json_encode($out) . "\n";
`;
  const phpFile = join(stage, '_import.php');
  const listFile = join(stage, '_asset-list.json');
  writeFileSync(phpFile, php);
  writeFileSync(listFile, JSON.stringify(list));
  try {
    const out = compose([
      'run', '--rm', '-T',
      '-v', `${stage}:/assets-stage:ro`,
      '-v', `${phpFile}:/import.php:ro`,
      '-v', `${listFile}:/asset-list.json:ro`,
      CLI_SERVICE, '-c', 'wp eval-file /import.php',
    ]);
    const m = out.match(/JOIST_ASSET_RESULT=(.+)/);
    if (!m) throw new Error(`upload-assets: no result marker in wp-cli output:\n${out.slice(-800)}`);
    const result = JSON.parse(m[1]);
    const errors = result.filter((r) => r.error);
    if (errors.length) throw new Error(`upload-assets: ${errors.length} import error(s): ${JSON.stringify(errors).slice(0, 300)}`);
    if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 2));
    return result;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = process.argv[2];
  const outPath = process.argv[3];
  if (!manifest) { console.error('usage: node upload-assets-local.mjs <manifest.json> [out.json]'); process.exit(2); }
  const res = uploadAssetsLocal(manifest, outPath);
  console.log(JSON.stringify(res, null, 2));
}
