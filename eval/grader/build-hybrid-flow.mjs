#!/usr/bin/env node
/**
 * @purpose The FLOW-FIRST HYBRID builder + the demo driver for the per-section FLOW-vs-PRESERVE router.
 * Architecture: build the WHOLE page with the FLOW solver (native flex/grid, fully editable, responsive), then —
 * PER top-level section — splice in the PRESERVE residual arm ONLY on the sections the router escalated (a
 * vocab-loss layout class flow cannot author 1:1: absolute overlay / true CSS grid placement / overflow scroll-
 * region / negative-margin overlap / z-stack / transform; carousels EXCLUDED). The result is a hybrid where the
 * sections flow handles 1:1 stay fully editable and only the residual sections are content-editable/layout-frozen.
 *
 * Pipeline (all LOCAL — docker sandbox only, NO shared host, NO baseline mutation, fresh pages):
 *   1. build-flow.mjs --dry            → the full native FLOW tree (/tmp/flow-tree.json); no WP write, no auth.
 *   2. flow-preserve-router.routeSections(layout sections, LIVE source)  → per-section arm + residual ledger.
 *   3. preserve-capture.captureSection(live source band)  → per-element {d,m} preserve payloads for each
 *      PRESERVE section (the channel plugin/src/WidgetPack/PreserveCSS/Emitter.php stamps to core Post_CSS).
 *   4. SPLICE: for each PRESERVE section, find the flow container whose min_height == the section band height and
 *      replace its children with the preserve overlay (flat, absolutely-pinned, content-native). FLOW sections
 *      are untouched. The post-splice hRatio + zero-h-overflow gate is verified at RENDER (the router's gate (2)(3)).
 *   5. render.mjs (sandbox)            → both flow-only and hybrid to FRESH LOCAL pages + screenshots.
 *   6. AUTO-REVERT GATE (measure-sections.mjs) → re-measure each preserve band on the RENDERED hybrid; a
 *      section that fails the router's post-render gate ((2) hRatio∈[0.98,1.02] vs source band, (3) zero
 *      page-breaking h-overflow, (4) byHash actually attached) is REVERTED to its byte-equivalent native FLOW
 *      arm (saved settings+children) and the corrected hybrid is re-rendered. A preserve escalation that does
 *      not actually win is DROPPED — the residual ledger is re-recorded honestly (post-gate kept-preserve only).
 *   7. grade-structure.mjs            → grade the GATED hybrid vs the source (visual + editability + responsive).
 * So the whole chain — capture → flow+preserve hybrid → render → gate → grade — is ONE local command.
 *
 * The preserve OVERLAY recipe is ported VERBATIM from the blessed spike /tmp/preserve-spike/build-flat.mjs
 * (score 72 vs flow 8 on the clerk hero): one relative section root + every CONTENT/BOX element pinned by its
 * captured section-relative rect with paint, carried in `joist_preserve_css`. Content stays native+editable
 * (heading/text/button/image widgets, real text/src); geometry is frozen in the preserveCSS string. The payload
 * is now attached BY CONTENT-HASH: each preserve element looks up cap.byHash[node.hash] (preserve-capture's
 * content-addressed table) and layers the builder's proven absolute PIN over it, CARRYING the source-captured
 * @media map `m` — the inline path silently dropped those breakpoints.
 *
 * USAGE (single end-to-end command — capture→hybrid→render→gate→grade):
 *   node build-hybrid-flow.mjs --layout <layout.json> --source <url> [--width 1440] [--flow-page N] [--hybrid-page M]
 *                              [--no-render] [--no-grade] [--max-preserve K]
 *   --no-render    build both trees + the ledger, write them to /tmp, but skip the WP render (structural smoke).
 *   --no-grade     render + gate but skip the final grade-structure pass.
 *   --max-preserve cap the number of PRESERVE sections captured (demo throttle; default all).
 * Env (all reversible):
 *   JOIST_PRESERVE_NO_BYHASH=1  attach the joist_preserve_css inline (legacy) instead of through the byHash table.
 *   JOIST_NO_AUTOREVERT=1       measure the gate but NEVER revert (pure-preserve baseline; measure-only).
 *   JOIST_LOCAL_BASE/JOIST_LOCAL_PORT (default localhost:8001) for the sandbox render.
 */
import fs from 'fs';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { topLevelSections, routeSections, ROUTER } from './flow-preserve-router.mjs';
import { captureSection, presPayloadObj } from './preserve-capture.mjs';
import { PNG } from 'pngjs';                  // (1a) per-section preserve-vs-flow SSIM
import { ssim } from './grade-sections.mjs';  // (1a) reuse the grader's SSIM (gray() is in-module-scope there)

const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined && !String(process.argv[i + 1]).startsWith('--') ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);
const layoutPath = arg('layout');
const source = arg('source');
const width = +arg('width', 1440);
const maxPreserve = arg('max-preserve') ? +arg('max-preserve') : Infinity;
if (!layoutPath || !source) { console.error('usage: node build-hybrid-flow.mjs --layout <layout.json> --source <url> [--no-render]'); process.exit(2); }
const L = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
const newId = () => crypto.randomBytes(4).toString('hex').slice(0, 7);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const round = (n) => Math.round(n || 0);

