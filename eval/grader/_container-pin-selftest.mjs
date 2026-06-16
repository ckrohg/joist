#!/usr/bin/env node
/**
 * @purpose OFFLINE census self-test for the GENERALIZED container position-pin (build-absolute.mjs containerPin()).
 * The card-row collision-wall fix (commit 6727073) routed the UNIFORM card-row grid container pin through the
 * FREE-render joist_preserve_css `d` channel (the plugin's elementor/element/parse_css → core Post_CSS hook) instead
 * of the Pro-only page custom_css channel that is silently dropped on a Pro-free host. This test proves the pattern
 * is now UNIVERSAL: EVERY container that gets a position pin (card-rows + static nav + any future non-grid container)
 * carries the free `d` pin at its captured band, with the Pro custom_css push kept as an INERT fallback.
 *
 * It also pins down the linear "irregular side-by-side panels" truth: those panels are NOT a uniform N-up grid, so
 * the card-row detector does NOT classify them → they stay FLAT root leaves pinned by native _offset_y (which DOES
 * render on free). So the census models the FREE-render resolution (apply container `d` pins + leaf _offset_y) and
 * asserts the card-rows, the static nav, AND the irregular panel pair all resolve to their captured bands with NO
 * overlap in the resolved tree. NO network, NO host, DRY_RUN only. Exit 0 = all gates pass.
 *
 * Run:  node _container-pin-selftest.mjs
 */
import fs from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const BUILDER = path.join(__dir, 'build-absolute.mjs');
const cases = [];
const ok = (name, pass, detail = '') => { cases.push({ name, pass: !!pass, detail }); };

// ── synthetic layout: static nav + two uniform 3-up card-rows + one IRREGULAR side-by-side panel pair ──────────
// Geometry mirrors the SHAPES capture-layout emits. The two card-rows are uniform N-up grids at DISTINCT y bands
// (→ emitCardRow → containerPin). The panel pair (two wide mockup leaves at the SAME y, different x) is the
// linear-class case: comparable but NOT a uniform grid the card-row detector fires on (their parent has only 2
// kids and they sit side-by-side as a 2-up but the test asserts whatever path emits them lands them, on the
// FREE-render model, at their captured bands with no overlap — whether via a container pin OR native leaf offsets).
function mkRow(y, label) {
  // three comparable cells across the band (x at 48 / 488 / 928, w≈400, gap≈40) → uniform 3-up grid.
  const cell = (x, i) => ({
    kind: 'container', tag: 'div', box: { x, y, w: 400, h: 220 }, position: 'static',
    background: { color: 'rgb(250,250,250)' },
    children: [ { kind: 'heading', tag: 'h3', level: 3, text: `${label} ${i}`, box: { x: x + 20, y: y + 20, w: 360, h: 28 }, typo: { size: 22 }, paint: { value: 'rgb(20,20,20)' }, srcPath: `body>div.row>div|${i}|h${label}${i}` } ],
  });
  return {
    kind: 'container', tag: 'div', box: { x: 48, y, w: 1344, h: 220 }, position: 'static',
    children: [ cell(48, 1), cell(488, 2), cell(928, 3) ],
  };
}
function mkLayout() {
  const root = {
    kind: 'container', tag: 'body', box: { x: 0, y: 0, w: 1440, h: 9000 }, position: 'static',
    background: { color: 'rgb(255,255,255)' },
    children: [
      // STATIC nav band (position:static → un-stick → containerPin rawD top:0 pin).
      { kind: 'container', tag: 'header', box: { x: 0, y: 0, w: 1440, h: 60 }, position: 'static', background: { color: 'rgb(255,255,255)' }, children: [
        { kind: 'button', tag: 'a', text: 'BrandCo', href: 'http://localhost:8001/', box: { x: 40, y: 18, w: 120, h: 24 }, typo: { size: 18 }, paint: { value: 'rgb(20,20,20)' }, srcPath: 'body>header>a|1|hnav1' },
        { kind: 'button', tag: 'a', text: 'Docs', href: '/docs', box: { x: 1240, y: 18, w: 70, h: 24 }, typo: { size: 16 }, paint: { value: 'rgb(20,20,20)' }, srcPath: 'body>header>a|2|hnav2' },
      ] },
      // a hero heading so the page has content above the rows.
      { kind: 'heading', tag: 'h1', level: 1, text: 'Generalized container pins', box: { x: 48, y: 200, w: 900, h: 64 }, typo: { size: 52, lineHeight: '60px' }, paint: { value: 'rgb(20,20,20)' }, srcPath: 'body>h1|1|hhero' },
      // CARD-ROW #1 at y=1200 (uniform 3-up grid → cr-0, containerPin band pin).
      mkRow(1200, 'A'),
      // ── IRREGULAR SIDE-BY-SIDE PANEL PAIR at y=3000 (the linear-class case) ──────────────────────────────────
      // Two wide mockup leaves sitting side-by-side at the SAME y, different x. srcIOU=0 (they don't overlap in
      // source). They are NOT wrapped in a card-row-eligible container with >=3 uniform cells, so they stay flat
      // leaves pinned by native _offset_y. The census models the free render and asserts they land at their bands.
      { kind: 'mockup', tag: 'div', raster: '/tmp/__cp-panelL.png', box: { x: 48, y: 3000, w: 648, h: 560 }, ar: 648 / 560, srcPath: 'body>section.panels>div|1|hpanelL' },
      { kind: 'mockup', tag: 'div', raster: '/tmp/__cp-panelR.png', box: { x: 744, y: 3000, w: 648, h: 560 }, ar: 648 / 560, srcPath: 'body>section.panels>div|2|hpanelR' },
      // CARD-ROW #2 at y=4200 (a second uniform 3-up grid → cr-1, containerPin band pin).
      mkRow(4200, 'B'),
    ],
  };
  return { vw: 1440, pageH: 9000, root, fonts: [], fontFiles: [] };
}

