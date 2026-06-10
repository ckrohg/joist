/**
 * @purpose Deterministic self-test for the MEDIA-IDENTITY dimension (grade-sections.mjs mediaIdentityBand,
 * REPORT-ONLY round — GRADER_NO_MEDIAID=1 reverts). The three mandatory proofs:
 *   (1) SELFTEST — pure: identical synthetic shots → every id==1, presence==1, M_b==1 (raw AND short-circuit).
 *       CLI: real `--selftest` on a file:// fixture → mediaIdentityMean==1.0 (raw too) AND the existing PASS
 *       line byte-identical to a GRADER_NO_MEDIAID=1 run.
 *   (2) INJECTED-DEFECT: WRONG-LOGO band (matched geometry, different imagery) → identity≤0.5, M_b≤0.75,
 *       drop≥0.25 vs clean control; IMAGERY-DELETED band → M_b≤0.1 while an unaffected band stays 1.0.
 *   (3) GAME-TEST: a band whose source text the clone reproduced — classifyVoid's TEXT-GUARD suppresses the
 *       void (asserted with MEASURED energies, in the same test) — but ALL imagery omitted → M_b≤0.2.
 *       Trick-precedent sub-asserts: (a) 50 stamped 8×8 probe imgs gain nothing (24px floor); (b) URL-spoofed/
 *       unpainted full-size stamps gain nothing (paint guard reads RENDERED pixels, never src attributes).
 * Plus: REPORT-ONLY byte-proof — non-selftest CLI A/B on the fixture: flag-ON report minus the media fields
 * deep-equals the flag-OFF report; composite byte-identical either way.
 * Plus: FOLD-BLOCKER regressions T9-T12 (B1 round 3, one per blocker — see grade-sections.mjs header):
 * presence-gaming ≤0.15, bg-div byte-identical ≥0.9, LQIP 9×8 ≤0.6 (4×4 monotone-below), unrelated-busy ≤0.45
 * + stretch priced-not-zeroed. These pin the zz-mi-attack harness flips.
 * Plus: ROUND-4 games T13-T14 (zz-mi-attack3 flips): T13 video-box presence stuffing (decorative svg AND
 * re-tagged img gradient at the video box ≤ honest omission; legit video / captured-frame poster keep credit),
 * T14 grain-over-LQIP (film-grain overlay ≤ plain LQIP across std 8..96; NN-stretch real detail stays high).
 * Pure tests run with no browser/network/WP. CLI proofs launch headless chromium on file:// fixtures only
 * (skip with --pure). Never touches graded pages. Run: node _mediaid-selftest.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { PNG } from 'pngjs';
import { mediaIdentityBand, mediaCropId, cropEnergy, classifyVoid } from './grade-sections.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PURE_ONLY = process.argv.includes('--pure');
let pass = true;
const log = (ok, msg) => { if (!ok) pass = false; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

// ---- synthetic PNG builders (in-memory, deterministic) ----
const mk = (w, h, rgb) => { const p = new PNG({ width: w, height: h }); for (let i = 0; i < w * h; i++) { p.data[i * 4] = rgb[0]; p.data[i * 4 + 1] = rgb[1]; p.data[i * 4 + 2] = rgb[2]; p.data[i * 4 + 3] = 255; } return p; };
const px = (img, x, y, rgb) => { if (x < 0 || y < 0 || x >= img.width || y >= img.height) return; const i = (y * img.width + x) * 4; img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255; };
const rect = (img, x, y, w, h, rgb) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(img, xx, yy, rgb); };
const hstripes = (img, x, y, w, h, period, a, b) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(img, xx, yy, Math.floor((yy - y) / period) % 2 === 0 ? a : b); };
const vstripes = (img, x, y, w, h, period, a, b) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(img, xx, yy, Math.floor((xx - x) / period) % 2 === 0 ? a : b); };
const checker = (img, x, y, w, h, cell, a, b) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(img, xx, yy, (Math.floor((xx - x) / cell) + Math.floor((yy - y) / cell)) % 2 === 0 ? a : b); };
const dup = (img) => { const p = new PNG({ width: img.width, height: img.height }); img.data.copy(p.data); return p; };
const leaf = (x, y, w, h, tag = 'img') => ({ x, y, w, h, area: w * h, tag });

// ════ (1) SELFTEST — pure: identical shots → 1.0 ════
{
  const src = mk(1440, 400, [240, 240, 242]);
  checker(src, 100, 100, 200, 120, 40, [255, 120, 0], [20, 60, 180]);
  hstripes(src, 500, 80, 400, 240, 48, [10, 140, 120], [250, 250, 250]);
  const media = [leaf(100, 100, 200, 120), leaf(500, 80, 400, 240)];
  const r = mediaIdentityBand({ srcShot: src, cloneShot: src, srcMedia: media, cloneMedia: media, y0: 0, y1: 400 });
  log(r.score === 1 && r.identity === 1 && r.presence === 1 && r.leaves.missing === 0 && r.leaves.wrong === 0,
    `T1 selftest-pure: identical shots → id 1, presence 1, M_b 1 (got M ${r.score} id ${r.identity} pres ${r.presence})`);
  const rs = mediaIdentityBand({ srcShot: src, cloneShot: src, srcMedia: media, cloneMedia: media, y0: 0, y1: 400, selftest: true });
  log(rs.score === 1 && rs.raw === 1, `T1b selftest short-circuit: score 1 AND raw (telemetry) 1 (got ${rs.score}/${rs.raw})`);
  log(mediaCropId(src, { x: 100, y: 100, w: 200, h: 120 }, src, { x: 100, y: 100, w: 200, h: 120 }) === 1,
    'T1c mediaCropId: identical crops → exactly 1 (hamming 0, ΔE 0)');
}

// ════ (2a) INJECTED-DEFECT: WRONG-LOGO (matched geometry, different imagery) ════
{
  const src = mk(1440, 300, [250, 250, 250]);
  hstripes(src, 600, 60, 240, 160, 40, [255, 120, 0], [255, 255, 255]); // source "logo": coarse orange/white h-stripes
  const media = [leaf(600, 60, 240, 160)];
  const clean = dup(src);
  const wrong = dup(src);
  vstripes(wrong, 600, 60, 240, 160, 60, [0, 40, 160], [8, 8, 8]);      // clone "logo": blue/black v-stripes (different imagery)
  const rClean = mediaIdentityBand({ srcShot: src, cloneShot: clean, srcMedia: media, cloneMedia: media, y0: 0, y1: 300 });
  const rWrong = mediaIdentityBand({ srcShot: src, cloneShot: wrong, srcMedia: media, cloneMedia: media, y0: 0, y1: 300 });
  log(rClean.score === 1, `T2 control: clean clone band → M_b 1 (got ${rClean.score})`);
  log(rWrong.identity <= 0.5, `T2 wrong-logo: identity ≤ 0.5 (got ${rWrong.identity})`);
  log(rWrong.score <= 0.75, `T2 wrong-logo: M_b ≤ 0.75 — presence flat, identity falls (got ${rWrong.score})`);
  log(rClean.score - rWrong.score >= 0.25, `T2 wrong-logo: drop vs clean control ≥ 0.25 (got ${(rClean.score - rWrong.score).toFixed(3)})`);
  log(rWrong.leaves.wrong === 1 && rWrong.leaves.matched === 1, `T2 wrong-logo: matched yet flagged mediaWrong (matched ${rWrong.leaves.matched}, wrong ${rWrong.leaves.wrong})`);
}

// ════ (2b) INJECTED-DEFECT: IMAGERY-DELETED (+ unaffected band stays high) ════
{
  const src = mk(1440, 800, [248, 248, 250]);
  checker(src, 120, 80, 300, 200, 40, [200, 40, 40], [255, 230, 200]);  // band A imagery
  hstripes(src, 700, 100, 400, 180, 36, [40, 90, 200], [240, 240, 255]);
  checker(src, 400, 480, 360, 240, 48, [30, 150, 90], [250, 250, 240]); // band B imagery
  const srcMedia = [leaf(120, 80, 300, 200), leaf(700, 100, 400, 180), leaf(400, 480, 360, 240)];
  const cln = dup(src);
  rect(cln, 120, 80, 300, 200, [248, 248, 250]);                        // band A imagery flood-filled to bg
  rect(cln, 700, 100, 400, 180, [248, 248, 250]);
  const clnMedia = [leaf(400, 480, 360, 240)];                          // only band B media remains
  const rA = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia, cloneMedia: clnMedia, y0: 0, y1: 400 });
  const rB = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia, cloneMedia: clnMedia, y0: 400, y1: 800 });
  log(rA.score <= 0.1 && rA.identity === 0 && rA.presence === 0 && rA.leaves.missing === 2,
    `T3 imagery-deleted: M_b ≤ 0.1, identity 0, presence 0, 2 missing (got M ${rA.score} id ${rA.identity} pres ${rA.presence} miss ${rA.leaves.missing})`);
  log(rB.score === 1, `T3 unaffected band stays high: M_b 1 (got ${rB.score})`);
}

// ════ (3) GAME-TEST: text reproduced (TEXT-GUARD passes the void) but ALL imagery omitted ════
{
  const bg = [10, 10, 12];
  const W = 1440, Hb = 400;
  const strokes = (img) => { rect(img, 120, 120, 360, 2, [32, 32, 36]); rect(img, 120, 180, 280, 2, [32, 32, 36]); rect(img, 120, 240, 200, 2, [32, 32, 36]); };
  const srcG = mk(W, Hb, bg); strokes(srcG);
  checker(srcG, 800, 60, 420, 280, 40, [240, 180, 40], [30, 80, 200]);  // source imagery: big bright patch
  const clnG = mk(W, Hb, bg); strokes(clnG);                            // clone: SAME text strokes, NO imagery
  const srcE = cropEnergy(srcG, { x: 0, y: 0, w: W, h: Hb }).energy;
  const clnE = cropEnergy(clnG, { x: 0, y: 0, w: W, h: Hb }).energy;
  // the energy condition must genuinely FIRE so the TEXT-GUARD is the deciding factor (not a vacuous pass)
  log(srcE >= 0.06 && clnE <= 0.020 && clnE <= 0.30 * srcE,
    `T4 energy precondition: srcEnergy ${srcE} ≥ 0.06, cloneEnergy ${clnE} ≤ 0.020 and ≤ 0.30·src (void condition fires)`);
  log(classifyVoid({ srcEnergy: srcE, cloneEnergy: clnE, cloneReproducedBandText: true }) === false,
    'T4 TEXT-GUARD passes it: clone reproduced the band text → classifyVoid === false (void suppressed, as today)');
  log(classifyVoid({ srcEnergy: srcE, cloneEnergy: clnE, cloneReproducedBandText: false }) === true,
    'T4 control: same energies WITHOUT reproduced text → still a genuine void');
  const mediaG = [leaf(800, 60, 420, 280)];
  const rG = mediaIdentityBand({ srcShot: srcG, cloneShot: clnG, srcMedia: mediaG, cloneMedia: [], y0: 0, y1: Hb });
  log(rG.score <= 0.2, `T4 GAME-TEST: text-reproducing band that omitted ALL imagery → M_b ≤ 0.2 (got ${rG.score}) — the immunization gap is priced`);
  // (a) trick precedent: stamping 50 painted 8×8 probe imgs → all below the 24×24 floor → gains nothing
  const clnP = dup(clnG); const probes = [];
  for (let i = 0; i < 50; i++) { const x = 60 + (i % 10) * 130, y = 300 + Math.floor(i / 10) * 16; rect(clnP, x, y, 8, 8, [250, 250, 250]); probes.push(leaf(x, y, 8, 8)); }
  const rP = mediaIdentityBand({ srcShot: srcG, cloneShot: clnP, srcMedia: mediaG, cloneMedia: probes, y0: 0, y1: Hb });
  log(rP.score <= 0.2, `T4a 8px-probe trick: 50 stamped probes → presence contribution 0, M_b unchanged-low (got ${rP.score})`);
  // (b) trick precedent: URL-spoofing / unpainted full-size stamp at the exact source box → paint guard kills it
  const rU = mediaIdentityBand({ srcShot: srcG, cloneShot: clnG, srcMedia: mediaG, cloneMedia: [leaf(800, 60, 420, 280)], y0: 0, y1: Hb });
  log(rU.score <= 0.2 && rU.presence === 0, `T4b unpainted-stamp trick: full-size box claimed but pixels are bg → scores nothing (got M ${rU.score} pres ${rU.presence})`);
}

// ════ edge semantics: n/a band, source-paint guard, presence-only video, picture+img dedupe ════
{
  const flat = mk(800, 200, [245, 245, 245]);
  const rNA = mediaIdentityBand({ srcShot: flat, cloneShot: flat, srcMedia: [], cloneMedia: [], y0: 0, y1: 200 });
  log(rNA.score === null, `T5 n/a band: zero eligible source media → score null, never zero (got ${rNA.score})`);
  // source leaf declared but never painted (lazy-fail) → excluded entirely → band n/a, no false MISSING penalty
  const rLazy = mediaIdentityBand({ srcShot: flat, cloneShot: flat, srcMedia: [leaf(100, 40, 200, 120)], cloneMedia: [], y0: 0, y1: 200 });
  log(rLazy.score === null && rLazy.leaves.eligible === 0, `T6 source-paint guard: unpainted source leaf excluded entirely (score ${rLazy.score}, eligible ${rLazy.leaves.eligible})`);
}
{
  const src = mk(800, 300, [20, 20, 24]);
  checker(src, 200, 50, 320, 200, 40, [200, 200, 60], [40, 40, 120]);
  const cln = mk(800, 300, [20, 20, 24]);
  vstripes(cln, 200, 50, 320, 200, 64, [180, 60, 60], [240, 240, 240]); // DIFFERENT pixels (video frames differ)
  const v = [leaf(200, 50, 320, 200, 'video')];
  const rV = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia: v, cloneMedia: v, y0: 0, y1: 300 });
  log(rV.score === 1 && rV.identity === null, `T7 video presence-only: differing pixels NOT identity-scored (animated), presence carries (M ${rV.score}, id ${rV.identity})`);
  const rV0 = mediaIdentityBand({ srcShot: src, cloneShot: mk(800, 300, [20, 20, 24]), srcMedia: v, cloneMedia: [], y0: 0, y1: 300 });
  log(rV0.score === 0, `T7b video absent: M_b 0 (got ${rV0.score})`);
}
{
  const src = mk(800, 300, [255, 255, 255]);
  checker(src, 100, 50, 300, 200, 40, [220, 60, 60], [60, 60, 220]);
  const srcMedia = [leaf(100, 50, 300, 200, 'picture'), leaf(100, 50, 300, 200, 'img')]; // picture wraps its img → both captured
  const rD = mediaIdentityBand({ srcShot: src, cloneShot: src, srcMedia, cloneMedia: [leaf(100, 50, 300, 200, 'img')], y0: 0, y1: 300 });
  log(rD.score === 1 && rD.presence === 1, `T8 picture+img dedupe: faithful single-img clone not false-halved (M ${rD.score} pres ${rD.presence})`);
}

// ════ FOLD-BLOCKER regressions (B1 round 3 — one per blocker; the zz-mi-attack numbers must STAY flipped) ════
// shared builders (zz-mi-attack's exact constructions): a "photo" with real high+low-frequency structure,
// nearest-neighbor blit (anisotropic stretch), grid-blur LQIP, decorative vertical gradient.
const get = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const photo = (img, x, y, w, h) => { for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const base = (Math.floor(xx / 24) + Math.floor(yy / 24)) % 2 === 0 ? [225, 140, 40] : [30, 70, 180]; const ramp = Math.round(60 * (xx / w)); px(img, x + xx, y + yy, [Math.min(255, base[0] + ramp), base[1], Math.min(255, base[2] + Math.round(40 * yy / h))]); } };
const blit = (srcImg, sx, sy, sw, sh, dstImg, dx, dy, dw, dh) => { for (let yy = 0; yy < dh; yy++) for (let xx = 0; xx < dw; xx++) { const ox = sx + Math.min(sw - 1, Math.floor(xx * sw / dw)); const oy = sy + Math.min(sh - 1, Math.floor(yy * sh / dh)); px(dstImg, dx + xx, dy + yy, get(srcImg, ox, oy)); } };
const lqip = (srcImg, sx, sy, sw, sh, gw, gh, dstImg, dx, dy) => {
  const cells = Array.from({ length: gw * gh }, () => [0, 0, 0, 0]);
  for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) { const gx = Math.min(gw - 1, Math.floor(xx * gw / sw)), gy = Math.min(gh - 1, Math.floor(yy * gh / sh)); const c = get(srcImg, sx + xx, sy + yy); const cc = cells[gy * gw + gx]; cc[0] += c[0]; cc[1] += c[1]; cc[2] += c[2]; cc[3]++; }
  for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) { const gx = Math.min(gw - 1, Math.floor(xx * gw / sw)), gy = Math.min(gh - 1, Math.floor(yy * gh / sh)); const cc = cells[gy * gw + gx]; px(dstImg, dx + xx, dy + yy, [cc[0] / cc[3], cc[1] / cc[3], cc[2] / cc[3]]); }
};
const vgrad = (img, x, y, w, h) => { for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) px(img, x + xx, y + yy, [Math.round(255 * yy / h), Math.round(40 + 180 * yy / h), 200]); };

// ── T9 / FOLD-BLOCKER #1: PRESENCE GAMING — identity-weighted presence kills decorative-area stuffing ──
{
  const src = mk(1440, 400, [248, 248, 250]); photo(src, 480, 60, 480, 280);
  const srcMedia = [leaf(480, 60, 480, 280)];
  const gameO = mk(1440, 400, [248, 248, 250]); vgrad(gameO, 480, 60, 480, 280);        // svg gradient AT the photo box
  const rO = mediaIdentityBand({ srcShot: src, cloneShot: gameO, srcMedia, cloneMedia: [leaf(480, 60, 480, 280, 'svg')], y0: 0, y1: 400 });
  const gameE = mk(1440, 400, [248, 248, 250]); vgrad(gameE, 0, 100, 480, 280);          // same-area gradient ELSEWHERE
  const rE = mediaIdentityBand({ srcShot: src, cloneShot: gameE, srcMedia, cloneMedia: [leaf(0, 100, 480, 280, 'svg')], y0: 0, y1: 400 });
  log(rO.score <= 0.15 && rO.presence <= 0.15, `T9 FB1 presence-gaming overlap: decorative gradient at the photo box → M ≤ 0.15, presence ≤ 0.15 (was M 0.409/pres 1.0; got M ${rO.score} pres ${rO.presence})`);
  log(rE.score <= 0.15 && rE.presence <= 0.15, `T9 FB1 presence-gaming elsewhere: same-area shape divider far from the photo → M ≤ 0.15 (was 0.400; got ${rE.score})`);
}
// ── T10 / FOLD-BLOCKER #2: BG-DIV FALSE-LOW — same-box pixel fallback credits background-image clones ──
{
  const src = mk(1440, 400, [248, 248, 250]); photo(src, 480, 60, 480, 280);
  const cln = dup(src);                                                                  // byte-identical pixels
  const r = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia: [leaf(480, 60, 480, 280)], cloneMedia: [], y0: 0, y1: 400 }); // CSS bg-image → NO clone media leaf
  log(r.score >= 0.9 && r.leaves.missing === 0 && r.leaves.fb === 1,
    `T10 FB2 bg-div: byte-identical pixels via background-image (no clone <img>) → M ≥ 0.9, fb-credited, not missing (was M 0; got M ${r.score} fb ${r.leaves.fb} miss ${r.leaves.missing})`);
}
// ── T11 / FOLD-BLOCKER #3: LQIP FALSE-HIGH — hf (within-cell variance) term prices blurred placeholders ──
{
  const src = mk(1440, 400, [248, 248, 250]); photo(src, 480, 60, 480, 280);
  const media = [leaf(480, 60, 480, 280)];
  const c98 = mk(1440, 400, [248, 248, 250]); lqip(src, 480, 60, 480, 280, 9, 8, c98, 480, 60);
  const c44 = mk(1440, 400, [248, 248, 250]); lqip(src, 480, 60, 480, 280, 4, 4, c44, 480, 60);
  const r98 = mediaIdentityBand({ srcShot: src, cloneShot: c98, srcMedia: media, cloneMedia: media, y0: 0, y1: 400 });
  const r44 = mediaIdentityBand({ srcShot: src, cloneShot: c44, srcMedia: media, cloneMedia: media, y0: 0, y1: 400 });
  log(r98.identity <= 0.6, `T11 FB3 LQIP 9×8: blurred lazy-load placeholder id ≤ 0.6 (was 0.938; got ${r98.identity})`);
  log(r44.identity <= r98.identity, `T11 FB3 monotone: cruder 4×4 blur scores ≤ the 9×8 blur (${r44.identity} ≤ ${r98.identity})`);
}
// ── T12 / FOLD-BLOCKER #4: WRONG-PHOTO UNDER-PRICING — corr + box-aspect terms ──
{
  let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let sum = 0; const N = 20;
  for (let t = 0; t < N; t++) {                                                          // unrelated busy imagery (attack2 W3)
    const a = mk(400, 300, [0, 0, 0]), b = mk(400, 300, [0, 0, 0]);
    for (let y = 0; y < 300; y += 4) for (let x = 0; x < 400; x += 4) { const ca = [rnd() * 255, rnd() * 255, rnd() * 255], cb = [rnd() * 255, rnd() * 255, rnd() * 255]; for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) { px(a, x + dx, y + dy, ca); px(b, x + dx, y + dy, cb); } }
    sum += mediaCropId(a, { x: 0, y: 0, w: 400, h: 300 }, b, { x: 0, y: 0, w: 400, h: 300 });
  }
  const meanId = sum / N;
  log(meanId <= 0.45, `T12 FB4 unrelated-busy baseline: mean id over 20 random pairs ≤ 0.45 (was 0.696; got ${meanId.toFixed(3)})`);
  const src = mk(1440, 400, [248, 248, 250]); photo(src, 480, 60, 480, 280);             // anisotropic stretch (attack A1)
  const cln = mk(1440, 400, [248, 248, 250]); blit(src, 480, 60, 480, 280, cln, 0, 20, 1440, 360);
  const rS = mediaIdentityBand({ srcShot: src, cloneShot: cln, srcMedia: [leaf(480, 60, 480, 280)], cloneMedia: [leaf(0, 20, 1440, 360)], y0: 0, y1: 400 });
  log(rS.identity <= 0.7, `T12 FB4 anisotropic stretch: 480×280 → 1440×360 priced, id ≤ 0.7 (was 0.978; got ${rS.identity})`);
  log(rS.identity >= 0.4, `T12 FB4 stretch is priced, not zeroed: same imagery keeps id ≥ 0.4 (got ${rS.identity})`);
}

// ── T13 / ROUND-4: VIDEO-BOX PRESENCE STUFFING — tag gate + poster palette gate (attack3 N2) ──
{
  const src = mk(800, 300, [20, 20, 24]); checker(src, 200, 50, 400, 220, 40, [200, 200, 60], [40, 40, 120]); // captured video frame
  const v = [leaf(200, 50, 400, 220, 'video')];
  const rOmit = mediaIdentityBand({ srcShot: src, cloneShot: mk(800, 300, [20, 20, 24]), srcMedia: v, cloneMedia: [], y0: 0, y1: 300 });
  const gShot = mk(800, 300, [20, 20, 24]); vgrad(gShot, 200, 50, 400, 220);  // decorative gradient at the box
  const rSvg = mediaIdentityBand({ srcShot: src, cloneShot: gShot, srcMedia: v, cloneMedia: [leaf(200, 50, 400, 220, 'svg')], y0: 0, y1: 300 });
  const rTag = mediaIdentityBand({ srcShot: src, cloneShot: gShot, srcMedia: v, cloneMedia: [leaf(200, 50, 400, 220, 'img')], y0: 0, y1: 300 });
  log(rOmit.score === 0, `T13 honest-omit control: video absent → M 0 (got ${rOmit.score})`);
  log(rSvg.score <= rOmit.score && rSvg.presence === 0, `T13 svg-gradient stuffing: decorative svg at the video box ≤ honest omission (was M 1.0; got M ${rSvg.score} vs omit ${rOmit.score})`);
  log(rTag.score <= rOmit.score && rTag.presence === 0, `T13 re-tagged img gradient: tag gate alone is NOT enough — poster palette gate kills it (got M ${rTag.score})`);
  const cV = mk(800, 300, [20, 20, 24]); checker(cV, 200, 50, 400, 220, 64, [180, 60, 60], [240, 240, 240]); // different frame
  const rV = mediaIdentityBand({ srcShot: src, cloneShot: cV, srcMedia: v, cloneMedia: [leaf(200, 50, 400, 220, 'video')], y0: 0, y1: 300 });
  log(rV.score === 1, `T13 legit video clone: real <video> at the box, different frame pixels → full credit (got ${rV.score})`);
  const cP = mk(800, 300, [20, 20, 24]); blit(src, 200, 50, 400, 220, cP, 200, 50, 400, 220);
  const rP = mediaIdentityBand({ srcShot: src, cloneShot: cP, srcMedia: v, cloneMedia: [leaf(200, 50, 400, 220, 'img')], y0: 0, y1: 300 });
  log(rP.score >= 0.9, `T13 legit poster img: captured-frame raster as <img> keeps ~full credit (got ${rP.score})`);
}
// ── T14 / ROUND-4: GRAIN-OVER-LQIP — structure-verified hf term (attack3 N1) ──
{
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const grain = (img, x, y, w, h, std) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const n = Math.round(((rnd() + rnd() + rnd()) / 3 - 0.5) * 2 * std * 1.73); const i = (yy * img.width + xx) * 4; for (let k = 0; k < 3; k++) img.data[i + k] = Math.max(0, Math.min(255, img.data[i + k] + n)); } };
  const src = mk(1440, 400, [248, 248, 250]); photo(src, 480, 60, 480, 280);
  const media = [leaf(480, 60, 480, 280)];
  const c0 = mk(1440, 400, [248, 248, 250]); lqip(src, 480, 60, 480, 280, 9, 8, c0, 480, 60);
  const r0 = mediaIdentityBand({ srcShot: src, cloneShot: c0, srcMedia: media, cloneMedia: media, y0: 0, y1: 400 });
  log(r0.identity <= 0.4, `T14 plain-LQIP control: id ≤ 0.4 (got ${r0.identity})`);
  for (const std of [8, 32, 64, 96]) {
    const cg = mk(1440, 400, [248, 248, 250]); lqip(src, 480, 60, 480, 280, 9, 8, cg, 480, 60); grain(cg, 480, 60, 480, 280, std);
    const rg = mediaIdentityBand({ srcShot: src, cloneShot: cg, srcMedia: media, cloneMedia: media, y0: 0, y1: 400 });
    log(rg.identity <= r0.identity, `T14 grain std=${std}: film-grain overlay ≤ plain LQIP (was 0.412..0.788 vs 0.336; got ${rg.identity} ≤ ${r0.identity})`);
  }
  // real-fine-detail control: the structure term must VERIFY genuine detail, not punish it — NN vertical stretch
  // (480×280 → 480×408, inside MI_AR_TOL) keeps id high because the detail-sign field survives resampling.
  const cs = mk(1440, 600, [248, 248, 250]); const src2 = mk(1440, 600, [248, 248, 250]); photo(src2, 480, 60, 480, 280); blit(src2, 480, 60, 480, 280, cs, 480, 60, 480, 408);
  const rs = mediaIdentityBand({ srcShot: src2, cloneShot: cs, srcMedia: [leaf(480, 60, 480, 280)], cloneMedia: [leaf(480, 60, 480, 408)], y0: 0, y1: 600 });
  log(rs.identity >= 0.9, `T14 real-detail control: NN 1.46x stretch keeps id ≥ 0.9 (got ${rs.identity}) — genuine fine structure verified, not punished`);
}

// ════ CLI proofs (file:// fixture; headless chromium; no network/WP/graded pages) ════
if (!PURE_ONLY) {
  const FIX = '/tmp/mediaid-fix';
  fs.mkdirSync(FIX, { recursive: true });
  const logo = mk(240, 160, [255, 255, 255]); checker(logo, 0, 0, 240, 160, 40, [255, 120, 0], [20, 60, 180]);
  const photo = mk(480, 280, [255, 255, 255]); hstripes(photo, 0, 0, 480, 280, 56, [10, 140, 120], [250, 250, 250]);
  fs.writeFileSync(path.join(FIX, 'logo.png'), PNG.sync.write(logo));
  fs.writeFileSync(path.join(FIX, 'photo.png'), PNG.sync.write(photo));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#111}
section{width:100%;min-height:300px;padding:40px 60px;box-sizing:border-box}
.dark{background:#0b0b10;color:#eee}
img{display:block;margin-top:16px}
</style></head><body>
<section><h1>Joist media identity fixture</h1><p>A static deterministic page with real imagery for the media-identity dimension self test.</p><img src="logo.png" width="240" height="160" alt="logo"></section>
<section class="dark"><h2>Second band with a photo</h2><p>This band carries a large textured image plus text content for the editability term.</p><img src="photo.png" width="480" height="280" alt="photo"></section>
<section><h2>Third band text only</h2><p>No imagery in this band so the dimension must report it as not applicable rather than zero.</p></section>
</body></html>`;
  fs.writeFileSync(path.join(FIX, 'source.html'), html);
  fs.writeFileSync(path.join(FIX, 'clone.html'), html); // byte-identical clone
  const GS = path.join(__dirname, 'grade-sections.mjs');
  // hermetic env: no perElement/responsive subprocesses (no live-source noise), no src cache for file:// anyway
  const baseEnv = { ...process.env, GRADER_SSIM_ONLY: '1', GRADER_NO_RESPONSIVE: '1' };
  delete baseEnv.GRADER_NO_MEDIAID;
  const run = (args, env) => spawnSync(process.execPath, [GS, ...args], { encoding: 'utf8', env, timeout: 300000 });
  const rj = (dir) => JSON.parse(fs.readFileSync(`${dir}/sections.json`, 'utf8'));

  // CLI-1: real --selftest, flag ON
  const st1 = run(['--source', `file://${FIX}/source.html`, '--selftest', '--out', '/tmp/mediaid-st-on'], baseEnv);
  const rep1 = rj('/tmp/mediaid-st-on');
  log(st1.status === 0 && (st1.stdout || '').includes('PASS (judge consistent)'), `CLI1 --selftest flag-ON: exit 0 + PASS line (exit ${st1.status})`);
  log(rep1.mediaIdentityMean === 1, `CLI1 selftest mediaIdentityMean === 1.0 (got ${rep1.mediaIdentityMean})`);
  log(rep1.detectors.mediaIdentity && rep1.detectors.mediaIdentity.meanRaw === 1 && rep1.detectors.mediaIdentity.folded === false,
    `CLI1 selftest RAW mean (pre-short-circuit) === 1.0 and folded:false (got raw ${rep1.detectors.mediaIdentity?.meanRaw})`);
  // CLI-2: real --selftest, flag OFF → PASS line byte-identical, zero media fields
  const st2 = run(['--source', `file://${FIX}/source.html`, '--selftest', '--out', '/tmp/mediaid-st-off'], { ...baseEnv, GRADER_NO_MEDIAID: '1' });
  const rep2 = rj('/tmp/mediaid-st-off');
  log(st2.status === 0 && st2.stdout === st1.stdout, `CLI2 selftest stdout byte-identical ON vs OFF (existing PASS line unchanged)`);
  log(rep2.mediaIdentityMean === undefined && rep2.detectors.mediaIdentity === undefined && rep2.perSection.every((s) => s.mediaIdentity === undefined),
    'CLI2 flag-OFF: ZERO media fields anywhere in the report (byte-identical legacy shape)');

  // CLI-3: non-selftest A/B — report-only proof: composite identical; ON minus media fields == OFF
  const on = run(['--source', `file://${FIX}/source.html`, '--clone', `file://${FIX}/clone.html`, '--out', '/tmp/mediaid-ab-on'], baseEnv);
  const off = run(['--source', `file://${FIX}/source.html`, '--clone', `file://${FIX}/clone.html`, '--out', '/tmp/mediaid-ab-off'], { ...baseEnv, GRADER_NO_MEDIAID: '1' });
  const ron = rj('/tmp/mediaid-ab-on'), roff = rj('/tmp/mediaid-ab-off');
  log(on.status === 0 && off.status === 0, `CLI3 A/B runs completed (exit ${on.status}/${off.status})`);
  log(ron.composite === roff.composite && ron.visualMean === roff.visualMean,
    `CLI3 composite byte-identical flag-ON vs flag-OFF (${ron.composite} == ${roff.composite}) — REPORT-ONLY proven`);
  const strip = (r) => {
    const c = JSON.parse(JSON.stringify(r));
    delete c.mediaIdentityMean; if (c.detectors) delete c.detectors.mediaIdentity;
    for (const s of c.perSection || []) { delete s.mediaIdentity; delete s.mediaPresence; delete s.srcMediaArea; delete s.mediaMissing; delete s.mediaWrong; }
    return JSON.stringify(c);
  };
  log(strip(ron) === strip(roff) && strip(roff) === JSON.stringify(roff),
    'CLI3 flag-ON report minus media fields deep-equals flag-OFF report (additive fields only)');
  log(typeof ron.mediaIdentityMean === 'number' && ron.detectors.mediaIdentity.bands.length >= 1,
    `CLI3 flag-ON report DOES carry the dim (mean ${ron.mediaIdentityMean}, ${ron.detectors.mediaIdentity.bands.length} media bands)`);
}

console.log(pass ? '\nMEDIAID SELFTEST: ALL PASS' : '\nMEDIAID SELFTEST: FAIL');
process.exit(pass ? 0 : 1);
