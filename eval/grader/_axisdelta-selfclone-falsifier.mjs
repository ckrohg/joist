#!/usr/bin/env node
/**
 * @purpose _axisdelta-selfclone-falsifier.mjs — THE SELF-CLONE FALSIFIER (Phase-1 de-risk gate for the
 * upleveled grader, fusion #3). It runs the SOURCE capture vs ITSELF — a PERFECT clone, the source records
 * stand in as BOTH sides — through the FULL grade-element-crops axis-delta pipeline (readPairs →
 * axisDeltas), at every captured viewport, and asserts the engine fires ZERO defects and scores ~100.
 *
 * WHY THIS GATES EVERYTHING (the cheapest catch in the whole system): a perfect clone is, by definition,
 * byte-identical to the source on every axis. If the axis-delta engine flags ANY defect on identical input,
 * the engine is a pure FALSE-POSITIVE / confidently-wrong machine — and any tolerance FLOOR or axis WEIGHT
 * built on top of it inherits that leak. This project was previously burned by a grader anti-correlated with
 * humans; "looks done" is worthless. A self-clone scoring < ~100 or firing > 0 defects is a hard STOP: the
 * leaking axes must be fixed BEFORE the noise-corpus floor or the perceptual-prior weights are layered on.
 *
 * FAITHFUL — not a shortcut. It does NOT just loop `axisDeltas(sEl, sEl)`. It synthesizes a genuine
 * self-clone COMPARE BLOB (cloneCapture := a deep copy of sourceCapture; correspondence relation/matched
 * wired so every source ref maps to ITSELF; zero unmatched), then drives the REAL exported readPairs() to
 * re-derive the corresponded pairs exactly as the spine's main() does, and runs the REAL exported
 * axisDeltas() over those pairs. So presence / bbox-ratio / text-contrast / color-ΔE / font-size-ratio /
 * h-overflow / img-* are ALL exercised on the true self-correspondence — including the degenerate-wrapper
 * guard and the missing-element path (which must yield NO missing pairs for a self-clone). The single axis
 * that needs pixels (img-phash) is additionally exercised with SYNTHETIC identical native crops so it too is
 * proven silent on identical input — fully offline, no network, no re-shoot, deterministic & frozen.
 *
 * SCORE: selfCloneScore = 100 × (1 − flaggedAxisRows / totalAxisRows), averaged across viewports. A perfect
 * clone ⇒ flaggedAxisRows = 0 ⇒ 100.00. selfCloneDefects = total flagged axis rows across all viewports.
 * leakingAxes = the DISTINCT axis names that fired on identical input (empty on a clean engine). If non-zero,
 * the report lists, per axis, a few concrete leaking refs so the leak is diagnosable, not just counted.
 *
 * SOURCE: the v4 overreacted capture — cached blob /tmp/compare-341.json (page 341 vs overreacted.io,
 * stampRate 91.3%). Override with --compare <blob.json>. This script READS the blob only; it never captures,
 * never renders, never touches a builder. No host is contacted (the self-clone url is the SOURCE url, used as
 * a label only — no fetch). No git. Additive: imports grade-element-crops.mjs unchanged.
 *
 * Run:  node _axisdelta-selfclone-falsifier.mjs [--compare /tmp/compare-341.json] [--json]
 *       exit 0 = PASS (zero defects, score ~100) ; exit 1 = FALSIFIED (a leak — engine is false-positive)
 *
 * Builder does NOT self-bless — the orchestrator re-executes this falsifier.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import * as M from './grade-element-crops.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

const COMPARE = arg('compare', '/tmp/compare-341.json');
const AS_JSON = has('json');
const __dir = path.dirname(fileURLToPath(import.meta.url));

// ── deep-copy + wire a genuine SELF-CLONE compare blob: clone := source, every ref corresponds to ITSELF ──
// This is the load-bearing construction. We do NOT fabricate a clean correspondence by hand-picking matches;
// we map EVERY source record to itself, so readPairs() must return the complete record set as present pairs
// with ZERO missing — exactly the shape a perfect clone produces. Any leak here is the engine's, not the
// fixture's.
export function buildSelfCloneBlob(blob) {
  const src = blob.sourceCapture;
  const recs = src.records || [];
  const self = {
    report: JSON.parse(JSON.stringify(blob.report)),
    sourceCapture: JSON.parse(JSON.stringify(src)),
    cloneCapture: JSON.parse(JSON.stringify(src)), // CLONE IS THE SOURCE — a perfect clone
  };
  const r = self.report;
  r.clone = r.source;                       // same url — label only, no fetch
  r.clonePage = r.clonePage || 'self';
  // page heights identical on both sides (perfect clone has identical layout)
  const srcH = blob.report.pageHeightByVw && blob.report.pageHeightByVw.source;
  r.pageHeightByVw = { source: JSON.parse(JSON.stringify(srcH || {})), clone: JSON.parse(JSON.stringify(srcH || {})) };
  // correspondence: every source ref → ITSELF, via BOTH channels readPairs reads (matched wins, relation fills)
  r.matched = recs.map((x) => ({ srcRef: x.ref, cloneRef: x.ref }));
  r.relation = Object.fromEntries(recs.map((x) => [x.srcPath, [x.ref]]));
  r.unmatchedSource = [];
  r.unmatchedSourceCount = 0;
  r.unmatchedClone = [];
  r.matchRate = 1.0;
  if (r.correspondence) r.correspondence = { ...r.correspondence, method: (r.correspondence.method || 'self') };
  return self;
}

// a deterministic striped PNG (no network) — used as the IDENTICAL native crop on BOTH sides so the
// pixel-dependent img-phash axis is exercised and proven silent on identical input.
function stripedPng(w, h) {
  const p = new PNG({ width: Math.max(2, w | 0), height: Math.max(2, h | 0) });
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) { const i = (y * p.width + x) << 2; const v = (x >> 3) % 2 ? 240 : 20; p.data[i] = p.data[i + 1] = p.data[i + 2] = v; p.data[i + 3] = 255; }
  return p;
}

// run the FULL axis-delta pipeline over the self-clone at one viewport and collect every flagged row.
export function gradeSelfCloneAt(self, vw) {
  const { pairs } = M.readPairs(self, vw);
  const present = pairs.filter((p) => p.cEl);
  const missing = pairs.filter((p) => !p.cEl);
  const flaggedRows = [];
  let totalRows = 0;
  for (const { sEl, cEl } of pairs) {
    // exercise the img-phash axis with IDENTICAL synthetic crops when both sides are images (offline).
    let srcCrop = null, cloneCrop = null;
    if (sEl && sEl.asset && sEl.asset.isImage && cEl && cEl.asset && cEl.asset.isImage) {
      const b = (sEl.box && sEl.box[vw]) || { w: 64, h: 64 };
      const px = stripedPng(b.w || 64, b.h || 64);
      srcCrop = px; cloneCrop = px; // identical crop on both sides ⇒ a perfect clone of the image
    }
    const rows = M.axisDeltas(sEl, cEl, vw, { srcCrop, cloneCrop });
    totalRows += rows.length;
    for (const row of rows) if (row.flagged) flaggedRows.push(row);
  }
  return { vw, pairs: pairs.length, present: present.length, missing: missing.length, totalRows, flaggedRows };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// (#4) SELF-CLONE ACROSS STATES + WIDTHS — the false-positive discipline gate for the responsive + motion sweep.
// A same-source pair (clone := deep copy of source, INCLUDING states.hover / states.scroll / states.reveal AND
// box[768]/box[390] AND the source @media breakpoints, identical on both sides) MUST fire ZERO sweep defects on
// EVERY new axis (h-overflow-bool / reflow-vector / sticky-delta / hover-dead / reveal-missing). This is the
// delta-of-deltas invariant: identical states → 0 state-delta-of-deltas; identical boxes-per-width → 0 reflow/
// overflow disagreement. If ANY sweep axis fires on identical input, the axis is a false-positive machine and must
// not be trusted. Builder does NOT self-bless — the orchestrator re-executes this. New axes stay behind the flag
// until this passes.
async function statesGate() {
  if (!fs.existsSync(COMPARE)) {
    console.error(`STATES-GATE ERROR: compare blob not found: ${COMPARE} (run a CAPTURE_REVEAL=1 SWEEP_768=1 compare first, or pass --compare).`);
    process.exit(2);
  }
  const S = await import('./axisdelta-sweep.mjs');
  const floors = S.loadFloors(path.join(__dir, 'calibration', 'axis-floors.json'));
  const blob = JSON.parse(fs.readFileSync(COMPARE, 'utf8'));

  // build a genuine self-clone INCLUDING the source-side responsiveSweep + mediaBreakpoints + per-record states.
  const src = blob.sourceCapture;
  const self = {
    report: JSON.parse(JSON.stringify(blob.report)),
    sourceCapture: JSON.parse(JSON.stringify(src)),
    cloneCapture: JSON.parse(JSON.stringify(src)), // CLONE IS THE SOURCE — states/reveal/boxes identical
  };
  const recs = src.records || [];
  const r = self.report;
  r.clone = r.source;
  r.matched = recs.map((x) => ({ srcRef: x.ref, cloneRef: x.ref }));
  r.relation = Object.fromEntries(recs.map((x) => [x.srcPath, [x.ref]]));
  r.unmatchedSource = [];
  const srcH = blob.report.pageHeightByVw && blob.report.pageHeightByVw.source;
  r.pageHeightByVw = { source: JSON.parse(JSON.stringify(srcH || {})), clone: JSON.parse(JSON.stringify(srcH || {})) };
  // a self-clone's responsiveSweep overflow must be symmetric: whatever the source overflows, the clone overflows
  // too → overflowRows suppresses (sourceOverflows gate). Rebuild responsiveSweep from the self (both sides equal).
  if (r.responsiveSweep && r.responsiveSweep.overflowByWidth) {
    for (const w of Object.keys(r.responsiveSweep.overflowByWidth)) {
      const e = r.responsiveSweep.overflowByWidth[w];
      e.sourceOverflows = e.cloneOverflows; // identical sides ⇒ source overflows wherever the clone does
    }
  }

  const widths = (blob.report.widths || [1440]).filter((w) => recs.some((rr) => rr.box && (rr.box[w] || rr.box[String(w)])));
  const out = S.runSweep(self, floors, { widths });

  const sweepDefects = out.events.length;
  const firedAxes = Object.keys(out.byAxis || {});
  const passes = sweepDefects === 0 && out.sweepScore >= 0.999;

  const report = {
    falsifierFile: 'eval/grader/_axisdelta-selfclone-falsifier.mjs --states',
    compare: COMPARE, source: blob.report.source, widths,
    revealCapturedOnSource: out.meta.revealCaptured,
    sourceMediaBreakpoints: (out.meta.why && out.meta.why.sourceMediaBreakpoints) || [],
    sweepScore: out.sweepScore, sweepDefects, firedAxes, byAxis: out.byAxis,
    leakingSamples: out.events.slice(0, 8).map((e) => ({ ref: String(e.ref).slice(0, 50), vw: e.viewport, class: e.class, axes: e.firedAxes, severity: e.severity })),
    passes,
  };

  console.log('\n==== SELF-CLONE-ACROSS-STATES+WIDTHS FALSIFIER (#4 sweep: responsive + motion) ====');
  console.log(`compare blob : ${COMPARE}`);
  console.log(`source       : ${blob.report.source}`);
  console.log(`widths       : ${widths.join(', ')}  | revealCaptured ${out.meta.revealCaptured}  | source @media bps [${report.sourceMediaBreakpoints.join(',')}]`);
  console.log(`sweepScore   : ${out.sweepScore}   (MUST be ~1.0)`);
  console.log(`sweepDefects : ${sweepDefects}   (MUST be 0 — a sweep axis firing on IDENTICAL states/widths = false-positive)`);
  if (sweepDefects) {
    console.log(`\nLEAKING SWEEP AXES (fired on identical input — FIX BEFORE TRUSTING):`);
    console.log(`  byAxis ${JSON.stringify(out.byAxis)}`);
    for (const e of report.leakingSamples) console.log(`    ref=${e.ref}@${e.vw} class=${e.class} axes=${e.axes.join('+')} sev=${e.severity}`);
  }
  console.log(`\nRESULT: ${passes ? 'PASS — sweep axes are clean on identical states/widths; safe to trust the responsive + motion sweep.' : 'FALSIFIED — a sweep axis is false-positive on identical input; the sweep must NOT be trusted until fixed.'}`);
  if (AS_JSON) console.log('\n' + JSON.stringify(report, null, 2));
  process.exit(passes ? 0 : 1);
}

function main() {
  if (has('states')) { statesGate(); return; } // (#4) responsive + motion sweep gate
  if (!fs.existsSync(COMPARE)) {
    const out = { falsifierFile: 'eval/grader/_axisdelta-selfclone-falsifier.mjs', error: `compare blob not found: ${COMPARE}`, passes: false };
    console.error(`FALSIFIER ERROR: compare blob not found: ${COMPARE}`);
    if (AS_JSON) console.log(JSON.stringify(out, null, 2));
    process.exit(2);
  }
  const blob = JSON.parse(fs.readFileSync(COMPARE, 'utf8'));
  const self = buildSelfCloneBlob(blob);

  // widths actually captured on the source side (same logic the spine uses to pick widths)
  const allW = (blob.report.widths || [1440]);
  const widths = allW.filter((w) => self.sourceCapture.records.some((rr) => rr.box && rr.box[w]));

  const perVw = widths.map((vw) => gradeSelfCloneAt(self, vw));

  // aggregate
  const totalRows = perVw.reduce((a, r) => a + r.totalRows, 0);
  const totalFlagged = perVw.reduce((a, r) => a + r.flaggedRows.length, 0);
  const totalMissing = perVw.reduce((a, r) => a + r.missing, 0); // a perfect clone must have ZERO missing pairs
  // per-viewport score then average; perfect clone → 100.00
  const vwScores = perVw.map((r) => (r.totalRows ? 100 * (1 - r.flaggedRows.length / r.totalRows) : 100));
  const selfCloneScore = (vwScores.reduce((a, b) => a + b, 0) / (vwScores.length || 1)).toFixed(2);

  // leaking axes (distinct) + a few concrete leaking refs per axis for diagnosis
  const leakingByAxis = {};
  for (const r of perVw) for (const row of r.flaggedRows) {
    (leakingByAxis[row.axis] ||= []).push({ ref: String(row.ref).slice(0, 60), viewport: row.viewport, class: row.class, delta: row.delta, src: row.src, clone: row.clone, tol: row.tol });
  }
  const leakingAxes = Object.keys(leakingByAxis).sort();

  // missing pairs are themselves a leak: a perfect clone correspondence must yield zero missing.
  const missingLeak = totalMissing > 0;

  const selfCloneDefects = totalFlagged; // flagged axis rows on identical input — MUST be 0
  const passes = selfCloneDefects === 0 && !missingLeak && parseFloat(selfCloneScore) >= 99.999;

  const report = {
    falsifierFile: 'eval/grader/_axisdelta-selfclone-falsifier.mjs',
    compare: COMPARE,
    source: blob.report.source,
    widths,
    perViewport: perVw.map((r) => ({ vw: r.vw, pairs: r.pairs, present: r.present, missing: r.missing, axisRows: r.totalRows, flagged: r.flaggedRows.length })),
    totalAxisRows: totalRows,
    selfCloneScore,
    selfCloneDefects,
    missingPairs: totalMissing,
    leakingAxes,
    leakingSamples: Object.fromEntries(leakingAxes.map((a) => [a, leakingByAxis[a].slice(0, 6)])),
    passes,
  };

  // ── human-readable ──
  console.log('\n==== SELF-CLONE FALSIFIER (source vs itself through grade-element-crops axis-delta) ====');
  console.log(`compare blob : ${COMPARE}`);
  console.log(`source       : ${blob.report.source}`);
  console.log(`widths       : ${widths.join(', ')}`);
  for (const r of perVw) console.log(`  @${r.vw}: pairs ${r.pairs} (present ${r.present} / missing ${r.missing}) | axisRows ${r.totalRows} | FLAGGED ${r.flaggedRows.length}`);
  console.log(`\nselfCloneScore   : ${selfCloneScore}   (MUST be ~100)`);
  console.log(`selfCloneDefects : ${selfCloneDefects}   (MUST be 0 — defects on IDENTICAL input = pure false-positive)`);
  console.log(`missingPairs     : ${totalMissing}   (MUST be 0 — a perfect clone has no missing correspondence)`);
  if (leakingAxes.length) {
    console.log(`\nLEAKING AXES (fired on identical input — FIX THESE BEFORE building the floor/engine):`);
    for (const a of leakingAxes) {
      console.log(`  • ${a}  (${leakingByAxis[a].length} rows)`);
      for (const s of leakingByAxis[a].slice(0, 4)) console.log(`      ref=${s.ref}@${s.viewport} class=${s.class} delta=${s.delta} tol=${s.tol} src=${JSON.stringify(s.src)} clone=${JSON.stringify(s.clone)}`);
    }
  }
  console.log(`\nRESULT: ${passes ? 'PASS — engine is clean on identical input; safe to build the floor/weights on it.' : 'FALSIFIED — engine is false-positive on identical input; the floor/engine must NOT be built until fixed.'}`);

  if (AS_JSON) console.log('\n' + JSON.stringify(report, null, 2));
  process.exit(passes ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
