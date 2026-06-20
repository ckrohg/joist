#!/usr/bin/env node
// @purpose HTML-FIRST capture upgrades (knowledge/PATH_TO_TRUE_1TO1.md §8c): state-pinned multi-width SOURCE
// capture with real assets, computed style facts, matched media-query diffs, and a section map. ADDITIVE &
// STANDALONE — deliberately does NOT touch or import capture-layout.mjs (other rounds own it). Per width it:
//   1. opens a reducedMotion context, loads the page, runs the settleLazy pattern (inlined from
//      grade-vision-tiles.mjs:102 — kept standalone on purpose; that file is a CLI and importing it risks
//      top-level side effects),
//   2. STATE-PINS the page: dismisses cookie/consent overlays (click obvious accept/dismiss buttons, else
//      CSS-hides consent-looking fixed/sticky z>999 overlay nodes — guarded so fixed NAVS are never hidden),
//      FREEZES animations (finite animations → finish() so entrance effects show their END state; infinite
//      loops/marquees → pause() at t=settled; then injects transition:none + animation-play-state:paused so
//      nothing moves between freeze and shot), and DEDUPES layered animated text (two siblings rendering the
//      SAME text stacked → keep the visible-end-state one, CSS-hide the rest) — judge-fairness items from the
//      clerk-hero spike (§8c: logo-rotation freeze, cookie-modal dismissal),
//   3. takes the full-page screenshot in that pinned state,
//   4. extracts ASSETS (img/picture/inline-svg/video-poster/background-image in the first --max-px px; inline
//      SVGs serialized to files; everything else downloaded to <out>/assets/ with locator+box+natural size),
//   5. extracts STYLE FACTS per visible element (capped): computed font stack/size/weight/color/bg/
//      border-radius/shadow at each width PLUS the matched @media rules at that width — node-side we diff the
//      matched-rule sets between widths (the research-validated responsive channel: breakpoint regrouping is
//      E′'s primary responsive signal, see memory triview_correspondence_proven),
//   6. emits a SECTION MAP using the grade-sections full-width band heuristic (grade-sections.mjs:1057 —
//      w >= 0.82*vw, h >= 120, y-dedupe 60px) with per-section screenshot crops per width.
//
// CLI:  node capture-assets.mjs --source <url> --out <dir> [--widths 1440,1100,768] [--max-px 20000]
// Out:  <out>/manifest.json           — source, per-width state log + sections + shots, asset manifest, stats
//       <out>/style-facts.json        — per-locator per-width computed facts + mediaRules + mediaDiffs
//       <out>/shots/w<W>.png          — state-pinned full-page screenshot per width
//       <out>/sections/w<W>-s<i>.png  — per-section crops per width
//       <out>/assets/*                — downloaded originals + serialized inline SVGs (hash-named, deterministic)
//       <out>/source.html             — GAP 3: rendered post-JS DOM (copy-paste text source)   [CAPTURE_NO_DOM=1]
//       <out>/outline.txt             — GAP 3: section-banded heading/CTA/paragraph outline      [CAPTURE_NO_DOM=1]
//       <out>/crops/<id>-w<W>.png     — GAP 1: region-raster crops (product-UI / mock / illustration / image)
//       <out>/crops-manifest.json     — GAP 1: {id, classification, confidence, perWidth box, files, suggestedWidth} [CAPTURE_NO_CROPS=1]
// REVERSIBILITY (env, default = upgrades ON): CAPTURE_NO_SVGFIX=1 (GAP2 raw outerHTML), CAPTURE_NO_DOM=1 (GAP3),
//   CAPTURE_NO_CROPS=1 (GAP1). Each flag isolates one upgrade so a regression is a single toggle.
// DETERMINISM: no timestamps anywhere; asset files named by sha1(url|markup); element/section order is document
// order; manifest key order is fixed. Two runs on a static fixture produce byte-identical manifests + shots.
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const SOURCE = flag('source', null);
const OUT = flag('out', null);
const WIDTHS = String(flag('widths', '1440,1100,768')).split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0);
const MAX_PX = parseInt(flag('max-px', '20000'), 10);     // assets + style facts only read the first N page px
const EL_CAP = parseInt(flag('el-cap', '1200'), 10);      // style-fact elements per width (document order)
const RULE_EL_CAP = 700;                                  // elements that get @media rule matching (cost bound)
const PER_EL_RULE_CAP = 24;                               // matched media rules kept per element
const MEDIA_RULE_CAP = 3000;                              // matching @media style rules collected per width
const ASSET_CAP = 400;                                    // unique asset URLs per page
const SECTION_CROP_MAX_H = 6000;                          // px — clamp absurdly tall band crops
const CROP_CAP = parseInt(flag('crop-cap', '120'), 10);   // GAP 1 — region-raster candidate crops per width
// ── reversibility flags (env, default OFF = upgrades ON). Each isolates one GAP so a regression is one toggle. ─
const NO_SVGFIX = process.env.CAPTURE_NO_SVGFIX === '1';  // GAP 2 — fall back to raw <svg>.outerHTML
const NO_DOM    = process.env.CAPTURE_NO_DOM === '1';     // GAP 3 — skip outline.txt + source.html
const NO_CROPS  = process.env.CAPTURE_NO_CROPS === '1';   // GAP 1 — skip crops/ + crops-manifest.json
const NO_CSS_INLINE = process.env.CAPTURE_NO_CSS_INLINE === '1'; // GAP 4 — leave external <link> CSS (source.html not self-contained)
if (!SOURCE || !OUT) {
  console.error('usage: node capture-assets.mjs --source <url> --out <dir> [--widths 1440,1100,768] [--max-px 20000]');
  process.exit(2);
}
for (const d of ['', 'shots', 'sections', 'assets', ...(NO_CROPS ? [] : ['crops'])]) fs.mkdirSync(path.join(OUT, d), { recursive: true });

// ── settleLazy (inlined from grade-vision-tiles.mjs:102, KEPT pattern — see header for why not imported) ─────
async function settleLazy(page) {
  try {
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const docH = () => document.body.scrollHeight;
      let y = 0, guard = 0;
      while (y <= docH() && guard++ < 400) { window.scrollTo(0, y); await sleep(110); y += 600; }
      window.scrollTo(0, docH()); await sleep(250);
      const pending = () => [...document.images].filter((im) => !(im.complete && im.naturalWidth > 0));
      const deadline = Date.now() + 8000;
      while (pending().length && Date.now() < deadline) await sleep(150);
      // SEQUENTIAL decode capped at 64 (the concurrent fan-out OOM-killed the renderer on supabase, 2026-06-10)
      const decodable = [...document.images].filter((im) => im.complete && im.naturalWidth > 0).slice(0, 64);
      for (const im of decodable) { try { if (im.decode) await im.decode(); } catch {} }
      window.scrollTo(0, 0); await sleep(150);
    }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400).catch(() => {});
  } catch { /* page closed mid-settle → degrade; screenshot step handles it */ }
}

