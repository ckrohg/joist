#!/usr/bin/env node
/**
 * @purpose DETERMINISTIC author-COMPLETENESS RAIL for the Joist cloner — a clone-vs-source,
 * cap-anchored, NO-MODEL check that catches quiet ABRIDGEMENT: when the author silently omits
 * SOURCE sections / cards / media that the original had (the n=3 breadth gap — e.g. tailwind's
 * dense ~10-card CSS-grid "bento" rebuilt as ~4 cards, dropping css-grid-*.png / 3d-transforms.png /
 * dark-mode.* / filters.png that are present in the source capture but never wired into the clone).
 *
 * WHY A SEPARATE FILE (NOT grade-completeness.mjs):
 *   eval/grader/grade-completeness.mjs is the SHIPPED TOP-DOWN component grader — it asks
 *   "does the clone HAVE a header / nav / logo / hero / CTA / main / FOOTER?" (canonical-component
 *   presence). That grader PASSES the bento case: the abridged clone still has a header, a main,
 *   and a footer. It does NOT measure whether the source's *repeated content* (its 10 bento cards,
 *   its mid-page feature sections, its showcase imagery) survived. THIS rail answers that different
 *   question with a different, cap-anchored contract, modeled on grade-responsive-rail.mjs:
 *   a clone-vs-source rail that consumes a frozen source-capture dir and reports per-omission
 *   evidence an AUTHOR LOOP can act on. It lives BESIDE the component grader, replacing nothing.
 *
 * WHY DETERMINISTIC (no model): same as the responsive rail — every signal is a manifest read,
 *   a DOM/HTML asset/text enumeration, or a band geometry comparison. Same inputs → same outputs.
 *
 * INPUTS:
 *   --cap   <dir|manifest.json>   frozen SOURCE capture dir (manifest.json + assets/ + sections/ +
 *                                 [outline.txt] + [source.html]). REQUIRED.
 *   --url   <localhost clone URL>  rendered clone (preferred — sees WP-rehosted asset URLs + live DOM).
 *   --html  <authored .html file>  authored clone HTML (works headless; used if no --url, or BOTH).
 *   (at least one of --url / --html required, unless --selftest.)
 *
 * THREE INDEPENDENT, DETERMINISTIC COVERAGE SIGNALS (combined; each abstains cleanly if its input
 * is absent so the rail degrades gracefully — tailwind's cap has NO outline.txt/source.html, so the
 * text signal abstains there while asset+band still fire; clerk's cap has all three):
 *
 *  (1) ASSET COVERAGE  [most concrete — directly catches the bento]
 *      Enumerate SALIENT source assets from manifest.assets (kind:'img'/raster + big inline-svg),
 *      where "salient" = max rendered occurrence AREA >= ASSET_MIN_AREA px^2 (filters out 48x48
 *      avatars, 16x16 icon sprites, hairline svgs). For each salient source asset, check whether it
 *      is WIRED into the clone by matching its normalized basename STEM against the clone's image
 *      URLs / inline-image stems. CRITICAL: the clone re-hosts assets on WordPress
 *      (wp-content/uploads/.../cover-<hash>.png) so the full URL never matches — we match on the
 *      stripped basename STEM (hash/ext removed) with a substring fallback. An UNWIRED salient
 *      source asset = an omission of kind:'asset'.
 *
 *  (2) BAND (SECTION) COVERAGE
 *      From manifest.perWidth[W].sections (each a {x,y,w,h} band), measure how much of the source's
 *      vertical CONTENT AREA the clone reproduces. We map each source content band to a clone
 *      section by ORDERED position + relative-height correspondence (same band-matching idea as the
 *      responsive rail / grade-sections). A source band with no clone counterpart (the clone is far
 *      too short to contain it, or a gap appears in the ordered cover) = an omission of kind:'band'.
 *      We also report a coarse heightRatio (cloneContentH / sourceContentH) as corroboration.
 *
 *  (3) TEXT COVERAGE
 *      Extract SALIENT source headings (outline.txt "hN :: text" lines, else <h1..h3> from
 *      source.html). Check each heading's presence in the clone's visible heading/text set (loose
 *      normalized-substring match). A source heading absent from the clone = an omission of
 *      kind:'text' (a heading is the title of a section — a missing heading is a missing section).
 *
 * SCORE (completenessScore in [0,1]) = weighted mean of the three signal coverages, over only the
 * signals that are APPLICABLE (a signal with no input abstains and its weight redistributes):
 *      coverage_s = covered_s / total_s            (per applicable signal s)
 *      completenessScore = Σ (w_s * coverage_s) / Σ w_s     over applicable s
 * Weights: ASSET_W (asset coverage is the most concrete abridgement signal) >= BAND_W >= TEXT_W.
 *
 * OUTPUT: completenessScore + a STRUCTURED OMISSIONS LIST consumable by an author loop. Each omission:
 *      { kind: 'asset'|'band'|'text',
 *        what: <human label, e.g. "css-grid-2.png" / "section @y=3063 h=4208" / heading text>,
 *        where: { signal, y, h, section, area, index },   // source location for the author to target
 *        evidence: <why we判 it omitted, e.g. "stem 'cssgrid2' not in clone images (45 imgs)"> }
 *
 * SELF-TEST: --selftest runs a synthetic in-memory fixture (no browser, no network): a source with
 *   N salient assets / bands / headings and a clone that reproduces all but ONE of each → asserts
 *   EXACTLY the 3 withheld items are flagged (one per signal), nothing else, and that a
 *   source-vs-itself run scores 1.0. Deterministic, offline, fast.
 *
 * RAILS: LOCAL only. READ-ONLY — only reads the cap dir + a clone URL/HTML; never writes pages,
 *   never mutates baselines. Reversible: COMPLETENESS_NO_TEXT=1 / _NO_ASSET=1 / _NO_BAND=1 drop a
 *   signal (it abstains, weight redistributes) for ablation/debug.
 *
 * Usage:
 *   node grade-completeness-rail.mjs --cap /tmp/genz/tailwind/cap --url http://localhost:8001/?page_id=232
 *   node grade-completeness-rail.mjs --cap /tmp/genz/tailwind/cap --html /tmp/tw.html --out /tmp/o
 *   node grade-completeness-rail.mjs --selftest        # offline synthetic fixture → must PASS
 *   node grade-completeness-rail.mjs --cap <dir> --url <u> --json   # machine-readable only
 *
 * NEW file only. Does NOT import/edit capture/build/grade-sections. Drives Playwright directly
 * (same chromium + step-scroll discipline as the sibling rails) ONLY when a --url is given.
 */
