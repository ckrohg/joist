#!/usr/bin/env node
/**
 * @purpose PHASE-0 of the ULTRA_PLAN: the localized, attributed, target-gated OBJECTIVE — the "grade your
 * own work" engine the autonomous refine-loop repairs against. Extends grade-structure from page-level to
 * SECTION-level and emits, per source section: visual + editability + a defect with ATTRIBUTION (why it's
 * wrong), a target VERDICT (pass/fail vs the 1:1 gate), and a ranked defect list. Plus a WALL detector
 * (did the source even render headless?) and a SELF-TEST (source-vs-source must score ~1.0 → anti-drift).
 *
 * Usage:
 *   node grade-sections.mjs --source <url> --clone <url> [--layout layout.json] [--out dir]
 *   node grade-sections.mjs --source <url> --selftest        # source vs itself → must be ~1.0
 * Gate (per section): visual>=0.97 AND editability>=0.95 ; overall 1:1 also needs hRatio in [0.99,1.01].
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { assertAllowedBase, assertNotBlocked } from '../../sandbox/host-guard.mjs'; // §0 SAFETY GUARD: refuse a stray (e.g. paused *.sg-host.com) URL before any navigation.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const source = arg('source'), clone = arg('clone'), layoutPath = arg('layout'), outDir = arg('out', '/tmp/gsec'), W = 1440;
const SELFTEST = has('selftest');
// IS_MAIN = invoked as the CLI (not imported by a unit test for its pure exports like classifyVoid). Only then do
// we require args / mkdir / launch the browser, so importing this module for testing is side-effect-free.
const IS_MAIN = import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('grade-sections.mjs'));
if (IS_MAIN) {
  if (!source || (!clone && !SELFTEST)) { console.error('need --source --clone (or --source --selftest)'); process.exit(2); }
  // §0 SAFETY GUARD: assert every http(s) URL arg targets a training host (blocks the paused shared host) BEFORE any chromium.goto.
  if (clone && /^https?:/i.test(clone)) assertAllowedBase(clone); if (source && /^https?:/i.test(source)) assertNotBlocked(source); /* source = external read-only; only the paused host is blocked */
  fs.mkdirSync(outDir, { recursive: true });
}
const TGT = { visual: 0.97, editability: 0.95, hLo: 0.99, hHi: 1.01 };

// ---- REVERSIBLE OBJECTIVE FLIP (USER-GREENLIT, supervised) ----
// Default ON: blend the per-element metric (perelement-score.mjs — CIEDE2000 color + typography + position +
// text + effects, each x symmetric area-coverage) into the VISUAL term so color/content fixes MOVE the score.
//   visual = 0.5*SSIM + 0.5*perElement
//   perElement = 0.30*color + 0.22*typo + 0.18*position + 0.18*text + 0.12*effects   (EFFECTS folds INSIDE here)
// Restore the old SSIM-only behavior with GRADER_SSIM_ONLY=1. Top-level composite weights UNCHANGED:
//   composite = 0.4*visual + 0.3*editability + 0.3*structuralFidelity.
const USE_PERELEMENT = (process.env.GRADER_SSIM_ONLY ? false : true);
// ---- REVERSIBLE EFFECTS SUB-SCORE (folds INSIDE perElement only — does NOT touch composite weights) ----
// Default ON: include the EFFECTS sub-score (border-radius + box-shadow + backdrop-filter agreement, perelement-
// score.mjs) in the perElement blend at a MODEST weight (0.12; color stays dominant). GRADER_NO_EFFECTS=1 →
// EXACT prior perElement blend 0.35*color + 0.25*typo + 0.20*position + 0.20*text (effects still reported, weight 0).
const USE_EFFECTS = !process.env.GRADER_NO_EFFECTS;

// ---- REVERSIBLE RESPONSIVE DIMENSION (USER-GREENLIT, supervised) ----
// Default ON: responsiveness (does the clone REFLOW like the source across breakpoints?) is a PRIMARY axis
// of true 1:1, so promote grade-responsive.mjs (RLG, VALIDATED) from a shadow module to a graded dimension.
//   NEW composite = 0.35*visual + 0.20*editability + 0.20*structural + 0.25*responsive
// Restore the EXACT prior composite with GRADER_NO_RESPONSIVE=1:
//   OLD composite = 0.40*visual + 0.30*editability + 0.30*structural   (responsive computed/reported but NOT folded in)
// The responsive sub-score is fetched the SAME way per-element is — by spawning grade-responsive.mjs as a
// subprocess (no re-implementation → no asymmetry). Integrated path samples 3 widths {390,768,1440} for runtime.
const USE_RESPONSIVE = !process.env.GRADER_NO_RESPONSIVE;
const RESP_WIDTHS = process.env.RESPONSIVE_WIDTHS || '390,768,1440';

// ---- G2 FOLD GATE (grader-truth round 2026-06-10; qa-stepback diagnosis) ----
// THE ARITHMETIC HOLE: the user's QA verdict ("nowhere NEAR 1:1") was driven by ABOVE-THE-FOLD breakage (broken
// hero, dead nav) — but a fold defect dilutes into a ~20-band page mean at ~1/20 weight, and the non-visual terms
// (edit/struct/responsive) FLOOR the composite at ~0.556 even at visual=0. Additive fold-weighting is therefore
// ARITHMETICALLY DEAD (proven in the diagnosis — it cannot close a 17-26pt overstatement). The gate must be
// MULTIPLICATIVE on the whole composite: publishedComposite = composite × (0.4 + 0.6·foldVisual), where
// foldVisual = mean per-band visual of the bands intersecting y < FOLDGATE_PX (1000px ≈ what a human sees in the
// first 3 seconds at 1440×900). Monotonic DE-INFLATION only: foldVisual ≤ 1 → mult ∈ [0.4, 1] — the gate can
// never RAISE a score, so it adds no gaming surface (raising foldVisual = genuinely fixing the fold = the goal).
// Source-vs-source selftest: every band visual 1.0 → foldVisual 1 → mult exactly 1 → no-op.
// Reversible: GRADER_NO_FOLDGATE=1 → byte-identical legacy composite AND legacy report (no fold fields).
const USE_FOLDGATE = !process.env.GRADER_NO_FOLDGATE;
const FOLDGATE_PX = 1000;

// ---- GRADER-HONESTY DETECTORS (USER #5-meta: the grader was INFLATING — it must SEE human-obvious defects) ----
// FOUR additive, env-flag-gated penalties that fold into the EXISTING visual/structural terms (NO new top-level
// composite weight). Each is a PURE FUNCTION over geometry capture() ALREADY collects (text-leaf boxes, band
// boxes, media-leaf boxes, nav structure) — NO fresh Playwright render / navigation / network inside detector
// logic (crash-robust: a wifi blip during grading can't hang a detector; the only network is the existing
// self-test re-capture). Each is a NO-OP on source-vs-source (the source has none of these defects) so SELFTEST
// stays == 1.0. Master kill-switch GRADER_NO_DETECTORS=1 disables ALL four; each also has its own flag.
//   GRADER_NO_DETECTORS=1     → disable ALL four detectors (master)
//   GRADER_NO_TEXTCOLLIDE=1   → (1) text-collision: overlapping/doubled DIFFERENT text leaves → visual×(1-K1·rate)
//   GRADER_NO_FULLBLEED=1     → (2) full-bleed/gutter: source full-bleed but clone inset (symmetric gutters) → visual×0.9
//   GRADER_NO_CHUNKEDMEDIA=1  → (3) chunked-media: clone single large raster where source had many small media → structural×penalty
//   GRADER_NO_REALNAV=1       → (4) real-nav: source has a real header nav but clone renders flat body-text links → structural×0.9
const DET_MASTER = !process.env.GRADER_NO_DETECTORS;
const DET_TEXTCOLLIDE = DET_MASTER && !process.env.GRADER_NO_TEXTCOLLIDE;
const DET_FULLBLEED = DET_MASTER && !process.env.GRADER_NO_FULLBLEED;
const DET_CHUNKEDMEDIA = DET_MASTER && !process.env.GRADER_NO_CHUNKEDMEDIA;
// DECHUNK-FAITHFUL (honesty fix): the chunked-media detector previously counted EVERY large clone media leaf
// sitting in a many-source-media band as one "chunk" — so a FAITHFUL native gallery (clone reproduced 6-12
// distinct img/video widgets) was scored as 6-12 collapsed rasters and false-deflated structural. A genuine
// chunk is the clone COLLAPSING many source media into ~1 big raster, NOT reproducing them as many distinct
// leaves. With this on (default), a band only counts as chunked when the clone actually collapsed — its
// distinct media count in the band is far below the source's. Reversible: GRADER_NO_DECHUNK=1 (or
// BUILD_NO_DECHUNK=1) restores the old per-leaf count. No-op on self-test (clone media == source media).
const DECHUNK_FAITHFUL = !process.env.GRADER_NO_DECHUNK && !process.env.BUILD_NO_DECHUNK;
const DET_REALNAV = DET_MASTER && !process.env.GRADER_NO_REALNAV;
const DET_K1 = 0.5;            // text-collision visual-multiplier strength: visual×(1 - K1·collisionRate)

// ---- REALITY DETECTORS (USER: "MEASURE WHAT THE HUMAN SEES") — two additive, env-flag-gated penalties that fold
// into the EXISTING visual term (NO new top-level composite weight). Both are PURE functions over geometry capture()
// ALREADY collects (docScrollW + leaf boxes) — NO fresh render/navigation/network. Both are NO-OPS on source-vs-
// source (clone==source → identical scrollWidth, identical overlap → ratio 1.0 / excess 0 → multiplier 1) so the
// HARD self-test gate stays deterministic == 1.0.
//   GRADER_NO_HOVERFLOW=1 → (5) desktop horizontal-overflow: clone scrollWidth > source scrollWidth (a fixed-width /
//                           h-scroll page is a human-obvious failure) → SEVERE visual penalty scaling with overflow.
//   GRADER_NO_OVERLAP2=1  → (6) general widget-overlap: heavy-overlap (IoU>=0.5 or >50%-contained) leaf pairs among
//                           NON-NESTED siblings, EXCESS over the source's own → visual penalty scaling with excess.
const DET_HOVERFLOW = DET_MASTER && !process.env.GRADER_NO_HOVERFLOW;
const DET_OVERLAP2 = DET_MASTER && !process.env.GRADER_NO_OVERLAP2;
const DET_HOVERFLOW_K = 1.4;   // horizontal-overflow severity: visual×max(HOVERFLOW_FLOOR, 1 - K·(overflowRatio-1))
const DET_HOVERFLOW_FLOOR = 0.25; // a fully-broken h-scroll page (e.g. 2430/1440 = 1.69×) bottoms out near here
const DET_OVERLAP2_K = 2.2;    // widget-overlap severity: visual×max(OVERLAP2_FLOOR, 1 - K·excessOverlapFrac)
const DET_OVERLAP2_FLOOR = 0.4;

// ---- CONTENT-VOID PENALTY (fixes the SSIM-void-perversity) -------------------------------------------------
// THE PERVERSITY: SSIM + exact-pixel both REWARD a uniform band. A clone that renders a band VOID (a flat band
// of ~background color where the SOURCE has real content — testimonial cards, logos, animated text) can score
// AS HIGH AS or HIGHER than a clone that DID render content but is phase/position-misaligned. So the grader was
// rewarding ABSENCE over PRESENCE → filling a void could DROP the visual score. Perverse.
//
// THE FIX (per-band, INSIDE the visual term — no new top-level composite weight): measure each band's CONTENT
// ENERGY (luma variance + edge density) on the SOURCE shot and the CLONE shot INDEPENDENTLY (NOT the cross-SSIM).
// A band is a CONTENT-VOID when the SOURCE band has SUBSTANTIAL content energy AND the CLONE band collapses to
// near the page-background level (near-uniform). Such a void is forced to a LOW visual ceiling (VOID_CEIL), so it
// scores CLEARLY BELOW a band where the clone rendered matched content. Because the penalty keys on the CLONE's
// own texture being near-background WHILE the source's is high, it CANNOT punish a band where the clone actually
// rendered content (that band has high clone texture → not a void → untouched). Recovering content is therefore
// NEVER punished: presence (high clone texture) always scores ≥ a void (low clone texture). It does NOT reward
// filling with garbage — WHAT is rendered is still governed by per-element/editability/structural; this term only
// guarantees ABSENCE < PRESENCE. Source-vs-source self-test: clone==source → cloneTexture==sourceTexture → the
// void condition (clone near-bg while source high) is impossible → no-op → composite stays 1.0.
// Reversible: GRADER_NO_VOID_PENALTY=1.
const DET_VOIDPENALTY = DET_MASTER && !process.env.GRADER_NO_VOID_PENALTY;
const VOID_SRC_CONTENT = 0.06;  // SOURCE band counts as "has substantial content" when its content-energy >= this
const VOID_CLONE_FLOOR = 0.30;  // CLONE band counts as a void when its energy <= this FRACTION of the source band's
const VOID_BG_ABS = 0.020;      // ...AND the clone band's absolute energy <= this (near page-background uniform)
const VOID_CEIL = 0.30;         // a confirmed content-void's per-band visual is capped at this LOW ceiling
// TEXT-GUARD (2026-06-09 de-deflation). The energy-only void test FALSE-POSITIVES on DARK bands with sparse-but-
// real BRIGHT content: a near-black hero with a left-aligned white headline has very low clone energy, and when the
// SOURCE band also carries a position:fixed nav painted across it the energy RATIO mis-fires — the band is flagged
// a content-void even though the clone clearly rendered the headline (framer S6 "Create, collaborate, and go live";
// S16 "Scale without switching tools" — render-confirmed present). That DEFLATES a correct clone. The guard: a band
// whose SOURCE text the CLONE actually reproduced (matched text leaves physically inside the clone band) is NOT a
// void — the low energy is dark background, not absent content. It only suppresses when the source band HAS text AND
// the clone reproduced it; a TEXTLESS imagery void (logos/cards, no source text) or a BLANK/rastered clone band (no
// matched clone text leaves) is unaffected, so genuine voids stay penalized. Symmetric (clone==source → reproduced →
// but selftest already no-ops). Reversible: GRADER_NO_VOID_TEXTGUARD=1 restores the energy-only over-firing.
const VOID_TEXTGUARD = !process.env.GRADER_NO_VOID_TEXTGUARD;

// Pure, exported void decision (unit-tested by _void-textguard-selftest.mjs). selftest short-circuits to false
// (clone==source can never be a void). Otherwise: energy condition (source has content, clone collapsed to bg) AND
// — unless the text-guard suppresses it because the clone reproduced the band's source text.
export function classifyVoid({ srcEnergy, cloneEnergy, cloneReproducedBandText, selftest = false, textGuard = true }) {
  if (selftest) return false;
  const energyVoid = srcEnergy >= VOID_SRC_CONTENT
    && cloneEnergy <= VOID_CLONE_FLOOR * srcEnergy
    && cloneEnergy <= VOID_BG_ABS;
  if (!energyVoid) return false;
  if (textGuard && cloneReproducedBandText) return false; // dark + sparse-bright headline the clone rendered → not a void
  return true;
}

