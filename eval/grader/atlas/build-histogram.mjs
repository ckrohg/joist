#!/usr/bin/env node
// @purpose P1 corpus feature-frequency histogram over persisted capture trees, counted under the
// PRE-REGISTERED construct unit (knowledge/EMBODIMENT_APPROACH.md §4.1, commit 440bb78 — locked
// BEFORE this script ran). Emits histogram.json + HISTOGRAM.md. WP-free, deterministic, pure node.
//
// Sources (structural, counted):
//   /tmp/abs-cache/*/layout.json            — typed capture trees, 7 sites @ 1440
//   /tmp/local-fidelity/cap/manifest.json   — clerk.com section bands @ 4 widths (+ style-facts)
// Sources (visual evidence only, NEVER counted — §4.1 no-double-count rule):
//   /tmp/vj-* tile sets, /tmp/qa-stepback bands
//
// Usage: node eval/grader/atlas/build-histogram.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ABS_CACHE = '/tmp/abs-cache';
const CLERK_CAP = '/tmp/local-fidelity/cap';
const UNIT_REF = 'EMBODIMENT_APPROACH.md §4.1 (pre-registered commit 440bb78)';

// ---------- §4.1 key-triple classification ----------

const visible = (n) => n?.box && n.box.w > 0 && n.box.h > 0;

function gridColCount(layout) {
  const cols = (layout?.gridCols || '').trim();
  if (!cols || cols === 'none') return 0;
  return cols.split(/\s+/).length;
}

function structuralSignature(n) {
  if (n.position === 'sticky' || n.position === 'fixed') return 'sticky-fixed-chrome';
  const d = n.layout?.display || 'block';
  if (d === 'grid') {
    const c = gridColCount(n.layout);
    if (c >= 4) return 'grid-4pluscol';
    if (c === 3) return 'grid-3col';
    if (c === 2) return 'grid-2col';
    return 'flex-col'; // 1-col grid behaves as a stack
  }
  if (d === 'flex' || d === 'inline-flex') {
    if (n.layout?.flexDirection?.startsWith('column')) return 'flex-col';
    // split-2col: exactly two ~half-width siblings, one textual one media
    const kids = (n.children || []).filter(visible);
    if (kids.length === 2 && n.box?.w) {
      const halfish = kids.every((k) => k.box.w > 0.32 * n.box.w && k.box.w < 0.68 * n.box.w);
      if (halfish) {
        const isMedia = (k) => ['image', 'svg', 'mockup', 'video'].includes(k.kind) ||
          (k.children || []).some((c) => ['image', 'svg', 'mockup', 'video'].includes(c.kind));
        const isText = (k) => ['heading', 'text', 'button'].includes(k.kind) ||
          (k.children || []).some((c) => ['heading', 'text', 'button'].includes(c.kind));
        if ((isMedia(kids[0]) && isText(kids[1])) || (isMedia(kids[1]) && isText(kids[0]))) return 'split-2col';
      }
    }
    return 'flex-row';
  }
  // block: absolutely-positioned children over a base → absolute-overlay
  const kids = (n.children || []).filter(visible);
  if (kids.some((k) => k.position === 'absolute') && kids.some((k) => k.position !== 'absolute')) {
    return 'absolute-overlay';
  }
  return 'block-stack';
}

const LOGO_RE = /logo|brand|wordmark/i;

function leafContentClass(n) {
  switch (n.kind) {
    case 'heading':
      return n.paint && n.paint.kind && n.paint.kind !== 'solid' ? 'inline-styled-rich-text' : 'heading';
    case 'text': {
      if (n.paint && n.paint.kind && n.paint.kind !== 'solid') return 'inline-styled-rich-text';
      const t = (n.text || '').trim();
      if (t && /^[\d.,+%$~×xKMB\s]+$/.test(t) && /\d/.test(t) && t.length <= 12) return 'stat-number';
      const h = n.box?.h || 0;
      const r = parseFloat(n.radius) || 0;
      if (n.bg && r >= h / 2 && h > 0 && h <= 44) return 'badge-pill';
      return 'body-text';
    }
    case 'button': {
      const h = n.box?.h || 0;
      const r = parseFloat(n.radius) || 0;
      if (r >= h / 2 && h > 0 && h <= 36 && !n.interactive) return 'badge-pill';
      return 'button-cta';
    }
    case 'image':
      return LOGO_RE.test(n.src || '') || LOGO_RE.test(n.alt || '') ? 'logo' : 'image';
    case 'svg':
      return (n.box?.w || 0) > 120 ? 'logo' : 'icon-svg';
    case 'mockup': return 'code-mockup';
    case 'input': return 'form-control';
    case 'video': return 'video-embed';
    case 'list': return n.linkColor ? 'nav-links' : 'list';
    case 'tabs': return 'code-mockup'; // tabs nodes in this corpus wrap code panels
    default: return null;
  }
}

