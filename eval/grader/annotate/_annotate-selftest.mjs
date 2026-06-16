#!/usr/bin/env node
/**
 * @purpose OFFLINE self-test for the sticky-note annotation tool. NO live render, NO browser, NO host:
 * it exercises the PURE resolve / picker / store logic (annotate-core.js — the SAME module annotate.js
 * imports) on a SYNTHETIC element stack, proving the load-bearing path works:
 *   elementsFromPoint(z-stack) → walkToStamp(nearest --joist-src owner) → resolveZStack(dedupe, cap 4)
 *   → makePin(primary + relational colliding_with) → JSONL serialize (byte-identical round-trip).
 *
 * Plus the RECALL PROBE — VALIDATION ONLY (per the eval-integrity rail): it JOINS a synthetic set of
 * human pins against a synthetic grader ledger (axisdelta element rows + relational collision edges
 * {a,b} + a fired veto) by --joist-src stamp, and reports per-defect recall + a severity-rank check.
 * It asserts it MUTATES NOTHING the grader trusts (axis-floors / weights are deep-frozen + compared
 * byte-for-byte before/after) and that recall is INVARIANT under a permutation of the pins' free-text
 * LABELS (the probe keys on STAMPS, not on label text — so it can never be a back-channel to fit grader
 * tolerances to human labels).
 *
 * Run:  node _annotate-selftest.mjs        (exit 0 = all pass)
 */
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';
import {
  walkToStamp, resolveZStack, makePin, validatePin, isStamp,
  pinToLine, pinsToJsonl, jsonlToPins, canonicalDefect, resolveSourceRegion,
  DEFECT_VALUES,
} from './annotate-core.js';
import { _guardSelftest } from './guard.js';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? '  — ' + extra : ''}`); }
};

// ── SYNTHETIC ELEMENT STACK ───────────────────────────────────────────────────────
// A minimal DOM stand-in: nodes carry .__tag, .__stamp (the raw --joist-src as getComputedStyle would
// return it — QUOTED), .parentElement, and getBoundingClientRect(). --joist-src INHERITS, so a stamped
// wrapper's children read the SAME stamp (we model that: a child with __stamp:null inherits its parent's).
function node(tag, stamp, box, parent = null) {
  const n = {
    __tag: tag, tagName: tag.toUpperCase(),
    __ownStamp: stamp, // own declared stamp (null = inherits)
    parentElement: parent,
    getBoundingClientRect() { return { x: box.x, y: box.y, width: box.w, height: box.h, right: box.x + box.w, bottom: box.y + box.h }; },
    __box: box,
  };
  return n;
}
// read(): the getComputedStyle('--joist-src') stand-in — INHERITED, returns the nearest ancestor's
// own stamp (quoted, whitespace-padded — exactly what the browser hands back), or '' if none.
function readInherited(n) {
  let cur = n;
  while (cur) { if (cur.__ownStamp) return `  "${cur.__ownStamp}" `; cur = cur.parentElement; }
  return '';
}
const bboxOf = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };

// Build a stack with an OVERLAP at one point: a footer (topmost) over a hero section, each a stamped
// wrapper; the hero has a heading child (inherits the hero stamp → dedupes to the hero owner).
const S = {
  logo: 'body>header|1|haaaa0001',
  hero: 'body>main>section|1|heeee0005',
  heading: 'body>main>section>h1|1|hbbbb0002',
  cta: 'body>main>section>a|1|hcccc0003',
  footer: 'body>footer|1|hdddd0004',
};
const footer = node('footer', S.footer, { x: 0, y: 100, w: 980, h: 420 });
const heroSection = node('section', S.hero, { x: 0, y: 100, w: 980, h: 420 });
const heroHeadingText = node('span', null, { x: 60, y: 120, w: 720, h: 40 }, node('h1', S.heading, { x: 60, y: 120, w: 720, h: 90 }, heroSection));
// elementsFromPoint at the overlap returns TOPMOST FIRST: [footer, heroHeadingText(inherits heading), heroSection, ...]
const hitsOverlap = [footer, heroHeadingText, heroSection];

// ── (1) walkToStamp: inherited stamp resolves to the OWNING wrapper ─────────────────
{
  const w = walkToStamp(heroHeadingText, readInherited);
  ok('walkToStamp: inherited child resolves to its stamped owner', w && w.stamp === S.heading, JSON.stringify(w));
  ok('walkToStamp: quotes + whitespace stripped from the stamp', w && isStamp(w.stamp), w && w.stamp);
  const none = walkToStamp(node('div', null, { x: 0, y: 0, w: 1, h: 1 }), readInherited);
  ok('walkToStamp: unstamped subtree → null', none === null);
}

// ── (2) resolveZStack: dedupe-by-stamp, cap 4, topmost-first ────────────────────────
{
  const cands = resolveZStack(hitsOverlap, readInherited, bboxOf, 4);
  ok('resolveZStack: distinct stamps collected (footer + heading + hero = 3)', cands.length === 3, JSON.stringify(cands.map((c) => c.stamp)));
  ok('resolveZStack: topmost-first order preserved (footer at z0)', cands[0].stamp === S.footer, cands[0].stamp);
  ok('resolveZStack: dedupes the inherited heading to ONE owner', cands.filter((c) => c.stamp === S.heading).length === 1);
  // cap: a stack of 6 distinct stamped owners caps at 4
  const big = Array.from({ length: 6 }, (_, i) => node('div', `body>d${i}|${i + 1}|h0000000${i}`, { x: 0, y: 0, w: 10, h: 10 }));
  ok('resolveZStack: caps at 4', resolveZStack(big, readInherited, bboxOf, 4).length === 4);
  ok('resolveZStack: carries a usable bbox', Number.isFinite(cands[0].bbox.w) && cands[0].bbox.w > 0);
}

// ── (3) makePin: relational pin (primary + colliding_with) + validation ─────────────
let relationalPin, simplePin;
{
  const cands = resolveZStack(hitsOverlap, readInherited, bboxOf, 4);
  // primary = footer (the offender, on top), colliding_with = hero (the thing it overlaps)
  relationalPin = makePin({
    element_ref: cands[0].stamp, colliding_with: cands[2].stamp,
    bbox: cands[0].bbox, viewport_w: 980, scroll_y: 0,
    defect_class: 'overlapping-sections', severity: 5, note: 'footer slid up over the hero', page_id: '2551',
  });
  ok('makePin: relational pin has primary element_ref', relationalPin.element_ref === S.footer);
  ok('makePin: relational pin captures colliding_with', relationalPin.colliding_with === S.hero);
  ok('makePin: relational pin is valid', validatePin(relationalPin).length === 0, validatePin(relationalPin).join('; '));

  simplePin = makePin({
    element_ref: S.heading, bbox: { x: 60, y: 120, w: 720, h: 90 },
    viewport_w: 980, scroll_y: 0, defect_class: 'invisible-heading', severity: 4, note: 'white on white',
  });
  ok('makePin: simple pin omits colliding_with', !('colliding_with' in simplePin));

  // validation rejects: self-collision, bad severity, non-stamp ref, collapsed bbox
  ok('validatePin: rejects self-collision', validatePin({ ...relationalPin, colliding_with: relationalPin.element_ref }).length > 0);
  ok('validatePin: rejects severity out of 1-5', validatePin({ ...simplePin, severity: 9 }).length > 0);
  ok('validatePin: rejects a non-stamp element_ref', validatePin({ ...simplePin, element_ref: 'not-a-stamp' }).length > 0);
  ok('validatePin: rejects a zero-size bbox', validatePin({ ...simplePin, bbox: { x: 0, y: 0, w: 0, h: 0 } }).length > 0);
  // canonical defect mapping: grader aliases fold onto our dropdown values
  ok('canonicalDefect: broken-hero → blank-hero', canonicalDefect('broken-hero') === 'blank-hero');
  ok('canonicalDefect: collision → overlapping-sections', canonicalDefect('collision') === 'overlapping-sections');
  ok('canonicalDefect: unknown → other', canonicalDefect('zonk') === 'other');
}

// ── (4) JSONL serialization: byte-identical round-trip ──────────────────────────────
{
  const pins = [relationalPin, simplePin];
  const jsonl = pinsToJsonl(pins);
  const back = jsonlToPins(jsonl);
  const jsonl2 = pinsToJsonl(back);
  ok('JSONL: round-trip is byte-identical', jsonl === jsonl2);
  ok('JSONL: parses back to the same pin count', back.length === 2);
  ok('JSONL: a single line round-trips byte-identical', pinToLine(relationalPin) === pinToLine(jsonlToPins(pinToLine(relationalPin))[0]));
  // each line is a single valid JSON object (true NDJSON)
  ok('JSONL: every line is valid JSON', jsonl.trim().split('\n').every((l) => { try { JSON.parse(l); return true; } catch { return false; } }));
}

// ── (5) source-region resolution (left-pane highlight join) ─────────────────────────
{
  // read the synthetic fixture written by `prep-assets.mjs --synthetic`
  const fs = (await import('node:fs')).default;
  const fixturePath = path.join(HERE, 'assets', 'synthetic', 'source-bbox.json');
  const sb = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const region = resolveSourceRegion(S.hero, sb);
  ok('resolveSourceRegion: a stamped pin maps to a source box', region && region.w > 0, JSON.stringify(region));
  ok('resolveSourceRegion: an unstamped/synthetic-only stamp → null', resolveSourceRegion('body>nope|1|hffffffff', sb) === null);
}

// ── (6) RECALL PROBE — VALIDATION ONLY (no mutation; label-permutation invariant) ───
// A synthetic GRADER LEDGER: element rows (axisdelta) + relational collision edges {a,b} + a fired veto.
// Frozen floors/weights stand in for the real axis-floors.json/weights — the probe must NOT touch them.
const graderLedger = Object.freeze({
  axisFloors: Object.freeze({ collision: 0.05, 'h-overflow': 0.5, invisible: 0.5 }),
  weights: Object.freeze({ geometry: 0.5, asset: 0.3, text: 0.2 }),
  // element-level defects the grader flagged (keyed by --joist-src ref):
  elementRows: [
    { ref: S.heading, class: 'invisible-heading', magnitude: 0.8 },
    { ref: S.logo, class: 'wrong-logo', magnitude: 0.6 },
  ],
  // relational collision edges (axisdelta relRow extra {a,b}):
  collisionEdges: [{ a: S.footer, b: S.hero, class: 'overlapping-sections', delta: 0.42 }],
  // a fired veto (veto-detectors): blank-hero on the hero section
  vetoes: [{ veto: 'blank-hero', ref: S.hero, severity: 0.9 }],
});

// The synthetic HUMAN pin set (what a person pinned):
const humanPins = [
  relationalPin,                                              // footer ⇄ hero collision  → collisionEdges
  simplePin,                                                  // heading invisible        → elementRows
  makePin({ element_ref: S.logo, bbox: { x: 40, y: 24, w: 180, h: 48 }, viewport_w: 980, scroll_y: 0, defect_class: 'wrong-logo', severity: 5, note: 'wrong brand' }),
  makePin({ element_ref: S.cta, bbox: { x: 60, y: 240, w: 200, h: 56 }, viewport_w: 980, scroll_y: 0, defect_class: 'unstyled-cta', severity: 2, note: 'plain button — grader MISSED this' }),
];

// PURE probe: did the grader catch what the human pinned? Joins by STAMP only (never by label text).
function recallProbe(pins, ledger) {
  // index grader hits by ref (element rows + veto refs + both endpoints of each collision edge)
  const graderRefs = new Map(); // ref -> Set(canonical defect classes)
  const add = (ref, cls) => { if (!graderRefs.has(ref)) graderRefs.set(ref, new Set()); graderRefs.get(ref).add(canonicalDefect(cls)); };
  for (const r of ledger.elementRows) add(r.ref, r.class);
  for (const v of ledger.vetoes) add(v.ref, v.veto);
  const edgeSet = new Set(ledger.collisionEdges.map((e) => [e.a, e.b].sort().join('×')));
  const perDefect = {}; const caught = []; const missed = [];
  for (const pin of pins) {
    let hit = false;
    if (pin.colliding_with) {
      // relational pin → matches a collision edge if BOTH endpoints align (order-independent)
      hit = edgeSet.has([pin.element_ref, pin.colliding_with].sort().join('×'));
    } else {
      const g = graderRefs.get(pin.element_ref);
      hit = !!(g && g.has(pin.defect_class));
    }
    (perDefect[pin.defect_class] ||= { caught: 0, total: 0 }).total++;
    if (hit) { perDefect[pin.defect_class].caught++; caught.push(pin); } else missed.push(pin);
  }
  return { perDefect, caughtCount: caught.length, missedCount: missed.length, missed };
}

const r1 = recallProbe(humanPins, graderLedger);
ok('recall probe: relational collision pin JOINS the collision edge', r1.perDefect['overlapping-sections'].caught === 1);
ok('recall probe: invisible-heading pin JOINS an element row', r1.perDefect['invisible-heading'].caught === 1);
ok('recall probe: wrong-logo pin JOINS an element row', r1.perDefect['wrong-logo'].caught === 1);
ok('recall probe: unstyled-cta pin is a MISS (grader gap surfaced — validation, not back-fit)',
  r1.perDefect['unstyled-cta'].caught === 0 && r1.missed.some((p) => p.defect_class === 'unstyled-cta'));
ok('recall probe: overall recall = 3/4', r1.caughtCount === 3 && r1.missedCount === 1);

// severity-rank sanity: the human's top-severity pins are among the caught (a weak proxy, no fitting)
{
  const bySev = [...humanPins].sort((a, b) => b.severity - a.severity);
  ok('recall probe: highest-severity pin (sev5) was caught', recallProbe([bySev[0]], graderLedger).caughtCount === 1);
}

// NO-MUTATION invariant: the probe must not have altered the frozen floors/weights (byte-identical).
{
  const before = JSON.stringify({ f: graderLedger.axisFloors, w: graderLedger.weights });
  recallProbe(humanPins, graderLedger); // run again
  const after = JSON.stringify({ f: graderLedger.axisFloors, w: graderLedger.weights });
  ok('recall probe: axis floors + weights UNCHANGED (no back-fit into the grader)', before === after);
  // frozen → a write attempt is a no-op/throw, proving structural immutability
  let mutated = false;
  try { graderLedger.axisFloors.collision = 999; if (graderLedger.axisFloors.collision === 999) mutated = true; } catch {}
  ok('recall probe: floors are FROZEN (write is a no-op/throws)', !mutated);
}

// LABEL-PERMUTATION INVARIANT: permuting the pins' free-text NOTES (the human "labels") must NOT change
// recall — the probe keys on STAMPS, so it can never be a channel to fit the grader to label text.
{
  const permuted = humanPins.map((p, i) => ({ ...p, note: humanPins[(i + 1) % humanPins.length].note }));
  const r2 = recallProbe(permuted, graderLedger);
  ok('recall probe: recall INVARIANT under a note/label permutation (stamp-keyed, not label-keyed)',
    r2.caughtCount === r1.caughtCount && r2.missedCount === r1.missedCount);
}

// ── (7) guard mirror selftest (host rail) ───────────────────────────────────────────
{
  const gcases = _guardSelftest();
  const gfail = gcases.filter((c) => !c.passed);
  for (const c of gcases) ok('guard: ' + c.name, c.passed, c.threw);
  ok('guard: refuses every non-8001 / blocked host', gfail.length === 0);
}

// ── (8) serve.mjs route table + guard refusal (child selftest) ──────────────────────
{
  const r = spawnSync('node', [path.join(HERE, 'serve.mjs'), '--selftest'], { encoding: 'utf8' });
  const passed = r.status === 0 && /ALL PASS/.test(r.stdout || '');
  ok('serve.mjs --selftest ALL PASS (routing + clone-base guard)', passed, (r.stdout || '').trim().split('\n').slice(-2).join(' | '));
}

console.log(`\n${'='.repeat(60)}`);
console.log(`annotate selftest: ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed, ${fail} failed)`);
console.log(`${'='.repeat(60)}`);
process.exit(fail === 0 ? 0 : 1);
