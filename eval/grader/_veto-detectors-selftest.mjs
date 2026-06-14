#!/usr/bin/env node
/**
 * @purpose OFFLINE selftest for the GRADER-HONESTY veto-detector module (veto-detectors.mjs) + the editability
 * ladder logic. Pure synthetic fixtures (in-memory PNGs + mock ctx) — NO render, NO network, NO host access.
 *
 * Two layers:
 *   A) DETECTOR UNIT TESTS — each of the 4 vetoes gets a POSITIVE fixture (must fire) AND a NEGATIVE CONTROL
 *      (clean fixture must NOT fire). The negative control is the eval-integrity guard: a veto firing on a good
 *      clone DEFLATES the grader, the exact failure we must avoid. Also a reversibility test (GRADER_NO_VETO_*=1
 *      → that detector is a no-op) and the runVetoes aggregate contract.
 *   B) LADDER UNIT TEST — the frozen-band discount maths in isolation (a covered run inside a preserve band earns
 *      credit×FROZEN_W; a flow run earns full; NO ledger / NO preserve bands ⇒ byte-identical to legacy credit).
 *
 * Exit 0 = ALL PASS. The orchestrator re-runs this before trusting the change (builders do NOT self-bless).
 */
import { PNG } from 'pngjs';
import { runVetoes, VETO_DEFAULTS } from './veto-detectors.mjs';

let fail = 0;
const check = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!cond) fail++; };

// ---- synthetic PNG builders ----------------------------------------------------------------------------------
function solid(w, h, r, g, b) { const p = new PNG({ width: w, height: h }); for (let i = 0; i < w * h; i++) { p.data[i * 4] = r; p.data[i * 4 + 1] = g; p.data[i * 4 + 2] = b; p.data[i * 4 + 3] = 255; } return p; }
// a "content-y" image: noisy/varied pixels (high local variance + wide luminance range) over a base colour.
function noisy(w, h, base = 128, amp = 110, seed = 7) {
  const p = new PNG({ width: w, height: h }); let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < w * h; i++) { const v = Math.max(0, Math.min(255, base + (rnd() - 0.5) * 2 * amp)); p.data[i * 4] = v; p.data[i * 4 + 1] = v; p.data[i * 4 + 2] = v; p.data[i * 4 + 3] = 255; }
  return p;
}
// paint a deterministic pattern into the top-left logo box of an existing PNG (mutates in place). `kind` selects
// a STRUCTURALLY DISTINCT pattern so two different kinds have genuinely low SSIM (not just inverted luminance —
// SSIM is structure-based, so an inverted checkerboard still correlates highly; orthogonal structure does not).
function paintLogo(p, w, h, kind) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v;
    if (kind === 'check') v = (((x >> 3) + (y >> 3)) & 1) ? 230 : 10;        // 16px checkerboard
    else if (kind === 'vstripe') v = ((x >> 2) & 1) ? 230 : 10;             // fine vertical stripes (orthogonal)
    else if (kind === 'blank') v = 250;                                      // solid (a missing logo)
    else v = 128;
    const i = (y * p.width + x) * 4; p.data[i] = v; p.data[i + 1] = v; p.data[i + 2] = v; p.data[i + 3] = 255;
  }
}

console.log('=== A) DETECTOR UNIT TESTS ===');

