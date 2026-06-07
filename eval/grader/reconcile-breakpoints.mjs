#!/usr/bin/env node
// @purpose Per-breakpoint Stage 1 v2 — reconcile multi-width captures into a unified leaf model + report a
// DUAL matching metric. Over v1: (1) BAND-AWARE — match top-level sections across widths first (text+aspect
// recall), then match leaves only WITHIN corresponding bands; (2) IMAGE/composite identity by aspect-ratio +
// within-band order + alt (NOT src — srcset differs per width); (3) DUAL METRIC — separate a real MISS (the
// leaf's band has a mobile counterpart but the leaf wasn't found) from a CORRECT ABSENCE (the band collapses
// entirely, e.g. desktop nav → mobile hamburger). NOT the build (Stage 2). Desktop(1440) is the reference.
// Usage: node reconcile-breakpoints.mjs [--multi /tmp/pbc-s1/multi.json] [--out /tmp/pbc-s1/model.json]
import fs from 'node:fs';

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const M = JSON.parse(fs.readFileSync(arg('multi', '/tmp/pbc-s1/multi.json'), 'utf8'));
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const svgH = (x) => (x || '').replace(/(?:width|height|style)="[^"]*"/g, '').replace(/\s+/g, ''); // render-size-invariant svg markup
const CONTENT = new Set(['heading', 'button', 'text', 'image', 'svg', 'video', 'code', 'list', 'tabs', 'mockup']);
const TXT = new Set(['heading', 'button', 'text', 'code']);
const MEDIA_THRESH = 0.62, TEXT_THRESH = 0.7, BAND_OV = 0.15;

// Real page sections: unwrap thin single-container chains, then DESCEND one level into "mega-wrappers"
// (a top-level child holding many section sub-containers) so the bands are the actual sections (hero, logo
// wall, features, footer…) — not 2-3 giant wrappers. Without this the nav lumps with the hero and the dual
// metric can't see a collapsed section. (supabase: nav band + 1 mega-wrapper of 12 sections + footer.)
function bandsOf(root) {
  let r = root; while (r && r.kind === 'container' && (r.children || []).length === 1 && r.children[0].kind === 'container') r = r.children[0];
  const top = (r && r.children) || []; const bands = [];
  for (const c of top) {
    if (c.kind !== 'container') { bands.push(c); continue; }
    const subC = (c.children || []).filter((x) => x.kind === 'container');
    if (subC.length >= 4) { for (const s of subC) bands.push(s); } else bands.push(c);
  }
  return bands;
}
function leavesOf(layout) {
  const out = []; const bands = bandsOf(layout.root);
  bands.forEach((band, bi) => {
    const kc = {};
    const walk = (n) => {
      if (!n) return;
      if (n.kind === 'container') { (n.children || []).forEach(walk); return; }
      if (CONTENT.has(n.kind) && n.box) {
        kc[n.kind] = (kc[n.kind] || 0);
        out.push({ kind: n.kind, text: norm(n.text), src: n.src || '', alt: norm(n.alt), svg: n.svg || '', box: n.box, typo: n.typo || null, band: bi, ord: kc[n.kind]++, ar: n.box.h > 0 ? n.box.w / n.box.h : 0 });
      }
    };
    walk(band);
  });
  return out;
}

