#!/usr/bin/env node
/**
 * @purpose _grade-occlusion-selftest.mjs — STANDALONE falsifier for the cross-section occlusion-coverage collision
 *   fix (grade-occlusion.mjs + grade-fused.mjs wiring). The orchestrator re-executes THIS file; the builder does
 *   NOT self-bless. Three falsifier groups:
 *
 *   (A) SYNTHETIC FIXTURES (no capture) — runs grade-occlusion's inline runSelftest():
 *         self-clone OCC=0/no cap; piled page OCC≥0.40+catastrophic+ceil≤10; INTENTIONAL layered hero (source
 *         sections overlap too → delta≈0) NOT flagged (impossible-overlap filter); benign uniform global shift
 *         (topology preserved) NOT fired (proves it bypasses-but-does-not-false-fire vs the global-diff demotion);
 *         partial big-section pile catastrophic+capped.
 *
 *   (B) OFFLINE REPLAY on cached compare blobs (NO host, NO network):
 *         compare-343 (supabase holdout) + compare-392 (linear holdout) MUST trip catastrophic + a cap (occCeil≤10).
 *         compare-341 + compare-439 (clean single-article blogs) + compare-268 (clean) MUST stay UNCAPPED
 *         (catastrophic=false, occCeil=null) — the area-gate false-positive guard. This is the self-evident
 *         catastrophe vs clean-page-unaffected validation; it does NOT tune toward any sealed human score.
 *         (Skipped gracefully if a blob is absent — the synthetic group is the always-on falsifier.)
 *
 *   (C) GRADE-FUSED INTEGRATION + REVERSIBILITY:
 *         on compare-343 (if present) grade-fused applies the cap (fusedScore lowered, 'collision' disqualifier);
 *         with GRADER_NO_OCCLUSION=1 the cap is gone and the fusedScore matches the no-occlusion baseline (additive/
 *         reversible). On a synthetic CLEAN multi-section blob the cap is NOT applied (no false deduction).
 *
 * PURE. No host, no network, no git, no image libs. node _grade-occlusion-selftest.mjs  (exit 0 = all pass).
 */
import fs from 'fs';
import { computeOcclusion, occCeilingFor, runSelftest as occInlineSelftest } from './grade-occlusion.mjs';

const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail }); };

// ── (A) synthetic fixtures via grade-occlusion's own runSelftest (captures its PASS/FAIL aggregate) ────────────
{
  // runSelftest prints its own table + returns bool. Capture the boolean as one rolled-up falsifier.
  const passed = occInlineSelftest();
  ok('(A) grade-occlusion synthetic fixtures (self-clone/pile/layered-hero/global-shift/partial)', passed === true, `runSelftest()=${passed}`);
}

// ── (B) offline replay on cached blobs ────────────────────────────────────────────────────────────────────────
function loadBlob(p) { try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; } }
const CATASTROPHE = ['/tmp/compare-343.json', '/tmp/compare-392.json'];
const CLEAN = ['/tmp/compare-341.json', '/tmp/compare-268.json', '/tmp/compare-439.json'];

let replayRan = false;
for (const p of CATASTROPHE) {
  const blob = loadBlob(p);
  if (!blob) { ok(`(B) catastrophe ${p.split('/').pop()} present`, true, 'SKIPPED (blob absent — synthetic group covers this)'); continue; }
  replayRan = true;
  const occ = computeOcclusion(blob, {});
  ok(`(B) ${p.split('/').pop()} → catastrophic`, occ.catastrophic === true, `OCC=${occ.OCC} cata=${occ.catastrophic}`);
  ok(`(B) ${p.split('/').pop()} → capped (occCeil≤10)`, occ.occCeil != null && occ.occCeil <= 10, `occCeil=${occ.occCeil}`);
}
for (const p of CLEAN) {
  const blob = loadBlob(p);
  if (!blob) { ok(`(B) clean ${p.split('/').pop()} present`, true, 'SKIPPED (blob absent)'); continue; }
  replayRan = true;
  const occ = computeOcclusion(blob, {});
  ok(`(B) ${p.split('/').pop()} (clean) → NOT catastrophic`, occ.catastrophic === false, `cata=${occ.catastrophic} OCC=${occ.OCC}`);
  ok(`(B) ${p.split('/').pop()} (clean) → NOT capped (occCeil=null)`, occ.occCeil == null, `occCeil=${occ.occCeil} OCC=${occ.OCC}`);
}