// ---------- WRONG-LOGO ----------
// Build a source & clone that MATCH well across the page (same noisy field, same seed) so pageSSIM is high,
// then OVERWRITE only the clone's logo crop with a different pattern → logo SSIM at floor, page OK ⇒ FIRES.
{
  const W = 800, Hh = 1000;
  const src = noisy(W, Hh, 130, 90, 11); const cln = noisy(W, Hh, 130, 90, 11); // identical field ⇒ page matches
  // identical logo on both first (negative control reuses these)
  paintLogo(src, VETO_DEFAULTS.HDR_X, VETO_DEFAULTS.HDR_Y, 'check');
  const clnGood = PNG.sync.read(PNG.sync.write(cln)); paintLogo(clnGood, VETO_DEFAULTS.HDR_X, VETO_DEFAULTS.HDR_Y, 'check'); // SAME logo
  const clnBad = PNG.sync.read(PNG.sync.write(cln)); paintLogo(clnBad, VETO_DEFAULTS.HDR_X, VETO_DEFAULTS.HDR_Y, 'vstripe'); // orthogonal structure → low SSIM (wrong/swapped logo)
  // page-level SSIM (approx): identical fields ⇒ ~1.0. Pass it explicitly high.
  const posR = runVetoes({ srcShot: src, cloneShot: clnBad, pageSSIM: 0.95 }).all.find((r) => r.veto === 'wrong-logo');
  check('WRONG-LOGO positive: swapped logo crop FIRES', posR.fired === true, `logoSSIM ${posR.evidence.logoSSIM} pageSSIM ${posR.evidence.pageSSIM}`);
  const negR = runVetoes({ srcShot: src, cloneShot: clnGood, pageSSIM: 0.95 }).all.find((r) => r.veto === 'wrong-logo');
  check('WRONG-LOGO neg-control: matching logo does NOT fire', negR.fired === false, `logoSSIM ${negR.evidence.logoSSIM}`);
  // page-OK guard: a uniformly-broken page (low pageSSIM) must NOT be relabeled a logo veto even with a bad logo.
  const brokenR = runVetoes({ srcShot: src, cloneShot: clnBad, pageSSIM: 0.20 }).all.find((r) => r.veto === 'wrong-logo');
  check('WRONG-LOGO guard: uniformly-broken page (low pageSSIM) does NOT fire as logo', brokenR.fired === false, `pageOk ${brokenR.evidence.pageOk}`);
  // reversibility
  process.env.GRADER_NO_VETO_WRONGLOGO = '1';
  const offR = runVetoes({ srcShot: src, cloneShot: clnBad, pageSSIM: 0.95 }).all.find((r) => r.veto === 'wrong-logo');
  check('WRONG-LOGO reversible: GRADER_NO_VETO_WRONGLOGO=1 → detector absent', offR === undefined);
  delete process.env.GRADER_NO_VETO_WRONGLOGO;
}

// ---------- INVISIBLE-HEADING ----------
// A flat white crop with a contrastFail run pointing into it (white-on-white heading) → invisibleLocal true ⇒ FIRES.
// Negative: a content-bearing crop (glyph pixels contrast the local bg) ⇒ does NOT fire.
{
  const W = 600, Hh = 400;
  const flat = solid(W, Hh, 255, 255, 255); // white slab → a heading drawn white-on-white is invisible
  const headFlat = { ratio: 1.02, fsz: 36, x: 20, y: 20, w: 400, h: 50, fg: 'rgb(255,255,255)', bg: 'rgb(255,255,255)', text: 'Invisible Headline' };
  const posR = runVetoes({ cloneShot: flat, contrastFails: [headFlat] }).all.find((r) => r.veto === 'invisible-heading');
  check('INVISIBLE-HEADING positive: white-on-white heading FIRES', posR.fired === true, `count ${posR.evidence.count}`);
  // negative control 1: a VISIBLE heading — its crop has glyph pixels (paint a dark bar in the strip) ⇒ NOT invisible.
  const withGlyphs = PNG.sync.read(PNG.sync.write(flat));
  for (let y = 20; y < 60; y++) for (let x = 20; x < 200; x++) { const i = (y * withGlyphs.width + x) * 4; withGlyphs.data[i] = 10; withGlyphs.data[i + 1] = 10; withGlyphs.data[i + 2] = 10; } // dark glyph-ish band
  const negR = runVetoes({ cloneShot: withGlyphs, contrastFails: [headFlat] }).all.find((r) => r.veto === 'invisible-heading');
  check('INVISIBLE-HEADING neg-control: visible (glyph pixels) heading does NOT fire', negR.fired === false, `count ${negR.evidence.count}`);
  // negative control 2: a BODY-sized invisible run (fsz<18) must NOT fire this HEADING-specific veto.
  const bodyFlat = { ...headFlat, fsz: 14, text: 'small invisible body text' };
  const bodyR = runVetoes({ cloneShot: flat, contrastFails: [bodyFlat] }).all.find((r) => r.veto === 'invisible-heading');
  check('INVISIBLE-HEADING neg-control: sub-18px body run does NOT fire (heading-only)', bodyR.fired === false, `count ${bodyR.evidence.count}`);
  process.env.GRADER_NO_VETO_INVISHEAD = '1';
  const offR = runVetoes({ cloneShot: flat, contrastFails: [headFlat] }).all.find((r) => r.veto === 'invisible-heading');
  check('INVISIBLE-HEADING reversible: GRADER_NO_VETO_INVISHEAD=1 → detector absent', offR === undefined);
  delete process.env.GRADER_NO_VETO_INVISHEAD;
}

