#!/usr/bin/env node
/**
 * @purpose SHADOW MODULE (NOT wired into the live composite — see RESPONSIVE_AND_MOTION_GRADING.md).
 * The MOTION-FIDELITY grading dimension. The live flywheel is a STATIC single-scroll grader: it measures
 * layout/responsive but is BLIND to hover/scroll-reveal/parallax/pin/library motion — yet a 1:1 clone is a
 * hard user requirement (2026-06-05) to match hover/dynamic/motion. This module captures MOTION SIGNALS for
 * a URL via Playwright (reusing capture-layout.mjs's launch/settle approach — supabase renders headless) and
 * scores source-vs-clone agreement, RICHNESS-WEIGHTED so a STATIC source is never punished (nothing to miss
 * ⇒ score → 1.0) while an animated source fully holds the clone to reproducing its motion.
 *
 * Three signal classes per page:
 *   (1) SCROLL TRAJECTORIES — step-scroll 0→bottom (0.5·vh steps, settle each step); for ≤120 stable-selector
 *       elements record per-step {viewport-top, transform matrix, opacity}. Post-process: opacity 0→1 OR a
 *       translateY/scale collapsing-to-rest AS it enters the viewport = SCROLL-REVEAL; transform tracking
 *       scrollY at a rate ≠ 1 = PARALLAX; viewport-top ~constant across a scroll range while siblings move
 *       away = PIN/STICKY. Counts per type (+ approx y-bands).
 *   (2) HOVER DELTAS — for ≤80 interactive candidates (a/button/[role=button]/[class*=card]/[class*=btn])
 *       force :hover, diff getComputedStyle on {transform,opacity,backgroundColor,color,boxShadow,borderColor,
 *       filter}. Non-trivial delta = a HOVER EFFECT. Records count + changed props + approx transition-duration.
 *   (3) LIBRARY / TRIGGER FINGERPRINT — scan loaded <script> src/inline + window globals for gsap/ScrollTrigger/
 *       Lenis/Framer/AOS/locomotive; count IntersectionObserver instantiations (constructor hooked pre-load) or
 *       fall back to aos/data-aos/[class*=reveal] markers; count CSS transition/animation declarations.
 *
 * SCORE — grade-motion(source, clone) ∈ [0,1]: per-class source-vs-clone AGREEMENT (scroll = per-type
 * count agreement; hover = prevalence agreement + property-set overlap; library = Jaccard of the lib/trigger
 * sets + CSS-motion-prevalence ratio), richness-weighted: motionRichness(source)∈[0,1]; richness~0 ⇒ score→1.0.
 *
 * DETERMINISM — --selftest sets CLONE signals = a DEEPCOPY of the SOURCE capture (NOT a re-capture — the
 * recipe-#95 flaky-rail trap from grade-responsive). So source-vs-source == EXACTLY 1.0 every run.
 *
 * Usage:
 *   node grade-motion.mjs --source <url> --clone <url>
 *   node grade-motion.mjs --selftest [--source <url>]
 */
import { chromium } from 'playwright';
import fs from 'fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);

const SELFTEST = has('selftest');
const DUMP = arg('dump'); // --dump <out.json>: capture ONE source's motion signals + HOVER PROFILE → JSON (builder input)
const source = arg('source') || (SELFTEST ? 'https://supabase.com/' : null);
const clone = SELFTEST ? source : arg('clone');
const width = parseInt(arg('width', '1440'), 10);
const EPS = 1e-9;

// --dump only needs --source. Grading needs --source AND (--clone | --selftest). (DUMP path is additive; the
// --selftest / --source/--clone grading behavior below is byte-identical to before — DUMP just short-circuits earlier.)
if (!source) { console.error('need --source --clone   (or --selftest, or --dump <out.json> --source <url>)'); process.exit(2); }
if (!DUMP && !clone && !SELFTEST) { console.error('need --source --clone   (or --selftest)'); process.exit(2); }

