/**
 * @purpose Generalized precision-section harness (Phase 2): capture ANY section's
 * visible text/button/image elements same-pass with coords RELATIVE to the section
 * top, render them as precision-positioned elements with the real font, and
 * pixel-diff vs the source section band. Proves precision generalizes beyond the
 * hero. Write-free local loop; feeds build-precise.mjs for the live deploy.
 *
 * Usage: node precise-section.mjs --section 7 [--url https://stripe.com]
 */
import fs from 'fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pmModule from 'pixelmatch';
const pixelmatch = pmModule.default || pmModule;

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SOHNE = 'https://b.stripecdn.com/mkt-ssr-statics/assets/_next/static/media/Sohne.cb178166.woff2';
const url = arg('url', 'https://stripe.com');
const idx = parseInt(arg('section', '7'), 10);
const tree = JSON.parse(fs.readFileSync('tree-stripe.json', 'utf8'));
const sec = tree.sections[idx];
const W = 1440, H = Math.min(900, sec.rect.h + 20);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const px = (s) => { const m = String(s).match(/(-?\d+(?:\.\d+)?)px/); return m ? +m[1] : null; };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(2000);
await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); } window.scrollTo(0, 0); });
await p.waitForTimeout(900);

// Re-anchor to the section's own first element FRESH (tree coords are stale across
// loads). y0_fresh = anchor's current absY − its known offset within the section.
const anchorBlk = sec.blocks.find((b) => b.text) || sec.blocks[0];
const anchorOffset = (anchorBlk?.rect?.y ?? sec.rect.y) - sec.rect.y;
const els = await p.evaluate(({ anchorText, anchorOffset, secH }) => {
  const out = []; const seen = new Set();
  const hasOwn = (e) => { for (const n of e.childNodes) if (n.nodeType === 3 && (n.textContent || '').trim()) return true; return false; };
  const localBg = (el) => { let n = el; while (n && n !== document.documentElement) { const bb = getComputedStyle(n).backgroundColor; if (bb && bb !== 'rgba(0, 0, 0, 0)' && bb !== 'transparent') return bb; n = n.parentElement; } return 'rgb(255,255,255)'; };
  // find the anchor element fresh → derive the current section top
  let anchorAbs = null;
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,div')) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
    if (own && own.startsWith(anchorText.slice(0, 30))) { anchorAbs = el.getBoundingClientRect().top + window.scrollY; break; }
  }
  const y0 = (anchorAbs !== null ? anchorAbs - anchorOffset : 0);
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,a,button,span,div,img')) {
    const r = el.getBoundingClientRect(); const absY = r.top + window.scrollY;
    if (absY < y0 - 2 || absY > y0 + secH || r.width < 4 || r.height < 4) continue; // within the section band (absolute)
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
    const tag = el.tagName.toLowerCase();
    const rel = Math.round(absY - y0);
    if (tag === 'img') { const src = el.currentSrc || el.src; if (!src || src.startsWith('data:') || r.width < 40) continue; if (seen.has('i' + src)) continue; seen.add('i' + src); out.push({ type: 'image', src, x: Math.round(r.left), y: rel, w: Math.round(r.width), h: Math.round(r.height) }); continue; }
    const isH = /^h[1-6]$/.test(tag), isBtn = tag === 'a' || tag === 'button';
    if (!isH && !isBtn && !hasOwn(el)) continue;
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (!t || t.length > 300) continue;
    const k = tag + t.toLowerCase() + Math.round(rel / 4); if (seen.has(k)) continue; seen.add(k);
    if (!isH && !isBtn && parseFloat(cs.fontSize) < 12) continue;
    out.push({ type: isH ? 'heading' : (isBtn ? 'button' : 'text'), tag, text: t, x: Math.round(r.left), y: rel, w: Math.round(r.width), h: Math.round(r.height), size: parseFloat(cs.fontSize), weight: cs.fontWeight, lh: cs.lineHeight, ls: cs.letterSpacing, color: cs.color, bg: localBg(el), align: cs.textAlign, radius: cs.borderTopLeftRadius });
  }
  return { y0, els: out };
}, { anchorText: anchorBlk?.text || '', anchorOffset, secH: sec.rect.h });
const freshY0 = els.y0; const elList = els.els;

