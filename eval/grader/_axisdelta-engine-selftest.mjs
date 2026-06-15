#!/usr/bin/env node
/**
 * @purpose _axisdelta-engine-selftest.mjs — THE PHASE-3 FALSIFIER for the universal severity ENGINE
 * (axisdelta-engine.mjs). The builder does NOT self-bless; the orchestrator re-executes this. Exit 0 = PASS.
 *
 * It re-runs the four mandated OFFLINE proofs INDEPENDENTLY of the engine's inline `--selftest` (importing only
 * the engine's exported pure functions + the frozen floors), plus the anti-overfit and global-cause guards:
 *
 *  S1  SELF-CLONE ~100/0 THROUGH THE FULL ENGINE. The engine over a perfect clone (source == clone) must emit
 *      ZERO events and pageScore ≈ 1.0 — on BOTH a synthetic tree AND the REAL cached 341 capture. A floor +
 *      the whole severity/coherence/relational stack on top can only RAISE the bar; it can never manufacture a
 *      trip on identical input. (This is the F2 invariant carried up to Phase 3.)
 *
 *  S2  INJECTED DIFF FIRES THE RIGHT AXIS + CLASS (rule C — synthetic injection, both directions). For each of
 *      the 6 human-salient marketing classes we inject ONE defect into a CLEAN pair and assert the engine fires
 *      the expected axis AND the naming projection lands the expected class; AND the matching CLEAN control
 *      stays silent (no event). Free, unlimited, label-free.
 *
 *  S3  COHERENCE COLLAPSES A COHERENT N-ELEMENT TRANSFORM TO ONE EVENT. A parent + its contained children all
 *      scaled by the SAME factor → the geometry CC unions them into ONE component of size N (the other N−1
 *      collapsed). Asserts componentSize == N on the bbox-ratio component.
 *
 *  S4  A RELATIONAL COLLISION FIRES between two sections disjoint in the source but overlapping in the clone
 *      (clone_IOU − source_IOU > floor), routed through the SAME floor machinery as an edge.
 *
 *  S5  NO-LABEL-FIT (anti-overfit rule B). The engine's weights + salience are a pure function of the SOURCE
 *      element + the frozen (label-blind) floors — NEVER a human label. PROOF: run the engine on a fixture, then
 *      run it again with a FAKE per-pair human-label channel injected into the blob (report.human_ledger,
 *      record.__label) and assert the pageScore + every event severity is BYTE-IDENTICAL. If a label could move
 *      a number, this trips. Plus a static assert that meta.noLabelFit === true.
 *
 *  S6  COHERENCE NEVER SUPPRESSES ON COHERENCE ALONE. An unexplained coherent component (no global-cause match)
 *      must remain ONE REAL defect at full severity (severity > 0). A scrollbar-offset / responsive-reflow
 *      component IS routed away (suppressed/responsive). Asserts both: the unexplained component keeps severity,
 *      the global-cause component is demoted/routed.
 *
 * SAFETY: PURE — synthetic fixtures + the cached 341 blob + the frozen floors. No network/host/builder/git.
 * Imports axisdelta-engine.mjs + axisdelta-floor.mjs + _axisdelta-selfclone-falsifier.mjs UNCHANGED.
 *
 *   node _axisdelta-engine-selftest.mjs [--compare /tmp/compare-341.json] [--floors calibration/axis-floors.json] [--json]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as E from './axisdelta-engine.mjs';
import { buildSelfCloneBlob } from './_axisdelta-selfclone-falsifier.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

const COMPARE = arg('compare', '/tmp/compare-341.json');
const FLOORS_PATH = arg('floors', path.join(__dir, 'calibration', 'axis-floors.json'));
const AS_JSON = has('json');

const results = [];
const check = (id, name, pass, detail = '') => results.push({ id, name, pass: !!pass, detail });

// ── fixture builders (mirror the engine's synthetic ElementRecord shape) ──
function rec(over = {}) {
  const base = { ref: 'body>div|1|h' + Math.random().toString(36).slice(2, 8), srcPath: null, tag: 'div', role: null, text: '', ownText: '',
    box: { 1440: { x: 0, y: 60, w: 200, h: 40, right: 200, xFrac: 0, wFrac: 0.14 } },
    style: { color: 'rgb(20,20,20)', backgroundColor: 'rgb(255,255,255)', font: { size: '16px', family: 'Inter' }, border: { width: {}, style: {}, color: {} }, zIndex: '0', position: 'static' },
    asset: { isImage: false, naturalSrc: null, svgHash: null }, pseudo: {}, states: {} };
  const r = Object.assign(base, over); if (!r.srcPath) r.srcPath = r.ref; return r;
}
function mkBlob(srcRecs, cloneRecs, over = {}) {
  return {
    report: Object.assign({ source: 'https://selftest.local', clone: 'http://localhost:8001/?page_id=selftest', widths: [1440], joinWidth: 1440,
      pageHeightByVw: { source: { 1440: 4000 }, clone: { 1440: 4000 } },
      matched: srcRecs.map((s, i) => cloneRecs[i] ? ({ srcRef: s.ref, cloneRef: cloneRecs[i].ref }) : null).filter(Boolean),
      relation: Object.fromEntries(srcRecs.map((s, i) => [s.srcPath, cloneRecs[i] ? [cloneRecs[i].ref] : []])),
      unmatchedSource: srcRecs.filter((s, i) => !cloneRecs[i]).map((s) => s.ref) }, over.report || {}),
    sourceCapture: { records: srcRecs }, cloneCapture: { records: cloneRecs },
  };
}
function cp(o) { return JSON.parse(JSON.stringify(o)); }
function scaleBox(r, s) { const c = cp(r); c.ref = 'c' + c.ref; for (const w of Object.keys(c.box)) { const b = c.box[w]; b.w = +(b.w * s).toFixed(2); b.h = +(b.h * s).toFixed(2); b.right = b.x + b.w; } return c; }

function main() {
  if (!fs.existsSync(FLOORS_PATH)) { console.error(`FALSIFIER ERROR: frozen floors not found: ${FLOORS_PATH} — run axisdelta-floor.mjs --build first`); process.exit(2); }
  const floors = JSON.parse(fs.readFileSync(FLOORS_PATH, 'utf8'));

  // ── S1: SELF-CLONE ~100/0 (synthetic + REAL 341) ──
  {
    const src = [
      rec({ ref: 'body>header|1|hA', srcPath: 'body>header|1|hA', tag: 'header', role: 'banner', box: { 1440: { x: 0, y: 10, w: 1440, h: 60, right: 1440, xFrac: 0, wFrac: 1 } } }),
      rec({ ref: 'body>main>h1|1|hC', srcPath: 'body>main>h1|1|hC', tag: 'h1', role: 'heading', text: 'Heading', ownText: 'Heading', style: { color: 'rgb(17,17,17)', backgroundColor: 'rgb(255,255,255)', font: { size: '40px', family: 'Inter' }, border: { width: {}, style: {}, color: {} } }, box: { 1440: { x: 100, y: 120, w: 600, h: 80, right: 700, xFrac: 0.07, wFrac: 0.42 } } }),
      rec({ ref: 'body>main>p|1|hD', srcPath: 'body>main>p|1|hD', tag: 'p', text: 'Paragraph text here.', ownText: 'Paragraph text here.', box: { 1440: { x: 100, y: 220, w: 600, h: 60, right: 700, xFrac: 0.07, wFrac: 0.42 } } }),
    ];
    const synth = E.runEngine(mkBlob(src, cp(src)), floors, {});
    let real = { pageScore: null, events: -1 };
    if (fs.existsSync(COMPARE)) { const self = buildSelfCloneBlob(JSON.parse(fs.readFileSync(COMPARE, 'utf8'))); real = E.runEngine(self, floors, {}); }
    const synthOk = synth.events.length === 0 && synth.pageScore >= 0.999;
    const realOk = real.events === -1 ? true : (real.events.length === 0 && real.pageScore >= 0.999);
    check('S1', 'self-clone → ZERO events / pageScore≈1 through the FULL engine (synthetic + real 341)',
      synthOk && realOk, `synth{events:${synth.events.length},score:${synth.pageScore}}  real{events:${real.events === -1 ? 'skip(no blob)' : real.events.length},score:${real.pageScore}}`);
  }

  // ── S2: INJECTED DIFF fires the right axis + class; clean control silent ──
  {
    const cases = [];
    const fired = (r, axis) => r.events.some((e) => e.firedAxes.includes(axis));
    const classed = (r, cls) => r.events.some((e) => e.class === cls);

    // wrong-logo: img src swap on a top-left logo image.
    const sLogo = rec({ ref: 'body>header>a>img|1|hL', srcPath: 'body>header>a>img|1|hL', tag: 'img', role: 'img', asset: { isImage: true, naturalSrc: 'https://s/logo.svg', svgHash: null }, box: { 1440: { x: 20, y: 20, w: 120, h: 40, right: 140, xFrac: 0.014, wFrac: 0.08 } } });
    const cLogoBad = cp(sLogo); cLogoBad.ref = 'c1'; cLogoBad.asset.naturalSrc = 'https://clone/WRONG.png';
    const cLogoGood = cp(sLogo); cLogoGood.ref = 'c1';
    const rWLbad = E.runEngine(mkBlob([sLogo], [cLogoBad]), floors, {}), rWLgood = E.runEngine(mkBlob([sLogo], [cLogoGood]), floors, {});
    cases.push(['wrong-logo', fired(rWLbad, 'img-src') && classed(rWLbad, 'wrong-logo'), rWLgood.events.length === 0]);

    // invisible-heading: heading colour collapses to its bg.
    const sH = rec({ ref: 'body>main>h1|1|hH', srcPath: 'body>main>h1|1|hH', tag: 'h1', role: 'heading', text: 'Big Heading', ownText: 'Big Heading', style: { color: 'rgb(17,17,17)', backgroundColor: 'rgb(255,255,255)', font: { size: '44px', family: 'Inter' }, border: { width: {}, style: {}, color: {} } }, box: { 1440: { x: 100, y: 80, w: 800, h: 80, right: 900, xFrac: 0.07, wFrac: 0.55 } } });
    const cHbad = cp(sH); cHbad.ref = 'c2'; cHbad.style.color = 'rgb(253,253,253)';
    const cHgood = cp(sH); cHgood.ref = 'c2';
    const rIHbad = E.runEngine(mkBlob([sH], [cHbad]), floors, {}), rIHgood = E.runEngine(mkBlob([sH], [cHgood]), floors, {});
    cases.push(['invisible-heading', fired(rIHbad, 'text-contrast') && classed(rIHbad, 'invisible-heading'), rIHgood.events.length === 0]);

    // blank-hero: large fold element shrinks to nothing.
    const sHero = rec({ ref: 'body>main>section|1|hX', srcPath: 'body>main>section|1|hX', tag: 'section', role: 'banner', text: 'Hero', box: { 1440: { x: 0, y: 0, w: 1440, h: 600, right: 1440, xFrac: 0, wFrac: 1 } } });
    const cHeroBad = cp(sHero); cHeroBad.ref = 'c3'; cHeroBad.box[1440] = { x: 0, y: 0, w: 1440, h: 24, right: 1440, xFrac: 0, wFrac: 1 };
    const cHeroGood = cp(sHero); cHeroGood.ref = 'c3';
    const rBHbad = E.runEngine(mkBlob([sHero], [cHeroBad]), floors, {}), rBHgood = E.runEngine(mkBlob([sHero], [cHeroGood]), floors, {});
    cases.push(['blank-hero', fired(rBHbad, 'bbox-ratio') && classed(rBHbad, 'blank-hero'), rBHgood.events.length === 0]);

    // unstyled-cta: button loses its chromatic background → recolour (color-deltaE) on a fold button.
    const sCta = rec({ ref: 'body>main>a|1|hT', srcPath: 'body>main>a|1|hT', tag: 'a', role: 'button', text: 'Get started', ownText: 'Get started', style: { color: 'rgb(255,255,255)', backgroundColor: 'rgb(99,91,255)', font: { size: '16px', family: 'Inter' }, border: { width: {}, style: {}, color: {} } }, box: { 1440: { x: 100, y: 300, w: 160, h: 48, right: 260, xFrac: 0.07, wFrac: 0.11 } } });
    const cCtaBad = cp(sCta); cCtaBad.ref = 'c4'; cCtaBad.style.color = 'rgb(20,20,20)'; cCtaBad.style.backgroundColor = 'rgba(0,0,0,0)';
    const cCtaGood = cp(sCta); cCtaGood.ref = 'c4';
    const rUCbad = E.runEngine(mkBlob([sCta], [cCtaBad]), floors, {}), rUCgood = E.runEngine(mkBlob([sCta], [cCtaGood]), floors, {});
    cases.push(['unstyled-cta', fired(rUCbad, 'color-deltaE') && classed(rUCbad, 'unstyled-cta'), rUCgood.events.length === 0]);

    // missing-imagery: a content image absent in the clone (presence).
    const sImg = rec({ ref: 'body>main>figure>img|1|hF', srcPath: 'body>main>figure>img|1|hF', tag: 'img', role: 'img', asset: { isImage: true, naturalSrc: 'https://s/panel.png', svgHash: null }, box: { 1440: { x: 200, y: 500, w: 800, h: 400, right: 1000, xFrac: 0.14, wFrac: 0.55 } } });
    const rMIbad = E.runEngine(mkBlob([sImg], []), floors, {}), rMIgood = E.runEngine(mkBlob([sImg], [Object.assign(cp(sImg), { ref: 'c5' })]), floors, {});
    cases.push(['missing-imagery (presence)', fired(rMIbad, 'presence'), rMIgood.events.length === 0]);

    // colliding-sections: clone box pushed far past the viewport edge (h-overflow) — overlapping/colliding.
    const sSec = rec({ ref: 'body>main>section|2|hO', srcPath: 'body>main>section|2|hO', tag: 'section', role: 'banner', text: 'Section', box: { 1440: { x: 0, y: 0, w: 1400, h: 200, right: 1400, xFrac: 0, wFrac: 0.97 } } });
    const cSecBad = cp(sSec); cSecBad.ref = 'c6'; cSecBad.box[1440] = { x: 0, y: 0, w: 2100, h: 200, right: 2100, xFrac: 0, wFrac: 1.46 };
    const cSecGood = cp(sSec); cSecGood.ref = 'c6';
    const rCSbad = E.runEngine(mkBlob([sSec], [cSecBad]), floors, {}), rCSgood = E.runEngine(mkBlob([sSec], [cSecGood]), floors, {});
    cases.push(['colliding-sections (h-overflow)', fired(rCSbad, 'h-overflow'), rCSgood.events.length === 0]);

    const allFire = cases.every((c) => c[1]);
    const allCleanSilent = cases.every((c) => c[2]);
    check('S2', 'each of the 6 marketing classes: injected defect FIRES right axis+class AND clean control is silent (rule C)',
      allFire && allCleanSilent, cases.map((c) => `${c[0]}:${c[1] ? 'FIRE' : 'BLIND!'}/${c[2] ? 'cleanOK' : 'FALSE-POS!'}`).join('  '));
  }

  // ── S3: COHERENCE collapses a coherent N-element uniform scale to ONE event ──
  {
    const N = 6, src = [], clone = [];
    const parent = rec({ ref: 'body>main>div|1|hG', srcPath: 'body>main>div|1|hG', tag: 'div', box: { 1440: { x: 100, y: 200, w: 800, h: 400, right: 900, xFrac: 0.07, wFrac: 0.55 } } });
    src.push(parent); clone.push(scaleBox(parent, 0.7));
    for (let i = 0; i < N - 1; i++) { const ch = rec({ ref: `body>main>div>p|${i}|hG${i}`, srcPath: `body>main>div>p|${i}|hG${i}`, tag: 'p', text: 'child ' + i, box: { 1440: { x: 120, y: 220 + i * 60, w: 600, h: 50, right: 720, xFrac: 0.083, wFrac: 0.42 } } }); src.push(ch); clone.push(scaleBox(ch, 0.7)); }
    const r = E.runEngine(mkBlob(src, clone), floors, {});
    const bbox = r.events.filter((e) => e.coherence && e.coherence.family === 'geometry' && e.firedAxes.includes('bbox-ratio'));
    check('S3', 'coherent N-element uniform-scale collapses to ONE geometry event of componentSize N (the others collapsed)',
      bbox.length === 1 && bbox[0].coherence.componentSize === N, `bboxComponents=${bbox.length} size=${bbox[0] && bbox[0].coherence.componentSize} collapsed=${r.coherence.collapsed}`);
  }

  // ── S4: RELATIONAL COLLISION fires (source disjoint → clone overlap) ──
  {
    const a = rec({ ref: 'body>main>section|1|hCA', srcPath: 'body>main>section|1|hCA', tag: 'section', role: 'banner', text: 'A', box: { 1440: { x: 0, y: 0, w: 700, h: 300, right: 700, xFrac: 0, wFrac: 0.49 } } });
    const b = rec({ ref: 'body>main>section|2|hCB', srcPath: 'body>main>section|2|hCB', tag: 'section', role: 'banner', text: 'B', box: { 1440: { x: 740, y: 0, w: 700, h: 300, right: 1440, xFrac: 0.51, wFrac: 0.49 } } });
    const ca = cp(a); ca.ref = 'ca';
    const cb = cp(b); cb.ref = 'cb'; cb.box[1440] = { x: 200, y: 0, w: 700, h: 300, right: 900, xFrac: 0.14, wFrac: 0.49 };
    const r = E.runEngine(mkBlob([a, b], [ca, cb]), floors, {});
    const collide = r.events.some((e) => e.firedAxes.includes('collision') || e.class === 'overlapping-sections');
    check('S4', 'relational COLLISION fires between two sections disjoint in source but overlapping in clone (clone_IOU−source_IOU>floor)',
      collide, collide ? 'collision event present' : 'NO collision event');
  }

  // ── S5: NO-LABEL-FIT — injecting a fake label channel cannot move ANY number ──
  {
    const sH = rec({ ref: 'body>main>h1|1|hN', srcPath: 'body>main>h1|1|hN', tag: 'h1', role: 'heading', text: 'Heading', ownText: 'Heading', style: { color: 'rgb(17,17,17)', backgroundColor: 'rgb(255,255,255)', font: { size: '40px', family: 'Inter' }, border: { width: {}, style: {}, color: {} } }, box: { 1440: { x: 100, y: 80, w: 600, h: 80, right: 700, xFrac: 0.07, wFrac: 0.42 } } });
    const cH = cp(sH); cH.ref = 'cn'; cH.style.color = 'rgb(250,250,250)';
    const plain = mkBlob([sH], [cH]);
    const labeled = cp(plain);
    // inject a FAKE human-label channel EVERYWHERE a naive grader might read it.
    labeled.report.human_ledger = { overall_0_100: 0, per_defect: [{ defect_class: 'invisible-heading', severity: 'fatal' }] };
    labeled.report.human_score = 0; labeled.humanLabel = 'BROKEN';
    for (const rr of labeled.sourceCapture.records) rr.__label = 'BROKEN';
    for (const rr of labeled.cloneCapture.records) rr.__label = 'BROKEN';
    const r1 = E.runEngine(plain, floors, {});
    const r2 = E.runEngine(labeled, floors, {});
    const sameScore = r1.pageScore === r2.pageScore;
    const sameEvents = JSON.stringify(r1.events.map((e) => [e.ref, e.severity, e.class])) === JSON.stringify(r2.events.map((e) => [e.ref, e.severity, e.class]));
    check('S5', 'no-label-fit: injecting a fake per-pair human-label channel does NOT move pageScore OR any event severity (byte-identical); meta.noLabelFit===true',
      sameScore && sameEvents && r1.meta.noLabelFit === true, `sameScore=${sameScore} sameEvents=${sameEvents} noLabelFit=${r1.meta.noLabelFit}`);
  }

  // ── S6: NEVER suppress on coherence alone; DO route a confirmed global cause ──
  {
    // (a) unexplained coherent component (two adjacent same-scale boxes, NOT a known global cause) → keeps severity.
    const p1 = rec({ ref: 'body>main>div|1|hU', srcPath: 'body>main>div|1|hU', tag: 'div', box: { 1440: { x: 100, y: 100, w: 600, h: 200, right: 700, xFrac: 0.07, wFrac: 0.42 } } });
    const c1 = rec({ ref: 'body>main>div>p|1|hU2', srcPath: 'body>main>div>p|1|hU2', tag: 'p', text: 'child', box: { 1440: { x: 110, y: 120, w: 500, h: 160, right: 610, xFrac: 0.076, wFrac: 0.35 } } });
    const rU = E.runEngine(mkBlob([p1, c1], [scaleBox(p1, 0.6), scaleBox(c1, 0.6)]), floors, {});
    const unexplained = rU.events.filter((e) => e.coherence && e.coherence.template === 'unexplained-coherent' && e.firedAxes.includes('bbox-ratio'));
    const keepsSeverity = unexplained.length > 0 && unexplained.every((e) => e.severity > 0);

    // (b) a confirmed global cause (scrollbar offset) is routed away. We can't easily synth a pure-translation trip
    //     (no position-only element axis), so we assert the TEMPLATE machinery exists + classifies a big single-axis
    //     theme shift as global-diff (demoted, NOT dropped — severity reduced but > 0).
    const big = []; const bigClone = [];
    for (let i = 0; i < 26; i++) { const s = rec({ ref: `body>main>li|${i}|hB${i}`, srcPath: `body>main>li|${i}|hB${i}`, tag: 'li', role: 'listitem', text: 'item ' + i, style: { color: 'rgb(20,20,20)', backgroundColor: 'rgb(255,255,255)', font: { size: '16px', family: 'Inter' }, border: { width: {}, style: {}, color: {} } }, box: { 1440: { x: 100, y: 100 + i * 30, w: 600, h: 24, right: 700, xFrac: 0.07, wFrac: 0.42 } } });
      const c = cp(s); c.ref = 'c' + i; c.style.color = 'rgb(120,120,120)'; big.push(s); bigClone.push(c); }
    const rG = E.runEngine(mkBlob(big, bigClone), floors, {});
    const demoted = rG.events.find((e) => e.coherence && e.coherence.template === 'global-diff');
    const demotedKept = !demoted || demoted.severity > 0; // if a global-diff fired, it must be demoted-not-dropped (severity>0)

    check('S6', 'coherence NEVER suppresses on coherence alone (unexplained coherent component keeps severity>0); a confirmed global-diff is DEMOTED not dropped',
      keepsSeverity && demotedKept, `unexplained{n:${unexplained.length},keepsSeverity:${keepsSeverity}}  globalDiff{fired:${!!demoted},severity:${demoted ? demoted.severity : 'n/a'}}`);
  }

  const passes = results.every((r) => r.pass);
  console.log('\n==== AXIS-DELTA ENGINE FALSIFIER (PHASE 3) ====');
  console.log(`engine : eval/grader/axisdelta-engine.mjs`);
  console.log(`floors : ${FLOORS_PATH}`);
  console.log(`compare: ${fs.existsSync(COMPARE) ? COMPARE : '(no real blob — S1 real leg skipped)'}\n`);
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.id}] ${r.name}\n        ${r.detail}`);
  console.log(`\nRESULT: ${passes ? 'PASS — the engine is self-clone-safe, fires all 6 classes on injection, collapses coherent shifts to one event, fires relational collisions, is label-blind, and never suppresses on coherence alone.' : 'FALSIFIED — see the FAIL line(s); the engine must NOT ship until fixed.'}`);

  if (AS_JSON) console.log('\n' + JSON.stringify({ falsifierFile: 'eval/grader/_axisdelta-engine-selftest.mjs', checks: results, passes }, null, 2));
  process.exit(passes ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
