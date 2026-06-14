#!/usr/bin/env node
/**
 * @purpose The session's synthesis: a MEASUREMENT-BASED ROUTER. Native Elementor reconstruction wins on
 * simple sites; hybrid/raster wins on complex ones (native multi-column overflows — a hard Elementor wall
 * that heuristics make worse). So instead of forcing one builder, clone each site BOTH ways
 * (build-flextree native + build-hybrid), grade both with the honest grade-structure, and KEEP THE HIGHER
 * composite. The objective function picks the builder — no fragile layout heuristics. Reports the adaptive
 * routing mean (best-of-both per site) vs each single-builder mean.
 * Usage: node route-clone.mjs [--build] [--conc 2]
 */
import { spawn } from 'child_process';
import fs from 'fs';
const has = (n) => process.argv.includes('--' + n);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const doBuild = has('build') || !has('grade');
const CONC = parseInt(arg('conc', '2'), 10);
const OUT = '/tmp/route'; fs.mkdirSync(OUT, { recursive: true });
const baseURL = 'https://georges232.sg-host.com';

const CORPUS = [
  { name: 'tailwind', url: 'https://tailwindcss.com', nativePage: 2852, hybridPage: 2551 },
  { name: 'supabase', url: 'https://supabase.com', nativePage: 2986, hybridPage: 2467 },
  { name: 'resend', url: 'https://resend.com', nativePage: 2988, hybridPage: 2469 },
  { name: 'framer', url: 'https://www.framer.com', nativePage: 2990, hybridPage: 2471 },
];

function run(cmd, args, logFile) {
  return new Promise((resolve) => { const out = fs.openSync(logFile, 'w'); const p = spawn(cmd, args, { stdio: ['ignore', out, out], env: process.env }); p.on('close', (c) => { fs.closeSync(out); resolve(c); }); p.on('error', () => { try { fs.closeSync(out); } catch {} resolve(1); }); });
}
async function pool(items, n, fn) { const res = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const idx = i++; res[idx] = await fn(items[idx]); } })); return res; }
const readComposite = (dir) => { try { return JSON.parse(fs.readFileSync(`${dir}/report.json`, 'utf8')); } catch { return null; } };

(async () => {
  if (doBuild) {
    console.log(`cloning ${CORPUS.length} sites BOTH ways (conc ${CONC})…`);
    await pool(CORPUS, CONC, async (s) => {
      const t0 = Date.now();
      // native: capture-layout → build-flextree ; hybrid: build-hybrid (run concurrently within the site)
      const nativeP = (async () => { const c = await run('node', ['capture-layout.mjs', '--source', s.url, '--out', `${OUT}/layout-${s.name}.json`], `${OUT}/cap-${s.name}.log`); if (c !== 0) return c; return run('node', ['build-flextree.mjs', '--layout', `${OUT}/layout-${s.name}.json`, '--page', String(s.nativePage)], `${OUT}/native-${s.name}.log`); })();
      const hybridP = run('node', ['build-hybrid.mjs', '--source', s.url, '--page', String(s.hybridPage)], `${OUT}/hybrid-${s.name}.log`);
      const [nc, hc] = await Promise.all([nativeP, hybridP]);
      console.log(`  ${s.name}: native exit ${nc}, hybrid exit ${hc} (${Math.round((Date.now() - t0) / 1000)}s)`);
    });
  }
  // grade both for every site
  console.log('grading both builds per site…');
  await pool(CORPUS, CONC, async (s) => {
    await Promise.all([
      run('node', ['grade-structure.mjs', '--source', s.url, '--clone', `${baseURL}/?page_id=${s.nativePage}`, '--out', `${OUT}/g-native-${s.name}`], `${OUT}/gn-${s.name}.log`),
      run('node', ['grade-structure.mjs', '--source', s.url, '--clone', `${baseURL}/?page_id=${s.hybridPage}`, '--out', `${OUT}/g-hybrid-${s.name}`], `${OUT}/gh-${s.name}.log`),
    ]);
  });
  // decide
  const rows = CORPUS.map((s) => {
    const nr = readComposite(`${OUT}/g-native-${s.name}`), hr = readComposite(`${OUT}/g-hybrid-${s.name}`);
    const nc = nr ? nr.composite : 0, hc = hr ? hr.composite : 0;
    const winner = nc >= hc ? 'native' : 'hybrid';
    return { name: s.name, native: nc, hybrid: hc, winner, best: Math.max(nc, hc), nativePage: s.nativePage, hybridPage: s.hybridPage, winPage: winner === 'native' ? s.nativePage : s.hybridPage };
  });
  const mean = (f) => +(rows.reduce((a, r) => a + f(r), 0) / rows.length).toFixed(3);
  const report = { adaptiveMean: mean((r) => r.best), nativeOnlyMean: mean((r) => r.native), hybridOnlyMean: mean((r) => r.hybrid), perSite: rows };
  fs.writeFileSync(`${OUT}/route-report.json`, JSON.stringify(report, null, 2));
  console.log('\n===== ROUTER REPORT =====');
  console.log(`ADAPTIVE (best-of-both) mean composite: ${report.adaptiveMean}`);
  console.log(`  vs native-only ${report.nativeOnlyMean} | hybrid-only ${report.hybridOnlyMean}`);
  console.log('\nper-site (winner picked by the honest grader):');
  for (const r of rows) console.log(`  ${r.name.padEnd(10)} native ${r.native.toFixed(3)}  hybrid ${r.hybrid.toFixed(3)}  → WINNER: ${r.winner.toUpperCase()} (${r.best.toFixed(3)}) page ${r.winPage}`);
  console.log(`\nreport → ${OUT}/route-report.json`);
})();
