import { PNG } from 'pngjs';
import { mediaIdentityBand } from './grade-sections.mjs';
const mk = (w, h, rgb) => { const p = new PNG({ width: w, height: h }); for (let i = 0; i < w * h; i++) { p.data[i*4]=rgb[0]; p.data[i*4+1]=rgb[1]; p.data[i*4+2]=rgb[2]; p.data[i*4+3]=255; } return p; };
const px = (img,x,y,rgb)=>{ if(x<0||y<0||x>=img.width||y>=img.height) return; const i=(y*img.width+x)*4; img.data[i]=Math.max(0,Math.min(255,rgb[0])); img.data[i+1]=Math.max(0,Math.min(255,rgb[1])); img.data[i+2]=Math.max(0,Math.min(255,rgb[2])); img.data[i+3]=255; };
const get = (img,x,y)=>{ const i=(y*img.width+x)*4; return [img.data[i],img.data[i+1],img.data[i+2]]; };
const photo = (img, x, y, w, h) => { for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const base = (Math.floor(xx / 24) + Math.floor(yy / 24)) % 2 === 0 ? [225, 140, 40] : [30, 70, 180]; const ramp = Math.round(60 * (xx / w)); px(img, x + xx, y + yy, [Math.min(255, base[0] + ramp), base[1], Math.min(255, base[2] + Math.round(40 * yy / h))]); } };
const lqip = (srcImg, sx, sy, sw, sh, gw, gh, dstImg, dx, dy) => {
  const cells = Array.from({ length: gw * gh }, () => [0, 0, 0, 0]);
  for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) { const gx = Math.min(gw-1, Math.floor(xx*gw/sw)), gy = Math.min(gh-1, Math.floor(yy*gh/sh)); const c = get(srcImg, sx+xx, sy+yy); const cc = cells[gy*gw+gx]; cc[0]+=c[0]; cc[1]+=c[1]; cc[2]+=c[2]; cc[3]++; }
  for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) { const gx = Math.min(gw-1, Math.floor(xx*gw/sw)), gy = Math.min(gh-1, Math.floor(yy*gh/sh)); const cc = cells[gy*gw+gx]; px(dstImg, dx+xx, dy+yy, [cc[0]/cc[3], cc[1]/cc[3], cc[2]/cc[3]]); }
};
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const grain = (img, x, y, w, h, std) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const n = Math.round(((rnd()+rnd()+rnd())/3 - 0.5) * 2 * std * 1.73); const c = get(img, xx, yy); px(img, xx, yy, [c[0]+n, c[1]+n, c[2]+n]); } };
const leaf=(x,y,w,h,tag='img')=>({x,y,w,h,area:w*h,tag});
const W = 1440, H = 400, BOX = { x: 480, y: 60, w: 480, h: 280 };
const media = [leaf(BOX.x, BOX.y, BOX.w, BOX.h)];
const src = mk(W, H, [248,248,250]); photo(src, BOX.x, BOX.y, BOX.w, BOX.h);
let best = { score: -1 };
for (const g of [18, 24, 36]) {
  const gh = Math.round(g * 8 / 9);
  for (const std of [0, 24, 32, 40, 48, 56, 64, 80]) {
    const c = mk(W, H, [248,248,250]); lqip(src, BOX.x, BOX.y, BOX.w, BOX.h, g, gh, c, BOX.x, BOX.y);
    if (std) grain(c, BOX.x, BOX.y, BOX.w, BOX.h, std);
    const r = mediaIdentityBand({ srcShot: src, cloneShot: c, srcMedia: media, cloneMedia: media, y0: 0, y1: H });
    if (r.score > best.score) best = { grid: `${g}x${gh}`, std, score: r.score };
    console.log(`grid ${g}x${gh} std ${std}: M ${r.score}`);
  }
}
console.log('BEST surviving blur-mosaic trick:', JSON.stringify(best));