const r4 = (x) => Math.round(x * 10000) / 10000;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ratio = (a, b) => { a = Math.abs(a); b = Math.abs(b); if (a === 0 && b === 0) return 1; const mx = Math.max(a, b); return mx === 0 ? 1 : Math.min(a, b) / mx; };

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAPTURE — drive Playwright over ONE url, return the raw motion-signal record (NO scoring here).
// Reuses capture-layout's launch (anti-bot args + webdriver mask + reducedMotion) and step-scroll settle.
// CRUCIAL: we do NOT emulate reducedMotion here — motion is THE signal; muting it would erase what we measure.
// ════════════════════════════════════════════════════════════════════════════════════════════════
async function captureMotion(url) {
  const launchArgs = ['--disable-blink-features=AutomationControlled'];
  let browser;
  try { browser = await chromium.launch({ args: launchArgs }); }
  catch (e) { browser = await chromium.launch(); }
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, userAgent: UA, deviceScaleFactor: 1, locale: 'en-US' });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    window.chrome = { runtime: {} };
    // ─── HOOK IntersectionObserver BEFORE any page script loads ──────────────────────────────────
    // Scroll-reveal libs (AOS, custom reveal observers, Framer) instantiate IntersectionObserver to fire
    // on viewport-entry. Counting constructor calls is the most direct trigger fingerprint. Must wrap the
    // constructor in an init script so it is in place BEFORE the page's bundles run (else we miss the count).
    try {
      const RealIO = window.IntersectionObserver;
      if (RealIO) {
        window.__ioCount = 0;
        const Wrapped = function (cb, opts) { try { window.__ioCount++; } catch (e) {} return new RealIO(cb, opts); };
        Wrapped.prototype = RealIO.prototype;
        window.IntersectionObserver = Wrapped;
      }
    } catch (e) {}
  });
  const page = await ctx.newPage();

  // record script SRCs as they load (window.__scriptSrcs is also read in-page, but network gives off-DOM bundles)
  const scriptSrcs = new Set();
  page.on('response', (r) => { const u = r.url(); if (/\.m?js(\?|$)/i.test(u)) scriptSrcs.add(u); });

  try { await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); }
  catch { try { await page.goto(url, { waitUntil: 'load', timeout: 60000 }); } catch {} }
  await page.waitForTimeout(1500);
  try { await page.evaluate(() => document.fonts.ready); } catch {}

  const vh = await page.evaluate(() => window.innerHeight).catch(() => 900);
  const docH = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => vh);

  // ─── (A) TAG ≤120 trajectory-candidate elements with a stable selector + record per-step state ───
  // Tag candidates FIRST (at scroll 0) so the SAME element set is followed across every scroll step.
  // Candidate = a sized, visible, content-or-box element (top-N by area, capped). Stable selector = a
  // data attribute we stamp (data-mtid) — robust across reflow, unlike nth-of-type which the DOM can shift.
  await page.evaluate((MAXN) => {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'HEAD', 'BR', 'HR', 'TEMPLATE', 'PATH', 'DEFS', 'TITLE']);
    const cands = [];
    const all = document.body ? document.body.querySelectorAll('*') : [];
    for (const el of all) {
      if (SKIP.has(el.tagName)) continue;
      let cs; try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      const w = r.width, h = r.height; if (w < 8 || h < 8) continue;
      const area = w * h; if (area < 400) continue;
      cands.push([el, area]);
    }
    cands.sort((a, b) => b[1] - a[1]);
    let id = 0;
    // build a stable selector for each kept candidate (id > tag+nth+class), stamp data-mtid
    const labelOf = (el) => {
      if (el.id) return '#' + el.id;
      const tag = el.tagName.toLowerCase();
      const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      let nth = 1, sib = el; while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) nth++;
      return `${tag}:nth-of-type(${nth})${cls}`.slice(0, 80);
    };
    for (const [el] of cands.slice(0, MAXN)) {
      el.setAttribute('data-mtid', String(id));
      el.setAttribute('data-mtsel', labelOf(el));
      id++;
    }
    window.__mtCount = id;
  }, 120);

  // step-scroll 0→bottom in 0.5·vh increments, settle each step, snapshot every tagged element's state.
  const step = Math.max(200, Math.round(vh * 0.5));
  const steps = [];
  const ys = [];
  for (let y = 0; y <= docH + step; y += step) { ys.push(Math.min(y, docH)); if (y >= docH) break; }
  if (ys[ys.length - 1] !== docH) ys.push(docH);
  for (const y of ys) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(140);
    const snap = await page.evaluate(() => {
      const out = [];
      const parseMatrix = (t) => {
        // returns {tx, ty, sx, sy} from a computed transform matrix() / matrix3d() / 'none'
        if (!t || t === 'none') return { tx: 0, ty: 0, sx: 1, sy: 1 };
        const m = t.match(/matrix(3d)?\(([^)]+)\)/);
        if (!m) return { tx: 0, ty: 0, sx: 1, sy: 1 };
        const v = m[2].split(',').map((x) => parseFloat(x.trim()));
        if (m[1]) { // matrix3d: a=v[0], d=v[5], tx=v[12], ty=v[13]
          return { tx: v[12] || 0, ty: v[13] || 0, sx: v[0] || 1, sy: v[5] || 1 };
        }
        return { tx: v[4] || 0, ty: v[5] || 0, sx: v[0] || 1, sy: v[3] || 1 };
      };
      for (const el of document.querySelectorAll('[data-mtid]')) {
        const id = +el.getAttribute('data-mtid');
        let cs; try { cs = getComputedStyle(el); } catch (e) { continue; }
        const r = el.getBoundingClientRect();
        const mx = parseMatrix(cs.transform);
        out.push({ id, top: Math.round(r.top), op: +parseFloat(cs.opacity || '1'), tx: r4m(mx.tx), ty: r4m(mx.ty), sx: r4m(mx.sx), sy: r4m(mx.sy) });
      }
      function r4m(x) { return Math.round(x * 100) / 100; }
      return out;
    });
    steps.push({ scrollY: y, vh, els: snap });
  }
  // back to top for hover capture
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(200);

  // ─── (B) HOVER DELTAS — ≤80 interactive candidates, REAL :hover, diff computed style ──────────────
  // CRITICAL: CSS `:hover` in Chromium reacts ONLY to a GENUINE pointer position — synthetic
  // mouseenter/pointerenter events fire JS listeners but do NOT activate the :hover pseudo-class, so a
  // probe found 0/80 hover effects while a real-pointer probe found 8/15 on supabase. So we move the
  // mouse to each element via Playwright's real pointer (page.hover / mouse.move) and diff the computed
  // style of THAT element before/after. Tag candidates in-page first so we can index them stably.
  const PROPS = ['transform', 'opacity', 'backgroundColor', 'color', 'boxShadow', 'borderColor', 'filter'];
  const nHover = await page.evaluate(() => {
    const sel = 'a, button, [role="button"], [class*="card"], [class*="btn"], [class*="Btn"], [class*="Card"]';
    // PRIORITIZE elements targeted by a :hover stylesheet rule touching transform/opacity/box-shadow/filter —
    // the DEFINITIVE hover-styled elements (our reconstructed cards use scoped :hover custom_css keyed to
    // .elementor-element-XXXX which the semantic selector misses; many sources hover via CSS too). Then fill with
    // the semantic set. Applied symmetrically to source AND clone, so it's fair. Real-hover below verifies.
    const hoverBases = new Set();
    for (const s of document.styleSheets) { try { for (const r of s.cssRules) { if (r.selectorText && /:hover/.test(r.selectorText) && /transform|box-shadow|opacity|filter|background/i.test(r.cssText)) { for (const part of r.selectorText.split(',')) { const m = part.trim(); if (m.includes(':hover')) hoverBases.add(m.replace(/:hover.*$/, '').trim()); } } } } catch (e) {} }
    const matchedHover = [];
    for (const b of hoverBases) { if (!b) continue; try { for (const el of document.querySelectorAll(b)) matchedHover.push(el); } catch (e) {} }
    const cand = new Set([...matchedHover, ...document.querySelectorAll(sel)]);
    let id = 0;
    for (const el of cand) {
      let cs; try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      el.setAttribute('data-mthov', String(id));
      id++;
      if (id >= 80) break;
    }
    return id;
  });
  const snapHover = (idx) => page.$eval(`[data-mthov="${idx}"]`, (el, props) => {
    const cs = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = cs[p] || '';
    const d = (cs.transitionDuration || '0s').split(',')[0].trim();
    o.__dur = d.endsWith('ms') ? (parseFloat(d) || 0) : (d.endsWith('s') ? (parseFloat(d) || 0) * 1000 : 0);
    // element TYPE (button-like vs card-like) — purely descriptive; folded into the dumped hover PROFILE so the
    // builder knows whether the dominant hover vocabulary belongs to buttons (native btn-hover controls) or cards
    // (scoped :hover custom_css). NOTE: additive — scoring (scoreHover) never reads __kind, so selftest stays 1.0.
    const tag = (el.tagName || '').toLowerCase();
    const cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
    const buttonLike = tag === 'button' || el.getAttribute('role') === 'button' || /\bbtn\b|button/.test(cls) || (tag === 'a' && /\bbtn\b|button|cta/.test(cls));
    o.__kind = buttonLike ? 'button' : (/card/.test(cls) ? 'card' : (tag === 'a' ? 'button' : 'card'));
    return o;
  }, PROPS).catch(() => null);
  const hoverEffects = [];
  let hoverWithEffect = 0;
  for (let i = 0; i < nHover; i++) {
    const sel = `[data-mthov="${i}"]`;
    const before = await snapHover(i);
    if (!before) continue;
    const dur = before.__dur || 0;
    // move the REAL pointer onto the element (scrolls it into the viewport, then hovers its center).
    let hovered = false;
    try { await page.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 1500 }); } catch (e) {}
    try { await page.locator(sel).first().hover({ timeout: 1500, force: true }); hovered = true; } catch (e) {}
    if (!hovered) { try { await page.mouse.move(5, 5); } catch (e) {} continue; }
    await page.waitForTimeout(80 + Math.min(dur, 400)); // let the transition land
    const after = await snapHover(i);
    // move the pointer away so the next element starts from rest (avoids sticky-hover bleed).
    try { await page.mouse.move(2, 2); } catch (e) {}
    if (!after) continue;
    const changed = [];
    const delta = {}; // changed-prop → {from, to}; captured so --dump can REPRODUCE the actual hover delta (kses-safe CSS)
    // COLOR-FORMAT-AGNOSTIC: the delta test is pure string-inequality of the computed-style values, so ANY two
    // DIFFERENT valid color strings count as a hover delta — modern functions included (lab()/lch()/oklab()/oklch()/
    // color()/hsl()). We never rgb-parse here, so a 2026 site whose computed colors are lab()/oklch() (tailwind,
    // basecamp) is detected + dumped (from/to) verbatim, NOT discarded. build-structured.motColor then passes those
    // strings through into the Elementor hover color controls (Elementor + browsers accept them as valid CSS).
    for (const p of PROPS) if (before[p] !== after[p]) { changed.push(p); delta[p] = { from: before[p], to: after[p] }; }
    if (changed.length > 0) { hoverWithEffect++; hoverEffects.push({ props: changed.sort(), dur, kind: after.__kind || before.__kind || 'button', delta }); }
  }
  const hover = { nCandidates: nHover, withEffect: hoverWithEffect, effects: hoverEffects };

  // ─── (C) LIBRARY / TRIGGER FINGERPRINT + CSS-motion prevalence ───────────────────────────────────
  const fp = await page.evaluate(() => {
    const libs = new Set();
    // window globals
    try { if (window.gsap || window.TweenMax || window.TweenLite) libs.add('gsap'); } catch (e) {}
    try { if (window.ScrollTrigger || (window.gsap && window.gsap.plugins && window.gsap.plugins.ScrollTrigger)) libs.add('scrolltrigger'); } catch (e) {}
    try { if (window.Lenis || window.lenis) libs.add('lenis'); } catch (e) {}
    try { if (window.AOS || document.querySelector('[data-aos]')) libs.add('aos'); } catch (e) {}
    try { if (window.LocomotiveScroll || window.locomotive || document.querySelector('[data-scroll]')) libs.add('locomotive'); } catch (e) {}
    try { if (window.Motion || window.framerMotion) libs.add('framer'); } catch (e) {}
    // script SRC + inline scan
    let scriptText = '';
    for (const s of document.querySelectorAll('script')) {
      const src = (s.src || '').toLowerCase();
      if (src) {
        if (/gsap|greensock/.test(src)) libs.add('gsap');
        if (/scrolltrigger/.test(src)) libs.add('scrolltrigger');
        if (/lenis/.test(src)) libs.add('lenis');
        if (/\baos\b|aos\.js|aos@/.test(src)) libs.add('aos');
        if (/locomotive/.test(src)) libs.add('locomotive');
        if (/framer-motion|framerusercontent|framer\.com/.test(src)) libs.add('framer');
      } else if (s.textContent && s.textContent.length < 200000) {
        scriptText += s.textContent.slice(0, 4000) + '\n';
      }
    }
    const st = scriptText.toLowerCase();
    if (/gsap|greensock/.test(st)) libs.add('gsap');
    if (/scrolltrigger/.test(st)) libs.add('scrolltrigger');
    if (/\blenis\b/.test(st)) libs.add('lenis');
    if (/locomotivescroll/.test(st)) libs.add('locomotive');
    // Framer-built site markers
    try { if (document.querySelector('[data-framer-name],[data-framer-component-type],[class*="framer-"]')) libs.add('framer'); } catch (e) {}
    // AOS / generic reveal markers as IntersectionObserver proxy. Also recognize ELEMENTOR'S NATIVE entrance
    // animation: Elementor emits the entrance class in the element's data-settings (`"animation":"fadeInUp"`) AND
    // toggles `.elementor-invisible` (pre-reveal) → the animation-name class + `.animated` (post-reveal). The
    // data-settings marker is capture-STATE-INDEPENDENT (present whether or not the reveal has fired) so it counts
    // an Elementor entrance reveal honestly even after recipe-#96 finished the animation to its visible end-state.
    // This makes the reveal sub-metric SEE a native Elementor scroll-reveal clone (which carries none of the
    // AOS/[class*=reveal] markers) — without it, an Elementor entrance clone reads revealMarkers=0 (false-blind).
    let revealMarkers = 0;
    try { revealMarkers = document.querySelectorAll('[data-aos],[class*="reveal"],[class*="Reveal"],[class*="fade-in"],[class*="animate-"],[data-scroll],.elementor-invisible').length; } catch (e) {}
    // Elementor native entrance: scan [data-settings] for an `animation` directive (kept in the element's settings
    // JSON regardless of pre/post-reveal class state). String-match in JS (robust where a quote-escaped CSS attr
    // selector is brittle). Each such element is an entrance-reveal marker — counted alongside the AOS-style markers.
    try {
      for (const el of document.querySelectorAll('[data-settings]')) {
        const ds = el.getAttribute('data-settings') || '';
        if (/"_?animation"\s*:\s*"(?!none")[a-zA-Z]/.test(ds)) revealMarkers++;
      }
    } catch (e) {}
    if (revealMarkers > 0 && !libs.has('aos') && !libs.has('locomotive')) libs.add('reveal-markers');

    // IntersectionObserver instantiation count (hooked in addInitScript)
    const ioCount = (typeof window.__ioCount === 'number') ? window.__ioCount : 0;

    // RUNNING ANIMATIONS — getAnimations() exposes the live Web-Animations + CSS-animation/transition set.
    // INFINITE-iteration animations are the MARQUEE / continuous-loop motion class (supabase's logo marquee
    // = ~23 infinite animations). This is a distinct, always-on motion signal the scroll trajectory + hover
    // probes are blind to (it never collapses to rest and isn't pointer-triggered). Count infinite vs finite.
    let animInfinite = 0, animFinite = 0, animTotal = 0;
    try {
      for (const a of document.getAnimations()) {
        animTotal++;
        try { const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {}; if (t.iterations === Infinity) animInfinite++; else animFinite++; } catch (e) {}
      }
    } catch (e) {}

    // CSS transition/animation declaration prevalence: sample stylesheets' rules; if cross-origin (no
    // cssRules access) fall back to a computed-style scan over a sample of elements. Returns a prevalence
    // number = (rules/elements with a non-trivial transition or animation) — used as a ratio between sites.
    let cssMotionDecls = 0, cssRulesSeen = 0, crossOrigin = false;
    try {
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch (e) { crossOrigin = true; continue; }
        if (!rules) continue;
        for (const rule of rules) {
          cssRulesSeen++;
          const t = rule.cssText || '';
          if (/transition\s*:/.test(t) && !/transition\s*:\s*(none|0s|all 0s)/.test(t)) cssMotionDecls++;
          else if (/animation\s*:/.test(t) && !/animation\s*:\s*none/.test(t)) cssMotionDecls++;
          else if (/@keyframes/.test(t)) cssMotionDecls++;
        }
      }
    } catch (e) {}
    // computed-style fallback / supplement: count elements with a real, non-trivial transition or animation.
    let elemsWithMotion = 0, elemsScanned = 0;
    try {
      const all = document.body ? document.body.querySelectorAll('*') : [];
      let i = 0;
      for (const el of all) {
        if (i++ % 3 !== 0) continue; // sample every 3rd to bound cost
        elemsScanned++;
        let cs; try { cs = getComputedStyle(el); } catch (e) { continue; }
        const td = (cs.transitionDuration || '0s');
        const an = (cs.animationName || 'none');
        const hasT = td !== '0s' && !/^0s(, 0s)*$/.test(td);
        const hasA = an && an !== 'none';
        if (hasT || hasA) elemsWithMotion++;
        if (elemsScanned >= 1500) break;
      }
    } catch (e) {}
    const cssMotionPrevalence = elemsScanned > 0 ? elemsWithMotion / elemsScanned : 0;

    // MARQUEE CANDIDATES — the geometry of each continuous-loop (logo/customer) strip. An element running an INFINITE
    // CSS animation whose effect TRANSLATES it horizontally is a marquee TRACK: its box is wider than its nearest
    // overflow:hidden ancestor (the CLIP window). Capture the track box (page coords), the clip box, the member count
    // (the track's direct element children), the slide direction (sign of the keyframe translateX), and the duration.
    // Purely descriptive — read only by deriveMarqueeProfile/--dump; scoring never touches it (selftest stays 1.0).
    let marqueeCands = [];
    try {
      const cssSel = (el) => {
        const tag = el.tagName.toLowerCase();
        let nth = 1, sib = el; while ((sib = sib.previousElementSibling)) { if (sib.tagName === el.tagName) nth++; }
        const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        return `${tag}:nth-of-type(${nth})${el.id ? '#' + el.id : cls}`;
      };
      const clipAncestor = (el) => { let p = el.parentElement; while (p) { let cs; try { cs = getComputedStyle(p); } catch (e) { return null; } if (/hidden|clip/.test(cs.overflowX) || /hidden|clip/.test(cs.overflow)) return p; p = p.parentElement; } return null; };
      for (const a of document.getAnimations()) {
        let t; try { t = a.effect && a.effect.getTiming ? a.effect.getTiming() : null; } catch (e) { continue; }
        if (!t || t.iterations !== Infinity) continue;
        const el = a.effect && a.effect.target; if (!el || !el.getBoundingClientRect) continue;
        // is this a HORIZONTAL slide? read the keyframes for a translateX/translate3d X delta.
        let dir = 'left', isX = false;
        try {
          const kfs = a.effect.getKeyframes ? a.effect.getKeyframes() : [];
          const xs = [];
          for (const k of kfs) { const tr = k.transform || k.translate || ''; const m = String(tr).match(/translate(?:X|3d)?\(\s*(-?\d+(?:\.\d+)?)/); if (m) xs.push(+m[1]); }
          if (xs.length >= 2) { isX = true; dir = (xs[xs.length - 1] < xs[0]) ? 'left' : 'right'; }
          else if (xs.length === 1 && xs[0] !== 0) { isX = true; dir = xs[0] < 0 ? 'left' : 'right'; }
        } catch (e) {}
        if (!isX) continue;
        const r = el.getBoundingClientRect();
        const clip = clipAncestor(el);
        const cr = clip ? clip.getBoundingClientRect() : r;
        const trackW = Math.round(r.width), clipW = Math.round(cr.width);
        if (trackW < 40 || r.height < 8) continue;
        const members = el.children ? el.children.length : 0;
        let durMs = 0; try { durMs = Math.round(t.duration || (a.effect.getComputedTiming ? a.effect.getComputedTiming().duration : 0) || 0); } catch (e) {}
        marqueeCands.push({
          sel: cssSel(el), clipSel: clip ? cssSel(clip) : null,
          trackW, trackH: Math.round(r.height), trackTop: Math.round(r.top + window.scrollY), trackLeft: Math.round(r.left + window.scrollX),
          clipW, clipOverflows: trackW > clipW + 8, durMs, direction: dir, members,
        });
        if (marqueeCands.length >= 60) break;
      }
    } catch (e) {}

    return {
      libs: [...libs].sort(),
      ioCount,
      revealMarkers,
      animInfinite,
      animFinite,
      animTotal,
      marqueeCands,
      cssMotionDecls,
      cssRulesSeen,
      crossOrigin,
      elemsWithMotion,
      elemsScanned,
      cssMotionPrevalence: Math.round(cssMotionPrevalence * 10000) / 10000,
    };
  });

  const mtCount = await page.evaluate(() => window.__mtCount || 0).catch(() => 0);
  await browser.close();
  return { url, vh, docH, mtCount, scriptCount: scriptSrcs.size, steps, hover, fp };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// POST-PROCESS — classify each tracked element's scroll trajectory into reveal / parallax / pin.
