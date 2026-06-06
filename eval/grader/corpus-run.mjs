#!/usr/bin/env node
/**
 * @purpose Flywheel engine (#2): the reusable corpus eval + defect-attribution harness AND regression
 * suite. Runs a list of clone targets through build-hybrid + grade-structure (the editability-aware
 * objective) in parallel, then aggregates a corpus-wide report and attributes failures into a RANKED
 * defect taxonomy so the highest-frequency lever is obvious. Re-run after every builder change → gains
 * become monotonic (catches regressions across the whole corpus, not one site at a time).
 * Usage: node corpus-run.mjs [--build] [--grade] [--conc 3]   (default: build+grade)
 *   --build  rebuild every clone   --grade  re-grade   (omit both = do both)
 */
import { spawn } from 'child_process';
import fs from 'fs';
const has = (n) => process.argv.includes('--' + n);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const doBuild = has('build') || (!has('build') && !has('grade'));
const doGrade = has('grade') || (!has('build') && !has('grade'));
const CONC = parseInt(arg('conc', '3'), 10);
const OUT = '/tmp/corpus'; fs.mkdirSync(OUT, { recursive: true });

// Seed corpus — all verified to render in headless (Stripe excluded: known capture wall).
const CORPUS = [
  { name: 'tailwind', url: 'https://tailwindcss.com', page: 2551 },
  { name: 'supabase', url: 'https://supabase.com', page: 2467 },
  { name: 'resend', url: 'https://resend.com', page: 2469 },
  { name: 'framer', url: 'https://www.framer.com', page: 2471 },
];

function run(cmd, args, logFile) {
  return new Promise((resolve) => {
    const out = fs.openSync(logFile, 'w');
    const p = spawn(cmd, args, { stdio: ['ignore', out, out], env: process.env });
    p.on('close', (code) => { fs.closeSync(out); resolve(code); });
    p.on('error', () => { try { fs.closeSync(out); } catch {} resolve(1); });
  });
}
// concurrency-limited map
async function pool(items, n, fn) { const res = []; let i = 0; const workers = Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const idx = i++; res[idx] = await fn(items[idx], idx); } }); await Promise.all(workers); return res; }

(async () => {
  if (doBuild) {
    console.log(`building ${CORPUS.length} clones (conc ${CONC})…`);
    await pool(CORPUS, CONC, async (s) => { const t0 = Date.now(); const code = await run('node', ['build-hybrid.mjs', '--source', s.url, '--page', String(s.page)], `${OUT}/build-${s.name}.log`); console.log(`  build ${s.name} → exit ${code} (${Math.round((Date.now() - t0) / 1000)}s)`); return code; });
  }
  if (doGrade) {
    console.log(`grading ${CORPUS.length} clones (conc ${CONC})…`);
    await pool(CORPUS, CONC, async (s) => { const code = await run('node', ['grade-structure.mjs', '--source', s.url, '--clone', `https://georges232.sg-host.com/?page_id=${s.page}`, '--out', `${OUT}/g-${s.name}`], `${OUT}/grade-${s.name}.log`); console.log(`  grade ${s.name} → exit ${code}`); return code; });
  }
  // aggregate
  const rows = [];
  for (const s of CORPUS) {
    try { const r = JSON.parse(fs.readFileSync(`${OUT}/g-${s.name}/report.json`, 'utf8')); rows.push({ name: s.name, ...r }); }
    catch { rows.push({ name: s.name, composite: null, error: 'no report' }); }
  }
  const ok = rows.filter((r) => r.composite != null);
  const mean = (f) => ok.length ? +(ok.reduce((a, r) => a + f(r), 0) / ok.length).toFixed(3) : 0;
  // DEFECT ATTRIBUTION: per-site gaps + corpus-wide ranked levers
  const defects = ok.map((r) => {
    const editGap = +(1 - r.editability).toFixed(3);
    const visGap = +(1 - r.visual).toFixed(3);
    const drift = Math.abs((r.breakdown?.hRatio ?? 1) - 1);
    const tags = [];
    if (editGap > 0.4) tags.push('rasterized/missing-text');
    if (visGap > 0.15) tags.push('visual-loss(font/layout)');
    if (drift > 0.05) tags.push('height-drift');
    return { name: r.name, editGap, visGap, drift: +drift.toFixed(3), tags };
  });
  // rank levers by total gap contribution across corpus
  const levers = [
    { lever: 'editability (native text-coverage)', meanGap: mean((r) => 1 - r.editability), affects: defects.filter((d) => d.editGap > 0.4).length },
    { lever: 'visual fidelity (font/layout/drift)', meanGap: mean((r) => 1 - r.visual), affects: defects.filter((d) => d.visGap > 0.15).length },
  ].sort((a, b) => b.meanGap - a.meanGap);

  const report = {
    corpusSize: CORPUS.length, graded: ok.length,
    corpusMean: { composite: mean((r) => r.composite), visual: mean((r) => r.visual), editability: mean((r) => r.editability) },
    perSite: rows.map((r) => ({ name: r.name, composite: r.composite, visual: r.visual, editability: r.editability, textCoverage: r.breakdown?.textCoverage, hRatio: r.breakdown?.hRatio })),
    defects,
    rankedLevers: levers,
  };
  fs.writeFileSync(`${OUT}/corpus-report.json`, JSON.stringify(report, null, 2));
  console.log('\n===== CORPUS REPORT =====');
  console.log(`graded ${ok.length}/${CORPUS.length} | MEAN composite ${report.corpusMean.composite} (visual ${report.corpusMean.visual}, editability ${report.corpusMean.editability})`);
  console.log('\nper-site:'); for (const r of report.perSite) console.log(`  ${r.name.padEnd(10)} composite ${r.composite ?? 'ERR'}  visual ${r.visual ?? '-'}  edit ${r.editability ?? '-'}  cov ${r.textCoverage ?? '-'}  hRatio ${r.hRatio ?? '-'}`);
  console.log('\ndefect tags:'); for (const d of defects) console.log(`  ${d.name.padEnd(10)} editGap ${d.editGap} visGap ${d.visGap} drift ${d.drift} → ${d.tags.join(', ') || 'clean'}`);
  console.log('\nRANKED LEVERS (highest-frequency failure first):'); for (const l of levers) console.log(`  ${l.meanGap.toFixed(3)} mean-gap | affects ${l.affects}/${ok.length} sites | ${l.lever}`);
  console.log(`\nreport → ${OUT}/corpus-report.json`);
})();
