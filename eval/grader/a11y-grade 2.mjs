#!/usr/bin/env node
/**
 * @purpose Accessibility eval layer (EVAL_COVERAGE_MAP §G). A pixel-perfect clone that fails
 * WCAG is not "perfect". Grades, source-vs-clone + absolute WCAG gates:
 *   - contrast: every visible text node's color vs its nearest opaque background (WCAG AA: 4.5, or
 *               3.0 for large text >=24px or >=18.66px bold)
 *   - alt:      images missing alt (excluding aria-hidden / role=presentation)
 *   - semantics: document lang, landmarks (header/nav/main/footer), exactly one h1, no heading skips
 * Read-only. Usage: node a11y-grade.mjs --source <url> --clone <url> [--out dir]
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source'), clone = arg('clone'), out = arg('out', './a11y-out');
if (!source || !clone) { console.error('need --source --clone'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });

async function audit(ctx, url) {
  const p = await ctx.newPage(); await p.setViewportSize({ width: 1440, height: 900 });
  try { await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(url, { waitUntil: 'load', timeout: 30000 }); } catch {} }
  await p.waitForTimeout(1200);
  const r = await p.evaluate(() => {
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const parse = (s) => { const m = (s || '').match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s]+([\d.]+))?/); return m ? [+m[1], +m[2], +m[3], m[4] != null ? +m[4] : 1] : null; };
    const opaqueBg = (el) => { let n = el; while (n && n !== document.documentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] >= 0.5) return c; n = n.parentElement; } return [255, 255, 255, 1]; };
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.1; };
    const ratio = (a, b) => { const l1 = lum(a[0], a[1], a[2]), l2 = lum(b[0], b[1], b[2]); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    // contrast
    let textNodes = 0, lowContrast = 0; const cExamples = [];
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,span,li')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); if (!own || !vis(el)) continue;
      const cs = getComputedStyle(el); const fg = parse(cs.color); if (!fg) continue; const bg = opaqueBg(el);
      const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700; const large = size >= 24 || (bold && size >= 18.66);
      const need = large ? 3.0 : 4.5; const cr = ratio(fg, bg); textNodes++;
      if (cr < need) { lowContrast++; if (cExamples.length < 5) cExamples.push(`"${el.innerText.slice(0, 22)}" ${cr.toFixed(1)}:1 (need ${need})`); }
    }
    // alt
    const imgs = [...document.querySelectorAll('img')].filter(vis);
    const noAlt = imgs.filter((i) => !i.getAttribute('alt') && i.getAttribute('role') !== 'presentation' && i.getAttribute('aria-hidden') !== 'true').length;
    // semantics
    const lang = !!document.documentElement.getAttribute('lang');
    const landmarks = ['header', 'nav', 'main', 'footer'].filter((t) => document.querySelector(t + ',[role=' + ({ header: 'banner', nav: 'navigation', main: 'main', footer: 'contentinfo' }[t]) + ']')).length;
    const h1s = document.querySelectorAll('h1').length;
    const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => +h.tagName[1]); let skips = 0; for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) skips++;
    return { textNodes, lowContrast, contrastExamples: cExamples, images: imgs.length, noAlt, lang, landmarks, h1s, headingSkips: skips };
  });
  await p.close(); return r;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const s = await audit(ctx, source), c = await audit(ctx, clone);
  await browser.close();
  const D = {}; const fails = []; const defects = [];
  // contrast: fraction of text passing; relative to source (clone shouldn't introduce new failures)
  const cPass = c.textNodes ? 1 - c.lowContrast / c.textNodes : 1; const sPass = s.textNodes ? 1 - s.lowContrast / s.textNodes : 1;
  D.contrast = +Math.min(1, cPass / Math.max(0.01, sPass)).toFixed(3);
  if (c.lowContrast > Math.max(2, s.lowContrast * 1.2)) { fails.push('contrast'); defects.push(`${c.lowContrast}/${c.textNodes} text nodes below WCAG (source ${s.lowContrast}/${s.textNodes}); e.g. ${c.contrastExamples[0] || ''}`); }
  // alt — ABSOLUTE check (a clone with most images altless fails regardless of how bad the source is)
  D.alt = c.images ? +Math.max(0, 1 - c.noAlt / c.images).toFixed(3) : 1;
  if (c.images >= 3 && c.noAlt / c.images > 0.3) { fails.push('alt'); defects.push(`${c.noAlt}/${c.images} clone images missing alt (${Math.round(c.noAlt / c.images * 100)}%; source ${s.noAlt}/${s.images})`); }
  // semantics
  let sem = 1; const semIssues = [];
  if (!c.lang) { sem -= 0.3; semIssues.push('no <html lang>'); }
  if (c.landmarks < 2) { sem -= 0.3; semIssues.push(`only ${c.landmarks} landmarks`); }
  if (c.h1s !== 1) { sem -= 0.2; semIssues.push(`${c.h1s} h1s (want 1)`); }
  if (c.headingSkips > 0) { sem -= 0.2; semIssues.push(`${c.headingSkips} heading-level skips`); }
  D.semantics = +Math.max(0, sem).toFixed(3);
  if (semIssues.length) defects.push('semantics: ' + semIssues.join(', '));
  // HONESTY GUARD: never report a tanked dimension with no defect (the misleading "0% / 0 defects").
  for (const [k, v] of Object.entries(D)) if (v < 0.5 && !defects.some((d) => d.toLowerCase().includes(k))) { if (!fails.includes(k)) fails.push(k); defects.push(`${k} dimension is ${v} but produced no specific defect — investigate (honesty guard)`); }
  const overall = Math.round(Math.min(D.contrast, D.alt, D.semantics) * 100);
  const report = { overall_pct: overall, dims: D, hard_fails: fails, defects, source: s, clone: c };
  fs.writeFileSync(path.join(out, 'a11y-report.json'), JSON.stringify(report, null, 2));
  console.log('ACCESSIBILITY (source vs clone):');
  console.log(`  contrast fails   source ${s.lowContrast}/${s.textNodes}   clone ${c.lowContrast}/${c.textNodes}`);
  console.log(`  imgs missing alt source ${s.noAlt}/${s.images}   clone ${c.noAlt}/${c.images}`);
  console.log(`  lang/landmarks/h1 source ${s.lang}/${s.landmarks}/${s.h1s}   clone ${c.lang}/${c.landmarks}/${c.h1s}`);
  console.log('\n' + JSON.stringify({ a11y_overall: overall, dims: D, hard_fails: fails, defects }, null, 2));
})();
