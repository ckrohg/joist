#!/usr/bin/env node
/**
 * @purpose STANDALONE per-element visual-fidelity diagnostic for the Joist cloner. Reveals what the
 * SSIM-based composite visual term has been MASKING. SSIM is provably saturated/blind to per-element
 * color/typography/spacing/position errors (visual ~0.82 won't budge under 5 visual fixes). Design2Code
 * (Stanford, NAACL 2025) solved this with a block-matched per-element metric. Our advantage: capture-layout.mjs
 * already produces a TYPED box-tree (nodes with x/y/w/h + typography + colors) for ANY url — so we match
 * nodes DIRECTLY with NO OCR.
 *
 * ZERO BLAST RADIUS: this is a NEW standalone module. It does NOT modify grade-sections.mjs or any existing
 * scoring. It does NOT flip the composite. It is the evidence base for a SUPERVISED composite-flip.
 *
 * Pipeline:
 *   1) run capture-layout.mjs on BOTH urls -> two typed box-trees; flatten to leaf+container nodes.
 *   2) MATCH source<->clone via Hungarian linear-sum-assignment on
 *        cost = w1*(1-textDice) + w2*(1-typeMatch) + w3*centerDistNorm.
 *      FILTER any matched pair whose text-similarity < 0.5 (treat as unmatched) — exactly Design2Code.
 *   3) per matched pair: COLOR (CIEDE2000 dE, perceptual map full<=2 / zero>=10), TYPOGRAPHY (family-heavy
 *      weighted family+size+weight+lineHeight), POSITION (1 - clamp(max(|dcx|,|dcy|)/refDim)), TEXT (Dice),
 *      EFFECTS (agreement of {border-radius relative-px, box-shadow presence+rough offset/blur/color, backdrop-
 *      filter/blur presence} — symmetric; null when the pair carries no effect signal).
 *   4) aggregate each sub-score as mean over matched pairs, then MULTIPLY by SYMMETRIC area-coverage =
 *        matchedArea / (matchedArea + unmatchedSrcArea + unmatchedCloneArea).
 *      Report color/typography/position/text/effects/areaCoverage SEPARATELY (never one scalar).
 *      EFFECTS folds into the perElement blend upstream (grade-sections.mjs) at a MODEST weight (0.12, color
 *      stays dominant); GRADER_NO_EFFECTS=1 there restores the exact prior 0.35/0.25/0.20/0.20 blend.
 *   5) print JSON + write /tmp/pe-<name>.json.
 *
 * SELF-TEST (anti-fake-grade rail): node perelement-score.mjs --source <url> --selftest  -> clone=source,
 *   EVERY sub-score MUST be 1.0. If any != ~1.0 the metric is asymmetric/buggy.
 *
 * Usage:
 *   node perelement-score.mjs --source <url> --clone <url> [--name tag] [--width 1440]
 *   node perelement-score.mjs --source <url> --selftest
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const source = arg('source');
const SELFTEST = has('selftest');
const clone = SELFTEST ? source : arg('clone');
const width = parseInt(arg('width', '1440'), 10);
const nameTag = arg('name') || (source || 'site').replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 14).toLowerCase();
if (!source || (!clone && !SELFTEST)) { console.error('need --source --clone (or --source --selftest)'); process.exit(2); }

// ---- REVERSIBLE GLOBAL-UNIFORM-Y-SCALE FIX (SUPERVISED, anti-game-controlled false-deflation fix) ----
// CONFIRMED ASYMMETRIC false-deflation (perelement-ydrift-diagnostic): the Hungarian matcher normalizes
// centerDist by refH=max(srcPageH,clonePageH) and gates textless containers on geomOk (center within 0.25).
// A clone that is uniformly y-STRETCHED (hRatio>1, e.g. supabase 1.486 — same content, just taller) inflates
// refH AND pushes its big page-spanning textless containers out of the geomOk gate → they dump into
// unmatchedCloneArea → areaCoverage COLLAPSES (supabase 0.087) → multiplicatively crushes color/typo/text
// DESPITE raw text=1.0 / color 0.56 / ssim 0.897. Proven: y-normalizing recovers areaCoverage 0.087→0.437
// and color 0.048→0.233; a SHUFFLED-y control stays crushed at ~0.040 (NOT rescued — the guard below holds).
//
// THE FIX (two-pass): estimate ONE GLOBAL UNIFORM scalar y-scale `s` (the multiply-factor applied to CLONE
// y-coords so that scaled cloneCy ≈ srcCy — i.e. s≈1/hRatio≈0.673 for supabase). PASS 1: apply s to clone
// cy/y/h BEFORE the cost matrix + recompute refH on the scaled clone height; match + areaCoverage +
// color/typo/text (all y-INDEPENDENT content props — crediting them on the uniform-scale-aligned match IS
// the correction). PASS 2: compute the POSITION sub-score on the RAW (un-scaled) boxes over that same matched
// set, so the vertical drift is STILL penalized in the position channel. hRatio + responsive (computed in
// grade-sections.mjs) are UNTOUCHED → they keep penalizing the stretch at the composite level.
// GUARD: a SINGLE global scalar only (NEVER per-node y-shifts) → a genuinely mis-positioned (shuffled-y)
// clone is NOT rescued (its anchors disagree → no robust fit → pageH fallback aligns only the global span,
// not the scrambled internal order, so areaCoverage stays crushed).
// Default ON. GRADER_NO_YSCALE=1 → s forced to 1 (EXACT prior behavior, byte-for-byte).
const USE_YSCALE = !process.env.GRADER_NO_YSCALE;
const YSCALE_MIN = 0.5, YSCALE_MAX = 2.0;   // cap s to a plausible uniform stretch/squash
const YSCALE_NOOP = 0.06;                   // |1 - s| < this → no real stretch → s = 1 (no-op)
const YSCALE_ANCHOR_DICE = 0.6;             // text-Dice threshold for a trustworthy anchor pair
const YSCALE_INLIER_TOL = 0.08;             // anchor ratios must agree within ±8% to trust the robust fit
// ANTI-GAME VALIDATION GATE (the hard guard): an estimated scale is APPLIED only if, after scaling, the
// content anchors actually LINE UP — proving the single scalar explains the alignment (a real uniform
// stretch). A shuffled/reversed (genuinely mis-positioned) clone fails this even when its pageH ratio
// happens to match, because no single scale can re-order scrambled content. Measured separation on supabase:
// HONEST medResid 0.176 / frac@15% 0.353 ; REVERSE 0.347/0.044 ; SHUF 0.32-0.36/0.22-0.25.
const YSCALE_VALID_MEDRESID = 0.25;         // median scaled-anchor residual (÷refH) must be BELOW this
const YSCALE_VALID_INLIER_FRAC = 0.30;      // ≥30% of anchors must align within YSCALE_VALID_TOL after scaling
const YSCALE_VALID_TOL = 0.15;              // per-anchor scaled-residual tolerance (÷refH) for the inlier count
const median = (xs) => { if (!xs.length) return null; const a = xs.slice().sort((p, q) => p - q); const n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; };

// ============================ COLOR: sRGB -> Lab (D65) + CIEDE2000 ============================
// Ported / verified against the Sharma et al. reference test data (the 34 canonical pairs).
// sRGB (0..255) -> linear -> XYZ (D65) -> CIE L*a*b*.
function srgbToLab(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  // sRGB D65 matrix
  let X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  let Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
  let Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041;
  // D65 reference white
  X /= 0.95047; Y /= 1.00000; Z /= 1.08883;
  const f = (t) => t > 0.008856451679035631 ? Math.cbrt(t) : (7.787037037037037 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// CIEDE2000 — faithful port of the Sharma/Wu/Dalal (2005) reference formulation.
function ciede2000(lab1, lab2) {
  const [L1, a1, b1] = lab1, [L2, a2, b2] = lab2;
  const deg2rad = (d) => d * Math.PI / 180, rad2deg = (r) => r * 180 / Math.PI;
  const kL = 1, kC = 1, kH = 1;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  let h1p = rad2deg(Math.atan2(b1, a1p)); if (h1p < 0) h1p += 360;
  let h2p = rad2deg(Math.atan2(b2, a2p)); if (h2p < 0) h2p += 360;
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp;
  if (C1p * C2p === 0) dhp = 0;
  else { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(deg2rad(dhp) / 2);
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else { if (Math.abs(h1p - h2p) > 180) hbarp = (h1p + h2p + 360) / 2; else hbarp = (h1p + h2p) / 2; }
  const T = 1 - 0.17 * Math.cos(deg2rad(hbarp - 30)) + 0.24 * Math.cos(deg2rad(2 * hbarp))
    + 0.32 * Math.cos(deg2rad(3 * hbarp + 6)) - 0.20 * Math.cos(deg2rad(4 * hbarp - 63));
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Cbarp ** 7;
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(deg2rad(2 * dTheta)) * RC;
  const dE = Math.sqrt(
    (dLp / (kL * SL)) ** 2 +
    (dCp / (kC * SC)) ** 2 +
    (dHp / (kH * SH)) ** 2 +
    RT * (dCp / (kC * SC)) * (dHp / (kH * SH))
  );
  return dE;
}

// parse any css color string -> [r,g,b] (0..255). null if unparseable / fully transparent.
function parseColor(s) {
  if (!s || typeof s !== 'string') return null;
  s = s.trim();
  let m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i);
  if (m) { const a = m[4] === undefined ? 1 : parseFloat(m[4]); if (a < 0.04) return null; return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])]; }
  m = s.match(/^#([0-9a-f]{3})$/i); if (m) { const h = m[1]; return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]; }
  m = s.match(/^#([0-9a-f]{6})$/i); if (m) { const h = m[1]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  m = s.match(/^#([0-9a-f]{8})$/i); if (m) { const h = m[1]; const a = parseInt(h.slice(6, 8), 16) / 255; if (a < 0.04) return null; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  if (/^transparent$/i.test(s)) return null;
  return null;
}

// COLOR sub-score: dE2000 between source & clone color, mapped perceptually
// full credit <= dE 2, zero >= dE 10 → clamp(0,1, 1 - dE/10) but with the <=2 floor giving full credit.
function colorScore(srcCol, cloneCol) {
  const a = parseColor(srcCol), b = parseColor(cloneCol);
  if (!a && !b) return null;             // neither node has a paintable color → not a color signal
  if (!a || !b) return 0;                // one has color, the other doesn't → full mismatch
  const dE = ciede2000(srgbToLab(...a), srgbToLab(...b));
  if (dE <= 2) return 1;
  return Math.max(0, Math.min(1, 1 - dE / 10));
}

// ============================ FADE-IN CAPTURE-ARTIFACT RECOVERY (COLOR) ============================
// @purpose Stop the per-element COLOR sub-score from FALSE-DEFLATING on scroll-reveal elements the capture read
// MID-TRANSITION. supabase (and any AOS/IntersectionObserver fade-in site) animates feature-card labels from
// opacity/color 0 → settled on scroll-into-view. capture-layout sets reducedMotion:'reduce', but the clone is a
// rebuilt WP/Elementor page whose reveal is JS-driven (NOT a prefers-reduced-motion-aware CSS rule), so the
// step-scroll can sample an element WHILE its color transition is still running. The captured clone color is then
// the FADE-IN COMPOSITE of the element's true settled color over the page background:
//     captured ≈ t·settled + (1−t)·pageBg ,  t ∈ [0,1)   (t=opacity-ish; t→1 = settled, t→0 = invisible)
// PROVEN on supabase clone (page 2986): "Authentication" captured rgb(223,223,223) [BOTH cs.color AND glyphRGB],
// live getComputedStyle returns the SETTLED rgb(23,23,23) — which MATCHES the source rgb(23,23,23). 13 feature
// labels show the same signature (clone = a lighter achromatic interpolation of the dark source toward white bg).
//
// THE RECOVERY (asymmetric, clone-side only, anchored to the SOURCE's settled color — NOT a free pass):
//   credit the pair as a match IFF the captured CLONE color lies ON the segment from the SOURCE's settled color to
//   THIS page's background, strictly BETWEEN them (a fade-IN), i.e. there is a single t with
//       clone ≈ t·source + (1−t)·pageBg ,  FADE_T_LO ≤ t ≤ FADE_T_HI  (t<1: not yet settled; t>FLOOR: not invisible)
//   AND the off-segment residual is small (clone is genuinely COLLINEAR with source→bg, not merely lighter).
// This is a CAPTURE-ARTIFACT correction, not an inflation:
//   • the recovery TARGET is the SOURCE color → a clone whose TRUE settled color differs from source is NOT on the
//     source→bg segment, so it is NOT recovered (anti-gaming: shift clone colors by a delta → off-segment → no credit).
//   • DIRECTIONAL: t∈[0,1) means clone is strictly between source and bg (faded toward bg). t≥1 (clone darker than /
//     past source) or t≤0 (clone past bg) → NOT a fade-in → no credit. (kills "trusted by…" src[112]→clone[23], t=1.6.)
//   • COLLINEAR: a different-HUE clone (e.g. green span lost: src[63,207,142]→clone[23,23,23]) is far off the
//     source→bg line (large residual) → no credit. Only an on-axis fade is recovered.
//   • IDENTITY: source-vs-source → clone==source → colorScore already returns 1.0 (dE≤2) before recovery is consulted
//     → no-op on the self-test. REVERSIBLE: GRADER_NO_FADERECOVER=1 → exact prior colorScore behavior.
const USE_FADE_RECOVER = process.env.GRADER_NO_FADERECOVER !== '1';
// COLOR-CHANNEL DE-CONFLATION (default ON; =1 → exact prior color behavior). The COLOR sub-score answers "of the
// content matched on BOTH sides, how faithful are the colors?" — a question SEPARATE from "how COMPLETE is the
// page" (already measured by areaCoverage + the composite's structuralFidelity term). The prior code conflated the
// two: (1) it folded one-sided-color pairs (a structural/coverage miss) into the color mean as hard-0s, and (2) it
// MULTIPLIED the color mean by areaCoverage — double-counting completeness INSIDE the color channel. On supabase
// that crushed a ~0.81 true text-color fidelity to 0.26 (the diagnosed false-deflation). De-conflation = drop
// one-sided pairs from the color mean (handled at the pair loop) AND report color = raw color fidelity (no second
// areaCoverage multiply). typography/position/text/effects are UNTOUCHED (still × areaCoverage). Self-test is a
// no-op (colorRaw=1, coverage=1 → 1 either way). Anti-gaming: a wrong-color clone keeps a LOW colorRaw → low color.
const USE_COLOR_DECONFLATE = process.env.GRADER_NO_COLOR_DECONFLATE !== '1';
// TYPOGRAPHY-CHANNEL DE-CONFLATION (default ON; GRADER_NO_TYPO_DECONFLATE=1 → exact prior × areaCoverage). The TYPO
// sub-score answers "of the TEXT matched on BOTH sides, how faithful is the typography (family/size/weight/line-
// height)?" — SEPARATE from "how COMPLETE is the page" (already measured by areaCoverage + the composite's
// structuralFidelity term). The prior code MULTIPLIED the typo mean by areaCoverage, the IDENTICAL double-count COLOR
// had before its fix: a genuine 0.84–0.92 typoRaw was crushed to 0.13–0.28 on framer (areaCoverage 0.12–0.34 because
// framer is a tall image/section-heavy page the builder only partly reproduces). De-conflation = report typo = raw
// typo fidelity of matched pairs (no second areaCoverage multiply). Self-test is a no-op (typoRaw=1, coverage=1 → 1
// either way). Anti-gaming: a wrong-FONT clone keeps a LOW typoRaw (family/size/weight mismatch) → low typo regardless
// of coverage — de-conflation removes a completeness penalty, it does NOT add credit a mismatched font hasn't earned.
const USE_TYPO_DECONFLATE = process.env.GRADER_NO_TYPO_DECONFLATE !== '1';
// POSITION / TEXT / EFFECTS DE-CONFLATION (default ON; GRADER_NO_{POS,TEXT,EFFECTS}_DECONFLATE=1 → exact prior
// × areaCoverage). IDENTICAL double-count + IDENTICAL fix that already freed COLOR and TYPOGRAPHY: position/text/
// effects each answer "of the content matched on BOTH sides, how faithful is the placement / text-content / motion-
// effect?" — SEPARATE from "how COMPLETE is the page" (already measured by areaCoverage as its own reported dim AND,
// in the composite, by the structuralFidelity block-type-credit term). The prior code MULTIPLIED each mean by
// areaCoverage, halving a 0.98 posRaw / 0.99 textRaw / 0.75 effRaw to ~0.46/0.46/0.35 on resend (coverage 0.466)
// purely because the page is partly reproduced — the same false-deflation color/typo had. De-conflation = report the
// RAW matched-pair fidelity (no second areaCoverage multiply). Self-test no-op (raw=1, coverage=1 → 1 either way).
// Anti-gaming: wrong-position / wrong-text / wrong-effects clones keep LOW posRaw/textRaw/effRaw → low sub-score
// regardless of coverage. coverage stays its OWN reported dim (areaCoverage below) — completeness is NOT lost.
const USE_POS_DECONFLATE = process.env.GRADER_NO_POS_DECONFLATE !== '1';
const USE_TEXT_DECONFLATE = process.env.GRADER_NO_TEXT_DECONFLATE !== '1';
const USE_EFFECTS_DECONFLATE = process.env.GRADER_NO_EFFECTS_DECONFLATE !== '1';
const FADE_T_LO = 0.04;     // clone must be >4% toward settled (not fully invisible / pure-bg)
const FADE_T_HI = 0.985;    // and < ~settled (a real fade-in, not the settled color itself — that path = colorScore 1.0)
const FADE_RESID_MAX = 10;  // max per-channel deviation (0..255) from the predicted on-segment point → "collinear"
// is the captured CLONE color the fade-in composite of the SOURCE settled color over pageBg? returns the recovered
// per-pair score (1 when a clean fade-in match, else null = "not a fade artifact, score normally").
function fadeRecoverScore(srcCol, cloneCol, pageBg) {
  if (!USE_FADE_RECOVER || !pageBg) return null;
  const src = parseColor(srcCol), clone = parseColor(cloneCol);
  if (!src || !clone) return null;
  // solve t per-channel where the source↔bg axis has enough spread to be meaningful, then average.
  const ts = [];
  for (let k = 0; k < 3; k++) { const den = src[k] - pageBg[k]; if (Math.abs(den) >= 8) ts.push((clone[k] - pageBg[k]) / den); }
  if (!ts.length) return null;                                   // source ≈ pageBg on every channel → no fade axis
  const t = ts.reduce((s, x) => s + x, 0) / ts.length;
  if (t < FADE_T_LO || t > FADE_T_HI) return null;               // not strictly between bg and settled-source → not a fade-in
  // residual: distance from the predicted on-segment point (clone must be COLLINEAR with source→bg, not off-hue).
  let resid = 0;
  for (let k = 0; k < 3; k++) { const pred = t * src[k] + (1 - t) * pageBg[k]; resid = Math.max(resid, Math.abs(pred - clone[k])); }
  if (resid > FADE_RESID_MAX) return null;                       // off the source→bg line → genuine mismatch, no credit
  return 1;                                                      // clean fade-in composite of the SOURCE color → recovered match
}
// COLOR sub-score with fade-in capture-artifact recovery: normal colorScore, but if it scored a MISS (< full credit)
// AND the clone color is a clean fade-in composite of the SOURCE color over pageBg, credit the recovered match.
function colorScoreFadeAware(srcCol, cloneCol, pageBg) {
  const base = colorScore(srcCol, cloneCol);
  if (base == null || base >= 1) return base;                    // null (no signal) or already a full match → as-is
  const rec = fadeRecoverScore(srcCol, cloneCol, pageBg);
  return rec != null ? Math.max(base, rec) : base;
}

// ============================ TEXT: Sorensen-Dice on bigrams ============================
const normText = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function dice(a, b) {
  a = normText(a); b = normText(b);
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const ma = grams(a), mb = grams(b);
  let inter = 0, na = 0, nb = 0;
  for (const v of ma.values()) na += v;
  for (const [g, v] of mb) { nb += v; if (ma.has(g)) inter += Math.min(v, ma.get(g)); }
  return (2 * inter) / (na + nb);
}

// ============================ TYPOGRAPHY: weighted family+size+weight+lineHeight ============================
const normFamily = (f) => (f || '').toLowerCase().replace(/['"]/g, '').split(',')[0].trim();
const numWeight = (w) => { if (w == null) return 400; const map = { normal: 400, bold: 700, lighter: 300, bolder: 700 }; if (map[w] != null) return map[w]; const n = parseInt(w, 10); return isNaN(n) ? 400 : n; };
function parsePx(v) { if (v == null) return null; if (typeof v === 'number') return v; const m = String(v).match(/([\d.]+)px/); if (m) return parseFloat(m[1]); const f = parseFloat(v); return isNaN(f) ? null : f; }
// lineHeight may be "normal", "24px", or a unitless ratio. Resolve to a px-ish ratio relative to font size.
function lineHeightRatio(typo) {
  if (!typo) return null;
  const lh = typo.lineHeight, sz = parsePx(typo.size);
  if (lh == null || lh === 'normal') return 1.2;
  const px = parsePx(lh);
  if (px != null && sz) return px / sz;
  const f = parseFloat(lh);
  return isNaN(f) ? 1.2 : f;   // unitless ratio
}
function ratioScore(a, b) {
  if (a == null || b == null) return null;
  if (a === 0 && b === 0) return 1;
  const hi = Math.max(Math.abs(a), Math.abs(b)); if (hi === 0) return 1;
  return Math.max(0, 1 - Math.abs(a - b) / hi);
}
// family is heaviest. Each present sub-component contributes; missing components are skipped (renormalize).
function typoScore(srcTypo, cloneTypo) {
  if (!srcTypo && !cloneTypo) return null;
  if (!srcTypo || !cloneTypo) return 0;
  const parts = [];
  // FAMILY (heaviest, weight 0.5): exact normalized-name match
  const fa = normFamily(srcTypo.family), fb = normFamily(cloneTypo.family);
  if (fa || fb) parts.push([0.5, fa && fb ? (fa === fb ? 1 : (fa.includes(fb) || fb.includes(fa) ? 0.6 : 0)) : 0]);
  // SIZE (weight 0.25)
  const sa = parsePx(srcTypo.size), sb = parsePx(cloneTypo.size);
  const ss = ratioScore(sa, sb); if (ss != null) parts.push([0.25, ss]);
  // WEIGHT (weight 0.15)
  const wa = numWeight(srcTypo.weight), wb = numWeight(cloneTypo.weight);
  const ws = 1 - Math.min(1, Math.abs(wa - wb) / 500); parts.push([0.15, ws]);
  // LINE HEIGHT (weight 0.10)
  const la = lineHeightRatio(srcTypo), lb = lineHeightRatio(cloneTypo);
  const ls = ratioScore(la, lb); if (ls != null) parts.push([0.10, ls]);
  if (!parts.length) return null;
  let wsum = 0, vsum = 0; for (const [w, v] of parts) { wsum += w; vsum += w * v; }
  return wsum ? vsum / wsum : null;
}

// ============================ EFFECTS: border-radius + box-shadow + backdrop-filter ============================
// Reversible: GRADER_NO_EFFECTS=1 (read in grade-sections.mjs) drops EFFECTS from the perElement blend; this
// module ALWAYS computes & reports it (so the field is present), and the blend weight is what changes upstream.
const USE_EFFECTS = !process.env.GRADER_NO_EFFECTS; // informational here; the weight-flip lives in grade-sections.mjs

// parse a CSS length (px) that may be scientific-notation (e.g. "3.35544e+07px" from a 9999px pill). null if absent.
function parseLenPx(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const m = String(v).match(/(-?[\d.]+(?:e[+-]?\d+)?)\s*px/i);
  if (m) return parseFloat(m[1]);
  const f = parseFloat(v);
  return isNaN(f) ? null : f;
}
// RADIUS sub-component: agreement on corner rounding via RELATIVE px tolerance. Treat <0.5px as "square" (0).
// Both square -> 1 (perfect agreement). Both rounded -> relative-difference score. null only if a value is missing.
function radiusScore(ra, rb) {
  const a = parseLenPx(ra), b = parseLenPx(rb);
  if (a == null && b == null) return null;          // neither node records radius → no radius signal
  if (a == null || b == null) return null;          // only one side records the field → not a comparable signal
  const az = a < 0.5, bz = b < 0.5;                 // effectively square
  if (az && bz) return 1;                            // both square → perfect agreement (no rounding either side)
  if (az !== bz) return 0;                           // one square, one rounded → full mismatch
  // both rounded: relative px tolerance — full credit when within ~10%, decays to 0 by a 2x difference.
  const hi = Math.max(a, b), lo = Math.min(a, b);
  const rel = (hi - lo) / hi;                        // 0 = identical … 1 = totally different
  return Math.max(0, Math.min(1, 1 - rel / 0.5));    // <=10% rel → ~1; >=50% rel → 0
}
// parse a box-shadow string -> array of {color:[r,g,b]|null, ox, oy, blur, spread, inset}. "none"/empty -> [].
// computed box-shadow is "color ox oy blur spread[, …]"; we split top-level commas (not inside rgb()).
function parseShadows(s) {
  if (!s || typeof s !== 'string' || /^none$/i.test(s.trim())) return [];
  const parts = []; let depth = 0, cur = '';
  for (const ch of s) { if (ch === '(') depth++; else if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => {
    const inset = /\binset\b/i.test(p);
    let rest = p.replace(/\binset\b/i, '');
    let color = null;
    const cm = rest.match(/(rgba?\([^)]*\)|#[0-9a-f]{3,8})/i);
    if (cm) { color = parseColor(cm[1]); rest = rest.replace(cm[1], ' '); }
    const nums = (rest.match(/-?[\d.]+(?:e[+-]?\d+)?px/gi) || []).map((x) => parseFloat(x));
    const [ox = 0, oy = 0, blur = 0, spread = 0] = nums;
    return { color, ox, oy, blur, spread, inset };
  }).filter((sh) => sh.ox || sh.oy || sh.blur || sh.spread || sh.color);
}
// SHADOW sub-component: presence agreement + (when both present) rough offset/blur/color match on the dominant shadow.
function shadowScore(sa, sb) {
  const A = parseShadows(sa), B = parseShadows(sb);
  const hasA = A.length > 0, hasB = B.length > 0;
  if (!hasA && !hasB) return null;                   // neither node has a shadow → no shadow signal
  if (hasA !== hasB) return 0;                        // presence mismatch → full miss
  // both present: compare the DOMINANT (largest blur+spread magnitude) shadow roughly.
  const dom = (arr) => arr.slice().sort((x, y) => (Math.abs(y.blur) + Math.abs(y.spread)) - (Math.abs(x.blur) + Math.abs(x.spread)))[0];
  const da = dom(A), db = dom(B);
  const parts = [];
  // OFFSET (combined magnitude) — relative tolerance.
  const ma = Math.hypot(da.ox, da.oy), mb = Math.hypot(db.ox, db.oy);
  parts.push([0.30, ratioScore(ma, mb)]);
  // BLUR — relative tolerance.
  parts.push([0.35, ratioScore(Math.abs(da.blur), Math.abs(db.blur))]);
  // INSET flag agreement.
  parts.push([0.10, da.inset === db.inset ? 1 : 0]);
  // COLOR (perceptual, reuse colorScore) — only when both shadows carry a paintable color.
  const cs = (da.color && db.color) ? colorScore(`rgb(${da.color.join(',')})`, `rgb(${db.color.join(',')})`) : null;
  if (cs != null) parts.push([0.25, cs]);
  let wsum = 0, vsum = 0; for (const [w, v] of parts) { if (v == null) continue; wsum += w; vsum += w * v; }
  return wsum ? vsum / wsum : 1;
}
// BACKDROP-FILTER sub-component: presence agreement (glassmorphism blur etc). Both blur → rough radius match.
function backdropScore(ba, bb) {
  const hasA = !!(ba && !/^none$/i.test(String(ba).trim()));
  const hasB = !!(bb && !/^none$/i.test(String(bb).trim()));
  if (!hasA && !hasB) return null;                   // neither has a backdrop-filter → no signal
  if (hasA !== hasB) return 0;                        // presence mismatch → full miss
  // both present: compare blur radius if both expose one; else presence agreement is enough → 1.
  const blurOf = (v) => { const m = String(v).match(/blur\(\s*([\d.]+)\s*px\s*\)/i); return m ? parseFloat(m[1]) : null; };
  const ra = blurOf(ba), rb = blurOf(bb);
  if (ra == null || rb == null) return 1;            // both present but no comparable blur radius → presence match
  return ratioScore(ra, rb);
}
// EFFECTS sub-score for a matched pair: mean over the PRESENT components {radius, shadow, backdrop}.
// null if NONE of the three components yields a signal (so it folds away like color/typo when absent).
function effectsScore(a, b) {
  const vals = [];
  const rs = radiusScore(a.radius, b.radius); if (rs != null) vals.push(rs);
  const sh = shadowScore(a.boxShadow, b.boxShadow); if (sh != null) vals.push(sh);
  const bd = backdropScore(a.backdropFilter, b.backdropFilter); if (bd != null) vals.push(bd);
  if (!vals.length) return null;
  return vals.reduce((s, x) => s + x, 0) / vals.length;
}

// ============================ STRUCTURE-INVARIANT CONTAINER GATE (B2 false-deflation fix) ============================
// PROVEN BUG (B2): a clone whose card row is wrapped in a GRID CONTAINER (and, responsively, its grid-CELL
// containers) carries EXTRA structurally-invisible layout wrappers that a flat absolutely-positioned Page A
// simply does not have. Those wrappers paint NO distinct visual signal — no border, no radius, no shadow, no
// backdrop-filter, and a background that merely EQUALS their parent's / the page default. The OLD gate kept
// EVERY container that returned ANY bgColor, so these invisible wrappers were pushed as fidelity nodes, dumped
// into unmatchedCloneArea, collapsed areaCoverage, and MULTIPLIED every sub-score down — DESPITE a pixel-identical
// render at 1440 (A-vs-B raw color/typo/text/position all 1.0, coverage 0.969).
//
// THE FIX: key the container-keep decision on RENDERED VISUAL SIGNAL, not DOM nesting. A container is a
// fidelity-bearing node ONLY if it actually paints something a viewer can see as distinct from its surroundings:
//   (a) a visible border, OR (b) a non-zero corner radius, OR (c) a box-shadow, OR (d) a backdrop-filter, OR
//   (e) a background that differs PERCEPTIBLY (CIEDE2000 dE > STRUCT_BG_DE) from BOTH its parent's effective
//       background AND the page default background.
// A wrapper that adds only nesting (its bg == parent == page default, nothing painted) is NOT a fidelity node
// and is skipped — on BOTH sides, with the SAME rule and SAME thresholds, so the metric stays symmetric.
//
// SYMMETRY / SELFTEST: the identical gate runs on the source tree and the clone tree. clone == source (selftest)
// → identical keep/drop decisions → identical node sets → composite stays 1.0 (verified rail).
// NO INFLATION: this only stops PENALIZING render-identical structure. A container that DOES paint a distinct
// signal is still kept and still scored; a genuinely-missing/wrong-colored/extra VISIBLE box still deflates
// coverage exactly as before. Dropping a wrapper removes the SAME (matched, dE~0) area from numerator and
// denominator, so a faithful clone's coverage rises toward 1 while a bad clone's distinct boxes still count.
//
// REVERSIBLE: GRADER_STRUCT_INVARIANT=0 → exact prior behavior (keep any container with a bgColor), byte-for-byte.
const USE_STRUCT_INVARIANT = process.env.GRADER_STRUCT_INVARIANT !== '0';
const STRUCT_BG_DE = 3.0;  // CIEDE2000 dE above which a container bg is "perceptibly distinct" from parent/page
// visible border: a non-null border string with a non-zero width and a non-"none" style and a paintable color.
function hasVisibleBorder(n) {
  const b = n.border;
  if (!b || typeof b !== 'string') return false;
  if (/\bnone\b/i.test(b)) return false;
  const wm = b.match(/(-?[\d.]+)px/);
  if (wm && parseFloat(wm[1]) < 0.5) return false;          // hairline/zero width → not visible
  const cm = b.match(/(rgba?\([^)]*\)|#[0-9a-f]{3,8})/i);
  if (cm && parseColor(cm[1]) == null) return false;        // fully-transparent border color → not visible
  return true;
}
function hasNonZeroRadius(n) { const r = parseLenPx(n.radius); return r != null && r >= 0.5; }
function hasBoxShadow(n) { return parseShadows(n.boxShadow).length > 0; }
function hasBackdrop(n) { const v = n.backdropFilter; return !!(v && !/^none$/i.test(String(v).trim())); }
// bg perceptibly distinct from a reference bg (parent or page default). null reference → treat distinct iff bg paints.
function bgDistinctFrom(bg, ref) {
  const a = parseColor(bg);
  if (!a) return false;                                     // this node paints no comparable bg → not distinct
  const b = parseColor(ref);
  if (!b) return true;                                      // reference is unpaintable/transparent but we paint → distinct
  return ciede2000(srgbToLab(...a), srgbToLab(...b)) > STRUCT_BG_DE;
}
// A container carries a DISTINCT visual signal iff it paints a border/radius/shadow/backdrop OR a bg that
// differs perceptibly from BOTH its parent bg AND the page default. Pure layout wrappers fail all of these.
function containerHasVisualSignal(n, parentBg, pageBg) {
  if (hasVisibleBorder(n) || hasNonZeroRadius(n) || hasBoxShadow(n) || hasBackdrop(n)) return true;
  const bg = bgColorOf(n);
  return bgDistinctFrom(bg, parentBg) && bgDistinctFrom(bg, pageBg);
}

// ============================ FLATTEN box-tree -> node list ============================
// Keep leaves (heading/text/button/image/svg/code/list/etc) AND containers that carry a paintable bg.
// With GRADER_STRUCT_INVARIANT (default ON) a container is kept ONLY if it carries a DISTINCT visual signal
// (border/radius/shadow/backdrop OR a bg perceptibly different from parent + page default) — so structurally-
// invisible layout wrappers (the B2 grid container + grid cells) no longer deflate coverage. parentBg threads
// the nearest ancestor's effective background down so a wrapper is judged against what actually renders behind it.
function flatten(root) {
  const out = [];
  const pageBg = bgColorOf(root) || null;                   // page default = outermost container's effective bg
  const visit = (n, parentBg) => {
    if (!n || typeof n !== 'object') return;
    if (n.kind === 'container') {
      // a container is a fidelity-bearing node iff it paints a background (color) we can compare …
      const bg = bgColorOf(n);
      // … AND (default ON) it carries a DISTINCT visual signal — not just nesting that repeats the parent/page bg.
      const keep = bg && n.box && n.box.w >= 24 && n.box.h >= 24
        && (!USE_STRUCT_INVARIANT || containerHasVisualSignal(n, parentBg, pageBg));
      if (keep) out.push(makeNode(n, '', null, bg));
      // children are judged against THIS container's effective bg (what renders behind them); fall back to parentBg.
      const childBg = bg || parentBg;
      (n.children || []).forEach((c) => visit(c, childBg));
      return;
    }
    // leaf kinds
    if (n.kind === 'list' || n.kind === 'tabs' || n.kind === 'accordion') {
      const text = (n.items || []).map((it) => it.text || it.title || '').join(' ');
      out.push(makeNode(n, text, n.typo || null, bgColorOf(n)));
      return;
    }
    const text = n.text || n.alt || '';
    const typo = n.typo || null;
    const textColor = textColorOf(n);
    out.push(makeNode(n, text, typo, null, textColor));
  };
  visit(root, pageBg);
  const nodes = out.filter((x) => x.box && x.box.w > 0 && x.box.h > 0);
  // Expose the page-default background (outermost effective bg) so the COLOR sub-score can recover a clone text
  // color captured MID-FADE (scroll-reveal opacity/color transition) — such a reading is the fade-in COMPOSITE of
  // the element's settled color over THIS page background. parsed once here, attached non-enumerably so the
  // returned value stays a plain node array everywhere else (telemetry/JSON unaffected).
  Object.defineProperty(nodes, 'pageBg', { value: parseColor(pageBg), enumerable: false });
  return nodes;
}
// background color preference: explicit sampled > computed background.color > bg field
function bgColorOf(n) {
  if (n.bgSampled) return n.bgSampled;
  if (n.background && n.background.color) return n.background.color;
  if (n.bg) return n.bg;
  return null;
}
// text color for leaves: paint.value (solid) is the painted glyph color
function textColorOf(n) {
  if (n.paint && n.paint.kind === 'solid' && n.paint.value) return n.paint.value;
  if (n.paint && n.paint.kind === 'gradient-text') return null; // gradient text — skip color compare
  return null;
}
function makeNode(n, text, typo, bgColor, textColor) {
  const box = n.box || { x: 0, y: 0, w: 0, h: 0 };
  return {
    kind: n.kind,
    box: { x: box.x, y: box.y, w: box.w, h: box.h },
    cx: box.x + box.w / 2, cy: box.y + box.h / 2,
    area: Math.max(0, box.w) * Math.max(0, box.h),
    text: normText(text),
    typo,
    // color: text nodes use text color; containers/bg nodes use background color
    color: textColor != null ? textColor : (bgColor != null ? bgColor : null),
    isText: !!(text && text.trim()),
    // EFFECTS fields — captured by capture-layout.mjs (radius/boxShadow/backdropFilter), previously UNSCORED.
    radius: n.radius != null ? n.radius : null,
    boxShadow: n.boxShadow != null ? n.boxShadow : null,
    backdropFilter: n.backdropFilter != null ? n.backdropFilter : null,
    // colorGlyph SHADOW METRIC inputs (REPORT-ONLY) — carry through the ADDITIVE rendered-glyph color sample
    // (paint.glyphRGB) and the paint kind so colorGlyphReport can fall back to the rendered foreground color when
    // the CSS-parse color (`color` above) is unresolvable (gradient-text/null/oklch/lab/var). These two fields
    // feed ONLY the report-only colorGlyph metric; they NEVER enter colorScore/typoScore/the matcher cost.
    glyphRGB: (n.paint && Array.isArray(n.paint.glyphRGB) && n.paint.glyphRGB.length === 3) ? [n.paint.glyphRGB[0], n.paint.glyphRGB[1], n.paint.glyphRGB[2]] : null,
    paintKind: (n.paint && n.paint.kind) ? n.paint.kind : null,
  };
}

// ============================ SYMMETRIC BLOCK-MERGE PRE-PASS (research backlog #4) ============================
// PROBLEM: a paragraph/heading/list rendered as N wrapped line-FRAGMENTS on one side (capture splits a <p> or
// wrapped <h1> into separate line boxes — see linearapp src: "The product development" + "system for teams and
// agents" = two h=64 boxes, 0px gap, identical Inter/64px/510/color) but as ONE block on the other side NEVER
// matches 1:1. The leftover fragments dump into unmatchedSrc/CloneArea → areaCoverage (a MULTIPLIER on
// color/typo/text) collapses DESPITE the text being fully present. Merging adjacent same-typography fragments
// into blocks on BOTH sides normalizes the granularity so present-but-fragmented content earns its coverage.
//
// CRITICAL SYMMETRY: the EXACT SAME function runs on the source leaf array AND the clone leaf array with the
// SAME thresholds. Source-vs-source (selftest): identical input → identical merge → identical leaf sets →
// perfect match → composite stays 1.0. NEVER merge only one side. NEVER merge across DIFFERENT typography
// (that was the deep-flatten asymmetric-over-harvest bug). Non-text leaves (images/media/buttons) NEVER merge.
//
// THE MERGE: group TEXT leaves that are (a) SAME TYPOGRAPHY — same font-family, same font-size (within 1px),
// same font-weight bucket, same color (CIEDE2000 dE<=2); (b) VERTICALLY ADJACENT — x-ranges overlap AND the
// vertical gap between one box bottom and the next box top is < 0.5 * lineHeight; (c) in document/reading
// order. A run of such leaves becomes ONE leaf: box = union, text = space-joined concat, typography = shared.
// A single leaf with no mergeable neighbor passes through UNCHANGED.
//
// REVERSIBLE: gated behind GRADER_NO_MERGE !== "1" (default ON; =1 → exact prior behavior, byte-for-byte).
const USE_MERGE = process.env.GRADER_NO_MERGE !== '1';
// merge gates (shared by both sides — symmetry depends on identical thresholds):
const MERGE_SIZE_TOL_PX = 1.0;      // font-size must agree within ±1px
const MERGE_COLOR_DE = 2.0;         // text color must agree within CIEDE2000 dE <= 2
const MERGE_GAP_FRAC = 0.5;         // vertical gap < 0.5 * lineHeight (px) to be "adjacent"
const MERGE_XOVERLAP_PX = 1.0;      // x-ranges must overlap by at least this many px (horizontal adjacency)

// font-weight bucket: collapse to coarse buckets so 500 vs 510 vs 400-as-"normal" group as intended.
function weightBucket(w) {
  const n = numWeight(w);            // reuse the typography weight normalizer (string/keyword → number)
  if (n <= 350) return 'thin';
  if (n <= 450) return 'normal';
  if (n <= 550) return 'medium';
  if (n <= 650) return 'semibold';
  return 'bold';
}
// resolve a TEXT leaf's font-size to px (typo.size is already a rounded number from capture-layout).
function typoSizePx(typo) { return typo ? parsePx(typo.size) : null; }
// resolve a TEXT leaf's lineHeight to absolute px (for the gap test). Falls back to 1.2*size, then size.
function lineHeightPx(typo) {
  if (!typo) return null;
  const sz = parsePx(typo.size);
  const px = parsePx(typo.lineHeight);
  if (px != null) return px;                                  // explicit "24px" lineHeight
  const ratio = lineHeightRatio(typo);                        // unitless ratio or "normal" → 1.2
  if (sz != null && ratio != null) return sz * ratio;
  return sz != null ? sz * 1.2 : null;
}
// Two TEXT leaves share typography iff family + size(±1px) + weight-bucket + color(dE<=2) all agree.
function sameTypography(a, b) {
  if (!a.isText || !b.isText) return false;                   // non-text leaves never merge
  const ta = a.typo, tb = b.typo;
  if (!ta || !tb) return false;                               // need typography on both to claim "same"
  if (normFamily(ta.family) !== normFamily(tb.family)) return false;
  const sa = typoSizePx(ta), sb = typoSizePx(tb);
  if (sa == null || sb == null || Math.abs(sa - sb) > MERGE_SIZE_TOL_PX) return false;
  if (weightBucket(ta.weight) !== weightBucket(tb.weight)) return false;
  // color: both must carry a paintable color and agree within CIEDE2000 dE <= 2.
  const ca = parseColor(a.color), cb = parseColor(b.color);
  if (!ca || !cb) return ca === cb;                           // both null (unpainted text) → same; one null → differ
  return ciede2000(srgbToLab(...ca), srgbToLab(...cb)) <= MERGE_COLOR_DE;
}
// Vertically adjacent: x-ranges overlap AND the gap from THIS box bottom to NEXT box top < 0.5*lineHeight.
// (next.cy > cur.cy guarantees reading-order direction; the boxes are pre-sorted top-to-bottom.)
function verticallyAdjacent(cur, next) {
  const ax0 = cur.box.x, ax1 = cur.box.x + cur.box.w;
  const bx0 = next.box.x, bx1 = next.box.x + next.box.w;
  const xOverlap = Math.min(ax1, bx1) - Math.max(ax0, bx0);
  if (xOverlap < MERGE_XOVERLAP_PX) return false;             // not horizontally aligned → different columns
  const curBottom = cur.box.y + cur.box.h, nextTop = next.box.y;
  const gap = nextTop - curBottom;                            // signed; small overlap (gap<0) is fine
  const lh = lineHeightPx(cur.typo) || lineHeightPx(next.typo) || 16;
  return gap < MERGE_GAP_FRAC * lh;                           // < 0.5 * lineHeight → adjacent line of same block
}
// fold a run of >=2 leaves into ONE leaf via makeNode-equivalent reconstruction (union box, joined text).
function mergeRun(run) {
  if (run.length === 1) return run[0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const texts = [];
  for (const n of run) {
    minX = Math.min(minX, n.box.x); minY = Math.min(minY, n.box.y);
    maxX = Math.max(maxX, n.box.x + n.box.w); maxY = Math.max(maxY, n.box.y + n.box.h);
    if (n.text && n.text.trim()) texts.push(n.text.trim());
  }
  const box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  const base = run[0];                                         // shared typography/color/effects come from the run
  const text = texts.join(' ');
  return {
    kind: base.kind,
    box,
    cx: box.x + box.w / 2, cy: box.y + box.h / 2,
    area: Math.max(0, box.w) * Math.max(0, box.h),
    text: normText(text),
    typo: base.typo,
    color: base.color,
    isText: !!(text && text.trim()),
    radius: base.radius, boxShadow: base.boxShadow, backdropFilter: base.backdropFilter,
    // colorGlyph inputs (report-only): a merged run shares typography/color → its rendered glyph color is the
    // run anchor's (the merge gate already required dE<=2 same-color across the run). paintKind likewise shared.
    glyphRGB: base.glyphRGB, paintKind: base.paintKind,
  };
}
// SYMMETRIC merge: applied IDENTICALLY to the source and the clone leaf arrays with the SAME thresholds.
// Greedy run-builder in reading order (sorted by y then x): extend the current run while the NEXT text leaf
// shares typography with the run-anchor AND is vertically adjacent to the run's LAST member; else flush.
// Non-text leaves pass straight through unchanged. Returns { nodes, merged } where merged = #leaves absorbed.
function blockMerge(nodes) {
  if (!USE_MERGE) return { nodes, merged: 0 };
  // stable reading order: top-to-bottom, then left-to-right. (stable so equal keys keep input order.)
  const order = nodes.map((n, i) => ({ n, i }))
    .sort((p, q) => (p.n.box.y - q.n.box.y) || (p.n.box.x - q.n.box.x) || (p.i - q.i))
    .map((x) => x.n);
  const out = [];
  let merged = 0;
  let run = [];
  const flush = () => { if (run.length) { if (run.length > 1) merged += run.length - 1; out.push(mergeRun(run)); run = []; } };
  for (const n of order) {
    if (!n.isText) { flush(); out.push(n); continue; }        // non-text → flush any open run, emit as-is
    if (!run.length) { run = [n]; continue; }
    const anchor = run[0], last = run[run.length - 1];
    // extend iff SAME TYPOGRAPHY as the run anchor AND vertically adjacent to the LAST line of the run.
    if (sameTypography(anchor, n) && verticallyAdjacent(last, n)) run.push(n);
    else { flush(); run = [n]; }
  }
  flush();
  return { nodes: out, merged };
}

// ============================ GDA GROUP-COUNT STRUCTURAL SHADOW METRIC (REPORT-ONLY) ============================
// @purpose Measure the #1 open wall (structural floor ~0.477) HONESTLY. The existing area-coverage denominator
// MASKS under-capture: a clone that reproduces only 2 of a source 6-card grid still scores OK because the 2 big
// cards cover similar AREA (areaCoverage is area-weighted, so a few large reproduced members dominate while the
// missing small grid members barely move it). GDA ("Grouped-Density Agreement") exposes this by scoring whether
// the clone reproduced the right COUNT of each REPEATED element-type — independent of area.
//
// SHADOW / REPORT-ONLY: this is a NEW field on the report (report.gdaGroupCount + per-group detail). It is NEVER
// folded into composite/visual/structural/editability — EXACTLY like grade-motion. grade-sections.mjs reads only
// {color,typography,position,text,effects,areaCoverage} from this module's JSON, so adding this field is inert
// upstream (the composite stays byte-identical). It runs on the SAME merged source/clone leaf node sets the
// matcher already computes → it is a PURE function of those sets (deterministic: same capture → same GDA).
//
// SIGNATURE (the clustering key) = (kind, typoBucket, sizeBucket):
//   • kind        — the element kind (text/heading/button/image/svg/container/…). Different kinds never group.
//   • typoBucket  — for TEXT leaves: `${fontSizeBucket}|${weightBucket}` where fontSizeBucket snaps the font-size
//                   to coarse bins (8/10/12/14/16/18/20/24/28/32/40/48/56/64/72/96/128) and weightBucket reuses
//                   the existing thin/normal/medium/semibold/bold buckets. For NON-text leaves: 'na'.
//   • sizeBucket  — the element's APPROX rendered size, snapped to a log2 bin so boxes within ~±15% (one bin is a
//                   √2≈41% span, half-bin ≈ ±20%; we use a finer 4-steps-per-octave grid so a bin ≈ ±9%, i.e. two
//                   boxes within ~±15% almost always share a bin). We bin BOTH width and height so a 6-up card row
//                   (same card dims) clusters but a wide hero banner does not join the cards.
// A RACE-GROUP = a signature shared by >=2 SOURCE leaves (a repeated element-type — grid cards, nav links, a list
// of features, etc). SINGLETON source signatures are EXCLUDED (they are not "repeated" — a hero headline appearing
// once carries no count signal; counting it would just re-measure presence, which area-coverage already does).
//
// PER-GROUP SCORE = ramp(cloneCount / srcCount), clamp01 — PARTIAL CREDIT, not hard-binary. cloneCount = # of CLONE
// leaves whose signature matches the group's signature. So 2-of-6 reproduced → 0.333 (not 0); 6-of-6 → 1.0;
// 9-of-6 (clone over-produced) → clamped to 1.0 (over-capture is not rewarded beyond parity, but is not penalized
// here — over-capture is a separate failure the area-coverage denominator already catches via unmatchedCloneArea).
//
// AGGREGATE gdaGroupCount = srcCount-WEIGHTED mean over race-groups (a 6-card grid counts more than a 2-item pair).
//   DOCUMENTED CHOICE: srcCount-weighted (not equal-weighted) so the metric tracks the TOTAL volume of repeated
//   structure reproduced, which is what the structural wall is about. Equal-weighting is available as telemetry
//   (gdaGroupCountEqual) for cross-check. If there are NO race-groups (no repeated structure on the source), GDA
//   is reported as null (the metric has no opinion — it only speaks about repeated element-types).
//
// IDENTITY: source-vs-source (selftest) → clone leaf set == source leaf set → every group's cloneCount==srcCount
// → every per-group score 1.0 → gdaGroupCount == 1.0 (the self-test rail for this metric).
const GDA_MIN_GROUP = 2;                                   // a race-group needs >= this many source leaves (repeated)
// coarse font-size bins (px) — text leaves snap to the nearest bin so 63px and 64px headings group.
const GDA_FONT_BINS = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 72, 96, 128, 192, 256];
function gdaFontBucket(px) {
  if (px == null || !(px > 0)) return 'na';
  let best = GDA_FONT_BINS[0], bd = Infinity;
  for (const b of GDA_FONT_BINS) { const d = Math.abs(b - px); if (d < bd) { bd = d; best = b; } }
  return String(best);
}
// log2 size bin at 4 steps/octave → a bin spans √[4]{2}≈1.19× (≈ ±9% around its center) so boxes within ~±15%
// share a bin in the common case. A dimension <1px snaps to bin 0 (degenerate); we bin both w and h.
function gdaSizeBin(px) {
  if (px == null || !(px >= 1)) return 0;
  return Math.round(Math.log2(px) * 4);
}
// SIGNATURE of a leaf node = `${kind}#${typoBucket}#${wBin}x${hBin}`. Pure function of the node's own fields.
function gdaSignature(n) {
  const kind = n.kind || 'node';
  let typoBucket = 'na';
  if (n.isText && n.typo) typoBucket = gdaFontBucket(typoSizePx(n.typo)) + '|' + weightBucket(n.typo.weight);
  const wBin = gdaSizeBin(n.box && n.box.w), hBin = gdaSizeBin(n.box && n.box.h);
  return `${kind}#${typoBucket}#${wBin}x${hBin}`;
}
// Build the GDA report from the SAME merged source/clone leaf sets the matcher uses. PURE → deterministic.
// Returns { gdaGroupCount, gdaGroupCountEqual, groups:[{sig,srcCount,cloneCount,score}], groupsN } or nulls if
// the source has no repeated structure (no race-group). NEVER touches composite/visual/structural/editability.
function gdaGroupCountReport(srcNodes, cloneNodes) {
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  // 1) cluster SOURCE leaves by signature; a race-group = signature with >= GDA_MIN_GROUP members.
  const srcSig = new Map();
  for (const n of srcNodes) { const s = gdaSignature(n); srcSig.set(s, (srcSig.get(s) || 0) + 1); }
  // 2) count CLONE leaves per signature (only the signatures that ARE race-groups need a count).
  const cloneSig = new Map();
  for (const n of cloneNodes) { const s = gdaSignature(n); cloneSig.set(s, (cloneSig.get(s) || 0) + 1); }
  const groups = [];
  for (const [sig, srcCount] of srcSig) {
    if (srcCount < GDA_MIN_GROUP) continue;                 // singleton signature → not a repeated element-type
    const cloneCount = cloneSig.get(sig) || 0;
    const score = clamp01(cloneCount / srcCount);            // ramp w/ partial credit; over-capture clamps to 1
    groups.push({ sig, srcCount, cloneCount, score: Math.round(score * 10000) / 10000 });
  }
  if (!groups.length) return { gdaGroupCount: null, gdaGroupCountEqual: null, groups: [], groupsN: 0 };
  // 3) aggregate — srcCount-WEIGHTED mean (documented) + equal-weighted telemetry cross-check.
  let wsum = 0, vsum = 0, esum = 0;
  for (const g of groups) { wsum += g.srcCount; vsum += g.srcCount * g.score; esum += g.score; }
  const r4 = (x) => Math.round(x * 10000) / 10000;
  // sort groups by srcCount desc so the report leads with the biggest repeated structures.
  groups.sort((a, b) => b.srcCount - a.srcCount || (a.sig < b.sig ? -1 : 1));
  return {
    gdaGroupCount: r4(wsum ? vsum / wsum : 1),
    gdaGroupCountEqual: r4(esum / groups.length),
    groups,
    groupsN: groups.length,
  };
}

// ============================ RDA 3x3-QUADRANT POSITION-SHADOW METRIC (REPORT-ONLY) ============================
// @purpose Catch GROSS mis-placement that the SMOOTH position sub-score FORGIVES. Position is the #1 human-
// correlated fidelity dimension, but the existing smooth metric (≈ 1 - clamp(max(|dcx|,|dcy|))) hands out
// ~0.4-0.6 PARTIAL CREDIT even when a clone element lands in a COMPLETELY different region (source top-left,
// clone bottom-right). A human calls that mis-placed. RDA ("Region-Discretized Agreement") makes that gross
// failure LEGIBLE by binning each element CENTER into a 3x3 grid cell and HARD-ZEROing any matched pair whose
// clone center is in a different quadrant than its source — with a narrow DEAD-BAND so a near-boundary nudge
// (and sub-pixel recapture jitter on the identity self-test) is forgiven.
//
// SHADOW / REPORT-ONLY: this is a NEW field on the report (report.rdaQuadrant + per-pair detail). It is NEVER
// folded into composite/visual/position/structural/editability — EXACTLY like grade-motion and the GDA metric.
// grade-sections.mjs reads only {color,typography,position,text,effects,areaCoverage} from this module's JSON,
// so adding this field is inert upstream (the composite stays BYTE-IDENTICAL). It runs on the SAME matched
// source/clone pair set + centers the scorer already computed → it is a PURE function of those pairs + the
// viewport/page dims (deterministic: same capture → same RDA).
//
// QUADRANT MAPPING: a node center (cx, cy) → cell (col, row) where
//     col = clamp(floor(3 * cx / W), 0, 2)   with W = the captured viewport width (refW)
//     row = clamp(floor(3 * cy / H), 0, 2)   with H = THAT element's OWN page height (source center ÷ srcH,
//                                            clone center ÷ cloneH) — so "top region" matches "top region"
//                                            regardless of total page length / uniform stretch.
// PER-PAIR SCORE: 1.0 if clone cell == source cell, else 0.0 — BUT a DEAD-BAND rescues a near-boundary miss.
// DEAD-BAND: if the clone center is in an adjacent cell but its center sits within DEADBAND_FRAC of the
//   crossed source-cell boundary INTO the adjacent cell (|offset past the source-cell boundary| <= 0.05*W
//   horizontally AND <= 0.05*H vertically), the miss is treated as same-quadrant → 1.0. This is what keeps
//   the identity self-test at EXACTLY 1.0 (clone center == source center ⇒ same cell ⇒ 1.0, and even with
//   sub-pixel recapture jitter the dead-band absorbs the boundary straddle) while STILL hard-zeroing a clone
//   that lands a full quadrant away (offset past boundary far exceeds the band).
// AGGREGATE rdaQuadrant = mean over matched pairs (each pair weighted equally — a gross mis-placement of any
//   one matched element is a full miss for that element). null if there are no matched pairs.
//
// IDENTITY: source-vs-source (selftest) → every pair's clone center == its source center → same cell → 1.0
// → rdaQuadrant == 1.0 (the self-test rail for this metric; the dead-band guarantees it under recapture jitter).
const RDA_COLS = 3, RDA_ROWS = 3;
const RDA_DEADBAND_FRAC = 0.05;   // a cross-cell miss within 5% of W (horiz) AND 5% of H (vert) past the
                                  // source-cell boundary is treated as same-quadrant (near-boundary nudge).
const rdaClampCell = (v, n) => Math.max(0, Math.min(n - 1, Math.floor(v)));
// cell index along one axis: floor(n * coord / dim), clamped to [0, n-1]. dim<=0 → degenerate → cell 0.
function rdaCell(coord, dim, n) {
  if (!(dim > 0)) return 0;
  return rdaClampCell((n * coord) / dim, n);
}
// signed distance (px) of `coord` PAST the [lo,hi] band of the source cell along one axis, INTO the clone's
// side. 0 if coord is within the source band. Used by the dead-band test. (lo = cellIdx*dim/n, hi = (cellIdx+1)*dim/n.)
function rdaOffsetPastBoundary(coord, srcCellIdx, dim, n) {
  if (!(dim > 0)) return 0;
  const lo = (srcCellIdx * dim) / n, hi = ((srcCellIdx + 1) * dim) / n;
  if (coord < lo) return lo - coord;        // clone center fell below the source cell band
  if (coord > hi) return coord - hi;        // clone center fell above the source cell band
  return 0;                                  // within the source cell band along this axis
}
// Build the RDA report from the SAME matched pairs the scorer uses + the viewport width W and per-side page
// heights. PURE → deterministic. Returns { rdaQuadrant, pairs:[{srcCell,cloneCell,same,score}], pairsN } or
// nulls when there are no matched pairs. NEVER touches composite/visual/position/structural/editability.
function rdaQuadrantReport(pairs, W, srcH, cloneH) {
  const r4 = (x) => Math.round(x * 10000) / 10000;
  if (!pairs.length) return { rdaQuadrant: null, pairs: [], pairsN: 0 };
  const detail = [];
  let sum = 0;
  for (const { a, b } of pairs) {
    // source center → its cell against the SOURCE page height; clone center → its cell against the CLONE page height.
    const sCol = rdaCell(a.cx, W, RDA_COLS), sRow = rdaCell(a.cy, srcH, RDA_ROWS);
    const cCol = rdaCell(b.cx, W, RDA_COLS), cRow = rdaCell(b.cy, cloneH, RDA_ROWS);
    const same = sCol === cCol && sRow === cRow;
    let score;
    if (same) {
      score = 1;                              // clone center in the SAME quadrant as source → full credit
    } else {
      // DEAD-BAND: a near-boundary nudge into an adjacent cell. The clone center must be within
      // DEADBAND_FRAC*W of the source COLUMN band (horizontally) AND within DEADBAND_FRAC*cloneH... — but
      // the boundary is shared, so we measure the clone center's offset PAST the SOURCE cell band on each
      // axis (the axes the clone actually crossed). If BOTH crossed-axis offsets are within the band, the
      // miss is a sub-cell straddle → treat as same-quadrant (1.0); else a genuine region miss → 0.0.
      const offX = rdaOffsetPastBoundary(b.cx, sCol, W, RDA_COLS);
      const offY = rdaOffsetPastBoundary(b.cy, sRow, cloneH, RDA_ROWS);
      const nearBand = offX <= RDA_DEADBAND_FRAC * W && offY <= RDA_DEADBAND_FRAC * cloneH;
      score = nearBand ? 1 : 0;
    }
    sum += score;
    detail.push({ srcCell: `${sCol},${sRow}`, cloneCell: `${cCol},${cRow}`, same, score });
  }
  return { rdaQuadrant: r4(sum / pairs.length), pairs: detail, pairsN: pairs.length };
}

// ============================ colorGlyph RENDERED-COLOR SHADOW METRIC (REPORT-ONLY) ============================
// @purpose Measure COLOR fidelity HONESTLY — the LAST dimension still mis-measured. The existing per-element COLOR
// sub-score (colorScore → parseColor) parses ONE CSS color STRING per node. parseColor handles rgb()/rgba()/hex
// ONLY; it returns null for gradient-text (textColorOf returns null for paint.kind==='gradient-text'), and for
// oklch()/lab()/var()/transparent. A null on EITHER side makes colorScore return null (the pair is DROPPED from the
// color mean) or 0 (one-sided). So the CSS-parse color sub-score MIS-MEASURES color fidelity EXACTLY on the lowest-
// color sites (gradient-text H1s, oklch design tokens): it scores ~0 / drops the pair even when the rendered text
// color is in fact a faithful match. (resend has gradient-text H1s "Email for developers" etc; reactdev/supabase
// score low partly because the parse drops/zeros these instead of crediting the real rendered color.)
//
// THE FIX: when a matched text element's CSS color is unresolvable to a concrete rgb (null/transparent/gradient/
// oklch/lab/var), FALL BACK to the MEAN RENDERED color of that node's foreground GLYPH CLUSTER — the edge-aware
// core sample dominantTextColor() takes in capture-layout (the ADDITIVE paint.glyphRGB field), NOT a whole-box crop
// that would average in the background. CIEDE2000 the source-vs-clone glyph-mean. Per text pair colorGlyph uses the
// BEST AVAILABLE CONCRETE color per side: the rendered glyph sample (glyphRGB) when present, else parseColor(color).
//
// PARITY WITH THE CSS-PARSE METRIC: on pairs where BOTH sides ARE CSS-resolvable AND glyphRGB is absent, colorGlyph
// reduces to the SAME parseColor inputs as colorScore (so it AGREES there — it is a superset that ADDS signal only
// on the unresolvable pairs). On gradient/oklch pairs, where colorScore returned ~0/dropped, colorGlyph uses the
// rendered glyph color → it CREDITS a faithful color the parse missed (or EXPOSES a real delta the parse scored 0).
//
// SHADOW / REPORT-ONLY: NEW report fields (report.colorGlyph + colorGlyphCssParse + detail). NEVER folded into
// composite/visual/color/structural/editability — grade-sections.mjs reads only {color,typography,position,text,
// effects,areaCoverage}, so this is INERT upstream (composite stays byte-identical) — EXACTLY like grade-motion +
// GDA + RDA. Computed on the SAME matched pairs the scorer uses → PURE/deterministic (same capture → same colorGlyph).
//
// IDENTITY (selftest): source-vs-source → each pair's src concrete color == clone concrete color (same glyphRGB or
// same parsed CSS) → CIEDE2000 = 0 → per-pair 1.0 → colorGlyph == 1.0 (its self-test rail, mirroring GDA/RDA).
//
// concrete rgb for a node's TEXT foreground: rendered glyph sample first (the truth for clipped/gradient/oklch text),
// then the parsed CSS color. null only if NEITHER is available (textless/un-sampled node → no color signal).
function glyphConcreteColor(n) {
  if (n.glyphRGB && n.glyphRGB.length === 3) return n.glyphRGB;       // rendered foreground glyph mean (edge-aware core)
  const p = parseColor(n.color);                                       // fall back to the parsed CSS string color
  return p || null;
}
// is the node's CSS-string color UNRESOLVABLE to a concrete rgb (the case the CSS-parse metric mis-measures)?
// true when parseColor(color) is null — i.e. color is null (gradient-text → textColorOf null), transparent, or a
// non-rgb/hex function (oklch/lab/var). Also true when the node is flagged gradient-text by the capture.
function cssColorUnresolvable(n) {
  if (n.paintKind === 'gradient-text') return true;
  return parseColor(n.color) == null;
}
// per-pair colorGlyph: CIEDE2000 between the two concrete rendered/parsed colors, mapped exactly like colorScore
// (full credit dE<=2, linear decay to 0 by dE 10). null only if a concrete color is missing on a side.
function colorGlyphPair(a, b) {
  const ca = glyphConcreteColor(a), cb = glyphConcreteColor(b);
  if (!ca && !cb) return null;                                         // neither side has any color signal
  if (!ca || !cb) return 0;                                            // one side has color, the other doesn't → miss
  const dE = ciede2000(srgbToLab(...ca), srgbToLab(...cb));
  if (dE <= 2) return 1;
  return Math.max(0, Math.min(1, 1 - dE / 10));
}
// Build the colorGlyph report from the SAME matched pairs the scorer uses. Runs over TEXT pairs (both sides isText)
// — the dimension the CSS-parse color metric mis-measures. Returns the glyph-based mean AND, for the SAME pair set,
// the CSS-parse color mean (colorScore) so the report exposes WHERE the two diverge (gate3 discrimination). PURE →
// deterministic. NEVER touches composite/visual/color/structural/editability.
function colorGlyphReport(pairs) {
  const r4 = (x) => Math.round(x * 10000) / 10000;
  const detail = [];
  const glyphVals = [], cssVals = [];
  let usedGlyphFallback = 0;
  for (const { a, b } of pairs) {
    if (!a.isText || !b.isText) continue;                              // colorGlyph measures TEXT foreground color
    const g = colorGlyphPair(a, b);
    if (g == null) continue;                                           // no color signal on this text pair
    glyphVals.push(g);
    // CSS-parse color sub-score for the SAME pair (mirrors colorScore: null/dropped when unresolvable).
    const cssRaw = colorScore(a.color, b.color);
    if (cssRaw != null) cssVals.push(cssRaw);
    // does this pair RELY on the glyph fallback (i.e. CSS-parse was unresolvable on a side)?
    const fellBack = cssColorUnresolvable(a) || cssColorUnresolvable(b);
    if (fellBack) usedGlyphFallback++;
    if (detail.length < 60) detail.push({
      text: (a.text || '').slice(0, 36),
      srcGlyph: a.glyphRGB || null, cloneGlyph: b.glyphRGB || null,
      glyphScore: r4(g),
      cssScore: cssRaw == null ? null : r4(cssRaw),
      glyphFallback: fellBack,
    });
  }
  const mean = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;
  return {
    colorGlyph: glyphVals.length ? r4(mean(glyphVals)) : null,         // glyph-based color mean over text pairs
    colorGlyphCssParse: cssVals.length ? r4(mean(cssVals)) : null,     // CSS-parse color mean over the SAME pairs (colorScore)
    colorGlyphSamples: glyphVals.length,
    colorGlyphCssSamples: cssVals.length,
    colorGlyphFallbackPairs: usedGlyphFallback,                        // # pairs where CSS-parse was unresolvable (glyph carried it)
    colorGlyphDetail: detail,
  };
}

// ============================ HUNGARIAN (linear sum assignment, minimize cost) ============================
// Jonker-Volgenant-free O(n^3) Hungarian on a rectangular padded-to-square cost matrix.
// Ported from the classic Kuhn-Munkres formulation; verified below in self-test.
function hungarian(costMatrix) {
  const nRows = costMatrix.length;
  const nCols = nRows ? costMatrix[0].length : 0;
  const n = Math.max(nRows, nCols);
  const BIG = 1e9;
  // pad to square
  const cost = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i < nRows && j < nCols) ? costMatrix[i][j] : BIG));
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);  // p[j] = row assigned to col j (1-indexed; 0 = none)
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = -1;
      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  // build row->col assignment (0-indexed); -1 if assigned to a padded col
  const rowToCol = new Array(nRows).fill(-1);
  for (let j = 1; j <= n; j++) {
    const i = p[j];
    if (i >= 1 && i <= nRows && j <= nCols) rowToCol[i - 1] = j - 1;
  }
  return rowToCol;
}

// ============================ GLOBAL UNIFORM Y-SCALE ESTIMATION ============================
// Estimate ONE global uniform scalar `s` = the multiply-factor applied to CLONE y-coords so scaled
// cloneCy ≈ srcCy (s ≈ srcPageH/clonePageH ≈ 1/hRatio). Robust path: find high-text-Dice ANCHOR pairs
// (content-identical nodes whose vertical position is trustworthy), take median(srcCy/cloneCy); require the
// anchor ratios to AGREE within ±YSCALE_INLIER_TOL (a uniform stretch ⇒ all anchors share one ratio; a
// SHUFFLED-y clone ⇒ anchors disagree wildly ⇒ robust fit REJECTED → pageH fallback, which only aligns the
// global span and CANNOT un-scramble the internal order → no rescue). Fallback: srcPageH/clonePageH.
// Cap to [YSCALE_MIN, YSCALE_MAX]; if |1 - s| < YSCALE_NOOP → s = 1 (no real stretch, no-op).
// Returns { s, basis, anchors, inlierAgree }.
function estimateYScale(srcNodes, cloneNodes, srcPageH, clonePageH) {
  if (!USE_YSCALE) return { s: 1, basis: 'disabled', anchors: 0, inlierAgree: null, medResid: null, validFrac: null };
  // --- collect ANCHOR pairs from content-identical (high text-Dice) nodes, position-INDEPENDENT ---
  // Greedy best-text-match per source text node (no position term → not circular with the broken matcher).
  // Keep BOTH the ratio (for the robust fit) AND the cy pair (for the anti-game validation gate).
  const srcText = srcNodes.map((n, i) => ({ n, i })).filter((x) => x.n.isText && x.n.text && x.n.text.length >= 4);
  const cloText = cloneNodes.map((n, j) => ({ n, j })).filter((x) => x.n.isText && x.n.text && x.n.text.length >= 4);
  const usedClone = new Set();
  const ratios = [];
  const anchorPairs = [];   // [srcCy, cloneCy]
  for (const { n: a } of srcText) {
    let best = -1, bestD = YSCALE_ANCHOR_DICE;
    for (const { n: b, j } of cloText) {
      if (usedClone.has(j)) continue;
      const d = dice(a.text, b.text);
      if (d > bestD) { bestD = d; best = j; }
    }
    if (best >= 0) {
      usedClone.add(best);
      const b = cloneNodes[best];
      if (a.cy > 1 && b.cy > 1) { ratios.push(a.cy / b.cy); anchorPairs.push([a.cy, b.cy]); }   // srcCy/cloneCy = multiply-factor on clone
    }
  }
  // --- candidate fit: robust median anchor ratio if anchors agree (uniform stretch), else pageH span ratio ---
  let cand = null, basis = 'none', inlierAgree = null;
  if (ratios.length >= 3) {
    const med = median(ratios);
    if (med && med > 0) {
      const inliers = ratios.filter((r) => Math.abs(r - med) / med <= YSCALE_INLIER_TOL);
      const frac = inliers.length / ratios.length;
      inlierAgree = +frac.toFixed(3);
      if (frac >= 0.6) { cand = median(inliers) || med; basis = 'robust-anchors'; }   // ≥60% share one ratio
    }
  }
  if (cand == null) {
    cand = (srcPageH > 0 && clonePageH > 0) ? srcPageH / clonePageH : 1;
    basis = 'pageH-fallback';
  }
  cand = Math.max(YSCALE_MIN, Math.min(YSCALE_MAX, cand));   // cap to a plausible uniform stretch/squash
  // --- ANTI-GAME VALIDATION GATE: APPLY cand ONLY if scaling makes the content anchors line up. ---
  // A SINGLE global scalar that truly explains a uniform stretch will collapse the anchor residuals; a
  // shuffled/reversed clone (no single scale can re-order it) leaves residuals large even when cand happens
  // to match the pageH span. This is the hard guard that keeps the fix from rescuing a mis-positioned clone.
  let medResid = null, validFrac = null, s = 1;
  if (anchorPairs.length >= 3) {
    const refH = Math.max(srcPageH, clonePageH * cand, 1);
    const resid = anchorPairs.map(([scy, ccy]) => Math.abs(scy - ccy * cand) / refH);
    medResid = +median(resid).toFixed(4);
    validFrac = +(resid.filter((r) => r < YSCALE_VALID_TOL).length / resid.length).toFixed(3);
    const corroborated = medResid < YSCALE_VALID_MEDRESID && validFrac >= YSCALE_VALID_INLIER_FRAC;
    if (corroborated) s = cand;                              // EARNED → apply the scale
    else basis = basis + '/rejected-noncorroborated';        // NOT corroborated → s stays 1 (no rescue)
  } else {
    basis = basis + '/insufficient-anchors';                 // can't validate → s stays 1 (no rescue)
  }
  // --- no-op guard (a tiny stretch isn't worth correcting) ---
  if (Math.abs(1 - s) < YSCALE_NOOP) { s = 1; basis = basis.includes('noop') ? basis : basis + '/noop'; }
  return { s, basis, anchors: ratios.length, inlierAgree, medResid, validFrac };
}

// ============================ run capture-layout.mjs (shell) ============================
function captureLayout(url, outPath) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'capture-layout.mjs'), '--source', url, '--out', outPath, '--width', String(width)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, env: process.env });
  if (r.status !== 0) { console.error(`capture-layout failed for ${url}:`, (r.stderr || '').slice(-500)); }
  if (!fs.existsSync(outPath)) throw new Error(`no layout produced for ${url}`);
  return JSON.parse(fs.readFileSync(outPath, 'utf8'));
}

// ============================ MAIN ============================
(async () => {
  const srcLayoutPath = `/tmp/pe-layout-${nameTag}-src.json`;
  const cloneLayoutPath = SELFTEST ? srcLayoutPath : `/tmp/pe-layout-${nameTag}-clone.json`;

  // TEST-ONLY layout reuse (default OFF, zero production effect): PE_REUSE_LAYOUT_SRC / PE_REUSE_LAYOUT_CLONE
  // point at pre-captured layout JSON so the y-scale fix + anti-game shuffled-y control can be verified
  // OFFLINE/DETERMINISTICALLY against fixed trees (no network, no capture nondeterminism). Production never sets these.
  const reuseSrc = process.env.PE_REUSE_LAYOUT_SRC, reuseClone = process.env.PE_REUSE_LAYOUT_CLONE;
  console.log(`[perelement] capturing SOURCE ${source} ...`);
  const srcLayout = (reuseSrc && fs.existsSync(reuseSrc)) ? JSON.parse(fs.readFileSync(reuseSrc, 'utf8')) : captureLayout(source, srcLayoutPath);
  let cloneLayout;
  if (SELFTEST) {
    console.log(`[perelement] SELFTEST → clone = source (reusing source tree)`);
    cloneLayout = JSON.parse(JSON.stringify(srcLayout));
  } else if (reuseClone && fs.existsSync(reuseClone)) {
    console.log(`[perelement] TEST reuse CLONE layout ${reuseClone}`);
    cloneLayout = JSON.parse(fs.readFileSync(reuseClone, 'utf8'));
  } else {
    console.log(`[perelement] capturing CLONE ${clone} ...`);
    cloneLayout = captureLayout(clone, cloneLayoutPath);
  }

  const srcNodesRaw = flatten(srcLayout.root);
  const cloneNodesRaw = flatten(cloneLayout.root);
  // page-default background of EACH side (for fade-in capture-artifact recovery in the COLOR sub-score). The clone's
  // captured-mid-fade text colors composite over the CLONE page bg; the source's settled colors are the recovery
  // target. Fall back to the other side's bg, then white (light pages are the fade-over-bg case this corrects).
  const clonePageBg = cloneNodesRaw.pageBg || srcNodesRaw.pageBg || [255, 255, 255];
  // SYMMETRIC BLOCK-MERGE PRE-PASS (research backlog #4): collapse adjacent same-typography wrapped-line
  // fragments into blocks on BOTH leaf lists BEFORE the cost matrix, so present-but-fragmented content stops
  // inflating unmatchedSrc/CloneArea and earns its areaCoverage credit. SAME function + SAME thresholds on
  // both sides → selftest (clone=source) is byte-identical → composite stays 1.0. Reversible: GRADER_NO_MERGE=1.
  const srcMerge = blockMerge(srcNodesRaw);
  const cloneMerge = blockMerge(cloneNodesRaw);
  const srcNodes = srcMerge.nodes;
  const cloneNodes = cloneMerge.nodes;
  console.log(`[perelement] source nodes: ${srcNodes.length} (merged ${srcMerge.merged} of ${srcNodesRaw.length}) | clone nodes: ${cloneNodes.length} (merged ${cloneMerge.merged} of ${cloneNodesRaw.length}) | mergePrePass=${USE_MERGE ? 'ON' : 'OFF'}`);

  // GDA GROUP-COUNT STRUCTURAL SHADOW METRIC (REPORT-ONLY): score whether the clone reproduced the right COUNT
  // of each REPEATED element-type. Computed on the FINALIZED merged leaf sets (same sets the matcher uses) →
  // PURE/deterministic. NOT folded into composite/visual/structural/editability (grade-sections.mjs ignores it).
  const gda = gdaGroupCountReport(srcNodes, cloneNodes);

  const srcH = srcLayout.pageH || 4000, cloneH = cloneLayout.pageH || 4000;
  const refW = width;

  // ----- GLOBAL UNIFORM Y-SCALE (PASS 1 alignment) -----
  // Estimate ONE scalar y-scale `s` (multiply-factor on CLONE y so scaled cloneCy ≈ srcCy). SELFTEST/no-stretch
  // → s=1 (no-op, byte-for-byte prior). The cost matrix, geomOk gate, and areaCoverage (PASS 1, all y-INDEPENDENT
  // content props) run on SCALED clone y; the POSITION sub-score (PASS 2) runs on RAW y so drift is still penalized.
  const ys = estimateYScale(srcNodes, cloneNodes, srcH, cloneH);
  const S = ys.s;
  // scaled clone vertical coords (PASS 1). h is scaled too so big page-spanning containers shrink to source band.
  const cloneCyScaled = cloneNodes.map((b) => b.cy * S);
  // refH for PASS 1 (content match / areaCoverage gating): recompute on the SCALED clone height so a uniform
  // stretch no longer inflates the normalizer. refH for PASS 2 (position penalty) stays on RAW heights.
  const refHscaled = Math.max(srcH, cloneH * S, 1);
  const refHraw = Math.max(srcH, cloneH, 1);

  // ----- COST MATRIX (PASS 1: SCALED clone y) -----
  // cost = w1*(1-textDice) + w2*(1-typeMatch) + w3*centerDistNorm
  const W1 = 0.5, W2 = 0.2, W3 = 0.3;
  const m = srcNodes.length, k = cloneNodes.length;
  const cost = Array.from({ length: m }, () => new Array(k).fill(1));
  for (let i = 0; i < m; i++) {
    const a = srcNodes[i];
    for (let j = 0; j < k; j++) {
      const b = cloneNodes[j];
      const td = dice(a.text, b.text);
      const ty = typoScore(a.typo, b.typo);
      const typeMatch = ty == null ? (a.isText === b.isText ? 0.5 : 0) : ty;
      const dcx = Math.abs(a.cx - b.cx) / refW;
      const dcy = Math.abs(a.cy - cloneCyScaled[j]) / refHscaled;
      const centerDist = Math.min(1, Math.hypot(dcx, dcy));
      cost[i][j] = W1 * (1 - td) + W2 * (1 - typeMatch) + W3 * centerDist;
    }
  }

  // ----- ASSIGN -----
  let rowToCol = [];
  if (m && k) rowToCol = hungarian(cost);

  // ----- FILTER: Design2Code text-similarity < 0.5 => unmatched (geomOk gate on SCALED clone y) -----
  const matchedSrc = new Set(), matchedClone = new Set();
  const pairs = [];
  for (let i = 0; i < m; i++) {
    const j = rowToCol[i];
    if (j == null || j < 0 || j >= k) continue;
    const a = srcNodes[i], b = cloneNodes[j];
    const td = dice(a.text, b.text);
    // Design2Code rail: a matched pair must clear text-similarity >= 0.5.
    // EXCEPTION: pure non-text fidelity nodes (both sides textless: containers/images) have no text to
    // compare — they pass on geometric overlap instead (else NO container/image ever matches). The geomOk
    // gate uses the SCALED clone y (PASS 1): a uniformly-stretched-but-correct container now co-locates.
    const bothTextless = !a.isText && !b.isText;
    const cx = Math.abs(a.cx - b.cx) / refW, cy = Math.abs(a.cy - cloneCyScaled[j]) / refHscaled;
    const geomOk = Math.hypot(cx, cy) < 0.25;
    if (!bothTextless && td < 0.5) continue;          // text nodes that don't share text → unmatched
    if (bothTextless && !geomOk) continue;            // textless nodes that aren't co-located → unmatched
    matchedSrc.add(i); matchedClone.add(j);
    pairs.push({ a, b, td, cyScaled: cloneCyScaled[j] });
  }

  // ----- PER-PAIR SUB-SCORES -----
  const colorVals = [], typoVals = [], posVals = [], textVals = [], effVals = [];
  let matchedArea = 0;
  for (const { a, b, td } of pairs) {
    matchedArea += Math.min(a.area, b.area);
    // COLOR (y-INDEPENDENT content prop → credited on the scale-aligned match). FADE-AWARE: recover a clone text
    // color the capture sampled MID-fade-in (scroll-reveal) when it is the fade-in composite of the SOURCE settled
    // color over the clone page bg (see colorScoreFadeAware/fadeRecoverScore — asymmetric, source-anchored, NOT a boost).
    const cs = colorScoreFadeAware(a.color, b.color, clonePageBg);
    // COLOR-CHANNEL DE-CONFLATION (default ON; GRADER_NO_COLOR_DECONFLATE=1 → exact prior behavior): a pair where
    // ONLY ONE side carries a paintable color (e.g. a source container painting a near-page-bg fill matched to a
    // clone wrapper that paints none) is a STRUCTURAL/COVERAGE signal — the clone didn't reproduce that painted
    // surface — NOT a color-FIDELITY signal. It is ALREADY penalized in areaCoverage (the wrapper's area dumps into
    // unmatched/extra). Folding its hard-0 into the COLOR mean DOUBLE-COUNTS the structural miss inside the color
    // channel (the documented over-penalty). So one-sided-color pairs are DROPPED from the color mean (they remain
    // fully counted in areaCoverage). BOTH-sided real mismatches (wrong hue/value) STILL score 0 → stay penalized.
    // Self-test (clone==source): never one-sided → no-op. Anti-gaming: a wrong-COLOR clone has color on BOTH sides
    // → still scored (and low) → NOT dropped.
    const oneSidedColor = USE_COLOR_DECONFLATE && cs === 0 && (parseColor(a.color) == null) !== (parseColor(b.color) == null);
    if (cs != null && !oneSidedColor) colorVals.push(cs);
    // TYPOGRAPHY (y-INDEPENDENT content prop)
    const ts = typoScore(a.typo, b.typo);
    if (ts != null) typoVals.push(ts);
    // POSITION = 1 - clamp(max(|dcx|,|dcy|)/refDim) — PASS 2: RAW (un-scaled) y + RAW refH, so the vertical
    // drift is STILL penalized in the position channel even though it was tolerated for the content match.
    const dcx = Math.abs(a.cx - b.cx) / refW;
    const dcy = Math.abs(a.cy - b.cy) / refHraw;
    const pos = 1 - Math.min(1, Math.max(dcx, dcy));
    posVals.push(pos);
    // TEXT (y-INDEPENDENT content prop)
    textVals.push(td);
    // EFFECTS = agreement of {border-radius, box-shadow, backdrop-filter} (null when the pair has no effect signal)
    const es = effectsScore(a, b);
    if (es != null) effVals.push(es);
  }

  // ----- AREA COVERAGE (symmetric) -----
  let unmatchedSrcArea = 0, unmatchedCloneArea = 0;
  for (let i = 0; i < m; i++) if (!matchedSrc.has(i)) unmatchedSrcArea += srcNodes[i].area;
  for (let j = 0; j < k; j++) if (!matchedClone.has(j)) unmatchedCloneArea += cloneNodes[j].area;
  const areaDenom = matchedArea + unmatchedSrcArea + unmatchedCloneArea;
  const areaCoverage = areaDenom > 0 ? matchedArea / areaDenom : (pairs.length ? 1 : 0);
  if(process.env.PE_DUMP){
    const byKind={};let totUnSrc=0;
    for(let i=0;i<m;i++){if(matchedSrc.has(i))continue;const n=srcNodes[i];const k=(n.isText?"text":(n.kind||(n.tag?"el:"+n.tag:"container")));byKind[k]=byKind[k]||{c:0,area:0};byKind[k].c++;byKind[k].area+=n.area;totUnSrc+=n.area;}
    const tot=srcNodes.reduce((s,n)=>s+n.area,0);
    console.error("=== UNMATCHED-SOURCE by kind (area-frac of page) ===");
    for(const k of Object.keys(byKind).sort((a,b)=>byKind[b].area-byKind[a].area))console.error("  "+k+": count="+byKind[k].c+" areaFrac="+(byKind[k].area/tot).toFixed(4));
    console.error("  TOTAL unmatched-src areaFrac="+(totUnSrc/tot).toFixed(4)+" | areaCoverage="+ (areaDenom>0?matchedArea/areaDenom:0).toFixed(4));
    // also dump unmatched CLONE by kind
    const byKindC={};let totUnC=0;
    for(let j=0;j<k;j++){if(matchedClone.has(j))continue;const n=cloneNodes[j];const kk=(n.isText?"text":(n.kind||(n.tag?"el:"+n.tag:"container")));byKindC[kk]=byKindC[kk]||{c:0,area:0};byKindC[kk].c++;byKindC[kk].area+=n.area;totUnC+=n.area;}
    const totC=cloneNodes.reduce((s,n)=>s+n.area,0);
    console.error("=== UNMATCHED-CLONE by kind (area-frac of clone) ===");
    for(const kk of Object.keys(byKindC).sort((a,b)=>byKindC[b].area-byKindC[a].area))console.error("  "+kk+": count="+byKindC[kk].c+" areaFrac="+(byKindC[kk].area/totC).toFixed(4));
    console.error("  TOTAL unmatched-clone areaFrac="+(totUnC/totC).toFixed(4));
  }

  const mean = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : (pairs.length ? 1 : 0);
  const r4 = (x) => Math.round(x * 10000) / 10000;

  // RDA 3x3-QUADRANT POSITION-SHADOW METRIC (REPORT-ONLY): bin each matched pair's element CENTER into a 3x3
  // grid cell (col by viewport width refW, row by THAT side's own page height) and HARD-ZERO any pair whose
  // clone center lands in a different quadrant than its source — with a 5%-of-dim dead-band so a near-boundary
  // nudge (and identity-recapture jitter) is forgiven. Computed on the SAME matched pairs + centers the smooth
  // position sub-score uses → PURE/deterministic. NOT folded into composite/visual/position/structural (the
  // upstream grader reads only color/typography/position/text/effects/areaCoverage). Catches the gross mis-
  // placement the smooth metric (raw posRaw) partial-credits.
  const rda = rdaQuadrantReport(pairs, refW, srcH, cloneH);

  // colorGlyph RENDERED-COLOR SHADOW METRIC (REPORT-ONLY): the LAST mis-measured dimension (COLOR). For each matched
  // TEXT pair, CIEDE2000 the BEST-AVAILABLE concrete color per side (rendered foreground glyph sample paint.glyphRGB
  // first — the truth for gradient/oklch/clipped text the CSS-parse metric returns ~0 for — else parseColor(color)).
  // Reports BOTH the glyph mean AND the CSS-parse color mean over the SAME pairs so the divergence is visible.
  // Computed on the SAME matched pairs → PURE/deterministic. NOT folded into composite/visual/color (see colorGlyphReport).
  const cg = colorGlyphReport(pairs);

  // raw per-pair means
  const colorRaw = mean(colorVals), typoRaw = mean(typoVals), posRaw = mean(posVals), textRaw = mean(textVals), effRaw = mean(effVals);
  // MULTIPLY each sub-score by symmetric area-coverage (penalizes missing/extra content) — EFFECTS gets the
  // SAME area-coverage multiply as every other sub-score (symmetric; folds away when no pair has an effect).
  // COLOR-CHANNEL DE-CONFLATION (default ON; GRADER_NO_COLOR_DECONFLATE=1 → prior × areaCoverage): COLOR reports the
  // color FIDELITY of matched-on-both-sides content (one-sided pairs already dropped at the pair loop) WITHOUT the
  // second areaCoverage multiply — page completeness is already its OWN signal (reported areaCoverage + the
  // composite's structuralFidelity term), so multiplying it INTO color double-counted the structural miss and
  // false-deflated correct colors (supabase: 0.81→0.26). TYPOGRAPHY is now ALSO de-conflated (same double-count, same
  // fix — framer: 0.84–0.92 typoRaw crushed to 0.13–0.28 by areaCoverage 0.12–0.34); position/text/effects UNCHANGED
  // (still ×coverage). Self-test no-op (colorRaw=typoRaw=coverage=1). Anti-gaming: wrong-color/wrong-font clone keeps
  // low colorRaw/typoRaw → low color/typo regardless of coverage.
  const colorReported = USE_COLOR_DECONFLATE ? colorRaw : colorRaw * areaCoverage;
  const typoReported = USE_TYPO_DECONFLATE ? typoRaw : typoRaw * areaCoverage;
  const result = {
    color: r4(colorReported),
    typography: r4(typoReported),
    position: r4(USE_POS_DECONFLATE ? posRaw : posRaw * areaCoverage),
    text: r4(USE_TEXT_DECONFLATE ? textRaw : textRaw * areaCoverage),
    effects: r4(USE_EFFECTS_DECONFLATE ? effRaw : effRaw * areaCoverage),
    areaCoverage: r4(areaCoverage),
  };

  const full = {
    site: nameTag, source, clone: SELFTEST ? source : clone, selftest: SELFTEST,
    srcNodes: srcNodes.length, cloneNodes: cloneNodes.length,
    matchedPairs: pairs.length,
    // SYMMETRIC BLOCK-MERGE telemetry (reversible via GRADER_NO_MERGE=1).
    blockMerge: { applied: USE_MERGE, srcRaw: srcNodesRaw.length, srcMerged: srcMerge.merged, cloneRaw: cloneNodesRaw.length, cloneMerged: cloneMerge.merged },
    // GLOBAL UNIFORM Y-SCALE telemetry (reversible via GRADER_NO_YSCALE=1).
    yScale: { applied: USE_YSCALE, s: r4(S), basis: ys.basis, anchors: ys.anchors, inlierAgree: ys.inlierAgree, medResid: ys.medResid, validFrac: ys.validFrac, srcPageH: srcH, clonePageH: cloneH },
    raw: { color: r4(colorRaw), typography: r4(typoRaw), position: r4(posRaw), text: r4(textRaw), effects: r4(effRaw) },
    colorSamples: colorVals.length, typoSamples: typoVals.length, effectsSamples: effVals.length,
    ...result,
    // GDA GROUP-COUNT STRUCTURAL SHADOW METRIC — REPORT-ONLY, NOT folded into the composite (see gdaGroupCountReport).
    // gdaGroupCount = srcCount-weighted mean over race-groups of ramp(cloneCount/srcCount); null if no repeated structure.
    gdaGroupCount: gda.gdaGroupCount,
    gdaGroupCountEqual: gda.gdaGroupCountEqual,
    gdaGroups: gda.groupsN,
    gdaGroupDetail: gda.groups,
    // RDA 3x3-QUADRANT POSITION-SHADOW METRIC — REPORT-ONLY, NOT folded into the composite (see rdaQuadrantReport).
    // rdaQuadrant = mean over matched pairs of {1.0 if clone center in SAME 3x3 quadrant as source (or within the
    // 5%-of-dim near-boundary dead-band), else 0.0}. null if no matched pairs. Catches gross mis-placement the
    // smooth position sub-score (raw.position) partial-credits. Identity self-test → 1.0.
    rdaQuadrant: rda.rdaQuadrant,
    rdaPairs: rda.pairsN,
    rdaQuadrantDetail: rda.pairs,
    // colorGlyph RENDERED-COLOR SHADOW METRIC — REPORT-ONLY, NOT folded into the composite (see colorGlyphReport).
    // colorGlyph = mean over matched TEXT pairs of the CIEDE2000 color match using the rendered foreground GLYPH
    // sample (paint.glyphRGB) when the CSS color is unresolvable (gradient-text/oklch/lab/var/null), else the parsed
    // CSS color. colorGlyphCssParse = the OLD CSS-parse color sub-score (colorScore) over the SAME pairs — exposes
    // where the parse mis-measured (returned ~0/dropped) the colors colorGlyph now credits from the rendered pixels.
    // Identity self-test → 1.0. NEVER touches composite/visual/color/structural/editability.
    colorGlyph: cg.colorGlyph,
    colorGlyphCssParse: cg.colorGlyphCssParse,
    colorGlyphSamples: cg.colorGlyphSamples,
    colorGlyphCssSamples: cg.colorGlyphCssSamples,
    colorGlyphFallbackPairs: cg.colorGlyphFallbackPairs,
    colorGlyphDetail: cg.colorGlyphDetail,
  };

  const outFile = `/tmp/pe-${nameTag}.json`;
  fs.writeFileSync(outFile, JSON.stringify(full, null, 2));
  console.log(JSON.stringify(result));
  console.log(`[perelement] yScale s=${r4(S)} (${ys.basis}, anchors=${ys.anchors}, inlierAgree=${ys.inlierAgree}, medResid=${ys.medResid}, validFrac=${ys.validFrac}) | wrote ${outFile}  (matched ${pairs.length} pairs; color n=${colorVals.length}, typo n=${typoVals.length})`);
  // GDA GROUP-COUNT STRUCTURAL SHADOW (report-only; NOT in composite). Logged so the under-capture it exposes is visible.
  console.log(`[perelement] GDA groupCount=${gda.gdaGroupCount} (equal-wt=${gda.gdaGroupCountEqual}) over ${gda.groupsN} race-group(s)` + (gda.groups.length ? ` | top: ${gda.groups.slice(0, 4).map((g) => `${g.cloneCount}/${g.srcCount}=${g.score}`).join(', ')}` : ' | none (no repeated structure)') + ` [SHADOW: report-only, not in composite/visual/structural/editability]`);
  // RDA 3x3-QUADRANT POSITION-SHADOW (report-only; NOT in composite). Logged alongside the SMOOTH position sub-score
  // (raw.position) so the gross mis-placement the rail hard-zeros — and the smooth metric forgives — is visible.
  console.log(`[perelement] RDA quadrant=${rda.rdaQuadrant} over ${rda.pairsN} matched pair(s) | smooth-position(raw)=${r4(posRaw)} (rail < smooth ⇒ catches cross-quadrant misses the smooth metric partial-credited) [SHADOW: report-only, not in composite/visual/position/structural/editability]`);
  // colorGlyph RENDERED-COLOR SHADOW (report-only; NOT in composite). Logged ALONGSIDE the CSS-parse color sub-score
  // over the SAME text-pair set so the divergence (where the parse returned ~0/dropped gradient/oklch colors that the
  // rendered glyph sample now credits) is visible. colorGlyph != colorGlyphCssParse ⇒ the parse mis-measured COLOR.
  console.log(`[perelement] colorGlyph=${cg.colorGlyph} vs CSS-parse-color=${cg.colorGlyphCssParse} over text pairs (glyph n=${cg.colorGlyphSamples}, css n=${cg.colorGlyphCssSamples}; ${cg.colorGlyphFallbackPairs} pair(s) used the rendered-glyph fallback where CSS color was unresolvable: gradient-text/oklch/lab/var/null) [SHADOW: report-only, not in composite/visual/color/structural/editability]`);

  if (SELFTEST) {
    const subs = ['color', 'typography', 'position', 'text', 'effects', 'areaCoverage'];
    const bad = subs.filter((s) => Math.abs(result[s] - 1) > 0.005);
    if (bad.length) { console.error(`[SELFTEST FAIL] sub-scores != 1.0: ${bad.map((s) => `${s}=${result[s]}`).join(', ')}`); process.exit(1); }
    // colorGlyph identity rail: source-vs-source → each pair's concrete color matches itself → colorGlyph == 1.0
    // (mirrors the GDA/RDA identity rails). null is allowed (no text pairs); a present value MUST be 1.0.
    if (cg.colorGlyph != null && Math.abs(cg.colorGlyph - 1) > 0.005) { console.error(`[SELFTEST FAIL] colorGlyph != 1.0 on identity: ${cg.colorGlyph}`); process.exit(1); }
    console.log(`[SELFTEST PASS] all sub-scores == 1.0 (colorGlyph identity = ${cg.colorGlyph})`);
  }
})().catch((e) => { console.error('perelement-score error:', e); process.exit(1); });
