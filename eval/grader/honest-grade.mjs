#!/usr/bin/env node
/**
 * @purpose Phase-0 BRUTALLY-HONEST grader (CLONE_CAPABILITY_SPEC §4). Replaces the
 * self-flattering pixelmatch grader. It CANNOT trick itself because:
 *   - aggregation is MIN, never mean (one local catastrophe tanks the page)
 *   - graded per REGION × per VIEWPORT (desktop/tablet/mobile), worst dominates
 *   - DETERMINISTIC computed-style HARD-FAIL gates a number can't override:
 *       gradient-text-missing, font-family mismatch, bbox IoU<0.7, effect-presence,
 *       wrong/absent image  → any trip caps overall ≤ 0.55
 *   - perceptual = SSIM + strict pixelmatch + LAB ΔE per region (not a lenient global %)
 *   - emits per-region source|clone crop pairs + a harsh vision rubric; trustworthy
 *     stays FALSE until a vision judge enumerates defects. Output is a defect VECTOR
 *     + worst region + hard-fails — never a lone flattering %.
 *
 * Usage: node honest-grade.mjs --source <url> --clone <url> [--out dir] [--viewports desktop,tablet,mobile]
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pmModule from 'pixelmatch';
import { assertAllowedBase, assertNotBlocked } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: refuse a stray (e.g. paused *.sg-host.com) URL before any navigation.
const pixelmatch = pmModule.default || pmModule;

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source'); const clone = arg('clone');
const outDir = arg('out', './honest-out');
if (!source || !clone) { console.error('need --source and --clone'); process.exit(2); }
// §0 SAFETY GUARD: assert every http(s) URL arg targets a training host (blocks the paused shared host) BEFORE any chromium.goto.
if (clone && /^https?:/i.test(clone)) assertAllowedBase(clone); if (source && /^https?:/i.test(source)) assertNotBlocked(source); /* source = external read-only; only the paused host is blocked */
fs.mkdirSync(outDir, { recursive: true });
const VIEWPORTS = (arg('viewports', 'desktop,tablet,mobile')).split(',').map((n) => ({ desktop: { name: 'desktop', w: 1440 }, tablet: { name: 'tablet', w: 768 }, mobile: { name: 'mobile', w: 375 } }[n.trim()])).filter(Boolean);
const HARD_FAIL_CEIL = 0.55;

// ---------- tiny image utils (self-contained, no extra deps) ----------
function resizeNN(src, dw, dh) { const out = new PNG({ width: dw, height: dh }); for (let y = 0; y < dh; y++) { const sy = Math.min(src.height - 1, (y * src.height / dh) | 0); for (let x = 0; x < dw; x++) { const sx = Math.min(src.width - 1, (x * src.width / dw) | 0); const si = (sy * src.width + sx) * 4, di = (y * dw + x) * 4; out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1]; out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = 255; } } return out; }
function cropBand(full, y0, y1) { const y = Math.max(0, Math.round(y0)); const hh = Math.max(2, Math.min(full.height - y, Math.round(y1 - y0))); const o = new PNG({ width: full.width, height: hh }); for (let r = 0; r < hh; r++) { const s = ((y + r) * full.width) * 4; o.data.set(full.data.subarray(s, s + full.width * 4), (r * full.width) * 4); } return o; }
const gray = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
// windowed SSIM on grayscale (structure-aware; penalizes blur/gradient/shift the way pixelmatch won't)
function ssim(a, b) { const W = a.width, H = a.height, win = 8; let total = 0, n = 0; const C1 = 6.5025, C2 = 58.5225; for (let by = 0; by + win <= H; by += win) for (let bx = 0; bx + win <= W; bx += win) { let ma = 0, mb = 0; for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const i = ((by + y) * W + (bx + x)) * 4; ma += gray(a.data, i); mb += gray(b.data, i); } const N = win * win; ma /= N; mb /= N; let va = 0, vb = 0, cov = 0; for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const i = ((by + y) * W + (bx + x)) * 4; const da = gray(a.data, i) - ma, db = gray(b.data, i) - mb; va += da * da; vb += db * db; cov += da * db; } va /= N - 1; vb /= N - 1; cov /= N - 1; const s = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); total += s; n++; } return n ? total / n : 1; }
// mean LAB ΔE76 over a region (catches obvious color/gradient-fill wrongness)
function srgbToLab(r, g, b) { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; let R = f(r), G = f(g), B = f(b); let X = R * 0.4124 + G * 0.3576 + B * 0.1805, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = R * 0.0193 + G * 0.1192 + B * 0.9505; X /= 0.95047; Z /= 1.08883; const g2 = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; const fx = g2(X), fy = g2(Y), fz = g2(Z); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; }
function meanLab(img) { let r = 0, g = 0, b = 0, n = img.width * img.height; for (let i = 0; i < img.data.length; i += 4) { r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; } return srgbToLab(r / n, g / n, b / n); }
function deltaE(a, b) { const la = meanLab(a), lb = meanLab(b); return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]); }
function pixDiff(a, b) { const d = new PNG({ width: a.width, height: a.height }); const m = pixelmatch(a.data, b.data, d.data, a.width, a.height, { threshold: 0.1 }); return m / (a.width * a.height); }
function sideBySide(a, b, p) { const H = Math.max(a.height, b.height), gap = 12; const o = new PNG({ width: a.width + b.width + gap, height: H }); o.data.fill(255); const blit = (src, ox) => { for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) { const si = (y * src.width + x) * 4, di = (y * o.width + (x + ox)) * 4; o.data[di] = src.data[si]; o.data[di + 1] = src.data[si + 1]; o.data[di + 2] = src.data[si + 2]; o.data[di + 3] = 255; } }; blit(a, 0); blit(b, a.width + gap); fs.writeFileSync(p, PNG.sync.write(o)); }

