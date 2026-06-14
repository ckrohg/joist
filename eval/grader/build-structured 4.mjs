#!/usr/bin/env node
/**
 * @purpose The REFLOW-AND-editable path. Where build-absolute.mjs pins every leaf to its captured (x,y,w,h)
 * — pixel-faithful at 1440 but ZERO reflow and a guaranteed desktop-pixel horizontal floor — build-structured.mjs
 * drives the build from segment.mjs's STRUCTURAL band tree ({nav, sections[], footer}) and emits a NATIVE
 * Elementor FLEX-CONTAINER tree whose only invariant is: NO HORIZONTAL SCROLL. Every container is width:100%
 * with a max-width on the boxed content; columns inside a section are flex children with a PERCENT flex-basis
 * (column width / section width) + min-width:0 so they shrink; no widget carries a fixed-px width
 * (_element_custom_width) and nothing is position:absolute. The page therefore reflows at any viewport and
 * scrollWidth never exceeds the viewport.
 *
 * ARCHITECTURE (the whole point):
 *   • Each segment SECTION → a full-width Elementor container (elType container, content_width=full,
 *     flex-direction=column, width 100%) carrying the section bg + min_height from its bbox + vertical padding.
 *   • INSIDE each section the members are clustered by X-position into COLUMNS (gap-split on x). The columns are
 *     emitted as an inner flex-ROW container; each column is a flex child with flex-basis = (colW/sectionW)% and
 *     min-width:0. Each member widget (heading/text/button/image/list/...) is placed into its column by Y-order.
 *   • NAV → a full-width flex ROW: logo (brand/wordmark image or first nav text) left + nav links center/right +
 *     CTA right. Pro → Elementor nav-menu widget; no-Pro → a flex row of per-link text-editor widgets.
 *   • FOOTER → a full-width container with the footer members clustered into columns (same x-cluster machinery).
 *
 * REUSE (read, not rewritten): the widget-emission shapes (heading/text/button/image/svg/mockup/code/video/list/
 * tabs/accordion), the global-token Kit clustering + __globals__ refs + kit PUT, the asset upload+cache, the font
 * registration, and the joist page PUT machinery are PORTED from build-absolute.mjs. The NEW logic is ONLY the
 * structural driver (segment-tree → section/column containers) and the INLINE-only widget styling (no absPos,
 * no fixed-px width) — flex layout positions every leaf, the parent container is never absolute.
 *
 * RE-JOIN: segment.mjs emits THIN member refs (kind, box, text, tag, href) — it drops typo/paint/src/items the
 * widget functions need for fidelity. So we build a geometry index of the FULL capture leaves and re-join each
 * thin member back to its full leaf by exact (rounded) box geometry. The full leaf carries typo/paint/src/raster/
 * items so the ported widget functions render with full fidelity.
 *
 * CLI: node build-structured.mjs --layout <capture.json> --page <id> [--publish]
 *        (internally runs segment.mjs on the capture; or accept a precomputed --seg <segjson>)
 *      node build-structured.mjs --layout <capture.json> --seg <segjson> --selftest   (DRY tree-dump + invariants)
 *      node build-structured.mjs --layout <capture.json> --dry                          (DRY tree-dump only)
 * Env: JOIST_BASE (default georges232.sg-host.com), JOIST_AUTH_B64 (source /tmp/joist-auth.env).
 *      STRUCT_NO_GLOBALS=1 → inline-only (no kit write); ABS_GLOBAL_TYPO=1 → bind typography globals too.
 */
import fs from 'fs';
import { segment } from './segment.mjs';

// ---------------------------------------------------------------------------
// CLI + env (mirror build-absolute.mjs:12-16; --dry/--selftest added for structural sanity)
// ---------------------------------------------------------------------------
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const DRY = process.argv.includes('--dry');
const SELFTEST = process.argv.includes('--selftest');
const PUBLISH = process.argv.includes('--publish');
const base = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
const b64 = process.env.JOIST_AUTH_B64;
const layoutPath = arg('layout'), pageId = arg('page'), segPath = arg('seg');
// DRY / selftest only need --layout; a real write needs --layout + --page + auth.
const NEEDS_WRITE = !DRY && !SELFTEST;
if (!layoutPath || (NEEDS_WRITE && (!b64 || !pageId))) { console.error('need --layout --page + JOIST_AUTH_B64 (or --layout --dry / --selftest)'); process.exit(2); }
const L = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
const VW = L.vw || 1440;
const pageH = L.pageH || 6000;
// content max-width: the captured content column (widest section bbox.w, ~1280 boxed) so boxed sections center.
const PAGE_DEFAULT = (L.root && L.root.bgSampled) || (L.root && L.root.background && L.root.background.color) || L.pageBg || 'rgb(255, 255, 255)';

// ---------------------------------------------------------------------------
// Shared scalar/string helpers (verbatim from build-absolute.mjs / build-flow.mjs)
// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const px = (s) => { const m = String(s || '').match(/(-?\d+(?:\.\d+)?)px/); return m ? +m[1] : null; };
const stripEmoji = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n) => Math.round(n || 0);
const median = (arr) => { const a = (arr || []).filter((v) => v != null && !Number.isNaN(v)).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
const opaque = (c) => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent' && !/,\s*0\)\s*$/.test(c);
const container = (settings, elements = []) => ({ elType: 'container', settings, elements });
// WRAP — guarantee no single text leaf can exceed the viewport (long URLs/code/hashes). build-flow.mjs:211
const WRAP = 'overflow-wrap:anywhere;word-break:break-word;max-width:100%';
const styleAttr = (css) => css ? ` style="${css}"` : '';

// ---------------------------------------------------------------------------
// Fonts (verbatim build-absolute.mjs:22-26)
// ---------------------------------------------------------------------------
const GOOGLE = [[/ibm.?plex.?mono|plex.?mono/, 'IBM Plex Mono'], [/source.?code/, 'Source Code Pro'], [/jetbrains/, 'JetBrains Mono'], [/space.?mono/, 'Space Mono'], [/fira.?code/, 'Fira Code'], [/inter/, 'Inter'], [/poppins/, 'Poppins'], [/montserrat/, 'Montserrat'], [/open.?sans/, 'Open Sans'], [/^lato|[^a-z]lato/, 'Lato'], [/nunito.?sans/, 'Nunito Sans'], [/nunito/, 'Nunito'], [/work.?sans/, 'Work Sans'], [/dm.?sans/, 'DM Sans'], [/space.?grotesk/, 'Space Grotesk'], [/manrope/, 'Manrope'], [/raleway/, 'Raleway'], [/rubik/, 'Rubik'], [/mulish|muli/, 'Mulish'], [/playfair/, 'Playfair Display'], [/merriweather/, 'Merriweather'], [/roboto.?slab/, 'Roboto Slab'], [/roboto.?mono/, 'Roboto Mono'], [/roboto/, 'Roboto']];
const gFont = (fam) => { const b = (fam || '').toLowerCase(); if (!b) return null; for (const [re, name] of GOOGLE) if (re.test(b)) return name; if (/tiempos|times|georgia|garamond|serif/.test(b)) return 'Georgia'; if (/mono|code|courier|consol/.test(b)) return 'Roboto Mono'; return 'Inter'; };
let REGFONTS = {}; try { REGFONTS = JSON.parse(fs.readFileSync('/tmp/joist-fonts.json', 'utf8')); } catch {}
const usedFonts = new Set();

// ---------------------------------------------------------------------------
// Image upload + cache (verbatim build-absolute.mjs:113-117)
// ---------------------------------------------------------------------------
const IMG_CACHE = '/tmp/joist-imgcache.json'; let imgMap = {}; try { imgMap = JSON.parse(fs.readFileSync(IMG_CACHE, 'utf8')); } catch {}
const mimeOf = (u) => { const e = (u.split('?')[0].split('.').pop() || '').toLowerCase(); return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' })[e] || 'image/jpeg'; };
async function uploadImage(url) { if (!url || url.startsWith('data:')) return; if (imgMap[url] && imgMap[url].full) return; try { let buf; if (url.startsWith('/')) buf = fs.readFileSync(url); else { const r = await fetch(url); if (!r.ok) { imgMap[url] = { full: url }; return; } buf = Buffer.from(await r.arrayBuffer()); } const name = (url.split('/').pop().split('?')[0] || 'img') + (/\.[a-z0-9]+$/i.test(url.split('?')[0]) ? '' : '.jpg'); const up = await fetch(base + '/wp-json/wp/v2/media', { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': mimeOf(url), 'Content-Disposition': `attachment; filename="${name}"` }, body: buf }); const j = await up.json(); imgMap[url] = (up.ok && j.source_url) ? { id: j.id, full: j.source_url } : { full: url }; } catch { imgMap[url] = { full: url }; } }
const localSrc = (s) => (imgMap[s] && imgMap[s].full) || s;
const localId = (s) => imgMap[s] && imgMap[s].id;

// ---------------------------------------------------------------------------
// Color helpers (CIEDE2000) — verbatim build-absolute.mjs:470-474 (needed for global-token clustering + bg gates)
// ---------------------------------------------------------------------------
function parseRgb(s) { const m = String(s || '').match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/); return m ? [+m[1], +m[2], +m[3]] : null; }
function rgb2lab(rgb) { let [r, g, b] = rgb.map((v) => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; }); let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = (r * 0.2126 + g * 0.7152 + b * 0.0722), z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883; [x, y, z] = [x, y, z].map((v) => v > 0.008856 ? Math.cbrt(v) : (7.787 * v + 16 / 116)); return [116 * y - 16, 500 * (x - y), 200 * (y - z)]; }
function deltaE(c1, c2) { const p1 = parseRgb(c1), p2 = parseRgb(c2); if (!p1 || !p2) return 0; const A = rgb2lab(p1), B = rgb2lab(p2); const L1 = A[0], a1 = A[1], b1 = A[2], L2 = B[0], a2 = B[1], b2 = B[2]; const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2); const avgC = (C1 + C2) / 2; const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7)))); const a1p = a1 * (1 + G), a2p = a2 * (1 + G); const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2); const avgCp = (C1p + C2p) / 2; let h1p = Math.atan2(b1, a1p) * 180 / Math.PI; if (h1p < 0) h1p += 360; let h2p = Math.atan2(b2, a2p) * 180 / Math.PI; if (h2p < 0) h2p += 360; const dLp = L2 - L1, dCp = C2p - C1p; let dhp = 0; if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; } const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360); const avgLp = (L1 + L2) / 2; let avghp = h1p + h2p; if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) avghp += (avghp < 360 ? 360 : -360); avghp /= 2; } const T = 1 - 0.17 * Math.cos((avghp - 30) * Math.PI / 180) + 0.24 * Math.cos((2 * avghp) * Math.PI / 180) + 0.32 * Math.cos((3 * avghp + 6) * Math.PI / 180) - 0.20 * Math.cos((4 * avghp - 63) * Math.PI / 180); const dTheta = 30 * Math.exp(-Math.pow((avghp - 275) / 25, 2)); const Rc = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7))); const Sl = 1 + (0.015 * Math.pow(avgLp - 50, 2)) / Math.sqrt(20 + Math.pow(avgLp - 50, 2)); const Sc = 1 + 0.045 * avgCp; const Sh = 1 + 0.015 * avgCp * T; const Rt = -Math.sin(2 * dTheta * Math.PI / 180) * Rc; return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh)); }

