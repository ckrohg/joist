#!/usr/bin/env node
/**
 * @purpose STRUCTURAL band-segmenter. Reads a capture-layout.mjs tree ({url,title,pageBg,pageH,vw,root,fonts,
 * rasters}) and partitions the page into an ordered {pageH,vw,nav,sections[],footer} band tree — the structural
 * scaffold a container-inference builder needs BEFORE it places widgets. Unlike build-absolute (which flattens to
 * page-absolute leaves), this emits the PRIMARY PARTITION: which leaf belongs to which full-bleed band, and which
 * band is the nav / a section / the footer.
 *
 * THE KEYSTONE (why v1 was shallow): the page's REAL sections almost never live as direct children of the content
 * root. They hide one-to-three wrappers DOWN, inside an oversized `<main>`/`<div>` whose single job is to hold the
 * whole stack (linear <main>→<div> with 11 kids; basecamp <main>→<div> with 6 kids; tailwind content <div> with 6
 * kids). A shallow "direct children of content root" partition therefore collapses the entire page into ONE giant
 * section. The keystone is the RECURSIVE DESCENT (Part A) that drills through these oversized vertical-partition
 * wrappers until each band is a real, single-purpose section — guarded so it never shatters a side-by-side card row
 * (basecamp's 12 same-y blockquotes; the 6 header+article rows) and never explodes a uniform repeated list
 * (overreacted's 57 <article> rows) into 57 sections.
 *
 * SEPARATORS (strongest→weakest):
 *   1. EXPLICIT TAG/ROLE — a direct child whose tag is section/main/article/aside/header/nav/footer or carries
 *      role=banner/main/contentinfo is its own band boundary (same landmark vocabulary build-absolute uses:
 *      header,nav,main,footer,[role]). An explicit <main>/role=main wrapper is UNWRAPPED so ITS children become
 *      the section bands (a single <main> band would otherwise collapse the whole page into one section).
 *   2. STRUCTURAL — the direct children of the content root (the deepest single-child-chain node with >=2 kids)
 *      are the candidate bands; oversized bands are then RECURSIVELY descended (Part A).
 *
 * navRule    — reuse build-absolute detectHeaderNav's NAVFIX test (anchors<=15, anchor y-span<=120px, rows<=2),
 *              but feed it ONLY the structurally-identified TOPMOST band, NOT a whole-tree gatherLeaves sweep
 *              (validated: the global sweep mis-classifies a vertical content stack as a 195-item pseudo-nav).
 *              PASS → that band is `nav`. FAIL → the band is DEMOTED to section idx 0 (role:'nav-demoted').
 * footerRule — footer = the bottommost band, confirmed by explicit tag <footer> / role=contentinfo on a direct
 *              child (strongest — supabase & vercel both expose a literal <footer>). Else the bottommost band is
 *              left as a section (no false footer).
 * sectionRule— sections = the ordered bands BETWEEN nav and footer (plus a demoted failed-nav band as idx 0 if
 *              applicable), each carrying its background and assigned leaf members.
 * member     — every LEAF node (gatherLeaves recursion, same as build-absolute) NOT consumed by the nav band is
 *   Assignment  assigned to the band whose [y0,y1] contains the leaf's vertical center; ties / out-of-range fall
 *              to the nearest band. Footer leaves go to footer; nav leaves go to nav.
 *
 * ── THE FULL ALGORITHM (re-landed; v1 was the shallow direct-children-only partition) ──
 *   PART A  RECURSIVE DESCENT — a band is OVERSIZED when box.h > max(0.45*pageH, 2*vw). If an oversized band's
 *           container children form a CLEAN VERTICAL PARTITION (each child near-full-bleed relative to the band's
 *           own width, stacked top-to-bottom, with NO two children sharing the same y-row), replace the band with
 *           those children and recurse on each. A single-child container wrapper is transparently descended
 *           (linear <main>→<div>, basecamp <main>→<div>). NEVER split a side-by-side same-y card row — if the
 *           children overlap in y (a grid/row), the band is left whole.
 *   PART D  UNIFORM-LIST GUARD (runs FIRST, before any heading split) — if a band is dominated by a REPEATED
 *           short-row structure (>=4 rows of similar height <100px with a repeating leaf-tag pattern e.g.
 *           dt/dd/li/span/article, OR >12 same-height siblings), treat it as ONE role:'repeated-list' section and
 *           do NOT descend / heading-split it. (Fixes overreacted's 57-article list AND basecamp's calendar
 *           over-split.)
 *   PART B  HEADING-LED SPLIT of an oversized SAME-BG band that Part A could not cleanly partition — split at each
 *           heading-led leaf boundary IFF the band yields <=12 HETEROGENEOUS blocks; if it would yield >15 UNIFORM
 *           blocks keep it as ONE role:'repeated-list' instead.
 *   PART C  GUTTER-SNAP — after the final ordered section list is built, snap each section.y1 -> next section.y0,
 *           and the last section.y1 -> footer.y0 (or pageH) so the bands tile the page with ~full coverage.
 *
 * edgeCases  — OVERLAPPING BANDS: a candidate band B whose [y,y1] is contained within sibling A's is a CHILD, not
 *              a peer → drop B from the band list (A absorbs B's leaves via center-containment). Zero-area / empty
 *              bands are dropped.
 *
 * CLI: node segment.mjs --layout <captureJson> [--out <segJson>] [--pretty]
 *      node segment.mjs --selftest      (runs on /tmp/glob-supa.json; asserts the SANITY invariants)
 */
