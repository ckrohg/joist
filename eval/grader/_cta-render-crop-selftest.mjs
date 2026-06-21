#!/usr/bin/env node
// @purpose Offline sensitivity gate for cta-render-crop.mjs (the live crop+score math). Synthetic PNGs only — no
// WordPress, no Playwright. Asserts the metric is SENSITIVE (not just that identical inputs pass): an identical
// crop scores ~1, a shifted/wrong-color crop scores measurably LOWER, out-of-bounds crops clamp. Same anti-Goodhart
// instinct as the acceptor's CONTROL B — a scorer that can't tell right from wrong is worse than no scorer.
// Run: node _cta-render-crop-selftest.mjs  (exit 0 = all pass).

import { PNG } from 'pngjs';
import { cropRegion, resizeNN, ssim, exactFrac, scoreRegion, makeRenderAndCrop } from './cta-render-crop.mjs';

let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; fails.push(name); console.error(`  ✗ ${name} ${extra}`); } };

// ── synthetic page: white bg with a coloured pill rect at (1200,24,130,44) ───────────────────────────────────
function page({ w = 1440, h = 400, pill = { x: 1200, y: 24, w: 130, h: 44, rgb: [108, 71, 255] }, dx = 0, dy = 0, rgb = null } = {}) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = png.data[i + 1] = png.data[i + 2] = 255; png.data[i + 3] = 255; }
  const col = rgb || pill.rgb;
  for (let y = pill.y + dy; y < pill.y + dy + pill.h; y++) for (let x = pill.x + dx; x < pill.x + dx + pill.w; x++) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const di = (y * w + x) * 4; png.data[di] = col[0]; png.data[di + 1] = col[1]; png.data[di + 2] = col[2]; png.data[di + 3] = 255;
  }
  return png;
}
const BOX = { x: 1200, y: 24, w: 130, h: 44 };
const src = page();

// ── 1. identical crop -> SSIM ~1, exact 100% ─────────────────────────────────────────────────────────────────
const idn = scoreRegion(src, BOX, page(), BOX);
ok('identical: SSIM ≥ 0.9999', idn.ssim >= 0.9999, `(ssim=${idn.ssim})`);
ok('identical: exact == 1.0', idn.exact === 1, `(exact=${idn.exact})`);

// ── 2. wrong-colour pill (red instead of purple) -> low score (the CONTROL-B analogue at the pixel level) ────
const wrong = scoreRegion(src, BOX, page({ pill: { x: 1200, y: 24, w: 130, h: 44, rgb: [255, 0, 0] } }), BOX);
ok('wrong-colour: ssim < 0.90 OR exact < 0.5', wrong.ssim < 0.90 || wrong.exact < 0.5, `(ssim=${wrong.ssim} exact=${wrong.exact})`);
ok('wrong-colour: exact drops vs identical', wrong.exact < idn.exact, `(exact=${wrong.exact})`);

// ── 3. shifted pill (clone CTA mis-placed by 20px) measured at the SAME box -> exact < 100% ──────────────────
const shifted = scoreRegion(src, BOX, page({ dx: 20, dy: 8 }), BOX);
ok('shifted: exact < 1.0', shifted.exact < 1, `(exact=${shifted.exact})`);
ok('shifted: exact below identical', shifted.exact < idn.exact, `(exact=${shifted.exact})`);

// ── 4. out-of-bounds crop clamps (never throws, returns a usable region) ─────────────────────────────────────
let threw = false; let oob;
try { oob = scoreRegion(src, { x: 1400, y: 380, w: 400, h: 400 }, page(), { x: 1400, y: 380, w: 400, h: 400 }); } catch { threw = true; }
ok('out-of-bounds: no throw', !threw);
ok('out-of-bounds: clamped crop still scored', !!oob && oob.exact >= 0.99, `(exact=${oob && oob.exact})`);

// ── 5. cropRegion / resizeNN primitives ──────────────────────────────────────────────────────────────────────
const c = cropRegion(src, BOX);
ok('cropRegion size matches box', c.width === 130 && c.height === 44);
const rsz = resizeNN(c, 65, 22);
ok('resizeNN size', rsz.width === 65 && rsz.height === 22);
ok('ssim self == 1 (within eps)', Math.abs(ssim(c, c) - 1) < 1e-6);
ok('exactFrac self == 1', exactFrac(c, c) === 1);

// ── 6. makeRenderAndCrop wires the injected screenshot + measured cloneBox, returns the acceptor's crop shape ──
(async () => {
  const renderAndCrop = makeRenderAndCrop({
    srcCapturePng: src,
    screenshotFn: async () => page(),                        // INJECTED stub (live: a Playwright screenshot)
    prePng: page({ pill: { x: 1200, y: 24, w: 130, h: 44, rgb: [200, 200, 200] } }), // grey "pre-heal" CTA
  });
  const m = { cta: { box: BOX }, widget: { id: 'cta1', box: BOX } };
  const crop = await renderAndCrop(m);
  ok('renderAndCrop returns {ssim,exact,pre,cloneBox}', crop && typeof crop.ssim === 'number' && typeof crop.exact === 'number' && typeof crop.pre === 'number' && !!crop.cloneBox);
  ok('renderAndCrop: post (purple==purple) beats pre (grey vs purple)', (0.5 * crop.ssim + 0.5 * crop.exact) > crop.pre, `(post=${(0.5 * crop.ssim + 0.5 * crop.exact).toFixed(3)} pre=${crop.pre})`);

  console.log(`\ncta-render-crop selftest: ${pass} passed, ${fail} failed` + (fail ? ` [${fails.join('; ')}]` : ''));
  process.exit(fail ? 1 : 0);
})();