// ── band correspondence: for each desktop band, the target band(s) it maps to (top-3 by recall>BAND_OV) ──
const bandTexts = (L, bi) => new Set(L.filter((l) => l.band === bi && TXT.has(l.kind) && l.text).map((l) => l.text));
const bandAspects = (L, bi) => L.filter((l) => l.band === bi && !TXT.has(l.kind) && l.ar > 0).map((l) => l.ar);
function bandOverlap(dL, dbi, tL, tbi) {
  const dt = bandTexts(dL, dbi), tt = bandTexts(tL, tbi);
  let textR = 0; if (dt.size) { let i = 0; for (const x of dt) if (tt.has(x)) i++; textR = i / dt.size; }
  const da = bandAspects(dL, dbi), ta = bandAspects(tL, tbi).slice();
  let aspR = 0; if (da.length) { let m = 0; const used = new Set(); for (const a of da) { let bj = -1, bd = 99; for (let j = 0; j < ta.length; j++) { if (used.has(j)) continue; const d = Math.abs(Math.log((a || 1) / (ta[j] || 1))); if (d < bd) { bd = d; bj = j; } } if (bj >= 0 && bd < 0.35) { used.add(bj); m++; } } aspR = m / da.length; }
  if (dt.size && da.length) return 0.6 * textR + 0.4 * aspR;
  return dt.size ? textR : aspR;
}
function correspond(dL, tL) {
  const dB = [...new Set(dL.map((l) => l.band))].sort((a, b) => a - b);
  const tB = [...new Set(tL.map((l) => l.band))].sort((a, b) => a - b);
  const nD = Math.max(1, dB.length - 1), nT = Math.max(1, tB.length - 1);
  const map = {};
  dB.forEach((dbi, di) => {
    map[dbi] = tB.map((tbi, ti) => {
      // band-order prior: a section keeps its rough relative position across widths, so the top nav must
      // NOT correspond to the bottom footer just because they share link labels. Zeroes at >=0.5 relPos diff.
      const pos = Math.max(0, 1 - 2 * Math.abs(di / nD - ti / nT));
      return { tbi, ov: bandOverlap(dL, dbi, tL, tbi) * pos };
    }).filter((x) => x.ov > BAND_OV).sort((a, b) => b.ov - a.ov).slice(0, 3).map((x) => x.tbi);
  });
  return map; // dbi -> [tbi…]  (empty = band absent → leaves are correct-absences)
}

function scoreLeaf(d, c) {
  if (d.kind !== c.kind) return 0;
  if (TXT.has(d.kind)) {
    if (d.text && c.text) { if (d.text === c.text) return 1.0; if (d.text.length >= 6 && (c.text.includes(d.text) || d.text.includes(c.text))) return 0.82; return 0; }
    return d.ord === c.ord ? 0.7 : 0; // text leaf w/o captured text → order only
  }
  // v3 media identity — exact CONTENT signals first (survive reflow even when size/position don't):
  //  • svg → normalized outerHTML markup (strip render-size width/height/style attrs) — near-exact for icons
  //  • image/video → same asset URL (logos/illustrations use a single src, not responsive srcset)
  if (d.kind === 'svg' && d.svg && c.svg && svgH(d.svg) === svgH(c.svg)) return 1.0;
  if ((d.kind === 'image' || d.kind === 'video') && d.src && c.src && d.src === c.src) return 0.97;
  let s = 0; if (d.alt && c.alt && d.alt === c.alt) s = 0.92; // alt (not src — srcset differs) then aspect + within-band order
  const arSim = (d.ar > 0 && c.ar > 0) ? Math.max(0, 1 - Math.abs(Math.log(d.ar / c.ar)) / 0.5) : 0;
  const ordSim = d.ord === c.ord ? 1 : Math.max(0, 1 - Math.abs(d.ord - c.ord) * 0.34);
  return Math.max(s, 0.55 * ordSim + 0.45 * arSim);
}

const ref = leavesOf(M.w1440);
const targets = {}; for (const w of ['w768', 'w390']) if (M[w]) targets[w] = { leaves: leavesOf(M[w]), corr: correspond(ref, leavesOf(M[w])), used: new Set() };

const model = [];
for (const d of ref) {
  const leaf = { kind: d.kind, content: (d.text || d.alt || d.src || '').slice(0, 50), band: d.band, box: { 1440: d.box }, typo: { 1440: d.typo }, status: {} };
  for (const w of Object.keys(targets)) {
    const T = targets[w], wn = w.slice(1), bands = T.corr[d.band] || [];
    if (bands.length === 0) { leaf.status[wn] = 'absent'; continue; }          // band collapsed → correct absence
    let best = null, bs = 0;
    for (let j = 0; j < T.leaves.length; j++) { if (T.used.has(j)) continue; const c = T.leaves[j]; if (!bands.includes(c.band)) continue; const sc = scoreLeaf(d, c); if (sc > bs) { bs = sc; best = j; } }
    const thr = TXT.has(d.kind) ? TEXT_THRESH : MEDIA_THRESH;
    if (best !== null && bs >= thr) { T.used.add(best); const c = T.leaves[best]; leaf.box[wn] = c.box; leaf.typo[wn] = c.typo; leaf.status[wn] = 'matched'; leaf[`conf_${wn}`] = +bs.toFixed(2); }
    else leaf.status[wn] = 'miss';
  }
  model.push(leaf);
}

