// @purpose Probe live clone DOM for the metrics/audience imagery in the void band.
import { chromium } from 'playwright';
const CLONE = 'https://georges232.sg-host.com/?page_id=2988';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(CLONE, { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
await page.waitForTimeout(2000);
await page.evaluate(async () => { const h = document.body.scrollHeight; for (let y=0;y<h;y+=600){ window.scrollTo(0,y); await new Promise(r=>setTimeout(r,100)); } window.scrollTo(0,0); });
await page.waitForTimeout(1500);
// list all imgs in y9000-10400 band with their src + natural dims + rendered box
const imgs = await page.evaluate(() => {
  const out = [];
  for (const im of document.querySelectorAll('img')) {
    const r = im.getBoundingClientRect();
    const top = r.top + window.scrollY;
    if (top >= 8800 && top <= 10600) {
      out.push({ top: Math.round(top), w: Math.round(r.width), h: Math.round(r.height), nat: im.naturalWidth+'x'+im.naturalHeight, complete: im.complete, src: (im.currentSrc||im.src||'').slice(0,120) });
    }
  }
  return out;
});
// also any element with background-image in that band
const bgs = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    const top = r.top + window.scrollY;
    if (top >= 8800 && top <= 10600 && r.height > 150 && r.width > 300) {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') out.push({ top: Math.round(top), w: Math.round(r.width), h: Math.round(r.height), tag: el.tagName, bg: bg.slice(0,120) });
    }
  }
  return out.slice(0,15);
});
console.log('IMGS:', JSON.stringify(imgs, null, 1));
console.log('BGS:', JSON.stringify(bgs, null, 1));
await browser.close();
