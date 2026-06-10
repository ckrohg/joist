#!/usr/bin/env node
/**
 * @purpose CONTROL-EDIT RENDER PROBE (B1 round 1) — measures "does a panel edit actually RENDER?"
 * pixel-level, on a crash-safe scratch DUPLICATE (graded page gets only GETs). Implements
 * knowledge/CONTROL_EDIT_PROBE_SPEC.md: denominator = ALL source text runs (heading/button/text),
 * mapping = re-derived id-map → text fallback (refine-clone findWidget semantics), edit channel =
 * color (title_color / text_color) with unique per-probe sentinels, ONE batched CAS PUT, pixel
 * asserts (target ΔE2000<12 ≥ max(20px, 0.4% box); outside-mask diff ≤0.05%; |ΔpageH|≤2px; one 390
 * leg). Emits control_edit_roundtrip = mapped_panel_rate × probe_pass_rate.
 *
 * Usage: node probe-roundtrip.mjs --page <cloneId> --source <url> [--n 16] [--layout <path>]
 *                                 [--sweep-all] [--keep]
 * Report: /tmp/roundtrip-<page>.json (+ stdout summary; metrics JSON on the last line).
 * Env: JOIST_AUTH_B64 (source /tmp/joist-auth.env; never printed), JOIST_BASE,
 *      PROBE_N_PER_STRATUM (default 6), PROBE_KEEP_SCRATCH=1 (skip teardown; sweep cleans later).
 * Exit: 0 run VALID, 2 usage, 3 run INVALID.
 *
 * Spec adaptations (repo reality, recorded):
 *  - deletes via core wp/v2 (joist delete is plan-gated destructive) — see scratch-harness.mjs header.
 *  - the edit ALSO clears __globals__.<colorKey> (set '') when present: build-absolute.mjs:823 binds
 *    title_color to a kit global which otherwise overrides the local setting — the Elementor panel
 *    unlinks automatically when a user picks a custom color, so clearing it IS the panel-equivalent edit.
 *  - --n is the TOTAL sample cap (task CLI); truncation is stratum-round-robin (heading→text→button)
 *    so small smokes keep per-stratum signal. Per-stratum first-k stays PROBE_N_PER_STRATUM (6).
 *  - html-widget text matching also scans value/placeholder/alt/title attrs (form-recovery inputs
 *    carry their text in value="…" — tag-stripping alone would misclassify FAIL_NOT_PANEL as
 *    FAIL_NOT_AUTHORED).
 *  - the BEFORE pass runs TWICE (4 screenshots total, not 3): the no-edit A/B pair calibrates a
 *    per-run render-noise mask (8px cells, dilated 1) excluded from the side-effect assert. Proven
 *    necessary on 3146: the code-panel band differs ~51k px between two no-edit loads — without
 *    calibration every probe on that page would FALSE-FAIL_SIDE_EFFECT. Anti-gaming: the mask is
 *    computed BEFORE any edit exists, so edit-caused leakage can never enter it.
 *  - probe target/mask boxes: target assert uses the inner render node rect; the side-effect mask
 *    uses the full paint extent (wrapper ∪ inner ∪ symmetric scroll-overflow — centered headline
 *    glyphs overflow the pinned widget width on BOTH sides on abs builds).
 *  - a warm-up frontend GET runs after acquire: the duplicate's first-ever render generates its
 *    Elementor post CSS mid-load and is not comparable to the post-PUT regen+flush state.
 */
import fs from 'fs';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { acquire, sweep, BASE, assertScratchWritable } from './scratch-harness.mjs';

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SRC_PAGE = Number(arg('page'));
const SOURCE = arg('source');
const LAYOUT_OVERRIDE = arg('layout');
const N_CAP = Math.min(20, Math.max(1, Number(arg('n', '16')) || 16));          // hard cap 20 per spec §4
const K_PER_STRATUM = Math.max(1, Number(process.env.PROBE_N_PER_STRATUM || 6));
const KEEP = has('keep') || process.env.PROBE_KEEP_SCRATCH === '1';
if (!Number.isInteger(SRC_PAGE) || SRC_PAGE <= 0 || (!SOURCE && !LAYOUT_OVERRIDE)) {
  console.error('usage: node probe-roundtrip.mjs --page <cloneId> --source <url> [--n 16] [--layout <path>] [--sweep-all] [--keep]');
  process.exit(2);
}