// ── reclassify genuine MOBILE ABSENCES: the mobile page genuinely shows less (supabase = 91 leaves @390 vs
// 206 desktop; pageH 7064 < desktop 7578, coverage 0.82 → not under-capture). A leaf currently 'miss' (band
// present, unmatched) is a CORRECT ABSENCE if its content has NO counterpart anywhere at the target width;
// only a leaf whose counterpart EXISTS but wasn't matched is a true MISS. This is what makes the metric honest.
for (const w of Object.keys(targets)) {
  const wn = w.slice(1), tl = targets[w].leaves;
  const txt = new Set(tl.filter((l) => l.text).map((l) => l.text));
  const svgs = new Set(tl.filter((l) => l.kind === 'svg' && l.svg).map((l) => svgH(l.svg)));
  const srcs = new Set(tl.filter((l) => l.src).map((l) => l.src));
  const alts = new Set(tl.filter((l) => l.alt).map((l) => l.alt));
  model.forEach((leaf, i) => {
    if (leaf.status[wn] !== 'miss') return;
    const d = ref[i]; let has = false;
    if (TXT.has(d.kind) && d.text) has = txt.has(d.text);
    else if (d.kind === 'svg' && d.svg) has = svgs.has(svgH(d.svg));
    else if (d.kind === 'image' || d.kind === 'video') has = (!!d.src && srcs.has(d.src)) || (!!d.alt && alts.has(d.alt));
    if (!has) leaf.status[wn] = 'absent';
  });
}

// ── DUAL metric: rawMatch% (matched/all) + contentMatch% (matched / (all − correct-absences)) ──
function metric(w) {
  let matched = 0, miss = 0, absent = 0;
  for (const l of model) { const s = l.status[w]; if (s === 'matched') matched++; else if (s === 'miss') miss++; else absent++; }
  const present = matched + miss;
  return { matched, miss, absent, total: model.length, rawPct: +(100 * matched / Math.max(1, model.length)).toFixed(1), contentPct: +(100 * matched / Math.max(1, present)).toFixed(1) };
}
const byKind = (w) => { const o = {}; for (const l of model) { o[l.kind] = o[l.kind] || { matched: 0, miss: 0, absent: 0 }; o[l.kind][l.status[w]]++; } return o; };
const report = {
  source: M.w1440.url, widths: Object.keys(M), refLeaves: model.length,
  bandCorrespondence390: targets.w390 ? Object.fromEntries(Object.entries(targets.w390.corr).map(([d, t]) => [d, t.join(',') || 'ABSENT'])) : {},
  metric: { 390: metric('390'), 768: metric('768') },
  byKind390: byKind('390'),
  misses390: model.filter((l) => l.status['390'] === 'miss').slice(0, 25).map((l) => ({ kind: l.kind, band: l.band, content: l.content, conf: l[`conf_390`] ?? 0 })),
};
fs.writeFileSync(arg('out', '/tmp/pbc-s1/model.json'), JSON.stringify({ report, model }));
console.log(JSON.stringify(report, null, 2));
const m = report.metric[390];
console.log(`\nDUAL @390 — raw ${m.rawPct}% (matched ${m.matched}/${m.total}) | CONTENT ${m.contentPct}% (matched ${m.matched} / present ${m.matched + m.miss}; ${m.absent} correctly absent) | @768 content ${report.metric[768].contentPct}%`);
console.log(`GATE (content >=85% @390): ${m.contentPct >= 85 ? 'PASS' : 'BELOW'}`);
