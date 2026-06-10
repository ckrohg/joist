/**
 * @purpose grade-vision-tiles.mjs — perceptual (human-aligned) grader STAGE 1: capture source + clone
 * full-page at 1440, slice into an aligned grid, and emit each cell as a SIDE-BY-SIDE [source | clone]
 * composite PNG + a manifest. Vision agents then judge each tile "is this 1:1?" (stage 2, the workflow).
 *
 * WHY: the pixel/geometry grader (grade-sections.mjs) OVERSTATES human fidelity by ~17-26pts — it scores
 * desktop geometry/height/aggregate-paint (which the absolute-pin builder wins) and under-penalizes the
 * high-salience defects a human sees first (wrong logo, invisible headings, broken hero, unstyled CTA,
 * missing imagery). A vision-LLM rating side-by-side tiles is human-aligned BY CONSTRUCTION and localizes
 * each defect to a tile (actionable for the flywheel). User's idea, 2026-06-08.
 *
 * CONTENT-ANCHORED TILING (drift fix, 2026-06-09). DIAGNOSIS: the source full-page SCREENSHOT does not paint
 * at its DOM y. Sites with scroll-triggered parallax/reveal (sticky + translateY, AOS, GSAP) leave content
 * painted HUNDREDS of px off its at-rest DOM y in the settled full-page shot. The CLONE is static Elementor:
 * it paints at the true DOM y. Cutting BOTH at the same fixed pixel-row therefore pairs NON-corresponding
 * content (resend tiles 25/26/27: source band paints ~400px higher, so the source cell is blank-black while
 * the clone cell is the full feature grid → a FALSE "different region" defect). The DOM y of source vs clone
 * is byte-aligned (diagnosis: 87/103 leaves ≤5px); the disagreement is purely SOURCE paint-vs-DOM drift.
 * FIX: anchor each clone band to the CORRESPONDING source band. The clone paints ≈ DOM, so we tile the clone
 * at fixed clone-pixel-y (unchanged). For the SOURCE cell we crop at the y where that same content is actually
 * PAINTED in the source shot — located by sliding the clone's content strip (the real rendered content) over a
 * window of the source shot and taking the best pixel match. This realigns drift-but-present content WITHOUT
 * inventing anything: a genuine void/mismatch (clone missing content) has no match, the map interpolates from
 * neighbours, and the unmatched band still pairs source-content vs clone-void → still scores low (anti-gaming).
 * SELF-TEST: source-vs-source → template==haystack → best offset 0 everywhere → identity map → byte-identical
 * to the fixed cut. Reversible: --anchor off restores the original fixed-pixel-y behaviour exactly.
 * The per-tile RUBRIC + aggregation are untouched: only WHICH source y-band pairs with each clone band changes.
 *
 * Usage: node grade-vision-tiles.mjs --source <url> --clone <url> --out <dir> [--rowh 600] [--cols 2] [--width 1440] [--anchor on|off] [--maxdrift 700]
 * Emits: <dir>/tile-<idx>.png (each = [src-cell | divider | clone-cell]) + <dir>/manifest.json
 * Reversible/inert: pure capture+slice, no grader or build mutation.
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const source = arg('source'), clone = arg('clone'), outDir = arg('out', '/tmp/vtiles');
const W = +arg('width', 1440), ROW_H = +arg('rowh', 600), COLS = +arg('cols', 2), GAP = 28;
const ANCHOR = String(arg('anchor', 'off')).toLowerCase() === 'on'; // content-anchored source remap default OFF -- REVERTED 2026-06-09: real-page A/B showed it REGRESSES (mis-matches ambiguous landmarks on real pages, linear 64->47.5 / resend 61.7->49.9); self-test was insufficient. Default = validated fixed-y; --anchor on re-enables for future refinement
const MAX_DRIFT = +arg('maxdrift', 700); // px window each side to search for a landmark's painted-y in the source shot
// MAIN = invoked as the CLI (not imported by a test for its pure functions). Only then do we require args/launch.
const IS_MAIN = import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('grade-vision-tiles.mjs'));
if (IS_MAIN) {
  if (!source || !clone) { console.error('need --source --clone'); process.exit(2); }
  fs.mkdirSync(outDir, { recursive: true });
}

// Extract DOM text-leaf landmarks with their TRUE at-rest y. We force scroll-reveal/clip content visible and
// scroll to top FIRST (else getBoundingClientRect drops above-fold content), so domY is the unanimated layout y.
// This matches the diagnosis matcher (103 leaves aligned ~0 dy). Returns [{ key, y }] sorted by y.
async function leavesOf(page) {
  try {
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 6; i++) { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; await sleep(80); if (window.scrollY < 4) break; }
    });
    // force-reveal: kill content-visibility skipping + scroll-reveal opacity/transform so layout y is at-rest
    await page.addStyleTag({ content: '*{content-visibility:visible!important;contain-intrinsic-size:auto!important;animation:none!important;transition:none!important}' }).catch(() => {});
    await page.waitForTimeout(150);
  } catch {}
  return await page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const seen = new Set();
    let el = walker.currentNode;
    while ((el = walker.nextNode())) {
      // own-text leaf: an element that contains a direct (non-whitespace) text node
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!ownText) continue;
      const t = clean(el.innerText || el.textContent);
      if (!t || t.length < 2 || t.length > 200) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      const y = r.top + window.scrollY;
      const w = r.width, h = r.height;
      if (w < 2 || h < 2 || h > 400) continue;
      if (y < -50) continue;
      const key = t.slice(0, 80);
      out.push({ key, y: Math.round(y) });
    }
    // de-dup identical (key,y) noise; keep insertion order
    const u = [];
    for (const o of out) { const sig = o.key + '@' + o.y; if (seen.has(sig)) continue; seen.add(sig); u.push(o); }
    u.sort((a, b) => a.y - b.y);
    return u;
  }).catch(() => []);
}

// Robust, idempotent lazy-content trigger (2026-06-09 de-deflation). The original fast settle (800px steps,
// 60ms each) scrolls past `loading=lazy` / IntersectionObserver-gated images too quickly for them to fetch+
// decode+paint before the screenshot, manufacturing FALSE white-space "voids" (see memory
// vision-tiler-lazyload-falsevoid: reactdev community photos render 1:1 yet tiled as white). This version
// scrolls in viewport-sized steps with real dwell time, re-reads the (possibly-growing) page height, WAITS for
// every <img> to actually complete+decode, settles the network, and returns to top — so what we screenshot is
// what a human who has scrolled the page sees. Idempotent: always ends at scrollY 0; running twice is a no-op
// on an already-loaded page. REVERSIBLE: VTILES_NO_LAZY_TRIGGER=1 skips this and uses the legacy fast settle,
// which is byte-identical to the pre-2026-06-09 capture path.
export async function settleLazy(page) {
  // HARD RULE: settleLazy must NEVER throw — a slow/closing page (e.g. vercel) once closed mid-settle and the
  // unguarded page.waitForTimeout below threw an UNCAUGHT rejection that crashed the whole tiler (2026-06-09 fix).
  // Every page.* call is individually .catch()'d AND the whole body is wrapped, so on any page/context-closed
  // error we degrade gracefully and let capture()'s own screenshot step handle the (possibly-closed) page.
  try {
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const docH = () => document.body.scrollHeight;
      // incremental scroll; re-read height each step since lazy content can extend the page. Cap iterations so a
      // genuinely infinite-growth page (rare) can't hang the capture.
      let y = 0, guard = 0;
      while (y <= docH() && guard++ < 400) { window.scrollTo(0, y); await sleep(110); y += 600; }
      window.scrollTo(0, docH()); await sleep(250);
      // wait for in-DOM images to finish (complete + non-zero natural size), bounded
      const pending = () => [...document.images].filter((im) => !(im.complete && im.naturalWidth > 0));
      const deadline = Date.now() + 8000;
      while (pending().length && Date.now() < deadline) await sleep(150);
      // force-decode (paint readiness) of the images we have, best-effort & bounded
      await Promise.all([...document.images].slice(0, 500).map((im) => im.decode && im.decode().catch(() => {})));
      window.scrollTo(0, 0); await sleep(150);
    }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400).catch(() => {});
  } catch { /* page/context closed mid-settle → degrade gracefully (capture() handles the shot) */ }
}