// ---------------------------------------------------------------------------
// Native typography + inline color-stamp (ported build-absolute.mjs:120/165-176 → INLINE css form, build-flow.mjs:185-206)
// All text routes through inline-styled <hN>/<div>/<a> in a text-editor (the heading-widget schema on this stack
// rejects typography_*), so typoCss() folds font + color into one inline-style string. Fonts that map to a Google
// equivalent render natively; registered real fonts inject @font-face (usedFonts).
// ---------------------------------------------------------------------------
const textColor = (n) => (n.paint && n.paint.value && n.paint.kind !== 'gradient-text' && /^(#|rgb)/.test(n.paint.value)) ? n.paint.value : null;
// colorCss now routes through effectiveColor: where a Kit color token is in tolerance, it emits color:var(--e-global-color-…)
// (so token edits propagate) instead of baking the literal. Falls back to the literal when no token applies.
const colorCss = (n) => effectiveColor(n).css;
// FIX 2 — does this node have a matching Kit TYPOGRAPHY token whose family/size we can replace with the global var?
// True iff assignGlobals snapped n._gTypoTok AND the cluster carries a usable family or size signature. When so,
// typoCss emits font-family/font-size as `var(--e-global-typography-<tok>-…)` (stripping the inline literal) so a
// Kit typography edit propagates; weight/line-height/letter-spacing/transform also ride the matching var.
function effectiveTypoTok(n) {
  if (NO_EFFECTIVE || NO_GLOBALS || !n || !n._gTypoTok) return null;
  const c = typoCluster(n._gTypoTok);
  if (!c || !c.sig || !(c.sig.fam || c.sig.size)) return null;
  return c;
}
function typoCss(n) {
  const t = n.typo || {}; const out = [];
  const tc = effectiveTypoTok(n);
  const tok = tc && tc.id;
  const s = (tc && tc.sig) || {};
  // FIX 2 — font-family: a matching typo token → emit the global var and STRIP the inline literal; else inline literal.
  if (tok && s.fam) { out.push(`font-family:${typoVar(tok, 'font-family')}`); if (REGFONTS[s._rawFam]) usedFonts.add(s._rawFam); n._fontStripped = true; }
  else { const fam = t.family && (REGFONTS[t.family] ? t.family : gFont(t.family)); if (fam) { out.push(`font-family:'${fam}'`); if (REGFONTS[t.family]) usedFonts.add(t.family); } }
  const dSize = t.size ? round(t.size) : 0;
  // FIX 2 — font-size: a matching typo token that carries a size → emit the global var; else the inline literal.
  if (tok && s.size) out.push(`font-size:${typoVar(tok, 'font-size')}`);
  else if (dSize) out.push(`font-size:${dSize}px`);
  const lhPx = px(t.lineHeight);
  if (tok && s.lh) out.push(`line-height:${typoVar(tok, 'line-height')}`);
  else if (lhPx) out.push(dSize > 0 ? `line-height:${(lhPx / dSize).toFixed(3)}` : `line-height:${round(lhPx)}px`);
  if (tok && s.weight) out.push(`font-weight:${typoVar(tok, 'font-weight')}`);
  else if (t.weight && /^\d+$/.test(String(t.weight))) out.push(`font-weight:${t.weight}`);
  const ls = px(t.letterSpacing);
  if (tok && s.ls !== null && s.ls !== undefined) out.push(`letter-spacing:${typoVar(tok, 'letter-spacing')}`);
  else if (ls !== null && t.letterSpacing !== 'normal') out.push(`letter-spacing:${(+ls.toFixed(1))}px`);
  if (tok && s.tr) out.push(`text-transform:${typoVar(tok, 'text-transform')}`);
  else if (t.transform && t.transform !== 'none') out.push(`text-transform:${t.transform}`);
  // FIX 1 — color: effectiveColor emits the global var when a Kit color token is in tolerance (else the literal).
  const cc = colorCss(n); if (cc) out.push(cc);
  return out.join(';');
}
const textCss = (n, extra) => [typoCss(n), extra].filter(Boolean).join(';') + ';' + WRAP;
// NATIVE typography settings object (ported build-absolute.mjs:120). Used by the tag-driven native heading/button
// widgets so they carry REAL, editable Elementor typography controls (typography_typography:'custom' + font_*),
// not just inline HTML. These are the INLINE-FALLBACK values; the __globals__ typography ref (globalRefSettings)
// rides ON TOP so a Kit token edit still propagates (recipe #37). Same family→Google mapping as the inline path.
function nativeTypo(n) {
  const t = n.typo || {}; const s = {};
  if (!(t.size || t.family)) return s;
  s.typography_typography = 'custom';
  const fam = t.family && (REGFONTS[t.family] ? t.family : gFont(t.family));
  if (fam) { s.typography_font_family = fam; if (REGFONTS[t.family]) usedFonts.add(t.family); }
  if (t.size) s.typography_font_size = { unit: 'px', size: round(t.size) };
  if (t.weight && /^\d+$/.test(String(t.weight))) s.typography_font_weight = String(t.weight);
  const lh = px(t.lineHeight); if (lh) s.typography_line_height = { unit: 'px', size: round(lh) };
  const ls = px(t.letterSpacing); if (ls !== null && t.letterSpacing !== 'normal') s.typography_letter_spacing = { unit: 'px', size: +ls.toFixed(1) };
  if (t.transform && t.transform !== 'none') s.typography_text_transform = t.transform;
  return s;
}
// dominant solid stop of a CSS gradient (build-flow.mjs:215) — gradient bg fallback.
function gradientColor(grad) { const cols = [...String(grad).matchAll(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/gi)].map((m) => m[0]); if (!cols.length) return null; const dark = cols.find((c) => { const m = c.match(/(\d+),\s*(\d+),\s*(\d+)/); if (!m) return false; return (+m[1] + +m[2] + +m[3]) / 3 < 90; }); return dark || cols[0]; }

// ===========================================================================
// GLOBAL-TOKEN Kit clustering + __globals__ refs (ported VERBATIM-in-spirit from build-absolute.mjs:490-621).
// Cluster captured text/bg colors (CIEDE2000 dE<=3) → ~6-12 Kit color tokens; typography signatures → ~4-8 typo
// tokens; write them to the Kit once per clone; emit each text widget with a __globals__ ref to the nearest token
// AND keep the captured inline value as a fallback (so render is byte-identical even if a global ref fails).
// ===========================================================================
const NO_GLOBALS = process.env.STRUCT_NO_GLOBALS === '1' || process.env.ABS_NO_GLOBALS === '1';
const GLOBALS_DE = 3;
const gColorTokens = []; const gTypoTokens = [];
const normHex = (c) => { const p = parseRgb(c); if (!p) return null; return `rgb(${Math.round(p[0])}, ${Math.round(p[1])}, ${Math.round(p[2])})`; };
function hash32(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; }
function colorRole(rgb, idx) { const lab = rgb2lab(rgb); const Lp = lab[0], chroma = Math.hypot(lab[1], lab[2]); if (Lp >= 92) return 'BG Light'; if (Lp <= 12) return 'Text Dark'; if (chroma >= 28) return idx === 0 ? 'Primary' : 'Accent'; if (Lp >= 55) return 'Muted'; return 'Text'; }
const _colorClusters = [];
function tokenForColor(cssColor) {
  if (NO_GLOBALS) return null;
  const key = normHex(cssColor); if (!key) return null;
  const rgb = parseRgb(key); if (!rgb) return null;
  let best = null, bestDE = Infinity;
  for (const c of _colorClusters) { const de = deltaE(key, c.key); if (de < bestDE) { bestDE = de; best = c; } }
  if (best && bestDE <= GLOBALS_DE) { best.count++; return best.id; }
  const id = `clr_${(_colorClusters.length).toString(36)}${Math.abs(hash32(key)).toString(36).slice(0, 4)}`;
  _colorClusters.push({ key, rgb, count: 1, id, title: colorRole(rgb, _colorClusters.length) });
  return id;
}
const _typoClusters = [];
function typoSig(n) { const t = n.typo || {}; if (!(t.size || t.family)) return null; const fam = REGFONTS[t.family] ? t.family : gFont(t.family); return { fam, size: t.size ? Math.round(t.size) : null, weight: (t.weight && /^\d+$/.test(String(t.weight))) ? String(t.weight) : null, lh: px(t.lineHeight), ls: (t.letterSpacing && t.letterSpacing !== 'normal') ? px(t.letterSpacing) : null, tr: (t.transform && t.transform !== 'none') ? t.transform : null, _rawFam: t.family }; }
function typoRole(sig, idx) { if (sig.size && sig.size >= 40) return 'Display'; if (sig.size && sig.size >= 24) return 'Heading'; if (sig.size && sig.size <= 13) return 'Small'; return idx === 0 ? 'Body' : 'Text'; }
function tokenForTypo(n) {
  if (NO_GLOBALS) return null;
  const sig = typoSig(n); if (!sig) return null;
  for (const c of _typoClusters) { if (c.sig.fam === sig.fam && c.sig.weight === sig.weight && c.sig.tr === sig.tr && ((c.sig.size == null && sig.size == null) || (c.sig.size != null && sig.size != null && Math.abs(c.sig.size - sig.size) <= 1))) return c.id; }
  const id = `typ_${(_typoClusters.length).toString(36)}${Math.abs(hash32((sig.fam || '') + sig.size + sig.weight)).toString(36).slice(0, 4)}`;
  const settings = { typography_typography: 'custom' };
  if (sig.fam) settings.typography_font_family = sig.fam;
  if (sig.size) settings.typography_font_size = { unit: 'px', size: sig.size };
  if (sig.weight) settings.typography_font_weight = sig.weight;
  if (sig.lh) settings.typography_line_height = { unit: 'px', size: Math.round(sig.lh) };
  if (sig.ls !== null && sig.ls !== undefined) settings.typography_letter_spacing = { unit: 'px', size: +sig.ls.toFixed(1) };
  if (sig.tr) settings.typography_text_transform = sig.tr;
  _typoClusters.push({ sig, id, title: typoRole(sig, _typoClusters.length), settings });
  return id;
}
function assignGlobals(n) {
  if (NO_GLOBALS || !n) return;
  if (n.kind === 'container') { const bg = n.background; if (bg && bg.color && opaque(bg.color)) { const t = tokenForColor(bg.color); if (t) n._gBgTok = t; } (n.children || []).forEach(assignGlobals); }
  else { const tc = textColor(n); if (tc) { const t = tokenForColor(tc); if (t) n._gColorTok = t; } const tp = tokenForTypo(n); if (tp) n._gTypoTok = tp; }
}
// __globals__ sibling for a text widget. colorKey selects the native control (text_color for text-editor); the
// inline value is ALWAYS still emitted as the fallback. Typography binding gated behind ABS_GLOBAL_TYPO (default OFF).
function globalRefSettings(n, colorKey) {
  if (NO_GLOBALS) return {};
  const g = {};
  if (n._gColorTok && colorKey) g[colorKey] = `globals/colors?id=${n._gColorTok}`;
  // FIX 2 — bind typography_typography to the matching Kit typography global. The inline editor HTML now carries the
  // font-* CSS VARS (typoCss), so the render is identical regardless of how the widget control resolves — the prior
  // system-fallback-drift concern (which gated this behind ABS_GLOBAL_TYPO) no longer applies. Bind it unconditionally
  // when effective-globals is on + the node has a matching typo token; the legacy ABS_GLOBAL_TYPO flag still forces it.
  if (n._gTypoTok && ((!NO_EFFECTIVE && effectiveTypoTok(n)) || process.env.ABS_GLOBAL_TYPO === '1')) g.typography_typography = `globals/typography?id=${n._gTypoTok}`;
  return Object.keys(g).length ? { __globals__: g } : {};
}
function finalizeGlobalTokens() {
  for (const c of _colorClusters) gColorTokens.push({ _id: c.id, title: `${c.title}`, color: hexOf(c.key) });
  for (const t of _typoClusters) gTypoTokens.push({ _id: t.id, title: `${t.title}`, ...t.settings });
}
function hexOf(css) { const p = parseRgb(css); if (!p) return (String(css).match(/#[0-9a-fA-F]{3,8}/) || ['#000000'])[0]; const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); return `#${h(p[0])}${h(p[1])}${h(p[2])}`.toUpperCase(); }

// ===========================================================================
// GLOBALS-EFFECTIVE (re-implemented; proven then reverted on a measurement bug).
// The kit PUT regenerates `--e-global-color-<_id>` and `--e-global-typography-<_id>-<prop>` CSS custom properties
// (verified against /tmp/kit7.css: a token _id `jptok_primary` → `--e-global-color-jptok_primary`; typography →
// `--e-global-typography-jptok_head-font-family|font-size|font-weight|line-height|letter-spacing|text-transform`).
// Because every text leaf here renders through a text-editor whose `editor` field is RAW inline-styled HTML, a
// sibling `__globals__` color/typography ref can NEVER win — the inline `color:rgb(...)` in the HTML always paints.
// So to make Kit token edits actually PROPAGATE we must emit the CSS VAR itself inline (`color:var(--e-global-...)`)
// instead of baking the literal value. The var resolves to the EXACT token value at first render (dE<=3 by cluster
// construction → pixel-identical) and re-resolves whenever the Kit token is edited (round-trip editability). Where no
// global exists, snap to the nearest finalized token within dE<=5 and bind that. The `__globals__` ref is STILL
// emitted (additive — it wires the native editor control), but the var is what makes the render itself live.
// REVERSIBILITY: STRUCT_NO_EFFECTIVE_GLOBALS=1 → bake literal inline values exactly as before (no CSS-var emission).
const NO_EFFECTIVE = process.env.STRUCT_NO_EFFECTIVE_GLOBALS === '1';
const EFFECTIVE_COLOR_DE = 5; // nearest-token snap tolerance for the "no global yet" path (clusters are dE<=3)
const STATS = { textRelyGlobal: 0, fontStripped: 0, wrappersUnwrapped: 0, sectionsNamed: 0 };
const colorVar = (tok) => `var(--e-global-color-${tok})`;
const typoVar = (tok, prop) => `var(--e-global-typography-${tok}-${prop})`;
// the materialized hex value a finalized color token will carry (the cluster anchor key).
function tokenColorValue(tok) { const c = _colorClusters.find((c) => c.id === tok); return c ? c.key : null; }
// the typo cluster (carries .sig + .settings) for a typography token id.
function typoCluster(tok) { return _typoClusters.find((c) => c.id === tok) || null; }
// Resolve the EFFECTIVE color token for a text node + return the inline color CSS to emit.
// (a) node already has _gColorTok (assignGlobals snapped it at dE<=3) AND token value dE<=3 of the inline color
//     → emit color:var(...) (do NOT bake the literal — let the global win so token edits propagate).
// (b) no token yet → find nearest finalized cluster within dE<=5; if found, bind it + emit the var.
// (c) otherwise → fall back to the literal inline color (exact prior behavior). Returns {css, tok} (tok may be null).
function effectiveColor(n) {
  const lit = textColor(n); if (!lit) return { css: '', tok: null };
  if (NO_EFFECTIVE || NO_GLOBALS) return { css: `color:${lit}`, tok: null };
  let tok = n._gColorTok || null;
  if (tok) { const tv = tokenColorValue(tok); if (!(tv && deltaE(tv, lit) <= GLOBALS_DE)) tok = null; }
  if (!tok) { let best = null, bd = Infinity; for (const c of _colorClusters) { const de = deltaE(c.key, lit); if (de < bd) { bd = de; best = c; } } if (best && bd <= EFFECTIVE_COLOR_DE) { tok = best.id; n._gColorTok = tok; } }
  // mark the node (counted ONCE per node at finalize, not per call — typoCss + a bare colorCss both hit this).
  if (tok) { n._reliesGlobalColor = true; return { css: `color:${colorVar(tok)}`, tok }; }
  return { css: `color:${lit}`, tok: null };
}

async function writeKitGlobals(sessionHeaders) {
  if (NO_GLOBALS || (!gColorTokens.length && !gTypoTokens.length)) return { colors: 0, typos: 0, ok: false };
  try {
    const body = { settings: { custom_colors: gColorTokens, custom_typography: gTypoTokens } };
    const r = await fetch(`${base}/wp-json/joist/v1/kit`, { method: 'PUT', headers: sessionHeaders, body: JSON.stringify(body) });
    const txt = await r.text(); const ok = r.ok || r.status === 200;
    console.log(`kit globals WRITE: PUT /joist/v1/kit ${r.status} ${txt.slice(0, 80)} — ${gColorTokens.length} color + ${gTypoTokens.length} typography token(s)`);
    return { colors: gColorTokens.length, typos: gTypoTokens.length, ok };
  } catch (e) { console.log('kit globals WRITE error', String(e).slice(0, 120)); return { colors: 0, typos: 0, ok: false }; }
}

// ===========================================================================
// LEAF → WIDGET — INLINE-STYLE ONLY (NO absPos, NO _element_custom_width fixed px). Same native shapes
// build-absolute.mjs:201-288 / build-flow.mjs:275-380 produce (heading/text/button/image/svg/mockup/code/video/
// list/tabs/accordion), but the parent flex column positions them, so we never spread the absolute-position keys.
// Images render at width:100% of their column with the captured aspect ratio (NO fixed-px floor) so they shrink.
// ===========================================================================
function leafWidget(n) {
  const box = n.box; if (!box || box.w < 3 || box.h < 2) return null;
  // IMAGE — width:100% of the flex column, aspect-ratio from the captured box so height tracks. NO fixed px width
  // (that would pin a desktop floor and force horizontal overflow); object-fit:cover fills like the source region.
  const sizedImg = (url) => {
    const w = round(box.w), h = round(box.h);
    // IMGCAP: pin width to captured px (max-width:100% AGREES with Elementor's img{max-width:100%} instead of being
    // overridden to 100% -> the prior bug rendered a 330x430 SVG at 1140x1721 and blew page height to ~9x). height:auto
    // + max-height caps SVGs whose intrinsic box is tall. Stays responsive: max-width:100% shrinks it on narrow columns.
    const style = `display:block;width:${w}px;max-width:100%;height:auto;max-height:${Math.max(1, h)}px;aspect-ratio:${w}/${Math.max(1, h)};object-fit:contain;${WRAP}`;
    return { elType: 'widget', widgetType: 'html', settings: { html: `<img src="${esc(url)}" alt="${esc(n.alt || '')}" style="${style}" loading="eager">` } };
  };
  // TAG-DRIVEN NATIVE IMAGE — an <img> leaf becomes a real Elementor IMAGE widget pointing at the UPLOADED media
  // asset (url + WP media id) so it is a first-class, editable image block (not an html<img>). REFLOW-SAFE: the
  // image widget is width:100% of its flex column (NO fixed-px width pin → no _element_custom_width, no bare
  // width:Npx inline; native img{max-width:100%} keeps it inside the column at any viewport). The captured box w/h
  // ride as a max-height + aspect-ratio inline cap (same SVG-blowup guard as sizedImg) WITHOUT a bare px width.
  const nativeImage = (src) => {
    const id = localId(src);
    const image = id ? { url: localSrc(src), id } : { url: localSrc(src) };
    return { elType: 'widget', widgetType: 'image', settings: {
      image, image_size: 'full', alt: n.alt || '',
      width: { unit: '%', size: 100 },                 // %-width → reflows with its column; NEVER a fixed px width pin
      // Elementor's own .elementor-widget-image img{max-width:100%;height:auto} + the page-wide no-h-scroll guard
      // keep this inside its column at any viewport (no bare width:Npx → the validate regex stays green).
    } };
  };
  if (n.kind === 'image') { const s = localSrc(n.src); return (s && s !== 'SKIP') ? nativeImage(n.src) : null; }
  if ((n.kind === 'svg' || n.kind === 'mockup') && n.raster && n.raster !== 'SKIP') return sizedImg(localSrc(n.raster));
  if (n.kind === 'svg' || n.kind === 'mockup') return null; // SKIP / no-raster decorative
  // CODE — clipped <pre> capped to the captured panel height (overflow:auto), fluid width (max-width:100%).
  if (n.kind === 'code') {
    const fs2 = (n.typo && n.typo.size) || 14; const cc = colorCss(n); const capH = round(box.h);
    const clip = capH >= 40 ? `max-height:${capH}px;overflow:auto;` : '';
    return { elType: 'widget', widgetType: 'html', settings: { html: `<pre style="${clip}white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:${fs2}px;margin:0${cc ? ';' + cc : ''};${WRAP}">${esc(n.text || '')}</pre>` } };
  }
  // VIDEO — always-present <iframe>/<video> in an html widget (fluid; aspect-ratio holds the box). build-flow.mjs:328
  if (n.kind === 'video') {
    const w = round(box.w), h = round(box.h);
    const ytId = (u) => { if (!u) return null; let m = u.match(/[?&]v=([\w-]{6,})/); if (m) return m[1]; m = u.match(/youtu\.be\/([\w-]{6,})/); if (m) return m[1]; m = u.match(/\/embed\/([\w-]{6,})/); if (m) return m[1]; m = u.match(/\/shorts\/([\w-]{6,})/); if (m) return m[1]; return null; };
    const vimeoId = (u) => { if (!u) return null; const m = u.match(/(?:player\.vimeo\.com\/video\/|vimeo\.com\/(?:video\/)?)(\d{6,})/); return m ? m[1] : null; };
    let embedSrc = null, hostedSrc = null;
    if (n.provider === 'youtube') { const id = ytId(n.src); embedSrc = id ? `https://www.youtube.com/embed/${id}` : (n.src || null); }
    else if (n.provider === 'vimeo') { const id = vimeoId(n.src); embedSrc = id ? `https://player.vimeo.com/video/${id}` : (n.src || null); }
    else if (n.provider === 'hosted') { if (n.src && /^https?:/.test(n.src)) hostedSrc = n.src; }
    else if (n.src) { embedSrc = n.src; }
    let inner;
    if (embedSrc) inner = `<iframe src="${esc(embedSrc)}" width="${w}" height="${h}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="width:100%;height:100%;border:0"></iframe>`;
    else if (hostedSrc) inner = `<video src="${esc(hostedSrc)}" width="${w}" height="${h}" controls playsinline style="width:100%;height:100%;object-fit:cover"></video>`;
    else inner = `<video width="${w}" height="${h}" controls playsinline style="width:100%;height:100%;object-fit:cover"></video>`;
    return { elType: 'widget', widgetType: 'html', settings: { html: `<div style="width:100%;max-width:${w}px;aspect-ratio:${w}/${h || 1}">${inner}</div>` } };
  }
  // LIST — native <ul>/<ol><li> via text-editor.
  if (n.kind === 'list') {
    const cc = colorCss(n);
    const items = (n.items || []).map((it) => { const t = stripEmoji(it.text); if (!t) return ''; return `<li>${it.href ? `<a href="${esc(it.href)}"${styleAttr(cc)}>${esc(t)}</a>` : esc(t)}</li>`; }).filter(Boolean).join('');
    if (!items) return null; const tagName = n.ordered ? 'ol' : 'ul';
    return { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<${tagName} style="${textCss(n)}">${items}</${tagName}>`, ...globalRefSettings(n, 'text_color') } };
  }
  // TABS — real role=tablist/tab/tabpanel in an html widget.
  if (n.kind === 'tabs') {
    const its = (n.items || []).map((it) => ({ title: stripEmoji(it.title), content: stripEmoji(it.content || '') })).filter((it) => it.title);
    if (its.length < 2) return null;
    const cc = colorCss(n);
    const tabBtns = its.map((it, i) => { const longTitle = it.title.length > 24; const nowrap = longTitle ? '' : 'white-space:nowrap;'; return `<div role="tab" aria-selected="${i === 0 ? 'true' : 'false'}" style="display:inline-block;padding:6px 14px;margin:0 4px 0 0;cursor:pointer;max-width:100%;${nowrap}${WRAP}${cc ? ';' + cc : ''}">${esc(it.title)}</div>`; }).join('');
    const panels = its.map((it) => it.content ? `<div role="tabpanel" style="padding:8px 0${cc ? ';' + cc : ''}">${esc(it.content)}</div>` : '').filter(Boolean).join('');
    const tabsHtml = `<div role="tablist" style="display:flex;flex-wrap:wrap;align-items:center;min-height:32px;width:100%;max-width:100%">${tabBtns}</div>${panels}`;
    return { elType: 'widget', widgetType: 'html', settings: { html: tabsHtml } };
  }
  // ACCORDION — native <details>.
  if (n.kind === 'accordion') {
    const cc = colorCss(n);
    const html = (n.items || []).map((it) => { const inner = (it.content || []).map((c) => c.href ? `<a href="${esc(c.href)}"${styleAttr(cc)}>${esc(c.text)}</a>` : `<p${styleAttr(cc)}>${esc(c.text)}</p>`).join(''); return `<details${it.open ? ' open' : ''}><summary${styleAttr(cc)}>${esc(it.summary)}</summary><div>${inner}</div></details>`; }).join('');
    if (!html) return null; return { elType: 'widget', widgetType: 'html', settings: { html } };
  }
  const text = stripEmoji(n.text); if (!text) return null;
  if (n.kind === 'heading') { const hn = 'h' + Math.min(6, Math.max(1, n.level || 2)); return { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<${hn} style="${textCss(n)}">${esc(text)}</${hn}>`, ...globalRefSettings(n, 'text_color') } }; }
  if (n.kind === 'button') return { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<a${n.href ? ` href="${esc(n.href)}"` : ''} style="${textCss(n)}">${esc(text)}</a>`, ...globalRefSettings(n, 'text_color') } };
  return { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<div style="${textCss(n)}">${esc(text)}</div>`, ...globalRefSettings(n, 'text_color') } };
}

// ===========================================================================
// RE-JOIN — segment members are THIN refs (kind, box, text, tag, href). Build a geometry index of the FULL capture
// leaves and look each member up by exact (rounded) box so the ported widget functions get typo/paint/src/items.
// ===========================================================================
function gatherFullLeaves(root) { const out = []; const g = (n) => { if (!n) return; if (n.kind === 'container') (n.children || []).forEach(g); else if (n.box) out.push(n); }; g(root); return out; }
const FULL_LEAVES = gatherFullLeaves(L.root);
const leafKey = (b) => `${round(b.x)}:${round(b.y)}:${round(b.w)}:${round(b.h)}`;
const FULL_INDEX = new Map();
for (const lf of FULL_LEAVES) { if (lf.box) { const k = leafKey(lf.box); if (!FULL_INDEX.has(k)) FULL_INDEX.set(k, lf); } }
// resolve a thin member to its full leaf: exact box key first, else nearest-center leaf with the same kind+text.
function resolveMember(m) {
  const exact = FULL_INDEX.get(leafKey(m.box));
  if (exact) return exact;
  const mt = stripEmoji(m.text || '');
  let best = null, bd = Infinity;
  const mcx = m.box.x + m.box.w / 2, mcy = m.box.y + m.box.h / 2;
  for (const lf of FULL_LEAVES) {
    if (lf.kind !== m.kind) continue;
    if (mt && stripEmoji(lf.text || '') !== mt) continue;
    const d = Math.hypot((lf.box.x + lf.box.w / 2) - mcx, (lf.box.y + lf.box.h / 2) - mcy);
    if (d < bd) { bd = d; best = lf; }
  }
  // accept only a close geometric match; else synthesize a minimal leaf from the thin ref so nothing is dropped.
  if (best && bd < 24) return best;
  return { kind: m.kind, box: m.box, text: m.text, tag: m.tag, href: m.href, level: m.level };
}

// ===========================================================================
// COLUMN CLUSTERING — partition a band's members into COLUMNS by x-position (gap-split). Members whose x-intervals
// overlap (or whose left edges are within the gap tolerance) share a column; a real horizontal gap starts a new
// column. Returns an ordered (left→right) array of columns, each {x0,x1,members[]} with members sorted by y.
// ===========================================================================
function clusterColumns(members, sectionBox) {
  const ms = members.filter((m) => m && m.box && m.box.w > 0 && m.box.h > 0);
  if (!ms.length) return [];
  // sort by left edge; greedily grow column intervals — a member joins the current column iff its left edge starts
  // before the column's running right edge + a gap tolerance (so members that horizontally overlap or nearly abut
  // are the same column); a real horizontal gap larger than the tolerance opens a new column.
  const sorted = [...ms].sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y);
  const sw = Math.max(1, (sectionBox && sectionBox.w) || VW);
  const GAP = Math.max(24, sw * 0.03); // a >3%-of-section horizontal gap (min 24px) separates columns
  const cols = [];
  for (const m of sorted) {
    const x0 = m.box.x, x1 = m.box.x + m.box.w;
    let placed = false;
    for (const col of cols) { if (x0 <= col.x1 + GAP && x1 >= col.x0 - GAP) { col.x0 = Math.min(col.x0, x0); col.x1 = Math.max(col.x1, x1); col.members.push(m); placed = true; break; } }
    if (!placed) cols.push({ x0, x1, members: [m] });
  }
  // merge any columns that ended up overlapping after growth (transitive merge pass), then sort each column by y.
  cols.sort((a, b) => a.x0 - b.x0);
  const merged = [];
  for (const col of cols) { const last = merged[merged.length - 1]; if (last && col.x0 <= last.x1 + GAP) { last.x1 = Math.max(last.x1, col.x1); last.members.push(...col.members); } else merged.push(col); }
  for (const col of merged) col.members.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return merged;
}

// ===========================================================================
// FIX 1 — ROW (Y-band) CLUSTERING. Before column-clustering, partition a band's members into horizontal ROWS by
// vertical-center band: a member joins the current row iff its TOP starts within the row's running bottom + a
// y-gap tolerance (~0.5× median member height); a larger vertical gap opens a NEW row. A same-y logo strip (12
// logos all at one y) collapses into ONE row; a 3×2 card region splits into 2 card rows → a grid. The running
// bottom is what makes a CARD (its stacked image/heading/text/button overlap the card image vertically) stay one
// row rather than fragmenting. Each row is then split into X-COLUMNS via rowColumns() so the logo strip becomes a
// row of N single-logo columns and a card row becomes a row of N card-columns. A row with one column per member
// is unchanged (single member → stacked, exactly as before).
// ===========================================================================
function clusterRows(members) {
  const ms = members.filter((m) => m && m.box && m.box.w > 0 && m.box.h > 0).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  if (!ms.length) return [];
  const hs = ms.map((m) => m.box.h).sort((a, b) => a - b);
  const medH = hs[Math.floor(hs.length / 2)] || 24;
  const GAP = Math.max(12, medH * 0.5); // a vertical gap > ~0.5× median row height opens a new row
  const rows = [];
  let cur = null;
  for (const m of ms) {
    const top = m.box.y, bot = m.box.y + m.box.h;
    if (!cur || top > cur.bottom + GAP) { cur = { top, bottom: bot, members: [m] }; rows.push(cur); }
    else { cur.bottom = Math.max(cur.bottom, bot); cur.members.push(m); }
  }
  return rows;
}
// X-split the members of ONE row into ordered (left→right) COLUMNS. Members whose x-intervals overlap (within a
// small tolerance) share a column; a real horizontal gap opens a new column. Tighter tolerance than clusterColumns
// (1.2%-of-section, min 12px) so tightly-packed logos in a strip each become their own column (12 logos → 12 cols).
function rowColumns(rowMembers, sectionW) {
  const sw = Math.max(1, sectionW || VW);
  const GAP = Math.max(12, sw * 0.012);
  const sorted = [...rowMembers].sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y);
  const cols = [];
  for (const m of sorted) {
    const x0 = m.box.x, x1 = m.box.x + m.box.w;
    let col = null;
    for (const c of cols) { if (x0 < c.x1 + GAP && x1 > c.x0 - GAP) { col = c; break; } }
    if (col) { col.x0 = Math.min(col.x0, x0); col.x1 = Math.max(col.x1, x1); col.members.push(m); }
    else cols.push({ x0, x1, members: [m] });
  }
  cols.sort((a, b) => a.x0 - b.x0);
  for (const col of cols) col.members.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return cols;
}

// ===========================================================================
// FIX 3 — STYLED BUTTON emitter (reuses the build-absolute button shape: padding + radius + fill/outline) in the
// flex-safe INLINE form (NO absPos, NO fixed-px width — width:auto + max-width:100% keeps the no-h-scroll guard
// happy). primary=source green-fill (#3ECF8E) for the main CTA; secondary=outline/ghost. Emitted as a native
// Elementor BUTTON widget so it reads as a real CTA (not plain text).
// ===========================================================================
const BRAND_FILL = '#3ECF8E'; // supabase green-fill primary CTA
function styledButton(text, href, variant, typo) {
  const t = stripEmoji(text); if (!t) return null;
  const size = round((typo && typo.size) || 16);
  const fam = (typo && typo.family) ? (REGFONTS[typo.family] ? typo.family : gFont(typo.family)) : null;
  if (fam && REGFONTS[typo.family]) usedFonts.add(typo.family);
  const famCss = fam ? `font-family:'${fam}';` : '';
  // fill (primary) vs outline/ghost (secondary). width:auto + max-width:100% = flex-safe, never overflows.
  const skin = variant === 'primary'
    ? `background:${BRAND_FILL};color:#1c1c1c;border:1px solid ${BRAND_FILL};`
    : `background:transparent;color:currentColor;border:1px solid currentColor;`;
  const style = `display:inline-block;padding:9px 18px;border-radius:6px;${skin}${famCss}font-size:${size}px;font-weight:600;text-decoration:none;white-space:nowrap;width:auto;max-width:100%;line-height:1.2;${WRAP}`;
  return { elType: 'widget', widgetType: 'button', settings: {
    text: t, button_type: variant === 'primary' ? 'success' : 'default', size: 'sm', align: 'left',
    // also render an inline-styled <a> twin in the button's "text" so the captured skin survives kses + theme rules.
    button_css_id: '',
    _struct_cta_html: `<a${href ? ` href="${esc(href)}"` : ''} style="${style}">${esc(t)}</a>`,
  } };
}
// We emit the styled CTA as an html widget carrying the inline <a> (button widget typography controls are unreliable
// on this stack; the inline <a> is byte-faithful + kses-safe), tagged as a button via role for the CTA detector.
function styledButtonWidget(text, href, variant, typo) {
  const sb = styledButton(text, href, variant, typo);
  if (!sb) return null;
  return { elType: 'widget', widgetType: 'html', settings: { html: sb.settings._struct_cta_html } };
}
// SECTION-LEVEL CTA DEDUP — the source layers a wrapping <a> button leaf OVER its own inner text-leaf at a near-
// identical box (hero "Start your project": button@576 + inner text@593). And a section can repeat the same CTA
// pair twice. Drop (a) any text-leaf wholly contained in a same-text button leaf, and (b) the 2nd+ occurrence of a
// repeated CTA-text. Returns {members:[…filtered], ctas:[…surviving CTA button leaves in x-order]}.
const SECTION_CTA_RX = /\b(get started|start( now| free| building| your project)?|sign ?up|sign ?in|log ?in|try( it)?( free| now)?|get( a)? demo|book( a)? demo|request( a)? demo|buy|subscribe|join|download|contact( sales| us)?|get( the)? app|talk to|view template|learn more)\b/i;
function dedupSectionCtas(members) {
  const ms = members.filter((m) => m && m.box);
  const drop = new Set();
  const norm = (m) => stripEmoji(m.text || '');
  const buttons = ms.filter((m) => m.kind === 'button' && norm(m));
  // (a) drop an inner text-leaf that is wholly inside a same-text button leaf (the duplicate inner <span>).
  for (const tx of ms) {
    if (tx.kind !== 'text' || !norm(tx)) continue;
    for (const b of buttons) {
      if (norm(b) !== norm(tx)) continue;
      const inside = tx.box.x >= b.box.x - 4 && tx.box.y >= b.box.y - 4 && (tx.box.x + tx.box.w) <= (b.box.x + b.box.w) + 4 && (tx.box.y + tx.box.h) <= (b.box.y + b.box.h) + 4;
      if (inside) { drop.add(tx); break; }
    }
  }
  // (b) drop the 2nd+ button with the same CTA text that sits at the SAME x,y band (true repeat within the section).
  const seen = new Map();
  for (const b of buttons.slice().sort((a, c) => a.box.y - c.box.y || a.box.x - c.box.x)) {
    const key = norm(b).toLowerCase();
    if (seen.has(key)) { const prev = seen.get(key); if (Math.abs(prev.box.x - b.box.x) < 12 && Math.abs(prev.box.y - b.box.y) > 20) drop.add(b); }
    else seen.set(key, b);
  }
  const kept = ms.filter((m) => !drop.has(m));
  return { members: kept, droppedCtas: drop.size };
}

// emit the widgets for a list of members (already a single column), in y-order, dropping nulls. When ctaCtx is set
// (hero), button members that read as a CTA render as STYLED button widgets (FIX 3) instead of plain text <a>.
function emitColumnWidgets(members, ctaCtx) {
  const out = [];
  for (const m of members) {
    const full = resolveMember(m);
    if (ctaCtx && full && full.kind === 'button' && SECTION_CTA_RX.test(stripEmoji(full.text || ''))) {
      const t = stripEmoji(full.text || '');
      // primary = the source primary-CTA copy ("start your project"); everything else → outline/ghost secondary.
      const variant = /start your project|get started|sign ?up|create( an)? account/i.test(t) ? 'primary' : 'secondary';
      const w = styledButtonWidget(t, full.href, variant, full.typo);
      if (w) { out.push(w); continue; }
    }
    const w = leafWidget(full); if (w) out.push(w);
  }
  return out;
}

// ===========================================================================
// SECTION → full-width flex CONTAINER. content_width=full, flex column, width 100%, section bg + min_height from
// bbox + vertical padding. Inside: cluster members into columns; if >1 column emit an inner flex ROW container
// whose children are the columns (each a flex child with flex-basis=(colW/sectionW)% + min-width:0); else emit the
// single column's widgets directly into the section column. Backgrounds use the segment band bg descriptor.
// ===========================================================================
function bandBgSettings(bg) {
  if (!bg || bg.kind === 'default' || !bg.value) return {};
  if (bg.kind === 'color' && opaque(bg.value)) return { background_background: 'classic', background_color: bg.value };
  if (bg.kind === 'gradient') { const c = gradientColor(bg.value); return c ? { background_background: 'classic', background_color: c } : {}; }
  if (bg.kind === 'image') return { background_background: 'classic', background_image: { url: localSrc(bg.value) }, background_size: 'cover', background_position: 'center center' };
  return {};
}
// CONTENT max-width: the boxed content column. Sections whose bbox spans nearly the full viewport are full-bleed
// (background runs edge-to-edge) but the INNER content row is capped to the boxed width and centered, so the
// section reflows without horizontal scroll. We pin the inner row's max-width, never a fixed px on a widget.
const CONTENT_MAXW = (() => {
  // the widest section bbox that is NOT full-bleed ≈ the content column; default 1280 (typical boxed Elementor).
  return Math.min(1280, Math.round(VW * 0.92));
})();

// build ONE column container: a flex child with PERCENT flex-basis (colW/sectionW) + min-width:0 so it shrinks.
// gridChild=true → the parent is a CSS GRID (RAM-grid path): the grid track governs the cell width, so we DROP the
// fixed %-flex-basis/width pin entirely and let the cell be an in-flow grid child (width:100% of its track). This is
// what makes the RAM grid reflow N→…→1: a %-basis cell would shrink-but-stay-N-up; a grid child re-tracks by width.
function columnContainer(col, sectionW, totalCols, ctaCtx, gridChild) {
  const widgets = emitColumnWidgets(col.members, ctaCtx);
  if (!widgets.length) return null;
  if (gridChild) {
    // GRID CHILD — no width/flex-basis pin; the auto-fit minmax track sizes it. Just a column stack of its widgets.
    const settings = {
      content_width: 'full', flex_direction: 'column',
      flex_gap: { unit: 'px', size: 12, column: '12', row: '12' },
      padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
    };
    return container(settings, widgets);
  }
  const colW = Math.max(1, col.x1 - col.x0);
  const basisPct = Math.max(8, Math.min(100, Math.round((colW / Math.max(1, sectionW)) * 100)));
  const settings = {
    content_width: 'full', flex_direction: 'column',
    // PERCENT flex-basis (NOT a fixed px width) + grow/shrink so the column reflows; min-width:0 via _element css
    // so a wide child cannot force the column past its basis. width:100% at narrow viewports (flex wraps the row).
    width: { unit: '%', size: basisPct }, _flex_basis: { unit: '%', size: basisPct },
    _flex_grow: '1', _flex_shrink: '1',
    flex_gap: { unit: 'px', size: 12, column: '12', row: '12' },
    padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
  };
  return container(settings, widgets);
}

// RAM-GRID stat (reported in the OK line): how many multi-column grid/card rows were emitted as a CSS grid track.
const RAMSTATS = { gridRows: 0 };
const RAMCSS = []; // scoped #id{display:grid;…} rules, injected page-wide via custom_css alongside the nav fallback.
let _ramId = 0; const idCounter = () => (++_ramId);
const NO_RAMGRID = process.env.STRUCT_NO_RAMGRID === '1' || process.env.FLOW_NO_RAMGRID === '1';
// RAM-GRID QUALIFIER — is this row a multi-column GRID/CARD row (>=2 comparable-width cells)? A real grid/card row
// has >=2 cells whose widths are within ~25% of the narrowest (the SAME comparable-cell notion build-flow's RAM
// branch keys off). A hero|sidebar split (one cell 3-4x another) or a logo-strip mix never qualifies — those stay
// the flex-%-basis path. Returns {ok, medianCellPx, n} where medianCellPx = the median captured CELL width.
function ramGridQualify(cols) {
  if (NO_RAMGRID) return { ok: false };
  if (!cols || cols.length < 2) return { ok: false };
  const cellWs = cols.map((c) => Math.max(1, c.x1 - c.x0)).filter((w) => w > 0);
  if (cellWs.length < 2) return { ok: false };
  const mn = Math.min(...cellWs), mx = Math.max(...cellWs);
  const comparable = mx <= mn * 1.25; // comparable-width gate (mixed-width rows excluded — stay flex)
  const medianCellPx = round(median(cellWs));
  if (!comparable || medianCellPx <= 0) return { ok: false };
  return { ok: true, medianCellPx, n: cols.length };
}

// FIX 1 — build ONE Y-ROW as an inner container. Split the row's members into X-columns; if >1 column emit a
// container whose children are the column containers; if 1 column, return its widgets to be stacked directly (a
// one-member-per-row section is unchanged).
//
// RAM-GRID (the responsive recipe, default ON; STRUCT_NO_RAMGRID=1 reverts): for a multi-column GRID/CARD row
// (>=2 comparable-width cells), emit the wrapper as a CSS GRID — container_type:'grid' with
//   grid_columns_grid = { unit:'custom', size:'repeat(auto-fit, minmax(min(<medianCellPx>px,100%), 1fr))' }
// (the SAME proven kses-safe channel build-flow's RAM branch rides). The cells become in-flow grid children with
// NO fixed %-flex-basis (columnContainer gridChild=true drops the width pin). This renders byte-identical at 1440
// (the same N columns fit the content width) but auto-fit auto-reflows 3→2→1 as the width narrows and STACKS to
// 1-col at 390 (kills the mobile overflow + matches the source grid→1col recomposition). The inner min(<cell>px,
// 100%) guard means a track can never demand more than the container, so there is NO horizontal scroll at any width.
// A mixed-width row (hero|sidebar) or a single-column row stays the OLD flex-%-basis path, unchanged.
function rowContainer(row, sectionW, ctaCtx) {
  const cols = rowColumns(row.members, sectionW);
  if (!cols.length) return { widgets: [], rowEl: null };
  if (cols.length === 1) {
    // a single-column row → its widgets stack directly into the parent (no extra wrapper). Unchanged behavior.
    return { widgets: emitColumnWidgets(cols[0].members, ctaCtx), rowEl: null };
  }
  // band tightness → align-items: if the row's members are short relative to the band, center them; else top-align.
  const bandH = Math.max(1, row.bottom - row.top);
  const medMemberH = (() => { const hs = row.members.map((m) => m.box.h).sort((a, b) => a - b); return hs[Math.floor(hs.length / 2)] || bandH; })();
  const align = (medMemberH / bandH > 0.7) ? 'center' : 'flex-start';
  // RAM-GRID PATH — a multi-column grid/card row of comparable-width cells → a CSS grid that auto-reflows.
  const ram = ramGridQualify(cols);
  if (ram.ok) {
    const gridChildren = cols.map((c) => columnContainer(c, sectionW, cols.length, ctaCtx, true)).filter(Boolean);
    if (gridChildren.length >= 2) {
      RAMSTATS.gridRows++;
      // captured grid gap → reuse the source-ish gutter (24px, matching the prior flex row gap); applied once per track.
      const gap = 24;
      const track = `repeat(auto-fit, minmax(min(${ram.medianCellPx}px, 100%), 1fr))`;
      const rowEl = container({
        content_width: 'full',
        // NATIVE container grid — drives --e-con-grid-template-columns from grid_columns_grid (custom unit). The
        // auto-fit minmax(min(Wpx,100%),1fr) track reflows N→…→1 by width with ZERO media query (kses-safe).
        container_type: 'grid',
        grid_columns_grid: { unit: 'custom', size: track },
        grid_rows_grid: { unit: 'fr', size: 'auto' },
        grid_gaps: { column: String(gap), row: String(gap), unit: 'px', isLinked: false },
        grid_auto_flow: 'row',
        flex_align_items: align,
        width: { unit: '%', size: 100 },
        padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
        // BELT-AND-SUSPENDERS — a scoped inline display:grid via _element_id so the track applies even if the
        // native container_type:'grid' control is ignored on this stack (kses-safe: no position, no bare px width;
        // the min(<cell>px,100%) inner guard caps every track to the container so there is no horizontal scroll).
        _element_id: `ramgrid-${idCounter()}`,
      }, gridChildren);
      // scoped custom CSS for this grid (injected page-wide via the collector) — mirrors ram-grid-responsive.workflow.
      RAMCSS.push(`#${rowEl.settings._element_id}{display:grid !important;grid-template-columns:${track} !important;gap:${gap}px !important;align-items:${align}}`);
      return { widgets: [], rowEl };
    }
  }
  // FLEX PATH (unchanged) — single-cell-survivor or mixed-width row.
  const colContainers = cols.map((c) => columnContainer(c, sectionW, cols.length, ctaCtx)).filter(Boolean);
  if (colContainers.length < 2) {
    // every column but one was empty → fall back to a flat stack of whatever survived.
    return { widgets: colContainers[0] ? colContainers[0].elements : [], rowEl: null };
  }
  const rowEl = container({
    content_width: 'full', flex_direction: 'row', flex_wrap: 'wrap', flex_align_items: align, flex_justify_content: 'center',
    flex_gap: { unit: 'px', size: 24, column: '24', row: '24' }, width: { unit: '%', size: 100 },
    padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
  }, colContainers);
  return { widgets: [], rowEl };
}

// ===========================================================================
// NATIVE <table> EMISSION (table/comparison-matrix regions ONLY). The capture retains the source <table> node with
// its <thead>/<tbody>/<tr>/<th>/<td> semantics (segment.mjs flattens those into thin leaf members, which the row-
// grid path then decomposes into per-row flex grids — a comparison matrix loses its table-ness). Here we read the
// FULL capture tree (L.root), find every <table> node, and re-emit it as a SEMANTIC native <table> inside an html
// widget: header row → <thead><tr><th>; body rows → <tbody><tr> with the feature-label as a row-header <th> and the
// data cells as <td> snapped to the captured plan columns by x-position; full-width category rows → a colspan <th>.
// SCOPE: this only fires for sections whose content IS a captured table (matchTableForSection); every other section
// is built byte-identically by the unchanged row-grid path below. Style is minimal + bounded (width:100%; max-width:
// 100%; overflow-x:auto wrapper) so the no-h-scroll invariant holds even for very wide matrices.
// ===========================================================================
const NO_TABLE = process.env.STRUCT_NO_TABLE === '1';
const TABLESTATS = { tables: 0 };
function gatherTables(root) {
  const out = [];
  const g = (n) => { if (!n || typeof n !== 'object') return; if (n.tag === 'table') { out.push(n); return; } (n.children || []).forEach(g); };
  g(root);
  return out;
}
const CAPTURED_TABLES = NO_TABLE ? [] : gatherTables(L.root);
// collect the visible text under a node, splitting on hard newlines (a single capture leaf may carry a whole stacked
// cell, e.g. "ENTERPRISE\n\nCustom\n\nContact Us"); each non-empty line becomes a text fragment.
function cellLines(n) {
  const acc = [];
  const walk = (x) => { if (!x || typeof x !== 'object') return; const t = x.text; if (t) { for (const piece of String(t).split('\n')) { const p = stripEmoji(piece); if (p) acc.push(p); } } (x.children || []).forEach(walk); };
  walk(n);
  return acc;
}
const cellText = (n) => cellLines(n).join(' ');
// find the direct <tr> rows of a table: a <thead>/<tbody> wraps <tr>s; some captures put header/data cells as DIRECT
// children of <tbody> (a th category row, or a tr-less leading cell). We normalize to {head:[trCells…], body:[…]}.
function tableSections(tbl) {
  const kids = tbl.children || [];
  let headEl = kids.find((k) => k.tag === 'thead');
  let bodyEl = kids.find((k) => k.tag === 'tbody');
  // a table with no thead/tbody (cells direct under <table>) — treat all rows as body.
  const headRows = headEl ? (headEl.children || []).filter((r) => r.tag === 'tr') : [];
  // body: each child that is a <tr> is a row; each child that is a bare <th>/<td> (no tr wrapper) is a full-width row.
  const bodyKids = bodyEl ? (bodyEl.children || []) : kids.filter((k) => k.tag !== 'thead' && k.tag !== 'tbody');
  return { headRows, bodyKids };
}
// derive the canonical DATA columns of a comparison matrix: the x-centers of the header-row cells AFTER the leading
// (label) column. Falls back to the union of data-cell x positions if there is no usable header row.
function deriveColumns(tbl) {
  const { headRows, bodyKids } = tableSections(tbl);
  let cells = null;
  if (headRows.length) { const hc = (headRows[0].children || []).filter((c) => c.box); if (hc.length >= 2) cells = hc; }
  if (!cells) {
    // no header row → infer from the most-populated tr's data cells.
    const trs = bodyKids.filter((k) => k.tag === 'tr');
    let best = null; for (const tr of trs) { const dc = (tr.children || []).filter((c) => c.box); if (!best || dc.length > best.length) best = dc; }
    cells = best || [];
  }
  // the leading column is the feature-LABEL column (leftmost); the rest are the plan/data columns. A matrix has its
  // label column at the table's left edge; the header row may itself omit the label cell (label col blank in <thead>).
  const tblX0 = (tbl.box && tbl.box.x) || 0;
  const sorted = [...cells].sort((a, b) => a.box.x - b.box.x);
  // if the leftmost header cell starts at the table's left edge it IS a data column too (no separate label col in head);
  // we still reserve a label column band [tblX0 .. firstDataX) for the body row-headers.
  const dataCells = sorted;
  const cols = dataCells.map((c) => ({ x0: c.box.x, x1: c.box.x + c.box.w, cx: c.box.x + c.box.w / 2, label: cellText(c) }));
  return { cols, labelX1: cols.length ? cols[0].x0 : tblX0 + 1 };
}
// snap a data cell to the nearest derived column by x-center; returns the column index or -1.
function snapCol(cell, cols) {
  if (!cell.box || !cols.length) return -1;
  const cx = cell.box.x + cell.box.w / 2;
  let bi = -1, bd = Infinity;
  for (let i = 0; i < cols.length; i++) { const d = Math.abs(cx - cols[i].cx); if (d < bd) { bd = d; bi = i; } }
  // accept only if within half the inter-column pitch (else it is really the label column / spans).
  const pitch = cols.length > 1 ? Math.abs(cols[1].cx - cols[0].cx) : 9999;
  return bd <= pitch * 0.6 ? bi : -1;
}
// emit ONE captured <table> node as a semantic native <table> in an html widget (with an overflow-x:auto wrapper).
function buildTableWidget(tbl) {
  const { headRows, bodyKids } = tableSections(tbl);
  const { cols, labelX1 } = deriveColumns(tbl);
  const nCols = cols.length;
  if (!nCols) return null;
  // border/padding/typo lifted from a representative captured cell (first data cell of the header, else table border).
  const sampleCell = (headRows[0] && (headRows[0].children || [])[0]) || null;
  const bd = (tbl.border && tbl.border.color && opaque(tbl.border.color)) ? tbl.border.color : 'rgba(0,0,0,0.12)';
  const cellPad = '10px 12px';
  const totalCols = nCols + 1; // + the leading feature-label column
  const esc2 = esc;
  const headerLabel = (c) => { const lines = cellLines(c); return lines.map((l) => esc2(l)).join('<br>'); };
  // THEAD — a leading (label) corner cell + one <th> per data column.
  let thead = '';
  if (headRows.length) {
    const hcells = (headRows[0].children || []).filter((c) => c.box).sort((a, b) => a.box.x - b.box.x);
    const ths = hcells.map((c) => `<th scope="col" style="text-align:left;padding:${cellPad};border-bottom:2px solid ${bd};vertical-align:top">${headerLabel(c)}</th>`).join('');
    thead = `<thead><tr><th scope="col" style="padding:${cellPad};border-bottom:2px solid ${bd}"></th>${ths}</tr></thead>`;
  }
  // TBODY — each bare <th>/<td> child is a full-width category row (colspan); each <tr> is a feature row: leftmost cell
  // (label-column) → row-header <th>, the rest snapped into <td> columns by x.
  const bodyRows = [];
  for (const k of bodyKids) {
    if (k.tag === 'tr') {
      const cells = (k.children || []).filter((c) => c.box).sort((a, b) => a.box.x - b.box.x);
      // the label cell = any cell whose center is left of the first data column; the rest are data cells.
      const tds = new Array(nCols).fill('');
      let labelCell = null;
      for (const c of cells) {
        const ci = snapCol(c, cols);
        const cx = c.box.x + c.box.w / 2;
        if (ci < 0 || cx < labelX1) { if (!labelCell) labelCell = c; else { /* extra left text → fold into label */ const extra = cellText(c); if (extra) labelCell = { ...labelCell, _extra: (labelCell._extra || '') + ' ' + extra }; } }
        else { const txt = cellLines(c).map(esc2).join('<br>'); tds[ci] = txt; }
      }
      const labTxt = labelCell ? (cellLines(labelCell).map(esc2).join('<br>') + (labelCell._extra ? ' ' + esc2(labelCell._extra.trim()) : '')) : '';
      const tdHtml = tds.map((t) => `<td style="text-align:left;padding:${cellPad};border-bottom:1px solid ${bd};vertical-align:top">${t}</td>`).join('');
      bodyRows.push(`<tr><th scope="row" style="text-align:left;padding:${cellPad};border-bottom:1px solid ${bd};font-weight:500;vertical-align:top">${labTxt}</th>${tdHtml}</tr>`);
    } else if (k.tag === 'th' || k.tag === 'td') {
      // a bare cell directly under tbody = a full-width category header row spanning every column.
      const txt = cellLines(k).map(esc2).join('<br>');
      if (!txt) continue;
      bodyRows.push(`<tr><th colspan="${totalCols}" scope="colgroup" style="text-align:left;padding:${cellPad};border-bottom:1px solid ${bd};font-weight:700;background:rgba(0,0,0,0.03)">${txt}</th></tr>`);
    }
  }
  const tbody = `<tbody>${bodyRows.join('')}</tbody>`;
  const tableStyle = `width:100%;max-width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px;line-height:1.4;${WRAP}`;
  const html = `<div style="width:100%;max-width:100%;overflow-x:auto"><table style="${tableStyle}">${thead}${tbody}</table></div>`;
  TABLESTATS.tables++;
  return { elType: 'widget', widgetType: 'html', settings: { html } };
}
// is THIS section essentially a captured table? Match a captured <table> whose bbox is contained in (and dominates)
// the section's bbox. Returns the captured table node or null. Strict: the table must overlap >=60% of the section
// height AND share the section's left edge band (so only true table sections are intercepted; everything else falls
// through to the byte-identical row-grid path).
function matchTableForSection(sb) {
  if (!CAPTURED_TABLES.length || !sb) return null;
  for (const tbl of CAPTURED_TABLES) {
    const tb = tbl.box; if (!tb) continue;
    const secTop = sb.y, secBot = sb.y + (sb.h || 0);
    const tblTop = tb.y, tblBot = tb.y + (tb.h || 0);
    const overlap = Math.max(0, Math.min(secBot, tblBot) - Math.max(secTop, tblTop));
    const secH = Math.max(1, sb.h || 0);
    if (overlap / secH < 0.6) continue;                       // table must fill most of the section vertically
    if (Math.abs((tb.x) - (sb.x)) > Math.max(40, sb.w * 0.1)) continue; // and share the section's left edge band
    return tbl;
  }
  return null;
}

// ===========================================================================
// FIX 3 — HYGIENE. (a) Unwrap redundant single-child CONTAINER wrappers: a container whose elements are exactly ONE
// child that is ITSELF a container, where the wrapper adds no own paint/min-height/grid identity, is collapsed —
// the lone child is lifted up (its content_width/_element_id are merged so the inner row still applies). This kills
// the empty "div in a div" nesting the row/column machinery leaves behind (e.g. a 1-column row whose single column
// is a 1-row inner, or a boxed-inner wrapping a single grid row). (b) auto-name section containers with a human
// `_title` (Hero / Logo wall / Pricing table / Footer / Section N) so the Elementor navigator is legible.
// SCOPE: only container→container nesting is collapsed; a heading/button/image widget is NEVER promoted (out of
// scope — we keep every leaf widget exactly where the layout placed it). REVERSIBILITY: STRUCT_NO_HYGIENE=1.
const NO_HYGIENE = process.env.STRUCT_NO_HYGIENE === '1';
// a wrapper is "redundant" iff it carries no paint/background, no min_height pin, no grid identity, and no its-own
// CTA/element-id semantics that the child lacks — i.e. it exists only to nest. We keep the child's settings and
// fold the wrapper's content_width/_element_id onto it so nothing visible changes.
function isRedundantWrapper(node) {
  if (!node || node.elType !== 'container' || !Array.isArray(node.elements) || node.elements.length !== 1) return false;
  const child = node.elements[0];
  if (!child || child.elType !== 'container') return false;          // only collapse container→container (never lift a widget)
  const s = node.settings || {};
  if (s.background_background || s.background_color || s.background_image) return false; // wrapper paints → keep
  if (s.min_height && s.min_height.size && +s.min_height.size > 40) return false;       // wrapper holds band height → keep
  if (s.container_type === 'grid' || s.grid_columns_grid) return false;                 // wrapper IS the grid track → keep
  if (s._title) return false;                                        // a named section wrapper is meaningful → keep
  return true;
}
function unwrapRedundant(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node.elements)) node.elements = node.elements.map(unwrapRedundant);
  if (NO_HYGIENE) return node;
  let cur = node;
  // collapse a chain of redundant single-container wrappers (transitive), preserving content_width/_element_id.
  while (isRedundantWrapper(cur)) {
    const child = cur.elements[0];
    const ps = cur.settings || {}, cs = child.settings || {};
    if (ps._element_id && !cs._element_id) cs._element_id = ps._element_id;
    if (ps.content_width && !cs.content_width) cs.content_width = ps.content_width;
    child.settings = cs;
    STATS.wrappersUnwrapped++;
    cur = child;
  }
  return cur;
}
// derive a human section title from its members (best-effort, used only for the navigator label).
function deriveSectionTitle(sec, idx, sb) {
  const ms = (sec.members || []).map(resolveMember).filter(Boolean);
  const texts = ms.filter((m) => m.text).map((m) => stripEmoji(m.text).toLowerCase());
  const blob = texts.join(' ');
  const imgs = ms.filter((m) => m.kind === 'image' || m.kind === 'svg' || m.kind === 'mockup');
  if ((sb && (sb.y || 0) < 700)) return 'Hero';
  if (matchTableForSection(sb) || /\b(per month|\/mo|\/month|pricing|free\b.*\$|\$\d)/.test(blob) && /\b(plan|tier|pricing|pro|enterprise|starter|free)\b/.test(blob)) return 'Pricing table';
  // a logo wall: several images on one Y band with little/no text.
  if (imgs.length >= 4 && texts.join('').length < 60) return 'Logo wall';
  if (/\b(testimonial|customers say|loved by|trusted by)\b/.test(blob)) return 'Testimonials';
  if (/\b(frequently asked|faq|questions)\b/.test(blob)) return 'FAQ';
  // else: the first heading's text (trimmed) or a positional fallback.
  const head = ms.find((m) => m.kind === 'heading' && stripEmoji(m.text));
  if (head) { const t = stripEmoji(head.text); return t.length > 40 ? t.slice(0, 40) + '…' : t; }
  return `Section ${idx + 1}`;
}

