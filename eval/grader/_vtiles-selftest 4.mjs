/**
 * @purpose Offline deterministic self-test for grade-vision-tiles.mjs content-anchored tiling.
 * Proves (1) SELF-TEST: source==clone → identity → byte-identical to fixed-y. (2) DRIFT CORRECTION: a source
 * painted 400px off its DOM y is realigned so the anchored source cell matches the clone content. (3) ANTI-GAMING:
 * a genuine clone void is NOT hidden — its band still pairs source-content vs clone-void (low fidelity).
 * Pure-function harness; launches no browser. Run: node _vtiles-selftest.mjs
 */
import { PNG } from 'pngjs';
import { crop, matchAnchors, refineSourcePaintedY, buildMap } from './grade-vision-tiles.mjs';

const W = 1440, H = 6000, ROW_H = 600, BLOCK = 600; // one content block per tile band (clean 1:1 band↔block)
// distinct, content-specific texture per block so a wrong pairing is detectable (deterministic hash → rgb)
function paintBlock(png, y0, h, id, blank = false) {
  for (let r = 0; r < h; r++) {
    const yy = y0 + r; if (yy < 0 || yy >= png.height) continue;
    for (let x = 0; x < W; x++) {
      const i = (yy * png.width + x) << 2;
      let R, G, B;
      if (blank) { R = G = B = 8; } // void = near-black, low energy
      else {
        // a busy per-block pattern: depends on id so blocks are mutually distinguishable
        const v = ((id * 53 + ((x >> 3) ^ (r >> 2)) * 17) % 256);
        R = (v * 37) & 255; G = (v * 91 + id * 13) & 255; B = (v * 53 + id * 29) & 255;
      }
      png.data[i] = R; png.data[i + 1] = G; png.data[i + 2] = B; png.data[i + 3] = 255;
    }
  }
}
function blankPng(h) { const p = new PNG({ width: W, height: h }); for (let i = 0; i < p.data.length; i += 4) { p.data[i] = p.data[i + 1] = p.data[i + 2] = 16; p.data[i + 3] = 255; } return p; }

// mean-abs pixel diff between two equal-size PNGs (0 = identical)
function pdiff(a, b) {
  let s = 0; const n = Math.min(a.data.length, b.data.length);
  for (let i = 0; i < n; i += 4) s += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
  return s / (n / 4 * 3);
}

const NBLOCK = Math.floor(H / BLOCK);
// "DOM y" of each block = id*BLOCK (true at-rest layout y, identical for src & clone — the diagnosis invariant).
const leaves = []; for (let id = 0; id < NBLOCK; id++) leaves.push({ key: 'BLOCK_' + id, y: id * BLOCK });

function buildSrcYof(srcShot, clnShot, srcLeaves, clnLeaves, anchor) {
  if (!anchor) return (cy) => cy;
  const anchors = matchAnchors(srcLeaves, clnLeaves);
  const pairs = [];
  for (const a of anchors) { const sp = refineSourcePaintedY(srcShot, clnShot, a.srcDomY, a.clnDomY); pairs.push({ cln: a.clnDomY, src: sp == null ? a.srcDomY : sp }); }
  return buildMap(pairs, srcShot.height, clnShot.height);
}

// emit the SOURCE-cell crops for every fixed clone band, using the supplied srcYof map (mirrors the tiler loop)
function srcCells(srcShot, clnShot, srcYof) {
  const Hc = Math.min(srcShot.height, clnShot.height); const cells = [];
  for (let y0 = 0; y0 < Hc; y0 += ROW_H) { const h = Math.min(ROW_H, Hc - y0); if (h < 40) break; const sY0 = Math.round(srcYof(y0)); cells.push({ y0, h, sY0, src: crop(srcShot, 0, sY0, W, h), clnCell: crop(clnShot, 0, y0, W, h) }); }
  return cells;
}

