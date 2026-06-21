// @purpose The live CONFIRM gate for cta-heal's acceptor: crop the patched clone CTA region from a fresh
// screenshot, crop the source CTA region from the FROZEN capture, score them (0.5·SSIM + 0.5·exact). This is the
// "rendered confirm" row in acceptCTA — it catches the settings-vs-render gap (a kses-stripped style, a fill that
// didn't paint) that the deterministic ΔE-on-settings gate cannot see. The Playwright screenshot is INJECTED
// (screenshotFn), so the crop + scoring MATH is fully unit-tested offline with synthetic PNGs (no WordPress).
// Only the real screenshot needs WP; swap the stub for a live capture on WP-return and the tested math is unchanged.

import { PNG } from 'pngjs';

// ── crop a clamped rectangular region out of a PNG (out-of-bounds is clamped, never throws) ──────────────────
export function cropRegion(png, box) {
  const x0 = Math.max(0, Math.round(box.x)), y0 = Math.max(0, Math.round(box.y));
  const x1 = Math.min(png.width, Math.round(box.x + box.w)), y1 = Math.min(png.height, Math.round(box.y + box.h));
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = ((y0 + y) * png.width + (x0 + x)) * 4, di = (y * w + x) * 4;
    out.data[di] = png.data[si]; out.data[di + 1] = png.data[si + 1]; out.data[di + 2] = png.data[si + 2]; out.data[di + 3] = png.data[si + 3];
  }
  return out;
}

// ── nearest-neighbour resize so two differently-sized crops can be compared at a common grid ──────────────────
export function resizeNN(png, W, H) {
  const out = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.min(png.width - 1, Math.floor((x * png.width) / W));
    const sy = Math.min(png.height - 1, Math.floor((y * png.height) / H));
    const si = (sy * png.width + sx) * 4, di = (y * W + x) * 4;
    out.data[di] = png.data[si]; out.data[di + 1] = png.data[si + 1]; out.data[di + 2] = png.data[si + 2]; out.data[di + 3] = png.data[si + 3];
  }
  return out;
}

const gray = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

// ── windowed SSIM over two EQUAL-size PNGs (same 8×8 kernel/constants as veto-detectors.ssimCrop) ────────────
export function ssim(a, b) {
  const win = 8, C1 = 6.5, C2 = 58.5;
  const W = Math.min(a.width, b.width), H = Math.min(a.height, b.height);
  let tot = 0, n = 0;
  for (let by = 0; by + win <= H; by += win) for (let bx = 0; bx + win <= W; bx += win) {
    let ma = 0, mb = 0;
    for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const ia = ((by + y) * a.width + bx + x) * 4, ib = ((by + y) * b.width + bx + x) * 4; ma += gray(a.data, ia); mb += gray(b.data, ib); }
    const N = win * win; ma /= N; mb /= N;
    let va = 0, vb = 0, cov = 0;
    for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const ia = ((by + y) * a.width + bx + x) * 4, ib = ((by + y) * b.width + bx + x) * 4; const da = gray(a.data, ia) - ma, db = gray(b.data, ib) - mb; va += da * da; vb += db * db; cov += da * db; }
    va /= N - 1; vb /= N - 1; cov /= N - 1;
    tot += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
  }
  // crops smaller than one window: fall back to whole-crop mean-only SSIM (still in [-1,1], deterministic)
  if (!n) { let ma = 0, mb = 0; const N = W * H; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { ma += gray(a.data, (y * a.width + x) * 4); mb += gray(b.data, (y * b.width + x) * 4); } ma /= N; mb /= N; return (2 * ma * mb + C1) / (ma * ma + mb * mb + C1); }
  return tot / n;
}

// ── exact-pixel fraction over two EQUAL-size PNGs: share of pixels within a small per-channel tolerance ───────
export function exactFrac(a, b, tol = 12) {
  const W = Math.min(a.width, b.width), H = Math.min(a.height, b.height);
  let hit = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4;
    if (Math.abs(a.data[ia] - b.data[ib]) <= tol && Math.abs(a.data[ia + 1] - b.data[ib + 1]) <= tol && Math.abs(a.data[ia + 2] - b.data[ib + 2]) <= tol) hit++;
    n++;
  }
  return n ? hit / n : 0;
}

// ── score two CTA regions: crop both, resize to a common grid, return {ssim, exact} ──────────────────────────
export function scoreRegion(srcPng, srcBox, clonePng, cloneBox) {
  const sc = cropRegion(srcPng, srcBox), cc = cropRegion(clonePng, cloneBox);
  const W = Math.max(8, Math.min(sc.width, cc.width)), H = Math.max(8, Math.min(sc.height, cc.height));
  const scr = resizeNN(sc, W, H), ccr = resizeNN(cc, W, H);
  return { ssim: +ssim(scr, ccr).toFixed(4), exact: +exactFrac(scr, ccr).toFixed(4) };
}

// ── factory: build the renderAndCrop fn cta-heal's orchestrator expects. screenshotFn() -> PNG (INJECTED, the
// only WP-dependent piece). srcCapturePng = the frozen source full-page capture; measureCloneBox(m) -> rendered
// bbox of the patched clone CTA (defaults to the widget's offset box). Returns (m) -> {ssim, exact, pre, cloneBox}.
export function makeRenderAndCrop({ srcCapturePng, screenshotFn, measureCloneBox = null, prePng = null } = {}) {
  return async function renderAndCrop(m) {
    const cloneShot = await screenshotFn(m);
    const cloneBox = (measureCloneBox ? await measureCloneBox(m, cloneShot) : null) || m.widget.box;
    const srcBox = m.cta.box;
    const { ssim: s, exact: e } = scoreRegion(srcCapturePng, srcBox, cloneShot, cloneBox);
    let pre;
    if (prePng) { const p = scoreRegion(srcCapturePng, srcBox, prePng, cloneBox); pre = +(0.5 * p.ssim + 0.5 * p.exact).toFixed(4); }
    return { ssim: s, exact: e, pre, cloneBox };
  };
}
