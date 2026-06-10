#!/usr/bin/env node
/**
 * Asset capture — CLONE_FIDELITY_SYSTEM_SPEC.md §B/§D (task #12).
 *
 * Captures REAL visual assets from a source page via Playwright and emits them
 * as data-URIs (+ .png files) so the clone can embed real imagery/gradients
 * INSTEAD of flat fills or hallucinated placeholders. Data-URI embedding is
 * fully within-WP: the asset travels in the Elementor page content, no media
 * upload, no plugin deploy, round-trips with the page. (Hosting via WP Media
 * is a later option; data-URI is the zero-dependency default.)
 *
 * Usage:
 *   node capture.mjs --source <url> --targets <targets.json|inline> --out <dir> [--viewport 1440x900]
 * targets: [{ "name":"hero_gradient", "selector":"canvas" },
 *           { "name":"logo", "selector":"header img, header svg" },
 *           { "name":"hero_region", "full":true },
 *           { "name":"band", "clip":{ "x":0,"y":0,"width":1440,"height":520 } }]
 *
 * Output: <out>/<name>.png per asset + <out>/manifest.json
 *   manifest: [{ name, selector?, bytes, width, height, file, dataUri }]
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };

const source = arg('source');
const out = arg('out', './assets-out');
const targetsArg = arg('targets', '[]');
const [vw, vh] = (arg('viewport', '1440x900')).split('x').map(Number);
if (!source) { console.error('need --source'); process.exit(2); }
let targets = [];
try { targets = fs.existsSync(targetsArg) ? JSON.parse(fs.readFileSync(targetsArg, 'utf8')) : JSON.parse(targetsArg); }
catch { console.error('bad --targets (file or inline JSON)'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });

function dims(buf) { try { const p = PNG.sync.read(buf); return { width: p.width, height: p.height }; } catch { return { width: 0, height: 0 }; } }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, userAgent: UA, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try { await page.goto(source, { waitUntil: 'networkidle', timeout: 45000 }); }
  catch { try { await page.goto(source, { waitUntil: 'load', timeout: 45000 }); } catch {} }
  await page.waitForTimeout(3000); // let canvas/animated gradients + lazy imagery render a frame

  const manifest = [];
  for (const t of targets) {
    let buf = null, used = null;
    try {
      if (typeof t.scrollY === 'number') { await page.evaluate((y) => window.scrollTo(0, y), t.scrollY); await page.waitForTimeout(900); }
      if (t.full) { buf = await page.screenshot(); used = 'viewport'; }
      else if (t.clip) { buf = await page.screenshot({ clip: t.clip }); used = 'clip'; }
      else if (t.selector) {
        // first matching VISIBLE element of any selector in the comma list
        for (const sel of t.selector.split(',').map(s => s.trim())) {
          const el = await page.$(sel);
          if (el && await el.isVisible().catch(() => false)) {
            const box = await el.boundingBox();
            if (box && box.width > 4 && box.height > 4) { buf = await el.screenshot(); used = sel; break; }
          }
        }
      }
    } catch (e) { /* fall through to miss */ }
    if (!buf) { manifest.push({ name: t.name, selector: t.selector || null, captured: false, note: 'no visible match' }); continue; }
    const d = dims(buf);
    const file = path.join(out, `${t.name}.png`);
    fs.writeFileSync(file, buf);
    manifest.push({
      name: t.name, selector: used, captured: true,
      bytes: buf.length, width: d.width, height: d.height,
      file: path.relative(process.cwd(), file),
      dataUri: 'data:image/png;base64,' + buf.toString('base64'),
    });
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  // stdout summary WITHOUT the giant data-URIs
  console.log(JSON.stringify(manifest.map(({ dataUri, ...m }) => ({ ...m, dataUri: dataUri ? `<${(dataUri.length / 1024).toFixed(0)}KB data-uri>` : null })), null, 2));
  console.log(`\n✓ ${manifest.filter(m => m.captured).length}/${targets.length} assets captured → ${out}/manifest.json`);
})();
