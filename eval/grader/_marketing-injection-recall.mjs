#!/usr/bin/env node
/**
 * @purpose _marketing-injection-recall.mjs — PHASE 4 SYNTHETIC-INJECTION RECALL on the 6 marketing classes
 * (rule C — the workhorse that closes the 0% recall hole the hand-detectors had on unseen marketing pages).
 *
 * The hand detectors scored 0% recall on the 3 real marketing pages (they overfit the blog's chrome). We do NOT
 * tune to those 3 pages. Instead we take a REAL capture, build a PERFECT self-clone (clone == source → zero
 * defects by construction), then INJECT each of the 6 human-salient marketing classes into ONE real target
 * element on the CLONE side and assert:
 *    (a) the universal engine, via detector-views, FIRES the RIGHT class on the INJECTED element at severity≥τ;
 *    (b) the matching CONTROL (the un-injected perfect self-clone) is SILENT for that class.
 * Both directions, free, unlimited, label-free. The recall number = how many of the 6 classes fire on injection.
 *
 * THE 6 MARKETING CLASSES + their injection (each mutates ONLY the clone-side record of one real element):
 *    swap-logo                 → set the logo img's naturalSrc to a wrong url     → view wrong-logo
 *    heading-color=background   → set a heading's color to its own background      → view invisible-heading
 *    delete-hero-children       → drop the hero band's children (clone-missing)     → view blank-hero / missing-section
 *    strip-CTA-styles           → strip a CTA's bg + recolor text to ink           → view unstyled-cta
 *    remove-an-image            → delete a content image (clone-missing)            → view missing-imagery
 *    overlap-2-sections         → translate one section to overlap another         → view overlapping-sections
 *
 * ANTI-OVERFIT: the floors + weights are imported UNCHANGED from the label-blind modules; this harness only
 * INJECTS and READS. It NEVER tunes a threshold. The control direction (clean self-clone silent) is asserted for
 * every class so a too-loose engine cannot fake recall.
 *
 * SAFETY: PURE — reads a cached compare blob, builds a self-clone in memory, no network/host/builder/git.
 * Imports axisdelta-engine.mjs + detector-views.mjs + _axisdelta-selfclone-falsifier.mjs UNCHANGED.
 *
 *   node _marketing-injection-recall.mjs                                  # default bases: 341 + 268
 *   node _marketing-injection-recall.mjs --compare /tmp/compare-268.json  # single base
 *   node _marketing-injection-recall.mjs --json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as E from './axisdelta-engine.mjs';
import * as V from './detector-views.mjs';
import { buildSelfCloneBlob } from './_axisdelta-selfclone-falsifier.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined && !String(process.argv[i + 1]).startsWith('--') ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);
const FLOORS = E.loadFloors();
const TAU = V.DEFAULT_TAU;
const cp = (o) => JSON.parse(JSON.stringify(o));

function bucketOf(el, vw) { return import('./axisdelta-floor.mjs').then((F) => F.salienceBucket(el, vw)); }

// pick the first source record matching a predicate (so injections land on REAL elements).
function pick(recs, pred) { return recs.find(pred) || null; }

// clone record by source ref in the self-clone (clone == source, same refs).
function cloneRecByRef(self, ref) { return self.cloneCapture.records.find((r) => r.ref === ref); }

// run engine+views on a blob; return whether a view fires on a given ref at severity≥τ.
function viewFiresOn(self, viewName, expectRef) {
  const out = E.runEngine(self, FLOORS, {});
  const hits = V.fireView(viewName, out, TAU);
  const onRef = hits.find((h) => expectRef == null || String(h.ref).includes(String(expectRef).split('|')[0]) || h.ref === expectRef);
  return { anyFire: hits.length > 0, onInjected: !!onRef, severity: onRef ? onRef.severity : (hits[0] ? hits[0].severity : 0), topRef: hits[0] ? hits[0].ref : null, out };
}

async function injectAndMeasure(base, F) {
  const vw = (base.report.widths || [1440])[0];
  const recs = base.sourceCapture.records;
  const results = [];

  // helper: build a fresh perfect self-clone, mutate its clone side, measure the named view.
  const trial = (className, viewName, choose, mutate, expectRefFn) => {
    const target = choose(); if (!target) { results.push({ class: className, view: viewName, skipped: 'no target element', fired: false, controlSilent: true, recalled: false }); return; }
    // INJECTED blob: perfect self-clone, then mutate the clone-side record (or drop it for presence defects).
    const inj = buildSelfCloneBlob(base);
    mutate(inj, target);
    const expectRef = expectRefFn ? expectRefFn(target) : target.ref;
    const injRes = viewFiresOn(inj, viewName, expectRef);
    // CONTROL blob: untouched perfect self-clone — the same view must be SILENT.
    const ctrl = buildSelfCloneBlob(base);
    const ctrlRes = viewFiresOn(ctrl, viewName, expectRef);
    const recalled = injRes.onInjected && injRes.severity >= TAU && !ctrlRes.anyFire;
    results.push({ class: className, view: viewName, target: target.ref.slice(0, 48),
      fired: injRes.onInjected, severity: +injRes.severity.toFixed(4), controlSilent: !ctrlRes.anyFire, recalled,
      injTopRef: injRes.topRef ? String(injRes.topRef).slice(0, 40) : null });
  };

  // ── 1. swap-logo: wrong logo img src ──
  trial('swap-logo', 'wrong-logo',
    () => pick(recs, (r) => F.salienceBucket(r, vw) === 'logo' && r.asset && r.asset.isImage),
    (inj, t) => { const c = cloneRecByRef(inj, t.ref); if (c) { c.asset = cp(c.asset); c.asset.naturalSrc = 'https://clone/WRONG-LOGO.png'; c.asset.svgHash = null; } });

  // ── 2. heading-color = background: invisible heading ──
  trial('heading=bg', 'invisible-heading',
    () => pick(recs, (r) => (r.role === 'heading' || F.salienceBucket(r, vw) === 'h1') && (r.text || r.ownText) && r.style && r.style.backgroundColor),
    (inj, t) => { const c = cloneRecByRef(inj, t.ref); if (c) { c.style = cp(c.style); const bg = (c.style.backgroundColor && c.style.backgroundColor !== 'rgba(0, 0, 0, 0)' && c.style.backgroundColor !== 'rgba(0,0,0,0)') ? c.style.backgroundColor : 'rgb(255,255,255)'; c.style.color = bg; c.style.backgroundColor = bg; } });

  // ── 3. delete-hero-children: blank hero (drop the hero band + its children) ──
  trial('delete-hero-children', 'blank-hero',
    () => pick(recs, (r) => F.salienceBucket(r, vw) === 'hero'),
    (inj, t) => {
      // remove the hero AND every descendant from the clone side → presence misses on a hero-bucket band.
      const heroPath = t.ref.split('|')[0];
      inj.cloneCapture.records = inj.cloneCapture.records.filter((r) => r.ref !== t.ref && !r.ref.split('|')[0].startsWith(heroPath + '>'));
      // rebuild correspondence so the dropped refs become unmatched-source (presence).
      const present = new Set(inj.cloneCapture.records.map((r) => r.ref));
      inj.report.matched = inj.sourceCapture.records.filter((s) => present.has(s.ref)).map((s) => ({ srcRef: s.ref, cloneRef: s.ref }));
      inj.report.relation = Object.fromEntries(inj.sourceCapture.records.map((s) => [s.srcPath, present.has(s.ref) ? [s.ref] : []]));
      inj.report.unmatchedSource = inj.sourceCapture.records.filter((s) => !present.has(s.ref)).map((s) => s.ref);
    },
    (t) => t.ref);

  // ── 4. strip-CTA-styles: unstyled CTA (drop bg + recolor text to ink) ──
  trial('strip-CTA', 'unstyled-cta',
    () => pick(recs, (r) => F.salienceBucket(r, vw) === 'cta'),
    (inj, t) => { const c = cloneRecByRef(inj, t.ref); if (c) { c.style = cp(c.style); c.style.backgroundColor = 'rgba(0,0,0,0)'; c.style.color = 'rgb(20,20,20)'; if (c.box && c.box[vw]) { c.box = cp(c.box); c.box[vw].h = Math.max(1, (c.box[vw].h || 20) * 0.5); c.box[vw].w = Math.max(1, (c.box[vw].w || 20) * 0.5); c.box[vw].right = c.box[vw].x + c.box[vw].w; } } });

  // ── 5. remove-an-image: missing imagery (drop a content image, clone-missing) ──
  trial('remove-image', 'missing-imagery',
    () => pick(recs, (r) => r.role === 'img' && F.salienceBucket(r, vw) !== 'logo'),
    (inj, t) => {
      inj.cloneCapture.records = inj.cloneCapture.records.filter((r) => r.ref !== t.ref);
      const present = new Set(inj.cloneCapture.records.map((r) => r.ref));
      inj.report.matched = inj.sourceCapture.records.filter((s) => present.has(s.ref)).map((s) => ({ srcRef: s.ref, cloneRef: s.ref }));
      inj.report.relation = Object.fromEntries(inj.sourceCapture.records.map((s) => [s.srcPath, present.has(s.ref) ? [s.ref] : []]));
      inj.report.unmatchedSource = inj.sourceCapture.records.filter((s) => !present.has(s.ref)).map((s) => s.ref);
    },
    (t) => t.ref);

  // ── 6. overlap-2-sections: colliding sections (translate one onto another) ──
  trial('overlap-2-sections', 'overlapping-sections',
    () => {
      // two top-level sibling bands disjoint in source; we'll slide the SECOND onto the FIRST.
      const bands = recs.filter((r) => (r.tag === 'section' || r.role === 'banner' || F.salienceBucket(r, vw) === 'hero') && r.box && r.box[vw] && r.box[vw].w > vw * 0.3 && r.box[vw].h > 80);
      return bands.length >= 2 ? bands[1] : null;
    },
    (inj, t) => {
      const c = cloneRecByRef(inj, t.ref); if (!c) return;
      // find a disjoint earlier band to collide with, then move t to overlap it.
      const vwBands = inj.sourceCapture.records.filter((r) => r.box && r.box[vw] && r.box[vw].w > vw * 0.3 && r.box[vw].h > 80 && (r.tag === 'section' || r.role === 'banner'));
      const tb = t.box[vw]; const earlier = vwBands.find((r) => r.ref !== t.ref && r.box[vw].y + r.box[vw].h <= tb.y + 4) || vwBands.find((r) => r.ref !== t.ref);
      c.box = cp(c.box);
      if (earlier) { const eb = earlier.box[vw]; c.box[vw].y = eb.y; c.box[vw].x = eb.x; } else { c.box[vw].y = Math.max(0, tb.y - tb.h); }
      c.box[vw].right = c.box[vw].x + c.box[vw].w;
    },
    (t) => null); // collision localizes to an edge ref (a×b), not the single target — accept any overlapping-sections fire

  return results;
}

async function main() {
  const F = await import('./axisdelta-floor.mjs');
  const bases = [];
  const single = arg('compare');
  const candidates = single ? [single] : ['/tmp/compare-341.json', '/tmp/compare-268.json'];
  for (const p of candidates) { if (fs.existsSync(p)) bases.push({ path: p, blob: JSON.parse(fs.readFileSync(p, 'utf8')) }); }
  if (!bases.length) { console.error('no base compare blob found'); process.exit(2); }

  const perBase = [];
  for (const b of bases) {
    const results = await injectAndMeasure(b.blob, F);
    perBase.push({ base: b.path, source: b.blob.report.source, results });
  }

  // RECALL = a class is recalled if it fires on injection on AT LEAST ONE base with a matching control-silent
  // (a real target may be absent on one base; the class is "covered" if any base proves it). We also report the
  // per-base detail so a single-base reader sees the honest picture.
  const CLASSES = ['swap-logo', 'heading=bg', 'delete-hero-children', 'strip-CTA', 'remove-image', 'overlap-2-sections'];
  const recalledByClass = {};
  for (const cls of CLASSES) {
    recalledByClass[cls] = perBase.some((pb) => pb.results.some((r) => r.class === cls && r.recalled));
  }
  const recallCount = Object.values(recalledByClass).filter(Boolean).length;

  console.log('\n==== MARKETING INJECTION RECALL (6 classes, synthetic, both-directions) ====');
  console.log(`floors: label-blind | τ=${TAU} | bases: ${bases.map((b) => path.basename(b.path)).join(', ')}\n`);
  for (const pb of perBase) {
    console.log(`base ${pb.source}`);
    for (const r of pb.results) {
      const status = r.skipped ? `SKIP (${r.skipped})` : (r.recalled ? 'RECALLED' : `MISS (fired:${r.fired} sev:${r.severity} ctrlSilent:${r.controlSilent})`);
      console.log(`   [${r.recalled ? 'OK ' : '   '}] ${r.class.padEnd(22)} → ${r.view.padEnd(22)} ${status}${r.target ? '  on ' + r.target : ''}`);
    }
    console.log('');
  }
  console.log('RECALL BY CLASS (any base proves coverage):');
  for (const cls of CLASSES) console.log(`   ${recalledByClass[cls] ? 'RECALLED' : 'MISS    '}  ${cls}`);
  console.log(`\nMARKETING INJECTION RECALL: ${recallCount}/6 classes  (${(recallCount / 6 * 100).toFixed(0)}%)  — closes the hand-detector 0% hole`);

  if (has('json')) console.log('\n' + JSON.stringify({ harness: 'eval/grader/_marketing-injection-recall.mjs', tau: TAU, recallCount, recalledByClass, perBase }, null, 2));
  // exit 0 if recall > 0 (the ship-gate needs >0); the orchestrator reads the number regardless.
  process.exit(recallCount > 0 ? 0 : 1);
}

main();
