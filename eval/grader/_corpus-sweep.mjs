// @purpose Corpus REGRESSION SWEEP — validates this session's 4 builder commits (width-release, imgcap-free,
// loose-grid CORE+ARM) across the 7-site corpus from CACHED captures (no recapture). Per site: build flags-OFF
// (session features disabled = pre-session behavior) then flags-ON, measure desktop@1440 (regression check —
// must be ~unchanged) + mobile@390 (the height win), capture loose-grid cluster count, and scan the layout for
// ARM-2 targets (footer columns / multi-row image grids) to DATA-DRIVE the ARM-2 decision. Serial builds (local
// docker host-safety). Run from eval/grader with JOIST_AUTH_B64 + JOIST_BASE in env.
import { execFileSync } from 'child_process';
import fs from 'fs';
const BASE = process.env.JOIST_BASE || 'http://localhost:8001';
// page ids must EXIST on the local docker (the 2xxx/6xxx corpus ids are from a different instance → 404). These
// are existing eval/scratch pages on localhost:8001, overwritten by the sweep (build OFF then ON, ends ON).
const SITES = [
  { name: 'tailwind', layout: '/tmp/abs-cache/tailwindcsscom/layout.json', page: 268 },
  { name: 'supabase', layout: '/tmp/abs-cache/supabasecom/layout.json', page: 454 },
  { name: 'resend',   layout: '/tmp/abs-cache/resendcom/layout.json', page: 469 },
  { name: 'framer',   layout: '/tmp/abs-cache/wwwframercom/layout.json', page: 471 },
  { name: 'reactdev', layout: '/tmp/abs-cache/reactdev/layout.json', page: 472 },
  { name: 'linear',   layout: '/tmp/abs-cache/linearapp/layout.json', page: 455 },
  { name: 'notion',   layout: '/tmp/abs-cache/wwwnotionso/layout.json', page: 270 },
];
const OFF = { ABS_NO_BGR_RELEASE_M: '1', ABS_NO_IMGCAP_FREE: '1', ABS_NO_LOOSE_IMG_GRID: '1' };
const IMGK = new Set(['image', 'svg', 'mockup']);

