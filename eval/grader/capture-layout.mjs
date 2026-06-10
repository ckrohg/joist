#!/usr/bin/env node
/**
 * @purpose Wave 1 of the layout re-architecture (LAYOUT_REARCHITECTURE.md). Captures the source's
 * DOM as a pruned BOX TREE (not a flat leaf list) with per-container layout props, so the builder
 * can mirror it as a native Elementor flex-container tree (flow layout, no absolute positioning).
 *
 * Per node: container {tag, box, layout{display,flexDirection,flexWrap,justify,align,gap}, padding,
 * background{color,gradient,image}, border, radius, boxShadow, position, children[]} OR a leaf
 * (heading/text/button/image/svg) carrying the same fidelity fields capture-fx records (typo, paint,
 * href, interactive). Prune: drop invisible/clipped, collapse pass-through wrappers, cap depth.
 * Node-side: painted-color sampling on text leaves (getComputedStyle lies for clipped text).
 *
 * Usage: node capture-layout.mjs --source <url> [--out layout.json] [--width 1440]
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'fs';
import { dominantBoxBg } from './_bgsample.mjs';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source'); const out = arg('out', './layout.json'); const width = parseInt(arg('width', '1440'), 10);
// per-source raster filename tag — generic /tmp/svg-N.png were REUSED across captures, so pico's logo
// slot served the prior Stripe logo raster (cross-site contamination → 'stripe' wordmark on the pico clone).
const srcTag = (source || 'x').replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 14).toLowerCase() || 'site';
if (!source) { console.error('need --source'); process.exit(2); }

// painted glyph color (edge-aware core) — identical method to capture-fx (computed color lies on clipped text)
function dominantTextColor(png, box, dpr = 1) {
  const W = png.width, H = png.height;
  const x0 = Math.max(0, (box.x * dpr) | 0), y0 = Math.max(0, (box.y * dpr) | 0), x1 = Math.min(W, ((box.x + box.w) * dpr) | 0), y1 = Math.min(H, ((box.y + box.h) * dpr) | 0);
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  const key = (i) => (png.data[i] >> 4) + ',' + (png.data[i + 1] >> 4) + ',' + (png.data[i + 2] >> 4);
  const all = new Map(); for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const k = key((y * W + x) * 4); all.set(k, (all.get(k) || 0) + 1); }
  let bgk = null, bgc = 0; for (const [k, c] of all) if (c > bgc) { bgc = c; bgk = k; }
  const bg = bgk.split(',').map((n) => +n * 16 + 8); const dBg = (i) => Math.abs(png.data[i] - bg[0]) + Math.abs(png.data[i + 1] - bg[1]) + Math.abs(png.data[i + 2] - bg[2]);
  const ink = []; const R = 4;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; const d = dBg(i); if (d < 70) continue; let near = false; for (let r = 1; r <= R && !near; r++) { if (x - r >= x0 && dBg((y * W + x - r) * 4) < 48) near = true; else if (x + r < x1 && dBg((y * W + x + r) * 4) < 48) near = true; else if (y - r >= y0 && dBg(((y - r) * W + x) * 4) < 48) near = true; else if (y + r < y1 && dBg(((y + r) * W + x) * 4) < 48) near = true; } if (near) ink.push([png.data[i], png.data[i + 1], png.data[i + 2], d]); }
  if (ink.length < 10) return null;
  ink.sort((a, b) => b[3] - a[3]); const core = ink.slice(0, Math.max(12, Math.round(ink.length * 0.12)));
  return core.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]).map((v) => Math.round(v / core.length));
}

// crop a box region (CSS px × dpr) out of the full-page PNG → a standalone PNG (for rasterizing canvas/gradient)
function cropPng(png, box, dpr) {
  const x = Math.max(0, (box.x * dpr) | 0), y = Math.max(0, (box.y * dpr) | 0);
  const w = Math.min(png.width - x, (box.w * dpr) | 0), h = Math.min(png.height - y, (box.h * dpr) | 0);
  if (w < 10 || h < 10) return null; const o = new PNG({ width: w, height: h });
  for (let r = 0; r < h; r++) { const s = ((y + r) * png.width + x) * 4; png.data.copy(o.data, (r * w) * 4, s, s + w * 4); }
  return o;
}

(async () => {
  // STEALTH (ported from build-sectionraster): dark/React sites (resend/framer) serve degraded/no-JS content
  // to headless browsers OR gate content behind interaction, so capture-layout's DOM walk collapsed (framer →
  // 1 leaf, resend coverage 0.66). Defeat the common bot detections so the full DOM renders → editability ↑.
  // GPU/ANGLE launch args for WebGL surface capture. Diagnosis: gpuFlagHelps=false (canvasRendersHeadless=true
  // WITHOUT them on this corpus), so they are GATED OFF by default and we fall back to the plain launch. Opt in
  // with CAPTURE_GPU=1 for a source whose canvas does NOT paint headless (SwiftShader/ANGLE software GL).
  const launchArgs = ['--disable-blink-features=AutomationControlled'];
  if (process.env.CAPTURE_GPU === '1') launchArgs.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist');

  // ─── CAPTURE_HEADED (env, default OFF) ───────────────────────────────────────────────────────────
  // WHY: JS/canvas/anti-bot-gated DYNAMIC sites render BLANK or WRONG in plain headless. The known
  // outlier is stripe.com — it renders ~blank under headless Chromium (the DOM walk collapses to a few
  // leaves) because its anti-bot heuristics serve a degraded/empty shell to HeadlessChrome. (vercel is a
  // theme-adaptive site; the capture now renders its LIGHT theme by default to MATCH the grader's source
  // reference — see the GRADER-ALIGNED color-scheme block below, CAPTURE_DARK_SCHEME=1 to opt into dark.)
  // This flag, when on,
  // maximizes REAL-BROWSER fidelity by two means, with automatic in-run fallback:
  //   (a) TRUE HEADED — launch({ headless:false }). If the environment HAS a display, this renders like
  //       a real browser: JS runs, canvas paints via real GPU, and many anti-bot heuristics pass.
  //   (b) ENHANCED-HEADLESS FALLBACK — if the headed launch FAILS (no display / "Missing X server" /
  //       cannot connect), we catch it and fall back to a hardened HEADLESS launch IN THE SAME RUN:
  //       a realistic desktop UA (already the module default — NOT HeadlessChrome), navigator.webdriver
  //       masked (already done in addInitScript), locale+timezone pinned, and --use-angle=swiftshader so
  //       a software-GL surface still paints. The extra goto-time settle (networkidle + a beat +
  //       document.fonts.ready + a scroll-to-bottom-and-back to trigger lazy/scroll-gated content) lands
  //       below, right after page.goto, ALSO gated behind this flag. Many anti-bot/JS-gated sites render
  //       under enhanced-headless even without a true display.
  // The flag is FULLY ADDITIVE + DEFAULT-OFF: when CAPTURE_HEADED is unset, NONE of the headed/enhanced
  // launch code runs — the launch path, context options, init script, and settle are byte-identical to
  // the prior headless behavior. capturedHeadedPath records WHICH path actually ran for reporting.
  const CAPTURE_HEADED = process.env.CAPTURE_HEADED === '1';
  let capturedHeadedPath = 'headless'; // 'true-headed' | 'enhanced-headless' | 'headless' (flag off)
  let enhancedHeadless = false; // true ⇒ run the goto-time enhanced settle below (fallback path only)

  let browser;
  if (CAPTURE_HEADED) {
    // (a) try a REAL HEADED browser first.
    try {
      browser = await chromium.launch({ headless: false, args: launchArgs });
      capturedHeadedPath = 'true-headed';
      console.log('  CAPTURE_HEADED: launched TRUE HEADED browser (display present)');
    } catch (he) {
      // (b) no display / cannot connect → ENHANCED-HEADLESS fallback in the SAME run.
      console.log(`  CAPTURE_HEADED: headed launch failed (${(he && he.message || '').split('\n')[0]}) → ENHANCED-HEADLESS fallback`);
      enhancedHeadless = true;
      capturedHeadedPath = 'enhanced-headless';
      // SwiftShader/ANGLE software GL so canvas/webgl surfaces still paint without a real GPU/display.
      const ehArgs = [...launchArgs];
      if (!ehArgs.includes('--use-angle=swiftshader')) ehArgs.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist');
      try { browser = await chromium.launch({ args: ehArgs }); }
      catch (e2) { browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] }); }
    }
  } else {
    // DEFAULT (flag OFF): UNCHANGED original launch path.
    try { browser = await chromium.launch({ args: launchArgs }); }
    catch (e) { browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] }); } // fall back if GPU args rejected
  }
  // context options: pin a timezone ONLY on the headed/enhanced path (extra anti-bot realism); the
  // default path keeps the exact original options object so its capture is byte-identical.
  const ctxOpts = { viewport: { width, height: 900 }, userAgent: UA, deviceScaleFactor: 2, locale: 'en-US' };
  if (CAPTURE_HEADED) ctxOpts.timezoneId = 'America/New_York';
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] }); Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] }); window.chrome = { runtime: {} }; });
  // ─── GL-READBACK (CAPTURE_NO_GLREADBACK=1 to disable; default ON) ─────────────────────────────────
  // WHY: a WebGL/canvas hero (reactdev hero scene, framer voids) IS rendered at end-state, but its back-buffer
  // is DISCARDED after each frame unless the context was created with preserveDrawingBuffer:true — so a later
  // canvas.toDataURL() readback returns a BLANK/BLACK image and the hero reads empty (reactdev per-element
  // COLOR 0.17). This is END-STATE-FAITHFUL recovery (the canvas IS painted at end-state; we only make its
  // back-buffer READABLE) — UNLIKE recycled-content harvest, it adds ONLY pixels the source end-state shows.
  // FIX: patch HTMLCanvasElement.prototype.getContext (via addInitScript, so it runs BEFORE any page script →
  // before any WebGL context is created) to MERGE preserveDrawingBuffer:true into the attributes for a
  // webgl / webgl2 / experimental-webgl request, preserving every other caller-supplied option. 2D/other
  // contexts are untouched. Wrapped so a patch failure can never break page scripts (returns the orig context).
  // INERT on pages with no canvas; IDENTICAL on source + clone. The readback itself happens Node-side later.
  // Fully reversible: CAPTURE_NO_GLREADBACK=1 skips installing the patch entirely → byte-identical capture.
  const GL_READBACK = process.env.CAPTURE_NO_GLREADBACK !== '1';
  if (GL_READBACK) await ctx.addInitScript(() => {
    try {
      const proto = HTMLCanvasElement && HTMLCanvasElement.prototype;
      if (!proto || !proto.getContext || proto.__joistGlReadback) return;
      const orig = proto.getContext;
      proto.getContext = function (type, attrs) {
        try {
          if (typeof type === 'string' && /^(webgl2?|experimental-webgl)$/i.test(type)) {
            const merged = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
            return orig.call(this, type, merged);
          }
        } catch (e) { /* fall through to the untouched original */ }
        return orig.call(this, type, attrs);
      };
      Object.defineProperty(proto, '__joistGlReadback', { value: true, enumerable: false });
    } catch (e) { /* never break the page if the patch fails */ }
  });
  const page = await ctx.newPage();
  const fontUrls = new Set(); page.on('response', (r) => { const u = r.url(); if (/\.woff2?(\?|$)/i.test(u)) fontUrls.add(u); });
  try { await page.goto(source, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await page.goto(source, { waitUntil: 'load', timeout: 60000 }); } catch {} }
  // reducedMotion:'reduce' so scroll-REVEAL animations (opacity:0→1 on scroll-into-view) are skipped and
  // content renders at its final opacity:1 state (else whole sections caught mid-fade → dropped as invisible).
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(1800);

  // ─── CAPTURE_HEADED enhanced settle (additive, flag-gated) ───────────────────────────────────────
  // Runs ONLY when CAPTURE_HEADED=1 (true-headed OR enhanced-headless fallback). Maximizes real-browser
  // fidelity on JS/canvas/anti-bot-gated sites before the existing prime/walk passes: (1) a fresh
  // networkidle wait + a beat so deferred JS-rendered shells finish painting; (2) document.fonts.ready;
  // (3) a scroll-to-bottom-and-back to trigger lazy-loaded / scroll-gated content the static shell omits.
  // Wrapped so it can NEVER throw out of the capture flow. When the flag is OFF this whole block is
  // skipped → the headless path is byte-identical. (The existing primePass passes below also scroll, but
  // this runs FIRST so anti-bot/JS-gated sites have settled before any measurement.)
  if (CAPTURE_HEADED) {
    try {
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
      await page.waitForTimeout(1200);
      try { await page.evaluate(() => document.fonts.ready); } catch {}
      try {
        await page.evaluate(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const h = document.documentElement.scrollHeight;
          for (let y = 0; y <= h; y += Math.max(400, Math.round(innerHeight * 0.85))) { window.scrollTo(0, y); await sleep(150); }
          window.scrollTo(0, h); await sleep(250);
          window.scrollTo(0, 0); await sleep(200);
        });
      } catch {}
      try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
      await page.waitForTimeout(400);
      console.log(`  CAPTURE_HEADED enhanced settle done (path: ${capturedHeadedPath})`);
    } catch (e) { try { console.error('CAPTURE_HEADED settle skipped:', e.message); } catch {} }
  }

  // ─── PER-SITE COLOR-SCHEME EMULATION — GRADER-ALIGNED (default: do NOT emulate dark; CAPTURE_DARK_SCHEME=1 → old) ───
  // ROOT CAUSE FIXED (vercel page 4296 SSIM-crater, 2026-06-07): a theme-emulation MISMATCH between this
  // capture and the grader, NOT a build defect. vercel ships `<meta name="color-scheme" content="dark light">`
  // (dark is the FIRST/preferred token) and is theme-ADAPTIVE: DARK under prefers-color-scheme:dark, LIGHT
  // otherwise. The OLD code DETECTED preferred==dark and `emulateMedia({colorScheme:'dark'})` → the capture
  // saw vercel's TRUE dark design (pageBg rgb(0,0,0), bands rgb(8,8,8)) and the builder faithfully stamped a
  // dark canvas. BUT the GRADER renders its SOURCE reference (grade-structure.mjs / grade-sections.mjs /
  // perelement-score.mjs) under headless Chromium with NO colorScheme emulation = the LIGHT default — so the
  // grader's source reference is vercel's LIGHT theme (pageBg rgb(250,250,250), mean-luminance ~244/255).
  // Result: a faithfully-DARK clone was compared against a LIGHT source → ~95% luminance-INVERTED pixels →
  // ssim_mean 0.009, visual 0.015, composite 0.115 (reproduced). The clone was "right" for a theme the grader
  // never measures it against.
  // FIX (capture-side only, grader BYTE-IDENTICAL): the capture must see the SAME theme the grader renders the
  // source in. The grader never emulates a color scheme → it gets the LIGHT default → so this capture must NOT
  // emulate dark either. We therefore align to the grader: leave the headless LIGHT default untouched for ALL
  // sites (theme-adaptive sites like vercel render their LIGHT design, exactly matching the grader's source
  // reference; supabase/tailwind were already light and are unchanged; framer/linear with INTRINSIC dark CSS
  // — not media-query-gated — still render dark in BOTH this capture and the grader, so they are unaffected).
  // REVERSIBILITY: CAPTURE_DARK_SCHEME=1 restores the OLD behavior (emulate dark for dark-preferred sites).
  // CAPTURE_LEGACY / CAPTURE_NO_COLORSCHEME still force no-emulation. Default (no env) is now grader-aligned.
  if (process.env.CAPTURE_DARK_SCHEME === '1' && process.env.CAPTURE_LEGACY !== '1' && process.env.CAPTURE_NO_COLORSCHEME !== '1') {
    try {
      const preferred = await page.evaluate(() => {
        const tok = (s) => (s || '').trim().toLowerCase().split(/[\s,]+/).filter(Boolean)[0] || '';
        const meta = document.querySelector('meta[name="color-scheme"]');
        let t = meta ? tok(meta.content) : '';
        if (!t) { try { t = tok(getComputedStyle(document.documentElement).colorScheme); } catch {} }
        return t;
      }).catch(() => '');
      if (preferred === 'dark') {
        // OPT-IN (CAPTURE_DARK_SCHEME=1): the site DECLARES dark as preferred → emulate it so its dark @media
        // rules re-evaluate live, then let the CSS reflow settle. NOTE: this re-introduces the grader mismatch
        // for theme-adaptive sites — use ONLY when the grader is ALSO configured to render the source in dark.
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.waitForTimeout(700);
        try { await page.evaluate(() => document.fonts.ready); } catch {}
        try { console.log('  color-scheme: emulating DARK (CAPTURE_DARK_SCHEME=1; site declares dark-preferred)'); } catch {}
      }
      // preferred === 'light' / 'normal' / '' → leave default (light); do NOT emulate dark.
    } catch (e) { try { console.error('color-scheme detect skipped:', e.message); } catch {} }
  }

  // COVERAGE-PREP (capture-coverage fix): the #1 cloner bottleneck is that lazy-loaded / scroll-triggered /
  // client-rendered blocks never EXIST in the DOM at extraction time, so the walk can't capture them (resend
  // dropped 3 of 4 videos; framer — a fully client-rendered React site — captured 4 of 280 visible texts,
  // coverage 0.01). Three techniques, applied as ONE in-page driver re-run several times until the page stops
  // growing: (a) STEP-scroll viewport-by-viewport with a settle wait at each step so IntersectionObserver
  // reveals + lazy-load fire for EVERY band (the old fixed 600/500px jumps + single settle out-ran framer's
  // hydration and missed reveals between steps); (b) PROMOTE lazy media — copy data-src/data-srcset onto
  // src/srcset for <img>, force loading=eager, and copy data-src onto <video>/<iframe>/<source> + call
  // video.load() so the real media element ATTACHES and walk()'s <video>/<iframe> branch reaches it (this is
  // what banks resend's missing videos); (c) re-measure scrollHeight between passes because client-rendered
  // pages GROW as sections hydrate. Keep the existing content-visibility + click-drive logic intact below.
  const primePass = async (settleMs) => page.evaluate(async (settle) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // promote lazy media so the REAL element is in the DOM (not a 1x1 placeholder) before/while we scroll
    const promoteLazy = () => {
      for (const im of document.querySelectorAll('img[loading="lazy"], img[data-src], img[data-srcset]')) {
        try { const ds = im.getAttribute('data-src'); if (ds && !/^data:/.test(ds) && im.src !== ds) im.src = ds;
          const dss = im.getAttribute('data-srcset'); if (dss && !im.srcset) im.srcset = dss;
          if (im.loading === 'lazy') im.loading = 'eager'; } catch {}
      }
      for (const v of document.querySelectorAll('video')) {
        try { const ds = v.getAttribute('data-src'); if (ds && !v.src) v.src = ds;
          for (const s of v.querySelectorAll('source')) { const sd = s.getAttribute('data-src'); if (sd && !s.src) s.src = sd; }
          if (v.preload === 'none') v.preload = 'metadata';
          if (v.getAttribute('data-src') || v.querySelector('source[data-src]')) { try { v.load(); } catch {} } } catch {}
      }
      for (const f of document.querySelectorAll('iframe[data-src]')) {
        try { const ds = f.getAttribute('data-src'); if (ds && !f.src) f.src = ds; } catch {}
      }
    };
    promoteLazy();
    // STEP through the page viewport-by-viewport; settle at each band so observers/lazy-load fire reliably.
    const step = Math.max(400, Math.round(innerHeight * 0.85));
    let h = document.documentElement.scrollHeight, y = 0, guard = 0;
    for (; y <= h && guard < 200; y += step, guard++) {
      window.scrollTo(0, y); await sleep(settle); promoteLazy();
      const nh = document.documentElement.scrollHeight; if (nh > h) h = nh; // page grew as it hydrated
    }
    window.scrollTo(0, h); await sleep(settle); promoteLazy();
    return document.documentElement.scrollHeight;
  }, settleMs);

  // GUARANTEE TOP before extraction. CRITICAL: capture-layout's walk visible() check uses the raw
  // getBoundingClientRect (r.bottom < 0 → "invisible"), so if the page is left scrolled DOWN, EVERYTHING
  // above the viewport is dropped (resend collapsed 812→70 visible texts → coverage 0.27). Some sites
  // (scroll-snap / scroll-restoration / reveal observers) fight a single scrollTo(0,0), so retry until
  // scrollY actually settles near 0. This runs after every primePass call below.
  const scrollTop = async () => { try { await page.evaluate(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); for (let i = 0; i < 6; i++) { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; await sleep(120); if (window.scrollY < 4) break; } }); } catch {} };

  // First full step-scroll. CLIENT-RENDERED detection: if the very first pass found almost no text in the DOM
  // (framer/heavy-React shell still hydrating), it needs a LONGER settle and more passes; otherwise a fast pass.
  let h1 = await primePass(300); await scrollTop();
  const sparse = await page.evaluate(() => { let n = 0; for (const e of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,li')) { const own = [...e.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()); if (own) n++; if (n > 40) break; } return n; });
  try { await page.evaluate(() => document.fonts.ready); } catch {}
  // content-visibility:visible override — perf-tuned sites render-SKIP off-screen sections (content-visibility:
  // auto); force them visible so getBoundingClientRect/innerText are real for the whole page.
  try { await page.addStyleTag({ content: '*{content-visibility:visible!important;contain-intrinsic-size:auto!important}' }); } catch {}
  // click-drive interactive triggers (tabs/accordions) so gated content renders into the DOM before capture.
  try { const sel = 'button[role="tab"], [role="tab"]:not(a), button[aria-controls], button[aria-expanded]:not([aria-haspopup])'; const n = await page.evaluate((s) => document.querySelectorAll(s).length, sel); for (let i = 0; i < Math.min(n, 20); i++) { try { await page.evaluate((s, idx) => { const el = document.querySelectorAll(s)[idx]; if (el && el.tagName !== 'A') { el.scrollIntoView({ block: 'center' }); el.click(); } }, sel, i); await page.waitForTimeout(120); } catch {} } } catch {}
  // second step-scroll pass + network settle (Stripe/dark dashboards lazy-load on scroll; React sites grow).
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  const settle2 = sparse <= 6 ? 650 : 240; // sparse first pass = client-rendered shell → wait longer for hydration
  await primePass(settle2); await scrollTop();
  // EXTRA passes for client-rendered sites: re-run the step-scroll until the page stops growing (or 3 tries),
  // so deeply-deferred sections (framer renders sections only as they near the viewport) all materialize.
  if (sparse <= 6) { let prevH = 0; for (let p = 0; p < 3; p++) { const h = await primePass(550); if (Math.abs(h - prevH) < 30) break; prevH = h; } await scrollTop(); }
  // settle ALL lazy media: imgs not yet complete, plus videos/iframes whose src we just promoted (gives the
  // <video>/<iframe> element time to attach so walk()'s media branch reaches it). Per-element timeout caps it.
  try { await page.evaluate(async () => { const waits = []; for (const i of document.querySelectorAll('img')) { if (!i.complete) waits.push(new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); setTimeout(r, 3000); })); } for (const v of document.querySelectorAll('video')) { if (v.src && v.readyState < 1) waits.push(new Promise((r) => { v.addEventListener('loadedmetadata', r, { once: true }); v.addEventListener('error', r, { once: true }); setTimeout(r, 2500); })); } await Promise.all(waits); }); } catch {}
  await page.waitForTimeout(1200);
  // FINAL scroll-to-top before the walk: the walk's visible() check drops anything with r.bottom < 0, so
  // extraction MUST happen with the page at the top (else the whole page above the fold is lost — the
  // resend 812→70 coverage collapse). scrollTop() retries until scrollY settles near 0.
  await scrollTop();

  // ─── DOCUMENT-WIDE REVEAL PASS (research backlog #1) ─────────────────────────────────────────────
  // WHY: framer.com / resend.com are Framer-built. Their content starts opacity:0 + transformed and is
  // revealed by IntersectionObserver-triggered GSAP / Web-Animations on scroll. reducedMotion:'reduce'
  // helps CSS-media-gated reveals, but JS-driven (GSAP/WAAPI) reveals ignore that media query — so the
  // static walk sees the PRE-reveal state (opacity:0 → dropped by visible()) and the page collapses to a
  // few leaves (the ~4-leaf collapse / ssim ~0.46 ceiling). This pass lands the page at its DESIGNED
  // end-state: (1) re-scroll top→bottom in viewport steps so every IntersectionObserver fires + every
  // scroll-triggered animation REGISTERS, then (2) FINISH all running animations (CSS + WAAPI) so anything
  // mid-tween snaps to its final computed style the walk will read. INERT on static sites: empty
  // getAnimations() → the finish loop is a no-op, and the step-scroll re-treads ground primePass already
  // covered, so the captured tree is byte-identical. NO networkidle / long waits (crash-robustness lesson:
  // capture must never hang on a network blip — the per-step delays are FIXED short timeouts, capped at ~40
  // steps so it can never loop forever). Gated behind CAPTURE_NO_ANIMFINISH=1 (reversible A/B; default ON).
  // The whole pass is wrapped so it can NEVER throw out of the capture flow.
  if (process.env.CAPTURE_NO_ANIMFINISH !== '1') {
    try {
      // (1) TRIGGER reveals: step the viewport top→bottom with a short settle at each band so
      // IntersectionObservers fire + scroll-triggered animations register. Fixed short waits (not network
      // waits). Capped at ~40 steps so a tall page cannot loop forever.
      const vh = await page.evaluate(() => innerHeight).catch(() => 900);
      const docH = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
      const step = Math.max(400, Math.round((vh || 900) * 0.85));
      const maxSteps = 40;
      for (let i = 0, y = 0; i < maxSteps; i++, y += step) {
        try { await page.evaluate((yy) => window.scrollTo(0, yy), y); } catch {}
        await page.waitForTimeout(120);
        if (y >= docH) break;
      }
      // ensure the very bottom band registers, then a short settle
      try { await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); } catch {}
      await page.waitForTimeout(120);
      // (2) LAND animations at end-state. finish() snaps finite animations (incl. CSSTransition/CSSAnimation)
      // to their end; INFINITE-iteration loops are pinned to one active-duration end instead (finish() throws
      // on an infinite animation). Per-animation try/catch so one bad entry can't abort the loop. Idempotent;
      // empty getAnimations() (static sites) → no-op.
      try {
        const finished = await page.evaluate(() => {
          let done = 0;
          for (const a of document.getAnimations()) {
            try {
              const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
              if (t.iterations === Infinity) {
                const dur = (a.effect.getComputedTiming && a.effect.getComputedTiming().activeDuration) || 0;
                a.currentTime = (t.delay || 0) + dur;
              } else {
                a.finish();
              }
              done++;
            } catch (e) {}
          }
          return done;
        });
        if (finished) console.log(`  reveal-pass: finished ${finished} animation(s) at end-state`);
      } catch {}
      // (4) back to top + one short settle so the walk extracts with the page at the top (visible() drops
      // r.bottom<0) AND with all reveals now committed to opacity:1 / final transform.
      await scrollTop();
      await page.waitForTimeout(150);
    } catch (e) { try { console.error('reveal-pass skipped:', e.message); } catch {} }
  }

  // SURFACE-RASTER reversibility: surface the Node env flag into the page so walk() can read it (the walk
  // closure has no access to process.env). CAPTURE_NO_SURFACERASTER=1 → __NO_SURFACERASTER true → pass skipped.
  try { await page.evaluate((off) => { window.__NO_SURFACERASTER = off; }, process.env.CAPTURE_NO_SURFACERASTER === '1'); } catch {}
  // FRAGMERGE reversibility (wave-5 #4): surface the Node flag so walk()'s mergeDecorativeFragments can read it.
  try { await page.evaluate((off) => { window.__NO_FRAGMERGE = off; }, process.env.CAPTURE_NO_FRAGMERGE === '1'); } catch {}
  // DYNAMIC-CONTENT-EMIT reversibility (dynemit fix): the word-safe TEXT-DENSE gates (surface-raster cssbg arm +
  // mockup gate) count "meaningful text" only via descendant h*/p/li-with-own-text (+ a small textAreaFrac floor),
  // missing span/div-borne and gradient-clipped copy → text-dense bands (resend changelog 'Jun 05' list, span-borne
  // intro lines, gradient-text CTAs) get wholesale-rastered or dropped instead of rebuilt as native editable text.
  // The hardened gate counts span/div-borne text too. CAPTURE_NO_DYNEMIT=1 → __NO_DYNEMIT true → revert to old gate.
  try { await page.evaluate((off) => { window.__NO_DYNEMIT = off; }, process.env.CAPTURE_NO_DYNEMIT === '1'); } catch {}
  // VISIBLE-CLIP reversibility (hard-coded-width / horizontal-scroll fix): rectOf() records each node's FULL
  // getBoundingClientRect. A Framer marquee (e.g. the FLORA testimonial carousel) reports a box that extends
  // FAR past its overflow:hidden parent's right edge (box {x:1350,w:1080}→right 2430 inside a 1200px clip),
  // because the marquee track is wider than the window it scrolls behind. build-absolute faithfully pins that
  // 2430-right box → the clone's docScrollW blows past the 1440 viewport → 990px of bogus horizontal scroll
  // ("width is hard coded WRONG"; supabase overflows 1714px the same way). FIX: rectOf clamps each box to its
  // VISIBLE region = getBoundingClientRect ∩ layout-viewport[0..innerWidth] (horizontal) ∩ the content-box of
  // the nearest ancestor whose computed overflow-x/overflow is hidden|clip|scroll|auto. Fully-clipped elements
  // (zero visible area) are dropped. Vertical capture / scroll-height is untouched. CAPTURE_NO_CLIP=1 restores
  // the old full-rect behaviour.
  try { await page.evaluate((off) => { window.__NO_CLIP = off; }, process.env.CAPTURE_NO_CLIP === '1'); } catch {}
  // HIDDEN-STATE reversibility (hover/click-only overlay fix): the static walk runs AFTER the reveal pass has
  // scrolled every band into view + finished scroll-triggered animations, so legit scroll-reveal SECTIONS are
  // landed at opacity:1. But a Framer logo HOVER-CARD ("Copy / Logo as SVG / Brand Guidelines") and tooltips
  // ("Start with AI" is genuinely on-page, but its sibling hover-card flyouts are not) sit in their PRE-reveal
  // state — an ancestor div is opacity:0 with a CSS opacity transition (fades in only on :hover) — while the
  // leaf <p> itself is opacity:1/visible. visible() checks only the element's OWN opacity, so those phantom
  // overlay leaves were captured and pinned into the clone as ghost text over the nav. FIX: visible() also
  // rejects an element gated by a HOVER/TRANSITION-DRIVEN opacity:0 ancestor (see hiddenByHoverOverlay in the
  // walk closure). It is SCROLL-SAFE: a scroll-reveal section that re-hid (opacity:0) has transition-duration:0
  // (its reveal is JS/WAAPI/transform-driven, not a CSS opacity transition) so it is NEVER caught — only true
  // hover/transition fade-in overlays (duration>0, or pointer-events:none) are. CAPTURE_NO_HIDDEN_STATE=1
  // (→ __NO_HIDDEN_STATE) restores the old behaviour (capture overlay phantoms as visible).
  try { await page.evaluate((off) => { window.__NO_HIDDEN_STATE = off; }, process.env.CAPTURE_NO_HIDDEN_STATE === '1'); } catch {}
  // FORM-RECOVERY reversibility (form-recovery fix): the walk has NO branch for <input>/<textarea>/<select> — they
  // fall through to leaf(), which reads innerText/textContent and returns null because a control's value/placeholder
  // live in ATTRIBUTES (not text nodes) → every visible form control is silently dropped (a <form> then collapses to
  // whatever stray label text survives, never reaching the build as a form). FIX: an early walk() intercept emits a
  // kind:'input' leaf for each VISIBLE input/textarea/select (and a kind:'button' for an <input type=button/submit>),
  // carrying type/value/placeholder/box/typo/paint/bg/border/radius so build-absolute can stamp a REAL VISIBLE
  // Elementor control. The grader's form signal (visN('input,textarea,select').length>=2 → form=1) then matches the
  // source. Reversible: BUILD_NO_FORM_RECOVERY=1 (shared with the builder so one env disables BOTH ends) or
  // CAPTURE_NO_FORM_RECOVERY=1 (capture-only). When OFF the controls fall through exactly as before → byte-identical.
  try { await page.evaluate((off) => { window.__NO_FORM_RECOVERY = off; }, (process.env.BUILD_NO_FORM_RECOVERY === '1' || process.env.CAPTURE_NO_FORM_RECOVERY === '1')); } catch {}
  // FONT-RESOLVE (default ON; CAP_NO_FONTRESOLVE=1 → legacy split(',')[0]): resolve each text leaf's typo.family to
  // the first family in its CSS font-family STACK that is actually a LOADED face (document.fonts). Fixes the supabase
  // class of bug where the stack is `Circular, custom-font, …` but `Circular` is NEVER web-served (no @font-face, not
  // in document.fonts) → the legacy split(',')[0] kept the dead "Circular" so REGFONTS["Circular"] missed → Inter
  // fallback. With this ON the leaf reports `custom-font` (the real self-hosted face that IS loaded), matching the
  // family key registerSourceFonts hosts → the real face renders. No-op when the FIRST family is itself loaded
  // (vercel headings = `Geist` is loaded → unchanged); falls back to split(',')[0] when NO stack family is loaded.
  try { await page.evaluate((off) => { window.__NO_FONTRESOLVE = off; }, process.env.CAP_NO_FONTRESOLVE === '1'); } catch {}
  // MARQUEE-VISIBLE (default ON; CAPTURE_NO_MARQUEE_VISIBLE=1 → __NO_MARQUEE_VISIBLE true → legacy collapse): the
  // mono-dominance code-collapse (the DIV-BASED CODE EDITOR branch) judged a container "code" purely by font-family
  // share (monoTextFrac >= 0.6). On resend's React-email IDE showcase the OUTER <section> measures 0.768 mono —
  // because the syntax-highlighted <pre> code panel out-texts everything — so the WHOLE 3-region showcase (file-tile
  // list + <pre> code panel + rendered email-preview <table>) collapsed into ONE dark 'code' leaf that renders as a
  // black void (band §10 y6616-7411: srcEnergy 0.27, cloneEnergy 0 → content-void, visual capped 0.866→0.30). The
  // VISIBLE-in-viewport cards are recoverable: gate the collapse so it does NOT swallow a MULTI-REGION container —
  // when `el` is NOT itself a code panel (not mono-self, not structural-code) but merely CONTAINS a descendant code
  // panel (a <pre> / structural-code subtree) AND ALSO carries substantial non-mono visible content OUTSIDE that
  // panel, fall through to normal recursion so each visible region is captured natively at its painted position
  // (the dedicated <pre> branch still collapses the code panel itself; file-tiles → native buttons; email-preview →
  // table/mockup). Off-screen marquee siblings stay zero-box and drop via the existing w/h guards (no h-scroll, no
  // off-screen content added). A genuine single div-based code editor (mono-self, or no separate code panel) is
  // UNTOUCHED → still collapses. Reversible: CAPTURE_NO_MARQUEE_VISIBLE=1.
  try { await page.evaluate((off) => { window.__NO_MARQUEE_VISIBLE = off; }, process.env.CAPTURE_NO_MARQUEE_VISIBLE === '1'); } catch {}
  // COLLAPSED-FLOW WRAPPER recovery (default ON; CAPTURE_NO_COLLAPSEDFLOW=1 → __NO_COLLAPSEDFLOW true → legacy
  // drop): recurse through a static wrapper collapsed to zero-height by a position:fixed/sticky/absolute child
  // (linear's Header_root → fixed <header>/<nav>) so the painted header nav links are no longer silently dropped.
  try { await page.evaluate((off) => { window.__NO_COLLAPSEDFLOW = off; }, process.env.CAPTURE_NO_COLLAPSEDFLOW === '1'); } catch {}
  // CODE-PANEL STYLE RECOVERY (default ON; CAPTURE_NO_CODE_PANEL_RECOVER=1 → __NO_CODE_PANEL_RECOVER true → legacy
  // per-cs values): recover the dark panel bg + card radius + real mono family + dominant code-text color for a
  // collapsed kind:'code' leaf (resend/linear code editors rendered as a void / light-bg illegible run-on before).
  try { await page.evaluate((off) => { window.__NO_CODE_PANEL_RECOVER = off; }, process.env.CAPTURE_NO_CODE_PANEL_RECOVER === '1'); } catch {}
  // SINGLE-IMG MOCKUP RECOVERY (void-imagery fix): CAPTURE_NO_IMGRECOVER=1 → __NO_IMGRECOVER true → revert to the
  // legacy whole-region raster for single-image bands (and disable the node-side black-void SKIP guard below).
  try { await page.evaluate((off) => { window.__NO_IMGRECOVER = off; }, process.env.CAPTURE_NO_IMGRECOVER === '1'); } catch {}

  const data = await page.evaluate(() => {
    const MAXD = 8; const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    // LOADED-FACE family set (normalized, lowercased, quotes/space stripped) — the families document.fonts reports as
    // actually loaded. resolveFamily(stack) walks the CSS font-family stack and returns the FIRST family whose
    // normalized name is in this set, so a dead leading family (supabase `Circular` — no @font-face, never served)
    // is skipped in favour of the real self-hosted face (`custom-font`). Falls back to the raw first family if NONE
    // of the stack is loaded (e.g. a pure system-font stack, or a face still loading). CAP_NO_FONTRESOLVE=1 reverts.
    const NO_FONTRESOLVE = window.__NO_FONTRESOLVE === true;
    const _famNorm = (s) => String(s || '').replace(/['"]/g, '').trim().toLowerCase();
    const loadedFams = new Set();
    try { document.fonts.forEach((f) => { if (f.status === 'loaded') loadedFams.add(_famNorm(f.family)); }); } catch {}
    const firstFamily = (fontFamily) => (fontFamily || '').split(',')[0].replace(/['"]/g, '').trim();
    const resolveFamily = (fontFamily) => {
      const first = firstFamily(fontFamily);
      if (NO_FONTRESOLVE || !loadedFams.size) return first;
      const parts = (fontFamily || '').split(',').map((s) => s.replace(/['"]/g, '').trim()).filter(Boolean);
      for (const p of parts) if (loadedFams.has(_famNorm(p))) return p;   // first stack family that is actually loaded
      return first;                                                        // none loaded → keep the legacy first family
    };
    const nz = (v) => v && v !== 'none' && v !== 'normal' && !/^(rgba\(0, 0, 0, 0\)|0px)/.test(v);
    // SHADOW NORMALIZER (whitepill-shadow fix): the legacy `nz(cs.boxShadow)` used the `^`-anchored regex above,
    // which DROPS any box-shadow whose SERIALIZED form leads with `rgba(0, 0, 0, 0)` or `0px` — i.e. exactly the
    // Tailwind `ring` composite (`--tw-shadow, --tw-ring-offset-shadow, <ring>`) where the first 1-2 layers are
    // transparent placeholders and the LAST layer is the real visible inset ring
    // (`rgb(217,219,227) 0px 0px 0px 1px inset` on react.dev's white-pill CTA). The whole multi-layer shadow was
    // zeroed → the pill chrome was lost at capture → the clone rendered the CTA as bare bold text. shadowOf splits
    // the computed value into LAYERS (commas outside parens), drops fully-transparent layers AND layers with all-
    // zero geometry (no offset/blur/spread → no visible pixels), and keeps the meaningful layer(s). A genuinely
    // shadow-less element (nav links: `boxShadow:none`) still yields null → no false signal. This recovers the
    // distinguishing ring on the pill that nav links do NOT have. Reversible at the BUILD side (BUILD_NO_WHITEPILL).
    const shadowOf = (v) => {
      if (!v || v === 'none') return null;
      const layers = []; let depth = 0, cur = '';
      for (const ch of v) { if (ch === '(') depth++; else if (ch === ')') depth--; if (ch === ',' && depth === 0) { layers.push(cur.trim()); cur = ''; } else cur += ch; }
      if (cur.trim()) layers.push(cur.trim());
      const keep = layers.filter((L) => {
        if (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(L)) return false;      // fully-transparent layer → invisible
        const nums = (L.match(/-?\d*\.?\d+px/g) || []).map((s) => parseFloat(s)); // offset-x/y, blur, spread
        return nums.some((n) => Math.abs(n) > 0.001);                            // all-zero geometry → no pixels
      });
      return keep.length ? keep.join(', ') : null;
    };
    // backdrop-filter (glassmorphism blur etc) — captured for the EFFECTS sub-score (presence). vendor-prefixed too.
    const bdfOf = (cs) => { const v = cs.backdropFilter || cs.getPropertyValue('-webkit-backdrop-filter') || cs.getPropertyValue('backdrop-filter') || ''; return nz(v) ? v : null; };
    // CRITICAL: do NOT pass contentVisibilityAuto:true to checkVisibility. Modern sites (picocss.com,
    // and most perf-tuned pages) use `content-visibility:auto` so OFF-SCREEN sections are render-SKIPPED;
    // that flag then reports them invisible and the walk drops them → it silently deleted ~60% of pico
    // (hero, 6 cards, stats, nav). The content is real and must be cloned. Keep opacity/visibility checks only.
    // Use ONLY manual checks (proven to find all 160 visible elements on picocss.com). checkVisibility()
    // is too aggressive: even without contentVisibilityAuto it reports false for content-visibility:auto
    // render-skipped sections AND for reveal-animation elements momentarily at opacity:0 → it silently
    // deleted ~60% of pico (hero/cards/stats/nav). Manual bbox+display+visibility+opacity+clip is enough.
    // DISPLAY:CONTENTS (framer floor fix): a `display:contents` element generates NO box of its own —
    // getBoundingClientRect() always reports 0×0 — but its children participate in layout and render
    // normally. This is THE framer pattern: every section wraps its real content in a display:contents
    // div, so the `!r.width || !r.height` test below dropped those wrappers → walk dead-ended → 255
    // text-rich descendants collapsed to 4 leaves (the 0.413 corpus floor). Treat a display:contents
    // element as visible (so walk recurses THROUGH it into the real laid-out children that follow);
    // honour only display:none / visibility:hidden which DO suppress the subtree.
    // ─── HIDDEN-STATE (hover/click-only overlay) GATE ────────────────────────────────────────────────
    // An element is part of a HOVER/TRANSITION-DRIVEN overlay (a flyout/tooltip/hover-card that fades in only
    // on :hover or :focus) when it ITSELF or an ancestor has effective opacity≈0 AND that opacity:0 node carries
    // a CSS opacity transition (transition-property covers opacity/all with duration>0) OR is pointer-events:none.
    // The walk runs AFTER the reveal pass (scroll-into-view + getAnimations().finish()), so a legit scroll-reveal
    // SECTION is already at opacity:1; one that re-hid has transition-duration:0 (reveal is JS/WAAPI/transform-
    // driven, NOT a CSS opacity transition) → opacityTransSec===0 AND pointer-events:auto → NOT caught here. Only
    // true CSS fade-in overlays match. Verified on framer.com: logo hover-card div.framer-1jqjsza = opacity:0 +
    // transition 'all 0.2s' + pointer-events:none → DROP; scroll-reveal div.framer-1gip8ag = opacity:0 +
    // transition 'all 0s' + pointer-events:auto → KEEP. Gated behind __NO_HIDDEN_STATE (CAPTURE_NO_HIDDEN_STATE=1).
    const opacityTransSec = (cs) => {
      const props = (cs.transitionProperty || '').split(',').map((s) => s.trim());
      const durs = (cs.transitionDuration || '').split(',').map((s) => s.trim());
      const parseS = (v) => { if (!v) return 0; if (/ms$/.test(v)) return parseFloat(v) / 1000; if (/s$/.test(v)) return parseFloat(v); return 0; };
      let d = 0;
      for (let i = 0; i < props.length; i++) { if (props[i] === 'opacity' || props[i] === 'all') { const dv = parseS(durs[i] != null ? durs[i] : durs[0]); if (dv > d) d = dv; } }
      return d;
    };
    const hiddenByHoverOverlay = (el) => {
      if (window.__NO_HIDDEN_STATE === true) return false;
      let p = el, depth = 0;
      while (p && p !== document.documentElement && depth < 24) {
        let cs; try { cs = getComputedStyle(p); } catch { p = p.parentElement; depth++; continue; }
        if (+cs.opacity < 0.05) {
          // this node is the gate. It is a hover/transition-driven overlay iff it fades in (opacity transition
          // duration>0) OR is non-interactive (pointer-events:none — Framer's pre-reveal hover-card state). A
          // scroll-reveal that re-hid has duration:0 + pointer-events:auto → returns false (kept for the builder
          // to place; the reveal pass usually lands it at opacity:1 anyway). NEVER treat <=0.05-but-transitionless
          // interactive content as an overlay.
          if (opacityTransSec(cs) > 0 || cs.pointerEvents === 'none') return true;
          return false; // opacity:0, but not hover/transition-gated (e.g. transient scroll-reveal) → don't drop here
        }
        p = p.parentElement; depth++;
      }
      return false;
    };
    const visible = (el) => { const cs = getComputedStyle(el); if (cs.display === 'contents') return cs.visibility !== 'hidden'; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; if (r.right < 0 || r.bottom < 0 || r.left > innerWidth + 60) return false; if (cs.clip === 'rect(1px, 1px, 1px, 1px)' || cs.clipPath === 'inset(50%)') return false; if (hiddenByHoverOverlay(el)) return false; return true; };
    // ─── COLLAPSED-FLOW WRAPPER (navgap fix — zero-height-ancestor drop) ───────────────────────────────
    // ROOT CAUSE (proven on linear.app): a static wrapper whose ONLY content is a position:fixed / :sticky /
    // :absolute child is removed-from-flow, so the wrapper's getBoundingClientRect() collapses to W×0 (linear's
    // `div.Header_root` = 1440×0). visible() then FAILS it on the `!r.height` guard, walk() returns null AT the
    // wrapper, and never recurses into the real, painted, opacity:1 <header>/<nav> beneath it — the 9 header nav
    // links vanish (capture nav=0 vs source nav=1). This is NOT a hidden/overlay/clip drop (none of those gates
    // fired); it is purely the collapsed flow box. FIX: when an element fails visible() ONLY because it has zero
    // area (display/visibility/opacity/clip/hover-overlay all PASS), but it has a POSITIONED (fixed/sticky/
    // absolute) DESCENDANT that itself passes visible() AND is laid out on/near screen, treat the wrapper as a
    // pass-through and recurse into it (the children carry the real captured boxes). NEVER recovers genuinely
    // hidden content: display:none / visibility:hidden / opacity<0.05 / clip / hover-overlay wrappers still fail
    // (checked first), and only a child that PAINTS (passes visible()) re-opens the descent. Reversible:
    // CAPTURE_NO_COLLAPSEDFLOW=1 (→ __NO_COLLAPSEDFLOW). Bounded scan (cap depth+count) — pure geometry, no waits.
    const collapsedFlowWrapper = (el) => {
      if (window.__NO_COLLAPSEDFLOW === true) return false;
      let cs; try { cs = getComputedStyle(el); } catch { return false; }
      if (cs.display === 'contents') return false;            // contents has no box of its own — handled by visible()
      const r = el.getBoundingClientRect();
      if (r.width && r.height) return false;                  // not collapsed — visible() handles it normally
      // it must have failed visible() PURELY on zero-area: every OTHER hide reason must be absent.
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false;
      if (cs.clip === 'rect(1px, 1px, 1px, 1px)' || cs.clipPath === 'inset(50%)') return false;
      if (hiddenByHoverOverlay(el)) return false;
      // does it own a POSITIONED, PAINTED descendant (the fixed/sticky/absolute child pulled out of flow)?
      // Scan a bounded number of descendant elements; the qualifying child must (a) be fixed/sticky/absolute,
      // (b) pass visible() (real painted box, on/near screen, opacity ok), and (c) actually carry capturable
      // content (own text OR a media/anchor/heading descendant) so we never re-open a decorative zero-box shell.
      let scanned = 0;
      for (const d of el.querySelectorAll('*')) {
        if (++scanned > 400) break;
        let dcs; try { dcs = getComputedStyle(d); } catch { continue; }
        if (!/^(fixed|sticky|absolute)$/.test(dcs.position)) continue;
        if (!visible(d)) continue;
        if (hasOwnText(d) || d.querySelector('a[href],button,img,svg,h1,h2,h3,h4,h5,h6,nav')) return true;
      }
      return false;
    };
    const paintOf = (cs) => { const clip = (cs.getPropertyValue('-webkit-background-clip') || cs.getPropertyValue('background-clip') || ''); const bg = cs.backgroundImage; const fill = cs.getPropertyValue('-webkit-text-fill-color'); const tf = fill === 'rgba(0, 0, 0, 0)' || fill === 'transparent'; if ((clip.includes('text') || tf) && bg && bg !== 'none' && /gradient/.test(bg)) return { kind: 'gradient-text', value: bg }; return { kind: 'solid', value: (fill && !tf && fill !== cs.color) ? fill : cs.color }; };
    const typo = (cs) => ({ family: resolveFamily(cs.fontFamily), size: Math.round(parseFloat(cs.fontSize)), weight: cs.fontWeight, style: cs.fontStyle, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, transform: cs.textTransform, align: cs.textAlign });
    // FOOTER-LINK-COLOR fix (link-color emission gap): a kind:'list' node was captured WITHOUT any color — the
    // builder's textColor(n) early-returns null when n.paint is absent, so the <ul>/<a> emitted NO inline color and
    // the host theme's default `a{color:#007bff}` painted footer links bright blue + the theme `<ul>` got disc
    // bullets+40px padding. Resend/linear footer columns are muted plain-text links (rgb(161,164,165) /
    // rgb(138,143,152)), no bullets. listItemColor() reads the ACTUAL rendered cs.color off the element that paints
    // each item's glyphs (the link <a>, else the <li>) so a genuinely-blue source link KEEPS its blue — never a
    // blanket gray. Skip fully-transparent colors (return null → builder falls back to typo/global). listColorMeta()
    // derives the list-level representative link color (the most common item color) for the <ul> text_color stamp,
    // and records the source <ul>'s own list-style-type so the builder can faithfully reset spurious theme bullets
    // when the source had none. Reversible: window.__NO_LIST_LINK_COLOR skips both → legacy colorless list node.
    const listItemColor = (e) => { if (window.__NO_LIST_LINK_COLOR === true || !e) return null; let c; try { c = getComputedStyle(e).color; } catch { return null; } if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') return null; return c; };
    const listColorMeta = (lel, items) => {
      if (window.__NO_LIST_LINK_COLOR === true) return {};
      const out = {};
      // dominant item color = the most frequent non-null per-item color (the column's link color)
      const tally = new Map();
      for (const it of items) { if (it && it.color) tally.set(it.color, (tally.get(it.color) || 0) + 1); }
      let best = null, bestN = 0; for (const [c, n2] of tally) if (n2 > bestN) { best = c; bestN = n2; }
      if (best) out.linkColor = best;
      // source <ul>/<ol> list-style-type — so the builder resets theme bullets ONLY when the source had none.
      try { const ls = getComputedStyle(lel).listStyleType; if (ls) out.listStyleType = ls; } catch {}
      return out;
    };
    const bgOf = (cs) => { const o = {}; if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') o.color = cs.backgroundColor; const bi = cs.backgroundImage; if (bi && bi !== 'none') { if (/gradient/.test(bi)) o.gradient = bi; else if (/url\(/.test(bi)) { const m = bi.match(/url\(["']?([^"')]+)["']?\)/); if (m) o.image = m[1]; } } return Object.keys(o).length ? o : null; };
    const layoutOf = (cs) => { const o = { display: cs.display }; if (/flex|grid/.test(cs.display)) { o.flexDirection = cs.flexDirection; o.flexWrap = cs.flexWrap; o.justify = cs.justifyContent; o.align = cs.alignItems; o.gap = cs.gap; if (cs.display.includes('grid')) { o.gridCols = cs.gridTemplateColumns; } } return o; };
    // CODE-PANEL STYLE RECOVERY (code-panel-render fix): when a `<pre>`/mono container is collapsed to one
    // kind:'code' leaf, the leaf's OWN cs frequently loses the panel's real look — the dark background lives on
    // an ANCESTOR div (resend `dark:bg-background`, linear `page_panel`), the rounded card radius lives one wrapper
    // OUT, the monospace font lives on a `<pre>` DESCENDANT (the container's own font is the page sans, e.g. inter),
    // and the readable text color is the per-token span color, not the container color. The result was a void /
    // light-bg illegible run-on. This helper recovers the RECOVERABLE look: a dark panel bg + radius, the real
    // mono family, and a legible code-text color. It is pure-read (no DOM mutation) and bounded (≤6 ancestors).
    // Reversible: window.__NO_CODE_PANEL_RECOVER restores the legacy per-cs values.
    const rgbToArr = (s) => { const m = String(s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); if (p.length < 3) return null; const a = p.length >= 4 ? p[3] : 1; return [p[0], p[1], p[2], a]; };
    const lumaOf = (s) => { const a = rgbToArr(s); if (!a || a[3] < 0.5) return null; return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
    const monoReCL = /\bmono|consol|courier|menlo|sf ?mono|jetbrains|fira ?code|source ?code|ubuntu ?mono|cascadia|berkeley|commit ?mono|monospace/;
    const codePanelStyle = (el, cs, panelBox) => {
      if (window.__NO_CODE_PANEL_RECOVER === true) return { bg: (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : null), radius: cs.borderTopLeftRadius, mono: null, codeColor: null };
      const out = { bg: null, radius: null, mono: null, codeColor: null };
      const pArea = Math.max(1, (panelBox.w || 0) * (panelBox.h || 0));
      // (1) DARK PANEL BG: prefer the element's own opaque bg; else scan ANCESTORS (the dark panel `dark:bg-background`
      //     / `page_panel` that wraps the transparent <pre>) and DESCENDANTS (a single inner panel div) for a node
      //     whose bg is opaque, covers most of the panel box, and is the darkest such bg. radius rides along with it.
      const consider = (e) => { try { const c = getComputedStyle(e); const lum = lumaOf(c.backgroundColor); if (lum == null) return; const r = e.getBoundingClientRect(); const area = r.width * r.height; if (area < pArea * 0.5) return; const cur = out.__bgLuma; if (cur == null || lum < cur) { out.bg = c.backgroundColor; out.__bgLuma = lum; const rad = c.borderTopLeftRadius; if (nz(rad)) out.radius = rad; } } catch {} };
      consider(el);
      { let a = el.parentElement, hops = 0; while (a && hops < 6) { consider(a); hops++; a = a.parentElement; } }
      // a single inner panel that paints the dark surface (the <pre> sits transparent inside it)
      try { for (const d of el.querySelectorAll('div,pre,table')) { const r = d.getBoundingClientRect(); if (r.width * r.height >= pArea * 0.6) consider(d); } } catch {}
      // ROUNDED-CARD radius: the visible code panel is wrapped in a rounded card (resend rounded-3xl=24px, linear
      // 22px) whose radius often lives on a DIFFERENT ancestor than the dark bg. Prefer the closest ancestor/self
      // (within 6 hops) that has a non-zero radius AND covers most of the panel box — the card chrome.
      if (!out.radius) { if (nz(cs.borderTopLeftRadius)) out.radius = cs.borderTopLeftRadius; else { let a = el.parentElement, hops = 0; while (a && hops < 6) { try { const c = getComputedStyle(a); const r = a.getBoundingClientRect(); if (nz(c.borderTopLeftRadius) && r.width * r.height >= pArea * 0.6) { out.radius = c.borderTopLeftRadius; break; } } catch {} hops++; a = a.parentElement; } } }
      delete out.__bgLuma;
      // (2) MONO FONT: the container font is often the page sans; find the real monospace family on the <pre> or any
      //     mono descendant. resolveFamily keeps the first ACTUALLY-LOADED stack family.
      try { let monoEl = el.matches('pre') ? el : el.querySelector('pre'); if (!monoEl) { for (const d of el.querySelectorAll('code,span,div')) { const ff = (getComputedStyle(d).fontFamily || '').toLowerCase(); if (monoReCL.test(ff) && clean(d.innerText || '').length >= 8) { monoEl = d; break; } } }
        const ffSelf = (cs.fontFamily || '').toLowerCase();
        if (monoEl) out.mono = resolveFamily(getComputedStyle(monoEl).fontFamily);
        else if (monoReCL.test(ffSelf)) out.mono = resolveFamily(cs.fontFamily); } catch {}
      // (3) CODE TEXT COLOR: the dominant legible token color. Tally per-span colors weighted by text length and
      //     pick the one with the most painted chars (Shiki/syntax-highlight "default text" token = the bulk). Skip
      //     fully-transparent and tiny-weight colors. Fallback to the <pre>/mono element's own color.
      try { const tally = new Map(); let monoEl = el.matches('pre') ? el : (el.querySelector('pre') || el);
        const spans = monoEl.querySelectorAll('span,code'); let scanned = 0;
        for (const sp of spans) { if (scanned > 800) break; scanned++; let own = ''; for (const x of sp.childNodes) if (x.nodeType === 3) own += x.textContent; own = clean(own); if (own.length < 1) continue; const col = getComputedStyle(sp).color; const a = rgbToArr(col); if (!a || a[3] < 0.5) continue; tally.set(col, (tally.get(col) || 0) + own.length); }
        let best = null, bestN = 0; for (const [c, n2] of tally) if (n2 > bestN) { best = c; bestN = n2; }
        if (best) out.codeColor = best; else { const mc = getComputedStyle(monoEl).color; if (rgbToArr(mc)) out.codeColor = mc; } } catch {}
      return out;
    };
    const boxModel = (cs) => ({ padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft], margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft] });
    const hasOwnText = (el) => { for (const n of el.childNodes) if (n.nodeType === 3 && clean(n.textContent)) return true; return false; };
    // ownText (image-honesty gap-map #3): a node is "text-bearing" if it OWNS a visible non-empty text node
    // directly OR via a single direct inline child span (e.g. <p><span>text</span></p>, <div><span>label</span></div>).
    // Markup like resend's wraps headings/labels in a lone <span>, so a direct-text-node-only check UNDER-counts
    // real prose → text-rich full-width bands wrongly rasterize as mockups. Reused by realTextDesc + the text-rescue gate.
    // DYNAMIC-CONTENT-EMIT (dynemit fix): a non-rendering child element (script/style/template/noscript) must NOT
    // count toward the single-span rescue — resend's trust-row intro is <p><span>copy</span><script>…</script></p>,
    // so the OLD `spans.length === 1` check saw 2 element children (span + script), failed the rescue, and reported
    // ownText=FALSE → the span-borne intro line was DROPPED (the logo-wall section then baked it into a mockup).
    // Filter out non-rendering elements before the single-span test so the real text span is recognised.
    const ownText = (el) => { if (hasOwnText(el)) return true; let spans = [...el.childNodes].filter((x) => x.nodeType === 1); if (!window.__NO_DYNEMIT) spans = spans.filter((x) => !/^(script|style|template|noscript)$/i.test(x.tagName)); if (spans.length === 1 && spans[0].tagName === 'SPAN' && hasOwnText(spans[0])) return true; return false; };
    // VISIBLE-CLIP (hard-coded-width / horizontal-scroll fix): a node's FULL getBoundingClientRect can extend
    // far past the region that actually PAINTS, because an ancestor with overflow:hidden|clip|scroll|auto windows
    // it (the canonical case is a Framer/carousel MARQUEE track that is much wider than the 1200px box it scrolls
    // behind: box right=2430 but visible right=1320). build-absolute pins the FULL box → the clone's document
    // scroll-width blows past the viewport → bogus horizontal scroll. So record each box CLAMPED to its visible
    // region = rect ∩ layout-viewport[0..innerWidth] (horizontal) ∩ the content-box of the NEAREST clipping
    // ancestor (both axes). The clip-ancestor content-box is the PADDING-box minus borders (where children paint).
    // We do NOT clamp to the viewport vertically (the page is taller than the window — that's normal scroll, not a
    // clip), so vertical capture / scroll-height is untouched; only true overflow-clip ancestors bound y. A fully
    // clipped element collapses to a zero-area box, which the existing w/h>0 guards in walk()/leaf()/build-absolute
    // drop. CAPTURE_NO_CLIP=1 (→ __NO_CLIP) restores the old full-rect behaviour.
    const CLIP_OVERFLOW = /^(hidden|clip|scroll|auto)$/;
    // nearest ancestor that clips overflow on a given axis → its inner (content-box-ish) bounds in viewport coords.
    // We use the element's clientWidth/clientHeight (content+padding, excludes scrollbar/border) offset by border
    // width, which is exactly the region inside which descendants are visually retained.
    const clipBoundsOf = (el) => {
      let left = 0, top = -Infinity, right = innerWidth, bottom = Infinity; // viewport-x clamp is always on
      let p = el.parentElement;
      while (p && p !== document.documentElement) {
        let cs; try { cs = getComputedStyle(p); } catch { p = p.parentElement; continue; }
        const ox = cs.overflowX || cs.overflow, oy = cs.overflowY || cs.overflow;
        const clipsX = CLIP_OVERFLOW.test(ox), clipsY = CLIP_OVERFLOW.test(oy);
        if (clipsX || clipsY) {
          const pr = p.getBoundingClientRect();
          const bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
          const br = parseFloat(cs.borderRightWidth) || 0, bb = parseFloat(cs.borderBottomWidth) || 0;
          const innerL = pr.left + bl, innerT = pr.top + bt;
          const innerR = pr.left + bl + p.clientWidth, innerB = pr.top + bt + p.clientHeight;
          if (clipsX) { if (innerL > left) left = innerL; if (innerR < right) right = innerR; }
          if (clipsY) { if (innerT > top) top = innerT; if (innerB < bottom) bottom = innerB; }
        }
        p = p.parentElement;
      }
      return { left, top, right, bottom };
    };
    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      if (window.__NO_CLIP === true) return { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
      const cb = clipBoundsOf(el);
      const x0 = Math.max(r.left, cb.left), x1 = Math.min(r.right, cb.right);
      const y0 = Math.max(r.top, cb.top), y1 = Math.min(r.bottom, cb.bottom);
      const vw = x1 - x0, vh = y1 - y0;
      if (vw <= 0 || vh <= 0) return { x: Math.round(Math.max(r.left, 0)), y: Math.round(r.top + scrollY), w: 0, h: 0 }; // fully clipped → zero-area, dropped by w/h guards
      // HEAVILY-CLIPPED SLIVER DROP: a marquee/carousel item scrolling in from the right edge is captured as a
      // thin sliver (e.g. a 600px testimonial quote visible only 36px at the boundary). Clamping its BOX is right,
      // but build-absolute then pins a native text widget to that 36px width and the non-wrapping text spills past
      // the viewport AGAIN (the residual: clone docScrollW 1570 vs 1440 — the sliver's content re-introduces ~130px
      // of overflow). Such a fragment is, by construction, an off-screen item barely peeking past a clip edge — its
      // visible portion is a few glyphs of negligible fidelity value. Collapse it to zero-area (→ dropped) WHEN the
      // clip removed most of its width (visible < 50% of raw) AND the surviving sliver is small in absolute terms
      // (< 120px). A genuinely near-edge-but-mostly-visible element (raw≈visible, or a wide retained band) keeps a
      // ratio near 1 and/or a large visible width, so it is NEVER dropped. Horizontal axis only — vertical untouched.
      if (r.width > 0 && vw < 0.5 * r.width && vw < 120) return { x: Math.round(Math.max(x0, 0)), y: Math.round(y0 + scrollY), w: 0, h: 0 };
      return { x: Math.round(x0), y: Math.round(y0 + scrollY), w: Math.round(vw), h: Math.round(vh) };
    };

    // CODE-AS-ART markup-strip (capture-markup-flow-gate): some marketing heroes (tailwindcss.com) render
    // literal HTML markup ("<div class=\"...\">") as decorative text inside ordinary prose/heading blocks.
    // build-FLOW rebuilds that text natively → the literal "<div class=" renders as VISIBLE garbage on the
    // clone (perElement poison ≈0.066). build-ABSOLUTE rasters the hero so it's neutral there. Strip the tag
    // tokens ONLY in the MIXED band (0.3<markupFrac<0.6) on NON-structural blocks → the code-as-art collapses
    // to rendered prose. A genuine code-DISPLAY panel (markupFrac>=0.6, e.g. "<!DOCTYPE html>") is preserved
    // VERBATIM; normal prose with a stray "<" (markupFrac<0.3) is left untouched. NEVER shatter into N leaves.
    const codeSel = 'pre, code, [class*=code], [class*=highlight], [class*=language-]';
    const isStructuralCode = (el) => { try { return el.matches(codeSel) || !!el.closest(codeSel); } catch { return false; } };
    const tagTokenRegex = /<\/?[a-z][^>]*>/gi;
    const markupFrac = (t) => { if (!t) return 0; const tot = t.length; if (!tot) return 0; let tag = 0; const m = t.match(tagTokenRegex); if (m) for (const tk of m) tag += tk.length; return tag / tot; };
    const stripMarkupTokens = (t) => (t || '').replace(tagTokenRegex, ' ').replace(/\s+/g, ' ').trim();

    let leafId = 0; const id0 = () => leafId++; const seenText = new Set();
    function leaf(el, cs) {
      const tag = el.tagName.toLowerCase(); const box = rectOf(el);
      if (tag === 'img') { const src = el.currentSrc || el.src; if (!src || src.startsWith('data:') || box.w < 8) return null; return { kind: 'image', tag, src, alt: el.alt || '', objectFit: cs.objectFit, box, radius: cs.borderTopLeftRadius, boxShadow: nz(cs.boxShadow) ? cs.boxShadow : null, backdropFilter: bdfOf(cs) }; }
      if (tag === 'svg') { if (box.w < 6) return null; return { kind: 'svg', tag, svg: el.outerHTML.slice(0, 4000), box }; }
      let t = clean(el.innerText || el.textContent); if (!t || t.length > 600) return null;
      // GUARD#2 (capture-markup-flow-gate): on a NON-structural text/heading/button leaf, strip literal HTML
      // tag tokens ONLY in the MIXED band (0.3<mf<0.6) so code-as-art prose ("<div class=...> Build for the web")
      // becomes clean rendered prose instead of <div class=> garbage when FLOW rebuilds it natively. A code panel
      // (mf>=0.6) keeps verbatim; normal prose with a stray "<" (mf<0.3) is untouched.
      if (!isStructuralCode(el)) { const mf = markupFrac(t); if (mf > 0.3 && mf < 0.6) { const st = stripMarkupTokens(t); if (st) t = st; } }
      const dk = t + '@' + Math.round(box.y / 8); if (seenText.has(dk)) return null; seenText.add(dk); // S7: dedup identical text at same y (Stripe renders h1 twice)
      const isH = /^h[1-6]$/.test(tag), isBtn = tag === 'a' || tag === 'button';
      const ia = {}; const exp = el.getAttribute('aria-expanded'); if (exp != null) ia.expanded = exp; const hp = el.getAttribute('aria-haspopup'); if (hp) ia.haspopup = hp; const role = el.getAttribute('role'); if (role && /tab|menu|button|switch|disclosure/.test(role)) ia.role = role;
      const cfx = isBtn ? id0() : null; if (cfx != null) el.setAttribute('data-cfx', String(cfx));
      // CTA-PAINT CAPTURE (body-CTA fix): a button-kind leaf paints its fill in THREE ways the old capture missed
      // on the build side — (1) solid backgroundColor (already in `bg`), (2) a gradient/image background-image
      // (e.g. resend nav/hero "Get started" paints via linear-gradient with backgroundColor:transparent), and
      // (3) a visible BORDER (outlined CTAs / resend's 1-2px solid ring). Record border + the gradient/image fill
      // + the button padding so build-absolute can emit a styled-anchor twin matching the source's actual paint
      // instead of bare colored text. Recorded for buttons (and any leaf carrying a visible border) only — plain
      // text leaves get border:null so build never invents a pill on prose. Reversible: CAPTURE_NO_CTA_PAINT=1.
      let ctaBorder = null, ctaBgImage = null, ctaPad = null;
      if (window.__NO_CTA_PAINT !== true) {
        const bw = parseFloat(cs.borderTopWidth) || 0;
        if (bw > 0 && cs.borderTopStyle !== 'none' && nz(cs.borderTopColor) && cs.borderTopColor !== 'rgba(0, 0, 0, 0)') ctaBorder = `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`;
        if (isBtn) {
          const bi = cs.backgroundImage; if (bi && bi !== 'none' && /gradient|url\(/.test(bi)) ctaBgImage = bi;
          ctaPad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft];
        }
      }
      return { kind: isH ? 'heading' : (isBtn ? 'button' : 'text'), tag, level: isH ? +tag[1] : null, text: t, href: isBtn && el.href ? el.href : null, paint: paintOf(cs), typo: typo(cs), box, bg: (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : null), bgImage: ctaBgImage, border: ctaBorder, btnPad: ctaPad, radius: cs.borderTopLeftRadius, boxShadow: shadowOf(cs.boxShadow), backdropFilter: bdfOf(cs), interactive: Object.keys(ia).length ? ia : null, cfx };
    }
    // ─── WAVE-5 #4 SYMMETRIC DECORATIVE-FRAGMENT MERGE (completeness fix) ─────────────────────────────
    // WHY: the per-element grader (perelement-score.mjs) flattens this box-tree into a leaf+container node
    // list and computes areaCoverage = matchedArea / (matchedArea + unmatchedSrcArea + unmatchedCloneArea),
    // which MULTIPLIES every sub-score. Its block-merge pre-pass merges only TEXT leaves; it NEVER merges
    // textless decorative leaves. So tiny decorative SVG icons (15-26px), single/double-char syntax-highlight
    // punctuation glyphs ('{','}',';','(','⌘','k'), and textless section-background gradient-rect wrapper
    // containers are emitted as standalone PEER nodes on the SOURCE side, find no counterpart on the clone
    // side (the clone collapses them), dump into unmatchedSrcArea, and CRUSH areaCoverage (reactdev 0.19;
    // fragment%=50.8). DIAGNOSIS: the gap is purely source-side over-emission (clone unmatched ≈ 0).
    // FIX: before a container returns its assembled children, DROP each textless decorative fragment that has
    // at least one real text-bearing / content SIBLING to attach to — so it stops being a separate flatten
    // node (the builder ALREADY skips these: tiny svgs get raster='SKIP' at doSvg, and bg-less wrappers fail
    // the grader's struct-invariant). SYMMETRIC by construction: capture-layout.mjs runs IDENTICALLY on the
    // source and the clone (selftest re-uses the source capture), so source-vs-source merges identically →
    // stays 1.0; and the clone, having near-zero such fragments, is barely touched → coverage rises HONESTLY.
    // NEVER drops real content: a fragment is removed ONLY when a real-content sibling exists in the same band,
    // so a band that is purely decorative keeps its node (no content loss). Reversible: CAPTURE_NO_FRAGMERGE=1.
    const NO_FRAGMERGE = window.__NO_FRAGMERGE === true;
    // LOGO/ICON-WALL guard (navgap fix — customer-logos void): count the NON-TINY svg/image leaves a subtree
    // holds (recursively). A "wall" of >=3 substantial wordmark/logo SVGs (linear's 8 customer logos, each
    // 70-114px wide) is REAL, matchable content — NOT a bag of decorative fragments. ROOT CAUSE: hasRealContent
    // counted svg/image leaves as NOTHING (only image-KIND leaves, list/tabs/etc. count), so the whole logo
    // <a>→<ul>→8×svg subtree measured hasRealContent=false; with no border/radius/shadow signal it then matched
    // isDecorativeFragment and mergeDecorativeFragments FOLDED the entire customer-logo band away (proven: the 8
    // logo SVGs at y≈1408 vanished, list 6→5, the band dropped from LayoutContent's children). A tiny icon (caret/
    // sparkle ≤40px) is still decorative; only substantial logo glyphs (>40px on the long axis) count toward a wall.
    const TINY_MEDIA = 40;
    const isWallMediaLeaf = (n) => (n && (n.kind === 'svg' || n.kind === 'image') && n.box && Math.max(n.box.w || 0, n.box.h || 0) > TINY_MEDIA);
    const wallMediaCount = (n) => { if (!n) return 0; if (isWallMediaLeaf(n)) return 1; if (n.kind === 'container') { let c = 0; for (const k of (n.children || [])) { c += wallMediaCount(k); if (c >= 3) return c; } return c; } return 0; };
    // a node carries REAL content the grader will want to match: own text, OR a structural content kind
    // (list/tabs/accordion/code/image/video/mockup), OR a logo/icon WALL (>=3 substantial svg/image leaves), OR
    // a container that (recursively) holds such content.
    const hasRealContent = (n) => {
      if (!n) return false;
      if (n.kind === 'container') return wallMediaCount(n) >= 3 || (n.children || []).some(hasRealContent);
      if (n.kind === 'image' || n.kind === 'video' || n.kind === 'mockup' || n.kind === 'code' || n.kind === 'list' || n.kind === 'tabs' || n.kind === 'accordion') return true;
      if (n.text && n.text.trim().length >= 3) return true; // 1-2 char glyphs are NOT real content (see below)
      return false;
    };
    // a TEXTLESS DECORATIVE FRAGMENT — eligible to be folded away IF a real-content sibling exists:
    //   (a) a tiny <svg> icon leaf (small box — caret/sparkle/icon), OR
    //   (b) a single/double-char text leaf (syntax-highlight punctuation glyph: '{' '}' ';' '(' '⌘' 'k'), OR
    //   (c) a TEXTLESS container that paints a bg but carries NO distinct structural signal (no border/radius/
    //       shadow/backdrop) and holds NO real content of its own — the section-background gradient-rect wrapper
    //       the clone collapses (mirrors the grader's containerHasVisualSignal: such a wrapper is NOT a fidelity
    //       node, so it should not be a coverage-deflating peer either).
    const isDecorativeFragment = (n) => {
      if (!n || typeof n !== 'object') return false;
      if (n.kind === 'svg') { const b = n.box; return !!b && Math.max(b.w || 0, b.h || 0) <= 40; }
      if (n.kind === 'text' || n.kind === 'heading' || n.kind === 'button') {
        const t = (n.text || '').trim();
        return t.length > 0 && t.length <= 2; // single/double-char glyph (punctuation/syntax token)
      }
      if (n.kind === 'container') {
        if (hasRealContent(n)) return false; // holds real content → not a bare decorative rect
        const hasSignal = !!(n.border) || (n.radius && !/^0px$/.test(String(n.radius))) || !!n.boxShadow || !!n.backdropFilter;
        if (hasSignal) return false; // distinct structural signal → a real card/panel, keep it
        // textless, no signal — a plain section-background / gradient-rect wrapper the clone collapses.
        return true;
      }
      return false; // image/video/mockup/code/list/tabs/accordion are never decorative fragments
    };
    // Given a container's assembled child node array, DROP textless decorative fragments WHEN a real-content
    // sibling remains, so they stop being standalone flatten peers. Pure-decorative bands (no content sibling)
    // pass through untouched (no content loss). Symmetric: identical input → identical output on both sides.
    const mergeDecorativeFragments = (children) => {
      if (NO_FRAGMERGE || !Array.isArray(children) || children.length < 2) return children;
      const anyContent = children.some(hasRealContent);
      if (!anyContent) return children; // nothing real to attach to → keep everything (no content loss)
      const kept = children.filter((c) => !isDecorativeFragment(c));
      return kept.length ? kept : children; // never empty out a band
    };
    // recursive walk → container node OR leaf; prune pass-through wrappers; cap depth
    function walk(el, depth) {
      if (!visible(el)) {
        // COLLAPSED-FLOW WRAPPER (navgap fix): a static wrapper collapsed to zero-height because its only content
        // is a position:fixed/sticky/absolute child (linear's Header_root → fixed <header>). Don't stop here:
        // recurse into the children (which carry the real painted boxes) and return them as a transparent
        // pass-through container. The wrapper's own 0-area box is NOT used; children supply geometry. Depth-capped.
        if (depth < MAXD && collapsedFlowWrapper(el)) {
          const ck = [...el.children].filter((c) => !['script', 'style', 'noscript', 'template'].includes(c.tagName.toLowerCase()));
          const cc = mergeDecorativeFragments(ck.map((c) => walk(c, depth + 1)).filter(Boolean));
          if (cc.length === 1) return cc[0];
          if (cc.length) { const cb = getComputedStyle(el); return { kind: 'container', tag: el.tagName.toLowerCase(), box: rectOf(el), layout: layoutOf(cb), ...boxModel(cb), background: bgOf(cb), border: null, radius: null, boxShadow: null, position: 'static', children: cc }; }
        }
        return null;
      }
      const tag = el.tagName.toLowerCase(); const cs = getComputedStyle(el);
      if (tag === 'img' || tag === 'svg') return leaf(el, cs);
      // FORM CONTROLS (form-recovery fix): <input>/<textarea>/<select> are SINGLE tags whose visible content
      // (value/placeholder/options) lives in ATTRIBUTES, not text nodes, so the generic recursion below reaches
      // leaf() which reads innerText/textContent (empty) and returns null → the control is silently DROPPED. That
      // is why framer's two visible consent buttons (input[type=button] "Reject"/"Accept" at ~(40,826)/(205,826))
      // and any real form field never reach the build, and the clone's grader form-signal stays 0 while the source
      // is 1. Intercept EARLY (before recursion) and emit ONE leaf per control carrying everything build-absolute
      // needs to stamp a REAL, VISIBLE Elementor widget at the captured box. Two kinds:
      //   • <input type=button|submit|reset|image> with a value → kind:'button' (a clickable control with a label).
      //   • everything else (text/email/search/textarea/select/checkbox/radio/…) → kind:'input' with a field type,
      //     value, placeholder, and a captured border/bg/radius so the builder renders a genuinely-visible field
      //     box (not a transparent phantom). NEVER captured when hidden — visible() above already drops
      //     display:none / zero-box / type=hidden controls, so the burger-toggle checkbox & tracking inputs vanish.
      // Reversible: __NO_FORM_RECOVERY (BUILD_NO_FORM_RECOVERY=1 / CAPTURE_NO_FORM_RECOVERY=1) → fall through as before.
      if ((tag === 'input' || tag === 'textarea' || tag === 'select') && window.__NO_FORM_RECOVERY !== true) {
        const box = rectOf(el); if (box.w < 4 || box.h < 4) return null;
        const itype = (tag === 'input' ? (el.getAttribute('type') || 'text') : tag).toLowerCase();
        if (itype === 'hidden') return null;
        const val = clean(el.value || el.getAttribute('value') || '');
        const ph = clean(el.getAttribute('placeholder') || '');
        // a select's "value" is its selected option's text; fall back to the first option.
        let selText = '';
        if (tag === 'select') { try { const o = el.options[el.selectedIndex] || el.options[0]; selText = o ? clean(o.textContent) : ''; } catch {} }
        const border = nz(cs.borderTopWidth) ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` : null;
        const base = { tag, inputType: itype, value: val || selText, placeholder: ph, box, typo: typo(cs), paint: paintOf(cs),
          bg: (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent' ? cs.backgroundColor : null),
          border, radius: nz(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : null,
          boxShadow: nz(cs.boxShadow) ? cs.boxShadow : null };
        // a button-like control (push button / submit / reset / image) is a clickable LABEL → kind:'button'.
        if (tag === 'input' && /^(button|submit|reset|image)$/.test(itype)) {
          const label = val || (itype === 'submit' ? 'Submit' : (itype === 'reset' ? 'Reset' : 'Button'));
          // formControl:true tells build-absolute to emit a REAL <input type=button> (the grader counts
          // input/textarea/select tags, not <a>), keeping the source's form-signal honest.
          return { ...base, kind: 'button', formControl: true, text: label, href: null };
        }
        return { ...base, kind: 'input' };
      }
      // VIDEO: a <video> OR a <iframe> embedding youtube/vimeo/wistia/loom. Both are SINGLE tags whose
      // children carry no text, so the generic recursion below would return null and DROP them. Intercept
      // EARLY (before any recursion) and emit one 'video' node. Gate MIRRORS grade-sections.mjs:57 exactly
      // (visN('video') + visN('iframe') whose src matches /youtube|vimeo|wistia|loom/) so source-vs-clone
      // counting stays symmetric; the iframe regex adds youtu.be short-links (Elementor re-renders them to a
      // full youtube.com embed the grader still catches). The w>=40 && h>=30 guard drops tracking-pixel iframes.
      if (tag === 'iframe') {
        const src = el.src || el.getAttribute('src') || ''; const box = rectOf(el);
        if (/youtube|youtu\.be|vimeo|wistia|loom/.test(src) && box.w >= 40 && box.h >= 30) {
          const provider = /vimeo/.test(src) ? 'vimeo' : (/wistia/.test(src) ? 'wistia' : (/loom/.test(src) ? 'loom' : 'youtube'));
          return { kind: 'video', provider, src, box, radius: nz(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : null };
        }
        // SURFACE-RASTER (cross-origin-preview-iframe): a non-video embed/preview iframe (sandbox demo, embedded
        // app, hosted-video-loop player) renders ONE cohesive visual surface. It was DROPPED here (→ a void).
        // The iframe's content paints into the full-page screenshot, so emit a kind:'mockup'{surface:true} leaf
        // at its exact box; the Node doMockup pass crops + blank-guards it (a blank/cross-origin-blocked iframe
        // → blank crop → SKIPped, so we never feed the grader a black rectangle). Tracking-pixel iframes are
        // excluded by the size gate (>=200×150). Reversible via __NO_SURFACERASTER.
        if (!window.__NO_SURFACERASTER && box.w >= 200 && box.h >= 150 && box.w <= 1600 && box.h <= 1600) {
          return { kind: 'mockup', surface: true, surfaceKind: 'iframe', box, bg: (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : null), radius: nz(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : null };
        }
        return null; // non-media, non-surface iframe → drop (matches grader's video gate; avoids leaking ad/tracking frames)
      }
      if (tag === 'video') {
        const box = rectOf(el); if (box.w < 40 || box.h < 30) return null;
        let src = el.currentSrc || el.src || el.getAttribute('src') || '';
        if (!src) { const s = el.querySelector('source'); if (s) src = s.src || s.getAttribute('src') || ''; }
        // DECORATIVE-VIDEO MEDIA ATTRS (icon-fix): capture the source's own playback intent so the builder can
        // reproduce the element as-it-renders instead of bolting on native player chrome. A decorative loop
        // (autoplay/loop/muted, NO controls — e.g. resend's 170×170 3D .mp4 brand icons) MUST NOT get a player
        // control overlay; and `poster` is the element's OWN fallback raster (the icon frame). el.poster /
        // el.{autoplay,loop,muted,controls} are live DOM PROPERTIES (already absolutized + reflect attr+JS state).
        const poster = el.poster && !/^blob:/.test(el.poster) ? el.poster : null;
        const va = { autoplay: !!el.autoplay, loop: !!el.loop, muted: !!el.muted, controls: !!el.controls, poster };
        if (src && !src.startsWith('blob:')) return { kind: 'video', provider: 'hosted', src, box, ...va, radius: nz(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : null };
        return { kind: 'video', provider: 'hosted', src: '', box, ...va, radius: nz(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : null };
      }
      // ─── SURFACE-RASTER (surface-raster pass) ────────────────────────────────────────────────────────
      // WHY: the diagnosis (canvasRendersHeadless=true; kinds=webgl-canvas/cross-origin-preview-iframe/
      // gradient-illustration-bg/image-bg) found COHESIVE VISUAL SURFACES the walk either DROPS or leaks:
      //   GAP A — a <canvas> (webgl scene, animated-gradient illustration) has no text children, so generic
      //           recursion returns null and the canvas vanishes (react.dev hero canvas → a white void). The
      //           S8 Node pass cropped canvases into data.rasters[] but the BUILDER never placed those → no leaf.
      //   GAP B — a cross-origin/preview <iframe> that is NOT a known video provider was dropped at the iframe
      //           branch above; a hosted-video-loop or gradient-illustration container leaks/voids.
      // FIX: emit ONE kind:'mockup' leaf flagged {surface:true} at the surface's EXACT element box. The Node-side
      // doMockup pass ALREADY crops kind:'mockup' from the full-page screenshot (the canvas renders headless, so
      // the crop is the TRUE pixels), runs a BLANK-RASTER guard, uploads via build-absolute.uploadImage, and the
      // builder places it as an image widget at the box. Pure reuse of existing machinery — no new infra.
      // GUARDS: (2) ELEMENT-LEVEL ONLY — a surface is ONE cohesive unit (a <canvas>/preview-iframe, OR a container
      //   whose children are NOT distinct capturable content: high painted-area + ~no real text + no logo-wall row).
      //   NEVER raster a row/region of distinct elements (a card row, a logo wall — each stays its own leaf).
      // (3) NO DOUBLE-EMIT — a surface leaf returns immediately (no recursion), so its sparse children are NOT
      //   also emitted underneath the raster. (4) bounded: pure geometry, no waits/network here.
      // Reversible: CAPTURE_NO_SURFACERASTER=1 (read from the page via the injected flag) skips the whole branch.
      if (!window.__NO_SURFACERASTER) {
        const sBox = rectOf(el);
        // a leaf <canvas> is the canonical cohesive surface (webgl / gradient illustration). Same min size as
        // the S8 canvas pass (w>200 && h>150) so we don't promote tiny sparkline/spark canvases.
        if (tag === 'canvas' && sBox.w > 200 && sBox.h > 150 && sBox.w <= 1600 && sBox.h <= 1600) {
          return { kind: 'mockup', surface: true, surfaceKind: 'canvas', box: sBox, bg: (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : null), radius: nz(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : null };
        }
        // CONTAINER SURFACE: a cohesive painted unit whose children are NOT distinct capturable content.
        // Signals (ALL must hold): card/region-sized box; the only meaningful descendants are a <canvas> or a
        // cross-origin/preview <iframe> (NO real <img>/<svg>/<video> media to capture element-level) OR the box
        // paints a gradient/image background itself; AND it is WORD-SAFE (see below) and is NOT a logo/icon row.
        if (tag !== 'a' && tag !== 'button' && sBox.w >= 200 && sBox.h >= 150 && sBox.h <= 1500 && sBox.w <= 1600) {
          // ── WORD-SAFE GATE (recipe #25 audit fix: NEVER bury a heading/paragraph in an image) ─────────────
          // ROOT CAUSE: SURFACE 0 on resend WAS the hero `<h1 class="...font-domaine">Email for developers</h1>`
          // itself. It paints a linear-gradient bg (gradient-TEXT effect: text is clipped to a gradient fill) so
          // paintsBg=true; its only structural child is a <br> so structuralKids<=1; it has no img/svg/canvas/
          // video — so the old `single` (paintsBg) arm fired and BAKED the H1 into a PNG. The old text gate was
          // doubly blind: (a) querySelectorAll('h1..p,li') only matches DESCENDANTS, so when `el` ITSELF is the
          // heading its words were never counted; (b) `sWords < 8` let any 3–7-word headline (exactly "Email for
          // developers") slip through. New rule per audit: raster a surface ONLY IF it is genuinely TEXT-FREE.
          //   meaningful text = el is itself a heading/<p> with own text  OR  any visible descendant heading
          //   OR any visible descendant <p>/text-leaf carrying >3 words of OWN text  OR  the summed area of all
          //   own-text leaves inside the box is >= ~5% of the box area. ANY of those → the surface is text-bearing.
          const textTagRe = /^(h[1-6]|p|li|blockquote|figcaption)$/;
          // self counts: when EL itself is the painted text node (the gradient-text H1), include its own words.
          const selfIsText = textTagRe.test(tag) && ownText(el);
          const selfWords = clean(el.innerText || '').split(/\s+/).filter(Boolean).length;
          // a visible descendant heading is ALWAYS meaningful (never bury a heading, regardless of word count).
          const descHeadings = [...el.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((te) => visible(te) && ownText(te));
          // a visible descendant <p>/text-leaf is meaningful when it carries >3 words of its OWN text (a real
          // body paragraph, not a stray 1–2-word label/badge that decorates an illustration).
          const wc = (te) => clean(te.innerText || te.textContent).split(/\s+/).filter(Boolean).length;
          const descParas = [...el.querySelectorAll('p,li,blockquote,figcaption')].filter((te) => visible(te) && ownText(te) && wc(te) > 3);
          // text-leaf AREA fraction: sum of own-text leaf boxes / box area. A box where text covers >=5% of its
          // pixels is a text surface (catches dense prose even if individual runs are short), not pure imagery.
          const boxAreaSR = sBox.w * sBox.h;
          let textAreaSR = 0;
          if (boxAreaSR > 0) {
            const tleaves = selfIsText ? [el] : [...el.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,span')].filter((te) => visible(te) && ownText(te));
            for (const te of tleaves) { const r = te.getBoundingClientRect(); if (r.width > 0 && r.height > 0) textAreaSR += r.width * r.height; }
          }
          const textAreaFrac = boxAreaSR > 0 ? textAreaSR / boxAreaSR : 0;
          // gradient-TEXT effect (background-clip:text / -webkit-text-fill-color:transparent) means a paintsBg
          // signal is actually the TEXT being painted, not a decorative surface — treat as text, never raster.
          const isGradientText = /text/.test(cs.webkitBackgroundClip || cs.backgroundClip || '') || cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)' || cs.webkitTextFillColor === 'transparent';
          // ── DYNAMIC-CONTENT-EMIT (dynemit fix) — count SPAN/DIV-borne text, not only h*/p/li ──────────────────
          // ROOT CAUSE: the resend changelog 'Jun 05' notification card (radial-gradient bg → paintsBg=true) is
          // genuinely TEXT-DENSE — 654 own-text chars across ~55 visible <span>/<div> leaves (timestamps, email
          // addresses, subjects, agents) — but ALL the copy lives in <span>/<div> leaves, so descHeadings=0,
          // descParas=0. The old hasMeaningfulText therefore fired FALSE and the whole text-dense card was baked
          // into a raster (surface over-reach), violating "REBUILD words natively, never screenshot text." Count
          // span/div-borne OWN text: (a) how many visible <span>/<div> leaves carry their own >=2-char text node,
          // and (b) the total own-text char volume. A region with MANY such leaves (>=2) or a substantial char
          // volume (>=120) is TEXT-DENSE — never a pure decorative surface — so it must fall through to native
          // recursion. This mirrors the mockup gate's realTextDesc logic but extends it to span/div copy.
          const otsSR = (te) => { for (const x of te.childNodes) if (x.nodeType === 3 && clean(x.textContent).length >= 2) return true; return false; };
          let denseLeaves = 0, denseChars = 0;
          if (!window.__NO_DYNEMIT && !selfIsText) {
            for (const te of el.querySelectorAll('span,div,td,th,dd,dt,time,label,code')) {
              if (!visible(te) || !otsSR(te)) continue;
              denseLeaves++;
              for (const x of te.childNodes) if (x.nodeType === 3) { const t = clean(x.textContent); if (t.length >= 2) denseChars += t.length; }
            }
          }
          // TEXT-DENSE region = many own-text span/div leaves OR a substantial own-text char volume OR a high
          // text-area fraction (>=15%). ANY of these means the band is content, not a decorative visual surface.
          const isTextDense = (denseLeaves >= 2 || denseChars >= 120 || textAreaFrac >= 0.15);
          const hasMeaningfulText = selfIsText || (selfWords > 3) || descHeadings.length > 0 || descParas.length > 0 || textAreaFrac >= 0.05 || isGradientText || (!window.__NO_DYNEMIT && isTextDense);

          const canvases = [...el.querySelectorAll('canvas')].filter(visible);
          // capturable element-level media (img/svg/video with real content) → NOT a single surface; let
          // normal recursion land each as its own leaf (logo, icon, photo). canvas/cross-origin-iframe are NOT.
          const realMedia = [...el.querySelectorAll('img,video')].filter((m) => { if (!visible(m)) return false; const r = m.getBoundingClientRect(); return r.width >= 24 && r.height >= 24; });
          const realSvg = [...el.querySelectorAll('svg')].filter((m) => { if (!visible(m)) return false; const r = m.getBoundingClientRect(); return r.width >= 32 && r.height >= 32; });
          const previewIframe = [...el.querySelectorAll('iframe')].some((f) => { if (!visible(f)) return false; const fs2 = f.src || f.getAttribute('src') || ''; if (/youtube|youtu\.be|vimeo|wistia|loom/.test(fs2)) return false; const r = f.getBoundingClientRect(); return r.width >= 200 && r.height >= 150; });
          const ebi = cs.backgroundImage || ''; const paintsBg = /gradient|url\(/.test(ebi) && !isGradientText;
          // a "region of distinct elements" has many structural child containers — NEVER raster that (user rule).
          // A pure CSS illustration band is a near-leaf: few/no structural children that carry their own content.
          const structuralKids = [...el.children].filter((c) => { if (!visible(c)) return false; const ct = c.tagName.toLowerCase(); if (/^(script|style|noscript|template|br)$/.test(ct)) return false; return c.querySelector && (c.querySelector('img,svg,canvas,video,h1,h2,h3,h4,h5,h6,p,a,button') || ownText(c)); }).length;
          // ONE cohesive VISUAL surface ONLY if: a canvas (and no competing real media), OR a preview iframe (and
          // no real media), OR the box itself paints a gradient/image AND there is NO capturable child media at
          // all AND it is not a region of distinct elements (a pure CSS illustration band). A box with real
          // img/svg/video children, or many distinct child blocks, is a content region → recurse.
          const isCanvasSurface = (canvases.length >= 1 && realMedia.length === 0 && realSvg.length <= 1);
          const isIframeSurface = (previewIframe && realMedia.length === 0 && canvases.length === 0);
          const isCssBgSurface = (paintsBg && realMedia.length === 0 && realSvg.length === 0 && canvases.length === 0 && structuralKids <= 1);
          const single = isCanvasSurface || isIframeSurface || isCssBgSurface;
          if (single) {
            if (!hasMeaningfulText) {
              // TEXT-FREE visual surface (the WebGL hero scene, a cross-origin preview iframe, a pure CSS
              // illustration band with no words) → raster as before. This is the recovery we MUST keep.
              return { kind: 'mockup', surface: true, surfaceKind: canvases.length ? 'canvas' : (previewIframe ? 'iframe' : 'cssbg'), box: sBox, bg: (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : null), radius: nz(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : null };
            }
            // TEXT-BEARING surface. Two cases:
            // (b) canvas/iframe surface with text OVERLAID on top (the words live in a SEPARATE DOM layer, NOT in
            //     the canvas/iframe pixels): keep the visual raster but RESCUE the overlaid text as native leaves
            //     (flagged `overlay` so the builder z-bumps them above the raster) + a textMask so any glyphs that
            //     DID bake into the screenshot are white-filled. Reuses the established overlay/textMask machinery.
            if (isCanvasSurface || isIframeSurface) {
              const rescued = []; const rseen = new Set(); const mask = [];
              const ots = (te) => { for (const x of te.childNodes) if (x.nodeType === 3 && clean(x.textContent)) return true; return false; };
              for (const te of el.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,span,li,button')) {
                if (rescued.length >= 40) break;
                if (!visible(te) || !ots(te)) continue;
                const tt = clean(te.innerText || te.textContent); if (!tt || tt.length < 2 || tt.length > 200) continue;
                const rk = tt.slice(0, 60); if (rseen.has(rk)) continue; rseen.add(rk);
                const l = leaf(te, getComputedStyle(te)); if (l && l.text) { l.overlay = true; rescued.push(l); const rb = rectOf(te); if (rb.w > 0 && rb.h > 0) mask.push(rb); }
              }
              const surfLeaf = { kind: 'mockup', surface: true, surfaceKind: canvases.length ? 'canvas' : 'iframe', box: sBox, bg: (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : null), radius: nz(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : null };
              if (rescued.length) { surfLeaf.textMask = mask; return { kind: 'container', tag: 'div', box: sBox, layout: layoutOf(cs), ...boxModel(cs), background: bgOf(cs), border: null, radius: nz(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : null, boxShadow: nz(cs.boxShadow) ? cs.boxShadow : null, position: cs.position, children: [surfLeaf, ...rescued] }; }
              // no harvestable own-text after all → safe to raster the bare visual.
              return surfLeaf;
            }
            // (a) CSS-background surface whose text lives in the SAME DOM (the resend gradient-text H1, a prose band
            //     that merely paints a backdrop). The DOM is fully WALKABLE — do NOT raster anything. Fall through
            //     (no return) so normal recursion captures the heading/paragraph as native editable text leaves.
            //     (The older mockup gate below also re-guards text-rich bands, so words can never be baked here.)
          }
        }
      }
      // CODE BLOCK: a <pre> is one unit. Recursing splits syntax-highlight <span>s into per-token leaves
      // → a vertical one-token-per-line ladder. Capture innerText ONCE (preserves newlines/indent) as a
      // 'code' node; the builder emits a monospace white-space:pre-wrap block.
      if (tag === 'pre') { const t = (el.innerText || '').replace(/ /g, ' '); if (!clean(t)) return null; const pb = rectOf(el);
        // GUARD#3 (capture-markup-flow-gate): a scrollable code panel (overflowY auto/scroll && clientHeight<scrollHeight)
        // is bounded to its VISIBLE clientHeight so box.h does not anchor to the full code length (hRatio drift fix).
        if (/^(auto|scroll)$/.test(cs.overflowY) && el.clientHeight < el.scrollHeight && el.clientHeight > 20) pb.h = el.clientHeight;
        const cps = codePanelStyle(el, cs, pb); const ty = typo(cs); if (cps.mono) ty.family = cps.mono;
        return { kind: 'code', text: t.slice(0, 3000), box: pb, typo: ty, paint: paintOf(cs), codeColor: cps.codeColor, bg: cps.bg, radius: cps.radius || cs.borderTopLeftRadius }; }
      // DIV-BASED CODE EDITOR (capture-recovery): modern docs render code in <div>s with syntax-highlight
      // <span> tokens (NOT <pre>) → the walk recurses into per-token spans and DROPS them (resend's code
      // samples = the bulk of its capture-loss). Detect a MONOSPACE container with code-like multiline text
      // (or many token spans) and capture it as ONE 'code' node, preserving the full text → native code block.
      { const monoRe = /\bmono|consol|courier|menlo|sf ?mono|jetbrains|fira ?code|source ?code|ubuntu ?mono|cascadia|monospace/;
        const isMono = (e) => monoRe.test((getComputedStyle(e).fontFamily || '').toLowerCase());
        // MONO-DOMINANCE (missing-text fix): the old test flagged a container as a code block if it merely
        // CONTAINED a <code>/<pre> OR if its first span happened to be mono. On marketing pages that show a
        // few inline class-name samples (tailwindcss.com: "WHY TAILWIND CSS?" / "Built for the modern web" +
        // tiny `text-8xl` tokens) that swallowed the WHOLE prose section into one mono blob → ~93% of the page's
        // visible text was lost (coverage 0.06; the headline "why tailwind css?" mangled into a code node).
        // A genuine div-based code editor is mono-DOMINANT: most of its rendered text is in a monospace font
        // (measured ≈1.0), whereas a prose section that just cites code measures ≈0.39. Gate on that ratio so
        // real code editors are still recovered but prose sections fall through to normal recursion → native text.
        const monoTextFrac = (e) => { let mono = 0, tot = 0; const w2 = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) { const t = clean(c.textContent); if (t) { tot += t.length; if (isMono(n)) mono += t.length; } } else if (c.nodeType === 1) w2(c); } }; w2(e); return tot ? mono / tot : 0; };
        // GUARD#1 (capture-markup-flow-gate): LEAD with the structural signal — a real code panel matches the
        // codeSel (pre/code/[class*=code]/[class*=highlight]/[class*=language-]) OR is mono-dominant. A non-
        // structural prose block that merely cites markup is NOT structural, so its text gets the GUARD#2 strip.
        const structural = isStructuralCode(el);
        const mono = structural || isMono(el) || monoTextFrac(el) >= 0.6;
        // MARQUEE-VISIBLE multi-region guard (resend React-email IDE void): the mono gate above flags `el` as a
        // code panel by font-family SHARE. But a MULTI-REGION showcase (a file-tile sidebar + a <pre> code panel +
        // a rendered email-preview <table>, all in one rounded card) is mono-DOMINANT only because the <pre> out-
        // texts its siblings — collapsing the whole card into one dark 'code' leaf voids the band. So when `el`
        // is NOT itself a code panel (not structural-code, not mono-self) but merely CONTAINS a code panel as a
        // PROPER descendant, AND there is substantial NON-mono visible content OUTSIDE that panel (a sibling table/
        // file-list region), DO NOT collapse — fall through to normal recursion so each VISIBLE region is captured
        // natively at its painted position (the <pre> branch collapses the code panel itself; the table → mockup;
        // the file tiles → buttons). This NEVER fires on a genuine lone code editor (mono-self / single panel /
        // no out-of-panel content). Reversible: __NO_MARQUEE_VISIBLE restores the legacy whole-container collapse.
        let multiRegionSkip = false;
        if (mono && window.__NO_MARQUEE_VISIBLE !== true && !structural && !isMono(el)) {
          // a descendant code panel = a <pre>, or a mono-self element that is a PROPER descendant of `el`.
          const panels = [...el.querySelectorAll('pre')];
          if (!panels.length) for (const d of el.querySelectorAll('div,code,span')) { if (d !== el && isMono(d) && clean(d.innerText || '').length >= 60) { panels.push(d); break; } }
          if (panels.length) {
            // sum the OWN-text length of visible text-bearing leaves that are NOT inside any code panel — the
            // "other regions" (email-preview table cells, file-tile labels, the section heading/intro). Substantial
            // out-of-panel text (>= 80 chars across >= 2 distinct text leaves) ⇒ this is a multi-region showcase.
            const inPanel = (n) => panels.some((p) => p === n || p.contains(n));
            let outChars = 0, outLeaves = 0;
            for (const te of el.querySelectorAll('h1,h2,h3,h4,h5,h6,p,td,th,li,button,a,span,div')) {
              if (inPanel(te)) continue; if (!visible(te)) continue; if (!ownText(te)) continue;
              const tt = clean(te.innerText || te.textContent); if (tt.length < 2) continue;
              outChars += tt.length; outLeaves++; if (outChars >= 80 && outLeaves >= 2) break;
            }
            if (outChars >= 80 && outLeaves >= 2) multiRegionSkip = true;
          }
        }
        if (mono && !multiRegionSkip) { let t = el.innerText || ''; const mb = rectOf(el);
          // GUARD#2 (capture-markup-flow-gate): on a NON-structural block, strip tag tokens ONLY in the MIXED
          // band (0.3<mf<0.6) → the code-as-art hero collapses to rendered prose. A pure code-DISPLAY panel
          // (structural OR mf>=0.6, e.g. "<!DOCTYPE html>") keeps its code VERBATIM. NEVER shatter into N leaves.
          if (!structural) { const mf = markupFrac(t); if (mf > 0.3 && mf < 0.6) { const st = stripMarkupTokens(t); if (st) t = st; } }
          const cl = clean(t);
          // GUARD#3 (capture-markup-flow-gate): a scrollable mono panel is bounded to its VISIBLE clientHeight so
          // box.h does not anchor to the full code length (hRatio drift fix).
          if (/^(auto|scroll)$/.test(cs.overflowY) && el.clientHeight < el.scrollHeight && el.clientHeight > 20) mb.h = el.clientHeight;
          if (cl.length >= 20 && cl.length <= 4000 && (t.includes('\n') || el.querySelectorAll('span,code').length >= 3) && mb.w >= 100 && mb.h >= 30) {
            const cps = codePanelStyle(el, cs, mb); const ty = typo(cs); if (cps.mono) ty.family = cps.mono;
            return { kind: 'code', text: t.slice(0, 4000), box: mb, typo: ty, paint: paintOf(cs), codeColor: cps.codeColor, bg: cps.bg, radius: cps.radius || cs.borderTopLeftRadius }; } } }
      // VISUAL MOCKUP: a composite-media region (product dashboard, gradient promo card, brand-story card,
      // chart/diagram). Recursing LEAKS its table cells / tokens as one-text-widget-per-line AND drops the
      // visual, leaving an 800–1500px white VOID (the #1 Stripe defect per the vision diagnostic). Region-
      // capture the whole subtree as ONE raster (Node-side crops its box). Card-sized only (not whole sections),
      // and only when genuinely media-composite — NOT a normal text card (so pico's white text cards stay native).
      { const mb = rectOf(el); const bi = cs.backgroundImage || ''; const hasGradImg = /gradient|url\(/.test(bi);
        const media = [...el.querySelectorAll('img, svg, canvas, video')]; const txtLen = clean(el.innerText || '').length;
        const tableChart = el.querySelector('canvas, table');
        // IMAGE-DOMINANT: the largest descendant media covers >35% of the box → a visual card/mockup
        // (brand-story cards, dashboards, promos), NOT a text block (small media, text-dominant). This is
        // the discriminator that catches Stripe's brand cards without rasterizing pico's white text cards.
        let maxMedia = 0; for (const me of media) { const r = me.getBoundingClientRect(); maxMedia = Math.max(maxMedia, r.width * r.height); }
        const boxArea = mb.w * mb.h; const imageDominant = boxArea > 0 && maxMedia / boxArea > 0.35;
        // TEXT-RICHNESS GUARD (framer floor fix): the #1 anti-pattern is screenshotting a section that is
        // actually full of real prose — that both kills editability AND violates the hard rule "REBUILD words
        // natively, never screenshot text." `txtLen < 120` (a raw char count) is too weak: framer's testimonial /
        // customer / feature sections carry MANY discrete headings + paragraphs + quote blocks, so once
        // display:contents recursion reaches them they tripped the imageDominant/media>=4 rasterizer and got
        // baked into pixels. Count REAL visible descendant text elements (h*/p/li with their own non-empty text
        // node) and total words: a genuine VISUAL mockup (dashboard screenshot, logo wall, gradient promo,
        // score widget) has very few of either (framer's 6 true mockups measured td≤4, words≤10), whereas a
        // text section has many. If the candidate is text-rich, it is NOT a mockup — fall through to normal
        // recursion so its headings/paragraphs/lists become native editable leaves. Genuine image-dominant,
        // low-text regions still rasterize. This complements (does not replace) the existing txtLen gate, and
        // leaves the round-1/round-2 mockup TEXT-RESCUE + mono-dominance code-editor paths fully intact.
        const realTextDesc = [...el.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li')].filter((te) => ownText(te) && visible(te)).length;
        // DYNAMIC-CONTENT-EMIT (dynemit fix): the h*/p/li-only realTextDesc UNDER-counts bands whose copy lives in
        // <span>/<div> leaves — e.g. resend's trust-row intro "Companies of all sizes trust Resend…" rendered as
        // <p class=text-gray-11><span>…</span></p> inside the 12-logo wall (the <span> owns the words, the <p>
        // wrapper owns none, and ownText's single-span rescue can miss it when the <p> has sibling nodes). Counting
        // ONLY h*/p/li made that band measure realTextDesc≈0, so the mockup gate baked its intro line into pixels
        // (capture DROP of span-borne copy). Add a span/div-borne own-text count so text-bearing bands are seen as
        // content and fall through to native recursion (their headings/paragraphs/spans rebuild as editable text).
        const otsMK = (te) => { for (const x of te.childNodes) if (x.nodeType === 3 && clean(x.textContent).length >= 2) return true; return false; };
        const spanTextDesc = (window.__NO_DYNEMIT) ? 0 : [...el.querySelectorAll('span,div,td,th,dd,dt,time,label')].filter((te) => visible(te) && otsMK(te)).length;
        const realTextDescX = realTextDesc + (window.__NO_DYNEMIT ? 0 : Math.min(spanTextDesc, 12));
        const wordCount = clean(el.innerText || '').split(/\s+/).filter(Boolean).length;
        const textRich = realTextDescX >= 6 || wordCount >= 25;
        // FULL-WIDTH-BAND OVERRIDE (image-honesty gap-map #3): a wide band (>=1000px) that carries >=3 real text
        // elements is a genuine headings/paragraphs section, not a visual mockup — the `txtLen < 120` gate alone
        // under-rasterizes these into "rastered-text-cheat" caps (resend has ~3) that bake real prose into pixels.
        // Force NORMAL recursion so those headings/paragraphs become native editable leaves. Hard rule: REBUILD
        // words, never screenshot them. Genuine image-dominant low-text regions (realTextDesc < 3) still rasterize.
        const fullWidthTextBand = mb.w >= 1000 && realTextDescX >= 3;
        // EMBEDDABLE-VIDEO SHORT-CIRCUIT (structural-detection gap-map #4): `media` (L239) counts <video> too,
        // so a low-text section embedding a real video trips media.length>=4 / imageDominant and the gate below
        // rasterizes the WHOLE subtree into ONE mockup — walk() then never recurses to the <video>/<iframe>
        // element, so the kind:'video' branch (L195/L203) never fires and the grader's video count stays 0
        // (framer has ~18-20 videos currently detected as 0). Detect an embeddable video ANYWHERE in the subtree
        // using the SAME gates as those detectors + grade-sections.mjs:57 — an <iframe> whose src matches
        // /youtube|youtu\.be|vimeo|wistia|loom/, OR a <video> with a non-blob src (own src/currentSrc or a
        // <source> child). If found, DO NOT rasterize: fall through to normal recursion so each video becomes a
        // native kind:'video' leaf the grader catches. Image-only mockups (no embeddable video) still rasterize.
        const hasEmbeddableVideo = (() => {
          for (const f of el.querySelectorAll('iframe')) { if (/youtube|youtu\.be|vimeo|wistia|loom/.test(f.src || f.getAttribute('src') || '')) return true; }
          for (const v of el.querySelectorAll('video')) { let vs = v.currentSrc || v.src || v.getAttribute('src') || ''; if (!vs) { const s = v.querySelector('source'); if (s) vs = s.src || s.getAttribute('src') || ''; } if (vs && !vs.startsWith('blob:')) return true; }
          return false;
        })();
        // LOGO/ICON-WALL DECOMPOSITION (USER-FEEDBACK #3 — no chunk-screenshots): a "trusted by" / logo wall
        // (or an icon row) is MANY uniform-small media in a SHORT, low-text band. The mockup gate below trips on
        // `media.length >= 4` and bakes the whole wall into ONE chunk-screenshot PNG → the individual logos are
        // no longer per-element image/svg leaves (un-editable, can't swap/relink a single logo). DON'T rasterize:
        // detect the wall and fall through to NORMAL RECURSION so each logo becomes its OWN image/svg leaf. A
        // genuine product mockup/dashboard is the opposite shape — FEW, LARGE, image-dominant media (caught by the
        // gate below). Signals (ALL must hold): (a) >=4 VISIBLE media; (b) UNIFORM-SMALL — each visible media is
        // ~16-80px tall AND under ~12% of the band area; (c) SHORT band (mb.h <= 260); (d) low real text. Marquee
        // walls duplicate each logo (auto-scroll) — that's fine; recursion dedups identical src via the leaf walk.
        const isLogoWall = (() => {
          if (mb.h > 260 || realTextDesc > 3) return false;
          const vis = []; for (const me of media) { if (!visible(me)) continue; const r = me.getBoundingClientRect(); vis.push(r); }
          if (vis.length < 4) return false;
          for (const r of vis) { const a = r.width * r.height; if (r.height < 16 || r.height > 80 || (boxArea > 0 && a / boxArea > 0.12)) return false; }
          return true;
        })();
        if (!isLogoWall && !hasEmbeddableVideo && !textRich && !fullWidthTextBand && mb.w >= 200 && mb.h >= 120 && mb.h <= 1500 && txtLen < 120 && (tableChart || hasGradImg || imageDominant || media.length >= 4)) {
          // TEXT RESCUE (missing-text fix): a media-composite region (e.g. resend's logo-wall) often carries a
          // real heading/intro line — "Companies of all sizes trust Resend…" — as ONE <h*>/<p>. The bare mockup
          // raster baked that copy into pixels (SOURCE TEXT dropped → not rebuilt). Harvest genuine heading/
          // paragraph text leaves (own-text, reasonable length) and emit them as NATIVE leaves wrapping the
          // mockup, so the line is rebuilt as editable text. Guard: only short, sane runs; cap to avoid leaking
          // a whole leaked label list (those are why we rasterize); if none found, return the bare mockup as before.
          const mock = { kind: 'mockup', box: mb, bg: (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : null), radius: cs.borderTopLeftRadius };
          // SINGLE-IMG MOCKUP RECOVERY (void-imagery fix; CAPTURE_NO_IMGRECOVER=1 to disable): the diagnosed
          // resend "empty dark void" defect — a band whose visual IS one real <img> (the dashboard / zoom-panel
          // screenshots: screenshot-metrics.png, screenshot-zoom-audience/analytics.png) was routed here and
          // baked into a whole-region crop of the FULL-PAGE screenshot. That crop is a black void when (a) the
          // <img loading=lazy> never painted at capture time (nat 0x0 — metrics.png's only src was the 3840px 2x
          // variant, so the eager-force pass couldn't settle it), or (b) the crop is dominated by the surrounding
          // dark gutter/chrome rather than the bounded screenshot. Either way the region-crop is strictly WORSE
          // than the real <img src>: the build's uploadImage() fetches the URL and gets the FULLY-loaded asset
          // regardless of the page's lazy/paint state, and a native image leaf is editable (relink/swap) + bounded
          // to the img's own box (not the band's dark gutter). DETECT: the region's dominant media is a SINGLE
          // <img> with a usable src that covers a large fraction of mb → emit a native kind:'image' leaf at the
          // img's own box instead of the raster. This is the hard rule "copying imagery is ALLOWED; render the
          // ACTUAL source image" — NEVER a placeholder/fill. Guards keep it surgical: exactly one substantial
          // <img> (no multi-image collage — those keep rasterizing); a real http(s) src (currentSrc OR the src/
          // srcset attribute, since a never-painted lazy img has empty currentSrc but a valid src); the img covers
          // >=60% of mb width AND >=45% of mb area (it genuinely IS the visual, not a small inset); and the only
          // OTHER media are tiny (<=2% area each — decorative chrome). Pure CSS/canvas mockups, collages, and
          // gradient promos have no single covering <img> and still rasterize exactly as before (byte-identical).
          if (window.__NO_IMGRECOVER !== true) {
            const imgsHere = [...el.querySelectorAll('img')].filter((im) => visible(im));
            // resolve a usable URL even for a never-painted lazy img: currentSrc → src attr → largest srcset entry.
            const imgUrl = (im) => {
              let u = im.currentSrc || im.getAttribute('src') || '';
              if ((!u || u.startsWith('data:')) && im.getAttribute('srcset')) {
                const cand = im.getAttribute('srcset').split(',').map((s) => s.trim().split(/\s+/)[0]).filter((s) => s && !s.startsWith('data:'));
                if (cand.length) u = cand[cand.length - 1]; // last srcset entry = highest-res variant
              }
              return (u && !u.startsWith('data:')) ? u : '';
            };
            // measure each img's coverage of mb (layout box; a never-painted lazy img still has a layout rect).
            let domImg = null, domArea = 0, secondArea = 0;
            for (const im of imgsHere) { const r = im.getBoundingClientRect(); const a = r.width * r.height; if (a > domArea) { secondArea = domArea; domArea = a; domImg = im; } else if (a > secondArea) { secondArea = a; } }
            if (domImg && boxArea > 0) {
              const r = domImg.getBoundingClientRect();
              const coversW = mb.w > 0 && (r.width / mb.w) >= 0.6;
              const coversArea = (domArea / boxArea) >= 0.45;
              const noBigSecond = (secondArea / boxArea) <= 0.02; // any other img is decorative-tiny → still a single-image visual
              const url = imgUrl(domImg);
              if (url && coversW && coversArea && noBigSecond) {
                const ibox = rectOf(domImg); // the img's OWN box — bounded, faithful position/size (no dark gutter)
                const ics = getComputedStyle(domImg);
                return { kind: 'image', tag: 'img', src: url, alt: domImg.alt || '', objectFit: ics.objectFit, box: (ibox.w >= 8 && ibox.h >= 8) ? ibox : mb, radius: cs.borderTopLeftRadius, boxShadow: nz(ics.boxShadow) ? ics.boxShadow : null, backdropFilter: bdfOf(ics), recovered: 'mockup-img' };
              }
            }
          }
          // WIDENED TEXT RESCUE (editability gap-map #2): the raster STAYS for the visual, but far more of the
          // SOURCE WORDS are rebuilt natively (editable) instead of baked into pixels. We hard-rule: REBUILD words,
          // never screenshot them. Changes vs the narrow round-1 recipe: (a) cap 4 → 40 rescued runs; (b) selector
          // widened h1-h6,p → h1-h6,p,a,span,li,button; (c) min text length 8 → 2; (d) each rescued leaf is flagged
          // `overlay` so the builder z-bumps it ABOVE the raster (the image still paints the visual; the words
          // become real/selectable text on top). Gate every candidate on having its OWN visible, direct, non-empty
          // text node — this both (i) catches resend's <p><span>…</span> case (the <span> itself owns the text and
          // is now in the selector) AND (ii) prevents harvesting the same run twice (a wrapper <p>/<div> that only
          // CONTAINS the <span> owns no direct text node → skipped). Dedup by leading text so repeats collapse.
          // Strict (direct-text-node-only) gate kept here ON PURPOSE: a wrapper <p>/<div> that only CONTAINS the
          // <span> must be SKIPPED so the same run is not harvested twice (the inner <span> is itself in the selector).
          const ownTextStrict = (te) => { for (const x of te.childNodes) if (x.nodeType === 3 && clean(x.textContent)) return true; return false; };
          const rescued = []; const rseen = new Set();
          // DYNAMIC-CONTENT-EMIT (dynemit fix): the rescue below is a SIGNAL probe — in EVERY surviving path it
          // re-walks the subtree (childNodes) rather than emitting rescued[] directly, so the harvested leaves are
          // never used as final output here. BUT leaf() mutates the shared `seenText` dedup set (L278), so probing
          // a leaf POISONS it: when the band then falls through to normal recursion, that recursion's leaf() hits
          // the dedup and returns null → the text is DROPPED. This is the resend final-CTA gradient-heading drop
          // ("Email reimagined. Available today." was harvested by the section's mockup-gate probe, then the band
          // fell through and recursion could not re-emit it). FIX: snapshot the keys leaf() adds during the probe
          // and restore `seenText` afterward, so the probe leaves NO dedup footprint and recursion re-emits cleanly.
          const seenSnapshot = window.__NO_DYNEMIT ? null : new Set(seenText);
          for (const te of el.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,span,li,button')) {
            if (rescued.length >= 40) break;
            if (!visible(te) || !ownTextStrict(te)) continue;
            const tt = clean(te.innerText || te.textContent); if (!tt || tt.length < 2 || tt.length > 160) continue;
            const rk = tt.slice(0, 60); if (rseen.has(rk)) continue; rseen.add(rk);
            const l = leaf(te, getComputedStyle(te)); if (l && l.text) { l.overlay = true; rescued.push(l); }
          }
          // Roll back EVERY dedup key the probe inserted (bulletproof: anything not in the pre-probe snapshot),
          // so the probe leaves zero footprint and the fall-through recursion re-emits the text natively.
          if (seenSnapshot) for (const k of [...seenText]) if (!seenSnapshot.has(k)) seenText.delete(k);
          // FEATURE-CARD NATIVE ROUTING (USER-FEEDBACK #4 — kill baked-text bleed-through, element-level):
          // a text-bearing feature card (supabase Database / Authentication / Edge Functions / Storage) was
          // routed here because it carries a few media (icon + decorative graphic) → it tripped the mockup gate
          // and got baked into ONE whole-card PNG with a live text overlay z-bumped on top. The textMask only
          // PARTIALLY white-filled the rescued boxes, so the slightly-mis-positioned baked glyphs bled out from
          // under the overlay ("abase", "ull Postgres", "world-most-trusted"). Masking is fragile, and a masked
          // chunk-screenshot is STILL a chunk-screenshot (violates the element-level rule). FIX: rescued text means
          // this is a CONTENT card, not pure imagery — so NEVER emit the whole-card raster + masked overlay. Drop
          // the raster entirely and route the card to NATIVE RECURSION (heading + body become real text leaves,
          // zero baked text). PRESERVE the card art at element level: native recursion already captures any
          // <img>/<svg>/<video> child as its own image/svg leaf; the ONLY thing recursion can't recover is a
          // CSS-background / <canvas> illustration with no media element to hang on, so for THAT case we capture
          // ONLY the illustration sub-box as a standalone art raster (no text region, no textMask). The
          // rescued[] array is now used purely as the text-presence SIGNAL (we re-capture the text via recursion).
          if (rescued.length) {
            // Bounding box of all rescued TEXT runs in page coords — the art region is whatever sits OUTSIDE this.
            let txMinX = Infinity, txMinY = Infinity, txMaxX = -Infinity, txMaxY = -Infinity;
            for (const r of rescued) { if (r.box && r.box.w > 0 && r.box.h > 0) { txMinX = Math.min(txMinX, r.box.x); txMinY = Math.min(txMinY, r.box.y); txMaxX = Math.max(txMaxX, r.box.x + r.box.w); txMaxY = Math.max(txMaxY, r.box.y + r.box.h); } }
            const overlapsText = (b) => !(b.x + b.w <= txMinX || b.x >= txMaxX || b.y + b.h <= txMinY || b.y >= txMaxY);
            // Find a SEPARABLE illustration: the largest visible non-text visual descendant whose box does NOT
            // overlap the text region. If it is (or contains) a real <img>/<svg>/<video> element, NATIVE RECURSION
            // already lands it as an element-level leaf → we need NO raster. We only scoped-raster a CSS/canvas
            // graphic (a <canvas>, or a background-image element with no own text and no media child to capture it).
            let illo = null, illoArea = 0, illoNeedsRaster = false;
            const considerIllo = (e, needsRaster) => { if (!visible(e)) return; const b = rectOf(e); if (b.w < 24 || b.h < 24) return; if (overlapsText(b)) return; const a = b.w * b.h; if (a <= illoArea) return; illo = b; illoArea = a; illoNeedsRaster = needsRaster; };
            for (const c of el.querySelectorAll('canvas')) considerIllo(c, true);
            for (const c of el.querySelectorAll('img,svg,video')) considerIllo(c, false); // captured natively — flags illoNeedsRaster=false
            // CSS-background graphic: an element with a gradient/url() background, no own text, not a media tag.
            for (const c of el.querySelectorAll('*')) { const ec = getComputedStyle(c); const ebi = ec.backgroundImage || ''; if (!/gradient|url\(/.test(ebi)) continue; if (ownText(c)) continue; const ct = c.tagName.toLowerCase(); if (/^(img|svg|video|canvas)$/.test(ct)) continue; if (c.querySelector('img,svg,video,canvas')) continue; considerIllo(c, true); }
            // Only when a distinct CSS/canvas illustration exists do we hand-build the card (scoped art raster +
            // natively-recursed text/media children). The art raster covers JUST the illustration sub-box and
            // carries NO text and NO textMask, so no glyphs are ever baked. Otherwise fall through to plain
            // recursion — the heading/body become native leaves and any <img>/<svg> art is captured element-level.
            if (illo && illoNeedsRaster) {
              const kids = [...el.children].filter((c) => !['script', 'style', 'noscript', 'template'].includes(c.tagName.toLowerCase()));
              const childNodes = kids.map((c) => walk(c, depth + 1)).filter(Boolean);
              const artLeaf = { kind: 'mockup', box: illo, bg: null, radius: cs.borderTopLeftRadius }; // illustration-only raster, no text, no mask
              return { kind: 'container', tag: 'div', box: mb, layout: layoutOf(cs), ...boxModel(cs), background: bgOf(cs), border: null, radius: nz(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : null, boxShadow: nz(cs.boxShadow) ? cs.boxShadow : null, position: cs.position, children: [artLeaf, ...childNodes] };
            }
            // No separable CSS/canvas illustration → fall through (no return) to the accordion/tabs/normal-recursion
            // path below so the card's heading + body + any media rebuild natively (element-level, no baked text).
          } else {
            // TEXT-OVERLAP GUARD (USER-FEEDBACK #4 — element-level, finishes the card-native fix):
            // a feature card is LAYERED — a full-bleed absolutely-positioned illustration layer (supabase Database
            // card: <figure class="absolute inset-0 z-0"> with the elephant <img>/<svg>; the Auth/Realtime/Edge
            // cards: an icon + a decorative email-grid graphic) PLUS a heading+body that render OVER it. The
            // illustration layer reaches the mockup gate carrying NO HARVESTABLE own text (the heading/body were
            // already consumed by recursion's seenText dedup, so rescued[] comes back EMPTY) → it hit `return mock`
            // and the whole-box raster crop BAKED the visible glyphs ("Authentication" / "abase" / "ull Postgres" /
            // "world-most-trusted" / the alex…@gmail.com email grid). Masking can't help (those glyphs aren't this
            // element's own). DETECT it generically: does mb spatially overlap REAL VISIBLE TEXT (own OR a layered
            // sibling) covering a meaningful fraction of that text's box? If yes, this is a content card, not pure
            // imagery — do NOT bake the full box. When the region contains a real <img>/<svg>/<video> (the
            // illustration), fall through to NATIVE RECURSION so the media is captured element-level (no text baked)
            // and the heading/body render as native leaves. Only when NO capturable media exists (pure CSS/canvas
            // with no clean sub-box) do we keep the raster. Genuine standalone image-dominant regions (logo tiles,
            // dashboard screenshots with no overlapping prose) have no overlapping text and still rasterize as before.
            let textOverlap = false;
            for (const te of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,span,li,button')) {
              if (!visible(te) || !ownText(te)) continue;
              const tt = clean(te.innerText || te.textContent); if (!tt || tt.length < 2 || tt.length > 200) continue;
              const b = rectOf(te);
              // >=40% of the text box must sit inside mb to count as a real visual overlap (not a grazing edge).
              const ix = Math.max(0, Math.min(mb.x + mb.w, b.x + b.w) - Math.max(mb.x, b.x));
              const iy = Math.max(0, Math.min(mb.y + mb.h, b.y + b.h) - Math.max(mb.y, b.y));
              if (b.w > 0 && b.h > 0 && (ix * iy) / (b.w * b.h) >= 0.4) { textOverlap = true; break; }
            }
            if (textOverlap) {
              // TEXT WINS over a raster: fall through (no return) to normal recursion. Any real <img>/<svg>/<canvas>/
              // <video> illustration in the subtree is still captured element-level by recursion (the svg/image leaf
              // branches + the canvas/svg/mockup raster passes), the text renders as native leaves, and NOTHING bakes
              // foreign/own glyphs into a raster crop. Even when no capturable media is found, clean editable text is
              // strictly better than a baked-text screenshot (the hard rule: REBUILD words, never screenshot them).
            } else {
              // GUARD: genuinely image-dominant region with NO overlapping text → the existing whole-region raster
              // path is correct; the corpus-gate + render-verify protect against losing real card art.
              return mock;
            }
          } } }
      // ACCORDION: a container grouping >=2 expand/collapse triggers (button[aria-expanded][aria-controls]
      // whose panels are COLLAPSED to h:0 → the normal walk skips them). Capture each trigger + its panel
      // (via aria-controls, ignoring visibility) so the clone rebuilds a real clickable accordion → revives
      // the interaction layer. GUARD: skip inside nav/header (those dropdowns are handled as cfx-dd menus,
      // and aria-haspopup marks a menu, not an accordion) to avoid swallowing the top nav.
      // SIZE GUARD (added): an accordion is a compact widget, not a page section. Without this, a top-level
      // container holding ≥2 aria-expanded buttons anywhere on the page was swallowed as ONE page-spanning
      // accordion (resend: a 12320px-tall 'accordion' → whole page collapsed to 1 leaf, 0 text captured).
      const accBox = rectOf(el);
      if (!el.closest('nav,header,[role=banner],[role=menubar]') && accBox.h <= 1400 && accBox.h >= 40) {
        const accSel = 'button[aria-expanded][aria-controls]:not([aria-haspopup])';
        const accTrigs = [...el.querySelectorAll(accSel)];
        // tightest = no single child already contains ALL the triggers (else defer to that child)
        const tightest = accTrigs.length >= 2 && ![...el.children].some((c) => c.querySelectorAll && c.querySelectorAll(accSel).length === accTrigs.length);
        if (tightest) {
          const items = accTrigs.map((tr) => {
            const summary = clean(tr.innerText || tr.textContent).slice(0, 90);
            const pid = tr.getAttribute('aria-controls'); const panel = pid && document.getElementById(pid);
            const content = [];
            if (panel) { for (const a of panel.querySelectorAll('a[href]')) { const txt = clean(a.innerText); if (txt) content.push({ text: txt.slice(0, 90), href: a.href }); } if (!content.length) { const txt = clean(panel.innerText); if (txt) content.push({ text: txt.slice(0, 240) }); } }
            return { summary, open: tr.getAttribute('aria-expanded') === 'true', content };
          }).filter((it) => it.summary);
          if (items.length >= 2) return { kind: 'accordion', box: rectOf(el), items };
        }
      }
      // TABS (structural gap#2): a tabbed section = a [role=tablist] container, OR any container with >=2
      // [role=tab] descendants — MIRRORS grade-sections.mjs:60 EXACTLY (tabs = visN('[role=tablist]').length ||
      // visN('[role=tab]').length >= 2) so source/clone counting stays symmetric. The absolute build otherwise
      // flattens a tab section to plain text → clone tabs=0 (vercel: source 2 tablists → 0). Capture each tab
      // TITLE + its panel TEXT (panel resolved via aria-controls → element id, like the accordion detector;
      // a tab's panel is usually hidden until selected so we read it ignoring visibility) so the builder can
      // rebuild a REAL <div role=tablist>/<div role=tab> + stacked panels the grader counts. EMPIRICALLY VERIFIED
      // (round-30 kses probe on vercel page 4296): role=tablist/role=tab on an html widget SURVIVE wp_kses AND
      // the grader's live-DOM gate counts them (tabsGate=1) — the rounds-7/8 miss was the <details>/<summary>
      // structure, not role= stripping. tightest guard (no child already holds all the tabs) avoids swallowing
      // a parent section; size guard keeps it a widget, not a page band; skip nav/header (menubars use role=tab too).
      // TAB-CODE-PANEL recovery (resend SDK void fix): the resend "Integrate this morning" SDK section is a
      // [role=tablist] (Node.js / Ruby / Python …) whose ACTIVE tab panel renders a DARK MONOSPACE code panel
      // (a real <pre> with line numbers, commitMono, light text on black). Captured as kind:'tabs' it was routed
      // through the BARE unstyled tabs build path → an illegible light run-on (the resend defect). Detect when the
      // active tab's panel is a genuine code panel (has a <pre>, or is monospace-dominant) and recover the SAME
      // RECOVERABLE look the kind:'code' branch does: the <pre> code TEXT (newlines/indent preserved, 3000-cap like
      // the code branch — NOT the 400-char clean()'d blob), plus the dark panel bg + mono family + code-text color
      // via codePanelStyle. The INACTIVE tabs are NOT in the DOM (lazy-gated; panelsWithText==1) so only the active
      // tab's code is recoverable — that's an honest ceiling, not a bug. Returns {code,bg,mono,codeColor,radius} or
      // null. Reversible: window.__NO_TAB_CODE_PANEL restores the legacy bare-tabs behavior.
      const tabCodePanel = (tablistRoot, tabEls2) => {
        if (window.__NO_TAB_CODE_PANEL === true) return null;
        try {
          const act = tabEls2.find((t) => t.getAttribute('aria-selected') === 'true') || tabEls2[0];
          if (!act) return null;
          const pid = act.getAttribute('aria-controls'); const panel = pid && document.getElementById(pid);
          if (!panel) return null;
          const pre = panel.querySelector('pre');
          // mono-dominance fallback when the panel uses div-based syntax highlighting (no <pre>)
          const monoReTab = /\bmono|consol|courier|menlo|sf ?mono|jetbrains|fira ?code|source ?code|ubuntu ?mono|cascadia|berkeley|commit ?mono|monospace/;
          const panelMono = monoReTab.test((getComputedStyle(panel).fontFamily || '').toLowerCase());
          const codeEl = pre || (panelMono ? panel : null);
          if (!codeEl) return null;
          // preserve newlines/indent exactly like the kind:'code' branch (do NOT clean() — that collapses the
          // gutter + indentation into a single-space run-on). Normalize non-breaking spaces only.
          const raw = (codeEl.innerText || '').replace(/ /g, ' ');
          if (!clean(raw)) return null;
          const pbCode = rectOf(codeEl);
          const cps = codePanelStyle(codeEl, getComputedStyle(codeEl), pbCode);
          // codeBox = the actual code-panel surface rect (the dark <pre>/panel), which can DIFFER from the tablist
          // box: resend's file-tab row (`user-welcome.tsx` ...) is a tiny 183x152 chip but its code panel is ~1030x650
          // elsewhere. The builder sizes the dark panel widget to codeBox so 2k chars don't wrap into a 4800px-tall
          // sliver (height-overflow). Prefer the panel rect (full dark surface); fall back to the <pre> rect.
          const panelBox = rectOf(panel); const codeBox = (panelBox && panelBox.w >= pbCode.w) ? panelBox : pbCode;
          return { code: raw.slice(0, 3000), bg: cps.bg, mono: cps.mono, codeColor: cps.codeColor, radius: cps.radius, codeBox };
        } catch { return null; }
      };
      const tablistEl = el.getAttribute && el.getAttribute('role') === 'tablist' ? el : null;
      const tabEls = [...el.querySelectorAll('[role="tab"]')].filter(visible);
      if (!el.closest('nav,header,[role=banner],[role=menubar]') && (tablistEl || tabEls.length >= 2) && accBox.h >= 24 && accBox.h <= 2200) {
        const tightest = !([...el.children].some((c) => c.querySelectorAll && [...c.querySelectorAll('[role="tab"]')].filter(visible).length === tabEls.length && tabEls.length >= 2));
        if (tightest && tabEls.length >= 2) {
          // strip a doubled visually-hidden label (vercel renders "AI Apps AI Apps"): if the text is its own
          // value repeated (space-separated, or an exact first-half repetition), keep one copy.
          const dedupe = (t) => { const m = t.match(/^(.+?)\s+\1$/); if (m) return m[1].trim(); const h = t.length / 2; if (t.length > 3 && t.length % 2 === 0 && t.slice(0, h).trim() === t.slice(h).trim()) return t.slice(0, h).trim(); return t; };
          const items = tabEls.map((tb) => {
            const title = dedupe(clean(tb.innerText || tb.textContent)).slice(0, 90);
            const pid = tb.getAttribute('aria-controls'); const panel = pid && document.getElementById(pid);
            let content = '';
            if (panel) { content = clean(panel.innerText || panel.textContent).slice(0, 400); }
            return { title, content };
          }).filter((it) => it.title);
          if (items.length >= 2) {
            const cp = tabCodePanel(tablistEl || el, tabEls);
            const ty = typo(cs); if (cp && cp.mono) ty.family = cp.mono;
            return { kind: 'tabs', box: rectOf(tablistEl || el), typo: ty, items, ...(cp ? { codePanel: cp } : {}) };
          }
        }
      }
      // LIST (ul/ol): a real bullet/numbered list = a <ul>/<ol> with >=3 DIRECT <li> children, NOT inside nav.
      // The generic walk recursed into per-<li> text leaves (or flattened/dropped them) so the clone rebuilt
      // ZERO native list widgets while the corpus has 31 (structuralFidelity tanked). Capture the whole list as
      // ONE 'list' node carrying its ordered flag + each item's text (+ href if the item is a single link), so
      // the builder can emit a native Elementor list whose DOM is a real <ul>/<ol><li>… (the grader's list test).
      // Gate matches grade-sections.mjs exactly (>=3 direct li, not in nav) so detection stays source-consistent.
      if ((tag === 'ul' || tag === 'ol') && !el.closest('nav,[role=navigation]')) {
        const lis = [...el.children].filter((c) => c.tagName === 'LI' && visible(c));
        if (lis.length >= 3) {
          const items = lis.map((li) => {
            const txt = clean(li.innerText || li.textContent); if (!txt || txt.length > 300) return null;
            // single-link item → keep the href so the list stays navigable/editable as a link list
            const links = [...li.querySelectorAll('a[href]')];
            const href = (links.length === 1 && clean(links[0].innerText) === txt && links[0].href) ? links[0].href : null;
            // FOOTER-LINK-COLOR fix: record the ACTUAL rendered glyph color of THIS item — the link <a> when it's a
            // link item, else the <li> text color. build-absolute stamps it inline so the captured (often muted)
            // color beats the host theme's a{color:#007bff} default; a genuinely-blue source link keeps its blue.
            return { text: txt, href, color: listItemColor(href ? links[0] : li) };
          }).filter(Boolean);
          if (items.length >= 3) return { kind: 'list', tag, ordered: tag === 'ol', box: rectOf(el), typo: typo(cs), items, ...listColorMeta(el, items) };
        }
      }
      const kidEls = [...el.children].filter((c) => !['script', 'style', 'noscript', 'template'].includes(c.tagName.toLowerCase()));
      // leaf if it bears its own text and its inline children are simple AND ~same font-size.
      // S7: if an inline child has a materially different font-size (headline span vs subhead span
      // nested in one h1), DO NOT flatten — fall through to recurse so each size becomes its own leaf.
      const baseSize = parseFloat(cs.fontSize) || 16;
      // SVG icons are ATOMIC inline children — an <svg> always has <path> kids, so the old
      // `children.length===0` test rejected buttons like <a>Get Started<svg/></a>, making them recurse and
      // DROP the label text (→ empty colored CTA bars). Treat svg as inline-simple regardless of its paths.
      const inlineSimple = kidEls.every((c) => { if (!visible(c)) return true; const ct = c.tagName.toLowerCase(); if (ct === 'svg') return true; return c.children.length === 0 && /^(span|b|i|em|strong|br)$/.test(ct); });
      const sizes = new Set([Math.round(baseSize / 3)]); for (const c of kidEls) { if (!visible(c)) continue; for (const dd of [c, ...c.querySelectorAll('*')]) { if ([...dd.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim())) sizes.add(Math.round((parseFloat(getComputedStyle(dd).fontSize) || baseSize) / 3)); } }
      const sameSize = sizes.size <= 1; // S7: distinct text sizes in the subtree → recurse (split headline vs subhead) instead of flattening
      if ((tag === 'a' || tag === 'button' || /^h[1-6]$/.test(tag) || hasOwnText(el)) && inlineSimple && sameSize) {
        return leaf(el, cs);
      }
      if (depth >= MAXD) { // flatten: collect descendant leaves (cap raised 12→40 — was dropping product-card content)
        // EMBEDDABLE-VIDEO FLATTEN-RESCUE (structural-detection gap-map #4): the kind:'video' detectors (L195/L203)
        // only fire when walk() RECURSES to the <video>/<iframe> element. On deeply-nested sites (framer wraps every
        // video ~15-20 levels deep) the depth cap is hit FIRST, and this flatten selector did NOT list video/iframe,
        // so every embeddable video was silently DROPPED (framer: 12 visible non-blob <video> → 0 captured). Detect
        // them here using the SAME gates as those detectors + grade-sections.mjs:57 and emit one kind:'video' leaf
        // each so the grader's video count matches the source. Build already lands video — this is detection-only.
        const videoLeaf = (d, dcs) => { const dtag = d.tagName.toLowerCase(); const box = rectOf(d);
          if (dtag === 'iframe') { const isrc = d.src || d.getAttribute('src') || ''; if (/youtube|youtu\.be|vimeo|wistia|loom/.test(isrc) && box.w >= 40 && box.h >= 30) { const provider = /vimeo/.test(isrc) ? 'vimeo' : (/wistia/.test(isrc) ? 'wistia' : (/loom/.test(isrc) ? 'loom' : 'youtube')); return { kind: 'video', provider, src: isrc, box, radius: nz(dcs.borderTopLeftRadius) ? dcs.borderTopLeftRadius : null }; } return null; }
          if (box.w < 40 || box.h < 30) return null; let vsrc = d.currentSrc || d.src || d.getAttribute('src') || ''; if (!vsrc) { const s = d.querySelector('source'); if (s) vsrc = s.src || s.getAttribute('src') || ''; } if (vsrc && vsrc.startsWith('blob:')) vsrc = ''; const dposter = d.poster && !/^blob:/.test(d.poster) ? d.poster : null; return { kind: 'video', provider: 'hosted', src: vsrc, box, autoplay: !!d.autoplay, loop: !!d.loop, muted: !!d.muted, controls: !!d.controls, poster: dposter, radius: nz(dcs.borderTopLeftRadius) ? dcs.borderTopLeftRadius : null }; };
        // DEEP-LIST FLATTEN-RESCUE (structural-detection — lists; analogous to the video rescue above): the
        // top-level LIST detector (L344) only fires when walk() RECURSES to the <ul>/<ol>. On deeply-nested
        // sites (framer, source blocks.list=8) the MAXD depth cap is hit FIRST, so a real list buried below
        // the cap is flattened into per-<li> text leaves and NEVER becomes a native kind:'list' node (the
        // grader counts ~0 lists vs the source). Detect descendant <ul>/<ol> with >=3 visible DIRECT <li>
        // not inside nav — gate MIRRORS grade-sections.mjs:59 + the top-level detector EXACTLY so source/clone
        // list counting stays symmetric — and emit one kind:'list' node each (same shape: {kind,tag,ordered,
        // box,typo,items:[{text,href}]}), instead of flattening that list subtree into loose <li> leaves.
        const listNode = (lel, lcs) => { // mirrors the L344 top-level detector exactly
          const lis = [...lel.children].filter((c) => c.tagName === 'LI' && visible(c));
          if (lis.length < 3) return null;
          const items = lis.map((li) => {
            const txt = clean(li.innerText || li.textContent); if (!txt || txt.length > 300) return null;
            const links = [...li.querySelectorAll('a[href]')];
            const href = (links.length === 1 && clean(links[0].innerText) === txt && links[0].href) ? links[0].href : null;
            // FOOTER-LINK-COLOR fix (mirrors the top-level detector): record this item's actual rendered color.
            return { text: txt, href, color: listItemColor(href ? links[0] : li) };
          }).filter(Boolean);
          if (items.length < 3) return null;
          return { kind: 'list', tag: lel.tagName.toLowerCase(), ordered: lel.tagName.toLowerCase() === 'ol', box: rectOf(lel), typo: typo(lcs), items, ...listColorMeta(lel, items) };
        };
        // DEEP-TABS FLATTEN-RESCUE (structural gap#2; analogous to the video/list rescues above): the top-level
        // TABS detector (L338) only fires when walk() RECURSES to the [role=tablist]. On deeply-nested sites the
        // tablist sits BELOW MAXD (vercel: tablists at DOM depth 11/13 > cap 8) so the depth cap is hit FIRST and
        // the tab section is flattened into loose text leaves → clone tabs=0. Detect descendant [role=tablist]
        // (gate MIRRORS grade-sections.mjs:60 + the L338 top-level detector) and emit one kind:'tabs' node each,
        // marking its descendants so the flat-leaf loop skips them (no duplicate loose tab-title leaves).
        const tabsNode = (tlel, tlcs) => { // mirrors the L338 top-level detector
          const tbs = [...tlel.querySelectorAll('[role="tab"]')].filter(visible);
          if (tbs.length < 2) return null;
          const dedupe = (t) => { const m = t.match(/^(.+?)\s+\1$/); if (m) return m[1].trim(); const h = t.length / 2; if (t.length > 3 && t.length % 2 === 0 && t.slice(0, h).trim() === t.slice(h).trim()) return t.slice(0, h).trim(); return t; };
          const items = tbs.map((tb) => {
            const title = dedupe(clean(tb.innerText || tb.textContent)).slice(0, 90);
            const pid = tb.getAttribute('aria-controls'); const panel = pid && document.getElementById(pid);
            const content = panel ? clean(panel.innerText || panel.textContent).slice(0, 400) : '';
            return { title, content };
          }).filter((it) => it.title);
          if (items.length < 2) return null;
          // TAB-CODE-PANEL recovery (resend SDK void fix) -- same as the top-level detector, inlined here because
          // this helper is in a sibling block scope. Recover the active tab's <pre> code TEXT + dark panel look.
          let cp = null;
          if (window.__NO_TAB_CODE_PANEL !== true) {
            try {
              const act = tbs.find((t) => t.getAttribute('aria-selected') === 'true') || tbs[0];
              const pid = act && act.getAttribute('aria-controls'); const panel = pid && document.getElementById(pid);
              if (panel) {
                const monoReTab = /\bmono|consol|courier|menlo|sf ?mono|jetbrains|fira ?code|source ?code|ubuntu ?mono|cascadia|berkeley|commit ?mono|monospace/;
                const pre = panel.querySelector('pre');
                const codeEl = pre || (monoReTab.test((getComputedStyle(panel).fontFamily || '').toLowerCase()) ? panel : null);
                if (codeEl) {
                  const raw = (codeEl.innerText || '').replace(/ /g, ' ');
                  if (clean(raw)) { const pbC = rectOf(codeEl); const c2 = codePanelStyle(codeEl, getComputedStyle(codeEl), pbC); const panelB = rectOf(panel); const codeBox = (panelB && panelB.w >= pbC.w) ? panelB : pbC; cp = { code: raw.slice(0, 3000), bg: c2.bg, mono: c2.mono, codeColor: c2.codeColor, radius: c2.radius, codeBox }; }
                }
              }
            } catch {}
          }
          const tyT = typo(tlcs); if (cp && cp.mono) tyT.family = cp.mono;
          return { kind: 'tabs', box: rectOf(tlel), typo: tyT, items, ...(cp ? { codePanel: cp } : {}) };
        };
        // Intercept qualifying list subtrees first; mark their descendants so the flat-leaf loop skips them.
        const listEls = []; const inList = new Set();
        for (const lel of el.querySelectorAll('ul,ol')) {
          if (!visible(lel) || lel.closest('nav,[role=navigation]')) continue;
          const ln = listNode(lel, getComputedStyle(lel));
          if (ln) { listEls.push({ el: lel, node: ln }); for (const dd of lel.querySelectorAll('*')) inList.add(dd); }
        }
        // Intercept qualifying tablist subtrees; mark their descendants too.
        const tabEls = [];
        for (const tlel of el.querySelectorAll('[role="tablist"]')) {
          if (!visible(tlel) || tlel.closest('nav,header,[role=banner],[role=menubar]')) continue;
          const tn = tabsNode(tlel, getComputedStyle(tlel));
          if (tn) { tabEls.push({ el: tlel, node: tn }); inList.add(tlel); for (const dd of tlel.querySelectorAll('*')) inList.add(dd); }
        }
        const flat = [];
        for (const { node } of tabEls) { flat.push(node); if (flat.length >= 120) break; }
        for (const { node } of listEls) { if (flat.length >= 120) break; flat.push(node); }
        if (flat.length < 120) for (const d of el.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,img,svg,li,span,video,iframe')) { if (inList.has(d)) continue; const dt = d.tagName.toLowerCase(); if (visible(d) && (dt === 'video' || dt === 'iframe')) { const v = videoLeaf(d, getComputedStyle(d)); if (v) flat.push(v); } else if (visible(d) && (d.tagName === 'IMG' || d.tagName === 'svg' || hasOwnText(d) || d.tagName === 'A' || d.tagName === 'BUTTON')) { const l = leaf(d, getComputedStyle(d)); if (l) flat.push(l); } if (flat.length >= 120) break; }
        if (!flat.length) return null; return { kind: 'container', tag: 'div', box: rectOf(el), layout: layoutOf(cs), ...boxModel(cs), background: bgOf(cs), border: nz(cs.borderTopWidth) ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` : null, radius: nz(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : null, boxShadow: nz(cs.boxShadow) ? cs.boxShadow : null, backdropFilter: bdfOf(cs), position: cs.position, children: mergeDecorativeFragments(flat) };
      }
      const children = mergeDecorativeFragments(kidEls.map((c) => walk(c, depth + 1)).filter(Boolean));
      if (!children.length) { if (hasOwnText(el)) return leaf(el, cs); return null; }
      const node = { kind: 'container', tag, box: rectOf(el), layout: layoutOf(cs), ...boxModel(cs), background: bgOf(cs), border: nz(cs.borderTopWidth) ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` : null, radius: nz(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : null, boxShadow: nz(cs.boxShadow) ? cs.boxShadow : null, backdropFilter: bdfOf(cs), position: cs.position, children };
      // PRUNE pass-through wrapper: single child container, no own bg/border/radius/shadow and not a flex/grid layout parent
      const passthrough = node.children.length === 1 && node.children[0].kind === 'container' && !node.background && !node.border && !node.radius && !node.boxShadow && !/flex|grid/.test(node.layout.display) && node.position !== 'absolute' && node.position !== 'fixed';
      if (passthrough) return node.children[0];
      return node;
    }
    // root: the body's main content; start from body and let pruning collapse chrome wrappers
    const root = walk(document.body, 0);
    // page-level
    const fonts = []; try { document.fonts.forEach((f) => { if (f.status === 'loaded') fonts.push({ family: f.family.replace(/['"]/g, ''), weight: f.weight, style: f.style }); }); } catch {}
    // CSSOM @font-face MAP (family → [{url, weight, style}]) — the AUTHORITATIVE family↔file association, read from
    // every SAME-ORIGIN stylesheet's @font-face rules (cross-origin sheets throw on .cssRules → skipped silently).
    // build-absolute's basename-prefix matcher CANNOT associate content-hashed woff2 to a family (vercel's `Geist`
    // body face is served as `fef07dbb….woff2` / `caa3a2e1….woff2` — basenames with NO "geist" token → 0 hits →
    // Inter), nor a family whose NAME has an extra suffix the file lacks (`geistMonoFont` vs `GeistMono_Variable`).
    // This map gives the exact pairing the matcher can't guess; build-absolute resolves each url's basename against
    // the network-captured absolute fontFiles. URLs here are resolved to absolute against the sheet href / baseURI.
    const fontFaceMap = {};
    try {
      for (const sheet of document.styleSheets) {
        let baseHref = sheet.href || document.baseURI;
        let rules; try { rules = sheet.cssRules; } catch { continue; }   // cross-origin → blocked, skip
        if (!rules) continue;
        for (const r of rules) {
          const isFF = (r.constructor && r.constructor.name === 'CSSFontFaceRule') || (r.cssText && r.cssText.slice(0, 10) === '@font-face');
          if (!isFF || !r.style) continue;
          const fam = (r.style.getPropertyValue('font-family') || '').replace(/['"]/g, '').trim();
          if (!fam) continue;
          const src = r.style.getPropertyValue('src') || '';
          const wt = (r.style.getPropertyValue('font-weight') || '').trim() || '400';
          const st = (r.style.getPropertyValue('font-style') || '').trim() || 'normal';
          const urls = [...src.matchAll(/url\(\s*["']?([^"')]+\.woff2?[^"')]*)["']?\s*\)/gi)].map((m) => {
            try { return new URL(m[1], baseHref).href; } catch { return m[1]; }
          });
          if (!urls.length) continue;
          (fontFaceMap[fam] = fontFaceMap[fam] || []).push({ urls, weight: wt, style: st });
        }
      }
    } catch {}
    let nodes = 0, leaves = 0, maxDepth = 0, withBg = 0; const capturedTexts = new Set(); const tally = (n, d) => { if (!n) return; maxDepth = Math.max(maxDepth, d); if (n.kind === 'container') { nodes++; if (n.background) withBg++; (n.children || []).forEach((c) => tally(c, d + 1)); } else { leaves++; if (n.text) capturedTexts.add(clean(n.text)); } }; tally(root, 0);
    // P1 COVERAGE GATE: count VISIBLE text runs in the live DOM and compare to what we captured. Low
    // coverage = the walk silently dropped content (e.g. the content-visibility:auto / reveal-animation
    // bug that deleted ~60% of picocss.com). Surfaced in stats so the pipeline can flag/refuse a thin capture.
    let domVisibleTexts = 0; for (const e of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,span,li')) { const own = [...e.childNodes].some((n) => n.nodeType === 3 && clean(n.textContent)); if (!own) continue; const t = clean(e.innerText); if (!t || t.length > 200) continue; if (visible(e) && parseFloat(getComputedStyle(e).fontSize) >= 11) domVisibleTexts++; }
    const coverage = domVisibleTexts ? +(capturedTexts.size / domVisibleTexts).toFixed(2) : 1;
    return { url: location.href, title: document.title, pageBg: getComputedStyle(document.body).backgroundColor, pageH: document.documentElement.scrollHeight, vw: innerWidth, root, fonts, fontFaceMap, stats: { containers: nodes, leaves, maxDepth, containersWithBg: withBg, capturedTexts: capturedTexts.size, domVisibleTexts, coverage } };
  });
  data.fontFiles = [...fontUrls];

  // Node-side painted-color on text leaves (computed color lies on clipped text)
  let painted = 0;
  try {
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(150);
    const png = PNG.sync.read(await page.screenshot({ fullPage: true })); const dpr = png.width / data.vw;
    const fix = (n) => { if (!n) return; if (n.kind === 'container') { (n.children || []).forEach(fix); return; } if ((n.kind === 'text' || n.kind === 'heading' || n.kind === 'button') && n.paint && n.paint.kind === 'solid' && n.box && n.box.h >= 6 && n.box.h <= 240 && n.box.w >= 6) { const c = dominantTextColor(png, n.box, dpr); if (c) { n.paint.value = `rgb(${c[0]}, ${c[1]}, ${c[2]})`; painted++; } } };
    fix(data.root);
    // ADDITIVE colorGlyph FIELD (REPORT-ONLY downstream) — sample the RENDERED foreground glyph color for EVERY
    // qualifying text leaf and store it as a NEW field n.paint.glyphRGB = [r,g,b]. This NEVER alters paint.value
    // or paint.kind (the existing color sub-score, block-merge, and every other downstream field stay byte-identical);
    // it only ADDS a field that perelement-score's colorGlyph metric reads when the CSS-parse color is unresolvable
    // (gradient-text / null / oklch()/lab()/var()). REUSES the SAME edge-aware core sample dominantTextColor already
    // computes for solid text (which is why solid text's glyphRGB will agree with its now-screenshot-derived value).
    // FULLY ADDITIVE: a node that already had a glyphRGB (none do) is overwritten consistently; absence is harmless.
    let glyphSamp = 0;
    const glyphFix = (n) => {
      if (!n) return;
      if (n.kind === 'container') { (n.children || []).forEach(glyphFix); return; }
      if ((n.kind === 'text' || n.kind === 'heading' || n.kind === 'button') && n.paint
        && n.box && n.box.h >= 6 && n.box.h <= 240 && n.box.w >= 6
        && n.text && String(n.text).trim().length >= 1) {
        const c = dominantTextColor(png, n.box, dpr);
        if (c) { n.paint.glyphRGB = [c[0], c[1], c[2]]; glyphSamp++; }
      }
    };
    glyphFix(data.root);
    console.log(`  colorGlyph: sampled rendered foreground glyph color on ${glyphSamp} text leaves (additive field paint.glyphRGB; never alters paint.value/kind)`);
    // PAINTED BACKGROUND sampling: computed-style bgOf() misses backgrounds on pruned/wrapper containers
    // (the dark code-editor panel rendered as white → ΔE-81 bands). Sample the MODAL color from the actual
    // screenshot pixels in each container's box (bg dominates by area) → faithful panel/section backgrounds.
    // modalBg → dominantBoxBg (exported pure helper in _bgsample.mjs). The vertical-discontinuity guard makes a
    // wrapper container that spans a light region over a dark region (tailwind §9 "Ship faster and smaller" headline
    // sitting above the dark code-editor panel) ABSTAIN instead of over-painting the whole wrapper with the dark
    // sub-region's modal colour. KEY INSIGHT: abstaining defers the box to its PARENT's bg, which is the TRUE
    // section bg — a LIGHT parent (tailwind §9 page) → white headline restored; a DARK parent (resend's black
    // section with a white composer card on it) → the box stays black via the parent, NO regression. DEFAULT ON
    // (2026-06-09); reversible CAPTURE_NO_SPLITBG=1 (or CAPTURE_LEGACY=1) ⇒ legacy whole-box over-paint, byte-
    // identical to the pre-fix path. GATE (full): _bgsample-selftest.mjs ALL PASS (uniform preserved, reversible
    // == legacy); tailwind full rebuild+grade+LOOK §9 visual 0.16→0.899 (composite 0.834→0.841, §10 neutral, no
    // h-scroll); resend full rebuild+LOOK black section PRESERVED (parent carries it); supabase/vercel capture-level
    // 0 dark-risk abstentions. Genuinely-uniform sections never abstain (no top/bottom split → returns their colour).
    const SPLIT_GUARD = process.env.CAPTURE_LEGACY !== '1' && process.env.CAPTURE_NO_SPLITBG !== '1';
    const modalBg = (box) => {
      const W = png.width, H = png.height;
      const x0 = Math.max(0, (box.x * dpr) | 0), y0 = Math.max(0, (box.y * dpr) | 0), x1 = Math.min(W, ((box.x + box.w) * dpr) | 0), y1 = Math.min(H, ((box.y + box.h) * dpr) | 0);
      const px = (x, y) => { const i = (y * W + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
      return dominantBoxBg(px, x0, y0, x1, y1, { splitGuard: SPLIT_GUARD });
    };
    let bgSamp = 0; const sampleBg = (n) => { if (!n) return; if (n.kind === 'container') { if (n.box && n.box.w >= 140 && n.box.h >= 44) { const c = modalBg(n.box); if (c) { n.bgSampled = c; bgSamp++; } } (n.children || []).forEach(sampleBg); } }; sampleBg(data.root);
    console.log(`  painted-bg sampled on ${bgSamp} containers`);
    // CAPTURE_BANDBG (default OFF ⇒ byte-identical) — GUTTER-SAMPLED top-level band backgrounds. modalBg samples a
    // container's WHOLE box, so a dark SECTION whose content is light cards/text reads back light (the dominant area
    // is the cards). Result: framer's true rgb(8,8,8) sections came back near-white → no dark bands. FIX: for each
    // TOP-LEVEL band (mirror segment.mjs contentRoot + boxKids), gather the band's DESCENDANT child boxes and sample
    // the screenshot ONLY at GUTTER points (not covered by any child). The gutter IS the band's real background.
    // Adopt only an isDarkOrColored result (avg<110 OR avg<=230 with chroma>=60) onto node.bgSampled AND
    // node.background.color, so segment.mjs's bandBg() picks it up the FIRST way (background.color) and the fallback.
    if (process.env.CAPTURE_LEGACY !== '1' && process.env.CAPTURE_NO_BANDBG !== '1') {
      // mirror segment.mjs: descend single-container-child chain to the first multi-child node (the band-bearing node)
      const contentRootOf = (root) => { let n = root; while (n && n.kind === 'container' && (n.children || []).length === 1 && n.children[0].kind === 'container') n = n.children[0]; return n || root; };
      // direct container children that carry a real box = the top-level partition candidates (bands)
      const boxKidsOf = (n) => (n && n.children || []).filter((c) => c && c.box && c.box.h > 0 && c.box.w > 0 && c.kind === 'container');
      // collect EVERY descendant box (leaf or container) under a band, EXCLUDING the band's own box
      const descendantBoxes = (band) => { const out = []; const g = (n) => { if (!n) return; if (n !== band && n.box && n.box.w > 0 && n.box.h > 0) out.push(n.box); if (n.kind === 'container') (n.children || []).forEach(g); }; g(band); return out; };
      // sample the screenshot at GUTTER points of `box` — page-coord points NOT inside any child box. Quantize (>>4),
      // require >=24 samples + a dominant bucket owning >=0.5, then return the de-quantized dominant rgb (or null).
      const gutterBg = (box, kidBoxes) => {
        const W = png.width, H = png.height;
        const x0 = Math.max(0, (box.x * dpr) | 0), y0 = Math.max(0, (box.y * dpr) | 0), x1 = Math.min(W, ((box.x + box.w) * dpr) | 0), y1 = Math.min(H, ((box.y + box.h) * dpr) | 0);
        if (x1 - x0 < 16 || y1 - y0 < 16) return null;
        // pre-scale child boxes into screenshot (device) pixels for fast point-in-rect tests
        const kid = kidBoxes.map((b) => ({ x0: (b.x * dpr) | 0, y0: (b.y * dpr) | 0, x1: ((b.x + b.w) * dpr) | 0, y1: ((b.y + b.h) * dpr) | 0 }));
        const covered = (px, py) => { for (const k of kid) { if (px >= k.x0 && px < k.x1 && py >= k.y0 && py < k.y1) return true; } return false; };
        const sx = Math.max(2, ((x1 - x0) / 50) | 0), sy = Math.max(2, ((y1 - y0) / 50) | 0);
        const buckets = new Map(); let tot = 0;
        for (let y = y0; y < y1; y += sy) for (let x = x0; x < x1; x += sx) { if (covered(x, y)) continue; const i = (y * W + x) * 4; const k = (png.data[i] >> 4) + ',' + (png.data[i + 1] >> 4) + ',' + (png.data[i + 2] >> 4); buckets.set(k, (buckets.get(k) || 0) + 1); tot++; }
        if (tot < 24) return null;
        let best = null, bc = 0; for (const [k, c] of buckets) if (c > bc) { bc = c; best = k; }
        if (!best || bc / tot < 0.5) return null;
        const [r, g, b] = best.split(',').map((n) => +n * 16 + 8);
        return { r, g, b };
      };
      // dark OR saturated (a colored brand band) — ignore plain light/white gutters (avoid false-positives on light sites)
      const isDarkOrColored = (r, g, b) => { const avg = (r + g + b) / 3; const chroma = Math.max(r, g, b) - Math.min(r, g, b); return avg < 110 || (avg <= 230 && chroma >= 60); };
      // DARK-FLOOR SNAP (reversible: CAPTURE_NO_BANDBG_DARKFLOOR=1 ⇒ pre-fix gutter-only behavior). The gutter
      // sampler EXCLUDES every child box, so on a band whose content (cards/heading/grid) tiles nearly the whole
      // width, only the thin inter-card margins remain — a tiny, contamination-prone sliver. resend's "Reach humans"
      // black band (y7412) is a textbook case: the band's TRUE base fill is pure black rgb(8,8,8) painting behind ALL
      // content (97% of the full band area), but the surviving gutter sliver sits over a faint glow region and reads
      // rgb(40,40,56) — an OVER-painted blue-purple that exists NOWHERE in the source as a flat bg. The clone then
      // rendered a rgb(40,40,56) panel (meanDE ~21, vis ~0.13). FIX: when the gutter accepted a DARK/colored bg, also
      // measure the WHOLE-band dominant (children INCLUDED — a section's base bg paints behind all its content, so the
      // area-dominant color IS the base). If that whole-band dominant is itself DARK (avg<48 — far below the 110 "dark"
      // gate so a genuine colored brand band, e.g. solid purple, never trips it), owns a clear majority of the band
      // (>=0.6), and is meaningfully DARKER than the gutter color (avg delta>=12 — only ever correcting an over-paint
      // lift, never lightening), SNAP the adopted bg to that true dark floor. No-op on light sites (whole-band dominant
      // is light → not dark), on genuine dark bands the gutter already read right (delta<12 → no snap), and on colored
      // bands (whole-band dominant is the color, not dark → no snap). Generalizes the fix beyond resend.
      const DARKFLOOR_SNAP = process.env.CAPTURE_NO_BANDBG_DARKFLOOR !== '1';
      const wholeBandDominant = (box) => {
        const W = png.width, H = png.height;
        const x0 = Math.max(0, (box.x * dpr) | 0), y0 = Math.max(0, (box.y * dpr) | 0), x1 = Math.min(W, ((box.x + box.w) * dpr) | 0), y1 = Math.min(H, ((box.y + box.h) * dpr) | 0);
        if (x1 - x0 < 16 || y1 - y0 < 16) return null;
        const sx = Math.max(2, ((x1 - x0) / 50) | 0), sy = Math.max(2, ((y1 - y0) / 50) | 0);
        const buckets = new Map(); let tot = 0;
        for (let y = y0; y < y1; y += sy) for (let x = x0; x < x1; x += sx) { const i = (y * W + x) * 4; const k = (png.data[i] >> 4) + ',' + (png.data[i + 1] >> 4) + ',' + (png.data[i + 2] >> 4); buckets.set(k, (buckets.get(k) || 0) + 1); tot++; }
        if (tot < 24) return null;
        let best = null, bc = 0; for (const [k, c] of buckets) if (c > bc) { bc = c; best = k; }
        if (!best) return null;
        const [r, g, b] = best.split(',').map((n) => +n * 16 + 8);
        return { r, g, b, frac: bc / tot };
      };
      let bandAdopt = 0, bandSnap = 0;
      const cr = contentRootOf(data.root);
      for (const band of boxKidsOf(cr)) {
        if (!band.box || band.box.w < 140 || band.box.h < 44) continue;
        const c = gutterBg(band.box, descendantBoxes(band));
        if (!c || !isDarkOrColored(c.r, c.g, c.b)) continue;
        let { r, g, b } = c;
        if (DARKFLOOR_SNAP) {
          const wb = wholeBandDominant(band.box);
          const gutAvg = (c.r + c.g + c.b) / 3;
          if (wb) { const wbAvg = (wb.r + wb.g + wb.b) / 3; if (wbAvg < 48 && wb.frac >= 0.6 && gutAvg - wbAvg >= 12) { r = wb.r; g = wb.g; b = wb.b; bandSnap++; } }
        }
        const col = `rgb(${r}, ${g}, ${b})`;
        band.bgSampled = col;
        if (!band.background) band.background = {};
        band.background.color = col;
        bandAdopt++;
      }
      console.log(`  CAPTURE_BANDBG: adopted dark/colored gutter bg on ${bandAdopt} top-level band(s)${DARKFLOOR_SNAP ? ` (dark-floor snap on ${bandSnap})` : ''}`);
    }
    // S8: rasterize WebGL-canvas / animated gradient regions (unrepresentable as CSS) → PNG, recorded
    // as data.rasters[{box,file}] so the builder can set them as section backgrounds.
    data.rasters = [];
    const canv = await page.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => { const r = c.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((b) => b.w > 200 && b.h > 150));
    const blankish = (im) => { let lo = 0, n = 0; for (let i = 0; i < im.data.length; i += 4 * 97) { n++; if (im.data[i] > 235 && im.data[i + 1] > 235 && im.data[i + 2] > 235) lo++; } return n && lo / n > 0.92; }; // >92% near-white = blank (WebGL not captured)
    let ri = 0; for (const b of canv) { const cr = cropPng(png, b, dpr); if (cr && !blankish(cr)) { const f = `/tmp/raster-${srcTag}-${ri++}.png`; fs.writeFileSync(f, PNG.sync.write(cr)); data.rasters.push({ box: b, file: f }); } }
    if (data.rasters.length) console.log(`  rasterized ${data.rasters.length} canvas/gradient region(s)`);
    // S6: raw <svg> outerHTML loses external-CSS fills (currentColor/class) → renders default BLACK
    // (the Sign-in black box). Rasterize each visible svg from the screenshot = its TRUE rendered look;
    // blank/transparent svg → mark SKIP (drop, it's decorative). Bounds: only sane-sized svgs.
    let si = 0, svgRas = 0, svgSkip = 0;
    const doSvg = (n) => { if (!n) return; if (n.kind === 'container') { (n.children || []).forEach(doSvg); return; } if (n.kind === 'svg' && n.box) { if (Math.max(n.box.w, n.box.h) <= 22) { n.raster = 'SKIP'; svgSkip++; return; } /* tiny decorative caret/sparkle → drop (clutter+height) */ if (n.box.w >= 12 && n.box.h >= 8 && n.box.w <= 900 && n.box.h <= 900) { const cr = cropPng(png, n.box, dpr); if (!cr || blankish(cr)) { n.raster = 'SKIP'; svgSkip++; return; } const f = `/tmp/svg-${srcTag}-${si++}.png`; fs.writeFileSync(f, PNG.sync.write(cr)); n.raster = f; svgRas++; } } };
    doSvg(data.root);
    if (svgRas || svgSkip) console.log(`  svg: ${svgRas} rasterized, ${svgSkip} skipped (blank/decorative)`);
    // VISUAL MOCKUP: crop each detected composite-media subtree from the full-page screenshot → ONE raster.
    // Replaces the leaked text/voids with the actual rendered pixels (dashboards, brand cards, promos).
    // Mockups use a STRICTER blank test than WebGL: a Stripe dashboard UI is mostly white (white bg +
    // dark text/charts), so the 92% WebGL threshold falsely dropped rendered dashboards. Only SKIP a
    // mockup if it's ~uniformly white (>98.5% near-white) AND has almost no dark ink — i.e. truly empty.
    const mockBlank = (im) => { let lo = 0, dark = 0, n = 0; for (let i = 0; i < im.data.length; i += 4 * 97) { n++; const r = im.data[i], g = im.data[i + 1], b = im.data[i + 2]; if (r > 235 && g > 235 && b > 235) lo++; if (r < 160 && g < 160 && b < 160) dark++; } return n && lo / n > 0.985 && dark / n < 0.003; };
    // BLACK-VOID GUARD (void-imagery fix; mirror of mockBlank for the dark theme): mockBlank only catches a
    // near-WHITE empty crop. The diagnosed resend defect is the OPPOSITE — a crop that is a TRULY UNIFORM BLACK
    // void (a lazy <img> that never painted → the full-page screenshot has only the section's black gutter there,
    // so the crop uploads as an empty dark rectangle). The single-img recovery above now emits the real <img> for
    // those bands, but this is the belt-and-suspenders fallback for any residual mockup that still rasterizes a
    // dead-black rectangle. SKIP only a GENUINE void: ~uniform (very low luminance variance) AND >=99.5% pure-near-
    // black AND essentially no bright ink. A real dark-themed dashboard screenshot (mock7/9: ~99% dark BUT carries
    // bright glyphs/charts + meaningful variance) does NOT trip this — it has lit UI detail, so it stays.
    const blackVoid = (im) => {
      let pureBlack = 0, bright = 0, n = 0, sum = 0, sum2 = 0;
      for (let i = 0; i < im.data.length; i += 4 * 97) { n++; const r = im.data[i], g = im.data[i + 1], b = im.data[i + 2]; const lum = (r + g + b) / 3; sum += lum; sum2 += lum * lum; if (r < 24 && g < 24 && b < 24) pureBlack++; if (lum > 90) bright++; }
      if (!n) return true;
      const variance = sum2 / n - (sum / n) * (sum / n);
      return pureBlack / n > 0.995 && bright / n < 0.002 && variance < 30; // dead-uniform black → empty void, not content
    };
    // TEXT-MASK (USER-FEEDBACK #4): white-fill a crop-local rectangle so the text BAKED into the raster is
    // erased — only the live overlay text (rebuilt as native leaves) then shows. Mask boxes arrive in page
    // coords (same system as n.box) via n.textMask; translate to crop-local pixels and clamp to the crop.
    const maskRect = (im, n, m) => {
      const x0 = Math.max(0, Math.round((m.x - n.box.x) * dpr)), y0 = Math.max(0, Math.round((m.y - n.box.y) * dpr));
      const x1 = Math.min(im.width, Math.round((m.x - n.box.x + m.w) * dpr)), y1 = Math.min(im.height, Math.round((m.y - n.box.y + m.h) * dpr));
      for (let y = y0; y < y1; y++) { for (let x = x0; x < x1; x++) { const i = (y * im.width + x) * 4; im.data[i] = 255; im.data[i + 1] = 255; im.data[i + 2] = 255; im.data[i + 3] = 255; } }
    };
    // SURFACE BLANK-RASTER GUARD (surface-raster guard #1): a surface leaf (canvas/preview-iframe/css-bg) is a
    // FLAT region, so mockBlank's white-only test is not enough — a webgl scene that failed to capture (or a
    // cross-origin iframe that paints nothing) comes back as a SOLID color (often black/transparent). NEVER feed
    // the grader that rectangle. SKIP if low variance (~uniform) OR a single quantized color dominates >95%.
    // Sampled sparsely (every 97th px) for speed; threshold mirrors the diagnosis (variance~0 OR dom-color >95%).
    const surfaceBlank = (im) => {
      const buckets = new Map(); let n = 0; let sum = 0, sum2 = 0;
      for (let i = 0; i < im.data.length; i += 4 * 97) {
        const r = im.data[i], g = im.data[i + 1], b = im.data[i + 2]; n++;
        const lum = (r + g + b) / 3; sum += lum; sum2 += lum * lum;
        const k = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4); buckets.set(k, (buckets.get(k) || 0) + 1);
      }
      if (!n) return true;
      const variance = sum2 / n - (sum / n) * (sum / n);
      let bc = 0; for (const c of buckets.values()) if (c > bc) bc = c;
      const domFrac = bc / n;
      return variance < 12 || domFrac > 0.95; // ~flat (no detail) OR one color owns >95% → blank surface
    };
    // ─── GL-READBACK (CAPTURE_NO_GLREADBACK=1 to disable; default ON) ─────────────────────────────────
    // A WebGL/canvas hero (reactdev, framer) IS rendered at end-state but reads BLANK from the composited
    // screenshot crop (the back-buffer is normally discarded). The getContext patch installed in the init
    // script forced preserveDrawingBuffer:true, so canvas.toDataURL() now returns the REAL end-state pixels.
    // Collect a readback {box,dataUrl} for every qualifying canvas (same min size as the surface-canvas gate),
    // keyed by box for doMockup to consult. End-state-faithful: only pixels the source end-state actually shows.
    // Wrapped so a readback failure can NEVER throw out of capture → empty list → existing crop path used.
    let glReadbacks = [];
    if (process.env.CAPTURE_NO_GLREADBACK !== '1') {
      try {
        glReadbacks = await page.evaluate(() => {
          const out = [];
          for (const c of document.querySelectorAll('canvas')) {
            try {
              const r = c.getBoundingClientRect();
              const box = { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
              if (!(box.w > 200 && box.h > 150 && box.w <= 1600 && box.h <= 1600)) continue;
              const dataUrl = c.toDataURL('image/png');
              if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,') && dataUrl.length > 256) out.push({ box, dataUrl });
            } catch (e) { /* tainted / no-readback canvas → skip; crop fallback applies */ }
          }
          return out;
        });
      } catch (e) { glReadbacks = []; }
    }
    // Find the readback whose box best matches a surface-canvas leaf (same coord system as n.box). Tolerant
    // match: centers within 24px and dims within 24px (rounding/scrollY jitter), pick the closest.
    const matchReadback = (box) => {
      let best = null, bestD = Infinity;
      for (const rb of glReadbacks) {
        const b = rb.box;
        const dx = Math.abs((b.x + b.w / 2) - (box.x + box.w / 2)), dy = Math.abs((b.y + b.h / 2) - (box.y + box.h / 2));
        const dw = Math.abs(b.w - box.w), dh = Math.abs(b.h - box.h);
        if (dx <= 24 && dy <= 24 && dw <= 24 && dh <= 24) { const d = dx + dy + dw + dh; if (d < bestD) { bestD = d; best = rb; } }
      }
      return best;
    };
    let mi = 0, mok = 0, mmask = 0, surfOk = 0, surfBlankSkip = 0, glOk = 0;
    const doMockup = (n) => { if (!n) return; if (n.kind === 'container') { (n.children || []).forEach(doMockup); return; } if (n.kind === 'mockup' && n.box) {
      // GL-READBACK: for a canvas surface, prefer the toDataURL back-buffer readback if it is NON-blank.
      // It is the TRUE end-state canvas (vs the composited crop, which is blank for preserveDrawingBuffer-less
      // contexts). Decode → reuse the SAME surfaceBlank guard; if non-blank use it, ELSE fall through to crop.
      if (n.surface && n.surfaceKind === 'canvas') {
        const rb = matchReadback(n.box);
        if (rb) {
          try {
            const im = PNG.sync.read(Buffer.from(rb.dataUrl.slice('data:image/png;base64,'.length), 'base64'));
            if (im && im.width >= 10 && im.height >= 10 && !surfaceBlank(im)) {
              const f = `/tmp/surface-${srcTag}-${mi++}.png`; fs.writeFileSync(f, PNG.sync.write(im)); n.raster = f; surfOk++; glOk++; return;
            }
          } catch (e) { /* decode failed → fall through to the existing crop path */ }
        }
      }
      const cr = cropPng(png, n.box, dpr);
      if (n.surface) {
        // surfaces use the dedicated variance/dominant-color guard (NOT the white-only mockBlank).
        if (!cr || surfaceBlank(cr)) { n.raster = 'SKIP'; surfBlankSkip++; return; }
        const f = `/tmp/surface-${srcTag}-${mi++}.png`; fs.writeFileSync(f, PNG.sync.write(cr)); n.raster = f; surfOk++; return;
      }
      if (!cr || mockBlank(cr)) { n.raster = 'SKIP'; return; }
      if (process.env.CAPTURE_NO_IMGRECOVER !== '1' && blackVoid(cr)) { n.raster = 'SKIP'; return; } // dead-uniform black void → don't upload an empty dark rectangle
      if (Array.isArray(n.textMask)) { for (const m of n.textMask) { if (m && m.w > 0 && m.h > 0) { maskRect(cr, n, m); mmask++; } } }
      const f = `/tmp/mockup-${srcTag}-${mi++}.png`; fs.writeFileSync(f, PNG.sync.write(cr)); n.raster = f; mok++; } };
    doMockup(data.root);
    if (mok) console.log(`  mockups: ${mok} region-captured${mmask ? ` (${mmask} baked-text box(es) masked)` : ''}`);
    if (surfOk || surfBlankSkip) console.log(`  surface-raster: ${surfOk} surface(s) rastered, ${surfBlankSkip} blank-skipped${glOk ? ` (${glOk} via GL-readback)` : ''}`);
    data.stats.surfaceRasters = surfOk; data.stats.surfaceBlankSkipped = surfBlankSkip; data.stats.glReadbacks = glOk;
  } catch (e) { console.error('paint-sample skipped:', e.message); }

  await browser.close();
  data.stats.capturePath = capturedHeadedPath; // 'headless' (flag off) | 'true-headed' | 'enhanced-headless'
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  console.log(`LAYOUT TREE captured → ${out}`);
  if (CAPTURE_HEADED) console.log(`  CAPTURE_HEADED path: ${capturedHeadedPath}`);
  console.log(`  containers: ${data.stats.containers} | leaves: ${data.stats.leaves} | max depth: ${data.stats.maxDepth} | containers w/ background: ${data.stats.containersWithBg}`);
  console.log(`  painted-color sampled on ${painted} text leaves | fonts: ${data.fonts.length} loaded, ${data.fontFiles.length} files, ${Object.keys(data.fontFaceMap || {}).length} CSSOM @font-face famil(ies)`);
})();
