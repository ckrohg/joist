#!/usr/bin/env node
/**
 * @purpose GRADER-HONESTY veto detectors (fusion finding: the composite OVERSTATES human fidelity by 17-26pts
 * because it over-credits geometry and UNDER-penalizes human-salient STATIC defects a human sees instantly).
 * This module is the de-overstatement backstop: four detectors for the defects the band-SSIM/editability terms
 * are blind to, each using a CONCRETE grade-time signal already captured by grade-structure.mjs:
 *
 *   • wrong-logo       — the clone's top-left header/logo region differs GROSSLY from the source's (a swapped or
 *                        missing brand mark). Signal: SSIM of the header-logo crop (y<HDR_Y, x<HDR_X) of the two
 *                        full-page screenshots; fires only when the logo crop is at floor while the REST of the
 *                        page matches well (so a uniformly-broken page is NOT double-counted as wrong-logo).
 *   • invisible-heading — a HEADING-sized run (fsz>=18) whose text colour ≈ its painted background (unreadable).
 *                        Signal: cln.ds.contrastFails (ratio<1.3) PIXEL-VERIFIED against the clone screenshot
 *                        (local-bg first-line strip — the SAME invisibleLocal logic the grader already trusts),
 *                        narrowed to headings. Kills the gradient/background-clip:text false positive.
 *   • broken-hero      — the hero (top band) is near-empty / near-uniform (a hero that failed to build). Signal:
 *                        top-band SSIM/exact at floor OR the clone's top band luminance-range < HERO_FLAT (a flat
 *                        slab). Guarded by the SOURCE hero having real content (lumRange high) so a legitimately
 *                        minimal/flat source hero does NOT trip it.
 *   • unstyled-CTA     — a button/CTA run rendered with DEFAULT styling (near-black/grey text, no accent fill,
 *                        low saturation) while the SOURCE carries a styled accent CTA. Signal: ctx.ctaRuns
 *                        (computed colour/bg/sat of a,button,.elementor-widget-button), compared to the source's
 *                        CTA accent presence. Fires only when source HAS a styled CTA and the clone has none.
 *
 * CONTRACT: runVetoes(ctx) -> { fired: [{ veto, severity, evidence }], all: [...debug...] }. severity ∈ (0,1].
 * The caller (grade-structure.mjs) folds a fired veto into a HARD COMPOSITE CAP (composite = min(composite, CEIL))
 * — a human instantly reads the page as broken, so no geometry score should survive it. Default ceiling 0.45.
 *
 * REVERSIBILITY / NO-FALSE-POSITIVE DISCIPLINE (eval-integrity): every detector has a NEGATIVE-CONTROL in
 * _veto-detectors-selftest.mjs (a clean fixture must trip NO veto — a veto that fires on a good clone DEFLATES
 * the grader, the opposite of the goal). Thresholds are tuned conservative (fire only on UNAMBIGUOUS breakage).
 * The whole module is gated OFF by the caller under GRADER_NO_VETOES=1, and each detector is independently
 * killable via GRADER_NO_VETO_<NAME>=1 so each veto is separately reversible (matches the per-feature flag
 * granularity already in grade-structure.mjs). This file has NO side effects and does NO navigation/IO — it
 * operates purely on the in-memory signals the grader already gathered (screenshots + ds + census + bands),
 * so it is OFFLINE-testable with synthetic PNG/ctx fixtures.
 */

// ---- pixel helpers (self-contained; mirror the grade-structure helpers so this module has no import cycle) ----
const lumaAt = (img, i) => 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
const grayV = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

