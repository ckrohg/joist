#!/usr/bin/env node
/**
 * @purpose END-TO-END selftest for the GRADER-HONESTY GATE through the REAL grade-structure.mjs subprocess (no
 * mocks of the scoring path). Serves ONE synthetic multi-section page over 127.0.0.1 (NEVER the shared host) and
 * grades it as a perfect self-clone (--source url --clone url), exercising the editability ladder + frozen-cap +
 * gate reversibility via a synthetic sidecar ledger. Pure-localhost render; no external network.
 *
 *   E1 NO-OP ON FLOW — with NO ledger (pure-flow clone) the honesty gate must NOT change editability vs the
 *      baseline; with GRADER_NO_HONESTYGATE=1 the report must carry NO honesty fields at all (byte-identical
 *      legacy shape). This is the load-bearing reversibility guarantee.
 *   E2 LADDER FROZEN DISCOUNT — feed a ledger marking the page's lower half as a PRESERVE band → editability
 *      MUST drop below the no-ledger baseline (frozen runs credited ×FROZEN_W), composite must NOT rise.
 *   E3 BINARY RESTORE = NO-OP — same ledger + GRADER_EDITABILITY_BINARY=1 → editability MUST equal the
 *      no-ledger baseline (legacy term restored; ladder off), proving the ladder is the ONLY thing that moved E2.
 *   E4 FROZEN-COVERAGE CAP — a ledger with preserveHeightFrac > threshold caps the composite at the veto ceiling.
 *   E5 STALE-LEDGER SAFETY — a ledger whose `source` names a DIFFERENT site is IGNORED (no discount) — a stale
 *      sidecar from an unrelated build must not corrupt this grade.
 *
 * Exit 0 = ALL PASS. The orchestrator re-runs this before trusting the change.
 */
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A page with clearly separated TOP and BOTTOM text bands (so a preserve band over the lower half discounts a
// well-defined subset of runs). Every run is real selectable text → high coverage on a self-clone.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{background:#fff;margin:0;font-family:Arial;color:#111}
section{padding:40px}
h2{font-size:32px;margin:0 0 16px}
p{font-size:18px;line-height:1.5;margin:0 0 12px}
.top{background:#f4f4f8} .bot{background:#eef6ee}
</style></head><body>
<section class="top" style="height:520px">
  <h2>Top Section Heading One</h2>
  <p>The quick brown fox jumps over the lazy dog in the upper region of the page.</p>
  <p>Native editable paragraph alpha in the top flow section above the fold.</p>
  <p>Another distinct sentence beta sitting comfortably in the upper band area.</p>
</section>
<section class="bot" style="height:520px">
  <h2>Bottom Section Heading Two</h2>
  <p>Lower region sentence gamma that would live inside a frozen preserve band.</p>
  <p>Editable paragraph delta in the bottom section below the midpoint line here.</p>
  <p>Final distinct sentence epsilon anchoring the bottom of this synthetic page.</p>
</section>
</body></html>`;

const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const URL = `http://127.0.0.1:${port}/`;

function writeLedger(file, sourceUrl, bands, preserveHeightFrac) {
  const perSection = bands.map((b, i) => ({ i, y: b.y, h: b.h, arm: b.arm, classes: b.arm === 'preserve' ? ['carousel'] : [], isCarousel: false }));
  fs.writeFileSync(file, JSON.stringify({ source: sourceUrl, sections: bands.length, preserveCoverageFrac: 0.5, preserveHeightFrac, perSection }, null, 2));
}

function grade(env = {}, ledgerPath = null, tag = '') {
  const out = `/tmp/honesty-e2e${tag}`;
  const args = ['--source', URL, '--clone', URL, '--no-responsive', '--refresh-source', '--out', out];
  if (ledgerPath) args.push('--ledger', ledgerPath); else args.push('--ledger', 'none'); // 'none' = explicitly no ledger
  // sanctioned localhost escape hatch (host-guard.mjs §JOIST_ALLOWED_HOSTS) — the ephemeral port differs each run.
  // The shared SiteGround host stays HARD-BLOCKED (BLOCKED_PATTERNS are checked FIRST and win over any allowlist).
  const allow = `127.0.0.1:${port}`;
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [path.join(__dirname, 'grade-structure.mjs'), ...args], { env: { ...process.env, JOIST_ALLOWED_HOSTS: allow, ...env } });
    let err = ''; c.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => c.kill('SIGKILL'), 180000);
    c.on('close', (code) => { clearTimeout(t); if (code !== 0) return reject(new Error(`grade-structure exited ${code}: ${err.slice(-800)}`)); resolve(JSON.parse(fs.readFileSync(`${out}/report.json`, 'utf8'))); });
  });
}

let fail = 0;
const check = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!cond) fail++; };
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

// ---- baseline: pure-flow (no ledger), gate ON ----
const base = await grade({}, null, '-base');
check('E0 baseline self-clone has real editability', base.editability > 0.5, `editability ${base.editability} coverage ${base.breakdown.textCoverage}`);

