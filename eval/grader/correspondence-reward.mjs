#!/usr/bin/env node
/**
 * @purpose correspondence-reward.mjs — LEVER A / WS1 KEYSTONE. A DETERMINISTIC, $0/eval reward that MEASURES
 * element-correspondence between a SOURCE box-tree and a CLONE box-tree (both produced by the same capture-layout
 * Playwright/CSSOM walk). It is a MEASUREMENT, not a fitted model — so it cannot overfit cross-site the way the prior
 * cheap-feature LEARNED reward did (LOO Spearman 0.20 / -0.9), and it scores exactly the failures pixel-SSIM is blind
 * to (fine layout, color, missing/misplaced text). See knowledge/PATH_TO_TRUE_1TO1_V2.md. Design pressure-tested via
 * /fusion (Sonnet+GPT panel): text-first exclusive matching → per-pair LLEM (position/color/typography) → weighted
 * GEOMETRIC MEAN capped by RECALL. Section-LOCAL position normalization (page-height normalization is a deflation bug).
 *
 * Block-Match recall is weighted by sqrt(area)*kind (a clipped/blank headline is few chars but LARGE → stays dominant),
 * combined as F2 (β=2: missing source content hurts more than hallucinated extras). LLEM aggregates over ALL source
 * weight (unmatched source leaf → 0) so dropping content can't hide behind perfect-on-survivors. Color uses CIE76 ΔE in
 * Lab + a CONTRAST GATE (a dark-on-dark invisible heading scores ~0 even though fg "matches"). Rasterization self-vetoes
 * (a raster clone has zero text leaves → R_text=0 → score collapses). Exclusive 1:1 matching (the load-bearing
 * Goodhart guard: one clone leaf can't farm recall against many source blocks).
 *
 * API:  gradeCorrespondence(srcTree, cloneTree) → { score (0-100), axes:{...}, sections:[...] }
 *       correspondSection(srcLeaves, cloneLeaves, srcSec, cloneSec) → { score, R_text, blockMatchF2, llem, axes, ... }
 * CLI:  node correspondence-reward.mjs --source <srcTree.json> --clone <cloneTree.json> [--json]
 * v1 scope notes: greedy-EXCLUSIVE matching (Hungarian is the documented upgrade; identical in the near-binary-text
 * regime + preserves the exclusivity invariant); split/merge recovery + Needleman-Wunsch section alignment are
 * documented refinements (v1 aligns sections greedily by order).
 */
import fs from 'fs';

// ── color (sRGB → Lab, CIE76 ΔE, WCAG contrast) ──────────────────────────────────────────────────────────────────
function parseRGB(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/rgba?\(([^)]+)\)/i); if (m) { const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2]]; }
  const h = s.match(/^#([0-9a-f]{6})$/i); if (h) { const n = parseInt(h[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  return null;
}
function srgbToLab(rgb) {
  let [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
function deltaE76(a, b) { const ra = parseRGB(a), rb = parseRGB(b); if (!ra || !rb) return 100; const la = srgbToLab(ra), lb = srgbToLab(rb); return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]); }
function relLum(rgb) { const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function contrastRatio(fg, bg) { const f = parseRGB(fg), b = parseRGB(bg); if (!f || !b) return 21; const L1 = relLum(f), L2 = relLum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); }