import fs from 'fs';
import path from 'path';

// ─── Named thresholds (all deterministic, tunable in one place) ──────────────────────────────
const ASSET_MIN_AREA = 8000;   // px^2; salient source image must render at least this area at the
                               //   widest width (8000 ≈ 90x90) — filters 48x48 avatars / 16-32px icons.
const ASSET_MIN_DIM = 48;      // px; AND at least one rendered dimension >= this (a 4x2000 hairline
                               //   passes area but is a rule/divider, not content) — belt+braces with area.
const ASSET_STEM_MIN = 3;      // a stem shorter than this is too generic to match on (skip / treat as icon).
const BAND_MIN_H = 120;        // px; ignore source bands shorter than this (thin spacers/rules — not sections).
const BAND_MIN_W_FRAC = 0.50;  // a content band must span >= this fraction of page width to count as a section.
const BAND_COVER_SLACK = 0.15; // frac; a source band is "covered" if the clone reaches >= (bandBottom * (1-slack)).
const TEXT_MIN_LEN = 4;        // ignore headings shorter than this (e.g. a stray "FAQ" is fine, but "—" is not).
const TEXT_MATCH_MIN = 0.6;    // loose-match: source heading is "present" if >= this frac of its words appear
                               //   contiguously-ish in some clone heading/text (handles minor truncation).
const TEXT_MAX_HEADINGS = 60;  // cap how many source headings we demand (huge docs → top-N by document order).
// Signal weights (asset coverage is the most concrete abridgement signal; band next; text corroborates).
const ASSET_W = 0.45;
const BAND_W = 0.35;
const TEXT_W = 0.20;
const PASS_THRESHOLD = 0.85;   // completenessScore >= this AND no critical-mass omission ⇒ pass.
const CRIT_OMIT_FRAC = 0.25;   // if any applicable signal has > this fraction of items omitted ⇒ not-pass
                               //   even if the weighted mean clears threshold (catches a wholesale drop in one axis).

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (i > -1 && d === true ? true : d); };
const has = (n) => process.argv.includes('--' + n);

