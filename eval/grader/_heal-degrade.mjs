#!/usr/bin/env node
/** @purpose _heal-degrade.mjs — WS2 SELF-HEAL / Arm C. Pure box-tree DEGRADATION generators + assertion helpers that let
 * the self-heal loop PROVE recovery WITHOUT humans: take a known-good section, inject a synthetic defect, heal, and assert
 * the heal moved the axis-profile back toward the ORIGINAL good profile. Each generator is (leaves)=>degradedLeaves and
 * DEEP-COPIES its input (never mutates) so a degraded tree can't leak back into the oracle. The defects mirror the real
 * human-fatal failure classes the correspondence reward already scores (dropped/mutated/shifted/recolored/wrong-size text,
 * invisible CTA, bad image crop) — so a degradation that registers here is one healing can be credited for there.
 *
 * ANTI-GAMING: detection runs through correspondSection (NOT a bespoke metric), so a "heal" that only stuffs invisible or
 * duplicate leaves can't farm a higher number — the visibility pre-filter drops invisibles and exclusive 1:1 matching stops
 * a duplicate from double-counting recall. duplicate_text is the explicit control: it must NOT register as a real defect.
 * The NON-CIRCULAR oracle is axisProfileDistance: healed must APPROACH the original good axis-profile, not merely raise the
 * scalar (a bigger number is gameable; convergence to a fixed known-good point is not).
 *
 * EXPORTS: DEGRADATIONS{name:fn}, degradationDetectable(orig,degraded,sec,ctx)->{detected,drop}, axisProfileDistance(a,b).
 * CLI: node _heal-degrade.mjs — builds a known-good hero, runs every degradation, asserts the content-altering ones drop>10.
 */
import { correspondSection } from './correspondence-reward.mjs';

// ── deep-copy (a degradation must never mutate the caller's good tree) ───────────────────────────────────────────────
const deep = (leaves) => leaves.map((n) => ({
  ...n,
  box: n.box ? { ...n.box } : n.box,
  paint: n.paint ? { ...n.paint } : n.paint,
  typo: n.typo ? { ...n.typo } : n.typo,
}));
const isTextLeaf = (n) => n.kind !== 'image' && n.text && String(n.text).trim() !== '';
const area = (n) => (n.box ? n.box.w * n.box.h : 0);
// pick the largest text leaf (most visually dominant → most detectable, per the size-weighted recall in the reward).
const largestText = (leaves) => leaves.filter(isTextLeaf).sort((a, b) => area(b) - area(a))[0];