function build(layout, page, off) {
  try {
    const out = execFileSync('node', ['build-absolute.mjs', '--layout', layout, '--page', String(page)],
      { env: { ...process.env, ...(off ? OFF : {}) }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
    const m = out.match(/loose-img grids: (\d+) reflowing/);
    return { ok: /PUT 200 postmeta/.test(out), clusters: m ? +m[1] : 0 };
  } catch (e) { return { ok: false, clusters: 0, err: String(e.message || e).slice(0, 90) }; }
}
function measure(page) {
  try {
    const out = execFileSync('node', ['_widthcheck.mjs', `${BASE}/?page_id=${page}`, '1440,390'], { encoding: 'utf8', timeout: 150000 });
    const arr = JSON.parse(out.trim().split('\n').filter((l) => l.startsWith('[')).pop());
    const at = (w) => arr.find((x) => x.width === w) || {};
    return { d1440: at(1440).scrollH, d1440o: at(1440).hOverflow, m390: at(390).scrollH, m390o: at(390).hOverflow };
  } catch (e) { return { err: String(e.message || e).slice(0, 90) }; }
}
// ARM-2 target scan: footer leaf-columns + regular multi-row image grids
function arm2scan(layout) {
  try {
    const L = JSON.parse(fs.readFileSync(layout, 'utf8'));
    const TEXTK = new Set(['text', 'button', 'heading', 'list']);
    const parent = new Map(); (function w(n) { for (const c of (n.children || [])) { parent.set(c, n); w(c); } })(L.root);
    const sib = (l) => { const p = parent.get(l); return p ? (p.children || []).filter((c) => IMGK.has(c.kind)).length : 1; };
    const all = []; (function g(n) { if (!n) return; if (n.box) all.push(n); for (const c of (n.children || [])) g(c); })(L.root);
    const maxY = Math.max(...all.map((n) => n.box.y + (n.box.h || 0)));
    // footer leaf-columns: short text leaves in the bottom 20%, clustered into >=2 columns of >=3 links
    const foot = all.filter((n) => n.box.y > maxY * 0.8 && TEXTK.has(n.kind) && (n.text || '').trim() && n.box.w <= 220 && (n.text || '').length < 40);
    const fcols = new Map(); for (const n of foot) { const cx = Math.round(n.box.x / 30) * 30; if (!fcols.has(cx)) fcols.set(cx, 0); fcols.set(cx, fcols.get(cx) + 1); }
    const footerCols = [...fcols.values()].filter((c) => c >= 3).length;
    // multi-row regular image grids
    const loose = all.filter((n) => IMGK.has(n.kind) && n.box.w >= 3 && n.box.h >= 3 && sib(n) < 3);
    const bk = new Map(); for (const n of loose) { const k = `${n.kind}|${Math.round(n.box.w / 15) * 15}x${Math.round(n.box.h / 15) * 15}`; if (!bk.has(k)) bk.set(k, []); bk.get(k).push(n); }
    let multiRowGrids = 0;
    for (const [, g] of bk) { if (g.length < 4) continue;
      const ys = [...new Set(g.map((n) => Math.round(n.box.y / 30) * 30))].sort((a, b) => a - b);
      const xs = [...new Set(g.map((n) => Math.round(n.box.x / 30) * 30))].sort((a, b) => a - b);
      if (ys.length >= 2 && xs.length >= 2) { const dy = ys.slice(1).map((y, i) => y - ys[i]); const mean = dy.reduce((a, b) => a + b, 0) / dy.length; const std = Math.sqrt(dy.map((d) => (d - mean) ** 2).reduce((a, b) => a + b, 0) / dy.length); if (std < 25) multiRowGrids++; }
    }
    return { footerCols, multiRowGrids };
  } catch (e) { return { footerCols: '?', multiRowGrids: '?', err: String(e.message || e).slice(0, 60) }; }
}

const results = [];
for (const s of SITES) {
  process.stderr.write(`\n[${s.name}] OFF…`);
  const bOff = build(s.layout, s.page, true); const mOff = measure(s.page);
  process.stderr.write(` ON…`);
  const bOn = build(s.layout, s.page, false); const mOn = measure(s.page);   // ends in ON state
  const a2 = arm2scan(s.layout);
  results.push({ name: s.name, clusters: bOn.clusters, on: mOn, off: mOff, bOnOk: bOn.ok, bOffOk: bOff.ok, bOnErr: bOn.err, bOffErr: bOff.err, arm2: a2 });
  process.stderr.write(` done`);
}
process.stderr.write('\n\n');
console.log('=== CORPUS REGRESSION SWEEP ===');
console.log('site      | grids | desk@1440 ON/OFF  Δregr | mobile@390 ON/OFF   win | hOv390 | ARM2: footerCols/multiRowGrids');
for (const r of results) {
  const dOn = r.on.d1440, dOff = r.off.d1440, dD = (dOn != null && dOff != null) ? dOn - dOff : '?';
  const mOn = r.on.m390, mOff = r.off.m390, win = (mOn != null && mOff != null) ? mOff - mOn : '?';
  const flag = (typeof dD === 'number' && Math.abs(dD) > 8) ? ' ⚠REGRESSION' : '';
  console.log(`${r.name.padEnd(9)} | ${String(r.clusters).padStart(5)} | ${String(dOn).padStart(6)}/${String(dOff).padStart(6)}  Δ${String(dD).padStart(5)} | ${String(mOn).padStart(6)}/${String(mOff).padStart(6)}  ${String(win).padStart(5)} | ${String(r.on.m390o).padStart(4)} | ${r.arm2.footerCols}/${r.arm2.multiRowGrids}${flag}${r.bOnErr ? ' ON-ERR:' + r.bOnErr : ''}`);
}
console.log('\nJSON:' + JSON.stringify(results));