// ─── Stem normalization: strip directory, query, extension, and trailing content-hash. ────────
// Source URL:  https://tailwindcss.com/_next/.../css-grid-2.15b-x2ty8.g~z.png  → "cssgrid2"
// Clone URL:   http://localhost:8001/wp-content/uploads/.../cover-<40hex>.png   → "cover"
// Robust because: (a) WP rehosts assets so the full URL/host never matches — the human-meaningful
// basename prefix is the only stable anchor; (b) build pipelines append a content hash after a dot
// or dash, so we cut at the FIRST dotted/dashed hash-looking segment, then strip non-alnum.
function stemOf(u) {
  if (!u) return '';
  let base = (String(u).split(/[?#]/)[0].split('/').pop() || '');
  base = base.replace(/\.(png|jpe?g|webp|gif|avif|svg)$/i, '');     // drop extension
  // cut at the first ".<hashy>" or "-<long-hashy>" segment (build content hash): keep the name prefix.
  base = base.replace(/\.[0-9a-z][0-9a-z_~-]{4,}.*$/i, '');         // "css-grid-2.15b-x2ty8.g~z" → "css-grid-2"
  base = base.replace(/[-_][0-9a-f]{8,}$/i, '');                    // "cover-<40hex>" → "cover"
  base = base.replace(/[-_][0-9a-z]{12,}$/i, '');                   // WP "...-rox59m3lxwzivn2st..." long slug tail
  return base.replace(/[^a-z0-9]+/gi, '').toLowerCase();
}
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ─── SOURCE side: enumerate salient assets, content bands, headings from the cap dir. ─────────
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

// (1) SALIENT SOURCE ASSETS — img + large inline-svg, by max rendered occurrence area.
function salientSourceAssets(manifest) {
  const out = [];
  for (const a of (manifest.assets || [])) {
    const isImg = a.kind === 'img' || /\.(png|jpe?g|webp|gif|avif)$/i.test(a.file || a.url || '');
    const isSvg = a.kind === 'inline-svg' || /\.svg$/i.test(a.file || a.url || '');
    if (!isImg && !isSvg) continue;
    const occ = a.occurrences || [];
    let maxArea = 0, maxBox = null;
    for (const o of occ) {
      const b = o.box || {};
      const area = (b.w || 0) * (b.h || 0);
      if (area > maxArea) { maxArea = area; maxBox = b; }
    }
    if (maxArea < ASSET_MIN_AREA) continue;                         // not salient (icon/sprite/avatar)
    if (maxBox && Math.max(maxBox.w || 0, maxBox.h || 0) < ASSET_MIN_DIM) continue;
    const url = a.url || a.file || '';
    const stem = stemOf(url);
    if (stem.length < ASSET_STEM_MIN) continue;                     // too-generic stem → skip (can't match reliably)
    out.push({ stem, url, file: a.file || '', kind: a.kind, area: maxArea, box: maxBox, occCount: occ.length });
  }
  // de-dup by stem (same logo/image used many times = one asset to wire).
  const seen = new Map();
  for (const a of out) { if (!seen.has(a.stem) || a.area > seen.get(a.stem).area) seen.set(a.stem, a); }
  return [...seen.values()];
}

// (2) SOURCE CONTENT BANDS — the real section bands at the widest width.
function sourceBands(manifest) {
  const W = widestWidth(manifest);
  const pw = (manifest.perWidth || {})[W] || (manifest.perWidth || {})[String(W)] || {};
  const pageH = pw.pageH || 0;
  const secs = pw.sections || [];
  const bands = [];
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i];
    const h = s.h || 0, w = s.w || 0, y = s.y || 0;
    if (h < BAND_MIN_H) continue;
    if (W && w < W * BAND_MIN_W_FRAC) continue;
    // skip the page-spanning root band (y≈0, h≈pageH) — it's the whole body, not a section.
    if (pageH && y <= 2 && h >= pageH * 0.95) continue;
    bands.push({ index: i, y, h, w, bottom: y + h, crop: s.crop || '', locator: s.locator || '' });
  }
  bands.sort((a, b) => a.y - b.y);
  return { W, pageH, bands };
}

// (3) SOURCE HEADINGS — from outline.txt ("hN :: text") if present, else <h1..h3> in source.html.
function sourceHeadings(capDir) {
  const headings = [];
  const outlinePath = path.join(capDir, 'outline.txt');
  if (fs.existsSync(outlinePath)) {
    const lines = fs.readFileSync(outlinePath, 'utf8').split('\n');
    for (const ln of lines) {
      const m = ln.match(/^\s*h([1-6])\b\s*(?:::\s*(.+))?$/);
      if (m && m[2]) headings.push({ level: +m[1], text: m[2].trim(), src: 'outline' });
    }
    if (headings.length) return dedupeHeadings(headings);
  }
  const htmlPath = path.join(capDir, 'source.html');
  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const rx = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    let m;
    while ((m = rx.exec(html))) {
      const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
      if (text) headings.push({ level: +m[1], text, src: 'source.html' });
    }
    return dedupeHeadings(headings);
  }
  return null; // signal abstains — no text source available (e.g. tailwind cap has neither file)
}
function dedupeHeadings(hs) {
  const seen = new Set(), out = [];
  for (const h of hs) {
    if (h.text.length < TEXT_MIN_LEN) continue;
    const k = norm(h.text);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(h);
    if (out.length >= TEXT_MAX_HEADINGS) break;
  }
  return out;
}

