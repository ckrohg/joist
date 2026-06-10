# Layout Engine — Sequenced, De-Risked Roadmap

@purpose The single execution plan for the clone LAYOUT ENGINE. Synthesizes 6 adversarially-reviewed effort
designs into one dependency-ordered, gated, LOOK-first roadmap. This is the doc a future agent (or human)
executes against — concrete code-slots, small steps, gate flags, definition-of-done, and the adversarial issues
that MUST be closed per effort. Grounded in the real code (build-hybrid.mjs, grade-structure.mjs,
abs-positioning.mjs), not assumptions. Supersedes the "Proposed architecture" section of LAYOUT_ENGINE_SCOPE.md
by giving it an order and a gate. (2026-06-08)

---

## 0. NON-NEGOTIABLE METHODOLOGY (read before touching any code)

These were learned the painful way this session. Violating them is the #1 failure mode. They override any
pressure to move fast.

1. **LOOK at EVERY change.** Screenshot the rendered clone (Playwright `browser_take_screenshot`, full page,
   1440px) and JUDGE IT BY EYE against the source. The grade is NEVER sufficient. The whole project nearly
   derailed because changes were optimized against the grader without looking, and clones that scored ~0.80
   looked ~40-50% broken. The grade is a guard-rail, the eye is the verdict.

2. **The grader's VISUAL metric is BLIND to fine-grained content fidelity** (icons, grid structure, code
   blocks). `ssim()` (8px window) and `exactFrac()` (2px stride) at `grade-structure.mjs:26-27` are
   pixel-alignment-sensitive: a faithful reconstruction landing a few px off scores FLAT. This is why
   reconstruction work is currently UNMEASURABLE. **Effort #1 (grader-visual-fix) is the GATE that lifts this
   blindness — nothing downstream is trustworthy until it lands.**

3. **Small steps, REVERT on regression.** Every broad change this session regressed and was reverted:
   P1 multi-column abs (tailwind drift 0.583, corpus 0.807<0.836), text-dominance height-cap override,
   per-row min_height, cycle-2 column-aware emitter (hRatio 1.86, composite 0.595→0.477), abs-rescue (sparse
   broken pages). Gate each change on the corpus AND the eye. If a known-good site regresses on EITHER, revert.

4. **GATE every risky feature behind an env flag**, default-OFF (or default-byte-identical), until LOOK-
   validated. Prove byte-identical default behavior with a DRY-tree diff, not prose. Promote the default ONLY
   after multi-site LOOK wins with no known-good regression.

5. **ANTI-GAMING: never credit garbage.** A past bug counted shredded code-tokens (`<`, `div`, `class`, `=`)
   as "editability" → high score, broken page. Any design must avoid creating such fake wins. Editability is
   already coupled to per-band visual fidelity (`bandVisAt`, `grade-structure.mjs:193,200`) — preserve that
   coupling; never add a metric or path that credits presence/texture without correctness.

6. **Known-good vs known-hard corpus (the LOOK fixtures):**
   - **Known-good** (the working sweet spot, ~0.80-0.84, editable+faithful): **supabase, notion, cal.com** —
     clean full-width section structure, renders fully headless. These are the REGRESSION guards: any change
     must leave them visually identical-or-better.
   - **Known-hard** (reconstruction failure, visual ~0.5): **stripe.com 0.49, clerk.com 0.56** — dense
     multi-column feature/card grids flatten to sparse text; their ICONS are `<svg>` (Stripe: 88 icon-svgs vs
     12 `<img>`) which the builder does NOT capture → cards render empty.

7. **There is NO headless capture wall.** Stripe/clerk render fine headless; posthog is a niche app-shell. Do
   NOT propose headed/stealth capture — it has no target. The lever is RECONSTRUCTION QUALITY + MEASURING it.

8. **Re-derive against the cached models before writing detector code.** `/tmp/hybrid-cache/<tag>/model.json`
   is the ground truth. The grid-reconstruction design was REJECTED because its empirical claims (linear has
   high mediaFrac; reactdev is a 2-col grid) were false against the actual data. A `--dry`/print-only logger
   over the cached corpus is the mandatory first step of any detection work.

9. **Re-sync the skill bundle** (`plugin/skills/joist-clone/pipeline/`) after any pipeline change — it is a
   snapshot, not a symlink (LAYOUT_ENGINE_SCOPE.md risk note).

---

## 1. DEPENDENCY GRAPH

```
                    ┌─────────────────────────────┐
                    │  #1 grader-visual-fix (CGM) │  ◄── THE GATE. report-only first.
                    │  grade-structure.mjs        │      Nothing below is trustworthy
                    │  GATE / measurableNow=true  │      (measurable) until this lands.
                    └───────────────┬─────────────┘
                                    │ makes reconstruction MEASURABLE
          ┌─────────────────────────┼───────────────────────────────┐
          │                         │                               │
          ▼                         ▼                               │
┌───────────────────┐   ┌───────────────────────┐                   │
│ #2 section-bg     │   │ #3 grid-reconstruction│ ◄── only if a real │
│ capture           │   │ (BLOCKED: no corpus   │     2D grid exists  │
│ measurableNow=YES │   │  target — see gate)   │     in the corpus   │
│ INDEPENDENT       │   └───────────┬───────────┘                   │
│ (lands in parallel│               │ provides grid CELLS            │
│  with #1, low-risk│               ▼                               │
│  additive)        │   ┌───────────────────────┐                   │
└───────────────────┘   │ #4 imagery-region-    │                   │
                        │ capture (icons → cells)│                   │
                        │ depends on #3 CELLS    │                   │
                        └───────────────────────┘                   │
                                                                     │
          ┌──────────────────────────────────────────────┐         │
          │ #5 width-preserving-flow                      │         │
          │ BLOCKED pending a scratch experiment proving  │         │
          │ %-width survives .e-con; else DEFERRED/pivot  │◄────────┘
          └──────────────────────────────────────────────┘
                                    │
                                    ▼ (only after #1,#3,#5 land + are LOOK-proven)
                    ┌─────────────────────────────┐
                    │ #6 strategy-router          │ ◄── meta-layer. LAST. Premature
                    │ depends on #1,#3,#5          │      until its strategies exist
                    │ + a real per-section grader  │      and a per-section grading
                    │   primitive (does NOT exist) │      primitive is BUILT+self-tested.
                    └─────────────────────────────┘
```