// SSIM over a rectangular crop [x0,x1) × [y0,y1) of two PNGs (windowed, same kernel as grade-structure.ssim).
function ssimCrop(a, b, x0, y0, x1, y1) {
  const win = 8, C1 = 6.5, C2 = 58.5;
  const X1 = Math.min(x1, a.width, b.width), Y1 = Math.min(y1, a.height, b.height);
  let tot = 0, n = 0;
  for (let by = y0; by + win <= Y1; by += win) for (let bx = x0; bx + win <= X1; bx += win) {
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

// luminance range over a crop (flatness probe). Low range => near-uniform slab.
function lumRangeCrop(img, x0, y0, x1, y1) {
  let lo = 255, hi = 0, n = 0;
  const X1 = Math.min(img.width, x1), Y1 = Math.min(img.height, y1);
  for (let y = Math.max(0, y0); y < Y1; y += 2) for (let x = Math.max(0, x0); x < X1; x += 2) { const L = lumaAt(img, (y * img.width + x) * 4); if (L < lo) lo = L; if (L > hi) hi = L; n++; }
  return n ? hi - lo : 0;
}

// per-run "is this rendered invisible" — first-line strip, local-bg median, <1% contrasting glyph pixels.
// (Verbatim port of grade-structure.invisibleLocal so the heading veto reuses the trusted, FP-guarded logic.)
function invisibleLocal(img, f) {
  const x0 = Math.max(0, f.x), y0 = Math.max(0, f.y);
  const x1 = Math.min(img.width, f.x + f.w), y1b = Math.min(img.height, f.y + Math.min(f.h, Math.ceil((f.fsz || 16) * 1.8)));
  const lum = [];
  for (let y = y0; y < y1b; y += 2) for (let x = x0; x < x1; x += 2) lum.push(lumaAt(img, (y * img.width + x) * 4));
  if (lum.length < 50) return false; // strip too small to verify → conservative (do not fire)
  const sorted = lum.slice().sort((p, q) => p - q); const localBg = sorted[Math.floor(sorted.length / 2)];
  let glyph = 0; for (const L of lum) if (Math.abs(L - localBg) > 40) glyph++;
  return glyph / lum.length < 0.01;
}

// ---- tunables (named so the selftest can reason about them; all conservative — fire only on clear breakage) ----
export const VETO_DEFAULTS = {
  CEIL: 0.45,            // composite ceiling a fired veto imposes
  // wrong-logo
  HDR_X: 400, HDR_Y: 120, // header-logo crop (top-left)
  LOGO_SSIM_FLOOR: 0.35,  // logo crop SSIM below this = grossly different
  PAGE_OK_SSIM: 0.55,     // ...AND the rest of the page matches at least this (else it's a uniformly-broken page)
  // invisible-heading
  HEAD_FSZ: 18,           // heading-size threshold
  // broken-hero
  HERO_BAND_PX: 200,      // hero = top band(s)
  HERO_SSIM_FLOOR: 0.30,  // top-band SSIM at/below floor
  HERO_FLAT: 24,          // clone hero luminance-range below this = flat/empty slab
  HERO_SRC_MIN: 40,       // ...only if the SOURCE hero actually has content (range above this)
  // unstyled-CTA
  CTA_SAT: 0.20,          // accent saturation threshold (fg or bg)
  CTA_MIN_SRC: 1,         // source must have >=1 styled CTA for the veto to be eligible
};

const flagOff = (name) => process.env[`GRADER_NO_VETO_${name}`] === '1';

// ---- DETECTOR 1: wrong-logo ----------------------------------------------------------------------------------
// Crop the top-left header band from src & clone screenshots; SSIM them. A logo crop at FLOOR while the broader
// page matches well = the brand mark is swapped/missing. The page-OK guard prevents a uniformly-broken clone
// (whose whole page is wrong, logo included) from being mislabeled specifically as wrong-logo.
function detectWrongLogo(ctx, T) {
  if (flagOff('WRONGLOGO')) return null;
  const { srcShot, cloneShot, pageSSIM } = ctx;
  if (!srcShot || !cloneShot) return null;
  const x1 = Math.min(T.HDR_X, srcShot.width, cloneShot.width), y1 = Math.min(T.HDR_Y, srcShot.height, cloneShot.height);
  if (x1 < 16 || y1 < 16) return null;
  const logoSSIM = +ssimCrop(srcShot, cloneShot, 0, 0, x1, y1).toFixed(4);
  // require a measurable page baseline; if the whole page is broken this is not a *logo-specific* veto.
  const pageOk = (pageSSIM == null) ? null : pageSSIM >= T.PAGE_OK_SSIM;
  const fired = logoSSIM <= T.LOGO_SSIM_FLOOR && pageOk === true;
  const severity = fired ? +Math.min(1, (T.LOGO_SSIM_FLOOR - logoSSIM) / Math.max(1e-6, T.LOGO_SSIM_FLOOR) + 0.4).toFixed(3) : 0;
  return { veto: 'wrong-logo', fired, severity, evidence: { logoSSIM, pageSSIM: pageSSIM == null ? null : +pageSSIM.toFixed(4), pageOk, crop: { w: x1, h: y1 } } };
}

// ---- DETECTOR 2: invisible-heading ---------------------------------------------------------------------------
// contrastFails (ratio<1.3) narrowed to HEADING size, PIXEL-VERIFIED invisible against the clone screenshot.
function detectInvisibleHeading(ctx, T) {
  if (flagOff('INVISHEAD')) return null;
  const { cloneShot, contrastFails } = ctx;
  if (!cloneShot || !contrastFails) return null;
  const hits = contrastFails.filter((f) => f.ratio < 1.3 && (f.fsz || 0) >= T.HEAD_FSZ && f.w > 0 && f.h > 0 && invisibleLocal(cloneShot, f));
  const fired = hits.length >= 1;
  const severity = fired ? +Math.min(1, 0.5 + hits.length * 0.2).toFixed(3) : 0;
  return { veto: 'invisible-heading', fired, severity, evidence: { count: hits.length, runs: hits.slice(0, 4).map((f) => ({ y: f.y, fsz: f.fsz, ratio: f.ratio, text: (f.text || '').slice(0, 40) })) } };
}

// ---- DETECTOR 3: broken-hero ---------------------------------------------------------------------------------
// Top band near-empty/near-uniform on the clone WHILE the source hero has real content. Two independent signals
// (band SSIM at floor, OR clone hero flat with content-bearing source hero); either fires.
function detectBrokenHero(ctx, T) {
  if (flagOff('BROKENHERO')) return null;
  const { srcShot, cloneShot, bandSSIM, bandExact } = ctx;
  if (!cloneShot) return null;
  const hb = Math.min(T.HERO_BAND_PX, cloneShot.height);
  const cloneHeroRange = lumRangeCrop(cloneShot, 0, 0, cloneShot.width, hb);
  const srcHeroRange = srcShot ? lumRangeCrop(srcShot, 0, 0, srcShot.width, Math.min(T.HERO_BAND_PX, srcShot.height)) : T.HERO_SRC_MIN + 1; // no source → assume content
  const flatClone = cloneHeroRange < T.HERO_FLAT;
  const srcHasContent = srcHeroRange >= T.HERO_SRC_MIN;
  // band-fidelity signal (only when bands provided): top band SSIM AND exact both at floor = empty/wrong hero.
  const topSSIM = (bandSSIM && bandSSIM.length) ? bandSSIM[0] : null;
  const topExact = (bandExact && bandExact.length) ? bandExact[0] : null;
  const bandFloor = (topSSIM != null && topExact != null) ? (topSSIM <= T.HERO_SSIM_FLOOR && topExact <= 0.15) : false;
  const fired = (flatClone && srcHasContent) || (bandFloor && srcHasContent);
  const severity = fired ? +Math.min(1, 0.6 + (flatClone ? 0.3 : 0) + (bandFloor ? 0.1 : 0)).toFixed(3) : 0;
  return { veto: 'broken-hero', fired, severity, evidence: { cloneHeroRange: +cloneHeroRange.toFixed(1), srcHeroRange: +srcHeroRange.toFixed(1), flatClone, srcHasContent, topSSIM: topSSIM == null ? null : +topSSIM.toFixed(3), topExact: topExact == null ? null : +topExact.toFixed(3), bandFloor } };
}

// ---- DETECTOR 4: unstyled-CTA --------------------------------------------------------------------------------
// A CTA run (a/button/.elementor-widget-button) carries an accent if its fg OR bg is saturated (an accent fill or
// accent text). The veto fires when the SOURCE has >=CTA_MIN_SRC styled (accent) CTAs but the CLONE has ZERO —
// i.e. every clone CTA rendered with default grey/black-on-transparent styling. Requires ctaRuns on both sides;
// absent (older capture) → null (no-op, never a false positive).
function ctaIsStyled(run, T) {
  // styled = has an accent: saturated bg fill, OR saturated text colour, OR a visible non-transparent bg that is
  // not near-white/near-black (a deliberate fill). sat & lum are precomputed in capture(); fall back if absent.
  const bgSat = run.bgSat != null ? run.bgSat : 0, fgSat = run.fgSat != null ? run.fgSat : 0;
  const hasBgFill = !!run.hasBg; // bg alpha > 0.5 (a real fill, not transparent)
  const bgLum = run.bgLum != null ? run.bgLum : 1;
  const accentBg = hasBgFill && (bgSat > T.CTA_SAT || (bgLum > 0.05 && bgLum < 0.95 && bgSat > 0.10));
  const accentFg = fgSat > T.CTA_SAT;
  return accentBg || accentFg;
}
function detectUnstyledCTA(ctx, T) {
  if (flagOff('UNSTYLEDCTA')) return null;
  const { srcCtaRuns, cloneCtaRuns } = ctx;
  if (!srcCtaRuns || !cloneCtaRuns) return null; // signal not captured → no-op
  const srcStyled = srcCtaRuns.filter((r) => ctaIsStyled(r, T)).length;
  const cloneStyled = cloneCtaRuns.filter((r) => ctaIsStyled(r, T)).length;
  // eligible only if the source genuinely has styled CTAs and the clone has at least one CTA at all (else there's
  // nothing to compare — a clone with no CTA widgets is a coverage problem, handled by editability, not this veto).
  const fired = srcStyled >= T.CTA_MIN_SRC && cloneCtaRuns.length >= 1 && cloneStyled === 0;
  const severity = fired ? +Math.min(1, 0.5 + srcStyled * 0.1).toFixed(3) : 0;
  return { veto: 'unstyled-CTA', fired, severity, evidence: { srcCtas: srcCtaRuns.length, srcStyled, cloneCtas: cloneCtaRuns.length, cloneStyled } };
}

/**
 * runVetoes(ctx) — run all four detectors over the grade-time context.
 * ctx fields (all OPTIONAL; a detector returns null/no-op when its signal is absent):
 *   srcShot, cloneShot   : PNG objects ({width,height,data}) of the full-page source/clone screenshots
 *   pageSSIM             : page-level mean SSIM (for the wrong-logo page-OK guard)
 *   bandSSIM, bandExact  : per-200px-band arrays (for broken-hero)
 *   contrastFails        : clone ds.contrastFails [{fg,bg,ratio,fsz,x,y,w,h,text}] (for invisible-heading)
 *   srcCtaRuns, cloneCtaRuns : [{fgSat,bgSat,bgLum,hasBg}] CTA computed-style runs (for unstyled-CTA)
 *   tunables (optional)  : override VETO_DEFAULTS
 * Returns { fired:[{veto,severity,evidence}], all:[...every detector result incl. non-fired...] }.
 */
export function runVetoes(ctx = {}) {
  const T = { ...VETO_DEFAULTS, ...(ctx.tunables || {}) };
  const results = [
    detectWrongLogo(ctx, T),
    detectInvisibleHeading(ctx, T),
    detectBrokenHero(ctx, T),
    detectUnstyledCTA(ctx, T),
  ].filter(Boolean);
  return { fired: results.filter((r) => r.fired), all: results };
}

export default runVetoes;
