#!/usr/bin/env node
/** @purpose _correspondence-selftest.mjs — the WS1 validation GATE for correspondence-reward.mjs. The existing
 * degradation ladders are IMAGE mutations (no DOM), so correspondence (which needs box-trees) is gated on BOX-TREE
 * mutation ladders + the fusion-specified Goodhart/degenerate tests. All deterministic, no network. Exit 1 on any fail.
 * Asserts: strict-monotone L0>L1>L2>L3>L4 + spread; axis-sanity (desaturation hits color not recall; invisible-heading
 * contrast-gate -> color~0; blank-hero drops recall); degenerate guards (rasterized=0 text, one-giant-leaf can't farm
 * recall, exclusivity, section-local position survives a 1.5x-taller clone). */
import { correspondSection } from './correspondence-reward.mjs';

let fails = 0; const ok = (name, cond, extra = '') => { console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++; };
const SEC = { x: 0, y: 0, w: 1440, h: 820, bg: 'rgb(8,8,8)' };
const CTX = { srcPageBg: 'rgb(8,8,8)', clonePageBg: 'rgb(8,8,8)' };
const mk = (kind, text, box, fg, bg, typo) => ({ kind, text, box: { x: box[0], y: box[1], w: box[2], h: box[3] }, paint: { kind: 'solid', value: fg }, bg: bg || null, typo: typo || { family: 'Inter', size: 16, weight: 400 } });

// base hero section
const base = () => [
  mk('text', 'Resend', [40, 20, 90, 30], 'rgb(255,255,255)', null, { family: 'Inter', size: 20, weight: 700 }),
  mk('text', 'Features', [180, 24, 70, 20], 'rgb(160,160,160)'), mk('text', 'Company', [260, 24, 70, 20], 'rgb(160,160,160)'),
  mk('text', 'Resources', [340, 24, 80, 20], 'rgb(160,160,160)'), mk('text', 'Pricing', [430, 24, 60, 20], 'rgb(160,160,160)'),
  mk('text', 'Docs', [500, 24, 50, 20], 'rgb(160,160,160)'),
  mk('button', 'Log in', [1133, 16, 75, 36], 'rgb(255,255,255)'), mk('button', 'Get started', [1224, 16, 110, 36], 'rgb(8,8,8)', 'rgb(255,255,255)'),
  mk('heading', 'Email for developers', [168, 300, 600, 140], 'rgb(255,255,255)', null, { family: 'Inter', size: 72, weight: 700 }),
  mk('text', 'The best way to reach humans instead of spam folders. Deliver transactional and marketing emails at scale.', [168, 470, 500, 60], 'rgb(160,160,160)'),
  mk('button', 'Get started', [168, 560, 150, 50], 'rgb(8,8,8)', 'rgb(255,255,255)'), mk('button', 'Documentation', [320, 560, 170, 50], 'rgb(200,200,200)'),
];
// mutators — L1 is a mild COLOR SHIFT (tint), not desaturation: resend's palette is monochrome, so desaturation is a
// no-op; a real "colors slightly off" defect (milder than L2 invisible-heading) nudges all fg toward a tint, ΔE~12,
// contrast preserved (visibility stays ~1 → it must hit the color axis only, not recall or visibility).
function tint(rgb, f) { const m = rgb.match(/\d+/g).map(Number); const T = [120, 140, 200]; return `rgb(${m.map((v, i) => Math.round(v * (1 - f) + T[i] * f)).join(',')})`; }
const clone = (ls) => ls.map((n) => ({ ...n, box: { ...n.box }, paint: { ...n.paint }, typo: { ...n.typo } }));
function L1(ls) { return clone(ls).map((n) => { n.paint.value = tint(n.paint.value, 0.20); return n; }); }
function L2(ls) { const c = L1(ls); const h = c.find((n) => n.kind === 'heading'); h.paint.value = SEC.bg; return c; } // invisible heading (fg=bg)
function L3(ls) { return L2(ls).filter((n) => !(n.box.y >= 290)); } // blank hero (drop heading/subline/CTAs below y290)
function L4(ls) { return L3(ls).filter((n) => n.kind === 'button' || n.box.y < 20 || n.text === 'Resend'); } // + drop nav