// minimal 1×1 PNG so the mockup leaves localSrc() to a real file (DRY_RUN skips upload but localSrc reads existence).
function writePanelPngs() {
  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  for (const f of ['/tmp/__cp-panelL.png', '/tmp/__cp-panelR.png']) { try { fs.writeFileSync(f, png1x1); } catch {} }
}

function dryRun(extraEnv) {
  const layoutPath = `/tmp/_container-pin-layout-${process.pid}.json`;
  const treePath = `/tmp/_container-pin-tree-${process.pid}.json`;
  fs.writeFileSync(layoutPath, JSON.stringify(mkLayout()));
  const env = { ...process.env, ...extraEnv, ABS_DRY_RUN: '1', ABS_DUMP_TREE: treePath,
    JOIST_AUTH_B64: Buffer.from('t:t').toString('base64'), JOIST_BASE: 'http://localhost:8001' };
  const r = spawnSync(process.execPath, [BUILDER, '--layout', layoutPath, '--page', '0'], { env, encoding: 'utf8' });
  let tree = null; try { tree = JSON.parse(fs.readFileSync(treePath, 'utf8')); } catch {}
  try { fs.unlinkSync(layoutPath); } catch {}
  try { fs.unlinkSync(treePath); } catch {}
  return { tree, stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

// ── tree walkers ──────────────────────────────────────────────────────────────────────────────────────────────
function allNodes(tree) {
  const out = [];
  const walk = (nodes) => { for (const n of (nodes || [])) { if (!n || typeof n !== 'object') continue; out.push(n); if (Array.isArray(n.elements)) walk(n.elements); } };
  walk(tree.elements || (tree.root ? [tree.root] : []));
  return out;
}
const preserve = (n) => { try { return JSON.parse((n.settings || {}).joist_preserve_css || '{}'); } catch { return {}; } };
const isContainer = (n) => n.elType === 'container';
const isWidget = (n) => n.elType === 'widget';

// parse a position:absolute;left:Xpx;top:Ypx;width:Wpx;min-height:Hpx decl → {x,y,w,h} or null
function parsePinD(d) {
  if (!d || !/position\s*:\s*absolute/i.test(d)) return null;
  const num = (re) => { const m = d.match(re); return m ? parseFloat(m[1]) : null; };
  const x = num(/left\s*:\s*(-?\d+(?:\.\d+)?)px/i);
  const y = num(/top\s*:\s*(-?\d+(?:\.\d+)?)px/i);
  const w = num(/width\s*:\s*(-?\d+(?:\.\d+)?)px/i);
  const h = num(/min-height\s*:\s*(-?\d+(?:\.\d+)?)px/i);
  return { x, y, w, h };
}
// native leaf offset → resolved page box (the free-render position for an absolute leaf widget)
function leafBox(n) {
  const s = n.settings || {};
  if (s._position !== 'absolute') return null;
  const ox = s._offset_x && typeof s._offset_x.size === 'number' ? s._offset_x.size : null;
  const oy = s._offset_y && typeof s._offset_y.size === 'number' ? s._offset_y.size : null;
  if (ox == null || oy == null) return null;
  const w = (s.width && typeof s.width.size === 'number') ? s.width.size : (s._element_custom_width && s._element_custom_width.size) || 0;
  return { x: ox, y: oy, w };
}
function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy; if (inter <= 0) return 0;
  const ua = a.w * a.h + b.w * b.h - inter; return ua > 0 ? inter / ua : 0;
}

// ════════════════════════════════ DEFAULT BUILD (generalized container pin ON) ════════════════════════════════
{
  writePanelPngs();
  const { tree, stdout, status } = dryRun({});
  ok('DRY-RUN build succeeded (status 0, tree dumped)', status === 0 && tree, `status=${status}`);
  const nodes = tree ? allNodes(tree) : [];
  const containers = nodes.filter(isContainer);
  const widgets = nodes.filter(isWidget);

  // (1) EVERY position-pinned container carries a FREE-render `d` pin (joist_preserve_css with position:absolute).
  const pinnedContainers = containers.filter((c) => { const p = preserve(c); return p.d && /position\s*:\s*absolute/i.test(p.d); });
  ok('census — >=3 containers carry a FREE-render joist_preserve_css `d` position pin (2 card-rows + static nav)',
    pinnedContainers.length >= 3, `pinned containers=${pinnedContainers.length}`);

  // (2) the two card-row grids (container_type:'grid') are among the free-pinned set, at their captured bands.
  const grids = containers.filter((c) => (c.settings || {}).container_type === 'grid');
  ok('census — 2 card-row GRID containers emitted', grids.length === 2, `grids=${grids.length}`);
  const gridPins = grids.map((g) => parsePinD(preserve(g).d)).filter(Boolean);
  ok('census — both card-row grids carry a parseable free `d` band pin', gridPins.length === 2, JSON.stringify(gridPins));
  // card-row #1 captured band y=1200, #2 y=4200 (the mkRow y's). Tolerate exact (band geometry is round()).
  const gy = gridPins.map((p) => p.y).sort((a, b) => a - b);
  ok('census — card-row #1 free-pinned at captured y=1200', gy[0] === 1200, `y=${gy[0]}`);
  ok('census — card-row #2 free-pinned at captured y=4200', gy[1] === 4200, `y=${gy[1]}`);

  // (3) the static nav container carries the top-anchored free `d` pin (position:absolute;top:0).
  const navPinned = pinnedContainers.find((c) => { const d = preserve(c).d; return /top\s*:\s*0/i.test(d) && !/min-height/i.test(d); });
  ok('census — static nav carries a free top:0 un-stick `d` pin (renders on FREE, not the Pro-only channel)', !!navPinned,
    navPinned ? preserve(navPinned).d.slice(0, 60) : 'none');

  // (4) the IRREGULAR side-by-side panel pair: emitted as flat mockup IMAGE widgets pinned by native _offset_y at
  // their captured bands (the audit's linear truth — they are NOT a card-row container, so they free-render via
  // native leaf offsets). Find them by the two captured x bands (48 / 744) at y=3000.
  const panelLeaves = widgets.filter((w) => w.widgetType === 'image').map((w) => ({ w, b: leafBox(w) })).filter((o) => o.b && Math.abs(o.b.y - 3000) <= 4);
  ok('census — irregular panel pair emitted as 2 flat image leaves at captured y=3000 (native _offset_y, free-render)',
    panelLeaves.length >= 2, `panel leaves @y~3000=${panelLeaves.length}`);

  // ── FREE-RENDER RESOLUTION + NO-OVERLAP: model what the FREE host renders. Pinned containers resolve to their
  //    `d` band box; the panel leaves resolve to their native offset box. Assert pairwise NO catastrophic overlap.
  const resolved = [];
  for (const c of pinnedContainers) { const p = parsePinD(preserve(c).d); if (p && p.x != null && p.y != null && p.w != null) resolved.push({ tag: ((c.settings || {})._element_id || ((c.settings || {}).container_type === 'grid' ? 'grid' : 'nav')), x: p.x, y: p.y, w: p.w, h: p.h != null ? p.h : 60 }); }
  // panel pair resolved boxes (use captured w from layout: 648 each).
  for (const o of panelLeaves.slice(0, 2)) resolved.push({ tag: 'panel', x: o.b.x, y: o.b.y, w: o.b.w || 648, h: 560 });
  // pairwise IOU among the BAND-pinned items (card-rows + panels). The static nav (h=60, y=0) never overlaps a
  // y>=1200 band, so include it too. A catastrophic pile is IOU > 0.3 between any two distinct bands.
  let worst = 0, worstPair = '';
  for (let i = 0; i < resolved.length; i++) for (let j = i + 1; j < resolved.length; j++) {
    const v = iou(resolved[i], resolved[j]); if (v > worst) { worst = v; worstPair = `${resolved[i].tag}↔${resolved[j].tag}`; }
  }
  ok('census — NO catastrophic overlap in the FREE-resolved tree (worst pairwise IOU <= 0.3)', worst <= 0.3, `worst IOU=${worst.toFixed(3)} (${worstPair})`);
  // specifically: the two side-by-side panels do NOT pile (srcIOU=0 → resolved IOU must be ~0; this is the linear
  // 0.7091 catastrophic the generalization must NOT reproduce on the free-render model).
  const panels = resolved.filter((r) => r.tag === 'panel');
  const panelIou = panels.length === 2 ? iou(panels[0], panels[1]) : 1;
  ok('census — the irregular side-by-side panel pair has ~0 overlap when free-resolved (linear 0.7091 → ~0)', panelIou < 0.05, `panel IOU=${panelIou.toFixed(3)}`);

  // (5) the Pro page custom_css fallback is STILL emitted (inert on free, active under Pro) for the card-row pins.
  const css = (tree.page_settings || {}).custom_css || '';
  ok('Pro fallback — page custom_css still carries the #cr-N{position:absolute…} desktop pin (inert on free)',
    /#cr-\d+\{[^}]*position:absolute/i.test(css), `css len=${css.length}`);
  // log line present
  ok('log — generalized container pin ON with >=3 hits', /container position-pin \(generalized free-render\): ON — [3-9]/.test(stdout) || /container position-pin \(generalized free-render\): ON — \d\d/.test(stdout), stdout.split('\n').find((l) => /container position-pin/.test(l)) || '(no log)');
}

// ════════════════════════════════ REVERSIBLE: ABS_NO_CONTAINER_PIN=1 ═══════════════════════════════════════════
{
  writePanelPngs();
  const { tree, stdout, status } = dryRun({ ABS_NO_CONTAINER_PIN: '1' });
  ok('REVERSIBLE — build still succeeds with ABS_NO_CONTAINER_PIN=1', status === 0 && tree, `status=${status}`);
  const nodes = tree ? allNodes(tree) : [];
  const containers = nodes.filter(isContainer);
  // card-row grids: with the generalized pin OFF, the card-row free pin is gone (containerPin returns {}), so the
  // grids carry NO `d` band pin — BUT the legacy Pro custom_css desktop pin must STILL be pushed (the legacy
  // fallback branch), so a Pro host renders identically to HEAD. Static nav falls back to its inline free payload.
  const grids = containers.filter((c) => (c.settings || {}).container_type === 'grid');
  const gridBandPinned = grids.filter((c) => { const p = preserve(c); return p.d && /min-height/i.test(p.d); });
  ok('REVERSIBLE — card-row grids carry NO free `d` band pin when generalized pin OFF (legacy)', gridBandPinned.length === 0, `band-pinned grids=${gridBandPinned.length}`);
  const css = (tree.page_settings || {}).custom_css || '';
  ok('REVERSIBLE — Pro custom_css desktop pin STILL emitted for card-rows (Pro host == HEAD)', /#cr-\d+\{[^}]*position:absolute/i.test(css), `css len=${css.length}`);
  // static nav: ABS_NO_CONTAINER_PIN=1 → containerPin {} → restore the legacy inline free payload (must still pin).
  const navPinned = containers.find((c) => { const d = preserve(c).d; return d && /top\s*:\s*0/i.test(d) && !/min-height/i.test(d); });
  ok('REVERSIBLE — static nav still free-pinned via legacy inline payload (no static-nav regression)', !!navPinned, navPinned ? 'pinned' : 'MISSING');
  ok('REVERSIBLE — log shows generalized container pin OFF', /container position-pin \(generalized free-render\): OFF/.test(stdout), '');
}

// ════════════════════════════════ REVERSIBLE: ABS_CARDROW_PRESERVE_PIN=0 (card-row free pin off only) ══════════
{
  writePanelPngs();
  const { tree, status } = dryRun({ ABS_CARDROW_PRESERVE_PIN: '0' });
  ok('REVERSIBLE — build succeeds with ABS_CARDROW_PRESERVE_PIN=0', status === 0 && tree, `status=${status}`);
  const nodes = tree ? allNodes(tree) : [];
  const grids = nodes.filter(isContainer).filter((c) => (c.settings || {}).container_type === 'grid');
  const gridBandPinned = grids.filter((c) => { const p = preserve(c); return p.d && /min-height/i.test(p.d); });
  ok('REVERSIBLE — card-row free `d` pin OFF when ABS_CARDROW_PRESERVE_PIN=0 (legacy card-row behavior)', gridBandPinned.length === 0, `band-pinned grids=${gridBandPinned.length}`);
  const css = (tree.page_settings || {}).custom_css || '';
  ok('REVERSIBLE — Pro custom_css desktop pin STILL emitted for card-rows (legacy)', /#cr-\d+\{[^}]*position:absolute/i.test(css), '');
  // static nav (independent flag) must STILL be free-pinned via the generalized helper.
  const navPinned = nodes.filter(isContainer).find((c) => { const d = preserve(c).d; return d && /top\s*:\s*0/i.test(d) && !/min-height/i.test(d); });
  ok('REVERSIBLE — static nav still free-pinned (card-row flag independent of static-nav pin)', !!navPinned, '');
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
for (const c of cases) { const tag = c.pass ? 'PASS' : 'FAIL'; if (c.pass) pass++; else fail++; console.log(`${tag}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`); }
console.log(`\ncontainer-pin selftest: ${fail === 0 ? 'ALL PASS' : `${fail} FAILED`} (${pass}/${cases.length} cases)`);
try { for (const f of ['/tmp/__cp-panelL.png', '/tmp/__cp-panelR.png']) fs.unlinkSync(f); } catch {}
process.exit(fail === 0 ? 0 : 1);
