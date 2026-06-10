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
  // xfail — a KNOWN-HOLE expectation. Prints loudly but NEVER flips `pass`: the gates SHOULD reject the input
  // but currently do not, and we want the suite to stay green while the hole is documented+locked. When a future
  // gate fix makes the input get rejected, `cond` flips and the line reads "FIXED?" → update/retire the pin.
  const xfail = (name, shouldRejectButKept, detail) => { console.log(`  ${shouldRejectButKept ? 'HOLE' : 'FIXED?'} ${name}${detail ? ' — ' + detail : ''}`); return shouldRejectButKept; };
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

    // ---------- TEST D: KNOWN GATE HOLES (adversarial critic, C round 3 re-run) ----------
    // Two band-local content degradations the anti-deletion keep gates DO NOT catch — pinned so a future gate
    // fix trips this test and forces the pin to be retired. Both use the SAME unique-carrier heading TEST B
    // found, in its band, in PROPOSAL mode (graded page GET-only):
    //  D1 FADE-TO-INVISIBLE — wrap the heading title in opacity:0.06 (just ABOVE capture()'s `+cs.opacity<0.05`
    //     visibility floor). The headline is humanly UNREADABLE, but capture() still extracts it → matchedTexts
    //     and editability are UNCHANGED (Δ0); the void text-guard sees the text "reproduced" so no void fires;
    //     and band visual RISES (the divergent dark glyphs stop painting) → KEEP. Root cause: the 0.05 vis floor
    //     counts text a human cannot read (a clone-side, grader-wide hole that --apply's full regrade ALSO misses
    //     because faded text raises visual while editability stays flat).
    //  D2 MOVE-OUT-OF-BAND — shift the heading _offset_y beyond y1 (still on the page, just below the crop). It
    //     leaves the band image → band visual RISES — but the matched/editability text join is computed PAGE-WIDE
    //     on the clone side (inClone over ALL scratch text leaves), so matchedTexts/editability are UNCHANGED
    //     (Δ0). The band gate is blind to "removed FROM THE BAND but kept ON THE PAGE".
    // DETERMINISTIC hole signature (independent of the ±0.08 single-band visual noise): on BOTH, textCoverage +
    // editability + noNewVoid all stay GREEN and Δmatched===0. The visual gate is the ONLY gate in play and it
    // points the WRONG way (rewards the degradation). The keep/reject OUTCOME is visual-noise-dependent and is
    // recorded as xfail telemetry, never as a hard pass/fail.
    {
      console.log(`\nTEST D (KNOWN GATE HOLES) band §${found.band.idx} y${found.band.y0}-${found.band.y1} — heading ${found.id}`);
      const setTitleSpan = (node, style) => { node.settings.title = `<span style="${style}">${node.settings.title}</span>`; };
      registerOperator('st-fade-heading', (tree, band, layout, capd, x) => {
        if (x.iteration > 1) return null;
        const root = Array.isArray(tree) ? tree[0] : tree; let done = false;
        walk(root.elements, (n) => { if (!done && n.id === found.id && typeof (n.settings || {}).title === 'string') { setTitleSpan(n, 'opacity:0.06'); done = true; } });
        return done ? tree : null;
      });
      registerOperator('st-move-heading', (tree, band, layout, capd, x) => {
        if (x.iteration > 1) return null;
        const root = Array.isArray(tree) ? tree[0] : tree; let done = false;
        walk(root.elements, (n) => { if (!done && n.id === found.id) { n.settings = { ...(n.settings || {}), _position: 'absolute', _offset_orientation_v: 'start', _offset_y: { unit: 'px', size: band.y1 + 600 } }; done = true; } });
        return done ? tree : null;
      });
      const runHole = async (op, tag) => {
        const r = await refineSections({ source: SOURCE, pageId: PAGE, bands: [found.band], operatorName: op, apply: false, outDir: `/tmp/refine-st/${op}`, maxIters: 1, ctx });
        const cand = r.perBand[0] && r.perBand[0].candidates.find((c) => c.scored);
        return { r, cand };
      };
      const fade = await runHole('st-fade-heading');
      const move = await runHole('st-move-heading');
      report.tests.gateHoles = {
        fade: { kept: fade.r.totalKept, candidate: fade.cand, gradedUntouched: fade.r.gradedUntouchedPreApply },
        move: { kept: move.r.totalKept, candidate: move.cand, gradedUntouched: move.r.gradedUntouchedPreApply },
      };
      // hard DETERMINISTIC pins (lock the gate-blindness; trip when a fix makes any anti-deletion gate fire):
      check('D1 fade candidate scored', !!fade.cand, fade.cand ? '' : 'no scored candidate');
      check('D1 anti-deletion gates BLIND to opacity-0.06 hide (textCoverage+editability+noNewVoid green, Δmatched 0)',
        fade.cand && fade.cand.gates.textCoverage && fade.cand.gates.editability && fade.cand.gates.noNewVoid && fade.cand.deltas.matchedTexts === 0,
        fade.cand ? `gates ${JSON.stringify(fade.cand.gates)} Δmatched ${fade.cand.deltas.matchedTexts}` : '');
      xfail('D1 HOLE: humanly-invisible (opacity 0.06) headline was KEPT (should be rejected)', fade.r.totalKept > 0,
        fade.cand ? `decision ${fade.cand.decision} Δvisual ${fade.cand.deltas.visual} kept ${fade.r.totalKept}` : '');
      check('D2 move candidate scored', !!move.cand, move.cand ? '' : 'no scored candidate');
      check('D2 anti-deletion gates BLIND to move-out-of-band (textCoverage+editability+noNewVoid green, Δmatched 0)',
        move.cand && move.cand.gates.textCoverage && move.cand.gates.editability && move.cand.gates.noNewVoid && move.cand.deltas.matchedTexts === 0,
        move.cand ? `gates ${JSON.stringify(move.cand.gates)} Δmatched ${move.cand.deltas.matchedTexts}` : '');
      xfail('D2 HOLE: heading moved OUT of the band (gone from the crop, kept on page) was KEPT (should be rejected)', move.r.totalKept > 0,
        move.cand ? `decision ${move.cand.decision} Δvisual ${move.cand.deltas.visual} kept ${move.r.totalKept}` : '');
      check('D graded page untouched', fade.r.gradedUntouchedPreApply === true && move.r.gradedUntouchedPreApply === true);
    }

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
