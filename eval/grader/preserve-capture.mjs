#!/usr/bin/env node
/**
 * @purpose PRESERVE capture (productionized from /tmp/preserve-spike/extract-build.mjs, 2026-06-14).
 * The capture half of the PRESERVE channel: walk a live source subtree and emit, per element, the
 * FULL source-resolved box+paint CSS (position/grid/overflow/transform/box/paint + @media) as a
 * `joist_preserve_css` payload {d,x,m}, KEYED BY CONTENT-HASH so a builder can attach the payload
 * to the matching Elementor element id deterministically.
 *
 * Pairs with the PHP emitter plugin/src/WidgetPack/PreserveCSS/Emitter.php, which stamps the payload
 * to `.elementor-element.elementor-element-<id>` through Elementor's core Post_CSS channel.
 *
 * The browser-side extraction (declBlock / mediaOf / contentHash) is exported as ONE function string
 * (`PRESERVE_BROWSER_FN`) so any builder can inject it into page.evaluate() without re-deriving the
 * proven constant tables (PRES_PROPS / DEFAULT). Node-side helpers (presPayload, keyByHash) build the
 * hash->payload map. This is the load-bearing extraction proven by the spike (226 absolute rules,
 * hRatio 1.000, PRESERVE 72 vs FLOW 8); the constant tables are copied verbatim from the blessed run.
 *
 * USAGE (library):
 *   import { captureSection, PRESERVE_PROPS } from './preserve-capture.mjs';
 *   const { byHash } = await captureSection(page, 'div#components', { ox, oy });
 *   // byHash[contentHash] -> { d, x, m }   ; attach to the matching built element's settings.
 *
 * USAGE (CLI smoke):
 *   node preserve-capture.mjs --url https://clerk.com --sel "div#components" --width 1440
 */

// ── Property tables (verbatim from the blessed spike run) ───────────────────────────────────────
// Box + paint + grid + transform + typography we stamp. Geometry of absolute/fixed descendants is
// rewritten section-relative so the pin survives wherever the section lands.
export const PRESERVE_PROPS = [
  'position', 'top', 'right', 'bottom', 'left', 'transform', 'transform-origin', 'z-index',
  'display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content',
  'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows', 'grid-auto-rows',
  'grid-auto-columns', 'grid-auto-flow', 'grid-column', 'grid-row', 'grid-area', 'place-items', 'place-content',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'box-sizing',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'overflow', 'overflow-x', 'overflow-y',
  'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'box-shadow', 'opacity', 'filter', 'backdrop-filter',
  'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'white-space',
];

// Resolved values we DON'T stamp (lean block; lets the kit win where it agrees).
export const PRESERVE_DEFAULTS = {
  'position': 'static', 'top': 'auto', 'right': 'auto', 'bottom': 'auto', 'left': 'auto',
  'transform': 'none', 'z-index': 'auto', 'transform-origin': '',
  'flex-direction': 'row', 'flex-wrap': 'nowrap', 'justify-content': 'normal', 'align-items': 'normal',
  'align-content': 'normal', 'gap': 'normal', 'row-gap': 'normal', 'column-gap': 'normal',
  'grid-template-columns': 'none', 'grid-template-rows': 'none', 'grid-auto-rows': 'auto', 'grid-auto-columns': 'auto',
  'grid-auto-flow': 'row', 'grid-column': 'auto', 'grid-row': 'auto', 'grid-area': 'auto', 'place-items': 'normal', 'place-content': 'normal',
  'min-width': 'auto', 'min-height': 'auto', 'max-width': 'none', 'max-height': 'none', 'box-sizing': 'content-box',
  'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px',
  'padding-top': '0px', 'padding-right': '0px', 'padding-bottom': '0px', 'padding-left': '0px',
  'overflow': 'visible', 'overflow-x': 'visible', 'overflow-y': 'visible',
  'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none', 'background-size': 'auto', 'background-position': '0% 0%', 'background-repeat': 'repeat',
  'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px',
  'border-top-style': 'none', 'border-right-style': 'none', 'border-bottom-style': 'none', 'border-left-style': 'none',
  'border-top-left-radius': '0px', 'border-top-right-radius': '0px', 'border-bottom-left-radius': '0px', 'border-bottom-right-radius': '0px',
  'box-shadow': 'none', 'opacity': '1', 'filter': 'none', 'backdrop-filter': 'none',
  'text-transform': 'none', 'white-space': 'normal',
};

