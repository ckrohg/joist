#!/usr/bin/env node
/** @purpose _correspondence-align-selftest.mjs — HERMETIC gate for LEVER B (content-aware section alignment). No
 * network. Constructs a clone that is CONTENT-FAITHFUL to the source but whose content is compressed into the top of a
 * tall page (a trailing void) — the exact shape a real projection takes (resend: content in the top ~half, void below).
 * A position-only aligner mispairs every section (each normalized-y is shifted) and false-deflates the score to ~0;
 * content-aware alignment pairs by text overlap and recovers it. Proves the fix removes the false-deflation AND that the
 * reversible flag restores the old (broken-on-this-case) behavior. Exit 1 on any fail. */
import { gradeCorrespondence } from './correspondence-reward.mjs';

let fails = 0; const ok = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); if (!c) fails++; };

// distinctive per-section text so token-overlap can pair sections unambiguously. dark-on-white (visible).
const leaf = (text, x, y, w = 600, h = 80) => ({ text, kind: 'text', box: { x, y, w, h }, paint: { value: 'rgb(20,20,20)' }, typo: { size: 40, weight: 600 } });
const SECTIONS = [
  ['Alpha onboarding headline', 'Alpha onboarding subtext detail'],
  ['Beta integration weekend', 'Beta integration subtext detail'],
  ['Gamma developer experience', 'Gamma developer subtext detail'],
  ['Delta contacts control', 'Delta contacts subtext detail'],
  ['Epsilon deliverability humans', 'Epsilon deliverability subtext detail'],
  ['Zeta footer address links', 'Zeta footer subtext detail'],
];
// build a tree placing each section's leaves at the given y centers (big gaps so segmentSections splits them).
const treeAt = (centers, pageH) => ({ pageH, vw: 1440, root: { bgSampled: 'rgb(255,255,255)', children: SECTIONS.flatMap((sec, i) => sec.map((t, j) => leaf(t, 168, centers[i] + j * 90))) } });

const PAGE = 12000;
const src = treeAt([500, 2500, 4500, 6500, 8500, 10500], PAGE);              // evenly distributed over the page
const cloneFaithfulVoid = treeAt([200, 700, 1200, 1700, 2200, 2700], PAGE);  // SAME content, compressed to top + void below
const cloneFaithfulFull = treeAt([520, 2520, 4520, 6520, 8520, 10520], PAGE); // SAME content, same distribution (control)

console.log('── LEVER B: content-aware alignment vs a content-faithful-but-void clone ──');
const contentVoid = gradeCorrespondence(src, cloneFaithfulVoid, { textOnly: true });
const contentFull = gradeCorrespondence(src, cloneFaithfulFull, { textOnly: true });
process.env.CORR_NO_CONTENT_ALIGN = '1';
const posVoid = gradeCorrespondence(src, cloneFaithfulVoid, { textOnly: true });
delete process.env.CORR_NO_CONTENT_ALIGN;

ok('content-align scores the faithful-but-void clone HIGH (≥80)', contentVoid.score >= 80, `score=${contentVoid.score} matched=${contentVoid.matchedSections}/${contentVoid.nSections}`);
ok('position-align FALSE-DEFLATES the same clone (≤40)', posVoid.score <= 40, `pos-score=${posVoid.score}`);
ok('content-align beats position-align by a wide margin (≥30)', contentVoid.score - posVoid.score >= 30, `Δ=${(contentVoid.score - posVoid.score).toFixed(1)}`);
ok('content-align matches all 6 sections', contentVoid.matchedSections === 6, `matched=${contentVoid.matchedSections}`);
ok('an evenly-distributed faithful clone scores ~the same (no penalty for distribution)', Math.abs(contentVoid.score - contentFull.score) <= 8, `void=${contentVoid.score} full=${contentFull.score}`);

// guard: a clone MISSING half the sections must land near HALF (content-align must not over-credit missing content).
const compressed = treeAt([200, 700, 1200, 1700, 2200, 2700], PAGE);
const cloneMissingHalf = { pageH: PAGE, vw: 1440, root: { bgSampled: 'rgb(255,255,255)', children: compressed.root.children.filter((l) => /Alpha|Beta|Gamma/.test(l.text)) } };
const missing = gradeCorrespondence(src, cloneMissingHalf, { textOnly: true });
ok('a clone missing half the sections lands ~half (no over-credit, 3/6 matched)', missing.score >= 40 && missing.score <= 60 && missing.matchedSections === 3, `missing=${missing.score} matched=${missing.matchedSections}`);

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAIL'} — correspondence-align selftest`);
process.exit(fails === 0 ? 0 : 1);
