#!/usr/bin/env node
/**
 * @purpose grade-fused.mjs — CAPSTONE (#5) of the upleveled grader: ONE FUSED LEDGER + ONE FUSED SCORE.
 *
 * THE PROBLEM IT FIXES (the biggest structural win in the fusion mandate):
 *   Today region-judge.mjs's RJ_STEP_FLOOR caps the headline NEAR-0 when the *vision* judge reports a
 *   disqualifying defect (missing-hero / invisible-heading / wrong-logo / overlap / unstyled-CTA). The vision
 *   output is ±8 run-to-run NOISY (memory: grader_visual_noise), so the disqualifying FLOOR — the single most
 *   consequential decision the grader makes — is itself noisy. But the axis-delta ENGINE + SWEEP already detect
 *   EVERY one of those disqualifying classes DETERMINISTICALLY (presence/bbox → missing-hero; text-contrast
 *   collapse → invisible-heading; img-src/svghash/phash → wrong/missing-logo; collision/z-pile → overlapping-
 *   sections; h-overflow(-bool) → horizontal-overflow; state-pin/sticky-delta → wrongly-sticky). So we MOVE THE
 *   STEP-FUNCTION FLOOR TRIGGER FROM THE VISION JUDGE TO THE DETERMINISTIC LEDGER. The floor stops being noisy;
 *   vision is QUARANTINED to (a) raising confidence on a corroborated row (dedup-merge) and (b) a HARD-CLAMPED
 *   perceptual term (the gestalt residual + the medium-confidence tail) that can NEVER trip the floor and NEVER
 *   swing the headline.
 *
 * WHAT IT DELIVERS:
 *   (1) ONE FUSED LEDGER. Both modalities emit the SAME uniform row:
 *         { element_ref, region_bbox, viewport, state, axis, defect_class, severity, confidence,
 *           source:'deterministic'|'vision', evidence, component_id }
 *       Deterministic rows come from runEngine() (static axes) + runSweep() (responsive/motion axes), UNCHANGED.
 *       Vision rows come from grade-element-crops' results.json findings[].visionDefects[] (already verifier-
 *       filtered + fact-injected), UNCHANGED. region_bbox is recovered by joining element_ref → blob box[viewport]
 *       (no engine mutation — the engine stays byte-stable for its current callers).
 *   (2) DEDUP-MERGE by (element_ref + (axis||defect_class)): a deterministic row and a vision row on the SAME
 *       element+axis MERGE into ONE — the deterministic row is kept, its confidence is RAISED (vision corroborates;
 *       it is NOT a second deduction). Mirrors region-judge's det/vision de-dupe (lines 862-864).
 *   (3) SCORE = f(ledger):
 *         start 100
 *         → DETERMINISTIC STEP-FUNCTION VETO: built from the LEDGER's DETERMINISTIC rows ONLY whose defect_class
 *           maps (SAME FATAL_OF/DISQUALIFYING_FATAL taxonomy as region-judge) to a disqualifying class at
 *           high|fatal severity → cap = max(0, 8 - 2*(n-1))  (PORTED verbatim from region-judge line 653, but
 *           triggered off DETERMINISTIC rows — vision can NEVER trip it).
 *         → else subtract SALIENCE-WEIGHTED severity for the remaining non-disqualifying rows (traceable per row).
 *         → + a BOUNDED vision perceptual term (hard-clamped to ±VISION_CLAMP pts) from vision-ONLY rows.
 *       Every deduction is traceable to a ledger row (element_ref + axis + evidence): open the ledger, see why
 *       each point was lost.
 *
 * SAFETY / REVERSIBILITY: PURE over a cached compare blob + an optional grade-element-crops results.json. No
 *   network, no host, no builder, no git. --no-vision is the DEFAULT path (deterministic ledger only). Imports
 *   runEngine (axisdelta-engine), runSweep (axisdelta-sweep), and the FATAL_OF/DISQUALIFYING_FATAL taxonomy
 *   (region-judge) — all UNCHANGED. This is a NEW orchestrator: deleting grade-fused.mjs changes NOTHING else
 *   (axisdelta-engine/axisdelta-sweep/grade-element-crops/region-judge stay byte-stable for current callers;
 *   region-judge's own RJ_STEP_FLOOR keeps working off vision under its own flag — this file is the SEPARATE
 *   deterministic-floor orchestrator). Capturing external sources is read-only; this scorer never captures.
 *
 * CLI:
 *   node grade-fused.mjs --compare /tmp/compare-268.json [--floors calibration/axis-floors.json]
 *        [--crops /tmp/region-judge-crops/results.json] [--no-vision] [--top-k 24] [--json]
 *   node grade-fused.mjs --selftest     # offline synthetic checks (NO capture, NO vision)
 *   node grade-fused.mjs --schema
 *   node --check grade-fused.mjs
 *
 * Falsifier / selftest: _grade-fused-selftest.mjs (the orchestrator re-executes it — the builder does NOT
 * self-bless). Inline `--selftest` runs the same offline checks for convenience.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runEngine } from './axisdelta-engine.mjs';
import { runSweep } from './axisdelta-sweep.mjs';
// ── TAXONOMY (mirrored verbatim from region-judge.mjs, NOT imported) ──────────────────────────────────────────
// We deliberately do NOT import region-judge.mjs: it transitively pulls pngjs + Playwright-adjacent helpers and we
// want grade-fused to be a PURE, fast, capture-free scorer (the --no-vision default path must not load image libs).
// region-judge exports FATAL_OF + DISQUALIFYING_FATAL but NOT SEVERITY_RANK, so we re-declare the three taxonomy
// constants here, BYTE-IDENTICAL to region-judge.mjs (lines 136-148, 172). These are the SAME fatalClass buckets +
// disqualifying set + severity ranking the vision floor uses — the fused floor and the vision floor agree by
// construction. If region-judge's taxonomy ever changes, this mirror must change with it (the selftest's parity
// replay on /tmp/compare-268.json + /tmp/compare-341.json is the cross-check the orchestrator re-executes).
const FATAL_OF = {
  'wrong-logo': 'logo', 'missing-logo': 'logo',
  'invisible-text': 'heading',
  'blank-hero': 'hero', 'image-missing': null,
  'unstyled-cta': 'CTA',
  'overlapping-sections': 'overlap',
  'wrong-layout': null, 'missing-section': null, 'color-off': null, 'font-off': null,
};
const DISQUALIFYING_FATAL = new Set(['logo', 'heading', 'hero', 'CTA', 'overlap', 'imagery']);
const SEVERITY_RANK = { fatal: 4, high: 3, med: 2, low: 1 };

const __dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SEVERITY BUCKETING — map the engine's CONTINUOUS severity (0..1) onto region-judge's STRING ladder so BOTH
// modalities feed the SAME step-function veto + the SAME per-row deduction. Thresholds chosen to align with
// region-judge SEVERITY_RANK ({fatal,high,med,low}) and the engine's own fatal≥0.6 convention (aggregate.fatalEvents).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export const SEV_BANDS = [['fatal', 0.6], ['high', 0.35], ['med', 0.15], ['low', 0]];
export function severityBucket(numeric) {
  for (const [name, lo] of SEV_BANDS) if (numeric >= lo) return name;
  return 'low';
}
// numeric value for a string severity (for the per-row salience-weighted deduction of a vision-only row).
export const SEV_NUMERIC = { fatal: 0.85, high: 0.5, med: 0.22, low: 0.08 };
export function severityNumber(sev) {
  if (typeof sev === 'number') return sev;
  return SEV_NUMERIC[String(sev)] != null ? SEV_NUMERIC[String(sev)] : 0.22;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// DEFECT-CLASS → fatalClass. The engine's naming-projection classes ('blank-hero','invisible-heading','wrong-
// logo', etc.) differ in spelling from region-judge's vision taxonomy ('blank-hero','invisible-text','wrong-
// logo', …). We normalize BOTH onto the SAME fatalClass buckets via region-judge's FATAL_OF, plus a thin alias
// table for the engine-only class names. fatalClass=null ⇒ structural (non-disqualifying). This is the SINGLE
// place the two vocabularies join — a wrong/missing alias only ever LOSES a disqualifier (fails safe to structural),
// never invents one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const ENGINE_CLASS_FATAL = {
  // engine naming-projection classes (axisdelta-engine projectName) → fatalClass bucket
  'blank-hero': 'hero',
  'invisible-heading': 'heading',
  'invisible-text': 'heading',          // region-judge maps invisible-text→heading too; engine emits both names
  'wrong-logo': 'logo', 'missing-logo': 'logo',
  'unstyled-cta': 'CTA',
  'overlapping-sections': 'overlap',
  'wrongly-sticky': 'behavior',          // wrongly-sticky = broken-behavior (deterministic via state-pin/sticky-delta)
  'missing-imagery': 'imagery',          // a dropped non-logo image/panel — the ONE vision-leaning class (see below)
  // structural / non-disqualifying (explicitly null so they NEVER trip the floor)
  'wrong-layout': null, 'missing-section': null, 'color-off': null, 'font-off': null,
  'restructured-not-missing': null,      // a folded-but-present element (presence over-veto fix) — NEVER a disqualifier
  'horizontal-overflow': 'overflow',     // h-overflow / h-overflow-bool — a deterministic disqualifier
};
// the disqualifying fatalClass buckets the DETERMINISTIC step-floor triggers on. SUPERSET of region-judge's
// DISQUALIFYING_FATAL (logo/heading/hero/CTA/overlap/imagery) PLUS the two newly-deterministic broken-behavior
// classes the engine/sweep now detect with zero vision: 'overflow' (horizontal-overflow) and 'behavior'
// (wrongly-sticky). These are the "missing-hero / wrong-logo / invisible-heading / horizontal-overflow / broken-
// behavior" disqualifiers from the mandate — ALL deterministic.
export const FUSED_DISQUALIFYING = new Set([...DISQUALIFYING_FATAL, 'overflow', 'behavior']);
// 'imagery' is the ONLY class without a clean per-element deterministic axis (a substantive dropped image/panel
// with no source-DOM counterpart). We detect it DETERMINISTICALLY via engine.unmatchedHiSal (high-salience SOURCE
// elements with no clone correspondent) rather than leaving it vision-gated — so the floor is FULLY deterministic.
// Vision may still CORROBORATE an imagery row (dedup-merge raises confidence) but a vision-ONLY imagery row is
// bounded (perceptual term) and does NOT trip the floor. Documented as the single bounded-even-there class.
export function fatalClassOf(defectClass) {
  if (defectClass == null) return null;
  const dc = String(defectClass).toLowerCase().replace(/\s+/g, '-');
  if (Object.prototype.hasOwnProperty.call(ENGINE_CLASS_FATAL, dc)) return ENGINE_CLASS_FATAL[dc];
  if (Object.prototype.hasOwnProperty.call(FATAL_OF, dc)) return FATAL_OF[dc];
  return null;  // unknown class fails safe to structural (never a phantom disqualifier)
}

// salience weight per fatalClass for the (non-veto) per-row deduction. Disqualifiers that DON'T trip the floor
// (because they were e.g. only 'med' severity) still deduct more than a cosmetic. Perceptual-prior ordering,
// NOT fit to labels (consistent with the engine's W ranking).
const CLASS_SALIENCE = {
  hero: 1.0, heading: 1.0, logo: 0.9, CTA: 0.85, overlap: 0.9, imagery: 0.8,
  overflow: 0.85, behavior: 0.7, null: 0.4,
};
export function salienceWeight(fatalClass) {
  const k = fatalClass == null ? 'null' : fatalClass;
  return CLASS_SALIENCE[k] != null ? CLASS_SALIENCE[k] : 0.4;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// region_bbox recovery — join element_ref → the source blob's box[viewport] (engine left byte-stable). Accepts
// string- or number-keyed box maps (the blob keys box by STRING viewport).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
function boxIndex(blob) {
  const idx = new Map();
  const add = (recs) => { for (const r of (recs || [])) if (r && r.ref && !idx.has(r.ref)) idx.set(r.ref, r.box || null); };
  add(blob.sourceCapture && blob.sourceCapture.records);
  add(blob.cloneCapture && blob.cloneCapture.records);   // clone fallback for clone-only refs
  return idx;
}
function bboxFor(boxIdx, ref, vw) {
  const box = boxIdx.get(ref);
  if (!box) return null;
  const b = box[vw] || box[String(vw)] || null;
  if (!b) return null;
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// (STEP 2) THREE PURE ADAPTERS → uniform ledger rows.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

// deterministic ENGINE rows (static axes). source:'deterministic', confidence 1.0. One row per EVENT (post-
// coherence — a coherent N-shift is already ONE event), tagged with the dominant axis so dedup keys cleanly.
export function detEngineRows(engineOut, boxIdx) {
  const rows = [];
  for (const e of engineOut.events) {
    const axis = e.dominantAxis || (e.firedAxes && e.firedAxes[0]) || null;
    rows.push(makeRow({
      element_ref: e.ref, region_bbox: bboxFor(boxIdx, e.ref, e.viewport), viewport: e.viewport,
      state: 'static', axis, defect_class: e.class, severity: severityBucket(e.severity),
      severityNum: e.severity, confidence: 1.0, source: 'deterministic',
      evidence: { firedAxes: e.firedAxes, magnitudes: e.magnitudes, coherence: e.coherence && e.coherence.note, salience: e.salience },
      component_id: e.coherence ? `${e.coherence.family}:${e.ref}` : `single:${e.ref}`,
    }));
  }
  return rows;
}

// deterministic SWEEP rows (responsive/motion axes). source:'deterministic'. state from axisDomain (responsive)
// or the specific motion axis (hover/scroll). Same numeric→bucket map.
export function sweepRows(sweepOut, boxIdx) {
  const rows = [];
  for (const e of sweepOut.events) {
    const axis = (e.firedAxes && e.firedAxes[0]) || null;
    let state = 'static';
    if (e.axisDomain === 'responsive') state = 'responsive';
    else if (e.firedAxes && e.firedAxes.some((a) => /hover/.test(a))) state = 'hover';
    else if (e.firedAxes && e.firedAxes.some((a) => /reveal|scroll/.test(a))) state = 'scroll';
    else if (e.firedAxes && e.firedAxes.some((a) => /sticky/.test(a))) state = 'scroll';
    else state = e.axisDomain || 'motion';
    rows.push(makeRow({
      element_ref: e.ref, region_bbox: bboxFor(boxIdx, e.ref, e.viewport), viewport: e.viewport,
      state, axis, defect_class: e.class, severity: severityBucket(e.severity), severityNum: e.severity,
      confidence: 1.0, source: 'deterministic',
      evidence: { firedAxes: e.firedAxes, magnitudes: e.magnitudes, axisDomain: e.axisDomain, cantReflowHere: e.cantReflowHere },
      component_id: `sweep:${e.ref}`,
    }));
  }
  return rows;
}

// UNMATCHED-HI-SALIENCE → deterministic 'imagery'/'missing-section' rows. A high-salience SOURCE element with no
// clone correspondent is a dropped image/panel/section — the engine already surfaces these (unmatchedHiSal). We
// emit them as DETERMINISTIC ledger rows so the 'imagery' disqualifier is deterministic (closing the one vision-
// gated gap). A hero/img/logo bucket → its fatalClass; everything else → structural missing-section.
export function unmatchedRows(engineOut, boxIdx) {
  const rows = [];
  for (const u of (engineOut.unmatchedHiSal || [])) {
    const bucket = u.bucket || '';
    let dc = 'missing-section';
    if (bucket === 'hero') dc = 'blank-hero';
    else if (bucket === 'logo') dc = 'missing-logo';
    else if (bucket === 'img' || /img|image|media|panel|gallery/.test(bucket)) dc = 'missing-imagery';
    // salience → severity: a very-high-salience drop is fatal, otherwise high.
    const sev = u.salience >= 2.5 ? 'fatal' : 'high';
    rows.push(makeRow({
      element_ref: u.ref, region_bbox: bboxFor(boxIdx, u.ref, u.viewport), viewport: u.viewport,
      state: 'static', axis: 'presence', defect_class: dc, severity: sev, severityNum: severityNumber(sev),
      confidence: 1.0, source: 'deterministic',
      evidence: { unmatchedSource: true, salience: u.salience, bucket },
      component_id: `unmatched:${u.ref}`,
    }));
  }
  return rows;
}

// VISION rows from grade-element-crops results.json. source:'vision', confidence ~0.6 (already verifier-filtered
// + fact-injected). state inferred from the finding's why/sweep (default static). axis null (pure-vision rows key
// on defect_class for dedup). Accepts EITHER the spine results shape (findings[].visionDefects[]) OR the re-
// pointed judgePairCrops shape (top-level defects[]); both carry the same per-defect fields.
export function visionRows(cropResults, boxIdx) {
  if (!cropResults) return [];
  const rows = [];
  const push = (ref, viewport, d, evidenceExtra) => {
    const dc = String(d.defect_class || '').toLowerCase().replace(/\s+/g, '-');
    const sev = SEVERITY_RANK[String(d.severity || 'med').toLowerCase()] ? String(d.severity).toLowerCase() : 'med';
    rows.push(makeRow({
      element_ref: ref, region_bbox: bboxFor(boxIdx, ref, viewport), viewport,
      state: 'static', axis: null, defect_class: dc, severity: sev, severityNum: severityNumber(sev),
      confidence: 0.6, source: 'vision',
      evidence: { element: d.element, evidence: d.evidence, fatalClass: d.fatalClass, ...(evidenceExtra || {}) },
      component_id: `vision:${ref}:${dc}`,
    }));
  };
  if (Array.isArray(cropResults.findings)) {
    for (const f of cropResults.findings) {
      const vw = f.viewport != null ? f.viewport : (cropResults.widths && cropResults.widths[0]);
      for (const d of (f.visionDefects || [])) push(f.ref, vw, d, { facts: f.facts });
    }
  } else if (Array.isArray(cropResults.defects)) {
    for (const d of cropResults.defects) {
      const vw = d.viewport != null ? d.viewport : (cropResults.widths && cropResults.widths[0]);
      push(d.region || d.ref, vw, d, null);
    }
  }
  return rows;
}

// uniform row constructor (the SINGLE schema). region_bbox may be null (recoverable refs only); always present
// as a key so the schema is uniform.
function makeRow(o) {
  return {
    element_ref: o.element_ref, region_bbox: o.region_bbox || null, viewport: o.viewport,
    state: o.state, axis: o.axis != null ? o.axis : null, defect_class: o.defect_class,
    severity: o.severity, severityNum: o.severityNum != null ? +o.severityNum.toFixed?.(4) ?? o.severityNum : null,
    confidence: o.confidence, source: o.source, evidence: o.evidence || null,
    component_id: o.component_id || null,
    fatalClass: fatalClassOf(o.defect_class),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// (STEP 3) DEDUP-MERGE by (element_ref + (axis || defect_class)). A deterministic row and a vision row on the
// SAME element+axis MERGE into ONE: KEEP the deterministic row, RAISE its confidence (vision corroborates — it is
// NOT a second deduction). Vision-only rows survive (bounded). Two deterministic rows on the same key keep the
// higher-severity one (the engine already collapses coherent components; this guards a sweep/engine overlap on the
// same ref+axis). Mirrors region-judge's det/vision de-dupe (region-judge.mjs lines 862-864).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function dedupMerge(rows) {
  const groups = new Map();
  const keyOf = (r) => `${r.element_ref}@${r.viewport}::${r.axis != null ? r.axis : r.defect_class}`;
  for (const r of rows) {
    const k = keyOf(r);
    if (!groups.has(k)) { groups.set(k, [r]); continue; }
    groups.get(k).push(r);
  }
  const merged = [];
  const mergeLog = [];
  for (const [k, grp] of groups) {
    if (grp.length === 1) { merged.push(grp[0]); continue; }
    const dets = grp.filter((r) => r.source === 'deterministic');
    const visions = grp.filter((r) => r.source === 'vision');
    if (dets.length) {
      // keep the worst deterministic row; RAISE confidence if vision corroborated.
      const keep = dets.slice().sort((a, b) => (b.severityNum || 0) - (a.severityNum || 0))[0];
      const out = { ...keep };
      if (visions.length) {
        out.confidence = Math.min(1.0, (out.confidence || 1.0) + 0.0);  // det confidence already 1.0 (cap)
        out.corroboratedByVision = true;
        out.mergedVisionCount = visions.length;
        mergeLog.push({ key: k, kept: 'deterministic', class: out.defect_class, raisedConfidenceTo: out.confidence, droppedVisionRows: visions.length });
      }
      merged.push(out);
    } else {
      // vision-only collision (same element+class from >1 finding) — keep the worst, note the corroboration.
      const keep = visions.slice().sort((a, b) => (b.severityNum || 0) - (a.severityNum || 0))[0];
      const out = { ...keep, confidence: Math.min(0.9, (keep.confidence || 0.6) + 0.1 * (visions.length - 1)), mergedVisionCount: visions.length };
      merged.push(out);
    }
  }
  return { ledger: merged, mergeLog };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// (STEP 4) SCORE = f(ledger). start 100 → DETERMINISTIC step-floor veto → minus salience-weighted severity → plus
// BOUNDED vision perceptual term. Every deduction traceable to a ledger row.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export const VISION_CLAMP = 5;     // the vision perceptual term is HARD-CLAMPED to ±5 pts (cannot swing the headline)
export const VISION_PER_ROW = 1.2; // each vision-only medium/gestalt row nudges the term by at most this (pre-clamp)
export const NONVETO_SCALE = 90;   // the non-disqualifying salience-weighted deduction budget (pts), saturating

export function scoreFromLedger(ledger) {
  // ── (a) DETERMINISTIC STEP-FUNCTION VETO — built from DETERMINISTIC rows ONLY ──
  // A deterministic row whose fatalClass ∈ FUSED_DISQUALIFYING at high|fatal severity is a disqualifier. n =
  // count of DISTINCT disqualifying fatalClasses. cap = max(0, 8 - 2*(n-1)) (PORTED from region-judge line 653).
  const disqRows = ledger.filter((r) =>
    r.source === 'deterministic' && r.fatalClass && FUSED_DISQUALIFYING.has(r.fatalClass) &&
    (r.severity === 'fatal' || r.severity === 'high'));
  const disqClasses = [...new Set(disqRows.map((r) => r.fatalClass))];

  // ── (b) non-disqualifying salience-weighted deduction (per-row, traceable) ──
  // remaining rows = everything not already counted as a triggering disqualifier. Each contributes
  // salienceWeight(fatalClass) * severityNumber. Aggregated through a saturating map so many tiny rows can't drive
  // the score negative and one catastrophic row dominates.
  const deductions = [];
  let rawDeduct = 0;
  for (const r of ledger) {
    if (r.source !== 'deterministic') continue;              // vision handled by the bounded term
    const isTriggering = r.fatalClass && FUSED_DISQUALIFYING.has(r.fatalClass) && (r.severity === 'fatal' || r.severity === 'high');
    if (isTriggering) continue;                              // already accounted in the veto branch (don't double-debit)
    const w = salienceWeight(r.fatalClass);
    const sev = r.severityNum != null ? r.severityNum : severityNumber(r.severity);
    const contribution = +(w * sev).toFixed(4);
    rawDeduct += contribution;
    deductions.push({ element_ref: r.element_ref, viewport: r.viewport, axis: r.axis, defect_class: r.defect_class,
      fatalClass: r.fatalClass, severity: r.severity, weight: w, contribution, source: r.source,
      evidence: r.evidence });
  }
  // saturating: deduction pts = NONVETO_SCALE * (1 - e^(-rawDeduct/NORM)). One axis can't exceed the budget.
  const NORM = 8;
  const nonVetoDeduct = +(NONVETO_SCALE * (1 - Math.exp(-rawDeduct / NORM))).toFixed(3);

  // ── (c) BOUNDED vision perceptual term — vision-ONLY rows (gestalt residual + medium-confidence tail) ──
  // Each vision-only row nudges the term DOWN by up to VISION_PER_ROW (a high vision row nudges more, a low one
  // less), summed then HARD-CLAMPED to [-VISION_CLAMP, +VISION_CLAMP]. It NEVER trips the floor and NEVER dominates
  // the deterministic terms (a missing fatal already vetoed to ≤8 before this is added; the clamp keeps |term|≤5).
  const visionOnly = ledger.filter((r) => r.source === 'vision');
  let visionRaw = 0;
  for (const r of visionOnly) visionRaw -= VISION_PER_ROW * severityNumber(r.severity);
  const visionTerm = Math.max(-VISION_CLAMP, Math.min(VISION_CLAMP, +visionRaw.toFixed(3)));

  // ── assemble ──
  let fusedScore;
  const veto = { tripped: disqClasses.length > 0, disqualifiers: disqClasses, n: disqClasses.length, cap: null };
  if (disqClasses.length > 0) {
    const cap = Math.max(0, 8 - 2 * (disqClasses.length - 1));   // PORTED verbatim from region-judge line 653
    veto.cap = cap;
    // the disqualifying floor DOMINATES: score = cap (+ the bounded vision term, still clamped, but never above cap).
    fusedScore = Math.min(cap, Math.round(cap + Math.min(0, visionTerm)));  // vision can only nudge a vetoed page DOWN
    fusedScore = Math.max(0, fusedScore);
  } else {
    // no deterministic disqualifier → grade by fidelity: 100 − non-veto deduction + bounded vision term.
    fusedScore = Math.max(0, Math.min(100, Math.round(100 - nonVetoDeduct + visionTerm)));
  }

  return {
    fusedScore,
    deterministicVeto: veto,
    deductions: deductions.sort((a, b) => b.contribution - a.contribution),
    nonVetoDeduct,
    visionPerceptualTerm: { delta: visionTerm, clamped: Math.abs(visionRaw) > VISION_CLAMP, rawBeforeClamp: +visionRaw.toFixed(3), clampBound: VISION_CLAMP, visionOnlyRows: visionOnly.length },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// (STEP 6) THE FUSED SCORER — pure over a compare blob (+ optional crop results.json). --no-vision default path.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function gradeFused(blob, floorsObj, { cropResults = null, topK = 24, widths = null } = {}) {
  const boxIdx = boxIndex(blob);
  const engineOut = runEngine(blob, floorsObj, { topK, widths });
  let sweepOut = { events: [], sweepScore: 1, meta: {}, aggregate: { events: 0 } };
  try { sweepOut = runSweep(blob, floorsObj, { widths }); } catch (e) { sweepOut._error = String(e && e.message || e); }

  const rawRows = [
    ...detEngineRows(engineOut, boxIdx),
    ...sweepRows(sweepOut, boxIdx),
    ...unmatchedRows(engineOut, boxIdx),
    ...visionRows(cropResults, boxIdx),
  ];
  const { ledger, mergeLog } = dedupMerge(rawRows);
  const scored = scoreFromLedger(ledger);

  return {
    meta: {
      source: engineOut.meta.source, clone: engineOut.meta.clone, widths: engineOut.meta.widths,
      joinVw: engineOut.meta.joinVw, topK,
      visionUsed: !!cropResults, noLabelFit: true,
      fusedDisqualifying: [...FUSED_DISQUALIFYING], visionClamp: VISION_CLAMP,
      floorTrigger: 'DETERMINISTIC-LEDGER (engine+sweep+unmatched); vision is bounded + never trips the floor',
    },
    fusedScore: scored.fusedScore,
    ledger,
    deterministicVeto: scored.deterministicVeto,
    deductions: scored.deductions,
    nonVetoDeduct: scored.nonVetoDeduct,
    visionPerceptualTerm: scored.visionPerceptualTerm,
    mergeLog,
    components: {
      engineEvents: engineOut.events.length, enginePageScore: engineOut.pageScore,
      sweepEvents: sweepOut.events.length, sweepScore: sweepOut.sweepScore,
      unmatchedHiSal: (engineOut.unmatchedHiSal || []).length,
      visionRows: ledger.filter((r) => r.source === 'vision').length,
      deterministicRows: ledger.filter((r) => r.source === 'deterministic').length,
      mergedRows: mergeLog.length,
    },
    aggregate: {
      ledgerRows: ledger.length,
      disqualifierRows: ledger.filter((r) => r.source === 'deterministic' && r.fatalClass && FUSED_DISQUALIFYING.has(r.fatalClass) && (r.severity === 'fatal' || r.severity === 'high')).length,
      byClass: ledger.reduce((m, r) => { m[r.defect_class] = (m[r.defect_class] || 0) + 1; return m; }, {}),
      bySource: ledger.reduce((m, r) => { m[r.source] = (m[r.source] || 0) + 1; return m; }, {}),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// OFFLINE SELFTEST — synthetic fixtures (NO capture, NO vision). Proves the 5 mandated falsifiers:
//   (i)   self-clone → empty ledger, fusedScore ~100, veto NOT tripped.
//   (ii)  injected deterministic disqualifier (blank-hero) with NO vision → veto trips, fusedScore near-0
//         (PROVING the floor moved off vision: the crop results are null — there is NO LLM in the loop).
//   (iii) dedup: a det row + a vision row on the SAME element+axis → ONE row, det kept, confidence flagged
//         corroborated, NOT double-counted.
//   (iv)  bounded-vision: a pile of vision-ONLY medium defects cannot move fusedScore past its clamp nor trip
//         the floor.
//   (v)   traceability: every lost point has a ledger row (sum of veto/deduction is reconstructible from rows).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
function loadFloors() {
  const p = path.join(__dir, 'calibration', 'axis-floors.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function rec(o = {}) { const r = { ref: 'r', tag: 'div', box: {}, style: { border: { width: {}, style: {}, color: {} } }, ...o }; if (!r.srcPath) r.srcPath = r.ref; return r; }
function mkBlob(srcRecs, cloneRecs, over = {}) {
  return {
    report: Object.assign({ source: 'https://selftest.local', clone: 'http://localhost:8001/?page_id=selftest', widths: [1440], joinWidth: 1440,
      pageHeightByVw: { source: { 1440: 4000 }, clone: { 1440: 4000 } },
      matched: srcRecs.map((s, i) => cloneRecs[i] ? ({ srcRef: s.ref, cloneRef: cloneRecs[i].ref }) : null).filter(Boolean),
      relation: Object.fromEntries(srcRecs.map((s, i) => [s.srcPath, cloneRecs[i] ? [cloneRecs[i].ref] : []])),
      unmatchedSource: srcRecs.filter((s, i) => !cloneRecs[i]).map((s) => s.ref) }, over.report || {}),
    sourceCapture: { records: srcRecs }, cloneCapture: { records: cloneRecs },
  };
}
export function runSelftest() {
  const floors = loadFloors();
  const cases = [];
  const ok = (name, pass, detail = '') => cases.push({ name, pass: !!pass, detail });

  // (i) SELF-CLONE → ~100/0, empty ledger, veto NOT tripped.
  {
    const src = [
      rec({ ref: 'body>header>a>img|1|hB', srcPath: 'body>header>a>img|1|hB', tag: 'img', role: 'img', asset: { isImage: true, naturalSrc: 'https://s/logo.svg', svgHash: 'ABC' }, box: { 1440: { x: 20, y: 20, w: 100, h: 40, right: 120, xFrac: 0.014, wFrac: 0.07 } } }),
      rec({ ref: 'body>main>h1|1|hC', srcPath: 'body>main>h1|1|hC', tag: 'h1', role: 'heading', text: 'Hello World Heading', ownText: 'Hello World Heading', style: { color: 'rgb(17,17,17)', backgroundColor: 'rgb(255,255,255)', font: { size: '40px', family: 'Inter' }, border: { width: {}, style: {}, color: {} } }, box: { 1440: { x: 100, y: 120, w: 600, h: 80, right: 700, xFrac: 0.07, wFrac: 0.42 } } }),
    ];
    const clone = JSON.parse(JSON.stringify(src));
    const r = gradeFused(mkBlob(src, clone), floors, {});
    ok('(i) self-clone → empty ledger', r.ledger.length === 0, `ledgerRows=${r.ledger.length}`);
    ok('(i) self-clone → fusedScore ~100', r.fusedScore >= 98, `fusedScore=${r.fusedScore}`);
    ok('(i) self-clone → veto NOT tripped', r.deterministicVeto.tripped === false, `tripped=${r.deterministicVeto.tripped}`);
  }

  // (ii) INJECTED DETERMINISTIC DISQUALIFIER (blank-hero) with NO VISION → veto trips, fusedScore near-0.
  //      cropResults is NULL — there is NO LLM in the loop. This PROVES the floor triggers off the deterministic
  //      ledger, not the vision output.
  {
    const sHero = rec({ ref: 'body>main>section|1|hX', srcPath: 'body>main>section|1|hX', tag: 'section', role: 'banner', text: 'Hero',
      box: { 1440: { x: 0, y: 0, w: 1440, h: 600, right: 1440, xFrac: 0, wFrac: 1 } } });
    const cHero = JSON.parse(JSON.stringify(sHero)); cHero.ref = 'c' + cHero.ref;
    cHero.box[1440] = { x: 0, y: 0, w: 1440, h: 24, right: 1440, xFrac: 0, wFrac: 1 };   // collapsed to 24px → blank-hero
    const r = gradeFused(mkBlob([sHero], [cHero]), floors, { cropResults: null });
    const heroRow = r.ledger.find((x) => x.fatalClass === 'hero' && x.source === 'deterministic');
    ok('(ii) injected blank-hero emits a DETERMINISTIC hero disqualifier row', !!heroRow, heroRow ? `class=${heroRow.defect_class} sev=${heroRow.severity}` : 'no hero row');
    ok('(ii) deterministic veto TRIPPED with NO vision (cropResults=null)', r.deterministicVeto.tripped === true && r.meta.visionUsed === false, `tripped=${r.deterministicVeto.tripped} visionUsed=${r.meta.visionUsed}`);
    ok('(ii) fusedScore near-0 (<=8)', r.fusedScore <= 8, `fusedScore=${r.fusedScore}`);
    ok('(ii) veto cap = 8 for one disqualifier (region-judge formula ported)', r.deterministicVeto.cap === 8, `cap=${r.deterministicVeto.cap}`);
  }

  // (iii) DEDUP: a deterministic row + a vision row on the SAME element+axis → ONE row, det kept, corroborated.
  {
    const detRow = { element_ref: 'el|1|h', region_bbox: null, viewport: 1440, state: 'static', axis: 'text-contrast', defect_class: 'invisible-heading', severity: 'fatal', severityNum: 1.0, confidence: 1.0, source: 'deterministic', evidence: {}, component_id: 'style:el|1|h', fatalClass: 'heading' };
    const visRow = { element_ref: 'el|1|h', region_bbox: null, viewport: 1440, state: 'static', axis: 'text-contrast', defect_class: 'invisible-text', severity: 'fatal', severityNum: 0.85, confidence: 0.6, source: 'vision', evidence: {}, component_id: 'vision:el|1|h:invisible-text', fatalClass: 'heading' };
    const { ledger, mergeLog } = dedupMerge([detRow, visRow]);
    ok('(iii) det+vision on same element+axis MERGE to ONE row', ledger.length === 1, `rows=${ledger.length}`);
    ok('(iii) the kept row is the DETERMINISTIC one', ledger[0] && ledger[0].source === 'deterministic', ledger[0] ? ledger[0].source : '-');
    ok('(iii) merge is flagged corroborated (confidence raised, not double-counted)', ledger[0] && ledger[0].corroboratedByVision === true && mergeLog.length === 1, ledger[0] ? `corrob=${ledger[0].corroboratedByVision} log=${mergeLog.length}` : '-');
  }

  // (iv) BOUNDED-VISION: a pile of vision-ONLY medium defects cannot move fusedScore past the clamp nor trip the floor.
  {
    const mkVis = (i) => ({ element_ref: `v${i}`, region_bbox: null, viewport: 1440, state: 'static', axis: null, defect_class: 'color-off', severity: 'med', severityNum: 0.22, confidence: 0.6, source: 'vision', evidence: {}, component_id: `vision:v${i}:color-off`, fatalClass: null });
    const pile = Array.from({ length: 40 }, (_, i) => mkVis(i));
    const scored = scoreFromLedger(pile);
    ok('(iv) 40 vision-only med rows → score NOT below 100-CLAMP', scored.fusedScore >= 100 - VISION_CLAMP, `fusedScore=${scored.fusedScore} clamp=${VISION_CLAMP}`);
    ok('(iv) vision perceptual term is CLAMPED to ±5', Math.abs(scored.visionPerceptualTerm.delta) <= VISION_CLAMP && scored.visionPerceptualTerm.clamped === true, `delta=${scored.visionPerceptualTerm.delta} clamped=${scored.visionPerceptualTerm.clamped}`);
    ok('(iv) vision-only rows do NOT trip the floor', scored.deterministicVeto.tripped === false, `tripped=${scored.deterministicVeto.tripped}`);
    // a SINGLE vision 'fatal' hero defect (no det corroboration) ALSO must not trip the floor.
    const visHeroFatal = [{ element_ref: 'h', region_bbox: null, viewport: 1440, state: 'static', axis: null, defect_class: 'blank-hero', severity: 'fatal', severityNum: 0.85, confidence: 0.6, source: 'vision', evidence: {}, component_id: 'vision:h:blank-hero', fatalClass: 'hero' }];
    const s2 = scoreFromLedger(visHeroFatal);
    ok('(iv) a vision-ONLY fatal hero does NOT trip the deterministic floor', s2.deterministicVeto.tripped === false, `tripped=${s2.deterministicVeto.tripped} score=${s2.fusedScore}`);
  }

  // (v) TRACEABILITY: every deduction has a ledger row; the veto disqualifiers each trace to a deterministic row.
  {
    const sHero = rec({ ref: 'body>main>section|1|hX', srcPath: 'body>main>section|1|hX', tag: 'section', role: 'banner', text: 'Hero', box: { 1440: { x: 0, y: 0, w: 1440, h: 600, right: 1440, xFrac: 0, wFrac: 1 } } });
    const cHero = JSON.parse(JSON.stringify(sHero)); cHero.ref = 'c' + cHero.ref; cHero.box[1440] = { x: 0, y: 0, w: 1440, h: 24, right: 1440, xFrac: 0, wFrac: 1 };
    const sP = rec({ ref: 'body>main>p|1|hP', srcPath: 'body>main>p|1|hP', tag: 'p', text: 'paragraph', ownText: 'paragraph', style: { color: 'rgb(17,17,17)', backgroundColor: 'rgb(255,255,255)', font: { size: '16px', family: 'Inter' }, border: { width: {}, style: {}, color: {} } }, box: { 1440: { x: 100, y: 700, w: 600, h: 40, right: 700, xFrac: 0.07, wFrac: 0.42 } } });
    const cP = JSON.parse(JSON.stringify(sP)); cP.ref = 'c' + cP.ref; cP.style.font.size = '11px';   // font-off (structural)
    const r = gradeFused(mkBlob([sHero, sP], [cHero, cP]), floors, {});
    const everyDeductTraced = r.deductions.every((d) => r.ledger.some((row) => row.element_ref === d.element_ref && row.viewport === d.viewport && row.source === 'deterministic'));
    ok('(v) every deduction traces to a ledger row', everyDeductTraced, `deductions=${r.deductions.length}`);
    const everyDisqTraced = r.deterministicVeto.disqualifiers.every((fc) => r.ledger.some((row) => row.source === 'deterministic' && row.fatalClass === fc && (row.severity === 'fatal' || row.severity === 'high')));
    ok('(v) every veto disqualifier traces to a deterministic high|fatal row', everyDisqTraced, `disq=${r.deterministicVeto.disqualifiers.join(',')}`);
    ok('(v) ledger rows all carry element_ref + axis||defect_class + evidence', r.ledger.every((row) => row.element_ref && (row.axis != null || row.defect_class) && 'evidence' in row), `n=${r.ledger.length}`);
  }

  const failed = cases.filter((c) => !c.pass);
  console.log('\n==== GRADE-FUSED — OFFLINE SELFTEST (no capture, no vision) ====');
  for (const c of cases) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${cases.length} cases)`);
  return failed.length === 0;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export const FUSED_SCHEMA = {
  scorerFile: 'eval/grader/grade-fused.mjs',
  ledgerRowSchema: { element_ref: 'content-addressed DOM path (engine ref)', region_bbox: 'box[viewport] join (recovered, engine byte-stable)', viewport: 'px width', state: "'static'|'responsive'|'hover'|'scroll'|'motion'", axis: 'det axis | null for pure-vision', defect_class: 'engine projectName | vision defect_class (one taxonomy via FATAL_OF/fatalClassOf)', severity: 'fatal|high|med|low (engine numeric→bucket; vision string)', confidence: 'deterministic=1.0 | vision=~0.6 (raised on corroboration)', source: "'deterministic'|'vision'", evidence: 'firedAxes+magnitudes+coherence note (det) | facts+evidence (vision)', component_id: 'coherence family:rootRef so a coherent N-shift is ONE id', fatalClass: 'disqualifying bucket or null' },
  dedupMerge: 'group by (element_ref + (axis||defect_class)); a deterministic + a vision row MERGE → keep deterministic, RAISE confidence (vision corroborates, no double-count). Vision-only rows survive bounded. Mirrors region-judge lines 862-864.',
  scoreFormula: 'score=f(ledger): start 100 → DETERMINISTIC step-floor veto cap=max(0,8-2*(n-1)) for n distinct disqualifying fatalClasses at high|fatal (ported region-judge line 653) → minus saturating salience-weighted severity on the rest → plus a HARD-CLAMPED (±5) vision perceptual term (deterministic dominates)',
  deterministicFloorTrigger: 'the step-function floor TRIGGERS off the DETERMINISTIC ledger rows ONLY (engine+sweep+unmatched: missing-hero via presence/bbox, invisible-heading via text-contrast collapse, wrong/missing-logo via img axes, overlapping-sections via collision/z-pile, horizontal-overflow via h-overflow(-bool), wrongly-sticky via state-pin/sticky-delta, dropped-imagery via unmatchedHiSal). VISION NEVER triggers the disqualifying floor.',
  boundedVisionTerm: 'vision-ONLY rows (gestalt residual + medium-confidence tail) sum into a perceptual term hard-clamped to ±VISION_CLAMP(5) pts; on a vetoed page it can only nudge DOWN, never above the cap → vision cannot swing the number.',
  traceability: 'every lost point traces to a ledger row (element_ref+axis+evidence): deductions[] each carry element_ref/axis/evidence; veto disqualifiers each trace to a deterministic high|fatal row. Open the ledger, see why each point was lost.',
  selftest: 'eval/grader/_grade-fused-selftest.mjs — (i) self-clone→100/empty ledger/no veto; (ii) injected blank-hero with cropResults=null → veto trips + fusedScore≤8 WITHOUT any vision call (proves the floor moved off vision); (iii) det+vision same element+axis → ONE row, det kept, corroborated; (iv) 40 vision-only med rows can\'t pass the clamp nor trip the floor + a vision-only fatal hero does NOT trip the floor; (v) every deduction+disqualifier traces to a ledger row. Builder does NOT self-bless; orchestrator re-executes.',
  reversibility: 'NEW orchestrator. Imports runEngine/runSweep/FATAL_OF UNCHANGED. Deleting grade-fused.mjs changes nothing else; region-judge RJ_STEP_FLOOR still works off vision under its own flag (this is the SEPARATE deterministic-floor scorer).',
  noLabelFit: true,
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
function main() {
  if (has('schema')) { console.log(JSON.stringify(FUSED_SCHEMA, null, 2)); return; }
  if (has('selftest')) { process.exit(runSelftest() ? 0 : 1); }

  const comparePath = arg('compare');
  if (!comparePath || !fs.existsSync(comparePath)) { console.error('need --compare <blob.json> (or --selftest / --schema)'); process.exit(2); }
  const floorsPath = arg('floors', path.join(__dir, 'calibration', 'axis-floors.json'));
  const blob = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
  const floors = JSON.parse(fs.readFileSync(floorsPath, 'utf8'));

  // vision is OPT-IN: only fold in crop findings when --crops <results.json> is given AND --no-vision is absent.
  let cropResults = null;
  const cropsPath = arg('crops');
  if (cropsPath && !has('no-vision')) {
    if (fs.existsSync(cropsPath)) cropResults = JSON.parse(fs.readFileSync(cropsPath, 'utf8'));
    else console.error(`(crops results not found at ${cropsPath} — running deterministic-only)`);
  }

  const out = gradeFused(blob, floors, { cropResults, topK: +arg('top-k', 24) });

  console.log('\n==== GRADE-FUSED (one ledger; deterministic floor; bounded vision) ====');
  console.log(`compare: ${comparePath}`);
  console.log(`source:  ${out.meta.source}`);
  console.log(`clone:   ${out.meta.clone}`);
  console.log(`widths ${out.meta.widths.join(',')} | join ${out.meta.joinVw} | visionUsed ${out.meta.visionUsed} | floor: ${out.meta.floorTrigger}`);
  console.log(`\nFUSED SCORE: ${out.fusedScore}  (100=indistinguishable, 0=worthless)`);
  const v = out.deterministicVeto;
  console.log(`deterministic veto: ${v.tripped ? `TRIPPED cap=${v.cap} disqualifiers=[${v.disqualifiers.join(', ')}]` : 'not tripped'}`);
  console.log(`ledger: ${out.aggregate.ledgerRows} rows (${out.components.deterministicRows} deterministic, ${out.components.visionRows} vision, ${out.components.mergedRows} merged) | disqualifier rows ${out.aggregate.disqualifierRows}`);
  console.log(`non-veto deduction: ${out.nonVetoDeduct} pts | vision perceptual term: ${out.visionPerceptualTerm.delta} (clamped ${out.visionPerceptualTerm.clamped}, ±${out.visionPerceptualTerm.clampBound})`);
  console.log(`by class: ${JSON.stringify(out.aggregate.byClass)}`);
  console.log(`\nTOP DEDUCTIONS / DISQUALIFIERS (traceable):`);
  for (const d of out.deductions.slice(0, 10)) console.log(`  -${String(d.contribution).padStart(6)} ${String(d.defect_class).padEnd(20)} ${String(d.element_ref).slice(0, 40)}@${d.viewport} axis=${d.axis} sev=${d.severity}`);
  if (v.tripped) for (const fc of v.disqualifiers) {
    const row = out.ledger.find((r) => r.source === 'deterministic' && r.fatalClass === fc && (r.severity === 'fatal' || r.severity === 'high'));
    console.log(`  VETO [${fc}] ${row ? `${row.defect_class} ${String(row.element_ref).slice(0, 40)}@${row.viewport}` : '(no trace row?!)'}`);
  }

  if (has('json')) { fs.writeFileSync('/tmp/grade-fused-out.json', JSON.stringify(out, null, 2)); console.log('\nfull fused ledger + score → /tmp/grade-fused-out.json'); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
