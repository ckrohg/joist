#!/usr/bin/env node
/**
 * @purpose DETERMINISTIC responsive STRUCTURAL RAIL for the Joist cloner — a single-page,
 * cap-anchored, NO-MODEL responsive check. Renders/probes ONE clone URL at widths
 * [1440, 768, 390] via headless Playwright and scores how well it REFLOWS, judged
 * against a frozen multi-width source-capture manifest (cap.perWidth[w].pageH).
 *
 * WHY A SEPARATE FILE (NOT grade-responsive.mjs):
 *   eval/grader/grade-responsive.mjs is the SHIPPED RLG grader (Responsive Layout Graph,
 *   source-vs-clone edge-set agreement). grade-sections.mjs SPAWNS it as a subprocess and
 *   parses `responsiveScore` from its JSON — overwriting it would break the production
 *   grade-sections pipeline. This rail answers a DIFFERENT question with a DIFFERENT contract
 *   (clone-only, anchored to a frozen cap manifest, deterministic structural signals), so it
 *   lives beside the RLG grader rather than replacing it.
 *
 * WHY DETERMINISTIC (not the vision-judge): the side-by-side vision-judge is UNRELIABLE
 *   off-1440 (proportional banding distorts the tiles at 768/390), so responsive fidelity
 *   needs a structural rail the judge cannot supply. Every signal here is a DOM-rect / computed-
 *   style read — same inputs → same outputs, no LLM, no screenshot diffing.
 *
 * DIMENSIONS (per width 1440/768/390):
 *   1. NO HORIZONTAL OVERFLOW  — gutter = scrollWidth - innerWidth. >OVERFLOW_SLACK px = FAIL.
 *      This is the most human-salient responsive defect (ugly side-scroll / cut-off content).
 *   2. HEIGHT SANITY           — hRatio = cloneH / cap.perWidth[w].pageH. Flagged (not hard-failed)
 *      outside [HRATIO_LO, HRATIO_HI]: too short ⇒ missing content; too tall ⇒ broken reflow.
 *      The 2-row→reflow taller case at narrow widths is EXPECTED, so the band is asymmetric-tolerant
 *      (HRATIO_HI is generous) and a height flag is a WEAK penalty, never an overflow-class fail.
 *   3. TYPOGRAPHY SCALES       — the page's MAX computed heading font-size must DECREASE
 *      monotonic-ish as width shrinks (1440 > 768 ≥ 390). A hero stuck at the same px across
 *      widths is the EXACT bug the native-responsive-fontsize fix addressed → FAIL.
 *   4. GRID REFLOW (SCORE-WEIGHTED, GRID_W=0.20) — profile each width's "card rows" (y-banded groups
 *      of >=2 equal-width sibling boxes) and measure how the dense narrow-multi-up rows SHED + the
 *      median card-width-fraction GROWS as the viewport narrows. General (any sibling card row), not
 *      clerk-hardcoded. ABSTAINS (dropped from score) on pages with no narrow-multi-up grid to reflow.
 *      Was excluded (GRID_W=0) until the settleLazy capture hardening made it reproducibly discriminate
 *      GREEN(1.0)/RED(0.655) on freshly-injected scratch pages. See GRID_W note + SELF-FALSIFIER.
 *   5. NO ELEMENT PAST VIEWPORT (optional) — count widgets whose right edge > innerWidth + slack.
 *
 * SCORE (0..1): mean over widths of a per-width score built ONLY from the discriminating dims:
 *   perWidth = OVERFLOW_W*overflowOK + HEIGHT_W*heightOK + (typo handled page-level).
 *   typoOK is a PAGE-LEVEL gate (monotonic max-heading across widths) folded in once.
 *   pass = score >= PASS_THRESHOLD AND no width has a hard overflow fail AND typo monotonic.
 *
 * RAILS: LOCAL Docker sandbox ONLY. This script only READS a URL (default page 83) — it never
 *   writes/injects. Render/teardown of scratch pages is the harness's job, not this grader's.
 *
 * Usage:
 *   node grade-responsive-rail.mjs --url http://localhost:8001/?page_id=83 \
 *        --cap /tmp/local-fidelity/cap/manifest.json [--widths 1440,768,390] [--out dir] [--label tag]
 *   node grade-responsive-rail.mjs --url <green> --cap <m> --json   # machine-readable only
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// ─── Named thresholds (all deterministic, tunable in one place) ──────────────────────────────
const WIDTHS_DEFAULT = [1440, 768, 390];
const OVERFLOW_SLACK = 4;     // px of scrollWidth-innerWidth tolerated (sub-pixel rounding / scrollbar)
const HRATIO_LO = 0.80;       // below ⇒ clone too short (missing content) — flag
const HRATIO_HI = 1.25;       // above ⇒ clone too tall (broken reflow) — flag; reflow-taller is OK up to here
const TYPO_MIN_TEXT_LEN = 4;  // ignore tiny labels when picking the page's "hero" max heading
const TYPO_MONO_SLACK = 1.0;  // px; 768 must be >= 390 within this slack; 1440 must be > 768 by > this
const TYPO_STUCK_TOL = 2.0;   // px; if max-heading changes <= this across the full 1440→390 sweep ⇒ STUCK ⇒ fail
const GRID_MIN_BOX = 40;      // px; ignore card boxes smaller than this in either dim
const GRID_BAND_PX = 24;      // px; sibling boxes whose tops share a /GRID_BAND_PX bucket are one visual card row
const GRID_WTOL = 0.18;       // frac; cards in a row must be within this width-similarity to count as a real grid
const GRID_NARROW_FRAC = 0.30;// frac of viewport; a card <= this in a >=3-col row is a "narrow multi-up" (un-reflowed) cell
// Grid-reflow scoring: a reflowing grid SHEDS narrow-multi-up rows and WIDENS its cards as the
// viewport narrows. We compare the WIDEST width (authoring, where pre/post fix are identical) to
// each narrower width. retain = narrowMulti3up[narrow]/narrowMulti3up[wide] — LOWER = more reflow.
const GRID_RETAIN_GOOD = 0.65;// retain <= this ⇒ full reflow credit (GREEN ~0.57); RED ~0.86 lands below
const GRID_RETAIN_BAD = 0.95; // retain >= this ⇒ no reflow credit (grid stayed dense/squished)
// GRID_W RE-ENABLED to 0.20 (2026-06-13, after the settleLazy capture hardening): the grid-reflow
// dim was previously EXCLUDED (GRID_W=0) because the scratch-RED falsifier could not be reproduced —
// freshly-injected scratch pages were observed to ABSTAIN (RED grid applicable=false) because the
// card-grid IMAGES had not painted at rect-read time, collapsing the card boxes below GRID_MIN_BOX.
// FIX: probeWidth now runs settleLazy() (default ON, RAIL_NO_SETTLE=1 reverts) — it scrolls the full
// page so every <img> enters the fetch path, waits for complete+decode, and returns to top BEFORE the
// rect read, so card measurement is invariant to capture timing. RE-VALIDATED 2026-06-13: GREEN
// (page 83) and freshly-injected cold RED graded 3× each (plus 7 extra cold RED cycles), ALL runs:
//   GREEN: grid APPLICABLE, gridScore=1.0, 768 retain=0.571, narrow3up 7→4
//   RED  : grid APPLICABLE (no abstention, cards painted), gridScore=0.655, 768 retain=0.857, 7→6
// Stable 0.345 grid-score margin + GREEN-retain(0.571) < RED-retain(0.857) every run → the dim is
// reproducibly discriminating, so it is restored to the score. (HONEST NOTE: in the current LOCAL
// Docker env the clerk card images are loading="eager" and the server is fast, so the abstention did
// not reproduce even on the legacy no-settle path during re-validation; settleLazy is the principled
// timing-invariant guarantee — it can only help, never hurt — and remains the supported capture path.)
const GRID_W = 0.20;          // weight of the grid-reflow dim in the final score (re-enabled — see above)
const PAST_VP_SLACK = 8;      // px; widget right edge beyond innerWidth+slack ⇒ counts as past-viewport
// Score weights (per-width, the two discriminating per-width dims). Typo folded in page-level.
const OVERFLOW_W = 0.6;
const HEIGHT_W = 0.4;
const TYPO_PAGE_W = 0.30;     // typo is a page-level gate (was 0.35; trimmed to make room for grid)
// final = (1-TYPO_PAGE_W-GRID_W)*meanPerWidth + TYPO_PAGE_W*typoScore + GRID_W*gridReflowScore
const PASS_THRESHOLD = 0.80;

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (i > -1 && (d === true) ? true : d); };
const has = (n) => process.argv.includes('--' + n);

// ─── In-page probe (runs in browser; pure DOM read) ──────────────────────────────────────────
function pageProbe() {
  // returns { sw, iw, bodyH, maxHeadingPx, maxHeadingTxt, grid:{...}, pastVp }
  const headings = [...document.querySelectorAll('h1,h2,.elementor-heading-title')];
  let maxPx = 0, maxTxt = '';
  for (const h of headings) {
    const fs = parseFloat(getComputedStyle(h).fontSize) || 0;
    const t = (h.textContent || '').trim();
    if (fs > maxPx && t.length > 3) { maxPx = fs; maxTxt = t.slice(0, 48); }
  }
  // ── GRID PROFILE (per width) ────────────────────────────────────────────────
  // The OLD probe collapsed grid to a binary "multiColRows" (cols>=2) count, which does
  // NOT discriminate a reflow: a 4-up grid that stays 4-up-but-squished (no reflow) and a
  // 4-up grid that reflowed to 2-up are BOTH "multi-col" → identical reading (validated:
  // pre/post native-grid fix both read multiColRows=5 @768). The native-grid fix is a
  // change in COLUMN COUNT (4→2) and CARD-WIDTH-FRACTION (0.25→0.47 of viewport), so the
  // discriminating signal is the *card row profile*, not a multi-col tally.
  //
  // METHOD: find every "card row" = a y-banded group of >=2 EQUAL-WIDTH (within GRID_WTOL)
  // sibling boxes (a real card grid, not a logo+text or image+copy split). For each row
  // record cols and the median card width AS A FRACTION OF THE VIEWPORT. Two page-level
  // aggregates drive the reflow score (compared across widths in gradeGridReflow):
  //   narrowMulti3up = # card rows with >=3 cols AND each card <= GRID_NARROW_FRAC of vp
  //                    (a dense, un-reflowed multi-up grid lives here; when it reflows to
  //                    2-up at half width its cards leave this bucket).
  //   medCardFrac    = median card-width-fraction over all multi-col rows (GROWS on reflow).
  const iw = window.innerWidth;
  const cardRows = [];
  const seenRow = new Set();
  for (const c of document.querySelectorAll('.e-con, .e-con-inner, .elementor-widget-wrap, .elementor-element')) {
    const kids = [...c.children].filter((k) => {
      const r = k.getBoundingClientRect(); return r.width > 40 && r.height > 40;
    });
    if (kids.length < 2) continue;
    const rects = kids.map((k) => k.getBoundingClientRect());
    const byBand = {};
    rects.forEach((r) => { const band = Math.round(r.top / 24); (byBand[band] = byBand[band] || []).push(r); });
    for (const band in byBand) {
      const row = byBand[band];
      if (row.length < 2) continue;
      const ws = row.map((r) => r.width).sort((a, z) => a - z);
      const med = ws[Math.floor(ws.length / 2)];
      const eq = row.filter((r) => Math.abs(r.width - med) / med <= 0.18); // GRID_WTOL: ~equal-width cards
      if (eq.length < 2) continue;
      const key = Math.round(eq[0].top / 8) + '|' + eq.length + '|' + Math.round(med); // de-dup nested re-counts
      if (seenRow.has(key)) continue; seenRow.add(key);
      cardRows.push({ cols: eq.length, frac: +(med / iw).toFixed(3) });
    }
  }
  const multiRows = cardRows.filter((r) => r.cols >= 2);
  const narrowMulti3up = cardRows.filter((r) => r.cols >= 3 && r.frac <= 0.30).length; // GRID_NARROW_FRAC=0.30
  const medCardFrac = multiRows.length
    ? +multiRows.map((r) => r.frac).sort((a, z) => a - z)[Math.floor(multiRows.length / 2)].toFixed(3) : 0;
  const maxCols = cardRows.length ? Math.max(...cardRows.map((r) => r.cols)) : 0;
  // past-viewport widgets
  let pastVp = 0;
  for (const w of document.querySelectorAll('.elementor-widget')) {
    const r = w.getBoundingClientRect();
    if (r.width > 0 && r.right > iw + 8) pastVp++;
  }
  return {
    sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    iw,
    bodyH: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    maxHeadingPx: maxPx,
    maxHeadingTxt: maxTxt,
    grid: {
      cardRowCount: cardRows.length,
      multiColRows: multiRows.length,
      narrowMulti3up,
      medCardFrac,
      maxColAny: maxCols,
    },
    pastVp,
  };
}

// Robust, idempotent lazy-content settle (ported from grade-vision-tiles.settleLazy, adapted for the
// RAIL: this grader reads DOM RECTS, not a screenshot, so the failure mode is different — an <img> that
// has not yet fetched/decoded reports naturalWidth=0 and (for a height-less <img>) a COLLAPSED
// getBoundingClientRect, which drops the card box below GRID_MIN_BOX → the card row is not counted →
// the grid dim ABSTAINS (applicable=false). On a freshly-injected scratch page the browser/server cache
// is cold, so below-fold card images are not fetched by the time `networkidle` fires (networkidle only
// waits on the requests that have STARTED — below-fold <img> requests start on scroll/IO). This settle
// scrolls the full page in viewport steps so every <img> enters the fetch path, WAITS for each to
// complete+decode (bounded), then returns to scrollY 0 so the rect read happens in the painted state.
// Idempotent (always ends at top; a no-op on an already-loaded page). REVERSIBLE: RAIL_NO_SETTLE=1 skips
// it and uses the legacy fast settle (byte-identical to the pre-settle capture: goto+1200ms, no scroll).
// BOUNDED: ~8s hard cap on the image-wait so the rail stays fast across all three viewports.
async function settleLazy(page) {
  // HARD RULE: must NEVER throw — a slow/closing page closed mid-settle once crashed the vision-tiler
  // (2026-06-09). Every page.* is individually .catch()'d AND the whole body wrapped; on any
  // page/context-closed error we degrade gracefully and let the caller's evaluate handle the page.
  try {
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const docH = () => document.body.scrollHeight;
      // incremental scroll; re-read height each step (lazy content can extend the page). Capped iters so
      // a (rare) infinite-growth page can't hang the capture.
      let y = 0, guard = 0;
      while (y <= docH() && guard++ < 400) { window.scrollTo(0, y); await sleep(90); y += 700; }
      window.scrollTo(0, docH()); await sleep(200);
      // wait for in-DOM images to finish (complete + non-zero natural size), bounded ~6s
      const pending = () => [...document.images].filter((im) => !(im.complete && im.naturalWidth > 0));
      const deadline = Date.now() + 6000;
      while (pending().length && Date.now() < deadline) await sleep(150);
      // force-decode (paint readiness), best-effort, SEQUENTIAL + capped at 64 loaded images (a
      // concurrent decode fan-out OOM-killed the renderer on image-heavy pages — supabase, 2026-06-10).
      const decodable = [...document.images].filter((im) => im.complete && im.naturalWidth > 0).slice(0, 64);
      for (const im of decodable) { try { if (im.decode) await im.decode(); } catch {} }
      window.scrollTo(0, 0); await sleep(120);
    }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(300).catch(() => {});
  } catch { /* page/context closed mid-settle → degrade gracefully (caller's evaluate handles it) */ }
}