// ---------- text helpers (verbatim semantics: build-absolute.mjs:20 stripEmoji; refine-clone.mjs norm) ----------
const stripEmoji = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '').replace(/\s+/g, ' ').trim();
const norm = (s) => (s || '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- color: sRGB→Lab + CIEDE2000 (compact port of perelement-score.mjs:89-144, Sharma-verified there) ----------
function srgbToLab(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  let X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  let Y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750);
  let Z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
  const f = (t) => t > 0.008856451679035631 ? Math.cbrt(t) : (7.787037037037037 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function ciede2000([L1, a1, b1], [L2, a2, b2]) {
  const d2r = (d) => d * Math.PI / 180, r2d = (r) => r * 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cbar = (C1 + C2) / 2, Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  let h1p = r2d(Math.atan2(b1, a1p)); if (h1p < 0) h1p += 360;
  let h2p = r2d(Math.atan2(b2, a2p)); if (h2p < 0) h2p += 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp; if (C1p * C2p === 0) dhp = 0; else { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(d2r(dhp) / 2);
  const Lbarp = (L1 + L2) / 2, Cbarp = (C1p + C2p) / 2;
  let hbarp; if (C1p * C2p === 0) hbarp = h1p + h2p; else hbarp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
  const T = 1 - 0.17 * Math.cos(d2r(hbarp - 30)) + 0.24 * Math.cos(d2r(2 * hbarp)) + 0.32 * Math.cos(d2r(3 * hbarp + 6)) - 0.20 * Math.cos(d2r(4 * hbarp - 63));
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Cbarp ** 7, RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp, SH = 1 + 0.015 * Cbarp * T, RT = -Math.sin(d2r(2 * dTheta)) * RC;
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
}
const hexToRgb = (h) => { const m = String(h).replace('#', ''); return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]; };
// sentinel palette (spec §3) + deterministic HSL extension
const PALETTE = ['#FF00AA', '#00FF11', '#FF6600', '#0033FF', '#AA00FF', '#00FFEE', '#FFD400', '#FF0044'];
function paletteAt(i) {
  if (i < PALETTE.length) return PALETTE[i];
  const hue = ((i - PALETTE.length) * 47 + 15) % 360;                       // deterministic, seed-free
  const f = (n) => { const k = (n + hue / 30) % 12; const c = Math.round(255 * (1 - Math.max(-1, Math.min(k - 3, 9 - k, 1)))); return c.toString(16).padStart(2, '0').toUpperCase(); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
/** count pixels inside box (inset, clamped) within ΔE2000<maxDE of sentinel rgb */
function countSentinelPx(png, box, rgb, { maxDE = 12, inset = 1 } = {}) {
  if (!box) return 0;
  const lab = srgbToLab(...rgb);
  const x0 = Math.max(0, Math.floor(box.x) + inset), y0 = Math.max(0, Math.floor(box.y) + inset);
  const x1 = Math.min(png.width - 1, Math.ceil(box.x + box.w) - 1 - inset), y1 = Math.min(png.height - 1, Math.ceil(box.y + box.h) - 1 - inset);
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * png.width + x) << 2;
    if (ciede2000(lab, srgbToLab(png.data[i], png.data[i + 1], png.data[i + 2])) < maxDE) n++;
  }
  return n;
}
/**
 * full-page diff: pixels with any channel diff >16 OUTSIDE union(padded boxes), excluding noisyCells
 * (8px-grid cells that changed between two NO-EDIT renders — intrinsic render noise is unattributable
 * to the edit; calibrated per-run from a double-before shot). returns {outside,noise,total,cx,cy}
 */
function diffOutsideMask(before, after, boxes, { pad = 4, chanThr = 16, noisyCells = null } = {}) {
  const w = Math.min(before.width, after.width), h = Math.min(before.height, after.height);
  const pb = boxes.filter(Boolean).map((b) => ({ x0: Math.max(0, Math.floor(b.x) - pad), x1: Math.min(w - 1, Math.ceil(b.x + b.w) + pad), y0: Math.max(0, Math.floor(b.y) - pad), y1: Math.min(h - 1, Math.ceil(b.y + b.h) + pad) }));
  let outside = 0, noise = 0, sx = 0, sy = 0;
  for (let y = 0; y < h; y++) {
    const iv = pb.filter((b) => y >= b.y0 && y <= b.y1).map((b) => [b.x0, b.x1]).sort((a, b2) => a[0] - b2[0]);
    const merged = []; for (const i of iv) { if (merged.length && i[0] <= merged[merged.length - 1][1] + 1) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], i[1]); else merged.push([...i]); }
    let mi = 0;
    for (let x = 0; x < w; x++) {
      while (mi < merged.length && x > merged[mi][1]) mi++;
      const inMask = mi < merged.length && x >= merged[mi][0] && x <= merged[mi][1];
      if (inMask) { x = merged[mi][1]; continue; }                          // skip masked interval
      const bi = (y * before.width + x) << 2, ai = (y * after.width + x) << 2;
      if (Math.abs(before.data[bi] - after.data[ai]) > chanThr || Math.abs(before.data[bi + 1] - after.data[ai + 1]) > chanThr || Math.abs(before.data[bi + 2] - after.data[ai + 2]) > chanThr) {
        if (noisyCells && noisyCells.has(((y >> 3) << 16) | (x >> 3))) { noise++; continue; }
        outside++; sx += x; sy += y;
      }
    }
  }
  return { outside, noise, total: w * h, cx: outside ? sx / outside : 0, cy: outside ? sy / outside : 0 };
}
/** noise mask from two NO-EDIT renders: set of 8px cells (packed (cy<<16)|cx) that changed, dilated 1 cell */
function noiseCells(a, b, { chanThr = 16 } = {}) {
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const raw = new Set();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ai = (y * a.width + x) << 2, bi = (y * b.width + x) << 2;
    if (Math.abs(a.data[ai] - b.data[bi]) > chanThr || Math.abs(a.data[ai + 1] - b.data[bi + 1]) > chanThr || Math.abs(a.data[ai + 2] - b.data[bi + 2]) > chanThr) raw.add(((y >> 3) << 16) | (x >> 3));
  }
  const out = new Set();
  for (const k of raw) { const cy = k >> 16, cx = k & 0xffff; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const ny = cy + dy, nx = cx + dx; if (ny >= 0 && nx >= 0) out.add((ny << 16) | nx); } }
  return out;
}

