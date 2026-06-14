#!/usr/bin/env node
/**
 * @purpose DETERMINISTIC author-COMPLETENESS RAIL for the Joist cloner — a clone-vs-source,
 * cap-anchored, NO-MODEL check that catches quiet ABRIDGEMENT: when the author silently omits
 * SOURCE content bands (sections / cards / showcase media) the original had. The n=3 breadth gap:
 * tailwind's dense bento (css-grid / 3d-transforms / wide-gamut / transitions / gradient / container
 * cards) rebuilt as a thin subset, dropping whole cards that the source plainly shows.
 *
 * ════════════════ WHY THIS IS A *REBUILD* (commit cd13a2e FAILED its own falsifier) ════════════════
 *   The prior version combined THREE signals: (1) ASSET coverage by basename STEM (weight 0.45),
 *   (2) BAND coverage by ordered vertical-cover/heightRatio, (3) TEXT coverage by heading-substring.
 *   Falsifier result: INVERTED discrimination — abridged tailwind 0.638 > faithful clerk 0.600 >
 *   faithful linear 0.525. ROOT CAUSE (verified): the asset stem signal is ANTI-CORRELATED with
 *   fidelity. Faithful clones legitimately RE-HOST / RE-CUT / RENAME assets:
 *     • clerk re-cuts the source's component-showcase mockups into ONE region-raster composite
 *       (comp-collage.png) → none of the source's per-mockup basenames survive → reads "omitted"
 *       (clerk asset coverage 0.167). The text baked INTO those mockups ("Profile details",
 *       "Create organization", "Welcome! Please fill in the details") also isn't in the clone DOM.
 *     • linear's source image URLs are Cloudflare-UUID / data-URI / inline-hash → stems are junk →
 *       reads 0.0 asset coverage even though every image IS visually present, re-hosted on WP.
 *   So the MORE faithful the clone, the WORSE the stem signal scored it. The band signal only caught
 *   WHOLESALE bottom-truncation (covOK once heightRatio≥0.85) and was blind to MIDDLE abridgement.
 *
 * ════════════════════════════ THE REBUILD: CONTENT-BASED PER-BAND ════════════════════════════════
 *   DROP the filename-stem asset signal entirely (disabled, kept only behind a debug flag). NEW
 *   primary method = position-independent, re-hosting-robust PER-BAND CONTENT CORRESPONDENCE. For each
 *   SOURCE content band (manifest.perWidth[W].sections, real bands h≥BAND_MIN_H & w≥BAND_MIN_W_FRAC of
 *   the page, root <body> band excluded), decide COVERED vs OMITTED by whether the clone reproduces
 *   that band's CONTENT *anywhere* (NOT at the same y — clone/source heights diverge):
 *
 *   (A) TEXT-WITH-RASTER-EXCLUSION  [primary]
 *       The band's salient DOM text comes from the cap's outline.txt (live-captured, already grouped
 *       by section with correct page-y ranges — robust where a file:// DOM reload is unstyled). From
 *       that we SUBTRACT every text string the capture classified as living inside a media / ui-mock /
 *       raster crop (crops-manifest.json). Because outline.txt has no per-line locators, raster text is
 *       identified by walking source.html's DOM (locators only — structure is style-independent) and
 *       collecting the text under any raster crop's locator subtree (prefix containment). THIS is the
 *       clerk false-positive fix: "Profile details" / "Create organization" / the sign-in mockups are
 *       baked into showcase rasters the clone faithfully reproduces as comp-collage.png, so that text
 *       is EXCLUDED from the band's text requirement and never flagged. A band is text-COVERED if a
 *       meaningful share of its remaining (non-raster) salient text appears in the clone's DOM blob.
 *
 *   (B) VISUAL FALLBACK  [for image-only / low-non-raster-text bands]
 *       A band with little/no non-raster text (a pure media/illustration/mockup band — clerk's re-cut
 *       composites, linear's Cloudflare hero/figures) is visual-COVERED if a SIMILAR REGION exists
 *       anywhere in the clone: dHash (9×8 luma difference-hash) + pooled-luma Pearson-r² of the source
 *       band crop (cropped from cap/shots/wW.png by page-y) searched over a SLIDING WINDOW down the
 *       clone's rendered full-page shot (heights diverge, so we scan, not align). Loose threshold =
 *       "something like this content exists in the clone". This credits clerk's re-cut composites +
 *       linear's re-hosted images (they ARE visually present) while NOT crediting tailwind's
 *       genuinely-absent bento cards (no region in the short clone resembles them).
 *
 *   A band is OMITTED only if it is NEITHER text-covered NOR visual-covered.
 *       completenessScore = covered_bands / total_bands.
 *   omissions = the OMITTED bands, each { kind:'band', what:<label / salient text>, where:{y,h,section,
 *   crop}, evidence }. (Text-band and image-band omissions are the SAME kind — a missing band — with
 *   evidence noting which test(s) it failed.)
 *
 * ════════════════════════════════════ WHY DETERMINISTIC ═════════════════════════════════════════
 *   Every signal is a manifest read, a DOM/HTML text enumeration, a locator-prefix set op, or a
 *   pixel-pool hash/correlation. Same inputs → same outputs. No model call. (The honest caveat: the
 *   visual fallback's screenshot of a LIVE clone URL carries the usual ±visual run-to-run noise; the
 *   text + raster-exclusion + band-set are fully deterministic. Prefer --clone-shot for a frozen run.)
 *
 * INPUTS:
 *   --cap   <dir|manifest.json>   frozen SOURCE capture dir. REQUIRED. Needs manifest.json + shots/ +
 *                                 sections/ + outline.txt + source.html + crops-manifest.json.
 *   --url   <localhost clone URL>  rendered clone — gives live DOM text AND (unless --clone-shot) the
 *                                 full-page shot for the visual fallback. LOCAL only.
 *   --html  <authored .html>      authored clone HTML (text only; no visual fallback without a shot).
 *   --clone-shot <png>            pre-rendered clone full-page PNG (frozen visual fallback; pairs with
 *                                 --html for a fully-offline, deterministic run).
 *   (at least one of --url / --html required, unless --selftest.)
 *
 * SELF-TEST: --selftest runs an offline synthetic fixture (no browser, no network): a source with
 *   text-bands + image-bands and a clone that reproduces all but the deepest text-band (abridged) and
 *   all but one image-band → asserts EXACTLY those bands flagged, that a raster-baked text string is
 *   NEVER flagged, and that source-vs-itself scores 1.0. Plus pure-function asserts on dHash/text-cover.
 *
 * RAILS: LOCAL only. READ-ONLY — reads the cap dir + a clone URL/HTML/shot; never writes pages, never
 *   mutates baselines (83/185/232). Reversible env flags:
 *     COMPLETENESS_NO_VISUAL=1     disable the visual fallback (text-only; image-bands then need text)
 *     COMPLETENESS_NO_RASTER_EXCL=1 disable raster text-exclusion (reverts the clerk false-positive)
 *     COMPLETENESS_NO_TEXT=1       disable text coverage (visual-only)
 *     COMPLETENESS_ASSET_DEBUG=1   re-enable the (retired) stem-asset signal as a REPORT-ONLY column
 *
 * Usage:
 *   node grade-completeness-rail.mjs --cap /tmp/genz/tw2/cap   --url http://localhost:8001/?page_id=232
 *   node grade-completeness-rail.mjs --cap /tmp/genz2/clerk/cap --url http://localhost:8001/?page_id=83
 *   node grade-completeness-rail.mjs --cap <dir> --html clone.html --clone-shot clone-w1440.png   # offline
 *   node grade-completeness-rail.mjs --selftest
 *   node grade-completeness-rail.mjs --cap <dir> --url <u> --json
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);

// ─── Named thresholds (deterministic, tunable in one place) ──────────────────────────────────────
const BAND_MIN_H = 120;        // px; ignore source bands shorter than this (spacers/rules, not sections).
const BAND_MIN_W_FRAC = 0.50;  // a content band must span ≥ this fraction of page width to be a section.
const BAND_NEST_OVERLAP = 0.92;// nesting threshold for selectContentBands: a CONTAINER whose children tile
                               //   ≥ this fraction of its height is a pure wrapper (dropped in favor of its
                               //   finer children); and a band ≥ this contained in a near-equal-height kept
                               //   band is a duplicate wrapper/column-mirror (the finer one is kept).
const TEXT_SALIENT_MIN = 4;    // ignore text tokens shorter than this when scoring a band's text presence.
const TEXT_BAND_MIN_CHARS = 24;// a band with < this many non-raster salient chars is treated as an IMAGE band
                               //   (its coverage is decided by the visual fallback, not text).
const TEXT_COVER_FRAC = 0.5;   // a text-band is text-COVERED if ≥ this fraction of its salient text units
                               //   (sentences/phrases) are found in the clone DOM blob.
const TEXT_UNIT_MATCH = 0.6;   // one salient text unit counts "present" if ≥ this frac of its ≥4-char words
                               //   appear in the clone blob (handles minor truncation / re-wrapping).
const VIS_HASHSIM_MIN = 0.72;  // dHash similarity (1 − hamming/64) for a STRONG structural match alone.
const VIS_CORR_MIN = 0.10;     // pooled-luma Pearson-r² floor (low: full-width bands are whitespace-heavy and
                               //   decorrelate; hashSim is the structure anchor, corr only rejects pure-mismatch).
const VIS_HASHSIM_ALT = 0.62;  // OR a MODERATE structural match (≥this) BACKED by strong correlation…
const VIS_CORR_ALT = 0.45;     //   …(corr ≥this) at the right place — credits reflowed-but-present regions
                               //   (clerk hashSim 0.67/corr 0.65) WITHOUT crediting absent bento (corr ~0.12).
const VIS_SCAN_STEP_FRAC = 1 / 6; // sliding-window step as a fraction of the (scaled) band height.
const VIS_MIN_BAND_H = 80;     // visual fallback needs a band at least this tall to hash meaningfully.
const RASTER_UIMOCK_TF_MAX = 0.05; // a ui-mock crop is a TEXT-BAKED raster only if its textFrac < this
                               //   (truly text-free baked mockup; section CONTAINERS that wrap mockups
                               //   around real headings read tf≈0.13–0.39 and are NOT excluded — fix #2).
const RASTER_UIMOCK_MF_MIN = 0.6; // …AND it must carry media (mediaFrac ≥ this) to count as imagery.
const PASS_THRESHOLD = 0.85;   // completenessScore ≥ this AND no critical-mass omission ⇒ pass.
const CRIT_OMIT_FRAC = 0.30;   // if > this fraction of real bands are omitted ⇒ not-pass regardless of mean
                               //   (catches a wholesale abridgement even if a few bands clear).

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (i > -1 && d === true ? true : d); };
const has = (n) => process.argv.includes('--' + n);
const ENV = {
  NO_VISUAL: !!process.env.COMPLETENESS_NO_VISUAL,
  NO_RASTER_EXCL: !!process.env.COMPLETENESS_NO_RASTER_EXCL,
  NO_TEXT: !!process.env.COMPLETENESS_NO_TEXT,
  ASSET_DEBUG: !!process.env.COMPLETENESS_ASSET_DEBUG,
};

// normalize for text matching. Splits digit↔letter boundaries first: captured outline labels often glue
// a list number to its word ("3.1Issues" → "3 1 issues"), which would otherwise hide "issues" from the
// clone blob and false-flag a present band (linear's feature-tab strip). General + safe (clone blob is
// normalized the same way, so a real "3.1 Issues" still matches).
const norm = (s) => (s || '').toLowerCase()
  .replace(/([0-9])([a-z])/gi, '$1 $2').replace(/([a-z])([0-9])/gi, '$1 $2')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ─── cap loader ──────────────────────────────────────────────────────────────────────────────────
function loadCap(capArg) {
  let dir, manifestPath;
  const st = fs.existsSync(capArg) ? fs.statSync(capArg) : null;
  if (st && st.isDirectory()) { dir = capArg; manifestPath = path.join(capArg, 'manifest.json'); }
  else { manifestPath = capArg; dir = path.dirname(capArg); }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return { dir, manifest };
}
function widestWidth(manifest) {
  const ws = Object.keys(manifest.perWidth || {}).map(Number).filter((n) => n > 0);
  return ws.length ? Math.max(...ws) : 1440;
}

// ─── SOURCE content bands (real sections at widest width) ────────────────────────────────────────
function sourceBands(manifest) {
  const W = widestWidth(manifest);
  const pw = (manifest.perWidth || {})[W] || (manifest.perWidth || {})[String(W)] || {};
  const pageH = pw.pageH || 0;
  const secs = pw.sections || [];
  let bands = [];
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i];
    const h = s.h || 0, w = s.w || 0, y = s.y || 0;
    if (h < BAND_MIN_H) continue;
    if (W && w < W * BAND_MIN_W_FRAC) continue;
    // drop the page-spanning root/wrapper band: any band ≥90% of page height is the whole body, not a
    // section (catches both y≈0 roots AND deep wrappers like linear's main-column at y=72 h≈95% of page).
    if (pageH && h >= pageH * 0.90) continue;
    bands.push({ index: i, y, h, w, bottom: y + h, crop: s.crop || '', locator: s.locator || '' });
  }
  bands.sort((a, b) => (a.y - b.y) || (b.h - a.h));
  return { W, pageH, bands };
}
// SELECT CONTENT BANDS — prefer the FINEST (leaf) content bands, drop redundant CONTAINERS. The raw
// section list is deeply nested: a big wrapper (e.g. tailwind's bento §5 y=3063 h=4208) CONTAINS the
// distinct card sub-bands (§8 y=3559 the actual cards). If we kept the wrapper and dropped the children
// (the prior bug), the wrapper reads "covered" off its section heading while the dropped CARDS go unseen
// — the abridgement HIDES. So we do the OPPOSITE: a container band is dropped IN FAVOR OF its children
// when those children TILE most of it (it adds no unique content beyond them); we keep the leaf bands.
// A container is RETAINED only if its children leave a large uncovered vertical gap (it has direct
// content of its own). Produces a near-non-overlapping set of the finest real content bands.
function selectContentBands(bands) {
  // child(b) = bands strictly smaller AND ≥BAND_NEST_OVERLAP contained within b's y-range.
  const childrenOf = (b) => bands.filter((o) => o !== b && o.h < b.h * 0.97
    && o.y >= b.y - 4 && o.bottom <= b.bottom + 4);
  const keep = [];
  for (const b of bands) {
    const kids = childrenOf(b);
    if (!kids.length) { keep.push(b); continue; }                  // leaf → always keep
    // how much of b's height is tiled by its (merged) children?
    const ivals = kids.map((k) => [Math.max(b.y, k.y), Math.min(b.bottom, k.bottom)]).sort((a, c) => a[0] - c[0]);
    let tiled = 0, curS = -1, curE = -1;
    for (const [s, e] of ivals) { if (s > curE) { if (curE > curS) tiled += curE - curS; curS = s; curE = e; } else curE = Math.max(curE, e); }
    if (curE > curS) tiled += curE - curS;
    const tiledFrac = tiled / Math.max(1, b.h);
    // container fully tiled by children → it's a pure wrapper, drop it (children carry the content).
    if (tiledFrac >= BAND_NEST_OVERLAP) continue;
    keep.push(b);                                                  // container with its own un-tiled content → keep
  }
  // Now drop bands that are ≥BAND_NEST_OVERLAP contained inside another KEPT band of similar-or-larger
  // height (true duplicate wrappers / column mirrors) — keep the SMALLER (finer) one.
  keep.sort((a, b) => (a.y - b.y) || (a.h - b.h));
  const out = [];
  for (const b of keep) {
    const dup = out.find((k) => {
      const inter = Math.max(0, Math.min(b.bottom, k.bottom) - Math.max(b.y, k.y));
      const small = Math.min(b.h, k.h), big = Math.max(b.h, k.h);
      return inter / Math.max(1, small) >= BAND_NEST_OVERLAP && big <= small * 1.25;  // near-identical span
    });
    if (!dup) out.push(b);
  }
  out.sort((a, b) => a.y - b.y);
  return out;
}

// ─── OUTLINE text, grouped by section (page-y correct, live-captured) ────────────────────────────
// Returns Map<sectionIndex, {yTop,yBot,texts:[...]}>. Falls back to y-range if section index mismatches.
function outlineBySection(capDir) {
  const p = path.join(capDir, 'outline.txt');
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const map = new Map();
  let cur = null;
  const secRx = /^##\s*SECTION\s+(\d+)\s*\[y\s*(\d+)\s*[–-]\s*(\d+)\]/;
  const txtRx = /^\s*(?:\[[A-Z]+\]|·|H[1-6]:|\bH[1-6]\b:?)?\s*(.+?)\s*$/;
  for (const ln of lines) {
    const sm = ln.match(secRx);
    if (sm) { cur = { index: +sm[1], yTop: +sm[2], yBot: +sm[3], texts: [] }; map.set(cur.index, cur); continue; }
    if (!cur) continue;
    if (/^#/.test(ln)) continue;
    // strip leading markers ([CTA] / · / H2: / "  H2: text") and any "H2: " prefix
    let t = ln.replace(/^\s*(\[[A-Z]+\]|·)\s*/, '').replace(/^\s*H[1-6]\s*:?\s*/i, '').trim();
    if (!t) continue;
    cur.texts.push(t);
  }
  return map;
}

