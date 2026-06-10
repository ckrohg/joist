#!/usr/bin/env node
/**
 * @purpose Register a real source font into the WordPress Font Library (wp_font_family + wp_font_face) so
 * Elementor's typography_font_family can render it EXACTLY (vs the Inter substitution). WP enqueues the
 * @font-face site-wide (bypasses the kses <style> strip). Usage:
 *   node font-register.mjs --name "Circular" --file <url-or-path.woff2> [--weight 400] [--style normal]
 * Prints the registered fontFamily name to use in typography_font_family.
 */
import fs from 'fs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const base = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
const b64 = process.env.JOIST_AUTH_B64;
const name = arg('name'), file = arg('file'), weight = arg('weight', '400'), style = arg('style', 'normal');
if (!b64 || !name || !file) { console.error('need --name --file + JOIST_AUTH_B64'); process.exit(2); }
const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
const auth = 'Basic ' + b64;

async function findFamily() { const r = await fetch(`${base}/wp-json/wp/v2/font-families?per_page=100`, { headers: { Authorization: auth } }); const j = await r.json(); return Array.isArray(j) ? j.find((f) => f.slug === slug || (f.font_family_settings && f.font_family_settings.slug === slug)) : null; }

(async () => {
  // 1) family (idempotent by slug)
  let fam = await findFamily();
  if (!fam) {
    const r = await fetch(`${base}/wp-json/wp/v2/font-families`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ font_family_settings: JSON.stringify({ name, slug, fontFamily: name }) }) });
    fam = await r.json();
  }
  if (!fam || !fam.id) { console.error('family create failed', JSON.stringify(fam).slice(0, 200)); process.exit(1); }
  // 2) font file bytes
  let buf; if (/^https?:/.test(file)) { const fr = await fetch(file); if (!fr.ok) { console.error('font fetch fail', fr.status); process.exit(1); } buf = Buffer.from(await fr.arrayBuffer()); } else buf = fs.readFileSync(file);
  // 3) font-face (multipart: settings JSON + file referenced by its field key in src[])
  const key = 'files0';
  const fd = new FormData();
  fd.append('font_face_settings', JSON.stringify({ fontFamily: name, fontWeight: String(weight), fontStyle: style, src: [key] }));
  fd.append(key, new Blob([buf], { type: 'font/woff2' }), `${slug}-${weight}.woff2`);
  const fr = await fetch(`${base}/wp-json/wp/v2/font-families/${fam.id}/font-faces`, { method: 'POST', headers: { Authorization: auth }, body: fd });
  const fj = await fr.json();
  console.log('family', fam.id, slug, '| face status', fr.status, '| face id', fj.id || JSON.stringify(fj).slice(0, 160));
  // activate the family (publish)
  await fetch(`${base}/wp-json/wp/v2/font-families/${fam.id}`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'publish' }) });
  // record family→hosted-URL map (https to avoid mixed-content) for build-absolute to inject @font-face via
  // Elementor Pro page custom_css (WP Font Library does NOT enqueue on the frontend for classic themes).
  const url = `${base.replace(/^http:/, 'https:')}/wp-content/uploads/fonts/${slug}-${weight}.woff2`;
  const MAP = '/tmp/joist-fonts.json'; let m = {}; try { m = JSON.parse(fs.readFileSync(MAP, 'utf8')); } catch {}
  m[name] = m[name] || []; if (!m[name].some((f) => f.weight === String(weight))) m[name].push({ url, weight: String(weight), style });
  fs.writeFileSync(MAP, JSON.stringify(m, null, 2));
  console.log('REGISTERED_FONT_FAMILY:', name, '→', url);
})();
