#!/usr/bin/env node
/**
 * @purpose Artifact-prep for the ADVERSARIAL VISION COMMITTEE grader (MACHINE_AUDIT P0+).
 * The deterministic 6-marker grader is only the provable FLOOR; real fidelity judgment needs
 * vision agents reviewing source-vs-clone element-by-element. This script captures the inputs
 * that committee needs and writes a manifest; the orchestrator then spawns N vision subagents
 * (each Reads the crop pairs + the harsh rubric) and aggregates.
 *
 * Produces, in --out: full screenshots of source & clone at desktop/tablet/mobile, and
 * per-section SIDE-BY-SIDE crops (source LEFT | clone RIGHT) so a judge compares aligned
 * regions, not a whole page it can rationalize. Writes manifest.json + the committee rubric.
 *
 * Usage: node committee-grade.mjs --source <url> --clone <url> [--out dir]
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const source = arg('source'), clone = arg('clone'); const out = arg('out', './committee-out');
if (!has('aggregate') && (!source || !clone)) { console.error('need --source --clone (or --aggregate <verdicts.json>)'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const VPS = [{ n: 'desktop', w: 1440 }, { n: 'tablet', w: 768 }, { n: 'mobile', w: 390 }];

function band(full, y0, y1) { const y = Math.max(0, Math.round(y0)); const h = Math.max(2, Math.min(full.height - y, Math.round(y1 - y0))); const o = new PNG({ width: full.width, height: h }); for (let r = 0; r < h; r++) { const s = ((y + r) * full.width) * 4; o.data.set(full.data.subarray(s, s + full.width * 4), (r * full.width) * 4); } return o; }
function sideBySide(a, b, p, label) { const gap = 16, H = Math.max(a.height, b.height); const o = new PNG({ width: a.width + b.width + gap, height: H }); o.data.fill(245); const blit = (s, ox) => { for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) { const si = (y * s.width + x) * 4, di = (y * o.width + x + ox) * 4; o.data[di] = s.data[si]; o.data[di + 1] = s.data[si + 1]; o.data[di + 2] = s.data[si + 2]; o.data[di + 3] = 255; } }; blit(a, 0); blit(b, a.width + gap); fs.writeFileSync(p, PNG.sync.write(o)); return p; }

async function cap(ctx, url, w) { const p = await ctx.newPage(); await p.setViewportSize({ width: w, height: 900 }); try { await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(url, { waitUntil: 'load', timeout: 30000 }); } catch {} } await p.waitForTimeout(1500); await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 90)); } window.scrollTo(0, 0); }); await p.waitForTimeout(400); let bands = []; if (w === 1440) bands = await p.evaluate(() => { const vw = innerWidth, out = []; for (const e of document.querySelectorAll('section,header,footer,main,div')) { const r = e.getBoundingClientRect(); const top = r.top + scrollY; if (r.width < vw * 0.85 || r.height < 140 || r.height > 4000) continue; if (out.some((b) => Math.min(top + r.height, b.y + b.h) - Math.max(top, b.y) > 0.5 * Math.min(r.height, b.h))) continue; out.push({ y: Math.round(top), h: Math.round(r.height) }); } return out.sort((a, b) => a.y - b.y).slice(0, 8); }); const shot = PNG.sync.read(await p.screenshot({ fullPage: true })); await p.close(); return { shot, bands }; }

// --aggregate <verdicts.json> [--floor <pct>]: deterministically combine committee verdicts
// (the array of per-reviewer JSONs) + the grader-v2 deterministic floor into ONE verdict.
if (has('aggregate')) {
  const verdicts = JSON.parse(fs.readFileSync(arg('aggregate'), 'utf8'));
  const floor = parseInt(arg('floor', '100'), 10);
  const dims = {}; for (const v of verdicts) for (const [k, val] of Object.entries(v.dimensions || {})) dims[k] = Math.min(dims[k] ?? 100, val);
  const overall = Math.min(floor, ...verdicts.map((v) => v.overall_pct ?? 100)); // MIN — harshest reviewer + deterministic floor both cap
  const verdict = (overall >= 75 && verdicts.every((v) => v.verdict === 'PASS')) ? 'PASS' : 'FAIL';
  const allDefects = verdicts.flatMap((v, i) => (v.defects || []).map((d) => ({ d, r: i + 1 })));
  // confirmed = a defect whose first ~6 significant words overlap another reviewer's defect
  const sig = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 3).slice(0, 6);
  const confirmed = []; for (let i = 0; i < allDefects.length; i++) for (let j = i + 1; j < allDefects.length; j++) { if (allDefects[i].r === allDefects[j].r) continue; const a = sig(allDefects[i].d), b = new Set(sig(allDefects[j].d)); if (a.filter((w) => b.has(w)).length >= 2 && !confirmed.some((c) => c.d === allDefects[i].d)) confirmed.push(allDefects[i]); }
  const report = { overall_pct: overall, verdict, dimensions: dims, reviewers: verdicts.length, confirmed_defects: confirmed.map((c) => c.d).slice(0, 15), all_defects: allDefects.map((x) => `[r${x.r}] ${x.d}`).slice(0, 40), worst_sections: verdicts.map((v) => v.worst_section).filter(Boolean) };
  console.log(JSON.stringify(report, null, 2));
  process.exit(verdict === 'PASS' ? 0 : 1);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const manifest = { source, clone, viewports: {}, sections: [] };
  let srcBands = [];
  for (const vp of VPS) {
    const s = await cap(ctx, source, vp.w), c = await cap(ctx, clone, vp.w);
    if (vp.n === 'desktop') srcBands = s.bands;
    const sP = path.join(out, `src-${vp.n}.png`), cP = path.join(out, `cln-${vp.n}.png`);
    fs.writeFileSync(sP, PNG.sync.write(s.shot)); fs.writeFileSync(cP, PNG.sync.write(c.shot));
    const pair = sideBySide(s.shot, c.shot, path.join(out, `pair-${vp.n}.png`));
    manifest.viewports[vp.n] = { source: sP, clone: cP, pair, srcH: s.shot.height, clnH: c.shot.height };
    if (vp.n === 'desktop') manifest._sc = { s: s.shot, c: c.shot };
  }
  // per-section side-by-side crops at desktop (proportional clone slice)
  const sShot = PNG.sync.read(fs.readFileSync(path.join(out, 'src-desktop.png')));
  const cShot = PNG.sync.read(fs.readFileSync(path.join(out, 'cln-desktop.png')));
  srcBands.forEach((b, i) => { const sCrop = band(sShot, b.y, b.y + b.h); const cy0 = b.y / sShot.height * cShot.height, cy1 = (b.y + b.h) / sShot.height * cShot.height; const cCrop = band(cShot, cy0, cy1); const p = sideBySide(sCrop, cCrop, path.join(out, `section-${i}.png`)); manifest.sections.push({ i, y: b.y, h: b.h, pair: p }); });
  delete manifest._sc;
  await browser.close();

  manifest.committee_rubric = `You are one member of an ADVERSARIAL fidelity committee judging a website CLONE against the ORIGINAL. Each image is SOURCE (left) | CLONE (right). Be harsh and specific — your job is to find every flaw.\n\nReview ELEMENT BY ELEMENT and section by section: nav/header, hero headline, subhead, CTAs/buttons, each content section, cards, images, footer. For EACH element compare: presence (missing/extra?), position & ALIGNMENT, size, SPACING/padding, TYPOGRAPHY (font family, weight, size, line-height), COLOR (incl. gradients — is a gradient rendered as flat/wrong color?), background, effects/shadows. Also judge overall LAYOUT fidelity and, across the desktop/tablet/mobile pairs, RESPONSIVENESS (does the clone adapt like the source, or is it broken/overflowing on tablet/mobile?).\n\nDYNAMICS: if you are given scroll-*.png (source|clone at increasing scroll depths), hover-*.png (source row over clone row, before|after hover), or time-lapse strips, judge MOTION & INTERACTION too: scroll-triggered reveals/parallax/sticky behavior, looping motion (animated gradients, marquees, auto-carousels, count-up tickers), and hover/focus states. A clone that is visually close but DEAD (no motion where the source clearly moves, no hover reaction) is a FAIL on the 'motion' dimension — call it out explicitly.\n\nFIRST enumerate EVERY concrete difference you can see (e.g. 'clone headline is flat green, source is navy→purple gradient'; 'clone subhead overlaps the next section'; 'mobile clone overflows the viewport'; 'source hero gradient animates, clone is a static fill'). THEN score. Start at 100 and SUBTRACT points per defect; you must justify any points you do NOT subtract. Default to 'different/worse' when unsure. Do not be agreeable.\n\nReturn STRICT JSON: {"overall_pct": int, "dimensions": {"alignment": int, "spacing": int, "typography": int, "color": int, "imagery": int, "responsiveness": int, "motion": int, "completeness": int}, "defects": ["..."], "verdict": "PASS|FAIL", "worst_section": "..."}. If you were given NO dynamic artifacts, set "motion": 100 and note that motion was not assessed. PASS only if a designer comparing the two tabs could not quickly tell which is the clone.`;
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('artifacts ready in', out);
  console.log('viewport pairs:', Object.values(manifest.viewports).map((v) => path.basename(v.pair)).join(', '));
  console.log('section pairs:', manifest.sections.length);
  console.log('\nSpawn the committee: N vision agents, each Read the pair-*.png + section-*.png and apply manifest.committee_rubric, return the JSON. Aggregate: per-dimension MIN, union defects (>=2 agents = confirmed), overall = min(committee, deterministic grader-v2).');
})();