// ── state pin 1: cookie/consent overlays — click accept/dismiss, else CSS-hide (nav-safe) ────────────────────
async function dismissOverlays(page) {
  const log = await page.evaluate(() => {
    const out = [];
    const cssPath = (el) => { const seg = []; let n = el, g = 0; while (n && n.nodeType === 1 && n !== document.documentElement && g++ < 12) { let s = n.tagName.toLowerCase(); if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { seg.unshift(`${s}#${n.id}`); break; } const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []; if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(n) + 1})`; seg.unshift(s); n = n.parentElement; } return seg.join('>'); };
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.02; };
    // pass A: CLICK an obvious accept/dismiss inside consent-looking roots
    const ACCEPT = /^(accept( all)?( cookies)?|allow( all)?( cookies)?|agree( & continue)?|i (agree|accept|understand)|got it|ok(ay)?|understood|dismiss|reject all|necessary( cookies)? only|only necessary|save( and| &)? (close|accept|exit)|close)$/i;
    const roots = [...document.querySelectorAll('[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[id*=gdpr i],[class*=gdpr i],#onetrust-banner-sdk,#CybotCookiebotDialog,.cc-window,[id*=cookiebanner i],[role=dialog],[aria-modal=true]')]
      .filter((el) => vis(el) && /cookie|consent|gdpr|privacy|tracking/i.test((el.textContent || '').slice(0, 4000) + ' ' + el.id + ' ' + el.className));
    // pass A2: TEXT-detected banners with no consent markup at all (clerk.com: pure-Tailwind `fixed bottom-7
    // z-150` div, no id/class keywords, no role=dialog, z far below the pass-B gate). A fixed/sticky element
    // whose SHORT text says "we use cookies"-style phrasing IS a consent banner — no nav/hero ever says that.
    const CONSENT_PHRASE = /\b(we use cookies|(this |our )?(web)?site uses cookies|cookie (policy|preferences|settings|notice)|manage (your )?cookie)\b/i;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt.length > 600 || !CONSENT_PHRASE.test(txt)) continue;
      const r = el.getBoundingClientRect();
      if (!vis(el) || r.height > innerHeight * 0.6) continue;     // banner-shaped, not a takeover of the page
      if (!roots.includes(el)) roots.push(el);
    }
    for (const root of roots) {
      const btns = [...root.querySelectorAll('button,[role=button],a,input[type=button],input[type=submit]')].filter(vis);
      // prefer explicit accept over generic close
      btns.sort((a, b) => (/accept|allow|agree/i.test(b.textContent || b.value || '') ? 1 : 0) - (/accept|allow|agree/i.test(a.textContent || a.value || '') ? 1 : 0));
      const hit = btns.find((b) => ACCEPT.test(((b.textContent || b.value || '').replace(/\s+/g, ' ').trim()))
        || /accept|dismiss|close/i.test(b.getAttribute('aria-label') || ''));
      if (hit) { try { hit.click(); out.push({ action: 'clicked', locator: cssPath(hit), text: (hit.textContent || hit.value || '').trim().slice(0, 60) }); } catch {} }
    }
    return out;
  }).catch(() => []);
  await page.waitForTimeout(700).catch(() => {});
  // pass B: CSS-HIDE whatever consent overlay survived. Guarded: fixed/sticky z>999 alone is NOT enough (site
  // navs are fixed high-z too) — the node must LOOK like consent (keywords in text/id/class) OR be a full-
  // viewport modal/backdrop. Every hide is logged with its locator so the state pin is auditable.
  const hidden = await page.evaluate(() => {
    const out = [];
    const cssPath = (el) => { const seg = []; let n = el, g = 0; while (n && n.nodeType === 1 && n !== document.documentElement && g++ < 12) { let s = n.tagName.toLowerCase(); if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { seg.unshift(`${s}#${n.id}`); break; } const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []; if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(n) + 1})`; seg.unshift(s); n = n.parentElement; } return seg.join('>'); };
    const CONSENT_PHRASE = /\b(we use cookies|(this |our )?(web)?site uses cookies|cookie (policy|preferences|settings|notice)|manage (your )?cookie)\b/i;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (!(cs.position === 'fixed' || cs.position === 'sticky')) continue;
      const z = parseInt(cs.zIndex, 10) || 0;
      const r = el.getBoundingClientRect();
      if (r.width < 5 || r.height < 5 || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const shortTxt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      // STRONG text match ("we use cookies" phrasing, short, banner-shaped) needs no z gate — clerk's banner
      // is z-150 with zero consent markup. Everything else keeps the z>999 gate (site navs are fixed low-z).
      const strongConsent = shortTxt.length <= 600 && CONSENT_PHRASE.test(shortTxt) && r.height <= innerHeight * 0.6;
      if (z <= 999 && !strongConsent) continue;
      const meta = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`;
      const looksConsent = strongConsent
        || /cookie|consent|gdpr|cmp-|onetrust|cookiebot|didomi|usercentrics|truste/i.test(meta)
        || (/cookie|consent|gdpr/i.test((el.textContent || '').slice(0, 4000)) && /privacy|polic|accept|agree|preferences|tracking/i.test((el.textContent || '').slice(0, 4000)));
      const coversViewport = r.width >= innerWidth * 0.85 && r.height >= innerHeight * 0.85;
      const modalish = el.matches('[role=dialog],[aria-modal=true],[class*=backdrop i],[class*=modal i],[class*=overlay i]');
      if (looksConsent || (coversViewport && modalish)) {
        el.style.setProperty('display', 'none', 'important');
        out.push({ action: 'css-hidden', locator: cssPath(el), reason: looksConsent ? 'consent-keywords' : 'fullscreen-modal' });
      }
    }
    // consent managers often scroll-lock the body; unlock so settleLazy can reach the whole page
    for (const n of [document.documentElement, document.body]) {
      if (getComputedStyle(n).overflow === 'hidden' || getComputedStyle(n).overflowY === 'hidden') {
        n.style.setProperty('overflow', 'visible', 'important');
        out.push({ action: 'scroll-unlocked', locator: n.tagName.toLowerCase() });
      }
    }
    return out;
  }).catch(() => []);
  return [...log, ...hidden];
}

// ── state pin 2: FREEZE animations. finite → finish() (END state: entrance fades land where a human sees them);
// infinite (marquee/spinner) → pause() at t=settled (animation:none would snap a marquee to t=0 — wrong pose).
// Then a kill-sheet pins everything: transition:none + animation-play-state:paused. Videos paused. ──────────────
async function freezeAnimations(page) {
  return await page.evaluate(() => {
    const log = { finished: 0, pausedInfinite: 0, videos: 0 };
    for (const a of document.getAnimations()) {
      try {
        const t = (a.effect && a.effect.getTiming) ? a.effect.getTiming() : {};
        if (t.iterations === Infinity) { a.pause(); log.pausedInfinite++; }
        else { a.finish(); log.finished++; }
      } catch { try { a.pause(); log.pausedInfinite++; } catch {} }
    }
    for (const v of document.querySelectorAll('video')) { try { v.pause(); log.videos++; } catch {} }
    const st = document.createElement('style');
    st.id = '__capture_assets_freeze__';
    st.textContent = '*,*::before,*::after{transition:none !important;animation-play-state:paused !important;scroll-behavior:auto !important;caret-color:transparent !important;}';
    document.documentElement.appendChild(st);
    return log;
  }).catch(() => ({ finished: 0, pausedInfinite: 0, videos: 0, error: true }));
}

