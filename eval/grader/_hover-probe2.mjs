/**
 * @purpose Render-verifier for the HYBRID_MOTION hover-lift slice. Loads a clone page, concatenates EVERY
 * readable stylesheet's text and greps for the authored `:hover{transform:translateY(-6px)}` rule, then forces
 * a REAL pointer hover on each card (by data-id) and diffs getComputedStyle().transform none→lift. Proves
 * whether Elementor actually COMPILED the per-element custom_css into the rendered post CSS (vs merely storing
 * it). Usage: node _hover-probe2.mjs <cloneUrl> [cardDataId...]
 */
import { chromium } from 'playwright';
const url = process.argv[2];
const targetIds = process.argv.slice(3); // card data-ids
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
await p.waitForTimeout(1500);
const info = await p.evaluate(() => {
  const sheets = [];
  let allText = '';
  for (const ss of document.styleSheets) {
    let readable = true, n = 0, txt = '';
    try { const rules = ss.cssRules; n = rules.length; for (const r of rules) txt += r.cssText + '\n'; }
    catch { readable = false; }
    allText += txt;
    sheets.push({ href: ss.href ? ss.href.split('/').slice(-1)[0] : '(inline)', readable, rules: n });
  }
  return {
    sheets,
    hasTranslateY: /translateY\(-6px\)/.test(allText),
    hasTransitionTransform: /transition:\s*transform/.test(allText),
    hoverTransformRuleCount: (allText.match(/:hover[^{]*\{[^}]*translateY\(-6px\)/g) || []).length,
    prefersReducedCount: (allText.match(/prefers-reduced-motion/g) || []).length,
  };
});
// real-hover transform diff on target card ids
const hoverResults = [];
for (const id of targetIds) {
  const sel = `.elementor-element-${id}`;
  const el = await p.$(sel);
  if (!el) { hoverResults.push({ id, found: false }); continue; }
  const before = await el.evaluate(e => getComputedStyle(e).transform);
  await el.hover({ force: true });
  await p.waitForTimeout(350);
  const after = await el.evaluate(e => getComputedStyle(e).transform);
  // move pointer away
  await p.mouse.move(5, 5);
  hoverResults.push({ id, found: true, before, after, lifted: before !== after && after !== 'none' });
}
console.log(JSON.stringify({ url, info, hoverResults }, null, 2));
await b.close();
