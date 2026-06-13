#!/usr/bin/env node
/** @purpose Diagnose why the section-raster clone renders over-tall: report page scroll width/height
 * and the first few image widgets' displayed vs natural size + computed width/max-width. */
import { chromium } from 'playwright';
const url = process.argv[2];
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const p = await ctx.newPage(); await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); await p.waitForTimeout(1500);
const info = await p.evaluate(() => {
  const r = { scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, innerW: innerWidth };
  const imgs = [...document.querySelectorAll('img')].slice(0, 4).map((im) => { const cs = getComputedStyle(im); const b = im.getBoundingClientRect(); return { natW: im.naturalWidth, natH: im.naturalHeight, dispW: Math.round(b.width), dispH: Math.round(b.height), cssW: cs.width, maxW: cs.maxWidth, src: im.currentSrc.split('/').pop() }; });
  const cont = document.querySelector('.e-con, .elementor-container, [data-element_type="container"]');
  r.containerW = cont ? Math.round(cont.getBoundingClientRect().width) : null;
  r.imgs = imgs; return r;
});
console.log(JSON.stringify(info, null, 2));
await b.close();
