#!/usr/bin/env node
/**
 * @purpose vision-judge.mjs — V1 of the VISION-JUDGE objective ("1000x the grader"): render source + clone
 * at multiple widths, slice into aligned ~900px side-by-side tiles (source LEFT | clone RIGHT), then have a
 * vision LLM (claude -p headless) score each tile 0-100 against a STRICT pixel-fidelity rubric and enumerate
 * every human-salient defect. Aggregates to a pageScore where above-fold tiles weigh 3x and any sev>=4 defect
 * subtracts a penalty (one ruinous defect cannot hide in the mean).
 *
 * WHY: the deterministic grader said 0.736 on tailwind clone 3146 while the user judged it "nowhere NEAR 1:1"
 * (missing logo svg, missing search pill, junk annotation text, flattened inline code, dead code editor,
 * missing phone mockup, ~1000px overflow). A vision judge over side-by-side tiles is human-aligned BY
 * CONSTRUCTION and localizes defects per tile + width. Calibration ground truth #1 = that QA session.
 *
 * PINNED SOURCE (VJ-SRCPIN 2026-06-12, OPT-IN; live path unchanged): when the clone is built from a FROZEN
 *   capture, re-navigating the live source every judge run grades the clone against a DRIFTING target (clerk
 *   marquee phase + live dark section-divider = pure live-drift sev4/5 noise). Pass --pinned-source <file.png|
 *   cap:dir> (or point --source at a .png / cap:dir / dir) to load a pre-captured FROZEN full-page PNG as the
 *   SOURCE side instead of navigating; the clone side stays a LIVE capture. A flat PNG has NO DOM text anchors
 *   so band-anchored alignment is impossible → HONEST proportional banding (clone band = source band * cloneH/
 *   srcH), tiles labeled align:'pinned-proportional', perWidth.align.mode='pinned-proportional'. The frozen
 *   PNG's intrinsic pixel height IS its true height (cap w1440 = 1440x7616, manifest pageH 7616 → exact). OFF
 *   by default (reversibility = not passing the flag / not pointing --source at a png|cap: spec). Falsifier
 *   (2026-06-12): good clone (page 83) vs frozen clerk = 77.5; deliberately-broken clone (no images/wrong bg/
 *   dropped dark section) vs the SAME frozen source = 0 (raw mean 6.3). Pinning removes live-drift deflation
 *   WITHOUT hiding genuine defects.
 * Usage:
 *   node vision-judge.mjs --source <url|file.png|cap:dir> --clone <url> [--pinned-source <file.png|cap:dir>]
 *   node vision-judge.mjs --source <url> --clone <url> [--widths 1440,1100] [--out dir] [--tileh 900]
 *                         [--runs 1] [--jobs 3] [--model sonnet] [--budget 10] [--max-tiles 40]
 *                         [--manifest-only] [--gating] [--structure <grade-structure results.json>]
 * Outputs: <out>/w<width>-tile-NN.png, <out>/manifest.json, <out>/results.json (unless --manifest-only).
 * Judge path: `claude -p` per tile (vision via Read tool, --output-format json), strict-parse + 1 retry,
 * model recorded from modelUsage. --manifest-only skips judging (agent-based judging can consume the manifest).
 * Determinism: --runs N>1 judges each tile N times and takes the per-tile MEDIAN score (defects from median run).
 * --gating: MANDATES runs>=3 (single-run spread measured up to 20pts on marquee/animated bands; tile-median
 *   stabilizes). Any gating/calibration use of pageScore MUST pass --gating.
 * VETO COMBINER (--structure): vision pageScore is the headline ONLY through deterministic vetoes —
 *   publishedScore = min(visionScore, vetoCappedScore) where textVetoCap = 100*min(1, textCoverage/0.9)
 *   (full-page-raster text earns ~0 native textCoverage → cannot win) and heightVetoCap reuses
 *   grade-structure's h-overflow penalty. Without --structure, publishedScore=null (RAW vision, not publishable).
 * Isolation: nested claude sessions run with --strict-mcp-config + --setting-sources "" (no MCP servers, no
 *   settings scaffold, no context-hub daemon spawned in OUT). NO startup pkill of chrome-headless-shell —
 *   each capture launches its own ephemeral Playwright browser (own temp user-data-dir), so parallel runs
 *   cannot kill each other's captures (set VJ_PKILL=1 to opt IN to the old stale-process sweep).
 * Alignment: BAND-ANCHORED (VJ-ALIGN 2026-06-10, default ON; reversible GRADER_NO_VJALIGN=1 → legacy
 *   proportional-y path byte-identical: no meta extraction, no align fields, same tile loop). WHY: proportional y
 *   (clone band = source band * cloneH/sourceH) compares DIFFERENT sections whenever heights diverge at
 *   non-capture widths (3146@1100: src 14926 vs clone 21149 → phantom "wrong/missing section" defects in the
 *   2026-06-09 calibration). FIX: match source bands to clone bands by CONTENT — unique text-leaf anchors + LIS
 *   monotone filter → piecewise-linear y-maps (s2c/c2s); tile WITHIN matched band pairs so each tile compares the
 *   SAME section. A source band with >=2 unique texts and ZERO anchor matches in the clone is PIXEL-ARBITRATED
 *   (void-textguard lesson, inverted: text absence alone must not claim a missing band — 3146 smoke band 11
 *   "mansions" grid lost only its captions, imagery present): if the anchor-interpolated clone window is BLANK
 *   (luma std < 8) → explicit DETERMINISTIC "clone-missing band" tile (sev5 missing-content, score 10, no LLM
 *   call); if the window has content → JUDGED tile over that window (align:'unmatched' — the vision judge sees
 *   whether it is the band reproduced sans text, or different/squeezed content, and prices it). An uncovered
 *   clone band with >=2 NOVEL texts (absent from source entirely) becomes "clone-extra band" (sev4 text-junk,
 *   score 30, deterministic). Those are REAL defects and are priced into pageScore — but two different sections
 *   are never compared as if aligned. Textless bands interpolate via the anchor map (align:'interp', judged
 *   normally). <4 anchor pairs → honest proportional FALLBACK (perWidth.align.mode, tiles align:'proportional').
 * State pinning (VJ-PIN 2026-06-12, default ON; reversible VJ_NO_STATE_PIN=1): captureFull pins BOTH sides to
 *   the same page state before the shot — cookie/consent overlays dismissed-or-hidden (capture-assets pattern,
 *   12f5609/e675e77), animations frozen deterministically (finite → finish+commitStyles end state; infinite
 *   marquees → animation:none base pose, identical across captures; reducedMotion context), videos paused at
 *   t=0. WHY: the clerk run lost ~10 severity points to capture artifacts (live source cookie banner = phantom
 *   band + sev4/5; marquee phase mismatch = wrong-logos sev4s). Burned SRC/CLONE labels moved into a dedicated
 *   LABEL_STRIP above the content (canvas extended; labels NEVER overlay page pixels — the old corner burn-in
 *   produced a false "clipped text" defect).
 * Boundary guard (VJ-BOUNDARY 2026-06-12, default ON; reversible VJ_NO_BOUNDARY_GUARD=1 → legacy byte-identical,
 *   block skipped, no field added, no defect mutated): band-aligned tiling cuts a THIN source slice at a section
 *   BOUNDARY (a white↔dark transition strip); when the clone renders SHORTER (hRatio<1) the matched window slides
 *   under cumulative height compression, so that source band-EDGE is compared against the clone's correctly-
 *   rendered SOLID section → the judge calls a false sev5 inverted/dark-background-absent/section-absent defect
 *   (clerk fixed page = +~10 penalty of pure noise on t03/t14/t16, systematic across pre+post-fix runs). FIX:
 *   isBoundaryArtifactTile flags a tile that is THIN (<=BG_MAX_H) with a strong vertical luma split (>=BG_SPLIT,
 *   a transition strip) on ONE side and a comparatively SOLID section (<=BG_SOLID_SPLIT) on the OTHER; on such a
 *   tile reclassifyBoundaryDefects strips ONLY the sev>=4 floor off background/inversion/absence defects → sev2
 *   (still counts in the visual mean, no penalty floor). A GENUINE inversion (clone actually dark where source is
 *   white over the SAME content) is SOLID on BOTH sides (each split ~0) → fails the gate → STILL penalized.
 * Reversible/inert: pure capture+slice+judge; no grader or builder mutation; logged-out contexts; read-only.
 * Selftest: _vj-selftest.mjs (identical src|src pair must score >=95 with no sev>=2 defects);
 *   _vj-statepin-selftest.mjs (banner gone, marquee deterministic across two captures, labels off-content);
 *   _vj-boundary-selftest.mjs (3 clerk artifact tiles reclassified sev5->sev2; a constructed genuine inversion
 *   STILL penalized; flag-off byte-identical legacy path).
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { execFileSync, execFile } from 'child_process';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { settleLazy, crop } from './grade-vision-tiles.mjs';
import { assertAllowedBase, assertNotBlocked } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: refuse a stray (e.g. paused *.sg-host.com) URL before any navigation.

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

const SOURCE = arg('source'), CLONE = arg('clone');
// ── PINNED SOURCE (VJ-SRCPIN 2026-06-12, OPT-IN; live path unchanged when not used) ──────────────────────────
// The clone is built from a FROZEN capture; re-navigating the live source every judge run grades the clone
// against a DRIFTING target (clerk marquee phase + live dark section-divider = pure live-drift sev4/5 noise).
// When --pinned-source <path> is given, OR --source points at a .png file / `cap:<dir>` dir spec, the SOURCE
// side loads a pre-captured FROZEN full-page PNG instead of navigating. The clone side stays a LIVE local
// capture. A flat PNG has NO DOM, so it carries no text-leaf anchors → band-anchored alignment is impossible;
// the pinned path therefore uses HONEST PROPORTIONAL banding (clone band = source band * cloneH/srcH), tiles
// labeled align:'pinned-proportional' and perWidth.align.mode='pinned-proportional' so nothing pretends to be
// anchor-matched. The frozen PNG's intrinsic pixel height IS its true height (verified: cap w1440 = 1440x7616,
// manifest pageH 7616) so the proportional math is exact. Reversibility = not passing the flag / not pointing
// --source at a png|cap: spec.
const PINNED_SOURCE = arg('pinned-source');
const isPng = (s) => typeof s === 'string' && /\.png$/i.test(s);
const isCapSpec = (s) => typeof s === 'string' && (s.startsWith('cap:') || (!/^https?:\/\//i.test(s) && fs.existsSync(s) && (() => { try { return fs.statSync(s).isDirectory(); } catch { return false; } })()));
const PIN_SPEC = PINNED_SOURCE || (isPng(SOURCE) || isCapSpec(SOURCE) ? SOURCE : null);
const PINNED = !!PIN_SPEC;
const WIDTHS = String(arg('widths', '1440,1100')).split(',').map((s) => parseInt(s, 10)).filter((n) => n > 200);
const OUT = arg('out', '/tmp/vision-judge');
const TILE_H = +arg('tileh', 900);
const GATING = has('gating');               // gating/calibration use: runs>=3 is MANDATORY (single-run spread up to 20pts)
const RUNS = Math.max(GATING ? 3 : 1, +arg('runs', GATING ? 3 : 1) || 1);
const JOBS = Math.max(1, +arg('jobs', 3));
const MODEL = arg('model', 'sonnet');
const BUDGET = +arg('budget', 10);          // max total USD across all claude -p calls
const MAX_TILES = +arg('max-tiles', 40);    // per width, safety cap on very tall pages
const MANIFEST_ONLY = has('manifest-only');
const STRUCTURE = arg('structure');         // grade-structure results.json for the veto combiner (publishedScore)
const FOLD_Y = 1000;                        // aboveFold = source-band y0 < 1000
const DIVIDER = 14;                         // px magenta divider between source and clone
const VJALIGN = process.env.GRADER_NO_VJALIGN !== '1'; // band-anchored tile alignment (VJ-ALIGN), default ON
const MIN_ANCHOR_PAIRS = 4;                 // under-determined maps over-extrapolate → proportional fallback
const STATE_PIN = process.env.VJ_NO_STATE_PIN !== '1'; // VJ-PIN capture-state pinning (overlays + anim freeze), default ON
const LABEL_STRIP = 24;                     // px harness-label strip ABOVE the content — labels never overlay page pixels
const BOUNDARY_GUARD = process.env.VJ_NO_BOUNDARY_GUARD !== '1'; // VJ-BOUNDARY: de-fang hRatio<1 boundary-edge false-sev5, default ON
const BG_MAX_H = 320;                       // a boundary-cut tile is THIN (a section edge, not a full section)
const BG_SPLIT = 120;                       // one side's top↔bottom luma split this strong = a white↔dark transition strip
const BG_SOLID_SPLIT = 60;                  // the OTHER side must be comparatively SOLID (no matching transition)

// ── tiny 5x7 bitmap font (no font deps) for burned-in corner labels ─────────────────────────────────────────
const FONT = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
function drawLabel(png, x0, y0, text, scale = 2) {
  const chW = 6 * scale, h = 7 * scale;
  const w = text.length * chW + 2 * scale;
  // black backing box for contrast on any background
  for (let r = -scale; r < h + scale; r++) for (let c = -scale; c < w; c++) {
    const x = x0 + c, y = y0 + r;
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
    const i = (y * png.width + x) << 2;
    png.data[i] = 0; png.data[i + 1] = 0; png.data[i + 2] = 0; png.data[i + 3] = 255;
  }
  let cx = x0 + scale;
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] || FONT[' '];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (g[r][c] !== '1') continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const x = cx + c * scale + sx, y = y0 + r * scale + sy;
        if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
        const i = (y * png.width + x) << 2;
        png.data[i] = 255; png.data[i + 1] = 255; png.data[i + 2] = 255; png.data[i + 3] = 255;
      }
    }
    cx += chW;
  }
}

// ── side-by-side composite: [source | magenta divider | clone] under a dedicated LABEL STRIP ─────────────────
// VJ-PIN 2026-06-12: labels used to be burned into the TOP CORNERS of the content itself — on tiles whose first
// rows carry text (band-aligned tiles start exactly at section tops) the black label box COVERED real content
// and the judge called a false "clipped text" defect. The canvas is now extended by LABEL_STRIP px and labels
// live ONLY in that strip; content pixels start at y=LABEL_STRIP untouched.
// labels = { src?, clone? } — optional overrides for the VJ-ALIGN missing/extra band tiles; default identical.
function composeTile(srcTile, clnTile, width, y0, labels = {}) {
  const h = Math.max(srcTile.height, clnTile.height) + LABEL_STRIP;
  const w = srcTile.width + DIVIDER + clnTile.width;
  const out = new PNG({ width: w, height: h });
  // dark-gray canvas so height mismatch padding is visible but not mistaken for page content
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 24; out.data[i + 1] = 24; out.data[i + 2] = 24; out.data[i + 3] = 255; }
  // solid-black label strip across the top (visually distinct from the (24,24,24) padding)
  for (let r = 0; r < LABEL_STRIP; r++) for (let c = 0; c < w; c++) { const i = (r * w + c) << 2; out.data[i] = 0; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 255; }
  const blit = (img, ox) => { for (let r = 0; r < img.height; r++) { const sRow = (r * img.width) << 2; img.data.copy(out.data, (((r + LABEL_STRIP) * w + ox) << 2), sRow, sRow + (img.width << 2)); } };
  blit(srcTile, 0);
  blit(clnTile, srcTile.width + DIVIDER);
  for (let r = 0; r < h; r++) for (let c = srcTile.width + 2; c < srcTile.width + DIVIDER - 2; c++) { const i = (r * w + c) << 2; out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 220; out.data[i + 3] = 255; }
  drawLabel(out, 6, 5, labels.src || `SRC ${width}PX Y${y0}`);
  drawLabel(out, srcTile.width + DIVIDER + 6, 5, labels.clone || `CLONE ${width}PX`);
  return out;
}

// dark-maroon placeholder canvas for the side of a missing/extra band tile that has NO corresponding content —
// visually distinct from both page content and the dark-gray (24,24,24) height-mismatch padding.
function bandPlaceholder(w, h) {
  const png = new PNG({ width: w, height: Math.max(60, h) });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 56; png.data[i + 1] = 14; png.data[i + 2] = 14; png.data[i + 3] = 255; }
  return png;
}

// luma standard deviation of a horizontal band (sampled every 4px) — the missing-band pixel arbitration:
// a clone window with std < 8 is near-uniform background (no content), so a text-unmatched source band can be
// DETERMINISTICALLY declared clone-missing; any real content (imagery sans captions, squeezed neighbors) → judge.
function bandLumaStd(img, y0, y1) {
  let s = 0, s2 = 0, n = 0;
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y += 4) for (let x = 0; x < img.width; x += 4) {
    const i = (y * img.width + x) << 2;
    const L = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    s += L; s2 += L * L; n++;
  }
  if (!n) return 0;
  const m = s / n;
  return Math.sqrt(Math.max(0, s2 / n - m * m));
}

// ── VJ-BOUNDARY GUARD (2026-06-12, default ON; reversible VJ_NO_BOUNDARY_GUARD=1) ────────────────────────────
// THE BUG (LOOK-confirmed on the fixed clerk page, hRatio 0.889): band-aligned tiling cuts a THIN source slice
// (128-140px) exactly at a section BOUNDARY — a white↔dark background transition strip. When the clone renders
// SHORTER than source (hRatio < 1) the matched window slides under cumulative height compression, so that
// source band-EDGE strip is compared against the clone's correctly-rendered SOLID section. The vision judge sees
// "LEFT half-dark / RIGHT solid-light" (or vice versa) and calls a sev5 inverted/dark-background-absent /
// section-absent defect that is PURE alignment noise (t03/t14/t16 on the clerk page = +~10 penalty points).
// SIGNATURE (measured): the artifact tile is THIN (<=BG_MAX_H) AND ONE side carries a strong vertical luma
// discontinuity (top-half↔bottom-half mean split >= BG_SPLIT — a transition strip) while the OTHER side is
// comparatively SOLID (split <= BG_SOLID_SPLIT — a single section). A GENUINE inversion (clone actually dark
// where source is white over the SAME content) is SOLID on BOTH sides (each split ~0, just different colors) →
// fails this gate → STILL penalized. We do NOT condemn a tile, and do NOT touch its judged score (it still
// counts in the visual mean); we only strip the sev>=4 SEVERITY FLOOR off the background/inversion/absence
// defects this boundary strip provoked, so a pure-alignment edge cannot fake a ruinous defect.
// isBoundaryArtifactTile takes a composed tile PNG (the same [src|divider|clone] layout under LABEL_STRIP that
// the judge saw) so the detector measures EXACTLY the pixels that were judged. Pure + exported (unit-testable).
function vertSplit(png, x0, x1) {
  const y0 = LABEL_STRIP, y1 = png.height, mid = y0 + ((y1 - y0) >> 1);
  const mean = (a, b) => { let s = 0, n = 0; for (let y = a; y < b; y++) for (let x = x0; x < x1; x += 2) { const i = (y * png.width + x) << 2; s += 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2]; n++; } return n ? s / n : 0; };
  return Math.abs(mean(y0, mid) - mean(mid, y1));
}
export function isBoundaryArtifactTile(png, srcContentH) {
  const h = srcContentH != null ? srcContentH : png.height - LABEL_STRIP;
  if (h > BG_MAX_H) return false;                 // a full section, not a boundary cut
  const srcW = (png.width - DIVIDER) >> 1;
  const sSplit = vertSplit(png, 0, srcW);         // source transition strip?
  const cSplit = vertSplit(png, srcW + DIVIDER, png.width); // clone transition strip?
  const hi = Math.max(sSplit, cSplit), lo = Math.min(sSplit, cSplit);
  // one side is a strong white↔dark transition strip; the other is a comparatively solid section
  return hi >= BG_SPLIT && lo <= BG_SOLID_SPLIT;
}
// reclassifyBoundaryDefects: on a boundary-artifact tile, drop the sev>=4 FLOOR off background/inversion/absence
// defects (the only family this alignment strip can fake) → capped at sev2 (counts in mean, no penalty floor).
// Other defects (wrong logos, missing CTA, junk text) are untouched — those are not boundary-strip artifacts.
const BG_DEFECT = /\b(invert|background|dark[- ]?(theme|section|background|panel|band|block)|section.*(absent|missing)|(absent|missing).*section|white.*background|black.*background|theme.*(absent|missing))\b/i;
export function reclassifyBoundaryDefects(defects) {
  let reclassified = 0;
  const out = defects.map((d) => {
    if (d.severity >= 4 && BG_DEFECT.test(d.desc || '')) { reclassified++; return { ...d, severity: 2, boundaryGuard: true, origSeverity: d.severity }; }
    return d;
  });
  return { defects: out, reclassified };
}

// ── STATE PIN (VJ-PIN 2026-06-12, default ON; reversible VJ_NO_STATE_PIN=1 → pre-pin capture behavior) ──────
// WHY: a judged tile must compare the two PAGES, not the two capture MOMENTS. The 2026-06 clerk run lost
// ~10 severity points to pure capture artifacts: (a) the SOURCE kept a live cookie-consent banner the clone
// (rightly) doesn't have → phantom unmatched band + sev4/sev5 calls; (b) the source logo marquee was shot at a
// different rotation phase than the clone's frozen frame → "wrong logos" sev4s. Both sides of every pair now
// capture in the same pinned state. Pattern ported from capture-assets.mjs (12f5609 + e675e77 keyword-less
// Tailwind banner fix) — that file is a CLI with top-level side effects, so the two pins are inlined here.
// pin 1: cookie/consent overlays — click accept/dismiss inside consent-looking roots (pass A), text-detected
// keyword-less banners (pass A2, clerk's `fixed bottom-7 z-150` div), else CSS-hide (pass B, nav-safe: z>999
// OR strong "we use cookies" text required) + body scroll-unlock. Every action logged with a locator.
async function dismissOverlays(page) {
  const log = await page.evaluate(() => {
    const out = [];
    const cssPath = (el) => { const seg = []; let n = el, g = 0; while (n && n.nodeType === 1 && n !== document.documentElement && g++ < 12) { let s = n.tagName.toLowerCase(); if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { seg.unshift(`${s}#${n.id}`); break; } const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []; if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(n) + 1})`; seg.unshift(s); n = n.parentElement; } return seg.join('>'); };
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.02; };
    const ACCEPT = /^(accept( all)?( cookies)?|allow( all)?( cookies)?|agree( & continue)?|i (agree|accept|understand)|got it|ok(ay)?|understood|dismiss|reject all|necessary( cookies)? only|only necessary|save( and| &)? (close|accept|exit)|close)$/i;
    const CONSENT_PHRASE = /\b(we use cookies|(this |our )?(web)?site uses cookies|cookie (policy|preferences|settings|notice)|manage (your )?cookie)\b/i;
    const roots = [...document.querySelectorAll('[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[id*=gdpr i],[class*=gdpr i],#onetrust-banner-sdk,#CybotCookiebotDialog,.cc-window,[id*=cookiebanner i],[role=dialog],[aria-modal=true]')]
      .filter((el) => vis(el) && /cookie|consent|gdpr|privacy|tracking/i.test((el.textContent || '').slice(0, 4000) + ' ' + el.id + ' ' + el.className));
    for (const el of document.querySelectorAll('body *')) { // pass A2: keyword-less text-detected banners
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt.length > 600 || !CONSENT_PHRASE.test(txt)) continue;
      const r = el.getBoundingClientRect();
      if (!vis(el) || r.height > innerHeight * 0.6) continue;
      if (!roots.includes(el)) roots.push(el);
    }
    for (const root of roots) {
      const btns = [...root.querySelectorAll('button,[role=button],a,input[type=button],input[type=submit]')].filter(vis);
      btns.sort((a, b) => (/accept|allow|agree/i.test(b.textContent || b.value || '') ? 1 : 0) - (/accept|allow|agree/i.test(a.textContent || a.value || '') ? 1 : 0));
      const hit = btns.find((b) => ACCEPT.test(((b.textContent || b.value || '').replace(/\s+/g, ' ').trim()))
        || /accept|dismiss|close/i.test(b.getAttribute('aria-label') || ''));
      if (hit) { try { hit.click(); out.push({ action: 'clicked', locator: cssPath(hit), text: (hit.textContent || hit.value || '').trim().slice(0, 60) }); } catch {} }
    }
    return out;
  }).catch(() => []);
  await page.waitForTimeout(700).catch(() => {});
  const hidden = await page.evaluate(() => { // pass B: CSS-hide survivors (nav-safe gates)
    const out = [];
    const cssPath = (el) => { const seg = []; let n = el, g = 0; while (n && n.nodeType === 1 && n !== document.documentElement && g++ < 12) { let s = n.tagName.toLowerCase(); if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { seg.unshift(`${s}#${n.id}`); break; } const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []; if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(n) + 1})`; seg.unshift(s); n = n.parentElement; } return seg.join('>'); };
    const CONSENT_PHRASE = /\b(we use cookies|(this |our )?(web)?site uses cookies|cookie (policy|preferences|settings|notice)|manage (your )?cookie)\b/i;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (!(cs.position === 'fixed' || cs.position === 'sticky')) continue;
      const z = parseInt(cs.zIndex, 10) || 0;
      const r = el.getBoundingClientRect();
      if (r.width < 5 || r.height < 5 || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const shortTxt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const strongConsent = shortTxt.length <= 600 && CONSENT_PHRASE.test(shortTxt) && r.height <= innerHeight * 0.6;
      if (z <= 999 && !strongConsent) continue;
      const meta = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`;
      const looksConsent = strongConsent
        || /cookie|consent|gdpr|cmp-|onetrust|cookiebot|didomi|usercentrics|truste/i.test(meta)
        || (/cookie|consent|gdpr/i.test((el.textContent || '').slice(0, 4000)) && /privacy|polic|accept|agree|preferences|tracking/i.test((el.textContent || '').slice(0, 4000)));
      const coversViewport = r.width >= innerWidth * 0.85 && r.height >= innerHeight * 0.85;
      const modalish = el.matches('[role=dialog],[aria-modal=true],[class*=backdrop i],[class*=modal i],[class*=overlay i]');
      if (looksConsent || (coversViewport && modalish)) {
        el.style.setProperty('display', 'none', 'important');
        out.push({ action: 'css-hidden', locator: cssPath(el), reason: looksConsent ? 'consent-keywords' : 'fullscreen-modal' });
      }
    }
    for (const n of [document.documentElement, document.body]) {
      if (getComputedStyle(n).overflow === 'hidden' || getComputedStyle(n).overflowY === 'hidden') {
        n.style.setProperty('overflow', 'visible', 'important');
        out.push({ action: 'scroll-unlocked', locator: n.tagName.toLowerCase() });
      }
    }
    return out;
  }).catch(() => []);
  return [...log, ...hidden];
}

// pin 2: FREEZE animations at a DETERMINISTIC pose. Finite → finish()+commitStyles() (end state written into
// inline style so entrance fades stay landed — bare animation:none would snap an opacity-0-base hero back to
// invisible); THEN kill-sheet animation:none (infinite marquees/spinners drop to their BASE pose — unlike
// capture-assets' pause()-at-t-settled, base pose is IDENTICAL across captures, which is what judge fairness
// needs: source and clone marquee must freeze at the SAME phase); remaining WAAPI (JS-created) animations
// cancelled to base; videos paused at t=0. marqueeBoxes (page coords, post-snap) logged so the selftest can
// pixel-compare the frozen regions across two captures.
// PLUS stacked-rotator pin: JS class-toggle rotators (clerk's "Trusted by" logo wall — all logos always in
// the DOM, an interval flips visibility classes; ZERO WAAPI/CSS animations involved, probed 2026-06-12) are
// invisible to getAnimations and phase-vary across captures (the wrong-logos sev4 artifact). Gate: a parent
// whose 2-12 element children are mutually STACKED (>=80% overlap with the first child's box) with a
// visible/invisible MIX (a static layered composition has no hidden member; a rotator always does) → pin the
// DOM-FIRST child visible, hide the rest. Dom-first is phase-INDEPENDENT (capture-assets' keep-end-state
// dedupe is phase-dependent) — two captures any seconds apart agree. Inline !important so later interval
// ticks cannot re-toggle effective visibility. Every pin logged with a locator.
async function freezeAnimations(page) {
  return await page.evaluate(() => {
    const log = { finished: 0, infiniteSnapped: 0, cancelled: 0, videos: 0, marqueeBoxes: [] };
    const targets = [];
    for (const a of document.getAnimations()) {
      try {
        const t = (a.effect && a.effect.getTiming) ? a.effect.getTiming() : {};
        const el = a.effect && a.effect.target;
        if (t.iterations === Infinity) { log.infiniteSnapped++; if (el && el.getBoundingClientRect) targets.push(el); }
        else { try { a.finish(); } catch {} try { a.commitStyles(); } catch {} log.finished++; }
      } catch {}
    }
    const st = document.createElement('style');
    st.id = '__vj_state_pin__';
    st.textContent = '*,*::before,*::after{animation:none !important;transition:none !important;scroll-behavior:auto !important;caret-color:transparent !important;}';
    document.documentElement.appendChild(st);
    for (const a of document.getAnimations()) { try { a.cancel(); log.cancelled++; } catch {} }
    for (const v of document.querySelectorAll('video')) { try { v.pause(); v.currentTime = 0; log.videos++; } catch {} }
    const sy = window.scrollY || 0;
    for (const el of targets) {
      try { const r = el.getBoundingClientRect(); if (r.width > 2 && r.height > 2) log.marqueeBoxes.push({ x: Math.round(r.left), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height) }); } catch {}
    }
    // QUIESCE JS time: kill all pending timers + rAF so interval-driven rotators/tickers cannot mutate the
    // page between freeze and shot (safe HERE: settleLazy already finished — nothing downstream of the freeze
    // needs page timers; the whole pin is reversible via VJ_NO_STATE_PIN=1).
    try { const top = setTimeout(() => {}, 0); for (let i = 1; i <= top; i++) { clearTimeout(i); clearInterval(i); } log.timersKilled = top; } catch {}
    try { window.requestAnimationFrame = () => 0; } catch {}
    // stacked-rotator pin (see header): dom-first member visible, rest hidden — phase-independent.
    log.rotatorsPinned = [];
    const cssPath = (el) => { const seg = []; let n = el, g = 0; while (n && n.nodeType === 1 && n !== document.documentElement && g++ < 12) { let s = n.tagName.toLowerCase(); if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { seg.unshift(`${s}#${n.id}`); break; } const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : []; if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(n) + 1})`; seg.unshift(s); n = n.parentElement; } return seg.join('>'); };
    const effHidden = (el) => { if (getComputedStyle(el).visibility === 'hidden') return true; let o = 1, n = el, g = 0; while (n && n !== document.body && g++ < 30) { o *= parseFloat(getComputedStyle(n).opacity || '1'); n = n.parentElement; } return o < 0.15; };
    for (const par of document.querySelectorAll('body *')) {
      if (par.children.length < 2 || par.children.length > 12) continue;
      const kids = [...par.children].filter((k) => { const r = k.getBoundingClientRect(); return r.width >= 24 && r.height >= 12 && getComputedStyle(k).display !== 'none'; });
      if (kids.length < 2 || kids.length !== par.children.length) continue;
      const r0 = kids[0].getBoundingClientRect();
      const stacked = kids.every((k) => {
        const r = k.getBoundingClientRect();
        const ix = Math.max(0, Math.min(r0.right, r.right) - Math.max(r0.left, r.left));
        const iy = Math.max(0, Math.min(r0.bottom, r.bottom) - Math.max(r0.top, r.top));
        const minArea = Math.max(1, Math.min(r0.width * r0.height, r.width * r.height));
        return (ix * iy) / minArea >= 0.8 && Math.max(r.width * r.height, r0.width * r0.height) / minArea <= 4;
      });
      if (!stacked) continue;
      const hiddenMix = kids.some(effHidden) && kids.some((k) => !effHidden(k));
      if (!hiddenMix) continue;                              // static layered composition, not a rotator
      kids[0].style.setProperty('opacity', '1', 'important');
      kids[0].style.setProperty('visibility', 'visible', 'important');
      for (const k of kids.slice(1)) k.style.setProperty('visibility', 'hidden', 'important');
      log.rotatorsPinned.push({ locator: cssPath(par), members: kids.length });
    }
    return log;
  }).catch(() => ({ finished: 0, infiniteSnapped: 0, cancelled: 0, videos: 0, marqueeBoxes: [], rotatorsPinned: [], error: true }));
}

// ── capture: logged-out FRESH browser per capture (renderer-crash isolation), full-page, settleLazy ──────────
// A renderer crash mid-screenshot ("Target page... has been closed", seen on tailwind@1100 2026-06-10) poisons
// the shared browser; per-capture launch + one retry makes each capture independent and self-healing.
// VJ-ALIGN meta (text leaves + full-width bands) is extracted AFTER the screenshot (never perturbs pixels);
// deviceScaleFactor 1 → DOM y == screenshot pixel y. Same band heuristic as grade-sections capture().
async function extractMeta(p) {
  try {
    return await p.evaluate(() => {
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const sy = window.scrollY || 0;
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const leaves = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let el;
      while ((el = walker.nextNode())) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own) continue;
        const t = clean(el.innerText || el.textContent);
        if (t.length < 6 || t.length > 200) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.height > 400) continue;
        const y = Math.round(r.top + sy);
        if (y < 0) continue;
        leaves.push({ key: t.slice(0, 80), y });
      }
      leaves.sort((a, b) => a.y - b.y);
      const bands = []; const seenBy = [];
      for (const e of document.querySelectorAll('body *')) {
        const r = e.getBoundingClientRect();
        if (r.width >= vw * 0.82 && r.height >= 120 && r.top + sy >= 0) {
          const by = Math.round(r.top + sy);
          if (seenBy.some((y) => Math.abs(y - by) <= 60)) continue;
          seenBy.push(by);
          bands.push({ y: by, h: Math.round(r.height) });
        }
      }
      bands.sort((a, b) => a.y - b.y);
      return { leaves, bands };
    });
  } catch { return { leaves: [], bands: [] }; }
}
async function captureFull(url, width, wantMeta = false) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
    try {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, ...(STATE_PIN ? { reducedMotion: 'reduce' } : {}) });
      await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
      const p = await ctx.newPage();
      await p.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
      await p.waitForTimeout(2000).catch(() => {});
      let state = null;
      if (STATE_PIN) {
        const o1 = await dismissOverlays(p);   // early: unlock consent scroll-locks BEFORE settleLazy needs them
        await settleLazy(p);
        const o2 = await dismissOverlays(p);   // late banners (consent managers that mount post-load)
        const freeze = await freezeAnimations(p);
        state = { overlays: [...o1, ...o2], freeze };
        if (state.overlays.length || freeze.infiniteSnapped || (freeze.rotatorsPinned || []).length) console.error(`[pin] ${url} @${width}: overlays ${state.overlays.length}, anims finished ${freeze.finished} / snapped ${freeze.infiniteSnapped}, rotators pinned ${(freeze.rotatorsPinned || []).length}, videos ${freeze.videos}`);
      } else {
        await settleLazy(p);
      }
      const buf = await Promise.race([
        p.screenshot({ fullPage: true, timeout: 90000 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('screenshot >120s')), 120000)),
      ]);
      const png = PNG.sync.read(buf);
      if (!wantMeta) return png;
      const meta = await extractMeta(p);
      return { png, leaves: meta.leaves, bands: meta.bands, state };
    } catch (e) {
      lastErr = e;
      console.error(`[capture] attempt ${attempt + 1} failed for ${url} @${width}: ${e && e.message || e}${attempt === 0 ? ' — retrying with fresh browser' : ''}`);
    } finally {
      await browser.close().catch(() => {});
    }
  }
  throw lastErr;
}

// ── PINNED SOURCE loader (VJ-SRCPIN, opt-in): a FROZEN full-page PNG instead of a live navigation ────────────
// Accepts either a direct .png path, or a `cap:<dir>` / bare-dir spec whose manifest.json maps width->shot.
// Returns the SAME shape captureFull(meta) returns — { png, leaves, bands, state } — but with leaves:[] (a flat
// PNG has no DOM text to anchor on) so the band-anchored planner naturally takes its honest proportional
// fallback. We DO surface coarse proportional `bands` from the cap manifest section y/h when present (purely
// informational; the proportional tiler does not consume them). Pinned=true & pinnedSpec recorded so the
// manifest/per-width meta can clearly label every tile as pinned-proportional (NOT live, NOT anchor-matched).
function resolvePinnedShot(spec, width) {
  const raw = spec.startsWith('cap:') ? spec.slice(4) : spec;
  // direct png
  if (isPng(raw)) return { shot: raw, manifestPath: null, sections: null, declaredH: null };
  // a dir → expect manifest.json with perWidth[width].shot
  const dir = raw;
  const mp = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mp)) throw new Error(`pinned-source dir has no manifest.json: ${mp}`);
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  const pw = m.perWidth && (m.perWidth[width] || m.perWidth[String(width)]);
  if (!pw || !pw.shot) throw new Error(`pinned-source manifest has no perWidth[${width}].shot (widths: ${Object.keys(m.perWidth || {}).join(',')})`);
  const shot = path.isAbsolute(pw.shot) ? pw.shot : path.join(dir, pw.shot);
  return { shot, manifestPath: mp, sections: Array.isArray(pw.sections) ? pw.sections : null, declaredH: pw.pageH != null ? +pw.pageH : null, srcUrl: m.source || null };
}
function loadFrozenSource(spec, width) {
  const { shot, sections, declaredH, srcUrl } = resolvePinnedShot(spec, width);
  if (!fs.existsSync(shot)) throw new Error(`pinned-source PNG not found: ${shot}`);
  const png = PNG.sync.read(fs.readFileSync(shot));
  // the PNG's intrinsic pixel height IS the true source height (deviceScaleFactor-1 capture).
  if (declaredH != null && Math.abs(declaredH - png.height) > 4) {
    console.error(`[pin-src] NOTE: manifest pageH ${declaredH} != PNG height ${png.height} @${width} — using PNG height (the painted pixels are ground truth)`);
  }
  // coarse proportional bands from manifest sections (informational only; flat PNG has no text anchors)
  const bands = (sections || []).filter((s) => s && s.h >= 120 && s.y >= 0).map((s) => ({ y: Math.round(s.y), h: Math.round(s.h) })).sort((a, b) => a.y - b.y);
  console.error(`[pin-src] @${width}: ${path.basename(shot)} ${png.width}x${png.height}${srcUrl ? ` (frozen ${srcUrl})` : ''} — NO DOM anchors -> honest proportional banding`);
  return { png, leaves: [], bands, state: { pinned: true, shot, srcUrl: srcUrl || null }, pinned: true };
}

// ── VJ-ALIGN pure functions (exported; unit-testable without network) ───────────────────────────────────────
// matchUniqueAnchors: pairs of (source y, clone y) for texts that occur EXACTLY ONCE on each side, then a
// longest-non-decreasing-subsequence filter on clone y kills crossings from false text matches (band order
// cannot cross). NOTE: deliberately NOT grade-vision-tiles.matchAnchors — its 120px DOM-y proximity gate
// assumes aligned heights, which is exactly what breaks at non-capture widths (src 14926 vs clone 21149 @1100).
export function matchUniqueAnchors(srcLeaves, clnLeaves) {
  const count = (ls) => { const m = new Map(); for (const l of ls) m.set(l.key, (m.get(l.key) || 0) + 1); return m; };
  const sc = count(srcLeaves), cc = count(clnLeaves);
  const cByKey = new Map(); for (const c of clnLeaves) if (cc.get(c.key) === 1) cByKey.set(c.key, c);
  const pairs = [];
  for (const s of srcLeaves) {
    if (sc.get(s.key) !== 1) continue;
    const c = cByKey.get(s.key); if (!c) continue;
    pairs.push({ key: s.key, sy: s.y, cy: c.y });
  }
  pairs.sort((a, b) => (a.sy - b.sy) || (a.cy - b.cy));
  // LIS (patience, O(n log n)) on cy → longest monotone subset
  const n = pairs.length; if (n === 0) return [];
  const tails = [], tailIdx = [], parent = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const v = pairs[i].cy;
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] <= v) lo = mid + 1; else hi = mid; }
    tails[lo] = v; tailIdx[lo] = i;
    parent[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  }
  const out = [];
  let k = tailIdx[tails.length - 1];
  while (k >= 0) { out.push(pairs[k]); k = parent[k]; }
  return out.reverse();
}

// anchorMaps: monotone piecewise-linear y-maps from anchor pairs; endpoints extrapolate with the GLOBAL height
// ratio (not the nearest segment's slope — a noisy edge pair must not fling the extrapolation off the page).
export function anchorMaps(pairs, srcH, clnH) {
  const r = clnH / Math.max(1, srcH);
  const xs = [], ys = [];
  for (const p of pairs) { if (xs.length && p.sy <= xs[xs.length - 1]) continue; xs.push(p.sy); ys.push(p.cy); }
  const interp = (X, Y, v, ratio) => {
    if (!X.length) return v * ratio;
    if (v <= X[0]) return Math.max(0, Y[0] - (X[0] - v) * ratio);
    if (v >= X[X.length - 1]) return Y[Y.length - 1] + (v - X[X.length - 1]) * ratio;
    let lo = 0, hi = X.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (X[mid] <= v) lo = mid; else hi = mid; }
    const t = (v - X[lo]) / Math.max(1, X[hi] - X[lo]);
    return Y[lo] + t * (Y[hi] - Y[lo]);
  };
  return { s2c: (y) => interp(xs, ys, y, r), c2s: (y) => interp(ys, xs, y, 1 / r) };
}

// segmentByBands: full-width band starts → ordered, non-overlapping segments covering [0, pageH].
export function segmentByBands(bands, pageH) {
  const ys = [0];
  for (const b of [...bands].sort((a, b) => a.y - b.y)) {
    if (b.y >= pageH - 60) continue;
    if (b.y - ys[ys.length - 1] >= 120) ys.push(b.y);
  }
  const segs = [];
  for (let i = 0; i < ys.length; i++) { const y1 = i + 1 < ys.length ? ys[i + 1] : pageH; if (y1 - ys[i] >= 60) segs.push({ y0: ys[i], y1 }); }
  if (!segs.length) segs.push({ y0: 0, y1: pageH });
  return segs;
}

// planBandTiles: the VJ-ALIGN tiling plan. Per source band segment:
//   matched (>=1 anchor pair inside)  → tile WITHIN the pair via the anchor map (same content both sides)
//   missing (>=2 unique src texts, 0 matched) → ONE 'missing' candidate spec carrying the interpolated clone
//     window; MAIN pixel-arbitrates it (blank window → deterministic sev5 clone-missing; content → judged
//     'unmatched' tile — imagery-sans-captions must not be deterministically condemned)
//   else (textless / non-unique text) → interpolated clone range, judged normally (align:'interp')
// Then clone segments with >=2 NOVEL texts (absent from the source entirely) and <30% coverage by mapped
// ranges → deterministic 'clone-extra band' tiles (sev4, score 30). <minAnchors pairs → proportional fallback.
export function planBandTiles({ srcLeaves, clnLeaves, srcBands, clnBands, srcH, clnH, tileH = 900, minAnchors = MIN_ANCHOR_PAIRS }) {
  const pairs = matchUniqueAnchors(srcLeaves || [], clnLeaves || []);
  if (pairs.length < minAnchors) return { mode: 'proportional-fallback', pairs: pairs.length, plan: null, stats: null };
  const { s2c, c2s } = anchorMaps(pairs, srcH, clnH);
  const srcKeyCount = new Map(); for (const l of srcLeaves) srcKeyCount.set(l.key, (srcKeyCount.get(l.key) || 0) + 1);
  const clnKeyCount = new Map(); for (const l of clnLeaves) clnKeyCount.set(l.key, (clnKeyCount.get(l.key) || 0) + 1);
  const segs = segmentByBands(srcBands || [], srcH);
  const plan = [];
  const stats = { segments: segs.length, matched: 0, interpolated: 0, missing: 0, extra: 0 };
  const covered = [];
  const clampC = (y) => Math.max(0, Math.min(Math.round(y), clnH));
  const emitPairChunks = (seg, band, align, sample, anchors) => {
    for (let a = seg.y0; a < seg.y1; a += tileH) {
      const b = Math.min(a + tileH, seg.y1);
      if (b - a < 60) break;
      const cy0 = clampC(s2c(a)), cy1 = Math.max(clampC(s2c(b)), cy0 + 20);
      plan.push({ kind: 'pair', band, align, sy0: a, sy1: b, cy0, cy1, sample, anchors });
    }
  };
  for (let i = 0; i < segs.length; i++) {
    const { y0, y1 } = segs[i];
    const inSeg = pairs.filter((p) => p.sy >= y0 && p.sy < y1);
    const srcUniqueInSeg = (srcLeaves || []).filter((l) => l.y >= y0 && l.y < y1 && srcKeyCount.get(l.key) === 1);
    if (inSeg.length >= 1) {
      stats.matched++;
      covered.push([clampC(s2c(y0)), clampC(s2c(y1))]);
      emitPairChunks(segs[i], i, 'band', inSeg[0].key.slice(0, 60), inSeg.length);
    } else if (srcUniqueInSeg.length >= 2) {
      stats.missing++;
      // text-unmatched: carry the anchor-interpolated clone window (min 240px) — MAIN pixel-arbitrates it
      // (blank → deterministic clone-missing; content → judged 'unmatched' tile). Pure function stays pixel-free.
      const wc0 = Math.max(0, Math.min(clampC(s2c(y0)), clnH - 240));
      const wc1 = Math.min(clnH, Math.max(clampC(s2c(y1)), wc0 + 240));
      plan.push({ kind: 'missing', band: i, sy0: y0, sy1: Math.min(y1, y0 + 2 * tileH), fullSy1: y1, cy0: wc0, cy1: wc1, sample: srcUniqueInSeg[0].key.slice(0, 60) });
    } else {
      stats.interpolated++;
      covered.push([clampC(s2c(y0)), clampC(s2c(y1))]);
      emitPairChunks(segs[i], i, 'interp', null, 0);
    }
  }
  for (const cs of segmentByBands(clnBands || [], clnH)) {
    const novel = (clnLeaves || []).filter((l) => l.y >= cs.y0 && l.y < cs.y1 && clnKeyCount.get(l.key) === 1 && !srcKeyCount.has(l.key));
    if (novel.length < 2) continue;
    let cov = 0;
    for (const [a, b] of covered) cov += Math.max(0, Math.min(b, cs.y1) - Math.max(a, cs.y0));
    if (cov / Math.max(1, cs.y1 - cs.y0) >= 0.3) continue;
    stats.extra++;
    const sy0 = Math.max(0, Math.round(c2s(cs.y0)));
    plan.push({ kind: 'extra', band: -1, cy0: cs.y0, cy1: Math.min(cs.y1, cs.y0 + 2 * tileH), fullCy1: cs.y1, sy0, sy1: Math.max(0, Math.round(c2s(cs.y1))), sample: novel[0].key.slice(0, 60) });
  }
  return { mode: 'band', pairs: pairs.length, plan, stats };
}

// ── judge: claude -p headless vision call, strict JSON parse + 1 retry ───────────────────────────────────────
const RUBRIC = (tilePath, width, y0, y1) => `You are a pixel-fidelity QA judge. Read the image file ${tilePath} now.
It is a side-by-side composite: LEFT of the vertical magenta divider is the ORIGINAL website; RIGHT is a REBUILD of the same page region (viewport width ${width}px, page band y=${y0}-${y1}). The solid-black strip across the very top carries SRC/CLONE labels added by the harness — it is NOT part of either page and covers no content; page content starts directly below it. Ignore the strip and its labels.
Score the RIGHT side's fidelity to the LEFT, 0-100:
- 100 = indistinguishable at a glance
- 50 = same skeleton but obviously different on inspection
- below 30 = clearly broken or missing content
Enumerate EVERY visible defect of the RIGHT side relative to the LEFT. Each defect is {"desc": "<specific, names the element>", "severity": 1-5, "category": "missing-content"|"wrong-style"|"layout-broken"|"text-junk"|"imagery-missing"|"chrome-missing"}.
Severity anchors — calibrate strictly to these examples:
- 5 = RUINS the page: whole hero/section missing or blank, layout collapsed into an unreadable pile, page dominated by junk text. A missing two-word sub-heading is NOT a 5.
- 4 = major: brand logo missing or wrong, primary CTA unstyled/invisible, hero image missing, dead UI mockup (no window dots/tabs/syntax colors).
- 3 = clearly noticeable: wrong font/color on a prominent heading, misaligned card grid, a secondary image missing.
- 2 = minor: small spacing/weight/radius differences, a short sub-heading or caption missing.
- 1 = trivial nitpick visible only side-by-side.
Be strict: missing logos/icons/images, unstyled buttons or pills, text rendered as junk/stacked fragments, flattened inline code, dead UI mockups (missing window dots/tabs/syntax colors), overflowing or misaligned layout ALL count.
If both sides are empty or identical, score 100 with zero defects. Dark-gray padding at the bottom of one side only reflects a page-height mismatch — judge the painted content.
Output ONLY this JSON, no prose, no markdown fences: {"score": <0-100>, "defects": [{"desc": "...", "severity": <1-5>, "category": "..."}]}`;

function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

// NO-WEDGE: killSignal SIGKILL on the soft (execFile) timeout PLUS an unref'd hard-timeout race at
// timeoutMs+30s that SIGKILLs the child and resolves {ok:false,error:'hard-timeout'} — a hung claude call
// must never wedge a pool worker. ISOLATION: --strict-mcp-config + --setting-sources "" so the nested
// session loads NO project/user settings, spawns NO MCP servers / context-hub daemon, and leaves NO
// .claude/.tenet/.mcp.json scaffold in cwd. (Do NOT use --bare — it breaks OAuth.)
function claudeOnce(prompt, timeoutMs = 240000, opts = {}) {
  const model = opts.model || MODEL;
  const cwd = opts.cwd || OUT;
  const hardMs = opts.hardMs || timeoutMs + 30000;
  return new Promise((resolve) => {
    let child = null;
    const hard = setTimeout(() => {
      try { if (child) child.kill('SIGKILL'); } catch {}
      resolve({ ok: false, error: 'hard-timeout' });
    }, hardMs);
    hard.unref();
    child = execFile('claude',
      ['-p', prompt, '--model', model, '--output-format', 'json', '--allowedTools', 'Read',
       '--max-budget-usd', '0.60', '--strict-mcp-config', '--setting-sources', ''],
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, cwd },
      (err, stdout) => {
        clearTimeout(hard);
        if (err && !stdout) return resolve({ ok: false, error: String(err && err.message || err) });
        let outer = null; try { outer = JSON.parse(stdout); } catch {}
        if (!outer) return resolve({ ok: false, error: 'outer JSON parse failed', raw: String(stdout).slice(0, 400) });
        const verdict = extractJson(outer.result);
        // modelUsage lists the haiku CLI helper alongside the judge model — record the NON-helper one
        // (critic mustFix: first-key picked the helper and misattributed every judgment to haiku).
        const usedModel = outer.modelUsage ? (Object.keys(outer.modelUsage).find((k) => !/haiku/.test(k)) || Object.keys(outer.modelUsage)[0]) : model;
        const cost = +outer.total_cost_usd || 0;
        if (!verdict || typeof verdict.score !== 'number' || !Array.isArray(verdict.defects)) {
          return resolve({ ok: false, error: 'verdict JSON invalid', cost, model: usedModel, raw: String(outer.result).slice(0, 400) });
        }
        verdict.score = Math.max(0, Math.min(100, verdict.score));
        verdict.defects = verdict.defects
          .filter((d) => d && d.desc)
          .map((d) => ({ desc: String(d.desc).slice(0, 300), severity: Math.max(1, Math.min(5, +d.severity || 1)), category: String(d.category || 'wrong-style') }));
        resolve({ ok: true, verdict, cost, model: usedModel });
      });
    child.on('error', () => { clearTimeout(hard); resolve({ ok: false, error: 'spawn failed' }); });
  });
}

let spentUsd = 0;
async function judgeTile(tile) {
  const runs = [];
  for (let r = 0; r < RUNS; r++) {
    if (spentUsd >= BUDGET) return { judged: false, reason: 'budget-exhausted' };
    let res = await claudeOnce(RUBRIC(tile.tilePath, tile.width, tile.yRange[0], tile.yRange[1]));
    spentUsd += res.cost || 0;
    if (!res.ok) { // one strict retry
      if (spentUsd >= BUDGET) return { judged: false, reason: 'budget-exhausted' };
      res = await claudeOnce(RUBRIC(tile.tilePath, tile.width, tile.yRange[0], tile.yRange[1]) +
        '\nYour previous output was not valid JSON. Output ONLY the raw JSON object — nothing else.');
      spentUsd += res.cost || 0;
    }
    if (!res.ok) return { judged: false, reason: res.error || 'parse-failed', model: res.model };
    runs.push(res);
  }
  // median per-tile score across runs; defects taken from the median run (ties -> lower index)
  const sorted = runs.map((r, i) => ({ i, s: r.verdict.score })).sort((a, b) => a.s - b.s);
  const med = sorted[Math.floor((sorted.length - 1) / 2)];
  const pick = runs[med.i];
  return { judged: true, score: pick.verdict.score, scores: runs.map((r) => r.verdict.score), defects: pick.verdict.defects, model: pick.model };
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

// ── exports (consumed by _vj-selftest.mjs, _vjalign-selftest.mjs, _vj-statepin-selftest.mjs, agent judging) ──
export { composeTile, captureFull, claudeOnce, RUBRIC, extractJson, drawLabel, bandPlaceholder, dismissOverlays, freezeAnimations, LABEL_STRIP, BG_DEFECT };

// ── main (only when invoked directly — importable as a library without side effects) ────────────────────────
const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (IS_MAIN) (async () => {
  if (!SOURCE || !CLONE) { console.error('usage: node vision-judge.mjs --source <url|file.png|cap:dir> --clone <url> [--pinned-source <file.png|cap:dir>] [--widths 1440,1100] [--out dir] [--gating] [--structure <grade-structure results.json>] [--manifest-only]'); process.exit(2); }
  // §0 SAFETY GUARD: assert every http(s) URL arg targets a training host (blocks the paused shared host) BEFORE any
  // chromium.goto. (SOURCE may be a file.png / cap:dir spec when PINNED — the http(s) test skips those; CLONE is the
  // LIVE local clone URL we must keep on a training host.)
  if (CLONE && /^https?:/i.test(CLONE)) assertAllowedBase(CLONE); for (const u of [SOURCE, PINNED_SOURCE]) { if (u && /^https?:/i.test(u)) assertNotBlocked(u); }
  if (PINNED) console.error(`[pin-src] PINNED-SOURCE mode ON (opt-in): source = FROZEN ${PIN_SPEC} (no live navigation); clone = LIVE ${CLONE}. Tiles will be labeled pinned-proportional (flat PNG has no DOM anchors).`);
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  // NO sibling-pkill: every captureFull() launches its own ephemeral Playwright browser (own temp
  // user-data-dir), so parallel vision-judge runs are already isolated. The old unconditional
  // `pkill -9 chrome-headless-shell` killed SIBLING runs' captures mid-screenshot. Opt IN with VJ_PKILL=1
  // only for manual stale-process cleanup when nothing else is running.
  if (process.env.VJ_PKILL === '1') { try { execFileSync('pkill', ['-9', '-f', 'chrome-headless-shell']); } catch {} }
  const tiles = [];
  const perWidthMeta = {};
  {
    for (const width of WIDTHS) {
      console.error(`[capture] ${width}px source...`);
      const srcCap = PINNED ? loadFrozenSource(PIN_SPEC, width) : await captureFull(SOURCE, width, VJALIGN);
      console.error(`[capture] ${width}px clone...`);
      const clnCap = await captureFull(CLONE, width, VJALIGN);
      const src = (PINNED || VJALIGN) ? srcCap.png : srcCap; // pinned source is ALWAYS the { png, ... } object
      const cln = VJALIGN ? clnCap.png : clnCap;
      const r = cln.height / src.height; // proportional y alignment (identity at hRatio 1)
      perWidthMeta[width] = { srcHeight: src.height, cloneHeight: cln.height, hRatio: +r.toFixed(3) };
      console.error(`[tile] ${width}px srcH=${src.height} clnH=${cln.height} hRatio=${r.toFixed(3)}`);
      let idx = 0;
      const proportionalTiles = (align) => { // legacy geometry; align label only present on the VJALIGN fallback
        for (let y0 = 0; y0 < src.height && idx < MAX_TILES; y0 += TILE_H) {
          const h = Math.min(TILE_H, src.height - y0);
          if (h < 60) break;
          const cy0 = Math.round(y0 * r);
          const ch = Math.max(60, Math.min(Math.round(h * r), cln.height - cy0));
          const sTile = crop(src, 0, y0, src.width, h);
          const cTile = crop(cln, 0, cy0, cln.width, Math.max(ch, 1));
          const comp = composeTile(sTile, cTile, width, y0);
          const tilePath = path.join(OUT, `w${width}-tile-${String(idx).padStart(2, '0')}.png`);
          fs.writeFileSync(tilePath, PNG.sync.write(comp));
          tiles.push({ idx, width, yRange: [y0, y0 + h], cloneYRange: [cy0, cy0 + ch], tilePath, aboveFold: y0 < FOLD_Y, ...(align ? { align } : {}) });
          idx++;
        }
      };
      if (!VJALIGN) { proportionalTiles(null); continue; } // legacy path: byte-identical tiles + manifest shape
      if (PINNED) { // a flat frozen PNG has NO DOM text anchors → honest proportional banding (clearly labeled)
        perWidthMeta[width].align = { mode: 'pinned-proportional', anchorPairs: 0, pinnedSource: PIN_SPEC };
        console.error(`[align] ${width}px PINNED-PROPORTIONAL (frozen PNG source, no DOM anchors; clone band = source band * ${(cln.height / src.height).toFixed(3)})`);
        proportionalTiles('pinned-proportional');
        continue;
      }
      // ── VJ-ALIGN: band-anchored tiling (see header). Same content on both sides of every judged tile. ──────
      const bp = planBandTiles({ srcLeaves: srcCap.leaves, clnLeaves: clnCap.leaves, srcBands: srcCap.bands, clnBands: clnCap.bands, srcH: src.height, clnH: cln.height, tileH: TILE_H });
      if (bp.mode !== 'band') {
        perWidthMeta[width].align = { mode: 'proportional-fallback', anchorPairs: bp.pairs };
        console.error(`[align] ${width}px FALLBACK proportional (${bp.pairs} anchor pairs < ${MIN_ANCHOR_PAIRS})`);
        proportionalTiles('proportional');
        continue;
      }
      perWidthMeta[width].align = { mode: 'band', anchorPairs: bp.pairs, ...bp.stats };
      console.error(`[align] ${width}px band-anchored: ${bp.pairs} anchors, ${bp.stats.segments} src bands -> ${bp.stats.matched} matched / ${bp.stats.interpolated} interp / ${bp.stats.missing} clone-missing / ${bp.stats.extra} clone-extra`);
      for (const spec of bp.plan) {
        if (idx >= MAX_TILES) break;
        const tilePath = path.join(OUT, `w${width}-tile-${String(idx).padStart(2, '0')}.png`);
        if (spec.kind === 'pair') {
          const sTile = crop(src, 0, spec.sy0, src.width, spec.sy1 - spec.sy0);
          const cTile = crop(cln, 0, spec.cy0, cln.width, Math.max(spec.cy1 - spec.cy0, 1));
          fs.writeFileSync(tilePath, PNG.sync.write(composeTile(sTile, cTile, width, spec.sy0)));
          tiles.push({ idx, width, yRange: [spec.sy0, spec.sy1], cloneYRange: [spec.cy0, spec.cy1], tilePath, aboveFold: spec.sy0 < FOLD_Y, band: spec.band, align: spec.align, anchors: spec.anchors });
        } else if (spec.kind === 'missing') {
          const h = spec.sy1 - spec.sy0;
          const sTile = crop(src, 0, spec.sy0, src.width, h);
          // PIXEL ARBITRATION (see header): deterministic clone-missing ONLY when the mapped window is blank.
          const winStd = bandLumaStd(cln, spec.cy0, spec.cy1);
          if (winStd < 8) {
            const cTile = crop(cln, 0, spec.cy0, cln.width, spec.cy1 - spec.cy0); // show the REAL blank window (evidence)
            fs.writeFileSync(tilePath, PNG.sync.write(composeTile(sTile, cTile, width, spec.sy0, { clone: 'CLONE-MISSING BAND' })));
            tiles.push({
              idx, width, yRange: [spec.sy0, spec.fullSy1], cloneYRange: [spec.cy0, spec.cy1], tilePath, aboveFold: spec.sy0 < FOLD_Y, band: spec.band, align: 'missing', sample: spec.sample, windowLumaStd: +winStd.toFixed(1),
              det: { judged: true, deterministic: true, score: 10, scores: [10], model: 'band-align-deterministic', defects: [{ desc: `clone-missing band: source section y${spec.sy0}-${spec.fullSy1} ("${spec.sample}") has no text match anywhere in the clone and its mapped clone region y${spec.cy0}-${spec.cy1} is blank`, severity: 5, category: 'missing-content' }] },
            });
          } else { // content in the window (imagery sans captions / squeezed neighbors) → the vision judge arbitrates
            const cTile = crop(cln, 0, spec.cy0, cln.width, spec.cy1 - spec.cy0);
            fs.writeFileSync(tilePath, PNG.sync.write(composeTile(sTile, cTile, width, spec.sy0)));
            tiles.push({ idx, width, yRange: [spec.sy0, spec.sy1], cloneYRange: [spec.cy0, spec.cy1], tilePath, aboveFold: spec.sy0 < FOLD_Y, band: spec.band, align: 'unmatched', sample: spec.sample, windowLumaStd: +winStd.toFixed(1) });
          }
        } else { // extra
          const h = spec.cy1 - spec.cy0;
          const cTile = crop(cln, 0, spec.cy0, cln.width, h);
          fs.writeFileSync(tilePath, PNG.sync.write(composeTile(bandPlaceholder(src.width, h), cTile, width, spec.sy0, { src: 'NO SOURCE BAND' })));
          tiles.push({
            idx, width, yRange: [spec.sy0, spec.sy1], cloneYRange: [spec.cy0, spec.fullCy1], tilePath, aboveFold: spec.sy0 < FOLD_Y, band: spec.band, align: 'extra', sample: spec.sample,
            det: { judged: true, deterministic: true, score: 30, scores: [30], model: 'band-align-deterministic', defects: [{ desc: `clone-extra band: clone y${spec.cy0}-${spec.fullCy1} ("${spec.sample}") has no corresponding source section`, severity: 4, category: 'text-junk' }] },
          });
        }
        idx++;
      }
      // record the missing-band pixel arbitration outcome (textMissing candidates → deterministic vs judged)
      const w = tiles.filter((t) => t.width === width);
      perWidthMeta[width].align.missingDeterministic = w.filter((t) => t.align === 'missing').length;
      perWidthMeta[width].align.unmatchedJudged = w.filter((t) => t.align === 'unmatched').length;
      if (bp.stats.missing) console.error(`[align] ${width}px missing-band arbitration: ${perWidthMeta[width].align.missingDeterministic} blank->deterministic, ${perWidthMeta[width].align.unmatchedJudged} content->judged`);
    }
  }

  const manifest = { source: SOURCE, clone: CLONE, pinnedSource: PINNED ? PIN_SPEC : null, widths: WIDTHS, tileH: TILE_H, foldY: FOLD_Y, perWidth: perWidthMeta, tileCount: tiles.length, tiles, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.error(`[manifest] ${tiles.length} tiles -> ${path.join(OUT, 'manifest.json')}`);
  if (MANIFEST_ONLY) { console.log(JSON.stringify({ manifest: path.join(OUT, 'manifest.json'), tileCount: tiles.length, perWidth: perWidthMeta }, null, 2)); return; }

  console.error(`[judge] ${tiles.length} tiles x ${RUNS} run(s), ${JOBS} parallel, model=${MODEL}, budget $${BUDGET}`);
  const judgments = await pool(tiles, JOBS, async (t, i) => {
    // VJ-ALIGN deterministic tiles (clone-missing/extra band) carry their verdict — no LLM call, no cost.
    if (t.det) { console.error(`[judge] tile ${t.width}/${String(t.idx).padStart(2, '0')} DETERMINISTIC score=${t.det.score} (${t.align} band)`); return t.det; }
    const j = await judgeTile(t);
    console.error(`[judge] tile ${t.width}/${String(t.idx).padStart(2, '0')} ${j.judged ? `score=${j.score} defects=${j.defects.length}` : `SKIPPED (${j.reason})`} | spent $${spentUsd.toFixed(2)}`);
    return j;
  });

  // ── aggregate: weighted mean (aboveFold x3) minus sev>=4 penalties; per-width breakdown ───────────────────
  const enriched = tiles.map((t, i) => { const { det, ...rest } = t; return { ...rest, ...judgments[i] }; });
  // VJ-BOUNDARY GUARD (default ON; VJ_NO_BOUNDARY_GUARD=1 skips this block entirely → legacy byte-identical):
  // de-fang the hRatio<1 band-edge false-sev5 (a thin boundary-cut tile with a white↔dark transition on ONE
  // side and a solid section on the OTHER provoked an inverted/dark-absent sev5 that is pure alignment noise).
  // Judged, NON-deterministic tiles only — deterministic clone-missing/extra bands carry their own verdict.
  if (BOUNDARY_GUARD) {
    let guardedTiles = 0, guardedDefects = 0;
    for (const t of enriched) {
      if (!t.judged || t.deterministic || !Array.isArray(t.defects) || !t.defects.some((d) => d.severity >= 4 && BG_DEFECT.test(d.desc || ''))) continue;
      let png; try { png = PNG.sync.read(fs.readFileSync(t.tilePath)); } catch { continue; }
      const srcContentH = (t.yRange && (t.yRange[1] - t.yRange[0])) || null;
      if (!isBoundaryArtifactTile(png, srcContentH)) continue;
      const { defects, reclassified } = reclassifyBoundaryDefects(t.defects);
      if (reclassified) { t.defects = defects; t.boundaryGuard = { reclassified }; guardedTiles++; guardedDefects += reclassified; }
    }
    if (guardedTiles) console.error(`[boundary-guard] reclassified ${guardedDefects} sev>=4 background/inversion defect(s) on ${guardedTiles} hRatio-compression boundary-edge tile(s) -> sev2 (no penalty floor; score unchanged)`);
  }
  const aggregate = (subset) => {
    const judged = subset.filter((t) => t.judged);
    if (!judged.length) return { pageScore: null, base: null, penalty: 0, judged: 0, skipped: subset.length };
    let sw = 0, ss = 0;
    for (const t of judged) { const w = t.aboveFold ? 3 : 1; sw += w; ss += t.score * w; }
    const base = ss / sw;
    let penalty = 0;
    for (const t of judged) for (const d of t.defects) if (d.severity >= 4) penalty += d.severity === 5 ? 4 : 2;
    penalty = Math.min(35, penalty);
    return { pageScore: +Math.max(0, base - penalty).toFixed(1), base: +base.toFixed(1), penalty, judged: judged.length, skipped: subset.length - judged.length };
  };
  const overall = aggregate(enriched);
  const perWidth = {};
  for (const w of WIDTHS) perWidth[w] = { ...perWidthMeta[w], ...aggregate(enriched.filter((t) => t.width === w)) };

  const allDefects = [];
  for (const t of enriched) if (t.judged) for (const d of t.defects) allDefects.push({ ...d, width: t.width, tile: t.idx, yRange: t.yRange, aboveFold: t.aboveFold, tileScore: t.score });
  allDefects.sort((a, b) => (b.severity - a.severity) || (b.aboveFold - a.aboveFold) || (a.tileScore - b.tileScore));

  // ── VETO COMBINER: vision pageScore is the headline ONLY through deterministic vetoes ────────────────────
  // publishedScore = min(visionScore, vetoCappedScore). A full-page-raster clone has ~0 native textCoverage in
  // grade-structure → textVetoCap ~0 → it cannot win on vision alone. h-overflow reuses grade-structure's hPen.
  let veto = null, publishedScore = null;
  if (STRUCTURE) {
    try {
      const sj = JSON.parse(fs.readFileSync(STRUCTURE, 'utf8'));
      const b = sj.breakdown || sj;
      const textCoverage = Number(b.textCoverage ?? sj.textCoverage);
      const hRatio = Number(b.hRatio ?? sj.hRatio);
      const textVetoCap = Number.isFinite(textCoverage) ? +(100 * Math.min(1, textCoverage / 0.9)).toFixed(1) : null;
      const heightVetoCap = Number.isFinite(hRatio) ? +(100 * Math.max(0.3, Math.min(1, 1 - Math.max(0, Math.abs(hRatio - 1) - 0.1) * 0.6))).toFixed(1) : null;
      const caps = [textVetoCap, heightVetoCap].filter((c) => c != null);
      const vetoCappedScore = caps.length ? Math.min(...caps) : null;
      if (overall.pageScore != null) publishedScore = vetoCappedScore != null ? +Math.min(overall.pageScore, vetoCappedScore).toFixed(1) : overall.pageScore;
      veto = { structure: STRUCTURE, textCoverage: Number.isFinite(textCoverage) ? textCoverage : null, hRatio: Number.isFinite(hRatio) ? hRatio : null, textVetoCap, heightVetoCap, vetoCappedScore, capped: publishedScore != null && overall.pageScore != null && publishedScore < overall.pageScore };
    } catch (e) { veto = { structure: STRUCTURE, error: String(e && e.message || e) }; console.error(`[veto] failed to read --structure: ${e && e.message || e} — publishedScore=null`); }
  } else {
    console.error('[veto] WARNING: no --structure <grade-structure results.json> given — pageScore is RAW vision; publishedScore=null (NOT publishable for gating: a full-page-raster clone could max raw vision).');
  }

  const modelUsed = enriched.find((t) => t.judged && !t.deterministic)?.model || MODEL;
  const results = {
    source: SOURCE, clone: CLONE, pinnedSource: PINNED ? PIN_SPEC : null, widths: WIDTHS, runsPerTile: RUNS, gating: GATING, model: modelUsed,
    publishedScore, veto,
    pageScore: overall.pageScore, baseScore: overall.base, severityPenalty: overall.penalty,
    perWidth, tilesJudged: overall.judged, tilesSkipped: overall.skipped,
    costUsd: +spentUsd.toFixed(2), wallSec: Math.round((Date.now() - t0) / 1000),
    defects: allDefects, tiles: enriched.map(({ tilePath, ...t }) => ({ ...t, tilePath })),
  };
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));

  console.log(JSON.stringify({
    publishedScore, veto,
    pageScore: overall.pageScore, baseScore: overall.base, severityPenalty: overall.penalty,
    perWidth: Object.fromEntries(Object.entries(perWidth).map(([w, v]) => [w, { pageScore: v.pageScore, base: v.base, penalty: v.penalty, hRatio: v.hRatio, judged: v.judged, skipped: v.skipped }])),
    model: modelUsed, runsPerTile: RUNS, gating: GATING, costUsd: results.costUsd, wallSec: results.wallSec,
    tilesJudged: overall.judged, tilesSkipped: overall.skipped,
    topDefects: allDefects.slice(0, 12).map((d) => `[sev${d.severity}|${d.category}|${d.width}px y${d.yRange[0]}] ${d.desc}`),
    out: { manifest: path.join(OUT, 'manifest.json'), results: path.join(OUT, 'results.json') },
  }, null, 2));
})().catch((e) => { console.error('VISION-JUDGE FAILED:', e && e.message || e); process.exit(1); });
