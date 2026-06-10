#!/usr/bin/env node
/**
 * @purpose Self-test for grade-structure.mjs long-text chunking (de-inflation fix 2026-06-09).
 * Legacy grade-structure dropped ALL >200-char text runs from BOTH denominators → textCoverage was
 * blind to missing blog/docs bodies. The fix chunks long LEAF runs into ≤200-char word-boundary
 * pieces (default ON, GRADER_NO_LONGTEXT=1 → byte-identical legacy). This harness serves
 * deterministic local fixtures and asserts:
 *   T1 flag-off  src-vs-src        textCoverage == 1.0   (self-match invariant)
 *   T2 flag-on   src-vs-src        textCoverage == 1.0   (legacy self-match sanity)
 *   T3 flag-on   src-vs-missing    textCoverage == 1.0   (documents the legacy BLINDNESS)
 *   T4 flag-off  src-vs-missing    textCoverage  < 0.8   (de-inflation: missing body now visible)
 *   T5 flag-off  src-vs-split      textCoverage == 1.0   (clone splits body at DIFFERENT boundaries → cloneAll fallback)
 *   T6 srcTextRuns(off) - srcTextRuns(on) == exact body chunk count (mega-blob wrapper added NOTHING)
 *   T7 determinism: two flag-off runs → identical textCoverage + srcTextRuns
 *   T8 BYTE-IDENTICAL legacy: HEAD copy vs patched+GRADER_NO_LONGTEXT=1 → report.json cmp identical
 *      (meaningful only because HEAD run-to-run is also byte-identical — checked first)
 * Usage: node _grader-longtext-selftest.mjs
 */
import http from 'http';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
const execFileP = promisify(execFile);
import { fileURLToPath } from 'url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = '/tmp/lt-selftest'; fs.mkdirSync(OUT, { recursive: true });

// ---- fixtures (deterministic: system fonts, no images, no animation) ----
const BODY = Array.from({ length: 12 }, (_, i) =>
  `Paragraph sentence number ${i + 1} of the long blog body which explains in considerable detail how the grading pipeline measures selectable text coverage across reconstructed Elementor pages.`).join(' '); // ~2300 chars, one leaf <p>
const SHORTS = ['Joist Grader Fixture Headline', 'A short marketing subtitle here', 'Get started', 'Pricing', 'Read the documentation'];
const shortHtml = `<h1>${SHORTS[0]}</h1><p>${SHORTS[1]}</p><a href="#">${SHORTS[2]}</a> <a href="#">${SHORTS[3]}</a><p>${SHORTS[4]}</p>`;
// mega-blob wrapper: own text node + 2 text-bearing BLOCK children (>40 chars each, <200 → short path).
// Its innerText >200 → legacy drops it; new path must SKIP it (blockChild guard), children captured once.
const CHILD_A = 'The first wrapper child paragraph carries enough characters to pass the guard threshold easily.';
const CHILD_B = 'The second wrapper child paragraph also carries enough characters to pass the guard threshold.';
const megaHtml = `<div>wrapper own text node ${'pad '.repeat(30)}<p>${CHILD_A}</p><p>${CHILD_B}</p></div>`;
const page = (inner) => `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial;font-size:16px;margin:40px;width:1200px}</style></head><body>${inner}</body></html>`;
const FIX = {
  '/src.html': page(`${shortHtml}<p id="body">${BODY}</p>${megaHtml}`),
  '/clone_missing.html': page(`${shortHtml}${megaHtml}`), // long body ABSENT
  // body split at sentence boundaries (~190-char <p>s, ≤200 → kept verbatim, boundaries ≠ chunker's)
  '/clone_split.html': page(`${shortHtml}<div>${BODY.match(/[^.]+\./g).map((s) => `<p>${s.trim()}</p>`).join('')}</div>${megaHtml}`),
  '/src_nobody.html': page(`${shortHtml}${megaHtml}`), // src without long body (chunk-count delta probe)
};
// same chunker as grade-structure (expected body chunk count)
const chunksOf = (t) => { const words = t.slice(0, 8000).split(' '); const out = []; let cur = ''; for (const w of words) { if (cur && cur.length + 1 + w.length > 200) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; } if (cur) out.push(cur); return out; };
const BODY_CHUNKS = chunksOf(BODY.replace(/\s+/g, ' ').trim()).length;