function bgClass(n) {
  const b = n.background;
  if (n.bgImage || (b && b.image)) return 'image';
  if (b && b.gradient) return 'gradient';
  if (b && b.color) {
    const m = b.color.match(/rgba?\(([^)]+)\)/);
    if (m && m[1].split(',').length === 4 && parseFloat(m[1].split(',')[3]) === 0) return 'none';
    return 'flat';
  }
  return 'none';
}

function radiusClass(n) {
  const r = parseFloat(n.radius) || 0;
  if (r <= 0) return 'square';
  const h = n.box?.h || Infinity;
  if (r >= h / 2 || r >= 500) return 'pill-circle';
  return 'rounded';
}

function dynamicClass(n) {
  if (n.position === 'sticky' || n.position === 'fixed') return 'sticky';
  if (n.kind === 'tabs' || (n.children || []).some((k) => k.kind === 'tabs')) return 'tabs';
  return 'static'; // marquee/carousel/accordion/modal not detectable in static capture — see HISTOGRAM.md
}

function bucket(count) { return count >= 2 ? 'many' : count === 1 ? '1' : null; }

function containerKey(n) {
  const sig = structuralSignature(n);
  const classCounts = {};
  for (const k of (n.children || []).filter(visible)) {
    const cls = k.kind === 'container' ? null : leafContentClass(k);
    if (cls) classCounts[cls] = (classCounts[cls] || 0) + 1;
  }
  const multiset = Object.keys(classCounts).sort()
    .map((c) => `${c}:${bucket(classCounts[c])}`).join(',') || 'containers-only';
  const props = `bg:${bgClass(n)},bs:${n.border || n.boxShadow ? 'yes' : 'no'},rad:${radiusClass(n)},dyn:${dynamicClass(n)}`;
  return `${sig}|${multiset}|${props}`;
}

// ---------- named-construct aliases (reporting layer; aliases of key-triples per §4.1) ----------

function aliasFor(n, key, ctx) {
  const sig = key.split('|')[0];
  const kids = (n.children || []).filter(visible);
  const leafClasses = kids.map((k) => (k.kind === 'container' ? null : leafContentClass(k))).filter(Boolean);
  const deepHas = (node, pred, depth = 0) => {
    if (depth > 3 || !node) return false;
    if (pred(node)) return true;
    return (node.children || []).some((c) => deepHas(c, pred, depth + 1));
  };
  if (sig === 'sticky-fixed-chrome') return (n.box?.y ?? 1e9) < 200 ? 'nav-row' : 'sticky-chrome';
  if (sig === 'flex-row' && (n.box?.y ?? 1e9) < 160 && (leafClasses.includes('nav-links') || leafClasses.includes('logo'))) return 'nav-row';
  if (key.includes('bg:image')) return 'bg-image-section';
  if (leafClasses.includes('form-control')) return 'form';
  if (leafClasses.includes('code-mockup')) return 'code-panel';
  const mediaKids = kids.filter((k) => ['image', 'svg'].includes(k.kind));
  if (mediaKids.length >= 4 && mediaKids.length === kids.length && mediaKids.every((k) => (k.box?.h || 0) <= 80)) return 'logo-band';
  if (sig.startsWith('grid-') || (sig === 'flex-row' && kids.length >= 3)) {
    const cardish = kids.filter((k) => k.kind === 'container' &&
      deepHas(k, (c) => c.kind === 'heading') && deepHas(k, (c) => ['text', 'image', 'svg'].includes(c.kind)));
    if (cardish.length >= 3) return 'card-grid';
  }
  if (ctx.pageH && (n.box?.y ?? 0) > ctx.pageH - 1300 &&
      kids.filter((k) => k.kind === 'list' || (k.kind === 'container' && deepHas(k, (c) => c.kind === 'list'))).length >= 2) return 'footer-columns';
  if ((n.box?.y ?? 1e9) < 1500 && (n.box?.h || 0) >= 350 &&
      deepHas(n, (c) => c.kind === 'heading' && (c.level === 1 || c.typo?.size >= 40)) &&
      deepHas(n, (c) => c.kind === 'button')) return 'hero-stack';
  return null;
}

// ---------- walk + count ----------

const constructs = new Map(); // key → {count, sites:Set, aliases:{}, examples:[]}
let totalOccurrences = 0;

function record(key, site, alias, example) {
  let e = constructs.get(key);
  if (!e) { e = { count: 0, sites: new Set(), aliases: {}, examples: [] }; constructs.set(key, e); }
  e.count += 1;
  e.sites.add(site);
  if (alias) e.aliases[alias] = (e.aliases[alias] || 0) + 1;
  if (e.examples.length < 3) e.examples.push(example);
  totalOccurrences += 1;
}

const leafTotals = {}; // standalone content-class tallies (leaf occurrences, also counted per §4.1 nesting rule)

