#!/usr/bin/env node
/**
 * @purpose LIVE precision port: builds the Stripe hero in real Elementor as
 * native, EDITABLE widgets positioned at the exact captured coordinates via an
 * injected <style> block, with the real söhne font loaded — replicating the
 * locally-proven 95% precision hero. Captured graphic bands (section-images.json)
 * render below as image widgets. Deploys via the Joist plan API.
 *
 * Env: JOIST_BASE, JOIST_AUTH_B64. Usage: node build-precise.mjs --title "..."
 */
import fs from 'fs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
// §0 SAFETY GUARD: default flipped from the PAUSED shared host georges232.sg-host.com → local sandbox;
// resolveBase() throws LOUDLY before any fetch/PUT if JOIST_BASE points to a non-training host.
import { resolveBase } from '../../sandbox/host-guard.mjs';
const base = resolveBase(process.env.JOIST_BASE || 'http://localhost:8001');
const b64 = process.env.JOIST_AUTH_B64;
if (!b64) { console.error('missing JOIST_AUTH_B64'); process.exit(2); }
const D = JSON.parse(fs.readFileSync('hero-data.json', 'utf8'));
const hero = D.hero, SOHNE = D.sohne;
const si = JSON.parse(fs.readFileSync('section-images.json', 'utf8'));
const tree = JSON.parse(fs.readFileSync('tree-stripe.json', 'utf8'));
const title = arg('title', 'Stripe Precision Hero');
const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'agent-precise' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const px = (s) => { const m = String(s).match(/(-?\d+(?:\.\d+)?)px/); return m ? +m[1] : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- upload the logo-strip crop so the live page can show it ----
async function uploadPng(file, name) {
  const r = await fetch(base + '/wp-json/wp/v2/media', { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="${name}"` }, body: fs.readFileSync(file) });
  const j = await r.json(); if (!r.ok) { console.error('upload', r.status, JSON.stringify(j).slice(0, 150)); return null; } return j.source_url;
}

// ---- build the hero: native widgets + injected absolute-position CSS ----
const css = [];
const widgets = [];
const HERO_H = 700;
css.push(`@font-face{font-family:'SohneClone';src:url('${SOHNE}') format('woff2');font-weight:100 900;font-display:block}`);
// Use the container's CSS ID (reliably applied) as the positioning context.
css.push(`#czphero{position:relative !important;height:${HERO_H}px;background:#fff;overflow:hidden;font-family:'SohneClone',-apple-system,sans-serif}`);
css.push(`#czphero>.e-con-inner{height:100%;max-width:none;padding:0;display:block}`);
// Elementor adds default padding/margin on widget containers — zero it so the
// text sits exactly at the placed coordinate (was pushing text down = doubling).
css.push(`#czphero .elementor-widget-container{padding:0 !important;margin:0 !important}`);
css.push(`#czphero .elementor-widget{padding:0 !important}`);
css.push(`#czphero .czp-wave img{width:100% !important;height:100% !important;object-fit:fill;display:block}`);
const fontDecl = (f) => { let c = `font-family:'SohneClone',sans-serif;font-size:${f.size}px;font-weight:${parseInt(f.weight) || 400};`; const lh = px(f.lh); if (lh) c += `line-height:${lh}px;`; const ls = px(f.ls); if (ls !== null) c += `letter-spacing:${ls}px;`; return c; };
let idc = 0;
function place(cls, x, y, w, extraCss, widget) {
  // do NOT clamp y — the wave's true top is negative (it bleeds above, like the source)
  css.push(`.${cls}{position:absolute !important;margin:0 !important;left:${x}px;top:${y}px;${w ? `width:${w}px;` : ''}${extraCss}}`);
  widget.settings = widget.settings || {};
  widget.settings._css_classes = (widget.settings._css_classes ? widget.settings._css_classes + ' ' : '') + cls;
  widgets.push(widget);
}
// wave (decorative, behind)
if (hero.wave) place('czp-wave', hero.wave.x, hero.wave.y, hero.wave.w, `height:${hero.wave.h}px;z-index:0`, { elType: 'widget', widgetType: 'image', settings: { image: { url: hero.wave.src }, image_size: 'full' } });
// nav
const navClean = [];
for (const n of hero.nav) { let t = n.text.replace(/^(.+)\s+\1$/, '$1').trim(); if (/guide me/i.test(t)) continue; if (navClean.some((x) => x.text === t)) continue; navClean.push({ ...n, text: t }); }
for (const n of navClean) {
  const cta = /contact sales/i.test(n.text);
  if (cta) place('czp-n' + (idc++), n.x, n.y, null, `z-index:2`, { elType: 'widget', widgetType: 'button', settings: { text: n.text, background_background: 'classic', background_color: '#635bff', button_text_color: '#fff', border_radius: { unit: 'px', top: '20', right: '20', bottom: '20', left: '20', isLinked: true }, text_padding: { unit: 'px', top: '8', right: '16', bottom: '8', left: '16', isLinked: false } } });
  else { const c = 'czp-n' + (idc++); css.push(`.${c} .elementor-widget-container{${fontDecl(n)}}`); css.push(`.${c} a{color:#0a2540;text-decoration:none;white-space:nowrap}`); place(c, n.x, n.y, null, `z-index:2`, { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<a>${esc(n.text)}</a>` } }); }
}
// eyebrow
if (hero.eyebrow) { const c = 'czp-eb'; css.push(`.${c} .elementor-widget-container{${fontDecl(hero.eyebrow)}color:#425466;white-space:nowrap}`); place(c, hero.eyebrow.x, hero.eyebrow.y, hero.eyebrow.w + 80, 'z-index:1', { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<div>${esc(hero.eyebrow.text)}</div>` } }); }
// headline (h1 holds headline+subhead — matches source; navy)
if (hero.headline) { const c = 'czp-hl'; css.push(`.${c} .elementor-heading-title{${fontDecl(hero.headline)}color:rgb(6,27,49);margin:0}`); place(c, hero.headline.x, hero.headline.y, hero.headline.w, 'z-index:1', { elType: 'widget', widgetType: 'heading', settings: { title: hero.headline.text, header_size: 'h1' } }); }
// CTAs
hero.ctas.forEach((cta, i) => {
  const primary = /get started|start now/i.test(cta.text);
  place('czp-cta' + i, cta.x, cta.y, null, 'z-index:2', { elType: 'widget', widgetType: 'button', settings: { text: cta.text, background_background: 'classic', background_color: primary ? '#635bff' : '#ffffff', button_text_color: primary ? '#ffffff' : '#0a2540', border_radius: { unit: 'px', top: '24', right: '24', bottom: '24', left: '24', isLinked: true }, text_padding: { unit: 'px', top: '12', right: '20', bottom: '12', left: '20', isLinked: false }, ...(primary ? {} : { border_border: 'solid', border_width: { unit: 'px', top: '1', right: '1', bottom: '1', left: '1', isLinked: true }, border_color: '#d5dbe5' }) } });
});

const container = (settings, elements = []) => ({ elType: 'container', settings, elements });
function buildPage(logoUrl) {
  if (logoUrl) place('czp-logos', 0, D.logoBand.y, 1440, 'z-index:1', { elType: 'widget', widgetType: 'image', settings: { image: { url: logoUrl }, image_size: 'full' } });
  const styleWidget = { elType: 'widget', widgetType: 'html', settings: { html: `<style>${css.join('\n')}</style>` } };
  const heroContainer = container({ content_width: 'full', _element_id: 'czphero', _css_classes: 'czph', _padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } }, widgets);
  // captured bands below the hero (skip s0 = hero)
  const bands = [];
  for (let i = 1; i < tree.sections.length; i++) {
    const url = si[i]; if (!url) continue;
    bands.push(container({ content_width: 'full', flex_align_items: 'center', _padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } }, [{ elType: 'widget', widgetType: 'image', settings: { image: { url }, image_size: 'full', align: 'center', width: { unit: 'px', size: '1440' }, _element_width: 'initial' } }]));
  }
  return container({ content_width: 'full', flex_direction: 'column', flex_gap: { unit: 'px', size: '0' }, _padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } }, [styleWidget, heroContainer, ...bands]);
}

async function jp(method, path, body) {
  for (let a = 0; a < 12; a++) { const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 200) }; } if (r.status === 429) { await sleep(Math.max((j.details?.retry_after || 2), (a + 1) * 2) * 1000 + 500); continue; } if (!r.ok) console.error(method, path, r.status, JSON.stringify(j).slice(0, 200)); return { status: r.status, j }; }
  return { status: 429, j: {} };
}

(async () => {
  console.log('uploading logo strip…');
  const logoUrl = fs.existsSync('hero-logos.png') ? await uploadPng('hero-logos.png', 'stripe-hero-logos.png') : null;
  await sleep(2000);
  const root = buildPage(logoUrl);
  const count = (e) => 1 + (e.elements || []).reduce((a, c) => a + count(c), 0);
  console.log('precision tree:', count(root), 'elements |', widgets.length, 'hero widgets | css rules:', css.length);
  const create = await jp('POST', '/wp-json/joist/v1/plans', { intent: 'precision hero clone', title, page_id: 0, steps: [{ op: 'insert', parent_id: 'root', position: 0, element: root }] });
  const planId = create.j.plan_id, token = create.j.approval_token; let pageId = create.j.page_id;
  if (!planId) { console.error('create failed', create.status, JSON.stringify(create.j).slice(0, 300)); process.exit(1); }
  console.log('plan', planId, 'page', pageId);
  await sleep(3000); await jp('POST', `/wp-json/joist/v1/plans/${planId}/approve`, { approval_token: token });
  await sleep(3000); const ex = await jp('POST', `/wp-json/joist/v1/plans/${planId}/execute`, {});
  console.log('execute ->', ex.status);
  const pg = await jp('GET', `/wp-json/wp/v2/pages/${pageId}?context=edit`, null);
  console.log('PAGE_URL:', pg.j.link || ('(page ' + pageId + ')'));
})();
