// @purpose lib.mjs — shared exemplar-store helpers (EMBODIMENT_APPROACH §P3): deterministic visual
// descriptor from a PNG (palette + density tags — the SAME function keys records and queries, so
// retrieval compares like with like), sha256 hashing, record IO. Pure node + pngjs. No timestamps,
// no randomness: same input → same output.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

export const STORE = path.dirname(fileURLToPath(import.meta.url));

export const sha256File = (file) => 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// ── deterministic visual descriptor ────────────────────────────────────────────────────────────────
// Quantize to 3 bits/channel (512 buckets), sample a fixed grid (~max 200k px), rank buckets.
export function describePng(pngFile) {
  const png = PNG.sync.read(fs.readFileSync(pngFile));
  const { width: w, height: h, data } = png;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 200000)));
  const buckets = new Map(); // key -> { n, r, g, b }
  let n = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      let bk = buckets.get(key);
      if (!bk) buckets.set(key, (bk = { n: 0, r: 0, g: 0, b: 0 }));
      bk.n++; bk.r += r; bk.g += g; bk.b += b; n++;
    }
  }
  const ranked = [...buckets.entries()]
    .sort((a, b2) => b2[1].n - a[1].n || a[0] - b2[0]) // count desc, bucket-key asc tiebreak
    .slice(0, 3)
    .map(([, bk]) => ({ share: bk.n / n, r: Math.round(bk.r / bk.n), g: Math.round(bk.g / bk.n), b: Math.round(bk.b / bk.n) }));
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const palette = ranked.map(hex);

  // density tags
  const bg = ranked[0];
  const luma = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const bgLuma = luma(bg);
  const tags = [bgLuma < 80 ? 'dark-bg' : bgLuma > 180 ? 'light-bg' : 'mid-bg'];
  // ink coverage: fraction of sampled pixels far from the dominant bg color
  let ink = 0, satSum = 0, satN = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const d = Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b);
      if (d > 90) {
        ink++;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        satSum += mx === 0 ? 0 : (mx - mn) / mx; satN++;
      }
    }
  }
  const inkFrac = ink / n;
  tags.push(inkFrac < 0.08 ? 'sparse' : inkFrac < 0.25 ? 'medium' : 'dense');
  tags.push((satN ? satSum / satN : 0) > 0.35 ? 'colorful' : 'muted');
  tags.push(h < w * 0.25 ? 'wide-band' : h < w * 0.75 ? 'banner' : 'tall');
  return { palette, densityTags: tags, size: { w, h }, inkFrac: +inkFrac.toFixed(4), bgShare: +bg.share.toFixed(4) };
}

// ── record IO ───────────────────────────────────────────────────────────────────────────────────────
export function loadRecords() {
  const dir = path.join(STORE, 'records');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

export function validateRecord(rec, schema) {
  // minimal structural check (no ajv dep): required keys + enum membership
  const errs = [];
  for (const k of schema.required) if (!(k in rec)) errs.push(`missing ${k}`);
  const cEnum = new Set(schema.properties.constructIds.items.enum);
  for (const c of rec.constructIds || []) if (!cEnum.has(c)) errs.push(`unknown construct ${c}`);
  const pEnum = new Set(schema.properties.provenance.enum);
  if (rec.provenance && !pEnum.has(rec.provenance)) errs.push(`bad provenance ${rec.provenance}`);
  const vEnum = new Set(schema.properties.verification.properties.status.enum);
  if (rec.verification && !vEnum.has(rec.verification.status)) errs.push(`bad verification.status`);
  if (rec.hash && !/^sha256:[0-9a-f]{64}$/.test(rec.hash)) errs.push('bad hash');
  return errs;
}
