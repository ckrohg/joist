#!/usr/bin/env node
/**
 * @purpose _axisdelta-fixtures-ci.mjs — PHASE 4 PERMANENT CI REGRESSION GATE for the detectors→views migration.
 *
 * The 8 hand-written compare-detectors are RETIRED (their detection code is subsumed by the universal engine +
 * detector-views.mjs). But their INJECTION FIXTURES are NOT thrown away — they are FROZEN here as a permanent CI
 * suite. A floor/weight change in the engine that SILENCES any of these FAILS the gate. This is the contract that
 * lets us delete the detector code while keeping its hard-won truth-table.
 *
 * THE EQUIVALENCE TEST (the migration's load-bearing assertion). For each of the 7 in-scope human defects we
 * carry the detector's OWN broken+clean fixture, run it through the UNIVERSAL ENGINE (axisdelta-engine.mjs), and
 * project through detector-views.mjs. A fixture PASSES iff:
 *    (a) the engine FIRES on the BROKEN fixture, on the RIGHT element (the injected ref), at severity ≥ τ, AND a
 *        mapped VIEW for that defect fires; AND
 *    (b) the engine stays SILENT (no view fires for that defect) on the CLEAN control.
 * We assert (FIRES, RIGHT ELEMENT, severity≥τ) — NOT an identical label. Label DRIFT is OK; DETECTION drift is not.
 *
 * HONEST COVERAGE NOTE (eval-integrity — the builder does NOT paper over a gap). Several detectors keyed off
 * signals the engine SPINE (grade-element-crops.axisDeltas) does NOT carry as a first-class axis:
 *    • #3 missing-emoji  — a dropped ::marker/::before glyph. The spine has no pseudo-glyph axis; the engine sees
 *      the emoji loss only if it perturbs the bearer's text/contrast/bbox. We test the engine on the SAME fixture
 *      and report honestly whether it reproduces it (it fires via a text/presence trip on the li OR it does NOT).
 *    • #4 blockquote-bar — a border-left going away. The spine has no border-width axis. Reported honestly.
 *    • #5 code-chip      — a <code> background going transparent. The spine has no element-background-color axis
 *      (color-deltaE is TEXT color). Tested via presence (unmatched <code>) where applicable; reported honestly.
 * For each such defect the gate records whether the engine reproduces it. The OVERALL ship-gate (in the
 * orchestrator) treats a fixture the engine genuinely cannot reproduce as a KEPT DETECTOR (not a silent pass) —
 * this file's job is to make that fact VISIBLE and FROZEN, never to fake a green.
 *
 * SAFETY: PURE — synthetic ElementRecords + the frozen floors. No network/host/builder/git. Imports
 * axisdelta-engine.mjs + detector-views.mjs UNCHANGED. Reversible.
 *
 *   node _axisdelta-fixtures-ci.mjs            # run the frozen gate (exit 0 = all FROZEN-firing fixtures still fire)
 *   node _axisdelta-fixtures-ci.mjs --json     # machine-readable
 *   node _axisdelta-fixtures-ci.mjs --freeze   # PRINT the current fire/silent profile to paste into FROZEN below
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as E from './axisdelta-engine.mjs';
import * as V from './detector-views.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const has = (k) => process.argv.includes('--' + k);
const FLOORS = E.loadFloors();
const TAU = V.DEFAULT_TAU;

// ── ElementRecord builder (engine shape; box carries xFrac/wFrac so salience reads centrality) ──
function rec(over = {}) {
  const base = { ref: 'body>div|1|h' + Math.random().toString(36).slice(2, 8), srcPath: null, tag: 'div', role: null, text: '', ownText: '',
    box: { 1440: { x: 0, y: 60, w: 200, h: 40, right: 200, xFrac: 0, wFrac: 0.14 }, 390: { x: 0, y: 60, w: 200, h: 40, right: 200 } },
    style: { color: 'rgb(20,20,20)', backgroundColor: 'rgb(255,255,255)', font: { size: '16px', family: 'Inter' }, border: { width: { top: '0px', right: '0px', bottom: '0px', left: '0px' }, style: {}, color: {} }, borderRadius: '0px', zIndex: '0', position: 'static', margin: '0px', padding: '0px' },
    asset: { isImage: false, naturalSrc: null, svgHash: null }, pseudo: {}, states: {} };
  const r = Object.assign(base, over); if (!r.srcPath) r.srcPath = r.ref; return r;
}
// over.unmatched = a Set of source REFS that are deliberately CLONE-MISSING (a presence defect). Those sources
// are NOT positionally matched even if a filler clone record exists at the same index; they go to unmatchedSource.
function mkBlob(srcRecs, cloneRecs, over = {}) {
  const unmatched = over.unmatched instanceof Set ? over.unmatched : new Set(over.unmatched || []);
  const isUnmatched = (s, i) => unmatched.has(s.ref) || !cloneRecs[i];
  return {
    report: Object.assign({ source: 'https://ci.local', clone: 'http://localhost:8001/?page_id=ci', widths: [1440, 390], joinWidth: 1440,
      pageHeightByVw: { source: { 1440: 4000, 390: 6000 }, clone: { 1440: 4000, 390: 6000 } },
      matched: srcRecs.map((s, i) => isUnmatched(s, i) ? null : ({ srcRef: s.ref, cloneRef: cloneRecs[i].ref })).filter(Boolean),
      relation: Object.fromEntries(srcRecs.map((s, i) => [s.srcPath, isUnmatched(s, i) ? [] : [cloneRecs[i].ref]])),
      unmatchedSource: srcRecs.filter((s, i) => isUnmatched(s, i)).map((s) => s.ref) }, over.report || {}),
    sourceCapture: { records: srcRecs, stickySummary: over._srcSticky || [] },
    cloneCapture: { records: cloneRecs, stickySummary: over._cloneSticky || [] },
  };
}
const cp = (o) => JSON.parse(JSON.stringify(o));

// run the engine + views; return { views, events, firesViewOn(name,ref) }
function engineViews(blob) {
  const out = E.runEngine(blob, FLOORS, {});
  const views = V.runViews(out, TAU);
  return { out, views,
    // does ANY mapped view fire AND does it localize to the expected ref (right element)?
    fires(viewNames, expectRef) {
      for (const vn of viewNames) {
        const hits = V.fireView(vn, out, TAU);
        for (const h of hits) {
          const refOk = expectRef == null || String(h.ref).includes(expectRef) || String(expectRef).includes(String(h.ref).split('|')[0]) || h.ref === expectRef;
          if (h.severity >= TAU && refOk) return { fired: true, via: vn, ref: h.ref, severity: h.severity };
        }
      }
      return { fired: false };
    },
    anyViewFires(viewNames) { return viewNames.some((vn) => views[vn] && views[vn].fires); },
  };
}

// ── THE 7 IN-SCOPE HUMAN DEFECT FIXTURES (detector's own broken/clean, re-expressed in the engine record shape) ──
// each: { defect, brokenRef, broken(): blob, clean(): blob, views:[...] (the mapped detector-views) }
function fixtures() {
  const F = [];

  // #6 missing-hr — a source <hr> with no clone counterpart (presence). engine: missing-section view.
  F.push({ defect: '6', name: 'missing-hr', views: ['missing-section'], brokenRef: 'body>main>hr',
    broken: () => mkBlob([rec({ ref: 'body>main>hr|1|hHR', srcPath: 'body>main>hr|1|hHR', tag: 'hr', box: { 1440: { x: 100, y: 300, w: 600, h: 2, right: 700, xFrac: 0.07, wFrac: 0.42 } } })],
      [rec({ ref: 'cx', tag: 'p', text: 'unrelated', box: { 1440: { x: 0, y: 900, w: 600, h: 20, right: 600, xFrac: 0, wFrac: 0.42 } } })], { unmatched: ['body>main>hr|1|hHR'] }),
    clean: () => { const s = rec({ ref: 'body>main>hr|1|hHR', srcPath: 'body>main>hr|1|hHR', tag: 'hr', box: { 1440: { x: 100, y: 300, w: 600, h: 2, right: 700, xFrac: 0.07, wFrac: 0.42 } } }); return mkBlob([s], [Object.assign(cp(s), { ref: 'chr' })]); } });

  // #3 missing-emoji — a list item whose leading emoji glyph is dropped. SPINE has no pseudo-glyph axis; the
  // engine reproduces it ONLY if the glyph loss perturbs text/contrast/bbox. Mapped views: invisible-text / missing-section.
  F.push({ defect: '3', name: 'missing-emoji', views: ['invisible-text', 'missing-section'], brokenRef: 'body>main>ul>li',
    spineGapPossible: true,
    broken: () => { const s = rec({ ref: 'body>main>ul>li|1|hLI', srcPath: 'body>main>ul>li|1|hLI', tag: 'li', role: 'listitem', text: '🤔 how do I read a value', ownText: '🤔 how do I read a value', box: { 1440: { x: 100, y: 200, w: 400, h: 24, right: 500, xFrac: 0.07, wFrac: 0.28 } } });
      const c = rec({ ref: 'cli', tag: 'li', role: 'listitem', text: 'how do I read a value', ownText: 'how do I read a value', box: { 1440: { x: 100, y: 200, w: 380, h: 24, right: 480, xFrac: 0.07, wFrac: 0.26 } } }); return mkBlob([s], [c]); },
    clean: () => { const s = rec({ ref: 'body>main>ul>li|1|hLI', srcPath: 'body>main>ul>li|1|hLI', tag: 'li', role: 'listitem', text: '🤔 how do I read a value', ownText: '🤔 how do I read a value', box: { 1440: { x: 100, y: 200, w: 400, h: 24, right: 500, xFrac: 0.07, wFrac: 0.28 } } }); return mkBlob([s], [Object.assign(cp(s), { ref: 'cli' })]); } });

  // #4 blockquote-bar — left border-bar dropped. SPINE has no border-width axis. Mapped: color-off / wrong-layout.
  F.push({ defect: '4', name: 'blockquote-bar', views: ['color-off', 'wrong-layout'], brokenRef: 'body>main>blockquote',
    spineGapPossible: true,
    broken: () => { const s = rec({ ref: 'body>main>blockquote|1|hBQ', srcPath: 'body>main>blockquote|1|hBQ', tag: 'blockquote', text: 'Unlearn what you have learned',
      style: Object.assign(rec().style, { border: { width: { top: '0px', right: '0px', bottom: '0px', left: '4px' }, style: {}, color: { left: 'rgb(34,34,34)' } } }), box: { 1440: { x: 100, y: 250, w: 600, h: 60, right: 700, xFrac: 0.07, wFrac: 0.42 } } });
      const c = rec({ ref: 'cbq', tag: 'blockquote', text: 'Unlearn what you have learned', box: { 1440: { x: 100, y: 250, w: 600, h: 60, right: 700, xFrac: 0.07, wFrac: 0.42 } } }); return mkBlob([s], [c]); },
    clean: () => { const s = rec({ ref: 'body>main>blockquote|1|hBQ', srcPath: 'body>main>blockquote|1|hBQ', tag: 'blockquote', text: 'Unlearn what you have learned',
      style: Object.assign(rec().style, { border: { width: { top: '0px', right: '0px', bottom: '0px', left: '4px' }, style: {}, color: { left: 'rgb(34,34,34)' } } }), box: { 1440: { x: 100, y: 250, w: 600, h: 60, right: 700, xFrac: 0.07, wFrac: 0.42 } } }); return mkBlob([s], [Object.assign(cp(s), { ref: 'cbq' })]); } });

  // #5 code-chip — an unmatched inline <code> that painted a chip in source (presence). Mapped: missing-section / color-off.
  F.push({ defect: '5', name: 'code-chip', views: ['color-off', 'missing-section'], brokenRef: 'body>main>p>code',
    broken: () => mkBlob([rec({ ref: 'body>main>p>code|1|hCD', srcPath: 'body>main>p>code|1|hCD', tag: 'code', text: 'useEffect',
      style: Object.assign(rec().style, { backgroundColor: 'rgb(255,229,100)', borderRadius: '6px' }), box: { 1440: { x: 120, y: 280, w: 90, h: 24, right: 210, xFrac: 0.083, wFrac: 0.06 } } })],
      [rec({ ref: 'cz', tag: 'p', text: 'unrelated prose', box: { 1440: { x: 0, y: 900, w: 600, h: 20, right: 600, xFrac: 0, wFrac: 0.42 } } })], { unmatched: ['body>main>p>code|1|hCD'] }),
    clean: () => { const s = rec({ ref: 'body>main>p>code|1|hCD', srcPath: 'body>main>p>code|1|hCD', tag: 'code', text: 'useEffect', style: Object.assign(rec().style, { backgroundColor: 'rgb(255,229,100)', borderRadius: '6px' }), box: { 1440: { x: 120, y: 280, w: 90, h: 24, right: 210, xFrac: 0.083, wFrac: 0.06 } } }); return mkBlob([s], [Object.assign(cp(s), { ref: 'cc' })]); } });

  // #7 prose-into-code OR code-colors-lost. 7a: clone box collides with a code block (relational collision).
  F.push({ defect: '7', name: 'prose-into-code / code-colors', views: ['overlapping-sections', 'color-off'], brokenRef: null,
    broken: () => {
      // two source sections disjoint; clone slides one to overlap the code block heavily (collision) — same shape as S4.
      const a = rec({ ref: 'body>main>pre|1|hPR', srcPath: 'body>main>pre|1|hPR', tag: 'pre', role: 'banner', text: 'const x = compute()', style: Object.assign(rec().style, { backgroundColor: 'rgb(35,41,54)', color: 'rgb(214,217,224)' }), box: { 1440: { x: 0, y: 0, w: 700, h: 300, right: 700, xFrac: 0, wFrac: 0.49 } } });
      const b = rec({ ref: 'body>main>div|2|hPB', srcPath: 'body>main>div|2|hPB', tag: 'div', role: 'banner', text: 'body prose paragraph here', box: { 1440: { x: 740, y: 0, w: 700, h: 300, right: 1440, xFrac: 0.51, wFrac: 0.49 } } });
      const ca = cp(a); ca.ref = 'cpa'; const cb = cp(b); cb.ref = 'cpb'; cb.box[1440] = { x: 200, y: 0, w: 700, h: 300, right: 900, xFrac: 0.14, wFrac: 0.49 };
      return mkBlob([a, b], [ca, cb]);
    },
    clean: () => {
      const a = rec({ ref: 'body>main>pre|1|hPR', srcPath: 'body>main>pre|1|hPR', tag: 'pre', role: 'banner', text: 'const x = compute()', style: Object.assign(rec().style, { backgroundColor: 'rgb(35,41,54)', color: 'rgb(214,217,224)' }), box: { 1440: { x: 0, y: 0, w: 700, h: 300, right: 700, xFrac: 0, wFrac: 0.49 } } });
      const b = rec({ ref: 'body>main>div|2|hPB', srcPath: 'body>main>div|2|hPB', tag: 'div', role: 'banner', text: 'body prose paragraph here', box: { 1440: { x: 740, y: 0, w: 700, h: 300, right: 1440, xFrac: 0.51, wFrac: 0.49 } } });
      return mkBlob([a, b], [Object.assign(cp(a), { ref: 'cpa' }), Object.assign(cp(b), { ref: 'cpb' })]);
    } });

  // #1 not-responsive — clone box keeps 1440 width at the narrow viewport → h-overflow at 390. Mapped: overlapping-sections / wrong-layout.
  F.push({ defect: '1', name: 'not-responsive', views: ['overlapping-sections', 'wrong-layout'], brokenRef: 'body>main>section',
    broken: () => { const s = rec({ ref: 'body>main>section|1|hRS', srcPath: 'body>main>section|1|hRS', tag: 'section', role: 'banner', text: 'wide section', box: { 1440: { x: 0, y: 0, w: 1400, h: 200, right: 1400, xFrac: 0, wFrac: 0.97 }, 390: { x: 0, y: 0, w: 360, h: 200, right: 360, xFrac: 0, wFrac: 0.92 } } });
      const c = rec({ ref: 'cs', tag: 'section', role: 'banner', text: 'wide section', box: { 1440: { x: 0, y: 0, w: 1400, h: 200, right: 1400, xFrac: 0, wFrac: 0.97 }, 390: { x: 0, y: 0, w: 1400, h: 200, right: 1400, xFrac: 0, wFrac: 3.6 } } }); return mkBlob([s], [c]); },
    clean: () => { const s = rec({ ref: 'body>main>section|1|hRS', srcPath: 'body>main>section|1|hRS', tag: 'section', role: 'banner', text: 'wide section', box: { 1440: { x: 0, y: 0, w: 1400, h: 200, right: 1400, xFrac: 0, wFrac: 0.97 }, 390: { x: 0, y: 0, w: 360, h: 200, right: 360, xFrac: 0, wFrac: 0.92 } } }); return mkBlob([s], [Object.assign(cp(s), { ref: 'cs' })]); } });

  // #8 wrongly-sticky — clone pins a top-band nav across scroll that source does not. Mapped: wrongly-sticky (the new state axis).
  F.push({ defect: '8', name: 'wrongly-sticky', views: ['wrongly-sticky'], brokenRef: 'state:pin',
    broken: () => { const sNav = rec({ ref: 'body>nav|1|hNV', srcPath: 'body>nav|1|hNV', tag: 'nav', role: 'navigation', text: 'home about', box: { 1440: { x: 0, y: 0, w: 1440, h: 60, right: 1440, xFrac: 0, wFrac: 1 } } });
      const cNav = rec({ ref: 'cnav', tag: 'header', role: 'navigation', text: 'home about', box: { 1440: { x: 0, y: 0, w: 1440, h: 60, right: 1440, xFrac: 0, wFrac: 1 } } });
      return mkBlob([sNav], [cNav], { _srcSticky: [], _cloneSticky: [{ idx: 1, position: 'fixed', top0: 0, topY: 0 }] }); },
    clean: () => { const sNav = rec({ ref: 'body>nav|1|hNV', srcPath: 'body>nav|1|hNV', tag: 'nav', role: 'navigation', text: 'home about', box: { 1440: { x: 0, y: 0, w: 1440, h: 60, right: 1440, xFrac: 0, wFrac: 1 } } });
      const cNav = rec({ ref: 'cnav', tag: 'header', role: 'navigation', text: 'home about', box: { 1440: { x: 0, y: 0, w: 1440, h: 60, right: 1440, xFrac: 0, wFrac: 1 } } });
      return mkBlob([sNav], [cNav], { _srcSticky: [], _cloneSticky: [] }); } });

  return F;
}

// ── FROZEN PROFILE — which of the 7 the engine reproduces (broken fires the mapped view on the right element +
// clean silent). FROZEN at migration time; the CI gate asserts the engine STILL reproduces every FROZEN-true one.
// A floor/weight change that silences any FROZEN-true fixture FAILS. (Generated via --freeze; reviewed by hand.)
export const FROZEN = {
  '6': true,    // missing-hr      → missing-section (presence)               [REPRODUCED]
  '5': true,    // code-chip       → missing-section (unmatched <code> chip)  [REPRODUCED]
  '7': true,    // prose/colors    → overlapping-sections (collision)         [REPRODUCED]
  '1': true,    // not-responsive  → overlapping-sections (h-overflow @390)   [REPRODUCED]
  '8': true,    // wrongly-sticky  → wrongly-sticky (state-pin axis, Phase 4) [REPRODUCED]
  // ── HONEST SPINE GAPS — the engine does NOT reproduce these in ISOLATION; the spine carries no pseudo-glyph
  //    axis (#3) nor border-width axis (#4). On a REAL broken page they co-occur with other trips and the views
  //    DO fire (see the 310 shadow matrix: #3 via invisible-text/missing-section, #4 via color-off/wrong-layout),
  //    so they are NOT retired-blind — but the isolated fixture is a KEPT-DETECTOR, reported not faked-green.
  '3': false,   // missing-emoji   → SPINE GAP (no pseudo-glyph axis); KEPT-DETECTOR
  '4': false,   // blockquote-bar  → SPINE GAP (no border-width axis); KEPT-DETECTOR
};

function run() {
  const F = fixtures();
  const rows = [];
  for (const fx of F) {
    const evBroken = engineViews(fx.broken());
    const evClean = engineViews(fx.clean());
    const fired = evBroken.fires(fx.views, fx.brokenRef);
    const cleanSilent = !evClean.anyViewFires(fx.views);
    const reproduces = fired.fired && cleanSilent;
    rows.push({ defect: fx.defect, name: fx.name, views: fx.views, brokenRef: fx.brokenRef,
      brokenFires: fired.fired, firedVia: fired.via || null, firedRef: fired.ref || null, firedSeverity: fired.severity || 0,
      cleanSilent, reproduces, spineGapPossible: !!fx.spineGapPossible });
  }
  return rows;
}

function main() {
  const rows = run();
  if (has('freeze')) {
    console.log('// paste into FROZEN:');
    for (const r of rows) console.log(`  '${r.defect}': ${r.reproduces},   // ${r.name} fires=${r.brokenFires} via=${r.firedVia} sev=${(r.firedSeverity || 0).toFixed(3)} cleanSilent=${r.cleanSilent}`);
    return;
  }
  console.log('\n==== AXIS-DELTA FIXTURES CI — FROZEN detector-fixture regression gate (7 broken + 7 clean) ====');
  console.log(`engine: eval/grader/axisdelta-engine.mjs  via detector-views.mjs  | τ=${TAU}\n`);
  let failed = 0;
  for (const r of rows) {
    const frozen = FROZEN[r.defect];
    // GATE: a FROZEN-true fixture MUST still reproduce (broken fires right element + clean silent). FROZEN-false
    // fixtures are KEPT-DETECTOR (spine cannot reproduce) and are reported but do not fail the gate.
    const pass = frozen ? r.reproduces : true;
    if (!pass) failed++;
    const tag = !frozen ? 'KEPT-DETECTOR (spine gap, not a regression)' : (r.reproduces ? 'REPRODUCED' : 'REGRESSION!! frozen-true but engine now SILENT');
    console.log(`${pass ? 'PASS' : 'FAIL'}  #${String(r.defect).padEnd(3)} ${r.name.padEnd(26)} broken{fires:${r.brokenFires} via:${(r.firedVia || '-').padEnd(20)} sev:${(r.firedSeverity || 0).toFixed(3)} ref:${String(r.firedRef || '-').slice(0, 24)}} clean{silent:${r.cleanSilent}}  → ${tag}`);
  }
  const reproduced = rows.filter((r) => r.reproduces).length;
  console.log(`\nreproduced by the universal engine: ${reproduced}/${rows.length}`);
  console.log(`FROZEN-true fixtures: ${Object.values(FROZEN).filter(Boolean).length}  | CI gate: ${failed === 0 ? 'PASS — no frozen fixture silenced' : failed + ' REGRESSION(S)'}`);
  if (has('json')) console.log('\n' + JSON.stringify({ harness: 'eval/grader/_axisdelta-fixtures-ci.mjs', tau: TAU, rows, frozen: FROZEN, reproduced, failed }, null, 2));
  process.exit(failed === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
export { run, fixtures };
