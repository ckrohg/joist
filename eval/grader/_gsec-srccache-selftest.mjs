#!/usr/bin/env node
/**
 * @purpose Self-test for grade-sections.mjs SOURCE-CAPTURE CACHE (determinism port from grade-structure,
 * 2026-06-09). The refine objective re-screenshotted the live dynamic source every run (±0.08 visual noise);
 * the cache freezes the SOURCE side of grade-sections' capture() (clone stays fresh). Default ON, reversible
 * GRADER_NO_SRCCACHE=1 → byte-identical legacy path. This harness serves deterministic local fixtures
 * (so run-to-run byte-equality is meaningful) and asserts:
 *   T1 legacy (GRADER_NO_SRCCACHE=1) creates NO cache files (flag path has zero side effects)
 *   T2 legacy run-to-run byte-identical report (baseline: equality checks below are meaningful)
 *   T3 cache-on COLD run: writes cache files AND report byte-identical to legacy (on-path equivalence)
 *   T4 cache-on WARM run: report byte-identical to cold (PNG+JSON round-trip is LOSSLESS for grading)
 *   T5 warm run does NOT rewrite the cache (read-only when warm)
 *   T6 cache is actually USED: tampering cached texts changes editabilityMean (warm path reads the cache,
 *      it does not silently re-capture)
 *   T7 --selftest ignores the (tampered) cache and still PASSES (selftest always exercises live capture)
 *   T8 innocent control pair: legacy vs cold vs warm all byte-identical (cache changes nothing on-path)
 * Subprocess terms (perElement/responsive) are disabled via env — the cache only affects the src capture
 * object, which those subprocesses never see (they re-capture themselves; see HONEST SCOPE in grade-sections).
 * Usage: node _gsec-srccache-selftest.mjs
 */
import http from 'http';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
const execFileP = promisify(execFile);
const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = '/tmp/gsec-srccache-selftest'; fs.mkdirSync(OUT, { recursive: true });
const CACHE_DIR = '/tmp/grade-src-cache';

// ---- fixtures (deterministic: system fonts, no images, no animation, fixed 1440 layout) ----
const page = (inner) => `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial;font-size:16px;margin:0;width:1440px}section{width:100%;min-height:200px;padding:24px;box-sizing:border-box}</style></head><body>${inner}</body></html>`;
const SEC1 = '<section><h1>Fixture Hero Headline For Cache Test</h1><p>A deterministic hero paragraph that the clone reproduces verbatim for the cache selftest.</p></section>';
const SEC2 = '<section style="background:#eee"><h2>Second Section Title Here</h2><p>Second section body text that exists in the source fixture page.</p><a href="#">Call to action link</a></section>';
const SEC2_CLONE = '<section style="background:#eee"><h2>Second Section Title Here</h2><p>Slightly different clone body so the grade is non-trivial.</p><a href="#">Call to action link</a></section>';
const FIX = {
  '/src.html': page(SEC1 + SEC2),
  '/clone.html': page(SEC1 + SEC2_CLONE),
  '/ctl-src.html': page('<section><h1>Innocent Control Headline</h1><p>Control paragraph one for the unaffected pair.</p></section>'),
  '/ctl-clone.html': page('<section><h1>Innocent Control Headline</h1><p>Control paragraph one for the unaffected pair.</p></section>'),
};
const server = http.createServer((req, res) => { const b = FIX[req.url.split('?')[0]]; if (!b) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'content-type': 'text/html' }); res.end(b); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
// cache tag must mirror grade-sections.mjs srcTag (URL-keyed + '-gsec' + mode suffixes). The selftest runs
// grade-sections with DEFAULT env (all USE_* on), so default-ON suffix-adding modes apply: '-mi' (USE_MEDIAID,
// added 28c6d3b — this broke the previously-hardcoded suffixless tag). Opt-out suffixes (-novb/-nofc/-nols)
// stay absent because the selftest never sets those flags.
const tagOf = (u) => String(u).replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 40) + '-gsec' + (process.env.GRADER_NO_MEDIAID ? '' : '-mi');
const cacheFiles = (u) => [`${CACHE_DIR}/${tagOf(u)}.json`, `${CACHE_DIR}/${tagOf(u)}.png`];
const clearCache = (u) => { for (const f of cacheFiles(u)) try { fs.unlinkSync(f); } catch {} };
const ENV = { GRADER_SSIM_ONLY: '1', GRADER_NO_RESPONSIVE: '1' }; // subprocess terms off (orthogonal to the cache)

