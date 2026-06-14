// @purpose Independent adversarial capture of the live resend clone — verify void-imagery bands render real source img.
import { chromium } from 'playwright';
import { resolveBase } from '../../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: never navigate a non-training host
import path from 'path';
const OUT = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/.indep-void';
const CLONE = `${resolveBase(process.env.JOIST_BASE || 'http://localhost:8001')}/?page_id=2988`;
const SRC = 'https://resend.com';
const browser = await chromium.launch({ headless: true });
async function shoot(name, url) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
  await page.waitForTimeout(3500);
  // scroll to bottom progressively to trigger any lazy assets, then back up
  await page.evaluate(async () => { const h = document.body.scrollHeight; for (let y=0;y<h;y+=800){ window.scrollTo(0,y); await new Promise(r=>setTimeout(r,120)); } window.scrollTo(0,0); });
  await page.waitForTimeout(1500);
  const docH = await page.evaluate(() => document.body.scrollHeight);
  await page.screenshot({ path: path.join(OUT, `${name}-full.png`), fullPage: true });
  // h-scroll check
  const hscroll = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, bodyScrollW: document.body.scrollWidth }));
  console.log(JSON.stringify({ name, docH, hscroll }));
  await ctx.close();
}
await shoot('clone', CLONE);
await shoot('src', SRC);
await browser.close();
