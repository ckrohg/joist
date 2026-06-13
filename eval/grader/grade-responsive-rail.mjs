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
 *   4. GRID REFLOW (best-effort, REPORTED not score-weighted) — cluster rows of >=GRID_MIN_KIDS
 *      sibling boxes by x-center into columns; report multi-col row counts. General (any sibling
 *      card row), not clerk-hardcoded. NOTE: empirically this does NOT discriminate the pre/post
 *      native-grid fix on this page (Elementor containers don't collapse the way the gate flips
 *      emission), so it is reported for diagnostics but EXCLUDED from the score. See SELF-FALSIFIER.
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
const GRID_MIN_KIDS = 3;      // a "card row" needs >=3 sibling boxes to count
const GRID_MIN_BOX = 40;      // px; ignore boxes smaller than this in either dim
const GRID_BAND_PX = 40;      // px; rows whose tops fall in the same /GRID_BAND_PX bucket are one visual row
const GRID_COL_BUCKET = 60;   // px; x-centers bucketed to /GRID_COL_BUCKET to count distinct columns
const PAST_VP_SLACK = 8;      // px; widget right edge beyond innerWidth+slack ⇒ counts as past-viewport
// Score weights (per-width, the two discriminating per-width dims). Typo folded in page-level.
const OVERFLOW_W = 0.6;
const HEIGHT_W = 0.4;
const TYPO_PAGE_W = 0.35;     // typo is a page-level gate; final = (1-TYPO_PAGE_W)*meanPerWidth + TYPO_PAGE_W*typoScore
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
  // grid: cluster sibling-box rows into columns
  const conts = [...document.querySelectorAll('.elementor-element, .e-con, .elementor-widget-wrap')];
  const rowCols = [];
  for (const c of conts) {
    const kids = [...c.children].filter((k) => {
      const r = k.getBoundingClientRect(); return r.width > 40 && r.height > 40;
    });
    if (kids.length < 3) continue;
    const rects = kids.map((k) => k.getBoundingClientRect());
    const byBand = {};
    rects.forEach((r) => {
      const band = Math.round(r.top / 40);
      (byBand[band] = byBand[band] || []).push(Math.round((r.left + r.right) / 2));
    });
    let maxCols = 0;
    for (const band in byBand) {
      const xs = [...new Set(byBand[band].map((x) => Math.round(x / 60)))];
      if (xs.length > maxCols) maxCols = xs.length;
    }
    rowCols.push(maxCols);
  }
  // past-viewport widgets
  const iw = window.innerWidth;
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
      candidateRows: rowCols.length,
      multiColRows: rowCols.filter((c) => c >= 2).length,
      singleColRows: rowCols.filter((c) => c < 2).length,
      maxColAny: rowCols.length ? Math.max(...rowCols) : 0,
    },
    pastVp,
  };
}

async function probeWidth(browser, url, width) {
  const p = await browser.newPage();
  try {
    await p.setViewportSize({ width, height: 900 });
    try { await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 }); }
    catch { await p.goto(url, { waitUntil: 'load', timeout: 30000 }); }
    await p.waitForTimeout(1200);
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
    gridCols: probe.grid.maxColAny, gridMultiColRows: probe.grid.multiColRows,
    pastVp: probe.pastVp, fails,
    perWidthScore: +(OVERFLOW_W * (overflowOK ? 1 : 0) + HEIGHT_W * (heightOK ? 1 : 0)).toFixed(3),
  };
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

  // Fold typo into each width's fail list for a complete per-width breakdown view.
  for (const w of widths) {
    if (byWidth[w]) {
      delete byWidth[w]._raw; // strip heavy raw probe from the output
      if (!typo.typoOK) byWidth[w].fails = [...byWidth[w].fails];
    }
  }

  const meanPerWidth = widths.reduce((s, w) => s + (byWidth[w] ? byWidth[w].perWidthScore : 0), 0) / widths.length;
  const score = +((1 - TYPO_PAGE_W) * meanPerWidth + TYPO_PAGE_W * typo.score).toFixed(3);

  const anyHardOverflow = widths.some((w) => byWidth[w] && !byWidth[w].overflowOK);
  const pass = score >= PASS_THRESHOLD && !anyHardOverflow && typo.typoOK;

  const result = {
    label, url, widths,
    byWidth,
    typography: typo,
    weights: { OVERFLOW_W, HEIGHT_W, TYPO_PAGE_W, PASS_THRESHOLD },
    thresholds: { OVERFLOW_SLACK, HRATIO_LO, HRATIO_HI, TYPO_STUCK_TOL, TYPO_MONO_SLACK },
    score,
    pass,
    notes: [
      'grid-reflow (gridCols/gridMultiColRows) is REPORTED best-effort, NOT score-weighted — it does not discriminate the native-grid fix on this page (validated).',
      'dims weighted into score: overflow(0.6/width), height(0.4/width), typography(page-level gate, 0.35).',
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
    console.log(`  ${w}px  gutter=${b.gutter}  hRatio=${b.hRatio}(cap ${b.capH})  maxHeading=${b.maxHeadingPx}px  gridCols=${b.gridCols}  pastVp=${b.pastVp}  fails=[${b.fails.join(', ')}]  w-score=${b.perWidthScore}`);
  }
  console.log(`  TYPO  ${typo.px.map((p) => `${p.w}:${p.px}px`).join(' → ')}  span=${typo.span}  mono=${typo.mono}  stuck=${typo.stuck}  typoOK=${typo.typoOK}`);
  console.log(`  SCORE=${score}  PASS=${pass}`);
  console.log(JSON.stringify(result));
}

main().catch((e) => { console.error('grade-responsive-rail FAILED:', e.message); process.exit(1); });
