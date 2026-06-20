#!/usr/bin/env node
/**
 * @purpose reward-features.mjs — LEVER A STAGE 2 feature extractor. Cheap, deterministic, $0/eval features over a
 * (source-section-crop, candidate-render) pair (+ optional Elementor tree), for distilling the vision-judge teacher
 * into a local combiner (knowledge/LEVER_A_REWARD_SCOPE.md). No neural embedding available in this env, so the visual
 * term is multi-scale block-SSIM; the DEFECT term reuses region-judge's deterministic vetoes (which already detect the
 * human-salient failures SSIM is blind to: missing-logo / blank-hero / invisible-heading / unstyled-CTA).
 *
 * features(srcPng, renderPng, treePath?) → {
 *   ssimCoarse, ssimFine,            // multi-scale block-SSIM (visual)
 *   vetoFatal, vetoHigh,             // counts of deterministic fatal/high vetoes (defect detectors)
 *   logoFatal, heroDefect, headingDefect, ctaDefect,  // specific defect flags (0/1)
 *   colorHistDist,                   // L1 distance of downscaled luma histograms (palette/exposure)
 *   inkDelta,                        // |srcInk - cloneInk| (content-density mismatch)
 *   widgets, editability             // native-widget coverage (anti-raster; null if no tree)
 * }
 */
import fs from 'fs';
import { segmentRegions, corroborate, loadPng } from './region-judge.mjs';

function grayDS(img, w, h) { const o = new Float64Array(w * h); const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (Math.min(img.height - 1, (y * sy) | 0) * img.width + Math.min(img.width - 1, (x * sx) | 0)) << 2; o[y * w + x] = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]; } return o; }
// crop/pad render to the source's aspect band (top-aligned) so SSIM compares the same frame.
function bandGray(img, W, H, w, h) { const tmp = { data: new Uint8Array(W * H * 4), width: W, height: H }; tmp.data.fill(8); for (let i = 3; i < tmp.data.length; i += 4) tmp.data[i] = 255;
  const hh = Math.min(H, img.height), ww = Math.min(W, img.width); for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) { const s = (y * img.width + x) << 2, d = (y * W + x) << 2; for (let c = 0; c < 4; c++) tmp.data[d + c] = img.data[s + c]; } return grayDS(tmp, w, h); }
function blockSSIM(A, B, dw, dh, bs) { const c1 = 6.5025, c2 = 58.5225; let tot = 0, n = 0;
  for (let by = 0; by + bs <= dh; by += bs) for (let bx = 0; bx + bs <= dw; bx += bs) { let ma = 0, mb = 0, k = 0;
    for (let y = by; y < by + bs; y++) for (let x = bx; x < bx + bs; x++) { ma += A[y * dw + x]; mb += B[y * dw + x]; k++; } ma /= k; mb /= k;
    let va = 0, vb = 0, cov = 0; for (let y = by; y < by + bs; y++) for (let x = bx; x < bx + bs; x++) { const da = A[y * dw + x] - ma, db = B[y * dw + x] - mb; va += da * da; vb += db * db; cov += da * db; } va /= k; vb /= k; cov /= k;
    tot += ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2)); n++; } return n ? tot / n : 0; }
function lumaHist(img, bins = 16) { const h = new Float64Array(bins); let n = 0; for (let i = 0; i < img.data.length; i += 16) { const l = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]; h[Math.min(bins - 1, (l / 256 * bins) | 0)]++; n++; } for (let i = 0; i < bins; i++) h[i] /= (n || 1); return h; }
function inkFrac(img) { let ink = 0, n = 0; for (let i = 0; i < img.data.length; i += 16) { const l = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]; if (l < 110 || l > 200) ink++; n++; } return n ? ink / n : 0; } // crude content density
function widgetsOf(treePath) { try { const t = JSON.parse(fs.readFileSync(treePath, 'utf8')); const n = Array.isArray(t) ? t : [t]; let w = 0; (function c(a) { a.forEach((x) => { if (x.elType === 'widget') w++; if (x.elements) c(x.elements); }); })(n); return w; } catch { return null; } }

export function features(srcPng, renderPng, treePath = null, { editTarget = 15 } = {}) {
  const src = loadPng(srcPng), ren = loadPng(renderPng);
  const W = src.width, H = src.height;
  const sC = bandGray(src, W, H, 360, 205), rC = bandGray(ren, W, H, 360, 205);
  const sF = bandGray(src, W, H, 540, 308), rF = bandGray(ren, W, H, 540, 308);
  const ssimCoarse = +blockSSIM(sC, rC, 360, 205, 9).toFixed(4);
  const ssimFine = +blockSSIM(sF, rF, 540, 308, 6).toFixed(4);
  // deterministic vetoes over the whole frame (logo/hero/heading/CTA detectors)
  const regions = segmentRegions(src, ren, 8);
  let vetoFatal = 0, vetoHigh = 0, logoFatal = 0, heroDefect = 0, headingDefect = 0, ctaDefect = 0;
  for (const r of regions) { const d = corroborate(r, src, ren); for (const v of d.vetoes) {
    if (v.severity === 'fatal') vetoFatal++; else if (v.severity === 'high') vetoHigh++;
    if (v.fatalClass === 'logo' && v.severity === 'fatal') logoFatal = 1;
    if (v.fatalClass === 'hero') heroDefect = 1; if (v.fatalClass === 'heading') headingDefect = 1; if (v.fatalClass === 'CTA') ctaDefect = 1;
  } }
  const sh = lumaHist(src), rh = lumaHist(ren); let colorHistDist = 0; for (let i = 0; i < sh.length; i++) colorHistDist += Math.abs(sh[i] - rh[i]); colorHistDist = +colorHistDist.toFixed(4);
  const inkDelta = +Math.abs(inkFrac(src) - inkFrac(ren)).toFixed(4);
  const widgets = treePath ? widgetsOf(treePath) : null;
  const editability = widgets == null ? null : +Math.min(1, widgets / editTarget).toFixed(3);
  return { ssimCoarse, ssimFine, vetoFatal, vetoHigh, logoFatal, heroDefect, headingDefect, ctaDefect, colorHistDist, inkDelta, widgets, editability };
}

const IS_MAIN = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (IS_MAIN) { const a = (k) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : null; };
  console.log(JSON.stringify(features(a('source'), a('render'), a('tree')), null, 2)); }
