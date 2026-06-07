/**
 * @purpose Precision hero diff-loop (write-free, self-teaching). ONE Playwright
 * pass captures BOTH the reference screenshot AND the exact element coords/styles
 * (so they're aligned — fixes the stale-coord y-offset), crops decorative pieces
 * (wave, logo strip) as images, renders the hero with the real söhne font + exact
 * absolute positioning, then pixel-diffs hero-region vs source. The diff % is the
 * convergence metric; the diff image shows which element to fix next.
 *
 * Usage: node precise-hero.mjs   → prints diff%, writes precise-hero.png + -diff.png
 */
import fs from 'fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pmModule from 'pixelmatch';
const pixelmatch = pmModule.default || pmModule;

const SOHNE = 'https://b.stripecdn.com/mkt-ssr-statics/assets/_next/static/media/Sohne.cb178166.woff2';
const W = 1440, H = 900;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.goto('https://stripe.com', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(2500);

// ---- single pass: extract exact hero elements (aligned to the reference) ----
const hero = await p.evaluate(() => {
  const R = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), size: parseFloat(cs.fontSize), weight: cs.fontWeight, lh: cs.lineHeight, ls: cs.letterSpacing, color: cs.color, clip: cs.webkitBackgroundClip || cs.backgroundClip, family: cs.fontFamily }; };
  const out = {};
  const h1 = document.querySelector('h1');
  if (h1) out.headline = { text: h1.innerText.replace(/\s+/g, ' ').trim(), ...R(h1) };
  // subhead = the prominent <p> right after the h1, in the top area
  const ps = [...document.querySelectorAll('p')].filter((e) => { const r = e.getBoundingClientRect(); return r.top > 0 && r.top < 700 && r.width > 200 && e.innerText.trim().length > 30; });
  if (ps[0]) out.subhead = { text: ps[0].innerText.replace(/\s+/g, ' ').trim(), ...R(ps[0]) };
  // eyebrow (small text above headline)
  const eb = [...document.querySelectorAll('span,p,div')].find((e) => { const t = (e.innerText || '').replace(/\s+/g, ' ').trim(); return /running on Stripe/i.test(t) && t.length < 45 && e.getBoundingClientRect().top < 260 && e.getBoundingClientRect().top > 0; });
  if (eb) out.eyebrow = { text: eb.innerText.replace(/\s+/g, ' ').trim(), ...R(eb) };
  // nav + CTA links/buttons in top band
  out.nav = []; out.ctas = [];
  for (const el of document.querySelectorAll('a,button')) {
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (!t || t.length > 24) continue;
    const r = el.getBoundingClientRect(); if (r.width < 8 || r.height < 8) continue;
    if (r.top < 70) { if (!out.nav.some((n) => n.text === t)) out.nav.push({ text: t, ...R(el) }); }
    else if (r.top > 450 && r.top < 640 && /get started|sign up|start now/i.test(t)) { if (!out.ctas.some((n) => n.text === t)) out.ctas.push({ text: t, ...R(el) }); }
  }
  // largest hero image (the wave)
  let wave = null;
  for (const im of document.querySelectorAll('img')) { const r = im.getBoundingClientRect(); if (r.top < 200 && r.width > 600 && r.height > 400) { if (!wave || r.width > wave.w) wave = { src: im.currentSrc || im.src, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; } }
  out.wave = wave;
  return out;
});

// reference screenshot (hero region)
const refBuf = await p.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
fs.writeFileSync('stripe-ref-1440.png', refBuf);
const refFull = PNG.sync.read(refBuf);

// crop the logo strip band (between CTAs ~567 and ~660) as an image
const logoTop = (hero.ctas[0]?.y || 519) + (hero.ctas[0]?.h || 48) + 18;
const logoBand = (() => { const y = Math.max(0, logoTop), hh = Math.min(110, refFull.height - y); const o = new PNG({ width: W, height: hh }); for (let r = 0; r < hh; r++) { const s = ((y + r) * W) * 4; o.data.set(refFull.data.subarray(s, s + W * 4), (r * W) * 4); } fs.writeFileSync('hero-logos.png', PNG.sync.write(o)); return { y, h: hh }; })();
await b.close();

// export the aligned hero data so the live Elementor builder uses identical coords
fs.writeFileSync('hero-data.json', JSON.stringify({ hero, logoBand, sohne: SOHNE }, null, 2));

