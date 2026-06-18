#!/usr/bin/env node
/**
 * @purpose _calib-ladder-gen.mjs — generate MONOTONE DEGRADATION LADDERS for the vision-judge calibration, the fix
 * for the fatal flaw the fusion audit found: the V2 set was BIMODAL (2 trivial-0 mismatches + 8 clones bunched at
 * ~0.7), so its Spearman is dominated by the trivial between-cluster gap and is reachable with ZERO mid-range
 * discrimination — the exact band the judge exists to fix. Ladders give RESOLVING POWER inside the fix-region with a
 * KNOWN partial order (ground-truth ORDER for free; severity != fidelity points, so absolute scores still need human
 * anchoring). For each base clone we synthesize a CUMULATIVE severity staircase L0..L4 (each rung adds one degradation
 * on top of the previous, guaranteeing monotonicity) using salient defects (the judge exists to catch these), not
 * just global blur:
 *   L0 — the clone UNCHANGED (best).
 *   L1 — mild global DESATURATION 35% (subtle washed-out; a real mid-range defect).
 *   L2 — L1 + INVISIBLE HEADING: recolor dark ink in the hero band (8-24% height) toward its local bg (text present
 *        but ~invisible — the subtle defect the old grader was blind to).
 *   L3 — L2 + BLANK HERO band (6-40% height painted to bg — broken/blank hero, a fatal class).
 *   L4 — L3 + BLANK a MID content section (46-66% height to bg) — multiple fatals, near-broken.
 * Order L0>L1>L2>L3>L4 holds BY CONSTRUCTION. The order-recovery test (_calib-ladder-test.mjs) then asks: does the
 * judge RECOVER this monotone ranking per base, and does the fatal floor trip at the human-perceptible rung (L2/L3),
 * not just the cartoon extreme? Writes mutated clone PNGs + a manifest. Renders NOTHING (pure pixel ops on shots).
 *
 * Usage: node _calib-ladder-gen.mjs [--out calibration/ladders] [--bases supabase,linear,framer]
 *   reads base clone+source shots from calibration/v2-shots/<base>-{cln,src}-d.png.
 */
import fs from 'fs';
import path from 'path';
import url from 'url';
import { PNG } from 'pngjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(HERE, arg('out', 'calibration/ladders'));
const SHOTS = path.resolve(HERE, 'calibration/v2-shots');
const BASES = String(arg('bases', 'supabase,linear,framer')).split(',');

// ── pixel ops (monotone, geometry-light: band fractions, no region manifest needed) ──────────────────────────
function load(p) { return PNG.sync.read(fs.readFileSync(p)); }
function clone(img) { const c = new PNG({ width: img.width, height: img.height }); img.data.copy(c.data); return c; }
function desaturate(img, frac) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i] * (1 - frac) + g * frac; d[i + 1] = d[i + 1] * (1 - frac) + g * frac; d[i + 2] = d[i + 2] * (1 - frac) + g * frac;
  }
}
// dominant bg (modal per-channel over a coarse grid) of a horizontal band [y0f,y1f).
function bandBg(img, y0f, y1f) {
  const y0 = Math.floor(img.height * y0f), y1 = Math.floor(img.height * y1f);
  const bins = [{}, {}, {}];
  for (let y = y0; y < y1; y += 7) for (let x = 0; x < img.width; x += 11) {
    const o = (y * img.width + x) * 4; for (let c = 0; c < 3; c++) { const v = img.data[o + c] >> 3 << 3; bins[c][v] = (bins[c][v] || 0) + 1; } }
  return bins.map((b) => +Object.entries(b).sort((a, z) => z[1] - a[1])[0][0]);
}
function paintBand(img, y0f, y1f, [r, g, b]) {
  const y0 = Math.floor(img.height * y0f), y1 = Math.floor(img.height * y1f);
  for (let y = y0; y < y1; y++) for (let x = 0; x < img.width; x++) { const o = (y * img.width + x) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255; }
}
// INVISIBLE HEADING: in a band, recolor pixels DARKER than the band bg (the ink) toward the bg → text present, ~1:1 contrast.
function inkToBg(img, y0f, y1f) {
  const bg = bandBg(img, y0f, y1f); const bgL = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
  const y0 = Math.floor(img.height * y0f), y1 = Math.floor(img.height * y1f);
  for (let y = y0; y < y1; y++) for (let x = 0; x < img.width; x++) {
    const o = (y * img.width + x) * 4; const l = 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2];
    if (Math.abs(l - bgL) > 40) { img.data[o] = bg[0]; img.data[o + 1] = bg[1]; img.data[o + 2] = bg[2]; }   // move ink → bg
  }
}

const RUNGS = [
  { level: 0, label: 'L0-pristine', defect: null, fns: [] },
  { level: 1, label: 'L1-desat35', defect: null, fns: [(i) => desaturate(i, 0.35)] },
  { level: 2, label: 'L2-invis-heading', defect: 'heading', fns: [(i) => desaturate(i, 0.35), (i) => inkToBg(i, 0.08, 0.24)] },
  { level: 3, label: 'L3-blank-hero', defect: 'hero', fns: [(i) => desaturate(i, 0.35), (i) => inkToBg(i, 0.08, 0.24), (i) => paintBand(i, 0.06, 0.40, bandBg(i, 0.06, 0.40))] },
  { level: 4, label: 'L4-blank-hero+section', defect: 'hero', fns: [(i) => desaturate(i, 0.35), (i) => inkToBg(i, 0.08, 0.24), (i) => paintBand(i, 0.06, 0.40, bandBg(i, 0.06, 0.40)), (i) => paintBand(i, 0.46, 0.66, bandBg(i, 0.46, 0.66))] },
];

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = { tool: 'joist-calib-ladders', version: 1, bases: [] };
  for (const base of BASES) {
    const clnP = path.join(SHOTS, `${base}-cln-d.png`), srcP = path.join(SHOTS, `${base}-src-d.png`);
    if (!fs.existsSync(clnP) || !fs.existsSync(srcP)) { console.error(`SKIP ${base}: missing ${clnP} or ${srcP}`); continue; }
    const orig = load(clnP);
    const rungs = [];
    for (const r of RUNGS) {
      const img = clone(orig); for (const fn of r.fns) fn(img);
      const outImg = path.join(OUT, `${base}-${r.label}.png`);
      fs.writeFileSync(outImg, PNG.sync.write(img));
      rungs.push({ level: r.level, label: r.label, defect: r.defect, clone_img: path.relative(path.resolve(HERE, '..', '..'), outImg) });
    }
    manifest.bases.push({ base, source_img: path.relative(path.resolve(HERE, '..', '..'), srcP), rungs });
    console.log(`  ${base}: ${rungs.length} rungs → ${path.relative(process.cwd(), OUT)}/${base}-L*.png`);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`ladders: ${manifest.bases.length} base(s), manifest → ${path.relative(process.cwd(), path.join(OUT, 'manifest.json'))}`);
}
main();