// ---------- BROKEN-HERO ----------
// Clone hero band FLAT (uniform) while SOURCE hero has content (noisy, wide luminance range) ⇒ FIRES.
{
  const W = 800;
  const srcHero = noisy(W, 800, 128, 110, 3); // content-bearing source (range >> HERO_SRC_MIN)
  const clnFlat = solid(W, 800, 245, 245, 245); // empty flat clone hero (range < HERO_FLAT)
  const posR = runVetoes({ srcShot: srcHero, cloneShot: clnFlat, bandSSIM: [0.1], bandExact: [0.0] }).all.find((r) => r.veto === 'broken-hero');
  check('BROKEN-HERO positive: flat clone hero w/ content-bearing source FIRES', posR.fired === true, `cloneRange ${posR.evidence.cloneHeroRange} srcRange ${posR.evidence.srcHeroRange}`);
  // neg-control 1: clone hero ALSO content-bearing (matches source) ⇒ NOT fired.
  const clnGood = noisy(W, 800, 128, 110, 3);
  const negR = runVetoes({ srcShot: srcHero, cloneShot: clnGood, bandSSIM: [0.92], bandExact: [0.8] }).all.find((r) => r.veto === 'broken-hero');
  check('BROKEN-HERO neg-control: content-bearing clone hero does NOT fire', negR.fired === false, `cloneRange ${negR.evidence.cloneHeroRange}`);
  // neg-control 2: source hero ALSO flat (a legitimately minimal/flat-design hero) ⇒ clone flat is FAITHFUL ⇒ NOT fired.
  const srcFlat = solid(W, 800, 250, 250, 250);
  const flatBothR = runVetoes({ srcShot: srcFlat, cloneShot: clnFlat, bandSSIM: [0.95], bandExact: [0.9] }).all.find((r) => r.veto === 'broken-hero');
  check('BROKEN-HERO neg-control: flat-design source (flat hero faithful) does NOT fire', flatBothR.fired === false, `srcHasContent ${flatBothR.evidence.srcHasContent}`);
  process.env.GRADER_NO_VETO_BROKENHERO = '1';
  const offR = runVetoes({ srcShot: srcHero, cloneShot: clnFlat, bandSSIM: [0.1], bandExact: [0.0] }).all.find((r) => r.veto === 'broken-hero');
  check('BROKEN-HERO reversible: GRADER_NO_VETO_BROKENHERO=1 → detector absent', offR === undefined);
  delete process.env.GRADER_NO_VETO_BROKENHERO;
}

// ---------- UNSTYLED-CTA ----------
// Source has a styled accent CTA (saturated bg fill); clone CTA is default grey/black-on-transparent ⇒ FIRES.
{
  const srcCta = [{ text: 'Get started', fgSat: 0.0, bgSat: 0.9, bgLum: 0.4, hasBg: true }]; // blue/accent fill
  const clnCtaUnstyled = [{ text: 'Get started', fgSat: 0.0, bgSat: 0.0, bgLum: 1.0, hasBg: false }]; // black-on-transparent default
  const posR = runVetoes({ srcCtaRuns: srcCta, cloneCtaRuns: clnCtaUnstyled }).all.find((r) => r.veto === 'unstyled-CTA');
  check('UNSTYLED-CTA positive: styled source CTA + default clone CTA FIRES', posR.fired === true, `srcStyled ${posR.evidence.srcStyled} cloneStyled ${posR.evidence.cloneStyled}`);
  // neg-control 1: clone CTA ALSO styled (accent fill) ⇒ NOT fired.
  const clnCtaStyled = [{ text: 'Get started', fgSat: 0.0, bgSat: 0.85, bgLum: 0.42, hasBg: true }];
  const negR = runVetoes({ srcCtaRuns: srcCta, cloneCtaRuns: clnCtaStyled }).all.find((r) => r.veto === 'unstyled-CTA');
  check('UNSTYLED-CTA neg-control: styled clone CTA does NOT fire', negR.fired === false, `cloneStyled ${negR.evidence.cloneStyled}`);
  // neg-control 2: source has NO styled CTA (a plain-text-link site) ⇒ default clone CTA is faithful ⇒ NOT fired.
  const srcPlain = [{ text: 'Learn more', fgSat: 0.0, bgSat: 0.0, bgLum: 1.0, hasBg: false }];
  const plainR = runVetoes({ srcCtaRuns: srcPlain, cloneCtaRuns: clnCtaUnstyled }).all.find((r) => r.veto === 'unstyled-CTA');
  check('UNSTYLED-CTA neg-control: plain-link source does NOT fire', plainR.fired === false, `srcStyled ${plainR.evidence.srcStyled}`);
  // neg-control 3: signal absent (older capture, no ctaRuns) ⇒ detector returns null/no-op.
  const absentR = runVetoes({ srcCtaRuns: null, cloneCtaRuns: null }).all.find((r) => r.veto === 'unstyled-CTA');
  check('UNSTYLED-CTA no-op: absent signal → detector absent (no false positive)', absentR === undefined);
  process.env.GRADER_NO_VETO_UNSTYLEDCTA = '1';
  const offR = runVetoes({ srcCtaRuns: srcCta, cloneCtaRuns: clnCtaUnstyled }).all.find((r) => r.veto === 'unstyled-CTA');
  check('UNSTYLED-CTA reversible: GRADER_NO_VETO_UNSTYLEDCTA=1 → detector absent', offR === undefined);
  delete process.env.GRADER_NO_VETO_UNSTYLEDCTA;
}