// ── 1) FLOW tree via build-flow --dry (the native, fully-editable base; no WP write, no auth) ────────────────
console.log('• build-flow --dry (native FLOW base)…');
const flowRun = spawnSync('node', ['build-flow.mjs', '--layout', layoutPath, '--dry'], { encoding: 'utf8', cwd: process.cwd(), env: process.env, maxBuffer: 64 * 1024 * 1024 });
if (flowRun.status !== 0) { console.error('build-flow --dry FAILED:\n', flowRun.stderr || flowRun.stdout); process.exit(1); }
const flowTree = JSON.parse(fs.readFileSync('/tmp/flow-tree.json', 'utf8'));
console.log((flowRun.stdout || '').split('\n').filter((l) => /flow tree:|TOP-SECTIONS|min_height: total/.test(l)).join('\n'));

// ── 2) ROUTE the captured layout's top-level sections, LIVE-confirmed against the source ─────────────────────
console.log('\n• route sections (LIVE confirm: overflow/transform/z-index/carousel)…');
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width, height: 1200 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(source, { waitUntil: 'networkidle', timeout: 90000 });
await page.evaluate(async () => { window.scrollTo(0, document.body.scrollHeight); await new Promise(r => setTimeout(r, 700)); window.scrollTo(0, 0); if (document.fonts?.ready) { try { await document.fonts.ready; } catch {} } await new Promise(r => setTimeout(r, 300)); });

const sections = topLevelSections(L.root, L.pageH || 6000);
const { decisions, ledger } = await routeSections(sections, { page, width });
console.log(`\n=== ROUTE TABLE (LIVE) — ${sections.length} top-level sections ===`);
for (const d of decisions) console.log(`  §${String(d.i).padStart(2)} y=${String(d.box.y).padStart(4)} h=${String(d.box.h).padStart(4)} ${d.arm === 'preserve' ? 'PRESERVE' : 'flow    '} ${d.classes.length ? '[' + d.classes.join(',') + ']' : ''}${d.isCarousel ? ' CAROUSEL-excluded' : ''}`);

// ── 3+4) For each PRESERVE section: capture the live band, build the spike flat-overlay, SPLICE into the flow tree ─
// preserve OVERLAY recipe — ported from the blessed /tmp/preserve-spike/build-flat.mjs.
const PAINT_KEEP = new Set(['background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius', 'box-shadow', 'opacity', 'filter', 'backdrop-filter', 'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space', 'display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows', 'grid-auto-flow', 'overflow', 'overflow-x', 'overflow-y', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'z-index']);
const paintDecls = (block) => (block || '').split(';').map((d) => d.trim()).filter((d) => { const i = d.indexOf(':'); return i > 0 && PAINT_KEEP.has(d.slice(0, i).trim()); }).join(';');
const declVal = (block, prop) => { const m = new RegExp('(?:^|;)' + prop + ':([^;]+)').exec(block || ''); return m ? m[1].trim() : ''; };
function pinCSS(node) {
  const r = node.rect;
  const geo = `position:absolute !important;left:${r.x}px !important;top:${r.y}px !important;width:${r.w}px !important;height:${r.h}px !important;margin:0 !important;box-sizing:border-box;`;
  const paint = paintDecls(node.d);
  const eff = typeof node.effOpacity === 'number' ? node.effOpacity : 1;
  const op = eff < 0.95 ? `;opacity:${eff}` : '';
  return geo + paint + op;
}
function classifyLeaf(node) {
  if (node.tag === 'img') return 'image';
  if (node.tag === 'svg') return 'svg';
  if (node.tag === 'a' && node.text) return 'button';
  if (node.tag === 'button') return 'button';
  const fsz = parseFloat(declVal(node.d, 'font-size') || '0');
  const fw = +(declVal(node.d, 'font-weight') || 0);
  if (/^h[1-6]$/.test(node.tag) || fsz >= 26 || (fsz >= 19 && fw >= 600)) return 'heading';
  return 'text';
}
const hasPaint = (node) => /background-color:rgb(?!a\(0, 0, 0, 0\))/.test(node.d || '') || /background-image:(?!none)/.test(node.d || '') || /border-(top|right|bottom|left)-width:(?!0px)/.test(node.d || '') || /box-shadow:(?!none)/.test(node.d || '');

// byHash ATTACH: opt-out via JOIST_PRESERVE_NO_BYHASH=1 (legacy inline-payload path). When ON (default),
// the per-element joist_preserve_css the Emitter reads is assembled THROUGH the capture's content-hash table
// (cap.byHash[node.hash] → presPayloadObj) rather than re-derived inline: the builder layers its proven
// absolute PIN over the canonical payload's `d` and CARRIES the source-captured media map `m` from the same
// hash entry. This is the deterministic content-addressed attach the channel was designed for (the inline
// path silently dropped the captured @media breakpoints).
const BYHASH = process.env.JOIST_PRESERVE_NO_BYHASH !== '1';
// attach(node, id, { d, x }) → the joist_preserve_css JSON string, content-hash-keyed when BYHASH.
// Records id→hash in the live `attachLog` so the wiring is auditable. `d` = the builder's pin (authoritative
// geometry); `x` = the descendant inner-style rule; `m` comes from the byHash canonical entry (source media).
function makeAttach(cap, attachLog) {
  return (node, id, { d, x = '' } = {}) => {
    const canon = (BYHASH && cap.byHash && cap.byHash[node.hash]) || null;
    // pin `d` (builder, authoritative) over canonical; media `m` from the canonical content-hash entry.
    const payloadObj = presPayloadObj(canon || node, { d, x, m: canon ? canon.m : (node.m || {}) });
    attachLog.push({ id, hash: node.hash, byHash: !!canon, hasMedia: Object.keys(payloadObj.m || {}).length > 0 });
    return JSON.stringify(payloadObj);
  };
}

