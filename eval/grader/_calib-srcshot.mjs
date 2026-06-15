import { chromium } from 'playwright';
import { assertNotBlocked } from '../../sandbox/host-guard.mjs';
const url=process.argv[2], out=process.argv[3], width=+(process.argv[4]||1440), maxH=+(process.argv[5]||0);
assertNotBlocked(url);
const b=await chromium.launch({args:['--disable-blink-features=AutomationControlled']});
const ctx=await b.newContext({viewport:{width,height:1000},deviceScaleFactor:1,userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'});
const p=await ctx.newPage();
await p.goto(url,{waitUntil:'networkidle',timeout:60000}).catch(()=>{});
await p.evaluate(async()=>{window.scrollTo(0,document.body.scrollHeight);await new Promise(r=>setTimeout(r,800));window.scrollTo(0,0);if(document.fonts?.ready){try{await document.fonts.ready}catch{}}await new Promise(r=>setTimeout(r,500));});
const h=await p.evaluate(()=>document.body.scrollHeight);
if(maxH>0){await p.setViewportSize({width,height:Math.min(maxH,16000)});await p.screenshot({path:out});}
else{await p.screenshot({path:out,fullPage:true});}
console.log(JSON.stringify({h,shot:out}));
await b.close();
