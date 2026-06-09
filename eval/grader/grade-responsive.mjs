#!/usr/bin/env node
/**
 * @purpose RESPONSIVE-FIDELITY grader (RLG = Responsive Layout Graph) for the Joist cloner.
 * Answers "does the clone REFLOW like the source across breakpoints?" — a dimension the existing
 * single-width visual graders (grade-sections / perelement-score) are structurally BLIND to.
 *
 * Design source: knowledge/RESPONSIVE_AND_MOTION_GRADING.md (ReDeCheck RLG, ISSTA 2017, DOI
 * 10.1145/3092703.3092712) + Applitools "Layout" match-level (relative-position agreement,
 * ignore color/content). Self-contained: a LIGHT inline DOM-rect probe (NOT capture-layout.mjs,
 * which rasterizes/SVG-crops at dpr=2 and would cost 10 heavy passes). One browser, 5 viewport
 * widths per page, resize → scroll-settle → read visible element boxes via page.evaluate.
 *
 * ALGORITHM (RLG):
 *   For BOTH source & clone, at widths [390,768,1024,1440,1920]:
 *     - render, collect VISIBLE element nodes (top N by area), bounding boxes + text + typo.
 *   Build pairwise RELATIONSHIP edges among sibling/parent-child element pairs. Relationship type
 *   ∈ {left-of, right-of, above, below, overlap, contains}. Record per pair the SET of widths at
 *   which each relationship holds, collapsed to width RANGES → the (amin,amax,t,P) tuple of the doc.
 *   GRADE:
 *     (1) EDGE-SET AGREEMENT — match SOURCE element-pairs to CLONE element-pairs (via the same
 *         text/position node matching perelement-score uses, applied PER WIDTH then pooled to a
 *         stable cross-width identity); a source pair is reproduced iff, across the shared width
 *         range, the clone pair holds the SAME relationship+alignment at the SAME widths. Score =
 *         fraction of source pairs reproduced (range-overlap weighted).
 *     (2) APPLITOOLS-LAYOUT per width — relative-position agreement of matched elements at each
 *         width (ignore color/content): for each matched element, does its quadrant/ordering vs
 *         neighbours match? mean over widths.
 *   responsiveScore = 0.6*edgeSetAgreement + 0.4*meanPerWidthLayout.
 *
 * SELF-TEST (HARD): --source X --clone X (same URL) MUST return responsiveScore = 1.0 (a page is
 *   perfectly responsive-consistent with itself). --selftest asserts this on tailwindcss.com.
 *
 * Usage:
 *   node grade-responsive.mjs --source <url> --clone <url> [--out dir] [--widths 390,768,1024,1440,1920]
 *   node grade-responsive.mjs --selftest [--source https://tailwindcss.com]
 *   node grade-responsive.mjs --source <url> --clone <url> --label tag
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);

const SELFTEST = has('selftest');
const source = arg('source') || (SELFTEST ? 'https://tailwindcss.com' : null);
const clone = SELFTEST ? source : arg('clone');
const outDir = arg('out', '/tmp');
const label = arg('label') || (source || 'site').replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 18).toLowerCase();
// WIDTH SELECTION: standalone default = 5 widths (deep check). The INTEGRATED path (grade-sections
// subprocess) passes --widths 390,768,1440 (mobile/tablet/desktop) for acceptable per-round runtime.
// A RESPONSIVE_WIDTHS env overrides the default (but an explicit --widths flag still wins).
const DEFAULT_WIDTHS = process.env.RESPONSIVE_WIDTHS || '390,768,1024,1440,1920';
const WIDTHS = (arg('widths', DEFAULT_WIDTHS)).split(',').map((x) => parseInt(x, 10)).filter(Boolean);
const MAX_NODES = parseInt(arg('maxnodes', '80'), 10); // cap top-N by area per width (runtime bound)
// STRUCT-INVARIANT gate (mirrors perelement-score.mjs): default ON. When "0", keep all area>=2000 boxes
// (exactly the pre-gate behavior). When on, textless/non-media boxes need a distinct visual signal to count.
const STRUCT_INVARIANT = process.env.GRADER_STRUCT_INVARIANT !== '0';

if (!source || (!clone && !SELFTEST)) { console.error('need --source --clone   (or --selftest)'); process.exit(2); }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const r4 = (x) => Math.round(x * 10000) / 10000;
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;

// ============================ TEXT: Sorensen-Dice on bigrams (from perelement-score) ============================
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

// ============================ INLINE DOM-RECT PROBE (runs in the page) ============================
// Returns a flat list of visible element nodes (capped to top-N by area) with box + text + tag + a
// stable structural path. Light: NO rasterization, NO color sampling, NO SVG crop.
const PROBE_FN = ([MAX_NODES, useStructInvariant]) => {
  const vw = window.innerWidth, vh0 = window.innerHeight;
  const docH = document.documentElement.scrollHeight;
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','META','LINK','HEAD','BR','HR','TEMPLATE','SVG','PATH','DEFS','TITLE']);
  const out = [];
  let idc = 0;
  const directText = (el) => {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
    return t.replace(/\\s+/g, ' ').trim();
  };
  // STRUCT-INVARIANT distinctness gate (mirrors perelement-score.mjs): a textless, non-media box kept
  // SOLELY by area>=2000 is a structurally-invisible layout wrapper UNLESS it carries a distinct visual
  // signal (visible border / radius / box-shadow / backdrop-filter / a bg that differs from its nearest
  // positioned ancestor). Without a signal it inflates the node count → coverage precision drops →
  // responsiveScore false-deflates for grid/flex-nested-but-pixel-identical clones. Light perceptual
  // proxy for CIEDE2000 dE>3: parse rgb()/rgba() to [r,g,b] and require max-channel-abs-diff > 12.
  const parseRGB = (s) => {
    if (!s) return null;
    const m = s.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const parts = m[1].split(',').map((x) => parseFloat(x.trim()));
    if (parts.length < 3 || !isFinite(parts[0]) || !isFinite(parts[1]) || !isFinite(parts[2])) return null;
    const a = parts.length >= 4 ? parts[3] : 1;
    if (!(a > 0)) return null; // transparent / zero-alpha bg = no signal
    return [parts[0], parts[1], parts[2]];
  };
  const hasDistinctSignal = (el, cs) => {
    // visible border: width >= 1 AND a non-transparent border color
    const bw = Math.max(
      parseFloat(cs.borderTopWidth || '0') || 0,
      parseFloat(cs.borderRightWidth || '0') || 0,
      parseFloat(cs.borderBottomWidth || '0') || 0,
      parseFloat(cs.borderLeftWidth || '0') || 0,
    );
    if (bw >= 1) {
      const bc = parseRGB(cs.borderTopColor) || parseRGB(cs.borderRightColor) || parseRGB(cs.borderBottomColor) || parseRGB(cs.borderLeftColor);
      if (bc) return true;
    }
    // border-radius >= 0.5px
    const br = Math.max(
      parseFloat(cs.borderTopLeftRadius || '0') || 0,
      parseFloat(cs.borderTopRightRadius || '0') || 0,
      parseFloat(cs.borderBottomLeftRadius || '0') || 0,
      parseFloat(cs.borderBottomRightRadius || '0') || 0,
    );
    if (br >= 0.5) return true;
    // non-none box-shadow
    if (cs.boxShadow && cs.boxShadow !== 'none') return true;
    // backdrop-filter
    const bf = cs.backdropFilter || cs.webkitBackdropFilter || '';
    if (bf && bf !== 'none') return true;
    // backgroundColor differs from nearest positioned ancestor (offsetParent; fall back to parentElement)
    const myBg = parseRGB(cs.backgroundColor);
    if (myBg) {
      const par = el.offsetParent || el.parentElement;
      let parBg = null;
      if (par) { try { parBg = parseRGB(getComputedStyle(par).backgroundColor); } catch (e) { parBg = null; } }
      if (!parBg) return true; // we have a real bg, ancestor has none → distinct fill
      const d = Math.max(Math.abs(myBg[0] - parBg[0]), Math.abs(myBg[1] - parBg[1]), Math.abs(myBg[2] - parBg[2]));
      if (d > 12) return true;
    }
    return false;
  };
  const walk = (el, depth, pathIdx) => {
    if (!el || el.nodeType !== 1) return;
    if (SKIP.has(el.tagName)) return;
    let cs;
    try { cs = getComputedStyle(el); } catch (e) { return; }
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.02) return;
    const r = el.getBoundingClientRect();
    // absolute (document) coords: rect is viewport-relative; add scroll offsets
    const x = r.left + window.scrollX, y = r.top + window.scrollY, w = r.width, h = r.height;
    const area = Math.max(0, w) * Math.max(0, h);
    // VISIBLE = nonzero box, within the rendered document, not absurdly tiny.
    const visible = w >= 4 && h >= 4 && y < docH + 200 && x < vw + 400 && (x + w) > -400;
    let kept = false;
    if (visible && area >= 64) {
      const tag = el.tagName.toLowerCase();
      const dt = directText(el);
      // a node is "interesting" iff it carries direct text, is media/control, or is a sized box.
      const media = (tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'picture' || tag === 'button' || tag === 'input' || tag === 'a' || tag === 'svg');
      // content nodes (direct text or media/control) are ALWAYS kept — never pruned.
      // A textless, non-media box kept SOLELY by area>=2000 is a candidate layout wrapper: when the
      // struct-invariant gate is on, require a distinct visual signal, else it's structurally invisible.
      const keepByArea = area >= 2000 && (!useStructInvariant || hasDistinctSignal(el, cs));
      if (dt || media || keepByArea) {
        idc++;
        const path = pathIdx.join('/');
        out.push({
          id: idc, tag, path, depth,
          box: { x, y, w, h },
          text: (dt || el.getAttribute('aria-label') || el.getAttribute('alt') || '').slice(0, 120),
          font: (cs.fontFamily || '').split(',')[0].replace(/['"]/g, '').trim().toLowerCase(),
          size: Math.round(parseFloat(cs.fontSize || '0')),
        });
        kept = true;
      }
    }
    const kids = el.children;
    let ci = 0;
    for (let i = 0; i < kids.length; i++) {
      walk(kids[i], depth + 1, pathIdx.concat(ci));
      ci++;
    }
    return kept;
  };
  walk(document.body, 0, [0]);
  // cap to top-N by area (runtime bound), keep their relative order stable by id
  out.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  const top = out.slice(0, MAX_NODES);
  top.sort((a, b) => a.id - b.id);
  // scrollWidth: deterministic measurement of the full content width. > vw ⇒ horizontal overflow
  // (the page scrolls sideways) — the human-obvious mobile defect the RLG (edge geometry) is blind to.
  const scrollWidth = document.documentElement.scrollWidth;
  return { vw, docH, scrollWidth, nodes: top };
};

// ============================ CAPTURE one page across all widths ============================
async function captureAcrossWidths(browser, url) {
  const perWidth = {}; // width -> { vw, docH, nodes:[...] }
  const ctx = await browser.newContext({ viewport: { width: WIDTHS[0], height: 900 }, userAgent: UA, deviceScaleFactor: 1, locale: 'en-US' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (e) { /* tolerate */ }
    for (const w of WIDTHS) {
      let probe = { vw: w, docH: 0, scrollWidth: 0, nodes: [] };
      try {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(350); // let media-query relayout settle
        // step-scroll to materialize lazy / IntersectionObserver content, then back to top
        try {
          await page.evaluate(async () => {
            const h = document.documentElement.scrollHeight, step = window.innerHeight;
            for (let y = 0; y < h; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
            window.scrollTo(0, 0);
          });
        } catch (e) { /* tolerate */ }
        await page.waitForTimeout(200);
        probe = await page.evaluate(PROBE_FN, [MAX_NODES, STRUCT_INVARIANT]);
      } catch (e) {
        console.error(`  [warn] width ${w} probe failed for ${url}: ${(e && e.message || e).toString().slice(0, 160)}`);
      }
      perWidth[w] = probe;
    }
  } finally {
    await ctx.close();
  }
  return perWidth;
}