const grade = async (srcPath, clonePath, out, env = {}, extra = []) => {
  const args = [path.join(DIR, 'grade-sections.mjs'), '--source', base + srcPath, ...(clonePath ? ['--clone', base + clonePath] : ['--selftest']), '--out', out, ...extra];
  const r = await execFileP('node', args, { cwd: DIR, env: { ...process.env, ...ENV, ...env }, maxBuffer: 64 * 1024 * 1024 }).catch((e) => e);
  return { code: r.code || 0, report: fs.existsSync(`${out}/sections.json`) ? JSON.parse(fs.readFileSync(`${out}/sections.json`, 'utf8')) : null, raw: fs.existsSync(`${out}/sections.json`) ? fs.readFileSync(`${out}/sections.json`) : null };
};
let pass = 0, fail = 0;
const T = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`); ok ? pass++ : fail++; };

clearCache(base + '/src.html'); clearCache(base + '/ctl-src.html');

// T1/T2 legacy path: no cache side effects + deterministic baseline
const l1 = await grade('/src.html', '/clone.html', `${OUT}/l1`, { GRADER_NO_SRCCACHE: '1' });
T('T1 legacy creates NO cache files', !cacheFiles(base + '/src.html').some(fs.existsSync));
const l2 = await grade('/src.html', '/clone.html', `${OUT}/l2`, { GRADER_NO_SRCCACHE: '1' });
T('T2 legacy run-to-run byte-identical', l1.raw && l2.raw && l1.raw.equals(l2.raw), `visual ${l1.report?.visualMean} vs ${l2.report?.visualMean}`);

// T3 cold cache-on: writes cache + equals legacy
const c1 = await grade('/src.html', '/clone.html', `${OUT}/c1`);
const wrote = cacheFiles(base + '/src.html').every(fs.existsSync);
T('T3 cold cache-on writes cache AND report == legacy', wrote && c1.raw && c1.raw.equals(l1.raw), `wrote=${wrote} visual ${c1.report?.visualMean} vs legacy ${l1.report?.visualMean}`);

// T4/T5 warm cache-on: equals cold + cache not rewritten
const mt0 = cacheFiles(base + '/src.html').map((f) => fs.statSync(f).mtimeMs);
const c2 = await grade('/src.html', '/clone.html', `${OUT}/c2`);
T('T4 warm cache-on report byte-identical to cold (lossless round-trip)', c2.raw && c2.raw.equals(c1.raw), `visual ${c2.report?.visualMean} edit ${c2.report?.editabilityMean}`);
const mt1 = cacheFiles(base + '/src.html').map((f) => fs.statSync(f).mtimeMs);
T('T5 warm run does not rewrite cache', mt0.every((m, i) => m === mt1[i]));

// T6 tamper: inject bogus src texts → editability must DROP (proves warm path READS the cache)
const [cj] = cacheFiles(base + '/src.html');
const meta = JSON.parse(fs.readFileSync(cj, 'utf8'));
const tampered = { ...meta, texts: [...meta.texts, { t: 'zz bogus tampered needle alpha', y: 60 }, { t: 'zz bogus tampered needle beta', y: 260 }] };
fs.writeFileSync(cj, JSON.stringify(tampered));
const c3 = await grade('/src.html', '/clone.html', `${OUT}/c3`);
T('T6 tampered cache changes the grade (cache is USED)', c3.report && c3.report.editabilityMean < c2.report.editabilityMean, `edit ${c2.report?.editabilityMean} -> ${c3.report?.editabilityMean}`);

// T7 selftest ignores the (still-tampered) cache and passes (always live capture)
const st = await grade('/src.html', null, `${OUT}/st`);
T('T7 --selftest passes with tampered cache present (selftest is live)', st.code === 0, `exit=${st.code} composite=${st.report?.composite}`);
clearCache(base + '/src.html');

// T9 lazy-settle flag innocence: GRADER_NO_LAZYSETTLE=1 (legacy capture) == default, on a static fixture
// (no lazy media → the settle must be a pure no-op on grading output). Warm cache state for both.
{
  await grade('/src.html', '/clone.html', `${OUT}/s1`); // re-warm cache post-tamper-cleanup
  const s2 = await grade('/src.html', '/clone.html', `${OUT}/s2`, { GRADER_NO_LAZYSETTLE: '1' });
  const s1 = { raw: fs.readFileSync(`${OUT}/s1/sections.json`) };
  T('T9 GRADER_NO_LAZYSETTLE=1 == default on static fixture (settle is innocent)', s2.raw && s2.raw.equals(s1.raw), `visual ${s2.report?.visualMean}`);
  clearCache(base + '/src.html');
}

// T8 innocent control: identical pair, legacy vs cold vs warm all byte-identical
const k1 = await grade('/ctl-src.html', '/ctl-clone.html', `${OUT}/k1`, { GRADER_NO_SRCCACHE: '1' });
const k2 = await grade('/ctl-src.html', '/ctl-clone.html', `${OUT}/k2`); // cold
const k3 = await grade('/ctl-src.html', '/ctl-clone.html', `${OUT}/k3`); // warm
T('T8 innocent control legacy==cold==warm', k1.raw && k1.raw.equals(k2.raw) && k2.raw.equals(k3.raw), `composite ${k1.report?.composite}/${k2.report?.composite}/${k3.report?.composite}`);
clearCache(base + '/ctl-src.html');

server.close();
console.log(`\n${pass}/${pass + fail} PASS${fail ? ' — ' + fail + ' FAIL' : ''}`);
process.exit(fail ? 1 : 0);
