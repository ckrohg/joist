#!/usr/bin/env node
/**
 * @purpose Phase 2 — the Intermediate Representation (CLONE_CAPABILITY_SPEC §5.2).
 * Normalizes capture-fx's FLAT list of boxes into a typed flex component+style tree —
 * the normalize/optimize stage the close tools (Builder.io/Locofy/TeleportHQ) have and
 * we lacked. NOT flat absolute positioning (the Anima failure mode).
 *
 * Pipeline: assign leaves→bands → XY-cut spatial segmentation (infer flex row/col +
 * gap) → wrapper-flatten (≤3 levels) → component-extraction (dedupe repeats) →
 * style-dedup (global classes, V4 prep).
 *
 * Usage: node build-ir.mjs --capture capture-fx.json [--out ir.json]
 */
import fs from 'fs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const cap = JSON.parse(fs.readFileSync(arg('capture', 'capture-fx.json'), 'utf8'));
const out = arg('out', './ir.json');
const GAP = 12, MAX_DEPTH = 5;

// ---------- XY-cut: infer flex hierarchy from boxes ----------
// split a set of leaves by gaps along an axis ('y'=rows / 'x'=cols)
function splitByGaps(leaves, axis) {
  const lo = axis === 'y' ? (l) => l.box.y : (l) => l.box.x;
  const hi = axis === 'y' ? (l) => l.box.y + l.box.h : (l) => l.box.x + l.box.w;
  const sorted = [...leaves].sort((a, b) => lo(a) - lo(b));
  const groups = []; let cur = [sorted[0]]; let maxEnd = hi(sorted[0]);
  for (let i = 1; i < sorted.length; i++) {
    if (lo(sorted[i]) > maxEnd + GAP) { groups.push(cur); cur = [sorted[i]]; maxEnd = hi(sorted[i]); }
    else { cur.push(sorted[i]); maxEnd = Math.max(maxEnd, hi(sorted[i])); }
  }
  groups.push(cur);
  return groups;
}
function gapBetween(groups, axis) { // representative gap size for flex_gap
  if (groups.length < 2) return 0; const hi = axis === 'y' ? (l) => l.box.y + l.box.h : (l) => l.box.x + l.box.w; const lo = axis === 'y' ? (l) => l.box.y : (l) => l.box.x;
  const gaps = []; for (let i = 1; i < groups.length; i++) { const prevEnd = Math.max(...groups[i - 1].map(hi)); const nextStart = Math.min(...groups[i].map(lo)); gaps.push(nextStart - prevEnd); }
  gaps.sort((a, b) => a - b); return Math.max(0, Math.round(gaps[gaps.length >> 1])); // median
}
function bbox(leaves) { const xs = leaves.map((l) => l.box.x), ys = leaves.map((l) => l.box.y), xe = leaves.map((l) => l.box.x + l.box.w), ye = leaves.map((l) => l.box.y + l.box.h); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xe) - Math.min(...xs), h: Math.max(...ye) - Math.min(...ys) }; }

function segment(leaves, depth) {
  if (leaves.length === 1) return { kind: 'leaf', box: leaves[0].box, el: leaves[0] };
  if (depth > MAX_DEPTH) return { kind: 'cluster', box: bbox(leaves), children: leaves.map((l) => ({ kind: 'leaf', box: l.box, el: l })) };
  const rows = splitByGaps(leaves, 'y');
  if (rows.length > 1) return { kind: 'container', direction: 'column', gap: gapBetween(rows, 'y'), box: bbox(leaves), children: rows.map((r) => segment(r, depth + 1)) };
  const cols = splitByGaps(leaves, 'x');
  if (cols.length > 1) return { kind: 'container', direction: 'row', gap: gapBetween(cols, 'x'), box: bbox(leaves), children: cols.map((c) => segment(c, depth + 1)) };
  // no clean split → overlapping cluster (e.g. text over an image); keep z-order by area desc
  return { kind: 'cluster', box: bbox(leaves), children: [...leaves].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h).map((l) => ({ kind: 'leaf', box: l.box, el: l })) };
}

// ---------- wrapper-flatten: collapse single-child containers (≤3 useful levels) ----------
function flatten(node) {
  if (node.kind !== 'container' && node.kind !== 'cluster') return node;
  node.children = node.children.map(flatten);
  if (node.kind === 'container' && node.children.length === 1 && node.children[0].kind === 'container') {
    return node.children[0]; // collapse a container that wraps a single container
  }
  return node;
}
function maxDepth(node, d = 0) { if (!node.children) return d; return Math.max(...node.children.map((c) => maxDepth(c, d + 1))); }

