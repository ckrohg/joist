#!/usr/bin/env node
/**
 * @purpose THE SECTION-SPEC LAYER — the missing semantic contract between segment.mjs (pure GEOMETRY: which leaf
 * belongs to which band) and build-structured.mjs (Elementor flex-container emission). Human cloners and every
 * clone tutorial work the same way: (1) identify the GLOBAL elements first (fonts, color palette, type scale),
 * then (2) go SECTION BY SECTION with a per-section SPEC — "this is a hero: eyebrow + H1 + subhead + 2 CTAs,
 * centered stack; this is a 3-up feature grid; this is the pricing table." Joist had the spine (globals recipe
 * #37, segment bands, per-section build) but went geometry→build DIRECTLY with no explicit, inspectable,
 * validatable plan in between. This module produces that plan.
 *
 * A SECTION-SPEC is the semantic interpretation of a segment band:
 *   { idx, role, layoutArchetype, confidence, columns, bbox, bg,
 *     blocks: [ { type, text?, href?, level?, box, style:{color,font,size,weight}, role? } ],
 *     contentSlots: { eyebrow?, heading?, subhead?, body[], buttons[], media[], items[] },
 *     styleRefs:   { colors:[…], fonts:[…] }   ← the raw values build-structured binds to Kit globals (#37),
 *     responsive:  { tablet, mobile }          ← the reflow PLAN for this archetype,
 *     motion:      { hover, reveal, effects[] } ← captured cfx/interactive (interaction-fidelity at PLAN level) }
 *
 *   role           — hero | logos | features | pricing | faq | stats | testimonial | cta | gallery | content | list
 *   layoutArchetype— centered-stack | stack | split-2col | grid-Ncol | logo-strip | table | banner
 *   The SPEC IS THE PLAN: it maps 1:1 onto Joist's create_plan/approve_plan/execute_plan MCP tools — buildSpec()
 *   is create_plan, a human (or grader) reading the spec is approve_plan, build-structured consuming it is
 *   execute_plan. It also unlocks PER-SECTION grading + refine (grade each section against its spec, fix only the
 *   ones that miss) instead of one opaque whole-page number.
 *
 * This module is PURE + side-effect-free + standalone (no network, no Elementor). It reads a capture-layout.mjs
 * tree + segment.mjs bands and returns the spec. build-structured.mjs imports buildSpec() and consumes it behind
 * the JOIST_SECTIONSPEC flag (default OFF ⇒ build is byte-identical; the spec only changes output when opted in).
 *
 * CLI: node section-spec.mjs --layout <capture.json> [--seg <seg.json>] [--pretty] [--out <spec.json>]
 *      node section-spec.mjs --layout <capture.json> --summary     (one line per section: role/archetype/conf)
 *      node section-spec.mjs --selftest                            (runs on /tmp/glob-supa.json; asserts oracle)
 */
import fs from 'fs';
import { segment } from './segment.mjs';

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const round = (n) => Math.round(n || 0);
const num = (v) => { const m = String(v == null ? '' : v).match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; };
const stripEmoji = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '').replace(/\s+/g, ' ').trim();
const opaque = (c) => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent' && !/,\s*0\)\s*$/.test(c);

// ── member resolution — mirror build-structured.mjs's RE-JOIN: segment emits THIN refs {kind,box,text,tag,href};
// the FULL capture leaf carries typo/paint/level/cfx/interactive/src/items we need to classify. Index full leaves
// by a rounded box key and resolve each thin member back to its full leaf by exact (rounded) geometry. ──
function gatherLeaves(root) { const out = []; const g = (n) => { if (!n) return; if (n.kind === 'container') (n.children || []).forEach(g); else if (n.box) out.push(n); }; g(root); return out; }
const boxKey = (b) => `${round(b.x)},${round(b.y)},${round(b.w)},${round(b.h)}`;
function buildIndex(L) { const idx = new Map(); for (const lf of gatherLeaves(L.root)) idx.set(boxKey(lf.box), lf); return idx; }
function resolver(L) { const idx = buildIndex(L); return (m) => (m && m.box && idx.get(boxKey(m.box))) || m; }

