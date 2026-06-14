#!/usr/bin/env node
/**
 * @purpose Non-visual eval layers the visual grader is blind to (EVAL_COVERAGE_MAP §D,E):
 * PERFORMANCE (load speed — user-flagged P1) + FUNCTION/INTEGRITY. Measures both SOURCE and
 * CLONE and compares, because a clone that is pixel-perfect but 3x slower or throwing console
 * errors is NOT a faithful build. Read-only (no writes).
 *
 *   Performance: TTFB, DOMContentLoaded, load, LCP, CLS, total transfer weight, request count + by-type.
 *   Integrity:   console errors, failed (4xx/5xx) requests, broken images, fonts actually loaded.
 *
 * Scoring: Core-Web-Vitals absolute gates (LCP<2.5s, CLS<0.1) AND clone-vs-source relative
 * (clone shouldn't be much slower/heavier than the original). MIN-aggregated, like the rest.
 *
 * Usage: node perf-grade.mjs --source <url> --clone <url> [--out dir]
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { assertAllowedBase, assertNotBlocked } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: refuse a stray (e.g. paused *.sg-host.com) URL before any navigation.

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source'), clone = arg('clone'), out = arg('out', './perf-out');
if (!source || !clone) { console.error('need --source --clone'); process.exit(2); }
// §0 SAFETY GUARD: assert every http(s) URL arg targets a training host (blocks the paused shared host) BEFORE any chromium.goto.
if (clone && /^https?:/i.test(clone)) assertAllowedBase(clone); if (source && /^https?:/i.test(source)) assertNotBlocked(source); /* source = external read-only; only the paused host is blocked */
fs.mkdirSync(out, { recursive: true });