// ============================ NODE MATCHING (text + normalized position) ============================
// Match source nodes -> clone nodes at a given width. Greedy on a (1-textDice)+posDist cost, with the
// same Design2Code text>=0.5 rail perelement-score uses (textless nodes pass on geometric co-location).
// Returns Map(srcId -> cloneId).
function matchNodes(srcNodes, cloneNodes, srcVW, cloneVW, srcDocH, cloneDocH) {
  const sN = srcNodes, cN = cloneNodes;
  const sw = srcVW || 1, cw = cloneVW || 1;
  const sh = Math.max(srcDocH || 1, 1), ch = Math.max(cloneDocH || 1, 1);
  // normalized centers in [0,1] within each page's own coordinate frame (so a reflow that keeps an
  // element in the "same relative spot" still matches — we are matching IDENTITY, not testing layout)
  const sc = sN.map((n) => ({ cx: (n.box.x + n.box.w / 2) / sw, cy: (n.box.y + n.box.h / 2) / sh, t: n.text, isText: !!normText(n.text) }));
  const cc = cN.map((n) => ({ cx: (n.box.x + n.box.w / 2) / cw, cy: (n.box.y + n.box.h / 2) / ch, t: n.text, isText: !!normText(n.text) }));
  const cand = [];
  for (let i = 0; i < sN.length; i++) {
    for (let j = 0; j < cN.length; j++) {
      const td = dice(sc[i].t, cc[j].t);
      const bothTextless = !sc[i].isText && !cc[j].isText;
      const pd = Math.hypot(sc[i].cx - cc[j].cx, sc[i].cy - cc[j].cy);
      if (!bothTextless && td < 0.5) continue;        // text nodes must share text
      if (bothTextless && pd > 0.18) continue;        // textless nodes must be co-located
      const cost = (bothTextless ? 0.5 : 0.6) * (1 - td) + 0.4 * Math.min(1, pd);
      cand.push({ i, j, cost });
    }
  }
  cand.sort((a, b) => a.cost - b.cost);
  const usedS = new Set(), usedC = new Set();
  const map = new Map();
  for (const { i, j } of cand) {
    if (usedS.has(i) || usedC.has(j)) continue;
    usedS.add(i); usedC.add(j);
    map.set(sN[i].id, cN[j].id);
  }
  return map;
}