function buildSection(sec, idx) {
  const sb = sec.bbox || { x: 0, y: sec.y0 || 0, w: VW, h: (sec.y1 || 0) - (sec.y0 || 0) };
  const sectionW = sb.w || VW;
  const minH = Math.max(40, round((sec.y1 != null && sec.y0 != null) ? (sec.y1 - sec.y0) : sb.h));
  // FIX 3 — auto-name the section container for the Elementor navigator.
  const secTitle = NO_HYGIENE ? null : deriveSectionTitle(sec, idx, sb);
  if (secTitle) STATS.sectionsNamed++;
  // NATIVE TABLE — if this section's content IS a captured <table>/comparison-matrix, emit a semantic native <table>
  // instead of decomposing it into per-row flex grids. SCOPE: only a true table section (matchTableForSection) is
  // intercepted; non-table sections fall through to the unchanged row-grid path and build byte-identically.
  const tblNode = matchTableForSection(sb);
  if (tblNode) {
    const tableWidget = buildTableWidget(tblNode);
    if (tableWidget) {
      const innerSettings = { content_width: 'boxed', flex_direction: 'column', flex_gap: { unit: 'px', size: 24, column: '24', row: '24' }, width: { unit: '%', size: 100 }, padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } };
      const inner = container(innerSettings, [tableWidget]);
      const sectionSettings = {
        content_width: 'full', flex_direction: 'column', flex_align_items: 'center', flex_justify_content: 'flex-start',
        width: { unit: '%', size: 100 },
        min_height: { unit: 'px', size: minH }, min_height_tablet: { unit: 'px', size: 0 }, min_height_mobile: { unit: 'px', size: 0 },
        padding: { unit: 'px', top: '40', right: '20', bottom: '40', left: '20', isLinked: false },
        _element_id: `sec-${idx}`,
        ...(secTitle ? { _title: secTitle } : {}),
        ...bandBgSettings(sec.bg),
      };
      return container(sectionSettings, [inner]);
    }
    // buildTableWidget returned null (no usable columns) → fall through to the row-grid path (no regression).
  }
  // FIX 3 — section-level CTA dedup (drop the inner text-leaf duplicated under a same-text button + repeated CTAs).
  const ded = dedupSectionCtas(sec.members || []);
  // hero CTA styling: only the above-fold hero band (the first section near the top) renders CTAs as styled buttons.
  const isHero = (sb.y || 0) < 700;
  const ctaCtx = isHero;
  // FIX 1 — cluster members into Y-ROWS first; each row becomes an inner flex container of X-columns (a grid). A
  // same-y logo strip → ONE row of N logo-columns; a 3×N card region → rows of card-columns. Single-member rows
  // stack unchanged.
  const rows = clusterRows(ded.members);
  const innerEls = [];
  for (const r of rows) {
    const built = rowContainer(r, sectionW, ctaCtx);
    if (built.rowEl) innerEls.push(built.rowEl);
    else if (built.widgets && built.widgets.length) innerEls.push(...built.widgets);
  }
  if (!innerEls.length) return null; // empty section → drop (keeps invariant: every emitted section has content)
  // the inner content wrapper: a BOXED flex COLUMN (rows stack vertically) capped to the content width + centered.
  // Each row child is itself a flex-row that wraps at narrow widths, so the page reflows with no horizontal scroll.
  const innerSettings = { content_width: 'boxed', flex_direction: 'column', flex_gap: { unit: 'px', size: 24, column: '24', row: '24' }, width: { unit: '%', size: 100 }, padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } };
  const inner = container(innerSettings, innerEls);
  // SECTION container — FULL-WIDTH (content_width:full → background runs edge-to-edge), flex column, width 100%,
  // section bg + min_height from bbox + vertical padding. The boxed inner is centered via align-items:center.
  const sectionSettings = {
    content_width: 'full', flex_direction: 'column', flex_align_items: 'center', flex_justify_content: 'flex-start',
    width: { unit: '%', size: 100 },
    min_height: { unit: 'px', size: minH }, min_height_tablet: { unit: 'px', size: 0 }, min_height_mobile: { unit: 'px', size: 0 },
    padding: { unit: 'px', top: '40', right: '20', bottom: '40', left: '20', isLinked: false },
    _element_id: `sec-${idx}`,
    ...(secTitle ? { _title: secTitle } : {}),
    ...bandBgSettings(sec.bg),
  };
  return container(sectionSettings, [inner]);
}

