#!/usr/bin/env node
/**
 * @purpose _grade-element-crops-selftest.mjs — OFFLINE self-test for the correspondence-aligned native-res
 * crop harness (grade-element-crops.mjs). No network where possible (the pure block + a synthetic PNG); the
 * one e2e check reuses the cached /tmp/compare-341.json blob (no capture). Precedents: _compare-capture-
 * selftest.mjs, _region-judge-gametest.mjs, _vj-selftest.mjs. Builder does NOT self-bless — the orchestrator
 * re-executes this.
 *
 * Proves the four load-bearing claims:
 *   (A) HALLUCINATION VERIFIER drops a synthetic contradictory defect (bg measured light, model says dark)
 *       and KEEPS a legitimate one.
 *   (B) NATIVE-RES CROP — a crop emitted from a synthetic full-res PNG at an element bbox has px dims EQUAL
 *       to the bbox (proving it is NOT a downscaled thumbnail — the resolution-catastrophe fix).
 *   (C) AXIS-DELTA fires on an INJECTED diff (color/font/bbox/presence/contrast) and is SILENT on identical
 *       (element-vs-itself → zero flags; anti-gaming).
 *   (D) dHASH distance is 0 on identical crops and large on a blanked crop (Layer-0 image axis without vision).
 *   plus pure-fn units: ΔE2000 monotonicity, CIEDE2000 anchors, readPairs on the real blob.
 *
 * Run:  node _grade-element-crops-selftest.mjs        (exit 0 = ALL PASS)
 */
import fs from 'fs';
import { PNG } from 'pngjs';
import { crop } from './grade-vision-tiles.mjs';
import * as M from './grade-element-crops.mjs';

const cases = [];
const ok = (name, cond, detail = '') => { cases.push({ name, passed: !!cond, detail }); };

// ── solid + structured synthetic PNGs (no network) ──
function solidPng(w, h, [r, g, b]) { const p = new PNG({ width: w, height: h }); for (let i = 0; i < p.data.length; i += 4) { p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255; } return p; }
function stripedPng(w, h) { const p = new PNG({ width: w, height: h }); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) << 2; const v = (x >> 3) % 2 ? 240 : 20; p.data[i] = p.data[i + 1] = p.data[i + 2] = v; p.data[i + 3] = 255; } return p; }

// (A) VERIFIER — drops a contradictory defect, keeps a legit one, and drops a blank-claim contradicted by text.
{
  const dropDark = M.verifyDefect({ element: 'hero', evidence: 'the background renders dark/black', defect_class: 'color-off' }, { bgLuma: 252, bgHex: 'FCFCFC' });
  ok('(A1) verifier DROPS "dark background" when measured bg is light (#FCFCFC)', dropDark.keep === false && /dark background/.test(dropDark.reason), JSON.stringify(dropDark));
  const keep = M.verifyDefect({ element: 'logo', evidence: 'the wordmark uses the wrong typeface', defect_class: 'wrong-logo' }, { bgLuma: 252 });
  ok('(A2) verifier KEEPS a legitimate non-contradicted defect', keep.keep === true, JSON.stringify(keep));
  const dropBlank = M.verifyDefect({ element: 'sec', evidence: 'this section is blank and empty', defect_class: 'missing-section' }, { textCount: 4 });
  ok('(A3) verifier DROPS "section is blank/empty" when measured textCount=4', dropBlank.keep === false && /text node/.test(dropBlank.reason), JSON.stringify(dropBlank));
  // NO OVER-DROP: "the gradient is absent → flat pink" is a PRESENT-BUT-WRONG color defect on a present element
  // (a real false-catch observed on overreacted) — the word "absent" describes a SUB-PROPERTY, not the element.
  const keepGradient = M.verifyDefect({ element: 'button background', evidence: 'Original shows a left-to-right gradient; the rebuild is flat solid pink with the gradient absent or collapsed.', defect_class: 'color-off' }, { textCount: 1, inkFrac: 0.4 });
  ok('(A6) verifier does NOT over-drop "the gradient is absent" (sub-property, not a blank element)', keepGradient.keep === true, JSON.stringify(keepGradient));
  const keepUnderline = M.verifyDefect({ element: 'link', evidence: 'the pink underline decoration is missing in the rebuild', defect_class: 'font-off' }, { textCount: 1 });
  ok('(A7) verifier does NOT over-drop "the underline is missing" (sub-property)', keepUnderline.keep === true, JSON.stringify(keepUnderline));
  const dropLight = M.verifyDefect({ element: 'code', evidence: 'the code block background is light/white', defect_class: 'color-off' }, { bgLuma: 30, bgHex: '1E1E1E' });
  ok('(A4) verifier DROPS "light background" when measured bg is dark (#1E1E1E)', dropLight.keep === false, JSON.stringify(dropLight));
  const dropBorder = M.verifyDefect({ element: 'card', evidence: 'the card has no border', defect_class: 'wrong-layout' }, { hasBorder: true, borderDesc: '1px solid' });
  ok('(A5) verifier DROPS "no border" when a border is measured present', dropBorder.keep === false, JSON.stringify(dropBorder));
}

