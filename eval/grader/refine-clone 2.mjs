#!/usr/bin/env node
/**
 * @purpose Per-clone PROPERTY-LEVEL refine loop. Unlike refine-loop.mjs (which swaps whole SECTIONS to raster),
 * this patches INDIVIDUAL widget settings on the LIVE Elementor page tree (via the joist/v1 PUT) toward the
 * SOURCE values for the worst-matched element pairs — color, font-size, font-weight (and, low-risk, position).
 *
 * It is SAFE by construction:
 *   • only ever touches MATCHED pairs (perelement-score's Hungarian assignment) — never invents content;
 *   • only SAFE, known control-keys (heading title_color / text-editor text_color / typography_font_size /
 *     typography_font_weight / optional small _offset nudges) — never structure, never text bodies;
 *   • KEEP-IF-BETTER per iteration: re-grades after each patch-set, KEEPS it iff the authoritative
 *     grade-sections composite rose beyond noise, else REVERTS (re-PUTs the pre-patch tree). Cannot regress.
 *
 * Pipeline per iteration:
 *   1. grade-sections → composite (authoritative objective)            [median-of-2 for the baseline]
 *   2. perelement-score --emit-pairs → /tmp/pe-pairs-<tag>.json        [the repair map]
 *   3. pick top-K worst-residual matched pairs w/ a SAFE control key
 *   4. GET live tree → map clone node → live widget (text + nearest center) → set safe setting to SOURCE value
 *   5. PUT back (expected_hash / 409-retry, like build-absolute)
 *   6. re-grade → keep iff composite ↑ else revert (PUT saved tree)
 *
 * Usage: node refine-clone.mjs --source <url> --page <id> [--max 6] [--topk 5] [--no-position]
 * Env: JOIST_BASE (must be the expected host), JOIST_AUTH_B64.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);

const base = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
const b64 = process.env.JOIST_AUTH_B64;
const source = arg('source'), pageId = arg('page');
const MAX = parseInt(arg('max', '6'), 10);
const TOPK = parseInt(arg('topk', '5'), 10);
const USE_POSITION = !has('no-position');         // position is the lowest-confidence channel → opt-out flag
const KEEP_EPS = 0.0015;                           // keep a patch-set only if composite rises beyond noise
if (!b64) { console.error('missing JOIST_AUTH_B64'); process.exit(2); }
if (!source || !pageId) { console.error('need --source --page + JOIST_AUTH_B64'); process.exit(2); }

const slug = source.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 16).toLowerCase();
const cloneUrl = `${base}/?page_id=${pageId}`;
// X-Joist-Session-Id is REQUIRED for writes (PUT) — mirror build-absolute. GET tolerates it too.
const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'refine-' + Date.now() };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const r3 = (x) => Math.round(x * 1000) / 1000;

// ---------- GRADE (authoritative composite) ----------
function grade(tag) {
  const outDir = `/tmp/refc-grade-${slug}-${tag}`;
  const r = spawnSync(process.execPath, [path.join(__dirname, 'grade-sections.mjs'), '--source', source, '--clone', cloneUrl, '--out', outDir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, env: process.env });
  try { return JSON.parse(fs.readFileSync(`${outDir}/sections.json`, 'utf8')); }
  catch { console.error('[refine-clone] grade failed:', (r.stderr || r.stdout || '').slice(-400)); return null; }
}

// ---------- REPAIR MAP (perelement-score --emit-pairs, direct so the tag is deterministic) ----------
function emitPairs(tag) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'perelement-score.mjs'), '--source', source, '--clone', cloneUrl, '--name', tag, '--width', '1440', '--emit-pairs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, env: process.env });
  const f = `/tmp/pe-pairs-${tag}.json`;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch { console.error('[refine-clone] emit-pairs failed:', (r.stderr || r.stdout || '').slice(-400)); return null; }
}

// ---------- LIVE TREE I/O (network-resilient: the SG host occasionally closes the socket mid-write) ----------
async function fetchRetry(url, opts, tries = 4) {
  let lastErr;
  for (let a = 0; a < tries; a++) {
    try { return await fetch(url, opts); }
    catch (e) { lastErr = e; await sleep(600 * (a + 1)); }
  }
  throw lastErr;
}
async function getTree() {
  const r = await fetchRetry(`${base}/wp-json/joist/v1/pages/${pageId}?include=elements`, { headers });
  const j = await r.json();
  return { hash: j.elementor?.hash, elements: j.elementor?.elements || [] };
}
async function putTree(elements, expected) {
  let r, txt, exp = expected;
  for (let a = 0; a < 6; a++) {
    const body = { expected_hash: exp, elements, title: 'Absolute 1:1 clone', intent: 'refine-clone property patch' };
    try { r = await fetchRetry(`${base}/wp-json/joist/v1/pages/${pageId}`, { method: 'PUT', headers, body: JSON.stringify(body) }, 1); }
    catch (e) { await sleep(700); continue; }    // socket closed → retry the whole PUT
    txt = await r.text();
    if (r.status !== 409) break;
    try { exp = JSON.parse(txt).details.current_hash; } catch {}
    await sleep(400);
  }
  if (!r) return { ok: false, status: 0, body: 'network: no response after retries' };
  // 422 = silent-save with tree persisted (per task note) → treat as OK.
  const ok = r.ok || r.status === 422;
  return { ok, status: r.status, body: (txt || '').slice(0, 120) };
}

// ---------- WIDGET INDEX (text + center, from the live tree) ----------
// center x = _offset_x + _element_custom_width/2 ; center y top = _offset_y (build-absolute pins the band top).
function sizeOf(v) { return v && typeof v === 'object' && typeof v.size === 'number' ? v.size : (typeof v === 'number' ? v : null); }
function widgetText(w) {
  const s = w.settings || {};
  if (w.widgetType === 'heading') return norm(s.title);
  if (w.widgetType === 'text-editor') return norm(s.editor);
  if (s.title) return norm(s.title);
  if (s.editor) return norm(s.editor);
  if (s.text) return norm(s.text);
  return '';
}
function widgetCenter(w) {
  const s = w.settings || {};
  const ox = sizeOf(s._offset_x), oy = sizeOf(s._offset_y), cw = sizeOf(s._element_custom_width);
  const cx = ox != null ? ox + (cw != null ? cw / 2 : 0) : null;
  const cy = oy != null ? oy : null;
  return { cx, cy };
}
function indexWidgets(elements) {
  const out = [];
  const walk = (n) => { if (!n || typeof n !== 'object') return; if (n.elType === 'widget') out.push(n); (n.elements || []).forEach(walk); };
  elements.forEach(walk);
  return out;
}
// map a repair pair (clone node) → a live widget. PRIMARY key: normalized-text equality; tiebreak by center
// proximity. Geometry-only fallback (textless) is intentionally NOT patched (color/typo channels need a text leaf).
function findWidget(pair, widgets, used) {
  const txt = norm(pair.cloneText) || norm(pair.srcText);
  if (!txt) return null;
  const cands = widgets.filter((w) => !used.has(w.id) && widgetText(w) === txt);
  let pool = cands;
  if (!pool.length) {
    // relaxed: widget text contains the pair text (text-editor may wrap extra markup) — still exact-content-anchored
    pool = widgets.filter((w) => !used.has(w.id) && txt.length >= 4 && widgetText(w).includes(txt));
  }
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0];
  // multiple same-text widgets → pick the one whose center is nearest the pair's clone center
  let best = null, bestD = Infinity;
  for (const w of pool) {
    const { cx, cy } = widgetCenter(w);
    if (cx == null || cy == null) continue;
    const d = Math.hypot(cx - pair.cloneCx, cy - pair.cloneCy);
    if (d < bestD) { bestD = d; best = w; }
  }
  return best || pool[0];
}

// ---------- SAFE CHANNEL → ELEMENTOR SETTING PATCH ----------
// CRITICAL render truth (diagnosed on supabase): build-absolute bakes color/font-size/font-weight as an INLINE
// `style="…"` on the inner <div>/<a> of a TEXT-EDITOR widget's `editor` HTML. That inline style WINS over the
// widget-level typography_* / text_color settings, so patching the widget setting is INERT for text-editors.
// → For text-editor (& button-as-text-editor) widgets we rewrite the INLINE STYLE inside `editor`. Headings have
//   no inline style (title is plain) so title_color / typography_* on the setting DO take effect → patch those.
function colorKeyFor(w) { return w.widgetType === 'heading' ? 'title_color' : 'text_color'; }
// rewrite (or add) a single CSS prop inside the FIRST element's style="" in an editor HTML string. Returns the
// new HTML, or null if the prop is already that value / no element to stamp.
function setInlineStyleProp(html, prop, value) {
  if (typeof html !== 'string') return null;
  const tagMatch = html.match(/<([a-z0-9]+)([^>]*)>/i);
  if (!tagMatch) return null;
  const [full, tag, attrs] = tagMatch;
  const styleMatch = attrs.match(/style\s*=\s*"([^"]*)"/i);
  const propRe = new RegExp(`(^|;)\\s*${prop}\\s*:\\s*[^;]*`, 'i');
  let style = styleMatch ? styleMatch[1] : '';
  if (propRe.test(style)) {
    const cur = (style.match(new RegExp(`${prop}\\s*:\\s*([^;]*)`, 'i')) || [])[1] || '';
    if (norm(cur) === norm(value)) return null;                 // already correct
    style = style.replace(propRe, (m, p1) => `${p1}${prop}:${value}`);
  } else {
    style = style ? `${style};${prop}:${value}` : `${prop}:${value}`;
  }
  const newAttrs = styleMatch ? attrs.replace(/style\s*=\s*"[^"]*"/i, `style="${style}"`) : `${attrs} style="${style}"`;
  return html.replace(full, `<${tag}${newAttrs}>`);
}
function buildPatch(pair, channel, w) {
  const s = w.settings || {};
  const isEditor = w.widgetType === 'text-editor';
  if (channel === 'color') {
    if (!pair.srcColor || !pair.isText) return null;
    if (isEditor) {
      const html = setInlineStyleProp(s.editor, 'color', pair.srcColor);
      if (!html) return null;
      return { sets: { editor: html, text_color: pair.srcColor }, desc: `inline color←${pair.srcColor}` };
    }
    const key = colorKeyFor(w);
    if (norm(String(s[key])) === norm(String(pair.srcColor))) return null; // already correct
    return { sets: { [key]: pair.srcColor }, desc: `${key}←${pair.srcColor}` };
  }
  if (channel === 'font-size') {
    if (!pair.srcFontSize) return null;
    const tgt = `${Math.round(pair.srcFontSize)}px`;
    if (isEditor) {
      const html = setInlineStyleProp(s.editor, 'font-size', tgt);
      if (!html) return null;
      return { sets: { editor: html, typography_typography: 'custom', typography_font_size: { unit: 'px', size: Math.round(pair.srcFontSize) } }, desc: `inline font-size←${tgt}` };
    }
    const cur = sizeOf(s.typography_font_size);
    if (cur != null && Math.abs(cur - pair.srcFontSize) < 0.5) return null;
    return { sets: { typography_typography: 'custom', typography_font_size: { unit: 'px', size: Math.round(pair.srcFontSize) } }, desc: `font-size←${tgt}` };
  }
  if (channel === 'font-weight') {
    if (!pair.srcFontWeight || !/^\d+$/.test(String(pair.srcFontWeight))) return null;
    if (isEditor) {
      const html = setInlineStyleProp(s.editor, 'font-weight', String(pair.srcFontWeight));
      if (!html) return null;
      return { sets: { editor: html, typography_typography: 'custom', typography_font_weight: String(pair.srcFontWeight) }, desc: `inline font-weight←${pair.srcFontWeight}` };
    }
    if (String(s.typography_font_weight) === String(pair.srcFontWeight)) return null;
    return { sets: { typography_typography: 'custom', typography_font_weight: String(pair.srcFontWeight) }, desc: `font-weight←${pair.srcFontWeight}` };
  }
  if (channel === 'position') {
    // LOW-RISK ONLY: nudge _offset_x/_offset_y toward the SOURCE center, and ONLY when the drift is MODERATE
    // (a large drift usually means a mis-match, not a fixable offset — skip those). Keep the same band top
    // semantics build-absolute used: cy is the widget's top offset; src center cy → top = srcCy - srcH/2-ish is
    // not recoverable from the pair, so we correct the TOP (oy) by the measured top drift, and cx by center drift.
    const ox = sizeOf(s._offset_x), oy = sizeOf(s._offset_y), cw = sizeOf(s._element_custom_width);
    if (ox == null || oy == null) return null;
    const curCx = ox + (cw != null ? cw / 2 : 0);
    const dx = pair.srcCx - curCx;            // desired center-x shift
    const dyTop = pair.srcCy - pair.cloneCy;  // top drift (cloneCy/srcCy are tops-ish from capture center; use as delta)
    const MAXNUDGE = 120, MINNUDGE = 3;       // px — moderate band only
    const sets = {};
    if (Math.abs(dx) >= MINNUDGE && Math.abs(dx) <= MAXNUDGE) sets._offset_x = { unit: 'px', size: Math.round(ox + dx) };
    if (Math.abs(dyTop) >= MINNUDGE && Math.abs(dyTop) <= MAXNUDGE) sets._offset_y = { unit: 'px', size: Math.round(oy + dyTop) };
    if (!Object.keys(sets).length) return null;
    return { sets, desc: `offset${sets._offset_x ? ` x←${sets._offset_x.size}` : ''}${sets._offset_y ? ` y←${sets._offset_y.size}` : ''}` };
  }
  return null;
}

// expand a residual entry into candidate (channel, residual) rows, only SAFE channels.
function candidatesFromPair(pair) {
  const rows = [];
  const R = pair.residuals || {};
  if (pair.isText && pair.srcColor && R.color != null) rows.push({ pair, channel: 'color', resid: R.color });
  if (pair.srcFontSize && R.typography != null) rows.push({ pair, channel: 'font-size', resid: R.typography });
  if (pair.srcFontWeight && /^\d+$/.test(String(pair.srcFontWeight)) && R.typography != null) rows.push({ pair, channel: 'font-weight', resid: R.typography });
  if (USE_POSITION && R.position != null) rows.push({ pair, channel: 'position', resid: R.position });
  return rows;
}

(async () => {
  console.log(`\n=== REFINE-CLONE ${source} → page ${pageId} (max ${MAX} iters, topK ${TOPK}${USE_POSITION ? ', +position' : ', no-position'}) ===`);

  // ---- BASELINE: median-of-2 composite (consistent state — we just rebuilt clean before calling) ----
  const g1 = grade('base1'); if (!g1) { console.log('FAILED: baseline grade-1 failed'); process.exit(1); }
  const g2 = grade('base2'); if (!g2) { console.log('FAILED: baseline grade-2 failed'); process.exit(1); }
  const med = (a, b) => (a + b) / 2;
  let bestComposite = med(g1.composite, g2.composite);
  const traj = [{ iter: 0, composite: r3(bestComposite), note: `baseline median-of-2 (${g1.composite}, ${g2.composite})` }];
  console.log(`baseline composite ${r3(bestComposite)} (median of ${g1.composite}, ${g2.composite}) | per-element ${g1.perElement ? `color ${g1.perElement.color} typo ${g1.perElement.typography} pos ${g1.perElement.position}` : 'n/a'}`);

  const triedKeys = new Set();   // (widgetId|channel) already attempted-and-rejected → don't retry same patch
  let keptPatches = 0;
  const channelKept = {};        // channel → count of kept patches

  for (let iter = 1; iter <= MAX; iter++) {
    // 1) fresh repair map against the CURRENT live clone
    const pairsDoc = emitPairs(`refine-${slug}-${iter}`);
    if (!pairsDoc) { console.log(`iter ${iter}: no repair map → stop`); break; }

    // 2) rank candidate (pair,channel) rows by residual desc, only those with a SAFE patch available
    const { hash, elements } = await getTree();
    const widgets = indexWidgets(elements);
    const used = new Set();
    let rows = [];
    for (const pair of pairsDoc.pairs) for (const c of candidatesFromPair(pair)) rows.push(c);
    rows.sort((a, b) => b.resid - a.resid);

    const patchPlan = [];   // {w, sets, desc, channel, resid}
    for (const row of rows) {
      if (patchPlan.length >= TOPK) break;
      if (row.resid < 0.04) continue;                       // residual too small to bother (noise)
      const w = findWidget(row.pair, widgets, used);
      if (!w) continue;
      const key = `${w.id}|${row.channel}`;
      if (triedKeys.has(key)) continue;
      const patch = buildPatch(row.pair, row.channel, w);
      if (!patch) continue;
      patchPlan.push({ w, ...patch, channel: row.channel, resid: row.resid, key, text: (row.pair.srcText || '').slice(0, 28) });
      used.add(w.id);
    }

    if (!patchPlan.length) { console.log(`iter ${iter}: no improvable top-residual with a safe control-key → plateau, stop`); break; }
    console.log(`iter ${iter}: applying ${patchPlan.length} patch(es): ${patchPlan.map((p) => `${p.channel}(r${r3(p.resid)} ${p.desc} @"${p.text}")`).join('; ')}`);

    // 3) apply patches to a COPY of the live tree (we keep the pre-patch elements to revert)
    const before = JSON.parse(JSON.stringify(elements));
    const idToWidget = new Map(); indexWidgets(elements).forEach((w) => idToWidget.set(w.id, w));
    for (const p of patchPlan) { const w = idToWidget.get(p.w.id); if (!w) continue; w.settings = w.settings || {}; Object.assign(w.settings, p.sets); }

    // 4) PUT
    const put = await putTree(elements, hash);
    if (!put.ok) { console.log(`iter ${iter}: PUT failed (${put.status} ${put.body}) → revert + stop`); const { hash: h2 } = await getTree(); await putTree(before, h2); break; }

    // 5) re-grade + keep-if-better
    const cand = grade(`iter${iter}`);
    if (!cand) { console.log(`iter ${iter}: re-grade failed → revert + stop`); const { hash: h2 } = await getTree(); await putTree(before, h2); break; }
    if (cand.composite > bestComposite + KEEP_EPS) {
      const prev = bestComposite;
      bestComposite = cand.composite; keptPatches += patchPlan.length;
      for (const p of patchPlan) channelKept[p.channel] = (channelKept[p.channel] || 0) + 1;
      traj.push({ iter, composite: r3(cand.composite), note: `KEPT ${patchPlan.length} (${[...new Set(patchPlan.map((p) => p.channel))].join('+')})` });
      console.log(`  KEPT: composite ${cand.composite} > ${r3(prev)} (Δ +${r3(cand.composite - prev)}) | per-element color ${cand.perElement?.color} typo ${cand.perElement?.typography} pos ${cand.perElement?.position}`);
    } else {
      // REVERT: re-PUT the pre-patch tree (fetch fresh hash first).
      const { hash: h2 } = await getTree();
      const rev = await putTree(before, h2);
      for (const p of patchPlan) triedKeys.add(p.key);    // don't retry the same rejected patches
      traj.push({ iter, composite: r3(cand.composite), note: `REVERTED (≤ ${r3(bestComposite)}+eps; revert ${rev.ok ? 'ok' : rev.status})` });
      console.log(`  REVERTED: composite ${cand.composite} ≤ ${r3(bestComposite)}+${KEEP_EPS} (no gain) → restored pre-patch tree (${rev.ok ? 'ok' : rev.status})`);
    }
  }

  const helped = Object.entries(channelKept).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`);
  console.log(`\n=== REFINE-CLONE RESULT ===`);
  console.log(`trajectory: ${traj.map((t) => `${t.iter}:${t.composite}`).join(' → ')}`);
  console.log(`final composite ${r3(bestComposite)} | ${keptPatches} patch(es) kept | channels that helped: ${helped.length ? helped.join(', ') : 'none'}`);
  console.log(`PAGE: ${cloneUrl}`);
  fs.writeFileSync(`/tmp/refine-clone-result-${slug}.json`, JSON.stringify({ source, page: pageId, baseline: traj[0].composite, final: r3(bestComposite), keptPatches, channelsHelped: channelKept, trajectory: traj }, null, 2));

  const trajStr = traj.map((t) => `${t.iter === 0 ? 'baseline' : 'iter' + t.iter}=${t.composite}`).join(' -> ');
  console.log(`\nOK: ${trajStr} | final ${r3(bestComposite)} | ${keptPatches} patches kept | helped: ${helped.length ? helped.join(', ') : 'none'}`);
})();
