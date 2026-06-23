#!/usr/bin/env node
/**
 * @purpose _height-debt-ledger.mjs — the fusion-2026-06-23 "ready instrument" for the region-raster height-pairing:
 * region-raster un-masked a pre-existing height defect (the clone is ~1.41x too tall, DISTRIBUTED, no gaps). Before
 * touching any code, DIAGNOSE which sections carry the height debt and gate on the distribution SHAPE so the fix is
 * ROUTED, not guessed:
 *   PARETO   (top-3 debtShare ≥ 0.6)        → attack those few sections
 *   UNIFORM  (per-section ratio stdev < 0.15) → one global cause (rem-base / line-height / box-sizing) → one fix
 *   DISPERSED                                 → many small contributors
 * Source section heights come from the capture manifest (no live source fetch); clone section heights are measured
 * live from the rendered page via getBoundingClientRect over top-level containers. Aligned by document order.
 *
 * Usage: source /tmp/joist-auth*.env && node _height-debt-ledger.mjs --cap <capture dir> --clone <page-id>
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const capDir = arg('cap', '/tmp/gentest-allbirds');
const pageId = arg('clone', '1368');
const base = process.env.JOIST_BASE || 'http://localhost:8001';

// ── SOURCE sections from the capture manifest (top-level bands w/ heights) ──────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync(path.join(capDir, 'manifest.json'), 'utf8'));
const srcSecs = ((manifest.perWidth && manifest.perWidth['1440'] && manifest.perWidth['1440'].sections) || manifest.sections || [])
  .filter((s) => (s.h || 0) > 60).map((s) => ({ y: s.y, h: s.h, loc: s.locator || '' }));
const srcPageH = manifest.domH || srcSecs.reduce((m, s) => Math.max(m, s.y + s.h), 0);

// ── CLONE sections measured live ───────────────────────────────────────────────────────────────────────────────
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto(`${base}/?page_id=${pageId}`, { waitUntil: 'load', timeout: 35000 }).catch(() => {});
await p.waitForTimeout(2500);
const clone = await p.evaluate(() => {
  const pageH = document.body.scrollHeight, pageW = document.documentElement.scrollWidth || 1440;
  // Top-level BANDS: full-width containers (w ≥ 0.9·pageW, h ≥ 80) that are NOT nested inside another kept band —
  // robust to the projection's deep single-root nesting (band detection by geometry, not by being a direct child).
  const all = [...document.querySelectorAll('.e-con, .elementor-section, .elementor-element')]
    .map((e) => { const r = e.getBoundingClientRect(); return { e, x: r.left, y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((b) => b.w >= 0.45 * pageW && b.h >= 100 && b.h < 0.6 * pageH) // exclude page-wrapper containers (a section ≪ page)
    .sort((a, b) => a.y - b.y || b.h - a.h);
  // GREEDY non-overlapping TILE: walk top-to-bottom; pick the next band whose top is at/after the current cursor and
  // that extends the furthest down → a partition of the page into top-level section bands (robust to deep nesting).
  const bands = []; let cursor = -1;
  for (const b of all) { if (b.y < cursor - 20) continue; const overlapKept = bands.find((k) => b.y < k.y + k.h - 20 && b.y + b.h > k.y + 20); if (overlapKept) continue; bands.push(b); cursor = b.y + b.h; }
  const secs = bands.map(({ e, y, h }) => { const imgs = [...e.querySelectorAll('img')]; const imgH = imgs.reduce((a, im) => a + im.getBoundingClientRect().height, 0);
    return { y, h, nImg: imgs.length, imgH: Math.round(imgH), txt: (e.innerText || '').trim().length }; });
  return { pageH, secs };
});
await b.close();

// ── ALIGN by document order (count-tolerant: pad the shorter) + per-section debt ─────────────────────────────────
const n = Math.min(srcSecs.length, clone.secs.length);
const rows = [];
for (let i = 0; i < n; i++) {
  const src = srcSecs[i], cl = clone.secs[i];
  const ratio = src.h > 0 ? cl.h / src.h : 0;
  const debtPx = Math.max(0, cl.h - src.h);
  // classify the debt cause
  let cls = 'aligned';
  if (debtPx > 80) {
    if (cl.imgH > cl.h * 0.9 && cl.nImg >= 3) cls = 'gallery-additive';       // summed child-image heights ~ section height
    else if (cl.imgH > src.h * 1.1 && cl.nImg >= 1) cls = 'media-overheight';  // imagery taller than the source band
    else if (cl.txt > 200) cls = 'text-wrap';                                  // text wraps taller in Elementor
    else cls = 'gap-padding-minheight';
  }
  rows.push({ i, srcH: src.h, cloneH: cl.h, ratio: +ratio.toFixed(2), debtPx, nImg: cl.nImg, imgH: cl.imgH, cls, srcLoc: String(src.loc).slice(-38) });
}
const totalDebt = clone.pageH - srcPageH;
rows.forEach((r) => { r.debtShare = totalDebt > 0 ? +(r.debtPx / totalDebt).toFixed(3) : 0; });
const ranked = [...rows].sort((a, b) => b.debtPx - a.debtPx);

// ── DISTRIBUTION SHAPE GATE (routes the fix) ─────────────────────────────────────────────────────────────────────
const top3Share = ranked.slice(0, 3).reduce((a, r) => a + r.debtShare, 0);
const ratios = rows.filter((r) => r.debtPx > 0).map((r) => r.ratio);
const mean = ratios.reduce((a, b) => a + b, 0) / (ratios.length || 1);
const stdev = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / (ratios.length || 1));
const shape = top3Share >= 0.6 ? 'PARETO' : (stdev < 0.15 ? 'UNIFORM' : 'DISPERSED');

console.log(`\n══ HEIGHT-DEBT LEDGER  (source ${srcPageH}px / clone ${clone.pageH}px = ${(clone.pageH / srcPageH).toFixed(2)}x; debt ${totalDebt}px) ══\n`);
console.log(`source sections: ${srcSecs.length} | clone sections: ${clone.secs.length} | aligned: ${n}\n`);
console.log('TOP DEBT SECTIONS (ranked):');
for (const r of ranked.slice(0, 8)) console.log(`  #${r.i} debt ${String(r.debtPx).padStart(4)}px (${(r.debtShare * 100).toFixed(0)}%) ratio ${r.ratio} [${r.cls}] src=${r.srcH} clone=${r.cloneH} img=${r.nImg}/${r.imgH}px ${r.srcLoc}`);
console.log(`\nSHAPE: ${shape}  (top-3 debtShare ${(top3Share * 100).toFixed(0)}%, ratio stdev ${stdev.toFixed(3)})`);
console.log(shape === 'PARETO' ? '  → attack the top-debt sections (few causes)' : shape === 'UNIFORM' ? '  → ONE global cause (rem-base/line-height/box-sizing) → one fix' : '  → DISPERSED: many small contributors');
const byCls = {}; for (const r of rows) if (r.debtPx > 0) byCls[r.cls] = (byCls[r.cls] || 0) + r.debtPx;
console.log('  debt by class:', Object.entries(byCls).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}px`).join(' | '));
fs.writeFileSync('/tmp/height-debt-ledger.json', JSON.stringify({ srcPageH, clonePageH: clone.pageH, totalDebt, shape, top3Share, stdev, ranked }, null, 2));
console.log('\nledger → /tmp/height-debt-ledger.json\n');