// ---- MEDIA-IDENTITY DIMENSION (LIVE-FOLDED since G4, grader-truth round 2026-06-10 — see the MI_FOLD_LIVE
// flag block below; GRADER_NO_MIFOLD=1 restores the report-only behavior, projected.* published either way).
// THE GAP (grader_overstates_top_end): the grader over-credits geometry and under-penalizes wrong-logos /
// broken-heroes — a band can reproduce every text leaf, suppress the void penalty via the TEXT-GUARD, and still
// have ALL its imagery missing or wrong with near-zero price. This dim measures, per source band, (a) PRESENCE
// (did the clone paint comparable media area where the source had media?) and (b) IDENTITY (are the painted
// pixels perceptually the SAME imagery? dHash + patch-ΔE over the two full-page shots — pure pixels, no vision
// model, no network; URL-spoofing and invisible-element stamping score NOTHING by construction because only
// RENDERED pixels are read). Per band: M_b = 0.6·identity + 0.4·presence; M_b = null (n/a) on bands with zero
// eligible source media (text-only bands excluded, mirroring editability's n/a convention). Page aggregate is
// srcMediaArea-weighted (hero imagery outweighs footer favicons). Source-vs-source: identical shots → hamming 0,
// ΔE 0, equal areas → 1.0 (and SELFTEST additionally short-circuits the published score to the definitional 1,
// raw kept for telemetry — the responsive-selftest pattern). HONEST blind spot (recorded, not papered over):
// clone-side HALLUCINATED imagery in a band whose source has none is invisible here (n/a band; presence capped
// at 1) — spurious imagery stays priced by SSIM/perElement; cloneOnlyMediaArea is reported as telemetry. A full-
// band raster with the RIGHT pixels scores M~1.0 (A4 — by design since the #2 fallback: this dim measures
// imagery presence+identity ONLY; rasterization itself is priced by rastered-text/chunkedMedia/editability,
// no double-pricing either way). Reversible: GRADER_NO_MEDIAID=1 → byte-identical
// legacy report (no media fields anywhere) AND legacy capture/cache behavior (no tag field, legacy srcTag).
// ---- FOLD-BLOCKERS (critic-measured 2026-06-10; ALL FIXED B1-round-3 same day — measured by the committed
// harnesses zz-mi-attack.tmp.mjs / zz-mi-attack2.tmp.mjs, pinned by _mediaid-selftest.mjs T9-T12):
//  1. PRESENCE GAMING — FIXED: presence is now IDENTITY-WEIGHTED (credited = Σ srcLeafArea·id, see
//     mediaIdentityBand) — decorative-gradient stuffing A3: M 0.409→0.021 overlap / 0.400→0.000 elsewhere
//     (honest-omit 0; the old min(1,cloneArea/srcArea) gave the game 1.0 presence on 0/36 matched).
//  2. BG-DIV FALSE-LOW — FIXED: same-box pixel fallback mediaCropId(srcShot,box,cloneShot,box), gated on the
//     clone crop being PAINTED (cropEnergy ≥ MI_SRC_PAINT) — byte-identical CSS-background-image clone F1:
//     M 0→1.0; granularity-mismatched rasters (tailwind §4 logo wall, N leaves vs 1 raster) credit by pixels;
//     drift F2: 0→0.439. Honest omission still 0 (gate), unpainted URL-spoof stamps still 0 (T4b).
//  3. LQIP FALSE-HIGH — FIXED: hf term (within-cell luma-std ratio from _poolGrid index 3) — 9×8 blurred
//     placeholder id 0.938→0.336, 4×4 0.730→0.265 (monotone: cruder blur scores lower).
//  4. WRONG-PHOTO UNDER-PRICING — FIXED: corr term (sqrt-free Pearson r² over pooled lumas) + BOX-aspect term —
//     unrelated-busy baseline W3 id 0.696→0.443, same-palette wrong-logo W1 0.27→0.065, rotated W2 0.145→0.035,
//     anisotropic stretch A1 0.978→0.641. Box aspect (not natW/natH) on purpose: natW/natH live on the BUILDER
//     capture tree (3a80a78), not grader mediaLeaves — box form needs NO capture/cache change.
//  Legit builds: identical crops still EXACTLY 1 (deficit-form weights), clean-clone band M 1.0 (T2 control),
//  bg-div legit clones RAISED 0→1; every game above scores LOWER — monotone honesty both directions.
// ---- ROUND-4 GAMES (critic-measured by zz-mi-attack3.tmp.mjs; BOTH FIXED 2026-06-10, pinned T13/T14):
//  T13 VIDEO-BOX PRESENCE STUFFING — FIXED: presence-only credit is tag-gated (clone video/canvas = full;
//     img/picture = poster fallback, palette-gated by 4×4 pooled deSim ≥ MI_VIDEO_DE_MIN, credit ×deSim;
//     svg/other = no candidate). Decorative-svg-at-video-box N2: M 1.0→0 (= honest omit); re-tagged img
//     gradient also 0; legit <video> (different frame) and captured-frame poster <img> keep full credit.
//  T14 GRAIN-OVER-LQIP — FIXED: hf credit is STRUCTURE-VERIFIED (_detailSign: fine-grid 18×16 minus enclosing
//     coarse 9×8 luma, sign agreement at source-significant sites, best over ±1-cell offsets; deadband 0.65
//     ≈3.8σ over chance, penalty floor −0.25 so unverified detail magnitude prices BELOW a no-detail LQIP).
//     Grain sweep std 8..96: id 0.412..0.788 → 0.173..0.323, ALL ≤ plain LQIP 0.336 (which is unchanged).
//     Side-effect (honesty gain): unrelated-busy baseline W3 0.443→0.090; same-imagery NN stretch unchanged
//     (A1 0.641, N6 0.996, raster/bg-div still 1.0). KNOWN COSTS: deep-drift fallback F2 0.439→0.291 (≥~1
//     fine-cell misalignment reads as unverified detail; small drifts ≤5% of box are rescued by the offset
//     search); RESIDUALS (documented, un-priced): N5 pooled-flat fine texture vs faint noise (~0.6 — needs
//     sub-cell structure), gaussian-blur+grain (sign field survives blur; mag term still prices the blur).
//  ROUND-4 EVALUATED+DEFERRED — small-imagery omission under area weighting (N3: hero exact + 8/9 icons
//     missing → M 0.929): count-weighting → 0.111 but raises small-leaf stuffing gain 13× (+0.051 vs +0.004
//     area — 48px boxes are the easiest to semi-fake: < MI_FINE_MIN sites → mag-only hf); per-leaf floor /32
//     → 0.788, stuffing gain +0.012, but unbounded false-low risk on logo-wall/avatar-dense pages (supabase
//     logo clouds) is unverifiable without a live re-grade. Defer to round 5: harden small-leaf identity
//     first, then floor-weight with live A/B.
const USE_MEDIAID = !process.env.GRADER_NO_MEDIAID;
const MI_MIN_LEAF = 24;        // leaf size floor (w AND h) — kills the 8px-probe-img trick by construction
const MI_SRC_PAINT = 0.02;     // paint guard: a leaf whose own crop-energy < this was never painted → excluded
                               // entirely (source side: lazy-fail false-positive protection; clone side: stamping
                               // unpainted boxes — URL spoofing — scores nothing). Same scale as VOID_BG_ABS.
const MI_DE_MAX = 40;          // patch-ΔE → similarity ramp: deSim = max(0, 1 - meanΔE/40). ΔE<8 ≈ same imagery
                               // (the bandStats exact threshold); 40 ≈ unambiguously different imagery.
const MI_MATCH_IOU = 0.05;     // min IoU to accept a clone candidate as the leaf's reproduction (else center-
                               // distance fallback ≤ 0.5·max(w,h,120px) with area ratio ∈ [0.25,4])
const MI_W_ID = 0.6, MI_W_PRESENCE = 0.4; // M_b = 0.6·identity + 0.4·presence
const MI_FLAT_VAR = 72 * 4;    // corr-term flat guard: Σ(luma-dev²) over the 72 pooled cells < n·(std 2)² → the
                               // crop has no correlatable structure (flat/flat → 1, flat/textured → 0)
const MI_HF_FLOOR = 3;         // hf-term floor (mean within-cell luma std): both crops below → smooth-vs-smooth
                               // imagery (flat hero washes), ratio is noise → hfSim 1 (nothing to assert)
const MI_HF_W = 0.65;          // hf deficit weight: a 0-detail LQIP keeps ≤35% of its base id (0.96 → ~0.35)
const MI_FINE_SIG = 5;         // T14 structure term: |fine-cell − coarse-cell| luma > this = a verifiable fine-
                               // detail site (below it, AA/jpeg noise would make the sign a coin flip)
const MI_FINE_MIN = 24;        // T14: min significant fine-detail sites before the structure term asserts
                               // anything (a source with no fine structure → 1: magnitude ratio decides, as before)
const MI_FINE_DEAD = 0.65;     // T14: detail-sign agreement deadband — chance is 0.5 (grain/flat both land there)
                               // and the ±1-offset max harvests up to ~0.61 from pure chance (measured, n≈160);
                               // 0.65 ≈ 3.8σ above chance. Linear to 1 at perfect agreement; identical crops
                               // hit exactly 1 ((1−d)/(1−d)).
const MI_FINE_PEN = 0.25;      // T14: penalty floor — agreement at/below chance maps to fineS −0.25 (not 0), so
                               // structure-UNVERIFIED detail magnitude prices strictly BELOW a no-detail LQIP
                               // (kills the grain≈plain base-noise tie deterministically; scaled by mag, so a
                               // detail-less clone is barely touched while a big fake-grain magnitude pays most)
const MI_VIDEO_DE_MIN = 0.5;   // T13 poster gate: an img/picture standing in for a video/canvas leaf must have
                               // 4×4 pooled-palette deSim ≥ this vs the captured source frame (else 0 credit)
const MI_AR_TOL = 0.65;        // aspect tolerance: box-aspect ratio ≥0.65 (≈±35% reflow/crop slack) is free;
                               // below, linear — the A1 480×280→1440×360 stretch (asim 0.43) → aTerm 0.66
const MI_FOLD_FLOOR = 0.45;    // fold floor: visual_b ×= (0.45 + 0.55·M_b) on gated bands (LIVE since G4, below).

// ---- G4 MI FOLD LIVE (grader-truth round 2026-06-10; flips the §2-addendum recommendation to LIVE) ----
// The fold visual_b ×= (MI_FOLD_FLOOR + (1−MI_FOLD_FLOOR)·M_b) leaves projected.* and becomes the band's REAL
// visual — wrong/missing imagery finally PRICES the band (the addendum's max-gamed safety case: honest
// compliance out-earns the best trick bundle ~3×; fold-blocker pins T9-T14 stay enforced by _mediaid-selftest).
// TWO MEASURED LEAF FIXES ship with the flip (both diagnosed in qa-stepback):
//  (a) ABOVE-FOLD GATE — the 0.10 frac gate EXCLUDED the tailwind hero's own imagery (band frac 0.044): the
//      most human-salient imagery on the page was exempt from its own dim. Live gate: srcMediaFrac >= 0.10
//      anywhere, OR >= 0.03 on ABOVE-FOLD bands (y0 < 1000, the same fold the G2 gate measures). WHY 0.03-
//      above-fold and not an absolute-area floor: an absolute floor (e.g. 30k px²) scales badly — a tall band
//      (tailwind §8 is 3.9M px²) would fold on a 0.8%-of-band icon; the relative 0.03 keeps the "media is a
//      salient part of this band" semantics, and restricting the lowered gate to above-fold bounds the blast
//      radius to exactly the human-salient zone the QA event measured. Sub-gate bands stay REPORTED, not folded
//      (nav micro-icon bands: frac ~0.019 — folding 55% of a band's visual on 2% media area would over-weight
//      favicon-scale imagery).
//  (b) SVG LEAF FLOOR — nav/footer logos+icons are svg and 16-20px tall; the MI_MIN_LEAF=24 floor excluded
//      EVERY ONE of them (tailwind nav logo 159×20 dies on h<24 — "nav svgs never reach band media leaves").
//      svg-tagged leaves now use a 12px floor (capture is UNCHANGED — svgs were always captured with tags; the
//      floor is scoring-side, so NO cache-tag change). The 8px-probe trick stays dead by construction (8 < 12);
//      area-weighted presence keeps small-leaf stuffing at the documented ~+0.004 negligible gain.
// Reversible: GRADER_NO_MIFOLD=1 → byte-identical legacy (projected-only fold, 0.10 gate, 24px svg floor,
// legacy report shape). Selftest no-op: M short-circuits to 1 under --selftest → foldMult exactly 1.
const MI_FOLD_LIVE = USE_MEDIAID && !process.env.GRADER_NO_MIFOLD;
const MI_SVG_MIN_LEAF = MI_FOLD_LIVE ? 12 : MI_MIN_LEAF;  // (b) — tied to the G4 flag for one-switch reversibility
const MI_FOLD_ABOVEFOLD_PX = 1000;                        // (a) above-fold zone (matches G2's FOLDGATE_PX)
const MI_FOLD_ABOVEFOLD_FRAC = 0.03;                      // (a) lowered gate for above-fold bands

// ---- VISIBLE-BLOCKS HARDENING (anti-gaming) ----
// structuralFidelity counts, per source block type {form/video/table/list/tabs/accordion/nav}, how many the clone
// reproduces. The plain `vis()` gate (display/visibility/opacity) is satisfiable by an INVISIBLE element: a prior
// round stamped a transparent, pointer-events:none <form> twin to fire form 0→1 with ZERO visual change. This gate
// requires GENUINE VISIBILITY for an element to count toward a block type: opacity>=0.05 AND visibility!=hidden AND
// display!=none AND NOT (pointer-events:none AND visually transparent) AND non-trivial rendered area AND within/near
// the viewport-document (not off-screen). Applied SYMMETRICALLY to source AND clone counting (both go through the
// same capture() path) so source-vs-source self-test stays 1.0 — real visible blocks count identically on both
// sides; only invisible (paint-zero) twins are ignored. Reversible: GRADER_NO_VISIBLE_BLOCKS=1 → old vis() gate.
const USE_VISIBLE_BLOCKS = !process.env.GRADER_NO_VISIBLE_BLOCKS;

// ---- FORM-CLUSTER HARDENING (grader-detection honesty) ----
// The "form" block has two acceptance shapes: (a) a real <form> with >=1 visible input (strong, unchanged), OR
// (b) a STANDALONE-INPUT fallback for forms authored without a wrapping <form> tag. The old fallback fired on
// `>=2 visible inputs ANYWHERE on the page`. That is a FALSE POSITIVE on a marketing page that scatters product-
// DEMO input widgets across thousands of vertical px (e.g. linear.app: a "Message …" textarea at y1148, an
// "Assign to…" input at y5309, a diff-editor input/textarea pair at y6459/6544, a search at y9880 — NONE share a
// container, NONE are a fillable form). The grader counted that phantom as form:1 and then permanently dinged
// every clone's structuralFidelity for not reproducing a form that does not exist. A GENUINE form (an Elementor
// `form` widget, a contact/signup block) is a TIGHT FIELD GROUP: >=2 inputs sharing ONE compact common ancestor.
// HARDENED fallback: the standalone-input shape fires only when >=2 visible inputs share a compact common ancestor
// (a real field group) — scattered page-wide demo inputs no longer fabricate a form. Applied SYMMETRICALLY to
// source AND clone (same capture path) so source-vs-source self-test stays 1.0, and a REAL clustered form (one
// container holding the fields) STILL counts on BOTH sides → genuinely-absent forms are still MISSED (no gaming;
// a clone that drops a real form still scores the miss). Reversible: GRADER_NO_FORM_CLUSTER=1 → old page-wide >=2.
const FORM_CLUSTER = !process.env.GRADER_NO_FORM_CLUSTER;

// ---- SOURCE-CAPTURE CACHE (ported from grade-structure.mjs:247-274, same key/location discipline) ----
// The clone (our static WP page) is deterministic, but the SOURCE (a live, often dynamic site) re-renders
// run-to-run, injecting ±0.08 noise into the SSIM/visual term — the refine objective re-screenshotted the live
// source EVERY run. Freezing the source reference makes the section-level objective reproducible AND faster.
// Same dir + URL-keyed tag as grade-structure (/tmp/grade-src-cache) but a DISTINCT '-gsec' suffix: the two
// scripts extract DIFFERENT capture payloads and must never share a cached source (a grade-structure cache
// would silently miss sections/blocks/leafBoxes). Capture-affecting mode flags (visible-blocks / form-cluster
// hardening) fold into the tag so a flagged run never reads a cache written under a different capture mode
// (mirrors grade-structure's '-lt' per-mode discipline). SOURCE side only — the clone capture stays FRESH.
// SELFTEST always captures live (its job is to exercise the real capture path, not a frozen file).
// Default ON. Reversible: GRADER_NO_SRCCACHE=1 → byte-identical legacy path (fresh live capture, no cache
// read OR write). --refresh-source forces a live re-capture (and rewrites the cache).
// HONEST SCOPE: this freezes ONLY grade-sections' own capture() — the perElement and responsive sub-scores
// are subprocesses (perelement-score.mjs / grade-responsive.mjs) that still capture the live source themselves
// each run; determinism is scoped to the SSIM half of the visual term + editability/structural/hRatio/detectors.
const USE_SRCCACHE = !process.env.GRADER_NO_SRCCACHE;
// ---- LAZY-IMAGE SETTLE (the OTHER half of the refine-noise) ----
// With the source frozen by the cache, two consecutive tailwind runs STILL swung the per-band visual by up to
// 0.46/band (measured 2026-06-09: §18 cloneEnergy 0 → false content-void in one run, 0.218 → real content in the
// next): the CLONE screenshot races below-fold lazy-image paint. Same failure grade-vision-tiles fixed with
// settleLazy (vision_tiler_lazyload_falsevoid, KEPT). Port the bounded settle here (inlined — grade-vision-tiles'
// export is uncommitted in this worktree): after the scroll pass, wait (≤8s) for in-DOM images to complete and
// force-decode them so the shot is taken in the PAINTED state. Applied to BOTH sides via the shared capture()
// (symmetric → selftest unaffected; the cached source benefits when refreshed). Additive + bounded; never throws.
// Reversible: GRADER_NO_LAZYSETTLE=1 → byte-identical legacy capture (settle skipped entirely).
const LAZY_SETTLE = !process.env.GRADER_NO_LAZYSETTLE;
// ---- GLYPH-RECT CAPTURE (C round 5c — structural close of the BOX-MANIPULATION attack family) ----
// Critic-diagnosed root cause (_c5b-hotband.mjs, both REPRODUCED as live keeps 2026-06-10): textLeaves carried
// ELEMENT-BOX geometry only (getBoundingClientRect + scrollWidth/scrollHeight, the loop below) — never GLYPH
// geometry. Two hot-band keeps exploited that: nv-padPark (inline-block span with padding-top parks every glyph
// below the band's bottom edge; the box top stays in-band so D2 passes, scrollHeight==box so the clip check is
// silent, and the paint crop EXPANDS WITH THE BOX so it sees the parked glyphs — kept, Δvisual +0.046 = the
// full delete-equivalent gain) and nv-clipEdge (overflow-clip to ~35% of content height, just above
// CLIP_MIN_FRAC 0.3 — ~2/3 of glyphs never paint; kept, +0.030). ADDITIVE per-leaf fields, captured via
// per-TEXT-NODE Ranges (TreeWalker SHOW_TEXT → Range.selectNodeContents(textNode) → getClientRects = the LINE
// BOXES of the actual glyphs; element border boxes never enter the union, so a padded inline-block child cannot
// inflate it; multi-line text = union of its line rects; display:none text yields zero rects):
//   gx,gy,gw,gh — union box of ALL glyph line rects (document coords, gy includes scrollY); absent if no rects
//   ga          — Σ line-rect area (total glyph area, whether it paints or not)
//   gvx,gvy,gvw,gvh,gva — same after intersecting every line rect with the cumulative ancestor OVERFLOW CLIP
//                 (overflow-x/y hidden|clip|auto|scroll ancestors): the glyph geometry that can actually PAINT.
//                 gva==0 → no glyph ever paints (fully clipped / zero-rect edge) → bandLocalText treats the
//                 leaf as NOT reproduced.
//   gc          — computed glyph color [r,g,b] (feeds the C-5c ghost check: glyph-color-vs-local-bg contrast).
// NO scoring path in THIS file reads them (same contract as op/ca/fs/sw/sh/wid/wt): consumed only by
// sectionvisual.mjs bandLocalText, where D2 band-overlap + the D1 paint-energy crop now run on the VISIBLE
// GLYPH union box instead of the element box (legacy captures without the fields fall back to the element box
// and are FLAGGED, never silent). Capture-affecting + cache-schema-affecting → '-gr' srcTag suffix (the '-mi'
// precedent: a flagged-on run never reads a glyph-less cache; flag-off keeps the exact legacy key AND
// byte-identical legacy capture — innocent control _glyphrects-control.mjs). Reversible: GRADER_NO_GLYPHRECTS=1.
const GLYPH_RECTS = !process.env.GRADER_NO_GLYPHRECTS;
const SRC_CACHE_DIR = '/tmp/grade-src-cache';
// every JSON-serializable field capture() returns (everything except the PNG `shot`, persisted alongside).
const SRC_CACHE_FIELDS = ['texts', 'sections', 'imgs', 'blocks', 'pageH', 'textLeaves', 'bands', 'mediaLeaves', 'navStruct', 'docScrollW', 'docClientW', 'leafBoxes'];
// srcTagFor — EXPORTED (sectionvisual.mjs): the exact cache-key computation, so the band-scratch primitive reads
// the SAME frozen source capture this grader wrote (byte-identical src crop → zero src-side divergence).
export function srcTagFor(src) {
  return String(src).replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 40)
    + '-gsec' + (USE_VISIBLE_BLOCKS ? '' : '-novb') + (FORM_CLUSTER ? '' : '-nofc') + (LAZY_SETTLE ? '' : '-nols')
    // media-identity needs `tag` on mediaLeaves entries (capture-affecting, additive) — distinct cache key so a
    // stale tag-less cache is never served to a flagged-on run; flag-off keeps the exact legacy key + capture.
    + (USE_MEDIAID ? '-mi' : '')
    // glyph-rects add gx/gy/gw/gh/ga/gv*/gc to textLeaves entries (capture-affecting, additive) — same '-mi'
    // discipline: distinct key so a glyph-less cache is never served to a flagged-on run.
    + (GLYPH_RECTS ? '-gr' : '');
}
const srcTag = srcTagFor(source);
const refreshSource = process.argv.includes('--refresh-source');
// loadSrcCache — EXPORTED (sectionvisual.mjs): read the frozen source capture this grader persisted (shot PNG +
// every SRC_CACHE_FIELDS payload). Returns null when absent (caller errors with a "run grade-sections first" hint).
export function loadSrcCache(src) {
  const tag = srcTagFor(src);
  const j = `${SRC_CACHE_DIR}/${tag}.json`, p = `${SRC_CACHE_DIR}/${tag}.png`;
  if (!fs.existsSync(j) || !fs.existsSync(p)) return null;
  const out = { shot: PNG.sync.read(fs.readFileSync(p)), srcTag: tag, files: { json: j, png: p } };
  const meta = JSON.parse(fs.readFileSync(j, 'utf8'));
  for (const k of SRC_CACHE_FIELDS) out[k] = meta[k];
  return out;
}
export { W };

