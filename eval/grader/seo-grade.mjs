#!/usr/bin/env node
/**
 * @purpose SEO / meta / semantics eval layer (EVAL_COVERAGE_MAP §F). A faithful clone must carry
 * the meta a real page needs — title, description, social cards, structured data, canonical,
 * viewport. Graded source-vs-clone + absolute presence. Read-only.
 * Usage: node seo-grade.mjs --source <url> --clone <url> [--out dir]
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { assertAllowedBase, assertNotBlocked } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: refuse a stray (e.g. paused *.sg-host.com) URL before any navigation.
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source'), clone = arg('clone'), out = arg('out', './seo-out');
if (!source || !clone) { console.error('need --source --clone'); process.exit(2); }
// §0 SAFETY GUARD: assert every http(s) URL arg targets a training host (blocks the paused shared host) BEFORE any chromium.goto.
if (clone && /^https?:/i.test(clone)) assertAllowedBase(clone); if (source && /^https?:/i.test(source)) assertNotBlocked(source); /* source = external read-only; only the paused host is blocked */
fs.mkdirSync(out, { recursive: true });

async function meta(ctx, url) {
  const p = await ctx.newPage();
  try { await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(url, { waitUntil: 'load', timeout: 30000 }); } catch {} }
  await p.waitForTimeout(800);
  const m = await p.evaluate(() => {
    const get = (sel, attr = 'content') => { const e = document.querySelector(sel); return e ? (e.getAttribute(attr) || '').trim() : ''; };
    return {
      title: (document.title || '').trim(),
      description: get('meta[name=description]'),
      canonical: get('link[rel=canonical]', 'href'),
      viewport: get('meta[name=viewport]'),
      robots: get('meta[name=robots]'),
      lang: document.documentElement.getAttribute('lang') || '',
      ogTitle: get('meta[property="og:title"]'), ogDesc: get('meta[property="og:description"]'), ogImage: get('meta[property="og:image"]'),
      twitter: get('meta[name="twitter:card"]'),
      jsonld: document.querySelectorAll('script[type="application/ld+json"]').length,
      h1: document.querySelectorAll('h1').length,
      charset: !!document.querySelector('meta[charset]'),
    };
  });
  await p.close(); return m;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const s = await meta(ctx, source), c = await meta(ctx, clone);
  await browser.close();
  const D = {}; const fails = []; const defects = [];
  // meta basics (absolute): title + description present & reasonable
  let mb = 1; if (!c.title || c.title.length < 5) { mb -= 0.5; defects.push('clone missing/short <title>'); } if (!c.description || c.description.length < 20) { mb -= 0.4; defects.push('clone missing meta description'); } if (!c.viewport) { mb -= 0.2; defects.push('clone missing viewport meta'); }
  D.meta = +Math.max(0, mb).toFixed(3); if (mb < 0.6) fails.push('meta');
  // social cards: if source has OG, clone should too
  let soc = 1; if (s.ogTitle && !c.ogTitle) { soc -= 0.5; defects.push('source has og:title, clone none'); } if (s.ogImage && !c.ogImage) { soc -= 0.5; defects.push('source has og:image, clone none'); }
  D.social = +Math.max(0, soc).toFixed(3);
  // structured data: if source ships JSON-LD, clone preserving it matters for SEO parity
  D.structured = s.jsonld > 0 ? (c.jsonld > 0 ? 1 : 0.4) : 1; if (s.jsonld > 0 && c.jsonld === 0) { defects.push(`source has ${s.jsonld} JSON-LD blocks, clone 0`); fails.push('structured-data'); }
  // headings
  D.headings = c.h1 === 1 ? 1 : 0.6; if (c.h1 !== 1) defects.push(`clone has ${c.h1} h1 (want exactly 1)`);
  const overall = Math.round(Math.min(D.meta, D.social, D.structured, D.headings) * 100);
  const report = { overall_pct: overall, dims: D, hard_fails: fails, defects, source: s, clone: c };
  fs.writeFileSync(path.join(out, 'seo-report.json'), JSON.stringify(report, null, 2));
  console.log('SEO / META (source vs clone):');
  console.log(`  title       src "${s.title.slice(0, 40)}"  |  cln "${c.title.slice(0, 40)}"`);
  console.log(`  description  src ${s.description ? 'yes(' + s.description.length + ')' : 'NO'}  |  cln ${c.description ? 'yes(' + c.description.length + ')' : 'NO'}`);
  console.log(`  og:title/img src ${!!s.ogTitle}/${!!s.ogImage}  |  cln ${!!c.ogTitle}/${!!c.ogImage}`);
  console.log(`  JSON-LD      src ${s.jsonld}  |  cln ${c.jsonld}   ·   h1 src ${s.h1} / cln ${c.h1}`);
  console.log('\n' + JSON.stringify({ seo_overall: overall, dims: D, hard_fails: fails, defects }, null, 2));
})();
