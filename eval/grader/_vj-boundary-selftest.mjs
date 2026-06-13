#!/usr/bin/env node
/**
 * @purpose _vj-boundary-selftest.mjs — STANDING pure-pixel selftest for the VJ-BOUNDARY guard in vision-judge.mjs
 * (2026-06-12). No network, no LLM, deterministic. Pins the one fix: a hRatio<1 band-edge must not fake a
 * ruinous sev5, while a genuine background inversion must STILL be penalized.
 *
 * THE BUG (LOOK-confirmed on the fixed clerk page, hRatio 0.889): band-aligned tiling cuts a THIN source slice at
 * a section BOUNDARY (a white↔dark transition strip); under cumulative height compression that strip slides out of
 * correspondence and is compared against the clone's correctly-rendered SOLID section, so the vision judge calls a
 * false sev5 inverted/dark-background-absent/section-absent defect (t03/t14/t16 = +~10 penalty of pure noise).
 *
 * Fixtures REPRODUCE the measured per-side luma signatures of the three real clerk artifact tiles (see the table
 * in the commit / evidence /tmp/vj-fixed-fullpage): a thin tile whose ONE side is a strong white↔dark transition
 * strip and whose OTHER side is a comparatively solid section. The detector + reclassifier are exercised over REAL
 * composed PNGs (built with the same composeTile() the judge saw), not mocks.
 *
 * Pins:
 *   A1/A2/A3 ARTIFACT (t03/t14/t16-like): isBoundaryArtifactTile=TRUE and the sev5 background/absence defect is
 *     reclassified to sev2 (counts in the mean, no penalty floor; score untouched).
 *   G GENUINE INVERSION: source SOLID white, clone SOLID dark over the SAME band (each vertSplit ~0) →
 *     isBoundaryArtifactTile=FALSE → the sev5 inversion defect is UNTOUCHED (still penalized). Anti-overcorrection.
 *   S SOLID-AGREE control: a normal full-height tile that agrees → not flagged (no false guard).
 *   N NON-BG DEFECT on a real artifact tile: a "wrong logos" sev4 on the SAME boundary tile is NOT reclassified
 *     (the guard touches ONLY background/inversion/absence defects).
 *   R OPPORTUNISTIC REAL EVIDENCE: if /tmp/vj-fixed-fullpage/w1440-tile-{03,14,16}.png exist, assert each is
 *     flagged by isBoundaryArtifactTile (the calibration anchor; skipped with a note when evidence absent).
 * Exit 0 = ALL PASS, 1 = fail. Prints one line per test.
 */
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { composeTile, LABEL_STRIP, BG_DEFECT, isBoundaryArtifactTile, reclassifyBoundaryDefects } from './vision-judge.mjs';

let fails = 0;
const check = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!cond) fails++; };

// ── fixture builders ────────────────────────────────────────────────────────────────────────────────────────
// solidBand: one flat luma. transitionBand: top half light, bottom half dark (a white↔dark boundary strip), or
// inverted via `topDark`. Width 1440-style; height is the CONTENT height (composeTile adds LABEL_STRIP on top).
const W = 1200;
function solid(w, h, L) { const p = new PNG({ width: w, height: h }); for (let i = 0; i < p.data.length; i += 4) { p.data[i] = p.data[i + 1] = p.data[i + 2] = L; p.data[i + 3] = 255; } return p; }
function transition(w, h, topDark = false) {
  const p = new PNG({ width: w, height: h }); const mid = h >> 1;
  for (let y = 0; y < h; y++) { const L = ((y < mid) !== topDark) ? 250 : 24; for (let x = 0; x < w; x++) { const i = (y * w + x) << 2; p.data[i] = p.data[i + 1] = p.data[i + 2] = L; p.data[i + 3] = 255; } }
  return p;
}
const tile = (srcImg, clnImg) => composeTile(srcImg, clnImg, 1440, 0);

