import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'fs';
import { resolveBase } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: never navigate/render a non-training host
const W = 1440;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
// §0 SAFETY GUARD: was hardcoded to the PAUSED shared host (navigation triggers server-side
// render + CSS regen = the overload path). Default to the local sandbox; resolveBase throws on a stray.
const url = `${resolveBase(process.env.JOIST_BASE || 'http://localhost:8001')}/?page_id=770`;
try { await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(url, { waitUntil:'load', timeout:30000 }); } catch(e){ console.error('nav fail', e.message); } }
await p.waitForTimeout(1500);
await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y=0;y<=h;y+=700){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,80));} window.scrollTo(0,0); });
await p.waitForTimeout(400);
const info = await p.evaluate(()=>({ pageH: document.documentElement.scrollHeight, title: document.title, h1: (document.querySelector('h1')||{}).innerText||'', wordmarks: [...document.querySelectorAll('header *, .elementor-location-header *')].map(e=>e.innerText).filter(t=>t&&t.length<20).slice(0,8) }));
console.log(JSON.stringify(info,null,2));
const buf = await p.screenshot({ fullPage: true });
fs.writeFileSync('/tmp/pico-clone-live.png', buf);
const png = PNG.sync.read(buf);
console.log('clone dims', png.width+'x'+png.height);
await browser.close();
