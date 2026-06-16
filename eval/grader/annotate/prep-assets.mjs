#!/usr/bin/env node
/**
 * @purpose Project a CAPTURED SOURCE record set into the annotation tool's left-pane assets:
 *   assets/<slug>/source-bbox.json   = { meta, byPath: { <--joist-src stamp> : {x,y,w,h} } }
 * keyed by the SAME content-addressed stamp the clone carries (--joist-src) and the grader joins on.
 * When a clone pin resolves to a stamp, the tool looks the stamp up in byPath and highlights that
 * region on the captured SOURCE screenshot (left pane). Nothing here loads the live external source —
 * it reads an EXISTING capture JSON (from compare-capture.mjs / capture-layout.mjs) on disk.
 *
 * The source ref used by compare-capture / axisdelta is `ref = srcStamp || srcPath` in the format
 *   tagchain|nth|h<8hex>
 * which is byte-identical to the clone's --joist-src. So byPath[stamp] aligns O(1) with a clone pin.
 *
 * Input shapes accepted (auto-detected):
 *   (A) compare-capture sourceCapture: { records:[{ ref|srcPath, box:{[vw]:{x,y,w,h}}, ... }], vw|pageHeightByVw }
 *   (B) a flat records array (same record shape) — e.g. capture-layout per-viewport records.
 *   (C) an els-shape capture: { els:[{ ... }], vw, pageH } — bbox from el.box / el rect if present
 *       (best-effort; els-shape lacks per-element stamps, so byPath falls back to a synthetic path).
 *
 * Usage:
 *   node prep-assets.mjs --capture <capture.json> --slug <slug> [--vw 1440] [--shot <source.png>]
 *   node prep-assets.mjs --synthetic            # writes assets/synthetic/{source-bbox.json,source.svg}
 *
 * The --shot is OPTIONAL: if given it is copied to assets/<slug>/source.png; otherwise prep records
 * the expected screenshot filename in meta.shot for the operator to drop in (captured via _shoot.mjs,
 * NOT a live cross-origin load).
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  if (i >= 0) return true; // boolean flag
  return def;
}

// stamp regex (mirror of annotate-core's STAMP_RE so prep stays dependency-free).
const STAMP_RE = /^[a-z0-9>_-]+\|\d+\|h[0-9a-f]{8}$/i;
const isStamp = (s) => typeof s === 'string' && STAMP_RE.test(s);

/** Pick a box at the chosen viewport from a compare-capture record (box keyed by vw or String(vw)). */
function boxAtVw(rec, vw) {
  if (!rec) return null;
  if (rec.box && typeof rec.box === 'object') {
    const b = rec.box[vw] || rec.box[String(vw)];
    if (b && Number.isFinite(b.x)) return b;
    // fall back to the first available viewport box
    for (const k of Object.keys(rec.box)) { const v = rec.box[k]; if (v && Number.isFinite(v.x)) return v; }
  }
  // a flat record may carry x/y/w/h directly
  if (Number.isFinite(rec.x) && Number.isFinite(rec.w)) return { x: rec.x, y: rec.y, w: rec.w, h: rec.h };
  return null;
}

/** Build { meta, byPath } from a records array. */
function projectRecords(records, vw, pageH, extraMeta) {
  const byPath = {};
  let stamped = 0;
  for (const rec of records || []) {
    const ref = rec.ref || rec.srcPath || rec.stamp;
    const b = boxAtVw(rec, vw);
    if (!ref || !b) continue;
    // round + drop collapsed boxes
    const box = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
    if (!(box.w > 0 && box.h > 0)) continue;
    // keep the FIRST box for a given ref (records are top-down; first = the outermost owning wrapper)
    if (!(ref in byPath)) byPath[ref] = box;
    if (isStamp(ref)) stamped++;
  }
  const total = Object.keys(byPath).length;
  return {
    meta: {
      vw,
      pageH: pageH || null,
      scale: 1,
      count: total,
      stampedCount: stamped,
      stampRate: total ? +(stamped / total).toFixed(3) : 0,
      ...extraMeta,
    },
    byPath,
  };
}