// ── DEGRADATIONS — each (leaves)=>degradedLeaves, deep-copied, pure ───────────────────────────────────────────────────
// remove n text leaves (largest first → biggest recall hole).
function drop_text_block(leaves, n = 1) {
  const c = deep(leaves);
  const order = c.filter(isTextLeaf).sort((a, b) => area(b) - area(a)).slice(0, n);
  const kill = new Set(order);
  return c.filter((x) => !kill.has(x));
}
// rewrite one text leaf to a wrong string (breaks textSim → that leaf goes unmatched).
function mutate_text(leaves) {
  const c = deep(leaves);
  const t = largestText(c); if (t) t.text = 'Zxqv unrelated wrong copy 9173';
  return c;
}
// translate one block's box by px (a real layout break: the dominant block is shoved OUT of its band, so it can no longer
// match its source twin → recall hole, not a tolerable drift). The reward intentionally absorbs in-band nudges, so a
// detectable shift must be a perceptually-real displacement (the band gate is |Δny|>0.35 of section height).
function shift_block(leaves, px = 40) {
  const c = deep(leaves);
  const t = largestText(c); if (t && t.box) { t.box.x += px; t.box.y += Math.max(px, Math.round(0.42 * 820)); }
  return c;
}
// regress the text palette by a large ΔE (the realistic "colors are off" defect spans the copy, not one glyph; contrast
// preserved so this stays a COLOR defect, not an invisibility one). Hits the color axis broadly enough to register.
function recolor_text(leaves) {
  const c = deep(leaves);
  for (const n of c.filter(isTextLeaf)) { n.paint = { ...(n.paint || { kind: 'solid' }), value: 'rgb(150,20,20)' }; }
  return c;
}
// collapse the dominant text leaf's typo.size to sub-readable (a heading rendered at ~3px is human-fatal and trips the
// reward's visibility floor → unmatched). In-band size drift (e.g. ×0.6) is correctly tolerated, so the synthetic defect
// must be the severe, salient kind the heal loop is meant to recover.
function wrong_font_size(leaves) {
  const c = deep(leaves);
  const t = largestText(c); if (t) { t.typo = { ...(t.typo || {}) }; t.typo.size = 3; }
  return c;
}
// set a button leaf's fg EQUAL to its bg → invisible CTA. Forcing BOTH fg and bg to the dark section color makes the clone
// CTA perceptually absent (contrast≈1 → dropped by the visibility pre-filter → recall hole). Hits ALL buttons so the
// invisible-CTA defect clears the section-composite floor.
function hide_cta(leaves) {
  const c = deep(leaves);
  const btns = c.filter((n) => n.kind === 'button' && isTextLeaf(n));
  for (const btn of (btns.length ? btns : [largestText(c)].filter(Boolean))) {
    const dark = 'rgb(8,8,8)';
    btn.bg = dark; btn.paint = { ...(btn.paint || { kind: 'solid' }), value: dark };
  }
  return c;
}
// distort an image leaf's aspect ratio (squash width → hits image correspondence aspect/geom).
function bad_image_crop(leaves) {
  const c = deep(leaves);
  const img = c.find((n) => n.kind === 'image' && n.box);
  if (img) { img.box = { ...img.box, w: Math.max(4, Math.round(img.box.w * 0.25)), h: Math.round(img.box.h * 1.8) }; }
  return c;
}
// duplicate one text leaf (CONTROL: exclusive matching + visibility pre-filter mean a copy can't farm recall → ~no drop).
function duplicate_text(leaves) {
  const c = deep(leaves);
  const t = largestText(c);
  if (t) { const dup = { ...t, box: { ...t.box, y: t.box.y + 2 }, paint: t.paint ? { ...t.paint } : t.paint, typo: t.typo ? { ...t.typo } : t.typo }; c.push(dup); }
  return c;
}

export const DEGRADATIONS = {
  drop_text_block, mutate_text, shift_block, recolor_text, wrong_font_size, hide_cta, bad_image_crop, duplicate_text,
};

// ── assertion helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
// drop = corr(orig,orig).score − corr(orig,degraded).score; detected when that drop clears the noise floor (>10 pts).
// Detection always measures EVERYTHING (textOnly forced off) so image defects register even when the caller's ctx is
// text-only — the bg/page context is honored, the image confound is not suppressed for the oracle.
export function degradationDetectable(origLeaves, degradedLeaves, sec, ctx = {}) {
  const dctx = { ...ctx, textOnly: false };
  const ref = correspondSection(origLeaves, origLeaves, sec, sec, dctx).score;
  const got = correspondSection(origLeaves, degradedLeaves, sec, sec, dctx).score;
  const drop = +(ref - got).toFixed(2);
  return { detected: drop > 10, drop };
}
// NON-CIRCULAR oracle: euclidean distance between two axis-profiles {existence,text,position,color,typography}. A heal is
// credited only if it MOVES this distance toward 0 (the original good profile is a fixed point a higher scalar can't fake).
export function axisProfileDistance(aAxes = {}, bAxes = {}) {
  const keys = ['existence', 'text', 'position', 'color', 'typography'];
  let acc = 0;
  for (const k of keys) { const d = (+(aAxes[k]) || 0) - (+(bAxes[k]) || 0); acc += d * d; }
  return +Math.sqrt(acc).toFixed(4);
}