// ─── RASTER-BAKED text set: text living inside any media/ui-mock/illustration crop subtree ────────
// crops-manifest.json gives raster crop LOCATORS. We can't trust their per-width boxes (some are local,
// some page-absolute), and outline.txt has no per-line locators — so we identify raster text by DOM
// STRUCTURE: load source.html in chromium (locators only; layout is unstyled & unreliable but the DOM
// tree is faithful) and collect text under any element whose nth-of-type locator is contained in a
// raster crop's locator (exact or prefix). This is the clerk false-positive fix.
function rasterCropLocators(capDir) {
  const p = path.join(capDir, 'crops-manifest.json');
  if (!fs.existsSync(p)) return [];
  let cm; try { cm = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
  const crops = cm.crops || cm.items || (Array.isArray(cm) ? cm : []);
  const out = [];
  for (const x of crops) {
    const cls = x.classification || '';
    const tf = x.signals ? x.signals.textFrac : undefined;
    const mf = x.signals ? x.signals.mediaFrac : undefined;
    // raster = real imagery (media / illustration) OR a component MOCKUP rendered as a composite raster
    // whose text is BAKED IN. CRITICAL CALIBRATION (clerk false-positive fix #2): a SECTION CONTAINER
    // can be classified ui-mock with a NON-zero textFrac (clerk's div#b2b-saas reads tf=0.17) because it
    // WRAPS mockups AROUND real headings ("Custom roles and permissions") that the clone reproduces as
    // LIVE TEXT. Excluding the whole container would wrongly drop those headings. The genuinely-baked
    // mockups read textFrac≈0 (exactly) with high mediaFrac. So a ui-mock qualifies as a TEXT-baked
    // raster only when textFrac < RASTER_UIMOCK_TF_MAX (truly text-free) AND it carries media
    // (mediaFrac ≥ RASTER_UIMOCK_MF_MIN). Real media/illustration/ui-panel always qualify.
    const isRaster = ['media', 'illustration', 'ui-panel'].includes(cls)
      || (cls === 'ui-mock' && (tf === undefined || tf < RASTER_UIMOCK_TF_MAX) && (mf === undefined || mf >= RASTER_UIMOCK_MF_MIN));
    if (isRaster && x.locator) out.push(x.locator);
  }
  return [...new Set(out)];
}
async function rasterBakedTextSet(capDir, rasterLocs) {
  const htmlPath = path.join(capDir, 'source.html');
  if (!rasterLocs.length || !fs.existsSync(htmlPath)) return new Set();
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { return new Set(); }
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(600);
    const arr = await p.evaluate((rasterLocs) => {
      function locOf(el) {
        const parts = [];
        while (el && el.nodeType === 1 && el.tagName && el.tagName.toLowerCase() !== 'html' && el.tagName.toLowerCase() !== 'body') {
          const tag = el.tagName.toLowerCase();
          if (el.id) { parts.unshift(tag + '#' + el.id); break; }
          let n = 1, sib = el, tot = 0;
          while ((sib = sib.previousElementSibling)) { if (sib.tagName === el.tagName) n++; }
          let s = el.parentElement ? el.parentElement.firstElementChild : null;
          for (; s; s = s.nextElementSibling) if (s.tagName === el.tagName) tot++;
          parts.unshift(tot > 1 ? `${tag}:nth-of-type(${n})` : tag);
          el = el.parentElement;
        }
        return parts.join('>');
      }
      const inRaster = (loc) => rasterLocs.some((rl) => loc === rl || loc.startsWith(rl + '>'));
      const texts = new Set();
      // walk all elements; when an element's locator is inside a raster subtree, harvest its text and
      // skip its descendants (already covered). We approximate "skip descendants" by only harvesting at
      // the SHALLOWEST in-raster ancestor: an element is harvested iff it is in-raster AND its parent is not.
      for (const el of document.querySelectorAll('*')) {
        const loc = locOf(el);
        if (!inRaster(loc)) continue;
        const parentLoc = el.parentElement ? locOf(el.parentElement) : '';
        if (parentLoc && inRaster(parentLoc)) continue; // descendant — parent already harvested
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) texts.add(t);
      }
      return [...texts];
    }, rasterLocs);
    await browser.close();
    // normalize each harvested raster blob with the SAME norm() used to test source lines (so substring
    // containment is apples-to-apples, incl. the digit↔letter split).
    const set = new Set();
    for (const t of arr) { const n = norm(t); if (n) set.add(n); }
    return set;
  } catch { await browser.close().catch(() => {}); return new Set(); }
}

