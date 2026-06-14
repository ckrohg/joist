/**
 * @purpose Pure, unit-testable background-sampling helper for capture-layout.mjs's modalBg.
 * dominantBoxBg samples the dominant (4-bit-quantized) colour over a box and returns 'rgb(r, g, b)' or null.
 * NEW (2026-06-09): a VERTICAL-DISCONTINUITY GUARD — when the box's top strip and bottom strip have strongly
 * different dominant luma (e.g. a light headline sitting above a dark code-editor panel within one wrapper
 * container), a single modal colour would OVER-PAINT the light part dark. The guard abstains (returns null) so
 * the wrapper container stays transparent; its genuinely-uniform child sub-regions still get their own bgSampled.
 * Reversible: opts.splitGuard === false reproduces the legacy whole-box-only behaviour BYTE-IDENTICALLY.
 * The px accessor `px(x,y) => [r,g,b]` decouples this from pngjs so it is testable with synthetic pixel grids.
 */

// dominant quantized colour over a sub-rect, sampling ≤~50 steps per axis. Returns { key, frac } or null.
function dominantOver(px, x0, x1, ya, yb, sx) {
  const sy = Math.max(2, ((yb - ya) / 50) | 0);
  const buckets = new Map();
  let tot = 0;
  for (let y = ya; y < yb; y += sy) for (let x = x0; x < x1; x += sx) {
    const [r, g, b] = px(x, y);
    const k = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4);
    buckets.set(k, (buckets.get(k) || 0) + 1);
    tot++;
  }
  if (!tot) return null;
  let best = null, bc = 0;
  for (const [k, c] of buckets) if (c > bc) { bc = c; best = k; }
  return best ? { key: best, frac: bc / tot } : null;
}

const keyToRgb = (key) => key.split(',').map((n) => +n * 16 + 8);
const lumaOf = (key) => { const [r, g, b] = keyToRgb(key); return 0.299 * r + 0.587 * g + 0.114 * b; };

/**
 * @param px (x,y) => [r,g,b] pixel accessor in device pixels
 * @param x0,y0,x1,y1 device-pixel box bounds
 * @param opts { splitGuard=true, minSplitH=240, splitLuma=60, minFrac=0.45 }
 * @returns 'rgb(r, g, b)' dominant colour, or null to abstain
 */
export function dominantBoxBg(px, x0, y0, x1, y1, opts = {}) {
  if (x1 - x0 < 16 || y1 - y0 < 16) return null;
  const sx = Math.max(2, ((x1 - x0) / 50) | 0);
  const minFrac = opts.minFrac != null ? opts.minFrac : 0.45;
  const whole = dominantOver(px, x0, x1, y0, y1, sx);
  if (!whole || whole.frac < minFrac) return null;
  const splitGuard = opts.splitGuard !== false;
  const MIN_SPLIT_H = opts.minSplitH || 240, SPLIT_LUMA = opts.splitLuma || 60;
  if (splitGuard && (y1 - y0) >= MIN_SPLIT_H) {
    const band = Math.max(8, ((y1 - y0) * 0.3) | 0);
    const topDom = dominantOver(px, x0, x1, y0, y0 + band, sx);
    const botDom = dominantOver(px, x0, x1, y1 - band, y1, sx);
    // strong top/bottom luma split = the box spans a background discontinuity → abstain (don't over-paint).
    if (topDom && botDom && Math.abs(lumaOf(topDom.key) - lumaOf(botDom.key)) > SPLIT_LUMA) return null;
  }
  const [r, g, b] = keyToRgb(whole.key);
  return `rgb(${r}, ${g}, ${b})`;
}