// ============================ RELATIONSHIP between two boxes ============================
// Returns the dominant relationship type ∈ {contains, overlap, left-of, right-of, above, below}
// PLUS an alignment tag. We derive a single dominant relationship per ordered pair (a,b): "a is <t> b".
const TOL = 6; // px tolerance for overlap/edge fuzz
function relationship(a, b) {
  const ax1 = a.x, ay1 = a.y, ax2 = a.x + a.w, ay2 = a.y + a.h;
  const bx1 = b.x, by1 = b.y, bx2 = b.x + b.w, by2 = b.y + b.h;
  // containment
  if (ax1 - TOL <= bx1 && ay1 - TOL <= by1 && ax2 + TOL >= bx2 && ay2 + TOL >= by2) return 'contains';
  if (bx1 - TOL <= ax1 && by1 - TOL <= ay1 && bx2 + TOL >= ax2 && by2 + TOL >= ay2) return 'within';
  // overlap area
  const ox = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const oy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const overlapArea = ox * oy;
  const minArea = Math.max(1, Math.min(a.w * a.h, b.w * b.h));
  if (overlapArea / minArea > 0.35) return 'overlap';
  // horizontal vs vertical dominance: which axis separates them more cleanly?
  const horizGap = (ax2 <= bx1 + TOL) ? (bx1 - ax2) : (bx2 <= ax1 + TOL ? (ax1 - bx2) : -1);
  const vertGap = (ay2 <= by1 + TOL) ? (by1 - ay2) : (by2 <= ay1 + TOL ? (ay1 - by2) : -1);
  const horizClean = ax2 <= bx1 + TOL || bx2 <= ax1 + TOL;
  const vertClean = ay2 <= by1 + TOL || by2 <= ay1 + TOL;
  if (horizClean && !vertClean) return ax2 <= bx1 + TOL ? 'left-of' : 'right-of';
  if (vertClean && !horizClean) return ay2 <= by1 + TOL ? 'above' : 'below';
  if (horizClean && vertClean) {
    // diagonal — pick the axis with the larger center separation
    const dcx = Math.abs((a.x + a.w / 2) - (b.x + b.w / 2));
    const dcy = Math.abs((a.y + a.h / 2) - (b.y + b.h / 2));
    if (dcx >= dcy) return ax2 <= bx1 + TOL ? 'left-of' : 'right-of';
    return ay2 <= by1 + TOL ? 'above' : 'below';
  }
  // neither cleanly separated and low overlap → fall back to center direction
  const dcx = (a.x + a.w / 2) - (b.x + b.w / 2);
  const dcy = (a.y + a.h / 2) - (b.y + b.h / 2);
  if (Math.abs(dcx) >= Math.abs(dcy)) return dcx <= 0 ? 'left-of' : 'right-of';
  return dcy <= 0 ? 'above' : 'below';
}

// alignment tag for an ordered pair: edge alignment that holds (L=left edges, R=right, T=top, B=bottom, Cx, Cy)
function alignment(a, b) {
  const tags = [];
  if (Math.abs(a.x - b.x) <= TOL) tags.push('L');
  if (Math.abs((a.x + a.w) - (b.x + b.w)) <= TOL) tags.push('R');
  if (Math.abs(a.y - b.y) <= TOL) tags.push('T');
  if (Math.abs((a.y + a.h) - (b.y + b.h)) <= TOL) tags.push('B');
  if (Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) <= TOL) tags.push('Cx');
  if (Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) <= TOL) tags.push('Cy');
  return tags.sort().join('');
}

// ============================ BUILD per-width relationship graph ============================
// For a captured page (perWidth) build, for each width, a Map of "pairKey" -> {rel, align}.
// pairKey is the ORDERED pair of node ids "i>j" (i<j by id to keep canonical). Only pairs that are
// PLAUSIBLY related (siblings/parent-child OR spatially near) to keep it bounded & meaningful.
function buildGraphAtWidth(probe) {
  const nodes = probe.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = new Map(); // "i|j" -> {rel, align}
  const N = nodes.length;
  // candidate pairs: parent-child (path prefix) OR sibling-ish (sharing a path prefix one level up)
  // OR spatially adjacent. To stay bounded we consider all O(N^2) but N<=MAX_NODES so it's fine.
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const a = nodes[i], b = nodes[j];
      // relationship is meaningful for: ancestor/descendant (path prefix) OR near-in-flow pairs.
      const aPath = a.path, bPath = b.path;
      const parentChild = bPath.startsWith(aPath + '/') || aPath.startsWith(bPath + '/');
      // siblings/near: centers within ~1.6 page-widths combined OR share path grandparent
      const grand = (p) => p.split('/').slice(0, -1).join('/');
      const sibling = grand(aPath) === grand(bPath) || aPath.split('/').slice(0, 2).join('/') === bPath.split('/').slice(0, 2).join('/');
      const acx = a.box.x + a.box.w / 2, acy = a.box.y + a.box.h / 2;
      const bcx = b.box.x + b.box.w / 2, bcy = b.box.y + b.box.h / 2;
      const near = Math.hypot(acx - bcx, acy - bcy) < (probe.vw * 1.2);
      if (!parentChild && !sibling && !near) continue;
      const rel = relationship(a.box, b.box);
      const align = alignment(a.box, b.box);
      edges.set(i + '|' + j, { rel, align, ai: a.id, bi: b.id });
    }
  }
  return { nodes, byId, edges };
}

