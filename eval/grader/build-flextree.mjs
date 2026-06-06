#!/usr/bin/env node
/**
 * @purpose Wave 2 of the layout re-architecture (LAYOUT_REARCHITECTURE.md). Maps the DOM box-tree
 * from capture-layout.mjs into a NATIVE Elementor flex/grid container tree — flow layout, NO
 * absolute positioning. This is the fix for S1 (text collision): text lives in flowed flex
 * children, not pinned at captured coords. Containers carry their real flex props + backgrounds.
 *
 * Reuses the proven asset pipeline (uploadImage sized+alt+dedup, uploadFont) + gc-class styling +
 * <details> disclosures + hover keys + painted colors. Schema-discipline: container keys are the
 * same proven flex_* keys build-ir-elementor used; border/shadow/gradient go via injected #id CSS
 * (containers aren't schema-validated, but injected CSS is the reliable path).
 *
 * Env: JOIST_BASE, JOIST_AUTH_B64.  Usage: node build-flextree.mjs --layout layout.json [--page id] [--dry]
 */
import fs from 'fs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const base = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
const b64 = process.env.JOIST_AUTH_B64; if (!b64) { console.error('missing JOIST_AUTH_B64'); process.exit(2); }
const L = JSON.parse(fs.readFileSync(arg('layout', 'layout.json'), 'utf8'));
const title = arg('title', 'Flex-tree clone');
const VW = L.vw || 1440;
// FRESH session id per run — the rate-limit bucket is PER-SESSION; the old fixed 'agent-flextree'
// bucket got stuck/exhausted (1h of no writes still 429'd). A new session = a fresh full bucket.
const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'agent-flextree-' + Date.now() };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Strip emoji: WordPress's wp-emoji rewrites emoji CHARACTERS in our text into <img class="wp-smiley">,
// which — lacking the wp-smiley sizing CSS on this theme — fills the full-width widget (a 1300px giant
// emoji on picocss.com). We don't author emoji as images, so drop the glyphs; an emoji-only run → null.
const stripEmoji = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '').replace(/\s+/g, ' ').trim();
const px = (s) => { const m = String(s || '').match(/(-?\d+(?:\.\d+)?)px/); return m ? +m[1] : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dim = (n) => ({ unit: 'px', size: String(Math.round(n)) });
const container = (settings, elements = []) => ({ elType: 'container', settings, elements });
const opaque = (c) => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent' && !/,\s*0\)\s*$/.test(c);
const radiusDim = (s) => { const n = px(s) || 0; return { unit: 'px', top: String(n), right: String(n), bottom: String(n), left: String(n), isLinked: true }; };
const padDim = (arr) => { if (!arr) return null; const [t, r, b, l] = arr.map((v) => Math.round(px(v) || 0)); if (t + r + b + l === 0) return null; return { unit: 'px', top: String(t), right: String(r), bottom: String(b), left: String(l), isLinked: false }; };

// ---------- asset pipeline (reused from build-ir-elementor) ----------
const IMG_CACHE = '/tmp/joist-imgcache.json'; let imgMap = {}; try { imgMap = JSON.parse(fs.readFileSync(IMG_CACHE, 'utf8')); } catch {}
const mimeOf = (u) => { const e = (u.split('?')[0].split('.').pop() || '').toLowerCase(); return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' })[e] || 'image/jpeg'; };
async function uploadImage(url, alt) { if (!url || url.startsWith('data:')) return; if (imgMap[url] && imgMap[url].full) return; try { let buf; if (url.startsWith('/')) { buf = fs.readFileSync(url); } else { const r = await fetch(url); if (!r.ok) { imgMap[url] = { full: url, large: url }; return; } buf = Buffer.from(await r.arrayBuffer()); } const name = (url.split('/').pop().split('?')[0] || 'img') + (/\.[a-z0-9]+$/i.test(url.split('?')[0]) ? '' : '.jpg'); const up = await fetch(base + '/wp-json/wp/v2/media', { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': mimeOf(url), 'Content-Disposition': `attachment; filename="${name}"` }, body: buf }); const j = await up.json(); if (!up.ok || !j.source_url) { imgMap[url] = { full: url, large: url }; return; } const sizes = (j.media_details && j.media_details.sizes) || {}; const large = (sizes.large && sizes.large.source_url) || (sizes.medium_large && sizes.medium_large.source_url) || j.source_url; if (alt && j.id) { try { await fetch(base + '/wp-json/wp/v2/media/' + j.id, { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json' }, body: JSON.stringify({ alt_text: alt }) }); } catch {} } imgMap[url] = { id: j.id, full: j.source_url, large }; } catch { imgMap[url] = { full: url, large: url }; } }
async function uploadFont(url, name) { try { const r = await fetch(url); if (!r.ok) return null; const buf = Buffer.from(await r.arrayBuffer()); const up = await fetch(base + '/wp-json/wp/v2/media', { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': 'font/woff2', 'Content-Disposition': `attachment; filename="${name}"` }, body: buf }); const j = await up.json(); return up.ok ? j.source_url : null; } catch { return null; } }
const baseName = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '').replace(/(var|variable|regular|book|medium|bold|woff2?|font)$/g, '');
const rec = (src) => imgMap[src] || { full: src, large: src };
const localSrc = (s) => rec(s).full, localBg = (s) => rec(s).large, localId = (s) => rec(s).id;
// S8: best raster (rasterized canvas/gradient) whose box tightly matches this container's box
const iou = (a, b) => { const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)); const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)); const i = ix * iy, u = a.w * a.h + b.w * b.h - i; return u > 0 ? i / u : 0; };
function rasterFor(box) { let best = null, bi = 0.55; for (const r of (L.rasters || [])) { const o = iou(box, r.box); if (o > bi) { bi = o; best = r; } } return best ? rec(best.file).full : null; }

