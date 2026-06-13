#!/usr/bin/env node
// @purpose _vj-statepin-selftest.mjs — pins the three VJ-PIN judge-fairness fixes in vision-judge.mjs
// (2026-06-12; the clerk run lost ~10 severity points to pure capture artifacts):
//   (1) cookie/consent overlays dismissed inside captureFull (phantom unmatched band + sev4/5 calls),
//   (2) animations/marquees frozen at a DETERMINISTIC pose — identical across two captures (the source
//       marquee captured at a different rotation phase than the clone's frozen frame = wrong-logos sev4s),
//       WITHOUT losing finite entrance-animation end states (commitStyles guard: a bare animation:none
//       would snap an opacity-0-base hero back to invisible),
//   (3) burned SRC/CLONE labels moved into a dedicated LABEL_STRIP above the content — labels NEVER
//       overlay page pixels (the old corner burn-in produced a false "clipped text" defect).
// Default run = UNIT (composeTile strip) + FIXTURE (local file:// page with a keyword-less consent banner,
// an infinite CSS marquee, and a finished fill-forwards entrance fade) — no network, no WordPress.
// --live additionally re-tiles the clerk.com source twice (the round's acceptance check: no cookie banner
// in any tile, marquee byte-deterministic across two captures) and writes evidence tiles to /tmp/vj-statepin.
// Internal: --capture-only <url> <width> <outbase> (used to spawn an UNPINNED control via VJ_NO_STATE_PIN=1).
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import { captureFull, composeTile, LABEL_STRIP } from './vision-judge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.join(HERE, '_vj-statepin-selftest.mjs');
const OUT = '/tmp/vj-statepin';
const CONSENT = /we use cookies|uses cookies|cookie policy|cookie preferences/i;

// ── internal child mode: capture once (state pinning per env) and write png+meta ───────────────────────────
if (process.argv.includes('--capture-only')) {
  const i = process.argv.indexOf('--capture-only');
  const [url, width, outbase] = process.argv.slice(i + 1, i + 4);
  const cap = await captureFull(url, +width, true);
  fs.writeFileSync(outbase + '.png', PNG.sync.write(cap.png));
  fs.writeFileSync(outbase + '.meta.json', JSON.stringify({ leaves: cap.leaves, bands: cap.bands, state: cap.state }, null, 1));
  process.exit(0);
}

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
fs.mkdirSync(OUT, { recursive: true });

// ── 1. UNIT: composeTile label strip — labels live OUTSIDE the content pixels ──────────────────────────────
{
  const solid = (w, h, [r, g, b]) => { const p = new PNG({ width: w, height: h }); for (let i = 0; i < p.data.length; i += 4) { p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255; } return p; };
  const src = solid(120, 80, [255, 255, 255]), cln = solid(100, 60, [255, 255, 255]);
  const tile = composeTile(src, cln, 1440, 0);
  check('unit: canvas extended by LABEL_STRIP', tile.height === 80 + LABEL_STRIP, `h=${tile.height}`);
  const px = (x, y) => { const i = (y * tile.width + x) << 2; return [tile.data[i], tile.data[i + 1], tile.data[i + 2]]; };
  let srcClean = true, clnClean = true, stripHasLabel = false, stripBlackBase = true;
  for (let y = LABEL_STRIP; y < LABEL_STRIP + 80; y++) for (let x = 0; x < 120; x++) { const [r, g, b] = px(x, y); if (r !== 255 || g !== 255 || b !== 255) srcClean = false; }
  for (let y = LABEL_STRIP; y < LABEL_STRIP + 60; y++) for (let x = 120 + 14; x < 120 + 14 + 100; x++) { const [r, g, b] = px(x, y); if (r !== 255 || g !== 255 || b !== 255) clnClean = false; }
  for (let y = 0; y < LABEL_STRIP; y++) for (let x = 0; x < tile.width; x++) { const [r, g, b] = px(x, y); if (r === 255 && g === 255 && b === 255) stripHasLabel = true; else if (!(r === 0 && g === 0 && b === 0) && !(r === 255 && g === 0 && b === 220)) stripBlackBase = false; }
  check('unit: SOURCE content pixels untouched by labels', srcClean);
  check('unit: CLONE content pixels untouched by labels', clnClean);
  check('unit: labels rendered inside the strip', stripHasLabel && stripBlackBase);
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
const clampCrop = (png, b) => {
  const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y);
  const x1 = Math.min(png.width, b.x + b.w), y1 = Math.min(png.height, b.y + b.h);
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  const out = new PNG({ width: x1 - x0, height: y1 - y0 });
  for (let r = 0; r < out.height; r++) { const s = (((y0 + r) * png.width + x0) << 2); png.data.copy(out.data, ((r * out.width) << 2), s, s + (out.width << 2)); }
  return out;
};
const samePixelFrac = (a, b) => {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return 0;
  let same = 0, total = a.width * a.height;
  for (let i = 0; i < a.data.length; i += 4) if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2]) same++;
  return same / total;
};
const bandStd = (png, y0, y1) => { let s = 0, s2 = 0, n = 0; for (let y = Math.max(0, y0); y < Math.min(png.height, y1); y += 2) for (let x = 0; x < png.width; x += 2) { const i = (y * png.width + x) << 2; const L = 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2]; s += L; s2 += L * L; n++; } if (!n) return 0; const m = s / n; return Math.sqrt(Math.max(0, s2 / n - m * m)); };
const captureUnpinned = (url, width, outbase) => {
  execFileSync('node', [SELF, '--capture-only', url, String(width), outbase], { env: { ...process.env, VJ_NO_STATE_PIN: '1' }, stdio: ['ignore', 'ignore', 'inherit'], timeout: 300000 });
  return { png: PNG.sync.read(fs.readFileSync(outbase + '.png')), ...JSON.parse(fs.readFileSync(outbase + '.meta.json', 'utf8')) };
};

