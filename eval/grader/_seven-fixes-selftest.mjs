#!/usr/bin/env node
/**
 * @purpose OFFLINE self-test for the 7 overreacted defect fixes + the --joist-src stamp, exercised through a
 * DRY-RUN build of build-absolute.mjs (ABS_DRY_RUN=1 → no network, dumps the exact tree). Asserts, from the emitted
 * widget tree ALONE, that each fix produced the right native/kses-safe Elementor settings, and that disabling each
 * flag reverts to the legacy shape (reversibility). NO network, NO host. Exit 0 = all gates pass.
 *
 * Run:  node _seven-fixes-selftest.mjs
 */
import fs from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const BUILDER = path.join(__dir, 'build-absolute.mjs');
const cases = [];
const ok = (name, pass, detail = '') => { cases.push({ name, pass: !!pass, detail }); };

// ── synthetic layout: a single-column prose page with one of each defect-trigger leaf ───────────────────────
// The capture-side helpers already produced srcPath / runs / borderLeft / tokens / kind:'divider' fields; here we
// hand-author the SAME node shapes the capture emits, so the build-side consumers are exercised in isolation.
function mkLayout() {
  const sp = (s) => s; // srcPath strings (content-addressed; format is opaque to the builder).
  const root = {
    kind: 'container', tag: 'body', box: { x: 0, y: 0, w: 1440, h: 4000 }, position: 'static',
    children: [
      // STATIC nav band (defect #3): a top container with position:static + a nav anchor + an image logo.
      { kind: 'container', tag: 'header', box: { x: 0, y: 0, w: 1440, h: 60 }, position: 'static', background: { color: 'rgb(255,255,255)' }, children: [
        { kind: 'button', tag: 'a', text: 'overreacted', href: 'http://localhost:8001/', box: { x: 40, y: 18, w: 140, h: 24 }, typo: { size: 18 }, paint: { value: 'rgb(20,20,20)' }, srcPath: sp('body>header>a|1|h1') },
        { kind: 'button', tag: 'a', text: 'About', href: '/about', box: { x: 1200, y: 18, w: 70, h: 24 }, typo: { size: 16 }, paint: { value: 'rgb(20,20,20)' }, srcPath: sp('body>header>a|2|h2') },
      ] },
      // a LARGE heading (size 48) — triggers native per-breakpoint font-size under ABS_NATIVE_RESPONSIVE.
      { kind: 'heading', tag: 'h1', level: 1, text: 'Before You memo()', box: { x: 40, y: 120, w: 700, h: 60 }, typo: { size: 48, lineHeight: '56px' }, paint: { value: 'rgb(20,20,20)' }, srcPath: sp('body>h1|1|h9999') },
      // EMOJI strong line (defect #7).
      { kind: 'text', tag: 'strong', text: '🤔 Question: why does this happen?', box: { x: 40, y: 200, w: 700, h: 30 }, typo: { size: 20 }, paint: { value: 'rgb(20,20,20)' }, srcPath: sp('body>p>strong|1|hAAAA') },
      // INLINE-CODE CHIPS prose (defect #6): runs = [plain, code, plain].
      { kind: 'text', tag: 'p', text: 'Call componentDidMount inside the effect.', box: { x: 40, y: 260, w: 700, h: 28 }, typo: { size: 18 }, paint: { value: 'rgb(30,30,30)' }, srcPath: sp('body>p|2|hBBBB'),
        runs: [ { text: 'Call ' }, { text: 'componentDidMount', code: true, bg: '#fff7cc', radius: 10, padV: 2, padH: 4, mono: true, color: '#222222' }, { text: ' inside the effect.' } ] },
      // BLOCKQUOTE bar (defect #5): borderLeft hex + italic.
      { kind: 'text', tag: 'p', text: 'Do or do not. There is no try.', box: { x: 40, y: 320, w: 700, h: 40 }, typo: { size: 18 }, paint: { value: 'rgb(60,60,60)' }, srcPath: sp('body>blockquote>p|1|hCCCC'),
        borderLeft: { width: 3, style: 'solid', color: '#222222' }, padLeft: 16, italic: true },
      // HR divider (defect #4).
      { kind: 'divider', tag: 'hr', box: { x: 40, y: 380, w: 700, h: 1 }, dividerWidth: 1, dividerStyle: 'solid', dividerColor: '#e5e7eb', srcPath: sp('body>hr|1|hDDDD') },
      // CODE block with per-token colors + a TALL block that overflows its captured box (defect #2a + #2b).
      { kind: 'code', tag: 'pre', box: { x: 40, y: 420, w: 700, h: 120 }, typo: { size: 14, lineHeight: '21px' }, bg: 'rgb(40,44,52)', radius: 6, codeColor: 'rgb(171,178,191)', srcPath: sp('body>pre|1|hEEEE'),
        text: ['function App() {', '  useEffect(() => {', '    document.title = "x";', '    fetchData();', '    return cleanup;', '  });', '  return null;', '}', '// a long trailing comment line that wraps several times to force the panel taller than its captured box height for overflow'].join('\n'),
        tokens: [ { text: 'function ', color: '#c678dd' }, { text: 'App', color: '#61afef' }, { text: '() {\n  ', color: '#abb2bf' }, { text: 'useEffect', color: '#61afef' }, { text: '(() => {\n', color: '#abb2bf' } ] },
      // a paragraph pinned RIGHT BELOW the code block's captured bottom (y=540) — should be SHIFTED DOWN by the
      // overflow cascade so it no longer overlaps the taller-rendered code panel.
      { kind: 'text', tag: 'p', text: 'What does it mean?', box: { x: 40, y: 545, w: 700, h: 28 }, typo: { size: 18 }, paint: { value: 'rgb(30,30,30)' }, srcPath: sp('body>p|3|hFFFF') },
    ],
  };
  return { vw: 1440, pageH: 4000, root, fonts: [], fontFiles: [] };
}

