#!/usr/bin/env node
/** @purpose Full-page side-by-side overview (source | clone) for visual 1:1 review. Captures both
 * full-page at 1440, downscales, composes side-by-side with a divider. Usage:
 * node compose-overview.mjs --source <url|file.png> --clone <url> --out /tmp/ov.png [--scale 3] */
import fs from 'fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const source = arg('source'), clone = arg('clone'), out = arg('out', '/tmp/ov.png'), SCALE = parseInt(arg('scale', '3'), 10), W = 1440;
async function cap(ctx, t) { if (!/^https?:/.test(t)) return PNG.sync.read(fs.readFileSync(t)); const p = await ctx.newPage(); await p.setViewportSize({ width: W, height: 900 }); try { await p.goto(t, { waitUntil: 'networkidle', timeout: 60000 }); } catch {} await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(1200); await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 200)); } scrollTo(0, 0); }); await p.waitForTimeout(800); const s = PNG.sync.read(await p.screenshot({ fullPage: true })); await p.close(); return s; }
const down = (src, f) => { const w = Math.floor(src.width / f), h = Math.floor(src.height / f); const o = new PNG({ width: w, height: h }); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let r = 0, g = 0, b = 0; for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) { const si = (((y * f + dy) * src.width) + (x * f + dx)) * 4; r += src.data[si]; g += src.data[si + 1]; b += src.data[si + 2]; } const n = f * f, di = (y * w + x) * 4; o.data[di] = r / n; o.data[di + 1] = g / n; o.data[di + 2] = b / n; o.data[di + 3] = 255; } return o; };
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
const s = down(await cap(ctx, source), SCALE), c = down(await cap(ctx, clone), SCALE); await b.close();
const gap = 8, H = Math.max(s.height, c.height); const o = new PNG({ width: s.width + gap + c.width, height: H });
for (let i = 0; i < o.data.length; i += 4) { o.data[i] = o.data[i + 1] = o.data[i + 2] = 30; o.data[i + 3] = 255; }
for (const [img, ox] of [[s, 0], [c, s.width + gap]]) for (let y = 0; y < img.height; y++) { const sRow = (y * img.width) * 4; img.data.copy(o.data, (y * o.width + ox) * 4, sRow, sRow + img.width * 4); }
fs.writeFileSync(out, PNG.sync.write(o)); console.log('saved', out, `${o.width}x${o.height} (L=source R=clone)`);
