// @purpose Check audience band (Go beyond editing) + confirm grader-mode fullPage void persistence.
import { chromium } from 'playwright';
import { resolveBase } from '../../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: never navigate a non-training host
import path from 'path';
const OUT = '/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/.indep-void';
const CLONE = `${resolveBase(process.env.JOIST_BASE || 'http://localhost:8001')}/?page_id=2988`;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(CLONE, { waitUntil: 'load', timeout: 60000 }).catch(()=>{});
await page.waitForTimeout(1500);
// scroll to the audience band (~y6000-6700 'Go beyond editing')
await page.evaluate(() => { const el=[...document.querySelectorAll('img')].find(i=>(i.currentSrc||i.src||'').match(/audience|analytics|zoom/i)); if(el) el.scrollIntoView({block:'center'}); else window.scrollTo(0,6200); });
await page.waitForTimeout(3500);
await page.screenshot({ path: path.join(OUT,'audience-inview.png') });
const aud = await page.evaluate(() => {
  const out=[]; for(const im of document.querySelectorAll('img')){ const r=im.getBoundingClientRect(); const top=r.top+window.scrollY; if(top>=5600&&top<=7200){ out.push({top:Math.round(top),w:Math.round(r.width),h:Math.round(r.height),nat:im.naturalWidth+'x'+im.naturalHeight,complete:im.complete,src:(im.currentSrc||im.src||'').slice(0,110)});}} return out;
});
console.log('AUDIENCE BAND IMGS:', JSON.stringify(aud,null,1));
// Now grader-mode: force every lazy img eager (as capture does), reload-scan whole page, full-page shot
await page.evaluate(()=>{ for(const im of document.querySelectorAll('img')){ try{ if(im.loading==='lazy') im.loading='eager'; const ss=im.getAttribute('data-srcset')||im.getAttribute('srcset'); }catch{} } });
await page.evaluate(async()=>{ const h=document.body.scrollHeight; for(let y=0;y<h;y+=400){window.scrollTo(0,y); await new Promise(r=>setTimeout(r,90));} window.scrollTo(0,0); });
await page.waitForTimeout(2500);
const metricsState = await page.evaluate(()=>{ const im=[...document.querySelectorAll('img')].find(i=>(i.currentSrc||i.src||'').includes('image-68-scaled')); return im?{nat:im.naturalWidth+'x'+im.naturalHeight,complete:im.complete,loading:im.loading}:{missing:true}; });
console.log('METRICS after eager+full-scroll (grader-mode):', JSON.stringify(metricsState));
await page.screenshot({ path: path.join(OUT,'clone-gradermode-full.png'), fullPage:true });
await browser.close();
