// @purpose (a) source docH @390 (the target), (b) clone height decomposition: imgWidgets / non-img abs / con / margins / header
import { chromium } from 'playwright';
import { resolveBase } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: clone probe must target a training host

// §0 SAFETY GUARD: the clone `url`s were hardcoded to the PAUSED shared host (navigation triggers
// server-side render + CSS regen = the overload path). Rebuild them on the guarded training base; the
// external `src`s are public sites being probed, not WP hosts we write to, so they stay as-is.
const B = resolveBase(process.env.JOIST_BASE || 'http://localhost:8001');
const CLONES = [
  { name: 'supabase', url: `${B}/native-flextree-supabase/`, src: 'https://supabase.com/' },
  { name: 'framer',   url: `${B}/native-flextree-framer/`,   src: 'https://www.framer.com/' },
];

const cloneProbe = async (page) => page.evaluate(() => {
  const docH = document.documentElement.scrollHeight;
  const root = document.querySelector('body .elementor > .e-con.e-parent') || document.querySelector('.e-con.e-parent');
  let imgH = 0, imgN = 0, otherAbsH = 0, otherAbsN = 0, conH = 0, conN = 0, marginSum = 0, headerH = 0;
  if (root) {
    for (const c of root.children) {
      const r = c.getBoundingClientRect();
      const h = r.height;
      const mb = parseFloat(getComputedStyle(c).marginBottom) || 0;
      marginSum += mb;
      const isAbs = c.classList.contains('elementor-absolute');
      const isImg = c.classList.contains('elementor-widget-image');
      const isCon = c.classList.contains('e-con') || c.classList.contains('e-con-inner');
      const pos = getComputedStyle(c).position;
      if (pos === 'fixed') { headerH += h; continue; }
      if (isAbs && isImg) { imgH += h; imgN++; }
      else if (isAbs) { otherAbsH += h; otherAbsN++; }
      else if (isCon) { conH += h; conN++; }
    }
  }
  return { docH, imgH: Math.round(imgH), imgN, otherAbsH: Math.round(otherAbsH), otherAbsN, conH: Math.round(conH), conN, marginSum: Math.round(marginSum), headerH: Math.round(headerH) };
});

const srcProbe = async (page) => page.evaluate(() => ({ docH: document.documentElement.scrollHeight, innerW: window.innerWidth }));

const browser = await chromium.launch();
const out = {};
for (const c of CLONES) {
  // clone
  const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p1 = await ctx1.newPage();
  await p1.goto(c.url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  await p1.waitForTimeout(1500);
  const clone = await cloneProbe(p1);
  await ctx1.close();
  // source
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const p2 = await ctx2.newPage();
  let src = { docH: 0, innerW: 0, err: null };
  try { await p2.goto(c.src, { waitUntil: 'networkidle', timeout: 60000 }); await p2.waitForTimeout(2000); src = await srcProbe(p2); }
  catch (e) { src.err = String(e).slice(0, 80); }
  await ctx2.close();

  out[c.name] = { clone, src };
  console.log(`\n================ ${c.name} ================`);
  console.log(`SOURCE @390: docH=${src.docH} innerW=${src.innerW} ${src.err ? '(ERR ' + src.err + ')' : ''}`);
  console.log(`CLONE  @390: docH=${clone.docH}`);
  console.log(`  ratio clone/source = ${src.docH ? (clone.docH / src.docH).toFixed(2) : 'n/a'}x`);
  console.log(`  DECOMPOSITION:`);
  console.log(`    image widgets : n=${clone.imgN}  sumH=${clone.imgH}px  (${(clone.imgH / clone.docH * 100).toFixed(0)}% of docH)`);
  console.log(`    other abs     : n=${clone.otherAbsN}  sumH=${clone.otherAbsH}px  (${(clone.otherAbsH / clone.docH * 100).toFixed(0)}%)`);
  console.log(`    e-con grids   : n=${clone.conN}  sumH=${clone.conH}px  (${(clone.conH / clone.docH * 100).toFixed(0)}%)`);
  console.log(`    margins (12px): ${clone.marginSum}px  (${(clone.marginSum / clone.docH * 100).toFixed(0)}%)`);
  console.log(`    fixed header  : ${clone.headerH}px`);
  console.log(`    [sum of direct-child cats: ${clone.imgH + clone.otherAbsH + clone.conH + clone.marginSum}px vs docH ${clone.docH}]`);
}
await browser.close();
console.log('\n===JSON===\n' + JSON.stringify(out, null, 2));