function detectAndProject(capture, vw) {
  // (A) compare-capture sourceCapture { records, ... }
  if (Array.isArray(capture.records) && capture.records.length) {
    const pageH = (capture.pageHeightByVw && (capture.pageHeightByVw[vw] || capture.pageHeightByVw[String(vw)])) || capture.pageH || null;
    return projectRecords(capture.records, vw, pageH, { source: 'compare-capture.records', url: capture.url || null, label: capture.label || null });
  }
  // (B) a flat array
  if (Array.isArray(capture)) {
    return projectRecords(capture, vw, null, { source: 'flat-records' });
  }
  // (C) an els-shape capture
  if (Array.isArray(capture.els) && capture.els.length) {
    // els-shape lacks per-element stamps; synthesize a path from tag+index so the left pane still has
    // boxes (the highlight will only fire when a clone stamp coincidentally matches a synthetic path —
    // i.e. effectively only the synthetic fixture path; real correspondence needs a stamped capture).
    const recs = capture.els.map((el, i) => {
      const b = el.box || el.rect || (Number.isFinite(el.x) ? el : null);
      return b ? { ref: el.srcPath || el.ref || `${(el.tag || el.type || 'el')}|${i + 1}|h00000000`, box: { [vw]: { x: b.x || b.left || 0, y: b.y || b.top || 0, w: b.w || b.width || 0, h: b.h || b.height || 0 } } } : null;
    }).filter(Boolean);
    return projectRecords(recs, vw, capture.pageH || null, { source: 'els-shape', url: capture.url || null, note: 'els-shape capture has no per-element --joist-src stamps; byPath keys are synthetic.' });
  }
  throw new Error('unrecognized capture shape: expected { records:[...] } | [...] | { els:[...] }');
}

// ── synthetic fixture: a self-contained left-pane the selftest + a no-host demo can use ───────────
function writeSynthetic() {
  const slugDir = path.join(HERE, 'assets', 'synthetic');
  fs.mkdirSync(slugDir, { recursive: true });
  // three stacked source regions + one overlapping pair (for the collision/z-stack demo).
  const byPath = {
    'body>header|1|haaaa0001': { x: 40, y: 24, w: 180, h: 48 },     // logo
    'body>main>section>h1|1|hbbbb0002': { x: 60, y: 120, w: 720, h: 90 }, // hero heading
    'body>main>section>a|1|hcccc0003': { x: 60, y: 240, w: 200, h: 56 },  // CTA
    'body>footer|1|hdddd0004': { x: 0, y: 900, w: 980, h: 160 },          // footer (overlaps hero in clone)
    'body>main>section|1|heeee0005': { x: 0, y: 100, w: 980, h: 420 },    // hero section (collides with footer)
  };
  const meta = { vw: 980, pageH: 1100, scale: 1, count: 5, stampedCount: 5, stampRate: 1, source: 'synthetic-fixture', shot: 'source.svg' };
  fs.writeFileSync(path.join(slugDir, 'source-bbox.json'), JSON.stringify({ meta, byPath }, null, 2));
  // a tiny SVG "screenshot" so the left pane renders with no binary asset / no host.
  const rects = Object.entries(byPath).map(([k, b], i) =>
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="hsl(${i * 67},60%,80%)" stroke="#333"/>` +
    `<text x="${b.x + 6}" y="${b.y + 18}" font-size="13" font-family="monospace">${k.split('|')[0].split('>').pop()}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="980" height="1100" viewBox="0 0 980 1100"><rect width="980" height="1100" fill="#fafafa"/>${rects}</svg>`;
  fs.writeFileSync(path.join(slugDir, 'source.svg'), svg);
  console.log('wrote', path.join(slugDir, 'source-bbox.json'), '(', meta.count, 'regions ) +', path.join(slugDir, 'source.svg'));
}

function main() {
  if (arg('synthetic')) { writeSynthetic(); return; }
  const captureArg = arg('capture');
  const slug = arg('slug');
  const vw = Number(arg('vw', 1440));
  const shot = arg('shot');
  if (!captureArg || !slug) {
    console.error('usage: node prep-assets.mjs --capture <capture.json> --slug <slug> [--vw 1440] [--shot <source.png>]');
    console.error('   or: node prep-assets.mjs --synthetic');
    process.exit(2);
  }
  const capPath = path.resolve(String(captureArg));
  const capture = JSON.parse(fs.readFileSync(capPath, 'utf8'));
  const projected = detectAndProject(capture, vw);
  const slugDir = path.join(HERE, 'assets', String(slug));
  fs.mkdirSync(slugDir, { recursive: true });
  // optional screenshot copy (already captured via _shoot.mjs — never a live cross-origin load).
  if (shot && shot !== true) {
    const shotPath = path.resolve(String(shot));
    const dest = path.join(slugDir, 'source.png');
    fs.copyFileSync(shotPath, dest);
    projected.meta.shot = 'source.png';
    console.log('copied source screenshot →', dest);
  } else {
    projected.meta.shot = projected.meta.shot || 'source.png';
    console.log('NOTE: no --shot given; drop the captured screenshot at', path.join(slugDir, projected.meta.shot));
  }
  const out = path.join(slugDir, 'source-bbox.json');
  fs.writeFileSync(out, JSON.stringify(projected, null, 2));
  console.log('wrote', out, '—', projected.meta.count, 'regions,', projected.meta.stampedCount, 'stamped (', projected.meta.stampRate, '), vw', vw);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

export { detectAndProject, projectRecords, boxAtVw, writeSynthetic };
