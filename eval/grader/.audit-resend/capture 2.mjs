// @purpose One-off isolated capture for the resend human-fidelity audit (no shared MCP profile).
import { chromium } from 'playwright';
import path from 'path';

const OUT = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/.audit-resend';
const targets = [
  { name: 'src',   url: 'https://resend.com' },
  { name: 'clone', url: 'https://georges232.sg-host.com/?page_id=2988' },
];
const MID_Y = 3400;

const browser = await chromium.launch({ headless: true });
for (const t of targets) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try {
    await page.goto(t.url, { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
  } catch (e) {}
  await page.waitForTimeout(3500); // let fonts + hero anim settle
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  const meta = await page.evaluate(() => ({ docH: document.body.scrollHeight, title: document.title, url: location.href }));
  await page.screenshot({ path: path.join(OUT, `${t.name}-fold.png`) });
  // mid band
  await page.evaluate((y) => window.scrollTo(0, y), MID_Y);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, `${t.name}-mid.png`) });
  // full page (reference)
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${t.name}-full.png`), fullPage: true });
  console.log(JSON.stringify({ name: t.name, ...meta }));
  await ctx.close();
}
await browser.close();