**Why this shape:**
- #1 is the gate (the prompt mandate): the visual metric must be able to SEE reconstruction before any
  reconstruction effort is trustworthy.
- #2 (section-bg) is the ONE reconstruction effort the *current* grader already measures (a flat band fill is
  exactly what band-SSIM sees). It is independent and low-risk, so it runs in parallel with #1 to bank an
  early, measurable, honest win.
- #3 → #4: icons only have a home once grid CELLS exist; #4 is otherwise scattered free-floating images
  (the reverted failure). #3 is itself BLOCKED on finding a real grid in the corpus.
- #5 is independently BLOCKED on a contradiction in its own cited evidence (%-width vs .e-con override).
- #6 (router) is the capstone — it cannot demonstrate a win until its strategies exist and a per-section
  grading primitive is built. It was the design with the most adversarial issues; sequence it LAST.

---

## 2. SEQUENCED ORDER (execution)

| Seq | Effort | Status / Precondition | Risk | Measurable when |
|----|--------|----------------------|------|----------------|
| **A** | #1 grader-visual-fix (CGM) | GO — the gate | low (report-only) | self (now) |
| **B** | #2 section-background-capture | GO — independent, additive | low-med | now (band-SSIM sees fills) |
| **C** | #3 grid-reconstruction | **BLOCKED**: prove a real 2D grid exists in corpus (Step 0 logger) first | high | only after #1 |
| **D** | #4 imagery-region-capture | depends on #3 landing | med | only after #1 (LOOK-primary) |
| **E** | #5 width-preserving-flow | **BLOCKED**: scratch experiment must prove %-width survives `.e-con` | med-high | only after #1 (LOOK-primary) |
| **F** | #6 strategy-router | depends on #1,#3,#5 + a NEW per-section grading primitive | high | after deps |

Run A and B concurrently (different files: grade-structure.mjs vs build-hybrid.mjs). Do not start C/D/E until
A is at least report-only-validated (the signal is needed to measure them). Do not start F until C and E have
each independently shipped a LOOK-proven, non-regressive win.

---

## EFFORT #1 — grader-visual-fix (Content-Grid Match / CGM)  ⟵ THE GATE

**Verdict: needs-fixes (confidence 0.82). MUST be addressed before the blend; report-only is safe to ship.**

### Verified approach
Add a content-aware, alignment-tolerant visual signal — **CGM** — to `grade-structure.mjs` as a THIRD band
function alongside `ssim()`/`exactFrac()`, computed from the SAME two full-page PNGs (`src.shot`, `cln.shot`)
the grader already captures (no new capture pass, negligible runtime). CGM pools `|∇gray|` edge/feature
density into a coarse cell grid (gx=24 cols, gy≈band/40 rows), and for each SOURCE content-cell takes the best
symmetric ratio `min(s,c)/max(s,c)` over a ±1-cell neighborhood (alignment tolerance), mass-weighted so dense
bands dominate and blank bands earn no free credit, with an over-density guard that zeroes noise/shred floods.
Prototype reproduced on the real PNGs: self=1.000, blank=0.000, noise=0.000 (verified). It is reported as a new
breakdown field FIRST (zero scoring impact), folded into `visual` ONLY later behind `GRADER_CGM=1` after
LOOK-validation.

### Concrete code-slot
- `grade-structure.mjs`: add `edgeDensity()` + `cgmBand()` helpers after `exactFrac` (line 27).
- In the band loop (line 178), accumulate `cgmCredSum`/`cgmMassSum` alongside the existing `sArr`/`eArr`.
- `cgmMean` always emitted in `report.breakdown.cgm_mean` (diagnostic).
- `visual` (line 187) stays `(0.5*ssimMean + 0.5*exactMean)*hPen` by default; blend
  `(0.34*ssimMean + 0.33*exactMean + 0.33*cgmMean)*hPen` ONLY when `process.env.GRADER_CGM === '1'`.

### Small, LOOK-validatable steps
- **Step 0 — self-test harness.** Add `--selftest`: run clone===source on a cached PNG, assert
  `cgm_mean>0.99` AND `composite>0.99`, exit non-zero on failure. This is the regression guard for every later
  step. **Extend it with the adversarial separation assertions below** (mirror, roll, centered-stack).
