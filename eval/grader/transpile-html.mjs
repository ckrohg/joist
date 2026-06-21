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
import { assertAllowedBase } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: never render/PUT to a non-training host

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
  const spec = await page.evaluate((opts) => {
    const notes = [];
    // LEVER A (reversible: TRANSPILE_NO_VIS_GATE): is this element HIDDEN at the authoring width? Responsive sites ship
    // duplicate DOM (e.g. a mobile nav/hero display:none at 1440). leafHTML still reads a hidden element's text, so
    // without this gate the duplicate gets emitted as a visible Elementor widget → duplicate content + extra page
    // height (resend hero headline rendered 5x in the tree; page 2x too tall). Gate ONLY on the definitive not-painted,
    // not-in-layout signals: display:none + visibility:hidden/collapse. NOT opacity:0 — scroll-reveal / AOS content
    // starts at opacity:0 and animates in on scroll, and transpile loads source.html UN-scrolled, so gating opacity
    // would FALSE-DROP legitimately-visible content.
    const isHiddenEl = (el) => { const c = getComputedStyle(el); return c.display === 'none' || c.visibility === 'hidden' || c.visibility === 'collapse'; };
    const declared = (el) => {
      const out = {};
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules) {
          if (rule.type === 1) {
            let hit = false; try { hit = el.matches(rule.selectorText); } catch {}
            if (!hit) continue;
            for (const p of ['width', 'max-width', 'height', 'min-height', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
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
          // LEVER A': never emit non-rendered text. A leaf div containing an inline <script>/<style> (e.g. a
          // text-wrap-balance polyfill `self.__wrap_n=...`) otherwise has its JS/CSS source grabbed as a visible
          // text widget. Also skip elements hidden at the authoring width (display:none responsive duplicates).
          if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(n.tagName)) continue;
          if (!opts.noVisGate && isHiddenEl(n)) continue;
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
        else if (n.nodeType === 1 && (n.tagName === 'svg' || n.tagName === 'SVG')) {
          // Leading/trailing chevron/arrow inside a CTA pill → icon part. Infer direction from
          // the path 'd' so buttonContent can pick a fa-* glyph even with no unicode text node.
          const d = (n.querySelector('path') ? n.querySelector('path').getAttribute('d') || '' : '');
          let dir = 'right';
          if (/l-?\d.*-?\d.*l/i.test(d) && /M\s*1\s*1l3\.?5?\s*3/i.test(d)) dir = 'down'; // 9x6 chevron-down
          else if (/M\s*1\s*1l4\s*4/i.test(d)) dir = 'right'; // 7x10 arrow-right
          parts.push({ t: 'svgicon', dir, text: '' });
        }
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
      if (!opts.noVisGate && isHiddenEl(el)) return null; // LEVER A: drop hidden / off-breakpoint-duplicate DOM
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      // Capture the layout margin-top for media nodes so widgetCommon can preserve it — without
      // this an <img>'s s:{} dropped e.g. .bill-wedge{margin-top:118px}, losing ~118px of vertical
      // rhythm and under-heighting the section (LEVER 3, 2026-06-12). Only forward an EXPLICIT px
      // margin (declared), never an `auto`-resolved used-value (e.g. .acard img{margin-top:auto},
      // which positions but must not be baked as a fixed gap).
      const _mdecl = declared(el);
      const mediaS = {};
      if (/px$/.test(_mdecl['margin-top'] || '')) mediaS['margin-top'] = cs.marginTop;
      if (el.tagName === 'IMG') {
        // BACKGROUND-LAYER detection (hero-bg fix): a position:absolute/fixed <img> that fills (≈) its offset parent
        // and sits behind content is semantically a CONTAINER BACKGROUND, not an inline image. Flag it so the mapper
        // redirects it to the ancestor container's background_image instead of emitting an inline widget (which, once
        // the image actually loads, pushes all content below the fold). bgFill = covers most of the offset parent.
        const op = el.offsetParent; const opr = op ? op.getBoundingClientRect() : null;
        const coversParent = opr && r.width >= opr.width * 0.9 && r.height >= opr.height * 0.6;
        const isBgLayer = (cs.position === 'absolute' || cs.position === 'fixed') && coversParent;
        return {
          tag: 'img', cls: el.className || '', isLeaf: true, text: null,
          src: el.getAttribute('src') || '', resolvedSrc: el.currentSrc || el.src || '', alt: el.alt || '',
          attrW: parseInt(el.getAttribute('width'), 10) || 0,
          attrH: parseInt(el.getAttribute('height'), 10) || 0,
          natW: el.naturalWidth || 0, natH: el.naturalHeight || 0,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          position: cs.position, isBgLayer, opacity: cs.opacity,
          declared: _mdecl, media: mediaOf(el), s: mediaS,
        };
      }
      if (el.tagName.toLowerCase() === 'svg') {
        // currentColor resolution (logo fix): an SVG whose paths use fill="currentColor" (or strokes on fill:none —
        // resend's 'Resend' wordmark, color rgb(240,240,240) on the dark header) INHERITS the element's `color`.
        // Serializing the SVG standalone loses that inherited color, so currentColor later resolves to the wrong
        // (Elementor-default) color → a faint/wrong logo. Inject the computed color (and a real fill if set) onto the
        // SVG root so currentColor resolves identically in the html-widget context. Reversible: TRANSPILE_NO_SVG_CURRENTCOLOR=1.
        let svgMarkup = el.outerHTML;
        if (!opts.noSvgCurrentColor) {
          try {
            const clone = el.cloneNode(true);
            clone.style.color = cs.color;
            if (cs.fill && cs.fill !== 'none' && cs.fill !== 'rgba(0, 0, 0, 0)') clone.style.fill = cs.fill;
            svgMarkup = clone.outerHTML;
          } catch {}
        }
        return {
          tag: 'svg', cls: (el.getAttribute('class') || ''), isLeaf: true, text: null,
          svg: svgMarkup.replace(/\s+/g, ' ').trim(),
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          declared: _mdecl, media: mediaOf(el), s: mediaS,
        };
      }
      const kids = [...el.children].filter((k) => opts.noVisGate || !isHiddenEl(k)); // LEVER A: visible kids only (isLeaf + emission)
      // CTA-pill detector (2026-06-12, hero-CTA-ghost fix): a button is an <a>/<button> that
      // (a) is solidly filled (non-transparent bg) OR has a visible border, AND (b) is a pill
      // (horizontal padding > 0 OR a fixed pill height with a rounded radius). This is the TRUE
      // discriminator — the old `border-radius >= 10` gate missed clerk's 6px-radius CTAs
      // (.btn-purple/.btn-white/.hdr-start) so they fell through to text-editor and DROPPED their
      // purple/white fill (ghost). Transparent, padding-less links (.hdr-item nav, .hdr-signin)
      // are NOT pills and stay text/heading. A pill's leading/trailing <svg> chevron is captured
      // as an icon-part (see partsOf), so SVG children no longer force it into a container.
      const _bg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
      const _bord = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some((p) => parseFloat(cs[p]) > 0);
      const _hpad = parseFloat(cs.paddingLeft) > 0 || parseFloat(cs.paddingRight) > 0;
      const _pill = (parseFloat(cs.height) > 0 && parseFloat(cs.borderRadius) >= 4);
      const isBtnish = ['A', 'BUTTON'].includes(el.tagName) && el.textContent.trim() !== ''
        && (_bg || _bord) && (_hpad || _pill);
      const boxKid = kids.some((k) => { const c = getComputedStyle(k).backgroundColor; return c && c !== 'rgba(0, 0, 0, 0)' && k.textContent.trim() === ''; });
      // A button-pill stays a LEAF even with <svg> chevron children (its parts feed the native icon).
      const isLeaf = kids.length === 0
        || (kids.every((k) => ['SPAN', 'BR'].includes(k.tagName)) && (!boxKid || isBtnish))
        || (isBtnish && kids.every((k) => ['SPAN', 'BR', 'SVG', 'svg'].includes(k.tagName)));
      const node = {
        tag: el.tagName.toLowerCase(), cls: el.className || '', isLeaf,
        isBtn: isBtnish && isLeaf, // CTA pill the mapper should emit as a native button widget
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
        'border-radius', 'color', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
        // MEDIA-ARRANGEMENT discriminators (height-blowup fix): a container whose source layout was NON-ADDITIVE
        // (grid / horizontal carousel / vertical scroll-snap / sticky) must not project as a full-height column stack.
        'overflow-x', 'overflow-y', 'scroll-snap-type', 'position', 'grid-template-columns', 'grid-auto-flow']) {
        node.s[p] = cs.getPropertyValue(p);
      }
      // element geometry the carousel gate needs (scroll overflow vs visible width) — not a computed-style prop.
      node.scrollW = el.scrollWidth || 0; node.clientW = el.clientWidth || 0;
      node.autoML = (node.declared['margin-left'] || '') === 'auto';
      node.autoMR = (node.declared['margin-right'] || '') === 'auto';
      if (!isLeaf) {
        // LEVER b (reversible: TRANSPILE_NO_LOOSE_TEXT): build children in DOM order, SYNTHESIZING a text leaf for any
        // significant LOOSE TEXT node (direct text interleaved with element children). Without this a non-leaf container
        // — e.g. <p>prose<a>link</a>more prose</p> or <button>Features<svg/></button> — recurses into its element
        // children only and DROPS its own text. On resend this lost ~326 words of body prose + the whole nav.
        if (opts.noLooseText) { node.children = kids.map(ser).filter(Boolean); }
        else {
          const out = [];
          for (const cn of el.childNodes) {
            if (cn.nodeType === 1) {
              if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(cn.tagName)) continue;
              if (!opts.noVisGate && isHiddenEl(cn)) continue;
              const sub = ser(cn); if (sub) out.push(sub);
            } else if (cn.nodeType === 3) {
              const tx = cn.textContent.replace(/\s+/g, ' ').trim();
              if (tx.length < 2) continue;
              const range = document.createRange(); range.selectNodeContents(cn); const rr = range.getBoundingClientRect();
              if (rr.width < 1 || rr.height < 1) continue; // not laid out (whitespace-only / collapsed) → skip
              out.push({ tag: 'span', cls: '', isLeaf: true, isBtn: false, rect: { x: Math.round(rr.x), y: Math.round(rr.y), w: Math.round(rr.width), h: Math.round(rr.height) }, declared: {}, media: [], text: tx, parts: null, s: { ...node.s }, synthLoose: true });
            }
          }
          node.children = out;
        }
      }
      return node;
    };
    return { tree: ser(document.body), notes };
  }, { noVisGate: process.env.TRANSPILE_NO_VIS_GATE === '1', noLooseText: process.env.TRANSPILE_NO_LOOSE_TEXT === '1', noSvgCurrentColor: process.env.TRANSPILE_NO_SVG_CURRENTCOLOR === '1' });
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

  // MOVE 1 — NATIVE responsive typography. Elementor's custom_css @media channel is STRIPPED on
  // the Hello+free atomic stack, so a font-size step authored in a source `@media (max-width:Npx)`
  // is silently lost (hero h1 stayed 64px at every width). Resolve the source font-size (and the
  // matching line-height) at the TABLET representative width (768) and MOBILE representative width
  // (390) by replaying the desktop-first cascade over n.media, then emit NATIVE
  // typography_font_size_tablet / _mobile (+ line-height) controls — which demonstrably survive.
  // Cascade rule: a `@media (max-width:Mpx)` block applies at target width T iff T <= M; among the
  // applicable blocks the most-specific (smallest M) wins (last-wins in source order). n.media is
  // sorted descending by .w, so the smallest applicable M is the LAST match.
  const TYPO_BP = [{ sfx: '_tablet', target: 768 }, { sfx: '_mobile', target: 390 }];
  function resolveMediaProp(media, prop, target) {
    let val; // most-specific applicable wins → smallest m.w >= target
    let bestW = Infinity;
    for (const m of media || []) {
      if (target <= m.w && m.decls[prop] !== undefined && m.w <= bestW) { val = m.decls[prop]; bestW = m.w; }
    }
    return val;
  }
  function responsiveTypo(n, set) {
    if (process.env.RESPONSIVE_NO_NATIVE_FONTSIZE) return;
    let any = false;
    for (const { sfx, target } of TYPO_BP) {
      const fs = resolveMediaProp(n.media, 'font-size', target);
      if (fs && /px$/.test(fs) && !CSS_MATH.test(fs)) {
        set['typography_font_size' + sfx] = { unit: 'px', size: pxf(fs) };
        const lh = resolveMediaProp(n.media, 'line-height', target);
        if (lh && /px$/.test(lh) && !CSS_MATH.test(lh)) set['typography_line_height' + sfx] = { unit: 'px', size: pxf(lh) };
        any = true;
      }
    }
    if (any) policy(`MOVE1 native responsive font-size on <${n.tag}${n.cls ? ` class="${n.cls}"` : ''}>: ${TYPO_BP.map(({ sfx }) => sfx.slice(1) + '=' + (set['typography_font_size' + sfx] ? set['typography_font_size' + sfx].size + 'px' : '—')).join(' ')} (native control, not custom_css)`);
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
  // MOVE 2 — parse a CSS `flex` shorthand's basis (3rd token) or a bare `flex-basis`. Source bento
  // grids carry their reflow as flex-basis% (e.g. `flex:1 1 42%`, `flex:1 1 100%`) inside a media
  // block; map that % to a native width_tablet/_mobile percent so the grid lands as a real 2-col
  // (or 2x2) at the breakpoint instead of a 1-col-at-50%-width column with a blank right half.
  const flexBasisPct = (decls) => {
    let b = decls['flex-basis'];
    if (b === undefined && decls['flex']) {
      // `flex: <grow> <shrink> <basis>` — basis is the token carrying a unit (or 'auto').
      const toks = String(decls['flex']).trim().split(/\s+/);
      b = toks.find((t) => /%$|px$|auto/.test(t)) || (toks.length === 3 ? toks[2] : undefined);
    }
    return b;
  };
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
          else if ((p === 'flex-wrap') && !process.env.RESPONSIVE_NO_NATIVE_GRID) {
            // native breakpoint flex-wrap so a grid actually wraps to a 2-col/2x2 at this width
            settings['flex_wrap' + sfx] = v === 'wrap' ? 'wrap' : 'nowrap'; mapped = true;
          }
          else if ((p === 'flex-basis' || p === 'flex') && !process.env.RESPONSIVE_NO_NATIVE_GRID) {
            const b = flexBasisPct(m.decls);
            if (b !== undefined && /%$/.test(b)) {
              settings['width' + sfx] = { unit: '%', size: +b.replace('%', '') }; mapped = true;
              policy(`MOVE2 native grid regroup on <${n.tag}${n.cls ? ` class="${n.cls}"` : ''}>: flex-basis ${b} → width${sfx}:${+b.replace('%', '')}% (native, not custom_css)`);
            }
            // bare `flex-basis:auto/0px` → let the native flex sizing handle it (no width override);
            // mark mapped so it does not also ride the custom_css channel.
            if (b !== undefined && /(auto|^0px$)/.test(b)) mapped = true;
          }
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

  // MOVE 3 — @390 mobile gutter. Fixed px `width` pins (P4 row-child / P4b column-center) are
  // load-bearing at DESKTOP but survive untouched into the mobile breakpoint, leaving the content
  // box ~459px wide on a 390 viewport (a +69px dead right-edge gutter). When a container carries a
  // fixed px width pin and the source itself did NOT pin a mobile width (no width_mobile already set
  // by MOVE 2 from a source flex-basis), clear the pin at the mobile breakpoint by emitting
  // width_mobile:100% so content fills edge-to-edge at 390. Desktop (and tablet) keep the px pin —
  // the override is scoped to _mobile only, so the 1440 layout is untouched.
  function mobileFullWidth(settings) {
    if (process.env.RESPONSIVE_NO_MOBILE_FULLWIDTH) return;
    if (settings.width && settings.width.unit === 'px' && settings.width_mobile === undefined) {
      settings.width_mobile = { unit: '%', size: 100 };
    }
  }

  // a parent that lays its children out in a ROW: real flex-row, OR a CSS grid (mapped to row-wrap — see GRID→ROW-WRAP).
  // Used by child-width/align logic so grid cells get content-width (_element_width:'auto') and pack multiple-per-row
  // instead of each defaulting to full width (which stacked the logo grid vertically even after the container wrapped).
  const isRowParent = (ps) => !!ps && ((ps.display.includes('flex') && ps['flex-direction'] === 'row') || (!process.env.TRANSPILE_NO_GRID_ROW && ps.display.includes('grid')));

  function containerSettings(n) {
    const s = n.s; const out = { content_width: 'full', padding: dims(0, 0, 0, 0) };
    // GRID→ROW-WRAP (logo-grid fix): Elementor containers are flexbox, not CSS grid. A source `display:grid` container
    // (resend's 12-logo partner grid, grid-cols) failed the includes('flex') test and fell to flex_direction:'column',
    // stacking every cell VERTICALLY (the strip rendered as a 1-per-row column). Map a multi-cell grid to a WRAPPING
    // flex row so cells flow horizontally and wrap into rows — a faithful flex approximation of the grid. Reversible:
    // TRANSPILE_NO_GRID_ROW=1.
    const isGrid = !process.env.TRANSPILE_NO_GRID_ROW && s.display.includes('grid');
    // MEDIA-ARRANGEMENT reconstructed container (fusion 2026-06-21): force flex ROW+WRAP regardless of the offline-
    // collapsed display, so its %-stamped cells pack C-per-row. A sticky panel (D) restacks to a column on mobile.
    const maWrap = n._maRowWrap;
    out.flex_direction = (maWrap || (s.display.includes('flex') && s['flex-direction'] === 'row') || isGrid) ? 'row' : 'column';
    if (s['justify-content'] && !['normal', 'flex-start'].includes(s['justify-content'])) out.flex_justify_content = s['justify-content'];
    if (s['align-items'] && !['normal', 'stretch'].includes(s['align-items'])) out.flex_align_items = s['align-items'];
    if (s['flex-wrap'] === 'wrap' || isGrid || maWrap) out.flex_wrap = 'wrap';
    if (maWrap) { out.flex_direction_tablet = 'row'; out.flex_direction_mobile = 'row'; } // cells (not the container) restack via their % widths
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
    if (parent && isRowParent(parent.s) && parent.s['justify-content'] === 'center') align = 'center';
    const d = n.declared || {};
    let inner = n.text;
    let style = 'margin:0';
    if (/display:inline-block/.test(inner)) {
      // An inline-block horizontal strip (e.g. a code/file-tab pill row) must stay on one line.
      // Baking min-width = the captured DESKTOP rect width (e.g. 1152px) pins the strip un-shrinkably:
      // it is a raw inline style in the text-editor `editor` field, NOT an Elementor responsive
      // control, so _mobile/_tablet machinery cannot touch it and it overflows the page at 768/390.
      // Instead self-contain it: nowrap keeps one line, max-width:100% caps it to the column, and
      // overflow-x:auto lets a too-wide strip scroll internally at narrow widths. Desktop is byte-
      // unchanged whenever the strip is narrower than its column (the common case). kses-safe, no @media.
      if (process.env.RESPONSIVE_NO_INLINE_NOWRAP_PIN) style += `;white-space:nowrap;min-width:${n.rect.w}px`;
      else style += `;white-space:nowrap;max-width:100%;overflow-x:auto`;
    }
    if (d['max-width'] && /px$/.test(d['max-width']) && !CSS_MATH.test(d['max-width']) && !(d.width)) {
      style += `;max-width:${px(d['max-width'])}px`;
      if (align === 'center') style += ';margin-left:auto;margin-right:auto';
    }
    const set = {
      editor: `<div style="${style}">${inner}</div>`,
      align, text_color: hex(n.s.color) || '#131316', ...typo(n.s), ...widgetCommon(n),
    };
    if (parent && isRowParent(parent.s)) {
      set._element_width = 'auto';
      if (/display:inline-block/.test(inner)) {
        set._element_width = 'initial';
        set._element_custom_width = { unit: 'px', size: n.rect.w };
        // SECONDARY (latent same-class defect): a px _element_custom_width pin = the captured desktop
        // width survives verbatim into narrow breakpoints and overflows a flex row. Mirror the proven
        // mobileFullWidth() pattern — clear the pin at tablet/mobile by overriding to 100% — so the
        // widget fills its column edge-to-edge instead of forcing the desktop width. Desktop keeps the
        // px pin (override is scoped to _tablet/_mobile only). Reversible with the same flag.
        if (!process.env.RESPONSIVE_NO_INLINE_NOWRAP_PIN) {
          if (set._element_custom_width_mobile === undefined) set._element_custom_width_mobile = { unit: '%', size: 100 };
          if (set._element_custom_width_tablet === undefined) set._element_custom_width_tablet = { unit: '%', size: 100 };
        }
      }
    }
    responsiveTypo(n, set);
    applyMedia(n, set, 'align');
    applyInheritedAlign(set, 'align', inherit);
    return { elType: 'widget', widgetType: 'text-editor', settings: set };
  }

  // P1: split a button's child parts into (icon, icon position, plain text).
  function buttonContent(n) {
    const parts = (n.parts || []).slice();
    const SVG_DIR_GLYPH = { right: 'fa-angle-right', down: 'fa-angle-down', left: 'fa-angle-left', up: 'fa-angle-up' };
    const glyphOf = (p) => {
      if (!p) return null;
      if (p.t === 'svgicon') return SVG_DIR_GLYPH[p.dir] || 'fa-angle-right'; // captured chevron/arrow <svg>
      if (p.t !== 'span') return null;
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
      if (p.t === 'svgicon') continue; // any leftover svg-icon part carries no text
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
      // GHOST-CTA fix: a transparent source button (white text + transparent bg + a faint gradient, legible on a DARK
      // page — resend hero 'Get started') must NOT fall back to #FFFFFF: that painted the pill white and made the white
      // label INVISIBLE (white-on-white). Emit transparent so the dark parent shows through and the label stays
      // legible — faithful to the source ghost button. Opaque source bgs are unchanged. Reversible: TRANSPILE_NO_GHOST_CTA=1.
      background_color: hex(n.s['background-color']) || (process.env.TRANSPILE_NO_GHOST_CTA ? '#FFFFFF' : 'rgba(0,0,0,0)'),
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
    responsiveTypo(n, set);
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
    // SIZING (P6, 2026-06-12 fix): Elementor 3.28's image widget has NO standalone `width`/
    // `height`/`space` control — only `image_size` + `image_custom_dimension`. The old
    // `width:{unit,size}` was silently dropped, leaving image_size:'full' → CSS-only sizing.
    // Far-down lazy images then collapsed to height:0 (no intrinsic aspect to reserve a box,
    // never entered the lazy intersection → naturalWidth stayed 0 → invisible "placeholder
    // boxes"). Emit image_size:'custom' + explicit pixel width/height from the captured
    // rendered box so Elementor stamps width=/height= on the <img>, reserving the box AND
    // giving the browser intrinsic dimensions that trigger decode. Width prefers a declared
    // px width, else the rendered/attr width; height is derived from the captured aspect
    // ratio (natural box) so it survives even when the source set only a width.
    const decW = (n.declared && /px$/.test(n.declared.width || '') && !CSS_MATH.test(n.declared.width)) ? px(n.declared.width) : 0;
    const w = decW || n.attrW || n.rect.w || n.natW || (asset && asset.width) || 0;
    // ASPECT AUTHORITY (2026-06-12 bento-sliver fix): a card image inside a `width:100%` cell
    // with no declared height that hadn't decoded at capture time reports a COLLAPSED rect height
    // (~18px alt-line). Trusting that h cropped the bento mockups to an 18px sliver → empty cards.
    // The asset's REAL pixel dims (asset.width/height, from WP attachment meta) are authoritative
    // for the aspect ratio — prefer them, then natural, then the captured rect, then attrs.
    const assetAspect = (asset && asset.width && asset.height) ? (asset.height / asset.width) : 0;
    const aspect = assetAspect
      || ((n.natW && n.natH) ? (n.natH / n.natW)
        : (n.rect && n.rect.w && n.rect.h) ? (n.rect.h / n.rect.w)
          : (n.attrW && n.attrH) ? (n.attrH / n.attrW) : 0);
    // Height from the aspect-scaled width when we have a real aspect; else fall back to captured
    // box / attr. assetAspect wins over a collapsed rect so the box reserves the true height.
    const h = (assetAspect && w) ? Math.round(w * aspect)
      : n.attrH || (n.rect && n.rect.h) || (aspect && w ? Math.round(w * aspect) : 0);
    // SIZING. Raster: image_size:custom + image_custom_dimension reserves the captured box
    // (Elementor emits `img{width:Npx;height:Npx}` to per-element CSS) — fixes the lazy-collapse
    // placeholder-box bug. SVG (vector attachment): Elementor SKIPS the dimension CSS for
    // image_size:custom (no raster thumbnail to resolve), so a custom SVG whose viewBox differs
    // from the captured box collapses to 0×0 once its wrapper goes width:auto. For SVGs we keep
    // image_size:full and pin the box on the WRAPPER via the native _element_custom_width control
    // (reliably flushed to per-element CSS — unlike Pro custom_css, which this stack doesn't emit)
    // so the vector scales to the captured width preserving its aspect.
    const isSvg = /\.svg(\?|$)/i.test(String(url));
    // FLUID-IN-CELL (media-arrangement): a reconstructed-gallery/grid image goes image_size:'full' (NO rigid px
    // dimension) so it fills its % cell at the cell's width and auto-height (aspect-locked) — the bounded-row
    // packing comes from the cell width, never from resizing the image file. (Outside a reconstruction, the px
    // image_custom_dimension stays — it reserves the box against the lazy-collapse placeholder bug.)
    const fluid = !!n._maFluid;
    const set = {
      image: { url, ...(id ? { id } : {}) },
      ...((w && h && !isSvg && !fluid)
        ? { image_size: 'custom', image_custom_dimension: { width: String(w), height: String(h) } }
        : { image_size: 'full' }),
      ...widgetCommon(n),
    };
    if (isSvg && w) { set._element_width = 'initial'; set._element_custom_width = { unit: 'px', size: w }; }
    else if (fluid) { set._element_width = 'initial'; set._element_custom_width = { unit: '%', size: 100 }; } // fill the cell
    else if (parent && isRowParent(parent.s)) set._element_width = 'auto';
    applyMedia(n, set, 'align');
    return { elType: 'widget', widgetType: 'image', settings: set };
  }

  // WS2 SELF-HEAL (Arm B): preserve any author-supplied `heal-<id>` CSS class through the transpile so it
  // lands on the rendered DOM node as a real CSS class. Elementor stamps a widget/container's `_css_classes`
  // string onto the element's classList, so a class authored as `<h1 class="heal-s3b01">` survives the full
  // round-trip (authored HTML → Elementor tree → render) and capture-layout can read it back as healId. We
  // APPEND (never clobber) so any future class-handling path is preserved. n.cls is the source element's
  // className (captured in extract()/ser()). Only heal-* tokens are forwarded — no other classes leak in.
  const healClasses = (n) => String((n && n.cls) || '').split(/\s+/).filter((c) => /^heal-[\w-]+$/.test(c));
  function stampHealClasses(node, n) {
    if (!node || typeof node !== 'object' || !node.settings) return node;
    const heals = healClasses(n);
    if (!heals.length) return node;
    const existing = String(node.settings._css_classes || '').split(/\s+/).filter(Boolean);
    for (const h of heals) if (!existing.includes(h)) existing.push(h);
    node.settings._css_classes = existing.join(' ');
    return node;
  }

  function mapNode(n, parent, inherit) {
    return stampHealClasses(mapNodeInner(n, parent, inherit), n);
  }

  function mapNodeInner(n, parent, inherit) {
    const cls = (c) => String(n.cls).split(/\s+/).includes(c);
    const childInherit = inheritedAligns(n, inherit);
    if (n.tag === 'img' || n.tag === 'svg') return imageWidget(n, parent);
    if (n.isLeaf) {
      if (!n.text) { // empty box: divider / dot / filler / grid-gap spacer
        counts.container++;
        const st = containerSettings(n);
        if (n.rect.w <= 2) { st.width = { unit: 'px', size: 1 }; st.min_height = { unit: 'px', size: n.rect.h }; }
        // MULTI-COLUMN-COLLAPSE fix (gen-test linear/tailwind): an EMPTY container in a flex-row/grid parent (a
        // grid-gap spacer or a column-spanning empty cell) otherwise gets NO width → Elementor defaults it to 100%,
        // which forces every sibling to WRAP → the source's [sidebar|main] columns collapse to a vertical stack +
        // height blowup. Pin it to its captured width so the row holds. Reversible: TRANSPILE_NO_GRID_ROW=1.
        else if (parent && isRowParent(parent.s) && !st.width) { st.width = { unit: 'px', size: Math.max(1, n.rect.w) }; st._flex_size = 'custom'; st._flex_shrink = 0; if (n.rect.h > 0) st.min_height = { unit: 'px', size: n.rect.h }; }
        applyMedia(n, st, 'container');
        return { elType: 'container', settings: st, elements: [] };
      }
      // CTA pill (filled/bordered + padded <a>/<button>) → native button widget so its fill survives.
      // The capture flags it (n.isBtn); fall back to the legacy radius>=10 rule for older specs.
      const isBtnEl = n.isBtn || (n.tag === 'a' && px(n.s['border-radius']) >= 10);
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
        responsiveTypo(n, set);
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
      // Preserve the VERTICAL padding (top/bottom) — only the horizontal pads collapse into the
      // boxed content width. The old `dims(0,padR,0,padL)` zeroed top/bottom, dropping e.g.
      // .auth-row2{padding-bottom:151px} → the auth section under-heighted by ~150px (LEVER 3).
      const padT = px(n.s['padding-top']); const padB = px(n.s['padding-bottom']);
      settings.content_width = 'boxed';
      settings.boxed_width = { unit: 'px', size: px(d['max-width']) - padL - padR };
      settings.padding = dims(padT, padR, padB, padL);
      delete settings.width; delete settings.margin;
      // Preserve an explicit vertical (top) margin the auto horizontal-centering would otherwise
      // drop — e.g. .auth-row{margin:64px auto 0}. Without it inter-row rhythm collapses (LEVER 3).
      const mTop = (/px$/.test(d['margin-top'] || '') && !CSS_MATH.test(d['margin-top'] || '')) ? px(n.s['margin-top']) : 0;
      if (mTop) settings.margin = dims(mTop, 0, 0, 0);
    }
    // MEDIA-ARRANGEMENT cell (fusion 2026-06-21): a reconstructed grid/gallery/carousel cell gets a FLUID % width
    // (per-keystone) so it packs C-per-row, instead of the offline-collapsed full-width px pin that stacks it. The
    // image inside stays image_size:full (fluid-in-cell, never resized). Takes precedence over the px row-child pin.
    if (n._maWidthPct) {
      // Use the container WIDTH control + _flex_size:'custom' (the proven flex-child sizing in this stack, P4 line ~861)
      // — NOT _element_custom_width (the Advanced custom-width), which this Elementor version does NOT apply to a flex
      // CHILD container (verified: the cell rendered full-width). width:% + flex_size:custom + shrink:0 packs C-per-row.
      settings.width = { unit: '%', size: n._maWidthPct };
      if (n._maWidthPctTablet != null) settings.width_tablet = { unit: '%', size: n._maWidthPctTablet };
      if (n._maWidthPctMobile != null) settings.width_mobile = { unit: '%', size: n._maWidthPctMobile };
      settings._flex_size = 'custom'; settings._flex_shrink = 0;
      delete settings._element_custom_width; delete settings._element_width;
    }
    // P4: e-con row children default to 100% width — pin px width + buffer, never shrink.
    else if (parent && isRowParent(parent.s) && !settings.width && !settings._flex_grow) {
      settings.width = { unit: 'px', size: n.rect.w + ROW_CHILD_BUFFER_PX };
      settings._flex_size = 'custom'; settings._flex_shrink = 0;
    }
    // P4b COLUMN-CENTER SHRINK (2026-06-13, fw-link left-drift fix): an e-con child defaults to
    // width:100%. When its parent is a flex-COLUMN that centers items (align-items:center), a child
    // with NO declared width stretches full-width, so its own left-/start-aligned content sits at the
    // LEFT and the parent's cross-axis centering is defeated (e.g. .fw-link "All frameworks ›" /
    // "All integrations ›" rendered hard-left instead of centered under their headings). In source
    // such a child is width:auto and shrinks to content, letting the column center it. Mirror that:
    // pin its width to the rendered CONTENT width (n.rect.w) + buffer with _flex_size:'custom' so
    // Elementor honors it (the `.e-con-full` class hard-sets width:100%, which beats a bare
    // _element_width:'auto' — an explicit width control is the only reliable shrink lever). The
    // parent's align-items:center then centers the now-content-sized child. Guarded: only when the
    // child has no declared width, isn't a flex-grow item, isn't already pinned by P4, and is
    // genuinely content-narrower than the parent's inner box (rect.w + slack < parent rect.w) so we
    // never shrink a legitimately full-width block. Reversible: TRANSPILE_NO_COL_CENTER_SHRINK=1.
    if (!process.env.TRANSPILE_NO_COL_CENTER_SHRINK
      && parent && parent.s && parent.s.display.includes('flex') && parent.s['flex-direction'] === 'column'
      && (parent.s['align-items'] === 'center')
      && !settings.width && !settings._flex_grow
      && n.rect && parent.rect && n.rect.w > 0 && parent.rect.w > 0
      && n.rect.w + 8 < parent.rect.w) {
      settings.width = { unit: 'px', size: n.rect.w + ROW_CHILD_BUFFER_PX };
      settings._flex_size = 'custom'; settings._flex_shrink = 0;
    }
    // P5: margin-auto heuristics (documented in header).
    if ((n.children || []).some((c) => c.autoML)) {
      if (settings.flex_direction === 'row') settings.flex_justify_content = 'space-between';
      else settings.flex_align_items = 'center';
    }
    // FIXED-CELL-ROW HEIGHT (2026-06-12 LEVER 3, fw-grid compression): a flex row whose direct
    // children are all <img>/<svg> cells with the SAME declared px height (e.g. .fw-cells of
    // .fw-cell{height:139px}) must reserve that box height. Elementor's image widget won't grow a
    // vector SVG (intrinsic ~42px) to a 139px cell — so the row collapsed to ~42px, under-heighting
    // the framework section by ~290px. Pin the CONTAINER min_height (a control that reliably flushes
    // to per-element CSS) to the children's declared cell height. Only when the row has no min_height
    // of its own and every child declares the same px height.
    if (!settings.min_height) {
      const cells = (n.children || []).filter((c) => c.tag === 'img' || c.tag === 'svg');
      const cellHs = cells.map((c) => (c.declared && /px$/.test(c.declared.height || '') && !CSS_MATH.test(c.declared.height) ? px(c.declared.height) : 0));
      if (cells.length && cells.length === (n.children || []).length && cellHs.every((hh) => hh > 0 && hh === cellHs[0])) {
        settings.min_height = { unit: 'px', size: cellHs[0] };
        if (!settings.flex_align_items) settings.flex_align_items = 'center';
      }
    }
    applyMedia(n, settings, 'container');
    mobileFullWidth(settings);
    // HERO-BG → CONTAINER BACKGROUND (fusion decision 2): a full-bleed position:absolute <img> child is a background
    // layer, not inline content. Lift it onto THIS container's background_image (the 2nd glow → background_overlay_image)
    // so it sits behind content at correct z-order; emitting it inline would push content below the fold once the image
    // loads. The bg-layer imgs are then dropped from the inline children. Reversible: TRANSPILE_NO_BG_LAYER=1.
    let kids = n.children || [];
    if (!process.env.TRANSPILE_NO_BG_LAYER) {
      const bgImgs = kids.filter((c) => c.tag === 'img' && c.isBgLayer);
      if (bgImgs.length) {
        const urlOf = (c) => { const a = assetMap.get(c.src) || assetMap.get(c.resolvedSrc) || null; return a ? (a.url || (a.pendingFile && pathToFileURL(a.pendingFile).href)) : null; };
        const u0 = urlOf(bgImgs[0]);
        if (u0) {
          settings.background_background = 'classic';
          settings.background_image = { url: u0, id: (assetMap.get(bgImgs[0].src) || {}).id || '' };
          settings.background_size = 'cover'; settings.background_position = 'center center';
          if (bgImgs[1]) { const u1 = urlOf(bgImgs[1]); if (u1) { settings.background_overlay_background = 'classic'; settings.background_overlay_image = { url: u1, id: (assetMap.get(bgImgs[1].src) || {}).id || '' }; settings.background_overlay_size = 'cover'; settings.background_overlay_position = 'center center'; } }
          policy(`hero-bg: ${bgImgs.length} full-bleed absolute <img> → container background_image${bgImgs[1] ? ' + overlay' : ''} (not inline) on <${n.tag}${n.cls ? ` class="${n.cls}"` : ''}>`);
          kids = kids.filter((c) => !(c.tag === 'img' && c.isBgLayer));
        }
      }
    }
    return { elType: 'container', settings, elements: kids.map((c) => mapNode(c, n, childInherit)) };
  }

  return { mapNode, counts, PAIN, POLICY };
}

// ── vertical-rhythm normalizer (post-transpile) ─────────────────────────────────────────────────────────────
/**
 * @purpose Fix accumulating whitespace compression (e.g. linear-v2 hRatio 0.83): a vision-authored page often
 * sets section bottom-padding to 0 (`padding:140px 48px 0`) and under-sizes internal heading-block gaps, so each
 * full-width section renders ~150-220px SHORTER than the matched source band and the deficit accumulates down the
 * page. This deterministic pass matches each top-level authored section to its SOURCE content band (DP sequence
 * alignment on fractional y-position + relative height — robust to the count mismatch caused by absent/duplicate
 * source bands such as a sticky-nav artifact or an un-segmented figure row) and, for a confidently-matched section
 * that renders SHORTER than its source band, tops up the section's BOTTOM padding by the residual. Bottom-padding
 * (not min_height) keeps the recovered slack as authored-looking inter-section rhythm BELOW the content instead of
 * a top-clustered void. It is match-gated and growth-only: a section with no confident source match, or already at
 * or above its source height, is left untouched — so a page that is already ~1:1 (clerk, hRatio 0.998) is a no-op.
 * Horizontal layout, reflow, responsive controls and editability are untouched (only the bottom `padding` value of
 * matched sections changes). Source padding is NOT read (style-facts carries none); the target height is DERIVED
 * from the source band geometry (manifest.perWidth[width].sections box heights). Reversible: TRANSPILE_NO_RHYTHM=1.
 */
const RHYTHM_MIN_DEFICIT = 20;     // ignore sub-20px residuals (rounding / grader noise)
const RHYTHM_MAX_GROW_FRAC = 0.6;  // never grow a section by more than 60% of its own height (bad-match guard)
const RHYTHM_MAX_GROW_PX = 700;    // hard per-section growth ceiling (bad-match guard)

// Derive a clean top-to-bottom sequence of source CONTENT bands from the (noisy, hierarchical, sometimes
// overlapping) capture section list. Drops the page-wrapper bands (h ~= pageH) and tiny slivers; covers the page
// with non-overlapping bands at the dominant content-column width (and full-width header/footer), preferring the
// finer band on overlap so a nested child section isn't swallowed by its parent.
export function deriveSourceBands(sections, pageH) {
  if (!Array.isArray(sections) || !pageH) return [];
  const cand = sections.filter((s) => s && s.h >= 60 && s.h < pageH * 0.92 && s.w > 0);
  if (!cand.length) return [];
  const wc = {}; cand.forEach((s) => { wc[s.w] = (wc[s.w] || 0) + 1; });
  const widths = Object.entries(wc).sort((a, b) => b[1] - a[1]).map((e) => +e[0]);
  const domW = widths[0];
  const maxW = Math.max(...widths);
  const cover = (bands) => {
    const sorted = [...bands].sort((a, b) => a.y - b.y || a.h - b.h); // tie → finer (smaller h) first
    const picked = []; let cursor = -1e9;
    for (const b of sorted) { if (b.y >= cursor - 12) { picked.push({ y: b.y, h: b.h }); cursor = b.y + b.h; } }
    return picked;
  };
  const setA = cand.filter((s) => s.w === domW || (s.x === 0 && s.w >= domW));      // content column + full-width
  const setB = cand.filter((s) => s.x === 0 && s.w >= maxW * 0.9);                   // full-width bands only
  const cA = cover(setA); const cB = cover(setB);
  return cA.length >= cB.length ? cA : cB; // the finer cover (more bands) carries more rhythm signal
}

// Needleman-Wunsch global alignment of authored sections A[] → source bands B[] (each carries {y,h}). Diagonal
// = a match scored by closeness in fractional center AND in relative height; gaps (skip an authored section, or a
// source band) cost a fixed penalty so absent/extra bands on either side are skipped rather than force-matched.
// Returns match[i] = source-band index for authored section i, or -1 (unmatched).
export function alignSections(A, B, authPageH, srcPageH) {
  const n = A.length; const m = B.length;
  if (!n || !m || !authPageH || !srcPageH) return new Array(n).fill(-1);
  const aC = A.map((a) => (a.y + a.h / 2) / authPageH); const bC = B.map((b) => (b.y + b.h / 2) / srcPageH);
  const aH = A.map((a) => a.h / authPageH); const bH = B.map((b) => b.h / srcPageH);
  const GAP = -0.35;
  const sim = (i, j) => (0.25 - Math.abs(aC[i] - bC[j])) * 2 + (0.15 - Math.abs(aH[i] - bH[j])) * 2;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const bt = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(''));
  for (let i = 1; i <= n; i++) { dp[i][0] = dp[i - 1][0] + GAP; bt[i][0] = 'U'; }
  for (let j = 1; j <= m; j++) { dp[0][j] = dp[0][j - 1] + GAP; bt[0][j] = 'L'; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const diag = dp[i - 1][j - 1] + sim(i - 1, j - 1);
    const up = dp[i - 1][j] + GAP; const left = dp[i][j - 1] + GAP;
    let best = diag; let c = 'D';
    if (up > best) { best = up; c = 'U'; }
    if (left > best) { best = left; c = 'L'; }
    dp[i][j] = best; bt[i][j] = c;
  }
  const match = new Array(n).fill(-1); let i = n; let j = m;
  while (i > 0 || j > 0) {
    const c = bt[i][j];
    if (c === 'D') { match[i - 1] = j - 1; i--; j--; }
    else if (c === 'U') { i--; }
    else { j--; }
  }
  return match;
}

