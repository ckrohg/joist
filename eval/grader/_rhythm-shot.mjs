/**
 * @purpose _rhythm-shot.mjs — minimal headless render+measure helper for the rhythm normalizer: full-page
 * screenshot + docHeight + broken-image count at a given viewport. Lives in eval/grader so `playwright`
 * resolves from the local node_modules. Usage: node _rhythm-shot.mjs <url> <out.png> [width=1440]
 */
import { chromium } from 'playwright';
const url = process.argv[2], out = process.argv[3], W = +(process.argv[4]||1440);
const b = await chromium.launch({ headless: true });
const p = await (await b.newContext({ viewport: { width: W, height: 1000 }, deviceScaleFactor: 1 })).newPage();
await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
// settle lazy images
await p.evaluate(async () => { window.scrollTo(0, document.body.scrollHeight); await new Promise(r=>setTimeout(r,400)); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,300)); });
const docH = await p.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
const broken = await p.evaluate(() => [...document.querySelectorAll('img')].filter(i=>i.complete && i.naturalWidth===0).length);
const imgCount = await p.evaluate(() => document.querySelectorAll('img').length);
await p.screenshot({ path: out, fullPage: true });
console.log(JSON.stringify({ docH, imgCount, brokenImgs: broken }));
await b.close();
