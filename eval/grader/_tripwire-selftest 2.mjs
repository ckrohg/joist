#!/usr/bin/env node
/**
 * @purpose _tripwire-selftest.mjs — prove the tripwire actually HALTS on a real detection regression (a tripwire
 * that cannot demonstrate its own halt is worse than none) and that it passes when the detectors are healthy.
 *
 * The regression is injected the honest way: flip GRADER_BROKEN_HERO_LEGACY=1, which reverts broken-hero to the old
 * fixed-top-200px rule. That rule is BLIND to a hero blanked below the nav — exactly the defect the Arm-1 regression
 * fixtures (the ladder blank-hero rungs) encode — so those fixtures must MISS → the tripwire must HALT. This is a
 * live, end-to-end proof that the corpus + replay + arm logic catch a genuine loss of detection.
 */
import { evaluate } from './tripwire.mjs';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

// 1. HEALTHY detectors → no Arm-1 halt, a valid pass token, and the known open canaries are tracked (not silent).
delete process.env.GRADER_BROKEN_HERO_LEGACY;
const healthy = evaluate();
check('healthy: ZERO Arm-1 halts (no false regression)', healthy.halts.length === 0, `halts ${JSON.stringify(healthy.halts.map((h) => h.id))}`);
check('healthy: every Arm-1 regression fixture PASSES (real-broken + clean-control + injected-veto)', healthy.passes >= 9 && healthy.halts.length === 0, `passes ${healthy.passes}/${healthy.total}, halts ${healthy.halts.length}`);
check('healthy: open blind-spots are TRACKED (>0, the invis-heading + missing-nav canaries) not silently dropped', healthy.blindSpotCount >= 1, `blindSpotCount ${healthy.blindSpotCount}`);

// 2. INJECTED REGRESSION (legacy broken-hero rule) → the Arm-1 blank-hero fixtures MISS → the tripwire HALTS.
process.env.GRADER_BROKEN_HERO_LEGACY = '1';
const regressed = evaluate();
check('regression: legacy broken-hero rule → tripwire HALTS (Arm-1 regression detected)', regressed.halts.length > 0, `halts ${regressed.halts.length}`);
check('regression: the halts are the blank-hero regression fixtures (kind=regression)', regressed.halts.some((h) => h.kind === 'regression' && h.veto === 'broken-hero'), `kinds ${JSON.stringify(regressed.halts.map((h) => h.kind))}`);
delete process.env.GRADER_BROKEN_HERO_LEGACY;

// 3. RECOVERY: removing the injected regression returns to a clean pass (no sticky state).
const recovered = evaluate();
check('recovery: removing the regression returns to ZERO halts', recovered.halts.length === 0, `halts ${recovered.halts.length}`);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
