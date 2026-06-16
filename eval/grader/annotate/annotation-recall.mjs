#!/usr/bin/env node
/**
 * @purpose annotation-recall.mjs — wire HUMAN STICKY-NOTE ANNOTATIONS → grader VALIDATION (NOT weight-fitting).
 *
 * The sticky-note tool (annotate/index.html) lets a human drop element-precise pins on a rendered localhost clone.
 * Each pin is keyed to a `--joist-src` STAMP (the same content-addressed source path `tagchain|nth|h<8hex>` the
 * grader uses for correspondence). So a human pin and a grader-ledger event that name the SAME element are joinable
 * by an O(1) exact stamp match — and by path-prefix for ancestor/descendant, and by an edge-ref for relational pins.
 *
 * THIS FILE IS A RECALL PROBE — it answers ONE question: "for each thing the human pinned, did the grader ledger
 * already flag the same element (or its ancestor/descendant, or the colliding pair) with a MATCHING axis at a
 * reasonable severity band?" Output = recall + miss PER AXIS (e.g. "collision pins 5/5 caught; recolor pins 3/4").
 *
 * ══ EVAL-INTEGRITY — THE NON-NEGOTIABLE BOUNDARY (this is the whole point) ══════════════════════════════════════
 *   • This is VALIDATION / DIAGNOSIS ONLY. It NEVER writes a grader weight, floor, tolerance, or τ. It does not
 *     even IMPORT the engine — it reads a frozen LEDGER (axisdelta-engine / grade-fused output for a page) and a
 *     frozen ANNOTATIONS file. `noWeightFit: true` rides the schema and is asserted in the selftest.
 *   • The grader's weights/floors stay LABEL-BLIND-NOISE + PERCEPTUAL-PRIOR (set in axisdelta-engine.mjs / floor.mjs
 *     from first principles + a NOISE corpus, never from these labels). The annotations are a HOLD-OUT TEST SET, the
 *     way a test set in ML is never trained on. A MISS here is a REPORTED COVERAGE GAP — a TODO for a label-blind
 *     synthetic-injection fixture (see the injection-seed adapter below), NOT a knob to turn.
 *   • The probe is DIRECTIONAL: it measures grader RECALL of human-pinned defects. It deliberately does NOT compute
 *     precision over the human set (the human pins a SUBSET — absence of a human pin is not "the grader is wrong").
 *     False-positive control belongs to the label-blind self-clone falsifier, not here.
 *
 * ══ MATCH SEMANTICS (how a pin is "caught") ════════════════════════════════════════════════════════════════════
 * A human pin {element_ref, colliding_with?, defect_class, severity} is CAUGHT iff the ledger has an event E s.t.
 *   (1) LOCALITY: E.ref corresponds to the pin —
 *         exact     : pathOf(E.ref) === pathOf(pin.element_ref)              (same stamp / same element)
 *         ancestor  : pathOf(E.ref) is a path-prefix ancestor of the pin     (grader flagged the container)
 *         descendant: pathOf(pin.element_ref) is a prefix ancestor of E.ref  (grader flagged a child)
 *         relational: for a COLLISION pin (has colliding_with), an EDGE event "A×B" whose two path halves cover
 *                     {pin.element_ref, pin.colliding_with} as an unordered pair (order-free) — OR any
 *                     overlapping-sections / collision / h-overflow event localized to either endpoint.
 *   AND
 *   (2) AXIS/CLASS MATCH: E fired an axis (or carries a class/view) in the set the human defect_class maps to
 *       (DEFECT_AXES below — a FIXED taxonomy bridge, identical in spirit to detector-views.DETECTOR_TO_VIEWS; it
 *       is NOT fit to the data, it is the same axis vocabulary the grader already projects names from).
 *   AND
 *   (3) SEVERITY BAND: E.severity lands in a REASONABLE band for the human severity (1..5). We do NOT require an
 *       exact numeric match (that WOULD be fitting). We require only that a high-severity human pin (≥4) is met by
 *       a non-trivial grader severity (≥ MIN_SEV_FOR_STRONG) and that any pin is met by E.severity ≥ τ (perceptible).
 *       The band is a COARSE monotone sanity gate, not a tuned threshold — it is intentionally loose so the probe
 *       reports a MISS only on a genuine coverage hole, never on a severity-scale disagreement.
 *
 * ══ INJECTION-SEED ADAPTER (the bridge back to label-blind validation) ═════════════════════════════════════════
 * Each pin ALSO emits a synthetic-injection CATEGORY DESCRIPTOR: the PERTURBATION a label-blind fixture would
 * generate to exercise this defect class (e.g. "translate section A onto section B", "set heading color = its bg").
 * These are CATEGORY + PARAM-SHAPE stubs — NOT tuned constants. They are the spec for a _marketing-injection-recall
 * style harness so that a recall MISS becomes a new SYNTHETIC fixture (free, both-directions, label-free), never a
 * grader tweak. The adapter NEVER reads the grader; it reads only the pin.
 *
 * SAFETY: PURE. Reads two JSON/JSONL files. No network, no host, no builder, no git, no engine import, no writes
 * unless --out is passed (then a diagnosis JSON only). Bash callers stay <120s. Offline selftest needs no capture.
 *
 * CLI:
 *   node annotation-recall.mjs --annotations pins.jsonl --ledger /tmp/ledger-2551.json [--tau 0.12] [--json] [--out diag.json]
 *   node annotation-recall.mjs --selftest      # offline: synthetic annotations + synthetic ledger → correct recall/miss
 *   node annotation-recall.mjs --schema        # dump the schema (DEFECT_AXES + injection categories + output shape)
 *   node --check annotation-recall.mjs         # syntax check
 *
 * The ledger may be EITHER an axisdelta-engine output ({events:[{ref,firedAxes,class,severity,...}], ...}) OR a
 * grade-fused output that embeds it ({engine:{events:[...]}} / {axisdelta:{events:[...]}} / {ledger:{events:[...]}}).
 * We normalize all of these to a flat events[] before probing.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined && !String(process.argv[i + 1]).startsWith('--') ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

// the perceptible severity floor — IMPORTED CONCEPT from detector-views.DEFAULT_TAU (kept in sync by value, not by
// fit). A pin is only "caught" if the grader event is at least perceptible. Overridable by --tau for diagnostics.
export const DEFAULT_TAU = 0.12;
// a STRONG human pin (severity ≥4) deserves a non-trivial grader severity to count as caught. This is a COARSE
// monotone band, deliberately loose (≈ "the grader didn't merely whisper about a thing the human screamed about").
export const STRONG_PIN_SEVERITY = 4;
export const MIN_SEV_FOR_STRONG = 0.30;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// DEFECT_AXES — the FIXED taxonomy bridge: a human sticky-note defect_class → the grader axes (+ the projected
// VIEW/class names) that would catch it. This is the SAME axis vocabulary the grader already projects names from
// (axisdelta-engine.projectName / detector-views.VIEWS). It is NOT fit to the annotations — it is the contract
// between the human label vocabulary and the engine's axis vocabulary. Changing the GRADER does not change this;
// changing this does not change the GRADER. (anti-fit firewall.)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export const DEFECT_AXES = {
  // human label              axes that satisfy it (any one)                          projected classes/views
  'wrong-logo':            { axes: ['img-src', 'img-svghash', 'img-phash'],            classes: ['wrong-logo'] },
  'invisible-heading':     { axes: ['text-contrast', 'presence'],                      classes: ['invisible-heading', 'invisible-text'] },
  'blank-hero':            { axes: ['presence', 'bbox-ratio'],                          classes: ['blank-hero', 'missing-section'] },
  'unstyled-cta':          { axes: ['color-deltaE', 'bbox-ratio', 'font-size-ratio', 'text-contrast'], classes: ['unstyled-cta', 'color-off', 'font-off'] },
  'overlapping-sections':  { axes: ['collision', 'z-pile', 'h-overflow', 'containment-escape', 'reading-order'], classes: ['overlapping-sections', 'wrong-layout'], relational: true },
  'collision':             { axes: ['collision', 'z-pile', 'h-overflow', 'containment-escape'], classes: ['overlapping-sections', 'wrong-layout'], relational: true },
  'missing-imagery':       { axes: ['presence', 'img-src', 'img-svghash', 'img-phash'], classes: ['missing-imagery', 'missing-section'] },
  'recolor':               { axes: ['color-deltaE', 'text-contrast'],                  classes: ['color-off', 'unstyled-cta', 'invisible-text'] },
  // free-text / catch-all: a human "other" pin matches ANY grader event at the same locality (coverage only).
  'other':                 { axes: null /* wildcard */,                                classes: null },
};
// AXIS → human-readable axis-bucket for the per-axis recall rollup (so we report "collision pins: 5/5",
// "recolor pins: 3/4" by the HUMAN defect_class, which is the unit the human thinks in).
export const KNOWN_DEFECTS = Object.keys(DEFECT_AXES);