import fs from 'fs';

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const round = (n) => Math.round(n || 0);
const stripEmoji = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '').replace(/\s+/g, ' ').trim();
const opaque = (c) => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent' && !/,\s*0\)\s*$/.test(c);

// ── NAVFIX thresholds — MUST stay identical to build-absolute.mjs detectHeaderNav (do NOT diverge) ──
const NAV_MAX_ITEMS = 15;   // real header navs carry ~3–15 links; more ⇒ repeated content rows
const NAV_MAX_YSPAN = 120;  // a single horizontal row; larger ⇒ a vertical stack, not a nav
const NAV_MAX_ROWS = 2;     // anchors cluster into at most 2 y-rows in a real header

// ── RECURSIVE-DESCENT / SPLIT thresholds ──
const FULLBLEED_FRAC = 0.85;  // a child is "full-bleed" if its width is >=85% of the band's own width
const SAMEROW_TOL = 24;       // two children share a y-row if their top edges are within this many px
const UNIFORM_H_TOL = 0.25;   // "similar height" = within 25% of the median row height
const SHORT_ROW_PX = 100;     // a "short row" (repeated-list candidate) is < this tall
const LIST_MIN_ROWS = 4;      // >=4 repeated short rows ⇒ uniform list
const LIST_MIN_SAME_H = 12;   // >12 same-height siblings ⇒ uniform list
const HEADSPLIT_MAX_BLOCKS = 12; // heading-led split only if it yields <=12 heterogeneous blocks
const LIST_KEEP_MIN = 15;        // >15 uniform blocks ⇒ keep as one repeated-list (do not split)

// landmark tag/role vocabulary (mirrors build-absolute's landmark detectors: header,nav,main,footer,[role]).
const isMainTag = (n) => n && (n.tag === 'main' || (n.role && /^main$/i.test(n.role)));
const isFooterTag = (n) => n && (n.tag === 'footer' || (n.role && /^contentinfo$/i.test(n.role)));
const isHeadingNode = (n) => n && (/^h[1-6]$/i.test(n.tag || '') || n.kind === 'heading');

// gatherLeaves — IDENTICAL recursion to build-absolute.mjs: every non-container node carrying a box is a leaf.
function gatherLeaves(root) { const out = []; const g = (n) => { if (!n) return; if (n.kind === 'container') (n.children || []).forEach(g); else if (n.box) out.push(n); }; g(root); return out; }

// a compact, builder-friendly reference to a leaf member (NOT the whole subtree).
function boxRef(n) {
  const r = { kind: n.kind, box: { x: round(n.box.x), y: round(n.box.y), w: round(n.box.w), h: round(n.box.h) } };
  const t = stripEmoji(n.text);
  if (t) r.text = t.slice(0, 80);
  if (n.tag) r.tag = n.tag;
  if (n.href) r.href = n.href;
  return r;
}

