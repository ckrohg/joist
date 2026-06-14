#!/usr/bin/env node
/**
 * Joist BRUTAL fidelity grader — CLONE_FIDELITY_SYSTEM_SPEC.md §A.
 *
 * Drives Playwright over BOTH the source and the clone, captures matched
 * states, computes OBJECTIVE diffs, and emits an honest fidelity % + a
 * localized defect list. No vibes. Default-to-failing: every dimension is
 * earned from measured similarity, not assumed.
 *
 * Usage:
 *   node grade.mjs --source <url> --clone <url> [--out <dir>] [--label <name>]
 *
 * Output: JSON report to stdout + <out>/report.json + screenshots in <out>.
 */
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';
import { assertAllowedBase, assertNotBlocked } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: refuse a stray (e.g. paused *.sg-host.com) URL before any navigation.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

function arg(name, def = null) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

// ---- in-page metric extraction (objective, structural) ----
const PAGE_METRICS = () => {
  const q = (s) => document.querySelectorAll(s);
  const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
  let best = null, bestSize = 0;
  document.querySelectorAll('h1,h2,h3,[class*="head" i]').forEach((e) => {
    const cs = getComputedStyle(e); const fs = parseFloat(cs.fontSize) || 0;
    if (fs > bestSize && (e.innerText || '').trim()) {
      bestSize = fs;
      best = { text: e.innerText.trim().slice(0, 80), fontSizePx: fs, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily.split(',')[0].replace(/["']/g, ''), color: cs.color, letterSpacing: cs.letterSpacing, lineHeight: cs.lineHeight };
    }
  });
  const bgImgs = [...q('*')].filter((e) => { const b = getComputedStyle(e).backgroundImage; return b && b !== 'none' && b.includes('url('); }).length;
  const headingStyles = [];
  const localBg = (el) => { let n = el; while (n && n !== document.documentElement) { const b = getComputedStyle(n).backgroundColor; if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return b; n = n.parentElement; } return 'rgb(255, 255, 255)'; };
  document.querySelectorAll('h1,h2,h3').forEach((e) => { const c = getComputedStyle(e); const s = parseFloat(c.fontSize) || 0; if (s >= 22 && (e.innerText || '').trim()) headingStyles.push({ sizePx: Math.round(s), color: c.color, bg: localBg(e) }); });
  const aPills = [...q('a')].filter((a) => { const s = getComputedStyle(a); const br = parseFloat(s.borderTopLeftRadius) || 0; const bg = s.backgroundColor; return br >= 10 && bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && (a.innerText || '').trim().length < 30; }).length;
  const cs = getComputedStyle(document.body);
  return {
    pageHeight: document.documentElement.scrollHeight,
    sections: q('section, .elementor-section, .e-con, [class*="section" i]').length,
    headings: q('h1,h2,h3,h4').length,
    images: q('img').length,
    bgImages: bgImgs,
    videos: q('video').length,
    canvas: q('canvas').length,
    svgs: q('svg').length,
    buttons: q('button, .elementor-button, [class*="btn" i], [class*="button" i]').length,
    links: q('a').length,
    textLen: bodyText.length,
    bodyBg: cs.backgroundColor,
    bodyColor: cs.color,
    biggestHeading: best,
    headingStyles,
    aPills,
  };
};

function cropRGBA(png, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    png.data.copy(out, y * w * 4, y * png.width * 4, y * png.width * 4 + w * 4);
  }
  return out;
}

function viewportPixelDiff(bufA, bufB) {
  const a = PNG.sync.read(bufA), b = PNG.sync.read(bufB);
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const da = cropRGBA(a, w, h), db = cropRGBA(b, w, h);
  const diff = Buffer.alloc(w * h * 4);
  const mismatched = pixelmatch(da, db, diff, w, h, { threshold: 0.12 });
  return mismatched / (w * h); // 0..1 fraction of pixels that differ
}

function avgRGB(buf) {
  const p = PNG.sync.read(buf); let r = 0, g = 0, bl = 0, n = 0;
  for (let i = 0; i < p.data.length; i += 4) { r += p.data[i]; g += p.data[i + 1]; bl += p.data[i + 2]; n++; }
  return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
}
const rgbDist = (a, b) => Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2); // 0..441
// WCAG contrast — catches unreadable text (e.g. green heading on white) that metric scores miss.
function parseRGB(s) { const m = String(s).match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/); return m ? [+m[1], +m[2], +m[3]] : [255, 255, 255]; }
function relLum([r, g, b]) { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function contrastRatio(a, b) { const l1 = relLum(a), l2 = relLum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }

async function capture(browser, url, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, userAgent: UA, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try { await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }); }
  catch { try { await page.goto(url, { waitUntil: 'load', timeout: 45000 }); } catch {} }
  await page.waitForTimeout(2800); // fonts + entrance animations settle
  const metrics = await page.evaluate(PAGE_METRICS);
  const viewportShot = await page.screenshot(); // first screen only — comparable
  // scroll-state magnitude (dynamic): how much changes across scroll on THIS site
  const shots = [];
  for (const f of [0, 0.5, 1.0]) {
    await page.evaluate((y) => window.scrollTo(0, y * Math.max(0, document.documentElement.scrollHeight - window.innerHeight)), f);
    await page.waitForTimeout(700);
    shots.push(await page.screenshot());
  }
  // hover-delta on a sample of interactive els: does anything visually change on hover?
  let hoverDelta = 0;
  // hover SWEEP: sample up to ~8 interactive els; per-element before/after delta.
  const hoverSamples = [];
  try {
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
    // Prefer obvious CTAs first, then a few prominent links; cap at 8, dedupe by handle.
    const SEL = 'button, .elementor-button, a[class*="btn" i], a[class*="button" i]';
    let targets = await page.$$(SEL);
    if (targets.length < 8) {
      const links = await page.$$('a');
      targets = targets.concat(links);
    }
    const seen = new Set();
    let used = 0;
    for (const target of targets) {
      if (used >= 8) break;
      try {
        // skip offscreen / zero-size els so the screenshot delta is meaningful
        const box = await target.boundingBox();
        if (!box || box.width < 4 || box.height < 4 || box.y > vp.height) continue;
        const key = Math.round(box.x) + ':' + Math.round(box.y) + ':' + Math.round(box.width);
        if (seen.has(key)) continue; seen.add(key);
        // move mouse away first to neutralize prior hover, then capture before/after
        await page.mouse.move(1, 1); await page.waitForTimeout(120);
        const before = await page.screenshot();
        await target.hover({ timeout: 1500 }); await page.waitForTimeout(350);
        const after = await page.screenshot();
        const delta = viewportPixelDiff(before, after);
        hoverSamples.push(+delta.toFixed(5));
        used++;
      } catch {}
    }
    await page.mouse.move(1, 1);
    if (hoverSamples.length) hoverDelta = Math.max(...hoverSamples); // back-compat scalar
  } catch {}
  const hoverElementsResponsive = hoverSamples.filter((d) => d > 0.002).length;

  // time-lapse self-diff at rest: loop animations / animated gradients / marquees.
  let timeLapseSelfDiff = 0;
  try {
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
    const t0 = await page.screenshot();
    await page.waitForTimeout(2000);
    const t2 = await page.screenshot();
    timeLapseSelfDiff = viewportPixelDiff(t0, t2);
  } catch {}

  // full-page screenshots (scrolled to top) — used for below-the-fold layout-drift diff.
  let fullPageShot = null;
  try {
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(250);
    fullPageShot = await page.screenshot({ fullPage: true });
  } catch {}

  await ctx.close();
  return { metrics, viewportShot, scrollShots: shots, hoverDelta, hoverSamples, hoverElementsResponsive, timeLapseSelfDiff, fullPageShot };
}

