#!/usr/bin/env node
/**
 * @purpose Single end-to-end CLONE entry point — consolidates the validated pipeline so it's one command,
 * not scattered scripts. Orchestrates: capture-layout (robust DOM box-tree) → build (chosen mode) →
 * grade-structure (visual + editability objective) → report composite + page URL.
 *
 * Modes (see knowledge/CLONE_PIPELINE.md for when each wins):
 *   absolute (default) — absolute-positioned NATIVE widgets: 1:1 structure + editable. Best on most sites.
 *   hybrid             — editable simple sections + rastered hard sections. Fallback when capture collapses.
 *   raster             — full section-raster: 1:1 visual, 0 editable. Fallback for headless-unrenderable sites.
 *
 * Usage: node clone.mjs --source <url> --page <id> [--mode absolute|hybrid|raster] [--no-grade]
 * Env: JOIST_AUTH_B64 (source /tmp/joist-auth.env), JOIST_BASE.
 */
import { spawn } from 'child_process';
import fs from 'fs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const source = arg('source'), page = arg('page'), mode = arg('mode', 'absolute');
const base = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
if (!source || !page) { console.error('usage: node clone.mjs --source <url> --page <id> [--mode absolute|hybrid|raster] [--no-grade]'); process.exit(2); }
const slug = source.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 16).toLowerCase();
const layout = `/tmp/clone-layout-${slug}.json`;
const run = (cmd, args) => new Promise((res, rej) => { const p = spawn(cmd, args, { stdio: 'inherit', env: process.env }); p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${args.join(' ')} → exit ${c}`)))); });

(async () => {
  console.log(`\n=== CLONE ${source} → page ${page} (mode: ${mode}) ===`);
  if (mode === 'absolute') {
    console.log('• capture (ensemble, best-of-3 — stable on dynamic sites)…'); await run('node', ['capture-ensemble.mjs', '--source', source, '--out', layout, '--passes', '3']);
    console.log('• build-absolute…'); await run('node', ['build-absolute.mjs', '--layout', layout, '--page', page]);
  } else if (mode === 'hybrid') {
    console.log('• build-hybrid…'); await run('node', ['build-hybrid.mjs', '--source', source, '--page', page]);
  } else if (mode === 'raster') {
    console.log('• build-sectionraster…'); await run('node', ['build-sectionraster.mjs', '--source', source, '--page', page]);
  } else { console.error('unknown mode', mode); process.exit(2); }

  if (!has('no-grade')) {
    console.log('• grade-structure…');
    const out = `/tmp/clone-grade-${slug}`;
    await run('node', ['grade-structure.mjs', '--source', source, '--clone', `${base}/?page_id=${page}`, '--out', out]);
    try { const r = JSON.parse(fs.readFileSync(`${out}/report.json`, 'utf8')); console.log(`\n=== RESULT ===\ncomposite ${r.composite} | visual ${r.visual} | editability ${r.editability} | hRatio ${r.breakdown.hRatio}`); } catch {}
  }
  console.log(`PAGE: ${base}/?page_id=${page}\n`);
})().catch((e) => { console.error('CLONE FAILED:', e.message); process.exit(1); });
