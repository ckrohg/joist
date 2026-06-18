#!/usr/bin/env node
/**
 * @purpose (1c) ROUND-TRIP SURVIVAL cert. The editability hard-requirement is "reopen + save losslessly in the
 * Elementor editor." No Playwright editor-UI harness exists yet, so this certifies the TRACTABLE, DOCUMENTED-
 * failure-mode slice of that lifecycle:
 *   (a) editorReadable — joist_get_page_tree returns a COMPLETE, non-empty Elementor tree (the postmeta-bypass
 *       write didn't produce something the editor can't load), and
 *   (b) regenStable — the page SURVIVES a CSS regen (`flush_css`, which the editor runs on save) with a STABLE
 *       render AND stable page height. This is the EXACT empty-element-id-collapse failure (commit 2d6041f):
 *       ephemeral ids get wiped by regen → 2000+ dead .elementor-element-<id> selectors → layout collapses to a
 *       ~150px sliver. renderSSIM(before,after) + heightStable are the signals; the durable-id stamp should hold.
 * HONEST SCOPE: a flush_css + tree-load cert, NOT a full editor-UI open/save (that needs an editor driver — a
 * future lever). Host-guarded (LOCAL only). Reusable: certifyRoundtrip(pageId). CLI: node roundtrip-cert.mjs --page <id>
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { ssim } from './grade-sections.mjs';                       // (1c) reuse the grader's SSIM
import { resolveBase } from '../../sandbox/host-guard.mjs';        // §0 SAFETY GUARD: LOCAL render/regen only

const BASE = resolveBase(process.env.JOIST_BASE || 'http://localhost:8001');
const AUTH = process.env.JOIST_AUTH_B64;
const H = AUTH ? { Authorization: 'Basic ' + AUTH } : {};

const countNodes = (els) => { let n = 0; (function walk(a) { for (const e of (a || [])) { n++; walk(e.elements); } })(els); return n; };

async function shot(url, width) {
  const b = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  try {
    const p = await (await b.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 })).newPage();
    await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await p.evaluate(async () => { window.scrollTo(0, document.body.scrollHeight); await new Promise((r) => setTimeout(r, 500)); window.scrollTo(0, 0); if (document.fonts?.ready) { try { await document.fonts.ready; } catch {} } await new Promise((r) => setTimeout(r, 250)); });
    return PNG.sync.read(await p.screenshot({ fullPage: true }));
  } finally { await b.close(); }
}

/**
 * Certify the round-trip survival of one ALREADY-WRITTEN clone page.
 * @returns {{survived,editorReadable,nodeCount,nodeCount1,regenOk,renderSSIM,heightStable,hashStable,note}}
 */
export async function certifyRoundtrip(pageId, { width = 1440 } = {}) {
  const readTree = async () => { try { return await (await fetch(`${BASE}/wp-json/joist/v1/pages/${pageId}?include=elements`, { headers: H })).json(); } catch { return null; } };
  const elemsOf = (t) => (Array.isArray(t?.elements) && t.elements) || (Array.isArray(t?.elementor?.elements) && t.elementor.elements) || null;
  const url = `${BASE}/?page_id=${pageId}`;

  const t0 = await readTree();
  const els0 = elemsOf(t0);
  const editorReadable = Array.isArray(els0) && countNodes(els0) > 0;
  const nodeCount = els0 ? countNodes(els0) : 0;

  const shotA = await shot(url, width);                       // render BEFORE the regen
  // flush_css regen = the editor-save lifecycle. The joist write/regen routes REQUIRE an X-Joist-Session-Id
  // header (same as build-absolute's write path) — without it the route 400s with auth.session_required.
  let regenOk = false, regenMsg = '';
  try {
    const r = await fetch(`${BASE}/wp-json/joist/v1/site/regenerate-css`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'roundtrip-cert-' + Date.now() }, body: JSON.stringify({ post_id: Number(pageId) }) });
    regenOk = r.ok; if (!r.ok) regenMsg = `http ${r.status}: ${(await r.text()).slice(0, 140)}`;
  } catch (e) { regenMsg = e.message; }
  const shotB = await shot(url, width);                       // render AFTER the flush_css regen
  const t1 = await readTree();
  const nodeCount1 = elemsOf(t1) ? countNodes(elemsOf(t1)) : 0;

  const minH = Math.min(shotA.height, shotB.height), maxH = Math.max(shotA.height, shotB.height) || 1;
  const renderSSIM = minH >= 16 ? +ssim(shotA, shotB, 0, minH).toFixed(4) : null;
  const heightStable = +(minH / maxH).toFixed(4);             // collapse → shotB much shorter → << 1
  const regenStable = renderSSIM != null && renderSSIM >= 0.95 && heightStable >= 0.95;
  // CONCLUSIVE only if the regen ACTUALLY fired — otherwise flush_css survival was never exercised (no false pass).
  const survived = editorReadable && regenOk && regenStable;
  return { survived, conclusive: regenOk, editorReadable, nodeCount, nodeCount1, regenOk, regenMsg, renderSSIM, heightStable, hashStable: !!(t0?.elementor?.hash && t0.elementor.hash === t1?.elementor?.hash), shotH: { before: shotA.height, after: shotB.height }, note: 'flush_css + tree-load cert (not full editor-UI open/save)' };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
  const pageId = arg('page');
  if (!pageId) { console.error('usage: node roundtrip-cert.mjs --page <id> [--width 1440]'); process.exit(2); }
  if (!AUTH) { console.error('JOIST_AUTH_B64 unset — `source /tmp/joist-auth-1.env` first.'); process.exit(2); }
  const res = await certifyRoundtrip(pageId, { width: +arg('width', 1440) });
  console.log(JSON.stringify(res, null, 2));
  const status = res.survived ? 'SURVIVED ✓' : (res.conclusive ? 'FAILED ✗' : 'INCONCLUSIVE (regen did not fire) ⚠');
  console.log(`\nROUND-TRIP page ${pageId}: ${status} | editorReadable=${res.editorReadable} (${res.nodeCount} nodes) | regenOk=${res.regenOk}${res.regenMsg ? ` (${res.regenMsg})` : ''} | renderSSIM=${res.renderSSIM} heightStable=${res.heightStable} (${res.shotH.before}→${res.shotH.after}px)`);
  process.exit(res.survived ? 0 : 1);
}