// Nearest-neighbor scale an RGBA PNG buffer to target dimensions; returns {data,width,height}.
function scalePNG(buf, targetW, targetH) {
  const src = PNG.sync.read(buf);
  const tw = Math.max(1, Math.round(targetW)), th = Math.max(1, Math.round(targetH));
  const out = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y / th) * src.height));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x / tw) * src.width));
      const si = (sy * src.width + sx) * 4, di = (y * tw + x) * 4;
      out[di] = src.data[si]; out[di + 1] = src.data[si + 1];
      out[di + 2] = src.data[si + 2]; out[di + 3] = src.data[si + 3];
    }
  }
  return { data: out, width: tw, height: th };
}

// Scale BOTH screenshots to a common width (source width), then compare full extent
// (limited to the shorter of the two heights). Catches horizontal-scale + below-fold drift.
function scaledPixelDiff(bufA, bufB) {
  const a = PNG.sync.read(bufA), b = PNG.sync.read(bufB);
  if (!a.width || !b.width) return 1;
  const targetW = a.width;                       // scale clone to source width
  const bScaledH = Math.round(b.height * (targetW / b.width));
  const aImg = { data: a.data, width: a.width, height: a.height };
  const bImg = scalePNG(bufB, targetW, bScaledH);
  const h = Math.min(aImg.height, bImg.height);
  const w = targetW;
  const da = Buffer.alloc(w * h * 4), db = Buffer.alloc(w * h * 4);
  aImg.data.copy(da, 0, 0, w * h * 4);
  bImg.data.copy(db, 0, 0, w * h * 4);
  const diff = Buffer.alloc(w * h * 4);
  const mismatched = pixelmatch(da, db, diff, w, h, { threshold: 0.12 });
  return mismatched / (w * h);
}