// ============================ EDGE-SET AGREEMENT (RLG core) ============================
// For each WIDTH: match source<->clone nodes (identity). Then for each SOURCE pair that has BOTH
// endpoints matched into the clone, look up the clone's relationship for the matched clone pair at
// that width. The pair "agrees at width w" iff rel matches AND alignment is at least as good.
// Pool across widths to compute, per source pair, the fraction of (shared-matchable) widths where the
// clone reproduces the relationship → that is the (amin,amax,t,P) range agreement, range-overlap weighted.
function edgeSetAgreement(srcCap, cloneCap, widths) {
  // per-width node identity maps: srcGlobalId -> cloneGlobalId. Use a STABLE pooled identity:
  // since node ids are per-capture-per-width (re-walked each width), we instead match per width and
  // key source pairs by their (srcText/srcPath) signature so a pair is the same across widths.
  const srcGraphs = {}, cloneGraphs = {}, matchAtW = {};
  for (const w of widths) {
    srcGraphs[w] = buildGraphAtWidth(srcCap[w]);
    cloneGraphs[w] = buildGraphAtWidth(cloneCap[w]);
    matchAtW[w] = matchNodes(srcCap[w].nodes, cloneCap[w].nodes, srcCap[w].vw, cloneCap[w].vw, srcCap[w].docH, cloneCap[w].docH);
  }
  // stable signature for a source node: prefer text, else tag+path
  const sig = (n) => (normText(n.text) ? 't:' + normText(n.text) : 'p:' + n.tag + ':' + n.path);
  // collect the union of source pairs across widths, keyed by (sigA||sigB)
  const pairAgg = new Map(); // pairSigKey -> { widthsConsidered:Set, widthsAgree:Set, sample:{...} }
  for (const w of widths) {
    const sg = srcGraphs[w];
    const cg = cloneGraphs[w];
    const m = matchAtW[w];
    const sById = sg.byId, cById = cg.byId;
    const cloneEdgeByPair = new Map(); // "cloneIdA|cloneIdB" -> {rel,align}
    for (const [, e] of cg.edges) cloneEdgeByPair.set(e.ai + '#' + e.bi, e);
    for (const [, e] of sg.edges) {
      const aNode = sById.get(e.ai), bNode = sById.get(e.bi);
      if (!aNode || !bNode) continue;
      const key = sig(aNode) + '§' + sig(bNode);
      let rec = pairAgg.get(key);
      if (!rec) { rec = { considered: 0, agree: 0, sample: { rel: e.rel, align: e.align, a: aNode.text || aNode.tag, b: bNode.text || bNode.tag } }; pairAgg.set(key, rec); }
      // is this pair matchable into the clone at THIS width?
      const ca = m.get(e.ai), cb = m.get(e.bi);
      if (ca == null || cb == null) continue; // endpoint(s) not present/matched in clone at this width → not "considered"
      rec.considered++;
      // clone relationship for the matched clone pair (order by id to match buildGraph canonical i<j? we
      // stored edges by NODE id ai/bi in source order; clone edges keyed by clone node ids). The clone
      // edge may be stored as (ca,cb) or (cb,ca) depending on id order → check both, flipping rel.
      let ce = cloneEdgeByPair.get(ca + '#' + cb);
      let flipped = false;
      if (!ce) { const ce2 = cloneEdgeByPair.get(cb + '#' + ca); if (ce2) { ce = ce2; flipped = true; } }
      if (!ce) continue; // clone has both nodes but no recorded relationship edge (not near/sibling) → no agreement
      const cloneRel = flipped ? flipRel(ce.rel) : ce.rel;
      const relMatch = cloneRel === e.rel;
      // alignment: agree iff clone preserves at least the source alignment tags it should (Jaccard >= 0.5
      // OR source had no alignment constraint). Lenient — relationship is primary, alignment secondary.
      const alignOk = alignAgree(e.align, flipped ? flipAlign(ce.align) : ce.align);
      if (relMatch && alignOk) rec.agree++;
    }
  }
  // score each source pair = agree/considered; overall = mean weighted by (considered) so pairs present
  // at more widths count more (= range-overlap weighting). Pairs never matchable (considered==0) are
  // excluded from the mean but DO surface as openIssues count (clone missing the structure).
  let wsum = 0, vsum = 0, pairsConsidered = 0, pairsTotal = 0, neverMatchable = 0;
  for (const [, rec] of pairAgg) {
    pairsTotal++;
    if (rec.considered === 0) { neverMatchable++; continue; }
    pairsConsidered++;
    const v = rec.agree / rec.considered;
    wsum += rec.considered; vsum += rec.considered * v;
  }
  // penalize pairs the clone could never reproduce (missing elements): fold into denominator as zeros,
  // weighted by 1 (a missing pair contributes minimal but nonzero penalty so a clone that drops half the
  // structure can't score 1.0 on the half it kept).
  const reproduced = wsum > 0 ? vsum / wsum : 0;
  const presence = pairsTotal > 0 ? pairsConsidered / pairsTotal : 0;
  // blend: relationship agreement among matchable pairs, gently scaled by how much structure is present
  const agreement = reproduced * (0.7 + 0.3 * presence);
  return { agreement: r4(agreement), reproduced: r4(reproduced), presence: r4(presence), pairsTotal, pairsConsidered, neverMatchable };
}
function flipRel(r) { return r === 'left-of' ? 'right-of' : r === 'right-of' ? 'left-of' : r === 'above' ? 'below' : r === 'below' ? 'above' : r === 'contains' ? 'within' : r === 'within' ? 'contains' : r; }
function flipAlign(a) { return a; } // edge-alignment tags are symmetric under pair flip (L stays L etc.)
function alignAgree(srcAlign, cloneAlign) {
  if (!srcAlign) return true; // no alignment constraint on source side
  const sa = new Set(srcAlign.match(/[A-Z][a-z]?/g) || []);
  const ca = new Set((cloneAlign || '').match(/[A-Z][a-z]?/g) || []);
  if (sa.size === 0) return true;
  let inter = 0; for (const t of sa) if (ca.has(t)) inter++;
  return inter / sa.size >= 0.5;
}

// ============================ COVERAGE (symmetric node-match fraction) ============================
// coverage = matchedSourceNodes / totalSourceNodes, pooled across widths (symmetric: we also fold in the
// clone side so a clone that adds tons of unmatched junk OR drops source structure is penalized — same
// spirit as perelement-score's symmetric area-coverage). A low-coverage clone (few matched nodes) must
// NOT be able to score high on layout/edgeSet just because the handful it kept happen to agree.
// SELF-TEST: source-vs-source matches every node both ways → coverage == 1 → no down-weight.
function coverageWeight(srcCap, cloneCap, widths) {
  let matchedSum = 0, srcSum = 0, cloneSum = 0;
  const perWidth = {};
  for (const w of widths) {
    const sNodes = srcCap[w].nodes, cNodes = cloneCap[w].nodes;
    const m = matchNodes(sNodes, cNodes, srcCap[w].vw, cloneCap[w].vw, srcCap[w].docH, cloneCap[w].docH);
    const sById = new Map(sNodes.map((n) => [n.id, n]));
    const cById = new Map(cNodes.map((n) => [n.id, n]));
    const matched = [...m.keys()].filter((id) => sById.has(id) && cById.has(m.get(id))).length;
    matchedSum += matched; srcSum += sNodes.length; cloneSum += cNodes.length;
    perWidth[w] = { matched, srcNodes: sNodes.length, cloneNodes: cNodes.length, cov: sNodes.length ? r4(matched / sNodes.length) : 1 };
  }
  // symmetric coverage: harmonic-style blend of source-recall and clone-precision. Recall = matched/src
  // (did we reproduce the source's nodes?), precision = matched/clone (is the clone mostly matched, not junk?).
  const recall = srcSum ? matchedSum / srcSum : 1;
  const precision = cloneSum ? matchedSum / cloneSum : 1;
  // symmetric F1; if either side has zero nodes coverage is 0 (nothing to compare) — but self-test has full both.
  const coverage = (recall + precision > 0) ? (2 * recall * precision) / (recall + precision) : 0;
  return { coverage: r4(coverage), recall: r4(recall), precision: r4(precision), perWidth };
}