const server = http.createServer((req, res) => { const b = FIX[req.url.split('?')[0]]; if (!b) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'content-type': 'text/html' }); res.end(b); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const grade = async (script, srcPath, clonePath, out, env = {}) => {
  // async spawn — execFileSync would BLOCK this process's event loop and starve the fixture server
  await execFileP('node', [script, '--source', base + srcPath, '--clone', base + clonePath, '--out', out, '--no-responsive', '--refresh-source'],
    { cwd: DIR, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(fs.readFileSync(`${out}/report.json`, 'utf8'));
};
let pass = 0, fail = 0;
const T = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`); ok ? pass++ : fail++; };

// T1/T2 self-match
const r1 = await grade('grade-structure.mjs', '/src.html', '/src.html', `${OUT}/t1`);
T('T1 flag-off src-vs-src textCoverage==1.0', r1.breakdown.textCoverage === 1, `cov=${r1.breakdown.textCoverage} runs=${r1.breakdown.srcTextRuns}`);
const r2 = await grade('grade-structure.mjs', '/src.html', '/src.html', `${OUT}/t2`, { GRADER_NO_LONGTEXT: '1' });
T('T2 flag-on  src-vs-src textCoverage==1.0', r2.breakdown.textCoverage === 1, `cov=${r2.breakdown.textCoverage} runs=${r2.breakdown.srcTextRuns}`);
// T3/T4 missing-body
const r3 = await grade('grade-structure.mjs', '/src.html', '/clone_missing.html', `${OUT}/t3`, { GRADER_NO_LONGTEXT: '1' });
T('T3 flag-on  src-vs-missing textCoverage==1.0 (legacy blind)', r3.breakdown.textCoverage === 1, `cov=${r3.breakdown.textCoverage}`);
const r4 = await grade('grade-structure.mjs', '/src.html', '/clone_missing.html', `${OUT}/t4`);
T('T4 flag-off src-vs-missing textCoverage<0.8 (de-inflation)', r4.breakdown.textCoverage < 0.8, `cov=${r4.breakdown.textCoverage} (legacy ${r3.breakdown.textCoverage})`);
// T5 different split boundaries → cloneAll substring fallback
const r5 = await grade('grade-structure.mjs', '/src.html', '/clone_split.html', `${OUT}/t5`);
T('T5 flag-off src-vs-split textCoverage==1.0 (chunk fallback)', r5.breakdown.textCoverage === 1, `cov=${r5.breakdown.textCoverage}`);
// T6 chunk-count delta == body chunks exactly (mega wrapper contributed 0 chunks)
const d = r1.breakdown.srcTextRuns - r2.breakdown.srcTextRuns;
T('T6 srcTextRuns(off)-srcTextRuns(on) == bodyChunks (no mega-blob)', d === BODY_CHUNKS, `delta=${d} expected=${BODY_CHUNKS}`);
// T7 determinism
const r7 = await grade('grade-structure.mjs', '/src.html', '/clone_split.html', `${OUT}/t7`);
T('T7 deterministic textCoverage+srcTextRuns (2 runs)', r7.breakdown.textCoverage === r5.breakdown.textCoverage && r7.breakdown.srcTextRuns === r5.breakdown.srcTextRuns, `${r5.breakdown.textCoverage}/${r5.breakdown.srcTextRuns} vs ${r7.breakdown.textCoverage}/${r7.breakdown.srcTextRuns}`);
// T8 byte-identical legacy (pre-fix baseline vs patched+flag); meaningful only if baseline is run-to-run identical.
// Baseline = git blob 185d5bd (grade-structure.mjs as of the pre-fix commit, c57a194) — regenerated if absent.
if (!fs.existsSync(path.join(DIR, '_head-grade-structure.mjs'))) {
  const { execSync } = await import('child_process');
  fs.writeFileSync(path.join(DIR, '_head-grade-structure.mjs'), execSync('git cat-file blob 185d5bd', { cwd: DIR }));
}
await grade('_head-grade-structure.mjs', '/src.html', '/clone_missing.html', `${OUT}/h1`);
await grade('_head-grade-structure.mjs', '/src.html', '/clone_missing.html', `${OUT}/h2`);
const headStable = fs.readFileSync(`${OUT}/h1/report.json`).equals(fs.readFileSync(`${OUT}/h2/report.json`));
await grade('grade-structure.mjs', '/src.html', '/clone_missing.html', `${OUT}/h3`, { GRADER_NO_LONGTEXT: '1' });
const byteIdent = fs.readFileSync(`${OUT}/h1/report.json`).equals(fs.readFileSync(`${OUT}/h3/report.json`));
T('T8a HEAD run-to-run byte-identical (comparison meaningful)', headStable);
T('T8b HEAD vs patched+GRADER_NO_LONGTEXT=1 byte-identical', byteIdent);

server.close();
console.log(`\n${pass}/${pass + fail} PASS${fail ? ' — ' + fail + ' FAIL' : ''}`);
process.exit(fail ? 1 : 0);