function scrollMagnitude(shots) { // mean diff between consecutive scroll states
  let d = 0, n = 0;
  for (let i = 1; i < shots.length; i++) { d += viewportPixelDiff(shots[i - 1], shots[i]); n++; }
  return n ? d / n : 0;
}

// ---- defect + scoring ----
function ratio(a, b) { if (!a && !b) return 1; const hi = Math.max(a, b), lo = Math.min(a, b); return hi === 0 ? 1 : lo / hi; }

function grade(src, cln, vpName, defects) {
  const sm = src.metrics, cm = cln.metrics;
  const D = (cond, sev, root, cap, observed, expected, remedy, loc = vpName) => { if (cond) defects.push({ viewport: vpName, location: loc, severity: sev, root_cause_tag: root, capability_gap_tag: cap, observed, expected, remedy }); };

  // structure
  const sectionR = ratio(sm.sections, cm.sections);
  D(cm.pageHeight < sm.pageHeight * 0.6, 'high', 'truncation', 'section_completeness', `clone ${cm.pageHeight}px tall`, `source ${sm.pageHeight}px`, 'author EVERY top-level source section; count before grading');
  D(cm.headings < sm.headings * 0.6, 'med', 'extraction_miss', 'structure_parser', `${cm.headings} headings`, `${sm.headings}`, 'capture all headings/sections');
  D(sm.images >= 3 && cm.images < sm.images * 0.4, 'high', 'asset_not_captured', 'asset_capture', `${cm.images} <img>`, `${sm.images}`, 'capture+host real images; do not drop or placeholder');
  D((sm.canvas + sm.videos) > 0 && (cm.canvas + cm.videos) === 0, 'high', 'asset_not_captured', 'asset_capture', `no canvas/video`, `source has ${sm.canvas} canvas / ${sm.videos} video`, 'capture animated art (WebGL/video) as looping video/sprite, host, embed');

  // color
  const bgDist = rgbDist(src.avgRGB, cln.avgRGB);
  D(bgDist > 60, 'high', 'color_mismatch', 'color_extraction', `avg ${cln.avgRGB}`, `source avg ${src.avgRGB} (Δ${Math.round(bgDist)})`, 'match background + dominant palette (e.g. white+gradient, not flat fill)');

  // typography
  const sh = sm.biggestHeading, ch = cm.biggestHeading;
  if (sh && ch) {
    D(ratio(sh.fontSizePx, ch.fontSizePx) < 0.8, 'med', 'type_mismatch', 'typography_match', `heading ${Math.round(ch.fontSizePx)}px`, `${Math.round(sh.fontSizePx)}px`, 'match heading font-size scale');
    D(Math.abs(parseInt(sh.fontWeight) - parseInt(ch.fontWeight)) >= 200, 'med', 'type_mismatch', 'typography_match', `weight ${ch.fontWeight}`, `${sh.fontWeight}`, 'match font weight');
    D(sh.fontFamily.toLowerCase() !== ch.fontFamily.toLowerCase(), 'low', 'type_mismatch', 'typography_match', `font ${ch.fontFamily}`, `${sh.fontFamily}`, 'match font-family (closest web font if proprietary)');
  }

  // dynamic / motion reproduction
  D(src.scrollMag > 0.18 && cln.scrollMag < src.scrollMag * 0.4, 'med', 'motion_not_reproduced', 'motion_runtime', `clone scroll-change ${(cln.scrollMag*100).toFixed(0)}%`, `source ${(src.scrollMag*100).toFixed(0)}%`, 'reproduce scroll-triggered motion (joist-* classes / escape-hatch)');
  D(src.hoverDelta > 0.002 && cln.hoverDelta < src.hoverDelta * 0.3, 'low', 'motion_not_reproduced', 'motion_runtime', `clone hover-change ${(cln.hoverDelta*100).toFixed(2)}%`, `source ${(src.hoverDelta*100).toFixed(2)}%`, 'reproduce hover states');
  // hover SWEEP aggregate: many source els respond to hover, ~none on clone.
  const srcHoverResp = src.hoverElementsResponsive || 0, clnHoverResp = cln.hoverElementsResponsive || 0;
  D(srcHoverResp >= 3 && clnHoverResp <= Math.max(0, Math.floor(srcHoverResp * 0.2)), 'med', 'motion_not_reproduced', 'motion_runtime', `${clnHoverResp}/${(cln.hoverSamples||[]).length} clone els respond to hover`, `${srcHoverResp}/${(src.hoverSamples||[]).length} source els respond`, 'add hover states (transform/color/shadow) to buttons, links, cards');
  // TIME-LAPSE: source has a loop animation/gradient at rest; clone is static.
  D((src.timeLapseSelfDiff || 0) > 0.01 && (cln.timeLapseSelfDiff || 0) < (src.timeLapseSelfDiff || 0) * 0.25, 'med', 'motion_not_reproduced', 'motion_runtime', `clone loop-change ${((cln.timeLapseSelfDiff||0)*100).toFixed(2)}%`, `source ${((src.timeLapseSelfDiff||0)*100).toFixed(2)}% at rest (loop anim / animated gradient / marquee)`, 'reproduce loop animation — animated gradient/marquee via custom CSS or looping video/sprite');
  // SCALED full-page diff: below-the-fold layout drift after normalizing width.
  const fullPageDrift = (src.fullPageShot && cln.fullPageShot) ? scaledPixelDiff(src.fullPageShot, cln.fullPageShot) : null;
  D(fullPageDrift !== null && fullPageDrift > 0.45, 'med', 'layout_drift', 'section_completeness', `full-page mismatch ${(fullPageDrift*100).toFixed(0)}% (width-normalized)`, `≤45%`, 'fix below-the-fold layout: section order, spacing, and content that drifts off the first screen');
  cln._fullPageDrift = fullPageDrift; // surfaced into per-vp metrics below

  // per-dimension fidelity (0..1, earned)
  const dims = {
    layout_structure: (sectionR + ratio(sm.headings, cm.headings) + ratio(sm.pageHeight, cm.pageHeight)) / 3,
    pixel_viewport: 1 - viewportPixelDiff(src.viewportShot, cln.viewportShot),
    color: Math.max(0, 1 - bgDist / 180),
    imagery_assets: (ratio(sm.images, cm.images) + ratio(sm.bgImages + sm.canvas + sm.videos, cm.bgImages + cm.canvas + cm.videos)) / 2,
    typography: (sh && ch) ? (ratio(sh.fontSizePx, ch.fontSizePx) + (1 - Math.min(1, Math.abs(parseInt(sh.fontWeight) - parseInt(ch.fontWeight)) / 600))) / 2 : 0.5,
    motion_dynamic: src.scrollMag > 0.18 ? Math.min(1, cln.scrollMag / src.scrollMag) : 1,
  };

  // VISUAL INTEGRITY — catch "complete but broken" (the v5 trap). Check MIN contrast
  // across ALL prominent headings (the green hero was NOT the biggest, so biggest-only
  // missed it), and pill-spam by COMPUTED STYLE (links rendered as filled pills — class
  // names are unreliable). Applied as a HARD CAP on overall in main().
  let minHeadingContrast = 21;
  // Contrast must be checked against each heading's OWN local background (a white
  // heading in a dark section is fine) — comparing to the page-average color
  // false-flagged readable headings (the v11 false-negative).
  for (const h of (cm.headingStyles || [])) { const cc = contrastRatio(parseRGB(h.color), parseRGB(h.bg || 'rgb(255,255,255)') || cln.avgRGB); if (cc < minHeadingContrast) minHeadingContrast = cc; }
  const pillCount = cm.aPills || 0;
  const pillSpam = pillCount > 10 && pillCount > (sm.aPills || 0) * 1.4;
  let integrity = 1;
  if (minHeadingContrast < 3.0) integrity *= 0.35;
  else if (minHeadingContrast < 4.5) integrity *= 0.82;
  if (pillSpam) integrity *= 0.55;
  D(minHeadingContrast < 3.0, 'high', 'broken_visual', 'visual_integrity', `a prominent heading has ${minHeadingContrast.toFixed(1)}:1 contrast vs page background`, `≥3:1 (large text) / 4.5:1`, 'readable heading colors vs background; NEVER blind-apply an extracted/transient computed color (e.g. gradient-text rendering green)');
  D(pillSpam, 'high', 'broken_visual', 'visual_integrity', `${pillCount} links styled as filled pills`, `source ~${sm.aPills || 0}`, 'only style real CTAs as pills; render nav/inline links as plain links');
  dims.visual_integrity = integrity;
  return dims;
}

