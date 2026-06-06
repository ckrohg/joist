#!/usr/bin/env node
/**
 * @purpose Deterministic synthetic ground-truth BENCH + regression suite for the clone pipeline.
 *
 * Unlike the live-site corpus (corpus-run.mjs), every input here is a self-contained, fully-specified
 * STATIC HTML block in bench/blocks/ — NO JS, NO animation/transition, NO lazy-load, NO CDN fonts, NO
 * network images. The rendered geometry/color/typography is therefore EXACT and 100% reproducible, so a
 * faithful clone MUST score very high. A LOW score on a block is not noise — it is a pinpointed builder
 * bug on KNOWN input.
 *
 * Pipeline per block (mirrors clone.mjs's absolute path, the canonical builder):
 *   serve bench/blocks/ on a local http port
 *   → capture-layout.mjs --source http://localhost:PORT/<block>.html --out /tmp/bench-<block>.json
 *   → build-absolute.mjs  --layout /tmp/bench-<block>.json --page <scratch>   (publishes, sets edit_mode=builder)
 *   → grade-sections.mjs  --source http://localhost:PORT/<block>.html --clone "$JOIST_BASE/?page_id=<scratch>"
 *
 * DETERMINISM CHECK: capture+grade run TWICE per block; we record the composite spread (must be SMALL,
 * < ~0.01 — far tighter than live sites at ~0.04). REGRESSION SUITE: first run writes bench/baseline.json;
 * later runs flag any block whose composite drops > 0.01 vs baseline.
 *
 * The bench OVERWRITES its scratch WP page ids every run (that is intentional — they are disposable slots).
 *
 * Usage: node bench/bench-run.mjs [--rebaseline]
 * Env (REQUIRED, source /tmp/joist-auth.env first): JOIST_AUTH_B64, JOIST_BASE=https://georges232.sg-host.com
 */
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRADER_DIR = path.resolve(__dirname, '..');         // eval/grader (where capture-layout etc. live)
const BLOCKS_DIR = path.join(__dirname, 'blocks');
const BASELINE = path.join(__dirname, 'baseline.json');
const TMP = '/tmp';

const has = (n) => process.argv.includes('--' + n);
const REBASELINE = has('rebaseline');

// ---- guardrails: never run against the wrong site, never proceed without auth ----
const BASE = process.env.JOIST_BASE;
const B64 = process.env.JOIST_AUTH_B64;
if (BASE !== 'https://georges232.sg-host.com') { console.error(`FATAL wrong JOIST_BASE=${BASE} (expected https://georges232.sg-host.com). Did you 'source /tmp/joist-auth.env'?`); process.exit(2); }
if (!B64) { console.error('FATAL JOIST_AUTH_B64 not set. source /tmp/joist-auth.env first.'); process.exit(2); }

// ---- bench manifest: block file → disposable scratch WP page id (OVERWRITTEN per run) ----
// Reuse the framer slot 2990 + a couple disposable ids the bench owns. The bench wipes them every run.
const BLOCKS = [
  { name: 'hero',          file: 'hero.html',          page: 2990 },  // reuse the framer slot
  { name: 'card-grid',     file: 'card-grid.html',     page: 9497 },  // disposable, bench-owned
  { name: 'nav',           file: 'nav.html',           page: 9498 },
  { name: 'pricing',       file: 'pricing.html',       page: 9499 },
  { name: 'feature-image', file: 'feature-image.html', page: 9500 },
  { name: 'footer',        file: 'footer.html',        page: 9501 },
];

const SPREAD_GATE = 0.01;       // run-twice composite spread must stay under this (determinism)
const REGRESSION_GATE = 0.01;   // composite drop vs baseline that flags a regression
const STEP_TIMEOUT_MS = 180000; // hard per-step timeout so a hung subprocess can't wedge the bench

// ---- tiny static file server for bench/blocks/ ----
const MIME = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript' };
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = (req.url || '/').split('?')[0];
      const rel = url === '/' ? '/index.html' : url;
      const fp = path.join(BLOCKS_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
      if (!fp.startsWith(BLOCKS_DIR)) { res.writeHead(403); return res.end('forbidden'); }
      fs.readFile(fp, (err, buf) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

// ---- run a subprocess with a hard timeout; capture stdout/stderr; never throw (resolve a result) ----
function run(cmd, args, { timeoutMs = STEP_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    const p = spawn(cmd, args, { cwd: GRADER_DIR, env: process.env });
    const finish = (code) => { if (done) return; done = true; clearTimeout(t); resolve({ code, out, err }); };
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} finish(124); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => finish(c == null ? 1 : c));
    p.on('error', () => finish(1));
  });
}

