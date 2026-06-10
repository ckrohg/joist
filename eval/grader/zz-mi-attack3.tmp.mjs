// @purpose adversarial-critic round 3 (post fold-blocker fixes): NEXT-cheapest games the 4 fixes don't cover.
// N1 grain-over-LQIP (hf-term defeat WITHOUT source pixels — generic film-grain overlay on the shipped placeholder)
// N2 video-box presence stuffing (presence-only credit fed by a decorative gradient at the video's box)
// N3 hero-matched + all-small-imagery-omitted (area-weighting under-price of human-salient icon/logo misses)
// N4 wrong-busy realistic photo substitution (the ~0.44 residual, priced as foldMult gain vs honest omission)
// N5 flat-pooled fine-texture source vs generic faint-noise fill (corr/hf flat-guard corner)
// N6 free anisotropic stretch inside MI_AR_TOL (1.46x vertical stretch → priced 0?)
// N7 partial-band raster (imagery boxes only) — expected 1.0 BY DESIGN (region-capture lever), documented control
import { PNG } from 'pngjs';
import { mediaIdentityBand, mediaCropId, cropEnergy } from './grade-sections.mjs';

const mk = (w, h, rgb) => { const p = new PNG({ width: w, height: h }); for (let i = 0; i < w * h; i++) { p.data[i*4]=rgb[0]; p.data[i*4+1]=rgb[1]; p.data[i*4+2]=rgb[2]; p.data[i*4+3]=255; } return p; };
const px = (img,x,y,rgb)=>{ if(x<0||y<0||x>=img.width||y>=img.height) return; const i=(y*img.width+x)*4; img.data[i]=Math.max(0,Math.min(255,rgb[0])); img.data[i+1]=Math.max(0,Math.min(255,rgb[1])); img.data[i+2]=Math.max(0,Math.min(255,rgb[2])); img.data[i+3]=255; };
const get = (img,x,y)=>{ const i=(y*img.width+x)*4; return [img.data[i],img.data[i+1],img.data[i+2]]; };
const checker=(img,x,y,w,h,cell,a,b)=>{ for(let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++) px(img,xx,yy,(Math.floor((xx-x)/cell)+Math.floor((yy-y)/cell))%2===0?a:b); };
const photo = (img, x, y, w, h) => { for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const base = (Math.floor(xx / 24) + Math.floor(yy / 24)) % 2 === 0 ? [225, 140, 40] : [30, 70, 180]; const ramp = Math.round(60 * (xx / w)); px(img, x + xx, y + yy, [Math.min(255, base[0] + ramp), base[1], Math.min(255, base[2] + Math.round(40 * yy / h))]); } };
// a SECOND, different "stock photo": different cell size, palette, ramp direction
const photoB = (img, x, y, w, h) => { for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const base = (Math.floor(xx / 40) + Math.floor(yy / 16)) % 2 === 0 ? [60, 180, 120] : [190, 60, 130]; const ramp = Math.round(60 * (1 - yy / h)); px(img, x + xx, y + yy, [base[0], Math.min(255, base[1] + ramp), base[2]]); } };
const blit = (srcImg, sx, sy, sw, sh, dstImg, dx, dy, dw, dh) => { for (let yy = 0; yy < dh; yy++) for (let xx = 0; xx < dw; xx++) { const ox = sx + Math.min(sw - 1, Math.floor(xx * sw / dw)); const oy = sy + Math.min(sh - 1, Math.floor(yy * sh / dh)); px(dstImg, dx + xx, dy + yy, get(srcImg, ox, oy)); } };
const lqip = (srcImg, sx, sy, sw, sh, gw, gh, dstImg, dx, dy) => {
  const cells = Array.from({ length: gw * gh }, () => [0, 0, 0, 0]);
  for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) { const gx = Math.min(gw-1, Math.floor(xx*gw/sw)), gy = Math.min(gh-1, Math.floor(yy*gh/sh)); const c = get(srcImg, sx+xx, sy+yy); const cc = cells[gy*gw+gx]; cc[0]+=c[0]; cc[1]+=c[1]; cc[2]+=c[2]; cc[3]++; }
  for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) { const gx = Math.min(gw-1, Math.floor(xx*gw/sw)), gy = Math.min(gh-1, Math.floor(yy*gh/sh)); const cc = cells[gy*gw+gx]; px(dstImg, dx+xx, dy+yy, [cc[0]/cc[3], cc[1]/cc[3], cc[2]/cc[3]]); }
};
const vgrad = (img, x, y, w, h) => { for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) px(img, x + xx, y + yy, [Math.round(255*yy/h), Math.round(40+180*yy/h), 200]); };
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
// generic film-grain overlay: per-pixel +-std gaussian-ish noise (sum of 3 uniforms), needs ZERO source knowledge
const grain = (img, x, y, w, h, std) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const n = Math.round(((rnd()+rnd()+rnd())/3 - 0.5) * 2 * std * 1.73); const c = get(img, xx, yy); px(img, xx, yy, [c[0]+n, c[1]+n, c[2]+n]); } };
const leaf=(x,y,w,h,tag='img')=>({x,y,w,h,area:w*h,tag});
const fold = (m) => m == null ? 1 : 0.45 + 0.55 * m;
const J = (o) => JSON.stringify(o);
const W = 1440, H = 400;

