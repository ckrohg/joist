#!/usr/bin/env node
// @purpose DIFFERENTIAL EQUIVALENCE TEST — proves cta-paint.buttonPaint (the shared extraction) produces
// BYTE-IDENTICAL output to the frozen verbatim copy of build-absolute.mjs's original buttonPaint, over a battery
// of REAL captured CTA leaves (/tmp/cap-cand-*, /tmp/heal-cap-*) plus synthetic leaves spanning every paint class
// (solid / gradient / border / shadow-pill / null / tag-only / long-text), across DEINLINE on+off and the nowrap
// flag. This is the offline gate that makes the build-absolute delegation swap safe WITHOUT a live build: if every
// leaf maps to the same string, replacing the inline copy with an import of cta-paint.mjs cannot change builder
// output by construction. Run: node _cta-paint-equiv.mjs  (exit 0 = byte-identical everywhere).

import fs from 'node:fs';
import { buttonPaint as extractedPaint } from './cta-paint.mjs';
import { makeOriginalButtonPaint, originalTextColor } from './_cta-paint-original.frozen.mjs';

// guard: the load-time env flags (read in cta-paint at import) must be in the production/default state, else the
// two sides capture different flags and the comparison is meaningless. Fail loud rather than silently diverge.
for (const f of ['BUILD_NO_CTA_PAINT', 'BUILD_NO_WHITEPILL', 'ABS_NO_DEINLINE']) {
  if (process.env[f] === '1') { console.error(`REFUSE: ${f}=1 set — run the equivalence test with default flags`); process.exit(2); }
}

