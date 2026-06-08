import { chromium } from 'playwright';
const url = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
// collect all stylesheet text + inline styles, count pb media rules
const info = await p.evaluate(() => {
  let css = '';
  for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) css += r.cssText + '\n'; } catch {} }
  const pbIds = [...document.querySelectorAll('[id^="pb"]')].map(e => e.id);
  const mq767 = (css.match(/max-width: ?767px/g) || []).length;
  const mq768 = (css.match(/min-width: ?768px/g) || []).length;
  const pbRules = (css.match(/#pb\d+-\d+-\d+-\d+/g) || []).length;
  const dispNone = (css.match(/display: ?none ?!important/g) || []).length;
  return { totalCssLen: css.length, pbIdsInDom: pbIds.length, samplePbIds: pbIds.slice(0,4), mq767, mq768, pbRulesInCss: pbRules, dispNoneRules: dispNone, docH: document.documentElement.scrollHeight };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
