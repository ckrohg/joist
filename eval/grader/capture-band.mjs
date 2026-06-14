/** @purpose Capture a section band as an image (re-anchored fresh) + upload to WP + register in section-images.json. */
import fs from 'fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
// §0 SAFETY GUARD: default flipped from the PAUSED shared host georges232.sg-host.com → local sandbox;
// resolveBase() throws LOUDLY before any fetch/PUT if JOIST_BASE points to a non-training host.
import { resolveBase } from '../../sandbox/host-guard.mjs';
const base = resolveBase(process.env.JOIST_BASE || 'http://localhost:8001');
const b64 = process.env.JOIST_AUTH_B64;
const idx = parseInt(arg('section'), 10);
const tree = JSON.parse(fs.readFileSync('tree-stripe.json', 'utf8'));
const sec = tree.sections[idx];
const anchorBlk = sec.blocks.find((b) => b.text) || sec.blocks[0];
const anchorOffset = (anchorBlk?.rect?.y ?? sec.rect.y) - sec.rect.y;

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await p.goto('https://stripe.com', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(2000);
await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); } window.scrollTo(0, 0); });
await p.waitForTimeout(900);
const y0 = await p.evaluate((a) => { for (const el of document.querySelectorAll('h1,h2,h3,h4,p,span,div')) { const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim(); if (own && own.startsWith(a.t.slice(0, 28))) return el.getBoundingClientRect().top + window.scrollY - a.o; } return a.y; }, { t: anchorBlk?.text || '', o: anchorOffset, y: sec.rect.y });
const full = PNG.sync.read(await p.screenshot({ fullPage: true }));
await b.close();
const y = Math.max(0, Math.round(y0)), hh = Math.min(sec.rect.h, full.height - y);
const o = new PNG({ width: full.width, height: hh });
for (let r = 0; r < hh; r++) { const s = ((y + r) * full.width) * 4; o.data.set(full.data.subarray(s, s + full.width * 4), (r * full.width) * 4); }
const file = `sec-band-${idx}.png`; fs.writeFileSync(file, PNG.sync.write(o));

const r = await fetch(base + '/wp-json/wp/v2/media', { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="stripe-band-${idx}.png"` }, body: fs.readFileSync(file) });
const j = await r.json();
if (!r.ok) { console.error('upload failed', r.status, JSON.stringify(j).slice(0, 150)); process.exit(1); }
const si = JSON.parse(fs.readFileSync('section-images.json', 'utf8'));
si[idx] = j.source_url; fs.writeFileSync('section-images.json', JSON.stringify(si, null, 2));
console.log(`section ${idx}: ${hh}px band → ${j.source_url}`);