// build the flat preserve overlay element list (children of a relative section root) from captured nodes.
function buildPreserveOverlay(cap, bandH) {
  const overlay = [];
  const stats = { headings: 0, texts: 0, buttons: 0, images: 0, boxes: 0, pruned: 0, byHashAttached: 0 };
  const attachLog = [];
  const attach = makeAttach(cap, attachLog);
  for (const node of cap.nodes) {
    if (node.isSectionRoot) continue;
    const r = node.rect;
    if (!(r.w > 0 && r.h > 0) || r.x >= width || r.x + r.w <= 0 || r.y < -4 || r.y >= bandH + 40) continue;
    const eff = typeof node.effOpacity === 'number' ? node.effOpacity : 1;
    if (eff < 0.06) continue;
    const isLeaf = node.tag === 'img' || node.tag === 'svg' || (node.text && node.text.length > 0 && !/^(div|section|main|header|footer|nav|ul|ol)$/.test(node.tag));
    const id = newId();
    if (isLeaf) {
      const kind = classifyLeaf(node);
      if (kind === 'image') {
        if (node.tag !== 'img') continue; // svg without raster → skip (decorative)
        stats.images++;
        const srcURL = node.src || node.resolvedSrc || '';
        overlay.push({ id, elType: 'widget', widgetType: 'image', settings: { image: { url: srcURL, id: '', alt: node.alt || '' }, joist_preserve_css: attach(node, id, { d: pinCSS(node) + ';overflow:hidden' }) }, elements: [] });
      } else if (kind === 'button') {
        stats.buttons++;
        const col = declVal(node.d, 'color');
        const x = col ? `.elementor-element.elementor-element-${id} .elementor-button{color:${col} !important;background-color:transparent}` : '';
        overlay.push({ id, elType: 'widget', widgetType: 'button', settings: { text: node.text || '', link: { url: node.href || '#' }, joist_preserve_css: attach(node, id, { d: pinCSS(node), x }) }, elements: [] });
      } else if (kind === 'heading') {
        stats.headings++;
        const col = declVal(node.d, 'color'), fsz = declVal(node.d, 'font-size'), fw = declVal(node.d, 'font-weight'), lh = declVal(node.d, 'line-height');
        const x = `.elementor-element.elementor-element-${id} .elementor-heading-title{${col ? `color:${col} !important;` : ''}${fsz ? `font-size:${fsz} !important;` : ''}${fw ? `font-weight:${fw} !important;` : ''}${lh ? `line-height:${lh} !important;` : ''}margin:0}`;
        overlay.push({ id, elType: 'widget', widgetType: 'heading', settings: { title: node.text || '', header_size: /^h[1-6]$/.test(node.tag) ? node.tag : 'h2', joist_preserve_css: attach(node, id, { d: pinCSS(node), x }) }, elements: [] });
      } else {
        stats.texts++;
        const col = declVal(node.d, 'color'), fsz = declVal(node.d, 'font-size');
        const x = `.elementor-element.elementor-element-${id} .elementor-widget-container,.elementor-element.elementor-element-${id} p{${col ? `color:${col} !important;` : ''}${fsz ? `font-size:${fsz} !important;` : ''}margin:0}`;
        overlay.push({ id, elType: 'widget', widgetType: 'text-editor', settings: { editor: '<p>' + esc(node.text || '') + '</p>', joist_preserve_css: attach(node, id, { d: pinCSS(node), x }) }, elements: [] });
      }
    } else if (hasPaint(node)) {
      stats.boxes++;
      overlay.push({ id, elType: 'widget', widgetType: 'html', settings: { html: '<div style="width:100%;height:100%"></div>', joist_preserve_css: attach(node, id, { d: pinCSS(node) }) }, elements: [] });
    } else { stats.pruned++; }
  }
  // z-order: paint boxes behind (big first), content in front.
  const areaOf = (e) => { try { const d = JSON.parse(e.settings.joist_preserve_css).d; return (+/width:(\d+)px/.exec(d)?.[1] || 0) * (+/height:(\d+)px/.exec(d)?.[1] || 0); } catch { return 0; } };
  overlay.sort((a, b) => { const ai = a.widgetType === 'html' ? 0 : 1, bi = b.widgetType === 'html' ? 0 : 1; if (ai !== bi) return ai - bi; return ai === 0 ? areaOf(b) - areaOf(a) : 0; });
  stats.byHashAttached = attachLog.filter((a) => a.byHash).length;
  stats.attachTotal = attachLog.length;
  stats.withMedia = attachLog.filter((a) => a.hasMedia).length;
  return { overlay, stats, attachLog };
}

