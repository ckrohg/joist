// @purpose Metric bake-off step 1: split persisted side-by-side judge tiles
// (source-left | divider | clone-right) into separate src/clone half images
// so deterministic metrics can compare the two halves pixel-wise.
// Usage: node eval/grader/metric-bakeoff/split.mjs [outRoot]
// Reads the 6 persisted vision-judge tile dirs in /tmp, writes halves to
// outRoot (default /tmp/metric-bakeoff/halves/<site>/<tile>-{src,clone}.png).
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const SITES = {
  tailwind: '/tmp/vj-cal-tailwind',
  supabase: '/tmp/vj-cal-supabase',
  resend: '/tmp/vj-cal-resend',
  blog: '/tmp/vj-cal-blog',
  clerk: '/tmp/vj-heldout-clerk',
  htmlfirst: '/tmp/vj-htmlfirst',
};

const outRoot = process.argv[2] || '/tmp/metric-bakeoff/halves';

function crop(png, x0, w) {
  const out = new PNG({ width: w, height: png.height });
  for (let y = 0; y < png.height; y++) {
    const srcStart = (y * png.width + x0) * 4;
    png.data.copy(out.data, y * w * 4, srcStart, srcStart + w * 4);
  }
  return out;
}

let total = 0;
for (const [site, dir] of Object.entries(SITES)) {
  if (!fs.existsSync(dir)) { console.error(`SKIP missing ${dir}`); continue; }
  const outDir = path.join(outRoot, site);
  fs.mkdirSync(outDir, { recursive: true });
  const tiles = fs.readdirSync(dir).filter((f) => /^w\d+-tile-\d+\.png$/.test(f)).sort();
  for (const f of tiles) {
    const m = f.match(/^w(\d+)-tile-(\d+)\.png$/);
    const labelW = Number(m[1]);
    const png = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
    if (png.width < labelW * 2) { console.error(`SKIP ${site}/${f}: width ${png.width} < 2x${labelW}`); continue; }
    const base = f.replace(/\.png$/, '');
    const srcOut = path.join(outDir, `${base}-src.png`);
    const cloneOut = path.join(outDir, `${base}-clone.png`);
    if (!fs.existsSync(srcOut)) fs.writeFileSync(srcOut, PNG.sync.write(crop(png, 0, labelW)));
    if (!fs.existsSync(cloneOut)) fs.writeFileSync(cloneOut, PNG.sync.write(crop(png, png.width - labelW, labelW)));
    total++;
  }
  console.log(`${site}: ${tiles.length} tiles split -> ${outDir}`);
}
console.log(`DONE ${total} tiles`);
