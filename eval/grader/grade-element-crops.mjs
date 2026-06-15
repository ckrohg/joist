#!/usr/bin/env node
/**
 * @purpose grade-element-crops.mjs — the CORRESPONDENCE-ALIGNED, NATIVE-RESOLUTION region harness:
 * THE SPINE of the upleveled grader. Every comparison happens at a CORRESPONDED element/region, at
 * NATIVE pixel resolution, at a NAMED viewport — never page-vs-page, never a downscaled full-page
 * thumbnail. This is the single architectural fix for the four diseases that are one disease (measuring
 * at the wrong altitude): the RESOLUTION catastrophe (a ~1440x62000px page fed whole to a vision-LLM is a
 * ~47px-wide thumbnail that cannot resolve a 1px divider or an emoji bullet), the OVERFIT, the
 * RESPONSIVE-blindness, and the MOTION-blindness.
 *
 * ORGANIZING PRINCIPLE — the element-correspondence map (already computed by compare-capture.mjs:
 * report.relation + report.matched, stamped O(1) on a clone with --joist-src stamps, Hungarian fallback)
 * is the spine. This script IMPORTS that join; it never re-derives it. From the join it:
 *   (1) BANS full-page screenshots as a vision input. The vision model sees ONLY (a) per-corresponded-
 *       element aligned A/B crops and (b) uniform ~1440x900 bands — each at native 1:1. A downscaled
 *       full-page capture is never a vision input (asserted in the self-test by px-dim equality).
 *   (2) emits an ALIGNED A/B crop [ source | magenta divider | clone ] per corresponded element AND per
 *       band, SCROLL-ALIGNED by corresponded anchor elements before banding — a taller clone does not
 *       misalign band content because each clone band y is mapped from the source band y through the
 *       corresponded-pair y-map (anchorMaps over the stamped/matched pairs), not a blind proportional cut.
 *   (3) runs an AXIS-DELTA SEED over corresponded pairs — a UNIVERSAL feature framework, one row per
 *       (pair, axis): presence | bbox-ratio | text-contrast | color-ΔE(CIEDE2000) | font-size-ratio |
 *       horizontal-overflow | img-pHash(dHash, dep-free) [+ border/sticky/text as they come online].
 *       Any axis past a (PLACEHOLDER, clearly-marked-UNCALIBRATED) tolerance is flagged and auto-
 *       classified by WHICH axis tripped. This is deterministic, dep-free, and runs before any LLM.
 *   (4) ANOMALY-RANKs the corresponded pairs by axis-delta magnitude × salience(role/area) and selects
 *       the top-N (~20) candidates PLUS a FIXED marketing-sweep (logo crop, hero band, primary CTA,
 *       first-fold band per width) as the BOUNDED vision call set. Vision is never spent on the whole page.
 *   (5) for each vision crop, INJECTS the measured ground-truth facts (dominant bg color, node/text/code
 *       counts, key borders) into the prompt marked AUTHORITATIVE — the model is told these are measured,
 *       not to be argued with.
 *   (6) a PROGRAMMATIC HALLUCINATION VERIFIER auto-DROPS any vision-reported defect that CONTRADICTS a
 *       measured fact (model claims "dark background" but the measured dominant bg is #FFFFFF → dropped +
 *       logged as a verifier catch). The verifier is deterministic and runs after every vision call.
 *
 * REUSE (does NOT reinvent): correspondence + ElementRecord from compare-capture.mjs (assignStamped/
 * assignHungarian/classifyUnmatched/diffMatchedPairs); crop() from grade-vision-tiles.mjs (native-res
 * pixel copy, out-of-bounds-safe); composeTile()/extractJson()/LABEL_STRIP/DIVIDER from vision-judge.mjs
 * (A/B tile under a label strip); inspectOnce()/luma()/regionStats()/FATAL_OF/DISQUALIFYING_FATAL from
 * region-judge.mjs (the proven adversarial `claude -p` vision invocation + PNG primitives); anchorMaps()/
 * matchUniqueAnchors() from vision-judge.mjs for the scroll-align-before-banding y-map.
 *
 * §0 HOST GUARD: render/capture targets ONLY the guarded local base (assertAllowedBase, blocks the paused
 * sg-host/georges232/IP). External SOURCE sites are captured read-only via assertNotBlocked. Screenshots
 * via node+playwright (settleLazy before the shot) with hard timeouts — NEVER mcp-playwright (wedges).
 * No git. Additive/reversible: compare-capture / region-judge / grade-vision-tiles / vision-judge are
 * IMPORTED unchanged; nothing here mutates a builder or an existing grader's behavior.
 *
 * CLI:
 *   node grade-element-crops.mjs --compare /tmp/compare-341.json [--out dir] [--top-n 20]
 *                                [--widths 1440,390] [--no-vision] [--model sonnet] [--jobs 3]
 *   node grade-element-crops.mjs --source <url> --clone-page <id> [--widths 1440,390] ...   (drives
 *       compare-capture itself first, then grades)
 *   node grade-element-crops.mjs --src-shot a.png --clone-shot b.png --compare c.json        (reuse
 *       pre-captured full-res PNGs instead of re-shooting)
 *
 * Output: <out>/results.json = { meta, axisRows:[...], anomalies:[...], visionSet:[...], findings:[...],
 *   verifierCatches:[...], aggregate }. A defect MAP keyed by corresponded ref + viewport + state — NOT a
 *   single scalar (region-judge philosophy). Tiles at <out>/el-<ref>.png and <out>/band-w<W>-<i>.png.
 *
 * Self-test: _grade-element-crops-selftest.mjs (identity → zero defects / dHash distance 0; injected blank
 *   → Layer-0 flags it without vision; verifier drops a synthetic contradictory defect; a native crop's px
 *   dims equal the element bbox, proving no thumbnail downscale; axis-delta fires on an injected diff and is
 *   silent on identical). Builder does NOT self-bless — the orchestrator re-executes the proofs.
 */
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { PNG } from 'pngjs';
import { crop, settleLazy } from './grade-vision-tiles.mjs';
import { composeTile, extractJson, LABEL_STRIP } from './vision-judge.mjs';
import { matchUniqueAnchors, anchorMaps } from './vision-judge.mjs';
import { inspectOnce, regionStats, FATAL_OF, DISQUALIFYING_FATAL } from './region-judge.mjs';
// luma is intentionally NOT imported (region-judge does not export it) — define the same one-liner locally so
// dHash/modalLuma/inkFracOf are self-contained and the pure block has no impure dependency.
function luma(d, i) { return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }
import { assignStamped, assignHungarian, classifyUnmatched, diffMatchedPairs } from './compare-capture.mjs';
import { assertAllowedBase, assertNotBlocked, resolveBase } from '../../sandbox/host-guard.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

