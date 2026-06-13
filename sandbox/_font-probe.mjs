#!/usr/bin/env node
/**
 * @purpose Probe the actually-rendered font-family of .elementor heading widgets on a
 * rendered local page and screenshot the top band. Used to verify the Suisse webfont
 * registration (mu-plugin @font-face) takes effect — heading must resolve to Suisse,
 * not the Helvetica fallback. Reports per-heading {text, declaredFamily, renderedFamily,
 * usingSuisse} where usingSuisse is true when the browser actually loaded a Suisse face
 * (document.fonts check), not merely declared it.
 */
import { chromium } from 'playwright';

const url = process.argv[2];
const shot = process.argv[3];
const width = Number(process.argv[4] || 1440);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);

const data = await page.evaluate(() => {
  const out = [];
  const heads = document.querySelectorAll('.elementor-heading-title, h1, h2');
  for (const h of [...heads].slice(0, 6)) {
    const cs = getComputedStyle(h);
    const fam = cs.fontFamily;
    const wt = cs.fontWeight;
    // does the document actually have a Suisse face loaded?
    let suisseLoaded = false;
    try { suisseLoaded = document.fonts.check(`${wt} 16px Suisse`); } catch (e) {}
    out.push({
      text: (h.textContent || '').trim().slice(0, 50),
      renderedFamily: fam,
      weight: wt,
      fontSize: cs.fontSize,
      suisseLoaded,
    });
  }
  // list loaded font faces
  const loaded = [];
  document.fonts.forEach((f) => { if (f.status === 'loaded') loaded.push(`${f.family}:${f.weight}`); });
  return { heads: out, loadedFaces: [...new Set(loaded)] };
});

if (shot) await page.screenshot({ path: shot, clip: { x: 0, y: 0, width, height: 900 } });
console.log(JSON.stringify(data, null, 2));
await browser.close();
