#!/usr/bin/env node
/**
 * @purpose C round 5b VALIDATION HARNESS (temp, uncommitted) — runs the validation standard end-to-end:
 * (1) SWEEP every unique-carrier-heading band with a delete control → the HOT band is the one where hiding
 * text GAINS band visual the most (tailwind 3146 → §1 hero, Δvisual +0.046 per /tmp/c5val-novel-report.json);
 * (2) the FULL 12-attack corpus on the hot band: mal-delete, mal-1char, mal-move, mal-tinyfont, mal-fade,
 * mal-htmlswap, mal-ghost45, mal-edgepark (C-r5) + nv-clip18, nv-graze, nv-decoyNative, nv-shortcodeSwap
 * (C-r5b novel evasions). PASS = EVERY corpus op rejected by a DETERMINISTIC gate (textCoverage or
 * editability) — rejections that rely on the visual gate alone DO NOT COUNT on the hot band (visual is ±noise
 * there by construction);
 * (3) TWO FRESH evasions targeting the NEW checks at their thresholds (reported separately, holes ≠ papered):
 *   nv-clipEdge — overflow-clip the heading to ~35% of its content height: just ABOVE CLIP_MIN_FRAC (0.3), so
 *                 the D1b clip check passes by design while ~2/3 of the glyph area never paints. Probes whether
 *                 the clip threshold is lenient enough to hide most of a text deterministically-undetected.
 *   nv-padPark  — wrap the title in an inline-block span with padding-top pushing EVERY glyph below the band's
 *                 bottom edge while the leaf BOX top stays in-band (box ov >= 50% h, first line of the BOX in
 *                 band). Probes the box-vs-glyph blind spot of the proportional D2 overlap (the captured leaf
 *                 box includes padding; glyph positions are not captured).
 * PROPOSAL mode: graded page 3146 GET-only (hash verified). Report → /tmp/c5b-hotband-report.json
 * Usage: node _c5b-hotband.mjs [--ops nv-clip18,nv-graze | all] [--no-sweep]   (default: sweep + all 12 + 2 fresh)
 */
import fs from 'fs';
import { execSync } from 'child_process';
import { chromium } from 'playwright';
import { norm, W, loadSrcCache } from './grade-sections.mjs';
import { sweep } from './scratch-harness.mjs';
import { prepare, liveHash, DEGENERATE_PX } from './sectionvisual.mjs';
import { refineSections, registerOperator } from './refine-sections.mjs';

const SOURCE = 'https://tailwindcss.com', PAGE = 3146;
const argIdx = process.argv.indexOf('--ops');
const opsArg = argIdx > -1 ? process.argv[argIdx + 1] : 'all';