// Is a source text line raster-baked? True if its normalized text appears inside ANY harvested raster
// blob (the showcase text is a fragment of a larger mockup blob, so we test substring containment).
function isRasterText(line, rasterBlobSet) {
  if (!rasterBlobSet || !rasterBlobSet.size) return false;
  const n = norm(line);
  if (n.length < 3) return false;
  for (const blob of rasterBlobSet) { if (blob.includes(n)) return true; }
  return false;
}

// ─── PER-BAND salient text (outline section text ∩ band y-range, minus raster-baked) ─────────────
// Assign outline section text to a manifest band by SECTION INDEX (exact: outline & manifest share the
// section enumeration), else by y-range overlap. Then strip raster-baked lines.
function bandSalientText(band, outlineMap, rasterBlobSet) {
  let texts = [];
  if (outlineMap) {
    const byIdx = outlineMap.get(band.index);
    if (byIdx) texts = byIdx.texts.slice();
    else {
      // y-range MUTUAL-CONTAINMENT fallback (band index absent from outline). To avoid a CONTAINER band
      // vacuuming unrelated sections (which over-pulls nav junk and tanks its text frac → false omission),
      // require BOTH: the outline section is ≥70% inside the band AND it covers ≥40% of the band — i.e.
      // they describe substantially the same vertical region. A pure container with no co-extensive
      // outline section gets NO text and is decided by the visual fallback instead.
      for (const sec of outlineMap.values()) {
        const secH = Math.max(1, sec.yBot - sec.yTop);
        const inter = Math.max(0, Math.min(band.bottom, sec.yBot) - Math.max(band.y, sec.yTop));
        if (inter >= 0.70 * secH && inter >= 0.40 * band.h) texts.push(...sec.texts);
      }
    }
  }
  // de-dup + strip raster-baked + keep salient (≥TEXT_SALIENT_MIN chars, not pure punctuation)
  const seen = new Set(), units = [];
  for (let t of texts) {
    t = t.trim();
    if (t.length < TEXT_SALIENT_MIN) continue;
    const n = norm(t);
    if (!n || seen.has(n)) continue;
    if (!ENV.NO_RASTER_EXCL && isRasterText(t, rasterBlobSet)) continue;  // <-- raster exclusion
    seen.add(n); units.push(t);
  }
  const totalChars = units.reduce((s, u) => s + norm(u).length, 0);
  return { units, totalChars, isImageBand: totalChars < TEXT_BAND_MIN_CHARS };
}