// captured <table> nodes (a pricing/comparison matrix region) — used for role=pricing + archetype=table.
function gatherTables(root) { const out = []; const g = (n) => { if (!n || typeof n !== 'object') return; if (n.tag === 'table') { out.push(n); return; } (n.children || []).forEach(g); }; g(root); return out; }
function sectionHasTable(tables, bbox) {
  if (!tables.length || !bbox) return false;
  for (const t of tables) { const tb = t.box; if (!tb) continue;
    const ov = Math.max(0, Math.min(bbox.y + bbox.h, tb.y + tb.h) - Math.max(bbox.y, tb.y));
    if (ov / Math.max(1, bbox.h) >= 0.5) return true; }
  return false;
}

// ── BLOCK CLASSIFICATION — interpret one resolved leaf as a semantic block. ──
const CTA_RX = /\b(get started|start (your |building|free)|sign ?up|try (it )?free|book a|request a|contact (us|sales)|join|subscribe|learn more|see (docs|pricing|more)|create( an)? account|start your project|deploy|download|buy|upgrade|talk to)\b/i;
const PRIMARY_CTA_RX = /\b(start your project|get started|sign ?up|create( an)? account|start free|try free|get a demo|start building)\b/i;
function isNumericStat(t) { const s = stripEmoji(t); return s.length <= 12 && /^[~<>+]?\$?\d[\d.,]*\s?(%|x|k|m|b|\+|m\+|k\+|ms|s|gb|tb|hrs?|min)?\+?$/i.test(s.replace(/\s+/g, '')); }
function classifyBlock(full, ctx) {
  const kind = full.kind;
  const tag = (full.tag || '').toLowerCase();
  const text = stripEmoji(full.text || '');
  const typo = full.typo || {};
  const size = num(typo.size);
  const weight = num(typo.weight) || 400;
  const transform = (typo.transform || '').toLowerCase();
  const style = { color: (full.paint && full.paint.value) || null, font: typo.family || null, size: size || null, weight };
  const base = { box: { x: round(full.box.x), y: round(full.box.y), w: round(full.box.w), h: round(full.box.h) }, style };
  if (full.href) base.href = full.href;

  // media first (no text classification needed)
  if (kind === 'video' || kind === 'mockup') return { type: 'media', mediaKind: kind, src: full.src || null, ...base };
  if (kind === 'svg') return { type: (full.box.w <= 56 && full.box.h <= 56) ? 'icon' : 'media', mediaKind: 'svg', ...base };
  if (kind === 'image') {
    const small = full.box.h <= 64 && full.box.w <= 240;             // logo-sized
    return { type: small ? 'logo' : 'image', src: full.src || null, alt: full.alt || null, ...base };
  }
  if (kind === 'list') return { type: 'list', items: full.items || [], ...base };

  // buttons / links-styled-as-button
  if (kind === 'button' || (tag === 'a' && CTA_RX.test(text)) || (full.bg && opaque(full.bg) && text && text.length < 32 && full.href)) {
    return { type: 'button', text, role: PRIMARY_CTA_RX.test(text) ? 'primary' : 'secondary', ...base };
  }

  // headings
  const lvl = full.level || (/^h([1-6])$/.test(tag) ? +tag[1] : null);
  if (kind === 'heading' || lvl) {
    // infer a display level from font size when the tag lies (supabase uses h2 at 16px for body-ish labels)
    let level = lvl || (size >= 40 ? 1 : size >= 28 ? 2 : size >= 20 ? 3 : 4);
    return { type: 'heading', text, level, ...base };
  }

  // eyebrow — short, ALL-CAPS / uppercase-transform label (CUSTOMER STORIES) sitting above a heading
  if (text && text.length <= 40 && (transform === 'uppercase' || (text === text.toUpperCase() && /[A-Z]/.test(text) && !/[a-z]/.test(text))) && weight >= 500) {
    return { type: 'eyebrow', text, ...base };
  }
  // stat — a big standalone number/metric
  if (text && isNumericStat(text) && size >= 24) return { type: 'stat', text, ...base };
  // quote — a tweet/@handle or quotation
  if (text && (/^["“”']/.test(text) || /(^|\s)@\w{2,}/.test(text))) return { type: 'quote', text, ...base };
  // subhead — larger-than-body text directly under the heading
  if (text && size >= 18) return { type: 'subhead', text, ...base };
  // default body
  if (text) return { type: 'body', text, ...base };
  return { type: 'other', ...base };
}

// ── COLUMN DETECTION — cluster a section's blocks into Y-ROWS, then X-COLUMNS within each row; the archetype
// column-count is the MAX columns found in any single row (a full-width section title above a 3-card grid must
// still read as a 3-column grid). Returns { cols, comparable } where comparable ⇒ the multi-col row's cells are
// within ~30% width of each other (a real grid, not a hero|sidebar split). ──
function clusterRows(blocks, yGap) {
  const sorted = [...blocks].filter((b) => b.box && b.box.h > 0).sort((a, b) => a.box.y - b.box.y);
  const rows = []; let cur = null;
  for (const b of sorted) {
    if (!cur || b.box.y > cur.y1 + yGap) { cur = { y0: b.box.y, y1: b.box.y + b.box.h, items: [b] }; rows.push(cur); }
    else { cur.items.push(b); cur.y1 = Math.max(cur.y1, b.box.y + b.box.h); }
  }
  return rows;
}
function xColumns(items, xGap) {
  const sorted = [...items].sort((a, b) => a.box.x - b.box.x);
  const cols = []; let cur = null;
  for (const b of sorted) {
    if (!cur || b.box.x > cur.x1 + xGap) { cur = { x0: b.box.x, x1: b.box.x + b.box.w, items: [b] }; cols.push(cur); }
    else { cur.items.push(b); cur.x1 = Math.max(cur.x1, b.box.x + b.box.w); }
  }
  return cols;
}
function detectColumns(blocks, sectionW) {
  const rows = clusterRows(blocks, 36);
  let best = { n: 1, comparable: false, widths: [] };
  for (const r of rows) {
    if (r.items.length < 2) continue;
    const cols = xColumns(r.items, 28);
    if (cols.length < 2) continue;
    const widths = cols.map((c) => Math.max(1, c.x1 - c.x0));
    const mn = Math.min(...widths), mx = Math.max(...widths);
    const comparable = mx <= mn * 1.3;
    if (cols.length > best.n || (cols.length === best.n && comparable && !best.comparable)) best = { n: cols.length, comparable, widths };
  }
  return best;
}

// ── ROLE CLASSIFICATION — interpret the section. Ordered, highest-confidence signal first. ──
function classifyRole(seg, sec, blocks, cols, hasTable, ctx) {
  const heads = blocks.filter((b) => b.type === 'heading');
  const buttons = blocks.filter((b) => b.type === 'button');
  const imgs = blocks.filter((b) => b.type === 'image' || b.type === 'logo');
  const logos = blocks.filter((b) => b.type === 'logo');
  const stats = blocks.filter((b) => b.type === 'stat');
  const quotes = blocks.filter((b) => b.type === 'quote');
  const textLen = blocks.filter((b) => /heading|body|subhead|eyebrow|quote/.test(b.type)).reduce((a, b) => a + (b.text || '').length, 0);
  const blob = blocks.map((b) => (b.text || '').toLowerCase()).join(' ');
  const h = sec.y1 - sec.y0;
  const isFirst = sec.idx === 0;
  const isLast = sec.idx === ((seg.sections || []).length - 1);
  const bigHeading = heads.some((x) => (x.level || 4) <= 1 || num(x.style.size) >= 32);

  let role = 'content', confidence = 0.4;
  // segment already flagged a uniform repeated list
  const segRepeated = sec.role === 'repeated-list';

  if (hasTable || (/\b(per month|\/mo|\/month|month|billed)\b/.test(blob) && /\b(plan|tier|pricing|pro\b|enterprise|starter|free\b|team\b)\b/.test(blob))) { role = 'pricing'; confidence = 0.8; }
  else if (/\b(frequently asked|faq|common questions|have questions)\b/.test(blob)) { role = 'faq'; confidence = 0.75; }
  else if (isFirst && (bigHeading || buttons.length) && sec.y0 < 760) { role = 'hero'; confidence = 0.85; }
  else if (logos.length >= 4 && h < 280 && textLen < 90) { role = 'logos'; confidence = 0.85; }
  else if (imgs.length >= 6 && h < 280 && textLen < 120) { role = 'logos'; confidence = 0.65; }
  else if ((quotes.length >= 1 && imgs.length >= 1) || /\b(testimonial|loved by|customers say|what (our )?(users|customers|developers) (say|are saying)|trusted by the world)\b/.test(blob) || (segRepeated && imgs.length >= 3 && textLen > 200)) { role = 'testimonial'; confidence = 0.7; }
  else if (stats.length >= 2) { role = 'stats'; confidence = 0.7; }
  else if ((cols.n >= 3 && cols.comparable) || (heads.length >= 3 && (imgs.length + blocks.filter((b) => b.type === 'icon').length) >= 2)) { role = 'features'; confidence = 0.7; }
  else if (!isFirst && heads.length >= 1 && buttons.length >= 1 && ((h < 480 && blocks.length <= 8) || (isLast && blocks.length <= 12))) { role = 'cta'; confidence = isLast ? 0.78 : 0.7; }
  else if (imgs.filter((b) => b.type === 'image').length >= 4 && textLen < 200) { role = 'gallery'; confidence = 0.55; }
  else if (segRepeated) { role = 'list'; confidence = 0.6; }
  else if (cols.n >= 2 && cols.comparable) { role = 'features'; confidence = 0.5; }
  return { role, confidence };
}

// ── LAYOUT ARCHETYPE — how the section is laid out (drives the deterministic builder choice). ──
function classifyArchetype(role, blocks, cols, hasTable, sectionW) {
  if (hasTable) return 'table';
  if (role === 'logos') return 'logo-strip';
  const media = blocks.filter((b) => b.type === 'image' || b.type === 'media');
  if (cols.n >= 3 && cols.comparable) return `grid-${Math.min(cols.n, 6)}col`;
  if (cols.n === 2) {
    // 2 columns where one side is media ⇒ a split; else a 2-up grid
    return media.length >= 1 ? 'split-2col' : 'grid-2col';
  }
  // single column: centered (hero/cta) vs left-aligned stack
  const centered = blocks.filter((b) => b.style && b.box).filter((b) => { const cx = b.box.x + b.box.w / 2; return Math.abs(cx - sectionW / 2) < sectionW * 0.12; }).length;
  const total = blocks.filter((b) => b.text || b.type === 'button').length || 1;
  if (role === 'hero' || role === 'cta' || centered / total > 0.6) return 'centered-stack';
  if (blocks.length <= 2) return 'banner';
  return 'stack';
}

// ── RESPONSIVE PLAN — the reflow each archetype should perform (build-structured already implements RAM-grid #35;
// the spec makes the intent EXPLICIT + per-section, so a grader/refine can check it and a future builder honors it). ──
function responsivePlan(archetype) {
  if (/^grid-/.test(archetype)) return { tablet: 'grid-2', mobile: 'stack' };
  if (archetype === 'split-2col') return { tablet: 'stack', mobile: 'stack' };
  if (archetype === 'logo-strip') return { tablet: 'wrap', mobile: 'wrap' };
  if (archetype === 'table') return { tablet: 'scroll', mobile: 'scroll' };
  return { tablet: 'keep', mobile: 'keep' };
}

// ── MOTION — interaction-fidelity at the PLAN level. Pull captured cfx (scroll/animation fx) + interactive (hover)
// off the full leaves so the spec RECORDS what the section does, even before the builder can emit it 1:1. ──
function extractMotion(fullMembers) {
  let hover = false, reveal = false; const effects = new Set();
  for (const f of fullMembers) {
    if (f.interactive && (f.interactive.hover || f.interactive.expand || f.interactive.transition)) hover = true;
    const cfx = f.cfx;
    if (cfx && typeof cfx === 'object') {
      if (cfx.reveal || cfx.aos || cfx.inView || cfx.scroll) reveal = true;
      for (const k of Object.keys(cfx)) if (cfx[k]) effects.add(k);
    }
  }
  return { hover, reveal, effects: [...effects].slice(0, 8) };
}

// ── STYLE REFS — the raw color/font values this section's text uses; build-structured (#37) binds these to Kit
// global tokens. Recording them per-section lets the spec carry "this section uses brand-ink + Circular/600". ──
function styleRefs(blocks) {
  const colors = new Map(), fonts = new Map();
  for (const b of blocks) { const s = b.style; if (!s) continue;
    if (s.color && opaque(s.color)) colors.set(s.color, (colors.get(s.color) || 0) + 1);
    if (s.font) fonts.set(`${s.font}/${s.weight || 400}/${s.size || ''}`, (fonts.get(`${s.font}/${s.weight || 400}/${s.size || ''}`) || 0) + 1);
  }
  const rank = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  return { colors: rank(colors).slice(0, 6), fonts: rank(fonts).slice(0, 6) };
}

// ── CONTENT SLOTS — the named slots a section/template fills (what a human types into a section template). ──
function contentSlots(blocks) {
  const slot = { body: [], buttons: [], media: [], items: [] };
  for (const b of blocks) {
    if (b.type === 'eyebrow' && !slot.eyebrow) slot.eyebrow = b.text;
    else if (b.type === 'heading' && !slot.heading) slot.heading = b.text;
    else if (b.type === 'subhead' && !slot.subhead) slot.subhead = b.text;
    else if (b.type === 'body' || b.type === 'quote') { if (b.text) slot.body.push(b.text); }
    else if (b.type === 'button') slot.buttons.push({ text: b.text, role: b.role, href: b.href || null });
    else if (b.type === 'image' || b.type === 'logo' || b.type === 'media' || b.type === 'icon') slot.media.push({ type: b.type, src: b.src || null });
    else if (b.type === 'list') slot.items.push(...(b.items || []));
  }
  return slot;
}

// ── GLOBAL elements — the FIRST thing a human extracts: fonts, type scale, palette. ──
function globalSpec(L, allBlocks) {
  const sizes = new Map(), colors = new Map();
  for (const b of allBlocks) { const s = b.style; if (!s) continue;
    if (s.size) sizes.set(s.size, (sizes.get(s.size) || 0) + 1);
    if (s.color && opaque(s.color)) colors.set(s.color, (colors.get(s.color) || 0) + 1); }
  const typeScale = [...sizes.keys()].sort((a, b) => b - a).slice(0, 8);
  const palette = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map((e) => e[0]);
  return { fonts: (L.fonts || []).slice(0, 8), typeScale, palette, pageBg: L.pageBg || null };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// buildSpec — the create_plan: SEGMENT bands → SECTION SPECS.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
function buildSpec(seg, L) {
  const resolve = resolver(L);
  const tables = gatherTables(L.root);
  const VW = seg.vw || L.vw || 1440;
  const ctx = { vw: VW };
  const allBlocks = [];

  const specSection = (sec) => {
    const sb = sec.bbox || { x: 0, y: sec.y0, w: VW, h: (sec.y1 || 0) - (sec.y0 || 0) };
    const sectionW = sb.w || VW;
    const fulls = (sec.members || []).map(resolve).filter((f) => f && f.box);
    const blocks = fulls.map((f) => classifyBlock(f, ctx)).filter((b) => b);
    allBlocks.push(...blocks);
    const cols = detectColumns(blocks, sectionW);
    const hasTable = sectionHasTable(tables, sb);
    const { role, confidence } = classifyRole(seg, sec, blocks, cols, hasTable, ctx);
    const archetype = classifyArchetype(role, blocks, cols, hasTable, sectionW);
    return {
      idx: sec.idx, role, layoutArchetype: archetype, confidence: round(confidence * 100) / 100,
      columns: cols.n, segRole: sec.role,
      bbox: { x: round(sb.x), y: round(sb.y), w: round(sb.w), h: round(sb.h) }, bg: sec.bg,
      blocks, contentSlots: contentSlots(blocks), styleRefs: styleRefs(blocks),
      responsive: responsivePlan(archetype), motion: extractMotion(fulls),
    };
  };

  const sections = (seg.sections || []).map(specSection);

  // NAV spec
  let nav = null;
  if (seg.nav) {
    const fulls = (seg.nav.members || []).map(resolve).filter((f) => f && f.box);
    const blocks = fulls.map((f) => classifyBlock(f, ctx));
    const links = blocks.filter((b) => b.type === 'button' || (b.type === 'body' && b.box.h < 40)).map((b) => b.text).filter(Boolean);
    nav = { role: 'nav', present: true, itemCount: links.length, hasLogo: blocks.some((b) => b.type === 'logo' || b.type === 'image'),
      hasCta: blocks.some((b) => b.type === 'button' && b.role === 'primary'), links: links.slice(0, 12), motion: extractMotion(fulls) };
  }
  // FOOTER spec
  let footer = null;
  if (seg.footer) {
    const sb = seg.footer.bbox;
    const fulls = (seg.footer.members || []).map(resolve).filter((f) => f && f.box);
    const blocks = fulls.map((f) => classifyBlock(f, ctx));
    allBlocks.push(...blocks);
    const cols = detectColumns(blocks, sb ? sb.w : VW);
    footer = { role: 'footer', present: true, columns: cols.n, bbox: sb,
      blocks, contentSlots: contentSlots(blocks), styleRefs: styleRefs(blocks) };
  }

  return {
    source: L.url || null, vw: VW, pageH: seg.pageH || L.pageH || 0,
    global: globalSpec(L, allBlocks),
    nav, sections, footer,
    meta: { sectionCount: sections.length, generatedFrom: 'segment+capture', schema: 'section-spec/v1' },
  };
}

// ── VALIDATION — shape + completeness invariants (used by --selftest and as a reusable guard). ──
const ROLES = new Set(['hero', 'logos', 'features', 'pricing', 'faq', 'stats', 'testimonial', 'cta', 'gallery', 'content', 'list']);
function validateSpec(spec) {
  if (!spec || !Array.isArray(spec.sections)) return { ok: false, reason: 'no sections' };
  if (!spec.sections.length) return { ok: false, reason: 'empty sections' };
  for (const s of spec.sections) {
    if (!ROLES.has(s.role)) return { ok: false, reason: `bad role "${s.role}" @${s.idx}` };
    if (!s.layoutArchetype) return { ok: false, reason: `no archetype @${s.idx}` };
    if (typeof s.confidence !== 'number') return { ok: false, reason: `no confidence @${s.idx}` };
    if (!s.responsive || !s.responsive.mobile) return { ok: false, reason: `no responsive @${s.idx}` };
    if (!Array.isArray(s.blocks)) return { ok: false, reason: `no blocks @${s.idx}` };
  }
  if (!spec.global || !Array.isArray(spec.global.typeScale)) return { ok: false, reason: 'no global typeScale' };
  return { ok: true, sectionCount: spec.sections.length };
}

export { buildSpec, validateSpec, classifyBlock, classifyRole };

// ── CLI (only when run directly) ──
const isMain = (() => { try { return /(?:^|\/)section-spec\.mjs$/.test(process.argv[1] || ''); } catch { return false; } })();
if (isMain) {
  if (process.argv.includes('--selftest')) {
    const path = '/tmp/glob-supa.json';
    if (!fs.existsSync(path)) { console.log(`SELFTEST FAIL: missing ${path} (capture supabase first)`); process.exit(1); }
    let spec;
    try { const L = JSON.parse(fs.readFileSync(path, 'utf8')); spec = buildSpec(segment(L), L); }
    catch (e) { console.log('SELFTEST FAIL: ' + String((e && e.message) || e)); process.exit(1); }
    const v = validateSpec(spec);
    if (!v.ok) { console.log('SELFTEST FAIL (shape): ' + v.reason); process.exit(1); }
    // ORACLE — the known supabase truth: section 0 = hero, section 1 = logos, the last section = cta.
    const s = spec.sections;
    const fails = [];
    if (s[0].role !== 'hero') fails.push(`s0 role ${s[0].role}≠hero`);
    if (s[1].role !== 'logos') fails.push(`s1 role ${s[1].role}≠logos`);
    if (s[s.length - 1].role !== 'cta') fails.push(`sLast role ${s[s.length - 1].role}≠cta`);
    const roles = s.map((x) => x.role);
    if (!roles.includes('features')) fails.push('no features section detected');
    if (!roles.includes('testimonial')) fails.push('no testimonial section detected');
    if (fails.length) { console.log('SELFTEST FAIL (oracle): ' + fails.join('; ')); console.log('roles: ' + roles.join(', ')); process.exit(1); }
    console.log(`SELFTEST PASS sections=${v.sectionCount} roles=[${roles.join(', ')}]`);
    process.exit(0);
  }
  const layoutPath = arg('layout');
  if (!layoutPath || !fs.existsSync(layoutPath)) { console.error('need --layout <captureJson>  (or --selftest)'); process.exit(2); }
  const L = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
  const segPath = arg('seg');
  const seg = (segPath && fs.existsSync(segPath)) ? JSON.parse(fs.readFileSync(segPath, 'utf8')) : segment(L);
  const spec = buildSpec(seg, L);
  if (process.argv.includes('--summary')) {
    console.log(`source=${spec.source} sections=${spec.sections.length} fonts=${(spec.global.fonts || []).map((f) => f.family).join(',')} typeScale=[${spec.global.typeScale.join(',')}]`);
    if (spec.nav) console.log(`NAV  items=${spec.nav.itemCount} logo=${spec.nav.hasLogo} cta=${spec.nav.hasCta} motion(hover=${spec.nav.motion.hover})`);
    for (const s of spec.sections) {
      const slot = s.contentSlots;
      const head = slot.heading ? `"${slot.heading.slice(0, 32)}"` : (slot.eyebrow ? `(${slot.eyebrow.slice(0, 20)})` : '');
      console.log(`#${s.idx} ${s.role.padEnd(11)} ${s.layoutArchetype.padEnd(13)} conf=${s.confidence} cols=${s.columns} blocks=${s.blocks.length} btn=${slot.buttons.length} media=${slot.media.length} mo(h=${s.motion.hover?1:0},r=${s.motion.reveal?1:0}) ${head}`);
    }
    if (spec.footer) console.log(`FOOTER cols=${spec.footer.columns} blocks=${spec.footer.blocks.length}`);
    process.exit(0);
  }
  const json = process.argv.includes('--pretty') ? JSON.stringify(spec, null, 2) : JSON.stringify(spec);
  const out = arg('out');
  if (out) fs.writeFileSync(out, json);
  process.stdout.write(json + '\n');
}