// ── state pin 3: dedupe layered animated text — two SIBLINGS rendering the SAME text stacked (rotating-text /
// crossfade duplicates) → keep the visible-end-state one (highest effective opacity; tie → later sibling, which
// paints on top), CSS-hide the rest. Logged per pair. ─────────────────────────────────────────────────────────
async function dedupeStackedText(page) {
  return await page.evaluate(() => {
    const out = [];
    const cssPath = (el) => { const seg = []; let n = el, g = 0; while (n && n.nodeType === 1 && n !== document.documentElement && g++ < 12) { let s = n.tagName.toLowerCase(); if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { seg.unshift(`${s}#${n.id}`); break; } const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []; if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(n) + 1})`; seg.unshift(s); n = n.parentElement; } return seg.join('>'); };
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const effOpacity = (el) => { let o = 1, n = el, g = 0; while (n && n !== document.body && g++ < 30) { o *= parseFloat(getComputedStyle(n).opacity || '1'); n = n.parentElement; } return o; };
    for (const par of document.querySelectorAll('body *')) {
      if (par.children.length < 2 || par.children.length > 30) continue;
      const kids = [...par.children].filter((k) => { const r = k.getBoundingClientRect(); return r.width > 4 && r.height > 4 && norm(k.textContent).length > 0 && getComputedStyle(k).display !== 'none' && getComputedStyle(k).visibility !== 'hidden'; });
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i], b = kids[j];
          if (norm(a.textContent) !== norm(b.textContent)) continue;
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
          const iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
          const minArea = Math.max(1, Math.min(ra.width * ra.height, rb.width * rb.height));
          if ((ix * iy) / minArea < 0.6) continue;           // not stacked — side-by-side dupes are legit content
          const oa = effOpacity(a), ob = effOpacity(b);
          const drop = oa > ob ? b : oa < ob ? a : a;        // tie → hide the EARLIER sibling (later paints on top)
          const keep = drop === a ? b : a;
          drop.style.setProperty('visibility', 'hidden', 'important');
          out.push({ kept: cssPath(keep), hidden: cssPath(drop), text: norm(a.textContent).slice(0, 80) });
        }
      }
      if (out.length > 60) break; // cap pathological pages
    }
    return out;
  }).catch(() => []);
}

// ── in-page extraction: sections (band heuristic), assets inventory, style facts + matched @media rules ───────
async function extractFacts(page, opts) {
  return await page.evaluate((O) => {
    const cssPath = (el) => { const seg = []; let n = el, g = 0; while (n && n.nodeType === 1 && n !== document.documentElement && g++ < 12) { let s = n.tagName.toLowerCase(); if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { seg.unshift(`${s}#${n.id}`); break; } const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []; if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(n) + 1})`; seg.unshift(s); n = n.parentElement; } return seg.join('>'); };
    const box = (r) => ({ x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) });
    const out = { pageH: Math.round(document.body.scrollHeight), sections: [], assets: [], styles: [], inaccessibleSheets: 0, truncated: {} };
    const vw = window.innerWidth;

    // ── GAP 2 serializer: turn a LIVE inline <svg> into a self-contained, correctly-colored .svg string ──────
    // Inline SVGs in an HTML document inherit two things the standalone file loses: (1) the xmlns namespace
    // (implicit under the HTML parser, REQUIRED for a .svg loaded via <img>/file://), and (2) `currentColor`
    // plus unset fill/stroke which resolve against the CSS-cascade `color` of the live element — gone once the
    // node leaves the page. We clone the subtree, then walk original↔clone in lockstep and BAKE the computed
    // paint onto every clone node so the file renders the color a human saw. Conservative: only overwrite paint
    // that was currentColor / inherit / unset (where the value truly came from the cascade); explicit colors and
    // url(#gradient)/none paints are left untouched. Geometry/transforms/defs are preserved verbatim by clone.
    const serializeStandaloneSvg = (svg) => {
      try {
        const SVGNS = 'http://www.w3.org/2000/svg', XLINKNS = 'http://www.w3.org/1999/xlink';
        const clone = svg.cloneNode(true);
        // Only the paint channels a node ACTUALLY uses get baked. fill/stroke apply to shapes & text; the gradient
        // /filter color props are restricted to their own element types so we never spray junk attrs everywhere.
        const PAINT_FOR = (tag) => {
          const t = tag.toLowerCase();
          if (t === 'stop') return ['stop-color', 'stroke'];
          if (t === 'feflood' || t === 'fedropshadow') return ['flood-color'];
          if (t === 'fediffuselighting' || t === 'fespecularlighting') return ['lighting-color'];
          // shapes/text/groups: fill + stroke (these inherit and/or honor currentColor)
          return ['fill', 'stroke'];
        };
        const origNodes = [svg, ...svg.querySelectorAll('*')];
        const cloneNodes = [clone, ...clone.querySelectorAll('*')];
        const n = Math.min(origNodes.length, cloneNodes.length);
        for (let i = 0; i < n; i++) {
          const o = origNodes[i], c = cloneNodes[i];
          if (!(o instanceof Element)) continue;
          let ocs; try { ocs = getComputedStyle(o); } catch { ocs = null; }
          if (!ocs) continue;
          const computedColor = ocs.color; // the resolved value `currentColor` references
          for (const prop of PAINT_FOR(o.tagName)) {
            const styleVal = (o.style && o.style.getPropertyValue(prop)) || '';
            const attrVal = o.getAttribute(prop) || '';
            const authored = (styleVal || attrVal).trim().toLowerCase();
            // Resolve ONLY when the painted result rides the cascade: explicit currentColor / inherit, OR no value
            // authored anywhere up this clone's own subtree (a parent's currentColor inherits in). If the author
            // wrote a concrete color or url()/none, leave it — the clone already carries it verbatim.
            const cascade = authored === 'currentcolor' || authored === 'inherit'
              || (authored === '' && !c.closest(`[${prop}]`));
            if (!cascade) continue;
            const computed = (ocs.getPropertyValue(prop) || '').trim();
            if (/^url\(/i.test(computed) || computed === 'none') continue; // gradient/pattern/no-paint → don't touch
            // prefer the prop's own resolved paint; fall back to element color (covers currentColor)
            let resolved = computed && computed !== 'currentcolor' ? computed : computedColor;
            if (!resolved || resolved === 'rgba(0, 0, 0, 0)' || resolved === 'transparent') continue;
            // skip writing a redundant default-black fill (initial fill is already black in any renderer)
            if (authored === '' && prop === 'fill' && /^rgb\(0,\s*0,\s*0\)$/.test(resolved)) continue;
            try { c.setAttribute(prop, resolved); } catch {}
          }
        }
        // ensure namespaces on the ROOT (clone is the svg element itself)
        if (clone.namespaceURI === SVGNS || clone.tagName.toLowerCase() === 'svg') {
          if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', SVGNS);
          // xlink only when referenced (older href syntax) — invalid-but-harmless otherwise, so gate it
          if (/xlink:/i.test(svg.outerHTML) && !clone.getAttribute('xmlns:xlink')) clone.setAttribute('xmlns:xlink', XLINKNS);
        }
        let str = new XMLSerializer().serializeToString(clone);
        if (!/^<\?xml/.test(str)) str = '<?xml version="1.0" encoding="UTF-8"?>\n' + str;
        return str;
      } catch { return svg.outerHTML; }
    };

    // SECTION MAP — full-width band heuristic, same shape as grade-sections.mjs:1057
    { const seenBy = [];
      for (const e of document.querySelectorAll('body *')) {
        const r = e.getBoundingClientRect();
        if (r.width >= vw * 0.82 && r.height >= 120 && r.top + scrollY >= 0) {
          const by = Math.round(r.top + scrollY);
          if (seenBy.some((y) => Math.abs(y - by) <= 60)) continue;
          seenBy.push(by);
          out.sections.push({ x: Math.round(r.left), y: by, w: Math.round(r.width), h: Math.round(r.height), locator: cssPath(e) });
        }
      }
      out.sections.sort((a, b) => a.y - b.y);
    }

    // ASSETS — every rendered img / inline svg / video poster / background-image url in the first O.maxPx px
    { const push = (a) => { if (out.assets.length < O.assetCap * 3) out.assets.push(a); else out.truncated.assets = true; };
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width < 3 || r.height < 3) continue;
        const top = r.top + scrollY;
        if (top > O.maxPx) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const tag = el.tagName;
        if (tag === 'IMG') {
          const url = el.currentSrc || el.src;
          if (url) push({ kind: 'img', url, locator: cssPath(el), box: box(r), natural: { w: el.naturalWidth, h: el.naturalHeight } });
        } else if (tag === 'svg' || tag === 'SVG') {
          if (!el.parentElement || !el.parentElement.closest('svg')) {
            // GAP 2 (reversible: CAPTURE_NO_SVGFIX): serialize a STANDALONE-valid SVG —
            //   (a) re-add xmlns (+ xmlns:xlink when xlink: is used) so the saved .svg loads as an <img>,
            //   (b) resolve currentColor + INHERITED fill/stroke to the element's COMPUTED paint at capture
            //       time so the file isn't invisible black-on-dark. Falls back to raw outerHTML on any error.
            const markup = O.noSvgFix ? el.outerHTML : serializeStandaloneSvg(el);
            if (markup && markup.length <= 300000) push({ kind: 'inline-svg', markup, locator: cssPath(el), box: box(r), natural: null });
          }
        } else if (tag === 'VIDEO') {
          if (el.poster) push({ kind: 'poster', url: el.poster, locator: cssPath(el), box: box(r), natural: null });
        }
        // background-image (element + pseudos): computed values carry ABSOLUTE urls
        for (const pseudo of [null, '::before', '::after']) {
          const bg = getComputedStyle(el, pseudo).backgroundImage;
          if (!bg || bg === 'none') continue;
          for (const m of bg.matchAll(/url\((['"]?)(.*?)\1\)/g)) {
            const url = m[2];
            if (!url) continue;
            if (url.startsWith('data:') && url.length >= 2_000_000) continue; // huge inline data URIs: skip
            push({ kind: 'bg', url, locator: cssPath(el) + (pseudo || ''), box: box(r), natural: null });
          }
        }
      }
    }

    // STYLE FACTS — computed font stack/size/weight/color/bg/radius/shadow per visible element (capped)
    const factEls = [];
    for (const el of document.querySelectorAll('body *')) {
      if (factEls.length >= O.elCap) { out.truncated.styles = true; break; }
      const r = el.getBoundingClientRect();
      if (r.width < 3 || r.height < 3) continue;
      if (r.top + scrollY > O.maxPx) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
      factEls.push({ el, cs, r });
    }
    // matched @media style rules at THIS viewport (the responsive channel). matchMedia results memoised.
    const mrules = [];
    const mmCache = new Map();
    const mm = (cond) => { if (!mmCache.has(cond)) { try { mmCache.set(cond, matchMedia(cond).matches); } catch { mmCache.set(cond, false); } } return mmCache.get(cond); };
    // Walk EVERY grouping construct: @media combines conditions; @layer / @supports / CSS nesting / @import all
    // recurse transparently. (Tailwind v4 wraps its responsive rules in @layer — a media-only walk finds NOTHING
    // on e.g. clerk.com; caught during the clerk gate of this script.)
    const walkRules = (list, cond, depth) => {
      if (depth > 16) return;
      for (const rule of list) {
        if (mrules.length >= O.mediaRuleCap) { out.truncated.mediaRules = true; return; }
        try {
          if (rule.styleSheet) { // @import — recurse into the imported sheet, combining its media list
            const mTxt = rule.media && rule.media.mediaText;
            let rl2; try { rl2 = rule.styleSheet.cssRules; } catch { out.inaccessibleSheets++; continue; }
            if (rl2) walkRules(rl2, mTxt && mTxt !== 'all' ? (cond ? `${cond} and ${mTxt}` : mTxt) : cond, depth + 1);
            continue;
          }
          if (rule.media && rule.cssRules) { // @media
            walkRules(rule.cssRules, cond ? `${cond} and ${rule.conditionText}` : rule.conditionText, depth + 1);
            continue;
          }
          if (rule.selectorText && cond && rule.style && mm(cond)) mrules.push({ cond, sel: rule.selectorText, css: rule.style.cssText });
          if (rule.cssRules && rule.cssRules.length) walkRules(rule.cssRules, cond, depth + 1); // @layer/@supports/@container body, CSS nesting
        } catch {}
      }
    };
    for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets || [])]) {
      let rl; try { rl = sheet.cssRules; } catch { out.inaccessibleSheets++; continue; }
      if (rl) walkRules(rl, '', 0);
    }
    factEls.forEach(({ el, cs, r }, idx) => {
      const facts = {
        locator: cssPath(el), box: box(r),
        fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        color: cs.color, backgroundColor: cs.backgroundColor,
        borderRadius: cs.borderRadius, boxShadow: cs.boxShadow,
        mediaRules: [],
      };
      if (idx < O.ruleElCap) {
        for (const mrule of mrules) {
          if (facts.mediaRules.length >= O.perElRuleCap) break;
          try { if (el.matches(mrule.sel)) facts.mediaRules.push(`@media ${mrule.cond} { ${mrule.sel} { ${mrule.css} } }`); } catch {}
        }
      }
      out.styles.push(facts);
    });

    // ── GAP 3: rendered DOM + a copy-paste section outline (only on the canonical width — O.emitDom) ──────────
    // source.html = the POST-JS, state-pinned DOM so the author copies real text instead of transcribing pixels.
    // outline.txt = section-banded text structure: per band, headings (indented by level) + button/link CTAs +
    // a few representative paragraph lines. Built from the SAME band heuristic as the section map so the outline
    // lines up 1:1 with sections/w<W>-s<i>.png. Best-effort & defensive — never throws out of the evaluate.
    if (O.emitDom) {
      // GAP 4 (reversible: CAPTURE_NO_CSS_INLINE): INLINE all accessible stylesheet CSS so source.html is
      // SELF-CONTAINED and transpilable OFFLINE. The page is loaded ONLINE here (full CSSOM) but transpile-html
      // re-loads source.html from file:// — external <link rel=stylesheet> (e.g. Next.js /_next/static/*.css) then
      // 404s and the projection renders UNSTYLED (hero h1 falls back to ~32px). Serialize every accessible sheet's
      // cssText into one <style> and remove the external links. Cross-origin sheets throw on .cssRules → skipped.
      if (!O.noCssInline) {
        try {
          const blocks = []; let nSheets = 0;
          for (const sheet of Array.from(document.styleSheets)) {
            let rules; try { rules = sheet.cssRules; } catch { continue; } // cross-origin (e.g. fonts CDN) → skip
            if (!rules || !rules.length) continue;
            let css = ''; for (const r of Array.from(rules)) { try { css += r.cssText + '\n'; } catch {} }
            if (css.trim()) { blocks.push(css); nSheets++; }
          }
          if (blocks.length) {
            const styleEl = document.createElement('style');
            styleEl.setAttribute('data-joist-inlined', String(nSheets));
            styleEl.textContent = blocks.join('\n');
            document.head.appendChild(styleEl);
            document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => l.parentNode && l.parentNode.removeChild(l));
            out.cssInlined = nSheets;
          }
        } catch { out.cssInlined = 0; }
      }
      try {
        out.domHtml = '<!doctype html>\n' + document.documentElement.outerHTML;
      } catch { out.domHtml = ''; }
      try {
        const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
        const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
          return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.01; };
        const lines = [];
        lines.push(`# OUTLINE — ${location.href}`);
        lines.push(`# rendered @ ${vw}px · ${out.sections.length} sections · author copy-paste source (text is post-JS)`);
        lines.push('');
        // section bands already computed in out.sections (sorted by y). Bucket headings/CTAs/paras into bands.
        const bands = out.sections.length
          ? out.sections.map((s) => ({ y0: s.y, y1: s.y + s.h, locator: s.locator, items: [] }))
          : [{ y0: 0, y1: Infinity, locator: 'body', items: [] }];
        const seenText = new Set();
        const place = (kind, level, text, y) => {
          if (!text || seenText.has(kind + '|' + text)) return;
          seenText.add(kind + '|' + text);
          // assign to the LAST band whose y0 <= y (bands sorted asc); fall back to band 0
          let bi = 0; for (let k = 0; k < bands.length; k++) { if (y >= bands[k].y0 - 4) bi = k; else break; }
          bands[bi].items.push({ kind, level, text: text.slice(0, 400), y });
        };
        // headings
        for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
          if (!visible(h)) continue; const t = txt(h); if (!t) continue;
          place('h', parseInt(h.tagName[1], 10), t, h.getBoundingClientRect().top + scrollY);
        }
        // CTAs — buttons + button-styled links (short text)
        for (const b of document.querySelectorAll('button,a[role=button],[class*=btn i],[class*=button i],a.cta,input[type=submit]')) {
          if (!visible(b)) continue; const t = txt(b) || b.value || ''; if (!t || t.length > 60) continue;
          place('cta', 0, t, b.getBoundingClientRect().top + scrollY);
        }
        // representative paragraph / lead text — only sizeable standalone text blocks, capped per page
        let paraCount = 0;
        for (const p of document.querySelectorAll('p,li,blockquote,figcaption,[class*=lead i],[class*=subtitle i]')) {
          if (paraCount > 220) break;
          if (!visible(p)) continue;
          // skip containers whose text is just their child headings/buttons (already captured)
          if (p.querySelector('h1,h2,h3,h4,h5,h6,button')) continue;
          const t = txt(p); if (t.length < 12 || t.length > 600) continue;
          place('p', 0, t, p.getBoundingClientRect().top + scrollY);
          paraCount++;
        }
        bands.forEach((band, i) => {
          band.items.sort((a, b) => a.y - b.y);
          if (!band.items.length) return;
          lines.push(`## SECTION ${i}  [y ${Math.round(band.y0)}–${Math.round(band.y1)}]  <${band.locator}>`);
          for (const it of band.items) {
            if (it.kind === 'h') lines.push(`${'  '.repeat(Math.max(0, it.level - 1))}H${it.level}: ${it.text}`);
            else if (it.kind === 'cta') lines.push(`    [CTA] ${it.text}`);
            else lines.push(`    · ${it.text}`);
          }
          lines.push('');
        });
        out.outline = lines.join('\n');
      } catch (e) { out.outline = `# OUTLINE generation degraded: ${String(e && e.message).slice(0, 120)}\n`; }
    }
    return out;
  }, opts);
}