// ── Browser-side extraction function (string, injected into page.evaluate) ──────────────────────
// Returns a flat list of { hash, d, m, tag, text, rect } for every element under ROOT. `hash` is a
// content-hash (tag + trimmed text + rect) so the Node builder can key the payload to the element it
// emits for that same content. declBlock rewrites absolute/fixed top/left section-relative.
export const PRESERVE_BROWSER_FN = `
function joistPreserveExtract(SEL, PROPS, DEFAULT) {
  const ROOT = document.querySelector(SEL);
  if (!ROOT) return { error: 'selector not found: ' + SEL };
  const rootRect = ROOT.getBoundingClientRect();
  const OX = rootRect.x, OY = rootRect.y;

  // FNV-1a content hash: tag|text|x,y,w,h (section-relative rounded). Stable, matches a builder that
  // emits the same content at the same measured rect.
  function chash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  function declBlock(el, isSectionRoot) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const parts = [];
    const pos = cs.position;
    for (const p of PROPS) {
      let v = cs.getPropertyValue(p);
      if (!v) continue;
      if (DEFAULT[p] !== undefined && v === DEFAULT[p]) continue;
      if (!isSectionRoot && (pos === 'absolute' || pos === 'fixed')) {
        if (p === 'top') { v = Math.round(r.y - OY) + 'px'; }
        else if (p === 'left') { v = Math.round(r.x - OX) + 'px'; }
        else if (p === 'right' || p === 'bottom') { continue; }
        else if (p === 'position') { v = 'absolute'; }
      }
      if ((p === 'width' || p === 'height') && /[%]|auto/.test(v) && r.width > 0 && r.height > 0) {
        v = Math.round(p === 'width' ? r.width : r.height) + 'px';
      }
      parts.push(p + ':' + v);
    }
    if (!isSectionRoot && r.width > 0 && r.height > 0) {
      if (!parts.some(x => x.startsWith('width:'))) parts.push('width:' + Math.round(r.width) + 'px');
    }
    return parts.join(';');
  }

  function mediaOf(el, isSectionRoot) {
    const out = {};
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (rule.type !== 4) continue;
        const cond = rule.conditionText || (rule.media && rule.media.mediaText) || '';
        const m = /max-width:\\s*([\\d.]+)px/.exec(cond);
        if (!m) continue;
        const w = Math.round(+m[1]);
        for (const rr of rule.cssRules) {
          if (rr.type !== 1) continue;
          let hit = false; try { hit = el.matches(rr.selectorText); } catch {}
          if (!hit) continue;
          const decls = [];
          for (let i = 0; i < rr.style.length; i++) { const p = rr.style[i]; decls.push(p + ':' + rr.style.getPropertyValue(p)); }
          if (decls.length) out[w] = (out[w] ? out[w] + ';' : '') + decls.join(';');
        }
      }
    }
    return out;
  }

  function leafText(el) {
    let t = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) t += n.textContent;
      else if (n.nodeType === 1 && n.tagName === 'BR') t += ' ';
      else if (n.nodeType === 1 && !['SCRIPT','STYLE','NOSCRIPT','SVG'].includes(n.tagName)) t += n.textContent;
    }
    return t.replace(/[ \\t\\n]+/g, ' ').trim();
  }
  function effOpacity(el) {
    let o = 1, n = el;
    while (n && n !== ROOT.parentElement) {
      const v = parseFloat(getComputedStyle(n).opacity);
      if (!isNaN(v)) o *= v;
      if (n === ROOT) break;
      n = n.parentElement;
    }
    return Math.round(o * 1000) / 1000;
  }

  const out = [];
  (function walk(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (['script','style','noscript','template','link'].includes(tag)) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    const isSectionRoot = el === ROOT;
    const rect = { x: Math.round(r.x - OX), y: Math.round(r.y - OY), w: Math.round(r.width), h: Math.round(r.height) };
    const text = leafText(el);
    const hash = chash(tag + '|' + text + '|' + rect.x + ',' + rect.y + ',' + rect.w + ',' + rect.h);
    // CONTENT fields a builder needs to emit a REAL widget (image src / anchor href / alt). The {d,x,m}
    // payload is PAINT-only; without these the byHash-keyed overlay would render blank <img>/empty links.
    // resolve <img src> through currentSrc (the actually-painted responsive candidate) then absolutize.
    let src = '', href = '', alt = '';
    if (tag === 'img') {
      src = el.currentSrc || el.getAttribute('src') || '';
      try { if (src) src = new URL(src, location.href).href; } catch {}
      alt = el.getAttribute('alt') || '';
    } else {
      // a background-image on a non-img leaf (common for hero art) — expose its first url() so the
      // builder can choose to emit it as an image rather than a paint-box.
      const bg = cs.backgroundImage || '';
      const mUrl = /url\\((['"]?)([^'")]+)\\1\\)/.exec(bg);
      if (mUrl) { try { src = new URL(mUrl[2], location.href).href; } catch { src = mUrl[2]; } }
    }
    if (tag === 'a') { href = el.getAttribute('href') || ''; try { if (href) href = new URL(href, location.href).href; } catch {} }
    out.push({
      hash, tag, text, rect, src, href, alt,
      d: declBlock(el, isSectionRoot),
      m: mediaOf(el, isSectionRoot),
      effOpacity: effOpacity(el),
      isSectionRoot,
    });
    for (const k of el.children) walk(k);
  })(ROOT);

  return { band: { x: Math.round(rootRect.x), y: Math.round(rootRect.y), w: Math.round(rootRect.width), h: Math.round(rootRect.height) }, nodes: out };
}
`;