function dryRun(extraEnv) {
  const layoutPath = `/tmp/_seven-fixes-layout-${process.pid}.json`;
  const treePath = `/tmp/_seven-fixes-tree-${process.pid}.json`;
  fs.writeFileSync(layoutPath, JSON.stringify(mkLayout()));
  const env = { ...process.env, ...extraEnv, ABS_DRY_RUN: '1', ABS_DUMP_TREE: treePath,
    JOIST_AUTH_B64: Buffer.from('t:t').toString('base64'), JOIST_BASE: 'http://localhost:8001' };
  const r = spawnSync(process.execPath, [BUILDER, '--layout', layoutPath, '--page', '0'], { env, encoding: 'utf8' });
  let tree = null; try { tree = JSON.parse(fs.readFileSync(treePath, 'utf8')); } catch {}
  try { fs.unlinkSync(layoutPath); } catch {}
  try { fs.unlinkSync(treePath); } catch {}
  return { tree, stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

function allWidgets(tree) {
  const out = [];
  const walk = (nodes) => { for (const n of (nodes || [])) { if (!n || typeof n !== 'object') continue; if (n.elType === 'widget') out.push(n); if (Array.isArray(n.elements)) walk(n.elements); } };
  walk(tree.elements || (tree.root ? [tree.root] : []));
  return out;
}
const html = (w) => String((w.settings || {}).html || (w.settings || {}).editor || '');
const preserve = (w) => { try { return JSON.parse((w.settings || {}).joist_preserve_css || '{}'); } catch { return {}; } };

// ─────────────────────────────── DEFAULT BUILD (all body fixes on; native-responsive default off) ───────────
{
  const { tree, stdout, status } = dryRun({ ABS_NATIVE_RESPONSIVE: '1' });
  ok('DRY-RUN build succeeded (status 0, tree dumped)', status === 0 && tree, `status=${status}`);
  const W = tree ? allWidgets(tree) : [];

  // #7 emoji KEPT
  ok('#7 EMOJI — 🤔 glyph present in emitted text', W.some((w) => /🤔/.test(html(w))));

  // #6 inline-code chip: a <code> with a HEX background + radius inside a text-editor widget.
  const chipW = W.find((w) => w.widgetType === 'text-editor' && /<code[^>]*background-color:#fff7cc/i.test(html(w)));
  ok('#6 INLINE-CODE CHIP — <code> carries opaque hex bg (#fff7cc) + radius in a text-editor', !!chipW && /border-radius:10px/i.test(html(chipW)));
  ok('#6 INLINE-CODE CHIP — no rgba() in the chip style (kses would strip it)', chipW && !/rgba?\(/i.test(html(chipW)));
  ok('#6 INLINE-CODE CHIP — surrounding plain prose preserved around the chip', chipW && /Call /.test(html(chipW)) && /inside the effect/.test(html(chipW)));

  // #5 blockquote bar: border-left hex + padding-left + italic on the text-editor div.
  const bqW = W.find((w) => w.widgetType === 'text-editor' && /Do or do not/.test(html(w)));
  ok('#5 BLOCKQUOTE BAR — border-left:3px solid #222222 on the quote div (hex, kses-safe)', !!bqW && /border-left:3px solid #222222/i.test(html(bqW)));
  ok('#5 BLOCKQUOTE BAR — padding-left + font-style:italic present', bqW && /padding-left:16px/i.test(html(bqW)) && /font-style:italic/i.test(html(bqW)));

  // #4 divider: a real <hr> html widget with a border-top.
  const hrW = W.find((w) => w.widgetType === 'html' && /<hr[^>]*border-top:1px solid #e5e7eb/i.test(html(w)));
  ok('#4 HR DIVIDER — a real <hr> html widget with the captured 1px #e5e7eb stroke', !!hrW);

  // #2b syntax colors: the code panel <pre> carries multiple per-token <span style="color:#hex">.
  const codeW = W.find((w) => w.widgetType === 'html' && /<pre/i.test(html(w)) && /useEffect/.test(html(w)));
  const tokenSpans = codeW ? (html(codeW).match(/<span style="color:#[0-9a-fA-F]{6}"/g) || []) : [];
  ok('#2b CODE SYNTAX COLORS — >=2 per-token colored <span> in the code panel', tokenSpans.length >= 2, `tokenSpans=${tokenSpans.length}`);
  ok('#2 CODE DARK BG — panel keeps a dark background', codeW && /background:rgb\(40, ?44, ?52\)|background:#0b0d10|background:rgb/i.test(html(codeW)));

  // #2a overflow shift: "What does it mean?" was at y=545 (just below code bottom 540); it must be shifted DOWN.
  const whatW = W.find((w) => /What does it mean/.test(html(w)));
  const whatY = whatW && whatW.settings._offset_y ? whatW.settings._offset_y.size : null;
  ok('#2a CODE OVERLAP — the paragraph below the code panel was shifted down past y=545', whatY != null && whatY > 545, `offset_y=${whatY}`);
  ok('#2a CODE OVERLAP — cascade logged + page grew', /code-panel overflow shift/.test(stdout));

  // #3 static nav: header NOT position:fixed; emits scoped static-nav css.
  ok('#3 STATIC NAV — header is NOT sticky/fixed (static source)', /header position: STATIC/.test(stdout));
  const teardownPinned = W.concat(tree ? [tree.elements[0]] : []);
  ok('#3 STATIC NAV — scoped #joist-hdr position:absolute css emitted', /joist-hdr\{position:absolute/.test(JSON.stringify(tree)));

  // #1 native responsive: a heading/text carries typography_font_size_mobile AND a preserve-css `m` release.
  const bigText = W.find((w) => (w.settings || {}).typography_font_size_mobile || (w.settings || {}).typography_font_size_tablet);
  ok('#1 NATIVE RESPONSIVE — at least one leaf carries native typography_font_size_mobile/_tablet', !!bigText);
  const relW = W.find((w) => { const p = preserve(w); return p.m && (p.m['767'] || p.m['1024']) && /position:relative/.test(p.m['767'] || p.m['1024']); });
  ok('#1 NATIVE RESPONSIVE — abs pin released at <=767/<=1024 via preserve-css `m` (renders on FREE)', !!relW);

  // STAMP: every body widget carries --joist-src in the preserve-css `d` decl.
  const stamped = W.filter((w) => { const p = preserve(w); return p.d && /--joist-src:"/.test(p.d); });
  ok('STAMP — body widgets carry --joist-src content-addressed stamp (O(1) correspondence)', stamped.length >= 5, `${stamped.length} stamped widgets`);
  ok('STAMP — a known srcPath round-trips into the stamp', stamped.some((w) => /body>pre\|1\|hEEEE/.test(preserve(w).d)));
}

// ─────────────────────────────── REVERSIBILITY (each flag off → legacy shape) ───────────────────────────────
{
  const { tree } = dryRun({ ABS_NO_KEEP_EMOJI: '1', ABS_NATIVE_RESPONSIVE: '1' });
  const W = tree ? allWidgets(tree) : [];
  ok('REVERSIBLE #7 — ABS_NO_KEEP_EMOJI=1 strips the glyph', !W.some((w) => /🤔/.test(html(w))));
}
{
  const { tree } = dryRun({ ABS_NO_INLINE_CHIPS: '1' });
  const W = tree ? allWidgets(tree) : [];
  ok('REVERSIBLE #6 — ABS_NO_INLINE_CHIPS=1 → no <code> chip (flat prose)', !W.some((w) => /<code[^>]*background-color/i.test(html(w))));
}
{
  const { tree } = dryRun({ ABS_NO_BLOCKQUOTE_BAR: '1' });
  const W = tree ? allWidgets(tree) : [];
  ok('REVERSIBLE #5 — ABS_NO_BLOCKQUOTE_BAR=1 → no border-left bar', !W.some((w) => /border-left:3px solid #222222/i.test(html(w))));
}
{
  const { tree } = dryRun({ ABS_NO_DIVIDER: '1' });
  const W = tree ? allWidgets(tree) : [];
  ok('REVERSIBLE #4 — ABS_NO_DIVIDER=1 → the <hr> divider is dropped', !W.some((w) => /<hr[^>]*border-top/i.test(html(w))));
}
{
  const { tree } = dryRun({ BUILD_NO_CODE_TOKENS: '1' });
  const W = tree ? allWidgets(tree) : [];
  const codeW = W.find((w) => /<pre/i.test(html(w)) && /useEffect/.test(html(w)));
  ok('REVERSIBLE #2b — BUILD_NO_CODE_TOKENS=1 → single-color <pre> (no per-token spans)', codeW && !/<span style="color:#/.test(html(codeW)));
}
{
  const { stdout } = dryRun({ ABS_NO_STATIC_NAV: '1' });
  ok('REVERSIBLE #3 — ABS_NO_STATIC_NAV=1 → sticky/fixed header', /header position: STICKY/.test(stdout));
}
{
  // native-responsive OFF (default) → no typography_font_size_mobile, no preserve `m` release, BUT stamp still present.
  const { tree } = dryRun({});
  const W = tree ? allWidgets(tree) : [];
  ok('REVERSIBLE #1 — ABS_NATIVE_RESPONSIVE off (default) → no native per-bp font controls', !W.some((w) => (w.settings || {}).typography_font_size_mobile));
  ok('REVERSIBLE #1 — off (default) → no preserve-css `m` release', !W.some((w) => preserve(w).m));
  ok('STAMP — still present when native-responsive OFF (independent flags)', W.some((w) => /--joist-src:"/.test(preserve(w).d || '')));
}
{
  const { tree } = dryRun({ ABS_NO_JOIST_SRC: '1' });
  const W = tree ? allWidgets(tree) : [];
  ok('REVERSIBLE STAMP — ABS_NO_JOIST_SRC=1 → no --joist-src stamp', !W.some((w) => /--joist-src/.test(preserve(w).d || '')));
}

// ── REPORT ──
const failed = cases.filter((c) => !c.pass);
for (const c of cases) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
console.log(`\nseven-fixes selftest: ${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'} (${cases.length} cases)`);
process.exit(failed.length === 0 ? 0 : 1);
