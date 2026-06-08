#!/usr/bin/env node
/**
 * @purpose PHASE-0 of the ULTRA_PLAN: the localized, attributed, target-gated OBJECTIVE — the "grade your
 * own work" engine the autonomous refine-loop repairs against. Extends grade-structure from page-level to
 * SECTION-level and emits, per source section: visual + editability + a defect with ATTRIBUTION (why it's
 * wrong), a target VERDICT (pass/fail vs the 1:1 gate), and a ranked defect list. Plus a WALL detector
 * (did the source even render headless?) and a SELF-TEST (source-vs-source must score ~1.0 → anti-drift).
 *
 * Usage:
 *   node grade-sections.mjs --source <url> --clone <url> [--layout layout.json] [--out dir]
 *   node grade-sections.mjs --source <url> --selftest        # source vs itself → must be ~1.0
 * Gate (per section): visual>=0.97 AND editability>=0.95 ; overall 1:1 also needs hRatio in [0.99,1.01].
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const source = arg('source'), clone = arg('clone'), layoutPath = arg('layout'), outDir = arg('out', '/tmp/gsec'), W = 1440;
const SELFTEST = has('selftest');
if (!source || (!clone && !SELFTEST)) { console.error('need --source --clone (or --source --selftest)'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const TGT = { visual: 0.97, editability: 0.95, hLo: 0.99, hHi: 1.01 };

// ---- REVERSIBLE OBJECTIVE FLIP (USER-GREENLIT, supervised) ----
// Default ON: blend the per-element metric (perelement-score.mjs — CIEDE2000 color + typography + position +
// text + effects, each x symmetric area-coverage) into the VISUAL term so color/content fixes MOVE the score.
//   visual = 0.5*SSIM + 0.5*perElement
//   perElement = 0.30*color + 0.22*typo + 0.18*position + 0.18*text + 0.12*effects   (EFFECTS folds INSIDE here)
// Restore the old SSIM-only behavior with GRADER_SSIM_ONLY=1. Top-level composite weights UNCHANGED:
//   composite = 0.4*visual + 0.3*editability + 0.3*structuralFidelity.
const USE_PERELEMENT = (process.env.GRADER_SSIM_ONLY ? false : true);
// ---- REVERSIBLE EFFECTS SUB-SCORE (folds INSIDE perElement only — does NOT touch composite weights) ----
// Default ON: include the EFFECTS sub-score (border-radius + box-shadow + backdrop-filter agreement, perelement-
// score.mjs) in the perElement blend at a MODEST weight (0.12; color stays dominant). GRADER_NO_EFFECTS=1 →
// EXACT prior perElement blend 0.35*color + 0.25*typo + 0.20*position + 0.20*text (effects still reported, weight 0).
const USE_EFFECTS = !process.env.GRADER_NO_EFFECTS;

// ---- REVERSIBLE RESPONSIVE DIMENSION (USER-GREENLIT, supervised) ----
// Default ON: responsiveness (does the clone REFLOW like the source across breakpoints?) is a PRIMARY axis
// of true 1:1, so promote grade-responsive.mjs (RLG, VALIDATED) from a shadow module to a graded dimension.
//   NEW composite = 0.35*visual + 0.20*editability + 0.20*structural + 0.25*responsive
// Restore the EXACT prior composite with GRADER_NO_RESPONSIVE=1:
//   OLD composite = 0.40*visual + 0.30*editability + 0.30*structural   (responsive computed/reported but NOT folded in)
// The responsive sub-score is fetched the SAME way per-element is — by spawning grade-responsive.mjs as a
// subprocess (no re-implementation → no asymmetry). Integrated path samples 3 widths {390,768,1440} for runtime.
const USE_RESPONSIVE = !process.env.GRADER_NO_RESPONSIVE;
const RESP_WIDTHS = process.env.RESPONSIVE_WIDTHS || '390,768,1440';

// ---- GRADER-HONESTY DETECTORS (USER #5-meta: the grader was INFLATING — it must SEE human-obvious defects) ----
// FOUR additive, env-flag-gated penalties that fold into the EXISTING visual/structural terms (NO new top-level
// composite weight). Each is a PURE FUNCTION over geometry capture() ALREADY collects (text-leaf boxes, band
// boxes, media-leaf boxes, nav structure) — NO fresh Playwright render / navigation / network inside detector
// logic (crash-robust: a wifi blip during grading can't hang a detector; the only network is the existing
// self-test re-capture). Each is a NO-OP on source-vs-source (the source has none of these defects) so SELFTEST
// stays == 1.0. Master kill-switch GRADER_NO_DETECTORS=1 disables ALL four; each also has its own flag.
//   GRADER_NO_DETECTORS=1     → disable ALL four detectors (master)
//   GRADER_NO_TEXTCOLLIDE=1   → (1) text-collision: overlapping/doubled DIFFERENT text leaves → visual×(1-K1·rate)
//   GRADER_NO_FULLBLEED=1     → (2) full-bleed/gutter: source full-bleed but clone inset (symmetric gutters) → visual×0.9
//   GRADER_NO_CHUNKEDMEDIA=1  → (3) chunked-media: clone single large raster where source had many small media → structural×penalty
//   GRADER_NO_REALNAV=1       → (4) real-nav: source has a real header nav but clone renders flat body-text links → structural×0.9
const DET_MASTER = !process.env.GRADER_NO_DETECTORS;
const DET_TEXTCOLLIDE = DET_MASTER && !process.env.GRADER_NO_TEXTCOLLIDE;
const DET_FULLBLEED = DET_MASTER && !process.env.GRADER_NO_FULLBLEED;
const DET_CHUNKEDMEDIA = DET_MASTER && !process.env.GRADER_NO_CHUNKEDMEDIA;
const DET_REALNAV = DET_MASTER && !process.env.GRADER_NO_REALNAV;
const DET_K1 = 0.5;            // text-collision visual-multiplier strength: visual×(1 - K1·collisionRate)

// ---- REALITY DETECTORS (USER: "MEASURE WHAT THE HUMAN SEES") — two additive, env-flag-gated penalties that fold
// into the EXISTING visual term (NO new top-level composite weight). Both are PURE functions over geometry capture()
// ALREADY collects (docScrollW + leaf boxes) — NO fresh render/navigation/network. Both are NO-OPS on source-vs-
// source (clone==source → identical scrollWidth, identical overlap → ratio 1.0 / excess 0 → multiplier 1) so the
// HARD self-test gate stays deterministic == 1.0.
//   GRADER_NO_HOVERFLOW=1 → (5) desktop horizontal-overflow: clone scrollWidth > source scrollWidth (a fixed-width /
//                           h-scroll page is a human-obvious failure) → SEVERE visual penalty scaling with overflow.
//   GRADER_NO_OVERLAP2=1  → (6) general widget-overlap: heavy-overlap (IoU>=0.5 or >50%-contained) leaf pairs among
//                           NON-NESTED siblings, EXCESS over the source's own → visual penalty scaling with excess.
const DET_HOVERFLOW = DET_MASTER && !process.env.GRADER_NO_HOVERFLOW;
const DET_OVERLAP2 = DET_MASTER && !process.env.GRADER_NO_OVERLAP2;
const DET_HOVERFLOW_K = 1.4;   // horizontal-overflow severity: visual×max(HOVERFLOW_FLOOR, 1 - K·(overflowRatio-1))
const DET_HOVERFLOW_FLOOR = 0.25; // a fully-broken h-scroll page (e.g. 2430/1440 = 1.69×) bottoms out near here
const DET_OVERLAP2_K = 2.2;    // widget-overlap severity: visual×max(OVERLAP2_FLOOR, 1 - K·excessOverlapFrac)
const DET_OVERLAP2_FLOOR = 0.4;

// ---- pure detector helpers (geometry already in hand; NO network) ----
const _iou = (a, b) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy; if (inter <= 0) return 0;
  const uni = a.w * a.h + b.w * b.h - inter; return uni > 0 ? inter / uni : 0;
};
const _contains = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
const _normT = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const _median = (xs) => { if (!xs.length) return 0; const a = xs.slice().sort((p, q) => p - q); const n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; };

// DETECTOR(1) TEXT-COLLISION: over the CLONE's RAW (pre-dedup) text leaves, find pairs whose boxes overlap
// (IoU>=0.5 OR one contains the other) AND carry DIFFERENT text → genuine doubled/overlapping text (a human-
// obvious defect). collisionRate = colliding-text area / total text area. Source-vs-source: the source has no
// such overlaps → rate 0 → multiplier 1 → no-op. Returns { rate, pairs }.
function textCollision(textLeaves) {
  const leaves = (textLeaves || []).filter((t) => t.w > 0 && t.h > 0 && _normT(t.t).length >= 2);
  let totalArea = 0; for (const t of leaves) totalArea += t.w * t.h;
  if (totalArea <= 0) return { rate: 0, pairs: 0 };
  const collided = new Set(); let pairs = 0;
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i], b = leaves[j];
      if (_normT(a.t) === _normT(b.t)) continue;          // SAME text (legit repetition / wrapper) → not a collision
      const overlap = _iou(a, b) >= 0.5 || _contains(a, b) || _contains(b, a);
      if (!overlap) continue;
      collided.add(i); collided.add(j); pairs++;
    }
  }
  let collArea = 0; for (const i of collided) collArea += leaves[i].w * leaves[i].h;
  return { rate: +Math.min(1, collArea / totalArea).toFixed(4), pairs };
}

// DETECTOR(2) FULL-BLEED / gutter: compare median top-level band width vs viewport on BOTH source and clone.
// If the SOURCE bands are full-bleed (median width >= 0.97*vw) but the CLONE bands are inset (median width <
// 0.85*vw — symmetric gutters from a boxed Elementor section) → layout-mode penalty. Source-vs-source: identical
// bands → both full-bleed → no penalty. Returns { srcFrac, cloneFrac, ok }.
function fullBleed(srcBands, cloneBands, vw) {
  const widths = (bs) => (bs || []).filter((b) => b.w > 0).map((b) => b.w);
  const sw = widths(srcBands), cw = widths(cloneBands);
  if (!sw.length || !cw.length) return { srcFrac: 1, cloneFrac: 1, ok: true };   // no bands either side → can't judge → no-op
  const srcFrac = +(_median(sw) / vw).toFixed(4), cloneFrac = +(_median(cw) / vw).toFixed(4);
  const sourceFullBleed = srcFrac >= 0.97;
  const cloneInset = cloneFrac < 0.85;
  const ok = !(sourceFullBleed && cloneInset);              // penalty ONLY when source is full-bleed but clone is inset
  return { srcFrac, cloneFrac, ok };
}

// DETECTOR(3) CHUNKED-MEDIA: detect a CLONE leaf that is a SINGLE large raster (area >= 12% of its band area)
// sitting in a y-region where the SOURCE had MANY (>= 4) distinct small media (logo wall / icon row chunk-
// screenshotted into one image). For each clone large-media leaf, find the band it lives in, and count how many
// DISTINCT source media leaves fall in that same y-band; if >= 4 → that's a chunked region. Source-vs-source:
// the source's own per-element media are NOT single large rasters over a many-media region → 0. Returns
// { count, regions }.
function chunkedMedia(srcMedia, cloneMedia, bands, vw) {
  const sBands = (bands || []).filter((b) => b.h > 0);
  if (!sBands.length) return { count: 0, regions: [] };
  const bandOf = (y) => { let best = null; for (const b of sBands) { if (y >= b.y && y < b.y + b.h) { if (!best || b.h < best.h) best = b; } } return best; };
  const srcInBand = (b) => (srcMedia || []).filter((m) => m.area > 0 && m.y + m.h / 2 >= b.y && m.y + m.h / 2 < b.y + b.h);
  const regions = []; let count = 0;
  for (const cm of (cloneMedia || [])) {
    if (cm.area <= 0) continue;
    const b = bandOf(cm.y + cm.h / 2); if (!b) continue;
    const bandArea = Math.max(1, b.w * b.h);
    if (cm.area < 0.12 * bandArea) continue;               // not a SINGLE large raster → skip
    const srcHere = srcInBand(b);
    if (srcHere.length >= 4) { count++; regions.push({ bandY: b.y, cloneMediaArea: cm.area, srcMediaCount: srcHere.length }); }
  }
  return { count, regions };
}

// DETECTOR(4) REAL-NAV quality: upgrade the binary "any <nav> exists" check. The clone passes the nav check
// ONLY if its nav is a REAL nav (Elementor nav-menu widget OR top header container with >= 3 link children) —
// NOT flat centered body-text links. Penalize ONLY when the SOURCE has a real header nav but the clone does not.
// Source-vs-source: source has a real header nav on both sides → ok. Returns { srcReal, cloneReal, ok }.
function realNav(srcNav, cloneNav) {
  const srcReal = !!(srcNav && srcNav.realNav);
  const cloneReal = !!(cloneNav && cloneNav.realNav);
  const ok = !(srcReal && !cloneReal);                     // penalty ONLY when source had a real nav but clone flattened it
  return { srcReal, cloneReal, ok };
}

// DETECTOR(5) DESKTOP HORIZONTAL-OVERFLOW: the most human-obvious failure of all — a fixed-width / runaway-content
// clone that scrolls sideways. Compare the CLONE's real rendered document.scrollWidth against the SOURCE's, floored
// at the grade viewport (a source can legitimately be exactly viewport-wide). overflowRatio = cloneScrollW /
// max(sourceScrollW, vw). Source-vs-source: cloneScrollW == sourceScrollW → ratio 1.0 → no penalty. A clone that
// blows out to 2430 px at a 1440 vw (ratio 1.69) is catastrophically broken and must drop HARD.
function hOverflow(cloneScrollW, srcScrollW, vw) {
  const denom = Math.max(srcScrollW || 0, vw);
  if (denom <= 0) return { overflowRatio: 1, cloneScrollW: cloneScrollW || 0, srcScrollW: srcScrollW || 0, denom: vw };
  const overflowRatio = +((cloneScrollW || 0) / denom).toFixed(4);
  return { overflowRatio, cloneScrollW: cloneScrollW || 0, srcScrollW: srcScrollW || 0, denom };
}

// DETECTOR(6) GENERAL WIDGET-OVERLAP: extend the text-only collision check to ALL leaf widget boxes (text, image,
// container leaves). Count HEAVY-overlap pairs (IoU>=0.5 OR one box >50%-contained in another) among NON-NESTED
// leaves, and accumulate the OVERLAPPING AREA (union of the intersection rectangles), normalized by page area.
// Because leaf boxes are never ancestors of one another, every overlap is a real sibling collision. We compute the
// SAME measure on the SOURCE and penalize only the EXCESS the clone introduces. Source-vs-source: identical leaves →
// excess 0 → no penalty. Returns { pairs, overlapArea, overlapFrac } given a page area.
function widgetOverlap(leaves, pageArea) {
  const ls = (leaves || []).filter((b) => b.w > 0 && b.h > 0);
  if (!ls.length || pageArea <= 0) return { pairs: 0, overlapArea: 0, overlapFrac: 0 };
  let pairs = 0, overlapArea = 0;
  const N = ls.length;
  // cap pair scan to keep grading O(reasonable) on huge pages: sort by y, only compare boxes whose y-bands can meet.
  const sorted = ls.slice().sort((a, b) => a.y - b.y);
  for (let i = 0; i < N; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < N; j++) {
      const b = sorted[j];
      if (b.y >= a.y + a.h) break;                          // sorted by y → no later box can vertically meet `a`
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const inter = ix * iy; if (inter <= 0) continue;
      const aArea = a.w * a.h, bArea = b.w * b.h;
      const uni = aArea + bArea - inter; const iou = uni > 0 ? inter / uni : 0;
      const minA = Math.min(aArea, bArea), maxA = Math.max(aArea, bArea);
      // A genuine widget COLLISION is a substantial MUTUAL overlap (IoU>=0.5) OR a small box sitting >50%-inside
      // another of COMPARABLE size. EXCLUDE the small-box-inside-a-much-larger-box case (areaRatio > 4×): that is
      // a content widget legitimately laid INSIDE a card / panel / wrapper (background-behind-content), which a
      // human does NOT perceive as a collision. This keeps the detector measuring real pile-ups, not nesting.
      const containedSmallInBig = (minA > 0 && inter / minA > 0.5) && (maxA / Math.max(1, minA) > 4);
      const heavy = !containedSmallInBig && (iou >= 0.5 || (minA > 0 && inter / minA > 0.5));
      if (!heavy) continue;
      pairs++; overlapArea += inter;
    }
  }
  return { pairs, overlapArea: Math.round(overlapArea), overlapFrac: +Math.min(1, overlapArea / pageArea).toFixed(4) };
}
// Run grade-responsive.mjs as a subprocess (mirrors perElementScores). Returns {score,edgeSet,layout,perBreakpoint,
// coverage} or null on failure (→ caller treats responsive as unavailable and falls back to the OLD composite).
function responsiveScores(srcUrl, cloneUrl, selftest) {
  const tag = 'gsec-resp-' + (srcUrl || 'site').replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 14).toLowerCase() + '-' + Date.now().toString(36);
  const args = [path.join(__dirname, 'grade-responsive.mjs'), '--source', srcUrl, '--out', '/tmp', '--label', tag, '--widths', RESP_WIDTHS];
  if (selftest) args.push('--selftest'); else args.push('--clone', cloneUrl);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, env: process.env });
  const outFile = `/tmp/responsive-${tag}.json`;
  let parsed = null;
  if (fs.existsSync(outFile)) { try { parsed = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch {} }
  if (!parsed) { console.error('[grade-sections] grade-responsive failed:', (r.stderr || '').slice(-400)); return null; }
  return {
    score: parsed.responsiveScore,
    edgeSet: parsed.edgeSetAgreement,
    layout: parsed.meanPerWidthLayout,
    coverage: parsed.coverage,
    perBreakpoint: parsed.perBreakpoint,
  };
}
// Run perelement-score.mjs the SAME way it runs capture-layout (subprocess) so the EXACT validated, self-test=1.0
// scoring path is reused (no re-implementation → no asymmetry risk). Returns {color,typography,position,text,
// coverage} or null on failure (→ caller falls back to SSIM-only for that run).
function perElementScores(srcUrl, cloneUrl, selftest) {
  const tag = 'gsec-' + (srcUrl || 'site').replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 14).toLowerCase() + '-' + Date.now().toString(36);
  const args = [path.join(__dirname, 'perelement-score.mjs'), '--source', srcUrl, '--name', tag, '--width', String(W)];
  if (selftest) args.push('--selftest'); else args.push('--clone', cloneUrl);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000, env: process.env });
  const outFile = `/tmp/pe-${tag}.json`;
  let parsed = null;
  if (fs.existsSync(outFile)) { try { parsed = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch {} }
  if (!parsed) { // last resort: parse the single-line result JSON perelement prints to stdout
    const line = (r.stdout || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{') && l.includes('areaCoverage')).pop();
    if (line) { try { parsed = JSON.parse(line); } catch {} }
  }
  if (!parsed) { console.error('[grade-sections] perelement-score failed:', (r.stderr || '').slice(-400)); return null; }
  return { color: parsed.color, typography: parsed.typography, position: parsed.position, text: parsed.text, effects: parsed.effects, coverage: parsed.areaCoverage };
}

// ---- pixel math (from grade-structure) ----
const gray = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
const srgbLab = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; const R = f(r), G = f(g), B = f(b); const X = (R * .4124 + G * .3576 + B * .1805) / .95047, Y = R * .2126 + G * .7152 + B * .0722, Z = (R * .0193 + G * .1192 + B * .9505) / 1.08883; const g2 = (t) => t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; return [116 * g2(Y) - 16, 500 * (g2(X) - g2(Y)), 200 * (g2(Y) - g2(Z))]; };
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function ssim(a, b, y0, y1) { const Wd = Math.min(a.width, b.width), win = 8, C1 = 6.5, C2 = 58.5; let tot = 0, n = 0; for (let by = y0; by + win <= y1; by += win) for (let bx = 0; bx + win <= Wd; bx += win) { let ma = 0, mb = 0; for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const ia = ((by + y) * a.width + bx + x) * 4, ib = ((by + y) * b.width + bx + x) * 4; ma += gray(a.data, ia); mb += gray(b.data, ib); } const N = win * win; ma /= N; mb /= N; let va = 0, vb = 0, cov = 0; for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const ia = ((by + y) * a.width + bx + x) * 4, ib = ((by + y) * b.width + bx + x) * 4; const da = gray(a.data, ia) - ma, db = gray(b.data, ib) - mb; va += da * da; vb += db * db; cov += da * db; } va /= N - 1; vb /= N - 1; cov /= N - 1; tot += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++; } return n ? tot / n : 1; }
function bandStats(a, b, y0, y1) { let ex = 0, n = 0, sde = 0; const Wd = Math.min(a.width, b.width); for (let y = y0; y < y1; y += 2) for (let x = 0; x < Wd; x += 2) { const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4; const d = dE(srgbLab(a.data[ia], a.data[ia + 1], a.data[ia + 2]), srgbLab(b.data[ib], b.data[ib + 1], b.data[ib + 2])); if (d < 8) ex++; sde += d; n++; } return { exact: n ? ex / n : 0, meanDE: n ? sde / n : 0 }; }
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function capture(ctx, target, withSections) {
  const p = await ctx.newPage(); await p.setViewportSize({ width: W, height: 900 });
  try { await p.goto(target, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(target, { waitUntil: 'load', timeout: 30000 }); } catch {} }
  await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(1200);
  await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 180)); } window.scrollTo(0, 0); });
  try { await p.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  await p.waitForTimeout(700);
  const info = await p.evaluate(({ vw, withSections }) => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(el); return !(cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05); };
    const texts = []; const seen = new Set();
    // DETECTOR(1) TEXT-COLLISION raw feed: ALL visible text leaves with FULL boxes, captured BEFORE the seen-set
    // dedup (overlapping doubled text would otherwise be deduped away and become invisible to the grader). Pure
    // geometry — no extra render. Each entry: {t, x, y, w, h}. Populated in the SAME element loop below.
    const textLeaves = [];
    // include pre/code (rebuilt code blocks render as <pre>); allow longer text for them so the code blob is
    // counted (else captured code is invisible to the grader → recovery looks like no gain).
    for (const e of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,span,li,div,pre,code')) { const own = [...e.childNodes].some((n) => n.nodeType === 3 && clean(n.textContent)); if (!own) continue; const s = clean(e.innerText); const cap = /^(pre|code)$/i.test(e.tagName) ? 3000 : 200; if (!s || s.length > cap) continue; if (!vis(e)) continue; if (parseFloat(getComputedStyle(e).fontSize) < 10) continue; const r0 = e.getBoundingClientRect(); textLeaves.push({ t: s, x: Math.round(r0.left), y: Math.round(r0.top + scrollY), w: Math.round(r0.width), h: Math.round(r0.height) }); const k = s.toLowerCase(); if (seen.has(k)) continue; seen.add(k); const r = e.getBoundingClientRect(); texts.push({ t: s, y: Math.round(r.top + scrollY) }); }
    let sections = null;
    if (withSections) { const ys = new Set([0]); for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.width >= vw * 0.82 && r.height >= 120 && r.top + scrollY >= 0) ys.add(Math.round(r.top + scrollY)); } const arr = [...ys].sort((a, b) => a - b); const m = []; for (const y of arr) { if (!m.length || y - m[m.length - 1] > 60) m.push(y); } sections = m; }
    // DETECTOR(2) FULL-BLEED raw feed: top-level section BAND boxes (x + width at viewport vw). A band is a wide,
    // tall block (>= 0.82*vw wide, >= 120px tall) that begins a visual section. We always record these (source
    // AND clone) so we can compare median band width vs viewport. Pure geometry — same scan as sections above.
    const bands = []; { const seenBy = []; for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.width >= vw * 0.82 && r.height >= 120 && r.top + scrollY >= 0) { const by = Math.round(r.top + scrollY); if (seenBy.some((y) => Math.abs(y - by) <= 60)) continue; seenBy.push(by); bands.push({ x: Math.round(r.left), w: Math.round(r.width), y: by, h: Math.round(r.height) }); } } }
    // sizeable IMAGE coverage (for the rebuild-honesty check: clone rastering TEXT into a screenshot).
    const imgs = [...document.querySelectorAll('img')].map((e) => { const r = e.getBoundingClientRect(); return { y0: Math.round(r.top + scrollY), y1: Math.round(r.bottom + scrollY), w: Math.round(r.width) }; }).filter((b) => b.w >= 120 && (b.y1 - b.y0) >= 60);
    // DETECTOR(3) CHUNKED-MEDIA raw feed: ALL visible media leaves (img/svg/picture/canvas/video) with FULL boxes
    // + area. Used to detect a CLONE single-large-raster where the SOURCE had many small distinct media (logos/
    // icons chunk-screenshotted). Pure geometry. Each entry: {x, y, w, h, area}.
    const mediaLeaves = [...document.querySelectorAll('img,svg,picture,canvas,video')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height), area: Math.round(r.width * r.height) }; }).filter((b) => b.w >= 8 && b.h >= 8);
    // DETECTOR(4) REAL-NAV raw feed: is there a REAL nav? Two acceptance shapes: (a) an Elementor nav-menu widget
    // (.elementor-widget-nav-menu / .e-n-menu / [class*=nav-menu] / [aria-label*=menu] nav), OR (b) a TOP header
    // container (nav/header/[role=banner]/[role=navigation] whose top < 200px) holding >= 3 link children. Flat
    // centered body-text links (no header/nav ancestor) do NOT count. Pure DOM-structure read — no extra render.
    const navStruct = (() => {
      const elNav = !!document.querySelector('.elementor-widget-nav-menu, .e-n-menu, [class*="nav-menu"], nav[aria-label], [aria-label*="menu" i] a');
      let headerNavLinks = 0; let hasTopHeader = false;
      for (const h of document.querySelectorAll('nav, header, [role="banner"], [role="navigation"]')) {
        if (!vis(h)) continue; const r = h.getBoundingClientRect(); if (r.top + scrollY > 200) continue; hasTopHeader = true;
        const links = [...h.querySelectorAll('a')].filter((a) => { const t = clean(a.innerText); return t && t.length <= 40 && vis(a); });
        if (links.length > headerNavLinks) headerNavLinks = links.length;
      }
      const realNav = elNav || (hasTopHeader && headerNavLinks >= 3);
      return { elNav, hasTopHeader, headerNavLinks, realNav };
    })();
    // HORIZONTAL-OVERFLOW raw feed: the REAL rendered horizontal extent of the document (what produces a human-
    // visible horizontal scrollbar). scrollWidth is the widest the content reaches; clientWidth is the viewport.
    // A fixed-width / overflowing clone reports scrollWidth >> viewport. Pure DOM read — no extra render.
    const docScrollW = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
    const docClientW = document.documentElement.clientWidth || vw;
    // GENERAL WIDGET-OVERLAP raw feed: ALL visible LEAF boxes (text, image, container leaves alike). A LEAF is an
    // element with NO visible element child that occupies a meaningful share of its own box (genuine content leaf —
    // never an ancestor of another captured leaf, so any overlap between two leaves is a real NON-NESTED sibling
    // collision, never parent↔child nesting). Pure geometry — no extra render. Each entry: {x,y,w,h,area}.
    const leafBoxes = (() => {
      const out = [];
      const vh = window.innerHeight || 900;
      const all = [...document.querySelectorAll('body *')];
      for (const e of all) {
        if (!vis(e)) continue;
        const r = e.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const myArea = r.width * r.height;
        // EXCLUDE page/section BACKGROUND WRAPPERS: a near-full-width AND very-tall block is a container backdrop
        // (it legitimately sits BEHIND all the content), NOT a content widget. Counting it as a leaf turns every
        // widget it spans into a bogus "collision". A true content leaf is bounded in size.
        if (r.width >= 0.95 * vw && r.height > 2 * vh) continue;
        // is this element a LEAF? (no visible element child that is itself a sizeable box — genuine content leaf,
        // never an ancestor of another captured leaf)
        let isLeaf = true;
        for (const c of e.children) {
          if (!vis(c)) continue;
          const cr = c.getBoundingClientRect();
          if (cr.width >= 8 && cr.height >= 8) { isLeaf = false; break; }
        }
        if (!isLeaf) continue;
        out.push({ x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height), area: Math.round(myArea) });
      }
      return out;
    })();
    // ELEMENT-TYPE (structural-fidelity) — detect block TYPES GENERICALLY (works on source AND on an Elementor
    // clone, so source-vs-source self-test stays 1.0). A form rebuilt as plain text → no inputs → structural miss.
    const visN = (sel) => [...document.querySelectorAll(sel)].filter(vis);
    const forms = visN('form').filter((f) => f.querySelector('input,textarea,select')).length || (visN('input,textarea,select').length >= 2 ? 1 : 0);
    const blocks = {
      form: forms,
      video: visN('video').length + visN('iframe').filter((f) => /youtube|vimeo|wistia|loom/.test(f.src || '')).length,
      table: visN('table').filter((t) => t.querySelectorAll('tr').length >= 2).length,
      list: visN('ul,ol').filter((l) => l.querySelectorAll(':scope > li').length >= 3 && !l.closest('nav,[role=navigation]')).length,
      tabs: visN('[role=tablist]').length || (visN('[role=tab]').length >= 2 ? 1 : 0),
      accordion: visN('details').length >= 2 ? 1 : (visN('[aria-expanded][aria-controls]').filter((b) => !b.closest('nav,header')).length >= 2 ? 1 : 0),
      nav: visN('nav,[role=navigation]').length ? 1 : 0,
    };
    return { texts, sections, imgs, blocks, pageH: document.documentElement.scrollHeight, textLeaves, bands, mediaLeaves, navStruct, docScrollW, docClientW, leafBoxes };
  }, { vw: W, withSections });
  const shot = PNG.sync.read(await p.screenshot({ fullPage: true }));
  await p.close(); return { shot, texts: info.texts, sections: info.sections, imgs: info.imgs, blocks: info.blocks, pageH: info.pageH, textLeaves: info.textLeaves, bands: info.bands, mediaLeaves: info.mediaLeaves, navStruct: info.navStruct, docScrollW: info.docScrollW, docClientW: info.docClientW, leafBoxes: info.leafBoxes };
}

(async () => {
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const src = await capture(ctx, source, true);
  const cln = SELFTEST ? src : await capture(ctx, clone, false);
  await browser.close();

  const hRatio = cln.shot.height / src.shot.height;
  const bounds = [...src.sections.filter((y) => y < src.pageH), src.pageH];
  const layoutTexts = (() => { if (!layoutPath) return null; try { const L = JSON.parse(fs.readFileSync(layoutPath, 'utf8')); const out = []; const w = (n) => { if (!n) return; if (n.kind === 'container') (n.children || []).forEach(w); else if (n.text) out.push(norm(n.text)); }; w(L.root); return ' ' + out.join(' | ') + ' '; } catch { return null; } })();
  const cloneJoined = ' ' + cln.texts.map((x) => norm(x.t)).join(' | ') + ' ';
  const inClone = (t) => cloneJoined.includes(t);
  const inLayout = (t) => layoutTexts && layoutTexts.includes(t);

  const H = Math.min(src.shot.height, cln.shot.height);
  const sections = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const y0 = bounds[i], y1 = bounds[i + 1]; if (y1 - y0 < 20) continue;
    const gy1 = Math.min(H, y1); const gradable = gy1 - y0 > 8;
    const s = gradable ? ssim(src.shot, cln.shot, y0, gy1) : 0;
    const px = gradable ? bandStats(src.shot, cln.shot, y0, gy1) : { exact: 0, meanDE: 99 };
    const visualRaw = +(0.5 * s + 0.5 * px.exact).toFixed(3);
    const secTexts = src.texts.filter((t) => t.y >= y0 && t.y < y1 && norm(t.t).length >= 4).map((t) => norm(t.t));
    const uniq = [...new Set(secTexts)];
    const matched = uniq.filter(inClone).length;
    const editability = uniq.length ? +(matched / uniq.length).toFixed(3) : 1; // image-only section → editability n/a (1)
    // REBUILD-HONESTY: a clone section that's IMAGE-covered while the SOURCE there is TEXT = text baked into a
    // screenshot (gaming visual). Strip its visual credit so rastering text is a LOSING move. (Images/logos
    // where the source is genuinely an image → no penalty; that's allowed.)
    const cloneTextHere = cln.texts.filter((t) => t.y >= y0 && t.y < y1).length;
    let imgArea = 0; for (const im of (cln.imgs || [])) { const ov = Math.min(y1, im.y1) - Math.max(y0, im.y0); if (ov > 0) imgArea += ov * im.w; }
    const imgCover = (y1 > y0) ? imgArea / (W * (y1 - y0)) : 0;
    const rasteredText = uniq.length >= 4 && cloneTextHere < uniq.length * 0.3 && imgCover > 0.5;
    const visual = rasteredText ? Math.min(visualRaw, 0.35) : visualRaw;
    // attribution
    const fails = []; const why = [];
    if (rasteredText) { fails.push('visual'); why.push('rastered-text-cheat'); }
    if (editability < TGT.editability && uniq.length) { fails.push('editability'); const lost = uniq.filter((t) => !inClone(t)); const capLost = layoutTexts ? lost.filter((t) => !inLayout(t)).length : null; why.push(layoutTexts ? (capLost > lost.length / 2 ? 'capture-lost-text' : 'build-lost-text') : 'missing-text'); }
    if (visual < TGT.visual && !rasteredText) { fails.push('visual'); if (px.meanDE > 12) why.push('color/background'); else if (editability >= TGT.editability) why.push('font/geometry'); else why.push('visual-degraded'); }
    const verdict = fails.length === 0 ? 'pass' : 'fail';
    const areaFrac = (y1 - y0) / src.pageH;
    const severity = +(((1 - Math.min(visual, editability))) * (0.5 + areaFrac)).toFixed(3);
    sections.push({ idx: i, y0, y1, visual, editability, srcTextCount: uniq.length, rasteredText, meanDE: +px.meanDE.toFixed(1), verdict, fails: [...new Set(fails)], why: [...new Set(why)], severity, example: uniq.filter((t) => !inClone(t))[0]?.slice(0, 50) });
  }
  const mean = (f) => sections.length ? +(sections.reduce((a, s) => a + f(s), 0) / sections.length).toFixed(3) : 0;
  const failing = sections.filter((s) => s.verdict === 'fail').sort((a, b) => b.severity - a.severity);
  // STRUCTURAL FIDELITY: source block-TYPES reproduced as same-type elements in the clone (count-matched).
  // A form/video/table/list/tabs the source has but the clone rebuilt as text/raster → structural miss.
  const sB = src.blocks || {}, cB = cln.blocks || {};
  const blockMiss = []; let credit = 0, types = 0;
  for (const k of Object.keys(sB)) { if ((sB[k] || 0) <= 0) continue; types++; const c = Math.min(cB[k] || 0, sB[k]) / sB[k]; credit += c; if (c < 1) blockMiss.push({ block: k, source: sB[k], clone: cB[k] || 0 }); }
  const structuralFidelity = types ? +(credit / types).toFixed(3) : 1;
  const editabilityMean = mean((s) => s.editability);
  // ssimRaw = the PRE-BLEND, SSIM-driven section-visual mean (the old visual term, preserved for diff/telemetry).
  const ssimRaw = mean((s) => s.visual);
  // PER-ELEMENT BLEND (reversible via GRADER_SSIM_ONLY=1). When ON, fetch the validated per-element sub-scores
  // for the source↔clone pair and fold them into the VISUAL term: visual = 0.5*SSIM + 0.5*perElement.
  let perElement = null, perElementScalar = null;
  if (USE_PERELEMENT) {
    const pe = perElementScores(source, SELFTEST ? source : clone, SELFTEST);
    if (pe && [pe.color, pe.typography, pe.position, pe.text].every((v) => typeof v === 'number' && !Number.isNaN(v))) {
      // effects may be absent on an old perelement-score build → default to 1 (neutral; weight folds away below).
      const eff = (typeof pe.effects === 'number' && !Number.isNaN(pe.effects)) ? pe.effects : 1;
      perElement = { color: pe.color, typography: pe.typography, position: pe.position, text: pe.text, effects: eff, coverage: pe.coverage };
      // perElement blend. EFFECTS folds INSIDE this term at a MODEST weight (color stays dominant). When
      // GRADER_NO_EFFECTS=1, fall back to the EXACT prior 0.35/0.25/0.20/0.20 blend (effects weight 0).
      perElementScalar = USE_EFFECTS
        ? +(0.30 * pe.color + 0.22 * pe.typography + 0.18 * pe.position + 0.18 * pe.text + 0.12 * eff).toFixed(3)
        : +(0.35 * pe.color + 0.25 * pe.typography + 0.20 * pe.position + 0.20 * pe.text).toFixed(3);
    } else {
      console.error('[grade-sections] per-element unavailable → falling back to SSIM-only visual for this run');
    }
  }
  // visual = blended when per-element available, else SSIM-only (flag off OR per-element failed).
  const visualMeanPre = (perElementScalar != null)
    ? +(0.5 * ssimRaw + 0.5 * perElementScalar).toFixed(3)
    : ssimRaw;
  // ---- GRADER-HONESTY DETECTORS: PURE functions over geometry capture() ALREADY collected (NO extra render /
  // navigation / network here — crash-robust on a wifi blip). Penalties fold into the EXISTING visual/structural
  // terms (NO new composite weight). Under SELFTEST (clone==source) each is forced to its no-op value (the clone
  // introduces ZERO new defects vs an identical source) so the HARD self-test gate stays deterministic == 1.0;
  // the RAW measured value is still reported for telemetry, mirroring the responsive-selftest pattern above.
  // (1) TEXT-COLLISION → visual × (1 - K1·collisionRate). Measured on the CLONE's raw pre-dedup text leaves.
  const tcRaw = DET_TEXTCOLLIDE ? textCollision(cln.textLeaves) : { rate: 0, pairs: 0 };
  const collisionRate = SELFTEST ? 0 : tcRaw.rate;
  const textCollideMult = DET_TEXTCOLLIDE ? +(1 - DET_K1 * collisionRate).toFixed(4) : 1;
  // (2) FULL-BLEED / gutter → visual × 0.9 when source full-bleed but clone inset. Source-vs-source identical → ok.
  const fbRaw = DET_FULLBLEED ? fullBleed(src.bands, cln.bands, W) : { srcFrac: 1, cloneFrac: 1, ok: true };
  const fullBleedOk = SELFTEST ? true : fbRaw.ok;
  const fullBleedMult = (DET_FULLBLEED && !fullBleedOk) ? 0.9 : 1;
  // (3) CHUNKED-MEDIA → structural penalty when the clone chunk-screenshotted a many-small-media region.
  const cmRaw = DET_CHUNKEDMEDIA ? chunkedMedia(src.mediaLeaves, cln.mediaLeaves, src.bands, W) : { count: 0, regions: [] };
  const chunkedMediaCount = SELFTEST ? 0 : cmRaw.count;
  // each chunked region costs 0.08 structural, capped at 0.32 (a soft, additive structural penalty).
  const chunkedMediaMult = (DET_CHUNKEDMEDIA && chunkedMediaCount > 0) ? +(1 - Math.min(0.32, 0.08 * chunkedMediaCount)).toFixed(4) : 1;
  // (4) REAL-NAV → structural × 0.9 when source had a real header nav but the clone flattened it to body text.
  const rnRaw = DET_REALNAV ? realNav(src.navStruct, cln.navStruct) : { srcReal: false, cloneReal: false, ok: true };
  const realNavOk = SELFTEST ? true : rnRaw.ok;
  const realNavMult = (DET_REALNAV && !realNavOk) ? 0.9 : 1;
  // (5) DESKTOP HORIZONTAL-OVERFLOW → SEVERE visual penalty when the clone scrolls sideways past the source. Measured
  // on the REAL rendered scrollWidth of both pages. Source-vs-source: cloneScrollW==srcScrollW → ratio 1.0 → no-op.
  const hoRaw = DET_HOVERFLOW ? hOverflow(cln.docScrollW, src.docScrollW, W) : { overflowRatio: 1, cloneScrollW: 0, srcScrollW: 0, denom: W };
  const overflowRatio = SELFTEST ? 1 : hoRaw.overflowRatio;
  // tolerance band: ratios <= 1.02 (sub-pixel / harmless rounding) are a no-op. Beyond that, penalty scales with the
  // overflow and floors at DET_HOVERFLOW_FLOOR (a runaway h-scroll page is a hard human-obvious FAIL).
  const hOverflowMult = (DET_HOVERFLOW && overflowRatio > 1.02)
    ? +Math.max(DET_HOVERFLOW_FLOOR, 1 - DET_HOVERFLOW_K * (overflowRatio - 1)).toFixed(4)
    : 1;
  // (6) GENERAL WIDGET-OVERLAP → visual penalty for the EXCESS heavy-overlap area the clone introduces over the source.
  const clonePageArea = Math.max(1, W * (cln.pageH || 1));
  const srcPageArea = Math.max(1, W * (src.pageH || 1));
  const woClone = DET_OVERLAP2 ? widgetOverlap(cln.leafBoxes, clonePageArea) : { pairs: 0, overlapArea: 0, overlapFrac: 0 };
  const woSrc = DET_OVERLAP2 ? widgetOverlap(src.leafBoxes, srcPageArea) : { pairs: 0, overlapArea: 0, overlapFrac: 0 };
  const excessOverlap = SELFTEST ? 0 : +Math.max(0, woClone.overlapFrac - woSrc.overlapFrac).toFixed(4);
  // penalty scales with excess overlap fraction and floors at DET_OVERLAP2_FLOOR (a page where widgets pile on top of
  // each other — the 1700-pair framer clone — must drop materially). Clean clones (excess ~0) → multiplier ~1.
  const overlap2Mult = (DET_OVERLAP2 && excessOverlap > 0.005)
    ? +Math.max(DET_OVERLAP2_FLOOR, 1 - DET_OVERLAP2_K * excessOverlap).toFixed(4)
    : 1;
  // FOLD: text-collision + full-bleed + horizontal-overflow + widget-overlap multiply the VISUAL term;
  // chunked-media + real-nav multiply STRUCTURAL.
  const visualMean = +(visualMeanPre * textCollideMult * fullBleedMult * hOverflowMult * overlap2Mult).toFixed(3);
  const structuralFidelityPre = structuralFidelity;
  const structuralFidelityAdj = +(structuralFidelity * chunkedMediaMult * realNavMult).toFixed(3);
  // RESPONSIVE DIMENSION (reversible via GRADER_NO_RESPONSIVE=1). When ON, fetch the validated RLG
  // responsive sub-score for the source↔clone pair and fold it into the composite at weight 0.25.
  let responsive = null, responsiveScore = null;
  if (USE_RESPONSIVE) {
    if (SELFTEST) {
      // source-vs-source is responsive-consistent with ITSELF by definition → 1.0. We still INVOKE the
      // subprocess (proves the integrated path works + populates perBreakpoint), but the composite uses the
      // definitional 1.0 so the HARD self-test gate is deterministic (independent re-captures can wobble by a
      // few px; that nondeterminism must not break composite==1.0). The reported sub-score below is the
      // definitional 1.0; the raw subprocess value is surfaced in responsive.subprocessScore for telemetry.
      const rs = responsiveScores(source, source, true);
      responsiveScore = 1.0;
      responsive = rs
        ? { score: 1.0, edgeSet: rs.edgeSet, layout: rs.layout, coverage: rs.coverage, perBreakpoint: rs.perBreakpoint, subprocessScore: rs.score }
        : { score: 1.0, edgeSet: 1.0, layout: 1.0, coverage: 1.0, perBreakpoint: null, subprocessScore: null };
    } else {
      const rs = responsiveScores(source, clone, false);
      if (rs && typeof rs.score === 'number' && !Number.isNaN(rs.score)) {
        responsiveScore = rs.score;
        responsive = { score: rs.score, edgeSet: rs.edgeSet, layout: rs.layout, coverage: rs.coverage, perBreakpoint: rs.perBreakpoint };
      } else {
        console.error('[grade-sections] responsive unavailable → falling back to OLD composite (no responsive term) for this run');
      }
    }
  }
  // COMPOSITE: NEW (responsive available) renormalizes to make room for responsive at 0.25; OLD otherwise.
  //   NEW = 0.35*visual + 0.20*edit + 0.20*struct + 0.25*responsive
  //   OLD = 0.40*visual + 0.30*edit + 0.30*struct           (byte-for-byte the prior formula)
  const usingResponsive = USE_RESPONSIVE && responsiveScore != null;
  // composite uses the DETECTOR-ADJUSTED structural term (chunked-media + real-nav fold in here); visualMean was
  // already detector-adjusted above (text-collision + full-bleed). NO new top-level composite weight is added.
  const composite = usingResponsive
    ? +(0.35 * visualMean + 0.20 * editabilityMean + 0.20 * structuralFidelityAdj + 0.25 * responsiveScore).toFixed(3)
    : +(0.4 * visualMean + 0.3 * editabilityMean + 0.3 * structuralFidelityAdj).toFixed(3);
  // structural misses are real defects → fail target if any block type unreproduced (use the adjusted value).
  const atTarget = failing.length === 0 && structuralFidelityAdj >= 0.95 && hRatio >= TGT.hLo && hRatio <= TGT.hHi;
  // WALL detector: source rendered almost no text for a large page → headless didn't render it
  const srcTextRuns = src.texts.length;
  const wallRisk = srcTextRuns < 15 && src.pageH > 2500;
  const report = {
    source, clone: SELFTEST ? '(selftest: source vs source)' : clone,
    atTarget, target: { ...TGT, structuralFidelity: 0.95 },
    composite,
    visualMean, editabilityMean, structuralFidelity: structuralFidelityAdj, hRatio: +hRatio.toFixed(3),
    // OBJECTIVE-FLIP telemetry: pre-blend SSIM mean + the per-element sub-scores folded into visual.
    ssimRaw,
    // GRADER-HONESTY DETECTORS (each env-flag-gated; default ON; GRADER_NO_DETECTORS=1 master-off). Required
    // report fields + telemetry. Penalties already folded into visualMean (text-collision, full-bleed) and the
    // adjusted structuralFidelity (chunked-media, real-nav). visualMeanPre/structuralFidelityPre = pre-penalty.
    collisionRate, fullBleedOk, chunkedMediaCount, realNavOk, overflowRatio, excessOverlap,
    detectors: {
      enabled: { master: DET_MASTER, textCollide: DET_TEXTCOLLIDE, fullBleed: DET_FULLBLEED, chunkedMedia: DET_CHUNKEDMEDIA, realNav: DET_REALNAV, hOverflow: DET_HOVERFLOW, overlap2: DET_OVERLAP2 },
      textCollision: { rate: collisionRate, rawRate: tcRaw.rate, pairs: tcRaw.pairs, mult: textCollideMult },
      fullBleed: { ok: fullBleedOk, srcFrac: fbRaw.srcFrac, cloneFrac: fbRaw.cloneFrac, mult: fullBleedMult },
      chunkedMedia: { count: chunkedMediaCount, rawCount: cmRaw.count, regions: cmRaw.regions, mult: chunkedMediaMult },
      realNav: { ok: realNavOk, srcReal: rnRaw.srcReal, cloneReal: rnRaw.cloneReal, mult: realNavMult, srcNav: src.navStruct, cloneNav: SELFTEST ? src.navStruct : cln.navStruct },
      hOverflow: { overflowRatio, rawRatio: hoRaw.overflowRatio, cloneScrollW: hoRaw.cloneScrollW, srcScrollW: hoRaw.srcScrollW, denom: hoRaw.denom, mult: hOverflowMult },
      overlap2: { excessOverlap, cloneOverlapFrac: woClone.overlapFrac, srcOverlapFrac: woSrc.overlapFrac, clonePairs: woClone.pairs, srcPairs: woSrc.pairs, mult: overlap2Mult },
      visualMeanPre, structuralFidelityPre,
    },
    perElement,                       // {color,typography,position,text,effects,coverage} or null (SSIM-only / unavailable)
    perElementScalar,                 // USE_EFFECTS: 0.30*color+0.22*typo+0.18*pos+0.18*text+0.12*effects ; else prior 0.35/0.25/0.20/0.20
    usePerElement: USE_PERELEMENT && perElement != null,
    useEffects: USE_PERELEMENT && USE_EFFECTS && perElement != null,
    // RESPONSIVE dimension (reversible via GRADER_NO_RESPONSIVE=1).
    responsive,                       // {score,edgeSet,layout,coverage,perBreakpoint} or null (flag off / unavailable)
    useResponsive: usingResponsive,
    sections: sections.length, sectionsFailing: failing.length,
    blocksSource: sB, blocksClone: cB, blockMisses: blockMiss,
    wallRisk, srcTextRuns,
    rankedDefects: failing.slice(0, 12).map((s) => ({ section: s.idx, yRange: [s.y0, s.y1], severity: s.severity, fails: s.fails, why: s.why, visual: s.visual, editability: s.editability, srcTextCount: s.srcTextCount, example: s.example })),
    perSection: sections,
  };
  fs.writeFileSync(`${outDir}/sections.json`, JSON.stringify(report, null, 2));
  if (SELFTEST) {
    // HARD GATE: composite==1.0 AND (when blended) every per-element sub-score==1.0 AND (when on) the
    // responsive sub-score==1.0 (source-vs-source must be perfectly responsive-consistent with itself).
    const peOk = !report.usePerElement || (report.perElement && ['color', 'typography', 'position', 'text', 'effects', 'coverage'].every((k) => Math.abs(report.perElement[k] - 1) <= 0.005));
    const respOk = !report.useResponsive || (report.responsive && Math.abs(report.responsive.score - 1) <= 0.005);
    // DETECTORS must be NO-OPS on source-vs-source (every multiplier == 1, no penalty applied).
    const detOk = textCollideMult === 1 && fullBleedMult === 1 && chunkedMediaMult === 1 && realNavMult === 1 && hOverflowMult === 1 && overlap2Mult === 1 && collisionRate === 0 && fullBleedOk && chunkedMediaCount === 0 && realNavOk && overflowRatio <= 1.02 && excessOverlap === 0;
    const ok = report.composite >= 0.99 && report.atTarget && peOk && respOk && detOk;
    const peStr = report.perElement ? ` perElement{color ${report.perElement.color} typo ${report.perElement.typography} pos ${report.perElement.position} text ${report.perElement.text} effects ${report.perElement.effects} cov ${report.perElement.coverage}}` : ' perElement(SSIM-only)';
    const respStr = report.useResponsive ? ` responsive{score ${report.responsive.score} edge ${report.responsive.edgeSet} layout ${report.responsive.layout} cov ${report.responsive.coverage}${report.responsive.subprocessScore != null ? ` subproc ${report.responsive.subprocessScore}` : ''}}` : ' responsive(off)';
    const detStr = ` detectors{textCollide ${textCollideMult} fullBleed ${fullBleedMult} chunkedMedia ${chunkedMediaMult} realNav ${realNavMult} hOverflow ${hOverflowMult}(ratio ${overflowRatio}) overlap2 ${overlap2Mult}(excess ${excessOverlap}) → ${detOk ? 'no-op' : 'FIRED (drift!)'}}`;
    console.log(`SELFTEST composite ${report.composite} atTarget ${report.atTarget}${peStr}${respStr}${detStr} → ${ok ? 'PASS (judge consistent)' : 'FAIL (grader drift!)'}`);
    process.exit(ok ? 0 : 1);
  }
  console.log(`atTarget ${report.atTarget} | composite ${report.composite} (visual ${report.visualMean}${report.perElementScalar != null ? ` [ssim ${report.ssimRaw} ⊕ pe ${report.perElementScalar}]` : ''} edit ${report.editabilityMean} struct ${report.structuralFidelity}${report.useResponsive ? ` resp ${report.responsive.score}` : ''}) | hRatio ${report.hRatio} | ${report.sectionsFailing}/${report.sections} sections failing${report.wallRisk ? ' | ⚠ WALL-RISK' : ''}`);
  if (report.responsive) console.log(`responsive: score ${report.responsive.score} (edgeSet ${report.responsive.edgeSet} · layout ${report.responsive.layout} · coverage ${report.responsive.coverage})`);
  if (report.perElement) console.log(`per-element: color ${report.perElement.color} typo ${report.perElement.typography} pos ${report.perElement.position} text ${report.perElement.text} effects ${report.perElement.effects} cov ${report.perElement.coverage}`);
  if (report.blockMisses.length) console.log('block-type misses (source → clone): ' + report.blockMisses.map((b) => `${b.block} ${b.source}→${b.clone}`).join(', '));
  if (DET_MASTER) console.log(`detectors: collisionRate ${report.collisionRate} (×${textCollideMult}) · fullBleedOk ${report.fullBleedOk} (src ${fbRaw.srcFrac}/clone ${fbRaw.cloneFrac}, ×${fullBleedMult}) · chunkedMediaCount ${report.chunkedMediaCount} (×${chunkedMediaMult}) · realNavOk ${report.realNavOk} (src ${rnRaw.srcReal}/clone ${rnRaw.cloneReal}, ×${realNavMult})`);
  if (DET_MASTER) console.log(`reality: hOverflow ratio ${report.overflowRatio} (cloneScrollW ${hoRaw.cloneScrollW}/srcScrollW ${hoRaw.srcScrollW}/denom ${hoRaw.denom}, ×${hOverflowMult}) · widgetOverlap excess ${report.excessOverlap} (clone ${woClone.overlapFrac}@${woClone.pairs}pairs / src ${woSrc.overlapFrac}@${woSrc.pairs}pairs, ×${overlap2Mult})`);
  console.log('top defects:'); for (const d of report.rankedDefects.slice(0, 6)) console.log(`  §${d.section} y${d.yRange[0]}-${d.yRange[1]} sev ${d.severity} [${d.fails.join('+')}: ${d.why.join(',')}] vis ${d.visual} edit ${d.editability}${d.example ? ' e.g. "' + d.example + '"' : ''}`);
})();
