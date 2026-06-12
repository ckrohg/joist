#!/usr/bin/env node
/**
 * @purpose Selftest for transpile-html.mjs (HTML-first pipeline v1) — per-construct assertions covering the
 * full §8c spike pain list on the synthetic fixture (fixtures/transpile-painlist.html) plus a regression
 * check on the proven clerk-hero spike fixture (fixtures/clerk-hero-spike.html, page 24647 lineage):
 *   P1 button icons (trailing/leading glyph → selected_icon, empty round box → fa-circle, lettered span merged+PAIN)
 *   P2 clamp()/calc()/max() frozen to computed px at the authoring width
 *   P3 breakpoint policy (custom>1024 → tablet controls + scoped custom_css @media; <=1024 native-only for
 *      mapped decls; display:none@600 → hide_mobile; inherited text-align → align_tablet; min-width → PAIN)
 *   P4 e-con row-child px pin (+buffer, _flex_shrink:0)
 *   P5 margin-auto heuristics (row → space-between, column both-auto → align center, boxed wrapper)
 *   P6 assets manifest (pre-uploaded url used verbatim; local file pending in dry-run; unmanifested → PAIN
 *      hotlink; inline svg → html-widget fallback in dry-run)
 *   + local schema validation (positive + injected-defect negative) and byte-determinism across runs.
 * Run: node _transpile-selftest.mjs   (offline — dry-run only, no WP, no uploads)
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { validateTree, ICON_GLYPHS } from './transpile-html.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const outA = '/tmp/transpile-selftest/a';
const outB = '/tmp/transpile-selftest/b';
const outHero = '/tmp/transpile-selftest/hero';
fs.rmSync('/tmp/transpile-selftest', { recursive: true, force: true });

let passed = 0; let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

const run = (html, out, assets) => {
  const args = [path.join(dir, 'transpile-html.mjs'), '--html', path.join(dir, html), '--dry-run', '--out', out];
  if (assets) args.push('--assets', path.join(dir, assets));
  execFileSync('node', args, { stdio: 'pipe' });
  return {
    tree: JSON.parse(fs.readFileSync(path.join(out, 'tree.json'), 'utf8')),
    report: JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')),
  };
};
const flat = (tree) => { const out = []; (function w(e) { for (const el of e) { out.push(el); w(el.elements || []); } })(tree); return out; };
const widgets = (tree, type) => flat(tree).filter((e) => e.widgetType === type);
const byText = (tree, type, re) => widgets(tree, type).find((w) => re.test(w.settings.text || w.settings.title || w.settings.editor || ''));

console.log('— painlist fixture (dry-run) —');
const { tree, report } = run('fixtures/transpile-painlist.html', outA, 'fixtures/transpile-painlist.assets.json');

// P1: button icons
{
  const b1 = byText(tree, 'button', /^Start building$/);
  check('P1 trailing glyph → selected_icon', b1 && b1.settings.selected_icon?.value === 'fas fa-caret-right' && b1.settings.selected_icon?.library === 'fa-solid');
  check('P1 trailing glyph → icon_align right', b1 && b1.settings.icon_align === 'right');
  check('P1 icon_indent from button gap', b1 && b1.settings.icon_indent?.size === 10 && b1.settings.icon_indent?.unit === 'px');
  check('P1 glyph stripped from text', b1 && !/[▸▸]/.test(b1.settings.text));
  const b2 = byText(tree, 'button', /^Leading icon$/);
  check('P1 leading glyph → icon_align left', b2 && b2.settings.selected_icon?.value === 'fas fa-check' && b2.settings.icon_align === 'left');
  const b3 = byText(tree, 'button', /Continue with GitHub/);
  check('P1 empty round bg span → fa-circle', b3 && b3.settings.selected_icon?.value === 'fas fa-circle' && b3.settings.icon_align === 'left');
  const b4 = byText(tree, 'button', /Continue with Google/);
  check('P1 lettered span merged into text', b4 && /^G Continue with Google$/.test(b4.settings.text) && !b4.settings.selected_icon);
  check('P1 lettered-span merge PAIN logged', report.pain.some((p) => /P1 button span: styled inline span "G"/.test(p)));
  check('P1 glyph map sanity', ICON_GLYPHS['▸'] === 'fa-caret-right' && ICON_GLYPHS['▾'] === 'fa-caret-down');
}

// P2: CSS math frozen at authoring width
{
  const mathy = flat(tree).filter((e) => e.elType === 'container').find((c) => c.settings.min_height?.size === 130);
  check('P2 clamp() min-height → computed px (130 @1440)', !!mathy, 'no container with min_height 130');
  check('P2 max(calc) padding-left → computed px (112)', mathy && mathy.settings.padding?.left === '112');
  check('P2 policy lines logged', report.policy.some((p) => /P2 computed-value: min-height "clamp/.test(p)) && report.policy.some((p) => /P2 computed-value: padding-left "max\(/.test(p)));
}

// P3: breakpoint policy
{
  const row2 = flat(tree).filter((e) => e.elType === 'container').find((c) => /flex-direction:column/.test(c.settings.custom_css || ''));
  check('P3 custom bp (1180) → native tablet controls', row2 && row2.settings.flex_direction_tablet === 'column' && row2.settings.flex_align_items_tablet === 'center');
  check('P3 custom bp (1180) → scoped custom_css @media at exact width', row2 && /@media \(max-width:1180px\)\{selector\{/.test(row2.settings.custom_css) && /!important/.test(row2.settings.custom_css));
  const bar = flat(tree).filter((e) => e.elType === 'container').find((c) => c.settings.flex_justify_content_tablet === 'center');
  check('P3 standard bp (1024) → native control only', bar && !(bar.settings.custom_css || '').includes('1024'));
  const signin = byText(tree, 'text-editor', /Sign in/);
  check('P3 display:none @600 → hide_mobile', signin && signin.settings.hide_mobile === 'hidden-phone');
  const h2 = byText(tree, 'heading', /Two column row/);
  check('P3 inherited text-align → align_tablet on leaf widgets', h2 && h2.settings.align_tablet === 'center' && /text-align:center !important/.test(h2.settings.custom_css || ''));
  check('P3 min-width query → PAIN', report.pain.some((p) => /min-width media query skipped/.test(p)));
}

// P4: e-con row children pinned
{
  const pins = flat(tree).filter((e) => e.elType === 'container' && e.settings._flex_shrink === 0 && e.settings._flex_size === 'custom' && e.settings.width?.unit === 'px');
  check('P4 row children pinned px + _flex_shrink:0', pins.length >= 2, `found ${pins.length}`);
}

// P5: margin-auto heuristics + boxed wrapper
{
  const bar = flat(tree).filter((e) => e.elType === 'container').find((c) => c.settings.flex_justify_content === 'space-between');
  check('P5 margin-left:auto in row → space-between', !!bar);
  const stack = flat(tree).filter((e) => e.elType === 'container').find((c) => c.settings.flex_direction === 'column' && c.settings.flex_align_items === 'center' && (c.elements || []).some((k) => k.settings?.width?.size === 300));
  check('P5 margin auto both sides in column → align center', !!stack);
  const boxed = flat(tree).filter((e) => e.elType === 'container').find((c) => c.settings.content_width === 'boxed');
  check('P5 boxed wrapper (max-width+auto margins) → boxed_width = max-width − pad', boxed && boxed.settings.boxed_width?.size === 1160);
}

// P6: imagery via assets manifest
{
  const imgs = widgets(tree, 'image');
  check('P6 three image widgets emitted', imgs.length === 3, `found ${imgs.length}`);
  const hosted = imgs.find((i) => i.settings.image.url.includes('already-hosted'));
  check('P6 pre-uploaded manifest entry used verbatim (url+id, no upload)', hosted && hosted.settings.image.id === 424242);
  const pending = imgs.find((i) => /swatch\.png$/.test(i.settings.image.url));
  check('P6 local manifest file → dry-run pending (file:// + policy)', pending && pending.settings.image.url.startsWith('file://') && report.policy.some((p) => /upload pending/.test(p)));
  check('P6 image width from attr/declared (48px)', pending && pending.settings.image_size === 'full' && pending.settings.width?.size === 48);
  check('P6 unmanifested img → hotlink + PAIN', imgs.some((i) => /missing-asset/.test(i.settings.image.url)) && report.pain.some((p) => /P6 image "missing-asset.png"/.test(p)));
  const html = widgets(tree, 'html');
  check('P6 inline svg → html-widget fallback (dry-run)', html.length === 1 && /^<svg /.test(html[0].settings.html) && report.policy.some((p) => /P6 inline svg .*html-widget fallback/.test(p)));
}

// schema validation: positive + injected defects
{
  check('validation: fixture tree passes local checks', report.validation.localErrors.length === 0, JSON.stringify(report.validation.localErrors));
  check('validation: unknown widgetType rejected', validateTree([{ elType: 'widget', widgetType: 'shortcode', settings: {} }]).length > 0);
  check('validation: bad dims shape rejected', validateTree([{ elType: 'widget', widgetType: 'heading', settings: { title: 'x', padding: { unit: 'px', top: 3 } } }]).length > 0);
  check('validation: bad color rejected', validateTree([{ elType: 'widget', widgetType: 'heading', settings: { title: 'x', title_color: 'reddish' } }]).length > 0);
  check('validation: image without url rejected', validateTree([{ elType: 'widget', widgetType: 'image', settings: { image: {} } }]).length > 0);
  check('validation: container without elements rejected', validateTree([{ elType: 'container', settings: {} }]).length > 0);
  check('validation: NaN size rejected', validateTree([{ elType: 'widget', widgetType: 'heading', settings: { title: 'x', width: { unit: 'px', size: NaN } } }]).length > 0);
}

// determinism: byte-identical re-run
{
  run('fixtures/transpile-painlist.html', outB, 'fixtures/transpile-painlist.assets.json');
  const a = fs.readFileSync(path.join(outA, 'tree.json'), 'utf8');
  const b = fs.readFileSync(path.join(outB, 'tree.json'), 'utf8');
  check('determinism: same input → byte-identical tree', a === b);
}

// clerk-hero spike regression (the PROVEN page-24647 lineage)
console.log('— clerk-hero spike fixture (dry-run regression) —');
{
  const { tree: hero, report: heroReport } = run('fixtures/clerk-hero-spike.html', outHero);
  check('hero: spike widget counts preserved (28/3/20/5 native)', JSON.stringify(heroReport.counts) === JSON.stringify({ container: 28, heading: 3, 'text-editor': 20, button: 5, image: 0, html: 0 }), JSON.stringify(heroReport.counts));
  const iconButtons = widgets(hero, 'button').filter((b) => b.settings.selected_icon);
  check('hero: >=3 buttons gained native icons (was 5x flatten PAIN)', iconButtons.length >= 3, `found ${iconButtons.length}`);
  check('hero: no arrow/chevron flatten PAIN remains', !heroReport.pain.some((p) => /flattened to plain text/.test(p)));
  const compRow = flat(hero).filter((e) => e.elType === 'container').find((c) => c.settings.flex_direction_tablet === 'column' && c.settings.flex_align_items_tablet === 'center');
  check('hero: components row stacks via generic P3 (was manual spike hack)', !!compRow && /@media \(max-width:1180px\)/.test(compRow.settings.custom_css || ''));
  check('hero: local validation passes', heroReport.validation.localErrors.length === 0);
  check('hero: boxed wrap generalized (1232 boxed width)', flat(hero).some((e) => e.elType === 'container' && e.settings.boxed_width?.size === 1232));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