// background descriptor for a band node: {kind:'color'|'gradient'|'image'|'default', value}.
function bandBg(n) {
  const b = n && n.background;
  if (b) {
    if (b.color && opaque(b.color)) return { kind: 'color', value: b.color };
    if (b.gradient) return { kind: 'gradient', value: b.gradient };
    if (b.image) return { kind: 'image', value: b.image };
  }
  // fall back to a sampled paint if the capture recorded one on this container
  if (n && n.bgSampled && opaque(n.bgSampled)) return { kind: 'color', value: n.bgSampled };
  return { kind: 'default', value: null };
}
// a comparable bg signature string (for SAME-BG tests): color/gradient/image value, or '' for default.
function bgSig(n) { const b = bandBg(n); return b.kind === 'default' ? '' : b.kind + ':' + (b.value || ''); }

// CONTENT ROOT — descend the single-child chain from root to the first node with >=2 children (the band-bearing
// node). Both supabase (body>div) and vercel (body>div>div) converge here on a [navband, <main>, <footer>] triple.
function contentRoot(root) {
  let n = root;
  while (n && n.kind === 'container' && (n.children || []).length === 1 && n.children[0].kind === 'container') n = n.children[0];
  return n || root;
}

// direct CONTAINER children that carry a real box (the partition candidates of a band).
function boxKids(n) { return (n.children || []).filter((c) => c && c.box && c.box.h > 0 && c.box.w > 0); }

// ── PART D — UNIFORM-LIST GUARD ──────────────────────────────────────────────────────────────────────────────
// A band is a REPEATED-LIST when its direct children are dominated by a repeated short-row structure:
//   (a) >=4 children that are short rows (<100px) of SIMILAR height (within UNIFORM_H_TOL of the median) AND share
//       a repeating leaf-tag pattern (the same dominant inner tag — dt/dd/li/span/article/blockquote/p), OR
//   (b) >12 children of the SAME height (same-height siblings — e.g. a calendar / icon grid).
// Returns true ⇒ keep the band whole as ONE role:'repeated-list'; do NOT descend or heading-split it.
function dominantLeafTag(node) {
  const counts = {};
  for (const lf of gatherLeaves(node)) { const t = (lf.tag || lf.kind || '').toLowerCase(); if (t) counts[t] = (counts[t] || 0) + 1; }
  let best = '', bc = 0; for (const t in counts) if (counts[t] > bc) { bc = counts[t]; best = t; }
  return best;
}
function isUniformList(band) {
  const kids = boxKids(band);
  if (kids.length < LIST_MIN_ROWS) return false;
  const hs = kids.map((k) => k.box.h).sort((a, b) => a - b);
  const med = hs[Math.floor(hs.length / 2)] || 1;

  // (b) >12 same-height siblings (tight height clustering on the band's own children)
  const sameH = kids.filter((k) => Math.abs(k.box.h - med) <= Math.max(2, med * UNIFORM_H_TOL)).length;
  if (kids.length > LIST_MIN_SAME_H && sameH >= kids.length * 0.8) return true;

  // (a) >=4 short rows of similar height sharing one repeating inner-tag pattern
  const shortRows = kids.filter((k) => k.box.h < SHORT_ROW_PX && Math.abs(k.box.h - med) <= Math.max(2, med * UNIFORM_H_TOL));
  if (shortRows.length >= LIST_MIN_ROWS && shortRows.length >= kids.length * 0.7) {
    const tags = shortRows.map((k) => dominantLeafTag(k));
    const tagCounts = {}; tags.forEach((t) => { if (t) tagCounts[t] = (tagCounts[t] || 0) + 1; });
    const top = Math.max(0, ...Object.values(tagCounts));
    const REPEAT_TAGS = new Set(['dt', 'dd', 'li', 'span', 'article', 'blockquote', 'p', 'a', 'h2', 'h3']);
    const repeatTag = Object.keys(tagCounts).find((t) => tagCounts[t] === top) || '';
    if (top >= LIST_MIN_ROWS && (top >= shortRows.length * 0.7) && REPEAT_TAGS.has(repeatTag)) return true;
  }
  return false;
}

