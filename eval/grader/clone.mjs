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
 * Usage: node clone.mjs --source <url> --page <id> [--mode absolute|hybrid|raster] [--no-grade] [--cache] [--refresh]
 *   --cache    freeze the capture per source (absolute: cached ensemble layout at /tmp/abs-cache/<slug>/;
 *              hybrid: forwarded to build-hybrid's own /tmp/hybrid-cache). Deterministic rebuilds.
 *   --refresh  with --cache: force a fresh capture and re-freeze it. No-op without --cache.
 *   (raster mode has no capture cache — flags are ignored there.)
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

// CAPTURE CACHE (--cache): freeze the ensemble layout per source so corpus rebuilds measure BUILDER
// changes without capture noise (mirrors build-hybrid's --cache). --refresh forces a recapture.
// Without --cache, behavior is byte-identical to before (always live capture).
const cacheDir = has('cache') ? `/tmp/abs-cache/${slug}` : null;
const cachedLayout = cacheDir ? `${cacheDir}/layout.json` : null;

(async () => {
  console.log(`\n=== CLONE ${source} → page ${page} (mode: ${mode}) ===`);
  if (mode === 'absolute') {
    if (cachedLayout && fs.existsSync(cachedLayout) && !has('refresh')) {
      console.log(`• capture: CACHED ← ${cachedLayout}`); fs.copyFileSync(cachedLayout, layout);
    } else {
      console.log('• capture (ensemble, best-of-3 — stable on dynamic sites)…'); await run('node', ['capture-ensemble.mjs', '--source', source, '--out', layout, '--passes', '3']);
      if (cacheDir) { fs.mkdirSync(cacheDir, { recursive: true }); fs.copyFileSync(layout, cachedLayout); console.log(`  cached → ${cachedLayout}`); }
    }
    console.log('• build-absolute…'); await run('node', ['build-absolute.mjs', '--layout', layout, '--page', page]);
  } else if (mode === 'hybrid') {
    const ba = ['build-hybrid.mjs', '--source', source, '--page', page];
    if (has('cache')) ba.push('--cache'); if (has('refresh')) ba.push('--refresh');
    console.log('• build-hybrid…'); await run('node', ba);
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