// ─── CLONE side: gather image stems + heading/text + content height. ──────────────────────────
// Two acquisition paths: a live rendered URL (Playwright) and/or an authored HTML file (regex).
async function cloneFromUrl(url) {
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
    // step-scroll so lazy media/sections attach + paint (same discipline as the responsive rail).
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
      const imgs = new Set();
      for (const i of document.images) { const u = i.currentSrc || i.src; if (u) imgs.add(u); }
      for (const el of document.querySelectorAll('*')) {
        const bi = getComputedStyle(el).backgroundImage;
        if (bi && bi !== 'none') { const m = bi.match(/url\(["']?([^"')]+)/); if (m) imgs.add(m[1]); }
      }
      const heads = [...document.querySelectorAll('h1,h2,h3,h4,.elementor-heading-title')].map((h) => (h.textContent || '').trim()).filter((t) => t.length > 1);
      // also the full visible-text blob (so a heading rendered as a non-heading widget still counts present)
      const textBlob = (document.body ? document.body.innerText : '') || '';
      const contentH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
      return { imgUrls: [...imgs], heads, textBlob, contentH };
    });
    await browser.close();
    return data;
  } catch (e) { await browser.close().catch(() => {}); throw e; }
}

function cloneFromHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const imgs = new Set();
  let m;
  const imgRx = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
  while ((m = imgRx.exec(html))) imgs.add(m[1]);
  const srcsetRx = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
  while ((m = srcsetRx.exec(html))) for (const part of m[1].split(',')) { const u = part.trim().split(/\s+/)[0]; if (u) imgs.add(u); }
  const bgRx = /background(?:-image)?\s*:\s*url\(["']?([^"')]+)/gi;
  while ((m = bgRx.exec(html))) imgs.add(m[1]);
  const heads = [];
  const hRx = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((m = hRx.exec(html))) { const t = m[2].replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim(); if (t) heads.push(t); }
  const textBlob = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
  return { imgUrls: [...imgs], heads, textBlob, contentH: null };
}

// merge two clone-sides (url + html) into one
function mergeClone(a, b) {
  if (!a) return b; if (!b) return a;
  return {
    imgUrls: [...new Set([...(a.imgUrls || []), ...(b.imgUrls || [])])],
    heads: [...(a.heads || []), ...(b.heads || [])],
    textBlob: (a.textBlob || '') + ' ' + (b.textBlob || ''),
    contentH: a.contentH || b.contentH || null,
  };
}

// ─── SIGNAL (1): asset coverage ───────────────────────────────────────────────────────────────
function gradeAssets(salient, clone) {
  const cloneStems = new Set((clone.imgUrls || []).map(stemOf).filter((s) => s.length >= ASSET_STEM_MIN));
  const cloneStemArr = [...cloneStems];
  const wired = (stem) => cloneStems.has(stem) || cloneStemArr.some((c) => (c.length >= 4 && stem.includes(c)) || (stem.length >= 4 && c.includes(stem)));
  const omissions = [];
  let covered = 0;
  for (const a of salient) {
    if (wired(a.stem)) { covered++; continue; }
    omissions.push({
      kind: 'asset',
      what: (a.url.split(/[?#]/)[0].split('/').pop() || a.stem),
      where: { signal: 'asset', y: a.box ? a.box.y : null, area: a.area, section: null },
      evidence: `salient source img (stem '${a.stem}', ${a.box ? a.box.w + 'x' + a.box.h : '?'}, area ${a.area}) not wired into clone (${cloneStems.size} clone img stems)`,
    });
  }
  return { applicable: salient.length > 0, total: salient.length, covered, coverage: salient.length ? +(covered / salient.length).toFixed(3) : null, omissions };
}

// ─── SIGNAL (2): band (section) coverage ──────────────────────────────────────────────────────
// The clone is rendered as ONE page; we don't have its per-section crops here, so band coverage is
// an ORDERED VERTICAL COVER test: a source band is "covered" iff the clone's content height reaches
// past (its bottom * (1-slack)). A source band whose bottom is beyond what the clone produced =
// content the clone never got to = omitted. We additionally surface a heightRatio for corroboration.
// (Conservative: this catches WHOLESALE truncation / a far-too-short clone. When clone contentH is
// unknown — html-only with no render — the band signal abstains rather than guess.)
function gradeBands(srcBands, srcPageH, clone) {
  if (clone.contentH == null) {
    return { applicable: false, total: srcBands.length, covered: 0, coverage: null, omissions: [], note: 'clone content-height unknown (no rendered URL) — band signal abstains' };
  }
  if (!srcBands.length || !srcPageH) {
    return { applicable: false, total: 0, covered: 0, coverage: null, omissions: [], note: 'no source content bands' };
  }
  // The clone may be scaled vertically vs the source; normalize the cover threshold by the ratio of
  // the LAST-covered content. We treat coverage in source-y space: clone reaches an equivalent
  // source-y of (clone.contentH) only if heights are 1:1. To stay robust to overall scale, we map
  // by FRACTION of page: a band centered at fraction f of source page is covered iff the clone's
  // content extends to fraction f (i.e. it produced enough sections to get there). Since both render
  // the same content top-down, fractional position is the order-preserving anchor.
  const heightRatio = +(clone.contentH / srcPageH).toFixed(3);
  const omissions = [];
  let covered = 0;
  for (const b of srcBands) {
    const bandFrac = b.bottom / srcPageH;                 // where this band ends, as a frac of source page
    // covered iff the clone produced content down to (bandFrac * srcPageH * heightRatioFloor). Because
    // a faithful clone has heightRatio≈1, we require the clone to reach bandFrac of ITS OWN height,
    // which is always true unless the clone is proportionally shorter near the bottom. The real
    // discriminator: if the clone is much SHORTER overall (heightRatio << 1), upper bands still pass
    // but the tail bands fail — exactly the abridged-bottom signature.
    const cloneReachesFrac = 1.0;                         // clone always spans its own [0..1]
    const need = bandFrac;
    const covOK = cloneReachesFrac >= need * (1 - BAND_COVER_SLACK) && heightRatio >= bandFrac * (1 - BAND_COVER_SLACK);
    if (covOK) { covered++; continue; }
    omissions.push({
      kind: 'band',
      what: `section @y=${b.y} h=${b.h}`,
      where: { signal: 'band', y: b.y, h: b.h, section: b.index, crop: b.crop || null },
      evidence: `source band ends at ${(bandFrac * 100).toFixed(0)}% of source height but clone reached only ~${(heightRatio * 100).toFixed(0)}% (heightRatio ${heightRatio}) — content past the clone's bottom is omitted`,
    });
  }
  return { applicable: true, total: srcBands.length, covered, coverage: srcBands.length ? +(covered / srcBands.length).toFixed(3) : null, heightRatio, omissions };
}

// ─── SIGNAL (3): text (heading) coverage ──────────────────────────────────────────────────────
function gradeText(srcHeadings, clone) {
  if (srcHeadings == null) {
    return { applicable: false, total: 0, covered: 0, coverage: null, omissions: [], note: 'no source headings (outline.txt / source.html absent) — text signal abstains' };
  }
  const cloneHeadNorms = (clone.heads || []).map(norm).filter(Boolean);
  const cloneBlob = ' ' + norm(clone.textBlob || '') + ' ';
  const present = (text) => {
    const n = norm(text);
    if (!n) return false;
    if (cloneBlob.includes(' ' + n + ' ') || cloneBlob.includes(n)) return true;                 // exact-ish in blob
    if (cloneHeadNorms.some((h) => h === n || h.includes(n) || n.includes(h))) return true;       // heading sub/superset
    // loose word-overlap: >= TEXT_MATCH_MIN of source heading words present in the clone blob.
    const words = n.split(' ').filter((w) => w.length >= 3);
    if (!words.length) return cloneBlob.includes(n);
    const hit = words.filter((w) => cloneBlob.includes(' ' + w) || cloneBlob.includes(w + ' ') || cloneBlob.includes(' ' + w + ' ')).length;
    return hit / words.length >= TEXT_MATCH_MIN;
  };
  const omissions = [];
  let covered = 0;
  for (const h of srcHeadings) {
    if (present(h.text)) { covered++; continue; }
    omissions.push({
      kind: 'text',
      what: h.text.slice(0, 80),
      where: { signal: 'text', level: h.level, section: null },
      evidence: `source heading h${h.level} "${h.text.slice(0, 60)}" not found in clone headings/text — likely an omitted section`,
    });
  }
  return { applicable: srcHeadings.length > 0, total: srcHeadings.length, covered, coverage: srcHeadings.length ? +(covered / srcHeadings.length).toFixed(3) : null, omissions };
}

// ─── Combine the three signals into a completenessScore + unified omissions list. ─────────────
function combine(assets, bands, text) {
  const sigs = [
    { name: 'asset', w: ASSET_W, r: assets },
    { name: 'band', w: BAND_W, r: bands },
    { name: 'text', w: TEXT_W, r: text },
  ].filter((s) => s.r.applicable && s.r.coverage != null);
  let wSum = 0, acc = 0;
  for (const s of sigs) { wSum += s.w; acc += s.w * s.r.coverage; }
  const completenessScore = wSum ? +(acc / wSum).toFixed(3) : 1.0;
  // critical-mass omission: any applicable signal dropping > CRIT_OMIT_FRAC of its items.
  const critMass = sigs.filter((s) => s.r.total > 0 && (s.r.total - s.r.covered) / s.r.total > CRIT_OMIT_FRAC)
    .map((s) => `${s.name}:${s.r.total - s.r.covered}/${s.r.total} omitted (>${(CRIT_OMIT_FRAC * 100).toFixed(0)}%)`);
  const omissions = [...assets.omissions, ...bands.omissions, ...text.omissions];
  const pass = completenessScore >= PASS_THRESHOLD && critMass.length === 0;
  return { completenessScore, weightsUsed: Object.fromEntries(sigs.map((s) => [s.name, s.w])), critMass, omissions, pass, signalsApplied: sigs.map((s) => s.name) };
}

// ════════════════════════════════ SELF-TEST (offline, synthetic) ══════════════════════════════
function selftest() {
  console.log('=== grade-completeness-rail SELF-TEST (offline synthetic fixture) ===');
  // SOURCE: 4 salient assets, 4 content bands, 4 headings. CLONE: reproduces all but ONE of each.
  const salient = [
    { stem: 'cssgrid1', url: 'https://s/css-grid-1.abc.png', area: 75000, box: { x: 10, y: 1200, w: 192, h: 392 } },
    { stem: 'cssgrid2', url: 'https://s/css-grid-2.def.png', area: 36864, box: { x: 10, y: 1300, w: 192, h: 192 } },
    { stem: 'darkmode', url: 'https://s/dark-mode.ghi.png', area: 232875, box: { x: 10, y: 1400, w: 375, h: 621 } },
    { stem: 'hero', url: 'https://s/hero.jkl.png', area: 500000, box: { x: 0, y: 100, w: 1000, h: 500 } },
  ];
  const srcBands = [
    { index: 1, y: 153, h: 192, w: 1360, bottom: 345 },
    { index: 2, y: 617, h: 412, w: 1360, bottom: 1029 },
    { index: 3, y: 1189, h: 1714, w: 1360, bottom: 2903 },
    { index: 4, y: 3063, h: 4208, w: 1360, bottom: 7271 },   // the deepest band — the one that gets cut
  ];
  const srcPageH = 7616;
  const srcHeadings = [
    { level: 1, text: 'More than authentication' },
    { level: 2, text: 'Class Warfare' },
    { level: 2, text: 'Built for the modern web' },
    { level: 2, text: 'Mobile screenshots and previews' },  // the omitted heading
  ];
  // CLONE: has cssgrid1/cssgrid2/hero wired (darkmode dropped); content reaches ~40% of source height
  // (so the deepest band @y=3063→bottom 7271 ≈ 95% is omitted, the rest covered); headings minus one.
  const clone = {
    imgUrls: [
      'http://localhost:8001/wp-content/uploads/css-grid-1-aaaaaaaaaaaa.png',
      'http://localhost:8001/wp-content/uploads/css-grid-2-bbbbbbbbbbbb.png',
      'http://localhost:8001/wp-content/uploads/hero-cccccccccccc.png',
    ],
    heads: ['More than authentication', 'Class Warfare', 'Built for the modern web'],
    textBlob: 'More than authentication Class Warfare Built for the modern web some body copy',
    contentH: Math.round(srcPageH * 0.40),  // far too short → deepest band omitted
  };

  const a = gradeAssets(salient, clone);
  const b = gradeBands(srcBands, srcPageH, clone);
  const t = gradeText(srcHeadings, clone);
  const res = combine(a, b, t);

  const fail = [];
  // expect exactly 1 asset omission = darkmode
  const aOm = a.omissions.map((o) => o.what);
  if (!(a.omissions.length === 1 && /dark-mode/.test(aOm[0]))) fail.push(`asset: expected 1 omission [dark-mode], got ${JSON.stringify(aOm)}`);
  // expect the deepest band (section 4 @y=3063) flagged, and NOT band 1 (y=153, ~5% — covered)
  const bSecs = b.omissions.map((o) => o.where.section);
  if (!b.omissions.length || !bSecs.includes(4)) fail.push(`band: expected deepest band (section 4) omitted, got sections ${JSON.stringify(bSecs)}`);
  if (bSecs.includes(1)) fail.push(`band: shallow band (section 1, ~5% of page) should NOT be omitted but was`);
  // expect exactly 1 text omission = the screenshots heading
  const tOm = t.omissions.map((o) => o.what);
  if (!(t.omissions.length === 1 && /screenshots/i.test(tOm[0]))) fail.push(`text: expected 1 omission [Mobile screenshots...], got ${JSON.stringify(tOm)}`);
  // completenessScore must be < 1 (omissions present) and the unified list must carry all three kinds
  const kinds = new Set(res.omissions.map((o) => o.kind));
  if (res.completenessScore >= 1) fail.push(`score: expected < 1 with omissions, got ${res.completenessScore}`);
  if (!(kinds.has('asset') && kinds.has('band') && kinds.has('text'))) fail.push(`omissions list missing a kind: ${[...kinds].join(',')}`);

  // SECOND assertion: source-vs-ITSELF must score 1.0 with zero omissions (perfect clone).
  const perfectClone = {
    imgUrls: salient.map((s) => `http://localhost:8001/wp/${s.stem}-zzzzzzzzzzzz.png`),
    heads: srcHeadings.map((h) => h.text),
    textBlob: srcHeadings.map((h) => h.text).join(' '),
    contentH: srcPageH,
  };
  const pa = gradeAssets(salient, perfectClone), pb = gradeBands(srcBands, srcPageH, perfectClone), pt = gradeText(srcHeadings, perfectClone);
  const pres = combine(pa, pb, pt);
  if (pres.completenessScore !== 1.0) fail.push(`perfect-clone: expected score 1.0, got ${pres.completenessScore} (omissions ${pres.omissions.length})`);
  if (pres.omissions.length !== 0) fail.push(`perfect-clone: expected 0 omissions, got ${pres.omissions.length}: ${JSON.stringify(pres.omissions.map((o) => o.what))}`);

  console.log(`  abridged-clone: score=${res.completenessScore}  omissions=${res.omissions.length} (asset ${a.omissions.length}, band ${b.omissions.length}, text ${t.omissions.length})  pass=${res.pass}`);
  console.log(`  asset omissions: ${aOm.join(', ')}`);
  console.log(`  band omissions : ${b.omissions.map((o) => o.what).join(' | ')}`);
  console.log(`  text omissions : ${tOm.join(' | ')}`);
  console.log(`  perfect-clone : score=${pres.completenessScore}  omissions=${pres.omissions.length}`);
  if (fail.length) { console.log('\nSELFTEST: FAIL'); for (const f of fail) console.log('  - ' + f); process.exit(1); }
  console.log('\nSELFTEST: PASS (the 3 withheld items — one per signal — are flagged; nothing spurious; source-vs-itself = 1.0)');
  process.exit(0);
}

// ════════════════════════════════════════ MAIN ════════════════════════════════════════════════
async function main() {
  if (has('selftest')) return selftest();

  const capArg = arg('cap');
  const url = arg('url');
  const htmlPath = arg('html');
  const out = arg('out', null);
  const label = arg('label', 'completeness');
  const jsonOnly = has('json');
  if (!capArg) { console.error('need --cap <dir|manifest.json> (and --url and/or --html). Or --selftest.'); process.exit(2); }
  if (!url && !htmlPath) { console.error('need --url <clone-url> and/or --html <authored.html>'); process.exit(2); }

  const { dir, manifest } = loadCap(capArg);
  const salient = process.env.COMPLETENESS_NO_ASSET ? [] : salientSourceAssets(manifest);
  const { pageH, bands } = sourceBands(manifest);
  const srcBands = process.env.COMPLETENESS_NO_BAND ? [] : bands;
  const srcHeadings = process.env.COMPLETENESS_NO_TEXT ? null : sourceHeadings(dir);

  let clone = null;
  if (url) { try { clone = await cloneFromUrl(url); } catch (e) { console.error('[completeness] clone URL probe failed: ' + e.message); } }
  if (htmlPath) clone = mergeClone(clone, cloneFromHtml(htmlPath));
  if (!clone) { console.error('[completeness] could not acquire clone side'); process.exit(1); }

  const a = gradeAssets(salient, clone);
  const b = gradeBands(srcBands, pageH, clone);
  const t = gradeText(srcHeadings, clone);
  const res = combine(a, b, t);

  const result = {
    label, cap: dir, url: url || null, html: htmlPath || null,
    completenessScore: res.completenessScore,
    pass: res.pass,
    signalsApplied: res.signalsApplied,
    weightsUsed: res.weightsUsed,
    critMass: res.critMass,
    signals: {
      asset: { applicable: a.applicable, coverage: a.coverage, covered: a.covered, total: a.total, omitted: a.omissions.length, note: a.note || null },
      band: { applicable: b.applicable, coverage: b.coverage, covered: b.covered, total: b.total, omitted: b.omissions.length, heightRatio: b.heightRatio ?? null, note: b.note || null },
      text: { applicable: t.applicable, coverage: t.coverage, covered: t.covered, total: t.total, omitted: t.omissions.length, note: t.note || null },
    },
    omissions: res.omissions,
    thresholds: { ASSET_MIN_AREA, ASSET_MIN_DIM, BAND_MIN_H, BAND_COVER_SLACK, TEXT_MATCH_MIN, ASSET_W, BAND_W, TEXT_W, PASS_THRESHOLD, CRIT_OMIT_FRAC },
  };

  if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, `completeness-rail-${label}.json`), JSON.stringify(result, null, 2)); }
  if (jsonOnly) { console.log(JSON.stringify(result)); return; }

  // Human-readable
  console.log(`\n=== AUTHOR-COMPLETENESS RAIL [${label}] ===`);
  console.log(`cap:   ${dir}`);
  console.log(`clone: ${url || ''}${url && htmlPath ? ' + ' : ''}${htmlPath || ''}`);
  console.log(`completenessScore: ${res.completenessScore}   pass=${res.pass}   signals=[${res.signalsApplied.join(', ')}]`);
  const fmt = (s, r) => `  ${s.padEnd(6)} ${r.applicable ? `coverage=${r.coverage} (${r.covered}/${r.total}, omitted ${r.omitted})` + (r.heightRatio != null ? ` heightRatio=${r.heightRatio}` : '') : 'ABSTAINS' + (r.note ? ' — ' + r.note : '')}`;
  console.log(fmt('ASSET', result.signals.asset));
  console.log(fmt('BAND', result.signals.band));
  console.log(fmt('TEXT', result.signals.text));
  if (res.critMass.length) console.log(`  CRIT-MASS: ${res.critMass.join('; ')}`);
  console.log(`\nOMISSIONS (${res.omissions.length}) — what an author loop must add:`);
  for (const o of res.omissions.slice(0, 40)) console.log(`  [${o.kind}] ${o.what}  ::  ${o.evidence}`);
  if (res.omissions.length > 40) console.log(`  ... and ${res.omissions.length - 40} more`);
  console.log('\n' + JSON.stringify(result));
}

main().catch((e) => { console.error('grade-completeness-rail FAILED:', e.message); process.exit(1); });
