#!/usr/bin/env node
/**
 * @purpose _region-judge-gametest.mjs — the CAUSAL, NON-NEGOTIABLE injection gate for region-judge.mjs.
 * Take a known-decent (or at least non-fatal) BASE pair, then programmatically MUTATE the CLONE PNG via pngjs to
 * inject each of the four fatal-class defects the old grader was blind to, and ASSERT the judge's pageScore drops
 * by >= MIN_DROP (default 30) for each mutation:
 *   (i)   BLANK THE LOGO region   -> paint the header top-left cell to its background color (logo gone).
 *   (ii)  PAINT A HEADING to bg   -> recolor the hero heading text to ~its own local background (contrast -> ~1:1,
 *         invisible heading) WITHOUT removing the glyph geometry (so it is a true invisible-text defect, not a
 *         blank region — this is the subtle one the old grader could not see).
 *   (iii) BLANK A HERO band       -> paint the whole hero band to a flat background color (blank/broken hero).
 * A judge that does NOT drop >= MIN_DROP on any of these shares the old grader's blind spot and is INVALID.
 *
 * Two modes:
 *   --no-vision  : exercises ONLY the deterministic corroboration core (fast, hermetic, no claude). The vetoes
 *                  (logo-blank / heading-painted-to-bg / hero-blank) are the CAUSAL backstops and MUST pass here.
 *   (default)    : FULL judge (vision + det). Reflects production. Slower (claude calls).
 * The deterministic-core run is the binding gate (causal + reproducible without network). The orchestrator
 * re-executes this. Builder does NOT self-bless — numbers are printed as measured; exit 1 on any failure.
 *
 * BASE = a KNOWN-GOOD clone. By default we use the pair's SOURCE png AS its own clone (identity pair) so the
 * baseline is unambiguously high (~100, zero fatals) and every drop is attributable PURELY to the injected
 * defect — not to the pre-existing flaws of a real (already-degraded) clone. (linear's real clone, P16, is itself
 * human-rated 2 and the vision judge scores it ~4, so it is NOT a valid mutation base: you cannot drop 30 from 4.)
 * Pass --real-base to instead mutate the pair's actual clone (only meaningful for a genuinely good clone).
 *
 * Reads existing screenshots only; writes mutated copies to a temp out dir; renders NOTHING.
 * Usage: node _region-judge-gametest.mjs [--base P16] [--real-base] [--no-vision] [--min-drop 30] [--out /tmp/rj-gt]
 */
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { judgePair, segmentRegions, loadPng } from './region-judge.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);

const REPO = path.resolve(path.join(import.meta.dirname, '..', '..'));
const KEY = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'calibration', 'GRADER_KEY.json'), 'utf8'));
const BASE_ID = arg('base', 'P16');           // linear ATF: cleanest band, a fair non-degenerate base to mutate
const MIN_DROP = +arg('min-drop', 30);
const VISION = !has('no-vision');
const OUT = arg('out', '/tmp/rj-gametest');
const pairOf = (id) => { const p = KEY.pairs.find(x => x.pair_id === id); if (!p) throw new Error(`no pair ${id}`); return { src: path.join(REPO, p.source_img), cln: path.join(REPO, p.clone_img) }; };

