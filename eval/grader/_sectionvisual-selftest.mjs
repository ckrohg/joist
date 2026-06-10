#!/usr/bin/env node
/**
 * @purpose Tolerance selftest for the sectionVisual primitive (sectionvisual.mjs — PATH_TO_TRUE_1TO1 §C round 2)
 * + a CRASH-INJECTION test proving no scratch page survives the harness (SIGKILL mid-lifecycle → debris is
 * tag-swept to a verified 404).
 *
 * Per site (tailwind→3146, supabase→2986; graded pages receive GETs ONLY — all writes go to a scratch page):
 *   1. run grade-sections FRESH (writes/uses the frozen src cache) → perSection[] reference.
 *      Speed mode: the child runs with GRADER_SSIM_ONLY=1 + GRADER_NO_RESPONSIVE=1 — both are PAGE-level blend
 *      flags that do not touch the per-band loop (perSection[].visual byte-identical) and do not fold into the
 *      capture cache key; they only skip the perElement/responsive SUBPROCESSES (minutes). --full-grade disables.
 *   2. buildBoxIndex on the live page (via prepare()).
 *   3. deterministic band selection, N=5: (a) the y0=0 band (exercises the fixed-header rule), (b) largest mid
 *      band, (c) deepest gradable band (footer — worst-case doc height), (d) worst-visual band (real refine
 *      target), (e) a band containing a #cr-N CSS-pinned grid if any (exercises the CSS-pin channel), else the
 *      2nd-largest. Non-gradable bands (y1−y0<20 or gy1−y0<=8) skipped, mirroring grade-sections.
 *   4. sectionVisual once per band + ONE repeat on band (d) → pure render-noise measurement.
 *
 * PASS GATE: per band |Δvisual| <= 0.04 · max over all bands <= 0.08 · median |Δ| <= 0.03 ·
 * contentVoid + rasteredText flags agree with the full-page run on every band · repeat |Δ| <= 0.015 ·
 * crash-injection debris swept to 404 · zero JOIST-SCRATCH pages remaining · graded-page hash UNCHANGED.
 * (0.04 = half the documented ±0.08 full-run visual noise, which included live-source re-render noise the src
 * cache eliminates; the 0.08 hard cap rejects systematic extraction/normalization bugs, which present as a
 * large offset, not jitter. editability is band-local scope → excluded from the gate by contract.)
 *
 * Usage: node _sectionvisual-selftest.mjs --site tailwind|supabase|both [--skip-grade] [--skip-crash] [--full-grade]
 * Exit: 0 pass · 2 usage · 3 infra · 4 gate fail. Report → /tmp/secvis-selftest-<site>.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync, execSync } from 'child_process';
import { chromium } from 'playwright';
import { perBandVisual, loadSrcCache, W } from './grade-sections.mjs';
import { createScratch, deletePage, sweep, BASE, TAG } from './scratch-harness.mjs';
import { sectionVisual, prepare, api, liveHash } from './sectionvisual.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);

const SITES = {
  tailwind: { source: 'https://tailwindcss.com', page: 3146 },
  supabase: { source: 'https://supabase.com', page: 2986 },
};
const GATE = { perBand: 0.04, max: 0.08, median: 0.03, repeat: 0.015 };
const siteArg = arg('site');
if (!siteArg || (!SITES[siteArg] && siteArg !== 'both')) { console.error('usage: node _sectionvisual-selftest.mjs --site tailwind|supabase|both [--skip-grade] [--skip-crash] [--full-grade]'); process.exit(2); }
const siteNames = siteArg === 'both' ? Object.keys(SITES) : [siteArg];
const median = (xs) => { const a = xs.slice().sort((p, q) => p - q); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : 0; };

async function pageExists(id) { const r = await api('GET', `/wp-json/wp/v2/pages/${id}?context=edit`); return r.status === 200; }
async function taggedScratchCount() {
  const r = await api('GET', `/wp-json/joist/v1/pages?search=${encodeURIComponent(TAG)}&per_page=100&status=publish,draft`);
  return ((r.json && r.json.items) || []).filter((it) => it && typeof it.title === 'string' && it.title.startsWith(`${TAG} `)).length;
}

// CRASH-INJECTION: a child process creates a scratch page then SIGKILLs ITSELF (no finally, no signal trap can
// run) → the page must survive ONLY as tagged debris + active-file, and the next sweep must delete it (404).
async function crashInjectionTest(srcPage) {
  const idFile = '/tmp/secvis-crash-id.txt';
  try { fs.unlinkSync(idFile); } catch {}
  const harnessUrl = pathToFileURL(path.join(__dirname, 'scratch-harness.mjs')).href;
  const code = `import(${JSON.stringify(harnessUrl)}).then(async (m) => {
    const r = await m.createScratch({ title: 'secvis-crash-inject', elements: [], pageSettings: {}, srcId: ${Number(srcPage)} });
    require('fs').writeFileSync(${JSON.stringify(idFile)}, String(r.pageId));
    process.kill(process.pid, 'SIGKILL'); // hard crash: no release(), no trap — worst case
  }).catch((e) => { console.error(String(e)); process.exit(1); });`;
  const child = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 120000, env: process.env });
  const killed = child.signal === 'SIGKILL';
  let id = null; try { id = Number(fs.readFileSync(idFile, 'utf8').trim()); } catch {}
  if (!killed || !id) return { pass: false, why: `child not SIGKILLed or no page id (signal ${child.signal}, id ${id}) ${String(child.stderr).slice(0, 200)}` };
  const debrisAlive = await pageExists(id); // the crash DID leave a page (the test is that the SWEEP kills it)
  const sw = await sweep({ all: true });
  const sweptIt = sw.deleted.includes(id);
  const gone = !(await pageExists(id));
  const remaining = await taggedScratchCount();
  return { pass: debrisAlive && sweptIt && gone && remaining === 0, id, debrisAlive, sweptIt, gone, remaining, why: debrisAlive && sweptIt && gone && remaining === 0 ? 'crash debris created → swept → 404 verified, zero tagged pages remain' : `debrisAlive ${debrisAlive} sweptIt ${sweptIt} gone ${gone} remaining ${remaining}` };
}

async function runSite(name, ctx) {
  const { source, page } = SITES[name];
  const outGsec = `/tmp/secvis-st-${name}`;
  const hashBefore = await liveHash(page);

  // 1. fresh full-page reference grade (perSection[].visual). SSIM_ONLY/NO_RESPONSIVE skip page-level
  // subprocesses only — per-band values are byte-identical (see header).
  const gradeMode = has('full-grade') ? 'full' : 'fast(ssim-only,no-responsive)';
  if (!has('skip-grade') || !fs.existsSync(`${outGsec}/sections.json`)) {
    console.log(`[${name}] running grade-sections fresh (${gradeMode}) …`);
    const env = { ...process.env, ...(has('full-grade') ? {} : { GRADER_SSIM_ONLY: '1', GRADER_NO_RESPONSIVE: '1' }) };
    const r = spawnSync(process.execPath, [path.join(__dirname, 'grade-sections.mjs'), '--source', source, '--clone', `${BASE}/?page_id=${page}`, '--out', outGsec], { encoding: 'utf8', timeout: 1200000, env, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!fs.existsSync(`${outGsec}/sections.json`)) throw new Error(`grade-sections failed for ${name}: ${String(r.stderr).slice(-400)}`);
    console.log(`[${name}] reference grade: ${String(r.stdout).split('\n').filter(Boolean)[0] || ''}`);
  } else console.log(`[${name}] reusing existing reference grade (--skip-grade)`);
  const ref = JSON.parse(fs.readFileSync(`${outGsec}/sections.json`, 'utf8'));

  // 2. prepare (box index auto-built/refreshed against the live hash)
  const prep = await prepare({ source, pageId: page, ctx });
  const H = Math.min(prep.srcCache.shot.height, prep.cloneFullH);

  // 3. deterministic band selection (N=5)
  const gradable = (ref.perSection || []).filter((s) => s.y1 - s.y0 >= 20 && Math.min(H, s.y1) - s.y0 > 8);
  if (!gradable.length) throw new Error(`${name}: no gradable bands in reference grade`);
  const byArea = gradable.slice().sort((a, b) => (b.y1 - b.y0) - (a.y1 - a.y0));
  const picked = []; const labels = {};
  const add = (label, s) => { if (s && !picked.some((x) => x.idx === s.idx)) { picked.push(s); labels[s.idx] = label; return true; } return false; };
  add('a:y0=0/header', gradable.find((s) => s.y0 === 0));
  const mids = byArea.filter((s) => s.y0 !== 0 && s.idx !== gradable[gradable.length - 1].idx);
  add('b:largest-mid', mids[0]);
  add('c:deepest/footer', gradable.slice().sort((a, b) => b.y0 - a.y0)[0]);
  const worst = gradable.slice().sort((a, b) => a.visual - b.visual)[0];
  add('d:worst-visual', worst);
  // (e) a band containing a #cr-N CSS-pinned card-row grid (the desktop top:<Y>px!important channel)
  const crYs = [...String((prep.pageSettings && prep.pageSettings.custom_css) || '').matchAll(/#cr-\d+\{[^}]*?top:(\d+)px/g)].map((m) => +m[1]);
  const crBand = gradable.find((s) => crYs.some((y) => y >= s.y0 && y < s.y1));
  if (!add('e:cr-grid', crBand)) add('e:2nd-largest', byArea.find((s) => !picked.some((x) => x.idx === s.idx)));
  for (const s of byArea) { if (picked.length >= 5) break; add('fill:largest-rest', s); }
  console.log(`[${name}] bands: ${picked.map((s) => `§${s.idx}[${labels[s.idx]}] y${s.y0}-${s.y1} ref ${s.visual}`).join(' · ')}${crYs.length ? '' : ' (no #cr-N grid on this page → e fell back)'}`);

  // 4. one scratch page for the whole site run; serialized sectionVisual per band (+ repeat on worst)
  const made = await createScratch({ title: `secvis-selftest ${name}`, elements: [], pageSettings: prep.pageSettings, template: 'elementor_canvas', srcId: page });
  const scratch = { pageId: made.pageId, url: made.url };
  const rows = []; let repeatDelta = null; let repeatPair = null;
  try {
    for (const s of picked) {
      const r = await sectionVisual({ source, pageId: page, band: { y0: s.y0, y1: s.y1 }, prep, scratch, ctx, outDir: `/tmp/secvis-st-${name}` });
      const row = {
        idx: s.idx, label: labels[s.idx], yRange: [s.y0, s.y1],
        fullPageVisual: s.visual, sectionVisual: r.visual, delta: +(r.visual - s.visual).toFixed(3),
        voidAgrees: r.contentVoid === !!s.contentVoid, rasterAgrees: r.rasteredText === !!s.rasteredText,
        refVoid: !!s.contentVoid, secVoid: r.contentVoid, refRaster: !!s.rasteredText, secRaster: r.rasteredText,
        widgets: r.widgets, divergenceFlags: r.divergenceFlags, totalMs: r.timings.totalMs,
      };
      rows.push(row);
      console.log(`[${name}] §${s.idx} ${labels[s.idx]} y${s.y0}-${s.y1}: full ${s.visual} vs secvis ${r.visual} → Δ ${row.delta} | void ${row.voidAgrees ? 'agree' : 'DISAGREE'} raster ${row.rasterAgrees ? 'agree' : 'DISAGREE'} | ${r.timings.totalMs}ms`);
      if (s.idx === worst.idx && repeatDelta === null) {
        const r2 = await sectionVisual({ source, pageId: page, band: { y0: s.y0, y1: s.y1 }, prep, scratch, ctx, outDir: `/tmp/secvis-st-${name}` });
        repeatDelta = +Math.abs(r2.visual - r.visual).toFixed(4);
        repeatPair = [r.visual, r2.visual];
        console.log(`[${name}] §${s.idx} REPEAT (determinism): ${r.visual} vs ${r2.visual} → |Δ| ${repeatDelta}`);
      }
    }
  } finally {
    try { await deletePage(scratch.pageId, page); } catch (e) { console.error(`[${name}] scratch release failed (sweep catches it):`, String(e).slice(0, 160)); }
  }
  const hashAfter = await liveHash(page);
  return { name, source, page, gradeMode, hashBefore, hashAfter, hashUnchanged: hashBefore === hashAfter, H, cloneFullH: prep.cloneFullH, srcShotH: prep.srcCache.shot.height, rows, repeatDelta, repeatPair };
}

(async () => {
  try { execSync("pkill -9 -f 'chrome-headless-shell' 2>/dev/null || true", { stdio: 'ignore' }); } catch {}
  try { const sw = await sweep({ maxAgeMin: 60 }); if (sw.deleted.length) console.log(`pre-sweep removed ${sw.deleted.length} stale scratch page(s)`); } catch {}
  let exitCode = 0;
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const report = { sites: [], crash: null };
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    for (const name of siteNames) report.sites.push(await runSite(name, ctx));
  } finally { await browser.close(); }

  // crash-injection + zero-scratch-remaining (after all band work so sweep({all}) is safe)
  if (!has('skip-crash')) {
    report.crash = await crashInjectionTest(SITES[siteNames[0]].page);
    console.log(`crash-injection: ${report.crash.pass ? 'PASS' : 'FAIL'} — ${report.crash.why}`);
  }
  const remaining = await taggedScratchCount();

  // ---- aggregate gates over every band run ----
  const allRows = report.sites.flatMap((s) => s.rows);
  const absDeltas = allRows.map((r) => Math.abs(r.delta));
  const medianAbsDelta = +median(absDeltas).toFixed(4);
  const maxAbsDelta = +Math.max(...absDeltas).toFixed(4);
  const perBandOk = allRows.filter((r) => Math.abs(r.delta) <= GATE.perBand).length;
  const agreeOk = allRows.every((r) => r.voidAgrees && r.rasterAgrees);
  const repeatOk = report.sites.every((s) => s.repeatDelta != null && s.repeatDelta <= GATE.repeat);
  const hashOk = report.sites.every((s) => s.hashUnchanged);
  const crashOk = has('skip-crash') ? true : !!(report.crash && report.crash.pass);
  const pass = perBandOk === allRows.length && maxAbsDelta <= GATE.max && medianAbsDelta <= GATE.median && agreeOk && repeatOk && hashOk && crashOk && remaining === 0;
  Object.assign(report, { gate: GATE, medianAbsDelta, maxAbsDelta, perBandWithinGate: `${perBandOk}/${allRows.length}`, agreeOk, repeatDeltas: report.sites.map((s) => ({ site: s.name, repeatDelta: s.repeatDelta })), hashOk, crashOk, scratchRemaining: remaining, meanBandMs: Math.round(allRows.reduce((a, r) => a + r.totalMs, 0) / Math.max(1, allRows.length)), pass });

  console.log('\n================ sectionVisual tolerance table ================');
  console.log('site      §idx label              yRange          fullPage  secvis   Δ       void  raster  ms');
  for (const s of report.sites) for (const r of s.rows) console.log(`${s.name.padEnd(9)} §${String(r.idx).padEnd(3)} ${r.label.padEnd(18)} ${(`y${r.yRange[0]}-${r.yRange[1]}`).padEnd(15)} ${String(r.fullPageVisual).padEnd(9)} ${String(r.sectionVisual).padEnd(8)} ${String(r.delta).padEnd(7)} ${(r.voidAgrees ? 'ok' : 'X').padEnd(5)} ${(r.rasterAgrees ? 'ok' : 'X').padEnd(7)} ${r.totalMs}`);
  console.log(`gates: perBand<=${GATE.perBand} → ${perBandOk}/${allRows.length} | max ${maxAbsDelta}<=${GATE.max} | median ${medianAbsDelta}<=${GATE.median} | agree ${agreeOk} | repeat ${report.sites.map((s) => s.repeatDelta).join('/')}<=${GATE.repeat} ${repeatOk} | gradedHash ${hashOk} | crash ${crashOk} | scratchRemaining ${remaining}`);
  console.log(`RESULT: ${pass ? 'ALL PASS' : 'FAIL'}`);
  const outFile = `/tmp/secvis-selftest-${siteArg}.json`;
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`report → ${outFile}`);
  process.exit(pass ? 0 : 4);
})().catch((e) => { console.error(String(e && e.stack || e)); process.exit(3); });
