#!/usr/bin/env node
/**
 * @purpose _region-judge-calibration.mjs — runs region-judge.mjs over all 18 calibration pairs, joins each to
 * human-results.json by pair_id, and reports the 3 GATE NUMBERS HONESTLY (the orchestrator re-executes this;
 * the builder does NOT self-bless):
 *   (a) MAE        — mean |judgeScore - humanOverall| over the 18 pairs (lower = better; human overall is 0-6).
 *   (b) SPEARMAN   — rank correlation judge vs human overall. The old composite was ANTI-correlated; the target
 *                    is a STRONG POSITIVE rank-corr (the judge orders pairs like the human does). With all 18
 *                    human overalls clustered in 0-6 the rank signal is weak/tie-heavy, so we ALSO report the
 *                    fraction of pairs the judge scores <=30 (humans rated every pair <=6 — a calibrated judge
 *                    should put essentially ALL of them low; "lowAgreement" is the more legible headline here).
 *   (c) FATAL-RECALL — over the pairs where the human checked a fatal-class box (wrong/missing logo -> logo;
 *                    invisible heading -> heading; blank/broken hero -> hero; unstyled CTA -> CTA), did the judge
 *                    flag that SAME fatal class? Reported per-class and overall. This is the anti-blindness number.
 *
 * Modes: default = FULL judge (vision+det) over the 18 BROKEN P-pairs (slow, ~claude per region; --jobs/--pairs scope).
 *        --no-vision = deterministic core only (fast, hermetic) — a useful floor read, but recall is lower
 *        because subtle invisible-heading / wrong-style defects need the vision pass.
 *        --midrange  = the 4 PROJECTION-quality M-pairs (M01-M04) keyed to midrange-human-results.json (human:
 *                      tailwind 0, vercel 0, overreacted 5, stripe 0). Adds the two new disqualifying classes
 *                      (imagery, overlap) to the fatal-recall report. M-pair images live under eval/grader/.shots/
 *                      via the MIDRANGE_KEY below (ABSENT from GRADER_KEY.json, which holds P01-P18 only).
 *        --all       = the UNION of 22 (18 P + 4 M), human file = human-results + midrange-human-results merged.
 *        --pairs scopes within any mode (e.g. --midrange --pairs M01,M02).
 * Usage: node _region-judge-calibration.mjs [--no-vision] [--midrange|--all] [--pairs P01,M01,...] [--jobs 2] [--out dir]
 */
import fs from 'fs';
import path from 'path';
import { judgePair } from './region-judge.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

const REPO = path.resolve(path.join(import.meta.dirname, '..', '..'));
const CAL = path.join(import.meta.dirname, 'calibration');
const KEY = JSON.parse(fs.readFileSync(path.join(CAL, 'GRADER_KEY.json'), 'utf8'));
const VISION = !has('no-vision');
const JOBS = +arg('jobs', VISION ? 2 : 6);
const OUT = arg('out', '/tmp/rj-cal');
const ONLY = arg('pairs', null);

// ── MIDRANGE_KEY: the 4 PROJECTION-quality mid-range pairs (M01-M04) the human scored in midrange-human-results.json.
// These ids are ABSENT from GRADER_KEY.json (P01-P18 only), so the calibration harness could not reach them. Each id
// maps to its source/clone shot images (same source==clone height as P-pairs, except M03). Paths are relative to REPO
// (joined below) so they match the existing KEY.pairs shape (source_img/clone_img). The human scored:
//   M01 tailwind 0, M02 vercel 0, M03 overreacted 5, M04 stripe 0.
// M03 CAVEAT (P07-class viewport mismatch): the human scored the FULL projection (1440x53761) but the only available
// SOURCE is the top-1000 crop. We use the full clone per the MAP preference so the lower-page defects (wrong-logo /
// unstyled-CTA / missing-panels) are visible to the VISION pass; det-only on it is UNRELIABLE (the 53x height mismatch
// corrupts the proportional banding), so M03 is the one midrange pair whose disqualifiers need vision, not det.
const MIDRANGE_KEY = {
  pairs: [
    { pair_id: 'M01', site: 'tailwind', source_img: 'eval/grader/.shots/calib-tailwind-source.png', clone_img: 'eval/grader/.shots/calib-tailwind-clone.png' },
    { pair_id: 'M02', site: 'vercel',   source_img: 'eval/grader/.shots/calib-vercel-source.png',   clone_img: 'eval/grader/.shots/calib-vercel-clone.png' },
    { pair_id: 'M03', site: 'overreacted', source_img: 'eval/grader/.shots/src-overreacted-top.png', clone_img: 'eval/grader/.shots/proj-overreacted-258.png', det_unreliable: true, note: 'full clone (1440x53761) vs top-1000 source — det-only corrupted by height mismatch; disqualifiers need vision' },
    { pair_id: 'M04', site: 'stripe',   source_img: 'eval/grader/.shots/calib-stripe-source.png',   clone_img: 'eval/grader/.shots/calib-stripe-clone.png' },
  ],
};