// ---------- AGGREGATE: a fully clean ctx trips NOTHING (the master negative control) ----------
{
  const W = 800, Hh = 1000;
  const src = noisy(W, Hh, 130, 90, 21); const cln = PNG.sync.read(PNG.sync.write(src)); // clone == source (perfect)
  const r = runVetoes({
    srcShot: src, cloneShot: cln, pageSSIM: 0.99,
    bandSSIM: Array(5).fill(0.95), bandExact: Array(5).fill(0.9),
    contrastFails: [{ ratio: 5.2, fsz: 36, x: 10, y: 10, w: 200, h: 40, text: 'fine' }], // passes contrast → not a fail anyway
    srcCtaRuns: [{ text: 'Go', fgSat: 0, bgSat: 0.8, bgLum: 0.4, hasBg: true }],
    cloneCtaRuns: [{ text: 'Go', fgSat: 0, bgSat: 0.8, bgLum: 0.4, hasBg: true }],
  });
  check('AGGREGATE neg-control: a perfect clone trips ZERO vetoes (no deflation)', r.fired.length === 0, `fired [${r.fired.map((f) => f.veto).join(',')}]`);
}

console.log('\n=== B) EDITABILITY LADDER UNIT TEST ===');
// Replicate the ladder maths exactly: credit += bandVis × (frozen ? FROZEN_W : 1). Prove (i) frozen discount,
// (ii) no-op when there are NO preserve bands (pure-flow), (iii) byte-equivalence to the legacy sum in that case.
{
  const FROZEN_W = 0.35;
  const bandVis = 0.9; // pretend every run sits in a high-fidelity band
  const runs = [{ y: 50 }, { y: 250 }, { y: 450 }, { y: 650 }]; // 4 covered runs
  const legacyCredit = runs.length * bandVis; // legacy: every run full credit
  // pure-flow: no preserve bands → ladder credit == legacy (NO-OP ON FLOW)
  const flowBands = [];
  const inBand = (y, bands) => bands.some((b) => y >= b.y0 && y < b.y1);
  const ladderCredit = (bands) => runs.reduce((a, r) => a + bandVis * (inBand(r.y, bands) ? FROZEN_W : 1), 0);
  check('LADDER no-op-on-flow: zero preserve bands → credit == legacy (byte-equal)', ladderCredit(flowBands) === legacyCredit, `ladder ${ladderCredit(flowBands)} legacy ${legacyCredit}`);
  // half the page frozen (a preserve band covering y in [200,500)) → 2 runs discounted ⇒ credit STRICTLY lower.
  const frozenBands = [{ y0: 200, y1: 500 }];
  const fc = ladderCredit(frozenBands);
  const expected = bandVis * (1 + FROZEN_W + FROZEN_W + 1); // runs at 50,650 full; 250,450 frozen
  check('LADDER frozen discount: 2 frozen runs credited ×FROZEN_W (lower than legacy)', Math.abs(fc - expected) < 1e-9 && fc < legacyCredit, `frozen ${fc.toFixed(3)} expected ${expected.toFixed(3)} legacy ${legacyCredit}`);
  // monotonic: more frozen coverage ⇒ never-higher editability
  const allFrozen = ladderCredit([{ y0: 0, y1: 1000 }]);
  check('LADDER monotonic: all-frozen ≤ half-frozen ≤ flow', allFrozen <= fc && fc <= legacyCredit, `all ${allFrozen.toFixed(3)} half ${fc.toFixed(3)} flow ${legacyCredit}`);
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`));
process.exit(fail === 0 ? 0 : 1);