async function measure(ctx, url) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  // observers must exist before page scripts paint/shift
  await page.addInitScript(() => {
    window.__lcp = 0; window.__cls = 0;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}
  });
  const consoleErrors = []; const pageErrors = []; const failed = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => pageErrors.push((e.message || '').slice(0, 160)));
  page.on('response', (r) => { const s = r.status(); if (s >= 400) failed.push(`${s} ${r.url().slice(0, 90)}`); });
  const t0 = Date.now();
  try { await page.goto(url, { waitUntil: 'load', timeout: 60000 }); } catch {}
  // settle: scroll to trigger lazy content + late shifts, then let LCP/CLS finalize
  await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const res = performance.getEntriesByType('resource');
    let weight = (nav.transferSize || 0); const byType = {}; let count = 1;
    for (const r of res) { weight += r.transferSize || 0; count++; const k = r.initiatorType || 'other'; byType[k] = (byType[k] || 0) + 1; }
    const imgs = [...document.querySelectorAll('img')];
    const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0).length;
    let fontsLoaded = 0; try { document.fonts.forEach((f) => { if (f.status === 'loaded') fontsLoaded++; }); } catch {}
    return {
      ttfb: Math.round(nav.responseStart || 0), dcl: Math.round(nav.domContentLoadedEventEnd || 0), load: Math.round(nav.loadEventEnd || 0),
      lcp: Math.round(window.__lcp || 0), cls: +(window.__cls || 0).toFixed(3),
      weightKB: Math.round(weight / 1024), requests: count, byType, images: imgs.length, brokenImages: broken, fontsLoaded,
    };
  });
  m.wallMs = Date.now() - t0; m.consoleErrors = consoleErrors.length; m.pageErrors = pageErrors.length; m.failedRequests = failed.length;
  m._failedSample = failed.slice(0, 5); m._consoleSample = [...consoleErrors, ...pageErrors].slice(0, 5);
  await page.close();
  return m;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const s = await measure(ctx, source), c = await measure(ctx, clone);
  await browser.close();

  const D = {}; const fails = []; const defects = [];
  // PERFORMANCE — absolute CWV gates + relative-to-source. clamp helper: 1 good → 0 bad.
  const cwvLcp = c.lcp <= 2500 ? 1 : c.lcp <= 4000 ? 0.6 : 0.3;
  const cwvCls = c.cls <= 0.1 ? 1 : c.cls <= 0.25 ? 0.6 : 0.3;
  const rel = (cl, sr) => sr <= 0 ? 1 : Math.max(0, Math.min(1, 1 - Math.max(0, (cl - sr) / sr - 0.25) / 2)); // tolerate 25% slower/heavier, then decay
  D.lcp = +Math.min(cwvLcp, rel(c.lcp, s.lcp)).toFixed(3);
  D.cls = +cwvCls.toFixed(3);
  D.load = +rel(c.load || c.wallMs, s.load || s.wallMs).toFixed(3);
  D.weight = +rel(c.weightKB, s.weightKB).toFixed(3);
  if (c.lcp > 4000) { fails.push('lcp'); defects.push(`clone LCP ${c.lcp}ms (>4s; source ${s.lcp}ms)`); }
  if (c.cls > 0.25) { fails.push('cls'); defects.push(`clone CLS ${c.cls} (>0.25; source ${s.cls})`); }
  if (s.weightKB > 0 && c.weightKB > s.weightKB * 2) { fails.push('weight'); defects.push(`clone ${c.weightKB}KB vs source ${s.weightKB}KB (>2x)`); }
  if (s.lcp > 0 && c.lcp > s.lcp * 2 && c.lcp > 2500) { fails.push('slow'); defects.push(`clone LCP ${c.lcp}ms is >2x source ${s.lcp}ms`); }
  // INTEGRITY / FUNCTION
  D.integrity = 1;
  if (c.consoleErrors + c.pageErrors > 0) { D.integrity = Math.min(D.integrity, 0.5); fails.push('js-errors'); defects.push(`clone has ${c.consoleErrors} console + ${c.pageErrors} JS errors (e.g. ${(c._consoleSample[0] || '').slice(0, 70)})`); }
  if (c.failedRequests > 0) { D.integrity = Math.min(D.integrity, 0.5); fails.push('failed-requests'); defects.push(`clone has ${c.failedRequests} failed (4xx/5xx) requests (e.g. ${c._failedSample[0] || ''})`); }
  if (c.brokenImages > 0) { D.integrity = Math.min(D.integrity, 0.4); fails.push('broken-images'); defects.push(`clone has ${c.brokenImages} broken images (naturalWidth 0)`); }

  const overall = Math.round(Math.min(D.lcp, D.cls, D.load, D.weight, D.integrity) * 100);
  const report = { overall_pct: overall, dims: D, hard_fails: fails, defects, source: s, clone: c };
  fs.writeFileSync(path.join(out, 'perf-report.json'), JSON.stringify(report, null, 2));
  const row = (label, sv, cv, u = '') => `  ${label.padEnd(16)} source ${String(sv).padStart(8)}${u}   clone ${String(cv).padStart(8)}${u}`;
  console.log('PERFORMANCE + INTEGRITY (source vs clone):');
  console.log(row('LCP', s.lcp, c.lcp, 'ms'));
  console.log(row('CLS', s.cls, c.cls));
  console.log(row('load', s.load || s.wallMs, c.load || c.wallMs, 'ms'));
  console.log(row('TTFB', s.ttfb, c.ttfb, 'ms'));
  console.log(row('weight', s.weightKB, c.weightKB, 'KB'));
  console.log(row('requests', s.requests, c.requests));
  console.log(row('console err', s.consoleErrors + s.pageErrors, c.consoleErrors + c.pageErrors));
  console.log(row('failed reqs', s.failedRequests, c.failedRequests));
  console.log(row('broken imgs', s.brokenImages, c.brokenImages));
  console.log('\n' + JSON.stringify({ perf_overall: overall, dims: D, hard_fails: fails, defects }, null, 2));
})();
