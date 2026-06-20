#!/usr/bin/env node
/**
 * @purpose bestofn-select.mjs — LEVER B wired to LEVER A. Given a source section + a POOL of candidate reconstructions
 * (renders, optionally their Elementor trees for the editability term), score each with the cheap vision reward
 * (reward-vision.judgeRender) at a PANEL of N (default 3 — panel=1 is too noisy on the fine ranking; the panel
 * stabilizes selection while staying cheap), then SELECT the argmax-reward candidate. This is the select-by-reward
 * operator the best-of-N / RL loop calls; it converts reward quality into output quality with no training.
 *
 * Reports per-candidate visual (panel mean), the panel spread (max-min — a stability read), reward, the SELECTED
 * winner, and whether the top-2 are within panel noise (an "ambiguous" flag → caller may widen the panel). Selection
 * is robust to the panel-1 noise precisely because the broken-vs-clean gap is large and the panel averages out the rest.
 *
 * CLI:
 *   node bestofn-select.mjs --source <srcCrop.png> --candidates a.png,b.png,... [--trees ta.json,tb.json,...]
 *        [--panel 3] [--model haiku] [--json]
 * Renders NOTHING; reads PNGs/trees + calls `claude -p`. Pairs --trees positionally with --candidates (optional).
 */
import fs from 'fs';
import path from 'path';
import { judgeRender, judgeListwise } from './reward-vision.mjs';
import { floorCheck } from './reward-features.mjs';
import { gradeCorrespondence } from './correspondence-reward.mjs';

// WS3 — 3-TIER selector (PATH_TO_TRUE_1TO1_V2): Tier-0 $0 veto-floor rejects gross-broken; Tier-1 $0 deterministic
// CORRESPONDENCE narrows to a frontier band (rejects broken-but-not-veto'd builds — it ranked the broken D0 LAST,
// agreeing with the vision judge at ρ=0.714 where SSIM put D0 mid-pack); Tier-2 ONE listwise LLM call fine-picks within
// the near-tied clean frontier. Correspondence + veto are FREE and keep broken builds away from the (paid) judge.
// candidates: [{ shot, tree, id? }] — `shot` = render PNG (veto + judge), `tree` = re-captured clone box-tree
// (correspondence). `correspond(cand)→0-100` may be supplied (e.g. per-section); else gradeCorrespondence(sourceTree,·).
export async function bestOfNCorr({ sourcePng, sourceTree = null, candidates, correspond = null, sidecarFracs = null, model = 'haiku', frontierBand = 14, textOnly = true }) {
  const scoreCorr = correspond || ((c) => (sourceTree && c.tree) ? gradeCorrespondence(sourceTree, c.tree, { textOnly }).score : null);
  const rows = candidates.map((c) => ({ ...c, floor: floorCheck(sourcePng, c.shot, { sidecarFracs }) }));
  for (const r of rows) r.corr = r.floor.floored ? null : scoreCorr(r);
  const survivors = rows.filter((r) => !r.floor.floored && r.corr != null);
  const maxCorr = survivors.length ? Math.max(...survivors.map((r) => r.corr)) : 0;
  for (const r of rows) r.frontier = !r.floor.floored && r.corr != null && r.corr >= maxCorr - frontierBand;
  const frontier = rows.filter((r) => r.frontier);
  // Tier-2: ONE listwise call over the frontier only (never over floored/below-frontier broken builds).
  const lw = frontier.length > 1 ? await judgeListwise({ sourcePng, renderPngs: frontier.map((r) => r.shot), model }) : { visual: frontier.map(() => 100), cost: 0 };
  frontier.forEach((r, i) => { r.judge = lw.visual?.[i] ?? null; });
  rows.forEach((r) => { r.reward = r.floor.floored ? 0 : !r.frontier ? +(r.corr / 100 * 0.5).toFixed(3) : +((r.judge ?? 0) / 100).toFixed(3); }); // below-frontier kept but de-rated
  const ranked = [...rows].sort((a, b) => (b.frontier - a.frontier) || ((b.judge ?? -1) - (a.judge ?? -1)) || ((b.corr ?? -1) - (a.corr ?? -1)));
  return { winner: ranked[0], ranked, flooredCount: rows.filter((r) => r.floor.floored).length, frontierCount: frontier.length, maxCorr, judgeCalls: frontier.length > 1 ? 1 : 0, cost: +(lw.cost || 0).toFixed(4), mode: '3-tier(veto→corr→listwise)' };
}

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

