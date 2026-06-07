#!/usr/bin/env node
/**
 * @purpose ULTRA_PLAN Phase 1 — the INNER refine-loop: "grade your own work and improve until it's right",
 * autonomously, for ONE site. capture → build → grade-sections → repair the worst sections native can't
 * recover (per-section RASTER fallback, grader-directed) → re-grade → KEEP-IF-BETTER → until atTarget or
 * plateau. This is the grader-directed hybrid: native/editable where it works, raster (visual 1:1) where it
 * doesn't, chosen by MEASUREMENT not a static heuristic. keep-if-better is what makes it converge, not thrash.
 * Usage: node refine-loop.mjs --source <url> --page <id> [--max 4]
 */
import { spawn } from 'child_process';
import fs from 'fs';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source'), page = arg('page'), MAX = parseInt(arg('max', '4'), 10);
const base = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
if (!source || !page) { console.error('need --source --page'); process.exit(2); }
const slug = source.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 16).toLowerCase();
const layout = `/tmp/refine-layout-${slug}.json`;
const clone = `${base}/?page_id=${page}`;
const run = (args, log) => new Promise((res) => { const out = fs.openSync(log, 'w'); const p = spawn('node', args, { stdio: ['ignore', out, out], env: process.env }); p.on('close', (c) => { fs.closeSync(out); res(c); }); });
const KEEP_EPS = 0.004; // keep a change only if composite rises beyond measurement noise

async function build(rb, bb) { const a = ['build-absolute.mjs', '--layout', layout, '--page', page]; if (rb.length) a.push('--raster-bands', rb.map((b) => b.join('-')).join(',')); if (bb.length) a.push('--bg-bands', bb.map((b) => b.join('-')).join(',')); return run(a, `/tmp/refine-build-${slug}.log`); }
async function grade() { await run(['grade-sections.mjs', '--source', source, '--clone', clone, '--layout', layout, '--out', `/tmp/refine-grade-${slug}`], `/tmp/refine-grade-${slug}.log`); return JSON.parse(fs.readFileSync(`/tmp/refine-grade-${slug}/sections.json`, 'utf8')); }
const bandKey = (b) => b.join('-');

(async () => {
  console.log(`\n=== REFINE-LOOP ${source} → page ${page} (max ${MAX} rounds) ===`);
  console.log('• capture (ensemble best-of-3 — stable on dynamic sites)…'); await run(['capture-ensemble.mjs', '--source', source, '--out', layout, '--passes', '3'], `/tmp/refine-cap-${slug}.log`);

  let rBands = [], bBands = []; const traj = [];
  console.log('• round 0: full native build…'); await build(rBands, bBands); let best = await grade();
  traj.push({ round: 0, composite: best.composite, visual: best.visualMean, editability: best.editabilityMean, atTarget: best.atTarget });
  console.log(`  round 0: composite ${best.composite} (visual ${best.visualMean} edit ${best.editabilityMean}) atTarget ${best.atTarget} | ${best.sectionsFailing}/${best.sections} failing${best.wallRisk ? ' ⚠WALL' : ''}`);

  for (let round = 1; round <= MAX; round++) {
    if (best.atTarget) { console.log('  ✓ at target — done'); break; }
    const haveR = new Set(rBands.map(bandKey)), haveB = new Set(bBands.map(bandKey));
    // OPERATOR SELECTION by attribution: raster = sections native can't recover (editability<0.25);
    // perimeter-bg = sections with a color/background defect but text present (editability>=0.25).
    // raster ONLY genuinely-graphical sections (few source text runs) — NEVER text. Text sections native can't
    // recover stay as 'capture-lost-text' defects for the capture-recovery operator, not screenshotted.
    const rCands = best.rankedDefects.filter((d) => d.editability < 0.25 && (d.srcTextCount || 0) < 4 && !haveR.has(bandKey(d.yRange))).slice(0, 3).map((d) => d.yRange);
    const bCands = best.rankedDefects.filter((d) => d.why.includes('color/background') && d.editability >= 0.25 && !haveB.has(bandKey(d.yRange))).slice(0, 3).map((d) => d.yRange);
    if (!rCands.length && !bCands.length) { console.log('  plateau — no operator-improvable sections left'); break; }
    const tR = [...rBands, ...rCands], tB = [...bBands, ...bCands];
    console.log(`• round ${round}: raster+${rCands.length} [${rCands.map(bandKey).join(',')}] bg+${bCands.length} [${bCands.map(bandKey).join(',')}]…`);
    await build(tR, tB); const cand = await grade();
    if (cand.composite > best.composite + KEEP_EPS) {
      rBands = tR; bBands = tB; best = cand; traj.push({ round, composite: cand.composite, visual: cand.visualMean, editability: cand.editabilityMean, atTarget: cand.atTarget });
      console.log(`  KEPT: composite ${cand.composite} (visual ${cand.visualMean} edit ${cand.editabilityMean}) | ${cand.sectionsFailing} failing`);
    } else {
      console.log(`  REVERTED: composite ${cand.composite} ≤ ${best.composite}+${KEEP_EPS} (no gain) → rebuild best + stop`);
      await build(rBands, bBands); break;
    }
  }
  const bands = rBands;
  const blocked = best.rankedDefects.filter((d) => !(d.editability < 0.25) && !d.why.includes('color/background')).map((d) => ({ section: d.section, why: d.why, visual: d.visual, editability: d.editability }));
  console.log(`\n=== REFINE RESULT ===`);
  console.log(`final composite ${best.composite} | visual ${best.visualMean} edit ${best.editabilityMean} | atTarget ${best.atTarget} | ${rBands.length} rastered + ${bBands.length} bg-fixed`);
  console.log('trajectory:', traj.map((t) => `${t.round}:${t.composite}`).join(' → '));
  if (blocked.length) console.log(`blocked (not raster-fixable, need other operators): ${blocked.slice(0, 6).map((b) => '§' + b.section + '(' + b.why.join('/') + ')').join(', ')}`);
  console.log('PAGE:', clone);
  fs.writeFileSync(`/tmp/refine-result-${slug}.json`, JSON.stringify({ source, page, final: best.composite, atTarget: best.atTarget, rasteredBands: bands, trajectory: traj, blocked }, null, 2));
})();