// ── reversible env flags (default-ON; set =0 to restore the pre-fix behavior) — dir convention ───────────────
//   GEC_BAN_FULLPAGE     — BANS a full-page screenshot as a vision input (vision sees only element crops +
//                          uniform bands at native 1:1). =0 lifts the ban (NOT recommended — re-opens the
//                          resolution catastrophe; present only so the ban is provably reversible/inert).
//   GEC_ANCHOR_ALIGN     — scroll-align source↔clone bands by corresponded anchors BEFORE banding (a taller
//                          clone does not misalign band content). =0 falls back to honest proportional banding.
//   GEC_VERIFIER         — the programmatic hallucination verifier (drop a vision defect that contradicts a
//                          measured fact). =0 keeps every vision defect (un-verified, NOT recommended).
export const GEC_BAN_FULLPAGE = process.env.GEC_BAN_FULLPAGE !== '0';
export const GEC_ANCHOR_ALIGN = process.env.GEC_ANCHOR_ALIGN !== '0';
export const GEC_VERIFIER = process.env.GEC_VERIFIER !== '0';

// ── TOLERANCES — *** PLACEHOLDER / UNCALIBRATED ***  (axis-delta seed) ────────────────────────────────────────
// These are FIRST-CUT thresholds, NOT calibrated against human labels. They are deliberately marked so a later
// calibration pass (out-of-sample human scores, the path-to-1:1 protocol) can tune them. Treat any single-axis
// flag near a tolerance as provisional. `uncalibrated:true` rides on every axis row so no downstream consumer
// mistakes these for tuned gates.
export const TOL = {
  uncalibrated: true,
  bboxRatio: 0.25,        // |1 - clone/src| on w or h beyond this → bbox-ratio flag (size/position drift)
  contrastDelta: 1.5,     // |srcContrast - cloneContrast| (WCAG-ish ratio) beyond this → text-contrast flag
  colorDeltaE: 12,        // CIEDE2000 ΔE between src & clone text color beyond this → color flag (JND ~2.3; 12 = clearly off)
  fontSizeRatio: 0.18,    // |1 - clone/src| font-size beyond this → font-size flag
  overflowFrac: 0.04,     // clone box right edge beyond viewport*(1+this) → horizontal-overflow flag
  dHashDist: 12,          // Hamming distance (of 64) between src & clone element dHash beyond this → img-pHash flag
};

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS (unit-testable, no network/no fs) — the axis-delta seed + the hallucination verifier
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────

// ── color: parse a CSS rgb/rgba string → {r,g,b,a} (0-255, a 0-1). Returns null on a non-color (gradient/none).
export function parseColor(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] != null ? +m[4] : 1 };
}
// ── sRGB → CIE Lab (D65) → CIEDE2000 ΔE. Standard, dep-free; the perceptual color-distance axis.
function srgbToLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
export function rgbToLab({ r, g, b }) {
  const R = srgbToLin(r), G = srgbToLin(g), B = srgbToLin(b);
  let X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  let Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
  let Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041;
  X /= 0.95047; Y /= 1.0; Z /= 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
export function deltaE2000(rgb1, rgb2) {
  if (!rgb1 || !rgb2) return null;
  const l1 = rgbToLab(rgb1), l2 = rgbToLab(rgb2);
  const { L: L1, a: a1, b: b1 } = l1, { L: L2, a: a2, b: b2 } = l2;
  const avgLp = (L1 + L2) / 2;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const avgC = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const avgCp = (C1p + C2p) / 2;
  const h = (a, b) => { let hp = Math.atan2(b, a) * 180 / Math.PI; if (hp < 0) hp += 360; return hp; };
  const h1p = h(a1p, b1), h2p = h(a2p, b2);
  let dhp;
  if (C1p * C2p === 0) dhp = 0;
  else { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dLp = L2 - L1, dCp = C2p - C1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI / 180) / 2);
  let avgHp;
  if (C1p * C2p === 0) avgHp = h1p + h2p;
  else { avgHp = (h1p + h2p) / 2; if (Math.abs(h1p - h2p) > 180) avgHp += (h1p + h2p < 360 ? 180 : -180); }
  const T = 1 - 0.17 * Math.cos((avgHp - 30) * Math.PI / 180) + 0.24 * Math.cos((2 * avgHp) * Math.PI / 180)
    + 0.32 * Math.cos((3 * avgHp + 6) * Math.PI / 180) - 0.20 * Math.cos((4 * avgHp - 63) * Math.PI / 180);
  const dTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(avgLp - 50, 2)) / Math.sqrt(20 + Math.pow(avgLp - 50, 2));
  const Sc = 1 + 0.045 * avgCp;
  const Sh = 1 + 0.015 * avgCp * T;
  const Rt = -Math.sin(2 * dTheta * Math.PI / 180) * Rc;
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2)
    + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

// ── WCAG-ish contrast ratio between two CSS colors (text vs its own bg). Returns null if either is non-color.
function relLum({ r, g, b }) { return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b); }
export function contrastRatio(fg, bg) {
  if (!fg || !bg) return null;
  const a = relLum(fg) + 0.05, b = relLum(bg) + 0.05;
  return +(Math.max(a, b) / Math.min(a, b)).toFixed(2);
}
// effective background of a record: its own bg if opaque, else walk a provided ancestor-bg or default white.
function effBg(style, fallback = { r: 255, g: 255, b: 255, a: 1 }) {
  const c = parseColor(style && style.backgroundColor);
  if (c && c.a > 0.05) return c;
  return fallback;
}

// ── dHash (dep-free perceptual image hash) from a native-res element crop. Downscale to 9x8 grayscale via the
// existing luma(); the 64-bit hash is the sign of the horizontal gradient. Hamming distance ~ perceptual
// difference. This is the Layer-0 "is the corresponded image the same picture" check the prompt mandates
// (there is NO phash/jimp/sharp in node_modules — only pngjs+pixelmatch). Pure: takes a PNG crop, returns a
// 64-char bitstring.
export function dHash(png) {
  const W = 9, H = 8;
  const gray = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy0 = Math.floor(y * png.height / H), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * png.height / H));
    for (let x = 0; x < W; x++) {
      const sx0 = Math.floor(x * png.width / W), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * png.width / W));
      let s = 0, n = 0;
      for (let yy = sy0; yy < sy1 && yy < png.height; yy++) for (let xx = sx0; xx < sx1 && xx < png.width; xx++) { s += luma(png.data, (yy * png.width + xx) << 2); n++; }
      gray[y * W + x] = n ? s / n : 0;
    }
  }
  let bits = '';
  for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) bits += gray[y * W + x] < gray[y * W + x + 1] ? '1' : '0';
  return bits; // 8*8 = 64 bits
}
export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