async function probeWidth(browser, url, width) {
  const p = await browser.newPage();
  try {
    await p.setViewportSize({ width, height: 900 });
    try { await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 }); }
    catch { await p.goto(url, { waitUntil: 'load', timeout: 30000 }); }
    await p.waitForTimeout(1200);
    // DEFAULT: settle lazy/below-fold images so card boxes paint before we read their rects (makes the
    // grid dim deterministic on cold scratch pages). RAIL_NO_SETTLE=1 reverts to the legacy fast capture.
    if (!process.env.RAIL_NO_SETTLE) await settleLazy(p);
    return await p.evaluate(pageProbe);
  } finally {
    await p.close();
  }
}

function gradePerWidth(probe, capH) {
  const fails = [];
  const gutter = probe.sw - probe.iw;
  const overflowOK = gutter <= OVERFLOW_SLACK;
  if (!overflowOK) fails.push(`overflow:+${gutter}px`);

  const hRatio = capH ? +(probe.bodyH / capH).toFixed(3) : null;
  let heightOK = true;
  if (hRatio != null && (hRatio < HRATIO_LO || hRatio > HRATIO_HI)) {
    heightOK = false;
    fails.push(`hRatio:${hRatio}${hRatio < HRATIO_LO ? '(short)' : '(tall)'}`);
  }
  return {
    gutter, overflowOK, hRatio, heightOK,
    maxHeadingPx: probe.maxHeadingPx, maxHeadingTxt: probe.maxHeadingTxt,
    gridMaxCols: probe.grid.maxColAny, gridMultiColRows: probe.grid.multiColRows,
    gridNarrow3up: probe.grid.narrowMulti3up, gridMedCardFrac: probe.grid.medCardFrac,
    pastVp: probe.pastVp, fails,
    perWidthScore: +(OVERFLOW_W * (overflowOK ? 1 : 0) + HEIGHT_W * (heightOK ? 1 : 0)).toFixed(3),
  };
}