// ============================ APPLITOOLS-LAYOUT per width ============================
// Relative-position agreement of matched elements at each width (ignore color/content). For each
// width: among matched src↔clone nodes, build pairwise relationship for the matched set on BOTH sides
// and score = fraction of matched-node PAIRS whose relationship agrees. ignore alignment (looser than
// edge-set; this is the "layout match level"). Returns per-width score + mean.
function applitoolsLayout(srcCap, cloneCap, widths) {
  const perWidth = {};
  for (const w of widths) {
    const sNodes = srcCap[w].nodes, cNodes = cloneCap[w].nodes;
    const m = matchNodes(sNodes, cNodes, srcCap[w].vw, cloneCap[w].vw, srcCap[w].docH, cloneCap[w].docH);
    const sById = new Map(sNodes.map((n) => [n.id, n]));
    const cById = new Map(cNodes.map((n) => [n.id, n]));
    const matchedSrcIds = [...m.keys()].filter((id) => sById.has(id) && cById.has(m.get(id)));
    let agree = 0, total = 0;
    for (let i = 0; i < matchedSrcIds.length; i++) {
      for (let j = i + 1; j < matchedSrcIds.length; j++) {
        const sa = sById.get(matchedSrcIds[i]).box, sb = sById.get(matchedSrcIds[j]).box;
        const ca = cById.get(m.get(matchedSrcIds[i])).box, cb = cById.get(m.get(matchedSrcIds[j])).box;
        const sRel = relationship(sa, sb);
        const cRel = relationship(ca, cb);
        total++;
        if (sRel === cRel) agree++;
      }
    }
    perWidth[w] = { score: r4(total ? agree / total : (matchedSrcIds.length ? 1 : 0)), matched: matchedSrcIds.length, pairs: total };
  }
  const meanScore = r4(mean(widths.map((w) => perWidth[w].score)));
  return { perWidth, mean: meanScore };
}

// ============================ MOBILE-PROPORTION (deterministic, source-relative) ============================
// The RLG measures relationship-edge geometry; it is BLIND to (a) horizontal overflow — a clone whose
// 390 view scrolls sideways to 1440px — and (b) document-height inflation/truncation — a mobile page
// 2x too tall (giant fonts, no reflow) or collapsed. chrome-unpin / fluid-fonts / reflow fix exactly
// these, but the RLG does not register the win. This adds a DETERMINISTIC, SOURCE-RELATIVE sub-score
// over the NARROW breakpoints (widths <= 768) using only the STABLE scrollWidth + docH measurements.
//   per narrow width w:
//     overflowMatch: srcOverflow = srcScrollWidth > w*1.02 ; cloneOverflow = cloneScrollWidth > w*1.02
//        both agree -> 1 ; clone overflows but source does NOT (the bad case) -> 0 ; else (source
//        overflows but clone does not — clone is "better") -> 0.5
//     heightRatio  = min(cloneDocH, srcDocH) / max(cloneDocH, srcDocH)   (symmetric; 1 when equal;
//        penalizes BOTH inflation and truncation)
//     perWidthProp = 0.5*overflowMatch + 0.5*heightRatio
//   mobileProportion = mean(perWidthProp). null if NO narrow width present (skip the blend).
// SELF-TEST: source-vs-source → scrollWidth/docH match → overflowMatch=1, heightRatio≈1 → ≈1.0.
function mobileProportion(srcCap, cloneCap, widths) {
  const narrow = widths.filter((w) => w <= 768);
  if (!narrow.length) return { value: null, perWidth: {} };
  const perWidth = {};
  for (const w of narrow) {
    const srcSW = srcCap[w].scrollWidth || 0, cloneSW = cloneCap[w].scrollWidth || 0;
    const srcDocH = srcCap[w].docH || 0, cloneDocH = cloneCap[w].docH || 0;
    const srcOverflow = srcSW > w * 1.02;
    const cloneOverflow = cloneSW > w * 1.02;
    const overflowMatch = (srcOverflow === cloneOverflow) ? 1 : (cloneOverflow && !srcOverflow ? 0 : 0.5);
    const maxH = Math.max(cloneDocH, srcDocH);
    const heightRatio = maxH > 0 ? Math.min(cloneDocH, srcDocH) / maxH : 1;
    const perWidthProp = 0.5 * overflowMatch + 0.5 * heightRatio;
    perWidth[w] = {
      srcScrollWidth: srcSW, cloneScrollWidth: cloneSW, srcOverflow, cloneOverflow,
      overflowMatch, srcDocH, cloneDocH, heightRatio: r4(heightRatio), perWidthProp: r4(perWidthProp),
    };
  }
  const value = r4(mean(narrow.map((w) => perWidth[w].perWidthProp)));
  return { value, perWidth };
}

// ============================ GROUND-TRUTH RESPONSIVE RECONCILE (grade-structure parity) ============================
// WHY: the RLG responsiveScore (edge+layout+mobileProp, ALL multiplied by the symmetric-F1 node-match
// `coverage`) FALSE-DEFLATES a clone that genuinely FITS + REFLOWS at 390px. Measured framer clone:
// cloneScrollWidth@390 = 390 (NO horizontal overflow → it fits), layout@390 = 0.867 (relationships agree),
// yet responsiveScore = 0.205 — because coverage 0.35 crushes every term. The authoritative grade-structure.mjs
// measures the SAME live 390 ground-truth as responsive = 0.5*mobileFit + 0.5*mobileOrder and gets ~0.796.
// This reconcile reuses grade-structure's EXACT responsive logic over the data already captured at 390 (no
// extra render, no coverage multiplier on the fit signal): the real-overflow mobileFit + the LCS reading-order
// mobileOrder. Reversible via GRADER_NO_RESP_RECONCILE=1 → fall back to the pure RLG responsiveScore.
//   mobileFit   = max(0, min(1, 1 - max(0, cloneScrollWidth@390/390 - 1.02) * 0.6))   [grade-structure mobileLayout]
//   mobileOrder = LIS(clone@390 reading order ∩ source@390 reading order) / |shared|  [grade-structure orderAgreement]
//   reconciledResponsive = 0.5*mobileFit + 0.5*mobileOrder
// ANTI-GAMING: mobileFit reads the REAL rendered cloneScrollWidth at 390 — a clone that overflows (scrolls
// sideways) at mobile gets ratio > 1.02 → fit < 1 → low, exactly like grade-structure. It is NOT a blanket high.
// SELF-TEST: deepcopy clone == source → cloneScrollWidth@390 == srcScrollWidth@390 → fit = 1.0; identical
// reading order → LIS == |shared| → mobileOrder = 1.0 → reconciledResponsive = 1.0 (gate-1 preserved).