// ---------- gc style-classes (font/size/weight/lh/ls/align/color) keyed by signature ----------
const css = []; let fontFaces = ''; const gcIndex = new Map(); const gcList = [];
function classFor(leaf) {
  const t = leaf.typo || {}; const sig = JSON.stringify({ f: t.family, s: t.size, w: t.weight, lh: t.lineHeight, ls: t.letterSpacing, al: t.align, tr: t.transform, p: leaf.paint });
  if (!gcIndex.has(sig)) { gcIndex.set(sig, gcList.length); gcList.push({ id: 'fc-' + gcList.length, typo: t, paint: leaf.paint }); }
  return 'fc-' + gcIndex.get(sig);
}
function emitGcCss(fontMap) {
  for (const g of gcList) {
    const t = g.typo || {}; const sel = `.${g.id}`; const inner = `${sel} .elementor-widget-container, ${sel} .elementor-heading-title, ${sel} .elementor-button, ${sel} p, ${sel} a, ${sel} span`;
    let r = `font-family:'${fontMap(t.family) || t.family}',-apple-system,sans-serif !important;`;
    if (t.size) r += `font-size:${t.size}px !important;`;
    if (t.weight && /^\d+$/.test(t.weight)) r += `font-weight:${t.weight} !important;`;
    const lh = px(t.lineHeight); if (lh) r += `line-height:${lh}px !important;`;
    const ls = px(t.letterSpacing); if (ls !== null && t.letterSpacing !== 'normal') r += `letter-spacing:${ls}px !important;`;
    if (t.align && t.align !== 'start') r += `text-align:${t.align} !important;`;
    if (t.transform && t.transform !== 'none') r += `text-transform:${t.transform} !important;`;
    if (g.paint && g.paint.kind === 'gradient-text') css.push(`${inner}{${r}background:${g.paint.value} !important;-webkit-background-clip:text !important;background-clip:text !important;-webkit-text-fill-color:transparent !important;color:transparent !important}`);
    else css.push(`${inner}{${r}color:${(g.paint && g.paint.value) || 'inherit'} !important}`);
  }
}