async function capture(ctx, url) {
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(2500);
  if (process.env.VTILES_NO_LAZY_TRIGGER) {
    // LEGACY fast settle (byte-identical to pre-2026-06-09 behaviour) — the reversible OFF path.
    await p.evaluate(async () => { const h = document.body.scrollHeight; for (let y = 0; y < h; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
    await p.waitForTimeout(1200);
  } else {
    // DEFAULT: robust lazy-image trigger so below-fold lazy content paints before the shot (de-deflation).
    await settleLazy(p);
  }
  // SCREENSHOT first, in the settled PAINTED state (this is what a human sees — drift and all). Identical to before.
  const shot = PNG.sync.read(await p.screenshot({ fullPage: true }));
  // THEN extract at-rest DOM landmarks (mutates the page: forces visibility) — only used for anchoring, never re-shot.
  const leaves = ANCHOR ? await leavesOf(p) : [];
  await p.close();
  return { shot, leaves };
}

// crop a sub-rectangle out of a PNG into a fresh PNG
export function crop(src, x, y, w, h) {
  const out = new PNG({ width: w, height: h });
  for (let row = 0; row < h; row++) {
    const sy = y + row;
    for (let col = 0; col < w; col++) {
      const sx = x + col;
      const di = (row * w + col) << 2;
      if (sy >= 0 && sy < src.height && sx < src.width) {
        const si = (sy * src.width + sx) << 2;
        out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1]; out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = 255;
      } else { out.data[di] = 20; out.data[di + 1] = 20; out.data[di + 2] = 20; out.data[di + 3] = 255; }
    }
  }
  return out;
}

// composite [left | gap(magenta divider) | right] into one PNG
function sideBySide(left, right) {
  const h = Math.max(left.height, right.height);
  const w = left.width + GAP + right.width;
  const out = new PNG({ width: w, height: h });
  out.data.fill(255);
  const blit = (img, ox) => { for (let r = 0; r < img.height; r++) for (let c = 0; c < img.width; c++) { const si = (r * img.width + c) << 2; const di = (r * w + (ox + c)) << 2; out.data[di] = img.data[si]; out.data[di + 1] = img.data[si + 1]; out.data[di + 2] = img.data[si + 2]; out.data[di + 3] = 255; } };
  blit(left, 0);
  blit(right, left.width + GAP);
  // magenta divider so the agent unmistakably sees the SOURCE|CLONE split
  for (let r = 0; r < h; r++) for (let c = left.width + 4; c < left.width + GAP - 4; c++) { const di = (r * w + c) << 2; out.data[di] = 255; out.data[di + 1] = 0; out.data[di + 2] = 220; out.data[di + 3] = 255; }
  return out;
}

// ── content-anchored remap (clone-screenshot-y → source-screenshot-y) ───────────────────────────────────────
// Match leaves by normalized text, disambiguating duplicates by nearest at-rest DOM-y, → anchor pairs.
export function matchAnchors(srcLeaves, clnLeaves) {
  const byKeySrc = new Map();
  for (const s of srcLeaves) { if (!byKeySrc.has(s.key)) byKeySrc.set(s.key, []); byKeySrc.get(s.key).push(s); }
  const anchors = [];
  const used = new Map(); // key -> Set of consumed src indices
  for (const c of clnLeaves) {
    const cands = byKeySrc.get(c.key); if (!cands) continue;
    if (!used.has(c.key)) used.set(c.key, new Set());
    const consumed = used.get(c.key);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < cands.length; i++) { if (consumed.has(i)) continue; const d = Math.abs(cands[i].y - c.y); if (d < bestD) { bestD = d; best = i; } }
    if (best < 0) continue;
    consumed.add(best);
    // only trust anchors whose at-rest DOM y agrees (the diagnosis invariant: source/clone DOM y align ~0).
    // a >120px DOM-y disagreement = the repeated-instance mis-pick noise; drop it.
    if (bestD > 120) continue;
    anchors.push({ srcDomY: cands[best].y, clnDomY: c.y });
  }
  anchors.sort((a, b) => a.clnDomY - b.clnDomY);
  return anchors;
}

// Locate a landmark's PAINTED y in the source shot by sliding the clone's content strip (clone paints ≈ DOM,
// so the clone strip at clnDomY is the REAL rendered content) over a ±MAX_DRIFT window of the source shot at
// srcDomY, picking the vertical offset that minimizes per-row mean-abs pixel difference. Returns refined
// source painted-y, or null when the match is too weak / off the page (then we fall back to the DOM-y anchor).
export function refineSourcePaintedY(srcShot, clnShot, srcDomY, clnDomY) {
  const STRIP = 24;            // px-tall content strip to correlate
  const COL_STEP = 6;          // sample every Nth column (speed)
  const cy = clnDomY;
  if (cy + STRIP > clnShot.height || cy < 0) return null;
  const cw = Math.min(srcShot.width, clnShot.width, W);
  // pull the clone reference strip rows (grayscale) once
  const ref = new Float64Array(STRIP * Math.ceil(cw / COL_STEP));
  let refEnergy = 0, k = 0;
  for (let r = 0; r < STRIP; r++) {
    const ry = cy + r;
    for (let x = 0; x < cw; x += COL_STEP) {
      const i = ((ry * clnShot.width + x) << 2);
      const g = (clnShot.data[i] * 0.299 + clnShot.data[i + 1] * 0.587 + clnShot.data[i + 2] * 0.114);
      ref[k++] = g; refEnergy += Math.abs(g - 128);
    }
  }
  if (refEnergy < STRIP * 4) return null; // near-blank reference (e.g. clone-side void) → can't anchor on emptiness
  const n = STRIP * Math.ceil(cw / COL_STEP);
  // PURE best-match (lowest mean-abs pixel error) over the window. expected = srcDomY (the matched source
  // instance, == clone DOM-y per the diagnosis invariant). We do NOT bias toward expected: at a genuinely
  // drifted band the source content is HUNDREDS of px from expected, and a distance bias would wrongly pull the
  // match back toward the un-drifted DOM position (it measurably suppressed the resend drift correction). The
  // search must follow the pixels. A small tie-break toward expected (EPS) only nudges exact ties.
  const expected = srcDomY;
  const errAt = (oy) => { let err = 0, kk = 0; for (let r = 0; r < STRIP; r++) { const ry = oy + r; for (let x = 0; x < cw; x += COL_STEP) { const i = ((ry * srcShot.width + x) << 2); const g = (srcShot.data[i] * 0.299 + srcShot.data[i + 1] * 0.587 + srcShot.data[i + 2] * 0.114); err += Math.abs(g - ref[kk++]); } } return err / n; };
  const lo = Math.max(0, srcDomY - MAX_DRIFT), hi = Math.min(srcShot.height - STRIP, srcDomY + MAX_DRIFT);
  // EXACT-MATCH SHORT-CIRCUIT: if the source already paints this content at the expected y (errAt(expected) ≈ 0),
  // there is NO drift here — return expected verbatim. Makes source-vs-source (and any no-drift band) an EXACT
  // identity regardless of repeated-texture decoys. It only fires when content truly sits at expected, so it
  // NEVER hides real drift (a drifted band has a blank/different source at expected → high errAt → falls through).
  if (expected >= lo && expected <= hi && errAt(expected) <= 1.0) return expected;
  let bestOff = 0, bestErr = Infinity, best2 = Infinity;
  // evaluate the EXACT expected y first (off the 2px grid) so a perfect self-match is always a candidate, and a
  // microscopic tie-break (EPS·distance) favours expected ONLY when two positions are pixel-indistinguishable.
  const EPS = 1e-4;
  const cand = []; if (expected >= lo && expected <= hi) cand.push(expected);
  for (let oy = lo; oy <= hi; oy += 2) cand.push(oy);
  for (const oy of cand) {
    const meanE = errAt(oy);
    const score = meanE + EPS * Math.abs(oy - expected);
    if (score < bestErr) { best2 = bestErr; bestErr = score; bestOff = oy; }
    else if (score < best2) { best2 = score; }
  }
  bestErr = errAt(bestOff); // report the true (un-tie-broken) residual for the rejection tests
  const meanErr = bestErr;
  // reject weak matches: too-high residual, or no clear winner (best ≈ runner-up → ambiguous/repeated texture).
  // A rejected anchor falls back to its DOM-y in the caller (honest: the un-drifted layout position), so it never
  // invents a displaced alignment when the pixel evidence is ambiguous.
  if (meanErr > 46) return null;
  if (best2 < Infinity && bestErr > 0 && best2 / Math.max(bestErr, 0.5) < 1.04 && meanErr > 24) return null;
  return bestOff;
}

// Build a monotone piecewise-linear map cloneScreenshotY -> sourceScreenshotY from anchor pairs.
// Enforce non-decreasing source y (band order can't cross). Endpoints extrapolate with the nearest segment's
// slope, clamped to identity-ish so we never run off the source page.
export function buildMap(pairs, srcH, clnH) {
  const xs = [], ys = [];
  let lastY = -Infinity;
  for (const p of pairs.sort((a, b) => a.cln - b.cln)) {
    let sy = p.src; if (sy < lastY) sy = lastY; // monotone clamp
    if (xs.length && p.cln === xs[xs.length - 1]) { ys[ys.length - 1] = sy; lastY = sy; continue; }
    xs.push(p.cln); ys.push(sy); lastY = sy;
  }
  if (xs.length === 0) return (cy) => cy; // no anchors → identity (degrades to fixed-y; honest fallback)
  return (cy) => {
    if (cy <= xs[0]) { // extrapolate before first anchor
      if (xs.length >= 2) { const m = (ys[1] - ys[0]) / Math.max(1, xs[1] - xs[0]); return ys[0] + m * (cy - xs[0]); }
      return ys[0] + (cy - xs[0]);
    }
    if (cy >= xs[xs.length - 1]) {
      const n = xs.length;
      if (n >= 2) { const m = (ys[n - 1] - ys[n - 2]) / Math.max(1, xs[n - 1] - xs[n - 2]); return ys[n - 1] + m * (cy - xs[n - 1]); }
      return ys[n - 1] + (cy - xs[n - 1]);
    }
    // binary search the bracketing segment
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= cy) lo = mid; else hi = mid; }
    const t = (cy - xs[lo]) / Math.max(1, xs[hi] - xs[lo]);
    return ys[lo] + t * (ys[hi] - ys[lo]);
  };
}