// Page-level GRID-REFLOW gate (now SCORE-WEIGHTED — see GRID_W). Compares the WIDEST width
// (authoring width, where pre/post native-grid fix are byte-identical) against each narrower
// width. A correctly-reflowing page SHEDS its narrow-multi-up card rows (a dense 4-up grid
// becomes 2-up → its cards leave the >=3-col, <=30%-vp "narrow" bucket) AND its median card
// width-fraction GROWS. A stuck/un-reflowed grid keeps the dense rows squished (narrowMulti3up
// barely drops; medCardFrac barely grows). VALIDATED discriminating @768 on this page:
//   GREEN(fixed): narrow3up 7→4 (retain 0.57), medCardFrac 0.154→0.287 (+0.133)
//   RED(pre-fix): narrow3up 7→6 (retain 0.86), medCardFrac 0.154→0.250 (+0.096)
// Score = best (lowest-retain) reflow observed across the narrower widths, mapped through
// [GRID_RETAIN_BAD..GRID_RETAIN_GOOD]→[0..1]. If the page has no narrow-multi-up grid at the
// widest width (nothing to reflow), the dim ABSTAINS (returns {applicable:false}) and is dropped
// from the score rather than penalizing a page that legitimately has no multi-up grids.
function gradeGridReflow(byWidth, widths) {
  const sorted = [...widths].sort((a, b) => b - a); // descending; sorted[0] = widest (authoring)
  const wide = byWidth[sorted[0]];
  const wideNarrow = wide ? wide.gridNarrow3up : 0;
  const perWidth = sorted.map((w) => ({
    w,
    narrow3up: byWidth[w] ? byWidth[w].gridNarrow3up : 0,
    medCardFrac: byWidth[w] ? byWidth[w].gridMedCardFrac : 0,
    maxCols: byWidth[w] ? byWidth[w].gridMaxCols : 0,
  }));
  if (wideNarrow < 1) {
    return { applicable: false, perWidth, score: null, note: 'no narrow-multi-up grid at widest width — nothing to reflow; dim abstains' };
  }
  // For each narrower width, retain ratio (lower=better) and frac-growth (higher=better). We
  // score the reflow PER STEP and AVERAGE, NOT just take the best (narrowest) step. WHY: at the
  // narrowest width (390) essentially EVERY page fully stacks (narrow3up→0, retain→0), so a
  // best-of-steps would hand full credit to a page that stayed dense at 768 and only collapsed at
  // 390 — exactly the RED (un-reflowed) failure mode. Averaging makes the 768 keystone step (where
  // the native-grid fix actually shows) count toward the dim, so the dim itself discriminates.
  let anyNarrower = false, sumStep = 0, nStep = 0, bestRetain = 1;
  const reflow = [];
  for (let i = 1; i < sorted.length; i++) {
    const w = sorted[i];
    if (!byWidth[w]) continue;
    anyNarrower = true;
    const retain = +(byWidth[w].gridNarrow3up / wideNarrow).toFixed(3);
    const fracGrow = +((byWidth[w].gridMedCardFrac || 0) - (wide.gridMedCardFrac || 0)).toFixed(3);
    const stepScore = +Math.max(0, Math.min(1, (GRID_RETAIN_BAD - retain) / (GRID_RETAIN_BAD - GRID_RETAIN_GOOD))).toFixed(3);
    reflow.push({ w, retain, fracGrow, stepScore });
    sumStep += stepScore; nStep++;
    if (retain < bestRetain) bestRetain = retain;
  }
  if (!anyNarrower) return { applicable: false, perWidth, score: null, note: 'only one width probed' };
  const score = +(sumStep / nStep).toFixed(3); // mean per-step reflow credit
  return { applicable: true, wideNarrow, bestRetain, perWidth, reflow, score };
}

