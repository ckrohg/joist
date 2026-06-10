import { chromium } from 'playwright';
const b = await chromium.launch();
async function nodesAt(url, w) {
  const p = await b.newPage();
  await p.setViewportSize({ width: w, height: 900 });
  await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(1200);
  // scroll to trigger lazy
  await p.evaluate(async()=>{const h=document.documentElement.scrollHeight,s=window.innerHeight;for(let y=0;y<h;y+=s){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,80));}window.scrollTo(0,0);});
  const texts = await p.evaluate(() => {
    const out = [];
    const walk = el => { for (const c of el.children) { const t = (c.innerText||'').trim().replace(/\s+/g,' ').slice(0,40); const r = c.getBoundingClientRect(); if (t && r.width>4 && r.height>4 && r.top<document.documentElement.scrollHeight+200) { if (c.children.length===0 || [...c.children].every(x=>!(x.innerText||"").trim())) out.push({t, y: Math.round(r.top+window.scrollY)}); } walk(c); } };
    walk(document.body);
    return out;
  });
  await p.close();
  // dedupe by text
  const seen = new Set(); const u = [];
  for (const n of texts) { const k = n.t.toLowerCase(); if (!seen.has(k)) { seen.add(k); u.push(n); } }
  return u;
}
const src = await nodesAt('https://supabase.com', 390);
const clone = await nodesAt(process.argv[2], 390);
const srcSet = new Set(src.map(n=>n.t.toLowerCase()));
const cloneSet = new Set(clone.map(n=>n.t.toLowerCase()));
const inSrcNotClone = [...srcSet].filter(t=>!cloneSet.has(t));
const inCloneNotSrc = [...cloneSet].filter(t=>!srcSet.has(t));
console.log('source@390 unique text leaves:', srcSet.size);
console.log('clone@390 unique text leaves:', cloneSet.size);
console.log('in source NOT clone (we hid/missing):', inSrcNotClone.length);
console.log('  sample:', inSrcNotClone.slice(0,25));
console.log('in clone NOT source (we show extra):', inCloneNotSrc.length);
console.log('  sample:', inCloneNotSrc.slice(0,15));
await b.close();