// ---------- engine-tree helpers (refine-clone.mjs:102-146 semantics) ----------
const sizeOf = (v) => (v && typeof v === 'object' && typeof v.size === 'number') ? v.size : (typeof v === 'number' ? v : null);
function widgetText(w) { const s = w.settings || {}; if (w.widgetType === 'heading') return norm(s.title); if (w.widgetType === 'text-editor') return norm(s.editor); return norm(s.title || s.editor || s.text || ''); }
function widgetCenter(w) { const s = w.settings || {}; const ox = sizeOf(s._offset_x), oy = sizeOf(s._offset_y), cw = sizeOf(s._element_custom_width); return { cx: ox != null ? ox + (cw != null ? cw / 2 : 0) : null, cy: oy != null ? oy : null }; }
function indexWidgets(elements) { const out = []; let di = 0; const walk = (n) => { if (!n || typeof n !== 'object') return; if (n.elType === 'widget') out.push({ node: n, docIndex: di++ }); (n.elements || []).forEach(walk); }; (elements || []).forEach(walk); return out; }
function findWidget(run, widgets, used) {                                    // refine-clone.mjs:126-146 verbatim semantics
  const txt = norm(run.text); if (!txt) return null;
  let pool = widgets.filter((w) => !used.has(w.node.id) && widgetText(w.node) === txt);
  if (!pool.length) pool = widgets.filter((w) => !used.has(w.node.id) && txt.length >= 4 && widgetText(w.node).includes(txt));
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0];
  let best = null, bestD = Infinity;
  for (const w of pool) { const { cx, cy } = widgetCenter(w.node); if (cx == null || cy == null) continue; const d = Math.hypot(cx - run.cx, cy - run.cy); if (d < bestD) { bestD = d; best = w; } }
  return best || pool[0];
}
// html-widget text (tags stripped + value/placeholder/alt/title attr contents — form-recovery inputs)
function htmlWidgetText(w) {
  const html = String((w.settings || {}).html || '');
  const attrs = (html.match(/(?:value|placeholder|alt|title)="([^"]*)"/gi) || []).map((m) => m.replace(/^[a-z]+="/i, '').replace(/"$/, '')).join(' ');
  return norm(html + ' ' + attrs);
}

