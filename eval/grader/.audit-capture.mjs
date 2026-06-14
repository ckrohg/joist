// @purpose One-off isolated capture for human-eye fidelity audit: source vs clone, fold + mid band, 1440w.
import { chromium } from 'playwright';
import { resolveBase } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: never navigate a non-training host
import fs from 'node:fs';

const OUT = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/.audit';
fs.mkdirSync(OUT, { recursive: true });

const TARGETS = [
  { name: 'source', url: 'https://supabase.com/' },
  { name: 'clone',  url: `${resolveBase(process.env.JOIST_BASE || 'http://localhost:8001')}/?page_id=2986` },
];

async function settle(page) {
  // let lazy content + fonts load
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.waitForTimeout(2500);
  // gently scroll the whole page to trigger any lazy images / scroll-reveals, then back to top
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y <= h; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1500);
}

const results = {};
const browser = await chromium.launch({ headless: true });
try {
  for (const t of TARGETS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.error('goto', t.name, e.message));
    await settle(page);

    const geo = await page.evaluate(() => ({
      docHeight: document.documentElement.scrollHeight,
      vw: window.innerWidth, vh: window.innerHeight,
      title: document.title,
      hScroll: document.documentElement.scrollWidth > window.innerWidth + 2,
    }));
    results[t.name] = geo;

    // fold
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${t.name}-fold.png` });

    // mid band — proportional so both line up on the same content region (feature cards ~ 1.0*vh down)
    const midY = Math.round(geo.docHeight * 0.10); // just under the fold, feature cards region
    await page.evaluate((y) => window.scrollTo(0, y), midY);
    await page.waitForTimeout(800);
    const actualY = await page.evaluate(() => window.scrollY);
    results[t.name].midRequested = midY;
    results[t.name].midActual = actualY;
    await page.screenshot({ path: `${OUT}/${t.name}-mid.png` });

    // full page too, for completeness review
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${t.name}-full.png`, fullPage: true });

    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(results, null, 2));
