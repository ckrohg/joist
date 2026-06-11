#!/usr/bin/env node
/**
 * @purpose The flywheel's NEW objective function. grade-raster scores pixels only → it rewards
 * RASTERIZATION (turn everything into a screenshot to win), which pulls the cloner AWAY from the real
 * goal: a NATIVE, EDITABLE Elementor page. This grader combines:
 *   • visual    — per-band SSIM + exact-pixel (does it LOOK right; reused from grade-raster)
 *   • editability — fraction of the SOURCE's text reproduced as REAL selectable widgets in the clone,
 *                   NOT baked into a raster image. Photos/genuine media carry no text so they don't
 *                   count against it — rasterizing a photo is fine; rasterizing a TEXT section is not.
 * composite = 0.35·visual + 0.35·editability + 0.10·designSystem + 0.20·responsive (when responsive is
 * measurable; else the 3-term fallback 0.45·visual + 0.45·editability + 0.10·designSystem), with a
 * visual<0.5 FLOOR so a broken-looking page can't score high on the other dimensions alone, plus a
 * bounded human-salient invisible-text defect penalty (cap 0.20; GRADER_NODEFECT=1 disables).
 * (Header corrected 2026-06-09 — the old "0.5·visual + 0.5·editability" claim predated the
 * designSystem/responsive terms; the authoritative formula is the computation below + report.note.)
 * Net: native+faithful > native-rough > hybrid > pure-raster > broken.
 * PUBLISHED-NUMBER DISCIPLINE: while a saturated veto-cap binds corpus-wide (e.g., every abs clone capped at
 * 0.35 by the mid-width cliff), this composite is NON-DISCRIMINATING between those clones — do NOT rank or
 * publish on it; ranking authority = grade-sections published numbers + the vision-judge.
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

// LONG-TEXT CHUNKING (de-inflation fix 2026-06-09). Legacy silently dropped ALL text runs >200 chars from
// BOTH source and clone denominators → textCoverage/editability were BLIND to missing long-form bodies
// (blog posts, docs paragraphs): a clone that dropped every blog body still scored 1.0 coverage. Default-ON
// fix: split long LEAF runs into ≤200-char word-boundary chunks so each chunk is matchable; a wrapper whose
// innerText concatenates text-bearing BLOCK children is still skipped (children are captured individually by
// the same loop — no mega-blob double-count, mirrors capture-layout.mjs's guard). GRADER_NO_LONGTEXT=1 →
// byte-identical legacy path (drop >200). Source cache is keyed per-mode ('-lt' suffix) so modes never share
// a stale capture. NOTE: this is a DE-INFLATION — scores may DROP where clones miss long text; that's the point.
const NO_LONGTEXT = process.env.GRADER_NO_LONGTEXT === '1';

async function capture(ctx, target, isSource) {
  if (!/^https?:/.test(target)) return { shot: PNG.sync.read(fs.readFileSync(target)), texts: [], census: {}, ds: null };
  const p = await ctx.newPage(); await p.setViewportSize({ width: W, height: 900 });
  try { await p.goto(target, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(target, { waitUntil: 'load', timeout: 30000 }); } catch {} }
  await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(1200);
  await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 200)); } window.scrollTo(0, 0); });
  try { await p.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  await p.waitForTimeout(800);
  const info = await p.evaluate((NOLT) => {
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
      const t = clean(e.innerText); if (!t) continue;
      if (t.length > 200) {
        if (NOLT) continue; // legacy: drop long runs entirely (GRADER_NO_LONGTEXT=1)
        if (!vis(e)) continue; if (parseFloat(getComputedStyle(e).fontSize) < 10) continue;
        // mega-blob guard: a wrapper with text-bearing BLOCK children concatenates its whole subtree in
        // innerText — skip it; its children are visited individually by this same loop (no double-count).
        const blockChild = [...e.children].some((c) => { const ct = clean(c.innerText || ''); if (ct.length < 40) return false; const d = getComputedStyle(c).display; return !(d === 'inline' || d.indexOf('inline') === 0); });
        if (blockChild) continue;
        // leaf long run → split into ≤200-char word-boundary chunks (cap 8000 chars, matches capture-layout)
        const words = t.slice(0, 8000).split(' '); const chunks = []; let cur = '';
        for (const w of words) { if (cur && cur.length + 1 + w.length > 200) { chunks.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
        if (cur) chunks.push(cur);
        const r = e.getBoundingClientRect(); const cy = Math.round(r.top + window.scrollY);
        for (const ck of chunks) { const k = ck.toLowerCase(); if (seen.has(k)) continue; seen.add(k); texts.push(ck); textPos.push({ t: ck, y: cy, chunk: 1 }); }
        continue;
      }
      if (!vis(e)) continue; if (parseFloat(getComputedStyle(e).fontSize) < 10) continue;
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
          if (fg && fg.a > 0.3) { const bgc = bgOf(e); const rr = cratio(fg, bgc); const large = fsz >= 24 || (fsz >= 18.66 && (+fw >= 700 || fw === 'bold')); contrastPairs++; if (rr >= (large ? 3 : 4.5)) contrastPass++; else if (cfails.length < 120) cfails.push({ fg: `rgb(${Math.round(fg.r)},${Math.round(fg.g)},${Math.round(fg.b)})`, bg: `rgb(${Math.round(bgc.r)},${Math.round(bgc.g)},${Math.round(bgc.b)})`, ratio: +rr.toFixed(2), fsz: Math.round(fsz), x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height), text: clean(e.innerText).slice(0, 48) }); if (sat(fg) > 0.25) hasAccent = true; }
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
  }, NO_LONGTEXT);
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
// ---- G1 MULTI-WIDTH (grader-truth round 2026-06-10; qa-stepback diagnosis; reversible GRADER_NO_MIDWIDTH=1) ----
// THE HOLE: the grader only ever looked at 1440 (+390 fit/order). The user's QA happened at ~1000-1200px where
// build-absolute is catastrophically broken in two DISTINCT ways the 1440 grade is blind to:
//   • the 1024px CLIFF — at <=1024 (Elementor tablet bp) the abs pins drop (248/263 measured) → unstyled flow
//     stack, page height +82% (h(1024)/h(1025) = 1.82 measured on 3146) → composite VETO-CAP <= 0.35.
//   • 1025-1439 AMPUTATION — a frozen 1440 canvas clips content off the right edge (44 content elements past
//     the viewport at 1200, hero font +33%). Measured by RIGHTMOST-EXTENT of CONTENT elements (own text or
//     img/video/canvas), NOT scrollWidth — overflow-x:hidden masks scrollWidth but a human still sees the cut
//     content (and the hOverflow detector never fires). To protect innocents (marquees/carousels legitimately
//     park content past the edge — the SOURCE itself measures clipped>0), the cap keys on the EXCESS of clone
//     clipped count over the source's own at the same width: excess > 10 ⇒ composite cap <= 0.45.
//   • hero-font-ratio at 1200 (clone heroFs / source heroFs) — reported DIAGNOSTIC only (no cap): the frozen
//     canvas zooms type ~+20-33% at mid-widths; a refine loop can target it.
// CLIFF-PROBE HARDENING (2026-06-10, grader-truth critic — two MUSTFIXES):
//   1. MULTI-SAMPLE: the original probe sampled ONLY h(1024)/h(1025) — dodgeable by un-pinning at <=1023, by
//      custom breakpoints, or by scale-transforms. Now heights are sampled at 1200/1025/1024/900/768 on BOTH
//      clone and source; a blowup that PERSISTS below its cliff (the physics of an abs un-pin) is caught at
//      whichever sample lands below it — a dodge at one boundary is caught by another. Residual (documented
//      honestly): a blowup confined to a narrow window BETWEEN samples (e.g., broken only at 950-1010, fixed
//      again by 900) is not deterministically caught — the vision-judge is the backstop for that exotic shape.
//   2. SOURCE BASELINE: the veto no longer fires on the clone's own h-jump (which would cap a PERFECT clone of
//      a source that legitimately jumps >1.3 at a boundary, and would cap an HONEST flow clone stacking at
//      Elementor's 1024 while the source stacks at 768). Veto metric = CUMULATIVE EXCESS:
//        C(w) = cloneH(w)/cloneH(1200);  S(w) = srcH(w)/srcH(1200);  S_full = clamp(max_w S(w), 1, 2.5)
//        cliffExcess = max over w∈{1025,1024,900,768} of C(w)/S_full;  veto: cliffExcess > 1.3 ⇒ cap 0.35.
//      Honest early-stacking is BORROWED future growth: a clone that stacks at 1024 reaches at most the height
//      the source itself reaches by 768 (same content, same 1-col) ⇒ C(w) ≈ S_full ⇒ excess ≈ 1 ⇒ no cap. A
//      cliffy source raises its own S_full ⇒ a faithful clone of it stays at excess ≈ 1. An abs un-pin blows
//      up FAR past the source's full responsive growth (3146 measured: C(768)=1.837 vs tailwind S_full=1.128
//      ⇒ excess 1.63). S_full clamp 2.5 keeps a degenerate source baseline from de-fanging the veto entirely.
//      When NO source baseline is measurable (source mid-width loads all failed), fall back to the legacy raw
//      adjacent-pair veto (cliffRatio > 1.3) — conservative, and reported as 'raw' in the cap string.
//   • SCALE-TRANSFORM dodge (uniform shrink of a 1440 canvas, no reflow): heights stay FLAT and content stays
//     inside the viewport ⇒ neither the cliff excess nor the amputation/rightmost-extent check fires — that is
//     DELIBERATE honesty, not a gap claim: the deterministic catch is the heroFsVisRatio768 diagnostic
//     (transform-aware visual font size via rect/offsetWidth; a uniformly shrunk page renders its hero at
//     ~0.53x by 768 ⇒ scaleShrinkSuspect=true is REPORTED, no cap) — the vision-judge is the scoring backstop.
// Probes are CLONE-side page loads at 1200/1025/1024/900/768 (+ source at the same widths for the baseline) —
// pure measurement, no scoring of pixels at those widths (that's the vision-judge's job). SOURCE mid-width
// heights are CACHED with the source capture (midwidthSrc key; old caches are patched in place on first run)
// so corpus runs stay cheap. Skipped (like the mobile pass) under --no-responsive or non-URL targets.
// Flag off → no probes, no report fields, composite untouched (byte-identical legacy).
const USE_MIDWIDTH = process.env.GRADER_NO_MIDWIDTH !== '1';
const MW_WIDTHS = [1200, 1025, 1024, 900, 768]; // 1200 = anchor + amputation width; 1025/1024 = Elementor tablet bp pair; 900/768 = dodge pins (un-pin at <=1023 / custom bps persist below the cliff → caught here)
async function midwidthMeasure(ctx, url, width) {
  const p = await ctx.newPage();
  try {
    await p.setViewportSize({ width, height: 900 });
    try { await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 }); } catch { try { await p.goto(url, { waitUntil: 'load', timeout: 30000 }); } catch {} }
    await p.waitForTimeout(900);
    return await p.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      let clipped = 0, maxBeyond = 0;
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        let t = ''; for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
        const isMedia = /^(IMG|VIDEO|CANVAS)$/.test(el.tagName);
        if (!isMedia && !t.trim()) continue;                 // CONTENT elements only (own text or media)
        const beyond = r.right - vw;
        if (beyond > 8) { clipped++; if (beyond > maxBeyond) maxBeyond = beyond; }
      }
      const hero = document.querySelector('h1, .elementor-heading-title');
      let heroFs = null, heroFsVis = null;
      if (hero) {
        heroFs = parseFloat(getComputedStyle(hero).fontSize);
        // VISUAL (transform-aware) font size: rect width includes ancestor scale transforms, offsetWidth is
        // pure layout — their ratio is the effective scale. Catches the scale-shrink dodge diagnostically.
        const hr = hero.getBoundingClientRect(); const lw = hero.offsetWidth || 0;
        heroFsVis = (lw > 0 && hr.width > 0) ? +(heroFs * hr.width / lw).toFixed(1) : heroFs;
      }
      return { h: document.documentElement.scrollHeight, clipped, maxBeyond: Math.round(maxBeyond), heroFs, heroFsVis };
    });
  } catch { return null; } finally { await p.close().catch(() => {}); }
}
async function midwidthProbe(ctx, cloneUrl, srcUrl, cachedSrcMid) {
  if (!USE_MIDWIDTH || process.argv.includes('--no-responsive') || !/^https?:/.test(cloneUrl)) return null;
  const cm = {};
  for (const w of MW_WIDTHS) cm[w] = await midwidthMeasure(ctx, cloneUrl, w);
  const c1200 = cm[1200], c1025 = cm[1025], c1024 = cm[1024];
  if (!c1200 && !c1025 && !c1024) return null;               // probe infrastructure failed entirely → no term
  // source mid-width baseline: cached with the source capture (cheap corpus runs); measured live on cache miss
  let sm = (cachedSrcMid && cachedSrcMid[1200] !== undefined) ? cachedSrcMid : null;
  let smFresh = false;
  if (!sm && srcUrl && /^https?:/.test(srcUrl)) {
    sm = {}; smFresh = true;
    for (const w of MW_WIDTHS) { const m = await midwidthMeasure(ctx, srcUrl, w); sm[w] = m ? { h: m.h, clipped: m.clipped, heroFs: m.heroFs, heroFsVis: m.heroFsVis } : null; }
  }
  const s1200 = sm ? sm[1200] : null, s768 = sm ? sm[768] : null;
  // legacy adjacent-pair ratios — kept as DIAGNOSTICS (+ raw fallback when no source baseline exists)
  const cliffRatio = (c1024 && c1025 && c1024.h > 0 && c1025.h > 0)
    ? +(Math.max(c1024.h, c1025.h) / Math.min(c1024.h, c1025.h)).toFixed(3) : null;
  const srcCliffRatio = (sm && sm[1024] && sm[1025] && sm[1024].h > 0 && sm[1025].h > 0)
    ? +(Math.max(sm[1024].h, sm[1025].h) / Math.min(sm[1024].h, sm[1025].h)).toFixed(3) : null;
  // cumulative growth anchored at 1200, source-baselined excess (the hardened veto metric — see block comment)
  const growthClone = {}, growthSrc = {};
  if (c1200 && c1200.h > 0) for (const w of [1025, 1024, 900, 768]) if (cm[w] && cm[w].h > 0) growthClone[w] = +(cm[w].h / c1200.h).toFixed(3);
  if (s1200 && s1200.h > 0) for (const w of [1025, 1024, 900, 768]) if (sm[w] && sm[w].h > 0) growthSrc[w] = +(sm[w].h / s1200.h).toFixed(3);
  let cliffExcess = null, cliffWidth = null, srcFullGrowth = null;
  if (Object.keys(growthSrc).length && Object.keys(growthClone).length) {
    srcFullGrowth = +Math.min(2.5, Math.max(1, ...Object.values(growthSrc))).toFixed(3);
    for (const w of Object.keys(growthClone)) {
      const e = +(growthClone[w] / srcFullGrowth).toFixed(3);
      if (cliffExcess == null || e > cliffExcess) { cliffExcess = e; cliffWidth = +w; }
    }
  }
  const clipped = c1200 ? c1200.clipped : null;
  const clippedExcess = c1200 ? Math.max(0, c1200.clipped - ((s1200 && s1200.clipped) || 0)) : null;
  const heroFontRatio = (c1200 && s1200 && c1200.heroFs && s1200.heroFs) ? +(c1200.heroFs / s1200.heroFs).toFixed(3) : null;
  const heroFsVisRatio768 = (cm[768] && s768 && cm[768].heroFsVis && s768.heroFsVis) ? +(cm[768].heroFsVis / s768.heroFsVis).toFixed(3) : null;
  const scaleShrinkSuspect = heroFsVisRatio768 != null && heroFsVisRatio768 < 0.75; // diagnostic only, no cap (VJ backstop)
  return {
    cliffRatio, srcCliffRatio, cliffExcess, cliffWidth, srcFullGrowth, growthClone, growthSrc,
    h1024: c1024 ? c1024.h : null, h1025: c1025 ? c1025.h : null,
    heights: Object.fromEntries(MW_WIDTHS.map((w) => [w, cm[w] ? cm[w].h : null])),
    srcHeights: sm ? Object.fromEntries(MW_WIDTHS.map((w) => [w, sm[w] ? sm[w].h : null])) : null,
    clipped, srcClipped: s1200 ? s1200.clipped : null, clippedExcess, maxBeyond1200: c1200 ? c1200.maxBeyond : null,
    heroFontRatio, cloneHeroFs1200: c1200 ? c1200.heroFs : null, srcHeroFs1200: s1200 ? s1200.heroFs : null,
    heroFsVisRatio768, scaleShrinkSuspect,
    _srcMid: sm, _srcMidFresh: smFresh, // internal: persisted into the source cache; stripped from the report
  };
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

// SOURCE CAPTURE CACHE — the clone (our static WP page) is deterministic, but the SOURCE (a live, often dynamic
// site) re-renders run-to-run, injecting ±0.08 noise into the visual term (measured 2026-06-08: identical builds,
// visual swung 0.084). Freezing the source reference makes grading reproducible AND faster. Default: use cache if
// present; --refresh-source (or no http source) forces a live capture. Keyed by source URL.
const SRC_CACHE_DIR = '/tmp/grade-src-cache';
// per-mode cache tag: long-text chunking changes what capture() extracts, so the two modes must never
// share a cached source (a legacy cache would silently hide the chunks → fix would no-op). Legacy tag unchanged.
const srcTag = String(source).replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 40) + (NO_LONGTEXT ? '' : '-lt');
const refreshSource = process.argv.includes('--refresh-source');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  let src, srcMobileTexts = null, srcMidCached = null;
  const srcCacheJson = `${SRC_CACHE_DIR}/${srcTag}.json`, srcCachePng = `${SRC_CACHE_DIR}/${srcTag}.png`;
  const useSrcCache = /^https?:/.test(source) && fs.existsSync(srcCacheJson) && fs.existsSync(srcCachePng) && !refreshSource;
  if (useSrcCache) {
    const meta = JSON.parse(fs.readFileSync(srcCacheJson, 'utf8'));
    src = { shot: PNG.sync.read(fs.readFileSync(srcCachePng)), texts: meta.texts, textPos: meta.textPos, census: meta.census, ds: meta.ds, pageH: meta.pageH };
    srcMobileTexts = meta.mobileTexts;
    srcMidCached = meta.midwidthSrc || null; // cached source mid-width heights (cliff-probe baseline)
  } else {
    src = await capture(ctx, source, true);
  }
  const cln = await capture(ctx, clone, false);
  const cloneML = await mobileLayout(ctx, clone); // clone mobile fit + reading order (390px)
  let srcML = cloneML ? (srcMobileTexts ? { mobileTexts: srcMobileTexts } : await mobileLayout(ctx, source)) : null; // source mobile reading order (390px reference)
  const midwidth = await midwidthProbe(ctx, clone, source, srcMidCached); // G1: multi-boundary cliff + 1200 amputation/hero probes
  if (!useSrcCache && /^https?:/.test(source)) { // persist a fresh source capture for deterministic future grades
    try { fs.mkdirSync(SRC_CACHE_DIR, { recursive: true }); fs.writeFileSync(srcCachePng, PNG.sync.write(src.shot)); fs.writeFileSync(srcCacheJson, JSON.stringify({ texts: src.texts, textPos: src.textPos, census: src.census, ds: src.ds, pageH: src.pageH, mobileTexts: srcML ? srcML.mobileTexts : null, midwidthSrc: midwidth && midwidth._srcMid ? midwidth._srcMid : null })); } catch {}
  } else if (useSrcCache && /^https?:/.test(source) && midwidth && midwidth._srcMidFresh && midwidth._srcMid) {
    // pre-hardening cache lacked midwidthSrc → patch it in place so future corpus runs skip the 5 source loads
    try { const meta = JSON.parse(fs.readFileSync(srcCacheJson, 'utf8')); meta.midwidthSrc = midwidth._srcMid; fs.writeFileSync(srcCacheJson, JSON.stringify(meta)); } catch {}
  }
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
  for (const p of (src.textPos || [])) { const t = norm(p.t); if (t.length < 4 || seenT.has(t)) continue; seenT.add(t); srcPos.push({ t, y: p.y, chunk: !!p.chunk }); }
  const cloneJoined = ' ' + cln.texts.map(norm).join(' | ') + ' ';
  const cloneSet = new Set(cln.texts.map(norm));
  // chunk fallback (long-text fix): the clone may split a long body DIFFERENTLY (per-<p> runs ≤200 chars)
  // so source chunks won't align with clone runs — but space-joining all clone runs reconstructs the body,
  // and every source chunk is a word-boundary substring of the original text → substring match. Applied to
  // CHUNK runs only (never loosens matching for ordinary short runs; vacuous under GRADER_NO_LONGTEXT=1).
  const cloneAll = ' ' + cln.texts.map(norm).join(' ') + ' ';
  const isCovered = (t, chunk) => cloneSet.has(t) || cloneJoined.includes(' ' + t + ' ') || cloneJoined.includes(t) || (!!chunk && cloneAll.includes(t));
  let credit = 0, covered = 0;
  for (const { t, y, chunk } of srcPos) { if (isCovered(t, chunk)) { covered++; credit += bandVisAt(y); } }
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
  // HUMAN-SALIENT DEFECT PENALTY (grader-truth, anti-overstatement) — the grader over-credits geometry and
  // under-penalizes defects a human sees instantly. INVISIBLE TEXT: a salient heading/large run (>=18px) whose
  // computed contrast is ~nil (<1.3). BUT computed color lies for gradient/background-clip:text (resend's hero
  // "Email for developers" reads black via getComputedStyle yet RENDERS light) → so PIXEL-VERIFY against the actual
  // clone screenshot: only count it invisible if the rendered bbox is genuinely FLAT (luminance range < 24). This
  // kills the false-deflation (resend dropped 0.733->0.48 on visible-but-gradient headings). Bounded (cap 0.20).
  const lumRange = (img, bx, by, bw, bh) => {
    let lo = 255, hi = 0, n = 0; const x1 = Math.min(img.width, bx + bw), y1b = Math.min(img.height, by + bh);
    for (let y = Math.max(0, by); y < y1b; y += 2) for (let x = Math.max(0, bx); x < x1; x += 2) { const i = (y * img.width + x) * 4; const L = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]; if (L < lo) lo = L; if (L > hi) hi = L; n++; }
    return n ? hi - lo : 0;
  };
  // G6 INVISIBLE-TEXT UNGATE (grader-truth round 2026-06-10; reversible GRADER_NO_INVISTEXT2=1 → byte-identical
  // legacy). The legacy detector was DOUBLE-GATED (fsz>=18 AND whole-bbox lumRange<24) and NEVER FIRED in
  // production: (a) the size gate excluded every small invisible run (white-on-white 14px body/nav text — a defect
  // a human sees instantly as "missing words"); (b) lumRange over the MERGED element bbox sees NEIGHBORING content
  // (other lines/columns inside a tall/wide box) → range >= 24 even when the run's own glyphs are invisible.
  // V2: drop the size gate entirely (capture already floors at fsz>=8) and PIXEL-VERIFY with per-run LOCAL bg
  // sampling — clip to the run's FIRST LINE strip (height min(h, fsz·1.8) — never the merged multi-line box),
  // take the strip's MEDIAN luma as the LOCAL background (most pixels in any text strip are bg), and count the
  // fraction of pixels contrasting >40 luma against that local bg (glyph pixels). No contrasting pixels
  // (<1%) → the run genuinely renders invisible. The gradient/background-clip:text false-positive the pixel
  // check was built for (resend hero) stays killed: visible gradient glyphs contrast with the local bg → frac
  // >> 1% → not flagged. Penalty formula/cap UNCHANGED (0.04/run, cap 0.20; GRADER_NODEFECT=1 still disables).
  const INVISTEXT2 = process.env.GRADER_NO_INVISTEXT2 !== '1';
  const invisibleLocal = (img, f) => {
    const x0 = Math.max(0, f.x), y0 = Math.max(0, f.y);
    const x1 = Math.min(img.width, f.x + f.w), y1b = Math.min(img.height, f.y + Math.min(f.h, Math.ceil((f.fsz || 16) * 1.8)));
    const lum = [];
    for (let y = y0; y < y1b; y += 2) for (let x = x0; x < x1; x += 2) { const i = (y * img.width + x) * 4; lum.push(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]); }
    if (lum.length < 50) return false;                          // strip too small to verify → don't fire (conservative)
    const sorted = lum.slice().sort((a, b) => a - b); const localBg = sorted[Math.floor(sorted.length / 2)];
    let glyph = 0; for (const L of lum) if (Math.abs(L - localBg) > 40) glyph++;
    return glyph / lum.length < 0.01;                           // <1% contrasting pixels → no visible glyphs
  };
  const invisRuns = INVISTEXT2
    ? (cds.contrastFails || []).filter((f) => f.ratio < 1.3 && f.w > 0 && f.h > 0 && invisibleLocal(cln.shot, f))
    : (cds.contrastFails || []).filter((f) => f.ratio < 1.3 && f.fsz >= 18 && f.w > 0 && lumRange(cln.shot, f.x, f.y, f.w, f.h) < 24);
  const invisDefect = process.env.GRADER_NODEFECT === '1' ? 0 : Math.min(0.20, invisRuns.length * 0.04);
  composite = composite * (1 - invisDefect);
  // ---- G1 MULTI-WIDTH VETO-CAPS (see midwidthProbe block; reversible GRADER_NO_MIDWIDTH=1 → probes skipped,
  // composite untouched). A page whose height blows up past the SOURCE'S OWN full responsive growth at any
  // sampled mid-width (abs-pin drop → unstyled stack; cliffExcess = C(w)/S_full > 1.3, see hardening notes) or
  // amputates >10 content elements past the 1200 viewport (frozen 1440 canvas) is broken at every mid-width a
  // human actually browses at — no 1440 score survives that. Caps are VETOES (min), not subtractions.
  // Source-baselining means a cliffy SOURCE or an honest early-stacker (clone reflows at Elementor's 1024,
  // source at 768) is NOT capped; only growth the source itself never exhibits anywhere in 768-1200 is vetoed.
  const midwidthCaps = [];
  if (midwidth) {
    if (midwidth.cliffExcess != null) {
      if (midwidth.cliffExcess > 1.3) { composite = Math.min(composite, 0.35); midwidthCaps.push(`cliff(excess ${midwidth.cliffExcess}@${midwidth.cliffWidth})→cap0.35`); }
    } else if (midwidth.cliffRatio != null && midwidth.cliffRatio > 1.3) {
      // no source baseline measurable → legacy raw adjacent-pair veto (conservative fallback)
      composite = Math.min(composite, 0.35); midwidthCaps.push(`cliff(raw ${midwidth.cliffRatio})→cap0.35`);
    }
    if (midwidth.clippedExcess != null && midwidth.clippedExcess > 10) { composite = Math.min(composite, 0.45); midwidthCaps.push(`amputation(${midwidth.clippedExcess})→cap0.45`); }
  }

  const report = {
    source, clone,
    composite: +composite.toFixed(3),
    visual: +visual.toFixed(3), editability: +editability.toFixed(3), designSystem: +designSystem.toFixed(3), responsive: responsive != null ? +responsive.toFixed(3) : null,
    breakdown: { ssim_mean: +ssimMean.toFixed(3), exactPixel_mean: +exactMean.toFixed(3), cgm_mean: +cgmMean.toFixed(3), cgmOverDensity: cgmRes.overDensity, hRatio: +hRatio.toFixed(3), heightPenalty: +hPen.toFixed(3), textCoverage: +textCoverage.toFixed(3), editVisCoupled: +editability.toFixed(3), srcTextRuns: srcPos.length, cloneTextRuns: cln.texts.length, nativeRatio: +nativeRatio.toFixed(3), invisibleText: invisRuns.length, invisibleDefect: +invisDefect.toFixed(3), ...(INVISTEXT2 ? { invisDetector: 'localbg-v2', invisRuns: invisRuns.slice(0, 8).map((f) => ({ y: f.y, fsz: f.fsz, ratio: f.ratio, text: f.text })) } : {}), cloneWidgets: { heading: c.wHeading, text: c.wText, button: c.wButton, image: c.wImage } },
    designLint: { paletteFidelity: +palFid.toFixed(3), typeFidelity: +typeFid.toFixed(3), contrastPass: +contrastPass.toFixed(3), contrastPairs: cds.contrastPairs || 0, contrastFail: (cds.contrastPairs || 0) - (cds.contrastPass || 0), hasPrimary: !!hasPrimary, hasTypography: !!hasType, cloneFonts: cds.fontCount || 0, clonePalette: (cds.palette || []).length, cloneRadii: cds.radii || [] },
    responsiveDetail: responsive != null ? { mobileFit: +mobileFitV.toFixed(3), mobileOrder: +mobileOrderV.toFixed(3) } : null,
    // G1 MULTI-WIDTH (absent entirely under GRADER_NO_MIDWIDTH=1 / --no-responsive / probe failure → legacy report shape).
    ...(midwidth ? { midwidth: (({ _srcMid, _srcMidFresh, ...pub }) => ({ ...pub, caps: midwidthCaps }))(midwidth) } : {}),
    note: 'composite = 0.35*visual + 0.35*editability + 0.10*designSystem + 0.20*responsive (3-term 0.45/0.45/0.10 fallback when responsive unavailable; visual<0.5 floors it). editability = mean over source text runs of (reproduced-as-selectable ? bandVisual(y) : 0) — coupled to visual so shredded/broken-band text earns little (un-gameable); textCoverage is the raw uncoupled diagnostic. designSystem = 0.35*paletteFidelity + 0.30*typeFidelity + 0.25*contrastPass(WCAG AA) + 0.10*completeness. responsive = 0.5*mobileFit(no 390px overflow) + 0.5*mobileOrder(clone mobile reading-order vs source, LCS).',
  };
  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  try { fs.writeFileSync(`${outDir}/clone.png`, PNG.sync.write(cln.shot)); fs.writeFileSync(`${outDir}/source.png`, PNG.sync.write(src.shot)); } catch {}
  // --dumpContrast: show the worst failing text/bg pairs on the CLONE (root-cause probe for low contrastPass)
  if (process.argv.includes('--dumpContrast')) {
    const fails = (cln.ds && cln.ds.contrastFails) || [];
    console.error(`\n===== CLONE CONTRAST FAILS (worst ${fails.length}, of ${(cds.contrastPairs||0)-(cds.contrastPass||0)} total fails / ${cds.contrastPairs||0} pairs) =====`);
    for (const f of fails) console.error(`  ${String(f.ratio).padStart(5)}:1  fg ${f.fg.padEnd(16)} on bg ${f.bg.padEnd(16)} ${f.fsz}px  y=${String(f.y).padStart(5)}  "${f.text}"`);
    fs.writeFileSync(`${outDir}/contrast-fails.json`, JSON.stringify(fails, null, 2));
  }
})();
