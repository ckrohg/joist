#!/usr/bin/env node
/**
 * @purpose FRESH GATE-ATTACK CRITIC (C round 5 independent) — FOUR NOVEL evasions of my own design, run in
 * PROPOSAL mode on tailwind 3146 across EVERY unique-carrier-heading band (not just §5). The existing
 * _c5val-attack only probes §5, where hiding text raises visual just +0.003 (< the +0.01 keep threshold) so the
 * visual gate alone rejects — the deterministic gates are never actually exercised against a live keep. This
 * file (a) scans all UC-heading bands with a `delete` control to find the band where hiding text RAISES band
 * visual the MOST (the genuinely exploitable "hot band"), then (b) runs novel evasions designed to preserve
 * matchedTexts AND editability there:
 *   clip18   — wrap the heading title in an inline-block span clipped to width:18px;overflow:hidden. innerText
 *              (hence the capture leaf `t`) keeps the FULL string, but the leaf box renders ~18px wide so the
 *              D1 PIXEL paint-energy floor is SKIPPED (it only runs when leaf w>=24). Normal font (>=10) dodges
 *              any font-size floor; opacity 1 dodges the D1 DOM floor; native widget keeps editability 1.0.
 *              The heading is visually ~erased yet deterministically "reproduced". The residual's proposed
 *              tinyfont follow-up (a font-size floor) does NOT close this.
 *   graze    — absolutely position the heading so its box top sits 9px above y1: overlap with the band is 9px,
 *              >= the D2 floor min(8px,25%h) for any height, so matchedTexts survives — but the bulk of the
 *              glyphs render BELOW y1, outside the band crop the visual gate compares. D2's absolute-8px floor
 *              is not proportional to how much TEXT actually lands in-band.
 *   decoyNative — keep the native heading in the band tree but hide its render (title wrapped in
 *              display:none), and insert an html widget carrying the SAME text visibly at the same box.
 *              treeTextBlobs reads SETTINGS not render, so the dead native heading keeps the text in nativeBlob
 *              → editability scores 1.0 even though the only VISIBLE carrier is a non-editable html widget. D3's
 *              nativeness test is tree-membership, not rendering-leaf provenance.
 *   shortcodeSwap — swap the heading to a `shortcode` widget whose `shortcode` setting is the literal text. D3's
 *              whitelist is "anything not widgetType==='html'" → a shortcode counts as native (1.0), though it
 *              is far less editable than a heading.
 * ALL of these MUST be REJECTED (kept=0) for the gates to hold. Any keep is a hole → mustFix.
 * Graded page 3146 is GET-only (hash verified before/after). Report → /tmp/c5val-novel-report.json
 */
import fs from 'fs';
import { execSync } from 'child_process';
import { chromium } from 'playwright';
import { norm, W, loadSrcCache } from './grade-sections.mjs';
import { sweep } from './scratch-harness.mjs';
import { prepare, api, liveHash } from './sectionvisual.mjs';
import { refineSections, registerOperator } from './refine-sections.mjs';

const SOURCE = 'https://tailwindcss.com', PAGE = 3146;
const walk = (nodes, fn, parent = null) => { for (let i = 0; i < (nodes || []).length; i++) { fn(nodes[i], nodes, i, parent); walk(nodes[i].elements, fn, nodes[i]); } };
const stripTags = (s) => String(s).replace(/<[^>]+>/g, ' ');
const blobOf = (n) => { const s = (n && n.settings) || {}; return norm([s.title, s.editor, s.html, s.text].filter((v) => typeof v === 'string').join(' ').replace(/<[^>]+>/g, ' ')); };
const newElId = () => Math.random().toString(16).slice(2, 9).padEnd(7, '0');

// deterministic unique-carrier heading finder (same semantics as the selftest / existing attack), per band.
function findUC(tree, band, cap) {
  const root = Array.isArray(tree) ? tree[0] : tree;
  const boxes = (cap.boxIndex && cap.boxIndex.boxes) || {};
  const srcBandTexts = [...new Set((cap.srcTexts || []).filter((t) => t.y >= band.y0 && t.y < band.y1 && norm(t.t).length >= 4).map((t) => norm(t.t)))];
  if (!srcBandTexts.length) return null;
  const inBand = [];
  walk(root.elements, (n) => { const b = n.id && boxes[n.id]; if (b && b.y < band.y1 && b.y + b.h > band.y0) inBand.push({ node: n, blob: blobOf(n) }); });
  for (const cand of inBand) {
    if (cand.node.widgetType !== 'heading' || typeof (cand.node.settings || {}).title !== 'string') continue;
    const bb = cand.node.id && boxes[cand.node.id];
    if (!bb || bb.y < band.y0 || bb.y + bb.h > band.y1) continue;
    const title = norm(String(cand.node.settings.title).replace(/<[^>]+>/g, ' '));
    if (title.length < 4) continue;
    for (const st of srcBandTexts) {
      if (!title.includes(st)) continue;
      const carriers = inBand.filter((x) => x.blob.includes(st)).length;
      if (carriers === 1) return { id: cand.node.id, title, srcText: st, box: bb };
    }
  }
  return null;
}

