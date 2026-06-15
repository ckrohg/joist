#!/usr/bin/env node
/**
 * @purpose OFFLINE regression gate for the STRUCTURAL COMPARISON ENGINE (compare-capture.mjs).
 * Loads the CACHED captures (/tmp/compare-310.json — both source + clone ElementRecords, no network)
 * and re-runs the PURE correspondence + classify + matched-pair-diff logic, asserting that the engine
 * catches the 8 human-found defects on the overreacted-v2 clone (page 310). Also validates the
 * O(1) stamped-backref path on a tiny synthetic stamped fixture (the path the engine takes once the
 * --joist-src stamp is emitted by build-absolute). NO network, NO host. Exit 0 = all gates pass.
 *
 * Run:  node _compare-capture-selftest.mjs   (uses /tmp/compare-310.json; produce it once via:
 *        source /tmp/joist-auth-1.env && node compare-capture.mjs --source <overreacted> --clone-page 310 ...)
 */
import fs from 'fs';
import { assignHungarian, assignStamped, classifyUnmatched, diffMatchedPairs } from './compare-capture.mjs';

const CACHE = process.argv[2] || '/tmp/compare-310.json';
const cases = [];
const ok = (name, pass, detail = '') => cases.push({ name, pass: !!pass, detail });

if (!fs.existsSync(CACHE)) {
  console.error(`MISSING cached capture ${CACHE} — run compare-capture.mjs once to produce it.`);
  process.exit(2);
}
const blob = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
const src = blob.sourceCapture.records;
const clone = blob.cloneCapture.records;
const joinW = blob.report.joinWidth || 1440;

// ── re-run the join deterministically from the cached records ──
const join = assignHungarian(src, clone, joinW);
const buckets = classifyUnmatched(src, join.unmatchedSource);
const matchedDefects = diffMatchedPairs(join.matched, src, clone);
const matchRate = src.length ? join.matched.length / src.length : 0;

// determinism: a second identical run must produce byte-identical unmatched + bucket counts
const join2 = assignHungarian(src, clone, joinW);
ok('DETERMINISTIC: identical inputs → identical matchRate + unmatched set', join.matched.length === join2.matched.length &&
  JSON.stringify(join.unmatchedSource) === JSON.stringify(join2.unmatchedSource),
  `m1=${join.matched.length} m2=${join2.matched.length}`);

// ── the 8 human-found defects (defect 2 dark-mode SET ASIDE per spec) ──
// the clone has ZERO <hr> → ALL source <hr> must surface as unmatched presence-defects (no spurious div-match)
const srcHrCount = src.filter((r) => r.tag === 'hr').length;
ok('DEFECT 6 — ALL <hr> dividers missing (PRESENCE, no spurious match)', buckets.hr_dividers.length === srcHrCount && srcHrCount >= 10,
  `${buckets.hr_dividers.length}/${srcHrCount} source <hr> unmatched (clone has ${clone.filter((r) => r.tag === 'hr').length})`);
ok('DEFECT 5 — inline-code chips missing (PRESENCE)', buckets.inline_code_chips.length >= 50, `${buckets.inline_code_chips.length} unmatched inline <code> chips`);
ok('DEFECT 3 — emoji (🤔) bullets missing (PRESENT-BUT-WRONG glyph lost)', matchedDefects.emoji_glyph_lost.length >= 5, `${matchedDefects.emoji_glyph_lost.length} matched <li> lost their emoji glyph`);
ok('DEFECT 4 — blockquote left-bar missing (PRESENT-BUT-WRONG)', matchedDefects.blockquote_bar_lost.length >= 1, `${matchedDefects.blockquote_bar_lost.length} blockquote(s) lost left-border-bar`);
ok('DEFECT 7 — code-block dark-bg / syntax colors lost (PRESENT-BUT-WRONG)', matchedDefects.code_block_darkbg_lost.length >= 10, `${matchedDefects.code_block_darkbg_lost.length} <pre> lost dark bg`);

// defect 1 (responsive) + 8 (sticky) come off the report's deterministic structural signals
const rep = blob.report;
ok('DEFECT 1 — clone not responsive to width', rep.responsive && rep.responsive.cloneOverflowsViewport === true,
  `cloneOverflows=${rep.responsive && rep.responsive.cloneOverflowsViewport}, srcReflowed=${rep.responsive && rep.responsive.srcReflowingBoxes}`);