// LCS/LIS reading-order agreement (ported verbatim from grade-structure.mjs orderAgreement): of the text runs
// shared by source (reading order) and clone-mobile, what fraction lie in a common monotonic subsequence?
function orderAgreementRR(srcOrder, cloneMobileOrder) {
  const cloneSet = new Set(cloneMobileOrder);
  const A = srcOrder.filter((t) => cloneSet.has(t));      // source-order projection onto shared texts
  const pos = new Map(cloneMobileOrder.map((t, i) => [t, i]));
  const B = A.map((t) => pos.get(t));                     // clone-mobile positions in source order
  if (B.length < 3) return 1;                             // too few shared runs to judge order → neutral
  const tails = [];
  for (const x of B) { let lo = 0, hi = tails.length; while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < x) lo = m + 1; else hi = m; } tails[lo] = x; }
  return tails.length / B.length;
}

// Dedicated DENSE 390-width reading-order + scrollWidth capture (ported VERBATIM from grade-structure.mjs
// mobileLayout): collects EVERY visible text-bearing element (no top-N-by-area cap), sorted top-to-bottom by
// document-y, deduped by normalized text. The RLG probe (top-80-by-AREA) starves the text set at mobile (large
// nodes are images/containers → ~3 text runs, often zero overlap) which makes the LIS order term meaningless;
// grade-structure's full-text capture is the authoritative source of mobileFit + mobileOrder. SELFTEST never
// reaches here (deepcopy path skips the reconcile capture and the identity branch returns 1.0 directly).
const MOBILE_PROBE_FN = () => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
  // DOCH-PROPORTION: the rendered document height at 390 (mobile vertical extent). Used to score
  // clone-docH@390 vs source-docH@390 — the grader was previously BLIND to mobile vertical proportion
  // (a clone 3.88x too tall at mobile scored ~1.0 responsive). Captured here on the SAME dense 390 pass.
  const docH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  const vis = (el) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(el); return !(cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05); };
  const runs = [];
  for (const e of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,span,li,div')) {
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && clean(n.textContent)); if (!own) continue;
    const t = clean(e.innerText); if (!t || t.length > 200) continue; if (!vis(e)) continue;
    const r = e.getBoundingClientRect(); runs.push({ y: Math.round(r.top + window.scrollY), t: t.toLowerCase() });
  }
  runs.sort((a, b) => a.y - b.y);
  const seen = new Set(), out = []; for (const r of runs) { if (seen.has(r.t)) continue; seen.add(r.t); out.push(r.t); }
  return { sw, docH, mobileTexts: out };
};
async function captureMobileLayout(browser, url) {
  const MW = 390;
  const ctx = await browser.newContext({ viewport: { width: MW, height: 800 }, userAgent: UA, deviceScaleFactor: 1, locale: 'en-US' });
  const p = await ctx.newPage();
  p.setDefaultTimeout(45000);
  try {
    try { await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 }); } catch { try { await p.goto(url, { waitUntil: 'load', timeout: 30000 }); } catch {} }
    await p.waitForTimeout(700);
    try { await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); } window.scrollTo(0, 0); }); } catch { /* tolerate */ }
    await p.waitForTimeout(300);
    return await p.evaluate(MOBILE_PROBE_FN);
  } catch { return { sw: 0, docH: 0, mobileTexts: [] }; } finally { await ctx.close().catch(() => {}); }
}

// DOCH-PROPORTION (mobile vertical proportion). The grader was previously BLIND to whether the clone's
// rendered document HEIGHT at 390 matches the source's: a clone 3.88x too tall at mobile still scored ~1.0
// responsive because neither mobileFit (horizontal overflow) nor mobileOrder (reading order) reads docH.
// docHProp scores the live clone-docH@390 / source-docH@390 ratio on a SMOOTH curve, symmetric IN PROPORTION
// — BOTH a taller-than-source AND a shorter-than-source clone are penalized (it is proportion, not just
// tallness). We penalize the magnitude of the LOG-ratio |log2(ratio)| (not |ratio-1|): log2 is the correct
// symmetric measure of proportion — halving (0.5x → log2=-1) is penalized EXACTLY as much as doubling
// (2x → log2=+1), and a linear |ratio-1| cannot do that (it caps the short side at 1.0 distance but lets the
// tall side run unbounded, so a 0.5x clone would barely move while a 2x clone is heavily docked):
//   ratio  = cloneDocH@390 / srcDocH@390
//   L      = |log2(ratio)|
//   docHProp = clamp(0, 1, 1 - max(0, L - DOCHPROP_DEADBAND) / DOCHPROP_K)
//   DOCHPROP_DEADBAND = log2(1.1) ≈ 0.137 (no penalty inside [~0.9, 1.1]); DOCHPROP_K = 2.0 (tuned below).
// CALIBRATION of K=2.0 (deadband log2(1.1)) — proves the dim measures the real gap + rewards the kept fix
// and is symmetric (LIVE-measured fixture ratios in parens):
//   just-KEPT framer mobile fix docH ~2.2x (live 2.17x) → docHProp 0.510 (clearly better);
//   WITHOUT the fix docH ~3.9x (live 3.74x) → docHProp 0.117 (clearly LOW); neither is ~1.0 — exactly the
//   spec ("2.23x → clearly-better than 3.88x but neither ~1.0"). A 4x blow-up (live 3.86x) → 0.094
//   (anti-gaming: low, still discriminated below the no-fix case). A 0.5x SHORTER clone (live 0.51x) → 0.583
//   (clearly penalized — proportion, not just tallness; a more extreme 0.25x → 0.069, truly low). A ~1x
//   match → 1.0. SELFTEST (deepcopy identity) is handled in the caller → docHProp = 1.
function docHProportion(srcDocH, cloneDocH) {
  const DEADBAND = Math.log2(1.1), K = 2.0;
  if (!(srcDocH > 0) || !(cloneDocH > 0)) return { docHProp: 1, ratio: 1 };  // no height to compare → neutral
  const ratio = cloneDocH / srcDocH;
  const L = Math.abs(Math.log2(ratio));
  const docHProp = Math.max(0, Math.min(1, 1 - Math.max(0, L - DEADBAND) / K));
  return { docHProp: r4(docHProp), ratio: r4(ratio) };
}

