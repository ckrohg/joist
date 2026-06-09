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

// CGM = Content-Grid Match (layout-engine effort #1, the GATE). An ALIGNMENT-TOLERANT, content-aware visual
// signal that grade-structure's band-SSIM is BLIND to: it SEES whether content (icons, grid cells, code) is
// PRESENT where the source has it, tolerating small (~1-cell ≈ 60px) misalignment — exactly the faithful-but-
// shifted reconstruction SSIM scores flat. Per coarse cell (24 cols × ~band/40 rows): edge-density + mean
// colour + L/R & T/B asymmetry. For each SOURCE content-cell, best mass-weighted match over a ±1 neighborhood;
// colour + asymmetry penalise WRONG-POSITION content (anti-gaming: a horizontal MIRROR — visibly broken but
// density-symmetric — must NOT score high). Over-density guard zeroes noise/shred floods. Verified on real
// source PNGs: self=1.0, blank=0, noise~0.05, shift12px~0.76 (faithful-misalign passes), rollV~0.27,
// mirror 0.40-0.57 (asymmetric pages ~0.4; a GENUINELY symmetric centered page ~0.57 — that residual is
// fundamental: such a page truly resembles its mirror). REPORT-ONLY: cgm_mean is a diagnostic; it is folded
// into `visual` ONLY behind GRADER_CGM=1 (default OFF → composite byte-identical), and only after the mirror
// residual on symmetric pages is closed (the documented blend-gate condition).
function cgmSig(img, gx, gy) {
  const W = img.width, H = img.height, cw = W / gx, ch = H / gy, N = gx * gy;
  const dens = new Float64Array(N), mr = new Float64Array(N), mg = new Float64Array(N), mb = new Float64Array(N), hA = new Float64Array(N), vA = new Float64Array(N);
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const x0 = Math.floor(i * cw), x1 = Math.floor((i + 1) * cw), y0 = Math.floor(j * ch), y1 = Math.floor((j + 1) * ch), xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
    let g = 0, r = 0, gg = 0, bb = 0, n = 0, L = 0, Ln = 0, R = 0, Rn = 0, T = 0, Tn = 0, Bv = 0, Bn = 0;
    for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1 - 1; x += 3) { const idx = (y * W + x) * 4; const a = gray(img.data, idx); g += Math.abs(a - gray(img.data, idx + 4)); r += img.data[idx]; gg += img.data[idx + 1]; bb += img.data[idx + 2]; n++; if (x < xm) { L += a; Ln++; } else { R += a; Rn++; } if (y < ym) { T += a; Tn++; } else { Bv += a; Bn++; } }
    const k = j * gx + i; if (n) { dens[k] = g / n; mr[k] = r / n; mg[k] = gg / n; mb[k] = bb / n; hA[k] = (Ln ? L / Ln : 0) - (Rn ? R / Rn : 0); vA[k] = (Tn ? T / Tn : 0) - (Bn ? Bv / Bn : 0); }
  }
  return { dens, mr, mg, mb, hA, vA, gx, gy };
}
function cgm(A, B) {
  const off = 1, floor = 4, maxC = 90, asymS = 45;
  const H = Math.min(A.height, B.height), gx = 24, gy = Math.max(1, Math.round(H / 40));
  const a = cgmSig({ width: A.width, height: H, data: A.data }, gx, gy), b = cgmSig({ width: B.width, height: H, data: B.data }, gx, gy);
  let cred = 0, mass = 0, sTot = 0, cTot = 0;
  for (let k = 0; k < a.dens.length; k++) { sTot += a.dens[k]; cTot += b.dens[k]; }
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const k = j * gx + i, ds = a.dens[k]; if (ds < floor) continue;
    let best = 0;
    for (let dj = -off; dj <= off; dj++) for (let di = -off; di <= off; di++) {
      const ni = i + di, nj = j + dj; if (ni < 0 || ni >= gx || nj < 0 || nj >= gy) continue;
      const m = nj * gx + ni, dc = b.dens[m];
      const dr = Math.min(ds, dc) / Math.max(ds, dc, 1e-6);
      const dCol = Math.min(1, (Math.abs(a.mr[k] - b.mr[m]) + Math.abs(a.mg[k] - b.mg[m]) + Math.abs(a.mb[k] - b.mb[m])) / (3 * maxC));
      const dAsym = Math.min(1, (Math.abs(a.hA[k] - b.hA[m]) + Math.abs(a.vA[k] - b.vA[m])) / (2 * asymS));
      const sim = dr * (1 - 0.5 * dCol) * (1 - dAsym);
      if (sim > best) best = sim;
    }
    cred += best * ds; mass += ds;
  }
  let v = mass ? cred / mass : 0;
  const overDensity = cTot / Math.max(sTot, 1e-6);
  if (overDensity > 1.5) v *= Math.max(0, sTot / cTot);
  return { cgm: +v.toFixed(4), overDensity: +overDensity.toFixed(3) };
}

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function capture(ctx, target, isSource) {
  if (!/^https?:/.test(target)) return { shot: PNG.sync.read(fs.readFileSync(target)), texts: [], census: {}, ds: null };
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
    const texts = []; const textPos = []; const seen = new Set();
    // include div: Elementor text-editor widgets render text in <div> wrappers; the own-text filter
    // (direct text-node child) keeps this to leaf text and excludes structural containers.
    // textPos carries each run's y so editability can couple a text run's credit to the VISUAL fidelity of
    // its band (a text reproduced in a SHREDDED/broken-looking band earns little — kills the editability gaming).
    for (const e of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,span,li,div')) {
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && clean(n.textContent)); if (!own) continue;
      const t = clean(e.innerText); if (!t || t.length > 200) continue; if (!vis(e)) continue; if (parseFloat(getComputedStyle(e).fontSize) < 10) continue;
      const k = t.toLowerCase(); if (seen.has(k)) continue; seen.add(k); texts.push(t);
      const r = e.getBoundingClientRect(); textPos.push({ t, y: Math.round(r.top + window.scrollY) });
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

    // ---- DESIGN-SYSTEM TOKEN EXTRACTION (port of the DESIGN.md lint rules) ----
    // We extract a token profile from the rendered page so the grader can score, per the
    // google-labs-code/design.md lint set: contrast-ratio (WCAG AA), missing-primary,
    // missing-typography — adapted from "lint a DESIGN.md file" to "lint a rendered page,
    // and compare source-vs-clone token fidelity".
    const parseRGB = (s) => { const m = (s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); const a = p[3] === undefined ? 1 : p[3]; return { r: p[0], g: p[1], b: p[2], a }; };
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const cratio = (a, b) => { const la = lum(a) + 0.05, lb = lum(b) + 0.05; return la > lb ? la / lb : lb / la; };
    // effective background: an element's own bg is often transparent — walk up to the first painted ancestor
    const bgOf = (el) => { let e = el; while (e) { const c = parseRGB(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; e = e.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
    const sat = (c) => { const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return mx ? (mx - mn) / mx : 0; };
    const palette = new Map();   // "r,g,b" -> painted area (dominant-palette signal)
    const fonts = new Map();     // "family|size|weight" -> count (type-scale signal)
    const radiusSet = new Set();
    let contrastPairs = 0, contrastPass = 0, hasAccent = false, scanned = 0; const cfails = [];
    for (const e of document.querySelectorAll('*')) {
      if (scanned > 4000) break;            // cap for very large pages
      if (!vis(e)) continue;
      scanned++;
      const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); const area = r.width * r.height;
      const bg = parseRGB(cs.backgroundColor);
      if (bg && bg.a > 0.5 && area > 400) { const k = `${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}`; palette.set(k, (palette.get(k) || 0) + area); if (sat(bg) > 0.25 && lum(bg) > 0.03 && lum(bg) < 0.97) hasAccent = true; }
      const rad = parseFloat(cs.borderTopLeftRadius) || 0; if (rad > 0) radiusSet.add(Math.round(rad));
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && clean(n.textContent));
      if (own) {
        const fsz = parseFloat(cs.fontSize) || 0; const fw = cs.fontWeight;
        if (fsz >= 8) {
          const fam = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
          const fk = `${fam}|${Math.round(fsz)}|${fw}`; fonts.set(fk, (fonts.get(fk) || 0) + 1);
          const fg = parseRGB(cs.color);
          if (fg && fg.a > 0.3) { const bgc = bgOf(e); const rr = cratio(fg, bgc); const large = fsz >= 24 || (fsz >= 18.66 && (+fw >= 700 || fw === 'bold')); contrastPairs++; if (rr >= (large ? 3 : 4.5)) contrastPass++; else if (cfails.length < 120) cfails.push({ fg: `rgb(${Math.round(fg.r)},${Math.round(fg.g)},${Math.round(fg.b)})`, bg: `rgb(${Math.round(bgc.r)},${Math.round(bgc.g)},${Math.round(bgc.b)})`, ratio: +rr.toFixed(2), fsz: Math.round(fsz), y: Math.round(r.top + window.scrollY), text: clean(e.innerText).slice(0, 48) }); if (sat(fg) > 0.25) hasAccent = true; }
        }
      }
    }
    const ds = {
      palette: [...palette.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, w]) => { const [r, g, b] = k.split(',').map(Number); return { r, g, b, w }; }),
      fonts: [...fonts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k, c]) => ({ k, c })),
      contrastPairs, contrastPass, hasAccent, fontCount: fonts.size,
      radii: [...radiusSet].sort((a, b) => a - b).slice(0, 8),
      contrastFails: cfails.sort((a, b) => a.ratio - b.ratio).slice(0, 40),
    };
    return { texts, textPos, census, ds, pageH: document.documentElement.scrollHeight };
  });
  const shot = PNG.sync.read(await p.screenshot({ fullPage: true }));
  await p.close(); return { shot, texts: info.texts, textPos: info.textPos, census: info.census, ds: info.ds, pageH: info.pageH };
}

