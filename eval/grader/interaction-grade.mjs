#!/usr/bin/env node
/**
 * @purpose Click-to-reveal interaction eval layer (EVAL_COVERAGE_MAP §C5). The dynamic grader
 * covers auto-motion/scroll/hover; this covers INTERACTION that requires a click: tabs,
 * accordions, dropdowns, modals, FAQ toggles, click-carousels. Method: find candidate triggers,
 * click each, measure whether the DOM/visual meaningfully changed (something revealed), and
 * compare how many triggers are REACTIVE on source vs clone. A clone whose tabs/accordions are
 * dead (static screenshots of one state) fails here even when it looks pixel-right at rest.
 * Read-only. Usage: node interaction-grade.mjs --source <url> --clone <url> [--out dir]
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { assertAllowedBase, assertNotBlocked } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: refuse a stray (e.g. paused *.sg-host.com) URL before any navigation.
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source'), clone = arg('clone'), out = arg('out', './interaction-out');
if (!source || !clone) { console.error('need --source --clone'); process.exit(2); }
// §0 SAFETY GUARD: assert every http(s) URL arg targets a training host (blocks the paused shared host) BEFORE any chromium.goto.
if (clone && /^https?:/i.test(clone)) assertAllowedBase(clone); if (source && /^https?:/i.test(source)) assertNotBlocked(source); /* source = external read-only; only the paused host is blocked */
fs.mkdirSync(out, { recursive: true });

async function probe(ctx, url) {
  const p = await ctx.newPage(); await p.setViewportSize({ width: 1440, height: 900 });
  try { await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(url, { waitUntil: 'load', timeout: 30000 }); } catch {} }
  await p.waitForTimeout(1200);
  // candidate triggers anywhere on the FULL page (tag each so we can scroll it into view before
  // clicking — the old top-4000px filter under-counted lower-page disclosures like <details>).
  const count = await p.evaluate(() => {
    const sel = '[aria-expanded],[aria-controls],[role=tab],summary,details>summary,[data-toggle],[data-tab],.accordion,.tab,button[aria-haspopup]';
    const seen = new Set(); let n = 0;
    for (const e of document.querySelectorAll(sel)) { const r = e.getBoundingClientRect(); if (r.width < 8 || r.height < 8) continue; const k = Math.round(r.left) + ':' + Math.round(r.top + scrollY); if (seen.has(k)) continue; seen.add(k); e.setAttribute('data-ixp', String(n++)); if (n >= 16) break; }
    return n;
  });
  let reactive = 0; const details = [];
  for (let i = 0; i < count; i++) {
    try {
      const t = await p.evaluate((ix) => { const e = document.querySelector(`[data-ixp="${ix}"]`); if (!e) return null; e.scrollIntoView({ block: 'center' }); return { tag: e.tagName.toLowerCase(), label: (e.innerText || e.getAttribute('aria-label') || '').slice(0, 24) }; }, i);
      if (!t) continue;
      const before = await p.evaluate(() => ({ len: document.body.innerHTML.length, expanded: document.querySelectorAll('[aria-expanded=true]').length, open: document.querySelectorAll('[open],.is-open,.active,.show').length }));
      // click the element ITSELF (robust to overlays/coords; verified el.click() toggles <details> where mouse-coords missed)
      await p.evaluate((ix) => { const e = document.querySelector(`[data-ixp="${ix}"]`); if (e) e.click(); }, i); await p.waitForTimeout(400);
      const after = await p.evaluate(() => ({ len: document.body.innerHTML.length, expanded: document.querySelectorAll('[aria-expanded=true]').length, open: document.querySelectorAll('[open],.is-open,.active,.show').length }));
      if (Math.abs(after.len - before.len) > 40 || after.expanded !== before.expanded || after.open !== before.open) { reactive++; details.push(`${t.tag}"${t.label}" reacted`); }
    } catch {}
  }
  await p.close(); return { candidates: count, reactive, details };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const s = await probe(ctx, source), c = await probe(ctx, clone);
  await browser.close();
  const fails = []; const defects = [];
  // relative: clone should reproduce the source's interactive richness
  const score = s.reactive === 0 ? 1 : Math.min(1, c.reactive / s.reactive);
  if (s.reactive >= 2 && c.reactive < s.reactive * 0.5) { fails.push('interactions-missing'); defects.push(`source has ${s.reactive} reactive click-triggers (of ${s.candidates}), clone ${c.reactive} (of ${c.candidates}) — tabs/accordions/dropdowns likely dead`); }
  const overall = Math.round(score * 100);
  const report = { overall_pct: overall, hard_fails: fails, defects, source: s, clone: c };
  fs.writeFileSync(path.join(out, 'interaction-report.json'), JSON.stringify(report, null, 2));
  console.log('CLICK-TO-REVEAL INTERACTIONS (source vs clone):');
  console.log(`  candidates  source ${s.candidates}   clone ${c.candidates}`);
  console.log(`  reactive    source ${s.reactive}   clone ${c.reactive}`);
  if (s.details.length) console.log('  source reacted:', s.details.slice(0, 4).join(' | '));
  console.log('\n' + JSON.stringify({ interaction_overall: overall, hard_fails: fails, defects }, null, 2));
})();
