// @purpose Independent (grader-code-free) verification of the 1024/1025 height cliff on clone pages.
// Loads each clone at 1025 then 1024, records scrollHeight + abs-positioned elementor element count.
import { chromium } from 'playwright';
const pages = process.argv.slice(2);
const b = await chromium.launch();
for (const pid of pages) {
  const url = `https://georges232.sg-host.com/?page_id=${pid}`;
  const out = { page: pid };
  for (const w of [1025, 1024]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    try { await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 }); } catch {}
    await p.waitForTimeout(800);
    const m = await p.evaluate(() => {
      let abs = 0;
      for (const el of document.querySelectorAll('.elementor-element')) {
        if (getComputedStyle(el).position === 'absolute') abs++;
      }
      return { h: document.documentElement.scrollHeight, abs };
    });
    out['w' + w] = m;
    await p.close();
  }
  out.ratio = +(Math.max(out.w1024.h, out.w1025.h) / Math.min(out.w1024.h, out.w1025.h)).toFixed(3);
  console.log(JSON.stringify(out));
}
await b.close();
