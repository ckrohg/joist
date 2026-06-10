#!/usr/bin/env node
/**
 * @purpose FRESH GATE-ATTACK CRITIC (C round 5b, independent) — my OWN novel evasions + re-run of 3 pinned
 * attacks on the HOT band (tailwind 3146 §1 hero, heading 654d3b8e). PROPOSAL mode only — graded page 3146 is
 * GET-only (hash verified before/after). Report → /tmp/c5b-critic-report.json
 *
 * NOVEL evasions (mine, targeting the box-vs-glyph blind spot + the prompt's suggested vectors):
 *   nv-textindent  text-indent:-9999px on a block span — element box stays in-band (D2 ok), opacity/ca 1 (D1 ok),
 *                  scrollWidth shows no POSITIVE overflow (clip check sees nothing), glyphs render off-screen-left.
 *   nv-clippath    clip-path:inset(100%) on a block span — box/opacity/sw all normal; glyphs are clipped to
 *                  nothing by a property none of the deterministic gates inspect.
 *   nv-colorbg     color := exact dominant band bg, opacity 1, ca 1 — full-opacity color-matched text (ghost45 but
 *                  at opacity 1 so the D1 opacity floor cannot fire). Tests whether the pixel paint floor catches
 *                  bg-matched glyphs over the busy hero bg.
 *   nv-scale001    transform:scale(0.01) on a block span — getBoundingClientRect reflects the transform, so the
 *                  box collapses below DEGENERATE_PX. EXPECTED to be caught (sanity that the clip gate holds).
 *   nv-zbury       insert an opaque html sibling at higher z-index covering the heading box — heading leaf box is
 *                  untouched (D2/D1 DOM ok); only the SHOT paint over the box changes. Tests the paint floor.
 * Pinned re-runs (independent): mal-delete (control), nv-clip18, nv-graze (the two former live keeps).
 */
import fs from 'fs';
import { execSync } from 'child_process';
import { chromium } from 'playwright';
import { norm, W, loadSrcCache } from './grade-sections.mjs';
import { sweep } from './scratch-harness.mjs';
import { prepare, liveHash, DEGENERATE_PX } from './sectionvisual.mjs';
import { refineSections, registerOperator } from './refine-sections.mjs';

const SOURCE = 'https://tailwindcss.com', PAGE = 3146;
const HOT = { idx: 1, y0: 153, y1: 617, heading: '654d3b8e' };
const walk = (nodes, fn) => { for (let i = 0; i < (nodes || []).length; i++) { fn(nodes[i], nodes, i); walk(nodes[i].elements, fn); } };
const stripTags = (s) => String(s).replace(/<[^>]+>/g, ' ');
const newElId = () => Math.random().toString(16).slice(2, 9).padEnd(7, '0');

function dominantBg(shot, x0, ya, x1, yb) {
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
}

