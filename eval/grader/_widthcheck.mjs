// @purpose Wedge-proof horizontal-overflow probe across breakpoints. Measures documentElement
// scrollWidth/clientWidth (→ hOverflow) at each viewport in ONE browser, using domcontentloaded
// (NOT networkidle — external assets that 500/hang would wedge networkidle, the workflow-stall cause).
// Usage: node _widthcheck.mjs <url> [w1,w2,...]   default widths 1440,960,768,390
import { chromium } from 'playwright';
const [, , url, wArg] = process.argv;
if (!url) { console.error('usage: node _widthcheck.mjs <url> [w1,w2,..]'); process.exit(2); }
const widths = (wArg || '1440,960,768,390').split(',').map(s => parseInt(s, 10));
const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
const out = [];
for (const width of widths) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    // settle lazy + force layout
    await page.evaluate(async () => { window.scrollTo(0, document.body.scrollHeight); await new Promise(r => setTimeout(r, 500)); window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 300)); });
    const d = await page.evaluate(() => {
      const de = document.documentElement;
      // find the single widest element protruding past the viewport (the overflow culprit)
      let worst = null, cw = de.clientWidth;
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        const right = r.left + r.width;
        if (right > cw + 1 && (!worst || right > worst.right)) {
          worst = { right: Math.round(right), left: Math.round(r.left), w: Math.round(r.width), tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 40), id: el.id || '' };
        }
      }
      return { sw: de.scrollWidth, cw: de.clientWidth, sh: de.scrollHeight, worst };
    });
    out.push({ width, scrollW: d.sw, clientW: d.cw, scrollH: d.sh, hOverflow: Math.max(0, d.sw - d.cw), worst: d.worst });
  } catch (e) {
    out.push({ width, error: String(e).slice(0, 120) });
  }
  await ctx.close();
}
await browser.close();
for (const r of out) {
  if (r.error) { console.log(`@${r.width}: ERROR ${r.error}`); continue; }
  const w = r.worst ? ` | widest-overflow: <${r.worst.tag}${r.worst.id ? '#' + r.worst.id : ''}${r.worst.cls ? '.' + r.worst.cls.split(' ')[0] : ''}> left=${r.worst.left} w=${r.worst.w} right=${r.worst.right}` : '';
  console.log(`@${r.width}: scrollW=${r.scrollW} clientW=${r.clientW} hOverflow=${r.hOverflow} scrollH=${r.scrollH}${w}`);
}
console.log(JSON.stringify(out));
