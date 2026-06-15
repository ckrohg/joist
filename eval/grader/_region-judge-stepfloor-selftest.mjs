#!/usr/bin/env node
/**
 * @purpose _region-judge-stepfloor-selftest.mjs — hermetic, OFFLINE self-test for the RJ_STEP_FLOOR + RJ_OVERLAP_DETECT
 * recalibration of region-judge.mjs (models the human STEP-FUNCTION: a clone with ANY obvious wrongness is BROKEN,
 * 0-5, with NO partial credit for a present-but-wrong disqualifier). Asserts the binding invariants WITHOUT any vision
 * call, render, network, or shared host (reads only existing .shots/ PNGs + pure rollup math):
 *   1. overlap detector is IDENTITY-SAFE (source-vs-itself ⇒ ratio 1.0, never flagged) — the floor can never zero a
 *      clean clone via a phantom collision.
 *   2. overlap detector FLAGS a real collision (vercel clone: clone ATF ink-density ≥1.45x source).
 *   3. overlap detector ABSTAINS on an extreme height mismatch (the P07-class viewport mismatch: full 53761px clone vs
 *      1000px source crop) instead of emitting a false collision — defers to the vision pass.
 *   4. step floor is CONDITIONAL: a clean region map (NO disqualifying class) keeps its high base, cap stays 100, the
 *      ceiling is NEVER clamped (a genuinely-good future clone can still score high).
 *   5. step floor DISQUALIFIES a PRESENT-BUT-WRONG fatal (the exact overstatement bug: a 'high' wrong-logo that the
 *      graded floor gave a 30-55 mid cap now steps the page NEAR-0 ≤8) — removes the present-but-wrong escape.
 *   6. a page-level overlap veto ALONE trips the near-0 step cap.
 *   7. the DISQUALIFYING_FATAL set carries all 6 human-step classes (logo/heading/hero/CTA/overlap/imagery).
 * Exit non-zero on any failure. The orchestrator re-executes the calibration + game-test gates; this is the cheap
 * always-runnable guard that the floor stays conditional and the overlap detector stays identity-safe.
 */
import { overlapInkExcess, loadPng, rollup, DISQUALIFYING_FATAL } from './region-judge.mjs';
import path from 'path';

const S = path.join(import.meta.dirname, '.shots');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };

// 1. overlap detector: identity-safe (source-vs-itself never flags)
const vsrc = loadPng(path.join(S, 'calib-vercel-source.png'));
const id = overlapInkExcess(vsrc, vsrc);
ok(id.flagged === false && id.maxRatio === 1, `identity overlap not flagged (ratio ${id.maxRatio})`);

// 2. overlap detector: vercel collision IS flagged (ratio >= 1.45) with an 'overlap' fatalClass veto
const vcln = loadPng(path.join(S, 'calib-vercel-clone.png'));
const ver = overlapInkExcess(vsrc, vcln);
ok(ver.flagged === true && ver.veto && ver.veto.fatalClass === 'overlap', `vercel collision flagged (ratio ${ver.maxRatio})`);

// 3. height-mismatch ABSTAIN (53x): no false overlap, defers to vision
const osrc = loadPng(path.join(S, 'src-overreacted-top.png'));
const ocln = loadPng(path.join(S, 'proj-overreacted-258.png'));
const ov = overlapInkExcess(osrc, ocln);
ok(ov.flagged === false && ov.abstained === true, `height-mismatch abstained (heightRatio ${ov.heightRatio})`);

// 4. step floor CONDITIONAL: a clean region map (no disqualifiers) keeps base, no ceiling clamp
const cleanRegions = [
  { weight: 2, score: 96, det: { vetoes: [] }, visionDefects: [] },
  { weight: 1, score: 92, det: { vetoes: [] }, visionDefects: [] },
];
const rc = rollup(cleanRegions, {});
ok(rc.score >= 90 && rc.cap === 100, `clean map stays HIGH (score ${rc.score}, cap ${rc.cap})`);

// 5. step floor DISQUALIFIES a PRESENT-BUT-WRONG fatal (the overreacted bug): a 'high' wrong-logo + high base -> near-0
const wrongRegions = [
  { weight: 2, score: 80, det: { vetoes: [] }, visionDefects: [{ fatalClass: 'logo', severity: 'high', defect_class: 'wrong-logo', _presentButWrong: true }] },
  { weight: 1, score: 90, det: { vetoes: [] }, visionDefects: [] },
];
const rw = rollup(wrongRegions, {});
ok(rw.score <= 8 && rw.stepFloor === true, `present-but-wrong disqualifier -> near-0 (score ${rw.score})`);

// 6. step floor: page-level overlap veto alone trips near-0
const ro = rollup(cleanRegions, { overlapVeto: { fatalClass: 'overlap', severity: 'fatal', defect_class: 'overlapping-sections' } });
ok(ro.score <= 8, `page overlap veto -> near-0 (score ${ro.score})`);

// 7. DISQUALIFYING set membership
ok(['logo', 'heading', 'hero', 'CTA', 'overlap', 'imagery'].every(c => DISQUALIFYING_FATAL.has(c)), 'all 6 disqualifying classes present');

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
