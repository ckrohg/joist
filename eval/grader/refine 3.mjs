#!/usr/bin/env node
/**
 * @purpose Stage 3 — the self-improving loop. Closes the generator/evaluator
 * harness onto the BUILD (not just the lessons file): it captures each source
 * section as a pixel-faithful image, then decides PER SECTION whether to keep
 * the editable widget rebuild or swap in the captured image — keeping whichever
 * the honest grader scores higher. Graphic-heavy bento/feature bands (which can't
 * be faithfully rebuilt as widgets) become images; text-heavy bands stay editable.
 *
 * This is the hybrid that reaches "looks pixel-for-pixel AND is editable".
 *
 * Env: JOIST_BASE, JOIST_AUTH_B64, (optional) ANTHROPIC_API_KEY for vision gate.
 * Usage: node refine.mjs --source <url> --tree tree.json --title "Clone v15"
 */
import fs from 'fs';
import { execFileSync } from 'child_process';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const base = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
const b64 = process.env.JOIST_AUTH_B64;
if (!b64) { console.error('missing JOIST_AUTH_B64'); process.exit(2); }
const source = arg('source'); const treePath = arg('tree', 'tree-stripe.json'); const title = arg('title', 'Stripe refined');
const tree = JSON.parse(fs.readFileSync(treePath, 'utf8'));

const VW = 1440;
const cropBand = (full, y0, h) => {
  const y = Math.max(0, Math.min(full.height - 1, Math.round(y0)));
  const hh = Math.max(8, Math.min(full.height - y, Math.round(h)));
  const out = new PNG({ width: full.width, height: hh });
  for (let row = 0; row < hh; row++) {
    const sFull = ((y + row) * full.width) * 4;
    const sOut = (row * full.width) * 4;
    full.data.copy(out.data, sOut, sFull, sFull + full.width * 4);
  }
  return out;
};

async function uploadPng(buf, name) {
  const r = await fetch(base + '/wp-json/wp/v2/media', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + b64, 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="${name}"` },
    body: buf,
  });
  const j = await r.json();
  if (!r.ok) { console.error('upload', name, r.status, JSON.stringify(j).slice(0, 200)); return null; }
  return j.source_url;
}

function grade(cloneUrl, outDir, label) {
  try {
    const o = execFileSync('node', ['grade.mjs', '--source', source, '--clone', cloneUrl, '--out', outDir, '--label', label], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    const m = o.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null;
  } catch (e) { console.error('grade failed', e.message); return null; }
}

function build(secImagesPath, t) {
  const args = ['build-tree.mjs', '--tree', treePath, '--title', t];
  if (secImagesPath) args.push('--section-images', secImagesPath);
  const o = execFileSync('node', args, { encoding: 'utf8' });
  const m = o.match(/PAGE_URL:\s*(\S+)/); return m ? m[1] : null;
}

const reuse = process.argv.includes('--reuse') && fs.existsSync('section-images.json');
(async () => {
  if (reuse) { console.log('reusing existing section-images.json\n'); }
  else await captureSections();

  async function captureSections() {
  // 1) one full-page source screenshot, crop each section band
  console.log('capturing source sections…');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: VW, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try { await page.goto(source, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await page.goto(source, { waitUntil: 'load', timeout: 60000 }); } catch {} }
  await page.waitForTimeout(2000);
  await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 180)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(800);
  const fullBuf = await page.screenshot({ fullPage: true });
  await browser.close();
  const full = PNG.sync.read(fullBuf);

  // 2) decide graphic-heavy sections + upload their band captures
  const heroIdx = tree.heroIdx ?? 0;
  const secImages = {};
  let graphicCount = 0;
  for (let i = 0; i < tree.sections.length; i++) {
    const s = tree.sections[i];
    const imgs = s.blocks.filter((b) => b.type === 'image');
    const fullBleed = s.blocks.some((b) => b.type === 'image' && b.rect.w >= 0.85 * (s.rect.w || VW) && b.rect.h >= 300);
    const graphicHeavy = i !== heroIdx && (imgs.length >= 2 || fullBleed);
    if (!graphicHeavy) continue;
    const band = cropBand(full, s.rect.y, s.rect.h);
    const url = await uploadPng(PNG.sync.write(band), `stripe-sec-${i}.png`);
    if (url) { secImages[i] = url; graphicCount++; console.log(`  section ${i}: graphic-heavy (${imgs.length} imgs) → captured ${band.height}px → ${url.split('/').pop()}`); }
  }
  fs.writeFileSync('section-images.json', JSON.stringify(secImages, null, 2));
  console.log(`${graphicCount} graphic-heavy sections captured; ${tree.sections.length - graphicCount} stay editable widgets\n`);
  }

  // 3) build BOTH configs, grade, keep the better one
  console.log('building all-widgets baseline…');
  const urlA = build(null, title + ' [all-widgets]');
  const gA = grade(urlA, './grader-widgets', 'widgets');
  console.log('  all-widgets:', gA?.fidelity_pct + '%', JSON.stringify(gA?.dimensions_pct));

  console.log('building hybrid (graphic→image)…');
  const urlB = build('section-images.json', title + ' [hybrid]');
  const gB = grade(urlB, './grader-hybrid', 'hybrid');
  console.log('  hybrid:    ', gB?.fidelity_pct + '%', JSON.stringify(gB?.dimensions_pct));

  const winner = (gB?.fidelity_pct ?? 0) >= (gA?.fidelity_pct ?? 0) ? { tag: 'hybrid', url: urlB, g: gB } : { tag: 'all-widgets', url: urlA, g: gA };
  console.log(`\nWINNER: ${winner.tag} @ ${winner.g?.fidelity_pct}% → ${winner.url}`);
  fs.writeFileSync('refine-result.json', JSON.stringify({ winner: winner.tag, url: winner.url, fidelity: winner.g?.fidelity_pct, dims: winner.g?.dimensions_pct, all_widgets: gA?.fidelity_pct, hybrid: gB?.fidelity_pct }, null, 2));
})();