// ===========================================================================
// NAV → full-width flex ROW: logo left + nav links (center/right) + CTA right. Pro → nav-menu widget bound by a
// per-page slug; no-Pro → a flex row of per-link text-editor widgets. The header is content_width:full + width:100%
// so it reflows; NO absolute positioning, NO fixed-px width (so it never causes horizontal scroll).
// ===========================================================================
const CTA_RX = /\b(get started|start( now| free| building| your project)?|sign ?up|sign ?in|log ?in|try( it)?( free| now)?|get( a)? demo|book( a)? demo|request( a)? demo|buy|subscribe|join|download|contact( sales| us)?|get( the)? app|talk to)\b/i;
// FIX 2 — derive the site BRAND text from the page itself (URL hostname or document title), NOT from a nav link.
// e.g. https://supabase.com/ → "Supabase"; "Supabase | The Postgres…" → "Supabase". Used only when the nav has no
// captured brand image/svg, so the logo slot never falls back to an arbitrary menu label like "Pricing".
function brandFromPage() {
  // 1) URL hostname → strip www + TLD, take the registrable name, Title-Case it.
  try {
    if (L.url) {
      const host = new URL(L.url).hostname.replace(/^www\./, '');
      const core = host.split('.').filter((p) => !/^(com|org|net|io|co|app|dev|ai|xyz|gg|so|sh|me|us|uk|inc)$/i.test(p)).pop() || host.split('.')[0];
      if (core && core.length >= 2) return core.charAt(0).toUpperCase() + core.slice(1);
    }
  } catch {}
  // 2) document title before the first separator (| - – — :).
  if (L.title) { const lead = String(L.title).split(/[|\-–—:]/)[0].trim(); if (lead && lead.length <= 40) return lead; }
  return null;
}
function analyzeNav(navSeg) {
  if (!navSeg || !navSeg.members || !navSeg.members.length) return null;
  const full = navSeg.members.map(resolveMember);
  const anchors = full.filter((n) => n.kind === 'button' && stripEmoji(n.text)).sort((a, b) => a.box.x - b.box.x);
  if (!anchors.length) return null;
  const firstAnchorX = anchors[0].box.x;
  // FIX 2 — BRAND element: the leftmost image/svg/mockup IN the nav band that sits at/left-of the first nav anchor
  // (the wordmark), never a centered hero mockup. Must be a real renderable asset (src or raster, not SKIP).
  const logo = full
    .filter((n) => (n.kind === 'image' || n.kind === 'svg' || n.kind === 'mockup'))
    .filter((n) => n.box && n.box.x <= firstAnchorX + 20 && ((n.src && !/^data:/.test(n.src)) || (n.raster && n.raster !== 'SKIP')))
    .sort((a, b) => a.box.x - b.box.x)[0] || null;
  // brand TEXT — used only when there is NO brand image. Prefer a captured short text/heading that sits LEFT of the
  // first nav anchor (a real wordmark text); else fall back to the page-derived brand. NEVER a nav menu link.
  let logoText = null, logoTextStr = null;
  if (!logo) {
    const leftText = full
      .filter((n) => (n.kind === 'heading' || n.kind === 'text') && stripEmoji(n.text) && stripEmoji(n.text).length <= 24 && n.box && n.box.x < firstAnchorX - 8)
      .sort((a, b) => a.box.x - b.box.x)[0] || null;
    if (leftText) { logoText = leftText; logoTextStr = stripEmoji(leftText.text); }
    else { logoTextStr = brandFromPage(); }
  }
  const ctaCand = [...anchors].sort((a, b) => (b.box.x - a.box.x));
  let cta = ctaCand.find((n) => CTA_RX.test(stripEmoji(n.text))) || null;
  // FIX 2 — never let the brand element leak into the menu links: drop the logo/logoText anchor + any anchor whose
  // text equals the brand string from the menu-links list.
  const brandStr = (logoTextStr || '').toLowerCase();
  let navAnchors = anchors.filter((n) => n !== cta && n !== logoText && (!brandStr || stripEmoji(n.text).toLowerCase() !== brandStr));
  if (!navAnchors.length) { navAnchors = anchors.filter((n) => n !== logoText); cta = null; }
  const items = navAnchors.map((n) => ({ title: stripEmoji(n.text), url: n.href || '#', typo: n.typo || {}, color: textColor(n) }));
  const navTypo = (items[0] && items[0].typo) || {};
  const navColor = (items.find((it) => it.color) || {}).color || '#111111';
  // header bg: scan the nav band's container ancestor in the capture for a solid/gradient bg at the top.
  let headerBg = null;
  const findBandBg = (n) => { if (!n || n.kind !== 'container' || headerBg) return; const b = n.background; if (b && n.box && n.box.y < 60 && n.box.h < 220) { if (b.color && opaque(b.color)) { headerBg = b.color; return; } if (b.gradient) { const g = gradientColor(b.gradient); if (g) { headerBg = g; return; } } } (n.children || []).forEach(findBandBg); };
  findBandBg(L.root);
  console.log(`nav brand: ${logo ? 'image/svg wordmark' : (logoTextStr ? `text "${logoTextStr}"` : 'none')}; ${items.length} menu link(s)${cta ? ' + CTA' : ''}`);
  return { items, cta, logo, logoText, logoTextStr, navTypo, navColor, headerBg };
}
const navSlug = (pid) => `clone-${pid}-nav`;
async function createNavMenu(items, pid, basicAuthHeaders) {
  const slug = navSlug(pid);
  try {
    let termId = null;
    try { const list = await (await fetch(`${base}/wp-json/wp/v2/menus?slug=${encodeURIComponent(slug)}`, { headers: basicAuthHeaders })).json(); if (Array.isArray(list) && list[0] && list[0].id) termId = list[0].id; } catch {}
    if (!termId) { const cr = await fetch(`${base}/wp-json/wp/v2/menus`, { method: 'POST', headers: basicAuthHeaders, body: JSON.stringify({ name: slug, slug }) }); const cj = await cr.json(); termId = cj && cj.id; if (!termId) { console.log('nav menu CREATE failed', cr.status); return null; } }
    else { try { const cur = await (await fetch(`${base}/wp-json/wp/v2/menu-items?menus=${termId}&per_page=100`, { headers: basicAuthHeaders })).json(); if (Array.isArray(cur)) for (const it of cur) { try { await fetch(`${base}/wp-json/wp/v2/menu-items/${it.id}?force=true`, { method: 'DELETE', headers: basicAuthHeaders }); } catch {} } } catch {} }
    let added = 0;
    for (const it of items) { const r = await fetch(`${base}/wp-json/wp/v2/menu-items`, { method: 'POST', headers: basicAuthHeaders, body: JSON.stringify({ title: it.title, url: it.url || '#', status: 'publish', menus: termId }) }); if (r.ok) added++; }
    console.log(`nav menu ITEMS: ${added}/${items.length} attached to ${slug}`);
    return added > 0 ? slug : null;
  } catch (e) { console.log('nav menu error', String(e).slice(0, 120)); return null; }
}
function buildNavHeader(nav, proMode, slug) {
  const navSize = round((nav.navTypo && nav.navTypo.size) || 16);
  const navColor = nav.navColor || '#111111';
  const headerSettings = {
    content_width: 'full', flex_direction: 'row', flex_justify_content: 'space-between', flex_align_items: 'center', flex_wrap: 'wrap',
    width: { unit: '%', size: 100 },
    padding: { unit: 'px', top: '14', right: '40', bottom: '14', left: '40', isLinked: false },
    _element_id: 'clone-header',
    ...(NO_HYGIENE ? {} : { _title: 'Header' }),
    ...(nav.headerBg ? { background_background: 'classic', background_color: nav.headerBg } : {}),
  };
  const elements = [];
  const logoWidget = (() => {
    if (nav.logo) { const src = localSrc(nav.logo.src || nav.logo.raster); if (src && src !== 'SKIP') { const h = round(Math.min(48, (nav.logo.box && nav.logo.box.h) || 32)); return { elType: 'widget', widgetType: 'html', settings: { html: `<img src="${esc(src)}" alt="${esc(nav.logo.alt || 'logo')}" style="display:block;height:${h}px;width:auto;max-width:200px">` } }; } }
    // FIX 2 — brand TEXT: the captured wordmark text if present, else the page-derived brand (logoTextStr). NEVER a
    // nav menu link (those were excluded from logoText/logoTextStr upstream).
    const lt = (nav.logoText ? stripEmoji(nav.logoText.text) : '') || (nav.logoTextStr || '');
    if (lt) return { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<div style="font-weight:700;font-size:20px;${navColor ? `color:${navColor}` : ''}">${esc(lt)}</div>` } };
    return null;
  })();
  if (logoWidget) elements.push(logoWidget);
  if (proMode && slug) {
    // dropdown:'tablet' → Pro's own nav-menu collapses to the burger at <=1024px (the source collapses by 768; the
    // tablet breakpoint covers it). toggle:'burger' keeps the hamburger icon.
    elements.push({ elType: 'widget', widgetType: 'nav-menu', settings: { menu: slug, menu_name: slug, layout: 'horizontal', align_items: 'end', pointer: 'underline', dropdown: 'tablet', toggle: 'burger', menu_typography_typography: 'custom', menu_typography_font_size: { unit: 'px', size: navSize }, color_menu_item: navColor, color_menu_item_hover: navColor } });
    if (nav.cta) { const t = stripEmoji(nav.cta.text); const cc = textColor(nav.cta) || '#ffffff'; elements.push({ elType: 'widget', widgetType: 'text-editor', settings: { editor: `<a href="${esc(nav.cta.href || '#')}" style="display:inline-block;padding:8px 18px;border-radius:6px;background:${cc === '#ffffff' ? '#111' : 'transparent'};color:${cc};text-decoration:none;font-weight:600;font-size:${navSize}px;white-space:nowrap">${esc(t)}</a>` } }); }
    // DEFENSIVE HAMBURGER (mirrors Path C's @media checkbox-hamburger): even if the dropdown:'tablet' control is
    // ignored on this stack, force the Pro nav-menu's desktop list hidden and its burger toggle shown at <=1024px so
    // the desktop menu collapses to a burger at narrow widths like the source. Scoped to #clone-header (no leak).
    const proHamburgerCss = ['@media(max-width:1024px){',
      '#clone-header .elementor-nav-menu--main .elementor-nav-menu:not(.elementor-nav-menu--dropdown){display:none!important}',
      '#clone-header .elementor-menu-toggle{display:flex!important;align-items:center}',
      '}'].join('');
    console.log(`nav EMIT (Pro): full-width flex row → logo${logoWidget ? '✓' : '✗'} + nav-menu(slug=${slug}, dropdown=tablet burger) + CTA${nav.cta ? '✓' : '✗'} + <=1024 hamburger CSS`);
    return { container: container(headerSettings, elements), fallbackCss: proHamburgerCss };
  }
  // PATH C — per-link text-editor widgets in a flex sub-row + native CTA + checkbox-hack hamburger.
  const linkChildren = nav.items.map((it) => ({ elType: 'widget', widgetType: 'text-editor', settings: { editor: `<a href="${esc(it.url || '#')}" style="display:inline-block;margin:0 14px;text-decoration:none;font-size:${navSize}px;${it.color ? `color:${it.color}` : (navColor ? `color:${navColor}` : '')};white-space:nowrap">${esc(it.title)}</a>`, _flex_grow: '0' } }));
  const linksContainer = container({ flex_direction: 'row', flex_align_items: 'center', flex_justify_content: 'flex-end', flex_wrap: 'wrap', _flex_grow: '0', _element_id: 'clone-navlinks' }, linkChildren);
  const burgerWidget = { elType: 'widget', widgetType: 'html', settings: { _element_id: 'clone-burger-wrap', html: `<input type="checkbox" id="burger" style="display:none"><label for="burger" style="display:none;cursor:pointer;font-size:26px;line-height:1;${navColor ? `color:${navColor}` : ''}">&#9776;</label>` } };
  elements.push(burgerWidget, linksContainer);
  if (nav.cta) { const t = stripEmoji(nav.cta.text); const cc = textColor(nav.cta) || navColor; elements.push({ elType: 'widget', widgetType: 'text-editor', settings: { editor: `<a href="${esc(nav.cta.href || '#')}" style="display:inline-block;padding:8px 18px;border-radius:6px;border:1px solid currentColor;color:${cc};text-decoration:none;font-weight:600;font-size:${navSize}px;white-space:nowrap">${esc(t)}</a>`, _flex_grow: '0' } }); }
  const fallbackCss = ['#clone-burger-wrap label{display:none}', '@media(max-width:1024px){', '#clone-burger-wrap label{display:inline-block!important}', '#clone-navlinks{display:none!important;position:absolute;top:100%;left:0;right:0;flex-direction:column!important;align-items:flex-start!important;padding:12px 24px}', '#burger:checked ~ #clone-navlinks,#clone-burger-wrap:has(#burger:checked) ~ #clone-navlinks{display:flex!important}', '}'].join('');
  console.log(`nav EMIT (fallback Path C): full-width flex row → logo${logoWidget ? '✓' : '✗'} + ${linkChildren.length} per-link widget(s) + burger + CTA${nav.cta ? '✓' : '✗'}`);
  return { container: container(headerSettings, elements), fallbackCss };
}
async function detectPro(basicAuthHeaders) {
  try { const r = await fetch(`${base}/wp-json`, { headers: basicAuthHeaders }); const j = await r.json(); const ns = (j && j.namespaces) || []; const blob = JSON.stringify(j || {}).toLowerCase(); const pro = ns.some((n) => /elementor-pro|pro\/v1/.test(n)) || /elementor-pro|elementor_pro/.test(blob); console.log(`Pro gate: ${pro ? 'Pro DETECTED → nav-menu widget' : 'no Pro → Path C fallback'}`); return pro; }
  catch (e) { console.log('Pro gate probe failed → default Pro', String(e).slice(0, 80)); return true; }
}

// ===========================================================================
// FOOTER → full-width container; footer members clustered into columns (same machinery).
// ===========================================================================
function buildFooter(footSeg) {
  if (!footSeg || !footSeg.members || !footSeg.members.length) return null;
  const fb = footSeg.bbox || { x: 0, y: pageH - 200, w: VW, h: 200 };
  // FIX 1 — footer uses the same Y-ROW → X-COLUMN machinery so a single footer link row becomes a horizontal row.
  const rows = clusterRows(footSeg.members);
  const innerEls = [];
  for (const r of rows) { const built = rowContainer(r, fb.w || VW, false); if (built.rowEl) innerEls.push(built.rowEl); else if (built.widgets && built.widgets.length) innerEls.push(...built.widgets); }
  if (!innerEls.length) return null;
  const innerSettings = { content_width: 'boxed', flex_direction: 'column', flex_gap: { unit: 'px', size: 16, column: '16', row: '16' }, width: { unit: '%', size: 100 }, padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } };
  const inner = container(innerSettings, innerEls);
  const footerSettings = {
    content_width: 'full', flex_direction: 'column', flex_align_items: 'center', width: { unit: '%', size: 100 },
    min_height: { unit: 'px', size: Math.max(40, round(fb.h)) }, min_height_tablet: { unit: 'px', size: 0 }, min_height_mobile: { unit: 'px', size: 0 },
    padding: { unit: 'px', top: '40', right: '20', bottom: '40', left: '20', isLinked: false },
    _element_id: 'clone-footer',
    ...(NO_HYGIENE ? {} : { _title: 'Footer' }),
    ...bandBgSettings(footSeg.bg || { kind: 'default' }),
  };
  if (!NO_HYGIENE) STATS.sectionsNamed++;
  return container(footerSettings, [inner]);
}

// ===========================================================================
// STRUCTURAL VALIDATION (used by --selftest + as a build-time invariant). The hard requirement: the emitted tree
// uses FLEX CONTAINERS with %-columns and contains NO position:absolute and NO fixed-px widths.
// ===========================================================================
function validateTree(root) {
  const blob = JSON.stringify(root);
  const fails = [];
  // 1) no absolute positioning anywhere (the whole point — flex reflow, not pins)
  if (/"_position"\s*:\s*"absolute"/.test(blob)) fails.push('found _position:absolute');
  if (/position\s*:\s*absolute/i.test(blob)) fails.push('found inline position:absolute');
  if (/position\s*:\s*fixed/i.test(blob)) fails.push('found inline position:fixed');
  if (/elementor-absolute/.test(blob)) fails.push('found elementor-absolute class');
  // 2) no fixed-px width pins on widgets (no _element_custom_width; no _offset_x/_offset_y)
  if (/"_element_custom_width"/.test(blob)) fails.push('found _element_custom_width (fixed px width pin)');
  if (/"_offset_x"|"_offset_y"/.test(blob)) fails.push('found _offset_x/_offset_y (absolute offset)');
  // 3) presence checks — at least one elType:container with a flex layout + at least one %-width column
  const containerCount = (blob.match(/"elType"\s*:\s*"container"/g) || []).length;
  if (containerCount < 1) fails.push('no elType:container emitted');
  const hasFlex = /"flex_direction"\s*:\s*"(row|column)"/.test(blob);
  if (!hasFlex) fails.push('no flex_direction on any container');
  const hasPctWidth = /"width"\s*:\s*\{\s*"unit"\s*:\s*"%"/.test(blob);
  if (!hasPctWidth) fails.push('no percent-width container (columns not %-based)');
  // 4) guard against an inline fixed-px WIDTH on a widget wrapper (images use max-width + width:100%, which is OK;
  //    a bare `width:<N>px` with NO max-width companion on a block element would risk overflow). We allow
  //    `max-width:<N>px` and `width:100%`; flag a `width:<N>px` that is NOT immediately a max-width.
  // IMGCAP: a `width:<N>px` is SAFE when immediately paired with a `max-width:100%` companion — it cannot overflow
  // the container (max-width:100% caps it), and that is exactly how images now carry their captured width. Flag only a
  // BARE fixed-px width with NO max-width companion (the real overflow risk). The negative lookahead keeps the no-h-scroll
  // protection fully intact for everything except the provably-safe `width:Npx;max-width:100%` image pattern.
  const badWidthPx = [...blob.matchAll(/[^-]width:(\d+)px(?!;max-width)/g)].map((m) => m[0]);
  // (images deliberately carry max-width:<px>; the regex above already excludes "max-width" via the [^-] guard —
  //  it only matches a leading non-dash before "width", so "max-width" won't match. Any hit is a real bare width.)
  if (badWidthPx.length) fails.push(`found ${badWidthPx.length} bare fixed-px width(s) e.g. "${badWidthPx[0]}"`);
  return { ok: fails.length === 0, fails, containerCount, hasFlex, hasPctWidth };
}

// ===========================================================================
// MAIN — assemble the structured tree, optionally write it.
// ===========================================================================
async function main() {
  // (1) segment the capture (or load a precomputed --seg).
  let seg;
  if (segPath && fs.existsSync(segPath)) { seg = JSON.parse(fs.readFileSync(segPath, 'utf8')); console.log(`seg: loaded ${segPath} — ${seg.sections.length} section(s)`); }
  else { seg = segment(L); console.log(`seg: ran segment.mjs on capture — ${seg.sections.length} section(s), nav=${!!seg.nav}, footer=${!!seg.footer}`); }

  // (2) upload images referenced by leaves (skip on selftest — no network in --selftest). Collect from full leaves
  // + segment band image backgrounds so the section/footer bg + member images resolve to WP-hosted URLs.
  if (!SELFTEST && !DRY) {
    const srcs = new Set();
    for (const lf of FULL_LEAVES) { if (lf.kind === 'image' && lf.src) srcs.add(lf.src); else if ((lf.kind === 'svg' || lf.kind === 'mockup') && lf.raster && lf.raster !== 'SKIP') srcs.add(lf.raster); }
    const collectBg = (n) => { if (!n) return; if (n.kind === 'container') { if (n.background && n.background.image) srcs.add(n.background.image); (n.children || []).forEach(collectBg); } }; collectBg(L.root);
    const fresh = [...srcs].filter((u) => u && !u.startsWith('data:') && !(imgMap[u] && imgMap[u].full));
    console.log(`images: ${srcs.size} total, ${fresh.length} to upload…`);
    for (const u of fresh) { await uploadImage(u); await sleep(200); }
    try { fs.writeFileSync(IMG_CACHE, JSON.stringify(imgMap, null, 2)); } catch {}
  }

  // (3) GLOBAL-TOKEN pre-pass — cluster captured colors/typography into Kit tokens BEFORE tree build.
  if (!NO_GLOBALS) {
    assignGlobals(L.root); finalizeGlobalTokens();
    console.log(`globals: ${gColorTokens.length} color + ${gTypoTokens.length} typography token(s)`);
  } else console.log('globals: OFF (inline-only)');

  // (4) build the structural tree: [nav?, sections…, footer?] as flex containers.
  const navInfo = seg.nav ? analyzeNav(seg.nav) : null;
  const sectionContainers = [];
  for (let i = 0; i < seg.sections.length; i++) { const c = buildSection(seg.sections[i], i); if (c) sectionContainers.push(c); }
  const footerContainer = buildFooter(seg.footer);
  console.log(`structured tree: ${sectionContainers.length} section container(s)${navInfo ? ' + nav' : ''}${footerContainer ? ' + footer' : ''}`);

  // ROOT — full-width flex column carrying the whole page. Background floor = the captured canvas color so the
  // page matches the source canvas (kses-safe; behind all content). NO min_height pin in px on widgets → reflow.
  const rootBgFloor = (PAGE_DEFAULT && deltaE(PAGE_DEFAULT, 'rgb(255, 255, 255)') > 3) ? { background_background: 'classic', background_color: PAGE_DEFAULT } : {};
  const rootEls = [...sectionContainers]; if (footerContainer) rootEls.push(footerContainer);
  const root = container({ content_width: 'full', flex_direction: 'column', width: { unit: '%', size: 100 }, padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true }, ...rootBgFloor }, rootEls);

  // FIX 3 — HYGIENE: unwrap redundant single-child container wrappers. We recurse into each TOP-LEVEL element (never
  // collapse the page root itself — it carries the bg floor + is the document root) so the empty "div in a div" nesting
  // the row/column machinery leaves behind is lifted out. Container→container only; no leaf widget is ever promoted.
  root.elements = root.elements.map(unwrapRedundant);
  // count globals-reliance over the FULL leaves (flags set once per node during emit; never double-counted).
  for (const lf of FULL_LEAVES) { if (lf._reliesGlobalColor) STATS.textRelyGlobal++; if (lf._fontStripped) STATS.fontStripped++; }
  console.log(`globals-effective: ${STATS.textRelyGlobal} text widget(s) rely on a color global (inline literal stripped), ${STATS.fontStripped} font(s) bound to a typo global; hygiene: ${STATS.wrappersUnwrapped} wrapper(s) unwrapped, ${STATS.sectionsNamed} section(s) named`);

  // (5) DRY / SELFTEST — validate the emitted tree (the load-bearing structural assertions) and dump.
  const v = validateTree(root);
  if (DRY || SELFTEST) {
    const dumpPath = arg('dump') || (SELFTEST ? null : '/tmp/struct-tree.json');
    if (dumpPath) { try { fs.writeFileSync(dumpPath, JSON.stringify(root)); console.log(`tree dump → ${dumpPath}`); } catch {} }
    console.log(`VALIDATE containers=${v.containerCount} flex=${v.hasFlex} pctWidth=${v.hasPctWidth}`);
    if (!v.ok) { console.log('FAIL: ' + v.fails.join('; ')); process.exit(1); }
    // count %-columns + confirm absence of abs/fixed-px
    const blob = JSON.stringify(root);
    const pctCols = (blob.match(/"_flex_basis"\s*:\s*\{\s*"unit"\s*:\s*"%"/g) || []).length;
    const widgetCount = (blob.match(/"elType"\s*:\s*"widget"/g) || []).length;
    const tableTags = (blob.match(/<table/g) || []).length;
    console.log(`OK: flex-container tree — ${v.containerCount} containers, ${pctCols} %-flex-basis column(s), ${widgetCount} widget(s), ${TABLESTATS.tables} native table(s) (${tableTags} <table tag(s)); globals-effective: ${STATS.textRelyGlobal} text rely-on-global (inline stripped) + ${STATS.fontStripped} font(s) bound, ${STATS.wrappersUnwrapped} wrapper(s) unwrapped, ${STATS.sectionsNamed} section(s) named; NO position:absolute, NO elementor-absolute, NO _element_custom_width/_offset, NO bare fixed-px width`);
    return;
  }
  if (!v.ok) { console.log('FAIL (refusing to publish a tree that violates the no-h-scroll invariant): ' + v.fails.join('; ')); process.exit(1); }

  if (!PUBLISH) { console.log('built structured tree (pass --publish to write). Use --dry to dump.'); return; }

  // (6) WRITE — kit globals → nav menu → page PUT → edit_mode/template meta (ported build-absolute.mjs:1382-1522).
  const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'structured-' + Date.now() };
  const basicHeaders = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json' };
  await writeKitGlobals(headers);

  let navFallbackCss = '';
  if (navInfo) {
    const proMode = await detectPro(basicHeaders);
    let slug = null;
    if (proMode) slug = await createNavMenu(navInfo.items, pageId, basicHeaders);
    const built = buildNavHeader(navInfo, !!(proMode && slug), slug);
    root.elements.unshift(built.container);
    navFallbackCss = built.fallbackCss || '';
  }

  // @font-face for registered real source fonts + the Path C nav CSS via page custom_css.
  const fontCss = [...usedFonts].flatMap((fam) => (REGFONTS[fam] || []).map((f) => `@font-face{font-family:'${fam}';font-weight:${f.weight};font-style:${f.style || 'normal'};font-display:swap;src:url('${f.url}') format('woff2')}`)).join('\n');
  // defensive no-h-scroll guard (the flex tree already reflows; this is belt-and-suspenders for any inner-HTML px).
  const noScrollCss = 'html,body{max-width:100vw;overflow-x:hidden}.e-con .elementor-widget-html img{max-width:100%;height:auto}';
  // RAM-GRID scoped rules — each #ramgrid-N{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(Wpx,100%),1fr))}
  // so a qualifying grid/card row reflows 3→2→1 by width with NO media query (belt-and-suspenders for the native
  // container_type:'grid' channel; kses-safe — no position, no bare fixed-px width, every track capped to 100%).
  const ramGridCss = RAMCSS.join('\n');
  if (RAMSTATS.gridRows) console.log(`RAM-grid: ${RAMSTATS.gridRows} multi-column grid/card row(s) emitted as auto-fit CSS grid (3→2→1 reflow, no media query)`);
  const customCss = [fontCss, noScrollCss, ramGridCss, navFallbackCss].filter(Boolean).join('\n');
  const pageSettings = customCss ? { custom_css: customCss } : {};
  if (fontCss) console.log(`injecting ${usedFonts.size} real font(s) via custom_css: ${[...usedFonts].join(', ')}`);

  if (process.env.STRUCT_DUMP_TREE) { try { fs.writeFileSync(process.env.STRUCT_DUMP_TREE, JSON.stringify(root)); console.log(`STRUCT_DUMP_TREE → ${process.env.STRUCT_DUMP_TREE}`); } catch {} }

  let r, txt, expected = (await (await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { headers })).json()).elementor?.hash;
  for (let a = 0; a < 5; a++) { const body = { expected_hash: expected, elements: [root], page_settings: pageSettings, title: 'Structured reflow clone', intent: 'structured flex-container reflow' }; r = await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { method: 'PUT', headers, body: JSON.stringify(body) }); txt = await r.text(); if (r.status !== 409) break; try { expected = JSON.parse(txt).details.current_hash; } catch {} await sleep(400); }
  console.log('PUT', r.status, txt.slice(0, 90));

  // edit_mode=builder + elementor_canvas template (else frontend serves the post_content fallback, not the tree).
  const metaHeaders = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json' };
  try {
    const mr = await fetch(`${base}/wp-json/wp/v2/pages/${pageId}`, { method: 'POST', headers: metaHeaders, body: JSON.stringify({ status: 'publish', template: 'elementor_canvas', meta: { _elementor_edit_mode: 'builder', _wp_page_template: 'elementor_canvas' } }) });
    console.log('set edit_mode=builder + template=elementor_canvas', mr.status);
    if (mr.status === 400) {
      try { await fetch(`${base}/wp-json/wp/v2/pages/${pageId}`, { method: 'POST', headers: metaHeaders, body: JSON.stringify({ meta: { _elementor_edit_mode: 'builder', _wp_page_template: 'elementor_canvas' } }) }); } catch {}
      for (const tmpl of ['elementor_canvas', 'elementor_header_footer']) { const tr = await fetch(`${base}/wp-json/wp/v2/pages/${pageId}`, { method: 'POST', headers: metaHeaders, body: JSON.stringify({ template: tmpl }) }); if (tr.ok) { console.log(`set template=${tmpl}`); break; } }
    }
  } catch {}
  console.log('PAGE:', `${base}/?page_id=${pageId}`);
}

main().catch((e) => { console.error('FAIL:', String(e && e.stack || e)); process.exit(1); });