if (IS_MAIN) (async () => {
  // Wrap the whole run so a slow/closing page (e.g. a capture killed by an outer timeout, or a site that closes
  // the page mid-shot) fails CLEANLY with a non-zero exit + message instead of an uncaught promise rejection
  // (the 2026-06-09 robustness fix — pairs with settleLazy's internal guards). browser is always closed.
  let browser;
  try {
  browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const { shot: src, leaves: srcLeaves } = await capture(ctx, source);
  const { shot: cln, leaves: clnLeaves } = await capture(ctx, clone);

  const H = Math.min(src.height, cln.height);
  const colW = Math.floor(W / COLS);

  // anchoring: clone-screenshot-y -> source-screenshot-y map
  const MIN_ANCHORS = 4; // under-determined maps over-extrapolate; require solid evidence before remapping (else identity)
  let srcYof = (cy) => cy; // identity (== original fixed-y) by default / when --anchor off / too-few anchors
  let anchorMeta = { enabled: ANCHOR, srcLeaves: srcLeaves.length, cloneLeaves: clnLeaves.length, matched: 0, refined: 0, applied: false, minAnchors: MIN_ANCHORS, maxDrift: MAX_DRIFT };
  if (ANCHOR && srcLeaves.length && clnLeaves.length) {
    const anchors = matchAnchors(srcLeaves, clnLeaves);
    anchorMeta.matched = anchors.length;
    const pairs = [];
    for (const a of anchors) {
      const sp = refineSourcePaintedY(src, cln, a.srcDomY, a.clnDomY);
      // use the pixel-refined painted-y when found; else fall back to the (DOM-aligned) source DOM y for that band
      pairs.push({ cln: a.clnDomY, src: sp == null ? a.srcDomY : sp });
      if (sp != null) anchorMeta.refined++;
    }
    // only apply the remap with enough anchors to constrain it; otherwise stay identity (conservative / honest)
    if (pairs.length >= MIN_ANCHORS) { srcYof = buildMap(pairs, src.height, cln.height); anchorMeta.applied = true; }
  }

  const tiles = [];
  let idx = 0;
  for (let y0 = 0; y0 < H; y0 += ROW_H) {
    const h = Math.min(ROW_H, H - y0);
    if (h < 40) break;
    // CLONE band = fixed pixel-y (clone paints ≈ DOM). SOURCE band = the corresponding painted band.
    const srcY0 = Math.round(srcYof(y0));
    for (let c = 0; c < COLS; c++) {
      const x0 = c * colW;
      const w = (c === COLS - 1) ? (W - x0) : colW;
      const sTile = crop(src, x0, srcY0, w, h);
      const cTile = crop(cln, x0, y0, w, h);
      const comp = sideBySide(sTile, cTile);
      const file = path.join(outDir, `tile-${String(idx).padStart(2, '0')}.png`);
      fs.writeFileSync(file, PNG.sync.write(comp));
      tiles.push({ idx, file, y0, y1: y0 + h, x0, x1: x0 + w, areaFrac: +((w * h) / (W * H)).toFixed(4), srcY0, srcY1: srcY0 + h });
      idx++;
    }
  }
  const manifest = { source, clone, width: W, rowH: ROW_H, cols: COLS, srcHeight: src.height, cloneHeight: cln.height, gradedHeight: H, heightRatio: +(cln.height / src.height).toFixed(3), tileCount: tiles.length, anchored: ANCHOR, anchorMeta, tiles };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`VTILES: ${tiles.length} tiles -> ${outDir} | srcH ${src.height} cloneH ${cln.height} (hRatio ${manifest.heightRatio}) | anchor=${ANCHOR ? 'ON' : 'off'} matched=${anchorMeta.matched} refined=${anchorMeta.refined} | layout = SOURCE | magenta-divider | CLONE`);
  } catch (e) {
    console.error(`VTILES FAILED (${source} → ${clone}): ${e && e.message ? e.message : e}`);
    process.exitCode = 1;
  } finally {
    try { await browser?.close(); } catch {}
  }
})();