// find the flow container whose min_height pin == this section's band height (the splice target).
function findSectionContainer(root, bandH, used) {
  let best = null;
  (function walk(n) {
    if (n.elType === 'container' && n.settings && n.settings.min_height && +n.settings.min_height.size === bandH && !used.has(n)) {
      // prefer the SHALLOWEST/largest match (the top-level section wrapper, not a nested leaf-section of equal h)
      if (!best) best = n;
    }
    (n.elements || []).forEach(walk);
  })(root);
  return best;
}

const preserveDecisions = decisions.filter((d) => d.arm === 'preserve').slice(0, maxPreserve === Infinity ? undefined : maxPreserve);
console.log(`\n• capture + splice ${preserveDecisions.length} PRESERVE section(s)…`);
const hybridTree = JSON.parse(JSON.stringify(flowTree));
const used = new Set();
const usedFlow = new Set(); // (1a) corresponding FLOW containers (same bandH, splice order) — so the gate can locate each section on the FLOW render too
const spliceLog = [];
// AUTO-REVERT metadata (NOT serialized into the ledger — carries live container refs + the byte-equivalent
// flow snapshot so the post-render gate can revert a failing preserve section). Keyed by section index `i`.
const spliceMeta = new Map();
for (const d of preserveDecisions) {
  const bandH = round(d.box.h);
  const container = findSectionContainer(hybridTree, bandH, used);
  if (!container) { spliceLog.push({ i: d.i, bandH, spliced: false, why: 'no flow container with matching min_height pin' }); continue; }
  used.add(container);
  // capture the live source band by its captured (x,y,w,h): scroll to it, select the element at its center.
  let cap;
  try {
    const sel = await page.evaluate(({ box }) => {
      // find the element whose box best matches the captured section rect (center-in + closest area)
      const target = { x: box.x, y: box.y, w: box.w, h: box.h };
      let best = null, bestErr = Infinity;
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        const ar = { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height };
        if (ar.w < 50 || ar.h < 20) continue;
        const err = Math.abs(ar.x - target.x) + Math.abs(ar.y - target.y) + Math.abs(ar.w - target.w) + Math.abs(ar.h - target.h);
        if (err < bestErr) { bestErr = err; best = el; }
      }
      if (!best || bestErr > 120) return null;
      best.setAttribute('data-joist-preserve-target', '1');
      return '[data-joist-preserve-target="1"]';
    }, { box: d.box });
    if (!sel) { spliceLog.push({ i: d.i, bandH, spliced: false, why: 'live section element not found within tolerance' }); continue; }
    cap = await captureSection(page, sel);
    await page.evaluate(() => { const e = document.querySelector('[data-joist-preserve-target="1"]'); if (e) e.removeAttribute('data-joist-preserve-target'); });
  } catch (e) { spliceLog.push({ i: d.i, bandH, spliced: false, why: 'capture error: ' + e.message }); continue; }
  const realBandH = (cap.band && cap.band.h) || bandH;
  const { overlay, stats } = buildPreserveOverlay(cap, realBandH);
  if (!overlay.length) { spliceLog.push({ i: d.i, bandH, spliced: false, why: 'preserve overlay empty (no paintable/leaf nodes)' }); continue; }
  // AUTO-REVERT prep: stamp a STABLE id on this container so the post-render gate can locate the rendered
  // band, and SAVE the byte-equivalent original flow arm (settings + children) so a failing preserve section
  // can be reverted to the exact native FLOW build it would have had (the router's "byte-equivalent fallback").
  const markId = container.id || newId();
  container.id = markId;
  // (1a): stamp the SAME id on the corresponding FLOW container (same bandH, matched in splice order) so the
  // gate can locate this section on the flow render too, for the per-section preserve-vs-flow visual compare.
  const flowContainer = findSectionContainer(flowTree, bandH, usedFlow);
  if (flowContainer) { flowContainer.id = markId; usedFlow.add(flowContainer); }
  const origSettings = JSON.parse(JSON.stringify(container.settings || {}));
  const origElements = JSON.parse(JSON.stringify(container.elements || []));
  // SPLICE: make this container the relative positioning root for the preserve overlay; replace its children.
  container.settings = {
    content_width: 'full',
    min_height: { unit: 'px', size: realBandH },
    padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
    joist_preserve_css: JSON.stringify({ d: `position:relative !important;width:100% !important;max-width:${width}px;margin:0 auto !important;min-height:${realBandH}px !important;height:${realBandH}px !important;overflow:hidden !important`, m: {} }),
  };
  container.elements = overlay;
  spliceLog.push({ i: d.i, bandH: realBandH, spliced: true, overlay: overlay.length, stats, markId, byHashAttached: stats.byHashAttached, attachTotal: stats.attachTotal });
  // auto-revert payload (live refs — kept OUT of the serialized ledger): how to find this band on the
  // rendered page (markId) + how to revert it byte-equivalently (the saved flow settings + children).
  spliceMeta.set(d.i, { markId, srcBandH: realBandH, srcY: round(d.box.y), container, origSettings, origElements });
}
// (1a) per-section veto input: one full-page SOURCE screenshot @width (the source page is still open). The gate
// SSIMs each preserve section's flow render AND hybrid render against this source band, keeping preserve only when
// it visually BEATS flow (preserve costs editability, so it must earn it). Falls back to geometry-only if missing.
let srcShotPath = null;
try {
  await page.evaluate(async () => { window.scrollTo(0, 0); if (document.fonts?.ready) { try { await document.fonts.ready; } catch {} } await new Promise((r) => setTimeout(r, 200)); });
  srcShotPath = '/tmp/hybrid-source-full.png';
  fs.writeFileSync(srcShotPath, await page.screenshot({ fullPage: true }));
  console.log(`• (1a) source shot → ${srcShotPath}`);
} catch (e) { console.log(`• (1a) source shot failed (${e.message}) → preserve-veto falls back to geometry-only`); }
await browser.close();