// ── battery: real captured button leaves + synthetic coverage of every branch ────────────────────────────────
function loadRealLeaves() {
  const out = [];
  for (const f of ['/tmp/cap-cand-1.json', '/tmp/cap-cand-2.json', '/tmp/cap-cand-3.json', '/tmp/cap-cand-4.json', '/tmp/cap-cand-5.json', '/tmp/cap-cand-6.json', '/tmp/heal-cap-806.json', '/tmp/heal-cap-807.json']) {
    let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.kind === 'button') out.push({ src: f, leaf: n });
      for (const k of Object.keys(n)) if (n[k] && typeof n[k] === 'object') walk(n[k]);
    })(j);
  }
  return out;
}
const SYNTHETIC = [
  { name: 'solid-pill', leaf: { kind: 'button', tag: 'a', text: 'Get started', bg: 'rgb(108, 71, 255)', bgImage: null, border: null, btnPad: ['10px', '20px', '10px', '20px'], radius: '8px', boxShadow: null, interactive: { role: 'button' }, paint: { kind: 'solid', value: 'rgb(255,255,255)' } } },
  { name: 'gradient-fill', leaf: { kind: 'button', tag: 'a', text: 'Start free', bg: null, bgImage: 'linear-gradient(90deg, rgb(255,0,128), rgb(128,0,255))', border: null, btnPad: ['12px', '24px', '12px', '24px'], radius: '12px', boxShadow: null, interactive: null, paint: { kind: 'solid', value: 'rgb(255,255,255)' } } },
  { name: 'solid+gradient', leaf: { kind: 'button', tag: 'button', text: 'Buy', bg: 'rgb(20,20,20)', bgImage: 'linear-gradient(#fff,#eee)', border: null, btnPad: ['8px', '16px', '8px', '16px'], radius: '6px', boxShadow: null, interactive: null, paint: { kind: 'solid', value: 'rgb(0,0,0)' } } },
  { name: 'outlined-border', leaf: { kind: 'button', tag: 'a', text: 'Learn more', bg: null, bgImage: null, border: '1px solid rgb(51, 51, 51)', btnPad: ['8px', '16px', '8px', '16px'], radius: '6px', boxShadow: null, interactive: null, paint: { kind: 'solid', value: 'rgb(51,51,51)' } } },
  { name: 'zero-border-ignored', leaf: { kind: 'button', tag: 'a', text: 'x', bg: 'rgb(10,10,10)', bgImage: null, border: '0px none rgb(0,0,0)', btnPad: ['6px', '6px', '6px', '6px'], radius: '0px', boxShadow: null, interactive: null, paint: null } },
  { name: 'shadow-pill-no-fill', leaf: { kind: 'button', tag: 'a', text: 'Add React', bg: null, bgImage: null, border: '0px', boxShadow: 'rgba(0, 0, 0, 0.1) 0px 2px 8px 0px', btnPad: ['10px', '24px', '10px', '24px'], radius: '9999px', interactive: null, paint: null } },
  { name: 'shadow-but-no-pad (null)', leaf: { kind: 'button', tag: 'a', text: 'nope', bg: null, bgImage: null, border: null, boxShadow: 'rgba(0,0,0,0.1) 0px 2px 8px', btnPad: null, radius: '8px', interactive: null, paint: null } },
  { name: 'bare-link-null', leaf: { kind: 'button', tag: 'a', text: 'Read the docs', bg: null, bgImage: null, border: null, boxShadow: null, btnPad: null, radius: '0px', interactive: null, paint: { kind: 'solid', value: 'rgb(80,80,80)' } } },
  { name: 'tag-only-null (button tag, no fill)', leaf: { kind: 'button', tag: 'button', text: 'submit', bg: null, bgImage: null, border: null, boxShadow: null, btnPad: ['4px', '4px', '4px', '4px'], radius: '0px', interactive: null, paint: null } },
  { name: 'role-only-null', leaf: { kind: 'button', tag: 'a', text: 'menu', bg: null, bgImage: null, border: null, boxShadow: null, btnPad: null, radius: '0px', interactive: { role: 'button' }, paint: null } },
  { name: 'long-text-card', leaf: { kind: 'button', tag: 'a', text: 'Agents get created automatically and you can edit them later in the dashboard whenever you want', bg: 'rgb(245,245,245)', bgImage: null, border: '1px solid rgb(220,220,220)', boxShadow: null, btnPad: ['16px', '20px', '16px', '20px'], radius: '10px', interactive: null, paint: { kind: 'solid', value: 'rgb(20,20,20)' } } },
  { name: 'gradient-text-paint (!DEINLINE color path)', leaf: { kind: 'button', tag: 'a', text: 'Go pro', bg: 'rgb(0,0,0)', bgImage: null, border: null, boxShadow: null, btnPad: ['10px', '18px', '10px', '18px'], radius: '8px', interactive: null, paint: { kind: 'gradient-text', value: 'linear-gradient(90deg,#fff,#ccc)', color: 'rgb(255,255,255)' } } },
  { name: 'non-button-kind (null)', leaf: { kind: 'text', tag: 'p', text: 'hello', bg: 'rgb(0,0,0)', paint: null } },
  { name: 'rgba-transparent-bg (not solid)', leaf: { kind: 'button', tag: 'a', text: 'ghost', bg: 'rgba(0, 0, 0, 0)', bgImage: null, border: null, boxShadow: null, btnPad: ['8px', '12px', '8px', '12px'], radius: '4px', interactive: null, paint: null } },
];

const real = loadRealLeaves();
const battery = [...SYNTHETIC, ...real.map((r, i) => ({ name: `real:${r.src.split('/').pop()}#${i}`, leaf: r.leaf }))];

let checks = 0, mismatches = 0; const detail = [];
const MATRIX = [
  { DEINLINE: true, noChromeWrap: false },
  { DEINLINE: true, noChromeWrap: true },
  { DEINLINE: false, noChromeWrap: false },
  { DEINLINE: false, noChromeWrap: true },
];
for (const { name, leaf } of battery) {
  for (const cfg of MATRIX) {
    const original = makeOriginalButtonPaint({ DEINLINE: cfg.DEINLINE, textColor: originalTextColor, NO_CHROME_WRAP: cfg.noChromeWrap })(leaf);
    // cta-paint reads ABS_NO_CHROME_WRAP from env at call time → set it around the call to vary that branch.
    const saved = process.env.ABS_NO_CHROME_WRAP;
    if (cfg.noChromeWrap) process.env.ABS_NO_CHROME_WRAP = '1'; else delete process.env.ABS_NO_CHROME_WRAP;
    const extracted = extractedPaint(leaf, { DEINLINE: cfg.DEINLINE, textColor: originalTextColor });
    if (saved === undefined) delete process.env.ABS_NO_CHROME_WRAP; else process.env.ABS_NO_CHROME_WRAP = saved;
    checks++;
    if (original !== extracted) {
      mismatches++;
      detail.push(`MISMATCH ${name} [DEINLINE=${cfg.DEINLINE} nowrap=${cfg.noChromeWrap}]\n  orig: ${original}\n  ext : ${extracted}`);
    }
  }
}

