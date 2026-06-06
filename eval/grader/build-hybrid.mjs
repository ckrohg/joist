#!/usr/bin/env node
/**
 * @purpose HYBRID clone: recover round-trip editability where it matters while keeping ~1:1 on the hard
 * parts. Captures the source once, splits it into top-level SECTIONS, and routes each:
 *   • text-dominant sections (nav, hero, feature copy, footer link columns) → reconstructed as REAL
 *     editable Elementor widgets (heading/text/button/image) with native typography + painted colors.
 *   • media-dominant sections (dashboards, mockups, dense image rows, charts) → rasterized via the proven
 *     section-raster pipeline (downscale→1440 to match container width, split >2400px under WP's 2560
 *     threshold, CAS-retry on stale hash).
 * Editable sections are SIMPLE by construction (anything complex is rasterized), so a focused flow
 * emitter suffices — no reuse of build-flextree's stateful internals.
 * Usage: node build-hybrid.mjs --source <url> --page <id> [--width 1440] [--dry]
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'fs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const source = arg('source'), pageId = arg('page'), W = parseInt(arg('width', '1440'), 10), DRY = process.argv.includes('--dry');
const base = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
const b64 = process.env.JOIST_AUTH_B64; if (!b64 || !source || (!pageId && !DRY)) { console.error('need --source --page + JOIST_AUTH_B64'); process.exit(2); }
const srcTag = (source).replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 14).toLowerCase();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const px = (s) => { const m = String(s || '').match(/(-?\d+(?:\.\d+)?)px/); return m ? +m[1] : null; };
const gFont = (fam) => { const b = (fam || '').toLowerCase(); if (!b) return null; if (/tiempos|times|georgia|garamond|serif/.test(b)) return 'Georgia'; if (/mono|code|courier|consol/.test(b)) return 'Roboto Mono'; return 'Inter'; };
const stripEmoji = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '').replace(/\s+/g, ' ').trim();

async function uploadPng(buf, name) {
  const up = await fetch(base + '/wp-json/wp/v2/media', { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="${name}"` }, body: buf });
  const j = await up.json(); if (!up.ok || !j.source_url) { console.error('upload fail', up.status, JSON.stringify(j).slice(0, 120)); return null; } return j.source_url;
}
function downscale(src, f) { const w = Math.floor(src.width / f), h = Math.floor(src.height / f); const o = new PNG({ width: w, height: h }); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let r = 0, g = 0, b = 0, a = 0; for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) { const si = (((y * f + dy) * src.width) + (x * f + dx)) * 4; r += src.data[si]; g += src.data[si + 1]; b += src.data[si + 2]; a += src.data[si + 3]; } const n = f * f, di = (y * w + x) * 4; o.data[di] = r / n; o.data[di + 1] = g / n; o.data[di + 2] = b / n; o.data[di + 3] = a / n; } return o; }

// ---------- editable widget emitters (focused — editable sections are simple by construction) ----------
const dim = (n) => ({ unit: 'px', size: String(Math.round(n)) });
function nativeTypo(t) { const s = {}; if (!t || !(t.size || t.family)) return s; s.typography_typography = 'custom'; const gf = gFont(t.family); if (gf) s.typography_font_family = gf; if (t.size) s.typography_font_size = { unit: 'px', size: Math.round(t.size) }; if (t.weight && /^\d+$/.test(String(t.weight))) s.typography_font_weight = String(t.weight); const lh = px(t.lineHeight); if (lh) s.typography_line_height = { unit: 'px', size: Math.round(lh) }; const ls = px(t.letterSpacing); if (ls !== null && t.letterSpacing !== 'normal') s.typography_letter_spacing = { unit: 'px', size: +ls.toFixed(1) }; if (t.transform && t.transform !== 'none') s.typography_text_transform = t.transform; return s; }
const solidColor = (c) => (c && /^(#|rgb)/.test(c) && c !== 'rgba(0, 0, 0, 0)') ? c : null;
function leafToWidget(n) {
  if (n.kind === 'image') { if (!n.url) return null; const s = { image: { url: n.url }, image_size: 'full' }; if (n.box && n.box.w > 4) s.width = { unit: 'px', size: Math.round(n.box.w) }; return { elType: 'widget', widgetType: 'image', settings: s }; }
  const text = stripEmoji(n.text); if (!text) return null;
  const tc = solidColor(n.color);
  if (n.kind === 'heading') return { elType: 'widget', widgetType: 'heading', settings: { title: text, header_size: 'h' + Math.min(6, Math.max(1, n.level || 2)), ...nativeTypo(n.typo), ...(tc ? { title_color: tc } : {}), ...(n.align && n.align !== 'start' ? { align: n.align } : {}) } };
  if (n.kind === 'button') { if (n.btn && n.bg) { const s = { text, background_background: 'classic', background_color: n.bg, button_text_color: tc || '#ffffff', ...nativeTypo(n.typo) }; if (n.radius) s.border_radius = { unit: 'px', top: String(px(n.radius) || 6), right: String(px(n.radius) || 6), bottom: String(px(n.radius) || 6), left: String(px(n.radius) || 6), isLinked: true }; if (n.href) s.link = { url: n.href }; return { elType: 'widget', widgetType: 'button', settings: s }; } return { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<a${n.href ? ` href="${esc(n.href)}"` : ''}>${esc(text)}</a>`, ...nativeTypo(n.typo), ...(tc ? { text_color: tc } : {}) } }; }
  return { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<div>${esc(text)}</div>`, ...nativeTypo(n.typo), ...(tc ? { text_color: tc } : {}), ...(n.align && n.align !== 'start' ? { align: n.align } : {}) } };
}
// REVERTED cycle-2 (column-aware emitter): it raised editability but OVERFLOWED source band heights
// (column gaps/padding inflate past min_height → hRatio up to 1.86 → drift destroyed visual; corpus
// composite 0.595→0.477). Restored the simple row-flow + min-height pin (best measured = 0.595).
// Next: HEIGHT-FAITHFUL reconstruction (fit the band) before adding layout richness.
function buildEditableSection(sec) {
  const leaves = sec.leaves.slice().sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x));
  const rows = [];
  for (const lf of leaves) {
    const r = rows.find((row) => { const overlap = Math.min(row.y1, lf.box.y + lf.box.h) - Math.max(row.y0, lf.box.y); return overlap > Math.min(lf.box.h, row.y1 - row.y0) * 0.5; });
    if (r) { r.items.push(lf); r.y1 = Math.max(r.y1, lf.box.y + lf.box.h); } else rows.push({ y0: lf.box.y, y1: lf.box.y + lf.box.h, items: [lf] });
  }
  const widgets = [];
  for (const row of rows) {
    const items = row.items.sort((a, b) => a.box.x - b.box.x).map(leafToWidget).filter(Boolean);
    if (!items.length) continue;
    if (items.length === 1) { widgets.push(items[0]); continue; }
    const xs = row.items.map((i) => i.box.x); const spread = Math.max(...xs) - Math.min(...xs);
    const set = { content_width: 'full', flex_direction: 'row', flex_wrap: 'wrap', flex_gap: dim(16), flex_align_items: 'center', flex_justify_content: spread > W * 0.4 ? 'space-between' : 'flex-start', padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } };
    widgets.push({ elType: 'container', settings: set, elements: items });
  }
  const cx = sec.leaves.map((l) => l.box.x + l.box.w / 2); const meanCx = cx.reduce((a, b) => a + b, 0) / Math.max(1, cx.length);
  const centered = Math.abs(meanCx - W / 2) < W * 0.12;
  const set = { content_width: 'full', flex_direction: 'column', flex_gap: dim(12), flex_align_items: centered ? 'center' : 'flex-start', justify_content: 'center', min_height: { unit: 'px', size: Math.round(sec.h) }, padding: { unit: 'px', top: '24', right: '24', bottom: '24', left: '24', isLinked: false } };
  if (sec.bg) { set.background_background = 'classic'; set.background_color = sec.bg; }
  return { elType: 'container', settings: set, elements: widgets };
}

(async () => {
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 2, locale: 'en-US', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const page = await ctx.newPage();
  try { await page.goto(source, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await page.goto(source, { waitUntil: 'load', timeout: 60000 }); } catch {} }
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(1600);
  await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 240)); } window.scrollTo(0, 0); });
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  await page.waitForTimeout(800);

  // SECTION SPLIT + per-section content + classification
  const model = await page.evaluate((vw) => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; if (r.right < 0 || r.bottom < 0 || r.left > innerWidth + 60) return false; return true; };
    const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
    const typo = (cs) => ({ family: cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim(), size: Math.round(parseFloat(cs.fontSize)), weight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, transform: cs.textTransform });
    const pageH = document.documentElement.scrollHeight;
    // section cut tops = full-width block boundaries (same logic as section-raster)
    const ys = new Set([0]); for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.width >= vw * 0.82 && r.height >= 120 && r.top + scrollY >= 0) ys.add(Math.round(r.top + scrollY)); }
    const arr = [...ys].sort((a, b) => a - b); const cuts = []; for (const y of arr) { if (!cuts.length || y - cuts[cuts.length - 1] > 60) cuts.push(y); }
    const bounds = [...cuts.filter((y) => y < pageH), pageH];
    // collect candidate leaves once
    const opaque = (c) => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent';
    const leafEls = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,img,span,li')];
    const seen = new Set();
    const sections = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const y0 = bounds[i], y1 = bounds[i + 1]; const mid = (y0 + y1) / 2; const secH = y1 - y0;
      const leaves = []; let mediaArea = 0, textChars = 0, linkCount = 0, bigCanvas = false; let bgColor = null;
      // section bg: the full-width element starting at y0
      for (const e of document.querySelectorAll('body *')) { const r = rectOf(e); if (Math.abs(r.y - y0) < 6 && r.w >= vw * 0.82 && r.h >= secH * 0.6) { const c = getComputedStyle(e).backgroundColor; if (opaque(c)) { bgColor = c; break; } } }
      for (const e of document.querySelectorAll('canvas, video')) { const r = rectOf(e); if (r.y + r.h / 2 >= y0 && r.y + r.h / 2 < y1 && r.w > 200 && r.h > 150) bigCanvas = true; }
      for (const el of leafEls) {
        if (!vis(el)) continue; const box = rectOf(el); const cy = box.y + box.h / 2; if (cy < y0 || cy >= y1) continue;
        const tag = el.tagName.toLowerCase(); const cs = getComputedStyle(el);
        if (tag === 'img') { const src = el.currentSrc || el.src; if (src && !src.startsWith('data:') && box.w >= 24 && box.h >= 24) { mediaArea += box.w * box.h; if (box.w >= 40 && box.h >= 40) leaves.push({ kind: 'image', src, box, alt: el.alt || '' }); } continue; }
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && clean(n.textContent)); if (!own) continue;
        const t = clean(el.innerText || el.textContent); if (!t || t.length > 300) continue; if (parseFloat(cs.fontSize) < 11) continue;
        const dk = t + '@' + Math.round(box.y / 8); if (seen.has(dk)) continue; seen.add(dk);
        const isH = /^h[1-6]$/.test(tag), isBtn = tag === 'a' || tag === 'button';
        if (isBtn) linkCount++;
        textChars += t.length;
        const btnBg = isBtn && opaque(cs.backgroundColor);
        leaves.push({ kind: isH ? 'heading' : (isBtn ? 'button' : 'text'), level: isH ? +tag[1] : null, text: t, href: isBtn && el.href ? el.href : null, typo: typo(cs), color: cs.color, align: cs.textAlign, btn: btnBg, bg: btnBg ? cs.backgroundColor : null, radius: cs.borderTopLeftRadius, box });
      }
      const secArea = vw * secH; const mediaFrac = secArea ? mediaArea / secArea : 0;
      const textLeaves = leaves.filter((l) => l.kind !== 'image').length;
      const isNav = i === 0 && secH <= 160 && linkCount >= 3;
      const isFooter = i === bounds.length - 2 && linkCount >= 6;
      // EDITABLE if text-dominant + low media + no big canvas; else RASTER. nav/footer forced editable.
      let kind = 'raster', reason = '';
      // Conservative: editable ONLY when genuinely simple (raster is 1:1, so when in doubt raster).
      // Cap leaf count + section height — dense/tall sections (logo walls, rich showcases) reconstruct
      // poorly via naive flow, so they stay raster. nav/footer are always worth recovering as editable.
      if (bigCanvas) { kind = 'raster'; reason = 'canvas/video'; }
      else if (isNav) { kind = 'editable'; reason = 'nav'; }
      else if (isFooter && textLeaves <= 80) { kind = 'editable'; reason = 'footer'; }
      // CYCLE-1 (corpus lever #1 = editability): loosen so more TEXT-dominant sections go native. Gate on
      // mediaFrac (actual image area) not leaf count/height — a 243-leaf text section with low media IS
      // text-dominant and worth recovering. The corpus grader measures whether the native emitter can
      // handle the denser sections (editability↑) without visual collapse; keep only if composite rises.
      else if (textLeaves >= 2 && mediaFrac < 0.5 && secH <= 2600) { kind = 'editable'; reason = `text${textLeaves}/media${mediaFrac.toFixed(2)}/h${secH}`; }
      else reason = `media${mediaFrac.toFixed(2)}/text${textLeaves}/h${secH}`;
      sections.push({ i, y0, y1, h: secH, kind, reason, bg: bgColor, textLeaves, mediaFrac: +mediaFrac.toFixed(2), linkCount, leaves: kind === 'editable' ? leaves : [] });
    }
    return { vw: innerWidth, pageH, sections };
  }, W);

  // full-page screenshot for raster sections
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
  const shot = PNG.sync.read(await page.screenshot({ fullPage: true })); const dpr = shot.width / W;
  fs.writeFileSync(`/tmp/hybrid-src-${srcTag}.png`, PNG.sync.write(dpr > 1 ? downscale(shot, Math.round(dpr)) : shot));
  await browser.close();

  console.log(`sections: ${model.sections.length} | pageH ${model.pageH}`);
  for (const s of model.sections) console.log(`  [${s.i}] y${s.y0}-${s.y1} (${s.h}px) → ${s.kind.toUpperCase()} (${s.reason})`);

  // build each section
  const MAXH = 2400; const elements = []; let editCount = 0, rastCount = 0, rastImgs = 0;
  for (const sec of model.sections) {
    const editEl = (sec.kind === 'editable' && sec.leaves.length) ? buildEditableSection(sec) : null;
    if (editEl) {
      elements.push(editEl); editCount++;
    } else {
      if (sec.kind === 'editable') sec.kind = 'raster'; // emitter produced nothing → fall back to raster
      // raster: slice band, downscale, split >2400, upload
      const y0d = Math.round(sec.y0 * dpr), y1d = Math.round(sec.y1 * dpr); const hd = y1d - y0d; if (hd < 20) continue;
      const full = new PNG({ width: shot.width, height: hd });
      for (let r = 0; r < hd; r++) { const s = ((y0d + r) * shot.width) * 4; shot.data.copy(full.data, (r * shot.width) * 4, s, s + shot.width * 4); }
      const out = dpr > 1 ? downscale(full, Math.round(dpr)) : full;
      const subCount = Math.ceil(out.height / MAXH);
      for (let sIdx = 0; sIdx < subCount; sIdx++) {
        const sy = sIdx * MAXH, sh = Math.min(MAXH, out.height - sy); let sub = out;
        if (subCount > 1) { sub = new PNG({ width: out.width, height: sh }); for (let r = 0; r < sh; r++) { const s = ((sy + r) * out.width) * 4; out.data.copy(sub.data, (r * out.width) * 4, s, s + out.width * 4); } }
        if (DRY) { rastImgs++; continue; }
        const url = await uploadPng(PNG.sync.write(sub), `hyb-${sec.i}-${sIdx}-${Date.now()}.png`);
        if (url) { elements.push({ elType: 'widget', widgetType: 'image', settings: { image: { url }, image_size: 'full', width: { unit: '%', size: 100 } } }); rastImgs++; }
        await new Promise((r) => setTimeout(r, 180));
      }
      rastCount++;
    }
  }
  console.log(`built: ${editCount} editable sections, ${rastCount} raster sections (${rastImgs} imgs)`);
  const zeroPad = { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true };
  const root = { elType: 'container', settings: { content_width: 'full', flex_direction: 'column', flex_gap: dim(0), padding: zeroPad, _padding: zeroPad }, elements };
  if (DRY) { fs.writeFileSync('/tmp/hybrid-tree.json', JSON.stringify(root, null, 2)); const cnt = (e) => 1 + (e.elements || []).reduce((a, c) => a + cnt(c), 0); console.log(`DRY → /tmp/hybrid-tree.json (${cnt(root)} elements)`); return; }

  const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'hybrid-' + Date.now() };
  let r, txt, expected = (await (await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { headers })).json()).elementor?.hash;
  for (let a = 0; a < 5; a++) { const body = { expected_hash: expected, elements: [root], page_settings: {}, title: 'Hybrid clone', intent: 'hybrid editable+raster' }; r = await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { method: 'PUT', headers, body: JSON.stringify(body) }); txt = await r.text(); if (r.status !== 409) break; try { expected = JSON.parse(txt).details.current_hash; } catch {} console.log(`PUT 409 — retry with ${expected}`); await new Promise((s) => setTimeout(s, 400)); }
  console.log('PUT', r.status, txt.slice(0, 100));
  // _elementor_edit_mode=builder so the FRONTEND renders the Elementor tree (styled, editable) instead of
  // the raw post_content fallback (which left editable sections unstyled/blank).
  try { await fetch(`${base}/wp-json/wp/v2/pages/${pageId}`, { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json' }, body: JSON.stringify({ meta: { _elementor_edit_mode: 'builder' } }) }); console.log('set edit_mode=builder'); } catch (e) { console.log('edit_mode set failed', e.message); }
  console.log('PAGE:', `${base}/?page_id=${pageId}`);
})();
