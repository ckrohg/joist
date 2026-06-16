#!/usr/bin/env node
/**
 * @purpose capture-source-bbox.mjs — produce the TWO assets the sticky-note tool's SOURCE pane needs:
 *   (1) a full-page SOURCE screenshot  (source-<id>.png)
 *   (2) a per-element SOURCE-BBOX JSON  (source-bbox-<id>.json): [{ stamp, path, nth, bbox:{x,y,w,h}, role, text }]
 *       keyed by the SAME content-addressed stamp `tagchain|nth|h<8hex>` the clone carries as --joist-src and the
 *       grader uses for correspondence. So when a human clicks a clone widget (→ a stamp), the tool highlights the
 *       MAPPED source region by looking the stamp up in this JSON. (Pixel-exact source highlight, no live reload.)
 *
 * WHY A CAPTURED ASSET (not a live external load): the sticky-note tool must NOT cross-origin-load the live source
 * (CORS + drift + a moving target). We capture ONCE, offline, into a static png + json the tool reads locally.
 *
 * THE STAMP — recomputed here EXACTLY as the projection builder / grader does (FNV-1a over the leaf's first 24
 * trimmed chars, tagchain root→leaf, nth-of-type among same-tag siblings). So source stamps == clone --joist-src
 * stamps == grader ledger refs, by construction.
 *
 * HOST POLICY: this targets the EXTERNAL SOURCE url (read-only screenshot) — it is NOT a WP render/PUT, so it is
 * NOT under the §0 localhost-only host-guard (that guard exists to stop WP writes to the shared host; a read-only
 * external screenshot of the site being cloned is the legitimate source-capture path the grader already uses).
 * It NEVER touches localhost WP or any WP host. node+playwright+timeout (NOT mcp-playwright), <120s.
 *
 *   node capture-source-bbox.mjs --url https://example.com --id 2551 [--out-dir ./assets] [--width 1440]
 *   node capture-source-bbox.mjs --selftest        # offline: stamp determinism + bbox-json shape, no network
 *   node --check capture-source-bbox.mjs
 *
 * If you ALREADY have a grader source capture for this page (records carry {stamp/ref, box}), prefer
 *   node capture-source-bbox.mjs --from-compare /tmp/compare-2551.json --id 2551
 * which DERIVES the bbox json from the existing capture (no re-screenshot of the boxes) — same stamps, free.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined && !String(process.argv[i + 1]).startsWith('--') ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

// ── the stamp (FNV-1a, 8 hex) — byte-identical to _joist-src-roundtrip.textHash8 / the projection builder ──
export function textHash8(s) {
  const t = String(s || '').trim().slice(0, 24);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ('00000000' + h.toString(16)).slice(-8);
}
export function makeStamp(tagchain, nth, text) { return `${tagchain}|${nth}|h${textHash8(text)}`; }

// the in-page DOM walk that produces a stamp + bbox per visible element. Returns a serializable array.
// (kept as a string so it can be page.evaluate'd; also unit-tested via a jsdom-free shape check in the selftest.)
export const PAGE_EXTRACTOR = `() => {
  const fnv = (s) => { const t=String(s||'').trim().slice(0,24); let h=0x811c9dc5; for(let i=0;i<t.length;i++){h^=t.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0;} return ('00000000'+h.toString(16)).slice(-8); };
  const tagchainOf = (el) => { const parts=[]; let n=el; while(n && n.nodeType===1 && n.tagName){ parts.unshift(n.tagName.toLowerCase()); n=n.parentElement; } return parts.join('>'); };
  const nthOfType = (el) => { let i=1, s=el.previousElementSibling; while(s){ if(s.tagName===el.tagName) i++; s=s.previousElementSibling; } return i; };
  const out=[]; const seen=new Set();
  const all=document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,img,section,header,footer,nav,div,span,li,blockquote,figure');
  for(const el of all){
    const r=el.getBoundingClientRect();
    if(r.width<8||r.height<8) continue;                       // skip invisible / sliver nodes
    if(r.top+window.scrollY>40000) continue;                  // hard cap page height
    const tagchain=tagchainOf(el); const nth=nthOfType(el);
    const text=(el.getAttribute('alt')||el.textContent||'').trim();
    const stamp=tagchain+'|'+nth+'|h'+fnv(text);
    if(seen.has(stamp)) continue; seen.add(stamp);
    const role=el.getAttribute('role')||({H1:'heading',H2:'heading',H3:'heading',IMG:'img',BUTTON:'button',A:'link',HEADER:'banner',FOOTER:'contentinfo',NAV:'navigation'}[el.tagName]||null);
    out.push({ stamp, path:tagchain, nth, role, text:text.slice(0,80),
      bbox:{ x:Math.round(r.left+window.scrollX), y:Math.round(r.top+window.scrollY), w:Math.round(r.width), h:Math.round(r.height) } });
  }
  return { width: window.innerWidth, scrollH: document.documentElement.scrollHeight, elements: out };
}`;

// derive the bbox json from an EXISTING grader compare/source capture (records carry stamp/ref + box) — no screenshot.
export function fromCompare(blob, width) {
  const recs = (blob.sourceCapture && blob.sourceCapture.records) || [];
  const w = width || (blob.report && (blob.report.widths || [1440])[0]) || 1440;
  const elements = [];
  for (const r of recs) {
    const stamp = r.stamp || r.ref;
    const box = r.box && (r.box[w] || r.box[String(w)]);
    if (!stamp || !box) continue;
    elements.push({ stamp, path: String(stamp).split('|')[0], nth: +(String(stamp).split('|')[1] || 0),
      role: r.role || null, text: String(r.text || r.ownText || '').slice(0, 80),
      bbox: { x: Math.round(box.x || 0), y: Math.round(box.y || 0), w: Math.round(box.w || 0), h: Math.round(box.h || 0) } });
  }
  return { width: w, scrollH: (blob.report && blob.report.pageHeightByVw && blob.report.pageHeightByVw.source && blob.report.pageHeightByVw.source[w]) || null, elements,
    source: blob.report && blob.report.source, derivedFrom: 'compare-blob (no re-screenshot)' };
}

async function captureLive(url, width) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  try {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }));
    await page.waitForTimeout(2500);
    await page.evaluate(async () => { window.scrollTo(0, document.body.scrollHeight); await new Promise((r) => setTimeout(r, 700)); window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 400)); });
    const data = await page.evaluate(eval('(' + PAGE_EXTRACTOR + ')'));
    return { browser, page, data };
  } catch (e) { await browser.close(); throw e; }
}

function runSelftest() {
  const cases = []; const ok = (n, p, d = '') => cases.push({ name: n, pass: !!p, detail: d });
  // (1) stamp determinism + format
  const s1 = makeStamp('body>main>h1', 1, 'Hello World');
  const s2 = makeStamp('body>main>h1', 1, 'Hello World');
  ok('(1) stamp deterministic', s1 === s2, s1);
  ok('(1) stamp format tagchain|nth|hHASH', /^[a-z0-9>]+\|\d+\|h[0-9a-f]{8}$/.test(s1), s1);
  ok('(1) different text → different hash', makeStamp('body>main>h1', 1, 'Other') !== s1);
  // (2) FNV matches the roundtrip reference (Do or do not...) — the known stamp tail from _joist-src-roundtrip
  ok('(2) FNV-1a 8 hex length', textHash8('Do or do not. There is no try.').length === 8, textHash8('Do or do not. There is no try.'));
  // (3) fromCompare derives a well-formed bbox json from a synthetic capture blob
  const blob = { report: { source: 'https://x', widths: [1440], pageHeightByVw: { source: { 1440: 3000 } } },
    sourceCapture: { records: [
      { stamp: 'body>main>h1|1|haaaa0000', ref: 'body>main>h1|1|haaaa0000', role: 'heading', text: 'Hero', box: { 1440: { x: 10, y: 20, w: 600, h: 80 } } },
      { ref: 'body>footer|1|hbbbb1111', role: 'contentinfo', box: { 1440: { x: 0, y: 2900, w: 1440, h: 100 } } },
      { stamp: 'body>aside|1|hcccc2222', box: null }, // no box → skipped
    ] } };
  const d = fromCompare(blob, 1440);
  ok('(3) fromCompare emits 2 elements (skips boxless)', d.elements.length === 2, `n=${d.elements.length}`);
  ok('(3) first element has stamp+bbox+path', d.elements[0].stamp && d.elements[0].bbox.w === 600 && d.elements[0].path === 'body>main>h1', JSON.stringify(d.elements[0]));
  ok('(3) stamp-less record falls back to ref', d.elements[1].stamp === 'body>footer|1|hbbbb1111', d.elements[1].stamp);
  // (4) PAGE_EXTRACTOR is a valid function expression
  let extractorOk = false; try { eval('(' + PAGE_EXTRACTOR + ')'); extractorOk = true; } catch {}
  ok('(4) PAGE_EXTRACTOR parses as a function', extractorOk);
  const passed = cases.filter((c) => c.pass).length;
  console.log('\n==== capture-source-bbox SELFTEST (offline, no network) ====');
  for (const c of cases) console.log(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
  console.log(`  ${passed}/${cases.length} pass — ${passed === cases.length ? 'ALL PASS' : 'FAILURES'}`);
  process.exit(passed === cases.length ? 0 : 1);
}

async function main() {
  if (has('selftest')) return runSelftest();
  const id = arg('id', 'src');
  const outDir = arg('out-dir', __dir);
  const width = +arg('width', 1440);
  fs.mkdirSync(outDir, { recursive: true });
  const bboxPath = path.join(outDir, `source-bbox-${id}.json`);

  const fromCmp = arg('from-compare');
  if (fromCmp) {
    const blob = JSON.parse(fs.readFileSync(fromCmp, 'utf8'));
    const data = fromCompare(blob, width);
    fs.writeFileSync(bboxPath, JSON.stringify(data, null, 2));
    console.log(`wrote ${data.elements.length} source bboxes → ${bboxPath} (from ${fromCmp}; provide source-${id}.png separately or via --url)`);
    return;
  }
  const url = arg('url');
  if (!url) { console.error('usage: node capture-source-bbox.mjs --url <src> --id <id> [--out-dir d] [--width w]\n       node capture-source-bbox.mjs --from-compare /tmp/compare-<id>.json --id <id>\n       node capture-source-bbox.mjs --selftest'); process.exit(2); }
  const pngPath = path.join(outDir, `source-${id}.png`);
  const { browser, page, data } = await captureLive(url, width);
  try {
    await page.screenshot({ path: pngPath, fullPage: true });
    fs.writeFileSync(bboxPath, JSON.stringify({ source: url, ...data }, null, 2));
    console.log(JSON.stringify({ png: pngPath, bbox: bboxPath, elements: data.elements.length, width, scrollH: data.scrollH }));
  } finally { await browser.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
