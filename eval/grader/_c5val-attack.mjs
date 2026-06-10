#!/usr/bin/env node
/**
 * @purpose C round 5 INDEPENDENT VALIDATION — adversarial gate sweep on refine-sections' hardened keep gates.
 * Re-implements ALL SIX malicious operators from the C-r4 gate-attack round (mal-delete, mal-1char, mal-move,
 * mal-tinyfont, mal-fade, mal-htmlswap) + TWO NEW evasions targeting the NEW checks:
 *   mal-ghost45  — opacity 0.45 (just above VIS_OPACITY_FLOOR 0.4) + text color set to the dominant source bg
 *                  under the heading → DOM floors pass; only the paint-energy floor (VIS_PAINT_MIN) can catch it.
 *   mal-edgepark — move the heading to the band's last pixel rows (_offset_y = y1-2) → 2px graze; a naive
 *                  any-overlap bound would count it; the min(8px,25%h) overlap floor must drop it.
 * PROPOSAL mode on tailwind 3146 (graded page GET-only, hash-verified). ALL EIGHT must be REJECTED.
 * Report → /tmp/c5val-attack-report.json
 */
import fs from 'fs';
import { execSync } from 'child_process';
import { chromium } from 'playwright';
import { norm, W, loadSrcCache } from './grade-sections.mjs';
import { sweep, TAG } from './scratch-harness.mjs';
import { prepare, api, liveHash } from './sectionvisual.mjs';
import { refineSections, registerOperator } from './refine-sections.mjs';
// NOTE: findDeletableHeading is INLINED below (not imported) because _refine-sections-selftest.mjs runs its
// whole test IIFE as an import side-effect — importing it would launch a second selftest sharing this browser.

const SOURCE = 'https://tailwindcss.com', PAGE = 3146;
const walk = (nodes, fn, parent = null) => { for (let i = 0; i < (nodes || []).length; i++) { fn(nodes[i], nodes, i, parent); walk(nodes[i].elements, fn, nodes[i]); } };
const blobOf = (n) => { const s = (n && n.settings) || {}; return norm([s.title, s.editor, s.html, s.text].filter((v) => typeof v === 'string').join(' ').replace(/<[^>]+>/g, ' ')); };
// inlined copy of the selftest's deterministic unique-carrier heading finder (same semantics)
function findDeletableHeading(tree, band, cap) {
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
      if (carriers === 1) return { id: cand.node.id, title, srcText: st };
    }
  }
  return null;
}

