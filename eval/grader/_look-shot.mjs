/**
 * @purpose Full-page LOOK screenshot + layout-integrity probe (pageHeight + horizontalScroll flag) for a clone
 * URL. Used to confirm an authored motion slice does not break the RESTING layout. Usage: node _look-shot.mjs <url> <out.png>
 */
import { chromium } from 'playwright';
const url = process.argv[2], out = process.argv[3];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
await p.waitForTimeout(1800);
const h = await p.evaluate(() => document.body.scrollHeight);
await p.screenshot({ path: out, fullPage: true });
const hscroll = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
console.log(JSON.stringify({ url, pageHeight: h, horizontalScroll: hscroll, shot: out }));
await b.close();
