#!/usr/bin/env node
/**
 * @purpose The flywheel's NEW objective function. grade-raster scores pixels only → it rewards
 * RASTERIZATION (turn everything into a screenshot to win), which pulls the cloner AWAY from the real
 * goal: a NATIVE, EDITABLE Elementor page. This grader combines:
 *   • visual    — per-band SSIM + exact-pixel (does it LOOK right; reused from grade-raster)
 *   • editability — fraction of the SOURCE's text reproduced as REAL selectable widgets in the clone,
 *                   NOT baked into a raster image. Photos/genuine media carry no text so they don't
 *                   count against it — rasterizing a photo is fine; rasterizing a TEXT section is not.
 * composite = 0.5·visual + 0.5·editability, with a visual<0.5 FLOOR so a broken-looking page can't
 * score high on editability alone. Net: native+faithful > native-rough > hybrid > pure-raster > broken.
 * Usage: node grade-structure.mjs --source <url|file.png> --clone <url> [--out dir]
 */
import fs from 'fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const source = arg('source'), clone = arg('clone'), outDir = arg('out', '/tmp/structgrade'), W = 1440;
if (!source || !clone) { console.error('need --source --clone'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

// ---- visual (reused from grade-raster) ----
const gray = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
const srgbLab = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; let R = f(r), G = f(g), B = f(b); let X = (R * .4124 + G * .3576 + B * .1805) / .95047, Y = R * .2126 + G * .7152 + B * .0722, Z = (R * .0193 + G * .1192 + B * .9505) / 1.08883; const g2 = (t) => t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; return [116 * g2(Y) - 16, 500 * (g2(X) - g2(Y)), 200 * (g2(Y) - g2(Z))]; };
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function ssim(a, b, y0, y1) { const Wd = Math.min(a.width, b.width), win = 8, C1 = 6.5, C2 = 58.5; let tot = 0, n = 0; for (let by = y0; by + win <= y1; by += win) for (let bx = 0; bx + win <= Wd; bx += win) { let ma = 0, mb = 0; for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const ia = ((by + y) * a.width + bx + x) * 4, ib = ((by + y) * b.width + bx + x) * 4; ma += gray(a.data, ia); mb += gray(b.data, ib); } const N = win * win; ma /= N; mb /= N; let va = 0, vb = 0, cov = 0; for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const ia = ((by + y) * a.width + bx + x) * 4, ib = ((by + y) * b.width + bx + x) * 4; const da = gray(a.data, ia) - ma, db = gray(b.data, ib) - mb; va += da * da; vb += db * db; cov += da * db; } va /= N - 1; vb /= N - 1; cov /= N - 1; tot += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++; } return n ? tot / n : 1; }
function exactFrac(a, b, y0, y1) { let ex = 0, n = 0; const Wd = Math.min(a.width, b.width); for (let y = y0; y < y1; y += 2) for (let x = 0; x < Wd; x += 2) { const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4; const d = dE(srgbLab(a.data[ia], a.data[ia + 1], a.data[ia + 2]), srgbLab(b.data[ib], b.data[ib + 1], b.data[ib + 2])); if (d < 8) ex++; n++; } return n ? ex / n : 0; }

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function capture(ctx, target, isSource) {
  if (!/^https?:/.test(target)) return { shot: PNG.sync.read(fs.readFileSync(target)), texts: [], census: {} };
  const p = await ctx.newPage(); await p.setViewportSize({ width: W, height: 900 });
  try { await p.goto(target, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(target, { waitUntil: 'load', timeout: 30000 }); } catch {} }
  await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(1200);
  await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 200)); } window.scrollTo(0, 0); });
  try { await p.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  await p.waitForTimeout(800);
  const info = await p.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(el); return !(cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05); };
    // SELECTABLE text runs (real editable text — NOT inside an image). Images carry no innerText, so any
    // text here is genuinely native/selectable. This is the editability signal.
    const texts = []; const seen = new Set();
    // include div: Elementor text-editor widgets render text in <div> wrappers; the own-text filter
    // (direct text-node child) keeps this to leaf text and excludes structural containers.
    for (const e of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,span,li,div')) {
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && clean(n.textContent)); if (!own) continue;
      const t = clean(e.innerText); if (!t || t.length > 200) continue; if (!vis(e)) continue; if (parseFloat(getComputedStyle(e).fontSize) < 10) continue;
      const k = t.toLowerCase(); if (seen.has(k)) continue; seen.add(k); texts.push(t);
    }
    const census = {
      headings: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
      links: document.querySelectorAll('a,button').length,
      imgs: document.querySelectorAll('img').length,
      // clone-side native widget census (no-op on source)
      wHeading: document.querySelectorAll('.elementor-widget-heading').length,
      wText: document.querySelectorAll('.elementor-widget-text-editor').length,
      wButton: document.querySelectorAll('.elementor-widget-button').length,
      wImage: document.querySelectorAll('.elementor-widget-image').length,
    };
    return { texts, census, pageH: document.documentElement.scrollHeight };
  });
  const shot = PNG.sync.read(await p.screenshot({ fullPage: true }));
  await p.close(); return { shot, texts: info.texts, census: info.census, pageH: info.pageH };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  const src = await capture(ctx, source, true);
  const cln = await capture(ctx, clone, false);
  await browser.close();

  // ---- visual ----
  const H = Math.min(src.shot.height, cln.shot.height); const BAND = 200; const sArr = [], eArr = [];
  for (let y = 0; y < H; y += BAND) { const y1 = Math.min(H, y + BAND); sArr.push(ssim(src.shot, cln.shot, y, y1)); eArr.push(exactFrac(src.shot, cln.shot, y, y1)); }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const ssimMean = mean(sArr), exactMean = mean(eArr);
  const hRatio = cln.shot.height / src.shot.height;
  // HEIGHT-OVERFLOW PENALTY: band-SSIM only compares the overlapping region, so it's BLIND to a clone
  // that's 3x too tall (the bottom 2/3 is never measured) — it would over-score a structurally broken,
  // stretched page. Penalize deviation from the source height (10% tolerance, floor 0.3). A 3x-tall clone
  // is broken regardless of how well its top third matches.
  const hPen = Math.max(0.3, Math.min(1, 1 - Math.max(0, Math.abs(hRatio - 1) - 0.1) * 0.6));
  const visual = (0.5 * ssimMean + 0.5 * exactMean) * hPen;

  // ---- editability: how much of the source's TEXT is reproduced as selectable clone text ----
  const srcTexts = [...new Set(src.texts.map(norm))].filter((t) => t.length >= 4);
  const cloneJoined = ' ' + cln.texts.map(norm).join(' | ') + ' ';
  const cloneSet = new Set(cln.texts.map(norm));
  let covered = 0; for (const t of srcTexts) { if (cloneSet.has(t) || cloneJoined.includes(' ' + t + ' ') || cloneJoined.includes(t)) covered++; }
  const textEditability = srcTexts.length ? covered / srcTexts.length : 0;
  // structure diagnostic: of the clone, how much is native widgets vs raster images
  const c = cln.census; const nativeW = (c.wHeading || 0) + (c.wText || 0) + (c.wButton || 0); const imgW = c.wImage || 0;
  const nativeRatio = (nativeW + imgW) ? nativeW / (nativeW + imgW) : 0;

  const editability = textEditability; // primary, robust signal
  let composite = 0.5 * visual + 0.5 * editability;
  // FLOOR: a broken-looking page can't score high on editability alone
  if (visual < 0.5) composite = Math.min(composite, visual + 0.1);

  const report = {
    source, clone,
    composite: +composite.toFixed(3),
    visual: +visual.toFixed(3), editability: +editability.toFixed(3),
    breakdown: { ssim_mean: +ssimMean.toFixed(3), exactPixel_mean: +exactMean.toFixed(3), hRatio: +hRatio.toFixed(3), heightPenalty: +hPen.toFixed(3), textCoverage: +textEditability.toFixed(3), srcTextRuns: srcTexts.length, cloneTextRuns: cln.texts.length, nativeRatio: +nativeRatio.toFixed(3), cloneWidgets: { heading: c.wHeading, text: c.wText, button: c.wButton, image: c.wImage } },
    note: 'composite = 0.5*visual + 0.5*editability (visual<0.5 floors it). Rewards NATIVE editable widgets over rasterization.',
  };
  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
})();