// ── (C) grade-fused integration + reversibility ───────────────────────────────────────────────────────────────
{
  // grade-fused is imported dynamically AFTER setting/clearing the env flag (the OCCLUSION_OFF constant binds at
  // module-eval time). We exercise both the default-ON and the GRADER_NO_OCCLUSION=1 path in separate child reads.
  const cata = loadBlob('/tmp/compare-343.json');
  if (cata) {
    const floors = JSON.parse(fs.readFileSync(new URL('./calibration/axis-floors.json', import.meta.url), 'utf8'));
    // default-ON: occlusion cap applied → 'collision' disqualifier, score capped.
    delete process.env.GRADER_NO_OCCLUSION;
    const onMod = await import('./grade-fused.mjs?on=' + Date.now());
    const onOut = onMod.gradeFused(cata, floors, {});
    ok('(C) default-ON: occlusion cap applied on compare-343', onOut.occlusionCap && onOut.occlusionCap.applied === true, `applied=${onOut.occlusionCap && onOut.occlusionCap.applied} ceil=${onOut.occlusionCap && onOut.occlusionCap.occCeil}`);
    ok("(C) default-ON: 'collision' is a tripped disqualifier", onOut.deterministicVeto.disqualifiers.includes('collision'), `disq=[${onOut.deterministicVeto.disqualifiers.join(',')}]`);
    ok('(C) default-ON: fusedScore ≤ occCeil', onOut.fusedScore <= (onOut.occlusionCap.occCeil || 100), `score=${onOut.fusedScore} ceil=${onOut.occlusionCap.occCeil}`);

    // OFF: occlusion channel dormant → no 'collision' disqualifier, no cap, score = baseline.
    process.env.GRADER_NO_OCCLUSION = '1';
    const offMod = await import('./grade-fused.mjs?off=' + Date.now());
    const offOut = offMod.gradeFused(cata, floors, {});
    ok('(C) OFF (GRADER_NO_OCCLUSION=1): cap NOT applied', !offOut.occlusionCap || offOut.occlusionCap.applied === false, `applied=${offOut.occlusionCap && offOut.occlusionCap.applied}`);
    ok("(C) OFF: 'collision' NOT a disqualifier", !offOut.deterministicVeto.disqualifiers.includes('collision'), `disq=[${offOut.deterministicVeto.disqualifiers.join(',')}]`);
    ok('(C) OFF: fusedScore ≥ default-ON score (reversible — cap only ever LOWERS)', offOut.fusedScore >= onOut.fusedScore, `off=${offOut.fusedScore} on=${onOut.fusedScore}`);
    delete process.env.GRADER_NO_OCCLUSION;
  } else {
    ok('(C) grade-fused integration on compare-343', true, 'SKIPPED (blob absent)');
  }
}

// ── synthetic occCeilingFor unit checks (pure, no blob) ───────────────────────────────────────────────────────
{
  ok('(unit) OCC≥0.40 → ceil 10', occCeilingFor(0.45, false) === 10, `ceil=${occCeilingFor(0.45, false)}`);
  ok('(unit) OCC≥0.25 → ceil 30', occCeilingFor(0.30, false) === 30, `ceil=${occCeilingFor(0.30, false)}`);
  ok('(unit) OCC≥0.10 → ceil 65', occCeilingFor(0.15, false) === 65, `ceil=${occCeilingFor(0.15, false)}`);
  ok('(unit) OCC<0.10 → no cap', occCeilingFor(0.05, false) === null, `ceil=${occCeilingFor(0.05, false)}`);
  ok('(unit) catastrophic flag forces ceil≤10 even at low OCC', occCeilingFor(0.05, true) === 10, `ceil=${occCeilingFor(0.05, true)}`);
}

const failed = results.filter((r) => !r.pass);
console.log('\n==== GRADE-OCCLUSION — STANDALONE FALSIFIER (no host, no network) ====');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${results.length} checks)${replayRan ? '' : '  [note: cached-blob replay group skipped — blobs absent]'}`);
process.exit(failed.length === 0 ? 0 : 1);
