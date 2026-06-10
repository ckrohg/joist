#!/usr/bin/env node
/**
 * @purpose Selftest for refine-sections.mjs (C round 3). Three tests on tailwind/3146 (graded page: GETs only):
 *  A NO-OP — the shipped 'noop' operator produces an identity candidate → rejected WITHOUT a render
 *    ('identity-no-op'); zero keeps, zero scored candidates, scratch torn down, graded hash unchanged.
 *  B ANTI-DELETION PIN (the critic's measured exploit: deleting the tailwind hero heading RAISED band visual
 *    +0.046 while band-local editability fell 0.889→0.778) — a deliberately-degrading operator deletes an
 *    in-band heading whose text is a MATCHED source band text and is carried by exactly one tree node. The
 *    candidate IS scored, and the keep MUST be blocked by the textCoverage gate (matchedTexts drops — integer,
 *    deterministic) regardless of whether bandVisual rose on this run (visual delta recorded as telemetry;
 *    when it rises the exploit is reproduced live, but render noise must never decide a PASS/FAIL).
 *  C CRASH-INJECTION MID-RUN — a child process registers an operator that SIGKILLs the process when invoked
 *    (i.e. AFTER scratch creation + the baseline band render — genuinely mid-run, with band content live on the
 *    scratch page). No finally/trap can run. The debris page must be tag-swept to a verified 404, zero tagged
 *    scratch pages remain, and the graded page hash is unchanged.
 *
 * Band definitions are derived from the FROZEN source capture (srcCache.sections — same bounds grade-sections
 * uses), so this selftest needs no sections.json. Requires the tailwind src cache (run grade-sections once if
 * loadSrcCache complains) and /tmp/joist-auth.env.
 *
 * Usage: node _refine-sections-selftest.mjs [--skip-crash]
 * Exit: 0 pass · 3 infra · 4 gate fail. Report → /tmp/refine-selftest.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync, execSync } from 'child_process';
import { chromium } from 'playwright';
import { norm, W, loadSrcCache } from './grade-sections.mjs';
import { sweep, TAG } from './scratch-harness.mjs';
import { prepare, api, liveHash } from './sectionvisual.mjs';
import { refineSections, registerOperator } from './refine-sections.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const has = (n) => process.argv.includes('--' + n);
const SOURCE = 'https://tailwindcss.com', PAGE = 3146;

async function taggedScratchCount() {
  const r = await api('GET', `/wp-json/joist/v1/pages?search=${encodeURIComponent(TAG)}&per_page=100&status=publish,draft`);
  return ((r.json && r.json.items) || []).filter((it) => it && typeof it.title === 'string' && it.title.startsWith(`${TAG} `)).length;
}
async function pageExists(id) { const r = await api('GET', `/wp-json/wp/v2/pages/${id}?context=edit`); return r.status === 200; }

// strip tags + normalize a node's human-text-bearing settings into one blob (approximates what the band render
// contributes to the grader's clone-text join)
const blobOf = (n) => {
  const s = (n && n.settings) || {};
  return norm([s.title, s.editor, s.html, s.text].filter((v) => typeof v === 'string').join(' ').replace(/<[^>]+>/g, ' '));
};
const walk = (nodes, fn, parent = null) => { for (let i = 0; i < (nodes || []).length; i++) { fn(nodes[i], nodes, i, parent); walk(nodes[i].elements, fn, nodes[i]); } };

// find (heading, srcText) inside the band such that: heading box ∈ band rows · norm(title) contains a matched
// source band text · that source text occurs in EXACTLY ONE in-band node blob (so deleting the heading MUST
// drop matchedTexts by >=1 — the deterministic anti-deletion trigger).
export function findDeletableHeading(tree, band, cap) {
  const root = Array.isArray(tree) ? tree[0] : tree;
  const boxes = (cap.boxIndex && cap.boxIndex.boxes) || {};
  const srcBandTexts = [...new Set((cap.srcTexts || []).filter((t) => t.y >= band.y0 && t.y < band.y1 && norm(t.t).length >= 4).map((t) => norm(t.t)))];
  if (!srcBandTexts.length) return null;
  const inBand = []; // {node, parentArr, idx, blob}
  walk(root.elements, (n, arr, i) => {
    const b = n.id && boxes[n.id];
    if (b && b.y < band.y1 && b.y + b.h > band.y0) inBand.push({ node: n, arr, i, blob: blobOf(n) });
  });
  for (const cand of inBand) {
    if (cand.node.widgetType !== 'heading' || typeof (cand.node.settings || {}).title !== 'string') continue;
    const title = norm(String(cand.node.settings.title).replace(/<[^>]+>/g, ' '));
    if (title.length < 4) continue;
    for (const st of srcBandTexts) {
      if (!title.includes(st)) continue;
      const carriers = inBand.filter((x) => x.blob.includes(st)).length;
      if (carriers === 1) return { id: cand.node.id, title, srcText: st };
    }
  }
  return null;
}

(async () => {
  try { execSync("pkill -9 -f 'chrome-headless-shell' 2>/dev/null || true", { stdio: 'ignore' }); } catch {}
  try { const sw = await sweep({ maxAgeMin: 60 }); if (sw.deleted.length) console.log(`pre-sweep removed ${sw.deleted.length} stale scratch page(s)`); } catch {}
  if (!loadSrcCache(SOURCE)) { console.error(`no frozen src cache for ${SOURCE} — run grade-sections once first`); process.exit(3); }
  const hash0 = await liveHash(PAGE);
  const report = { source: SOURCE, page: PAGE, hash0, tests: {} };
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  let pass = true;
  const check = (name, cond, detail) => { const ok = !!cond; if (!ok) pass = false; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); return ok; };
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const prep = await prepare({ source: SOURCE, pageId: PAGE, ctx });
    const cap = { srcShot: prep.srcCache.shot, srcTexts: prep.srcCache.texts, boxIndex: prep.boxIndex, W };
    const H = Math.min(prep.srcCache.shot.height, prep.cloneFullH);
    const bounds = [...prep.srcCache.sections.filter((y) => y < prep.srcCache.pageH), prep.srcCache.pageH];
    const bands = [];
    for (let i = 0; i < bounds.length - 1; i++) { const y0 = bounds[i], y1 = bounds[i + 1]; if (y1 - y0 >= 20 && Math.min(H, y1) - y0 > 8) bands.push({ idx: i, y0, y1 }); }
    if (!bands.length) throw new Error('no gradable bands derivable from src cache');
    const smallest = bands.slice().sort((a, b) => (a.y1 - a.y0) - (b.y1 - b.y0))[0];

    // ---------- TEST A: no-op keeps nothing, renders nothing beyond the baseline ----------
    console.log(`\nTEST A (noop) band §${smallest.idx} y${smallest.y0}-${smallest.y1}`);
    const a = await refineSections({ source: SOURCE, pageId: PAGE, bands: [smallest], operatorName: 'noop', apply: false, outDir: '/tmp/refine-st/noop', ctx });
    const aCand = a.perBand[0] && a.perBand[0].candidates[0];
    report.tests.noop = { totalKept: a.totalKept, totalCandidates: a.totalCandidates, firstCandidate: aCand, gradedUntouched: a.gradedUntouchedPreApply };
    check('A zero keeps', a.totalKept === 0, `totalKept ${a.totalKept}`);
    check('A zero scored candidates (identity rejected pre-render)', a.totalCandidates === 0 && aCand && aCand.reason === 'identity-no-op', JSON.stringify(aCand));
    check('A graded page untouched', a.gradedUntouchedPreApply === true);

    // ---------- TEST B: anti-deletion pin ----------
    const found = (() => { // search bands smallest-first for a deterministic deletable heading
      for (const b of bands.slice().sort((x, y) => (x.y1 - x.y0) - (y.y1 - y.y0))) {
        const f = findDeletableHeading(prep.tree, b, cap); if (f) return { band: b, ...f };
      } return null;
    })();
    if (!found) throw new Error('no deletable matched heading found in any band — cannot pin the exploit');
    console.log(`\nTEST B (st-delete-heading) band §${found.band.idx} y${found.band.y0}-${found.band.y1} — deleting heading ${found.id} ("${found.title.slice(0, 60)}")`);
    registerOperator('st-delete-heading', (tree, band, layout, capd, x) => {
      if (x.iteration > 1) return null;
      const root = Array.isArray(tree) ? tree[0] : tree;
      let removed = false;
      walk(root.elements, (n, arr, i) => { if (!removed && n.id === found.id) { arr.splice(i, 1); removed = true; } });
      return removed ? tree : null;
    });
    const b = await refineSections({ source: SOURCE, pageId: PAGE, bands: [found.band], operatorName: 'st-delete-heading', apply: false, outDir: '/tmp/refine-st/delete', ctx });
    const bCand = b.perBand[0] && b.perBand[0].candidates.find((c) => c.scored);
    report.tests.deleteHeading = { band: found.band, deleted: { id: found.id, title: found.title }, totalKept: b.totalKept, candidate: bCand, baseline: b.perBand[0] && b.perBand[0].baseline, gradedUntouched: b.gradedUntouchedPreApply };
    check('B candidate was scored', !!bCand, bCand ? '' : 'no scored candidate');
    check('B rejected (zero keeps)', b.totalKept === 0 && bCand && bCand.decision === 'rejected');
    check('B textCoverage gate fired (matchedTexts dropped)', bCand && bCand.gates && bCand.gates.textCoverage === false && bCand.deltas.matchedTexts < 0, bCand ? `Δmatched ${bCand.deltas.matchedTexts}` : '');
    check('B graded page untouched', b.gradedUntouchedPreApply === true);
    if (bCand) console.log(`  note: visual Δ ${bCand.deltas.visual} (${bCand.gates.visual ? 'EXPLOIT REPRODUCED — visual rose past keep threshold yet candidate was rejected' : 'visual did not rise past threshold this run; rejection pinned by textCoverage regardless'})`);

    // ---------- TEST C: crash-injection mid-run ----------
    if (!has('skip-crash')) {
      console.log('\nTEST C (crash-injection mid-run)');
      const marker = '/tmp/refine-crash-marker.txt';
      try { fs.unlinkSync(marker); } catch {}
      const refineUrl = pathToFileURL(path.join(__dirname, 'refine-sections.mjs')).href;
      const code = `import(${JSON.stringify(refineUrl)}).then(async (m) => {
        m.registerOperator('st-crash', () => { require('fs').writeFileSync(${JSON.stringify(marker)}, 'operator-invoked'); process.kill(process.pid, 'SIGKILL'); });
        await m.refineSections({ source: ${JSON.stringify(SOURCE)}, pageId: ${PAGE}, bands: [${JSON.stringify(smallest)}], operatorName: 'st-crash', apply: false, outDir: '/tmp/refine-st/crash' });
      }).catch((e) => { console.error(String(e)); process.exit(1); });`;
      const child = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 420000, env: process.env });
      try { execSync("pkill -9 -f 'chrome-headless-shell' 2>/dev/null || true", { stdio: 'ignore' }); } catch {} // child's browser orphans
      const killed = child.signal === 'SIGKILL';
      const operatorRan = fs.existsSync(marker); // crash fired AFTER scratch create + baseline render = mid-run
      const sw = await sweep({ all: true });
      const remaining = await taggedScratchCount();
      const debrisGone = await Promise.all(sw.deleted.map((id) => pageExists(id).then((x) => !x))).then((xs) => xs.every(Boolean));
      report.tests.crash = { killed, operatorRan, swept: sw.deleted, remaining, debrisGone, childStderrTail: String(child.stderr).slice(-200) };
      check('C child SIGKILLed mid-run (operator ran)', killed && operatorRan, `signal ${child.signal} marker ${operatorRan}`);
      check('C debris swept to 404, zero tagged scratch remain', remaining === 0 && debrisGone, `swept ${JSON.stringify(sw.deleted)} remaining ${remaining}`);
    } else report.tests.crash = { skipped: true };

    const hash1 = await liveHash(PAGE);
    report.hash1 = hash1;
    check('\nFINAL graded page 3146 hash unchanged across all tests', hash1 === hash0, `${hash0} vs ${hash1}`);
    const remainingFinal = await taggedScratchCount();
    report.scratchRemaining = remainingFinal;
    check('FINAL zero JOIST-SCRATCH pages remain', remainingFinal === 0, String(remainingFinal));
  } catch (e) {
    console.error(String(e && e.stack || e));
    report.infraError = String(e);
    fs.writeFileSync('/tmp/refine-selftest.json', JSON.stringify(report, null, 2));
    process.exit(3);
  } finally { await browser.close(); }
  report.pass = pass;
  fs.writeFileSync('/tmp/refine-selftest.json', JSON.stringify(report, null, 2));
  console.log(`\nRESULT: ${pass ? 'ALL PASS' : 'FAIL'} — report → /tmp/refine-selftest.json`);
  process.exit(pass ? 0 : 4);
})();