/**
 * Apply the rhythm pass IN PLACE on the Elementor root. `specTree` is the post-site-part-split spec tree whose
 * top-level children correspond 1:1 (same order) to root.elements (top-level sections). `capManifest` is the
 * parsed source capture manifest. `width` selects the perWidth band set. Returns a report (per-section diffs +
 * totals). Mutating only `settings.padding.bottom` of matched-short sections — no other control is touched.
 */
export function applyRhythm(root, specTree, capManifest, { width = 1440 } = {}) {
  const report = { applied: false, reason: null, sections: [], recoveredPx: 0 };
  if (process.env.TRANSPILE_NO_RHYTHM) { report.reason = 'disabled (TRANSPILE_NO_RHYTHM)'; return report; }
  const pw = capManifest && capManifest.perWidth && (capManifest.perWidth[String(width)] || capManifest.perWidth[width]);
  if (!pw || !Array.isArray(pw.sections)) { report.reason = 'no source bands (manifest.perWidth[width].sections missing)'; return report; }
  const srcPageH = pw.pageH || (pw.sections[0] && pw.sections[0].h) || 0;
  const bands = deriveSourceBands(pw.sections, srcPageH);
  if (bands.length < 2) { report.reason = `too few derived source bands (${bands.length})`; return report; }
  const kids = specTree.children || [];
  const sections = root.elements || [];
  if (kids.length !== sections.length) { report.reason = `spec/tree section count mismatch (${kids.length} vs ${sections.length})`; return report; }
  const authPageH = Math.max(...kids.map((k) => k.rect.y + k.rect.h), 1);
  const A = kids.map((k) => ({ y: k.rect.y, h: k.rect.h }));
  const match = alignSections(A, bands, authPageH, srcPageH);
  for (let i = 0; i < sections.length; i++) {
    const mi = match[i]; const src = mi >= 0 ? bands[mi] : null;
    const authH = A[i].h;
    let addB = 0;
    if (src) {
      const deficit = src.h - authH;
      if (deficit > RHYTHM_MIN_DEFICIT) addB = Math.min(deficit, Math.round(authH * RHYTHM_MAX_GROW_FRAC), RHYTHM_MAX_GROW_PX);
    }
    const el = sections[i];
    const cls = (kids[i] && kids[i].cls) ? ` .${String(kids[i].cls).split(/\s+/)[0]}` : '';
    const rec = { idx: i, tag: kids[i] && kids[i].tag, cls: (kids[i] && kids[i].cls) || '', authH, srcH: src ? src.h : null, addBottomPad: addB };
    if (addB > 0 && el && el.settings) {
      const p = el.settings.padding;
      const top = p ? p.top : '0'; const right = p ? p.right : '0'; const left = p ? p.left : '0';
      const curB = p ? (parseInt(p.bottom, 10) || 0) : 0;
      el.settings.padding = dims(parseInt(top, 10) || 0, parseInt(right, 10) || 0, curB + addB, parseInt(left, 10) || 0);
      report.recoveredPx += addB;
      rec.newBottomPad = curB + addB;
    }
    report.sections.push(rec);
  }
  report.applied = report.recoveredPx > 0;
  report.authPageH = authPageH; report.srcPageH = srcPageH; report.bands = bands.length;
  report.ratioBefore = +(authPageH / srcPageH).toFixed(4);
  report.ratioAfter = +((authPageH + report.recoveredPx) / srcPageH).toFixed(4);
  return report;
}

