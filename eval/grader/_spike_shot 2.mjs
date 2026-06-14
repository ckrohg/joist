import { chromium } from 'playwright';
const url = process.argv[2], out = process.argv[3], w = +(process.argv[4]||1440);
const b = await chromium.launch({ headless: true });
const p = await (await b.newContext({ viewport:{ width:w, height:1200 }, deviceScaleFactor:1 })).newPage();
await p.goto(url, { waitUntil:'networkidle', timeout:60000 }).catch(()=>{});
await p.evaluate(async()=>{ window.scrollTo(0,document.body.scrollHeight); await new Promise(r=>setTimeout(r,800)); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,400)); });
const h = await p.evaluate(()=>document.body.scrollHeight);
// census of rendered widgets + zero-box detection
const census = await p.evaluate(()=>{
  const q=(s)=>document.querySelectorAll(s).length;
  const imgs=[...document.querySelectorAll('.elementor-widget-image img')];
  let zeroImg=0; for(const i of imgs){ const r=i.getBoundingClientRect(); if(r.width<2||r.height<2||!i.naturalWidth) zeroImg++; }
  const headings=[...document.querySelectorAll('.elementor-heading-title')];
  return { containers:q('.e-con'), headings:q('.elementor-widget-heading'), texts:q('.elementor-widget-text-editor'), buttons:q('.elementor-widget-button'), images:imgs.length, zeroImg, htmlw:q('.elementor-widget-html') };
});
console.log(JSON.stringify({ pageH:h, ...census }));
// clamp to avoid playwright's ~32767px surface limit; capture the top band + a full attempt.
const clampH = Math.min(h, 16000);
await p.setViewportSize({ width:w, height:clampH });
try { await p.screenshot({ path: out, clip:{ x:0, y:0, width:w, height:clampH } }); }
catch(e){ console.log('shot-clamp-fail', e.message.slice(0,80)); await p.screenshot({ path: out }); }
await b.close();