const walk = (nodes, fn) => { for (let i = 0; i < (nodes || []).length; i++) { fn(nodes[i], nodes, i); walk(nodes[i].elements, fn); } };
const stripTags = (s) => String(s).replace(/<[^>]+>/g, ' ');
const blobOf = (n) => { const s = (n && n.settings) || {}; return norm([s.title, s.editor, s.html, s.text].filter((v) => typeof v === 'string').join(' ').replace(/<[^>]+>/g, ' ')); };
const newElId = () => Math.random().toString(16).slice(2, 9).padEnd(7, '0');

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
  const report = { source: SOURCE, page: PAGE, hash0, hotBand: null, results: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const prep = await prepare({ source: SOURCE, pageId: PAGE, ctx });
    const cap = { srcShot: prep.srcCache.shot, srcTexts: prep.srcCache.texts, boxIndex: prep.boxIndex, W };
    const H = Math.min(prep.srcCache.shot.height, prep.cloneFullH);
    const bounds = [...prep.srcCache.sections.filter((y) => y < prep.srcCache.pageH), prep.srcCache.pageH];
    const bands = [];
    for (let i = 0; i < bounds.length - 1; i++) { const y0 = bounds[i], y1 = bounds[i + 1]; if (y1 - y0 >= 20 && Math.min(H, y1) - y0 > 8) bands.push({ idx: i, y0, y1 }); }
    // PHASE 1 — UC-BAND SWEEP (the validation standard): delete control on EVERY unique-carrier band; the HOT
    // band is the one where hiding the text GAINS band visual the most. --no-sweep falls back to first-UC.
    const ucBands = [];
    for (const b of bands) { const f = findUC(prep.tree, b, cap); if (f) ucBands.push({ band: b, ...f }); }
    if (!ucBands.length) throw new Error('no UC-heading band');
    console.log(`UC-heading bands: ${ucBands.map((u) => `§${u.band.idx}`).join(' ')} (n=${ucBands.length})`);
    let hot = ucBands[0];
    if (!process.argv.includes('--no-sweep')) {
      registerOperator('nv-delete-sweep', (tree, band, layout, capd, x) => {
        if (x.iteration > 1) return null;
        const f = findUC(tree, band, capd); if (!f) return null;
        const root = Array.isArray(tree) ? tree[0] : tree; let done = false;
        walk(root.elements, (n, arr, i) => { if (!done && n.id === f.id) { arr.splice(i, 1); done = true; } });
        return done ? tree : null;
      });
      const sw = await refineSections({ source: SOURCE, pageId: PAGE, bands: ucBands.map((u) => u.band), operatorName: 'nv-delete-sweep', apply: false, outDir: '/tmp/c5b-hotband/sweep', maxIters: 1, ctx });
      report.sweep = (sw.perBand || []).map((pb) => {
        const c = pb.candidates && pb.candidates.find((x) => x.scored);
        return { idx: pb.band.idx, baselineVisual: pb.baseline && pb.baseline.visual, deltaVisual: c && c.deltas ? c.deltas.visual : null, decision: c ? c.decision : 'no-candidate', failedGates: c ? c.failedGates : null, kept: pb.kept };
      });
      report.sweepKept = sw.totalKept;
      console.log('\nSWEEP (delete control per UC band):');
      for (const r of report.sweep) console.log(`  §${r.idx}: Δvisual ${r.deltaVisual} (${r.decision} gates=[${(r.failedGates || []).join(',')}])`);
      const scored = report.sweep.filter((r) => r.deltaVisual != null);
      if (!scored.length) throw new Error('sweep produced no scored bands');
      const best = scored.slice().sort((a, b) => b.deltaVisual - a.deltaVisual || a.idx - b.idx)[0];
      hot = ucBands.find((u) => u.band.idx === best.idx);
      console.log(`HOT band by sweep: §${best.idx} (delete Δvisual ${best.deltaVisual >= 0 ? '+' : ''}${best.deltaVisual})`);
    }
    report.hotBand = { idx: hot.band.idx, y0: hot.band.y0, y1: hot.band.y1, heading: hot.id, title: hot.title };
    console.log(`HOT band §${hot.band.idx} y${hot.band.y0}-${hot.band.y1} heading ${hot.id} "${hot.title.slice(0, 60)}"`);
    const bg = dominantBg(prep.srcCache.shot, hot.box.x - 16, hot.box.y - 8, hot.box.x + hot.box.w + 16, hot.box.y + hot.box.h + 8);

    const once = (fn) => (tree, band, layout, capd, x) => { if (x.iteration > 1) return null; return fn(tree, band, layout, capd, x); };
    const onUC = (mut) => once((tree, band) => {
      const root = Array.isArray(tree) ? tree[0] : tree; let done = false;
      walk(root.elements, (n, arr, i) => { if (!done && n.id === hot.id) { done = mut(n, arr, i, band) !== false; } });
      return done ? tree : null;
    });
    const spanTitle = (n, style) => { n.settings.title = `<span style="${style}">${n.settings.title}</span>`; };

    registerOperator('mal-delete', onUC((n, arr, i) => { arr.splice(i, 1); }));
    registerOperator('mal-1char', onUC((n) => { const t = String(n.settings.title); const j = t.search(/[a-z]/i); if (j < 0) return false; n.settings.title = t.slice(0, j) + '3' + t.slice(j + 1); }));
    registerOperator('mal-move', onUC((n, a, i, band) => { n.settings = { ...(n.settings || {}), _position: 'absolute', _offset_orientation_v: 'start', _offset_y: { unit: 'px', size: band.y1 + 600 } }; }));
    registerOperator('mal-tinyfont', onUC((n) => { spanTitle(n, 'font-size:6px'); }));
    registerOperator('mal-fade', onUC((n) => { spanTitle(n, 'opacity:0.06'); }));
    registerOperator('mal-htmlswap', onUC((n) => {
      const s = n.settings;
      const color = (typeof s.title_color === 'string' && s.title_color) ? s.title_color : '';
      const fsz = (s.typography_font_size && typeof s.typography_font_size.size === 'number') ? s.typography_font_size.size : 32;
      n.widgetType = 'html';
      const next = { html: `<h2 style="margin:0;font-size:${fsz}px;line-height:1.1;${color ? 'color:' + color : ''}">${s.title}</h2>` };
      for (const k of Object.keys(s)) if (k.startsWith('_')) next[k] = s[k];
      n.settings = next;
    }));
    registerOperator('mal-ghost45', onUC((n) => { spanTitle(n, `opacity:0.45;color:rgb(${bg[0]},${bg[1]},${bg[2]})`); }));
    registerOperator('mal-edgepark', onUC((n, a, i, band) => { n.settings = { ...(n.settings || {}), _position: 'absolute', _offset_orientation_v: 'start', _offset_y: { unit: 'px', size: band.y1 - 2 } }; }));
    registerOperator('nv-clip18', onUC((n) => { n.settings.title = `<span style="display:inline-block;width:18px;max-width:18px;overflow:hidden;white-space:nowrap;vertical-align:top">${n.settings.title}</span>`; }));
    registerOperator('nv-graze', onUC((n, a, i, band) => { n.settings = { ...(n.settings || {}), _position: 'absolute', _offset_orientation_v: 'start', _offset_y: { unit: 'px', size: band.y1 - 9 } }; }));
    registerOperator('nv-decoyNative', onUC((n, arr, i) => {
      const box = hot.box;
      const color = (typeof n.settings.title_color === 'string' && n.settings.title_color) ? n.settings.title_color : '#111827';
      const fsz = (n.settings.typography_font_size && typeof n.settings.typography_font_size.size === 'number') ? n.settings.typography_font_size.size : 32;
      const raw = stripTags(n.settings.title).trim();
      n.settings.title = `<span style="display:none">${n.settings.title}</span>`;
      arr.splice(i + 1, 0, {
        id: newElId(), elType: 'widget', widgetType: 'html', isInner: false, elements: [],
        settings: {
          html: `<h2 style="margin:0;font-size:${fsz}px;line-height:1.1;color:${color}">${raw}</h2>`,
          _position: 'absolute', _offset_orientation_v: 'start', _offset_y: { unit: 'px', size: Math.round(box.y) },
          _offset_orientation_h: 'start', _offset_x: { unit: 'px', size: Math.round(box.x) }, _z_index: '5',
        },
      });
    }));
    registerOperator('nv-shortcodeSwap', onUC((n) => {
      const raw = stripTags(n.settings.title).trim();
      const keepUnderscore = {}; for (const k of Object.keys(n.settings)) if (k.startsWith('_')) keepUnderscore[k] = n.settings[k];
      n.widgetType = 'shortcode';
      n.settings = { shortcode: raw, ...keepUnderscore };
    }));
    // ---- FRESH evasions (C-r5b critic round, threshold probes of the NEW checks; see header) ----
    registerOperator('nv-clipEdge', onUC((n) => {
      const hClip = Math.max(DEGENERATE_PX + 2, Math.ceil(hot.box.h * 0.35)); // just ABOVE CLIP_MIN_FRAC·scrollHeight
      n.settings.title = `<span style="display:block;height:${hClip}px;overflow:hidden">${n.settings.title}</span>`;
    }));
    registerOperator('nv-padPark', onUC((n, a, i, band) => {
      const pad = Math.max(0, band.y1 - Math.round(hot.box.y) + 16); // every glyph lands just BELOW y1; box top stays at the natural y
      n.settings.title = `<span style="display:inline-block;padding-top:${pad}px">${n.settings.title}</span>`;
    }));

    const ALL = ['mal-delete', 'mal-1char', 'mal-move', 'mal-tinyfont', 'mal-fade', 'mal-htmlswap', 'mal-ghost45', 'mal-edgepark', 'nv-clip18', 'nv-graze', 'nv-decoyNative', 'nv-shortcodeSwap'];
    const FRESH = ['nv-clipEdge', 'nv-padPark'];
    const OPS = opsArg === 'all' ? [...ALL, ...FRESH] : opsArg.split(',').map((s) => s.trim()).filter(Boolean);
    for (const op of OPS) {
      console.log(`\n===== ${op} (hot band §${hot.band.idx})${FRESH.includes(op) ? ' [FRESH]' : ''} =====`);
      const r = await refineSections({ source: SOURCE, pageId: PAGE, bands: [hot.band], operatorName: op, apply: false, outDir: `/tmp/c5b-hotband/${op}`, maxIters: 1, ctx });
      const cand = r.perBand[0] && r.perBand[0].candidates.find((c) => c.scored);
      const failed = (cand && cand.failedGates) || [];
      const detRejected = failed.includes('textCoverage') || failed.includes('editability');
      report.results.push({
        op, fresh: FRESH.includes(op), kept: r.totalKept,
        decision: cand ? cand.decision : (r.perBand[0] && r.perBand[0].candidates[0] ? r.perBand[0].candidates[0].decision : 'no-candidate'),
        failedGates: cand ? cand.failedGates : null, deltas: cand ? cand.deltas : null, detRejected,
        baseline: r.perBand[0] && r.perBand[0].baseline ? { visual: r.perBand[0].baseline.visual, matchedTexts: r.perBand[0].baseline.matchedTexts, editability: r.perBand[0].baseline.editability } : null,
        candidate: cand ? { visual: cand.candidate.visual, matchedTexts: cand.candidate.matchedTexts, editability: cand.candidate.editability } : null,
        gradedUntouched: r.gradedUntouchedPreApply,
      });
    }
    const hash1 = await liveHash(PAGE);
    report.hash1 = hash1; report.gradedUntouched = hash0 === hash1;
    const sw = await sweep({ all: true });
    report.sweptAfter = sw.deleted;
  } catch (e) {
    console.error(String(e && e.stack || e)); report.infraError = String(e);
    fs.writeFileSync('/tmp/c5b-hotband-report.json', JSON.stringify(report, null, 2)); process.exit(3);
  } finally { await browser.close(); }
  const corpus = report.results.filter((r) => !r.fresh), fresh = report.results.filter((r) => r.fresh);
  const allDet = corpus.length > 0 && corpus.every((r) => r.kept === 0 && r.detRejected);
  const freshHoles = fresh.filter((r) => r.kept > 0 || !r.detRejected);
  report.corpusAllDeterministic = allDet; report.freshHoles = freshHoles.map((r) => ({ op: r.op, kept: r.kept, failedGates: r.failedGates, deltas: r.deltas }));
  fs.writeFileSync('/tmp/c5b-hotband-report.json', JSON.stringify(report, null, 2));
  console.log(`\nHOT-BAND SWEEP (corpus ${corpus.length}): ${allDet ? 'ALL REJECTED BY DETERMINISTIC GATES' : 'HOLE/VISUAL-ONLY REJECTION PRESENT'}; graded untouched ${report.gradedUntouched}`);
  for (const r of report.results) console.log(`  ${r.op}${r.fresh ? ' [FRESH]' : ''}: ${r.decision} kept=${r.kept} det=${r.detRejected} gates=[${(r.failedGates || []).join(',')}] Δ=${JSON.stringify(r.deltas)}`);
  if (fresh.length) console.log(freshHoles.length ? `FRESH-EVASION HOLE(S): ${freshHoles.map((r) => `${r.op} (kept=${r.kept}, det=${r.failedGates && (r.failedGates.includes('textCoverage') || r.failedGates.includes('editability'))})`).join('; ')} — REPORT LOUDLY, next-round mustFix` : 'fresh evasions: both deterministically rejected');
  process.exit(allDet && report.gradedUntouched ? 0 : 4);
})();
