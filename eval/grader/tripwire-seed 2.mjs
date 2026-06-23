#!/usr/bin/env node
/**
 * @purpose tripwire-seed.mjs — the SMALLEST first step of the negative-control tripwire (fusion design 2026-06-20,
 * knowledge/PATH_TO_TRUE_1TO1_V3.md §W0b). It produces the ONE number the program has never measured:
 * **the detector miss-rate of the 4 catastrophic-static vetoes against labeled broken inputs.** That number IS the
 * false-positive surface, measured — if the detectors catch ~all labeled breakage, the battery is mostly
 * regression-locking; if they miss a lot, Arm 2 (the detector-miss canary) is where the real work lives.
 *
 * It does this by REPLAYING the real, current runVetoes() over the on-disk labeled corpus and partitioning each
 * fixture into:
 *   CAUGHT  — a labeled-broken fixture where ≥1 veto fired         → seeds Arm 1 (regression tripwire, HARD halt)
 *   MISS    — a labeled-broken fixture where ZERO vetoes fired      → seeds Arm 2 (detector-miss canary, tracked)
 *   FALSE-POSITIVE — a labeled-CLEAN fixture where a veto fired     → a deflation bug (the over-conservative-is-safe
 *                                                                     direction; logged so it can't hide)
 *   UNCOVERABLE — a labeled-broken fixture whose defect class needs a grade-time STYLE signal (contrastFails for
 *                 invisible-heading, ctaRuns for unstyled-CTA) that does not exist for a frozen screenshot pair.
 *
 * HONEST SCOPE (read before trusting the number):
 *  1. The 18 human-anchored REAL broken pairs (P01–P18, human 0–6/100) are UNREPLAYABLE here: their screenshots
 *     (out-stripe-vN dirs, .audit-resend, grader-vN dirs) were ephemeral build outputs and are GONE from disk. The
 *     calibration corpus froze the human VERDICTS but not the raw INPUTS — the exact anti-pattern the tripwire
 *     design exists to fix (freeze raw detector inputs, hash-pinned, never re-fetched). Going forward every
 *     tripwire fixture MUST freeze its raw inputs. This seed therefore measures on the assets that DO survive:
 *       • the degradation LADDERS (calibration/ladders/, KNOWN injected defect per rung) — labeled ground truth.
 *       • the V2 real clone shots (calibration/v2-shots/<base>-{src,cln}-d.png) — real clones, clean-direction check.
 *  2. Only 2 of the 4 detectors are measurable from frozen pixels alone: wrong-logo + broken-hero. invisible-heading
 *     needs contrastFails and unstyled-CTA needs ctaRuns — both grade-time style runs that exist only on a LIVE
 *     build, so ladder L2 (invisible-heading) reports UNCOVERABLE here, not MISS. Those two detectors get measured
 *     when the live gen-test builds run through the full tripwire (the next step).
 *
 * No network, no WP, no new deps (pngjs + the real runVetoes). Writes a partition to /tmp/tripwire-seed-result.json.
 * Usage: node tripwire-seed.mjs
 */
import fs from 'fs';
import path from 'path';
import url from 'url';
import { PNG } from 'pngjs';
import { runVetoes } from './veto-detectors.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');          // repo root — ladder/manifest paths are repo-relative
const rootPath = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));

function loadPng(p) { return PNG.sync.read(fs.readFileSync(p)); }
const grayV = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

