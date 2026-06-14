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
 *
 * The preserve OVERLAY recipe is ported VERBATIM from the blessed spike /tmp/preserve-spike/build-flat.mjs
 * (score 72 vs flow 8 on the clerk hero): one relative section root + every CONTENT/BOX element pinned by its
 * captured section-relative rect with paint, carried in `joist_preserve_css`. Content stays native+editable
 * (heading/text/button/image widgets, real text/src); geometry is frozen in the preserveCSS string.
 *
 * USAGE:
 *   node build-hybrid-flow.mjs --layout <layout.json> --source <url> [--width 1440] [--flow-page N] [--hybrid-page M]
 *                              [--no-render] [--max-preserve K]
 *   --no-render    build both trees + the ledger, write them to /tmp, but skip the WP render (structural smoke).
 *   --max-preserve cap the number of PRESERVE sections captured (demo throttle; default all).
 * Env: JOIST_LOCAL_BASE/JOIST_LOCAL_PORT (default localhost:8001) for the sandbox render.
 */
import fs from 'fs';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { topLevelSections, routeSections } from './flow-preserve-router.mjs';
import { captureSection } from './preserve-capture.mjs';

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

// build the flat preserve overlay element list (children of a relative section root) from captured nodes.
function buildPreserveOverlay(cap, bandH) {
  const overlay = [];
  const stats = { headings: 0, texts: 0, buttons: 0, images: 0, boxes: 0, pruned: 0 };
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
        overlay.push({ id, elType: 'widget', widgetType: 'image', settings: { image: { url: srcURL, id: '', alt: node.alt || '' }, joist_preserve_css: JSON.stringify({ d: pinCSS(node) + ';overflow:hidden', m: node.m || {} }) }, elements: [] });
      } else if (kind === 'button') {
        stats.buttons++;
        const col = declVal(node.d, 'color');
        const x = col ? `.elementor-element.elementor-element-${id} .elementor-button{color:${col} !important;background-color:transparent}` : '';
        overlay.push({ id, elType: 'widget', widgetType: 'button', settings: { text: node.text || '', link: { url: node.href || '#' }, joist_preserve_css: JSON.stringify({ d: pinCSS(node), x, m: node.m || {} }) }, elements: [] });
      } else if (kind === 'heading') {
        stats.headings++;
        const col = declVal(node.d, 'color'), fsz = declVal(node.d, 'font-size'), fw = declVal(node.d, 'font-weight'), lh = declVal(node.d, 'line-height');
        const x = `.elementor-element.elementor-element-${id} .elementor-heading-title{${col ? `color:${col} !important;` : ''}${fsz ? `font-size:${fsz} !important;` : ''}${fw ? `font-weight:${fw} !important;` : ''}${lh ? `line-height:${lh} !important;` : ''}margin:0}`;
        overlay.push({ id, elType: 'widget', widgetType: 'heading', settings: { title: node.text || '', header_size: /^h[1-6]$/.test(node.tag) ? node.tag : 'h2', joist_preserve_css: JSON.stringify({ d: pinCSS(node), x, m: node.m || {} }) }, elements: [] });
      } else {
        stats.texts++;
        const col = declVal(node.d, 'color'), fsz = declVal(node.d, 'font-size');
        const x = `.elementor-element.elementor-element-${id} .elementor-widget-container,.elementor-element.elementor-element-${id} p{${col ? `color:${col} !important;` : ''}${fsz ? `font-size:${fsz} !important;` : ''}margin:0}`;
        overlay.push({ id, elType: 'widget', widgetType: 'text-editor', settings: { editor: '<p>' + esc(node.text || '') + '</p>', joist_preserve_css: JSON.stringify({ d: pinCSS(node), x, m: node.m || {} }) }, elements: [] });
      }
    } else if (hasPaint(node)) {
      stats.boxes++;
      overlay.push({ id, elType: 'widget', widgetType: 'html', settings: { html: '<div style="width:100%;height:100%"></div>', joist_preserve_css: JSON.stringify({ d: pinCSS(node), m: node.m || {} }) }, elements: [] });
    } else { stats.pruned++; }
  }
  // z-order: paint boxes behind (big first), content in front.
  const areaOf = (e) => { try { const d = JSON.parse(e.settings.joist_preserve_css).d; return (+/width:(\d+)px/.exec(d)?.[1] || 0) * (+/height:(\d+)px/.exec(d)?.[1] || 0); } catch { return 0; } };
  overlay.sort((a, b) => { const ai = a.widgetType === 'html' ? 0 : 1, bi = b.widgetType === 'html' ? 0 : 1; if (ai !== bi) return ai - bi; return ai === 0 ? areaOf(b) - areaOf(a) : 0; });
  return { overlay, stats };
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
const spliceLog = [];
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
  // SPLICE: make this container the relative positioning root for the preserve overlay; replace its children.
  container.settings = {
    content_width: 'full',
    min_height: { unit: 'px', size: realBandH },
    padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
    joist_preserve_css: JSON.stringify({ d: `position:relative !important;width:100% !important;max-width:${width}px;margin:0 auto !important;min-height:${realBandH}px !important;height:${realBandH}px !important;overflow:hidden !important`, m: {} }),
  };
  container.elements = overlay;
  spliceLog.push({ i: d.i, bandH: realBandH, spliced: true, overlay: overlay.length, stats });
}
await browser.close();

console.log('\n=== SPLICE LEDGER ===');
for (const s of spliceLog) console.log(`  §${s.i} bandH=${s.bandH} ${s.spliced ? `PRESERVE-spliced (${s.overlay} els: ${s.stats.headings}h ${s.stats.texts}t ${s.stats.buttons}b ${s.stats.images}img ${s.stats.boxes}box)` : `NOT spliced → stays FLOW (${s.why})`}`);
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

// ── 5) RENDER both to FRESH LOCAL pages (sandbox; no shared host) ────────────────────────────────────────────
if (!has('no-render')) {
  const { render } = await import('../../sandbox/render.mjs');
  const flowPage = arg('flow-page');
  const hybridPage = arg('hybrid-page');
  console.log('\n• render FLOW-ONLY → fresh local page…');
  const flowRes = await render([flowTree], { slug: 'hybrid-demo-flow', page: flowPage || undefined, title: 'Hybrid demo — FLOW only', shot: '/tmp/hybrid-flow-only.png', width });
  console.log(`  FLOW-ONLY → ${flowRes.url} (page ${flowRes.pageId})  shot /tmp/hybrid-flow-only.png`);
  console.log('\n• render HYBRID → fresh local page…');
  const hybRes = await render([hybridTree], { slug: 'hybrid-demo-hybrid', page: hybridPage || undefined, title: 'Hybrid demo — FLOW+PRESERVE', shot: '/tmp/hybrid-hybrid.png', width });
  console.log(`  HYBRID → ${hybRes.url} (page ${hybRes.pageId})  shot /tmp/hybrid-hybrid.png`);
  residualLedger.render = { flow: { url: flowRes.url, pageId: flowRes.pageId, shot: '/tmp/hybrid-flow-only.png' }, hybrid: { url: hybRes.url, pageId: hybRes.pageId, shot: '/tmp/hybrid-hybrid.png' } };
  fs.writeFileSync('/tmp/hybrid-residual-ledger.json', JSON.stringify(residualLedger, null, 2));
  console.log(`\nFLOW-ONLY PAGE:  ${flowRes.url}\nHYBRID PAGE:     ${hybRes.url}`);
}
