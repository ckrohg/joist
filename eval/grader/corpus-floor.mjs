#!/usr/bin/env node
/**
 * @purpose ALWAYS-WORKS FLOOR corpus runner for the floor-guaranteed HYBRID-FLOW builder (motor-cortex ①).
 * corpus-run.mjs measures the absolute (desktop-pixel) default — responsive-veto-capped on 7/7 (MIN==MEAN==0.35).
 * THIS runs build-hybrid-flow.mjs (flow floor + per-section preserve "skills" + page-level FLOOR GUARANTEE:
 * ship max(flow, hybrid)) per corpus site, grades the SHIPPED arm, and aggregates with the SAME floor-metrics so
 * the numbers are directly comparable to the absolute baseline (prints an explicit BEFORE/AFTER).
 * SEQUENTIAL by design: build-hybrid-flow writes FIXED /tmp paths (ledger, *-grade, trees, shots), so parallel
 * runs would clobber each other (clone_validation_pitfalls). Tolerates per-site failures (aggregates what survived).
 * Layouts must be cached (run `corpus-run.mjs --build` first). Host-guarded; LOCAL sandbox, one render at a time.
 * Usage: source /tmp/joist-auth-1.env && node corpus-floor.mjs
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import { resolveBase } from '../../sandbox/host-guard.mjs';
import { computeFloor, formatFloor } from './floor-metrics.mjs';

resolveBase(process.env.JOIST_BASE || 'http://localhost:8001'); // §0 guard: throws on a non-training host
if (!process.env.JOIST_AUTH_B64) { console.error('JOIST_AUTH_B64 unset — `source /tmp/joist-auth-1.env` first.'); process.exit(2); }

// keep in sync with corpus-run.mjs CORPUS
const SITES = [
  { name: 'tailwind', url: 'https://tailwindcss.com' },
  { name: 'supabase', url: 'https://supabase.com' },
  { name: 'resend',   url: 'https://resend.com' },
  { name: 'framer',   url: 'https://www.framer.com' },
  { name: 'reactdev', url: 'https://react.dev' },
  { name: 'linear',   url: 'https://linear.app' },
  { name: 'notion',   url: 'https://www.notion.so' },
];
const slugOf = (u) => u.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '');
const OUT = '/tmp/corpus-floor';
fs.mkdirSync(OUT, { recursive: true });

for (const s of SITES) {
  const layout = `/tmp/abs-cache/${slugOf(s.url)}/layout.json`;
  if (!fs.existsSync(layout)) { console.log(`  ${s.name.padEnd(9)} SKIP — no cached layout (${layout}); run corpus-run.mjs --build first`); continue; }
  console.log(`\n=== ${s.name} → build-hybrid-flow (floor-guaranteed) ===`);
  const t0 = Date.now();
  const r = spawnSync('node', ['build-hybrid-flow.mjs', '--layout', layout, '--source', s.url], { encoding: 'utf8', cwd: process.cwd(), env: process.env, maxBuffer: 128 * 1024 * 1024, timeout: 600000 });
  fs.writeFileSync(`${OUT}/run-${s.name}.log`, (r.stdout || '') + (r.stderr || ''));
  const secs = Math.round((Date.now() - t0) / 1000);
  if (r.status !== 0) { console.log(`  ${s.name} → build-hybrid-flow exit ${r.status} (${secs}s) — see ${OUT}/run-${s.name}.log`); continue; }
  // which arm shipped? read the ledger, then snapshot the SHIPPED arm's FULL report (needed for veto-rate/min).
  let shipped = 'hybrid';
  try { shipped = JSON.parse(fs.readFileSync('/tmp/hybrid-residual-ledger.json', 'utf8')).grade?.shipped || 'hybrid'; } catch {}
  const srcReport = shipped === 'flow' ? '/tmp/flow-grade/report.json' : '/tmp/hybrid-grade/report.json';
  fs.mkdirSync(`${OUT}/g-${s.name}`, { recursive: true });
  try { fs.copyFileSync(srcReport, `${OUT}/g-${s.name}/report.json`); } catch (e) { console.log(`  ${s.name} → no shipped report (${e.message})`); continue; }
  fs.writeFileSync(`${OUT}/g-${s.name}/shipped.txt`, shipped);
  let comp = null; try { comp = JSON.parse(fs.readFileSync(`${OUT}/g-${s.name}/report.json`, 'utf8')).composite; } catch {}
  console.log(`  ${s.name} → SHIP ${shipped} composite ${comp} (${secs}s)`);
}

// ── aggregate (same shape + floor-metrics as corpus-run.mjs) ──────────────────────────────────────
const rows = [];
for (const s of SITES) {
  try {
    const r = JSON.parse(fs.readFileSync(`${OUT}/g-${s.name}/report.json`, 'utf8'));
    let shipped = '?'; try { shipped = fs.readFileSync(`${OUT}/g-${s.name}/shipped.txt`, 'utf8').trim(); } catch {}
    rows.push({ name: s.name, shipped, ...r });
  } catch { rows.push({ name: s.name, composite: null, error: 'no report' }); }
}
const ok = rows.filter((r) => r.composite != null);
const mean = (f) => ok.length ? +(ok.reduce((a, r) => a + f(r), 0) / ok.length).toFixed(3) : 0;
const floor = computeFloor(ok);
const report = {
  builder: 'hybrid-flow (floor-guaranteed)', corpusSize: SITES.length, graded: ok.length,
  corpusMean: { composite: mean((r) => r.composite), visual: mean((r) => r.visual), editability: mean((r) => r.editability), designSystem: mean((r) => r.designSystem ?? 1), responsive: mean((r) => r.responsive ?? 1) },
  perSite: rows.map((r) => ({ name: r.name, shipped: r.shipped, composite: r.composite, visual: r.visual, editability: r.editability, responsive: r.responsive })),
  alwaysWorksFloor: floor,
};
fs.writeFileSync(`${OUT}/corpus-report.json`, JSON.stringify(report, null, 2));
console.log('\n===== CORPUS FLOOR REPORT (hybrid-flow, floor-guaranteed) =====');
console.log(`graded ${ok.length}/${SITES.length} | MEAN composite ${report.corpusMean.composite} (visual ${report.corpusMean.visual}, edit ${report.corpusMean.editability}, resp ${report.corpusMean.responsive})`);
console.log('\nper-site:'); for (const r of report.perSite) console.log(`  ${r.name.padEnd(9)} ship ${String(r.shipped).padEnd(6)} composite ${r.composite ?? 'ERR'}  visual ${r.visual ?? '-'}  edit ${r.editability ?? '-'}  resp ${r.responsive ?? '-'}`);
if (floor.graded) console.log('\n' + formatFloor(floor).join('\n'));
// BEFORE/AFTER vs the absolute baseline (corpus-run.mjs report)
try {
  const base = JSON.parse(fs.readFileSync('/tmp/corpus/corpus-report.json', 'utf8'));
  console.log('\n----- ABSOLUTE baseline → HYBRID-FLOW (floor-guaranteed) -----');
  console.log(`  MEAN composite  ${base.corpusMean.composite} → ${report.corpusMean.composite}`);
  console.log(`  MIN  composite  ${base.alwaysWorksFloor?.min?.composite ?? '?'} → ${floor.min.composite}`);
  console.log(`  VETO-RATE       ${base.alwaysWorksFloor?.vetoRate ?? '?'} → ${floor.vetoRate}`);
} catch { /* no baseline to compare */ }
console.log(`\nreport → ${OUT}/corpus-report.json`);
