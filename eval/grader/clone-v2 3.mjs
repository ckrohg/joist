#!/usr/bin/env node
/**
 * @purpose v2 cloner (CLONE_CAPABILITY_SPEC "Revised Approach v2"). Faithful 1:1 capture +
 * rasterize-unrepresentable + clean Elementor emit. WRITE-FRUGAL: by default it captures,
 * crops rasters by bbox from ONE full-page 2× screenshot, renders a LOCAL preview, and
 * screenshots it for verification — ZERO server writes. Pass --deploy to upload + build the
 * live Elementor page (only once converged).
 *
 * Env: JOIST_BASE, JOIST_AUTH_B64.
 * Usage: node clone-v2.mjs --source <url> [--max-h 1800] [--deploy --title "..."]
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'fs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const base = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
const b64 = process.env.JOIST_AUTH_B64;
const source = arg('source'); if (!source) { console.error('need --source'); process.exit(2); }
const title = arg('title', 'Clone v2'); const maxH = parseInt(arg('max-h', '1800'), 10); const DEPLOY = has('deploy');
const W = 1440, DPR = 2;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const px = (s) => { const m = String(s).match(/(-?\d+(?:\.\d+)?)px/); return m ? +m[1] : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dimv = (n) => ({ unit: 'px', size: String(Math.round(n)), sizes: [] });
fs.rmSync('v2-rasters', { recursive: true, force: true }); fs.mkdirSync('v2-rasters', { recursive: true });

// crop a box (CSS px) out of a DPR-scaled full-page PNG
function cropBox(full, box) {
  const x = Math.max(0, Math.round(box.x * DPR)), y = Math.max(0, Math.round(box.y * DPR));
  const w = Math.min(full.width - x, Math.round(box.w * DPR)), h = Math.min(full.height - y, Math.round(box.h * DPR));
  if (w < 2 || h < 2) return null;
  const o = new PNG({ width: w, height: h });
  for (let r = 0; r < h; r++) { const s = ((y + r) * full.width + x) * 4; full.data.copy(o.data, (r * w) * 4, s, s + w * 4); }
  return o;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: DPR });
  const page = await ctx.newPage();
  const fontUrls = new Set();
  page.on('response', (r) => { const u = r.url(); if (/\.woff2(\?|$)/i.test(u)) fontUrls.add(u.split('?')[0]); });
  try { await page.goto(source, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await page.goto(source, { waitUntil: 'load', timeout: 60000 }); } catch {} }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(2000);
  await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 160)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(800);
  try { await page.evaluate(() => document.fonts.ready); } catch {}

  const cap = await page.evaluate((maxH) => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const fam = (s) => (s || '').split(',')[0].replace(/['"]/g, '').trim();
    const vis = (el) => { try { if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false; } catch {} const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && r.width > 2 && r.height > 2 && (r.top + scrollY) < maxH; };
    const ownText = (el) => { for (const n of el.childNodes) if (n.nodeType === 3 && clean(n.textContent)) return true; return false; };
    const isGradText = (s) => { const clip = s.getPropertyValue('-webkit-background-clip') || s.backgroundClip; return clip.includes('text') || /gradient/.test(s.backgroundImage); };
    const mustRaster = (el, cs) => { if (isGradText(cs)) return true; for (const c of el.querySelectorAll('*')) if (isGradText(getComputedStyle(c))) return true; return false; };
    const leaves = []; const seen = new Set();
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,a,button,span,img,svg')) {
      if (!vis(el)) continue; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); const tag = el.tagName.toLowerCase();
      const box = { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
      if (tag === 'img') { const src = el.currentSrc || el.src; if (!src || src.startsWith('data:') || r.width < 24) continue; if (seen.has('i' + src + box.y)) continue; seen.add('i' + src + box.y); leaves.push({ type: 'image', src, box }); continue; }
      if (tag === 'svg') { if (r.width < 16) continue; leaves.push({ type: 'raster', box }); continue; }
      const isH = /^h[1-6]$/.test(tag), isBtn = tag === 'a' || tag === 'button';
      if (!isH && !isBtn && !ownText(el)) continue;
      const t = clean(el.innerText || el.textContent); if (!t || t.length > 300) continue;
      const k = tag + t.toLowerCase() + Math.round(box.y / 4); if (seen.has(k)) continue; seen.add(k);
      if (!isH && !isBtn && parseFloat(cs.fontSize) < 11) continue;
      const bigText = parseFloat(cs.fontSize) >= 30; // display text → rasterize for fidelity (gradient/effects can't be read)
      if (bigText || mustRaster(el, cs)) { leaves.push({ type: 'raster', box }); continue; }
      leaves.push({ type: isH ? 'heading' : (isBtn ? 'button' : 'text'), tag, level: isH ? +tag[1] : null, text: t, href: isBtn && el.href ? el.href : null, box, color: cs.color, family: fam(cs.fontFamily), size: Math.round(parseFloat(cs.fontSize)), weight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, align: cs.textAlign });
    }
    const bands = [];
    for (const el of document.querySelectorAll('section,header,footer,main,div')) { if (!vis(el)) continue; const r = el.getBoundingClientRect(); const top = r.top + scrollY; if (r.width < innerWidth * 0.85 || r.height < 120 || r.height > 9000 || top > maxH) continue; const cs = getComputedStyle(el); if (!cs.backgroundColor || cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none') continue; if (bands.some((b) => Math.abs(b.y - top) < 8)) continue; bands.push({ y: Math.round(top), h: Math.round(r.height), bg: cs.backgroundColor }); }
    const fonts = []; try { document.fonts.forEach((f) => { if (f.status === 'loaded') fonts.push({ family: f.family.replace(/['"]/g, '') }); }); } catch {}
    return { pageH: Math.min(document.documentElement.scrollHeight, maxH), pageBg: getComputedStyle(document.body).backgroundColor, leaves, bands, fonts };
  }, maxH);

  // ONE full-page screenshot @2×; crop every raster by bbox (robust, fast)
  const full = PNG.sync.read(await page.screenshot({ fullPage: true }));
  let rasterN = 0;
  for (const l of cap.leaves) { if (l.type !== 'raster') continue; const c = cropBox(full, l.box); if (!c) { l.skip = true; continue; } l.file = `v2-rasters/r${rasterN}.png`; fs.writeFileSync(l.file, PNG.sync.write(c)); rasterN++; }
  await browser.close();
  const rasters = cap.leaves.filter((l) => l.type === 'raster' && !l.skip).length;
  console.log(`captured ${cap.leaves.length} leaves | ${rasters} rasters cropped by bbox | ${cap.bands.length} bands | ${cap.fonts.length} fonts | pageH ${cap.pageH}`);

  // ---- LOCAL PREVIEW (write-free verification) ----
  const fontFaceLocal = [...fontUrls].map((u, i) => `@font-face{font-family:'cf${i}';src:url('${u}') format('woff2')}`).join('\n');
  // map captured families to a loaded cf alias by NFD base-name
  const baseN = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '').replace(/(var|variable|regular|medium|bold|woff2|font)$/g, '');
  const fileNames = [...fontUrls].map((u) => u.split('/').pop());
  const famAlias = {}; for (const f of cap.fonts) { const fb = baseN(f.family); const idx = fileNames.findIndex((fn) => { const xb = baseN(fn); return xb.slice(0, 5) && (xb.includes(fb.slice(0, 5)) || fb.includes(xb.slice(0, 5))); }); if (idx >= 0) famAlias[f.family] = 'cf' + idx; }
  let body = '';
  for (const b of cap.bands) body += `<div style="position:absolute;left:0;top:${b.y}px;width:${W}px;height:${b.h}px;background:${b.bg};z-index:0"></div>`;
  for (const l of cap.leaves) {
    const at = `position:absolute;left:${l.box.x}px;top:${l.box.y}px;`;
    if (l.type === 'image') { body += `<img src="${esc(l.src)}" style="${at}width:${l.box.w}px;height:${l.box.h}px;z-index:1">`; continue; }
    if (l.type === 'raster') { if (l.skip) continue; body += `<img src="${l.file}" style="${at}width:${l.box.w}px;height:${l.box.h}px;z-index:2">`; continue; }
    const lh = px(l.lineHeight); const fam = famAlias[l.family] || l.family;
    const fs2 = `font-family:'${fam}',sans-serif;font-size:${l.size}px;font-weight:${parseInt(l.weight) || 400};${lh ? `line-height:${lh}px;` : ''}${px(l.letterSpacing) !== null && l.letterSpacing !== 'normal' ? `letter-spacing:${px(l.letterSpacing)}px;` : ''}color:${l.color};`;
    body += `<div style="${at}width:${l.box.w + 4}px;${fs2}z-index:2;text-align:${l.align && l.align !== 'start' ? l.align : 'left'}">${l.type === 'button' ? `<a style="color:${l.color};text-decoration:none">${esc(l.text)}</a>` : esc(l.text)}</div>`;
  }
  const html = `<!doctype html><meta charset=utf8><style>${fontFaceLocal}\n*{margin:0;box-sizing:border-box}body{position:relative;width:${W}px;height:${cap.pageH}px;background:${cap.pageBg};overflow:hidden}</style><body>${body}</body>`;
  fs.writeFileSync('v2-preview.html', html);

  // screenshot the local preview + verify green
  const b2 = await chromium.launch();
  const p2 = await (await b2.newContext({ viewport: { width: W, height: Math.min(900, cap.pageH) }, deviceScaleFactor: 1 })).newPage();
  await p2.goto('file://' + process.cwd() + '/v2-preview.html', { waitUntil: 'networkidle' });
  await p2.waitForTimeout(2000);
  await p2.screenshot({ path: 'v2-preview.png', clip: { x: 0, y: 0, width: W, height: Math.min(760, cap.pageH) } });
  const greens = await p2.evaluate(() => [...document.querySelectorAll('div,a,span')].filter((e) => getComputedStyle(e).color === 'rgb(129, 184, 26)' && (e.innerText || '').trim().length > 3).length);
  await b2.close();
  console.log(`LOCAL preview → v2-preview.png | green-fallback text elements: ${greens} (target 0) | rasters: ${rasters}`);
  if (!DEPLOY) { console.log('(write-free local mode; pass --deploy to publish)'); return; }

  // ---- DEPLOY (only with --deploy): upload crops+fonts, build clean Elementor, publish ----
  const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'agent-v2' };
  async function jp(method, path, bodyj) { for (let a = 0; a < 14; a++) { const r = await fetch(base + path, { method, headers, body: bodyj ? JSON.stringify(bodyj) : undefined }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { j = {}; } if (r.status === 429) { await sleep(Math.max((j.details?.retry_after || 2), (a + 1) * 3) * 1000 + 500); continue; } if (!r.ok) console.error(method, path, r.status, JSON.stringify(j).slice(0, 140)); return { status: r.status, j }; } return { status: 429, j: {} }; }
  async function up(buf, name, type) { const r = await fetch(base + '/wp-json/wp/v2/media', { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"` }, body: buf }); const j = await r.json(); return r.ok ? j.source_url : null; }
  console.log('uploading rasters + fonts…');
  for (const l of cap.leaves) { if (l.type === 'raster' && !l.skip && l.file) { l.url = await up(fs.readFileSync(l.file), l.file.split('/').pop(), 'image/png'); await sleep(150); } }
  const fontHosted = {}; for (const u of [...fontUrls]) { try { const r = await fetch(u); if (r.ok) { const url = await up(Buffer.from(await r.arrayBuffer()), u.split('/').pop(), 'font/woff2'); if (url) fontHosted[u.split('/').pop()] = url; await sleep(300); } } catch {} }
  const css = []; for (const f of cap.fonts) { const fb = baseN(f.family); const fn = Object.keys(fontHosted).find((n) => { const xb = baseN(n); return xb.slice(0, 5) && (xb.includes(fb.slice(0, 5)) || fb.includes(xb.slice(0, 5))); }); if (fn) css.push(`@font-face{font-family:'${f.family}';src:url('${fontHosted[fn]}') format('woff2');font-weight:100 900;font-display:swap}`); }
  const SCOPE = 'czv2';
  css.push(`#${SCOPE}{position:relative !important;height:${cap.pageH}px;background:${cap.pageBg};overflow:hidden}`, `#${SCOPE} .elementor-widget-container{padding:0 !important;margin:0 !important}`, `#${SCOPE} .elementor-element{position:absolute !important;margin:0 !important}`, `#${SCOPE} .czimg img{width:100% !important;height:100% !important;object-fit:fill;display:block}`);
  const widgets = []; let n = 0;
  const place = (box, z, w) => { const cls = `czn-${n++}`; css.push(`.${cls}{left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;z-index:${z}}`); w.settings._css_classes = ((w.settings._css_classes || '') + ' ' + cls).trim(); widgets.push(w); };
  for (const b of cap.bands) place({ x: 0, y: b.y, w: W, h: b.h }, 0, { elType: 'widget', widgetType: 'html', settings: { html: `<div style="width:100%;height:100%;background:${b.bg}"></div>` } });
  for (const l of cap.leaves) {
    if (l.type === 'image') { place(l.box, 1, { elType: 'widget', widgetType: 'image', settings: { image: { url: l.src }, image_size: 'full', _css_classes: 'czimg' } }); continue; }
    if (l.type === 'raster') { if (!l.url) continue; place(l.box, 2, { elType: 'widget', widgetType: 'image', settings: { image: { url: l.url }, image_size: 'full', _css_classes: 'czimg' } }); continue; }
    const lh = px(l.lineHeight); const typo = { typography_typography: 'custom', typography_font_family: l.family, typography_font_size: dimv(l.size), typography_line_height: lh ? { unit: 'px', size: String(lh), sizes: [] } : { unit: 'em', size: 1.2, sizes: [] } }; if (/^\d+$/.test(l.weight)) typo.typography_font_weight = String(l.weight); if (px(l.letterSpacing) !== null && l.letterSpacing !== 'normal') typo.typography_letter_spacing = { unit: 'px', size: String(px(l.letterSpacing)), sizes: [] };
    if (l.type === 'heading') place(l.box, 2, { elType: 'widget', widgetType: 'heading', settings: { title: l.text, header_size: 'h' + Math.min(6, Math.max(1, l.level)), title_color: l.color, ...typo } });
    else place(l.box, 2, { elType: 'widget', widgetType: 'text-editor', settings: { editor: l.type === 'button' ? `<a${l.href ? ` href="${esc(l.href)}"` : ''} style="color:${l.color};text-decoration:none">${esc(l.text)}</a>` : `<div>${esc(l.text)}</div>`, text_color: l.color, ...typo } });
  }
  const container = (settings, elements = []) => ({ elType: 'container', settings, elements });
  const root = container({ content_width: 'full', _element_id: SCOPE, padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } }, [{ elType: 'widget', widgetType: 'html', settings: { html: `<style>\n${css.join('\n')}\n</style>` } }, ...widgets]);
  console.log(`deploying: ${widgets.length} widgets`);
  const create = await jp('POST', '/wp-json/joist/v1/plans', { intent: 'clone v2', title, page_id: 0, steps: [{ op: 'insert', parent_id: 'root', position: 0, element: root }] });
  const planId = create.j.plan_id, token = create.j.approval_token; if (!planId) { console.error('create failed'); return; }
  await sleep(3000); await jp('POST', `/wp-json/joist/v1/plans/${planId}/approve`, { approval_token: token });
  await sleep(3000); const ex = await jp('POST', `/wp-json/joist/v1/plans/${planId}/execute`, {}); console.log('execute ->', ex.status);
  await sleep(2000); const g = await jp('GET', `/wp-json/joist/v1/plans/${planId}`, null); const pg = await jp('GET', `/wp-json/wp/v2/pages/${g.j.page_id}?context=edit`, null);
  console.log('PAGE_URL:', pg.j.link || '(page ' + g.j.page_id + ')');
})();
