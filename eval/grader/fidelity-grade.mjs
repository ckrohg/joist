#!/usr/bin/env node
/**
 * @purpose Effects + imagery fidelity eval layer (EVAL_COVERAGE_MAP §A8,A9). The visual grader's
 * perceptual SSIM can miss whether the clone reproduces the source's EFFECT VOCABULARY (shadows,
 * radii, blurs, blends, gradients) and whether images are REAL vs placeholder/broken. Compares
 * the source's effect histogram + image reality to the clone's. Read-only.
 * Usage: node fidelity-grade.mjs --source <url> --clone <url> [--out dir]
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { assertAllowedBase, assertNotBlocked } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: refuse a stray (e.g. paused *.sg-host.com) URL before any navigation.
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = arg('source'), clone = arg('clone'), out = arg('out', './fidelity-out');
if (!source || !clone) { console.error('need --source --clone'); process.exit(2); }
// §0 SAFETY GUARD: assert every http(s) URL arg targets a training host (blocks the paused shared host) BEFORE any chromium.goto.
if (clone && /^https?:/i.test(clone)) assertAllowedBase(clone); if (source && /^https?:/i.test(source)) assertNotBlocked(source); /* source = external read-only; only the paused host is blocked */
fs.mkdirSync(out, { recursive: true });

async function survey(ctx, url) {
  const p = await ctx.newPage(); await p.setViewportSize({ width: 1440, height: 900 });
  try { await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(url, { waitUntil: 'load', timeout: 30000 }); } catch {} }
  await p.waitForTimeout(1000);
  await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); } window.scrollTo(0, 0); });
  const r = await p.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 4 && r.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05; };
    const fx = { shadow: 0, radius: 0, blur: 0, blend: 0, gradient: 0, transform: 0 };
    for (const el of document.querySelectorAll('*')) { if (!vis(el)) continue; const cs = getComputedStyle(el);
      if (cs.boxShadow && cs.boxShadow !== 'none') fx.shadow++;
      if (parseFloat(cs.borderTopLeftRadius) > 1) fx.radius++;
      if ((cs.filter && cs.filter !== 'none') || (cs.backdropFilter && cs.backdropFilter !== 'none')) fx.blur++;
      if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') fx.blend++;
      if (/gradient/.test(cs.backgroundImage)) fx.gradient++;
      if (cs.transform && cs.transform !== 'none') fx.transform++;
    }
    const imgs = [...document.querySelectorAll('img')].filter(vis);
    let real = 0, placeholder = 0, broken = 0;
    for (const i of imgs) { const src = i.currentSrc || i.src || ''; if (i.complete && i.naturalWidth === 0) broken++; else if (/placehold|placeholder|via\.placeholder|dummyimage/i.test(src)) placeholder++; else if (/^https?:/.test(src)) real++; }
    // background images count too
    let bgImgs = 0; for (const el of document.querySelectorAll('*')) { if (!vis(el)) continue; const bi = getComputedStyle(el).backgroundImage; if (bi && bi !== 'none' && /url\(/.test(bi) && !/gradient/.test(bi)) bgImgs++; }
    return { fx, images: imgs.length, real, placeholder, broken, bgImgs };
  });
  await p.close(); return r;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const s = await survey(ctx, source), c = await survey(ctx, clone);
  await browser.close();
  const D = {}; const fails = []; const defects = [];
  // EFFECTS: does the clone reproduce the source's effect vocabulary? ratio per effect, MIN of the meaningful ones.
  const ratios = []; const effDefs = [];
  for (const k of Object.keys(s.fx)) { if (s.fx[k] < 3) continue; const r = Math.min(1, c.fx[k] / s.fx[k]); ratios.push(r); if (r < 0.4) effDefs.push(`${k}: source ${s.fx[k]} els, clone ${c.fx[k]}`); }
  D.effects = ratios.length ? +Math.min(...ratios).toFixed(3) : 1;
  if (effDefs.length) { fails.push('effects'); defects.push('missing effects — ' + effDefs.slice(0, 3).join('; ')); }
  // IMAGERY: clone should use REAL images, not placeholders/broken
  const totalClone = c.real + c.placeholder + c.broken;
  D.imagery = totalClone ? +Math.max(0, (c.real) / totalClone).toFixed(3) : (s.images > 2 ? 0 : 1);
  if (c.placeholder > 0) { fails.push('placeholder-images'); defects.push(`clone uses ${c.placeholder} placeholder images (should be real)`); }
  if (c.broken > 0) { fails.push('broken-images'); defects.push(`clone has ${c.broken} broken images`); }
  if (s.images + s.bgImgs >= 3 && (c.real + c.bgImgs) < (s.images + s.bgImgs) * 0.4) { fails.push('missing-imagery'); defects.push(`source ${s.images + s.bgImgs} images (fg+bg), clone ${c.real + c.bgImgs} real`); }
  const overall = Math.round(Math.min(D.effects, D.imagery) * 100);
  const report = { overall_pct: overall, dims: D, hard_fails: fails, defects, source: s, clone: c };
  fs.writeFileSync(path.join(out, 'fidelity-report.json'), JSON.stringify(report, null, 2));
  console.log('EFFECTS + IMAGERY FIDELITY (source vs clone):');
  console.log(`  effects   shadow ${s.fx.shadow}/${c.fx.shadow}  radius ${s.fx.radius}/${c.fx.radius}  blur ${s.fx.blur}/${c.fx.blur}  gradient ${s.fx.gradient}/${c.fx.gradient}  (src/clone)`);
  console.log(`  imagery   source ${s.images}fg+${s.bgImgs}bg   clone real ${c.real} / placeholder ${c.placeholder} / broken ${c.broken} + ${c.bgImgs}bg`);
  console.log('\n' + JSON.stringify({ fidelity_overall: overall, dims: D, hard_fails: fails, defects }, null, 2));
})();
