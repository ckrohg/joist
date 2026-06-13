import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
await p.setViewportSize({ width: 390, height: 900 });
await p.goto(process.argv[2], { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(1200);
const info = await p.evaluate(() => {
  const sw = document.documentElement.scrollWidth, vw = window.innerWidth;
  // find pb elements that exceed the viewport (right edge > vw or left < 0)
  const offenders = [...document.querySelectorAll('[id^="pb"]')].map(e=>{const r=e.getBoundingClientRect();return {id:e.id,left:Math.round(r.left),right:Math.round(r.right),w:Math.round(r.width)};}).filter(o=>o.right>vw+2||o.left<-2).slice(0,15);
  return { scrollWidth: sw, viewportWidth: vw, overflow: sw>vw, offenderCount: offenders.length, offenders };
});
console.log(JSON.stringify(info,null,2));
await b.close();