// Operates purely on the captured `steps` (deterministic ⇒ a deepcopy reclassifies identically).
// ════════════════════════════════════════════════════════════════════════════════════════════════
function classifyScroll(cap) {
  const { steps, vh, docH } = cap;
  // index per-element trajectory: id -> [{scrollY, top, op, ty, sy}]
  const traj = new Map();
  for (const s of steps) for (const e of s.els) {
    if (!traj.has(e.id)) traj.set(e.id, []);
    traj.get(e.id).push({ scrollY: s.scrollY, top: e.top, op: e.op, ty: e.ty, sy: e.sy });
  }
  const reveal = [], parallax = [], pin = [];
  for (const [id, pts] of traj) {
    if (pts.length < 3) continue;
    const ops = pts.map((p) => p.op);
    const tys = pts.map((p) => p.ty);
    const sys = pts.map((p) => p.sy);
    const tops = pts.map((p) => p.top);
    const opMin = Math.min(...ops), opMax = Math.max(...ops);
    const tyMin = Math.min(...tys), tyMax = Math.max(...tys);
    const syMin = Math.min(...sys), syMax = Math.max(...sys);

    // SCROLL-REVEAL: opacity ramps from low→~1 (≥0.25 swing, ends high) OR a translateY/scale that
    // collapses toward rest (large early offset → ~0/1 at rest) as the element enters the viewport.
    const opacityRamp = (opMax - opMin) >= 0.25 && opMax >= 0.6;
    const translateCollapse = (tyMax - tyMin) >= 18 && Math.min(Math.abs(tys[0]), Math.abs(tys[tys.length - 1])) < (tyMax - tyMin) * 0.5;
    const scaleCollapse = (syMax - syMin) >= 0.06 && Math.abs(sys[sys.length - 1] - 1) <= Math.abs(sys[0] - 1);
    if (opacityRamp || translateCollapse || scaleCollapse) {
      // ADDITIVE reveal-KIND tag (read ONLY by deriveRevealProfile/--dump; scoring uses .length, never .kind ⇒ selftest 1.0).
      // The dominant pre-rest offset tells direction: a translateY that starts BELOW rest (ty>0 early) and collapses to ~0
      // = a rise-into-place = fadeInUp; ty<0 early collapsing up = fadeInDown; |tx| early (rare here) = slide; pure opacity
      // ramp with no transform = plain fade. The first sampled offset (largest |offset|) is the entrance start state.
      const tyStart = Math.abs(tys[0]) >= Math.abs(tys[tys.length - 1]) ? tys[0] : tys[tys.length - 1];
      let kind = 'fade';
      if (translateCollapse) kind = tyStart > 0 ? 'fadeInUp' : 'fadeInDown';
      else if (scaleCollapse) kind = 'zoomIn';
      reveal.push({ id, yBand: Math.round((tops[0] + (steps[0] ? steps[0].scrollY : 0))), kind, opSwing: r4(opMax - opMin), tySwing: r4(tyMax - tyMin) });
      continue;
    }

    // PARALLAX: viewport-top moves at a rate ≠ 1 relative to scrollY across the range. For a static
    // (non-parallax) element, d(top)/d(scrollY) ≈ -1 (it scrolls up exactly with the page). A parallax
    // layer moves slower/faster ⇒ slope clearly off -1.
    //
    // ANTI-FALSE-POSITIVE: the old slope was a 2-POINT estimate — slope=(b.top-a.top)/dScroll over only the
    // first/last sample. On trivial/near-empty pages (e.g. example.com, whose 5 elements never move because
    // the page is too short to scroll) the 2-point slope ≈ 0 ⇒ deviation |0+1|=1 lands in the band ⇒ static
    // text was mis-read as 5 "parallax layers" (and that noise feeds scrollSig/scrollPresence/motionScore).
    // A REAL parallax layer translates LINEARLY with scroll. So we keep the SAME 2-point CONSUMPTION gate
    // (control flow / what `continue` swallows is byte-identical ⇒ reveal/pin/marquee unaffected), but only
    // COUNT an element as parallax when it ALSO passes a stricter linear-differential-scroll test:
    //   (a) enough samples (>=4) spanning a real scroll range (the existing |dScroll|>=vh*0.5),
    //   (b) a LEAST-SQUARES REGRESSION slope over ALL the element's (scrollY, top) points (robust to jitter),
    //   (c) a GOOD linear fit (Pearson R² >= 0.9 — a no-movement / jittery / non-linear trajectory is rejected),
    //   (d) the existing deviation band (|slope+1| ∈ [0.35, 3]).
    const a = pts[0], b = pts[pts.length - 1];
    const dScroll = b.scrollY - a.scrollY;
    if (Math.abs(dScroll) >= vh * 0.5) {
      const slope2 = (b.top - a.top) / dScroll;          // old 2-point estimate — used ONLY as the consumption gate
      const dev2 = Math.abs(slope2 + 1);
      if (dev2 >= 0.35 && dev2 <= 3) {
        // This element was previously CONSUMED here (pushed to parallax + continue). Preserve that exact
        // consumption, but decide the COUNT with the stricter regression+fit test (anti-false-positive).
        let isParallax = false, slope = slope2, r2 = 0;
        if (pts.length >= 4) {
          // ordinary least-squares: top ≈ m·scrollY + c, over ALL sampled points (deterministic ⇒ selftest 1.0).
          const n = pts.length;
          let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
          for (const p of pts) { sx += p.scrollY; sy += p.top; sxx += p.scrollY * p.scrollY; sxy += p.scrollY * p.top; syy += p.top * p.top; }
          const denomX = n * sxx - sx * sx; // ∝ variance of scrollY (guards a no-scroll-spread fit)
          const denomY = n * syy - sy * sy; // ∝ variance of top    (==0 ⇒ element never moved ⇒ not parallax)
          if (denomX > 0 && denomY > 0) {
            const numCov = n * sxy - sx * sy;
            slope = numCov / denomX;                       // regression slope
            r2 = (numCov * numCov) / (denomX * denomY);    // == Pearson r² of (scrollY, top)
            const dev = Math.abs(slope + 1);
            if (dev >= 0.35 && dev <= 3 && r2 >= 0.9) isParallax = true;
          }
        }
        if (isParallax) parallax.push({ id, slope: r4(slope), r2: r4(r2), yBand: Math.round(a.top + a.scrollY) });
        continue; // consumed exactly as the original code did (whether or not it counted) ⇒ pin/reveal unchanged
      }
    }

    // PIN / STICKY: viewport-relative top stays ~constant across a scroll range while the page scrolls
    // away beneath it. i.e. top barely changes even though scrollY changed a lot.
    if (Math.abs(dScroll) >= vh * 0.8) {
      const topSpan = Math.max(...tops) - Math.min(...tops);
      if (topSpan <= Math.max(24, vh * 0.08)) {
        pin.push({ id, yBand: Math.round(a.top + a.scrollY) });
        continue;
      }
    }
  }
  return { reveal, parallax, pin, revealCount: reveal.length, parallaxCount: parallax.length, pinCount: pin.length, trackedCount: traj.size };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// MOTION RICHNESS — how much motion the SOURCE has, ∈ [0,1]. Drives the anti-false-deflation weighting:
// when richness ~0 (static site), there is nothing to miss ⇒ motionScore → 1.0.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function motionRichness(scroll, cap) {
  const fp = cap.fp;
  // four richness channels, each saturating, then blended via soft-OR
  // scroll channel folds in the marquee/infinite-animation count (a continuous-loop motion class).
  const marquee = fp.animInfinite || 0;
  const scrollSig = clamp01((scroll.revealCount + scroll.parallaxCount + scroll.pinCount + Math.min(marquee, 8)) / 6); // ~6 motion units ⇒ saturated
  const hoverShare = cap.hover.nCandidates > 0 ? cap.hover.withEffect / cap.hover.nCandidates : 0;
  const hoverSig = clamp01(hoverShare / 0.4); // 40% of interactives hovering ⇒ saturated
  // library/CSS-motion channel
  const motionLibs = (fp.libs || []).filter((l) => l !== 'reveal-markers');
  const libSig = clamp01((motionLibs.length * 0.4) + (fp.libs.includes('reveal-markers') ? 0.2 : 0) + clamp01((fp.cssMotionPrevalence || 0) / 0.25) * 0.6);
  // richness = the page is "motion-rich" if ANY channel is strong → use a soft-OR (max-leaning) blend.
  const soft = 1 - (1 - scrollSig) * (1 - hoverSig) * (1 - libSig);
  return clamp01(soft);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// SCORING — per-class source-vs-clone agreement, then richness-weighted blend.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function jaccard(aArr, bArr) {
  const a = new Set(aArr), b = new Set(bArr);
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 1 : inter / uni;
}

