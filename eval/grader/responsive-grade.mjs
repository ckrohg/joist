#!/usr/bin/env node
/**
 * @purpose Responsive-overflow eval layer (EVAL_COVERAGE_MAP §B2). The committee snapshots
 * 3 viewports; this sweeps many widths and detects the #1 responsive failure: HORIZONTAL
 * OVERFLOW (content wider than the viewport → ugly side-scroll / cut-off), per width,
 * source-vs-clone. A clone that overflows at 600px where the source doesn't is a real defect.
 * Read-only. Usage: node responsive-grade.mjs --source <url> --clone <url> [--out dir]
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { assertAllowedBase, assertNotBlocked } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: refuse a stray (e.g. paused *.sg-host.com) URL before any navigation.
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source'), clone = arg('clone'), out = arg('out', './responsive-out');
if (!source || !clone) { console.error('need --source --clone'); process.exit(2); }
// §0 SAFETY GUARD: assert every http(s) URL arg targets a training host (blocks the paused shared host) BEFORE any chromium.goto.
if (clone && /^https?:/i.test(clone)) assertAllowedBase(clone); if (source && /^https?:/i.test(source)) assertNotBlocked(source); /* source = external read-only; only the paused host is blocked */
fs.mkdirSync(out, { recursive: true });
const WIDTHS = [1440, 1280, 1024, 820, 768, 600, 414, 390, 360];

async function sweep(ctx, url) {
  const p = await ctx.newPage();
  try { await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(url, { waitUntil: 'load', timeout: 30000 }); } catch {} }
  const byWidth = {};
  for (const w of WIDTHS) {
    await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(450);
    const m = await p.evaluate((vw) => {
      const docOverflow = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - window.innerWidth;
      let overEls = 0; const ex = [];
      for (const el of document.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.width < 8 || r.height < 4) continue; if (r.right > vw + 2) { overEls++; if (ex.length < 3) { const t = (el.innerText || el.tagName).slice(0, 18); ex.push(`${el.tagName.toLowerCase()}"${t}" +${Math.round(r.right - vw)}px`); } } }
      return { docOverflow: Math.max(0, Math.round(docOverflow)), overflowingEls: overEls, examples: ex };
    }, w);
    byWidth[w] = m;
  }
  await p.close(); return byWidth;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const s = await sweep(ctx, source), c = await sweep(ctx, clone);
  await browser.close();
  const fails = []; const defects = []; let cleanWidths = 0;
  console.log('RESPONSIVE OVERFLOW (px past viewport — source | clone):');
  for (const w of WIDTHS) {
    const sd = s[w].docOverflow, cd = c[w].docOverflow;
    const cloneBad = cd > 4 && cd > sd + 4; // clone overflows where source doesn't
    if (!cloneBad) cleanWidths++;
    else { fails.push('overflow@' + w); defects.push(`@${w}px: clone overflows ${cd}px (source ${sd}px), ${c[w].overflowingEls} els e.g. ${c[w].examples[0] || ''}`); }
    console.log(`  ${String(w).padStart(4)}px   source ${String(sd).padStart(4)}   clone ${String(cd).padStart(4)}  ${cloneBad ? '✗ OVERFLOW' : ''}`);
  }
  const overall = Math.round((cleanWidths / WIDTHS.length) * 100);
  const report = { overall_pct: overall, clean_widths: cleanWidths, total_widths: WIDTHS.length, hard_fails: fails, defects, source: s, clone: c };
  fs.writeFileSync(path.join(out, 'responsive-report.json'), JSON.stringify(report, null, 2));
  console.log('\n' + JSON.stringify({ responsive_overall: overall, clean: `${cleanWidths}/${WIDTHS.length}`, hard_fails: fails, defects }, null, 2));
})();