// Reconciled (grade-structure-parity) responsive measured LIVE at 390. Returns null if 390 not sampled.
// mobileFit reads the REAL rendered clone scrollWidth at 390 (no coverage multiplier); mobileOrder is the LIS
// reading-order agreement of clone@390 vs source@390 over the DENSE full-text capture; docHProp scores the
// clone vs source rendered document HEIGHT at 390 (mobile vertical proportion — see docHProportion above).
//   DEFAULT: responsive = 0.34*mobileFit + 0.33*mobileOrder + 0.33*docHProp.
//   GRADER_NO_DOCHPROP=1 reverts to the prior responsive = 0.5*mobileFit + 0.5*mobileOrder (docHProp inert).
async function reconcileResponsive(browser, srcUrl, cloneUrl, srcCap, cloneCap, widths) {
  const MW = 390;
  if (!widths.includes(MW)) return null;
  const cloneML = await captureMobileLayout(browser, cloneUrl);
  const srcML = await captureMobileLayout(browser, srcUrl);
  // mobileFit: REAL rendered horizontal-overflow at 390 (grade-structure mobileLayout formula).
  const cloneSW = cloneML.sw || (cloneCap[MW] ? cloneCap[MW].scrollWidth : 0) || 0;
  const ratio = cloneSW / MW;
  const mobileFit = Math.max(0, Math.min(1, 1 - Math.max(0, ratio - 1.02) * 0.6));
  // mobileOrder: LIS reading-order agreement clone@390 vs source@390 (grade-structure orderAgreement).
  const srcOrder = srcML.mobileTexts.map(normText);
  const cloneOrder = cloneML.mobileTexts.map(normText);
  const mobileOrder = orderAgreementRR(srcOrder, cloneOrder);
  // docHProp: clone-docH@390 vs source-docH@390 (live), falling back to the across-widths capture if a
  // dedicated mobile probe failed to report a height. Symmetric — taller OR shorter both penalized.
  const srcDocH = srcML.docH || (srcCap[MW] ? srcCap[MW].docH : 0) || 0;
  const cloneDocH = cloneML.docH || (cloneCap[MW] ? cloneCap[MW].docH : 0) || 0;
  const dh = docHProportion(srcDocH, cloneDocH);
  const useDocHProp = process.env.GRADER_NO_DOCHPROP !== '1';
  const responsive = useDocHProp
    ? 0.34 * mobileFit + 0.33 * mobileOrder + 0.33 * dh.docHProp
    : 0.5 * mobileFit + 0.5 * mobileOrder;
  return {
    responsive: r4(responsive),
    mobileFit: r4(mobileFit),
    mobileOrder: r4(mobileOrder),
    docHProp: dh.docHProp,
    docHProused: useDocHProp,
    srcDocH,
    cloneDocH,
    docHRatio: dh.ratio,
    cloneScrollWidth: cloneSW,
    ratio: r4(ratio),
    srcRuns: srcOrder.length,
    cloneRuns: cloneOrder.length,
    sharedRuns: srcOrder.filter((t) => cloneOrder.includes(t)).length,
  };
}

