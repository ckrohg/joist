#!/usr/bin/env node
// @purpose render-exemplar.mjs — WP-free render of an authored exemplar/falsifier HTML in LOCAL
// chromium (EMBODIMENT_APPROACH §P3: render path is explicitly pre-transpile, local). Renders at the
// given viewport width, full content height (capped), reduced motion, deterministic settle.
// usage: node render-exemplar.mjs <file.html> <width> <out.png> [maxH]
import path from 'path';
import { pathToFileURL } from 'url';
import { chromium } from 'playwright';

const [htmlFile, widthS, outPath, maxHS] = process.argv.slice(2);
const width = parseInt(widthS, 10), maxH = parseInt(maxHS || '4000', 10);
if (!htmlFile || !width || !outPath) { console.error('usage: render-exemplar.mjs <file.html> <width> <out.png> [maxH]'); process.exit(2); }

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width, height: 1200 }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.resolve(htmlFile)).href, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(300);
  const h = Math.min(maxH, await page.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height) || document.body.scrollHeight));
  await page.setViewportSize({ width, height: Math.max(200, Math.min(h, maxH)) });
  await page.waitForTimeout(200);
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width, height: Math.max(200, Math.min(h, maxH)) } });
  console.log('OK', outPath, `${width}x${Math.max(200, Math.min(h, maxH))}`);
} finally { await browser.close(); }