// Page-level typography gate: max-heading must shrink monotonic-ish as width shrinks.
function gradeTypography(byWidth, widths) {
  // widths come in [1440,768,390] order (descending). Compare consecutive.
  const sorted = [...widths].sort((a, b) => b - a);
  const px = sorted.map((w) => byWidth[w] ? byWidth[w].maxHeadingPx : 0);
  const fails = [];
  let mono = true;
  for (let i = 0; i < px.length - 1; i++) {
    // wider must be >= narrower (allow small slack); strictly we want a real decrease somewhere
    if (px[i] + TYPO_MONO_SLACK < px[i + 1]) { mono = false; fails.push(`typo-inverted:${sorted[i]}=${px[i]}<${sorted[i + 1]}=${px[i + 1]}`); }
  }
  // STUCK detector: hero unchanged across the full sweep ⇒ the exact pre-fix bug
  const span = Math.abs((px[0] || 0) - (px[px.length - 1] || 0));
  const stuck = span <= TYPO_STUCK_TOL && px[0] > 0;
  if (stuck) { fails.push(`typo-stuck:${px.join('→')}px(span ${span.toFixed(1)})`); }
  const typoOK = mono && !stuck;
  return { px: sorted.map((w, i) => ({ w, px: px[i] })), span: +span.toFixed(1), mono, stuck, typoOK, fails, score: typoOK ? 1 : 0 };
}

