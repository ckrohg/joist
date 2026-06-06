#!/usr/bin/env node
/**
 * @purpose Write-free LOCAL preview of the hybrid clone, used by the autonomous
 * fidelity loop. Renders hero+text sections as faithful HTML (a proxy for the
 * Elementor widgets) and graphic-heavy sections as their pixel-exact captures,
 * so I can screenshot + compare to the real site and iterate WITHOUT any server
 * writes. When converged, build-tree.mjs deploys the same composition for real.
 *
 * Usage: node preview.mjs --tree tree.json --section-images section-images.json --out preview-hybrid.html
 */
import fs from 'fs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const tree = JSON.parse(fs.readFileSync(arg('tree', 'tree-stripe.json'), 'utf8'));
const si = JSON.parse(fs.readFileSync(arg('section-images', 'section-images.json'), 'utf8'));
const out = arg('out', 'preview-hybrid.html');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CTA = /^(get started|start now|sign up( with [\w ]+)?|contact sales)$/i; // sign in stays a text link
const heroIdx = tree.heroIdx ?? 0;

function heroSection(s) {
  const navL = s.blocks.filter((b) => b.type === 'button' && (b.font?.sizePx || 99) <= 15 && b.rect.y < 110);
  const heads = s.blocks.filter((b) => b.type === 'heading');
  const texts = s.blocks.filter((b) => b.type === 'text');
  const ctas = s.blocks.filter((b) => b.type === 'button' && !navL.includes(b) && (b.font?.sizePx || 0) >= 15);
  const wave = s.blocks.find((b) => b.type === 'image' && b.rect.w >= 0.6 * (s.rect.w || 1440));
  const eyebrow = texts.find((t) => t.text.length < 40);
  const sub = texts.find((t) => t.text.length >= 40);
  let h = '<div class="hero">';
  if (wave) h += `<div class="wave" style="background-image:url('${esc(wave.src)}')"></div>`;
  h += '<div class="w">';
  // nav
  h += '<div class="nav"><span class="logo">stripe</span><div class="navlinks">';
  h += navL.filter((b) => !CTA.test(b.text.trim()) && !/sign in/i.test(b.text)).map((b) => `<a>${esc(b.text)}</a>`).join('');
  h += '</div><div class="navact">';
  h += navL.filter((b) => /sign in/i.test(b.text)).map((b) => `<a>${esc(b.text)}</a>`).join('');
  h += navL.filter((b) => CTA.test(b.text.trim())).map((b) => `<a class="pill">${esc(b.text)}</a>`).join('');
  h += '</div></div>';
  // hero copy
  h += '<div class="herocopy">';
  if (eyebrow) h += `<div class="eyebrow">${esc(eyebrow.text)}</div>`;
  if (heads[0]) h += `<h1>${esc(heads[0].text)}</h1>`;
  if (sub) h += `<p class="sub">${esc(sub.text)}</p>`;
  h += '<div class="ctarow">';
  ctas.forEach((b, i) => { h += `<a class="${i === 0 ? 'cta' : 'cta2'}">${esc(b.text)}</a>`; });
  h += '</div></div>';
  if (fs.existsSync('sec-local-logos.png')) h += '<img class="logos" src="sec-local-logos.png">';
  h += '</div></div>';
  return h;
}

function widgetSection(s) {
  let h = '<div class="sec"><div class="w">';
  s.blocks.forEach((b) => {
    if (b.type === 'heading') { const lv = Math.min(3, b.level || 2); h += `<h${lv} style="font-size:${Math.min(48, b.font?.sizePx || 28)}px">${esc(b.text)}</h${lv}>`; }
    else if (b.type === 'text') { const big = (b.font?.sizePx || 16) >= 22; h += `<p class="${big ? 'sub' : 'small'}">${esc(b.text)}</p>`; }
    else if (b.type === 'button') { h += CTA.test(b.text.trim()) ? `<a class="cta">${esc(b.text)}</a>` : `<a class="lnk">${esc(b.text)}</a>`; }
    else if (b.type === 'image') { const w = Math.min(b.rect.w || 300, 1040); h += `<img style="width:${w}px" src="${esc(b.src)}">`; }
  });
  h += '</div></div>';
  return h;
}

// prefer a LOCAL crop if present (write-free iteration), else the uploaded URL
const band = (i) => fs.existsSync(`sec-local-${i}.png`) ? `sec-local-${i}.png` : si[i];
let body = '';
tree.sections.forEach((s, i) => {
  const src = band(i);
  if (src) { body += `<img class="band" src="${esc(src)}">`; return; }
  body += (i === heroIdx) ? heroSection(s) : widgetSection(s);
});

const html = `<!doctype html><meta charset=utf8><style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{margin:0;box-sizing:border-box}body{font-family:Inter,-apple-system,sans-serif;color:#0a2540;background:#fff}
.w{max-width:1080px;margin:0 auto;padding:0 24px;position:relative;z-index:2}
.band{display:block;width:100%}
.hero{position:relative;overflow:hidden;padding-bottom:40px}
.wave{position:absolute;top:0;right:0;width:55%;height:760px;background-size:cover;background-position:left center;z-index:1}
.nav{display:flex;align-items:center;gap:28px;padding:20px 0}
.logo{font-weight:800;font-size:22px;letter-spacing:-1px}
.navlinks{display:flex;gap:24px}.navlinks a{color:#0a2540;text-decoration:none;font-weight:500;font-size:15px}
.navact{margin-left:auto;display:flex;gap:14px;align-items:center}
.navact a{color:#635bff;text-decoration:none;font-weight:600;font-size:15px}
.navact a.pill{background:#635bff;color:#fff;padding:8px 16px;border-radius:20px}
.herocopy{max-width:600px;padding:70px 0 40px}
.eyebrow{font-size:13px;color:#425466;margin-bottom:18px;letter-spacing:.3px}
h1{font-size:54px;font-weight:600;letter-spacing:-1.5px;line-height:1.06;margin-bottom:22px}
.sub{font-size:21px;color:#425466;line-height:1.4;margin-bottom:28px;max-width:520px}
.ctarow{display:flex;gap:14px;align-items:center}
.cta{display:inline-block;background:#635bff;color:#fff;padding:11px 22px;border-radius:24px;font-weight:600;text-decoration:none}
.cta2{display:inline-block;background:#fff;color:#0a2540;border:1px solid #d5dbe5;padding:11px 22px;border-radius:24px;font-weight:600;text-decoration:none}
.sec{padding:56px 0}
.sec h2{font-size:34px;letter-spacing:-.5px;margin-bottom:10px}
.small{font-size:15px;color:#425466;margin:4px 0}.lnk{color:#635bff;text-decoration:none;margin-right:18px;font-weight:500}
.logos{display:block;width:100%;margin-top:18px}
</style><body>${body}</body>`;
fs.writeFileSync(out, html);
console.log('wrote', out, '(' + (html.length / 1024 | 0) + 'KB) | layout:', tree.sections.map((s, i) => si[i] ? `s${i}=IMG` : (i === heroIdx ? `s${i}=HERO` : `s${i}=widgets`)).join(' '));
