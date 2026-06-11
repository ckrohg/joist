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
 * Usage:
 *   node vision-judge.mjs --source <url> --clone <url> [--widths 1440,1100] [--out dir] [--tileh 900]
 *                         [--runs 1] [--jobs 3] [--model sonnet] [--budget 10] [--max-tiles 40]
 *                         [--manifest-only]
 * Outputs: <out>/w<width>-tile-NN.png, <out>/manifest.json, <out>/results.json (unless --manifest-only).
 * Judge path: `claude -p` per tile (vision via Read tool, --output-format json), strict-parse + 1 retry,
 * model recorded from modelUsage. --manifest-only skips judging (agent-based judging can consume the manifest).
 * Determinism: --runs N>1 judges each tile N times and takes the per-tile MEDIAN score (defects from median run).
 * Alignment: proportional y (clone band = source band * cloneH/sourceH) — degenerates to identity at hRatio 1.
 * Reversible/inert: pure capture+slice+judge; no grader or builder mutation; logged-out contexts; read-only.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync, execFile } from 'child_process';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { settleLazy, crop } from './grade-vision-tiles.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

const SOURCE = arg('source'), CLONE = arg('clone');
const WIDTHS = String(arg('widths', '1440,1100')).split(',').map((s) => parseInt(s, 10)).filter((n) => n > 200);
const OUT = arg('out', '/tmp/vision-judge');
const TILE_H = +arg('tileh', 900);
const RUNS = Math.max(1, +arg('runs', 1));
const JOBS = Math.max(1, +arg('jobs', 3));
const MODEL = arg('model', 'sonnet');
const BUDGET = +arg('budget', 10);          // max total USD across all claude -p calls
const MAX_TILES = +arg('max-tiles', 40);    // per width, safety cap on very tall pages
const MANIFEST_ONLY = has('manifest-only');
const FOLD_Y = 1000;                        // aboveFold = source-band y0 < 1000
const DIVIDER = 14;                         // px magenta divider between source and clone

if (!SOURCE || !CLONE) { console.error('usage: node vision-judge.mjs --source <url> --clone <url> [--widths 1440,1100] [--out dir] [--manifest-only]'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

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

// ── side-by-side composite: [source | magenta divider | clone], labels burned top corners ────────────────────
function composeTile(srcTile, clnTile, width, y0) {
  const h = Math.max(srcTile.height, clnTile.height);
  const w = srcTile.width + DIVIDER + clnTile.width;
  const out = new PNG({ width: w, height: h });
  // dark-gray canvas so height mismatch padding is visible but not mistaken for page content
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 24; out.data[i + 1] = 24; out.data[i + 2] = 24; out.data[i + 3] = 255; }
  const blit = (img, ox) => { for (let r = 0; r < img.height; r++) { const sRow = (r * img.width) << 2; img.data.copy(out.data, ((r * w + ox) << 2), sRow, sRow + (img.width << 2)); } };
  blit(srcTile, 0);
  blit(clnTile, srcTile.width + DIVIDER);
  for (let r = 0; r < h; r++) for (let c = srcTile.width + 2; c < srcTile.width + DIVIDER - 2; c++) { const i = (r * w + c) << 2; out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 220; out.data[i + 3] = 255; }
  drawLabel(out, 6, 6, `SRC ${width}PX Y${y0}`);
  drawLabel(out, srcTile.width + DIVIDER + 6, 6, `CLONE ${width}PX`);
  return out;
}

// ── capture: logged-out FRESH browser per capture (renderer-crash isolation), full-page, settleLazy ──────────
// A renderer crash mid-screenshot ("Target page... has been closed", seen on tailwind@1100 2026-06-10) poisons
// the shared browser; per-capture launch + one retry makes each capture independent and self-healing.
async function captureFull(url, width) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
    try {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
      const p = await ctx.newPage();
      await p.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
      await p.waitForTimeout(2000).catch(() => {});
      await settleLazy(p);
      const buf = await Promise.race([
        p.screenshot({ fullPage: true, timeout: 90000 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('screenshot >120s')), 120000)),
      ]);
      return PNG.sync.read(buf);
    } catch (e) {
      lastErr = e;
      console.error(`[capture] attempt ${attempt + 1} failed for ${url} @${width}: ${e && e.message || e}${attempt === 0 ? ' — retrying with fresh browser' : ''}`);
    } finally {
      await browser.close().catch(() => {});
    }
  }
  throw lastErr;
}

