#!/usr/bin/env node
/**
 * @purpose P0 (MACHINE_AUDIT): a TRUSTWORTHY ground-truth grader that judges PAINTED PIXELS +
 * real layout — not lying DOM names/computed values. It cannot pass garbage, and `--validate`
 * proves it: a basket of known-good and deliberately-broken pages whose verdict MUST match the
 * eye. Always grade the LIVE page (screenshot), never a proxy.
 *
 * Signals (all painted-reality, MIN-aggregated):
 *   - per-region perceptual (shift-tolerant SSIM + LAB ΔE)        → catches wrong font (glyph shapes), broken regions
 *   - painted-text-color match per matched text region            → catches the green headline
 *   - overlap / out-of-bounds from the clone layout               → catches broken/overlapping layout
 *   - non-blank / content-present                                 → catches empty/failed builds
 *
 * Usage:
 *   node grader-v2.mjs --source <url> --clone <url> [--out dir]
 *   node grader-v2.mjs --validate          # prove the grader on the known basket
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { assertAllowedBase, assertNotBlocked } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: refuse a stray (e.g. paused *.sg-host.com) URL before any navigation.

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const W = 1440;

// ---------- pixel utils ----------
const gray = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
function resizeNN(src, dw, dh) { const o = new PNG({ width: dw, height: dh }); for (let y = 0; y < dh; y++) { const sy = Math.min(src.height - 1, (y * src.height / dh) | 0); for (let x = 0; x < dw; x++) { const sx = Math.min(src.width - 1, (x * src.width / dw) | 0); const si = (sy * src.width + sx) * 4, di = (y * dw + x) * 4; o.data[di] = src.data[si]; o.data[di + 1] = src.data[si + 1]; o.data[di + 2] = src.data[si + 2]; o.data[di + 3] = 255; } } return o; }
function band(full, y0, y1) { const y = Math.max(0, Math.round(y0)); const h = Math.max(2, Math.min(full.height - y, Math.round(y1 - y0))); const o = new PNG({ width: full.width, height: h }); for (let r = 0; r < h; r++) { const s = ((y + r) * full.width) * 4; o.data.set(full.data.subarray(s, s + full.width * 4), (r * full.width) * 4); } return o; }
function cropRect(full, box, dpr = 1) { const x = Math.max(0, (box.x * dpr) | 0), y = Math.max(0, (box.y * dpr) | 0); const w = Math.min(full.width - x, (box.w * dpr) | 0), h = Math.min(full.height - y, (box.h * dpr) | 0); if (w < 3 || h < 3) return null; const o = new PNG({ width: w, height: h }); for (let r = 0; r < h; r++) { const s = ((y + r) * full.width + x) * 4; full.data.copy(o.data, (r * w) * 4, s, s + w * 4); } return o; }
function ssim(a, b) { const Wd = a.width, H = a.height, win = 8, C1 = 6.5, C2 = 58.5; let tot = 0, n = 0; for (let by = 0; by + win <= H; by += win) for (let bx = 0; bx + win <= Wd; bx += win) { let ma = 0, mb = 0; for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const i = ((by + y) * Wd + bx + x) * 4; ma += gray(a.data, i); mb += gray(b.data, i); } const N = win * win; ma /= N; mb /= N; let va = 0, vb = 0, cov = 0; for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const i = ((by + y) * Wd + bx + x) * 4; const da = gray(a.data, i) - ma, db = gray(b.data, i) - mb; va += da * da; vb += db * db; cov += da * db; } va /= N - 1; vb /= N - 1; cov /= N - 1; tot += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++; } return n ? tot / n : 1; }
const srgbLab = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; let R = f(r), G = f(g), B = f(b); let X = (R * .4124 + G * .3576 + B * .1805) / .95047, Y = R * .2126 + G * .7152 + B * .0722, Z = (R * .0193 + G * .1192 + B * .9505) / 1.08883; const g2 = (t) => t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; return [116 * g2(Y) - 16, 500 * (g2(X) - g2(Y)), 200 * (g2(Y) - g2(Z))]; };
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const meanColor = (crop) => { let r = 0, g = 0, b = 0, n = 0; const d = crop.data; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } return n ? [r / n, g / n, b / n] : [255, 255, 255]; };
// dominant non-background color inside a screenshot box (= the painted text color)
function paintedTextColor(full, box, dpr = 1) { const x0 = Math.max(0, (box.x * dpr) | 0), y0 = Math.max(0, (box.y * dpr) | 0), x1 = Math.min(full.width, ((box.x + box.w) * dpr) | 0), y1 = Math.min(full.height, ((box.y + box.h) * dpr) | 0); const buckets = new Map(); let bg = null; const corner = ((y0 * full.width + x0) * 4); bg = [full.data[corner], full.data[corner + 1], full.data[corner + 2]]; for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const i = (y * full.width + x) * 4; const r = full.data[i], g = full.data[i + 1], b = full.data[i + 2]; if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) < 60) continue; const k = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4); buckets.set(k, (buckets.get(k) || [0, 0, 0, 0]).map((v, j) => j === 0 ? v + 1 : v + [0, r, g, b][j])); } let best = null, bc = 0; for (const [, v] of buckets) if (v[0] > bc) { bc = v[0]; best = [v[1] / v[0], v[2] / v[0], v[3] / v[0]]; } return best; }

// ---------- capture (URL or local file) ----------
async function capture(ctx, target, vw = W) {
  const p = await ctx.newPage(); await p.setViewportSize({ width: vw, height: 900 });
  try { await p.goto(target, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(target, { waitUntil: 'load', timeout: 30000 }); } catch {} }
  await p.waitForTimeout(1200);
  await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 80)); } window.scrollTo(0, 0); });
  await p.waitForTimeout(400);
  const dom = await p.evaluate(() => { const out = []; const norm = (t) => (t || '').replace(/\s+/g, ' ').trim(); for (const e of document.querySelectorAll('h1,h2,h3,h4,p,a,button,span,li,div')) { const own = [...e.childNodes].some((n) => n.nodeType === 3 && norm(n.textContent)); if (!own) continue; const t = norm(e.innerText); if (!t || t.length > 120) continue; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); if (r.width < 4 || r.height < 4 || cs.visibility === 'hidden' || +cs.opacity < .1) continue; if (parseFloat(cs.fontSize) < 12) continue; out.push({ t, x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height), fs: Math.round(parseFloat(cs.fontSize)) }); } return { texts: out, pageH: document.documentElement.scrollHeight, vw: innerWidth }; });
  const shot = PNG.sync.read(await p.screenshot({ fullPage: true }));
  await p.close(); return { dom, shot };
}

// ---------- the grade (painted-reality, MIN) ----------
function grade(src, cln) {
  const D = {}; const fails = []; const defects = [];
  const sH = src.shot.height, cH = cln.shot.height;
  // blank/content check
  const contentRatio = cln.dom.texts.length / Math.max(1, src.dom.texts.length);
  if (cln.dom.texts.length < 2 || contentRatio < 0.25) { fails.push('blank/empty'); defects.push(`clone has ${cln.dom.texts.length} text els vs source ${src.dom.texts.length}`); }
  // CONTENT-TEXT-DIFF (deterministic): which source text strings are simply ABSENT from the clone?
  // Catches whole missing sections (e.g. a dropped dark stats band) that perceptual MIN can miss
  // when the missing region happens to align with whitespace. Set-based, normalized, dedup'd.
  const normT = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim();
  const srcSet = [...new Set(src.dom.texts.filter((e) => e.t.length >= 3).map((e) => normT(e.t)))];
  const clnSet = new Set(cln.dom.texts.map((e) => normT(e.t)));
  const missing = srcSet.filter((t) => !clnSet.has(t));
  D.content = srcSet.length ? +Math.max(0, 1 - missing.length / srcSet.length).toFixed(3) : 1;
  if (srcSet.length >= 4 && missing.length / srcSet.length > 0.3) { fails.push('missing-content'); defects.push(`${missing.length}/${srcSet.length} source text strings absent from clone (e.g. ${missing.slice(0, 3).map((t) => '"' + t.slice(0, 24) + '"').join(', ')})`); }
  // per-region perceptual (MIN), regions = vertical thirds-ish slices of source
  const N = Math.max(4, Math.min(12, Math.round(sH / 600)));
  const regionScores = [];
  for (let i = 0; i < N; i++) { const y0 = sH * i / N, y1 = sH * (i + 1) / N; const sCrop = band(src.shot, y0, y1); const cCrop = band(cln.shot, cH * i / N, cH * (i + 1) / N); const tw = Math.min(sCrop.width, cCrop.width), th = 300; let bestSS = -1, bestCC = cCrop; for (const off of [-0.04, 0, 0.04]) { const cc = band(cln.shot, cH * (i / N + off), cH * ((i + 1) / N + off)); const ss = ssim(resizeNN(sCrop, tw, th), resizeNN(cc, tw, th)); if (ss > bestSS) { bestSS = ss; bestCC = cc; } }
    const ssScore = Math.max(0, (bestSS + 0.1) / 1.1);
    // COLOR-AWARE: grayscale SSIM is blind to color/brand (purple→black scores as a match). Mean-LAB ΔE
    // of the band caps a color-mismatched band at 0.4, so palette/brand drift can't read as high fidelity.
    const cd = dE(srgbLab(...meanColor(sCrop)), srgbLab(...meanColor(bestCC))); const colorFactor = Math.max(0, 1 - cd / 40);
    regionScores.push(Math.min(ssScore, 0.4 + 0.6 * colorFactor)); }
  // HEIGHT-RATIO penalty: resizeNN normalizes each band to a fixed height, squishing away page-height
  // inflation (a +18% taller clone with dead whitespace scored as a match). Penalize ratios outside ~±10%.
  const hRatio = sH && cH ? cH / sH : 1; const hPenalty = Math.max(0, 1 - Math.max(0, Math.abs(Math.log(hRatio)) - Math.log(1.10)) * 1.3);
  D.perceptual = +(Math.min(...regionScores) * hPenalty).toFixed(3);
  // MATCHED TEXT BOXES — crop each from both screenshots and compare the RENDERED text:
  // glyph-SSIM catches wrong font; painted-color ΔE catches wrong color (the green). This is
  // the "rendered-glyph" check — whole-region SSIM can't (text is a small fraction of pixels).
  const sdpr = src.shot.width / W, cdpr = cln.shot.width / W;
  const sPageH = src.dom.pageH || sH, cPageH = cln.dom.pageH || cH;
  // Duplicate strings (stat digits "1/5/6", "Contact sales", "Learn more") repeat across the page.
  // Match each source token to the NEAREST clone instance by NORMALIZED position — NOT the first in
  // DOM order, which pairs a top-nav source token with a bottom-of-page clone token (phantom 112%
  // mis-position). Nearest is the fair comparison and still fails `shifted` (every instance moves).
  const cmulti = new Map(); for (const c of cln.dom.texts) { const k = c.t.toLowerCase(); if (!cmulti.has(k)) cmulti.set(k, []); cmulti.get(k).push(c); }
  const nearestC = (s, list) => { let best = null, bd = Infinity; for (const c of list) { const dx = s.x / src.dom.vw - c.x / cln.dom.vw, dy = s.y / sPageH - c.y / cPageH; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = c; } } return best; };
  const matches = src.dom.texts.filter((s) => s.h >= 16 && cmulti.has(s.t.toLowerCase())).map((s) => ({ s, c: nearestC(s, cmulti.get(s.t.toLowerCase())) })).slice(0, 30);
  let worstColorDE = 0, worstTextSS = 1, checked = 0, fontChecked = 0, worstSSIMText = null; const colorDEs = []; const colorDefs = [];
  // GEOMETRY-IoU: matched text in the WRONG position scores low IoU even when glyphs+color match.
  // Normalize each box to its own page (x by viewport width, y by page height) so proportional
  // position is compared, then IoU. Catches "present but misplaced" — the gap text checks miss.
  const ious = []; const posScores = [];
  for (const m of matches) {
    const sB = cropRect(src.shot, m.s, sdpr), cB = cropRect(cln.shot, m.c, cdpr); if (!sB || !cB) continue; checked++;
    const tw = Math.min(sB.width, cB.width, 500), th = Math.min(Math.max(sB.height, cB.height, 24), 90);
    const ss = ssim(resizeNN(sB, tw, th), resizeNN(cB, tw, th));
    // C5 calibration: glyph-SSIM is UNRELIABLE on small text (<16px) — sub-pixel AA + 1-2px shifts
    // tank it even when the font is correct (verified: it false-flagged Stripe's nav, which IS Söhne).
    // Only let text >=16px drive the font dim / hard-fail. Small text is still color-checked below.
    const bigEnough = (m.s.fs || 99) >= 16;
    // MULTI-LINE text wraps differently by container width (3 source lines vs 1 clone line) → glyph-SSIM
    // compares geometrically MISALIGNED crops and tanks even when the font is identical (verified: a 32px
    // subhead reads 0.18 SSIM purely from wrapping, font correct). Only SINGLE-LINE text honestly measures
    // font fidelity. Single-line text is plentiful (nav/headings/labels/buttons) and still catches wrong fonts.
    const singleLine = m.s.h <= (m.s.fs || 16) * 1.9;
    if (bigEnough && singleLine) { fontChecked++; if (ss < worstTextSS) { worstTextSS = ss; worstSSIMText = { t: m.s.t.slice(0, 30), ss: +ss.toFixed(3), fs: m.s.fs, sy: Math.round(m.s.y / sPageH * 100), cy: Math.round(m.c.y / cPageH * 100) }; } if (ss < 0.45) defects.push(`text "${m.s.t.slice(0, 22)}" renders differently (glyph-SSIM ${ss.toFixed(2)} — likely wrong font)`); }
    // textColor: ONLY judge >=16px text — painted-color sampling bleeds into adjacent pixels/icons on
    // small text (verified: 'Guide me' source mis-sampled as lavender though it's navy; size-14 digits
    // sampled inconsistently). Same small-text-reliability floor as textRender. Green headline (large) still caught.
    if (bigEnough) { const sc = paintedTextColor(src.shot, m.s, sdpr), cc = paintedTextColor(cln.shot, m.c, cdpr);
      if (sc && cc) { const d = dE(srgbLab(...sc), srgbLab(...cc)); colorDEs.push(d); if (d > worstColorDE) worstColorDE = d; if (d > 28) { defects.push(`text "${m.s.t.slice(0, 22)}" color off ΔE${d.toFixed(0)} (src ${sc.map(Math.round)} → cln ${cc.map(Math.round)})`); colorDefs.push({ t: m.s.t.slice(0, 26), d: Math.round(d), src: sc.map(Math.round), cln: cc.map(Math.round) }); } } }
    // normalized-box IoU
    const sb = { x: m.s.x / src.dom.vw, y: m.s.y / sPageH, w: m.s.w / src.dom.vw, h: m.s.h / sPageH };
    const cb = { x: m.c.x / cln.dom.vw, y: m.c.y / cPageH, w: m.c.w / cln.dom.vw, h: m.c.h / cPageH };
    const ix = Math.max(0, Math.min(sb.x + sb.w, cb.x + cb.w) - Math.max(sb.x, cb.x)); const iy = Math.max(0, Math.min(sb.y + sb.h, cb.y + cb.h) - Math.max(sb.y, cb.y));
    const inter = ix * iy, uni = sb.w * sb.h + cb.w * cb.h - inter; const iou = uni > 0 ? inter / uni : 0; ious.push(iou);
    // center-distance (normalized): a GRADIENT position signal. IoU is binary for small text
    // (a 4px miss → IoU 0), giving no steering. Distance rewards "close but not overlapping" and
    // still punishes genuine displacement — `shifted` (scale 1.4) moves every center far → fails.
    const cd = Math.hypot((sb.x + sb.w / 2) - (cb.x + cb.w / 2), (sb.y + sb.h / 2) - (cb.y + cb.h / 2));
    const posScore = Math.max(0, 1 - cd / 0.10); posScores.push(posScore);
    if (iou < 0.2 && m.s.h >= 18) defects.push(`text "${m.s.t.slice(0, 22)}" is mispositioned (IoU ${iou.toFixed(2)}, center off ${(cd * 100).toFixed(1)}% — src y${Math.round(m.s.y / sPageH * 100)}% → cln y${Math.round(m.c.y / cPageH * 100)}%)`);
  }
  D.textRender = fontChecked ? +Math.max(0, (worstTextSS + 0.1) / 1.1).toFixed(3) : 1;
  // textColor: drop the SINGLE worst (tolerates one sampling artifact — e.g. the painted sampler
  // bleeding into an adjacent sparkle icon) and use the 2nd-worst. Green-headline still FAILS (>=2
  // green elements → 2nd-worst still high); a lone mis-sampled word no longer zeroes the dimension.
  const desc = colorDEs.slice().sort((a, b) => b - a); const robustDE = desc.length >= 2 ? desc[1] : (desc[0] || 0);
  D.textColor = checked ? +Math.max(0, 1 - robustDE / 60).toFixed(3) : 1;
  // geometry: median center-distance score — a GRADIENT. IoU is kept only for the per-box defect
  // text above; the dimension itself is distance-based so position improvements register before they
  // reach pixel-overlap. `shifted` (every center off ~40%) still drives the median to ~0 → hard fail.
  ious.sort((a, b) => a - b); const medIoU = ious.length ? ious[ious.length >> 1] : 1;
  posScores.sort((a, b) => a - b); const medPos = posScores.length ? posScores[posScores.length >> 1] : 1;
  D.geometry = posScores.length >= 3 ? +medPos.toFixed(3) : 1;
  if (checked && robustDE > 28) fails.push('text-color');
  if (fontChecked && worstTextSS < 0.45) fails.push('text-render/font');
  if (posScores.length >= 4 && medPos < 0.5) { fails.push('geometry'); defects.push(`median center-distance score ${medPos.toFixed(2)} (median IoU ${medIoU.toFixed(2)}) — layout positions systematically off`); }
  // overlap / out-of-bounds on the clone layout
  let overlaps = 0, oob = 0; const ct = cln.dom.texts;
  for (let i = 0; i < ct.length; i++) { const a = ct[i]; if (a.x + a.w > cln.dom.vw + 24 || a.x < -24) oob++; for (let j = i + 1; j < ct.length; j++) { const b = ct[j]; if (a.t === b.t) continue; const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)); const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)); const inter = ix * iy; if (inter > 0.45 * Math.min(a.w * a.h, b.w * b.h)) overlaps++; } }
  D.layout = +Math.max(0, 1 - (overlaps * 0.08 + oob * 0.05)).toFixed(3);
  if (overlaps >= 2) { fails.push('overlap'); defects.push(`${overlaps} overlapping text pairs`); }
  if (oob >= 3) { fails.push('out-of-bounds'); defects.push(`${oob} elements exceed viewport width`); }
  // OVERALL = MIN of all painted-reality dims, hard-capped if any gate tripped
  const dimMin = Math.min(D.perceptual, D.textRender, D.textColor, D.layout, D.content, D.geometry);
  const overall = +(fails.length ? Math.min(dimMin, 0.45) : dimMin).toFixed(3);
  colorDefs.sort((a, b) => b.d - a.d);
  const iouSorted = ious.slice().sort((a, b) => a - b); const iouPct = (p) => iouSorted.length ? +iouSorted[Math.min(iouSorted.length - 1, Math.floor(iouSorted.length * p))].toFixed(2) : 0;
  // FLYWHEEL GUARD: the headline is `overall` (MIN-gated, hard-fail capped), NEVER a single dim. If the
  // rosy perceptual sub-score disagrees with overall by >0.2, the deterministic grader is uncertain →
  // the vision committee MUST arbitrate before the score is trusted (the lesson from the pico audit).
  const vision_required = (D.perceptual - overall) > 0.2;
  return { overall, overall_pct: Math.round(overall * 100), vision_required, dims: D, hard_fails: fails, defects: defects.slice(0, 12), worstColors: colorDefs.slice(0, 8), colorCount: colorDefs.length, robustDE: Math.round(robustDE), worstSSIMText, iouCount: ious.length, iouDist: { p10: iouPct(0.1), p25: iouPct(0.25), p50: iouPct(0.5), p75: iouPct(0.75), p90: iouPct(0.9) }, regionScores: regionScores.map((s) => +s.toFixed(2)) };
}

// ---------- validation basket: KNOWN-good + deliberately-BROKEN ----------
const BASE = `<!doctype html><meta charset=utf8><style>
*{margin:0;box-sizing:border-box;font-family:Inter,Arial,sans-serif}
body{background:#fff;width:1440px}
.nav{display:flex;gap:32px;align-items:center;padding:24px 64px}.nav b{font-size:22px;color:#0a2540}.nav a{color:#0a2540;text-decoration:none;font-size:15px}
.hero{padding:48px 64px}
h1{font-size:54px;line-height:1.1;color:#0a2540;max-width:760px;margin-bottom:20px}
.sub{font-size:22px;line-height:1.4;color:#425466;max-width:620px;margin-bottom:28px}
.cta{display:inline-block;background:#635bff;color:#fff;padding:14px 28px;border-radius:24px;text-decoration:none}
.grid{display:flex;gap:32px;padding:48px 64px}.card{flex:1;background:#f6f9fc;padding:32px;border-radius:12px}.card h3{font-size:20px;color:#0a2540;margin-bottom:8px}.card p{color:#425466}
.foot{padding:48px 64px;background:#0a2540;color:#fff}
</style><body>
<div class="nav"><b>brand</b><a>Products</a><a>Solutions</a><a>Pricing</a></div>
<div class="hero"><h1 id="hl">Financial infrastructure to grow your revenue</h1><div class="sub" id="sub">Accept payments, offer financial services, and implement custom revenue models.</div><a class="cta">Get started</a></div>
<div class="grid"><div class="card"><h3>Payments</h3><p>Accept and optimize payments globally.</p></div><div class="card"><h3>Billing</h3><p>Subscriptions and invoicing built in.</p></div><div class="card"><h3>Connect</h3><p>Payments for platforms and marketplaces.</p></div></div>
<div class="foot">Footer content and links go here for the layout.</div>
</body>`;
const MUTATIONS = {
  good: (h) => h,
  greenHeadline: (h) => h.replace(/id="hl"/, 'id="hl" style="color:#81b81a"').replace(/id="sub"/, 'id="sub" style="color:#81b81a"'),
  wrongFont: (h) => h.replace('font-family:Inter,Arial,sans-serif', 'font-family:Georgia,"Times New Roman",serif'),
  overlap: (h) => h.replace('.hero{padding:48px 64px}', '.hero{padding:48px 64px;position:relative}h1{margin-bottom:-40px !important}.sub{margin-top:-30px !important}'),
  blank: () => `<!doctype html><meta charset=utf8><body style="background:#fff;width:1440px;height:1600px"></body>`,
  shifted: (h) => h.replace('body{background:#fff;width:1440px}', 'body{background:#fff;width:1440px;transform:scale(1.4);transform-origin:top left}'),
};
const EXPECT = { good: 'PASS', greenHeadline: 'FAIL', wrongFont: 'FAIL', overlap: 'FAIL', blank: 'FAIL', shifted: 'FAIL' };

(async () => {
  const browser = await chromium.launch();
  if (has('validate')) {
    const dir = './grader-validate'; fs.mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
    fs.writeFileSync(path.join(dir, 'base.html'), BASE);
    const src = await capture(ctx, 'file://' + path.resolve(dir, 'base.html'));
    console.log('GRADER VALIDATION (verdict must match the known label):\n');
    let allOk = true;
    for (const [name, mut] of Object.entries(MUTATIONS)) { const f = path.join(dir, name + '.html'); fs.writeFileSync(f, mut(BASE)); const cln = await capture(ctx, 'file://' + path.resolve(f)); const r = grade(src, cln); const verdict = r.overall >= 0.75 ? 'PASS' : 'FAIL'; const ok = verdict === EXPECT[name]; allOk = allOk && ok; console.log(`  ${ok ? '✓' : '✗ WRONG'}  ${name.padEnd(14)} → ${verdict} (${r.overall_pct}%) expected ${EXPECT[name]}  | dims ${JSON.stringify(r.dims)} ${r.hard_fails.length ? '| fails ' + r.hard_fails.join(',') : ''}`); if (!ok) console.log(`        defects: ${r.defects.slice(0, 3).join(' | ')}`); }
    console.log(`\n${allOk ? '✅ GRADER IS TRUSTWORTHY — all known cases classified correctly' : '❌ GRADER NOT YET TRUSTWORTHY — fix the ✗ cases above'}`);
    await browser.close(); process.exit(allOk ? 0 : 1);
  }
  const source = arg('source'), clone = arg('clone'); const out = arg('out', './grader-v2-out'); fs.mkdirSync(out, { recursive: true });
  // Cloning a LIVE, A/B-tested, personalized site (Stripe) means source drift between capture-time and
  // grade-time makes individual color/position defects noisy (white-section flips dark, nav items appear/
  // vanish). --freeze <dir> persists the source snapshot the clone was built against; --frozen-source <dir>
  // grades the LIVE clone against THAT frozen snapshot — the fair, reproducible fidelity measure.
  const frozenSrc = arg('frozen-source'), freeze = arg('freeze');
  if (!clone || (!source && !frozenSrc)) { console.error('need --clone and (--source or --frozen-source)'); process.exit(2); }
  // §0 SAFETY GUARD: assert every http(s) URL arg targets a training host (blocks the paused shared host) BEFORE any
  // chromium.goto. (--frozen-source / --freeze are local dirs, not URLs, so they are not guarded here.)
  if (clone && /^https?:/i.test(clone)) assertAllowedBase(clone); if (source && /^https?:/i.test(source)) assertNotBlocked(source); /* source = external read-only; only the paused host is blocked */
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  let src;
  if (frozenSrc) { src = { dom: JSON.parse(fs.readFileSync(path.join(frozenSrc, 'src-dom.json'), 'utf8')), shot: PNG.sync.read(fs.readFileSync(path.join(frozenSrc, 'src-shot.png'))) }; console.error(`[frozen-source] ${src.dom.texts.length} texts, pageH ${src.dom.pageH} ← ${frozenSrc}`); }
  else { src = await capture(ctx, source); if (freeze) { fs.mkdirSync(freeze, { recursive: true }); fs.writeFileSync(path.join(freeze, 'src-dom.json'), JSON.stringify(src.dom)); fs.writeFileSync(path.join(freeze, 'src-shot.png'), PNG.sync.write(src.shot)); console.error(`[freeze] source snapshot → ${freeze}`); } }
  const cln = await capture(ctx, clone);
  const r = grade(src, cln); await browser.close();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(r, null, 2));
  console.log(JSON.stringify({ overall_pct: r.overall_pct, HEADLINE: r.overall_pct + '% (use this, NOT dims.perceptual)', vision_required: r.vision_required, dims: r.dims, hard_fails: r.hard_fails, defects: r.defects, vision: r.vision_required ? '⚠️ perceptual disagrees with overall — RUN committee-grade.mjs / eyeball ' + clone : 'eyeball ' + clone }, null, 2));
})();