// ── PART A helper — does a band's children form a CLEAN VERTICAL PARTITION? ──────────────────────────────────
// Clean ⇒ the children are a WIDTH-CONSISTENT vertical stack with NO two children sharing a y-row (a row/grid of
// same-y cards is NOT a vertical partition). Full-bleed is measured relative to the WIDEST child — i.e. the band's
// real CONTENT COLUMN — not the band's outer box width, so a CENTERED inset stack (basecamp's 6 rows are each 1074
// of a 1440 band) still reads as a clean partition while a row of narrow side-by-side cards does not (the same-y
// overlap check rejects those). Each child must be >=FULLBLEED_FRAC of that content-column width to count as a band.
function isCleanVerticalPartition(band) {
  const kids = boxKids(band);
  if (kids.length < 2) return false;
  const colW = Math.max(...kids.map((k) => k.box.w));   // the content-column width (widest child)
  // every child must span ~the full content column (overreacted's narrow 632 column reads here; basecamp's inset
  // 1074 rows read here) — a half/third-width child means side-by-side columns, not a clean vertical stack.
  if (!kids.every((k) => k.box.w >= colW * FULLBLEED_FRAC)) return false;
  // no two children may share a y-row (side-by-side cards) → their vertical intervals must not overlap > tol
  const sorted = [...kids].sort((a, b) => a.box.y - b.box.y);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], cur = sorted[i];
    const prevY1 = prev.box.y + prev.box.h;
    const overlap = prevY1 - cur.box.y;
    if (overlap > SAMEROW_TOL) return false; // children overlap vertically ⇒ a grid/row, not a clean stack
  }
  return true;
}

// ── PART A + B + D — produce the final ordered SECTION BANDS from a list of top-level candidate bands. ───────────
// For each candidate band, RECURSIVELY DESCEND while it is oversized and cleanly vertically partitionable (Part A),
// guarding uniform lists (Part D) and side-by-side rows. Bands that remain oversized but same-bg get a heading-led
// split (Part B). Returns a flat ordered array of {band, role} section descriptors.
function resolveBands(topBands, pageH, vw) {
  const OVERSIZE = Math.max(0.45 * pageH, 2 * vw);
  const out = [];

  const recurse = (band, depth) => {
    const h = band.box.h;
    // PART D first — never descend / split a uniform repeated list; keep it whole.
    if (isUniformList(band)) { out.push({ band, role: 'repeated-list' }); return; }

    const oversized = h > OVERSIZE;

    // PART A — descend an oversized band whose children form a clean vertical partition.
    if (oversized && depth < 6) {
      // transparently unwrap a single-child container wrapper (linear <main>→<div>, basecamp <main>→<div>)
      let target = band;
      while (boxKids(target).length === 1 && boxKids(target)[0].kind === 'container') target = boxKids(target)[0];
      if (isCleanVerticalPartition(target)) {
        const kids = boxKids(target).sort((a, b) => a.box.y - b.box.y);
        for (const k of kids) recurse(k, depth + 1);
        return;
      }
      // PART B — oversized but NOT a clean partition: try a heading-led split of a same-bg band.
      const split = headingLedSplit(band);
      if (split) { for (const s of split) out.push(s); return; }
    }

    // not oversized, or no clean partition / heading split available ⇒ this band is one section.
    out.push({ band, role: 'section' });
  };

  for (const b of topBands) recurse(b, 0);
  return out;
}

