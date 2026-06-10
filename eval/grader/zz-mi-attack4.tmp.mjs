// @purpose B1 round-4 FINAL CRITIC lab: hunt the NEXT game past T13/T14. Central question: is the published
// per-leaf trick ceiling (9x8 LQIP = 0.336) actually a ceiling, or just one point on an attacker-chosen
// resolution curve? T14 verifies fine-detail SIGNS at the 18x16 grid — but an 18x16 (or finer) LQIP reproduces
// those very cell means BY CONSTRUCTION, and zero-mean grain restores the hf MAGNITUDE without moving any
// pooled mean. Threat model: the refine loop HAS the source screenshot (it captured it) and the grader source
// (grid constants are repo-public) — same knowledge the shipped 9x8-LQIP attack (zz-mi-attack A2) already used.
// A1  18x16 LQIP plain               (finer placeholder, no noise — natural next mutation of the LQIP family)
// A2  18x16 LQIP + tuned grain       (grain std tuned so clone within-9x8-cell std == source's; sweep + exact)
// A3  36x32 LQIP plain / + grain     (resolution monotonicity — where does the curve land?)
// B   4x4-LQIP poster at a video box (img tag; MI_VIDEO_DE_MIN palette gate is a 4x4 pooled stat → spoofed at ~1)
// C   partial-LQIP hybrid            (stripe of real pixels + LQIP rest — interpolation vs the bound formula)
// D   blind structured noise         (no-source-knowledge control: smooth sign-field noise vs the deadband)
import { PNG } from 'pngjs';
import { mediaIdentityBand, mediaCropId, cropEnergy } from './grade-sections.mjs';

const mk = (w, h, rgb) => { const p = new PNG({ width: w, height: h }); for (let i = 0; i < w * h; i++) { p.data[i*4]=rgb[0]; p.data[i*4+1]=rgb[1]; p.data[i*4+2]=rgb[2]; p.data[i*4+3]=255; } return p; };
const px = (img,x,y,rgb)=>{ if(x<0||y<0||x>=img.width||y>=img.height) return; const i=(y*img.width+x)*4; img.data[i]=Math.max(0,Math.min(255,rgb[0])); img.data[i+1]=Math.max(0,Math.min(255,rgb[1])); img.data[i+2]=Math.max(0,Math.min(255,rgb[2])); img.data[i+3]=255; };
const get = (img,x,y)=>{ const i=(y*img.width+x)*4; return [img.data[i],img.data[i+1],img.data[i+2]]; };
const checker=(img,x,y,w,h,cell,a,b)=>{ for(let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++) px(img,xx,yy,(Math.floor((xx-x)/cell)+Math.floor((yy-y)/cell))%2===0?a:b); };
const photo = (img, x, y, w, h) => { for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const base = (Math.floor(xx / 24) + Math.floor(yy / 24)) % 2 === 0 ? [225, 140, 40] : [30, 70, 180]; const ramp = Math.round(60 * (xx / w)); px(img, x + xx, y + yy, [Math.min(255, base[0] + ramp), base[1], Math.min(255, base[2] + Math.round(40 * yy / h))]); } };
const blit = (srcImg, sx, sy, sw, sh, dstImg, dx, dy) => { for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) px(dstImg, dx + xx, dy + yy, get(srcImg, sx + xx, sy + yy)); };
const lqip = (srcImg, sx, sy, sw, sh, gw, gh, dstImg, dx, dy) => {
  const cells = Array.from({ length: gw * gh }, () => [0, 0, 0, 0]);
  for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) { const gx = Math.min(gw-1, Math.floor(xx*gw/sw)), gy = Math.min(gh-1, Math.floor(yy*gh/sh)); const c = get(srcImg, sx+xx, sy+yy); const cc = cells[gy*gw+gx]; cc[0]+=c[0]; cc[1]+=c[1]; cc[2]+=c[2]; cc[3]++; }
  for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) { const gx = Math.min(gw-1, Math.floor(xx*gw/sw)), gy = Math.min(gh-1, Math.floor(yy*gh/sh)); const cc = cells[gy*gw+gx]; px(dstImg, dx+xx, dy+yy, [cc[0]/cc[3], cc[1]/cc[3], cc[2]/cc[3]]); }
};
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const grain = (img, x, y, w, h, std) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const n = Math.round(((rnd()+rnd()+rnd())/3 - 0.5) * 2 * std * 1.73); const c = get(img, xx, yy); px(img, xx, yy, [c[0]+n, c[1]+n, c[2]+n]); } };
const leaf=(x,y,w,h,tag='img')=>({x,y,w,h,area:w*h,tag});
const J = (o) => JSON.stringify(o);
const W = 1440, H = 400;
// within-9x8-cell luma std of a crop (the attacker can compute this from the captured source — same math as _poolGrid idx 3)
const hfOf = (img, box) => {
  const x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
  const cells = Array.from({ length: 72 }, () => [0, 0, 0]);
  for (let y = y0; y < y1; y += 2) { const gy = Math.min(7, Math.floor(((y - y0) / (y1 - y0)) * 8));
    for (let x = x0; x < x1; x += 2) { const gx = Math.min(8, Math.floor(((x - x0) / (x1 - x0)) * 9));
      const c = get(img, x, y); const l = 0.299*c[0]+0.587*c[1]+0.114*c[2]; const cc = cells[gy*9+gx]; cc[0]+=l; cc[1]+=l*l; cc[2]++; } }
  return cells.reduce((s, c) => s + (c[2] ? Math.sqrt(Math.max(0, c[1]/c[2] - (c[0]/c[2])**2)) : 0), 0) / 72;
};

