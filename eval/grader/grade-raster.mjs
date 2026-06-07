#!/usr/bin/env node
/**
 * @purpose HONEST 1:1 grader for SECTION-RASTER clones. grader-v2 counts DOM text elements, so it
 * unfairly scores an all-image raster clone ~0 (no selectable text) even when pixel-perfect — a
 * deflation lie. A raster clone's only meaningful question is "are the painted pixels the SAME as the
 * source?", so this grades PURELY on pixels: per-band SSIM (structure) + LAB ΔE (color) + exact-pixel
 * match fraction (per-pixel ΔE<8). Reports multiple honest numbers (never one cooked score) + saves
 * side-by-side crops of the worst and best bands so a human/agent can LOOK and confirm.
 * Usage: node grade-raster.mjs --source <url|file.png> --clone <url> [--out /tmp/raster] [--width 1440]
 */
import fs from 'fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const source = arg('source'), clone = arg('clone'), outDir = arg('out', '/tmp/raster'), W = parseInt(arg('width', '1440'), 10);
if (!source || !clone) { console.error('need --source --clone'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

const gray = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
const srgbLab = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; let R = f(r), G = f(g), B = f(b); let X = (R * .4124 + G * .3576 + B * .1805) / .95047, Y = R * .2126 + G * .7152 + B * .0722, Z = (R * .0193 + G * .1192 + B * .9505) / 1.08883; const g2 = (t) => t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; return [116 * g2(Y) - 16, 500 * (g2(X) - g2(Y)), 200 * (g2(Y) - g2(Z))]; };
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// windowed SSIM over a same-size band pair
function ssim(a, b) { const Wd = Math.min(a.width, b.width), H = Math.min(a.height, b.height), win = 8, C1 = 6.5, C2 = 58.5; let tot = 0, n = 0; for (let by = 0; by + win <= H; by += win) for (let bx = 0; bx + win <= Wd; bx += win) { let ma = 0, mb = 0; for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const ia = ((by + y) * a.width + bx + x) * 4, ib = ((by + y) * b.width + bx + x) * 4; ma += gray(a.data, ia); mb += gray(b.data, ib); } const N = win * win; ma /= N; mb /= N; let va = 0, vb = 0, cov = 0; for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const ia = ((by + y) * a.width + bx + x) * 4, ib = ((by + y) * b.width + bx + x) * 4; const da = gray(a.data, ia) - ma, db = gray(b.data, ib) - mb; va += da * da; vb += db * db; cov += da * db; } va /= N - 1; vb /= N - 1; cov /= N - 1; tot += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++; } return n ? tot / n : 1; }
// per-pixel exact-match fraction (sampled) + mean ΔE over a same-region band pair
function pixelStats(a, b, y0, y1) { let exact = 0, n = 0, sumDE = 0; const Wd = Math.min(a.width, b.width); for (let y = y0; y < y1; y += 2) for (let x = 0; x < Wd; x += 2) { const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4; const la = srgbLab(a.data[ia], a.data[ia + 1], a.data[ia + 2]); const lb = srgbLab(b.data[ib], b.data[ib + 1], b.data[ib + 2]); const d = dE(la, lb); sumDE += d; if (d < 8) exact++; n++; } return { exactFrac: n ? exact / n : 0, meanDE: n ? sumDE / n : 0 }; }
function bandImg(full, y0, y1) { const y = Math.max(0, Math.round(y0)); const h = Math.max(2, Math.min(full.height - y, Math.round(y1 - y0))); const o = new PNG({ width: full.width, height: h }); for (let r = 0; r < h; r++) { const s = ((y + r) * full.width) * 4; full.data.copy(o.data, (r * full.width) * 4, s, s + full.width * 4); } return o; }
// side-by-side source|clone for a band, for visual LOOK
function sideBySide(src, cln, y0, y1) { const h = Math.min(y1, src.height, cln.height) - y0; if (h < 4) return null; const gap = 12; const o = new PNG({ width: W * 2 + gap, height: h }); for (let i = 0; i < o.data.length; i += 4) { o.data[i] = o.data[i + 1] = o.data[i + 2] = 40; o.data[i + 3] = 255; } for (let r = 0; r < h; r++) { let s = ((y0 + r) * src.width) * 4; src.data.copy(o.data, (r * o.width) * 4, s, s + Math.min(W, src.width) * 4); s = ((y0 + r) * cln.width) * 4; cln.data.copy(o.data, (r * o.width + (W + gap)) * 4, s, s + Math.min(W, cln.width) * 4); } return o; }

async function capture(ctx, target) {
  const p = await ctx.newPage(); await p.setViewportSize({ width: W, height: 900 });
  const isFile = !/^https?:/.test(target);
  if (isFile) { return PNG.sync.read(fs.readFileSync(target)); }
  try { await p.goto(target, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(target, { waitUntil: 'load', timeout: 30000 }); } catch {} }
  await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(1200);
  await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 200)); } window.scrollTo(0, 0); });
  try { await p.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  await p.waitForTimeout(800);
  const shot = PNG.sync.read(await p.screenshot({ fullPage: true }));
  await p.close(); return shot;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  const src = await capture(ctx, source);
  const cln = await capture(ctx, clone);
  await browser.close();
  const sH = src.height, cH = cln.height; const hRatio = cH / sH;
  const H = Math.min(sH, cH); const BAND = 200; const bands = [];
  for (let y = 0; y < H; y += BAND) {
    const y1 = Math.min(H, y + BAND);
    const sb = bandImg(src, y, y1), cb = bandImg(cln, y, y1);
    const s = ssim(sb, cb); const px = pixelStats(src, cln, y, y1);
    bands.push({ y, ssim: +s.toFixed(3), exactFrac: +px.exactFrac.toFixed(3), meanDE: +px.meanDE.toFixed(2) });
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const ssimArr = bands.map(b => b.ssim), exArr = bands.map(b => b.exactFrac), deArr = bands.map(b => b.meanDE);
  const sortedS = [...ssimArr].sort((a, b) => a - b);
  const worst = [...bands].sort((a, b) => a.ssim - b.ssim).slice(0, 3);
  const best = [...bands].sort((a, b) => b.ssim - a.ssim).slice(0, 2);
  // save side-by-side crops of worst+best bands (LOOK)
  for (const grp of [['worst', worst], ['best', best]]) { let k = 0; for (const b of grp[1]) { const sb = sideBySide(src, cln, b.y, b.y + BAND * 3); if (sb) fs.writeFileSync(`${outDir}/${grp[0]}-${k}-y${b.y}.png`, PNG.sync.write(sb)); k++; } }
  const report = {
    source, clone, srcH: sH, cloneH: cH, hRatio: +hRatio.toFixed(3),
    bands: bands.length,
    ssim_mean: +mean(ssimArr).toFixed(3), ssim_median: +sortedS[Math.floor(sortedS.length / 2)].toFixed(3), ssim_min: +Math.min(...ssimArr).toFixed(3),
    exactPixel_mean: +mean(exArr).toFixed(3), exactPixel_min: +Math.min(...exArr).toFixed(3),
    meanDE_mean: +mean(deArr).toFixed(2), meanDE_max: +Math.max(...deArr).toFixed(2),
    worstBands: worst.map(b => ({ y: b.y, ssim: b.ssim, exact: b.exactFrac, dE: b.meanDE })),
    out: outDir,
  };
  console.log(JSON.stringify(report, null, 2));
})();