let pass = true; const log = (ok, msg) => { if (!ok) pass = false; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

// ───────────────────────── TEST 1: SELF-TEST (source == clone) ─────────────────────────
{
  const shot = blankPng(H); for (let id = 0; id < NBLOCK; id++) paintBlock(shot, id * BLOCK, BLOCK, id);
  const srcYof = buildSrcYof(shot, shot, leaves, leaves, true);
  // identity check across the page
  let maxDelta = 0; for (let y = 0; y < H - ROW_H; y += 137) maxDelta = Math.max(maxDelta, Math.abs(srcYof(y) - y));
  log(maxDelta <= 1.5, `T1 self-test: src==clone → map ≈ identity (max |Δ| = ${maxDelta.toFixed(2)}px, ≤1.5)`);
  // tiles byte-identical to fixed-y
  const anchored = srcCells(shot, shot, srcYof);
  const fixed = srcCells(shot, shot, (cy) => cy);
  let maxd = 0; for (let i = 0; i < anchored.length; i++) maxd = Math.max(maxd, pdiff(anchored[i].src, fixed[i].src));
  log(maxd === 0, `T1 self-test: anchored source-cells BYTE-IDENTICAL to fixed-y (max pdiff = ${maxd})`);
}

// ───────────────────────── TEST 2: DRIFT CORRECTION ─────────────────────────
// Clone paints at DOM y (static). Source paints DRIFTED: blocks above row 12 shifted UP 400px (parallax/reveal),
// mimicking resend (source content painted ~400px higher than DOM). DOM y (leaves) is the SAME for both.
{
  const DRIFT = 400, FROM = 12; // blocks 0..11 drift up by 400px in the SOURCE paint
  const cln = blankPng(H); for (let id = 0; id < NBLOCK; id++) paintBlock(cln, id * BLOCK, BLOCK, id); // clone: paint == DOM
  const src = blankPng(H);
  for (let id = 0; id < NBLOCK; id++) { const paintY = id < FROM ? id * BLOCK - DRIFT : id * BLOCK; paintBlock(src, paintY, BLOCK, id); }
  // ANCHORED
  const srcYofA = buildSrcYof(src, cln, leaves, leaves, true);
  const A = srcCells(src, cln, srcYofA);
  // FIXED (the buggy original)
  const F = srcCells(src, cln, (cy) => cy);
  // metric: at the drift band (clone band y0 ≈ 1200 → 3600, blocks 4..11 region), the ANCHORED source cell should
  // MATCH the clone cell (same content) while the FIXED source cell does NOT (drift → wrong content paired).
  // We measure mean pdiff(source-cell, clone-cell) over the drifted band; anchored should be ≪ fixed.
  // drifted blocks are 0..11 → DOM y 0..7200; clone bands fully inside the drifted region: y0 1200..6000
  const band = A.filter((c) => c.y0 >= 1200 && c.y0 < 6000);
  const fb = F.filter((c) => c.y0 >= 1200 && c.y0 < 6000);
  const aDiff = band.reduce((s, c) => s + pdiff(c.src, c.clnCell), 0) / band.length;
  const fDiff = fb.reduce((s, c) => s + pdiff(c.src, c.clnCell), 0) / fb.length;
  log(aDiff < fDiff * 0.5, `T2 drift: anchored source≈clone in drift band (anchored pdiff ${aDiff.toFixed(1)} ≪ fixed pdiff ${fDiff.toFixed(1)})`);
  log(aDiff < 12, `T2 drift: anchored source-vs-clone near-zero (pdiff ${aDiff.toFixed(1)} < 12 → corresponding content paired)`);
}

// ───────────────────────── TEST 3: ANTI-GAMING (genuine clone void must stay LOW) ─────────────────────────
// Source has all blocks. Clone is MISSING block 8 (a real defect: rendered as a void). The clone has NO landmark
// for block 8 (the diagnosis matcher needs text on BOTH sides). The anchored map must NOT pull source-block-8
// out of existence: the clone band covering block 8 still pairs SOURCE-block-8 content vs CLONE-void → LOW fidelity.
{
  const src = blankPng(H); for (let id = 0; id < NBLOCK; id++) paintBlock(src, id * BLOCK, BLOCK, id);
  const cln = blankPng(H);
  for (let id = 0; id < NBLOCK; id++) paintBlock(cln, id * BLOCK, BLOCK, id, /*blank=*/ id === 8); // block 8 = clone void
  const clnLeaves = leaves.filter((l) => l.key !== 'BLOCK_8'); // clone has NO text for the missing block
  const srcYof = buildSrcYof(src, cln, leaves, clnLeaves, true);
  const cells = srcCells(src, cln, srcYof);
  // block 8 = DOM y 4800..5400 == exactly the clone band y0=4800 (block size == band size).
  const voidBand = cells.find((c) => c.y0 === 4800);
  // clone cell must be (near) void
  const cloneEnergy = (() => { let s = 0; const d = voidBand.clnCell.data; for (let i = 0; i < d.length; i += 4) s += Math.abs(d[i] - 16); return s / (d.length / 4); })();
  // source cell must STILL carry block-8 content (anti-gaming: not hidden / not realigned away)
  const srcVsClone = pdiff(voidBand.src, voidBand.clnCell);
  log(cloneEnergy < 10, `T3 anti-gaming: clone void band is near-empty (energy ${cloneEnergy.toFixed(1)} < 10 vs full-content ~112)`);
  log(srcVsClone > 40, `T3 anti-gaming: source-content STILL paired with clone-void → scores LOW (src↔clone pdiff ${srcVsClone.toFixed(1)} > 40, NOT hidden)`);
  // and the source cell is NOT itself blank (it carries real content the clone lacks)
  const srcEnergy = (() => { let s = 0; const d = voidBand.src.data; for (let i = 0; i < d.length; i += 4) s += Math.abs(d[i] - 16); return s / (d.length / 4); })();
  log(srcEnergy > 30, `T3 anti-gaming: source cell carries the real (missing) block (energy ${srcEnergy.toFixed(1)} > 30)`);
}

console.log(pass ? '\nSELFTEST: ALL PASS' : '\nSELFTEST: FAIL');
process.exit(pass ? 0 : 1);
