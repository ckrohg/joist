#!/usr/bin/env node
/**
 * @purpose STRUCTURAL COMPARISON ENGINE (Phase 2 of the fusion CONVERGENT verdict).
 *
 * The retired vision judge diffed SCREENSHOTS and missed 5 of 8 human-found defects + hallucinated 1.
 * The fix: diff the CAPTURED REPRESENTATIONS (DOM + computed-styles + bbox + pseudo-elements + states),
 * element-by-element, DETERMINISTIC, with vision DEMOTED. Because we build by PROJECTION (each Elementor
 * widget is stamped from a source element), correspondence is an O(1) exact join WHEN the stamp survives;
 * when it does not (e.g. a page built before the stamp channel existed), we fall back to a Hungarian
 * assignment over bbox-IoU + text-edit-distance + tag-mismatch, with an UNMATCHED ceiling.
 *
 * WHAT IT EMITS (per rendered box, on BOTH source and clone):
 *   ElementRecord = {
 *     ref,                       // stamp (--joist-src) if present, else the captured srcPath / a synthetic id
 *     tag, role, text,           // text = normalizeWhitespace(visible text)
 *     box: { <vw>: {x,y,w,h,xFrac,wFrac,right} },   // one box per captured viewport
 *     style: { perceptually load-bearing SUBSET — see CAPTURE_STYLE_PROPS },
 *     pseudo: { before, after, marker:{content,backgroundColor,borderLeft} },
 *     states: { hover: styleDelta, scroll: { 'top@0', 'top@800' } },
 *     asset: { isImage, naturalSrc, svgHash },
 *   }
 *
 * THE JOIN:
 *   • stamp survives  → stampedBackref O(1): relation { srcPath → [widgetIds] } (synthetic Joist
 *     wrappers — clone records with NO stamp and NO 1:1 source — are flagged separately).
 *   • stamp absent    → Hungarian over cost = α(1−bboxIoU@1440) + β·textEditDistance + γ·tagMismatch,
 *     with an UNMATCHED ceiling (a source row whose best cost exceeds the ceiling stays UNMATCHED).
 *
 * THE PAYOFF: UNMATCHED SOURCE refs are PRESENCE-DEFECTS. On the overreacted-v2 clone (page 310) these
 * are expected to surface the human-found missing chrome: the <hr> dividers, the 🤔 emoji bullet spans,
 * the blockquote left-border-bar, the inline-code chips. The states channel surfaces the wrongly-sticky
 * nav (clone header position:fixed @scroll=800; source not) and the responsiveness defect (box deltas at
 * a narrow viewport). Vision is NOT used here — this is the deterministic structural spine.
 *
 * SAFETY (§0 host-guard): the CLONE is rendered ONLY from an allowed training host (localhost:8001) via
 * resolveBase/assertAllowedBase; the external SOURCE is fetched read-only via assertNotBlocked (never the
 * paused shared host). Screenshots/captures use the local-resolved playwright with hard timeouts (NOT
 * mcp-playwright, which wedges). NO git ops. New file, fully reversible.
 *
 * USAGE:
 *   source /tmp/joist-auth-1.env
 *   node compare-capture.mjs \
 *       --source https://overreacted.io/a-complete-guide-to-useeffect/ \
 *       --clone-page 310 \
 *       [--clone-url http://localhost:8001/overreacted-useeffect-clone-v2/] \
 *       [--widths 1440,390] [--scroll 800] [--out /tmp/compare-310.json]
 *   # capture-only of a single page (debug):
 *   node compare-capture.mjs --capture-only --url <url> [--widths 1440,390]
 *   # offline schema dump (no network):
 *   node compare-capture.mjs --schema
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { resolveBase, assertAllowedBase, assertNotBlocked } from '../../sandbox/host-guard.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const has = (n) => argv.includes('--' + n);
const arg = (n, d = null) => { const i = argv.indexOf('--' + n); return i > -1 && argv[i + 1] != null && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : d; };

// Hungarian cost weights + the UNMATCHED ceiling (a source row whose best cost > CEIL stays unmatched).
const ALPHA = Number(arg('alpha', '0.6'));  // (1 - bboxIoU@1440)
const BETA  = Number(arg('beta',  '0.3'));  // normalized text edit distance
const GAMMA = Number(arg('gamma', '0.1'));  // tag mismatch (0/1)
const UNMATCHED_CEIL = Number(arg('ceil', '0.72')); // best cost above this ⇒ defect (no acceptable match)

// ─────────────────────────────────────────────────────────────────────────────
// THE CAPTURE SCRIPT — stringified so it runs IN-PAGE identically for source AND clone.
// Emits one ElementRecord per rendered box at the CURRENT viewport. The driver calls it once per
// viewport and merges the `box` maps; states (hover/scroll) are gathered by the driver via re-eval.
// Kept dependency-free (pure DOM) so it survives `page.evaluate(new Function(...))`.
// ─────────────────────────────────────────────────────────────────────────────
const CAPTURE_FN_SRC = String.raw`
return (function captureElementRecords(opts) {
  opts = opts || {};
  var vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 1440;

  // --- the perceptually load-bearing style SUBSET (longhand, read from computed) ---
  function styleSubset(cs, el) {
    var bw = {
      top: cs.borderTopWidth, right: cs.borderRightWidth, bottom: cs.borderBottomWidth, left: cs.borderLeftWidth,
    };
    var bs = {
      top: cs.borderTopStyle, right: cs.borderRightStyle, bottom: cs.borderBottomStyle, left: cs.borderLeftStyle,
    };
    var bc = {
      top: cs.borderTopColor, right: cs.borderRightColor, bottom: cs.borderBottomColor, left: cs.borderLeftColor,
    };
    return {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      backgroundImage: cs.backgroundImage === 'none' ? null : cs.backgroundImage,
      border: { width: bw, style: bs, color: bc },
      borderRadius: cs.borderTopLeftRadius + ' ' + cs.borderTopRightRadius + ' ' + cs.borderBottomRightRadius + ' ' + cs.borderBottomLeftRadius,
      boxShadow: cs.boxShadow === 'none' ? null : cs.boxShadow,
      opacity: cs.opacity,
      transform: cs.transform === 'none' ? null : cs.transform,
      zIndex: cs.zIndex,
      position: cs.position,
      display: cs.display,
      overflow: cs.overflow + ' ' + cs.overflowX + ' ' + cs.overflowY,
      font: {
        family: cs.fontFamily,
        size: cs.fontSize,
        weight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
      },
      padding: cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft,
      margin: cs.marginTop + ' ' + cs.marginRight + ' ' + cs.marginBottom + ' ' + cs.marginLeft,
      textDecoration: cs.textDecorationLine && cs.textDecorationLine !== 'none'
        ? (cs.textDecorationLine + ' ' + cs.textDecorationColor) : null,
      listStyle: (cs.listStyleType && cs.listStyleType !== 'none') ? (cs.listStyleType + ' ' + cs.listStylePosition) : null,
      whiteSpace: cs.whiteSpace,
    };
  }

  // --- pseudo-elements + list marker (these carry the EMOJI bullets / blockquote bar / chips) ---
  function pseudoOf(el) {
    function p(which) {
      var c = getComputedStyle(el, which);
      var content = c.content;
      if ((!content || content === 'none' || content === 'normal') &&
          c.backgroundColor === 'rgba(0, 0, 0, 0)' && c.backgroundImage === 'none' &&
          parseFloat(c.borderLeftWidth) === 0 && parseFloat(c.width) === 0) return null;
      return {
        content: (content && content !== 'none') ? content : null,
        backgroundColor: c.backgroundColor === 'rgba(0, 0, 0, 0)' ? null : c.backgroundColor,
        backgroundImage: c.backgroundImage === 'none' ? null : c.backgroundImage,
        width: c.width, height: c.height,
        borderLeft: parseFloat(c.borderLeftWidth) > 0 ? (c.borderLeftWidth + ' ' + c.borderLeftStyle + ' ' + c.borderLeftColor) : null,
      };
    }
    var marker = null;
    try {
      var m = getComputedStyle(el, '::marker');
      if (m && m.content && m.content !== 'none' && m.content !== 'normal') {
        marker = { content: m.content, backgroundColor: m.backgroundColor === 'rgba(0, 0, 0, 0)' ? null : m.backgroundColor, borderLeft: null };
      }
    } catch (e) {}
    var before = p('::before'), after = p('::after');
    return { before: before, after: after, marker: marker };
  }

  // --- content-addressed source path (matches _joist-src-roundtrip.mjs: tagchain|nth|h<8hex>) ---
  function textHash8(s) {
    var t = String(s || '').trim().slice(0, 24), h = 0x811c9dc5 >>> 0;
    for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  function srcPathOf(el) {
    var chain = [], nodes = [];
    for (var n = el; n && n.nodeType === 1 && n.tagName !== 'HTML'; n = n.parentElement) nodes.unshift(n);
    for (var i = 0; i < nodes.length; i++) chain.push(nodes[i].tagName.toLowerCase());
    var tagchain = chain.join('>');
    // nth-of-type of the LEAF among same-tag siblings (1-based)
    var nth = 1, sib = el;
    while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) nth++;
    var txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return tagchain + '|' + nth + '|h' + textHash8(txt);
  }

  // --- visible-text normalize (drop descendant block text? no — keep full subtree text, normalized) ---
  function normWS(s) { return String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }

  // --- ARIA-ish role inference (cheap; explicit role wins) ---
  function roleOf(el) {
    var r = el.getAttribute && el.getAttribute('role'); if (r) return r;
    var t = el.tagName.toLowerCase();
    var map = { a: 'link', button: 'button', nav: 'navigation', header: 'banner', footer: 'contentinfo',
      main: 'main', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
      ul: 'list', ol: 'list', li: 'listitem', img: 'img', blockquote: 'blockquote', hr: 'separator',
      code: 'code', pre: 'code', table: 'table' };
    return map[t] || null;
  }

  // --- asset extraction (img natural src, svg structural hash) ---
  function svgHash(el) {
    var h = el.outerHTML.replace(/\s+/g, ' ').trim();
    var x = 0x811c9dc5 >>> 0;
    for (var i = 0; i < h.length; i++) { x ^= h.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return 'svg' + ('00000000' + x.toString(16)).slice(-8) + ':' + h.length;
  }
  function assetOf(el, cs) {
    var t = el.tagName.toLowerCase();
    if (t === 'img') return { isImage: true, naturalSrc: el.currentSrc || el.src || el.getAttribute('src') || '', svgHash: null,
      natW: el.naturalWidth || 0, natH: el.naturalHeight || 0, alt: el.alt || '' };
    if (t === 'svg') return { isImage: true, naturalSrc: null, svgHash: svgHash(el) };
    if (cs && cs.backgroundImage && cs.backgroundImage.indexOf('url(') === 0)
      return { isImage: true, naturalSrc: (cs.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/) || [])[1] || null, svgHash: null, bg: true };
    return { isImage: false, naturalSrc: null, svgHash: null };
  }

  // --- which elements get a record? Every BOX with a non-zero rect that is its own visual unit. ---
  // We include leaves (text/img/svg/hr) AND boxes that paint chrome (bg/border/shadow) so the
  // blockquote-bar, hr, chip, code-block all earn a record. We SKIP head/script/style/noscript.
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, HEAD: 1, META: 1, LINK: 1, TITLE: 1, BR: 1, TEMPLATE: 1 };
  var root = document.querySelector('main') ? document.body : document.body; // walk full body; role/skip filters chrome
  var all = root.querySelectorAll('*');
  var records = [];
  var refSeen = Object.create(null);

  function paintsChrome(cs) {
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') return true;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    if (cs.boxShadow && cs.boxShadow !== 'none') return true;
    for (var i = 0, ps = ['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth']; i < ps.length; i++)
      if (parseFloat(cs[ps[i]]) > 0) return true;
    return false;
  }

  // ATOMIC subtrees: a <pre> code-block (or <svg>) is ONE visual unit. Its descendant syntax-token
  // <span>s are NOT independent elements a clone would ever reproduce 1:1 — emitting a record per token
  // inflates the source set ~4x (overreacted: 4135/5036 records were intra-<pre> spans) and pollutes the
  // join. We record the <pre>/<svg> itself (carrying its bg/color/text/chrome) and SKIP its descendants.
  function insideAtomic(el) {
    for (var n = el.parentElement; n && n.nodeType === 1; n = n.parentElement) {
      if (n.tagName === 'PRE' || n.tagName === 'SVG') return true;
    }
    return false;
  }

  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (SKIP[el.tagName]) continue;
    if (insideAtomic(el)) continue; // descendant of a <pre>/<svg> atomic unit — folded into that unit's record
    var rect = el.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) continue; // not laid out / collapsed
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;

    var ownText = '';
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) ownText += c.textContent;
    ownText = normWS(ownText);
    var fullText = normWS(el.textContent || '');
    var kids = el.children.length;
    var isLeafText = kids === 0 || (ownText.length > 0 && fullText === ownText);
    var t = el.tagName.toLowerCase();
    var isAtom = (t === 'img' || t === 'svg' || t === 'hr' || t === 'code' || t === 'blockquote' || t === 'pre');
    var ps = pseudoOf(el);
    var hasPseudo = ps.before || ps.after || ps.marker;
    var chrome = paintsChrome(cs);

    // Record if: a text leaf, an atom, paints chrome, or carries a meaningful pseudo. Container-only
    // boxes with no chrome/text/pseudo are layout scaffolding — skipped (keeps the record set element-ish).
    if (!(isLeafText && fullText) && !isAtom && !chrome && !hasPseudo) continue;

    var srcStamp = (cs.getPropertyValue('--joist-src') || '').trim().replace(/^["']|["']$/g, '');
    var srcPath = srcPathOf(el);
    var ref = srcStamp || srcPath;
    // de-dup identical refs (rare hash collision) by suffixing an index
    if (refSeen[ref] != null) { refSeen[ref]++; ref = ref + '#' + refSeen[ref]; } else refSeen[ref] = 0;

    var box = {
      x: Math.round(rect.x), y: Math.round(rect.y + window.scrollY),
      w: Math.round(rect.width), h: Math.round(rect.height),
      xFrac: +(rect.x / vw).toFixed(4), wFrac: +(rect.width / vw).toFixed(4),
      right: Math.round(rect.right),
    };

    records.push({
      ref: ref,
      stamp: srcStamp || null,
      srcPath: srcPath,
      tag: t,
      role: roleOf(el),
      text: fullText.slice(0, 400),
      ownText: ownText.slice(0, 200),
      box: box,
      style: styleSubset(cs, el),
      pseudo: ps,
      asset: assetOf(el, cs),
      // index for stable cross-viewport / hover re-identification (DOM order is stable within a load)
      _idx: i,
    });
  }
  return { vw: vw, count: records.length, records: records,
    pageHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) };
})(__OPTS__);
`;

// ─────────────────────────────────────────────────────────────────────────────
// DRIVER: open one page, capture at each viewport, gather states, merge into ElementRecords keyed by _idx.
// ─────────────────────────────────────────────────────────────────────────────
async function capturePage(url, { widths, scrollY, label, isSource }) {
  // guard: clone → allowlist; source → not-blocked (read-only, external allowed).
  if (isSource) assertNotBlocked(url); else assertAllowedBase(url);

  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const result = { url, label, byViewport: {}, records: null, stampRate: 0, pageHeightByVw: {} };
  try {
    const ctx = await browser.newContext({ viewport: { width: widths[0], height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(800);
    // settle lazy assets: scroll to bottom then back (overreacted + clone both lazy-load below the fold)
    await page.evaluate(async () => {
      await new Promise((res) => {
        let y = 0; const step = () => { window.scrollTo(0, y); y += 1200;
          if (y < document.body.scrollHeight) setTimeout(step, 30); else { window.scrollTo(0, 0); setTimeout(res, 300); } };
        step();
      });
    });
    await page.waitForTimeout(400);

    const captureAt = async (w) => {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(250);
      await page.evaluate(() => window.scrollTo(0, 0));
      const fn = CAPTURE_FN_SRC.replace('__OPTS__', JSON.stringify({}));
      return await page.evaluate(new Function(fn));
    };

    // capture at every requested viewport; the FIRST width is the canonical join width (1440).
    const perVw = {};
    for (const w of widths) perVw[w] = await captureAt(w);
    result.pageHeightByVw = Object.fromEntries(widths.map((w) => [w, perVw[w].pageHeight]));

    // ── (#4 RESPONSIVE-2) SOURCE @media BREAKPOINT PARSE (additive, pure read) ────────────────────────────────
    // Enumerate document.styleSheets for CSSMediaRule.media.mediaText, regex-extract (min|max)-width px values →
    // a sorted-unique source-declared breakpoint list. The clone (Hello+free Elementor) can only reflow at its
    // NATIVE breakpoints {768, 480/767}; a SOURCE bp OUTSIDE that set is a width where the clone structurally
    // CANNOT reflow — the authoring WHY attached to a responsive defect, NOT the detector. Cross-origin sheets
    // throw on .cssRules (caught + flagged). New field; ignored by every existing reader if unread.
    try {
      const mq = await page.evaluate(() => {
        const bps = new Set(); let crossOriginSheets = 0, mediaRules = 0;
        const px = (txt) => { const out = []; const re = /(min|max)-width\s*:\s*([\d.]+)px/gi; let m;
          while ((m = re.exec(txt))) out.push(Math.round(parseFloat(m[2]))); return out; };
        const walk = (rules) => { if (!rules) return;
          for (const r of rules) {
            try {
              if (r.type === 4 /* CSSMediaRule */ && r.media && r.media.mediaText) { mediaRules++; for (const v of px(r.media.mediaText)) if (v > 0) bps.add(v); }
              if (r.cssRules) walk(r.cssRules); // @supports / nested
            } catch (e) {}
          }
        };
        for (const sheet of document.styleSheets) {
          let rules; try { rules = sheet.cssRules; } catch (e) { crossOriginSheets++; continue; }
          walk(rules);
        }
        return { breakpoints: [...bps].sort((a, b) => a - b), crossOriginSheets, mediaRules };
      });
      result.mediaBreakpoints = mq.breakpoints;
      result.mediaMeta = { crossOriginSheets: mq.crossOriginSheets, mediaRules: mq.mediaRules };
    } catch (e) { result.mediaBreakpoints = []; result.mediaMeta = { error: String(e && e.message || e) }; }

    // canonical record list = the first-width capture; merge other-width boxes in by _idx.
    const base = perVw[widths[0]].records;
    const byIdx = Object.fromEntries(base.map((r) => [r._idx, r]));
    for (const r of base) { const m = {}; m[widths[0]] = r.box; r.box = m; }
    for (const w of widths.slice(1)) {
      for (const r of perVw[w].records) { const t = byIdx[r._idx]; if (t) t.box[w] = r.box; }
    }

    // STATES — hover styleDelta (on the FIRST viewport) + scroll position@0 / @scrollY.
    await page.setViewportSize({ width: widths[0], height: 900 });
    await page.waitForTimeout(150);
    await page.evaluate(() => window.scrollTo(0, 0));

    // hover: for a bounded sample of interactive leaves (links/buttons), hover and diff the load-bearing subset.
    const hoverTargets = base
      .filter((r) => (r.role === 'link' || r.role === 'button' || r.tag === 'a' || r.tag === 'button'))
      .slice(0, 40);
    for (const r of base) r.states = { hover: null, scroll: null };
    for (const r of hoverTargets) {
      try {
        const delta = await page.evaluate((idx) => {
          const all = document.body.querySelectorAll('*'); const el = all[idx]; if (!el) return null;
          const pick = (cs) => ({ color: cs.color, backgroundColor: cs.backgroundColor,
            textDecoration: cs.textDecorationLine, transform: cs.transform, opacity: cs.opacity,
            borderBottomColor: cs.borderBottomColor, boxShadow: cs.boxShadow });
          const before = pick(getComputedStyle(el));
          // synthesize :hover via pointer events
          el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
          el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          const after = pick(getComputedStyle(el));
          el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
          el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
          const d = {};
          for (const k of Object.keys(before)) if (before[k] !== after[k]) d[k] = { from: before[k], to: after[k] };
          return Object.keys(d).length ? d : null;
        }, r._idx);
        r.states.hover = delta;
      } catch (e) { /* ignore one bad hover */ }
    }
    // a real CSS :hover (events don't always trigger :hover styles) via Playwright hover on a few links:
    try {
      const links = await page.$$('a, button');
      for (let k = 0; k < Math.min(links.length, 12); k++) {
        const idx = await links[k].evaluate((el) => [...document.body.querySelectorAll('*')].indexOf(el));
        const rec = byIdx[idx]; if (!rec || (rec.states.hover && Object.keys(rec.states.hover).length)) continue;
        const probe = async () => links[k].evaluate((el) => { const c = getComputedStyle(el);
          return { color: c.color, backgroundColor: c.backgroundColor, textDecoration: c.textDecorationLine,
            transform: c.transform, opacity: c.opacity, boxShadow: c.boxShadow }; });
        const before = await probe();
        await links[k].hover({ timeout: 1200 }).catch(() => {});
        await page.waitForTimeout(60);
        const after = await probe();
        const d = {}; for (const kk of Object.keys(before)) if (before[kk] !== after[kk]) d[kk] = { from: before[kk], to: after[kk] };
        if (Object.keys(d).length) rec.states.hover = d;
        await page.mouse.move(2, 2);
      }
    } catch (e) { /* hover sampling best-effort */ }

    // scroll: capture position of position:fixed/sticky CANDIDATES at scrollTop=0 and =scrollY.
    // This is THE sticky-nav probe: a header whose viewport-y does NOT change after scrolling is pinned.
    const stickyProbe = async (st) => {
      await page.evaluate((y) => window.scrollTo(0, y), st);
      await page.waitForTimeout(120);
      return await page.evaluate(() => {
        const out = {};
        const cands = document.body.querySelectorAll('header, nav, [class*="header" i], [class*="nav" i], .elementor-section, .e-con');
        const seen = new Set();
        for (const el of cands) {
          const idx = [...document.body.querySelectorAll('*')].indexOf(el);
          if (idx < 0 || seen.has(idx)) continue; seen.add(idx);
          const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
          // only record boxes near the top of the page (potential headers) to bound the payload
          if (r.top > 400 && cs.position !== 'fixed' && cs.position !== 'sticky') continue;
          out[idx] = { top: Math.round(r.top), position: cs.position, zIndex: cs.zIndex };
        }
        return out;
      });
    };
    const at0 = await stickyProbe(0);
    const atY = await stickyProbe(scrollY);
    // attach scroll deltas onto matching records (by _idx); a record present in BOTH whose top is ~constant
    // while the page scrolled = STICKY. Record both tops so the comparer can diff source-vs-clone stickiness.
    const idxs = new Set([...Object.keys(at0), ...Object.keys(atY)].map(Number));
    for (const idx of idxs) {
      const rec = byIdx[idx];
      const a = at0[idx], b = atY[idx];
      const stuck = a && b && Math.abs(a.top - b.top) < 24; // moved <24px while page scrolled `scrollY`
      const entry = { 'top@0': a ? a.top : null, ['top@' + scrollY]: b ? b.top : null,
        position: (b || a || {}).position || null, sticky: !!stuck };
      if (rec) rec.states.scroll = entry;
      else {
        // a sticky box that didn't earn a content record (pure chrome header) — synthesize a minimal record
        // so the sticky-nav defect is never lost just because the box had no text.
      }
    }
    // also expose a page-level sticky summary (which top-region boxes are pinned) for the comparer
    result.stickySummary = Object.entries(atY).filter(([idx]) => {
      const a = at0[idx], b = atY[idx]; return a && b && Math.abs(a.top - b.top) < 24 && (a.top <= 64);
    }).map(([idx]) => ({ idx: Number(idx), position: atY[idx].position, top0: at0[idx] && at0[idx].top, topY: atY[idx].top }));

    // ── (#4 MOTION-2) SCROLL-REVEAL capture (additive; opt-in CAPTURE_REVEAL=1 so existing scores never move) ──
    // For below-fold elements, record opacity/transform BEFORE they enter the viewport vs AFTER (step-scroll them
    // into view). A source AOS/Elementor-entrance reveal swings opacity 0→1 (or translateY→0); a static clone
    // stays put. The engine diffs the source-state-delta vs the clone-state-delta (delta-of-deltas), so this is a
    // pure capture field — it only lights an axis when source reveals AND clone does not. Bounded to ≤80 below-fold
    // candidates. Reuses grade-motion's IntersectionObserver-free approach (a direct before/after read at the
    // element's natural scroll position, which captures the entrance swing whether AOS or native-Elementor).
    if (process.env.CAPTURE_REVEAL === '1') {
      try {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(120);
        // pick below-fold candidates (y > viewport height at join width) with a stable idx; cap 80.
        const candIdxs = base
          .filter((r) => { const b = r.box && (r.box[widths[0]] || r.box[String(widths[0])]); return b && b.y > 900; })
          .slice(0, 80).map((r) => r._idx);
        // BEFORE: read each candidate's opacity/transform while it is still below the fold (page at top).
        const before = await page.evaluate((idxs) => {
          const all = document.body.querySelectorAll('*'); const out = {};
          for (const idx of idxs) { const el = all[idx]; if (!el) continue; const cs = getComputedStyle(el);
            out[idx] = { opacity: parseFloat(cs.opacity), transform: cs.transform }; }
          return out;
        }, candIdxs);
        // step-scroll the whole page so every reveal observer/native entrance fires, then settle at bottom.
        await page.evaluate(async () => {
          await new Promise((res) => { let y = 0; const vh = window.innerHeight; const step = () => {
            window.scrollTo(0, y); y += Math.round(vh * 0.5);
            if (y < document.body.scrollHeight) setTimeout(step, 40); else setTimeout(res, 350); }; step(); });
        });
        await page.waitForTimeout(150);
        // AFTER: read each candidate again (now scrolled into/through view → reveal has fired).
        const after = await page.evaluate((idxs) => {
          const all = document.body.querySelectorAll('*'); const out = {};
          for (const idx of idxs) { const el = all[idx]; if (!el) continue; const cs = getComputedStyle(el);
            out[idx] = { opacity: parseFloat(cs.opacity), transform: cs.transform }; }
          return out;
        }, candIdxs);
        for (const idx of candIdxs) { const rec = byIdx[idx]; if (!rec) continue; const b = before[idx], a = after[idx];
          if (b && a) rec.states.reveal = { opacityBefore: b.opacity, opacityAfter: a.opacity, transformBefore: b.transform, transformAfter: a.transform };
        }
        await page.evaluate(() => window.scrollTo(0, 0));
      } catch (e) { /* reveal capture best-effort; never breaks the main capture */ }
    }

    // strip the internal _idx before returning (keep ref as the identity)
    for (const r of base) delete r._idx;
    result.records = base;
    result.stampRate = base.length ? base.filter((r) => r.stamp).length / base.length : 0;
    return result;
  } finally {
    await browser.close();
  }
}