const once = (fn) => (tree, band, layout, cap, x) => { if (x.iteration > 1) return null; return fn(tree, band, layout, cap, x); };
// mutate the band's UC heading in place; null if no UC heading this band
const onUC = (mut) => once((tree, band, layout, cap) => {
  const f = findUC(tree, band, cap); if (!f) return null;
  const root = Array.isArray(tree) ? tree[0] : tree; let done = false;
  walk(root.elements, (n, arr, i) => { if (!done && n.id === f.id) { done = mut(n, arr, i, band, f, cap) !== false; } });
  return done ? tree : null;
});

(async () => {
  try { execSync("pkill -9 -f 'chrome-headless-shell' 2>/dev/null || true", { stdio: 'ignore' }); } catch {}
  try { const sw = await sweep({ maxAgeMin: 60 }); if (sw.deleted.length) console.log(`pre-sweep removed ${sw.deleted.length}`); } catch {}
  if (!loadSrcCache(SOURCE)) { console.error('no frozen src cache'); process.exit(3); }
  const hash0 = await liveHash(PAGE);
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const report = { source: SOURCE, page: PAGE, hash0, bandsProbed: [], byOp: {} };
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const prep = await prepare({ source: SOURCE, pageId: PAGE, ctx });
    const cap = { srcShot: prep.srcCache.shot, srcTexts: prep.srcCache.texts, boxIndex: prep.boxIndex, W };
    const H = Math.min(prep.srcCache.shot.height, prep.cloneFullH);
    const bounds = [...prep.srcCache.sections.filter((y) => y < prep.srcCache.pageH), prep.srcCache.pageH];
    const bands = [];
    for (let i = 0; i < bounds.length - 1; i++) { const y0 = bounds[i], y1 = bounds[i + 1]; if (y1 - y0 >= 20 && Math.min(H, y1) - y0 > 8) bands.push({ idx: i, y0, y1 }); }
    // every band that has a unique-carrier heading (these are the only ones the matched-deletion signal is clean on)
    const ucBands = [];
    for (const b of bands) { const f = findUC(prep.tree, b, cap); if (f) ucBands.push({ ...b, heading: f.id, title: f.title, hbox: f.box }); }
    report.bandsProbed = ucBands.map((b) => ({ idx: b.idx, y0: b.y0, y1: b.y1, heading: b.heading, title: b.title, hbox: b.hbox }));
    console.log(`UC-heading bands: ${ucBands.map((b) => `§${b.idx}`).join(' ')} (n=${ucBands.length})`);

    // ---- operators ----
    // control: delete the UC heading (measures the visual-rise-on-hide per band → finds the hot band)
    registerOperator('nv-delete', onUC((n, arr, i) => { arr.splice(i, 1); }));
    // clip18 — width-clip escape of the D1 pixel paint-energy floor
    registerOperator('nv-clip18', onUC((n) => {
      n.settings.title = `<span style="display:inline-block;width:18px;max-width:18px;overflow:hidden;white-space:nowrap;vertical-align:top">${n.settings.title}</span>`;
    }));
    // graze — straddle the band's bottom edge: 9px in-band (>= D2 floor), bulk of glyphs rendered below y1
    registerOperator('nv-graze', onUC((n, a, i, band) => {
      n.settings = { ...(n.settings || {}), _position: 'absolute', _offset_orientation_v: 'start', _offset_y: { unit: 'px', size: band.y1 - 9 } };
    }));
    // decoyNative — hide the native render (display:none) but keep it in the band tree (nativeBlob still has the
    // text → editability scores native); supply the VISIBLE text from a non-editable html widget at the same box
    registerOperator('nv-decoyNative', onUC((n, arr, i, band, f, capd) => {
      const box = (capd.boxIndex.boxes || {})[f.id] || f.box;
      const color = (typeof n.settings.title_color === 'string' && n.settings.title_color) ? n.settings.title_color : '#111827';
      const fsz = (n.settings.typography_font_size && typeof n.settings.typography_font_size.size === 'number') ? n.settings.typography_font_size.size : 32;
      const raw = stripTags(n.settings.title).trim();
      n.settings.title = `<span style="display:none">${n.settings.title}</span>`; // dead native carrier, still in nativeBlob
      const htmlNode = {
        id: newElId(), elType: 'widget', widgetType: 'html', isInner: false, elements: [],
        settings: {
          html: `<h2 style="margin:0;font-size:${fsz}px;line-height:1.1;color:${color}">${raw}</h2>`,
          _position: 'absolute', _offset_orientation_v: 'start', _offset_y: { unit: 'px', size: Math.round(box.y) },
          _offset_orientation_h: 'start', _offset_x: { unit: 'px', size: Math.round(box.x) }, _z_index: '5',
        },
      };
      arr.splice(i + 1, 0, htmlNode);
    }));
    // shortcodeSwap — heading → shortcode widget (D3 whitelist is "not html" → counts native 1.0)
    registerOperator('nv-shortcodeSwap', onUC((n) => {
      const raw = stripTags(n.settings.title).trim();
      const keepUnderscore = {}; for (const k of Object.keys(n.settings)) if (k.startsWith('_')) keepUnderscore[k] = n.settings[k];
      n.widgetType = 'shortcode';
      n.settings = { shortcode: raw, ...keepUnderscore };
    }));

    const OPS = ['nv-delete', 'nv-clip18', 'nv-graze', 'nv-decoyNative', 'nv-shortcodeSwap'];
    for (const op of OPS) {
      console.log(`\n===== ${op} (all ${ucBands.length} UC bands) =====`);
      const r = await refineSections({ source: SOURCE, pageId: PAGE, bands: ucBands.map((b) => ({ idx: b.idx, y0: b.y0, y1: b.y1 })), operatorName: op, apply: false, outDir: `/tmp/c5val-novel/${op}`, maxIters: 1, ctx });
      const rows = (r.perBand || []).map((pb) => {
        const c = pb.candidates && pb.candidates.find((x) => x.scored);
        return {
          idx: pb.band.idx, baselineVisual: pb.baseline && pb.baseline.visual,
          decision: c ? c.decision : (pb.candidates && pb.candidates[0] ? pb.candidates[0].decision : 'no-candidate'),
          failedGates: c ? c.failedGates : null, deltas: c ? c.deltas : null,
          candVisual: c ? c.candidate.visual : null,
        };
      });
      report.byOp[op] = { totalKept: r.totalKept, gradedUntouched: r.gradedUntouchedPreApply, rows };
      for (const row of rows) console.log(`  §${row.idx}: ${row.decision} base ${row.baselineVisual}→${row.candVisual} gates=[${(row.failedGates || []).join(',')}] Δ=${JSON.stringify(row.deltas)}`);
      console.log(`  ${op}: totalKept=${r.totalKept}`);
    }

    // hot-band summary: where does hiding raise visual the most?
    const del = report.byOp['nv-delete'];
    const hot = (del.rows || []).filter((x) => x.deltas).sort((a, b) => (b.deltas.visual || -9) - (a.deltas.visual || -9))[0];
    report.hotBand = hot ? { idx: hot.idx, deleteVisualDelta: hot.deltas.visual } : null;

    const hash1 = await liveHash(PAGE);
    report.hash1 = hash1; report.gradedUntouched = hash0 === hash1;
    const sw = await sweep({ all: true });
    report.sweptAfter = sw.deleted;
  } catch (e) {
    console.error(String(e && e.stack || e)); report.infraError = String(e);
    fs.writeFileSync('/tmp/c5val-novel-report.json', JSON.stringify(report, null, 2)); process.exit(3);
  } finally { await browser.close(); }
  fs.writeFileSync('/tmp/c5val-novel-report.json', JSON.stringify(report, null, 2));
  const anyKept = Object.values(report.byOp).some((o) => o.totalKept > 0);
  console.log(`\nNOVEL SWEEP: ${anyKept ? 'KEEP(S) PRESENT — HOLE(S)' : 'ALL REJECTED'}; hotBand ${JSON.stringify(report.hotBand)}; graded untouched ${report.gradedUntouched}`);
  for (const [op, o] of Object.entries(report.byOp)) console.log(`  ${op}: totalKept=${o.totalKept}`);
  process.exit(!anyKept && report.gradedUntouched ? 0 : 4);
})();