// ── GAP 1: region-raster crop auto-derivation ────────────────────────────────────────────────────────────────
// Classify DOM subtrees into RASTER-WORTHY regions (product-UI screenshots / app mockups, decorative
// illustrations / line-art, photographs) vs native-text the author should rebuild as widgets, and EMIT each
// raster region as a ready-to-wire crop box. GENERAL (no per-site selectors): the signals are media density,
// text-leaf density relative to area, computed-bg contrast against the parent band, and aspect/area thresholds.
// Best-effort by design — every crop carries a `classification` + `confidence` so a consumer can threshold.
// Returns { crops: [{ tag, classification, confidence, box{x,y,w,h}, signals, locator, suggestedWidth }] }.
async function extractCropCandidates(page, opts) {
  return await page.evaluate((O) => {
    const cssPath = (el) => { const seg = []; let n = el, g = 0; while (n && n.nodeType === 1 && n !== document.documentElement && g++ < 12) { let s = n.tagName.toLowerCase(); if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { seg.unshift(`${s}#${n.id}`); break; } const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []; if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(n) + 1})`; seg.unshift(s); n = n.parentElement; } return seg.join('>'); };
    const box = (r) => ({ x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) });
    const vw = window.innerWidth, vh = window.innerHeight;
    const maxPx = O.maxPx, MINAREA = O.minArea, PAGE_AREA = vw * Math.max(vh, 1);
    const visible = (el, r, cs) => r.width > 2 && r.height > 2 && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.02;
    const parseRGB = (s) => { const m = (s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] }; };
    const colorDist = (a, b) => !a || !b ? 999 : Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

    // text-leaf coverage of a subtree: union-ish area of its visible text-bearing leaf elements
    const textArea = (root, rootArea) => {
      let area = 0, leaves = 0;
      const all = root.querySelectorAll('*');
      const cap = Math.min(all.length, 1500);
      for (let i = 0; i < cap; i++) {
        const e = all[i];
        if (e.children.length) continue; // leaf-ish
        const t = (e.textContent || '').trim();
        if (!t) continue;
        const r = e.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        area += r.width * r.height; leaves++;
      }
      // direct text node owned by root itself
      for (const node of root.childNodes) if (node.nodeType === 3 && node.textContent.trim()) { leaves++; area += Math.min(rootArea, 4000); }
      return { frac: Math.min(1, area / Math.max(1, rootArea)), leaves };
    };
    const mediaArea = (root) => {
      let area = 0, n = 0;
      for (const m of root.querySelectorAll('img,picture,video,canvas,svg')) {
        const r = m.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
        area += r.width * r.height; n++;
      }
      return { area, n };
    };
    const bandBgAt = (el) => { // nearest ancestor with a non-transparent bg color → the band the region sits on
      let n = el.parentElement, g = 0;
      while (n && g++ < 20) { const c = parseRGB(getComputedStyle(n).backgroundColor); if (c && c.a > 0.5) return c; n = n.parentElement; }
      return parseRGB(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    };

    const cands = [];
    const seenBoxes = [];
    const overlaps = (b) => seenBoxes.some((s) => {
      const ix = Math.max(0, Math.min(b.x + b.w, s.x + s.w) - Math.max(b.x, s.x));
      const iy = Math.max(0, Math.min(b.y + b.h, s.y + s.h) - Math.max(b.y, s.y));
      const inter = ix * iy, minA = Math.min(b.w * b.h, s.w * s.h);
      return inter / Math.max(1, minA) > 0.7; // mostly-contained by an already-emitted crop → skip (outermost wins)
    });
    const add = (el, r, cls, conf, signals) => {
      const b = box(r);
      if (b.w < 24 || b.h < 24) return;
      if (overlaps(b)) return;
      seenBoxes.push(b);
      cands.push({ tag: el.tagName.toLowerCase(), locator: cssPath(el), classification: cls, confidence: Math.round(conf * 100) / 100, box: b, signals });
    };

    // Walk the document ONCE, document order (outer before inner → outermost coherent region wins the overlap test).
    const els = [...document.querySelectorAll('body *')];
    for (const el of els) {
      if (cands.length >= O.cropCap) break;
      const r = el.getBoundingClientRect();
      const top = r.top + scrollY;
      if (top > maxPx) continue;
      const cs = getComputedStyle(el);
      if (!visible(el, r, cs)) continue;
      const area = r.width * r.height;
      if (area < MINAREA) continue;
      const tag = el.tagName;

      // (1) DIRECT MEDIA leaf — img/picture/video/canvas → photograph or product screenshot
      if (tag === 'IMG' || tag === 'PICTURE' || tag === 'VIDEO' || tag === 'CANVAS') {
        const ar = r.width / Math.max(1, r.height);
        // UI-screenshot vs photo: hard to know without pixels — emit as 'media' with aspect as a hint
        const cls = (ar > 1.15 && ar < 2.4 && area > PAGE_AREA * 0.06) ? 'ui-screenshot' : 'media';
        add(el, r, cls, 0.9, { kind: 'direct-media', aspect: +ar.toFixed(2), areaFrac: +(area / PAGE_AREA).toFixed(3) });
        continue;
      }
      // (2) INLINE SVG — decorative illustration / line-art (skip tiny icons; require real complexity)
      if (tag === 'svg' || tag === 'SVG') {
        if (el.parentElement && el.parentElement.closest('svg')) continue; // nested → handled by root
        const paths = el.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line').length;
        const big = r.width >= 80 && r.height >= 80 && area > MINAREA * 1.5;
        if (big && paths >= 4) add(el, r, 'illustration', paths >= 12 ? 0.8 : 0.6, { kind: 'inline-svg', paths, areaFrac: +(area / PAGE_AREA).toFixed(3) });
        continue;
      }
      // (3) BACKGROUND-IMAGE region — a real raster/svg bg (not a gradient) painted on a sizeable box
      const bg = cs.backgroundImage;
      if (bg && bg !== 'none' && /url\(/.test(bg) && !/gradient/i.test(bg) && area > PAGE_AREA * 0.04) {
        const txt = textArea(el, area);
        if (txt.frac < 0.25) { add(el, r, 'bg-image', 0.75, { kind: 'bg-image', textFrac: +txt.frac.toFixed(2), areaFrac: +(area / PAGE_AREA).toFixed(3) }); continue; }
      }
      // (4) COMPOSITE UI BLOCK — a panel/card that READS as a screenshot/mockup: its computed bg contrasts with
      //     the band behind it, it holds some media or chrome, and text is a MINORITY of its area. This is the
      //     class that covers Linear's hero app-UI + feature mocks and clerk's bento/auth cards.
      const selfBg = parseRGB(cs.backgroundColor);
      const band = bandBgAt(el);
      const bgContrast = selfBg && selfBg.a > 0.5 ? colorDist(selfBg, band) : 0;
      const media = mediaArea(el);
      const txt = textArea(el, area);
      const mediaFrac = media.area / Math.max(1, area);
      const aspect = r.width / Math.max(1, r.height);
      // gating: sizeable, not a giant full-band wrapper, low-ish text, has SOME visual substance (media or
      // contrasting panel + rounded/shadowed chrome), aspect not a thin strip
      const rounded = parseFloat(cs.borderRadius) >= 6;
      const shadowed = cs.boxShadow && cs.boxShadow !== 'none';
      const bordered = parseFloat(cs.borderTopWidth) >= 1 && parseRGB(cs.borderTopColor)?.a > 0.2;
      const chrome = rounded || shadowed || bordered;
      // a real mockup/card/panel is INSET — it does not span the full viewport width. Full-width boxes are band
      // wrappers (their raster content is a CHILD that gets its own candidacy), so exclude them from composites.
      const notFullBand = r.width <= vw * 0.94;
      const substance = mediaFrac > 0.12 || (bgContrast > 24 && chrome);
      const lowText = txt.frac < 0.45 && txt.leaves <= 60;
      const goodAspect = aspect > 0.25 && aspect < 6;
      // LAYOUT-CONTAINER guard: a grid/flex row of ≥2 sizeable children is a LAYOUT, not one mockup — skip it so
      // each child is evaluated/emitted on its own (Linear's 5 feature mocks, clerk's bento cells). Without this
      // the whole row collapses into a single unwirable crop.
      const disp = cs.display;
      const isFlexGrid = disp === 'flex' || disp === 'grid' || disp === 'inline-flex' || disp === 'inline-grid';
      // A layout ROW (descend to children) only if ≥2 children are each SUBSTANTIVE on their own — they carry
      // media, OR they are contrasting panels with chrome (rounded/shadow/border). The hero app-UI's children
      // (bare side/main divs, no media, no chrome) do NOT qualify, so the app-UI is emitted as ONE mockup; a row
      // of feature cards DOES qualify, so each card emits separately.
      let substantiveKids = 0;
      if (isFlexGrid) for (const k of el.children) {
        const kr = k.getBoundingClientRect(); if (kr.width * kr.height < MINAREA) continue;
        const kcs = getComputedStyle(k);
        const kMedia = k.querySelector('img,picture,video,canvas,svg') && mediaArea(k).area > kr.width * kr.height * 0.05;
        const kPanel = (colorDist(parseRGB(kcs.backgroundColor), band) > 24) && (parseFloat(kcs.borderRadius) >= 6 || (kcs.boxShadow && kcs.boxShadow !== 'none'));
        if (kMedia || kPanel) substantiveKids++;
      }
      const isLayoutRow = isFlexGrid && substantiveKids >= 2;
      if (!isLayoutRow && area > PAGE_AREA * 0.05 && area < PAGE_AREA * 0.9 && notFullBand && substance && lowText && goodAspect) {
        // confidence blends the signals (more media / more contrast / less text → higher)
        let conf = 0.4 + Math.min(0.3, mediaFrac) + Math.min(0.2, bgContrast / 255) + (chrome ? 0.1 : 0) - Math.min(0.25, txt.frac);
        conf = Math.max(0.3, Math.min(0.9, conf));
        const cls = media.n > 0 ? 'ui-mock' : (bgContrast > 24 && chrome ? 'ui-panel' : 'decorative');
        add(el, r, cls, conf, { kind: 'composite', mediaFrac: +mediaFrac.toFixed(2), textFrac: +txt.frac.toFixed(2), textLeaves: txt.leaves, bgContrast, chrome, aspect: +aspect.toFixed(2), areaFrac: +(area / PAGE_AREA).toFixed(3) });
      }
    }
    cands.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    return { crops: cands, pageArea: PAGE_AREA };
  }, opts);
}

// ── asset download (once, union across widths). Browser-context request = browser UA + cookies. ──────────────
const EXT_BY_TYPE = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'image/svg+xml': '.svg', 'image/x-icon': '.ico', 'video/mp4': '.mp4' };
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const safeBase = (u) => { try { const b = path.basename(new URL(u).pathname) || 'asset'; return b.replace(/[^\w.-]/g, '_').slice(0, 60); } catch { return 'asset'; } };

async function downloadAssets(browser, entries) {
  const ctx = await browser.newContext();
  const results = new Map(); // key -> { file, bytes, contentType, error? }
  for (const [key, entry] of entries) {
    try {
      if (entry.kind === 'inline-svg') {
        const file = `assets/inline-${sha(entry.markup)}.svg`;
        fs.writeFileSync(path.join(OUT, file), entry.markup);
        results.set(key, { file, bytes: Buffer.byteLength(entry.markup), contentType: 'image/svg+xml' });
      } else if (entry.url.startsWith('data:')) {
        const m = entry.url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
        if (!m) { results.set(key, { error: 'unparseable-data-uri' }); continue; }
        const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
        const ext = EXT_BY_TYPE[m[1]] || '.bin';
        const file = `assets/data-${sha(entry.url)}${ext}`;
        fs.writeFileSync(path.join(OUT, file), buf);
        results.set(key, { file, bytes: buf.length, contentType: m[1] || null });
      } else if (entry.url.startsWith('file://')) {
        // local fixtures (determinism gate) — playwright's request context can't fetch file://
        const buf = fs.readFileSync(new URL(entry.url));
        const ext = path.extname(safeBase(entry.url)) || '.bin';
        const file = `assets/${sha(entry.url)}-${safeBase(entry.url).replace(/\.[^.]*$/, '')}${ext}`;
        fs.writeFileSync(path.join(OUT, file), buf);
        results.set(key, { file, bytes: buf.length, contentType: null });
      } else {
        const resp = await ctx.request.get(entry.url, { timeout: 30000, maxRedirects: 5 }).catch(() => null);
        if (!resp || !resp.ok()) { results.set(key, { error: `http-${resp ? resp.status() : 'fail'}` }); continue; }
        const buf = await resp.body();
        if (buf.length > 25_000_000) { results.set(key, { error: 'too-large' }); continue; }
        const ct = (resp.headers()['content-type'] || '').split(';')[0].trim();
        const ext = EXT_BY_TYPE[ct] || (path.extname(safeBase(entry.url)) || '.bin');
        const file = `assets/${sha(entry.url)}-${safeBase(entry.url).replace(/\.[^.]*$/, '')}${ext}`;
        fs.writeFileSync(path.join(OUT, file), buf);
        results.set(key, { file, bytes: buf.length, contentType: ct || null });
      }
    } catch (e) { results.set(key, { error: String(e.message || e).slice(0, 120) }); }
  }
  await ctx.close();
  return results;
}

// ── per-section crops out of the full-page shot ───────────────────────────────────────────────────────────────
function cropPng(src, x, y, w, h) {
  const out = new PNG({ width: w, height: h });
  for (let row = 0; row < h; row++) {
    const srcStart = ((y + row) * src.width + x) * 4;
    src.data.copy(out.data, row * w * 4, srcStart, srcStart + w * 4);
  }
  return out;
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });
const perWidth = {};
const assetEntries = new Map();     // dedupe key -> first-seen entry (url or markup)
const assetOccurrences = new Map(); // dedupe key -> [{ width, locator, box, natural }]
const styleByLocator = {};          // locator -> { perWidth: { [w]: facts } }
let domWritten = false;             // GAP 3 — width at which source.html/outline.txt were written (false until)
let cropManifest = null;            // GAP 1 — crops-manifest payload (written after the loop)
const cropAcc = new Map();          // GAP 1 — locator -> { id, classification, confidence, perWidth box, files }

for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try {
    await page.goto(SOURCE, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const overlays1 = await dismissOverlays(page);   // early: unlock scroll BEFORE settleLazy needs it
    await settleLazy(page);
    const overlays2 = await dismissOverlays(page);   // late banners (consent managers that mount post-load)
    const freeze = await freezeAnimations(page);
    const dedupe = await dedupeStackedText(page);
    await page.waitForTimeout(250);

    const shotBuf = await page.screenshot({ fullPage: true, timeout: 120000 });
    const shotRel = `shots/w${w}.png`;
    fs.writeFileSync(path.join(OUT, shotRel), shotBuf);

    const wantDom = !NO_DOM && !domWritten;   // GAP 3 — extract rendered DOM + outline on the FIRST good width
    const facts = await extractFacts(page, { maxPx: MAX_PX, elCap: EL_CAP, ruleElCap: RULE_EL_CAP, perElRuleCap: PER_EL_RULE_CAP, mediaRuleCap: MEDIA_RULE_CAP, assetCap: ASSET_CAP, noSvgFix: NO_SVGFIX, emitCrops: !NO_CROPS, cropCap: CROP_CAP, emitDom: wantDom, noCssInline: NO_CSS_INLINE });

    // GAP 3: persist source.html + outline.txt from the first width that yielded them. Written here (not at the
    // end) so a later-width crash can't lose them — the prior "missing for linear, present for clerk" failure.
    if (wantDom && (facts.domHtml || facts.outline)) {
      try {
        if (facts.domHtml) fs.writeFileSync(path.join(OUT, 'source.html'), facts.domHtml);
        fs.writeFileSync(path.join(OUT, 'outline.txt'), facts.outline || `# OUTLINE — ${SOURCE}\n# (no section text extracted)\n`);
        domWritten = w;
        console.log(`[w${w}] wrote source.html (${(facts.domHtml || '').length} chars) + outline.txt (${(facts.outline || '').split('\n').length} lines)`);
      } catch (e) { console.error(`[w${w}] DOM/outline write failed: ${String(e.message).slice(0, 120)}`); }
    }
    delete facts.domHtml; delete facts.outline; // keep them out of the per-width manifest blob

    // fold assets into the cross-width dedupe maps
    for (const a of facts.assets) {
      const key = a.kind === 'inline-svg' ? `svg:${sha(a.markup)}` : `url:${a.url}`;
      if (!assetEntries.has(key)) {
        if (assetEntries.size >= ASSET_CAP) continue;
        assetEntries.set(key, a.kind === 'inline-svg' ? { kind: a.kind, markup: a.markup } : { kind: a.kind, url: a.url });
      }
      if (!assetOccurrences.has(key)) assetOccurrences.set(key, []);
      const occ = assetOccurrences.get(key);
      if (occ.length < 40) occ.push({ width: w, locator: a.locator, box: a.box, ...(a.natural ? { natural: a.natural } : {}) });
    }
    // fold style facts into the cross-width locator map
    for (const s of facts.styles) {
      if (!styleByLocator[s.locator]) styleByLocator[s.locator] = { perWidth: {} };
      const { locator, ...rest } = s;
      styleByLocator[s.locator].perWidth[w] = rest;
    }
    // section crops
    const png = PNG.sync.read(shotBuf);
    const sections = facts.sections.map((sec, i) => {
      const cx = Math.max(0, Math.min(sec.x, png.width - 1));
      const cw = Math.max(1, Math.min(sec.w, png.width - cx));
      const cy = Math.max(0, Math.min(sec.y, png.height - 1));
      const ch = Math.max(1, Math.min(sec.h, SECTION_CROP_MAX_H, png.height - cy));
      const rel = `sections/w${w}-s${i}.png`;
      fs.writeFileSync(path.join(OUT, rel), PNG.sync.write(cropPng(png, cx, cy, cw, ch)));
      return { ...sec, crop: rel, cropClamped: ch < sec.h };
    });

    // GAP 1: region-raster crops — classify raster-worthy subtrees and crop each from THIS width's shot. Keyed
    // by locator so a region's box is tracked across widths (crops-manifest.perWidth). Emitted per width so the
    // author wires a width-correct image. The crop PNG is the literal pixels of the region (ready to upload).
    let cropCount = 0;
    if (!NO_CROPS) {
      try {
        const cc = await extractCropCandidates(page, { maxPx: MAX_PX, cropCap: CROP_CAP, minArea: 80 * 80 });
        for (const cand of cc.crops) {
          const b = cand.box;
          const cx = Math.max(0, Math.min(b.x, png.width - 1));
          const cw = Math.max(1, Math.min(b.w, png.width - cx));
          const cy = Math.max(0, Math.min(b.y, png.height - 1));
          const ch = Math.max(1, Math.min(b.h, SECTION_CROP_MAX_H, png.height - cy));
          if (cw < 16 || ch < 16) continue;
          const id = `c${sha(cand.locator)}`;
          const rel = `crops/${id}-w${w}.png`;
          fs.writeFileSync(path.join(OUT, rel), PNG.sync.write(cropPng(png, cx, cy, cw, ch)));
          if (!cropAcc.has(cand.locator)) {
            cropAcc.set(cand.locator, { id, locator: cand.locator, tag: cand.tag, classification: cand.classification, confidence: cand.confidence, signals: cand.signals, perWidth: {}, files: {} });
          }
          const rec = cropAcc.get(cand.locator);
          rec.perWidth[w] = { x: cx, y: cy, w: cw, h: ch, clamped: ch < b.h };
          rec.files[w] = rel;
          // keep the highest-confidence classification seen across widths
          if (cand.confidence > rec.confidence) { rec.confidence = cand.confidence; rec.classification = cand.classification; rec.signals = cand.signals; }
          cropCount++;
        }
      } catch (e) { console.error(`[w${w}] crop extraction failed: ${String(e.message).slice(0, 120)}`); }
    }

    perWidth[w] = {
      shot: shotRel, pageH: facts.pageH, sections,
      state: { overlays: [...overlays1, ...overlays2], freeze, dedupedText: dedupe },
      stats: { styleElements: facts.styles.length, inaccessibleSheets: facts.inaccessibleSheets, truncated: facts.truncated, crops: cropCount },
    };
    console.log(`[w${w}] shot ${png.width}x${png.height}, ${sections.length} sections, ${facts.styles.length} style els, ${facts.assets.length} asset refs, ${cropCount} crops, overlays ${overlays1.length + overlays2.length}, frozen ${freeze.finished + freeze.pausedInfinite} anims, deduped ${dedupe.length} text pairs`);
  } catch (e) {
    perWidth[w] = { error: String(e.message || e).slice(0, 300) };
    console.error(`[w${w}] FAILED: ${perWidth[w].error}`);
  } finally {
    await ctx.close().catch(() => {});
  }
}

