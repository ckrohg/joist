// @purpose Attribute a clone's mobile (390) page height to element classes, to find the dominant
// vertical-blowup sink (icon/logo grids vs footer link-columns vs images vs text vs spacing). Reads
// the LIVE rendered clone at 390. Heuristic buckets by tag/content/size. Deterministic.
// Usage: node _heightattr.mjs <url> [width]
import { chromium } from 'playwright';
const [, , url, wArg] = process.argv;
if (!url) { console.error('usage: node _heightattr.mjs <url> [width]'); process.exit(2); }
const width = parseInt(wArg || '390', 10);
const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2000);
await page.evaluate(async () => { window.scrollTo(0, document.body.scrollHeight); await new Promise(r => setTimeout(r, 500)); window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 300)); });
const res = await page.evaluate(() => {
  // top-level Elementor widgets (the reflowed stack). Each .elementor-widget is a stacked unit at <=1024.
  const units = [...document.querySelectorAll('.elementor-element.elementor-widget')];
  // classify each unit
  const buckets = {};
  const add = (k, h) => { buckets[k] = buckets[k] || { count: 0, h: 0 }; buckets[k].count++; buckets[k].h += h; };
  let total = 0, n = 0;
  const items = [];
  for (const el of units) {
    const r = el.getBoundingClientRect();
    const h = Math.round(r.height);
    if (h <= 0) continue;
    // only count units that are direct stack members (not nested inside another counted widget)
    if (el.parentElement && el.parentElement.closest('.elementor-widget')) continue;
    n++; total += h;
    const html = el.innerHTML;
    const txt = (el.textContent || '').trim();
    const imgs = el.querySelectorAll('img,svg').length;
    let kind;
    if (imgs > 0 && txt.length < 4) kind = imgs > 1 ? 'icon/logo-grid' : 'single-image';
    else if (/<a\b/i.test(html) && el.querySelectorAll('a').length >= 3 && txt.length < 200) kind = 'link-column(footer?)';
    else if (txt.length === 0) kind = 'empty/bg-rect';
    else if (h > 600) kind = 'tall-block(>600)';
    else if (txt.length < 40) kind = 'short-text/label';
    else kind = 'text-block';
    add(kind, h);
    items.push({ kind, h, w: Math.round(r.width), txt: txt.slice(0, 30) });
  }
  const rows = Object.entries(buckets).map(([k, v]) => ({ kind: k, count: v.count, h: v.h, pct: 0 })).sort((a, b) => b.h - a.h);
  for (const row of rows) row.pct = total ? Math.round(row.h / total * 100) : 0;
  const tallest = items.sort((a, b) => b.h - a.h).slice(0, 12);
  return { width: window.innerWidth, scrollH: document.documentElement.scrollHeight, countedUnits: n, countedH: total, rows, tallest };
});
await browser.close();
console.log(`@${res.width}: scrollH=${res.scrollH}  counted ${res.countedUnits} stack units summing ${res.countedH}px`);
console.log('— height by class —');
for (const r of res.rows) console.log(`  ${String(r.pct).padStart(3)}%  ${String(r.h).padStart(6)}px  ${String(r.count).padStart(3)}×  ${r.kind}`);
console.log('— 12 tallest units —');
for (const t of res.tallest) console.log(`  ${String(t.h).padStart(5)}px  ${String(t.w).padStart(3)}w  ${t.kind.padEnd(20)} "${t.txt}"`);