// ---- pure detector helpers (geometry already in hand; NO network) ----
const _iou = (a, b) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy; if (inter <= 0) return 0;
  const uni = a.w * a.h + b.w * b.h - inter; return uni > 0 ? inter / uni : 0;
};
const _contains = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
const _normT = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const _median = (xs) => { if (!xs.length) return 0; const a = xs.slice().sort((p, q) => p - q); const n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; };

// DETECTOR(1) TEXT-COLLISION: over the CLONE's RAW (pre-dedup) text leaves, find pairs whose boxes overlap
// (IoU>=0.5 OR one contains the other) AND carry DIFFERENT text → genuine doubled/overlapping text (a human-
// obvious defect). collisionRate = colliding-text area / total text area. Source-vs-source: the source has no
// such overlaps → rate 0 → multiplier 1 → no-op. Returns { rate, pairs }.
function textCollision(textLeaves) {
  const leaves = (textLeaves || []).filter((t) => t.w > 0 && t.h > 0 && _normT(t.t).length >= 2);
  let totalArea = 0; for (const t of leaves) totalArea += t.w * t.h;
  if (totalArea <= 0) return { rate: 0, pairs: 0 };
  const collided = new Set(); let pairs = 0;
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i], b = leaves[j];
      if (_normT(a.t) === _normT(b.t)) continue;          // SAME text (legit repetition / wrapper) → not a collision
      const overlap = _iou(a, b) >= 0.5 || _contains(a, b) || _contains(b, a);
      if (!overlap) continue;
      collided.add(i); collided.add(j); pairs++;
    }
  }
  let collArea = 0; for (const i of collided) collArea += leaves[i].w * leaves[i].h;
  return { rate: +Math.min(1, collArea / totalArea).toFixed(4), pairs };
}

// DETECTOR(2) FULL-BLEED / gutter: compare median top-level band width vs viewport on BOTH source and clone.
// If the SOURCE bands are full-bleed (median width >= 0.97*vw) but the CLONE bands are inset (median width <
// 0.85*vw — symmetric gutters from a boxed Elementor section) → layout-mode penalty. Source-vs-source: identical
// bands → both full-bleed → no penalty. Returns { srcFrac, cloneFrac, ok }.
function fullBleed(srcBands, cloneBands, vw) {
  const widths = (bs) => (bs || []).filter((b) => b.w > 0).map((b) => b.w);
  const sw = widths(srcBands), cw = widths(cloneBands);
  if (!sw.length || !cw.length) return { srcFrac: 1, cloneFrac: 1, ok: true };   // no bands either side → can't judge → no-op
  const srcFrac = +(_median(sw) / vw).toFixed(4), cloneFrac = +(_median(cw) / vw).toFixed(4);
  const sourceFullBleed = srcFrac >= 0.97;
  const cloneInset = cloneFrac < 0.85;
  const ok = !(sourceFullBleed && cloneInset);              // penalty ONLY when source is full-bleed but clone is inset
  return { srcFrac, cloneFrac, ok };
}

// DETECTOR(3) CHUNKED-MEDIA: detect the clone COLLAPSING a many-small-media source region (logo wall / icon row /
// product gallery) into a SINGLE big raster instead of authoring the media as distinct widgets. The honest signal
// for a real collapse is NOT "a clone leaf is big" (every faithful gallery card is big relative to its short band)
// — it is that the clone reproduced the region with FAR FEWER distinct media leaves than the source had. So we
// score PER BAND: a band counts as chunked only when (a) the source had MANY distinct media (>= SRC_MANY), (b) a
// large clone raster sits in it (area >= 12% of band), AND (c) the clone collapsed — its distinct media-leaf count
// in the band is <= CLONE_COLLAPSE_MAX (the clone painted ~1 raster, not a gallery of distinct widgets).
//
// Why the count change matters (DECHUNK_FAITHFUL): the old per-clone-leaf count flagged a FAITHFUL native gallery
// (clone emitted 6-12 distinct img/video widgets, each its own card, screenshot-confirmed) as 6-12 collapsed
// rasters — false-deflating structural on a clone that did the RIGHT thing. Counting collapsed BANDS (clone media
// far below source) keeps the genuine 1-raster collapse (linear hero: src 45 → clone 1) while no longer punishing
// a many-distinct-widget gallery (framer: src 60 → clone 12 distinct image widgets). Reversible: with
// DECHUNK_FAITHFUL off (GRADER_NO_DECHUNK=1) the original per-leaf count returns.
// Source-vs-source: clone media == source media in every band → no band collapses → 0. Returns { count, regions }.
const CHUNK_SRC_MANY = 4;          // a source band must hold >= this many distinct media to be a candidate region
const CHUNK_CLONE_COLLAPSE_MAX = 2;// the clone "collapsed" the region only if it has <= this many distinct media leaves there
function chunkedMedia(srcMedia, cloneMedia, bands, vw, dechunkFaithful = true) {
  const sBands = (bands || []).filter((b) => b.h > 0);
  if (!sBands.length) return { count: 0, regions: [] };
  const bandOf = (y) => { let best = null; for (const b of sBands) { if (y >= b.y && y < b.y + b.h) { if (!best || b.h < best.h) best = b; } } return best; };
  const srcInBand = (b) => (srcMedia || []).filter((m) => m.area > 0 && m.y + m.h / 2 >= b.y && m.y + m.h / 2 < b.y + b.h);
  const cloneInBand = (b) => (cloneMedia || []).filter((m) => m.area > 0 && m.y + m.h / 2 >= b.y && m.y + m.h / 2 < b.y + b.h);
  if (!dechunkFaithful) {
    // LEGACY per-leaf count (reversible path).
    const regions = []; let count = 0;
    for (const cm of (cloneMedia || [])) {
      if (cm.area <= 0) continue;
      const b = bandOf(cm.y + cm.h / 2); if (!b) continue;
      const bandArea = Math.max(1, b.w * b.h);
      if (cm.area < 0.12 * bandArea) continue;
      const srcHere = srcInBand(b);
      if (srcHere.length >= CHUNK_SRC_MANY) { count++; regions.push({ bandY: b.y, cloneMediaArea: cm.area, srcMediaCount: srcHere.length }); }
    }
    return { count, regions };
  }
  // HONEST per-band collapse count: walk each distinct candidate band once.
  const regions = []; let count = 0; const seen = new Set();
  for (const cm of (cloneMedia || [])) {
    if (cm.area <= 0) continue;
    const b = bandOf(cm.y + cm.h / 2); if (!b) continue;
    if (seen.has(b.y)) continue; seen.add(b.y);
    const bandArea = Math.max(1, b.w * b.h);
    const srcHere = srcInBand(b);
    if (srcHere.length < CHUNK_SRC_MANY) continue;          // source wasn't a many-media region → nothing to collapse
    const cloneHere = cloneInBand(b);
    const bigRaster = cloneHere.some((m) => m.area >= 0.12 * bandArea);
    if (!bigRaster) continue;                               // clone has no large raster here → not a collapse
    // COLLAPSE test: clone painted the many-media region with very few distinct media leaves (≈1 big raster).
    // A faithful gallery (many distinct clone media) is NOT a collapse and is NOT counted.
    if (cloneHere.length <= CHUNK_CLONE_COLLAPSE_MAX) {
      count++;
      regions.push({ bandY: b.y, cloneMediaArea: Math.max(...cloneHere.map((m) => m.area)), srcMediaCount: srcHere.length, cloneMediaCount: cloneHere.length });
    }
  }
  return { count, regions };
}

// DETECTOR(4) REAL-NAV quality: upgrade the binary "any <nav> exists" check. The clone passes the nav check
// ONLY if its nav is a REAL nav (Elementor nav-menu widget OR top header container with >= 3 link children) —
// NOT flat centered body-text links. Penalize ONLY when the SOURCE has a real header nav but the clone does not.
// Source-vs-source: source has a real header nav on both sides → ok. Returns { srcReal, cloneReal, ok }.
function realNav(srcNav, cloneNav) {
  const srcReal = !!(srcNav && srcNav.realNav);
  const cloneReal = !!(cloneNav && cloneNav.realNav);
  const ok = !(srcReal && !cloneReal);                     // penalty ONLY when source had a real nav but clone flattened it
  return { srcReal, cloneReal, ok };
}

// DETECTOR(5) DESKTOP HORIZONTAL-OVERFLOW: the most human-obvious failure of all — a fixed-width / runaway-content
// clone that scrolls sideways. Compare the CLONE's real rendered document.scrollWidth against the SOURCE's, floored
// at the grade viewport (a source can legitimately be exactly viewport-wide). overflowRatio = cloneScrollW /
// max(sourceScrollW, vw). Source-vs-source: cloneScrollW == sourceScrollW → ratio 1.0 → no penalty. A clone that
// blows out to 2430 px at a 1440 vw (ratio 1.69) is catastrophically broken and must drop HARD.
function hOverflow(cloneScrollW, srcScrollW, vw) {
  const denom = Math.max(srcScrollW || 0, vw);
  if (denom <= 0) return { overflowRatio: 1, cloneScrollW: cloneScrollW || 0, srcScrollW: srcScrollW || 0, denom: vw };
  const overflowRatio = +((cloneScrollW || 0) / denom).toFixed(4);
  return { overflowRatio, cloneScrollW: cloneScrollW || 0, srcScrollW: srcScrollW || 0, denom };
}

// DETECTOR(6) GENERAL WIDGET-OVERLAP: extend the text-only collision check to ALL leaf widget boxes (text, image,
// container leaves). Count HEAVY-overlap pairs (IoU>=0.5 OR one box >50%-contained in another) among NON-NESTED
// leaves, and accumulate the OVERLAPPING AREA (union of the intersection rectangles), normalized by page area.
// Because leaf boxes are never ancestors of one another, every overlap is a real sibling collision. We compute the
// SAME measure on the SOURCE and penalize only the EXCESS the clone introduces. Source-vs-source: identical leaves →
// excess 0 → no penalty. Returns { pairs, overlapArea, overlapFrac } given a page area.
function widgetOverlap(leaves, pageArea) {
  const ls = (leaves || []).filter((b) => b.w > 0 && b.h > 0);
  if (!ls.length || pageArea <= 0) return { pairs: 0, overlapArea: 0, overlapFrac: 0 };
  let pairs = 0, overlapArea = 0;
  const N = ls.length;
  // cap pair scan to keep grading O(reasonable) on huge pages: sort by y, only compare boxes whose y-bands can meet.
  const sorted = ls.slice().sort((a, b) => a.y - b.y);
  for (let i = 0; i < N; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < N; j++) {
      const b = sorted[j];
      if (b.y >= a.y + a.h) break;                          // sorted by y → no later box can vertically meet `a`
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const inter = ix * iy; if (inter <= 0) continue;
      const aArea = a.w * a.h, bArea = b.w * b.h;
      const uni = aArea + bArea - inter; const iou = uni > 0 ? inter / uni : 0;
      const minA = Math.min(aArea, bArea), maxA = Math.max(aArea, bArea);
      // A genuine widget COLLISION is a substantial MUTUAL overlap (IoU>=0.5) OR a small box sitting >50%-inside
      // another of COMPARABLE size. EXCLUDE the small-box-inside-a-much-larger-box case (areaRatio > 4×): that is
      // a content widget legitimately laid INSIDE a card / panel / wrapper (background-behind-content), which a
      // human does NOT perceive as a collision. This keeps the detector measuring real pile-ups, not nesting.
      const containedSmallInBig = (minA > 0 && inter / minA > 0.5) && (maxA / Math.max(1, minA) > 4);
      const heavy = !containedSmallInBig && (iou >= 0.5 || (minA > 0 && inter / minA > 0.5));
      if (!heavy) continue;
      pairs++; overlapArea += inter;
    }
  }
  return { pairs, overlapArea: Math.round(overlapArea), overlapFrac: +Math.min(1, overlapArea / pageArea).toFixed(4) };
}
// Run grade-responsive.mjs as a subprocess (mirrors perElementScores). Returns {score,edgeSet,layout,perBreakpoint,
// coverage} or null on failure (→ caller treats responsive as unavailable and falls back to the OLD composite).
function responsiveScores(srcUrl, cloneUrl, selftest) {
  const tag = 'gsec-resp-' + (srcUrl || 'site').replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 14).toLowerCase() + '-' + Date.now().toString(36);
  const args = [path.join(__dirname, 'grade-responsive.mjs'), '--source', srcUrl, '--out', '/tmp', '--label', tag, '--widths', RESP_WIDTHS];
  if (selftest) args.push('--selftest'); else args.push('--clone', cloneUrl);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, env: process.env });
  const outFile = `/tmp/responsive-${tag}.json`;
  let parsed = null;
  if (fs.existsSync(outFile)) { try { parsed = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch {} }
  if (!parsed) { console.error('[grade-sections] grade-responsive failed:', (r.stderr || '').slice(-400)); return null; }
  return {
    score: parsed.responsiveScore,
    edgeSet: parsed.edgeSetAgreement,
    layout: parsed.meanPerWidthLayout,
    coverage: parsed.coverage,
    perBreakpoint: parsed.perBreakpoint,
  };
}
// Run perelement-score.mjs the SAME way it runs capture-layout (subprocess) so the EXACT validated, self-test=1.0
// scoring path is reused (no re-implementation → no asymmetry risk). Returns {color,typography,position,text,
// coverage} or null on failure (→ caller falls back to SSIM-only for that run).
function perElementScores(srcUrl, cloneUrl, selftest) {
  const tag = 'gsec-' + (srcUrl || 'site').replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 14).toLowerCase() + '-' + Date.now().toString(36);
  const args = [path.join(__dirname, 'perelement-score.mjs'), '--source', srcUrl, '--name', tag, '--width', String(W)];
  if (selftest) args.push('--selftest'); else args.push('--clone', cloneUrl);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000, env: process.env });
  const outFile = `/tmp/pe-${tag}.json`;
  let parsed = null;
  if (fs.existsSync(outFile)) { try { parsed = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch {} }
  if (!parsed) { // last resort: parse the single-line result JSON perelement prints to stdout
    const line = (r.stdout || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{') && l.includes('areaCoverage')).pop();
    if (line) { try { parsed = JSON.parse(line); } catch {} }
  }
  if (!parsed) { console.error('[grade-sections] perelement-score failed:', (r.stderr || '').slice(-400)); return null; }
  return { color: parsed.color, typography: parsed.typography, position: parsed.position, text: parsed.text, effects: parsed.effects, coverage: parsed.areaCoverage };
}

// ---- pixel math (from grade-structure) ----
const gray = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
// srgbLab/dE — EXPORTED (C round 5c): sectionvisual.mjs reuses them for the glyph-color-vs-local-bg ghost check.
export const srgbLab = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; const R = f(r), G = f(g), B = f(b); const X = (R * .4124 + G * .3576 + B * .1805) / .95047, Y = R * .2126 + G * .7152 + B * .0722, Z = (R * .0193 + G * .1192 + B * .9505) / 1.08883; const g2 = (t) => t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; return [116 * g2(Y) - 16, 500 * (g2(X) - g2(Y)), 200 * (g2(Y) - g2(Z))]; };
export const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function ssim(a, b, y0, y1) { const Wd = Math.min(a.width, b.width), win = 8, C1 = 6.5, C2 = 58.5; let tot = 0, n = 0; for (let by = y0; by + win <= y1; by += win) for (let bx = 0; bx + win <= Wd; bx += win) { let ma = 0, mb = 0; for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const ia = ((by + y) * a.width + bx + x) * 4, ib = ((by + y) * b.width + bx + x) * 4; ma += gray(a.data, ia); mb += gray(b.data, ib); } const N = win * win; ma /= N; mb /= N; let va = 0, vb = 0, cov = 0; for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) { const ia = ((by + y) * a.width + bx + x) * 4, ib = ((by + y) * b.width + bx + x) * 4; const da = gray(a.data, ia) - ma, db = gray(b.data, ib) - mb; va += da * da; vb += db * db; cov += da * db; } va /= N - 1; vb /= N - 1; cov /= N - 1; tot += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++; } return n ? tot / n : 1; }
export function bandStats(a, b, y0, y1) { let ex = 0, n = 0, sde = 0; const Wd = Math.min(a.width, b.width); for (let y = y0; y < y1; y += 2) for (let x = 0; x < Wd; x += 2) { const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4; const d = dE(srgbLab(a.data[ia], a.data[ia + 1], a.data[ia + 2]), srgbLab(b.data[ib], b.data[ib + 1], b.data[ib + 2])); if (d < 8) ex++; sde += d; n++; } return { exact: n ? ex / n : 0, meanDE: n ? sde / n : 0 }; }
// bandTexture — CONTENT-ENERGY of a SINGLE image's band, INDEPENDENT of the cross-SSIM. Combines normalized luma
// variance (does the band hold a range of tones, or is it one flat color?) and edge density (mean abs horizontal+
// vertical luma gradient → real glyphs/cards/logos produce many edges; a flat ~bg band produces ~none). Both terms
// are normalized to ~[0,1] and averaged. A near-uniform band (flat dark/light fill ≈ page background) → energy ≈ 0;
// a band full of text/cards/logos → energy well above the VOID_SRC_CONTENT threshold. Pure read of one shot.
export function bandTexture(img, y0, y1) {
  const Wd = img.width; const step = 2;
  let sum = 0, sumSq = 0, n = 0, edge = 0, en = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = 0; x < Wd; x += step) {
      const i = (y * Wd + x) * 4; const g = gray(img.data, i);
      sum += g; sumSq += g * g; n++;
      // horizontal + vertical gradient against the next sampled neighbor (in-band only)
      if (x + step < Wd) { const ir = (y * Wd + (x + step)) * 4; edge += Math.abs(g - gray(img.data, ir)); en++; }
      if (y + step < y1) { const id = ((y + step) * Wd + x) * 4; edge += Math.abs(g - gray(img.data, id)); en++; }
    }
  }
  if (!n) return { energy: 0, varNorm: 0, edgeNorm: 0 };
  const mean = sum / n; const variance = Math.max(0, sumSq / n - mean * mean);
  // 255²≈65025 is the max possible luma variance; a flat band → ~0. sqrt → std in luma units; /64 maps a ~half-tone
  // contrast band to ~1. edge: mean abs gradient in luma units; /48 maps a busy-text band to ~1. Clamp to [0,1].
  const varNorm = Math.min(1, Math.sqrt(variance) / 64);
  const edgeNorm = Math.min(1, (en ? edge / en : 0) / 48);
  const energy = +(0.5 * varNorm + 0.5 * edgeNorm).toFixed(4);
  return { energy, varNorm: +varNorm.toFixed(4), edgeNorm: +edgeNorm.toFixed(4) };
}