// ─── TEXT coverage: does the clone DOM blob carry this band's salient text? ───────────────────────
function textCovered(units, cloneBlobNorm) {
  if (!units.length) return { covered: false, frac: 0, hits: 0, total: 0, missing: [] };
  const blob = ' ' + cloneBlobNorm + ' ';
  let hits = 0; const missing = [];
  for (const u of units) {
    const n = norm(u);
    if (!n) continue;
    let present = false;
    if (blob.includes(' ' + n + ' ') || blob.includes(n)) present = true;
    else {
      const words = n.split(' ').filter((w) => w.length >= 4);
      if (!words.length) present = blob.includes(n);
      else present = words.filter((w) => blob.includes(w)).length / words.length >= TEXT_UNIT_MATCH;
    }
    if (present) hits++; else missing.push(u);
  }
  const frac = hits / units.length;
  return { covered: frac >= TEXT_COVER_FRAC, frac: +frac.toFixed(3), hits, total: units.length, missing };
}

// ─── VISUAL fallback: dHash + pooled-luma r² of a source band crop searched down the clone shot ──
function poolGrid(img, box, gw, gh) {
  const x0 = Math.max(0, Math.round(box.x)), y0 = Math.max(0, Math.round(box.y));
  const x1 = Math.min(img.width, Math.round(box.x + box.w)), y1 = Math.min(img.height, Math.round(box.y + box.h));
  if (x1 <= x0 || y1 <= y0) return null;
  const cells = Array.from({ length: gw * gh }, () => [0, 0, 0, 0]);
  for (let y = y0; y < y1; y += 2) {
    const gy = Math.min(gh - 1, Math.floor(((y - y0) / (y1 - y0)) * gh));
    for (let x = x0; x < x1; x += 2) {
      const gx = Math.min(gw - 1, Math.floor(((x - x0) / (x1 - x0)) * gw));
      const i = (y * img.width + x) * 4; const c = cells[gy * gw + gx];
      c[0] += img.data[i]; c[1] += img.data[i + 1]; c[2] += img.data[i + 2]; c[3]++;
    }
  }
  return cells.map((c) => (c[3] ? [c[0] / c[3], c[1] / c[3], c[2] / c[3]] : [0, 0, 0]));
}
const _luma = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
function dhash(img, box) {
  const g = poolGrid(img, box, 9, 8); if (!g) return null;
  const l = g.map(_luma); const bits = new Uint8Array(64);
  for (let r = 0, k = 0; r < 8; r++) for (let c = 0; c < 8; c++, k++) bits[k] = l[r * 9 + c] < l[r * 9 + c + 1] ? 1 : 0;
  return { bits, lumas: l };
}
function hamming(a, b) { let h = 0; for (let i = 0; i < 64; i++) if (a.bits[i] !== b.bits[i]) h++; return h; }
function corrR2(a, b) {
  let ma = 0, mb = 0; for (let i = 0; i < 72; i++) { ma += a.lumas[i]; mb += b.lumas[i]; } ma /= 72; mb /= 72;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < 72; i++) { const da = a.lumas[i] - ma, db = b.lumas[i] - mb; cov += da * db; va += da * da; vb += db * db; }
  if (va < 1 && vb < 1) return 1;             // both flat → trivially same (ΔE not in scope here)
  if (va < 1 || vb < 1) return 0;             // one flat, one textured → different
  return cov <= 0 ? 0 : Math.min(1, (cov * cov) / (va * vb));
}
// Search the clone shot for the best window matching the source band crop. Returns {hashSim,corr,score,y}.
function visualMatch(srcShot, srcBox, cloneShot) {
  if (srcBox.h < VIS_MIN_BAND_H) return null;
  const sh = dhash(srcShot, srcBox); if (!sh) return null;
  const ratio = cloneShot.height / Math.max(1, srcShot.height);
  const ch = Math.max(VIS_MIN_BAND_H, Math.round(srcBox.h * ratio));
  const step = Math.max(24, Math.round(ch * VIS_SCAN_STEP_FRAC));
  let best = { hashSim: 0, corr: 0, score: -1, y: -1 };
  for (let cy = 0; cy + ch <= cloneShot.height + step; cy += step) {
    const box = { x: 0, y: Math.min(cy, Math.max(0, cloneShot.height - ch)), w: cloneShot.width, h: ch };
    const cd = dhash(cloneShot, box); if (!cd) continue;
    const hs = 1 - hamming(sh, cd) / 64, cr = corrR2(sh, cd);
    const score = 0.6 * hs + 0.4 * cr;
    if (score > best.score) best = { hashSim: +hs.toFixed(3), corr: +cr.toFixed(3), score, y: box.y };
  }
  return best.y < 0 ? null : best;
}