// ---- E1 NO-OP ON FLOW: gate OFF → no honesty fields, editability identical to gate-ON-no-ledger ----
const gateOff = await grade({ GRADER_NO_HONESTYGATE: '1' }, null, '-off');
check('E1a no-op-on-flow: gate-OFF editability == gate-ON-no-ledger editability', near(gateOff.editability, base.editability), `off ${gateOff.editability} base ${base.editability}`);
check('E1b no-op-on-flow: gate-OFF composite == gate-ON-no-ledger composite', near(gateOff.composite, base.composite), `off ${gateOff.composite} base ${base.composite}`);
check('E1c reversibility: gate-OFF report carries NO honesty field', gateOff.honesty === undefined && base.honesty !== undefined, `off.honesty ${JSON.stringify(gateOff.honesty)}`);
check('E1d no-op-on-flow: gate-ON-no-ledger reports 0 preserveBands / 0 frozenRuns', base.honesty.editLadder.preserveBands === 0 && base.honesty.editLadder.frozenRuns === 0, `bands ${base.honesty.editLadder.preserveBands} frozen ${base.honesty.editLadder.frozenRuns}`);

// ---- E2 LADDER FROZEN DISCOUNT: mark the lower half (y>=520) a preserve band ----
const ledgerFile = '/tmp/honesty-e2e-ledger.json';
writeLedger(ledgerFile, URL, [{ y: 0, h: 520, arm: 'flow' }, { y: 520, h: 520, arm: 'preserve' }], 0.5);
const frozen = await grade({}, ledgerFile, '-frozen');
check('E2a ladder discount: frozen-band editability DROPS below baseline', frozen.editability < base.editability - 1e-3, `frozen ${frozen.editability} base ${base.editability}`);
check('E2b ladder discount: some runs landed in the frozen band', frozen.honesty.editLadder.frozenRuns >= 1, `frozenRuns ${frozen.honesty.editLadder.frozenRuns}`);
check('E2c ladder discount: composite does NOT rise vs baseline', frozen.composite <= base.composite + 1e-3, `frozen ${frozen.composite} base ${base.composite}`);
check('E2d coverage UNCHANGED (raw diagnostic decoupled from ladder)', near(frozen.breakdown.textCoverage, base.breakdown.textCoverage), `frozen ${frozen.breakdown.textCoverage} base ${base.breakdown.textCoverage}`);

// ---- E3 BINARY RESTORE = NO-OP: same ledger + GRADER_EDITABILITY_BINARY=1 → editability == baseline ----
const binary = await grade({ GRADER_EDITABILITY_BINARY: '1' }, ledgerFile, '-binary');
check('E3 binary restore: GRADER_EDITABILITY_BINARY=1 editability == baseline (ladder no-op)', near(binary.editability, base.editability), `binary ${binary.editability} base ${base.editability}`);

// ---- E4 FROZEN-COVERAGE CAP: preserveHeightFrac above threshold caps composite at the veto ceiling ----
const ledgerHeavy = '/tmp/honesty-e2e-ledger-heavy.json';
writeLedger(ledgerHeavy, URL, [{ y: 0, h: 100, arm: 'flow' }, { y: 100, h: 940, arm: 'preserve' }], 0.9);
const heavy = await grade({}, ledgerHeavy, '-heavy');
check('E4a frozen-coverage cap: preserveHeightFrac 0.9 caps composite <= 0.45', heavy.composite <= 0.45 + 1e-9, `composite ${heavy.composite}`);
check('E4b frozen-coverage cap: cap recorded in honesty.caps', (heavy.honesty.caps || []).some((c) => c.startsWith('frozen-coverage')), `caps ${JSON.stringify(heavy.honesty.caps)}`);
// reversible: GRADER_NO_FROZENCAP=1 lifts the cap (composite may exceed 0.45 again on this perfect self-clone)
const heavyNoCap = await grade({ GRADER_NO_FROZENCAP: '1' }, ledgerHeavy, '-heavy-nocap');
check('E4c frozen-coverage cap reversible: GRADER_NO_FROZENCAP=1 lifts the cap', heavyNoCap.composite > heavy.composite - 1e-9 && !(heavyNoCap.honesty.caps || []).some((c) => c.startsWith('frozen-coverage')), `nocap ${heavyNoCap.composite} capped ${heavy.composite}`);

// ---- E5 STALE-LEDGER SAFETY: a ledger naming a DIFFERENT source is ignored ----
const ledgerStale = '/tmp/honesty-e2e-ledger-stale.json';
writeLedger(ledgerStale, 'https://some-other-site.example/', [{ y: 0, h: 520, arm: 'flow' }, { y: 520, h: 520, arm: 'preserve' }], 0.5);
const stale = await grade({}, ledgerStale, '-stale');
check('E5 stale-ledger safety: mismatched-source ledger ignored (editability == baseline)', near(stale.editability, base.editability) && stale.honesty.editLadder.preserveBands === 0, `stale ${stale.editability} base ${base.editability} bands ${stale.honesty.editLadder.preserveBands}`);

srv.close();
console.log('\n' + (fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`));
process.exit(fail === 0 ? 0 : 1);
