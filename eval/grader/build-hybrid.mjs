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
import { absPos, absSectionCss, needsAbsLayout, isMultiColumn } from './abs-positioning.mjs';
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
function nativeTypo(t) { const s = {}; if (!t || !(t.size || t.family)) return s; s.typography_typography = 'custom'; const real = (t.family && t.family.length > 1 && !/^(-apple-system|blinkmacsystemfont|system-ui|sans-serif|serif|monospace|ui-|inherit|initial)/i.test(t.family)) ? t.family : null; const gf = real || gFont(t.family); if (gf) s.typography_font_family = gf; if (t.size) s.typography_font_size = { unit: 'px', size: Math.round(t.size) }; if (t.weight && /^\d+$/.test(String(t.weight))) s.typography_font_weight = String(t.weight); const lh = px(t.lineHeight); if (lh) s.typography_line_height = { unit: 'px', size: Math.round(lh) }; const ls = px(t.letterSpacing); if (ls !== null && t.letterSpacing !== 'normal') s.typography_letter_spacing = { unit: 'px', size: +ls.toFixed(1) }; if (t.transform && t.transform !== 'none') s.typography_text_transform = t.transform; if (t.style && t.style !== 'normal') s.typography_font_style = t.style.startsWith('oblique') ? 'oblique' : 'italic'; return s; }
const solidColor = (c) => (c && /^(#|rgb)/.test(c) && c !== 'rgba(0, 0, 0, 0)') ? c : null;
// Apply a section's background to a container settings object: solid color (always) + VERBATIM gradient
// (gated HYBRID_SECTION_BG) emitted via the durable per-element custom_css channel (recipe round 45 proven
// path — beats dominant-stop). Editable sections are transparent, so a captured gradient otherwise renders white.
function applySectionBg(set, sec) {
  if (sec.bg) { set.background_background = 'classic'; set.background_color = sec.bg; }
  if (sec.bgGrad && process.env.HYBRID_SECTION_BG === '1') {
    set.custom_css = (set.custom_css ? set.custom_css + '\n' : '') + `selector{background-image:${sec.bgGrad}!important}`;
  }
}
function leafToWidget(n) {
  if (n.kind === 'image') { const url = n.url || n.src; if (!url) return null; const s = { image: { url }, image_size: 'full' }; if (n.box && n.box.w > 4) s.width = { unit: 'px', size: Math.round(n.box.w) }; return { elType: 'widget', widgetType: 'image', settings: s }; }
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
// P1 LAYOUT ENGINE (DEFAULT-ON; opt out with HYBRID_GRID=0): detect a clean N-column card/cell grid — NARROW leaves (fit one
// column, w < 40% W) cluster into 2–4 evenly-spaced columns spanning the section; WIDE leaves (≥40% W) are the
// full-width header/footer. Flow flattens such grids into sparse stacks (the diagnosed Stripe/clerk failure);
// this rebuilds the real columns. Returns a grid plan or null (→ fall back to flow). Conservative on purpose.
function detectGrid(sec) {
  const all = (sec.leaves || []).filter((l) => l.box && l.box.w > 0 && !l.icon); // icons excluded from column
  const cells = all.filter((l) => l.box.w < W * 0.40);                            // detection (they cluster wrong)
  const wide = all.filter((l) => l.box.w >= W * 0.40);
  if (cells.length < 4) return null;
  const cols = [];
  for (const l of cells.slice().sort((a, b) => a.box.x - b.box.x)) { const c = cols.find((c) => Math.abs(c.x - l.box.x) < W * 0.06); if (c) { c.items.push(l); c.x = (c.x * (c.items.length - 1) + l.box.x) / c.items.length; } else cols.push({ x: l.box.x, items: [l] }); }
  const realCols = cols.filter((c) => c.items.length >= 2).sort((a, b) => a.x - b.x);
  if (realCols.length < 2 || realCols.length > 5) return null;
  if (realCols[realCols.length - 1].x - realCols[0].x < W * 0.45) return null;            // must span the width
  if (realCols.reduce((n, c) => n + c.items.length, 0) < cells.length * 0.7) return null;  // most cells in columns
  // BALANCED columns only — reject ragged single-column-ish lists masquerading as a grid (the corrected 2D-scan
  // criterion that distinguished real card grids from the adversary's false "no grid exists" targets).
  const counts = realCols.map((c) => c.items.length); const minC = Math.min(...counts), maxC = Math.max(...counts);
  if (minC < maxC * 0.5) return null;
  // EVEN-SPACING guard — a real grid has roughly uniform column gaps. Reject clustered-columns-plus-outlier
  // false positives (e.g. resend[6] 421,516,630,1154 / tailwind[0] 81,1104,1292) that pass the span+balance
  // tests but aren't grids. Tolerance 2.6× between widest and narrowest consecutive gap.
  if (realCols.length >= 3) { const gaps = realCols.slice(1).map((c, k) => c.x - realCols[k].x); const gMin = Math.min(...gaps), gMax = Math.max(...gaps); if (gMin <= 0 || gMax / gMin > 2.6) return null; }
  const gMinY = Math.min(...realCols.flatMap((c) => c.items.map((l) => l.box.y)));
  return { columns: realCols, header: wide.filter((l) => l.box.y + l.box.h <= gMinY + 20).sort((a, b) => a.box.y - b.box.y), footer: wide.filter((l) => l.box.y > gMinY + 40).sort((a, b) => a.box.y - b.box.y) };
}
// Emit a true 2D CARD grid. Each column's leaves are grouped into CARDS by vertical gap (icon+heading+body that
// belong together stay together — the per-card grouping flow loses); cards are laid out row-major into a single
// flex-wrap row of fixed-width cells, so they reflow responsively AND preserve column count / card grouping /
// spacing. Width = 100/N% per card. This is the diagnosed Stripe/clerk fix.
function buildGridSection(sec, grid) {
  const els = [];
  for (const lf of grid.header) { const w = leafToWidget(lf); if (w) els.push(w); }
  const N = grid.columns.length; const colW = +(100 / N - 3).toFixed(2);
  // group each column's leaves into cards by intra-column vertical gap (>48px → new card)
  const cards = [];
  for (const col of grid.columns) {
    const items = col.items.slice().sort((a, b) => a.box.y - b.box.y); let cur = [];
    for (const it of items) { if (cur.length) { const prev = cur[cur.length - 1]; if (it.box.y - (prev.box.y + prev.box.h) > 48) { cards.push({ x: col.x, y: cur[0].box.y, items: cur }); cur = []; } } cur.push(it); }
    if (cur.length) cards.push({ x: col.x, y: cur[0].box.y, items: cur });
  }
  // attach captured icons (#4) to their nearest card by column-x then y — icons are excluded from column
  // detection (they'd pollute clustering) but belong at a card's top. Re-sort so the icon leads each card.
  for (const ic of (sec.leaves || []).filter((l) => l.icon)) {
    const icx = ic.box.x + ic.box.w / 2; let best = null, bestS = Infinity;
    for (const card of cards) { const s = Math.abs(card.x - icx) * 2 + Math.abs(card.y - ic.box.y); if (s < bestS) { bestS = s; best = card; } }
    if (best) best.items.push(ic);
  }
  for (const card of cards) card.items.sort((a, b) => a.box.y - b.box.y);
  // reading order: row-band (quantized y) then x — so cards lay out left-to-right, top-to-bottom
  const rowQ = Math.max(60, sec.h / Math.max(1, Math.ceil(cards.length / N)));
  cards.sort((a, b) => (Math.round(a.y / rowQ) - Math.round(b.y / rowQ)) || (a.x - b.x));
  // Responsive widths so the grid REFLOWS instead of shrinking into overflow on mobile (the responsive regression):
  // desktop = 100/N%, tablet = 2-col (50%), mobile = 1-col (100%).
  const cardEls = cards.map((card) => ({ elType: 'container', settings: { content_width: 'full', flex_direction: 'column', flex_gap: dim(6), width: { unit: '%', size: colW }, width_tablet: { unit: '%', size: N > 2 ? 48 : colW }, width_mobile: { unit: '%', size: 100 }, padding: { unit: 'px', top: '8', right: '8', bottom: '8', left: '8', isLinked: false } }, elements: card.items.map(leafToWidget).filter(Boolean) }));
  els.push({ elType: 'container', settings: { content_width: 'full', flex_direction: 'row', flex_wrap: 'wrap', flex_gap: dim(16), flex_align_items: 'flex-start', flex_justify_content: 'center', padding: { unit: 'px', top: '12', right: '0', bottom: '12', left: '0', isLinked: false } }, elements: cardEls });
  for (const lf of grid.footer) { const w = leafToWidget(lf); if (w) els.push(w); }
  // NO TEXT LOSS — any leaf not placed in a card/header/footer (un-clustered narrow cells, mid-band wides) is
  // appended as flow in source order. Grid reconstruction must never DROP content (the textCoverage regression).
  const placed = new Set([...grid.header, ...grid.footer, ...cards.flatMap((c) => c.items)]);
  const leftovers = (sec.leaves || []).filter((l) => l.box && l.box.w > 0 && !placed.has(l)).sort((a, b) => a.box.y - b.box.y);
  for (const lf of leftovers) { const w = leafToWidget(lf); if (w) els.push(w); }
  const set = { content_width: 'full', flex_direction: 'column', flex_gap: dim(12), flex_align_items: 'center', flex_justify_content: 'center', min_height: { unit: 'px', size: Math.round(sec.h) }, padding: { unit: 'px', top: '24', right: '24', bottom: '24', left: '24', isLinked: false } };
  applySectionBg(set, sec);
  return { elType: 'container', settings: set, elements: els };
}

function buildEditableSection(sec) {
  if (process.env.HYBRID_GRID !== '0') { const g = detectGrid(sec); if (g) { console.log(`  [${sec.i}] GRID ${g.columns.length}-col (${g.columns.map((c) => Math.round(c.x)).join(',')})`); return buildGridSection(sec, g); } }
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
  const set = { content_width: 'full', flex_direction: 'column', flex_gap: dim(12), flex_align_items: centered ? 'center' : 'flex-start', flex_justify_content: 'center', min_height: { unit: 'px', size: Math.round(sec.h) }, padding: { unit: 'px', top: '24', right: '24', bottom: '24', left: '24', isLinked: false } };
  applySectionBg(set, sec);
  return { elType: 'container', settings: set, elements: widgets };
}

// ABS editable section — RARE EXCEPTION for very specific designs (layered/overlapping content flex-flow
// can't represent). Each leaf is pinned at its captured (x,y,w) relative to the section; the section container
// is CSS-pinned position:relative + min_height (see abs-positioning.mjs). Widths are preserved (so text wraps
// like the source). Desktop-pixel; the global RESPONSIVE_UNPIN_CSS stacks it on mobile. NOT the default path.
function buildAbsEditableSection(sec) {
  const eid = `abssec${sec.i}`;
  const origin = { x: 0, y: sec.y0 };
  const els = []; let z = 1;
  for (const lf of sec.leaves.slice().sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x))) {
    const w = leafToWidget(lf); if (!w) continue;
    w.settings = { ...w.settings, ...absPos(lf.box, z++, origin) };
    els.push(w);
  }
  // HARDENED: the container pin + un-pin ride PER-ELEMENT custom_css (durable across Elementor regen), NOT
  // page custom_css (which regen drops → the observed abs degradation). min_height also kept as a setting.
  const set = { _element_id: eid, content_width: 'full', min_height: { unit: 'px', size: Math.round(sec.h) }, custom_css: absSectionCss(sec.h), padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } };
  applySectionBg(set, sec);
  return { elType: 'container', settings: set, elements: els };
}

