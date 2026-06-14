import { chromium } from 'playwright';
const url = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage();
await p.setViewportSize({ width: 390, height: 900 });
await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(1500);
const info = await p.evaluate(() => {
  const root = document.querySelector('.e-con.e-parent') || document.querySelector('.elementor > .e-con');
  const pbEls = [...document.querySelectorAll('[id^="pb"]')];
  const vis = pbEls.filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return cs.display !== 'none' && r.width > 0 && r.height > 0; });
  const hidden = pbEls.filter(e => getComputedStyle(e).display === 'none');
  // sample positions of a few visible pb els
  const sample = vis.slice(0, 6).map(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { id: e.id, pos: cs.position, left: Math.round(r.left), top: Math.round(r.top + window.scrollY), w: Math.round(r.width) }; });
  // how many visible pb els are positioned absolute vs relative/static
  const absCount = vis.filter(e => getComputedStyle(e).position === 'absolute').length;
  const relCount = vis.filter(e => getComputedStyle(e).position === 'relative').length;
  return {
    docH: document.documentElement.scrollHeight,
    rootH: root ? Math.round(root.getBoundingClientRect().height) : null,
    rootMinH: root ? getComputedStyle(root).minHeight : null,
    pbTotal: pbEls.length, pbVisible: vis.length, pbHidden: hidden.length,
    pbAbsolute: absCount, pbRelative: relCount,
    maxBottom: Math.round(Math.max(0, ...vis.map(e => { const r = e.getBoundingClientRect(); return r.bottom + window.scrollY; }))),
    sample
  };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
