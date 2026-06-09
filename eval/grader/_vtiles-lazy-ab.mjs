/**
 * @purpose A/B harness for the grade-vision-tiles.mjs lazy-image de-deflation (2026-06-09).
 * Screenshots a CLONE page full-page TWICE — once via the LEGACY fast settle (== VTILES_NO_LAZY_TRIGGER=1) and
 * once via the new robust settleLazy() — using the SAME exported code the tiler uses. Crops a band and reports
 * near-white fraction + mean colour energy. A genuine lazy-void (white in legacy) should drop in whiteness /
 * gain energy under the robust trigger; an innocent control band should be ~unchanged (proving no perturbation).
 * Source render is irrelevant here (this isolates the clone's own lazy painting), so it sidesteps the broken
 * react.dev render in this network. Run: node _vtiles-lazy-ab.mjs --clone <url> --out <dir> --band y0,y1
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { settleLazy } from './grade-vision-tiles.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const clone = arg('clone'), outDir = arg('out', '/tmp/vt-lazy-ab'), W = +arg('width', 1440);
const band = (arg('band', '') || '').split(',').map(Number); // optional [y0,y1] clone-px band of interest
if (!clone) { console.error('need --clone'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

async function legacySettle(p) { // byte-identical to the VTILES_NO_LAZY_TRIGGER=1 branch in capture()
  await p.evaluate(async () => { const h = document.body.scrollHeight; for (let y = 0; y < h; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
  await p.waitForTimeout(1200);
}

async function shoot(ctx, mode) {
  const p = await ctx.newPage();
  await p.goto(clone, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(2500);
  if (mode === 'legacy') await legacySettle(p); else await settleLazy(p);
  const png = PNG.sync.read(await p.screenshot({ fullPage: true }));
  await p.close();
  return png;
}

// near-white fraction + mean abs energy vs white, over an optional [y0,y1] band (else whole page)
function stats(png, y0, y1) {
  y0 = Math.max(0, y0 | 0); y1 = Math.min(png.height, (y1 || png.height) | 0);
  let white = 0, n = 0, energy = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) << 2; const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    if (r > 240 && g > 240 && b > 240) white++;
    energy += (765 - r - g - b); n++;
  }
  return { whiteFrac: +(white / n).toFixed(4), energy: +(energy / n).toFixed(2), px: n, y0, y1 };
}

(async () => {
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const off = await shoot(ctx, 'legacy');
  const on = await shoot(ctx, 'robust');
  await browser.close();

  fs.writeFileSync(path.join(outDir, 'off-full.png'), PNG.sync.write(off));
  fs.writeFileSync(path.join(outDir, 'on-full.png'), PNG.sync.write(on));
  const [by0, by1] = band.length === 2 ? band : [0, Math.min(off.height, on.height)];
  const cropPng = (png) => { const h = by1 - by0; const o = new PNG({ width: png.width, height: h }); for (let r = 0; r < h; r++) for (let x = 0; x < png.width; x++) { const si = ((by0 + r) * png.width + x) << 2, di = (r * png.width + x) << 2; o.data[di] = png.data[si]; o.data[di + 1] = png.data[si + 1]; o.data[di + 2] = png.data[si + 2]; o.data[di + 3] = 255; } return o; };
  if (band.length === 2) { fs.writeFileSync(path.join(outDir, 'off-band.png'), PNG.sync.write(cropPng(off))); fs.writeFileSync(path.join(outDir, 'on-band.png'), PNG.sync.write(cropPng(on))); }

  const sOff = stats(off, by0, by1), sOn = stats(on, by0, by1);
  const full = { offH: off.height, onH: on.height };
  console.log(JSON.stringify({ clone, band: [by0, by1], full, off: sOff, on: sOn,
    delta: { whiteFrac: +(sOn.whiteFrac - sOff.whiteFrac).toFixed(4), energy: +(sOn.energy - sOff.energy).toFixed(2) } }, null, 2));
})();
