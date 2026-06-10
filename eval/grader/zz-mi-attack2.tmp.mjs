// @purpose adversarial-critic round 2: same-palette wrong-logo lenience + random-imagery hashSim baseline
import { PNG } from 'pngjs';
import { mediaIdentityBand, mediaCropId } from './grade-sections.mjs';
const mk = (w, h, rgb) => { const p = new PNG({ width: w, height: h }); for (let i = 0; i < w * h; i++) { p.data[i*4]=rgb[0]; p.data[i*4+1]=rgb[1]; p.data[i*4+2]=rgb[2]; p.data[i*4+3]=255; } return p; };
const px = (img,x,y,rgb)=>{ if(x<0||y<0||x>=img.width||y>=img.height) return; const i=(y*img.width+x)*4; img.data[i]=rgb[0]; img.data[i+1]=rgb[1]; img.data[i+2]=rgb[2]; img.data[i+3]=255; };
const hstripes=(img,x,y,w,h,period,a,b)=>{ for(let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++) px(img,xx,yy,Math.floor((yy-y)/period)%2===0?a:b); };
const vstripes=(img,x,y,w,h,period,a,b)=>{ for(let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++) px(img,xx,yy,Math.floor((xx-x)/period)%2===0?a:b); };
const checker=(img,x,y,w,h,cell,a,b)=>{ for(let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++) px(img,xx,yy,(Math.floor((xx-x)/cell)+Math.floor((yy-y)/cell))%2===0?a:b); };
const leaf=(x,y,w,h,tag='img')=>({x,y,w,h,area:w*h,tag});

// W1: same-palette wrong logo — dark-gray glyph bars on white, source=h-stripes, clone=checker (clearly a DIFFERENT logo to a human)
{
  const src = mk(1440,300,[255,255,255]); hstripes(src,600,60,240,160,40,[55,55,60],[255,255,255]);
  const cln = mk(1440,300,[255,255,255]); checker(cln,600,60,240,160,40,[55,55,60],[255,255,255]);
  const media=[leaf(600,60,240,160)];
  const r = mediaIdentityBand({srcShot:src,cloneShot:cln,srcMedia:media,cloneMedia:media,y0:0,y1:300});
  console.log('W1 SAME-PALETTE WRONG-LOGO (gray-on-white, different glyph):', JSON.stringify({M:r.score,id:r.identity,wrong:r.leaves.wrong}));
}
// W2: same-palette wrong logo, vstripes vs hstripes (rotation = totally different mark)
{
  const src = mk(1440,300,[255,255,255]); hstripes(src,600,60,240,160,40,[55,55,60],[255,255,255]);
  const cln = mk(1440,300,[255,255,255]); vstripes(cln,600,60,240,160,40,[55,55,60],[255,255,255]);
  const media=[leaf(600,60,240,160)];
  const r = mediaIdentityBand({srcShot:src,cloneShot:cln,srcMedia:media,cloneMedia:media,y0:0,y1:300});
  console.log('W2 SAME-PALETTE WRONG-LOGO (90deg-rotated stripes):', JSON.stringify({M:r.score,id:r.identity,wrong:r.leaves.wrong}));
}
// W3: hashSim baseline for UNRELATED imagery — deterministic pseudo-random noise images, 20 pairs
{
  let seed=42; const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
  let sum=0; const N=20;
  for(let t=0;t<N;t++){
    const a=mk(400,300,[0,0,0]), b=mk(400,300,[0,0,0]);
    for(let y=0;y<300;y+=4) for(let x=0;x<400;x+=4){ const ca=[rnd()*255,rnd()*255,rnd()*255], cb=[rnd()*255,rnd()*255,rnd()*255]; for(let dy=0;dy<4;dy++) for(let dx=0;dx<4;dx++){ px(a,x+dx,y+dy,ca); px(b,x+dx,y+dy,cb); } }
    sum += mediaCropId(a,{x:0,y:0,w:400,h:300},b,{x:0,y:0,w:400,h:300});
  }
  console.log('W3 UNRELATED-IMAGERY id BASELINE (20 random pairs): mean id =', (sum/N).toFixed(3), '(a 0-baseline metric would give ~0)');
}