// ── path helpers (the stamp join) — mirror axisdelta-engine.pathOf/isAncestorPath EXACTLY (re-implemented here so
// this file imports NOTHING from the engine; the format is the frozen `tagchain|nth|hHASH` and the '>' containment).
export function pathOf(refOrStamp) { return String(refOrStamp || '').split('|')[0]; }
export function isAncestorPath(ancestor, descendant) {
  const a = pathOf(ancestor), d = pathOf(descendant);
  return !!a && !!d && a !== d && d.startsWith(a + '>');
}
// locality between a pin element_ref and a ledger event ref. Returns the relation kind or null.
export function localityKind(pinRef, evRef) {
  const p = pathOf(pinRef), e = pathOf(evRef);
  if (!p || !e) return null;
  if (p === e) return 'exact';
  if (isAncestorPath(e, p)) return 'ancestor';     // event ref is an ANCESTOR of the pin (grader flagged the container)
  if (isAncestorPath(p, e)) return 'descendant';   // event ref is a DESCENDANT of the pin (grader flagged a child)
  return null;
}

// an EDGE event ref from the relational axes looks like "A×B" (axisdelta-engine relRow ref) where A,B are stamps.
// Split it into its two path halves (order-free). Also accept events that carry explicit {a,b}/{parent,child}.
export function edgeEndpoints(ev) {
  const out = [];
  const ref = String(ev.ref || '');
  if (ref.includes('×')) { for (const half of ref.split('×')) out.push(pathOf(half)); }
  for (const k of ['a', 'b', 'parent', 'child']) if (ev[k]) out.push(pathOf(ev[k]));
  return [...new Set(out.filter(Boolean))];
}
// does a relational/edge event COVER the unordered pair {refA, refB}? (both endpoints present, in either order,
// matched by path-prefix so an ancestor stamp of either endpoint also covers it).
export function edgeCoversPair(ev, refA, refB) {
  const eps = edgeEndpoints(ev);
  if (eps.length < 1) return false;
  const pA = pathOf(refA), pB = pathOf(refB);
  const coversA = eps.some((e) => e === pA || e.startsWith(pA + '>') || pA.startsWith(e + '>'));
  const coversB = eps.some((e) => e === pB || e.startsWith(pB + '>') || pB.startsWith(e + '>'));
  return coversA && coversB;
}

