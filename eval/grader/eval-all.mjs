#!/usr/bin/env node
/**
 * @purpose The autonomous eval CYCLE DRIVER. One command runs every deterministic layer against
 * source vs clone, prints a unified scorecard (composite = MIN of all layers), then feeds all
 * reports into the self-learning ledger (lessons.mjs --learn) so the ledger updates itself and
 * emits the prioritized worklist. This is the loop the agent runs each cycle: grade-everything →
 * learn → act on the worklist. (Vision committee is separate — it needs spawned agents.)
 *
 * Usage: node eval-all.mjs --source <url> --clone <url> [--out dir] [--no-learn]
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const source = arg('source'), clone = arg('clone'), out = arg('out', '/tmp/eval-all');
if (!source || !clone) { console.error('need --source --clone'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const here = new URL('.', import.meta.url).pathname;

const LAYERS = [
  { name: 'visual', script: 'grader-v2.mjs', report: 'report.json' },
  { name: 'dynamic', script: 'dynamic-grade.mjs', report: 'dynamic-report.json' },
  { name: 'performance', script: 'perf-grade.mjs', report: 'perf-report.json' },
  { name: 'a11y', script: 'a11y-grade.mjs', report: 'a11y-report.json' },
  { name: 'responsive', script: 'responsive-grade.mjs', report: 'responsive-report.json' },
  { name: 'interaction', script: 'interaction-grade.mjs', report: 'interaction-report.json' },
  { name: 'seo', script: 'seo-grade.mjs', report: 'seo-report.json' },
  { name: 'fidelity', script: 'fidelity-grade.mjs', report: 'fidelity-report.json' },
];

const results = []; const reportPaths = [];
for (const L of LAYERS) {
  const dir = path.join(out, L.name);
  process.stdout.write(`running ${L.name.padEnd(12)} … `);
  try {
    execFileSync('node', [path.join(here, L.script), '--source', source, '--clone', clone, '--out', dir], { stdio: 'ignore', timeout: 240000 });
    const rp = path.join(dir, L.report); const j = JSON.parse(fs.readFileSync(rp, 'utf8'));
    results.push({ name: L.name, pct: j.overall_pct, fails: (j.hard_fails || []).length, defects: (j.defects || []).length });
    reportPaths.push(rp);
    console.log(`${String(j.overall_pct).padStart(3)}%  (${(j.hard_fails || []).length} hard-fails, ${(j.defects || []).length} defects)`);
  } catch (e) { console.log('FAILED', (e.message || '').slice(0, 80)); results.push({ name: L.name, pct: null, fails: 0, defects: 0 }); }
}

const scored = results.filter((r) => r.pct != null);
const composite = scored.length ? Math.min(...scored.map((r) => r.pct)) : 0;
console.log('\n================= UNIFIED SCORECARD =================');
for (const r of results) console.log(`  ${r.name.padEnd(13)} ${r.pct == null ? '  --' : String(r.pct).padStart(3) + '%'}${r.fails ? '   ⚠ ' + r.fails + ' hard-fail(s)' : ''}`);
console.log(`  ${'COMPOSITE'.padEnd(13)} ${String(composite).padStart(3)}%   (MIN across layers — one bad layer caps it)`);
fs.writeFileSync(path.join(out, 'scorecard.json'), JSON.stringify({ source, clone, composite, layers: results }, null, 2));

if (!has('no-learn')) {
  console.log('\n================= SELF-LEARNING ====================');
  try { console.log(execFileSync('node', [path.join(here, 'lessons.mjs'), '--learn', ...reportPaths], { encoding: 'utf8' })); }
  catch (e) { console.log('learn step:', (e.stdout || e.message || '').toString()); }
}
console.log(`\ncomposite ${composite}% — reports in ${out}. Next: act on the worklist (highest-priority lesson first), rebuild, re-run.`);
