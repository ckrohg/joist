#!/usr/bin/env node
/**
 * @purpose sectionVisual — the refine loop's PER-BAND unit of iteration (PATH_TO_TRUE_1TO1 §C round 2; SPEC in
 * the C-round-2 dispatch). PUT one band's widgets to a dedicated scratch page, render, capture, and produce a
 * `visual` score comparable to grade-sections' perSection[].visual for that band — at ~15-60s/band instead of a
 * ~3-6 min full rebuild+grade. C (refine operators), D (motion operators), E (per-band reflow) all ride on it.
 *
 * CONTRACT: sectionVisual({source, pageId, band:{y0,y1}, ...}) → report whose `visual` matches what a full
 * grade-sections run scores for the same band, within the _sectionvisual-selftest.mjs tolerance gate
 * (per band |Δ|<=0.04, max<=0.08, median<=0.03). Scope: perSection[].visual is the SSIM/exact half — the
 * perElement blend is PAGE-level only (folds into visualMean, never perSection[].visual), so the primitive
 * matches perSection[].visual exactly by definition. Page-level keep/revert still uses full grade-sections.
 *
 * DESIGN DECISIONS (each justified in the spec; summarized here):
 *  1. BAND EXTRACTION — membership by a BOX INDEX (one full-page render of the live clone → nodeId→{x,y,w,h},
 *     persisted /tmp/secvis-boxindex-<page>.json, keyed by live joist hash for staleness): widget heights are
 *     NOT in settings for most widgets. Padded overlap (PAD=120px, paint-bleed cover) with [y0,y1); bgRects
 *     (html widgets with inline height — incl. the full-page canvas rect) on ANY padded overlap, full height
 *     kept (the crop clips them — closes adjacent-band bg-bleed by rule); CSS-pinned #cr-N card-row grids via
 *     the box index like any node; the position:fixed real-header included IFF y0===0 (fixed paints once at
 *     document top in Chromium fullPage shots); boundary-spanning widgets included in BOTH adjacent bands (the
 *     crop slices them exactly as the full-page crop does); nodes missing from the index (operator-inserted
 *     candidates) fall back to _offset_y/min_height/inline-height extents (PAD absorbs estimate error,
 *     reported under widgets.estimated). Over-inclusion is faithful-by-construction; only under-inclusion
 *     diverges.
 *  2. Y-NORMALIZATION — RENDER IN PLACE: every _offset_y untouched; scratch root (deep-clone of the original
 *     root settings incl. rootBgFloor background_color) gets min_height=y1 so the band paints at its original
 *     document coords; screenshot full-page; crop [y0, gy1). Shift-by-−y0 is REJECTED: document-Y is encoded
 *     in more channels than _offset_y (#cr-N grids are pinned by custom_css top:<Y>px!important — containers
 *     ignore _position:absolute — a shift would move everything EXCEPT the grids). Crop clamp parity:
 *     gy1=min(y1,H), H=min(srcShot.h, cloneFullH) where cloneFullH is the FULL clone page's height (from the
 *     box index), NOT the scratch render height — otherwise short clones (hRatio<1) grade truncated bands on
 *     the full page but full bands on scratch.
 *  3. CUSTOM_CSS — carried WHOLE, verbatim (page_settings copied from the source page; measured 20-29KB).
 *     A referenced-ids-only subsetter would add a CSS parser as a new silent-divergence source (a dropped
 *     #img-N height-pin or #dei-N anchor reset changes band pixels) to save a few KB. Unmatched #id selectors
 *     are inert. Kit CSS is site-wide → scratch inherits it automatically (matches the full-page render).
 *  4. SCORING — IMPORT, not subprocess: capture()/perBandVisual() imported from grade-sections.mjs (the
 *     per-band block was extracted into the exported pure perBandVisual — ONE implementation, so the selftest
 *     measures RENDER divergence only, never formula drift). Source side = the FROZEN grade-src-cache the full
 *     grade used (loadSrcCache; byte-identical src crop). Clone side = the very same capture() path
 *     (settleLazy ON, same text/img extraction) so void/rastered inputs are symmetric.
 *     `editability` is reported with editabilityScope:'band-local' (full-page perSection matches band source
 *     texts against the WHOLE clone; band-scratch can only match within the band) — secondary output, the
 *     contract is `visual`.
 *
 * RAILS: graded/corpus pages receive ONLY GETs — every write goes through scratch-harness
 * (createScratch/assertScratchWritable/deletePage/sweep; tag-swept, signal-trapped, active-file forensics).
 * ONE scratch page per process, reused across bands, PUTs serialized (shared-scratch clobbering is a
 * documented false-negative source). CAS PUT loop (expected_hash, 409 retry) + post-PUT live-hash==new_hash
 * verify + &secvis=<nonce> cache-buster render. JOIST_AUTH_B64 read silently, never printed.
 *
 * CLI:
 *   node sectionvisual.mjs --source <url> --page <id> --band <y0-y1 | sectionIdx>
 *        [--bands y0-y1,y0-y1,…]           # batch: one scratch acquire, serialized PUTs
 *        [--sections /tmp/gsec/sections.json]  # band-by-INDEX source (perSection[].y0/y1) — never re-derived
 *        [--tree /tmp/candidate-tree.json] # ABS_DUMP_TREE format (root object); default = live GET of --page
 *        [--box-index <path>]              # default /tmp/secvis-boxindex-<page>.json; auto-(re)built if stale
 *        [--out /tmp/secvis] [--keep]      # --keep: leave scratch page for debug (next sweep removes it)
 *   exit codes: 0 ok · 2 usage · 3 infra (PUT/render/cache failure)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { perBandVisual, loadSrcCache, captureRetry, W } from './grade-sections.mjs';
import { createScratch, deletePage, sweep, assertScratchWritable, BASE, TAG, CORPUS } from './scratch-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_MAIN = process.argv[1] && process.argv[1].endsWith('sectionvisual.mjs');
export const PAD = 120; // paint-bleed cover (box-shadow/blur/glow outside the border box)

class InfraError extends Error {} // → exit 3 (PUT/render/cache failure — not a tolerance/usage problem)
const infra = (msg) => new InfraError(msg);

// ---- auth + API (mirrors scratch-harness: JOIST_AUTH_B64 read silently from env or /tmp/joist-auth.env;
// NEVER printed; writes carry the required X-Joist-Session-Id header) ----
let _b64 = null;
function authB64() {
  if (_b64) return _b64;
  if (process.env.JOIST_AUTH_B64) { _b64 = process.env.JOIST_AUTH_B64; return _b64; }
  try { const m = fs.readFileSync('/tmp/joist-auth.env', 'utf8').match(/JOIST_AUTH_B64=([^\s'"]+)/); if (m) { _b64 = m[1]; return _b64; } } catch {}
  throw infra('JOIST_AUTH_B64 missing — source /tmp/joist-auth.env first');
}
export async function api(method, p, body = null, timeoutMs = 120000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}${p}`, {
      method,
      headers: { Authorization: 'Basic ' + authB64(), 'Content-Type': 'application/json', 'X-Joist-Session-Id': `secvis-${process.pid}-${Date.now()}` },
      body: body != null ? JSON.stringify(body) : undefined, signal: ac.signal,
    });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, ok: r.ok, json, text };
  } finally { clearTimeout(t); }
}

export async function liveHash(pageId) {
  const r = await api('GET', `/wp-json/joist/v1/pages/${pageId}`);
  const h = r.json && r.json.elementor && r.json.elementor.hash;
  if (!h) throw infra(`cannot read live hash for page ${pageId}: HTTP ${r.status}`);
  return h;
}

// ---- BOX INDEX — one full-page render of the live clone → {nodeId → {x, y(document), w, h}} + docH +
// cloneFullH (the FULL clone page's fullPage-screenshot height — the crop-clamp parity input) + the live joist
// hash (staleness key: live hash != index hash → rebuild). The refine loop builds this once per kept full
// rebuild; its round-0 baseline grade already pays this render. ----
export const boxIndexPath = (pageId) => `/tmp/secvis-boxindex-${pageId}.json`;
export async function buildBoxIndex(pageId, { ctx = null, outPath = null } = {}) {
  const hash = await liveHash(pageId);
  const pageUrl = `${BASE}/?page_id=${pageId}`;
  let browser = null, myCtx = ctx;
  if (!myCtx) {
    browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
    myCtx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
    await myCtx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  }
  try {
    const p = await myCtx.newPage(); await p.setViewportSize({ width: W, height: 900 });
    const bust = `${pageUrl}&secvisidx=${Date.now().toString(36)}`;
    try { await p.goto(bust, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(bust, { waitUntil: 'load', timeout: 30000 }); } catch {} }
    await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(1200);
    await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 150)); } window.scrollTo(0, 0); });
    // bounded lazy settle (same shape capture() applies) so cloneFullH can't race below-fold image paint.
    await p.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const pending = () => [...document.images].filter((im) => !(im.complete && im.naturalWidth > 0));
      const deadline = Date.now() + 8000;
      while (pending().length && Date.now() < deadline) await sleep(150);
    }).catch(() => {});
    await p.waitForTimeout(500);
    const info = await p.evaluate(() => {
      const boxes = {};
      for (const el of document.querySelectorAll('.elementor-element[data-id]')) {
        const r = el.getBoundingClientRect();
        boxes[el.getAttribute('data-id')] = { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
      }
      return { boxes, docH: document.documentElement.scrollHeight };
    });
    const shot = PNG.sync.read(await p.screenshot({ fullPage: true }));
    await p.close();
    const idx = { page: Number(pageId), url: pageUrl, hash, docH: info.docH, cloneFullH: shot.height, builtAt: new Date().toISOString(), boxes: info.boxes };
    fs.writeFileSync(outPath || boxIndexPath(pageId), JSON.stringify(idx));
    return idx;
  } finally { if (browser) await browser.close(); }
}

// ---- BAND EXTRACTION (pure; rule set in the header §1) ----
const isFixedChrome = (n) => { const s = (n && n.settings) || {}; return s.position === 'fixed' || s._position === 'fixed'; };
const isBgRect = (n) => n && n.elType === 'widget' && n.widgetType === 'html'
  && (/^bgr-/.test(String((n.settings || {})._element_id || '')) || /^<div style="[^"]*height:\s*\d+(?:\.\d+)?px/.test(String((n.settings || {}).html || '')));
function nodeExtent(n, boxes, idMap) {
  const s = (n && n.settings) || {};
  if (n.id && boxes && boxes[n.id]) { const b = boxes[n.id]; return { top: b.y, h: Math.max(1, b.h), estimated: false }; }
  const eid = s._element_id;
  if (eid && idMap && idMap[eid] && boxes && boxes[idMap[eid]]) { const b = boxes[idMap[eid]]; return { top: b.y, h: Math.max(1, b.h), estimated: false }; }
  // fallback for nodes missing from the index (operator-inserted candidate widgets): offset + declared height.
  const top = (s._offset_y && typeof s._offset_y.size === 'number') ? s._offset_y.size : 0;
  let h = (s.min_height && typeof s.min_height.size === 'number') ? s.min_height.size : 0;
  if (!h && typeof s.html === 'string') { const m = s.html.match(/height:\s*(\d+(?:\.\d+)?)px/); if (m) h = +m[1]; }
  return { top, h: Math.max(1, h), estimated: true };
}
export function extractBand({ tree, band, boxIndex, idMap = null, pad = PAD }) {
  const root = Array.isArray(tree) ? tree[0] : tree;
  if (!root || root.elType !== 'container' || !Array.isArray(root.elements)) throw new Error('extractBand: tree root is not a container with elements');
  const { y0, y1 } = band;
  const boxes = boxIndex && boxIndex.boxes;
  const included = [];
  const stats = { included: 0, bgRects: 0, header: false, estimated: 0, excluded: 0 };
  for (const child of root.elements) {
    let inc;
    if (isFixedChrome(child)) {
      inc = (y0 === 0); // fixed chrome paints ONCE at document top in fullPage shots → only the y0=0 band sees it
      if (inc) stats.header = true;
    } else {
      const e = nodeExtent(child, boxes, idMap);
      inc = e.top < y1 + pad && e.top + e.h > y0 - pad; // ANY positive overlap with the padded band
      if (inc && e.estimated) stats.estimated++;
    }
    if (!inc) { stats.excluded++; continue; }
    included.push(child); // original array order preserved (offY-sorted by the builder; z via _z_index untouched)
    if (!isFixedChrome(child)) { if (isBgRect(child)) stats.bgRects++; else stats.included++; }
  }
  // scratch root: deep-clone of the ORIGINAL root settings (content_width:full, zero padding, flex column,
  // rootBgFloor background_color — the canvas color is a SETTING and must ride along) with ONE change:
  // min_height=y1 → the document is tall enough that the band paints at its original coords (render-in-place).
  const settings = JSON.parse(JSON.stringify(root.settings || {}));
  settings.min_height = { unit: 'px', size: Math.round(y1) };
  return { bandRoot: { elType: 'container', settings, elements: included }, stats };
}

// ---- per-band PUT: build-absolute's CAS loop (expected_hash, 409 retry) + post-PUT live==new_hash verify.
// Title keeps the `${TAG} ` prefix so the sweeper still recognizes the page after the PUT renames it.
// IDENTICAL-PAYLOAD SKIP: joist refuses a PUT whose save leaves the tree unchanged (422
// atomic_save_silent_failure — the #35888 silent-drop guard; server-side an unchanged tree is
// indistinguishable from a dropped save). A REPEATED render of the SAME band (the determinism probe, operator
// no-op candidates) is exactly that case — so when this process already PUT a byte-identical payload to this
// scratch page AND the live hash still equals that PUT's result hash, skip the PUT (the content is verifiably
// already live). A 422 WITHOUT that local proof stays a LOUD infra error (a genuine silent drop). ----
const _lastPut = new Map(); // scratchId → { payload, hash }
async function putBand(scratchId, srcPageId, bandRoot, pageSettings, label) {
  assertScratchWritable(scratchId, srcPageId);
  const payload = JSON.stringify([bandRoot]) + ' ' + JSON.stringify(pageSettings || {});
  let expected = await liveHash(scratchId);
  const prev = _lastPut.get(Number(scratchId));
  if (prev && prev.payload === payload && prev.hash === expected) return expected; // verifiably already live

  let r = null;
  for (let a = 0; a < 5; a++) {
    assertScratchWritable(scratchId, srcPageId);
    r = await api('PUT', `/wp-json/joist/v1/pages/${scratchId}`, {
      expected_hash: expected, elements: [bandRoot], page_settings: pageSettings,
      title: `${TAG} secvis ${label}`, intent: 'sectionVisual band render (scratch)',
    });
    if (r.status !== 409) break;
    try { expected = r.json.details.current_hash; } catch {}
    await new Promise((res) => setTimeout(res, 400));
  }
  if (!r || !r.ok) throw infra(`band PUT failed: HTTP ${r && r.status} ${String(r && r.text).slice(0, 200)}`);
  const newHash = r.json && (r.json.new_hash || r.json.hash) || null;
  const live = await liveHash(scratchId);
  if (newHash && live !== newHash) throw infra(`post-PUT live hash != new_hash (stale-read/clobber guard): ${live} vs ${newHash}`);
  _lastPut.set(Number(scratchId), { payload, hash: live });
  return live;
}

// crop rows [y0,y1) out of a full-page PNG (LOOK/debug artifacts for the report's shots.*)
function cropRows(png, y0, y1) {
  const h = Math.max(1, Math.min(png.height, y1) - y0);
  const out = new PNG({ width: png.width, height: h });
  PNG.bitblt(png, out, 0, Math.max(0, y0), png.width, h, 0, 0);
  return out;
}

// ---- prepare(): the shared per-page context (src cache, tree, page settings, box index, id map). Built once,
// reused across bands. ALL graded-page traffic in here is GET-only. ----
export async function prepare({ source, pageId, treePath = null, boxIndexFile = null, ctx = null }) {
  const srcCache = loadSrcCache(source);
  if (!srcCache) throw infra(`no frozen source capture for ${source} — run grade-sections first (it writes /tmp/grade-src-cache/<srcTag>.{json,png})`);
  let tree, treeMode;
  if (treePath) {
    tree = JSON.parse(fs.readFileSync(treePath, 'utf8')); treeMode = 'file'; // ABS_DUMP_TREE format (root object)
  } else {
    const r = await api('GET', `/wp-json/joist/v1/pages/${pageId}?include=elements`);
    const els = r.json && r.json.elementor && r.json.elementor.elements;
    if (!r.ok || !Array.isArray(els)) throw infra(`cannot GET live tree for page ${pageId}: HTTP ${r.status}`);
    tree = els; treeMode = 'live';
  }
  let pageSettings = {};
  try {
    const meta = await api('GET', `/wp-json/wp/v2/pages/${pageId}?context=edit&_fields=meta,template`);
    const ps = meta.json && meta.json.meta && meta.json.meta._elementor_page_settings;
    if (ps && typeof ps === 'object' && !Array.isArray(ps)) pageSettings = ps; // custom_css carried WHOLE, verbatim
  } catch {}
  const idxPath = boxIndexFile || boxIndexPath(pageId);
  let boxIndex = null;
  try { boxIndex = JSON.parse(fs.readFileSync(idxPath, 'utf8')); } catch {}
  const live = await liveHash(pageId);
  if (!boxIndex || boxIndex.hash !== live) {
    console.error(`[secvis] box index ${boxIndex ? 'STALE (live hash changed)' : 'missing'} → rebuilding (one full-page render)`);
    boxIndex = await buildBoxIndex(pageId, { ctx, outPath: idxPath });
  }
  let idMap = null;
  try { const j = JSON.parse(fs.readFileSync(`/tmp/joist-idmap-${pageId}.json`, 'utf8')); idMap = j.map || null; } catch {}
  return { source, pageId: Number(pageId), srcCache, tree, treeMode, pageSettings, boxIndex, idMap, cloneFullH: boxIndex.cloneFullH };
}

/**
 * sectionVisual — the primitive. opts:
 *   source, pageId, band:{y0,y1}                      (required)
 *   prep        — shared prepare() result             (built on demand if absent)
 *   scratch     — {pageId,url} shared scratch page    (created+released here if absent)
 *   ctx         — shared playwright context           (launched+closed here if absent)
 *   outDir, pad, keep, label
 * Returns the per-band report (also written to <outDir>/secvis-<page>-<y0>-<y1>.json).
 */
