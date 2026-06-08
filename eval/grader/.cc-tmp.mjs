import { chromium } from 'playwright';
const jobs = [
  { tag:'framer-src', url:'https://www.framer.com', band:[9779,10129] },
  { tag:'framer-src2', url:'https://www.framer.com', band:[10129,10609] },
  { tag:'resend-src', url:'https://resend.com', band:[9581,10336] },
];
const b = await chromium.launch();
for (const j of jobs) {
  const pg = await b.newPage({ viewport:{width:1440,height:900}, deviceScaleFactor:1 });
  try {
    await pg.goto(j.url, { waitUntil:'networkidle', timeout:45000 });
    await pg.waitForTimeout(2500);
    // scroll through to trigger lazy
    await pg.evaluate(async()=>{ for(let y=0;y<document.body.scrollHeight;y+=800){window.scrollTo(0,y); await new Promise(r=>setTimeout(r,80));} window.scrollTo(0,0); });
    await pg.waitForTimeout(1200);
    const full = await pg.screenshot({ fullPage:true });
    const { PNG } = await import('pngjs');
    const png = PNG.sync.read(full);
    const [y0,y1]=j.band; const h=Math.min(y1,png.height)-y0;
    if (h>0){ const crop=new PNG({width:png.width,height:h}); for(let y=0;y<h;y++)for(let x=0;x<png.width;x++){const si=((y+y0)*png.width+x)*4,di=(y*png.width+x)*4;crop.data[di]=png.data[si];crop.data[di+1]=png.data[si+1];crop.data[di+2]=png.data[si+2];crop.data[di+3]=255;} const fs=await import('fs'); fs.writeFileSync(`/tmp/cc-${j.tag}.png`,PNG.sync.write(crop)); console.log(j.tag,'OK band h',h,'pageH',png.height);}
    else console.log(j.tag,'band beyond page; pageH',png.height);
  } catch(e){ console.log(j.tag,'ERR',e.message); }
  await pg.close();
}
await b.close();
