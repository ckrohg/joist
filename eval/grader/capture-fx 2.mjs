#!/usr/bin/env node
/**
 * @purpose Phase 1 — EFFECT-AWARE capture (CLONE_CAPABILITY_SPEC §5.1). The root-cause
 * fix: read the full resolved style set and interpret props JOINTLY, never trust one in
 * isolation. Produces a faithful per-element record that downstream (IR → build) can
 * reproduce — including the effects that fooled the old capture.
 *
 * Captures, per visible element: box geometry, full fidelity-critical style, and an
 * interpreted `paint` (gradient-text → the real gradient, not the fallback color),
 * effects (shadow/filter/transform/clip/blend), pseudo-elements (::before/::after),
 * + page-level: real loaded fonts (with @font-face src to self-host), section bands.
 *
 * Usage: node capture-fx.mjs --source <url> [--out capture-fx.json] [--width 1440]
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source'); const out = arg('out', './capture-fx.json'); const width = parseInt(arg('width', '1440'), 10);
if (!source) { console.error('need --source'); process.exit(2); }

// The real painted text color. getComputedStyle().color LIES for gradient-clipped / -webkit-text-fill
// text (Stripe's navy headline computes as rgb(129,184,26) green). Naive "dominant non-bg color" also
// fails — a wide headline box overlaps background gradients/images and samples those instead of glyphs.
// EDGE-AWARE method: text = thin strokes of ONE uniform color producing high local contrast; gradients
// are smooth (no sharp edges). Bucket only high-contrast edge pixels, exclude the box's background
// color, and take the dominant remaining color = the ink. Works for dark-on-light AND light-on-dark.
function dominantTextColor(png, box, dpr = 1) {
  const W = png.width, H = png.height;
  const x0 = Math.max(0, (box.x * dpr) | 0), y0 = Math.max(0, (box.y * dpr) | 0), x1 = Math.min(W, ((box.x + box.w) * dpr) | 0), y1 = Math.min(H, ((box.y + box.h) * dpr) | 0);
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  const lum = (i) => 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
  const key = (i) => (png.data[i] >> 4) + ',' + (png.data[i + 1] >> 4) + ',' + (png.data[i + 2] >> 4);
  // 1) background = overall most-common color in the box (largest flat area)
  const all = new Map(); for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const k = key((y * W + x) * 4); all.set(k, (all.get(k) || 0) + 1); }
  let bgk = null, bgc = 0; for (const [k, c] of all) if (c > bgc) { bgc = c; bgk = k; }
  const bg = bgk.split(',').map((n) => +n * 16 + 8);
  const dBg = (i) => Math.abs(png.data[i] - bg[0]) + Math.abs(png.data[i + 1] - bg[1]) + Math.abs(png.data[i + 2] - bg[2]);
  const R = 4; // stroke half-width search radius
  // 2) ink pixels = FAR from bg AND have a bg pixel within R px (a thin stroke, not a wide fill).
  // Excludes gradient/image fills (far from bg but no bg pixel nearby). Works dark-on-light & light-on-dark.
  const ink = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4; const d = dBg(i); if (d < 70) continue;
    let near = false; for (let r = 1; r <= R && !near; r++) { if (x - r >= x0 && dBg((y * W + x - r) * 4) < 48) near = true; else if (x + r < x1 && dBg((y * W + x + r) * 4) < 48) near = true; else if (y - r >= y0 && dBg(((y - r) * W + x) * 4) < 48) near = true; else if (y + r < y1 && dBg(((y + r) * W + x) * 4) < 48) near = true; }
    if (near) ink.push([png.data[i], png.data[i + 1], png.data[i + 2], d]);
  }
  if (ink.length < 10) return null;
  // 3) glyph CORE = pixels furthest from bg (antialiased edge pixels are blends → diluted; the cores
  // are pure). Average the top 35% most-extreme so we recover the true ink color, not a washed blend.
  ink.sort((a, b) => b[3] - a[3]);
  const core = ink.slice(0, Math.max(12, Math.round(ink.length * 0.12)));
  const avg = core.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]).map((v) => Math.round(v / core.length));
  return avg;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, userAgent: UA, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  // harvest real font files from the network (CORS blocks cross-origin cssRules)
  const fontUrls = new Set();
  page.on('response', (r) => { const u = r.url(); if (/\.woff2?(\?|$)/i.test(u)) fontUrls.add(u); });
  try { await page.goto(source, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await page.goto(source, { waitUntil: 'load', timeout: 60000 }); } catch {} }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(2000);
  await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 180)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(1000);
  try { await page.evaluate(() => document.fonts.ready); } catch {}

  const data = await page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    // ---- visible-truth test: checkVisibility + geometry (clip / 1px / offscreen) ----
    const visible = (el) => {
      try { if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false; } catch {}
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false;
      if (r.width < 2 && r.height < 2) return false;                                  // 1px sr-only box
      if (cs.clip === 'rect(1px, 1px, 1px, 1px)' || cs.clipPath === 'inset(50%)') return false;
      if (r.right < 0 || r.bottom < 0 || r.left > innerWidth + 50) return false;      // off-screen (−9999px)
      return true;
    };
    // ---- joint paint interpretation: the gradient-text fix ----
    const paintOf = (cs) => {
      // MUST read the prefixed prop explicitly — getComputedStyle resolves
      // `backgroundClip` to 'border-box' even when `-webkit-background-clip:text` paints.
      const clip = (cs.getPropertyValue('-webkit-background-clip') || cs.getPropertyValue('background-clip') || '');
      const bg = cs.backgroundImage;
      const fill = cs.getPropertyValue('-webkit-text-fill-color');
      const transparentFill = fill === 'rgba(0, 0, 0, 0)' || fill === 'transparent';
      // gradient-text = clip:text OR (transparent text-fill + a gradient background)
      if ((clip.includes('text') || transparentFill) && bg && bg !== 'none' && /gradient/.test(bg)) return { kind: 'gradient-text', value: bg };
      const paint = (fill && !transparentFill && fill !== cs.color) ? fill : cs.color; // text-fill overrides color
      return { kind: 'solid', value: paint };
    };
    const nz = (v) => v && v !== 'none' && v !== 'normal' && !/^(rgba\(0, 0, 0, 0\)|0px)/.test(v);
    const effectsOf = (cs) => {
      const e = {};
      if (nz(cs.boxShadow)) e.boxShadow = cs.boxShadow;
      if (nz(cs.textShadow)) e.textShadow = cs.textShadow;
      if (nz(cs.filter)) e.filter = cs.filter;
      if (nz(cs.backdropFilter)) e.backdropFilter = cs.backdropFilter;
      if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') e.mixBlendMode = cs.mixBlendMode;
      if (nz(cs.clipPath)) e.clipPath = cs.clipPath;
      if (cs.transform && cs.transform !== 'none') e.transform = cs.transform;
      if (cs.animationName && cs.animationName !== 'none') e.animationName = cs.animationName;
      if (cs.transitionDuration && parseFloat(cs.transitionDuration) > 0) e.transition = `${cs.transitionProperty} ${cs.transitionDuration} ${cs.transitionTimingFunction}`;
      return Object.keys(e).length ? e : null;
    };
    const typo = (cs) => ({ family: cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim(), size: Math.round(parseFloat(cs.fontSize)), weight: cs.fontWeight, style: cs.fontStyle, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, transform: cs.textTransform, align: cs.textAlign });
    const pseudo = (el, which) => { const cs = getComputedStyle(el, which); if (!cs.content || cs.content === 'none' || cs.content === 'normal') { const hasBox = nz(cs.backgroundImage) || nz(cs.boxShadow) || (cs.borderTopWidth && parseFloat(cs.borderTopWidth) > 0); if (!hasBox) return null; } return { content: cs.content, bg: cs.backgroundColor, bgImage: cs.backgroundImage !== 'none' ? cs.backgroundImage : null, effects: effectsOf(cs), w: cs.width, h: cs.height, paint: paintOf(cs) }; };

    const hasOwnText = (el) => { for (const n of el.childNodes) if (n.nodeType === 3 && clean(n.textContent)) return true; return false; };
    const els = []; const seen = new Set();
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,a,button,span,div,img,svg')) {
      if (!visible(el)) continue;
      const tag = el.tagName.toLowerCase(); const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      const box = { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
      const common = { box, bg: cs.backgroundColor, bgImage: cs.backgroundImage !== 'none' ? cs.backgroundImage : null, radius: cs.borderTopLeftRadius, effects: effectsOf(cs), before: pseudo(el, '::before'), after: pseudo(el, '::after') };
      if (tag === 'img') { const src = el.currentSrc || el.src; if (!src || src.startsWith('data:') || r.width < 24) continue; els.push({ type: 'image', tag, src, alt: el.alt || '', natW: el.naturalWidth, natH: el.naturalHeight, objectFit: cs.objectFit, ...common }); continue; }
      if (tag === 'svg') { if (r.width < 8) continue; els.push({ type: 'svg', tag, svg: el.outerHTML.slice(0, 4000), ...common }); continue; }
      const isH = /^h[1-6]$/.test(tag), isBtn = tag === 'a' || tag === 'button';
      if (!isH && !isBtn && !hasOwnText(el)) continue;
      const t = clean(el.innerText || el.textContent); if (!t || t.length > 400) continue;
      const k = tag + ':' + t.toLowerCase() + ':' + Math.round(box.y / 4); if (seen.has(k)) continue; seen.add(k);
      if (!isH && !isBtn && parseFloat(cs.fontSize) < 11) continue;
      // C8: interaction descriptor — record which elements are interactive triggers + their kind
      // (so the builder/grader know tabs/accordions/dropdowns/menus exist). Emission is downstream.
      const ia = {}; const exp = el.getAttribute('aria-expanded'); if (exp != null) ia.expanded = exp;
      const hp = el.getAttribute('aria-haspopup'); if (hp) ia.haspopup = hp;
      if (el.getAttribute('aria-controls')) ia.controls = true;
      const role = el.getAttribute('role'); if (role && /tab|menu|button|switch|combobox|disclosure/.test(role)) ia.role = role;
      const interactive = Object.keys(ia).length ? ia : null;
      // C8: capture the HIDDEN panel content this trigger controls (display:none at rest → normally
      // pruned). Resolve via aria-controls, else a nearby menu/region, and grab its links so the
      // builder can re-emit a working disclosure (<details>) instead of a dead static trigger.
      let panel = null;
      if (interactive) {
        const cid = el.getAttribute('aria-controls'); let pEl = cid ? document.getElementById(cid) : null;
        if (!pEl && el.parentElement) pEl = el.parentElement.querySelector('[role=menu],[role=region],[role=dialog],.menu,.dropdown,ul');
        if (pEl) { const items = [...pEl.querySelectorAll('a')].slice(0, 14).map((a) => ({ text: clean(a.innerText || a.textContent).slice(0, 48), href: a.href || '' })).filter((x) => x.text); if (items.length) panel = { items }; }
      }
      // C2: tag interactive (a/button) els so the Node-side hover pass can find them and read :hover
      const cfx = isBtn ? els.length : null; if (cfx != null) el.setAttribute('data-cfx', String(cfx));
      els.push({ type: isH ? 'heading' : (isBtn ? 'button' : 'text'), tag, level: isH ? +tag[1] : null, text: t, href: isBtn && el.href ? el.href : null, paint: paintOf(cs), typo: typo(cs), interactive, panel, cfx, ...common });
    }

    // page-level: section bands + loaded fonts
    const vw = innerWidth; const bands = [];
    for (const el of document.querySelectorAll('section,header,footer,main,div')) { if (!visible(el)) continue; const r = el.getBoundingClientRect(); const top = r.top + scrollY; if (r.width < vw * 0.85 || r.height < 120 || r.height > 8000) continue; if (bands.some((b) => Math.min(top + r.height, b.y + b.h) - Math.max(top, b.y) > 0.55 * Math.min(r.height, b.h))) continue; const cs = getComputedStyle(el); bands.push({ y: Math.round(top), h: Math.round(r.height), bg: cs.backgroundColor, bgImage: cs.backgroundImage !== 'none' ? cs.backgroundImage : null }); }
    bands.sort((a, b) => a.y - b.y);
    const fonts = []; try { document.fonts.forEach((f) => { if (f.status === 'loaded') fonts.push({ family: f.family.replace(/['"]/g, ''), weight: f.weight, style: f.style, unicodeRange: f.unicodeRange, src: f.src }); }); } catch {}
    const gradTextCount = els.filter((e) => e.paint && e.paint.kind === 'gradient-text').length;
    const pseudoCount = els.filter((e) => e.before || e.after).length;
    const effectCount = els.filter((e) => e.effects).length;
    return { url: location.href, title: document.title, pageBg: getComputedStyle(document.body).backgroundColor, pageH: document.documentElement.scrollHeight, vw, elCount: els.length, gradTextCount, pseudoCount, effectCount, bands, fonts, els };
  });
  data.fontFiles = [...fontUrls];
  // PAINTED-COLOR OVERRIDE: replace lying computed colors on solid text with the sampled painted color.
  // Kills the green-headline class of bug at the source. Gradient-text is left alone (it keeps the real
  // gradient for CSS reapplication). Only overrides when sampling finds a confident dominant color.
  let painted = 0, paintFixed = 0;
  try {
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(150);
    const png = PNG.sync.read(await page.screenshot({ fullPage: true }));
    const dpr = png.width / data.vw; // device px per CSS px (deviceScaleFactor, robust to rounding)
    for (const el of data.els) {
      if (!el.paint || el.paint.kind !== 'solid' || !el.text) continue;
      if (el.box.h > 240 || el.box.w < 6 || el.box.h < 6) continue;
      const c = dominantTextColor(png, el.box, dpr); if (!c) continue;
      const prev = el.paint.value; const next = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
      // overwrite value IN PLACE only — do NOT add fields to el.paint, or build-ir's style-dedup
      // (which serializes the whole paint object as its key) would treat every element as unique.
      el.paint.value = next; el._paintSampled = true; painted++;
      const m = (prev || '').match(/(\d+)\D+(\d+)\D+(\d+)/); if (m && (Math.abs(+m[1] - c[0]) + Math.abs(+m[2] - c[1]) + Math.abs(+m[3] - c[2]) > 60)) paintFixed++;
    }
  } catch (e) { console.error('paint-sample skipped:', e.message); }

  // C2 HOVER PASS: getComputedStyle does NOT reflect :hover, so move the REAL mouse over each tagged
  // interactive element and read the hover computed style; record only the deltas vs rest. The builder
  // emits these as Elementor hover keys. (capture-fx previously recorded rest-state only → dead clones.)
  let hovered = 0;
  try {
    const ids = data.els.filter((e) => e.cfx != null && (e.tag === 'a' || e.tag === 'button')).map((e) => e.cfx).slice(0, 28);
    for (const id of ids) {
      const rest = await page.evaluate((i) => { const el = document.querySelector(`[data-cfx="${i}"]`); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), color: cs.color, bg: cs.backgroundColor, transform: cs.transform, boxShadow: cs.boxShadow, inview: r.top >= 0 && r.bottom <= innerHeight }; }, id);
      if (!rest || !rest.inview) continue;
      await page.mouse.move(rest.x, rest.y); await page.waitForTimeout(200);
      const hov = await page.evaluate((i) => { const el = document.querySelector(`[data-cfx="${i}"]`); if (!el) return null; const cs = getComputedStyle(el); return { color: cs.color, bg: cs.backgroundColor, transform: cs.transform, boxShadow: cs.boxShadow }; }, id);
      await page.mouse.move(2, 2); await page.waitForTimeout(40);
      if (!hov) continue; const h = {};
      if (hov.color !== rest.color) h.color = hov.color;
      if (hov.bg !== rest.bg) h.background = hov.bg;
      if (hov.transform !== rest.transform && hov.transform !== 'none') h.transform = hov.transform;
      if (hov.boxShadow !== rest.boxShadow && hov.boxShadow !== 'none') h.boxShadow = hov.boxShadow;
      if (Object.keys(h).length) { const rec = data.els.find((e) => e.cfx === id); if (rec) { rec.hover = h; hovered++; } }
    }
  } catch (e) { console.error('hover-pass skipped:', e.message); }

  await browser.close();
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  console.log(`captured ${data.elCount} elements | gradient-text: ${data.gradTextCount} | pseudo-elements: ${data.pseudoCount} | effect-elements: ${data.effectCount} | bands: ${data.bands.length} | fonts: ${data.fonts.length} loaded, ${data.fontFiles.length} files`);
  console.log(`painted-color sampled on ${painted} text els; materially corrected ${paintFixed} lying computed colors`);
  console.log(`hover states captured on ${hovered} interactive els | interaction descriptors on ${data.els.filter((e) => e.interactive).length} els`);
  const gt = data.els.filter((e) => e.paint && e.paint.kind === 'gradient-text').slice(0, 3);
  if (gt.length) { console.log('\nGRADIENT-TEXT correctly captured (was the garbage-fallback bug):'); gt.forEach((e) => console.log(`  "${(e.text || '').slice(0, 36)}" → ${e.paint.value.slice(0, 70)}`)); }
  if (data.fontFiles.length) console.log('\nFONT FILES to self-host:', data.fontFiles.map((u) => u.split('/').pop()).join(', '));
})();
