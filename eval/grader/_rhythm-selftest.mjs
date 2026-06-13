#!/usr/bin/env node
/**
 * @purpose _rhythm-selftest.mjs — per-construct assertions for the vertical-rhythm normalizer in
 * transpile-html.mjs (deriveSourceBands, alignSections, applyRhythm). Synthetic fixtures only (no network,
 * no chromium): a COMPRESSED page (zero-bottom-pad sections shorter than source → must grow), an ALREADY-1:1
 * page (must no-op), bad-match / guard cases, and the TRANSPILE_NO_RHYTHM kill switch. Run: node _rhythm-selftest.mjs
 */
import { deriveSourceBands, alignSections, applyRhythm } from './transpile-html.mjs';

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };

// ── deriveSourceBands: noisy hierarchical sections → clean non-overlapping cover ──
{
  const pageH = 5000;
  const sections = [
    { x: 0, y: 0, w: 1440, h: 5000, locator: 'body' },          // page wrapper → dropped
    { x: 0, y: 0, w: 1440, h: 4900, locator: 'main' },          // near-page wrapper → dropped (>=0.92*pageH)
    { x: 48, y: 100, w: 1344, h: 800, locator: 's1' },          // band 1
    { x: 48, y: 250, w: 1344, h: 300, locator: 's1-child' },    // nested in band1 → covered out
    { x: 48, y: 950, w: 1344, h: 700, locator: 's2' },          // band 2
    { x: 48, y: 1700, w: 1344, h: 600, locator: 's3' },         // band 3
    { x: 0, y: 4600, w: 1440, h: 380, locator: 'footer' },      // full-width footer band
  ];
  const bands = deriveSourceBands(sections, pageH);
  ok(bands.length === 4, `deriveSourceBands: 4 clean bands from noisy list (got ${bands.length})`);
  ok(bands[0].h === 800 && bands[1].h === 700 && bands[2].h === 600 && bands[3].h === 380, 'deriveSourceBands: heights in order [800,700,600,380]');
  // monotonic non-overlap
  let mono = true; for (let i = 1; i < bands.length; i++) if (bands[i].y < bands[i - 1].y + bands[i - 1].h - 12) mono = false;
  ok(mono, 'deriveSourceBands: bands are non-overlapping top-to-bottom');
  ok(deriveSourceBands([], 5000).length === 0, 'deriveSourceBands: empty sections → []');
  ok(deriveSourceBands(sections, 0).length === 0, 'deriveSourceBands: pageH=0 → []');
}

// ── alignSections: skips an absent source band (count mismatch) ──
{
  // 4 authored sections; source has only 3 bands (the 2nd authored has no source match).
  const authPageH = 4000; const srcPageH = 4000;
  const A = [ { y: 0, h: 1000 }, { y: 1000, h: 500 }, { y: 1500, h: 1200 }, { y: 2700, h: 1300 } ];
  const B = [ { y: 0, h: 1000 }, { y: 1500, h: 1200 }, { y: 2700, h: 1300 } ];
  const match = alignSections(A, B, authPageH, srcPageH);
  ok(match[0] === 0 && match[2] === 1 && match[3] === 2, `alignSections: monotonic match [0,_,1,2] (got ${JSON.stringify(match)})`);
  ok(match[1] === -1, 'alignSections: the section with no source band is unmatched (-1)');
}

// ── applyRhythm: COMPRESSED page grows the short matched sections via bottom padding ──
function fixtureSpec(children) { return { children: children.map((c) => ({ tag: c.tag, cls: c.cls || '', rect: { x: 0, y: c.y, w: 1440, h: c.h } })) }; }
function fixtureRoot(children) {
  return { elType: 'container', settings: { content_width: 'full' }, elements: children.map((c) => ({
    elType: 'container',
    settings: { content_width: 'full', ...(c.pad ? { padding: { unit: 'px', top: String(c.pad[0]), right: String(c.pad[1]), bottom: String(c.pad[2]), left: String(c.pad[3]), isLinked: false } } : {}) },
    elements: [],
  })) };
}
{
  // authored: hero(1000), feat-short(800,pad[140,48,0,48]), footer(380). Source: hero(1000), feat(1100), footer(380).
  const children = [
    { tag: 'section', cls: 'hero', y: 0, h: 1000, pad: [0, 0, 0, 0] },
    { tag: 'section', cls: 'feat', y: 1000, h: 800, pad: [140, 48, 0, 48] },
    { tag: 'footer', cls: 'foot', y: 1800, h: 380, pad: [64, 48, 80, 48] },
  ];
  const spec = fixtureSpec(children); const root = fixtureRoot(children);
  const cap = { perWidth: { 1440: { pageH: 2480, sections: [
    { x: 0, y: 0, w: 1440, h: 2480, locator: 'body' },
    { x: 48, y: 0, w: 1344, h: 1000, locator: 'hero' },
    { x: 48, y: 1000, w: 1344, h: 1100, locator: 'feat' },
    { x: 0, y: 2100, w: 1440, h: 380, locator: 'footer' },
  ] } } };
  const rep = applyRhythm(root, spec, cap, { width: 1440 });
  ok(rep.applied === true, 'applyRhythm: compressed page → applied');
  const featPad = root.elements[1].settings.padding;
  ok(featPad && featPad.bottom === '300', `applyRhythm: feat bottom-pad 0→300 (deficit 1100-800; got ${featPad && featPad.bottom})`);
  ok(featPad.top === '140', 'applyRhythm: feat TOP padding preserved (140)');
  ok(root.elements[0].settings.padding === undefined || (parseInt(root.elements[0].settings.padding.bottom, 10) || 0) === 0, 'applyRhythm: hero (already at source height) untouched');
  ok(root.elements[2].settings.padding.bottom === '80', 'applyRhythm: footer (matched, no deficit) untouched');
  ok(rep.recoveredPx === 300, `applyRhythm: recoveredPx=300 (got ${rep.recoveredPx})`);
}

