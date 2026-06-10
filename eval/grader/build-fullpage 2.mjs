#!/usr/bin/env node
/**
 * @purpose Phase 2 finale: assemble + deploy the FULL-PAGE precision Stripe clone
 * in real editable Elementor — precision hero + captured image bands (s1–s6) +
 * precision text sections (s7 CTA, s8 footer), in document order. Each precision
 * section is a self-contained scope (container _element_id + absolute-positioned
 * native widgets + injected CSS), real söhne font. One combined <style> block.
 *
 * Env: JOIST_BASE, JOIST_AUTH_B64.  Usage: node build-fullpage.mjs --title "..."
 */
import fs from 'fs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const base = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
const b64 = process.env.JOIST_AUTH_B64; if (!b64) { console.error('missing JOIST_AUTH_B64'); process.exit(2); }
const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'agent-fullpage' };
const title = arg('title', 'Stripe Full-Page Precision');
// hosted same-origin (Stripe's CDN blocks cross-origin fonts via CORS → must self-host)
const SOHNE = fs.existsSync('sohne-url.txt') ? fs.readFileSync('sohne-url.txt', 'utf8').trim() : 'https://b.stripecdn.com/mkt-ssr-statics/assets/_next/static/media/Sohne.cb178166.woff2';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const px = (s) => { const m = String(s).match(/(-?\d+(?:\.\d+)?)px/); return m ? +m[1] : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isCTA = (t) => /^(get started|start now|sign up|contact sales|subscribe|create an account)/i.test(String(t).trim());
const container = (settings, elements = []) => ({ elType: 'container', settings, elements });

const heroData = JSON.parse(fs.readFileSync('hero-data.json', 'utf8'));
const sec7 = JSON.parse(fs.readFileSync('sec7-data.json', 'utf8'));
const sec8 = JSON.parse(fs.readFileSync('sec8-data.json', 'utf8'));
const si = JSON.parse(fs.readFileSync('section-images.json', 'utf8'));
const tree = JSON.parse(fs.readFileSync('tree-stripe.json', 'utf8'));

const css = [
  `@font-face{font-family:'SohneClone';src:url('${SOHNE}') format('woff2');font-weight:100 900;font-display:swap}`,
  // force captured bands to render full 1440 width (Elementor boxes them to ~1240)
  `.czbandimg img{width:1440px !important;max-width:none !important;height:auto !important;display:block;margin:0 auto}`,
  `.czbandimg .elementor-widget-container{text-align:center}`,
];

// generic precision section: scope container + absolute-positioned native widgets
function precisionSection(scopeId, heightPx, bg, els) {
  css.push(`#${scopeId}{position:relative !important;height:${heightPx}px;background:${bg || '#fff'};overflow:hidden;font-family:'SohneClone',-apple-system,sans-serif}`);
  css.push(`#${scopeId}>.e-con-inner{height:100%;max-width:none;padding:0;display:block}`);
  css.push(`#${scopeId} .elementor-widget-container{padding:0 !important;margin:0 !important}`);
  css.push(`#${scopeId} .czwave img{width:100% !important;height:100% !important;object-fit:fill;display:block}`);
  const widgets = [];
  els.forEach((e, i) => {
    const cls = `${scopeId}-${i}`;
    css.push(`.${cls}{position:absolute !important;margin:0 !important;left:${e.x}px;top:${e.y}px;${e.w ? `width:${e.w}px;` : ''}z-index:${e.z ?? 1}}`);
    const font = () => { let c = `font-family:'SohneClone',sans-serif;font-size:${e.size}px;font-weight:${parseInt(e.weight) || 400};`; const lh = px(e.lh); if (lh) c += `line-height:${lh}px;`; const ls = px(e.ls); if (ls !== null && e.ls !== 'normal') c += `letter-spacing:${ls}px;`; return c; };
    let w;
    if (e.type === 'image') { w = { elType: 'widget', widgetType: 'image', settings: { image: { url: e.src }, image_size: 'full', _css_classes: (e.wave ? 'czwave ' : '') + cls } }; }
    else if (e.type === 'rich') { css.push(`.${cls} .elementor-widget-container{${font()}color:${e.color || 'rgb(6,27,49)'}}`); css.push(`.${cls} *{margin:0}`); w = { elType: 'widget', widgetType: 'text-editor', settings: { editor: e.html, _css_classes: cls } }; }
    else if (e.type === 'heading') { css.push(`.${cls} .elementor-heading-title{${font()}color:${e.color || 'rgb(6,27,49)'};margin:0}`); w = { elType: 'widget', widgetType: 'heading', settings: { title: e.text, header_size: e.tag && /^h[1-6]$/.test(e.tag) ? e.tag : 'h2', _css_classes: cls } }; }
    else if (e.type === 'button' && isCTA(e.text)) { w = { elType: 'widget', widgetType: 'button', settings: { text: e.text, background_background: 'classic', background_color: '#635bff', button_text_color: '#fff', border_radius: { unit: 'px', top: '24', right: '24', bottom: '24', left: '24', isLinked: true }, text_padding: { unit: 'px', top: '12', right: '18', bottom: '12', left: '18', isLinked: false }, _css_classes: cls } }; }
    else if (e.type === 'button') { css.push(`.${cls} .elementor-widget-container{${font()}}`); css.push(`.${cls} a{color:${e.color || '#0a2540'};text-decoration:none;white-space:nowrap}`); w = { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<a>${esc(e.text)}</a>`, _css_classes: cls } }; }
    else { css.push(`.${cls} .elementor-widget-container{${font()}color:${e.color || '#425466'};white-space:${e.nowrap ? 'nowrap' : 'normal'}}`); w = { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<div>${esc(e.text)}</div>`, _css_classes: cls } }; }
    widgets.push(w);
  });
  return container({ content_width: 'full', _element_id: scopeId, _padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } }, widgets);
}