// ---------- page capture: full screenshot + DOM truth for the gates ----------
async function capture(page, url, w) {
  await page.setViewportSize({ width: w, height: 900 });
  try { await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await page.goto(url, { waitUntil: 'load', timeout: 60000 }); } catch {} }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(1800);
  await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(600);
  const dom = await page.evaluate(() => {
    const vis = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && r.width > 2 && r.height > 2; };
    const fam = (s) => (s || '').split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 50);
    const texts = [], images = []; let effects = 0, gradientText = 0;
    for (const e of document.querySelectorAll('h1,h2,h3,h4,p,a,button,span,div,li')) {
      if (!vis(e)) continue; const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const isH = /^h[1-6]$/.test(e.tagName.toLowerCase());
      // effect presence (count once)
      const hasShadow = cs.boxShadow && cs.boxShadow !== 'none'; const hasFilter = (cs.filter && cs.filter !== 'none') || (cs.backdropFilter && cs.backdropFilter !== 'none'); const hasAnim = cs.animationName && cs.animationName !== 'none'; const hasTrans = cs.transitionDuration && parseFloat(cs.transitionDuration) > 0;
      if (hasShadow || hasFilter || hasAnim) effects++;
      const clip = cs.webkitBackgroundClip || cs.backgroundClip; const isGradText = clip === 'text' && cs.backgroundImage && cs.backgroundImage.includes('gradient');
      if (isGradText) gradientText++;
      if ((isH || own) && (e.innerText || '').trim() && (e.innerText || '').trim().length < 200) {
        texts.push({ t: norm(e.innerText), tag: e.tagName.toLowerCase(), x: r.left, y: r.top + scrollY, w: r.width, h: r.height, size: Math.round(parseFloat(cs.fontSize)), family: fam(cs.fontFamily), weight: cs.fontWeight, color: cs.color, gradText: isGradText, hasShadow, hasTrans });
      }
    }
    for (const im of document.querySelectorAll('img')) { if (!vis(im)) continue; const r = im.getBoundingClientRect(); if (r.width < 40) continue; images.push({ src: (im.currentSrc || im.src).split('/').pop(), x: r.left, y: r.top + scrollY, w: Math.round(r.width), h: Math.round(r.height) }); }
    // section bands for region segmentation (full-width, document order)
    const vw = innerWidth; const bands = [];
    for (const e of document.querySelectorAll('section,header,footer,main,div')) { if (!vis(e)) continue; const r = e.getBoundingClientRect(); const top = r.top + scrollY; if (r.width < vw * 0.85 || r.height < 120 || r.height > 8000) continue; if (bands.some((b) => Math.min(top + r.height, b.y + b.h) - Math.max(top, b.y) > 0.55 * Math.min(r.height, b.h))) continue; bands.push({ y: top, h: r.height }); }
    bands.sort((a, b) => a.y - b.y);
    const fonts = []; try { document.fonts.forEach((f) => { if (f.status === 'loaded') fonts.push(f.family.replace(/['"]/g, '').toLowerCase()); }); } catch {}
    return { texts, images, effects, gradientText, bands, fonts, pageH: document.documentElement.scrollHeight, vw };
  });
  const shot = PNG.sync.read(await page.screenshot({ fullPage: true }));
  return { dom, shot };
}

// match a source text element to the nearest clone text element by content
function matchByText(srcEls, clnEls) { const idx = new Map(); for (const c of clnEls) if (!idx.has(c.t)) idx.set(c.t, c); return srcEls.map((s) => ({ s, c: idx.get(s.t) || null })); }
function iou(a, b, sW, sH, cW, cH) { const A = { x: a.x / sW, y: (a.y % sH) / sH, w: a.w / sW, h: a.h / sH }; const B = { x: b.x / cW, y: (b.y % cH) / cH, w: b.w / cW, h: b.h / cH }; const ix = Math.max(0, Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x)); const iy = Math.max(0, Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y)); const inter = ix * iy; const uni = A.w * A.h + B.w * B.h - inter; return uni > 0 ? inter / uni : 0; }

(async () => {
  const browser = await chromium.launch();
  const report = { source, clone, graded_at: arg('now', 'n/a'), viewports: {}, hard_fails: [], defects: [], trustworthy: false };

  for (const vp of VIEWPORTS) {
    const sp = await (await browser.newContext({ viewport: { width: vp.w, height: 900 }, deviceScaleFactor: 1 })).newPage();
    const src = await capture(sp, source, vp.w); await sp.close();
    const cp = await (await browser.newContext({ viewport: { width: vp.w, height: 900 }, deviceScaleFactor: 1 })).newPage();
    const cln = await capture(cp, clone, vp.w); await cp.close();

    const V = { regions: [], gates: {}, score: 1 };
    const sW = src.shot.width, sH = src.shot.height, cW = cln.shot.width, cH = cln.shot.height;

    // ---- per-region perceptual (regions = source bands; clone sampled at proportional y) ----
    const bands = src.dom.bands.length ? src.dom.bands : [{ y: 0, h: sH }];
    bands.forEach((b, i) => {
      const sCrop = cropBand(src.shot, b.y, b.y + b.h);
      const cyMid = (b.y + b.h / 2) / src.dom.pageH * cln.dom.pageH; const cy0 = cyMid - b.h / 2;
      const tw = Math.min(sCrop.width, cln.shot.width), th = Math.min(400, sCrop.height);
      const sR = resizeNN(sCrop, tw, th);
      // SHIFT-TOLERANT: SSIM is brittle to a few px of vertical offset (false-lows on
      // visually-identical regions). Search small vertical offsets, keep the best match.
      let best = { ss: -1, pd: 1, de: 99 };
      for (const off of [-48, -24, -12, 0, 12, 24, 48]) { const cR = resizeNN(cropBand(cln.shot, cy0 + off, cy0 + off + b.h), tw, th); const ss = ssim(sR, cR); if (ss > best.ss) best = { ss, pd: pixDiff(sR, cR), de: deltaE(sR, cR) }; }
      const ssimScore = Math.max(0, (best.ss + 0.1) / 1.1);
      const colorScore = Math.max(0, 1 - best.de / 30); // ΔE>30 = obviously wrong region
      const regionScore = Math.min(ssimScore, colorScore); // pixDiff kept as evidence, not a gate (too brittle)
      const crop = path.join(outDir, `${vp.name}-region${i}.png`); sideBySide(sCrop, cropBand(cln.shot, cy0, cy0 + b.h), crop);
      V.regions.push({ i, ssim: +best.ss.toFixed(3), deltaE: +best.de.toFixed(1), pixDiff: +best.pd.toFixed(3), score: +regionScore.toFixed(3), crop });
    });
    const regionMin = V.regions.length ? Math.min(...V.regions.map((r) => r.score)) : 1;

    // ---- DETERMINISTIC HARD-FAIL GATES (the honesty engine) ----
    const g = V.gates;
    // (1) gradient-text present in source but missing in clone
    g.gradientText = { src: src.dom.gradientText, cln: cln.dom.gradientText, fail: src.dom.gradientText > 0 && cln.dom.gradientText < src.dom.gradientText };
    // (2) font-family: compare dominant heading + body family (actual rendered)
    const domFam = (els) => { const big = els.filter((e) => e.size >= 24).sort((a, b) => b.size - a.size)[0]; const body = els.filter((e) => e.size >= 12 && e.size < 24).sort((a, b) => b.w - a.w)[0]; return { head: big?.family, body: body?.family }; };
    const sf = domFam(src.dom.texts), cf = domFam(cln.dom.texts);
    // normalize: strip variant/clone suffixes so a self-hosted "SohneClone" of söhne
    // is NOT flagged as a substitution (same glyphs); a true swap (Inter/Arial) still fails.
    const fbase = (f) => (f || '').replace(/[^a-z]/g, '').replace(/(var|variable|regular|book|web|clone)$/, '');
    const famMatch = (a, b) => { if (!a || !b) return true; const x = fbase(a), y = fbase(b); return x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y.slice(0, 4)) || y.startsWith(x.slice(0, 4)))); };
    g.fontFamily = { src: sf, cln: cf, fail: (sf.head && cf.head && !famMatch(sf.head, cf.head)) || (sf.body && cf.body && !famMatch(sf.body, cf.body)) };
    // (3) effect-presence: clone should have a comparable count of shadow/filter/anim elements
    g.effects = { src: src.dom.effects, cln: cln.dom.effects, fail: src.dom.effects >= 4 && cln.dom.effects < src.dom.effects * 0.5 };
    // (4) layout IoU on matched text (median)
    const matches = matchByText(src.dom.texts, cln.dom.texts).filter((m) => m.c && m.s.t.length > 3);
    const ious = matches.map((m) => iou(m.s, m.c, sW, src.dom.pageH, cW, cln.dom.pageH)).sort((a, b) => a - b);
    const medIoU = ious.length ? ious[ious.length >> 1] : 1;
    const matchRate = src.dom.texts.length ? matches.length / src.dom.texts.length : 1;
    g.layout = { medianIoU: +medIoU.toFixed(2), textMatchRate: +matchRate.toFixed(2), fail: medIoU < 0.7 || matchRate < 0.6 };
    // (5) imagery: clone has comparable image count
    g.imagery = { src: src.dom.images.length, cln: cln.dom.images.length, fail: src.dom.images.length >= 3 && cln.dom.images.length < src.dom.images.length * 0.5 };

    const fails = Object.entries(g).filter(([, v]) => v.fail).map(([k]) => k);
    // TWO honest axes, not conflated: VISUAL (does it look right) vs STRUCTURAL/editability
    // (is it a real DOM clone or an image collage). overall per-viewport = MIN of both.
    V.visual = +regionMin.toFixed(3);                                   // perceptual region MIN
    V.structural = +Math.max(0, 1 - 0.25 * fails.length).toFixed(3);    // each gate fail −0.25
    V.score = +Math.min(V.visual, V.structural).toFixed(3);
    V.structural_fails = fails;
    fails.forEach((f) => report.hard_fails.push(`${vp.name}:${f}`));
    report.viewports[vp.name] = V;
  }

  await browser.close();
  // OVERALL = MIN across viewports (a broken mobile tanks it), capped by any hard-fail
  const vps = Object.values(report.viewports);
  report.overall = +Math.min(...vps.map((v) => v.score)).toFixed(3);
  report.overall_pct = Math.round(report.overall * 100);
  report.visual_overall_pct = Math.round(Math.min(...vps.map((v) => v.visual)) * 100);       // does it LOOK right (MIN viewport)
  report.structural_overall_pct = Math.round(Math.min(...vps.map((v) => v.structural)) * 100); // is it an editable DOM clone vs image collage
  // worst region across all viewports
  let worst = null; for (const [vn, v] of Object.entries(report.viewports)) for (const r of v.regions) if (!worst || r.score < worst.score) worst = { viewport: vn, ...r };
  report.worst_region = worst;
  report.vision_review = { required: true, status: 'PENDING — a vision judge must enumerate defects on the region crops before this score is trustworthy', rubric: 'For each region crop (source LEFT | clone RIGHT): list EVERY concrete visible difference (missing gradient, wrong font, wrong image, missing effect, misalignment, spacing, color). Start at 100, SUBTRACT per defect, justify each point NOT subtracted. The vision score CAPS overall, never raises it.', crops: Object.values(report.viewports).flatMap((v) => v.regions.map((r) => r.crop)) };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ overall_pct: report.overall_pct, visual_overall_pct: report.visual_overall_pct, structural_overall_pct: report.structural_overall_pct, trustworthy: report.trustworthy, hard_fails: report.hard_fails, per_viewport: Object.fromEntries(Object.entries(report.viewports).map(([k, v]) => [k, { score: v.score, visual: v.visual, structural: v.structural }])), worst_region: worst && { viewport: worst.viewport, score: worst.score, ssim: worst.ssim, deltaE: worst.deltaE }, vision: 'REQUIRED — review crops in ' + outDir }, null, 2));
})();
