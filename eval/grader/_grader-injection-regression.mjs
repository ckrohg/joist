#!/usr/bin/env node
/**
 * @purpose _grader-injection-regression.mjs — the INJECTED-DEFECT REGRESSION SUITE for the upleveled grader.
 *
 * Premise (the resolution-catastrophe fix needs a CAUSAL guarantee): a grader that cannot tell a perturbed clone
 * from a clean one is worthless. This suite PROGRAMMATICALLY PERTURBS a CLEAN clone capture (one defect at a time),
 * re-runs grade-element-crops' DETERMINISTIC axis-delta layer (the layer that runs BEFORE any LLM — pure, dep-free,
 * free), and asserts:
 *   (1) the CONTROL (unperturbed clone == source) fires ZERO axis flags (anti-gaming: a clean clone is silent), and
 *   (2) each PERTURBATION fires the RIGHT axis (and the right defect `class`) AND stays silent on the others.
 *
 * The four perturbations are the human-salient fatal classes the calibration corpus is built around:
 *   - delete the logo element      → PRESENCE axis fires `missing-element`
 *   - collapse an H1 contrast ~1:1  → TEXT-CONTRAST axis fires `invisible-text` (paint heading ≈ its own bg)
 *   - force a section to overflow    → HORIZONTAL-OVERFLOW axis fires `horizontal-overflow` (clone right > viewport)
 *   - desaturate the CTA            → COLOR-ΔE axis fires `color-off` (CTA color drift past the JND tolerance)
 * (+ two bonus injections the same machinery proves for free: font shrink → `font-off`; image swap → `image-wrong`.)
 *
 * WHY a SYNTHESIZED-FROM-REAL clean control (not a captured clone): grade-element-crops grades the CORRESPONDENCE,
 * not page-vs-page. To get a provably-CLEAN baseline we take REAL page-341 source ElementRecords, MIRROR them as the
 * clone (clone == source, same boxes/styles/assets), and build the `relation` join (srcPath → cloneRef) the same way
 * a stamped clone would. clone==source ⇒ every axis delta is 0 ⇒ ZERO flags by construction (the anti-gaming property
 * region-judge's source-vs-itself test also relies on). Then we perturb ONE clone record and re-read. This exercises
 * the REAL readPairs + axisDeltas pure functions on REAL record shapes — it is not a toy fixture. No network, no fs
 * writes, no LLM: it is the CAUSAL det-core of the harness, runnable in CI.
 *
 * Reuse: readPairs, axisDeltas, TOL from grade-element-crops.mjs (imported UNCHANGED). The real /tmp/compare-341.json
 * blob supplies the source records (same cached blob the harness self-test uses). If that blob is absent the suite
 * SKIPS (exit 0 with a loud notice) rather than failing — it is an offline det test, not a capture test.
 *
 * CLI: node _grader-injection-regression.mjs [--compare /tmp/compare-341.json] [--vw 1440] [--json]
 *   exit 0 = ALL perturbations fired the right axis + control silent; exit 1 = a regression (a perturbation the
 *   grader could not see, or a control that falsely flagged). Builder does NOT self-bless — the orchestrator re-runs.
 */
import fs from 'fs';
import { readPairs, axisDeltas, TOL } from './grade-element-crops.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);
const COMPARE = arg('compare', '/tmp/compare-341.json');
const VW = +arg('vw', 1440);

// ── build a CLEAN control blob from real source records: clone MIRRORS source (deep copy), relation = srcPath→cloneRef.
// clone==source ⇒ every axis delta is 0 ⇒ ZERO flags by construction. We keep ONLY records that carry a box at VW so
// every mirrored pair is comparable at this viewport.
function buildCleanBlob(realBlob, vw) {
  const src = realBlob.sourceCapture.records.filter((r) => r.box && r.box[vw]);
  // mirror each source record as a clone record with a distinct ref (so cByRef keys don't collide with source refs).
  const cloneRecords = src.map((s) => ({ ...JSON.parse(JSON.stringify(s)), ref: 'C::' + s.ref }));
  const relation = {};
  for (const s of src) relation[s.srcPath] = ['C::' + s.ref];
  const blob = {
    report: {
      source: realBlob.report.source, clone: realBlob.report.clone, clonePage: realBlob.report.clonePage,
      widths: [vw],
      correspondence: { method: 'synthetic-mirror' },
      matchRate: 1.0,
      relation,
      unmatchedSource: [],
      pageHeightByVw: {
        source: { [vw]: realBlob.report.pageHeightByVw.source[vw] || realBlob.report.pageHeightByVw.source[String(vw)] },
        clone: { [vw]: realBlob.report.pageHeightByVw.source[vw] || realBlob.report.pageHeightByVw.source[String(vw)] }, // same height (mirror)
      },
    },
    sourceCapture: { records: src },
    cloneCapture: { records: cloneRecords },
  };
  return { blob, srcRefs: src.map((s) => s.srcPath) };
}

