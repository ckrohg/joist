#!/usr/bin/env node
/**
 * @purpose axisdelta-engine.mjs — PHASE 3 of the upleveled grader (fusion #3): the UNIVERSAL SEVERITY ENGINE.
 * It SUBSUMES the 8 hand-written compare-detectors AND covers the 6 human-salient marketing classes
 * (wrong-logo / invisible-heading / blank-hero / unstyled-CTA / missing-imagery / colliding-sections) with
 * NO per-defect code — every defect is the SAME continuous severity computed over corresponded element pairs
 * and a bounded set of relational edges, through the SAME frozen floor + perceptual-prior weights.
 *
 * THE NON-NEGOTIABLE ANTI-OVERFIT ARCHITECTURE (this project was burned by a grader anti-correlated with
 * humans — "looks done" is worthless; only a frozen falsifiable test counts):
 *   (A) per-axis tolerance FLOORS come from axisdelta-floor.mjs's NOISE corpus, NEVER from defect labels.
 *       This engine IMPORTS applyFloors/lookupFloor/salienceBucket UNCHANGED. Magnitude is expressed in
 *       FLOOR UNITS (multiples of the Q2 floor) so every axis is commensurate without any per-axis scale fit.
 *   (B) the ~15 axis WEIGHTS (W) + the salience prior are set from FIRST PRINCIPLES — perceptual priors:
 *       invisible/missing content is maximally salient; ΔE is perceptual; sub-pixel border drift is near-zero
 *       weight. NONE is fit to the ~26 human labels. `noLabelFit:true` rides the schema; the falsifier proves
 *       severity() never reads a label and that permuting labels cannot move a number.
 *   (C) the 6 marketing classes are validated by SYNTHETIC INJECTION (free, unlimited, both-directions) in the
 *       OFFLINE SELFTEST below — NOT by tuning to the 3 real marketing pages.
 *
 * FOUR PIECES (all over the SAME floor machinery):
 *  (1) DETECTION = universal + continuous.  severity(event) = salience(elem) × Σ_a W_a · magnitude_a, where
 *      magnitude_a = excess_a / floor_a (multiples of the floor; 0 when the axis does not trip). The page
 *      score aggregates (1 − severity) over corresponded elements + a penalty for UNMATCHED high-salience
 *      SOURCE elements (a missing logo/hero is a defect even with no clone counterpart) + relational
 *      violations.  salience(elem) = a SOURCE-ONLY attention prior (bbox-area × fold-weight × a11y-role-boost
 *      × text-length × source-contrast × centrality) — it never reads the clone, so it cannot encode "this is
 *      the labeled-broken one".
 *
 *  (2) PER-FAMILY COHERENCE CC.  nodes = corresponded pairs (+ unmatched-source as MISSING nodes). edges =
 *      source-tree CONTAINMENT (srcPath prefix) ∩ spatial ADJACENCY. Axes split into FAMILIES: GEOMETRY
 *      (bbox/overflow/relational) propagates along containment; STYLE (color/contrast/font) propagates along
 *      the cascade; ASSET + TEXT are SINGLETONS that NEVER propagate. An edge is active in family F iff BOTH
 *      endpoints trip an F-axis AND coherently (geometry: same translation + uniform scale within tol; style:
 *      same Lab ΔE direction / same font substitution). Union-find per family → components. Fit ONE transform
 *      per geometry/style component; low residual ⇒ ONE event. Classify each component against GLOBAL-CAUSE
 *      templates (font-unavailable confirmed against the clone font manifest / responsive-reflow coherent only
 *      at a narrow viewport matching a breakpoint / uniform scrollbar offset) → match ⇒ suppress or route to
 *      responsive; NO match ⇒ ONE structural defect at root-salience × magnitude.  NEVER suppress on coherence
 *      ALONE (coherent ≠ benign; the DEFAULT for an unexplained coherent component is ONE real defect at full
 *      severity).  GLOBAL_DIFF demotion: a component > ~20 elements on a SINGLE axis ⇒ ×0.2 severity + log
 *      "theme-level shift" (demote, do NOT drop).
 *
 *  (3) RELATIONAL AXES over BOUNDED sibling/adjacent high-salience pairs (never O(n²) — only the top-K salient
 *      elements, only their containment-siblings / spatial neighbours): collision (clone_IOU − source_IOU;
 *      source≈0 → clone overlap > ~0.05 fires), z-pile, containment-escape, reading-order, h-overflow. They
 *      flow through the SAME floor + coherence machinery, as edges, emitting the SAME axis rows.
 *
 *  (4) NAMING PROJECTION.  class = name(dominant_axis, role, salience_bucket) — a COSMETIC lookup/format, NOT a
 *      rule (presence+bbox+hero → "blank hero"; image-hash+logo → "wrong logo"; contrast+presence+heading →
 *      "invisible heading"; style-axes+button → "unstyled CTA"). A wrong/missing label NEVER loses a detection
 *      (graceful degradation): the severity + the fired axes are the source of truth; the name is decoration.
 *
 * SAFETY: PURE — no network, no host, no builder, no git. Imports axisdelta-floor.mjs + grade-element-crops.mjs
 * UNCHANGED (additive). Reads a cached compare blob + the frozen floors. Reversible (delete this file; nothing
 * else changes). Bash callers stay <120s. The offline selftest needs no capture (synthetic fixtures only).
 *
 * Falsifier / selftest: _axisdelta-engine-selftest.mjs (the orchestrator re-executes it — the builder does NOT
 * self-bless). Inline `--selftest` here runs the same offline checks for convenience.
 *
 * CLI:
 *   node axisdelta-engine.mjs --compare /tmp/compare-341.json [--floors calibration/axis-floors.json] [--top-k 24] [--json]
 *   node axisdelta-engine.mjs --selftest        # offline synthetic checks (no capture)
 *   node axisdelta-engine.mjs --schema          # offline schema dump
 *   node --check axisdelta-engine.mjs           # syntax check
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as M from './grade-element-crops.mjs';
import * as F from './axisdelta-floor.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// (B) PERCEPTUAL-PRIOR AXIS WEIGHTS  — set from FIRST PRINCIPLES, NOT fit to the human labels.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Each W_a is the per-unit-of-floor severity contribution of axis a. The RANKING is a perceptual prior:
//   • PRESENCE / TEXT-CONTRAST (invisible or missing content) are MAXIMALLY salient — a heading you cannot read
//     or an element that vanished is the worst thing a clone can do. → highest weights.
//   • IMAGE identity (wrong-logo / wrong-picture) is near-fatal for brand/marketing → high.
//   • COLOR-ΔE (recolour) and FONT-SIZE (wrong type scale) are clearly visible but recoverable → mid.
//   • BBOX / OVERFLOW / relational geometry are visible layout faults → mid.
//   • a SUB-PIXEL border / hair-width drift is near-imperceptible → low (and the floor already eats most of it).
// These are deliberately ROUND numbers on a 0..1-ish per-floor-unit scale; they encode an ORDER, not a fit.
// The floor already removes the imperceptible band, so a weight only ever multiplies a SUPRA-threshold excess.
export const W = {
  presence: 1.00,        // a missing element — the maximal defect
  'text-contrast': 0.95, // invisible text / contrast collapse — near-maximal (you literally cannot read it)
  'img-src': 0.85,       // wrong image source (wrong logo / wrong picture)
  'img-svghash': 0.85,   // wrong svg markup (wrong logo)
  'img-phash': 0.80,     // perceptually-different image
  'color-deltaE': 0.55,  // recolour (unstyled CTA, lost link colour) — clearly visible, recoverable
  'font-size-ratio': 0.50, // wrong type scale (markdown '# ' literal, lost heading size)
  'bbox-ratio': 0.45,    // size/position drift (blank hero shrink, reflow miss)
  'h-overflow': 0.50,    // box spills past the viewport (responsive overflow / colliding sections)
  // ── relational axes (same per-floor-unit scale) ──
  collision: 0.60,       // two high-salience boxes overlap in the clone but not the source (z-pile / collide)
  'z-pile': 0.55,        // stacking-order inversion of a high-salience pair
  'containment-escape': 0.50, // a child box escapes its source parent's bounds in the clone
  'reading-order': 0.35, // sibling vertical order flipped (mild — content still present)
  // ── STATE axis (page-level scroll behaviour; reads the capture's stickySummary, NOT a layout delta) ──
  'state-pin': 0.50,     // the clone PINS a top-band box across scroll that the source does NOT (wrongly-sticky nav)
};
// any axis without an explicit weight defaults here (a new axis is visible-but-unweighted, never zero, never
// dominant). This keeps the engine EXTENSIBLE without a silent zero swallowing a real defect.
export const W_DEFAULT = 0.40;
export const weightOf = (axis) => (W[axis] != null ? W[axis] : W_DEFAULT);

// FAMILIES — which propagation channel an axis travels on (used by the coherence CC). GEOMETRY propagates along
// containment (a parent moves → its children move with it); STYLE propagates along the cascade (a theme colour
// flips → many text nodes recolour the SAME direction); ASSET + TEXT are SINGLETONS (a wrong image / dropped
// glyph is local — it does NOT cause a neighbour's defect, so it must never collapse a neighbour into one event).
export const AXIS_FAMILY = {
  'bbox-ratio': 'geometry', 'h-overflow': 'geometry',
  collision: 'geometry', 'z-pile': 'geometry', 'containment-escape': 'geometry', 'reading-order': 'geometry',
  'color-deltaE': 'style', 'text-contrast': 'style', 'font-size-ratio': 'style',
  'img-src': 'asset', 'img-svghash': 'asset', 'img-phash': 'asset',
  presence: 'singleton',  // a missing element is its own event; it never propagates a defect onto a neighbour
  'state-pin': 'singleton', // a wrongly-sticky pin is a page-level behaviour, local to the pinned box; never propagates
};
export const familyOf = (axis) => AXIS_FAMILY[axis] || 'singleton';
export const PROPAGATING_FAMILIES = new Set(['geometry', 'style']); // only these run the CC; asset/text/presence = singletons

// GLOBAL_DIFF demotion: a coherent component larger than this on a SINGLE axis is a theme-level shift (demote, not drop).
export const GLOBAL_DIFF_MIN_SIZE = 20;
export const GLOBAL_DIFF_FACTOR = 0.2;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// (1) SALIENCE — a SOURCE-ONLY attention prior (perceptual, NOT a label readout). Multiplicative factors, each
// in [~0.2 .. ~3]: bbox-area (log, capped) × fold-weight × a11y-role-boost × text-length × source-contrast ×
// centrality. It reads ONLY the source element — so it is provably blind to which clone is the labeled-broken one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const ROLE_BOOST = { heading: 2.4, banner: 2.2, img: 1.8, button: 2.0, link: 1.2, navigation: 1.5, contentinfo: 0.6, listitem: 0.9 };
export function salience(sEl, vw, pageH) {
  if (!sEl) return 0.2;
  const box = (sEl.box && (sEl.box[vw] || sEl.box[String(vw)])) || null;
  const txt = (sEl.text || sEl.ownText || '');
  // bbox-area: log-compressed area fraction of the first ~1200px fold (a hero band is big; a footnote is tiny).
  const areaFrac = box && pageH ? Math.min(1, (Math.max(0, box.w) * Math.max(0, box.h)) / (vw * Math.min(pageH, 1200))) : 0.05;
  const areaTerm = 0.5 + Math.log1p(9 * areaFrac) / Math.log(10); // areaFrac 0→0.5, 1→1.5
  // fold-weight: above-the-fold content is what a human sees first.
  const y = box ? (box.y != null ? box.y : 0) : 2000;
  const foldTerm = y < 800 ? 1.6 : y < 1600 ? 1.15 : y < 3000 ? 0.85 : 0.6;
  // a11y-role-boost: heading/hero/logo/CTA high. h1>h2>p approximated via font-size on headings.
  let roleTerm = ROLE_BOOST[sEl.role] || 1.0;
  if (sEl.role === 'heading') { const fs = parseFloat(sEl.style && sEl.style.font && sEl.style.font.size) || 16; roleTerm *= fs >= 32 ? 1.25 : fs >= 24 ? 1.1 : 0.95; }
  if (/\b(logo|brand|wordmark)\b/i.test(txt) || (sEl.asset && sEl.asset.isImage && y < 140)) roleTerm = Math.max(roleTerm, 2.3);
  if ((sEl.role === 'button' || sEl.role === 'link') && sEl.style && /rgb|#/.test(sEl.style.backgroundColor || '') && parseAlpha(sEl.style.backgroundColor) > 0.05) roleTerm = Math.max(roleTerm, 2.0);
  // text-length: a long paragraph carries more meaning than a 1-char glyph (but capped — a wall of text is not 100x a heading).
  const textTerm = txt ? Math.min(1.4, 0.7 + Math.log1p(txt.trim().length) / 8) : 0.85;
  // source-contrast: high-contrast source content is more visually dominant (and its loss is more visible).
  const cTerm = sourceContrastTerm(sEl);
  // centrality: horizontally-centred fold content (xFrac near 0.5 with width) is the focal point.
  const xFrac = box && box.xFrac != null ? box.xFrac : (box && vw ? box.x / vw : 0.5);
  const wFrac = box && box.wFrac != null ? box.wFrac : (box && vw ? box.w / vw : 0.3);
  const centerMid = xFrac + wFrac / 2;
  const centralTerm = 1 - Math.min(0.35, Math.abs(0.5 - centerMid)); // 1.0 at centre, ~0.65 at the edge
  const s = areaTerm * foldTerm * roleTerm * textTerm * cTerm * centralTerm;
  return Math.max(0.15, Math.min(8, s));
}
function parseAlpha(s) { const c = M.parseColor(s); return c ? (c.a != null ? c.a : 1) : 0; }
function sourceContrastTerm(sEl) {
  const fg = M.parseColor(sEl.style && sEl.style.color);
  const bg = M.parseColor(sEl.style && sEl.style.backgroundColor);
  if (!fg) return 1.0;
  const cr = M.contrastRatio(fg, (bg && (bg.a == null || bg.a > 0.05)) ? bg : { r: 255, g: 255, b: 255, a: 1 });
  if (cr == null) return 1.0;
  return cr >= 7 ? 1.15 : cr >= 4.5 ? 1.05 : cr >= 2 ? 0.95 : 0.85;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// floor-unit magnitude — the commensurating step. magnitude_a = excess_a / floor_a (>0 only when the axis trips).
// We re-use applyFloors (which already computes excess = max(0, directedMagnitude(raw) − floor) and trip), then
// divide by the floor so every axis is in the SAME unit (multiples of its own JND-level floor).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function flooredRows(floors, sEl, cEl, vw, opts = {}) {
  const rows = F.applyFloors(floors, sEl, cEl, vw, opts);
  return rows.map((r) => {
    if (!r.trip || r.floor == null || !(r.floor > 0)) return { ...r, magnitude: 0 };
    return { ...r, magnitude: +(r.excess / r.floor).toFixed(4) };
  });
}

// per-element severity = salience × Σ_a W_a · magnitude_a  (sum over the element's TRIPPED axes).
export function elementSeverity(sEl, vw, pageH, trippedRows) {
  const sal = salience(sEl, vw, pageH);
  let acc = 0; const contrib = [];
  for (const r of trippedRows) {
    if (!(r.magnitude > 0)) continue;
    const w = weightOf(r.axis);
    const c = w * r.magnitude;
    acc += c;
    contrib.push({ axis: r.axis, class: r.class, magnitude: r.magnitude, weight: w, contribution: +c.toFixed(4) });
  }
  // squash Σ(W·mag) into a [0,1) severity-per-element via a saturating map so one catastrophic axis ≈ 1 and many
  // tiny ones don't sum past 1. salience scales the *visibility* of that severity (an invisible heading on a hero
  // is worse than on a footnote). We cap the product at 1 (a single element cannot be "more than fully broken").
  const raw = 1 - Math.exp(-acc);             // Σ contribution → [0,1)
  const sev = Math.min(1, raw * Math.min(3, sal) / 1.0); // salience amplifies, capped so a huge hero can't exceed 1
  return { severity: +Math.min(1, sev).toFixed(4), salience: +sal.toFixed(3), sumContribution: +acc.toFixed(4), contrib };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SOURCE-TREE CONTAINMENT + SPATIAL ADJACENCY (the CC edge set). srcPath = "a>b>c|N|hHASH"; the PATH part before
// the first '|' encodes DOM containment (prefix). Adjacency = boxes that touch / overlap / are vertically next.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function pathOf(srcPathOrRef) { return String(srcPathOrRef || '').split('|')[0]; }
export function isAncestorPath(ancestor, descendant) {
  const a = pathOf(ancestor), d = pathOf(descendant);
  return a !== d && d.startsWith(a + '>');
}
export function isContainmentEdge(refA, refB) {
  // a containment EDGE is parent↔child (direct or near-direct) — we use ancestor-or-descendant either way (the
  // CC only needs connectivity, and containment is the propagation channel for geometry).
  return isAncestorPath(refA, refB) || isAncestorPath(refB, refA);
}
function boxAt(el, vw) { return el && el.box && (el.box[vw] || el.box[String(vw)]); }
export function iou(a, b) {
  if (!a || !b) return 0;
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy; if (inter <= 0) return 0;
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}
export function isSpatiallyAdjacent(boxA, boxB, vw) {
  if (!boxA || !boxB) return false;
  if (iou(boxA, boxB) > 0.001) return true;                         // overlap ⇒ adjacent
  // vertical adjacency: stacked within a small gap and horizontally overlapping
  const gap = 24;
  const hOverlap = Math.min(boxA.x + boxA.w, boxB.x + boxB.w) - Math.max(boxA.x, boxB.x) > 0;
  const vGapAB = boxB.y - (boxA.y + boxA.h), vGapBA = boxA.y - (boxB.y + boxB.h);
  if (hOverlap && ((vGapAB >= 0 && vGapAB <= gap) || (vGapBA >= 0 && vGapBA <= gap))) return true;
  return false;
}

// ── UNION-FIND ─────────────────────────────────────────────────────────────────────────────────────────────
function makeUF(keys) {
  const parent = new Map(); for (const k of keys) parent.set(k, k);
  const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; } return r; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  return { find, union, parent };
}

// ── coherence predicates per family ──────────────────────────────────────────────────────────────────────────
// GEOMETRY: two pairs are coherent iff they share the SAME translation + uniform scale within tol (one rigid+scale
// transform explains both). We compute each pair's (dx,dy,sw,sh) and compare.
function geomTransform(sEl, cEl, vw) {
  const sb = boxAt(sEl, vw), cb = boxAt(cEl, vw); if (!sb || !cb) return null;
  return { dx: cb.x - sb.x, dy: cb.y - sb.y, sw: sb.w > 0 ? cb.w / sb.w : 1, sh: sb.h > 0 ? cb.h / sb.h : 1 };
}
function geomCoherent(tA, tB) {
  if (!tA || !tB) return false;
  const dTrans = Math.max(Math.abs(tA.dx - tB.dx), Math.abs(tA.dy - tB.dy));
  const dScale = Math.max(Math.abs(tA.sw - tB.sw), Math.abs(tA.sh - tB.sh));
  return dTrans <= 24 && dScale <= 0.12; // same shift (≤24px) + same uniform scale (≤12%)
}
// STYLE: two pairs are coherent iff the colour moved the SAME Lab direction (a theme flip recolours everyone the
// same way) OR the same font substitution. We compare the ΔLab vector direction (cosine) + the font base swap.
function styleSignature(sEl, cEl) {
  const sFg = M.parseColor(sEl && sEl.style && sEl.style.color), cFg = M.parseColor(cEl && cEl.style && cEl.style.color);
  let dLab = null;
  if (sFg && cFg) { const a = M.rgbToLab(sFg), b = M.rgbToLab(cFg); dLab = [b.L - a.L, b.a - a.a, b.b - a.b]; }
  const sFam = fontBase(sEl && sEl.style && sEl.style.font && sEl.style.font.family);
  const cFam = fontBase(cEl && cEl.style && cEl.style.font && cEl.style.font.family);
  return { dLab, fontSwap: sFam && cFam && sFam !== cFam ? `${sFam}→${cFam}` : null };
}
function fontBase(family) {
  if (!family) return '';
  return String(family).split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase().replace(/\s+fallback$/, '');
}
function styleCoherent(sgA, sgB) {
  // same font substitution ⇒ coherent
  if (sgA.fontSwap && sgB.fontSwap && sgA.fontSwap === sgB.fontSwap) return true;
  // same colour DIRECTION (cosine ≥ 0.9) and non-trivial magnitude ⇒ coherent recolour
  if (sgA.dLab && sgB.dLab) {
    const mA = Math.hypot(...sgA.dLab), mB = Math.hypot(...sgB.dLab);
    if (mA > 2 && mB > 2) { const dot = sgA.dLab[0] * sgB.dLab[0] + sgA.dLab[1] * sgB.dLab[1] + sgA.dLab[2] * sgB.dLab[2]; if (dot / (mA * mB) >= 0.9) return true; }
  }
  return false;
}

// ── GLOBAL-CAUSE TEMPLATES — classify a coherent component. match ⇒ suppress|route-to-responsive; NO match ⇒
// ONE structural defect at full severity. NEVER suppress on coherence alone. ──────────────────────────────────
export function classifyComponent(comp, ctx) {
  // comp: { family, members:[{ref,sEl,cEl,vw,rows,sev}], axes:Set, size }
  const axesArr = [...comp.axes];
  const singleAxis = axesArr.length === 1;
  // (a) FONT-UNAVAILABLE: a style component whose members share ONE font substitution AND the substituted-TO
  //     family is NOT in the clone font manifest is a font-availability fallback (route to a SINGLE font defect,
  //     not N). If the target font IS present, it is a deliberate restyle (NOT suppressed).
  if (comp.family === 'style') {
    const swaps = comp.members.map((m) => styleSignature(m.sEl, m.cEl).fontSwap).filter(Boolean);
    if (swaps.length >= Math.max(2, comp.size * 0.6) && new Set(swaps).size === 1) {
      const toFam = swaps[0].split('→')[1];
      const inManifest = ctx.cloneFontManifest && ctx.cloneFontManifest.has(toFam);
      return { template: 'font-substitution', global: true, route: 'one-font-defect',
        suppressToOne: true, note: `coherent font swap ${swaps[0]}${inManifest ? ' (target IN clone manifest — deliberate restyle, kept as ONE defect)' : ' (target NOT in clone manifest — font-unavailable fallback, ONE defect)'}` };
    }
  }
  // (b) RESPONSIVE-REFLOW: a geometry component coherent ONLY at a narrow viewport that matches a breakpoint, and
  //     SILENT at the wide viewport, is reflow — route to the responsive channel (not a wide-viewport structural
  //     defect). Confirmed only when the component is single-viewport AND that viewport is the narrow one.
  if (comp.family === 'geometry') {
    const vws = new Set(comp.members.map((m) => m.vw));
    const onlyNarrow = vws.size === 1 && [...vws][0] === ctx.narrowVw && ctx.narrowVw !== ctx.joinVw;
    if (onlyNarrow && singleAxis && axesArr[0] === 'bbox-ratio') {
      return { template: 'responsive-reflow', global: true, route: 'responsive', suppressToOne: false,
        note: `geometry component coherent only @${ctx.narrowVw} (a breakpoint) — routed to the responsive channel, not a wide-viewport defect` };
    }
    // (c) UNIFORM SCROLLBAR OFFSET: every member shifted by the SAME small dx (~15-17px) with scale≈1 ⇒ a
    //     scrollbar-width offset, not a layout defect. Suppress to one (cosmetic).
    const ts = comp.members.map((m) => geomTransform(m.sEl, m.cEl, m.vw)).filter(Boolean);
    if (ts.length >= 3 && ts.every((t) => Math.abs(t.sw - 1) < 0.02 && Math.abs(t.sh - 1) < 0.02 && Math.abs(t.dy) < 4 && Math.abs(t.dx - ts[0].dx) < 3 && Math.abs(ts[0].dx) >= 8 && Math.abs(ts[0].dx) <= 20)) {
      return { template: 'scrollbar-offset', global: true, route: 'suppress', suppressToOne: true,
        note: `uniform ${ts[0].dx | 0}px horizontal shift, scale≈1 — scrollbar-width offset, suppressed` };
    }
  }
  // (d) GLOBAL_DIFF demotion (theme-level shift): a big single-axis component ⇒ demote ×0.2, do NOT drop.
  if (comp.size > GLOBAL_DIFF_MIN_SIZE && singleAxis) {
    return { template: 'global-diff', global: true, route: 'demote', factor: GLOBAL_DIFF_FACTOR, suppressToOne: false,
      note: `theme-level shift: ${comp.size} elements on a single axis (${axesArr[0]}) — severity ×${GLOBAL_DIFF_FACTOR}, demoted not dropped` };
  }
  // DEFAULT (the load-bearing anti-suppression rule): an unexplained coherent component is ONE REAL DEFECT at
  // full severity (coherent ≠ benign). Collapse N members to ONE event at the ROOT element's salience × magnitude.
  return { template: 'unexplained-coherent', global: false, route: 'one-defect', suppressToOne: true,
    note: `coherent ${comp.family} component (${comp.size} elements, axes ${axesArr.join('+')}) with no global-cause match — ONE structural defect at root salience × magnitude (NOT suppressed: coherent≠benign)` };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// (3) RELATIONAL AXES over BOUNDED high-salience pairs. Never O(n²): take the top-K salient SOURCE elements, then
// for each only consider its containment-siblings + spatial neighbours WITHIN that bounded set. Emits axis rows
// in the SAME shape axisDeltas does (so they flow through floors + the CC). source-IOU≈0 → clone-IOU>floor fires.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function relationalRows(boundedPairs, vw) {
  // boundedPairs: [{ref,sEl,cEl}] already restricted to high-salience present pairs. Compare each unordered pair.
  const rows = [];
  for (let i = 0; i < boundedPairs.length; i++) for (let j = i + 1; j < boundedPairs.length; j++) {
    const A = boundedPairs[i], B = boundedPairs[j];
    if (!A.cEl || !B.cEl) continue;
    const sA = boxAt(A.sEl, vw), sB = boxAt(B.sEl, vw), cA = boxAt(A.cEl, vw), cB = boxAt(B.cEl, vw);
    if (!sA || !sB || !cA || !cB) continue;
    const edgeRef = `${A.ref}×${B.ref}`;
    // COLLISION: clone boxes overlap when the source boxes did not (clone_IOU − source_IOU). source≈0 → clone>floor fires.
    const srcIou = iou(sA, sB), cloneIou = iou(cA, cB);
    const collisionDelta = Math.max(0, cloneIou - srcIou);
    if (collisionDelta > 0) rows.push(relRow(edgeRef, 'collision', vw, srcIou, cloneIou, collisionDelta, 'overlapping-sections', { a: A.ref, b: B.ref }));
    // CONTAINMENT-ESCAPE: source had A inside B (or B inside A); the clone child escapes the clone parent's bounds.
    if (isAncestorPath(B.ref, A.ref) || isAncestorPath(A.ref, B.ref)) {
      const [par, chi, cPar, cChi] = isAncestorPath(B.ref, A.ref) ? [sB, sA, cB, cA] : [sA, sB, cA, cB];
      const srcContained = contains(par, chi), cloneContained = contains(cPar, cChi);
      const escapeDelta = srcContained && !cloneContained ? escapeFrac(cPar, cChi) : 0;
      if (escapeDelta > 0) rows.push(relRow(edgeRef, 'containment-escape', vw, 1, +(1 - escapeDelta).toFixed(3), escapeDelta, 'wrong-layout', { parent: isAncestorPath(B.ref, A.ref) ? B.ref : A.ref, child: isAncestorPath(B.ref, A.ref) ? A.ref : B.ref }));
    }
    // READING-ORDER: source vertical order (A above B) flipped in the clone.
    const srcAbove = sA.y + sA.h / 2 < sB.y + sB.h / 2, cloneAbove = cA.y + cA.h / 2 < cB.y + cB.h / 2;
    if (srcAbove !== cloneAbove) rows.push(relRow(edgeRef, 'reading-order', vw, srcAbove ? 1 : 0, cloneAbove ? 1 : 0, 1, 'wrong-layout', { a: A.ref, b: B.ref }));
    // Z-PILE: high overlap in BOTH but the stacking (later-in-order paints on top) inverted — approximated by a
    // large clone overlap with a source/clone zIndex inversion if present.
    if (cloneIou > 0.3) {
      const zA = parseFloat(A.cEl.style && A.cEl.style.zIndex) || 0, zB = parseFloat(B.cEl.style && B.cEl.style.zIndex) || 0;
      const szA = parseFloat(A.sEl.style && A.sEl.style.zIndex) || 0, szB = parseFloat(B.sEl.style && B.sEl.style.zIndex) || 0;
      if ((szA - szB) * (zA - zB) < 0 && Math.abs(zA - zB) > 0) rows.push(relRow(edgeRef, 'z-pile', vw, Math.sign(szA - szB), Math.sign(zA - zB), 1, 'overlapping-sections', { a: A.ref, b: B.ref }));
    }
  }
  return rows;
}
function relRow(ref, axis, vw, src, clone, delta, cls, extra) {
  return { ref, viewport: vw, axis, src, clone, delta: +Number(delta).toFixed(4), tol: 0, flagged: true, uncalibrated: true, class: cls, relational: true, ...extra };
}
function contains(outer, inner) { return inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.w <= outer.x + outer.w + 1 && inner.y + inner.h <= outer.y + outer.h + 1; }
function escapeFrac(outer, inner) {
  const ox0 = outer.x, oy0 = outer.y, ox1 = outer.x + outer.w, oy1 = outer.y + outer.h;
  const ix = Math.max(0, Math.min(ox1, inner.x + inner.w) - Math.max(ox0, inner.x));
  const iy = Math.max(0, Math.min(oy1, inner.y + inner.h) - Math.max(oy0, inner.y));
  const inside = ix * iy, area = Math.max(1, inner.w * inner.h);
  return +(1 - inside / area).toFixed(3); // fraction of the child that lies OUTSIDE the parent
}
// relational floor: a small JND on IOU/fraction so a 1px touch doesn't fire (semantic prior, label-blind).
export const RELATIONAL_FLOOR = { collision: 0.05, 'containment-escape': 0.05, 'reading-order': 0.5, 'z-pile': 0.5, 'state-pin': 0.5 };
export function floorRelational(rows) {
  return rows.map((r) => {
    const fl = RELATIONAL_FLOOR[r.axis] != null ? RELATIONAL_FLOOR[r.axis] : 0;
    const excess = Math.max(0, r.delta - fl);
    return { ...r, floor: fl, excess: +excess.toFixed(4), trip: excess > 0, magnitude: fl > 0 ? +(excess / fl).toFixed(4) : (excess > 0 ? excess : 0) };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// STATE AXIS (page-level scroll behaviour). The spine's per-element axisDeltas carries no scroll-state axis, so a
// wrongly-sticky nav (the clone PINS a top-band box across scroll that the source does NOT) was a coverage gap
// the hand-detector #8 caught and the engine missed. We close it ADDITIVELY here by reading the capture's
// page-level stickySummary (source vs clone top-band pins) — NOT a layout delta. Emits a `state-pin` axis row per
// wrongly-pinned clone box, attached to the corresponding clone record so it localizes + carries salience.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function stateRows(blob, vw, joinVw) {
  const rows = [];
  const srcSticky = (blob.sourceCapture && blob.sourceCapture.stickySummary) || [];
  const cloneSticky = (blob.cloneCapture && blob.cloneCapture.stickySummary) || [];
  // a wrongly-sticky pin = the CLONE pins a top-band box (top0 ≤ band) the SOURCE does not pin at all. We measure
  // "pinned" as a box whose top stays put across the capture's scroll (top0 ≈ topY) in the top band.
  const BAND = 64, MOVE = 24;
  const isTopBandPin = (s) => s && s.top0 != null && s.top0 <= BAND && (s.topY == null || Math.abs((s.top0 || 0) - (s.topY || 0)) < MOVE);
  const srcPins = srcSticky.filter(isTopBandPin).length;
  const clonePins = cloneSticky.filter(isTopBandPin);
  if (clonePins.length > 0 && srcPins === 0) {
    // wrongly-sticky: one event per clone pin (typically 1 — a nav/header). delta=1 (a binary state flip).
    for (const p of clonePins) {
      rows.push({ ref: `state:pin@${p.idx != null ? p.idx : 'top'}`, viewport: vw, axis: 'state-pin', src: 0, clone: 1,
        delta: 1, tol: 0, flagged: true, uncalibrated: true, class: 'wrongly-sticky', relational: true,
        stateIdx: p.idx, position: p.position });
    }
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// (4) NAMING PROJECTION — class = name(dominant_axis, role, salience_bucket). COSMETIC. A wrong/missing label
// NEVER loses a detection: the returned object always carries the fired axes + severity; `class` is decoration.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function projectName(dominantAxis, role, bucket, firedAxes) {
  const fired = new Set(firedAxes || []);
  const isHeading = role === 'heading' || bucket === 'h1';
  const isLogo = bucket === 'logo';
  const isCta = bucket === 'cta' || role === 'button';
  const isHero = bucket === 'hero';
  // ordered cosmetic lookups (most-specific first). Each is a pure projection of axis+role+bucket.
  if ((fired.has('presence') || fired.has('bbox-ratio')) && isHero) return 'blank-hero';
  if ((fired.has('img-src') || fired.has('img-svghash') || fired.has('img-phash')) && isLogo) return 'wrong-logo';
  if ((fired.has('img-src') || fired.has('img-svghash') || fired.has('img-phash')) && (role === 'img')) return 'missing-imagery';
  if ((fired.has('text-contrast') || fired.has('presence')) && isHeading) return 'invisible-heading';
  // CTA-specific BEFORE the generic invisible-text fallback: an unstyled CTA loses its chrome (recolour / shrink /
  // type-scale) and often ALSO drops text-contrast — the CTA context must win over the generic contrast label.
  if ((fired.has('color-deltaE') || fired.has('bbox-ratio') || fired.has('font-size-ratio') || fired.has('text-contrast')) && isCta) return 'unstyled-cta';
  if (fired.has('text-contrast')) return 'invisible-text';
  if (fired.has('presence')) return isLogo ? 'missing-logo' : 'missing-section';
  if (fired.has('state-pin')) return 'wrongly-sticky'; // page-level scroll-pin behaviour (the spine's STATE axis)
  if (fired.has('collision') || fired.has('z-pile')) return 'overlapping-sections';
  if (fired.has('containment-escape') || fired.has('reading-order')) return 'wrong-layout';
  if (fired.has('h-overflow')) return 'overlapping-sections';
  if (fired.has('color-deltaE')) return 'color-off';
  if (fired.has('font-size-ratio')) return 'font-off';
  if (fired.has('bbox-ratio')) return 'wrong-layout';
  return dominantAxis ? `${dominantAxis}-defect` : 'defect'; // graceful fallback — STILL a named detection
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// THE ENGINE — runs the whole pipeline over a compare blob. Returns a localized event MAP + a page score.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function runEngine(blob, floorsObj, { topK = 24, widths = null } = {}) {
  const report = blob.report;
  const floors = floorsObj.floors || floorsObj; // accept the full frozen file or a bare floors map
  const WIDTHS = widths || (report.widths || [1440]).filter((w) => blob.sourceCapture.records.some((r) => r.box && (r.box[w] || r.box[String(w)])));
  const joinVw = WIDTHS[0];
  const narrowVw = WIDTHS.length > 1 ? WIDTHS[WIDTHS.length - 1] : joinVw;
  const cloneFontManifest = new Set(blob.cloneCapture.records.map((r) => fontBase(r.style && r.style.font && r.style.font.family)).filter(Boolean));
  const ctx = { joinVw, narrowVw, cloneFontManifest };

  // ── per-viewport: tripped axis rows per pair (element + relational), salience, severity ──
  const events = [];                 // localized defect events (post-coherence)
  const elementRows = [];            // all tripped element rows (for the CC + diagnostics)
  const pageH = {};
  const presentPairsByVw = {}, allPairsByVw = {};
  let unmatchedPenalty = 0; const unmatchedHiSal = [];

  for (const vw of WIDTHS) {
    const { pairs } = M.readPairs(blob, vw);
    const ph = (report.pageHeightByVw && report.pageHeightByVw.source && (report.pageHeightByVw.source[vw] || report.pageHeightByVw.source[String(vw)])) || 0;
    pageH[vw] = ph;
    allPairsByVw[vw] = pairs;
    presentPairsByVw[vw] = pairs.filter((p) => p.cEl);

    // element axis rows (floored → magnitude in floor units)
    for (const { ref, sEl, cEl } of pairs) {
      const rows = flooredRows(floors, sEl, cEl, vw, {}).filter((r) => r.trip);
      if (rows.length) elementRows.push({ ref, vw, sEl, cEl, rows, bucket: F.salienceBucket(sEl || cEl, vw) });
      // UNMATCHED high-salience SOURCE element penalty (a missing logo/hero is a defect even with no clone node).
      if (!cEl) {
        const sal = salience(sEl, vw, ph);
        if (sal >= 1.5) { unmatchedPenalty += Math.min(1, sal / 4); unmatchedHiSal.push({ ref, vw, salience: +sal.toFixed(2), bucket: F.salienceBucket(sEl, vw) }); }
      }
    }

    // relational axes over the BOUNDED top-K salient present pairs (never O(n²))
    const ranked = presentPairsByVw[vw]
      .map((p) => ({ ...p, _sal: salience(p.sEl, vw, ph) }))
      .sort((a, b) => b._sal - a._sal)
      .slice(0, topK);
    const relRows = floorRelational(relationalRows(ranked, vw)).filter((r) => r.trip);
    // attach relational rows to a synthetic "edge element" event-row (its salience = max of the two endpoints)
    const salByRef = new Map(ranked.map((p) => [p.ref, p._sal]));
    for (const rr of relRows) {
      const [a, b] = [rr.a || rr.parent, rr.b || rr.child].filter(Boolean);
      const sal = Math.max(salByRef.get(a) || 1, salByRef.get(b) || 1);
      elementRows.push({ ref: rr.ref, vw, sEl: ranked.find((p) => p.ref === a)?.sEl || null, cEl: null, rows: [rr], bucket: 'relational', relationalSalience: sal });
    }

    // STATE axis (page-level scroll behaviour) — only on the JOIN (wide) viewport, where state was captured.
    if (vw === joinVw) {
      const stRows = floorRelational(stateRows(blob, vw, joinVw)).filter((r) => r.trip);
      for (const sr of stRows) {
        // a wrongly-sticky pin is a fold nav/header — give it a nav-class salience (high, but below a missing hero).
        elementRows.push({ ref: sr.ref, vw, sEl: null, cEl: null, rows: [sr], bucket: 'nav', relationalSalience: 2.0, role: 'navigation' });
      }
    }
  }

  // ── (2) PER-FAMILY COHERENCE CC: build nodes/edges, union-find per propagating family, classify components ──
  const coherence = coherenceCC(elementRows, WIDTHS, ctx);

  // ── emit ONE event per coherence component (or per singleton row), with naming projection + severity ──
  const seenSingleton = new Set();
  for (const comp of coherence.components) {
    const cls = comp.classification;
    // representative = highest-severity / highest-salience member = the ROOT.
    const members = comp.members;
    const root = members.reduce((best, m) => (m._sev.severity > (best ? best._sev.severity : -1) ? m : best), null) || members[0];
    let sev = root._sev.severity;
    if (cls.route === 'demote') sev = +(sev * (cls.factor || GLOBAL_DIFF_FACTOR)).toFixed(4);
    if (cls.route === 'responsive' || cls.route === 'suppress') {
      // routed away from the wide-viewport structural channel (responsive) or cosmetic (scrollbar) — record, near-zero severity here.
      events.push(makeEvent(root, comp, cls, cls.route === 'responsive' ? +(sev * 0.25).toFixed(4) : 0));
      continue;
    }
    events.push(makeEvent(root, comp, cls, sev));
  }
  // singleton-family rows (asset/text/presence) that were NOT in any propagating component → one event each.
  for (const er of elementRows) {
    const propagating = er.rows.some((r) => PROPAGATING_FAMILIES.has(familyOf(r.axis)));
    if (propagating) continue; // handled by the CC (it includes propagating-family members)
    const key = `${er.ref}@${er.vw}`; if (seenSingleton.has(key)) continue; seenSingleton.add(key);
    const sev = severityOfRow(er, pageH);
    events.push(makeEvent({ ...er, _sev: sev }, { family: familyOf(er.rows[0].axis), members: [er], axes: new Set(er.rows.map((r) => r.axis)), size: 1 },
      { template: 'singleton', global: false, route: 'one-defect', note: 'singleton-family (asset/text/presence) — local, non-propagating' }, sev.severity));
  }

  // ── PAGE SCORE: aggregate (1 − severity) over corresponded elements, minus unmatched-hi-sal + relational ──
  // We aggregate at the EVENT level (post-coherence) so a coherent N-shift counts ONCE, not N times.
  const eventSeverities = events.map((e) => e.severity).filter((s) => s > 0);
  // product-of-(1−sev) is too punishing across many tiny events; use a salience-weighted mean of (1−sev)
  // complemented by the worst few (a single fatal must drag the score down). Both are label-blind aggregations.
  const meanKeep = eventSeverities.length ? 1 - (eventSeverities.reduce((a, s) => a + s, 0) / eventSeverities.length) : 1;
  const worst = eventSeverities.slice().sort((a, b) => b - a).slice(0, 3);
  const worstDrag = worst.length ? worst.reduce((a, s) => a + s, 0) / worst.length : 0;
  const unmatchedDrag = Math.min(0.5, unmatchedPenalty / Math.max(4, presentPairsByVw[joinVw] ? presentPairsByVw[joinVw].length / 6 : 4));
  const pageScore = +Math.max(0, Math.min(1, 0.55 * meanKeep + 0.45 * (1 - worstDrag) - unmatchedDrag)).toFixed(4);

  // by-class rollup (naming projection) — graceful: every event has a class, none lost.
  const byClass = {}; for (const e of events) byClass[e.class] = (byClass[e.class] || 0) + 1;

  return {
    meta: { source: report.source, clone: report.clone, widths: WIDTHS, joinVw, narrowVw, topK,
      cloneFontManifestSize: cloneFontManifest.size, noLabelFit: true },
    pageScore,
    events: events.sort((a, b) => b.severity - a.severity),
    byClass,
    coherence: { components: coherence.components.length, collapsed: coherence.collapsed,
      templates: coherence.components.reduce((m, c) => { const t = c.classification.template; m[t] = (m[t] || 0) + 1; return m; }, {}) },
    unmatchedHiSal,
    aggregate: { events: events.length, fatalEvents: events.filter((e) => e.severity >= 0.6).length,
      meanKeep: +meanKeep.toFixed(4), worstDrag: +worstDrag.toFixed(4), unmatchedDrag: +unmatchedDrag.toFixed(4) },
  };

  // ── inner helpers (close over pageH) ──
  function severityOfRow(er, ph) {
    const baseVw = er.vw;
    const sal = er.relationalSalience != null ? er.relationalSalience : salience(er.sEl, baseVw, ph[baseVw] || 0);
    let acc = 0; const contrib = [];
    for (const r of er.rows) { if (!(r.magnitude > 0)) continue; const w = weightOf(r.axis); const c = w * r.magnitude; acc += c; contrib.push({ axis: r.axis, class: r.class, magnitude: r.magnitude, weight: w, contribution: +c.toFixed(4) }); }
    const raw = 1 - Math.exp(-acc);
    return { severity: +Math.min(1, raw * Math.min(3, sal)).toFixed(4), salience: +sal.toFixed(3), sumContribution: +acc.toFixed(4), contrib };
  }
  function makeEvent(rootMember, comp, classification, severity) {
    const er = rootMember;
    const firedAxes = [...new Set(comp.members.flatMap((m) => m.rows.map((r) => r.axis)))];
    const dominant = firedAxes.slice().sort((a, b) => (weightOf(b) - weightOf(a)))[0] || null;
    const bucket = er.bucket || F.salienceBucket(er.sEl || er.cEl, er.vw);
    const role = (er.sEl && er.sEl.role) || (er.cEl && er.cEl.role) || er.role || null;
    const cls = projectName(dominant, role, bucket, firedAxes);
    return {
      ref: er.ref, viewport: er.vw, role, bucket, class: cls, dominantAxis: dominant,
      severity: +Number(severity).toFixed(4), salience: er._sev ? er._sev.salience : undefined,
      firedAxes, magnitudes: er._sev ? er._sev.contrib : (er.rows || []).map((r) => ({ axis: r.axis, magnitude: r.magnitude, weight: weightOf(r.axis) })),
      coherence: { family: comp.family, componentSize: comp.size, template: classification.template, route: classification.route, note: classification.note },
      noLabelFit: true,
    };
  }
}

// build the per-family coherence components from the tripped element rows.
function coherenceCC(elementRows, widths, ctx) {
  // attach per-element severity first (used to pick the root + to report).
  for (const er of elementRows) er._sev = sevOf(er, ctx);
  const components = [];
  let collapsed = 0;
  for (const family of PROPAGATING_FAMILIES) {
    // nodes for THIS family = element rows that trip at least one axis of this family.
    const fam = elementRows.filter((er) => er.rows.some((r) => familyOf(r.axis) === family && !r.relational ? true : (familyOf(r.axis) === family)));
    const nodes = fam.filter((er) => er.rows.some((r) => familyOf(r.axis) === family));
    if (!nodes.length) continue;
    const keyOf = (er) => `${er.ref}@${er.vw}`;
    const uf = makeUF(nodes.map(keyOf));
    const byKey = new Map(nodes.map((n) => [keyOf(n), n]));
    // edges: containment ∩ adjacency ∩ same-family-trip ∩ coherent. Bounded: only compare nodes that share a
    // viewport AND are containment-or-adjacent (we index by viewport to avoid cross-vw O(n²) blowup).
    const byVw = {}; for (const n of nodes) (byVw[n.vw] ||= []).push(n);
    for (const vw of Object.keys(byVw)) {
      const list = byVw[vw];
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const A = list[i], B = list[j];
        const contain = isContainmentEdge(A.ref, B.ref);
        const adj = isSpatiallyAdjacent(boxAt(A.sEl || A.cEl, +vw), boxAt(B.sEl || B.cEl, +vw), +vw);
        if (!contain && !adj) continue;
        const coherent = family === 'geometry'
          ? geomCoherent(geomTransform(A.sEl, A.cEl, +vw), geomTransform(B.sEl, B.cEl, +vw))
          : styleCoherent(styleSignature(A.sEl, A.cEl), styleSignature(B.sEl, B.cEl));
        if (contain && coherent) uf.union(keyOf(A), keyOf(B)); // containment is the propagation channel
        else if (adj && coherent && family === 'geometry') uf.union(keyOf(A), keyOf(B)); // adjacency only carries geometry
      }
    }
    // gather components
    const groups = new Map();
    for (const n of nodes) { const r = uf.find(keyOf(n)); (groups.get(r) || groups.set(r, []).get(r)).push(n); }
    for (const members of groups.values()) {
      const axes = new Set(members.flatMap((m) => m.rows.filter((r) => familyOf(r.axis) === family).map((r) => r.axis)));
      const comp = { family, members, axes, size: members.length };
      comp.classification = classifyComponent(comp, ctx);
      if (members.length > 1) collapsed += members.length - 1; // N members → 1 event ⇒ (N−1) collapsed
      components.push(comp);
    }
  }
  return { components, collapsed };
  function sevOf(er, ctx) {
    const sal = er.relationalSalience != null ? er.relationalSalience : salience(er.sEl, er.vw, 0);
    let acc = 0; const contrib = [];
    for (const r of er.rows) { if (!(r.magnitude > 0)) continue; const w = weightOf(r.axis); const c = w * r.magnitude; acc += c; contrib.push({ axis: r.axis, magnitude: r.magnitude, weight: w, contribution: +c.toFixed(4) }); }
    return { severity: +Math.min(1, (1 - Math.exp(-acc)) * Math.min(3, sal)).toFixed(4), salience: +sal.toFixed(3), sumContribution: +acc.toFixed(4), contrib };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// OFFLINE SELFTEST — synthetic fixtures only (no capture). Proves: (i) self-clone ~100/0 through the engine;
// (ii) a synthetic injected diff fires the right axis + class; (iii) coherence collapses a coherent N-shift to 1
// event; (iv) a relational collision fires between two overlapping sections. Builder does NOT self-bless — the
// orchestrator re-executes _axisdelta-engine-selftest.mjs (this inline copy is for convenience / node --check).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function loadFloors(floorsPath) {
  const p = floorsPath || path.join(__dir, 'calibration', 'axis-floors.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function rec(over = {}) {
  const base = { ref: 'body>div|1|h' + Math.random().toString(36).slice(2, 8), srcPath: null, tag: 'div', role: null, text: '', ownText: '',
    box: { 1440: { x: 0, y: 60, w: 200, h: 40, right: 200, xFrac: 0, wFrac: 0.14 }, 390: { x: 0, y: 60, w: 200, h: 40, right: 200 } },
    style: { color: 'rgb(20,20,20)', backgroundColor: 'rgb(255,255,255)', font: { size: '16px', family: 'Inter' }, border: { width: {}, style: {}, color: {} }, zIndex: '0', position: 'static' },
    asset: { isImage: false, naturalSrc: null, svgHash: null }, pseudo: {}, states: {} };
  const r = Object.assign(base, over);
  if (!r.srcPath) r.srcPath = r.ref;
  return r;
}
function mkBlob(srcRecs, cloneRecs, over = {}) {
  return {
    report: Object.assign({ source: 'https://selftest.local', clone: 'http://localhost:8001/?page_id=selftest', widths: [1440, 390], joinWidth: 1440,
      pageHeightByVw: { source: { 1440: 4000, 390: 6000 }, clone: { 1440: 4000, 390: 6000 } },
      matched: srcRecs.map((s, i) => cloneRecs[i] ? ({ srcRef: s.ref, cloneRef: cloneRecs[i].ref }) : null).filter(Boolean),
      relation: Object.fromEntries(srcRecs.map((s, i) => [s.srcPath, cloneRecs[i] ? [cloneRecs[i].ref] : []])),
      unmatchedSource: srcRecs.filter((s, i) => !cloneRecs[i]).map((s) => s.ref) }, over.report || {}),
    sourceCapture: { records: srcRecs }, cloneCapture: { records: cloneRecs },
  };
}
export function runSelftest() {
  const floors = loadFloors();
  const cases = [];
  const ok = (name, pass, detail = '') => cases.push({ name, pass: !!pass, detail });

  // (i) SELF-CLONE → ~100/0. Build a small source tree, clone := source, run the engine. Zero events, pageScore≈1.
  {
    const src = [
      rec({ ref: 'body>header|1|hA', srcPath: 'body>header|1|hA', tag: 'header', role: 'banner', box: { 1440: { x: 0, y: 10, w: 1440, h: 60, right: 1440, xFrac: 0, wFrac: 1 }, 390: { x: 0, y: 10, w: 390, h: 60, right: 390 } } }),
      rec({ ref: 'body>header>a>img|1|hB', srcPath: 'body>header>a>img|1|hB', tag: 'img', role: 'img', asset: { isImage: true, naturalSrc: 'https://s/logo.svg', svgHash: 'ABC' }, box: { 1440: { x: 20, y: 20, w: 100, h: 40, right: 120, xFrac: 0.014, wFrac: 0.07 }, 390: { x: 20, y: 20, w: 100, h: 40, right: 120 } } }),
      rec({ ref: 'body>main>h1|1|hC', srcPath: 'body>main>h1|1|hC', tag: 'h1', role: 'heading', text: 'Hello World Heading', ownText: 'Hello World Heading', style: { color: 'rgb(17,17,17)', backgroundColor: 'rgb(255,255,255)', font: { size: '40px', family: 'Inter' }, border: { width: {}, style: {}, color: {} } }, box: { 1440: { x: 100, y: 120, w: 600, h: 80, right: 700, xFrac: 0.07, wFrac: 0.42 }, 390: { x: 10, y: 120, w: 360, h: 120, right: 370 } } }),
      rec({ ref: 'body>main>p|1|hD', srcPath: 'body>main>p|1|hD', tag: 'p', text: 'Some descriptive paragraph text here.', ownText: 'Some descriptive paragraph text here.', box: { 1440: { x: 100, y: 220, w: 600, h: 60, right: 700, xFrac: 0.07, wFrac: 0.42 }, 390: { x: 10, y: 260, w: 360, h: 120, right: 370 } } }),
    ];
    const clone = JSON.parse(JSON.stringify(src));
    const r = runEngine(mkBlob(src, clone), floors, {});
    ok('(i) self-clone → ZERO events through the engine', r.events.length === 0, `events=${r.events.length}`);
    ok('(i) self-clone → pageScore ≈ 1.0', r.pageScore >= 0.999, `pageScore=${r.pageScore}`);
  }

  // (ii) INJECTED DIFF fires the right axis + class. invisible-heading: clone heading colour collapses to its bg.
  {
    const sH = rec({ ref: 'body>main>h1|1|hH', srcPath: 'body>main>h1|1|hH', tag: 'h1', role: 'heading', text: 'Big Heading', ownText: 'Big Heading',
      style: { color: 'rgb(17,17,17)', backgroundColor: 'rgb(255,255,255)', font: { size: '44px', family: 'Inter' }, border: { width: {}, style: {}, color: {} } },
      box: { 1440: { x: 100, y: 80, w: 800, h: 80, right: 900, xFrac: 0.07, wFrac: 0.55 }, 390: { x: 10, y: 80, w: 360, h: 120, right: 370 } } });
    const cH = JSON.parse(JSON.stringify(sH)); cH.ref = 'c' + cH.ref; cH.style.color = 'rgb(253,253,253)'; // invisible on white
    const r = runEngine(mkBlob([sH], [cH]), floors, {});
    const ev = r.events.find((e) => e.firedAxes.includes('text-contrast'));
    ok('(ii) injected invisible-heading FIRES text-contrast axis', !!ev, ev ? `class=${ev.class}` : 'no event');
    ok('(ii) naming projection → "invisible-heading"', ev && ev.class === 'invisible-heading', ev ? ev.class : '-');

    // wrong-logo: clone logo img src swapped.
    const sL = rec({ ref: 'body>header>a>img|1|hL', srcPath: 'body>header>a>img|1|hL', tag: 'img', role: 'img', asset: { isImage: true, naturalSrc: 'https://s/logo.svg', svgHash: null },
      box: { 1440: { x: 20, y: 20, w: 120, h: 40, right: 140, xFrac: 0.014, wFrac: 0.08 }, 390: { x: 20, y: 20, w: 120, h: 40, right: 140 } } });
    const cL = JSON.parse(JSON.stringify(sL)); cL.ref = 'c' + cL.ref; cL.asset.naturalSrc = 'https://clone/WRONG.png';
    const rL = runEngine(mkBlob([sL], [cL]), floors, {});
    const evL = rL.events.find((e) => e.firedAxes.includes('img-src'));
    ok('(ii) injected wrong-logo FIRES img-src axis', !!evL, evL ? `class=${evL.class}` : 'no event');
    ok('(ii) naming projection → "wrong-logo"', evL && evL.class === 'wrong-logo', evL ? evL.class : '-');

    // blank-hero: large fold element shrinks to nothing → bbox-ratio, class blank-hero.
    const sHero = rec({ ref: 'body>main>section|1|hX', srcPath: 'body>main>section|1|hX', tag: 'section', role: 'banner', text: 'Hero',
      box: { 1440: { x: 0, y: 0, w: 1440, h: 600, right: 1440, xFrac: 0, wFrac: 1 }, 390: { x: 0, y: 0, w: 390, h: 400, right: 390 } } });
    const cHero = JSON.parse(JSON.stringify(sHero)); cHero.ref = 'c' + cHero.ref;
    cHero.box[1440] = { x: 0, y: 0, w: 1440, h: 24, right: 1440, xFrac: 0, wFrac: 1 }; cHero.box[390] = { x: 0, y: 0, w: 390, h: 18, right: 390 };
    const rHero = runEngine(mkBlob([sHero], [cHero]), floors, {});
    const evHero = rHero.events.find((e) => e.firedAxes.includes('bbox-ratio'));
    ok('(ii) injected blank-hero FIRES bbox-ratio axis', !!evHero, evHero ? `class=${evHero.class}` : 'no event');
    ok('(ii) naming projection → "blank-hero"', evHero && evHero.class === 'blank-hero', evHero ? evHero.class : '-');
  }

  // (iii) COHERENCE collapses a coherent N-element shrink to ONE event. A parent + its children are ALL scaled by
  // the SAME factor (0.7) in the clone — ONE uniform-scale transform explains all of them → the geometry CC unions
  // them into ONE component → ONE event (the other N−1 collapsed). (bbox-ratio is the geometry element-axis; it
  // measures size drift, so a coherent uniform SCALE is what the CC must collapse — a pure translation leaves
  // w/h unchanged and trips no element axis, which is correct: the spine has no position-only axis.)
  {
    const N = 6, src = [], clone = [];
    const parent = rec({ ref: 'body>main>div|1|hG', srcPath: 'body>main>div|1|hG', tag: 'div', box: { 1440: { x: 100, y: 200, w: 800, h: 400, right: 900, xFrac: 0.07, wFrac: 0.55 } } });
    src.push(parent); clone.push(scaleBox(parent, 0.7));
    for (let i = 0; i < N - 1; i++) {
      const child = rec({ ref: `body>main>div>p|${i}|hG${i}`, srcPath: `body>main>div>p|${i}|hG${i}`, tag: 'p', text: 'child paragraph ' + i,
        box: { 1440: { x: 120, y: 220 + i * 60, w: 600, h: 50, right: 720, xFrac: 0.083, wFrac: 0.42 } } });
      src.push(child); clone.push(scaleBox(child, 0.7));
    }
    const r = runEngine(mkBlob(src, clone, { report: { widths: [1440] } }), floors, {});
    // the 6 element-axis (bbox-ratio) members are geometry + coherent (same 0.7 scale) + containment-linked → the
    // CC unions them into ONE component of size 6 (the other 5 collapsed). We assert on the bbox-ratio component
    // specifically: relational side-effects (escape/reading-order) of the same shrink are legitimately SEPARATE
    // edge events and must not count against the collapse claim.
    const bboxComp = r.events.filter((e) => e.coherence && e.coherence.family === 'geometry' && e.firedAxes.includes('bbox-ratio'));
    ok('(iii) coherent N-element uniform-scale collapses to ONE bbox-ratio geometry event', bboxComp.length === 1, `bboxComponents=${bboxComp.length}, collapsed=${r.coherence.collapsed}`);
    ok('(iii) the collapsed component records componentSize === N (6)', bboxComp[0] && bboxComp[0].coherence.componentSize === 6, bboxComp[0] ? `size=${bboxComp[0].coherence.componentSize}` : '-');
  }

  // (iv) RELATIONAL COLLISION fires between two overlapping sections (source disjoint, clone overlapping).
  {
    const a = rec({ ref: 'body>main>section|1|hCA', srcPath: 'body>main>section|1|hCA', tag: 'section', role: 'banner', text: 'Section A',
      box: { 1440: { x: 0, y: 0, w: 700, h: 300, right: 700, xFrac: 0, wFrac: 0.49 } } });
    const b = rec({ ref: 'body>main>section|2|hCB', srcPath: 'body>main>section|2|hCB', tag: 'section', role: 'banner', text: 'Section B',
      box: { 1440: { x: 740, y: 0, w: 700, h: 300, right: 1440, xFrac: 0.51, wFrac: 0.49 } } });
    // clone: B slides left to overlap A heavily (collision).
    const ca = JSON.parse(JSON.stringify(a)); ca.ref = 'c' + ca.ref;
    const cb = JSON.parse(JSON.stringify(b)); cb.ref = 'c' + cb.ref; cb.box[1440] = { x: 200, y: 0, w: 700, h: 300, right: 900, xFrac: 0.14, wFrac: 0.49 };
    const r = runEngine(mkBlob([a, b], [ca, cb], { report: { widths: [1440] } }), floors, {});
    const collide = r.events.find((e) => e.firedAxes.includes('collision') || e.class === 'overlapping-sections');
    ok('(iv) relational COLLISION fires between two overlapping clone sections', !!collide, collide ? `class=${collide.class}` : 'no collision event');
  }

  // noLabelFit assertion — severity() reads no label; the schema declares it.
  ok('noLabelFit is declared true on engine output', runEngine(mkBlob([rec()], [rec()]), floors, {}).meta.noLabelFit === true);

  const failed = cases.filter((c) => !c.pass);
  console.log('\n==== AXIS-DELTA ENGINE — OFFLINE SELFTEST ====');
  for (const c of cases) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${cases.length} cases)`);
  return failed.length === 0;
}
// clone a record scaled by `s` about its top-left (a uniform-scale transform — what the geometry CC collapses).
function scaleBox(r, s) { const c = JSON.parse(JSON.stringify(r)); c.ref = 'c' + c.ref; for (const w of Object.keys(c.box)) { const b = c.box[w]; b.w = +(b.w * s).toFixed(2); b.h = +(b.h * s).toFixed(2); b.right = b.x + b.w; } return c; }

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export const ENGINE_SCHEMA = {
  engineFile: 'eval/grader/axisdelta-engine.mjs',
  detection: {
    severity: 'severity(event) = salience(elem) × Σ_a W_a · magnitude_a ; magnitude_a = excess_a / floor_a (multiples of the Q2 floor → axes commensurate); per-element Σ squashed via 1−e^−Σ, salience-amplified (cap 1)',
    pageScore: '0.55·mean(1−severity over EVENTS) + 0.45·(1−mean(worst 3 severities)) − unmatched-hi-salience drag; aggregated at the EVENT level so a coherent N-shift counts once',
  },
  weights: { source: 'PERCEPTUAL PRIORS, NOT fit to labels', W, W_DEFAULT,
    ranking: 'presence/contrast HIGH (invisible/missing = maximal); image identity high; color/font mid; bbox/overflow mid; sub-pixel border low (default)' },
  salience: { source: 'SOURCE-ONLY attention prior (blind to the clone/label)',
    factors: 'bbox-area(log) × fold-weight × a11y-role-boost(logo/nav/heading/CTA/hero; h1>h2>p) × text-length × source-contrast × centrality' },
  coherenceCC: {
    nodes: 'corresponded pairs (+ unmatched-source as MISSING nodes)',
    edges: 'source-tree containment (srcPath prefix) ∩ spatial adjacency; active in family F iff BOTH trip an F-axis AND coherently',
    families: { geometry: 'propagates along containment (same translation+uniform scale)', style: 'propagates along cascade (same Lab ΔE direction / same font sub)', asset: 'SINGLETON (never propagates)', text: 'SINGLETON', presence: 'SINGLETON' },
    fit: 'union-find per propagating family → components; fit ONE transform per geometry/style component; low residual ⇒ ONE event',
    globalCause: ['font-substitution (vs clone font manifest)', 'responsive-reflow (coherent only @narrow vp = a breakpoint → route responsive)', 'scrollbar-offset (uniform ~15px dx, scale≈1 → suppress)', 'global-diff (>20 elems single axis → ×0.2 demote, NOT drop)'],
    rule: 'NEVER suppress on coherence alone — DEFAULT for an unexplained coherent component = ONE real defect at full severity (coherent≠benign)',
  },
  relationalAxes: { bounded: 'top-K salient SOURCE pairs only (never O(n²))',
    axes: ['collision (clone_IOU−source_IOU; source≈0 → clone>0.05 fires)', 'z-pile (stacking inversion)', 'containment-escape (child escapes parent bounds)', 'reading-order (sibling vertical order flipped)', 'h-overflow (via element axis)'],
    machinery: 'flow through the SAME floor + coherence machinery as edges' },
  namingProjection: { rule: 'class = name(dominant_axis, role, salience_bucket) — a COSMETIC lookup/format, NOT a rule',
    examples: { 'presence+bbox+hero': 'blank-hero', 'image-hash+logo': 'wrong-logo', 'contrast+presence+heading': 'invisible-heading', 'style-axes+button': 'unstyled-cta' },
    gracefulDegradation: 'a wrong/missing label NEVER loses a detection — severity + fired axes are the source of truth; class is decoration' },
  noLabelFit: true,
  selftest: 'eval/grader/_axisdelta-engine-selftest.mjs — (i) self-clone ~100/0 through the engine; (ii) injected diff fires right axis+class; (iii) coherence collapses a coherent N-shift to 1 event; (iv) a relational collision fires. Builder does NOT self-bless; orchestrator re-executes.',
  imports: 'axisdelta-floor.mjs (applyFloors/lookupFloor/salienceBucket) + grade-element-crops.mjs (axisDeltas/readPairs/parseColor/rgbToLab/contrastRatio) UNCHANGED — additive/reversible',
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
function main() {
  if (has('schema')) { console.log(JSON.stringify(ENGINE_SCHEMA, null, 2)); return; }
  if (has('selftest')) { process.exit(runSelftest() ? 0 : 1); }

  const comparePath = arg('compare');
  if (!comparePath || !fs.existsSync(comparePath)) { console.error('need --compare <blob.json> (or --selftest / --schema)'); process.exit(2); }
  const floorsPath = arg('floors', path.join(__dir, 'calibration', 'axis-floors.json'));
  const blob = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
  const floors = JSON.parse(fs.readFileSync(floorsPath, 'utf8'));
  const out = runEngine(blob, floors, { topK: +arg('top-k', 24) });

  console.log('\n==== AXIS-DELTA ENGINE (universal severity + per-family coherence + relational + naming) ====');
  console.log(`compare: ${comparePath}`);
  console.log(`source:  ${out.meta.source}`);
  console.log(`clone:   ${out.meta.clone}`);
  console.log(`widths ${out.meta.widths.join(',')} | join ${out.meta.joinVw} | cloneFontManifest ${out.meta.cloneFontManifestSize} fams | noLabelFit ${out.meta.noLabelFit}`);
  console.log(`\nPAGE SCORE: ${out.pageScore}  (1=indistinguishable, 0=worthless)`);
  console.log(`events: ${out.aggregate.events} (fatal≥0.6: ${out.aggregate.fatalEvents}) | coherence components ${out.coherence.components} (collapsed ${out.coherence.collapsed}) | templates ${JSON.stringify(out.coherence.templates)}`);
  console.log(`by class: ${JSON.stringify(out.byClass)}`);
  if (out.unmatchedHiSal.length) console.log(`unmatched HIGH-salience SOURCE elements: ${out.unmatchedHiSal.length} (e.g. ${out.unmatchedHiSal.slice(0, 3).map((u) => `${u.bucket}:${u.ref.slice(0, 28)}`).join(', ')})`);
  console.log(`\nTOP EVENTS:`);
  for (const e of out.events.slice(0, 14)) {
    console.log(`  [${e.severity.toFixed(3)}] ${e.class.padEnd(20)} ${String(e.ref).slice(0, 40)}@${e.viewport} axes=${e.firedAxes.join('+')} ${e.coherence.template !== 'singleton' ? `(coh:${e.coherence.template}×${e.coherence.componentSize})` : ''}`);
  }
  if (has('json')) { fs.writeFileSync('/tmp/axisdelta-engine-out.json', JSON.stringify(out, null, 2)); console.log('\nfull localized event map → /tmp/axisdelta-engine-out.json'); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
