#!/usr/bin/env node
/**
 * @purpose WS2 self-heal Arm B acceptance gate — prove a stable per-block `heal-<id>` survives the FULL
 * round-trip authored-HTML → transpile-html (→ _css_classes) → render (WordPress/Elementor → classList) →
 * capture-layout (→ healId). Mechanism under test: a CSS CLASS `heal-<id>` on an authored block is preserved
 * by transpile-html into the Elementor element's `_css_classes`, Elementor stamps that onto the rendered DOM
 * node's classList, and capture-layout reads it back as `node.healId`.
 *
 * Steps (1-2 are HARD asserts; 3-5 are live-render best-effort with a clear PASS/FAIL print):
 *   1. write a tiny dark-bg section: <h1 class="heal-hx1">Hello</h1> + <p class="heal-px2">World</p>
 *   2. transpile (dry-run) → assert tree.json carries _css_classes with heal-hx1 and heal-px2
 *   3. render the tree onto scratch page 806 on the local WP sandbox (http://localhost:8001)
 *   4. capture-layout the rendered page → /tmp/heal-cap.json
 *   5. assert the captured tree has a leaf healId==="hx1" AND a leaf healId==="px2"
 *
 * Run: source /tmp/joist-auth-1.env && node _heal-id-roundtrip.mjs
 */
import fs from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = '/tmp/heal-section.html';
const TR = '/tmp/heal-tr';
const CAP = '/tmp/heal-cap.json';
const PAGE = '806';
const BASE = process.env.JOIST_BASE || 'http://localhost:8001';

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, ...opts });

// collect every _css_classes / healId value in a tree (array or object).
function collect(node, key, out) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const n of node) collect(n, key, out); return out; }
  if (node.settings && typeof node.settings[key] === 'string') out.push(node.settings[key]);
  if (typeof node[key] === 'string') out.push(node[key]);
  for (const v of Object.values(node)) if (v && typeof v === 'object') collect(v, key, out);
  return out;
}

let hardFail = false;

// ── 1. write the fixture ────────────────────────────────────────────────────────────────────────
fs.writeFileSync(HTML, `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:#0b0b0f; color:#f5f5f7; font-family:Inter,system-ui,sans-serif; }
  section { padding:80px 48px; display:flex; flex-direction:column; gap:16px; background:#0b0b0f; }
  h1 { font-size:48px; font-weight:700; margin:0; color:#f5f5f7; }
  p  { font-size:20px; margin:0; color:#c7c7cc; }
</style></head><body>
  <section>
    <h1 class="heal-hx1">Hello</h1>
    <p class="heal-px2">World</p>
  </section>
</body></html>`);
console.log('[1] wrote fixture', HTML);

// ── 2. transpile (dry-run) + HARD assert _css_classes preserves the heal-* tokens ────────────────
console.log('[2] transpile --dry-run …');
try {
  const out = run('node', ['transpile-html.mjs', '--html', HTML, '--width', '1440', '--dry-run', '--no-site-parts', '--out', TR]);
  process.stdout.write(out.split('\n').filter((l) => /widget counts|tree sha1|local validation/.test(l)).map((l) => '    ' + l).join('\n') + '\n');
} catch (e) {
  console.error('    transpile FAILED:', (e.stdout || '') + (e.stderr || '') + e.message);
  hardFail = true;
}
let treeClasses = [];
try {
  const tree = JSON.parse(fs.readFileSync(path.join(TR, 'tree.json'), 'utf8'));
  treeClasses = collect(tree, '_css_classes', []);
} catch (e) { console.error('    could not read tree.json:', e.message); hardFail = true; }
const allCls = treeClasses.join(' ');
const has1 = /\bheal-hx1\b/.test(allCls);
const has2 = /\bheal-px2\b/.test(allCls);
console.log(`    _css_classes found: ${JSON.stringify(treeClasses)}`);
console.log(`    [2] heal-hx1 in _css_classes: ${has1 ? 'PASS' : 'FAIL'}`);
console.log(`    [2] heal-px2 in _css_classes: ${has2 ? 'PASS' : 'FAIL'}`);
if (!has1 || !has2) hardFail = true;

if (hardFail) {
  console.error('\n=== RESULT: HARD FAIL (step 2 — transpile did not preserve heal-* into _css_classes) ===');
  process.exit(1);
}

// ── 3-5. live round-trip (best-effort; flakiness must not mask the step-2 hard pass) ─────────────
let livePass = false;
let liveReason = '';
if (!process.env.JOIST_AUTH_B64) {
  liveReason = 'no JOIST_AUTH_B64 in env (source /tmp/joist-auth-1.env to enable live render)';
} else {
  try {
    console.log('[3] render tree → page', PAGE, 'on', BASE, '…');
    const rout = run('node', ['../../sandbox/render.mjs', '--tree', path.join(TR, 'tree.json'), '--page', PAGE, '--no-shot']);
    process.stdout.write(rout.split('\n').filter(Boolean).slice(-3).map((l) => '    ' + l).join('\n') + '\n');

    console.log('[4] capture-layout …');
    run('node', ['capture-layout.mjs', '--source', `${BASE}/?page_id=${PAGE}`, '--out', CAP]);
    const cap = JSON.parse(fs.readFileSync(CAP, 'utf8'));
    const healIds = collect(cap, 'healId', []);
    console.log('    captured healIds:', JSON.stringify(healIds));

    const ok1 = healIds.includes('hx1');
    const ok2 = healIds.includes('px2');
    console.log(`    [5] leaf healId==="hx1": ${ok1 ? 'PASS' : 'FAIL'}`);
    console.log(`    [5] leaf healId==="px2": ${ok2 ? 'PASS' : 'FAIL'}`);
    livePass = ok1 && ok2;
    if (!livePass) liveReason = `captured healIds = ${JSON.stringify(healIds)} (expected hx1 + px2)`;
  } catch (e) {
    liveReason = 'live render/capture error: ' + ((e.stdout || '') + (e.stderr || '') + e.message).slice(0, 600);
  }
}

console.log('\n=== RESULT ===');
console.log(`  step 2 (transpile → _css_classes): PASS`);
console.log(`  steps 3-5 (live round-trip → healId): ${livePass ? 'PASS' : 'FAIL/SKIP — ' + liveReason}`);
// The HARD gate is step 2 (already enforced via the exit above). Steps 3-5 are best-effort: print loudly but
// exit 0 only when the live round-trip ALSO passed; otherwise exit 2 (distinguishable from a hard step-2 fail).
if (livePass) { console.log('\nALL PASS (full round-trip survived).'); process.exit(0); }
console.log('\nSTEP-2 PASS, LIVE BEST-EFFORT INCOMPLETE (see reason above).');
process.exit(2);