function scoreScroll(srcScroll, cloScroll, srcFp, cloFp) {
  // per-type count agreement (min/max ratio). If source has NONE of a type, that type is not held against.
  // 'marquee' = infinite-iteration animation count (continuous-loop class), drawn from the fingerprint.
  const types = [
    ['reveal', srcScroll.revealCount, cloScroll.revealCount],
    ['parallax', srcScroll.parallaxCount, cloScroll.parallaxCount],
    ['pin', srcScroll.pinCount, cloScroll.pinCount],
    ['marquee', (srcFp && srcFp.animInfinite) || 0, (cloFp && cloFp.animInfinite) || 0],
  ];
  const parts = [];
  for (const [t, s, c] of types) {
    if (s === 0) { if (c === 0) continue; // neither has it → skip; extra-on-clone reported separately
      parts.push({ t, agree: 0.6 }); continue; } // clone invented motion the source lacks → mild penalty
    parts.push({ t, agree: ratio(s, c) });
  }
  if (parts.length === 0) return { score: 1, detail: 'no scroll/loop motion in source' };
  const score = parts.reduce((a, p) => a + p.agree, 0) / parts.length;
  return { score: clamp01(score), detail: parts.map((p) => `${p.t}=${r4(p.agree)}`).join(' ') };
}