// ── windowed SSIM over a crop, clamped to BOTH images (mirror of veto-detectors.ssimCrop, strided for speed) ──
function ssimCrop(a, b, x0, y0, x1, y1, step = 24) {
  const win = 8, C1 = 6.5, C2 = 58.5;
  const X1 = Math.min(x1, a.width, b.width), Y1 = Math.min(y1, a.height, b.height);
  let tot = 0, n = 0;
  for (let by = y0; by + win <= Y1; by += step) for (let bx = x0; bx + win <= X1; bx += step) {
    let ma = 0, mb = 0;
    for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const ia = ((by + y) * a.width + bx + x) * 4, ib = ((by + y) * b.width + bx + x) * 4; ma += grayV(a.data, ia); mb += grayV(b.data, ib); }
    const N = win * win; ma /= N; mb /= N;
    let va = 0, vb = 0, cov = 0;
    for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const ia = ((by + y) * a.width + bx + x) * 4, ib = ((by + y) * b.width + bx + x) * 4; const da = grayV(a.data, ia) - ma, db = grayV(b.data, ib) - mb; va += da * da; vb += db * db; cov += da * db; }
    va /= N - 1; vb /= N - 1; cov /= N - 1;
    tot += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
  }
  return n ? tot / n : 1;
}
const pageSSIM = (a, b) => ssimCrop(a, b, 0, 0, Math.min(a.width, b.width), Math.min(a.height, b.height), 32);

// ── per-200px band SSIM + exact-fraction (broken-hero reads band[0]); mirrors grade-structure's band signals ──
function bands(a, b, bandPx = 200) {
  const H = Math.min(a.height, b.height), W = Math.min(a.width, b.width), nb = Math.ceil(H / bandPx);
  const ssim = [], exact = [];
  for (let i = 0; i < nb; i++) {
    const y0 = i * bandPx, y1 = Math.min(H, y0 + bandPx);
    ssim.push(+ssimCrop(a, b, 0, y0, W, y1, 16).toFixed(4));
    let same = 0, tot = 0;
    for (let y = y0; y < y1; y += 4) for (let x = 0; x < W; x += 4) {
      const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4;
      if (Math.abs(a.data[ia] - b.data[ib]) < 12 && Math.abs(a.data[ia + 1] - b.data[ib + 1]) < 12 && Math.abs(a.data[ia + 2] - b.data[ib + 2]) < 12) same++;
      tot++;
    }
    exact.push(tot ? +(same / tot).toFixed(4) : 0);
  }
  return { ssim, exact };
}

function replay(srcPng, clonePng) {
  const ps = pageSSIM(srcPng, clonePng);
  const { ssim: bandSSIM, exact: bandExact } = bands(srcPng, clonePng);
  // the SAME ctx grade-structure builds (veto-detectors.mjs:752-757), minus the style-run signals that need a live
  // build (contrastFails/ctaRuns) → invisible-heading + unstyled-CTA correctly no-op (pixel-uncoverable here).
  const { fired, all } = runVetoes({ srcShot: srcPng, cloneShot: clonePng, pageSSIM: ps, bandSSIM, bandExact, contrastFails: null, srcCtaRuns: null, cloneCtaRuns: null });
  return { fired: fired.map((v) => v.veto), pageSSIM: +ps.toFixed(4), all };
}

// map a ladder rung's injected defect → the veto class that SHOULD fire (+ whether it's pixel-coverable here).
const DEFECT_TO_VETO = {
  null: { expect: [], coverable: true },                              // L0/L1 clean → expect nothing
  heading: { expect: ['invisible-heading'], coverable: false },       // L2 → needs contrastFails (live only)
  hero: { expect: ['broken-hero'], coverable: true },                 // L3/L4 → broken-hero from pixels
};

const rows = [];