console.log(`cta-paint differential equivalence: ${checks} comparisons over ${battery.length} leaves (${real.length} real, ${SYNTHETIC.length} synthetic) × ${MATRIX.length} configs`);
if (mismatches) { console.error(`\n✗ ${mismatches} MISMATCH(es):\n` + detail.join('\n')); process.exit(1); }

// ── NAMED-RISK GUARD (fusion §4): the !DEINLINE→textColor line is reached ONLY under ABS_NO_DEINLINE=1, so it
// would pass the golden-pin, every default-env fixture, AND a live render of any normal page while silently broken.
// Assert that branch actually EXECUTES and produces color output, on both textColor sub-paths (solid + gradient-text).
let branchFails = 0;
const solidLeaf = SYNTHETIC.find((s) => s.name === 'solid-pill').leaf;
const gradTextLeaf = SYNTHETIC.find((s) => s.name.startsWith('gradient-text-paint')).leaf;
const onSolid = extractedPaint(solidLeaf, { DEINLINE: false, textColor: originalTextColor });
const onGrad = extractedPaint(gradTextLeaf, { DEINLINE: false, textColor: originalTextColor });
const offSolid = extractedPaint(solidLeaf, { DEINLINE: true, textColor: originalTextColor });
if (!/color:rgb\(255, ?255, ?255\)/.test(onSolid)) { branchFails++; console.error('✗ !DEINLINE branch did not inline solid color:', onSolid); }
if (!/color:rgb\(255, ?255, ?255\)/.test(onGrad)) { branchFails++; console.error('✗ !DEINLINE branch did not inline gradient-text color:', onGrad); }
if (/;color:/.test(offSolid)) { branchFails++; console.error('✗ DEINLINE-on leaked an inline color (should be native-only):', offSolid); }
if (branchFails) { console.error(`\n✗ ${branchFails} !DEINLINE→textColor branch assertion(s) failed`); process.exit(1); }
console.log('✓ !DEINLINE→textColor branch executes + inlines color (solid + gradient-text); DEINLINE-on stays native-only');

// ── PERMANENT ANTI-DIVERGENCE GUARD: after the swap, build-absolute must NOT carry its own divergent buttonPaint
// body — it must delegate to the shared module. A re-introduced inline copy is exactly the drift this oracle exists
// to kill. Assert the source delegates and imports the shared paint (textual; no import of the non-import-safe file).
const baSrc = fs.readFileSync('./build-absolute.mjs', 'utf8');
let guardFails = 0;
if (!/import\s*\{\s*buttonPaint as _sharedButtonPaint\s*\}\s*from\s*'\.\/cta-paint\.mjs'/.test(baSrc)) { guardFails++; console.error('✗ build-absolute no longer imports the shared buttonPaint'); }
if (!/function buttonPaint\(n\)\s*\{\s*return _sharedButtonPaint\(n, \{ textColor \}\);\s*\}/.test(baSrc)) { guardFails++; console.error('✗ build-absolute buttonPaint is not the thin delegation (a divergent inline copy may have returned)'); }
if (guardFails) { console.error(`\n✗ ${guardFails} anti-divergence guard(s) failed`); process.exit(1); }
console.log('✓ build-absolute delegates to the shared cta-paint (no divergent inline copy)');

console.log('\n✓ BYTE-IDENTICAL everywhere — cta-paint.buttonPaint ≡ build-absolute original. Delegation swap is safe by construction.');
process.exit(0);
