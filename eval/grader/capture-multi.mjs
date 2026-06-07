#!/usr/bin/env node
// @purpose Per-breakpoint Stage 1 — run the TUNED capture-layout.mjs at multiple widths. Do NOT refactor
// the single-width capture: it carries heavy scroll/reveal/lazy-load logic that must run per width. Emits
// per-width layout JSONs + a combined { w<W>: layout } multi.json for reconcile-breakpoints.mjs.
// Usage: node capture-multi.mjs --source <url> [--widths 1440,768,390] [--out /tmp/pbc-s1] [--reuse]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const reuse = process.argv.includes('--reuse');
const source = arg('source');
const outDir = arg('out', '/tmp/pbc-s1');
const widths = String(arg('widths', '1440,768,390')).split(',').map((s) => parseInt(s, 10)).filter(Boolean);
if (!source) { console.error('need --source'); process.exit(2); }

fs.mkdirSync(outDir, { recursive: true });
const combined = {};
for (const w of widths) {
  const out = path.join(outDir, `layout-${w}.json`);
  if (reuse && fs.existsSync(out)) { console.log(`reuse @${w} (${out})`); }
  else {
    console.log(`capture @${w} …`);
    execFileSync('node', [path.join(DIR, 'capture-layout.mjs'), '--source', source, '--width', String(w), '--out', out], { stdio: 'inherit' });
  }
  combined[`w${w}`] = JSON.parse(fs.readFileSync(out, 'utf8'));
}
const multi = path.join(outDir, 'multi.json');
fs.writeFileSync(multi, JSON.stringify(combined));
console.log(`→ ${multi} (${widths.join('/')})`);
