#!/usr/bin/env node
/**
 * @purpose FRESH GATE-ATTACK CRITIC #2 — independent skeptical probe of the C-r5c glyph-geometry machinery
 * (Range getClientRects union + glyph-area clip gate + glyph-color ghost-contrast check). Pins the hot band to
 * tailwind 3146 §1 (--no-sweep path; ucBands[0]) and runs NOVEL evasions the C-5c harness did NOT cover, each
 * aimed at a specific seam of the NEW code, plus a mandated re-run of nv-padPark + nv-clipEdge.
 *
 * NOVEL OPS (mechanism each attacks):
 *   nv-firstletter  — giant first letter (font-size 140px), REST at font-size:0. The rest's per-text-node line
 *                     rects have height 0 → filtered by `r.height>0` → contribute nothing to ga/gva; only "r"
 *                     paints. Probes: does the glyph union + matchedTexts still see the full source string when
 *                     all but one letter is zero-sized? (a leaf at font-size:0 is also dropped at capture: fsz<10)
 *   nv-manyspans    — full title split into per-character <span> each color:#ffffff (white-on-white). "Range
 *                     rects across many inline spans": probes whether splitting defeats the per-leaf ghost check
 *                     (each captured 1-char leaf should read gc=white → ghost fires) and whether the union/
 *                     matchedTexts can still be assembled from many tiny leaves.
 *   nv-textfill     — color:#111827 (dark) + -webkit-text-fill-color:#ffffff (white fill). DECOUPLES the ghost
 *                     feed gc=getComputedStyle(el).color (reads dark) from the ACTUAL rendered glyph fill
 *                     (white). The single theoretical ghost bypass. Backstop = paint-energy floor on flat-white.
 *                     (If -webkit-text-fill-color is kses-stripped it renders dark = visible = honest control.)
 *   nv-bgcliptext   — background:#fff;-webkit-background-clip:text;-webkit-text-fill-color:transparent. Gradient/
 *                     clip-text idiom: glyphs painted by the BACKGROUND (white here) while color reads default.
 *                     Same ghost-decoupling family; different CSS path.
 *   nv-clippath     — clip-path:inset(0 0 90% 0) clips bottom 90% of the heading. The glyph-area clip gate (gva)
 *                     only intersects ancestor OVERFLOW clips — NOT clip-path. Probes whether clip-path bypasses
 *                     the glyph-clip gate. (clip-path is typically kses-stripped → renders full = honest control;
 *                     a KEEP with text clipped would be a real machinery gap.)
 *   nv-vertical     — writing-mode:vertical-rl rotates the heading to a tall narrow column. Probes glyph-box
 *                     in-band geometry for rotated text (rects are tall/narrow; the column may spill below y1).
 *                     Vertical text is still HUMAN-READABLE, so a reject here is correct, a keep is also fine —
 *                     included as a geometry sanity probe, not a hidden-text attack.
 *   nv-padPark (re) — mandated re-run: padding parks every glyph below y1 (box top stays in-band). Must REJECT.
 *   nv-clipEdge (re)— mandated re-run: overflow-clip to ~35% of content height. Must REJECT.
 *
 * VERDICT: a KEEP of genuinely-hidden text, or a visual-only (non-deterministic) reject of genuinely-hidden text,
 * is a HOLE (mustFix). A reject by textCoverage/editability is deterministic-safe. A reject by visual ONLY of a
 * NOT-genuinely-hidden op (vertical/legible) is acceptable. PROPOSAL mode: graded page 3146 GET-only.
 * Report → /tmp/c5c-critic2-report.json
 */
import fs from 'fs';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { chromium } from 'playwright';
import { norm, W, loadSrcCache } from './grade-sections.mjs';
import { sweep } from './scratch-harness.mjs';
import { prepare, liveHash, DEGENERATE_PX, GLYPH_VIS_MIN_FRAC, BAND_OVERLAP_MIN_FRAC } from './sectionvisual.mjs';
import { refineSections, registerOperator } from './refine-sections.mjs';

const SOURCE = 'https://tailwindcss.com', PAGE = 3146;
const argIdx = process.argv.indexOf('--ops');
const opsArg = argIdx > -1 ? process.argv[argIdx + 1] : 'all';

