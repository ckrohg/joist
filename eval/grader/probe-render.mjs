#!/usr/bin/env node
/**
 * @purpose Renderability probe for the section-raster 1:1 plan. Loads a candidate flagship site in
 * headless Chromium (same stealth + scroll-drive + reduced-motion as build-sectionraster.mjs), stitches
 * a full-page capture, and measures how COMPLETELY it renders: blank-fraction per horizontal band.
 * A site that renders fully has low blank everywhere; a Stripe-like site has tall blank bands where its
 * dynamic React sections never paint. Used to pick the cleanest target to prove true ~1:1 on.
 * Usage: node probe-render.mjs --url <url> [--width 1440]
 * Emits one JSON line: {url, pageH, medianBlank, worstBand, worstBandY, bandsOver50, score}
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { assertAllowedBase, assertNotBlocked } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: refuse a stray (e.g. paused *.sg-host.com) URL before any navigation.
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const url = arg('url'), W = parseInt(arg('width', '1440'), 10);
if (!url) { console.error('need --url'); process.exit(2); }
// §0 SAFETY GUARD: assert the URL arg targets a training host (blocks the paused shared host) BEFORE any chromium.goto.
if (url && /^https?:/i.test(url)) assertNotBlocked(url); /* probe target = arbitrary external site */

// theme-agnostic content density: a rendered band has visual variation (text/images/UI); a blank or
// un-rendered band is near-uniform regardless of being light OR dark. Measure fraction of sampled pixels
// whose luminance deviates from the band's mean by >12 — high = real content, ~0 = blank.
const contentFrac = (im, y0, y1) => {
  const lum = []; for (let r = y0; r < y1; r += 3) for (let x = 0; x < im.width; x += 17) { const i = (r * im.width + x) * 4; lum.push(0.299 * im.data[i] + 0.587 * im.data[i + 1] + 0.114 * im.data[i + 2]); }
  if (!lum.length) return 0; const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  let c = 0; for (const v of lum) if (Math.abs(v - mean) > 12) c++; return c / lum.length;
};

(async () => {
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1, locale: 'en-US', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] }); Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] }); window.chrome = { runtime: {} }; });
  const page = await ctx.newPage();
  try { await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await page.goto(url, { waitUntil: 'load', timeout: 60000 }); } catch {} }
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(1500);
  await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 240)); } window.scrollTo(0, 0); });
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  try { await page.addStyleTag({ content: '*{content-visibility:visible!important;contain-intrinsic-size:auto!important}' }); } catch {}
  // click-drive interactive triggers (tabs/accordions) just like the real builder
  try { const trigSel = 'button[role="tab"], [role="tab"]:not(a), button[aria-controls], button[aria-expanded]:not([aria-haspopup])'; const n = await page.evaluate((sel) => document.querySelectorAll(sel).length, trigSel); for (let i = 0; i < Math.min(n, 20); i++) { try { await page.evaluate((sel, idx) => { const el = document.querySelectorAll(sel)[idx]; if (el && el.tagName !== 'A') { el.scrollIntoView({ block: 'center' }); el.click(); } }, trigSel, i); await page.waitForTimeout(150); } catch {} } } catch {}
  await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 220)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(1000);
  const pageH = await page.evaluate(() => document.documentElement.scrollHeight);
  const vh = 900; const out = new PNG({ width: W, height: pageH });
  for (let y = 0; y < pageH; y += vh) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(600);
    if (y > 0) await page.evaluate(() => { for (const e of document.querySelectorAll('*')) { const p = getComputedStyle(e).position; if ((p === 'fixed' || p === 'sticky') && e.getBoundingClientRect().height < 220) e.style.visibility = 'hidden'; } });
    const chunk = PNG.sync.read(await page.screenshot());
    const destY = y; const copyH = Math.min(chunk.height, out.height - destY);
    for (let r = 0; r < copyH; r++) { const s = (r * chunk.width) * 4; chunk.data.copy(out.data, ((destY + r) * out.width) * 4, s, s + Math.min(chunk.width, out.width) * 4); }
  }
  await browser.close();
  // measure content-density per 200px band — theme-agnostic
  const BAND = 200; const bands = [];
  for (let y = 0; y < pageH; y += BAND) bands.push({ y, c: contentFrac(out, y, Math.min(pageH, y + BAND)) });
  const sorted = bands.map(x => x.c).sort((a, b) => a - b);
  const medianContent = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const emptyBands = bands.filter(x => x.c < 0.04).length; // near-uniform → blank/unrendered
  const emptyFrac = emptyBands / bands.length;
  // score: high = renders fully. reward median content, penalize fraction of empty bands hard
  const score = Math.max(0, Math.min(1, medianContent * 2)) * (1 - emptyFrac);
  // save a downscaled full-page capture for visual review (gross completeness, not fidelity)
  const slug = url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 16);
  const SCALE = 4; const tw = Math.round(out.width / SCALE), th = Math.round(out.height / SCALE);
  const thumb = new PNG({ width: tw, height: th });
  for (let yy = 0; yy < th; yy++) for (let xx = 0; xx < tw; xx++) { const si = ((yy * SCALE) * out.width + (xx * SCALE)) * 4, di = (yy * tw + xx) * 4; thumb.data[di] = out.data[si]; thumb.data[di + 1] = out.data[si + 1]; thumb.data[di + 2] = out.data[si + 2]; thumb.data[di + 3] = 255; }
  const fs = await import('fs'); fs.writeFileSync(`/tmp/probe-${slug}.png`, PNG.sync.write(thumb));
  console.log(JSON.stringify({ url, slug, pageH, bands: bands.length, medianContent: +medianContent.toFixed(3), emptyBands, emptyFrac: +emptyFrac.toFixed(3), score: +score.toFixed(3), img: `/tmp/probe-${slug}.png` }));
})();