// Map a captured (often custom/licensed) font family to the nearest font Elementor LOADS natively.
// CRITICAL: the @font-face for custom fonts was injected via a <style> block that wp_kses STRIPS on
// save — so custom names ('sohne-var') never load. Google-font names set via typography_font_family
// ARE auto-loaded by Elementor with NO <style> needed. Stripe is all Söhne (a grotesque sans) → Inter.
function gFont(fam) {
  const b = (fam || '').toLowerCase(); if (!b) return null;
  if (/tiempos|times|georgia|garamond|serif/.test(b)) return 'Georgia';
  if (/mono|code|courier|consolas/.test(b)) return 'Roboto Mono';
  return 'Inter'; // sohne/söhne/ideal-sans/system sans → Inter (closest free grotesque)
}
// Native, sanitization-proof, EDITABLE typography for a text/heading/button leaf (replaces the
// stripped <style> gc-class stylesheet). size/weight/lh/ls/color need NO font file → always works.
function nativeTypo(n) {
  const t = n.typo || {}; const s = {};
  if (!(t.size || t.family)) return s;
  s.typography_typography = 'custom';
  const gf = gFont(t.family); if (gf) s.typography_font_family = gf;
  if (t.size) s.typography_font_size = { unit: 'px', size: Math.round(t.size) };
  if (t.weight && /^\d+$/.test(t.weight)) s.typography_font_weight = String(t.weight);
  const lh = px(t.lineHeight); if (lh) s.typography_line_height = { unit: 'px', size: Math.round(lh) };
  const ls = px(t.letterSpacing); if (ls !== null && t.letterSpacing !== 'normal') s.typography_letter_spacing = { unit: 'px', size: +ls.toFixed(1) };
  if (t.transform && t.transform !== 'none') s.typography_text_transform = t.transform;
  if (t.align && t.align !== 'start') s.align = t.align;
  return s;
}
// solid text color for a leaf (gradient-text → its fallback solid; native can't do gradient fill)
const textColorOf = (n) => (n.paint && n.paint.value && n.paint.kind !== 'gradient-text' && /^(#|rgb)/.test(n.paint.value)) ? n.paint.value : null;

// ---------- leaf → widget ----------
function leafWidget(n, parentIsRow) {
  // ACCORDION → native <details> group: clickable (revives the interaction layer) and works WITHOUT
  // CSS (so it survives the kses <style> strip). Collapsed by default (open only the source-open item)
  // → faithful one-at-a-time behavior.
  if (n.kind === 'accordion') {
    const html = (n.items || []).map((it) => {
      const inner = (it.content || []).map((c) => c.href ? `<a href="${esc(c.href)}">${esc(c.text)}</a>` : `<p>${esc(c.text)}</p>`).join('');
      return `<details class="cfx-acc"${it.open ? ' open' : ''}><summary>${esc(it.summary)}</summary><div class="cfx-acc-panel">${inner}</div></details>`;
    }).join('');
    return { elType: 'widget', widgetType: 'html', settings: { html } };
  }
  // CODE BLOCK → monospace <pre>. white-space:pre-wrap preserves newlines + wraps long lines (no overflow);
  // a <pre> keeps newlines even if kses strips white-space. Safe style props (bg/padding/font) survive.
  if (n.kind === 'code') {
    const fs = (n.typo && n.typo.size) || 14; const bg = opaque(n.bg) ? n.bg : '#f6f8fa';
    const style = `white-space:pre-wrap;word-break:break-word;overflow-x:auto;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:${fs}px;line-height:1.5;background:${bg};color:#24292f;padding:16px;border-radius:${n.radius && n.radius !== '0px' ? n.radius : '8px'};margin:0`;
    return { elType: 'widget', widgetType: 'html', settings: { html: `<pre style="${style}">${esc(n.text || '')}</pre>` } };
  }
  if (n.kind === 'heading' || n.kind === 'text' || n.kind === 'button') {
    const ct = stripEmoji(n.text);
    if (!ct) return null; // emoji-only run (WP balloons it to a giant wp-smiley img) → drop
    if (ct !== n.text) n = { ...n, text: ct };
  }
  const gc = (n.kind === 'heading' || n.kind === 'text' || n.kind === 'button') ? classFor(n) : null;
  // Leaf widgets default to FULL container width — inside a flex ROW that makes each item span the row
  // and wrap to its own line (the nav stacked vertically: Products/Solutions/… each on a line). In a row,
  // size to content (_flex_size:'none' = flex:0 0 auto) so items sit side by side.
  const C = { ...(gc ? { _css_classes: gc } : {}), ...(parentIsRow ? { _flex_size: 'none' } : {}) };
  // constrain images to the CAPTURED DISPLAY box — image_size:full renders NATURAL size (dpr-2 rasters
  // are 2x display → doubled the page height). Inject #id img{width/height} = source display dims.
  // NATIVE image display width (the #id img{width/height} CSS was kses-STRIPPED → images fell back to
  // natural size). Image widget `width` (px) constrains display; height follows aspect (rasters bake the
  // captured aspect). object-fit/exact-height aren't native controls — acceptable vs the stripped path.
  const imgSize = () => { if (!n.box || !(n.box.w > 4)) return {}; const s = { width: { unit: 'px', size: Math.round(n.box.w) } }; if (n.radius && n.radius !== '0px') s.image_border_radius = radiusDim(n.radius); return s; };
  if (n.kind === 'image') { const id = localId(n.src); const img = id ? { url: localSrc(n.src), id } : { url: localSrc(n.src), alt: n.alt || '' }; return { elType: 'widget', widgetType: 'image', settings: { image: img, image_size: 'full', ...imgSize(), ...C } }; }
  if (n.kind === 'svg') { // S6: rendered-raster (correct color) instead of raw outerHTML (which goes black); SKIP = blank/decorative
    if (n.raster === 'SKIP') return null;
    if (n.raster) { return { elType: 'widget', widgetType: 'image', settings: { image: { url: localSrc(n.raster) }, image_size: 'full', ...imgSize(), ...C } }; }
    return { elType: 'widget', widgetType: 'html', settings: { html: n.svg || '', ...C } };
  }
  // MOCKUP: a region-captured composite-media subtree (dashboard/card/promo) → ONE image at its box width.
  if (n.kind === 'mockup') { if (!n.raster || n.raster === 'SKIP') return null; return { elType: 'widget', widgetType: 'image', settings: { image: { url: localSrc(n.raster) }, image_size: 'full', ...imgSize(), ...C } }; }
  if (n.kind === 'heading') { const tc = textColorOf(n); return { elType: 'widget', widgetType: 'heading', settings: { title: n.text, header_size: 'h' + Math.min(6, Math.max(1, n.level || 2)), ...nativeTypo(n), ...(tc ? { title_color: tc } : {}), ...C } }; }
  if (n.kind === 'button') {
    if (n.interactive && n.panel && n.panel.items && n.panel.items.length) { const items = n.panel.items.map((i) => `<a href="${esc(i.href || '#')}">${esc(i.text)}</a>`).join(''); return { elType: 'widget', widgetType: 'html', settings: { html: `<details class="cfx-dd"><summary>${esc(n.text || '')}</summary><div class="cfx-dd-panel">${items}</div></details>`, ...C } }; }
    if (opaque(n.bg)) { const s = { text: n.text || '', background_background: 'classic', background_color: n.bg, button_text_color: (n.paint && n.paint.value) || '#ffffff', border_radius: radiusDim(n.radius), ...nativeTypo(n), ...C }; if (n.href) s.link = { url: n.href }; if (n.hover) { if (n.hover.background) { s.button_background_hover_background = 'classic'; s.button_background_hover_color = n.hover.background; } if (n.hover.color) s.hover_color = n.hover.color; } return { elType: 'widget', widgetType: 'button', settings: s }; }
    { const tc = textColorOf(n); return { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<a${n.href ? ` href="${esc(n.href)}"` : ''}>${esc(n.text)}</a>`, ...nativeTypo(n), ...(tc ? { text_color: tc } : {}), ...C } }; }
  }
  { const tc = textColorOf(n); return { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<div>${esc(n.text || '')}</div>`, ...nativeTypo(n), ...(tc ? { text_color: tc } : {}), ...C } }; }
}

// ---------- container node → Elementor flex container (FLOW, no absolute) ----------
let idN = 0;
const jc = (v) => ({ 'flex-start': 'flex-start', 'flex-end': 'flex-end', center: 'center', 'space-between': 'space-between', 'space-around': 'space-around', 'space-evenly': 'space-evenly', start: 'flex-start', end: 'flex-end' }[v] || 'flex-start');
const ai = (v) => ({ 'flex-start': 'flex-start', 'flex-end': 'flex-end', center: 'center', stretch: 'stretch', baseline: 'baseline', start: 'flex-start', end: 'flex-end', normal: 'stretch' }[v] || 'stretch');
function buildNode(n, parentW, parentIsRow, parentIsGrid) {
  if (!n) return null;
  if (n.kind !== 'container') return leafWidget(n, parentIsRow);
  // GRID counts as ROW: a display:grid container has flexDirection:"row" but /flex/ test fails →
  // it was mapped to COLUMN, so grid items (e.g. a 19-logo grid) stacked vertically (a 9088px section!).
  const lay = n.layout || {}; const isGrid = /grid/.test(lay.display || '');
  // Direction from the captured display/flex-direction. (A geometric children-box inference fixed the
  // vertical-digit bug but ALSO flipped other containers → text overlaps → textColor crashed 0.999→0.1 +
  // layout 1.0→0.6. Reverted: the digit/nav layout bugs need a PRINCIPLED per-archetype handler, not a
  // global heuristic that ripples across color/overlap/geometry. See journal — the #2 rethink finding.)
  const isRow = isGrid || (/row/.test(lay.flexDirection || '') && /flex/.test(lay.display || ''));
  const id = 'ct-' + idN++;
  const boxW = (n.box && n.box.w) || 0; const pW = parentW || VW; const ratio = pW ? boxW / pW : 1;
  // content_width 'full' ONLY for full-bleed sections (≈ viewport wide). Nested items must NOT be
  // forced full (that made every nav item 100% wide → 6 items wrapped to a vertical stack). S5 root cause.
  const fullBleed = boxW >= VW * 0.9;
  // content_width is CONTEXT-DEPENDENT (flexbox semantics, proven in isolation + on-page):
  //   • row CHILD  → 'inline' (shrink to content, sit side-by-side; 'full' made nav items wrap to a stack)
  //   • column child / full-bleed section → 'full' (fill the column width; 'inline' everywhere collapsed
  //     the whole page to 3903px tall and overflowed horizontally to 9580px wide).
  // content_width: REVERTED to 'full' globally. The 'inline' rule fixed the nav (horizontal, verified) but
  // globally regressed textColor→0 + layout→0.6 (overlaps) by shrinking content containers — every tweak
  // ripples unpredictably across nav/color/overlap/geometry. The nav needs a DEDICATED handler, not a
  // global content_width heuristic (the #2 "rethink" finding). Keeping the clone at the non-regressed state.
  const set = { content_width: 'full', _element_id: id, flex_direction: isRow ? 'row' : 'column' };
  if (/flex|grid/.test(lay.display || '')) { set.flex_wrap = /wrap/.test(lay.flexWrap || '') || lay.display.includes('grid') ? 'wrap' : 'nowrap'; if (lay.justify) set.flex_justify_content = jc(lay.justify); set.flex_align_items = ai(lay.align); }
  // NATIVE GRID: flex can't size container children (proven — they're forced to width:100%), so a captured
  // CSS grid becomes a real Elementor grid container. VERIFIED: container_type:'grid' + grid_columns_grid
  // tiles container-cards cleanly (stats 3-col, feature cards 2-col). Column count = entries in gridCols.
  if (isGrid && lay.gridCols) {
    const cols = lay.gridCols.trim().split(/\s+/).filter((c) => c && c !== '0px').length;
    if (cols >= 2 && cols <= 6) {
      set.container_type = 'grid';
      set.grid_columns_grid = { unit: 'fr', size: String(cols) };
      const g = px(lay.gap) || 16; set.grid_gaps = { column: String(g), row: String(g), unit: 'px', isLinked: true };
      delete set.flex_wrap; delete set.flex_direction;
    }
  }
  // REVERTED cycle-4 geometry-driven grid: firing on any 2-item top-row was TOO broad — it converted nested
  // containers into grids whose narrow inferred columns forced heavy text-wrapping → row heights ballooned
  // → hRatio 2.87→8.14 (WORSE). Restored the conservative flex-row→grid heuristic (>=2 container children,
  // horizontally arranged). LESSON: naive grid conversion backfires; native multi-column reconstruction is a
  // genuinely hard wall — keep complex sites on the hybrid/raster path.
  if (!set.container_type && isRow && n.box) {
    const kids = (n.children || []).filter((c) => c.box && c.box.w > 0);
    const conts = kids.filter((c) => c.kind === 'container');
    if (kids.length >= 2 && conts.length >= 2) {
      const xs = kids.map((c) => c.box.x + c.box.w / 2), ys = kids.map((c) => c.box.y + c.box.h / 2);
      if (Math.max(...xs) - Math.min(...xs) > (Math.max(...ys) - Math.min(...ys)) * 1.5) {
        const fr = kids.map((c) => Math.max(1, Math.round(c.box.w / 20)));
        set.container_type = 'grid';
        set.grid_template_columns = { unit: 'custom', size: '', custom: fr.map((f) => f + 'fr').join(' ') };
        set.grid_columns_grid = { unit: 'fr', size: String(Math.min(kids.length, 6)) };
        const g = px(lay.gap) || 12; set.grid_gaps = { column: String(g), row: String(g), unit: 'px', isLinked: true };
        delete set.flex_wrap; delete set.flex_direction;
      }
    }
  }
  set.flex_gap = dim(px(lay.gap) || 0); // ALWAYS set gap (0 if none) — Elementor's default ~20px gap on 126 containers made the clone 1.96x too TALL → wrecked geometry
  // HORIZONTAL CENTERING: Stripe centers content via max-width wrappers (parent padding / margin auto).
  // The capture records the wrapper's centered x (~87px in a 1440 vp). An Elementor column/block
  // container left-aligns fixed-width children by default → content pins to x=0 (the systematic ~6-18%
  // x error the distance-grader exposed). If this container's children sit horizontally centered within
  // it, mirror that with align-items:center. No-op for full-width (100%) children; only bites fixed-width.
  if (n.box) {
    const cw = (n.children || []).map((c) => c.box).filter((b) => b && b.w > 40 && b.w < boxW * 0.97);
    const centered = cw.filter((b) => Math.abs((b.x - n.box.x) - (boxW - b.w) / 2) < boxW * 0.06 && (b.x - n.box.x) > boxW * 0.03).length;
    if (cw.length && centered >= Math.ceil(cw.length * 0.5)) {
      // Row/grid wrapper centers children on the MAIN axis (justify); column/block on the CROSS axis
      // (align). Only override a default/flex-start justify so real nav rows (space-between) are untouched.
      if (isRow) { if (!set.flex_justify_content || set.flex_justify_content === 'flex-start') set.flex_justify_content = 'center'; }
      else set.flex_align_items = 'center';
    }
  }
  // S5 FIX: emit the source's WIDTH so flex items size correctly. The old #id{width:Npx} CSS path is
  // STRIPPED by wp_kses on save (same bug that killed typography) — so use NATIVE per-element width,
  // which survives and is editable. Sized item → captured px width + flex_size:none (≈ flex:0 0 auto).
  // NOTE: content_width:'inline' (above) already shrinks non-full-bleed containers to their content, so
  // explicit per-element widths are redundant — and HARMFUL when a captured box.w included hidden content
  // (nav items whose box spanned their dropdown panel got pinned ~1360px → off-screen overflow). Let
  // inline + flex size them. Only prevent grow/shrink so row items hold their content width.
  // Only COLUMN children get _flex_size:'none' (hold their block size). Row children must NOT (proven:
  // 'inline' + no flex_size = tight side-by-side [ROW I]; adding _flex_size:'none' spread them wide [ROW G]).
  if (!fullBleed && ratio < 0.92 && boxW > 0 && !parentIsRow) { set._flex_size = 'none'; }
  // NOTE: flex-item width sizing of container children does NOT work in this Elementor setup (proven by
  // 4 scratch experiments: _element_custom_width / _flex_size / content_width / _flex_basis are all
  // overridden to width:100% by .e-con). Grids must use Elementor's NATIVE grid container, handled below.
  // ALWAYS set padding (0 if none) so Elementor's default container padding doesn't inflate height.
  // CRITICAL: the CONTAINER padding control is `padding` — `_padding` (widget advanced-padding) is IGNORED
  // on containers, so Elementor's default ~10px .e-con padding stayed on all 68 nested containers and
  // ballooned the clone to 3x height (hRatio 3.04). Set `padding` (keep `_padding` for any widget-ish nodes).
  const P = (n.padding || []).map((v) => Math.round(px(v) || 0)); const pad = { unit: 'px', top: String(P[0] || 0), right: String(P[1] || 0), bottom: String(P[2] || 0), left: String(P[3] || 0), isLinked: false }; set.padding = pad; set._padding = pad;
  const mg = padDim(n.margin); if (mg) set._margin = mg; // geometry: emit source margins (Stripe spaces with margins → positions drift without them)
  if (n.background && n.background.color) { set.background_background = 'classic'; set.background_color = n.background.color; }
  if (n.background && n.background.image) { set.background_background = 'classic'; set.background_image = { url: localBg(n.background.image) }; set.background_size = 'cover'; set.background_position = 'center center'; }
  // S8: rasterized canvas/gradient region → set as this container's background (only the tight match)
  const rb = rasterFor(n.box || {}); if (rb) { set.background_background = 'classic'; set.background_image = { url: rb }; set.background_size = 'cover'; set.background_position = 'center center'; set.background_repeat = 'no-repeat'; }
  // radius → NATIVE border_radius (survives kses; the #id CSS path is stripped). border/shadow/gradient
  // remain via #id CSS for now — those are kses-STRIPPED too (so currently no-op), TODO native: box_shadow
  // group + background_background:'gradient'. Most impactful gradients are already rasterized → bg image.
  if (n.radius && n.radius !== '0px') set.border_radius = radiusDim(n.radius);
  let idCss = '';
  if (n.border) idCss += `border:${n.border};`;
  if (n.boxShadow) idCss += `box-shadow:${n.boxShadow};`;
  if (n.background && n.background.gradient) idCss += `background:${n.background.gradient};`;
  if (idCss) css.push(`#${id}{${idCss}}`);
  const kids = (n.children || []).map((c) => buildNode(c, boxW, isRow, isGrid)).filter(Boolean);
  return container(set, kids);
}

// 429 backs off HARD (5/20/45s), only 3 tries — hammering 12x re-triggered a host write-throttle.
async function jp(method, path, body) { const backoff = [5000, 20000, 45000]; for (let a = 0; a < 4; a++) { const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 200) }; } if (r.status === 429) { if (a >= 3) return { status: 429, j }; await sleep(Math.max((j.details?.retry_after || 0) * 1000, backoff[a])); continue; } if (!r.ok) console.error(method, path, r.status, JSON.stringify(j).slice(0, 200)); return { status: r.status, j }; } return { status: 429, j: {} }; }