// clone a blob deeply so a perturbation never leaks into the next case.
function cloneBlob(b) { return JSON.parse(JSON.stringify(b)); }

// helpers to locate a clone record (by its source srcPath, via the relation join) and mutate it.
function cloneRecForSrcPath(blob, srcPath) {
  const cloneRef = (blob.report.relation[srcPath] || [])[0];
  return blob.cloneCapture.records.find((c) => c.ref === cloneRef) || null;
}
// pick the first source record matching a predicate that ALSO has a mirrored clone present.
function pickSrcPath(blob, pred) {
  for (const s of blob.sourceCapture.records) { if (pred(s) && cloneRecForSrcPath(blob, s.srcPath)) return s.srcPath; }
  return null;
}

// run the axis-delta seed over ALL pairs and return the flagged rows (the harness's deterministic layer, verbatim).
function flaggedRows(blob, vw) {
  const { pairs } = readPairs(blob, vw);
  const rows = [];
  for (const { sEl, cEl } of pairs) for (const r of axisDeltas(sEl, cEl, vw)) if (r.flagged) rows.push(r);
  return rows;
}
// did a specific (ref-scoped) axis/class fire?
function fired(rows, srcPath, axis, cls) {
  // rows carry the SOURCE ref (axisDeltas uses sEl.ref); for presence the row ref is the source ref too.
  return rows.some((r) => r.axis === axis && r.class === cls && (srcPath == null || r.ref === srcPath || r.ref.endsWith(srcPath)));
}