// pull the composite + sub-scores out of a grade-sections sections.json
function readGrade(dir) {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir, 'sections.json'), 'utf8'));
    return {
      composite: r.composite ?? null,
      visual: r.visualMean ?? null,
      editability: r.editabilityMean ?? null,
      structural: r.structuralFidelity ?? null,
      responsive: r.responsive?.score ?? null,
      coverage: r.perElement?.coverage ?? null,
      hRatio: r.hRatio ?? null,
      topDefect: (r.rankedDefects && r.rankedDefects[0]) ? `${r.rankedDefects[0].fails?.join('+')}: ${(r.rankedDefects[0].why || []).join(',')}` : null,
    };
  } catch (e) { return { composite: null, error: 'no/unreadable sections.json: ' + e.message }; }
}

// ---- one full capture→build→grade cycle for a block. pass `tag` so the two determinism passes don't collide ----
async function cycle(block, origin, tag) {
  const layout = path.join(TMP, `bench-${block.name}-${tag}.json`);
  const gradeOut = path.join(TMP, `bench-grade-${block.name}-${tag}`);
  const src = `${origin}/${block.file}`;
  const clone = `${BASE}/?page_id=${block.page}`;

  const cap = await run('node', ['capture-layout.mjs', '--source', src, '--out', layout]);
  if (cap.code !== 0 || !fs.existsSync(layout)) return { stage: 'capture', code: cap.code, err: tail(cap.err || cap.out) };

  const build = await run('node', ['build-absolute.mjs', '--layout', layout, '--page', String(block.page)]);
  if (build.code !== 0) return { stage: 'build', code: build.code, err: tail(build.err || build.out) };

  // small settle so the just-published page is fully readable before we screenshot/grade it
  await new Promise((r) => setTimeout(r, 1500));

  const grade = await run('node', ['grade-sections.mjs', '--source', src, '--clone', clone, '--out', gradeOut]);
  const g = readGrade(gradeOut);
  if (g.composite == null) return { stage: 'grade', code: grade.code, err: g.error || tail(grade.err || grade.out) };
  return { stage: 'ok', ...g };
}

const tail = (s) => (s || '').trim().split('\n').slice(-4).join(' | ').slice(0, 400);