// region rects come straight from the judge's own segmentation so the mutation lands EXACTLY where the judge looks.
function rectsFor(srcPng, clnPng) {
  const regions = segmentRegions(loadPng(srcPng), loadPng(clnPng));
  const find = (pred) => regions.find(pred);
  return {
    logo: find(r => r.fatalProbe && r.fatalProbe.includes('logo'))?.cRect,
    hero: find(r => r.role === 'hero')?.cRect,
  };
}
// dominant background color (modal per-channel over a coarse grid) of a clone rect — what to paint with.
function bgColor(img, [x0, y0, x1, y1]) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(img.width, x1 | 0); y1 = Math.min(img.height, y1 | 0);
  const H = [new Array(16).fill(0), new Array(16).fill(0), new Array(16).fill(0)];
  for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) { const i = (y * img.width + x) << 2; for (let c = 0; c < 3; c++) H[c][Math.min(15, img.data[i + c] / 16 | 0)]++; }
  return H.map(h => { let bi = 0; for (let i = 1; i < 16; i++) if (h[i] > h[bi]) bi = i; return bi * 16 + 8; });
}
function paintRect(img, [x0, y0, x1, y1], [r, g, b]) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(img.width, x1 | 0); y1 = Math.min(img.height, y1 | 0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * img.width + x) << 2; img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255; }
}
// invisible-heading mutation: recolor only the INK pixels (those far from bg) of a band TO the bg color, leaving
// non-ink (already background) untouched. Result: glyph geometry positions exist but text ~= bg => contrast ~1:1.
function paintInkToBg(img, [x0, y0, x1, y1]) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(img.width, x1 | 0); y1 = Math.min(img.height, y1 | 0);
  const [br, bg, bb] = bgColor(img, [x0, y0, x1, y1]);
  const bL = 0.299 * br + 0.587 * bg + 0.114 * bb;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * img.width + x) << 2;
    const L = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    if (Math.abs(L - bL) > 30) { img.data[i] = br; img.data[i + 1] = bg; img.data[i + 2] = bb; } // ink -> bg
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const pair = pairOf(BASE_ID);
  const src = pair.src;
  // KNOWN-GOOD base: src-as-its-own-clone (identity) unless --real-base. Identity => baseline ~100, so a >=30 drop
  // is attributable purely to the injected defect (a real degraded clone cannot serve as a causal mutation base).
  const cln = has('real-base') ? pair.cln : pair.src;
  const rects = rectsFor(src, cln);
  console.error(`[gametest] base=${BASE_ID} cloneBase=${has('real-base') ? 'REAL-CLONE' : 'identity(src=clone)'} vision=${VISION} min-drop=${MIN_DROP}`);
  console.error(`[gametest] rects logo=${JSON.stringify(rects.logo)} hero=${JSON.stringify(rects.hero)}`);

  // BASELINE
  const baseRes = await judgePair({ sourcePng: src, clonePng: cln, outDir: path.join(OUT, 'base'), vision: VISION, blind: false, jobs: 3 });
  const base = baseRes.score;
  console.error(`[gametest] BASELINE score = ${base}`);

  const mutate = (label, fn) => {
    const img = loadPng(cln);
    fn(img);
    const out = path.join(OUT, `clone-${label}.png`);
    fs.writeFileSync(out, PNG.sync.write(img));
    return out;
  };
  const logoCln = mutate('logoblank', img => paintRect(img, rects.logo, bgColor(img, rects.logo)));
  const headCln = mutate('headinginvis', img => paintInkToBg(img, rects.hero));
  const heroCln = mutate('heroblank', img => paintRect(img, rects.hero, bgColor(img, rects.hero)));

  const cases = [
    { name: 'blank-logo', clone: logoCln, expectFatal: 'logo' },
    { name: 'invisible-heading', clone: headCln, expectFatal: 'heading' },
    { name: 'blank-hero', clone: heroCln, expectFatal: 'hero' },
  ];

  const rows = [];
  for (const c of cases) {
    const r = await judgePair({ sourcePng: src, clonePng: c.clone, outDir: path.join(OUT, c.name), vision: VISION, blind: false, jobs: 3 });
    const drop = base - r.score;
    const pass = drop >= MIN_DROP;
    rows.push({ mutation: c.name, baseScore: base, mutatedScore: r.score, drop, minDrop: MIN_DROP, pass, fatalClasses: r.fatalClasses, expectFatal: c.expectFatal, fatalDetected: r.fatalClasses.includes(c.expectFatal) });
    console.error(`[gametest] ${c.name}: ${base} -> ${r.score} (drop ${drop}) ${pass ? 'PASS' : 'FAIL'} | fatals=${r.fatalClasses.join(',')}`);
  }

  const allPass = rows.every(r => r.pass);
  const out = { base: BASE_ID, vision: VISION, minDrop: MIN_DROP, baselineScore: base, cases: rows, gate: allPass ? 'PASS' : 'FAIL' };
  console.log(JSON.stringify(out, null, 2));
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('GAMETEST FAILED:', e && e.stack || e); process.exit(2); });