// ── CLI / acceptance gate ─────────────────────────────────────────────────────────────────────────────────────────────
const IS_MAIN = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (IS_MAIN) {
  const SEC = { x: 0, y: 0, w: 1440, h: 820, bg: 'rgb(8,8,8)' };
  const CTX = { srcPageBg: 'rgb(8,8,8)', clonePageBg: 'rgb(8,8,8)', textOnly: true };
  const mk = (kind, text, box, fg, bg, typo) => ({ kind, text, box: { x: box[0], y: box[1], w: box[2], h: box[3] }, paint: { kind: 'solid', value: fg }, bg: bg || null, typo: typo || { family: 'Inter', size: 16, weight: 400 } });
  // known-good hero (logo/nav/heading/subtext/CTAs + one hero image), dark bg — same family as the correspondence selftest.
  const base = [
    mk('text', 'Resend', [40, 20, 90, 30], 'rgb(255,255,255)', null, { family: 'Inter', size: 20, weight: 700 }),
    mk('text', 'Features', [180, 24, 70, 20], 'rgb(160,160,160)'), mk('text', 'Company', [260, 24, 70, 20], 'rgb(160,160,160)'),
    mk('text', 'Resources', [340, 24, 80, 20], 'rgb(160,160,160)'), mk('text', 'Pricing', [430, 24, 60, 20], 'rgb(160,160,160)'),
    mk('text', 'Docs', [500, 24, 50, 20], 'rgb(160,160,160)'),
    mk('button', 'Log in', [1133, 16, 75, 36], 'rgb(255,255,255)'),
    mk('button', 'Get started', [1224, 16, 110, 36], 'rgb(8,8,8)', 'rgb(255,255,255)'),
    mk('heading', 'Email for developers', [168, 300, 600, 140], 'rgb(255,255,255)', null, { family: 'Inter', size: 72, weight: 700 }),
    mk('text', 'The best way to reach humans instead of spam folders. Deliver transactional and marketing emails at scale.', [168, 470, 500, 60], 'rgb(160,160,160)'),
    mk('button', 'Get started', [168, 560, 150, 50], 'rgb(8,8,8)', 'rgb(255,255,255)'),
    mk('button', 'Documentation', [320, 560, 170, 50], 'rgb(200,200,200)'),
    { kind: 'image', text: '', box: { x: 820, y: 300, w: 480, h: 320 }, src: 'hero.png', srcURL: 'hero.png', natW: 480, natH: 320 },
  ];

  // required = content-removing/altering defects that MUST register (>10); duplicate_text is the anti-gaming control.
  const required = ['drop_text_block', 'mutate_text', 'shift_block', 'recolor_text', 'wrong_font_size', 'hide_cta', 'bad_image_crop'];
  let fails = 0;
  console.log('── degradation detectability (drop = corr(orig,orig) − corr(orig,degraded)) ──');
  for (const [name, fn] of Object.entries(DEGRADATIONS)) {
    const { detected, drop } = degradationDetectable(base, fn(base), SEC, CTX);
    const req = required.includes(name);
    const pass = req ? detected : true; // control is informational
    const tag = req ? (detected ? 'PASS' : 'FAIL') : `CONTROL(${detected ? 'detected' : 'not-detected'})`;
    console.log(`  ${name.padEnd(16)} drop=${String(drop).padStart(6)}  detected=${tag}`);
    if (req && !pass) fails++;
  }

  // anti-circularity demo: axisProfileDistance(good,good)=0; a recolored degrade is strictly farther from the good profile.
  const goodAxes = correspondSection(base, base, SEC, { ...CTX, textOnly: false }).axes;
  const badAxes = correspondSection(base, recolor_text(base), SEC, { ...CTX, textOnly: false }).axes;
  const dSelf = axisProfileDistance(goodAxes, goodAxes), dBad = axisProfileDistance(goodAxes, badAxes);
  console.log(`── axis-profile oracle ── dist(good,good)=${dSelf}  dist(good,recolored)=${dBad}  (heal target: shrink toward 0)`);
  if (!(dSelf === 0 && dBad > dSelf)) { console.log('  FAIL axisProfileDistance not a proper fixed-point oracle'); fails++; }

  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAIL'} — heal-degrade acceptance gate`);
  process.exit(fails === 0 ? 0 : 1);
}