console.log('\n=== SPLICE LEDGER ===');
for (const s of spliceLog) console.log(`  §${s.i} bandH=${s.bandH} ${s.spliced ? `PRESERVE-spliced (${s.overlay} els: ${s.stats.headings}h ${s.stats.texts}t ${s.stats.buttons}b ${s.stats.images}img ${s.stats.boxes}box | byHash-attached ${s.stats.byHashAttached}/${s.stats.attachTotal}, ${s.stats.withMedia} w/ @media)` : `NOT spliced → stays FLOW (${s.why})`}`);
const totAttach = spliceLog.reduce((a, s) => a + (s.attachTotal || 0), 0), totByHash = spliceLog.reduce((a, s) => a + (s.byHashAttached || 0), 0);
console.log(`  byHash ATTACH: ${totByHash}/${totAttach} preserve elements attached through the content-hash table${BYHASH ? '' : ' (DISABLED — legacy inline path)'}`);
const actuallySpliced = spliceLog.filter((s) => s.spliced).length;

// honest residual ledger: re-tally the EFFECTIVE preserve coverage (sections actually spliced, not just routed).
const effCovFrac = sections.length ? +(actuallySpliced / sections.length).toFixed(4) : 0;
const effHeightFrac = (() => { const tot = sections.length ? sections.reduce((a, s) => a + s.box.h, 0) : 0; const pres = spliceLog.filter((s) => s.spliced).reduce((a, s) => a + s.bandH, 0); return tot ? +(pres / tot).toFixed(4) : 0; })();
const residualLedger = {
  source, sections: sections.length,
  routedPreserve: ledger.preserveSections, splicedPreserve: actuallySpliced,
  preserveCoverageFrac: effCovFrac, preserveHeightFrac: effHeightFrac,
  routedCoverageFrac: ledger.preserveCoverageFrac, routedHeightFrac: ledger.preserveHeightFrac,
  editability: { flowSections: sections.length - actuallySpliced, preserveSections: actuallySpliced, note: 'flow sections fully editable; preserve sections content-editable / layout-frozen' },
  perSection: ledger.perSection, splice: spliceLog,
};

fs.writeFileSync('/tmp/hybrid-flow-tree.json', JSON.stringify(hybridTree));
fs.writeFileSync('/tmp/flow-only-tree.json', JSON.stringify(flowTree));
fs.writeFileSync('/tmp/hybrid-residual-ledger.json', JSON.stringify(residualLedger, null, 2));
console.log('\n=== RESIDUAL LEDGER (effective) ===');
console.log(`  sections ${residualLedger.sections} | routed-preserve ${residualLedger.routedPreserve} | spliced-preserve ${residualLedger.splicedPreserve}`);
console.log(`  preserveCoverageFrac (spliced, by count) ${residualLedger.preserveCoverageFrac} | by height ${residualLedger.preserveHeightFrac}`);
console.log(`  editability: ${residualLedger.editability.flowSections} FULLY editable (flow) · ${residualLedger.editability.preserveSections} content-editable/LAYOUT-frozen (preserve)`);
console.log('  trees → /tmp/flow-only-tree.json, /tmp/hybrid-flow-tree.json | ledger → /tmp/hybrid-residual-ledger.json');