// A1 — t03-like: thin 240px; SRC = white→dark transition (split ~191), CLONE = solid white (split ~10).
{
  const t = tile(transition(W, 240), solid(W, 240, 250));
  const flagged = isBoundaryArtifactTile(t, 240);
  const defs = [{ desc: "Background color entirely wrong: LEFT shows dark/black background for this band; RIGHT renders white/light — the section's dark theme is completely absent", severity: 5, category: 'wrong-style' }];
  const { defects, reclassified } = reclassifyBoundaryDefects(defs);
  check('A1-artifact-t03 flagged', flagged, `contentH=240`);
  check('A1-artifact-t03 sev5->sev2', reclassified === 1 && defects[0].severity === 2 && defects[0].boundaryGuard === true && defects[0].origSeverity === 5);
}
// A2 — t14-like: thin 228px; SRC = white→dark transition, CLONE = solid white.
{
  const t = tile(transition(W, 228), solid(W, 228, 248));
  const flagged = isBoundaryArtifactTile(t, 228);
  const defs = [{ desc: 'Dark/black background section in the bottom ~40% of the LEFT side is entirely absent on the RIGHT; right shows white background instead', severity: 5, category: 'layout-broken' }];
  const { defects, reclassified } = reclassifyBoundaryDefects(defs);
  check('A2-artifact-t14 flagged + reclassified', flagged && reclassified === 1 && defects[0].severity === 2);
}
// A3 — t16-like: thin 128px; SRC = solid dark (split ~0), CLONE = white→dark transition (split ~190).
{
  const t = tile(solid(W, 128, 19), transition(W, 128));
  const flagged = isBoundaryArtifactTile(t, 128);
  const defs = [{ desc: 'Large dark background visible on LEFT is missing on RIGHT; the dark section theme is absent', severity: 5, category: 'wrong-style' }];
  const { defects, reclassified } = reclassifyBoundaryDefects(defs);
  check('A3-artifact-t16 flagged (split on clone side) + reclassified', flagged && reclassified === 1 && defects[0].severity === 2);
}

// G — GENUINE INVERSION: thin 200px, SRC SOLID white, CLONE SOLID dark over the SAME band. Each side split ~0 →
// NOT a boundary strip → must NOT be flagged → the sev5 inversion stays sev5 (anti-overcorrection pin).
{
  const t = tile(solid(W, 200, 250), solid(W, 200, 22));
  const flagged = isBoundaryArtifactTile(t, 200);
  // mirror the main-loop wiring EXACTLY: reclassify runs ONLY when the gate (isBoundaryArtifactTile) is true.
  const defs = [{ desc: 'Background is inverted: source section is white but the clone renders this whole section dark/black', severity: 5, category: 'wrong-style' }];
  const applied = flagged ? reclassifyBoundaryDefects(defs).defects : defs; // gate from main(): `if (!isBoundaryArtifactTile(...)) continue;`
  check('G-genuine-inversion NOT flagged', !flagged, `each side solid (split ~0)`);
  check('G-genuine-inversion STILL sev5 after gated wiring', applied[0].severity === 5 && !applied[0].boundaryGuard);
}

// S — SOLID-AGREE control: a normal 900px tile, both sides solid dark, agree → not thin, not flagged.
{
  const t = tile(solid(W, 900, 34), solid(W, 900, 30));
  check('S-solid-agree not flagged (full height)', !isBoundaryArtifactTile(t, 900));
}

// N — NON-BG defect on a real artifact tile: the guard touches ONLY background/inversion/absence defects.
{
  const defs = [
    { desc: "All company logos in the trust bar are the wrong brands", severity: 4, category: 'wrong-style' },
    { desc: "the section's dark background is entirely absent on the right", severity: 5, category: 'layout-broken' },
  ];
  const { defects, reclassified } = reclassifyBoundaryDefects(defs);
  check('N-nonbg untouched, bg reclassified', reclassified === 1 && defects[0].severity === 4 && !defects[0].boundaryGuard && defects[1].severity === 2);
  check('N-BG_DEFECT regex selectivity', !BG_DEFECT.test('wrong logos in the trust bar') && BG_DEFECT.test("the section's dark background is absent"));
}

// R — OPPORTUNISTIC REAL EVIDENCE (calibration anchor): assert the actual clerk artifact tiles are flagged.
{
  const dir = '/tmp/vj-fixed-fullpage';
  const reals = [['t03', 'w1440-tile-03.png', 140], ['t14', 'w1440-tile-14.png', 128], ['t16', 'w1440-tile-16.png', 128]];
  let any = false;
  for (const [name, file, h] of reals) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) continue;
    any = true;
    const png = PNG.sync.read(fs.readFileSync(p));
    check(`R-real-${name} flagged`, isBoundaryArtifactTile(png, h), p);
  }
  if (!any) console.log('SKIP  R-real-evidence — /tmp/vj-fixed-fullpage tiles absent (synthetic fixtures A1-A3 pin the behavior)');
}

console.log(fails === 0 ? '\nVJ-BOUNDARY SELFTEST: ALL PASS' : `\nVJ-BOUNDARY SELFTEST: ${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
