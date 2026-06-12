#!/usr/bin/env node
// @purpose retrieve.mjs — deterministic top-k exemplar retrieval (EMBODIMENT_APPROACH §P3).
// Given a section crop PNG + its atlas construct classification, return the k best-matching library
// records as few-shot context for the authoring agent. Match priority: construct-id overlap FIRST
// (Jaccard, weight 2), visual second (density-tag overlap + palette distance, weight 1 each), tiny
// lint-clean tiebreaker, then record-id lexicographic — same query → same answer, always.
// usage: node retrieve.mjs --png <crop.png> --constructs a,b,c [--k 3] [--json]
import { describePng, loadRecords } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const png = arg('png'), constructs = (arg('constructs', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const k = parseInt(arg('k', '3'), 10);
if (!png || constructs.length === 0) { console.error('usage: retrieve.mjs --png <crop.png> --constructs a,b,c [--k 3] [--json]'); process.exit(2); }

const q = describePng(png);
const qSet = new Set(constructs);

const hex2rgb = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
// palette distance: for each query color, distance to NEAREST record color; mean, normalized to [0,1]
function paletteDist(qp, rp) {
  if (!qp.length || !rp.length) return 1;
  const rs = rp.map(hex2rgb);
  let sum = 0;
  for (const qc of qp.map(hex2rgb)) {
    let best = Infinity;
    for (const rc of rs) best = Math.min(best, Math.abs(qc[0] - rc[0]) + Math.abs(qc[1] - rc[1]) + Math.abs(qc[2] - rc[2]));
    sum += best;
  }
  return Math.min(1, sum / qp.length / 765);
}

const scored = loadRecords().map((rec) => {
  const rSet = new Set(rec.constructIds);
  const inter = [...qSet].filter((c) => rSet.has(c)).length;
  const union = new Set([...qSet, ...rSet]).size;
  const jaccard = union ? inter / union : 0;
  const qt = new Set(q.densityTags), rt = new Set(rec.visualDescriptor.densityTags || []);
  const tagInter = [...qt].filter((t) => rt.has(t)).length;
  const tagScore = tagInter / Math.max(1, new Set([...qt, ...rt]).size);
  const pd = paletteDist(q.palette, rec.visualDescriptor.palette || []);
  const lintBonus = rec.lint && rec.lint.clean === false ? 0 : 0.01;
  const score = 2 * jaccard + tagScore + (1 - pd) + lintBonus;
  return { id: rec.id, score: +score.toFixed(6), jaccard: +jaccard.toFixed(4), tagScore: +tagScore.toFixed(4), paletteDist: +pd.toFixed(4), constructIds: rec.constructIds, provenance: rec.provenance, verification: rec.verification.status, authoredHtml: rec.authoredHtml, renderPng: rec.renderPng };
});
scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
const top = scored.slice(0, k);

if (process.argv.includes('--json')) console.log(JSON.stringify({ query: { png, constructs, descriptor: { palette: q.palette, densityTags: q.densityTags } }, top }, null, 2));
else {
  console.log(`query: ${png}\n constructs=[${constructs.join(',')}] palette=${q.palette.join(',')} tags=${q.densityTags.join(',')}`);
  for (const t of top) console.log(`  ${t.score.toFixed(3)}  ${t.id}  (j=${t.jaccard} tags=${t.tagScore} pal=${t.paletteDist})  ${t.provenance}/${t.verification}  → ${t.authoredHtml}`);
}