// ── PART B — HEADING-LED SPLIT ──────────────────────────────────────────────────────────────────────────────
// Split an oversized SAME-BG band at heading boundaries. Build synthetic sub-bands, each starting at a heading
// leaf and running to the next heading. Apply only if it yields <=12 HETEROGENEOUS blocks; if it would yield >15
// UNIFORM blocks, keep the whole band as ONE role:'repeated-list'. Returns an array of {band, role} or null.
function headingLedSplit(band) {
  const leaves = gatherLeaves(band).sort((a, b) => a.box.y - b.box.y);
  if (!leaves.length) return null;
  const headings = leaves.filter(isHeadingNode);
  if (headings.length < 2) return null;

  // boundaries = heading y-tops; first boundary clamps to the band top so leading content isn't orphaned.
  const bands0 = boxKids(band);
  const cuts = headings.map((hd) => hd.box.y);
  cuts[0] = Math.min(cuts[0], band.box.y);
  const ends = [...cuts.slice(1), band.box.y + band.box.h];

  // group the band's DIRECT children into the synthetic slices by vertical center.
  const slices = cuts.map((y0, i) => ({ y0, y1: ends[i], kids: [] }));
  const place = (node) => {
    const cy = node.box.y + node.box.h / 2;
    let s = slices.find((sl) => cy >= sl.y0 && cy < sl.y1) || slices[slices.length - 1];
    s.kids.push(node);
  };
  bands0.forEach(place);
  const nonEmpty = slices.filter((s) => s.kids.length);
  if (nonEmpty.length < 2) return null;

  // UNIFORMITY check: would this produce a long run of near-identical-height blocks? Then it's a list — keep whole.
  const sh = nonEmpty.map((s) => s.y1 - s.y0).sort((a, b) => a - b);
  const med = sh[Math.floor(sh.length / 2)] || 1;
  const uniformCount = nonEmpty.filter((s) => Math.abs((s.y1 - s.y0) - med) <= Math.max(2, med * UNIFORM_H_TOL)).length;
  if (nonEmpty.length > LIST_KEEP_MIN && uniformCount >= nonEmpty.length * 0.8) {
    return [{ band, role: 'repeated-list' }];
  }
  // HETEROGENEITY gate: only accept a heading split that stays small (<=12 blocks).
  if (nonEmpty.length > HEADSPLIT_MAX_BLOCKS) return null;

  // synthesize a lightweight band node per slice (a pseudo-container that owns the slice's children).
  return nonEmpty.map((s) => ({
    band: {
      kind: 'container', tag: band.tag, role: band.role,
      box: { x: band.box.x, y: s.y0, w: band.box.w, h: s.y1 - s.y0 },
      background: band.background, bgSampled: band.bgSampled,
      children: s.kids,
    },
    role: 'section',
  }));
}

// EXPLICIT-MAIN UNWRAP — if a candidate band is an explicit <main>/role=main wrapper with multiple container
// children, replace it in the band list with its OWN children (the real section bands). Mirrors the separator
// rule: <main> is a landmark BOUNDARY, not a single section. Only unwrap when it actually holds >=2 sub-bands
// (else a thin <main> stays one band). Recursive single-level: one <main> → its children.
function expandBands(bands) {
  const out = [];
  for (const b of bands) {
    const kids = boxKids(b);
    if (isMainTag(b) && kids.length >= 2) { for (const k of kids) out.push(k); }
    else out.push(b);
  }
  return out;
}

// OVERLAP PRUNE — a band B fully contained within an earlier peer A's [y,y1] (>= CONT of B's height inside A)
// is a child, not a peer; drop it (its leaves get assigned to A via center-containment). Keeps the larger/earlier.
function pruneContained(bands) {
  const yr = (b) => [b.box.y, b.box.y + b.box.h];
  const keep = [];
  for (const b of bands) {
    const [by0, by1] = yr(b); const bh = Math.max(1, by1 - by0);
    let contained = false;
    for (const a of keep) {
      const [ay0, ay1] = yr(a);
      const ov = Math.max(0, Math.min(by1, ay1) - Math.max(by0, ay0));
      if (ov / bh >= 0.9 && (ay1 - ay0) > bh * 1.001) { contained = true; break; }
    }
    if (!contained) keep.push(b);
  }
  return keep;
}

// NAVFIX — reuse build-absolute detectHeaderNav's REAL-NAV signature on the TOPMOST band only. A real header nav
// is a single tight HORIZONTAL row of few link anchors. Returns true iff the band passes the NAVFIX gate.
function isRealNav(band) {
  const leaves = gatherLeaves(band);
  if (!leaves.length) return false;
  if (band.box.y > 150) return false; // not a top navigation strip
  const anchors = leaves.filter((n) => n.kind === 'button' && stripEmoji(n.text));
  if (!anchors.length) return false;
  const ay = anchors.map((n) => n.box.y);
  const anchorYSpan = Math.max(...ay) - Math.min(...ay);
  // row count: cluster anchor y-centers with a 24px tolerance (a real header is <=2 rows).
  const cy = anchors.map((n) => n.box.y + n.box.h / 2).sort((a, b) => a - b);
  let rows = 1; for (let i = 1; i < cy.length; i++) if (cy[i] - cy[i - 1] > 24) rows++;
  if (anchors.length > NAV_MAX_ITEMS || anchorYSpan > NAV_MAX_YSPAN || rows > NAV_MAX_ROWS) return false;
  return true;
}

