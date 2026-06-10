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
 *  E HOT-BAND GATE HARDENING 2 — ENFORCED (C round 5b; the _c5val-novel.mjs LIVE KEEPS). The C-r5b critic
 *    proved TESTs B/D validate on a band where hiding text does NOT gain visual (the noisy visual gate alone
 *    rejects there). TEST E re-runs the novel evasions on the HOT band — deterministically the FIRST
 *    (ascending idx) band with a unique-carrier heading; on tailwind/3146 that is the §1 hero where DELETING
 *    the heading RAISES band visual +0.046 (/tmp/c5val-novel-report.json) — and requires every one REJECTED by
 *    a DETERMINISTIC gate (visual-gate rejections do not count: visual REWARDS hiding on this band):
 *      E1 nv-clip18 (18px overflow-clip wrapper, innerText keeps the full string) → textCoverage fires —
 *         clip detection (rendered box ≪ scrollWidth demand) + no-fail-open paint clamp.
 *      E2 nv-graze (_offset_y = y1-9: 9px in-band, glyphs below the crop) → textCoverage fires —
 *         proportional >=50% band overlap (was min(8px,25%h)).
 *      E3 nv-decoyNative (display:none native heading kept in tree; html widget renders the text) →
 *         editability fires — nativeness needs RENDERING-LEAF provenance, dead tree nodes donate nothing.
 *      E4 nv-shortcodeSwap (heading → shortcode widget, literal text) → editability fires — explicit
 *         nativeness whitelist (shortcode/html are OUT; "not html" is gone).
 *  F GLYPH GEOMETRY + GHOST — ENFORCED (C round 5c; the _c5b-hotband.mjs live keeps, both REPRODUCED pre-fix).
 *    D1/D2 now run on per-leaf GLYPH rects (Range line-box union, ancestor-clip intersected) instead of the
 *    element box; D0 carries the matching unit pins (padPark/clipEdge/zero-rect/legacy-fallback/ghost):
 *      F1 st-nv-padpark (padding-top parks every glyph below y1, box top in-band) → textCoverage fires.
 *      F2 st-nv-clipedge (overflow-clip to 35% of content height, just above the old CLIP_MIN_FRAC) →
 *         textCoverage fires (glyph-area clip).
 *      F3 st-nv-ghostclone (opacity 0.45 + HEX clone-bg glyph color — rgb() forms are kses-stripped on this
 *         site, which is what kept mal-ghost45 render-inert) → textCoverage fires (lowPaint/ghost).
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
import { PNG } from 'pngjs';
import { norm, W, loadSrcCache } from './grade-sections.mjs';
import { sweep, TAG, BASE } from './scratch-harness.mjs';
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
      // leaves carry wid (rendering-widget provenance, C round 5b): the fixture leaf renders from widget n1.
      const mkLeaf = (over = {}) => ({ t: 'unique probe headline text', x: 10, y: 100, w: 400, h: 40, op: 1, ca: 1, wid: 'n1', ...over });
      const uSrc = [{ t: 'Unique Probe Headline Text', y: 110 }];
      const natTree = [{ elType: 'container', settings: {}, elements: [{ id: 'n1', elType: 'widget', widgetType: 'heading', settings: { title: 'Unique Probe Headline Text' }, elements: [] }] }];
      const htmTree = [{ elType: 'container', settings: {}, elements: [{ id: 'n1', elType: 'widget', widgetType: 'html', settings: { html: '<h2>Unique Probe Headline Text</h2>' }, elements: [] }] }];
      // C round 5b fixtures: dead native decoy + visible html carrier; shortcode carrier
      const decoyTree = [{ elType: 'container', settings: {}, elements: [
        { id: 'n1', elType: 'widget', widgetType: 'heading', settings: { title: '<span style="display:none">Unique Probe Headline Text</span>' }, elements: [] },
        { id: 'x9', elType: 'widget', widgetType: 'html', settings: { html: '<h2>Unique Probe Headline Text</h2>' }, elements: [] },
      ] }];
      const scTree = [{ elType: 'container', settings: {}, elements: [{ id: 'n1', elType: 'widget', widgetType: 'shortcode', settings: { shortcode: 'Unique Probe Headline Text' }, elements: [] }] }];
      const u = (leaves, tree) => bandLocalText({ srcTexts: uSrc, leaves, shot: null, y0: 0, y1: 500, tree });
      const uBase = u([mkLeaf()], natTree), uFade = u([mkLeaf({ op: 0.06 })], natTree), uAlpha = u([mkLeaf({ ca: 0.1 })], natTree),
        uMove = u([mkLeaf({ y: 1100 })], natTree), uIn = u([mkLeaf({ y: 470 })], natTree), uSwap = u([mkLeaf()], htmTree);
      check('D0 visible native in-band → matched 1, editability 1', uBase.matchedTexts === 1 && uBase.editability === 1, JSON.stringify(uBase));
      check('D0/D1 effective-opacity 0.06 leaf NOT counted', uFade.matchedTexts === 0 && uFade.leafAudit.lowOpacity === 1, JSON.stringify(uFade.leafAudit));
      check('D0/D1 glyph-alpha 0.1 leaf NOT counted', uAlpha.matchedTexts === 0 && uAlpha.leafAudit.lowOpacity === 1, JSON.stringify(uAlpha.leafAudit));
      check('D0/D2 out-of-band leaf NOT counted', uMove.matchedTexts === 0 && uMove.leafAudit.outOfBand === 1, JSON.stringify(uMove.leafAudit));
      check('D0/D2 within-band movement STAYS counted (E reflow legal)', uIn.matchedTexts === 1, JSON.stringify(uIn));
      check('D0/D3 html-carried text: matched 1 but editability 0.5 (widget-type-aware)', uSwap.matchedTexts === 1 && uSwap.editability === 0.5 && uSwap.nonNativeMatched === 1, JSON.stringify(uSwap));
      // C round 5b unit pins (gate hardening 2)
      const uClip = u([mkLeaf({ w: 18, sw: 420 })], natTree), uTiny = u([mkLeaf({ w: 6 })], natTree),
        uVClip = u([mkLeaf({ h: 10, sh: 120 })], natTree),
        uGraze = u([mkLeaf({ y: 491, h: 120, fs: 48 })], natTree), uTall = u([mkLeaf({ y: 480, h: 400, fs: 16 })], natTree),
        uDecoy = u([mkLeaf({ wid: 'x9' })], decoyTree), uShort = u([mkLeaf()], scTree), uSpoof = u([mkLeaf({ wid: 'zz' })], natTree);
      check('D0/5b CLIP: 18px render of a 420px-demand leaf NOT counted', uClip.matchedTexts === 0 && uClip.leafAudit.clipped === 1, JSON.stringify(uClip.leafAudit));
      check('D0/5b CLIP: degenerate (<8px) box NOT counted', uTiny.matchedTexts === 0 && uTiny.leafAudit.clipped === 1, JSON.stringify(uTiny.leafAudit));
      check('D0/5b CLIP: vertical clip (10px render of 120px demand) NOT counted', uVClip.matchedTexts === 0 && uVClip.leafAudit.clipped === 1, JSON.stringify(uVClip.leafAudit));
      check('D0/5b OVERLAP: 9px graze of a 120px leaf NOT counted (proportional bound)', uGraze.matchedTexts === 0 && uGraze.leafAudit.outOfBand === 1, JSON.stringify(uGraze.leafAudit));
      check('D0/5b OVERLAP: tall honest block with first line in-band STAYS counted', uTall.matchedTexts === 1, JSON.stringify(uTall.leafAudit));
      check('D0/5b PROVENANCE: dead native decoy in tree + html-rendered leaf → editability 0.5', uDecoy.matchedTexts === 1 && uDecoy.editability === 0.5 && uDecoy.nonNativeMatched === 1, JSON.stringify(uDecoy));
      check('D0/5b WHITELIST: shortcode-rendered text → editability 0.5 (not "anything except html")', uShort.matchedTexts === 1 && uShort.editability === 0.5 && uShort.nonNativeMatched === 1, JSON.stringify(uShort));
      check('D0/5b PROVENANCE: wid not in band tree → editability 0.5 (untraceable render)', uSpoof.matchedTexts === 1 && uSpoof.editability === 0.5 && uSpoof.nonNativeMatched === 1, JSON.stringify(uSpoof));
      // C round 5c unit pins (GLYPH GEOMETRY — D1/D2 on the visible glyph union box, not the element box; +
      // the glyph-color-vs-local-bg GHOST check). gLeaf = a leaf whose capture carries the additive glyph
      // fields (ga/gva/g*/gv*/gc) exactly as grade-sections' GLYPH_RECTS capture emits them.
      const gLeaf = (over = {}) => mkLeaf({ ga: 16000, gva: 16000, gx: 10, gy: 100, gw: 400, gh: 40, gvx: 10, gvy: 100, gvw: 400, gvh: 40, gc: [17, 24, 39], ...over });
      const uGlyphBase = u([gLeaf()], natTree);
      const uPadPark = u([gLeaf({ gy: 1100, gvy: 1100 })], natTree);   // element box in-band (y 100) — glyphs parked at y 1100
      const uClipEdge = u([gLeaf({ gva: 5600, gvh: 14 })], natTree);   // only 35% of the glyph area can paint
      const uNoGlyph = u([mkLeaf({ ga: 0, gva: 0, gc: [17, 24, 39] })], natTree); // zero-rect edge: glyphs never lay out/paint
      check('D0/5c glyph leaf visible in-band → matched 1, no legacy fallback', uGlyphBase.matchedTexts === 1 && uGlyphBase.leafAudit.legacyBox === 0, JSON.stringify(uGlyphBase.leafAudit));
      check('D0/5c PADPARK: element box in-band but glyph box parked out → NOT counted', uPadPark.matchedTexts === 0 && uPadPark.leafAudit.outOfBand === 1, JSON.stringify(uPadPark.leafAudit));
      check('D0/5c CLIPEDGE: 35% of glyph area paintable → clipped, NOT counted', uClipEdge.matchedTexts === 0 && uClipEdge.leafAudit.clipped === 1, JSON.stringify(uClipEdge.leafAudit));
      check('D0/5c ZERO-RECT: gva==0 (display:none / fully clipped glyphs) → NOT counted', uNoGlyph.matchedTexts === 0 && uNoGlyph.leafAudit.noGlyphs === 1, JSON.stringify(uNoGlyph.leafAudit));
      check('D0/5c LEGACY capture (no glyph fields) → still counted but FLAGGED legacyBox', uBase.matchedTexts === 1 && uBase.leafAudit.legacyBox === 1, JSON.stringify(uBase.leafAudit));
      // GHOST pin needs pixels: synthetic shot — flat 200-gray ring, deterministic ±40 speckle INSIDE the glyph
      // box (busy enough to clear the paint floor — the exact mal-ghost45 escape, now closed by contrast).
      {
        const SW = 600, SH = 300;
        const data = Buffer.alloc(SW * SH * 4);
        for (let i = 0; i < SW * SH; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 200; data[i * 4 + 3] = 255; }
        let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        for (let y = 100; y < 140; y++) for (let x = 10; x < 410; x++) { const i = (y * SW + x) * 4; const v = Math.max(0, Math.min(255, 200 + Math.round((rnd() - 0.5) * 80))); data[i] = data[i + 1] = data[i + 2] = v; }
        const shotG = { width: SW, height: SH, data };
        const uG = (leaves, tree) => bandLocalText({ srcTexts: uSrc, leaves, shot: shotG, y0: 0, y1: 500, tree });
        const uGhost = uG([gLeaf({ gc: [200, 200, 200], op: 0.45 })], natTree); // clone-bg-sampled ghost at 0.45 (clears the 0.4 floor)
        const uGhostVis = uG([gLeaf({ gc: [0, 0, 0] })], natTree);              // contrasting text on the same crop
        check('D0/5c GHOST: bg-matched glyph color over a BUSY crop → NOT counted (contrast, not geometry)', uGhost.matchedTexts === 0 && uGhost.leafAudit.ghost === 1, JSON.stringify(uGhost.leafAudit));
        check('D0/5c GHOST control: contrasting glyph color on the same crop STAYS counted', uGhostVis.matchedTexts === 1 && uGhostVis.leafAudit.ghost === 0, JSON.stringify(uGhostVis.leafAudit));
      }

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

    // ---------- TEST E: HOT-BAND GATE HARDENING 2 — ENFORCED (C round 5b; see header) ----------
    // Deterministic hot-band selection: ascending section idx, FIRST band with a unique-carrier heading. On
    // tailwind/3146 this is the §1 hero — the band where DELETING the matched heading RAISES band visual
    // (+0.046, /tmp/c5val-novel-report.json), i.e. where the visual gate REWARDS hiding text: only the
    // deterministic gates (textCoverage/editability) can reject here, which is exactly what TEST E enforces.
    {
      const hot = (() => {
        for (const b of bands) { const f = findDeletableHeading(prep.tree, b, cap); if (f) return { band: b, ...f, box: (prep.boxIndex.boxes || {})[f.id] }; }
        return null;
      })();
      if (!hot) throw new Error('no unique-carrier heading band — cannot run TEST E');
      console.log(`\nTEST E (hot-band gate hardening 2) band §${hot.band.idx} y${hot.band.y0}-${hot.band.y1} — heading ${hot.id} ("${hot.title.slice(0, 50)}")`);
      const onHot = (mut) => (tree, band, layout, capd, x) => {
        if (x.iteration > 1) return null;
        const root = Array.isArray(tree) ? tree[0] : tree; let done = false;
        walk(root.elements, (n, arr, i) => { if (!done && n.id === hot.id) { done = mut(n, arr, i, band) !== false; } });
        return done ? tree : null;
      };
      const stripTags = (s) => String(s).replace(/<[^>]+>/g, ' ');
      const newElId = () => Math.random().toString(16).slice(2, 9).padEnd(7, '0');
      // E1 nv-clip18 — 18px overflow-clip wrapper: innerText keeps the FULL string, the box renders ~18px wide
      registerOperator('st-nv-clip18', onHot((n) => {
        if (typeof (n.settings || {}).title !== 'string') return false;
        n.settings.title = `<span style="display:inline-block;width:18px;max-width:18px;overflow:hidden;white-space:nowrap;vertical-align:top">${n.settings.title}</span>`;
      }));
      // E2 nv-graze — park the heading 9px above the band's bottom edge (glyphs render below the crop)
      registerOperator('st-nv-graze', onHot((n, a, i, band) => {
        n.settings = { ...(n.settings || {}), _position: 'absolute', _offset_orientation_v: 'start', _offset_y: { unit: 'px', size: band.y1 - 9 } };
      }));
      // E3 nv-decoyNative — dead display:none native heading stays in the tree; an html widget renders the text
      registerOperator('st-nv-decoy-native', onHot((n, arr, i) => {
        if (typeof (n.settings || {}).title !== 'string' || !hot.box) return false;
        const color = (typeof n.settings.title_color === 'string' && n.settings.title_color) ? n.settings.title_color : '#111827';
        const fsz = (n.settings.typography_font_size && typeof n.settings.typography_font_size.size === 'number') ? n.settings.typography_font_size.size : 32;
        const raw = stripTags(n.settings.title).trim();
        n.settings.title = `<span style="display:none">${n.settings.title}</span>`;
        arr.splice(i + 1, 0, {
          id: newElId(), elType: 'widget', widgetType: 'html', isInner: false, elements: [],
          settings: {
            html: `<h2 style="margin:0;font-size:${fsz}px;line-height:1.1;color:${color}">${raw}</h2>`,
            _position: 'absolute', _offset_orientation_v: 'start', _offset_y: { unit: 'px', size: Math.round(hot.box.y) },
            _offset_orientation_h: 'start', _offset_x: { unit: 'px', size: Math.round(hot.box.x) }, _z_index: '5',
          },
        });
      }));
      // E4 nv-shortcodeSwap — heading → shortcode widget whose `shortcode` setting is the literal text
      registerOperator('st-nv-shortcode-swap', onHot((n) => {
        if (typeof (n.settings || {}).title !== 'string') return false;
        const raw = stripTags(n.settings.title).trim();
        const keepUnderscore = {}; for (const k of Object.keys(n.settings)) if (k.startsWith('_')) keepUnderscore[k] = n.settings[k];
        n.widgetType = 'shortcode';
        n.settings = { shortcode: raw, ...keepUnderscore };
      }));
      const runHot = async (op) => {
        const r = await refineSections({ source: SOURCE, pageId: PAGE, bands: [hot.band], operatorName: op, apply: false, outDir: `/tmp/refine-st/${op}`, maxIters: 1, ctx });
        return { r, cand: r.perBand[0] && r.perBand[0].candidates.find((c) => c.scored) };
      };
      const clip = await runHot('st-nv-clip18');
      const graze = await runHot('st-nv-graze');
      const decoy = await runHot('st-nv-decoy-native');
      const scswap = await runHot('st-nv-shortcode-swap');
      report.tests.hotBand = {
        band: hot.band, heading: hot.id,
        clip18: { kept: clip.r.totalKept, candidate: clip.cand, gradedUntouched: clip.r.gradedUntouchedPreApply },
        graze: { kept: graze.r.totalKept, candidate: graze.cand, gradedUntouched: graze.r.gradedUntouchedPreApply },
        decoyNative: { kept: decoy.r.totalKept, candidate: decoy.cand, gradedUntouched: decoy.r.gradedUntouchedPreApply },
        shortcodeSwap: { kept: scswap.r.totalKept, candidate: scswap.cand, gradedUntouched: scswap.r.gradedUntouchedPreApply },
      };
      const detText = (c) => !!(c && c.gates && c.gates.textCoverage === false && c.deltas.matchedTexts < 0);
      const detEdit = (c) => !!(c && c.gates && c.gates.editability === false && c.deltas.editability < 0);
      check('E1 clip18 scored + REJECTED (zero keeps)', clip.cand && clip.r.totalKept === 0 && clip.cand.decision === 'rejected', clip.cand ? `Δvisual ${clip.cand.deltas.visual}` : 'no scored candidate');
      check('E1 clip18 rejected by textCoverage (DETERMINISTIC — clipped render is not reproduced)', detText(clip.cand), clip.cand ? `gates ${JSON.stringify(clip.cand.gates)} Δmatched ${clip.cand.deltas.matchedTexts}` : '');
      check('E2 graze scored + REJECTED (zero keeps)', graze.cand && graze.r.totalKept === 0 && graze.cand.decision === 'rejected', graze.cand ? `Δvisual ${graze.cand.deltas.visual}` : 'no scored candidate');
      check('E2 graze rejected by textCoverage (DETERMINISTIC — 9px edge-graze is not in-band)', detText(graze.cand), graze.cand ? `gates ${JSON.stringify(graze.cand.gates)} Δmatched ${graze.cand.deltas.matchedTexts}` : '');
      check('E3 decoyNative scored + REJECTED (zero keeps)', decoy.cand && decoy.r.totalKept === 0 && decoy.cand.decision === 'rejected', decoy.cand ? `Δvisual ${decoy.cand.deltas.visual}` : 'no scored candidate');
      check('E3 decoyNative rejected by editability (DETERMINISTIC — dead tree heading donates no nativeness)', detEdit(decoy.cand), decoy.cand ? `gates ${JSON.stringify(decoy.cand.gates)} Δedit ${decoy.cand.deltas.editability}` : '');
      check('E4 shortcodeSwap scored + REJECTED (zero keeps)', scswap.cand && scswap.r.totalKept === 0 && scswap.cand.decision === 'rejected', scswap.cand ? `Δvisual ${scswap.cand.deltas.visual}` : 'no scored candidate');
      check('E4 shortcodeSwap rejected by editability (DETERMINISTIC — shortcode is not whitelisted-native)', detEdit(scswap.cand), scswap.cand ? `gates ${JSON.stringify(scswap.cand.gates)} Δedit ${scswap.cand.deltas.editability}` : '');
      check('E graded page untouched', clip.r.gradedUntouchedPreApply === true && graze.r.gradedUntouchedPreApply === true && decoy.r.gradedUntouchedPreApply === true && scswap.r.gradedUntouchedPreApply === true);

      // ---------- TEST F: GLYPH GEOMETRY + GHOST — ENFORCED (C round 5c; the _c5b-hotband.mjs live keeps) ----------
      // The box-manipulation family (REPRODUCED as live keeps pre-fix 2026-06-10: padPark kept +0.046 = the full
      // delete-equivalent gain, clipEdge kept +0.030, failedGates=[]) + the clone-bg ghost (mal-ghost45's
      // dangerous variant). Same hot band/heading as TEST E; every attack must be rejected DETERMINISTICALLY
      // (textCoverage — visual rejections do not count on the hot band, visual REWARDS hiding there).
      //   F1 st-nv-padpark — inline-block span with padding-top parks EVERY glyph below the band's bottom edge;
      //      the element box top stays in-band (old D2 passed on box overlap; the paint crop expanded WITH the
      //      box). Glyph geometry: the glyph union box moves with the glyphs → out-of-band → textCoverage.
      //   F2 st-nv-clipedge — overflow-clip the heading to ~35% of its content height (just above CLIP_MIN_FRAC
      //      0.3, the old threshold hole). Glyph geometry: gva/ga 0.35 < GLYPH_VIS_MIN_FRAC 0.5 → clipped.
      //   F3 st-nv-ghostclone — opacity 0.45 (clears the 0.4 floor) + glyph color := the CLONE's own local bg
      //      behind the heading, as a HEX value (kses on this site strips paren color values — rgb() forms render
      //      inert, which is exactly why mal-ghost45 stayed a visual-only rejection; hex survives, measured by
      //      the zz-kses probe 2026-06-10). Humanly invisible text → lowPaint (flat glyph crop) or ghost
      //      (contrast) → textCoverage.
      {
        // sample the CLONE's local bg behind the hot heading (one GET render of the graded page)
        const pg = await ctx.newPage();
        await pg.goto(`${BASE}/?page_id=${PAGE}&stgh=${Date.now().toString(36)}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
        await pg.waitForTimeout(800);
        const cloneShot = PNG.sync.read(await pg.screenshot({ fullPage: true }));
        await pg.close();
        const domBg = (shot, x0, ya, x1, yb) => {
          x0 = Math.max(0, x0 | 0); x1 = Math.min(shot.width, x1 | 0); ya = Math.max(0, ya | 0); yb = Math.min(shot.height, yb | 0);
          const cnt = new Map(), acc = new Map();
          const sx = Math.max(1, ((x1 - x0) / 60) | 0), sy = Math.max(1, ((yb - ya) / 60) | 0);
          for (let y = ya; y < yb; y += sy) { const row = y * shot.width * 4;
            for (let xx = x0; xx < x1; xx += sx) { const i = row + xx * 4;
              const r = shot.data[i], g = shot.data[i + 1], b = shot.data[i + 2];
              const k = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4);
              cnt.set(k, (cnt.get(k) || 0) + 1);
              const a = acc.get(k) || [0, 0, 0]; a[0] += r; a[1] += g; a[2] += b; acc.set(k, a);
            } }
          let best = null, bc = 0; for (const [k, c] of cnt) if (c > bc) { bc = c; best = k; }
          if (!best) return [255, 255, 255];
          const a = acc.get(best); return [Math.round(a[0] / bc), Math.round(a[1] / bc), Math.round(a[2] / bc)];
        };
        const cb = hot.box ? domBg(cloneShot, hot.box.x - 16, hot.box.y - 8, hot.box.x + hot.box.w + 16, hot.box.y + hot.box.h + 8) : [255, 255, 255];
        const hex = '#' + cb.map((v) => v.toString(16).padStart(2, '0')).join('');
        registerOperator('st-nv-padpark', onHot((n, a, i, band) => {
          if (typeof (n.settings || {}).title !== 'string' || !hot.box) return false;
          const pad = Math.max(0, band.y1 - Math.round(hot.box.y) + 16); // every glyph lands just BELOW y1; box top stays in-band
          n.settings.title = `<span style="display:inline-block;padding-top:${pad}px">${n.settings.title}</span>`;
        }));
        registerOperator('st-nv-clipedge', onHot((n) => {
          if (typeof (n.settings || {}).title !== 'string' || !hot.box) return false;
          const hClip = Math.max(10, Math.ceil(hot.box.h * 0.35)); // just ABOVE the old CLIP_MIN_FRAC 0.3 threshold
          n.settings.title = `<span style="display:block;height:${hClip}px;overflow:hidden">${n.settings.title}</span>`;
        }));
        registerOperator('st-nv-ghostclone', onHot((n) => {
          if (typeof (n.settings || {}).title !== 'string') return false;
          n.settings.title = `<span style="opacity:0.45;color:${hex}">${n.settings.title}</span>`;
        }));
        const park = await runHot('st-nv-padpark');
        const cedge = await runHot('st-nv-clipedge');
        const ghost = await runHot('st-nv-ghostclone');
        report.tests.glyphGeometry = {
          cloneBg: cb,
          padPark: { kept: park.r.totalKept, candidate: park.cand, gradedUntouched: park.r.gradedUntouchedPreApply },
          clipEdge: { kept: cedge.r.totalKept, candidate: cedge.cand, gradedUntouched: cedge.r.gradedUntouchedPreApply },
          ghostClone: { kept: ghost.r.totalKept, candidate: ghost.cand, gradedUntouched: ghost.r.gradedUntouchedPreApply },
        };
        check('F1 padPark scored + REJECTED (zero keeps) — WAS a live keep at +0.046', park.cand && park.r.totalKept === 0 && park.cand.decision === 'rejected', park.cand ? `Δvisual ${park.cand.deltas.visual}` : 'no scored candidate');
        check('F1 padPark rejected by textCoverage (DETERMINISTIC — glyph box moves with the glyphs)', detText(park.cand), park.cand ? `gates ${JSON.stringify(park.cand.gates)} Δmatched ${park.cand.deltas.matchedTexts}` : '');
        check('F2 clipEdge scored + REJECTED (zero keeps) — WAS a live keep at +0.030', cedge.cand && cedge.r.totalKept === 0 && cedge.cand.decision === 'rejected', cedge.cand ? `Δvisual ${cedge.cand.deltas.visual}` : 'no scored candidate');
        check('F2 clipEdge rejected by textCoverage (DETERMINISTIC — glyph-area clip, threshold-independent)', detText(cedge.cand), cedge.cand ? `gates ${JSON.stringify(cedge.cand.gates)} Δmatched ${cedge.cand.deltas.matchedTexts}` : '');
        check('F3 ghostClone scored + REJECTED (zero keeps)', ghost.cand && ghost.r.totalKept === 0 && ghost.cand.decision === 'rejected', ghost.cand ? `Δvisual ${ghost.cand.deltas.visual}` : 'no scored candidate');
        check('F3 ghostClone rejected by textCoverage (DETERMINISTIC — bg-matched glyphs are not reproduced)', detText(ghost.cand), ghost.cand ? `gates ${JSON.stringify(ghost.cand.gates)} Δmatched ${ghost.cand.deltas.matchedTexts}` : '');
        check('F graded page untouched', park.r.gradedUntouchedPreApply === true && cedge.r.gradedUntouchedPreApply === true && ghost.r.gradedUntouchedPreApply === true);
      }
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
