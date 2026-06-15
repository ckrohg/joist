#!/usr/bin/env node
/**
 * @purpose axisdelta-floor.mjs — PHASE 2 of the upleveled grader (fusion #3): the LEARNED PER-AXIS
 * TOLERANCE FLOOR, derived from a NOISE corpus that NEVER sees a defect label.
 *
 * THE ANTI-OVERFIT CONTRACT (this project was previously burned by a grader anti-correlated with humans —
 * "looks done" is worthless; only a frozen, falsifiable test counts):
 *   (A) the per-axis tolerance FLOORS come from a NOISE corpus, NEVER from the ~26 human defect labels. The
 *       noise corpus is built two ways, both label-blind by construction:
 *         (a) RECAPTURE the SAME source N times  → identical-input pairs. Catches scroll jitter / lazy-load
 *             timing / anti-aliasing. (Static sites are DOM-deterministic ⇒ this term is ~0 on most axes —
 *             which is the HONEST answer: it means semantic_min, not jitter, sets those floors.)
 *         (b) CLEAN-PROJECTION-CLONE vs SOURCE → the systematic, defect-FREE offset the builder ALWAYS adds
 *             (rounding, default line-height, sub-pixel hinting). Requires a VERIFIED-CLEAN round-trip clone.
 *             When none is available (no WP auth / no clean bake cached), this term is OMITTED and flagged —
 *             NEVER substituted with a labeled-broken clone (341/268 are human-scored BROKEN: doing so would
 *             absorb real defects into the floor, exactly the leak the self-consistency audit below catches).
 *   (B) the floor is built in RATIO / PERCEPTUAL form — bbox-RATIO (not Δpx), CIEDE2000 ΔE (not ΔRGB),
 *       log-size-ratio / font-RATIO — so a 1px wobble on a 1000px box is not the same "delta" as on a 10px box.
 *   floor_a = max( semantic_min(a) , P99(self-clone noise) , median+k·MAD ).  semantic_min is a PERCEPTUAL
 *       PRIOR (JND-level: ΔE≈2.3, contrast≈0.5, bbox≈2%), NOT fit to labels. SALIENCE-TIGHTEN: on the
 *       hero/logo/H1/CTA buckets the noise term uses P95 (tighter) instead of P99 — a defect on the most
 *       human-salient elements must trip at a lower excess.
 *   excess = max(0, raw_delta − floor_a);  trip = excess > 0.  FROZEN to a git-trackable JSON
 *       (calibration/axis-floors.json) for provenance.
 *
 * SELF-CONSISTENCY (the spec's mandated audit, NOT a vanity check): re-run the floored engine over the SAME
 * noise corpus — by construction it should fire ~1% per axis (the P99 cut). If a LARGE excess appears on a
 * "clean" pair, the clean clone was NOT clean (a real defect contaminated it) ⇒ INVESTIGATE + REPORT, do NOT
 * raise the floor to hide it. This script PROVES that on the two labeled-broken clones (341/268): their
 * deltas blow far past the noise floor (color-ΔE med ~30, contrast-collapse ~11.6), which is WHY they are
 * EXCLUDED from the noise corpus — the audit demonstrates the exclusion was correct, auditable, not silent.
 *
 * The engine-floor corpus stays INSPECTABLE (calibration/axis-floors.json carries, per axis/viewport/bucket:
 * the floor, which TERM won it (semantic_min | P99 | median+kMAD), the noise sample size, and any one-sided/
 * omitted-term caveat) — auditable known-debt, never a silent eraser.
 *
 * CLI:
 *   node axisdelta-floor.mjs --build  [--recapture /tmp/recapture-noise.json] [--k 3] [--out calibration/axis-floors.json]
 *       → builds + FREEZES the floors from the noise corpus, prints the per-axis table + the self-consistency
 *         report (noise fire-rate ≈1% + the 341/268 contamination audit). Default action.
 *   node axisdelta-floor.mjs --apply  --compare /tmp/compare-XXX.json [--floors calibration/axis-floors.json]
 *       → loads the FROZEN floors, runs the floored engine over a compare blob, emits excess-only trips.
 *
 * SAFETY: PURE w.r.t. hosts here — reads the recapture-noise json (produced read-only by _recapture-noise.mjs)
 * + cached compare blobs. No network, no builder, no git. Additive: imports grade-element-crops.mjs +
 * compare-capture.mjs UNCHANGED. Reversible (delete this file + the frozen json; nothing else changes).
 *
 * Falsifier: _axisdelta-floor-falsifier.mjs (the orchestrator re-executes it — the builder does NOT self-bless).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as M from './grade-element-crops.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// PERCEPTUAL PRIORS (anti-overfit rule B) — these are JND / minimum-perceptible thresholds, set from human
// perception literature + the axis's measurement form, NOT fit to the human defect labels. They are the
// FLOOR-OF-THE-FLOOR: even with zero noise, a delta below semantic_min is imperceptible and must not trip.
// Every value is in the axis's RATIO / PERCEPTUAL unit (the unit axisDeltas() emits).
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export const SEMANTIC_MIN = {
  // bbox-ratio is |1 − clone/src| on max(w,h). ~5% size/position drift is the smallest a human reliably
  // notices on a content box; below it is sub-pixel rounding + line-height defaults (the builder's offset).
  'bbox-ratio': 0.05,
  // color-deltaE is CIEDE2000. JND ≈ 2.3; we set 3.0 (the "same colour" threshold compare-detectors uses)
  // so anti-aliasing / sub-pixel colour blends never trip, but a real recolour (ΔE≫10) always does.
  'color-deltaE': 3.0,
  // text-contrast delta is a WCAG-ish ratio difference. 0.5 ratio is below human discriminability for
  // readability; a real contrast COLLAPSE (the invisible-heading axis) is many ratio points.
  'text-contrast': 0.5,
  // font-size-ratio |1 − clone/src|. ~3% (≈0.5px on a 16px body) is hinting/rounding; a real font-off is ≫.
  'font-size-ratio': 0.03,
  // h-overflow is ONE-SIDED (delta = (cloneRight − vw)/vw, src=null) — NOT a symmetric src↔clone delta, so the
  // recapture-noise term is meaningless for it (a same-source pair still carries the absolute overflow). Its
  // floor is semantic_min ONLY: 4% past the viewport edge is the smallest overflow a human notices as a
  // sideways scrollbar. Flagged ONE_SIDED below so the inspectable file records the caveat.
  'h-overflow': 0.04,
  // presence is binary (0/1). A real missing element is a full unit; the floor must be < 1 so a true
  // miss trips, but > 0 so benign responsive-visibility flicker (an element lazily hidden at one width on a
  // recapture) does not. 0.5 is the natural midpoint of a binary axis.
  presence: 0.5,
  // perceptual image hashes (Hamming distance on 64 bits / svg-hash 0|64 / src-equality 0|1). A few bits of
  // dHash drift is JPEG/AA noise; the spine's TOL.dHashDist=12 is the perceptual "different picture" line.
  'img-phash': 12,
  'img-svghash': 1,      // svg markup hash is exact (0 or 64); <1 means "identical markup".
  'img-src': 0.5,        // natural-src equality is 0/1; 0.5 splits it so a true src swap trips.
};

// AXES whose delta is ONE-SIDED (an absolute position / not a symmetric src↔clone difference). The
// recapture-noise term is NOT meaningful for these (same-source pairs still carry the absolute value), so
// the floor uses semantic_min ONLY and the noise distribution is recorded for inspection but NOT used.
export const ONE_SIDED_AXES = new Set(['h-overflow']);

// POSITIVE-DIRECTIONAL axes: a defect exists ONLY when the SIGNED delta is positive. h-overflow's delta is
// (cloneRight − vw)/vw — POSITIVE means the box spills past the viewport edge (the defect); NEGATIVE means the
// box sits comfortably inside the viewport (GOOD). Using |delta| here would flag an in-viewport element (a
// large negative) as overflow — a false positive the self-clone falsifier (F2) correctly catches. For these
// axes the excess uses the SIGNED delta, not the absolute value.
export const POSITIVE_DIRECTIONAL_AXES = new Set(['h-overflow']);
function directedMagnitude(axis, delta) { return POSITIVE_DIRECTIONAL_AXES.has(axis) ? delta : Math.abs(delta); }

// BINARY axes emit a delta of {0, POSITIVE} (presence 0|1; img-src 0|1; img-svghash 0|64). A noise quantile of
// the POSITIVE value (e.g. P99(presence)=1 from benign responsive-visibility flicker at a narrow width) would
// push the floor up to the full unit and the axis would NEVER trip — silently blinding the engine to a REAL
// miss. So a binary axis's floor is HARD-CAPPED strictly below its positive value (floor = min(raw, posVal·cap)):
// a true miss still trips, while the observed flicker RATE is recorded as inspectable debt (not erased). This is
// the self-consistency principle applied at build time: a high noise quantile on a binary axis is a contamination
// SIGNAL to record, not a floor to silently raise to the ceiling.
export const BINARY_AXES = { presence: 1, 'img-src': 1, 'img-svghash': 64 };
const BINARY_FLOOR_CAP = 0.75; // floor may rise to at most 75% of the positive unit (leaves headroom to trip)

// k for the median+k·MAD robust-tail term (≈ P99-ish for a normal; here the noise is near-degenerate so this
// term is usually 0 and semantic_min wins — that is the honest outcome on DOM-deterministic sources).
export const DEFAULT_K = 3;

// SALIENCE BUCKETS (perceptual prior; derived from role/asset/text/geometry, NOT labels). The hero/logo/h1/cta
// buckets are the most human-salient — a defect there is maximally visible — so their noise term is TIGHTENED
// to P95 (vs P99 for body). This is the SALIENCE-TIGHTEN the spec mandates.
export const SALIENT_BUCKETS = new Set(['hero', 'logo', 'h1', 'cta']);
export function salienceBucket(el, vw) {
  const role = (el && el.role) || '';
  const txt = ((el && (el.text || el.ownText)) || '').toLowerCase();
  const box = el && el.box && el.box[vw];
  const isImg = !!(el && el.asset && el.asset.isImage);
  const fold = box && box.y != null && box.y < 1000;
  if (fold && (/\b(logo|brand|wordmark)\b/.test(txt) || (isImg && box && box.y < 120))) return 'logo';
  if ((role === 'button') || (role === 'link' && el.style && /rgb|#/.test((el.style.backgroundColor) || ''))) {
    if (fold) return 'cta';
  }
  if (role === 'heading') {
    const fs = parseFloat(el.style && el.style.font && el.style.font.size) || 0;
    if (fold && fs >= 28) return 'h1';           // a large fold heading = H1/hero headline
    return 'body';
  }
  if (fold && box) {
    const area = (box.w || 0) * (box.h || 0);
    if (area > vw * 360) return 'hero';          // a large fold element ⇒ hero band
  }
  return 'body';
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// PURE STATS
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function quantile(sortedAsc, q) {
  if (!sortedAsc.length) return null;
  const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(q * (sortedAsc.length - 1))));
  return sortedAsc[i];
}
export function medianMAD(arr) {
  const a = arr.filter((x) => isFinite(x)).slice().sort((x, y) => x - y);
  if (!a.length) return { median: null, mad: null, n: 0 };
  const median = quantile(a, 0.5);
  const dev = a.map((x) => Math.abs(x - median)).sort((x, y) => x - y);
  const mad = quantile(dev, 0.5);
  return { median, mad, n: a.length };
}
function statBlock(arr) {
  const a = arr.filter((x) => isFinite(x)).slice().sort((x, y) => x - y);
  const { median, mad } = medianMAD(a);
  return { n: a.length, median, mad, p95: quantile(a, 0.95), p99: quantile(a, 0.99), max: a.length ? a[a.length - 1] : null };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// NOISE-CORPUS COLLECTION (label-blind by construction)
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// (a) RECAPTURE: same source N times → ref-joined identical-input pairs. ref (= srcPath = content-addressed
//     DOM path) is STABLE + UNIQUE across recaptures (verified 963/963), so it is the correct correspondence
//     key (NOT array index / _idx, which does not survive the multi-viewport merge).
export function collectRecaptureNoise(recap, widths) {
  // returns { samples: { 'axis|vw|bucket': [magnitude...] }, meta }. Magnitude = |delta| for symmetric axes,
  // SIGNED delta for positive-directional axes (h-overflow) so the self-consistency check reads them correctly.
  const samples = {};
  const push = (axis, vw, bucket, d) => { (samples[`${axis}|${vw}|${bucket}`] ||= []).push(directedMagnitude(axis, d)); };
  let pairs = 0; const perSource = {};
  for (const key of Object.keys(recap.sources || {})) {
    const runs = (recap.sources[key].runs || []).filter((r) => r.records);
    const archetype = recap.sources[key].archetype || 'unknown';
    perSource[key] = { archetype, runs: runs.length, recordPairs: 0 };
    for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
      const A = runs[i].records, B = runs[j].records;
      const byB = Object.fromEntries(B.map((r) => [r.ref, r]));
      for (const vw of widths) {
        for (const s of A) {
          const c = byB[s.ref]; if (!c) continue;
          const bucket = salienceBucket(s, vw);
          for (const row of M.axisDeltas(s, c, vw, {})) {
            if (row.delta == null) continue;
            push(row.axis, vw, bucket, row.delta);
            perSource[key].recordPairs++; pairs++;
          }
        }
      }
    }
  }
  return { samples, meta: { kind: 'recapture', pairs, perSource } };
}

// (b) CLEAN-PROJECTION-CLONE vs SOURCE: the builder's defect-FREE systematic offset. Requires a VERIFIED-CLEAN
//     round-trip clone (a compare blob the operator has certified defect-free). We do NOT auto-pick a labeled
//     clone — that would leak defects into the floor. If no clean blob is supplied, this term is OMITTED + the
//     omission is recorded in the frozen file (honest gap), never substituted.
export function collectCleanProjectionNoise(cleanBlobs, widths) {
  const samples = {};
  const push = (axis, vw, bucket, d) => { (samples[`${axis}|${vw}|${bucket}`] ||= []).push(directedMagnitude(axis, d)); };
  let pairs = 0; const perBlob = [];
  for (const cb of cleanBlobs) {
    const blob = JSON.parse(fs.readFileSync(cb.path, 'utf8'));
    let bp = 0;
    for (const vw of (cb.widths || widths)) {
      const { pairs: prs } = M.readPairs(blob, vw);
      for (const { sEl, cEl } of prs.filter((p) => p.cEl)) {
        const bucket = salienceBucket(sEl, vw);
        for (const row of M.axisDeltas(sEl, cEl, vw, {})) {
          if (row.delta == null) continue;
          push(row.axis, vw, bucket, row.delta); bp++; pairs++;
        }
      }
    }
    perBlob.push({ path: cb.path, archetype: cb.archetype, certifiedCleanBy: cb.certifiedCleanBy || null, recordPairs: bp });
  }
  return { samples, meta: { kind: 'clean-projection', pairs, perBlob } };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// FLOOR COMPUTATION  floor_a = max( semantic_min , P99(noise) , median+k·MAD ) ; P95 on salient buckets
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function computeFloors(noiseSamples, { k = DEFAULT_K } = {}) {
  // noiseSamples: { 'axis|vw|bucket': [|delta|...] }  (merged across all noise sources)
  const floors = {}; // axis -> vw -> bucket -> {floor, won, terms, n, caveats}
  for (const compoundKey of Object.keys(noiseSamples)) {
    const [axis, vwS, bucket] = compoundKey.split('|');
    const vw = +vwS;
    const arr = noiseSamples[compoundKey];
    const st = statBlock(arr);
    const semMin = SEMANTIC_MIN[axis] != null ? SEMANTIC_MIN[axis] : 0;
    const oneSided = ONE_SIDED_AXES.has(axis);
    // SALIENCE-TIGHTEN: salient buckets use P95 (tighter) for the noise term; body uses P99.
    const noiseQ = SALIENT_BUCKETS.has(bucket) ? (st.p95 ?? 0) : (st.p99 ?? 0);
    const robustTail = (st.median != null && st.mad != null) ? (st.median + k * st.mad) : 0;
    // ONE-SIDED axes: the recapture-noise term is NOT a symmetric src↔clone delta → DROP it; floor = semantic_min.
    let noiseTerm = oneSided ? 0 : noiseQ;
    const robustTerm = oneSided ? 0 : robustTail;
    const caveats = [];
    // BINARY-axis hard cap: never let the noise quantile push a 0|positive axis to (or past) the positive unit,
    // or it would never trip. Record the observed flicker rate as inspectable debt.
    if (BINARY_AXES[axis] != null) {
      const pos = BINARY_AXES[axis];
      const cap = pos * BINARY_FLOOR_CAP;
      if (noiseTerm > cap) {
        const flickerRate = +((arr.filter((x) => x >= pos * 0.5).length) / Math.max(1, arr.length)).toFixed(4);
        caveats.push(`BINARY-CAP: noise quantile ${(+noiseTerm).toFixed(3)} (≈positive unit) HARD-CAPPED to ${cap} so a true miss still trips. Observed benign-flicker rate=${flickerRate} (responsive-visibility/lazy churn at this width) — recorded as known debt, NOT silently absorbed into the floor.`);
        noiseTerm = cap;
      }
    }
    const terms = { semantic_min: semMin, noise_quantile: +(+noiseTerm).toFixed(5), 'median+kMAD': +(+robustTerm).toFixed(5) };
    let floor = Math.max(semMin, noiseTerm, robustTerm);
    let won = 'semantic_min';
    if (noiseTerm >= floor && noiseTerm > semMin) won = SALIENT_BUCKETS.has(bucket) ? 'P95(noise)' : 'P99(noise)';
    else if (robustTerm >= floor && robustTerm > semMin) won = 'median+kMAD';
    if (oneSided) caveats.push('ONE_SIDED: delta is an absolute position not a symmetric src↔clone delta → noise term dropped; floor=semantic_min');
    if (SALIENT_BUCKETS.has(bucket)) caveats.push('SALIENCE-TIGHTEN: P95 (not P99) on this human-salient bucket');
    ((floors[axis] ||= {})[vw] ||= {})[bucket] = {
      floor: +(+floor).toFixed(5), won, terms, salienceTightened: SALIENT_BUCKETS.has(bucket),
      noiseN: st.n, noiseStats: { median: st.median, mad: st.mad, p95: st.p95, p99: st.p99, max: st.max },
      caveats,
    };
  }
  return floors;
}

// floor lookup with graceful fallback: exact (axis,vw,bucket) → (axis,vw,body) → (axis,any-vw,bucket) →
// semantic_min. So an axis/bucket the noise corpus never populated still has a principled (perceptual-prior) floor.
export function lookupFloor(floors, axis, vw, bucket) {
  const a = floors[axis];
  const sem = SEMANTIC_MIN[axis] != null ? SEMANTIC_MIN[axis] : 0;
  if (!a) return { floor: sem, won: 'semantic_min(fallback:no-axis)' };
  const byVw = a[vw] || a[String(vw)];
  if (byVw && byVw[bucket]) return byVw[bucket];
  if (byVw && byVw.body) return { ...byVw.body, won: byVw.body.won + '(fallback:bucket→body)' };
  // any viewport
  for (const v of Object.keys(a)) { const bb = a[v]; if (bb && (bb[bucket] || bb.body)) { const f = bb[bucket] || bb.body; return { ...f, won: f.won + '(fallback:vw)' }; } }
  return { floor: sem, won: 'semantic_min(fallback)' };
}

// APPLY: excess = max(0, raw − floor); trip = excess > 0. Returns the floored axis rows for a corresponded pair.
export function applyFloors(floors, sEl, cEl, vw, opts = {}) {
  const bucket = salienceBucket(sEl || cEl, vw);
  const rows = M.axisDeltas(sEl, cEl, vw, opts);
  return rows.map((r) => {
    if (r.delta == null) return { ...r, bucket, floor: null, excess: null, trip: false };
    const fl = lookupFloor(floors, r.axis, vw, bucket);
    // directed magnitude: |delta| for symmetric axes; SIGNED delta for positive-directional axes (h-overflow) —
    // so an element comfortably INSIDE the viewport (negative overflow) never trips.
    const excess = Math.max(0, directedMagnitude(r.axis, r.delta) - fl.floor);
    const trip = excess > 0;
    return { ...r, bucket, floor: fl.floor, floorWon: fl.won, excess: +excess.toFixed(5), trip };
  });
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// SELF-CONSISTENCY AUDIT
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// (1) on the NOISE corpus the floored engine should fire ~1% per axis by construction (the P99 cut). A large
//     excess on a "clean" pair ⇒ the clean clone was NOT clean → INVESTIGATE (report, do not raise floor).
export function noiseSelfConsistency(floors, noiseSamples) {
  // We re-floor the noise sample VALUES directly (the samples ARE the per-axis magnitudes). fire-rate per axis
  // = frac with excess>0. directedMagnitude() applies (signed for positive-directional axes). BINARY axes whose
  // benign flicker we DELIBERATELY recorded as known debt (BINARY-CAP) are reported with that context so their
  // expected fire-rate is not mistaken for a leak.
  const perAxis = {};
  for (const compoundKey of Object.keys(noiseSamples)) {
    const [axis, vwS, bucket] = compoundKey.split('|');
    const fl = lookupFloor(floors, axis, +vwS, bucket);
    for (const d of noiseSamples[compoundKey]) {
      const a = (perAxis[axis] ||= { n: 0, fired: 0, maxExcess: 0, worst: null });
      a.n++;
      const excess = directedMagnitude(axis, d) - fl.floor;
      if (excess > 0) { a.fired++; if (excess > a.maxExcess) { a.maxExcess = +excess.toFixed(4); a.worst = { vw: +vwS, bucket, delta: +d.toFixed(4), floor: fl.floor }; } }
    }
  }
  const out = {};
  for (const ax of Object.keys(perAxis)) {
    const a = perAxis[ax];
    const rate = a.fired / Math.max(1, a.n);
    let verdict;
    if (ONE_SIDED_AXES.has(ax)) verdict = 'one-sided (noise term dropped — fire-rate here is BY DESIGN, not a leak)';
    else if (BINARY_AXES[ax] != null && rate > 0.06) verdict = 'binary known-debt (benign responsive/lazy flicker recorded under BINARY-CAP; a true miss still trips — see floor caveats)';
    else verdict = rate <= 0.06 ? 'OK (≈P95/P99 cut by construction)' : 'INVESTIGATE: fire-rate >6% on clean input — a clean pair may be contaminated';
    out[ax] = { n: a.n, fired: a.fired, fireRate: +rate.toFixed(4), maxExcess: a.maxExcess, worst: a.worst, verdict };
  }
  return out;
}

// (2) CONTAMINATION AUDIT on the labeled-broken clones (341/268): PROVE their deltas blow past the noise floor
//     (which is WHY they are excluded from the noise corpus). This is the spec's "INVESTIGATE, do not hide it":
//     the audit makes the exclusion auditable, not silent.
export function contaminationAudit(floors, labeledBlobs, widths) {
  const out = [];
  for (const lb of labeledBlobs) {
    if (!fs.existsSync(lb.path)) { out.push({ path: lb.path, error: 'missing' }); continue; }
    const blob = JSON.parse(fs.readFileSync(lb.path, 'utf8'));
    const perAxis = {};
    for (const vw of (lb.widths || widths)) {
      let prs; try { prs = M.readPairs(blob, vw).pairs; } catch { continue; }
      for (const { sEl, cEl } of prs.filter((p) => p.cEl)) {
        const bucket = salienceBucket(sEl, vw);
        for (const r of M.axisDeltas(sEl, cEl, vw, {})) {
          if (r.delta == null) continue;
          const fl = lookupFloor(floors, r.axis, vw, bucket);
          const excess = directedMagnitude(r.axis, r.delta) - fl.floor;
          const a = (perAxis[r.axis] ||= { n: 0, tripped: 0, sumExcess: 0, maxExcess: 0 });
          a.n++; if (excess > 0) { a.tripped++; a.sumExcess += excess; if (excess > a.maxExcess) a.maxExcess = +excess.toFixed(3); }
        }
      }
    }
    const axisRollup = {};
    for (const ax of Object.keys(perAxis)) { const a = perAxis[ax]; axisRollup[ax] = { n: a.n, tripped: a.tripped, tripRate: +(a.tripped / Math.max(1, a.n)).toFixed(3), meanExcess: +(a.sumExcess / Math.max(1, a.tripped || 1)).toFixed(3), maxExcess: a.maxExcess }; }
    out.push({ path: lb.path, label: lb.label, humanScore: lb.humanScore, axisRollup,
      verdict: 'CONTAMINATED — deltas far exceed the clean-noise floor (proves exclusion from the noise corpus was correct; this clone is BROKEN, not clean)' });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// MAIN
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const DEFAULT_FLOORS_PATH = path.join(__dir, 'calibration', 'axis-floors.json');

function buildMain() {
  const K = +arg('k', DEFAULT_K);
  const recapPath = arg('recapture', '/tmp/recapture-noise.json');
  const outPath = arg('out', DEFAULT_FLOORS_PATH);
  if (!fs.existsSync(recapPath)) { console.error(`[floor] recapture-noise file not found: ${recapPath} — run _recapture-noise.mjs first (read-only external capture).`); process.exit(2); }
  const recap = JSON.parse(fs.readFileSync(recapPath, 'utf8'));
  const widths = recap.widths || [1440, 390];

  // (a) recapture noise (proven clean, label-blind).
  const recapNoise = collectRecaptureNoise(recap, widths);

  // (b) clean-projection-clone noise — ONLY if a verified-clean blob is supplied via --clean-blob (path,arch).
  //     We do NOT auto-use 341/268 (labeled BROKEN). Absent a clean blob, this term is omitted + flagged.
  const cleanBlobArg = arg('clean-blob', null);
  let cleanNoise = { samples: {}, meta: { kind: 'clean-projection', pairs: 0, perBlob: [], omitted: true,
    reason: 'no VERIFIED-CLEAN round-trip clone supplied (--clean-blob). 341/268 are human-scored BROKEN and are DELIBERATELY excluded (using them would absorb real defects into the floor). Pending a clean bake / WP auth.' } };
  if (cleanBlobArg) {
    const [p, archetype, vwS] = cleanBlobArg.split(':');
    cleanNoise = collectCleanProjectionNoise([{ path: p, archetype: archetype || 'unknown', widths: vwS ? vwS.split(',').map(Number) : widths, certifiedCleanBy: arg('clean-by', 'operator') }], widths);
  }

  // MERGE the two label-blind noise sources.
  const merged = {};
  for (const src of [recapNoise.samples, cleanNoise.samples]) for (const k of Object.keys(src)) (merged[k] ||= []).push(...src[k]);

  const floors = computeFloors(merged, { k: K });

  // SELF-CONSISTENCY (1): noise fire-rate.
  const selfConsistency = noiseSelfConsistency(floors, merged);

  // SELF-CONSISTENCY (2): contamination audit on the labeled-broken clones.
  const labeled = [];
  if (fs.existsSync('/tmp/compare-341.json')) labeled.push({ path: '/tmp/compare-341.json', label: 'overreacted-341 (BROKEN, human=5)', humanScore: 5, widths });
  if (fs.existsSync('/tmp/compare-268.json')) labeled.push({ path: '/tmp/compare-268.json', label: 'tailwind-268 (BROKEN, human=0)', humanScore: 0, widths });
  const contamination = contaminationAudit(floors, labeled, widths);

  // FREEZE.
  const frozen = {
    _purpose: 'FROZEN per-axis tolerance FLOORS for the upleveled grader (axisdelta-floor PHASE 2). Floors come ONLY from a label-blind NOISE corpus (recapture-jitter + optional clean-projection offset); NEVER from defect labels. Apply: excess = max(0, raw_delta − floor); trip = excess>0. Inspectable known-debt: each entry records floor, winning term, noise N, and caveats.',
    _generated_by: 'axisdelta-floor.mjs --build',
    _generated_at_utc: new Date().toISOString().slice(0, 10),
    _anti_overfit: {
      floors_from: 'NOISE corpus only (label-blind by construction)',
      weights_from: 'NOT in this file (perceptual-prior semantic_min only; ~15 axis WEIGHTS live elsewhere, also prior-not-fit)',
      labels_role: 'VALIDATION ONLY — the 341/268 contamination audit below uses labels to PROVE the excluded clones are broken; no label tunes a floor',
      salience_tighten: 'hero/logo/h1/cta buckets use P95 (tighter) on the noise term; body uses P99',
    },
    k: K,
    widths,
    semantic_min: SEMANTIC_MIN,
    one_sided_axes: [...ONE_SIDED_AXES],
    salient_buckets: [...SALIENT_BUCKETS],
    noiseCorpus: {
      recapture: recapNoise.meta,
      cleanProjection: cleanNoise.meta,
      totalLabelBlindSamples: Object.values(merged).reduce((a, b) => a + b.length, 0),
    },
    floors,
    selfConsistency,
    contaminationAudit: contamination,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(frozen, null, 2));

  // ── human-readable ──
  console.log('\n==== AXIS-DELTA FLOOR (PHASE 2 — learned per-axis tolerance from a label-blind NOISE corpus) ====');
  console.log(`noise corpus: recapture ${recapNoise.meta.pairs} axis-samples (${Object.keys(recapNoise.meta.perSource).join(', ')}); clean-projection ${cleanNoise.meta.pairs} samples${cleanNoise.meta.omitted ? ' (OMITTED — no verified-clean blob)' : ''}`);
  console.log(`k=${K}  widths=${widths.join(',')}  → FROZEN ${outPath}`);
  console.log('\nPER-AXIS FLOORS (axis @vw [bucket] = floor  ⟵ winning term):');
  for (const axis of Object.keys(floors).sort()) {
    for (const vw of Object.keys(floors[axis])) {
      for (const bucket of Object.keys(floors[axis][vw])) {
        const f = floors[axis][vw][bucket];
        console.log(`  ${axis.padEnd(16)} @${String(vw).padEnd(4)} [${bucket.padEnd(5)}] = ${String(f.floor).padEnd(8)} ⟵ ${f.won}  (noiseN ${f.noiseN}${f.caveats.length ? '; ' + f.caveats[0].split(':')[0] : ''})`);
      }
    }
  }
  console.log('\nSELF-CONSISTENCY (noise fire-rate — must be ≈1% body / ≈5% salient by construction):');
  for (const ax of Object.keys(selfConsistency).sort()) { const s = selfConsistency[ax]; console.log(`  ${ax.padEnd(16)} fire ${(s.fireRate * 100).toFixed(2)}% (${s.fired}/${s.n}) maxExcess ${s.maxExcess} — ${s.verdict}`); }
  console.log('\nCONTAMINATION AUDIT (labeled-broken 341/268 — PROVES the exclusion was correct, not silent):');
  for (const c of contamination) {
    if (c.error) { console.log(`  ${c.path}: ${c.error}`); continue; }
    const hot = Object.entries(c.axisRollup).filter(([, v]) => v.maxExcess > 5).map(([k, v]) => `${k}(trip ${(v.tripRate * 100).toFixed(0)}%, maxExcess ${v.maxExcess})`);
    console.log(`  ${c.label}: ${hot.length ? hot.join(', ') : 'no axis far past floor'}`);
    console.log(`     → ${c.verdict}`);
  }
  console.log(`\nfull inspectable floors + audit → ${outPath}`);
  return frozen;
}

function applyMain() {
  const floorsPath = arg('floors', DEFAULT_FLOORS_PATH);
  const comparePath = arg('compare');
  if (!comparePath || !fs.existsSync(comparePath)) { console.error('--apply needs --compare <blob.json>'); process.exit(2); }
  if (!fs.existsSync(floorsPath)) { console.error(`frozen floors not found: ${floorsPath} — run --build first.`); process.exit(2); }
  const { floors } = JSON.parse(fs.readFileSync(floorsPath, 'utf8'));
  const blob = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
  const widths = blob.report.widths || [1440];
  const trips = []; let total = 0;
  for (const vw of widths) {
    let prs; try { prs = M.readPairs(blob, vw).pairs; } catch { continue; }
    for (const { sEl, cEl } of prs.filter((p) => p.cEl)) {
      for (const r of applyFloors(floors, sEl, cEl, vw, {})) { total++; if (r.trip) trips.push({ ref: r.ref, vw, axis: r.axis, class: r.class, delta: r.delta, floor: r.floor, excess: r.excess, bucket: r.bucket }); }
    }
  }
  console.log(`\n==== APPLY FROZEN FLOORS → ${comparePath} ====`);
  console.log(`floored axis rows: ${total}  | TRIPS (excess>0): ${trips.length}`);
  const byClass = {}; for (const t of trips) byClass[t.class || t.axis] = (byClass[t.class || t.axis] || 0) + 1;
  console.log(`by class: ${JSON.stringify(byClass)}`);
  for (const t of trips.slice(0, 12)) console.log(`  TRIP ${t.ref}@${t.vw} [${t.bucket}] ${t.axis} delta=${t.delta} floor=${t.floor} excess=${t.excess}`);
  if (has('json')) console.log('\n' + JSON.stringify({ total, trips }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (has('apply')) applyMain();
  else buildMain(); // default
}
