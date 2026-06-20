#!/usr/bin/env node
/** @purpose _reward-rubric-selftest.mjs — HERMETIC gate for WS4's linear-head fit machinery (no claude). Proves the
 * head generalizes CROSS-SITE on site-invariant rubric features (the ELHSR claim the prior pixel-feature head failed:
 * LOO ρ 0.20/-0.9). Fits on 2 synthetic "sites", predicts the held-out site's quality ladder; asserts monotone order
 * recovery + bounded output. The REAL fit awaits the 18 human-anchor labels; this gates the machinery. Exit 1 on fail. */
import { fitHead, applyHead } from './reward-rubric.mjs';

let fails = 0; const ok = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); if (!c) fails++; };
function spearman(a, b) { const rk = (z) => { const ix = z.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = []; ix.forEach(([, i], j) => r[i] = j + 1); return r; }; const ra = rk(a), rb = rk(b), n = a.length; let s = 0; for (let i = 0; i < n; i++) s += (ra[i] - rb[i]) ** 2; return +(1 - 6 * s / (n * (n * n - 1))).toFixed(3); }

// synthetic data: 3 "sites", each a quality ladder L0..L4. Rubric is SITE-INVARIANT (a "4 on color" means the same
// everywhere) — only the ladder LEVEL drives the rubric + label. A small per-site rubric jitter simulates judge noise.
const LADDER = [ // [layout,color,completeness,hierarchy,polish], label
  { r: [9, 9, 9, 9, 9], y: 90 }, { r: [9, 7, 8, 8, 8], y: 75 }, { r: [8, 4, 5, 6, 5], y: 48 }, { r: [6, 4, 3, 4, 4], y: 32 }, { r: [4, 3, 2, 3, 2], y: 20 },
];
const KEYS = ['layout', 'color', 'completeness', 'hierarchy', 'polish'];
const mkSite = (jit) => LADDER.map((L) => ({ rubric: Object.fromEntries(KEYS.map((k, i) => [k, Math.max(0, Math.min(10, L.r[i] + jit[i]))])), label: L.y }));
const sites = [mkSite([0, 0, 0, 0, 0]), mkSite([0.5, -0.5, 0.3, -0.2, 0.4]), mkSite([-0.4, 0.6, -0.3, 0.5, -0.2])];

console.log('── cross-site leave-one-out (fit on 2 sites, predict the held-out site ladder) ──');
let agg = [];
for (let h = 0; h < 3; h++) {
  const train = sites.filter((_, i) => i !== h).flat(), test = sites[h];
  const head = fitHead(train, 1.0);
  const preds = test.map((s) => applyHead(head, s.rubric));
  const rho = spearman(preds, test.map((s) => s.label));
  const mono = preds.every((p, i) => i === 0 || p <= preds[i - 1] + 1e-6);
  agg.push(rho);
  console.log(`  held-out site ${h}: preds ${preds.map((p) => p.toFixed(0)).join(',')} vs labels ${test.map((s) => s.label).join(',')}  ρ=${rho} mono=${mono}`);
  ok(`site ${h}: order recovered (ρ ≥ 0.9)`, rho >= 0.9);
}
const meanRho = +(agg.reduce((a, x) => a + x, 0) / agg.length).toFixed(3);
ok('mean cross-site ρ ≥ 0.9 (generalizes where the pixel-feature head got 0.20/-0.9)', meanRho >= 0.9, `mean ρ=${meanRho}`);
ok('applyHead bounded [0,100]', applyHead(fitHead(sites[0]), { layout: 99, color: 99, completeness: 99, hierarchy: 99, polish: 99 }) <= 100 && applyHead(fitHead(sites[0]), { layout: -5, color: 0, completeness: 0, hierarchy: 0, polish: 0 }) >= 0);

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAIL'} — reward-rubric fit selftest  (real head-fit awaits the 18 human-anchor labels)`);
process.exit(fails === 0 ? 0 : 1);
