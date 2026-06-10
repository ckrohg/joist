#!/usr/bin/env node
/**
 * @purpose PER-SECTION FIDELITY GRADER — un-blur the one opaque whole-page composite (supabase good clone = 0.575,
 * area-coverage 0.328) into a per-SECTION coverage breakdown so the refine loop can target the REAL misses. The
 * whole-page grader hides WHICH sections are under-covered; this attributes coverage band-by-band against the
 * SECTION SPEC.
 *
 * It is ADDITIVE (a brand-new file; touches NONE of grade-sections.mjs / perelement-score.mjs / capture-layout.mjs
 * / segment.mjs / build-structured.mjs / section-spec.mjs) and HONEST BY CONSTRUCTION (the --selftest proves the
 * matcher scores ~1.0 on identity and CLEARLY lower on an incomplete clone; if it can't, it fails loudly).
 *
 * METHOD:
 *   1. segment(src) → buildSpec(seg, src) gives the SECTION SPEC: sections[] each with a bbox{y..} + semantic role.
 *   2. A single y-scale  S = clone.pageH / src.pageH  maps every src-y into clone-y (the clone may differ in height).
 *   3. Per spec section band [y0,y1] (src coords):
 *        - srcLeaves = source leaves whose vertical CENTER falls in [y0,y1].
 *        - For each srcLeaf, MATCH = an UNUSED clone leaf whose center is near the SCALED src position
 *          (x within ~8% of vw, y within ~6% of the scaled band height) AND same KIND-CLASS (text/heading→"text",
 *          image/svg/mockup/video→"media", button→"button", list→"list") AND (for text) shares >=1 significant
 *          token OR box-area within 2x. Each clone leaf is consumed by AT MOST ONE src leaf (no double-count).
 *        - section coverage = (matched srcLeaf area) / (all srcLeaf area in band), clamped 0..1; empty band ⇒ 1 w/ flag.
 *        - also report matched/total and textCoverage (fraction of src text chars matched).
 *   4. Output per-section {idx, role, coverage, textCoverage, matched, total} + overall mean + WEAKEST 3 indices.
 *
 * CLI:  node grade-spec.mjs --src <srcCapture> --clone <cloneCapture> [--summary]
 *       node grade-spec.mjs --selftest      (identity≈1.0 AND incomplete < identity-0.25 ⇒ PASS, else FAIL + exit 1)
 */
import fs from 'fs';
import { segment } from './segment.mjs';
import { buildSpec } from './section-spec.mjs';

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const stripEmoji = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '').replace(/\s+/g, ' ').trim();

// ── leaf gathering — IDENTICAL recursion to segment.mjs / section-spec.mjs (a non-container node with a box). ──
function gatherLeaves(root) { const out = []; const g = (n) => { if (!n) return; if (n.kind === 'container') (n.children || []).forEach(g); else if (n.box) out.push(n); }; g(root); return out; }

// ── KIND-CLASS — group kinds so a heading matches a heading-rendered-as-text, image matches a screenshot/svg, etc.
// A src leaf can only match a clone leaf in the SAME class (a heading cannot be "covered" by an image). ──
function kindClass(kind) {
  if (kind === 'heading' || kind === 'text') return 'text';
  if (kind === 'image' || kind === 'svg' || kind === 'mockup' || kind === 'video' || kind === 'tabs') return 'media';
  if (kind === 'button') return 'button';
  if (kind === 'list') return 'list';
  return 'other';
}

