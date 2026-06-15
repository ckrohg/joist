// @purpose Minimal node+playwright full-page screenshot helper (rails: node+timeout, not mcp-playwright).
// Usage: node _shoot.mjs <url> <outPng> [width]
import { chromium } from 'playwright';
const [, , url, out, wArg] = process.argv;
const width = parseInt(wArg || '1440', 10);
if (!url || !out) { console.error('usage: node _shoot.mjs <url> <out.png> [width]'); process.exit(2); }
const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }));
await page.waitForTimeout(2500);
// settle lazy images
await page.evaluate(async () => { window.scrollTo(0, document.body.scrollHeight); await new Promise(r => setTimeout(r, 600)); window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 400)); });
const dims = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight }));
await page.screenshot({ path: out, fullPage: true });
console.log(JSON.stringify({ out, width, scrollW: dims.sw, clientW: dims.cw, scrollH: dims.sh, hOverflow: Math.max(0, dims.sw - dims.cw) }));
await browser.close();
