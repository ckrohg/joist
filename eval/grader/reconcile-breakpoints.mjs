#!/usr/bin/env node
// @purpose Per-breakpoint Stage 1 v1 — reconcile multi-width captures into a unified leaf model + report
// cross-breakpoint MATCHING ACCURACY (the Stage 1 gate). Matcher v1: desktop(1440) is the reference; per
// target width, scored GREEDY match — exact-text > fuzzy-text (responsive truncation) > image-alt >
// same-kind normalized-position-nearest. Hard-gated on kind. Images are NOT keyed on src (responsive
// srcset/currentSrc differs per width). NOT the build (Stage 2) — this produces + grades the MODEL.
// Usage: node reconcile-breakpoints.mjs [--multi /tmp/pbc-s1/multi.json] [--out /tmp/pbc-s1/model.json]
import fs from 'node:fs';

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const M = JSON.parse(fs.readFileSync(arg('multi', '/tmp/pbc-s1/multi.json'), 'utf8'));
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const CONTENT = new Set(['heading', 'button', 'text', 'image', 'svg', 'video', 'code', 'list', 'tabs', 'mockup']);
const HEADER_Y = 140;   // desktop header/nav band → reported as chrome separately (the hamburger tail)
const THRESH = 0.7;     // confident-match floor

// unwrap thin single-container wrappers so the top-level children are the real page bands
function bandsOf(root) { let r = root; while (r && r.kind === 'container' && (r.children || []).length === 1 && r.children[0].kind === 'container') r = r.children[0]; return (r && r.children) || []; }
function leavesOf(layout) {
  const out = []; const bands = bandsOf(layout.root);
  bands.forEach((band, bi) => {
    const walk = (n) => {
      if (!n) return;
      if (n.kind === 'container') { (n.children || []).forEach(walk); }
      else if (CONTENT.has(n.kind) && n.box) { out.push({ kind: n.kind, text: norm(n.text), src: n.src || '', alt: norm(n.alt), box: n.box, typo: n.typo || null, band: bi, i: out.length }); }
    };
    walk(band);
  });
  return out;
}
const dims = (L) => ({ W: L.vw || 1440, H: L.pageH || (L.root && L.root.box && L.root.box.h) || 1 });

function score(d, c, dd, dc) {
  if (d.kind !== c.kind) return 0;                       // hard kind gate
  if (d.text && c.text) {                                // text leaves: text is the primary signal
    if (d.text === c.text) return 1.0;
    if (d.text.length >= 6 && (c.text.includes(d.text) || d.text.includes(c.text))) return 0.82; // responsive truncation
    return 0;
  }
  let s = 0;                                             // no-text (image/svg/video/mockup)
  if (d.alt && c.alt && d.alt === c.alt) s = 0.9;        // alt, NOT src (srcset differs per width)
  const dist = Math.hypot(d.box.x / dd.W - c.box.x / dc.W, d.box.y / dd.H - c.box.y / dc.H);
  return Math.max(s, Math.max(0, 1 - dist * 1.5) * 0.7); // normalized-position fallback caps at 0.7
}
function bestMatch(d, cand, dd, dc, used) {
  let best = null, bs = 0;
  for (let j = 0; j < cand.length; j++) { if (used.has(j)) continue; const sc = score(d, cand[j], dd, dc); if (sc > bs) { bs = sc; best = j; } }
  return { j: best, s: bs };
}

const ref = leavesOf(M.w1440), dd = dims(M.w1440);
const targets = {};
for (const w of ['w768', 'w390']) if (M[w]) targets[w] = { leaves: leavesOf(M[w]), dims: dims(M[w]) };

const model = []; const used = { w768: new Set(), w390: new Set() };
for (const d of ref) {
  const leaf = { kind: d.kind, content: (d.text || d.alt || d.src || '').slice(0, 60), band: d.band, box: { 1440: d.box }, typo: { 1440: d.typo }, visible: { 1440: true }, match: {} };
  for (const w of Object.keys(targets)) {
    const { leaves, dims: dc } = targets[w]; const wn = w.slice(1);
    const bm = bestMatch(d, leaves, dd, dc, used[w]);
    if (bm.j !== null && bm.s >= THRESH) { used[w].add(bm.j); const c = leaves[bm.j]; leaf.box[wn] = c.box; leaf.typo[wn] = c.typo; leaf.visible[wn] = true; leaf.match[w] = { conf: +bm.s.toFixed(2) }; }
    else { leaf.visible[wn] = false; leaf.match[w] = { conf: +bm.s.toFixed(2), unmatched: true }; }
  }
  model.push(leaf);
}

// ── accuracy report (content = exclude the desktop header chrome band) ──
const isChrome = (l) => (l.box[1440].y < HEADER_Y);
const content = model.filter((l) => !isChrome(l));
const acc = (w) => { const m = content.filter((l) => l.visible[w]).length; return { matched: m, total: content.length, pct: +(100 * m / Math.max(1, content.length)).toFixed(1) }; };
const byKind = (w) => { const o = {}; for (const l of content) { o[l.kind] = o[l.kind] || { m: 0, t: 0 }; o[l.kind].t++; if (l.visible[w]) o[l.kind].m++; } return o; };
const report = {
  source: M.w1440.url, widths: Object.keys(M),
  refContentLeaves: content.length, chromeLeaves: model.length - content.length,
  accuracy: { 390: acc('390'), 768: acc('768') },
  byKind390: byKind('390'),
  unmatched390: content.filter((l) => !l.visible['390']).slice(0, 30).map((l) => ({ kind: l.kind, content: l.content, conf: l.match.w390 && l.match.w390.conf })),
};
fs.writeFileSync(arg('out', '/tmp/pbc-s1/model.json'), JSON.stringify({ report, model }));
console.log(JSON.stringify(report, null, 2));
console.log(`\nGATE (>=85% content matched @390): ${report.accuracy[390].pct >= 85 ? 'PASS' : 'BELOW'} (${report.accuracy[390].pct}% ; @768 ${report.accuracy[768].pct}%)`);