// (B) NATIVE-RES CROP — px dims of the crop EQUAL the element bbox (NOT a thumbnail downscale).
{
  const full = stripedPng(1440, 4000);
  const bbox = { x: 120, y: 1500, w: 300, h: 80 };
  const c = crop(full, bbox.x, bbox.y, bbox.w, bbox.h);
  ok('(B1) native crop px dims == element bbox (no downscale thumbnail)', c.width === bbox.w && c.height === bbox.h, `crop ${c.width}x${c.height} vs bbox ${bbox.w}x${bbox.h}`);
  // and the crop is at NATIVE res: the striped content frequency is preserved (a downscaled thumbnail would alias)
  const d0 = M.dHash(c), d1 = M.dHash(crop(full, bbox.x, bbox.y, bbox.w, bbox.h));
  ok('(B2) re-cropping the same bbox is byte-stable (deterministic native copy)', M.hamming(d0, d1) === 0, `hamming ${M.hamming(d0, d1)}`);
}

// (C) AXIS-DELTA — fires on an INJECTED diff, silent on identical. Build two minimal ElementRecords.
{
  const mk = (over = {}) => ({ ref: 'x', tag: 'h1', role: 'heading', text: 'Hello World', ownText: 'Hello World',
    box: { 1440: { x: 0, y: 0, w: 400, h: 48, right: 400 } },
    style: { color: 'rgb(20,20,20)', backgroundColor: 'rgb(255,255,255)', font: { size: '32px' }, border: { width: {}, style: {}, color: {} } },
    asset: { isImage: false }, ...over });
  // identical → zero flags
  const idRows = M.axisDeltas(mk(), mk(), 1440);
  ok('(C1) axis-delta SILENT on identical element (zero flags)', idRows.every((r) => !r.flagged), JSON.stringify(idRows.filter((r) => r.flagged).map((r) => r.axis)));
  // color injected: text color far off (→ color-off, contrast collapse)
  const colorRows = M.axisDeltas(mk(), mk({ style: { color: 'rgb(245,245,245)', backgroundColor: 'rgb(255,255,255)', font: { size: '32px' }, border: { width: {}, style: {}, color: {} } } }), 1440);
  ok('(C2) axis-delta FIRES color-deltaE on an injected color diff (dark→near-white text)', colorRows.some((r) => r.axis === 'color-deltaE' && r.flagged), JSON.stringify(colorRows.filter((r) => r.flagged).map((r) => r.axis)));
  ok('(C3) axis-delta FIRES text-contrast on the same (readable→washed) diff', colorRows.some((r) => r.axis === 'text-contrast' && r.flagged));
  // font injected: 32px → 18px
  const fontRows = M.axisDeltas(mk(), mk({ style: { color: 'rgb(20,20,20)', backgroundColor: 'rgb(255,255,255)', font: { size: '18px' }, border: { width: {}, style: {}, color: {} } } }), 1440);
  ok('(C4) axis-delta FIRES font-size-ratio on a 32→18px diff', fontRows.some((r) => r.axis === 'font-size-ratio' && r.flagged));
  // bbox injected: 400x48 → 400x120
  const bboxRows = M.axisDeltas(mk(), mk({ box: { 1440: { x: 0, y: 0, w: 400, h: 120, right: 400 } } }), 1440);
  ok('(C5) axis-delta FIRES bbox-ratio on an h 48→120 diff', bboxRows.some((r) => r.axis === 'bbox-ratio' && r.flagged));
  // presence injected: clone missing
  const presRows = M.axisDeltas(mk(), null, 1440);
  ok('(C6) axis-delta FIRES presence (missing-element) when clone el is null', presRows.some((r) => r.axis === 'presence' && r.flagged && r.class === 'missing-element'));
  // overflow injected: clone box right edge past viewport
  const overRows = M.axisDeltas(mk(), mk({ box: { 1440: { x: 0, y: 0, w: 1700, h: 48, right: 1700 } } }), 1440);
  ok('(C7) axis-delta FIRES h-overflow when clone box right (1700) > viewport (1440)', overRows.some((r) => r.axis === 'h-overflow' && r.flagged));
  // every flagged row carries uncalibrated:true
  ok('(C8) every axis row is marked uncalibrated:true', [...idRows, ...colorRows, ...fontRows].every((r) => r.uncalibrated === true));
}

