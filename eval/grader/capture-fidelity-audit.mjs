#!/usr/bin/env node
/**
 * @purpose capture-fidelity-audit.mjs — independent TEXT-FIDELITY ORACLE for the grader's eyes. capture-layout
 * (the box-tree the grader scores) was found to UNDER-READ rendered Elementor clones — it dropped widget-wrapped prose
 * and over-segmented syntax-highlighted code — producing a falsely-low grade even though the projection rendered the
 * text 99.4% faithfully. This tool measures that gap directly: it compares capture-layout's captured text against the
 * GROUND-TRUTH rendered-DOM innerText for the SAME page, reports recall, and lists the exact text blocks capture-layout
 * dropped. Read-only (never modifies capture-layout) — it's the oracle + regression guard for the capture-layout fix.
 *
 * Usage (sandbox up, auth sourced):
 *   node capture-fidelity-audit.mjs --page 813              # audit a rendered sandbox page
 *   node capture-fidelity-audit.mjs --url http://localhost:8001/?page_id=813
 *   node capture-fidelity-audit.mjs --page 813 --capture /tmp/clone813.json   # reuse an existing capture json
 */
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { flatten } from './correspondence-reward.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = process.env.JOIST_BASE || 'http://localhost:8001';
const page = arg('page');
const url = arg('url') || (page ? `${BASE}/?page_id=${page}` : null);
if (!url) { console.error('need --page <id> or --url <url>'); process.exit(2); }
if (!/localhost|127\.0\.0\.1/.test(url) && !arg('allow-remote')) { console.error('REFUSING non-local url (use --allow-remote to override):', url); process.exit(2); }

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9@.\s]/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => { const m = new Map(); for (const t of norm(s).split(' ')) if (t.length >= 3) m.set(t, (m.get(t) || 0) + 1); return m; };
const recallOf = (truthToks, gotToks) => { let inter = 0; for (const [t, ct] of truthToks) { const cg = gotToks.get(t); if (cg) inter += Math.min(ct, cg); } const u = [...truthToks.values()].reduce((a, b) => a + b, 0); return { recall: inter / Math.max(1, u), missing: [...truthToks.keys()].filter((t) => !gotToks.has(t)) }; };

// 1) GROUND TRUTH — rendered-DOM text blocks (visible, leaf-ish text-bearing elements).
const browser = await chromium.launch({ headless: true });
const pg = await (await browser.newContext({ viewport: { width: 1440, height: 1200 } })).newPage();
await pg.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await pg.waitForTimeout(1200);
const dom = await pg.evaluate(() => {
  const out = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.01; };
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,li,span,div,td,th,figcaption,blockquote')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own || !vis(el)) continue;
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t.length > 1) out.push(t);
  }
  return { blocks: out, fullText: document.body.innerText || '' };
});
await browser.close();

// 2) capture-layout's reading (run it, or reuse a provided json).
const capPath = arg('capture') || `/tmp/_audit-cap-${page || 'url'}.json`;
if (!arg('capture')) { console.error('running capture-layout…'); execFileSync('node', ['capture-layout.mjs', '--source', url, '--width', '1440', '--out', capPath], { cwd: HERE, stdio: 'pipe', timeout: 180000 }); }
const capLeaves = flatten(JSON.parse(fs.readFileSync(capPath, 'utf8'))).filter((n) => n.text);
const capText = capLeaves.map((n) => n.text).join(' ');

// 3) compare.
const truth = toks(dom.fullText), got = toks(capText);
const { recall, missing } = recallOf(truth, got);
const domBlockSet = dom.blocks.map((b) => norm(b)).filter((b) => b.length > 3);
const capJoined = norm(capText);
const droppedBlocks = dom.blocks.filter((b) => { const nb = norm(b); return nb.length > 8 && !capJoined.includes(nb.slice(0, Math.min(40, nb.length))); });

console.log(`\n=== capture-fidelity audit — ${url} ===`);
console.log(`rendered-DOM text blocks: ${dom.blocks.length} | capture-layout leaves: ${capLeaves.length}`);
console.log(`DOM words: ${truth.size} | captured words: ${got.size}`);
console.log(`capture-layout WORD RECALL of the rendered DOM: ${(recall * 100).toFixed(1)}%   (100% = grader sees everything that renders)`);
console.log(`missing words (sample): ${missing.slice(0, 24).join(' ') || '(none)'}`);
console.log(`\nDROPPED rendered text blocks (capture-layout did not capture these — the fix targets): ${droppedBlocks.length}`);
for (const b of droppedBlocks.slice(0, 20)) console.log(`  · "${b.slice(0, 80)}"`);
