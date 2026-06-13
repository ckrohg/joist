import { PNG } from 'pngjs';
import fs from 'fs';
function band(file,y0,y1,out){const f=PNG.sync.read(fs.readFileSync(file));const y=Math.max(0,y0);const h=Math.min(f.height-y,y1-y0);const o=new PNG({width:f.width,height:h});for(let r=0;r<h;r++){const s=((y+r)*f.width)*4;f.data.copy(o.data,(r*f.width)*4,s,s+f.width*4);}fs.writeFileSync(out,PNG.sync.write(o));}
band('/tmp/pico-clone-live.png',0,260,'/tmp/pico-hero.png');     // nav + headline + bars
band('/tmp/pico-clone-live.png',850,1080,'/tmp/pico-deadband.png'); // dead whitespace zone