function scoreHover(src, clo) {
  const sShare = src.nCandidates > 0 ? src.withEffect / src.nCandidates : 0;
  const cShare = clo.nCandidates > 0 ? clo.withEffect / clo.nCandidates : 0;
  if (src.withEffect === 0) return { score: 1, detail: 'no hover effects in source' };
  // prevalence agreement
  const prevAgree = ratio(sShare, cShare);
  // property-set overlap: union the changed props on each side, Jaccard
  const sProps = new Set(); for (const e of src.effects) for (const p of e.props) sProps.add(p);
  const cProps = new Set(); for (const e of clo.effects) for (const p of e.props) cProps.add(p);
  const propAgree = jaccard([...sProps], [...cProps]);
  const score = 0.6 * prevAgree + 0.4 * propAgree;
  return { score: clamp01(score), detail: `prevalence=${r4(prevAgree)}(src ${r4(sShare)}/clo ${r4(cShare)}) props=${r4(propAgree)}`, sProps: [...sProps], cProps: [...cProps] };
}

function scoreLibrary(src, clo) {
  const sLibs = src.libs || [], cLibs = clo.libs || [];
  if (sLibs.length === 0 && (src.cssMotionPrevalence || 0) < 0.02) {
    // source has no detectable library motion → nothing to reproduce
    return { score: 1, detail: 'no motion library / CSS-motion in source' };
  }
  const jac = jaccard(sLibs, cLibs);
  const cssRatio = ratio(src.cssMotionPrevalence || 0, clo.cssMotionPrevalence || 0);
  // weight library-set agreement higher than CSS prevalence (libs = explicit motion intent)
  const score = (sLibs.length > 0) ? (0.65 * jac + 0.35 * cssRatio) : cssRatio;
  return { score: clamp01(score), detail: `libJaccard=${r4(jac)}(src[${sLibs.join(',')}] clo[${cLibs.join(',')}]) cssPrev=${r4(cssRatio)}(src ${src.cssMotionPrevalence}/clo ${clo.cssMotionPrevalence})` };
}

