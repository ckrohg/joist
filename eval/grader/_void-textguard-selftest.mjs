/**
 * @purpose Deterministic, network-free self-test for the content-void TEXT-GUARD (grade-sections.mjs classifyVoid).
 * Proves: (1) SELFTEST clone==source → never a void (no-op). (2) FALSE-POSITIVE FIX: a dark + sparse-bright band
 * the clone reproduced the text of (framer S6/S16 shape) is NO LONGER flagged a void. (3) ANTI-GAMING preserved:
 * a TEXTLESS imagery void, a BLANK clone band (no reproduced text), and a partially-reproduced band still flag as
 * voids. (4) REVERSIBILITY: with textGuard=false, behaviour == the old energy-only test (the false-positive returns).
 * Pure-function harness; launches no browser. Run: node _void-textguard-selftest.mjs
 */
import { classifyVoid } from './grade-sections.mjs';

let pass = true;
const log = (ok, msg) => { if (!ok) pass = false; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

// Energy thresholds in grade-sections.mjs: VOID_SRC_CONTENT 0.06, VOID_CLONE_FLOOR 0.30, VOID_BG_ABS 0.020.
// A "dark sparse-bright headline" band: source has real content energy (nav painted across + headline), clone band
// is near-background energy (dark hero, thin white headline) → energy condition TRUE. The headline text, however,
// IS reproduced by the clone. framer S6/S16 measured srcEnergy ~0.39, cloneEnergy ~0.0 in the failing round.
const darkHeadline = { srcEnergy: 0.394, cloneEnergy: 0.004 };

// ── T1: SELFTEST no-op ──
log(classifyVoid({ srcEnergy: 0.394, cloneEnergy: 0.394, cloneReproducedBandText: false, selftest: true }) === false,
  'T1 selftest: clone==source → never a void (selftest short-circuit)');

// ── T2: FALSE-POSITIVE FIX (the bug) — dark headline the clone reproduced is NOT a void ──
log(classifyVoid({ ...darkHeadline, cloneReproducedBandText: true, textGuard: true }) === false,
  'T2 false-pos FIX: dark+sparse-bright band whose text the clone reproduced → NOT a void (guard fires)');

// ── T3: ANTI-GAMING — genuine voids still flagged ──
// (a) textless imagery void (logos/cards, no source text → cloneReproducedBandText false): still a void
log(classifyVoid({ srcEnergy: 0.30, cloneEnergy: 0.005, cloneReproducedBandText: false, textGuard: true }) === true,
  'T3a anti-gaming: textless imagery void (no reproduced text) → STILL a void');
// (b) blank clone band where source HAS text but clone reproduced none (cloneReproducedBandText false): still a void
log(classifyVoid({ srcEnergy: 0.20, cloneEnergy: 0.003, cloneReproducedBandText: false, textGuard: true }) === true,
  'T3b anti-gaming: source-has-text but clone reproduced NONE → STILL a void (missing content)');
// (c) the guard must NOT fire on a content-bearing clone (high clone energy → energy condition already false)
log(classifyVoid({ srcEnergy: 0.30, cloneEnergy: 0.25, cloneReproducedBandText: false, textGuard: true }) === false,
  'T3c control: clone rendered content (high energy) → not a void regardless of guard');

// ── T4: REVERSIBILITY — textGuard=false restores the energy-only over-firing ──
log(classifyVoid({ ...darkHeadline, cloneReproducedBandText: true, textGuard: false }) === true,
  'T4 reversible: with textGuard OFF, the dark-headline band is a void again (== old energy-only behaviour)');
// and OFF must be byte-equivalent to the energy-only predicate across a grid of cases
{
  const VOID_SRC_CONTENT = 0.06, VOID_CLONE_FLOOR = 0.30, VOID_BG_ABS = 0.020;
  const energyOnly = (s, c) => s >= VOID_SRC_CONTENT && c <= VOID_CLONE_FLOOR * s && c <= VOID_BG_ABS;
  let mism = 0, n = 0;
  for (let s = 0; s <= 0.5; s += 0.013) for (let c = 0; c <= 0.1; c += 0.003) for (const rep of [true, false]) {
    n++;
    if (classifyVoid({ srcEnergy: s, cloneEnergy: c, cloneReproducedBandText: rep, textGuard: false }) !== energyOnly(s, c)) mism++;
  }
  log(mism === 0, `T4 reversible: textGuard=OFF == energy-only predicate across ${n} cases (mismatches ${mism})`);
}

console.log(pass ? '\nVOID-TEXTGUARD SELFTEST: ALL PASS' : '\nVOID-TEXTGUARD SELFTEST: FAIL');
process.exit(pass ? 0 : 1);
