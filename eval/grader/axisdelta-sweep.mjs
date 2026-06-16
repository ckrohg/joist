#!/usr/bin/env node
/**
 * @purpose axisdelta-sweep.mjs — BUILD #4 of the upleveled grader (fusion CONVERGENT@max): RESPONSIVE + MOTION
 * as DELTA-OF-DELTAS through the SAME axis-delta engine. NO new per-defect code — every new signal is the same
 * continuous `excess = max(0, magnitude − floor)` severity the floor/engine already computes, just applied across
 * VIEWPORTS (responsive) and across INTERACTION STATES (motion). The multi-viewport×state sweep is the only new
 * thing; the scoring substrate (applyFloors / lookupFloor / weightOf / salience) is imported UNCHANGED.
 *
 * THE DESIGN (per the #4 mandate):
 *
 *  RESPONSIVE — run the identical diff at widths [1440,768,390] and read the SOURCE-declared @media breakpoints.
 *   • (A) HORIZONTAL-OVERFLOW boolean — the crispest single tell, and it needs NO CORRESPONDENCE: clone box.right
 *     > viewport at 390/768 where the SOURCE has none. Because it reads only the CLONE box (+ a source-side
 *     same-width check to suppress sources that legitimately overflow), it SURVIVES mobile reflow, where the
 *     per-element join itself may break. We read it from report.responsiveSweep.overflowByWidth (stamp-independent,
 *     correspondence-free, computed in compare-capture) and ALSO re-derive per-element so it localizes + carries
 *     salience. The rendered overflow is GROUND TRUTH.
 *   • (B) REFLOW-VECTOR — per matched ref, the change in wFrac (and a column-count proxy) from 1440→narrow. The
 *     SOURCE reflows (wFrac grows toward 1.0 as a multi-col grid collapses to 1 col); a NON-responsive clone stays
 *     flat (wFrac unchanged because the box kept its 1440px width). delta = |srcReflow − cloneReflow|. This uses
 *     ONLY same-ref box[vw] lookups (join-light: tolerant of a few mismatches, no new geometry that assumes a
 *     verified 390 join). Routed through applyFloors (a NEW floored axis).
 *   • The native _tablet/_mobile control ABSENCE — i.e. a SOURCE @media breakpoint OUTSIDE Elementor's native set
 *     {768,480} — is attached as the authoring WHY (metadata `cantReflowHere`), NOT the detector. The overflow
 *     boolean / reflow-vector is what fires; the breakpoint just explains it.
 *   • TRUST AT NARROW: at 390 the per-element join is NOT re-validated, so we do NOT add new geometry severity that
 *     assumes a verified 390 join. The reflow-vector is gated behind a join-confidence check (the pair's 1440 box
 *     exists AND box[narrow] exists AND the source actually reflowed there); where the join cannot be trusted we
 *     fall back to the overflow boolean (page-level + per-clone-element, correspondence-free) + band crops.
 *
 *  MOTION — capture at INTERACTION STATES and diff the STATE-DELTAS source-vs-clone (never a single static read):
 *   • (a) STICKY — Δtop at scrollY=0 vs scrollY=800. Source nav scrolls away (top@800 ≈ −736); a wrongly-pinned
 *     clone stays (top@800 ≈ 0). We diff the SIGN+MAGNITUDE of Δtop source-vs-clone. (The engine already has a
 *     `state-pin` axis off stickySummary; this module additionally emits the explicit Δtop-of-Δtop so the
 *     delta-of-deltas is auditable and fires even when only the per-record scroll state is present.)
 *   • (b) HOVER — parse the source :hover rule set to define the HOVERABLE set (so a control with no source hover
 *     isn't punished), dispatch hover, diff styleDelta. magnitude = |srcHoverDeltaMag − cloneHoverDeltaMag|; source
 *     nontrivial + clone ≈ 0 ⇒ `dead-hover` fires. This is a state-delta-of-state-deltas: each side's hover delta
 *     is itself a (hover − idle) diff; we diff those.
 *   • (c) SCROLL-REVEAL — opacity/transform BEFORE vs AFTER an element enters the viewport. Source AOS/Elementor-
 *     entrance swings 0→1 (opSwing) or translateY→0 (tySwing); a static clone stays. magnitude = |srcSwing −
 *     cloneSwing|. Requires CAPTURE_REVEAL=1 on both captures (states.reveal); silently skipped if absent.
 *
 *  DELTA-OF-DELTAS is the load-bearing invariant for ALL motion axes: we never compare a single static state. We
 *  compute a SOURCE state-delta and a CLONE state-delta and diff THOSE, so an identical self-clone (same states on
 *  both sides) yields a zero delta-of-deltas on every motion axis → the self-clone-across-states falsifier fires 0.
 *
 * ANTI-OVERFIT / SAFETY (inherits the spine's contract):
 *   • All new floors are PERCEPTUAL-PRIOR semantic_min values registered here (SWEEP_SEMANTIC_MIN) + run through
 *     the SAME applyFloors machinery (excess = max(0, magnitude − floor)). No floor is fit to a defect label.
 *   • All new axis WEIGHTS are perceptual priors (SWEEP_W), commensurate with the engine's per-floor-unit scale.
 *   • PURE: reads a cached compare blob only. No network, no host, no builder, no git. Additive/reversible: a new
 *     file; it imports axisdelta-floor/grade-element-crops UNCHANGED and does NOT mutate the engine's existing
 *     scores (it produces its OWN sweep report; callers fold it in behind a flag).
 *   • FLAG: the sweep is OFF unless --sweep / SWEEP_AXES=1 (or run directly). When folded into an existing grader
 *     it must be gated so current callers' numbers are unchanged unless the flag is on.
 *
 * Falsifier: _axisdelta-selfclone-falsifier.mjs --states (the orchestrator re-executes it — builder does NOT
 * self-bless). Inline `--selftest` runs the offline synthetic checks (self-clone fires 0; injected force-static@390
 * fires h-overflow; pinned-sticky fires sticky; killed-hover fires dead-hover).
 *
 * CLI:
 *   node axisdelta-sweep.mjs --compare /tmp/compare-XXX.json [--floors calibration/axis-floors.json] [--json]
 *   node axisdelta-sweep.mjs --selftest          # offline synthetic checks (no capture)
 *   node axisdelta-sweep.mjs --schema            # offline schema dump
 *   node --check axisdelta-sweep.mjs             # syntax check
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as M from './grade-element-crops.mjs';
import * as F from './axisdelta-floor.mjs';
import { salience, weightOf, W_DEFAULT } from './axisdelta-engine.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// NEW AXES — perceptual-prior floors (semantic_min) + weights, commensurate with the engine's per-floor-unit scale.
// These extend the floor machinery additively: the axis magnitude is divided by the floor (multiples of the JND).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export const SWEEP_SEMANTIC_MIN = {
  // h-overflow-bool: a per-width boolean (0|1) that the clone overflows where the source did not. binary → 0.5
  // midpoint so a real overflow trips and a benign sub-2% spill does not (the boolean is already cut at 1.02·vw).
  'h-overflow-bool': 0.5,
  // reflow-vector: |srcReflowFrac − cloneReflowFrac| where reflowFrac = wFrac@narrow − wFrac@wide (signed growth
  // toward full-width). ~12% disagreement is the smallest reliably-visible "stayed flat where it should have
  // stacked" — below it is sub-grid rounding. RATIO unit.
  'reflow-vector': 0.12,
  // sticky-delta: |sign·mag(Δtop_src) − sign·mag(Δtop_clone)| normalized by the scroll distance. A source nav that
  // scrolls away has Δtop ≈ −scrollY; a pinned clone has Δtop ≈ 0. The delta-of-deltas is ≈1.0 normalized. Floor
  // 0.25 = a quarter of the scroll distance (well above scroll jitter, well below a true pin↔scroll flip).
  'sticky-delta': 0.25,
  // hover-dead: |srcHoverMag − cloneHoverMag| on a normalized [0,1] hover-change magnitude (color/bg/transform/
  // shadow/decoration). 0.2 = a fifth of the unit (a real hover restyle is ~0.6–1.0; AA/round-off is ~0.02).
  'hover-dead': 0.2,
  // reveal-missing: |srcSwing − cloneSwing| where swing = max(opacitySwing, normTransformSwing) on entrance. 0.25
  // opacity-equivalent is the smallest reveal a human reliably notices (a true AOS fade is ~1.0).
  'reveal-missing': 0.25,
};
export const SWEEP_W = {
  'h-overflow-bool': 0.55,  // a sideways scrollbar on mobile is a glaring, universally-recognized responsive fault
  'reflow-vector': 0.45,    // "did not reflow" — visible layout fault, recoverable
  'sticky-delta': 0.50,     // wrongly-pinned / wrongly-unpinned nav — matches the engine's state-pin weight
  'hover-dead': 0.40,       // dead hover — clearly perceptible interaction loss, but local + recoverable
  'reveal-missing': 0.40,   // missing scroll-reveal — perceptible motion loss, local
};
export const sweepWeightOf = (axis) => (SWEEP_W[axis] != null ? SWEEP_W[axis] : weightOf(axis));
// Elementor V3/V4 NATIVE responsive breakpoints. A source @media bp outside this set (±32px) is a width the clone
// structurally CANNOT reflow at (Hello+free strips the custom_css @media channel) — the authoring WHY.
export const ELEMENTOR_NATIVE_BP = [768, 480];
export const NATIVE_BP_TOL = 32;

// floor an arbitrary sweep magnitude through the SAME max(0, mag − floor) machinery (semantic_min only — these new
// axes have no symmetric self-clone noise channel; the self-clone falsifier proves they fire 0 on identical input).
export function floorSweep(axis, magnitude, bucket) {
  const floor = SWEEP_SEMANTIC_MIN[axis] != null ? SWEEP_SEMANTIC_MIN[axis] : 0;
  const excess = Math.max(0, magnitude - floor);
  return { axis, magnitude: +Number(magnitude).toFixed(4), floor, excess: +excess.toFixed(4), trip: excess > 0,
    floorUnits: floor > 0 ? +(excess / floor).toFixed(4) : (excess > 0 ? excess : 0), bucket: bucket || 'body' };
}

// ── helpers shared with the engine's geometry reads ──
function boxAt(el, vw) { return el && el.box && (el.box[vw] || el.box[String(vw)]); }
function num(x, d = 0) { const v = parseFloat(x); return isFinite(v) ? v : d; }

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// (1) RESPONSIVE — overflow boolean (correspondence-free) + reflow-vector (join-light).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

// (A) per-CLONE-element horizontal-overflow boolean at a narrow width. Needs NO source correspondence: it reads
// only the clone box.right vs the viewport. We pass the SOURCE page-level overflow-at-this-width to suppress the
// case where the source ITSELF overflows (then a clone overflow is faithful, not a defect). Survives a broken join.
export function overflowRows(blob, vw, sweepInfo) {
  const rows = [];
  const cRecs = blob.cloneCapture.records || [];
  // page-level source-overflow gate (a source that overflows at this width is reproduced faithfully by a clone that
  // does too — do NOT flag). Read from the precomputed responsiveSweep when present, else compute.
  const srcOverflowsPage = sweepInfo ? !!sweepInfo.sourceOverflows
    : (blob.sourceCapture.records || []).some((r) => { const b = boxAt(r, vw); return b && b.right != null && b.right > vw * 1.02; });
  if (srcOverflowsPage) return rows; // faithful — the source overflows here too
  for (const c of cRecs) {
    const b = boxAt(c, vw); if (!b || b.right == null) continue;
    const over = (b.right - vw) / vw;
    if (over <= 0.02) continue; // sub-2% spill = rounding, not a sideways scrollbar
    // binary boolean (1 = overflows) so the floored axis is in {0, >floor}; magnitude carries the px for diagnosis.
    const fl = floorSweep('h-overflow-bool', 1, F.salienceBucket(c, vw));
    if (fl.trip) rows.push({ ref: c.ref, viewport: vw, axis: 'h-overflow-bool', class: 'overflowing-mobile',
      overFrac: +over.toFixed(4), overPx: Math.round(b.right - vw), src: 0, clone: 1, ...fl, relational: false });
  }
  return rows;
}

// (B) reflow-vector per matched ref (join-LIGHT: same-ref box[vw] lookups only; gated on join confidence).
// reflowFrac = wFrac@narrow − wFrac@wide (a box that collapses from a column to full-width grows toward +; a box
// that stays fixed-px shrinks in wFrac → goes negative). A responsive SOURCE has a large positive reflowFrac; a
// NON-responsive CLONE stays near its wide wFrac (small/negative). delta = |srcReflowFrac − cloneReflowFrac| but
// ONLY when the source actually reflowed (so we never punish a box that was full-width on both sides).
export function reflowRows(pairs, joinVw, narrowVw) {
  const rows = [];
  if (narrowVw === joinVw) return rows;
  for (const { ref, sEl, cEl } of pairs) {
    if (!cEl) continue; // presence handled elsewhere; reflow needs a clone box
    const sW = boxAt(sEl, joinVw), sN = boxAt(sEl, narrowVw), cW = boxAt(cEl, joinVw), cN = boxAt(cEl, narrowVw);
    if (!sW || !sN || !cW || !cN) continue; // JOIN-CONFIDENCE: require the box at BOTH widths on BOTH sides
    const sWf = sW.wFrac != null ? sW.wFrac : (sW.w / joinVw), sNf = sN.wFrac != null ? sN.wFrac : (sN.w / narrowVw);
    const cWf = cW.wFrac != null ? cW.wFrac : (cW.w / joinVw), cNf = cN.wFrac != null ? cN.wFrac : (cN.w / narrowVw);
    const srcReflow = sNf - sWf, cloneReflow = cNf - cWf;
    // only a SOURCE that actually reflowed (grew toward full-width by ≥ the floor) can host a "clone stayed flat".
    if (srcReflow < SWEEP_SEMANTIC_MIN['reflow-vector']) continue;
    const delta = Math.abs(srcReflow - cloneReflow);
    const fl = floorSweep('reflow-vector', delta, F.salienceBucket(sEl, narrowVw));
    if (fl.trip) rows.push({ ref, viewport: narrowVw, axis: 'reflow-vector', class: 'not-responsive',
      srcReflow: +srcReflow.toFixed(4), cloneReflow: +cloneReflow.toFixed(4), src: +sWf.toFixed(3), clone: +cWf.toFixed(3),
      ...fl, relational: false });
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// (2) MOTION — state-delta axes diffed source-vs-clone (DELTA-OF-DELTAS).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

// hover-change magnitude on ONE side: the styleDelta is a {prop:{from,to}} map. We map it to a normalized [0,1]
// "how much did hover change this control" scalar: color/bg ΔE (perceptual) + transform present + shadow present +
// decoration/opacity change. A static control (no :hover restyle) → 0. This is each SIDE's (hover − idle) delta.
export function hoverMagnitude(styleDelta) {
  if (!styleDelta || typeof styleDelta !== 'object') return 0;
  let m = 0;
  const cp = (s) => M.parseColor(s);
  const colorChange = (key) => {
    const d = styleDelta[key]; if (!d) return 0;
    const a = cp(d.from), b = cp(d.to); if (!a || !b) return d.from !== d.to ? 0.4 : 0;
    const dE = M.deltaE2000(a, b); return dE == null ? 0 : Math.min(1, dE / 40); // ΔE 40 ≈ full unit
  };
  m = Math.max(m, colorChange('color'));
  m = Math.max(m, colorChange('backgroundColor'));
  m = Math.max(m, colorChange('borderBottomColor'));
  if (styleDelta.transform && styleDelta.transform.from !== styleDelta.transform.to) m = Math.max(m, 0.7);
  if (styleDelta.boxShadow && styleDelta.boxShadow.from !== styleDelta.boxShadow.to) m = Math.max(m, 0.55);
  if (styleDelta.textDecoration && styleDelta.textDecoration.from !== styleDelta.textDecoration.to) m = Math.max(m, 0.45);
  if (styleDelta.opacity && Math.abs(num(styleDelta.opacity.from, 1) - num(styleDelta.opacity.to, 1)) > 0.02) m = Math.max(m, 0.4);
  return +Math.min(1, m).toFixed(4);
}

// (b) HOVER-DEAD: per corresponded interactive control, diff the source hover-delta-magnitude vs the clone
// hover-delta-magnitude. The SOURCE :hover set defines the hoverable set (a control with NO source hover is NOT
// punished — srcMag ≈ 0 → delta ≈ 0 → does not trip). delta = max(0, srcMag − cloneMag) — a one-sided "the clone
// LOST a hover the source had" (a clone that ADDS hover the source lacks is not a fidelity defect here).
export function hoverRows(pairs, joinVw) {
  const rows = [];
  for (const { ref, sEl, cEl } of pairs) {
    if (!cEl) continue;
    const sHover = sEl && sEl.states && sEl.states.hover;
    const cHover = cEl && cEl.states && cEl.states.hover;
    const srcMag = hoverMagnitude(sHover);
    if (srcMag <= 0) continue; // not in the source hoverable set → nothing to lose
    const cloneMag = hoverMagnitude(cHover);
    const delta = Math.max(0, srcMag - cloneMag); // one-sided: clone LOST hover the source had
    const fl = floorSweep('hover-dead', delta, F.salienceBucket(sEl, joinVw));
    if (fl.trip) rows.push({ ref, viewport: joinVw, axis: 'hover-dead', class: 'dead-hover',
      srcHoverMag: srcMag, cloneHoverMag: cloneMag, src: srcMag, clone: cloneMag, ...fl, relational: false });
  }
  return rows;
}

// normalized translate-Y swing magnitude from two transform strings (entrance reveals usually translateY→0).
function transformSwing(t0, t1) {
  const ty = (t) => { if (!t || t === 'none') return 0;
    // matrix(a,b,c,d,e,f) → f is translateY; matrix3d → element 13; translateY(px) explicit.
    let m = /matrix3d\(([^)]+)\)/.exec(t); if (m) { const p = m[1].split(',').map(Number); return p[13] || 0; }
    m = /matrix\(([^)]+)\)/.exec(t); if (m) { const p = m[1].split(',').map(Number); return p[5] || 0; }
    m = /translateY\(([-\d.]+)px\)/.exec(t); if (m) return parseFloat(m[1]);
    m = /translate\(([^,]+),\s*([-\d.]+)px\)/.exec(t); if (m) return parseFloat(m[2]);
    return 0;
  };
  return Math.abs(ty(t1) - ty(t0));
}

// (c) REVEAL-MISSING: per below-fold corresponded element, diff the source entrance SWING vs the clone entrance
// swing. swing = max(opacity swing, normalized translateY swing / 60px). Source AOS/Elementor-entrance → swing ≈ 1;
// a static clone → swing ≈ 0. delta = max(0, srcSwing − cloneSwing) (one-sided: the clone LOST a reveal).
export function revealSwing(reveal) {
  if (!reveal) return 0;
  const op = Math.abs(num(reveal.opacityAfter, 1) - num(reveal.opacityBefore, 1));
  const ty = transformSwing(reveal.transformBefore, reveal.transformAfter) / 60; // 60px translate ≈ full unit
  return +Math.min(1, Math.max(op, ty)).toFixed(4);
}
export function revealRows(pairs, joinVw) {
  const rows = [];
  for (const { ref, sEl, cEl } of pairs) {
    if (!cEl) continue;
    const sReveal = sEl && sEl.states && sEl.states.reveal;
    if (!sReveal) continue; // reveal not captured on the source (CAPTURE_REVEAL off) → skip silently
    const srcSwing = revealSwing(sReveal);
    if (srcSwing <= 0) continue; // source did not reveal here → nothing to lose
    const cloneSwing = revealSwing(cEl.states && cEl.states.reveal);
    const delta = Math.max(0, srcSwing - cloneSwing);
    const fl = floorSweep('reveal-missing', delta, F.salienceBucket(sEl, joinVw));
    if (fl.trip) rows.push({ ref, viewport: joinVw, axis: 'reveal-missing', class: 'missing-scroll-reveal',
      srcSwing, cloneSwing, src: srcSwing, clone: cloneSwing, ...fl, relational: false });
  }
  return rows;
}

// (a) STICKY (explicit delta-of-deltas of Δtop). Source nav Δtop ≈ −scrollY (scrolls away); a wrongly-pinned clone
// Δtop ≈ 0. We diff the NORMALIZED Δtop (Δtop / scrollY) source-vs-clone. This complements the engine's stickySummary
// `state-pin` axis: it reads the per-record states.scroll {top@0, top@<scrollY>} so it fires on the delta-of-deltas
// even when only per-record scroll state is present, and it captures the OPPOSITE error too (a clone that scrolls a
// nav the source PINNED). One event per corresponded top-band nav/header whose Δtop sign+mag mismatches.
export function stickyRows(pairs, joinVw, scrollY) {
  const rows = [];
  const SK = `top@${scrollY}`;
  const dtopNorm = (sc) => { if (!sc) return null; const t0 = sc['top@0'], tY = sc[SK];
    if (t0 == null || tY == null) return null; return (tY - t0) / Math.max(1, scrollY); }; // -1 = scrolled fully away, 0 = pinned
  for (const { ref, sEl, cEl } of pairs) {
    if (!cEl) continue;
    const sScroll = sEl && sEl.states && sEl.states.scroll;
    const cScroll = cEl && cEl.states && cEl.states.scroll;
    const sD = dtopNorm(sScroll), cD = dtopNorm(cScroll);
    if (sD == null || cD == null) continue; // need a scroll probe on BOTH sides
    // only consider TOP-BAND elements (a nav/header) — a mid-page sticky aside is out of scope for this axis.
    const sb = boxAt(sEl, joinVw); if (!sb || (sb.y != null && sb.y > 200)) continue;
    const delta = Math.abs(sD - cD); // delta-of-deltas of the normalized Δtop
    const fl = floorSweep('sticky-delta', delta, 'nav');
    if (fl.trip) {
      const cls = (Math.abs(cD) < 0.25 && Math.abs(sD) >= 0.5) ? 'wrongly-sticky'
        : (Math.abs(sD) < 0.25 && Math.abs(cD) >= 0.5) ? 'wrongly-unsticky' : 'sticky-mismatch';
      rows.push({ ref, viewport: joinVw, axis: 'sticky-delta', class: cls,
        srcDtopNorm: +sD.toFixed(3), cloneDtopNorm: +cD.toFixed(3), src: +sD.toFixed(3), clone: +cD.toFixed(3), ...fl, relational: false });
    }
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// THE SWEEP — runs all new axes over a compare blob; returns floored rows + per-axis severity + a sweep score.
// severity per row = salience × sweepWeight(axis) · floorUnits, squashed (1 − e^−Σ) per ref. Mirrors the engine.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function runSweep(blob, floorsObj, { widths = null } = {}) {
  const report = blob.report;
  const floors = (floorsObj && (floorsObj.floors || floorsObj)) || {};
  const srcRecs = blob.sourceCapture.records || [];
  const WIDTHS = widths || (report.widths || [1440]).filter((w) => srcRecs.some((r) => r.box && (r.box[w] || r.box[String(w)])));
  const joinVw = WIDTHS[0];
  const narrowVws = WIDTHS.slice(1);
  const scrollY = report.scrollY || 800;
  const pageH = (report.pageHeightByVw && report.pageHeightByVw.source) || {};

  const rows = []; // every tripped sweep row (responsive + motion)
  const meta = { axesFired: {}, why: {} };

  // ── per-element correspondence pairs at the join width (motion axes live at the join width) ──
  let joinPairs = [];
  try { joinPairs = M.readPairs(blob, joinVw).pairs; } catch (e) { joinPairs = []; }
  const presentJoinPairs = joinPairs.filter((p) => p.cEl);

  // RESPONSIVE — overflow boolean (correspondence-free) + reflow-vector (join-light) at each narrow width.
  const sweepByW = (report.responsiveSweep && report.responsiveSweep.overflowByWidth) || {};
  for (const vw of narrowVws) {
    const info = sweepByW[vw] || sweepByW[String(vw)] || null;
    for (const r of overflowRows(blob, vw, info)) rows.push(r);
    // reflow-vector needs the join pairs but looked up at THIS narrow width.
    let narrowPairs = joinPairs;
    for (const r of reflowRows(narrowPairs, joinVw, vw)) rows.push(r);
  }
  // authoring WHY: source @media breakpoints outside Elementor's native set = widths the clone can't reflow at.
  const srcBps = (report.responsiveSweep && report.responsiveSweep.sourceMediaBreakpoints)
    || (blob.sourceCapture.mediaBreakpoints) || [];
  const unreflowable = srcBps.filter((bp) => !ELEMENTOR_NATIVE_BP.some((nb) => Math.abs(bp - nb) <= NATIVE_BP_TOL));
  meta.why.sourceMediaBreakpoints = srcBps;
  meta.why.unreflowableSourceBreakpoints = unreflowable; // attached to responsive defects as cantReflowHere
  meta.why.note = 'unreflowableSourceBreakpoints = native _tablet/_mobile control absence (the authoring WHY); the rendered overflow / reflow-miss is the detector.';

  // MOTION — sticky (delta-of-Δtop), hover-dead, reveal-missing, all at the join width on present pairs.
  for (const r of stickyRows(presentJoinPairs, joinVw, scrollY)) rows.push(r);
  for (const r of hoverRows(presentJoinPairs, joinVw)) rows.push(r);
  for (const r of revealRows(presentJoinPairs, joinVw)) rows.push(r);

  // ── severity per ref (salience × Σ sweepW·floorUnits, squashed), mirroring the engine ──
  const sByRef = Object.fromEntries(srcRecs.map((s) => [s.ref, s]));
  const byRef = new Map();
  for (const r of rows) {
    meta.axesFired[r.axis] = (meta.axesFired[r.axis] || 0) + 1;
    const k = `${r.ref}@${r.viewport}`;
    (byRef.get(k) || byRef.set(k, []).get(k)).push(r);
  }
  const events = [];
  for (const [k, rs] of byRef) {
    const ref = rs[0].ref, vw = rs[0].viewport;
    const sEl = sByRef[ref] || null;
    const isNav = rs.some((r) => r.axis === 'sticky-delta');
    const sal = isNav ? 2.0 : (sEl ? salience(sEl, vw, pageH[vw] || pageH[String(vw)] || 0) : 1.2);
    let acc = 0; const contrib = [];
    for (const r of rs) { if (!(r.floorUnits > 0)) continue; const w = sweepWeightOf(r.axis); const c = w * r.floorUnits; acc += c;
      contrib.push({ axis: r.axis, class: r.class, floorUnits: r.floorUnits, weight: w, contribution: +c.toFixed(4) }); }
    const sev = +Math.min(1, (1 - Math.exp(-acc)) * Math.min(3, sal)).toFixed(4);
    const firedAxes = [...new Set(rs.map((r) => r.axis))];
    // attach the authoring WHY to responsive events (cantReflowHere), not to motion events.
    const isResponsive = firedAxes.some((a) => a === 'h-overflow-bool' || a === 'reflow-vector');
    events.push({ ref, viewport: vw, class: rs[0].class, firedAxes, severity: sev, salience: +sal.toFixed(3),
      magnitudes: contrib, rows: rs.map((r) => ({ axis: r.axis, magnitude: r.magnitude, floor: r.floor, excess: r.excess, floorUnits: r.floorUnits, class: r.class })),
      cantReflowHere: isResponsive && unreflowable.length ? unreflowable : undefined,
      axisDomain: isResponsive ? 'responsive' : 'motion', noLabelFit: true });
  }
  events.sort((a, b) => b.severity - a.severity);

  // sweep score = salience-weighted keep (mirrors the engine's aggregation, additive — a separate score the caller
  // folds in behind the flag; it does NOT replace the engine's pageScore).
  const sevs = events.map((e) => e.severity).filter((s) => s > 0);
  const meanKeep = sevs.length ? 1 - sevs.reduce((a, s) => a + s, 0) / sevs.length : 1;
  const worst = sevs.slice().sort((a, b) => b - a).slice(0, 3);
  const worstDrag = worst.length ? worst.reduce((a, s) => a + s, 0) / worst.length : 0;
  const sweepScore = +Math.max(0, Math.min(1, 0.55 * meanKeep + 0.45 * (1 - worstDrag))).toFixed(4);

  const byClass = {}; for (const e of events) byClass[e.class] = (byClass[e.class] || 0) + 1;
  return {
    meta: { source: report.source, clone: report.clone, widths: WIDTHS, joinVw, narrowVws, scrollY,
      revealCaptured: srcRecs.some((r) => r.states && r.states.reveal), noLabelFit: true, ...meta },
    sweepScore,
    events,
    byClass,
    byAxis: meta.axesFired,
    aggregate: { events: events.length, responsiveEvents: events.filter((e) => e.axisDomain === 'responsive').length,
      motionEvents: events.filter((e) => e.axisDomain === 'motion').length,
      fatalEvents: events.filter((e) => e.severity >= 0.6).length, meanKeep: +meanKeep.toFixed(4), worstDrag: +worstDrag.toFixed(4) },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// OFFLINE SELFTEST — synthetic fixtures (no capture). Proves the 4 mandated checks:
//   (i)  self-clone across STATES + WIDTHS fires ZERO sweep defects (the false-positive discipline gate).
//   (ii) injected force-static@390 (clone keeps 1440 width / overflows) fires h-overflow-bool + reflow-vector.
//   (iii) a pinned-sticky clone (Δtop=0 where source scrolled away) fires sticky-delta.
//   (iv) a killed-hover clone (source hover restyle, clone none) fires hover-dead; killed reveal fires reveal-missing.
// Builder does NOT self-bless — the orchestrator re-executes _axisdelta-selfclone-falsifier.mjs --states.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function loadFloors(floorsPath) {
  const p = floorsPath || path.join(__dir, 'calibration', 'axis-floors.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { floors: {} }; }
}
function rec(over = {}) {
  const base = { ref: 'body>a|1|h' + Math.random().toString(36).slice(2, 8), srcPath: null, tag: 'a', role: 'link', text: 'Link', ownText: 'Link',
    box: { 1440: { x: 0, y: 60, w: 200, h: 40, right: 200, xFrac: 0, wFrac: 0.1389 },
           768: { x: 0, y: 60, w: 200, h: 40, right: 200, xFrac: 0, wFrac: 0.2604 },
           390: { x: 0, y: 60, w: 200, h: 40, right: 200, xFrac: 0, wFrac: 0.5128 } },
    style: { color: 'rgb(20,20,20)', backgroundColor: 'rgb(255,255,255)', font: { size: '16px', family: 'Inter' }, border: { width: {}, style: {}, color: {} }, zIndex: '0', position: 'static' },
    asset: { isImage: false, naturalSrc: null, svgHash: null }, pseudo: {}, states: { hover: null, scroll: null } };
  const r = Object.assign(base, over);
  if (!r.srcPath) r.srcPath = r.ref;
  return r;
}
function mkBlob(srcRecs, cloneRecs, over = {}) {
  const W = (over.report && over.report.widths) || [1440, 768, 390];
  return {
    report: Object.assign({ source: 'https://selftest.local', clone: 'http://localhost:8001/?page_id=selftest', widths: W, joinWidth: W[0], scrollY: 800,
      pageHeightByVw: { source: { 1440: 4000, 768: 5000, 390: 6000 }, clone: { 1440: 4000, 768: 5000, 390: 6000 } },
      matched: srcRecs.map((s, i) => cloneRecs[i] ? ({ srcRef: s.ref, cloneRef: cloneRecs[i].ref }) : null).filter(Boolean),
      relation: Object.fromEntries(srcRecs.map((s, i) => [s.srcPath, cloneRecs[i] ? [cloneRecs[i].ref] : []])),
      unmatchedSource: srcRecs.filter((s, i) => !cloneRecs[i]).map((s) => s.ref),
      responsiveSweep: over.responsiveSweep || { overflowByWidth: {}, sourceMediaBreakpoints: [], elementorNativeBreakpoints: ELEMENTOR_NATIVE_BP, unreflowableSourceBreakpoints: [] } }, over.report || {}),
    sourceCapture: { records: srcRecs, mediaBreakpoints: (over.sourceMediaBreakpoints || []) },
    cloneCapture: { records: cloneRecs },
  };
}
export function runSelftest() {
  const floors = loadFloors();
  const cases = []; const ok = (name, pass, detail = '') => cases.push({ name, pass: !!pass, detail });

  // (i) SELF-CLONE ACROSS STATES + WIDTHS → ZERO sweep defects. A responsive source that reflows AND has hover +
  // reveal + a scroll-away nav, cloned to ITSELF, must fire 0 on every sweep axis (the delta-of-deltas is 0).
  {
    const reflowBox = (wf1440, wf390) => ({ 1440: { x: 0, y: 1200, w: wf1440 * 1440, h: 200, right: wf1440 * 1440, xFrac: 0, wFrac: wf1440 },
      768: { x: 0, y: 1200, w: 0.5 * 768, h: 200, right: 0.5 * 768, xFrac: 0, wFrac: 0.5 },
      390: { x: 0, y: 1400, w: wf390 * 390, h: 200, right: wf390 * 390, xFrac: 0, wFrac: wf390 } });
    const nav = rec({ ref: 'body>header|1|hN', srcPath: 'body>header|1|hN', tag: 'header', role: 'banner',
      box: { 1440: { x: 0, y: 0, w: 1440, h: 60, right: 1440, xFrac: 0, wFrac: 1 }, 768: { x: 0, y: 0, w: 768, h: 60, right: 768, xFrac: 0, wFrac: 1 }, 390: { x: 0, y: 0, w: 390, h: 60, right: 390, xFrac: 0, wFrac: 1 } },
      states: { hover: null, scroll: { 'top@0': 0, 'top@800': -736, position: 'static', sticky: false } } }); // scrolls away
    const card = rec({ ref: 'body>main>div|1|hC', srcPath: 'body>main>div|1|hC', tag: 'div', role: null, box: reflowBox(0.33, 1.0),
      states: { hover: { backgroundColor: { from: 'rgb(255,255,255)', to: 'rgb(0,0,0)' }, transform: { from: 'none', to: 'translateY(-4px)' } },
        reveal: { opacityBefore: 0, opacityAfter: 1, transformBefore: 'translateY(40px)', transformAfter: 'none' }, scroll: null } });
    const src = [nav, card];
    const clone = JSON.parse(JSON.stringify(src)).map((r, i) => { r.ref = 'c' + src[i].ref; return r; });
    const blob = mkBlob(src, clone);
    // wire correspondence to the cloned refs.
    blob.report.matched = src.map((s, i) => ({ srcRef: s.ref, cloneRef: clone[i].ref }));
    blob.report.relation = Object.fromEntries(src.map((s, i) => [s.srcPath, [clone[i].ref]]));
    const r = runSweep(blob, floors);
    ok('(i) self-clone across states+widths → ZERO sweep events', r.events.length === 0, `events=${r.events.length} axes=${JSON.stringify(r.byAxis)}`);
    ok('(i) self-clone → sweepScore ≈ 1.0', r.sweepScore >= 0.999, `sweepScore=${r.sweepScore}`);
  }

  // (ii) FORCE-STATIC@390: clone keeps its 1440 width at 390 (overflows) AND does not reflow. Source reflows.
  {
    const src = [rec({ ref: 'body>main>div|1|hR', srcPath: 'body>main>div|1|hR', tag: 'div', role: null,
      box: { 1440: { x: 0, y: 1200, w: 480, h: 200, right: 480, xFrac: 0, wFrac: 0.333 },
             390: { x: 0, y: 1400, w: 390, h: 200, right: 390, xFrac: 0, wFrac: 1.0 } } })]; // source reflows to full width @390
    const clone = [JSON.parse(JSON.stringify(src[0]))]; clone[0].ref = 'c' + src[0].ref;
    // clone STAYED 1440-wide at 390 → overflows + did not reflow (wFrac stayed at 0.333·(1440/390)=1.23 → right>390).
    clone[0].box[390] = { x: 0, y: 1400, w: 480, h: 200, right: 480, xFrac: 0, wFrac: 480 / 390 };
    const blob = mkBlob(src, clone, { report: { widths: [1440, 390] },
      responsiveSweep: { overflowByWidth: { 390: { cloneOverflows: true, sourceOverflows: false } }, sourceMediaBreakpoints: [900], elementorNativeBreakpoints: ELEMENTOR_NATIVE_BP, unreflowableSourceBreakpoints: [900] },
      sourceMediaBreakpoints: [900] });
    blob.report.matched = [{ srcRef: src[0].ref, cloneRef: clone[0].ref }];
    blob.report.relation = { [src[0].srcPath]: [clone[0].ref] };
    const r = runSweep(blob, floors);
    const over = r.events.find((e) => e.firedAxes.includes('h-overflow-bool'));
    const reflow = r.events.find((e) => e.firedAxes.includes('reflow-vector'));
    ok('(ii) force-static@390 FIRES h-overflow-bool', !!over, over ? `class=${over.class} px=${over.rows[0].magnitude}` : 'no overflow event');
    ok('(ii) force-static@390 FIRES reflow-vector', !!reflow, reflow ? `class=${reflow.class}` : 'no reflow event');
    ok('(ii) authoring WHY (unreflowable @900) attached to a responsive event', !!(over || reflow) && ((over || reflow).cantReflowHere || []).includes(900),
      `cantReflowHere=${JSON.stringify((over || reflow || {}).cantReflowHere)}`);
  }

  // (iii) PINNED-STICKY: source nav scrolls away (Δtop≈-1); clone nav stays pinned (Δtop≈0) → sticky-delta fires.
  {
    const nav = rec({ ref: 'body>header|1|hS', srcPath: 'body>header|1|hS', tag: 'header', role: 'banner',
      box: { 1440: { x: 0, y: 0, w: 1440, h: 60, right: 1440, xFrac: 0, wFrac: 1 } },
      states: { hover: null, scroll: { 'top@0': 0, 'top@800': -736, position: 'static', sticky: false } } });
    const cnav = JSON.parse(JSON.stringify(nav)); cnav.ref = 'c' + nav.ref;
    cnav.states.scroll = { 'top@0': 0, 'top@800': 0, position: 'fixed', sticky: true }; // PINNED — wrong
    const blob = mkBlob([nav], [cnav], { report: { widths: [1440] } });
    blob.report.matched = [{ srcRef: nav.ref, cloneRef: cnav.ref }];
    blob.report.relation = { [nav.srcPath]: [cnav.ref] };
    const r = runSweep(blob, floors);
    const st = r.events.find((e) => e.firedAxes.includes('sticky-delta'));
    ok('(iii) pinned-sticky clone FIRES sticky-delta', !!st, st ? `class=${st.class} srcΔ=${st.rows[0] && st.rows.find(x=>x.axis==='sticky-delta')}` : 'no sticky event');
    ok('(iii) sticky class = wrongly-sticky', st && st.class === 'wrongly-sticky', st ? st.class : '-');
  }

  // (iv) KILLED-HOVER + KILLED-REVEAL: source control has a hover restyle + a reveal swing; clone has neither.
  {
    const ctrl = rec({ ref: 'body>main>a|1|hH', srcPath: 'body>main>a|1|hH', tag: 'a', role: 'link',
      box: { 1440: { x: 100, y: 1300, w: 160, h: 44, right: 260, xFrac: 0.069, wFrac: 0.111 } },
      states: { hover: { backgroundColor: { from: 'rgb(34,34,34)', to: 'rgb(0,120,255)' }, transform: { from: 'none', to: 'translateY(-2px)' } },
        reveal: { opacityBefore: 0, opacityAfter: 1, transformBefore: 'translateY(50px)', transformAfter: 'none' }, scroll: null } });
    const cctrl = JSON.parse(JSON.stringify(ctrl)); cctrl.ref = 'c' + ctrl.ref;
    cctrl.states = { hover: null, reveal: { opacityBefore: 1, opacityAfter: 1, transformBefore: 'none', transformAfter: 'none' }, scroll: null }; // dead hover + no reveal
    const blob = mkBlob([ctrl], [cctrl], { report: { widths: [1440] } });
    blob.report.matched = [{ srcRef: ctrl.ref, cloneRef: cctrl.ref }];
    blob.report.relation = { [ctrl.srcPath]: [cctrl.ref] };
    const r = runSweep(blob, floors);
    const hv = r.events.find((e) => e.firedAxes.includes('hover-dead'));
    const rv = r.events.find((e) => e.firedAxes.includes('reveal-missing'));
    const rowClass = (e, axis) => { const row = e && e.rows.find((x) => x.axis === axis); return row ? row.class : '-'; };
    ok('(iv) killed-hover FIRES hover-dead', !!hv, hv ? `class=${rowClass(hv, 'hover-dead')}` : 'no hover event');
    ok('(iv) killed-reveal FIRES reveal-missing', !!rv, rv ? `class=${rowClass(rv, 'reveal-missing')}` : 'no reveal event');
  }

  // noLabelFit assertion.
  ok('noLabelFit declared on sweep output', runSweep(mkBlob([rec()], [rec()]), floors).meta.noLabelFit === true);

  const failed = cases.filter((c) => !c.pass);
  console.log('\n==== AXIS-DELTA SWEEP (#4 RESPONSIVE+MOTION) — OFFLINE SELFTEST ====');
  for (const c of cases) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${cases.length} cases)`);
  return failed.length === 0;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export const SWEEP_SCHEMA = {
  sweepFile: 'eval/grader/axisdelta-sweep.mjs',
  mandate: '#4 — RESPONSIVE + MOTION as delta-of-deltas through the SAME engine; NO new per-defect code, new axes computed across viewports/states.',
  responsive: {
    widths: 'swept [1440,768,390]; 768 = Elementor-native + keystone tablet bp (capture via SWEEP_768=1 or --widths 1440,768,390 to compare-capture).',
    sourceMediaBreakpoints: 'parsed from document.styleSheets CSSMediaRule.media.mediaText in compare-capture (additive, pure read; crossOriginSheets flagged).',
    axes: {
      'h-overflow-bool': 'CORRESPONDENCE-FREE boolean: clone box.right > vw·1.02 at narrow width where the SOURCE does not overflow. Survives a broken narrow join (reads only the clone box). Crispest single tell. floor 0.5 (binary), weight 0.55.',
      'reflow-vector': 'JOIN-LIGHT: per matched ref, |srcReflowFrac − cloneReflowFrac| where reflowFrac = wFrac@narrow − wFrac@wide. Source reflows (grows toward full-width), clone stays flat = defect. Gated on box[both widths][both sides] (join confidence). floor 0.12 ratio, weight 0.45.',
    },
    authoringWhy: 'a SOURCE @media bp outside Elementor native {768,480}±32 = a width the clone structurally CANNOT reflow (Hello+free strips the custom_css @media channel). Attached as event.cantReflowHere — the WHY, NOT the detector; the rendered overflow / reflow-miss is ground truth.',
    narrowTrust: 'at 390 the per-element join is NOT re-validated → NO new geometry severity assuming a verified 390 join. Reflow-vector requires the box on both widths/sides; otherwise fall back to the overflow boolean (page-level + per-clone-element) + band crops.',
  },
  motion: {
    deltaOfDeltas: 'every motion axis diffs a SOURCE state-delta vs a CLONE state-delta — never a single static read. Identical states on both sides → 0 delta → self-clone fires 0.',
    axes: {
      'sticky-delta': '|Δtop_src/scrollY − Δtop_clone/scrollY| on a top-band nav (scroll@0 vs scroll@800). Source scrolls away (Δtop≈−1), wrongly-pinned clone stays (Δtop≈0). Captures BOTH wrongly-sticky AND wrongly-unsticky. floor 0.25, weight 0.50. Complements the engine state-pin axis.',
      'hover-dead': 'parse source :hover set → hoverable set; dispatch hover; diff styleDelta magnitude. max(0, srcHoverMag − cloneHoverMag): source restyles, clone ≈ 0 = dead hover. A control with no source hover is NOT punished. floor 0.2, weight 0.40.',
      'reveal-missing': 'opacity/transform BEFORE vs AFTER entering the viewport (CAPTURE_REVEAL=1). Source AOS/Elementor-entrance swings 0→1 / translateY→0; static clone stays. max(0, srcSwing − cloneSwing). floor 0.25, weight 0.40.',
    },
  },
  floors: { source: 'SWEEP_SEMANTIC_MIN — perceptual priors, run through the SAME applyFloors machinery (excess = max(0, magnitude − floor)); NOT fit to labels.', SWEEP_SEMANTIC_MIN },
  weights: { source: 'SWEEP_W — perceptual priors, commensurate with the engine per-floor-unit scale.', SWEEP_W },
  severity: 'salience × Σ sweepW(axis)·floorUnits, squashed 1−e^−Σ, salience-amplified (cap 1) — mirrors the engine.',
  noLabelFit: true,
  flag: 'OFF unless --sweep / SWEEP_AXES=1 (or run directly). Folded into a grader behind the flag so existing scores are unchanged.',
  reversible: 'new file; imports axisdelta-floor/grade-element-crops/axisdelta-engine UNCHANGED; produces its OWN sweep report (does not replace the engine pageScore). Delete the file + revert the additive capture fields → nothing else changes.',
  selftest: 'eval/grader/axisdelta-sweep.mjs --selftest + _axisdelta-selfclone-falsifier.mjs --states. (i) self-clone across states/widths fires 0; (ii) force-static@390 fires h-overflow+reflow; (iii) pinned-sticky fires sticky; (iv) killed-hover/killed-reveal fire dead-hover/reveal-missing. Builder does NOT self-bless; orchestrator re-executes.',
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
function main() {
  if (has('schema')) { console.log(JSON.stringify(SWEEP_SCHEMA, null, 2)); return; }
  if (has('selftest')) { process.exit(runSelftest() ? 0 : 1); }

  const comparePath = arg('compare');
  if (!comparePath || !fs.existsSync(comparePath)) { console.error('need --compare <blob.json> (or --selftest / --schema)'); process.exit(2); }
  const floorsPath = arg('floors', path.join(__dir, 'calibration', 'axis-floors.json'));
  const blob = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
  const floors = loadFloors(floorsPath);
  const out = runSweep(blob, floors);

  console.log('\n==== AXIS-DELTA SWEEP (#4 — RESPONSIVE + MOTION as delta-of-deltas through the engine) ====');
  console.log(`compare: ${comparePath}`);
  console.log(`source:  ${out.meta.source}`);
  console.log(`clone:   ${out.meta.clone}`);
  console.log(`widths ${out.meta.widths.join(',')} | join ${out.meta.joinVw} | narrow ${out.meta.narrowVws.join(',') || '(none — pass 768/390)'} | scrollY ${out.meta.scrollY} | revealCaptured ${out.meta.revealCaptured}`);
  if (out.meta.why && out.meta.why.sourceMediaBreakpoints) console.log(`source @media bps: [${out.meta.why.sourceMediaBreakpoints.join(',')}] | unreflowable (clone can't reflow): [${out.meta.why.unreflowableSourceBreakpoints.join(',')}]`);
  console.log(`\nSWEEP SCORE: ${out.sweepScore}  (1=behaviour/responsive indistinguishable, 0=worthless)`);
  console.log(`events: ${out.aggregate.events} (responsive ${out.aggregate.responsiveEvents} / motion ${out.aggregate.motionEvents} / fatal≥0.6 ${out.aggregate.fatalEvents})`);
  console.log(`by axis: ${JSON.stringify(out.byAxis)}`);
  console.log(`by class: ${JSON.stringify(out.byClass)}`);
  console.log(`\nTOP SWEEP EVENTS:`);
  for (const e of out.events.slice(0, 16)) {
    console.log(`  [${e.severity.toFixed(3)}] ${e.class.padEnd(20)} ${String(e.ref).slice(0, 40)}@${e.viewport} axes=${e.firedAxes.join('+')}${e.cantReflowHere ? ` (cantReflowHere ${e.cantReflowHere.join(',')})` : ''}`);
  }
  if (has('json')) { fs.writeFileSync('/tmp/axisdelta-sweep-out.json', JSON.stringify(out, null, 2)); console.log('\nfull sweep event map → /tmp/axisdelta-sweep-out.json'); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
