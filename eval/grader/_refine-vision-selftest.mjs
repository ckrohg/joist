#!/usr/bin/env node
/**
 * @purpose Selftest for refine-vision.mjs (topic-1 SEE→CRITIQUE→FIX loop). Four tests on tailwind/3146
 * (graded page: GETs only, hash-verified):
 *  A1 IDENTICAL BAND, REAL JUDGE — critiqueBand on a composite whose CLONE side is byte-identical to the
 *     SOURCE side (frozen src cache crop on both sides). The judge MUST return ZERO defects of severity >= 3
 *     (MIN_FIX_SEV): an honest critic cannot manufacture actionable defects on identical pixels. 1 claude call.
 *  A2 CONVERGENCE = ZERO KEEPS — full live refineVision loop with an INJECTED critique hook returning only
 *     sev<=2 nitpicks (zero claude cost): the loop must finish 'converged' at iter 1 with zero fix calls, zero
 *     candidates, zero keeps; its scratch page torn down to 404; graded page hash unchanged. Proves the
 *     sev>=MIN_FIX_SEV floor short-circuits the band BEFORE any mutation machinery runs.
 *  B PAIRWISE HONESTY UNDER BOTH ORDERS — a deliberately-degraded candidate (pristine source band crop with
 *     ~35% of its rows blacked out) vs the pristine incumbent, judged with flip FORCED both ways. BOTH calls
 *     must un-flip to winnerRole='incumbent', and the raw winner LETTERS must differ across the two orders
 *     (A then B) — proving the verdict tracks CONTENT, not panel position, and the harness un-flip mapping is
 *     honest. 2 claude calls.
 *  C CRASH MID-LOOP — a child process runs refineVision with hooks: critique returns one synthetic sev-4
 *    defect (no claude), fix writes a marker then SIGKILLs the process — i.e. AFTER scratch creation + the
 *    baseline band render, genuinely mid-loop. No finally/trap can run. The parent identifies the child's
 *    scratch page SURGICALLY via the /tmp/joist-scratch-active-<id>.json forensics diff (NO sweep --all — a
 *    sibling round's live scratch must survive; rails 2026-06-09) and deletes it to a verified 404; graded
 *    page hash unchanged. Zero claude calls. NOTE: no chrome pkill — the SIGKILLed child's playwright browser
 *    exits on its own when the driver pipe closes.
 *
 * Requires the tailwind frozen src cache (run grade-sections once if missing) and /tmp/joist-auth.env.
 * Usage: node _refine-vision-selftest.mjs [--skip-crash]
 * Exit: 0 pass · 3 infra · 4 gate fail. Report → /tmp/refine-vision-selftest.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import { PNG } from 'pngjs';
import { loadSrcCache } from './grade-sections.mjs';
import { api, liveHash } from './sectionvisual.mjs';
import { deletePage } from './scratch-harness.mjs';
import { critiqueBand, pairwiseVerdict, refineVision, cropBand, MIN_FIX_SEV } from './refine-vision.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const has = (n) => process.argv.includes('--' + n);
const SOURCE = 'https://tailwindcss.com', PAGE = 3146;
const OUT = '/tmp/refine-vision-st';

const activeFiles = () => fs.readdirSync('/tmp').filter((f) => /^joist-scratch-active-\d+\.json$/.test(f));
async function pageExists(id) { const r = await api('GET', `/wp-json/wp/v2/pages/${id}?context=edit`); return r.status === 200; }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const sc = loadSrcCache(SOURCE);
  if (!sc) { console.error(`no frozen src cache for ${SOURCE} — run grade-sections once first`); process.exit(3); }
  const hash0 = await liveHash(PAGE);
  const report = { source: SOURCE, page: PAGE, hash0, tests: {} };
  let pass = true;
  const check = (name, cond, detail) => { const ok = !!cond; if (!ok) pass = false; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); return ok; };
  try {
    // band fixtures from the frozen src cache (same bounds grade-sections uses — no sections.json dependency)
    const bounds = [...sc.sections.filter((y) => y < sc.pageH), sc.pageH];
    const bands = [];
    for (let i = 0; i < bounds.length - 1; i++) if (bounds[i + 1] - bounds[i] >= 20) bands.push({ idx: i, y0: bounds[i], y1: bounds[i + 1] });
    if (!bands.length) throw new Error('no bands derivable from src cache');
    // judge band: prefer a mid-size band (>=300px of content for the vision tests); loop band: smallest (cheap render)
    const judgeBand = bands.find((b) => b.y1 - b.y0 >= 300 && b.y1 - b.y0 <= 1200) || bands[0];
    const smallest = bands.slice().sort((a, b) => (a.y1 - a.y0) - (b.y1 - b.y0))[0];
    const srcCrop = cropBand(sc.shot, judgeBand.y0, Math.min(judgeBand.y1, sc.shot.height));

    // ---------- TEST A1: identical band → zero defects of sev >= MIN_FIX_SEV (real judge) ----------
    console.log(`\nTEST A1 (identical band, real judge) band §${judgeBand.idx} y${judgeBand.y0}-${judgeBand.y1}`);
    const a1 = await critiqueBand({ srcCrop, clnCrop: srcCrop, y0: judgeBand.y0, y1: judgeBand.y1, outPath: path.join(OUT, 'a1-identical.png'), cwd: OUT });
    const a1Actionable = a1.ok ? a1.defects.filter((d) => d.severity >= MIN_FIX_SEV) : null;
    report.tests.identical = { ok: a1.ok, error: a1.error, defects: a1.ok ? a1.defects : null, actionable: a1Actionable && a1Actionable.length, costUsd: a1.cost };
    check('A1 critique call succeeded', a1.ok, a1.ok ? `$${a1.cost.toFixed(2)}` : a1.error);
    check(`A1 zero defects of sev>=${MIN_FIX_SEV} on identical pixels`, a1.ok && a1Actionable.length === 0, a1.ok ? JSON.stringify(a1.defects.map((d) => `sev${d.severity}:${d.desc.slice(0, 50)}`)) : '');

    // ---------- TEST A2: convergence → zero keeps (live loop, stubbed critique, zero claude cost) ----------
    console.log(`\nTEST A2 (convergence = zero keeps) band §${smallest.idx} y${smallest.y0}-${smallest.y1}`);
    const stubCritique = async ({ outPath }) => ({ ok: true, defects: [{ desc: 'slightly different paragraph spacing', severity: 2, category: 'wrong-style', fix: 'nudge padding' }], cost: 0, model: 'stub', tilePath: outPath });
    const stubFix = async () => { report.tests.converge_fixCalled = true; return { ok: true, proposal: { action: 'none', reason: 'stub' }, cost: 0 }; };
    const a2 = await refineVision({ source: SOURCE, pageId: PAGE, bands: [smallest], iters: 3, outDir: path.join(OUT, 'a2'), hooks: { critique: stubCritique, fix: stubFix } });
    const a2b = a2.perBand[0];
    report.tests.converge = { finishedReason: a2b && a2b.finishedReason, kept: a2.totalKept, candidates: a2.totalCandidates, calls: a2b && a2b.calls, claudeCalls: a2.claudeCalls, gradedUntouched: a2.gradedUntouchedPreApply, scratchId: a2.scratchId };
    check('A2 finished converged at iter 1', a2b && a2b.finishedReason === 'converged', a2b && a2b.finishedReason);
    check('A2 zero keeps, zero candidates, zero fix calls', a2.totalKept === 0 && a2.totalCandidates === 0 && a2b.calls.fix === 0 && !report.tests.converge_fixCalled, JSON.stringify(a2b && a2b.calls));
    check('A2 defectsAfter === defectsBefore (incumbent unchanged)', a2b && a2b.defectsAfter === a2b.defectsBefore);
    check('A2 graded page untouched', a2.gradedUntouchedPreApply === true);
    check('A2 scratch torn down to 404', a2.scratchId && !(await pageExists(a2.scratchId)), `scratch ${a2.scratchId}`);

    // ---------- TEST B: degraded candidate LOSES the pairwise under BOTH forced orders ----------
    console.log(`\nTEST B (pairwise honesty, both orders) band §${judgeBand.idx}`);
    const degraded = new PNG({ width: srcCrop.width, height: srcCrop.height });
    srcCrop.data.copy(degraded.data);
    const rows = [[0.15, 0.30], [0.45, 0.60], [0.75, 0.90]]; // black out ~35% of the band in three stripes
    for (const [a, b] of rows) for (let y = Math.floor(srcCrop.height * a); y < Math.floor(srcCrop.height * b); y++)
      for (let x = 0; x < srcCrop.width; x++) { const i = (y * srcCrop.width + x) << 2; degraded.data[i] = 0; degraded.data[i + 1] = 0; degraded.data[i + 2] = 0; degraded.data[i + 3] = 255; }
    const pwArgs = { srcCrop, incumbentCrop: srcCrop, candidateCrop: degraded, y0: judgeBand.y0, cwd: OUT };
    const pw1 = await pairwiseVerdict({ ...pwArgs, flip: false, outPath: path.join(OUT, 'b-flip0.png') }); // A=incumbent
    const pw2 = await pairwiseVerdict({ ...pwArgs, flip: true, outPath: path.join(OUT, 'b-flip1.png') });  // A=candidate
    report.tests.pairwise = {
      flip0: pw1.ok ? { winner: pw1.winner, winnerRole: pw1.winnerRole, reason: pw1.reason, costUsd: pw1.cost } : { error: pw1.error },
      flip1: pw2.ok ? { winner: pw2.winner, winnerRole: pw2.winnerRole, reason: pw2.reason, costUsd: pw2.cost } : { error: pw2.error },
    };
    check('B both pairwise calls succeeded', pw1.ok && pw2.ok, `${pw1.ok ? '' : pw1.error} ${pw2.ok ? '' : pw2.error}`);
    check('B degraded candidate LOSES with flip=false (incumbent wins)', pw1.ok && pw1.winnerRole === 'incumbent', pw1.ok ? `winner ${pw1.winner} → ${pw1.winnerRole}` : '');
    check('B degraded candidate LOSES with flip=true (incumbent wins)', pw2.ok && pw2.winnerRole === 'incumbent', pw2.ok ? `winner ${pw2.winner} → ${pw2.winnerRole}` : '');
    check('B raw winner LETTERS differ across orders (verdict tracks content, not position)', pw1.ok && pw2.ok && pw1.winner !== pw2.winner, pw1.ok && pw2.ok ? `${pw1.winner} vs ${pw2.winner}` : '');

    // ---------- TEST C: crash mid-loop → no scratch debris, graded untouched ----------
    if (!has('skip-crash')) {
      console.log('\nTEST C (crash-injection mid-loop)');
      const marker = '/tmp/refine-vision-crash-marker.txt';
      try { fs.unlinkSync(marker); } catch {}
      const before = new Set(activeFiles());
      const rvUrl = pathToFileURL(path.join(__dirname, 'refine-vision.mjs')).href;
      const code = `import(${JSON.stringify(rvUrl)}).then(async (m) => {
        const hooks = {
          critique: async ({ outPath }) => ({ ok: true, defects: [{ desc: 'synthetic', severity: 4, category: 'missing-content', fix: 'synthetic' }], cost: 0, model: 'stub', tilePath: outPath }),
          fix: async () => { require('fs').writeFileSync(${JSON.stringify(marker)}, 'fix-invoked'); process.kill(process.pid, 'SIGKILL'); },
        };
        await m.refineVision({ source: ${JSON.stringify(SOURCE)}, pageId: ${PAGE}, bands: [${JSON.stringify(smallest)}], iters: 1, outDir: '/tmp/refine-vision-st/crash', hooks });
      }).catch((e) => { console.error(String(e)); process.exit(1); });`;
      const child = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 420000, env: process.env });
      const killed = child.signal === 'SIGKILL';
      const operatorRan = fs.existsSync(marker); // fix hook fired AFTER scratch create + baseline render = mid-loop
      // SURGICAL debris cleanup via the active-file forensics diff — NO sweep --all (sibling rounds run live scratch)
      const debris = activeFiles().filter((f) => !before.has(f)).map((f) => Number(f.match(/(\d+)/)[1]));
      const cleaned = [];
      for (const id of debris) { try { await deletePage(id, PAGE); cleaned.push(id); } catch (e) { report.tests.crashCleanupError = String(e).slice(0, 200); } }
      const debrisGone = await Promise.all(debris.map((id) => pageExists(id).then((x) => !x))).then((xs) => xs.every(Boolean));
      report.tests.crash = { killed, operatorRan, debris, cleaned, debrisGone, childStderrTail: String(child.stderr).slice(-200) };
      check('C child SIGKILLed mid-loop (fix hook ran after baseline render)', killed && operatorRan, `signal ${child.signal} marker ${operatorRan}`);
      check('C exactly one scratch debris page, surgically deleted to 404', debris.length === 1 && debrisGone, `debris ${JSON.stringify(debris)} gone ${debrisGone}`);
    } else report.tests.crash = { skipped: true };

    const hash1 = await liveHash(PAGE);
    report.hash1 = hash1;
    check('\nFINAL graded page 3146 hash unchanged across all tests', hash1 === hash0, `${hash0} vs ${hash1}`);
  } catch (e) {
    console.error(String(e && e.stack || e));
    report.infraError = String(e);
    fs.writeFileSync('/tmp/refine-vision-selftest.json', JSON.stringify(report, null, 2));
    process.exit(3);
  }
  report.pass = pass;
  report.costUsd = +(((report.tests.identical && report.tests.identical.costUsd) || 0)
    + ((report.tests.pairwise && report.tests.pairwise.flip0 && report.tests.pairwise.flip0.costUsd) || 0)
    + ((report.tests.pairwise && report.tests.pairwise.flip1 && report.tests.pairwise.flip1.costUsd) || 0)).toFixed(3);
  fs.writeFileSync('/tmp/refine-vision-selftest.json', JSON.stringify(report, null, 2));
  console.log(`\nRESULT: ${pass ? 'ALL PASS' : 'FAIL'} — $${report.costUsd} — report → /tmp/refine-vision-selftest.json`);
  process.exit(pass ? 0 : 4);
})();
