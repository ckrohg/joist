#!/usr/bin/env node
/**
 * @purpose lint-authoring.mjs — conformance linter for the atlas-constrained authoring contract
 * (knowledge/AUTHORING_CONTRACT.md, EMBODIMENT_APPROACH.md §P2). Parses authored single-file HTML+CSS
 * by rendering it in LOCAL chromium (computed-style checks: grid/position/bg-image/animation/transform
 * cannot be trusted to static parsing), classifies every element against the atlas construct vocabulary,
 * and checks each against the contract rules. Deterministic: DOM-order walk, no timestamps, same input →
 * same output.
 *
 * USAGE
 *   node lint-authoring.mjs --html <file.html> [--out report.json]   → JSON report on stdout
 *   node lint-authoring.mjs --selftest                               → fixtures gate (exit 0 = PASS)
 *
 * OUTPUT
 *   { clean: bool, file, constructs, cleanConstructs, pctClean,
 *     violations: [{construct, rule, element, fixHint, residualChannel}],
 *     warnings:   [{construct, rule, element, note}] }
 *
 * Gate semantics (P2 dual gate (a)): a construct OCCURRENCE is clean iff zero violations attribute to
 * it; pctClean = cleanConstructs / constructs. Warnings (W-*) never affect the gate.
 *
 * Classification mirrors transpile-html.mjs mapNode (leaf predicate incl. boxKid/isBtnish, button =
 * <a> radius ≥10, ICON_GLYPHS import) so linter and transpiler cannot drift on what a construct IS.
 * Totality: every classification id that can occur WITHOUT a violation is in EXPRESSIBLE (each has a
 * transpile rule); BANNED_BY_CONSTRUCTION ids always co-occur with their V-rule — asserted in selftest.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { chromium } from 'playwright';
import { ICON_GLYPHS } from '../transpile-html.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── contract tables (knowledge/AUTHORING_CONTRACT.md §5, §8) ───────────────────────────────────────
export const ELEMENT_WHITELIST = new Set([
  'html', 'head', 'meta', 'title', 'style', 'link', 'body', // link checked separately (stylesheet ban)
  'div', 'section', 'header', 'footer', 'nav', 'main', 'article', 'aside', 'figure', 'figcaption',
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'span', 'br', 'img', 'svg',
  'ul', 'ol', 'li', 'pre', 'code', 'hr',
]);
const INLINE_TEXT_TAGS = new Set(['strong', 'em', 'b', 'i', 'u', 'small', 'code']);

export const RULES = {
  'V-SCRIPT': { fixHint: 'remove <script>/inline handlers; behavior routes post-transpile', residualChannel: 'gsap' },
  'V-STYLE-BODY': { fixHint: 'single <style> block in <head> only', residualChannel: 'none' },
  'V-EXTERNAL-CSS': { fixHint: 'inline all CSS into the head <style>; system font stacks only', residualChannel: 'none' },
  'V-ELEMENT': { fixHint: 'off-whitelist element — see contract §5 for the construct route', residualChannel: 'html-widget' },
  'V-POPOVER': { fixHint: 'modal construct: author content statically; popup is post-transpile', residualChannel: 'html-widget' },
  'V-GRID': { fixHint: 'author as flex rows (grid container transpile rule = pre-P3 fix)', residualChannel: 'none' },
  'V-POSITION': { fixHint: 'absolute/fixed/sticky have no transpile rule; keep content in flow', residualChannel: 'custom_css' },
  'V-BGIMAGE': { fixHint: 'background-image/gradient not extracted; flat color or region-raster', residualChannel: 'region-raster' },
  'V-ANIM': { fixHint: 'animation/transition/transform/filter/float not transpilable; author static state', residualChannel: 'custom_css' },
  'V-GRADIENT-TEXT': { fixHint: 'gradient glyphs need per-widget custom_css post-transpile; author solid paint', residualChannel: 'custom_css' },
  'V-INLINE-TAG': { fixHint: 'use <span style="font-weight:700"> not strong/em/b/i (leaf discipline §2)', residualChannel: 'inline-style' },
  'V-PRE-NEWLINE': { fixHint: 'code lines must break with <br> (raw newlines collapse in transpile)', residualChannel: 'html-widget' },
  'V-IMG-SRC': { fixHint: 'img src must be https or assets-manifest-resolvable; no data:/placeholder CDNs', residualChannel: 'region-raster' },
  'V-CLASS-NS': { fixHint: 'classes are lowercase-kebab, no elementor-/e-/joist- prefixes', residualChannel: 'none' },
  'V-NEST': { fixHint: 'flatten wrappers: ≤4 container levels per top-level section', residualChannel: 'none' },
  'V-MINWIDTH': { fixHint: 'desktop-first: rewrite as @media (max-width:…)', residualChannel: 'none' },
};

// constructs with a transpile rule (contract §6 OK+PARTIAL) — lint-clean occurrences must be here
export const EXPRESSIBLE = new Set([
  'body-text', 'heading', 'button-cta', 'image', 'icon-svg', 'logo', 'stat-number', 'badge-pill',
  'nav-links', 'inline-styled-text', 'code-panel', 'divider', 'section-stack', 'nav-row',
  'hero-stack', 'card', 'split-2col', 'logo-band', 'footer-columns', 'cta-band',
]);
// classifications that ALWAYS carry their V-rule (atlas GAP constructs detectable in static HTML)
export const BANNED_BY_CONSTRUCTION = { 'card-grid': 'V-GRID' };

// ── render + extract element records (computed styles where static parsing is insufficient) ───────
export async function extract(htmlFile) {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1200 } })).newPage();
  await page.goto(pathToFileURL(path.resolve(htmlFile)).href, { waitUntil: 'load' });
  const data = await page.evaluate(() => {
    const recs = [];
    const sheetIssues = [];
    // stylesheet-level: min-width media rules, css-math warns
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      const walkRules = (list) => {
        for (const rule of list) {
          if (rule.type === 4) {
            const cond = rule.conditionText || rule.media?.mediaText || '';
            if (/min-width/.test(cond)) sheetIssues.push({ kind: 'minwidth', detail: `@media ${cond}` });
            walkRules(rule.cssRules);
          } else if (rule.type === 7) {
            sheetIssues.push({ kind: 'keyframes', detail: `@keyframes ${rule.name}` });
          } else if (rule.type === 1) {
            for (let i = 0; i < rule.style.length; i++) {
              const p = rule.style[i]; const v = rule.style.getPropertyValue(p);
              if (/(?:clamp|calc|min|max)\(/.test(v)) sheetIssues.push({ kind: 'cssmath', detail: `${rule.selectorText} { ${p}: ${v} }` });
            }
          }
        }
      };
      walkRules(rules);
    }
    const docIssues = {
      scripts: document.querySelectorAll('script').length,
      bodyStyles: document.querySelectorAll('body style').length,
      externalCss: document.querySelectorAll('link[rel="stylesheet"]').length,
      inlineHandlers: [...document.querySelectorAll('body *')].filter((el) =>
        [...el.attributes].some((a) => /^on[a-z]+$/.test(a.name))).length,
    };
    const isBtnish = (el, cs) => el.tagName === 'A' && parseFloat(cs.borderRadius) >= 10;
    const leafInfo = (el, cs) => {
      const kids = [...el.children];
      if (kids.length === 0) return { leaf: true, inlineTagKids: [] };
      const inlineTagKids = kids.filter((k) => !['SPAN', 'BR'].includes(k.tagName)).map((k) => k.tagName.toLowerCase());
      const allInlineish = kids.every((k) => ['SPAN', 'BR'].includes(k.tagName) || k.tagName && ['strong', 'em', 'b', 'i', 'u', 'small', 'code'].includes(k.tagName.toLowerCase()));
      if (!allInlineish) return { leaf: false, inlineTagKids: [] };
      const boxKid = kids.some((k) => { const c = getComputedStyle(k).backgroundColor; return c && c !== 'rgba(0, 0, 0, 0)' && k.textContent.trim() === ''; });
      const leaf = !boxKid || isBtnish(el, cs);
      return { leaf, inlineTagKids: inlineTagKids.filter((t) => t !== 'br') };
    };
    const ser = (el, parentIdx, inLeaf) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style') return;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const li = tag === 'svg' || tag === 'img' ? { leaf: true, inlineTagKids: [] } : leafInfo(el, cs);
      const spanKids = [...el.children].filter((k) => k.tagName === 'SPAN').map((k) => {
        const kc = getComputedStyle(k);
        return { text: k.textContent.trim(), styled: k.getAttribute('style') !== null || k.className !== '',
          color: kc.color, bg: kc.backgroundColor !== 'rgba(0, 0, 0, 0)' ? kc.backgroundColor : null,
          round: (parseFloat(kc.width) || 0) > 0 && parseFloat(kc.borderRadius) >= (parseFloat(kc.width) || 0) / 2 };
      });
      const idx = recs.length;
      recs.push({
        idx, parentIdx, tag, inLeaf,
        cls: typeof el.className === 'string' ? el.className : (el.getAttribute('class') || ''),
        attrs: {
          popover: el.hasAttribute('popover') || el.hasAttribute('popovertarget'),
          src: el.getAttribute('src') || '', alt: el.getAttribute('alt'), role: el.getAttribute('role') || '',
        },
        leaf: li.leaf, inlineTagKids: li.inlineTagKids,
        text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60),
        rawText: tag === 'pre' || tag === 'code' ? el.textContent : '',
        hasBr: !!el.querySelector('br'),
        spanKids,
        childCount: el.children.length,
        rect: { w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) },
        s: {
          display: cs.display, position: cs.position, bgImage: cs.backgroundImage, bgColor: cs.backgroundColor,
          animName: cs.animationName, transDur: cs.transitionDuration, transform: cs.transform,
          filter: cs.filter, float: cs.float, radius: cs.borderRadius, fontFamily: cs.fontFamily,
          bgClip: cs.webkitBackgroundClip || cs.backgroundClip,
          border: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].some((w) => parseFloat(w) > 0),
          shadow: cs.boxShadow !== 'none', flexDir: cs.flexDirection, flexGrow: cs.flexGrow,
          padding: cs.paddingTop !== '0px' || cs.paddingLeft !== '0px',
        },
      });
      if (tag === 'svg') return; // svg internals are opaque (one construct)
      for (const c of el.children) {
        if (c.tagName === 'BR') continue;
        ser(c, idx, inLeaf || li.leaf);
      }
    };
    for (const c of document.body.children) ser(c, -1, false);
    return { recs, sheetIssues, docIssues };
  });
  await browser.close();
  return data;
}

// ── classification (atlas construct vocabulary; mirrors transpiler mapNode order) ──────────────────
export function classify(rec, recs) {
  const t = rec.tag;
  if (t === 'img') return /logo|brand/.test(rec.cls + ' ' + (rec.attrs.alt || '')) ? 'logo' : 'image';
  if (t === 'svg') return 'icon-svg';
  if (/^h[1-6]$/.test(t)) return 'heading';
  if (t === 'pre' || t === 'code') return 'code-panel';
  if (rec.s.display.includes('grid')) return 'card-grid';
  if (rec.leaf) {
    if (t === 'a' && parseFloat(rec.s.radius) >= 10) return 'button-cta';
    if (!rec.text) return 'divider';
    if (parseFloat(rec.s.radius) >= rec.rect.h / 2 && rec.rect.h > 0 && rec.s.bgColor !== 'rgba(0, 0, 0, 0)' && rec.rect.w < 400) return 'badge-pill';
    if (rec.spanKids.some((k) => k.styled && k.text)) return 'inline-styled-text';
    return 'body-text';
  }
  // containers
  if (t === 'header' || (t === 'nav' && rec.parentIdx === -1)) return 'nav-row';
  if (t === 'footer') return 'footer-columns';
  if (t === 'ul' || t === 'ol') return 'nav-links';
  const kids = recs.filter((r) => r.parentIdx === rec.idx);
  if (rec.parentIdx === -1 && recs.some((r) => r.tag === 'h1' && within(r, rec, recs))) return 'hero-stack';
  if (rec.s.flexDir === 'row' && kids.length >= 3 && kids.every((k) => k.tag === 'img' || k.tag === 'svg' || (k.leaf && k.rect.h <= 140))) return 'logo-band';
  if (rec.s.flexDir === 'row' && kids.length === 2 && kids.every((k) => !k.leaf && parseFloat(k.s.flexGrow) >= 1)) return 'split-2col';
  if ((rec.s.bgColor !== 'rgba(0, 0, 0, 0)' || rec.s.border || rec.s.shadow) && parseFloat(rec.s.radius) >= 8 && !rec.leaf && rec.parentIdx !== -1) return 'card';
  if (rec.parentIdx === -1 && rec.s.bgColor !== 'rgba(0, 0, 0, 0)' && recs.some((r) => within(r, rec, recs) && classifyLeafOnly(r) === 'button-cta') && !recs.some((r) => r.tag === 'h1' && within(r, rec, recs))) return 'cta-band';
  return 'section-stack';
}
const classifyLeafOnly = (r) => (r.leaf && r.tag === 'a' && parseFloat(r.s.radius) >= 10 ? 'button-cta' : null);
function within(r, anc, recs) { let p = r; while (p && p.parentIdx !== -1) { p = recs[p.parentIdx]; if (p === anc) return true; } return p === anc; }

// ── lint ────────────────────────────────────────────────────────────────────────────────────────────
export async function lint(htmlFile) {
  const { recs, sheetIssues, docIssues } = await extract(htmlFile);
  const violations = []; const warnings = [];
  const vio = (rule, construct, element, extra = '') => violations.push({
    construct, rule, element, fixHint: RULES[rule].fixHint + (extra ? ` [${extra}]` : ''), residualChannel: RULES[rule].residualChannel });
  const warn = (rule, construct, element, note) => warnings.push({ construct, rule, element, note });
  const elDesc = (r) => `<${r.tag}${r.cls ? ` class="${r.cls}"` : ''}>${r.text ? ` "${r.text.slice(0, 30)}"` : ''}`;

  // document-level
  if (docIssues.scripts) vio('V-SCRIPT', 'document', `<script> ×${docIssues.scripts}`);
  if (docIssues.inlineHandlers) vio('V-SCRIPT', 'document', `inline on* handlers ×${docIssues.inlineHandlers}`);
  if (docIssues.bodyStyles) vio('V-STYLE-BODY', 'document', `<style> in body ×${docIssues.bodyStyles}`);
  if (docIssues.externalCss) vio('V-EXTERNAL-CSS', 'document', `<link rel=stylesheet> ×${docIssues.externalCss}`);
  for (const si of sheetIssues) {
    if (si.kind === 'minwidth') vio('V-MINWIDTH', 'media', si.detail);
    if (si.kind === 'keyframes') vio('V-ANIM', 'media', si.detail);
    if (si.kind === 'cssmath') warn('W-CSSMATH', 'css', si.detail, 'frozen to computed px at authoring width (transpiler P2 policy)');
  }

  // element records: construct occurrences = non-inLeaf records (leaf children belong to their leaf)
  const occ = recs.filter((r) => !r.inLeaf && r.tag !== 'br');
  const constructOf = new Map();
  for (const r of occ) constructOf.set(r.idx, classify(r, occ.length === recs.length ? recs : recs));

  // container nesting depth (top-level child of body = level 1; leaves don't count)
  const depth = new Map();
  for (const r of recs) {
    const pd = r.parentIdx === -1 ? 0 : (depth.get(r.parentIdx) ?? 0);
    depth.set(r.idx, r.leaf || r.inLeaf ? pd : pd + 1);
  }

  for (const r of recs) {
    const c = constructOf.get(r.idx) || 'inline-span';
    const d = elDesc(r);
    if (!ELEMENT_WHITELIST.has(r.tag)) vio('V-ELEMENT', c === 'inline-span' ? 'document' : c, d, `<${r.tag}> off-whitelist`);
    if (r.attrs.popover) vio('V-POPOVER', 'modal', d);
    if (r.attrs.role === 'tablist') vio('V-ELEMENT', 'tabs', d, 'interactive tabs');
    if (r.cls && String(r.cls).split(/\s+/).some((cl) => cl && (!/^[a-z][a-z0-9-]*$/.test(cl) || /^(elementor-|e-|joist-)/.test(cl))))
      vio('V-CLASS-NS', c === 'inline-span' ? 'document' : c, d);
    if (r.inLeaf) continue; // remaining rules attribute to construct occurrences only
    if (r.s.display.includes('grid')) vio('V-GRID', c, d);
    if (['absolute', 'fixed', 'sticky'].includes(r.s.position)) vio('V-POSITION', c, d, r.s.position);
    if (r.s.bgImage && r.s.bgImage !== 'none') vio('V-BGIMAGE', c, d);
    if (r.s.animName && r.s.animName !== 'none') vio('V-ANIM', c, d, 'animation');
    if (r.s.transDur && r.s.transDur.split(',').some((v) => parseFloat(v) > 0)) vio('V-ANIM', c, d, 'transition');
    if (r.s.transform && r.s.transform !== 'none') vio('V-ANIM', c, d, 'transform');
    if (r.s.filter && r.s.filter !== 'none') vio('V-ANIM', c, d, 'filter');
    if (r.s.float && r.s.float !== 'none') vio('V-ANIM', c, d, 'float');
    if (r.s.bgClip === 'text') vio('V-GRADIENT-TEXT', c, d);
    if (r.inlineTagKids.length) vio('V-INLINE-TAG', c, d, r.inlineTagKids.join(','));
    if ((r.tag === 'pre' || r.tag === 'code') && /\S[^\S\n]*\n\s*\S/.test(r.rawText) && !r.hasBr) vio('V-PRE-NEWLINE', 'code-panel', d);
    if (r.tag === 'img') {
      if (!/^https:\/\//.test(r.attrs.src) && !/^[a-z0-9_-]+\.(png|jpe?g|webp|svg|gif|avif)$/i.test(path.basename(r.attrs.src || '')))
        vio('V-IMG-SRC', c, d, r.attrs.src.slice(0, 60));
      else if (/placehold|picsum|dummyimage|^data:/.test(r.attrs.src)) vio('V-IMG-SRC', c, d, 'placeholder CDN/data URI');
      if (!r.attrs.alt) warn('W-ALT', c, d, 'img without alt');
    }
    if (!r.leaf && (depth.get(r.idx) ?? 0) > 4) vio('V-NEST', c, d, `container depth ${depth.get(r.idx)}`);
    // warnings
    if (r.tag === 'a' && r.leaf && parseFloat(r.s.radius) < 10 && /(^|[\s-])(btn|button|cta)([\s-]|$)/.test(r.cls) )
      warn('W-SQUARE-BTN', c, d, 'border-radius <10px: maps to text-editor, not button widget');
    if (constructOf.get(r.idx) === 'button-cta') {
      for (const k of r.spanKids) {
        const g = k.text.trim();
        const isGlyph = (g.length <= 2 && ICON_GLYPHS[g]) || (!g && k.bg && k.round);
        if (k.styled && g && !isGlyph) warn('W-BTN-SPAN', 'button-cta', d, `styled span "${g.slice(0, 16)}" flattens to plain button text (P1)`);
      }
    }
    if (r.leaf && r.text) {
      const fam = String(r.s.fontFamily).split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
      const okFonts = new Set(['ui-sans-serif', '-apple-system', 'system-ui', 'helvetica neue', 'helvetica', 'arial', 'georgia', 'times new roman', 'ui-monospace', 'menlo', 'monaco', 'monospace', 'sf mono', 'blinkmacsystemfont']);
      if (!okFonts.has(fam)) warn('W-FONT', c, d, `font "${fam}" not a system/kit family`);
    }
  }

  // gate accounting: a construct occurrence is clean iff no violation names its element desc
  const dirty = new Set(violations.map((v) => v.element));
  const occList = recs.filter((r) => !r.inLeaf && r.tag !== 'br');
  const cleanCount = occList.filter((r) => !dirty.has(elDesc(r))).length;
  const docVio = violations.filter((v) => ['document', 'media', 'css'].includes(v.construct)).length;
  return {
    clean: violations.length === 0,
    file: path.resolve(htmlFile),
    constructs: occList.length,
    cleanConstructs: cleanCount,
    pctClean: occList.length ? +(100 * cleanCount / occList.length).toFixed(1) : 100,
    documentViolations: docVio,
    byConstruct: occList.reduce((m, r) => { const c = classify(r, recs); m[c] = (m[c] || 0) + 1; return m; }, {}),
    violations, warnings,
  };
}

// ── selftest: fixtures gate (orchestrator re-executes this as the P2 phase check) ──────────────────
async function selftest() {
  const fx = path.join(__dirname, 'fixtures');
  const PLANTED = ['V-SCRIPT', 'V-GRID', 'V-POSITION', 'V-BGIMAGE', 'V-MINWIDTH'];
  let ok = true;
  const t = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!cond) ok = false; };

  const clean = await lint(path.join(fx, 'clean.html'));
  t('clean fixture: clean === true', clean.clean === true, `${clean.violations.length} violations: ${clean.violations.map((v) => v.rule).join(',')}`);
  t('clean fixture: zero false positives', clean.violations.length === 0);
  t('clean fixture: constructs counted', clean.constructs >= 8, `${clean.constructs} occurrences`);
  t('clean fixture: all lint-clean constructs are transpiler-expressible',
    Object.keys(clean.byConstruct).every((c) => EXPRESSIBLE.has(c)), Object.keys(clean.byConstruct).join(','));

  const dirty = await lint(path.join(fx, 'violations.html'));
  const got = dirty.violations.map((v) => v.rule);
  for (const rule of PLANTED) t(`violations fixture: ${rule} caught`, got.includes(rule));
  t('violations fixture: exactly the 5 planted (no extras)', dirty.violations.length === 5, got.join(','));
  t('violations fixture: banned-by-construction carries its rule',
    dirty.violations.some((v) => v.rule === BANNED_BY_CONSTRUCTION['card-grid'] && v.construct === 'card-grid'));
  t('violations fixture: residual channels attached', dirty.violations.every((v) => v.residualChannel !== undefined));

  console.log(ok ? '\nSELFTEST PASS' : '\nSELFTEST FAIL');
  process.exit(ok ? 0 : 1);
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (k) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : undefined; };
  if (process.argv.includes('--selftest')) { selftest(); }
  else {
    const html = arg('html');
    if (!html) { console.error('usage: lint-authoring.mjs --html <file.html> [--out report.json] | --selftest'); process.exit(2); }
    lint(html).then((report) => {
      const out = arg('out'); if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
    }).catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
  }
}
