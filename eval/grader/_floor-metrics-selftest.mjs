#!/usr/bin/env node
/**
 * @purpose Selftest for floor-metrics.mjs (ALWAYS-WORKS FLOOR). Pure, no IO/WP — runs anywhere in <1s.
 * Covers: corpus-min (incl. worst-site + responsive-null skip), site-level veto-rate, per-cap breakdown
 * across all three cap sources (human-salient vetoes / frozen-coverage / responsive midwidth), the
 * vetoes-disabled => null-not-zero honesty guard, and the empty-corpus edge. Run: node _floor-metrics-selftest.mjs
 */
import { computeFloor, formatFloor, capCategories } from './floor-metrics.mjs';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`ok   ${msg}`); }
  else { fail++; console.error(`FAIL ${msg}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

// ---- main fixture corpus (4 graded sites) ----
const clean  = { name: 'clean',  composite: 0.80, visual: 0.85, editability: 0.70, responsive: 0.75,
                 honesty: { vetoes: { fired: [], all: [], ceiling: 0.45 }, frozenCoverageCap: { capped: false } }, midwidth: { caps: [] } };
const logo   = { name: 'logo',   composite: 0.45, visual: 0.60, editability: 0.50, responsive: 0.60,
                 honesty: { vetoes: { fired: [{ veto: 'wrong-logo', severity: 0.8 }], all: [], ceiling: 0.45 }, frozenCoverageCap: { capped: false } }, midwidth: { caps: [] } };
const frozen = { name: 'frozen', composite: 0.35, visual: 0.50, editability: 0.40, responsive: 0.55,
                 honesty: { vetoes: { fired: [], all: [], ceiling: 0.45 }, frozenCoverageCap: { capped: 0.45, preserveHeightFrac: 0.7 } },
                 midwidth: { caps: ['cliff(excess 1.6@1024)→cap0.35'] } };           // frozen-coverage AND a responsive cliff
const rnull  = { name: 'rnull',  composite: 0.60, visual: 0.65, editability: 0.55, responsive: null,
                 honesty: { vetoes: { fired: [], all: [], ceiling: 0.45 }, frozenCoverageCap: { capped: false } } }; // no midwidth key (3-term fallback)

const f = computeFloor([clean, logo, frozen, rnull]);

eq(f.graded, 4, 'graded = 4');
eq(f.min.composite, 0.35, 'min composite = 0.35 (frozen)');
eq(f.min.worst, 'frozen', 'worst site = frozen');
eq(f.min.visual, 0.5, 'min visual = 0.5');
eq(f.min.editability, 0.4, 'min editability = 0.4');
eq(f.min.responsive, 0.55, 'min responsive = 0.55 (skips the null-responsive site)');
eq(f.vetoesMeasured, true, 'vetoes measured = true');
eq(f.vetoRate, 0.5, 'veto-rate = 0.5 (2 of 4 sites hard-capped)');
eq([...f.vetoedSites].sort(), ['frozen', 'logo'], 'vetoed sites = {frozen, logo}');
eq(f.roundtripSurvival, null, 'roundtripSurvival = null (pending, never faked)');

// per-cap breakdown spans all three cap sources, counted per-occurrence (frozen contributes 2 cats)
const bd = Object.fromEntries(f.vetoBreakdown.map((v) => [v.veto, v.sites]));
eq(bd['wrong-logo'], 1, 'breakdown wrong-logo ×1');
eq(bd['frozen-coverage'], 1, 'breakdown frozen-coverage ×1');
eq(bd['cliff'], 1, 'breakdown cliff ×1');
eq(f.vetoBreakdown.length, 3, 'breakdown has 3 distinct caps');

// capCategories directly
eq([...capCategories(frozen)].sort(), ['cliff', 'frozen-coverage'], 'capCategories(frozen) = {cliff, frozen-coverage}');
eq(capCategories(clean), [], 'capCategories(clean) = [] (always-works)');

// formatFloor renders the headline veto line
eq(formatFloor(f).some((l) => l.includes('VETO-RATE 0.5')), true, 'formatFloor prints VETO-RATE 0.5');

// ---- honesty guard: vetoes NOT measured => null, not 0 ----
const g = computeFloor([{ name: 'legacy', composite: 0.7, visual: 0.7, editability: 0.6, responsive: 0.6 }]);
eq(g.vetoesMeasured, false, 'legacy report (no honesty) => vetoesMeasured false');
eq(g.vetoRate, null, 'veto-rate = null when detectors not run (NOT 0)');
eq(g.min.composite, 0.7, 'legacy min composite = 0.7');
eq(formatFloor(g).some((l) => l.includes('n/a')), true, 'formatFloor shows n/a when not measured');

// ---- empty corpus edge ----
const h = computeFloor([]);
eq(h.graded, 0, 'empty corpus graded = 0');
eq(h.min.composite, null, 'empty corpus min composite = null');
eq(h.vetoRate, null, 'empty corpus veto-rate = null');
eq(formatFloor(h), [], 'formatFloor([]) = [] (no spurious output)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