function segment(L) {
  const VW = L.vw || 1440;
  const pageH = L.pageH || (L.root && L.root.box && L.root.box.h) || 0;
  const cr = contentRoot(L.root);

  // (1) TOP-LEVEL structural bands = direct children of the content root. These are the PRIMARY partition (the
  // <main> wrapper is still ONE band here). Nav + footer are identified on THIS list — the nav strip and the
  // <footer> are PEERS of <main>. We must classify them BEFORE unwrapping <main> AND WITHOUT main-vs-sibling
  // overlap-pruning: the <main> landmark frequently has a box that spans y=0 and GEOMETRICALLY CONTAINS the nav
  // strip (verified: supabase <main> 0..6636 contains the nav <div> 146..210), so pruning main-vs-peers would
  // wrongly delete the nav. <main> is a landmark WRAPPER to be unwrapped, never a peer to prune against.
  let top = boxKids(cr);
  top.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const mainBands = top.filter((b) => isMainTag(b));     // landmark wrappers → unwrapped into sections below
  const peerBands = top.filter((b) => !isMainTag(b));    // nav/footer/section peers of <main>

  // (2) NAV — the topmost NON-main peer band that sits at the page top and passes the NAVFIX gate (feed ONLY that
  // structurally-identified topmost peer, never a whole-tree sweep). <main> is excluded as a nav candidate.
  let navBand = null;
  if (peerBands.length && isRealNav(peerBands[0])) { navBand = peerBands.shift(); }

  // (3) FOOTER — the bottommost peer band, confirmed by an explicit <footer>/role=contentinfo (strongest).
  let footBand = null;
  if (peerBands.length) {
    const last = peerBands[peerBands.length - 1];
    if (isFooterTag(last)) { footBand = peerBands.pop(); }
  }

  // (3b) SECTION candidate bands = the remaining non-main peer bands + the unwrapped <main> children (a single
  // <main> band would otherwise collapse the whole page into one section). Sort by y0, then prune child-in-peer
  // overlaps (now safe: <main> itself is gone — only its CHILDREN are present, so no child-vs-its-own-wrapper del).
  let candidates = [...peerBands, ...expandBands(mainBands)];
  candidates.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  candidates = pruneContained(candidates);

  // (3c) THE KEYSTONE — recursively descend oversized vertical-partition wrappers (Part A), guarding uniform
  // lists (Part D) and side-by-side rows; heading-led-split oversized same-bg bands (Part B). This turns the
  // shallow direct-children partition into the REAL per-section band list.
  const resolved = resolveBands(candidates, pageH, VW);   // [{band, role}]
  let bands = resolved.map((r) => r.band);
  bands.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  bands = pruneContained(bands);
  const roleOf = new Map(resolved.map((r) => [r.band, r.role]));

  // (4) SECTIONS — the ordered bands BETWEEN nav and footer; a demoted failed-nav band lands as idx 0.
  // If the topmost band failed NAVFIX it is simply NOT the navBand and stays in `bands` → it becomes idx 0 and is
  // tagged role:'nav-demoted' when it sits at the very top of the page (y<=150) and carried nav-shaped anchors.
  const demotedTop = (!navBand && bands.length && bands[0].box.y <= 150
    && gatherLeaves(bands[0]).some((n) => n.kind === 'button' && stripEmoji(n.text))) ? bands[0] : null;

  // (5) MEMBER ASSIGNMENT — gather ALL leaves of the content root, then bucket each into nav / a section / footer
  // by VERTICAL-CENTER containment (the same center-containment the overlap edge case relies on). Nav leaves are
  // those inside the nav band; footer leaves inside the footer band; everything else goes to the section whose
  // [y0,y1] contains the leaf center (nearest by center if none strictly contains it).
  const navLeafSet = new Set(navBand ? gatherLeaves(navBand) : []);
  const footLeafSet = new Set(footBand ? gatherLeaves(footBand) : []);

  // STICKY-NAV CLAMP: a hero/first section box frequently begins a few px ABOVE the sticky nav strip (verified:
  // supabase hero starts y=96, nav strip y=146 — the nav floats over the hero's top). The nav is the TRUE top
  // band; clamp each section's reported y0 to NOT start above the nav band's top so the band ORDER is nav-first.
  // This only adjusts the section's reported top edge (its content region below the nav) — member assignment uses
  // each leaf's ORIGINAL center, so no member moves. No-op when there is no nav.
  const navTop = navBand ? round(navBand.box.y) : null;
  const sectionDefs = bands.map((b, i) => {
    let y0 = round(b.box.y);
    const y1 = round(b.box.y + b.box.h);
    if (navTop != null && y0 < navTop && y1 > navTop) y0 = navTop;   // pin under the sticky nav's top edge
    return { band: b, idx: i, y0, y1, role: b === demotedTop ? 'nav-demoted' : (roleOf.get(b) || 'section'), members: [] };
  });

  const assignToSection = (leaf) => {
    if (!sectionDefs.length) return null;
    const cyv = leaf.box.y + leaf.box.h / 2;
    let inside = sectionDefs.filter((s) => cyv >= s.y0 && cyv < s.y1);
    if (inside.length) { inside.sort((a, b) => (a.y1 - a.y0) - (b.y1 - b.y0)); return inside[0]; } // tightest container
    let best = sectionDefs[0], bd = Infinity;
    for (const s of sectionDefs) { const d = cyv < s.y0 ? s.y0 - cyv : cyv - s.y1; if (d < bd) { bd = d; best = s; } }
    return best;
  };

  const navMembers = [], footMembers = [];
  for (const leaf of gatherLeaves(cr)) {
    if (navLeafSet.has(leaf)) { navMembers.push(boxRef(leaf)); continue; }
    if (footLeafSet.has(leaf)) { footMembers.push(boxRef(leaf)); continue; }
    const s = assignToSection(leaf);
    if (s) s.members.push(boxRef(leaf));
  }

  // (PART C) GUTTER-SNAP — tile the page: each section.y1 -> next section.y0; the last section.y1 -> footer.y0
  // (or pageH) so the bands cover the page with ~no gaps. Only CLOSES gaps (never pulls a y1 backwards across its
  // own content), and never moves a section.y0 (member assignment already done by original center). Snap the FIRST
  // section.y0 down to the nav's bottom only if there is a nav above it (keeps nav-first ordering intact).
  const sd = sectionDefs.filter((s) => s.y1 > s.y0).sort((a, b) => a.y0 - b.y0);
  for (let i = 0; i < sd.length - 1; i++) {
    const next = sd[i + 1];
    if (next.y0 > sd[i].y1) sd[i].y1 = next.y0;            // close a downward gap to the next section
  }
  if (sd.length) {
    const lastY = footBand ? round(footBand.box.y) : round(pageH);
    if (lastY > sd[sd.length - 1].y1) sd[sd.length - 1].y1 = lastY;  // close the gap down to footer / page bottom
  }

  // (6) assemble output shape.
  const nav = navBand ? { bbox: { x: round(navBand.box.x), y: round(navBand.box.y), w: round(navBand.box.w), h: round(navBand.box.h) }, members: navMembers } : null;
  const sections = sectionDefs.map((s, i) => ({
    idx: i, y0: s.y0, y1: s.y1, role: s.role,
    bbox: { x: round(s.band.box.x), y: round(s.band.box.y), w: round(s.band.box.w), h: round(s.band.box.h) },
    bg: bandBg(s.band),
    members: s.members,
  }));
  const footer = footBand ? { bbox: { x: round(footBand.box.x), y: round(footBand.box.y), w: round(footBand.box.w), h: round(footBand.box.h) }, members: footMembers } : null;

  return { pageH: round(pageH), vw: VW, nav, sections, footer };
}

