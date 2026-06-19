#!/usr/bin/env node
/**
 * @purpose section-bounds.mjs — DOM-DRIVEN section segmentation source for region-judge. Extracts the TOP-LEVEL
 * section y-boundaries from a source page's live DOM (the box tree's top-level section containers), as FRACTIONS of
 * the page scroll-height so they survive height drift between capture and the frozen grader screenshot. region-judge's
 * segmentRegions consumes these so each grader region == one source section → the invisible-heading dark-ink guard
 * becomes robust (one heading per region; recoloring one heading drops THAT region's dark ink → veto fires).
 *
 * Two uses:
 *   (1) PRODUCTION: a live grader that already renders the source can call extractSectionBounds(page) when it
 *       screenshots, getting section seams in the SAME coordinate space as the shot.
 *   (2) CALIBRATION: this CLI captures a URL once and freezes a sidecar `<srcPng>.sections.json` (fractions), aligned
 *       to a frozen source PNG. judgePair/segmentRegions auto-loads `<sourcePng>.sections.json` when present.
 *
 * Section-finding heuristic (pixel-free, DOM-structural): descend from <body> through any single full-bleed wrapper
 * to the real content root, then take its direct children that span most of the width and carry real height as the
 * top-level sections. Robust on dense modern SaaS where whitespace-gutter pixel detection fails (the prior attempt).
 *
 * Usage (freeze a sidecar):
 *   node section-bounds.mjs --url https://supabase.com --src-png calibration/v2-shots/supabase-src-d.png
 *     [--out <path.sections.json>] [--width 1440] [--fold 1000]
 */
import fs from 'fs';
import path from 'path';
import url from 'url';

// ── the DOM walk (runs IN the page). Returns {docH, vw, sections:[{tag,top,height}]} in document coords. ──────────
// Exported as a string so callers can page.evaluate it without duplicating the logic.
export const SECTION_DOM_FN = `() => {
  const vw = window.innerWidth;
  const docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  const sy = window.scrollY;
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { top: r.top + sy, height: r.height, width: r.width }; };
  // Descend to the COARSEST level that yields a good multi-section vertical stack. Many sites wrap the whole page in
  // one or more single full-bleed wrappers (linear, framer) — descend THROUGH those (regardless of child count) until
  // the current root's children form >=3 full-width stacked blocks covering most of its height (the real sections).
  const minSec = Math.max(40, docH * 0.015);
  const MAX_SEC = docH * 0.33;                                                     // no real section spans a third of the page
  function segment(root, depth) {
    const kids = [...root.children].filter(vis);
    if (!kids.length) return null;
    const rr = rectOf(root);
    const stacked = kids.filter((k) => rectOf(k).width >= vw * 0.7 && rectOf(k).height >= minSec);
    const cover = stacked.reduce((s, k) => s + rectOf(k).height, 0);
    if (stacked.length >= 3 && cover >= rr.height * 0.55) {                        // good segmentation here…
      const result = [];                                                          // …but recursively subdivide oversized members
      for (const k of stacked) {
        if (rectOf(k).height > MAX_SEC && depth < 14) { const sub = segment(k, depth + 1); if (sub && sub.length >= 2) { result.push(...sub); continue; } }
        result.push(k);
      }
      return result;
    }
    if (depth < 14) {                                                              // else dive into the dominant child
      const dom = kids.slice().sort((a, b) => { const ra = rectOf(a), rb = rectOf(b); return rb.width * rb.height - ra.width * ra.height; })[0];
      const rd = rectOf(dom);
      if (rd.width >= vw * 0.7 && rd.height >= rr.height * 0.5) { const deeper = segment(dom, depth + 1); if (deeper) return deeper; }
    }
    return stacked.length >= 2 ? stacked : null;                                   // shallow fallback (2 blocks)
  }
  const secEls = segment(document.body, 0) || [];
  const sections = secEls.map((c) => { const r = rectOf(c); return { tag: c.tagName.toLowerCase(), top: Math.round(r.top), height: Math.round(r.height) }; })
    .filter((s) => s.height >= 40 && s.top >= -5);
  return { docH, vw, sections };
}`;

// Normalize a raw DOM result into a clean, monotone, gap-free list of section TOP fractions (0..1), plus 1.0 (bottom).
// Coalesces overlaps, fills gaps to the next section's top, drops slivers. Returns { fracs:[...], sections:[{...}] }.
export function normalizeSections(raw, { minFrac = 0.012 } = {}) {
  const H = raw.docH || 1;
  let secs = (raw.sections || []).map((s) => ({ tag: s.tag, top: s.top / H, bottom: (s.top + s.height) / H }))
    .filter((s) => s.bottom > s.top)
    .sort((a, b) => a.top - b.top);
  // clamp + dedupe near-identical tops; make tops strictly increasing.
  const out = [];
  for (const s of secs) {
    const top = Math.max(0, Math.min(1, s.top));
    if (out.length && top - out[out.length - 1].top < minFrac) continue; // too close to previous seam → skip
    out.push({ tag: s.tag, top });
  }
  if (!out.length || out[0].top > minFrac) out.unshift({ tag: 'top', top: 0 }); // ensure a section starts at 0
  const fracs = out.map((s) => s.top);
  if (fracs[0] !== 0) fracs.unshift(0);
  // ensure terminating bottom at 1.0
  if (fracs[fracs.length - 1] < 1 - minFrac) fracs.push(1);
  return { fracs: fracs.filter((v, i, a) => i === 0 || v - a[i - 1] >= minFrac / 2), tags: out.map((s) => s.tag), docH: H };
}