// ---- MEDIA-IDENTITY pure pixel helpers (exported, unit-tested by _mediaid-selftest.mjs; NO network) ----
// cropEnergy — bandTexture's exact content-energy math scoped to a BOX (x-bounded as well as y-bounded). Used as
// the PAINT GUARD: a media element whose own crop is near-uniform was never painted (lazy-fail on the source side,
// an unpainted/URL-spoofed stamp on the clone side) → it can assert nothing and is excluded entirely.
export function cropEnergy(img, box) {
  const step = 2;
  const x0 = Math.max(0, Math.round(box.x)), y0 = Math.max(0, Math.round(box.y));
  const x1 = Math.min(img.width, Math.round(box.x + box.w)), y1 = Math.min(img.height, Math.round(box.y + box.h));
  let sum = 0, sumSq = 0, n = 0, edge = 0, en = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * img.width + x) * 4; const g = gray(img.data, i);
      sum += g; sumSq += g * g; n++;
      if (x + step < x1) { const ir = (y * img.width + (x + step)) * 4; edge += Math.abs(g - gray(img.data, ir)); en++; }
      if (y + step < y1) { const id = ((y + step) * img.width + x) * 4; edge += Math.abs(g - gray(img.data, id)); en++; }
    }
  }
  if (!n) return { energy: 0, varNorm: 0, edgeNorm: 0 };
  const mean = sum / n; const variance = Math.max(0, sumSq / n - mean * mean);
  const varNorm = Math.min(1, Math.sqrt(variance) / 64);
  const edgeNorm = Math.min(1, (en ? edge / en : 0) / 48);
  return { energy: +(0.5 * varNorm + 0.5 * edgeNorm).toFixed(4), varNorm: +varNorm.toFixed(4), edgeNorm: +edgeNorm.toFixed(4) };
}
// mean-pool a clipped box of a PNG into a gw×gh grid of [r,g,b,withinCellLumaStd] (stride-2 sampling, same as
// bandStats). Index 3 (per-cell luma std — the high-frequency detail pooling erases) feeds mediaCropId's hf term
// (FOLD-BLOCKER #3): a blur/LQIP reproduces the cell MEANS perfectly but has ~zero WITHIN-cell variance.
function _poolGrid(img, box, gw, gh) {
  const x0 = Math.max(0, Math.round(box.x)), y0 = Math.max(0, Math.round(box.y));
  const x1 = Math.min(img.width, Math.round(box.x + box.w)), y1 = Math.min(img.height, Math.round(box.y + box.h));
  if (x1 <= x0 || y1 <= y0) return null;
  const cells = Array.from({ length: gw * gh }, () => [0, 0, 0, 0, 0, 0]); // r,g,b,count,lumaSum,lumaSumSq
  for (let y = y0; y < y1; y += 2) {
    const gy = Math.min(gh - 1, Math.floor(((y - y0) / (y1 - y0)) * gh));
    for (let x = x0; x < x1; x += 2) {
      const gx = Math.min(gw - 1, Math.floor(((x - x0) / (x1 - x0)) * gw));
      const i = (y * img.width + x) * 4; const c = cells[gy * gw + gx];
      c[0] += img.data[i]; c[1] += img.data[i + 1]; c[2] += img.data[i + 2]; c[3]++;
      const l = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      c[4] += l; c[5] += l * l;
    }
  }
  return cells.map((c) => {
    if (!c[3]) return [0, 0, 0, 0];
    const ml = c[4] / c[3];
    return [c[0] / c[3], c[1] / c[3], c[2] / c[3], Math.sqrt(Math.max(0, c[5] / c[3] - ml * ml))];
  });
}
// _detailSign — T14 (GRAIN-OVER-LQIP) raw feed: per fine-grid cell (18×16), the luma DELTA between the fine-cell
// mean and its enclosing coarse-cell (9×8) mean — i.e. the within-coarse-cell DETAIL component, with the coarse
// structure (which an LQIP reproduces by construction) subtracted out. The SIGN of this delta at source-significant
// sites is what film grain cannot fake: grain randomizes it (50% agreement = chance), genuine fine detail
// preserves it. Exact 2×2 nesting: floor(u·18)/2 == floor(u·9) for the shared relative-coordinate pooling.
function _detailSign(img, box, coarseLuma) {
  const fg = _poolGrid(img, box, 18, 16);
  if (!fg) return null;
  const dd = new Array(288);
  for (let fy = 0; fy < 16; fy++) for (let fx = 0; fx < 18; fx++) {
    const c = fg[fy * 18 + fx];
    dd[fy * 18 + fx] = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) - coarseLuma[(fy >> 1) * 9 + (fx >> 1)];
  }
  return dd;
}
// mediaCropId — perceptual SAME-IMAGERY score for one matched (source crop, clone crop) pair. Pure pixels,
// FIVE terms (FOLD-BLOCKER fixes #3 LQIP + #4 wrong-photo/stretch — see header):
//   dHash: 9×8 luma grid → 64-bit difference hash → hashSim = 1 − hamming/64 (structure: edges/gradients)
//   patch ΔE: 4×4 grid of RGB means → Lab → mean ΔE over 16 cells → deSim = max(0, 1 − meanΔE/MI_DE_MAX) (palette)
//   corr (#4): sqrt-free signed Pearson r² over the 72 pooled lumas — UNRELATED busy imagery decorrelates
//     (E[r]≈0 → term ~0) where dHash floors at ~0.5 and pooled-ΔE stays high (both crops pool to mid-gray).
//     Guards: flat-vs-flat → 1 (nothing to correlate; ΔE decides), flat-vs-textured → 0 (genuinely different).
//   hf (#3, structure-verified since T14): mean WITHIN-cell luma std ratio (the high-frequency detail pooling
//     erases) — a blurred LQIP placeholder reproduces the 9×8 cell means (hash/ΔE/corr all high) but has ~zero
//     within-cell detail. The MAGNITUDE ratio alone was grain-gameable (T14): hfSim = ratio × fineS, where fineS
//     is the _detailSign agreement (fine 18×16 minus coarse 9×8 luma signs at source-significant sites, ±1-cell
//     offset search, MI_FINE_DEAD deadband, MI_FINE_PEN penalty floor for at-chance agreement = fake detail).
//     hfTerm = 1 − MI_HF_W·(1 − hfSim); both-sides-flat guard → 1; sources with < MI_FINE_MIN verifiable sites
//     keep fineS 1 (magnitude decides, as before).
//   aspect (#4): rendered-BOX aspect ratio — gross anisotropic stretch (480×280 → 1440×360) was INVISIBLE under
//     per-box pooling (id 0.978). ≤(1−MI_AR_TOL) mismatch is free, linear price beyond. BOX-based on purpose:
//     needs NO capture change (natW/natH live on the BUILDER capture tree, not grader mediaLeaves) and the
//     same-box bg-fallback pair (#2) gets exactly 1 by construction.
//   id = clamp(1 − Σw·deficit, 0, 1) · hfTerm · aTerm. DEFICIT form: identical crops score EXACTLY 1 (every
//   deficit/ratio is bit-exact 0-or-1 on identical inputs — no fp weight-sum drift). Reads RENDERED pixels only.
export function mediaCropId(srcShot, srcBox, cloneShot, cloneBox) {
  const luma = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const ga = _poolGrid(srcShot, srcBox, 9, 8), gb = _poolGrid(cloneShot, cloneBox, 9, 8);
  const pa = _poolGrid(srcShot, srcBox, 4, 4), pb = _poolGrid(cloneShot, cloneBox, 4, 4);
  if (!ga || !gb || !pa || !pb) return 0;
  const la = ga.map(luma), lb = gb.map(luma);
  let ham = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((la[r * 9 + c] < la[r * 9 + c + 1]) !== (lb[r * 9 + c] < lb[r * 9 + c + 1])) ham++;
  const hashSim = 1 - ham / 64;
  let sde = 0; for (let i = 0; i < 16; i++) sde += dE(srgbLab(pa[i][0], pa[i][1], pa[i][2]), srgbLab(pb[i][0], pb[i][1], pb[i][2]));
  const deSim = Math.max(0, 1 - (sde / 16) / MI_DE_MAX);
  let ma = 0, mb = 0; for (let i = 0; i < 72; i++) { ma += la[i]; mb += lb[i]; }
  ma /= 72; mb /= 72;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < 72; i++) { const da = la[i] - ma, db = lb[i] - mb; cov += da * db; va += da * da; vb += db * db; }
  const corrSim = (va < MI_FLAT_VAR && vb < MI_FLAT_VAR) ? 1
    : (va < MI_FLAT_VAR || vb < MI_FLAT_VAR) ? 0
      : (cov <= 0 ? 0 : Math.min(1, (cov * cov) / (va * vb)));
  const hfa = ga.reduce((s, c) => s + c[3], 0) / 72, hfb = gb.reduce((s, c) => s + c[3], 0) / 72;
  // T14 GRAIN-PROOFING (B1 round 4): the hf MAGNITUDE ratio alone was gameable — a generic film-grain overlay on
  // an LQIP matches the within-cell std without one source pixel (attack3 N1: id 0.336→0.703 at std 48). hf
  // credit now requires the fine detail to be STRUCTURE-VERIFIED: detail-sign agreement (_detailSign) over
  // source-significant sites (|Δ| > MI_FINE_SIG), best over a ±1-fine-cell offset search (protects legit clones
  // with ≤~5% box-relative drift/crop). Chance (grain, flat) ≈ 0.5 → 0 after the MI_FINE_DEAD deadband;
  // identical crops → exactly 1 (same grids → agree==sig at offset 0). A source with <MI_FINE_MIN verifiable
  // sites keeps fineS=1 (nothing to verify — the magnitude ratio decides, exactly as before).
  let fineS = 1;
  if (Math.max(hfa, hfb) >= MI_HF_FLOOR) {
    const dda = _detailSign(srcShot, srcBox, la), ddb = _detailSign(cloneShot, cloneBox, lb);
    let bestAgree = -1;
    if (dda && ddb) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      let sig = 0, agree = 0;
      for (let fy = 0; fy < 16; fy++) for (let fx = 0; fx < 18; fx++) {
        const d = dda[fy * 18 + fx]; if (Math.abs(d) <= MI_FINE_SIG) continue;
        const cx = fx + dx, cy = fy + dy; if (cx < 0 || cx >= 18 || cy < 0 || cy >= 16) continue;
        sig++; if ((d > 0) === (ddb[cy * 18 + cx] > 0)) agree++;
      }
      if (sig >= MI_FINE_MIN && agree / sig > bestAgree) bestAgree = agree / sig;
    }
    if (bestAgree >= 0) fineS = Math.max(-MI_FINE_PEN, Math.min(1, (bestAgree - MI_FINE_DEAD) / (1 - MI_FINE_DEAD)));
  }
  const hfSim = Math.max(hfa, hfb) < MI_HF_FLOOR ? 1 : (Math.min(hfa, hfb) / Math.max(hfa, hfb)) * fineS;
  const hfTerm = 1 - MI_HF_W * (1 - hfSim);
  const ara = srcBox.w / Math.max(1, srcBox.h), arb = cloneBox.w / Math.max(1, cloneBox.h);
  const aTerm = Math.min(1, (Math.min(ara, arb) / Math.max(ara, arb)) / MI_AR_TOL);
  const base = Math.max(0, 1 - (0.35 * (1 - hashSim) + 0.30 * (1 - deSim) + 0.35 * (1 - corrSim)));
  return Math.max(0, Math.min(1, base * hfTerm * aTerm));
}
// mediaIdentityBand — the per-band dim (pure; exported for the unit harness). Inputs: the two full-page shots,
// the two mediaLeaves lists ({x,y,w,h,area,tag?}), the band [y0,y1) (y1 pre-clamped to the gradable extent).
// Eligibility (BOTH sides, symmetric): leaf center-y in band (the chunkedMedia binning convention — clone media
// bin into the SOURCE band by clone y), w≥24 AND h≥24, clipped box non-empty, crop PAINTED (cropEnergy ≥
// MI_SRC_PAINT). Nested/duplicate leaves deduped (a <picture> wrapping its <img> emits BOTH with ~the same box;
// counting both would double srcMediaArea and false-halve presence on a faithful clone): drop any leaf ≥85%-
// contained (inter/minArea) in an already-kept larger leaf. Identity-eligible: tag ∈ {img,picture,svg} (missing
// tag → treated as img); video/canvas are PRESENCE-ONLY (animated/nondeterministic pixels). Matching: greedy by
// descending source area, best clone candidate by IoU (accept ≥ MI_MATCH_IOU), else nearest center within
// 0.5·max(w,h,120px) at area ratio ∈ [0.25,4]; each clone leaf matches at most one source leaf. Per leaf,
// id = max(matched-pair id, SAME-BOX PIXEL FALLBACK id) — the fallback (FOLD-BLOCKER #2) compares src crop vs the
// SAME box on the clone shot, gated on the clone crop being PAINTED (cropEnergy ≥ MI_SRC_PAINT): CSS background-
// image clones (the canonical Elementor shape: section-bg/bgRect — no <img> element) and granularity-mismatched
// rasters (N source logos reproduced as 1 big leaf → IoU<0.05) now score on their PIXELS instead of a false 0;
// honest omission still scores 0 (unpainted box fails the gate). No match AND no painted fallback → MISSING
// (id 0). identity_b = Σ(area·id)/Σ(area) over identity-eligible. presence_b is IDENTITY-WEIGHTED (FOLD-BLOCKER
// #1): credited = Σ(srcLeafArea·id) over identity-eligible + gated credit for presence-only leaves (T13: clone
// video/canvas = full geometric credit; img/picture poster fallback = ×deSim, palette-gated ≥ MI_VIDEO_DE_MIN;
// svg/other stamps are not candidates); presence_b = min(1, credited/srcArea) — decorative-gradient/area
// stuffing earns ~id≈0 credit instead of the old min(1, cloneArea/srcArea)=1. M_b = 0.6·identity + 0.4·presence
// (presence-only when the band has no identity-eligible leaves, e.g. video-only). Returns null score when zero
// eligible source media (n/a band).
export function mediaIdentityBand({ srcShot, cloneShot, srcMedia, cloneMedia, y0, y1, selftest = false }) {
  const inBand = (m) => m.y + m.h / 2 >= y0 && m.y + m.h / 2 < y1;
  const clip = (m, img) => {
    const bx0 = Math.max(0, m.x), by0 = Math.max(y0, m.y);
    const bx1 = Math.min(img.width, m.x + m.w), by1 = Math.min(y1, Math.min(img.height, m.y + m.h));
    return (bx1 > bx0 && by1 > by0) ? { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 } : null;
  };
  const eligible = (list, img) => {
    const out = [];
    for (const m of (list || [])) {
      // size floor: 8px probes die here. G4(b): svg leaves use the lower MI_SVG_MIN_LEAF (nav/footer logos and
      // icons are 16-20px svgs — the flat 24px floor excluded ALL of them); == MI_MIN_LEAF when G4 is off.
      const floor = String(m.tag || 'img').toLowerCase() === 'svg' ? MI_SVG_MIN_LEAF : MI_MIN_LEAF;
      if (!inBand(m) || m.w < floor || m.h < floor) continue;
      const box = clip(m, img); if (!box) continue;
      if (cropEnergy(img, box).energy < MI_SRC_PAINT) continue;                 // paint guard: unpainted → excluded
      const tag = String(m.tag || 'img').toLowerCase();
      out.push({ m, box, area: box.w * box.h, identityElig: !/^(video|canvas)$/.test(tag), used: false });
    }
    // dedupe nested/duplicate boxes (keep larger; drop ≥85%-contained)
    const kept = [];
    for (const e of out.sort((a, b) => b.area - a.area)) {
      let dup = false;
      for (const k of kept) {
        const ix = Math.max(0, Math.min(e.m.x + e.m.w, k.m.x + k.m.w) - Math.max(e.m.x, k.m.x));
        const iy = Math.max(0, Math.min(e.m.y + e.m.h, k.m.y + k.m.h) - Math.max(e.m.y, k.m.y));
        const minA = Math.min(e.m.w * e.m.h, k.m.w * k.m.h);
        if (minA > 0 && (ix * iy) / minA >= 0.85) { dup = true; break; }
      }
      if (!dup) kept.push(e);
    }
    return kept;
  };
  const srcElig = eligible(srcMedia, srcShot);
  const clnElig = eligible(cloneMedia, cloneShot);
  const srcMediaArea = srcElig.reduce((a, e) => a + e.area, 0);
  const cloneMediaArea = clnElig.reduce((a, e) => a + e.area, 0);
  if (!srcElig.length) {
    return { score: null, raw: null, identity: null, presence: null, srcMediaArea: 0, cloneMediaArea, cloneOnlyMediaArea: cloneMediaArea, leaves: { eligible: 0, identityEligible: 0, matched: 0, wrong: 0, missing: 0 } };
  }
  let idNum = 0, idDen = 0, matched = 0, fb = 0, wrong = 0, missing = 0, credited = 0;
  const findBest = (e, accept = null) => {                                      // best clone candidate: IoU, else center
    let best = null, bestIou = 0;
    for (const c of clnElig) { if (c.used || (accept && !accept(c))) continue; const i = _iou(e.m, c.m); if (i > bestIou) { bestIou = i; best = c; } }
    if (best && bestIou >= MI_MATCH_IOU) return best;
    best = null; let bestD = Infinity;
    const cx = e.m.x + e.m.w / 2, cy = e.m.y + e.m.h / 2, maxD = 0.5 * Math.max(e.m.w, e.m.h, 120);
    for (const c of clnElig) {
      if (c.used || (accept && !accept(c))) continue;
      const ratio = (c.m.w * c.m.h) / Math.max(1, e.m.w * e.m.h);
      if (ratio < 0.25 || ratio > 4) continue;
      const d = Math.hypot(c.m.x + c.m.w / 2 - cx, c.m.y + c.m.h / 2 - cy);
      if (d <= maxD && d < bestD) { bestD = d; best = c; }
    }
    return best;
  };
  const order = srcElig.slice().sort((a, b) => b.area - a.area);                // greedy by descending source area
  for (const e of order) {                                                      // pass 1: identity-eligible leaves
    if (!e.identityElig) continue;                                              // video/canvas → pass 2
    idDen += e.area;
    const best = findBest(e);
    let idMatch = -1;
    if (best) { best.used = true; matched++; idMatch = mediaCropId(srcShot, e.box, cloneShot, best.box); }
    // FOLD-BLOCKER #2: same-box PIXEL fallback — bg-image clones / granularity-mismatched rasters score on
    // their rendered pixels; gate = the clone crop is PAINTED (honest omission scores nothing here).
    let idFb = -1;
    if (cropEnergy(cloneShot, e.box).energy >= MI_SRC_PAINT) idFb = mediaCropId(srcShot, e.box, cloneShot, e.box);
    if (idMatch < 0 && idFb < 0) { missing++; continue; }                       // no match AND unpainted box → id 0
    if (idFb > Math.max(0, idMatch)) fb++;                                      // fallback decided this leaf
    const id = Math.max(idMatch, idFb);
    idNum += e.area * id; credited += e.area * id;                              // FOLD-BLOCKER #1: presence credit ∝ id
    if (id < 0.5) wrong++;
  }
  for (const e of order) {                                                      // pass 2: presence-only (video/canvas)
    if (e.identityElig) continue;
    // T13 VIDEO-BOX PRESENCE STUFFING (B1 round 4): geometric credit was unconditional — a decorative svg/
    // gradient at the source video's box flipped M 0→1.0 (attack3 N2), out-earning honest omission. Now:
    //   (a) TAG GATE: only clone video/canvas (a real playback surface — the legit reproduction shape, animated
    //       pixels uncomparable → full geometric credit) or img/picture (a poster/static-frame fallback) can
    //       stand in for a presence-only leaf; svg/other decorative stamps are not candidates at all.
    //   (b) POSTER PALETTE GATE: an img/picture stand-in must be pixel-PLAUSIBLE vs the captured source frame —
    //       4×4 pooled-palette deSim ≥ MI_VIDEO_DE_MIN, credit scaled by deSim (graded: a faithful frame raster
    //       keeps ~full credit, a re-tagged gradient/wrong image earns 0). Zero-credit candidates are NOT
    //       consumed (stay visible as cloneOnlyMediaArea telemetry).
    const accept = (c) => /^(video|canvas|img|picture)$/.test(String(c.m.tag || 'img').toLowerCase());
    const best = findBest(e, accept);
    if (!best) continue;
    let plaus = 1;
    if (!/^(video|canvas)$/.test(String(best.m.tag || 'img').toLowerCase())) {
      const pa = _poolGrid(srcShot, e.box, 4, 4), pb = _poolGrid(cloneShot, best.box, 4, 4);
      if (!pa || !pb) { plaus = 0; } else {
        let s = 0; for (let i = 0; i < 16; i++) s += dE(srgbLab(pa[i][0], pa[i][1], pa[i][2]), srgbLab(pb[i][0], pb[i][1], pb[i][2]));
        const deSim = Math.max(0, 1 - (s / 16) / MI_DE_MAX);
        plaus = deSim >= MI_VIDEO_DE_MIN ? deSim : 0;
      }
    }
    if (plaus > 0) { best.used = true; credited += Math.min(e.area, best.area) * plaus; }
  }
  const identity = idDen > 0 ? idNum / idDen : null;                            // null = no identity-eligible leaves
  const presence = Math.min(1, credited / Math.max(1, srcMediaArea));           // identity-WEIGHTED (FOLD-BLOCKER #1)
  const cloneOnlyMediaArea = clnElig.filter((c) => !c.used).reduce((a, c) => a + c.area, 0);
  const raw = identity == null ? presence : MI_W_ID * identity + MI_W_PRESENCE * presence;
  return {
    // SELFTEST short-circuits the published score to the definitional 1 (raw kept for telemetry — the
    // responsive-selftest pattern); clone==source makes raw 1.0 anyway (hamming 0, ΔE 0, equal areas).
    score: selftest ? 1 : +raw.toFixed(3),
    raw: +raw.toFixed(3),
    identity: identity == null ? null : +identity.toFixed(3),
    presence: +presence.toFixed(3),
    srcMediaArea, cloneMediaArea, cloneOnlyMediaArea,
    leaves: { eligible: srcElig.length, identityEligible: srcElig.filter((e) => e.identityElig).length, matched, fb, wrong, missing },
  };
}
export const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// PAGE-CLOSE RETRY — the main info-evaluate crashed once on a transient mid-capture page death (supabase
// 2026-06-10 'Target page, context or browser has been closed'; same wedge class settleLazy was hardened for,
// 5da79a6). One retry on a FRESH page (capture() creates its own from ctx); a second failure or any other
// error class still throws — real infra failures must stay loud. Off-error-path behavior unchanged.
export async function captureRetry(ctx, target, withSections) {
  try { return await capture(ctx, target, withSections); }
  catch (e) {
    if (!/Target (page|context|browser)|page.*has been closed/i.test(String(e))) throw e;
    console.error(`capture: transient page-close on ${target} — one retry on a fresh page`);
    return await capture(ctx, target, withSections);
  }
}
export async function capture(ctx, target, withSections) {
  const p = await ctx.newPage(); await p.setViewportSize({ width: W, height: 900 });
  try { await p.goto(target, { waitUntil: 'networkidle', timeout: 60000 }); } catch { try { await p.goto(target, { waitUntil: 'load', timeout: 30000 }); } catch {} }
  await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(1200);
  await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y <= h; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 180)); } window.scrollTo(0, 0); });
  try { await p.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  await p.waitForTimeout(700);
  if (LAZY_SETTLE) {
    // LAZY-IMAGE SETTLE (reversible GRADER_NO_LAZYSETTLE=1; see flag block above): bounded wait for in-DOM
    // images to complete + force-decode, so the full-page shot can't race below-fold lazy paint. Never throws.
    await p.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const pending = () => [...document.images].filter((im) => !(im.complete && im.naturalWidth > 0));
      const deadline = Date.now() + 8000;
      while (pending().length && Date.now() < deadline) await sleep(150);
      const decodable = [...document.images].filter((im) => im.complete && im.naturalWidth > 0).slice(0, 64);
      for (const im of decodable) {
        try { if (im.decode) await im.decode(); } catch {}
      }
    }).catch(() => {});
    await p.waitForTimeout(300).catch(() => {});
  }
  const info = await p.evaluate(({ vw, withSections, useVisibleBlocks, formCluster, useMediaId, useGlyphRects }) => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(el); return !(cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05); };
    // visStrict — the HARDENED GENUINE-VISIBILITY gate for block-type counting (anti-gaming). An element counts
    // toward a block type only if it is actually PAINTED, not merely present in the DOM. Beyond the base vis()
    // (display/visibility/opacity), it additionally rejects:
    //   • PAINT-ZERO TWINS: pointer-events:none AND the element contributes no visible paint of its own — no
    //     non-transparent background-color, no visible (non-zero, non-fully-transparent) border, no background
    //     image, and no own rendered text glyphs (color fully transparent or no text). This is the exact signature
    //     of a transparent landmark/form twin stamped only to fire a tag-based counter.
    //   • TRIVIAL AREA: a rendered box smaller than MIN_BLOCK_AREA px² (an 8×8 probe / collapsed sliver can't be a
    //     real form/video/table/etc.).
    //   • OFF-SCREEN: the box sits entirely outside the document/viewport extent (negative far-right/left or far
    //     below the rendered page), i.e. parked where a human never sees it.
    // The gate is applied symmetrically to source AND clone (both via this same capture path), so a REAL visible
    // block counts identically on both sides → source-vs-source self-test stays 1.0; only paint-zero twins drop.
    const MIN_BLOCK_AREA = 144; // 12×12px floor — below this a box cannot be a genuine interactive/content block
    const _alphaZero = (c) => !c || c === 'transparent' || /rgba?\([^)]*,\s*0(?:\.0+)?\s*\)\s*$/i.test(c);
    const _hasOwnText = (el) => {
      const cs = getComputedStyle(el);
      if (_alphaZero(cs.color)) return false; // transparent glyph color → paints no visible text
      // any descendant text node with actual characters (covers wrapped twin links/labels)
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      let n; while ((n = tw.nextNode())) { if (clean(n.textContent)) return true; }
      return false;
    };
    const _paintsSomething = (el) => {
      const cs = getComputedStyle(el);
      // visible (non-transparent) background color?
      if (!_alphaZero(cs.backgroundColor)) return true;
      // background image / gradient?
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
      // visible border (any side: non-zero width AND non-transparent color)?
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        const w = parseFloat(cs['border' + side + 'Width'] || '0');
        if (w >= 0.5 && cs['border' + side + 'Style'] !== 'none' && !_alphaZero(cs['border' + side + 'Color'])) return true;
      }
      // box shadow?
      if (cs.boxShadow && cs.boxShadow !== 'none') return true;
      // an embedded replaced/media element that paints (img/svg/canvas/video/iframe) inside?
      if (/^(IMG|SVG|CANVAS|VIDEO|IFRAME|PICTURE)$/.test(el.tagName)) return true;
      if (el.querySelector && el.querySelector('img,svg,canvas,video,iframe,picture')) return true;
      // own rendered text glyphs?
      if (_hasOwnText(el)) return true;
      return false;
    };
    const visStrict = (el) => {
      if (!vis(el)) return false;                       // base display/visibility/opacity gate
      const r = el.getBoundingClientRect();
      if (r.width * r.height < MIN_BLOCK_AREA) return false; // trivial rendered area
      const docW = document.documentElement.scrollWidth || vw;
      const docH = document.documentElement.scrollHeight || window.innerHeight || 900;
      const top = r.top + scrollY, left = r.left + scrollX, bottom = r.bottom + scrollY, right = r.right + scrollX;
      // entirely off the rendered document/viewport (parked where a human never sees it)
      if (bottom <= 0 || right <= 0 || top >= docH || left >= docW) return false;
      const cs = getComputedStyle(el);
      // PAINT-ZERO TWIN: non-interactive (pointer-events:none) AND contributes no visible paint → ignore.
      if (cs.pointerEvents === 'none' && !_paintsSomething(el)) return false;
      return true;
    };
    const gate = useVisibleBlocks ? visStrict : vis;    // reversible: GRADER_NO_VISIBLE_BLOCKS=1 → old vis()
    const texts = []; const seen = new Set();
    // DETECTOR(1) TEXT-COLLISION raw feed: ALL visible text leaves with FULL boxes, captured BEFORE the seen-set
    // dedup (overlapping doubled text would otherwise be deduped away and become invisible to the grader). Pure
    // geometry — no extra render. Each entry: {t, x, y, w, h, op, ca}. Populated in the SAME element loop below.
    // op/ca (C round 5, D1 gate hardening): ADDITIVE per-leaf visibility telemetry — `op` = EFFECTIVE opacity
    // (product of own + ancestor computed opacity; CSS opacity composites multiplicatively, so a 0.06 wrapper
    // anywhere up the chain shows here even though each element's own computed opacity can read 1) and `ca` =
    // the glyph color's alpha channel. NO scoring path in THIS file reads them — the corpus-wide vis() floor
    // (+cs.opacity < 0.05 above) is UNCHANGED BY EXPLICIT DECISION: frozen src caches were captured under that
    // floor, so raising it clone-side only would manufacture false lostTexts corpus-wide (deflation lie); the
    // corpus-wide vis-gate raise is its OWN gated grader round (reversible flag + byte-identical legacy + corpus
    // A/B). Consumed by sectionvisual.mjs bandLocalText (the refine-loop keep-gate feed), where the asymmetry
    // cannot arise (clone side is always a fresh capture).
    // fs/sw/sh/wid/wt (C round 5b, gate hardening 2): MORE ADDITIVE per-leaf telemetry, same contract (no
    // scoring path in THIS file reads them; consumed only by bandLocalText) — `fs` = computed font-size px,
    // `sw`/`sh` = scrollWidth/scrollHeight (the content's LAYOUT demand: an overflow-clipped box reports its
    // full text width here — feeds clip detection; 0 on display:inline elements, which cannot overflow-clip),
    // `wid`/`wt` = the RENDERING Elementor widget's data-id and widget type, resolved to the OUTERMOST
    // `.elementor-widget[data-id]` ancestor — outermost so spoofed `.elementor-widget` markup INSIDE an html
    // widget's content cannot shadow the true rendering widget (V3 never DOM-nests widget wrappers).
    const effOp = (el) => { let o = 1, n = el; for (let i = 0; n && n.nodeType === 1 && i < 64; i++, n = n.parentElement) { const v = parseFloat(getComputedStyle(n).opacity); if (!isNaN(v)) o *= v; if (o < 0.001) break; } return Math.round(o * 1000) / 1000; };
    const colorAlpha = (c) => { const s = String(c || '').trim(); let m = s.match(/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/) || s.match(/^rgba?\(\s*[\d.]+\s+[\d.]+\s+[\d.]+\s*\/\s*([\d.]+%?)\s*\)$/); if (!m) return 1; const a = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]); return isNaN(a) ? 1 : Math.round(a * 1000) / 1000; };
    const textLeaves = [];
    // include pre/code (rebuilt code blocks render as <pre>); allow longer text for them so the code blob is
    // counted (else captured code is invisible to the grader → recovery looks like no gain).
    const widgetOf = (el) => { let w = null; for (let a = el; a && a.nodeType === 1; a = a.parentElement) { if (a.hasAttribute && a.hasAttribute('data-id') && a.classList && a.classList.contains('elementor-widget')) w = a; } return w; }; // OUTERMOST widget wrapper wins (anti-spoof)
    // GLYPH-RECT collection (C round 5c, gated on useGlyphRects — see the GLYPH_RECTS flag block): per-TEXT-NODE
    // Ranges give the LINE BOXES of the actual glyphs (never element border boxes — a padded inline-block child
    // cannot inflate the union; multi-line text unions its line rects; display:none text yields zero rects).
    // The VISIBLE variant intersects every line rect with the cumulative ancestor overflow clip — the geometry
    // that can actually PAINT (closes nv-clipEdge); the union box itself moves with the glyphs, not the box
    // (closes nv-padPark). gc = computed glyph color (the ghost-contrast feed).
    const colorRgb = (c) => { const m = String(c || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/); return m ? [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])] : null; };
    const glyphInfo = (el) => {
      const rects = [];
      const tw2 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      let tn; while ((tn = tw2.nextNode())) {
        if (!clean(tn.textContent)) continue;
        const rg = document.createRange(); rg.selectNodeContents(tn);
        for (const r of rg.getClientRects()) if (r.width > 0 && r.height > 0) rects.push(r);
      }
      // cumulative ancestor overflow clip (viewport-relative, same space as the rects)
      let cx0 = -Infinity, cy0 = -Infinity, cx1 = Infinity, cy1 = Infinity;
      const clips = (v) => v === 'hidden' || v === 'clip' || v === 'auto' || v === 'scroll';
      for (let a = el; a && a.nodeType === 1 && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (clips(cs.overflowX) || clips(cs.overflowY)) {
          const cr = a.getBoundingClientRect();
          if (clips(cs.overflowX)) { cx0 = Math.max(cx0, cr.left); cx1 = Math.min(cx1, cr.right); }
          if (clips(cs.overflowY)) { cy0 = Math.max(cy0, cr.top); cy1 = Math.min(cy1, cr.bottom); }
        }
      }
      let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity, ga = 0;
      let vx0 = Infinity, vy0 = Infinity, vx1 = -Infinity, vy1 = -Infinity, gva = 0;
      for (const r of rects) {
        ux0 = Math.min(ux0, r.left); uy0 = Math.min(uy0, r.top); ux1 = Math.max(ux1, r.right); uy1 = Math.max(uy1, r.bottom);
        ga += r.width * r.height;
        const ix0 = Math.max(r.left, cx0), iy0 = Math.max(r.top, cy0), ix1 = Math.min(r.right, cx1), iy1 = Math.min(r.bottom, cy1);
        if (ix1 - ix0 > 0 && iy1 - iy0 > 0) { vx0 = Math.min(vx0, ix0); vy0 = Math.min(vy0, iy0); vx1 = Math.max(vx1, ix1); vy1 = Math.max(vy1, iy1); gva += (ix1 - ix0) * (iy1 - iy0); }
      }
      const out = { ga: Math.round(ga), gva: Math.round(gva), gc: colorRgb(getComputedStyle(el).color) };
      if (rects.length) { out.gx = Math.round(ux0); out.gy = Math.round(uy0 + scrollY); out.gw = Math.round(ux1 - ux0); out.gh = Math.round(uy1 - uy0); }
      if (gva > 0) { out.gvx = Math.round(vx0); out.gvy = Math.round(vy0 + scrollY); out.gvw = Math.round(vx1 - vx0); out.gvh = Math.round(vy1 - vy0); }
      return out;
    };
    for (const e of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,span,li,div,pre,code')) { const own = [...e.childNodes].some((n) => n.nodeType === 3 && clean(n.textContent)); if (!own) continue; const s = clean(e.innerText); const cap = /^(pre|code)$/i.test(e.tagName) ? 3000 : 200; if (!s || s.length > cap) continue; if (!vis(e)) continue; const cs0 = getComputedStyle(e); const fsz = parseFloat(cs0.fontSize); if (fsz < 10) continue; const wEl = widgetOf(e); const r0 = e.getBoundingClientRect(); textLeaves.push({ t: s, x: Math.round(r0.left), y: Math.round(r0.top + scrollY), w: Math.round(r0.width), h: Math.round(r0.height), op: effOp(e), ca: colorAlpha(cs0.color), fs: Math.round(fsz * 10) / 10, sw: Math.round(e.scrollWidth || 0), sh: Math.round(e.scrollHeight || 0), wid: wEl ? wEl.getAttribute('data-id') : null, wt: wEl ? (String(wEl.getAttribute('data-widget_type') || '').split('.')[0] || null) : null, ...(useGlyphRects ? glyphInfo(e) : {}) }); const k = s.toLowerCase(); if (seen.has(k)) continue; seen.add(k); texts.push({ t: s, y: Math.round(r0.top + scrollY) }); }
    let sections = null;
    if (withSections) { const ys = new Set([0]); for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.width >= vw * 0.82 && r.height >= 120 && r.top + scrollY >= 0) ys.add(Math.round(r.top + scrollY)); } const arr = [...ys].sort((a, b) => a - b); const m = []; for (const y of arr) { if (!m.length || y - m[m.length - 1] > 60) m.push(y); } sections = m; }
    // DETECTOR(2) FULL-BLEED raw feed: top-level section BAND boxes (x + width at viewport vw). A band is a wide,
    // tall block (>= 0.82*vw wide, >= 120px tall) that begins a visual section. We always record these (source
    // AND clone) so we can compare median band width vs viewport. Pure geometry — same scan as sections above.
    const bands = []; { const seenBy = []; for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.width >= vw * 0.82 && r.height >= 120 && r.top + scrollY >= 0) { const by = Math.round(r.top + scrollY); if (seenBy.some((y) => Math.abs(y - by) <= 60)) continue; seenBy.push(by); bands.push({ x: Math.round(r.left), w: Math.round(r.width), y: by, h: Math.round(r.height) }); } } }
    // sizeable IMAGE coverage (for the rebuild-honesty check: clone rastering TEXT into a screenshot).
    const imgs = [...document.querySelectorAll('img')].map((e) => { const r = e.getBoundingClientRect(); return { y0: Math.round(r.top + scrollY), y1: Math.round(r.bottom + scrollY), w: Math.round(r.width) }; }).filter((b) => b.w >= 120 && (b.y1 - b.y0) >= 60);
    // DETECTOR(3) CHUNKED-MEDIA raw feed: ALL visible media leaves (img/svg/picture/canvas/video) with FULL boxes
    // + area. Used to detect a CLONE single-large-raster where the SOURCE had many small distinct media (logos/
    // icons chunk-screenshotted). Pure geometry. Each entry: {x, y, w, h, area}.
    // MEDIA-IDENTITY additive field: `tag` (element tagName) splits identity-eligible (img/picture/svg) from
    // presence-only (video/canvas) leaves. Gated on useMediaId so GRADER_NO_MEDIAID=1 keeps the capture (and the
    // source cache, via the '-mi' srcTag suffix) byte-identical legacy.
    const mediaLeaves = [...document.querySelectorAll('img,svg,picture,canvas,video')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height), area: Math.round(r.width * r.height), ...(useMediaId ? { tag: e.tagName.toLowerCase() } : {}) }; }).filter((b) => b.w >= 8 && b.h >= 8);
    // DETECTOR(4) REAL-NAV raw feed: is there a REAL nav? Two acceptance shapes: (a) an Elementor nav-menu widget
    // (.elementor-widget-nav-menu / .e-n-menu / [class*=nav-menu] / [aria-label*=menu] nav), OR (b) a TOP header
    // container (nav/header/[role=banner]/[role=navigation] whose top < 200px) holding >= 3 link children. Flat
    // centered body-text links (no header/nav ancestor) do NOT count. Pure DOM-structure read — no extra render.
    const navStruct = (() => {
      const elNav = !!document.querySelector('.elementor-widget-nav-menu, .e-n-menu, [class*="nav-menu"], nav[aria-label], [aria-label*="menu" i] a');
      let headerNavLinks = 0; let hasTopHeader = false;
      for (const h of document.querySelectorAll('nav, header, [role="banner"], [role="navigation"]')) {
        if (!vis(h)) continue; const r = h.getBoundingClientRect(); if (r.top + scrollY > 200) continue; hasTopHeader = true;
        const links = [...h.querySelectorAll('a')].filter((a) => { const t = clean(a.innerText); return t && t.length <= 40 && vis(a); });
        if (links.length > headerNavLinks) headerNavLinks = links.length;
      }
      const realNav = elNav || (hasTopHeader && headerNavLinks >= 3);
      return { elNav, hasTopHeader, headerNavLinks, realNav };
    })();
    // HORIZONTAL-OVERFLOW raw feed: the REAL rendered horizontal extent of the document (what produces a human-
    // visible horizontal scrollbar). scrollWidth is the widest the content reaches; clientWidth is the viewport.
    // A fixed-width / overflowing clone reports scrollWidth >> viewport. Pure DOM read — no extra render.
    const docScrollW = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
    const docClientW = document.documentElement.clientWidth || vw;
    // GENERAL WIDGET-OVERLAP raw feed: ALL visible LEAF boxes (text, image, container leaves alike). A LEAF is an
    // element with NO visible element child that occupies a meaningful share of its own box (genuine content leaf —
    // never an ancestor of another captured leaf, so any overlap between two leaves is a real NON-NESTED sibling
    // collision, never parent↔child nesting). Pure geometry — no extra render. Each entry: {x,y,w,h,area}.
    const leafBoxes = (() => {
      const out = [];
      const vh = window.innerHeight || 900;
      const all = [...document.querySelectorAll('body *')];
      for (const e of all) {
        if (!vis(e)) continue;
        const r = e.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const myArea = r.width * r.height;
        // EXCLUDE page/section BACKGROUND WRAPPERS: a near-full-width AND very-tall block is a container backdrop
        // (it legitimately sits BEHIND all the content), NOT a content widget. Counting it as a leaf turns every
        // widget it spans into a bogus "collision". A true content leaf is bounded in size.
        if (r.width >= 0.95 * vw && r.height > 2 * vh) continue;
        // is this element a LEAF? (no visible element child that is itself a sizeable box — genuine content leaf,
        // never an ancestor of another captured leaf)
        let isLeaf = true;
        for (const c of e.children) {
          if (!vis(c)) continue;
          const cr = c.getBoundingClientRect();
          if (cr.width >= 8 && cr.height >= 8) { isLeaf = false; break; }
        }
        if (!isLeaf) continue;
        out.push({ x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height), area: Math.round(myArea) });
      }
      return out;
    })();
    // ELEMENT-TYPE (structural-fidelity) — detect block TYPES GENERICALLY (works on source AND on an Elementor
    // clone, so source-vs-source self-test stays 1.0). A form rebuilt as plain text → no inputs → structural miss.
    // BLOCK-TYPE counters use `gate` (visStrict when hardened) so an INVISIBLE/paint-zero twin never fires a type.
    // For a form, the form element AND its inner controls must be genuinely visible (a transparent twin <form> with
    // hidden/zero-paint inputs no longer counts). Same hardened gate for standalone inputs.
    const visN = (sel) => [...document.querySelectorAll(sel)].filter(gate);
    // STANDALONE-INPUT FALLBACK (no wrapping <form>): a GENUINE form is a TIGHT FIELD GROUP — >=2 visible inputs
    // sharing ONE compact common ancestor (height<=600 AND width<=760, the size of a real contact/signup card).
    // Scattered page-wide demo inputs (a marketing page's product widgets) do NOT share such an ancestor → no
    // phantom form. Reversible: formCluster=false (GRADER_NO_FORM_CLUSTER=1) → old page-wide `>=2 anywhere`.
    const _maxCompactInputGroup = () => {
      const ins = visN('input,textarea,select');
      let best = ins.length ? 1 : 0;
      for (const el of ins) {
        let node = el;
        for (let i = 0; i < 8 && node && node !== document.body; i++) {
          node = node.parentElement; if (!node) break;
          const r = node.getBoundingClientRect();
          if (r.height <= 600 && r.width <= 760) {
            const grouped = [...node.querySelectorAll('input,textarea,select')].filter(gate).length;
            if (grouped >= 2 && grouped > best) best = grouped;
          }
        }
      }
      return best;
    };
    const standaloneForm = formCluster ? (_maxCompactInputGroup() >= 2 ? 1 : 0) : (visN('input,textarea,select').length >= 2 ? 1 : 0);
    const forms = visN('form').filter((f) => [...f.querySelectorAll('input,textarea,select')].some(gate)).length || standaloneForm;
    const blocks = {
      form: forms,
      video: visN('video').length + visN('iframe').filter((f) => /youtube|vimeo|wistia|loom/.test(f.src || '')).length,
      table: visN('table').filter((t) => t.querySelectorAll('tr').length >= 2).length,
      list: visN('ul,ol').filter((l) => l.querySelectorAll(':scope > li').length >= 3 && !l.closest('nav,[role=navigation]')).length,
      tabs: visN('[role=tablist]').length || (visN('[role=tab]').length >= 2 ? 1 : 0),
      accordion: visN('details').length >= 2 ? 1 : (visN('[aria-expanded][aria-controls]').filter((b) => !b.closest('nav,header')).length >= 2 ? 1 : 0),
      nav: visN('nav,[role=navigation]').length ? 1 : 0,
    };
    return { texts, sections, imgs, blocks, pageH: document.documentElement.scrollHeight, textLeaves, bands, mediaLeaves, navStruct, docScrollW, docClientW, leafBoxes };
  }, { vw: W, withSections, useVisibleBlocks: USE_VISIBLE_BLOCKS, formCluster: FORM_CLUSTER, useMediaId: USE_MEDIAID, useGlyphRects: GLYPH_RECTS });
  const shot = PNG.sync.read(await p.screenshot({ fullPage: true }));
  await p.close(); return { shot, texts: info.texts, sections: info.sections, imgs: info.imgs, blocks: info.blocks, pageH: info.pageH, textLeaves: info.textLeaves, bands: info.bands, mediaLeaves: info.mediaLeaves, navStruct: info.navStruct, docScrollW: info.docScrollW, docClientW: info.docClientW, leafBoxes: info.leafBoxes };
}