// ── site-part landmark split (§8d basics: header/footer become Pro Theme Builder documents) ────────────────
// ── MEDIA-ARRANGEMENT detection (height-blowup fix, fusion 2026-06-21) ────────────────────────────────────────
// Classify whether a container's SOURCE layout made its height NON-ADDITIVE (so projecting its children as a
// full-height column stack causes the height-blowup). DUAL GATE — style signals AND geometry; never fires from
// image height alone. Returns 'grid' | 'carousel-x' | 'scrollsnap-y' | 'sticky' | null.
// total height of all IMG descendants under a subtree (the additive cost if projected as a flat column stack).
function imgDescHeight(n, acc = { h: 0, n: 0 }) {
  if (!n) return acc;
  if (n.tag === 'img' && n.rect) { acc.h += n.rect.h || 0; acc.n += 1; }
  for (const k of (n.children || [])) imgDescHeight(k, acc);
  return acc;
}
export function classifyArrangement(n, T = {}) {
  if (!n || n.isLeaf || !Array.isArray(n.children) || n.children.length < 2) return null;
  const s = n.s || {};
  const kids = n.children, ph = (n.rect && n.rect.h) || 0;
  if (ph <= 0) return null;
  // ── MEDIA-PRESENCE GATE: only reconstruct containers that actually hold a gallery / card-grid — ≥3 img descendants.
  // (We do NOT gate on imgH/parentH non-additivity: the offline source.html doesn't reproduce the JS-driven scroll-
  // snap/sticky BOUNDING, so the offline parent is already blown up → the ratio is unobservable here. The container
  // TYPE — read from STYLE (scroll-snap/overflow-x/grid/1fr-Nvw), which DOES survive into the static HTML — is the
  // robust signal. The narrowed type tests below never match <body>/flex wrappers, so this stays a tight gate. The
  // emitter emits the CORRECT structure regardless of whether the offline layout already blew up; the SaaS A/B +
  // media-presence invariant are the over-firing guards.) ──────────
  const { n: imgN } = imgDescHeight(n);
  if (imgN < (T.MA_MIN_IMGS || 3)) return null;
  const gtc = String(s['grid-template-columns'] || '');
  // ── STICKY image|info PANEL: a 2-track "1fr Nvw" grid (image area + sticky info column). NOT "any sticky child" —
  // that flagged the whole <body>; the PANEL SHAPE is the signal. ──
  if (/\bvw\b/.test(gtc) && gtc.trim().split(/\s+(?![^(]*\))/).length === 2) return 'sticky';
  // ── VERTICAL scroll-snap gallery (the big blowup contributor: a viewport-scroll image viewer) ──
  if (/^y\b/.test(String(s['scroll-snap-type'] || ''))) return 'scrollsnap-y';
  // ── HORIZONTAL carousel: scroll-snap-x OR overflow-x scroll/auto with kids on one y-band. The live scrollW>clientW
  // geometry is unreliable OFFLINE (source.html may not size a scroller), so STYLE + a shared y-band is the primary
  // signal; scrollW corroborates when present. ──
  const ox = String(s['overflow-x'] || ''), ssx = /^x\b/.test(String(s['scroll-snap-type'] || ''));
  const ys = kids.map((k) => (k.rect && k.rect.y) || 0), yBand = (Math.max(...ys) - Math.min(...ys)) < ph * 0.5;
  if ((ssx || ((ox === 'auto' || ox === 'scroll') && (n.scrollW || 0) > (n.clientW || 0) * 1.15)) && yBand) return 'carousel-x';
  // ── multi-column GRID (≥2 tracks): cells would stack to N rows; media-dominance already proved the blowup. ──
  const tracks = gtc && gtc !== 'none' ? gtc.trim().split(/\s+(?![^(]*\))/).length : 0;
  if ((s.display === 'grid' || s.display === 'inline-grid' || tracks >= 2) && tracks >= 2) return 'grid';
  return null;
}
// media-presence invariant: collect every image node id/url under a subtree (assert all survive a reconstruction).
export function collectMediaUrls(n, out = []) {
  if (!n) return out;
  if (n.tag === 'img') out.push(n.cls + '|' + (n.rect ? `${n.rect.w}x${n.rect.h}` : ''));
  for (const k of (n.children || [])) collectMediaUrls(k, out);
  return out;
}

