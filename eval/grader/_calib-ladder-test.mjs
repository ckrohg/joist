#!/usr/bin/env node
/**
 * @purpose _calib-ladder-test.mjs — the ORDER-RECOVERY test: the human-free, fix-region resolving-power validation
 * the fusion audit demanded (the V2 Spearman was meaningless because the set was bimodal — trivial anchors carried
 * it). For each base's degradation ladder L0..L4 (built by _calib-ladder-gen.mjs, KNOWN monotone order by
 * construction), run the SAME production vision-judge (region-judge.judgePair) on (source, Lk) and ask:
 *   (1) does the judge RECOVER the monotone ranking? → Spearman(judge_scores, knownRank). +1 = perfect, the judge
 *       has mid-range resolving power; ~0 = it cannot tell the rungs apart (the exact failure the V2 set hid).
 *   (2) is it STRICTLY monotone-decreasing (s0 > s1 > ... > s4)?  (a stricter pass than rank-corr alone)
 *   (3) does the FATAL FLOOR trip at the human-perceptible rung (L2 invisible-heading / L3 blank-hero), not just the
 *       cartoon extreme L4? → first rung whose score crosses below FATAL_BAR (default 30) and the fatal class.
 * NOTE (fusion caveat): ladders certify ORDER, not absolute fidelity POINTS — severity != perceived-fidelity points,
 * so this does NOT replace human anchoring (that's the V2 sheet). It is the resolving-power half the bimodal set lacked.
 *
 * Usage: node _calib-ladder-test.mjs [--manifest calibration/ladders/manifest.json] [--bases supabase] [--no-vision]
 *        [--jobs 2] [--fatalbar 30] [--out /tmp/ladder-test]
 *   default = FULL vision judge (slow, ~claude per region per rung). --no-vision = deterministic core (fast, noisy —
 *   the core has known false-fatals on good clones, so order-recovery there is a FLOOR read, not the headline).
 */
import fs from 'fs';
import path from 'path';
import url from 'url';
import { judgePair } from './region-judge.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);
const MANIFEST = path.resolve(HERE, arg('manifest', 'calibration/ladders/manifest.json'));
const VISION = !has('no-vision');
const JOBS = +arg('jobs', 2);
const FATAL_BAR = +arg('fatalbar', 30);
const OUT = arg('out', '/tmp/ladder-test');
const ONLY = arg('bases', null);

// Spearman rho with average-rank tie handling.
function rank(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; }
function spearman(a, b) { const ra = rank(a), rb = rank(b), n = a.length; let s = 0; for (let i = 0; i < n; i++) s += (ra[i] - rb[i]) ** 2; return +(1 - (6 * s) / (n * (n * n - 1))).toFixed(3); }

async function pool(items, n, fn) { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }

(async () => {
  const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const bases = man.bases.filter((b) => !ONLY || ONLY.split(',').includes(b.base));
  fs.mkdirSync(OUT, { recursive: true });
  console.error(`[ladder] ${bases.length} base(s), vision=${VISION}, jobs=${JOBS}, fatalBar=${FATAL_BAR}`);
  const results = [];
  for (const b of bases) {
    const src = path.join(REPO, b.source_img);
    const scores = await pool(b.rungs, JOBS, async (r) => {
      const cln = path.join(REPO, r.clone_img);
      const j = await judgePair({ sourcePng: src, clonePng: cln, outDir: path.join(OUT, `${b.base}-${r.label}`), vision: VISION, blind: VISION, jobs: 3 });
      console.error(`[ladder] ${b.base} ${r.label}: judge=${j.score} fatals={${[...new Set(j.fatalClasses)].join(',')}}`);
      return { level: r.level, label: r.label, defect: r.defect, score: j.score, fatals: [...new Set(j.fatalClasses)] };
    });
    // knownRank: L0 best (highest) → L4 worst. Judge scores should DECREASE with level. Spearman(score, -level)=+1 ideal.
    const rho = spearman(scores.map((s) => s.score), scores.map((s) => -s.level));
    const strictlyMono = scores.every((s, i) => i === 0 || s.score <= scores[i - 1].score);
    const fatalTrip = scores.find((s) => s.score < FATAL_BAR);
    results.push({ base: b.base, scores: scores.map((s) => s.score), spearman: rho, strictlyMonotone: strictlyMono, fatalTripLevel: fatalTrip ? fatalTrip.level : null, fatalTripLabel: fatalTrip ? fatalTrip.label : null });
  }
  const meanRho = results.length ? +(results.reduce((s, r) => s + r.spearman, 0) / results.length).toFixed(3) : null;
  const allMono = results.every((r) => r.strictlyMonotone);
  const summary = { vision: VISION, fatalBar: FATAL_BAR, perBase: results, meanSpearman: meanRho, allStrictlyMonotone: allMono,
    verdict: meanRho == null ? 'NO_BASES' : (meanRho >= 0.9 && allMono ? 'STRONG resolving power' : meanRho >= 0.7 ? 'MODERATE' : 'WEAK — judge cannot order the fix-region'),
    note: 'order-recovery only (ground-truth ORDER, not POINTS); absolute fidelity still needs human anchoring (V2 sheet)' };
  console.log(JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, 'ladder-summary.json'), JSON.stringify(summary, null, 2));
})();
