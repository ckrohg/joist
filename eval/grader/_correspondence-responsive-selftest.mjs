#!/usr/bin/env node
/** @purpose _correspondence-responsive-selftest.mjs — HERMETIC gate for WS5's responsiveCorrespondence aggregation.
 * No network: synthetic per-width trees. Proves the per-breakpoint grade + desktop/mobileMin/gap math is correct and
 * that a clone which reflows at desktop but NOT at mobile (the @media-stripped emission gap) surfaces as a positive gap. */
import { responsiveCorrespondence } from './correspondence-responsive.mjs';

let fails = 0; const ok = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); if (!c) fails++; };

// one-section page of 3 text leaves. dark text on the default white page (visible — the visibility pre-filter drops
// zero-contrast leaves, so a white-on-white fixture would be (correctly) ignored).
const leaf = (text, y, over = {}) => ({ text, kind: 'text', box: { x: 168, y, w: 600, h: 120 }, paint: { value: 'rgb(20,20,20)' }, typo: { size: 48, weight: 700 }, ...over });
const goodTree = () => ({ root: { children: [leaf('Email for developers', 200), leaf('The best platform to reach humans instead of spam folders', 360, { typo: { size: 20, weight: 400 } }), leaf('Get started', 520, { box: { x: 168, y: 520, w: 150, h: 50 } })] } });
// mobile clone that did NOT reflow: headline text mangled + subhead dropped (simulates desktop-size overflow / stripped @media).
const brokenMobileTree = () => ({ root: { children: [leaf('Email developers', 200), leaf('Get started', 520, { box: { x: 168, y: 520, w: 150, h: 50 } })] } });

console.log('── responsiveCorrespondence aggregation ──');
const srcTrees = { 1440: goodTree(), 768: goodTree(), 390: goodTree() };
const cloneTrees = { 1440: goodTree(), 768: goodTree(), 390: brokenMobileTree() };
const r = responsiveCorrespondence({ srcTrees, cloneTrees, widths: [1440, 768, 390] });

ok('three breakpoints graded', r.perBp.length === 3 && r.perBp.every((b) => b.score != null), `scores=${r.perBp.map((b) => b.score).join(',')}`);
ok('desktop = the widest breakpoint score', r.desktop === r.perBp.find((b) => b.w === 1440).score, `desktop=${r.desktop}`);
ok('perfect desktop scores high (≥90)', r.desktop >= 90, `desktop=${r.desktop}`);
ok('broken-mobile breakpoint scores lower than desktop', r.perBp.find((b) => b.w === 390).score < r.desktop - 5, `390=${r.perBp.find((b) => b.w === 390).score} vs desktop=${r.desktop}`);
ok('mobileMin = the worst breakpoint', r.mobileMin === Math.min(...r.perBp.map((b) => b.score)), `mobileMin=${r.mobileMin}`);
ok('RESPONSIVE GAP is positive (desktop − mobileMin)', r.gap > 5 && Math.abs(r.gap - (r.desktop - r.mobileMin)) < 0.01, `gap=${r.gap}`);

// a clone that reflows perfectly at ALL widths → ~zero gap (no false responsive penalty).
const clean = responsiveCorrespondence({ srcTrees, cloneTrees: { 1440: goodTree(), 768: goodTree(), 390: goodTree() }, widths: [1440, 768, 390] });
ok('a fully-reflowing clone has ~zero gap (no false penalty)', clean.gap != null && clean.gap < 3, `gap=${clean.gap}`);

// missing a breakpoint tree → that bp is n/a, others still grade (robustness).
const partial = responsiveCorrespondence({ srcTrees, cloneTrees: { 1440: goodTree(), 768: goodTree() }, widths: [1440, 768, 390] });
ok('missing breakpoint → n/a, others unaffected', partial.perBp.find((b) => b.w === 390).score === null && partial.desktop >= 90, `390=${partial.perBp.find((b) => b.w === 390).score}`);

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAIL'} — correspondence-responsive selftest`);
process.exit(fails === 0 ? 0 : 1);