// ── 2. FIXTURE: keyword-less consent banner + infinite marquee + finished entrance fade ────────────────────
{
  const fix = path.join(OUT, 'fixture.html');
  fs.writeFileSync(fix, `<!doctype html><html><head><style>
    body{margin:0;font-family:sans-serif}
    .hero{height:300px;background:#fff;display:flex;align-items:center;justify-content:center}
    .hero h1{opacity:0;animation:fadeIn .4s ease forwards;font-size:48px;color:#111}
    @keyframes fadeIn{to{opacity:1}}
    .marquee{height:200px;background:#f5f5f5;overflow:hidden;display:flex;align-items:center}
    .strip{display:flex;gap:24px;animation:scroll 7s linear infinite;width:max-content}
    @keyframes scroll{to{transform:translateX(-50%)}}
    .logo{width:140px;height:80px;border-radius:8px;flex:none}
    .rotband{height:100px;background:#fff;display:flex;align-items:center}
    .slot{position:relative;width:200px;height:90px;margin-left:10px}
    .rotlogo{position:absolute;inset:0;border-radius:8px;transition:opacity .3s}
    .rothidden{opacity:0}
    .filler{height:900px;background:linear-gradient(#dde,#ffd);padding:40px}
    .notice{position:fixed;bottom:16px;left:16px;right:16px;background:#222;color:#eee;padding:18px;border-radius:10px;z-index:150;display:flex;justify-content:space-between;align-items:center}
  </style></head><body>
    <div class="hero"><h1>Entrance Fade Headline Stays Visible</h1></div>
    <div class="marquee"><div class="strip">${['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#9b5de5', '#00b4d8', '#ef476f', '#06d6a0'].map((c) => `<div class="logo" style="background:${c}"></div>`).join('').repeat(2)}</div></div>
    <div class="rotband"><div class="slot"><div class="rotlogo" style="background:#222428"></div><div class="rotlogo rothidden" style="background:#c1121f"></div></div></div>
    <div class="filler"><p>Plenty of regular page content lives in this band for the leaf extractor.</p></div>
    <div class="notice"><span>We use cookies to improve your experience. Read our cookie policy for details.</span><button onclick="this.closest('.notice').remove()">Accept</button></div>
    <script>const rl=document.querySelectorAll('.rotlogo');setInterval(()=>{rl[0].classList.toggle('rothidden');rl[1].classList.toggle('rothidden');},700);</script>
  </body></html>`);
  const url = 'file://' + fix;

  console.log('[fixture] pinned capture A...');
  const A = await captureFull(url, 800, true);
  console.log('[fixture] pinned capture B...');
  const B = await captureFull(url, 800, true);
  console.log('[fixture] UNPINNED control capture...');
  const U = captureUnpinned(url, 800, path.join(OUT, 'fixture-unpinned'));

  check('fixture: unpinned control still shows the banner (leaf present)', U.leaves.some((l) => CONSENT.test(l.key)));
  check('fixture: pinned capture dismissed the banner (no consent leaf)', !A.leaves.some((l) => CONSENT.test(l.key)) && !B.leaves.some((l) => CONSENT.test(l.key)));
  check('fixture: overlay action logged (keyword-less pass-A2 click)', (A.state.overlays || []).some((o) => o.action === 'clicked'), JSON.stringify(A.state.overlays));
  check('fixture: infinite marquee detected+snapped', A.state.freeze.infiniteSnapped >= 1 && A.state.freeze.marqueeBoxes.length >= 1, JSON.stringify(A.state.freeze));
  let det = true, fracMin = 1;
  for (const box of A.state.freeze.marqueeBoxes) {
    const f = samePixelFrac(clampCrop(A.png, box), clampCrop(B.png, box));
    fracMin = Math.min(fracMin, f);
    if (f < 1) det = false;
  }
  check('fixture: marquee region byte-deterministic across two pinned captures', det, `min exact-pixel frac ${fracMin.toFixed(4)}`);
  // entrance fade: hero band (y 0-300) must be PAINTED (commitStyles guard) — animation:none alone leaves it blank
  const heroStd = bandStd(A.png, 0, 300);
  check('fixture: finished entrance fade stays visible (hero band painted)', heroStd > 8, `lumaStd ${heroStd.toFixed(1)}`);
  // class-toggle rotator (clerk "Trusted by" wall mechanism): must be pinned to the DOM-FIRST member — both
  // captures show the dark #222428 logo (never the red #c1121f phase) and the region is byte-identical.
  check('fixture: stacked class-toggle rotator detected+pinned', (A.state.freeze.rotatorsPinned || []).length >= 1, JSON.stringify(A.state.freeze.rotatorsPinned));
  const rotBox = { x: 10, y: 505, w: 200, h: 90 }; // .rotband at y 500-600, slot at margin-left 10
  const rA = clampCrop(A.png, rotBox), rB = clampCrop(B.png, rotBox);
  let rSum = 0, rN = 0; for (let i = 0; i < rA.data.length; i += 4) { rSum += rA.data[i]; rN++; }
  const rotMeanRed = rSum / rN;
  check('fixture: rotator pinned to dom-first member (dark, not red) in both captures', samePixelFrac(rA, rB) === 1 && rotMeanRed < 100, `mean red ${rotMeanRed.toFixed(0)}, exact frac ${samePixelFrac(rA, rB).toFixed(4)}`);
  check('fixture: full page byte-deterministic across two pinned captures', samePixelFrac(A.png, B.png) === 1, `frac ${samePixelFrac(A.png, B.png).toFixed(5)}`);
  fs.writeFileSync(path.join(OUT, 'fixture-pinned-A.png'), PNG.sync.write(A.png));
  fs.writeFileSync(path.join(OUT, 'fixture-tile.png'), PNG.sync.write(composeTile(clampCrop(A.png, { x: 0, y: 0, w: A.png.width, h: 900 }), clampCrop(B.png, { x: 0, y: 0, w: B.png.width, h: 900 }), 800, 0)));
}

