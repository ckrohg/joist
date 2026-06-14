import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await (await b.newContext({ viewport:{ width:1440, height:1600 }, deviceScaleFactor:1 })).newPage();
await p.goto("http://localhost:8001/?page_id=184", { waitUntil:'networkidle', timeout:60000 }).catch(()=>{});
await new Promise(r=>setTimeout(r,800));
await p.screenshot({ path:'/tmp/genz2/projection-spike/clone-top.png', clip:{x:0,y:0,width:1440,height:1600} });
// diagnose height: list the top-level container chain heights
const diag = await p.evaluate(()=>{
  const out=[];
  const top=document.querySelector('.elementor-section-wrap, .e-con, [data-elementor-type]');
  // walk first 3 levels of e-con and report heights + child counts
  function info(el,d){ if(!el||d>3) return; const r=el.getBoundingClientRect(); const kids=[...el.children].filter(c=>c.classList.contains('e-con')||c.classList.contains('elementor-widget')); out.push({d,cls:el.className.split(' ').slice(0,2).join('.'),h:Math.round(r.height),kids:kids.length}); for(const k of [...el.children].slice(0,2)) info(k,d+1); }
  const root=document.querySelector('.elementor');
  if(root) for(const k of [...root.children].slice(0,3)) info(k,0);
  return out.slice(0,20);
});
console.log(JSON.stringify(diag,null,1));
await b.close();