const BOX = { x: 480, y: 60, w: 480, h: 280 };
const media = [leaf(BOX.x, BOX.y, BOX.w, BOX.h)];
const src = mk(W, H, [248,248,250]); photo(src, BOX.x, BOX.y, BOX.w, BOX.h);
const srcHf = hfOf(src, BOX);
console.log('source within-cell hf (attacker-computable):', +srcHf.toFixed(2));

const run = (cln, label, cloneMedia = media) => {
  const r = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia: media, cloneMedia, y0: 0, y1: H });
  console.log(label + ':', J({ M: r.score, id: r.identity, pres: r.presence }));
  return r;
};

// ---------- control: the published ceiling ----------
{ const c = mk(W, H, [248,248,250]); lqip(src, BOX.x, BOX.y, BOX.w, BOX.h, 9, 8, c, BOX.x, BOX.y); run(c, 'CTRL 9x8 LQIP (published ceiling 0.336)'); }

// ---------- A1/A2: 18x16 LQIP, plain then grain-tuned ----------
{
  const c = mk(W, H, [248,248,250]); lqip(src, BOX.x, BOX.y, BOX.w, BOX.h, 18, 16, c, BOX.x, BOX.y);
  const r1 = run(c, 'A1 18x16 LQIP plain');
  const mosaicHf = hfOf(c, BOX);
  // exact tune: grain std s.t. sqrt(mosaic^2 + grain^2) = srcHf (grain() applies ~uniform-sum noise with std ≈ arg)
  const tuned = Math.sqrt(Math.max(0, srcHf * srcHf - mosaicHf * mosaicHf));
  console.log('  mosaic hf', +mosaicHf.toFixed(2), '→ tuned grain std', +tuned.toFixed(1));
  for (const std of [tuned * 0.75, tuned, tuned * 1.25].map((v) => +v.toFixed(1))) {
    const c2 = mk(W, H, [248,248,250]); lqip(src, BOX.x, BOX.y, BOX.w, BOX.h, 18, 16, c2, BOX.x, BOX.y); grain(c2, BOX.x, BOX.y, BOX.w, BOX.h, std);
    const r = run(c2, `A2 18x16 LQIP + grain std=${std} (clone hf ${+hfOf(c2, BOX).toFixed(1)})`);
    if (r.score > 0.336 + 1e-9) console.log('  >>> EXCEEDS published 0.336 ceiling by', +(r.score - 0.336).toFixed(3));
  }
  if (r1.score > 0.336 + 1e-9) console.log('  >>> A1 plain ALREADY exceeds published ceiling by', +(r1.score - 0.336).toFixed(3));
}

