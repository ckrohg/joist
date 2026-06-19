#!/usr/bin/env node
/**
 * @purpose _dom-sections-selftest.mjs — hermetic CAUSAL gate for the DOM-driven section segmentation + dark-ink-loss
 * heading trigger (region-judge.mjs segmentBySections/sanitizeBounds + corroborate; section-bounds.mjs sectionHealth).
 * Deterministic, no network. Three parts:
 *   (A) sanitizeBounds units  — accept healthy seam maps, reject too-few/oversized-band maps, frac↔pixel handling.
 *   (B) sectionHealth units    — supabase-like OK, framer-like (≤3 bands) / giant-band REJECT (→ proportional fallback).
 *   (C) CAUSAL discriminator   — with the guard ON + the supabase sidecar, the section-aligned hero region must:
 *         L0 (faithful)  → NO heading veto  (the over-floor false-positive is suppressed), AND
 *         L2 (invis-heading) → heading FATAL veto  (the isolated invisible heading is CAUGHT).
 *       This is the journal's decisive "isolated-invisible" test. It would FAIL if the band lumps multiple sections
 *       (the bug this fix removes) or if the dark-ink trigger regresses. Run via a child with the guard flag so the
 *       module-level const reads it regardless of how this selftest is invoked.
 *   (D) DEFAULT-OFF identity   — guard OFF ⇒ segmentRegions ignores the sidecar (byte-identical proportional banding).
 * Exit 1 on any failure. Renders NOTHING.
 */
import fs from 'fs';
import path from 'path';
import url from 'url';
import { execFileSync } from 'child_process';
import { segmentRegions, sanitizeBounds, corroborate, loadPng, loadSectionSidecar } from './region-judge.mjs';
import { sectionHealth } from './section-bounds.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const P = (p) => path.join(REPO, p);
const SELF = url.fileURLToPath(import.meta.url);
let fails = 0;
const ok = (name, cond, detail = '') => { console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); if (!cond) fails++; };

// ── (C) child mode: run the causal corroborate check with the guard ON, emit JSON ───────────────────────────────
if (process.argv.includes('--causal-child')) {
  const srcPath = P('eval/grader/calibration/v2-shots/supabase-src-d.png');
  const src = loadPng(srcPath), fracs = loadSectionSidecar(srcPath);
  const out = {};
  for (const lbl of ['L0-pristine', 'L2-invis-heading']) {
    const cln = loadPng(P(`eval/grader/calibration/ladders/supabase-${lbl}.png`));
    const regions = segmentRegions(src, cln, 8, fracs);
    const hero = regions.find((r) => r.role === 'hero');
    const det = hero ? corroborate(hero, src, cln) : { vetoes: [] };
    out[lbl] = { hasHero: !!hero, heroName: hero && hero.name, headingFatal: det.vetoes.some((v) => v.fatalClass === 'heading' && v.severity === 'fatal') };
  }
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

console.log('── (A) sanitizeBounds units ──');
ok('healthy frac map (5 bands) → seams pixel-scaled & page-spanning', (() => {
  const s = sanitizeBounds([0, 0.1, 0.3, 0.55, 0.8, 1], 1000);
  return Array.isArray(s) && s[0] === 0 && s[s.length - 1] === 1000 && s.length === 6;
})());
ok('too few bands (3 seams) → null', sanitizeBounds([0, 0.5, 1], 1000) === null);
ok('one band > 55% of page → null', sanitizeBounds([0, 0.05, 0.1, 0.15, 0.95], 1000) === null);
ok('pixel-space input (max>1.5) handled like pixels', (() => {
  const s = sanitizeBounds([0, 100, 300, 550, 800, 1000], 1000);
  return Array.isArray(s) && s.length === 6 && s[2] === 300;
})());
ok('auto-prepends 0 and appends sH', (() => { const s = sanitizeBounds([0.1, 0.3, 0.5, 0.7, 0.9], 1000); return s && s[0] === 0 && s[s.length - 1] === 1000; })());

console.log('── (B) sectionHealth units ──');
ok('supabase-like 12-band map → healthy', sectionHealth([0, 0.079, 0.104, 0.228, 0.265, 0.37, 0.408, 0.502, 0.648, 0.682, 0.757, 0.812, 1]).healthy === true);
ok('framer-like 3-band map → REJECT (too few)', sectionHealth([0, 0.866, 0.947, 1]).healthy === false);
ok('giant-band map → REJECT (>50% band)', sectionHealth([0, 0.05, 0.1, 0.15, 0.2, 0.95]).healthy === false);

// (C)+(D) depend on the LOCAL calibration fixtures (calibration/v2-shots is gitignored — same as the ladder/gametest
// fixtures). On a fresh checkout, regenerate first:  node section-bounds.mjs --url https://supabase.com --src-png
// calibration/v2-shots/supabase-src-d.png   (and _calib-ladder-gen.mjs for the ladder PNGs). Skip-with-note if absent.
const srcPath = P('eval/grader/calibration/v2-shots/supabase-src-d.png');
const l0Path = P('eval/grader/calibration/ladders/supabase-L0-pristine.png');
const l2Path = P('eval/grader/calibration/ladders/supabase-L2-invis-heading.png');
const fixturesPresent = fs.existsSync(srcPath) && fs.existsSync(l0Path) && fs.existsSync(l2Path) && loadSectionSidecar(srcPath);
if (!fixturesPresent) {
  console.log('── (C)+(D) SKIPPED — local fixtures/sidecar absent (regenerate: node section-bounds.mjs --url https://supabase.com --src-png calibration/v2-shots/supabase-src-d.png) ──');
} else {
  console.log('── (D) DEFAULT-OFF identity (guard off ⇒ proportional, sidecar ignored) ──');
  {
    const src = loadPng(srcPath), cln = loadPng(l0Path);
    const fracs = loadSectionSidecar(srcPath);
    ok('supabase sidecar present', Array.isArray(fracs) && fracs.length >= 5);
    const withFracs = segmentRegions(src, cln, 8, fracs);   // guard OFF here (this process has no flag)
    const proportional = segmentRegions(src, cln, 8, null);
    ok('guard-off: passing fracs == proportional (byte-identical default)', JSON.stringify(withFracs) === JSON.stringify(proportional),
      `domRegions=${withFracs.map((r) => r.name).slice(0, 3).join(',')}`);
    ok('guard-off proportional has a "hero" proportional band (not section-N)', proportional.some((r) => r.role === 'hero'));
  }

  console.log('── (C) CAUSAL discriminator (guard ON, supabase sidecar) ──');
  {
    let res;
    try { res = JSON.parse(execFileSync('node', [SELF, '--causal-child'], { env: { ...process.env, RJ_HEADING_DARKINK_GUARD: '1', RJ_DOM_SECTIONS: '1' }, encoding: 'utf8' })); }
    catch (e) { res = null; console.log('  (causal child failed: ' + (e.message || e) + ')'); }
    ok('hero region resolved on both rungs', res && res['L0-pristine'].hasHero && res['L2-invis-heading'].hasHero, res ? `heroName=${res['L0-pristine'].heroName}` : '');
    ok('L0 (faithful) → NO heading fatal (over-floor false-positive SUPPRESSED)', res && res['L0-pristine'].headingFatal === false);
    ok('L2 (invis-heading) → heading FATAL (isolated invisible heading CAUGHT)', res && res['L2-invis-heading'].headingFatal === true);
  }
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAIL'} — DOM-sections selftest`);
process.exit(fails === 0 ? 0 : 1);