// ── normalize ANY ledger shape (engine output OR a grade-fused wrapper) to a flat events[] ──
export function normalizeLedger(ledger) {
  if (!ledger || typeof ledger !== 'object') return { events: [], pageScore: null, meta: {} };
  // direct engine output
  if (Array.isArray(ledger.events)) return { events: ledger.events, pageScore: ledger.pageScore ?? null, meta: ledger.meta || {} };
  // common wrappers from grade-fused / orchestrator
  for (const k of ['engine', 'axisdelta', 'ledger', 'axisdeltaEngine', 'engineOut']) {
    if (ledger[k] && Array.isArray(ledger[k].events)) return { events: ledger[k].events, pageScore: ledger[k].pageScore ?? ledger.pageScore ?? null, meta: ledger[k].meta || ledger.meta || {} };
  }
  // a raw events array
  if (Array.isArray(ledger)) return { events: ledger, pageScore: null, meta: {} };
  return { events: [], pageScore: ledger.pageScore ?? null, meta: ledger.meta || {} };
}

const firedOf = (ev) => (Array.isArray(ev.firedAxes) ? ev.firedAxes : []);
function axisOrClassMatches(ev, spec) {
  if (!spec || (spec.axes == null && spec.classes == null)) return true; // wildcard (defect_class 'other')
  const fired = firedOf(ev);
  if (spec.axes && spec.axes.some((a) => fired.includes(a))) return true;
  if (spec.classes && (spec.classes.includes(ev.class) || spec.classes.includes(ev.view))) return true;
  return false;
}