// gap-safe per-cell width %: floor(100/C)-1 absorbs rounding so the row never overflows into an extra wrap line.
const childPct = (C) => Math.max(1, Math.floor(100 / Math.max(1, C)) - 1);
// column count by arrangement type (fusion 2026-06-21): grid → resolved track count (fallback content-derived);
// carousel → ≤4; vertical scroll-snap gallery → 3 (legibility floor); clamp 2..6.
function columnsFor(type, n) {
  const kids = (n.children || []).length;
  if (type === 'carousel-x') return Math.min(kids, 4);
  if (type === 'scrollsnap-y') return 3;
  // grid: count resolved tracks in grid-template-columns (paren-safe); offline-collapsed (<2) → content-derived.
  const gtc = String((n.s || {})['grid-template-columns'] || '');
  let tracks = gtc && gtc !== 'none' ? gtc.trim().split(/\s+(?![^(]*\))/).length : 0;
  if (tracks < 2) tracks = Math.min(4, Math.max(2, Math.round(Math.sqrt(kids)))); // collapsed offline → a sane grid
  return Math.max(2, Math.min(6, tracks));
}

// ── MEDIA-ARRANGEMENT RECONSTRUCTION pre-pass (fusion 2026-06-21). Walk the spec tree OUTSIDE-IN (pre-order),
// classify each container ONCE (single-assignment; a claimed node's cells are reconstructed by recursing the
// classifier into the cells only), and for a non-additive media container force flex ROW+WRAP and stamp each cell
// with a fluid % width (per-keystone) so it packs C-per-row instead of stacking full-width. NEVER resizes an image
// (cells narrow; image stays image_size:full, aspect-locked). Returns {reconstructed, imgsBefore, imgsAfter} for the
// media-presence invariant. Reversible: caller gates on TRANSPILE_NO_MEDIA_ARRANGEMENT=1. MUTATES the tree.
export function reconstructArrangement(tree, opts = {}) {
  const log = [];
  const imgsBefore = collectMediaUrls(tree).length;
  function stampCells(n, type) {
    const C = columnsFor(type, n);
    const pct = childPct(C);
    // responsive per type (fusion): grid/gallery → tablet 50% (≥3-col) / mobile 50% (media); carousel → tablet 33% / mobile 50%.
    const pctT = type === 'carousel-x' ? childPct(3) : (C >= 3 ? 50 : pct);
    const pctM = 50; // media grids/galleries/carousels NEVER 1-col on mobile (that is the additive stack again)
    n._maRowWrap = true; n._maType = type; n._maCols = C;
    const markFluid = (x) => { if (!x || typeof x !== 'object') return; if (x.tag === 'img') x._maFluid = true; for (const c of (x.children || [])) markFluid(c); };
    for (const k of (n.children || [])) {
      if (!k || typeof k !== 'object') continue;
      k._maWidthPct = pct; k._maWidthPctTablet = pctT; k._maWidthPctMobile = pctM;
      // FLUID-IN-CELL: every image under a reconstructed cell drops its rigid px image_custom_dimension and goes
      // image_size:'full' so it scales to the narrowed % cell (aspect-locked) instead of forcing its full px height.
      markFluid(k);
    }
    log.push(`${type} C=${C} cell=${pct}% (t${pctT}/m${pctM}) on <${n.tag} class="${String(n.cls).slice(0, 32)}"> kids=${(n.children || []).length}`);
  }
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    const type = classifyArrangement(n);
    if (type) {
      stampCells(n, type);
      // single-assignment: this node is CLAIMED. Recurse only INTO its cells' subtrees (cells are strict box subsets),
      // never re-examine this node — outer wins the outer box, inner the inner box.
      for (const k of (n.children || [])) for (const gk of (k.children || [])) walk(gk);
      return;
    }
    for (const k of (n.children || [])) walk(k);
  }
  walk(tree);
  const imgsAfter = collectMediaUrls(tree).length;
  return { reconstructed: log.length, imgsBefore, imgsAfter, log };
}