// ── SANITY INVARIANTS — used by both --selftest and as a reusable validator. Returns {ok, reason}. ──
function checkInvariants(seg) {
  const { pageH, nav, sections, footer } = seg;
  if (!Array.isArray(sections)) return { ok: false, reason: 'sections not an array' };
  if (sections.length < 2 || sections.length > 25) return { ok: false, reason: `section count ${sections.length} not in [2,25]` };
  // sections ordered by y0 ascending
  for (let i = 1; i < sections.length; i++) if (sections[i].y0 < sections[i - 1].y0) return { ok: false, reason: `sections not y0-ordered at idx ${i}` };
  // every band has >=1 member
  for (const s of sections) if (!s.members || s.members.length < 1) return { ok: false, reason: `section idx ${s.idx} has 0 members` };
  if (nav && (!nav.members || nav.members.length < 1)) return { ok: false, reason: 'nav has 0 members' };
  if (footer && (!footer.members || footer.members.length < 1)) return { ok: false, reason: 'footer has 0 members' };
  // build the full ordered band list [nav?, sections…, footer?]
  const bands = [];
  if (nav) bands.push({ y0: nav.bbox.y, y1: nav.bbox.y + nav.bbox.h, tag: 'nav' });
  for (const s of sections) bands.push({ y0: s.y0, y1: s.y1, tag: 'section' });
  if (footer) bands.push({ y0: footer.bbox.y, y1: footer.bbox.y + footer.bbox.h, tag: 'footer' });
  // nav (if present) at top
  if (nav) { const minY = Math.min(...bands.map((b) => b.y0)); if (nav.bbox.y > minY + 1) return { ok: false, reason: 'nav not at top' }; }
  // footer (if present) at bottom
  if (footer) { const maxY1 = Math.max(...bands.map((b) => b.y1)); if (footer.bbox.y + footer.bbox.h < maxY1 - 1) return { ok: false, reason: 'footer not at bottom' }; }
  // sort the full band list by y0 to check coverage / overlap / gaps
  const ordered = [...bands].sort((a, b) => a.y0 - b.y0);
  const tol = pageH * 0.02;     // overlap tolerance: >2% pageH overlap is a violation
  const gapTol = pageH * 0.05;  // gap tolerance: >5% pageH gap between consecutive bands is a violation
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1], cur = ordered[i];
    const overlap = prev.y1 - cur.y0;
    if (overlap > tol) return { ok: false, reason: `bands overlap ${round(overlap)}px (>2% pageH) between band ${i - 1} and ${i}` };
    const gap = cur.y0 - prev.y1;
    if (gap > gapTol) return { ok: false, reason: `gap ${round(gap)}px (>5% pageH) between band ${i - 1} and ${i}` };
  }
  // union coverage >= 90% pageH (merge ordered intervals, clamp to [0,pageH])
  let covered = 0, curStart = null, curEnd = null;
  for (const b of ordered) {
    const y0 = Math.max(0, Math.min(pageH, b.y0)), y1 = Math.max(0, Math.min(pageH, b.y1));
    if (y1 <= y0) continue;
    if (curStart === null) { curStart = y0; curEnd = y1; }
    else if (y0 <= curEnd) { curEnd = Math.max(curEnd, y1); }
    else { covered += curEnd - curStart; curStart = y0; curEnd = y1; }
  }
  if (curStart !== null) covered += curEnd - curStart;
  const coverage = pageH > 0 ? covered / pageH : 0;
  if (coverage < 0.9) return { ok: false, reason: `coverage ${(coverage * 100).toFixed(1)}% < 90%` };
  return { ok: true, coverage, sectionCount: sections.length };
}