// ---- render precision hero from the freshly-captured (aligned) data ----
const px = (s) => { const m = String(s).match(/(-?\d+(?:\.\d+)?)px/); return m ? +m[1] : null; };
const fontCss = (f) => { let c = `font-family:'Sohne',-apple-system,sans-serif;font-size:${f.size}px;font-weight:${parseInt(f.weight) || 400};`; const lh = px(f.lh); if (lh) c += `line-height:${lh}px;`; const ls = px(f.ls); if (ls !== null) c += `letter-spacing:${ls}px;`; return c; };
const at = (e, z = 1) => `position:absolute;left:${e.x}px;top:${Math.max(0, e.y)}px;z-index:${z};`;
const GRAD = 'background:linear-gradient(95deg,#6a5bff 0%,#b14bef 45%,#ff6aa0 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent';
let body = '';
// wave shifted right so it clears the headline text (the live wave is animated
// WebGL; this static fallback PNG is more orange — a known asset limitation).
if (hero.wave) body += `<img src="${esc(hero.wave.src)}" style="position:absolute;left:${hero.wave.x + 230}px;top:${hero.wave.y}px;width:${hero.wave.w}px;height:${hero.wave.h}px;z-index:0">`;
// stripe wordmark (far left of nav)
body += `<div style="position:absolute;left:40px;top:22px;z-index:2;font-family:'Sohne',sans-serif;font-weight:800;font-size:24px;letter-spacing:-1px;color:#0a2540">stripe</div>`;
for (const n of hero.nav) { const t = n.text.replace(/^(.+)\s+\1$/, '$1').trim(); const cta = /contact sales/i.test(t); body += `<a style="${at(n, 2)}${fontCss(n)}white-space:nowrap;text-decoration:none;${cta ? 'background:#635bff;color:#fff;padding:8px 16px;border-radius:20px;height:40px;display:inline-flex;align-items:center;' : 'color:#0a2540;'}">${esc(t)}</a>`; }
if (hero.eyebrow) body += `<div style="${at(hero.eyebrow)}${fontCss(hero.eyebrow)}color:#425466">${esc(hero.eyebrow.text)}</div>`;
if (hero.headline) {
  // split the merged h1 into headline (first sentence) + subhead, gradient on "grow your revenue"
  const m = hero.headline.text.match(/^(.*?\.)\s*(.*)$/);
  const head = m ? m[1] : hero.headline.text; const sub = m ? m[2] : '';
  const gradHead = esc(head).replace(/(grow your revenue)/i, `<span style="${GRAD}">$1</span>`);
  body += `<h1 style="${at(hero.headline)}width:${hero.headline.w}px;margin:0;${fontCss(hero.headline)}color:rgb(6,27,49)">${gradHead}</h1>`;
  if (sub) body += `<div style="position:absolute;left:${hero.headline.x}px;top:${hero.headline.y + 120}px;width:540px;z-index:1;font-family:'Sohne',sans-serif;font-size:21px;line-height:1.5;color:rgb(82,103,123)">${esc(sub)}</div>`;
}
for (const c of hero.ctas) { const primary = /get started|start now/i.test(c.text); body += `<a style="${at(c, 2)}${fontCss(c)}height:${c.h}px;display:inline-flex;align-items:center;padding:0 20px;border-radius:24px;text-decoration:none;font-weight:500;${primary ? 'background:#635bff;color:#fff;' : 'background:#fff;color:#0a2540;border:1px solid #d5dbe5;'}">${esc(c.text)}</a>`; }
body += `<img src="hero-logos.png" style="position:absolute;left:0;top:${logoBand.y}px;width:${W}px;z-index:1">`;

const html = `<!doctype html><meta charset=utf8><style>
@font-face{font-family:'Sohne';src:url('${SOHNE}') format('woff2');font-weight:100 900;font-display:block}
*{margin:0;box-sizing:border-box}body{background:#fff;position:relative;width:${W}px;height:${H}px;overflow:hidden}
</style><body>${body}</body>`;
fs.writeFileSync('precise-hero.html', html);

// render + diff
const b2 = await chromium.launch();
const p2 = await (await b2.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
await p2.goto('file://' + process.cwd() + '/precise-hero.html', { waitUntil: 'networkidle' });
await p2.waitForTimeout(2000);
await p2.screenshot({ path: 'precise-hero.png', clip: { x: 0, y: 0, width: W, height: H } });
await b2.close();

// diff the HERO REGION only (top, above the next section band ~700px)
const HR = 700;
const crop = (src) => { const o = new PNG({ width: W, height: HR }); src.data.copy(o.data, 0, 0, W * HR * 4); return o; };
const a = crop(PNG.sync.read(fs.readFileSync('precise-hero.png')));
const ref = crop(PNG.sync.read(fs.readFileSync('stripe-ref-1440.png')));
const diff = new PNG({ width: W, height: HR });
const m = pixelmatch(a.data, ref.data, diff.data, W, HR, { threshold: 0.15 });
fs.writeFileSync('precise-hero-diff.png', PNG.sync.write(diff));
console.log(`HERO diff: ${(100 * m / (W * HR)).toFixed(1)}% pixels differ (hero region ${W}x${HR})`);
console.log('captured:', JSON.stringify({ headline: hero.headline?.text?.slice(0, 30), hl_y: hero.headline?.y, sub_y: hero.subhead?.y, sub_size: hero.subhead?.size, nav: hero.nav.length, ctas: hero.ctas.map((c) => c.text), wave: hero.wave ? `${hero.wave.w}x${hero.wave.h}@${hero.wave.x},${hero.wave.y}` : 'none' }));