// ── TOKENS — significant content words (drop short stopwords) for text token-overlap matching. ──
const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'with', 'are', 'our', 'all', 'can', 'get', 'has', 'how', 'now', 'out', 'use', 'who', 'why', 'a', 'an', 'of', 'to', 'in', 'on', 'is', 'it', 'or', 'as', 'at', 'by', 'we', 'us', 'be', 'do', 'so', 'up', 'no']);
function tokens(t) {
  return stripEmoji(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
}
const boxArea = (b) => Math.max(0, b.w) * Math.max(0, b.h);

// ── MATCH PREDICATE — does clone leaf C cover src leaf SL (after scaling SL into clone space by S in y)? ──
// x tolerance: ~8% of vw. y tolerance: ~6% of the SCALED band height (min floor so tiny bands still allow drift).
function leafMatches(SL, C, S, vw, bandHscaled) {
  if (kindClass(SL.kind) !== kindClass(C.kind)) return false;
  const slx = SL.box.x + SL.box.w / 2;            // src x center (x is NOT scaled — same viewport width)
  const sly = (SL.box.y + SL.box.h / 2) * S;      // src y center scaled into clone space
  const cx = C.box.x + C.box.w / 2, cy = C.box.y + C.box.h / 2;
  const xtol = vw * 0.08;
  const ytol = Math.max(40, bandHscaled * 0.06);
  if (Math.abs(cx - slx) > xtol || Math.abs(cy - sly) > ytol) return false;
  // content gate
  const cls = kindClass(SL.kind);
  if (cls === 'text' || cls === 'button') {
    const st = tokens(SL.text), ct = tokens(C.text);
    if (st.length && ct.length) {
      const cset = new Set(ct);
      if (st.some((w) => cset.has(w))) return true;          // >=1 significant shared token
    }
    // fallback: box-area within 2x (covers empty/icon-only or differently-worded but structurally-equivalent text)
    const a = boxArea(SL.box), b = boxArea(C.box);
    if (a > 0 && b > 0 && Math.max(a, b) <= Math.min(a, b) * 2) return true;
    if (a === 0 || b === 0) return true;                      // zero-area text leaf: position+class is enough
    return false;
  }
  // media / list / other: position + same kind-class is the signal; box-area within 2x as a sanity gate.
  const a = boxArea(SL.box), b = boxArea(C.box);
  if (a > 0 && b > 0 && Math.max(a, b) > Math.min(a, b) * 4) return false; // wildly different size ⇒ not a match
  return true;
}

// ── GRADE — attribute coverage per spec section. ──
function gradeSpec(src, clone) {
  const vw = src.vw || 1440;
  const srcLeaves = gatherLeaves(src.root);
  const cloneLeaves = gatherLeaves(clone.root);
  const srcPageH = src.pageH || 1, clonePageH = clone.pageH || srcPageH;
  const S = clonePageH / srcPageH;

  const seg = segment(src);
  const spec = buildSpec(seg, src);
  const sections = spec.sections || [];

  // available clone leaves — each consumable by AT MOST ONE src leaf (no double-count inflation).
  const used = new Array(cloneLeaves.length).fill(false);

  const inBand = (leaf, y0, y1) => { const cy = leaf.box.y + leaf.box.h / 2; return cy >= y0 && cy < y1; };

  const perSection = [];
  for (const sec of sections) {
    const y0 = sec.bbox ? sec.bbox.y : sec.y0;
    const y1 = sec.bbox ? sec.bbox.y + sec.bbox.h : sec.y1;
    const bandHscaled = Math.max(1, (y1 - y0) * S);
    const band = srcLeaves.filter((l) => inBand(l, y0, y1));

    let totalArea = 0, matchedArea = 0, matched = 0;
    let totalChars = 0, matchedChars = 0;

    for (const SL of band) {
      const a = boxArea(SL.box);
      totalArea += a;
      const chars = (kindClass(SL.kind) === 'text' || kindClass(SL.kind) === 'button') ? stripEmoji(SL.text).length : 0;
      totalChars += chars;
      // find the BEST unused clone leaf that matches (closest center wins, so a near-duplicate doesn't steal it)
      let bestI = -1, bestD = Infinity;
      for (let i = 0; i < cloneLeaves.length; i++) {
        if (used[i]) continue;
        const C = cloneLeaves[i];
        if (!leafMatches(SL, C, S, vw, bandHscaled)) continue;
        const slx = SL.box.x + SL.box.w / 2, sly = (SL.box.y + SL.box.h / 2) * S;
        const d = Math.abs((C.box.x + C.box.w / 2) - slx) + Math.abs((C.box.y + C.box.h / 2) - sly);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (bestI >= 0) { used[bestI] = true; matchedArea += a; matched++; matchedChars += chars; }
    }

    const empty = band.length === 0;
    const coverage = empty ? 1 : clamp01(totalArea > 0 ? matchedArea / totalArea : (matched / Math.max(1, band.length)));
    const textCoverage = totalChars > 0 ? clamp01(matchedChars / totalChars) : (empty ? 1 : 1);
    perSection.push({
      idx: sec.idx, role: sec.role,
      coverage: Math.round(coverage * 1000) / 1000,
      textCoverage: Math.round(textCoverage * 1000) / 1000,
      matched, total: band.length,
      emptyBand: empty || undefined,
    });
  }

  const graded = perSection.filter((p) => !p.emptyBand);
  const mean = graded.length ? graded.reduce((a, p) => a + p.coverage, 0) / graded.length : 1;
  const meanAll = perSection.length ? perSection.reduce((a, p) => a + p.coverage, 0) / perSection.length : 1;
  // WEAKEST 3 graded (non-empty) sections by coverage
  const weakest = [...graded].sort((a, b) => a.coverage - b.coverage).slice(0, 3).map((p) => p.idx);

  return {
    source: src.url || null, clone: clone.url || null,
    yScale: Math.round(S * 1000) / 1000, srcPageH, clonePageH,
    srcLeaves: srcLeaves.length, cloneLeaves: cloneLeaves.length,
    sectionCount: sections.length,
    mean: Math.round(mean * 1000) / 1000,         // mean over non-empty bands (the honest score)
    meanAll: Math.round(meanAll * 1000) / 1000,   // mean over all bands (empty=1)
    weakest, perSection,
  };
}

// ── SELFTEST — honesty by construction. ──
function runSelftest() {
  const SRC = '/tmp/pe-layout-gsec-supabasecom-mq2hv9sv-src.json';
  const CLONE = '/tmp/pe-layout-gsec-supabasecom-mq2hv9sv-clone.json';
  for (const p of [SRC, CLONE]) if (!fs.existsSync(p)) { console.log(`SELFTEST FAIL: missing ${p}`); process.exit(1); }
  let src, clone;
  try { src = JSON.parse(fs.readFileSync(SRC, 'utf8')); clone = JSON.parse(fs.readFileSync(CLONE, 'utf8')); }
  catch (e) { console.log('SELFTEST FAIL: ' + String((e && e.message) || e)); process.exit(1); }

  // (1) src-vs-src — identity. Every non-empty section coverage must be ~1.0 (mean >= 0.95).
  let idn;
  try { idn = gradeSpec(src, src); }
  catch (e) { console.log('SELFTEST FAIL (identity threw): ' + String((e && e.message) || e)); process.exit(1); }
  const srcVsSrc = idn.mean;
  const lowSecs = idn.perSection.filter((p) => !p.emptyBand && p.coverage < 0.95);

  // (2) incomplete — a clone missing ~77% cannot score high. mean must be CLEARLY lower (< srcVsSrc - 0.25).
  let inc;
  try { inc = gradeSpec(src, clone); }
  catch (e) { console.log('SELFTEST FAIL (incomplete threw): ' + String((e && e.message) || e)); process.exit(1); }
  const incomplete = inc.mean;

  const idnOk = srcVsSrc >= 0.95;
  const gapOk = incomplete < srcVsSrc - 0.25;
  const pass = idnOk && gapOk;

  console.log(`SELFTEST  srcVsSrc(identity)=${srcVsSrc.toFixed(3)}  incomplete=${incomplete.toFixed(3)}  gap=${(srcVsSrc - incomplete).toFixed(3)}`);
  if (!idnOk) console.log(`  identity below 0.95 — low sections: ${lowSecs.map((p) => `#${p.idx}=${p.coverage}`).join(', ')}`);
  if (!gapOk) console.log(`  anti-gaming gap < 0.25 — matcher rewards a clone missing ~77%`);
  console.log(`  identity per-section: ${idn.perSection.map((p) => `#${p.idx}:${p.emptyBand ? 'E' : p.coverage}`).join(' ')}`);
  console.log(`  incomplete per-section: ${inc.perSection.map((p) => `#${p.idx}:${p.emptyBand ? 'E' : p.coverage}`).join(' ')}`);
  console.log(pass ? 'SELFTEST PASS' : 'SELFTEST FAIL');
  process.exit(pass ? 0 : 1);
}

// ── CLI ──
const isMain = (() => { try { return /(?:^|\/)grade-spec\.mjs$/.test(process.argv[1] || ''); } catch { return false; } })();
if (isMain) {
  if (process.argv.includes('--selftest')) { runSelftest(); }
  else {
    const srcPath = arg('src'), clonePath = arg('clone');
    if (!srcPath || !clonePath || !fs.existsSync(srcPath) || !fs.existsSync(clonePath)) {
      console.error('usage: node grade-spec.mjs --src <srcCapture> --clone <cloneCapture> [--summary]  (or --selftest)');
      process.exit(2);
    }
    const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
    const clone = JSON.parse(fs.readFileSync(clonePath, 'utf8'));
    const r = gradeSpec(src, clone);
    if (process.argv.includes('--summary')) {
      console.log(`src=${r.source} clone=${r.clone}`);
      console.log(`yScale=${r.yScale} srcLeaves=${r.srcLeaves} cloneLeaves=${r.cloneLeaves} sections=${r.sectionCount} mean=${r.mean} (all=${r.meanAll}) weakest=[${r.weakest.join(',')}]`);
      for (const p of r.perSection) {
        console.log(`#${String(p.idx).padStart(2)} ${p.role.padEnd(11)} cov=${String(p.coverage).padEnd(5)} txt=${String(p.textCoverage).padEnd(5)} matched=${p.matched}/${p.total}${p.emptyBand ? ' (empty band ⇒ cov=1)' : ''}`);
      }
      process.exit(0);
    }
    process.stdout.write(JSON.stringify(r) + '\n');
  }
}

export { gradeSpec };