const B = base();
const score = (ls) => correspondSection(B, ls, SEC, SEC, CTX);
const r0 = score(clone(B)), r1 = score(L1(B)), r2 = score(L2(B)), r3 = score(L3(B)), r4 = score(L4(B));
const s = [r0, r1, r2, r3, r4].map((r) => r.score);

console.log('── ladder scores (L0..L4) ──');
console.log('  ', s.map((v, i) => `L${i}=${v}`).join('  '));
console.log('   color axis:', [r0, r1, r2, r3, r4].map((r, i) => `L${i}=${r.axes.color}`).join(' '), '| R_text:', [r0, r1, r2, r3, r4].map((r, i) => `L${i}=${r.R_text}`).join(' '));

console.log('── (A) strict monotone + spread ──');
ok('L0 > L1 > L2 > L3 > L4 (strict)', s[0] > s[1] && s[1] > s[2] && s[2] > s[3] && s[3] > s[4], `[${s.join(' > ')}]`);
ok('spread L0-L4 > 30', s[0] - s[4] > 30, `Δ=${(s[0] - s[4]).toFixed(1)}`);
ok('L0 (identity) ≈ 100', s[0] >= 95, `L0=${s[0]}`);

console.log('── (B) axis-sanity (right axis moves for the right reason) ──');
ok('mild color-shift (L1) does NOT move recall', Math.abs(r0.blockMatchF2 - r1.blockMatchF2) <= 0.02, `Δrecall=${Math.abs(r0.blockMatchF2 - r1.blockMatchF2).toFixed(3)}`);
ok('mild color-shift (L1) hits color axis', r1.axes.color <= r0.axes.color - 0.05, `color ${r0.axes.color}→${r1.axes.color}`);
ok('invisible-heading (L2) drops color below L1 (contrast gate)', r2.axes.color < r1.axes.color, `color ${r1.axes.color}→${r2.axes.color}`);
ok('blank-hero (L3) drops recall vs L2', r2.R_text - r3.R_text >= 0.20, `R_text ${r2.R_text}→${r3.R_text}`);

console.log('── (C) degenerate / Goodhart guards ──');
const raster = score([{ kind: 'image', text: '', box: { x: 0, y: 0, w: 1440, h: 820 }, src: 'x.png' }]);
ok('rasterized clone (0 text leaves) → R_text=0 + score ≤ 5', raster.R_text === 0 && raster.score <= 5, `score=${raster.score}`);
const giant = score([mk('text', B.filter((n) => n.text).map((n) => n.text).join(' '), [0, 0, 1440, 820], 'rgb(255,255,255)')]);
ok('one-giant-leaf clone cannot farm recall (R_text < 0.35)', giant.R_text < 0.35, `R_text=${giant.R_text}`);
ok('exclusivity: nMatch ≤ min(nSrc,nClone)', r0.nMatch <= Math.min(r0.nSrc, r0.nClone), `nMatch=${r0.nMatch}`);
// section-local position survives a 1.5x-taller clone section (the page-normalization deflation bug)
const tallSec = { x: 0, y: 0, w: 1440, h: 1230, bg: 'rgb(8,8,8)' };
const scaled = clone(B).map((n) => ({ ...n, box: { ...n.box, y: Math.round(n.box.y * 1.5), h: Math.round(n.box.h * 1.5) } }));
const rTall = correspondSection(B, scaled, SEC, tallSec, CTX);
ok('center elements survive a 1.5x-taller clone section (position not deflated)', rTall.axes.position >= 0.85, `position=${rTall.axes.position}`);
ok('that tall-but-correct clone still scores high (≥ 90)', rTall.score >= 90, `score=${rTall.score}`);

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAIL'} — correspondence-reward selftest`);
process.exit(fails === 0 ? 0 : 1);