function imageBand(url) {
  return container({ content_width: 'full', flex_align_items: 'center', _padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } },
    [{ elType: 'widget', widgetType: 'image', settings: { image: { url }, image_size: 'full', align: 'center', width: { unit: 'px', size: '1440' }, _element_width: 'initial', _css_classes: 'czbandimg' } }]);
}

// ---- hero els (convert hero-data into the generic element format) ----
const GRAD = 'background:linear-gradient(95deg,#6a5bff 0%,#b14bef 45%,#ff6aa0 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent';
function heroEls(logoUrl) {
  const h = heroData.hero; const out = [];
  if (h.wave) out.push({ type: 'image', src: h.wave.src, x: h.wave.x + 230, y: h.wave.y, w: h.wave.w, h: h.wave.h, z: 0, wave: true }); // shift right, clear text
  out.push({ type: 'text', text: 'stripe', x: 40, y: 22, size: 24, weight: '800', ls: '-1px', color: '#0a2540', z: 2, nowrap: true }); // wordmark
  const navClean = []; for (const n of h.nav) { let t = n.text.replace(/^(.+)\s+\1$/, '$1').trim(); if (/guide me/i.test(t)) continue; if (navClean.some((x) => x.text === t)) continue; navClean.push({ ...n, text: t }); }
  for (const n of navClean) out.push({ type: 'button', text: n.text, x: n.x, y: n.y, size: n.size, weight: n.weight, lh: n.lh, ls: n.ls, color: '#0a2540', z: 2 });
  if (h.eyebrow) out.push({ type: 'text', text: h.eyebrow.text, x: h.eyebrow.x, y: h.eyebrow.y, w: h.eyebrow.w + 80, size: h.eyebrow.size, weight: h.eyebrow.weight, lh: h.eyebrow.lh, ls: h.eyebrow.ls, color: '#425466', nowrap: true });
  if (h.headline) {
    // split merged h1 into headline (first sentence, gradient on "grow your revenue") + gray subhead
    const m = h.headline.text.match(/^(.*?\.)\s*(.*)$/); const head = m ? m[1] : h.headline.text; const sub = m ? m[2] : '';
    const gradHead = esc(head).replace(/(grow your revenue)/i, `<span style="${GRAD}">$1</span>`);
    // inline font on the content so Elementor's text-editor defaults can't shrink it
    const hf = `font-family:'SohneClone',sans-serif;font-size:${h.headline.size}px;font-weight:${parseInt(h.headline.weight) || 300};line-height:${px(h.headline.lh) || 55}px;letter-spacing:${px(h.headline.ls) || 0}px`;
    out.push({ type: 'rich', html: `<div style="${hf};color:rgb(6,27,49);margin:0">${gradHead}</div>`, x: h.headline.x, y: h.headline.y, w: h.headline.w });
    if (sub) out.push({ type: 'rich', html: `<div style="font-family:'SohneClone',sans-serif;font-size:21px;line-height:32px;color:rgb(82,103,123);margin:0">${esc(sub)}</div>`, x: h.headline.x, y: h.headline.y + 120, w: 540 });
  }
  h.ctas.forEach((c) => out.push({ type: 'button', text: c.text, x: c.x, y: c.y, size: c.size, weight: c.weight, lh: c.lh, ls: c.ls, z: 2 }));
  if (logoUrl) out.push({ type: 'image', src: logoUrl, x: 0, y: heroData.logoBand.y, w: 1440 });
  return out;
}

