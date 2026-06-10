/**
 * @purpose Self-test for the IMG-LEAF METADATA capture feed (media-identity dim, B1 round 2, 2026-06-09).
 * capture-layout.mjs kind:'image' leaves now additionally carry srcURL (best fetchable variant:
 * currentSrc → src attr → last/highest-res srcset entry), natW/natH (naturalWidth/Height; 0 = never
 * loaded = lazy-fail signal) and objectPosition (completes objectFit). ADDITIVE ONLY.
 * CAPTURE_NO_IMGMETA=1 must reproduce the legacy output byte-identically (no new keys).
 *
 * Builds a deterministic file:// fixture (real PNG files — leaf() rejects data: URLs), runs
 * capture-layout.mjs flag-ON (default) and flag-OFF (legacy), and asserts:
 *   T1 flag-OFF output carries ZERO new keys anywhere (byte-level grep + tree walk)
 *   T2 ADDITIVE-ONLY: strip the 4 new keys from every image leaf of the flag-ON output →
 *      deep-equal (re-stringified byte-equal) to the flag-OFF output — nothing else moved
 *   T3 field correctness: loaded img natW/natH = real pixel dims + srcURL = painted variant;
 *      broken img natW=0/natH=0 (lazy-fail signal) with srcURL still resolved from the src attr;
 *      object-position style surfaces as objectPosition '25% 75%'
 *   T4 determinism: two flag-ON runs byte-identical
 *   T5 image-leaf count identical across modes (no leaf gained/lost by the feed)
 * Run: node eval/grader/_imgmeta-selftest.mjs
 */
import fs from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cap = path.join(here, 'capture-layout.mjs');

// ── fixture: real PNG files (leaf() rejects data: URLs and <8px boxes) ──────────────────────────
const dir = '/tmp/imgmeta-fixture';
fs.mkdirSync(dir, { recursive: true });
const mkPng = (file, w, h, rgb) => {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) { p.data[i * 4] = rgb[0]; p.data[i * 4 + 1] = rgb[1]; p.data[i * 4 + 2] = rgb[2]; p.data[i * 4 + 3] = 255; }
  fs.writeFileSync(file, PNG.sync.write(p));
};
mkPng(path.join(dir, 'a.png'), 64, 48, [200, 40, 40]);
mkPng(path.join(dir, 'b.png'), 120, 80, [40, 40, 200]);

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Arial;margin:40px;width:1200px}
img{display:block;margin:24px 0}
</style></head><body>
<h1>Img metadata fixture</h1>
<p>CTRLTEXT alpha beta gamma delta.</p>
<img id="plain" src="a.png" width="300" height="200" alt="plain image">
<img id="fitpos" src="b.png" width="300" height="150" style="object-fit:cover;object-position:25% 75%" alt="cropped image">
<img id="broken" src="missing-on-purpose.png" width="300" height="120" alt="never loaded">
</body></html>`;
const fix = path.join(dir, 'fixture.html');
fs.writeFileSync(fix, html);

const run = (env, out) => {
  execFileSync('node', [cap, '--source', 'file://' + fix, '--out', out], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
  return fs.readFileSync(out, 'utf8');
};

const NEW_KEYS = ['srcURL', 'natW', 'natH', 'objectPosition'];
const flatImgs = (n, out = []) => { if (!n) return out; if (n.kind === 'container') { (n.children || []).forEach((c) => flatImgs(c, out)); return out; } if (n.kind === 'image') out.push(n); return out; };
const stripNew = (n) => { if (!n) return; if (n.kind === 'image') for (const k of NEW_KEYS) delete n[k]; (n.children || []).forEach(stripNew); };

const onRaw = run({}, '/tmp/imgmeta-on.json');
const onRaw2 = run({}, '/tmp/imgmeta-on2.json');
const offRaw = run({ CAPTURE_NO_IMGMETA: '1' }, '/tmp/imgmeta-off.json');
const on = JSON.parse(onRaw), off = JSON.parse(offRaw);

let pass = 0, fail = 0;
const T = (name, cond, detail) => { if (cond) { pass++; console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`); } else { fail++; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); } };

// T1: flag-OFF output carries ZERO new keys (byte grep + tree walk)
const offImgs = flatImgs(off.root);
T('T1 flag-OFF has zero new keys', !/"srcURL"|"natW"|"natH"|"objectPosition"/.test(offRaw) && offImgs.every((l) => NEW_KEYS.every((k) => !(k in l))), `imgLeaves=${offImgs.length}`);

// T2: additive-only — flag-ON minus the 4 keys deep-equals flag-OFF
const onStripped = JSON.parse(onRaw); stripNew(onStripped.root);
T('T2 additive-only (strip new keys → byte-equal legacy)', JSON.stringify(onStripped) === JSON.stringify(off));

// T3: field correctness on the three fixture imgs
const onImgs = flatImgs(on.root);
const byAlt = (a) => onImgs.find((l) => l.alt === a);
const plain = byAlt('plain image'), fitpos = byAlt('cropped image'), broken = byAlt('never loaded');
T('T3a loaded img natural dims + srcURL', !!plain && plain.natW === 64 && plain.natH === 48 && /a\.png$/.test(plain.srcURL || ''), plain ? `natW=${plain.natW} natH=${plain.natH} srcURL=…${(plain.srcURL || '').slice(-12)}` : 'leaf missing');
T('T3b objectPosition surfaces', !!fitpos && fitpos.objectPosition === '25% 75%' && fitpos.objectFit === 'cover', fitpos ? `objectPosition=${fitpos.objectPosition}` : 'leaf missing');
T('T3c broken img: natW/natH=0 (lazy-fail signal), srcURL from src attr', !!broken && broken.natW === 0 && broken.natH === 0 && /missing-on-purpose\.png$/.test(broken.srcURL || ''), broken ? `natW=${broken.natW} srcURL=…${(broken.srcURL || '').slice(-24)}` : 'leaf missing');

// T4: determinism — two flag-ON runs byte-identical
T('T4 deterministic (two flag-ON runs byte-identical)', onRaw === onRaw2, `bytes=${onRaw.length}`);

// T5: image-leaf count identical across modes
T('T5 image-leaf count unchanged by feed', onImgs.length === offImgs.length, `on=${onImgs.length} off=${offImgs.length}`);

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
