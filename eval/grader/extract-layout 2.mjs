#!/usr/bin/env node
/**
 * Layout-aware RENDERED-DOM extractor (no-deploy, host-portable).
 * Beyond the linear block list (extract.mjs), this detects SECTIONS (full-width
 * bands) and, per section, the background + a 1/2-column split, tagging each
 * content block with its column — so the clone reconstructs Stripe's actual
 * structure (2-col hero, side-by-side feature rows) and recovers pixel fidelity
 * while keeping completeness.
 *
 * Usage: node extract-layout.mjs --source <url> [--out blueprint-layout.json] [--maxSections 22]
 */
import { chromium } from 'playwright';
import fs from 'fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source');
const out = arg('out', './blueprint-layout.json');
const maxSections = parseInt(arg('maxSections', '22'), 10);
if (!source) { console.error('need --source'); process.exit(2); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try { await page.goto(source, { waitUntil: 'networkidle', timeout: 60000 }); }
  catch { try { await page.goto(source, { waitUntil: 'load', timeout: 60000 }); } catch {} }
  await page.waitForTimeout(2500);
  await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 200)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(1200);

  const data = await page.evaluate((MAXS) => {
    const vw = window.innerWidth;
    const SY = window.scrollY;
    const vis = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity !== 0 && r.width > 2 && r.height > 2; };
    const rectAbs = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, w: r.width, h: r.height, cx: r.left + r.width / 2 }; };

    // 1) candidate full-width bands → outermost, non-overlapping, in order
    const cand = [];
    for (const e of document.querySelectorAll('section,header,footer,main,article,div')) {
      if (!vis(e)) continue;
      const r = rectAbs(e);
      if (r.w < vw * 0.9 || r.h < 140 || r.h > 7000) continue;
      cand.push({ e, ...r });
    }
    cand.sort((a, b) => a.top - b.top || b.h - a.h);
    const sections = [];
    for (const c of cand) {
      if (sections.length >= MAXS) break;
      const overlap = sections.some((s) => Math.min(c.bottom, s.bottom) - Math.max(c.top, s.top) > 0.55 * Math.min(c.h, s.h));
      if (overlap) continue;
      sections.push(c);
    }
    sections.sort((a, b) => a.top - b.top);

    const bgImage = (cs) => cs.backgroundImage && cs.backgroundImage !== 'none' && cs.backgroundImage.includes('url(');
    const textOf = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();

    const result = [];
    const seenGlobal = new Set();
    for (const sec of sections) {
      const cs = getComputedStyle(sec.e);
      const midX = sec.left + sec.w / 2;
      // collect content blocks within this section (not deeper inside a nested chosen section)
      const blocks = [];
      const nodes = sec.e.querySelectorAll('h1,h2,h3,h4,p,img,button,a[class*="btn" i],a[class*="button" i]');
      let leftN = 0, rightN = 0;
      for (const el of nodes) {
        if (!vis(el)) continue;
        const tag = el.tagName.toLowerCase();
        const r = el.getBoundingClientRect();
        let blk = null;
        if (tag === 'img') {
          const src = el.currentSrc || el.src; if (!src || src.startsWith('data:') || r.width < 48 || r.height < 24) continue;
          if (seenGlobal.has('i:' + src)) continue; seenGlobal.add('i:' + src);
          blk = { type: 'image', src, alt: el.alt || '', w: Math.round(r.width), h: Math.round(r.height) };
        } else {
          const t = textOf(el); if (!t || t.length > 700) continue;
          const k = tag[0] + ':' + t.toLowerCase(); if (seenGlobal.has(k)) continue; seenGlobal.add(k);
          const c2 = getComputedStyle(el);
          const type = /^h[1-4]$/.test(tag) ? 'heading' : (tag === 'button' || tag === 'a') ? 'button' : 'text';
          blk = { type, level: /^h[1-4]$/.test(tag) ? +tag[1] : null, text: t, fontSizePx: Math.round(parseFloat(c2.fontSize)), fontWeight: c2.fontWeight, color: c2.color, align: c2.textAlign };
        }
        const cx = r.left + r.width / 2;
        blk.col = cx < midX - 90 ? 0 : cx > midX + 90 ? 1 : -1; // -1 = full/center
        if (blk.col === 0) leftN++; else if (blk.col === 1) rightN++;
        blocks.push(blk);
      }
      if (!blocks.length) continue;
      const twoCol = leftN >= 1 && rightN >= 1 && (leftN + rightN) >= 0.5 * blocks.length;
      result.push({
        bg: cs.backgroundColor,
        hasBgImage: bgImage(cs),
        columns: twoCol ? 2 : 1,
        height: Math.round(sec.h),
        blocks: blocks.slice(0, 16),
      });
    }
    return { url: location.href, title: document.title, pageBg: getComputedStyle(document.body).backgroundColor, pageHeight: document.documentElement.scrollHeight, sectionCount: result.length, sections: result };
  }, maxSections);

  await browser.close();
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  const blockTotal = data.sections.reduce((a, s) => a + s.blocks.length, 0);
  const twoCol = data.sections.filter((s) => s.columns === 2).length;
  console.log(`extracted ${data.sectionCount} sections (${twoCol} two-col), ${blockTotal} blocks from ${data.url}`);
  console.log('  pageHeight', data.pageHeight, '→ ' + out);
})();