// ---------- A3: 36x32 LQIP (resolution curve) ----------
{
  const c = mk(W, H, [248,248,250]); lqip(src, BOX.x, BOX.y, BOX.w, BOX.h, 36, 32, c, BOX.x, BOX.y);
  run(c, 'A3 36x32 LQIP plain');
  const mhf = hfOf(c, BOX); const tuned = +Math.sqrt(Math.max(0, srcHf * srcHf - mhf * mhf)).toFixed(1);
  const c2 = mk(W, H, [248,248,250]); lqip(src, BOX.x, BOX.y, BOX.w, BOX.h, 36, 32, c2, BOX.x, BOX.y); grain(c2, BOX.x, BOX.y, BOX.w, BOX.h, tuned);
  run(c2, `A3 36x32 LQIP + grain std=${tuned}`);
}

// ---------- B: 4x4-LQIP poster spoof at a VIDEO box (palette gate is a 4x4 pooled stat) ----------
{
  const vsrc = mk(800, 300, [20,20,24]); checker(vsrc, 200, 50, 400, 220, 40, [200,200,60], [40,40,120]);
  const v = [leaf(200, 50, 400, 220, 'video')];
  const cln = mk(800, 300, [20,20,24]); lqip(vsrc, 200, 50, 400, 220, 4, 4, cln, 200, 50);
  const r = mediaIdentityBand({ srcShot: vsrc, cloneShot: cln, srcMedia: v, cloneMedia: [leaf(200, 50, 400, 220, 'img')], y0: 0, y1: 300 });
  console.log('B 4x4-LQIP poster at video box (img tag):', J({ M: r.score, pres: r.presence }), '(junk-<video> tag is 1.0 by design anyway — this shows the poster gate is equally spoofable)');
}

// ---------- C: partial-LQIP hybrid — p of the box real, rest 9x8 LQIP ----------
{
  for (const p of [0.25, 0.5, 0.75]) {
    const c = mk(W, H, [248,248,250]); lqip(src, BOX.x, BOX.y, BOX.w, BOX.h, 9, 8, c, BOX.x, BOX.y);
    const hw = Math.round(BOX.w * p); blit(src, BOX.x, BOX.y, hw, BOX.h, c, BOX.x, BOX.y);
    const r = run(c, `C hybrid real-left ${p * 100}% + 9x8 LQIP rest`);
    const bound = p + (1 - p) * 0.336;
    console.log(`  interp bound p+ (1-p)*0.336 = ${+bound.toFixed(3)}`, r.score > bound + 0.02 ? '>>> ABOVE interpolation' : 'within');
  }
}

// ---------- D: BLIND structured noise (no source pixels): smooth low-freq sign field vs the deadband ----------
{
  // attacker without source pixels paints a flat mid-gray + a smooth 18x16-cell sinusoid detail field hoping the
  // ±1 offset search harvests agreement above MI_FINE_DEAD from spatial smoothness alone.
  const c = mk(W, H, [248,248,250]);
  for (let yy = 0; yy < BOX.h; yy++) for (let xx = 0; xx < BOX.w; xx++) {
    const v = 128 + Math.round(20 * Math.sin(xx / 26.7) * Math.sin(yy / 17.5)); px(c, BOX.x + xx, BOX.y + yy, [v, v, v]);
  }
  run(c, 'D blind smooth sign-field (no source knowledge)');
}