// ── 3. LIVE (--live): re-tile the clerk.com source — the round's acceptance evidence ───────────────────────
if (process.argv.includes('--live')) {
  const url = process.argv[process.argv.indexOf('--live') + 1] || 'https://clerk.com';
  console.log(`[live] pinned source capture A (${url} @1440)...`);
  const A = await captureFull(url, 1440, true);
  console.log('[live] pinned source capture B...');
  const B = await captureFull(url, 1440, true);
  check('live: no consent leaf in either pinned capture', !A.leaves.some((l) => CONSENT.test(l.key)) && !B.leaves.some((l) => CONSENT.test(l.key)));
  console.log(`[live] state A: overlays=${JSON.stringify(A.state.overlays)} freeze=${JSON.stringify({ ...A.state.freeze, marqueeBoxes: A.state.freeze.marqueeBoxes.length })}`);
  let fracMin = 1, boxes = 0;
  for (const box of A.state.freeze.marqueeBoxes.slice(0, 12)) {
    const ca = clampCrop(A.png, box), cb = clampCrop(B.png, box);
    if (!ca || !cb) continue;
    boxes++;
    fracMin = Math.min(fracMin, samePixelFrac(ca, cb));
  }
  check('live: frozen marquee/animated regions deterministic across two captures', boxes === 0 || fracMin >= 0.995, `${boxes} boxes, min exact-pixel frac ${fracMin.toFixed(4)}`);
  check('live: page heights stable across captures', Math.abs(A.png.height - B.png.height) <= 8, `${A.png.height} vs ${B.png.height}`);
  if (A.png.height === B.png.height) {
    const frac = samePixelFrac(A.png, B.png);
    check('live: full-page agreement across two pinned captures >= 0.998 (rotators pinned)', frac >= 0.998, `exact-pixel frac ${frac.toFixed(5)}, rotators pinned ${(A.state.freeze.rotatorsPinned || []).length}`);
  }
  // evidence tiles: capture-A | capture-B side-by-side for the top band and the bottom band (where a live
  // fixed banner paints in full-page shots) — labels in the strip, content untouched.
  const w = A.png.width;
  fs.writeFileSync(path.join(OUT, 'clerk-tile-top.png'), PNG.sync.write(composeTile(clampCrop(A.png, { x: 0, y: 0, w, h: 900 }), clampCrop(B.png, { x: 0, y: 0, w: B.png.width, h: 900 }), 1440, 0, { src: 'CAP A 1440PX Y0', clone: 'CAP B 1440PX' })));
  fs.writeFileSync(path.join(OUT, 'clerk-tile-bottom.png'), PNG.sync.write(composeTile(clampCrop(A.png, { x: 0, y: A.png.height - 900, w, h: 900 }), clampCrop(B.png, { x: 0, y: B.png.height - 900, w: B.png.width, h: 900 }), 1440, A.png.height - 900, { src: 'CAP A BOTTOM', clone: 'CAP B BOTTOM' })));
  fs.writeFileSync(path.join(OUT, 'clerk-A.png'), PNG.sync.write(A.png));
  fs.writeFileSync(path.join(OUT, 'clerk-B.png'), PNG.sync.write(B.png));
  console.log(`[live] evidence tiles -> ${OUT}/clerk-tile-{top,bottom}.png`);
}

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
process.exit(failed ? 1 : 0);
