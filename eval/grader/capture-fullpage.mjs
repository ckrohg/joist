#!/usr/bin/env node
/**
 * @purpose capture-fullpage.mjs — RELIABLE full-page screenshot via fixed-viewport scroll-tile-stitch. Playwright's
 * `fullPage:true` resizes the layout viewport to the full page height, which re-triggers viewport-relative CSS
 * (100vh heroes, sticky/translate layers) on tall Elementor CLONES and renders a BLANK WHITE image — which silently
 * POISONS every vision grade built on it (region-judge scored a faithful resend clone 0/100 "invisible text, white
 * background" purely from this artifact; the same page screenshotted per-viewport is correct dark-bg). This captures
 * at a FIXED viewport (the page never re-layouts), scrolls in viewport-high steps, and stitches the raw viewport
 * shots into one tall PNG. Foundation for all vision grading.
 *
 *   captureFullPage(page, { vw=1440, vh=900 }) → PNG   (page already navigated + settled)
 *   CLI: node capture-fullpage.mjs --url <url> --out <png> [--vw 1440] [--vh 900]
 *
 * Robustness: (1) hides position:fixed/sticky elements AFTER the first tile so a sticky header isn't stamped into
 * every tile; (2) reads the REAL post-scroll offset (bottom clamp) and places each tile by it; (3) settles lazy
 * content with a full scroll-through before measuring height; (4) caps total height to avoid runaway.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'fs';

const MAX_H = 40000;

export async function captureFullPage(page, { vw = 1440, vh = 900 } = {}) {
  await page.setViewportSize({ width: vw, height: vh });
  // NOTE: deliberately NO scroll-to-bottom-and-back pre-pass. On some tall Elementor clones a full pre-scroll
  // mutates layout so a subsequent scroll-to-0 no longer shows the true top (the hero ends up replaced by a
  // mid-page section). Instead we descend tile-by-tile from a fresh top — the incremental descent settles lazy
  // content progressively, and tile 0 is always captured at a pristine scroll-0.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const H = Math.min(await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)), MAX_H);
  const out = new PNG({ width: vw, height: H });
  const settle = async (target) => {
    await page.evaluate((y) => window.scrollTo(0, y), target);
    let last = -1, cur = 0;
    for (let i = 0; i < 14; i++) { await page.waitForTimeout(60); cur = await page.evaluate(() => Math.round(window.scrollY)); if (cur === last) break; last = cur; }
    return cur;
  };
  let firstDone = false;
  for (let top = 0; top < H; top += vh) {
    const target = (top + vh >= H) ? Math.max(0, H - vh) : top;
    const realY = await settle(target);
    const tile = PNG.sync.read(await page.screenshot()); // raw viewport (vw × vh), unambiguous
    const srcYoff = top - realY;                          // ≥0; >0 only on the bottom-clamped last tile
    const h = Math.min(vh - srcYoff, H - top);
    if (h > 0 && srcYoff >= 0 && srcYoff < vh) PNG.bitblt(tile, out, 0, srcYoff, vw, h, 0, top);
    if (!firstDone) { // after tile 0, HIDE truly viewport-pinned chrome so a sticky header isn't repeated down the page.
      // Use visibility:hidden (NO reflow) — NOT position:absolute, which collapses complex source layouts to black
      // (resend's source has many fixed/sticky/translate layers; reparenting them destroyed the page). Only 'fixed'
      // (viewport-pinned, genuinely repeats); 'sticky' scrolls within its container and won't repeat at our offsets.
      await page.evaluate(() => { for (const el of document.querySelectorAll('*')) { if (getComputedStyle(el).position === 'fixed') el.style.setProperty('visibility', 'hidden', 'important'); } });
      firstDone = true;
    }
  }
  return out;
}

const IS_MAIN = process.argv[1] && process.argv[1].endsWith('capture-fullpage.mjs');
if (IS_MAIN) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
  const url = arg('url'), out = arg('out'); const vw = +arg('vw', 1440), vh = +arg('vh', 900);
  if (!url || !out) { console.error('usage: --url <url> --out <png> [--vw 1440] [--vh 900]'); process.exit(2); }
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 })).newPage();
  await p.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const png = await captureFullPage(p, { vw, vh });
  fs.writeFileSync(out, PNG.sync.write(png));
  console.log(`captured ${out} (${png.width}x${png.height})`);
  await b.close();
}