function gradeMotion(srcCap, cloCap) {
  const srcScroll = classifyScroll(srcCap);
  const cloScroll = classifyScroll(cloCap);
  const richness = motionRichness(srcScroll, srcCap);

  const sc = scoreScroll(srcScroll, cloScroll, srcCap.fp, cloCap.fp);
  const hv = scoreHover(srcCap.hover, cloCap.hover);
  const lib = scoreLibrary(srcCap.fp, cloCap.fp);

  // class weights reflect richness CONTRIBUTION of each channel in the source (so a hover-only source is
  // scored chiefly on hover). Channel presence weights (scroll folds in the marquee/infinite-loop count):
  const scrollPresence = clamp01((srcScroll.revealCount + srcScroll.parallaxCount + srcScroll.pinCount + Math.min((srcCap.fp.animInfinite || 0), 8)) / 4);
  const hoverPresence = srcCap.hover.withEffect > 0 ? clamp01(srcCap.hover.withEffect / Math.max(1, srcCap.hover.nCandidates) / 0.3) : 0;
  const libPresence = clamp01(((srcCap.fp.libs || []).filter((l) => l !== 'reveal-markers').length) * 0.5 + (srcCap.fp.libs.includes('reveal-markers') ? 0.25 : 0) + clamp01((srcCap.fp.cssMotionPrevalence || 0) / 0.2) * 0.5);
  let wS = scrollPresence, wH = hoverPresence, wL = libPresence;
  const wSum = wS + wH + wL;
  let classBlend;
  if (wSum < 1e-6) {
    classBlend = 1; // no class is present in source ⇒ all agreements are 1 by construction
  } else {
    classBlend = (wS * sc.score + wH * hv.score + wL * lib.score) / wSum;
  }

  // RICHNESS-WEIGHTED final: motionScore interpolates between 1.0 (richness 0 ⇒ nothing to miss) and the
  // raw class-agreement (richness 1 ⇒ clone fully held to reproducing the source motion).
  const motionScore = clamp01((1 - richness) * 1.0 + richness * classBlend);

  // ─── MISSING / EXTRA MOTION (human-readable) ─────────────────────────────────────────────────────
  const missing = [], extra = [];
  const cmpType = (label, s, c) => {
    if (s > c) missing.push(`${label}: source ${s} vs clone ${c} (${s - c} not reproduced)`);
    else if (c > s) extra.push(`${label}: clone ${c} vs source ${s} (${c - s} extra)`);
  };
  cmpType('scroll-reveal', srcScroll.revealCount, cloScroll.revealCount);
  cmpType('parallax', srcScroll.parallaxCount, cloScroll.parallaxCount);
  cmpType('pin/sticky', srcScroll.pinCount, cloScroll.pinCount);
  cmpType('marquee/loop-animation', (srcCap.fp.animInfinite || 0), (cloCap.fp.animInfinite || 0));
  // hover
  const sHoverShare = srcCap.hover.nCandidates ? srcCap.hover.withEffect / srcCap.hover.nCandidates : 0;
  const cHoverShare = cloCap.hover.nCandidates ? cloCap.hover.withEffect / cloCap.hover.nCandidates : 0;
  if (srcCap.hover.withEffect > 0 && (sHoverShare - cHoverShare) > 0.1) {
    missing.push(`hover effects: source ${srcCap.hover.withEffect}/${srcCap.hover.nCandidates} interactives animate on hover (${(sHoverShare * 100).toFixed(0)}%) vs clone ${cloCap.hover.withEffect}/${cloCap.hover.nCandidates} (${(cHoverShare * 100).toFixed(0)}%)`);
    if (hv.sProps && hv.cProps) {
      const miss = hv.sProps.filter((p) => !hv.cProps.includes(p));
      if (miss.length) missing.push(`  hover props not reproduced: ${miss.join(', ')}`);
    }
  }
  // libraries
  const sLibs = srcCap.fp.libs || [], cLibs = cloCap.fp.libs || [];
  const missLibs = sLibs.filter((l) => !cLibs.includes(l));
  const extraLibs = cLibs.filter((l) => !sLibs.includes(l));
  if (missLibs.length) missing.push(`motion library/trigger: ${missLibs.join(', ')} present on source, absent on clone`);
  if (extraLibs.length) extra.push(`motion library/trigger: ${extraLibs.join(', ')} on clone, absent on source`);
  if ((srcCap.fp.cssMotionPrevalence || 0) - (cloCap.fp.cssMotionPrevalence || 0) > 0.03) {
    missing.push(`CSS-motion prevalence: source ${srcCap.fp.cssMotionPrevalence} vs clone ${cloCap.fp.cssMotionPrevalence} (transitions/animations under-reproduced)`);
  }

  return {
    motionScore: r4(motionScore),
    motionRichness: r4(richness),
    classBlend: r4(classBlend),
    classWeights: { scroll: r4(wS), hover: r4(wH), library: r4(wL) },
    scroll: { score: r4(sc.score), detail: sc.detail, src: { reveal: srcScroll.revealCount, parallax: srcScroll.parallaxCount, pin: srcScroll.pinCount, marquee: srcCap.fp.animInfinite || 0, tracked: srcScroll.trackedCount }, clone: { reveal: cloScroll.revealCount, parallax: cloScroll.parallaxCount, pin: cloScroll.pinCount, marquee: cloCap.fp.animInfinite || 0, tracked: cloScroll.trackedCount } },
    hover: { score: r4(hv.score), detail: hv.detail, src: { withEffect: srcCap.hover.withEffect, nCandidates: srcCap.hover.nCandidates }, clone: { withEffect: cloCap.hover.withEffect, nCandidates: cloCap.hover.nCandidates } },
    library: { score: r4(lib.score), detail: lib.detail, src: srcCap.fp.libs, clone: cloCap.fp.libs },
    fingerprint: {
      source: { reveal: srcScroll.revealCount, parallax: srcScroll.parallaxCount, pin: srcScroll.pinCount, marquee: srcCap.fp.animInfinite || 0, hoverEffects: srcCap.hover.withEffect, hoverCandidates: srcCap.hover.nCandidates, libs: srcCap.fp.libs, ioCount: srcCap.fp.ioCount, revealMarkers: srcCap.fp.revealMarkers, cssMotionPrevalence: srcCap.fp.cssMotionPrevalence },
      clone: { reveal: cloScroll.revealCount, parallax: cloScroll.parallaxCount, pin: cloScroll.pinCount, marquee: cloCap.fp.animInfinite || 0, hoverEffects: cloCap.hover.withEffect, hoverCandidates: cloCap.hover.nCandidates, libs: cloCap.fp.libs, ioCount: cloCap.fp.ioCount, revealMarkers: cloCap.fp.revealMarkers, cssMotionPrevalence: cloCap.fp.cssMotionPrevalence },
    },
    missingMotion: missing,
    extraMotion: extra,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// HOVER PROFILE — distill a captured page's per-element hover deltas into a COMPACT, builder-consumable
// profile: the DOMINANT hover property-set (e.g. {backgroundColor,color} or {transform,boxShadow}), the typical
// transition-duration (ms), which element TYPES hover (button-like vs card-like), the dominant before→after delta
// VALUES per kind (so the builder can reproduce the actual color/transform/shadow change, kses-safe), and the
// overall hover PREVALENCE (share of interactive candidates with a non-trivial hover delta). DERIVED from the raw
// `hover` capture only — deterministic, no re-capture. This is the ONLY new thing --dump adds beyond the raw signals.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function deriveHoverProfile(cap) {
  const h = cap.hover || { nCandidates: 0, withEffect: 0, effects: [] };
  const prevalence = h.nCandidates > 0 ? h.withEffect / h.nCandidates : 0;
  // dominant property-set: rank single props by frequency, then take the property-SET that co-occurs most often.
  const propFreq = {};                          // prop → count of effects that change it
  const setFreq = {};                           // sorted-prop-set string → count
  const durs = [];
  const byKind = { button: { count: 0, props: {}, durs: [], delta: {} }, card: { count: 0, props: {}, durs: [], delta: {} } };
  for (const e of (h.effects || [])) {
    const props = (e.props || []).slice().sort();
    if (!props.length) continue;
    for (const p of props) propFreq[p] = (propFreq[p] || 0) + 1;
    const key = props.join('+'); setFreq[key] = (setFreq[key] || 0) + 1;
    if (e.dur && e.dur > 0) durs.push(e.dur);
    const k = (e.kind === 'card') ? 'card' : 'button';
    byKind[k].count++;
    for (const p of props) byKind[k].props[p] = (byKind[k].props[p] || 0) + 1;
    if (e.dur && e.dur > 0) byKind[k].durs.push(e.dur);
    // record the most-recent observed delta VALUE per prop per kind (last-write; effects are scanned in DOM order)
    if (e.delta) for (const p of props) { if (e.delta[p] && e.delta[p].to != null) byKind[k].delta[p] = e.delta[p]; }
  }
  const median = (arr) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  // dominant set = the highest-count co-occurring property set (fall back to the top-2 single props if no set repeats)
  let dominantSet = [];
  const setEntries = Object.entries(setFreq).sort((a, b) => b[1] - a[1]);
  if (setEntries.length && setEntries[0][1] >= 2) dominantSet = setEntries[0][0].split('+');
  else dominantSet = Object.entries(propFreq).sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]).sort();
  const kindProfile = (k) => {
    const o = byKind[k];
    const props = Object.entries(o.props).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    return { count: o.count, props, durMs: Math.round(median(o.durs)) || 0, delta: o.delta };
  };
  return {
    hasHover: h.withEffect > 0,
    prevalence: r4(prevalence),
    withEffect: h.withEffect,
    nCandidates: h.nCandidates,
    dominantProps: dominantSet,
    durMs: Math.round(median(durs)) || 0,
    kinds: { button: kindProfile('button'), card: kindProfile('card') },
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// REVEAL PROFILE — distill the SOURCE's scroll-ENTRANCE vocabulary into a COMPACT, builder-consumable profile:
// which top-level Y-BANDS reveal on scroll, the dominant reveal KIND (fade / fadeInUp / fadeInDown / zoomIn),
// the typical entrance DURATION (ms), and the reveal-MARKER count. This is the scroll-reveal analogue of
// deriveHoverProfile. DERIVED purely from the captured `steps` (via classifyScroll) + the fingerprint —
// deterministic, no re-capture. ADDITIVE: the --selftest / --source/--clone grading paths never call this.
//
// TWO evidence sources, fused (an honest scroll-reveal signal even when the grade-motion step-scroll could not
// FIRE a JS-driven (AOS / WAAPI / IntersectionObserver) reveal mid-step — a very common case: the elements end
// the capture still at opacity 0 instead of ramping 0→1, so the trajectory shows 0 ramps but the DOM clearly
// has reveal intent):
//   (1) TRAJECTORY reveals — classifyScroll's reveal[] (true opacity-ramp / translate-collapse / scale-collapse
//       elements), each already tagged with an inferred KIND + the band Y. Highest-confidence: the element was
//       actually SEEN animating into place during the capture.
//   (2) REVEAL-INTENT markers — `[data-aos] / [class*=reveal] / fade-in / animate-` markers (fp.revealMarkers),
//       IntersectionObserver instantiations (fp.ioCount), and elements left STUCK near opacity 0 across every
//       step (op never rose — a JS reveal the capture could not trigger). When (1) is empty but (2) is strong,
//       the source DOES scroll-reveal; we surface that as `hasReveal:true (markers)` with the AOS-default kind
//       (fadeInUp) so the builder can faithfully reproduce entrance motion the trajectory probe could not film.
// FAITHFUL: a genuinely STATIC source (no trajectory reveals, no markers, no IO, no stuck-invisible) ⇒
// hasReveal:false ⇒ the builder attaches NOTHING (byte-identical to reveal-off). We never invent entrance motion.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function deriveRevealProfile(cap, scroll) {
  const fp = cap.fp || {};
  const vh = cap.vh || 900;
  const median = (arr) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  // (1) trajectory reveals — already kind-tagged by classifyScroll.
  const trajReveals = scroll.reveal || [];
  // count elements left STUCK near opacity 0 across EVERY captured step (op never rose ≥0.25 anywhere) — a JS-driven
  // reveal the grade-motion step-scroll could not fire (they end the capture invisible). Pure post-process on steps.
  let stuckInvisible = 0;
  {
    const traj = new Map();
    for (const s of cap.steps || []) for (const e of s.els) { if (!traj.has(e.id)) traj.set(e.id, []); traj.get(e.id).push(e.op); }
    for (const [, ops] of traj) { if (ops.length >= 3 && Math.max(...ops) < 0.25) stuckInvisible++; }
  }
  const revealMarkers = fp.revealMarkers || 0;
  const ioCount = fp.ioCount || 0;
  // reveal intent: a marker-driven OR IO-driven OR stuck-invisible signal beyond the trajectory.
  const markerIntent = (revealMarkers >= 3) || (ioCount >= 2 && stuckInvisible >= 3) || (stuckInvisible >= 6);
  const hasReveal = trajReveals.length > 0 || markerIntent;

  // dominant kind: from the trajectory (if any reveals filmed) else AOS-default fadeInUp for marker/IO intent.
  let dominantKind = 'fadeInUp';
  if (trajReveals.length) {
    const kindFreq = {};
    for (const r of trajReveals) kindFreq[r.kind || 'fade'] = (kindFreq[r.kind || 'fade'] || 0) + 1;
    dominantKind = Object.entries(kindFreq).sort((a, b) => b[1] - a[1])[0][0];
  }
  // typical duration: trajectory reveals don't carry a duration (the step-scroll is too coarse to time a tween),
  // so use a faithful default by kind — modern AOS/Framer entrance tweens cluster ~600-800ms; transforms a touch
  // longer than plain fades. This is the entrance-tween norm, used ONLY when present (hasReveal) — never invented.
  const durMs = dominantKind === 'fade' ? 600 : (dominantKind === 'zoomIn' ? 700 : 800);

  // Y-BANDS that reveal: trajectory reveal yBands, deduped into ~half-viewport buckets (so we know WHICH bands of the
  // page reveal, not just a count). When only marker-intent (no filmed trajectory), we cannot pinpoint bands, so we
  // expose the COUNT signal (markers/stuck) and let the builder reveal its top-level sections uniformly.
  const bandBucket = Math.max(200, Math.round(vh * 0.5));
  const bands = [...new Set(trajReveals.map((r) => Math.round((r.yBand || 0) / bandBucket) * bandBucket))].sort((a, b) => a - b);

  return {
    hasReveal,
    source: trajReveals.length ? 'trajectory' : (markerIntent ? 'markers' : 'none'),
    revealCount: trajReveals.length,           // trajectory reveals actually filmed (== scroll.revealCount)
    dominantKind,                              // fade | fadeInUp | fadeInDown | zoomIn
    durMs,
    revealMarkers,
    ioCount,
    stuckInvisible,
    bands,                                     // approx page-Y bands that reveal (empty when marker-only)
    bandBucket,
    // per-band kind detail (trajectory only) so a builder could vary kind by band; harmless when empty.
    revealsByBand: trajReveals.map((r) => ({ yBand: r.yBand, kind: r.kind || 'fade', opSwing: r.opSwing, tySwing: r.tySwing })).slice(0, 40),
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// MARQUEE PROFILE — distill the source's continuous-loop (logo/customer) strips from the captured marqueeCands. The
// builder (STRUCT_MOTION_MARQUEE) reads this to faithfully reproduce a HEIGHT-NEUTRAL native CSS loop per strip. We
// dedupe near-identical tracks (a 3×-duplicated marquee reports 3 sibling tracks at the same y/width — collapse to
// one), keep only genuinely-overflowing loops, and surface a per-marquee {yBand,trackW,trackH,clipW,direction,durMs,
// members}. FAITHFUL: a static source (no infinite horizontal loop) ⇒ hasMarquee:false ⇒ the builder attaches NOTHING
// (byte-identical to marquee-off). additive — read ONLY by --dump; the grader scoring never calls this (selftest 1.0).
// ════════════════════════════════════════════════════════════════════════════════════════════════
function deriveMarqueeProfile(cap) {
  const fp = cap.fp || {};
  const cands = Array.isArray(fp.marqueeCands) ? fp.marqueeCands : [];
  // DEDUPE: a seamless marquee duplicates its track 2-3× as siblings (same width/height, near-same top). Collapse
  // tracks whose (trackW, trackTop) match within tolerance into one representative (the first seen).
  const uniq = [];
  for (const c of cands) {
    const dup = uniq.find((u) => Math.abs((u.trackW || 0) - (c.trackW || 0)) <= 24 && Math.abs((u.trackTop || 0) - (c.trackTop || 0)) <= 24 && (u.clipSel || '') === (c.clipSel || ''));
    if (!dup) uniq.push(c);
  }
  // keep only real loops (the track is genuinely wider than its clip window — a static centered strip is not a marquee).
  const real = uniq.filter((c) => c.clipOverflows);
  const marquees = real.map((c) => ({
    sel: c.sel, clipSel: c.clipSel,
    yBand: Math.round((c.trackTop || 0) + (c.trackH || 0) / 2),  // page-Y center (matches the builder's captured member-y space)
    trackW: c.trackW, trackH: c.trackH, clipW: c.clipW, clipOverflows: !!c.clipOverflows,
    durMs: c.durMs || 0, direction: c.direction || 'left', members: c.members || 0,
  })).sort((a, b) => a.yBand - b.yBand);
  const dirFreq = {};
  for (const m of marquees) dirFreq[m.direction] = (dirFreq[m.direction] || 0) + 1;
  const dominantDirection = Object.entries(dirFreq).sort((a, b) => b[1] - a[1])[0] ? Object.entries(dirFreq).sort((a, b) => b[1] - a[1])[0][0] : 'left';
  const durs = marquees.map((m) => m.durMs).filter((d) => d > 0).sort((a, b) => a - b);
  const durMs = durs.length ? durs[Math.floor(durs.length / 2)] : 40000;  // median loop duration (faithful default 40s)
  return {
    hasMarquee: marquees.length > 0,
    count: marquees.length,
    rawInfinite: fp.animInfinite || 0,     // the raw infinite-anim count (the grade-motion marquee sub-metric)
    dominantDirection,
    durMs,
    marquees,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════════════════════════════════
(async () => {
  const t0 = Date.now();

  // ─── --dump MODE — capture ONE url's motion signals + derive the HOVER PROFILE → JSON, then exit ─────────────
  // Additive short-circuit (DRY: reuses captureMotion exactly). Does NOT run the grader; the --selftest /
  // --source/--clone grading paths below are completely untouched. Output = the builder's motion-signals input.
  if (DUMP) {
    console.log(`[grade-motion --dump] SOURCE: ${source}`);
    console.log('[grade-motion --dump] capturing source motion signals ...');
    const cap = await captureMotion(source);
    const scroll = classifyScroll(cap);
    const richness = motionRichness(scroll, cap);
    const hoverProfile = deriveHoverProfile(cap);
    const revealProfile = deriveRevealProfile(cap, scroll); // INCH 2: scroll-ENTRANCE vocabulary (additive)
    const marqueeProfile = deriveMarqueeProfile(cap);       // INCH 3: continuous-loop (marquee) vocabulary (additive)
    const out = {
      source,
      capturedAt: new Date().toISOString(),
      width,
      motionRichness: r4(richness),
      hoverProfile,
      revealProfile,
      marqueeProfile,
      scroll: { revealCount: scroll.revealCount, parallaxCount: scroll.parallaxCount, pinCount: scroll.pinCount, trackedCount: scroll.trackedCount },
      fingerprint: { libs: cap.fp.libs, animInfinite: cap.fp.animInfinite, cssMotionPrevalence: cap.fp.cssMotionPrevalence, revealMarkers: cap.fp.revealMarkers, ioCount: cap.fp.ioCount },
      raw: cap, // full raw capture (steps/hover/fp) so downstream tools can re-derive anything without re-capturing
    };
    fs.writeFileSync(DUMP, JSON.stringify(out, null, 2));
    console.log(`[grade-motion --dump] wrote ${DUMP}`);
    console.log(`  hoverProfile: hasHover=${hoverProfile.hasHover} prevalence=${hoverProfile.prevalence} (${hoverProfile.withEffect}/${hoverProfile.nCandidates}) dominantProps=[${hoverProfile.dominantProps.join(',')}] durMs=${hoverProfile.durMs}`);
    console.log(`    kinds: button{count ${hoverProfile.kinds.button.count} props[${hoverProfile.kinds.button.props.join(',')}] dur ${hoverProfile.kinds.button.durMs}ms} card{count ${hoverProfile.kinds.card.count} props[${hoverProfile.kinds.card.props.join(',')}] dur ${hoverProfile.kinds.card.durMs}ms}`);
    console.log(`  revealProfile: hasReveal=${revealProfile.hasReveal} source=${revealProfile.source} dominantKind=${revealProfile.dominantKind} durMs=${revealProfile.durMs} | trajReveals=${revealProfile.revealCount} markers=${revealProfile.revealMarkers} io=${revealProfile.ioCount} stuckInvisible=${revealProfile.stuckInvisible} bands=[${revealProfile.bands.join(',')}]`);
    console.log(`  marqueeProfile: hasMarquee=${marqueeProfile.hasMarquee} count=${marqueeProfile.count} rawInfinite=${marqueeProfile.rawInfinite} dir=${marqueeProfile.dominantDirection} durMs=${marqueeProfile.durMs} | bands=[${marqueeProfile.marquees.map((m) => m.yBand).join(',')}]`);
    console.log(`  motionRichness=${r4(richness)}  scroll{reveal ${scroll.revealCount} parallax ${scroll.parallaxCount} pin ${scroll.pinCount}}  libs[${cap.fp.libs.join(',')}]`);
    console.log(JSON.stringify({ dump: true, source, hoverProfile, revealProfile, motionRichness: r4(richness) }));
    process.exit(0);
  }

  console.log(`[grade-motion] SOURCE: ${source}`);
  console.log(`[grade-motion] CLONE : ${SELFTEST ? '(== source / selftest deepcopy)' : clone}`);

  console.log('[grade-motion] capturing source motion signals ...');
  const srcCap = await captureMotion(source);

  let cloCap;
  if (SELFTEST) {
    // DETERMINISM (recipe-#95): NEVER re-capture the same URL for the self-test — an independent re-capture
    // of a live page introduces noise (network timing, lazy reveals mid-tween) → flaky rail. The clone
    // signals MUST be a DEEPCOPY of the source capture so source-vs-source == EXACTLY 1.0 every run.
    console.log('[grade-motion] SELFTEST: deep-copying source capture as clone (grader-determinism assertion) ...');
    cloCap = JSON.parse(JSON.stringify(srcCap));
  } else {
    console.log('[grade-motion] capturing clone motion signals ...');
    cloCap = await captureMotion(clone);
  }

  const result = gradeMotion(srcCap, cloCap);
  result.elapsedMs = Date.now() - t0;
  result.selftest = SELFTEST;

  console.log('');
  console.log(`motionScore = ${result.motionScore}   (richness ${result.motionRichness} · classBlend ${result.classBlend})`);
  console.log(`  scroll  : ${result.scroll.score}  ${result.scroll.detail}`);
  console.log(`            src[reveal ${result.scroll.src.reveal} parallax ${result.scroll.src.parallax} pin ${result.scroll.src.pin} marquee ${result.scroll.src.marquee}]  clone[reveal ${result.scroll.clone.reveal} parallax ${result.scroll.clone.parallax} pin ${result.scroll.clone.pin} marquee ${result.scroll.clone.marquee}]`);
  console.log(`  hover   : ${result.hover.score}  ${result.hover.detail}`);
  console.log(`  library : ${result.library.score}  ${result.library.detail}`);
  console.log(`  classWeights: scroll ${result.classWeights.scroll} · hover ${result.classWeights.hover} · library ${result.classWeights.library}`);
  console.log('');
  console.log(`SOURCE motion fingerprint: reveal=${result.fingerprint.source.reveal} parallax=${result.fingerprint.source.parallax} pin=${result.fingerprint.source.pin} marquee=${result.fingerprint.source.marquee} | hover=${result.fingerprint.source.hoverEffects}/${result.fingerprint.source.hoverCandidates} | libs=[${result.fingerprint.source.libs.join(',')}] | io=${result.fingerprint.source.ioCount} revealMarkers=${result.fingerprint.source.revealMarkers} cssMotion=${result.fingerprint.source.cssMotionPrevalence}`);
  console.log(`CLONE  motion fingerprint: reveal=${result.fingerprint.clone.reveal} parallax=${result.fingerprint.clone.parallax} pin=${result.fingerprint.clone.pin} marquee=${result.fingerprint.clone.marquee} | hover=${result.fingerprint.clone.hoverEffects}/${result.fingerprint.clone.hoverCandidates} | libs=[${result.fingerprint.clone.libs.join(',')}] | io=${result.fingerprint.clone.ioCount} revealMarkers=${result.fingerprint.clone.revealMarkers} cssMotion=${result.fingerprint.clone.cssMotionPrevalence}`);
  console.log('');
  if (result.missingMotion.length) {
    console.log('MOTION the clone is MISSING:');
    for (const m of result.missingMotion) console.log(`  - ${m}`);
  } else {
    console.log('MOTION the clone is MISSING: (none)');
  }
  if (result.extraMotion.length) {
    console.log('MOTION the clone has EXTRA (not in source):');
    for (const m of result.extraMotion) console.log(`  - ${m}`);
  }
  console.log('');
  console.log(`[grade-motion] elapsed ${(result.elapsedMs / 1000).toFixed(1)}s`);

  if (SELFTEST) {
    const pass = Math.abs(result.motionScore - 1.0) <= EPS;
    console.log(`[SELFTEST] motionScore=${result.motionScore}  (threshold == ${1.0})  → ${pass ? 'PASS' : 'FAIL'}`);
    console.log(JSON.stringify({ selftest: true, motionScore: result.motionScore, pass }));
    process.exit(pass ? 0 : 1);
  }
  console.log(JSON.stringify({ motionScore: result.motionScore, motionRichness: result.motionRichness, classBlend: result.classBlend, fingerprint: result.fingerprint, missingMotion: result.missingMotion, extraMotion: result.extraMotion }));
})().catch((e) => { console.error('[grade-motion] FATAL', e && e.stack || e); process.exit(3); });