// CLASSIFY a captured section into editable|raster from its RAW signals. Node-side (not in-page) so a cached
// raw capture re-runs the gate deterministically — separating builder/gate changes from capture noise.
// Conservative: editable ONLY when genuinely text-dominant (raster is 1:1, so when in doubt raster).
function classify(sec) {
  const { bigCanvas, isNav, isFooter, textLeaves, mediaFrac, imgFrac = 0, h } = sec;
  if (bigCanvas) return { kind: 'raster', reason: 'canvas/video' };
  if (isNav) return { kind: 'editable', reason: 'nav' };
  if (isFooter && textLeaves <= 80) return { kind: 'editable', reason: 'footer' };
  // CYCLE-1: text-dominant + low media + height-capped → editable. Tall/complex sections RASTER (pixel-perfect)
  // — raster is 1:1, so when in doubt raster. The CYCLE-2 'text-dominance height-cap override' (let 3872px
  // sections go editable) was REVERTED: it reconstructed dense code/feature sections into sparse broken native
  // widgets that LOOKED wrong despite scoring well (grader-gaming the user caught 2026-06-08).
  if (textLeaves >= 2 && mediaFrac < 0.5 && h <= 2600) return { kind: 'editable', reason: `text${textLeaves}/media${mediaFrac}/h${h}` };
  // TALL-TEXT override (DEFAULT-ON; opt out HYBRID_TALLTEXT=0) — RE-ATTEMPT of the reverted cycle-2, now that grid
  // reconstruction + sub-block code-raster + min_height pinning exist (cycle-2 failed with bare flow → sparse broken
  // widgets). ONLY very text-heavy, low-media tall sections (e.g. tailwind [8]: 87 text runs rastered = the corpus
  // #1 coverage lever, 0.633->0.716). Fires rarely (1/8 cached sites); LOOK-confirmed faithful+editable, hRatio
  // 1.008 (no drift). n=1 corpus sample but strong + bounded (mediaFrac<0.4) + reversible. Judge new cases by EYE.
  if (process.env.HYBRID_TALLTEXT !== '0' && textLeaves >= 20 && mediaFrac < 0.4 && h <= 6000) return { kind: 'editable', reason: `talltext${textLeaves}/media${mediaFrac}/h${h}` };
  // MEDIA-SPLIT (gated HYBRID_MEDIASPLIT) — a media-HEAVY section rasters today, but if its media is dominated by
  // reconstructable IMG-TAG leaves (imgFrac covers most of mediaFrac) rather than canvas/background, it rebuilds
  // fully editable: images→image widgets, text→text widgets, grid handles layout. e.g. supabase [2] media0.77 but
  // 9 img mockups + 23 text in a grid. Requires NO non-img media to sub-raster. Text-rich + height-bounded. The
  // canvas/background-media case (sub-raster) is a separate, riskier follow-on (cycle-2 territory).
  if (process.env.HYBRID_MEDIASPLIT === '1' && textLeaves >= 8 && imgFrac >= mediaFrac * 0.7 && mediaFrac >= 0.5 && h <= 4000) return { kind: 'editable', reason: `mediasplit${textLeaves}/img${imgFrac}/media${mediaFrac}/h${h}` };
  return { kind: 'raster', reason: `media${mediaFrac}/text${textLeaves}/h${h}` };
}

