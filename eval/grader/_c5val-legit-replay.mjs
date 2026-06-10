#!/usr/bin/env node
/**
 * @purpose C round 5 INDEPENDENT VALIDATION — false-rejection probe. Replays the SEVEN KEPT split-bg candidates
 * from the C-r4 restore run (/tmp/refine-sections/3146: b2-cand1/2, b8-cand1/2/3, b10-cand1/2) against the saved
 * pre-apply prestate (/tmp/refine-prestate-3146.json) through the C-round-5 HARDENED keep gates (bandLocalText
 * feed). Known-good keeps MUST still pass; specifically the NEW deterministic gates (textCoverage, editability)
 * must not fire on them (a visual-gate flip within band render noise is pre-existing, reported separately).
 * Replay chain mirrors the original working-tree accumulation: b2 base=prestate; b8 base=b2-cand2;
 * b10 base=b8-cand3. PROPOSAL-equivalent: graded page GET-only; renders on a tag-swept scratch.
 * Report → /tmp/c5val-legit-report.json
 */
import fs from 'fs';
import { execSync } from 'child_process';
import { chromium } from 'playwright';
import { W, loadSrcCache } from './grade-sections.mjs';
import { createScratch, deletePage, sweep } from './scratch-harness.mjs';
import { prepare, sectionVisual, liveHash } from './sectionvisual.mjs';
import { keepGate } from './refine-sections.mjs';

const SOURCE = 'https://tailwindcss.com', PAGE = 3146;
const DIR = '/tmp/refine-sections/3146';
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const PLAN = [
  { band: { idx: 2, y0: 617, y1: 1189 }, base: null /* prestate */, cands: ['b2-cand1.json', 'b2-cand2.json'], expected: [0.223, 0.131] },
  { band: { idx: 8, y0: 3559, y1: 7431 }, base: 'b2-cand2.json', cands: ['b8-cand1.json', 'b8-cand2.json', 'b8-cand3.json'], expected: [0.017, 0.016, 0.02] },
  { band: { idx: 10, y0: 7691, y1: 8429 }, base: 'b8-cand3.json', cands: ['b10-cand1.json', 'b10-cand2.json'], expected: [0.387, 0.013] },
];

(async () => {
  try { execSync("pkill -9 -f 'chrome-headless-shell' 2>/dev/null || true", { stdio: 'ignore' }); } catch {}
  try { await sweep({ maxAgeMin: 60 }); } catch {}
  if (!loadSrcCache(SOURCE)) { console.error('no frozen src cache'); process.exit(3); }
  const hash0 = await liveHash(PAGE);
  const prestate = load('/tmp/refine-prestate-3146.json');
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const report = { source: SOURCE, page: PAGE, hash0, bands: [] };
  let scratch = null;
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const prep = await prepare({ source: SOURCE, pageId: PAGE, ctx });
    const made = await createScratch({ title: `c5val-legit ${PAGE}`, elements: [], pageSettings: prep.pageSettings, template: 'elementor_canvas', srcId: PAGE });
    scratch = { pageId: made.pageId, url: made.url };
    for (const step of PLAN) {
      const baseTree = step.base ? load(`${DIR}/${step.base}`) : prestate.elements;
      const tag = `b${step.band.idx}`;
      let baseline = await sectionVisual({ source: SOURCE, pageId: PAGE, band: step.band, prep: { ...prep, tree: baseTree, treeMode: 'replay-base' }, scratch, ctx, outDir: `/tmp/c5val-legit/${tag}-base` });
      const rec = { band: step.band, baseline: { visual: baseline.visual, matchedTexts: baseline.matchedTexts, srcTextCount: baseline.srcTextCount, editability: baseline.editability }, cands: [] };
      console.log(`${tag} baseline: visual ${baseline.visual} matched ${baseline.matchedTexts}/${baseline.srcTextCount} edit ${baseline.editability}`);
      for (let i = 0; i < step.cands.length; i++) {
        const candTree = load(`${DIR}/${step.cands[i]}`);
        const cr = await sectionVisual({ source: SOURCE, pageId: PAGE, band: step.band, prep: { ...prep, tree: candTree, treeMode: 'replay-cand' }, scratch, ctx, outDir: `/tmp/c5val-legit/${tag}-c${i + 1}` });
        const g = keepGate(baseline, cr);
        const hardenedOk = g.gates.textCoverage && g.gates.editability && g.gates.noNewVoid && g.gates.noNewRastered && g.gates.gradable;
        rec.cands.push({ file: step.cands[i], keep: g.keep, hardenedGatesPass: hardenedOk, failedGates: g.failed, deltas: g.deltas, expectedVisualDelta: step.expected[i], candidate: { visual: cr.visual, matchedTexts: cr.matchedTexts, editability: cr.editability } });
        console.log(`${tag} ${step.cands[i]}: keep=${g.keep} hardened=${hardenedOk} Δvis ${g.deltas.visual} (C-r4: ${step.expected[i]}) Δmatched ${g.deltas.matchedTexts} Δedit ${g.deltas.editability}${g.failed.length ? ' failed=[' + g.failed.join(',') + ']' : ''}`);
        if (g.keep || hardenedOk) baseline = cr; // accumulate like the loop (visual-noise flips don't break the chain)
      }
      report.bands.push(rec);
    }
    const hash1 = await liveHash(PAGE);
    report.hash1 = hash1; report.gradedUntouched = hash0 === hash1;
  } catch (e) {
    console.error(String(e && e.stack || e)); report.infraError = String(e);
    fs.writeFileSync('/tmp/c5val-legit-report.json', JSON.stringify(report, null, 2)); process.exit(3);
  } finally {
    if (scratch) { try { await deletePage(scratch.pageId, PAGE); } catch {} }
    await browser.close();
  }
  const flat = report.bands.flatMap((b) => b.cands);
  const allHardened = flat.length === 7 && flat.every((c) => c.hardenedGatesPass);
  const allKeep = flat.every((c) => c.keep);
  report.allHardenedPass = allHardened; report.allKeep = allKeep;
  fs.writeFileSync('/tmp/c5val-legit-report.json', JSON.stringify(report, null, 2));
  console.log(`\nLEGIT REPLAY: hardened-gates ${allHardened ? 'ALL 7 PASS (zero false rejections from new gates)' : 'FALSE REJECTION PRESENT'}; full keep ${allKeep ? 'ALL 7' : 'visual-noise flips: ' + flat.filter((c) => !c.keep).map((c) => c.file).join(',')}; graded untouched ${report.gradedUntouched}`);
  process.exit(allHardened && report.gradedUntouched ? 0 : 4);
})();