export { segment, checkInvariants };

// ── CLI (only when run directly, never on import) ──
const isMain = (() => { try { return /(?:^|\/)segment\.mjs$/.test(process.argv[1] || ''); } catch { return false; } })();
if (isMain) {
  if (process.argv.includes('--selftest')) {
    const path = '/tmp/glob-supa.json';
    if (!fs.existsSync(path)) { console.log(`SELFTEST FAIL: missing ${path} (capture it first)`); process.exit(1); }
    let seg;
    try { const L = JSON.parse(fs.readFileSync(path, 'utf8')); seg = segment(L); }
    catch (e) { console.log('SELFTEST FAIL: ' + String(e && e.message || e)); process.exit(1); }
    const r = checkInvariants(seg);
    if (r.ok) { console.log(`SELFTEST PASS sections=${r.sectionCount} coverage=${(r.coverage * 100).toFixed(1)}%`); process.exit(0); }
    console.log('SELFTEST FAIL: ' + r.reason); process.exit(1);
  } else {
    const layoutPath = arg('layout');
    if (!layoutPath) { console.error('need --layout <captureJson>  (or --selftest)'); process.exit(2); }
    if (!fs.existsSync(layoutPath)) { console.error('layout not found: ' + layoutPath); process.exit(2); }
    const L = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
    const seg = segment(L);
    const json = process.argv.includes('--pretty') ? JSON.stringify(seg, null, 2) : JSON.stringify(seg);
    const out = arg('out');
    if (out) fs.writeFileSync(out, json);
    process.stdout.write(json + '\n');
  }
}
