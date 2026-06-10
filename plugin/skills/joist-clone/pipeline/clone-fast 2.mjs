#!/usr/bin/env node
/**
 * @purpose Self-contained DETERMINISTIC clone fast-path for the joist-clone skill (Option A productization).
 * Runs the validated HYBRID pipeline (capture→native-tree→grade) in ONE command — no vision loop, no iteration.
 * Generalizes to unseen marketing/SaaS sites: cal.com (never in corpus) → composite 0.803 first-try, editable.
 *
 * Only references BUNDLED files (build-hybrid.mjs + grade-structure.mjs + abs-positioning.mjs) — unlike clone.mjs
 * whose default 'absolute' mode pulls in capture-ensemble/build-absolute (not bundled).
 *
 * Usage: node clone-fast.mjs --source <url> --page <id> [--no-grade]
 * Env:   JOIST_AUTH_B64 (WP app-password basic auth), JOIST_BASE (default https://georges232.sg-host.com).
 * Prereq: npm i  &&  npx playwright install chromium   (see README.md).
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const source = arg('source'), page = arg('page');
const base = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
if (!source || !page) { console.error('usage: node clone-fast.mjs --source <url> --page <id> [--no-grade]'); process.exit(2); }
const run = (file, args) => new Promise((res, rej) => { const p = spawn(process.execPath, [path.join(__dirname, file), ...args], { stdio: 'inherit', env: process.env }); p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${file} → exit ${c}`)))); });

(async () => {
  console.log(`\n=== CLONE (deterministic hybrid) ${source} → page ${page} ===`);
  await run('build-hybrid.mjs', ['--source', source, '--page', String(page)]);
  if (!has('no-grade')) {
    const out = `/tmp/clonefast-grade-${String(page)}`;
    await run('grade-structure.mjs', ['--source', source, '--clone', `${base}/?page_id=${page}`, '--out', out]);
    try { const r = JSON.parse(fs.readFileSync(`${out}/report.json`, 'utf8')); console.log(`\nGRADE composite ${r.composite} (visual ${r.visual} · editability ${r.editability} · designSystem ${r.designSystem} · responsive ${r.responsive})`); } catch {}
  }
  console.log(`\nLIVE: ${base}/?page_id=${page}`);
})().catch((e) => { console.error('clone-fast failed:', e.message); process.exit(1); });