export async function sectionVisual(opts) {
  const t0 = Date.now();
  const { source, pageId, band, outDir = '/tmp/secvis', pad = PAD, keep = false, label = '' } = opts;
  if (!source || !pageId || !band || typeof band.y0 !== 'number' || typeof band.y1 !== 'number') throw new Error('sectionVisual: need source, pageId, band{y0,y1}');
  fs.mkdirSync(outDir, { recursive: true });
  let { prep, scratch, ctx } = opts;
  let myBrowser = null, ownScratch = false;
  try {
    if (!ctx) {
      myBrowser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
      ctx = await myBrowser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    }
    if (!prep) prep = await prepare({ source, pageId, treePath: opts.treePath || null, boxIndexFile: opts.boxIndexFile || null, ctx });
    if (!scratch) {
      const made = await createScratch({ title: `secvis ${pageId}`, elements: [], pageSettings: prep.pageSettings, template: 'elementor_canvas', srcId: pageId });
      scratch = { pageId: made.pageId, url: made.url }; ownScratch = true;
    }
    const { y0, y1 } = band;
    const { bandRoot, stats } = extractBand({ tree: prep.tree, band, boxIndex: prep.boxIndex, idMap: prep.idMap, pad });

    // divergence audit: doc-height-dependent CSS units in the carried css/html (builder emits px-only).
    const divergenceFlags = [];
    const vhRe = /\d(?:\.\d+)?(?:vh|svh|lvh|dvh)\b/;
    const css = String((prep.pageSettings && prep.pageSettings.custom_css) || '');
    if (vhRe.test(css) || bandRoot.elements.some((n) => n.widgetType === 'html' && vhRe.test(String((n.settings || {}).html || '')))) divergenceFlags.push('vh-in-css');

    const tPut0 = Date.now();
    const scratchHash = await putBand(scratch.pageId, pageId, bandRoot, prep.pageSettings, `${pageId} band ${y0}-${y1}`);
    const putMs = Date.now() - tPut0;

    const tRen0 = Date.now();
    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const cap = await captureRetry(ctx, `${scratch.url}&secvis=${nonce}`, false); // SAME capture path as the grader (settleLazy ON)
    const renderMs = Date.now() - tRen0;

    const tSc0 = Date.now();
    const H = Math.min(prep.srcCache.shot.height, prep.cloneFullH); // crop-clamp parity with the full-page grade
    const gy1 = Math.min(H, y1);
    const gradable = (y1 - y0 >= 20) && (gy1 - y0 > 8); // mirrors grade-sections' band gates
    if (cap.shot.height < gy1) divergenceFlags.push('scratch-short'); // min_height=y1 should make this impossible
    const pb = gradable && cap.shot.height >= gy1
      ? perBandVisual({ srcShot: prep.srcCache.shot, cloneShot: cap.shot, srcTexts: prep.srcCache.texts, cloneTexts: cap.texts, cloneImgs: cap.imgs, y0, y1, H, selftest: false })
      : null;
    // LOOK artifacts: the two band crops (src side from the frozen cache, clone side from the scratch render)
    const shotSrc = path.join(outDir, `secvis-${pageId}-${y0}-${y1}-src.png`);
    const shotBand = path.join(outDir, `secvis-${pageId}-${y0}-${y1}-band.png`);
    if (gradable) {
      try { fs.writeFileSync(shotSrc, PNG.sync.write(cropRows(prep.srcCache.shot, y0, gy1))); fs.writeFileSync(shotBand, PNG.sync.write(cropRows(cap.shot, y0, Math.min(gy1, cap.shot.height)))); } catch {}
    }
    const scoreMs = Date.now() - tSc0;

    const report = {
      source, page: Number(pageId), scratchId: scratch.pageId, treeMode: prep.treeMode,
      band: { y0, y1 }, gradable, gy1,
      visual: pb ? pb.visual : 0, visualPreVoid: pb ? pb.visualPreVoid : 0,
      ssim: pb ? +pb.ssim.toFixed(3) : 0, exact: pb ? +pb.exact.toFixed(3) : 0, meanDE: pb ? +pb.meanDE.toFixed(1) : null,
      contentVoid: pb ? pb.contentVoid : false, rasteredText: pb ? pb.rasteredText : false,
      srcEnergy: pb ? pb.srcEnergy : 0, cloneEnergy: pb ? pb.cloneEnergy : 0,
      editability: pb ? pb.editability : null, editabilityScope: 'band-local',
      widgets: { included: stats.included, bgRects: stats.bgRects, header: stats.header, estimated: stats.estimated, excluded: stats.excluded },
      cssBytes: css.length, boxIndexHash: prep.boxIndex.hash, scratchHash, cloneFullH: prep.cloneFullH,
      srcCache: prep.srcCache.srcTag, shots: gradable ? { src: shotSrc, band: shotBand } : null,
      divergenceFlags, timings: { putMs, renderMs, scoreMs, totalMs: Date.now() - t0 },
    };
    fs.writeFileSync(path.join(outDir, `secvis-${pageId}-${y0}-${y1}.json`), JSON.stringify(report, null, 2));
    return report;
  } finally {
    if (ownScratch && scratch) { try { keep ? console.error(`[secvis] scratch ${scratch.pageId} KEPT (debug)`) : await deletePage(scratch.pageId, pageId); } catch (e) { console.error('[secvis] scratch release failed (sweep will catch it):', String(e).slice(0, 160)); } }
    if (myBrowser) await myBrowser.close();
  }
}

