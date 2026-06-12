#!/usr/bin/env node
/**
 * @purpose transpile-html.mjs — HTML-first pipeline v1 (PATH_TO_TRUE_1TO1.md §8c): deterministically transpile a
 * vision-authored single-file HTML/CSS page into a native Elementor container tree (containers + heading /
 * text-editor / button / image / html widgets), validate it, and PUT it to a Joist-equipped WP page.
 * Promotion of the proven clerk-hero spike transpiler (/tmp/htmlfirst/transpile.mjs, page 24647, judge tiles
 * 72/82 @1440 + 78/72 @1100) with the six-item spike pain list fixed.
 *
 * USAGE
 *   node transpile-html.mjs --html <file.html> [--width 1440] [--assets <manifest.json>]
 *        [--out /tmp/htmlfirst-v1] [--dry-run] [--page <id> | --create [--title "..."]]
 *        [--no-server-validate] [--base <wp base url>]
 *   --dry-run: no network at all (no upload, no server validate, no PUT); writes tree.json + report.json to --out.
 *   Env: JOIST_AUTH_B64 (+ optional JOIST_BASE) required unless --dry-run.
 *
 * ASSETS MANIFEST (from capture-assets; tolerant format)
 *   { "assets": [ { "src": "<img src as it appears in the HTML (url, path or basename)>",
 *                   "file": "/abs/local/path.png",        // uploaded to WP media when needed
 *                   "url": "https://...", "id": 123 } ] } // optional: already-uploaded → used as-is, no upload
 *   or a flat map { "<src>": "/abs/local/path.png" }. Matching: exact src → exact manifest.src → basename.
 *   Upload reuses the proven WP media REST path (upload.mjs): POST /wp-json/wp/v2/media, Basic auth,
 *   Content-Type by extension. Uploads are content-hash cached in <out>/uploads.json (idempotent re-runs).
 *
 * POLICIES (the spike pain list, each deterministic + logged)
 *  P1 BUTTON ICONS: a button's leading/trailing styled <span> whose text is a known arrow/chevron/mark glyph
 *     becomes the native button icon control: selected_icon {value:'fas fa-*', library:'fa-solid'} +
 *     icon_align left|right + icon_indent from the button's column-gap. An empty round bg-box span maps to
 *     fas fa-circle (inherits text color). A styled span with real text (e.g. a colored "G") merges its text
 *     into the button text (PAIN: span color/weight lost — Elementor button text is plain).
 *  P2 COMPUTED VALUES: any declared length using clamp()/calc()/max()/min() is frozen to the COMPUTED px at
 *     the authoring width (--width, default 1440). Elementor controls cannot express CSS math. POLICY-logged.
 *  P3 BREAKPOINTS (desktop-first, max-width queries only):
 *       W <= 767           → native *_mobile controls (+ custom_css @media only for unmapped declarations)
 *       767 < W <= 1024    → native *_tablet controls (+ custom_css @media only for unmapped declarations)
 *       W > 1024 (custom)  → BOTH the native *_tablet controls AND a scoped per-element custom_css
 *                            `@media (max-width:Wpx){ selector{...} }` carrying ALL declarations, so the
 *                            behavior lands at the author's exact width (tablet control alone stops at 1024).
 *     Channel: per-element `custom_css` (Elementor Pro `selector` placeholder) — the one kses-safe CSS channel
 *     PROVEN to compile on this atomic build (see plugin FlexWidthFiller). Declarations in the custom channel
 *     get `!important` so they beat same-element control CSS inside the media range. min-width queries are
 *     PAIN-logged and skipped (authoring contract is desktop-first).
 *     Mapped responsive controls: flex-direction, align-items, justify-content, padding (containers);
 *     text-align (text widgets, incl. inherited from an ancestor's media rule); width px/% ; display:none →
 *     hide_tablet/hide_mobile. Everything else rides the custom_css channel verbatim.
 *  P4 ROW CHILDREN: a container child of a flex-row parent with no declared width gets an explicit px width
 *     (rendered rect + ROW_CHILD_BUFFER_PX) and _flex_size:'custom' + _flex_shrink:0 — e-con children default
 *     to width:100% and would hog the row; the buffer absorbs sub-pixel/font rendering drift (spike-proven).
 *  P5 MARGIN AUTO: declared margin-left:auto on a child → row parent gets flex_justify_content:'space-between'
 *     (pushes the trailing group right); margin-left+right:auto in a column parent → parent gets
 *     flex_align_items:'center' (spike-proven on the clerk hero). A boxed wrapper (declared px max-width +
 *     margin auto both sides) becomes content_width:'boxed' with boxed_width = max-width − horizontal padding.
 *  P6 IMAGERY: <img> resolving through the assets manifest → uploaded to WP media → native image widget
 *     ({image:{url,id}, image_size:'full', width px}). <img> with NO manifest entry → image widget hot-linking
 *     the original src (PAIN). Inline <svg> → serialized to <out>/svg-<hash>.svg and uploaded as image/svg+xml;
 *     if WP rejects the svg mime (default WP blocks svg) → html-widget fallback carrying the inline SVG markup
 *     (documented + POLICY-logged; the DOM-transplant lineage proved html widgets render on this site).
 *
 * VALIDATION: local structural schema checks always (elType/widgetType whitelist, dims/size/color/icon shapes,
 * elements arrays, JSON-safety); plus server-side POST /joist/v1/widgets/validate per unique
 * (widgetType, settings-keys) signature before PUT (containers are not widgets — local checks only).
 * Validation failure blocks the PUT.
 *
 * DETERMINISM: same input HTML + manifest (+ same chromium/fonts) → byte-identical tree.json: fixed viewport,
 * DOM-order walks, no ids (server assigns), no timestamps/randomness in the tree, content-hash upload cache.
 * Selftest: _transpile-selftest.mjs (per-construct assertions on a synthetic pain-list fixture + the spike hero).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { chromium } from 'playwright';

export const ROW_CHILD_BUFFER_PX = 12; // P4: e-con row-child px pin buffer (spike-proven)

// ── icon glyph map (P1) ─────────────────────────────────────────────────────────────────────────────────────
export const ICON_GLYPHS = {
  '▸': 'fa-caret-right', '‣': 'fa-caret-right', '▶': 'fa-caret-right', '►': 'fa-caret-right',
  '→': 'fa-arrow-right', '⟶': 'fa-arrow-right', '›': 'fa-angle-right', '❯': 'fa-angle-right',
  '▾': 'fa-caret-down', '▼': 'fa-caret-down', '⌄': 'fa-angle-down', '﹀': 'fa-angle-down',
  '◂': 'fa-caret-left', '◀': 'fa-caret-left', '←': 'fa-arrow-left', '‹': 'fa-angle-left', '❮': 'fa-angle-left',
  '▴': 'fa-caret-up', '▲': 'fa-caret-up', '✓': 'fa-check', '✔': 'fa-check',
  '✕': 'fa-times', '×': 'fa-times', '✱': 'fa-asterisk', '✳': 'fa-asterisk',
  '+': 'fa-plus', '＋': 'fa-plus', '●': 'fa-circle', '•': 'fa-circle',
};

// ── shared helpers ──────────────────────────────────────────────────────────────────────────────────────────
const px = (v) => { const m = String(v || '').match(/(-?\d+(?:\.\d+)?)px/); return m ? Math.round(+m[1]) : 0; };
const pxf = (v) => { const m = String(v || '').match(/(-?\d+(?:\.\d+)?)px/); return m ? +m[1] : 0; };
const hex = (rgb) => {
  const m = String(rgb || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null; if (m[4] !== undefined && +m[4] === 0) return null;
  return '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('');
};
const dims = (t, r, b, l, unit = 'px') => ({ unit, top: String(t), right: String(r), bottom: String(b), left: String(l), isLinked: t === r && r === b && b === l });
const CSS_MATH = /clamp\(|calc\(|max\(|min\(/;
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const GENERIC_FONTS = new Set(['ui-sans-serif', '-apple-system', 'system-ui', 'blinkmacsystemfont', 'sans-serif', 'serif', 'monospace', 'ui-monospace', 'ui-serif', 'ui-rounded']);

const ALIGN = { center: 'center', right: 'right', left: 'left', start: 'left', '-webkit-center': 'center' };

// ── 1. extract a style-resolved spec tree from the rendered HTML ───────────────────────────────────────────
export async function extract(htmlFile, width) {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width, height: 1200 } })).newPage();
  await page.goto(pathToFileURL(path.resolve(htmlFile)).href, { waitUntil: 'load' });
  const spec = await page.evaluate(() => {
    const notes = [];
    const declared = (el) => {
      const out = {};
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules) {
          if (rule.type === 1) {
            let hit = false; try { hit = el.matches(rule.selectorText); } catch {}
            if (!hit) continue;
            for (const p of ['width', 'max-width', 'height', 'min-height', 'margin-left', 'margin-right',
              'padding-left', 'padding-right', 'min-height']) {
              const v = rule.style.getPropertyValue(p); if (v) out[p] = v;
            }
          }
        }
      }
      return out;
    };
    // P3: full media-rule capture — every (max-width: Npx) declaration block that matches this element.
    const mediaOf = (el) => {
      const out = [];
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules) {
          if (rule.type !== 4) continue;
          const cond = rule.conditionText || rule.media?.mediaText || '';
          const m = /max-width:\s*([\d.]+)px/.exec(cond);
          if (!m) {
            if (/min-width/.test(cond)) notes.push(`min-width media query skipped (desktop-first contract): @media ${cond}`);
            continue;
          }
          const w = Math.round(+m[1]);
          for (const r of rule.cssRules) {
            if (r.type !== 1) continue;
            let hit = false; try { hit = el.matches(r.selectorText); } catch {}
            if (!hit) continue;
            const decls = {};
            for (let i = 0; i < r.style.length; i++) { const p = r.style[i]; decls[p] = r.style.getPropertyValue(p); }
            const ex = out.find((o) => o.w === w);
            if (ex) Object.assign(ex.decls, decls); else out.push({ w, decls });
          }
        }
      }
      return out.sort((a, b) => b.w - a.w);
    };
    const INLINE_PROPS = ['color', 'font-size', 'font-weight', 'letter-spacing', 'margin-left', 'margin-right', 'vertical-align'];
    const inlineSpan = (sp, parentCs) => {
      const cs = getComputedStyle(sp); let st = '';
      for (const p of INLINE_PROPS) { const v = cs.getPropertyValue(p); if (v && v !== parentCs.getPropertyValue(p) && v !== '0px' && v !== 'normal') st += `${p}:${v};`; }
      if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        st += `display:inline-block;width:${cs.width};height:${cs.height};background:${cs.backgroundColor};border-radius:${cs.borderRadius};vertical-align:middle;`;
      }
      return st;
    };
    const leafHTML = (el) => {
      const cs = getComputedStyle(el);
      const gapSep = parseFloat(cs.columnGap) >= 4 ? '&nbsp;' : '';
      let html = ''; let prevWasEl = false;
      for (const n of el.childNodes) {
        if (n.nodeType === 3) { if (prevWasEl && gapSep && !/^\s/.test(n.textContent)) html += gapSep; html += n.textContent; prevWasEl = false; }
        else if (n.nodeType === 1 && n.tagName === 'BR') { html += '<br>'; prevWasEl = false; }
        else if (n.nodeType === 1) {
          if (prevWasEl && gapSep) html += gapSep;
          const st = inlineSpan(n, cs);
          html += `<span${st ? ` style="${st}"` : ''}>${n.textContent}</span>`;
          prevWasEl = true;
        }
      }
      return html.replace(/[ \t\n]+/g, ' ').trim();
    };
    // P1: ordered child parts so the mapper can lift icon spans out of buttons.
    const partsOf = (el) => {
      const parts = [];
      for (const n of el.childNodes) {
        if (n.nodeType === 3) { if (n.textContent.trim()) parts.push({ t: 'text', text: n.textContent }); }
        else if (n.nodeType === 1 && n.tagName !== 'BR') {
          const c = getComputedStyle(n);
          const w = parseFloat(c.width) || 0;
          parts.push({
            t: 'span', text: n.textContent, empty: !n.textContent.trim(),
            bg: c.backgroundColor !== 'rgba(0, 0, 0, 0)' ? c.backgroundColor : null,
            round: w > 0 && parseFloat(c.borderRadius) >= w / 2,
            color: c.color,
          });
        }
      }
      return parts;
    };
    const ser = (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (el.tagName === 'IMG') {
        return {
          tag: 'img', cls: el.className || '', isLeaf: true, text: null,
          src: el.getAttribute('src') || '', resolvedSrc: el.currentSrc || el.src || '', alt: el.alt || '',
          attrW: parseInt(el.getAttribute('width'), 10) || 0,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          declared: declared(el), media: mediaOf(el), s: {},
        };
      }
      if (el.tagName.toLowerCase() === 'svg') {
        return {
          tag: 'svg', cls: (el.getAttribute('class') || ''), isLeaf: true, text: null,
          svg: el.outerHTML.replace(/\s+/g, ' ').trim(),
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          declared: declared(el), media: mediaOf(el), s: {},
        };
      }
      const kids = [...el.children];
      const isBtnish = el.tagName === 'A' && parseFloat(cs.borderRadius) >= 10;
      const boxKid = kids.some((k) => { const c = getComputedStyle(k).backgroundColor; return c && c !== 'rgba(0, 0, 0, 0)' && k.textContent.trim() === ''; });
      const isLeaf = kids.length === 0 || (kids.every((k) => ['SPAN', 'BR'].includes(k.tagName)) && (!boxKid || isBtnish));
      const node = {
        tag: el.tagName.toLowerCase(), cls: el.className || '', isLeaf,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        declared: declared(el), media: mediaOf(el),
        text: isLeaf ? leafHTML(el) : null,
        parts: isLeaf ? partsOf(el) : null,
        s: {},
      };
      for (const p of ['display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'row-gap', 'column-gap',
        'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
        'background-color', 'box-shadow', 'min-height', 'flex-grow', 'font-family',
        'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
        'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
        'border-radius', 'color', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align']) {
        node.s[p] = cs.getPropertyValue(p);
      }
      node.autoML = (node.declared['margin-left'] || '') === 'auto';
      node.autoMR = (node.declared['margin-right'] || '') === 'auto';
      if (!isLeaf) node.children = kids.map(ser);
      return node;
    };
    return { tree: ser(document.body), notes };
  });
  await browser.close();
  return spec;
}

// ── 2. map spec → Elementor tree ────────────────────────────────────────────────────────────────────────────
export function makeMapper({ assetMap = new Map(), authoringWidth = 1440 } = {}) {
  const PAIN = []; const POLICY = [];
  const pain = (m) => { if (!PAIN.includes(m)) PAIN.push(m); };
  const policy = (m) => { if (!POLICY.includes(m)) POLICY.push(m); };
  const counts = { container: 0, heading: 0, 'text-editor': 0, button: 0, image: 0, html: 0 };

  const fontFamily = (s) => {
    for (let f of String(s['font-family'] || '').split(',')) {
      f = f.trim().replace(/^["']|["']$/g, '');
      if (f && !GENERIC_FONTS.has(f.toLowerCase())) return f;
    }
    return 'Helvetica Neue';
  };

  function typo(s) {
    const o = { typography_typography: 'custom', typography_font_family: fontFamily(s) };
    o.typography_font_size = { unit: 'px', size: pxf(s['font-size']) };
    o.typography_font_weight = String(parseInt(s['font-weight'], 10) || 400);
    const lh = pxf(s['line-height']); if (lh) o.typography_line_height = { unit: 'px', size: lh };
    const ls = s['letter-spacing']; if (ls && ls !== 'normal') o.typography_letter_spacing = { unit: 'px', size: +pxf(ls).toFixed(2) };
    return o;
  }

  // P2: declared CSS-math lengths freeze to the computed px at the authoring width.
  function mathFrozen(decl, computedPx, what, n) {
    policy(`P2 computed-value: ${what} "${decl}" → ${computedPx}px (computed at ${authoringWidth}px authoring width; Elementor controls cannot express CSS math) on <${n.tag}${n.cls ? ` class="${n.cls}"` : ''}>`);
    return computedPx;
  }

  function widthSettings(n) {
    const d = n.declared || {}; const out = {};
    const w = d.width || '';
    if (/%$/.test(w)) out.width = { unit: '%', size: +w.replace('%', '') };
    else if (/px$/.test(w) && !CSS_MATH.test(w)) out.width = { unit: 'px', size: px(w) };
    else if (CSS_MATH.test(w)) out.width = { unit: 'px', size: mathFrozen(w, n.rect.w, 'width', n) };
    else if (d['max-width'] && /px$/.test(d['max-width']) && !CSS_MATH.test(d['max-width']) && n.rect.w >= px(d['max-width']) - 1) out.width = { unit: 'px', size: px(d['max-width']) };
    if (d['min-height']) {
      if (CSS_MATH.test(d['min-height'])) out.min_height = { unit: 'px', size: mathFrozen(d['min-height'], n.rect.h, 'min-height', n) };
      else out.min_height = { unit: 'px', size: px(d['min-height']) };
    }
    if (d.height && /px$/.test(d.height) && !CSS_MATH.test(d.height)) out.min_height = { unit: 'px', size: px(d.height) };
    else if (d.height && CSS_MATH.test(d.height)) out.min_height = { unit: 'px', size: mathFrozen(d.height, n.rect.h, 'height', n) };
    return out;
  }

  function borderSettings(s) {
    const out = {};
    const widths = ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'].map((p) => px(s[p]));
    if (widths.some((w) => w > 0)) {
      out.border_border = 'solid';
      out.border_width = dims(...widths);
      const sideIdx = widths.findIndex((w) => w > 0);
      out.border_color = hex(s[['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'][sideIdx]]) || '#ececef';
    }
    return out;
  }

  // P3: responsive controls + scoped custom_css channel.
  const MEDIA_MAPPED = new Set(['flex-direction', 'align-items', 'justify-content', 'text-align', 'width', 'display',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left']);
  function applyMedia(n, settings, kind /* 'container' | text widget align key | null */) {
    const cssBlocks = [];
    for (const m of n.media || []) {
      const sfx = m.w <= 767 ? '_mobile' : '_tablet';
      const unmapped = {};
      const padSides = {};
      for (const [p, v] of Object.entries(m.decls)) {
        let mapped = false;
        if (kind === 'container') {
          if (p === 'flex-direction') { settings['flex_direction' + sfx] = v === 'row' ? 'row' : 'column'; mapped = true; }
          else if (p === 'align-items') { settings['flex_align_items' + sfx] = v; mapped = true; }
          else if (p === 'justify-content') { settings['flex_justify_content' + sfx] = v; mapped = true; }
          else if (/^padding-(top|right|bottom|left)$/.test(p) && /px$/.test(v) && !CSS_MATH.test(v)) { padSides[p.slice(8)] = px(v); mapped = true; }
        } else if (kind && p === 'text-align' && ALIGN[v]) { settings[kind + sfx] = ALIGN[v]; mapped = true; }
        if (p === 'width') {
          if (/%$/.test(v)) { settings['width' + sfx] = { unit: '%', size: +v.replace('%', '') }; mapped = true; }
          else if (/px$/.test(v) && !CSS_MATH.test(v)) { settings['width' + sfx] = { unit: 'px', size: px(v) }; mapped = true; }
        }
        if (p === 'display' && v === 'none') {
          if (sfx === '_mobile') settings.hide_mobile = 'hidden-phone'; else settings.hide_tablet = 'hidden-tablet';
          mapped = true;
        }
        if (!mapped) unmapped[p] = v;
      }
      if (Object.keys(padSides).length) {
        const base = ['top', 'right', 'bottom', 'left'].map((side) => padSides[side] ?? px(n.s['padding-' + side]));
        settings['padding' + sfx] = dims(...base);
      }
      const declCss = (decls) => Object.entries(decls).map(([p, v]) => `${p}:${v} !important`).join(';');
      if (m.w > 1024) {
        // custom breakpoint: native tablet controls above + exact-width scoped css with ALL declarations
        cssBlocks.push(`@media (max-width:${m.w}px){selector{${declCss(m.decls)}}}`);
        policy(`P3 breakpoint: @media (max-width:${m.w}px) on <${n.tag}${n.cls ? ` class="${n.cls}"` : ''}> → tablet controls (<=1024) + scoped custom_css at ${m.w}px (Elementor breakpoints: tablet<=1024, mobile<=767)`);
      } else if (Object.keys(unmapped).length) {
        cssBlocks.push(`@media (max-width:${m.w}px){selector{${declCss(unmapped)}}}`);
        policy(`P3 breakpoint: @media (max-width:${m.w}px) unmapped declarations [${Object.keys(unmapped).join(', ')}] on <${n.tag}${n.cls ? ` class="${n.cls}"` : ''}> → scoped custom_css`);
      }
    }
    if (cssBlocks.length) settings.custom_css = (settings.custom_css ? settings.custom_css + '\n' : '') + cssBlocks.join('\n');
  }

  // text-align declared in an ANCESTOR's media rule inherits into text leaves → native align controls there.
  function inheritedAligns(n, parentInherit) {
    const out = [...(parentInherit || [])];
    for (const m of n.media || []) {
      const v = m.decls['text-align'];
      if (v && ALIGN[v]) out.push({ w: m.w, align: ALIGN[v] });
    }
    return out;
  }
  function applyInheritedAlign(settings, alignKey, inherit) {
    for (const ia of inherit || []) {
      const sfx = ia.w <= 767 ? '_mobile' : '_tablet';
      if (settings[alignKey + sfx] === undefined) settings[alignKey + sfx] = ia.align;
      if (ia.w > 1024) settings.custom_css = (settings.custom_css ? settings.custom_css + '\n' : '') + `@media (max-width:${ia.w}px){selector{text-align:${ia.align} !important}}`;
    }
  }

  function containerSettings(n) {
    const s = n.s; const out = { content_width: 'full', padding: dims(0, 0, 0, 0) };
    out.flex_direction = (s.display.includes('flex') && s['flex-direction'] === 'row') ? 'row' : 'column';
    if (s['justify-content'] && !['normal', 'flex-start'].includes(s['justify-content'])) out.flex_justify_content = s['justify-content'];
    if (s['align-items'] && !['normal', 'stretch'].includes(s['align-items'])) out.flex_align_items = s['align-items'];
    if (s['flex-wrap'] === 'wrap') out.flex_wrap = 'wrap';
    const gap = Math.max(px(s['row-gap']), px(s['column-gap']));
    out.flex_gap = { unit: 'px', size: gap, column: String(gap), row: String(gap), isLinked: true };
    const pads = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].map((p) => px(s[p]));
    if (pads.some(Boolean)) out.padding = dims(...pads);
    for (const p of ['padding-left', 'padding-right']) {
      if (CSS_MATH.test((n.declared || {})[p] || '')) mathFrozen(n.declared[p], px(s[p]), p, n);
    }
    const bg = hex(s['background-color']); if (bg) { out.background_background = 'classic'; out.background_color = bg; }
    Object.assign(out, borderSettings(s));
    const rad = s['border-radius'];
    if (rad && rad !== '0px') {
      if (rad.includes('%')) out.border_radius = { unit: '%', top: '50', right: '50', bottom: '50', left: '50', isLinked: true };
      else out.border_radius = dims(px(rad), px(rad), px(rad), px(rad));
    }
    if (s['box-shadow'] && s['box-shadow'] !== 'none') {
      const m = s['box-shadow'].match(/(rgba?\([^)]+\))\s+(-?\d+)px\s+(-?\d+)px\s+(\d+)px\s+(-?\d+)px/);
      if (m) { out.box_shadow_box_shadow_type = 'yes'; out.box_shadow_box_shadow = { horizontal: +m[2], vertical: +m[3], blur: +m[4], spread: +m[5], color: m[1] }; }
    }
    if (s['flex-grow'] && +s['flex-grow'] > 0) { out._flex_size = 'custom'; out._flex_grow = +s['flex-grow']; }
    const mt = px(s['margin-top']);
    const mrDecl = (n.declared || {})['margin-right'] || '';
    const mr = /px$/.test(mrDecl) && !CSS_MATH.test(mrDecl) ? px(mrDecl) : 0; // ONLY explicit px margins; computed 'auto' resolves to px and must not be baked in
    if (mt || mr) out.margin = dims(mt, mr, 0, 0);
    Object.assign(out, widthSettings(n));
    return out;
  }

  const isContainerish = (n) => {
    const d = n.declared || {};
    const hasBorder = ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'].some((p) => px(n.s[p]) > 0);
    return hasBorder || /%$/.test(d.width || '') || !!d['min-height'] || (/px$/.test(d.width || '') && /px$/.test(d.height || ''));
  };

  function widgetCommon(n) {
    const out = {};
    const mt = px(n.s['margin-top']);
    if (mt) out._margin = dims(mt, 0, 0, 0);
    return out;
  }

  function textEditor(n, parent, inherit) {
    counts['text-editor']++;
    let align = ALIGN[n.s['text-align']] || 'left';
    if (parent && parent.s && parent.s.display.includes('flex') && parent.s['flex-direction'] === 'row' && parent.s['justify-content'] === 'center') align = 'center';
    const d = n.declared || {};
    let inner = n.text;
    let style = 'margin:0';
    if (/display:inline-block/.test(inner)) style += `;white-space:nowrap;min-width:${n.rect.w}px`;
    if (d['max-width'] && /px$/.test(d['max-width']) && !CSS_MATH.test(d['max-width']) && !(d.width)) {
      style += `;max-width:${px(d['max-width'])}px`;
      if (align === 'center') style += ';margin-left:auto;margin-right:auto';
    }
    const set = {
      editor: `<div style="${style}">${inner}</div>`,
      align, text_color: hex(n.s.color) || '#131316', ...typo(n.s), ...widgetCommon(n),
    };
    if (parent && parent.s && parent.s.display.includes('flex') && parent.s['flex-direction'] === 'row') {
      set._element_width = 'auto';
      if (/display:inline-block/.test(inner)) { set._element_width = 'initial'; set._element_custom_width = { unit: 'px', size: n.rect.w }; }
    }
    applyMedia(n, set, 'align');
    applyInheritedAlign(set, 'align', inherit);
    return { elType: 'widget', widgetType: 'text-editor', settings: set };
  }

  // P1: split a button's child parts into (icon, icon position, plain text).
  function buttonContent(n) {
    const parts = (n.parts || []).slice();
    const glyphOf = (p) => {
      if (!p || p.t !== 'span') return null;
      const g = p.text.trim();
      if (g.length === 1 && ICON_GLYPHS[g]) return ICON_GLYPHS[g];
      if (p.empty && p.bg && p.round) return 'fa-circle'; // empty round bg-box (e.g. brand circle)
      return null;
    };
    let icon = null; let iconAlign = null;
    const last = parts[parts.length - 1]; const first = parts[0];
    if (glyphOf(last)) { icon = glyphOf(last); iconAlign = 'right'; parts.pop(); }
    else if (glyphOf(first)) { icon = glyphOf(first); iconAlign = 'left'; parts.shift(); }
    let text = '';
    for (const p of parts) {
      if (p.t === 'text') text += (text && !/\s$/.test(text) && !/^\s/.test(p.text) ? ' ' : '') + p.text;
      else {
        text += (text && !/\s$/.test(text) ? ' ' : '') + p.text;
        if (p.text.trim()) pain(`P1 button span: styled inline span "${p.text.trim().slice(0, 20)}" merged into plain button text (span color/weight lost — Elementor button text is plain)`);
      }
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (!text && !icon) text = String(n.text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (icon) policy(`P1 button icon: "${text.slice(0, 30)}" → selected_icon fas ${icon} (${iconAlign})`);
    return { icon, iconAlign, text };
  }

  function buttonWidget(n, parent) {
    counts.button++;
    const fs_ = pxf(n.s['font-size']);
    const lh = pxf(n.s['line-height']) || fs_;
    const bw = px(n.s['border-top-width']);
    const vpad = Math.max(0, Math.round((n.rect.h - 2 * bw - lh) / 2));
    const { icon, iconAlign, text } = buttonContent(n);
    const set = {
      text,
      button_text_color: hex(n.s.color) || '#131316',
      ...typo(n.s),
      typography_line_height: { unit: 'px', size: lh },
      border_radius: dims(px(n.s['border-radius']), px(n.s['border-radius']), px(n.s['border-radius']), px(n.s['border-radius'])),
      text_padding: dims(vpad, px(n.s['padding-right']) || 16, vpad, px(n.s['padding-left']) || 16),
      background_background: 'classic',
      background_color: hex(n.s['background-color']) || '#FFFFFF',
      ...borderSettings(n.s),
      ...widgetCommon(n),
    };
    if (icon) {
      set.selected_icon = { value: 'fas ' + icon, library: 'fa-solid' };
      set.icon_align = iconAlign;
      const gap = px(n.s['column-gap']);
      if (gap) set.icon_indent = { unit: 'px', size: gap };
    }
    if (parent && parent.s['flex-direction'] === 'column' && n.rect.w > 250) set.align = 'justify';
    applyMedia(n, set, null);
    return { elType: 'widget', widgetType: 'button', settings: set };
  }

  // P6: imagery — manifest-resolved uploads → native image widgets; inline svg → uploaded svg or html fallback.
  function imageWidget(n, parent) {
    const key = n.tag === 'svg' ? 'inline-svg:' + sha1(n.svg).slice(0, 12) : (n.src || n.resolvedSrc);
    const asset = assetMap.get(key) || assetMap.get(path.basename(String(key))) || null;
    if (n.tag === 'svg' && (!asset || !asset.url)) {
      counts.html++;
      policy(`P6 inline svg ${key}: html-widget fallback (no uploaded URL — WP blocks image/svg+xml by default); markup preserved verbatim`);
      const set = { html: n.svg, ...widgetCommon(n) };
      applyMedia(n, set, null);
      return { elType: 'widget', widgetType: 'html', settings: set };
    }
    counts.image++;
    let url; let id;
    if (asset && asset.url) { url = asset.url; id = asset.id; }
    else if (asset && asset.pendingFile) { url = pathToFileURL(asset.pendingFile).href; policy(`P6 image ${key}: dry-run — upload pending for ${asset.pendingFile}`); }
    else { url = n.resolvedSrc || n.src; pain(`P6 image "${n.src}": no assets-manifest entry — hot-linking original src (capture-assets should supply this file)`); }
    const set = {
      image: { url, ...(id ? { id } : {}) },
      image_size: 'full',
      width: { unit: 'px', size: (n.declared && /px$/.test(n.declared.width || '') && !CSS_MATH.test(n.declared.width)) ? px(n.declared.width) : (n.attrW || n.rect.w) },
      ...widgetCommon(n),
    };
    if (parent && parent.s && parent.s.display.includes('flex') && parent.s['flex-direction'] === 'row') set._element_width = 'auto';
    applyMedia(n, set, 'align');
    return { elType: 'widget', widgetType: 'image', settings: set };
  }

  function mapNode(n, parent, inherit) {
    const cls = (c) => String(n.cls).split(/\s+/).includes(c);
    const childInherit = inheritedAligns(n, inherit);
    if (n.tag === 'img' || n.tag === 'svg') return imageWidget(n, parent);
    if (n.isLeaf) {
      if (!n.text) { // empty box: divider / dot / filler
        counts.container++;
        const st = containerSettings(n);
        if (n.rect.w <= 2) { st.width = { unit: 'px', size: 1 }; st.min_height = { unit: 'px', size: n.rect.h }; }
        applyMedia(n, st, 'container');
        return { elType: 'container', settings: st, elements: [] };
      }
      const isBtnEl = n.tag === 'a' && px(n.s['border-radius']) >= 10;
      if (isContainerish(n) && !/^h[1-6]$/.test(n.tag) && !isBtnEl) { // styled box that contains text (logo cells, app icon)
        counts.container++;
        const st = containerSettings(n);
        applyMedia(n, st, 'container');
        const child = textEditor({ ...n, declared: {}, media: [], s: { ...n.s, 'margin-top': '0px' } }, n, childInherit);
        return { elType: 'container', settings: st, elements: [child] };
      }
      if (/^h[1-6]$/.test(n.tag)) {
        counts.heading++;
        const set = {
          title: n.text, header_size: n.tag,
          align: ALIGN[n.s['text-align']] || 'left',
          title_color: hex(n.s.color) || '#131316', ...typo(n.s), ...widgetCommon(n),
        };
        applyMedia(n, set, 'align');
        applyInheritedAlign(set, 'align', inherit);
        return { elType: 'widget', widgetType: 'heading', settings: set };
      }
      if (isBtnEl) return buttonWidget(n, parent);
      return textEditor(n, parent, inherit);
    }
    counts.container++;
    const settings = containerSettings(n);
    // P5: boxed wrapper — declared px max-width + margin:auto both sides → Elementor boxed content width.
    const d = n.declared || {};
    if (d['max-width'] && /px$/.test(d['max-width']) && !CSS_MATH.test(d['max-width']) && n.autoML && n.autoMR) {
      const padL = px(n.s['padding-left']); const padR = px(n.s['padding-right']);
      settings.content_width = 'boxed';
      settings.boxed_width = { unit: 'px', size: px(d['max-width']) - padL - padR };
      settings.padding = dims(0, padR, 0, padL);
      delete settings.width; delete settings.margin;
    }
    // P4: e-con row children default to 100% width — pin px width + buffer, never shrink.
    if (parent && parent.s && parent.s.display.includes('flex') && parent.s['flex-direction'] === 'row' && !settings.width && !settings._flex_grow) {
      settings.width = { unit: 'px', size: n.rect.w + ROW_CHILD_BUFFER_PX };
      settings._flex_size = 'custom'; settings._flex_shrink = 0;
    }
    // P5: margin-auto heuristics (documented in header).
    if ((n.children || []).some((c) => c.autoML)) {
      if (settings.flex_direction === 'row') settings.flex_justify_content = 'space-between';
      else settings.flex_align_items = 'center';
    }
    applyMedia(n, settings, 'container');
    return { elType: 'container', settings, elements: (n.children || []).map((c) => mapNode(c, n, childInherit)) };
  }

  return { mapNode, counts, PAIN, POLICY };
}

// ── asset manifest resolution + WP media upload (P6) ───────────────────────────────────────────────────────
export function loadManifest(file) {
  if (!file) return [];
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  let entries;
  if (Array.isArray(j.assets)) entries = j.assets;
  else if (Array.isArray(j)) entries = j;
  else entries = Object.entries(j).filter(([k]) => k !== 'note').map(([src, v]) => (typeof v === 'string' ? { src, file: v } : { src, ...v }));
  const dir = path.dirname(path.resolve(file));
  return entries.map((e) => (e.file && !path.isAbsolute(e.file) ? { ...e, file: path.resolve(dir, e.file) } : e));
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' };

export async function uploadMedia(file, { base, b64, cache }) {
  const buf = fs.readFileSync(file);
  const key = sha1(buf);
  if (cache.data[key]) return cache.data[key];
  const name = path.basename(file);
  const ext = name.split('.').pop().toLowerCase();
  const r = await fetch(base + '/wp-json/wp/v2/media', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + b64, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"` },
    body: buf,
  });
  let j = {}; try { j = await r.json(); } catch {}
  if (!j.source_url) throw new Error(`media upload failed for ${name}: ${r.status} ${String(j.code || j.message || '').slice(0, 120)}`);
  cache.data[key] = { url: j.source_url, id: j.id };
  fs.writeFileSync(cache.file, JSON.stringify(cache.data, null, 2));
  return cache.data[key];
}

/** Walk the spec, resolve every img/svg through the manifest, uploading when live. Returns Map + notes. */
export async function resolveAssets(specTree, manifest, { dryRun, base, b64, outDir }) {
  const assetMap = new Map();
  const notes = [];
  const cache = { file: path.join(outDir, 'uploads.json'), data: {} };
  try { cache.data = JSON.parse(fs.readFileSync(cache.file, 'utf8')); } catch {}
  const byExact = new Map(manifest.map((a) => [a.src, a]));
  const byBase = new Map(manifest.map((a) => [path.basename(String(a.src || a.file || '')), a]));
  const nodes = [];
  (function walk(n) { if (n.tag === 'img' || n.tag === 'svg') nodes.push(n); for (const c of n.children || []) walk(c); })(specTree);
  for (const n of nodes) {
    if (n.tag === 'img') {
      const key = n.src || n.resolvedSrc;
      const entry = byExact.get(key) || byExact.get(n.resolvedSrc) || byBase.get(path.basename(String(key))) || null;
      if (!entry) continue; // mapper pains + hotlinks
      if (entry.url) assetMap.set(key, { url: entry.url, id: entry.id });
      else if (entry.file && dryRun) assetMap.set(key, { pendingFile: entry.file });
      else if (entry.file) assetMap.set(key, await uploadMedia(entry.file, { base, b64, cache }));
    } else {
      const key = 'inline-svg:' + sha1(n.svg).slice(0, 12);
      const entry = byExact.get(key) || null;
      if (entry && entry.url) { assetMap.set(key, { url: entry.url, id: entry.id }); continue; }
      if (dryRun) continue; // mapper falls back to html widget
      const svgFile = path.join(outDir, key.replace(':', '-') + '.svg');
      fs.writeFileSync(svgFile, n.svg);
      try { assetMap.set(key, await uploadMedia(svgFile, { base, b64, cache })); }
      catch (e) { notes.push(`P6 inline svg ${key}: upload rejected (${e.message.slice(0, 80)}) → html-widget fallback`); }
    }
  }
  return { assetMap, notes };
}

// ── local schema validation (always-on, blocks PUT) ────────────────────────────────────────────────────────
const WIDGET_TYPES = new Set(['heading', 'text-editor', 'button', 'image', 'html', 'icon', 'divider', 'spacer']);
const DIMS_KEYS = /^(padding|margin|_margin|_padding|border_radius|border_width|text_padding)(_tablet|_mobile)?$/;
const SIZE_KEYS = /^(width|min_height|icon_indent|_element_custom_width|boxed_width)(_tablet|_mobile)?$/;

export function validateTree(elements, errs = [], pathStr = 'root') {
  if (!Array.isArray(elements)) { errs.push(`${pathStr}: elements is not an array`); return errs; }
  elements.forEach((el, i) => {
    const p = `${pathStr}[${i}]`;
    if (!el || typeof el !== 'object') { errs.push(`${p}: not an object`); return; }
    if (el.elType === 'container') {
      if (!Array.isArray(el.elements)) errs.push(`${p}: container missing elements[]`);
    } else if (el.elType === 'widget') {
      if (!WIDGET_TYPES.has(el.widgetType)) errs.push(`${p}: unknown widgetType "${el.widgetType}"`);
      if (el.elements && el.elements.length) errs.push(`${p}: widget must not have children`);
    } else { errs.push(`${p}: bad elType "${el.elType}"`); return; }
    const s = el.settings;
    if (!s || typeof s !== 'object' || Array.isArray(s)) { errs.push(`${p}: settings must be an object`); return; }
    for (const [k, v] of Object.entries(s)) {
      if (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) errs.push(`${p}.${k}: non-JSON-safe value`);
      if (DIMS_KEYS.test(k)) {
        if (!v || typeof v !== 'object' || !('unit' in v) || ['top', 'right', 'bottom', 'left'].some((side) => typeof v[side] !== 'string')) errs.push(`${p}.${k}: bad dims shape`);
      }
      if (SIZE_KEYS.test(k)) {
        if (!v || typeof v !== 'object' || typeof v.size !== 'number' || !Number.isFinite(v.size) || !v.unit) errs.push(`${p}.${k}: bad size shape`);
      }
      if (/_color$/.test(k) && typeof v === 'string' && v && !/^#[0-9a-fA-F]{6}$/.test(v)) errs.push(`${p}.${k}: bad color "${v}"`);
      if (k === 'selected_icon' && (!v || typeof v.value !== 'string' || !v.library)) errs.push(`${p}.${k}: bad icon shape`);
    }
    if (el.elType === 'widget') {
      if (el.widgetType === 'heading' && !s.title) errs.push(`${p}: heading without title`);
      if (el.widgetType === 'text-editor' && !s.editor) errs.push(`${p}: text-editor without editor`);
      if (el.widgetType === 'button' && !s.text && !s.selected_icon) errs.push(`${p}: button without text or icon`);
      if (el.widgetType === 'image' && (!s.image || !s.image.url)) errs.push(`${p}: image without image.url`);
      if (el.widgetType === 'html' && !s.html) errs.push(`${p}: html widget without html`);
    }
    if (el.elements) validateTree(el.elements, errs, p);
  });
  return errs;
}

// ── server-side schema validation: POST /joist/v1/widgets/validate per unique signature ────────────────────
export async function serverValidate(root, { base, b64 }) {
  const widgets = [];
  (function walk(el) { if (el.elType === 'widget') widgets.push(el); for (const c of el.elements || []) walk(c); })(root);
  const seen = new Set(); const errors = []; let checked = 0;
  for (const w of widgets) {
    const sig = w.widgetType + '|' + Object.keys(w.settings).sort().join(',');
    if (seen.has(sig)) continue; seen.add(sig);
    const r = await fetch(base + '/wp-json/joist/v1/widgets/validate', {
      method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: w.widgetType, settings: w.settings }),
    });
    let j = {}; try { j = await r.json(); } catch {}
    checked++;
    const body = j.data || j;
    if (body && body.valid === false) errors.push({ widget: w.widgetType, errors: body.errors });
  }
  return { checked, errors };
}

