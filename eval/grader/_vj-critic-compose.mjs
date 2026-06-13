// @purpose adversarial-critic probe: build (a) identical src|src control and (b) side-swapped composite
// from existing vision-judge tiles, reusing the same label/divider conventions, to test judge hallucination
// and label/prior bias.
import fs from 'fs';
import { PNG } from 'pngjs';
const DIVIDER = 14;
const FONT = {
  '0':['01110','10001','10011','10101','11001','10001','01110'],'1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],'4':['00010','00110','01010','10010','11111','00010','00010'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  S:['01111','10000','10000','01110','00001','00001','11110'],R:['11110','10001','10001','11110','10100','10010','10001'],
  C:['01110','10001','10000','10000','10000','10001','01110'],L:['10000','10000','10000','10000','10000','10000','11111'],
  O:['01110','10001','10001','10001','10001','10001','01110'],N:['10001','11001','10101','10011','10001','10001','10001'],
  E:['11111','10000','10000','11110','10000','10000','11111'],P:['11110','10001','10001','11110','10000','10000','10000'],
  X:['10001','10001','01010','00100','01010','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100'],
  ' ':['00000','00000','00000','00000','00000','00000','00000'],
};
function drawLabel(png,x0,y0,text,scale=2){const chW=6*scale,h=7*scale;const w=text.length*chW+2*scale;
 for(let r=-scale;r<h+scale;r++)for(let c=-scale;c<w;c++){const x=x0+c,y=y0+r;if(x<0||y<0||x>=png.width||y>=png.height)continue;const i=(y*png.width+x)<<2;png.data[i]=0;png.data[i+1]=0;png.data[i+2]=0;png.data[i+3]=255;}
 let cx=x0+scale;for(const ch of text.toUpperCase()){const g=FONT[ch]||FONT[' '];for(let r=0;r<7;r++)for(let c=0;c<5;c++){if(g[r][c]!=='1')continue;for(let sy=0;sy<scale;sy++)for(let sx=0;sx<scale;sx++){const x=cx+c*scale+sx,y=y0+r*scale+sy;if(x<0||y<0||x>=png.width||y>=png.height)continue;const i=(y*png.width+x)<<2;png.data[i]=255;png.data[i+1]=255;png.data[i+2]=255;png.data[i+3]=255;}}cx+=chW;}}
function half(png, side, w){ // side 0 = left, 1 = right
  const x0 = side===0?0:w+DIVIDER, out=new PNG({width:w,height:png.height});
  for(let r=0;r<png.height;r++){const s=((r*png.width+x0)<<2);png.data.copy(out.data,(r*w)<<2,s,s+(w<<2));}
  // black-out old burned corner label (top-left 340x30)
  for(let r=0;r<30;r++)for(let c=0;c<340;c++){const i=(r*w+c)<<2;out.data[i]=0;out.data[i+1]=0;out.data[i+2]=0;out.data[i+3]=255;}
  return out;}
function compose(L,R,labL,labR){const h=Math.max(L.height,R.height),w=L.width+DIVIDER+R.width;const out=new PNG({width:w,height:h});
 for(let i=0;i<out.data.length;i+=4){out.data[i]=24;out.data[i+1]=24;out.data[i+2]=24;out.data[i+3]=255;}
 const blit=(img,ox)=>{for(let r=0;r<img.height;r++){const s=(r*img.width)<<2;img.data.copy(out.data,((r*w+ox)<<2),s,s+(img.width<<2));}};
 blit(L,0);blit(R,L.width+DIVIDER);
 for(let r=0;r<h;r++)for(let c=L.width+2;c<L.width+DIVIDER-2;c++){const i=(r*w+c)<<2;out.data[i]=255;out.data[i+1]=0;out.data[i+2]=220;out.data[i+3]=255;}
 drawLabel(out,6,6,labL);drawLabel(out,L.width+DIVIDER+6,6,labR);return out;}
const [,,inPath,mode,outPath,wStr] = process.argv;
const w=+wStr||1440;
const tile=PNG.sync.read(fs.readFileSync(inPath));
const L=half(tile,0,w), R=half(tile,1,w);
let out;
if(mode==='identical') out=compose(L,L,'SRC 1440PX','CLONE 1440PX');
else if(mode==='swap') out=compose(R,L,'SRC 1440PX','CLONE 1440PX');
else throw new Error('mode identical|swap');
fs.writeFileSync(outPath,PNG.sync.write(out));
console.log('wrote',outPath,out.width+'x'+out.height);
