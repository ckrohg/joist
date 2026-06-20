#!/usr/bin/env node
/** @purpose _correspondence-xval.mjs — the decisive WS1 cross-validation: does the DETERMINISTIC $0 correspondence
 * reward rank the 7 hero candidates (D0 + H1-6) like the trustworthy (but expensive) blind vision-judge panel did?
 * High Spearman agreement ⇒ the free measurement replaces the LLM judge for selection (the V2 thesis). Deterministic. */
import fs from 'fs';
import { flatten, correspondSection } from './correspondence-reward.mjs';

const HEROBAND = 950; const SEC = { x: 0, y: 0, w: 1440, h: HEROBAND, bg: 'rgb(8,8,8)' };
const heroLeaves = (treePath) => { const L = JSON.parse(fs.readFileSync(treePath, 'utf8')); return flatten(L).filter((n) => n.box && n.box.y < HEROBAND); };
const D0heroLeaves = () => { const L = JSON.parse(fs.readFileSync('/tmp/clone-772.json', 'utf8')); return flatten(L).filter((n) => n.box && n.box.y < HEROBAND); };
const ctx = { srcPageBg: 'rgb(8,8,8)', clonePageBg: 'rgb(8,8,8)', textOnly: true };

const src = heroLeaves('/tmp/resend-layout.json');
// vision-judge 3-panel averages (the trustworthy reference); cand-i = H_i
const VIS = { D0: 19.3, H1: 48.0, H2: 78.0, H3: 60.7, H4: 58.0, H5: 62.3, H6: 67.3 };
const cands = [
  { id: 'D0', leaves: D0heroLeaves() },
  ...[1, 2, 3, 4, 5, 6].map((i) => ({ id: 'H' + i, leaves: fs.existsSync(`/tmp/cap-cand-${i}.json`) ? heroLeaves(`/tmp/cap-cand-${i}.json`) : null })),
];

const rows = cands.filter((c) => c.leaves).map((c) => {
  const r = correspondSection(src, c.leaves, SEC, SEC, ctx);
  return { id: c.id, corr: r.score, R_text: r.R_text, color: r.axes.color, vision: VIS[c.id] };
});

function spearman(a, b) { const rk = (z) => { const ix = z.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = []; ix.forEach(([, i], j) => r[i] = j + 1); return r; }; const ra = rk(a), rb = rk(b), n = a.length; let s = 0; for (let i = 0; i < n; i++) s += (ra[i] - rb[i]) ** 2; return +(1 - 6 * s / (n * (n * n - 1))).toFixed(3); }

console.log('=== correspondence (det, $0) vs vision-judge (LLM panel) on resend hero candidates ===');
console.log('id   correspondence  R_text  color   vision');
for (const r of [...rows].sort((a, b) => b.corr - a.corr)) console.log(`${r.id.padEnd(4)} ${String(r.corr).padStart(8)}      ${r.R_text}   ${r.color}    ${r.vision}`);
const rho = spearman(rows.map((r) => r.corr), rows.map((r) => r.vision));
const corrRank = [...rows].sort((a, b) => b.corr - a.corr).map((r) => r.id);
const visRank = [...rows].sort((a, b) => b.vision - a.vision).map((r) => r.id);
console.log('\ncorrespondence ranking:', corrRank.join(' > '));
console.log('vision-judge   ranking:', visRank.join(' > '));
console.log('Spearman(correspondence, vision) =', rho, rho >= 0.7 ? '  ✓ AGREE — $0 measurement can replace the LLM judge for selection' : '  ✗ disagree — investigate');
const d0 = rows.find((r) => r.id === 'D0'); const worstClean = Math.min(...rows.filter((r) => r.id !== 'D0').map((r) => r.corr));
console.log(`broken D0: correspondence ${d0.corr} (rank #${corrRank.indexOf('D0') + 1}/${rows.length})  ${d0.corr < worstClean ? '✓ ranked below every clean candidate' : '✗ not last'}`);