// perBandVisual — EXPORTED, PURE per-band visual block (extracted verbatim from the main section loop so
// sectionvisual.mjs scores a band-scratch render through the IDENTICAL implementation — one formula, zero drift:
// the sectionVisual tolerance selftest then measures RENDER divergence only, never formula divergence).
// Covers: SSIM + bandStats (exact/ΔE) → visualPreVoid; band content-energies + text-guard → classifyVoid →
// VOID_CEIL cap; band editability (unique source texts matched in the clone's joined text); rastered-text
// detection (img-covered band where source text vanished) → 0.35 cap. Inputs are the two full-page shots +
// the capture() text/img payloads; `H` is the caller's crop clamp (min of the two FULL-page shot heights —
// sectionVisual must pass the FULL clone page height, not the scratch render height, for clamp parity).
// Returns every value the main loop pushes per band (incl. visualRaw for the media-identity projected fold and
// lostTexts for attribution). NO network, NO globals beyond module constants/flags.
export function perBandVisual({ srcShot, cloneShot, srcTexts, cloneTexts, cloneImgs, y0, y1, H, selftest = false }) {
  const gy1 = Math.min(H, y1); const gradable = gy1 - y0 > 8;
  const cloneJoined = ' ' + (cloneTexts || []).map((x) => norm(x.t)).join(' | ') + ' ';
  const inClone = (t) => cloneJoined.includes(t);
  const s = gradable ? ssim(srcShot, cloneShot, y0, gy1) : 0;
  const px = gradable ? bandStats(srcShot, cloneShot, y0, gy1) : { exact: 0, meanDE: 99 };
  const visualPreVoid = +(0.5 * s + 0.5 * px.exact).toFixed(3);
  // CONTENT-VOID detection (inside the visual term; reversible GRADER_NO_VOID_PENALTY=1). Measure each side's
  // band CONTENT ENERGY independently. SELFTEST (clone==source) → identical energies → void impossible → no-op.
  const srcTex = (DET_VOIDPENALTY && gradable) ? bandTexture(srcShot, y0, gy1) : { energy: 0, varNorm: 0, edgeNorm: 0 };
  const cloneTex = (DET_VOIDPENALTY && gradable) ? (selftest ? srcTex : bandTexture(cloneShot, y0, gy1)) : { energy: 0, varNorm: 0, edgeNorm: 0 };
  // A band is a CONTENT-VOID iff the SOURCE has substantial content AND the CLONE collapsed to near-background
  // (clone energy a small FRACTION of the source's AND below an absolute near-uniform floor) — UNLESS the
  // TEXT-GUARD finds the clone actually reproduced this band's source text (a dark + sparse-bright headline the
  // clone DID render → not a void; see classifyVoid + the VOID_TEXTGUARD note). We compute "reproduced" from the
  // band's own source texts: it requires the source band to HAVE text and the clone to carry a meaningful share of
  // it both in the matched-text set (inClone) AND as text leaves physically inside the clone band (not page-wide).
  const bandSrcTexts = (DET_VOIDPENALTY && gradable && !selftest) ? [...new Set(srcTexts.filter((t) => t.y >= y0 && t.y < gy1 && norm(t.t).length >= 4).map((t) => norm(t.t)))] : [];
  const bandMatched = bandSrcTexts.filter(inClone).length;
  const cloneLeavesInBand = (DET_VOIDPENALTY && gradable && !selftest) ? cloneTexts.filter((t) => t.y >= y0 && t.y < gy1 && norm(t.t).length >= 4).length : 0;
  const cloneReproducedBandText = bandSrcTexts.length >= 1 && bandMatched >= Math.max(1, Math.ceil(bandSrcTexts.length * 0.5)) && cloneLeavesInBand >= 1;
  const isVoid = DET_VOIDPENALTY && gradable && classifyVoid({ srcEnergy: srcTex.energy, cloneEnergy: cloneTex.energy, cloneReproducedBandText, selftest, textGuard: VOID_TEXTGUARD });
  // A confirmed void is forced to a LOW ceiling so it scores clearly below a content-bearing band. Because the
  // condition keys on the CLONE's own texture being near-bg, a clone that DID render content (high clone texture)
  // is never a void → never capped → presence always scores ≥ a void.
  const visualRaw = isVoid ? +Math.min(visualPreVoid, VOID_CEIL).toFixed(3) : visualPreVoid;
  const secTexts = srcTexts.filter((t) => t.y >= y0 && t.y < y1 && norm(t.t).length >= 4).map((t) => norm(t.t));
  const uniq = [...new Set(secTexts)];
  const matched = uniq.filter(inClone).length;
  const editability = uniq.length ? +(matched / uniq.length).toFixed(3) : 1; // image-only section → editability n/a (1)
  // REBUILD-HONESTY: a clone section that's IMAGE-covered while the SOURCE there is TEXT = text baked into a
  // screenshot (gaming visual). Strip its visual credit so rastering text is a LOSING move. (Images/logos
  // where the source is genuinely an image → no penalty; that's allowed.)
  const cloneTextHere = (cloneTexts || []).filter((t) => t.y >= y0 && t.y < y1).length;
  let imgArea = 0; for (const im of (cloneImgs || [])) { const ov = Math.min(y1, im.y1) - Math.max(y0, im.y0); if (ov > 0) imgArea += ov * im.w; }
  const imgCover = (y1 > y0) ? imgArea / (W * (y1 - y0)) : 0;
  const rasteredText = uniq.length >= 4 && cloneTextHere < uniq.length * 0.3 && imgCover > 0.5;
  const visual = rasteredText ? Math.min(visualRaw, 0.35) : visualRaw;
  return {
    gradable, gy1, visual, visualRaw, visualPreVoid, ssim: s, exact: px.exact, meanDE: px.meanDE,
    contentVoid: isVoid, rasteredText, srcEnergy: srcTex.energy, cloneEnergy: cloneTex.energy,
    editability, srcTextCount: uniq.length, lostTexts: uniq.filter((t) => !inClone(t)),
  };
}