// reference = crop the section band at the FRESH y0 (aligned with the captured elements)
const full = PNG.sync.read(await p.screenshot({ fullPage: true }));
await b.close();
{ const y = Math.max(0, Math.round(freshY0)), hh = Math.min(H, full.height - y); const o = new PNG({ width: W, height: hh }); for (let r = 0; r < hh; r++) { const s = ((y + r) * full.width) * 4; o.data.set(full.data.subarray(s, s + W * 4), (r * W) * 4); } fs.writeFileSync(`sec${idx}-ref.png`, PNG.sync.write(o)); }
fs.writeFileSync(`sec${idx}-data.json`, JSON.stringify({ idx, rect: sec.rect, els }, null, 2));

// ---- render precision section ----
const fontCss = (e) => { let c = `font-family:'Sohne',sans-serif;font-size:${e.size}px;font-weight:${parseInt(e.weight) || 400};`; const lh = px(e.lh); if (lh) c += `line-height:${lh}px;`; const ls = px(e.ls); if (ls !== null && e.ls !== 'normal') c += `letter-spacing:${ls}px;`; return c; };
const isCTA = (t) => /^(get started|start now|sign up|contact sales|subscribe|create an account)/i.test(t.trim());
let body = '';
for (const e of elList) {
  const at = `position:absolute;left:${e.x}px;top:${Math.max(0, e.y)}px;`;
  if (e.type === 'image') { body += `<img src="${esc(e.src)}" style="${at}width:${e.w}px;height:${e.h}px">`; continue; }
  if (e.type === 'button') {
    if (isCTA(e.text)) body += `<a style="${at}${fontCss(e)}display:inline-flex;align-items:center;height:${e.h}px;padding:0 18px;background:#635bff;color:#fff;border-radius:24px;text-decoration:none">${esc(e.text)}</a>`;
    else body += `<a style="${at}${fontCss(e)}color:${e.color};text-decoration:none;white-space:nowrap">${esc(e.text)}</a>`;
    continue;
  }
  const tagName = e.type === 'heading' ? 'div' : 'div';
  body += `<${tagName} style="${at}width:${e.w + 6}px;${fontCss(e)}color:${e.color};margin:0">${esc(e.text)}</${tagName}>`;
}
const html = `<!doctype html><meta charset=utf8><style>
@font-face{font-family:'Sohne';src:url('${SOHNE}') format('woff2');font-weight:100 900;font-display:block}
*{margin:0;box-sizing:border-box}body{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${sec.bg || '#fff'};font-family:'Sohne',sans-serif}
</style><body>${body}</body>`;
fs.writeFileSync(`sec${idx}-precise.html`, html);

const b2 = await chromium.launch();
const p2 = await (await b2.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
await p2.goto('file://' + process.cwd() + `/sec${idx}-precise.html`, { waitUntil: 'networkidle' });
await p2.waitForTimeout(1800);
await p2.screenshot({ path: `sec${idx}-precise.png`, clip: { x: 0, y: 0, width: W, height: H } });
await b2.close();

const a = PNG.sync.read(fs.readFileSync(`sec${idx}-precise.png`));
const ref = PNG.sync.read(fs.readFileSync(`sec${idx}-ref.png`));
const hh = Math.min(a.height, ref.height);
const diff = new PNG({ width: W, height: hh });
const m = pixelmatch(a.data, ref.data, diff.data, W, hh, { threshold: 0.15 });
fs.writeFileSync(`sec${idx}-diff.png`, PNG.sync.write(diff));
console.log(`SECTION ${idx} diff: ${(100 * m / (W * hh)).toFixed(1)}% | ${elList.length} elements (${elList.filter(e => e.type === 'heading').length}h ${elList.filter(e => e.type === 'text').length}t ${elList.filter(e => e.type === 'button').length}b ${elList.filter(e => e.type === 'image').length}i)`);
