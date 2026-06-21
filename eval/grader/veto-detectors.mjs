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

// median fsz of body-range text runs (fsz<28) — derives the "is this run a hero heading" size threshold.
function medianBodyFsz(runs) {
  const fsz = (runs || []).map((t) => t.fsz || 0).filter((f) => f > 0 && f < 28).sort((a, b) => a - b);
  return fsz.length ? fsz[Math.floor(fsz.length / 2)] : 0;
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
  HERO_NAV_SKIP: 1,       // band 0 (top 200px) is the NAV on a tall capture — never inspected as the hero
  HERO_FOLD_PX: 1000,     // above-the-fold ≈ one 1440-wide viewport — the hero lives here
  HERO_BAND_MAX: 6,       // default scan window = bands [NAV_SKIP..BAND_MAX] (~200..1400px hero region) — deep enough
                          // to find the ADJACENT flat-band pair when a blanked hero starts a little below the nav
                          // (framer/linear blanks begin ~band 3.5; a [1..4] window saw only one flat band → no pair)
  HERO_EXACT_FLOOR: 0.15, // (legacy) bandExact conjunct
  HERO_CONTENT_GAP: 50,   // src-minus-clone luminance-range delta = "the clone DROPPED the band's content" (the
                          // robust replacement for the SSIM floor, which a shared white bg fools — see tripwire-seed)
  // content-void (DETECTOR 5: page-wide dropped-SECTION veto; shares bandDropSignal w/ broken-hero)
  VOID_MIN_PX: 400,            // absolute minimum void slab (2 bands)
  VOID_MIN_FRAC: 0.05,         // ...scaled to 5% of page height: floor = max(VOID_MIN_PX, VOID_MIN_FRAC·H)
  VOID_TAIL_SKIP: 2,           // tail-clamp: ignore the ragged bottom N bands (capture-height disagreement = a height defect, not a void)
  VOID_TEXT_CHARS: 80,         // TEXT path trigger: unreproduced source chars in the slab (a sparse section truly gone)
  VOID_TEXT_DOMINANT_CHARS: 40,// a band is "text-dominant" (eligible for the reflow text-guard) at >= this many non-boilerplate chars
  VOID_TEXT_MATCH_FRAC: 0.5,   // text-guard: a band is "relocated, not dropped" when >= this frac of its runs are reproduced in the clone
  VOID_BOILERPLATE_BANDS: 3,   // source text appearing in >= this many bands = nav/footer chrome (excluded from the text-guard)
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
// A hero band near-empty/near-uniform on the clone WHILE the co-located SOURCE band has real content. The legacy
// rule inspected a FIXED top-200px band — but on a tall full-page capture that band is the NAV, not the hero, which
// caused BOTH a miss (a hero blanked BELOW the nav was invisible) and a false-positive (a flat dark nav read as a
// broken hero). The default rule now SKIPS the nav band, locates the hero below it (anchored to the source's first
// large heading when text positions are plumbed, else a nav-skipped above-the-fold scan), and fires ONLY on a
// contiguous blank SLAB: two ADJACENT bands each FLAT-on-clone AND source-has-content AND fidelity-at-floor. The
// mandatory bandFloor (SSIM) conjunct is the FP guard — a faithful dark/photo hero matches its source (high SSIM)
// so it never fires, while a genuinely blank hero bottoms out and still does. Reversible: GRADER_BROKEN_HERO_LEGACY=1
// restores the byte-identical band-0 rule. (fusion-locked 2026-06-20; validated by tripwire-seed on labeled ladders.)
function detectBrokenHero(ctx, T) {
  if (flagOff('BROKENHERO')) return null;
  const { srcShot, cloneShot, bandSSIM, bandExact, srcTextPositions } = ctx;
  if (!cloneShot) return null;

  // LEGACY band-0 rule (byte-identical to the pre-2026-06-20 behavior) behind a revert flag.
  if (process.env.GRADER_BROKEN_HERO_LEGACY === '1') {
    const hb = Math.min(T.HERO_BAND_PX, cloneShot.height);
    const cloneHeroRange = lumRangeCrop(cloneShot, 0, 0, cloneShot.width, hb);
    const srcHeroRange = srcShot ? lumRangeCrop(srcShot, 0, 0, srcShot.width, Math.min(T.HERO_BAND_PX, srcShot.height)) : T.HERO_SRC_MIN + 1;
    const flatClone = cloneHeroRange < T.HERO_FLAT, srcHasContent = srcHeroRange >= T.HERO_SRC_MIN;
    const topSSIM = (bandSSIM && bandSSIM.length) ? bandSSIM[0] : null, topExact = (bandExact && bandExact.length) ? bandExact[0] : null;
    const bandFloor = (topSSIM != null && topExact != null) ? (topSSIM <= T.HERO_SSIM_FLOOR && topExact <= 0.15) : false;
    const fired = (flatClone && srcHasContent) || (bandFloor && srcHasContent);
    return { veto: 'broken-hero', fired, severity: fired ? +Math.min(1, 0.6 + (flatClone ? 0.3 : 0) + (bandFloor ? 0.1 : 0)).toFixed(3) : 0, evidence: { legacy: true, cloneHeroRange: +cloneHeroRange.toFixed(1), srcHeroRange: +srcHeroRange.toFixed(1), flatClone, srcHasContent, bandFloor } };
  }

  // NEW hero-scan rule. Requires a source to compare against (gate always has both shots); absent → no-op (never
  // fire blind). The scan is bounded — conservatism comes from the per-band three-way AND + the adjacency slab.
  if (!srcShot) return { veto: 'broken-hero', fired: false, severity: 0, evidence: { rule: 'hero-scan', note: 'no source', cloneHeroRange: 0, srcHeroRange: 0, flatClone: false, srcHasContent: false, bandFloor: false } };
  const BAND = T.HERO_BAND_PX;
  const H = Math.min(srcShot.height, cloneShot.height), Wm = Math.min(srcShot.width, cloneShot.width), nb = Math.floor(H / BAND);
  if (nb < T.HERO_NAV_SKIP + 2) return { veto: 'broken-hero', fired: false, severity: 0, evidence: { rule: 'hero-scan', note: 'capture too short', nb, cloneHeroRange: 0, srcHeroRange: 0, flatClone: false, srcHasContent: false, bandFloor: false } };

  // hero WINDOW: a nav-skipped above-the-fold scan by default (proven 0% miss on the ladders). The heading-anchored
  // variant is gated OFF (GRADER_HERO_HEADING_ANCHOR=1) — it needs a downward-extension refinement before it can
  // replace the default without regressing below-headline blanks (the fusion's named next step). Gating it means
  // plumbing source text for the content-void guard does NOT silently change broken-hero's window.
  let window = null;
  if (process.env.GRADER_HERO_HEADING_ANCHOR === '1' && Array.isArray(srcTextPositions) && srcTextPositions.length) {
    const bodyFsz = medianBodyFsz(srcTextPositions) || 16;
    const heads = srcTextPositions
      .filter((t) => (t.y + (t.h || 0)) > BAND && t.y < T.HERO_FOLD_PX && (t.fsz || 0) >= Math.max(28, 1.55 * bodyFsz) && String(t.text || '').trim().length >= 3 && (t.w || 0) >= 0.12 * srcShot.width)
      .sort((a, b) => a.y - b.y || (b.fsz || 0) - (a.fsz || 0));
    if (heads.length) { const anchor = Math.max(T.HERO_NAV_SKIP, Math.floor(heads[0].y / BAND)); window = []; for (let b = Math.max(T.HERO_NAV_SKIP, anchor - 1); b <= Math.min(nb - 1, anchor + 1); b++) window.push(b); }
  }
  if (!window) { window = []; for (let b = T.HERO_NAV_SKIP; b <= Math.min(nb - 1, T.HERO_BAND_MAX); b++) window.push(b); }

  // per-band breakage via the SHARED bandDropSignal primitive (flat-on-clone AND src-has-content AND a large
  // luminance-RANGE delta — NOT SSIM, which a shared bg fools; tripwire-seed-driven). content-void reuses the same.
  const broken = {}, ranges = {};
  for (const b of window) {
    const d = bandDropSignal(srcShot, cloneShot, b, T, srcTextPositions);
    ranges[b] = { cl: d.clR, sr: d.srR };
    broken[b] = d.dropped;
  }
  // fire ONLY on two ADJACENT broken bands (≥400px contiguous blank slab) — a lone band or a benign shift won't trip.
  let fired = false, slab = null;
  for (let i = 0; i < window.length - 1; i++) { const b = window[i]; if (window[i + 1] === b + 1 && broken[b] && broken[b + 1]) { fired = true; slab = [b, b + 1]; break; } }
  const brokenBands = window.filter((b) => broken[b]);
  const eb = window[0], cloneHeroRange = ranges[eb] ? ranges[eb].cl : 0, srcHeroRange = ranges[eb] ? ranges[eb].sr : 0;
  return {
    veto: 'broken-hero', fired,
    severity: fired ? +Math.min(1, 0.6 + brokenBands.length * 0.1).toFixed(3) : 0,
    evidence: { rule: 'hero-scan', window: [window[0], window[window.length - 1]], brokenBands, slab, cloneHeroRange, srcHeroRange, flatClone: cloneHeroRange < T.HERO_FLAT, srcHasContent: srcHeroRange >= T.HERO_SRC_MIN, contentGap: +(srcHeroRange - cloneHeroRange).toFixed(1) },
  };
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

// ---- SHARED PRIMITIVE: per-band "the clone dropped this band's content" ---------------------------------------
// flat-on-clone AND source-had-content AND a large luminance-RANGE delta (NOT SSIM — a shared dominant bg fools
// SSIM: blanking a light section to white is pixel-similar to a sparse white-with-text source). ONE source of
// truth so broken-hero (hero window) and content-void (page-wide) can never drift on the core signal.
function bandDropSignal(srcShot, cloneShot, b, T, srcTextPositions) {
  const BAND = T.HERO_BAND_PX, H = Math.min(srcShot.height, cloneShot.height);
  const y0 = b * BAND, y1 = Math.min(H, y0 + BAND);
  const clR = lumRangeCrop(cloneShot, 0, y0, cloneShot.width, y1);
  const srR = lumRangeCrop(srcShot, 0, y0, srcShot.width, y1);
  const flatClone = clR < T.HERO_FLAT;
  const srcHasContent = srR >= T.HERO_SRC_MIN || (Array.isArray(srcTextPositions) && srcTextPositions.some((t) => String(t.text || '').trim() && t.y < y1 && (t.y + (t.h || 0)) > y0));
  const contentDropped = (srR - clR) >= T.HERO_CONTENT_GAP;
  return { dropped: flatClone && srcHasContent && contentDropped, clR: +clR.toFixed(1), srR: +srR.toFixed(1), flatClone, srcHasContent, contentDropped };
}

// ---- DETECTOR 5: content-void --------------------------------------------------------------------------------
// (fusion-locked 2026-06-21) A whole SECTION blanked in place: the clone renders a band as the page background
// while the source had content there. broken-hero owns the dense hero (bands 1–6); this owns the page BELOW it.
// Fires on a contiguous flat-over-content SLAB clearing a page-relative floor [max(400px, 5%·H)], via a VISUAL
// path (>=2 dropped bands the text-guard did NOT explain) OR a TEXT path (source text in the slab truly gone from
// the clone). The #1 page-wide FP is REFLOW (a sparse section reproduced lower → clone reads flat at the source
// position): the default-on TEXT-REFLOW GUARD strikes any dropped band whose (non-boilerplate, text-dominant)
// source text reappears anywhere in the clone. Scope = blanked-IN-PLACE only (a removed section that shortens the
// page is a HEIGHT defect, owned elsewhere). Reversible: GRADER_NO_VETO_CONTENTVOID=1.
const _normText = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function _srcRunsInBand(srcTextPositions, b, BAND) {
  const y0 = b * BAND, y1 = y0 + BAND;
  return (srcTextPositions || []).filter((t) => _normText(t.text).length >= 4 && t.y < y1 && (t.y + (t.h || 0)) > y0);
}
function detectContentVoid(ctx, T) {
  if (flagOff('CONTENTVOID')) return null;
  const { srcShot, cloneShot, srcTextPositions, cloneTextRuns } = ctx;
  if (!srcShot || !cloneShot) return null; // never fire blind
  const BAND = T.HERO_BAND_PX, H = Math.min(srcShot.height, cloneShot.height);
  const lastBand = Math.floor(H / BAND) - 1 - T.VOID_TAIL_SKIP;
  if (lastBand < 8) return { veto: 'content-void', fired: false, severity: 0, evidence: { note: 'page too short for a below-hero void', lastBand } };
  const reqPx = Math.max(T.VOID_MIN_PX, Math.round(T.VOID_MIN_FRAC * H));
  const startBand = T.HERO_BAND_MAX; // 6 — a deliberate 1-band overlap w/ broken-hero (closes the 6/7 seam; the gate cap is idempotent)

  // boilerplate = normed source text recurring across >= VOID_BOILERPLATE_BANDS bands (nav/footer chrome).
  const bandsOf = new Map();
  for (const t of (srcTextPositions || [])) { const n = _normText(t.text); if (n.length < 4) continue; const bi = Math.floor((t.y + (t.h || 0) / 2) / BAND); if (!bandsOf.has(n)) bandsOf.set(n, new Set()); bandsOf.get(n).add(bi); }
  const boiler = new Set([...bandsOf.entries()].filter(([, s]) => s.size >= T.VOID_BOILERPLATE_BANDS).map(([n]) => n));
  const cloneBlob = (cloneTextRuns || []).map((t) => _normText(typeof t === 'string' ? t : t && t.text)).join('  ');
  const reproduced = (n) => n.length >= 4 && cloneBlob.includes(n);

  // TEXT-REFLOW GUARD: a dropped band is "relocated" (struck from evidence) iff it was text-DOMINANT and its
  // non-boilerplate text is reproduced in the clone. A textless/image band is never suppressed → stays VISUAL.
  const textExplained = (b) => {
    const runs = _srcRunsInBand(srcTextPositions, b, BAND).map((t) => _normText(t.text)).filter((n) => !boiler.has(n));
    const chars = runs.reduce((a, n) => a + n.length, 0);
    if (chars < T.VOID_TEXT_DOMINANT_CHARS) return false; // not text-dominant → the visual path owns it
    const repr = runs.filter(reproduced).length;
    return runs.length > 0 && repr / runs.length >= T.VOID_TEXT_MATCH_FRAC;
  };
  const unrepInSlab = (t, bot) => {
    const seen = new Set(); let chars = 0, runsN = 0;
    for (let b = t; b <= bot; b++) for (const n of _srcRunsInBand(srcTextPositions, b, BAND).map((x) => _normText(x.text))) {
      if (boiler.has(n) || seen.has(n) || reproduced(n)) continue; seen.add(n); chars += n.length; runsN++;
    }
    return { unrepChars: chars, unrepRuns: runsN };
  };

  const dropped = {}, evid = {};
  for (let b = startBand; b <= lastBand; b++) { const d = bandDropSignal(srcShot, cloneShot, b, T, srcTextPositions); dropped[b] = d.dropped; evid[b] = d.dropped && !textExplained(b); }

  let best = null;
  for (let b = startBand; b <= lastBand;) {
    if (!dropped[b]) { b++; continue; }
    const t = b; while (b <= lastBand && dropped[b]) b++; const bot = b - 1;
    const slabPx = (bot - t + 1) * BAND;
    let evBands = 0; for (let k = t; k <= bot; k++) if (evid[k]) evBands++;
    const { unrepChars, unrepRuns } = unrepInSlab(t, bot);
    if (slabPx >= reqPx && (evBands >= 2 || (unrepChars >= T.VOID_TEXT_CHARS && unrepRuns >= 2))) {
      if (!best || slabPx > best._px) best = { veto: 'content-void', fired: true, severity: +Math.min(1, 0.6 + 0.4 * Math.min(1, slabPx / (0.4 * H))).toFixed(3), _px: slabPx, evidence: { slab: [t, bot], slabPx, voidFrac: +(slabPx / H).toFixed(3), evBands, unrepChars, path: evBands >= 2 ? 'visual' : 'text' } };
    }
  }
  if (best) { delete best._px; return best; }
  return { veto: 'content-void', fired: false, severity: 0, evidence: { reqPx, scanned: [startBand, lastBand] } };
}

/**
 * runVetoes(ctx) — run all FIVE detectors over the grade-time context.
 * ctx fields (all OPTIONAL; a detector returns null/no-op when its signal is absent):
 *   srcShot, cloneShot   : PNG objects ({width,height,data}) of the full-page source/clone screenshots
 *   pageSSIM             : page-level mean SSIM (for the wrong-logo page-OK guard)
 *   bandSSIM, bandExact  : per-200px-band arrays (for broken-hero)
 *   contrastFails        : clone ds.contrastFails [{fg,bg,ratio,fsz,x,y,w,h,text}] (for invisible-heading)
 *   srcCtaRuns, cloneCtaRuns : [{fgSat,bgSat,bgLum,hasBg}] CTA computed-style runs (for unstyled-CTA)
 *   srcTextPositions     : source text runs [{x,y,w,h,fsz,text}] (for broken-hero heading-anchor + content-void text-guard)
 *   cloneTextRuns        : clone text runs [{text}] or [string] (for content-void's text-reflow guard)
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
    detectContentVoid(ctx, T),
  ].filter(Boolean);
  return { fired: results.filter((r) => r.fired), all: results };
}

export default runVetoes;
