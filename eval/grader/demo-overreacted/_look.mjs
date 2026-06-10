// @purpose One-off LOOK harness for the overreacted blog demo: viewport shots of clone top + middle (+ source same spots).
import { chromium } from 'playwright'
const CLONE = 'https://georges232.sg-host.com/?page_id=11067'
const SRC = 'https://overreacted.io/a-complete-guide-to-useeffect/'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA })
const page = await ctx.newPage()
async function shots(url, tag) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => page.goto(url, { waitUntil: 'load', timeout: 90000 }))
  await page.waitForTimeout(2500)
  const h = await page.evaluate(() => document.body.scrollHeight)
  // settle lazy
  for (let y = 0; y < h; y += 900) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(120) }
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(800)
  await page.screenshot({ path: `/tmp/look-${tag}-top.png` })
  await page.evaluate((yy) => window.scrollTo(0, yy), Math.floor(h * 0.5)); await page.waitForTimeout(800)
  await page.screenshot({ path: `/tmp/look-${tag}-mid.png` })
  console.log(tag, 'scrollHeight', h)
}
await shots(CLONE, 'clone')
await shots(SRC, 'src')
await browser.close()