// ── (A) LADDERS — labeled injected defects (the detection-sensitivity measurement) ──────────────────────────
const ladderManifest = path.join(HERE, 'calibration/ladders/manifest.json');
if (fs.existsSync(ladderManifest)) {
  const m = JSON.parse(fs.readFileSync(ladderManifest, 'utf8'));
  for (const base of m.bases) {
    let src;
    try { src = loadPng(rootPath(base.source_img)); } catch (e) { console.error(`ladder ${base.base}: src load failed ${e.message}`); continue; }
    // PASS 1: replay every rung. PASS 2: difference against L0. The ladders are degradations OF THE REAL CLONE, so
    // L0 is NOT assumed clean — its fired vetoes are the base clone's OWN defects (e.g. linear's missing nav, LOOK-
    // confirmed). Detection of an INJECTED defect = a veto that fires on the rung but NOT on L0 (incremental). This
    // is the honesty fix: counting raw fires double-credits a baseline defect and mislabels it a false-positive.
    const reps = [];
    for (const rung of base.rungs) {
      let clone;
      try { clone = loadPng(rootPath(rung.clone_img)); } catch (e) { console.error(`ladder ${base.base}/${rung.label}: clone load failed ${e.message}`); continue; }
      reps.push({ rung, r: replay(src, clone) });
    }
    const baseline = new Set((reps.find((x) => x.rung.level === 0)?.r.fired) || []); // L0 fired = base-clone defects
    for (const { rung, r } of reps) {
      const incremental = r.fired.filter((v) => !baseline.has(v)); // vetoes NEW vs the base clone = injected-defect detections
      const spec = DEFECT_TO_VETO[String(rung.defect)] || { expect: [], coverable: true };
      const labeledBroken = rung.defect != null;
      let verdict;
      if (rung.level === 0) verdict = r.fired.length ? 'BASELINE-DEFECT' : 'BASELINE-CLEAN';     // L0: report base-clone defects
      else if (!labeledBroken) verdict = incremental.length ? 'DESAT-FALSE-POS' : 'NO-NEW-FIRE';  // L1 desat: any NEW fire = deflation
      else if (!spec.coverable) verdict = spec.expect.some((v) => incremental.includes(v)) ? 'CAUGHT' : 'UNCOVERABLE-pixelonly';
      else verdict = spec.expect.some((v) => incremental.includes(v)) ? 'CAUGHT' : 'MISS';
      const heroEv = (r.all.find((a) => a.veto === 'broken-hero') || {}).evidence || null;
      rows.push({ set: 'ladder', id: `${base.base}-${rung.label}`, defect: rung.defect, labeledBroken, expect: spec.expect, coverable: spec.coverable, fired: r.fired, baseline: [...baseline], incremental, pageSSIM: r.pageSSIM, verdict, heroEvidence: heroEv });
    }
  }
}

// ── (B) V2 real clone shots — clean-direction check on REAL clones (a known-good clone firing a veto = deflation) ──
const v2dir = path.join(HERE, 'calibration/v2-shots');
if (fs.existsSync(v2dir)) {
  for (const f of fs.readdirSync(v2dir).filter((f) => /-cln-d\.png$/.test(f)).sort()) {
    const base = f.replace(/-cln-d\.png$/, '');
    const srcF = path.join(v2dir, `${base}-src-d.png`);
    if (!fs.existsSync(srcF)) continue;
    let src, clone;
    try { src = loadPng(srcF); clone = loadPng(path.join(v2dir, f)); } catch (e) { console.error(`v2 ${base}: load failed ${e.message}`); continue; }
    const r = replay(src, clone);
    // these have NO frozen human verdict here (V2 sheet is unscored) → verdict is "real clone, fired vetoes reported"
    // for the clean-direction signal: supabase is the known-GOOD 1:1 clone, so a fired veto on it is a deflation flag.
    rows.push({ set: 'v2-real', id: base, defect: 'unknown', labeledBroken: null, expect: null, coverable: '2of4', fired: r.fired, pageSSIM: r.pageSSIM, verdict: r.fired.length ? 'VETOES-FIRED(real clone)' : 'NO-VETO(real clone)' });
  }
}

// ── SUMMARY — the detector miss-rate on the pixel-coverable labeled-broken set ───────────────────────────────
const coverableBroken = rows.filter((r) => r.set === 'ladder' && r.labeledBroken && r.coverable === true);
const caught = coverableBroken.filter((r) => r.verdict === 'CAUGHT').length;
const missed = coverableBroken.filter((r) => r.verdict === 'MISS');
const desatFalsePos = rows.filter((r) => r.verdict === 'DESAT-FALSE-POS');
const baselineDefects = rows.filter((r) => r.verdict === 'BASELINE-DEFECT');
const uncoverable = rows.filter((r) => r.verdict === 'UNCOVERABLE-pixelonly');

