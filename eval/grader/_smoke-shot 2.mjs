import { chromium } from 'playwright';
const url = process.argv[2];
const out = process.argv[3] || '/tmp/joist-smoke.png';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await p.waitForTimeout(1200);
await p.screenshot({ path: out, fullPage: true });
// inspect: did the widgets render styled?
const info = await p.evaluate(() => {
  const h = document.querySelector('.elementor-heading-title');
  const btn = document.querySelector('.elementor-button');
  const cs = el => el ? getComputedStyle(el) : null;
  const hcs = cs(h), bcs = cs(btn);
  const cont = document.querySelector('.e-con, .elementor-container, .elementor-section');
  return {
    headingText: h ? h.textContent.trim() : null,
    headingColor: hcs ? hcs.color : null,
    headingFontSize: hcs ? hcs.fontSize : null,
    buttonText: btn ? btn.textContent.trim() : null,
    buttonBg: bcs ? bcs.backgroundColor : null,
    buttonColor: bcs ? bcs.color : null,
    buttonRadius: bcs ? bcs.borderTopLeftRadius : null,
    containerBg: cont ? getComputedStyle(cont).backgroundColor : null,
    elementorCssLinks: [...document.querySelectorAll('link[href*="elementor"],link[id*="elementor"]')].map(l=>l.href).length,
    inlineElementorStyle: !!document.querySelector('style[id*="elementor"]'),
  };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