// ---------- N1: GRAIN-OVER-LQIP — defeat the hf term with a generic noise overlay (no source pixels needed) ----------
{
  const src = mk(W, H, [248,248,250]); photo(src, 480, 60, 480, 280);
  const media = [leaf(480, 60, 480, 280)];
  // measure the source's own hf so we can report attacker-knowledge sensitivity (attacker does NOT know it; sweep stds)
  for (const std of [8, 16, 24, 32, 48]) {
    const cln = mk(W, H, [248,248,250]); lqip(src, 480, 60, 480, 280, 9, 8, cln, 480, 60); grain(cln, 480, 60, 480, 280, std);
    const r = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia: media, cloneMedia: media, y0: 0, y1: H });
    console.log(`N1 GRAIN-LQIP std=${std}:`, J({ M: r.score, id: r.identity, foldMult: +fold(r.score).toFixed(3) }));
  }
  // control: plain LQIP (the fixed number) for delta
  const c0 = mk(W, H, [248,248,250]); lqip(src, 480, 60, 480, 280, 9, 8, c0, 480, 60);
  const r0 = mediaIdentityBand({ srcShot: src, cloneShot: c0, srcMedia: media, cloneMedia: media, y0: 0, y1: H });
  console.log('N1 control plain LQIP:', J({ M: r0.score, id: r0.identity }));
}

// ---------- N2: VIDEO-BOX PRESENCE STUFFING — gradient div/svg at the video's box buys full presence credit ----------
{
  const src = mk(800, 300, [20,20,24]); checker(src, 200, 50, 400, 220, 40, [200,200,60], [40,40,120]); // "video frame"
  const v = [leaf(200, 50, 400, 220, 'video')];
  // honest omission
  const r0 = mediaIdentityBand({ srcShot: src, cloneShot: mk(800,300,[20,20,24]), srcMedia: v, cloneMedia: [], y0: 0, y1: 300 });
  // game: decorative svg gradient painted at the video's box
  const cln = mk(800, 300, [20,20,24]); vgrad(cln, 200, 50, 400, 220);
  const rG = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia: v, cloneMedia: [leaf(200, 50, 400, 220, 'svg')], y0: 0, y1: 300 });
  // game variant: tiny-ish gray noise box (still >=24px, painted) — does partial area still credit min(area)?
  const cln2 = mk(800, 300, [20,20,24]); vgrad(cln2, 250, 80, 200, 140);
  const rG2 = mediaIdentityBand({ srcShot: src, cloneShot: cln2, srcMedia: v, cloneMedia: [leaf(250, 80, 200, 140, 'svg')], y0: 0, y1: 300 });
  console.log('N2 VIDEO honest-omit:', J({ M: r0.score, foldMult: +fold(r0.score).toFixed(3) }));
  console.log('N2 VIDEO gradient-at-box:', J({ M: rG.score, pres: rG.presence, foldMult: +fold(rG.score).toFixed(3) }));
  console.log('N2 VIDEO half-size gradient:', J({ M: rG2.score, pres: rG2.presence }));
}

// ---------- N3: HERO-MATCHED + ALL SMALL IMAGERY OMITTED — area weighting under-prices icon/logo misses ----------
{
  const src = mk(W, 600, [250,250,252]); photo(src, 80, 100, 600, 400);
  const srcMedia = [leaf(80, 100, 600, 400)];
  for (let i = 0; i < 8; i++) { const x = 760 + (i % 4) * 140, y = 160 + Math.floor(i / 4) * 200; checker(src, x, y, 48, 48, 8, [30,30,34], [240,160,40]); srcMedia.push(leaf(x, y, 48, 48, 'svg')); }
  const cln = mk(W, 600, [250,250,252]); blit(src, 80, 100, 600, 400, cln, 80, 100, 600, 400); // hero copied EXACTLY, 8 icons omitted
  const r = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia, cloneMedia: [leaf(80, 100, 600, 400)], y0: 0, y1: 600 });
  console.log('N3 HERO+8-ICONS-OMITTED:', J({ M: r.score, id: r.identity, missing: r.leaves.missing, foldMult: +fold(r.score).toFixed(3) }));
}

