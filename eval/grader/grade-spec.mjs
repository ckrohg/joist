#!/usr/bin/env node
/**
 * @purpose PER-SECTION FIDELITY GRADER — un-blur the one opaque whole-page composite (supabase good clone = 0.575,
 * area-coverage 0.328) into a per-SECTION coverage breakdown so the refine loop can target the REAL misses. The
 * whole-page grader hides WHICH sections are under-covered; this attributes coverage band-by-band against the
 * SECTION SPEC.
 *
 * It is ADDITIVE (a brand-new file; touches NONE of grade-sections.mjs / perelement-score.mjs / capture-layout.mjs
 * / segment.mjs / build-structured.mjs / section-spec.mjs) and HONEST BY CONSTRUCTION (the --selftest proves the
 * matcher scores ~1.0 on identity and CLEARLY lower on an incomplete clone; if it can't, it fails loudly).
 *
 * METHOD:
 *   1. segment(src) → buildSpec(seg, src) gives the SECTION SPEC: sections[] each with a bbox{y..} + semantic role.
 *   2. A single y-scale  S = clone.pageH / src.pageH  maps every src-y into clone-y (the clone may differ in height).
 *   3. Per spec section band [y0,y1] (src coords):
 *        - srcLeaves = source leaves whose vertical CENTER falls in [y0,y1].
 *        - For each srcLeaf, MATCH = an UNUSED clone leaf whose center is near the SCALED src position
 *          (x within ~8% of vw, y within ~6% of the scaled band height) AND same KIND-CLASS (text/heading→"text",
 *          image/svg/mockup/video→"media", button→"button", list→"list") AND (for text) shares >=1 significant
 *          token OR box-area within 2x. Each clone leaf is consumed by AT MOST ONE src leaf (no double-count).
 *        - section coverage = (matched srcLeaf area) / (all srcLeaf area in band), clamped 0..1; empty band ⇒ 1 w/ flag.
 *        - also report matched/total and textCoverage (fraction of src text chars matched).
 *   4. Output per-section {idx, role, coverage, textCoverage, matched, total} + overall mean + WEAKEST 3 indices.
 *
 * CLI:  node grade-spec.mjs --src <srcCapture> --clone <cloneCapture> [--summary]
 *       node grade-spec.mjs --selftest      (identity≈1.0 AND incomplete < identity-0.25 ⇒ PASS, else FAIL + exit 1)
 */
import fs from 'fs';
import { segment } from './segment.mjs';
import { buildSpec } from './section-spec.mjs';

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const stripEmoji = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '').replace(/\s+/g, ' ').trim();

// ── leaf gathering — IDENTICAL recursion to segment.mjs / section-spec.mjs (a non-container node with a box). ──
function gatherLeaves(root) { const out = []; const g = (n) => { if (!n) return; if (n.kind === 'container') (n.children || []).forEach(g); else if (n.box) out.push(n); }; g(root); return out; }

// ── KIND-CLASS — group kinds so a heading matches a heading-rendered-as-text, image matches a screenshot/svg, etc.
// A src leaf can only match a clone leaf in the SAME class (a heading cannot be "covered" by an image). ──
function kindClass(kind) {
  if (kind === 'heading' || kind === 'text') return 'text';
  if (kind === 'image' || kind === 'svg' || kind === 'mockup' || kind === 'video' || kind === 'tabs') return 'media';
  if (kind === 'button') return 'button';
  if (kind === 'list') return 'list';
  return 'other';
}

// ── TOKENS — significant content words (drop short stopwords) for text token-overlap matching. ──
const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'with', 'are', 'our', 'all', 'can', 'get', 'has', 'how', 'now', 'out', 'use', 'who', 'why', 'a', 'an', 'of', 'to', 'in', 'on', 'is', 'it', 'or', 'as', 'at', 'by', 'we', 'us', 'be', 'do', 'so', 'up', 'no']);
function tokens(t) {
  return stripEmoji(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
}
const boxArea = (b) => Math.max(0, b.w) * Math.max(0, b.h);

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ── BACKGROUND / COLOR-FIDELITY DIMENSION (ADDITIVE) ─────────────────────────────────────────────────────────────
// WHY: the coverage/text dimensions above are COLOR-BLIND — they score WHERE leaves land and WHAT text they carry,
// but NOT what color the page is painted. So a clone that renders a DARK site entirely WHITE scores identically to a
// correct dark clone (validated: vercel went src 7/7-dark → clone 7/7-dark yet anchoredMean stayed flat 0.345). This
// block adds a PER-SECTION background-color match: for each src spec section we read its band bg color (segment's
// bandBg → {kind,value}, already surfaced as section.bg), compare it to the order-matched CLONE section's bg color,
// and aggregate to a page-level colorMatch. It is a SEPARATE reported dimension (the existing coverage/text scoring
// and the v1/anchored selftest assertions on `mean` are untouched); a modest blend is also exposed as `scoreWithColor`.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════

// The effective rendered default paint for a TRANSPARENT/none/null background. A page (or a bg:default section that
// inherits it) with no opaque paint of its own renders on the browser's default light canvas — NOT literal black.
// COLOR-PATH ONLY: used solely by parseRgb/sectionColor below (the colorMatch dimension). Structural/text scoring
// never touches these functions, so this cannot leak into coverage/anchor scoring.
const PAGE_DEFAULT_LIGHT = { r: 255, g: 255, b: 255 };

// Parse an rgb()/rgba()/hex color string → {r,g,b} in 0..255, or null when not a parseable solid color.
// TRANSPARENT FIX: a zero-alpha rgba()/`transparent`/`none`/null value paints NOTHING — it must NOT be read as the
// literal black its first three channels happen to spell (rgba(0,0,0,0) is transparent, not black). We return null
// for it so the page-bg derivation falls through to the REAL sampled paint (`|| bgSampled`), and sectionColor maps a
// still-unresolved transparent bg to PAGE_DEFAULT_LIGHT — the effective rendered default — instead of spurious black.
function parseRgb(s) {
  if (s == null) return null;
  if (typeof s !== 'string') return null;
  const str = s.trim();
  const low = str.toLowerCase();
  if (low === 'transparent' || low === 'none' || low === '') return null;  // no paint → not a solid color
  let m = str.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,]+([\d.]+))?/i);
  if (m) {
    if (m[4] != null && +m[4] === 0) return null;  // zero-alpha rgba() → transparent, not the (0,0,0) it spells
    return { r: +m[1], g: +m[2], b: +m[3] };
  }
  m = str.match(/^#([0-9a-f]{6})$/i);
  if (m) { const h = m[1]; return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }; }
  m = str.match(/^#([0-9a-f]{3})$/i);
  if (m) { const h = m[1]; return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) }; }
  // gradient / image strings: pull the FIRST embedded rgb()/hex (the dominant stop is a reasonable representative)
  m = str.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  m = str.match(/#([0-9a-f]{6})/i);
  if (m) { const h = m[1]; return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }; }
  return null;
}