(async () => {
  try { execSync("pkill -9 -f 'chrome-headless-shell' 2>/dev/null || true", { stdio: 'ignore' }); } catch {}
  try { const sw = await sweep({ maxAgeMin: 60 }); if (sw.deleted.length) console.log(`pre-sweep removed ${sw.deleted.length}`); } catch {}
  if (!loadSrcCache(SOURCE)) { console.error('no frozen src cache'); process.exit(3); }
  const hash0 = await liveHash(PAGE);
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const report = { source: SOURCE, page: PAGE, hash0, hot: HOT, results: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const prep = await prepare({ source: SOURCE, pageId: PAGE, ctx });
    const boxes = prep.boxIndex.boxes;
    const hbox = boxes[HOT.heading];
    if (!hbox) throw new Error(`hot heading ${HOT.heading} not in box index`);
    report.headingBox = hbox;
    // confirm the heading node exists in the tree
    let found = null; walk((Array.isArray(prep.tree) ? prep.tree[0] : prep.tree).elements, (n) => { if (n.id === HOT.heading) found = n; });
    if (!found || found.widgetType !== 'heading') throw new Error(`hot heading ${HOT.heading} not a heading node`);
    report.headingTitle = String(found.settings.title);
    const bg = dominantBg(prep.srcCache.shot, hbox.x - 16, hbox.y - 8, hbox.x + hbox.w + 16, hbox.y + hbox.h + 8);
    report.bg = bg;

    const once = (fn) => (tree, band, layout, capd, x) => { if (x.iteration > 1) return null; return fn(tree, band, layout, capd, x); };
    const onUC = (mut) => once((tree, band) => {
      const root = Array.isArray(tree) ? tree[0] : tree; let done = false;
      walk(root.elements, (n, arr, i) => { if (!done && n.id === HOT.heading) { done = mut(n, arr, i, band) !== false; } });
      return done ? tree : null;
    });
    const spanTitle = (n, style) => { n.settings.title = `<span style="${style}">${n.settings.title}</span>`; };

    // ---- NOVEL ----
    registerOperator('nv-textindent', onUC((n) => { spanTitle(n, 'display:block;text-indent:-9999px;white-space:nowrap;overflow:hidden'); }));
    registerOperator('nv-clippath', onUC((n) => { spanTitle(n, 'display:block;-webkit-clip-path:inset(100%);clip-path:inset(100%)'); }));
    registerOperator('nv-colorbg', onUC((n) => { spanTitle(n, `color:rgb(${bg[0]},${bg[1]},${bg[2]});opacity:1`); }));
    registerOperator('nv-scale001', onUC((n) => { spanTitle(n, 'display:inline-block;transform:scale(0.01);transform-origin:top left'); }));
    registerOperator('nv-zbury', onUC((n, arr, i) => {
      const b = hbox;
      arr.splice(i + 1, 0, {
        id: newElId(), elType: 'widget', widgetType: 'html', isInner: false, elements: [],
        settings: {
          html: `<div style="width:${Math.round(b.w)}px;height:${Math.round(b.h)}px;background-color:rgb(${bg[0]},${bg[1]},${bg[2]})"></div>`,
          _position: 'absolute', _offset_orientation_v: 'start', _offset_y: { unit: 'px', size: Math.round(b.y) },
          _offset_orientation_h: 'start', _offset_x: { unit: 'px', size: Math.round(b.x) }, _z_index: '50',
        },
      });
    }));

    // ---- PINNED re-runs (independent) ----
    registerOperator('mal-delete', onUC((n, arr, i) => { arr.splice(i, 1); }));
    registerOperator('nv-clip18', onUC((n) => { n.settings.title = `<span style="display:inline-block;width:18px;max-width:18px;overflow:hidden;white-space:nowrap;vertical-align:top">${n.settings.title}</span>`; }));
    registerOperator('nv-graze', onUC((n, a, i, band) => { n.settings = { ...(n.settings || {}), _position: 'absolute', _offset_orientation_v: 'start', _offset_y: { unit: 'px', size: band.y1 - 9 } }; }));

    const NOVEL = ['nv-textindent', 'nv-clippath', 'nv-colorbg', 'nv-scale001', 'nv-zbury'];
    const PINNED = ['mal-delete', 'nv-clip18', 'nv-graze'];
    for (const op of [...NOVEL, ...PINNED]) {
      console.log(`\n===== ${op} (${NOVEL.includes(op) ? 'NOVEL' : 'PINNED'}) =====`);
      const r = await refineSections({ source: SOURCE, pageId: PAGE, bands: [{ idx: HOT.idx, y0: HOT.y0, y1: HOT.y1 }], operatorName: op, apply: false, outDir: `/tmp/c5b-critic/${op}`, maxIters: 1, ctx });
      const pb = r.perBand[0];
      const cand = pb && pb.candidates.find((c) => c.scored);
      const failed = (cand && cand.failedGates) || [];
      const detRejected = failed.includes('textCoverage') || failed.includes('editability') || failed.includes('noNewVoid') || failed.includes('noNewRastered') || failed.includes('gradable');
      report.results.push({
        op, novel: NOVEL.includes(op), kept: r.totalKept,
        decision: cand ? cand.decision : (pb && pb.candidates[0] ? pb.candidates[0].decision : 'no-candidate'),
        failedGates: cand ? cand.failedGates : null, deltas: cand ? cand.deltas : null,
        detRejected, visualOnly: cand ? (!cand.gates.visual && failed.length === 1) : null,
        baseline: pb && pb.baseline ? { visual: pb.baseline.visual, matchedTexts: pb.baseline.matchedTexts, editability: pb.baseline.editability, leafAudit: pb.baseline.leafAudit } : null,
        candidate: cand ? { visual: cand.candidate.visual, matchedTexts: cand.candidate.matchedTexts, editability: cand.candidate.editability, leafAudit: cand.candidate.leafAudit } : null,
      });
    }
    const hash1 = await liveHash(PAGE);
    report.hash1 = hash1; report.gradedUntouched = hash0 === hash1;
    const sw = await sweep({ all: true });
    report.sweptAfter = sw.deleted;
  } catch (e) {
    console.error(String(e && e.stack || e)); report.infraError = String(e);
    fs.writeFileSync('/tmp/c5b-critic-report.json', JSON.stringify(report, null, 2)); process.exit(3);
  } finally { await browser.close(); }
  fs.writeFileSync('/tmp/c5b-critic-report.json', JSON.stringify(report, null, 2));
  const keeps = report.results.filter((r) => r.kept > 0);
  const visualOnly = report.results.filter((r) => r.kept === 0 && r.decision === 'rejected' && r.visualOnly);
  console.log(`\n==== SUMMARY (graded untouched ${report.gradedUntouched}) ====`);
  for (const r of report.results) console.log(`  ${r.op}${r.novel ? ' [NOVEL]' : ''}: ${r.decision} kept=${r.kept} det=${r.detRejected} visualOnly=${r.visualOnly} gates=[${(r.failedGates || []).join(',')}] Δ=${JSON.stringify(r.deltas)}`);
  console.log(`\nKEEPS: ${keeps.map((r) => r.op).join(', ') || 'none'}`);
  console.log(`VISUAL-ONLY rejections: ${visualOnly.map((r) => r.op).join(', ') || 'none'}`);
  process.exit(0);
})();