// ── orchestration ───────────────────────────────────────────────────────────────────────────────────────────
export async function transpile({ html, width = 1440, assets, outDir, dryRun, base, b64 }) {
  fs.mkdirSync(outDir, { recursive: true });
  const spec = await extract(html, width);
  const manifest = loadManifest(assets);
  const { assetMap, notes } = await resolveAssets(spec.tree, manifest, { dryRun, base, b64, outDir });
  const mapper = makeMapper({ assetMap, authoringWidth: width });
  const root = mapper.mapNode(spec.tree, null, []);
  root.settings.content_width = 'full';
  for (const note of new Set([...spec.notes, ...notes])) {
    if (/min-width/.test(note)) { if (!mapper.PAIN.includes(note)) mapper.PAIN.push(note); }
    else if (!mapper.POLICY.includes(note)) mapper.POLICY.push(note);
  }
  const localErrors = validateTree([root]);
  const treeJson = JSON.stringify([root], null, 2);
  fs.writeFileSync(path.join(outDir, 'tree.json'), treeJson);
  const report = {
    html: path.resolve(html), authoringWidth: width, dryRun: !!dryRun,
    counts: mapper.counts, pain: mapper.PAIN, policy: mapper.POLICY,
    validation: { localErrors, server: null },
    treeSha1: sha1(treeJson),
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  return { root, report, mapper };
}

export async function putPage(root, { base, b64, pageId, create, title }) {
  const auth = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json' };
  if (!pageId && create) {
    const cr = await fetch(`${base}/wp-json/wp/v2/pages`, { method: 'POST', headers: auth, body: JSON.stringify({ title: title || 'html-first transpile', status: 'publish' }) });
    const cj = await cr.json();
    if (!cj.id) throw new Error('page create failed: ' + JSON.stringify(cj).slice(0, 200));
    pageId = cj.id;
    console.log('CREATED PAGE ID:', pageId, '(record this in /tmp/htmlfirst-v1/pages.json)');
  }
  const headers = { ...auth, 'X-Joist-Session-Id': 'htmlfirst-' + Date.now() };
  let expected = (await (await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { headers })).json()).elementor?.hash;
  let r; let txt;
  for (let a = 0; a < 5; a++) {
    const body = { expected_hash: expected, elements: [root], page_settings: {}, prefer_literals: true, ...(title ? { title } : {}), intent: 'html-first transpile v1' };
    r = await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { method: 'PUT', headers, body: JSON.stringify(body) });
    txt = await r.text();
    if (r.status !== 409) break;
    try { expected = JSON.parse(txt).details.current_hash; } catch {}
    await new Promise((res) => setTimeout(res, 400));
  }
  if (r.status >= 300) throw new Error(`PUT failed ${r.status}: ${txt.slice(0, 200)}`);
  const mr = await fetch(`${base}/wp-json/wp/v2/pages/${pageId}`, { method: 'POST', headers: auth, body: JSON.stringify({ status: 'publish', template: 'elementor_canvas', meta: { _elementor_edit_mode: 'builder', _wp_page_template: 'elementor_canvas' } }) });
  return { pageId, putStatus: r.status, metaStatus: mr.status, url: `${base}/?page_id=${pageId}` };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
  const has = (k) => process.argv.includes('--' + k);
  const html = arg('html');
  if (!html) { console.error('usage: transpile-html.mjs --html <file> [--width 1440] [--assets m.json] [--out dir] [--dry-run] [--page id | --create] [--title t] [--no-server-validate]'); process.exit(2); }
  const dryRun = has('dry-run');
  const base = arg('base', process.env.JOIST_BASE || 'https://georges232.sg-host.com');
  const b64 = process.env.JOIST_AUTH_B64;
  if (!dryRun && !b64) { console.error('need JOIST_AUTH_B64 (or --dry-run)'); process.exit(2); }
  const outDir = arg('out', '/tmp/htmlfirst-v1/' + path.basename(html).replace(/\.html?$/, ''));
  (async () => {
    const { root, report, mapper } = await transpile({ html, width: +arg('width', 1440), assets: arg('assets'), outDir, dryRun, base, b64 });
    console.log('widget counts:', JSON.stringify(mapper.counts));
    console.log('tree sha1:', report.treeSha1, '→', path.join(outDir, 'tree.json'));
    if (report.validation.localErrors.length) {
      console.error('LOCAL VALIDATION FAILED:'); report.validation.localErrors.forEach((e) => console.error(' -', e));
      process.exit(1);
    }
    console.log('local validation: OK');
    if (!dryRun && !has('no-server-validate')) {
      const sv = await serverValidate(root, { base, b64 });
      report.validation.server = sv;
      fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
      if (sv.errors.length) {
        console.error(`SERVER VALIDATION FAILED (${sv.errors.length}/${sv.checked} signatures):`);
        sv.errors.forEach((e) => console.error(' -', e.widget, JSON.stringify(e.errors).slice(0, 300)));
        process.exit(1);
      }
      console.log(`server validation: OK (${sv.checked} unique widget signatures)`);
    }
    if (mapper.POLICY.length) { console.log('POLICY:'); mapper.POLICY.forEach((p) => console.log(' -', p)); }
    if (mapper.PAIN.length) { console.log('PAIN:'); mapper.PAIN.forEach((p) => console.log(' -', p)); }
    if (dryRun) { console.log('dry-run: no PUT'); return; }
    const pageId = arg('page');
    if (!pageId && !has('create')) { console.log('no --page/--create: transpile-only'); return; }
    const res = await putPage(root, { base, b64, pageId, create: has('create'), title: arg('title') });
    report.put = res;
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log('PUT', res.putStatus, 'meta', res.metaStatus);
    console.log('URL:', res.url);
  })().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
}