// ─── CLONE acquisition ───────────────────────────────────────────────────────────────────────────
async function cloneFromUrl(url, wantShot) {
  const { chromium } = await import('playwright');
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA, deviceScaleFactor: 1, locale: 'en-US' });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); window.chrome = { runtime: {} }; });
    const p = await ctx.newPage();
    try { await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 }); }
    catch { try { await p.goto(url, { waitUntil: 'load', timeout: 30000 }); } catch {} }
    await p.emulateMedia({ reducedMotion: 'reduce' }).catch(() => {});
    await p.waitForTimeout(1200);
    await p.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let h = document.documentElement.scrollHeight;
      for (let y = 0; y <= h; y += Math.max(500, Math.round(innerHeight * 0.85))) { window.scrollTo(0, y); await sleep(120); const nh = document.documentElement.scrollHeight; if (nh > h) h = nh; }
      window.scrollTo(0, h); await sleep(200);
      const pend = () => [...document.images].filter((im) => !(im.complete && im.naturalWidth > 0));
      const dl = Date.now() + 5000; while (pend().length && Date.now() < dl) await sleep(150);
      window.scrollTo(0, 0); await sleep(120);
    }).catch(() => {});
    await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const data = await p.evaluate(() => {
      const heads = [...document.querySelectorAll('h1,h2,h3,h4,.elementor-heading-title')].map((h) => (h.textContent || '').trim()).filter((t) => t.length > 1);
      const textBlob = (document.body ? document.body.innerText : '') || '';
      const contentH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
      const imgs = new Set();
      for (const i of document.images) { const u = i.currentSrc || i.src; if (u) imgs.add(u); }
      for (const el of document.querySelectorAll('*')) { const bi = getComputedStyle(el).backgroundImage; if (bi && bi !== 'none') { const m = bi.match(/url\(["']?([^"')]+)/); if (m) imgs.add(m[1]); } }
      return { heads, textBlob, contentH, imgUrls: [...imgs] };
    });
    let shot = null;
    if (wantShot) { const { PNG } = await import('pngjs'); shot = PNG.sync.read(await p.screenshot({ fullPage: true })); }
    await browser.close();
    return { ...data, shot };
  } catch (e) { await browser.close().catch(() => {}); throw e; }
}
function cloneFromHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const imgs = new Set(); let m;
  const imgRx = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi; while ((m = imgRx.exec(html))) imgs.add(m[1]);
  const bgRx = /background(?:-image)?\s*:\s*url\(["']?([^"')]+)/gi; while ((m = bgRx.exec(html))) imgs.add(m[1]);
  const heads = []; const hRx = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((m = hRx.exec(html))) { const t = m[2].replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim(); if (t) heads.push(t); }
  const textBlob = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
  return { heads, textBlob, contentH: null, imgUrls: [...imgs], shot: null };
}

// ════════════════════════════════ CORE: grade per-band ═════════════════════════════════════════
function gradeBandsContent({ bands, srcShot, outlineMap, rasterBlobSet, clone }) {
  const cloneBlobNorm = norm(clone.textBlob || '') + ' ' + (clone.heads || []).map(norm).join(' ');
  const cloneShot = clone.shot || null;
  const rows = [];
  let covered = 0;
  for (const b of bands) {
    const st = bandSalientText(b, outlineMap, rasterBlobSet);
    let tc = { covered: false, frac: 0, hits: 0, total: st.units.length, missing: [] };
    if (!ENV.NO_TEXT && st.units.length) tc = textCovered(st.units, cloneBlobNorm);
    // visual fallback: always available as corroboration; REQUIRED to cover an image-band.
    let vm = null;
    if (!ENV.NO_VISUAL && cloneShot && srcShot) vm = visualMatch(srcShot, { x: 0, y: b.y, w: srcShot.width, h: b.h }, cloneShot);
    const visualCovered = !!(vm && (
      (vm.hashSim >= VIS_HASHSIM_MIN && vm.corr >= VIS_CORR_MIN)        // strong structure
      || (vm.hashSim >= VIS_HASHSIM_ALT && vm.corr >= VIS_CORR_ALT)));  // moderate structure + strong corr
    const isCovered = tc.covered || visualCovered;
    if (isCovered) covered++;
    const label = st.units.length ? st.units[0].slice(0, 70) : (b.crop ? path.basename(b.crop) : `section@y=${b.y}`);
    rows.push({
      index: b.index, y: b.y, h: b.h, crop: b.crop || null,
      kind: st.isImageBand ? 'image-band' : 'text-band',
      salientUnits: st.units.length, salientChars: st.totalChars,
      textCover: tc, visual: vm, textCovered: tc.covered, visualCovered, covered: isCovered, label,
    });
  }
  const omissions = rows.filter((r) => !r.covered).map((r) => {
    const missing = (r.textCover.missing || []).map((u) => u.replace(/\s+/g, ' ').trim()).filter(Boolean);
    // name the actual DROPPED content units (e.g. tailwind's "…wide gamut colors…", "…3D space…",
    // "…silky-smooth gradients…", "Tailwind uses CSS layers…") so the author loop knows what to add.
    const what = r.kind === 'image-band'
      ? (r.crop ? `image band ${path.basename(r.crop)} @y=${r.y}` : `image band @y=${r.y} h=${r.h}`)
      : (missing.length ? missing.slice(0, 8).map((m) => m.slice(0, 50)).join(' | ') : r.label);
    return {
      kind: 'band',
      what,
      where: { y: r.y, h: r.h, section: r.index, crop: r.crop },
      missingUnits: r.kind === 'image-band' ? [] : missing,
      evidence: r.kind === 'image-band'
        ? `image/mockup band @y=${r.y} h=${r.h} — no clone region resembles it (best visual ${r.visual ? `hashSim=${r.visual.hashSim} corr=${r.visual.corr}@y${r.visual.y}` : 'n/a'}; threshold ${VIS_HASHSIM_MIN}/${VIS_CORR_MIN} or ${VIS_HASHSIM_ALT}/${VIS_CORR_ALT})`
        : `text band @y=${r.y} h=${r.h} — only ${r.textCover.hits}/${r.textCover.total} salient text units in clone (frac ${r.textCover.frac}<${TEXT_COVER_FRAC})` + (r.visual ? ` and no visual match (hashSim=${r.visual.hashSim} corr=${r.visual.corr})` : ''),
    };
  });
  const total = bands.length;
  const completenessScore = total ? +(covered / total).toFixed(3) : 1.0;
  const omitFrac = total ? (total - covered) / total : 0;
  const critMass = omitFrac > CRIT_OMIT_FRAC ? `${total - covered}/${total} bands omitted (>${(CRIT_OMIT_FRAC * 100).toFixed(0)}%)` : null;
  const pass = completenessScore >= PASS_THRESHOLD && !critMass;
  return { completenessScore, total, covered, omitFrac: +omitFrac.toFixed(3), critMass, pass, rows, omissions };
}

// ════════════════════════════════ SELF-TEST (offline synthetic) ════════════════════════════════
function selftest() {
  console.log('=== grade-completeness-rail SELF-TEST (offline synthetic) ===');
  const fail = [];
  // ── pure-function checks: dHash identity + textCovered ──
  const { PNG } = require_pngjs();
  const mk = (w, h, fn) => { const p = new PNG({ width: w, height: h }); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const [r, g, b] = fn(x, y); p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255; } return p; };
  const grad = mk(120, 120, (x) => { const v = Math.round((x / 120) * 255); return [v, v, v]; });
  const da = dhash(grad, { x: 0, y: 0, w: 120, h: 120 }), db = dhash(grad, { x: 0, y: 0, w: 120, h: 120 });
  if (hamming(da, db) !== 0) fail.push(`dHash identity: expected hamming 0, got ${hamming(da, db)}`);
  const flip = mk(120, 120, (x) => { const v = Math.round((1 - x / 120) * 255); return [v, v, v]; });
  if (hamming(da, dhash(flip, { x: 0, y: 0, w: 120, h: 120 })) < 30) fail.push('dHash should differ strongly for reversed gradient');
  const tc1 = textCovered(['Built for the modern web', 'wide gamut colors'], norm('welcome — built for the modern web with wide gamut colors and more'));
  if (!tc1.covered) fail.push(`textCovered: expected covered, got ${JSON.stringify(tc1)}`);
  const tc2 = textCovered(['Scale rotate translate in 3D space', 'silky-smooth gradients with utilities'], norm('a totally different page about pricing and billing'));
  if (tc2.covered) fail.push(`textCovered: expected NOT covered for absent text, got ${JSON.stringify(tc2)}`);

  // ── band-level fixture: 4 text-bands + 2 image-bands. Clone reproduces all but the deepest text-band
  //    (abridged) and all but image-band #2. A RASTER-BAKED string ("create organization") must NOT flag. ──
  const W = 1440, pageH = 6000;
  const bands = [
    { index: 1, y: 100, h: 300, w: 1360, bottom: 400, crop: 's1' },   // text-band, kept
    { index: 2, y: 500, h: 800, w: 1360, bottom: 1300, crop: 's2' },  // IMAGE-band (showcase, raster text), kept visually
    { index: 3, y: 1400, h: 400, w: 1360, bottom: 1800, crop: 's3' }, // text-band, kept
    { index: 4, y: 2000, h: 900, w: 1360, bottom: 2900, crop: 's4' }, // IMAGE-band #2, DROPPED (no clone region)
    { index: 5, y: 3000, h: 500, w: 1360, bottom: 3500, crop: 's5' }, // text-band (bento cards), DROPPED
    { index: 6, y: 3600, h: 300, w: 1360, bottom: 3900, crop: 's6' }, // text-band, kept
  ];
  const outlineMap = new Map([
    [1, { index: 1, yTop: 100, yBot: 400, texts: ['More than authentication complete user management'] }],
    [2, { index: 2, yTop: 500, yBot: 1300, texts: ['Profile details', 'Create organization', 'Welcome please fill in the details'] }], // ALL raster-baked
    [3, { index: 3, yTop: 1400, yBot: 1800, texts: ['Built for the modern web latest CSS features'] }],
    [4, { index: 4, yTop: 2000, yBot: 2900, texts: [] }], // pure image
    [5, { index: 5, yTop: 3000, yBot: 3500, texts: ['Scale rotate translate any element in 3D space', 'silky smooth gradients with a few utility classes', 'CSS layers so you dont worry about specificity'] }],
    [6, { index: 6, yTop: 3600, yBot: 3900, texts: ['Get started for free join the waitlist'] }],
  ]);
  const rasterBlobSet = new Set(['profile details create organization welcome please fill in the details continue with google']);
  // SOURCE shot: distinct horizontal-gradient signature per band y-range so visual match is meaningful.
  const srcShot = mk(W, pageH, (x, y) => {
    const band = bands.find((b) => y >= b.y && y < b.bottom);
    const seed = band ? band.index : 0;
    const v = Math.round((((x + seed * 137) % W) / W) * 255);
    return [v, (v * 2) % 255, (v + seed * 40) % 255];
  });
  // CLONE shot: 4400 tall; reproduces bands 1,2,3,6 (and a region resembling each) but NOT band 4 (image)
  // or band 5 (text). We paint clone regions with the SAME per-band signature for kept bands; dropped
  // bands' signatures never appear.
  const keptOrder = [1, 2, 3, 6];
  const cloneH = 2200; const slot = Math.floor(cloneH / keptOrder.length);
  const cloneShot = mk(W, cloneH, (x, y) => {
    const k = Math.min(keptOrder.length - 1, Math.floor(y / slot));
    const seed = keptOrder[k];
    const v = Math.round((((x + seed * 137) % W) / W) * 255);
    return [v, (v * 2) % 255, (v + seed * 40) % 255];
  });
  const clone = {
    textBlob: 'more than authentication complete user management built for the modern web latest css features get started for free join the waitlist',
    heads: [], contentH: cloneH, shot: cloneShot, imgUrls: [],
  };
  const res = gradeBandsContent({ bands, srcShot, outlineMap, rasterBlobSet, clone });

  const omittedSecs = res.omissions.map((o) => o.where.section).sort();
  // EXPECT: bands 4 (image, dropped) and 5 (text bento, dropped) omitted; nothing else.
  if (JSON.stringify(omittedSecs) !== JSON.stringify([4, 5])) fail.push(`expected omitted sections [4,5], got [${omittedSecs}]`);
  // band 2 is image+raster-baked text — must be COVERED (visually) and its raster text NEVER flagged.
  const b2 = res.rows.find((r) => r.index === 2);
  if (!b2.covered) fail.push(`band 2 (raster showcase) should be covered visually, got ${JSON.stringify(b2.visual)}`);
  if (b2.kind !== 'image-band') fail.push(`band 2 should classify as image-band (all text raster-baked), got ${b2.kind} units=${b2.salientUnits}`);
  // band 5 must flag the bento text in evidence
  const b5om = res.omissions.find((o) => o.where.section === 5);
  if (!b5om || !/3D space|gradients|bento|css layers/i.test(JSON.stringify(b5om))) fail.push(`band 5 omission should name the dropped cards, got ${JSON.stringify(b5om)}`);
  if (res.completenessScore >= 1) fail.push(`abridged score should be < 1, got ${res.completenessScore}`);

  // perfect clone (source-vs-itself shape): clone == source height, reproduces every band signature + text.
  const perfectShot = mk(W, pageH, (x, y) => { const band = bands.find((b) => y >= b.y && y < b.bottom); const seed = band ? band.index : 0; const v = Math.round((((x + seed * 137) % W) / W) * 255); return [v, (v * 2) % 255, (v + seed * 40) % 255]; });
  const perfectClone = {
    textBlob: norm([...outlineMap.values()].flatMap((s) => s.texts).join(' ')),
    heads: [], contentH: pageH, shot: perfectShot, imgUrls: [],
  };
  const pres = gradeBandsContent({ bands, srcShot, outlineMap, rasterBlobSet, clone: perfectClone });
  if (pres.completenessScore !== 1.0) fail.push(`perfect-clone: expected 1.0, got ${pres.completenessScore} (omitted ${pres.omissions.map((o) => o.where.section)})`);

  console.log(`  abridged: score=${res.completenessScore} covered=${res.covered}/${res.total} omitted-sections=[${omittedSecs}] crit=${res.critMass || 'none'}`);
  console.log(`  band-2 (raster showcase): covered=${res.rows.find((r) => r.index === 2).covered} kind=${res.rows.find((r) => r.index === 2).kind} (raster text NOT flagged ✓)`);
  console.log(`  omissions: ${res.omissions.map((o) => '[' + o.where.section + '] ' + o.what.slice(0, 40)).join(' | ')}`);
  console.log(`  perfect-clone: score=${pres.completenessScore} omitted=${pres.omissions.length}`);
  if (fail.length) { console.log('\nSELFTEST: FAIL'); for (const f of fail) console.log('  - ' + f); process.exit(1); }
  console.log('\nSELFTEST: PASS (per-band content correspondence; raster-baked text excluded; image-band visual fallback; perfect clone = 1.0)');
  process.exit(0);
}
function require_pngjs() { return _require('pngjs'); }

// ════════════════════════════════════════ MAIN ════════════════════════════════════════════════
async function main() {
  if (has('selftest')) return selftest();
  const capArg = arg('cap');
  const url = arg('url');
  const htmlPath = arg('html');
  const cloneShotPath = arg('clone-shot');
  const out = arg('out', null);
  const label = arg('label', 'completeness');
  const jsonOnly = has('json');
  if (!capArg) { console.error('need --cap <dir|manifest.json> (and --url and/or --html). Or --selftest.'); process.exit(2); }
  if (!url && !htmlPath) { console.error('need --url <clone-url> and/or --html <authored.html>'); process.exit(2); }

  const { dir, manifest } = loadCap(capArg);
  const { W, pageH, bands: rawBands } = sourceBands(manifest);
  const bands = selectContentBands(rawBands);
  const outlineMap = outlineBySection(dir);
  const rasterLocs = ENV.NO_RASTER_EXCL ? [] : rasterCropLocators(dir);
  const rasterBlobSet = await rasterBakedTextSet(dir, rasterLocs);

  // source shot for the visual fallback
  let srcShot = null;
  if (!ENV.NO_VISUAL) {
    try {
      const { PNG } = await import('pngjs');
      const shotRel = (manifest.perWidth?.[W] || manifest.perWidth?.[String(W)] || {}).shot || `shots/w${W}.png`;
      const shotPath = path.isAbsolute(shotRel) ? shotRel : path.join(dir, shotRel);
      if (fs.existsSync(shotPath)) srcShot = PNG.sync.read(fs.readFileSync(shotPath));
    } catch (e) { console.error('[completeness] source shot load failed: ' + e.message); }
  }

  // clone side
  let clone = null;
  const needShotFromUrl = !ENV.NO_VISUAL && !cloneShotPath;
  if (url) { try { clone = await cloneFromUrl(url, needShotFromUrl); } catch (e) { console.error('[completeness] clone URL probe failed: ' + e.message); } }
  if (htmlPath) { const h = cloneFromHtml(htmlPath); clone = clone ? { ...clone, textBlob: (clone.textBlob || '') + ' ' + h.textBlob, heads: [...(clone.heads || []), ...h.heads], imgUrls: [...new Set([...(clone.imgUrls || []), ...h.imgUrls])] } : h; }
  if (!clone) { console.error('[completeness] could not acquire clone side'); process.exit(1); }
  if (cloneShotPath && !ENV.NO_VISUAL) {
    try { const { PNG } = await import('pngjs'); clone.shot = PNG.sync.read(fs.readFileSync(cloneShotPath)); } catch (e) { console.error('[completeness] clone-shot load failed: ' + e.message); }
  }

  const res = gradeBandsContent({ bands, srcShot, outlineMap, rasterBlobSet, clone });

  // OPTIONAL report-only retired asset column (debug; not in score)
  let assetDebug = null;
  if (ENV.ASSET_DEBUG) {
    const stem = (u) => { let b = (String(u).split(/[?#]/)[0].split('/').pop() || '').replace(/\.(png|jpe?g|webp|gif|avif|svg)$/i, ''); b = b.replace(/[-_.][0-9a-z]{6,}.*$/i, ''); return b.replace(/[^a-z0-9]+/gi, '').toLowerCase(); };
    const cloneStems = new Set((clone.imgUrls || []).map(stem).filter((s) => s.length >= 3));
    const srcStems = new Set((manifest.assets || []).filter((a) => a.kind === 'img').map((a) => stem(a.url || a.file || '')).filter((s) => s.length >= 3));
    let wired = 0; for (const s of srcStems) if (cloneStems.has(s)) wired++;
    assetDebug = { note: 'RETIRED stem-asset signal (report-only, NOT in score) — anti-correlated with fidelity', srcStems: srcStems.size, wired, coverage: srcStems.size ? +(wired / srcStems.size).toFixed(3) : null };
  }

  const result = {
    label, cap: dir, url: url || null, html: htmlPath || null, cloneShot: cloneShotPath || (clone.shot ? 'rendered-from-url' : null),
    method: 'per-band content correspondence (text-with-raster-exclusion + visual fallback)',
    completenessScore: res.completenessScore,
    pass: res.pass,
    bands: { total: res.total, covered: res.covered, omitted: res.total - res.covered, omitFrac: res.omitFrac },
    critMass: res.critMass,
    rasterExclusion: { rasterCrops: rasterLocs.length, bakedTextBlobs: rasterBlobSet.size, disabled: ENV.NO_RASTER_EXCL },
    visualFallback: { disabled: ENV.NO_VISUAL, srcShot: !!srcShot, cloneShot: !!clone.shot, hashSimMin: VIS_HASHSIM_MIN, corrMin: VIS_CORR_MIN },
    perBand: res.rows.map((r) => ({ section: r.index, y: r.y, h: r.h, kind: r.kind, covered: r.covered, via: r.textCovered ? 'text' : (r.visualCovered ? 'visual' : null), textFrac: r.textCover.frac, salientUnits: r.salientUnits, visualHashSim: r.visual ? r.visual.hashSim : null, visualCorr: r.visual ? r.visual.corr : null, label: r.label })),
    omissions: res.omissions,
    assetDebug,
    thresholds: { BAND_MIN_H, BAND_MIN_W_FRAC, TEXT_BAND_MIN_CHARS, TEXT_COVER_FRAC, TEXT_UNIT_MATCH, VIS_HASHSIM_MIN, VIS_CORR_MIN, VIS_HASHSIM_ALT, VIS_CORR_ALT, RASTER_UIMOCK_TF_MAX, RASTER_UIMOCK_MF_MIN, PASS_THRESHOLD, CRIT_OMIT_FRAC },
  };

  if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, `completeness-rail-${label}.json`), JSON.stringify(result, null, 2)); }
  if (jsonOnly) { console.log(JSON.stringify(result)); return; }

  console.log(`\n=== AUTHOR-COMPLETENESS RAIL [${label}] ===`);
  console.log(`cap:   ${dir}`);
  console.log(`clone: ${url || ''}${url && htmlPath ? ' + ' : ''}${htmlPath || ''}${cloneShotPath ? ' (shot ' + path.basename(cloneShotPath) + ')' : ''}`);
  console.log(`completenessScore: ${res.completenessScore}   pass=${res.pass}   bands ${res.covered}/${res.total} covered (omitFrac ${res.omitFrac})`);
  console.log(`raster-exclusion: ${rasterLocs.length} raster crops → ${rasterBlobSet.size} baked-text blobs ${ENV.NO_RASTER_EXCL ? '(DISABLED)' : 'excluded'}`);
  console.log(`visual-fallback: srcShot=${!!srcShot} cloneShot=${!!clone.shot} ${ENV.NO_VISUAL ? '(DISABLED)' : `thresh hashSim≥${VIS_HASHSIM_MIN} corr≥${VIS_CORR_MIN}`}`);
  if (res.critMass) console.log(`CRIT-MASS: ${res.critMass}`);
  console.log(`\nPER-BAND:`);
  for (const r of res.rows) console.log(`  s${String(r.index).padEnd(2)} y=${String(r.y).padEnd(6)} h=${String(r.h).padEnd(5)} ${r.kind.padEnd(11)} ${r.covered ? 'COVERED via ' + (r.textCovered ? 'text(' + r.textCover.frac + ')' : 'visual(hs=' + (r.visual ? r.visual.hashSim : '?') + ')') : 'OMITTED'}  ${r.label.slice(0, 46)}`);
  console.log(`\nOMISSIONS (${res.omissions.length}) — what an author loop must add:`);
  for (const o of res.omissions.slice(0, 40)) console.log(`  [${o.kind} s${o.where.section}] ${o.what}  ::  ${o.evidence}`);
  if (ENV.ASSET_DEBUG) console.log(`\n[debug] retired stem-asset coverage (NOT in score): ${JSON.stringify(assetDebug)}`);
  console.log('\n' + JSON.stringify(result));
}

main().catch((e) => { console.error('grade-completeness-rail FAILED:', e.message); process.exit(1); });