/**
 * Detach <header>/<footer> landmark sections (and a top-level <nav> when no <header> exists) from the spec
 * tree so they can be authored as SITE PARTS (POST /joist/v1/site-parts → Pro Theme Builder documents with
 * per-page display conditions) instead of being baked into the page tree. Landmarks are sought DOM-order,
 * depth <= 2 under <body> (direct children + one wrapper level). MUTATES specTree (removes the found nodes).
 * Returns [{ type: 'header'|'footer', node, tag, cls }] — empty when the page has no chrome landmarks.
 */
export function splitSiteParts(specTree) {
  const seek = (pred) => {
    let hit = null;
    (function walk(n, depth, parent) {
      if (hit) return;
      if (depth > 0 && pred(n)) { hit = { node: n, parent }; return; }
      if (depth >= 2) return;
      for (const c of n.children || []) { walk(c, depth + 1, n); if (hit) return; }
    })(specTree, 0, null);
    return hit;
  };
  const detach = ({ node, parent }) => { parent.children = parent.children.filter((c) => c !== node); };
  const parts = [];
  const header = seek((n) => n.tag === 'header') || seek((n) => n.tag === 'nav');
  if (header) { detach(header); parts.push({ type: 'header', node: header.node, tag: header.node.tag, cls: String(header.node.cls || '') }); }
  const footer = seek((n) => n.tag === 'footer'); // sought AFTER the header detach so a nested node can't double-claim
  if (footer) { detach(footer); parts.push({ type: 'footer', node: footer.node, tag: footer.node.tag, cls: String(footer.node.cls || '') }); }
  return parts;
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
  // capture-assets manifest entries identify an asset by `url` (the original fetched URL), not `src`; older/flat
  // manifests use `src`. Index by BOTH so the lookup works regardless of manifest shape (the hero-bg/bg-light glow
  // entries carry `url`, not `src` — keying only on `src` left assetMap EMPTY and every image hot-linked its offline-
  // 404 original URL).
  const srcOf = (a) => a.src || a.url || '';
  const byExact = new Map(manifest.map((a) => [srcOf(a), a]));
  const byBase = new Map(manifest.map((a) => [path.basename(String(srcOf(a) || a.file || '')), a]));
  // NEXT-IMAGE NORMALIZED KEY (hero-bg fix): an <img> served by a responsive image optimizer (Next.js
  // `/_next/image?url=<encoded>&w=N&q=N&dpl=…`) has a DIFFERENT w= descriptor than the manifest captured (the browser
  // picks w=3840 from srcset; capture recorded w=1920) → exact/basename match MISS → the asset hot-links the original
  // optimizer URL → 404s offline → the image (resend's full-bleed hero-bg / bg-light glow) silently vanishes. Key
  // instead off the STABLE identity: the decoded inner `url=` path, else the URL with w/q/dpl/auto/fit params stripped.
  const normImg = (u) => {
    if (!u) return null;
    try { const m = /[?&]url=([^&]+)/.exec(u); if (m) return decodeURIComponent(m[1]).split('?')[0]; } catch {}
    return String(u).replace(/[?&](w|q|dpl|auto|fit|fm|dpr|width|height)=[^&]*/g, '').replace(/[?&]$/, '');
  };
  const byNorm = new Map(); for (const a of manifest) { const k = normImg(srcOf(a)); if (k && !byNorm.has(k)) byNorm.set(k, a); }
  const nodes = [];
  (function walk(n) { if (n.tag === 'img' || n.tag === 'svg') nodes.push(n); for (const c of n.children || []) walk(c); })(specTree);
  for (const n of nodes) {
    if (n.tag === 'img') {
      const key = n.src || n.resolvedSrc;
      const entry = byExact.get(key) || byExact.get(n.resolvedSrc) || byBase.get(path.basename(String(key)))
        || byNorm.get(normImg(key)) || byNorm.get(normImg(n.resolvedSrc)) || null;
      if (!entry) continue; // mapper pains + hotlinks
      // width/height = the asset's REAL pixel dims (when the manifest carries them) so the image
      // widget can derive its box from the true aspect ratio instead of a collapsed capture rect.
      const dims = (entry.width && entry.height) ? { width: +entry.width, height: +entry.height } : {};
      // PREFER THE LOCAL FILE over entry.url. In a capture-assets manifest `url` is the ORIGINAL fetched web URL
      // (resend.com/_next/image?…) — NOT a usable hosted asset; it 404s offline and isn't WP media. Only an uploaded-WP
      // url is usable, which we get by uploading entry.file. So: have a local file → upload it (or pendingFile in
      // dry-run); fall back to entry.url only when there is NO local file (a pre-hosted/flat manifest). This is what
      // makes the full-bleed hero-bg / bg-light glow images actually render instead of hot-linking a dead URL.
      if (entry.file && dryRun) assetMap.set(key, { pendingFile: entry.file, ...dims });
      else if (entry.file) assetMap.set(key, { ...(await uploadMedia(entry.file, { base, b64, cache })), ...dims });
      else if (entry.url) assetMap.set(key, { url: entry.url, id: entry.id, ...dims });
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
const SIZE_KEYS = /^(width|min_height|icon_indent|_element_custom_width|_element_custom_height|boxed_width)(_tablet|_mobile)?$/;

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
      // Elementor color controls accept 3/6/8-digit hex, rgb()/rgba() and 'transparent' — not just 6-hex. The old
      // 6-hex-only check rejected the legitimate transparent ghost-CTA background (rgba(0,0,0,0)).
      if (/_color$/.test(k) && typeof v === 'string' && v && !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/.test(v) && !/^rgba?\([\d.,\s]+\)$/.test(v) && v !== 'transparent') errs.push(`${p}.${k}: bad color "${v}"`);
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
export async function transpile({ html, width = 1440, assets, outDir, dryRun, base, b64, siteParts: sitePartsEnabled = true, cap = null }) {
  fs.mkdirSync(outDir, { recursive: true });
  const spec = await extract(html, width);
  // --cap <dir|manifest.json> supplies BOTH the rhythm bands AND the asset manifest (capture-assets writes one
  // manifest.json with both `assets[]` and `perWidth`). Previously only --assets fed loadManifest, so `--cap` alone
  // (the normal clone path) resolved ZERO assets → every image hot-linked its offline-404 original URL (the hero-bg
  // glow + product screenshots all vanished). Fall back to the cap manifest when --assets is not given.
  let assetSrc = assets;
  if (!assetSrc && cap) { try { assetSrc = fs.statSync(cap).isDirectory() ? path.join(cap, 'manifest.json') : cap; } catch { assetSrc = cap; } }
  const manifest = loadManifest(assetSrc);
  // MEDIA-ARRANGEMENT pre-pass (height-blowup fix, fusion 2026-06-21): reconstruct non-additive media containers
  // (grid / carousel / vertical scroll-snap gallery / sticky panel) as bounded flex row+wrap with fluid % cells, so
  // they pack C-per-row instead of stacking full-width (the 2.2x PDP blowup). Runs on spec.tree BEFORE mapNode.
  // Media-presence invariant: image count must be preserved (the bounding can't be achieved by dropping an image).
  // STATUS: OPT-IN (TRANSPILE_MEDIA_ARRANGEMENT=1) — detection + emit are built and fire correctly + preserve every
  // image, but the height reduction is NOT yet landing (fluid-in-cell images aren't shrinking to their % cells on
  // the Allbirds gallery → re-render still tall). Default OFF until the fluid mechanics + container-targeting are
  // verified to drop the clone height to ≤~1.1x source. Off-path is byte-identical (pre-pass does not run).
  if (process.env.TRANSPILE_MEDIA_ARRANGEMENT === '1') {
    const ma = reconstructArrangement(spec.tree);
    if (ma.reconstructed) {
      if (ma.imgsAfter !== ma.imgsBefore) throw new Error(`media-arrangement INVARIANT VIOLATION: images ${ma.imgsBefore}→${ma.imgsAfter} (reconstruction must never drop an image)`);
      console.log(`media-arrangement: reconstructed ${ma.reconstructed} container(s), ${ma.imgsBefore} images preserved`);
      ma.log.forEach((l) => console.log('  •', l));
    }
  }
  // resolveAssets walks the FULL tree (header logos resolve too) — split AFTER.
  const { assetMap, notes } = await resolveAssets(spec.tree, manifest, { dryRun, base, b64, outDir });
  const mapper = makeMapper({ assetMap, authoringWidth: width });
  // §8d: landmark chrome → site parts (Theme Builder documents), page tree stays content-only.
  const partNodes = sitePartsEnabled ? splitSiteParts(spec.tree) : [];
  const siteParts = partNodes.map(({ type, node, tag, cls }) => {
    const partRoot = mapper.mapNode(node, null, []);
    partRoot.settings.content_width = 'full';
    mapper.POLICY.push(`P7 site-part: <${tag}${cls ? ` class="${cls}"` : ''}> extracted as ${type} site part (Pro Theme Builder document; page goes content-only)`);
    return { type, root: partRoot };
  });
  // Canvas suppresses Pro theme headers/footers — flip to Full Width when chrome was extracted.
  const template = siteParts.length ? 'elementor_header_footer' : 'elementor_canvas';
  if (siteParts.length) mapper.POLICY.push(`P7 site-part: page template elementor_canvas → elementor_header_footer (Canvas suppresses Theme Builder parts)`);
  const root = mapper.mapNode(spec.tree, null, []);
  root.settings.content_width = 'full';
  // VERTICAL-RHYTHM NORMALIZER (post-transpile): pin matched-short top-level sections to their source band
  // height via a bottom-padding top-up. Reversible (TRANSPILE_NO_RHYTHM=1); no-op without a --cap manifest or
  // when the page is already ~1:1. spec.tree here is post-site-part-split → 1:1 with root.elements.
  let rhythm = { applied: false, reason: 'no --cap manifest' };
  if (cap) {
    let capManifest = null;
    try {
      const capPath = fs.statSync(cap).isDirectory() ? path.join(cap, 'manifest.json') : cap;
      capManifest = JSON.parse(fs.readFileSync(capPath, 'utf8'));
    } catch (e) { rhythm = { applied: false, reason: `cap manifest unreadable: ${e.message.slice(0, 80)}` }; }
    if (capManifest) {
      // PAGE-BACKGROUND carry (linear dark-theme fix): the offline source.html often loses the body/html background
      // (a JS-applied theme class / CSS var lost on static inlining → linear's dark theme reads transparent offline),
      // so the root container has no bg and the cloned page renders WHITE (dark theme gone). capture-assets records the
      // TRUE page bg (sampled from the online shot) as manifest.pageBg; apply it to the root container when the root has
      // no opaque background of its own. Skip a (near-)white pageBg (the WP canvas is already white → no-op). Reversible:
      // TRANSPILE_NO_PAGEBG=1.
      if (!process.env.TRANSPILE_NO_PAGEBG && capManifest.pageBg) {
        const bg = hex(capManifest.pageBg);
        const rs = root.settings || {};
        const rootHasOpaqueBg = rs.background_background === 'classic' && rs.background_color && hex(rs.background_color) !== '#ffffff';
        const isWhite = !bg || ['#ffffff', '#fefefe'].includes(bg.toLowerCase());
        if (bg && !isWhite && !rootHasOpaqueBg) {
          rs.background_background = 'classic'; rs.background_color = bg; root.settings = rs;
          mapper.POLICY.push(`PAGE-BG: root container background ← captured pageBg ${capManifest.pageBg} (offline source lost the body/html theme color)`);
        }
      }
      rhythm = applyRhythm(root, spec.tree, capManifest, { width });
      if (rhythm.applied) mapper.POLICY.push(`RHYTHM: pinned ${rhythm.sections.filter((s) => s.addBottomPad > 0).length} short section(s) to source band height (+${rhythm.recoveredPx}px bottom-pad total; ratio ${rhythm.ratioBefore}→${rhythm.ratioAfter}; ${rhythm.bands} source bands)`);
      else mapper.POLICY.push(`RHYTHM: no-op (${rhythm.reason || 'no short matched sections'})`);
    }
  }
  for (const note of new Set([...spec.notes, ...notes])) {
    if (/min-width/.test(note)) { if (!mapper.PAIN.includes(note)) mapper.PAIN.push(note); }
    else if (!mapper.POLICY.includes(note)) mapper.POLICY.push(note);
  }
  const localErrors = validateTree([root]);
  for (const p of siteParts) validateTree([p.root], localErrors, `site-part:${p.type}`);
  const treeJson = JSON.stringify([root], null, 2);
  fs.writeFileSync(path.join(outDir, 'tree.json'), treeJson);
  const sitePartsJson = JSON.stringify(siteParts, null, 2);
  if (siteParts.length) fs.writeFileSync(path.join(outDir, 'site-parts.json'), sitePartsJson);
  const report = {
    html: path.resolve(html), authoringWidth: width, dryRun: !!dryRun,
    counts: mapper.counts, pain: mapper.PAIN, policy: mapper.POLICY,
    template,
    siteParts: siteParts.map((p) => ({ type: p.type, sha1: sha1(JSON.stringify(p.root)) })),
    validation: { localErrors, server: null },
    rhythm,
    treeSha1: sha1(treeJson),
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  return { root, siteParts, template, report, mapper, rhythm };
}

// PROACTIVE PRO PROBE (fusion 2026-06-21): site parts require Elementor Pro (Theme Builder). GET /joist/v1/site
// reports the Pro CONSTANT; an explicit `present === false` is ONE-DIRECTIONAL-SAFE (no Pro constant ⟹ no module ⟹
// inlining chrome into the page is genuinely correct), so we can route the free-tier majority single-pass with zero
// doomed POSTs. Only an explicit false forces inline; unknown/true/probe-failure falls through to ATTEMPT site parts
// (protected by putPage's reactive 412 net + always-finalize). Reversible: JOIST_NO_PRO_PROBE=1 skips the probe.
export async function detectProAbsent(base, b64) {
  if (process.env.JOIST_NO_PRO_PROBE === '1') return false;
  try {
    const r = await fetch(`${base}/wp-json/joist/v1/site`, { headers: { Authorization: 'Basic ' + b64 } });
    if (!r.ok) return false;
    const j = await r.json();
    return j?.elementor?.pro?.present === false; // strict false only; absent/unknown/true → don't force inline
  } catch { return false; }
}

export async function putPage(root, { base, b64, pageId, create, title, siteParts = [], template = 'elementor_canvas' }) {
  const auth = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json' };
  if (!pageId && create) {
    const cr = await fetch(`${base}/wp-json/wp/v2/pages`, { method: 'POST', headers: auth, body: JSON.stringify({ title: title || 'html-first transpile', status: 'publish' }) });
    const cj = await cr.json();
    if (!cj.id) throw new Error('page create failed: ' + JSON.stringify(cj).slice(0, 200));
    pageId = cj.id;
    console.log('CREATED PAGE ID:', pageId, '(record this in /tmp/htmlfirst-v1/pages.json)');
  }
  const headers = { ...auth, 'X-Joist-Session-Id': 'htmlfirst-' + Date.now() };

  // Outcome state declared OUTSIDE the try so the ALWAYS-RUN finalize (and the return) can see it. The fusion fix
  // (2026-06-21): the edit_mode=builder finalize must NEVER be skipped — otherwise a chrome-authoring failure leaves
  // the page rendering the post_content FALLBACK, not the Elementor tree (the half-built-page bug). So chrome
  // authoring flags+breaks (never throws), and the finalize lives in a `finally`.
  let putStatus = 0, metaStatus = 0, effTemplate = template;
  let chrome = siteParts.length ? 'site-parts' : 'inlined';
  let chromeReason = siteParts.length ? 'pro-present' : 'inlined-no-parts';
  const partResults = [];
  try {
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
    putStatus = r.status;
    if (r.status >= 300) throw new Error(`PUT failed ${r.status}: ${txt.slice(0, 200)}`); // genuine body failure → propagate (finally still finalizes)

    // §8d: chrome landmarks → Theme Builder site parts, display-conditioned to THIS page only
    // (include/singular/page/<id>) so a transpiled header can never leak onto unrelated pages. Requires Elementor Pro
    // — on free Elementor the proactive probe makes siteParts EMPTY (chrome stays inlined in the body). This loop is
    // the REACTIVE net for a wrong-positive probe (Pro constant present but Theme-Builder module off / license lapsed):
    // it FLAGS+BREAKS instead of throwing, and forces the chrome-in-body canvas template so the finalize renders a
    // complete-enough (body, edit_mode set) page rather than wedging it. (Full re-inline completeness recovery is a
    // follow-on; today a wrong-positive renders body-only — chrome missing but NEVER half-built.)
    for (const part of siteParts) {
      const pr = await fetch(`${base}/wp-json/joist/v1/site-parts`, {
        method: 'POST', headers,
        body: JSON.stringify({
          type: part.type,
          elements: [part.root],
          conditions: [`include/singular/page/${pageId}`],
          title: `${title || 'transpile'} — ${part.type} (page ${pageId})`,
          intent: 'html-first transpile site part',
        }),
      });
      const ptxt = await pr.text();
      if (pr.status >= 300) {
        let code = ''; try { code = JSON.parse(ptxt).code || ''; } catch {}
        chrome = 'inlined';
        chromeReason = code === 'site_part.pro_missing' ? 'pro-missing-fallback' : `chrome-fail:${pr.status}:${code || 'unknown'}`;
        effTemplate = 'elementor_canvas'; // chrome-in-body ⟺ canvas; also undo the header_footer a wrong-positive picked
        console.error(`site-part ${part.type} POST ${pr.status} (${code || 'unknown'}) → inlining chrome, forcing canvas template (page will render, edit_mode set)`);
        break;
      }
      let pj = {}; try { pj = JSON.parse(ptxt); } catch {}
      partResults.push({ type: part.type, id: pj.id, hash: pj.hash, conditions: pj.conditions, render_check_required: pj.render_check_required !== false });
    }
  } finally {
    // FINALIZE — ALWAYS runs (even on a body-PUT throw): set the template + edit_mode=builder so the frontend renders
    // the Elementor TREE, never the post_content fallback. Wrapped so a finalize failure can't mask the real error.
    try {
      const mr = await fetch(`${base}/wp-json/wp/v2/pages/${pageId}`, { method: 'POST', headers: auth, body: JSON.stringify({ status: 'publish', template: effTemplate, meta: { _elementor_edit_mode: 'builder', _wp_page_template: effTemplate, _joist_chrome_inlined: chrome === 'inlined' ? '1' : '0' } }) });
      metaStatus = mr.status;
    } catch (e) { metaStatus = -1; }
  }
  return { pageId, putStatus, metaStatus, template: effTemplate, chrome, chromeReason, siteParts: partResults, url: `${base}/?page_id=${pageId}` };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
  const has = (k) => process.argv.includes('--' + k);
  const html = arg('html');
  if (!html) { console.error('usage: transpile-html.mjs --html <file> [--width 1440] [--assets m.json] [--cap <capture dir|manifest.json>] [--out dir] [--dry-run] [--page id | --create] [--title t] [--no-server-validate] [--no-site-parts]'); process.exit(2); }
  const dryRun = has('dry-run');
  // Default to the LOCAL Docker sandbox — the shared host is paused and must never be the
  // implicit target (eval-integrity "NO shared host" rail). Override with --base / JOIST_BASE.
  // §0 SAFETY GUARD: guard the resolved base BEFORE any serverValidate/PUT/network call —
  // throws LOUDLY if --base / JOIST_BASE points anywhere but localhost:8001 / JOIST_TRAINING_BASE.
  const base = assertAllowedBase(arg('base', process.env.JOIST_BASE || 'http://localhost:8001'));
  const b64 = process.env.JOIST_AUTH_B64;
  if (!dryRun && !b64) { console.error('need JOIST_AUTH_B64 (or --dry-run)'); process.exit(2); }
  const outDir = arg('out', '/tmp/htmlfirst-v1/' + path.basename(html).replace(/\.html?$/, ''));
  (async () => {
    // Proactive Pro probe: free Elementor can't author Theme-Builder site parts, so inline chrome into the page
    // (template→canvas) BEFORE building, avoiding a doomed POST + the half-built throw. --no-site-parts forces it.
    let sitePartsEnabled = !has('no-site-parts');
    if (sitePartsEnabled && !dryRun && b64) {
      if (await detectProAbsent(base, b64)) { sitePartsEnabled = false; console.log('pro probe: Elementor Pro ABSENT → inlining header/footer into the page (template elementor_canvas)'); }
    }
    const { root, siteParts, template, report, mapper, rhythm } = await transpile({ html, width: +arg('width', 1440), assets: arg('assets'), cap: arg('cap'), outDir, dryRun, base, b64, siteParts: sitePartsEnabled });
    console.log('widget counts:', JSON.stringify(mapper.counts));
    if (rhythm) console.log('rhythm:', rhythm.applied ? `+${rhythm.recoveredPx}px (ratio ${rhythm.ratioBefore}→${rhythm.ratioAfter}, ${rhythm.sections.filter((s) => s.addBottomPad > 0).length} sections)` : `no-op (${rhythm.reason})`);
    console.log('tree sha1:', report.treeSha1, '→', path.join(outDir, 'tree.json'));
    if (siteParts.length) console.log('site parts:', siteParts.map((p) => p.type).join(', '), '→', path.join(outDir, 'site-parts.json'), `(page template: ${template})`);
    if (report.validation.localErrors.length) {
      console.error('LOCAL VALIDATION FAILED:'); report.validation.localErrors.forEach((e) => console.error(' -', e));
      process.exit(1);
    }
    console.log('local validation: OK');
    if (!dryRun && !has('no-server-validate')) {
      const sv = await serverValidate(root, { base, b64 });
      for (const p of siteParts) {
        const psv = await serverValidate(p.root, { base, b64 });
        sv.checked += psv.checked; sv.errors.push(...psv.errors.map((e) => ({ ...e, sitePart: p.type })));
      }
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
    const res = await putPage(root, { base, b64, pageId, create: has('create'), title: arg('title'), siteParts, template });
    report.put = res;
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log('PUT', res.putStatus, 'meta', res.metaStatus, 'template', res.template, '| chrome:', res.chrome, `(${res.chromeReason})`);
    for (const p of res.siteParts || []) console.log(`SITE PART ${p.type}: id ${p.id} hash ${p.hash} (render check required)`);
    console.log('URL:', res.url);
  })().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
}
