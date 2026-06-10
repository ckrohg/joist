// @purpose adversarial-critic harness for the media-identity dim (pure, in-memory, no network/WP).
// Attacks: A1 stretch-one-real-image, A2 LQIP/blur at pooling resolution, A3 decorative-gradient presence
// stuffing, A4 full-band source-screenshot raster, F1 bg-div false-low (pixel-perfect, no <img>), F2 drift false-low.
import { PNG } from 'pngjs';
import { mediaIdentityBand, mediaCropId, cropEnergy } from './grade-sections.mjs';

const mk = (w, h, rgb) => { const p = new PNG({ width: w, height: h }); for (let i = 0; i < w * h; i++) { p.data[i * 4] = rgb[0]; p.data[i * 4 + 1] = rgb[1]; p.data[i * 4 + 2] = rgb[2]; p.data[i * 4 + 3] = 255; } return p; };
const px = (img, x, y, rgb) => { if (x < 0 || y < 0 || x >= img.width || y >= img.height) return; const i = (y * img.width + x) * 4; img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255; };
const get = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const checker = (img, x, y, w, h, cell, a, b) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(img, xx, yy, (Math.floor((xx - x) / cell) + Math.floor((yy - y) / cell)) % 2 === 0 ? a : b); };
// a "photo": checker + diagonal ramp so it has real high-frequency AND low-frequency structure
const photo = (img, x, y, w, h) => { for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const base = (Math.floor(xx / 24) + Math.floor(yy / 24)) % 2 === 0 ? [225, 140, 40] : [30, 70, 180]; const ramp = Math.round(60 * (xx / w)); px(img, x + xx, y + yy, [Math.min(255, base[0] + ramp), base[1], Math.min(255, base[2] + Math.round(40 * yy / h))]); } };
const dup = (img) => { const p = new PNG({ width: img.width, height: img.height }); img.data.copy(p.data); return p; };
const leaf = (x, y, w, h, tag = 'img') => ({ x, y, w, h, area: w * h, tag });
// nearest-neighbor copy of src region -> dst region (arbitrary scale, incl. anisotropic)
const blit = (srcImg, sx, sy, sw, sh, dstImg, dx, dy, dw, dh) => { for (let yy = 0; yy < dh; yy++) for (let xx = 0; xx < dw; xx++) { const ox = sx + Math.min(sw - 1, Math.floor(xx * sw / dw)); const oy = sy + Math.min(sh - 1, Math.floor(yy * sh / dh)); px(dstImg, dx + xx, dy + yy, get(srcImg, ox, oy)); } };
// box-blur via downsample-to-grid then upsample (LQIP simulation at gw x gh)
const lqip = (srcImg, sx, sy, sw, sh, gw, gh, dstImg, dx, dy) => {
  const cells = Array.from({ length: gw * gh }, () => [0, 0, 0, 0]);
  for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) { const gx = Math.min(gw - 1, Math.floor(xx * gw / sw)), gy = Math.min(gh - 1, Math.floor(yy * gh / sh)); const c = get(srcImg, sx + xx, sy + yy); const cc = cells[gy * gw + gx]; cc[0] += c[0]; cc[1] += c[1]; cc[2] += c[2]; cc[3]++; }
  for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) { const gx = Math.min(gw - 1, Math.floor(xx * gw / sw)), gy = Math.min(gh - 1, Math.floor(yy * gh / sh)); const cc = cells[gy * gw + gx]; px(dstImg, dx + xx, dy + yy, [cc[0] / cc[3], cc[1] / cc[3], cc[2] / cc[3]]); }
};
const vgrad = (img, x, y, w, h) => { for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) px(img, x + xx, y + yy, [Math.round(255 * yy / h), Math.round(40 + 180 * yy / h), 200]); };

const W = 1440, H = 400;

// ---------- A1: stretch ONE real image across the band ----------
{
  const src = mk(W, H, [248, 248, 250]); photo(src, 480, 60, 480, 280);
  const srcMedia = [leaf(480, 60, 480, 280)];
  const cln = mk(W, H, [248, 248, 250]); blit(src, 480, 60, 480, 280, cln, 0, 20, 1440, 360); // gross anisotropic stretch
  const clnMedia = [leaf(0, 20, 1440, 360)];
  const r = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia, cloneMedia: clnMedia, y0: 0, y1: H });
  console.log('A1 STRETCH  (1 real img anisotropically stretched 480x280 -> 1440x360):', JSON.stringify({ M: r.score, id: r.identity, pres: r.presence, leaves: r.leaves }));
}

