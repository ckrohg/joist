#!/usr/bin/env node
/**
 * @purpose PER-BREAKPOINT override post-processor (stage 2 of the per-bp BUILD experiment).
 * Reads the reconciled model (reconcile-breakpoints.mjs → box{1440,768,390} + status per matched leaf) and a
 * build-absolute clone built with ABS_PERBP=1 (each leaf carries a deterministic _element_id `pb<x>-<y>-<w>-<h>`
 * keyed to its page-absolute desktop box, == the model's box[1440]). For each correlated leaf it APPENDS to the
 * page custom_css a set of <=1024 @media overrides that re-pin the leaf to its CAPTURED mobile/tablet box so the
 * clone reflows to the SOURCE mobile layout instead of the generic un-pin 1-col stack:
 *   • status[390]=matched & box[390]≠box[1440] → @media(max-width:767px){#pb…{position:absolute;left/top/width=box[390]}}
 *   • status[768]=matched & box[768]≠box[1440] → @media(768..1024){#pb…{…=box[768]}}
 *   • status[390]=absent                       → @media(max-width:767px){#pb…{display:none}}
 *   • native typography_font_size mobile/tablet via the SAME @media (font-size from typo[390]/[768] where it differs)
 * DESKTOP-IDENTICAL: every rule is scoped to a <=1024 @media → the grader's 1440 desktop render never sees it.
 * Re-PUTs the page (CAS retry on 409). Usage: node perbp-postprocess.mjs --page <id> --model /tmp/pbc-s1/model.json [--tree /tmp/pbc-tree-<id>.json]
 */
