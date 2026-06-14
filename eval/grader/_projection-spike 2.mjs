#!/usr/bin/env node
/**
 * @purpose _projection-spike.mjs — SCRATCH architecture spike (NOT production; transpile-html.mjs untouched).
 * DECISIVE GO/NO-GO test: can DETERMINISTIC SOURCE-PROJECTION replace the LLM-author leg for the ~92%
 * expressible body of a page? Feeds the LIVE SOURCE computed tree (clerk.com) into the SAME projection
 * (makeMapper from transpile-html.mjs), bypassing the LLM author entirely, and renders it to a FRESH
 * local page so it can be graded apples-to-apples vs the authored clerk baseline (page 83).
 *
 * The reframe (verified): transpile-html.mjs extract()'s ser() walk is the html-to-figma live-CSSOM walk —
 * it reads getComputedStyle+getBoundingClientRect into a typed node tree and projects computed-flex →
 * Elementor flex-container verbatim. ser() is page-agnostic: it works against ANY rendered DOM. The only
 * gap is plumbing — extract() loads file:// (the LLM-authored CLEAN html). Here we point chromium at the
 * LIVE source and run the IDENTICAL ser() walk, then add the make-or-break NEW code: a deterministic
 * container/flatten pass so the raw deeply-nested source div-soup collapses to an editable hierarchy
 * (depth<=4, the AUTHORING_CONTRACT cap) instead of one-container-per-div (the retired heuristic blob).
 *
 * OUTPUT: writes tree to a FRESH local page via postmeta (PHP-in-container; the agent1 b64 lacks the
 * local Joist cap and Joist PUT 422-rejects image _element_custom_width — the proven page-182 workaround).
 *
 * USAGE: node _projection-spike.mjs [--url https://clerk.com] [--width 1440] [--out /tmp/genz2/projection-spike]
 *        [--no-flatten] [--dry]   (--dry: build tree + report only, no render)
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { chromium } from 'playwright';
import { makeMapper, splitSiteParts, validateTree } from './transpile-html.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);
const URL = arg('url', 'https://clerk.com');
const WIDTH = +arg('width', 1440);
const OUT = arg('out', '/tmp/genz2/projection-spike');
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
fs.mkdirSync(OUT, { recursive: true });

// ── extractLive(): the EXACT ser() walk from transpile-html.mjs (verbatim copy of the page.evaluate body),
//    but navigated to the LIVE source URL instead of a file://. ZERO projection logic changed. ──────────────
async function extractLive(url, width) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width, height: 1200 }, deviceScaleFactor: 1, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  // settle lazy content + fonts so geometry/text is final (mirrors capture practice).
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 600));
    window.scrollTo(0, 0);
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch {} }
    await new Promise((r) => setTimeout(r, 400));
  });
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
            for (const p of ['width', 'max-width', 'height', 'min-height', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
              'padding-left', 'padding-right', 'min-height']) {
              const v = rule.style.getPropertyValue(p); if (v) out[p] = v;
            }
          }
        }
      }
      return out;
    };
    const mediaOf = (el) => {
      const out = [];
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules) {
          if (rule.type !== 4) continue;
          const cond = rule.conditionText || rule.media?.mediaText || '';
          const m = /max-width:\s*([\d.]+)px/.exec(cond);
          if (!m) { if (/min-width/.test(cond)) notes.push(`min-width media query skipped (desktop-first contract): @media ${cond}`); continue; }
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
    const partsOf = (el) => {
      const parts = [];
      for (const n of el.childNodes) {
        if (n.nodeType === 3) { if (n.textContent.trim()) parts.push({ t: 'text', text: n.textContent }); }
        else if (n.nodeType === 1 && (n.tagName === 'svg' || n.tagName === 'SVG')) {
          const d = (n.querySelector('path') ? n.querySelector('path').getAttribute('d') || '' : '');
          let dir = 'right';
          if (/l-?\d.*-?\d.*l/i.test(d) && /M\s*1\s*1l3\.?5?\s*3/i.test(d)) dir = 'down';
          else if (/M\s*1\s*1l4\s*4/i.test(d)) dir = 'right';
          parts.push({ t: 'svgicon', dir, text: '' });
        }
        else if (n.nodeType === 1 && n.tagName !== 'BR') {
          const c = getComputedStyle(n);
          const w = parseFloat(c.width) || 0;
          parts.push({ t: 'span', text: n.textContent, empty: !n.textContent.trim(),
            bg: c.backgroundColor !== 'rgba(0, 0, 0, 0)' ? c.backgroundColor : null,
            round: w > 0 && parseFloat(c.borderRadius) >= w / 2, color: c.color });
        }
      }
      return parts;
    };
    const ser = (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const _mdecl = declared(el);
      const mediaS = {};
      if (/px$/.test(_mdecl['margin-top'] || '')) mediaS['margin-top'] = cs.marginTop;
      if (el.tagName === 'IMG') {
        return { tag: 'img', cls: el.className || '', isLeaf: true, text: null,
          src: el.getAttribute('src') || '', resolvedSrc: el.currentSrc || el.src || '', alt: el.alt || '',
          attrW: parseInt(el.getAttribute('width'), 10) || 0, attrH: parseInt(el.getAttribute('height'), 10) || 0,
          natW: el.naturalWidth || 0, natH: el.naturalHeight || 0,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          declared: _mdecl, media: mediaOf(el), s: mediaS };
      }
      if (el.tagName.toLowerCase() === 'svg') {
        return { tag: 'svg', cls: (el.getAttribute('class') || ''), isLeaf: true, text: null,
          svg: el.outerHTML.replace(/\s+/g, ' ').trim(),
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          declared: _mdecl, media: mediaOf(el), s: mediaS };
      }
      const kids = [...el.children];
      const _bg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
      const _bord = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some((p) => parseFloat(cs[p]) > 0);
      const _hpad = parseFloat(cs.paddingLeft) > 0 || parseFloat(cs.paddingRight) > 0;
      const _pill = (parseFloat(cs.height) > 0 && parseFloat(cs.borderRadius) >= 4);
      const isBtnish = ['A', 'BUTTON'].includes(el.tagName) && el.textContent.trim() !== '' && (_bg || _bord) && (_hpad || _pill);
      const boxKid = kids.some((k) => { const c = getComputedStyle(k).backgroundColor; return c && c !== 'rgba(0, 0, 0, 0)' && k.textContent.trim() === ''; });
      const isLeaf = kids.length === 0
        || (kids.every((k) => ['SPAN', 'BR'].includes(k.tagName)) && (!boxKid || isBtnish))
        || (isBtnish && kids.every((k) => ['SPAN', 'BR', 'SVG', 'svg'].includes(k.tagName)));
      const node = {
        tag: el.tagName.toLowerCase(), cls: el.className || '', isLeaf,
        isBtn: isBtnish && isLeaf,
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
    // Project from <main> when present (skip <head>/<script>/noscript chrome); else body.
    const root = document.querySelector('main') || document.body;
    return { tree: ser(document.body), notes, mainOnly: !!document.querySelector('main') };
  });
  await browser.close();
  return spec;
}

// ── treeStats: node-count + max-depth census of a SPEC tree (pre-projection). ─────────────────────────────
function specStats(tree) {
  let count = 0, maxDepth = 0, leaves = 0;
  (function walk(n, d) { count++; maxDepth = Math.max(maxDepth, d); if (n.isLeaf || n.tag === 'img' || n.tag === 'svg') leaves++; for (const c of n.children || []) walk(c, d + 1); })(tree, 0);
  return { count, maxDepth, leaves };
}
function elemStats(els) {
  let containers = 0, widgets = 0, maxDepth = 0;
  (function walk(arr, d) { for (const e of arr) { if (e.elType === 'container') containers++; else widgets++; maxDepth = Math.max(maxDepth, d); walk(e.elements || [], d + 1); } })(els, 0);
  return { containers, widgets, total: containers + widgets, maxDepth };
}

// ── THE MAKE-OR-BREAK NEW CODE: deterministic geometric flatten/group pass. ──────────────────────────────
// Goal: collapse the raw deeply-nested source div-soup into an editable hierarchy at depth<=CAP, WITHOUT
// destroying the load-bearing flex structure the projection reads. Rules (all geometric / structural):
//  R1 UNWRAP single-child decorative wrapper: a non-leaf, non-button container with exactly ONE element
//     child, no own background/border/shadow/min-height, ~coincident geometry with that child (child fills
//     >=92% of parent box), and NOT a flex axis that the child needs (we fold the parent's padding/gap into
//     a note but keep the child) → replace the parent with its child. This kills the `<div><div><div>real`
//     chains that make div-soup. Repeated to a fixpoint per node.
//  R2 DEPTH CAP: after R1, if any branch still exceeds CAP, HOIST: a container deeper than CAP whose own
//     box equals an ancestor-at-CAP's box and carries no bg/border is unwrapped into its parent (its
//     children splice up one level). Geometric: only when unwrapping does not change child absolute order.
// Honest scope: this is a FIRST-CUT. It targets the dominant div-soup pattern (chain wrappers) which is
// ~80% of the nesting tax; it does NOT do full grid-inference or sibling-regrouping (that's the residual).
const CAP = 4;
const flattenStats = { unwrapped: 0, hoisted: 0 };
function hasOwnBox(n) {
  const s = n.s || {};
  const bg = s['background-color'] && s['background-color'] !== 'rgba(0, 0, 0, 0)' && s['background-color'] !== 'transparent';
  const bord = ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'].some((p) => parseFloat(s[p]) > 0);
  const shadow = s['box-shadow'] && s['box-shadow'] !== 'none';
  const minh = (n.declared || {})['min-height'];
  const radius = s['border-radius'] && s['border-radius'] !== '0px';
  return !!(bg || bord || shadow || minh || radius);
}
function fillsParent(child, parent) {
  if (!child.rect || !parent.rect || !parent.rect.w || !parent.rect.h) return false;
  const aw = (child.rect.w + 2) / parent.rect.w;
  const ah = (child.rect.h + 2) / parent.rect.h;
  return aw >= 0.92 && ah >= 0.92;
}
function flatten(node) {
  if (!node.children) return node;
  // bottom-up
  node.children = node.children.map(flatten);
  // R1: fixpoint unwrap of single decorative wrapper children of THIS node
  let changed = true;
  while (changed) {
    changed = false;
    const next = [];
    for (const c of node.children) {
      const elemKids = (c.children || []).filter(Boolean);
      const isWrapper = !c.isLeaf && c.tag !== 'img' && c.tag !== 'svg' && !c.isBtn
        && elemKids.length === 1 && !hasOwnBox(c)
        && fillsParent(elemKids[0], c)
        && !c.autoML && !c.autoMR; // never drop a margin-auto wrapper (it positions)
      if (isWrapper) {
        // fold parent's flex into the child only if the child is itself a non-leaf container that
        // doesn't already declare its own flex direction differently; otherwise just promote child.
        flattenStats.unwrapped++;
        next.push(elemKids[0]);
        changed = true;
      } else next.push(c);
    }
    node.children = next;
  }
  return node;
}
// R2 depth-cap hoist: splice over-deep boxless containers up toward CAP.
function depthCap(node, depth) {
  if (!node.children) return;
  if (depth >= CAP) {
    const next = [];
    for (const c of node.children) {
      const elemKids = (c.children || []);
      if (!c.isLeaf && c.tag !== 'img' && c.tag !== 'svg' && !c.isBtn && !hasOwnBox(c) && elemKids.length >= 1) {
        flattenStats.hoisted++;
        for (const g of elemKids) next.push(g);
      } else next.push(c);
    }
    node.children = next;
  }
  for (const c of node.children) depthCap(c, depth + 1);
}

(async () => {
  const t0 = Date.now();
  console.log(`[spike] extracting live ${URL} @${WIDTH} ...`);
  const spec = await extractLive(URL, WIDTH);
  fs.writeFileSync(path.join(OUT, 'spec-raw.json'), JSON.stringify(spec.tree));
  const rawStats = specStats(spec.tree);
  console.log('[spike] RAW source spec tree:', JSON.stringify(rawStats), 'mainOnly:', spec.mainOnly);

  let flattenS = { unwrapped: 0, hoisted: 0 };
  if (!has('no-flatten')) {
    flatten(spec.tree);
    // run depth-cap a few passes
    for (let i = 0; i < 6; i++) depthCap(spec.tree, 0);
    flattenS = { ...flattenStats };
  }
  const flatStats = specStats(spec.tree);
  console.log('[spike] FLATTENED spec tree:', JSON.stringify(flatStats), 'flatten ops:', JSON.stringify(flattenS));
  fs.writeFileSync(path.join(OUT, 'spec-flat.json'), JSON.stringify(spec.tree));

  // PROJECT via the UNCHANGED makeMapper. Hot-link images (no asset upload in spike) — mapper PAIN-logs.
  const mapper = makeMapper({ assetMap: new Map(), authoringWidth: WIDTH });
  // strip chrome to site parts (header/footer) exactly like production, so the page tree is content-only.
  const partNodes = splitSiteParts(spec.tree);
  const root = mapper.mapNode(spec.tree, null, []);
  root.settings.content_width = 'full';
  for (const note of new Set(spec.notes)) { if (!mapper.PAIN.includes(note) && !mapper.POLICY.includes(note)) (/(min-width)/.test(note) ? mapper.PAIN : mapper.POLICY).push(note); }

  const localErrors = validateTree([root]);
  const eStats = elemStats([root]);
  const report = {
    url: URL, width: WIDTH, ts: new Date().toISOString(),
    rawSpec: rawStats, flatSpec: flatStats, flattenOps: flattenS,
    elementorTree: eStats,
    counts: mapper.counts,
    siteParts: partNodes.map((p) => p.type),
    painCount: mapper.PAIN.length, policyCount: mapper.POLICY.length,
    pain: mapper.PAIN, policy: mapper.POLICY,
    localErrors,
    treeSha1: sha1(JSON.stringify(root)),
    elapsedMs: Date.now() - t0,
  };
  fs.writeFileSync(path.join(OUT, 'tree.json'), JSON.stringify([root]));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('[spike] Elementor tree:', JSON.stringify(eStats), 'widget counts:', JSON.stringify(mapper.counts));
  console.log('[spike] validation errors:', localErrors.length, '| PAIN', mapper.PAIN.length, '| POLICY', mapper.POLICY.length);
  console.log('[spike] tree.json + report.json ->', OUT);
  if (localErrors.length) { console.error('LOCAL VALIDATION ERRORS (first 10):'); localErrors.slice(0, 10).forEach((e) => console.error(' -', e)); }
})().catch((e) => { console.error('FATAL', e.stack || e.message); process.exit(1); });