async function main() {
  const url = arg('url', 'http://localhost:8001/?page_id=83');
  const capPath = arg('cap', '/tmp/local-fidelity/cap/manifest.json');
  const widths = (arg('widths') || WIDTHS_DEFAULT.join(',')).split(',').map(Number);
  const out = arg('out', null);
  const label = arg('label', 'rail');
  const jsonOnly = has('json');

  let cap = null;
  try { cap = JSON.parse(fs.readFileSync(capPath, 'utf8')); }
  catch (e) { if (!jsonOnly) console.error(`[rail] cap manifest unreadable (${capPath}): ${e.message} — height dim will be skipped`); }

  const browser = await chromium.launch();
  const byWidth = {};
  try {
    for (const w of widths) {
      const probe = await probeWidth(browser, url, w);
      const capH = cap && cap.perWidth && cap.perWidth[w] ? cap.perWidth[w].pageH : null;
      byWidth[w] = { ...gradePerWidth(probe, capH), capH, _raw: probe };
    }
  } finally {
    await browser.close();
  }

  const typo = gradeTypography(byWidth, widths);
  const grid = gradeGridReflow(byWidth, widths);

  // Fold typo into each width's fail list for a complete per-width breakdown view.
  for (const w of widths) {
    if (byWidth[w]) {
      delete byWidth[w]._raw; // strip heavy raw probe from the output
      if (!typo.typoOK) byWidth[w].fails = [...byWidth[w].fails];
    }
  }

  const meanPerWidth = widths.reduce((s, w) => s + (byWidth[w] ? byWidth[w].perWidthScore : 0), 0) / widths.length;
  // Grid abstains (applicable:false) on pages with no narrow-multi-up grid to reflow — when it
  // does, its weight reverts to the per-width portion so we never penalize an absent grid.
  const gridApplies = grid.applicable && grid.score != null;
  const gridW = gridApplies ? GRID_W : 0;
  const perWidthW = 1 - TYPO_PAGE_W - gridW;
  const score = +(perWidthW * meanPerWidth + TYPO_PAGE_W * typo.score + gridW * (gridApplies ? grid.score : 0)).toFixed(3);

  const anyHardOverflow = widths.some((w) => byWidth[w] && !byWidth[w].overflowOK);
  const pass = score >= PASS_THRESHOLD && !anyHardOverflow && typo.typoOK;

  const result = {
    label, url, widths,
    byWidth,
    typography: typo,
    gridReflow: grid,
    weights: { OVERFLOW_W, HEIGHT_W, TYPO_PAGE_W, GRID_W: gridW, perWidthW: +perWidthW.toFixed(3), PASS_THRESHOLD },
    thresholds: { OVERFLOW_SLACK, HRATIO_LO, HRATIO_HI, TYPO_STUCK_TOL, TYPO_MONO_SLACK, GRID_RETAIN_GOOD, GRID_RETAIN_BAD, GRID_NARROW_FRAC },
    score,
    pass,
    notes: [
      gridApplies
        ? `grid-reflow IS score-weighted (${GRID_W}): equal-width card-row profiler measures narrow-multi-up shedding + card-frac growth from the widest width. bestRetain=${grid.bestRetain} → gridScore=${grid.score}.`
        : 'grid-reflow ABSTAINS (no narrow-multi-up grid to reflow at the widest width) — weight reverts to the per-width dims.',
      `dims weighted into score: per-width overflow(${OVERFLOW_W})+height(${HEIGHT_W}) at weight ${(+perWidthW.toFixed(3))}, typography(page gate, ${TYPO_PAGE_W}), grid-reflow(page gate, ${gridW}).`,
    ],
  };

  if (out) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `responsive-rail-${label}.json`), JSON.stringify(result, null, 2));
  }
  if (jsonOnly) { console.log(JSON.stringify(result)); return; }

  // Human-readable breakdown
  console.log(`\n=== RESPONSIVE RAIL [${label}] ${url} ===`);
  for (const w of widths) {
    const b = byWidth[w];
    if (!b) continue;
    console.log(`  ${w}px  gutter=${b.gutter}  hRatio=${b.hRatio}(cap ${b.capH})  maxHeading=${b.maxHeadingPx}px  gridMaxCols=${b.gridMaxCols} narrow3up=${b.gridNarrow3up} medCardFrac=${b.gridMedCardFrac}  pastVp=${b.pastVp}  fails=[${b.fails.join(', ')}]  w-score=${b.perWidthScore}`);
  }
  console.log(`  TYPO  ${typo.px.map((p) => `${p.w}:${p.px}px`).join(' → ')}  span=${typo.span}  mono=${typo.mono}  stuck=${typo.stuck}  typoOK=${typo.typoOK}`);
  if (grid.applicable) {
    console.log(`  GRID  wideNarrow3up=${grid.wideNarrow}  ${grid.reflow.map((r) => `${r.w}:retain=${r.retain}/fracGrow=${r.fracGrow}`).join('  ')}  bestRetain=${grid.bestRetain}  gridScore=${grid.score}`);
  } else {
    console.log(`  GRID  ABSTAINS (${grid.note})`);
  }
  console.log(`  SCORE=${score}  PASS=${pass}`);
  console.log(JSON.stringify(result));
}

main().catch((e) => { console.error('grade-responsive-rail FAILED:', e.message); process.exit(1); });