ok('DEFECT 8 — nav wrongly sticky', rep.sticky && rep.sticky.cloneWronglySticky === true,
  `clonePinned=${rep.sticky && rep.sticky.cloneStickyTopBoxes}, srcPinned=${rep.sticky && rep.sticky.sourceStickyTopBoxes}`);

// ── sanity: matchRate is meaningful (granularity comparable after <pre> atomicity) ──
ok('SANITY — matchRate in a meaningful band (0.4–0.95)', matchRate >= 0.4 && matchRate <= 0.95, `matchRate=${matchRate.toFixed(3)}`);
ok('SANITY — fallback method engaged (clone carries no stamp)', join.method === 'hungarian-greedy' && !clone.some((r) => r.stamp), `method=${join.method}`);

// ── ANTI-FALSE-POSITIVE: a clone that is BYTE-IDENTICAL to the source must have ZERO defects ──
// (re-join the source against ITSELF; every row matches, no unmatched, no present-but-wrong.)
{
  const selfJoin = assignHungarian(src, src, joinW);
  const selfBuckets = classifyUnmatched(src, selfJoin.unmatchedSource);
  const selfDefects = diffMatchedPairs(selfJoin.matched, src, src);
  const totalUnmatched = Object.values(selfBuckets).reduce((a, v) => a + v.length, 0);
  const totalMatchedDefects = Object.values(selfDefects).reduce((a, v) => a + v.length, 0);
  ok('NO-FALSE-POSITIVE — source vs ITSELF yields ~zero defects', selfJoin.unmatchedSource.length === 0 && totalMatchedDefects === 0,
    `selfUnmatched=${selfJoin.unmatchedSource.length} selfBuckets=${totalUnmatched} selfMatchedDefects=${totalMatchedDefects} selfMatchRate=${(selfJoin.matched.length / src.length).toFixed(3)}`);
}

// ── STAMPED-BACKREF path: the O(1) join the engine takes once build-absolute emits --joist-src ──
{
  const srcFix = [
    { ref: 'a|1|h1', srcPath: 'body>main>p|1|h1', stamp: null, tag: 'p', text: 'hello world', style: {}, pseudo: {}, asset: {}, box: { 1440: { x: 0, y: 0, w: 100, h: 20 } } },
    { ref: 'a|2|h2', srcPath: 'body>main>hr|1|h2', stamp: null, tag: 'hr', text: '', style: { border: { width: {} } }, pseudo: {}, asset: { isImage: false }, box: { 1440: { x: 0, y: 30, w: 100, h: 1 } } },
  ];
  const cloneFix = [
    { ref: 'w-001', srcPath: 'x', stamp: 'body>main>p|1|h1', tag: 'p', text: 'hello world', style: {}, pseudo: {}, asset: {}, box: { 1440: { x: 0, y: 0, w: 100, h: 20 } } },
    { ref: 'w-synthetic-wrapper', srcPath: 'x', stamp: null, tag: 'div', text: '', style: {}, pseudo: {}, asset: {}, box: { 1440: { x: 0, y: 0, w: 100, h: 60 } } },
  ];
  const sj = assignStamped(srcFix, cloneFix);
  ok('STAMPED — O(1) backref join matches the stamped <p>', sj.method === 'stamped-backref' && sj.relation['body>main>p|1|h1'] && sj.relation['body>main>p|1|h1'][0] === 'w-001');
  ok('STAMPED — the unstamped <hr> source is UNMATCHED (a presence-defect surfaces)', sj.unmatchedSource.includes('a|2|h2'), `unmatched=${JSON.stringify(sj.unmatchedSource)}`);
  ok('STAMPED — the unstamped clone div is flagged a SYNTHETIC Joist wrapper', sj.syntheticJoistWrappers.includes('w-synthetic-wrapper'));
}

// ── REPORT ──
const failed = cases.filter((c) => !c.pass);
for (const c of cases) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
console.log(`\nstructural-comparison selftest: ${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${cases.length} cases)`);
console.log(`matchRate ${matchRate.toFixed(3)} | unmatched ${join.unmatchedSource.length} | hr ${buckets.hr_dividers.length} | chips ${buckets.inline_code_chips.length} | emoji-lost ${matchedDefects.emoji_glyph_lost.length} | bq-bar-lost ${matchedDefects.blockquote_bar_lost.length} | code-darkbg-lost ${matchedDefects.code_block_darkbg_lost.length}`);
process.exit(failed.length === 0 ? 0 : 1);
