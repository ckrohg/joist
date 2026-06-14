#!/usr/bin/env node
/**
 * @purpose Stage 2 of the re-architected cloner: map a faithful capture tree
 * (capture-tree.mjs) to a NATIVE Elementor container/widget tree and create it
 * via the Joist plan API (create→approve→execute). No HTML blob — every section
 * is a real container, every leaf a real heading/text-editor/button/image widget
 * with captured typography + color, so the result is round-trip editable AND
 * high-fidelity (values are measured, not guessed).
 *
 * Anti-regression rules learned from v5–v8:
 *   - colors are contrast-checked against their section bg (no green-on-white)
 *   - only action-verb CTAs become pills; nav links stay plain
 *   - full-bleed images (>=85% section width, tall) are NOT rendered inline —
 *     they become section backgrounds (or are deferred to Stage 3), so an image
 *     can never dominate the first screen and bury the headline
 *
 * Env: JOIST_BASE, JOIST_AUTH_B64 (see /tmp/joist-auth.env)
 * Usage: node build-tree.mjs --tree tree.json --title "Clone v9" [--page <id>]
 */
import fs from 'fs';

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
// §0 SAFETY GUARD: default flipped from the PAUSED shared host georges232.sg-host.com → local sandbox;
// resolveBase() throws LOUDLY before any fetch/PUT if JOIST_BASE points to a non-training host.
import { resolveBase } from '../../sandbox/host-guard.mjs';
const base = resolveBase(process.env.JOIST_BASE || 'http://localhost:8001');
const b64 = process.env.JOIST_AUTH_B64;
if (!b64) { console.error('missing JOIST_AUTH_B64'); process.exit(2); }
const tree = JSON.parse(fs.readFileSync(arg('tree'), 'utf8'));
const title = arg('title', 'Agent native clone');
// hybrid: { "<sectionIdx>": "<image url>" } — render those sections as a single
// captured image (pixel-faithful for graphic-heavy bands) instead of widgets.
const sectionImages = arg('section-images') ? JSON.parse(fs.readFileSync(arg('section-images'), 'utf8')) : {};
const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'agent-tree-' + tree.sectionCount };

// ---------- color / contrast ----------
const parseRGB = (s) => { const m = String(s).match(/(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*([\d.]+))?/); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null; };
const lum = ({ r, g, b }) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
const hex = ({ r, g, b }) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
// section background: resolve to an opaque rgb; transparent => inherit white
const secBgColor = (raw) => { const c = parseRGB(raw); return c && c.a > 0.05 ? c : { r: 255, g: 255, b: 255, a: 1 }; };
// text color sanitized against the section bg; fall back to a readable default
const safeText = (raw, bg, fallbackDark, fallbackLight) => {
  const c = parseRGB(raw); const bgDark = lum(bg) < 0.4;
  const fb = bgDark ? fallbackLight : fallbackDark;
  if (!c || c.a < 0.5) return fb;
  return contrast(c, bg) >= 3 ? hex(c) : fb;
};
// Strict CTA whitelist (exact phrases). "View/Explore/See/Read more" are text
// links on real sites, not filled pills; loose matching gave 19 false pills.
const CTA_RX = /^(get started|start now|sign up( with [\w ]+)?|contact sales|request (a )?demo|get (a )?demo|try (it )?(for )?free|start (your )?free trial|create (an )?account|subscribe|buy now)$/i;
const isCTA = (t) => CTA_RX.test(t.trim());