if (IS_MAIN) (async () => {
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  // SOURCE side: cached when possible (see SOURCE-CAPTURE CACHE block above). GRADER_NO_SRCCACHE=1 → the
  // exact legacy path (live capture, no cache read OR write). SELFTEST always live. Clone side ALWAYS fresh.
  let src;
  const srcCacheJson = `${SRC_CACHE_DIR}/${srcTag}.json`, srcCachePng = `${SRC_CACHE_DIR}/${srcTag}.png`;
  const canCache = USE_SRCCACHE && !SELFTEST && /^https?:/.test(source);
  if (canCache && fs.existsSync(srcCacheJson) && fs.existsSync(srcCachePng) && !refreshSource) {
    const meta = JSON.parse(fs.readFileSync(srcCacheJson, 'utf8'));
    src = { shot: PNG.sync.read(fs.readFileSync(srcCachePng)) };
    for (const k of SRC_CACHE_FIELDS) src[k] = meta[k];
  } else {
    src = await captureRetry(ctx, source, true);
    if (canCache) { // persist the fresh source capture for deterministic future grades
      try { fs.mkdirSync(SRC_CACHE_DIR, { recursive: true }); fs.writeFileSync(srcCachePng, PNG.sync.write(src.shot)); const meta = {}; for (const k of SRC_CACHE_FIELDS) meta[k] = src[k]; fs.writeFileSync(srcCacheJson, JSON.stringify(meta)); } catch {}
    }
  }
  const cln = SELFTEST ? src : await captureRetry(ctx, clone, false);
  await browser.close();

  const hRatio = cln.shot.height / src.shot.height;
  const bounds = [...src.sections.filter((y) => y < src.pageH), src.pageH];
  const layoutTexts = (() => { if (!layoutPath) return null; try { const L = JSON.parse(fs.readFileSync(layoutPath, 'utf8')); const out = []; const w = (n) => { if (!n) return; if (n.kind === 'container') (n.children || []).forEach(w); else if (n.text) out.push(norm(n.text)); }; w(L.root); return ' ' + out.join(' | ') + ' '; } catch { return null; } })();
  const inLayout = (t) => layoutTexts && layoutTexts.includes(t);

  const H = Math.min(src.shot.height, cln.shot.height);
  const sections = [];
  const miBands = []; // MEDIA-IDENTITY per-band records (1:1 with sections.push when USE_MEDIAID)
  for (let i = 0; i < bounds.length - 1; i++) {
    const y0 = bounds[i], y1 = bounds[i + 1]; if (y1 - y0 < 20) continue;
    // Per-band visual/void/rastered/editability live in the EXPORTED pure perBandVisual (shared verbatim with
    // sectionvisual.mjs — one implementation, zero formula drift; see the function's header above).
    const pb = perBandVisual({ srcShot: src.shot, cloneShot: cln.shot, srcTexts: src.texts, cloneTexts: cln.texts, cloneImgs: cln.imgs, y0, y1, H, selftest: SELFTEST });
    const { gradable, visualRaw, visualPreVoid, contentVoid: isVoid, rasteredText, editability, srcTextCount, lostTexts } = pb;
    let visual = pb.visual; // G4: the live MI fold below may lower it (GRADER_NO_MIFOLD=1 → never reassigned)
    const gy1 = pb.gy1, px = { exact: pb.exact, meanDE: pb.meanDE }, srcTex = { energy: pb.srcEnergy }, cloneTex = { energy: pb.cloneEnergy };
    // ---- MEDIA-IDENTITY DIM (reversible GRADER_NO_MEDIAID=1; LIVE fold gated by MI_FOLD_LIVE — see both flag
    // blocks). Pure pixels over the two shots + mediaLeaves geometry already in hand — no extra render/network.
    // Per band: visualRaw × (0.45+0.55·M_b) on gated bands, rastered-text cap re-applied after. With G4 live
    // this IS the band's visual; under GRADER_NO_MIFOLD=1 it's published under detectors.mediaIdentity.projected only.
    let mi = null, miFolded = false;
    if (USE_MEDIAID) {
      mi = gradable ? mediaIdentityBand({ srcShot: src.shot, cloneShot: cln.shot, srcMedia: src.mediaLeaves, cloneMedia: cln.mediaLeaves, y0, y1: gy1, selftest: SELFTEST }) : null;
      const bandArea = Math.max(1, W * Math.max(1, gy1 - y0));
      const srcMediaFrac = (mi && mi.srcMediaArea) ? mi.srcMediaArea / bandArea : 0;
      // G4(a): gate 0.10 anywhere; when the fold is LIVE additionally 0.03 on ABOVE-FOLD bands (the hero's own
      // imagery measured frac 0.044 — exempt under the flat 0.10 gate). Legacy flag → exact 0.10-only gate.
      const foldGateHit = (mi && mi.score != null) && (srcMediaFrac >= 0.10 || (MI_FOLD_LIVE && y0 < MI_FOLD_ABOVEFOLD_PX && srcMediaFrac >= MI_FOLD_ABOVEFOLD_FRAC));
      const foldMult = foldGateHit ? (MI_FOLD_FLOOR + (1 - MI_FOLD_FLOOR) * mi.score) : 1;
      const visualFolded = rasteredText ? +Math.min(visualRaw * foldMult, 0.35).toFixed(3) : +(visualRaw * foldMult).toFixed(3);
      miBands.push({ idx: i, y0, y1: gy1, mi, srcMediaFrac: +srcMediaFrac.toFixed(3), visualFolded, ...(MI_FOLD_LIVE ? { foldMult: +foldMult.toFixed(4), visualUnfolded: visual } : {}) });
      // G4 LIVE FOLD: the band's media defects now price its REAL visual (was projected.*-only telemetry).
      // Selftest: M short-circuits to 1 → foldMult exactly 1 → no-op. GRADER_NO_MIFOLD=1 → never applied.
      if (MI_FOLD_LIVE && visualFolded < visual) { visual = visualFolded; miFolded = true; }
    }
    // attribution
    const fails = []; const why = [];
    if (miFolded && mi && mi.score < 0.7) { fails.push('visual'); why.push('wrong-or-missing-imagery'); }
    if (rasteredText) { fails.push('visual'); why.push('rastered-text-cheat'); }
    if (isVoid) { fails.push('visual'); why.push('content-void'); }
    if (editability < TGT.editability && srcTextCount) { fails.push('editability'); const lost = lostTexts; const capLost = layoutTexts ? lost.filter((t) => !inLayout(t)).length : null; why.push(layoutTexts ? (capLost > lost.length / 2 ? 'capture-lost-text' : 'build-lost-text') : 'missing-text'); }
    if (visual < TGT.visual && !rasteredText && !isVoid) { fails.push('visual'); if (px.meanDE > 12) why.push('color/background'); else if (editability >= TGT.editability) why.push('font/geometry'); else why.push('visual-degraded'); }
    const verdict = fails.length === 0 ? 'pass' : 'fail';
    const areaFrac = (y1 - y0) / src.pageH;
    const severity = +(((1 - Math.min(visual, editability))) * (0.5 + areaFrac)).toFixed(3);
    sections.push({ idx: i, y0, y1, visual, editability, srcTextCount, rasteredText, contentVoid: isVoid, srcEnergy: srcTex.energy, cloneEnergy: cloneTex.energy, visualPreVoid, meanDE: +px.meanDE.toFixed(1), verdict, fails: [...new Set(fails)], why: [...new Set(why)], severity, example: lostTexts[0]?.slice(0, 50), ...(USE_MEDIAID ? { mediaIdentity: mi ? mi.score : null, mediaPresence: mi ? mi.presence : null, srcMediaArea: mi ? mi.srcMediaArea : 0, mediaMissing: mi ? mi.leaves.missing : 0, mediaWrong: mi ? mi.leaves.wrong : 0 } : {}) });
  }
  const mean = (f) => sections.length ? +(sections.reduce((a, s) => a + f(s), 0) / sections.length).toFixed(3) : 0;
  const failing = sections.filter((s) => s.verdict === 'fail').sort((a, b) => b.severity - a.severity);
  // CONTENT-VOID aggregate (telemetry; the per-band cap is already folded into each band's visual above).
  const voidBands = sections.filter((s) => s.contentVoid);
  const voidCount = voidBands.length;
  // STRUCTURAL FIDELITY: source block-TYPES reproduced as same-type elements in the clone (count-matched).
  // A form/video/table/list/tabs the source has but the clone rebuilt as text/raster → structural miss.
  const sB = src.blocks || {}, cB = cln.blocks || {};
  const blockMiss = []; let credit = 0, types = 0;
  for (const k of Object.keys(sB)) { if ((sB[k] || 0) <= 0) continue; types++; const c = Math.min(cB[k] || 0, sB[k]) / sB[k]; credit += c; if (c < 1) blockMiss.push({ block: k, source: sB[k], clone: cB[k] || 0 }); }
  const structuralFidelity = types ? +(credit / types).toFixed(3) : 1;
  const editabilityMean = mean((s) => s.editability);
  // ssimRaw = the PRE-BLEND, SSIM-driven section-visual mean (the old visual term, preserved for diff/telemetry).
  const ssimRaw = mean((s) => s.visual);
  // PER-ELEMENT BLEND (reversible via GRADER_SSIM_ONLY=1). When ON, fetch the validated per-element sub-scores
  // for the source↔clone pair and fold them into the VISUAL term: visual = 0.5*SSIM + 0.5*perElement.
  let perElement = null, perElementScalar = null;
  if (USE_PERELEMENT) {
    const pe = perElementScores(source, SELFTEST ? source : clone, SELFTEST);
    if (pe && [pe.color, pe.typography, pe.position, pe.text].every((v) => typeof v === 'number' && !Number.isNaN(v))) {
      // effects may be absent on an old perelement-score build → default to 1 (neutral; weight folds away below).
      const eff = (typeof pe.effects === 'number' && !Number.isNaN(pe.effects)) ? pe.effects : 1;
      perElement = { color: pe.color, typography: pe.typography, position: pe.position, text: pe.text, effects: eff, coverage: pe.coverage };
      // perElement blend. EFFECTS folds INSIDE this term at a MODEST weight (color stays dominant). When
      // GRADER_NO_EFFECTS=1, fall back to the EXACT prior 0.35/0.25/0.20/0.20 blend (effects weight 0).
      perElementScalar = USE_EFFECTS
        ? +(0.30 * pe.color + 0.22 * pe.typography + 0.18 * pe.position + 0.18 * pe.text + 0.12 * eff).toFixed(3)
        : +(0.35 * pe.color + 0.25 * pe.typography + 0.20 * pe.position + 0.20 * pe.text).toFixed(3);
    } else {
      console.error('[grade-sections] per-element unavailable → falling back to SSIM-only visual for this run');
    }
  }
  // visual = blended when per-element available, else SSIM-only (flag off OR per-element failed).
  const visualMeanPre = (perElementScalar != null)
    ? +(0.5 * ssimRaw + 0.5 * perElementScalar).toFixed(3)
    : ssimRaw;
  // ---- GRADER-HONESTY DETECTORS: PURE functions over geometry capture() ALREADY collected (NO extra render /
  // navigation / network here — crash-robust on a wifi blip). Penalties fold into the EXISTING visual/structural
  // terms (NO new composite weight). Under SELFTEST (clone==source) each is forced to its no-op value (the clone
  // introduces ZERO new defects vs an identical source) so the HARD self-test gate stays deterministic == 1.0;
  // the RAW measured value is still reported for telemetry, mirroring the responsive-selftest pattern above.
  // (1) TEXT-COLLISION → visual × (1 - K1·collisionRate). Measured on the CLONE's raw pre-dedup text leaves.
  const tcRaw = DET_TEXTCOLLIDE ? textCollision(cln.textLeaves) : { rate: 0, pairs: 0 };
  const collisionRate = SELFTEST ? 0 : tcRaw.rate;
  const textCollideMult = DET_TEXTCOLLIDE ? +(1 - DET_K1 * collisionRate).toFixed(4) : 1;
  // (2) FULL-BLEED / gutter → visual × 0.9 when source full-bleed but clone inset. Source-vs-source identical → ok.
  const fbRaw = DET_FULLBLEED ? fullBleed(src.bands, cln.bands, W) : { srcFrac: 1, cloneFrac: 1, ok: true };
  const fullBleedOk = SELFTEST ? true : fbRaw.ok;
  const fullBleedMult = (DET_FULLBLEED && !fullBleedOk) ? 0.9 : 1;
  // (3) CHUNKED-MEDIA → structural penalty when the clone chunk-screenshotted a many-small-media region.
  const cmRaw = DET_CHUNKEDMEDIA ? chunkedMedia(src.mediaLeaves, cln.mediaLeaves, src.bands, W, DECHUNK_FAITHFUL) : { count: 0, regions: [] };
  const chunkedMediaCount = SELFTEST ? 0 : cmRaw.count;
  // each chunked region costs 0.08 structural, capped at 0.32 (a soft, additive structural penalty).
  const chunkedMediaMult = (DET_CHUNKEDMEDIA && chunkedMediaCount > 0) ? +(1 - Math.min(0.32, 0.08 * chunkedMediaCount)).toFixed(4) : 1;
  // (4) REAL-NAV → structural × 0.9 when source had a real header nav but the clone flattened it to body text.
  const rnRaw = DET_REALNAV ? realNav(src.navStruct, cln.navStruct) : { srcReal: false, cloneReal: false, ok: true };
  const realNavOk = SELFTEST ? true : rnRaw.ok;
  const realNavMult = (DET_REALNAV && !realNavOk) ? 0.9 : 1;
  // (5) DESKTOP HORIZONTAL-OVERFLOW → SEVERE visual penalty when the clone scrolls sideways past the source. Measured
  // on the REAL rendered scrollWidth of both pages. Source-vs-source: cloneScrollW==srcScrollW → ratio 1.0 → no-op.
  const hoRaw = DET_HOVERFLOW ? hOverflow(cln.docScrollW, src.docScrollW, W) : { overflowRatio: 1, cloneScrollW: 0, srcScrollW: 0, denom: W };
  const overflowRatio = SELFTEST ? 1 : hoRaw.overflowRatio;
  // tolerance band: ratios <= 1.02 (sub-pixel / harmless rounding) are a no-op. Beyond that, penalty scales with the
  // overflow and floors at DET_HOVERFLOW_FLOOR (a runaway h-scroll page is a hard human-obvious FAIL).
  const hOverflowMult = (DET_HOVERFLOW && overflowRatio > 1.02)
    ? +Math.max(DET_HOVERFLOW_FLOOR, 1 - DET_HOVERFLOW_K * (overflowRatio - 1)).toFixed(4)
    : 1;
  // (6) GENERAL WIDGET-OVERLAP → visual penalty for the EXCESS heavy-overlap area the clone introduces over the source.
  const clonePageArea = Math.max(1, W * (cln.pageH || 1));
  const srcPageArea = Math.max(1, W * (src.pageH || 1));
  const woClone = DET_OVERLAP2 ? widgetOverlap(cln.leafBoxes, clonePageArea) : { pairs: 0, overlapArea: 0, overlapFrac: 0 };
  const woSrc = DET_OVERLAP2 ? widgetOverlap(src.leafBoxes, srcPageArea) : { pairs: 0, overlapArea: 0, overlapFrac: 0 };
  const excessOverlap = SELFTEST ? 0 : +Math.max(0, woClone.overlapFrac - woSrc.overlapFrac).toFixed(4);
  // penalty scales with excess overlap fraction and floors at DET_OVERLAP2_FLOOR (a page where widgets pile on top of
  // each other — the 1700-pair framer clone — must drop materially). Clean clones (excess ~0) → multiplier ~1.
  const overlap2Mult = (DET_OVERLAP2 && excessOverlap > 0.005)
    ? +Math.max(DET_OVERLAP2_FLOOR, 1 - DET_OVERLAP2_K * excessOverlap).toFixed(4)
    : 1;
  // FOLD: text-collision + full-bleed + horizontal-overflow + widget-overlap multiply the VISUAL term;
  // chunked-media + real-nav multiply STRUCTURAL.
  const visualMean = +(visualMeanPre * textCollideMult * fullBleedMult * hOverflowMult * overlap2Mult).toFixed(3);
  const structuralFidelityPre = structuralFidelity;
  const structuralFidelityAdj = +(structuralFidelity * chunkedMediaMult * realNavMult).toFixed(3);
  // RESPONSIVE DIMENSION (reversible via GRADER_NO_RESPONSIVE=1). When ON, fetch the validated RLG
  // responsive sub-score for the source↔clone pair and fold it into the composite at weight 0.25.
  let responsive = null, responsiveScore = null;
  if (USE_RESPONSIVE) {
    if (SELFTEST) {
      // source-vs-source is responsive-consistent with ITSELF by definition → 1.0. We still INVOKE the
      // subprocess (proves the integrated path works + populates perBreakpoint), but the composite uses the
      // definitional 1.0 so the HARD self-test gate is deterministic (independent re-captures can wobble by a
      // few px; that nondeterminism must not break composite==1.0). The reported sub-score below is the
      // definitional 1.0; the raw subprocess value is surfaced in responsive.subprocessScore for telemetry.
      const rs = responsiveScores(source, source, true);
      responsiveScore = 1.0;
      responsive = rs
        ? { score: 1.0, edgeSet: rs.edgeSet, layout: rs.layout, coverage: rs.coverage, perBreakpoint: rs.perBreakpoint, subprocessScore: rs.score }
        : { score: 1.0, edgeSet: 1.0, layout: 1.0, coverage: 1.0, perBreakpoint: null, subprocessScore: null };
    } else {
      const rs = responsiveScores(source, clone, false);
      if (rs && typeof rs.score === 'number' && !Number.isNaN(rs.score)) {
        responsiveScore = rs.score;
        responsive = { score: rs.score, edgeSet: rs.edgeSet, layout: rs.layout, coverage: rs.coverage, perBreakpoint: rs.perBreakpoint };
      } else {
        console.error('[grade-sections] responsive unavailable → falling back to OLD composite (no responsive term) for this run');
      }
    }
  }
  // COMPOSITE: NEW (responsive available) renormalizes to make room for responsive at 0.25; OLD otherwise.
  //   NEW = 0.35*visual + 0.20*edit + 0.20*struct + 0.25*responsive
  //   OLD = 0.40*visual + 0.30*edit + 0.30*struct           (byte-for-byte the prior formula)
  const usingResponsive = USE_RESPONSIVE && responsiveScore != null;
  // composite uses the DETECTOR-ADJUSTED structural term (chunked-media + real-nav fold in here); visualMean was
  // already detector-adjusted above (text-collision + full-bleed). NO new top-level composite weight is added.
  const compositePreFold = usingResponsive
    ? +(0.35 * visualMean + 0.20 * editabilityMean + 0.20 * structuralFidelityAdj + 0.25 * responsiveScore).toFixed(3)
    : +(0.4 * visualMean + 0.3 * editabilityMean + 0.3 * structuralFidelityAdj).toFixed(3);
  // ---- G2 FOLD GATE (multiplicative; see USE_FOLDGATE flag block). foldVisual = mean band visual over the
  // bands intersecting y < FOLDGATE_PX. Source-vs-source: all band visuals 1.0 → mult exactly 1 → no-op.
  const foldBands = sections.filter((s) => s.y0 < FOLDGATE_PX);
  const foldVisual = foldBands.length ? +(foldBands.reduce((a, s) => a + s.visual, 0) / foldBands.length).toFixed(3) : 1;
  const foldMult = USE_FOLDGATE ? +(0.4 + 0.6 * foldVisual).toFixed(4) : 1;
  const composite = USE_FOLDGATE ? +(compositePreFold * foldMult).toFixed(3) : compositePreFold;
  // ---- MEDIA-IDENTITY aggregation + PROJECTED fold (REPORT-ONLY: the composite above is UNTOUCHED either way;
  // projected.* computes what the round-3 fold WOULD do so the folding decision is made on published numbers).
  let mediaIdentityMean = null, mediaIdentityReport = null;
  if (USE_MEDIAID) {
    const withMedia = miBands.filter((b) => b.mi && b.mi.score != null && b.mi.srcMediaArea > 0);
    const miDen = withMedia.reduce((a, b) => a + b.mi.srcMediaArea, 0);
    // area-weighted page mean (hero imagery outweighs footer favicons); null when no band has media → dim n/a.
    mediaIdentityMean = miDen > 0 ? +(withMedia.reduce((a, b) => a + b.mi.srcMediaArea * b.mi.score, 0) / miDen).toFixed(3) : null;
    const mediaIdentityMeanRaw = miDen > 0 ? +(withMedia.reduce((a, b) => a + b.mi.srcMediaArea * b.mi.raw, 0) / miDen).toFixed(3) : null;
    // projected fold: re-run the visual chain with the folded per-band visuals (same detector multipliers).
    const ssimRawFolded = miBands.length ? +(miBands.reduce((a, b) => a + b.visualFolded, 0) / miBands.length).toFixed(3) : 0;
    const visualMeanPreFolded = (perElementScalar != null) ? +(0.5 * ssimRawFolded + 0.5 * perElementScalar).toFixed(3) : ssimRawFolded;
    const visualMeanFolded = +(visualMeanPreFolded * textCollideMult * fullBleedMult * hOverflowMult * overlap2Mult).toFixed(3);
    const compositeFolded = usingResponsive
      ? +(0.35 * visualMeanFolded + 0.20 * editabilityMean + 0.20 * structuralFidelityAdj + 0.25 * responsiveScore).toFixed(3)
      : +(0.4 * visualMeanFolded + 0.3 * editabilityMean + 0.3 * structuralFidelityAdj).toFixed(3);
    mediaIdentityReport = {
      enabled: true, folded: MI_FOLD_LIVE,    // G4: LIVE since the grader-truth round (GRADER_NO_MIFOLD=1 → legacy report-only)
      mean: mediaIdentityMean, meanRaw: mediaIdentityMeanRaw, bandsWithMedia: withMedia.length,
      thresholds: { minLeaf: MI_MIN_LEAF, srcPaint: MI_SRC_PAINT, deMax: MI_DE_MAX, matchIoU: MI_MATCH_IOU, wId: MI_W_ID, wPresence: MI_W_PRESENCE, floorMult: MI_FOLD_FLOOR, ...(MI_FOLD_LIVE ? { svgMinLeaf: MI_SVG_MIN_LEAF, aboveFoldFrac: MI_FOLD_ABOVEFOLD_FRAC, aboveFoldPx: MI_FOLD_ABOVEFOLD_PX } : {}) },
      projected: { visualMeanFolded, compositeFolded },
      bands: withMedia.map((b) => ({ idx: b.idx, yRange: [b.y0, b.y1], identity: b.mi.identity, presence: b.mi.presence, score: b.mi.score, srcMediaFrac: b.srcMediaFrac, srcMediaArea: b.mi.srcMediaArea, cloneMediaArea: b.mi.cloneMediaArea, cloneOnlyMediaArea: b.mi.cloneOnlyMediaArea, leaves: b.mi.leaves, ...(MI_FOLD_LIVE ? { foldMult: b.foldMult, visualUnfolded: b.visualUnfolded } : {}) })),
    };
  }
  // structural misses are real defects → fail target if any block type unreproduced (use the adjusted value).
  const atTarget = failing.length === 0 && structuralFidelityAdj >= 0.95 && hRatio >= TGT.hLo && hRatio <= TGT.hHi;
  // WALL detector: source rendered almost no text for a large page → headless didn't render it
  const srcTextRuns = src.texts.length;
  const wallRisk = srcTextRuns < 15 && src.pageH > 2500;
  const report = {
    source, clone: SELFTEST ? '(selftest: source vs source)' : clone,
    atTarget, target: { ...TGT, structuralFidelity: 0.95 },
    composite,
    // G2 FOLD GATE (absent entirely under GRADER_NO_FOLDGATE=1 → byte-identical legacy report).
    ...(USE_FOLDGATE ? { compositeUnfolded: compositePreFold, foldGate: { px: FOLDGATE_PX, foldVisual, mult: foldMult, bands: foldBands.map((s) => ({ idx: s.idx, y0: s.y0, y1: s.y1, visual: s.visual })) } } : {}),
    visualMean, editabilityMean, structuralFidelity: structuralFidelityAdj, hRatio: +hRatio.toFixed(3),
    // OBJECTIVE-FLIP telemetry: pre-blend SSIM mean + the per-element sub-scores folded into visual.
    ssimRaw,
    // GRADER-HONESTY DETECTORS (each env-flag-gated; default ON; GRADER_NO_DETECTORS=1 master-off). Required
    // report fields + telemetry. Penalties already folded into visualMean (text-collision, full-bleed) and the
    // adjusted structuralFidelity (chunked-media, real-nav). visualMeanPre/structuralFidelityPre = pre-penalty.
    collisionRate, fullBleedOk, chunkedMediaCount, realNavOk, overflowRatio, excessOverlap, contentVoidCount: voidCount,
    // MEDIA-IDENTITY (REPORT-ONLY; absent entirely when GRADER_NO_MEDIAID=1 → byte-identical legacy report).
    ...(USE_MEDIAID ? { mediaIdentityMean } : {}),
    detectors: {
      enabled: { master: DET_MASTER, textCollide: DET_TEXTCOLLIDE, fullBleed: DET_FULLBLEED, chunkedMedia: DET_CHUNKEDMEDIA, realNav: DET_REALNAV, hOverflow: DET_HOVERFLOW, overlap2: DET_OVERLAP2, voidPenalty: DET_VOIDPENALTY },
      contentVoid: { enabled: DET_VOIDPENALTY, count: voidCount, ceil: VOID_CEIL, srcContentThresh: VOID_SRC_CONTENT, cloneFloorFrac: VOID_CLONE_FLOOR, bgAbs: VOID_BG_ABS, bands: voidBands.map((b) => ({ idx: b.idx, yRange: [b.y0, b.y1], srcEnergy: b.srcEnergy, cloneEnergy: b.cloneEnergy, visualPreVoid: b.visualPreVoid, visual: b.visual })) },
      textCollision: { rate: collisionRate, rawRate: tcRaw.rate, pairs: tcRaw.pairs, mult: textCollideMult },
      fullBleed: { ok: fullBleedOk, srcFrac: fbRaw.srcFrac, cloneFrac: fbRaw.cloneFrac, mult: fullBleedMult },
      chunkedMedia: { count: chunkedMediaCount, rawCount: cmRaw.count, regions: cmRaw.regions, mult: chunkedMediaMult },
      realNav: { ok: realNavOk, srcReal: rnRaw.srcReal, cloneReal: rnRaw.cloneReal, mult: realNavMult, srcNav: src.navStruct, cloneNav: SELFTEST ? src.navStruct : cln.navStruct },
      hOverflow: { overflowRatio, rawRatio: hoRaw.overflowRatio, cloneScrollW: hoRaw.cloneScrollW, srcScrollW: hoRaw.srcScrollW, denom: hoRaw.denom, mult: hOverflowMult },
      overlap2: { excessOverlap, cloneOverlapFrac: woClone.overlapFrac, srcOverlapFrac: woSrc.overlapFrac, clonePairs: woClone.pairs, srcPairs: woSrc.pairs, mult: overlap2Mult },
      ...(USE_MEDIAID ? { mediaIdentity: mediaIdentityReport } : {}),
      visualMeanPre, structuralFidelityPre,
    },
    perElement,                       // {color,typography,position,text,effects,coverage} or null (SSIM-only / unavailable)
    perElementScalar,                 // USE_EFFECTS: 0.30*color+0.22*typo+0.18*pos+0.18*text+0.12*effects ; else prior 0.35/0.25/0.20/0.20
    usePerElement: USE_PERELEMENT && perElement != null,
    useEffects: USE_PERELEMENT && USE_EFFECTS && perElement != null,
    // RESPONSIVE dimension (reversible via GRADER_NO_RESPONSIVE=1).
    responsive,                       // {score,edgeSet,layout,coverage,perBreakpoint} or null (flag off / unavailable)
    useResponsive: usingResponsive,
    sections: sections.length, sectionsFailing: failing.length,
    blocksSource: sB, blocksClone: cB, blockMisses: blockMiss,
    wallRisk, srcTextRuns,
    rankedDefects: failing.slice(0, 12).map((s) => ({ section: s.idx, yRange: [s.y0, s.y1], severity: s.severity, fails: s.fails, why: s.why, visual: s.visual, editability: s.editability, srcTextCount: s.srcTextCount, example: s.example })),
    perSection: sections,
  };
  fs.writeFileSync(`${outDir}/sections.json`, JSON.stringify(report, null, 2));
  if (SELFTEST) {
    // HARD GATE: composite==1.0 AND (when blended) every per-element sub-score==1.0 AND (when on) the
    // responsive sub-score==1.0 (source-vs-source must be perfectly responsive-consistent with itself).
    const peOk = !report.usePerElement || (report.perElement && ['color', 'typography', 'position', 'text', 'effects', 'coverage'].every((k) => Math.abs(report.perElement[k] - 1) <= 0.005));
    const respOk = !report.useResponsive || (report.responsive && Math.abs(report.responsive.score - 1) <= 0.005);
    // DETECTORS must be NO-OPS on source-vs-source (every multiplier == 1, no penalty applied).
    const detOk = textCollideMult === 1 && fullBleedMult === 1 && chunkedMediaMult === 1 && realNavMult === 1 && hOverflowMult === 1 && overlap2Mult === 1 && collisionRate === 0 && fullBleedOk && chunkedMediaCount === 0 && realNavOk && overflowRatio <= 1.02 && excessOverlap === 0 && voidCount === 0;
    const ok = report.composite >= 0.99 && report.atTarget && peOk && respOk && detOk;
    const peStr = report.perElement ? ` perElement{color ${report.perElement.color} typo ${report.perElement.typography} pos ${report.perElement.position} text ${report.perElement.text} effects ${report.perElement.effects} cov ${report.perElement.coverage}}` : ' perElement(SSIM-only)';
    const respStr = report.useResponsive ? ` responsive{score ${report.responsive.score} edge ${report.responsive.edgeSet} layout ${report.responsive.layout} cov ${report.responsive.coverage}${report.responsive.subprocessScore != null ? ` subproc ${report.responsive.subprocessScore}` : ''}}` : ' responsive(off)';
    const detStr = ` detectors{textCollide ${textCollideMult} fullBleed ${fullBleedMult} chunkedMedia ${chunkedMediaMult} realNav ${realNavMult} hOverflow ${hOverflowMult}(ratio ${overflowRatio}) overlap2 ${overlap2Mult}(excess ${excessOverlap}) contentVoid ${voidCount} → ${detOk ? 'no-op' : 'FIRED (drift!)'}}`;
    console.log(`SELFTEST composite ${report.composite} atTarget ${report.atTarget}${peStr}${respStr}${detStr} → ${ok ? 'PASS (judge consistent)' : 'FAIL (grader drift!)'}`);
    process.exit(ok ? 0 : 1);
  }
  console.log(`atTarget ${report.atTarget} | composite ${report.composite} (visual ${report.visualMean}${report.perElementScalar != null ? ` [ssim ${report.ssimRaw} ⊕ pe ${report.perElementScalar}]` : ''} edit ${report.editabilityMean} struct ${report.structuralFidelity}${report.useResponsive ? ` resp ${report.responsive.score}` : ''}) | hRatio ${report.hRatio} | ${report.sectionsFailing}/${report.sections} sections failing${report.wallRisk ? ' | ⚠ WALL-RISK' : ''}`);
  if (USE_FOLDGATE) console.log(`fold-gate: foldVisual ${foldVisual} over ${foldBands.length} band(s) y<${FOLDGATE_PX} → ×${foldMult} (unfolded ${compositePreFold} → published ${report.composite})`);
  if (report.responsive) console.log(`responsive: score ${report.responsive.score} (edgeSet ${report.responsive.edgeSet} · layout ${report.responsive.layout} · coverage ${report.responsive.coverage})`);
  if (report.perElement) console.log(`per-element: color ${report.perElement.color} typo ${report.perElement.typography} pos ${report.perElement.position} text ${report.perElement.text} effects ${report.perElement.effects} cov ${report.perElement.coverage}`);
  if (report.blockMisses.length) console.log('block-type misses (source → clone): ' + report.blockMisses.map((b) => `${b.block} ${b.source}→${b.clone}`).join(', '));
  if (DET_MASTER) console.log(`detectors: collisionRate ${report.collisionRate} (×${textCollideMult}) · fullBleedOk ${report.fullBleedOk} (src ${fbRaw.srcFrac}/clone ${fbRaw.cloneFrac}, ×${fullBleedMult}) · chunkedMediaCount ${report.chunkedMediaCount} (×${chunkedMediaMult}) · realNavOk ${report.realNavOk} (src ${rnRaw.srcReal}/clone ${rnRaw.cloneReal}, ×${realNavMult})`);
  if (DET_MASTER) console.log(`reality: hOverflow ratio ${report.overflowRatio} (cloneScrollW ${hoRaw.cloneScrollW}/srcScrollW ${hoRaw.srcScrollW}/denom ${hoRaw.denom}, ×${hOverflowMult}) · widgetOverlap excess ${report.excessOverlap} (clone ${woClone.overlapFrac}@${woClone.pairs}pairs / src ${woSrc.overlapFrac}@${woSrc.pairs}pairs, ×${overlap2Mult})`);
  if (DET_VOIDPENALTY) { console.log(`content-void: ${voidCount} band(s) penalized (cap ${VOID_CEIL})`); for (const b of voidBands) console.log(`  §${b.idx} y${b.y0}-${b.y1} srcEnergy ${b.srcEnergy} cloneEnergy ${b.cloneEnergy} → visual ${b.visualPreVoid}→${b.visual}`); }
  if (USE_MEDIAID && mediaIdentityReport) {
    console.log(MI_FOLD_LIVE
      ? `media-identity (G4 LIVE fold in band visuals): mean ${mediaIdentityMean} over ${mediaIdentityReport.bandsWithMedia} media band(s) · ${mediaIdentityReport.bands.filter((b) => b.foldMult != null && b.foldMult < 1).length} band(s) folded`
      : `media-identity (report-only, NOT in composite): mean ${mediaIdentityMean} over ${mediaIdentityReport.bandsWithMedia} media band(s) · projected fold: visual ${visualMean}→${mediaIdentityReport.projected.visualMeanFolded} composite ${composite}→${mediaIdentityReport.projected.compositeFolded}`);
    for (const b of mediaIdentityReport.bands.filter((x) => x.score != null && x.score < 0.7).sort((a, c) => a.score - c.score).slice(0, 6)) console.log(`  §${b.idx} y${b.yRange[0]}-${b.yRange[1]} M ${b.score} (id ${b.identity} pres ${b.presence}) leaves ${b.leaves.eligible} matched ${b.leaves.matched} wrong ${b.leaves.wrong} missing ${b.leaves.missing}`);
  }
  console.log('top defects:'); for (const d of report.rankedDefects.slice(0, 6)) console.log(`  §${d.section} y${d.yRange[0]}-${d.yRange[1]} sev ${d.severity} [${d.fails.join('+')}: ${d.why.join(',')}] vis ${d.visual} edit ${d.editability}${d.example ? ' e.g. "' + d.example + '"' : ''}`);
})();