// VISION GATE — the durable honesty layer. A model literally LOOKS at the render
// and can only LOWER the score (catches "complete but visually broken": no visible
// headline, image-dominated hero, incoherent layout that deterministic checks miss).
// Uses ANTHROPIC_API_KEY if present; otherwise marks the report NOT trustworthy and
// demands a vision review (a human/Claude looking at the saved screenshot).
async function visionGate(out) {
  const key = process.env.ANTHROPIC_API_KEY;
  const srcP = path.join(out, 'source-desktop.png'), clnP = path.join(out, 'clone-desktop.png');
  if (!key) return { status: 'PENDING_NO_KEY' };
  if (!fs.existsSync(clnP) || !fs.existsSync(srcP)) return { status: 'no_screenshot' };
  const b64 = (p) => fs.readFileSync(p).toString('base64');
  const model = process.env.JOIST_VISION_MODEL || 'claude-opus-4-8';
  const prompt = 'You are a BRUTAL website-clone fidelity judge. Image 1 = SOURCE (target). Image 2 = CLONE. Judge how faithfully the CLONE reproduces the SOURCE\'s first screen. Be harsh: a hero with no visible headline, missing nav, wrong/garish colors, or that just shows a big image with no text is a FAILURE (score < 30). Reply with ONLY JSON: {"visual_score":0-100,"headline_visible":true|false,"nav_visible":true|false,"layout_matches":true|false,"issues":["short issue", ...]}';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 700, messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64(srcP) } },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64(clnP) } },
      ] }] }),
    });
    const j = await r.json(); const txt = (j.content && j.content[0] && j.content[0].text) || ''; const m = txt.match(/\{[\s\S]*\}/);
    return m ? { status: 'ok', ...JSON.parse(m[0]) } : { status: 'parse_error', raw: txt.slice(0, 200) };
  } catch (e) { return { status: 'error', error: String(e) }; }
}