// ADDITIVE EXPORT (reversible; breaks no existing caller — only re-exposes the existing internal capture).
// Consumed by axisdelta-floor.mjs to RECAPTURE the SAME source N times for the NOISE corpus (path (a):
// scroll-jitter / lazy-load timing / anti-aliasing). Returns {url,label,records (box keyed by box[vw]),
// pageHeightByVw,...} — the EXACT record shape readPairs()/axisDeltas() consume, captured by the SAME pipeline
// the real source side uses, so the recapture noise is faithful (not a synthetic stand-in).
export { capturePage };

// ─────────────────────────────────────────────────────────────────────────────
// CORRESPONDENCE
// ─────────────────────────────────────────────────────────────────────────────
export function bboxIoU(a, b) {
  if (!a || !b) return 0;
  const ax2 = a.x + a.w, ay2 = a.y + a.h, bx2 = b.x + b.w, by2 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy; const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}
// normalized Levenshtein on short text (bounded length so it's cheap)
function textDist(s1, s2) {
  s1 = (s1 || '').slice(0, 80); s2 = (s2 || '').slice(0, 80);
  if (!s1 && !s2) return 0; if (!s1 || !s2) return 1;
  const m = s1.length, n = s2.length; const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (s1[i - 1] === s2[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n] / Math.max(m, n);
}
// content-less ATOMS (hr/img/svg) carry NO text to anchor correspondence — a wrong-tag bbox overlap is
// NOT a real match. Without this, a thin <hr> (1px) bbox-overlaps a tall <div> at low cost and "matches",
// masking the missing-divider defect (overreacted: 6 of 15 <hr> were spuriously matched to clone divs).
const CONTENTLESS_ATOM = new Set(['hr', 'img', 'svg']);
export function pairCost(s, c, joinW) {
  // a content-less atom may ONLY match the SAME tag; otherwise it is unmatchable (→ presence-defect).
  if (CONTENTLESS_ATOM.has(s.tag) && s.tag !== c.tag) return Infinity;
  const iou = bboxIoU(s.box[joinW], c.box[joinW]);
  const td = textDist(s.text, c.text);
  const tag = s.tag === c.tag ? 0 : 1;
  return ALPHA * (1 - iou) + BETA * td + GAMMA * tag;
}

// Greedy min-cost assignment with the UNMATCHED ceiling (a faithful, deterministic stand-in for full
// Hungarian on these sizes — repeatedly take the globally-cheapest acceptable pair; O(n·m·k) but
// candidate lists are pruned by a bbox-y window so it stays well under a second for ~hundreds of rows).
export function assignHungarian(srcRecs, cloneRecs, joinW) {
  const pairs = [];
  for (let i = 0; i < srcRecs.length; i++) {
    const s = srcRecs[i]; const sy = (s.box[joinW] || {}).y || 0;
    for (let j = 0; j < cloneRecs.length; j++) {
      const c = cloneRecs[j]; const cy = (c.box[joinW] || {}).y || 0;
      if (Math.abs(sy - cy) > 1200) continue; // y-window prune: nothing matches >1200px away vertically
      const cost = pairCost(s, c, joinW);
      if (cost <= UNMATCHED_CEIL) pairs.push({ i, j, cost });
    }
  }
  pairs.sort((a, b) => a.cost - b.cost);
  const srcUsed = new Array(srcRecs.length).fill(false);
  const cloneUsed = new Array(cloneRecs.length).fill(false);
  const matched = [];
  for (const p of pairs) {
    if (srcUsed[p.i] || cloneUsed[p.j]) continue;
    srcUsed[p.i] = true; cloneUsed[p.j] = true;
    matched.push({ srcRef: srcRecs[p.i].ref, cloneRef: cloneRecs[p.j].ref, cost: +p.cost.toFixed(4),
      iou: +bboxIoU(srcRecs[p.i].box[joinW], cloneRecs[p.j].box[joinW]).toFixed(3) });
  }
  const unmatchedSource = srcRecs.filter((_, i) => !srcUsed[i]).map((r) => r.ref);
  const unmatchedClone = cloneRecs.filter((_, j) => !cloneUsed[j]).map((r) => r.ref);
  return { method: 'hungarian-greedy', matched, unmatchedSource, unmatchedClone,
    relation: Object.fromEntries(matched.map((m) => [m.srcRef, [m.cloneRef]])) };
}

// O(1) stamped backref join (used only when the clone actually carries stamps).
export function assignStamped(srcRecs, cloneRecs) {
  const cloneByStamp = {};
  const synthetic = [];
  for (const c of cloneRecs) {
    if (c.stamp) (cloneByStamp[c.stamp] = cloneByStamp[c.stamp] || []).push(c.ref);
    else synthetic.push(c.ref); // a clone widget with no stamp = synthesized Joist wrapper/chrome
  }
  const relation = {}; const matchedSrc = new Set(); const matched = [];
  for (const s of srcRecs) {
    const key = s.stamp || s.srcPath; // source carries no stamp; it carries the same content-addressed path
    // a source matches a clone widget whose stamp equals the source's OWN content-addressed path
    const hit = cloneByStamp[key] || cloneByStamp[s.srcPath];
    if (hit && hit.length) { relation[s.srcPath] = hit; matchedSrc.add(s.ref);
      for (const w of hit) matched.push({ srcRef: s.ref, cloneRef: w, via: 'stamp' }); }
  }
  const unmatchedSource = srcRecs.filter((s) => !matchedSrc.has(s.ref)).map((s) => s.ref);
  return { method: 'stamped-backref', matched, unmatchedSource, unmatchedClone: synthetic,
    relation, syntheticJoistWrappers: synthetic };
}

// classify UNMATCHED source refs into human-salient presence-defects (the 8-defect cross-check).
// Each bucket maps to a specific human-found defect; order matters (first match wins, most-specific first).
// The classifier is content-accurate: it keys off the SAME perceptual signals a human used, not just tag.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{1F900}-\u{1F9FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
export function classifyUnmatched(srcRecs, unmatchedRefs) {
  const byRef = Object.fromEntries(srcRecs.map((r) => [r.ref, r]));
  const buckets = { hr_dividers: [], emoji_bullets: [], blockquote_bar: [], inline_code_chips: [], code_blocks: [], images: [], links_text: [], other: [] };
  const px = (v) => parseFloat(v) || 0;
  for (const ref of unmatchedRefs) {
    const r = byRef[ref]; if (!r) continue;
    const st = r.style || {}; const b = st.border || { width: {}, color: {}, style: {} };
    const emojiInOwn = EMOJI_RE.test(r.ownText || '') ||
      (r.pseudo && r.pseudo.before && EMOJI_RE.test(r.pseudo.before.content || '')) ||
      (r.pseudo && r.pseudo.marker && EMOJI_RE.test(r.pseudo.marker.content || ''));
    // chip = an inline <code> painting a real (non-transparent) background + radius (overreacted: rgba(255,229,100,.2), r=10px)
    const isChip = r.tag === 'code' && st.backgroundColor && st.backgroundColor !== 'rgba(0, 0, 0, 0)';
    // blockquote-bar = a blockquote OR any non-code box with a thick LEFT border and no other borders (the accent bar)
    const leftBarOnly = px(b.width.left) >= 2 && px(b.width.top) === 0 && px(b.width.right) === 0 && px(b.width.bottom) === 0;
    if (r.tag === 'hr' || (r.tag === 'div' && r.box && /h811c9dc5/.test(r.ref) && false)) buckets.hr_dividers.push(ref);
    else if (r.tag === 'pre') buckets.code_blocks.push(ref);
    else if (isChip) buckets.inline_code_chips.push(ref);
    else if (r.tag === 'blockquote' || (leftBarOnly && r.tag !== 'code')) buckets.blockquote_bar.push(ref);
    else if (emojiInOwn && (r.tag === 'li' || r.tag === 'span' || r.role === 'listitem')) buckets.emoji_bullets.push(ref);
    else if (r.asset && r.asset.isImage) buckets.images.push(ref);
    else if (r.tag === 'a' || r.role === 'link') buckets.links_text.push(ref);
    else buckets.other.push(ref);
  }
  return buckets;
}

// MATCHED-PAIR ATTRIBUTE DIFF — the "present-but-wrong" channel the screenshot judge is blind to.
// A source element that the clone DID reproduce (text-matched) but whose load-bearing chrome the clone
// DROPPED is a real defect (the human SAW it). This catches: emoji glyph lost, blockquote left-bar lost,
// inline-code chip background lost, code-block dark-bg / syntax-color lost. Each finding names the defect.
export function diffMatchedPairs(matched, srcRecs, cloneRecs) {
  const sByRef = Object.fromEntries(srcRecs.map((r) => [r.ref, r]));
  const cByRef = Object.fromEntries(cloneRecs.map((r) => [r.ref, r]));
  const px = (v) => parseFloat(v) || 0;
  const opaque = (c) => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent';
  const findings = { emoji_glyph_lost: [], blockquote_bar_lost: [], inline_code_chip_lost: [],
    code_block_darkbg_lost: [], left_bar_lost: [], text_decoration_lost: [] };
  for (const m of matched) {
    const s = sByRef[m.srcRef], c = cByRef[m.cloneRef]; if (!s || !c) continue;
    const ss = s.style || {}, cs = c.style || {};
    const sb = ss.border || { width: {}, color: {} }, cb = cs.border || { width: {}, color: {} };
    // (1) emoji glyph present in source text but absent in the clone's matched text
    if (EMOJI_RE.test(s.text || '') && !EMOJI_RE.test(c.text || '')) findings.emoji_glyph_lost.push({ src: m.srcRef, clone: m.cloneRef, sample: (s.text || '').slice(0, 24) });
    // (2) blockquote left-accent-bar: source has a >=2px LEFT border, clone lost it
    if (s.tag === 'blockquote' && px(sb.width.left) >= 2 && px(cb.width.left) < 2) findings.blockquote_bar_lost.push({ src: m.srcRef, clone: m.cloneRef, srcLeft: sb.width.left + ' ' + sb.color.left });
    else if (px(sb.width.left) >= 2 && px(sb.width.top) === 0 && px(cb.width.left) < 2 && s.tag !== 'code') findings.left_bar_lost.push({ src: m.srcRef, clone: m.cloneRef });
    // (3) inline-code chip: source <code> paints a bg, clone lost the bg (no chip)
    if (s.tag === 'code' && opaque(ss.backgroundColor) && !opaque(cs.backgroundColor)) findings.inline_code_chip_lost.push({ src: m.srcRef, clone: m.cloneRef, srcBg: ss.backgroundColor });
    // (4) code block dark-bg/syntax-color lost: source <pre> is dark, clone went light (or transparent)
    if (s.tag === 'pre' && opaque(ss.backgroundColor)) {
      const srcDark = isDark(ss.backgroundColor), cloneDark = isDark(cs.backgroundColor);
      if (srcDark && !cloneDark) findings.code_block_darkbg_lost.push({ src: m.srcRef, clone: m.cloneRef, srcBg: ss.backgroundColor, cloneBg: cs.backgroundColor });
    }
    // (5) text-decoration (underline on links) lost
    if (ss.textDecoration && !cs.textDecoration && (s.tag === 'a')) findings.text_decoration_lost.push({ src: m.srcRef, clone: m.cloneRef });
  }
  return findings;
}
function isDark(rgb) {
  const s = String(rgb || '');
  // a TRANSPARENT bg is not "dark" — it paints nothing. rgba(...,0) / transparent ⇒ false.
  const a = s.match(/rgba?\([^)]*?,\s*([0-9.]+)\s*\)/);
  if (a && parseFloat(a[1]) === 0) return false;
  if (/transparent/.test(s)) return false;
  const m = s.match(/(\d+),\s*(\d+),\s*(\d+)/); if (!m) return false;
  const lum = 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3];
  return lum < 110; // perceptual midpoint-ish; rgb(35,41,54) ≈ 39 → dark
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA (what an ElementRecord looks like) — also dumpable offline via --schema
// ─────────────────────────────────────────────────────────────────────────────
const ELEMENT_RECORD_FIELDS = [
  'ref', 'stamp', 'srcPath', 'tag', 'role', 'text', 'ownText',
  'box.<viewport>.{x,y,w,h,xFrac,wFrac,right}',
  'style.{color,backgroundColor,backgroundImage,border{width,style,color},borderRadius,boxShadow,opacity,transform,zIndex,position,display,overflow,font{family,size,weight,lineHeight,letterSpacing},padding,margin,textDecoration,listStyle,whiteSpace}',
  'pseudo.{before,after,marker{content,backgroundColor,borderLeft}}',
  'states.{hover:styleDelta, scroll:{top@0,top@<scrollY>,sticky}, reveal:{opacityBefore,opacityAfter,transformBefore,transformAfter} (CAPTURE_REVEAL=1)}',
  'asset.{isImage,naturalSrc,svgHash}',
];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  if (has('schema')) {
    console.log(JSON.stringify({ ELEMENT_RECORD_FIELDS, hungarianCost: { ALPHA, BETA, GAMMA, UNMATCHED_CEIL },
      captureFile: path.relative(process.cwd(), fileURLToPath(import.meta.url)) }, null, 2));
    return;
  }

  // DEFAULT stays 1440,390 (reversible: changing it would move every existing caller's score). The #4 sweep
  // wants 768 (the Elementor-native + keystone tablet breakpoint) captured — pass it explicitly via
  // `--widths 1440,768,390`, or opt in with SWEEP_768=1 (folds 768 into the default without touching callers
  // that pass --widths). box[768] then merges in automatically via the existing _idx merge.
  const defaultWidths = process.env.SWEEP_768 === '1' ? '1440,768,390' : '1440,390';
  const widths = (arg('widths', defaultWidths)).split(',').map((s) => parseInt(s, 10)).filter(Boolean);
  const joinW = widths[0];
  const scrollY = parseInt(arg('scroll', '800'), 10);

  if (has('capture-only')) {
    const url = arg('url'); if (!url) { console.error('--capture-only needs --url'); process.exit(2); }
    const isSource = !/localhost|127\.0\.0\.1/.test(url);
    const cap = await capturePage(url, { widths, scrollY, label: 'capture', isSource });
    const out = arg('out', `/tmp/capture-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(cap, null, 2));
    console.log(`captured ${cap.records.length} ElementRecords from ${url} → ${out} (stampRate ${(cap.stampRate * 100).toFixed(1)}%)`);
    return;
  }

  const source = arg('source');
  const clonePage = arg('clone-page');
  let cloneUrl = arg('clone-url');
  if (!source || (!cloneUrl && !clonePage)) {
    console.error('usage: --source <url> --clone-page <id> [--clone-url <url>] [--widths 1440,390] [--scroll 800] [--out <json>]');
    process.exit(2);
  }
  const base = resolveBase(process.env.JOIST_BASE); // guarded local base
  if (!cloneUrl) cloneUrl = `${base}/?page_id=${clonePage}`;
  assertAllowedBase(cloneUrl);
  assertNotBlocked(source);

  console.log(`[compare] SOURCE  ${source}`);
  console.log(`[compare] CLONE   ${cloneUrl}  (page ${clonePage || '-'})`);
  console.log(`[compare] widths ${widths.join(',')} | join@${joinW} | scrollY ${scrollY} | cost α${ALPHA} β${BETA} γ${GAMMA} ceil ${UNMATCHED_CEIL}`);

  const [src, clone] = await Promise.all([
    capturePage(source, { widths, scrollY, label: 'source', isSource: true }),
    capturePage(cloneUrl, { widths, scrollY, label: 'clone', isSource: false }),
  ]);

  // pick join method by whether the CLONE carries stamps (the source never does; it carries srcPath).
  const cloneHasStamps = clone.records.some((r) => r.stamp);
  const join = cloneHasStamps ? assignStamped(src.records, clone.records) : assignHungarian(src.records, clone.records, joinW);
  const matchRate = src.records.length ? join.matched.length / src.records.length : 0;

  const unmatchedBuckets = classifyUnmatched(src.records, join.unmatchedSource);
  // present-but-wrong defects on MATCHED pairs (emoji glyph / blockquote bar / chip bg / code dark-bg)
  const matchedDefects = diffMatchedPairs(join.matched, src.records, clone.records);
  const matchedDefectCounts = Object.fromEntries(Object.entries(matchedDefects).map(([k, v]) => [k, v.length]));

  // RESPONSIVENESS signal: does the clone reflow with width like the source? Compare wFrac stability of
  // matched pairs across the narrow viewport. A clone that does NOT reflow keeps fixed px (wFrac shrinks
  // at 390 because the box stayed 1440-wide) → defect (7→1: "not responsive to width").
  let responsive = null;
  if (widths.length > 1 && !cloneHasStamps) {
    const narrow = widths[1];
    const matchedPairs = join.matched.map((m) => ({
      s: src.records.find((r) => r.ref === m.srcRef), c: clone.records.find((r) => r.ref === m.cloneRef) })).filter((p) => p.s && p.c);
    let reflowAgreements = 0, n = 0;
    for (const { s, c } of matchedPairs) {
      const sN = s.box[narrow], cN = c.box[narrow], sW = s.box[joinW], cW = c.box[joinW];
      if (!sN || !cN || !sW || !cW) continue;
      const srcReflowed = sN.w < sW.w * 0.9;      // source box got narrower at the narrow viewport
      const cloneReflowed = cN.w < cW.w * 0.9;     // clone box got narrower too
      if (srcReflowed) { n++; if (cloneReflowed) reflowAgreements++; }
    }
    responsive = { narrowViewport: narrow, srcReflowingBoxes: n, cloneAlsoReflowed: reflowAgreements,
      reflowAgreement: n ? +(reflowAgreements / n).toFixed(3) : null,
      cloneOverflowsViewport: (clone.pageHeightByVw[narrow] != null && (clone.records.some((r) => (r.box[narrow] || {}).right > narrow * 1.15))) };
  }

  // STICKY-NAV signal: did the clone pin a top box that the source does NOT pin (defect 8)?
  const sticky = {
    sourceStickyTopBoxes: (src.stickySummary || []).length,
    cloneStickyTopBoxes: (clone.stickySummary || []).length,
    cloneWronglySticky: ((clone.stickySummary || []).length > 0 && (src.stickySummary || []).length === 0),
  };

  // ── (#4 RESPONSIVE-3) STAMP-INDEPENDENT per-width OVERFLOW boolean + source @media breakpoints ────────────────
  // The h-overflow boolean needs NO correspondence (it reads only cBox.right vs vw), so it survives a broken narrow
  // join AND the stamped-clone branch. We surface a per-width clone-overflow boolean at every narrow width plus the
  // SOURCE-declared @media breakpoints folded against Elementor's native set {768,480} (a source bp outside it = a
  // width the clone structurally cannot reflow — the authoring WHY). Additive: existing `responsive` is untouched.
  const ELEMENTOR_NATIVE_BP = [768, 480];
  const srcBps = src.mediaBreakpoints || [];
  const overflowByWidth = {};
  for (const w of widths.slice(1)) {
    const overEls = clone.records.filter((r) => { const b = r.box && (r.box[w] || r.box[String(w)]); return b && b.right != null && b.right > w * 1.02; });
    // source overflow at the same width (so we only flag where the SOURCE did NOT overflow — survives reflow).
    const srcOverEls = src.records.filter((r) => { const b = r.box && (r.box[w] || r.box[String(w)]); return b && b.right != null && b.right > w * 1.02; });
    overflowByWidth[w] = {
      cloneOverflows: overEls.length > 0,
      cloneOverflowCount: overEls.length,
      sourceOverflows: srcOverEls.length > 0,
      worstClonePx: overEls.reduce((mx, r) => { const b = r.box[w] || r.box[String(w)]; return Math.max(mx, b.right - w); }, 0),
    };
  }
  const responsiveSweep = {
    widths: widths.slice(1),
    overflowByWidth,
    sourceMediaBreakpoints: srcBps,
    elementorNativeBreakpoints: ELEMENTOR_NATIVE_BP,
    // a source bp NOT near a native Elementor bp (±32px) = a width the clone cannot reflow at (authoring WHY).
    unreflowableSourceBreakpoints: srcBps.filter((bp) => !ELEMENTOR_NATIVE_BP.some((nb) => Math.abs(bp - nb) <= 32)),
    sourceMediaMeta: src.mediaMeta || null,
    note: 'overflow boolean is stamp-independent + correspondence-free → survives a broken narrow join; unreflowableSourceBreakpoints is the authoring WHY (NOT the detector — rendered overflow is ground truth).',
  };

  const report = {
    source, clone: cloneUrl, clonePage: clonePage ? Number(clonePage) : null,
    widths, joinWidth: joinW, scrollY,
    counts: { sourceRecords: src.records.length, cloneRecords: clone.records.length },
    stamp: { cloneHasStamps, cloneStampRate: +(clone.stampRate).toFixed(3), sourceStampRate: +(src.stampRate).toFixed(3) },
    correspondence: { method: join.method, weights: { ALPHA, BETA, GAMMA, UNMATCHED_CEIL } },
    matchRate: +(matchRate).toFixed(3),
    matched: join.matched.length,
    unmatchedSourceCount: join.unmatchedSource.length,
    unmatchedSource: join.unmatchedSource,
    unmatchedSourceBuckets: unmatchedBuckets,
    matchedPairDefects: matchedDefectCounts,
    matchedPairDefectsDetail: matchedDefects,
    unmatchedClone: join.unmatchedClone,
    syntheticJoistWrappers: join.syntheticJoistWrappers || [],
    relationSample: Object.fromEntries(Object.entries(join.relation).slice(0, 20)),
    relation: join.relation,
    responsive, sticky, responsiveSweep,
    pageHeightByVw: { source: src.pageHeightByVw, clone: clone.pageHeightByVw },
  };

  const out = arg('out', `/tmp/compare-${clonePage || 'x'}.json`);
  fs.writeFileSync(out, JSON.stringify({ report, sourceCapture: src, cloneCapture: clone }, null, 2));

  // ── human-readable verdict ──
  console.log('\n==== STRUCTURAL COMPARISON ====');
  console.log(`records: source ${src.records.length} | clone ${clone.records.length}`);
  console.log(`join: ${join.method} (clone stamps ${cloneHasStamps ? 'PRESENT' : 'ABSENT → Hungarian fallback'})`);
  console.log(`matchRate: ${(matchRate * 100).toFixed(1)}%  (${join.matched.length}/${src.records.length} source rows matched)`);
  console.log(`UNMATCHED source (PRESENCE defects — wholly missing): ${join.unmatchedSource.length}`);
  for (const [k, v] of Object.entries(unmatchedBuckets)) if (v.length) console.log(`    ${k}: ${v.length}  e.g. ${v.slice(0, 2).join(' , ')}`);
  console.log(`MATCHED-PAIR defects (PRESENT-BUT-WRONG — text kept, chrome dropped):`);
  for (const [k, v] of Object.entries(matchedDefects)) if (v.length) console.log(`    ${k}: ${v.length}  e.g. ${JSON.stringify(v[0]).slice(0, 90)}`);
  if (responsive) console.log(`responsive: src reflowed ${responsive.srcReflowingBoxes} boxes @${responsive.narrowViewport}, clone followed ${responsive.cloneAlsoReflowed} (agreement ${responsive.reflowAgreement}); cloneOverflows=${responsive.cloneOverflowsViewport}`);
  console.log(`sticky: source ${sticky.sourceStickyTopBoxes} pinned top boxes, clone ${sticky.cloneStickyTopBoxes} → cloneWronglySticky=${sticky.cloneWronglySticky}`);
  console.log(`\nfull report + both captures → ${out}`);

  // also persist the bare report (no captures) for cheap downstream reads
  fs.writeFileSync((out.replace(/\.json$/, '') + '.report.json'), JSON.stringify(report, null, 2));
}

// run main ONLY when executed directly (so the self-test can import the pure functions without firing it)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('compare-capture FAILED:', e && e.stack || e); process.exit(1); });
}