(async () => {
  // CAPTURE CACHE (--cache): freeze the raw capture (section signals + screenshot) per source so rebuilds are
  // DETERMINISTIC — separating builder/gate changes from capture noise (dynamic sites like resend.com vary
  // run-to-run). Classification re-runs node-side from the frozen capture, so gate changes still take effect.
  // --refresh forces a recapture. Without --cache, behaves exactly as before (always live capture).
  const CACHE_DIR = process.argv.includes('--cache') ? `/tmp/hybrid-cache/${srcTag}` : null;
  const useCache = CACHE_DIR && fs.existsSync(`${CACHE_DIR}/model.json`) && fs.existsSync(`${CACHE_DIR}/shot.png`) && !process.argv.includes('--refresh');
  let model, shot, dpr;
  if (useCache) {
    model = JSON.parse(fs.readFileSync(`${CACHE_DIR}/model.json`, 'utf8'));
    shot = PNG.sync.read(fs.readFileSync(`${CACHE_DIR}/shot.png`));
    dpr = model._dpr || (shot.width / W);
    console.log(`capture CACHE HIT → ${CACHE_DIR} (${model.sections.length} sections, deterministic)`);
  } else {
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 2, locale: 'en-US', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const page = await ctx.newPage();
  try { await page.goto(source, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await page.goto(source, { waitUntil: 'load', timeout: 60000 }); } catch {} }
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(1600);
  await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 240)); } window.scrollTo(0, 0); });
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  await page.waitForTimeout(800);
  // FREEZE (capture stability for dynamic sites): live-animated sites (resend's dashboard demo) advance JS/CSS
  // animations between captures → section geometry (and editable/raster segmentation) varies run-to-run. After
  // the scroll-settle (which has already triggered scroll-reveals), pin the DOM: finish finite animations to
  // their FINAL/visible state, pause infinite ones (marquees/loops), and halt all future rAF + timers so the
  // live dashboard stops ticking through measurement. Kills transitions to remove hover/transition jitter.
  await page.evaluate(() => {
    for (const a of document.getAnimations()) { try { a.finish(); } catch { try { a.pause(); } catch {} } }
    window.requestAnimationFrame = () => 0; window.cancelAnimationFrame = () => {};
    const hi = setTimeout(() => {}, 0); for (let id = 0; id <= hi; id++) { clearInterval(id); clearTimeout(id); }
  });
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none !important;}' }).catch(() => {});
  await page.waitForTimeout(300);

  // SECTION SPLIT + per-section content + classification
  model = await page.evaluate(([vw, iconsOn]) => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; if (r.right < 0 || r.bottom < 0 || r.left > innerWidth + 60) return false; return true; };
    const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
    const typo = (cs) => ({ family: cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim(), size: Math.round(parseFloat(cs.fontSize)), weight: cs.fontWeight, style: cs.fontStyle, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, transform: cs.textTransform });
    const pageH = document.documentElement.scrollHeight;
    // section cut tops = full-width block boundaries (same logic as section-raster)
    const ys = new Set([0]); for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.width >= vw * 0.82 && r.height >= 120 && r.top + scrollY >= 0) ys.add(Math.round(r.top + scrollY)); }
    const arr = [...ys].sort((a, b) => a - b); const cuts = []; for (const y of arr) { if (!cuts.length || y - cuts[cuts.length - 1] > 60) cuts.push(y); }
    const bounds = [...cuts.filter((y) => y < pageH), pageH];
    // collect candidate leaves once
    const opaque = (c) => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent';
    const leafEls = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,img,span,li,div')];
    const seen = new Set();
    const sections = [];
    let iconBudget = 48; // #4: page-wide icon cap (bound total cost); per-section cap below prevents one logo-wall starving later card grids
    for (let i = 0; i < bounds.length - 1; i++) {
      const y0 = bounds[i], y1 = bounds[i + 1]; const mid = (y0 + y1) / 2; const secH = y1 - y0;
      const leaves = []; let mediaArea = 0, imgLeafArea = 0, textChars = 0, linkCount = 0, bigCanvas = false; let bgColor = null;
      // section bg: the full-width element starting at y0
      for (const e of document.querySelectorAll('body *')) { const r = rectOf(e); if (Math.abs(r.y - y0) < 6 && r.w >= vw * 0.82 && r.h >= secH * 0.6) { const c = getComputedStyle(e).backgroundColor; if (opaque(c)) { bgColor = c; break; } } }
      // section GRADIENT bg (verbatim) — the largest full-width element overlapping the band with a CSS gradient
      // background-image (these fall through to white today). Captured raw; emitted verbatim per-element (durable
      // custom_css) under HYBRID_SECTION_BG. Area-ranked (not first), band-overlap (not strict start match).
      let bgGrad = null, bgGradArea = 0;
      for (const e of document.querySelectorAll('body *')) { const r = rectOf(e); if (r.w < vw * 0.82) continue; const ov = Math.min(r.y + r.h, y1) - Math.max(r.y, y0); if (ov < secH * 0.55) continue; const bi = getComputedStyle(e).backgroundImage; if (/^(linear|radial|conic)-gradient/.test(bi) && r.w * r.h > bgGradArea) { bgGrad = bi; bgGradArea = r.w * r.h; } }
      for (const e of document.querySelectorAll('canvas, video')) { const r = rectOf(e); if (r.y + r.h / 2 >= y0 && r.y + r.h / 2 < y1 && r.w > 200 && r.h > 150) bigCanvas = true; }
      // CODE BLOCKS reconstruct as token soup (syntax-highlight spans). Count their area as MEDIA (so a
      // code-DOMINANT section rasterizes whole) AND emit each as a rasterSlice image-leaf (Wave B sub-section
      // hybrid): in a MIXED section (feature text + code), the text stays editable and the code block is sliced
      // from the screenshot + placed as ONE pixel-perfect image in position — instead of an empty gap.
      for (const e of document.querySelectorAll('pre')) { const r = rectOf(e); if (r.y + r.h / 2 >= y0 && r.y + r.h / 2 < y1 && r.w > 80 && r.h > 40) { mediaArea += r.w * r.h; leaves.push({ kind: 'image', rasterSlice: true, box: r, alt: 'code' }); } }
      for (const el of leafEls) {
        if (!vis(el)) continue; const box = rectOf(el); const cy = box.y + box.h / 2; if (cy < y0 || cy >= y1) continue;
        const tag = el.tagName.toLowerCase(); const cs = getComputedStyle(el);
        if (tag === 'img') { const src = el.currentSrc || el.src; if (src && !src.startsWith('data:') && box.w >= 24 && box.h >= 24) { mediaArea += box.w * box.h; if (box.w >= 40 && box.h >= 40) { leaves.push({ kind: 'image', src, box, alt: el.alt || '' }); imgLeafArea += box.w * box.h; } } continue; }
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && clean(n.textContent)); if (!own) continue;
        // CODE-SHREDDING FIX: skip text inside code blocks (<pre>/<code>) — syntax-highlighted code shatters
        // into per-token spans (<, div, class, =) that get emitted as individual widgets (the shredding the
        // user caught). Excluding it leaves the section text-less → it rasterizes as ONE pixel-perfect image.
        if (el.closest('pre,code')) continue;
        // EDITABILITY: include text-bearing <div> (the grader counts it) but only LEAF divs (no element
        // children) so a parent div's innerText doesn't duplicate its children's already-captured text.
        if (tag === 'div' && el.children.length > 0) continue;
        const t = clean(el.innerText || el.textContent); if (!t || t.length > 300) continue; if (parseFloat(cs.fontSize) < 10) continue;
        // skip 1-char punctuation fragments (syntax-highlight tokens, stray symbols) on inline span/div leaves
        if ((tag === 'span' || tag === 'div') && t.replace(/\s/g, '').length < 2) continue;
        // skip CSS-class-string fragments (tailwind annotations like `flex flex-col items-center p-7 rounded-2xl`)
        if ((tag === 'span' || tag === 'div') && /^[a-z0-9:\/\-\s"']+$/i.test(t) && /\b(flex|grid|p[xytrbl]?-\d|m[xytrbl]?-\d|text-|bg-|rounded|shadow|size-|gap-|w-|h-)\b/.test(t) && t.split(/\s+/).length >= 2 && !/\s[A-Z]/.test(t)) continue;
        const dk = t + '@' + Math.round(box.y / 8); if (seen.has(dk)) continue; seen.add(dk);
        const isH = /^h[1-6]$/.test(tag), isBtn = tag === 'a' || tag === 'button';
        if (isBtn) linkCount++;
        textChars += t.length;
        const btnBg = isBtn && opaque(cs.backgroundColor);
        leaves.push({ kind: isH ? 'heading' : (isBtn ? 'button' : 'text'), level: isH ? +tag[1] : null, text: t, href: isBtn && el.href ? el.href : null, typo: typo(cs), color: cs.color, align: cs.textAlign, btn: btnBg, bg: btnBg ? cs.backgroundColor : null, radius: cs.borderTopLeftRadius, box });
      }
      // #4 ICON CAPTURE (gated HYBRID_ICONS) — decorative icons (inline SVG / tiny img / bg-image) are neither
      // text nor img leaves, so reconstructed cards render empty. Detect icon-sized, roughly-square, INKED,
      // visible boxes → push as rasterSlice image leaves (hosted later; clustered into card-tops by detectGrid).
      // Do NOT add to mediaArea (would flip section classification editable->raster). Ink-gated, overlap-deduped,
      // page-capped (iconBudget). Direct-src for <img> icons (skip hosting); rasterSlice for SVG/bg-image.
      if (iconsOn && iconBudget > 0) {
        let secIcons = 0; // per-section cap so one logo-wall doesn't starve later card grids of their icons
        for (const el of document.querySelectorAll('svg, img, i, [class*="icon"], [class*="Icon"]')) {
          if (iconBudget <= 0 || secIcons >= 8) break;
          const r = rectOf(el); const cy = r.y + r.h / 2; if (cy < y0 || cy >= y1) continue;
          if (r.w < 14 || r.h < 14 || r.w > 96 || r.h > 96) continue;             // icon-sized
          const ar = r.w / r.h; if (ar < 0.4 || ar > 2.5) continue;               // roughly square
          if (!vis(el)) continue;
          const tag = el.tagName.toLowerCase(); let inks = false, src = null;
          if (tag === 'svg') inks = el.querySelector('path,circle,rect,polygon,line,g,ellipse') != null;
          else if (tag === 'img') { src = el.currentSrc || el.src; inks = !!src && !src.startsWith('data:'); }
          else { const bi = getComputedStyle(el).backgroundImage; inks = !!bi && bi !== 'none' && !/gradient/.test(bi); }
          if (!inks) continue;
          if (leaves.some((l) => l.icon && Math.abs(l.box.x - r.x) < 10 && Math.abs(l.box.y - r.y) < 10)) continue; // dedup nested
          if (src) leaves.push({ kind: 'image', src, box: r, icon: true, alt: 'icon' });
          else leaves.push({ kind: 'image', rasterSlice: true, icon: true, box: r, alt: 'icon' });
          iconBudget--; secIcons++;
        }
      }
      const secArea = vw * secH; const mediaFrac = secArea ? mediaArea / secArea : 0; const imgFrac = secArea ? imgLeafArea / secArea : 0;
      const textLeaves = leaves.filter((l) => l.kind !== 'image').length;
      const isNav = i === 0 && secH <= 160 && linkCount >= 3;
      const isFooter = i === bounds.length - 2 && linkCount >= 6;
      // CLASSIFICATION (editable vs raster) is done node-side in classify() — NOT here — so a cached raw
      // capture can be re-built deterministically and any gate change re-runs on the frozen capture.
      // ALWAYS keep leaves (even for would-be-raster) so re-classification can flip a section to editable.
      sections.push({ i, y0, y1, h: secH, bg: bgColor, bgGrad, textLeaves, mediaFrac: +mediaFrac.toFixed(2), imgFrac: +imgFrac.toFixed(2), linkCount, bigCanvas, isNav, isFooter, leaves });
    }
    // PAGE CANVAS background — dark-canvas sites (resend, framer) paint the bg on <body>/<html>, NOT on
    // per-section elements, so section bgColor stays null and transparent editable sections (nav/footer/
    // text) render light text on the default white floor → white-on-white. Capture it for the root floor.
    const bodyBg = getComputedStyle(document.body).backgroundColor, htmlBg = getComputedStyle(document.documentElement).backgroundColor;
    const pageBg = opaque(bodyBg) ? bodyBg : (opaque(htmlBg) ? htmlBg : null);
    return { vw: innerWidth, pageH, pageBg, sections };
  }, [W, process.env.HYBRID_ICONS === '1']);

  // full-page screenshot for raster sections
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
  shot = PNG.sync.read(await page.screenshot({ fullPage: true })); dpr = shot.width / W;
  fs.writeFileSync(`/tmp/hybrid-src-${srcTag}.png`, PNG.sync.write(dpr > 1 ? downscale(shot, Math.round(dpr)) : shot));
  await browser.close();
  if (CACHE_DIR) { fs.mkdirSync(CACHE_DIR, { recursive: true }); model._dpr = dpr; fs.writeFileSync(`${CACHE_DIR}/model.json`, JSON.stringify(model)); fs.writeFileSync(`${CACHE_DIR}/shot.png`, PNG.sync.write(shot)); console.log(`capture CACHE WRITE → ${CACHE_DIR}`); }
  }

  // CLASSIFY node-side (deterministic) — re-runs the editable/raster gate on the frozen-or-fresh capture.
  for (const s of model.sections) { const c = classify(s); s.kind = c.kind; s.reason = c.reason; }
  console.log(`sections: ${model.sections.length} | pageH ${model.pageH}`);
  for (const s of model.sections) console.log(`  [${s.i}] y${s.y0}-${s.y1} (${s.h}px) → ${s.kind.toUpperCase()} (${s.reason})`);

  // build each section
  const MAXH = 2400; const elements = []; let editCount = 0, rastCount = 0, rastImgs = 0, absCount = 0;
  // AUTO_ABS default ON: corpus-validated net-positive (+0.020) and BOUNDED — fires only on genuinely layered
  // (overlapping) / text-rich-rescue sections (3-4 per site), so flow stays the default for normal sections and
  // the responsive un-pin keeps abs mobile-safe. Opt out with HYBRID_AUTO_ABS=0. --force-abs forces all editable.
  const FORCE_ABS = process.argv.includes('--force-abs'); const AUTO_ABS = process.env.HYBRID_AUTO_ABS !== '0';
  // Wave B sub-section hybrid: slice a code/illustration block (page coords) from the screenshot, upload, return
  // a hosted image URL. Placed in-flow among the editable widgets so a mixed text+code section keeps its text
  // editable AND shows the code faithfully (a same-y text+image pair becomes a side-by-side flex row).
  async function rasterizeSubBlock(box, secI) {
    if (DRY) return null;
    const x0 = Math.max(0, Math.round(box.x * dpr)), y0 = Math.max(0, Math.round(box.y * dpr));
    const w = Math.min(shot.width - x0, Math.round(box.w * dpr)), h = Math.round(box.h * dpr);
    if (w < 24 || h < 24 || y0 + h > shot.height) return null;
    const crop = new PNG({ width: w, height: h });
    for (let r = 0; r < h; r++) { const s = ((y0 + r) * shot.width + x0) * 4; shot.data.copy(crop.data, (r * w) * 4, s, s + w * 4); }
    const out = dpr > 1 ? downscale(crop, Math.round(dpr)) : crop;
    return uploadPng(PNG.sync.write(out), `hybcode-${secI}-${Date.now()}.png`);
  }
  let subImgs = 0;
  for (const sec of model.sections) {
    let editEl = null;
    // Wave B: for sections that will render EDITABLE, materialize rasterSlice sub-blocks (code/illustration) as
    // hosted images IN PLACE. leafToWidget(image) skips any whose url didn't upload, so failures degrade to a gap.
    if (sec.kind === 'editable' && sec.leaves && sec.leaves.some((l) => l.rasterSlice && !l.url)) {
      for (const lf of sec.leaves) { if (lf.kind === 'image' && lf.rasterSlice && !lf.url) { const u = await rasterizeSubBlock(lf.box, sec.i); if (u) { lf.url = u; subImgs++; } } }
    }
    // ABS RESCUE was REVERTED (2026-06-08): it pulled RASTER-classified complex sections (code/feature mixes)
    // back into abs reconstruction → sparse broken pages that LOOKED wrong despite scoring well. Raster-classified
    // sections now STAY raster (pixel-perfect). Re-enable for experiments with HYBRID_ABS_RESCUE=1.
    const rescuable = process.env.HYBRID_ABS_RESCUE === '1' && (AUTO_ABS || FORCE_ABS) && sec.kind !== 'editable' && !sec.bigCanvas && sec.leaves &&
      sec.leaves.filter((l) => l.kind !== 'image').length >= 12 && needsAbsLayout(sec.leaves).abs;
    if (rescuable) {
      editEl = buildAbsEditableSection(sec); absCount++;
      console.log(`  [${sec.i}] ABS RESCUE from raster (textLeaves=${sec.leaves.filter((l) => l.kind !== 'image').length}, ${needsAbsLayout(sec.leaves).reason})`);
    } else if (sec.kind === 'editable' && sec.leaves.length) {
      // AUTO_ABS routes a section to abs ONLY when flow genuinely can't represent it: layered/overlapping
      // (needsAbsLayout). P1 (isMultiColumn → abs) was REVERTED — corpus 0.807<0.836, tailwind drift 0.583
      // (abs sections stacked to a 1.6x-tall sparse page). Multi-col stays on flow. --force-abs forces all;
      // HYBRID_MULTICOL_ABS=1 re-enables the reverted P1 path for experiments only.
      const ov = needsAbsLayout(sec.leaves);
      const mc = process.env.HYBRID_MULTICOL_ABS === '1' ? isMultiColumn(sec.leaves, { W }) : { multi: false };
      const useAbs = FORCE_ABS || (AUTO_ABS && (ov.abs || mc.multi));
      if (useAbs) { editEl = buildAbsEditableSection(sec); absCount++; console.log(`  [${sec.i}] ABS layout (${ov.abs ? ov.reason : mc.reason})`); }
      else editEl = buildEditableSection(sec);
    }
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
  console.log(`built: ${editCount} editable sections (${absCount} abs-pinned), ${rastCount} raster sections (${rastImgs} imgs), ${subImgs} sub-block code/illustration img(s)`);
  const zeroPad = { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true };
  // ROOT canvas floor — paint the captured page background behind everything so transparent editable
  // sections on dark-canvas sites don't render light text on the default white (the white-on-white bug).
  const isWhite = (c) => { const m = String(c || '').match(/(\d+),\s*(\d+),\s*(\d+)/); return !m || (+m[1] >= 250 && +m[2] >= 250 && +m[3] >= 250); };
  const rootBg = (model.pageBg && !isWhite(model.pageBg)) ? { background_background: 'classic', background_color: model.pageBg } : {};
  if (rootBg.background_color) console.log(`root canvas bg: ${model.pageBg}`);
  const root = { elType: 'container', settings: { ...rootBg, content_width: 'full', flex_direction: 'column', flex_gap: dim(0), padding: zeroPad, _padding: zeroPad }, elements };
  if (DRY) { fs.writeFileSync('/tmp/hybrid-tree.json', JSON.stringify(root, null, 2)); const cnt = (e) => 1 + (e.elements || []).reduce((a, c) => a + cnt(c), 0); console.log(`DRY → /tmp/hybrid-tree.json (${cnt(root)} elements)`); return; }

  const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'hybrid-' + Date.now() };
  let r, txt, expected = (await (await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { headers })).json()).elementor?.hash;
  // abs sections inject scoped container-pin CSS + the global responsive un-pin (mobile reflow). Only present
  // when an abs section was actually emitted, so flow-only builds keep page_settings empty (byte-identical).
  // abs pins + un-pin now ride PER-ELEMENT custom_css (durable); page custom_css no longer used for abs.
  const customCss = '';
  const pageSettings = customCss ? { custom_css: customCss } : {};
  for (let a = 0; a < 5; a++) { const body = { expected_hash: expected, elements: [root], page_settings: pageSettings, title: 'Hybrid clone', intent: 'hybrid editable+raster' }; r = await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { method: 'PUT', headers, body: JSON.stringify(body) }); txt = await r.text(); if (r.status !== 409) break; try { expected = JSON.parse(txt).details.current_hash; } catch {} console.log(`PUT 409 — retry with ${expected}`); await new Promise((s) => setTimeout(s, 400)); }
  console.log('PUT', r.status, txt.slice(0, 100));
  // _elementor_edit_mode=builder so the FRONTEND renders the Elementor tree (styled, editable) instead of
  // the raw post_content fallback (which left editable sections unstyled/blank).
  try { await fetch(`${base}/wp-json/wp/v2/pages/${pageId}`, { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json' }, body: JSON.stringify({ meta: { _elementor_edit_mode: 'builder' } }) }); console.log('set edit_mode=builder'); } catch (e) { console.log('edit_mode set failed', e.message); }
  console.log('PAGE:', `${base}/?page_id=${pageId}`);
})();
