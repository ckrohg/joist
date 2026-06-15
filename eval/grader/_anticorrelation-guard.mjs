#!/usr/bin/env node
/**
 * @purpose _anticorrelation-guard.mjs — PHASE 4 ANTI-CORRELATION GUARD. The project was previously burned by a
 * grader ANTI-correlated with humans ("looks done" is worthless). This guard computes Spearman ρ(engine, human)
 * and ρ(hand-detector, human) on the spread RANK corpus and asserts:
 *      ρ(engine, human) > ρ(hand-detector, human)   AND   ρ(engine, human) > 0.
 * i.e. the universal engine tracks human judgement at least as well as the retired detectors, and positively.
 *
 * THE CORPUS (honest). The RANK corpus is the 4 midrange projection clones in midrange-human-results.json
 * (M01 tailwind=0, M02 vercel=0, M03 overreacted=5, M04 stripe=0). Two HARD limitations, reported not hidden:
 *   (1) ONLY 2 of the 4 (M01→page 268 tailwind, M03→page 341 overreacted) have a LIVE DOM-correspondence compare
 *       blob the engine + detectors can score. M02 vercel / M04 stripe are screenshot-pair-only (no element tree)
 *       → the engine cannot run on them. So the human-anchored rank reduces to 2 scorable points.
 *   (2) the human spread is near-degenerate (0,0,5,0): three of four are zero. A Spearman over 2–4 points with
 *       three ties is statistically thin. We compute it anyway (it is the corpus we have) and we ALSO report a
 *       secondary MONOTONICITY check on the 4 overreacted projection clones (310/310-v3/335/341), which have an
 *       objective fidelity ordering even without per-page human scalars.
 *
 * WHY THE SIGN STILL MATTERS. On the 2 human-anchored points the hand-detector is ANTI-monotone by construction:
 * the marketing page (268, human=0 = worst) is where the blog-overfit detectors catch the FEWEST defects (their
 * 0%-marketing-recall hole) → the detector implies 268 is BETTER than the blog 341 (human=5) — the exact
 * inversion this whole uplevel targets. The engine, blind to the blog's chrome, ranks 268 below 341 (monotone).
 *
 * SCORES. engine = pageScore (higher = better). hand-detector implied quality = 1 − caughtCount/7 (more defects
 * caught = worse clone = lower implied quality). human = overall/100. Spearman is sign-invariant to these
 * monotone rescalings; we align all three so "higher = better" before ranking.
 *
 * SAFETY: PURE — reads cached compare blobs + the calibration jsons. No network/host/builder/git. Imports
 * axisdelta-engine.mjs + compare-detectors.mjs UNCHANGED.
 *
 *   node _anticorrelation-guard.mjs [--json]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as E from './axisdelta-engine.mjs';
import { runAllDetectors } from './compare-detectors.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const has = (k) => process.argv.includes('--' + k);
const FLOORS = E.loadFloors();

// ── Spearman ρ (rank correlation) with average-rank tie handling. ──
function rankAvg(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; // 1-based average rank over the tie block
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = avg;
    i = j + 1;
  }
  return ranks;
}
function spearman(a, b) {
  if (a.length !== b.length || a.length < 2) return null;
  const ra = rankAvg(a), rb = rankAvg(b);
  const n = a.length;
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const xa = ra[i] - ma, xb = rb[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
  if (da === 0 || db === 0) return null; // a constant (all-ties) column → undefined correlation
  return num / Math.sqrt(da * db);
}

function scoreBlob(blobPath) {
  const blob = JSON.parse(fs.readFileSync(blobPath, 'utf8'));
  const eng = E.runEngine(blob, FLOORS, {});
  const det = runAllDetectors(blob);
  const caught = det.recall.caughtCount;
  const probed = det.recall.totalProbed; // 7 in-scope
  return { source: blob.report.source, enginePageScore: eng.pageScore, detectorCaught: caught,
    detectorImpliedQuality: +(1 - caught / probed).toFixed(4) };
}

function main() {
  // ── human-anchored RANK corpus: the midrange pairs that have a LIVE DOM blob ──
  const midrange = JSON.parse(fs.readFileSync(path.join(__dir, 'calibration', 'midrange-human-results.json'), 'utf8')).results;
  const humanBySite = Object.fromEntries(midrange.map((r) => [r.site, r.overall]));
  // map the 2 DOM-scorable midrange sites → their compare blobs.
  const anchored = [
    { site: 'tailwindcss.com/docs', blob: '/tmp/compare-268.json', human: humanBySite['tailwindcss.com/docs'] },
    { site: 'overreacted.io',       blob: '/tmp/compare-341.json', human: humanBySite['overreacted.io'] },
  ].filter((x) => fs.existsSync(x.blob) && x.human != null);

  const points = anchored.map((a) => { const s = scoreBlob(a.blob); return { ...a, ...s, humanQuality: a.human / 100 }; });

  const engineVec = points.map((p) => p.enginePageScore);
  const detectorVec = points.map((p) => p.detectorImpliedQuality);
  const humanVec = points.map((p) => p.humanQuality);
  const rhoEngine = spearman(engineVec, humanVec);
  const rhoDetector = spearman(detectorVec, humanVec);

  // ── secondary: monotonicity over the 4 overreacted projection clones (objective fidelity proxy, no per-page
  //    human scalar). 341 is the cleanest projection (manifest _note); 310 = the heavily-broken v2. We report the
  //    engine vs detector ordering as a directional sanity check, NOT a human ρ. ──
  const proj = ['310', '310-v3', '335', '341'].map((id) => ({ id, path: `/tmp/compare-${id}.json` })).filter((x) => fs.existsSync(x.path)).map((x) => ({ id: x.id, ...scoreBlob(x.path) }));

  // ── PAIRWISE human-anchored direction (the load-bearing 2-point result, robust to the degenerate spread): ──
  let pairwise = null;
  if (points.length === 2) {
    const [a, b] = points;
    const worse = a.humanQuality < b.humanQuality ? a : b;     // lower human = worse clone
    const better = a.humanQuality < b.humanQuality ? b : a;
    const engineMonotone = worse.enginePageScore <= better.enginePageScore;
    const detectorMonotone = worse.detectorImpliedQuality <= better.detectorImpliedQuality;
    pairwise = { worse: worse.site, better: better.site,
      engineMonotone, detectorMonotone,
      note: `human: ${worse.site}(${(worse.humanQuality * 100) | 0}) < ${better.site}(${(better.humanQuality * 100) | 0}). engine ${engineMonotone ? 'AGREES' : 'INVERTS'} (${worse.enginePageScore} vs ${better.enginePageScore}); detector ${detectorMonotone ? 'AGREES' : 'INVERTS'} (${worse.detectorImpliedQuality} vs ${better.detectorImpliedQuality}).` };
  }

  // GUARD VERDICT. ρ may be null/degenerate on this thin corpus; fall back to the pairwise direction, which is the
  // honest signal the 2-point human-anchored corpus supports.
  const rhoComparable = rhoEngine != null && rhoDetector != null;
  const guardByRho = rhoComparable && rhoEngine > rhoDetector && rhoEngine > 0;
  const guardByPairwise = pairwise && pairwise.engineMonotone && !pairwise.detectorMonotone;
  const pass = guardByRho || guardByPairwise;

  console.log('\n==== ANTI-CORRELATION GUARD: ρ(engine,human) vs ρ(hand-detector,human) ====');
  console.log('RANK corpus = midrange projection clones with a LIVE DOM blob (only 2 of 4 are DOM-scorable):\n');
  console.log('site                       human  engine    detectorCaught  detectorImpliedQ');
  for (const p of points) console.log(`  ${p.site.padEnd(24)} ${String((p.humanQuality * 100) | 0).padStart(5)}  ${p.enginePageScore.toFixed(4)}  ${String(p.detectorCaught + '/7').padStart(14)}  ${p.detectorImpliedQuality.toFixed(4)}`);
  console.log(`\nSpearman ρ(engine, human)   = ${rhoEngine == null ? 'undefined (degenerate/ties)' : rhoEngine.toFixed(4)}`);
  console.log(`Spearman ρ(detector, human) = ${rhoDetector == null ? 'undefined (degenerate/ties)' : rhoDetector.toFixed(4)}`);
  if (pairwise) console.log(`\nPAIRWISE (human-anchored, robust to the degenerate spread):\n  ${pairwise.note}`);
  console.log('\n4 OVERREACTED PROJECTION CLONES (objective fidelity proxy, NO per-page human scalar — directional sanity only):');
  for (const p of proj) console.log(`  ${p.id.padEnd(8)} engine ${p.enginePageScore.toFixed(4)}  detectorCaught ${p.detectorCaught}/7  detectorImpliedQ ${p.detectorImpliedQuality.toFixed(4)}`);

  console.log(`\nGUARD: ${pass ? 'PASS' : 'FAIL'}  — engine tracks humans ${guardByRho ? `(ρ ${rhoEngine.toFixed(3)} > detector ρ ${rhoDetector.toFixed(3)} AND > 0)` : ''}${guardByPairwise ? '(pairwise: engine AGREES with human ordering where the detector INVERTS it)' : ''}`);
  if (!pass) console.log('  HONEST FAIL: neither ρ-dominance nor pairwise-dominance held on the available corpus.');
  console.log('\nHONEST CAVEAT: the human RANK corpus has near-zero spread (0,0,5,0) and only 2 DOM-scorable points;');
  console.log('the ρ is statistically thin. The pairwise direction (engine monotone where the detector inverts on');
  console.log('the marketing page) is the load-bearing result; a fuller spread needs the sequestered HOLDOUT scored BLIND.');

  if (has('json')) console.log('\n' + JSON.stringify({ harness: 'eval/grader/_anticorrelation-guard.mjs', points, rhoEngine, rhoDetector, pairwise, proj, guardByRho, guardByPairwise, pass }, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
