#!/usr/bin/env node
/** @purpose _transpile-extract-selftest.mjs — HERMETIC gate for the projection extractor fixes (LEVER A' script-gate +
 * LEVER b loose-text). Transpiles a crafted fixture with (1) a <script>/<style> inside a leaf and (2) loose text
 * interleaved with element children in a non-leaf container, then asserts the tree emits the real prose + nav text and
 * NOT the script/style source. No sandbox/network (transpile runs its own headless chromium on a local file). */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
let fails = 0; const ok = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${n}${x ? '  ' + x : ''}`); if (!c) fails++; };

const FIX = '/tmp/_extract-selftest.html';
fs.writeFileSync(FIX, `<!doctype html><html><head><style>.h{font-size:40px;color:#111}.p{font-size:18px;color:#333}.nav button{font-size:16px}</style></head>
<body style="font-family:Arial">
  <nav class="nav" style="display:flex;gap:12px">
    <button>Features<svg width="8" height="8"></svg></button>
    <button>Company<svg width="8" height="8"></svg></button>
  </nav>
  <div class="h">Real headline<script>self.__wrap_n=self.__wrap_n||1;var leak="SHOULD_NOT_APPEAR";</script></div>
  <p class="p">We are a team of engineers <a href="#">who love</a> building tools for other engineers.</p>
  <div style="display:none"><h2>Hidden mobile duplicate headline</h2></div>
</body></html>`);

const txt = (() => {
  execFileSync('node', ['transpile-html.mjs', '--html', FIX, '--width', '1440', '--dry-run', '--no-site-parts', '--out', '/tmp/_extract-selftest-out'], { cwd: HERE, stdio: 'pipe' });
  const t = JSON.parse(fs.readFileSync('/tmp/_extract-selftest-out/tree.json', 'utf8'));
  const acc = [];
  (function f(n) { if (!n) return; const s = n.settings || {}; for (const k of ['title', 'editor', 'text']) if (typeof s[k] === 'string') acc.push(s[k].replace(/<[^>]+>/g, ' ')); (n.elements || []).forEach(f); })(Array.isArray(t) ? { elements: t } : t);
  return acc.join('  ||  ').replace(/\s+/g, ' ');
})();

console.log('── projection extractor ──');
ok('LEVER b: loose prose in a non-leaf <p> (with <a> child) is emitted', /We are a team of engineers/.test(txt) && /building tools for other engineers/.test(txt), txt.includes('engineers') ? '' : `got: ${txt.slice(0, 120)}`);
ok('LEVER b: the inner <a> text is still emitted (not lost)', /who love/.test(txt));
ok('LEVER b: nav button labels (non-leaf button + svg) are emitted', /Features/.test(txt) && /Company/.test(txt));
ok("LEVER A': <script> source text is NOT emitted", !/__wrap_n/.test(txt) && !/SHOULD_NOT_APPEAR/.test(txt));
ok('real headline still emitted', /Real headline/.test(txt));
ok('LEVER A: display:none duplicate is dropped', !/Hidden mobile duplicate/.test(txt));

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAIL'} — transpile-extract selftest`);
process.exit(fails === 0 ? 0 : 1);