// ---------- A2: LQIP / blur at pooling resolution (clone paints ONLY a 9x8-cell blur of the image) ----------
{
  const src = mk(W, H, [248, 248, 250]); photo(src, 480, 60, 480, 280);
  const srcMedia = [leaf(480, 60, 480, 280)];
  const cln = mk(W, H, [248, 248, 250]); lqip(src, 480, 60, 480, 280, 9, 8, cln, 480, 60);
  const r = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia, cloneMedia: srcMedia, y0: 0, y1: H });
  // and an even cruder 4x4 blur
  const cln2 = mk(W, H, [248, 248, 250]); lqip(src, 480, 60, 480, 280, 4, 4, cln2, 480, 60);
  const r2 = mediaIdentityBand({ srcShot: src, cloneShot: cln2, srcMedia, cloneMedia: srcMedia, y0: 0, y1: H });
  console.log('A2 LQIP 9x8 (blurred placeholder, real image never loads):', JSON.stringify({ M: r.score, id: r.identity }));
  console.log('A2 LQIP 4x4 (cruder blur):', JSON.stringify({ M: r2.score, id: r2.identity }));
}

// ---------- A3: decorative gradient stuffing (NO source imagery reproduced) ----------
{
  const src = mk(W, H, [248, 248, 250]); photo(src, 480, 60, 480, 280);
  const srcMedia = [leaf(480, 60, 480, 280)];
  const honest = mk(W, H, [248, 248, 250]); // imagery simply omitted
  const rHonest = mediaIdentityBand({ srcShot: src, cloneShot: honest, srcMedia, cloneMedia: [], y0: 0, y1: H });
  const cln = mk(W, H, [248, 248, 250]); vgrad(cln, 480, 60, 480, 280); // decorative svg gradient, same box
  const rGame = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia, cloneMedia: [leaf(480, 60, 480, 280, 'svg')], y0: 0, y1: H });
  // variant: gradient NOT overlapping the source box (e.g. shape divider elsewhere in the band) but same area
  const cln2 = mk(W, H, [248, 248, 250]); vgrad(cln2, 0, 100, 480, 280);
  const rGame2 = mediaIdentityBand({ srcShot: src, cloneShot: cln2, srcMedia, cloneMedia: [leaf(0, 100, 480, 280, 'svg')], y0: 0, y1: H });
  const fold = (m) => m == null ? 1 : 0.45 + 0.55 * m;
  console.log('A3 HONEST-OMIT:', JSON.stringify({ M: rHonest.score, foldMult: +fold(rHonest.score).toFixed(3) }));
  console.log('A3 GRADIENT-OVERLAP (svg gradient at the photo box):', JSON.stringify({ M: rGame.score, id: rGame.identity, pres: rGame.presence, foldMult: +fold(rGame.score).toFixed(3) }));
  console.log('A3 GRADIENT-ELSEWHERE (shape divider far from photo):', JSON.stringify({ M: rGame2.score, id: rGame2.identity, pres: rGame2.presence, foldMult: +fold(rGame2.score).toFixed(3) }));
}

// ---------- A4: full-band raster = clone shot IS the source screenshot, one giant <img> ----------
{
  const src = mk(W, H, [248, 248, 250]); photo(src, 480, 60, 480, 280); checker(src, 100, 80, 240, 160, 30, [20, 20, 24], [240, 200, 60]);
  const srcMedia = [leaf(480, 60, 480, 280), leaf(100, 80, 240, 160)];
  const cln = dup(src); // pixels identical (screenshot copied)
  const clnMedia = [leaf(0, 0, 1440, 400)]; // ONE giant raster img
  const r = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia, cloneMedia: clnMedia, y0: 0, y1: H });
  console.log('A4 FULL-BAND RASTER (source screenshot as one big img):', JSON.stringify({ M: r.score, id: r.identity, pres: r.presence, leaves: r.leaves }));
}

// ---------- F1: FALSE-LOW — pixel-perfect clone whose imagery is a CSS background-image (no img/svg element) ----------
{
  const src = mk(W, H, [248, 248, 250]); photo(src, 480, 60, 480, 280);
  const srcMedia = [leaf(480, 60, 480, 280)];
  const cln = dup(src); // clone shot BYTE-IDENTICAL to source
  const r = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia, cloneMedia: [], y0: 0, y1: H }); // bg-div -> no media leaf
  console.log('F1 BG-DIV FALSE-LOW (clone pixels byte-identical, imagery painted via background-image):', JSON.stringify({ M: r.score, id: r.identity, pres: r.presence, leaves: r.leaves }));
}

// ---------- F2: FALSE-LOW — small vertical drift pushes the clone leaf center across the band boundary ----------
{
  const src = mk(W, 800, [248, 248, 250]); photo(src, 480, 250, 480, 280); // center-y = 390, band [0,400)
  const srcMedia = [leaf(480, 250, 480, 280)];
  const cln = mk(W, 800, [248, 248, 250]); blit(src, 480, 250, 480, 280, cln, 480, 275, 480, 280); // SAME image, +25px drift -> center 415
  const clnMedia = [leaf(480, 275, 480, 280)];
  const r = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia, cloneMedia: clnMedia, y0: 0, y1: 400 });
  const rB = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia, cloneMedia: clnMedia, y0: 400, y1: 800 });
  console.log('F2 DRIFT FALSE-LOW (+25px drift, identical imagery):', JSON.stringify({ bandA: { M: r.score, leaves: r.leaves }, bandB: { M: rB.score, cloneOnly: rB.cloneOnlyMediaArea } }));
}