console.log('\n══════════ TRIPWIRE SEED — INJECTED-defect detection (L0-baseline differenced) ══════════\n');
console.log('PER-FIXTURE  (fired = raw vetoes; +NEW = incremental vs the L0 base clone = injected-defect detection):');
for (const r of rows) {
  const fired = r.fired.length ? r.fired.join(',') : '∅';
  const inc = (r.incremental && r.incremental.length) ? `  +NEW=${r.incremental.join(',')}` : '';
  let note = '';
  if (r.heroEvidence) note = ` [heroRange clone=${r.heroEvidence.cloneHeroRange} flatClone=${r.heroEvidence.flatClone} bandFloor=${r.heroEvidence.bandFloor}]`;
  console.log(`  ${r.verdict.padEnd(22)} ${String(r.id).padEnd(28)} defect=${String(r.defect).padEnd(8)} fired=${fired}${inc} ssim=${r.pageSSIM}${note}`);
}
console.log('\nSUMMARY (the honest number — INJECTED defect detection on pixel-coverable rungs):');
console.log(`  pixel-coverable injected-broken rungs (hero blank below the fold-top, L3/L4): ${coverableBroken.length}`);
console.log(`    CAUGHT (a NEW veto fired vs L0 → Arm 1):   ${caught}`);
console.log(`    MISS  (no new veto → Arm 2 / coverage gap): ${missed.length}  ${missed.length ? '→ ' + missed.map((m) => m.id).join(', ') : ''}`);
console.log(`    injected-defect miss-rate:                  ${coverableBroken.length ? (100 * missed.length / coverableBroken.length).toFixed(0) : 'n/a'}%`);
console.log(`  base-clone defects broken-hero already catches at L0 (LOOK-confirmed real, e.g. linear missing nav): ${baselineDefects.length}  ${baselineDefects.length ? '→ ' + baselineDefects.map((m) => `${m.id}{${m.fired.join(',')}}`).join(', ') : ''}`);
console.log(`  desaturation false-positives (L1, must add NO new veto): ${desatFalsePos.length}  ${desatFalsePos.length ? '→ ' + desatFalsePos.map((m) => m.id).join(', ') : '(none — clean direction OK)'}`);
console.log(`  UNCOVERABLE here (need live style-runs: invisible-heading/unstyled-CTA): ${uncoverable.length}`);
console.log('\nFINDINGS (LOOK-corrected — see the cropped bands):');
console.log('  • broken-hero is really a TOP-STRIP detector: it catches a blank top 200px (nav), NOT a hero blanked');
console.log('    BELOW the nav. On tall full-page shots the "hero" band ≈ the nav. → fix: locate the real hero region.');
console.log('  • The 4-veto floor has NO content-void detector — the supabase/framer blanked content bands are caught');
console.log('    by NOTHING. That, not broken-hero, is the biggest hole in the gate floor this seed exposed.');
console.log('\nCAVEATS:');
console.log('  • P01–P18 real human-anchored broken pairs are UNREPLAYABLE — raw screenshots gone (corpus froze verdicts,');
console.log('    not inputs — the exact anti-pattern the tripwire fixes). This seed measures ladders + V2 shots only.');
console.log('  • Only 2 of 4 detectors are pixel-coverable (wrong-logo, broken-hero); the other 2 need live style-runs.');

const result = { generatedFrom: 'tripwire-seed.mjs', coverableBroken: coverableBroken.length, caught, missed: missed.map((m) => m.id), injectedMissRatePct: coverableBroken.length ? +(100 * missed.length / coverableBroken.length).toFixed(1) : null, baselineDefects: baselineDefects.map((m) => ({ id: m.id, fired: m.fired })), desatFalsePos: desatFalsePos.map((m) => m.id), uncoverable: uncoverable.map((m) => m.id), rows };
fs.writeFileSync('/tmp/tripwire-seed-result.json', JSON.stringify(result, null, 2));
console.log('\npartition → /tmp/tripwire-seed-result.json\n');