// mode selection: --midrange = the 4 M-pairs only; --all = union of 18 P-pairs + 4 M-pairs (22 total); default = 18 P.
const MIDRANGE = has('midrange');
const ALL = has('all');
const HUMAN_FILE = MIDRANGE && !ALL ? 'midrange-human-results.json' : 'human-results.json';
let humanById;
if (ALL) {
  const hp = JSON.parse(fs.readFileSync(path.join(CAL, 'human-results.json'), 'utf8'));
  const hm = JSON.parse(fs.readFileSync(path.join(CAL, 'midrange-human-results.json'), 'utf8'));
  humanById = Object.fromEntries([...hp.results, ...hm.results].map(r => [r.pair_id, r]));
} else {
  const HUMAN = JSON.parse(fs.readFileSync(path.join(CAL, HUMAN_FILE), 'utf8'));
  humanById = Object.fromEntries(HUMAN.results.map(r => [r.pair_id, r]));
}

// pair set: P-pairs from GRADER_KEY, M-pairs from MIDRANGE_KEY, per mode; --pairs scopes within.
const ALL_PAIRS = ALL ? [...KEY.pairs, ...MIDRANGE_KEY.pairs] : (MIDRANGE ? MIDRANGE_KEY.pairs : KEY.pairs);
const PAIRS = ALL_PAIRS.filter(p => !ONLY || ONLY.split(',').includes(p.pair_id));

// human fatal-class checkboxes -> our fatalClass buckets. The two new midrange strings ('missing imagery or panels' ->
// imagery, 'overlapping/colliding sections' -> overlap) extend the P-pair map; both human files key into this table.
const HUMAN_FATAL_MAP = {
  'wrong/missing logo': 'logo', 'invisible heading': 'heading', 'blank/broken hero': 'hero', 'unstyled CTA': 'CTA',
  // midrange wording (the M-pairs use slightly different checkbox labels — map them to the same buckets)
  'wrong/missing logo ': 'logo', 'invisible/missing heading': 'heading', 'unstyled CTA (no button chrome)': 'CTA',
  'missing imagery or panels': 'imagery', 'overlapping/colliding sections': 'overlap',
};
function humanFatals(row) { return new Set((row.defects || []).map(d => HUMAN_FATAL_MAP[d]).filter(Boolean)); }

// Spearman rho with average-rank tie handling.
function spearman(a, b) {
  const rank = (xs) => {
    const idx = xs.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(xs.length);
    let i = 0;
    while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
    return r;
  };
  const ra = rank(a), rb = rank(b), n = a.length;
  const m = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const ma = m(ra), mb = m(rb);
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { const da = ra[i] - ma, db = rb[i] - mb; cov += da * db; va += da * da; vb += db * db; }
  return (va && vb) ? +(cov / Math.sqrt(va * vb)).toFixed(3) : 0;
}