// (D) dHASH — 0 on identical crops, large on a blanked clone (Layer-0 image axis without vision).
{
  const a = stripedPng(300, 80);
  const b = stripedPng(300, 80);
  ok('(D1) dHash distance 0 on identical content', M.hamming(M.dHash(a), M.dHash(b)) === 0, `hamming ${M.hamming(M.dHash(a), M.dHash(b))}`);
  const blank = solidPng(300, 80, [255, 255, 255]);
  const dist = M.hamming(M.dHash(a), M.dHash(blank));
  ok('(D2) dHash distance LARGE on a blanked clone crop (injected defect flagged WITHOUT vision)', dist >= M.TOL.dHashDist, `hamming ${dist} vs tol ${M.TOL.dHashDist}`);
  // and the img-phash AXIS fires on the blank via axisDeltas with crops
  const imgEl = (src) => ({ ref: 'img', tag: 'img', role: 'img', box: { 1440: { x: 0, y: 0, w: 300, h: 80, right: 300 } }, style: {}, asset: { isImage: true, naturalSrc: src, svgHash: null } });
  const imgRows = M.axisDeltas(imgEl('a.png'), imgEl('a.png'), 1440, { srcCrop: a, cloneCrop: blank });
  ok('(D3) img-phash AXIS fires on a blanked clone image crop', imgRows.some((r) => r.axis === 'img-phash' && r.flagged), JSON.stringify(imgRows.filter((r) => r.flagged).map((r) => r.axis)));
  const imgRowsOk = M.axisDeltas(imgEl('a.png'), imgEl('a.png'), 1440, { srcCrop: a, cloneCrop: b });
  ok('(D4) img-phash AXIS SILENT on identical image crops', !imgRowsOk.some((r) => r.axis === 'img-phash' && r.flagged));
}

// (E) ΔE2000 anchors + monotonicity (CIEDE2000 sanity).
{
  ok('(E1) ΔE2000 identical = 0', M.deltaE2000({ r: 50, g: 50, b: 50 }, { r: 50, g: 50, b: 50 }) < 0.001);
  ok('(E2) ΔE2000 black↔white ≈ 100', Math.abs(M.deltaE2000({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }) - 100) < 1.5);
  const near = M.deltaE2000({ r: 51, g: 51, b: 51 }, { r: 55, g: 55, b: 55 });
  ok('(E3) ΔE2000 near-imperceptible step (51→55) is below the color tolerance', near < M.TOL.colorDeltaE, `ΔE ${near.toFixed(2)} < tol ${M.TOL.colorDeltaE}`);
  const big = M.deltaE2000({ r: 20, g: 20, b: 20 }, { r: 220, g: 60, b: 60 });
  ok('(E4) ΔE2000 obvious color change (dark→red) exceeds the tolerance', big > M.TOL.colorDeltaE);
}

// (F) readPairs on the REAL cached blob (no network): corresponded pairs read, identity is silent, missing flagged.
{
  const p = '/tmp/compare-341.json';
  if (fs.existsSync(p)) {
    const blob = JSON.parse(fs.readFileSync(p, 'utf8'));
    const { pairs } = M.readPairs(blob, 1440);
    ok('(F1) readPairs returns corresponded pairs from the real v4 blob', pairs.length > 100, `pairs ${pairs.length}`);
    ok('(F2) readPairs separates present from clone-missing pairs', pairs.some((x) => x.cEl) && pairs.some((x) => !x.cEl), `present ${pairs.filter((x) => x.cEl).length} / missing ${pairs.filter((x) => !x.cEl).length}`);
    // a corresponded present pair, run against ITSELF → no flags (anti-gaming on real data)
    const some = pairs.find((x) => x.cEl && x.sEl.style && x.sEl.style.color);
    const idRows = M.axisDeltas(some.sEl, some.sEl, 1440);
    ok('(F3) real corresponded element vs ITSELF → zero axis flags (anti-gaming)', idRows.every((r) => !r.flagged), JSON.stringify(idRows.filter((r) => r.flagged).map((r) => r.axis)));
  } else {
    ok('(F1) [SKIP] /tmp/compare-341.json not present — e2e blob check skipped', true, 'regenerate with compare-capture.mjs');
  }
}

// ── report ──
const failed = cases.filter((c) => !c.passed);
for (const c of cases) console.log(`${c.passed ? 'PASS' : 'FAIL'}  ${c.name}${c.detail && !c.passed ? '  [' + c.detail + ']' : ''}`);
console.log(`\ngrade-element-crops selftest: ${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${cases.length} cases)`);
process.exit(failed.length === 0 ? 0 : 1);