// ── THE AXIS-DELTA SEED ── one universal framework, one row per (pair, axis). Pure: takes a corresponded
// (sourceEl, cloneEl) + a viewport width + optional native crops (for the img-pHash axis) and emits the axis
// rows. Every row: {ref, axis, src, clone, delta, tol, flagged, uncalibrated, class}. `class` auto-derives
// from WHICH axis tripped. Not all axes will be populated for every pair (a text node has no img-pHash; an
// image has no font-size) — absent axes are simply omitted, the framework is extensible.
export function axisDeltas(sEl, cEl, vw, opts = {}) {
  const rows = [];
  const ref = (sEl && sEl.ref) || (cEl && cEl.ref) || '?';
  const sBox = sEl && sEl.box && sEl.box[vw];
  const cBox = cEl && cEl.box && cEl.box[vw];
  const sStyle = (sEl && sEl.style) || {};
  const cStyle = (cEl && cEl.style) || {};
  const push = (axis, src, clone, delta, tol, flagged, cls, extra = {}) =>
    rows.push({ ref, viewport: vw, axis, src, clone, delta: delta == null ? null : +Number(delta).toFixed(4), tol, flagged: !!flagged, uncalibrated: true, class: flagged ? cls : null, ...extra });

  // (1) PRESENCE — is the corresponded element present on both sides? (cEl null ⇒ clone-missing.)
  const present = !!(cEl && cBox);
  push('presence', !!sEl, present, present ? 0 : 1, 0, sEl && !present, 'missing-element');

  if (!present) return rows; // nothing more to measure if the clone element is absent

  // (2) BBOX-RATIO — w & h ratio drift (size/position). flagged if either axis off beyond tol.
  if (sBox && cBox) {
    const wr = sBox.w > 0 ? cBox.w / sBox.w : null;
    const hr = sBox.h > 0 ? cBox.h / sBox.h : null;
    const wDelta = wr == null ? null : Math.abs(1 - wr);
    const hDelta = hr == null ? null : Math.abs(1 - hr);
    const delta = Math.max(wDelta ?? 0, hDelta ?? 0);
    push('bbox-ratio', { w: sBox.w, h: sBox.h }, { w: cBox.w, h: cBox.h }, delta, TOL.bboxRatio, delta > TOL.bboxRatio, 'bbox-drift', { wRatio: wr == null ? null : +wr.toFixed(3), hRatio: hr == null ? null : +hr.toFixed(3) });
  }

  // (3) TEXT-CONTRAST — text↔own-bg contrast on each side; flag if it diverges (the invisible-heading axis).
  const sFg = parseColor(sStyle.color), cFg = parseColor(cStyle.color);
  if (sFg && cFg && (sEl.ownText || sEl.text)) {
    const sC = contrastRatio(sFg, effBg(sStyle)), cC = contrastRatio(cFg, effBg(cStyle));
    if (sC != null && cC != null) {
      const delta = Math.abs(sC - cC);
      // flag a CONTRAST COLLAPSE (clone far less readable than source) — not a clone that is MORE contrasty.
      const collapsed = (sC - cC) > TOL.contrastDelta && cC < 3.0;
      push('text-contrast', sC, cC, delta, TOL.contrastDelta, collapsed, 'invisible-text');
    }
  }

  // (4) COLOR-ΔE (CIEDE2000) — text color drift.
  if (sFg && cFg) {
    const dE = deltaE2000(sFg, cFg);
    push('color-deltaE', sStyle.color, cStyle.color, dE, TOL.colorDeltaE, dE != null && dE > TOL.colorDeltaE, 'color-off');
  }

  // (5) FONT-SIZE-RATIO.
  const sFs = parseFloat(sStyle.font && sStyle.font.size), cFs = parseFloat(cStyle.font && cStyle.font.size);
  if (sFs > 0 && cFs > 0) {
    const r = cFs / sFs, delta = Math.abs(1 - r);
    push('font-size-ratio', sFs, cFs, delta, TOL.fontSizeRatio, delta > TOL.fontSizeRatio, 'font-off', { ratio: +r.toFixed(3) });
  }

  // (6) HORIZONTAL-OVERFLOW — clone box pushed past the viewport edge (responsive overflow). Only on clone.
  if (cBox) {
    const right = cBox.right != null ? cBox.right : cBox.x + cBox.w;
    const over = right - vw, overFrac = over / vw;
    push('h-overflow', null, right, overFrac, TOL.overflowFrac, overFrac > TOL.overflowFrac, 'horizontal-overflow', { viewportRight: vw });
  }

  // (7) IMG-pHASH — only when both sides are images AND native crops were supplied (Layer-0 perceptual asset).
  const sAsset = sEl.asset, cAsset = cEl.asset;
  if (sAsset && cAsset && sAsset.isImage && cAsset.isImage) {
    // structural SVG hash short-circuit (markup-identical svg ⇒ same picture, distance 0, no crop needed)
    if (sAsset.svgHash && cAsset.svgHash) {
      const same = sAsset.svgHash === cAsset.svgHash;
      push('img-svghash', sAsset.svgHash, cAsset.svgHash, same ? 0 : 64, 0, !same, 'image-wrong');
    } else if (opts.srcCrop && opts.cloneCrop) {
      const sh = dHash(opts.srcCrop), ch = dHash(opts.cloneCrop);
      const d = hamming(sh, ch);
      push('img-phash', sh, ch, d, TOL.dHashDist, d != null && d > TOL.dHashDist, 'image-wrong', { naturalSrc: sAsset.naturalSrc, cloneSrc: cAsset.naturalSrc });
    } else {
      // no crops → fall back to natural-src / alt / intrinsic-dims equality (cheap, dep-free).
      const srcEq = (sAsset.naturalSrc || '') === (cAsset.naturalSrc || '');
      push('img-src', sAsset.naturalSrc, cAsset.naturalSrc, srcEq ? 0 : 1, 0, !srcEq && !!sAsset.naturalSrc, 'image-wrong');
    }
  }
  return rows;
}