// ── applyRhythm: ALREADY-1:1 page is a NO-OP (the clerk invariant) ──
{
  const children = [
    { tag: 'section', cls: 'a', y: 0, h: 1000, pad: [0, 0, 0, 0] },
    { tag: 'section', cls: 'b', y: 1000, h: 1100, pad: [80, 48, 80, 48] },
    { tag: 'footer', cls: 'foot', y: 2100, h: 400, pad: [64, 48, 80, 48] },
  ];
  const spec = fixtureSpec(children); const root = fixtureRoot(children);
  const cap = { perWidth: { 1440: { pageH: 2500, sections: [
    { x: 0, y: 0, w: 1440, h: 2500, locator: 'body' },
    { x: 48, y: 0, w: 1344, h: 1000, locator: 'a' },
    { x: 48, y: 1000, w: 1344, h: 1100, locator: 'b' },
    { x: 0, y: 2100, w: 1440, h: 400, locator: 'footer' },
  ] } } };
  const before = JSON.stringify(root);
  const rep = applyRhythm(root, spec, cap, { width: 1440 });
  ok(rep.applied === false && rep.recoveredPx === 0, 'applyRhythm: already-1:1 page → no-op (recoveredPx 0)');
  ok(JSON.stringify(root) === before, 'applyRhythm: tree byte-identical after no-op');
}

// ── applyRhythm: bad-match growth guard (never grow > 60% of own height) ──
{
  const children = [{ tag: 'section', cls: 'tiny', y: 0, h: 100, pad: [0, 0, 0, 0] }, { tag: 'footer', cls: 'f', y: 100, h: 400, pad: [0, 0, 0, 0] }];
  const spec = fixtureSpec(children); const root = fixtureRoot(children);
  const cap = { perWidth: { 1440: { pageH: 2000, sections: [
    { x: 0, y: 0, w: 1440, h: 2000, locator: 'body' },
    { x: 48, y: 0, w: 1344, h: 1600, locator: 'tiny-matches-huge' }, // 1600 vs 100 → deficit 1500, but cap at 60%
    { x: 0, y: 1600, w: 1440, h: 400, locator: 'footer' },
  ] } } };
  const rep = applyRhythm(root, spec, cap, { width: 1440 });
  const tinyAdd = rep.sections[0].addBottomPad;
  ok(tinyAdd <= 60, `applyRhythm: tiny section growth capped at 60% of own height (100→max+60; got +${tinyAdd})`);
}

// ── applyRhythm: kill switch + missing inputs ──
{
  const children = [{ tag: 'section', cls: 'feat', y: 0, h: 800, pad: [140, 48, 0, 48] }, { tag: 'footer', cls: 'f', y: 800, h: 380, pad: [0, 0, 0, 0] }];
  const cap = { perWidth: { 1440: { pageH: 1480, sections: [
    { x: 0, y: 0, w: 1440, h: 1480, locator: 'body' },
    { x: 48, y: 0, w: 1344, h: 1100, locator: 'feat' },
    { x: 0, y: 1100, w: 1440, h: 380, locator: 'footer' },
  ] } } };
  process.env.TRANSPILE_NO_RHYTHM = '1';
  const root1 = fixtureRoot(children);
  const rep1 = applyRhythm(root1, fixtureSpec(children), cap, { width: 1440 });
  ok(rep1.applied === false && /disabled/.test(rep1.reason), 'applyRhythm: TRANSPILE_NO_RHYTHM=1 → disabled no-op');
  ok(root1.elements[0].settings.padding.bottom === '0', 'applyRhythm: disabled → padding untouched');
  delete process.env.TRANSPILE_NO_RHYTHM;
  const rep2 = applyRhythm(fixtureRoot(children), fixtureSpec(children), null, { width: 1440 });
  ok(rep2.applied === false, 'applyRhythm: null manifest → no-op');
  const rep3 = applyRhythm(fixtureRoot(children), fixtureSpec(children), { perWidth: {} }, { width: 1440 });
  ok(rep3.applied === false && /no source bands/.test(rep3.reason), 'applyRhythm: empty perWidth → no-op with reason');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