// RESPONSIVE dimension — MOBILE-FIT: does the clone fit the 390px viewport without horizontal overflow?
// This makes the desktop-pixel tradeoff of abs-positioned sections VISIBLE in the objective: a flow page (or
// an abs page whose <=1024 un-pin works) reflows to fit → ~1.0; a desktop-pixel page pinned at 1440 overflows
// → low. NOTE: grade-responsive.mjs's RLG was tried here but bottoms out (~0.045) on raster-heavy hybrids
// because it scores pairwise element-relationship agreement (raster images carry no pairs) — it conflates
// "different DOM" with "not responsive" and can't discriminate the abs tradeoff.
// P0 (mobile-layout QUALITY): two raster-tolerant sub-signals at 390px, in ONE clone pass:
//   • FIT  — no horizontal overflow (a 1440-pinned page that fails to un-pin overflows → low).
//   • ORDER — does the clone's mobile content stack in the SAME reading order as the source? (LCS of the
//             shared text runs by position). Catches abs un-pins that scramble order, and rewards correct-order
//             stacks (flow, or abs sorted by y). This makes the abs mobile-quality cost VISIBLE beyond overflow.
// Returns { fit, mobileTexts } or null. Skipped when clone isn't a URL or --no-responsive.
async function mobileLayout(ctx, cloneUrl) {
  if (process.argv.includes('--no-responsive') || !/^https?:/.test(cloneUrl)) return null;
  const MW = 390; const p = await ctx.newPage();
  try {
    await p.setViewportSize({ width: MW, height: 800 });
    try { await p.goto(cloneUrl, { waitUntil: 'networkidle', timeout: 45000 }); } catch { try { await p.goto(cloneUrl, { waitUntil: 'load', timeout: 30000 }); } catch {} }
    await p.waitForTimeout(700);
    await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); } window.scrollTo(0, 0); });
    await p.waitForTimeout(300);
    const info = await p.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
      const vis = (el) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(el); return !(cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05); };
      const runs = [];
      for (const e of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,span,li,div')) {
        const own = [...e.childNodes].some((n) => n.nodeType === 3 && clean(n.textContent)); if (!own) continue;
        const t = clean(e.innerText); if (!t || t.length > 200) continue; if (!vis(e)) continue;
        const r = e.getBoundingClientRect(); runs.push({ y: Math.round(r.top + window.scrollY), t: t.toLowerCase() });
      }
      runs.sort((a, b) => a.y - b.y); // visual top-to-bottom reading order at mobile width
      const seen = new Set(), out = []; for (const r of runs) { if (seen.has(r.t)) continue; seen.add(r.t); out.push(r.t); }
      return { sw, mobileTexts: out };
    });
    const ratio = info.sw / MW;
    const fit = Math.max(0, Math.min(1, 1 - Math.max(0, ratio - 1.02) * 0.6));
    return { fit, mobileTexts: info.mobileTexts };
  } catch { return null; } finally { await p.close().catch(() => {}); }
}
// ORDER agreement: of the text runs shared by source (reading order) and clone-mobile, what fraction lie in a
// common monotonic subsequence? 1.0 = clone mobile reads in source order; low = scrambled. LCS over the shared set.
function orderAgreement(srcOrder, cloneMobileOrder) {
  const cloneSet = new Set(cloneMobileOrder);
  const A = srcOrder.filter((t) => cloneSet.has(t)); // source-order projection onto shared texts
  const pos = new Map(cloneMobileOrder.map((t, i) => [t, i]));
  const B = A.map((t) => pos.get(t)); // clone-mobile positions in source order
  if (B.length < 3) return 1; // too few shared runs to judge order → neutral
  // longest increasing subsequence length / total (monotonic = same order)
  const tails = []; for (const x of B) { let lo = 0, hi = tails.length; while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < x) lo = m + 1; else hi = m; } tails[lo] = x; }
  return tails.length / B.length;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  const src = await capture(ctx, source, true);
  const cln = await capture(ctx, clone, false);
  const cloneML = await mobileLayout(ctx, clone); // clone mobile fit + reading order (390px)
  const srcML = cloneML ? await mobileLayout(ctx, source) : null; // source mobile reading order (390px reference)
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
  // CGM (content-grid match) — alignment-tolerant content-fidelity signal (effort #1, the GATE). REPORT-ONLY by
  // default: cgm_mean is a diagnostic and `visual` is byte-identical. GRADER_CGM=1 folds it in (33% weight) —
  // enable ONLY after the symmetric-mirror residual is closed (the blend-gate condition, see cgm() comment).
  const cgmRes = cgm(src.shot, cln.shot); const cgmMean = cgmRes.cgm;
  const visual = (process.env.GRADER_CGM === '1')
    ? (0.34 * ssimMean + 0.33 * exactMean + 0.33 * cgmMean) * hPen
    : (0.5 * ssimMean + 0.5 * exactMean) * hPen;

  // ---- editability: source TEXT reproduced as selectable clone text, CREDITED BY VISUAL FIDELITY ----
  // Un-gameable: a source run earns credit = (reproduced ? bandVisual(its y) : 0). So text shredded into a
  // broken-looking band (low band SSIM/exact) earns little, rasterized text earns 0 (not selectable), and
  // only FAITHFULLY-reproduced native text earns full credit. bands are the same 200px bands as `visual`.
  const bandVisAt = (y) => { const b = Math.floor(y / BAND); if (b < 0 || b >= sArr.length) return 0.3; return Math.max(0, Math.min(1, 0.5 * sArr[b] + 0.5 * eArr[b])); };
  const seenT = new Set(); const srcPos = [];
  for (const p of (src.textPos || [])) { const t = norm(p.t); if (t.length < 4 || seenT.has(t)) continue; seenT.add(t); srcPos.push({ t, y: p.y }); }
  const cloneJoined = ' ' + cln.texts.map(norm).join(' | ') + ' ';
  const cloneSet = new Set(cln.texts.map(norm));
  const isCovered = (t) => cloneSet.has(t) || cloneJoined.includes(' ' + t + ' ') || cloneJoined.includes(t);
  let credit = 0, covered = 0;
  for (const { t, y } of srcPos) { if (isCovered(t)) { covered++; credit += bandVisAt(y); } }
  const editability = srcPos.length ? credit / srcPos.length : 0;       // visual-coupled (objective)
  const textCoverage = srcPos.length ? covered / srcPos.length : 0;     // raw coverage (diagnostic only)
  // structure diagnostic: of the clone, how much is native widgets vs raster images
  const c = cln.census; const nativeW = (c.wHeading || 0) + (c.wText || 0) + (c.wButton || 0); const imgW = c.wImage || 0;
  const nativeRatio = (nativeW + imgW) ? nativeW / (nativeW + imgW) : 0;

  // ---- design-system dimension (port of the DESIGN.md lint rules) ----
  // Two flavors of "is the design system right": FIDELITY (clone reproduces the source's tokens) and
  // intrinsic QUALITY (contrast-ratio + missing-primary/typography lint, scored on the clone alone).
  const sds = src.ds || {}, cds = cln.ds || {};
  // contrast-ratio rule (WCAG AA 4.5:1 / 3:1 large) — scored on the CLONE. A pixel-close clone with
  // unreadable text is still broken; this is the lint rule that ties straight into grader-honesty.
  const contrastPass = cds.contrastPairs ? cds.contrastPass / cds.contrastPairs : 1;
  // palette fidelity — source dominant colors (by painted area) reproduced in the clone within deltaE<12.
  // Neutral (=1) when the source is a static image we can't introspect (sds.palette absent).
  const paletteFidelity = (sp, cp) => {
    if (!sp || !sp.length) return 1; if (!cp || !cp.length) return 0;
    const totW = sp.reduce((a, x) => a + x.w, 0) || 1; let matched = 0;
    for (const s of sp) { const sl = srgbLab(s.r, s.g, s.b); if (cp.some((c) => dE(sl, srgbLab(c.r, c.g, c.b)) < 12)) matched += s.w; }
    return matched / totW;
  };
  const palFid = paletteFidelity(sds.palette, cds.palette);
  // type-scale fidelity — source font sizes (2px buckets) + family names reproduced in the clone.
  const typeFidelity = (sf, cf) => {
    if (!sf || !sf.length) return 1; if (!cf || !cf.length) return 0;
    const sizes = (a) => new Set(a.map((f) => Math.round((+f.k.split('|')[1]) / 2) * 2));
    const fams = (a) => new Set(a.map((f) => f.k.split('|')[0]).filter(Boolean));
    const ss = sizes(sf), cs2 = sizes(cf); let sm = 0; for (const x of ss) if ([...cs2].some((y) => Math.abs(x - y) <= 2)) sm++;
    const sizeScore = ss.size ? sm / ss.size : 1;
    const sfam = fams(sf), cfam = fams(cf); let fm = 0; for (const x of sfam) if (cfam.has(x)) fm++;
    const famScore = sfam.size ? fm / sfam.size : 1;
    return 0.6 * sizeScore + 0.4 * famScore;
  };
  const typeFid = typeFidelity(sds.fonts, cds.fonts);
  // completeness — missing-primary / missing-typography lint rules, scored on the CLONE.
  const hasPrimary = cds.hasAccent ? 1 : 0;
  const hasType = (cds.fontCount || 0) >= 2 ? 1 : 0;
  const completeness = 0.5 * hasPrimary + 0.5 * hasType;
  const designSystem = 0.35 * palFid + 0.30 * typeFid + 0.25 * contrastPass + 0.10 * completeness;

  // RESPONSIVE = mobile FIT × mobile ORDER quality (P0). fit guards horizontal overflow; order grades whether
  // the clone's mobile content stacks in the SOURCE'S mobile reading order (LCS of clone@390 vs source@390) —
  // making abs's mobile-layout cost VISIBLE, not just overflow. responsive = 0.5*fit + 0.5*order.
  let responsive = null, mobileFitV = null, mobileOrderV = null;
  if (cloneML && srcML) { mobileFitV = cloneML.fit; mobileOrderV = orderAgreement(srcML.mobileTexts.map(norm), cloneML.mobileTexts.map(norm)); responsive = 0.5 * mobileFitV + 0.5 * mobileOrderV; }
  else if (cloneML) { mobileFitV = cloneML.fit; mobileOrderV = 1; responsive = cloneML.fit; } // source mobile order unavailable → fit only
  // composite: 4 terms when responsive is available, else fall back to the 3-term form (renormalized).
  // Per "grader strictness IS progress": adding a truer dimension may move the headline — that's the win.
  let composite = (responsive != null)
    ? 0.35 * visual + 0.35 * editability + 0.10 * designSystem + 0.20 * responsive
    : 0.45 * visual + 0.45 * editability + 0.10 * designSystem;
  // FLOOR: a broken-looking page can't score high on the other dimensions alone
  if (visual < 0.5) composite = Math.min(composite, visual + 0.1);

  const report = {
    source, clone,
    composite: +composite.toFixed(3),
    visual: +visual.toFixed(3), editability: +editability.toFixed(3), designSystem: +designSystem.toFixed(3), responsive: responsive != null ? +responsive.toFixed(3) : null,
    breakdown: { ssim_mean: +ssimMean.toFixed(3), exactPixel_mean: +exactMean.toFixed(3), cgm_mean: +cgmMean.toFixed(3), cgmOverDensity: cgmRes.overDensity, hRatio: +hRatio.toFixed(3), heightPenalty: +hPen.toFixed(3), textCoverage: +textCoverage.toFixed(3), editVisCoupled: +editability.toFixed(3), srcTextRuns: srcPos.length, cloneTextRuns: cln.texts.length, nativeRatio: +nativeRatio.toFixed(3), cloneWidgets: { heading: c.wHeading, text: c.wText, button: c.wButton, image: c.wImage } },
    designLint: { paletteFidelity: +palFid.toFixed(3), typeFidelity: +typeFid.toFixed(3), contrastPass: +contrastPass.toFixed(3), contrastPairs: cds.contrastPairs || 0, contrastFail: (cds.contrastPairs || 0) - (cds.contrastPass || 0), hasPrimary: !!hasPrimary, hasTypography: !!hasType, cloneFonts: cds.fontCount || 0, clonePalette: (cds.palette || []).length, cloneRadii: cds.radii || [] },
    responsiveDetail: responsive != null ? { mobileFit: +mobileFitV.toFixed(3), mobileOrder: +mobileOrderV.toFixed(3) } : null,
    note: 'composite = 0.35*visual + 0.35*editability + 0.10*designSystem + 0.20*responsive (3-term 0.45/0.45/0.10 fallback when responsive unavailable; visual<0.5 floors it). editability = mean over source text runs of (reproduced-as-selectable ? bandVisual(y) : 0) — coupled to visual so shredded/broken-band text earns little (un-gameable); textCoverage is the raw uncoupled diagnostic. designSystem = 0.35*paletteFidelity + 0.30*typeFidelity + 0.25*contrastPass(WCAG AA) + 0.10*completeness. responsive = 0.5*mobileFit(no 390px overflow) + 0.5*mobileOrder(clone mobile reading-order vs source, LCS).',
  };
  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  // --dumpContrast: show the worst failing text/bg pairs on the CLONE (root-cause probe for low contrastPass)
  if (process.argv.includes('--dumpContrast')) {
    const fails = (cln.ds && cln.ds.contrastFails) || [];
    console.error(`\n===== CLONE CONTRAST FAILS (worst ${fails.length}, of ${(cds.contrastPairs||0)-(cds.contrastPass||0)} total fails / ${cds.contrastPairs||0} pairs) =====`);
    for (const f of fails) console.error(`  ${String(f.ratio).padStart(5)}:1  fg ${f.fg.padEnd(16)} on bg ${f.bg.padEnd(16)} ${f.fsz}px  y=${String(f.y).padStart(5)}  "${f.text}"`);
    fs.writeFileSync(`${outDir}/contrast-fails.json`, JSON.stringify(fails, null, 2));
  }
})();