// ── 5) RENDER both to FRESH LOCAL pages (sandbox; no shared host) + AUTO-REVERT gate + GRADE ─────────────────
if (!has('no-render')) {
  const { render } = await import('../../sandbox/render.mjs');
  const flowPage = arg('flow-page');
  const hybridPage = arg('hybrid-page');
  console.log('\n• render FLOW-ONLY → fresh local page…');
  const flowRes = await render([flowTree], { slug: 'hybrid-demo-flow', page: flowPage || undefined, title: 'Hybrid demo — FLOW only', shot: '/tmp/hybrid-flow-only.png', width });
  console.log(`  FLOW-ONLY → ${flowRes.url} (page ${flowRes.pageId})  shot /tmp/hybrid-flow-only.png`);
  console.log('\n• render HYBRID → fresh local page…');
  let hybRes = await render([hybridTree], { slug: 'hybrid-demo-hybrid', page: hybridPage || undefined, title: 'Hybrid demo — FLOW+PRESERVE', shot: '/tmp/hybrid-hybrid.png', width });
  console.log(`  HYBRID → ${hybRes.url} (page ${hybRes.pageId})  shot /tmp/hybrid-hybrid.png`);

  // ── AUTO-REVERT GATE (router gate (2)(3)+(4), now ENFORCED) ───────────────────────────────────────────────
  // For every spliced PRESERVE section, MEASURE the rendered band on the hybrid page (located by its stamped
  // container id) and compute hRatio = renderedBandH / sourceBandH + whether it introduces horizontal overflow.
  // A preserve section that FAILS the gate (hRatio∉[0.98,1.02] OR h-overflow OR byHash attached nothing) is
  // REVERTED to the byte-equivalent native FLOW arm (the saved settings+children) and the residual ledger is
  // re-recorded. So a preserve escalation that does NOT actually win is dropped — preserve must EARN its place.
  // Reversible: JOIST_NO_AUTOREVERT=1 skips the gate (measure-only, never reverts) for a pure-preserve baseline.
  const AUTOREVERT = process.env.JOIST_NO_AUTOREVERT !== '1';
  // (1a) PER-SECTION VETO: a preserve section is layout-FROZEN (costs editability), so keep it only if it also
  // VISUALLY BEATS the flow floor for that band by a margin — else the flow arm is strictly better (equal-or-better
  // visual AND more editable). We SSIM each section's FLOW render and HYBRID render against the SOURCE band and
  // revert preserve when ssimHybrid < ssimFlow + margin. Reversible: JOIST_NO_PRESERVE_VETO=1 → geometry-only gate
  // (byte-identical to before); JOIST_PRESERVE_MARGIN tunes the bar (default 0.02, ~the SSIM noise floor).
  const PRESERVE_VETO = process.env.JOIST_NO_PRESERVE_VETO !== '1';
  const PRESERVE_MARGIN = parseFloat(process.env.JOIST_PRESERVE_MARGIN || '0.02');
  const splicedSecs = [...spliceMeta.entries()].map(([i, m]) => ({ i, ...m }));
  let reverted = [];
  if (splicedSecs.length) {
    console.log(`\n• AUTO-REVERT gate: measuring ${splicedSecs.length} preserve section(s) on the rendered hybrid…`);
    const { measureSections } = await import('./measure-sections.mjs');
    const measured = await measureSections(hybRes.url, splicedSecs.map((s) => ({ id: s.markId, srcBandH: s.srcBandH })), width);
    // (1a) inputs: measure the FLOW render for the same section ids + load src/flow/hybrid shots for per-section SSIM.
    let measuredF = { byId: {} }, srcPNG = null, flowPNG = null, hybPNG = null;
    if (PRESERVE_VETO && srcShotPath && fs.existsSync(srcShotPath)) {
      try {
        measuredF = await measureSections(flowRes.url, splicedSecs.map((s) => ({ id: s.markId, srcBandH: s.srcBandH })), width);
        srcPNG = PNG.sync.read(fs.readFileSync(srcShotPath));
        flowPNG = PNG.sync.read(fs.readFileSync('/tmp/hybrid-flow-only.png'));
        hybPNG = PNG.sync.read(fs.readFileSync('/tmp/hybrid-hybrid.png'));
      } catch (e) { console.log(`  (1a) preserve-veto inputs unavailable (${e.message}) → geometry-only gate this run`); }
    }
    const cropBand = (png, top, h) => { const t = Math.max(0, Math.round(top)); const H = Math.max(1, Math.min(Math.round(h), png.height - t)); const o = new PNG({ width: png.width, height: H }); for (let r = 0; r < H; r++) { const src = ((t + r) * png.width) * 4; o.data.set(png.data.subarray(src, src + png.width * 4), (r * png.width) * 4); } return o; };
    // SSIM a RENDER band (top..top+h on its page shot) against the SOURCE band (srcY..srcY+srcH on the source shot),
    // both cropped to a common origin + min height (full width, x-aligned). null when a crop is too small to score.
    const bandSSIM = (renderPNG, renderTop, renderH, srcY, srcH) => {
      if (!renderPNG || !srcPNG || renderH == null || renderTop == null) return null;
      const a = cropBand(renderPNG, renderTop, renderH), b = cropBand(srcPNG, srcY, srcH);
      const h = Math.min(a.height, b.height); if (h < 16 || Math.min(a.width, b.width) < 16) return null;
      return +ssim(a, b, 0, h).toFixed(4);
    };
    for (const s of splicedSecs) {
      const mres = measured.byId[s.markId] || null;
      const meta = spliceLog.find((x) => x.i === s.i);
      if (!mres || !mres.found) {
        // could not locate the rendered band → cannot prove the pin holds → revert (conservative).
        s._gate = { found: false, pass: false, reason: 'rendered band not located → cannot verify pin' };
      } else {
        const hRatio = s.srcBandH > 0 ? +(mres.renderedH / s.srcBandH).toFixed(4) : 0;
        const inBand = hRatio >= ROUTER.HRATIO_LO && hRatio <= ROUTER.HRATIO_HI;
        const noHOverflow = !mres.hOverflow;
        const attachedSomething = !BYHASH || (meta && meta.byHashAttached > 0);
        const pass = inBand && noHOverflow && attachedSomething;
        const reason = pass ? 'hRatio in band + zero h-overflow' : [!inBand && `hRatio ${hRatio}∉[${ROUTER.HRATIO_LO},${ROUTER.HRATIO_HI}]`, !noHOverflow && 'introduces h-overflow', !attachedSomething && 'byHash attached nothing (low confidence)'].filter(Boolean).join('; ');
        s._gate = { found: true, hRatio, hOverflow: mres.hOverflow, renderedH: mres.renderedH, srcBandH: s.srcBandH, pass, reason };
        // (1a) preserve-vs-flow VISUAL check — only when geometry PASSED and the SSIM inputs are available.
        if (PRESERVE_VETO && pass && hybPNG && flowPNG && srcPNG) {
          const fres = measuredF.byId[s.markId];
          const sH = bandSSIM(hybPNG, mres.top, mres.renderedH, s.srcY, s.srcBandH);
          const sF = (fres && fres.found) ? bandSSIM(flowPNG, fres.top, fres.renderedH, s.srcY, s.srcBandH) : null;
          if (sH != null && sF != null) {
            // HEIGHT-AWARE compare (the fix): a section rendered far off the source band height is broken regardless
            // of a top-aligned SSIM — flow frequently COLLAPSES a grid to a 3x-tall stack (exactly the case PRESERVE
            // exists to fix), and a top-1058px crop misses that blowup entirely. Penalize each side's raw SSIM by its
            // height ratio vs the source band (grade-structure's hPen), then compare the penalized scores. So preserve
            // (hRatio≈1, faithful) correctly beats a 3.2x-tall flow even at a lower raw SSIM. (Verified: supabase §13.)
            const hPen = (rh) => { const r = s.srcBandH > 0 ? rh / s.srcBandH : 1; return Math.max(0.3, Math.min(1, 1 - Math.max(0, Math.abs(r - 1) - 0.1) * 0.6)); };
            const scoreH = +(sH * hPen(mres.renderedH)).toFixed(4), scoreF = +(sF * hPen(fres.renderedH)).toFixed(4);
            const beatsFlow = scoreH >= scoreF + PRESERVE_MARGIN;
            s._gate.vis = { ssimHybrid: sH, ssimFlow: sF, hRatioHyb: +(mres.renderedH / s.srcBandH).toFixed(2), hRatioFlow: +(fres.renderedH / s.srcBandH).toFixed(2), scoreHybrid: scoreH, scoreFlow: scoreF, margin: PRESERVE_MARGIN, beatsFlow };
            // DEBUG (JOIST_PRESERVE_VETO_DUMP=1): dump the EXACT crops the gate compared, to LOOK.
            if (process.env.JOIST_PRESERVE_VETO_DUMP === '1') { try {
              fs.writeFileSync(`/tmp/veto-sec${s.i}-src.png`, PNG.sync.write(cropBand(srcPNG, s.srcY, s.srcBandH)));
              if (fres && fres.found) fs.writeFileSync(`/tmp/veto-sec${s.i}-flow.png`, PNG.sync.write(cropBand(flowPNG, fres.top, fres.renderedH)));
              fs.writeFileSync(`/tmp/veto-sec${s.i}-hyb.png`, PNG.sync.write(cropBand(hybPNG, mres.top, mres.renderedH)));
              console.log(`  (1a) DUMP §${s.i} → /tmp/veto-sec${s.i}-{src,flow,hyb}.png (srcY=${s.srcY} h=${s.srcBandH} | flowH=${fres?.renderedH} hybH=${mres.renderedH})`);
            } catch (e) { console.log(`  (1a) dump failed: ${e.message}`); } }
            if (!beatsFlow) { s._gate.pass = false; s._gate.reason += `; preserve score ${scoreH} < flow ${scoreF}+${PRESERVE_MARGIN} (height-penalized SSIM; flow hRatio ${(fres.renderedH / s.srcBandH).toFixed(2)})`; }
          }
        }
      }
      if (meta) meta.gate = s._gate;
      const visStr = s._gate.vis ? ` score H${s._gate.vis.scoreHybrid}/F${s._gate.vis.scoreFlow} (ssim ${s._gate.vis.ssimHybrid}/${s._gate.vis.ssimFlow}, hR hyb${s._gate.vis.hRatioHyb}/flow${s._gate.vis.hRatioFlow})${s._gate.vis.beatsFlow ? '✓keeps' : '✗loses'}` : '';
      const verdict = s._gate.pass ? 'PASS — keep PRESERVE' : (AUTOREVERT ? 'FAIL → REVERT to flow' : 'FAIL (measure-only, kept)');
      console.log(`  §${s.i} ${s._gate.found ? `hRatio=${s._gate.hRatio} hOverflow=${s._gate.hOverflow}${visStr}` : 'NOT FOUND'} → ${verdict} (${s._gate.reason})`);
      if (!s._gate.pass && AUTOREVERT) {
        // REVERT this section to the saved byte-equivalent FLOW arm.
        s.container.settings = s.origSettings;
        s.container.elements = s.origElements;
        reverted.push(s.i);
        if (meta) { meta.spliced = false; meta.reverted = true; meta.why = `auto-reverted: ${s._gate.reason}`; }
      }
    }
  }

  // If any section reverted, RE-RENDER the corrected hybrid + re-record the honest residual ledger.
  if (reverted.length) {
    console.log(`\n• ${reverted.length} section(s) reverted (§${reverted.join(', §')}) → re-render corrected hybrid…`);
    hybRes = await render([hybridTree], { slug: 'hybrid-demo-hybrid', page: hybRes.pageId, title: 'Hybrid demo — FLOW+PRESERVE (gated)', shot: '/tmp/hybrid-hybrid.png', width });
    console.log(`  HYBRID (gated) → ${hybRes.url} (page ${hybRes.pageId})  shot /tmp/hybrid-hybrid.png`);
  }

  // HONEST post-gate residual ledger — only sections that PASSED the gate count as preserve.
  const keptPreserve = spliceLog.filter((s) => s.spliced).length;
  const effCov2 = sections.length ? +(keptPreserve / sections.length).toFixed(4) : 0;
  const effH2 = (() => { const tot = sections.reduce((a, s) => a + s.box.h, 0); const pres = spliceLog.filter((s) => s.spliced).reduce((a, s) => a + s.bandH, 0); return tot ? +(pres / tot).toFixed(4) : 0; })();
  residualLedger.splicedPreserve = keptPreserve;
  residualLedger.preserveCoverageFrac = effCov2;
  residualLedger.preserveHeightFrac = effH2;
  residualLedger.editability = { flowSections: sections.length - keptPreserve, preserveSections: keptPreserve, note: 'flow sections fully editable; preserve sections content-editable / layout-frozen' };
  residualLedger.autoRevert = { enabled: AUTOREVERT, reverted, keptPreserve, gate: { hRatioBand: [ROUTER.HRATIO_LO, ROUTER.HRATIO_HI], requireZeroHOverflow: true, requireByHashAttach: BYHASH } };

  residualLedger.render = { flow: { url: flowRes.url, pageId: flowRes.pageId, shot: '/tmp/hybrid-flow-only.png' }, hybrid: { url: hybRes.url, pageId: hybRes.pageId, shot: '/tmp/hybrid-hybrid.png' } };
  fs.writeFileSync('/tmp/hybrid-residual-ledger.json', JSON.stringify(residualLedger, null, 2));
  console.log(`\nFLOW-ONLY PAGE:  ${flowRes.url}\nHYBRID PAGE:     ${hybRes.url}`);

  // ── 6) GRADE the gated hybrid vs the SOURCE (the objective function; single end-to-end command closes here) ──
  if (!has('no-grade')) {
    // FLOOR GUARANTEE (motor-cortex move ① — the "always-works floor" half): grade BOTH the hybrid (flow +
    // preserve "skills") AND the flow-only FLOOR, then SHIP whichever wins. A preserve escalation is kept ONLY
    // if the whole page BEATS the responsive flow floor; on a tie-or-worse we ship the floor (it reflows by
    // construction → never trips the responsive veto-caps that sink desktop-pinned builds; baseline: absolute is
    // veto-capped 7/7 on responsive). So we NEVER ship worse than the floor. Reversible: JOIST_NO_FLOORGUARD=1
    // → grade hybrid only and ship it (legacy behavior). Both pages are already rendered; we only pick the URL.
    const gradeOf = (url, out) => {
      const g = spawnSync('node', ['grade-structure.mjs', '--source', source, '--clone', url, '--out', out], { encoding: 'utf8', cwd: process.cwd(), env: process.env, maxBuffer: 64 * 1024 * 1024, timeout: 110000 });
      let r = null; try { r = JSON.parse(fs.readFileSync(`${out}/report.json`, 'utf8')); } catch {}
      return { r, raw: (g.stdout || '') + (g.stderr || '') };
    };
    const slim = (g) => g ? { composite: g.composite, visual: g.visual, editability: g.editability, responsive: g.responsive } : null;
    console.log('\n• grade HYBRID + FLOW-floor vs source (floor guarantee)…');
    const Hg = gradeOf(hybRes.url, '/tmp/hybrid-grade');
    const Fg = process.env.JOIST_NO_FLOORGUARD === '1' ? { r: null, raw: '' } : gradeOf(flowRes.url, '/tmp/flow-grade');
    const hc = Hg.r?.composite ?? -1, fc = Fg.r?.composite ?? -1;
    const floorWins = Fg.r != null && fc >= hc; // tie → ship the floor (more editable / responsive / robust)
    const shipped = floorWins ? 'flow' : 'hybrid';
    const shippedRes = floorWins ? flowRes : hybRes;
    const shippedGrade = floorWins ? Fg.r : Hg.r;
    residualLedger.grade = { composite: shippedGrade?.composite ?? null, shipped, floorGuaranteeFired: floorWins, hybrid: slim(Hg.r), flow: slim(Fg.r) };
    residualLedger.shipped = { arm: shipped, url: shippedRes.url, pageId: shippedRes.pageId };
    fs.writeFileSync('/tmp/hybrid-residual-ledger.json', JSON.stringify(residualLedger, null, 2));
    console.log((Hg.raw || '').split('\n').filter((l) => /composite|visual|editab|responsive/i.test(l)).slice(0, 5).join('\n') || (Hg.raw || '').slice(-600));
    console.log(`\n  FLOOR-GUARANTEE: hybrid ${hc} vs flow-floor ${fc} → SHIP ${shipped.toUpperCase()}  (${shippedRes.url})`);
    if (shippedGrade) console.log(`  SHIPPED composite ${shippedGrade.composite} (visual ${shippedGrade.visual} · editability ${shippedGrade.editability}${shippedGrade.responsive != null ? ` · responsive ${shippedGrade.responsive}` : ''})`);
  }
  console.log('\n=== POST-GATE RESIDUAL LEDGER ===');
  console.log(`  kept-preserve ${keptPreserve}/${actuallySpliced} spliced (${reverted.length} auto-reverted) | covFrac ${effCov2} | heightFrac ${effH2}`);
  console.log(`  editability: ${residualLedger.editability.flowSections} FULLY editable (flow) · ${residualLedger.editability.preserveSections} content-editable/LAYOUT-frozen (preserve)`);
}