async function jp(method, path, body) {
  for (let a = 0; a < 12; a++) { const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 200) }; } if (r.status === 429) { await sleep(Math.max((j.details?.retry_after || 2), (a + 1) * 2) * 1000 + 500); continue; } if (!r.ok) console.error(method, path, r.status, JSON.stringify(j).slice(0, 200)); return { status: r.status, j }; }
  return { status: 429, j: {} };
}

async function uploadPng(file, name) { const r = await fetch(base + '/wp-json/wp/v2/media', { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="${name}"` }, body: fs.readFileSync(file) }); const j = await r.json(); return r.ok ? j.source_url : null; }

(async () => {
  const logoUrl = fs.existsSync('hero-logos.png') ? await uploadPng('hero-logos.png', 'stripe-hero-logos.png') : null;
  await sleep(2000);
  const sections = [];
  sections.push(precisionSection('czhero', 700, '#fff', heroEls(logoUrl)));        // s0 hero
  for (let i = 1; i <= 6; i++) if (si[i]) sections.push(imageBand(si[i]));          // s1–s6 image bands
  sections.push(precisionSection('czs7', tree.sections[7].rect.h, tree.sections[7].bg, sec7.els.els)); // s7 CTA
  sections.push(precisionSection('czs8', tree.sections[8].rect.h, tree.sections[8].bg, sec8.els.els)); // s8 footer
  const styleWidget = { elType: 'widget', widgetType: 'html', settings: { html: `<style>${css.join('\n')}</style>` } };
  const root = container({ content_width: 'full', flex_direction: 'column', flex_gap: { unit: 'px', size: '0' }, _padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } }, [styleWidget, ...sections]);
  const count = (e) => 1 + (e.elements || []).reduce((a, c) => a + count(c), 0);
  console.log('full-page tree:', count(root), 'elements |', sections.length, 'sections | css rules:', css.length);
  const create = await jp('POST', '/wp-json/joist/v1/plans', { intent: 'full-page precision clone', title, page_id: 0, steps: [{ op: 'insert', parent_id: 'root', position: 0, element: root }] });
  const planId = create.j.plan_id, token = create.j.approval_token;
  if (!planId) { console.error('create failed', JSON.stringify(create.j).slice(0, 300)); process.exit(1); }
  console.log('plan', planId);
  await sleep(3000); await jp('POST', `/wp-json/joist/v1/plans/${planId}/approve`, { approval_token: token });
  await sleep(3000); const ex = await jp('POST', `/wp-json/joist/v1/plans/${planId}/execute`, {});
  console.log('execute ->', ex.status);
  await sleep(2000);
  const g = await jp('GET', `/wp-json/joist/v1/plans/${planId}`, null);
  const pg = await jp('GET', `/wp-json/wp/v2/pages/${g.j.page_id}?context=edit`, null);
  console.log('PAGE_URL:', pg.j.link || ('(page ' + g.j.page_id + ')'));
})();
