#!/usr/bin/env node
/**
 * @purpose detector-views.mjs — PHASE 4 of the upleveled grader (fusion #3): the hand-written compare-detectors
 * MIGRATED to VIEWS over the universal event ledger emitted by axisdelta-engine.mjs. A "view" is a pure QUERY
 * (dominant_axis ∧ role/bucket ∧ severity≥τ) over the one-row-per-(element-or-pair, axis, viewport) ledger —
 * NOT a per-defect detector. "wrong_logo" is the query  { dominant axis ∈ image-hash family ∧ bucket==logo }.
 * "invisible_heading" is  { text-contrast fired ∧ role/bucket heading }. No detection code lives here — only the
 * cosmetic projection of the engine's continuous severity surface onto the detector taxonomy.
 *
 * WHY VIEWS (the migration discipline, EVAL-INTEGRITY):
 *   • A detector RETIRES iff its OWN injection fixtures still pass THROUGH the engine+view: the engine FIRES on
 *     the broken fixture, on the RIGHT element, at severity≥τ, and stays SILENT on the clean control. We assert
 *     (fires, right element, severity≥τ) — NOT an identical label. Label drift is OK; DETECTION drift is not.
 *   • The blocking migration cell is detector-FIRES / universal-SILENT — a coverage gap a human already
 *     validated. We compute the SHADOW confusion matrix on the blog page and surface that cell explicitly so a
 *     floor/missing-axis can be fixed BEFORE the detector is deleted. (Code is deleted; the FIXTURES are kept as
 *     a permanent CI gate — see _axisdelta-fixtures-ci.mjs.)
 *
 * THE LEDGER. ledgerOf(engineOut) flattens the engine's events into rows:
 *   { ref, viewport, axis, role, bucket, dominantAxis, severity, firedAxes[], class, componentId }
 * One row per (event, fired-axis). Views are filters over these rows. This is the "universal event ledger" the
 * spec asks for — every defect query is expressed against it, never against bespoke per-defect signal code.
 *
 * VIEW TABLE (each is a pure predicate over a ledger row; τ = severity floor, default 0.12 — a perceptible trip):
 *   wrong-logo          : img-hash family fired (img-src|img-svghash|img-phash) ∧ bucket==logo
 *   missing-logo        : presence fired            ∧ bucket==logo
 *   invisible-heading   : text-contrast fired       ∧ (role==heading ∨ bucket∈{h1})
 *   invisible-text      : text-contrast fired       ∧ NOT heading/cta (generic body/link contrast collapse)
 *   blank-hero          : (presence∨bbox-ratio)     ∧ bucket==hero
 *   unstyled-cta        : (color-deltaE∨bbox-ratio∨font-size-ratio∨text-contrast) ∧ (bucket==cta ∨ role==button)
 *   missing-imagery     : (img-hash∨presence)       ∧ role==img ∧ NOT logo
 *   missing-section     : presence fired            ∧ NOT logo (a wholly-dropped region)
 *   overlapping-sections: (collision∨z-pile∨h-overflow) fired
 *   wrong-layout        : (containment-escape∨reading-order∨bbox-ratio) ∧ no higher-specificity view matched
 *   color-off           : color-deltaE fired (non-CTA)
 *   font-off            : font-size-ratio fired (non-CTA)
 *
 * The 8 hand detectors map onto these views (label may DRIFT — detection must NOT):
 *   #1 not_responsive   → overlapping-sections / wrong-layout via h-overflow + responsive-reflow routing
 *   #3 missing_emoji     → invisible-text / missing-section (glyph loss = a text/presence trip on the bearer)
 *   #4 blockquote_bar    → color-off / wrong-layout (the bar is a border-style trip)
 *   #5 code_chip         → color-off / missing-section (chip bg loss = color-deltaE / a missing <code>)
 *   #6 missing_hr        → missing-section (presence on the dropped <hr>)
 *   #7a prose_into_code  → overlapping-sections (collision)
 *   #7b code_colors_lost → color-off (dark bg → light)
 *   #8 wrongly_sticky    → wrongly-sticky (the state-pin axis ADDED to the engine in Phase 4 to close the gap the
 *                          shadow matrix surfaced: clone pins a top-band box across scroll the source does not)
 *
 * SAFETY: PURE — imports axisdelta-engine.mjs + grade-element-crops.mjs (readPairs/parseColor) UNCHANGED. Reads a
 * cached compare blob + the frozen floors. No network/host/builder/git. Reversible (delete this file + the CI
 * fixtures harness; nothing else changes). Bash callers stay <120s.
 *
 * CLI:
 *   node detector-views.mjs --compare /tmp/compare-310.json --confusion   # shadow confusion matrix vs detectors
 *   node detector-views.mjs --compare /tmp/compare-310.json --views       # dump the views (queries over ledger)
 *   node detector-views.mjs --schema                                      # offline schema
 *   node --check detector-views.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as E from './axisdelta-engine.mjs';
import { runAllDetectors } from './compare-detectors.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined && !String(process.argv[i + 1]).startsWith('--') ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

export const DEFAULT_TAU = 0.12; // severity floor for a view to "fire" — a perceptible trip (label-blind; the
// floor module already removed the imperceptible band, so τ is only a small extra "is it worth reporting" gate).

const IMG_HASH = new Set(['img-src', 'img-svghash', 'img-phash']);
const has_ = (axes, ...names) => names.some((n) => axes.includes(n));

// ── the universal EVENT LEDGER: one row per (event, fired-axis). Views are queries over THIS. ──
export function ledgerOf(engineOut) {
  const rows = [];
  for (const ev of engineOut.events) {
    const axes = ev.firedAxes || [];
    for (const axis of axes) {
      rows.push({
        ref: ev.ref, viewport: ev.viewport, axis, role: ev.role || null, bucket: ev.bucket || null,
        dominantAxis: ev.dominantAxis || null, severity: ev.severity, firedAxes: axes, class: ev.class,
        componentId: ev.coherence ? `${ev.coherence.family}:${ev.coherence.template}` : null,
        template: ev.coherence ? ev.coherence.template : null,
      });
    }
    if (!axes.length) { // a presence-only event with no axis array still belongs in the ledger
      rows.push({ ref: ev.ref, viewport: ev.viewport, axis: ev.dominantAxis || 'presence', role: ev.role || null,
        bucket: ev.bucket || null, dominantAxis: ev.dominantAxis || null, severity: ev.severity, firedAxes: axes,
        class: ev.class, componentId: null, template: ev.coherence ? ev.coherence.template : null });
    }
  }
  return rows;
}

// ── the VIEW TABLE: a pure predicate over an EVENT (not a row — an event carries the firedAxes set + bucket). ──
// Each returns true/false. severity≥τ is applied by `fireView` so the predicates stay axis/role-only.
const isHeading = (ev) => ev.role === 'heading' || ev.bucket === 'h1';
const isLogo = (ev) => ev.bucket === 'logo';
const isCta = (ev) => ev.bucket === 'cta' || ev.role === 'button';
const isHero = (ev) => ev.bucket === 'hero';
const isImg = (ev) => ev.role === 'img';
const f = (ev) => ev.firedAxes || [];

export const VIEWS = {
  'wrong-logo':           (ev) => has_(f(ev), ...IMG_HASH) && isLogo(ev),
  'missing-logo':         (ev) => f(ev).includes('presence') && isLogo(ev),
  'invisible-heading':    (ev) => (f(ev).includes('text-contrast') || f(ev).includes('presence')) && isHeading(ev),
  'blank-hero':           (ev) => (f(ev).includes('presence') || f(ev).includes('bbox-ratio')) && isHero(ev),
  'unstyled-cta':         (ev) => has_(f(ev), 'color-deltaE', 'bbox-ratio', 'font-size-ratio', 'text-contrast') && isCta(ev),
  'missing-imagery':      (ev) => (has_(f(ev), ...IMG_HASH) || f(ev).includes('presence')) && isImg(ev) && !isLogo(ev),
  'invisible-text':       (ev) => f(ev).includes('text-contrast') && !isHeading(ev) && !isCta(ev),
  'missing-section':      (ev) => f(ev).includes('presence') && !isLogo(ev) && !isImg(ev),
  'overlapping-sections': (ev) => has_(f(ev), 'collision', 'z-pile', 'h-overflow'),
  'wrong-layout':         (ev) => has_(f(ev), 'containment-escape', 'reading-order', 'bbox-ratio'),
  'color-off':            (ev) => f(ev).includes('color-deltaE') && !isCta(ev),
  'font-off':             (ev) => f(ev).includes('font-size-ratio') && !isCta(ev),
  'wrongly-sticky':       (ev) => f(ev).includes('state-pin'),
};
export const VIEW_NAMES = Object.keys(VIEWS);

// does a view FIRE anywhere on the page? returns the matching events (severity≥τ), strongest first.
export function fireView(name, engineOut, tau = DEFAULT_TAU) {
  const pred = VIEWS[name]; if (!pred) return [];
  return engineOut.events.filter((ev) => ev.severity >= tau && pred(ev)).sort((a, b) => b.severity - a.severity);
}

// run ALL views over an engine output → { view: { fires, count, maxSeverity, topRef } }
export function runViews(engineOut, tau = DEFAULT_TAU) {
  const out = {};
  for (const name of VIEW_NAMES) {
    const hits = fireView(name, engineOut, tau);
    out[name] = { fires: hits.length > 0, count: hits.length, maxSeverity: hits.length ? +hits[0].severity.toFixed(4) : 0,
      topRef: hits.length ? hits[0].ref : null };
  }
  return out;
}

// ── DETECTOR → VIEW correspondence map (for the shadow confusion matrix). A detector "maps" to the set of views
// its defect projects onto; the detector is COVERED iff at least one of those views fires on the same page. ──
export const DETECTOR_TO_VIEWS = {
  '1':  { name: 'not_responsive',        views: ['overlapping-sections', 'wrong-layout'], note: 'h-overflow/reflow → overlap/layout' },
  '3':  { name: 'missing_emoji',         views: ['invisible-text', 'missing-section'],    note: 'glyph loss = text/presence trip' },
  '4':  { name: 'missing_blockquote_bar',views: ['color-off', 'wrong-layout'],            note: 'border-bar style/geometry trip' },
  '5':  { name: 'missing_code_chip',     views: ['color-off', 'missing-section'],         note: 'chip bg loss / missing <code>' },
  '6':  { name: 'missing_hr',            views: ['missing-section'],                      note: 'presence on the dropped <hr>' },
  '7a': { name: 'prose_into_code_overlap',views: ['overlapping-sections'],                note: 'collision' },
  '7b': { name: 'code_colors_lost',      views: ['color-off'],                            note: 'dark bg → light = color-deltaE' },
  '8':  { name: 'wrongly_sticky_nav',    views: ['wrongly-sticky'],                       note: 'state-pin axis (added Phase 4 to CLOSE the coverage gap): clone pins a top-band box source does not' },
};
// the 7 in-scope human defects (defect 2 dark-mode set aside; defect 7 = 7a OR 7b).
export const HUMAN_DEFECTS = ['1', '3', '4', '5', '6', '7', '8'];

// SHADOW CONFUSION MATRIX: for each human defect, did the DETECTOR fire (on this blob) and did the UNIVERSAL
// engine (via its mapped views) fire? The blocking cell = detector-FIRES / universal-SILENT (coverage gap).
export function confusionMatrix(blob, { tau = DEFAULT_TAU } = {}) {
  const floors = E.loadFloors();
  const engineOut = E.runEngine(blob, floors, {});
  const views = runViews(engineOut, tau);
  const det = runAllDetectors(blob);
  const firedDet = new Set(det.detectors.filter((d) => d.fires).map((d) => d.defectNum));
  const detectorFires = (n) => n === '7' ? (firedDet.has('7a') || firedDet.has('7b')) : firedDet.has(n);
  const universalFires = (n) => {
    if (n === '7') return DETECTOR_TO_VIEWS['7a'].views.concat(DETECTOR_TO_VIEWS['7b'].views).some((v) => views[v] && views[v].fires);
    const m = DETECTOR_TO_VIEWS[n]; if (!m) return false;
    return m.views.some((v) => views[v] && views[v].fires);
  };
  const cells = [];
  let bothFire = 0, detOnly = 0, uniOnly = 0, neither = 0;
  for (const n of HUMAN_DEFECTS) {
    const d = detectorFires(n), u = universalFires(n);
    const cell = d && u ? 'BOTH' : d && !u ? 'DETECTOR-ONLY (COVERAGE GAP)' : !d && u ? 'UNIVERSAL-ONLY' : 'NEITHER';
    if (d && u) bothFire++; else if (d && !u) detOnly++; else if (!d && u) uniOnly++; else neither++;
    const mappedViews = n === '7' ? [...new Set([...DETECTOR_TO_VIEWS['7a'].views, ...DETECTOR_TO_VIEWS['7b'].views])] : (DETECTOR_TO_VIEWS[n] || { views: [] }).views;
    cells.push({ defect: n, detectorFires: d, universalFires: u, cell,
      mappedViews, firingViews: mappedViews.filter((v) => views[v] && views[v].fires) });
  }
  const coverageGaps = cells.filter((c) => c.cell.startsWith('DETECTOR-ONLY'));
  return { source: blob.report && blob.report.source, clone: blob.report && blob.report.clone,
    enginePageScore: engineOut.pageScore, tau, cells,
    summary: { bothFire, detectorOnly: detOnly, universalOnly: uniOnly, neither,
      coverageGaps: coverageGaps.map((c) => `#${c.defect} ${DETECTOR_TO_VIEWS[c.defect] ? DETECTOR_TO_VIEWS[c.defect].name : (c.defect === '7' ? 'prose/colors' : '?')}`),
      blockingGapCount: coverageGaps.length },
    views, detectorRecall: det.recall };
}

// ── SCHEMA ──
export const VIEWS_SCHEMA = {
  viewsFile: 'eval/grader/detector-views.mjs',
  principle: 'detectors → VIEWS = pure QUERIES over the universal event ledger (one row per (element|pair, axis, viewport)); no per-defect detection code',
  ledgerRow: '{ ref, viewport, axis, role, bucket, dominantAxis, severity, firedAxes[], class, componentId }',
  tau: DEFAULT_TAU,
  views: VIEW_NAMES,
  exampleQueries: { 'wrong-logo': 'dominant axis ∈ {img-src,img-svghash,img-phash} ∧ bucket==logo',
    'invisible-heading': 'text-contrast fired ∧ (role==heading ∨ bucket==h1)' },
  detectorToViews: DETECTOR_TO_VIEWS,
  migrationRule: 'a detector RETIRES iff (engine fires on the broken fixture, RIGHT element, severity≥τ) AND (silent on the clean control); assert (fires, right-element, severity≥τ) NOT identical label — label drift OK, detection drift NOT',
  blockingCell: 'detector-FIRES / universal-SILENT = a human-validated coverage gap; FIX the floor/missing-axis BEFORE retiring',
  closedGap: '#8 wrongly_sticky_nav projected onto a STATE (scroll-pin) axis the spine lacked → the shadow matrix flagged it DETECTOR-ONLY → we ADDED the engine state-pin axis (reads the capture stickySummary) to close it, per "fix the missing-axis BEFORE retiring"',
  imports: 'axisdelta-engine.mjs + compare-detectors.mjs (runAllDetectors) UNCHANGED — additive/reversible',
};

// ── MAIN ──
function main() {
  if (has('schema')) { console.log(JSON.stringify(VIEWS_SCHEMA, null, 2)); return; }
  const comparePath = arg('compare');
  if (!comparePath || !fs.existsSync(comparePath)) { console.error('need --compare <blob.json> (or --schema)'); process.exit(2); }
  const blob = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
  const tau = +arg('tau', DEFAULT_TAU);

  if (has('views')) {
    const engineOut = E.runEngine(blob, E.loadFloors(), {});
    const v = runViews(engineOut, tau);
    console.log(`\n==== DETECTOR VIEWS (queries over the universal event ledger) — ${blob.report.clone} ====`);
    console.log(`engine pageScore ${engineOut.pageScore} | τ=${tau} | ledger rows ${ledgerOf(engineOut).length}`);
    for (const name of VIEW_NAMES) console.log(`  [${v[name].fires ? 'FIRES' : ' --- '}] ${name.padEnd(22)} count=${String(v[name].count).padStart(4)} maxSev=${v[name].maxSeverity.toFixed(3)}  ${v[name].topRef ? String(v[name].topRef).slice(0, 44) : ''}`);
    return;
  }

  // default + --confusion: the shadow confusion matrix.
  const cm = confusionMatrix(blob, { tau });
  console.log(`\n==== SHADOW CONFUSION MATRIX: hand-detectors vs UNIVERSAL engine views ====`);
  console.log(`source: ${cm.source}\nclone:  ${cm.clone}\nengine pageScore ${cm.enginePageScore} | τ=${tau}`);
  console.log(`\ndefect | detector | universal | cell`);
  for (const c of cm.cells) {
    console.log(`  #${String(c.defect).padEnd(3)} | ${(c.detectorFires ? 'FIRES' : ' --- ').padEnd(8)} | ${(c.universalFires ? 'FIRES' : ' --- ').padEnd(9)} | ${c.cell}${c.firingViews.length ? '  via ' + c.firingViews.join(',') : ''}`);
  }
  console.log(`\nsummary: both=${cm.summary.bothFire} detector-only=${cm.summary.detectorOnly} universal-only=${cm.summary.universalOnly} neither=${cm.summary.neither}`);
  if (cm.summary.blockingGapCount) console.log(`BLOCKING COVERAGE GAPS (detector-FIRES / universal-SILENT) — FIX BEFORE RETIRING: ${cm.summary.coverageGaps.join(', ')}`);
  else console.log(`NO blocking coverage gaps — every detector that fires here is reproduced by a universal view.`);
  if (has('json')) { fs.writeFileSync('/tmp/detector-views-confusion.json', JSON.stringify(cm, null, 2)); console.log('\nfull matrix → /tmp/detector-views-confusion.json'); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