// ---------- REST ----------
let _b64 = null;
function b64() { if (_b64) return _b64; _b64 = process.env.JOIST_AUTH_B64 || (fs.readFileSync('/tmp/joist-auth.env', 'utf8').match(/JOIST_AUTH_B64=([^\s'"]+)/) || [])[1]; if (!_b64) throw new Error('JOIST_AUTH_B64 missing'); return _b64; }
const hdr = () => ({ Authorization: 'Basic ' + b64(), 'Content-Type': 'application/json', 'X-Joist-Session-Id': `probe-${process.pid}-${Date.now()}` });
async function jget(path) { const r = await fetch(`${BASE}${path}`, { headers: hdr() }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, ok: r.ok, json: j, text: t }; }

// ---------- render pass (screenshots via THIS node process — never mcp__playwright) ----------
async function settle(p) {                                                   // settleLazy semantics (grade-vision-tiles.mjs:102) — never throws
  try {
    await p.evaluate(async () => {
      const zz = (ms) => new Promise((r) => setTimeout(r, ms));
      const docH = () => document.body.scrollHeight;
      let y = 0, guard = 0;
      while (y <= docH() && guard++ < 400) { window.scrollTo(0, y); await zz(110); y += 600; }
      window.scrollTo(0, docH()); await zz(250);
      const pending = () => [...document.images].filter((im) => !(im.complete && im.naturalWidth > 0));
      const deadline = Date.now() + 8000;
      while (pending().length && Date.now() < deadline) await zz(150);
      await Promise.all([...document.images].slice(0, 500).map((im) => im.decode && im.decode().catch(() => {})));
      window.scrollTo(0, 0); await zz(150);
    }).catch(() => {});
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(400).catch(() => {});
  } catch {}
}
async function renderPass(browser, url, viewport, specs, shotPath) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await settle(p);
  // font-readiness: without this, one pass can paint webfont glyphs and the other fallback glyphs →
  // different line metrics → vertical shifts everywhere → FALSE FAIL_SIDE_EFFECT (seen on 3146 smoke).
  await p.evaluate(() => (document.fonts && document.fonts.ready) || true).catch(() => {});
  await p.evaluate(() => { const st = document.createElement('style'); st.textContent = '*{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.appendChild(st); }).catch(() => {});
  await p.waitForTimeout(400);
  const info = await p.evaluate((specList) => {
    const out = { pageH: document.documentElement.scrollHeight, boxes: {} };
    for (const s of specList) {
      const wrap = document.querySelector(`[data-id="${s.eid}"]`) || document.querySelector(`.elementor-element-${s.eid}`);
      if (!wrap) { out.boxes[s.eid] = null; continue; }
      let inner;
      if (s.widgetType === 'heading') inner = wrap.querySelector('.elementor-heading-title') || wrap;
      else { const c = wrap.querySelector('.elementor-widget-container') || wrap; inner = c.firstElementChild || c; }
      const cs = getComputedStyle(inner); const r = inner.getBoundingClientRect();
      // paint-extent mask box: glyphs can OVERFLOW the inner rect (abs builds pin widget width to the
      // captured box; a wider fallback/web font paints past it — seen on the 3146 hero). The side-effect
      // mask must cover the edited element's full painted extent: wrapper ∪ inner ∪ scroll overflow.
      // SYMMETRIC overflow expansion: centered text overflows BOTH sides (scrollWidth only measures
      // rightward) — expand by the overflow amount on each side.
      const wr = wrap.getBoundingClientRect();
      const ox = Math.max(0, inner.scrollWidth - r.width), oy = Math.max(0, inner.scrollHeight - r.height);
      const mx0 = Math.min(r.left - ox, wr.left), my0 = Math.min(r.top - oy, wr.top);
      const mx1 = Math.max(r.right + ox, wr.right);
      const my1 = Math.max(r.bottom + oy, wr.bottom);
      out.boxes[s.eid] = { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height, color: cs.color, hidden: (cs.display === 'none' || cs.visibility === 'hidden' || r.width <= 0 || r.height <= 0),
        mask: { x: mx0 + window.scrollX, y: my0 + window.scrollY, w: mx1 - mx0, h: my1 - my0 } };
    }
    return out;
  }, specs);
  const buf = await p.screenshot({ fullPage: true });
  fs.writeFileSync(shotPath, buf);
  await ctx.close();
  return { png: PNG.sync.read(buf), info };
}

// =================================================================== main
(async () => {
  const started = new Date().toISOString(), t0 = Date.now();
  const report = {
    version: 1, src_page: SRC_PAGE, scratch_page: 0,
    run: { status: 'INVALID', started, ms: 0, screenshots: {} },
    denominator: { text_runs_total: 0, mapped_panel: 0, mapped_html: 0, unmatched: 0, by_stratum: { heading: 0, text: 0, button: 0 } },
    sampling: { k_per_stratum: K_PER_STRATUM, n_cap: N_CAP, sampled: 0, by_stratum: { heading: 0, text: 0, button: 0 } },
    probes: [], metrics: null, errors: [],
  };
  const reportPath = `/tmp/roundtrip-${SRC_PAGE}.json`;
  const finish = (code) => { report.run.ms = Date.now() - t0; fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log(`report → ${reportPath}`); console.log(JSON.stringify({ status: report.run.status, metrics: report.metrics })); process.exit(code); };

  // -- layout (denominator universe) --
  const slug = SOURCE ? SOURCE.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 16).toLowerCase() : null;  // clone.mjs:26 rule
  const layoutPath = LAYOUT_OVERRIDE || [`/tmp/abs-cache/${slug}/layout.json`, `/tmp/clone-layout-${slug}.json`].find((p) => fs.existsSync(p));
  if (!layoutPath || !fs.existsSync(layoutPath)) { report.errors.push(`ERROR_INFRA: no layout at /tmp/abs-cache/${slug}/layout.json or /tmp/clone-layout-${slug}.json`); finish(3); }
  const L = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
  const runs = [];
  (function walk(n) { if (!n || typeof n !== 'object') return; if (['heading', 'button', 'text'].includes(n.kind)) { const t = stripEmoji(n.text); if (t) runs.push({ kind: n.kind, text: t, box: n.box || null, cx: n.box ? n.box.x + n.box.w / 2 : null, cy: n.box ? n.box.y : null }); } (n.children || []).forEach(walk); })(L.root || L);
  report.denominator.text_runs_total = runs.length;
  console.log(`layout ${layoutPath}: ${runs.length} text run(s) in denominator`);

  // -- sweep stale scratch, acquire duplicate --
  let dup = null;
  try {
    const sw = await sweep({ maxAgeMin: 60, all: has('sweep-all') });
    if (sw.deleted.length) console.log(`sweep: deleted stale scratch ${sw.deleted.join(',')}`);
    dup = await acquire(SRC_PAGE, { note: 'probe' });
    report.scratch_page = dup.pageId;
    console.log(`scratch duplicate of ${SRC_PAGE} → page ${dup.pageId} (${dup.url})`);
  } catch (e) { report.errors.push(`ERROR_INFRA acquire: ${String(e).slice(0, 200)}`); finish(3); }

  let teardownOk = false;
  try {
    // -- live duplicate tree + id-map (re-derived from the DUPLICATE read-back; build-absolute.mjs:2663 walk) --
    const dupRead = await jget(`/wp-json/joist/v1/pages/${dup.pageId}?include=elements`);
    const dupElements = dupRead.json && dupRead.json.elementor && dupRead.json.elementor.elements;
    if (!Array.isArray(dupElements)) throw new Error(`ERROR_INFRA: cannot read duplicate tree (${dupRead.status})`);
    const widgets = indexWidgets(dupElements);
    const idMap = new Map();
    for (const w of widgets) { const eid = w.node.settings && w.node.settings._element_id; if (eid && w.node.id) idMap.set(eid, w); }
    const panelWidgets = widgets.filter((w) => w.node.widgetType === 'heading' || w.node.widgetType === 'text-editor');
    const htmlWidgets = widgets.filter((w) => w.node.widgetType === 'html').map((w) => ({ ...w, txt: htmlWidgetText(w.node) }));
    console.log(`duplicate tree: ${widgets.length} widgets (${panelWidgets.length} panel, ${htmlWidgets.length} html), id-map ${idMap.size}`);

    // -- classify every run (spec §2: exhaustive, never "unsampled") --
    const used = new Set();
    const classified = [];
    for (const run of runs) {
      let w = null, via = 'none';
      const pbid = run.box ? `pb${Math.round(run.box.x)}-${Math.round(run.box.y)}-${Math.round(run.box.w)}-${Math.round(run.box.h)}` : null;  // build-absolute.mjs:143
      if (pbid && idMap.has(pbid) && !used.has(idMap.get(pbid).node.id)) { w = idMap.get(pbid); via = 'idmap'; }
      if (!w) { w = findWidget(run, panelWidgets, used); if (w) via = 'text'; }
      if (w && (w.node.widgetType === 'heading' || w.node.widgetType === 'text-editor')) {
        used.add(w.node.id);
        const stratum = w.node.widgetType === 'heading' ? 'heading'
          : (/^<a[\s>]/i.test(String((w.node.settings || {}).editor || '').trim()) ? 'button' : 'text');   // build-absolute.mjs:837/845
        classified.push({ run, widget: w, via, bucket: 'panel', stratum });
      } else if (w && w.node.widgetType === 'html') {
        classified.push({ run, widget: w, via, bucket: 'html', stratum: null });
      } else {
        const t = norm(run.text);
        const hw = htmlWidgets.find((x) => t.length >= 4 ? x.txt.includes(t) : x.txt === t);
        if (hw) classified.push({ run, widget: hw, via: 'html-text', bucket: 'html', stratum: null });
        else classified.push({ run, widget: null, via: 'none', bucket: 'unmatched', stratum: null });
      }
    }
    const panel = classified.filter((c) => c.bucket === 'panel');
    report.denominator.mapped_panel = panel.length;
    report.denominator.mapped_html = classified.filter((c) => c.bucket === 'html').length;
    report.denominator.unmatched = classified.filter((c) => c.bucket === 'unmatched').length;
    for (const c of panel) report.denominator.by_stratum[c.stratum]++;
    console.log(`denominator: ${runs.length} runs → panel ${panel.length} (h ${report.denominator.by_stratum.heading} / t ${report.denominator.by_stratum.text} / b ${report.denominator.by_stratum.button}), html ${report.denominator.mapped_html}, unmatched ${report.denominator.unmatched}`);

    // -- sampling (spec §4): per-stratum first-k by document order, text-deduped; --n cap via stratum round-robin --
    const byStratum = { heading: [], text: [], button: [] };
    for (const c of panel.slice().sort((a, b2) => a.widget.docIndex - b2.widget.docIndex)) {
      const lane = byStratum[c.stratum];
      if (lane.length >= K_PER_STRATUM) continue;
      if (lane.some((x) => norm(x.run.text) === norm(c.run.text))) continue;  // dedupe repeated text within stratum
      lane.push(c);
    }
    let sampled = [];
    for (let i = 0; i < K_PER_STRATUM && sampled.length < N_CAP; i++)
      for (const s of ['heading', 'text', 'button']) { if (sampled.length >= N_CAP) break; if (byStratum[s][i]) sampled.push(byStratum[s][i]); }
    const sampledIds = new Set(sampled.map((c) => c.widget.node.id));
    report.sampling.sampled = sampled.length;
    for (const c of sampled) report.sampling.by_stratum[c.stratum]++;
    console.log(`sampled ${sampled.length} probe(s): h ${report.sampling.by_stratum.heading} / t ${report.sampling.by_stratum.text} / b ${report.sampling.by_stratum.button}`);
    if (!sampled.length) throw new Error('ERROR_INFRA: nothing to probe (0 mapped-panel runs sampled)');

    // probe records
    const probes = sampled.map((c, i) => ({
      run_text: c.run.text.slice(0, 80), stratum: c.stratum, engine_id: c.widget.node.id,
      element_id: (c.widget.node.settings && c.widget.node.settings._element_id) || null, map_via: c.via,
      setting: c.stratum === 'heading' ? 'title_color' : 'text_color',
      sentinel: paletteAt(i), had_global: false, data_verified: false,
      target_px: 0, target_px_required: 0, computed_color: null, side_effect_px: 0,
      designated_390: false, status_390: null, status: null,
      _wt: c.widget.node.widgetType,
    }));
    const specs = probes.map((p) => ({ eid: p.engine_id, widgetType: p._wt }));

    // -- warm-up render: the duplicate's FIRST frontend render generates its Elementor post CSS
    // mid-load; the AFTER shot sits behind the PUT's explicit regen+flush. Without a warm-up the
    // BEFORE shot can be the half-styled generating load → deterministic FALSE side-effect bands
    // (seen on 3146: code panel 30px off in BEFORE only). One unauthenticated GET = a full PHP render.
    await fetch(dup.url).then((r) => r.text()).catch(() => {});
    await sleep(1500);

    // -- BEFORE pass (1440), TWICE: the A/B pair calibrates the page's intrinsic render noise
    // (regions that change between two NO-EDIT renders cannot be attributed to the edit — proven on
    // 3146: the code-panel band differs ~51k px load-to-load with zero writes). beforeB is the baseline.
    const browser = await chromium.launch();
    const shotBA = `/tmp/roundtrip-${SRC_PAGE}-before1440a.png`;
    const shotB = `/tmp/roundtrip-${SRC_PAGE}-before1440.png`;
    const beforeA = await renderPass(browser, dup.url, { width: 1440, height: 900 }, specs, shotBA);
    const before = await renderPass(browser, dup.url, { width: 1440, height: 900 }, specs, shotB);
    report.run.screenshots.before1440a = shotBA;
    report.run.screenshots.before1440 = shotB;
    const noisy = noiseCells(beforeA.png, before.png);
    report.run.noise_cells = noisy.size;

    // -- sentinel precondition (<5 px of the sentinel already inside its box; rotate to next unused entry) --
    const inUse = new Set(probes.map((p) => p.sentinel));
    let rotCursor = probes.length;                                            // rotation candidates start after the initially-assigned entries
    for (const p of probes) {
      const box = before.info.boxes[p.engine_id];
      if (!box || box.hidden) continue;                                       // ERROR_RENDER decided on AFTER pass
      let guard = 0;
      while (countSentinelPx(before.png, box, hexToRgb(p.sentinel)) >= 5) {
        if (++guard > 64 || rotCursor > 200) { p.status = 'ERROR_SENTINEL'; break; }
        inUse.delete(p.sentinel);
        let next = paletteAt(rotCursor++);
        while (inUse.has(next) && rotCursor <= 200) next = paletteAt(rotCursor++);
        p.sentinel = next; inUse.add(next);
        console.log(`probe "${p.run_text.slice(0, 30)}": sentinel collided, rotated → ${p.sentinel}`);
      }
    }

    // -- THE EDIT: one batched CAS PUT on the duplicate (409-loop per build-absolute.mjs:2632-2633) --
    const freshSettingsR = await jget(`/wp-json/wp/v2/pages/${dup.pageId}?context=edit&_fields=meta`);
    const freshPs = (freshSettingsR.json && freshSettingsR.json.meta && freshSettingsR.json.meta._elementor_page_settings) || {};
    const pagePs = (freshPs && typeof freshPs === 'object' && !Array.isArray(freshPs)) ? freshPs : {};
    const editRead = await jget(`/wp-json/joist/v1/pages/${dup.pageId}?include=elements`);
    let expected = editRead.json && editRead.json.elementor && editRead.json.elementor.hash;
    const editTree = editRead.json.elementor.elements;
    const byId = new Map(); (function walk(ns) { for (const n of ns || []) { if (!n || typeof n !== 'object') continue; if (n.id) byId.set(n.id, n); walk(n.elements); } })(editTree);
    for (const p of probes) {
      if (p.status === 'ERROR_SENTINEL') continue;
      const node = byId.get(p.engine_id);
      if (!node) { p.status = 'ERROR_WRITE'; continue; }
      node.settings = node.settings || {};
      node.settings[p.setting] = p.sentinel;
      if (node.settings.__globals__ && node.settings.__globals__[p.setting] !== undefined) { node.settings.__globals__[p.setting] = ''; p.had_global = true; }  // panel-equivalent unlink (see header)
    }
    assertScratchWritable(dup.pageId, SRC_PAGE);                              // hard guard before the ONE write
    let put = null, putTxt = '';
    for (let a = 0; a < 5; a++) {
      const body = { expected_hash: expected, elements: editTree, page_settings: pagePs, intent: 'control-edit probe sentinel batch (B1)' };
      put = await fetch(`${BASE}/wp-json/joist/v1/pages/${dup.pageId}`, { method: 'PUT', headers: hdr(), body: JSON.stringify(body) });
      putTxt = await put.text();
      if (put.status !== 409) break;
      try { expected = JSON.parse(putTxt).details.current_hash; } catch {}
      await sleep(400);
    }
    if (!put || !put.ok) throw new Error(`ERROR_INFRA: sentinel PUT failed ${put && put.status} ${putTxt.slice(0, 160)}`);
    console.log(`sentinel batch PUT ok (${probes.filter((p) => !p.status).length} edits, 1 write)`);

    // -- data verify (read-back) --
    const verifyRead = await jget(`/wp-json/joist/v1/pages/${dup.pageId}?include=elements`);
    const vById = new Map(); (function walk(ns) { for (const n of ns || []) { if (!n || typeof n !== 'object') continue; if (n.id) vById.set(n.id, n); walk(n.elements); } })(verifyRead.json && verifyRead.json.elementor && verifyRead.json.elementor.elements);
    for (const p of probes) {
      if (p.status) continue;
      const n = vById.get(p.engine_id);
      const got = n && n.settings && n.settings[p.setting];
      if (String(got || '').toLowerCase() === p.sentinel.toLowerCase()) p.data_verified = true;
      else p.status = 'ERROR_WRITE';
    }

    // -- AFTER pass (1440) --
    const shotA = `/tmp/roundtrip-${SRC_PAGE}-after1440.png`;
    const after = await renderPass(browser, dup.url, { width: 1440, height: 900 }, specs, shotA);
    report.run.screenshots.after1440 = shotA;

    // layout stability: a color batch must not reflow (spec §3)
    const dH = Math.abs((after.info.pageH || 0) - (before.info.pageH || 0));
    if (dH > 2) {
      report.errors.push(`ERROR_RENDER: pageH moved ${before.info.pageH}→${after.info.pageH} (|Δ|=${dH}px > 2) — pixel asserts void`);
      for (const p of probes) if (!p.status) p.status = 'ERROR_RENDER';
    } else {
      // target-changed assert per probe
      for (const p of probes) {
        if (p.status) continue;
        const box = after.info.boxes[p.engine_id];
        p.computed_color = box && box.color;
        if (!box || box.hidden) { p.status = 'ERROR_RENDER'; continue; }
        p.target_px_required = Math.max(20, Math.round(0.004 * box.w * box.h));
        p.target_px = countSentinelPx(after.png, box, hexToRgb(p.sentinel));
        p.status = p.target_px >= p.target_px_required ? 'PASS' : 'FAIL_INERT';
      }
      // unrelated-unchanged assert (outside padded union of before+after boxes)
      const maskBoxes = [];
      for (const p of probes) { const b1 = before.info.boxes[p.engine_id], b2 = after.info.boxes[p.engine_id]; if (b1 && !b1.hidden) maskBoxes.push(b1.mask || b1); if (b2 && !b2.hidden) maskBoxes.push(b2.mask || b2); }
      const d = diffOutsideMask(before.png, after.png, maskBoxes, { noisyCells: noisy });
      const frac = d.total ? d.outside / d.total : 0;
      report.run.side_effect_outside_px = d.outside;
      report.run.side_effect_noise_excluded_px = d.noise;
      report.run.side_effect_fraction = Math.round(frac * 1e6) / 1e6;
      if (frac > 0.0005) {
        let best = null, bestD = Infinity;
        for (const p of probes) { const b = after.info.boxes[p.engine_id]; if (!b) continue; const dd = Math.hypot(b.x + b.w / 2 - d.cx, b.y + b.h / 2 - d.cy); if (dd < bestD) { bestD = dd; best = p; } }
        if (best) { best.side_effect_px = d.outside; if (best.status === 'PASS') best.status = 'FAIL_SIDE_EFFECT'; }
        report.errors.push(`side-effect: ${d.outside}px (${(frac * 100).toFixed(3)}%) changed outside probe boxes (centroid ${Math.round(d.cx)},${Math.round(d.cy)})`);
      }

      // -- 390 leg (one designated probe per page: first heading-stratum sampled, else first sampled) --
      const desig = probes.find((p) => p.stratum === 'heading' && !String(p.status || '').startsWith('ERROR')) || probes.find((p) => !String(p.status || '').startsWith('ERROR'));
      if (desig) {
        desig.designated_390 = true;
        const shot390 = `/tmp/roundtrip-${SRC_PAGE}-after390.png`;
        const m = await renderPass(browser, dup.url, { width: 390, height: 844 }, [{ eid: desig.engine_id, widgetType: desig._wt }], shot390);
        report.run.screenshots.after390 = shot390;
        const b390 = m.info.boxes[desig.engine_id];
        if (!b390 || b390.hidden) desig.status_390 = 'SKIP_390_HIDDEN';      // hidden by design (mobileAbsenceHide/mpbHide)
        else {
          const need = Math.max(10, Math.round(0.004 * b390.w * b390.h));
          const got = countSentinelPx(m.png, b390, hexToRgb(desig.sentinel));
          desig.status_390 = got >= need ? 'PASS' : 'FAIL_MOBILE_MASKED';
          if (desig.status_390 === 'FAIL_MOBILE_MASKED' && desig.status === 'PASS') desig.status = 'FAIL_MOBILE_MASKED';
        }
      }
    }
    await browser.close().catch(() => {});

    // -- metrics (spec §5) --
    for (const p of probes) delete p._wt;
    report.probes = probes;
    const rateDenomS = (s) => probes.filter((p) => (!s || p.stratum === s) && ['PASS', 'FAIL_INERT', 'FAIL_MOBILE_MASKED', 'FAIL_SIDE_EFFECT'].includes(p.status));
    const rate = (s) => { const den = rateDenomS(s); if (!den.length) return null; return Math.round((den.filter((p) => p.status === 'PASS').length / den.length) * 1000) / 1000; };
    const mappedPanelRate = runs.length ? Math.round((panel.length / runs.length) * 1000) / 1000 : 0;
    const overall = rate(null);
    const errCount = probes.filter((p) => String(p.status || '').startsWith('ERROR')).length;
    const invalid = probes.length === 0 || errCount / probes.length > 0.2;
    report.metrics = {
      mapped_panel_rate: mappedPanelRate,
      probe_pass_rate: { overall, heading: rate('heading'), text: rate('text'), button: rate('button') },
      control_edit_roundtrip: overall == null ? null : Math.round(mappedPanelRate * overall * 1000) / 1000,
      errors: errCount,
    };
    report.run.status = invalid ? 'INVALID' : 'VALID';
    console.log(`probes: ${probes.map((p) => `${p.stratum}:"${p.run_text.slice(0, 20)}"→${p.status}${p.status_390 ? `(390:${p.status_390})` : ''}`).join(' | ')}`);
    console.log(`metrics: mapped_panel_rate ${mappedPanelRate} | pass overall ${overall} (h ${report.metrics.probe_pass_rate.heading} / t ${report.metrics.probe_pass_rate.text} / b ${report.metrics.probe_pass_rate.button}) | control_edit_roundtrip ${report.metrics.control_edit_roundtrip}`);
  } catch (e) {
    report.errors.push(String(e && e.message || e).slice(0, 300));
    report.run.status = 'INVALID';
  } finally {
    // TEARDOWN — always attempted; failure leaves the active file + tagged title for the next sweep.
    try { const rel = await dup.release({ keep: KEEP }); teardownOk = true; if (!rel.kept) console.log(`scratch ${dup.pageId} deleted (404-verified)`); }
    catch (e) { report.errors.push(`ERROR_INFRA teardown: ${String(e).slice(0, 200)}`); report.run.status = 'INVALID'; }
  }
  finish(report.run.status === 'VALID' && teardownOk ? 0 : 3);
})();
