#!/usr/bin/env node
/**
 * @purpose Selftest for refine-sections.mjs (C round 3, gate hardening enforced C round 5). Four tests on
 * tailwind/3146 (graded page: GETs only):
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
 *  D GATE HARDENING — ENFORCED (C round 5; formerly the e7b4774 xfail holes, now CLOSED by sectionvisual's
 *    bandLocalText feed). D0: pure unit pins on bandLocalText (no render). Live, same unique-carrier heading as
 *    TEST B, PROPOSAL mode:
 *      D1 FADE-TO-INVISIBLE (opacity 0.06 wrapper) → REJECTED, textCoverage gate fires (Δmatched < 0): the
 *         visibility/contrast floor stops counting humanly-unreadable text as reproduced.
 *      D2 MOVE-OUT-OF-BAND (_offset_y past y1) → REJECTED, textCoverage gate fires: matchedTexts is bound to
 *         band-local geometry (within-band movement stays legal — only leaving the band drops it).
 *      D3 NATIVE→HTML SWAP (heading → html widget, same text, same position) → REJECTED, editability gate
 *         fires (Δeditability < 0) — widget-type-aware weighting (native 1.0, html 0.5) — even when the text
 *         still matches (Δmatched 0 when the swapped text renders visibly; recorded as telemetry).
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
import { prepare, api, liveHash, bandLocalText } from './sectionvisual.mjs';
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
    // the chosen heading must sit FULLY inside the band (carriers above keep any-overlap semantics): the
    // hardened band-local feed requires a real y-intersection, so an edge-grazing heading would make the
    // delete/fade/move/swap triggers non-deterministic.
    const bb = cand.node.id && boxes[cand.node.id];
    if (!bb || bb.y < band.y0 || bb.y + bb.h > band.y1) continue;
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

    // ---------- TEST D: GATE HARDENING — ENFORCED (C round 5; the e7b4774 holes are CLOSED) ----------
    // The malicious keeps the C-round-3 critic measured MUST now be REJECTED by a DETERMINISTIC gate (never the
    // noisy visual gate). Same unique-carrier heading TEST B found, PROPOSAL mode (graded page GET-only).
    {
      console.log(`\nTEST D0 (bandLocalText unit pins — pure, no render)`);
      const mkLeaf = (over = {}) => ({ t: 'unique probe headline text', x: 10, y: 100, w: 400, h: 40, op: 1, ca: 1, ...over });
      const uSrc = [{ t: 'Unique Probe Headline Text', y: 110 }];
      const natTree = [{ elType: 'container', settings: {}, elements: [{ id: 'n1', elType: 'widget', widgetType: 'heading', settings: { title: 'Unique Probe Headline Text' }, elements: [] }] }];
      const htmTree = [{ elType: 'container', settings: {}, elements: [{ id: 'n1', elType: 'widget', widgetType: 'html', settings: { html: '<h2>Unique Probe Headline Text</h2>' }, elements: [] }] }];
      const u = (leaves, tree) => bandLocalText({ srcTexts: uSrc, leaves, shot: null, y0: 0, y1: 500, tree });
      const uBase = u([mkLeaf()], natTree), uFade = u([mkLeaf({ op: 0.06 })], natTree), uAlpha = u([mkLeaf({ ca: 0.1 })], natTree),
        uMove = u([mkLeaf({ y: 1100 })], natTree), uIn = u([mkLeaf({ y: 470 })], natTree), uSwap = u([mkLeaf()], htmTree);
      check('D0 visible native in-band → matched 1, editability 1', uBase.matchedTexts === 1 && uBase.editability === 1, JSON.stringify(uBase));
      check('D0/D1 effective-opacity 0.06 leaf NOT counted', uFade.matchedTexts === 0 && uFade.leafAudit.lowOpacity === 1, JSON.stringify(uFade.leafAudit));
      check('D0/D1 glyph-alpha 0.1 leaf NOT counted', uAlpha.matchedTexts === 0 && uAlpha.leafAudit.lowOpacity === 1, JSON.stringify(uAlpha.leafAudit));
      check('D0/D2 out-of-band leaf NOT counted', uMove.matchedTexts === 0 && uMove.leafAudit.outOfBand === 1, JSON.stringify(uMove.leafAudit));
      check('D0/D2 within-band movement STAYS counted (E reflow legal)', uIn.matchedTexts === 1, JSON.stringify(uIn));
      check('D0/D3 html-carried text: matched 1 but editability 0.5 (widget-type-aware)', uSwap.matchedTexts === 1 && uSwap.editability === 0.5 && uSwap.nonNativeMatched === 1, JSON.stringify(uSwap));

      console.log(`\nTEST D (gate hardening, live) band §${found.band.idx} y${found.band.y0}-${found.band.y1} — heading ${found.id}`);
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
      // D3: replace the native heading with an html widget carrying the SAME text at the SAME position (keeps
      // the heading's title color/size inline so the text still renders VISIBLY in-band — the point is that the
      // TYPE gate fires, not the coverage gate).
      registerOperator('st-htmlswap-heading', (tree, band, layout, capd, x) => {
        if (x.iteration > 1) return null;
        const root = Array.isArray(tree) ? tree[0] : tree; let done = false;
        walk(root.elements, (n) => {
          if (done || n.id !== found.id || typeof (n.settings || {}).title !== 'string') return;
          const s = n.settings;
          const color = (typeof s.title_color === 'string' && s.title_color) ? s.title_color : '';
          const fsz = (s.typography_font_size && typeof s.typography_font_size.size === 'number') ? s.typography_font_size.size : 32;
          n.widgetType = 'html';
          // schema-valid html widget: ONLY `html` + the `_`-prefixed advanced/common controls (position/offsets/
          // width/z survive); heading-only controls (title/header_size/typography_*/title_color) would 422.
          const next = { html: `<h2 style="margin:0;font-size:${fsz}px;line-height:1.1;${color ? 'color:' + color : ''}">${s.title}</h2>` };
          for (const k of Object.keys(s)) if (k.startsWith('_')) next[k] = s[k];
          n.settings = next;
          done = true;
        });
        return done ? tree : null;
      });
      const runHole = async (op) => {
        const r = await refineSections({ source: SOURCE, pageId: PAGE, bands: [found.band], operatorName: op, apply: false, outDir: `/tmp/refine-st/${op}`, maxIters: 1, ctx });
        const cand = r.perBand[0] && r.perBand[0].candidates.find((c) => c.scored);
        return { r, cand };
      };
      const fade = await runHole('st-fade-heading');
      const move = await runHole('st-move-heading');
      const swap = await runHole('st-htmlswap-heading');
      report.tests.gateHardening = {
        fade: { kept: fade.r.totalKept, candidate: fade.cand, gradedUntouched: fade.r.gradedUntouchedPreApply },
        move: { kept: move.r.totalKept, candidate: move.cand, gradedUntouched: move.r.gradedUntouchedPreApply },
        swap: { kept: swap.r.totalKept, candidate: swap.cand, gradedUntouched: swap.r.gradedUntouchedPreApply },
      };
      // D1 — fade-to-invisible MUST be rejected by the textCoverage gate (deterministic integer, never visual)
      check('D1 fade candidate scored', !!fade.cand, fade.cand ? '' : 'no scored candidate');
      check('D1 REJECTED (zero keeps) — invisible text no longer counts as reproduced',
        fade.r.totalKept === 0 && fade.cand && fade.cand.decision === 'rejected',
        fade.cand ? `decision ${fade.cand.decision} Δvisual ${fade.cand.deltas.visual} kept ${fade.r.totalKept}` : '');
      check('D1 textCoverage gate fired (Δmatched < 0)',
        fade.cand && fade.cand.gates.textCoverage === false && fade.cand.deltas.matchedTexts < 0,
        fade.cand ? `gates ${JSON.stringify(fade.cand.gates)} Δmatched ${fade.cand.deltas.matchedTexts}` : '');
      // D2 — move-out-of-band MUST be rejected by the textCoverage gate (band-local geometry bound)
      check('D2 move candidate scored', !!move.cand, move.cand ? '' : 'no scored candidate');
      check('D2 REJECTED (zero keeps) — text moved out of the band no longer counts',
        move.r.totalKept === 0 && move.cand && move.cand.decision === 'rejected',
        move.cand ? `decision ${move.cand.decision} Δvisual ${move.cand.deltas.visual} kept ${move.r.totalKept}` : '');
      check('D2 textCoverage gate fired (Δmatched < 0)',
        move.cand && move.cand.gates.textCoverage === false && move.cand.deltas.matchedTexts < 0,
        move.cand ? `gates ${JSON.stringify(move.cand.gates)} Δmatched ${move.cand.deltas.matchedTexts}` : '');
      // D3 — native→html swap MUST be rejected by the WIDGET-TYPE-AWARE editability gate
      check('D3 swap candidate scored', !!swap.cand, swap.cand ? '' : 'no scored candidate');
      check('D3 REJECTED (zero keeps) — native heading swapped for html widget',
        swap.r.totalKept === 0 && swap.cand && swap.cand.decision === 'rejected',
        swap.cand ? `decision ${swap.cand.decision} Δvisual ${swap.cand.deltas.visual} kept ${swap.r.totalKept}` : '');
      check('D3 editability gate fired (Δeditability < 0, widget-type-aware)',
        swap.cand && swap.cand.gates.editability === false && swap.cand.deltas.editability < 0,
        swap.cand ? `gates ${JSON.stringify(swap.cand.gates)} Δedit ${swap.cand.deltas.editability}` : '');
      if (swap.cand) console.log(`  note: D3 Δmatched ${swap.cand.deltas.matchedTexts} (0 = the swapped text still rendered visibly in-band → the rejection is purely TYPE-aware, the strongest form of the pin)`);
      check('D graded page untouched', fade.r.gradedUntouchedPreApply === true && move.r.gradedUntouchedPreApply === true && swap.r.gradedUntouchedPreApply === true);
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