// severity band check — COARSE + monotone, never an exact-fit. Returns true if E.severity is acceptable for the pin.
function severityBandOk(evSeverity, pinSeverity, tau) {
  if (!(evSeverity >= tau)) return false;                       // must at least be perceptible
  if ((pinSeverity || 0) >= STRONG_PIN_SEVERITY) return evSeverity >= MIN_SEV_FOR_STRONG; // strong pin → non-trivial grader sev
  return true;                                                  // mild pin → perceptible is enough
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// THE PROBE — for one pin, find the BEST matching ledger event (if any). Returns {caught, via, event, reason}.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function probePin(pin, events, { tau = DEFAULT_TAU } = {}) {
  const defect = pin.defect_class || 'other';
  const spec = DEFECT_AXES[defect] || DEFECT_AXES.other;
  const isRelational = !!spec.relational || !!pin.colliding_with;
  const candidates = [];

  for (const ev of events) {
    if (!axisOrClassMatches(ev, spec)) continue;
    if (!severityBandOk(ev.severity ?? 0, pin.severity, tau)) continue;
    // (1) relational pin: an edge event covering the pinned pair, OR a relational event localized to either endpoint
    if (isRelational && pin.colliding_with) {
      if (edgeCoversPair(ev, pin.element_ref, pin.colliding_with)) { candidates.push({ ev, via: 'relational-pair' }); continue; }
    }
    // (2) element locality (exact / ancestor / descendant) on the primary ref
    const loc = localityKind(pin.element_ref, ev.ref);
    if (loc) { candidates.push({ ev, via: loc }); continue; }
    // (3) a relational/edge event localized to the primary endpoint (collision flagged but the human only pinned one side)
    if (isRelational) {
      const eps = edgeEndpoints(ev);
      const p = pathOf(pin.element_ref);
      if (eps.some((e) => e === p || e.startsWith(p + '>') || p.startsWith(e + '>'))) { candidates.push({ ev, via: 'relational-endpoint' }); }
    }
  }
  if (!candidates.length) return { caught: false, via: null, event: null, reason: missReason(pin, events, spec, tau) };
  // prefer the strongest, with locality preference (exact > pair > ancestor/descendant > endpoint)
  const order = { exact: 0, 'relational-pair': 1, ancestor: 2, descendant: 2, 'relational-endpoint': 3 };
  candidates.sort((a, b) => (order[a.via] - order[b.via]) || (b.ev.severity - a.ev.severity));
  const best = candidates[0];
  return { caught: true, via: best.via, event: { ref: best.ev.ref, class: best.ev.class, firedAxes: firedOf(best.ev), severity: best.ev.severity }, reason: null };
}
// a human-readable reason for a miss (which gate failed) — diagnosis, never used to tune.
function missReason(pin, events, spec, tau) {
  const p = pathOf(pin.element_ref);
  const anyLocality = events.some((ev) => localityKind(pin.element_ref, ev.ref) || (pin.colliding_with && edgeCoversPair(ev, pin.element_ref, pin.colliding_with)));
  if (!anyLocality) return 'no ledger event at this element_ref (or ancestor/descendant/edge) — grader did not localize here at all';
  const localityEvents = events.filter((ev) => localityKind(pin.element_ref, ev.ref) || (pin.colliding_with && edgeCoversPair(ev, pin.element_ref, pin.colliding_with)));
  const axisOk = localityEvents.some((ev) => axisOrClassMatches(ev, spec));
  if (!axisOk) return `grader localized here but on a DIFFERENT axis (${[...new Set(localityEvents.flatMap(firedOf))].join(',') || 'none'}) — defect-class axis mismatch`;
  return `grader localized + matched axis but BELOW the severity band (need ≥${(pin.severity || 0) >= STRONG_PIN_SEVERITY ? MIN_SEV_FOR_STRONG : tau})`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// INJECTION-SEED ADAPTER — each pin → a synthetic-injection CATEGORY descriptor (the perturbation a label-blind
// fixture would generate to exercise this defect). CATEGORY + PARAM-SHAPE, NOT tuned constants. NEVER reads the grader.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export const INJECTION_CATEGORY = {
  'wrong-logo':           { category: 'swap-asset-src',        target: 'element_ref', op: 'set clone img naturalSrc → a wrong url; null the svgHash', validatesView: 'wrong-logo' },
  'invisible-heading':    { category: 'collapse-text-contrast',target: 'element_ref', op: 'set clone heading color = its own backgroundColor', validatesView: 'invisible-heading' },
  'blank-hero':           { category: 'drop-band-children',    target: 'element_ref', op: 'remove the hero band + all descendants from the clone (→ presence)', validatesView: 'blank-hero' },
  'unstyled-cta':         { category: 'strip-cta-chrome',      target: 'element_ref', op: 'clear clone CTA backgroundColor, recolor text→ink, shrink bbox', validatesView: 'unstyled-cta' },
  'overlapping-sections': { category: 'translate-onto',        target: 'pair',        op: 'translate element_ref clone box onto colliding_with box (→ collision)', validatesView: 'overlapping-sections' },
  'collision':            { category: 'translate-onto',        target: 'pair',        op: 'translate element_ref clone box onto colliding_with box (→ collision)', validatesView: 'overlapping-sections' },
  'missing-imagery':      { category: 'drop-asset',            target: 'element_ref', op: 'remove the content image from the clone (→ presence/missing-imagery)', validatesView: 'missing-imagery' },
  'recolor':              { category: 'shift-color',           target: 'element_ref', op: 'shift clone color a perceptible ΔE (→ color-deltaE)', validatesView: 'color-off' },
  'other':                { category: 'free-text',             target: 'element_ref', op: 'no canonical perturbation — author a fixture from the note text', validatesView: null },
};
// produce ONE injection-seed per pin. PARAM-SHAPE (refs + the op spec) — the actual magnitudes/urls are chosen by
// the (separate) label-blind injection harness, NOT here, so no tuned constant leaks from a label into the grader.
export function injectionSeed(pin) {
  const defect = pin.defect_class || 'other';
  const tmpl = INJECTION_CATEGORY[defect] || INJECTION_CATEGORY.other;
  return {
    category: tmpl.category,
    op: tmpl.op,
    validatesView: tmpl.validatesView,
    targetRef: pin.element_ref,
    pairRef: tmpl.target === 'pair' ? (pin.colliding_with || null) : null,
    fromDefectClass: defect,
    note: pin.note || null,
    // EXPLICITLY no tuned constants — the magnitude/url/scale is decided by the label-blind harness.
    paramsSource: 'label-blind-injection-harness (NOT this annotation; no constant fit to the label)',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// RUN — probe every pin, roll up recall/miss per axis (= per HUMAN defect_class) + overall + injection seeds.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function runRecall(annotations, ledgerRaw, { tau = DEFAULT_TAU } = {}) {
  const { events, pageScore, meta } = normalizeLedger(ledgerRaw);
  const pins = (annotations || []).filter((p) => p && p.element_ref);
  const perPin = pins.map((pin) => {
    const r = probePin(pin, events, { tau });
    return { element_ref: pin.element_ref, colliding_with: pin.colliding_with || null, defect_class: pin.defect_class || 'other',
      severity: pin.severity || null, caught: r.caught, via: r.via, matchedEvent: r.event, missReason: r.reason,
      injectionSeed: injectionSeed(pin) };
  });
  // per-axis (per defect_class) rollup
  const byAxis = {};
  for (const pp of perPin) {
    const k = pp.defect_class;
    (byAxis[k] ||= { caught: 0, total: 0, misses: [] });
    byAxis[k].total++;
    if (pp.caught) byAxis[k].caught++; else byAxis[k].misses.push({ element_ref: pp.element_ref, reason: pp.missReason });
  }
  const recallByAxis = Object.fromEntries(Object.entries(byAxis).map(([k, v]) => [k, { caught: v.caught, total: v.total, recall: v.total ? +(v.caught / v.total).toFixed(3) : null, misses: v.misses }]));
  const totalCaught = perPin.filter((p) => p.caught).length;
  const overall = { caught: totalCaught, total: perPin.length, recall: perPin.length ? +(totalCaught / perPin.length).toFixed(3) : null };
  return {
    tool: 'eval/grader/annotate/annotation-recall.mjs',
    mode: 'VALIDATION/RECALL-DIAGNOSIS ONLY',
    noWeightFit: true,                 // asserted: nothing here writes a grader weight/floor/tolerance/τ
    tau,
    ledger: { events: events.length, pageScore, source: meta.source || null, clone: meta.clone || null },
    overall,
    recallByAxis,
    perPin,
    injectionSeeds: perPin.map((p) => p.injectionSeed),
  };
}

// ── JSONL / JSON loaders ──
function loadAnnotations(p) {
  const raw = fs.readFileSync(p, 'utf8');
  // accept JSONL (one pin per line) OR a JSON array OR {pins:[...]} / {annotations:[...]}
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);
  // a SINGLE JSON object (a {pins:[...]} / {annotations:[...]} wrapper or one pin) parses cleanly as one blob.
  // JSONL (one pin per line, each line is a `{...}` object) does NOT parse as one blob — fall through to per-line.
  if (trimmed.startsWith('{')) {
    try { const o = JSON.parse(trimmed); return o.pins || o.annotations || (o.element_ref ? [o] : []); } catch { /* JSONL — parse per line below */ }
  }
  return trimmed.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// OFFLINE SELFTEST — a SYNTHETIC annotation set + a SYNTHETIC ledger → the probe computes a correct recall/miss.
// By construction: some pins are CAUGHT (the synthetic ledger has the matching event) and some are MISSED (no
// matching event / wrong axis / below band). No capture, no engine, no network.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
export function runSelftest() {
  const cases = [];
  const ok = (name, pass, detail = '') => cases.push({ name, pass: !!pass, detail });

  // stamps (tagchain|nth|hHASH). Containment via the '>' chain in the tagchain.
  const HERO = 'body>main>section|1|haaaa1111';
  const HERO_H1 = 'body>main>section>h1|1|hbbbb2222';   // descendant of HERO
  const LOGO = 'body>header>a>img|1|hcccc3333';
  const CTA = 'body>main>section>a|2|hdddd4444';
  const FOOTER = 'body>footer|1|heeee5555';
  const SECT_A = 'body>main>section|3|hffff6666';
  const SECT_B = 'body>main>section|4|hgggg7777';
  const RECOLOR_P = 'body>main>p|5|hiiii8888';
  const ORPHAN = 'body>aside>span|9|hzzzz9999';          // nothing in the ledger localizes here

  // ── SYNTHETIC LEDGER (engine-output shape) — deliberately contains some matches and omits/mismatches others ──
  const ledger = {
    meta: { source: 'https://selftest.local', clone: 'http://localhost:8001/?page_id=selftest' },
    pageScore: 0.61,
    events: [
      // wrong-logo: img-src on the logo bucket → CAUGHT (exact)
      { ref: LOGO, class: 'wrong-logo', firedAxes: ['img-src'], severity: 0.71, bucket: 'logo', role: 'img' },
      // invisible-heading on the hero H1 → human pinned the HERO (ancestor) → CAUGHT via descendant
      { ref: HERO_H1, class: 'invisible-heading', firedAxes: ['text-contrast'], severity: 0.66, bucket: 'h1', role: 'heading' },
      // collision EDGE event covering SECT_A × SECT_B → CAUGHT (relational-pair)
      { ref: `${SECT_A}×${SECT_B}`, class: 'overlapping-sections', firedAxes: ['collision'], severity: 0.58, a: SECT_A, b: SECT_B },
      // recolor: color-deltaE on a paragraph, but LOW severity (below the strong-pin band) → MISS (severity band)
      { ref: RECOLOR_P, class: 'color-off', firedAxes: ['color-deltaE'], severity: 0.18, role: null },
      // CTA localized but only a bbox-ratio at trivial severity, human pinned 'unstyled-cta' strong → caught? we
      // make it a real unstyled-cta at good severity → CAUGHT (exact)
      { ref: CTA, class: 'unstyled-cta', firedAxes: ['color-deltaE', 'bbox-ratio'], severity: 0.49, bucket: 'cta' },
      // a footer geometry event on a DIFFERENT axis than what the missing-imagery pin needs → axis mismatch MISS
      { ref: FOOTER, class: 'wrong-layout', firedAxes: ['bbox-ratio'], severity: 0.4, role: 'contentinfo' },
    ],
  };

  // ── SYNTHETIC ANNOTATION SET (human pins) ──
  const pins = [
    { element_ref: LOGO, defect_class: 'wrong-logo', severity: 5, note: 'wrong wordmark' },                  // CAUGHT exact
    { element_ref: HERO, defect_class: 'invisible-heading', severity: 4, note: 'headline unreadable' },       // CAUGHT via descendant (HERO_H1)
    { element_ref: SECT_A, colliding_with: SECT_B, defect_class: 'collision', severity: 5, note: 'B over A' },// CAUGHT relational-pair
    { element_ref: RECOLOR_P, defect_class: 'recolor', severity: 5, note: 'wrong brand color' },              // MISS (below strong band; ev sev 0.18 < 0.30)
    { element_ref: CTA, defect_class: 'unstyled-cta', severity: 4, note: 'button lost its fill' },            // CAUGHT exact
    { element_ref: FOOTER, defect_class: 'missing-imagery', severity: 3, note: 'footer logo gone' },          // MISS (axis mismatch: bbox vs img/presence)
    { element_ref: ORPHAN, defect_class: 'blank-hero', severity: 4, note: 'nothing localizes here' },         // MISS (no locality)
  ];

  const out = runRecall(pins, ledger, { tau: DEFAULT_TAU });

  // (a) overall recall = 4/7 by construction
  ok('(a) overall caught = 4', out.overall.caught === 4, `caught=${out.overall.caught}/${out.overall.total}`);
  ok('(a) overall total = 7', out.overall.total === 7, `total=${out.overall.total}`);

  // (b) per-axis (per defect_class) numbers are correct
  ok('(b) wrong-logo 1/1', out.recallByAxis['wrong-logo'].caught === 1 && out.recallByAxis['wrong-logo'].total === 1, JSON.stringify(out.recallByAxis['wrong-logo']));
  ok('(b) invisible-heading 1/1 (via descendant)', out.recallByAxis['invisible-heading'].caught === 1, JSON.stringify(out.recallByAxis['invisible-heading']));
  ok('(b) collision 1/1 (relational-pair)', out.recallByAxis['collision'].caught === 1, JSON.stringify(out.recallByAxis['collision']));
  ok('(b) unstyled-cta 1/1', out.recallByAxis['unstyled-cta'].caught === 1, JSON.stringify(out.recallByAxis['unstyled-cta']));
  ok('(b) recolor 0/1 (severity-band MISS)', out.recallByAxis['recolor'].caught === 0 && out.recallByAxis['recolor'].total === 1, JSON.stringify(out.recallByAxis['recolor']));
  ok('(b) missing-imagery 0/1 (axis-mismatch MISS)', out.recallByAxis['missing-imagery'].caught === 0, JSON.stringify(out.recallByAxis['missing-imagery']));
  ok('(b) blank-hero 0/1 (no-locality MISS)', out.recallByAxis['blank-hero'].caught === 0, JSON.stringify(out.recallByAxis['blank-hero']));

  // (c) the CAUGHT pins carry the right "via" relation
  const byRef = Object.fromEntries(out.perPin.map((p) => [p.element_ref, p]));
  ok('(c) hero pin caught via descendant', byRef[HERO].caught && byRef[HERO].via === 'descendant', byRef[HERO].via);
  ok('(c) collision pin caught via relational-pair', byRef[SECT_A].caught && byRef[SECT_A].via === 'relational-pair', byRef[SECT_A].via);
  ok('(c) logo pin caught via exact', byRef[LOGO].caught && byRef[LOGO].via === 'exact', byRef[LOGO].via);

  // (d) miss REASONS are the right KIND (diagnosis quality)
  ok('(d) recolor miss reason = severity band', /severity band/i.test(byRef[RECOLOR_P].missReason), byRef[RECOLOR_P].missReason);
  ok('(d) missing-imagery miss reason = axis mismatch', /axis/i.test(byRef[FOOTER].missReason), byRef[FOOTER].missReason);
  ok('(d) orphan miss reason = no locality', /did not localize/i.test(byRef[ORPHAN].missReason), byRef[ORPHAN].missReason);

  // (e) injection-seed adapter: one CATEGORY per pin, NO tuned constants, pair set for relational
  ok('(e) collision pin → translate-onto category with a pairRef', byRef[SECT_A].injectionSeed.category === 'translate-onto' && byRef[SECT_A].injectionSeed.pairRef === SECT_B, JSON.stringify(byRef[SECT_A].injectionSeed));
  ok('(e) logo pin → swap-asset-src category, no constants', byRef[LOGO].injectionSeed.category === 'swap-asset-src' && /label-blind/i.test(byRef[LOGO].injectionSeed.paramsSource), JSON.stringify(byRef[LOGO].injectionSeed));
  ok('(e) every pin has exactly one injection seed', out.injectionSeeds.length === pins.length, `seeds=${out.injectionSeeds.length}`);

  // (f) THE EVAL-INTEGRITY ASSERTION: noWeightFit is true and the probe imported no engine + wrote nothing.
  ok('(f) noWeightFit === true (validation only, no weight/tolerance fit)', out.noWeightFit === true, String(out.noWeightFit));

  // (g) ledger-shape normalization: a grade-fused wrapper {engine:{events}} normalizes identically
  const wrapped = { engine: { events: ledger.events, pageScore: ledger.pageScore, meta: ledger.meta } };
  const out2 = runRecall(pins, wrapped, { tau: DEFAULT_TAU });
  ok('(g) wrapped {engine:{events}} ledger → same recall', out2.overall.caught === out.overall.caught, `caught=${out2.overall.caught}`);

  const passed = cases.filter((c) => c.pass).length;
  return { passed, total: cases.length, allPass: passed === cases.length, cases,
    selftestRecall: { caught: out.overall.caught, total: out.overall.total, recall: out.overall.recall } };
}

export const SCHEMA = {
  tool: 'eval/grader/annotate/annotation-recall.mjs',
  purpose: 'wire human sticky-note annotations → grader RECALL VALIDATION (NOT weight-fitting)',
  noWeightFit: true,
  evalIntegrity: 'reads a FROZEN ledger + FROZEN annotations; imports no engine; writes no weight/floor/tolerance/τ; a MISS = a reported coverage gap → a synthetic-injection fixture TODO, never a grader knob',
  annotationPin: {
    element_ref: 'stamp tagchain|nth|hHASH (= --joist-src of the pinned widget)',
    colliding_with: 'optional second stamp (relational collision pin: "this is over that")',
    bbox: 'getBoundingClientRect at pin time (diagnostic only; not used for matching)',
    viewport_w: 'capture width', scroll_y: 'scroll at pin time',
    defect_class: KNOWN_DEFECTS, severity: '1..5', note: 'free text',
  },
  ledgerRow: '{ ref, viewport, role, bucket, class, dominantAxis, severity, firedAxes[], ... } (axisdelta-engine event)',
  matchSemantics: {
    locality: ['exact', 'ancestor', 'descendant', 'relational-pair', 'relational-endpoint'],
    axisMatch: 'human defect_class → DEFECT_AXES (fixed taxonomy bridge, same axis vocab the grader projects names from)',
    severityBand: `coarse monotone: ev.severity ≥ τ(${DEFAULT_TAU}); strong pin(≥${STRONG_PIN_SEVERITY}) needs ev.severity ≥ ${MIN_SEV_FOR_STRONG}; NOT an exact-fit`,
  },
  defectAxes: DEFECT_AXES,
  injectionCategories: INJECTION_CATEGORY,
  output: '{ overall:{caught,total,recall}, recallByAxis:{<defect>:{caught,total,recall,misses}}, perPin[], injectionSeeds[] }',
};

// ── CLI ──
function main() {
  if (has('schema')) { console.log(JSON.stringify(SCHEMA, null, 2)); return; }
  if (has('selftest')) {
    const r = runSelftest();
    console.log('\n==== annotation-recall SELFTEST (synthetic annotations + synthetic ledger) ====');
    for (const c of r.cases) console.log(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
    console.log(`\n  selftest recall (by construction): ${r.selftestRecall.caught}/${r.selftestRecall.total} = ${r.selftestRecall.recall}`);
    console.log(`  ${r.passed}/${r.total} checks pass — ${r.allPass ? 'ALL PASS' : 'FAILURES PRESENT'}`);
    process.exit(r.allPass ? 0 : 1);
  }
  const aPath = arg('annotations'), lPath = arg('ledger');
  if (!aPath || !lPath) { console.error('usage: node annotation-recall.mjs --annotations pins.jsonl --ledger ledger.json [--tau 0.12] [--json] [--out diag.json]\n       node annotation-recall.mjs --selftest | --schema'); process.exit(2); }
  const annotations = loadAnnotations(aPath);
  const ledgerRaw = JSON.parse(fs.readFileSync(lPath, 'utf8'));
  const tau = +arg('tau', DEFAULT_TAU);
  const out = runRecall(annotations, ledgerRaw, { tau });

  console.log('\n==== ANNOTATION RECALL PROBE (human pins vs grader ledger) — VALIDATION ONLY (noWeightFit) ====');
  console.log(`annotations: ${aPath}  (${out.perPin.length} pins)`);
  console.log(`ledger: ${lPath}  (${out.ledger.events} events, pageScore ${out.ledger.pageScore})  τ=${tau}\n`);
  console.log('RECALL BY AXIS (human defect_class):');
  for (const [k, v] of Object.entries(out.recallByAxis)) {
    console.log(`  ${k.padEnd(22)} ${v.caught}/${v.total} caught (${(v.recall * 100).toFixed(0)}%)`);
    for (const m of v.misses) console.log(`        MISS ${String(m.element_ref).slice(0, 48)} — ${m.reason}`);
  }
  console.log(`\nOVERALL RECALL: ${out.overall.caught}/${out.overall.total} = ${(out.overall.recall * 100).toFixed(0)}%`);
  console.log('\nINJECTION SEEDS (per-pin synthetic-fixture CATEGORY for label-blind validation of each MISS):');
  for (const s of out.injectionSeeds) console.log(`  ${String(s.fromDefectClass).padEnd(22)} → ${s.category}  (${s.op})`);

  if (has('json')) console.log('\n' + JSON.stringify(out, null, 2));
  const outPath = arg('out');
  if (outPath) { fs.writeFileSync(outPath, JSON.stringify(out, null, 2)); console.log(`\nwrote diagnosis → ${outPath}`); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
