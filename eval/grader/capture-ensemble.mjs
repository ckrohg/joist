#!/usr/bin/env node
/**
 * @purpose Capture STABILITY for dynamic sites. capture-layout does one pass; dynamic React sites (resend)
 * render different amounts of content per load → editability swings (0.39↔0.80) and gains don't bank.
 * This runs capture-layout N times (fresh loads) and keeps the pass that captured the MOST text — turning
 * downside variance into "reliably get the best achievable capture". Drop-in for capture-layout (same --out).
 * Usage: node capture-ensemble.mjs --source <url> --out layout.json [--passes 3]
 */
import { spawn } from 'child_process';
import fs from 'fs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source'), out = arg('out', './layout.json'), passes = parseInt(arg('passes', '3'), 10);
if (!source) { console.error('need --source'); process.exit(2); }
const slug = source.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 14).toLowerCase();
const run = (args, log) => new Promise((res) => { const o = fs.openSync(log, 'w'); const p = spawn('node', args, { stdio: ['ignore', o, o], env: process.env }); p.on('close', (c) => { fs.closeSync(o); res(c); }); });
function textCount(path) { try { const L = JSON.parse(fs.readFileSync(path, 'utf8')); let n = 0, chars = 0; const w = (x) => { if (!x) return; if (x.kind === 'container') (x.children || []).forEach(w); else if (x.text) { n++; chars += x.text.length; } }; w(L.root); return { leaves: n, chars }; } catch { return { leaves: 0, chars: 0 }; } }

(async () => {
  const cands = [];
  for (let i = 0; i < passes; i++) {
    const f = `/tmp/ens-${slug}-${i}.json`;
    await run(['capture-layout.mjs', '--source', source, '--out', f], `/tmp/ens-${slug}-${i}.log`);
    const tc = textCount(f);
    cands.push({ f, ...tc });
    console.log(`  pass ${i + 1}/${passes}: ${tc.leaves} text-leaves, ${tc.chars} chars`);
  }
  // BEST = most text captured (leaves, tiebreak chars). Eliminates the unlucky low-content passes.
  cands.sort((a, b) => (b.leaves - a.leaves) || (b.chars - a.chars));
  const best = cands[0];
  fs.copyFileSync(best.f, out);
  const lo = cands[cands.length - 1], spread = best.leaves - lo.leaves;
  console.log(`ENSEMBLE: kept best of ${passes} → ${best.leaves} text-leaves (spread ${lo.leaves}..${best.leaves}, variance ${spread}) → ${out}`);
})();
