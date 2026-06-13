#!/usr/bin/env node
/**
 * Agent-side RENDERED-DOM extractor (no-deploy, host-portable).
 * Loads a source URL, scrolls to trigger lazy content, then walks the FULL
 * rendered DOM (no 32KB static cap) into an ordered "blueprint" of content
 * blocks — headings/text/images/buttons with computed type+color — so a clone
 * can reproduce the WHOLE page (attacks the truncation ceiling), with real
 * image URLs and real typography.
 *
 * Usage: node extract.mjs --source <url> [--out blueprint.json] [--max 240]
 */
import { chromium } from 'playwright';
import fs from 'fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source');
const out = arg('out', './blueprint.json');
const max = parseInt(arg('max', '240'), 10);
if (!source) { console.error('need --source'); process.exit(2); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try { await page.goto(source, { waitUntil: 'networkidle', timeout: 60000 }); }
  catch { try { await page.goto(source, { waitUntil: 'load', timeout: 60000 }); } catch {} }
  await page.waitForTimeout(2500);
  // scroll through to trigger lazy-load / reveal content, then back to top
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y <= h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 220)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);

  const data = await page.evaluate((MAX) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity !== 0 && r.width > 2 && r.height > 2; };
    const pageBg = getComputedStyle(document.body).backgroundColor;
    const blocks = []; const seen = new Set();
    const nodes = document.querySelectorAll('h1,h2,h3,h4,p,img,button,a[class*="btn" i],a[class*="button" i]');
    for (const e of nodes) {
      if (blocks.length >= MAX) break;
      if (!vis(e)) continue;
      const tag = e.tagName.toLowerCase();
      const r = e.getBoundingClientRect();
      if (tag === 'img') {
        const src = e.currentSrc || e.src; if (!src || src.startsWith('data:') || r.width < 48 || r.height < 24) continue;
        const key = 'img:' + src; if (seen.has(key)) continue; seen.add(key);
        blocks.push({ type: 'image', src, alt: e.alt || '', w: Math.round(r.width), h: Math.round(r.height) });
        continue;
      }
      const t = (e.innerText || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 700) continue;
      const key = tag[0] + ':' + t.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
      const cs = getComputedStyle(e);
      const type = /^h[1-4]$/.test(tag) ? 'heading' : (tag === 'button' || tag === 'a') ? 'button' : 'text';
      blocks.push({ type, level: /^h[1-4]$/.test(tag) ? +tag[1] : null, text: t, fontSizePx: Math.round(parseFloat(cs.fontSize)), fontWeight: cs.fontWeight, color: cs.color, align: cs.textAlign });
    }
    return { url: location.href, title: document.title, pageBg, pageHeight: document.documentElement.scrollHeight, blockCount: blocks.length, blocks };
  }, max);

  await browser.close();
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  const counts = data.blocks.reduce((a, b) => (a[b.type] = (a[b.type] || 0) + 1, a), {});
  console.log(`extracted ${data.blockCount} blocks from ${data.url}`);
  console.log('  pageHeight:', data.pageHeight, '| pageBg:', data.pageBg, '| by type:', JSON.stringify(counts));
  console.log('  → ' + out);
})();
