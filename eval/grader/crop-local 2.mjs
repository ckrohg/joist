/** @purpose Write-free: crop source sections to LOCAL pngs for the fidelity loop. */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'fs';
const tree = JSON.parse(fs.readFileSync('tree-stripe.json', 'utf8'));
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await p.goto('https://stripe.com', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(2500);
await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 180)); } window.scrollTo(0, 0); });
await p.waitForTimeout(1000);
const full = PNG.sync.read(await p.screenshot({ fullPage: true }));
await b.close();
const crop = (y0, h, name) => { const y = Math.max(0, Math.min(full.height - 1, Math.round(y0))); const hh = Math.max(8, Math.min(full.height - y, Math.round(h))); const o = new PNG({ width: full.width, height: hh }); for (let r = 0; r < hh; r++) { const s = ((y + r) * full.width) * 4; o.data.set(full.data.subarray(s, s + full.width * 4), (r * full.width) * 4); } fs.writeFileSync(name, PNG.sync.write(o)); return hh; };
const s8 = tree.sections[8];
const h8 = crop(s8.rect.y, s8.rect.h, 'sec-local-8.png');
const lg = crop(610, 150, 'sec-local-logos.png');
console.log('footer', h8, 'px | logos 150px | fullH', full.height);
