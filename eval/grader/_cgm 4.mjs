import { PNG } from 'pngjs'; import fs from 'fs';
const gray = (d,i)=>0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
function sig(img, gx, gy){
  const W=img.width, H=img.height, cw=W/gx, ch=H/gy;
  const N=gx*gy; const dens=new Float64Array(N),mr=new Float64Array(N),mg=new Float64Array(N),mb=new Float64Array(N),hAsym=new Float64Array(N),vAsym=new Float64Array(N);
  for(let j=0;j<gy;j++)for(let i=0;i<gx;i++){
    const x0=Math.floor(i*cw),x1=Math.floor((i+1)*cw),y0=Math.floor(j*ch),y1=Math.floor((j+1)*ch),xm=(x0+x1)/2,ym=(y0+y1)/2;
    let g=0,r=0,gg=0,bb=0,n=0,L=0,Ln=0,R=0,Rn=0,T=0,Tn=0,Bn=0,Bv=0;
    for(let y=y0;y<y1;y+=3)for(let x=x0;x<x1-1;x+=3){
      const idx=(y*W+x)*4; const a=gray(img.data,idx); g+=Math.abs(a-gray(img.data,idx+4));
      r+=img.data[idx]; gg+=img.data[idx+1]; bb+=img.data[idx+2]; n++;
      if(x<xm){L+=a;Ln++;}else{R+=a;Rn++;} if(y<ym){T+=a;Tn++;}else{Bv+=a;Bn++;}
    }
    const k=j*gx+i; if(n){dens[k]=g/n; mr[k]=r/n; mg[k]=gg/n; mb[k]=bb/n; hAsym[k]=(Ln?L/Ln:0)-(Rn?R/Rn:0); vAsym[k]=(Tn?T/Tn:0)-(Bn?Bv/Bn:0);}
  }
  return {dens,mr,mg,mb,hAsym,vAsym,gx,gy};
}
function cgm(A, B, opts={}){
  const off=opts.off??1, floor=opts.floor??4, maxC=opts.maxC??90, asymS=opts.asymS??45;
  const H=Math.min(A.height,B.height), gx=24, gy=Math.max(1,Math.round(H/40));
  const a=sig({width:A.width,height:H,data:A.data},gx,gy), b=sig({width:B.width,height:H,data:B.data},gx,gy);
  let cred=0,mass=0,sTot=0,cTot=0;
  for(let k=0;k<a.dens.length;k++){sTot+=a.dens[k]; cTot+=b.dens[k];}
  for(let j=0;j<gy;j++)for(let i=0;i<gx;i++){
    const k=j*gx+i, ds=a.dens[k]; if(ds<floor) continue;
    let best=0;
    for(let dj=-off;dj<=off;dj++)for(let di=-off;di<=off;di++){
      const ni=i+di,nj=j+dj; if(ni<0||ni>=gx||nj<0||nj>=gy)continue;
      const m=nj*gx+ni, dc=b.dens[m];
      const dr = Math.min(ds,dc)/Math.max(ds,dc,1e-6);
      const dCol = Math.min(1,(Math.abs(a.mr[k]-b.mr[m])+Math.abs(a.mg[k]-b.mg[m])+Math.abs(a.mb[k]-b.mb[m]))/(3*maxC));
      const dAsym = Math.min(1,(Math.abs(a.hAsym[k]-b.hAsym[m])+Math.abs(a.vAsym[k]-b.vAsym[m]))/(2*asymS));
      const sim = dr*(1-0.5*dCol)*(1-dAsym);
      if(sim>best)best=sim;
    }
    cred+=best*ds; mass+=ds;
  }
  let v = mass? cred/mass : 0;
  const ratio = cTot/Math.max(sTot,1e-6); if(ratio>1.5) v *= Math.max(0, sTot/cTot);
  return +v.toFixed(3);
}
const flipH=(img)=>{const o=new PNG({width:img.width,height:img.height});for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++){const s=(y*img.width+(img.width-1-x))*4,d=(y*img.width+x)*4;for(let c=0;c<4;c++)o.data[d+c]=img.data[s+c];}return o;};
const rollV=(img,dy)=>{const o=new PNG({width:img.width,height:img.height});for(let y=0;y<img.height;y++){const sy=(y+dy)%img.height;img.data.copy(o.data,(y*img.width)*4,(sy*img.width)*4,(sy*img.width+img.width)*4);}return o;};
const shiftX=(img,dx)=>{const o=new PNG({width:img.width,height:img.height});o.data.fill(255);for(let y=0;y<img.height;y++)for(let x=0;x<img.width-dx;x++){const s=(y*img.width+x)*4,d=(y*img.width+x+dx)*4;for(let c=0;c<4;c++)o.data[d+c]=img.data[s+c];}return o;};
const white=(img)=>{const o=new PNG({width:img.width,height:img.height});o.data.fill(255);return o;};
const noise=(img,amp)=>{const o=new PNG({width:img.width,height:img.height});for(let i=0;i<img.data.length;i+=4){for(let c=0;c<3;c++){let v=img.data[i+c]+((i*2654435761>>>0)%(2*amp))-amp;o.data[i+c]=Math.max(0,Math.min(255,v));}o.data[i+3]=255;}return o;};
for(const tag of ['stripecom','supabasecom','clerkcom']){
  const img=PNG.sync.read(fs.readFileSync(`/tmp/hybrid-src-${tag}.png`));
  const r={ self:cgm(img,img), blank:cgm(img,white(img)), noise:cgm(img,noise(img,30)), mirror:cgm(img,flipH(img)), rollV:cgm(img,rollV(img,200)), shift12:cgm(img,shiftX(img,12)) };
  console.log(tag, JSON.stringify(r));
}
