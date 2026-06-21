import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://localhost:8001/?page_id=834', { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
await p.waitForTimeout(1500);
const r = await p.evaluate(() => {
  const types = {};
  for (const el of document.querySelectorAll('[class*="elementor-widget-"]')) {
    const m = (el.className.match(/elementor-widget-(\w[\w-]*)/)||[])[1];
    if (m) types[m] = (types[m]||0)+1;
  }
  return { widgetTypes: types, totalWidgets: Object.values(types).reduce((a,b)=>a+b,0), containers: document.querySelectorAll('.e-con').length };
});
console.log(JSON.stringify(r,null,1));
await b.close();
