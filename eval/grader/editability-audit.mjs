#!/usr/bin/env node
/**
 * @purpose editability-audit.mjs — the EDITABILITY GATE (fusion-CONVERGENT option C, 2026-06-20). Round-trip
 * editability is HALF Joist's hard requirement and had never been validated by LOOK — only by a node-count proxy.
 * This makes it a REAL test in three tiers and emits a hard PASS/FAIL + a ranked editability-defect-class list.
 * Reusable: its verdict is the acceptance gate the generalization test (A) and self-heal (B) both need.
 *
 *   TIER 1 — STRUCTURAL (cheap, deterministic, no WP): census the tree; FAIL if real text/layout content is trapped in
 *            opaque `html` blobs (vs legit SVG icons), or if native widgets carry no editable content. Anti-raster veto.
 *   TIER 2 — ROUND-TRIP PROPAGATION (needs WP): render the clone, read its STORED _elementor_data back out, mutate a
 *            heading's text + a button's color (sentinels), write it back to the SAME page + flush, re-capture, and
 *            confirm the sentinels appear on the FRONTEND. Proves the tree is the LIVE source of truth — catches the
 *            two known proxy-green-but-broken gotchas (_elementor_edit_mode=builder frontend-fallback; stale
 *            _elementor_element_cache). This is what the node-count proxy cannot see.
 *
 * Usage:
 *   node editability-audit.mjs --tree /tmp/clone/tree.json            # tier 1 only (no WP)
 *   node editability-audit.mjs --tree /tmp/clone/tree.json --live     # tier 1 + 2 (renders to a fresh slug)
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? (process.argv[i + 1] || true) : d; };
const has = (k) => process.argv.includes('--' + k);

const walk = (tree, fn) => { (function rec(n) { if (!n) return; fn(n); (n.elements || []).forEach(rec); })(Array.isArray(tree) ? { elements: tree } : tree); };

// ── TIER 1 — structural editability (deterministic) ──────────────────────────────────────────────────────────
export function tier1(tree) {
  const census = {}; let blobRisk = 0; const blobs = []; let populated = 0, empty = 0; let svgHtml = 0;
  walk(tree, (n) => {
    const wt = n.widgetType; if (!wt) return; census[wt] = (census[wt] || 0) + 1; const s = n.settings || {};
    if (wt === 'html') {
      const h = (s.html || '').trim(); const isSvg = /^<svg[\s>]/i.test(h);
      const words = (h.replace(/<[^>]+>/g, ' ').match(/\b[a-zA-Z]{2,}\b/g) || []).length;
      if (isSvg) svgHtml++;
      else if (words > 3) { blobRisk++; blobs.push(h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)); }
    }
    if (['text-editor', 'heading', 'button'].includes(wt)) {
      const c = (s.title || s.editor || s.text || '').replace(/<[^>]+>/g, '').trim();
      if (c) populated++; else empty++;
    }
  });
  const nativeEditable = (census['text-editor'] || 0) + (census.heading || 0) + (census.button || 0) + (census.image || 0) + (census.container || 0);
  const htmlTotal = census.html || 0;
  const widgetTotal = nativeEditable + htmlTotal;
  const blobPct = widgetTotal ? +(blobRisk / widgetTotal * 100).toFixed(2) : 0;
  // PASS: no real content trapped in html blobs (anti-raster), and the bulk of text-ish widgets carry editable content.
  const pass = blobRisk === 0 && populated > 0 && (empty / Math.max(1, populated + empty)) < 0.4;
  return { tier: 1, pass, census, nativeEditable, htmlTotal, svgHtml, blobRisk, blobs, populated, empty, blobPct,
    defects: [
      ...(blobRisk > 0 ? [{ cls: 'content-in-html-blob', n: blobRisk, severity: 'fatal', note: 'real text/layout trapped in non-editable html widgets (anti-raster veto)', samples: blobs.slice(0, 4) }] : []),
      ...((empty / Math.max(1, populated + empty)) >= 0.4 ? [{ cls: 'empty-editable-widgets', n: empty, severity: 'high', note: 'many text/heading/button widgets carry no editable content' }] : []),
    ] };
}

// ── TIER 2 — round-trip propagation (live WP) ────────────────────────────────────────────────────────────────
const SENT_TEXT = 'JOIST-RT-PROOF-7Q';        // sentinel injected into a heading
const SENT_COLOR = '#ff00ff';                  // sentinel button color (magenta — unmistakable)

async function tier2(tree) {
  const { render, injectTree } = await import(path.join(ROOT, 'sandbox', 'render.mjs'));
  const slug = 'edit-audit-rt';
  // 1) render the clone fresh (slug → fresh id, avoids the media-attachment post-id collision).
  const r0 = await render(tree, { slug, noShot: true });
  const pageId = r0.pageId;
  // 2) read the STORED _elementor_data back out of WP (what actually persisted).
  const stored = readStored(pageId);
  // 3) mutate: first heading's title → sentinel text; first button's color → sentinel color.
  let editedHeading = false, editedButton = false; let origHeading = null;
  walk(stored, (n) => {
    if (n.widgetType === 'heading' && !editedHeading) { origHeading = n.settings.title; n.settings.title = SENT_TEXT; editedHeading = true; }
    if (n.widgetType === 'button' && !editedButton) { n.settings.button_text_color = SENT_COLOR; editedButton = true; }
  });
  // 4) write the mutated tree back to the SAME page + flush (the read-modify-write-render round trip).
  injectTree(stored, { page: pageId });
  // 5) re-capture the FRONTEND and confirm the sentinels propagated.
  const dom = captureFrontend(pageId);
  const textProp = dom.text.includes(SENT_TEXT);
  const colorProp = dom.colors.some((c) => normColor(c) === 'ff00ff');
  const pass = editedHeading && editedButton && textProp && colorProp;
  return { tier: 2, pass, pageId, url: r0.url, editedHeading, editedButton, textPropagated: textProp, colorPropagated: colorProp, origHeading,
    defects: [
      ...(editedHeading && !textProp ? [{ cls: 'heading-edit-not-propagated', severity: 'fatal', note: 'edited heading text did not reach the frontend (fallback/cache gotcha — proxy-green-but-broken)' }] : []),
      ...(editedButton && !colorProp ? [{ cls: 'button-color-edit-not-propagated', severity: 'fatal', note: 'edited button color did not reach the frontend' }] : []),
    ] };
}

function readStored(pageId) {
  const script = `wp post meta get ${pageId} _elementor_data 2>/dev/null`;
  const out = execFileSync('docker', ['compose', 'run', '--rm', '-T', 'wpcli-1', '-c', script], { cwd: path.join(ROOT, 'sandbox'), encoding: 'utf8', timeout: 60000 });
  const m = out.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('could not read _elementor_data back');
  return JSON.parse(m[0]);
}

function captureFrontend(pageId) {
  const base = process.env.JOIST_LOCAL_BASE || 'http://localhost:8001';
  const js = `
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('${base}/?page_id=${pageId}', { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
await p.waitForTimeout(1500);
const r = await p.evaluate(() => ({ text: document.body.innerText || '', colors: [...document.querySelectorAll('.elementor-button, .elementor-widget-button a, .elementor-widget-button button')].map(e=>getComputedStyle(e).color) }));
console.log(JSON.stringify(r));
await b.close();
`;
  const tmp = path.join(HERE, `_edit-audit-cap-${pageId}.mjs`); fs.writeFileSync(tmp, js); // in HERE so `playwright` resolves
  const out = execFileSync('node', [tmp], { cwd: HERE, encoding: 'utf8', timeout: 90000 });
  fs.rmSync(tmp, { force: true });
  return JSON.parse(out.trim().split('\n').pop());
}
const normColor = (c) => { const m = String(c).match(/(\d+),\s*(\d+),\s*(\d+)/); return m ? [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('') : String(c).replace('#', '').toLowerCase(); };

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────
const IS_MAIN = process.argv[1] && process.argv[1].endsWith('editability-audit.mjs');
if (IS_MAIN) (async () => {
  const treePath = arg('tree'); if (!treePath) { console.error('usage: --tree <tree.json> [--live]'); process.exit(2); }
  const tree = JSON.parse(fs.readFileSync(treePath, 'utf8'));
  const t1 = tier1(tree);
  console.log('\n=== TIER 1 — structural editability ===');
  console.log(`census: ${JSON.stringify(t1.census)}`);
  console.log(`native editable: ${t1.nativeEditable} | html: ${t1.htmlTotal} (svg-icons: ${t1.svgHtml}, content-blobs: ${t1.blobRisk}) | blob%: ${t1.blobPct}`);
  console.log(`editable fields populated: ${t1.populated} | empty: ${t1.empty}`);
  if (t1.blobs.length) console.log(`  BLOB SAMPLES: ${JSON.stringify(t1.blobs)}`);
  console.log(`TIER 1: ${t1.pass ? 'PASS' : 'FAIL'}${t1.defects.length ? '  defects: ' + t1.defects.map((d) => d.cls).join(', ') : ''}`);

  let t2 = null;
  if (has('live')) {
    console.log('\n=== TIER 2 — round-trip propagation (live) ===');
    t2 = await tier2(tree);
    console.log(`page ${t2.pageId} (${t2.url})`);
    console.log(`edited heading: ${t2.editedHeading} → propagated: ${t2.textPropagated} | edited button color: ${t2.editedButton} → propagated: ${t2.colorPropagated}`);
    console.log(`TIER 2: ${t2.pass ? 'PASS' : 'FAIL'}${t2.defects.length ? '  defects: ' + t2.defects.map((d) => d.cls).join(', ') : ''}`);
  }

  const allDefects = [...t1.defects, ...(t2 ? t2.defects : [])];
  const verdict = t1.pass && (!t2 || t2.pass) ? 'PASS' : 'FAIL';
  console.log(`\n=== EDITABILITY VERDICT: ${verdict} ===`);
  if (allDefects.length) { console.log('ranked editability-defect classes:'); allDefects.sort((a, b) => (a.severity === 'fatal' ? -1 : 1)).forEach((d) => console.log(`  [${d.severity}] ${d.cls}${d.n ? ' ×' + d.n : ''} — ${d.note}`)); }
  else console.log('no editability defects — native, editable, round-trip-propagating.');
  process.exit(verdict === 'PASS' ? 0 : 1);
})().catch((e) => { console.error('FAILED:', e && e.stack || e); process.exit(1); });