function main() {
  if (!fs.existsSync(COMPARE)) {
    console.log(`[reg] SKIP — compare blob not found at ${COMPARE} (offline det test; provide --compare to run).`);
    process.exit(0);
  }
  const real = JSON.parse(fs.readFileSync(COMPARE, 'utf8'));
  const { blob: clean } = buildCleanBlob(real, VW);

  const results = [];
  const record = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

  // ── (0) CONTROL: the clean clone (clone == source) fires ZERO axis flags. ──────────────────────────────────────
  const ctrlRows = flaggedRows(clean, VW);
  record('CONTROL  unperturbed clone (==source) fires ZERO axis flags (anti-gaming)', ctrlRows.length === 0,
    ctrlRows.length === 0 ? `0 flags over ${readPairs(clean, VW).pairs.length} mirrored pairs` : `LEAKED ${ctrlRows.length} flags e.g. ${ctrlRows.slice(0, 3).map((r) => r.axis + '/' + r.class).join(', ')}`);

  // ── (1) DELETE THE LOGO ELEMENT → PRESENCE axis fires missing-element ──────────────────────────────────────────
  {
    const b = cloneBlob(clean);
    // logo = the header avatar image (overreacted's brand mark). Fall back to any fold image.
    const logoSrc = pickSrcPath(b, (s) => s.asset && s.asset.isImage && s.box && s.box[VW] && s.box[VW].y < 200)
      || pickSrcPath(b, (s) => s.asset && s.asset.isImage);
    let pass = false, detail = 'no logo image found in blob';
    if (logoSrc) {
      // delete: remove the clone record AND the relation entry → readPairs yields cEl=null → presence fires.
      const cloneRef = (b.report.relation[logoSrc] || [])[0];
      b.cloneCapture.records = b.cloneCapture.records.filter((c) => c.ref !== cloneRef);
      // make it an unmatched-source presence defect (a deleted element is clone-missing).
      delete b.report.relation[logoSrc];
      b.report.unmatchedSource = [logoSrc];
      const rows = flaggedRows(b, VW);
      const firedPresence = fired(rows, logoSrc, 'presence', 'missing-element');
      const silentElsewhereOnThisRef = !rows.some((r) => r.ref === logoSrc && r.axis !== 'presence');
      pass = firedPresence && silentElsewhereOnThisRef;
      detail = `logo=${logoSrc.slice(0, 40)} | presence/missing-element fired=${firedPresence} | total flags now ${rows.length}`;
    }
    record('PERTURB  delete logo element → PRESENCE fires `missing-element`', pass, detail);
  }

  // ── (2) COLLAPSE AN H1 CONTRAST ~1:1 → TEXT-CONTRAST fires invisible-text ───────────────────────────────────────
  {
    const b = cloneBlob(clean);
    // a heading-ish text el: has color + readable text + a light bg in source. Paint the CLONE color ≈ its bg.
    const headSrc = pickSrcPath(b, (s) => (s.role === 'heading' || /^h[1-3]$/.test(s.tag || '')) && s.style && s.style.color && (s.ownText || s.text) && s.box && s.box[VW])
      || pickSrcPath(b, (s) => s.style && s.style.color && (s.ownText || s.text) && s.box && s.box[VW] && s.style.backgroundColor);
    let pass = false, detail = 'no heading/text el found';
    if (headSrc) {
      const cRec = cloneRecForSrcPath(b, headSrc);
      const srcRec = b.sourceCapture.records.find((s) => s.srcPath === headSrc);
      // source bg defaults to white if transparent; paint the clone text to ~that bg (near-1:1 contrast).
      const bg = (srcRec.style.backgroundColor && !/rgba\(0, ?0, ?0, ?0\)/.test(srcRec.style.backgroundColor)) ? srcRec.style.backgroundColor : 'rgb(255, 255, 255)';
      // force the clone text color to near-white (≈ its own bg) AND ensure its bg is white so contrast collapses.
      cRec.style = { ...cRec.style, color: 'rgb(250, 250, 250)', backgroundColor: 'rgb(255, 255, 255)' };
      // ensure the source side is readable (dark on white) so the source contrast is high and the delta is real.
      // (source records are real; overreacted headings are dark-on-light, so this holds.)
      const rows = flaggedRows(b, VW);
      const firedContrast = fired(rows, headSrc, 'text-contrast', 'invisible-text');
      pass = firedContrast;
      detail = `head=${headSrc.slice(0, 40)} | srcColor=${srcRec.style.color} → cloneColor rgb(250,250,250) on white | text-contrast/invisible-text fired=${firedContrast}`;
    }
    record('PERTURB  collapse H1 contrast ~1:1 → TEXT-CONTRAST fires `invisible-text`', pass, detail);
  }

  // ── (3) FORCE A SECTION TO OVERFLOW → HORIZONTAL-OVERFLOW fires horizontal-overflow ─────────────────────────────
  {
    const b = cloneBlob(clean);
    // pick a wide-ish boxed el and push the CLONE box right edge well past the viewport.
    const secSrc = pickSrcPath(b, (s) => s.box && s.box[VW] && s.box[VW].w > 200);
    let pass = false, detail = 'no boxed section found';
    if (secSrc) {
      const cRec = cloneRecForSrcPath(b, secSrc);
      const cb = cRec.box[VW];
      // overflow: widen the clone box so its right edge is VW * 1.2 (20% past the viewport → > overflowFrac tol).
      const newRight = Math.round(VW * 1.2);
      cRec.box = { ...cRec.box, [VW]: { ...cb, w: newRight - cb.x, right: newRight } };
      const rows = flaggedRows(b, VW);
      const firedOverflow = fired(rows, secSrc, 'h-overflow', 'horizontal-overflow');
      pass = firedOverflow;
      detail = `sec=${secSrc.slice(0, 40)} | clone right ${cb.right} → ${newRight} (vw ${VW}, +20%) | h-overflow fired=${firedOverflow}`;
    }
    record('PERTURB  force section overflow → HORIZONTAL-OVERFLOW fires `horizontal-overflow`', pass, detail);
  }

  // ── (4) DESATURATE THE CTA → COLOR-ΔE fires color-off ───────────────────────────────────────────────────────────
  {
    const b = cloneBlob(clean);
    // CTA = a link/button. We perturb its TEXT color (the color-ΔE axis compares text color). Choose one whose source
    // color is CHROMATIC (max-min channel > 30) so desaturating it to its luma-grey is a clear ΔE > tol — desaturating
    // an already-grey link is a genuine no-op (ΔE≈0) and would be a BAD fixture, not a grader miss. overreacted inline
    // links are pink rgb(210,54,105). Fall back to any colored link only if no chromatic one exists.
    const chroma = (s) => { const m = (s.style && s.style.color || '').match(/(\d+), ?(\d+), ?(\d+)/); return m ? Math.max(+m[1], +m[2], +m[3]) - Math.min(+m[1], +m[2], +m[3]) : -1; };
    const ctaSrc = pickSrcPath(b, (s) => (s.role === 'link' || s.role === 'button') && s.style && s.style.color && chroma(s) > 30 && (s.ownText || s.text) && s.box && s.box[VW])
      || pickSrcPath(b, (s) => (s.role === 'link' || s.role === 'button') && s.style && s.style.color && (s.ownText || s.text) && s.box && s.box[VW]);
    let pass = false, detail = 'no CTA link/button found';
    if (ctaSrc) {
      const cRec = cloneRecForSrcPath(b, ctaSrc);
      const srcRec = b.sourceCapture.records.find((s) => s.srcPath === ctaSrc);
      // DESATURATE: collapse the source color to its grey (luma-preserving), guaranteeing a large hue/chroma ΔE if
      // the source was chromatic; if the source link is already near-grey we force a clearly-different grey so ΔE>tol.
      const m = (srcRec.style.color || '').match(/(\d+), ?(\d+), ?(\d+)/);
      let desat = 'rgb(128, 128, 128)';
      if (m) { const [r, g, bl] = [+m[1], +m[2], +m[3]]; const y = Math.round(0.299 * r + 0.587 * g + 0.114 * bl); desat = `rgb(${y}, ${y}, ${y})`; }
      cRec.style = { ...cRec.style, color: desat };
      const rows = flaggedRows(b, VW);
      const firedColor = fired(rows, ctaSrc, 'color-deltaE', 'color-off');
      pass = firedColor;
      detail = `cta=${ctaSrc.slice(0, 40)} | srcColor=${srcRec.style.color} → desat ${desat} | color-deltaE/color-off fired=${firedColor}`;
    }
    record('PERTURB  desaturate CTA color → COLOR-ΔE fires `color-off`', pass, detail);
  }

  // ── (5 bonus) SHRINK FONT → font-off ; (6 bonus) SWAP IMAGE → image-wrong (same machinery, free coverage) ────────
  {
    const b = cloneBlob(clean);
    const fSrc = pickSrcPath(b, (s) => s.style && s.style.font && parseFloat(s.style.font.size) > 0 && s.box && s.box[VW]);
    let pass = false, detail = 'no sized-font el found';
    if (fSrc) {
      const cRec = cloneRecForSrcPath(b, fSrc);
      const srcSize = parseFloat(b.sourceCapture.records.find((s) => s.srcPath === fSrc).style.font.size);
      cRec.style = { ...cRec.style, font: { ...cRec.style.font, size: Math.round(srcSize * 0.5) + 'px' } }; // halve
      const rows = flaggedRows(b, VW);
      pass = fired(rows, fSrc, 'font-size-ratio', 'font-off');
      detail = `el=${fSrc.slice(0, 40)} | font ${srcSize}px → ${Math.round(srcSize * 0.5)}px | font-off fired=${pass}`;
    }
    record('PERTURB  shrink font 50% → FONT-SIZE-RATIO fires `font-off` (bonus)', pass, detail);
  }
  {
    const b = cloneBlob(clean);
    const iSrc = pickSrcPath(b, (s) => s.asset && s.asset.isImage && s.asset.naturalSrc && s.box && s.box[VW]);
    let pass = false, detail = 'no image with naturalSrc found';
    if (iSrc) {
      const cRec = cloneRecForSrcPath(b, iSrc);
      cRec.asset = { ...cRec.asset, naturalSrc: 'https://example.com/WRONG-DIFFERENT-IMAGE.png', svgHash: null };
      const rows = flaggedRows(b, VW);
      pass = fired(rows, iSrc, 'img-src', 'image-wrong');
      detail = `img=${iSrc.slice(0, 40)} | naturalSrc swapped → image-wrong fired=${pass}`;
    }
    record('PERTURB  swap image src → IMG axis fires `image-wrong` (bonus)', pass, detail);
  }

  const passed = results.filter((r) => r.pass).length, total = results.length;
  console.log(`\ninjection-regression: ${passed}/${total} ${passed === total ? 'ALL PASS' : 'FAIL'}  (compare=${COMPARE}, vw=${VW})`);
  if (has('json')) console.log(JSON.stringify({ passed, total, results }, null, 2));
  process.exit(passed === total ? 0 : 1);
}
main();