// ── Node-side helpers ────────────────────────────────────────────────────────────────────────
/**
 * Build the {d,x,m} payload OBJECT the PHP emitter consumes from one captured node.
 * @param node  a captured node ({ d, m, ... })
 * @param opts  { d } override the desktop decl block (e.g. the builder's proven absolute pin);
 *              { x } an extra full-rule descendant block (inner heading/button color/font);
 *              { m } override the per-breakpoint media map (defaults to the node's captured m).
 * Returns a plain object (NOT stringified) so callers can stringify at attach time — the builder
 * needs the object to layer its pin; the legacy CLI/spike path stringifies via presPayloadStr.
 */
export function presPayloadObj(node, { d = null, x = '', m = null } = {}) {
  return { d: d != null ? d : (node.d || ''), x: x || '', m: m != null ? m : (node.m || {}) };
}
/** Stringified form (what gets stored in the joist_preserve_css element setting). */
export function presPayload(node, opts = {}) {
  return JSON.stringify(presPayloadObj(node, opts));
}

/**
 * Map content-hash -> canonical payload OBJECT for every captured node. This is THE attach table:
 * a builder that emits the same content at the same measured rect computes the identical content-hash
 * (preserve-capture's chash = tag|text|section-relative-rect) and looks up byHash[hash] to attach the
 * matching preserve payload to the element id it just emitted — deterministic, content-addressed.
 * Returns OBJECTS (callers stringify at attach time so they can layer a pin over `d`).
 */
export function keyByHash(captured) {
  const byHash = {};
  for (const n of captured.nodes || []) byHash[n.hash] = presPayloadObj(n);
  return byHash;
}

/**
 * Capture a live section's preserve payloads through an already-open Playwright page.
 * @returns {{ band:object, nodes:Array, byHash:Object }}
 */
export async function captureSection(page, sel) {
  const captured = await page.evaluate(
    ([SEL, PROPS, DEFAULT, FN]) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function('SEL', 'PROPS', 'DEFAULT', FN + '\nreturn joistPreserveExtract(SEL, PROPS, DEFAULT);');
      return fn(SEL, PROPS, DEFAULT);
    },
    [sel, PRESERVE_PROPS, PRESERVE_DEFAULTS, PRESERVE_BROWSER_FN]
  );
  if (captured.error) throw new Error('preserve-capture: ' + captured.error);
  return { ...captured, byHash: keyByHash(captured) };
}

// ── CLI smoke ──────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
  const URL = arg('url', 'https://clerk.com');
  const SEL = arg('sel', 'div#components');
  const WIDTH = +arg('width', 1440);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1200 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  await page.evaluate(async () => { window.scrollTo(0, document.body.scrollHeight); await new Promise(r => setTimeout(r, 600)); window.scrollTo(0, 0); if (document.fonts?.ready) { try { await document.fonts.ready; } catch {} } await new Promise(r => setTimeout(r, 300)); });
  const cap = await captureSection(page, SEL);
  await browser.close();
  const absCount = cap.nodes.filter(n => /position:absolute/.test(n.d)).length;
  const mediaCount = cap.nodes.filter(n => Object.keys(n.m).length).length;
  console.log(JSON.stringify({ band: cap.band, nodes: cap.nodes.length, absRules: absCount, withMedia: mediaCount, sampleHash: cap.nodes[1]?.hash }, null, 2));
}