// ---------- style-dedup → global classes (V4 prep) ----------
const styleClasses = []; const styleIndex = new Map();
function styleSig(el) { if (!el || el.type === 'image' || el.type === 'svg') return null; const t = el.typo || {}; return JSON.stringify({ tag: el.tag, family: t.family, size: t.size, weight: t.weight, lh: t.lineHeight, ls: t.letterSpacing, align: t.align, paint: el.paint, effects: el.effects || null }); }
function classFor(el) { const sig = styleSig(el); if (!sig) return null; if (!styleIndex.has(sig)) { styleIndex.set(sig, styleClasses.length); styleClasses.push({ id: 'gc-' + styleClasses.length, ...JSON.parse(sig) }); } return 'gc-' + styleIndex.get(sig); }
function assignStyles(node) { if (node.kind === 'leaf' && node.el) node.styleRef = classFor(node.el); (node.children || []).forEach(assignStyles); }

// ---------- component-extraction: dedupe repeated sibling subtrees ----------
function structSig(node) { if (node.kind === 'leaf') return 'L:' + (node.el?.type || '?'); return node.kind[0] + (node.direction || '') + '[' + (node.children || []).map(structSig).join(',') + ']'; }
const components = {}; let compN = 0;
function extractComponents(node) {
  if (node.children && node.children.length >= 2) {
    const bySig = {}; node.children.forEach((c) => { const s = structSig(c); (bySig[s] = bySig[s] || []).push(c); });
    for (const [sig, group] of Object.entries(bySig)) {
      if (group.length >= 2 && sig.length > 6 && sig.includes(',')) { // repeated non-trivial subtree
        const cid = 'comp-' + compN++; components[cid] = { instances: group.length, signature: sig.slice(0, 80) }; group.forEach((g) => { g.componentId = cid; });
      }
    }
  }
  (node.children || []).forEach(extractComponents);
}

// ---------- main ----------
const leaves = cap.els || [];
const bands = (cap.bands && cap.bands.length) ? cap.bands : [{ y: 0, h: cap.pageH, bg: cap.pageBg }];
// assign each leaf to the smallest band that vertically contains its center
const sections = bands.map((b) => ({ band: b, leaves: [] }));
for (const lf of leaves) {
  const cy = lf.box.y + lf.box.h / 2; let best = null;
  for (const s of sections) if (cy >= s.band.y - 2 && cy < s.band.y + s.band.h + 2) { if (!best || s.band.h < best.band.h) best = s; }
  (best || sections[0]).leaves.push(lf);
}

const ir = { url: cap.url, title: cap.title, vw: cap.vw, pageBg: cap.pageBg, pageH: cap.pageH, fonts: cap.fonts, fontFiles: cap.fontFiles, sections: [] };
for (const s of sections) {
  if (!s.leaves.length) continue;
  let tree = segment(s.leaves, 0);
  tree = flatten(tree);
  assignStyles(tree);
  extractComponents(tree);
  ir.sections.push({ bg: s.band.bg, bgImage: s.band.bgImage || null, box: { y: s.band.y, h: s.band.h }, layout: tree });
}
ir.styleClasses = styleClasses;
ir.components = components;
fs.writeFileSync(out, JSON.stringify(ir, null, 2));

// summary
const depths = ir.sections.map((s) => maxDepth(s.layout));
const countNodes = (n) => 1 + (n.children || []).reduce((a, c) => a + countNodes(c), 0);
const totalNodes = ir.sections.reduce((a, s) => a + countNodes(s.layout), 0);
console.log(`IR: ${ir.sections.length} sections | ${totalNodes} nodes | max depth ${Math.max(...depths, 0)} | ${styleClasses.length} global style-classes | ${Object.keys(components).length} components extracted`);
ir.sections.slice(0, 6).forEach((s, i) => { const l = s.layout; console.log(`  s${i} (h${s.box.h}): ${l.kind}${l.direction ? '/' + l.direction : ''} depth${maxDepth(l)} ${countNodes(l)} nodes`); });
const topComps = Object.entries(components).sort((a, b) => b[1].instances - a[1].instances).slice(0, 4);
if (topComps.length) { console.log('components:'); topComps.forEach(([id, c]) => console.log(`  ${id}: ${c.instances}× ${c.signature.slice(0, 50)}`)); }
