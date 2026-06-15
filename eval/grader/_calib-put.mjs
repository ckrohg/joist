#!/usr/bin/env node
/**
 * @purpose CALIBRATION-ONLY PUT helper. The local Joist plugin's REST schema validator rejects two
 * settings that build-absolute emits on text-editor widgets (`text_color`, `_flex_grow`) — Elementor
 * itself renders them fine, but the strict validator 422s the whole PUT (CAS loop only retries 409).
 * This helper reads a dry-run dump ({elements:[root], page_settings}) from build-absolute, SANITIZES
 * only those two keys (folding text_color into an inline <span style="color:…"> wrapper on the editor
 * HTML so the color is PRESERVED, dropping the layout-only _flex_grow which is moot under absolute
 * positioning), then PUTs via the Joist API with the SAME CAS-hash retry build-absolute uses. page_settings
 * (custom_css: fonts/responsive/de-inline/full-bleed) survive intact. Reversible: touches no committed file.
 *
 * Usage: node _calib-put.mjs --dump /tmp/abs-dry-<id>.json --page <id>
 *   env: JOIST_AUTH_B64, JOIST_BASE (guarded → localhost:8001 only)
 */
import fs from 'fs';
import { resolveBase } from '../../sandbox/host-guard.mjs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const base = resolveBase(process.env.JOIST_BASE || 'http://localhost:8001');
const b64 = process.env.JOIST_AUTH_B64;
const dump = arg('dump'), pageId = arg('page');
if (!b64 || !dump || !pageId) { console.error('need --dump --page + JOIST_AUTH_B64'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const payload = JSON.parse(fs.readFileSync(dump, 'utf8'));
let folded = 0, droppedFlex = 0, teTotal = 0;
const walk = (n) => {
  if (!n || typeof n !== 'object') return;
  if (n.widgetType === 'text-editor' && n.settings) {
    teTotal++;
    const s = n.settings;
    if ('_flex_grow' in s) { delete s._flex_grow; droppedFlex++; }
    if ('text_color' in s) {
      const col = s.text_color; delete s.text_color;
      // Fold the color into the editor HTML so it is NOT lost. If the editor markup already
      // carries an explicit color it wins (we only set a wrapper default). Wrap verbatim.
      if (col && typeof s.editor === 'string' && s.editor.trim()) {
        s.editor = `<span style="color:${col}">${s.editor}</span>`;
        folded++;
      }
    }
  }
  for (const c of n.elements || []) walk(c);
};
for (const root of payload.elements || []) walk(root);
console.log(`sanitize: ${teTotal} text-editor widget(s) | folded text_color→inline on ${folded} | dropped _flex_grow on ${droppedFlex}`);

const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'calib-' + Date.now() };
(async () => {
  let r, txt, expected = (await (await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { headers })).json()).elementor?.hash;
  for (let a = 0; a < 6; a++) {
    const body = { expected_hash: expected, elements: payload.elements, page_settings: payload.page_settings, title: 'Calibration projection clone', intent: 'projection calibration anchor' };
    r = await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { method: 'PUT', headers, body: JSON.stringify(body) });
    txt = await r.text();
    if (r.status !== 409) break;
    try { expected = JSON.parse(txt).details.current_hash; } catch {}
    await sleep(400);
  }
  console.log('PUT', r.status, txt.slice(0, 200));
  if (r.status >= 400) process.exit(1);
  // edit_mode=builder + canvas template (else frontend serves the post_content fallback, not the tree).
  // Same WP-REST path build-absolute uses (POST /wp/v2/pages/<id> with template + meta).
  const metaHeaders = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json' };
  try {
    const mr = await fetch(`${base}/wp-json/wp/v2/pages/${pageId}`, { method: 'POST', headers: metaHeaders, body: JSON.stringify({ status: 'publish', template: 'elementor_canvas', meta: { _elementor_edit_mode: 'builder', _wp_page_template: 'elementor_canvas' } }) });
    console.log('set edit_mode=builder + template=elementor_canvas', mr.status);
  } catch (e) { console.log('meta-set failed', String(e).slice(0, 80)); }
  console.log(`PAGE: ${base}/?page_id=${pageId}`);
})().catch((e) => { console.error('PUT FAILED', e.message); process.exit(1); });