// downloads (union across widths, deterministic order by key)
const orderedEntries = [...assetEntries.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
const downloads = await downloadAssets(browser, orderedEntries);
await browser.close();

// GAP 3 safety net: if EVERY width failed before the DOM step, still leave non-empty source.html + outline.txt
// (consumers/validators must never find them missing). Built from whatever section data the manifest holds.
if (!NO_DOM && domWritten === false) {
  const anyW = WIDTHS.find((w) => perWidth[w] && perWidth[w].sections);
  const secs = anyW ? perWidth[anyW].sections : [];
  const stub = [`# OUTLINE — ${SOURCE}`, `# DEGRADED: rendered-DOM extraction did not run on any width (capture errors).`,
    `# ${secs.length} section bands detected; section crops exist under sections/.`, '',
    ...secs.map((s, i) => `## SECTION ${i}  [y ${s.y}–${s.y + s.h}]  <${s.locator}>`)].join('\n') + '\n';
  try { fs.writeFileSync(path.join(OUT, 'outline.txt'), stub); } catch {}
  try { fs.writeFileSync(path.join(OUT, 'source.html'),
    `<!doctype html><!-- DEGRADED: source DOM not captured (all widths errored); see manifest.perWidth[*].error -->\n<html><head><title>${SOURCE}</title></head><body></body></html>\n`); } catch {}
  console.error('GAP3 fallback: wrote DEGRADED source.html + outline.txt (no width yielded a rendered DOM)');
}

// media-query diffs between adjacent widths — the responsive channel consumers care about
for (const rec of Object.values(styleByLocator)) {
  const ws = WIDTHS.filter((w) => rec.perWidth[w]);
  for (let i = 0; i + 1 < ws.length; i++) {
    const A = new Set(rec.perWidth[ws[i]].mediaRules || []), B = new Set(rec.perWidth[ws[i + 1]].mediaRules || []);
    const onlyA = [...A].filter((r) => !B.has(r)), onlyB = [...B].filter((r) => !A.has(r));
    if (onlyA.length || onlyB.length) {
      rec.mediaDiffs = rec.mediaDiffs || {};
      rec.mediaDiffs[`${ws[i]}->${ws[i + 1]}`] = { [`onlyAt${ws[i]}`]: onlyA, [`onlyAt${ws[i + 1]}`]: onlyB };
    }
  }
}

const assets = orderedEntries.map(([key, entry]) => {
  const dl = downloads.get(key) || { error: 'not-attempted' };
  return {
    kind: entry.kind,
    ...(entry.url ? { url: entry.url } : {}),
    ...(dl.file ? { file: dl.file, bytes: dl.bytes, contentType: dl.contentType } : { error: dl.error }),
    occurrences: assetOccurrences.get(key) || [],
  };
});

// GAP 1: write crops-manifest.json — one entry per raster region, with per-width boxes + crop files + a
// suggestedWidth (the widest captured box, what you'd upload). Deterministic order: by y then x at the widest
// width. Author wires each `ui-screenshot`/`ui-mock`/`bg-image`/`media` crop as an image widget; `illustration`/
// `decorative` as decorative imagery; consumers may threshold on `confidence`.
if (!NO_CROPS) {
  const widest = WIDTHS.slice().sort((a, b) => b - a);
  const crops = [...cropAcc.values()].map((rec) => {
    const wAtWidest = widest.find((w) => rec.perWidth[w]) || WIDTHS[0];
    const b = rec.perWidth[wAtWidest] || { w: 0 };
    return {
      id: rec.id, classification: rec.classification, confidence: rec.confidence,
      tag: rec.tag, locator: rec.locator, signals: rec.signals,
      suggestedWidth: b.w, primaryWidth: wAtWidest,
      filename: rec.files[wAtWidest] || Object.values(rec.files)[0] || null,
      perWidth: rec.perWidth, files: rec.files,
    };
  }).sort((a, b) => {
    const wa = a.perWidth[a.primaryWidth] || { y: 0, x: 0 }, wb = b.perWidth[b.primaryWidth] || { y: 0, x: 0 };
    return (wa.y - wb.y) || (wa.x - wb.x);
  });
  const byClass = {};
  for (const c of crops) byClass[c.classification] = (byClass[c.classification] || 0) + 1;
  cropManifest = { source: SOURCE, widths: WIDTHS, count: crops.length, byClassification: byClass, crops };
  fs.writeFileSync(path.join(OUT, 'crops-manifest.json'), JSON.stringify(cropManifest, null, 1));
}

const manifest = {
  source: SOURCE, widths: WIDTHS, maxPx: MAX_PX,
  perWidth, assets,
  styleFacts: 'style-facts.json',
  // GAP 3 — always present (real or degraded stub); domWidth = width the rendered DOM came from (false if stub)
  sourceHtml: NO_DOM ? null : 'source.html',
  outline: NO_DOM ? null : 'outline.txt',
  domWidth: domWritten,
  // GAP 1 — region-raster crops (null when CAPTURE_NO_CROPS=1)
  crops: NO_CROPS ? null : 'crops-manifest.json',
  stats: {
    assetsTotal: assets.length,
    assetsDownloaded: assets.filter((a) => a.file).length,
    assetsFailed: assets.filter((a) => a.error).length,
    styleLocators: Object.keys(styleByLocator).length,
    crops: cropManifest ? cropManifest.crops.length : 0,
  },
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
fs.writeFileSync(path.join(OUT, 'style-facts.json'), JSON.stringify(styleByLocator, null, 1));
console.log(`DONE → ${path.join(OUT, 'manifest.json')} (${manifest.stats.assetsDownloaded}/${manifest.stats.assetsTotal} assets, ${manifest.stats.styleLocators} style locators)`);
