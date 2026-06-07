#!/usr/bin/env node
/**
 * @purpose Stage 1 of the re-architected cloner: FAITHFUL measured-geometry
 * capture (no-deploy, host-portable). Replaces the heuristic extract-layout.mjs.
 *
 * Instead of GUESSING layout (hero = "first heading >=40px", columns = "left/right
 * of midpoint"), this TRANSCRIBES what the source browser already computed:
 *   - the source's own section bands (full-width ancestors), in document order
 *   - every layout-significant leaf with its absolute box geometry + full computed
 *     typography, color, background (color + gradient string), border-radius
 *   - real image URLs at natural + displayed size
 *   - the web fonts actually used (@font-face families)
 * Output is a hierarchical tree (sections -> columns -> leaves) that Stage 2 maps
 * to a NATIVE Elementor container/widget tree (round-trip editable, high fidelity).
 *
 * Usage: node capture-tree.mjs --source <url> [--out tree.json] [--maxSections 24]
 */
import { chromium } from 'playwright';
import fs from 'fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source');
const out = arg('out', './tree.json');
const maxSections = parseInt(arg('maxSections', '24'), 10);
if (!source) { console.error('need --source'); process.exit(2); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try { await page.goto(source, { waitUntil: 'networkidle', timeout: 60000 }); }
  catch { try { await page.goto(source, { waitUntil: 'load', timeout: 60000 }); } catch {} }
  await page.waitForTimeout(2500);
  // scroll to trigger lazy-load + reveal, then back to top so rects are stable
  await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 200)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(1200);

  const data = await page.evaluate((MAXS) => {
    const vw = window.innerWidth;
    const vis = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && r.width > 2 && r.height > 2; };
    const abs = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height), cx: r.left + r.width / 2 }; };
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const grad = (cs) => { const bi = cs.backgroundImage || 'none'; return bi !== 'none' ? bi : ''; };

    // ---- 1) SECTION BANDS: full-width, outermost, non-overlapping, document order
    const cand = [];
    for (const e of document.querySelectorAll('section,header,footer,main,article,div')) {
      if (!vis(e)) continue;
      const r = abs(e);
      if (r.w < vw * 0.85 || r.h < 120 || r.h > 8000) continue;
      cand.push({ e, ...r });
    }
    cand.sort((a, b) => a.y - b.y || b.h - a.h);
    const bands = [];
    for (const c of cand) {
      if (bands.length >= MAXS) break;
      const ov = bands.some((s) => Math.min(c.y + c.h, s.y + s.h) - Math.max(c.y, s.y) > 0.55 * Math.min(c.h, s.h));
      if (ov) continue;
      bands.push(c);
    }
    bands.sort((a, b) => a.y - b.y);

    // ---- 2) LEAVES captured GLOBALLY in document order (not band-restricted, so
    // nothing the hero needs can be dropped by band-membership bugs).
    const hasOwnText = (e) => { for (const n of e.childNodes) if (n.nodeType === 3 && clean(n.textContent)) return true; return false; };
    const leaves = [];
    const seen = new Set();
    const sel = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,img,svg,button,a,span,div';
    for (const e of document.querySelectorAll(sel)) {
      if (!vis(e)) continue;
      const tag = e.tagName.toLowerCase();
      const r = abs(e);
      const cs = getComputedStyle(e);
      if (tag === 'img') {
        const src = e.currentSrc || e.src; if (!src || src.startsWith('data:') || r.w < 40 || r.h < 24) continue;
        if (seen.has('i:' + src + r.y)) continue; seen.add('i:' + src + r.y);
        leaves.push({ type: 'image', tag, src, alt: e.alt || '', rect: r, natW: e.naturalWidth, natH: e.naturalHeight, objectFit: cs.objectFit, radius: cs.borderTopLeftRadius });
        continue;
      }
      // text leaves: only elements that hold their OWN visible text (deepest holder),
      // OR semantic headings/buttons. Avoids capturing wrapper + child duplicates.
      const isHeading = /^h[1-6]$/.test(tag);
      const isBtn = tag === 'button' || (tag === 'a');
      if (!isHeading && !isBtn && !hasOwnText(e)) continue;
      const t = clean(e.innerText || e.textContent);
      if (!t || t.length > 600 || t.length < 2) continue;
      // SALIENCE FLOOR: text under 14px is almost always product-mockup interior
      // (dashboard/checkout graphics) or fine-print — not page content. Drop the
      // individual leaves; Stage 3 region-captures those graphics as images.
      const szPx = Math.round(parseFloat(cs.fontSize));
      if (!isHeading && !isBtn && szPx < 14) continue;
      const k = tag + ':' + t.toLowerCase() + ':' + Math.round(r.y / 4);
      if (seen.has(k)) continue; seen.add(k);
      const type = isHeading ? 'heading' : (isBtn ? 'button' : 'text');
      leaves.push({
        type, tag, text: t, level: isHeading ? +tag[1] : null,
        rect: r,
        font: { family: cs.fontFamily, sizePx: Math.round(parseFloat(cs.fontSize)), weight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, style: cs.fontStyle, transform: cs.textTransform },
        color: cs.color, align: cs.textAlign,
        bg: cs.backgroundColor, bgGrad: grad(cs), radius: cs.borderTopLeftRadius,
        href: isBtn && e.href ? e.href : null,
      });
    }

    // ---- 3) ASSIGN leaves to bands by vertical containment of their center
    const sections = bands.map((b) => {
      const cs = getComputedStyle(b.e);
      return { rect: { x: b.x, y: b.y, w: b.w, h: b.h }, bg: cs.backgroundColor, bgGrad: grad(cs), padding: cs.padding, mine: [] };
    });
    const findSec = (ly) => { for (const s of sections) if (ly >= s.rect.y - 2 && ly < s.rect.y + s.rect.h + 2) return s; return null; };
    for (const lf of leaves) {
      const center = lf.rect.y + lf.rect.h / 2;
      // pick the SMALLEST containing band (most specific) for accuracy
      let best = null;
      for (const s of sections) { if (center >= s.rect.y - 2 && center < s.rect.y + s.rect.h + 2) { if (!best || s.rect.h < best.rect.h) best = s; } }
      (best || sections[0] || { mine: [] }).mine?.push(lf);
    }

    // ---- 4) COLUMN clustering by x within each section
    for (const s of sections) {
      const ls = s.mine.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
      const mid = s.rect.x + s.rect.w / 2;
      let leftN = 0, rightN = 0;
      for (const lf of ls) { lf.col = lf.rect.cx < mid - 100 ? 0 : lf.rect.cx > mid + 100 ? 1 : -1; if (lf.col === 0) leftN++; else if (lf.col === 1) rightN++; }
      s.columns = (leftN >= 1 && rightN >= 1 && (leftN + rightN) >= 0.5 * Math.max(1, ls.length)) ? 2 : 1;
      delete s.mine; s.blocks = ls.map((l) => { delete l.rect.cx; return l; });
    }
    const filled = sections.filter((s) => s.blocks.length);

    // ---- 5) FONTS actually loaded
    const fams = new Set();
    try { document.fonts.forEach((f) => { if (f.status === 'loaded') fams.add(f.family.replace(/['"]/g, '')); }); } catch {}

    // hero = first filled section containing an h1 (or the largest heading near top)
    let heroIdx = filled.findIndex((s) => s.blocks.some((b) => b.type === 'heading' && b.level === 1));
    if (heroIdx < 0) heroIdx = 0;

    return {
      url: location.href, title: document.title,
      pageBg: getComputedStyle(document.body).backgroundColor,
      pageHeight: document.documentElement.scrollHeight,
      fonts: [...fams], heroIdx,
      sectionCount: filled.length, sections: filled,
    };
  }, maxSections);

  await browser.close();

  // ---- POST-PROCESS (general structural cleanups, not site-specific) ----
  const collapseDoubled = (t) => { const m = t.match(/^(.+?)\s+\1$/); return m ? m[1] : t; };
  for (const sec of data.sections) {
    // B) collapse innerText doubling ("Sign in Sign in" -> "Sign in")
    for (const b of sec.blocks) if (b.text) b.text = collapseDoubled(b.text);
    // A) a heading whose innerText swallowed a sibling subhead: trim the overlap
    const heads = sec.blocks.filter((b) => b.type === 'heading');
    const texts = sec.blocks.filter((b) => b.type === 'text');
    for (const h of heads) for (const t of texts) {
      if (t.text.length > 20 && h.text !== t.text && h.text.endsWith(t.text)) {
        const trimmed = h.text.slice(0, h.text.length - t.text.length).replace(/[\s—–\-.,:]+$/, '').trim();
        if (trimmed.length >= 6) h.text = trimmed; // recover the real headline only
      }
    }
  }

  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  const blocks = data.sections.reduce((a, s) => a + s.blocks.length, 0);
  const twoCol = data.sections.filter((s) => s.columns === 2).length;
  console.log(`captured ${data.sectionCount} sections (${twoCol} two-col), ${blocks} blocks | hero=#${data.heroIdx} | fonts: ${data.fonts.join(', ') || '(none detected)'}`);
  // verification dump: hero section's headings, so we can SEE the real hero headline
  const hero = data.sections[data.heroIdx];
  if (hero) {
    console.log(`\nHERO section #${data.heroIdx} (cols=${hero.columns}, bg=${hero.bg}, grad=${hero.bgGrad ? 'yes' : 'no'}):`);
    for (const b of hero.blocks.slice(0, 8)) {
      if (b.type === 'image') console.log(`  [img] ${b.rect.w}x${b.rect.h} col${b.col} ${b.src.split('/').pop().slice(0, 40)}`);
      else console.log(`  [${b.type}${b.level || ''}] ${b.font?.sizePx}px col${b.col} "${b.text.slice(0, 50)}"`);
    }
  }
})();
