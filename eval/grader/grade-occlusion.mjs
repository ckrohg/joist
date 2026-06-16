#!/usr/bin/env node
/**
 * @purpose grade-occlusion.mjs — CROSS-SECTION OCCLUSION-COVERAGE collision metric (fusion gpt-5.5 + sonnet
 *   convergent gap fix). Closes the grader's biggest under-scoring hole: a clone where ENTIRE top-level sections
 *   are piled on top of each other (footer mega-nav + template-card grids over the hero; every feature section
 *   stacked) reads as a self-evident ~5-15 catastrophe to a human, but the existing relational collision axis
 *   (axisdelta-engine relationalRows) MISSES it for two structural reasons:
 *     (1) it only tests BOUNDED top-K SALIENT *LEAF* pairs (headings/CTAs/logos) — large-but-low-salience SECTION
 *         CONTAINERS (a footer wrapper, the hero wrapper) never make the top-24 cut, so the footer-over-hero pair
 *         is never compared; and
 *     (2) even when two cross-section leaves both make the cut, they are compared as scattered leaf boxes (each
 *         falling under the relational collision floor), not as section BANDS — so a footer SMEARED across the
 *         whole page registers as diffuse per-leaf overlaps that dilute away.
 *   AND the coherence connected-component dedup ×0.2-DEMOTES a page-wide pile as a benign theme-level shift
 *   (GLOBAL_DIFF). The right formula (clone_IOU − source_IOU) was right; the OPERANDS were wrong (bounded salient
 *   sibling LEAVES instead of all O(S²) top-level SECTION pairs). This module computes the metric over the right
 *   operands, on a NEW channel that BYPASSES the global-diff demotion.
 *
 * THE METRIC (cross-SECTION OCCLUSION COVERAGE):
 *   OCC = Σ over top-level section pairs (i,j) of max(0, IOU(clone_sec_i, clone_sec_j) − IOU(source_sec_i,
 *         source_sec_j)) · min(area_i, area_j) / total_page_area.
 *   computed per-viewport (1440 + 390); the reported OCC is the MAX over viewports.
 *
 *   (1) ENUMERATE TOP-LEVEL SECTIONS — GENERIC, never a hardcoded DOM path (root differs per site: supabase
 *       body>div>main>div|N, overreacted body>main>article>div>div|N, tailwind body>div>div>div>div|N). Group
 *       SOURCE records (those with box[vw]) by PARENT path; the parent(s) whose direct children best TILE the page
 *       vertically (≥3 big-band children, sequential low-overlap bands, minus a pass-through-wrapper penalty) are
 *       the section RAILS. We accept the best fine rail PLUS sibling big-band rails (footer/nav/header) that add
 *       new vertical coverage — so the footer-over-everything pile (a SIBLING of the main rail) is included.
 *   (2) MAP CLONE→SOURCE SECTION + bbox via the --joist-src stamp. Each CLONE record carries `stamp` = the
 *       content-addressed source path; srcByPath.get(stamp) resolves to the SOURCE leaf (PROVEN 420/420 on
 *       compare-343). Assign each stamped clone leaf to the section whose SOURCE band y-center contains the
 *       source leaf's y-center (tightest band wins). The section's SOURCE bbox is the section record's own
 *       box[vw]; the section's CLONE bbox is the union-bbox of its assigned clone leaves. CRITICAL: we do NOT use
 *       pathOf() prefix-matching for assignment — the |N|hHASH discriminator is LEAF-only, so all sibling main>div
 *       share one path prefix and prefix-matching would collapse the 12 siblings into one (the bug that made every
 *       section's clone band = the whole page). y-band containment on the unique SOURCE box is the fix.
 *   (3) IMPOSSIBLE-OVERLAP FILTER — count a pair ONLY when the clone sections materially overlap AND the SOURCE
 *       sections did NOT (delta>0), they are DIFFERENT source sections, and neither is an ancestor/descendant of
 *       the other. This auto-EXCLUDES an intentional layered hero (source overlaps too → delta≈0 → not flagged)
 *       and excludes containment (a section inside another is not a collision).
 *   (4) CATASTROPHIC_COLLISION (topology DESTROYED, not a benign global shift): if ANY qualifying cross-section
 *       pair has delta-IOU > CATASTROPHIC_DELTA (0.25) AND BOTH sections are AREA-GATED (each ≥ CATASTROPHIC_AREA
 *       ≈5% page area), mark catastrophic=true at severity 1.0. The area gate is REQUIRED: clean single-article
 *       blogs produce delta 0.30/0.31 on thin sub-divs whose area-weight is ~0 — without the gate those would
 *       false-trip the cap on a perfectly clean page. A benign uniform global shift PRESERVES topology (all
 *       sections translate together → no section newly overlaps a source-distant one → delta≈0), so it never
 *       fires here — that is exactly why this lives on its OWN channel and is exempt from the global-diff ×0.2.
 *
 * ANTI-OVERFIT: the constants (OCC cap ladder 0.40/0.25/0.10, CATASTROPHIC_DELTA 0.25, CATASTROPHIC_AREA 0.05)
 *   are PERCEPTUAL-PRIOR fractions-of-content-occluded, NOT fit to the sealed holdout human scores. They are
 *   justified by the self-evident catastrophe (supabase compare-343 / linear compare-392), a synthetic full-pile
 *   injection, and clean-page-unaffected — never by tuning toward a target number.
 *
 * REVERSIBILITY: PURE over a cached compare blob (records + box per viewport + stamp). No network, no host, no
 *   builder, no git, no image libs. Imports nothing from the engine except reused pure geometry helpers (iou /
 *   pathOf / isAncestorPath are re-declared locally to keep this module standalone — byte-identical semantics).
 *   The caller (grade-fused) gates the whole channel behind GRADER_NO_OCCLUSION=1 (default-ON; when off, grade-
 *   fused is byte-identical to HEAD). Deleting this file changes nothing else.
 *
 * CLI:
 *   node grade-occlusion.mjs --compare /tmp/compare-343.json [--json]
 *   node grade-occlusion.mjs --selftest      # offline synthetic checks (NO capture)
 *   node grade-occlusion.mjs --schema
 *   node --check grade-occlusion.mjs
 *
 * Falsifier: eval/grader/_grade-occlusion-selftest.mjs (the orchestrator re-executes it — the builder does NOT
 * self-bless). Inline `--selftest` runs the same offline checks for convenience.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

// ── PERCEPTUAL-PRIOR CONSTANTS (NOT fit to sealed human scores — see header anti-overfit note) ────────────────
export const CATASTROPHIC_DELTA = 0.25;  // a single cross-section pair whose clone-IOU exceeds source-IOU by >0.25 DESTROYS topology
export const CATASTROPHIC_AREA = 0.05;   // …AND both sections must be ≥5% of page area (the clean-blog false-positive guard)
// OCC → hard score ceiling (0-100 scale). Disqualifying floor: collision dominates regardless of other axes.
export const OCC_CAP_LADDER = [
  { occ: 0.40, ceil: 10 },   // ≥0.40 of content occluded → cap ≤~0.10
  { occ: 0.25, ceil: 30 },   // ≥0.25 → ≤~0.30
  { occ: 0.10, ceil: 65 },   // ≥0.10 → ≤~0.65
];                            // else: no cap
// section-finder thresholds (structural priors, not score-fit):
const MIN_BAND_H = 40;        // a section band must be at least this tall…
const MIN_BAND_WFRAC = 0.4;   // …and span at least 40% of viewport width (a real horizontal band, not a sidebar chip)
const MIN_RAIL_KIDS = 3;      // a rail must have ≥3 tiling children to be a "page of sections"
const MIN_LEAVES_PER_SECTION = 2; // a clone section needs ≥2 resolved leaves to have a meaningful union bbox
const PAIR_DELTA_EPS = 0;     // a pair contributes to OCC only when clone-IOU strictly exceeds source-IOU
const DEDUP_BAND = 700;       // a stamp is AMBIGUOUS (reused, deduped asset) if its clone leaves span >this in clone-Y
// DEDUP-GUARD (default-ON; GRADER_NO_DEDUP_GUARD=1 reverts to HEAD): the builder's image cache is content-addressed,
// so two VISUALLY-IDENTICAL assets (e.g. linear's twin product-UI mockup SVGs svg|1|h811c9dc5) collapse to ONE
// WP media URL and share ONE content-addressed --joist-src stamp. compare-capture then joins a BOTTOM-panel clone
// leaf to the FIRST source occurrence (the TOP panel). The clone-leaf→section attribution below would then place
// that bottom leaf in the TOP section, ballooning the top section's clone union-bbox down the page → a PHANTOM
// cross-section overlap (linear: a spurious 0.71 clone-IOU between two correctly-stacked panels). DISCRIMINATOR vs a
// GENUINE collision (a footer that really flows up): a genuine pile is made of UNIQUE stamps (the footer's own
// content) at the wrong place; a phantom is a DEDUPED stamp — one content-hash shared by clone leaves at DISTINCT
// clone-Y clusters (the same asset reused across sections). For an ambiguous (deduped) stamp we attribute each
// occurrence to the section whose SOURCE band best matches THAT occurrence's OWN clone-Y (not the shared stamp's
// srcY), so it can no longer extend a foreign section's union-bbox. UNIQUE-stamp leaves are untouched → genuine
// collisions still fire. (Re-attribution, not dropping — strictly safer: every leaf stays, just in the right band.)
// Read the flag at CALL time (not module-load) so callers/selftests can toggle it in-process (mirrors how grade-
// fused exercises both paths). Default-ON; GRADER_NO_DEDUP_GUARD=1 → off (HEAD behavior).
const dedupGuardOn = () => process.env.GRADER_NO_DEDUP_GUARD !== '1';
// the content-addressed hash key of a stamp = its trailing "tag|N|hHASH" path component (the dedup is on the asset
// content hash, NOT the full DOM path — six distinct DOM paths can all carry the one shared content hash).
function stampHashKey(stamp) { return String(stamp || '').split('>').pop(); }

// ── PURE GEOMETRY (byte-identical semantics to axisdelta-engine iou/pathOf/isAncestorPath; re-declared so this
//    module is standalone and image-lib-free) ─────────────────────────────────────────────────────────────────
export function pathOf(srcPathOrRef) { return String(srcPathOrRef || '').split('|')[0]; }
export function isAncestorPath(ancestor, descendant) {
  const a = pathOf(ancestor), d = pathOf(descendant);
  return a !== d && d.startsWith(a + '>');
}
export function iou(a, b) {
  if (!a || !b) return 0;
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy; if (inter <= 0) return 0;
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}
function boxAt(rec, vw) { return rec && rec.box && (rec.box[vw] || rec.box[String(vw)]) || null; }
function parentPath(p) { p = pathOf(p); const i = p.lastIndexOf('>'); return i < 0 ? null : p.slice(0, i); }
function unionBbox(boxes) {
  if (!boxes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// (1) findTopLevelSections — GENERIC top-level section enumeration. Group SOURCE records by PARENT path; rank
// parents by vertical-tiling quality (coverage × clean-tiling × not-a-pass-through-wrapper × ≥4 bands); accept the
// best fine rail PLUS sibling big-band rails (footer/nav) that add ≥8% NEW vertical coverage OR are themselves a
// strong rail. Return the union of accepted-rail children (distinct SOURCE records), sorted by y. Never hardcodes
// a DOM path. Each returned section is a SOURCE record with its own unique box[vw] (the |N|hHASH discriminator).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function findTopLevelSections(srcRecords, vw, pageH) {
  const withBox = srcRecords.filter((r) => boxAt(r, vw));
  // group big-band records by parent path
  const byParent = new Map();
  for (const r of withBox) {
    const b = boxAt(r, vw);
    if (b.h < MIN_BAND_H || b.w < vw * MIN_BAND_WFRAC) continue;
    const pp = parentPath(r.srcPath || r.ref);
    if (pp == null) continue;
    if (!byParent.has(pp)) byParent.set(pp, []);
    byParent.get(pp).push(r);
  }
  // score each candidate rail
  const cands = [];
  for (const [pp, kids0] of byParent) {
    const kids = kids0
      .filter((k) => { const b = boxAt(k, vw); return b.h >= MIN_BAND_H && b.w >= vw * MIN_BAND_WFRAC; })
      .sort((a, b) => boxAt(a, vw).y - boxAt(b, vw).y);
    if (kids.length < MIN_RAIL_KIDS) continue;
    const bands = kids.map((k) => boxAt(k, vw));
    let cover = 0, lastY = -Infinity, overlap = 0, maxY = 0;
    for (const b of bands) {
      const top = Math.max(b.y, lastY);
      cover += Math.max(0, (b.y + b.h) - top);
      if (b.y < lastY) overlap += lastY - b.y;
      lastY = Math.max(lastY, b.y + b.h);
      maxY = Math.max(maxY, b.y + b.h);
    }
    const span = Math.max(1, maxY - bands[0].y);
    const tile = (cover / span) * (1 - Math.min(1, overlap / span));
    // pass-through-wrapper penalty: a parent whose SINGLE biggest child spans most of the rail just wraps one
    // giant child (e.g. body>div wrapping <main>) — it does not SEGMENT the page; demote it relative to a real
    // multi-band rail so the fine rail wins but the wrapper can still be accepted as a coarse fallback.
    const maxChildFrac = Math.max(...bands.map((b) => b.h)) / span;
    const railScore = (cover / (pageH || span)) * tile * (1 - Math.min(0.8, maxChildFrac)) * Math.min(1, kids.length / 4);
    cands.push({ parent: pp, kids, y0: bands[0].y, y1: maxY, railScore });
  }
  if (!cands.length) return [];
  cands.sort((a, b) => b.railScore - a.railScore);
  // greedy multi-rail acceptance: always take the best; additionally take a rail that adds ≥8% NEW vertical
  // coverage (a footer/nav band the main rail does not cover) OR is a strong rail in its own right (≥0.5× best).
  const accepted = [];
  const covered = [];
  const newFrac = (y0, y1) => {
    let cur = [[y0, y1]];
    for (const [cy0, cy1] of covered) {
      const nx = [];
      for (const [a, b] of cur) {
        if (cy1 <= a || cy0 >= b) { nx.push([a, b]); continue; }
        if (cy0 > a) nx.push([a, cy0]);
        if (cy1 < b) nx.push([cy1, b]);
      }
      cur = nx;
    }
    return cur.reduce((s, [a, b]) => s + (b - a), 0) / (pageH || 1);
  };
  for (const c of cands) {
    const take = accepted.length === 0 || newFrac(c.y0, c.y1) >= 0.08 || c.railScore >= 0.5 * accepted[0].railScore;
    if (!take) continue;
    accepted.push(c);
    for (const k of c.kids) { const b = boxAt(k, vw); covered.push([b.y, b.y + b.h]); }
    if (accepted.length >= 4) break;
  }
  // union of accepted-rail children, dedup by source path, sorted by y
  const seen = new Set();
  const out = [];
  for (const c of accepted) for (const k of c.kids) {
    const sp = k.srcPath || k.ref;
    if (seen.has(sp)) continue;
    seen.add(sp);
    out.push(k);
  }
  return out.sort((a, b) => boxAt(a, vw).y - boxAt(b, vw).y);
}

// ── map each top-level SOURCE section to its CLONE union-bbox via the --joist-src stamp ───────────────────────
function sectionsForViewport(blob, vw) {
  const sc = (blob.sourceCapture && blob.sourceCapture.records) || [];
  const cc = (blob.cloneCapture && blob.cloneCapture.records) || [];
  const pageH = ((blob.report && blob.report.pageHeightByVw && blob.report.pageHeightByVw.source) || {})[vw]
    || ((blob.report && blob.report.pageHeightByVw && blob.report.pageHeightByVw.source) || {})[String(vw)]
    || Math.max(1, ...sc.filter((r) => boxAt(r, vw)).map((r) => { const b = boxAt(r, vw); return b.y + b.h; }));
  const sections = findTopLevelSections(sc, vw, pageH);
  if (sections.length < 2) return { sections: [], pageH, pageArea: vw * pageH, rails: 0 };

  // stamp bridge: clone.stamp === source.srcPath (content-addressed). resolve clone leaf → its SOURCE leaf box.
  const srcByPath = new Map();
  for (const r of sc) { const k = r.srcPath || r.ref; if (k != null && !srcByPath.has(k)) srcByPath.set(k, r); }

  // assign a section by y-band CONTAINMENT of a given y-center (NOT path-prefix — the |N|hHASH discriminator is
  // leaf-only, so prefix-matching collapses sibling sections into one). tightest containing band wins.
  const sectionOfYc = (yc) => {
    let best = null, bestH = Infinity;
    for (const s of sections) {
      const sb = boxAt(s, vw);
      if (yc >= sb.y - 1 && yc < sb.y + sb.h + 1 && sb.h < bestH) { best = s; bestH = sb.h; }
    }
    return best;
  };
  const sectionOf = (srcBox) => sectionOfYc(srcBox.y + srcBox.h / 2);

  // DEDUP-GUARD: pre-scan to find AMBIGUOUS (deduped/reused) content-hash keys — a key whose clone leaves span more
  // than DEDUP_BAND in clone-Y is the SAME asset reused across sections; its shared stamp must NOT extend a foreign
  // section's union-bbox via its srcY. (UNIQUE-stamp leaves are never flagged → genuine collisions preserved.)
  const guardOn = dedupGuardOn();
  const ambiguousKeys = new Set();
  if (guardOn) {
    const keyYs = new Map();
    for (const c of cc) {
      if (!c.stamp) continue;
      const cb = boxAt(c, vw);
      if (!cb) continue;
      const k = stampHashKey(c.stamp);
      const yc = cb.y + cb.h / 2;
      const cur = keyYs.get(k);
      if (!cur) keyYs.set(k, { min: yc, max: yc });
      else { if (yc < cur.min) cur.min = yc; if (yc > cur.max) cur.max = yc; }
    }
    for (const [k, r] of keyYs) if (r.max - r.min > DEDUP_BAND) ambiguousKeys.add(k);
  }

  const cloneBoxesBySection = new Map();
  let resolved = 0, stampedClone = 0, reattributed = 0;
  for (const c of cc) {
    if (!c.stamp) continue;
    stampedClone++;
    const cb = boxAt(c, vw);
    if (!cb) continue;
    const sr = srcByPath.get(c.stamp);
    const srcBox = boxAt(sr, vw);
    if (!srcBox) continue;
    // for an AMBIGUOUS (deduped, reused-across-sections) stamp, attribute THIS occurrence by its OWN clone-Y band
    // rather than the shared stamp's source band — so a bottom-panel leaf carrying the top panel's stamp no longer
    // balloons the top section. UNIQUE stamps keep the canonical srcBox→section attribution (genuine collisions).
    let sec;
    if (guardOn && ambiguousKeys.has(stampHashKey(c.stamp))) { sec = sectionOfYc(cb.y + cb.h / 2); reattributed++; }
    else sec = sectionOf(srcBox);
    if (!sec) continue;
    resolved++;
    const key = sec.srcPath || sec.ref;
    if (!cloneBoxesBySection.has(key)) cloneBoxesBySection.set(key, []);
    cloneBoxesBySection.get(key).push(cb);
  }

  const resolvedSections = sections
    .map((s) => {
      const key = s.srcPath || s.ref;
      const cloneBoxes = cloneBoxesBySection.get(key) || [];
      if (cloneBoxes.length < MIN_LEAVES_PER_SECTION) return null;
      return { path: key, srcBox: boxAt(s, vw), cloneBox: unionBbox(cloneBoxes), leaves: cloneBoxes.length };
    })
    .filter(Boolean);
  return { sections: resolvedSections, pageH, pageArea: vw * pageH, rails: sections.length, stampedClone, resolved, reattributed, ambiguousKeys: ambiguousKeys.size };
}

// ── OCC over one viewport's resolved sections ─────────────────────────────────────────────────────────────────
function occForViewport(blob, vw) {
  const { sections, pageArea, rails } = sectionsForViewport(blob, vw);
  if (sections.length < 2) return { OCC: 0, catastrophic: false, pairs: [], sectionCount: sections.length, rails };
  let OCC = 0;
  let catastrophic = false;
  const pairs = [];
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const A = sections[i], B = sections[j];
      // IMPOSSIBLE-OVERLAP FILTER: different source sections, neither ancestor/descendant of the other.
      if (A.path === B.path) continue;
      if (isAncestorPath(A.path, B.path) || isAncestorPath(B.path, A.path)) continue;
      const srcIou = iou(A.srcBox, B.srcBox);
      const cloneIou = iou(A.cloneBox, B.cloneBox);
      const delta = cloneIou - srcIou;
      if (!(delta > PAIR_DELTA_EPS)) continue;        // clone overlap ABSENT (or weaker) in source → no occlusion
      const areaA = (A.srcBox.w * A.srcBox.h) / pageArea;
      const areaB = (B.srcBox.w * B.srcBox.h) / pageArea;
      const weight = Math.min(areaA, areaB);
      const contribution = delta * weight;
      OCC += contribution;
      const isCata = delta > CATASTROPHIC_DELTA && areaA >= CATASTROPHIC_AREA && areaB >= CATASTROPHIC_AREA;
      if (isCata) catastrophic = true;
      if (delta > 0.05 || isCata) {
        pairs.push({ a: A.path, b: B.path, srcIou: +srcIou.toFixed(4), cloneIou: +cloneIou.toFixed(4),
          delta: +delta.toFixed(4), areaA: +areaA.toFixed(4), areaB: +areaB.toFixed(4),
          weight: +weight.toFixed(5), contribution: +contribution.toFixed(5), catastrophic: isCata });
      }
    }
  }
  pairs.sort((a, b) => b.delta - a.delta);
  return { OCC: +OCC.toFixed(5), catastrophic, pairs, sectionCount: sections.length, rails };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// computeOcclusion(blob, {widths}) → { OCC, catastrophic, occCeil, byViewport, topPairs }. OCC = MAX over
// viewports; catastrophic = OR over viewports. occCeil = the hard score ceiling from the cap ladder (null = no cap).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function computeOcclusion(blob, opts = {}) {
  const widths = opts.widths
    || (blob.report && blob.report.widths)
    || [blob.report && blob.report.joinWidth || 1440];
  const byViewport = {};
  let OCC = 0;
  let catastrophic = false;
  let topPairs = [];
  for (const w of widths) {
    const vw = String(w);
    let r;
    try { r = occForViewport(blob, vw); }
    catch (e) { r = { OCC: 0, catastrophic: false, pairs: [], sectionCount: 0, rails: 0, _error: String(e && e.message || e) }; }
    byViewport[vw] = r;
    if (r.OCC > OCC) OCC = r.OCC;
    if (r.catastrophic) catastrophic = true;
    if (r.pairs && r.pairs.length) topPairs = topPairs.concat(r.pairs.map((p) => ({ ...p, vw })));
  }
  topPairs.sort((a, b) => b.delta - a.delta);
  topPairs = topPairs.slice(0, 8);
  const occCeil = occCeilingFor(OCC, catastrophic);
  return { OCC: +OCC.toFixed(5), catastrophic, occCeil, byViewport, topPairs, widths };
}

// the cap ladder: OCC≥0.40→10, ≥0.25→30, ≥0.10→65, else no cap. A catastrophic flag forces AT LEAST the 0.40
// ceiling (10) regardless of the aggregate — a single full-pile pair that destroys topology is disqualifying even
// when the area-weighted aggregate is diluted by many clean sections.
export function occCeilingFor(OCC, catastrophic) {
  if (catastrophic) return Math.min(10, ladderCeil(OCC) == null ? 10 : ladderCeil(OCC));
  return ladderCeil(OCC);
}
function ladderCeil(OCC) {
  for (const { occ, ceil } of OCC_CAP_LADDER) if (OCC >= occ) return ceil;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// OFFLINE SELFTEST — synthetic fixtures (NO capture). Proves the mandated falsifiers:
//   (i)   self-clone → OCC=0, no cap, not catastrophic.
//   (ii)  injected 2-3 sections piled to full overlap → OCC≥0.40 + catastrophic + ceil≤10.
//   (iii) an INTENTIONAL layered hero (SOURCE sections overlap too → delta≈0) → NOT flagged (impossible filter).
//   (iv)  a benign uniform global shift (all sections translate together → topology preserved) → OCC≈0 + not
//         catastrophic (proves it bypasses-but-does-not-false-fire vs the global-diff demotion).
//   (v)   a clean page (sequential disjoint bands, faithful clone) → OCC≈0, no cap.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
function mkRec(srcPath, box1440, stamp) {
  const r = { ref: srcPath, srcPath, tag: 'div', box: { 1440: box1440 } };
  if (stamp !== undefined) r.stamp = stamp;
  return r;
}
// build a synthetic blob: srcSecs = array of {path, box} top-level source sections (under a common rail parent);
// cloneMap = path → clone box (where each section's leaves landed). We synthesize ≥MIN_LEAVES_PER_SECTION clone
// leaves per section, all stamped to that section's own srcPath (so they resolve to it and union to its clone box).
// Each section's leaves carry a UNIQUE content hash (hHASH includes the section's own discriminator) — this mirrors
// real captures, where two sections with different content get different content-addressed hashes, so a GENUINE
// pile (case ii/v) is made of UNIQUE stamps and the DEDUP-GUARD never re-attributes them. A DEDUPED asset reused
// across sections (the linear twin-SVG bug) is modeled explicitly by passing `sharedHash` (case vi).
function mkBlob(railParent, srcSecs, cloneBoxByPath, pageH = 4000) {
  const srcRecords = [];
  const cloneRecords = [];
  for (let si = 0; si < srcSecs.length; si++) {
    const s = srcSecs[si];
    // the SECTION record itself (a big band under the rail parent)
    srcRecords.push(mkRec(s.path, s.box));
    // a couple of LEAF records inside the section (children) carrying boxes within the section band — these are
    // what the clone leaves stamp back to. We give each leaf its own srcPath under the section.
    const cb = cloneBoxByPath[s.path] || s.box;
    for (let li = 0; li < 3; li++) {
      // UNIQUE per-section content hash (unless the section opts into a sharedHash to model a deduped asset).
      const leafHash = s.sharedHash || `hL${si}_${li}`;
      const leafPath = `${s.path}>child|${li}|${leafHash}`;
      const leafSrcBox = { x: s.box.x, y: s.box.y + 4 + li, w: s.box.w, h: Math.max(10, s.box.h - 8) };
      srcRecords.push(mkRec(leafPath, leafSrcBox));
      // clone leaf: stamped to the leaf's source path; its clone box lies within the section's CLONE band.
      const cloneLeafBox = { x: cb.x, y: cb.y + 4 + li, w: cb.w, h: Math.max(10, cb.h - 8) };
      cloneRecords.push(mkRec(`clone:${leafPath}`, cloneLeafBox, leafPath));
    }
  }
  return {
    report: { source: 'https://selftest.local', clone: 'http://localhost/selftest', widths: [1440], joinWidth: 1440,
      pageHeightByVw: { source: { 1440: pageH }, clone: { 1440: pageH } } },
    sourceCapture: { records: srcRecords },
    cloneCapture: { records: cloneRecords },
  };
}

export function runSelftest() {
  const cases = [];
  const ok = (name, pass, detail = '') => cases.push({ name, pass: !!pass, detail });

  // 4 sequential disjoint source sections under one rail (each a 1/4-page band).
  const RAIL = 'body>div>main';
  const cleanSecs = [
    { path: `${RAIL}>div|1|hA`, box: { x: 0, y: 0, w: 1440, h: 1000 } },
    { path: `${RAIL}>div|2|hB`, box: { x: 0, y: 1000, w: 1440, h: 1000 } },
    { path: `${RAIL}>div|3|hC`, box: { x: 0, y: 2000, w: 1440, h: 1000 } },
    { path: `${RAIL}>div|4|hD`, box: { x: 0, y: 3000, w: 1440, h: 1000 } },
  ];

  // (i) SELF-CLONE: clone bands === source bands → OCC=0, no cap, not catastrophic.
  {
    const cloneMap = Object.fromEntries(cleanSecs.map((s) => [s.path, s.box]));
    const r = computeOcclusion(mkBlob(RAIL, cleanSecs, cloneMap), { widths: [1440] });
    ok('(i) self-clone → OCC≈0', r.OCC < 0.01, `OCC=${r.OCC}`);
    ok('(i) self-clone → not catastrophic', r.catastrophic === false, `cata=${r.catastrophic}`);
    ok('(i) self-clone → no cap', r.occCeil == null, `occCeil=${r.occCeil}`);
  }

  // (ii) PILED-UP PAGE: every clone section lands on the SAME top band (full mutual overlap) → OCC≥0.40 +
  //      catastrophic + ceil≤10. This is the synthetic equivalent of the supabase/linear footer-over-everything.
  {
    const pile = { x: 0, y: 0, w: 1440, h: 1000 };   // all four sections piled onto the first band
    const cloneMap = Object.fromEntries(cleanSecs.map((s) => [s.path, pile]));
    const r = computeOcclusion(mkBlob(RAIL, cleanSecs, cloneMap), { widths: [1440] });
    ok('(ii) piled page → OCC≥0.40', r.OCC >= 0.40, `OCC=${r.OCC}`);
    ok('(ii) piled page → catastrophic', r.catastrophic === true, `cata=${r.catastrophic}`);
    ok('(ii) piled page → ceil≤10 (near-0 score)', r.occCeil != null && r.occCeil <= 10, `occCeil=${r.occCeil}`);
  }

  // (iii) INTENTIONAL LAYERED HERO: the SOURCE sections already overlap (a hero with a layered card on top), and
  //       the clone reproduces that SAME overlap → delta≈0 → NOT flagged. Proves the impossible-overlap filter.
  {
    const layeredSrc = [
      { path: `${RAIL}>div|1|hHero`, box: { x: 0, y: 0, w: 1440, h: 1200 } },
      { path: `${RAIL}>div|2|hCard`, box: { x: 200, y: 200, w: 1000, h: 600 } },   // sits ON TOP of the hero (source)
      { path: `${RAIL}>div|3|hRest`, box: { x: 0, y: 1200, w: 1440, h: 1000 } },
      { path: `${RAIL}>div|4|hFoot`, box: { x: 0, y: 2200, w: 1440, h: 800 } },
    ];
    // clone reproduces the SAME layered geometry faithfully (hero+card overlap preserved).
    const cloneMap = Object.fromEntries(layeredSrc.map((s) => [s.path, s.box]));
    const r = computeOcclusion(mkBlob(RAIL, layeredSrc, cloneMap), { widths: [1440] });
    ok('(iii) layered hero (source overlaps too) → NOT catastrophic', r.catastrophic === false, `cata=${r.catastrophic}`);
    ok('(iii) layered hero → OCC≈0 (delta≈0, source overlap subtracted)', r.OCC < 0.01, `OCC=${r.OCC}`);
    ok('(iii) layered hero → no cap', r.occCeil == null, `occCeil=${r.occCeil}`);
  }

  // (iv) BENIGN UNIFORM GLOBAL SHIFT: every section translated DOWN by the same 120px (a theme-level header-height
  //      shift) — topology PRESERVED (sections still sequential, no new cross-section overlap). OCC≈0, not
  //      catastrophic. Proves the OCC channel does NOT false-fire on the very pattern the global-diff demotion
  //      exists for — it is exempt from that demotion precisely BECAUSE it does not register here.
  {
    const cloneMap = Object.fromEntries(cleanSecs.map((s) => [s.path, { ...s.box, y: s.box.y + 120 }]));
    const r = computeOcclusion(mkBlob(RAIL, cleanSecs, cloneMap, 4120), { widths: [1440] });
    ok('(iv) uniform global shift → OCC≈0 (topology preserved)', r.OCC < 0.01, `OCC=${r.OCC}`);
    ok('(iv) uniform global shift → not catastrophic', r.catastrophic === false, `cata=${r.catastrophic}`);
    ok('(iv) uniform global shift → no cap', r.occCeil == null, `occCeil=${r.occCeil}`);
  }

  // (v) PARTIAL PILE (one section smeared onto two others, both ≥5% area, delta>0.25) → catastrophic + cap.
  {
    const partial = Object.fromEntries(cleanSecs.map((s) => [s.path, s.box]));
    // section 3 piles onto section 1 (full overlap of two big bands).
    partial[`${RAIL}>div|3|hC`] = { x: 0, y: 0, w: 1440, h: 1000 };
    const r = computeOcclusion(mkBlob(RAIL, cleanSecs, partial), { widths: [1440] });
    ok('(v) one big section piled onto another → catastrophic', r.catastrophic === true, `cata=${r.catastrophic}`);
    ok('(v) partial pile → capped', r.occCeil != null, `occCeil=${r.occCeil}`);
  }

  // (vi) DEDUP-GUARD FALSE-POSITIVE (the linear twin-SVG bug, modeled directly — this is the bug being fixed): two
  //      CORRECTLY-STACKED panels (sections 1 & 2) each contain a VISUALLY-IDENTICAL mockup asset (shared content
  //      hash 'hTWIN'). The builder's content-addressed image cache collapses them to ONE stamp, and compare-capture
  //      joins a reused BOTTOM-band clone occurrence to the FIRST source occurrence's stamp. At HEAD this balloons
  //      sections 1 & 2's clone union-bboxes DOWN to the bottom band → a PHANTOM cross-section collision (high
  //      clone-IOU between two sections that actually render stacked, source-IOU=0). With the guard (default-ON) the
  //      ambiguous (deduped) stamp's occurrences are re-attributed by their OWN clone-Y → no phantom. The fixture is
  //      the synthetic twin of linear compare-392 (svg|1|h811c9dc5 reused across the two product-UI panels).
  const mkTwinPhantomBlob = () => {
    const railSecs = [
      { p: `${RAIL}>div|1|hA`, y: 0, h: 1000 },
      { p: `${RAIL}>div|2|hB`, y: 1000, h: 1000 },
      { p: `${RAIL}>div|3|hC`, y: 2000, h: 1000 },
    ];
    const src = [], clone = [];
    for (let i = 0; i < railSecs.length; i++) {
      const s = railSecs[i];
      src.push(mkRec(s.p, { x: 0, y: s.y, w: 1440, h: s.h }));   // full-width section band (a rail kid)
      for (let li = 0; li < 4; li++) {                            // narrow UNIQUE leaves (width<576 → not rails)
        const lp = `${s.p}>span|${li}|hU${i}_${li}`;
        const b = { x: 50, y: s.y + 10 + li * 30, w: 500, h: 80 };
        src.push(mkRec(lp, b)); clone.push(mkRec(`clone:${lp}`, b, lp));
      }
    }
    // the deduped twin asset: ONE source occurrence in section 1 (top) and section 2 (mid), both width<576.
    const twinA = `${RAIL}>div|1|hA>img|0|hTWIN`, twinB = `${RAIL}>div|2|hB>img|0|hTWIN`;
    src.push(mkRec(twinA, { x: 50, y: 500, w: 500, h: 200 }));
    src.push(mkRec(twinB, { x: 50, y: 1500, w: 500, h: 200 }));
    clone.push(mkRec('clone:twinA@top', { x: 50, y: 500, w: 500, h: 200 }, twinA));   // legit top occurrences
    clone.push(mkRec('clone:twinB@mid', { x: 50, y: 1500, w: 500, h: 200 }, twinB));
    // content-cache bug: each twin is REUSED at the bottom band (y≈2200-2800) but its clone leaf carries the FIRST
    // (top) occurrence's stamp → joins to the top srcY → at HEAD attributes to sections 1 & 2 → balloons both unions.
    for (let i = 0; i < 4; i++) clone.push(mkRec(`clone:twinA@b${i}`, { x: 50, y: 2200 + i * 40, w: 1300, h: 600 }, twinA));
    for (let i = 0; i < 4; i++) clone.push(mkRec(`clone:twinB@b${i}`, { x: 60, y: 2210 + i * 40, w: 1300, h: 600 }, twinB));
    return { report: { widths: [1440], joinWidth: 1440, pageHeightByVw: { source: { 1440: 3000 }, clone: { 1440: 3000 } } },
      sourceCapture: { records: src }, cloneCapture: { records: clone } };
  };
  {
    const onR = computeOcclusion(mkTwinPhantomBlob(), { widths: [1440] });
    ok('(vi) deduped twin asset → NO phantom catastrophic (guard ON)', onR.catastrophic === false, `cata=${onR.catastrophic} OCC=${onR.OCC}`);
    ok('(vi) deduped twin asset → NOT capped (guard ON)', onR.occCeil == null, `occCeil=${onR.occCeil} OCC=${onR.OCC}`);
    // reversibility + load-bearing proof: guard OFF → the phantom RETURNS (catastrophic, high clone-IOU). This proves
    // the fixture genuinely reproduces the bug AND the guard is what clears it (call-time flag → in-process toggle).
    process.env.GRADER_NO_DEDUP_GUARD = '1';
    const offR = computeOcclusion(mkTwinPhantomBlob(), { widths: [1440] });
    delete process.env.GRADER_NO_DEDUP_GUARD;
    ok('(vi) reversible: guard OFF re-exhibits the phantom (catastrophic returns)', offR.catastrophic === true && offR.OCC > onR.OCC, `off={OCC:${offR.OCC},cata:${offR.catastrophic}} on={OCC:${onR.OCC},cata:${onR.catastrophic}}`);
  }

  // (vii) GENUINE COLLISION SURVIVES a co-present deduped asset (the load-bearing recall check): section 3 GENUINELY
  //       piles onto section 1 with its OWN UNIQUE stamps, AND a decorative asset is deduped across every section.
  //       The guard must neutralize ONLY the deduped asset — the unique-stamp pile MUST still fire catastrophic.
  {
    const partial = Object.fromEntries(cleanSecs.map((s) => [s.path, s.box]));
    const PILED = `${RAIL}>div|3|hC`;
    partial[PILED] = { x: 0, y: 0, w: 1440, h: 1000 };   // section 3 genuinely piles onto section 1
    // a decorative asset is deduped across the OTHER sections (content hash 'hDECOR') → ambiguous across bands — but
    // the genuinely-piled section keeps its OWN UNIQUE stamps (real piled content is not the shared decoration).
    const sharedSecs = cleanSecs.map((s) => (s.path === PILED ? s : { ...s, sharedHash: 'hDECOR' }));
    const r = computeOcclusion(mkBlob(RAIL, sharedSecs, partial), { widths: [1440] });
    ok('(vii) genuine pile (unique stamps) STILL catastrophic despite a co-present deduped asset', r.catastrophic === true, `cata=${r.catastrophic} OCC=${r.OCC}`);
    ok('(vii) genuine pile → still capped', r.occCeil != null, `occCeil=${r.occCeil}`);
  }

  const failed = cases.filter((c) => !c.pass);
  console.log('\n==== GRADE-OCCLUSION — OFFLINE SELFTEST (no capture) ====');
  for (const c of cases) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${cases.length} cases)`);
  return failed.length === 0;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export const OCCLUSION_SCHEMA = {
  scorerFile: 'eval/grader/grade-occlusion.mjs',
  metric: 'OCC = Σ over top-level section pairs (i,j) of max(0, IOU(clone_i,clone_j) − IOU(src_i,src_j)) · min(area_i,area_j)/page_area; per-viewport, reported MAX.',
  sectionEnumeration: 'findTopLevelSections: group SOURCE records by parent path; rank parents by vertical-tiling quality (coverage × clean-tiling × pass-through-penalty × band-count); accept best fine rail + sibling big-band rails (footer/nav) adding ≥8% new vertical coverage; children of accepted rails = top-level sections. GENERIC — no hardcoded DOM path.',
  cloneMapping: 'each clone record carries stamp=--joist-src=source srcPath (content-addressed); srcByPath.get(stamp) → source leaf box; assign to the section whose SOURCE band y-center contains the leaf (tightest wins) — NOT path-prefix (|N|hHASH is leaf-only). section CLONE bbox = union of assigned clone leaf boxes; section SOURCE bbox = the section record box[vw].',
  impossibleOverlapFilter: 'count a pair ONLY when delta>0 AND different source sections AND neither is ancestor/descendant of the other. Auto-excludes an intentional layered hero (source overlaps too → delta≈0) and containment.',
  catastrophic: `any qualifying pair with delta-IOU > ${CATASTROPHIC_DELTA} AND both sections ≥ ${CATASTROPHIC_AREA} page-area → catastrophic_collision (sev 1.0). The area gate is the clean-single-article-blog false-positive guard. Topology DESTROYED (source-distant sections share a clone region) vs a benign global shift (topology preserved → delta≈0 → not flagged).`,
  capLadder: `occCeil(0-100): OCC≥0.40→10, ≥0.25→30, ≥0.10→65, else null; a catastrophic flag forces ceil≤10. Applied in grade-fused as a disqualifying FLOOR (Math.min with any existing veto cap — never raises a score).`,
  coherenceBypass: 'the catastrophic event lives on THIS OCC channel, NOT the engine coherence connected-component channel, so the global-diff ×0.2 demotion (axisdelta-engine GLOBAL_DIFF_FACTOR) cannot down-weight a page-wide pile.',
  antiOverfit: 'constants are PERCEPTUAL-PRIOR fractions-of-content-occluded, NOT fit to sealed holdout human scores; validated by the self-evident supabase/linear catastrophe + synthetic injection + clean-page-unaffected.',
  reversibility: 'PURE over a cached compare blob (records+box+stamp). No host/network/git/image-libs. Caller gates behind GRADER_NO_OCCLUSION=1 (default-ON; off → grade-fused byte-identical to HEAD). Deleting this file changes nothing else.',
  selftest: 'eval/grader/_grade-occlusion-selftest.mjs — self-clone OCC=0/no cap; piled page OCC≥0.40+catastrophic+ceil≤10; layered hero (source overlaps too) NOT flagged; benign global shift topology-preserved not-fired; partial big-section pile catastrophic+capped. Builder does NOT self-bless; orchestrator re-executes.',
};

function main() {
  if (has('schema')) { console.log(JSON.stringify(OCCLUSION_SCHEMA, null, 2)); return; }
  if (has('selftest')) { process.exit(runSelftest() ? 0 : 1); }
  const comparePath = arg('compare');
  if (!comparePath || !fs.existsSync(comparePath)) { console.error('need --compare <blob.json> (or --selftest / --schema)'); process.exit(2); }
  const blob = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
  const out = computeOcclusion(blob, {});
  console.log('\n==== GRADE-OCCLUSION (cross-section occlusion coverage) ====');
  console.log(`compare: ${comparePath}`);
  console.log(`OCC: ${out.OCC}  catastrophic: ${out.catastrophic}  occCeil: ${out.occCeil == null ? '(no cap)' : out.occCeil}`);
  for (const w of out.widths) {
    const v = out.byViewport[String(w)];
    if (!v) continue;
    console.log(`  @${w}: OCC=${v.OCC} catastrophic=${v.catastrophic} sections=${v.sectionCount} rails=${v.rails}${v._error ? ' ERROR=' + v._error : ''}`);
  }
  console.log('\nTOP CROSS-SECTION PAIRS (clone overlap absent in source):');
  for (const p of out.topPairs.slice(0, 6)) {
    console.log(`  Δ${String(p.delta).padStart(6)} ${p.catastrophic ? '[CATA] ' : '       '}w=${String(p.weight).padEnd(7)} @${p.vw}  ${String(p.a).slice(-26)} × ${String(p.b).slice(-26)}  (srcIOU=${p.srcIou} cloneIOU=${p.cloneIou})`);
  }
  if (has('json')) { fs.writeFileSync('/tmp/grade-occlusion-out.json', JSON.stringify(out, null, 2)); console.log('\nfull occlusion report → /tmp/grade-occlusion-out.json'); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
