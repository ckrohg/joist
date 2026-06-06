#!/usr/bin/env node
/**
 * @purpose Phase-1 prototype of the 1:1-pixel-match plan: capture the source at 2x, segment into
 * top-level sections by full-width block boundaries, slice the screenshot into per-section PNGs, and
 * rebuild the Elementor page as a STACK of full-width Image sections (pixel-perfect by construction).
 * Trades editability for fidelity — the honest path to ~1:1 for JS/canvas-heavy sites.
 * Usage: node build-sectionraster.mjs --source <url> --page <id> [--width 1440]
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source'), pageId = arg('page'), W = parseInt(arg('width', '1440'), 10);
const base = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
const b64 = process.env.JOIST_AUTH_B64; if (!b64 || !source || !pageId) { console.error('need --source --page + JOIST_AUTH_B64'); process.exit(2); }

// Box-average downscale by integer factor f. Slices are captured at dpr=2 → 2880px wide; displaying an
// image at its NATURAL width (Elementor's img isn't reliably constrained to 100%) overflows the 1440
// container and inflates page height. Downscaling 2x → 1440 makes natural width == container width, so
// the page renders 1:1 with no horizontal overflow and correct height. (High-quality 2x box filter.)
function downscale(src, f) {
  const w = Math.floor(src.width / f), h = Math.floor(src.height / f); const o = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let r = 0, g = 0, b = 0, a = 0; for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) { const si = (((y * f + dy) * src.width) + (x * f + dx)) * 4; r += src.data[si]; g += src.data[si + 1]; b += src.data[si + 2]; a += src.data[si + 3]; } const n = f * f, di = (y * w + x) * 4; o.data[di] = r / n; o.data[di + 1] = g / n; o.data[di + 2] = b / n; o.data[di + 3] = a / n; }
  return o;
}

async function uploadPng(buf, name) {
  const up = await fetch(base + '/wp-json/wp/v2/media', { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="${name}"` }, body: buf });
  const j = await up.json(); if (!up.ok || !j.source_url) { console.error('upload fail', up.status, JSON.stringify(j).slice(0, 120)); return null; } return j.source_url;
}

(async () => {
  // STEALTH: Stripe (and many SPA sites) serve degraded/no-JS content to headless browsers, leaving the
  // dynamic carousel/dashboard sections blank. Defeat the common detections so the full page renders.
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 2, locale: 'en-US', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] }); Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] }); window.chrome = { runtime: {} }; });
  const page = await ctx.newPage();
  const blankFrac = (im, y0, y1) => { let lo = 0, n = 0; for (let r = y0; r < y1; r += 3) for (let x = 0; x < im.width; x += 17) { const i = (r * im.width + x) * 4; n++; if (im.data[i] > 244 && im.data[i + 1] > 244 && im.data[i + 2] > 244) lo++; } return n ? lo / n : 1; };
  // ONE capture pass: navigate fresh, settle, click-drive interactive sections, then viewport-chunk-stitch.
  async function capturePass() {
    try { await page.goto(source, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await page.goto(source, { waitUntil: 'load', timeout: 60000 }); } catch {} }
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(1500);
    await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 260)); } window.scrollTo(0, 0); });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    try { await page.addStyleTag({ content: '*{content-visibility:visible!important;contain-intrinsic-size:auto!important}' }); } catch {}
    try { const trigSel = 'button[role="tab"], [role="tab"]:not(a), button[aria-controls], button[aria-expanded]:not([aria-haspopup])'; const n = await page.evaluate((sel) => document.querySelectorAll(sel).length, trigSel); for (let i = 0; i < Math.min(n, 24); i++) { try { await page.evaluate((sel, idx) => { const el = document.querySelectorAll(sel)[idx]; if (el && el.tagName !== 'A') { el.scrollIntoView({ block: 'center' }); el.click(); } }, trigSel, i); await page.waitForTimeout(180); } catch {} } } catch {}
    await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 240)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(1200);
    const cuts = await page.evaluate((vw) => { const ys = new Set([0]); for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.width >= vw * 0.82 && r.height >= 120 && r.top + scrollY >= 0) ys.add(Math.round(r.top + scrollY)); } const arr = [...ys].sort((a, b) => a - b); const m = []; for (const y of arr) { if (!m.length || y - m[m.length - 1] > 60) m.push(y); } return { cuts: m, pageH: document.documentElement.scrollHeight }; }, W);
    const vh = 900; const pageH = cuts.pageH; const probe = PNG.sync.read(await page.screenshot()); const dpr = probe.width / W;
    const out = new PNG({ width: Math.round(W * dpr), height: Math.round(pageH * dpr) });
    for (let y = 0; y < pageH; y += vh) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(700);
      if (y > 0) await page.evaluate(() => { for (const e of document.querySelectorAll('*')) { const p = getComputedStyle(e).position; if ((p === 'fixed' || p === 'sticky') && e.getBoundingClientRect().height < 220) e.style.visibility = 'hidden'; } });
      const chunk = PNG.sync.read(await page.screenshot());
      const destY = Math.round(y * dpr); const copyH = Math.min(chunk.height, out.height - destY);
      for (let r = 0; r < copyH; r++) { const s = (r * chunk.width) * 4; chunk.data.copy(out.data, ((destY + r) * out.width) * 4, s, s + Math.min(chunk.width, out.width) * 4); }
    }
    return { png: out, dpr, cuts: cuts.cuts, pageH };
  }
  // ENSEMBLE: different fresh loads render different dynamic sections (nondeterministic). Capture N passes,
  // then for each row-band pick the LEAST-BLANK version across passes → the union assembles a complete page.
  const PASSES = 3; const results = [];
  for (let p = 0; p < PASSES; p++) { console.log(`capture pass ${p + 1}/${PASSES}…`); results.push(await capturePass()); }
  await browser.close();
  const base0 = results.reduce((a, b) => (b.png.height > a.png.height ? b : a)); // canonical = tallest
  const { dpr } = base0; const png = new PNG({ width: base0.png.width, height: base0.png.height });
  const BAND = 60 * Math.round(dpr); let merged = 0;
  for (let y = 0; y < png.height; y += BAND) {
    const y1 = Math.min(png.height, y + BAND);
    let best = base0.png, bestBlank = blankFrac(base0.png, y, y1);
    for (const r of results) { if (r.png === base0.png || y1 > r.png.height) continue; const bf = blankFrac(r.png, y, y1); if (bf < bestBlank - 0.02) { bestBlank = bf; best = r.png; } }
    if (best !== base0.png) merged++;
    for (let r = y; r < y1; r++) { const s = (r * best.width) * 4; best.data.copy(png.data, (r * png.width) * 4, s, s + Math.min(best.width, png.width) * 4); }
  }
  console.log(`ensemble: ${PASSES} passes, ${merged} bands taken from a better pass`);
  // save the exact stitched source (downscaled to display width) so the clone can be graded against the
  // pixels it was BUILT from — isolates raster-pipeline fidelity from source-drift / capture-timing noise.
  try { const fsm = await import('fs'); const srcImg = dpr > 1 ? downscale(png, Math.round(dpr)) : png; fsm.writeFileSync(`/tmp/secraster-src-${pageId}.png`, PNG.sync.write(srcImg)); console.log(`saved stitched source → /tmp/secraster-src-${pageId}.png (${srcImg.width}x${srcImg.height})`); } catch (e) { console.log('stitched-source save failed', e.message); }
  const cuts = { cuts: base0.cuts, pageH: base0.pageH };
  const bounds = [...cuts.cuts.filter((y) => y < cuts.pageH), cuts.pageH];
  console.log(`page ${cuts.pageH}px → ${bounds.length - 1} section slices`);
  // slice + upload
  const sections = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const y0 = Math.round(bounds[i] * dpr), y1 = Math.round(bounds[i + 1] * dpr); const h = y1 - y0;
    if (h < 20) continue;
    const full = new PNG({ width: png.width, height: h });
    for (let r = 0; r < h; r++) { const s = ((y0 + r) * png.width) * 4; png.data.copy(full.data, (r * png.width) * 4, s, s + png.width * 4); }
    const out = dpr > 1 ? downscale(full, Math.round(dpr)) : full; // → natural width == 1440 container width
    // WP scales any image whose longest side > 2560 ("big image" threshold), which shrinks tall sections
    // BOTH shorter and narrower → cumulative vertical drift + horizontal gaps. Split tall slices into
    // sub-slices ≤2400px so every uploaded image stays under the threshold (full height + width preserved).
    const MAXH = 2400; const subCount = Math.ceil(out.height / MAXH); let pushed = 0;
    for (let sIdx = 0; sIdx < subCount; sIdx++) {
      const sy = sIdx * MAXH, sh = Math.min(MAXH, out.height - sy);
      let sub = out;
      if (subCount > 1) { sub = new PNG({ width: out.width, height: sh }); for (let r = 0; r < sh; r++) { const s = ((sy + r) * out.width) * 4; out.data.copy(sub.data, (r * out.width) * 4, s, s + out.width * 4); } }
      const url = await uploadPng(PNG.sync.write(sub), `sec-${i}-${sIdx}-${Date.now()}.png`);
      if (url) { sections.push({ url, w: sub.width, h: sub.height }); pushed++; }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (subCount > 1) console.log(`  slice ${i} (${out.height}px) split into ${pushed} sub-slices ≤${MAXH}px`);
  }
  console.log(`uploaded ${sections.length} section images`);
  // build: column container of full-width images
  const dim = (n) => ({ unit: 'px', size: String(Math.round(n)) });
  const imgWidget = (s) => ({ elType: 'widget', widgetType: 'image', settings: { image: { url: s.url }, image_size: 'full', width: { unit: '%', size: 100 } } });
  // CONTAINER padding control is `padding` (NOT `_padding`, which is widget advanced-padding). Elementor's
  // .e-con default 10px padding insets every image to x=10/w=1420 → horizontal shift + downscale wrecks the
  // 1:1 under real Elementor render (edit_mode=builder). Zero `padding` (and keep _padding for safety).
  const zeroPad = { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true };
  const root = { elType: 'container', settings: { content_width: 'full', flex_direction: 'column', flex_gap: dim(0), padding: zeroPad, _padding: zeroPad }, elements: sections.map(imgWidget) };
  const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'secraster-' + Date.now() };
  // retry-on-409: the joist GET can report a STALE hash (version meta) that disagrees with the actual
  // stored-data hash the write-path checks. So on 409 we trust details.current_hash from the error itself
  // (true CAS token) rather than re-GETting — re-GET returns the same stale value and loops forever.
  let r, txt;
  let expected = (await (await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { headers })).json()).elementor?.hash;
  for (let attempt = 0; attempt < 5; attempt++) {
    const body = { expected_hash: expected, elements: [root], page_settings: {}, title: 'Section-raster clone', intent: '1:1 section-raster' };
    r = await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { method: 'PUT', headers, body: JSON.stringify(body) });
    txt = await r.text();
    if (r.status !== 409) break;
    try { expected = JSON.parse(txt).details.current_hash; } catch {}
    console.log(`PUT 409 — retrying with current_hash from error: ${expected}`); await new Promise((s) => setTimeout(s, 400));
  }
  console.log('PUT', r.status, txt.slice(0, 100));
  // CRITICAL: without _elementor_edit_mode=builder, the FRONTEND renders the post_content fallback (raw
  // images in <p>), NOT the Elementor tree. For raster that fallback happened to look ~1:1, but it's not
  // a real Elementor render. Set builder mode so the page renders (and is editable) via Elementor.
  try { await fetch(`${base}/wp-json/wp/v2/pages/${pageId}`, { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json' }, body: JSON.stringify({ meta: { _elementor_edit_mode: 'builder' } }) }); console.log('set edit_mode=builder'); } catch (e) { console.log('edit_mode set failed', e.message); }
  console.log('PAGE:', `${base}/?page_id=${pageId}`);
})();