// ── text ────────────────────────────────────────────────────────────────────────────────────────────────────────
function norm(t) { return (t || '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' '); }
function levenshtein(a, b) { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[n]; }
function trigrams(s) { const g = new Set(); const p = '  ' + s + ' '; for (let i = 0; i < p.length - 2; i++) g.add(p.slice(i, i + 3)); return g; }
function trigramJaccard(a, b) { const ga = trigrams(a), gb = trigrams(b); let inter = 0; for (const g of ga) if (gb.has(g)) inter++; const uni = ga.size + gb.size - inter; return uni ? inter / uni : 1; }
function textSim(a, b) { const na = norm(a), nb = norm(b); if (na === nb) return 1; const L = Math.max(na.length, nb.length, 1); if (L > 120) return trigramJaccard(na, nb); return 1 - levenshtein(na, nb) / L; }

// ── leaf extraction + sectioning ────────────────────────────────────────────────────────────────────────────────
export function flatten(tree) { const root = tree.root || tree; const out = []; let di = 0;
  (function w(n) { if (!n) return; if (n.children && n.children.length) { n.children.forEach(w); return; } out.push({ ...n, domIndex: di++ }); })(root); return out; }
const fgOf = (n) => (n.paint && n.paint.value) || n.color || null;
const isText = (n) => n.text && norm(n.text) !== '';
function textLeaves(leaves) { return leaves.filter(isText).map((n) => ({ ...n, ntext: norm(n.text) })); }
function imageLeaves(leaves) { return leaves.filter((n) => n.kind === 'image' && n.box && n.box.w > 4 && n.box.h > 4); }
// section segmentation by vertical-gap (fallback; clone Elementor sections / source full-width ancestors = upgrade).
export function segmentSections(leaves, pageBox) {
  const txt = leaves.filter((n) => n.box).sort((a, b) => a.box.y - b.box.y); if (!txt.length) return [{ box: pageBox, leaves }];
  const lh = txt.map((n) => n.box.h).filter((h) => h > 0).sort((a, b) => a - b); const medLH = lh[Math.floor(lh.length / 2)] || 20;
  const gapThr = Math.max(2 * medLH, 64); const bands = []; let cur = [txt[0]]; let prevBottom = txt[0].box.y + txt[0].box.h;
  for (let i = 1; i < txt.length; i++) { const n = txt[i]; if (n.box.y - prevBottom > gapThr) { bands.push(cur); cur = []; } cur.push(n); prevBottom = Math.max(prevBottom, n.box.y + n.box.h); }
  if (cur.length) bands.push(cur);
  return bands.map((bl) => { const x0 = Math.min(...bl.map((n) => n.box.x)), y0 = Math.min(...bl.map((n) => n.box.y)), x1 = Math.max(...bl.map((n) => n.box.x + n.box.w)), y1 = Math.max(...bl.map((n) => n.box.y + n.box.h)); return { box: { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }, leaves: bl }; });
}
// section-local normalized geometry
function normGeo(box, sec) { return { nx: (box.x + box.w / 2 - sec.x) / sec.w, ny: (box.y + box.h / 2 - sec.y) / sec.h, nw: box.w / sec.w, nh: box.h / sec.h }; }
const textWeight = (n) => ({ heading: 1.25, button: 1.10 }[n.kind] || 1.0) * Math.max(12, Math.min(220, Math.sqrt(Math.max(1, n.box.w * n.box.h))));

// ── per-axis scores ─────────────────────────────────────────────────────────────────────────────────────────────
function positionScore(s, c, secHeightScore) {
  const dx = Math.abs(s.g.nx - c.g.nx), dy = Math.abs(s.g.ny - c.g.ny);
  const tolX = Math.max(0.025, Math.min(0.12, 0.5 * (s.g.nw + c.g.nw))), tolY = Math.max(0.020, Math.min(0.10, 0.5 * (s.g.nh + c.g.nh)));
  const center = Math.exp(-0.5 * ((dx / tolX) ** 2 + (dy / tolY) ** 2));
  const size = Math.exp(-0.5 * ((Math.log(Math.max(1e-3, c.g.nw) / Math.max(1e-3, s.g.nw)) / 0.35) ** 2 + (Math.log(Math.max(1e-3, c.g.nh) / Math.max(1e-3, s.g.nh)) / 0.35) ** 2));
  return 0.55 * center + 0.30 * size + 0.15 * secHeightScore;
}
function colorScore(s, c, sBg, cBg) { // PURE fg/bg ΔE match (visibility handled separately — see visibilityGate)
  const sFg = fgOf(s), cFg = fgOf(c); if (!sFg) return 1; // source had no explicit fg → don't penalize
  const fg = Math.exp(-0.5 * (deltaE76(sFg, cFg || cBg) / 18) ** 2);
  const bg = Math.exp(-0.5 * (deltaE76(sBg, cBg) / 20) ** 2);
  const kind = ((s.paint && s.paint.kind) === (c.paint && c.paint.kind)) ? 1 : 0.85;
  return kind * (0.70 * fg + 0.30 * bg);
}
// VISIBILITY gate: a matched element the clone rendered ~invisible (contrast collapsed vs its own bg) is perceptually
// MISSING — it must tank the whole pairScore, not just the color component (an invisible heading is human-fatal). Only
// fires when the SOURCE element was actually visible (sCR>=2). This is what gives L2 (invisible-heading) a real drop.
function visibilityGate(s, c, sBg, cBg) {
  const sFg = fgOf(s), cFg = fgOf(c); if (!sFg) return 1;
  const sCR = contrastRatio(sFg, sBg), cCR = contrastRatio(cFg || cBg, cBg);
  return sCR < 2 ? 1 : Math.sqrt(Math.max(0, Math.min(1, (cCR - 1) / (Math.min(sCR, 4.5) - 1))));
}
function typoScore(s, c) {
  const st = s.typo || {}, ct = c.typo || {};
  const fam = (st.family && ct.family) ? (st.family === ct.family ? 1 : (genericClass(st.family) === genericClass(ct.family) ? 0.7 : 0.3)) : 0.5;
  const ss = +st.size || 16, cs = +ct.size || 16; const sz = Math.exp(-0.5 * (Math.log(cs / ss) / 0.20) ** 2);
  const sw = wnum(st.weight), cw = wnum(ct.weight); const wt = Math.exp(-0.5 * ((cw - sw) / 250) ** 2);
  return 0.45 * fam + 0.35 * sz + 0.20 * wt;
}
const genericClass = (f) => /mono|courier|consol/i.test(f) ? 'mono' : /serif/i.test(f) && !/sans/i.test(f) ? 'serif' : 'sans';
const wnum = (w) => { if (typeof w === 'number') return w; const m = { normal: 400, bold: 700 }; return m[w] || parseInt(w, 10) || 400; };

// ── CORE: single-section correspondence ─────────────────────────────────────────────────────────────────────────
export function correspondSection(srcLeavesRaw, cloneLeavesRaw, srcSec, cloneSec, ctx = {}) {
  const pageBgS = ctx.srcPageBg || 'rgb(255,255,255)', pageBgC = ctx.clonePageBg || 'rgb(255,255,255)';
  const prep = (leaves, sec, pageBg) => textLeaves(leaves).map((n) => ({ ...n, g: normGeo(n.box, sec), bg: n.bg || sec.bg || pageBg }));
  const S = prep(srcLeavesRaw, srcSec, pageBgS), C = prep(cloneLeavesRaw, cloneSec, pageBgC);
  const secHeightScore = Math.exp(-0.5 * (Math.log(Math.max(1, cloneSec.h) / Math.max(1, srcSec.h)) / 0.40) ** 2);

  // candidate text pairs (gate: text threshold + same band), greedy-EXCLUSIVE by descending assignment score.
  const cand = [];
  for (let i = 0; i < S.length; i++) for (let j = 0; j < C.length; j++) {
    const ts = textSim(S[i].ntext, C[j].ntext); const L = Math.max(S[i].ntext.length, C[j].ntext.length);
    if (L <= 12 ? ts < 1 : ts < 0.90) continue; if (Math.abs(S[i].g.ny - C[j].g.ny) > 0.35) continue;
    const pos = positionScore(S[i], C[j], secHeightScore);
    cand.push({ i, j, ts, pos, score: 1e6 * Math.round(ts * 1e6) / 1e6 + pos });
  }
  cand.sort((a, b) => b.score - a.score || (a.i - b.i) || (a.j - b.j));
  const usedS = new Set(), usedC = new Set(), matches = [];
  for (const p of cand) { if (usedS.has(p.i) || usedC.has(p.j)) continue; usedS.add(p.i); usedC.add(p.j); matches.push(p); }

  // Block-Match F2 (size-weighted, β=2)
  const W_S = S.reduce((a, n) => a + textWeight(n), 0), W_C = C.reduce((a, n) => a + textWeight(n), 0);
  let Rw = 0, Pw = 0;
  for (const m of matches) { const s = S[m.i], c = C[m.j], q = m.ts; Rw += textWeight(s) * q; Pw += Math.min(textWeight(c), 1.25 * textWeight(s)) * q; }
  const R_text = W_S ? Rw / W_S : 1, P_text = W_C ? Pw / W_C : 1;
  const blockMatchF2 = W_S === 0 ? 1 : (P_text + R_text === 0 ? 0 : (5 * P_text * R_text) / (4 * P_text + R_text));

  // LLEM aggregated over ALL source weight (unmatched source leaf → pairScore 0)
  const mOf = new Map(matches.map((m) => [m.i, m]));
  let llemW = 0; const axisAcc = { existence: 0, text: 0, position: 0, color: 0, typography: 0 };
  for (let i = 0; i < S.length; i++) { const w = textWeight(S[i]); const m = mOf.get(i);
    let ax = { existence: 0, text: 0, position: 0, color: 0, typography: 0 }; let vis = 1;
    if (m) { const c = C[m.j]; vis = visibilityGate(S[i], c, S[i].bg, c.bg);
      ax = { existence: 1, text: m.ts, position: positionScore(S[i], c, secHeightScore), color: colorScore(S[i], c, S[i].bg, c.bg), typography: typoScore(S[i], c) }; }
    // visibility multiplies the WHOLE pairScore: a matched-but-invisible element ≈ missing (perceptually).
    const pairScore = vis * (0.10 * ax.existence + 0.30 * ax.text + 0.25 * ax.position + 0.20 * ax.color + 0.15 * ax.typography);
    for (const k of Object.keys(axisAcc)) axisAcc[k] += w * vis * ax[k]; llemW += w * pairScore;
  }
  const LLEM = W_S ? llemW / W_S : 1; const axes = {}; for (const k of Object.keys(axisAcc)) axes[k] = +(W_S ? axisAcc[k] / W_S : 1).toFixed(4);

  // images (ctx.textOnly skips them entirely — for isolating the text/layout/color signal from the image confound)
  const visual = ctx.textOnly ? { F2: 1, R: 1, srcHasImages: false } : correspondImages(imageLeaves(srcLeavesRaw), imageLeaves(cloneLeavesRaw), srcSec, cloneSec);

  // combination: weighted geometric mean capped by recall
  const base = Math.pow(Math.max(1e-6, blockMatchF2), 0.50) * Math.pow(Math.max(1e-6, LLEM), 0.35) * Math.pow(Math.max(0.10, visual.F2), 0.15);
  const textRecallCap = 0.05 + 0.95 * R_text;
  const imageRecallCap = visual.srcHasImages ? 1 - (visual.imgAreaFrac ?? 0.4) * (1 - visual.R) : 1; // area-aware (see correspondImages)
  const score = 100 * Math.min(base, textRecallCap, imageRecallCap);
  return { score: +score.toFixed(2), blockMatchF2: +blockMatchF2.toFixed(4), R_text: +R_text.toFixed(4), P_text: +P_text.toFixed(4), LLEM: +LLEM.toFixed(4), axes, visualF2: +visual.F2.toFixed(4), imageRecall: +visual.R.toFixed(4), caps: { textRecallCap: +textRecallCap.toFixed(3), imageRecallCap: +imageRecallCap.toFixed(3) }, nSrc: S.length, nClone: C.length, nMatch: matches.length, W_S: +W_S.toFixed(1) };
}

function boxIoU(a, b) { const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h); const iw = Math.max(0, x1 - x0), ih = Math.max(0, y1 - y0); const inter = iw * ih; const uni = a.w * a.h + b.w * b.h - inter; return uni ? inter / uni : 0; }
function correspondImages(srcImgs, cloneImgs, srcSec, cloneSec) {
  if (!srcImgs.length) { const extra = cloneImgs.reduce((a, n) => a + n.box.w * n.box.h, 0); const secA = cloneSec.w * cloneSec.h; return { F2: extra > 0.05 * secA ? 0.6 : 1, R: 1, srcHasImages: false }; }
  const imgW = (n) => Math.max(24, Math.min(280, Math.sqrt(n.box.w * n.box.h)));
  const stem = (s) => (s || '').split('/').pop().split('?')[0].replace(/\.[a-z0-9]+$/i, '');
  const cand = [];
  for (let i = 0; i < srcImgs.length; i++) for (let j = 0; j < cloneImgs.length; j++) {
    const s = srcImgs[i], c = cloneImgs[j]; const sg = normGeo(s.box, srcSec), cg = normGeo(c.box, cloneSec);
    const iou = boxIoU(s.box, c.box) / 1; const geom = 0.55 * Math.min(1, iou) + 0.30 * Math.exp(-0.5 * ((Math.abs(sg.nx - cg.nx) / 0.1) ** 2 + (Math.abs(sg.ny - cg.ny) / 0.1) ** 2)) + 0.15 * Math.exp(-0.5 * (Math.log(Math.max(1e-3, cg.nw) / Math.max(1e-3, sg.nw)) / 0.35) ** 2);
    const sa = (s.natW && s.natH) ? s.natW / s.natH : s.box.w / s.box.h, ca = c.box.w / c.box.h; const aspect = Math.exp(-0.5 * (Math.log(Math.max(0.05, ca) / Math.max(0.05, sa)) / 0.25) ** 2);
    const su = (s.srcURL || s.src || ''), cu = (c.srcURL || c.src || ''); const srcScore = su && cu && su === cu ? 1 : stem(su) && stem(su) === stem(cu) ? 0.85 : (s.natW && c.natW && s.natW === c.natW && s.natH === c.natH ? 0.65 : (!su && !cu ? 0.5 : 0));
    const ps = 0.55 * geom + 0.20 * aspect + 0.15 * srcScore + 0.10 * (s.natW ? 0.8 : 0.5);
    cand.push({ i, j, ps });
  }
  cand.sort((a, b) => b.ps - a.ps); const uS = new Set(), uC = new Set(), m = [];
  for (const p of cand) { if (uS.has(p.i) || uC.has(p.j)) continue; uS.add(p.i); uC.add(p.j); m.push(p); }
  const W_S = srcImgs.reduce((a, n) => a + imgW(n), 0), W_C = cloneImgs.reduce((a, n) => a + imgW(n), 0);
  let Rw = 0, Pw = 0; for (const p of m) { Rw += imgW(srcImgs[p.i]) * p.ps; Pw += Math.min(imgW(cloneImgs[p.j]), 1.25 * imgW(srcImgs[p.i])) * p.ps; }
  const R = W_S ? Rw / W_S : 1, P = W_C ? Pw / W_C : 1; const F2 = (P + R) ? (5 * P * R) / (4 * P + R) : 0;
  // AREA-AWARE image weight: how much of the section is source imagery (clamped 0.6 so imagery never caps below 0.4).
  // Replaces the harsh flat 0.25 floor — a text-dominant section must not be capped to 25 for a missing decorative image.
  // CALIBRATION CAVEAT: validated only on text axes so far; the image cap itself is unvalidated on image-INCLUDING
  // candidates (the cross-val candidates were authored image-less). Missing-LOGO specifically belongs in a Layer-0 veto.
  const secA = Math.max(1, srcSec.w * srcSec.h); const imgAreaFrac = Math.min(0.6, srcImgs.reduce((a, n) => a + n.box.w * n.box.h, 0) / secA);
  return { F2, R, srcHasImages: true, imgAreaFrac };
}

// ── whole-page wrapper: segment → greedy align by order → per-section correspond → source-weight aggregate ────────
export function gradeCorrespondence(srcTree, cloneTree, opts = {}) {
  const sL = flatten(srcTree), cL = flatten(cloneTree);
  const sPage = { x: 0, y: 0, w: srcTree.vw || 1440, h: srcTree.pageH || Math.max(...sL.map((n) => n.box ? n.box.y + n.box.h : 0), 1) };
  const cPage = { x: 0, y: 0, w: cloneTree.vw || 1440, h: cloneTree.pageH || Math.max(...cL.map((n) => n.box ? n.box.y + n.box.h : 0), 1) };
  const pageBg = (t, l) => (t.root && t.root.bgSampled) || (t.root && t.root.background && t.root.background.color) || 'rgb(255,255,255)';
  const ctx = { srcPageBg: pageBg(srcTree), clonePageBg: pageBg(cloneTree), textOnly: !!opts.textOnly };
  const sSecs = segmentSections(sL, sPage), cSecs = segmentSections(cL, cPage);
  // greedy align by normalized y-order (Needleman-Wunsch is the documented upgrade).
  const cByY = cSecs.map((s, i) => ({ i, ny: (s.box.y + s.box.h / 2) / cPage.h })).sort((a, b) => a.ny - b.ny);
  const usedC = new Set(); const perSec = [];
  for (const ss of sSecs) { const sny = (ss.box.y + ss.box.h / 2) / sPage.h; let best = -1, bd = 1e9;
    for (const cc of cByY) { if (usedC.has(cc.i)) continue; const d = Math.abs(cc.ny - sny); if (d < bd) { bd = d; best = cc.i; } }
    if (best >= 0 && bd <= 0.18) { usedC.add(best); perSec.push(correspondSection(ss.leaves, cSecs[best].leaves, ss.box, cSecs[best].box, ctx)); }
    else perSec.push({ score: 0, R_text: 0, LLEM: 0, blockMatchF2: 0, axes: { existence: 0, text: 0, position: 0, color: 0, typography: 0 }, W_S: ss.leaves.reduce((a, n) => a + (isText(n) ? textWeight({ ...n, kind: n.kind }) : 0), 0), unmatchedSection: true });
  }
  const totW = perSec.reduce((a, s) => a + (s.W_S || 0), 0) || 1;
  const score = perSec.reduce((a, s) => a + (s.W_S || 0) * s.score, 0) / totW;
  const axisAgg = {}; for (const k of ['existence', 'text', 'position', 'color', 'typography']) axisAgg[k] = +(perSec.reduce((a, s) => a + (s.W_S || 0) * (s.axes ? s.axes[k] : 0), 0) / totW).toFixed(4);
  return { score: +score.toFixed(2), axes: axisAgg, nSections: perSec.length, matchedSections: perSec.filter((s) => !s.unmatchedSection).length, sections: perSec.map((s) => ({ score: s.score, R_text: s.R_text, LLEM: s.LLEM, color: s.axes && s.axes.color, unmatched: !!s.unmatchedSection })) };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const IS_MAIN = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (IS_MAIN) { const a = (k) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : null; };
  const src = JSON.parse(fs.readFileSync(a('source'), 'utf8')), cln = JSON.parse(fs.readFileSync(a('clone'), 'utf8'));
  const r = gradeCorrespondence(src, cln);
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else { console.log(`correspondence score: ${r.score}/100  (${r.matchedSections}/${r.nSections} sections matched)`); console.log('axes:', JSON.stringify(r.axes)); }
}