function walkTree(n, site, ctx) {
  if (!n || !visible(n)) return;
  if (n.kind === 'container') {
    const key = containerKey(n);
    record(key, site, aliasFor(n, key, ctx), { site, tag: n.tag, box: n.box });
    (n.children || []).forEach((c) => walkTree(c, site, ctx));
  } else {
    const cls = leafContentClass(n);
    if (cls) {
      leafTotals[cls] = (leafTotals[cls] || 0) + 1;
      record(`leaf|${cls}`, site, cls === 'inline-styled-rich-text' ? 'inline-styled-text' : null,
        { site, tag: n.tag, box: n.box });
    }
    (n.children || []).forEach((c) => walkTree(c, site, ctx)); // lists/tabs may nest
  }
}

const sources = { counted: [], evidenceOnly: [] };

// 1) abs-cache typed trees
for (const site of fs.readdirSync(ABS_CACHE).sort()) {
  const f = path.join(ABS_CACHE, site, 'layout.json');
  if (!fs.existsSync(f)) continue;
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  walkTree(j.root, site, { pageH: j.pageH });
  sources.counted.push({ source: f, site, vw: j.vw, pageH: j.pageH });
}

// 2) clerk manifest bands (band-only evidence: bg/property classes from style-facts;
//    structural signature defaults to block-stack — detection limit, see HISTOGRAM.md)
if (fs.existsSync(path.join(CLERK_CAP, 'manifest.json'))) {
  const man = JSON.parse(fs.readFileSync(path.join(CLERK_CAP, 'manifest.json'), 'utf8'));
  let facts = {};
  try { facts = JSON.parse(fs.readFileSync(path.join(CLERK_CAP, 'style-facts.json'), 'utf8')); } catch {}
  let bands = 0;
  for (const [w, data] of Object.entries(man.perWidth || {})) {
    for (const s of data.sections || []) {
      if (!(s.w > 0 && s.h > 0)) continue;
      const sf = facts[s.locator]?.perWidth?.[w] || {};
      const bg = sf.backgroundColor && !/rgba?\([^)]*,\s*0\)/.test(sf.backgroundColor) ? 'flat' : 'none';
      const rad = parseFloat(sf.borderRadius) > 0 ? 'rounded' : 'square';
      const bs = sf.boxShadow && sf.boxShadow !== 'none' ? 'yes' : 'no';
      const key = `block-stack|band-only|bg:${bg},bs:${bs},rad:${rad},dyn:static`;
      record(key, 'clerkcom', null, { site: 'clerkcom', tag: 'band', box: { x: s.x, y: s.y, w: s.w, h: s.h }, width: w });
      bands += 1;
    }
  }
  sources.counted.push({ source: CLERK_CAP, site: 'clerkcom', widths: man.widths, bands, note: 'band-only keys (no typed tree)' });
}

// 3) evidence-only inventories (never counted)
for (const d of fs.readdirSync('/tmp')) {
  if (/^vj-/.test(d) && fs.statSync(path.join('/tmp', d)).isDirectory()) {
    sources.evidenceOnly.push(`/tmp/${d}`);
  }
}
if (fs.existsSync('/tmp/qa-stepback')) sources.evidenceOnly.push('/tmp/qa-stepback');

// ---------- emit ----------

const ranked = [...constructs.entries()]
  .map(([key, e]) => ({
    key,
    alias: Object.entries(e.aliases).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    count: e.count,
    sites: [...e.sites].sort(),
    examples: e.examples,
  }))
  .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

const headN = 50;
const headCount = ranked.slice(0, headN).reduce((s, r) => s + r.count, 0);
const coverage = { headN, headOccurrences: headCount, totalOccurrences, headShare: +(headCount / totalOccurrences).toFixed(4), gate: 'headShare >= 0.95', pass: headCount / totalOccurrences >= 0.95 };

// named-construct rollup (alias view)
const aliasTotals = {};
for (const r of ranked) for (const [a, c] of Object.entries(constructs.get(r.key).aliases)) aliasTotals[a] = (aliasTotals[a] || 0) + c;

const out = {
  generated: new Date().toISOString(),
  unit: UNIT_REF,
  sources,
  coverage,
  distinctConstructs: ranked.length,
  aliasRollup: Object.fromEntries(Object.entries(aliasTotals).sort((a, b) => b[1] - a[1])),
  leafClassTotals: Object.fromEntries(Object.entries(leafTotals).sort((a, b) => b[1] - a[1])),
  constructs: ranked,
};
fs.writeFileSync(path.join(OUT_DIR, 'histogram.json'), JSON.stringify(out, null, 1));
console.log(`constructs=${ranked.length} occurrences=${totalOccurrences} headShare=${coverage.headShare} pass=${coverage.pass}`);
console.log('alias rollup:', JSON.stringify(out.aliasRollup));
console.log('top 12 keys:');
for (const r of ranked.slice(0, 12)) console.log(`  ${String(r.count).padStart(4)}  ${r.alias || '-'}  ${r.key}`);