(async () => {
  const source = arg('source'), clone = arg('clone');
  const out = arg('out', './grader-out'); const label = arg('label', 'clone');
  if (!source || !clone) { console.error('need --source and --clone'); process.exit(2); }
  // §0 SAFETY GUARD: assert every http(s) URL arg targets a training host (blocks the paused shared host) BEFORE any chromium.goto.
  if (clone && /^https?:/i.test(clone)) assertAllowedBase(clone); if (source && /^https?:/i.test(source)) assertNotBlocked(source); /* source = external read-only; only the paused host is blocked */
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const perVp = {}; const defects = [];
  for (const vp of VIEWPORTS) {
    const s = await capture(browser, source, vp); s.avgRGB = avgRGB(s.viewportShot); s.scrollMag = scrollMagnitude(s.scrollShots);
    const c = await capture(browser, clone, vp); c.avgRGB = avgRGB(c.viewportShot); c.scrollMag = scrollMagnitude(c.scrollShots);
    fs.writeFileSync(path.join(out, `source-${vp.name}.png`), s.viewportShot);
    fs.writeFileSync(path.join(out, `clone-${vp.name}.png`), c.viewportShot);
    const dims = grade(s, c, vp.name, defects);
    perVp[vp.name] = {
      dims, source: s.metrics, clone: c.metrics,
      scrollMag: { source: +s.scrollMag.toFixed(3), clone: +c.scrollMag.toFixed(3) },
      hoverDelta: { source: +s.hoverDelta.toFixed(4), clone: +c.hoverDelta.toFixed(4) },
      hoverSweep: {
        source_samples: s.hoverSamples || [],
        clone_samples: c.hoverSamples || [],
        source_hover_elements_with_response: s.hoverElementsResponsive || 0,
        clone_hover_elements_with_response: c.hoverElementsResponsive || 0,
      },
      timeLapseSelfDiff: { source: +(s.timeLapseSelfDiff || 0).toFixed(4), clone: +(c.timeLapseSelfDiff || 0).toFixed(4) },
      fullPageDrift: (c._fullPageDrift === null || c._fullPageDrift === undefined) ? null : +c._fullPageDrift.toFixed(4),
    };
  }
  await browser.close();
  // overall = weighted blend of desktop dims (mobile contributes to a responsive penalty)
  const W = { layout_structure: 0.28, pixel_viewport: 0.22, color: 0.14, imagery_assets: 0.16, typography: 0.10, motion_dynamic: 0.10 };
  const d = perVp.desktop.dims;
  let overall = 0; for (const k in W) overall += (d[k] ?? 0) * W[k];
  // HARD CAP: a visually broken page (unreadable text / pill-spam) cannot score high
  // regardless of completeness/typography metric wins. This is the anti-self-deception gate.
  overall *= (d.visual_integrity ?? 1);
  // responsive penalty: if mobile layout far worse, dock up to 8 pts
  const mobilePenalty = Math.max(0, (perVp.desktop.dims.layout_structure - perVp.mobile.dims.layout_structure)) * 8;
  const fidelity = Math.max(0, Math.round((overall * 100) - mobilePenalty));
  const report = {
    source, clone, label, graded_at_utc: new Date().toISOString().slice(0, 19) + 'Z',
    fidelity_pct: fidelity,
    dimensions_pct: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Math.round(v * 100)])),
    defects: defects.sort((a, b) => ({ high: 0, med: 1, low: 2 }[a.severity] - { high: 0, med: 1, low: 2 }[b.severity])),
    metrics: perVp,
    note: 'Inverted/evidence-gated: dimensions earned from measured similarity. No uncloneable escape — every gap carries a capability_gap_tag.',
  };
  // VISION GATE — runs last; can only LOWER the score, or flag the run untrustworthy.
  const vision = await visionGate(out);
  report.vision = vision;
  if (vision.status === 'ok' && typeof vision.visual_score === 'number') {
    report.fidelity_measured = report.fidelity_pct;
    report.fidelity_pct = Math.min(report.fidelity_pct, vision.visual_score); // vision caps, never inflates
    report.trustworthy = true;
    if (vision.headline_visible === false) report.defects.unshift({ viewport: 'desktop', severity: 'high', root_cause_tag: 'broken_visual', capability_gap_tag: 'visual_integrity', observed: 'vision: no visible hero headline', expected: 'visible hero headline (like source)', remedy: 'render the hero headline as text, not a full-bleed image' });
    (vision.issues || []).forEach((iss) => report.defects.push({ viewport: 'desktop', severity: 'med', root_cause_tag: 'broken_visual', capability_gap_tag: 'visual_integrity', observed: 'vision: ' + iss, expected: 'matches source', remedy: 'address vision-identified issue' }));
  } else {
    report.trustworthy = false;
    report.vision_review = 'REQUIRED — no automated vision pass (set ANTHROPIC_API_KEY). The measured score is NOT trustworthy until a vision model reviews ' + path.join(out, 'clone-desktop.png');
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ fidelity_pct: report.fidelity_pct, trustworthy: report.trustworthy ?? false, vision: report.vision && report.vision.status, vision_review: report.vision_review || null, dimensions_pct: report.dimensions_pct }, null, 2));
})();