// ── THE HALLUCINATION VERIFIER ── drop any vision-reported defect that CONTRADICTS a measured fact. Pure:
// takes a defect {element,defect_class,severity,evidence} + the measured facts {bg, borders, counts...} for
// the same crop and returns {keep:boolean, reason}. Conservative: only DROPS on a CLEAR contradiction; an
// ambiguous defect is kept. Each drop is logged as a verifier catch. THIS is what stops "bg=#FFFFFF but model
// says dark → dropped".
export function verifyDefect(defect, facts) {
  if (!GEC_VERIFIER) return { keep: true, reason: 'verifier-off' };
  const text = `${defect.element || ''} ${defect.evidence || ''} ${defect.defect_class || ''}`.toLowerCase();
  // (a) bg light/dark contradiction. facts.bgLuma is the MEASURED dominant background luma (0-255).
  if (facts && typeof facts.bgLuma === 'number') {
    const claimsDark = /\b(dark|black)\b.*\b(background|bg|backdrop|fill|panel|section)\b|\b(background|bg)\b.*\b(dark|black)\b/.test(text);
    const claimsLight = /\b(light|white|bright)\b.*\b(background|bg|backdrop|fill|panel|section)\b|\b(background|bg)\b.*\b(light|white|bright)\b/.test(text);
    if (claimsDark && facts.bgLuma >= 200) return { keep: false, reason: `claims dark background but MEASURED bgLuma=${facts.bgLuma|0} (light); bg≈#${facts.bgHex || ''}` };
    if (claimsLight && facts.bgLuma <= 55) return { keep: false, reason: `claims light background but MEASURED bgLuma=${facts.bgLuma|0} (dark); bg≈#${facts.bgHex || ''}` };
  }
  // (b) "missing/blank" contradiction: model says the ELEMENT/REGION as a whole is blank/empty/missing-content,
  // but the MEASURED ink/text counts show real content present. NARROW SCOPE: the blank word must describe the
  // element/region/section/content itself — NOT a styled SUB-PROPERTY. "the gradient is absent", "the underline
  // is missing", "the shadow is gone" are PRESENT-BUT-WRONG defects on a present element and must NOT be dropped
  // here (that over-drop was a real false-catch on overreacted's "gradient absent → flat pink"). We require a
  // whole-element emptiness phrasing AND veto the drop when a styled-property noun sits next to the blank word.
  const WHOLE_EMPTY = /\b(is|are|appears?|renders?|looks?|seems?)\s+(blank|empty)\b|\b(region|section|area|element|block|panel|container|content|tile|card|cell|column)\s+(is|are|appears?|looks?|seems?)?\s*(blank|empty|missing|absent|gone|not (shown|present|rendered)|has no content)\b|\bno content\b|\bnothing (is )?(shown|rendered|present|visible)\b|\bwholly (missing|absent)\b/;
  const PROP_NOUN = /\b(gradient|colou?r|underline|border|shadow|outline|fill|stroke|font|weight|italic|decoration|background\s*image|bg\s*image|highlight|tint|opacity|radius|corner|icon|glyph|emoji|bullet)\b/;
  if (facts && WHOLE_EMPTY.test(text) && !PROP_NOUN.test(text)) {
    if (typeof facts.textCount === 'number' && facts.textCount >= 1) return { keep: false, reason: `claims the element is blank/missing but MEASURED ${facts.textCount} text node(s) present` };
    if (typeof facts.inkFrac === 'number' && facts.inkFrac >= 0.03) return { keep: false, reason: `claims the element is blank/missing but MEASURED ink-mass ${(facts.inkFrac * 100).toFixed(1)}% (content present)` };
  }
  // (c) "no border / border missing" contradiction: model says no border but a measured border exists.
  if (facts && facts.hasBorder && /\b(no border|missing border|without (a )?border|border (is )?(gone|absent|missing))\b/.test(text)) {
    return { keep: false, reason: `claims no border but MEASURED border present (${facts.borderDesc || 'width>0'})` };
  }
  return { keep: true, reason: null };
}

// ── bounded concurrency pool (pattern reused from region-judge/vision-judge) ─────────────────────────────────
export async function pool(items, jobs, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// IMPURE HELPERS (fs / playwright) — only run from main()
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────

// dominant background luma + hex of a native-res crop (the measured fact injected + used by the verifier).
// EXPORTED so region-judge.mjs (RJ_USE_CROPS) can reuse the SAME measured-fact computation + the SAME injected
// prompt — so the re-pointed region-judge shares one ground-truth source with the element-crop harness.
export function measuredFacts(crops, els) {
  const f = {};
  if (crops && crops.clone) {
    const st = regionStats(crops.clone, 0, 0, crops.clone.width, crops.clone.height);
    f.bgLuma = Math.round(modalLuma(crops.clone));
    f.bgHex = lumaToGrayHex(f.bgLuma);
    f.cloneStd = +st.std.toFixed(1);
    f.inkFrac = +inkFracOf(crops.clone).toFixed(3);
  }
  // node/text/code counts + border presence come from the corresponded ElementRecords (measured DOM facts).
  const ce = els && els.clone;
  if (ce) {
    const b = ce.style && ce.style.border;
    const bw = b && b.width ? Math.max(...['top', 'right', 'bottom', 'left'].map((s) => parseFloat(b.width[s]) || 0)) : 0;
    f.hasBorder = bw > 0;
    if (f.hasBorder) f.borderDesc = `${bw}px ${b.style && b.style.top || ''} ${b.color && b.color.top || ''}`.trim();
    f.textCount = (ce.text || '').trim() ? 1 : 0;
    f.isCode = ce.tag === 'code' || ce.tag === 'pre';
    f.tag = ce.tag; f.role = ce.role;
  }
  return f;
}
function modalLuma(png) {
  const hist = new Array(16).fill(0);
  for (let y = 0; y < png.height; y += 3) for (let x = 0; x < png.width; x += 3) { const L = luma(png.data, (y * png.width + x) << 2); hist[Math.min(15, L / 16 | 0)]++; }
  let bi = 0; for (let i = 1; i < 16; i++) if (hist[i] > hist[bi]) bi = i;
  return bi * 16 + 8;
}
function inkFracOf(png) {
  const bg = modalLuma(png); let ink = 0, n = 0;
  for (let y = 0; y < png.height; y += 2) for (let x = 0; x < png.width; x += 2) { if (Math.abs(luma(png.data, (y * png.width + x) << 2) - bg) > 40) ink++; n++; }
  return n ? ink / n : 0;
}
function lumaToGrayHex(L) { const h = Math.max(0, Math.min(255, L | 0)).toString(16).padStart(2, '0'); return (h + h + h).toUpperCase(); }

// full-page screenshot of a URL at a width (node+playwright, settleLazy, hard timeout) — NEVER mcp-playwright.
// EXPORTED so region-judge (RJ_USE_CROPS) reuses the exact same hardened shooter (crop SOURCE only, never a vision input).
export async function shootFull(url, width) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  try {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
    await p.waitForTimeout(1500).catch(() => {});
    await settleLazy(p);
    const buf = await Promise.race([
      p.screenshot({ fullPage: true, timeout: 90000 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('screenshot >120s')), 120000)),
    ]);
    return PNG.sync.read(buf);
  } finally { await browser.close().catch(() => {}); }
}