// ---------- unit parsing ----------
const px = (s) => { const m = String(s).match(/(-?\d+(?:\.\d+)?)px/); return m ? +m[1] : null; };
const dim = (n) => ({ unit: 'px', size: String(n) });
// söhne / proprietary sans → Inter (closest free humanist-geometric match)
const FONT_SUB = (fam) => /inter|sohne|söhne|söhne-var|sf pro|helvetica|arial|system/i.test(fam || '') ? 'Inter' : (fam || 'Inter').split(',')[0].replace(/['"]/g, '').trim();
const typ = (font, colorKey, color, extra = {}) => {
  const o = { typography_typography: 'custom', typography_font_family: FONT_SUB(font?.family), ...extra };
  if (font?.sizePx) o.typography_font_size = dim(Math.min(120, Math.max(11, font.sizePx)));
  if (font?.weight && /^\d+$/.test(font.weight)) o.typography_font_weight = String(Math.min(800, +font.weight));
  const lh = px(font?.lineHeight); if (lh) o.typography_line_height = dim(lh);
  const ls = px(font?.letterSpacing); if (ls !== null) o.typography_letter_spacing = dim(ls);
  if (font?.transform && font.transform !== 'none') o.typography_text_transform = font.transform;
  if (color) o[colorKey] = color;
  return o;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- leaf → widget ----------
function widget(lf, bg) {
  if (lf.type === 'heading') {
    const lvl = Math.min(6, Math.max(1, lf.level || 2));
    const col = safeText(lf.color, bg, '#0a2540', '#ffffff');
    return { elType: 'widget', widgetType: 'heading', settings: {
      title: lf.text, header_size: 'h' + lvl, align: lf.align === 'center' ? 'center' : (lf.align === 'right' ? 'right' : 'left'),
      title_color: col, ...typ(lf.font, null, null), _margin: { unit: 'px', top: '0', right: '0', bottom: '6', left: '0', isLinked: false },
    } };
  }
  if (lf.type === 'text') {
    const col = safeText(lf.color, bg, '#425466', '#c8d3e0');
    return { elType: 'widget', widgetType: 'text-editor', settings: {
      editor: '<p>' + esc(lf.text) + '</p>', align: lf.align === 'center' ? 'center' : (lf.align === 'right' ? 'right' : 'left'),
      text_color: col, ...typ(lf.font, null, null),
    } };
  }
  if (lf.type === 'button') {
    // Only real CTAs become button widgets (pills). Nav/inline links render as a
    // text-editor <a> so the theme's default button styling can't pill them —
    // this was the "19 filled pills" defect.
    if (isCTA(lf.text)) {
      const s = { text: lf.text, ...(lf.href ? { link: { url: lf.href, is_external: '', nofollow: '' } } : {}),
        background_background: 'classic', background_color: '#635bff', button_text_color: '#ffffff',
        border_radius: { unit: 'px', top: '24', right: '24', bottom: '24', left: '24', isLinked: true } };
      return { elType: 'widget', widgetType: 'button', settings: s };
    }
    const col = safeText(lf.color, bg, '#0a2540', '#ffffff');
    const href = lf.href ? ` href="${esc(lf.href)}"` : '';
    return { elType: 'widget', widgetType: 'text-editor', settings: {
      editor: `<a${href} style="color:${col};text-decoration:none;font-weight:500">${esc(lf.text)}</a>`,
      ...typ(lf.font, null, null),
    } };
  }
  if (lf.type === 'image') {
    // Display at the CAPTURED size — never upscale to container width (that was
    // the "giant gradient blob" bug). Cap to a sane max so nothing dominates.
    const w = Math.min(Math.max(40, lf.rect.w || 300), 1040);
    return { elType: 'widget', widgetType: 'image', settings: {
      image: { url: lf.src }, image_size: 'full', align: lf.col === -1 ? 'center' : 'left',
      width: { unit: 'px', size: String(Math.round(w)) }, _element_width: 'initial',
    } };
  }
  return null;
}

const container = (settings, elements = []) => ({ elType: 'container', settings, elements });

// ---------- section → container subtree ----------
function buildSection(sec, idx, heroIdx) {
  // HYBRID: graphic-heavy section → one pixel-faithful captured image (full-width band)
  if (sectionImages[idx]) {
    return container(
      { content_width: 'full', flex_direction: 'column', flex_align_items: 'center', flex_justify_content: 'center', _padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } },
      [{ elType: 'widget', widgetType: 'image', settings: { image: { url: sectionImages[idx] }, image_size: 'full', align: 'center', width: { unit: 'px', size: '1440' }, _element_width: 'initial' } }]
    );
  }
  const bg = secBgColor(sec.bg);
  const bgDark = lum(bg) < 0.4;
  const secW = sec.rect.w || 1440;
  const isHero = idx === heroIdx;
  // full-bleed tall images become backgrounds (never inline-dominating)
  const isFullBleed = (lf) => lf.type === 'image' && lf.rect.w >= 0.85 * secW && lf.rect.h >= 360;
  const heroBgImg = isHero ? sec.blocks.find(isFullBleed) : null; // hero visual → section bg
  const content = sec.blocks.filter((lf) => !isFullBleed(lf));

  const secSettings = { content_width: 'full', flex_direction: 'column', flex_align_items: 'center', flex_justify_content: 'flex-start', _padding: { unit: 'px', top: '64', right: '24', bottom: '64', left: '24', isLinked: false } };
  if (bg.a > 0.05 && !(bg.r === 255 && bg.g === 255 && bg.b === 255)) { secSettings.background_background = 'classic'; secSettings.background_color = hex(bg); }
  // GENERAL: a hero with a full-bleed visual → place that visual in the RIGHT
  // column (keeps the left white for the headline, mirrors how hero art sits).
  if (heroBgImg) {
    secSettings.min_height = { unit: 'px', size: '560' };
    secSettings._padding = { unit: 'px', top: '40', right: '0', bottom: '0', left: '24', isLinked: false };
  }

  // NAV ROW: a cluster of small links near the very top of the section is a nav
  // bar, not stacked body content — pull it out and lay it horizontally.
  // nav lives at the absolute top of the page (section bands can have negative
  // top when they include a fixed header, so test absolute y, not relative).
  const navLeaves = content.filter((b) => b.type === 'button' && (b.font?.sizePx || 99) <= 15 && b.rect.y < 110);
  let navRow = null;
  if (navLeaves.length >= 3) {
    const navSet = new Set(navLeaves);
    for (let i = content.length - 1; i >= 0; i--) if (navSet.has(content[i])) content.splice(i, 1);
    navRow = container(
      { content_width: 'boxed', flex_direction: 'row', flex_wrap: 'wrap', flex_gap: dim(24), flex_align_items: 'center', flex_justify_content: 'flex-start', _margin: { unit: 'px', top: '0', right: '0', bottom: '24', left: '0', isLinked: false } },
      navLeaves.map((b) => widget(b, bg)).filter(Boolean)
    );
  }

  let inner;
  if (heroBgImg) {
    // hero copy in a left column (~600px); CTAs grouped in a horizontal row;
    // empty spacer right lets the bg visual show through.
    const ctaBtns = content.filter((b) => b.type === 'button' && isCTA(b.text));
    const rest = content.filter((b) => !(b.type === 'button' && isCTA(b.text)));
    const leftKids = rest.map((b) => widget(b, bg)).filter(Boolean);
    if (ctaBtns.length) leftKids.push(container({ content_width: 'full', flex_direction: 'row', flex_gap: dim(12), flex_align_items: 'center', flex_wrap: 'wrap' }, ctaBtns.map((b) => widget(b, bg)).filter(Boolean)));
    inner = container(
      { content_width: 'boxed', flex_direction: 'row', flex_align_items: 'center', flex_justify_content: 'flex-start' },
      [container({ content_width: 'full', flex_direction: 'column', flex_gap: dim(14), flex_align_items: 'flex-start', _flex_grow: '0', _flex_shrink: '1', _element_width: 'initial', _element_custom_width: { unit: 'px', size: '560' } }, leftKids),
       container({ content_width: 'full', flex_direction: 'column', flex_justify_content: 'center', _flex_grow: '1' },
         [{ elType: 'widget', widgetType: 'image', settings: { image: { url: heroBgImg.src }, image_size: 'full', align: 'right', width: { unit: '%', size: '100' }, _element_width: 'initial' } }])]
    );
  } else if (sec.columns === 2) {
    const left = content.filter((b) => b.col !== 1);
    const right = content.filter((b) => b.col === 1);
    const colSettings = { content_width: 'full', flex_direction: 'column', flex_gap: dim(14), flex_align_items: 'flex-start', _flex_grow: '1', _flex_shrink: '1' };
    inner = container(
      { content_width: 'boxed', flex_direction: 'row', flex_wrap: 'wrap', flex_gap: dim(48), flex_align_items: 'center', flex_justify_content: 'space-between' },
      [container({ ...colSettings }, left.map((b) => widget(b, bg)).filter(Boolean)),
       container({ ...colSettings }, right.map((b) => widget(b, bg)).filter(Boolean))]
    );
  } else {
    inner = container(
      { content_width: 'boxed', flex_direction: 'column', flex_gap: dim(14), flex_align_items: bgDark ? 'center' : 'flex-start' },
      content.map((b) => widget(b, bg)).filter(Boolean)
    );
  }
  return container(secSettings, navRow ? [navRow, inner] : [inner]);
}

function buildTree(tree) {
  const sections = tree.sections.map((s, i) => buildSection(s, i, tree.heroIdx ?? 0));
  // load the substitute font once, host-portable (no plugin deploy)
  const fontLoader = { elType: 'widget', widgetType: 'html', settings: { html: "<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');</style>" } };
  return container({ content_width: 'full', flex_direction: 'column', flex_gap: dim(0), _padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } }, [fontLoader, ...sections]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function jp(method, path, body) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch { j = { raw: txt.slice(0, 300) }; }
    if (r.status === 429) { const wait = Math.max(((j.details && j.details.retry_after) || 2), (attempt + 1) * 2) * 1000 + 500; await sleep(wait); continue; }
    if (!r.ok) console.error(method, path, '->', r.status, JSON.stringify(j).slice(0, 300));
    return { status: r.status, j };
  }
  return { status: 429, j: { code: 'rate_limit.exhausted' } };
}

(async () => {
  const root = buildTree(tree);
  const count = (el) => 1 + (el.elements || []).reduce((a, c) => a + count(c), 0);
  console.log('native tree:', count(root), 'elements,', tree.sectionCount, 'sections');
  const reusePage = arg('page') ? +arg('page') : 0;
  const steps = [{ op: 'insert', parent_id: 'root', position: 0, element: root }];
  const create = await jp('POST', '/wp-json/joist/v1/plans', { intent: 'native-tree clone (Stage 2)', title, page_id: reusePage, steps });
  const planId = create.j.plan_id, token = create.j.approval_token; let pageId = create.j.page_id;
  if (!planId) { console.error('create failed', create.status, JSON.stringify(create.j).slice(0, 400)); process.exit(1); }
  if (!pageId) { const g = await jp('GET', `/wp-json/joist/v1/plans/${planId}`, null); pageId = g.j.page_id; }
  console.log('plan', planId, 'page', pageId, reusePage ? '(reused)' : '(new)');
  await sleep(3000); // pace writes — bursts exhaust the server write bucket
  await jp('POST', `/wp-json/joist/v1/plans/${planId}/approve`, { approval_token: token });
  await sleep(3000);
  const exec = await jp('POST', `/wp-json/joist/v1/plans/${planId}/execute`, {});
  console.log('execute ->', exec.status, JSON.stringify(exec.j).slice(0, 200));
  const pg = await jp('GET', `/wp-json/wp/v2/pages/${pageId}?context=edit`, null);
  console.log('PAGE_URL:', pg.j.link || ('(page ' + pageId + ')'));
  fs.writeFileSync('last-tree-clone.json', JSON.stringify({ planId, pageId, url: pg.j.link }, null, 2));
})();