// ---- CLI ----
if (IS_MAIN) (async () => {
  const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
  const has = (n) => process.argv.includes('--' + n);
  const source = arg('source'), pageId = arg('page'), outDir = arg('out', '/tmp/secvis');
  const bandArg = arg('band'), bandsArg = arg('bands');
  if (!source || !pageId || (!bandArg && !bandsArg)) { console.error('usage: node sectionvisual.mjs --source <url> --page <id> --band <y0-y1 | sectionIdx> [--bands y0-y1,…] [--sections sections.json] [--tree file] [--box-index file] [--out dir] [--keep]'); process.exit(2); }
  // band definitions are CONSUMED from the latest sections.json (perSection[].y0/y1) — never re-derived here.
  const resolveBand = (s) => {
    if (/^\d+-\d+$/.test(s)) { const [a, b] = s.split('-').map(Number); return { y0: a, y1: b }; }
    if (/^\d+$/.test(s)) {
      const secPath = arg('sections', '/tmp/gsec/sections.json');
      let rep; try { rep = JSON.parse(fs.readFileSync(secPath, 'utf8')); } catch { console.error(`--band ${s} is an index but ${secPath} is unreadable (pass --sections or run grade-sections first)`); process.exit(2); }
      const sec = (rep.perSection || []).find((x) => x.idx === Number(s));
      if (!sec) { console.error(`section idx ${s} not in ${secPath}`); process.exit(2); }
      return { y0: sec.y0, y1: sec.y1 };
    }
    console.error(`bad --band ${s} (want y0-y1 or a perSection idx)`); process.exit(2);
  };
  const bands = bandsArg ? bandsArg.split(',').map(resolveBand) : [resolveBand(bandArg)];
  try { execSync("pkill -9 -f 'chrome-headless-shell' 2>/dev/null || true", { stdio: 'ignore' }); } catch {}
  try { const sw = await sweep({ maxAgeMin: 60 }); if (sw.deleted.length) console.error(`[secvis] swept ${sw.deleted.length} stale scratch page(s): ${sw.deleted.join(', ')}`); } catch {}
  let browser = null, scratch = null, exitCode = 0;
  try {
    browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
    const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const prep = await prepare({ source, pageId, treePath: arg('tree'), boxIndexFile: arg('box-index'), ctx });
    const made = await createScratch({ title: `secvis ${pageId}`, elements: [], pageSettings: prep.pageSettings, template: 'elementor_canvas', srcId: Number(pageId) });
    scratch = { pageId: made.pageId, url: made.url };
    const out = [];
    for (const band of bands) { // serialized: one PUT at a time per page (hard rail)
      const r = await sectionVisual({ source, pageId: Number(pageId), band, prep, scratch, ctx, outDir });
      out.push(r);
      console.log(`band ${band.y0}-${band.y1}: visual ${r.visual} (ssim ${r.ssim} exact ${r.exact}) void ${r.contentVoid} rastered ${r.rasteredText} edit(band-local) ${r.editability} | widgets ${r.widgets.included}+${r.widgets.bgRects}bg${r.widgets.header ? '+hdr' : ''} est ${r.widgets.estimated} | ${r.timings.totalMs}ms${r.divergenceFlags.length ? ' | flags: ' + r.divergenceFlags.join(',') : ''}`);
    }
    console.log(JSON.stringify(out.length === 1 ? out[0] : out));
  } catch (e) {
    console.error(String(e && e.stack || e));
    exitCode = e instanceof InfraError ? 3 : 1;
  } finally {
    if (scratch) { try { has('keep') ? console.error(`[secvis] scratch ${scratch.pageId} KEPT (debug) — next sweep removes it`) : await deletePage(scratch.pageId, Number(pageId)); } catch (e) { console.error('[secvis] scratch release failed (sweep will catch it):', String(e).slice(0, 160)); exitCode = exitCode || 3; } }
    if (browser) await browser.close();
  }
  process.exit(exitCode);
})();
