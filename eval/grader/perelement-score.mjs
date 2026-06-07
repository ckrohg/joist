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
  return out.filter((x) => x.box && x.box.w > 0 && x.box.h > 0);
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
  // SYMMETRIC BLOCK-MERGE PRE-PASS (research backlog #4): collapse adjacent same-typography wrapped-line
  // fragments into blocks on BOTH leaf lists BEFORE the cost matrix, so present-but-fragmented content stops
  // inflating unmatchedSrc/CloneArea and earns its areaCoverage credit. SAME function + SAME thresholds on
  // both sides → selftest (clone=source) is byte-identical → composite stays 1.0. Reversible: GRADER_NO_MERGE=1.
  const srcMerge = blockMerge(srcNodesRaw);
  const cloneMerge = blockMerge(cloneNodesRaw);
  const srcNodes = srcMerge.nodes;
  const cloneNodes = cloneMerge.nodes;
  console.log(`[perelement] source nodes: ${srcNodes.length} (merged ${srcMerge.merged} of ${srcNodesRaw.length}) | clone nodes: ${cloneNodes.length} (merged ${cloneMerge.merged} of ${cloneNodesRaw.length}) | mergePrePass=${USE_MERGE ? 'ON' : 'OFF'}`);

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
    // COLOR (y-INDEPENDENT content prop → credited on the scale-aligned match)
    const cs = colorScore(a.color, b.color);
    if (cs != null) colorVals.push(cs);
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

  const mean = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : (pairs.length ? 1 : 0);
  const r4 = (x) => Math.round(x * 10000) / 10000;

  // raw per-pair means
  const colorRaw = mean(colorVals), typoRaw = mean(typoVals), posRaw = mean(posVals), textRaw = mean(textVals), effRaw = mean(effVals);
  // MULTIPLY each sub-score by symmetric area-coverage (penalizes missing/extra content) — EFFECTS gets the
  // SAME area-coverage multiply as every other sub-score (symmetric; folds away when no pair has an effect).
  const result = {
    color: r4(colorRaw * areaCoverage),
    typography: r4(typoRaw * areaCoverage),
    position: r4(posRaw * areaCoverage),
    text: r4(textRaw * areaCoverage),
    effects: r4(effRaw * areaCoverage),
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
  };

  const outFile = `/tmp/pe-${nameTag}.json`;
  fs.writeFileSync(outFile, JSON.stringify(full, null, 2));
  console.log(JSON.stringify(result));
  console.log(`[perelement] yScale s=${r4(S)} (${ys.basis}, anchors=${ys.anchors}, inlierAgree=${ys.inlierAgree}, medResid=${ys.medResid}, validFrac=${ys.validFrac}) | wrote ${outFile}  (matched ${pairs.length} pairs; color n=${colorVals.length}, typo n=${typoVals.length})`);

  if (SELFTEST) {
    const subs = ['color', 'typography', 'position', 'text', 'effects', 'areaCoverage'];
    const bad = subs.filter((s) => Math.abs(result[s] - 1) > 0.005);
    if (bad.length) { console.error(`[SELFTEST FAIL] sub-scores != 1.0: ${bad.map((s) => `${s}=${result[s]}`).join(', ')}`); process.exit(1); }
    console.log(`[SELFTEST PASS] all sub-scores == 1.0`);
  }
})().catch((e) => { console.error('perelement-score error:', e); process.exit(1); });