async function pool(items, n, fn) { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.error(`[cal] judging ${PAIRS.length} pairs, vision=${VISION}, jobs=${JOBS}`);
  const rows = await pool(PAIRS, JOBS, async (p) => {
    const src = path.join(REPO, p.source_img), cln = path.join(REPO, p.clone_img);
    const r = await judgePair({ sourcePng: src, clonePng: cln, outDir: path.join(OUT, p.pair_id), vision: VISION, blind: VISION, jobs: 3 });
    const h = humanById[p.pair_id];
    const hf = humanFatals(h);
    const jf = new Set(r.fatalClasses);
    console.error(`[cal] ${p.pair_id} (${p.site}): judge=${r.score} human=${h.overall} | judgeFatals={${[...jf].join(',')}} humanFatals={${[...hf].join(',')}}`);
    return {
      pair_id: p.pair_id, site: p.site, oldGrader: p.grader_overall_0_100,
      judge: r.score, human: h.overall,
      judgeFatals: [...jf], humanFatals: [...hf],
      regions: r.regions.map(rg => ({ name: rg.name, score: rg.score, fatalClass: rg.fatalClass })),
      topDefects: r.defects.slice(0, 6).map(d => `[${d.severity}|${d.defect_class}|${d.source}] ${d.element || d.evidence}`),
    };
  });

  // (a) MAE
  const mae = +(rows.reduce((s, r) => s + Math.abs(r.judge - r.human), 0) / rows.length).toFixed(2);
  // (b) Spearman + lowAgreement (humans rated all <=6; what frac does the judge put <=30?)
  const rho = spearman(rows.map(r => r.judge), rows.map(r => r.human));
  const lowAgreement = +(rows.filter(r => r.judge <= 30).length / rows.length).toFixed(3);
  // for reference: how the OLD grader correlated (only on pairs where it has a number)
  const withOld = rows.filter(r => typeof r.oldGrader === 'number');
  const oldRho = withOld.length >= 4 ? spearman(withOld.map(r => r.oldGrader), withOld.map(r => r.human)) : null;
  const oldMae = withOld.length ? +(withOld.reduce((s, r) => s + Math.abs(r.oldGrader - r.human), 0) / withOld.length).toFixed(2) : null;
  // (c) fatal-class recall (only over pairs+classes the human actually checked). Midrange/all modes add the two new
  // disqualifying classes (imagery, overlap) so their recall is reported too.
  const RECALL_CLASSES = (MIDRANGE || ALL) ? ['logo', 'heading', 'hero', 'CTA', 'imagery', 'overlap'] : ['logo', 'heading', 'hero', 'CTA'];
  const perClass = {}; let tp = 0, need = 0;
  for (const cls of RECALL_CLASSES) {
    let hit = 0, total = 0;
    for (const r of rows) { if (r.humanFatals.includes(cls)) { total++; need++; if (r.judgeFatals.includes(cls)) { hit++; tp++; } } }
    perClass[cls] = { detected: hit, humanFlagged: total, recall: total ? +(hit / total).toFixed(3) : null };
  }
  const fatalRecall = need ? +(tp / need).toFixed(3) : null;

  const set = ALL ? 'all-22(P+M)' : (MIDRANGE ? 'midrange-4(M)' : 'broken-18(P)');
  const summary = {
    set, humanFile: ALL ? 'human+midrange' : HUMAN_FILE,
    mode: VISION ? 'full(vision+det)' : 'deterministic-only', pairs: rows.length,
    gates: { MAE: mae, spearman: rho, lowAgreement, fatalRecall, fatalRecallPerClass: perClass },
    reference: { oldGraderSpearman: oldRho, oldGraderMAE: oldMae, note: 'old composite was anti/over-correlated; region-judge target = positive rank-corr + high fatal recall + low MAE (human overalls are 0-6)' },
    rows,
  };
  fs.writeFileSync(path.join(OUT, 'calibration.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ set: summary.set, mode: summary.mode, pairs: rows.length, gates: summary.gates, reference: summary.reference, perPair: rows.map(r => ({ id: r.pair_id, judge: r.judge, human: r.human, old: r.oldGrader, jf: r.judgeFatals, hf: r.humanFatals })) }, null, 2));
})().catch(e => { console.error('CALIBRATION FAILED:', e && e.stack || e); process.exit(1); });