// ── judge: claude -p headless vision call, strict JSON parse + 1 retry ───────────────────────────────────────
const RUBRIC = (tilePath, width, y0, y1) => `You are a pixel-fidelity QA judge. Read the image file ${tilePath} now.
It is a side-by-side composite: LEFT of the vertical magenta divider is the ORIGINAL website; RIGHT is a REBUILD of the same page region (viewport width ${width}px, page band y=${y0}-${y1}; corner labels SRC/CLONE are burned in by the harness — ignore them).
Score the RIGHT side's fidelity to the LEFT, 0-100:
- 100 = indistinguishable at a glance
- 50 = same skeleton but obviously different on inspection
- below 30 = clearly broken or missing content
Enumerate EVERY visible defect of the RIGHT side relative to the LEFT. Each defect is {"desc": "<specific, names the element>", "severity": 1-5 (5 = ruins the page), "category": "missing-content"|"wrong-style"|"layout-broken"|"text-junk"|"imagery-missing"|"chrome-missing"}.
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

function claudeOnce(prompt, timeoutMs = 240000) {
  return new Promise((resolve) => {
    const child = execFile('claude',
      ['-p', prompt, '--model', MODEL, '--output-format', 'json', '--allowedTools', 'Read', '--max-budget-usd', '0.60'],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, cwd: OUT },
      (err, stdout) => {
        if (err && !stdout) return resolve({ ok: false, error: String(err && err.message || err) });
        let outer = null; try { outer = JSON.parse(stdout); } catch {}
        if (!outer) return resolve({ ok: false, error: 'outer JSON parse failed', raw: String(stdout).slice(0, 400) });
        const verdict = extractJson(outer.result);
        const model = outer.modelUsage ? Object.keys(outer.modelUsage)[0] : MODEL;
        const cost = +outer.total_cost_usd || 0;
        if (!verdict || typeof verdict.score !== 'number' || !Array.isArray(verdict.defects)) {
          return resolve({ ok: false, error: 'verdict JSON invalid', cost, model, raw: String(outer.result).slice(0, 400) });
        }
        verdict.score = Math.max(0, Math.min(100, verdict.score));
        verdict.defects = verdict.defects
          .filter((d) => d && d.desc)
          .map((d) => ({ desc: String(d.desc).slice(0, 300), severity: Math.max(1, Math.min(5, +d.severity || 1)), category: String(d.category || 'wrong-style') }));
        resolve({ ok: true, verdict, cost, model });
      });
    child.on('error', () => resolve({ ok: false, error: 'spawn failed' }));
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

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────────────
(async () => {
  const t0 = Date.now();
  if (!process.env.VJ_NO_PKILL) { try { execFileSync('pkill', ['-9', '-f', 'chrome-headless-shell']); } catch {} }
  const tiles = [];
  const perWidthMeta = {};
  {
    for (const width of WIDTHS) {
      console.error(`[capture] ${width}px source...`);
      const src = await captureFull(SOURCE, width);
      console.error(`[capture] ${width}px clone...`);
      const cln = await captureFull(CLONE, width);
      const r = cln.height / src.height; // proportional y alignment (identity at hRatio 1)
      perWidthMeta[width] = { srcHeight: src.height, cloneHeight: cln.height, hRatio: +r.toFixed(3) };
      console.error(`[tile] ${width}px srcH=${src.height} clnH=${cln.height} hRatio=${r.toFixed(3)}`);
      let idx = 0;
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
        tiles.push({ idx, width, yRange: [y0, y0 + h], cloneYRange: [cy0, cy0 + ch], tilePath, aboveFold: y0 < FOLD_Y });
        idx++;
      }
    }
  }

  const manifest = { source: SOURCE, clone: CLONE, widths: WIDTHS, tileH: TILE_H, foldY: FOLD_Y, perWidth: perWidthMeta, tileCount: tiles.length, tiles, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.error(`[manifest] ${tiles.length} tiles -> ${path.join(OUT, 'manifest.json')}`);
  if (MANIFEST_ONLY) { console.log(JSON.stringify({ manifest: path.join(OUT, 'manifest.json'), tileCount: tiles.length, perWidth: perWidthMeta }, null, 2)); return; }

  console.error(`[judge] ${tiles.length} tiles x ${RUNS} run(s), ${JOBS} parallel, model=${MODEL}, budget $${BUDGET}`);
  const judgments = await pool(tiles, JOBS, async (t, i) => {
    const j = await judgeTile(t);
    console.error(`[judge] tile ${t.width}/${String(t.idx).padStart(2, '0')} ${j.judged ? `score=${j.score} defects=${j.defects.length}` : `SKIPPED (${j.reason})`} | spent $${spentUsd.toFixed(2)}`);
    return j;
  });

  // ── aggregate: weighted mean (aboveFold x3) minus sev>=4 penalties; per-width breakdown ───────────────────
  const enriched = tiles.map((t, i) => ({ ...t, ...judgments[i] }));
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

  const modelUsed = enriched.find((t) => t.judged)?.model || MODEL;
  const results = {
    source: SOURCE, clone: CLONE, widths: WIDTHS, runsPerTile: RUNS, model: modelUsed,
    pageScore: overall.pageScore, baseScore: overall.base, severityPenalty: overall.penalty,
    perWidth, tilesJudged: overall.judged, tilesSkipped: overall.skipped,
    costUsd: +spentUsd.toFixed(2), wallSec: Math.round((Date.now() - t0) / 1000),
    defects: allDefects, tiles: enriched.map(({ tilePath, ...t }) => ({ ...t, tilePath })),
  };
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));

  console.log(JSON.stringify({
    pageScore: overall.pageScore, baseScore: overall.base, severityPenalty: overall.penalty,
    perWidth: Object.fromEntries(Object.entries(perWidth).map(([w, v]) => [w, { pageScore: v.pageScore, base: v.base, penalty: v.penalty, hRatio: v.hRatio, judged: v.judged, skipped: v.skipped }])),
    model: modelUsed, costUsd: results.costUsd, wallSec: results.wallSec,
    tilesJudged: overall.judged, tilesSkipped: overall.skipped,
    topDefects: allDefects.slice(0, 12).map((d) => `[sev${d.severity}|${d.category}|${d.width}px y${d.yRange[0]}] ${d.desc}`),
    out: { manifest: path.join(OUT, 'manifest.json'), results: path.join(OUT, 'results.json') },
  }, null, 2));
})().catch((e) => { console.error('VISION-JUDGE FAILED:', e && e.message || e); process.exit(1); });