// CHEAP selector: (1) $0/eval VETO-FLOOR pre-filter rejects gross-broken candidates; (2) ONE batched LISTWISE judge
// ranks the survivors on a single consistent scale (cheap + stable vs K independent calls). Falls back to listwise-all
// when everything floors. This is the pragmatic distilled-reward selection: free reject of the worst + cheap stable rank.
export async function bestOfNCheap({ sourcePng, candidates, sidecarFracs = null, model = 'haiku' }) {
  const floors = candidates.map((c) => ({ cand: c, floor: floorCheck(sourcePng, c, { sidecarFracs }) }));
  let pool = floors.filter((f) => !f.floor.floored).map((f) => f.cand);
  const allFloored = pool.length === 0;
  if (allFloored) pool = candidates; // nothing survived → still rank them so we return the least-bad
  const lw = pool.length ? await judgeListwise({ sourcePng, renderPngs: pool, model }) : { visual: [], cost: 0 };
  const lwOf = (c) => { const i = pool.indexOf(c); return i >= 0 ? (lw.visual?.[i] ?? null) : null; };
  const rows = floors.map((f) => {
    const floored = f.floor.floored && !allFloored; const v = lwOf(f.cand);
    return { cand: f.cand, floored, visual: floored ? null : v, reward: floored ? 0 : (v == null ? null : +(v / 100).toFixed(3)), floorReasons: f.floor.reasons };
  });
  rows.sort((a, b) => (b.reward ?? -1) - (a.reward ?? -1));
  return { winner: rows[0], ranked: rows, flooredCount: floors.filter((f) => f.floor.floored).length, allFloored, cost: +(lw.cost || 0).toFixed(4), model, mode: 'floor+listwise' };
}

export async function bestOfN({ sourcePng, candidates, trees = [], panel = 3, model = 'haiku' }) {
  const rows = [];
  for (let i = 0; i < candidates.length; i++) {
    const r = await judgeRender({ sourcePng, renderPng: candidates[i], tree: trees[i] || null, model, panel });
    const spread = r.scores ? Math.max(...r.scores) - Math.min(...r.scores) : null;
    rows.push({ cand: candidates[i], visual: r.visual, scores: r.scores, spread, editability: r.editability, reward: r.reward, cost: r.cost, notes: r.notes });
  }
  const scored = rows.filter((r) => r.reward != null).sort((a, b) => b.reward - a.reward);
  const winner = scored[0] || null;
  const runnerUp = scored[1] || null;
  // ambiguous if the top-2 reward gap is within the winner's panel noise (half-spread) → caller may widen the panel.
  const ambiguous = !!(winner && runnerUp && winner.spread != null && (winner.reward - runnerUp.reward) * 100 < (winner.spread / 2));
  return { winner, ranked: scored, ambiguous, totalCost: +rows.reduce((s, r) => s + (r.cost || 0), 0).toFixed(4), panel, model };
}

const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace('file://', ''));
if (IS_MAIN) (async () => {
  const SRC = arg('source'); const cands = (arg('candidates') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const trees = (arg('trees') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!SRC || !cands.length) { console.error('usage: bestofn-select.mjs --source <png> --candidates a.png,b.png,... [--trees a.json,...]\n   panel mode:  [--panel 3] [--model haiku]\n   cheap mode:  --cheap [--sections <src.sections.json>]   (veto-floor pre-filter + one batched listwise judge)'); process.exit(2); }
  if (has('cheap')) {
    let sidecarFracs = null; const sFile = arg('sections'); if (sFile) { try { const j = JSON.parse(fs.readFileSync(sFile, 'utf8')); sidecarFracs = Array.isArray(j) ? j : j.fracs; } catch (e) { console.error('bad --sections:', e.message); } }
    const res = await bestOfNCheap({ sourcePng: SRC, candidates: cands, sidecarFracs, model: arg('model', 'haiku') });
    if (has('json')) { console.log(JSON.stringify(res, null, 2)); return; }
    console.log(`\n=== BEST-OF-N CHEAP (veto-floor + listwise ${res.model}) ===`);
    console.log(`floored ${res.flooredCount}/${cands.length} (gross-broken, $0/eval pre-filter)${res.allFloored ? ' — ALL floored, ranking anyway' : ''}`);
    console.log('rank  candidate              floored  visual  reward  floor-reasons');
    res.ranked.forEach((r, i) => console.log(`  ${i + 1}.  ${path.basename(r.cand).padEnd(20)}  ${r.floored ? 'FLOOR' : '  -  '}    ${String(r.visual ?? '-').padStart(4)}    ${r.reward ?? '-'}    ${(r.floorReasons || []).join(',')}`));
    console.log(`\nSELECTED → ${path.basename(res.winner.cand)} (reward ${res.winner.reward})  |  one LLM call, cost $${res.cost}`);
    return;
  }
  const res = await bestOfN({ sourcePng: SRC, candidates: cands, trees, panel: +arg('panel', 3), model: arg('model', 'haiku') });
  if (has('json')) { console.log(JSON.stringify(res, null, 2)); return; }
  console.log(`\n=== BEST-OF-N SELECT (reward-vision, panel=${res.panel} ${res.model}) ===`);
  console.log('rank  candidate              visual  panel-scores   spread  reward');
  res.ranked.forEach((r, i) => console.log(`  ${i + 1}.  ${path.basename(r.cand).padEnd(20)}  ${String(r.visual).padStart(5)}   [${(r.scores || []).join(',')}]`.padEnd(56) + `  ${String(r.spread).padStart(3)}    ${r.reward}`));
  console.log(`\nSELECTED → ${path.basename(res.winner.cand)}  (reward ${res.winner.reward}, visual ${res.winner.visual})`);
  console.log(`${res.ambiguous ? '⚠ top-2 within panel noise — consider a wider panel' : '✓ winner clear of runner-up beyond panel noise'}`);
  console.log(`cost $${res.totalCost}`);
})().catch((e) => { console.error('bestofn-select FAILED:', e && e.stack || e); process.exit(1); });