- **Step 1 — report-only, zero impact.** Add the helpers; emit `cgm_mean` only. Verify composite is
  byte-identical to before on supabase/notion/stripe/clerk (visual formula untouched). Proves zero
  default-regression risk. **Verify here (not assumed): on a REAL rendered Elementor clone with borders/
  shadows/hover-outlines, `cloneMass/srcMass` stays well under 1.5× (the over-density guard must NOT trip on a
  faithful clone — a deflation-lie per lesson #2).**
- **Step 2 — LOOK the signal.** Grade stripe + clerk (visual ~0.49/0.56). Confirm `cgm_mean` is LOW where the
  cards are visibly empty/sparse. Build ONE improved section (e.g. with #2 section-bg, or a #3 grid variant
  once it exists), re-grade, and SCREENSHOT: `cgm_mean` must RISE *only when the eye sees real improvement*.
  If cgm rises with no visible improvement → the signal is lying → revert.
- **Step 3 — separation proof.** Grade a known-good (supabase, expect high cgm) vs a stripe flow-flatten
  (expect lower). Confirm the GAP exceeds the band-SSIM gap on the same pair. Document both numbers.
- **Step 4 — gate the blend.** ONLY after Steps 2-3 LOOK-validate AND the adversarial issues below are
  closed: enable `GRADER_CGM=1`. Re-run the corpus flag-ON vs flag-OFF. Accept only if no known-good clone
  regresses visually by eye. If any known-good drops without a visual cause, keep CGM report-only (still
  valuable as a measurement).
- **Step 5 — tune `off`/`T`/grid only if needed**, re-running `--selftest` after each change.

### Gate flag
`GRADER_CGM=1` (folds CGM into `visual`). Default OFF → `visual` byte-identical. `cgm_mean` is ALWAYS reported
(diagnostic, even when gated off).

### Adversarial issues that MUST be closed (verdict requiredChanges)
- **[gaming] Mirror/wrong-position credit.** VERIFIED: a horizontal-mirror of stripe (visibly broken) scores
  CGM=0.680; a vertical-roll scores 0.44 — both far above blank. CGM credits density DISTRIBUTION, not content
  CORRECTNESS, and web layouts are roughly horizontally density-symmetric. **Required:** before any blend, add
  an anti-mirror / wrong-layout test to the gate and require CGM to score mirror/roll LOW (<0.4). Add an
  asymmetry term or per-cell content *correlation* (not just density magnitude) so wrong-position content is
  not credited. This is the most important fix — without it, CGM is a fake-win vector for non-text content
  (the exact regions it targets, which editability's text-coupling does NOT guard).
- **[regression-risk] Over-density guard knife-edge.** VERIFIED: source + mild per-pixel noise (±30, mimicking
  font-hinting/box-shadow/border differences Elementor adds) scores 0.007 — the guard ZEROES it. The 1.5×-3×
  zone is UNTESTED on a real Elementor clone. **Required:** verify on a REAL clone (not synthetic) in Step 1
  that `cloneMass/srcMass` stays under 1.5× on a faithful clone; if real clones trip it, raise the threshold
  or soften the damp. Otherwise CGM DEFLATES faithful clones.
- **[unmeasurable] Weak gradient between DEGREES of flatten.** Centered-stack (0.456) and sparse-left-third
  (0.422) are only ~0.03 apart vs ~0.85 faithful. CGM separates faithful-from-flattened but gives little
  inch-by-inch gradient. **Required:** accept CGM as a faithful/flattened SEPARATOR, not a fine reconstruction
  optimizer; document this limit so future work doesn't mistake a flat cgm for "no progress."
- **[not-looking] Alignment tolerance is ~60px with a hard cliff by 80px** (drops to 0.52). **Required:**
  document honestly in the code comment + scope doc so a faithful-but-80px-off reconstruction isn't mistaken
  for a clone failure. Consider `off: 1→2` only if Step 5 shows it's too tight.
- **[other] Quoted constants are approximate** (shifted-12px measured 0.838, not the design's 0.869).
  Re-verify all constants at implementation; self/blank/noise (1.000/0.000/0.000) reproduce exactly.

### Definition of Done
- `--selftest` passes: self=1.000, blank=0.000, noise=0.000, **AND mirror<0.4, roll<0.4** (the added
  separation assertions).
- On a REAL Elementor clone, over-density guard stays ~1.0 (no deflation).
- **LOOK win:** on stripe.com (named known-hard), an improved section's screenshot shows visible icons/grid/
  fill AND its `cgm_mean` rises in proportion — eye-improvement and cgm-rise move together.
- **Non-flat grade once landed:** the GAP between a known-good and a known-empty clone is larger under CGM
  than under band-SSIM on the same pair (Step 3).
- Default behavior byte-identical until `GRADER_CGM=1` is promoted post-LOOK.

---

## EFFORT #2 — section-background-capture

**STATUS (corrected 2026-06-09): BUILT as a GATED prototype, default-OFF.** Shipped in commit `3591b20`
(verbatim gradient section-bg capture+emit). Gate is `HYBRID_SECTION_BG === '1'` at `build-hybrid.mjs:43` —
it was NEVER promoted to default-on (Step 4 below not reached); the steps/issues below remain the promotion
checklist. (Related but separate: capture-side band-bg gutter sampling in `capture-layout.mjs:1686` is
default-ON via `CAPTURE_NO_BANDBG` opt-out; the `CAPTURE_SPLITBG` modalBg vertical-split guard is opt-in,
net unverified — see [[tailwind_bg_overpaint_structural]].)

**Original verdict: needs-fixes (confidence 0.82). The dominant-solid-stop path is a KNOWN-INFERIOR move — fix before
shipping.**

### Verified approach
Extend the per-section background capture (`build-hybrid.mjs:196`, currently solid-`backgroundColor`-only with
an over-strict `r.y-y0<6` start match) to ALSO capture (a) faint solid tints missed by the strict match and
(b) CSS gradient backgrounds (`background-image: linear-gradient`) which today fall through to white. This is
the ONE reconstruction effort the *current* grader can already SEE: a flat band fill (faint grey vs pure
white) is a uniform per-band delta that `ssim()`/`exactFrac()` register directly, AND raising a text band's
visual fidelity lifts that band's editability credit via `bandVisAt` (`grade-structure.mjs:193,200`) — a real
coupled win.

### Concrete code-slot
- `build-hybrid.mjs`: in `page.evaluate` replace the single-line section-bg capture at line 196 with a
  gradient-aware, area-RANKED scan (collect candidates, keep the LARGEST-area opaque full-width one — not the
  first `break`; relax `r.y-y0<6` to a band-OVERLAP test). Capture the RAW gradient STRING in-page (the
  resolve helper is node-side).
- Add `bgGrad` to the pushed section object (line 234).
- Node-side, after the `classify()` loop (line ~253), resolve gradient→color into `sec.bg` UNDER the gate.
- The three builders (lines 76, 100, 120) already paint `sec.bg` → ZERO builder change.
- Hoist `isWhite` (line 328) above the section loop so the resolve and `rootBg` check share it.

### Small, LOOK-validatable steps
- **Step 0 — baseline LOOK** on a known-good faint-grey-band site (supabase/notion) with `--cache`. Screenshot
  clone vs source; record which editable bands render white that should be tinted; record per-band ssim.
- **Step 1 — solid-tint relax only (gated).** Implement the relaxed area-ranked SOLID scan behind
  `HYBRID_SECTION_BG=1`. Rebuild from the SAME cache (deterministic), screenshot. Confirm previously-white
  faint bands now show correct grey AND **no correctly-white band turned grey** (false positive).
- **Step 2 — gradient→fill (gated).** Add the resolve + in-page capture. Screenshot a gradient-band site.
  Verify the band carries the right tone and text contrast survived.
- **Step 3 — corpus gate.** Run known-good (supabase/notion/cal) + known-hard (stripe/clerk) flag-ON. Hold
  ALL FOUR composite terms within noise on known-good (visual, editability, designSystem, responsive), not
  just per-band ssim. LOOK at each.
- **Step 4 — default-on** (`HYBRID_SECTION_BG !== '0'`, AUTO_ABS pattern at line 262) only after corpus+LOOK
  clean.
- **Step 5 — re-sync skill bundle + journal.**

### Gate flag
`HYBRID_SECTION_BG=1` → default-OFF initially; promote to default-on (`!== '0'`) after Step 3.

### Adversarial issues that MUST be closed (verdict requiredChanges)
- **[regression-risk] Dark-stop flooding (HEADLINE).** The reused `gradientColor()` returns the FIRST stop
  whose channel-avg < 90 (DARK), painting a small dark accent stop as the ENTIRE band. On a band that renders
  predominantly light, this is a visual REGRESSION the grader WILL see. **Required:** do NOT use the
  dark-preferring helper as-is. Either (a) ship the round-45 PROVEN **verbatim-gradient emission** (inline
  `background:<grad>` via custom_css, KSES-confirmed, SSIM 0.676→0.877 on react.dev), or (b) if keeping a flat
  solid, pick the LUMINANCE-DOMINANT stop weighted by the source band's actual rendered pixels (sample the
  captured `/tmp/hybrid-src-<tag>.png` band), and reject any color whose luminance is far from the band's mean.
- **[regression-risk] Known-inferior path.** recipe-library.json round 45 already tried dominant-solid-stop
  and REPLACED it with verbatim emission. **Required:** cite round 45; default to verbatim emission as v1, or
  justify the solid fallback explicitly.
- **[not-looking] Contrast-guard gap.** The proposed guard only skips dark-fill-behind-DARK-text. The real
  failure is dark-fill-behind-LIGHT-text (clone's `contrastPass` RISES while fidelity DROPS). **Required:**
  guard on whether the painted fill's luminance MATCHES the source band's dominant luminance, regardless of
  text color — do not rely on clone-internal contrastPass.
- **[regression-risk] Relaxed solid scan false-positives.** `body *` includes full-width wrapper/overlay/
  cookie-banner divs; max-area can grab the wrong element and tint a correctly-white band. **Required:** gate
  the relaxed SOLID path behind the same `isWhite`/near-white rejection currently only on gradients, AND add
  an automated source-band luminance/deltaE cross-check BEFORE applying any captured bg (solid OR gradient):
  compare the candidate to the mean color of the corresponding band in `/tmp/hybrid-src-<tag>.png`; skip if
  deltaE is large. Makes the false-positive guard real, not LOOK-only.
- **[unmeasurable] Gradient-as-flat-fill is itself a mismatch** the grader sees (a real ramp vs a flat color),
  so a flat solid may score ~break-even. **Required:** prefer verbatim emission (the path that actually moves
  SSIM); treat flat-solid gradients as break-even, not a clean win.
- **[mobile-cost] Re-check the 390px responsive term** after default-on (a wrongly-tinted band is inherited at
  mobile too).

### Definition of Done
- A faint-grey band site (supabase/notion): previously-white editable bands now carry the source tint, text
  readable, **and nothing correctly-white turned grey** — LOOK-confirmed.
- A gradient-band site (stripe hero): band shows the right tone (verbatim emission preferred), contrast
  survived, per-band ssim ROSE on exactly those y-ranges (this effort IS grader-measurable — that's its
  value).
- All four composite terms within noise on the known-good trio.
- Default-on with `HYBRID_SECTION_BG !== '0'` opt-out, post corpus+LOOK.

---

## EFFORT #3 — grid-reconstruction

**STATUS (corrected 2026-06-09): SHIPPED, DEFAULT-ON.** The block below ("BLOCKED / REJECT") is the
pre-build verdict and is SUPERSEDED: the true 2D card-grid reconstruction landed as commit `d2c0b5b`
(gated) and was promoted DEFAULT-ON in `ab8f7ab` (2026-06-08) after corpus (+0.004) + LOOK validation
with no drift ([[layout_engine_wave_shipped]]). The shipped gate is `HYBRID_GRID !== '0'` (opt-OUT) at
`build-hybrid.mjs:144` — NOT the `HYBRID_GRID2` flag this doc proposed; `detectGrid`/`buildGridSection`
live at `build-hybrid.mjs:67+`.

**Original (pre-build) verdict: REJECT (confidence 0.85). Do NOT build until the blockers below are cleared. The design's empirical
grounding was FALSE against the cached models.**

### Why it's blocked (verified against /tmp/hybrid-cache)
- The named ACCEPT targets reactdev[13]/[17] are SINGLE-column vertical lists (heading+body all at x=902,
  w=350) with span 133-156px — REJECTED by the detector's OWN `W*0.45` span gate. There is no 2D grid to
  reconstruct there.
- The named REJECT traps linear[12]/[24] have `mediaFrac=0` (NOT media-dominant) — the design's primary
  `mediaFrac<0.35` mockup defense does NOT fire on them; they're saved only by the accidental `realCols>4` cap.
- Net: the corpus may contain NO clean repeated-cell 2D grid. Building a grid reconstructor with no grid to
  reconstruct is unfalsifiable optimization (lesson #2 + #8).

### Verified approach (only once a real grid exists)
Extend the existing gated grid path (`detectGrid`/`buildGridSection`, `HYBRID_GRID=1`, lines 54-78) with a
two-stage detector: (a) cluster leaves into CELLS by bimodal vertical-gap analysis (intra-cell line gap vs
inter-cell gap) BEFORE clustering cells into COLUMNS, and (b) emit an N-cell flex-wrap grid where each cell is
a width-preserved sub-container. Conservative: fire ONLY on real card grids; REFUSE product-mockup sections.

### Concrete code-slot
- `build-hybrid.mjs`: `detectCardGrid(sec)` + `splitCells()`/`cellBox()` + `buildCardGridSection(sec, grid)`,
  slotting into `buildEditableSection()` (line 81) BEFORE the existing `HYBRID_GRID` block, gated by
  `HYBRID_GRID2=1`. NOTE the closure constraint: `detectGrid` closes over module-level `W` (line 54); keep new
  detectors in the same scope, or pass `W` explicitly and update signatures.

### Small, LOOK-validatable steps
- **Step 0 (MANDATORY FIRST — no behavior change): `--dry-cardgrid` logger.** Print, for every cached site,
  which sections `detectCardGrid` ACCEPTS + cols×rows + cellW. Run against all 8 cached models. **Produce a
  CORRECTED accept/reject table from the real data.** Proceed ONLY IF a genuine ≥2-col, ≥2-row,
  repeating-cell, non-interleaved grid is found. If none exists → DEFER the effort entirely.
- Step 1: wire `buildCardGridSection` WITHOUT icons (`HYBRID_GRID2=1`, `HYBRID_GRID2_ICONS=0`). Build the
  real-grid site to a scratch page, screenshot at 1440, LOOK: grouped width-correct cells, not a centered
  stack. Grade; confirm composite didn't drop, editability held. Revert if worse.
- Step 2: add icons via #4 (depends-on) once cells render.
- Step 3: mobile LOOK at 390px — cells reflow to full-width single column in reading order.
- Step 4: corpus gate (`HYBRID_GRID2=1`) — known-good UNCHANGED (detector must not fire on them), the
  real-grid site improved by eye. Default-OFF.
- Step 5: re-sync skill bundle.

### Gate flag
`HYBRID_GRID2=1` (detector + builder), `HYBRID_GRID2_ICONS` (icon sub-gate). Default-OFF.

### Adversarial issues that MUST be closed (verdict requiredChanges)
- **[not-looking] Re-derive the detector against the actual cached models BEFORE any code** (Step 0). The
  design's claimed grounding is false; produce a corrected ACCEPT/REJECT table from a real dry-run.
- **[blocker] Identify ≥1 ACTUAL clean 2D card grid** (cols≥2, rows≥2, repeating icon?+heading+body,
  non-interleaved) in the 8 cached sites. If none exists, DEFER — do not build a reconstructor with no target.
- **[regression-risk] Principled mockup defense.** linear[12]/[24]/[8]/[30] (mediaFrac=0, multi-x-band,
  scattered) are rejected only by the accidental `>4-col` cap. Replace with a principled gate (cell-shape
  repetition, equal cell heights, true non-overlapping 2D lattice) and LOG that it rejects every linear
  dashboard section. This is the exact "sparse broken native widgets" family reverted this session — the
  defense must not be an accident.
- **[gaming] Icon path bounding** — see #4; do NOT slice adjacent-column text on interleaved sections.
- **[mobile-cost] Drop `_element_custom_width` on cells** (it defeats `max-width:100%` reflow) OR reuse the
  proven `RESPONSIVE_UNPIN_CSS` mechanism. Validate single-column reading-order at 390px by screenshot.
- **[other] Resolve the async/closure incompatibility:** `detectIconBox` needs `shot`/`dpr`/
  `rasterizeSubBlock` (IIFE-scoped); specify exactly where the new functions live and make
  `buildEditableSection`'s sync call sites await-safe without touching non-grid paths.
- **[bloat] Bound tree/custom_css bloat:** dedup/eliminate per-cell `custom_css`; quantify element count added
  per section against build-absolute's discipline (SCOPE line 65).

### Definition of Done
- Step 0 logger proves a real 2D grid exists AND the principled gate rejects every linear dashboard section.
- **LOOK win** on the real-grid site (named after Step 0): cells render grouped + width-correct vs the
  flow-flattened stack.
- **Non-flat grade once #1 lands:** `cgm_mean` rises on the reconstructed section in proportion to the eye.
- Known-good trio unchanged (detector does not fire on them).
- Bounded element/custom_css count; default-OFF until multi-site LOOK.

---

## EFFORT #4 — imagery-region-capture (icons → grid cells)  ⟵ depends on #3 (which has since shipped)

**STATUS (corrected 2026-06-09): BUILT as a GATED prototype, default-OFF.** Shipped in commit `9681e2f`
(icon capture into grid cells). Gate is `HYBRID_ICONS === '1'` at `build-hybrid.mjs:350` (in-page collector
at `:311`) — NOT promoted to default-on; the LOOK/grader promotion steps below remain outstanding.

**Original verdict: needs-fixes (confidence 0.78). The ink-gate + cap are SOUND; the classification flip + flow-
fallback + reasoning errors MUST be fixed.**

### Verified approach
Capture content graphics that are NOT `<img>` — primarily inline `<svg>` icons (Stripe has 88 uncaptured),
icon-font `<i>` glyphs — so reconstructed cells render with their icon instead of empty whitespace. A
SELECTIVE, CAPPED icon-leaf collector emits `{kind:'image', rasterSlice:true, iconBox:true, box}` leaves
(reusing the proven `rasterSlice` path), and a PADDED + INK-GATED slicer so a thin SVG-on-white doesn't render
faint (faint → `return null` → clean gap, never a smudge — anti-gaming). Icons land at the TOP of their
reconstructed grid CELL (depends-on #3). Capped at 24/page.

### Concrete code-slot
- `build-hybrid.mjs` CAPTURE: in `page.evaluate` (after the `<pre>` loop, line 202), gated icon collector over
  `document.querySelectorAll('svg, i[class*="icon"]')`, filtered to small square-ish boxes (16-72px, aspect
  0.5-2.0), visible, NOT in nav/header/footer/`a`, NOT overlapping a captured text leaf >50%. **Pass `ICONS`
  into the `evaluate` closure args (line 177 currently passes only `W`)** — else the in-page branch is always
  false.
- SLICE: node-side `rasterizeIcon(box, secI)` sibling to `rasterizeSubBlock` (line 266): pad ICON_PAD=8px,
  ink-gate (`inkFrac<0.012 → null`), reuse crop+downscale+uploadPng tail.
- MATERIALIZE: **write the `iconBox → rasterizeIcon` branch** at the materialize loop (line 282); enforce
  ICON_CAP=24 (sorted by area) before materialize.
- `leafToWidget` (line 39) already emits an image for any leaf with `.url` → no change.

### Small, LOOK-validatable steps
- Step 0: baseline LOOK — stripe/clerk cards render EMPTY (save before-shots).
- Step 1: capture-only `--dry` — confirm a BOUNDED count (~10-24, NOT 88+) of iconBox leaves, none in
  nav/footer.
- Step 2: slicer + ink-gate (real build, with #3 grid on) — icons SHARP, at cell top, faint ones dropped to
  clean gaps.
- Step 3: LOOK A/B on clerk vs the empty-card before-shot.
- Step 4: grader regression guard — grade stripe/clerk + known-good trio WITH/WITHOUT icons. **SCREENSHOT
  (not just grade) the known-good trio** to confirm no smudges/mis-grabs (lesson #1). Expect stripe/clerk
  visual FLAT pre-#1; once #1 lands, `cgm_mean` should rise.
- Step 5: promote default only after LOOK wins + known-good flat.

### Gate flag
`HYBRID_ICONS=1`. Default-OFF.

### Adversarial issues that MUST be closed (verdict requiredChanges)
- **[regression-risk] Do NOT add icon area to `mediaArea`.** That's exactly what flips a near-0.5-mediaFrac
  section editable→raster (classify, line 136), destroying its editable text — the text-dominance/
  classification-flip regression family (lesson #3). Icons must be INERT w.r.t. `classify()`.
- **[dependency/regression-risk] Gate the whole feature on grid being present for the section.** Only emit
  icon leaves into a section `buildCardGridSection` reconstructs (cells exist). SUPPRESS icons in
  flow-fallback sections — otherwise 24 free-floating images scatter into a flattened stack (the diagnosed
  "scattered sparse" failure). This makes `dependsOn:#3` a HARD precondition, not an "incremental partial win."
- **[not-looking] SCREENSHOT the known-good trio with icons on** (not just grade) — the svg filter fires on
  their UI icons too.
- **[gaming] Fix the reasoning:** icons DO move `c.wImage → nativeRatio` (diagnostic, not composite) — the
  design's "only band-SSIM can move" claim is false. Keep the ink-gate as the REAL garbage guard; re-justify
  safety on the actual grader.
- **[other] Fix the three impl gaps:** pass `ICONS` into `evaluate` args; write the `iconBox→rasterizeIcon`
  materialize branch; run `overlapsText` against the FULLY-collected section text leaves (scan icons AFTER the
  leafEls loop, or filter against the finished `leaves` array).
- **Keep ink-gate (`inkFrac<0.012→null`) + ICON_CAP=24 exactly** — the strongest parts.

### Definition of Done
- **LOOK win** on stripe.com (named known-hard): cards that looked empty now show their icon at cell-top,
  SHARP, faint ones dropped to clean gaps. Same on clerk.
- Icons INERT to classify (no editable→raster flip); known-good trio LOOK-unchanged.
- **Non-flat grade once #1 lands:** `cgm_mean` rises on icon-populated cells.
- Bounded (≤24 icons/page); default-OFF until LOOK wins.

---

## EFFORT #5 — width-preserving-flow  ⟵ BLOCKED on a contradiction in its own evidence

**Verdict: needs-fixes (confidence 0.78). The central premise (%-width survives .e-con) is CONTRADICTED by the
cited file. Run a scratch experiment FIRST or pivot.**

### Why it's blocked (verified)
- The design's reconciling claim is "PERCENT `_element_custom_width` survives `.e-con` (px is overridden)."
  But `build-flextree.mjs:241-243` — the file the design CITES — states ALL of `_element_custom_width /
  _flex_size / content_width / _flex_basis` are overridden to `width:100%` by `.e-con` on CONTAINER children,
  with NO px-vs-% distinction. If true, the primitive is INERT and the effort is a no-op that adds a wrapper
  container per item for nothing.
- "ALREADY-PROVEN" is false provenance: `stampRowFlex` shipped only in the RETIRED `build-flow.mjs` (clone.mjs
  routes only absolute|hybrid|raster, never flow), whose own header reports composite 0.604 / hRatio 1.909
  (~2× height overflow) and flags an earlier 0.715 as "cherry-picked."
- Wrapping each leaf in its own column container is structurally the cycle-2 column-aware emitter that
  OVERFLOWED band heights (hRatio 1.86, 0.595→0.477, reverted, see `build-hybrid.mjs:46-49`).
- **Code reality check (verified):** `build-hybrid.mjs:92-95` already puts the multi-item row's widgets
  DIRECTLY in one flex container (`flex_wrap:wrap`) — adding a per-item wrapper layer is strictly MORE nesting
  for a possibly-inert change.

### Verified approach (only if the scratch experiment proves %-width survives)
In `buildEditableSection`'s multi-item-row branch (lines 92-95), preserve each item's captured `box.w` so
wrapping happens at the source's wrap-points (rows keep source heights → less vertical drift). Tablet/mobile
forced to 100% so mobile still stacks (protects the responsive term).

### Concrete code-slot
- `build-hybrid.mjs`: a `stampRowFlex`-style helper near `dim` (~line 35), applied ONLY to the multi-item row
  branch (lines 92-95), gated `HYBRID_WIDTHFLOW=1`. Recompute order via a single `built[]` array (don't call
  `leafToWidget` twice with divergent null-filtering).

### Small, LOOK-validatable steps
- **Step -1 (MANDATORY GATE): scratch experiment.** Before any emitter code: stamp %-basis
  `_element_custom_width` on a wrapped container child inside build-hybrid's ACTUAL root nesting, render live
  at 1440, and confirm by EYE + DevTools computed width that `.e-con` does NOT override it to 100%. If it does
  (as build-flextree:241-243 says) → the effort is DEAD; abandon or pivot to native `container_type:'grid'`
  (the only mechanism build-flow found that beat the wall — grid doesn't depend on flex-child width).
- Step 0: baseline LOOK on a TEXT-run side-by-side site whose content IS captured (NOT clerk — its rows are
  empty because icons are uncaptured `<svg>`, so width-flow can't restore them; lesson #6).
- Step 1: port helper (no call sites); confirm flag-off DRY tree byte-identical (diff).
- Step 2: wire gated branch; flag-off DRY identical again.
- Step 3: flag-on rebuild against the SAME `--cache`; screenshot; rows side-by-side at source x, heights match.
  Revert if overflow/squish/mobile horizontal scroll.
- Step 4: mobile LOOK at 390px — rows STACK.
- Step 5: grade flag-off vs flag-on; visual flat-or-up, responsive NOT down.
- Step 6: corpus guard — **FAIL the experiment if hRatio RISES on ANY known-good site** (height overflow is
  the documented failure signature; composite can mask it).
- Step 7: decide on default only on a clear LOOK win + no known-good regression.

### Gate flag
`HYBRID_WIDTHFLOW=1`. Default-OFF.

### Adversarial issues that MUST be closed (verdict requiredChanges)
- **[dependency] Resolve the .e-con contradiction first** (Step -1 scratch experiment). Do not ship an inert
  wrapper.
- **[gaming] Stop calling stampRowFlex "proven"** — it shipped only in retired build-flow (0.604/hRatio
  1.909). Re-baseline its actual hRatio effect in build-hybrid before adopting.
- **[regression-risk] If %-width is overridden, PIVOT to native `container_type:'grid'`** (the only mechanism
  that beat the wall) — do NOT wrap-in-flex-container.
- **[regression-risk] Add an explicit hRatio guard** to Step 6: fail on any known-good hRatio rise, not just
  composite drop.
- **[not-looking] Pick a LOOK target where the mechanism is testable** (captured text-run side-by-side rows),
  NOT clerk.
- **[bloat] Bound wrapper creation** (skip when row has >N items or sparse text) so footers/navs don't double
  node count.

### Definition of Done
- Step -1 PROVES %-width survives (else effort abandoned/pivoted to grid).
- **LOOK win** on a captured-text side-by-side site: rows restore horizontal structure, heights match, mobile
  stacks.
- hRatio does NOT rise on any known-good site (Step 6).
- **Non-flat grade once #1 lands** OR honest documentation that the win is LOOK-only and the grade is flat.
- Default-OFF until LOOK win + no known-good regression.

---

## EFFORT #6 — strategy-router  ⟵ LAST. Depends on #1, #3, #5 + a NEW per-section grading primitive

**Verdict: needs-fixes (confidence 0.82). The most adversarial issues of any effort. Sequence it LAST and only
after its dependencies are LOOK-proven.**

### Verified approach
Consolidate build-hybrid's two scattered routing decisions (`classify()` at line 127-138 → editable|raster;
then the abs branch at lines 297-302) into ONE pure `chooseStrategy(sec, opts)` returning a named strategy
over {raster | grid | widthflow | flow | abs}, driven by a static cost model. Default path stays byte-
identical (`HYBRID_ROUTER` unset → today's classify+abs branch verbatim).

### Concrete code-slot
- New file `eval/grader/strategy-router.mjs` exporting `chooseStrategy(sec, {W})`. build-hybrid imports it; the
  per-section loop (lines 277-323) dispatches on strategy ONLY when `HYBRID_ROUTER` is set. `classify()` stays
  the default path.
- `detectGrid` must be EXPORTED / passed `W` explicitly (it currently closes over module-level `W`, line 54).

### Small, LOOK-validatable steps
- Step 0: extract/`chooseStrategy` + a print-only harness over the 7-site cached corpus (`--cache model.json`,
  NO build, NO PUT). LOOK at printed routes vs known archetypes. Validate the model before it changes a pixel.
- Step 1: `HYBRID_ROUTER=static`, dispatch to EXISTING emitters only. Build supabase (known-good); require
  composite within noise AND LOOK identical-or-better. Fix the model if supabase moves down.
- Step 2: `static` on stripe — the make-or-break LOOK on the card grids (only the eye decides; band-SSIM is
  blind pre-#1).
- Steps 3-4: measure mode + corpus gate — ONLY IF the per-section grading primitive exists (see blocker).

### Gate flag
`HYBRID_ROUTER` = `static` | `measure` | unset(=legacy). Default unset → byte-identical.

### Adversarial issues that MUST be closed (verdict requiredChanges)
- **[unmeasurable/BLOCKER] There is NO per-section grading primitive.** `grade-sections.mjs` takes
  `--source <url> --clone <url>`, screenshots BOTH LIVE URLs full-page, and slices the SOURCE's y-bands — it
  does NOT grade a section tree in isolation; `sectionVisual(editEl, sec)` does not exist. "Measure mode" as
  designed cannot run. **Required:** EITHER build + self-test a real `sectionVisual(tree, sec)` that
  PUTs+renders+captures and proves it equals the page grader's `perSection[idx].visual`, OR drop measure mode
  and keep only `static` mode behind the flag with MANDATORY human LOOK per section.
- **[gaming] The "raster floor" compares a WEAKER metric than the composite.** `perSection[].visual` is only
  per-band `0.5*ssim+0.5*exact` — it excludes perElement, responsive (0.25), and the detectors the page
  composite uses. A reconstruction can tie/beat the band-visual yet REGRESS the composite (e.g. abs is
  desktop-only → responsive drops). **Required:** retain a reconstruction only if it doesn't regress the FULL
  `grade-structure` composite at the PAGE level.
- **[regression-risk] Do NOT make abs/widthflow router-eligible** until each is independently LOOK-proven
  non-regressive. abs (multi-col) is the reverted P1 drift (0.583); per-leaf px-width flow is the reverted
  cycle-2 hRatio-1.86 emitter. The router must not silently re-enable them via cost ordering.
- **[gaming] Eliminate the editability tie-break on a band-SSIM TIE.** On dense/dark sections band-SSIM is
  background-dominated, so a tie is NOT evidence of fidelity — it's the shredded-content gaming vector.
  Require a positive, human-confirmed visual win (not a tie) to keep a reconstruction over raster.
- **[regression-risk] Preserve legacy nav/footer/canvas routing** explicitly inside `chooseStrategy`
  (`isNav`, `isFooter`, `bigCanvas`, footer `textLeaves<=80`) — the sketch DROPS them and would regress the
  two section types classify() most reliably reconstructs.
- **[regression-risk] Fix detectGrid's `W` dependency** on extraction (pass W explicitly, update signature);
  verify byte-identical default-off via a DIFF test, not prose.
- **[mobile-cost] The flat 0.05 abs "mobile cost" cannot represent a 0.25-weighted responsive regression** —
  model it from the responsive term, not a constant, or keep abs out.
- **[bloat] Budget element count + uploads** (measure mode PUTs throwaway pages; grid fires more often as the
  cheapest reconstruction). Specify a budget.
- **[dependency] Sequence AFTER #1, #3 (WITH icon capture #4), #5 actually land and are LOOK-proven.** Routing
  to grid is empty until #3+#4 capture Stripe's `<svg>` icons (else cells render empty and lose the floor).

### Definition of Done
- A per-section grading primitive is BUILT + self-tested to equal `perSection[].visual` (or measure mode is
  dropped for static+LOOK).
- Default-off byte-identical (DIFF-proven).
- **LOOK win** on stripe.com: dense card grids route to `grid` and render columns+content+icons where today
  there is whitespace; supabase (known-good) LOOK identical-or-better.
- **Non-flat grade once #1 lands:** routed reconstructions raise `cgm_mean` / composite in the direction the
  LOOK supports, with no known-good regression on the FULL composite (all four terms).
- abs/widthflow router-eligible ONLY after each is independently proven.

---

## 3. QUICK-REFERENCE: gate flags & files

| Effort | File(s) | Gate flag | Default (corrected 2026-06-09) |
|--------|---------|-----------|---------|
| #1 grader-visual-fix | grade-structure.mjs | `GRADER_CGM=1` (blend); `cgm_mean` always reported | OFF (report-only) |
| #2 section-bg | build-hybrid.mjs | `HYBRID_SECTION_BG === '1'` (build-hybrid.mjs:43) | OFF — built, never promoted |
| #3 grid-recon | build-hybrid.mjs | `HYBRID_GRID !== '0'` (NOT `HYBRID_GRID2`; build-hybrid.mjs:144) | **ON** since `ab8f7ab` (2026-06-08) |
| #4 imagery | build-hybrid.mjs | `HYBRID_ICONS === '1'` (build-hybrid.mjs:350) | OFF — built (`9681e2f`), not promoted |
| #5 width-flow | build-hybrid.mjs | `HYBRID_WIDTHFLOW` | OFF (not built) |
| #6 router | strategy-router.mjs (new), build-hybrid.mjs | `HYBRID_ROUTER=static|measure` | unset (not built) |

## 4. THE ONE-LINE EXECUTION RULE

Land #1 (report-only → LOOK-gated blend) and #2 (verbatim-gradient, measurable) first. Prove a real grid
exists (#3 Step 0) before building it; prove %-width survives `.e-con` (#5 Step -1) before building it. Icons
(#4) only ship into real cells. The router (#6) is last and needs a per-section grading primitive that does
not yet exist. Every step: GATE it, LOOK at it, REVERT on any known-good regression. The eye is the verdict;
the grade is the guard-rail.