// ---------- N4: WRONG-BUSY SUBSTITUTION — a DIFFERENT real-looking photo in the right box (the 0.44 residual) ----------
{
  const src = mk(W, H, [248,248,250]); photo(src, 480, 60, 480, 280);
  const media = [leaf(480, 60, 480, 280)];
  const cln = mk(W, H, [248,248,250]); photoB(cln, 480, 60, 480, 280);
  const r = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia: media, cloneMedia: media, y0: 0, y1: H });
  const rO = mediaIdentityBand({ srcShot: src, cloneShot: mk(W,H,[248,248,250]), srcMedia: media, cloneMedia: [], y0: 0, y1: H });
  console.log('N4 WRONG-BUSY photoB-for-photoA:', J({ M: r.score, id: r.identity, foldMult: +fold(r.score).toFixed(3) }));
  console.log('N4 honest-omit same band:', J({ M: rO.score, foldMult: +fold(rO.score).toFixed(3) }), '→ foldMult GAIN from stuffing a wrong stock photo:', +(fold(r.score) - fold(rO.score)).toFixed(3));
}

// ---------- N5: FLAT-POOLED FINE TEXTURE vs GENERIC FAINT NOISE — corr/hf flat-guard corner ----------
{
  const src = mk(W, H, [128,128,128]);
  // fine 2px checker, +-6 luma: passes the paint gate, pooled-cell means ~flat, within-cell hf ~6
  for (let yy = 60; yy < 340; yy++) for (let xx = 480; xx < 960; xx++) { const d = ((xx + yy) % 4 < 2) ? 6 : -6; px(src, xx, yy, [128+d, 128+d, 128+d]); }
  const media = [leaf(480, 60, 480, 280)];
  const srcE = cropEnergy(src, { x: 480, y: 60, w: 480, h: 280 }).energy;
  const cln = mk(W, H, [128,128,128]); grain(cln, 480, 60, 480, 280, 6); // generic faint noise, ZERO source knowledge
  const clnE = cropEnergy(cln, { x: 480, y: 60, w: 480, h: 280 }).energy;
  const r = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia: media, cloneMedia: media, y0: 0, y1: H });
  console.log('N5 FLAT-POOLED texture vs faint noise:', J({ srcE, clnE, M: r.score, id: r.identity }));
}

// ---------- N6: FREE STRETCH inside MI_AR_TOL — 480x280 -> 480x408 (1.46x vertical), aspect ratio 0.686 >= 0.65 ----------
{
  const src = mk(W, 600, [248,248,250]); photo(src, 480, 60, 480, 280);
  const cln = mk(W, 600, [248,248,250]); blit(src, 480, 60, 480, 280, cln, 480, 60, 480, 408);
  const r = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia: [leaf(480, 60, 480, 280)], cloneMedia: [leaf(480, 60, 480, 408)], y0: 0, y1: 600 });
  console.log('N6 FREE-STRETCH 1.46x vertical (inside MI_AR_TOL):', J({ M: r.score, id: r.identity }));
}

// ---------- N7: PARTIAL-BAND RASTER (imagery boxes only) — BY-DESIGN control, expect ~1.0 ----------
{
  const src = mk(W, H, [248,248,250]); photo(src, 480, 60, 480, 280); checker(src, 100, 80, 240, 160, 30, [20,20,24], [240,200,60]);
  const srcMedia = [leaf(480, 60, 480, 280), leaf(100, 80, 240, 160)];
  const cln = mk(W, H, [248,248,250]);
  blit(src, 480, 60, 480, 280, cln, 480, 60, 480, 280); blit(src, 100, 80, 240, 160, cln, 100, 80, 240, 160); // raster crops ONLY at the boxes
  const r = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia, cloneMedia: srcMedia.map(m => ({ ...m })), y0: 0, y1: H });
  console.log('N7 PARTIAL-BAND RASTER (imagery regions only):', J({ M: r.score, id: r.identity }));
}