// dominant-4-bit-bucket mean RGB over a source-shot region (glyphs are the minority bucket → result ≈ bg)
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
  const report = { source: SOURCE, page: PAGE, hash0, results: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const prep = await prepare({ source: SOURCE, pageId: PAGE, ctx });
    const cap = { srcShot: prep.srcCache.shot, srcTexts: prep.srcCache.texts, boxIndex: prep.boxIndex, W };
    const H = Math.min(prep.srcCache.shot.height, prep.cloneFullH);
    const bounds = [...prep.srcCache.sections.filter((y) => y < prep.srcCache.pageH), prep.srcCache.pageH];
    const bands = [];
    for (let i = 0; i < bounds.length - 1; i++) { const y0 = bounds[i], y1 = bounds[i + 1]; if (y1 - y0 >= 20 && Math.min(H, y1) - y0 > 8) bands.push({ idx: i, y0, y1 }); }
    const found = (() => {
      for (const b of bands.slice().sort((x, y) => (x.y1 - x.y0) - (y.y1 - y.y0))) {
        const f = findDeletableHeading(prep.tree, b, cap); if (f) return { band: b, ...f };
      } return null;
    })();
    if (!found) throw new Error('no unique-carrier heading found');
    const box = prep.boxIndex.boxes[found.id];
    const bg = dominantBg(prep.srcCache.shot, box.x - 16, box.y - 8, box.x + box.w + 16, box.y + box.h + 8);
    console.log(`target band §${found.band.idx} y${found.band.y0}-${found.band.y1} heading ${found.id} "${found.title}" box ${JSON.stringify(box)} srcBg rgb(${bg})`);
    report.target = { band: found.band, heading: found.id, title: found.title, box, srcBg: bg };

    const once = (fn) => (tree, band, layout, capd, x) => { if (x.iteration > 1) return null; return fn(tree, band, layout, capd, x); };
    const onHeading = (mut) => once((tree, band) => {
      const root = Array.isArray(tree) ? tree[0] : tree; let done = false;
      walk(root.elements, (n, arr, i) => { if (!done && n.id === found.id) { done = mut(n, arr, i, band) !== false; } });
      return done ? tree : null;
    });
    const spanTitle = (n, style) => { n.settings.title = `<span style="${style}">${n.settings.title}</span>`; };

    // ---- the six C-r4 operators, re-implemented ----
    registerOperator('mal-delete', onHeading((n, arr, i) => { arr.splice(i, 1); }));
    registerOperator('mal-1char', onHeading((n) => {
      const t = String(n.settings.title); const j = t.search(/[a-z]/i); if (j < 0) return false;
      n.settings.title = t.slice(0, j) + '3' + t.slice(j + 1); // 1-char corruption → normalized text no longer matches source
    }));
    registerOperator('mal-move', onHeading((n, a, i, band) => {
      n.settings = { ...(n.settings || {}), _position: 'absolute', _offset_orientation_v: 'start', _offset_y: { unit: 'px', size: band.y1 + 600 } };
    }));
    registerOperator('mal-tinyfont', onHeading((n) => { spanTitle(n, 'font-size:6px'); }));
    registerOperator('mal-fade', onHeading((n) => { spanTitle(n, 'opacity:0.06'); }));
    registerOperator('mal-htmlswap', onHeading((n) => {
      const s = n.settings;
      const color = (typeof s.title_color === 'string' && s.title_color) ? s.title_color : '';
      const fsz = (s.typography_font_size && typeof s.typography_font_size.size === 'number') ? s.typography_font_size.size : 32;
      n.widgetType = 'html';
      const next = { html: `<h2 style="margin:0;font-size:${fsz}px;line-height:1.1;${color ? 'color:' + color : ''}">${s.title}</h2>` };
      for (const k of Object.keys(s)) if (k.startsWith('_')) next[k] = s[k];
      n.settings = next;
    }));
    // ---- two NEW evasions targeting the NEW checks ----
    registerOperator('mal-ghost45', onHeading((n) => { spanTitle(n, `opacity:0.45;color:rgb(${bg[0]},${bg[1]},${bg[2]})`); }));
    registerOperator('mal-edgepark', onHeading((n, a, i, band) => {
      n.settings = { ...(n.settings || {}), _position: 'absolute', _offset_orientation_v: 'start', _offset_y: { unit: 'px', size: band.y1 - 2 } };
    }));

    const OPS = ['mal-delete', 'mal-1char', 'mal-move', 'mal-tinyfont', 'mal-fade', 'mal-htmlswap', 'mal-ghost45', 'mal-edgepark'];
    for (const op of OPS) {
      console.log(`\n=== ${op} ===`);
      const r = await refineSections({ source: SOURCE, pageId: PAGE, bands: [found.band], operatorName: op, apply: false, outDir: `/tmp/c5val-attack/${op}`, maxIters: 1, ctx });
      const cand = r.perBand[0] && r.perBand[0].candidates.find((c) => c.scored);
      report.results.push({
        op, kept: r.totalKept,
        decision: cand ? cand.decision : (r.perBand[0] && r.perBand[0].candidates[0] ? r.perBand[0].candidates[0].decision : 'no-candidate'),
        failedGates: cand ? cand.failedGates : null, deltas: cand ? cand.deltas : null,
        candidate: cand ? cand.candidate : null, baseline: r.perBand[0] && r.perBand[0].baseline,
        gradedUntouched: r.gradedUntouchedPreApply,
      });
    }
    const hash1 = await liveHash(PAGE);
    report.hash1 = hash1; report.gradedUntouched = hash0 === hash1;
    const sw = await sweep({ all: true });
    report.sweptAfter = sw.deleted;
  } catch (e) {
    console.error(String(e && e.stack || e)); report.infraError = String(e);
    fs.writeFileSync('/tmp/c5val-attack-report.json', JSON.stringify(report, null, 2)); process.exit(3);
  } finally { await browser.close(); }
  fs.writeFileSync('/tmp/c5val-attack-report.json', JSON.stringify(report, null, 2));
  const allRejected = report.results.length === 8 && report.results.every((r) => r.kept === 0);
  console.log(`\nATTACK SWEEP: ${allRejected ? 'ALL 8 REJECTED' : 'KEEP(S) PRESENT — HOLES'}; graded untouched ${report.gradedUntouched}`);
  for (const r of report.results) console.log(`  ${r.op}: ${r.decision} kept=${r.kept} gates=[${(r.failedGates || []).join(',')}] deltas=${JSON.stringify(r.deltas)}`);
  process.exit(allRejected && report.gradedUntouched ? 0 : 4);
})();
