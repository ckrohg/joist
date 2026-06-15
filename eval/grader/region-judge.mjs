#!/usr/bin/env node
/**
 * @purpose region-judge.mjs — the PERCEPTUAL + LOCALIZED clone judge that replaces the anti-correlated
 * band-SSIM/text-coverage composite. A human rated the OLD grader's own "best" clones (61-70/100) at 0-1/100:
 * the old objective rewarded geometry/first-screen and was BLIND to the human-salient defects (wrong/missing
 * logo, invisible heading, blank/broken hero, unstyled CTA). This judge is human-aligned by construction:
 *   (1) SEGMENT a (source, clone) screenshot pair into semantic REGIONS (header/logo zone, hero/above-fold,
 *       primary-CTA, body bands, footer) — a per-region defect MAP, not a scalar.
 *   (2) ADVERSARIAL VISION-LLM pass per region (reuses the proven `claude -p` invocation from vision-judge.mjs):
 *       a CRITICAL-INSPECTOR prompt — "assume the clone is BROKEN until proven otherwise, cite element-level,
 *       do NOT praise" — forcing a strict JSON defect schema. SRC/CLONE order is RANDOMIZED per region (blind)
 *       to limit sycophancy; the harness remembers which side is the clone and re-maps defects.
 *   (3) DETERMINISTIC PNG-ONLY CORROBORATION (cheap evidence + catches what the LLM misses; NO DOM exists for
 *       these 18 calibration pairs): region luma-variance (near-uniform clone where source has content =>
 *       blank/missing); header top-left crop SSIM/contrast vs source (=> wrong/missing logo); heading-region
 *       local text↔bg contrast (<=1.5:1 => invisible heading); CTA pill/button fill presence. These are the
 *       CAUSAL backstops that make the injection GAME-TEST pass (logo-blank / heading-painted-to-bg / hero-blank
 *       each MUST drop the score >=30) — the exact failure the old grader could average away.
 *   (4) ROLL UP to a 0-100 perceptual score with a FATAL FLOOR (NOT a weighted mean): above-the-fold weighs 2x,
 *       footer 0.5x; ONE fatal-class defect (logo/heading/hero/CTA) HARD-CAPS the score low — a single ruinous
 *       defect cannot be averaged away. (A human rated all-fatal clones ~0-1.)
 *
 * READ-ONLY: the 18 calibration pairs are EXISTING screenshots — this judge READS two PNGs and renders NOTHING
 * (no Playwright, no host navigation, no git). It MUST live in eval/grader/ so pngjs resolves (it fails to import
 * from repo root). URL args (if ever passed) are refused via host-guard before anything.
 *
 * CLI:  node region-judge.mjs --source <png> --clone <png> [--out dir] [--model sonnet] [--json]
 *                             [--no-vision]   (deterministic-only; for the game-test's causal core + fast CI)
 *                             [--blind 0|1]   (randomize SRC/CLONE order per region; default 1)
 *                             [--max-regions N]
 * Output JSON: { score, defects:[{region,element,defect_class,severity,evidence,source:'vision'|'det'}],
 *                regions:[{name, aboveFold, weight, score, fatalClass, det:{...}, visionDefects:[...]}] }
 *
 * Reuses (does NOT reinvent the claude invocation): claudeOnce, composeTile, drawLabel, bandPlaceholder,
 *   LABEL_STRIP from vision-judge.mjs; crop from grade-vision-tiles.mjs.
 *
 * Self-test / gates: _region-judge-calibration.mjs (MAE / Spearman / fatal-recall vs human-results.json over all
 *   18 pairs) and _region-judge-gametest.mjs (causal: blank-logo / paint-heading-to-bg / blank-hero each drop
 *   pageScore >=30). Builder does NOT self-bless — the orchestrator re-executes both.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { execFile } from 'child_process';
import { PNG } from 'pngjs';
import { crop } from './grade-vision-tiles.mjs';
import { composeTile, extractJson, LABEL_STRIP } from './vision-judge.mjs';
import { assertNotBlocked } from '../../sandbox/host-guard.mjs';

// ── inspectOnce: the proven `claude -p` vision invocation, BYTE-FOR-BYTE the same flags claudeOnce uses ───────
// (vision-judge.mjs lines 713-716): -p <prompt> --model <m> --output-format json --allowedTools Read
// --max-budget-usd 0.60 --strict-mcp-config --setting-sources '' ; image referenced BY ABSOLUTE PATH inside the
// prompt (model loads it with Read); SIGKILL on soft timeout + an unref'd hard-timeout race; cost/model from the
// outer JSON's total_cost_usd / modelUsage (non-haiku key). We DO NOT reuse claudeOnce itself because its verdict
// validator demands a {score,defects} shape and TRUNCATES outer.result to 400 chars — our adversarial schema is
// {defects:[{element,defect_class,severity,evidence}]} and is routinely longer than 400 chars, so we must parse
// the FULL untruncated output. Everything else (the isolation-hardened invocation) is reused verbatim.
function inspectOnce(prompt, { model = 'sonnet', cwd = '/tmp', timeoutMs = 240000 } = {}) {
  const hardMs = timeoutMs + 30000;
  return new Promise((resolve) => {
    let child = null;
    const hard = setTimeout(() => { try { if (child) child.kill('SIGKILL'); } catch {} resolve({ ok: false, error: 'hard-timeout' }); }, hardMs);
    hard.unref();
    child = execFile('claude',
      ['-p', prompt, '--model', model, '--output-format', 'json', '--allowedTools', 'Read',
       '--max-budget-usd', '0.60', '--strict-mcp-config', '--setting-sources', ''],
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, cwd },
      (err, stdout) => {
        clearTimeout(hard);
        if (err && !stdout) return resolve({ ok: false, error: String(err && err.message || err) });
        let outer = null; try { outer = JSON.parse(stdout); } catch {}
        if (!outer) return resolve({ ok: false, error: 'outer JSON parse failed' });
        const usedModel = outer.modelUsage ? (Object.keys(outer.modelUsage).find((k) => !/haiku/.test(k)) || Object.keys(outer.modelUsage)[0]) : model;
        const cost = +outer.total_cost_usd || 0;
        const obj = extractJson(outer.result);                 // FULL output, not truncated
        if (!obj || !Array.isArray(obj.defects)) return resolve({ ok: false, error: 'defects JSON invalid', cost, model: usedModel, raw: String(outer.result || '').slice(0, 600) });
        resolve({ ok: true, defects: obj.defects, cost, model: usedModel });
      });
    child.on('error', () => { clearTimeout(hard); resolve({ ok: false, error: 'spawn failed' }); });
  });
}

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

// ── reversible env flags (default-ON; set =0 to restore the pre-fix behavior) ─────────────────────────────────
// Same convention as CAPTURE_NO_SPLITBG / VTILES_NO_LAZY_TRIGGER / GRADER_NO_VOID_TEXTGUARD elsewhere in this dir.
//   RJ_FORCE_REGION_ENUM  — RECALL fix. Scopes confirms to the owning region (instead of a global union that
//                           over-suppresses heading/hero), tightens the heading/hero confirm gates, loosens the
//                           over-strict deterministic heading/hero conjunctions, and ALWAYS emits a heading + hero
//                           verdict (present-ok | fatal) so page-level recall has a clean denominator. =0 reverts.
//   RJ_GRADED_FLOOR       — GRADIENT fix. Replaces the count-only fatal cap with a SEVERITY-GRADED floor that
//                           separates MISSING (truly-fatal → hard cap low, protects the broken clones + game-test)
//                           from PRESENT-BUT-WRONG (high → a bounded MID cap with partial credit), so a recognizable
//                           clone lands ~30-55 and fixing a defect raises the score monotonically. =0 reverts.
const RJ_FORCE_REGION_ENUM = process.env.RJ_FORCE_REGION_ENUM !== '0';
const RJ_GRADED_FLOOR = process.env.RJ_GRADED_FLOOR !== '0';

// ── fatal-class taxonomy (calibration mandate: logo/heading/hero/CTA = FATAL; layout/sections = structural) ───
// defect_class -> fatalClass bucket (null = structural, contributes to region score but does NOT trip the floor).
const FATAL_OF = {
  'wrong-logo': 'logo', 'missing-logo': 'logo',
  'invisible-text': 'heading',
  'blank-hero': 'hero', 'image-missing': null,           // a non-hero missing image is structural, not fatal
  'unstyled-cta': 'CTA',
  'wrong-layout': null, 'missing-section': null, 'color-off': null, 'font-off': null,
};
// MISSING (truly-ruinous) defect classes vs PRESENT-BUT-WRONG. The element is GONE/blank/painted-invisible (cap
// hard-low, keep the broken clones + game-test) vs the element is THERE but degraded (mispositioned logo, flat
// CTA, off-color-but-readable heading → high severity, partial credit). The severity-graded floor reads this.
const MISSING_DEFECT = new Set(['missing-logo', 'invisible-text', 'blank-hero']);  // CTA "blank" routes via severity
// classify a fatal-class defect as 'missing' (truly fatal) or 'wrong' (present-but-degraded). Honors an explicit
// severity 'fatal' for the genuinely-absent classes; a present-but-wrong/unstyled element is 'wrong' even if the
// (over-eager adversarial) vision model stamped it 'fatal' — provided the pixels prove the element is PRESENT.
function fatalKind(d) {
  if (!d || !d.fatalClass) return null;
  if (d._presentButWrong) return 'wrong';                 // det proved the element is present (demoted) → degraded
  if (d.severity === 'fatal' && MISSING_DEFECT.has(d.defect_class)) return 'missing';
  if (d.defect_class === 'unstyled-cta' && d.severity === 'fatal') return 'missing'; // CTA totally absent/unstyled
  return 'wrong';                                         // high (or fatal present-but-wrong) → degraded, partial credit
}
const DEFECT_CLASSES = ['wrong-logo', 'missing-logo', 'invisible-text', 'blank-hero', 'unstyled-cta', 'wrong-layout', 'missing-section', 'image-missing', 'color-off', 'font-off'];
const SEVERITY_RANK = { fatal: 4, high: 3, med: 2, low: 1 };

// ── PNG helpers (deterministic corroboration is PNG-derivable; NO DOM exists for the 18 pairs) ────────────────
function loadPng(p) { return PNG.sync.read(fs.readFileSync(p)); }
function luma(d, i) { return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }
// luma mean + std over a rect (sampled). Near-uniform => blank/solid background; high std => content/text.
function regionStats(img, x0, y0, x1, y1, step = 3) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(img.width, x1 | 0); y1 = Math.min(img.height, y1 | 0);
  let s = 0, s2 = 0, n = 0;
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const L = luma(img.data, (y * img.width + x) << 2); s += L; s2 += L * L; n++;
  }
  if (!n) return { mean: 0, std: 0, n: 0 };
  const mean = s / n;
  return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), n };
}
// dominant background luma of a rect = modal luma over a coarse histogram (the "paper" the text sits on).
function bgLuma(img, x0, y0, x1, y1, step = 3) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(img.width, x1 | 0); y1 = Math.min(img.height, y1 | 0);
  const hist = new Array(16).fill(0);
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const L = luma(img.data, (y * img.width + x) << 2); hist[Math.min(15, L / 16 | 0)]++;
  }
  let bi = 0; for (let i = 1; i < 16; i++) if (hist[i] > hist[bi]) bi = i;
  return bi * 16 + 8;
}
// "ink mass" = fraction of sampled pixels whose luma deviates strongly from the local background (= text/logo
// marks). Zero ink over a region the source paints heavily => missing logo / blank heading / blank hero.
function inkMass(img, x0, y0, x1, y1, thresh = 40, step = 2) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(img.width, x1 | 0); y1 = Math.min(img.height, y1 | 0);
  const bg = bgLuma(img, x0, y0, x1, y1, step);
  let ink = 0, n = 0;
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    if (Math.abs(luma(img.data, (y * img.width + x) << 2) - bg) > thresh) ink++; n++;
  }
  return n ? ink / n : 0;
}
// contrast ratio (WCAG-ish) between the darkest "ink" cluster and the dominant bg in a region — the
// invisible-heading probe. >2 distinct clusters with low contrast between ink and bg => heading near-invisible.
function textContrast(img, x0, y0, x1, y1, step = 2) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(img.width, x1 | 0); y1 = Math.min(img.height, y1 | 0);
  const bg = bgLuma(img, x0, y0, x1, y1, step);
  // collect lumas far enough from bg to be candidate ink; take their median as the "ink" luma.
  const ink = [];
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const L = luma(img.data, (y * img.width + x) << 2);
    if (Math.abs(L - bg) > 18) ink.push(L);
  }
  // floor: below this many ink pixels we treat the region as "no text" (→ not an invisible-heading case). The
  // RECALL fix lowers it from 12 to 6 so a FAINT heading (a near-bg-painted headline carries little supra-threshold
  // ink) is still probed for contrast rather than dismissed as "no text → present" — the dominant det heading miss.
  const inkFloor = RJ_FORCE_REGION_ENUM ? 6 : 12;
  if (ink.length < inkFloor) return { ratio: 99, inkFrac: ink.length, bg }; // effectively no text → not an invisible-heading case
  ink.sort((a, b) => a - b);
  const inkL = ink[ink.length >> 1];
  const rel = (L) => L / 255;
  const lin = (c) => { c = rel(c); return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const a = lin(inkL) + 0.05, b = lin(bg) + 0.05;
  return { ratio: +(Math.max(a, b) / Math.min(a, b)).toFixed(2), inkFrac: ink.length, bg, inkL };
}
// downscaled-grayscale SSIM between two equal-size crops (logo header compare). Cheap structural similarity.
function ssim(a, b) {
  if (a.width !== b.width || a.height !== b.height) return null;
  const N = a.width * a.height;
  let ma = 0, mb = 0;
  for (let i = 0; i < N; i++) { ma += luma(a.data, i << 2); mb += luma(b.data, i << 2); }
  ma /= N; mb /= N;
  let va = 0, vb = 0, cov = 0;
  for (let i = 0; i < N; i++) { const da = luma(a.data, i << 2) - ma, db = luma(b.data, i << 2) - mb; va += da * da; vb += db * db; cov += da * db; }
  va /= N; vb /= N; cov /= N;
  const c1 = 6.5025, c2 = 58.5225;
  return ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
}
// CTA pill/button presence: a bounded, saturated, filled rectangle within a region. Detect via saturated-color
// pixel mass (a filled button is a contiguous block of a non-background, non-text color). Returns max saturated
// run fraction as a coarse "has a styled CTA" signal.
function saturatedMass(img, x0, y0, x1, y1, step = 2) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(img.width, x1 | 0); y1 = Math.min(img.height, y1 | 0);
  let sat = 0, n = 0;
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const i = (y * img.width + x) << 2, r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn > 45 && mx > 60) sat++; n++;   // chromatic + not near-black
  }
  return n ? sat / n : 0;
}

// ── REGION SEGMENTATION ──────────────────────────────────────────────────────────────────────────────────────
// ATF (single-screen ~900px): SEMANTIC y-bands crossed with an x-split so the logo (top-left) and the hero CTA
// get their OWN cells. Full-page (tall): PROPORTIONAL banding (clone band = src band * clnH/srcH — the pinned-
// proportional path vision-judge uses for flat PNGs), capped at MAX. Cross-width (P18 390 vs 1460) aligns x
// proportionally inside crop (full-width crop on each side; the composer scales nothing but the judge sees both).
// Each region carries: name, role (header/hero/cta/body/footer), src+clone rects, aboveFold, weight.
function segmentRegions(src, cln, maxRegions = 8) {
  const sH = src.height, cH = cln.height, sW = src.width, cW = cln.width;
  const tall = sH > 1400 || cH > 1400;
  const regions = [];
  const push = (name, role, sRect, cRect, aboveFold, weight, fatalProbe) =>
    regions.push({ name, role, sRect, cRect, aboveFold, weight, fatalProbe });

  if (!tall) {
    // Above-the-fold single screen. Bands tuned to a ~900px screen but expressed as fractions of height.
    const navH = Math.round(Math.min(110, sH * 0.13));
    const heroY1 = Math.round(sH * 0.62);
    const ctaY1 = Math.round(sH * 0.86);
    // header/logo zone — top-left cell only (logo lives top-left), so a blanked logo is isolated.
    const logoW = Math.round(sW * 0.30), cLogoW = Math.round(cW * 0.30);
    push('header-logo', 'header', [0, 0, logoW, navH], [0, 0, cLogoW, navH], true, 1.0, 'logo');
    push('header-nav', 'header', [logoW, 0, sW, navH], [cLogoW, 0, cW, navH], true, 1.0, null);
    // hero band — full width (the dominant above-fold visual). heading lives here.
    push('hero', 'hero', [0, navH, sW, heroY1], [0, navH, cW, heroY1], true, 2.0, 'hero+heading');
    // CTA zone — sub-headline + primary buttons; isolate so an unstyled CTA shows up.
    push('cta-zone', 'cta', [0, heroY1, sW, ctaY1], [0, heroY1, cW, ctaY1], true, 2.0, 'CTA');
    // lower fold strip (logo strip / feature row that peeks above 900).
    push('lower', 'body', [0, ctaY1, sW, sH], [0, ctaY1, cW, cH], true, 1.0, null);
  } else {
    // Full-page proportional banding. First band = header (logo), last = footer; middle = body bands.
    const r = cH / sH;
    const N = Math.min(maxRegions, Math.max(4, Math.round(sH / 1400)));
    const bandH = Math.ceil(sH / N);
    for (let bi = 0; bi < N; bi++) {
      const sy0 = bi * bandH, sy1 = Math.min(sH, sy0 + bandH);
      if (sy1 - sy0 < 40) break;
      const cy0 = Math.round(sy0 * r), cy1 = Math.min(cH, Math.round(sy1 * r));
      const aboveFold = sy0 < 1000;
      let role = 'body', weight = 1.0, name = `band-${bi}`, probe = null;
      if (bi === 0) { role = 'header'; name = 'header-logo'; weight = 1.5; probe = 'logo'; }
      else if (bi === 1) { role = 'hero'; name = 'hero'; weight = 2.0; probe = 'hero+heading'; }
      else if (bi === N - 1) { role = 'footer'; name = 'footer'; weight = 0.5; }
      push(name, role, [0, sy0, sW, sy1], [0, cy0, cW, cy1], aboveFold, weight, probe);
    }
    // a dedicated top-left logo cell on the header band (so a blanked logo is isolated even full-page).
    const logoW = Math.round(sW * 0.30), cLogoW = Math.round(cW * 0.30), nav = Math.round(Math.min(120, sH * 0.04));
    regions.unshift({ name: 'logo-cell', role: 'header', sRect: [0, 0, logoW, nav], cRect: [0, 0, cLogoW, nav], aboveFold: true, weight: 1.0, fatalProbe: 'logo' });
    // a dedicated CTA cell inside the hero band (proportional) so an unstyled CTA is isolated.
    const ctaSy0 = Math.round(sH * 0.10), ctaSy1 = Math.round(sH * 0.22);
    regions.splice(2, 0, { name: 'cta-cell', role: 'cta', sRect: [0, ctaSy0, sW, ctaSy1], cRect: [0, Math.round(ctaSy0 * r), cW, Math.round(ctaSy1 * r)], aboveFold: true, weight: 2.0, fatalProbe: 'CTA' });
  }
  return regions.slice(0, maxRegions + 2);
}

// ── DETERMINISTIC CORROBORATION per region (CAUSAL game-test hooks) ──────────────────────────────────────────
// Returns { vetoes:[{defect_class, fatalClass, severity, evidence}], signals:{...} }. A veto is a HARD finding
// the rollup floors on (logo-blank / heading-invisible / hero-blank / CTA-absent) even if the LLM is skipped.
function corroborate(region, src, cln) {
  const [sx0, sy0, sx1, sy1] = region.sRect;
  const [cx0, cy0, cx1, cy1] = region.cRect;
  const sStat = regionStats(src, sx0, sy0, sx1, sy1);
  const cStat = regionStats(cln, cx0, cy0, cx1, cy1);
  const sInk = inkMass(src, sx0, sy0, sx1, sy1);
  const cInk = inkMass(cln, cx0, cy0, cx1, cy1);
  const vetoes = [];
  const signals = { srcStd: +sStat.std.toFixed(1), cloneStd: +cStat.std.toFixed(1), srcInk: +sInk.toFixed(3), cloneInk: +cInk.toFixed(3) };
  const probe = region.fatalProbe || '';

  // LOGO veto: source header-cell has clear ink mass, clone cell is near-blank OR structurally dissimilar.
  if (probe.includes('logo')) {
    const sCrop = crop(src, sx0, sy0, sx1 - sx0, sy1 - sy0);
    // scale clone cell to source-cell size (nearest-neighbor) for SSIM if widths differ.
    const cCropRaw = crop(cln, cx0, cy0, cx1 - cx0, cy1 - cy0);
    const cCrop = resizeNN(cCropRaw, sCrop.width, sCrop.height);
    const sim = ssim(sCrop, cCrop);
    signals.logoSSIM = sim == null ? null : +sim.toFixed(3);
    // MISSING: the source header cell carries a real mark (a small wordmark has low absolute ink — floor 0.008,
    // not 0.02) and the clone cell collapsed to near-blank (absolute <0.004 OR <15% of the source's ink). RELATIVE
    // collapse is what makes the game-test's logo-blank pass on a low-ink wordmark like linear's (srcInk 0.016).
    const srcHasMark = sInk > 0.008;
    if (srcHasMark && (cInk < 0.004 || cInk < sInk * 0.15)) {
      vetoes.push({ defect_class: 'missing-logo', fatalClass: 'logo', severity: 'fatal', evidence: `header-logo cell: source ink ${(sInk * 100).toFixed(1)}% but clone ${(cInk * 100).toFixed(2)}% (near-blank / collapsed — logo missing)` });
    } else if (srcHasMark && sim != null && sim < 0.2 && cInk > 0.004) {
      // WRONG: clone has ink but it is structurally unlike the source mark (very low SSIM). Conservative (0.2) so a
      // faithful logo at a slightly different sub-pixel position is not condemned.
      vetoes.push({ defect_class: 'wrong-logo', fatalClass: 'logo', severity: 'high', evidence: `header-logo cell SSIM ${sim.toFixed(2)} to source (very low — likely wrong logo/mark)` });
    }
  }

  // HERO veto: source hero band is rich (content), clone band is near-uniform => blank/broken hero.
  if (probe.includes('hero')) {
    if (sStat.std > 22 && cStat.std < 8) {
      vetoes.push({ defect_class: 'blank-hero', fatalClass: 'hero', severity: 'fatal', evidence: `hero band: source luma-std ${sStat.std.toFixed(0)} but clone ${cStat.std.toFixed(0)} (near-uniform — blank/broken hero, MISSING)` });
    } else if (RJ_FORCE_REGION_ENUM && sStat.std > 22 && cStat.std < sStat.std * 0.45 && cStat.std >= 8) {
      // RELATIVE-collapse path: the hero kept SOME structure (std>=8 so not a blank-hero MISSING) but the clone
      // lost >55% of the source richness — a degraded/broken-but-present hero. 'high' (present-but-wrong), so the
      // graded floor gives partial credit rather than crushing it, while still surfacing a hero verdict for recall.
      vetoes.push({ defect_class: 'blank-hero', fatalClass: 'hero', severity: 'high', evidence: `hero band: clone std ${cStat.std.toFixed(0)} is <45% of source ${sStat.std.toFixed(0)} (richness collapsed — degraded hero, present-but-wrong)` });
    }
  }

  // INVISIBLE-HEADING veto: clone heading region text↔bg contrast low while source has readable text.
  if (probe.includes('heading')) {
    const cC = textContrast(cln, cx0, cy0, cx1, cy1);
    const sC = textContrast(src, sx0, sy0, sx1, sy1);
    signals.cloneHeadingContrast = cC.ratio; signals.srcHeadingContrast = sC.ratio;
    if (RJ_FORCE_REGION_ENUM) {
      // RECALL fix: relax the over-strict 4-way AND that fired on ~0/10 real degraded pairs. Source must carry
      // readable text (sStat.std>14, sC.ratio>2) and the clone must carry SOME ink (inkFrac>=6, the lowered floor).
      // GRADED by clone contrast: <=1.5 => MISSING (painted-to-bg, invisible, fatal); <=2.2 => present-but-low
      // contrast heading (off-color-but-faint → high, partial credit). Drop the cStat.std<14 gate (a heading on a
      // busy band keeps std>14 yet can still be near-invisible against its own local bg).
      if (cC.ratio <= 2.2 && cC.inkFrac >= 6 && sStat.std > 14 && sC.ratio > 2) {
        const missing = cC.ratio <= 1.5;
        vetoes.push({ defect_class: 'invisible-text', fatalClass: 'heading', severity: missing ? 'fatal' : 'high', evidence: `heading region contrast ${cC.ratio}:1 vs source ${sC.ratio}:1 (${missing ? '<=1.5 — painted near its own background, invisible' : 'low-contrast, present-but-washed'})` });
      }
    } else if (cC.ratio <= 1.5 && cC.inkFrac >= 12 && cStat.std < 14 && sStat.std > 18) {
      vetoes.push({ defect_class: 'invisible-text', fatalClass: 'heading', severity: 'fatal', evidence: `heading region contrast ${cC.ratio}:1 (<=1.5 — heading painted near its own background, invisible)` });
    }
  }

  // CTA veto: source cta zone has a saturated filled pill/button; clone has essentially none => unstyled CTA.
  if (probe.includes('CTA')) {
    const sSat = saturatedMass(src, sx0, sy0, sx1, sy1);
    const cSat = saturatedMass(cln, cx0, cy0, cx1, cy1);
    signals.srcSat = +sSat.toFixed(3); signals.cloneSat = +cSat.toFixed(3);
    // only fire when the SOURCE clearly has a styled (saturated) CTA and the clone lost it.
    if (sSat > 0.012 && cSat < sSat * 0.18 && cStat.std < sStat.std) {
      vetoes.push({ defect_class: 'unstyled-cta', fatalClass: 'CTA', severity: 'high', evidence: `cta zone: source saturated-fill ${(sSat * 100).toFixed(1)}% but clone ${(cSat * 100).toFixed(2)}% (CTA pill unstyled/missing)` });
    }
  }

  // GENERIC missing-content veto (any region): source rich, clone near-blank — structural (NON-fatal-class).
  if (sStat.std > 20 && cStat.std < 6 && sInk > 0.03 && cInk < 0.003 && !vetoes.some(v => v.fatalClass)) {
    vetoes.push({ defect_class: 'missing-section', fatalClass: null, severity: 'high', evidence: `region near-blank in clone (std ${cStat.std.toFixed(0)} vs source ${sStat.std.toFixed(0)}) — content missing` });
  }

  // ── CONFIRMS: fatal classes the PIXELS PROVE are PRESENT & faithful (ground-truth veto on a hallucinated
  // vision "missing X" fatal). The adversarial "assume broken" prompt can claim a logo/heading/hero/CTA is
  // missing even when it is demonstrably present and ~identical to the source. When the deterministic signal
  // shows the element is THERE and MATCHES, we SUPPRESS a vision fatal of that class for this region. This is the
  // honest combiner direction: det proves absence (vetoes) AND proves presence (confirms). Strict thresholds so
  // a genuinely-degraded element is NOT confirmed.
  const confirms = new Set();
  if (probe.includes('logo') && signals.logoSSIM != null && signals.logoSSIM > 0.9 && Math.abs(sInk - cInk) < 0.01) confirms.add('logo'); // logo cell near-identical to source
  if (RJ_FORCE_REGION_ENUM) {
    // TIGHTER confirm gates: only confirm an element PRESENT when it matches the SOURCE's own richness/contrast,
    // not just an absolute floor. A flat/washed hero (std collapsed vs source) or a faint heading (contrast far
    // below source) must NOT be "confirmed present" — that global over-confirm is what collapsed the recall.
    const cH = (signals.cloneHeadingContrast ?? 0), sHc = (signals.srcHeadingContrast ?? 0);
    if (probe.includes('hero') && cStat.std > sStat.std * 0.8 && cStat.std >= 14 && Math.abs(sStat.mean - cStat.mean) < 12 && Math.abs(sInk - cInk) < sInk * 0.4 + 0.005) confirms.add('hero'); // hero richness + ink-mass parity with source
    if (probe.includes('heading') && cH >= 3 && cH >= sHc * 0.8 && cStat.std > 14) confirms.add('heading'); // heading readable AND ~as-contrasty as source
  } else {
    if (probe.includes('hero') && cStat.std > sStat.std * 0.7 && Math.abs(sStat.mean - cStat.mean) < 12) confirms.add('hero'); // hero band richness matches source
    if (probe.includes('heading') && signals.cloneHeadingContrast != null && signals.cloneHeadingContrast >= 3 && cStat.std > 14) confirms.add('heading'); // heading clearly readable
  }
  if (probe.includes('CTA') && signals.cloneSat != null && signals.srcSat != null && signals.cloneSat >= signals.srcSat * 0.7) confirms.add('CTA'); // CTA fill present comparable to source

  // PRESENCE (weaker than a confirm): the pixels show the element is THERE — has ink/structure/saturation in the
  // clone — even if degraded/wrong (so NOT confirmed faithful). Used ONLY by the graded floor to reclassify a vision
  // 'fatal' as present-but-wrong ('high'). Thresholds are deliberately loose (mere existence), well below confirm.
  const presence = new Set();
  // logo present if the clone header cell carries real ink (a swapped/mispositioned but PAINTED mark) — i.e. the
  // clone did not collapse to near-blank relative to a source that has a mark.
  if (probe.includes('logo') && cInk > 0.003 && cInk >= sInk * 0.4) presence.add('logo');
  // hero present if the clone band kept meaningful structure (not the flat-blank a MISSING hero shows).
  if (probe.includes('hero') && cStat.std >= 12 && cInk > 0.01) presence.add('hero');
  // heading present if the clone region carries ink that is at least faintly readable (contrast above the
  // invisible floor) — a wrong-color-but-readable heading, distinct from a painted-to-bg invisible one.
  if (probe.includes('heading') && signals.cloneHeadingContrast != null && signals.cloneHeadingContrast > 1.5 && cStat.std > 10) presence.add('heading');
  // CTA present if the clone zone has SOME chromatic fill (a flat/wrong-color pill, not a totally absent button).
  if (probe.includes('CTA') && signals.cloneSat != null && (signals.cloneSat > 0.002 || cStat.std >= sStat.std * 0.6)) presence.add('CTA');

  return { vetoes, signals, confirms: [...confirms], presence: [...presence] };
}

// nearest-neighbor resize of a PNG crop (for SSIM when widths differ; no smoothing — structural compare).
function resizeNN(img, w, h) {
  if (img.width === w && img.height === h) return img;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) { const sy = Math.min(img.height - 1, (y * img.height / h) | 0); for (let x = 0; x < w; x++) { const sx = Math.min(img.width - 1, (x * img.width / w) | 0); const si = (sy * img.width + sx) << 2, di = (y * w + x) << 2; out.data[di] = img.data[si]; out.data[di + 1] = img.data[si + 1]; out.data[di + 2] = img.data[si + 2]; out.data[di + 3] = 255; } }
  return out;
}

// ── ADVERSARIAL CRITICAL-INSPECTOR vision prompt (blind order; forced JSON schema; no praise) ─────────────────
// LEFT/RIGHT identity is RANDOMIZED per region (blind); the harness passes which side is the clone so the model
// reports defects against the correct side, and we re-map to clone-relative defects after.
function inspectorPrompt(tilePath, region, cloneSide) {
  const left = cloneSide === 'left' ? 'REBUILD (clone)' : 'ORIGINAL (source)';
  const right = cloneSide === 'left' ? 'ORIGINAL (source)' : 'REBUILD (clone)';
  return `You are a HARSH QA inspector. Read the image file ${tilePath} now.
It is a side-by-side composite split by a vertical MAGENTA divider. LEFT of the divider = ${left}. RIGHT = ${right}. The solid-black strip across the very top carries harness labels only — it is NOT page content; ignore it.
This is the "${region.name}" region (role: ${region.role}) of a website that was REBUILT from the ORIGINAL. Your job: find everything WRONG with the REBUILD relative to the ORIGINAL.
ASSUME THE REBUILD IS BROKEN until the pixels prove otherwise. Do NOT praise. Do NOT explain what is right. Only enumerate DEFECTS of the rebuild, each with an element-level citation (name the specific element: "the wordmark/logo", "the H1 headline", "the Get started button", "the hero illustration", etc.).
Pay special attention to (these are what a visitor instantly notices and what makes a clone worthless):
- the brand LOGO / wordmark: missing, blank, or replaced by a different/wrong mark.
- HEADINGS rendered invisible or near-invisible (text painted ~the same color as its background, washed out, or absent).
- the HERO area blank, broken, collapsed, or missing its main image/illustration.
- primary CALL-TO-ACTION buttons unstyled (no fill/color/shape — looks like a plain link), miscolored, or missing.
- whole sections missing, layout collapsed/overflowing, wrong fonts, wrong colors.
Output ONLY this JSON, no prose, no markdown fences:
{"defects":[{"element":"<specific element>","defect_class":"<one of: ${DEFECT_CLASSES.join('|')}>","severity":"<fatal|high|med|low>","evidence":"<what you see that is wrong>"}]}
severity: fatal = ruins the page for a visitor (missing logo, invisible headline, blank/broken hero, unstyled primary CTA, whole section gone). high = a prominent element clearly wrong. med = noticeable. low = nitpick. If the rebuild side is genuinely faithful with no defects, output {"defects":[]} — but only if you are certain.`;
}

// ── per-region vision pass: compose [left|clone or src order] tile, call claudeOnce, parse defect list ────────
async function judgeRegionVision(region, src, cln, outDir, blind, model) {
  const [sx0, sy0, sx1, sy1] = region.sRect;
  const [cx0, cy0, cx1, cy1] = region.cRect;
  let sTile = crop(src, sx0, sy0, sx1 - sx0, Math.max(20, sy1 - sy0));
  let cTile = crop(cln, cx0, cy0, cx1 - cx0, Math.max(20, cy1 - cy0));
  // BLIND: randomize which side is the clone (limit sycophancy / position bias).
  const cloneSide = blind ? (Math.random() < 0.5 ? 'left' : 'right') : 'right';
  const left = cloneSide === 'left' ? cTile : sTile;
  const right = cloneSide === 'left' ? sTile : cTile;
  // Labels are deliberately NEUTRAL ('A'/'B') so the burned-in label never leaks which side is the clone — the
  // blind framing lives only in the prompt text (LEFT/RIGHT = clone/source per cloneSide), limiting position bias.
  const comp = composeTile(left, right, src.width, sy0, { src: 'A', clone: 'B' });
  const tilePath = path.join(outDir, `region-${region.name}.png`);
  fs.writeFileSync(tilePath, PNG.sync.write(comp));
  let res = await inspectOnce(inspectorPrompt(tilePath, region, cloneSide), { model, cwd: outDir });
  if (!res.ok) { // one strict retry on bad JSON / transient failure
    res = await inspectOnce(inspectorPrompt(tilePath, region, cloneSide) + '\nYour previous output was not valid JSON. Output ONLY the raw JSON object {"defects":[...]}, nothing else.', { model, cwd: outDir });
  }
  if (!res.ok) return { tilePath, cloneSide, defects: [], cost: res.cost || 0, error: res.error, model: res.model };
  return parseVisionDefects(res.defects, tilePath, cloneSide, res.cost, res.model, region);
}
function parseVisionDefects(list, tilePath, cloneSide, cost, model, region = {}) {
  const inHero = region.role === 'hero' || (region.fatalProbe || '').includes('hero');
  const defects = (Array.isArray(list) ? list : []).filter(d => d && (d.element || d.evidence)).map(d => {
    let dc = String(d.defect_class || '').toLowerCase().replace(/\s+/g, '-');
    if (!DEFECT_CLASSES.includes(dc)) dc = inferClass(dc, d);
    const sev = String(d.severity || 'med').toLowerCase();
    let fatalClass = FATAL_OF[dc] ?? null;
    // HERO-region disambiguation: the model routinely describes a broken/blank hero as a missing illustration
    // ('image-missing') or a washed-out 'color-off' background. Inside the HERO region, a high/fatal image or
    // background defect IS the human's "blank/broken hero" fatal class (FATAL_OF leaves these null globally so an
    // incidental graphic elsewhere is not fatal — the region context is what disambiguates).
    if (inHero && fatalClass == null && (dc === 'image-missing' || dc === 'color-off' || dc === 'blank-hero') && (sev === 'fatal' || sev === 'high')) {
      const ev = (d.element + ' ' + (d.evidence || '')).toLowerCase();
      if (/hero|illustration|banner|background|main (image|graphic|visual)|backdrop/.test(ev) || dc === 'blank-hero') fatalClass = 'hero';
    }
    // RECALL (RJ_FORCE_REGION_ENUM): on ALREADY-BROKEN pages the model often routes a collapsed hero / invisible
    // headline through the GENERIC classes ('missing-section', 'wrong-layout') instead of the hero/heading classes —
    // the enumeration gap that left heading/hero recall low on busy pairs. Inside the hero+heading band, re-map a
    // high/fatal generic defect to the human's fatal class WHEN its evidence names the hero or the headline (precise:
    // a generic "section missing" with no hero/heading words stays structural, so a clean region is never over-flagged).
    const inHeading = (region.fatalProbe || '').includes('heading');
    if (RJ_FORCE_REGION_ENUM && fatalClass == null && (dc === 'missing-section' || dc === 'wrong-layout') && (sev === 'fatal' || sev === 'high')) {
      const ev = (d.element + ' ' + (d.evidence || '')).toLowerCase();
      if (inHero && /hero|illustration|banner|backdrop|main (image|graphic|visual)|hero (section|area|image)/.test(ev)) fatalClass = 'hero';
      else if (inHeading && /head(ing|line)|h1|title|hero (text|copy)/.test(ev)) fatalClass = 'heading';
    }
    // and an invisible/low-contrast text call the model phrased as 'color-off' inside the heading band -> heading.
    if (RJ_FORCE_REGION_ENUM && inHeading && fatalClass == null && dc === 'color-off' && (sev === 'fatal' || sev === 'high')) {
      const ev = (d.element + ' ' + (d.evidence || '')).toLowerCase();
      if (/head(ing|line)|h1|title|text (is|appears) (invisible|washed|low.contrast)|same colou?r/.test(ev)) fatalClass = 'heading';
    }
    // PRECISION SCOPING (RJ_FORCE_REGION_ENUM): the human's "invisible heading" / "blank hero" classes are the
    // ABOVE-FOLD H1 / hero. A vision invisible-text or blank-hero defect in a NON-probe band (mid-page low-contrast
    // body text, an incidental footer graphic) maps to heading/hero via the GLOBAL FATAL_OF table and FALSELY trips
    // the fatal floor — the precision leak behind heading/hero false-positives on clean-ish pairs (P05 'lower',
    // P17 'band-5'). Demote those to structural (fatalClass=null) OUTSIDE the owning probe band; the defect is still
    // recorded (region penalty), it just no longer counts as the human's hero-heading/hero fatal class.
    if (RJ_FORCE_REGION_ENUM) {
      if (fatalClass === 'heading' && !inHeading) fatalClass = null;   // invisible body text ≠ invisible HEADING
      if (fatalClass === 'hero' && !inHero) fatalClass = null;         // incidental missing graphic ≠ blank HERO
    }
    return {
      element: String(d.element || '').slice(0, 120),
      defect_class: dc,
      severity: SEVERITY_RANK[sev] ? sev : 'med',
      evidence: String(d.evidence || '').slice(0, 240),
      fatalClass,
      source: 'vision',
    };
  });
  return { tilePath, cloneSide, defects, cost: cost || 0, model };
}
function inferClass(dc, d) {
  const s = (dc + ' ' + (d.element || '') + ' ' + (d.evidence || '')).toLowerCase();
  if (/logo|wordmark|brand/.test(s)) return /missing|absent|blank|gone/.test(s) ? 'missing-logo' : 'wrong-logo';
  if (/invisible|low.contrast|washed|same colou?r|unreadable/.test(s)) return 'invisible-text';
  if (/hero/.test(s)) return 'blank-hero';
  if (/cta|button|call.to.action|pill/.test(s)) return 'unstyled-cta';
  if (/image|illustration|graphic|photo|mockup/.test(s)) return 'image-missing';
  if (/section|missing/.test(s)) return 'missing-section';
  if (/font|typeface/.test(s)) return 'font-off';
  if (/colou?r/.test(s)) return 'color-off';
  return 'wrong-layout';
}

// ── ROLLUP: per-region scores -> 0-100 with a FATAL FLOOR (not a weighted mean) ───────────────────────────────
// base = weighted mean of per-region scores (aboveFold 2x via region.weight, footer 0.5x). Then HARD-CAP:
//   any 1 fatal-class defect present  -> cap at 30
//   >=2 DISTINCT fatal classes failed -> cap at 10
// A human rated all-fatal clones ~0-1; one ruinous defect cannot be averaged away (the old grader's exact bug).
function regionScore(region, vetoes, visionDefects) {
  // start from 100, subtract per-defect penalties; fatal vetoes dominate.
  let score = 100;
  const all = [...vetoes, ...visionDefects];
  for (const d of all) {
    const sev = typeof d.severity === 'string' ? d.severity : 'med';
    const pen = sev === 'fatal' ? 70 : sev === 'high' ? 35 : sev === 'med' ? 15 : 5;
    score -= pen;
  }
  return Math.max(0, Math.round(score));
}
function rollup(regions) {
  let sw = 0, ss = 0;
  const fatalClasses = new Set();
  // SEVERITY-GRADED accounting: a fatal class is recorded as MISSING (truly ruinous — gone/blank/invisible) or
  // WRONG (present-but-degraded). Per class we keep the WORST kind seen (missing dominates wrong).
  const classKind = new Map();   // class -> 'missing' | 'wrong'
  for (const r of regions) {
    const w = r.weight;
    sw += w; ss += r.score * w;
    for (const d of [...r.det.vetoes, ...r.visionDefects]) {
      if (!(d.fatalClass && (d.severity === 'fatal' || d.severity === 'high'))) continue;
      fatalClasses.add(d.fatalClass);
      const kind = fatalKind(d) || 'wrong';
      if (kind === 'missing' || !classKind.has(d.fatalClass)) classKind.set(d.fatalClass, kind);
    }
  }
  let base = sw ? ss / sw : 0;

  if (!RJ_GRADED_FLOOR) {
    // LEGACY count-only cap (RJ_GRADED_FLOOR=0): identical to the pre-fix behavior.
    let cap = 100;
    if (fatalClasses.size >= 2) cap = 10;
    else if (fatalClasses.size === 1) cap = 30;
    const score = Math.round(Math.min(base, cap));
    return { score, base: +base.toFixed(1), cap, fatalClasses: [...fatalClasses] };
  }

  // GRADED FLOOR: separate MISSING (truly fatal) from PRESENT-BUT-WRONG (high). MISSING hard-caps low (keeps the
  // 18 broken clones + the injection game-test where missing-logo/invisible-heading/blank-hero must drop >=30).
  // PRESENT-BUT-WRONG gets a MID cap that scales with how many distinct classes are degraded — a recognizable clone
  // lands ~30-55 and fixing a degraded fatal both removes a class AND lifts base, so the climb is monotonic.
  let missingCount = 0, wrongCount = 0;
  for (const kind of classKind.values()) { if (kind === 'missing') missingCount++; else wrongCount++; }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let cap = 100;
  if (missingCount >= 2) cap = 10;          // multiple ruinous absences — all-fatal clone (human ~0-1)
  else if (missingCount === 1) cap = 15;    // one ruinous absence — still capped low, > the 2-missing floor
  // present-but-wrong cap (only bites when it is below the missing-driven cap): 1 degraded ~45, 2 ~33, 3 ~30
  // (the task-specified band). A recognizable-but-degraded clone lands MID-RANGE; the cap is a CEILING and base
  // pulls it down, so a clone that is ALSO structurally broken (low per-region base) still lands low via base.
  if (wrongCount > 0) cap = Math.min(cap, clamp(55 - 12 * wrongCount, 30, 55));
  // MONOTONIC within-band: let base pull the score DOWN within the cap (min), so a region map with more/worse
  // per-region penalties still scores lower than a cleaner one at the same cap tier. The per-region ladder already
  // separates fatal(70)/high(35), so fixing one degraded fatal raises base AND drops wrongCount → smooth climb.
  // The base is the precision backstop: a wholesale-collapsed clone has low per-region scores → low base pulls it
  // under the cap (the cap is a CEILING, not a floor). So a degraded-but-present clone lands mid ONLY when its
  // region map is otherwise intact; a broken clone with the same fatal classes lands low via base.
  const score = Math.round(Math.min(base, cap));
  return { score, base: +base.toFixed(1), cap, fatalClasses: [...fatalClasses], missingCount, wrongCount, classKind: Object.fromEntries(classKind) };
}

// bounded-concurrency pool (vision calls are the bottleneck; default 3 parallel like vision-judge).
async function pool(items, n, fn) {
  const results = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

// ── MAIN judge entrypoint (importable: judgePair) ────────────────────────────────────────────────────────────
export async function judgePair({ sourcePng, clonePng, outDir = '/tmp/region-judge', model = 'sonnet', blind = true, vision = true, maxRegions = 8, jobs = 3 }) {
  fs.mkdirSync(outDir, { recursive: true });
  const src = loadPng(sourcePng), cln = loadPng(clonePng);
  const regions = segmentRegions(src, cln, maxRegions);
  let cost = 0, usedModel = model;
  // deterministic corroboration is synchronous + cheap → compute up-front for every region.
  const dets = regions.map(region => corroborate(region, src, cln));
  // CONFIRMS (PRESENT & faithful, suppresses a hallucinated vision "missing X" fatal). SCOPING matters:
  //  - logo & CTA have a SINGLE canonical isolated cell, so their confirm is legitimately GLOBAL — the model often
  //    claims "logo/CTA missing" from a non-logo region whose local det has no logo probe; pixel presence in the
  //    canonical cell is global truth there.
  //  - heading & hero recur across MANY bands; a global confirm from ONE band where the heading/hero looked present
  //    then suppressed the vision fatal in EVERY band — the dominant leak that collapsed heading→0.20 / hero→0.455.
  //    RECALL fix (RJ_FORCE_REGION_ENUM): heading/hero confirms are scoped to the OWNING region only. Legacy path
  //    keeps the all-class global union.
  const GLOBAL_CONFIRM_CLASSES = RJ_FORCE_REGION_ENUM ? new Set(['logo', 'CTA']) : null;
  const globalConfirms = new Set();
  for (const det of dets) for (const c of (det.confirms || [])) {
    if (!GLOBAL_CONFIRM_CLASSES || GLOBAL_CONFIRM_CLASSES.has(c)) globalConfirms.add(c);
  }
  // GLOBAL PRESENCE (graded-floor only): a fatal class the pixels show is PRESENT (maybe degraded) ANYWHERE on the
  // page. Used solely to reclassify a vision 'fatal' as present-but-wrong ('high'). It is global because a class can
  // be flagged fatal in one region while its evidence-of-presence lives in another (e.g. the CTA pill det probe is a
  // dedicated cta-cell, but the model may stamp 'unstyled-cta fatal' from the hero band). This NEVER suppresses a
  // defect — it only softens severity — so a genuinely MISSING element (no presence anywhere) is unaffected.
  const globalPresence = new Set();
  for (const det of dets) for (const c of (det.presence || [])) globalPresence.add(c);
  // vision pass per region, parallelized (the slow leg). Skipped entirely when vision=false (game-test det core).
  const visions = vision
    ? await pool(regions, jobs, (region) => judgeRegionVision(region, src, cln, outDir, blind, model))
    : regions.map(() => ({ defects: [], cost: 0, model }));
  const out = [];
  for (let ri = 0; ri < regions.length; ri++) {
    const region = regions[ri], det = dets[ri], vr = visions[ri];
    cost += vr.cost || 0;
    if (vr.model) usedModel = vr.model;
    let visionDefects = vr.defects || [];
    if (vr.tilePath) { region._tilePath = vr.tilePath; region._cloneSide = vr.cloneSide; }
    // de-dupe: if a deterministic veto already names a fatalClass, drop redundant vision defects of that class.
    const detFatal = new Set(det.vetoes.filter(v => v.fatalClass).map(v => v.fatalClass));
    visionDefects = visionDefects.filter(d => !(d.fatalClass && detFatal.has(d.fatalClass)));
    // effective confirms for THIS region = the global set (logo/CTA, or all-classes on the legacy path) UNION
    // this region's OWN confirms (heading/hero scoped here under RJ_FORCE_REGION_ENUM).
    const regionConfirms = RJ_FORCE_REGION_ENUM ? new Set([...globalConfirms, ...(det.confirms || [])]) : globalConfirms;
    // CONFIRMS suppression: the pixels PROVE a logo/heading/hero/CTA is present & faithful in scope → a vision
    // "missing/invisible X" FATAL of that class is a hallucination. Demote to a 'low' nitpick so it neither trips
    // the fatal floor nor zeroes the region.
    if (regionConfirms.size) visionDefects = visionDefects.map(d => (d.fatalClass && regionConfirms.has(d.fatalClass)) ? { ...d, severity: 'low', fatalClass: null, suppressedByDet: d.fatalClass } : d);
    // PRESENT-BUT-WRONG demotion (GRADED FLOOR support): when det proves the element is PRESENT (ink/contrast/
    // saturation present) but NOT faithful enough to confirm, a vision 'fatal' of that class is an OVER-call — the
    // element is there but degraded. Tag it _presentButWrong + clamp to 'high' so the severity-graded floor scores
    // it as a recoverable defect (partial credit) instead of a ruinous MISSING one. This is what lifts a recognizable
    // clone (present-but-swapped logo / present-but-flat CTA) off the floor into the mid band.
    if (RJ_GRADED_FLOOR) {
      visionDefects = visionDefects.map(d => {
        if (d.fatalClass && d.severity === 'fatal' && globalPresence.has(d.fatalClass) && !regionConfirms.has(d.fatalClass)) {
          return { ...d, severity: 'high', _presentButWrong: true };
        }
        return d;
      });
    }
    const score = regionScore(region, det.vetoes, visionDefects);
    out.push({
      name: region.name, role: region.role, aboveFold: region.aboveFold, weight: region.weight,
      score, fatalClass: [...det.vetoes.filter(v => v.fatalClass).map(v => v.fatalClass), ...visionDefects.filter(v => v.fatalClass).map(v => v.fatalClass)][0] || null,
      det, visionDefects, sRect: region.sRect, cRect: region.cRect,
    });
  }
  // ── ENUMERATION COMPLETENESS (RJ_FORCE_REGION_ENUM): guarantee an AFFIRMATIVE heading + hero verdict exists ──
  // The heading/hero recall denominator must map cleanly to the human classes even on busy/already-broken pages.
  // We mark, for each of {heading, hero}, whether the page produced ANY verdict for that class — a fatal/high defect
  // (invisible/blank → counts toward recall) OR an explicit present-ok (det confirm/presence on a probe region).
  // If a probe region exists but NEITHER fired, we record an explicit present-ok verdict on the owning region so the
  // absence of a fatal is an AFFIRMATIVE decision (auditable, never a silent skip). This does NOT inject false fatals
  // (present-ok adds nothing to fatalClasses), so it cannot lift the broken clones.
  const regionVerdicts = {};
  if (RJ_FORCE_REGION_ENUM) {
    for (const cls of ['heading', 'hero']) {
      const probeKey = cls === 'heading' ? 'heading' : 'hero';
      const owners = out.filter((r, i) => (regions[i].fatalProbe || '').includes(probeKey));
      if (!owners.length) { regionVerdicts[cls] = 'no-probe'; continue; }
      const sawFatal = out.some(r => [...r.det.vetoes, ...r.visionDefects].some(d => d.fatalClass === cls && (d.severity === 'fatal' || d.severity === 'high')));
      if (sawFatal) { regionVerdicts[cls] = 'defect'; continue; }
      const sawPresent = owners.some((r) => {
        const di = out.indexOf(r); const det = dets[di] || {};
        return (det.confirms || []).includes(cls) || (det.presence || []).includes(cls);
      });
      regionVerdicts[cls] = 'present-ok';
      // tag the owning region with an explicit affirmative so the verdict is recorded (no fatal added).
      owners[0]._enumVerdict = sawPresent ? 'present-ok' : 'present-ok(default)';
    }
  }
  const ru = rollup(out);
  // flatten the per-region defect map.
  const defects = [];
  for (const r of out) {
    for (const v of r.det.vetoes) defects.push({ region: r.name, element: v.evidence.split(':')[0], defect_class: v.defect_class, severity: v.severity, evidence: v.evidence, source: 'det', fatalClass: v.fatalClass });
    for (const d of r.visionDefects) defects.push({ region: r.name, element: d.element, defect_class: d.defect_class, severity: d.severity, evidence: d.evidence, source: 'vision', fatalClass: d.fatalClass });
  }
  defects.sort((a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || 0);
  return {
    score: ru.score, base: ru.base, cap: ru.cap, fatalClasses: ru.fatalClasses,
    missingCount: ru.missingCount, wrongCount: ru.wrongCount, classKind: ru.classKind, regionVerdicts,
    source: sourcePng, clone: clonePng, model: usedModel, costUsd: +cost.toFixed(4), vision,
    regions: out.map(({ det, ...r }) => ({ ...r, det: { signals: det.signals, vetoes: det.vetoes, confirms: det.confirms || [], presence: det.presence || [] } })),
    defects,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────
const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (IS_MAIN) (async () => {
  const SOURCE = arg('source'), CLONE = arg('clone');
  if (!SOURCE || !CLONE) { console.error('usage: node region-judge.mjs --source <png> --clone <png> [--out dir] [--model sonnet] [--no-vision] [--blind 0|1] [--json]'); process.exit(2); }
  // §0 SAFETY: refuse a stray blocked host if a URL is ever passed (these pairs are PNGs; render nothing).
  for (const a of [SOURCE, CLONE]) if (/^https?:/i.test(a)) assertNotBlocked(a);
  for (const a of [SOURCE, CLONE]) if (!fs.existsSync(a)) { console.error(`not found: ${a}`); process.exit(2); }
  const OUT = arg('out', '/tmp/region-judge');
  const r = await judgePair({
    sourcePng: SOURCE, clonePng: CLONE, outDir: OUT, model: arg('model', 'sonnet'),
    blind: arg('blind', '1') !== '0', vision: !has('no-vision'), maxRegions: +arg('max-regions', 8), jobs: +arg('jobs', 3),
  });
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(r, null, 2));
  if (has('json')) { console.log(JSON.stringify(r, null, 2)); return; }
  console.log(JSON.stringify({
    score: r.score, base: r.base, cap: r.cap, fatalClasses: r.fatalClasses,
    regions: r.regions.map(rg => ({ name: rg.name, score: rg.score, fatalClass: rg.fatalClass, vetoes: rg.det.vetoes.length, visionDefects: rg.visionDefects.length })),
    topDefects: r.defects.slice(0, 12).map(d => `[${d.severity}|${d.defect_class}|${d.region}|${d.source}] ${d.element || d.evidence}`),
    costUsd: r.costUsd, model: r.model, out: path.join(OUT, 'results.json'),
  }, null, 2));
})().catch(e => { console.error('REGION-JUDGE FAILED:', e && e.stack || e); process.exit(1); });

export { segmentRegions, corroborate, rollup, regionScore, textContrast, inkMass, regionStats, saturatedMass, ssim, FATAL_OF, DEFECT_CLASSES, loadPng, inspectorPrompt, inspectOnce };