import fs from 'fs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
// §0 SAFETY GUARD: default flipped from the PAUSED shared host georges232.sg-host.com → local sandbox;
// resolveBase() throws LOUDLY before any fetch/PUT if JOIST_BASE points to a non-training host.
import { resolveBase } from '../../sandbox/host-guard.mjs';
const base = resolveBase(process.env.JOIST_BASE || 'http://localhost:8001');
const b64 = process.env.JOIST_AUTH_B64;
const pageId = arg('page'), modelPath = arg('model', '/tmp/pbc-s1/model.json'), treePath = arg('tree', `/tmp/pbc-tree-${arg('page')}.json`);
if (!b64 || !pageId) { console.error('need --page + JOIST_AUTH_B64'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = (n) => Math.round(n);
const diff = (a, b) => a && b && (Math.abs(a.x - b.x) > 2 || Math.abs(a.y - b.y) > 2 || Math.abs(a.w - b.w) > 2);

const model = JSON.parse(fs.readFileSync(modelPath, 'utf8')).model;
// pb-ids that ACTUALLY exist in the built clone (skip overrides for filtered/raster-consumed leaves → no dead rules)
let cloneIds = null;
try {
  const T = JSON.parse(fs.readFileSync(treePath, 'utf8'));
  cloneIds = new Set();
  const walk = (node) => { if (Array.isArray(node)) { node.forEach(walk); return; } if (node && typeof node === 'object') { if (node.settings && node.settings._element_id) cloneIds.add(node.settings._element_id); if (node.elements) walk(node.elements); } };
  walk(T.elements || T);
} catch { console.log('(no tree dump — emitting for every model leaf; dead rules are harmless no-ops)'); }

const idOf = (l) => { const b = l.box && l.box['1440']; return b ? `pb${R(b.x)}-${R(b.y)}-${R(b.w)}-${R(b.h)}` : null; };
// re-pin a leaf to a captured (x,y,w,h) — id-scoped + !important beats the build's `.elementor-absolute` un-pin.
const repin = (box) => `position:absolute!important;left:${R(box.x)}px!important;top:${R(box.y)}px!important;width:${R(box.w)}px!important;right:auto!important;bottom:auto!important;margin:0!important;max-width:none!important`;

const mob = [];   // @media(max-width:767px) rules
const tab = [];   // @media(min-width:768px) and (max-width:1024px) rules
let nReposition390 = 0, nReposition768 = 0, nHidden = 0, nFont390 = 0, nFont768 = 0, nSkippedNotInClone = 0;
const fontSize = (l, w) => { const t = l.typo && l.typo[w]; return t && t.size ? R(t.size) : null; };

for (const l of model) {
  const id = idOf(l); if (!id) continue;
  if (cloneIds && !cloneIds.has(id)) { nSkippedNotInClone++; continue; }
  const b1440 = l.box['1440'], b768 = l.box['768'], b390 = l.box['390'];
  const s390 = l.status && l.status['390'], s768 = l.status && l.status['768'];
  // ABSENT at 390 → hide. (An absent leaf is in the source desktop but NOT the source mobile DOM.)
  if (s390 === 'absent') { mob.push(`#${id}{display:none!important}`); nHidden++; }
  else if (s390 === 'matched' && b390 && diff(b1440, b390)) {
    mob.push(`#${id}{${repin(b390)}}`); nReposition390++;
    const fs390 = fontSize(l, '390'), fs1440 = fontSize(l, '1440');
    if (fs390 && fs390 !== fs1440) { mob.push(`#${id},#${id} *{font-size:${fs390}px!important}`); nFont390++; }
  }
  // TABLET (768): independent of 390 (a leaf can reflow at tablet but be absent at mobile → mobile rule already hid it).
  if (s390 !== 'absent') {
    if (s768 === 'matched' && b768 && diff(b1440, b768)) {
      tab.push(`#${id}{${repin(b768)}}`); nReposition768++;
      const fs768 = fontSize(l, '768'), fs1440 = fontSize(l, '1440');
      if (fs768 && fs768 !== fs1440) { tab.push(`#${id},#${id} *{font-size:${fs768}px!important}`); nFont768++; }
    } else if (s768 === 'absent') { tab.push(`#${id}{display:none!important}`); }
  }
}

// Build the override block. ORDER MATTERS: the tablet block (max-width:1024) must come BEFORE the mobile block
// (max-width:767) so that at <=767 the mobile rule wins where both match the same id (equal specificity → later
// wins). Both are scoped <=1024 → desktop (>1024) byte-identical.
const tabBlock = tab.length ? `@media(min-width:768px) and (max-width:1024px){${tab.join('')}}` : '';
const mobBlock = mob.length ? `@media(max-width:767px){${mob.join('')}}` : '';
const overrideCss = '\n/* PER-BP OVERRIDES (stage2) */\n' + [tabBlock, mobBlock].filter(Boolean).join('\n');

console.log(`per-bp overrides: reposition390=${nReposition390} reposition768=${nReposition768} hidden390=${nHidden} font390=${nFont390} font768=${nFont768} | skipped(not in clone)=${nSkippedNotInClone}`);
console.log(`override css bytes: ${overrideCss.length}`);

const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'perbp-pp-' + Date.now() };
// read current page (custom_css + hash), append, re-PUT with CAS retry
const cur = await (await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { headers })).json();
let expected = cur.elementor && cur.elementor.hash;
const prevCss = (cur.page_settings && cur.page_settings.custom_css) || (cur.elementor && cur.elementor.page_settings && cur.elementor.page_settings.custom_css) || '';
// Guard against double-apply: strip any prior per-bp block before re-appending.
const cleanedPrev = prevCss.replace(/\n?\/\* PER-BP OVERRIDES \(stage2\) \*\/[\s\S]*$/, '');
const newCss = cleanedPrev + overrideCss;
console.log(`prev custom_css bytes: ${prevCss.length} (cleaned ${cleanedPrev.length}) → new ${newCss.length}`);

// We must re-PUT with the EXISTING elements tree (custom_css lives in page_settings). The joist PUT requires
// elements; fetch the full tree via the page read (elementor.elements) and pass it back unchanged.
const elements = cur.elementor && cur.elementor.elements;
if (!elements) { console.error('could not read existing elements tree to re-PUT'); process.exit(3); }
let r, txt;
for (let a = 0; a < 6; a++) {
  const body = { expected_hash: expected, elements, page_settings: { ...(cur.page_settings || {}), custom_css: newCss }, title: cur.title || 'Per-BP clone', intent: 'per-breakpoint overrides' };
  r = await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { method: 'PUT', headers, body: JSON.stringify(body) });
  txt = await r.text(); if (r.status !== 409) break;
  try { expected = JSON.parse(txt).details.current_hash; } catch {}
  await sleep(400);
}
console.log('PUT', r.status, txt.slice(0, 120));
// re-assert builder render mode (mirrors build-absolute) so the frontend serves the tree, not post_content
try {
  await fetch(`${base}/wp-json/joist/v1/pages/${pageId}/meta`, { method: 'POST', headers, body: JSON.stringify({ meta: { _elementor_edit_mode: 'builder', _wp_page_template: 'elementor_canvas' } }) });
} catch {}
console.log(`PAGE: ${base}/?page_id=${pageId}`);