(async () => {
  const { srv, port } = await startServer();
  const origin = `http://localhost:${port}`;
  console.log(`bench server on ${origin} (serving ${BLOCKS_DIR})`);
  console.log(`JOIST_BASE=${BASE} | blocks=${BLOCKS.length} | spread-gate=${SPREAD_GATE} regression-gate=${REGRESSION_GATE}\n`);

  const results = [];
  try {
    for (const block of BLOCKS) {
      const t0 = Date.now();
      let a, b;
      try {
        a = await cycle(block, origin, 'a');   // pass 1
        b = await cycle(block, origin, 'b');   // pass 2 (determinism — full recapture + regrade)
      } catch (e) {
        results.push({ name: block.name, page: block.page, error: 'cycle threw: ' + e.message });
        console.log(`  ${block.name.padEnd(14)} ERROR ${e.message}`);
        continue;
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      if (a.stage !== 'ok') {
        results.push({ name: block.name, page: block.page, error: `passA ${a.stage} failed (exit ${a.code})`, detail: a.err });
        console.log(`  ${block.name.padEnd(14)} FAIL @${a.stage} (exit ${a.code}) — ${a.err || ''}`);
        continue;
      }
      const compA = a.composite;
      const compB = b.stage === 'ok' ? b.composite : null;
      const spread = compB != null ? +Math.abs(compA - compB).toFixed(4) : null;
      const row = {
        name: block.name, page: block.page,
        composite: compA, visual: a.visual, editability: a.editability,
        structural: a.structural, responsive: a.responsive, coverage: a.coverage, hRatio: a.hRatio,
        compositeB: compB, spread, topDefect: a.topDefect, secs: +secs,
      };
      results.push(row);
      const spreadStr = spread == null ? 'B-FAILED' : (spread < SPREAD_GATE ? `${spread} ✓` : `${spread} ⚠TOO-WIDE`);
      console.log(`  ${block.name.padEnd(14)} composite ${compA}  (vis ${a.visual} edit ${a.editability} struct ${a.structural} resp ${a.responsive} cov ${a.coverage})  spread ${spreadStr}  ${secs}s${a.topDefect ? `  defect[${a.topDefect}]` : ''}`);
    }
  } finally {
    srv.close();
  }

  // ---- regression suite ----
  let baseline = null;
  if (fs.existsSync(BASELINE) && !REBASELINE) { try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch { baseline = null; } }
  const graded = results.filter((r) => r.composite != null);
  const mean = (f) => graded.length ? +(graded.reduce((a, r) => a + (f(r) ?? 0), 0) / graded.length).toFixed(3) : 0;
  const benchMean = {
    composite: mean((r) => r.composite), visual: mean((r) => r.visual), editability: mean((r) => r.editability),
    structural: mean((r) => r.structural), responsive: mean((r) => r.responsive), coverage: mean((r) => r.coverage),
  };
  const maxSpread = graded.reduce((m, r) => Math.max(m, r.spread ?? 0), 0);

  const regressions = [];
  if (baseline?.perBlock) {
    for (const r of graded) {
      const base = baseline.perBlock[r.name];
      if (base?.composite != null) {
        const drop = +(base.composite - r.composite).toFixed(4);
        if (drop > REGRESSION_GATE) regressions.push({ name: r.name, baseline: base.composite, now: r.composite, drop });
      }
    }
  }

  console.log('\n===== BENCH REPORT =====');
  console.log(`graded ${graded.length}/${BLOCKS.length} | BENCH MEAN composite ${benchMean.composite} (visual ${benchMean.visual}, edit ${benchMean.editability}, struct ${benchMean.structural}, resp ${benchMean.responsive}, cov ${benchMean.coverage})`);
  console.log(`max run-twice spread ${(+maxSpread).toFixed(4)} (gate ${SPREAD_GATE}) → ${maxSpread < SPREAD_GATE ? 'DETERMINISTIC ✓' : '⚠ NONDETERMINISTIC'}`);

  const wide = graded.filter((r) => r.spread != null && r.spread >= SPREAD_GATE);
  if (wide.length) console.log('wide-spread blocks:', wide.map((r) => `${r.name}(${r.spread})`).join(', '));
  const failed = results.filter((r) => r.composite == null);
  if (failed.length) { console.log('\nFAILED blocks:'); for (const f of failed) console.log(`  ${f.name}: ${f.error}${f.detail ? ' — ' + f.detail : ''}`); }

  // a clean simple block (nav/hero) should score HIGH; a LOW one is a pinpointed builder bug on known input
  const LOW = 0.6;
  const lowBlocks = graded.filter((r) => r.composite < LOW);
  if (lowBlocks.length) {
    console.log('\nLOW-SCORING blocks (builder bug on KNOWN deterministic input — investigate):');
    for (const r of lowBlocks) console.log(`  ${r.name} composite ${r.composite} (vis ${r.visual} edit ${r.editability} struct ${r.structural} resp ${r.responsive}) defect[${r.topDefect || 'n/a'}]`);
  }

  if (baseline && !REBASELINE) {
    if (regressions.length) { console.log('\n⚠ REGRESSIONS vs baseline (composite drop > ' + REGRESSION_GATE + '):'); for (const x of regressions) console.log(`  ${x.name}: ${x.baseline} → ${x.now} (drop ${x.drop})`); }
    else console.log('\nno regressions vs baseline ✓');
  }

  // write/refresh baseline on first run or when --rebaseline
  if (!baseline || REBASELINE) {
    const perBlock = {};
    for (const r of graded) perBlock[r.name] = { composite: r.composite, visual: r.visual, editability: r.editability, structural: r.structural, responsive: r.responsive, coverage: r.coverage };
    const payload = { writtenAt: new Date().toISOString(), benchMean, perBlock };
    fs.writeFileSync(BASELINE, JSON.stringify(payload, null, 2));
    console.log(`\nbaseline ${baseline ? 'REWRITTEN' : 'WRITTEN'} → ${BASELINE}`);
  }

  // machine-readable artifact
  const reportPath = path.join(TMP, 'bench-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ benchMean, maxSpread, results, regressions }, null, 2));
  console.log(`report → ${reportPath}`);

  process.exit(0);
})().catch((e) => { console.error('BENCH FAILED:', e.stack || e.message); process.exit(1); });