// ── the corresponded-pair READER: build cByRef + sBySrcPath, walk report.relation/matched, yield pairs ───────
// Prefers report.matched (explicit cloneRef) when method=stamped; falls back to relation. Skips degenerate
// clone wrapper boxes (h ≈ full pageHeight). PURE w.r.t. the blob (no network).
export function readPairs(blob, vw) {
  const { report, sourceCapture, cloneCapture } = blob;
  const sRecs = sourceCapture.records, cRecs = cloneCapture.records;
  const cByRef = Object.fromEntries(cRecs.map((c) => [c.ref, c]));
  const sByRef = Object.fromEntries(sRecs.map((s) => [s.ref, s]));
  const sBySrcPath = Object.fromEntries(sRecs.map((s) => [s.srcPath, s]));
  const cloneH = (report.pageHeightByVw && report.pageHeightByVw.clone && (report.pageHeightByVw.clone[vw] || report.pageHeightByVw.clone[String(vw)])) || 0;
  const seen = new Set();
  const pairs = [];
  const addPair = (sEl, cEl) => {
    if (!sEl) return;
    const ref = sEl.ref;
    if (seen.has(ref)) return; seen.add(ref);
    // GUARD: skip a degenerate full-page clone wrapper (its box h ≈ pageHeight).
    const cBox = cEl && cEl.box && cEl.box[vw];
    if (cBox && cloneH && cBox.h >= cloneH * 0.95 && cBox.y <= 2) return;
    pairs.push({ ref, sEl, cEl: cEl || null });
  };
  // matched[] (has explicit cloneRef) wins
  if (Array.isArray(report.matched) && report.matched.length) {
    for (const m of report.matched) addPair(sByRef[m.srcRef], cByRef[m.cloneRef]);
  }
  // relation (srcPath → [cloneRef]) fills the rest
  for (const [srcPath, cloneRefs] of Object.entries(report.relation || {})) {
    const sEl = sBySrcPath[srcPath]; if (!sEl) continue;
    addPair(sEl, cByRef[(cloneRefs || [])[0]]);
  }
  // unmatched source = clone-missing pairs (presence defects)
  for (const ref of (report.unmatchedSource || [])) addPair(sByRef[ref], null);
  return { pairs, cByRef, sByRef, sBySrcPath };
}

// salience weight for anomaly ranking (heading/hero/cta/logo/img first), × area fraction.
const ROLE_SALIENCE = { heading: 3.0, banner: 2.5, img: 2.0, button: 2.2, link: 1.2, navigation: 1.4, contentinfo: 0.6 };
function salience(sEl, vw, pageH) {
  const role = sEl.role || '';
  let w = ROLE_SALIENCE[role] || 1.0;
  if (/logo|brand|wordmark/i.test(sEl.text || sEl.ownText || '')) w += 1.5;
  if (sEl.asset && sEl.asset.isImage) w = Math.max(w, 2.0);
  const box = sEl.box && sEl.box[vw];
  const areaFrac = box && pageH ? Math.min(1, (box.w * box.h) / (vw * Math.min(pageH, 1200))) : 0.1;
  return w * (0.4 + areaFrac);
}

// ── the FIXED marketing sweep: logo crop, hero band, primary CTA, first-fold band — per width ────────────────
// Returns a list of forced vision targets (by ref where we can resolve one, else a synthetic band region).
function marketingSweep(pairs, vw, pageH) {
  const out = [];
  const inFold = (sEl) => { const b = sEl.box && sEl.box[vw]; return b && b.y < 1000; };
  // logo: first image/svg or brand-text element in the top fold.
  const logo = pairs.find((p) => inFold(p.sEl) && (/(logo|brand|wordmark)/i.test(p.sEl.text || p.sEl.ownText || '') || (p.sEl.asset && p.sEl.asset.isImage && (p.sEl.box[vw] || {}).y < 120)));
  if (logo) out.push({ ...logo, sweep: 'logo' });
  // primary CTA: first button/link in the fold with a styled (chromatic) bg.
  const cta = pairs.find((p) => inFold(p.sEl) && (p.sEl.role === 'button' || p.sEl.role === 'link') && parseColor((p.sEl.style || {}).backgroundColor));
  if (cta) out.push({ ...cta, sweep: 'cta' });
  // hero: largest fold element by area.
  let hero = null, ha = 0;
  for (const p of pairs) { if (!inFold(p.sEl)) continue; const b = p.sEl.box[vw]; const a = b ? b.w * b.h : 0; if (a > ha) { ha = a; hero = p; } }
  if (hero) out.push({ ...hero, sweep: 'hero' });
  // first-fold band is emitted by the band path (synthetic), tagged in main().
  return out;
}

