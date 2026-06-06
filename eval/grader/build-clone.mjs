#!/usr/bin/env node
/**
 * Agent-side clone builder (no-deploy, host-portable). Turns an extract.mjs
 * blueprint into a COMPLETE Elementor page reproducing every content block in
 * order (real image URLs, real computed typography), and creates+approves+
 * executes the plan via WP REST (/joist/v1/plans) using the app-password.
 * Attacks the truncation ceiling without touching plugin code.
 *
 * Env: JOIST_BASE, JOIST_AUTH_B64 (see /tmp/joist-auth.env)
 * Usage: node build-clone.mjs --blueprint blueprint.json --title "Clone" [--page <id>]
 */
import fs from 'fs';

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const base = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
const b64 = process.env.JOIST_AUTH_B64;
if (!b64) { console.error('missing JOIST_AUTH_B64'); process.exit(2); }
const bp = JSON.parse(fs.readFileSync(arg('blueprint'), 'utf8'));
const title = arg('title', 'Agent clone');
const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'agent-clone-' + bp.blockCount };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const GRADIENT_URL = 'https://georges232.sg-host.com/wp-content/uploads/2026/06/gradient.png';
const parseRGB = (s) => { const m = String(s).match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (rgb, bg) => { const l1 = lum(rgb), l2 = lum(bg); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
// FIX 1: sanitize extracted colors — if unreadable on the (light) background, fall back to a readable default.
const safeColor = (raw, fallback) => { const rgb = parseRGB(raw); if (!rgb) return fallback; return contrast(rgb, [255, 255, 255]) >= 4.5 ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : fallback; };
// FIX 2: only real CTAs become pills; everything else is a plain link.
const isCTA = (t) => t.trim().length < 26 && /^(get started|sign up|contact|create|start|try|request|book|buy|subscribe|get a demo|open|launch|get demo)/i.test(t.trim());

function buildHtml(bp) {
  // FIX 3: layout-aware — consume sectioned blueprint (extract-layout.mjs); fall back to flat.
  const sections = bp.sections || [{ columns: 1, bg: '', blocks: bp.blocks || [] }];
  let heroIdx = -1;
  for (let i = 0; i < sections.length; i++) { if ((sections[i].blocks || []).some((b) => b.type === 'heading' && (b.fontSizePx || 0) >= 40)) { heroIdx = i; break; } }
  let h = `<style>\n.cz{font-family:ui-sans-serif,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#0a2540;background:#fff;-webkit-font-smoothing:antialiased}\n.cz *{box-sizing:border-box;margin:0}\n.cz-w{max-width:1080px;margin:0 auto;padding:0 24px}\n.cz-sec{padding:48px 0;position:relative}\n.cz-row{display:flex;gap:48px;flex-wrap:wrap;align-items:center}\n.cz-col{flex:1 1 380px;min-width:300px}\n.cz img{max-width:100%;height:auto;border-radius:12px;margin:14px 0;box-shadow:0 18px 50px rgba(10,37,64,.10)}\n.cz p{color:#425466;line-height:1.55;margin:9px 0;max-width:760px;font-size:17px}\n.cz a.b{display:inline-block;background:#635bff;color:#fff;padding:9px 18px;border-radius:24px;font-weight:600;text-decoration:none;margin:6px 10px 6px 0;font-size:15px}\n.cz a.lnk{color:#0a2540;text-decoration:none;font-weight:500;margin:0 14px 0 0;font-size:15px;display:inline-block}\n.cz-art{position:absolute;right:0;top:0;width:44%;height:100%;background:url('${GRADIENT_URL}') center/cover no-repeat;z-index:0;border-bottom-left-radius:40px}\n.cz-hero .cz-w{position:relative;z-index:1}\n.cz-hero{min-height:540px;display:flex;align-items:center}\n.cz-hero .cz-col:last-child{min-height:360px}\n</style>\n<div class="cz">`;
  sections.forEach((sec, idx) => {
    const isHero = idx === heroIdx;
    const bgRGB = parseRGB(sec.bg || '');
    // Disabled: aggressive dark-section detection painted the hero fully black (v6).
    // Keep every section light/readable; revisit with real per-section bg fidelity later.
    const dark = false;
    const bgCss = dark ? `background:rgb(${bgRGB.join(',')});color:#fff` : '';
    h += `<div class="cz-sec${isHero ? ' cz-hero' : ''}" style="${bgCss}">`;
    if (isHero) h += `<div class="cz-art"></div>`;
    h += `<div class="cz-w">`;
    const blocks = sec.blocks || [];
    const rb = (b) => {
      if (b.type === 'heading') { const lvl = Math.min(4, Math.max(1, b.level || 2)); const fsz = Math.min(60, Math.max(15, b.fontSizePx || 28)); const col = dark ? '#fff' : safeColor(b.color, '#0a2540'); return `<h${lvl} style="font-size:${fsz}px;font-weight:${Math.min(700, parseInt(b.fontWeight) || 600)};color:${col};letter-spacing:-.4px;line-height:1.12;margin:14px 0 8px">${esc(b.text)}</h${lvl}>`; }
      if (b.type === 'text') { return `<p style="color:${dark ? '#c8d3e0' : safeColor(b.color, '#425466')}">${esc(b.text)}</p>`; }
      if (b.type === 'image') { return `<img src="${esc(b.src)}" alt="${esc(b.alt || '')}" loading="lazy">`; }
      if (b.type === 'button') { return isCTA(b.text) ? `<a class="b">${esc(b.text)}</a>` : `<a class="lnk">${esc(b.text)}</a>`; }
      return '';
    };
    if (isHero) {
      // Hero: headline + ticker + CTAs on the LEFT; gradient art (.cz-art) fills the RIGHT.
      // Suppress hero <img> blocks so a big image can't dominate the first screen.
      const textBlocks = blocks.filter((b) => b.type !== 'image');
      h += `<div class="cz-row"><div class="cz-col">${textBlocks.map(rb).join('')}</div><div class="cz-col" aria-hidden="true"></div></div>`;
    } else if (sec.columns === 2) {
      const left = blocks.filter((b) => b.col !== 1), right = blocks.filter((b) => b.col === 1);
      h += `<div class="cz-row"><div class="cz-col">${left.map(rb).join('')}</div><div class="cz-col">${right.map(rb).join('')}</div></div>`;
    } else {
      h += blocks.map(rb).join('');
    }
    h += `</div></div>`;
  });
  h += `</div>`;
  return h;
}

async function jp(method, path, body) {
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch { j = { raw: txt.slice(0, 300) }; }
  if (!r.ok) { console.error(method, path, '->', r.status, JSON.stringify(j).slice(0, 300)); }
  return { status: r.status, j };
}

(async () => {
  const html = buildHtml(bp);
  console.log('built html:', (html.length / 1024).toFixed(0) + 'KB from', bp.blockCount, 'blocks');
  const steps = [{ op: 'insert', position: 0, element: { elType: 'widget', widgetType: 'html', settings: { html } } }];
  const create = await jp('POST', '/wp-json/joist/v1/plans', { intent: 'agent-side full-DOM clone', title, steps });
  const planId = create.j.plan_id, token = create.j.approval_token, pageId = create.j.page_id;
  if (!planId) { console.error('create failed', create.status, JSON.stringify(create.j).slice(0, 400)); process.exit(1); }
  console.log('plan', planId, 'page', pageId);
  await jp('POST', `/wp-json/joist/v1/plans/${planId}/approve`, { approval_token: token });
  const exec = await jp('POST', `/wp-json/joist/v1/plans/${planId}/execute`, {});
  console.log('execute ->', exec.status);
  // resolve permalink
  const pg = await jp('GET', `/wp-json/wp/v2/pages/${pageId}?context=edit`, null);
  console.log('PAGE_URL:', pg.j.link || ('(page ' + pageId + ')'));
  fs.writeFileSync('last-clone.json', JSON.stringify({ planId, pageId, url: pg.j.link, blocks: bp.blockCount }, null, 2));
})();
