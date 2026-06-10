// @purpose throwaway LOOK helper: crop a y-band out of two full-page PNGs (source/clone) side by side, downscaled 0.5
import fs from 'fs';
import { PNG } from 'pngjs';
const [srcPath, clnPath, y0s, y1s, out] = process.argv.slice(2);
const y0 = +y0s, y1 = +y1s;
const a = PNG.sync.read(fs.readFileSync(srcPath)), b = PNG.sync.read(fs.readFileSync(clnPath));
const crop = (img) => { const h = Math.max(1, Math.min(img.height, y1) - y0); const c = new PNG({ width: img.width, height: h }); if (y0 < img.height) img.bitblt(c, 0, y0, img.width, Math.min(h, img.height - y0), 0, 0); return c; };
const ca = crop(a), cb = crop(b);
const H = Math.max(ca.height, cb.height), W = ca.width + cb.width + 8;
const m = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) { m.data[i * 4] = 255; m.data[i * 4 + 1] = 0; m.data[i * 4 + 2] = 80; m.data[i * 4 + 3] = 255; }
ca.bitblt(m, 0, 0, ca.width, ca.height, 0, 0);
cb.bitblt(m, 0, 0, cb.width, cb.height, ca.width + 8, 0);
// downscale 2x for LOOK
const s = new PNG({ width: Math.floor(W / 2), height: Math.floor(H / 2) });
for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) { const i = (y * s.width + x) * 4, j = ((y * 2) * W + x * 2) * 4; s.data[i] = m.data[j]; s.data[i + 1] = m.data[j + 1]; s.data[i + 2] = m.data[j + 2]; s.data[i + 3] = 255; }
fs.writeFileSync(out, PNG.sync.write(s));
console.log('crop', out, `src ${ca.width}x${ca.height} | clone ${cb.width}x${cb.height}`);