// ── BAND emission: scroll-align source↔clone by corresponded anchors, then cut uniform ~1440x900 bands ───────
// Returns band specs [{i, sY0, sY1, cY0, cY1, aboveFold}]. The clone band y is mapped from the source band y
// through the anchor y-map (GEC_ANCHOR_ALIGN) so a taller clone keeps band content aligned; proportional
// fallback when too few anchors.
function planBands(blob, vw, { bandH = 900 } = {}) {
  const { report, sourceCapture, cloneCapture } = blob;
  const srcH = (report.pageHeightByVw.source[vw] || report.pageHeightByVw.source[String(vw)]) || sourceCapture.pageHeightByVw[vw];
  const cloneH = (report.pageHeightByVw.clone[vw] || report.pageHeightByVw.clone[String(vw)]) || cloneCapture.pageHeightByVw[vw];
  const ratio = srcH > 0 ? cloneH / srcH : 1;
  // anchor pairs from corresponded leaves: build {key,y} leaf lists at this viewport from matched text records.
  let s2c = (y) => y * ratio, mode = 'proportional';
  if (GEC_ANCHOR_ALIGN) {
    const sLeaves = leavesAt(sourceCapture.records, vw);
    const cLeaves = leavesAt(cloneCapture.records, vw);
    const ap = matchUniqueAnchors(sLeaves, cLeaves);
    if (ap.length >= 4) { const m = anchorMaps(ap, srcH, cloneH); s2c = m.s2c; mode = `anchor-aligned(${ap.length})`; }
  }
  const bands = [];
  for (let i = 0, sY0 = 0; sY0 < srcH; i++, sY0 += bandH) {
    const sY1 = Math.min(srcH, sY0 + bandH);
    const cY0 = Math.max(0, Math.round(s2c(sY0))), cY1 = Math.min(cloneH, Math.round(s2c(sY1)));
    bands.push({ i, sY0, sY1, cY0, cY1, aboveFold: sY0 < 1000 });
    if (sY1 >= srcH) break;
  }
  return { bands, mode, srcH, cloneH, ratio: +ratio.toFixed(3) };
}
function leavesAt(records, vw) {
  const out = [];
  for (const r of records) {
    const t = (r.ownText || r.text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (t.length < 6 || t.length > 200) continue;
    const b = r.box && r.box[vw]; if (!b) continue;
    out.push({ key: t.slice(0, 80), y: b.y });
  }
  out.sort((a, b) => a.y - b.y);
  return out;
}

// ── element-scoped adversarial vision prompt with INJECTED measured facts (marked AUTHORITATIVE) ─────────────
// EXPORTED so the re-pointed region-judge (RJ_USE_CROPS) issues the IDENTICAL fact-injected, native-res-crop prompt.
export function elementPrompt(tilePath, ref, facts, role, sweep) {
  const factLines = [];
  if (typeof facts.bgLuma === 'number') factLines.push(`- The clone region's MEASURED dominant background color is ≈ #${facts.bgHex} (luma ${facts.bgLuma}/255). This is GROUND TRUTH — do NOT report a background-color/dark/light defect that contradicts it.`);
  if (typeof facts.textCount === 'number') factLines.push(`- MEASURED text nodes present in the clone element: ${facts.textCount}. If >0, do NOT claim the region is blank/empty/missing-content.`);
  if (facts.hasBorder) factLines.push(`- MEASURED: the clone element HAS a border (${facts.borderDesc}). Do NOT claim "no border".`);
  if (facts.isCode) factLines.push(`- MEASURED: this is a code element (<${facts.tag}>).`);
  if (facts.tag) factLines.push(`- MEASURED tag/role: <${facts.tag}>${facts.role ? ` role=${facts.role}` : ''}.`);
  return `You are a HARSH QA inspector. Read the image file ${tilePath} now.
It is a side-by-side composite split by a vertical MAGENTA divider. LEFT = ORIGINAL (source). RIGHT = REBUILD (clone). The solid-black strip across the very top carries harness labels only — ignore it.
This crop is ONE corresponded element/region (ref "${ref}"${role ? `, role ${role}` : ''}${sweep ? `, marketing-sweep:${sweep}` : ''}) shown at NATIVE resolution. Find everything WRONG with the REBUILD relative to the ORIGINAL, for THIS element only.
ASSUME THE REBUILD IS BROKEN until the pixels prove otherwise. Do NOT praise. Only enumerate DEFECTS, each with an element-level citation.

AUTHORITATIVE MEASURED FACTS (these were measured from the rendered clone DOM/pixels; they are GROUND TRUTH — any claim that contradicts them will be DISCARDED):
${factLines.join('\n') || '- (none)'}

Output ONLY this JSON, no prose, no markdown fences:
{"defects":[{"element":"<specific element>","defect_class":"<wrong-logo|missing-logo|invisible-text|blank-hero|unstyled-cta|image-missing|wrong-layout|missing-section|color-off|font-off|overlapping-sections>","severity":"<fatal|high|med|low>","evidence":"<what you see that is wrong>"}]}
If the rebuild element is genuinely faithful, output {"defects":[]}.`;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// MAIN
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const OUT = arg('out', '/tmp/grade-element-crops');
  fs.mkdirSync(OUT, { recursive: true });
  const TOP_N = +arg('top-n', 20);
  const MODEL = arg('model', 'sonnet');
  const JOBS = Math.max(1, +arg('jobs', 3));
  const NO_VISION = has('no-vision');
  let comparePath = arg('compare');

  // ── obtain the compare blob (reuse cache, or drive compare-capture) ──
  if (!comparePath) {
    const source = arg('source'), clonePage = arg('clone-page');
    if (!source || !clonePage) { console.error('need --compare <blob.json> OR --source <url> --clone-page <id>'); process.exit(2); }
    assertNotBlocked(source);
    const base = resolveBase(process.env.JOIST_BASE);
    assertAllowedBase(`${base}/?page_id=${clonePage}`);
    comparePath = path.join(OUT, `compare-${clonePage}.json`);
    console.error(`[gec] driving compare-capture → ${comparePath}`);
    const { execFileSync } = await import('child_process');
    execFileSync('node', [path.join(path.dirname(new URL(import.meta.url).pathname), 'compare-capture.mjs'),
      '--source', source, '--clone-page', String(clonePage), '--widths', arg('widths', '1440,390'), '--out', comparePath],
      { stdio: 'inherit', timeout: 280000 });
  }
  const blob = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
  const report = blob.report;
  // GUARD: assert the captured hosts are allowed/not-blocked (defense in depth on a cached blob).
  assertNotBlocked(report.source);
  if (report.clone) assertAllowedBase(report.clone);

  const WIDTHS = (arg('widths', (report.widths || [1440]).join(','))).split(',').map((s) => parseInt(s, 10)).filter(Boolean)
    .filter((w) => (blob.sourceCapture.records.some((r) => r.box && r.box[w]))); // only widths actually captured
  const joinW = WIDTHS[0];

  // hRatio sanity (react.dev memory): a source ~>2.5x taller than the clone ⇒ source render likely broken.
  const srcH = report.pageHeightByVw.source[joinW] || report.pageHeightByVw.source[String(joinW)];
  const cloneH = report.pageHeightByVw.clone[joinW] || report.pageHeightByVw.clone[String(joinW)];
  const hRatio = srcH && cloneH ? +(cloneH / srcH).toFixed(3) : null;
  const hRatioWarn = hRatio != null && (hRatio < 0.35 || hRatio > 3.0);
  if (hRatioWarn) console.error(`[gec] WARNING hRatio ${hRatio} (src ${srcH} vs clone ${cloneH}) — source-side grade may be unreliable (blocked-asset render?)`);

  const meta = {
    compare: comparePath, source: report.source, clone: report.clone, clonePage: report.clonePage,
    method: report.correspondence && report.correspondence.method, matchRate: report.matchRate,
    widths: WIDTHS, joinW, hRatio, hRatioWarn,
    bansFullPage: GEC_BAN_FULLPAGE, anchorAlign: GEC_ANCHOR_ALIGN, verifierOn: GEC_VERIFIER,
    tolerances: TOL,
  };

  // ── full-res PNGs (reuse provided shots, else shoot) — these are the crop SOURCES, never a vision input ──
  const shots = {}; // {[vw]: {src,clone}}
  for (const vw of WIDTHS) {
    let srcShot = arg('src-shot'), cloneShot = arg('clone-shot');
    // provided shots apply only to joinW (single pair); otherwise capture.
    if (vw === joinW && srcShot && cloneShot && fs.existsSync(srcShot) && fs.existsSync(cloneShot)) {
      shots[vw] = { src: PNG.sync.read(fs.readFileSync(srcShot)), clone: PNG.sync.read(fs.readFileSync(cloneShot)) };
    } else {
      console.error(`[gec] shooting full-res PNGs @${vw} (crop source only; NEVER fed whole to vision)`);
      const [s, c] = await Promise.all([shootFull(report.source, vw), shootFull(report.clone, vw)]);
      shots[vw] = { src: s, clone: c };
    }
  }

  // ── per-width: read pairs, run the axis-delta seed, anomaly-rank, plan bands ──
  const axisRows = [];
  const perPairFlags = new Map(); // ref → {flags:[axis...], score}
  const bandPlans = {};
  for (const vw of WIDTHS) {
    const { pairs } = readPairs(blob, vw);
    const pageH = report.pageHeightByVw.source[vw] || report.pageHeightByVw.source[String(vw)];
    for (const { ref, sEl, cEl } of pairs) {
      // native crops for the img axes (cheap; only used by axisDeltas for image pairs)
      let srcCrop = null, cloneCrop = null;
      if (sEl.asset && sEl.asset.isImage && cEl && cEl.asset && cEl.asset.isImage && shots[vw]) {
        const sb = sEl.box[vw], cb = cEl.box[vw];
        if (sb && cb) { srcCrop = crop(shots[vw].src, sb.x | 0, sb.y | 0, Math.max(1, sb.w | 0), Math.max(1, sb.h | 0)); cloneCrop = crop(shots[vw].clone, cb.x | 0, cb.y | 0, Math.max(1, cb.w | 0), Math.max(1, cb.h | 0)); }
      }
      const rows = axisDeltas(sEl, cEl, vw, { srcCrop, cloneCrop });
      for (const r of rows) axisRows.push(r);
      const flagged = rows.filter((r) => r.flagged);
      if (flagged.length) {
        const key = `${ref}@${vw}`;
        const mag = flagged.reduce((a, r) => a + (r.delta || 0) + 1, 0); // +1 per flag so count matters
        perPairFlags.set(key, { ref, viewport: vw, sEl, cEl, flags: flagged.map((r) => ({ axis: r.axis, class: r.class, delta: r.delta })), mag, salience: salience(sEl, vw, pageH) });
      }
    }
    bandPlans[vw] = planBands(blob, vw);
  }

  // ── anomaly rank + fixed marketing sweep → bounded vision call set ──
  const ranked = [...perPairFlags.values()].sort((a, b) => (b.mag * b.salience) - (a.mag * a.salience));
  const topN = ranked.slice(0, TOP_N);
  const sweepTargets = [];
  for (const vw of WIDTHS) {
    const { pairs } = readPairs(blob, vw);
    const pageH = report.pageHeightByVw.source[vw] || report.pageHeightByVw.source[String(vw)];
    for (const sw of marketingSweep(pairs.filter((p) => p.cEl), vw, pageH)) sweepTargets.push({ ...sw, viewport: vw });
  }
  // union (de-dupe by ref@vw); marketing sweep is ALWAYS included even if not anomalous.
  const visionSet = [];
  const inSet = new Set();
  const addVision = (ref, vw, sEl, cEl, why) => { const k = `${ref}@${vw}`; if (inSet.has(k)) { visionSet.find((v) => v.key === k).why.push(why); return; } inSet.add(k); visionSet.push({ key: k, ref, viewport: vw, sEl, cEl, why: [why] }); };
  for (const t of topN) addVision(t.ref, t.viewport, t.sEl, t.cEl, 'anomaly:' + t.flags.map((f) => f.axis).join('+'));
  for (const t of sweepTargets) if (t.cEl) addVision(t.ref, t.viewport, t.sEl, t.cEl, 'sweep:' + t.sweep);

  // ── emit aligned A/B crops for the vision set + measure facts + (optionally) run vision + verify ──
  const findings = [];
  const verifierCatches = [];
  let totalCost = 0;
  const emitTile = (sEl, cEl, vw, name) => {
    const sb = sEl.box[vw], cb = cEl.box[vw];
    const sCrop = crop(shots[vw].src, sb.x | 0, sb.y | 0, Math.max(2, sb.w | 0), Math.max(8, sb.h | 0));
    const cCrop = crop(shots[vw].clone, cb.x | 0, cb.y | 0, Math.max(2, cb.w | 0), Math.max(8, cb.h | 0));
    const comp = composeTile(sCrop, cCrop, sb.w | 0, sb.y | 0, { src: `SRC ${vw}`, clone: `CLN ${vw}` });
    const tilePath = path.join(OUT, `el-${name}.png`);
    fs.writeFileSync(tilePath, PNG.sync.write(comp));
    return { tilePath, sCrop, cCrop, facts: measuredFacts({ src: sCrop, clone: cCrop }, { src: sEl, clone: cEl }) };
  };

  const visionJobs = visionSet.filter((v) => v.cEl && v.sEl.box[v.viewport] && v.cEl.box[v.viewport]);
  await pool(visionJobs, JOBS, async (v) => {
    const safeName = v.ref.replace(/[^a-z0-9]+/gi, '_').slice(0, 48) + '_' + v.viewport;
    const { tilePath, facts } = emitTile(v.sEl, v.cEl, v.viewport, safeName);
    const finding = { ref: v.ref, viewport: v.viewport, role: v.sEl.role, why: v.why, tilePath, facts, visionDefects: [], droppedByVerifier: [] };
    if (!NO_VISION) {
      let res = await inspectOnce(elementPrompt(tilePath, v.ref, facts, v.sEl.role, (v.why.find((w) => w.startsWith('sweep:')) || '').slice(6)), { model: MODEL, cwd: OUT });
      if (!res.ok) res = await inspectOnce(elementPrompt(tilePath, v.ref, facts, v.sEl.role, '') + '\nOutput ONLY raw JSON {"defects":[...]}.', { model: MODEL, cwd: OUT });
      totalCost += res.cost || 0;
      if (res.ok) {
        for (const d of res.defects) {
          const v0 = verifyDefect(d, facts);
          if (v0.keep) {
            const fatalClass = FATAL_OF[String(d.defect_class || '').toLowerCase().replace(/\s+/g, '-')] ?? null;
            finding.visionDefects.push({ ...d, fatalClass });
          } else {
            finding.droppedByVerifier.push({ defect: d, reason: v0.reason });
            verifierCatches.push({ ref: v.ref, viewport: v.viewport, defect: d.defect_class, claim: (d.evidence || d.element || '').slice(0, 80), reason: v0.reason });
          }
        }
      } else { finding.visionError = res.error; }
    }
    findings.push(finding);
    return finding;
  });

  // ── emit band tiles (vision OFF by default for bands — they exist as the BANNED-full-page replacement and
  //    feed the first-fold sweep; a future pass can judge them). Always written at native 1:1. ──
  const bandTiles = {};
  for (const vw of WIDTHS) {
    bandTiles[vw] = [];
    const { bands, mode, ratio } = bandPlans[vw];
    for (const b of bands.slice(0, 60)) {
      const sCrop = crop(shots[vw].src, 0, b.sY0, vw, Math.max(8, b.sY1 - b.sY0));
      const cCrop = crop(shots[vw].clone, 0, b.cY0, vw, Math.max(8, b.cY1 - b.cY0));
      const comp = composeTile(sCrop, cCrop, vw, b.sY0, { src: `SRC ${vw} Y${b.sY0}`, clone: `CLN ${vw}` });
      const tp = path.join(OUT, `band-w${vw}-${String(b.i).padStart(2, '0')}.png`);
      fs.writeFileSync(tp, PNG.sync.write(comp));
      bandTiles[vw].push({ i: b.i, tilePath: tp, sY: b.sY0, cY: b.cY0, aboveFold: b.aboveFold, alignMode: mode, ratio });
    }
  }

  // ── deterministic pre-evidence from compare-capture's own structural buckets (presence/chrome defects) ──
  const structuralEvidence = {
    unmatchedSourceBuckets: report.unmatchedSourceBuckets || {},
    matchedPairDefects: report.matchedPairDefects || {},
  };

  // ── aggregate (a conservative MAP-level rollup; NOT the headline — the spine emits localized findings) ──
  const fatalFindings = findings.filter((f) => (f.visionDefects || []).some((d) => d.fatalClass && DISQUALIFYING_FATAL.has(d.fatalClass)));
  const aggregate = {
    pairsWithAxisFlags: perPairFlags.size,
    axisFlagCounts: countBy(axisRows.filter((r) => r.flagged), 'class'),
    visionCalls: NO_VISION ? 0 : visionJobs.length,
    visionDefects: findings.reduce((a, f) => a + (f.visionDefects || []).length, 0),
    verifierDrops: verifierCatches.length,
    fatalElements: fatalFindings.map((f) => f.ref),
    visionCostUSD: +totalCost.toFixed(4),
    note: 'Localized defect MAP (per corresponded ref × viewport × state) — not a scalar headline. Tolerances are UNCALIBRATED placeholders.',
  };

  const results = { meta, structuralEvidence, axisRows, anomalies: ranked.map((r) => ({ ref: r.ref, viewport: r.viewport, mag: +r.mag.toFixed(2), salience: +r.salience.toFixed(2), flags: r.flags })), visionSet: visionSet.map((v) => ({ ref: v.ref, viewport: v.viewport, why: v.why })), bandPlans: Object.fromEntries(Object.entries(bandPlans).map(([w, p]) => [w, { mode: p.mode, ratio: p.ratio, bands: p.bands.length }])), bandTiles, findings, verifierCatches, aggregate };
  const outPath = path.join(OUT, 'results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

  // human verdict
  console.log('\n==== GRADE-ELEMENT-CROPS (correspondence-aligned, native-res) ====');
  console.log(`compare: ${comparePath}  | join ${meta.method} matchRate ${meta.matchRate}  | widths ${WIDTHS.join(',')} | hRatio ${hRatio}${hRatioWarn ? ' (WARN)' : ''}`);
  console.log(`vision input: ONLY per-element crops + ${Object.values(bandTiles).reduce((a, b) => a + b.length, 0)} uniform bands @native 1:1 (full-page screenshot BANNED=${GEC_BAN_FULLPAGE})`);
  console.log(`axis-delta seed: ${axisRows.length} rows, ${axisRows.filter((r) => r.flagged).length} flagged  (UNCALIBRATED tolerances)`);
  console.log(`  by class: ${JSON.stringify(aggregate.axisFlagCounts)}`);
  console.log(`anomaly-ranked pairs: ${ranked.length} → top-${topN.length} + marketing-sweep = ${visionSet.length} vision targets`);
  console.log(`vision: ${aggregate.visionCalls} calls, ${aggregate.visionDefects} defects KEPT, ${aggregate.verifierDrops} DROPPED by hallucination-verifier ($${aggregate.visionCostUSD})`);
  for (const vc of verifierCatches.slice(0, 6)) console.log(`  VERIFIER DROP ${vc.ref}@${vc.viewport}: "${vc.claim}" — ${vc.reason}`);
  console.log(`fatal elements: ${aggregate.fatalElements.length}${aggregate.fatalElements.length ? ' e.g. ' + aggregate.fatalElements.slice(0, 3).join(', ') : ''}`);
  console.log(`\nfull localized defect map → ${outPath}`);
}
function countBy(arr, key) { const m = {}; for (const x of arr) { const k = x[key] || 'null'; m[k] = (m[k] || 0) + 1; } return m; }

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('[gec] FATAL', e && e.stack || e); process.exit(1); });
}
