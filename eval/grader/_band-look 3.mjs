/**
 * @purpose Crop specific y-bands from a SOURCE and CLONE full-page screenshot into side-by-side PNGs for a human
 * LOOK (is a flagged "content-void" genuine, or a dark+sparse-bright headline the clone actually rendered?).
 * Run: node _band-look.mjs --source <url> --clone <url> --bands y0:y1,y0:y1 --out <dir>
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const source = arg('source'), clone = arg('clone'), outDir = arg('out', '/tmp/band-look'), W = 1440;
const bands = (arg('bands', '') || '').split(',').filter(Boolean).map((s) => s.split(':').map(Number));
fs.mkdirSync(outDir, { recursive: true });

async function shoot(ctx, url) {
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(2500);
  await p.evaluate(async () => { const h = document.body.scrollHeight; for (let y = 0; y < h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); } window.scrollTo(0, 0); });
  await p.waitForTimeout(1000);
  const png = PNG.sync.read(await p.screenshot({ fullPage: true }));
  await p.close(); return png;
}
function crop(src, y0, y1) { const h = y1 - y0; const o = new PNG({ width: W, height: h }); for (let r = 0; r < h; r++) for (let x = 0; x < W; x++) { const sy = y0 + r; const di = (r * W + x) << 2; if (sy < src.height && x < src.width) { const si = (sy * src.width + x) << 2; o.data[di] = src.data[si]; o.data[di + 1] = src.data[si + 1]; o.data[di + 2] = src.data[si + 2]; o.data[di + 3] = 255; } else { o.data[di] = o.data[di + 1] = o.data[di + 2] = 30; o.data[di + 3] = 255; } } return o; }
function sideBySide(l, r) { const h = Math.max(l.height, r.height), GAP = 24, w = l.width + GAP + r.width; const o = new PNG({ width: w, height: h }); o.data.fill(255); const blit = (img, ox) => { for (let rr = 0; rr < img.height; rr++) for (let c = 0; c < img.width; c++) { const si = (rr * img.width + c) << 2, di = (rr * w + ox + c) << 2; o.data[di] = img.data[si]; o.data[di + 1] = img.data[si + 1]; o.data[di + 2] = img.data[si + 2]; o.data[di + 3] = 255; } }; blit(l, 0); blit(r, l.width + GAP); for (let rr = 0; rr < h; rr++) for (let c = l.width + 4; c < l.width + GAP - 4; c++) { const di = (rr * w + c) << 2; o.data[di] = 255; o.data[di + 1] = 0; o.data[di + 2] = 220; o.data[di + 3] = 255; } return o; }

(async () => {
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const s = await shoot(ctx, source);
  const c = await shoot(ctx, clone);
  await browser.close();
  console.log(JSON.stringify({ srcH: s.height, cloneH: c.height }));
  for (const [y0, y1] of bands) {
    const comp = sideBySide(crop(s, y0, y1), crop(c, y0, y1));
    const f = path.join(outDir, `band-${y0}-${y1}.png`);
    fs.writeFileSync(f, PNG.sync.write(comp));
    console.log('wrote', f);
  }
})();