const walk = (nodes, fn) => { for (let i = 0; i < (nodes || []).length; i++) { fn(nodes[i], nodes, i); walk(nodes[i].elements, fn); } };
const blobOf = (n) => { const s = (n && n.settings) || {}; return norm([s.title, s.editor, s.html, s.text].filter((v) => typeof v === 'string').join(' ').replace(/<[^>]+>/g, ' ')); };
const sha = (p) => { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; } };

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
    const ucBands = [];
    for (const b of bands) { const f = findUC(prep.tree, b, cap); if (f) ucBands.push({ band: b, ...f }); }
    if (!ucBands.length) throw new Error('no UC-heading band');
    const hot = ucBands[0]; // --no-sweep path: §1 per the C-5c sweep
    report.hotBand = { idx: hot.band.idx, y0: hot.band.y0, y1: hot.band.y1, heading: hot.id, title: hot.title };
    console.log(`HOT band §${hot.band.idx} y${hot.band.y0}-${hot.band.y1} heading ${hot.id} "${hot.title.slice(0, 60)}"`);

    const once = (fn) => (tree, band, layout, capd, x) => { if (x.iteration > 1) return null; return fn(tree, band, layout, capd, x); };
    const onUC = (mut) => once((tree, band) => {
      const root = Array.isArray(tree) ? tree[0] : tree; let done = false;
      walk(root.elements, (n, arr, i) => { if (!done && n.id === hot.id) { done = mut(n, arr, i, band) !== false; } });
      return done ? tree : null;
    });

    registerOperator('nv-firstletter', onUC((n) => {
      const t = String(n.settings.title); const j = t.search(/[A-Za-z]/); if (j < 0) return false;
      const first = t[j], rest = t.slice(0, j) + t.slice(j + 1);
      n.settings.title = `<span style="font-size:140px;line-height:1">${first}</span><span style="font-size:0">${rest}</span>`;
    }));
    registerOperator('nv-manyspans', onUC((n) => {
      const t = String(n.settings.title);
      n.settings.title = [...t].map((ch) => `<span style="color:#ffffff">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
    }));
    registerOperator('nv-textfill', onUC((n) => {
      n.settings.title = `<span style="color:#111827;-webkit-text-fill-color:#ffffff">${n.settings.title}</span>`;
    }));
    registerOperator('nv-bgcliptext', onUC((n) => {
      n.settings.title = `<span style="background:#ffffff;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#111827">${n.settings.title}</span>`;
    }));
    registerOperator('nv-clippath', onUC((n) => {
      n.settings.title = `<span style="display:inline-block;clip-path:inset(0 0 90% 0)">${n.settings.title}</span>`;
    }));
    registerOperator('nv-vertical', onUC((n) => {
      n.settings.title = `<span style="display:inline-block;writing-mode:vertical-rl">${n.settings.title}</span>`;
    }));
    // mandated re-runs
    registerOperator('nv-clipEdge', onUC((n) => {
      const hClip = Math.max(DEGENERATE_PX + 2, Math.ceil(hot.box.h * 0.35));
      n.settings.title = `<span style="display:block;height:${hClip}px;overflow:hidden">${n.settings.title}</span>`;
    }));
    registerOperator('nv-padPark', onUC((n, a, i, band) => {
      const pad = Math.max(0, band.y1 - Math.round(hot.box.y) + 16);
      n.settings.title = `<span style="display:inline-block;padding-top:${pad}px">${n.settings.title}</span>`;
    }));

    const FRESH = ['nv-firstletter', 'nv-manyspans', 'nv-textfill', 'nv-bgcliptext', 'nv-clippath', 'nv-vertical'];
    const REPLAY = ['nv-padPark', 'nv-clipEdge'];
    // ops whose hidden-text intent means a NON-deterministic reject is a hole (vertical text is legible → exempt)
    const HIDING = new Set(['nv-firstletter', 'nv-manyspans', 'nv-textfill', 'nv-bgcliptext', 'nv-clippath', 'nv-padPark', 'nv-clipEdge']);
    const OPS = opsArg === 'all' ? [...FRESH, ...REPLAY] : opsArg.split(',').map((s) => s.trim()).filter(Boolean);
    for (const op of OPS) {
      console.log(`\n===== ${op} (hot band §${hot.band.idx}) =====`);
      const outDir = `/tmp/c5c-critic2/${op}`;
      const r = await refineSections({ source: SOURCE, pageId: PAGE, bands: [hot.band], operatorName: op, apply: false, outDir, maxIters: 1, ctx });
      const cand = r.perBand[0] && r.perBand[0].candidates.find((c) => c.scored);
      const failed = (cand && cand.failedGates) || [];
      const detRejected = failed.includes('textCoverage') || failed.includes('editability');
      const bandPng = `secvis-${PAGE}-${hot.band.y0}-${hot.band.y1}-band.png`;
      const baseSha = sha(`${outDir}/b${hot.band.idx}-baseline/${bandPng}`);
      const candSha = sha(`${outDir}/b${hot.band.idx}-cand1/${bandPng}`);
      const renderInert = !!(baseSha && candSha && baseSha === candSha);
      // pull leafAudit from the candidate secvis json for mechanism
      let leafAudit = null, divergenceFlags = null;
      try {
        const jf = `${outDir}/b${hot.band.idx}-cand1/secvis-${PAGE}-${hot.band.y0}-${hot.band.y1}.json`;
        const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
        leafAudit = (j.bandLocalText && j.bandLocalText.leafAudit) || j.leafAudit || null;
        divergenceFlags = j.divergenceFlags || null;
      } catch {}
      report.results.push({
        op, kept: r.totalKept,
        decision: cand ? cand.decision : (r.perBand[0] && r.perBand[0].candidates[0] ? r.perBand[0].candidates[0].decision : 'no-candidate'),
        failedGates: cand ? cand.failedGates : null, deltas: cand ? cand.deltas : null, detRejected, renderInert,
        baseSha: baseSha && baseSha.slice(0, 16), candSha: candSha && candSha.slice(0, 16),
        baseline: r.perBand[0] && r.perBand[0].baseline ? { visual: r.perBand[0].baseline.visual, matchedTexts: r.perBand[0].baseline.matchedTexts, editability: r.perBand[0].baseline.editability } : null,
        candidate: cand ? { visual: cand.candidate.visual, matchedTexts: cand.candidate.matchedTexts, editability: cand.candidate.editability } : null,
        leafAudit, divergenceFlags, candBandCrop: `${outDir}/b${hot.band.idx}-cand1/${bandPng}`,
        gradedUntouched: r.gradedUntouchedPreApply,
      });
    }
    const hash1 = await liveHash(PAGE);
    report.hash1 = hash1; report.gradedUntouched = hash0 === hash1;
    const sw = await sweep({ all: true });
    report.sweptAfter = sw.deleted;
  } catch (e) {
    console.error(String(e && e.stack || e)); report.infraError = String(e);
    fs.writeFileSync('/tmp/c5c-critic2-report.json', JSON.stringify(report, null, 2)); process.exit(3);
  } finally { await browser.close(); }
  const HIDING = new Set(['nv-firstletter', 'nv-manyspans', 'nv-textfill', 'nv-bgcliptext', 'nv-clippath', 'nv-padPark', 'nv-clipEdge']);
  const flag = [];
  for (const r of report.results) {
    if (r.kept > 0) { flag.push(`${r.op} KEPT (visual ${r.candidate && r.candidate.visual}, matchedΔ ${r.deltas && r.deltas.matchedTexts})`); continue; }
    if (r.detRejected) continue;
    if (r.renderInert) continue;
    const dvis = r.deltas ? r.deltas.visual : null;
    // a hiding op that escaped a deterministic gate AND gained visual = visual-only reject of hidden text = HOLE
    if (HIDING.has(r.op) && dvis != null && dvis > 0) flag.push(`${r.op} VISUAL-ONLY-reject-of-hidden (Δvis ${dvis})`);
  }
  report.flags = flag; report.allSafe = flag.length === 0;
  fs.writeFileSync('/tmp/c5c-critic2-report.json', JSON.stringify(report, null, 2));
  console.log(`\n===== C5c CRITIC#2 (${report.results.length} ops) =====`);
  for (const r of report.results) console.log(`  ${r.op}: ${r.decision} kept=${r.kept} det=${r.detRejected} inert=${r.renderInert} gates=[${(r.failedGates || []).join(',')}] Δ=${JSON.stringify(r.deltas)} audit=${JSON.stringify(r.leafAudit)}`);
  console.log(`\nVERDICT: ${report.allSafe ? 'ALL SAFE' : 'FLAGS: ' + flag.join('; ')}; graded untouched ${report.gradedUntouched}`);
  process.exit(report.allSafe && report.gradedUntouched ? 0 : 4);
})();