(async () => {
  const dry = process.argv.includes('--dry');
  // 1) fonts
  const hosted = []; if (!dry) { for (const u of (L.fontFiles || [])) { const url = await uploadFont(u, u.split('/').pop().split('?')[0]); if (url) hosted.push({ base: baseName(u.split('/').pop()), url }); await sleep(700); } }
  const families = [...new Set(gcListFamilies())]; const faced = new Set();
  function gcListFamilies() { const fams = new Set(); const w = (n) => { if (!n) return; if (n.kind === 'container') (n.children || []).forEach(w); else if (n.typo && n.typo.family) fams.add(n.typo.family); }; w(L.root); return [...fams]; }
  for (const fam of families) { const fb = baseName(fam); const h = hosted.find((x) => x.base.slice(0, 5) && (x.base.includes(fb.slice(0, 5)) || fb.includes(x.base.slice(0, 5)))); if (h) { fontFaces += `@font-face{font-family:'${fam}';src:url('${h.url}') format('woff2');font-weight:100 900;font-display:swap}\n`; faced.add(fam); } }
  const fontMap = (fam) => faced.has(fam) ? fam : (/[^\x00-\x7f]/.test(fam || '') ? 'inherit' : (fam || 'inherit'));
  // 2) images
  if (!dry) { const srcAlt = new Map(); const collect = (n) => { if (!n) return; if (n.kind === 'image' && n.src) { if (!srcAlt.has(n.src)) srcAlt.set(n.src, n.alt || ''); } else if ((n.kind === 'svg' || n.kind === 'mockup') && n.raster && n.raster !== 'SKIP') { delete imgMap[n.raster]; if (!srcAlt.has(n.raster)) srcAlt.set(n.raster, ''); } else if (n.kind === 'container') { if (n.background && n.background.image && !srcAlt.has(n.background.image)) srcAlt.set(n.background.image, ''); (n.children || []).forEach(collect); } }; collect(L.root); const fresh = [...srcAlt].filter(([u]) => !(imgMap[u] && imgMap[u].full)); console.log(`images: ${srcAlt.size} total, ${fresh.length} new…`); for (const [u, alt] of fresh) { await uploadImage(u, alt); await sleep(350); }
    for (const r of (L.rasters || [])) { delete imgMap[r.file]; await uploadImage(r.file, 'background'); await sleep(300); } // S8 rasters → media (bust cache: regenerated each capture)
    try { fs.writeFileSync(IMG_CACHE, JSON.stringify(imgMap, null, 2)); } catch {} }
  // 3) build the flex tree + style
  const tree = buildNode(L.root, VW, false, false); emitGcCss(fontMap);
  const disclosureCss = `.cfx-dd{position:relative;display:inline-block}.cfx-dd>summary{cursor:pointer;list-style:none}.cfx-dd>summary::-webkit-details-marker{display:none}.cfx-dd[open]>.cfx-dd-panel{display:flex}.cfx-dd-panel{display:none;position:absolute;top:100%;left:0;z-index:50;flex-direction:column;gap:8px;background:#fff;box-shadow:0 12px 40px rgba(0,0,0,.16);border-radius:12px;padding:16px 20px;min-width:220px}.cfx-dd-panel a{white-space:nowrap;text-decoration:none;color:inherit}`;
  const styleWidget = { elType: 'widget', widgetType: 'html', settings: { html: `<style>\n${fontFaces}${disclosureCss}\n${css.join('\n')}\n</style>` } };
  const root = container({ content_width: 'full', flex_direction: 'column', flex_gap: dim(0), _padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } }, [styleWidget, tree]);
  const count = (e) => 1 + (e.elements || []).reduce((a, c) => a + count(c), 0);
  console.log(`flex-tree: ${count(root)} elements | ${gcList.length} style-classes | ${css.length} css rules | ${hosted.length} fonts`);

  if (dry) {
    fs.writeFileSync('/tmp/flextree.json', JSON.stringify(root, null, 2));
    let cont = 0, wid = 0, row = 0; const w = (e) => { if (e.elType === 'container') { cont++; if (e.settings.flex_direction === 'row') row++; } else wid++; (e.elements || []).forEach(w); }; w(root);
    console.log(`DRY — tree → /tmp/flextree.json | containers ${cont} (${row} row) | widgets ${wid}`);
    process.exit(0);
  }
  const pageTitle = L.title || title; const reuse = arg('page', null);
  if (reuse) {
    const cur = await jp('GET', `/wp-json/joist/v1/pages/${reuse}`, null); let hash = cur.j && cur.j.elementor && cur.j.elementor.hash; if (!hash) { console.error('no hash', cur.status); process.exit(1); }
    const body = () => ({ expected_hash: hash, elements: [root], page_settings: {}, title: pageTitle, intent: 'flex-tree clone (Wave 2)' });
    let put = await jp('PUT', `/wp-json/joist/v1/pages/${reuse}`, body());
    // retry on stale-hash OR the TRANSIENT #35888 atomic_save_silent_failure (re-read hash each time)
    for (let a = 0; a < 4 && (put.status === 409 || /expected_hash|hash.*mismatch|atomic_save_silent/i.test(JSON.stringify(put.j))); a++) {
      await sleep(1500); const c2 = await jp('GET', `/wp-json/joist/v1/pages/${reuse}`, null); hash = c2.j && c2.j.elementor && c2.j.elementor.hash; put = await jp('PUT', `/wp-json/joist/v1/pages/${reuse}`, body());
    }
    console.log('replace ->', put.status, put.status >= 400 ? JSON.stringify(put.j).slice(0, 240) : '(hash ' + (put.j.new_hash || '?') + ')');
    // _elementor_edit_mode=builder so the FRONTEND renders the Elementor tree (styled), not the unstyled
    // post_content fallback. Without it, native typography/layout set via widget settings never applies.
    if (put.status < 400) { try { await fetch(`${base}/wp-json/wp/v2/pages/${reuse}`, { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json' }, body: JSON.stringify({ meta: { _elementor_edit_mode: 'builder' } }) }); console.log('set edit_mode=builder'); } catch {} }
    const pg = await jp('GET', `/wp-json/wp/v2/pages/${reuse}?context=edit`, null); console.log('PAGE_URL:', (pg.j && pg.j.link) || ('(page ' + reuse + ')'));
    process.exit(put.status < 400 ? 0 : 1);
  }
  const create = await jp('POST', '/wp-json/joist/v1/plans', { intent: 'flex-tree clone', title: pageTitle, page_id: 0, steps: [{ op: 'insert', parent_id: 'root', position: 0, element: root }] });
  const planId = create.j.plan_id, token = create.j.approval_token; if (!planId) { console.error('create failed', JSON.stringify(create.j).slice(0, 300)); process.exit(1); }
  console.log('plan', planId); await sleep(2500); await jp('POST', `/wp-json/joist/v1/plans/${planId}/approve`, { approval_token: token });
  await sleep(2500); const ex = await jp('POST', `/wp-json/joist/v1/plans/${planId}/execute`, {}); console.log('execute ->', ex.status);
  await sleep(2000); const g = await jp('GET', `/wp-json/joist/v1/plans/${planId}`, null); const pg = await jp('GET', `/wp-json/wp/v2/pages/${g.j.page_id}?context=edit`, null);
  console.log('PAGE_URL:', pg.j.link || ('(page ' + g.j.page_id + ')'), '| id', g.j.page_id);
})();
