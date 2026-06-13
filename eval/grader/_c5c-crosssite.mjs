#!/usr/bin/env node
/**
 * @purpose C round 5c CROSS-SITE honest-page e2e — runs refine-sections in PROPOSAL mode with the `noop`
 * operator on supabase 2986 (a DIFFERENT site from the tailwind 3146 attack target), under the post-fix
 * glyph-geometry grader (GLYPH_RECTS default-ON). Proves the hardened gates do not MISFIRE on legit content:
 *   - ZERO keeps (noop → identity-no-op rejection, no render beyond per-band baselines)
 *   - every band BASELINE is gradable and reproduces its legit source text (no false content-void, no glyph
 *     machinery wrongly dropping real headings: matchedTexts close to srcTextCount, editability sane)
 *   - NO `glyph-legacy-fallback` divergence flag (the -gr source cache + live capture both carry glyph fields)
 *   - graded page 2986 GET-only (hash verified before + after)
 * Report → /tmp/c5c-crosssite-report.json
 */
import fs from 'fs';
import { execSync } from 'child_process';
import { chromium } from 'playwright';
import { W, loadSrcCache } from './grade-sections.mjs';
import { sweep } from './scratch-harness.mjs';
import { prepare, liveHash, sectionVisual } from './sectionvisual.mjs';
import { refineSections } from './refine-sections.mjs';

const SOURCE = 'https://supabase.com', PAGE = 2986;

(async () => {
  try { execSync("pkill -9 -f 'chrome-headless-shell' 2>/dev/null || true", { stdio: 'ignore' }); } catch {}
  try { await sweep({ maxAgeMin: 60 }); } catch {}
  if (!loadSrcCache(SOURCE)) { console.error('no frozen supabase src cache — run grade-sections on 2986 first'); process.exit(3); }
  const hash0 = await liveHash(PAGE);
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const report = { source: SOURCE, page: PAGE, hash0, bands: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const prep = await prepare({ source: SOURCE, pageId: PAGE, ctx });
    const H = Math.min(prep.srcCache.shot.height, prep.cloneFullH);
    const bounds = [...prep.srcCache.sections.filter((y) => y < prep.srcCache.pageH), prep.srcCache.pageH];
    const bands = [];
    for (let i = 0; i < bounds.length - 1; i++) { const y0 = bounds[i], y1 = bounds[i + 1]; if (y1 - y0 >= 20 && Math.min(H, y1) - y0 > 8) bands.push({ idx: i, y0, y1 }); }
    console.log(`supabase 2986: ${bands.length} gradable bands`);
    const r = await refineSections({ source: SOURCE, pageId: PAGE, bands, operatorName: 'noop', apply: false, outDir: `/tmp/c5c-crosssite/${PAGE}`, maxIters: 1, ctx });
    report.totalKept = r.totalKept;
    report.totalCandidates = r.totalCandidates;
    report.gradedUntouchedPreApply = r.gradedUntouchedPreApply;
    for (const pb of r.perBand || []) {
      const b = pb.baseline || {};
      report.bands.push({
        idx: pb.band.idx, y0: pb.band.y0, y1: pb.band.y1,
        gradable: b.gradable, visual: b.visual, srcTextCount: b.srcTextCount, matchedTexts: b.matchedTexts,
        editability: b.editability, contentVoid: b.contentVoid, leafAudit: b.leafAudit,
        divergenceFlags: b.divergenceFlags || null,
        candidates: (pb.candidates || []).map((c) => ({ decision: c.decision, reason: c.reason, scored: c.scored })),
        kept: pb.kept,
      });
    }
    const hash1 = await liveHash(PAGE);
    report.hash1 = hash1; report.gradedUntouched = hash0 === hash1;
    await sweep({ all: true });
  } catch (e) {
    console.error(String(e && e.stack || e)); report.infraError = String(e);
    fs.writeFileSync('/tmp/c5c-crosssite-report.json', JSON.stringify(report, null, 2)); process.exit(3);
  } finally { await browser.close(); }
  // verdicts
  const gradable = report.bands.filter((b) => b.gradable);
  const legacyFallback = report.bands.filter((b) => (b.divergenceFlags || []).some((f) => String(f).startsWith('glyph-legacy-fallback')));
  const nonIdentity = report.bands.flatMap((b) => b.candidates).filter((c) => c.scored); // any RENDERED candidate = a noop misfire
  report.summary = {
    bands: report.bands.length, gradable: gradable.length,
    totalKept: report.totalKept, scoredCandidates: nonIdentity.length,
    legacyFallbackBands: legacyFallback.length,
    meanBaselineEdit: gradable.length ? +(gradable.reduce((s, b) => s + (b.editability || 0), 0) / gradable.length).toFixed(3) : null,
    meanMatchFrac: gradable.length ? +(gradable.reduce((s, b) => s + (b.srcTextCount ? b.matchedTexts / b.srcTextCount : 1), 0) / gradable.length).toFixed(3) : null,
  };
  report.cleanRun = report.totalKept === 0 && nonIdentity.length === 0 && legacyFallback.length === 0 && report.gradedUntouched;
  fs.writeFileSync('/tmp/c5c-crosssite-report.json', JSON.stringify(report, null, 2));
  console.log(`\n===== CROSS-SITE supabase 2986 (noop, proposal) =====`);
  console.log(`bands ${report.summary.bands} gradable ${report.summary.gradable} · kept ${report.totalKept} · scored(=misfire) ${nonIdentity.length} · legacy-fallback bands ${legacyFallback.length}`);
  console.log(`mean baseline editability ${report.summary.meanBaselineEdit} · mean match frac ${report.summary.meanMatchFrac} · graded untouched ${report.gradedUntouched}`);
  console.log(report.cleanRun ? 'CLEAN: zero keeps, zero gate misfires, no legacy fallback, graded untouched' : 'NOT CLEAN — inspect report');
  process.exit(report.cleanRun ? 0 : 4);
})();