// STRUCTURAL-HEALTH GATE: a captured section map is only TRUSTWORTHY when it actually partitions the page into real
// sections. A dynamic/scroll-hydrated source (framer) materializes only its top few sections → the rest collapses into
// one giant band; trusting that would mis-place the heading probe. Reject (→ caller falls back to proportional banding,
// the current behavior, no regression). Healthy = enough bands AND no single band swallows half the page.
export function sectionHealth(fracs, { minBands = 4, maxBandFrac = 0.5, minBandFrac = 0.02 } = {}) {
  const heights = [];
  for (let i = 0; i < fracs.length - 1; i++) heights.push(fracs[i + 1] - fracs[i]);
  const realBands = heights.filter((h) => h >= minBandFrac).length;
  const maxBand = heights.length ? Math.max(...heights) : 1;
  const healthy = realBands >= minBands && maxBand <= maxBandFrac;
  return { healthy, realBands, maxBand: +maxBand.toFixed(3), reason: healthy ? 'ok' : (realBands < minBands ? `only ${realBands} real bands (<${minBands})` : `band ${(+maxBand.toFixed(3))} > ${maxBandFrac} of page`) };
}

// Map normalized section TOP fractions → grader source-PNG y-bands [{ y0, y1 }] for a png of height srcH.
export function sectionBandsForHeight(fracs, srcH) {
  const ys = fracs.map((f) => Math.round(f * srcH));
  const bands = [];
  for (let i = 0; i < ys.length - 1; i++) if (ys[i + 1] - ys[i] >= 24) bands.push({ y0: ys[i], y1: ys[i + 1] });
  return bands;
}

// ── CLI: capture a URL, freeze a sidecar aligned to a frozen source PNG ───────────────────────────────────────────
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (IS_MAIN) (async () => {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
  const has = (k) => process.argv.includes('--' + k);
  const URL = arg('url'); const SRC_PNG = arg('src-png'); const WIDTH = +arg('width', 1440);
  if (!URL) { console.error('usage: node section-bounds.mjs --url <src> --src-png <frozen.png> [--out <sidecar>] [--width 1440]'); process.exit(2); }
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: 1 });
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // lazy-settle: step-scroll to the bottom so deferred sections hydrate, then back to top.
    await page.waitForTimeout(1200);
    const H = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < H; y += 800) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(120); }
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400);
    const raw = await page.evaluate(eval(SECTION_DOM_FN));
    const norm = normalizeSections(raw);
    const health = sectionHealth(norm.fracs);
    console.log(`docH=${raw.docH} vw=${raw.vw} rawSections=${raw.sections.length} → ${norm.fracs.length - 1} bands  health=${health.healthy ? 'OK' : 'REJECT(' + health.reason + ')'}`);
    console.log('section tops (frac):', norm.fracs.map((f) => f.toFixed(3)).join(' '));
    console.log('tags:', norm.tags.join(' '));
    let outPath = arg('out');
    if (!outPath && SRC_PNG) outPath = path.resolve(HERE, SRC_PNG).replace(/\.png$/, '') + '.sections.json';
    if (!health.healthy && !has('force')) {
      console.log(`\nNOT writing sidecar — unhealthy section map (${health.reason}). This source falls back to proportional banding (no regression). Use --force to override.`);
      return;
    }
    if (outPath) {
      const sidecar = { url: URL, width: WIDTH, capturedDocH: raw.docH, fracs: norm.fracs, tags: norm.tags, rawSections: raw.sections };
      fs.writeFileSync(outPath, JSON.stringify(sidecar, null, 2));
      console.log(`sidecar → ${outPath}`);
      if (SRC_PNG) {
        const { PNG } = await import('pngjs');
        const png = PNG.sync.read(fs.readFileSync(path.resolve(HERE, SRC_PNG)));
        const bands = sectionBandsForHeight(norm.fracs, png.height);
        console.log(`\nALIGNMENT to ${SRC_PNG} (h=${png.height}): ${bands.length} bands`);
        for (const b of bands) console.log(`  y[${b.y0}..${b.y1}]  (h=${b.y1 - b.y0})`);
        console.log(`(L2 invis-heading recolor band = y[${(0.08 * png.height) | 0}..${(0.24 * png.height) | 0}])`);
      }
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAILED:', e && e.stack || e); process.exit(1); });