// Representative solid RGB for a section's bg descriptor {kind,value}. Falls back to the page bg when the section
// records no usable color (default/transparent bands inherit the page paint). When even the page bg is transparent/
// unresolved (parseRgb returned null for a zero-alpha/none page paint), the band still renders on the browser's
// default light canvas — so we return PAGE_DEFAULT_LIGHT rather than null/black. Returns {r,g,b} or null.
function sectionColor(bg, pageRgb) {
  if (bg && bg.value) { const c = parseRgb(bg.value); if (c) return c; }
  return pageRgb || PAGE_DEFAULT_LIGHT;
}

// Perceived luminance (Rec.601-ish), 0..255. Drives the dark/light-agreement term — the load-bearing signal for the
// "white clone of a dark site" failure (a near-black band vs a near-white band must score ~0).
const lum = (c) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;

// colorMatch for ONE pair of section colors → 0..1. Two terms, multiplied:
//   (a) deltaE-lite: a weighted-RGB euclidean distance (the classic "redmean" weighting that approximates perceptual
//       distance far better than flat RGB), normalized by the max possible weighted distance → similarity 1-dist.
//   (b) dark/light agreement: 1 when both colors are on the same side of mid-gray (both dark or both light), tapering
//       toward a floor when they straddle. This is what makes a white-clone-of-dark-site collapse to near-0 even if
//       the raw RGB distance alone (≈0.5 similarity) would otherwise over-credit it.
function colorPairMatch(a, b) {
  if (!a || !b) return null;                 // one side has no measurable color → not scored (excluded from mean)
  const rmean = (a.r + b.r) / 2;
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  // redmean weighted distance: sqrt((2+rmean/256)dr^2 + 4 dg^2 + (2+(255-rmean)/256)db^2)
  const wd = Math.sqrt((2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db);
  const maxWd = Math.sqrt((2 + 255 / 256) * 255 * 255 + 4 * 255 * 255 + (2 + 255 / 256) * 255 * 255); // ≈764.8
  const sim = clamp01(1 - wd / maxWd);
  const la = lum(a), lb = lum(b);
  const darkA = la < 128, darkB = lb < 128;
  // agreement: 1 if same side; else a floor (0.15) scaled by how close the lighter one is to mid — straddling near
  // the boundary is less wrong than black-vs-white. |Δlum|/255 ∈ [0,1]; agreement = 1 - 0.85*(|Δlum|/255) when straddling.
  const agree = (darkA === darkB) ? 1 : clamp01(1 - 0.85 * (Math.abs(la - lb) / 255));
  return clamp01(sim * agree);
}

// Page-level background colorMatch: segment BOTH captures into spec sections, match by ORDER (idx position), and for
// each pair compute colorPairMatch on (src section bg color, clone section bg color). Aggregate area-weighted by the
// SRC band height (taller bands paint more of the page → carry more weight). Sections with no measurable color on
// either side are skipped. Unmatched src sections (clone has fewer) are scored against the clone PAGE bg — a clone
// that simply omitted a section still gets credited/penalized for painting the right base color there.
function colorMatchPage(src, clone) {
  const srcPageRgb = parseRgb(src.pageBg) || parseRgb(src.root && src.root.bgSampled);
  const clonePageRgb = parseRgb(clone.pageBg) || parseRgb(clone.root && clone.root.bgSampled);
  const srcSpec = buildSpec(segment(src), src);
  const cloneSpec = buildSpec(segment(clone), clone);
  const srcSecs = srcSpec.sections || [];
  const cloneSecs = cloneSpec.sections || [];

  const per = [];
  let wSum = 0, wMatch = 0;
  for (let i = 0; i < srcSecs.length; i++) {
    const ss = srcSecs[i];
    const cs = cloneSecs[i] || null;                  // order match; falls through to clone-page bg when absent
    const sc = sectionColor(ss.bg, srcPageRgb);
    const cc = cs ? sectionColor(cs.bg, clonePageRgb) : clonePageRgb;
    const m = colorPairMatch(sc, cc);
    const h = (ss.bbox && ss.bbox.h) ? Math.max(1, ss.bbox.h) : 1;
    if (m != null) { wSum += h; wMatch += h * m; }
    per.push({
      idx: ss.idx, role: ss.role,
      srcColor: sc ? `rgb(${Math.round(sc.r)}, ${Math.round(sc.g)}, ${Math.round(sc.b)})` : null,
      cloneColor: cc ? `rgb(${Math.round(cc.r)}, ${Math.round(cc.g)}, ${Math.round(cc.b)})` : null,
      colorMatch: m != null ? Math.round(m * 1000) / 1000 : null,
      cloneMissing: cs ? undefined : true,
    });
  }
  // count-weighted fallback if no measurable heights; page-level scalar is the area-weighted mean of scored sections.
  const colorMatch = wSum > 0 ? clamp01(wMatch / wSum) : 1;
  return {
    colorMatch: Math.round(colorMatch * 1000) / 1000,
    srcPageColor: srcPageRgb ? `rgb(${srcPageRgb.r}, ${srcPageRgb.g}, ${srcPageRgb.b})` : null,
    clonePageColor: clonePageRgb ? `rgb(${clonePageRgb.r}, ${clonePageRgb.g}, ${clonePageRgb.b})` : null,
    sections: per,
  };
}

// ── MATCH PREDICATE — does clone leaf C cover src leaf SL (after scaling SL into clone space by S in y)? ──
// x tolerance: ~8% of vw. y tolerance: ~6% of the SCALED band height (min floor so tiny bands still allow drift).
function leafMatches(SL, C, S, vw, bandHscaled) {
  if (kindClass(SL.kind) !== kindClass(C.kind)) return false;
  const slx = SL.box.x + SL.box.w / 2;            // src x center (x is NOT scaled — same viewport width)
  const sly = (SL.box.y + SL.box.h / 2) * S;      // src y center scaled into clone space
  const cx = C.box.x + C.box.w / 2, cy = C.box.y + C.box.h / 2;
  const xtol = vw * 0.08;
  const ytol = Math.max(40, bandHscaled * 0.06);
  if (Math.abs(cx - slx) > xtol || Math.abs(cy - sly) > ytol) return false;
  // content gate
  const cls = kindClass(SL.kind);
  if (cls === 'text' || cls === 'button') {
    const st = tokens(SL.text), ct = tokens(C.text);
    if (st.length && ct.length) {
      const cset = new Set(ct);
      if (st.some((w) => cset.has(w))) return true;          // >=1 significant shared token
    }
    // fallback: box-area within 2x (covers empty/icon-only or differently-worded but structurally-equivalent text)
    const a = boxArea(SL.box), b = boxArea(C.box);
    if (a > 0 && b > 0 && Math.max(a, b) <= Math.min(a, b) * 2) return true;
    if (a === 0 || b === 0) return true;                      // zero-area text leaf: position+class is enough
    return false;
  }
  // media / list / other: position + same kind-class is the signal; box-area within 2x as a sanity gate.
  const a = boxArea(SL.box), b = boxArea(C.box);
  if (a > 0 && b > 0 && Math.max(a, b) > Math.min(a, b) * 4) return false; // wildly different size ⇒ not a match
  return true;
}

// ── GRADE — attribute coverage per spec section. ──
function gradeSpec(src, clone) {
  const vw = src.vw || 1440;
  const srcLeaves = gatherLeaves(src.root);
  const cloneLeaves = gatherLeaves(clone.root);
  const srcPageH = src.pageH || 1, clonePageH = clone.pageH || srcPageH;
  const S = clonePageH / srcPageH;

  const seg = segment(src);
  const spec = buildSpec(seg, src);
  const sections = spec.sections || [];

  // available clone leaves — each consumable by AT MOST ONE src leaf (no double-count inflation).
  const used = new Array(cloneLeaves.length).fill(false);

  const inBand = (leaf, y0, y1) => { const cy = leaf.box.y + leaf.box.h / 2; return cy >= y0 && cy < y1; };

  const perSection = [];
  for (const sec of sections) {
    const y0 = sec.bbox ? sec.bbox.y : sec.y0;
    const y1 = sec.bbox ? sec.bbox.y + sec.bbox.h : sec.y1;
    const bandHscaled = Math.max(1, (y1 - y0) * S);
    const band = srcLeaves.filter((l) => inBand(l, y0, y1));

    let totalArea = 0, matchedArea = 0, matched = 0;
    let totalChars = 0, matchedChars = 0;

    for (const SL of band) {
      const a = boxArea(SL.box);
      totalArea += a;
      const chars = (kindClass(SL.kind) === 'text' || kindClass(SL.kind) === 'button') ? stripEmoji(SL.text).length : 0;
      totalChars += chars;
      // find the BEST unused clone leaf that matches (closest center wins, so a near-duplicate doesn't steal it)
      let bestI = -1, bestD = Infinity;
      for (let i = 0; i < cloneLeaves.length; i++) {
        if (used[i]) continue;
        const C = cloneLeaves[i];
        if (!leafMatches(SL, C, S, vw, bandHscaled)) continue;
        const slx = SL.box.x + SL.box.w / 2, sly = (SL.box.y + SL.box.h / 2) * S;
        const d = Math.abs((C.box.x + C.box.w / 2) - slx) + Math.abs((C.box.y + C.box.h / 2) - sly);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (bestI >= 0) { used[bestI] = true; matchedArea += a; matched++; matchedChars += chars; }
    }

    const empty = band.length === 0;
    const coverage = empty ? 1 : clamp01(totalArea > 0 ? matchedArea / totalArea : (matched / Math.max(1, band.length)));
    const textCoverage = totalChars > 0 ? clamp01(matchedChars / totalChars) : (empty ? 1 : 1);
    perSection.push({
      idx: sec.idx, role: sec.role,
      coverage: Math.round(coverage * 1000) / 1000,
      textCoverage: Math.round(textCoverage * 1000) / 1000,
      matched, total: band.length,
      emptyBand: empty || undefined,
    });
  }

  const graded = perSection.filter((p) => !p.emptyBand);
  const mean = graded.length ? graded.reduce((a, p) => a + p.coverage, 0) / graded.length : 1;
  const meanAll = perSection.length ? perSection.reduce((a, p) => a + p.coverage, 0) / perSection.length : 1;
  // WEAKEST 3 graded (non-empty) sections by coverage
  const weakest = [...graded].sort((a, b) => a.coverage - b.coverage).slice(0, 3).map((p) => p.idx);

  // ── BACKGROUND/COLOR-FIDELITY (additive; does NOT alter `mean`/coverage) ──
  const color = colorMatchPage(src, clone);
  // modest 18% blend folded into a SEPARATE reported headline (`mean` stays the pure structural score the selftest
  // asserts on): scoreWithColor = 0.82*mean + 0.18*colorMatch. Reported, not substituted.
  const scoreWithColor = Math.round((0.82 * mean + 0.18 * color.colorMatch) * 1000) / 1000;

  return {
    source: src.url || null, clone: clone.url || null,
    yScale: Math.round(S * 1000) / 1000, srcPageH, clonePageH,
    srcLeaves: srcLeaves.length, cloneLeaves: cloneLeaves.length,
    sectionCount: sections.length,
    mean: Math.round(mean * 1000) / 1000,         // mean over non-empty bands (the honest score)
    meanAll: Math.round(meanAll * 1000) / 1000,   // mean over all bands (empty=1)
    colorMatch: color.colorMatch,                  // page-level background-color fidelity (0..1)
    scoreWithColor,                                // reported blend (0.82*mean + 0.18*colorMatch); mean untouched
    weakest, perSection, color,
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ── ANCHORED MODE (--anchored) — ADDITIVE. Per-band y-ANCHOR instead of one global y-scale. ──────────────────────
// WHY: v1 maps src-y → clone-y with a SINGLE global S = clonePageH/srcPageH. When a clone REFLOWS non-uniformly
// (some sections stretch more than others) that single S mis-maps bands, so present-but-reflowed content scores ~0.
// The anchored path derives a LOCAL (scale, offset) for each band from 1-2 distinctive text anchors that token-match
// into the clone, then predicts each src leaf's clone-Y from THAT band's anchor — crediting reflow WITHIN a band.
// Anti-gaming: anchors require a STRONG token match (not the area fallback), and a band whose anchors don't match
// scores coverage 0 (missing content is never credited). This is a SEPARATE function; gradeSpec() is untouched.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════

// STRONG text match — for an ANCHOR we demand a real shared significant token (no area fallback). This is the gate
// that stops an incomplete clone from "anchoring" a band on nothing. Returns the count of shared significant tokens.
function sharedTokenCount(a, b) {
  const at = tokens(a), bt = tokens(b);
  if (!at.length || !bt.length) return 0;
  const bset = new Set(bt);
  let n = 0; const seen = new Set();
  for (const w of at) { if (bset.has(w) && !seen.has(w)) { n++; seen.add(w); } }
  return n;
}

// Does clone leaf C cover src leaf SL given a PREDICTED clone-Y for SL (from the band's local anchor transform)?
// Same kind-class gate + same content gate as v1, but Y is the anchored prediction rather than SL.y * globalS.
function leafMatchesAnchored(SL, C, predY, vw, bandHscaled) {
  if (kindClass(SL.kind) !== kindClass(C.kind)) return false;
  const slx = SL.box.x + SL.box.w / 2;
  const cx = C.box.x + C.box.w / 2, cy = C.box.y + C.box.h / 2;
  const xtol = vw * 0.08;
  const ytol = Math.max(40, bandHscaled * 0.06);
  if (Math.abs(cx - slx) > xtol || Math.abs(cy - predY) > ytol) return false;
  const cls = kindClass(SL.kind);
  if (cls === 'text' || cls === 'button') {
    const st = tokens(SL.text), ct = tokens(C.text);
    if (st.length && ct.length) {
      const cset = new Set(ct);
      if (st.some((w) => cset.has(w))) return true;          // >=1 significant shared token
    }
    const a = boxArea(SL.box), b = boxArea(C.box);
    if (a > 0 && b > 0 && Math.max(a, b) <= Math.min(a, b) * 2) return true;
    if (a === 0 || b === 0) return true;
    return false;
  }
  const a = boxArea(SL.box), b = boxArea(C.box);
  if (a > 0 && b > 0 && Math.max(a, b) > Math.min(a, b) * 4) return false;
  return true;
}

// ── COALESCING SUBSUMPTION GATE (one-to-many) ──────────────────────────────────────────────────────────────────
// A clone TEXT leaf that build-structured MERGED several source lines into ONE widget can legitimately satisfy
// MULTIPLE src TEXT leaves — but ONLY when it GENUINELY subsumes them. Two gates, BOTH required (AND), so a clone
// that is merely SIZE-similar or that happens to share a ubiquitous token (e.g. "tailwind") on a far-away line
// CANNOT claim content it does not actually contain:
//   (1) CONTAINMENT — the clone leaf's normalized text must CONTAIN essentially all of the src leaf's significant
//       tokens (the merged widget literally includes that line's words). We require the clone token-set to be a
//       near-SUPERSET of the src tokens (>=85% of src significant tokens present, min 1) — a strict superset gate,
//       not the loose ">=1 shared token" used for ordinary matching. This is what stops the incomplete clone from
//       claiming absent lines: a clone leaf that does not contain those words fails here.
//   (2) SPATIAL COVERAGE — the clone leaf must spatially COVER the src leaf's PREDICTED (anchored) position. When a
//       clone COALESCES a tall multi-line / multi-leaf src region into one COMPACT widget, the subsumed lines'
//       predicted positions spread BEYOND the compressed widget's box — so a strictly-inside test is wrong. Instead
//       we require the predicted center to be WITHIN the clone box EXPANDED by a band-relative margin: x within a
//       generous column tolerance, y within the clone box grown by `yTol` (the band's scaled height drives yTol, so
//       a band that collapsed a 600px region into a 100px widget still credits its absorbed lines, while a different
//       SECTION's leaf — predicted far outside this band — is rejected). The token near-superset gate (1) is the
//       PRIMARY anti-gaming control (empirically the incomplete clone has ZERO superset candidates even spatial-off);
//       this gate's job is to reject same-clone ubiquitous-token false matches (a short eyebrow whose 1-2 tokens
//       happen to appear in a far paragraph) by keeping the match within the src leaf's predicted band neighborhood.
// Media/list/other NEVER subsume (kept strictly 1:1): a clone image maps to one src image.
function tokenSuperset(srcText, cloneText) {
  const st = tokens(srcText), ct = tokens(cloneText);
  if (!st.length || !ct.length) return false;            // need real significant tokens on both sides
  const cset = new Set(ct);
  let present = 0; const seen = new Set();
  for (const w of st) { if (!seen.has(w)) { seen.add(w); if (cset.has(w)) present++; } }
  const distinct = seen.size;
  return distinct >= 1 && present / distinct >= 0.85;    // clone is a near-superset of the src line's tokens
}
// predicted src box in clone space: x/w unchanged (no horizontal scale), y-center = predY, height scaled by |scale|.
function predictedBox(SL, predY, scale) {
  const h = Math.max(1, SL.box.h * Math.abs(scale));
  return { x: SL.box.x, y: predY - h / 2, w: SL.box.w, h };
}
function rectOverlapArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}
// TEXT-BEARING — a kind that carries real rendered text. build-structured frequently COALESCES merged multi-line
// text into a `code` widget (a stacked block of labels/snippets), not just `text`/`heading`. So a src text/heading
// line can be legitimately subsumed by a clone text/heading/code leaf — but NEVER by media (image/svg/mockup/video).
// The containment + spatial gates below carry the anti-gaming weight; the kind gate here only excludes non-text.
function textBearing(kind) { return kind === 'text' || kind === 'heading' || kind === 'code'; }

// Does already-claimed clone TEXT-bearing leaf C subsume unmatched src TEXT leaf SL at predicted (predY, scale)?
// `yTol` is a band-relative vertical slack (a coalesced widget collapses a tall src region, so subsumed lines'
// predicted-Y spread beyond the compressed box) — the caller derives it from the band's scaled height.
function leafSubsumesAnchored(SL, C, predY, scale, vw, yTol) {
  if (kindClass(SL.kind) !== 'text' || !textBearing(C.kind)) return false;          // src text → clone text-bearing
  if (!tokenSuperset(SL.text, C.text)) return false;                                // (1) containment gate
  const pb = predictedBox(SL, predY, scale);                                        // (2) spatial coverage gate
  const pcx = pb.x + pb.w / 2, pcy = pb.y + pb.h / 2;
  // predicted center within the clone box EXPANDED by a column-x tolerance and a band-relative y tolerance.
  const xSlack = vw * 0.18;                                // generous column tolerance (merged blocks shift x)
  const yEx = Math.max(60, yTol);                          // band-relative y slack (coalescing compresses y)
  const insideX = pcx >= C.box.x - xSlack && pcx <= C.box.x + C.box.w + xSlack;
  const insideY = pcy >= C.box.y - yEx && pcy <= C.box.y + C.box.h + yEx;
  return insideX && insideY;
}

// Pick anchor candidates in a band: the most DISTINCTIVE TEXT-BEARING leaves (longest token-bearing text/heading/
// code), ordered by distinctiveness. We try a TOP candidate and a BOTTOM candidate so we can derive a local scale.
// `code` is included because build-structured frequently COALESCES merged text into `code` widgets — a band whose
// only token-bearing leaf is a `code` widget (e.g. a hero h1 captured as code) must still be able to anchor.
function anchorCandidates(band) {
  const textLeaves = band.filter((l) => textBearing(l.kind) && tokens(l.text).length > 0);
  // distinctiveness ≈ number of significant tokens (longer/heading-y text), tie-break by char length
  const score = (l) => tokens(l.text).length * 1000 + stripEmoji(l.text).length;
  return textLeaves.sort((a, b) => score(b) - score(a));
}

// For ONE src anchor leaf, find the best clone leaf in the SAME class with a STRONG token match, nearest in x.
// Anchors stay within the horizontal column (xtol) so we don't anchor a left-rail heading onto a right-rail one.
// An optional [yMin,yMax] window enforces MONOTONICITY: a band's bottom anchor must map BELOW its top anchor and
// within a forward window — reflow stretches/shifts content but PRESERVES READING ORDER. This stops a ubiquitous
// brand token ("supabase") from anchoring the band's bottom onto a nav/footer leaf far out of order.
// Returns {cloneLeaf, idx} or null.
function findAnchorMatch(SL, cloneLeaves, used, vw, yMin = -Infinity, yMax = Infinity) {
  const slx = SL.box.x + SL.box.w / 2;
  const xtol = vw * 0.18;                      // anchors get a wider x window than per-leaf matches (band may shift)
  let best = null, bestScore = 0, bestDx = Infinity;
  for (let i = 0; i < cloneLeaves.length; i++) {
    if (used[i]) continue;
    const C = cloneLeaves[i];
    if (!textBearing(C.kind)) continue;         // anchor on any token-bearing clone leaf (incl. coalesced `code`)
    const cy = C.box.y + C.box.h / 2;
    if (cy < yMin || cy > yMax) continue;       // monotonicity / forward-window gate
    const sc = sharedTokenCount(SL.text, C.text);
    if (sc < 1) continue;                       // STRONG gate: a real shared significant token is required
    const dx = Math.abs((C.box.x + C.box.w / 2) - slx);
    if (dx > xtol) continue;
    // prefer more shared tokens, then nearer x
    if (sc > bestScore || (sc === bestScore && dx < bestDx)) { best = { cloneLeaf: C, idx: i }; bestScore = sc; bestDx = dx; }
  }
  return best;
}

function gradeSpecAnchored(src, clone) {
  const vw = src.vw || 1440;
  const srcLeaves = gatherLeaves(src.root);
  const cloneLeaves = gatherLeaves(clone.root);
  const srcPageH = src.pageH || 1, clonePageH = clone.pageH || srcPageH;
  const globalS = clonePageH / srcPageH;

  const seg = segment(src);
  const spec = buildSpec(seg, src);
  const sections = spec.sections || [];

  const used = new Array(cloneLeaves.length).fill(false);
  const inBand = (leaf, y0, y1) => { const cy = leaf.box.y + leaf.box.h / 2; return cy >= y0 && cy < y1; };

  const perSection = [];
  for (const sec of sections) {
    const y0 = sec.bbox ? sec.bbox.y : sec.y0;
    const y1 = sec.bbox ? sec.bbox.y + sec.bbox.h : sec.y1;
    const srcBandH = Math.max(1, y1 - y0);
    const band = srcLeaves.filter((l) => inBand(l, y0, y1));

    if (band.length === 0) {
      perSection.push({ idx: sec.idx, role: sec.role, coverage: 1, textCoverage: 1, matched: 0, total: 0, emptyBand: true, heightRatio: null, anchors: 0 });
      continue;
    }

    // ── 1. find up to 2 anchors: most-distinctive text near the band TOP and near the band BOTTOM ──
    // Anchor pair must be VERTICALLY SEPARATED enough to give a meaningful localScale (too-close anchors amplify
    // any clone-side jitter into an absurd scale, e.g. 50px apart in src → 3700px in clone = localScale 74). Require
    // ≥ max(80px, 15% of band height) of src separation; otherwise fall back to a single anchor + global S.
    const cands = anchorCandidates(band);
    const centerY = (l) => l.box.y + l.box.h / 2;
    const bandMidY = (y0 + y1) / 2;
    const minSep = Math.max(80, srcBandH * 0.15);

    // GLOBAL-CONSISTENCY window: an anchor's clone-Y must be within a generous band of where the GLOBAL scale puts
    // it (srcY*globalS). Generous enough for real reflow (cumulative drift across a 1.5-2× page stretch) but tight
    // enough to reject hero↔footer mis-anchors via a ubiquitous brand token (e.g. the final CTA's "Build in a
    // weekend…" matching the HERO's "Build in a weekend"). Window = ±max(35% of clonePageH, 4× scaled band height).
    const globalWin = Math.max(clonePageH * 0.35, srcBandH * Math.max(globalS, 1) * 4);
    const gWin = (l) => { const g = centerY(l) * globalS; return [g - globalWin, g + globalWin]; };

    // resolve the most-distinctive TOP-half anchor that token-matches
    let aTop = null, aBot = null;            // {SL, cloneLeaf, idx}
    const topCands = cands.filter((l) => centerY(l) <= bandMidY);
    const botCands = cands.filter((l) => centerY(l) > bandMidY);
    for (const cand of (topCands.length ? topCands : cands)) {
      const [lo, hi] = gWin(cand);
      const m = findAnchorMatch(cand, cloneLeaves, used, vw, lo, hi);
      if (m) { aTop = { SL: cand, ...m }; break; }
    }
    if (aTop) used[aTop.idx] = true;
    // resolve a BOTTOM anchor that is SEPARATED from aTop by >= minSep (so the pair gives a real span) AND maps
    // MONOTONICALLY below aTop's clone-Y within a forward window (band may over-stretch up to ~4× but must not jump
    // to a far footer leaf via a ubiquitous brand token). When there's no top anchor, no Y constraint applies.
    let yMin = -Infinity, yMax = Infinity;
    if (aTop) {
      const topCloneY = centerY(aTop.cloneLeaf);
      yMin = topCloneY + 4;                                       // strictly below the top anchor
      yMax = topCloneY + Math.max(srcBandH, 200) * Math.max(globalS, 1) * 4;
    }
    for (const cand of (botCands.length ? botCands : cands)) {
      if (aTop && (cand === aTop.SL || Math.abs(centerY(cand) - centerY(aTop.SL)) < minSep)) continue;
      const [glo, ghi] = gWin(cand);                              // intersect monotonicity window with global window
      const m = findAnchorMatch(cand, cloneLeaves, used, vw, Math.max(yMin, glo), Math.min(yMax, ghi));
      if (m && (!aTop || m.idx !== aTop.idx)) { aBot = { SL: cand, ...m }; break; }
    }
    if (aBot) used[aBot.idx] = true;

    const anchorsFound = (aTop ? 1 : 0) + (aBot ? 1 : 0);

    // ── 2. derive the band's LOCAL transform: cloneY = anchorCloneY + (srcY - anchorSrcY) * localScale ──
    let anchorSrcY, anchorCloneY, localScale, srcAnchorSpan = null, cloneAnchorSpan = null;
    if (aTop && aBot) {
      const tSrcY = centerY(aTop.SL), bSrcY = centerY(aBot.SL);
      const tCloneY = centerY(aTop.cloneLeaf), bCloneY = centerY(aBot.cloneLeaf);
      const dSrc = bSrcY - tSrcY;
      anchorSrcY = tSrcY; anchorCloneY = tCloneY;
      const rawScale = Math.abs(dSrc) >= minSep ? (bCloneY - tCloneY) / dSrc : globalS;
      // SANITY-CLAMP the pair-derived scale to a sane multiple of the global scale; a wildly off scale means the
      // bottom anchor token-matched a far-away clone leaf (noise) — clamp rather than corrupt every Y prediction.
      localScale = (rawScale > 0 && isFinite(rawScale)) ? Math.max(globalS * 0.25, Math.min(globalS * 4, rawScale)) : globalS;
      srcAnchorSpan = Math.abs(dSrc);                                           // src distance between the 2 anchors
      cloneAnchorSpan = Math.abs(bCloneY - tCloneY);                            // clone distance between the 2 anchors
    } else if (aTop || aBot) {
      const a = aTop || aBot;
      anchorSrcY = a.SL.box.y + a.SL.box.h / 2;
      anchorCloneY = a.cloneLeaf.box.y + a.cloneLeaf.box.h / 2;
      localScale = globalS;                                                     // single anchor: fall back to global S
    } else {
      // ── NO anchor matched ⇒ band is ABSENT. coverage 0 (never credit missing content). ──
      perSection.push({ idx: sec.idx, role: sec.role, coverage: 0, textCoverage: 0, matched: 0, total: band.length, emptyBand: false, heightRatio: null, anchors: 0 });
      continue;
    }

    const bandHscaled = Math.max(1, srcBandH * Math.abs(localScale));

    // ── 3. for each src leaf in the band, predict its clone-Y and match an UNUSED clone leaf there ──
    const anchorSLs = new Set([aTop && aTop.SL, aBot && aBot.SL].filter(Boolean));
    let totalArea = 0, matchedArea = 0, matched = 0, totalChars = 0, matchedChars = 0;
    // PASS 1 — strict 1:1: each src leaf claims its OWN nearest UNUSED clone leaf (no double-count). This is the
    // ONLY pass that runs for media/list and the only pass needed when there is no coalescing — so IDENTITY (a
    // perfectly 1:1 clone) is matched here entirely and the one-to-many PASS 2 never fires (nothing left unmatched).
    const unmatchedText = [];   // {SL, a, chars, predY, scale} — text src leaves still unmatched after pass 1
    for (const SL of band) {
      const a = boxArea(SL.box);
      totalArea += a;
      const chars = (kindClass(SL.kind) === 'text' || kindClass(SL.kind) === 'button') ? stripEmoji(SL.text).length : 0;
      totalChars += chars;
      if (anchorSLs.has(SL)) continue;      // anchor src leaves are credited explicitly below (avoid double-count)
      const slSrcY = SL.box.y + SL.box.h / 2;
      const predY = anchorCloneY + (slSrcY - anchorSrcY) * localScale;
      const slx = SL.box.x + SL.box.w / 2;
      let bestI = -1, bestD = Infinity;
      for (let i = 0; i < cloneLeaves.length; i++) {
        if (used[i]) continue;
        const C = cloneLeaves[i];
        if (!leafMatchesAnchored(SL, C, predY, vw, bandHscaled)) continue;
        const d = Math.abs((C.box.x + C.box.w / 2) - slx) + Math.abs((C.box.y + C.box.h / 2) - predY);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (bestI >= 0) { used[bestI] = true; matchedArea += a; matched++; matchedChars += chars; }
      else if (kindClass(SL.kind) === 'text') unmatchedText.push({ SL, a, chars, predY, scale: localScale });
    }
    // PASS 2 — COALESCING one-to-many (text only): a src TEXT leaf that found no free clone leaf may still be
    // SUBSUMED by a clone TEXT leaf that build-structured MERGED several lines into — credited only when that clone
    // leaf both CONTAINS the src line's tokens (near-superset) AND spatially COVERS the src leaf's predicted box.
    // Unlike pass 1 this does NOT consume the clone leaf (a merged widget can satisfy MANY src lines), and it can
    // claim a clone leaf that pass 1 / the anchor resolution already used. A clone leaf that does not contain the
    // tokens (e.g. a clone missing that content) can never subsume it — preserving the anti-gaming guarantee.
    // The band-relative y tolerance (yTol) lets a COMPRESSED merged widget absorb lines whose predicted-Y spread
    // beyond its short box, while the token near-superset gate still blocks content the clone does not contain.
    const subYTol = Math.max(120, bandHscaled * 0.5);
    for (const u of unmatchedText) {
      let hit = false;
      for (let i = 0; i < cloneLeaves.length && !hit; i++) {
        const C = cloneLeaves[i];
        if (!textBearing(C.kind)) continue;
        if (leafSubsumesAnchored(u.SL, C, u.predY, u.scale, vw, subYTol)) hit = true;
      }
      // also allow subsumption by the band's anchor clone leaves (they are present, merged content too)
      if (!hit) for (const A of [aTop, aBot]) {
        if (A && leafSubsumesAnchored(u.SL, A.cloneLeaf, u.predY, u.scale, vw, subYTol)) { hit = true; break; }
      }
      if (hit) { matchedArea += u.a; matched++; matchedChars += u.chars; }
    }
    // anchors token-matched ⇒ count them as matched src leaves too (they ARE present content).
    // (their area/chars were included in the band totals above; mark them matched so coverage reflects reality)
    for (const A of [aTop, aBot]) {
      if (!A) continue;
      // anchor src leaf is in `band`; was it already matched above via the predict loop? avoid double counting:
      // we resolved anchors by consuming their clone leaf BEFORE the predict loop, so the anchor src leaf could not
      // re-match. Credit it explicitly here.
      const a = boxArea(A.SL.box);
      const chars = (kindClass(A.SL.kind) === 'text') ? stripEmoji(A.SL.text).length : 0;
      matchedArea += a; matched++; matchedChars += chars;
    }

    const coverage = clamp01(totalArea > 0 ? matchedArea / totalArea : (matched / Math.max(1, band.length)));
    const textCoverage = totalChars > 0 ? clamp01(matchedChars / totalChars) : 1;
    // band heightRatio = (clone span between the 2 anchors) / (src span between the same 2 anchors). >1 ⇒ band
    // stretched in the clone; ~1 ⇒ band height faithful; null when only one anchor (no measurable span). This is
    // the per-band analog of the global pageH ratio and localizes WHERE the residual page-height comes from.
    const heightRatio = (srcAnchorSpan != null && srcAnchorSpan > 1) ? Math.round((cloneAnchorSpan / srcAnchorSpan) * 1000) / 1000 : null;
    perSection.push({
      idx: sec.idx, role: sec.role,
      coverage: Math.round(coverage * 1000) / 1000,
      textCoverage: Math.round(textCoverage * 1000) / 1000,
      matched, total: band.length,
      anchors: anchorsFound,
      localScale: Math.round(Math.abs(localScale) * 1000) / 1000,
      heightRatio,
    });
  }

  const graded = perSection.filter((p) => !p.emptyBand);
  const mean = graded.length ? graded.reduce((a, p) => a + p.coverage, 0) / graded.length : 1;
  const meanAll = perSection.length ? perSection.reduce((a, p) => a + p.coverage, 0) / perSection.length : 1;
  const weakest = [...graded].sort((a, b) => a.coverage - b.coverage).slice(0, 3).map((p) => p.idx);
  const withHR = perSection.filter((p) => p.heightRatio != null);
  const worstStretch = [...withHR].sort((a, b) => Math.abs(b.heightRatio - 1) - Math.abs(a.heightRatio - 1)).slice(0, 3).map((p) => p.idx);

  // ── BACKGROUND/COLOR-FIDELITY (additive; does NOT alter anchored `mean`/coverage) ──
  const color = colorMatchPage(src, clone);
  const scoreWithColor = Math.round((0.82 * mean + 0.18 * color.colorMatch) * 1000) / 1000;

  return {
    mode: 'anchored',
    source: src.url || null, clone: clone.url || null,
    globalYScale: Math.round(globalS * 1000) / 1000, srcPageH, clonePageH,
    srcLeaves: srcLeaves.length, cloneLeaves: cloneLeaves.length,
    sectionCount: sections.length,
    mean: Math.round(mean * 1000) / 1000,
    meanAll: Math.round(meanAll * 1000) / 1000,
    colorMatch: color.colorMatch,                  // page-level background-color fidelity (0..1)
    scoreWithColor,                                // reported blend (0.82*mean + 0.18*colorMatch); mean untouched
    weakest, worstStretch, perSection, color,
  };
}

// ── SELFTEST — honesty by construction. ──
function runSelftest() {
  const SRC = '/tmp/pe-layout-gsec-supabasecom-mq2hv9sv-src.json';
  const CLONE = '/tmp/pe-layout-gsec-supabasecom-mq2hv9sv-clone.json';
  for (const p of [SRC, CLONE]) if (!fs.existsSync(p)) { console.log(`SELFTEST FAIL: missing ${p}`); process.exit(1); }
  let src, clone;
  try { src = JSON.parse(fs.readFileSync(SRC, 'utf8')); clone = JSON.parse(fs.readFileSync(CLONE, 'utf8')); }
  catch (e) { console.log('SELFTEST FAIL: ' + String((e && e.message) || e)); process.exit(1); }

  // (1) src-vs-src — identity. Every non-empty section coverage must be ~1.0 (mean >= 0.95).
  let idn;
  try { idn = gradeSpec(src, src); }
  catch (e) { console.log('SELFTEST FAIL (identity threw): ' + String((e && e.message) || e)); process.exit(1); }
  const srcVsSrc = idn.mean;
  const lowSecs = idn.perSection.filter((p) => !p.emptyBand && p.coverage < 0.95);

  // (2) incomplete — a clone missing ~77% cannot score high. mean must be CLEARLY lower (< srcVsSrc - 0.25).
  let inc;
  try { inc = gradeSpec(src, clone); }
  catch (e) { console.log('SELFTEST FAIL (incomplete threw): ' + String((e && e.message) || e)); process.exit(1); }
  const incomplete = inc.mean;

  const idnOk = srcVsSrc >= 0.95;
  const gapOk = incomplete < srcVsSrc - 0.25;
  const pass = idnOk && gapOk;

  console.log(`SELFTEST  srcVsSrc(identity)=${srcVsSrc.toFixed(3)}  incomplete=${incomplete.toFixed(3)}  gap=${(srcVsSrc - incomplete).toFixed(3)}`);
  if (!idnOk) console.log(`  identity below 0.95 — low sections: ${lowSecs.map((p) => `#${p.idx}=${p.coverage}`).join(', ')}`);
  if (!gapOk) console.log(`  anti-gaming gap < 0.25 — matcher rewards a clone missing ~77%`);
  console.log(`  identity per-section: ${idn.perSection.map((p) => `#${p.idx}:${p.emptyBand ? 'E' : p.coverage}`).join(' ')}`);
  console.log(`  incomplete per-section: ${inc.perSection.map((p) => `#${p.idx}:${p.emptyBand ? 'E' : p.coverage}`).join(' ')}`);
  console.log(pass ? 'SELFTEST PASS (v1)' : 'SELFTEST FAIL (v1)');

  // ── (3) ANCHORED assertion set — same honesty-by-construction contract on the anchored path. ──
  // Uses the supabase source (glob-supa.json, 206 leaves) + the 57-leaf incomplete clone as the anti-gaming control.
  const A_SRC = '/tmp/glob-supa.json';
  const A_INC = '/tmp/pe-layout-gsec-supabasecom-mq2hv9sv-clone.json';
  let aPass = true;
  if (!fs.existsSync(A_SRC) || !fs.existsSync(A_INC)) {
    console.log(`SELFTEST WARN: anchored fixtures missing (${A_SRC} / ${A_INC}) — anchored assertions skipped`);
  } else {
    let asrc, ainc;
    try { asrc = JSON.parse(fs.readFileSync(A_SRC, 'utf8')); ainc = JSON.parse(fs.readFileSync(A_INC, 'utf8')); }
    catch (e) { console.log('SELFTEST FAIL (anchored read): ' + String((e && e.message) || e)); process.exit(1); }
    let aIdn, aInc;
    try { aIdn = gradeSpecAnchored(asrc, asrc); }
    catch (e) { console.log('SELFTEST FAIL (anchored identity threw): ' + String((e && e.message) || e)); process.exit(1); }
    try { aInc = gradeSpecAnchored(asrc, ainc); }
    catch (e) { console.log('SELFTEST FAIL (anchored incomplete threw): ' + String((e && e.message) || e)); process.exit(1); }
    const identityAnchored = aIdn.mean, incompleteAnchored = aInc.mean;
    const aIdnOk = identityAnchored >= 0.95;
    const aGapOk = incompleteAnchored < identityAnchored - 0.25;
    aPass = aIdnOk && aGapOk;
    const aLow = aIdn.perSection.filter((p) => !p.emptyBand && p.coverage < 0.95);
    console.log(`SELFTEST(anchored)  identity=${identityAnchored.toFixed(3)}  incomplete=${incompleteAnchored.toFixed(3)}  gap=${(identityAnchored - incompleteAnchored).toFixed(3)}`);
    if (!aIdnOk) console.log(`  anchored identity below 0.95 — low sections: ${aLow.map((p) => `#${p.idx}=${p.coverage}`).join(', ')}`);
    if (!aGapOk) console.log(`  anchored anti-gaming gap < 0.25 — anchoring rewards a clone missing ~77%`);
    console.log(`  anchored identity per-section: ${aIdn.perSection.map((p) => `#${p.idx}:${p.emptyBand ? 'E' : p.coverage}`).join(' ')}`);
    console.log(`  anchored incomplete per-section: ${aInc.perSection.map((p) => `#${p.idx}:${p.emptyBand ? 'E' : p.coverage}`).join(' ')}`);
    console.log(aPass ? 'SELFTEST PASS (anchored)' : 'SELFTEST FAIL (anchored)');
  }

  const allPass = pass && aPass;
  console.log(allPass ? 'SELFTEST PASS' : 'SELFTEST FAIL');
  process.exit(allPass ? 0 : 1);
}

// ── COLOR SELFTEST (--color-selftest) — honesty-by-construction for the background/color dimension. ──
// Asserts: (2) identity colorMatch ~1.0; (3) dark clone of a dark site colorMatch >> white clone (gap >= 0.30);
// (4) light clone of a light site colorMatch reasonably HIGH. Additive — does NOT touch runSelftest().
function runColorSelftest() {
  const need = ['/tmp/glob-supa.json', '/tmp/vercel-dark-src.json', '/tmp/vc-dark-clone.json', '/tmp/vc-clone.json', '/tmp/gridfix-clone.json'];
  for (const p of need) if (!fs.existsSync(p)) { console.log(`COLOR-SELFTEST FAIL: missing ${p}`); process.exit(1); }
  const J = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  const supa = J('/tmp/glob-supa.json');
  const darkSrc = J('/tmp/vercel-dark-src.json');
  const darkClone = J('/tmp/vc-dark-clone.json');
  const whiteClone = J('/tmp/vc-clone.json');
  const gridfix = J('/tmp/gridfix-clone.json');

  const identity = colorMatchPage(supa, supa).colorMatch;
  const darkM = colorMatchPage(darkSrc, darkClone).colorMatch;
  const whiteM = colorMatchPage(darkSrc, whiteClone).colorMatch;
  const lightM = colorMatchPage(supa, gridfix).colorMatch;
  const gap = Math.round((darkM - whiteM) * 1000) / 1000;

  const g2 = identity >= 0.99;
  const g3 = (darkM - whiteM) >= 0.30 && darkM > whiteM;
  const g4 = lightM >= 0.85;
  const pass = g2 && g3 && g4;

  console.log(`COLOR-SELFTEST  identity=${identity.toFixed(3)}  darkClone=${darkM.toFixed(3)}  whiteClone=${whiteM.toFixed(3)}  gap=${gap.toFixed(3)}  light=${lightM.toFixed(3)}`);
  console.log(`  gate2 identity~1.0 (>=0.99): ${g2 ? 'PASS' : 'FAIL'}`);
  console.log(`  gate3 dark >> white (gap>=0.30): ${g3 ? 'PASS' : 'FAIL'}`);
  console.log(`  gate4 light-vs-light high (>=0.85): ${g4 ? 'PASS' : 'FAIL'}`);
  console.log(pass ? 'COLOR-SELFTEST PASS' : 'COLOR-SELFTEST FAIL');
  process.exit(pass ? 0 : 1);
}

// ── CLI ──
const isMain = (() => { try { return /(?:^|\/)grade-spec\.mjs$/.test(process.argv[1] || ''); } catch { return false; } })();
if (isMain) {
  if (process.argv.includes('--color-selftest')) { runColorSelftest(); }
  else if (process.argv.includes('--selftest')) { runSelftest(); }
  else {
    const srcPath = arg('src'), clonePath = arg('clone');
    if (!srcPath || !clonePath || !fs.existsSync(srcPath) || !fs.existsSync(clonePath)) {
      console.error('usage: node grade-spec.mjs --src <srcCapture> --clone <cloneCapture> [--anchored] [--summary]  (or --selftest)');
      process.exit(2);
    }
    const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
    const clone = JSON.parse(fs.readFileSync(clonePath, 'utf8'));
    const anchored = process.argv.includes('--anchored');
    const r = anchored ? gradeSpecAnchored(src, clone) : gradeSpec(src, clone);
    if (process.argv.includes('--summary')) {
      console.log(`src=${r.source} clone=${r.clone}${anchored ? '  [ANCHORED]' : ''}`);
      if (anchored) {
        console.log(`globalYScale=${r.globalYScale} srcLeaves=${r.srcLeaves} cloneLeaves=${r.cloneLeaves} sections=${r.sectionCount} mean=${r.mean} (all=${r.meanAll}) colorMatch=${r.colorMatch} scoreWithColor=${r.scoreWithColor} weakest=[${r.weakest.join(',')}] worstStretch=[${r.worstStretch.join(',')}]`);
        for (const p of r.perSection) {
          const hr = p.heightRatio != null ? `hRatio=${p.heightRatio}` : 'hRatio=--';
          console.log(`#${String(p.idx).padStart(2)} ${p.role.padEnd(11)} cov=${String(p.coverage).padEnd(5)} txt=${String(p.textCoverage).padEnd(5)} matched=${p.matched}/${p.total} anchors=${p.anchors != null ? p.anchors : 0} ${hr}${p.emptyBand ? ' (empty band ⇒ cov=1)' : ''}`);
        }
      } else {
        console.log(`yScale=${r.yScale} srcLeaves=${r.srcLeaves} cloneLeaves=${r.cloneLeaves} sections=${r.sectionCount} mean=${r.mean} (all=${r.meanAll}) colorMatch=${r.colorMatch} scoreWithColor=${r.scoreWithColor} weakest=[${r.weakest.join(',')}]`);
        for (const p of r.perSection) {
          console.log(`#${String(p.idx).padStart(2)} ${p.role.padEnd(11)} cov=${String(p.coverage).padEnd(5)} txt=${String(p.textCoverage).padEnd(5)} matched=${p.matched}/${p.total}${p.emptyBand ? ' (empty band ⇒ cov=1)' : ''}`);
        }
      }
      // ── per-section BACKGROUND/COLOR-fidelity breakdown ──
      console.log(`COLOR  page src=${r.color.srcPageColor} clone=${r.color.clonePageColor}  pageColorMatch=${r.colorMatch}`);
      for (const c of r.color.sections) {
        console.log(`#${String(c.idx).padStart(2)} ${String(c.role).padEnd(11)} bgSrc=${String(c.srcColor).padEnd(18)} bgClone=${String(c.cloneColor).padEnd(18)} colorMatch=${c.colorMatch != null ? c.colorMatch : '--'}${c.cloneMissing ? ' (clone section missing ⇒ vs page bg)' : ''}`);
      }
      process.exit(0);
    }
    process.stdout.write(JSON.stringify(r) + '\n');
  }
}

export { gradeSpec, gradeSpecAnchored, colorMatchPage };
