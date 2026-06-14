// @purpose One-off: clean side-by-side (source vs clone) screenshot for visual inspection.
// Isolated browser instance (does NOT touch the MCP chrome profile or the running round's capture browsers).
// Captures both at the SAME width the absolute build was pinned to (1440), step-scrolls the source to
// trigger lazy content (mirrors capture-layout), then composes a labeled two-column image via Playwright itself.
import { chromium } from 'playwright'
import fs from 'fs'
import { assertAllowedBase } from '../../sandbox/host-guard.mjs' // §0 SAFETY GUARD: clone shot must target a training host

const SRC = process.argv[2] || 'https://tailwindcss.com'
// §0 SAFETY GUARD: the CLONE side is one of OUR rendered pages — it must live on a training host.
// Default flipped from the PAUSED shared host to the local sandbox; assertAllowedBase guards both the
// default AND any argv-supplied CLONE URL, throwing LOUDLY before navigation if it strays. (SRC is an
// external public site being screenshotted, not a WP host we write to, so it is intentionally unguarded.)
const CLONE = (() => {
  const u = process.argv[3] || 'http://localhost:8001/?page_id=3146'
  assertAllowedBase(u) // throws on a non-training clone host (e.g. *.sg-host.com)
  return u
})()
const W = 1440
const OUT_SRC = '/tmp/cmp-src.png'
const OUT_CLONE = '/tmp/cmp-clone.png'
const OUT_SXS = '/tmp/cmp-tailwind-sxs.png'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function settleAndShoot(page, url, outfile, { scroll }) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => page.goto(url, { waitUntil: 'load', timeout: 90000 }))
  await page.waitForTimeout(2500)
  if (scroll) {
    // step-scroll to trigger IntersectionObserver / lazy media, then back to top (mirrors capture-layout)
    const h = await page.evaluate(() => document.body.scrollHeight)
    for (let y = 0; y < h; y += 700) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(220) }
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(900)
  }
  await page.screenshot({ path: outfile, fullPage: true })
  const dims = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }))
  return dims
}

const browser = await chromium.launch({ headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, userAgent: UA, deviceScaleFactor: 1, locale: 'en-US' })
  const page = await ctx.newPage()

  console.log('shooting SOURCE', SRC)
  const dSrc = await settleAndShoot(page, SRC, OUT_SRC, { scroll: true })
  console.log('  source', dSrc.w + 'x' + dSrc.h, fs.statSync(OUT_SRC).size + 'b')

  console.log('shooting CLONE', CLONE)
  const dClone = await settleAndShoot(page, CLONE, OUT_CLONE, { scroll: true })
  console.log('  clone', dClone.w + 'x' + dClone.h, fs.statSync(OUT_CLONE).size + 'b')

  // compose: labeled two-column wrapper, screenshot it. file:// page can load file:// imgs.
  const html = `<!doctype html><html><head><meta charset=utf8><style>
    *{margin:0;box-sizing:border-box;font-family:-apple-system,Inter,sans-serif}
    body{background:#0f0f12;padding:24px}
    .row{display:flex;gap:24px;align-items:flex-start}
    .col{flex:0 0 ${W}px;width:${W}px}
    .lab{color:#d7ff4f;font:600 22px/1.3 monospace;padding:10px 4px 14px;letter-spacing:.5px}
    .lab small{color:#8a8a92;font-weight:400;font-size:15px}
    img{width:${W}px;display:block;border:1px solid #2a2a30;background:#fff}
  </style></head><body><div class=row>
    <div class=col><div class=lab>SOURCE <small>tailwindcss.com · ${dSrc.w}×${dSrc.h}</small></div><img src="file://${OUT_SRC}"></div>
    <div class=col><div class=lab>CLONE <small>Elementor page 3146 · ${dClone.w}×${dClone.h}</small></div><img src="file://${OUT_CLONE}"></div>
  </div></body></html>`
  const cmpHtml = '/tmp/cmp.html'
  fs.writeFileSync(cmpHtml, html)
  const wrap = await ctx.newPage()
  await wrap.setViewportSize({ width: W * 2 + 72, height: 1000 })
  await wrap.goto('file://' + cmpHtml, { waitUntil: 'load' })
  await wrap.waitForTimeout(600)
  await wrap.screenshot({ path: OUT_SXS, fullPage: true })
  console.log('SXS', OUT_SXS, fs.statSync(OUT_SXS).size + 'b')
} finally {
  await browser.close()
}
