#!/usr/bin/env node
/** @purpose _reward-dataset.mjs — STAGE 2 (real): build the labeled reward dataset from the 3 degradation ladders
 * (15 full-page, same-framing examples spanning the quality range; teacher = reward-vision haiku score) + cross-base
 * validation: train the feature combiner on 2 bases, predict the held-out base's ladder. Does the cheap deterministic
 * feature combiner GENERALIZE across sites (recover the held-out base's rung order)? — the test the 7-point slice
 * couldn't do. Writes reward-dataset.jsonl. Deterministic (features); reuses pre-computed reward-vision labels. */
import fs from 'fs';
import { features } from './reward-features.mjs';

const BASES = [
  { base: 'supabase', labels: '/tmp/ladder-rv.json' },
  { base: 'linear', labels: '/tmp/ladder-linear.json' },
  { base: 'framer', labels: '/tmp/ladder-framer.json' },
];
const RUNGS = ['L0-pristine', 'L1-desat35', 'L2-invis-heading', 'L3-blank-hero', 'L4-blank-hero+section'];

const rows = [];
for (const b of BASES) {
  const lab = JSON.parse(fs.readFileSync(b.labels, 'utf8'));
  const score = {}; for (const r of lab.ranked) score[r.cand.split('-L')[1][0]] = r.visual;
  const src = `calibration/v2-shots/${b.base}-src-d.png`;
  for (let lvl = 0; lvl < 5; lvl++) {
    const f = features(src, `calibration/ladders/${b.base}-${RUNGS[lvl]}.png`, null);
    rows.push({ base: b.base, level: lvl, teacher: score[String(lvl)], f });
  }
}
fs.writeFileSync('/tmp/reward-dataset.jsonl', rows.map((r) => JSON.stringify(r)).join('\n'));
console.log(`dataset: ${rows.length} labeled examples → /tmp/reward-dataset.jsonl`);

const FEATS = ['ssimCoarse', 'ssimFine', 'vetoFatal', 'vetoHigh', 'heroDefect', 'headingDefect', 'colorHistDist', 'inkDelta'];
const xrow = (r) => [1, ...FEATS.map((k) => r.f[k] ?? 0)];
function fit(X, y, lambda = 1.0) { const n = X.length, p = X[0].length; const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < p; a++) { b[a] += X[i][a] * y[i]; for (let c = 0; c < p; c++) A[a][c] += X[i][a] * X[i][c]; }
  for (let a = 1; a < p; a++) A[a][a] += lambda; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < p; c++) { let pv = c; for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[pv][c])) pv = r;[M[c], M[pv]] = [M[pv], M[c]]; const d = M[c][c] || 1e-9; for (let r = 0; r < p; r++) if (r !== c) { const f = M[r][c] / d; for (let k = c; k <= p; k++) M[r][k] -= f * M[c][k]; } }
  return M.map((r, i) => r[p] / (r[i] || 1e-9)); }
const pred = (w, x) => x.reduce((s, v, i) => s + v * w[i], 0);
function spearman(a, b) { const rk = (z) => { const ix = z.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = []; ix.forEach(([, i], j) => r[i] = j + 1); return r; }; const ra = rk(a), rb = rk(b), n = a.length; let s = 0; for (let i = 0; i < n; i++) s += (ra[i] - rb[i]) ** 2; return +(1 - 6 * s / (n * (n * n - 1))).toFixed(3); }

console.log('\n=== CROSS-BASE validation (train on 2 bases, predict the held-out base ladder) ===');
let agg = [];
for (const heldOut of BASES.map((b) => b.base)) {
  const tr = rows.filter((r) => r.base !== heldOut), te = rows.filter((r) => r.base === heldOut);
  const w = fit(tr.map(xrow), tr.map((r) => r.teacher), 1.0);
  const p = te.map((r) => pred(w, xrow(r)));
  const rhoCombiner = spearman(p, te.map((r) => r.teacher));
  const rhoSsim = spearman(te.map((r) => r.f.ssimCoarse), te.map((r) => r.teacher));
  const rhoOrder = spearman(p, te.map((r) => -r.level)); // does pred recover the known degradation order?
  agg.push(rhoOrder);
  console.log(`  held-out ${heldOut.padEnd(9)}: combiner↔teacher ρ=${rhoCombiner}  ssim-alone↔teacher ρ=${rhoSsim}  combiner↔knownOrder ρ=${rhoOrder}  (preds ${p.map((v) => v.toFixed(0)).join(',')} vs teacher ${te.map((r) => r.teacher).join(',')})`);
}
console.log(`\nmean combiner↔knownOrder ρ = ${(agg.reduce((s, x) => s + x, 0) / agg.length).toFixed(3)}  (1.0 = recovers degradation order on UNSEEN sites)`);
