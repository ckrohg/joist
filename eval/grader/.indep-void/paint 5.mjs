// @purpose Definitive paint test — scroll metrics band into view, force-decode, screenshot what a real viewer sees.
import { chromium } from 'playwright';
import path from 'path';
const OUT = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/.indep-void';
const CLONE = 'https://georges232.sg-host.com/?page_id=2988';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(CLONE, { waitUntil: 'load', timeout: 60000 }).catch(()=>{});
await page.waitForTimeout(1500);
// find the metrics img, scroll it to viewport center, wait for natural decode
const before = await page.evaluate(() => {
  const im = [...document.querySelectorAll('img')].find(i => (i.currentSrc||i.src||'').includes('image-68-scaled'));
  if (!im) return { found:false };
  im.scrollIntoView({ block: 'center' });
  return { found:true, nat: im.naturalWidth+'x'+im.naturalHeight, complete: im.complete, loading: im.loading };
});
await page.waitForTimeout(4000);
const after = await page.evaluate(async () => {
  const im = [...document.querySelectorAll('img')].find(i => (i.currentSrc||i.src||'').includes('image-68-scaled'));
  if (!im) return { found:false };
  try { im.loading='eager'; if (im.decode) await im.decode(); } catch(e){}
  const r = im.getBoundingClientRect();
  return { found:true, nat: im.naturalWidth+'x'+im.naturalHeight, complete: im.complete, vis:{top:Math.round(r.top),h:Math.round(r.height)} };
});
console.log('BEFORE', JSON.stringify(before));
console.log('AFTER ', JSON.stringify(after));
await page.screenshot({ path: path.join(OUT, 'metrics-inview.png') });
await browser.close();
