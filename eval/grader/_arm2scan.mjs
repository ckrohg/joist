import fs from 'fs';
const IMGK = new Set(['image','svg','mockup']);
function scan(path, name) {
  const L = JSON.parse(fs.readFileSync(path,'utf8'));
  const parent = new Map();
  (function w(n){ for(const c of (n.children||[])){ parent.set(c,n); w(c); } })(L.root);
  const sib = l => { const p = parent.get(l); return p ? (p.children||[]).filter(c=>IMGK.has(c.kind)).length : 1; };
  const all = [];
  (function g(n){ if(!n) return; if(n.kind&&IMGK.has(n.kind)&&n.box) all.push(n); for(const c of (n.children||[])) g(c); })(L.root);
  const loose = all.filter(n=>n.box.w>=3&&n.box.h>=3&&sib(n)<3);
  const bk = new Map();
  for(const n of loose){ const k=`${n.kind}|${Math.round(n.box.w/15)*15}x${Math.round(n.box.h/15)*15}`; if(!bk.has(k))bk.set(k,[]); bk.get(k).push(n); }
  let found=0;
  for(const [k,g] of bk){ if(g.length<4) continue;
    const ys=[...new Set(g.map(n=>Math.round(n.box.y/30)*30))].sort((a,b)=>a-b);
    const xs=[...new Set(g.map(n=>Math.round(n.box.x/30)*30))].sort((a,b)=>a-b);
    if(ys.length>=2 && xs.length>=2){
      const dy=ys.slice(1).map((y,i)=>y-ys[i]);
      const mean=dy.reduce((a,b)=>a+b,0)/dy.length;
      const dyStd=Math.sqrt(dy.map(d=>(d-mean)**2).reduce((a,b)=>a+b,0)/dy.length);
      console.log(`  ${name} MULTI-ROW ${k}: n=${g.length}, ${xs.length}cols x ${ys.length}rows, rowPitchStd=${Math.round(dyStd)} ${dyStd<25?'[REGULAR grid → ARM-2 target]':'[irregular scatter → skip]'}`);
      found++;
    }
  }
  if(!found) console.log(`  ${name}: NO multi-row multi-col image clusters (nothing for ARM-2)`);
}
scan('/tmp/layout-supabase-reflowfix.json','supabase');
const lin = fs.readdirSync('/tmp/abs-cache/linearapp').filter(f=>f.endsWith('.json')).map(f=>`/tmp/abs-cache/linearapp/${f}`)[0];
if (lin) scan(lin,'linear');
