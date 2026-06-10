#!/usr/bin/env node
/**
 * @purpose PER-SECTION REFINE LOOP on the sectionVisual vehicle (PATH_TO_TRUE_1TO1 §C round 3). Reads the
 * latest sections.json for band definitions, runs a named OPERATOR per band to propose tree mutations, scores
 * every candidate on a scratch page via sectionvisual.mjs, and keeps a candidate ONLY behind anti-deletion
 * gates. Without --apply it is PURE PROPOSAL MODE: the graded page receives GETs only; candidates render and
 * score on a tag-swept scratch duplicate; the report says what WOULD be kept.
 *
 * DESIGN DECISIONS:
 *  1. SAME-CHANNEL BASELINE — the keep gates compare a candidate against a sectionVisual run of the CURRENT
 *     working tree on the SAME scratch page/src-cache/capture path (round 0 of each band), NEVER against the
 *     full-page perSection numbers (those carry up to ±0.04 cross-channel divergence per the
 *     _sectionvisual-selftest tolerance — they'd swamp the +0.01 keep threshold). sections.json supplies band
 *     DEFINITIONS + ranking only.
 *  2. ANTI-DELETION KEEP GATES (the critic's measured exploit, pinned by _refine-sections-selftest.mjs:
 *     deleting the tailwind hero heading RAISED band visual +0.046 while band-local editability fell
 *     0.889→0.778). A candidate is kept ONLY if ALL hold, band-local scope:
 *       visual        > baseline.visual + KEEP_MIN_GAIN (0.01)
 *       matchedTexts  >= baseline.matchedTexts   (absolute count of source band texts reproduced — integer,
 *                                                 deletion-sensitive, zero render noise; srcTextCount frozen)
 *       editability   >= baseline.editability - EDIT_TOL (0.005)
 *       no NEW contentVoid firing · no NEW rasteredText firing · candidate gradable
 *     All gates are evaluated without short-circuit so a rejection reports EVERY failed gate.
 *  3. IDENTITY REJECTION — a candidate whose JSON equals the working tree is rejected as 'identity-no-op'
 *     WITHOUT a render (deterministic; also sidesteps joist's 422 unchanged-tree guard). The shipped 'noop'
 *     operator exercises exactly this path → zero keeps, zero renders beyond baselines.
 *  4. WORKING-TREE ACCUMULATION = THE UNION — a kept candidate becomes the working tree; later bands refine on
 *     top of earlier keeps; the final working tree IS "the union of kept band mutations" applied in ONE CAS PUT.
 *  5. OPERATORS map is the extension point: operator = pure function
 *     (tree, band, layout, captureData, {iteration, baseline, last}) → mutated tree or null. The loop hands the
 *     operator a DEEP CLONE (in-place mutation safe). 3-candidate cap per band (1D-Bench plateau precedent).
 *     This round ships ONE real operator: 'split-bg' (split-rect-at-vertical-bg-discontinuity, operator #1).
 *     It finds an in-band node painting ONE solid bg whose rows span a vertical bg-discontinuity in the SOURCE
 *     (row-dominant-luma jump > 60, the _bgsample guard logic localized to a row), and SPLITS that bg paint in
 *     two at the discontinuity row: the node's own bg is neutralized to transparent and two pure bg rects —
 *     each carrying the MEAN color of its own region's dominant 4-bit bucket, sampled from the frozen source
 *     screenshot — are inserted immediately BEFORE the node (same z0; the node + its text paint over them in
 *     DOM order; everything previously hidden under the node stays hidden under the rects). Texts/medias are
 *     never moved or removed → the anti-deletion gates judge pure bg-paint changes. Candidates are restricted
 *     to nodes fully inside the band rows (±16px) so a repaint can never leak outside what the band gates see.
 *     A kept split composes: each piece is itself a solid-bg rect the next iteration may split again.
 *  6. --apply (graded-page write, the ONLY one, hard-railed): after ALL bands are judged and only when
 *     something was kept — save the full pre-state tree+page_settings+hash to /tmp/refine-prestate-<page>.json
 *     FIRST, then ONE CAS PUT (expected_hash, 409 retry) of the union, then a full-page grade-sections re-grade.
 *     If the re-graded composite DROPS more than APPLY_REVERT_EPS (0.02 — band noise averages down over ~15+
 *     bands; single-band visual noise is ±0.08 but the deterministic terms aren't) below the baseline
 *     sections.json composite, AUTO-REVERT from the prestate and report the discrepancy. One-command revert any
 *     time later: node refine-sections.mjs --revert /tmp/refine-prestate-<page>.json
 *     NOTE: the apply/revert PUT is deliberately NOT routed through scratch-harness (whose guard refuses corpus
 *     writes by design); it lives in casPutPage() and is reachable ONLY from the --apply/--revert paths.
 *
 * RAILS: JOIST_AUTH_B64 read silently (env or /tmp/joist-auth.env), never printed. Graded pages: GET-only in
 * proposal mode (verified by hash before/after). All scratch writes via scratch-harness (tag-swept,
 * signal-trapped, crash-forensics). One scratch page per run, PUTs serialized.
 *
 * CLI:
 *   node refine-sections.mjs --page <cloneId> --source <url> [--bands 9,10 | y0-y1,…] [--operator split-bg]
 *        [--sections /tmp/gsec/sections.json] [--layout file] [--out /tmp/refine-sections] [--max-iters 3]
 *        [--apply] [--keep]
 *   node refine-sections.mjs --revert /tmp/refine-prestate-<page>.json
 *   exit codes: 0 ok · 2 usage · 3 infra
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';
import { chromium } from 'playwright';
import { W } from './grade-sections.mjs';
import { createScratch, deletePage, sweep, BASE, CORPUS } from './scratch-harness.mjs';
import { sectionVisual, prepare, api, liveHash } from './sectionvisual.mjs';
// (discontinuity DETECTION mirrors _bgsample.mjs's vertical-discontinuity guard, localized to a row — see the
// split-bg operator below; the bucket-mean color sampler is local because bucket-CENTER colors can miss the
// grader's Lab ΔE<8 exact-pixel window on dark panels.)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_MAIN = process.argv[1] && process.argv[1].endsWith('refine-sections.mjs');

export const KEEP_MIN_GAIN = 0.01;   // bandVisual must beat baseline by MORE than this (repeat noise <=0.015)
export const EDIT_TOL = 0.005;       // band-local editability tolerance (3-decimal rounding head-room)
export const MAX_ITERS = 3;          // hard candidate cap per band (1D-Bench plateau precedent)
export const APPLY_REVERT_EPS = 0.02; // full-page composite drop beyond this after --apply → auto-revert

class InfraError extends Error {}
const infra = (msg) => new InfraError(msg);
const clone = (x) => JSON.parse(JSON.stringify(x));
export const prestatePath = (pageId) => `/tmp/refine-prestate-${pageId}.json`;

// ---- KEEP GATES (pure, exported, unit-pinned by _refine-sections-selftest.mjs). No short-circuit: a
// rejection names EVERY failed gate. Band-local scope only — never full-page numbers. ----
export function keepGate(base, cand) {
  const gates = {
    gradable: !!cand.gradable,
    visual: cand.visual > base.visual + KEEP_MIN_GAIN,
    textCoverage: (cand.matchedTexts ?? 0) >= (base.matchedTexts ?? 0),
    editability: (cand.editability ?? 1) >= (base.editability ?? 1) - EDIT_TOL,
    noNewVoid: !(cand.contentVoid && !base.contentVoid),
    noNewRastered: !(cand.rasteredText && !base.rasteredText),
  };
  const failed = Object.keys(gates).filter((k) => !gates[k]);
  return {
    keep: failed.length === 0, gates, failed,
    deltas: {
      visual: +(cand.visual - base.visual).toFixed(3),
      matchedTexts: (cand.matchedTexts ?? 0) - (base.matchedTexts ?? 0),
      editability: +((cand.editability ?? 1) - (base.editability ?? 1)).toFixed(3),
    },
  };
}

// ---- OPERATORS (the extension point). operator(tree, band, layout, captureData, x) → mutated tree | null.
// tree: DEEP CLONE of the working tree (elements array) — in-place mutation is safe.
// band: {y0,y1,idx?} · layout: parsed --layout JSON or null · captureData: {srcShot, srcTexts, boxIndex, W,
// pageSettings} · x: {iteration (1-based), baseline (band report), last {report,decision}|null}. ----
export const OPERATORS = {};
export function registerOperator(name, fn) { OPERATORS[name] = fn; }

// noop — returns the tree unchanged; the loop's identity check rejects it pre-render. Proves "the loop keeps
// nothing when the operator does nothing" (gate 3 of this round).
registerOperator('noop', (tree) => tree);

// ---- split-bg helpers ----
const parseColor = (s) => {
  if (!s) return null; s = String(s).trim();
  let m = s.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) return [+m[1], +m[2], +m[3]];
  m = s.match(/^#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (m) { const h = m[1]; return h.length === 3 ? [...h].map((c) => parseInt(c + c, 16)) : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  return null;
};
const rgbDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const paintedColorOf = (n) => {
  const s = (n && n.settings) || {};
  if (typeof s.html === 'string') { const m = s.html.match(/background(?:-color)?:\s*(rgba?\([^)]+\)|#[0-9a-f]{3,8})/i); if (m) return m[1]; }
  if (typeof s.background_color === 'string' && s.background_color) return s.background_color;
  return null;
};
const extentOf = (n, boxes) => {
  if (n.id && boxes && boxes[n.id]) { const b = boxes[n.id]; return { x: b.x, y: b.y, w: Math.max(1, b.w), h: Math.max(1, b.h) }; }
  const s = (n && n.settings) || {};
  const y = (s._offset_y && typeof s._offset_y.size === 'number') ? s._offset_y.size : 0;
  const x = (s._offset_x && typeof s._offset_x.size === 'number') ? s._offset_x.size : 0;
  let h = (s.min_height && typeof s.min_height.size === 'number') ? s.min_height.size : 0;
  if (!h && typeof s.html === 'string') { const m = s.html.match(/height:\s*(\d+(?:\.\d+)?)px/); if (m) h = +m[1]; }
  const w = (s._element_custom_width && typeof s._element_custom_width.size === 'number') ? s._element_custom_width.size : W;
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
};
const newElId = () => Math.random().toString(16).slice(2, 9).padEnd(7, '0');

// split-bg — split-rect-at-vertical-bg-discontinuity (operator #1; tailwind §10 flat-dark code-panel lever).
// DETECT (all SOURCE-evidenced from the frozen capture, no invention): for each top-level node painting ONE
// parseable solid bg whose rows lie fully inside the band (±16px) with >=60px of band overlap, build a per-row
// dominant-4-bit-bucket LUMA profile of the SOURCE over the node's rows (the _bgsample vertical-discontinuity
// guard, localized to a row). Adjacent-row jumps > 60 luma (clustered: keep only the strongest within 12px) are
// vertical bg-discontinuities the node's single paint spans.
// MUTATE: split the bg paint in two at the discontinuity row — neutralize the node's own bg (html `background:`
// decl → transparent, or background_color → '') and insert TWO pure bg rects covering [top..ySplit) and
// [ySplit..bottom) immediately BEFORE the node (same z0; the node and its text paint over them in DOM order).
// Each rect's color = MEAN of its own region's dominant source bucket (bucket-center would miss the grader's
// Lab ΔE<8 exact-pixel window on dark panels). Text/medias never move → anti-deletion gates judge bg only.
// Candidate ranking: jump strength × overlapped rows; pick index = x.rejected (advances past rejected
// candidates on an unchanged tree, resets to the strongest after a keep — kept pieces are themselves
// splittable next iteration). Requires the repaint to actually differ (>25 RGB) from the current paint.
const SPLITBG = { minOverlap: 60, insideEps: 16, jumpLuma: 60, clusterPx: 12, minPiece: 8, repaintDist: 25, rowStep: 2 };
const rowDomKey = (shot, y, x0, x1, sx) => {
  const m = new Map(); const row = y * shot.width * 4;
  for (let xx = x0; xx < x1; xx += sx) { const i = row + xx * 4; const k = (shot.data[i] >> 4) + ',' + (shot.data[i + 1] >> 4) + ',' + (shot.data[i + 2] >> 4); m.set(k, (m.get(k) || 0) + 1); }
  let best = null, bc = 0; for (const [k, c] of m) if (c > bc) { bc = c; best = k; }
  return best;
};
const lumaOfKey = (k) => { const [r, g, b] = k.split(',').map((v) => +v * 16 + 8); return 0.299 * r + 0.587 * g + 0.114 * b; };
// mean RGB of the dominant 4-bit bucket over a region of the source shot (null if degenerate)
const meanDominantRgb = (shot, x0, ya, x1, yb) => {
  ya = Math.max(0, ya | 0); yb = Math.min(shot.height, yb | 0);
  if (yb - ya < 2 || x1 - x0 < 8) return null;
  const sx = Math.max(2, ((x1 - x0) / 50) | 0), sy = Math.max(1, ((yb - ya) / 200) | 0);
  const cnt = new Map(), acc = new Map();
  for (let y = ya; y < yb; y += sy) { const row = y * shot.width * 4;
    for (let xx = x0; xx < x1; xx += sx) { const i = row + xx * 4;
      const r = shot.data[i], g = shot.data[i + 1], b = shot.data[i + 2];
      const k = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4);
      cnt.set(k, (cnt.get(k) || 0) + 1);
      const a = acc.get(k) || [0, 0, 0]; a[0] += r; a[1] += g; a[2] += b; acc.set(k, a);
    } }
  let best = null, bc = 0; for (const [k, c] of cnt) if (c > bc) { bc = c; best = k; }
  if (!best) return null;
  const a = acc.get(best);
  return [Math.round(a[0] / bc), Math.round(a[1] / bc), Math.round(a[2] / bc)];
};
const neutralizeBg = (n) => { // remove the node's own solid bg paint (the inserted rects take over)
  const s = n.settings || (n.settings = {});
  if (typeof s.html === 'string' && /background(?:-color)?\s*:\s*(?:rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/i.test(s.html)) {
    s.html = s.html.replace(/background(?:-color)?\s*:\s*(?:rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/i, 'background:transparent');
  } else if (typeof s.background_color === 'string') s.background_color = '';
};
const bgPieceRect = (x0, w, ya, yb, rgb, tag) => ({
  id: newElId(), elType: 'widget', widgetType: 'html', isInner: false, elements: [],
  settings: {
    html: `<div style="width:${w}px;max-width:100%;height:${Math.max(1, Math.round(yb - ya))}px;background-color:rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})"></div>`,
    _element_id: `bgs-rs-${tag}`,
    _position: 'absolute',
    _offset_orientation_h: 'start', _offset_x: { unit: 'px', size: Math.round(x0) }, _offset_x_end: { unit: 'px', size: 0 },
    _offset_orientation_v: 'start', _offset_y: { unit: 'px', size: Math.round(ya) }, _offset_y_end: { unit: 'px', size: 0 },
    _element_width: 'initial', _element_custom_width: { unit: 'px', size: w },
    _z_index: '0',
  },
});
registerOperator('split-bg', (tree, band, layout, cap, x) => {
  const root = Array.isArray(tree) ? tree[0] : tree;
  if (!root || !Array.isArray(root.elements)) return null;
  const { y0, y1 } = band;
  const shot = cap && cap.srcShot; if (!shot) return null;
  const boxes = cap.boxIndex && cap.boxIndex.boxes;
  const cands = [];
  for (let ci = 0; ci < root.elements.length; ci++) {
    const n = root.elements[ci];
    const paintedStr = paintedColorOf(n); const painted = parseColor(paintedStr);
    if (!painted) continue;
    const e = extentOf(n, boxes);
    const eTop = e.y, eBot = e.y + e.h;
    if (eTop < y0 - SPLITBG.insideEps || eBot > y1 + SPLITBG.insideEps) continue; // band-local repaint only
    const ovTop = Math.max(eTop, y0), ovBot = Math.min(eBot, y1, shot.height);
    if (ovBot - ovTop < SPLITBG.minOverlap) continue;
    const x0 = Math.max(0, Math.round(e.x) + 8), x1 = Math.min(W, Math.round(e.x + e.w) - 8);
    if (x1 - x0 < 32) continue;
    const sx = Math.max(2, ((x1 - x0) / 50) | 0);
    // row-dominant-luma profile over the node's in-band rows → discontinuity jumps
    let prevY = null, prevL = null; const jumps = [];
    for (let y = (ovTop | 0) + 1; y < ovBot - 1; y += SPLITBG.rowStep) {
      const k = rowDomKey(shot, y, x0, x1, sx); if (!k) continue;
      const L = lumaOfKey(k);
      if (prevL != null) { const d = Math.abs(L - prevL); if (d > SPLITBG.jumpLuma) jumps.push({ d, y: Math.round((y + prevY) / 2) }); }
      prevL = L; prevY = y;
    }
    jumps.sort((a, b) => b.d - a.d);
    const kept = []; // cluster: strongest wins within clusterPx
    for (const j of jumps) if (!kept.some((kj) => Math.abs(kj.y - j.y) < SPLITBG.clusterPx)) kept.push(j);
    for (const j of kept) {
      if (j.y - eTop < SPLITBG.minPiece || eBot - j.y < SPLITBG.minPiece) continue;
      const topRgb = meanDominantRgb(shot, x0, eTop, x1, j.y);
      const botRgb = meanDominantRgb(shot, x0, j.y, x1, eBot);
      if (!topRgb || !botRgb) continue;
      // the split must actually repaint something — at least one piece differs from the current paint
      if (Math.max(rgbDist(topRgb, painted), rgbDist(botRgb, painted)) <= SPLITBG.repaintDist) continue;
      cands.push({ ci, id: n.id, ySplit: j.y, score: j.d * (ovBot - ovTop), e, topRgb, botRgb, painted: paintedStr });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const pick = cands[x && typeof x.rejected === 'number' ? x.rejected : 0];
  if (!pick) return null;
  const n = root.elements[pick.ci];
  neutralizeBg(n);
  const w = Math.round(pick.e.w), tag = `${pick.id || pick.ci}-${pick.ySplit}`;
  root.elements.splice(pick.ci, 0,
    bgPieceRect(pick.e.x, w, pick.e.y, pick.ySplit, pick.topRgb, `${tag}-t`),
    bgPieceRect(pick.e.x, w, pick.ySplit, pick.e.y + pick.e.h, pick.botRgb, `${tag}-b`));
  return tree;
});

// ---- band resolution from sections.json ----
export function resolveBands({ bandsArg, sectionsPath, secReport }) {
  const per = (secReport && secReport.perSection) || [];
  const byIdx = new Map(per.map((s) => [s.idx, s]));
  if (bandsArg) {
    return String(bandsArg).split(',').map((tok) => {
      tok = tok.trim();
      if (/^\d+-\d+$/.test(tok)) { const [a, b] = tok.split('-').map(Number); return { idx: null, y0: a, y1: b }; }
      if (/^\d+$/.test(tok)) {
        const s = byIdx.get(Number(tok));
        if (!s) throw new Error(`--bands ${tok}: section idx not found in ${sectionsPath}`);
        return { idx: s.idx, y0: s.y0, y1: s.y1 };
      }
      throw new Error(`bad band token '${tok}' (want a perSection idx or y0-y1)`);
    });
  }
  // default: worst-severity FAILING gradable bands, top 5
  return per.filter((s) => s.verdict === 'fail' && s.y1 - s.y0 >= 20)
    .sort((a, b) => (b.severity || 0) - (a.severity || 0)).slice(0, 5)
    .map((s) => ({ idx: s.idx, y0: s.y0, y1: s.y1 }));
}

const summarize = (r) => ({
  visual: r.visual, ssim: r.ssim, exact: r.exact, matchedTexts: r.matchedTexts, srcTextCount: r.srcTextCount,
  editability: r.editability, contentVoid: r.contentVoid, rasteredText: r.rasteredText, gradable: r.gradable,
});

// ---- THE LOOP ----
export async function refineSections(opts) {
  const {
    source, pageId, bands, operatorName = 'split-bg', apply = false,
    sectionsPath = null, secReport = null, layoutPath = null,
    outDir = `/tmp/refine-sections/${opts.pageId}`, maxIters = MAX_ITERS, ctx = null, keepScratch = false,
  } = opts;
  if (!source || !pageId || !Array.isArray(bands) || !bands.length) throw new Error('refineSections: need source, pageId, bands[]');
  const op = OPERATORS[operatorName];
  if (!op) throw new Error(`unknown operator '${operatorName}' (have: ${Object.keys(OPERATORS).join(', ')})`);
  fs.mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  let layout = null;
  if (layoutPath) { try { layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8')); } catch { console.error(`[refine] --layout ${layoutPath} unreadable → operators get null layout`); } }

  let myBrowser = null, useCtx = ctx, scratch = null;
  const report = {
    source, page: Number(pageId), operator: operatorName, mode: apply ? 'apply' : 'proposal',
    sectionsPath, bands, maxIters, keepGates: { KEEP_MIN_GAIN, EDIT_TOL }, perBand: [], keeps: [],
    totalCandidates: 0, totalKept: 0, gradedHashBefore: null, gradedHashAfter: null,
    gradedUntouchedPreApply: null, apply: null,
  };
  try {
    if (!useCtx) {
      myBrowser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
      useCtx = await myBrowser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
      await useCtx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    }
    report.gradedHashBefore = await liveHash(pageId);
    const prep = await prepare({ source, pageId, ctx: useCtx });
    const captureData = { srcShot: prep.srcCache.shot, srcTexts: prep.srcCache.texts, boxIndex: prep.boxIndex, W, pageSettings: prep.pageSettings };
    const made = await createScratch({ title: `refine ${pageId}`, elements: [], pageSettings: prep.pageSettings, template: 'elementor_canvas', srcId: Number(pageId) });
    scratch = { pageId: made.pageId, url: made.url };

    let workingTree = clone(prep.tree); // elements array; kept candidates accumulate here = the union

    for (const band of bands) {
      const tag = `b${band.idx != null ? band.idx : `${band.y0}-${band.y1}`}`;
      const bandRec = { band, baseline: null, candidates: [], kept: 0, skipped: null };
      // round 0: SAME-CHANNEL baseline of the current working tree (decision §1)
      let baseline = await sectionVisual({ source, pageId: Number(pageId), band, prep: { ...prep, tree: workingTree, treeMode: 'working' }, scratch, ctx: useCtx, outDir: path.join(outDir, `${tag}-baseline`) });
      bandRec.baseline = summarize(baseline);
      if (!baseline.gradable) {
        bandRec.skipped = 'baseline-not-gradable';
        report.perBand.push(bandRec);
        console.log(`[refine] ${tag} y${band.y0}-${band.y1}: SKIP (not gradable)`);
        continue;
      }
      console.log(`[refine] ${tag} y${band.y0}-${band.y1}: baseline visual ${baseline.visual} matched ${baseline.matchedTexts}/${baseline.srcTextCount} edit ${baseline.editability}`);
      let last = null, rejected = 0; // rejected = scored-and-rejected count this band (operator pick cursor:
      // advances past rejected candidates on an unchanged tree; resets to 0 after a keep mutates the tree)
      for (let i = 1; i <= maxIters; i++) {
        const candTree = op(clone(workingTree), band, layout, captureData, { iteration: i, baseline, last, rejected });
        if (!candTree) { bandRec.candidates.push({ iteration: i, decision: 'none', reason: 'operator-exhausted' }); break; }
        const candArr = Array.isArray(candTree) ? candTree : [candTree];
        if (JSON.stringify(candArr) === JSON.stringify(workingTree)) { // decision §3
          bandRec.candidates.push({ iteration: i, decision: 'rejected', reason: 'identity-no-op', scored: false });
          console.log(`[refine] ${tag} iter ${i}: identity no-op → rejected without render`);
          break;
        }
        const candFile = path.join(outDir, `${tag}-cand${i}.json`);
        fs.writeFileSync(candFile, JSON.stringify(candArr));
        const candReport = await sectionVisual({ source, pageId: Number(pageId), band, prep: { ...prep, tree: candArr, treeMode: 'candidate' }, scratch, ctx: useCtx, outDir: path.join(outDir, `${tag}-cand${i}`) });
        report.totalCandidates++;
        const g = keepGate(baseline, candReport);
        const rec = { iteration: i, decision: g.keep ? 'kept' : 'rejected', scored: true, gates: g.gates, failedGates: g.failed, deltas: g.deltas, candidate: summarize(candReport), candFile };
        bandRec.candidates.push(rec);
        console.log(`[refine] ${tag} iter ${i}: visual ${baseline.visual}→${candReport.visual} (Δ${g.deltas.visual}) matched Δ${g.deltas.matchedTexts} edit Δ${g.deltas.editability} → ${g.keep ? 'KEEP' : 'REJECT [' + g.failed.join(',') + ']'}`);
        last = { report: candReport, decision: rec };
        if (g.keep) {
          workingTree = candArr; baseline = candReport; bandRec.kept++; rejected = 0;
          report.keeps.push({ band, iteration: i, candFile });
          report.totalKept++;
        } else rejected++;
      }
      report.perBand.push(bandRec);
    }

    report.gradedHashAfter = await liveHash(pageId);
    report.gradedUntouchedPreApply = report.gradedHashBefore === report.gradedHashAfter;
    report.wouldApply = !apply && report.totalKept > 0;

    // ---- APPLY (decision §6): only after ALL bands judged, only when something was kept ----
    if (apply && report.totalKept > 0) {
      report.apply = await applyUnion({ pageId: Number(pageId), source, workingTree, prep, secReport, sectionsPath, outDir });
    } else if (apply) {
      report.apply = { applied: false, reason: 'zero keeps — nothing to apply' };
    }
    report.unionTreeFile = path.join(outDir, 'union-tree.json');
    fs.writeFileSync(report.unionTreeFile, JSON.stringify(workingTree));
  } finally {
    if (scratch) { try { keepScratch ? console.error(`[refine] scratch ${scratch.pageId} KEPT (debug)`) : await deletePage(scratch.pageId, Number(pageId)); } catch (e) { console.error('[refine] scratch release failed (sweep will catch it):', String(e).slice(0, 160)); } }
    if (myBrowser) await myBrowser.close();
  }
  report.totalMs = Date.now() - t0;
  fs.writeFileSync(path.join(outDir, `refine-${pageId}.json`), JSON.stringify(report, null, 2));
  return report;
}

// ---- graded-page CAS PUT — the ONLY write path to a corpus page; reachable ONLY from --apply/--revert.
// Deliberately not routed through scratch-harness (its guard refuses corpus writes by design — see header §6).
async function casPutPage(pageId, elements, pageSettings, intent) {
  let expected = await liveHash(pageId); let r = null;
  for (let a = 0; a < 5; a++) {
    r = await api('PUT', `/wp-json/joist/v1/pages/${pageId}`, { expected_hash: expected, elements, page_settings: pageSettings, intent });
    if (r.status !== 409) break;
    try { expected = r.json.details.current_hash; } catch {}
    await new Promise((res) => setTimeout(res, 400));
  }
  if (!r || !r.ok) throw infra(`graded-page PUT failed: HTTP ${r && r.status} ${String(r && r.text).slice(0, 200)}`);
  const newHash = (r.json && (r.json.new_hash || r.json.hash)) || null;
  const live = await liveHash(pageId);
  if (newHash && live !== newHash) throw infra(`post-PUT live hash != new_hash: ${live} vs ${newHash}`);
  return live;
}

async function applyUnion({ pageId, source, workingTree, prep, secReport, sectionsPath, outDir }) {
  // 1. pre-state saved FIRST (one-command revert: node refine-sections.mjs --revert <file>)
  const pre = await api('GET', `/wp-json/joist/v1/pages/${pageId}?include=elements`);
  const preEls = pre.json && pre.json.elementor && pre.json.elementor.elements;
  const preHash = pre.json && pre.json.elementor && pre.json.elementor.hash;
  if (!pre.ok || !Array.isArray(preEls) || !preHash) throw infra(`cannot snapshot pre-state of ${pageId}: HTTP ${pre.status}`);
  const preFile = prestatePath(pageId);
  fs.writeFileSync(preFile, JSON.stringify({ page: pageId, source, hash: preHash, savedAt: new Date().toISOString(), elements: preEls, pageSettings: prep.pageSettings, revert: `node ${path.join(__dirname, 'refine-sections.mjs')} --revert ${preFile}` }));
  console.log(`[refine] pre-state saved → ${preFile}`);
  // 2. ONE CAS PUT of the union
  const putHash = await casPutPage(pageId, workingTree, prep.pageSettings, 'refine-sections kept-bands union (--apply)');
  console.log(`[refine] APPLIED union to graded page ${pageId} (hash ${putHash})`);
  // 3. full-page re-grade; composite drop > APPLY_REVERT_EPS vs the baseline sections.json → auto-revert.
  // The re-grade inherits this process's GRADER_* env — supply a baseline sections.json produced under the
  // SAME flags or the before/after comparison is cross-mode.
  const regradeDir = path.join(outDir, 'regrade');
  const compositeBefore = secReport ? secReport.composite : null;
  const g = spawnSync(process.execPath, [path.join(__dirname, 'grade-sections.mjs'), '--source', source, '--clone', `${BASE}/?page_id=${pageId}`, '--out', regradeDir], { encoding: 'utf8', timeout: 1800000, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let after = null;
  try { after = JSON.parse(fs.readFileSync(path.join(regradeDir, 'sections.json'), 'utf8')); } catch {}
  if (!after) {
    console.error(`[refine] re-grade FAILED (${String(g.stderr).slice(-300)}) → auto-revert (fail-safe)`);
    const revHash = await casPutPage(pageId, preEls, prep.pageSettings, 'refine-sections auto-revert (regrade failed)');
    return { applied: true, prestateFile: preFile, putHash, compositeBefore, compositeAfter: null, reverted: true, revertHash: revHash, discrepancy: 'regrade-failed' };
  }
  const delta = compositeBefore != null ? +(after.composite - compositeBefore).toFixed(3) : null;
  if (compositeBefore != null && after.composite < compositeBefore - APPLY_REVERT_EPS) {
    console.error(`[refine] DISCREPANCY: kept-bands union dropped full-page composite ${compositeBefore}→${after.composite} (> ${APPLY_REVERT_EPS} noise) → auto-revert`);
    const revHash = await casPutPage(pageId, preEls, prep.pageSettings, 'refine-sections auto-revert (composite drop)');
    return { applied: true, prestateFile: preFile, putHash, compositeBefore, compositeAfter: after.composite, delta, reverted: true, revertHash: revHash, discrepancy: 'band-gains-did-not-transfer-to-full-page', regradeDir };
  }
  return { applied: true, prestateFile: preFile, putHash, compositeBefore, compositeAfter: after.composite, delta, reverted: false, regradeDir };
}

export async function revertFromPrestate(file) {
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!p.page || !Array.isArray(p.elements)) throw new Error(`bad prestate file ${file}`);
  const h = await casPutPage(p.page, p.elements, p.pageSettings || {}, `refine-sections manual revert from ${file}`);
  console.log(`[refine] page ${p.page} reverted from ${file} (hash ${h})`);
  return h;
}

// ---- CLI ----
if (IS_MAIN) (async () => {
  const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
  const has = (n) => process.argv.includes('--' + n);
  if (arg('revert')) { try { await revertFromPrestate(arg('revert')); process.exit(0); } catch (e) { console.error(String(e)); process.exit(3); } }
  const source = arg('source'), pageId = arg('page');
  if (!source || !pageId) { console.error('usage: node refine-sections.mjs --page <id> --source <url> [--bands 9,10|y0-y1,…] [--operator split-bg|noop] [--sections sections.json] [--layout file] [--out dir] [--max-iters 3] [--apply] [--keep]\n       node refine-sections.mjs --revert /tmp/refine-prestate-<page>.json'); process.exit(2); }
  const sectionsPath = arg('sections', '/tmp/gsec/sections.json');
  let secReport = null;
  try { secReport = JSON.parse(fs.readFileSync(sectionsPath, 'utf8')); } catch {}
  if (!secReport && (!arg('bands') || !/^[\d,\s-]+$/.test(arg('bands')) || arg('bands').split(',').some((t) => !t.includes('-')))) {
    console.error(`cannot read ${sectionsPath} — pass --sections (run grade-sections first) or give explicit --bands y0-y1,…`); process.exit(2);
  }
  let bands;
  try { bands = resolveBands({ bandsArg: arg('bands'), sectionsPath, secReport }); } catch (e) { console.error(String(e.message || e)); process.exit(2); }
  if (!bands.length) { console.error('no bands to refine (no failing gradable sections?)'); process.exit(2); }
  try { execSync("pkill -9 -f 'chrome-headless-shell' 2>/dev/null || true", { stdio: 'ignore' }); } catch {}
  try { const sw = await sweep({ maxAgeMin: 60 }); if (sw.deleted.length) console.error(`[refine] swept ${sw.deleted.length} stale scratch page(s)`); } catch {}
  try {
    const report = await refineSections({
      source, pageId: Number(pageId), bands, operatorName: arg('operator', 'split-bg'),
      apply: has('apply'), sectionsPath, secReport, layoutPath: arg('layout'),
      outDir: arg('out', `/tmp/refine-sections/${pageId}`), maxIters: Number(arg('max-iters', MAX_ITERS)), keepScratch: has('keep'),
    });
    console.log(`\n[refine] ${report.mode.toUpperCase()} — ${report.totalKept} kept / ${report.totalCandidates} scored candidates over ${bands.length} band(s); graded page ${report.gradedUntouchedPreApply ? 'UNTOUCHED pre-apply' : 'HASH CHANGED (!)'}${report.apply ? `; apply: ${JSON.stringify({ reverted: report.apply.reverted, compositeBefore: report.apply.compositeBefore, compositeAfter: report.apply.compositeAfter })}` : ''}`);
    console.log(JSON.stringify(report));
    process.exit(0);
  } catch (e) {
    console.error(String(e && e.stack || e));
    process.exit(e instanceof InfraError ? 3 : 1);
  }
})();