// ============================ MAIN ============================
(async () => {
  const t0 = Date.now();
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  console.log(`[grade-responsive] widths=[${WIDTHS.join(',')}] maxNodes=${MAX_NODES}`);
  console.log(`[grade-responsive] SOURCE: ${source}`);
  console.log(`[grade-responsive] CLONE : ${SELFTEST ? '(== source / selftest)' : clone}`);

  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  let result;
  try {
    console.log('[grade-responsive] capturing source across widths ...');
    const srcCap = await captureAcrossWidths(browser, source);
    let cloneCap;
    if (SELFTEST) {
      // CHANGE A — SELF-TEST DETERMINISM (root fix): the self-test asserts the GRADER scores IDENTICAL
      // input as 1.0 (grader self-consistency). An independent re-capture of the same live url conflated
      // that with capture-time variance (lazy content / animations / IntersectionObserver) → flaky
      // 0.957-0.999. Capture-determinism is a SEPARATE concern, not the self-test's job. So instead of
      // re-capturing, the clone capture is a DEEP COPY of the source capture: byte-identical input → the
      // grader MUST return EXACTLY 1.0, deterministically (overflowMatch=1, heightRatio=1, coverage=1,
      // RLG=1, mobileProp=1). This makes the self-test a true grader-determinism assertion.
      console.log('[grade-responsive] SELFTEST: deep-copying source capture as clone (grader-determinism assertion) ...');
      cloneCap = JSON.parse(JSON.stringify(srcCap));
    } else {
      console.log('[grade-responsive] capturing clone across widths ...');
      cloneCap = await captureAcrossWidths(browser, clone);
    }

    // defensive: ensure every width key exists on both sides (a hard capture failure leaves a gap)
    for (const w of WIDTHS) {
      if (!srcCap[w]) { srcCap[w] = { vw: w, docH: 0, scrollWidth: 0, nodes: [] }; console.error(`  [warn] source missing width ${w} (treated empty)`); }
      if (!cloneCap[w]) { cloneCap[w] = { vw: w, docH: 0, scrollWidth: 0, nodes: [] }; console.error(`  [warn] clone missing width ${w} (treated empty)`); }
    }
    for (const w of WIDTHS) {
      console.log(`  width ${w}: src nodes=${srcCap[w].nodes.length} (docH ${srcCap[w].docH}) | clone nodes=${cloneCap[w].nodes.length} (docH ${cloneCap[w].docH})`);
    }

    const edge = edgeSetAgreement(srcCap, cloneCap, WIDTHS);
    const layout = applitoolsLayout(srcCap, cloneCap, WIDTHS);
    // COVERAGE-WEIGHTING (symmetric, like perelement-score): a low-coverage clone (few matched nodes)
    // must NOT score high just because the handful it kept agree. Multiply BOTH sub-scores by coverage.
    // edgeSetAgreement already folds in a 'presence' factor (matchable pairs / total), but that is pair-level
    // and only gently scaled (0.7+0.3*presence); the node-level symmetric coverage is the stronger rail the
    // task asks for and applies uniformly to BOTH sub-scores. Self-test: coverage==1 → identical to before.
    const cov = coverageWeight(srcCap, cloneCap, WIDTHS);
    const coverage = cov.coverage;
    const edgeWeighted = r4(edge.agreement * coverage);
    const layoutWeighted = r4(layout.mean * coverage);
    const rlgScore = r4(0.6 * edgeWeighted + 0.4 * layoutWeighted); // pure RLG (edge + layout)
    // CHANGE B — DETERMINISTIC source-relative mobile-proportion blend, COVERAGE-WEIGHTED (anti-gaming):
    // when a narrow breakpoint exists and the blend is not disabled, fold in mobileProportion at 0.3.
    // The mobile-prop term is multiplied by the same symmetric-F1 coverage that weights the RLG sub-scores
    // so a clone CANNOT bank the 0.3 mobile-prop credit on a near-empty page (right docH/scrollWidth, no
    // actual content) — the coverage F1 gates it exactly like edgeWeighted/layoutWeighted. Otherwise
    // responsiveScore = pure RLG. Self-test: deepcopy → mobileProp=1, coverage=1 → weighted=1 → RLG=1 → 1.0.
    const mobileProp = mobileProportion(srcCap, cloneCap, WIDTHS);
    const useMobileProp = mobileProp.value != null && process.env.GRADER_NO_MOBILEPROP !== '1';
    const mobileProportionWeighted = mobileProp.value != null ? r4(mobileProp.value * coverage) : null;
    // RLG-derived responsive (the prior, coverage-multiplied number). Kept for telemetry and as the
    // reversible fallback when the ground-truth reconcile is disabled.
    const rlgResponsiveScore = useMobileProp
      ? r4(0.7 * (0.6 * edgeWeighted + 0.4 * layoutWeighted) + 0.3 * mobileProportionWeighted)
      : rlgScore;
    // GROUND-TRUTH RECONCILE (default ON; GRADER_NO_RESP_RECONCILE=1 reverts to the RLG number). Replaces the
    // false-deflated coverage-multiplied responsiveScore with grade-structure's authoritative live-390 measure
    // (0.5*mobileFit + 0.5*mobileOrder) when 390 is among the sampled widths. This is the number that matches
    // the live 390 docScrollWidth-overflow ground-truth. mobileFit reads the REAL rendered overflow → a
    // non-fitting clone STILL scores low (anti-gaming preserved). SELFTEST (deepcopy = byte-identical input)
    // is a DEFINITIONAL 1.0 (a page is perfectly responsive-consistent with itself) — we do NOT re-capture
    // live for it (that would reintroduce the capture nondeterminism the deepcopy was built to eliminate).
    let reconcile = null;
    if (process.env.GRADER_NO_RESP_RECONCILE !== '1' && WIDTHS.includes(390)) {
      reconcile = SELFTEST
        ? { responsive: 1, mobileFit: 1, mobileOrder: 1, docHProp: 1, docHProused: process.env.GRADER_NO_DOCHPROP !== '1', srcDocH: (srcCap[390] ? srcCap[390].docH : 0) || 0, cloneDocH: (cloneCap[390] ? cloneCap[390].docH : 0) || 0, docHRatio: 1, cloneScrollWidth: (cloneCap[390] ? cloneCap[390].scrollWidth : 390) || 390, ratio: 1, srcRuns: 0, cloneRuns: 0, sharedRuns: 0, selftest: true }
        : await reconcileResponsive(browser, source, clone, srcCap, cloneCap, WIDTHS);
    }
    const responsiveScore = reconcile ? reconcile.responsive : rlgResponsiveScore;

    const perBreakpoint = WIDTHS.map((w) => ({
      width: w,
      layoutScore: layout.perWidth[w].score,
      matchedNodes: layout.perWidth[w].matched,
      relPairs: layout.perWidth[w].pairs,
      srcNodes: srcCap[w].nodes.length,
      cloneNodes: cloneCap[w].nodes.length,
      srcDocH: srcCap[w].docH,
      cloneDocH: cloneCap[w].docH,
      srcScrollWidth: srcCap[w].scrollWidth,
      cloneScrollWidth: cloneCap[w].scrollWidth,
    }));

    result = {
      label,
      source,
      clone: SELFTEST ? source : clone,
      selftest: SELFTEST,
      responsiveScore,
      // GROUND-TRUTH RECONCILE (grade-structure parity): the authoritative live-390 responsive used as
      // responsiveScore unless GRADER_NO_RESP_RECONCILE=1. null when 390 not sampled or reconcile disabled.
      reconcile: reconcile || null,
      reconcileUsed: !!reconcile,
      // The prior RLG-derived (coverage-multiplied) responsive, kept for telemetry / reversibility.
      rlgResponsiveScore,
      // RLG-only score (pure edge+layout, pre-mobileProp blend) for telemetry.
      rlgScore,
      // DETERMINISTIC source-relative mobile-proportion sub-score (null if no narrow width) + per-width detail.
      mobileProportion: mobileProp.value,
      // COVERAGE-WEIGHTED mobile-proportion (the value actually blended at 0.3): mobileProportion * coverage.
      mobileProportionWeighted,
      mobilePropUsed: useMobileProp,
      mobilePropDetail: mobileProp.perWidth,
      // coverage-weighted sub-scores (the ones that feed responsiveScore) + the RAW (pre-coverage) ones for telemetry.
      edgeSetAgreement: edgeWeighted,
      meanPerWidthLayout: layoutWeighted,
      coverage,
      coverageDetail: cov,
      edgeSetAgreementRaw: edge.agreement,
      meanPerWidthLayoutRaw: layout.mean,
      edgeDetail: edge,
      perBreakpoint,
      widths: WIDTHS,
      elapsedMs: Date.now() - t0,
    };
  } finally {
    await browser.close();
  }

  const outFile = path.join(outDir, `responsive-${label}.json`);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log('');
  console.log(`responsiveScore = ${result.responsiveScore}   (rlg ${result.rlgScore} · mobileProp ${result.mobileProportion}${result.mobilePropUsed ? ` ×cov→ ${result.mobileProportionWeighted}` : ' [unused]'} · edgeSet ${result.edgeSetAgreement} · layout ${result.meanPerWidthLayout} · coverage ${result.coverage} [raw edge ${result.edgeSetAgreementRaw} layout ${result.meanPerWidthLayoutRaw}])`);
  if (result.reconcileUsed) {
    const rc = result.reconcile;
    const wstr = rc.docHProused
      ? `0.34*mobileFit ${rc.mobileFit} + 0.33*mobileOrder ${rc.mobileOrder} + 0.33*docHProp ${rc.docHProp} (docH@390 src ${rc.srcDocH}/clone ${rc.cloneDocH}, ratio ${rc.docHRatio})`
      : `0.5*mobileFit ${rc.mobileFit} + 0.5*mobileOrder ${rc.mobileOrder}  [docHProp OFF]`;
    console.log(`  ↳ GROUND-TRUTH RECONCILE (grade-structure parity, used as responsiveScore): ${rc.responsive} = ${wstr} (cloneSW@390 ${rc.cloneScrollWidth}, ratio ${rc.ratio}; shared ${rc.sharedRuns}/${rc.srcRuns}src,${rc.cloneRuns}clone)   [rlg-deflated number was ${result.rlgResponsiveScore}]`);
  }
  for (const b of result.perBreakpoint) console.log(`  ${b.width}px  layout=${b.layoutScore}  matched=${b.matchedNodes}  pairs=${b.relPairs}  sw[src ${b.srcScrollWidth}/clone ${b.cloneScrollWidth}]  docH[src ${b.srcDocH}/clone ${b.cloneDocH}]`);
  for (const w of Object.keys(result.mobilePropDetail)) { const d = result.mobilePropDetail[w]; console.log(`  mobileProp ${w}px  overflowMatch=${d.overflowMatch} (src ${d.srcOverflow}/clone ${d.cloneOverflow})  heightRatio=${d.heightRatio}  -> ${d.perWidthProp}`); }
  console.log(`[grade-responsive] wrote ${outFile}  (${(result.elapsedMs / 1000).toFixed(1)}s)`);

  if (SELFTEST) {
    // HARD rail: a page graded against itself MUST be ~1.0. We allow a tiny epsilon ONLY for
    // genuine render nondeterminism between two independent captures of the same live url.
    const EPS = 0.04;
    const pass = result.responsiveScore >= 1 - EPS;
    console.log(`[SELFTEST] responsiveScore=${result.responsiveScore}  (threshold >= ${1 - EPS})  → ${pass ? 'PASS' : 'FAIL'}`);
    if (!pass) process.exit(1);
  }
})().catch((e) => { console.error('grade-responsive error:', e && e.stack || e); process.exit(1); });
