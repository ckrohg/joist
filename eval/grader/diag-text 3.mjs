#!/usr/bin/env node
/**
 * @purpose Split editable-text loss into CAPTURE-side vs BUILDER-side so we fix the dominant stage.
 * Compares 3 text sets: (1) SOURCE visible text runs, (2) layout.json captured text leaves, (3) the rendered
 * CLONE's selectable text. Reports capture-rate (layout∩source / source) + build-rate (clone∩layout / layout)
 * + example strings lost at each stage.
 * Usage: node diag-text.mjs --source <url> --layout layout.json --clone <cloneUrl>
 */
import fs from 'fs';
import { chromium } from 'playwright';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source'), layoutPath = arg('layout'), clone = arg('clone');
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const W = 1440;

async function pageTexts(ctx, url) {
  const p = await ctx.newPage(); await p.setViewportSize({ width: W, height: 900 });
  try { await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(url, { waitUntil: 'load', timeout: 30000 }); } catch {} }
  await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(1200);
  await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); } window.scrollTo(0, 0); });
  await p.waitForTimeout(600);
  const t = await p.evaluate(() => { const clean = (s) => (s || '').replace(/\s+/g, ' ').trim(); const out = []; const seen = new Set(); for (const e of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,span,li,div')) { const own = [...e.childNodes].some((n) => n.nodeType === 3 && clean(n.textContent)); if (!own) continue; const s = clean(e.innerText); if (!s || s.length > 200) continue; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05 || parseFloat(cs.fontSize) < 10) continue; const k = s.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(s); } return out; });
  await p.close(); return t;
}
function layoutTexts(L) { const out = []; const w = (n) => { if (!n) return; if (n.kind === 'container') (n.children || []).forEach(w); else if (n.text) out.push(n.text); }; w(L.root); return out; }

(async () => {
  const b = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
  const src = await pageTexts(ctx, source);
  const cln = await pageTexts(ctx, clone);
  await b.close();
  const L = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
  const lay = layoutTexts(L);
  const S = new Set(src.map(norm).filter((t) => t.length >= 4));
  const layJoined = ' ' + lay.map(norm).join(' | ') + ' ';
  const clnJoined = ' ' + cln.map(norm).join(' | ') + ' ';
  const inLay = (t) => layJoined.includes(t);
  const inCln = (t) => clnJoined.includes(t);
  let capOK = 0, buildOK = 0; const captureLost = [], buildLost = [];
  for (const t of S) {
    if (inLay(t)) { capOK++; if (inCln(t)) buildOK++; else if (buildLost.length < 14) buildLost.push(t); }
    else if (captureLost.length < 14) captureLost.push(t);
  }
  const n = S.size;
  console.log(JSON.stringify({
    sourceTextRuns: n, layoutTextLeaves: lay.length, cloneTextRuns: cln.length,
    captureRate: +(capOK / n).toFixed(3), buildRate: +(buildOK / Math.max(1, capOK)).toFixed(3), endToEnd: +(buildOK / n).toFixed(3),
    dominantLoss: (n - capOK) > (capOK - buildOK) ? 'CAPTURE' : 'BUILDER',
    captureLostExamples: captureLost, buildLostExamples: buildLost,
  }, null, 2));
})();
