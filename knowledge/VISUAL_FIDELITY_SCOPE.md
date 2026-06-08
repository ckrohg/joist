# Visual Fidelity of Editable Sections — Project Scope

@purpose Scope the breadth-validated #1 remaining lever: VISUAL fidelity of FLOW editable sections (2026-06-07).
Distinct from knowledge/EDITABLE_LAYOUT_ENGINE_SCOPE.md (the abs PORT, already built + auto-enabled for
overlapping/layered sections). This is about the sections that DON'T overlap and so stay on flex-flow, which
flattens their multi-column structure.

## Why (breadth-validated, not overfit)

On the 7-site deterministic corpus (mean 0.867), VISUAL is the #1 lever: **0.159 mean-gap across 4/7 sites**
(tailwind, framer, reactdev, linear — all `visual-loss(font/layout)` tagged). It is broad, not a tuned-site
artifact (the generalization run confirmed it on 3 unseen sites). editability is solved (0/7 severe).

## Root cause (grounded)

The remaining loss is FLOW editable sections that are structured (multi-column / wide) but NON-overlapping, so
auto-abs (overlap-gated `needsAbsLayout`) doesn't catch them and `buildEditableSection` flattens them into a
centered single column → whitespace / wrong positions → SSIM loss. Evidence:
- tailwind section [8] (3872px, multi-column cards) DOES overlap (overlapPairs=13) → already abs → fine.
- tailwind section [10] (738px, 68 text leaves, overlapPairs=0) → stays FLOW → flattened.
- **force-abs WHOLE-PAGE tailwind: visual 0.791 vs auto-abs 0.738** — the 0.053 delta is precisely the
  non-overlapping flow sections that abs would position correctly. So abs already KNOWS how to fix them; the
  gate just doesn't route them there.

## The core tension (decides the whole effort)

abs is DESKTOP-PIXEL (mobile = rough un-pinned stack). The objective's responsive term is **mobile-fit only**
(no-horizontal-overflow) — it does NOT grade mobile LAYOUT QUALITY. So broadening abs would raise visual AND
keep responsive≈1.0 (overflow guarded) while SILENTLY degrading mobile layout quality. We cannot honestly
broaden abs until we can MEASURE its mobile-quality cost. (RLG/grade-responsive.mjs is the natural measure but
bottoms out ~0.045 on raster-heavy hybrids — established 2026-06-07.) **This sequencing is the crux.**

## Phased plan

- **P0 — Mobile-layout-quality grader (PREREQUISITE).** Build a cheap signal that grades mobile LAYOUT (not just
  overflow): e.g. capture clone+source at 390px, compare reading-order / vertical-band SSIM / element-stack
  agreement (a light RLG variant that tolerates raster — match by text+area, score relative vertical order +
  no-overlap). Fold into the responsive term (replace or augment mobile-fit) so abs's mobile cost is VISIBLE.
  WITHOUT P0 the rest optimizes a blind metric.
- **P1 — Broaden the abs trigger to multi-column (proven path).** Extend `needsAbsLayout` to detect MULTI-COLUMN
  structure (leaves cluster into ≥2 distinct x-bands sharing y-rows), not only overlap. Route those flow
  sections to the EXISTING `buildAbsEditableSection`. Measure visual↑ vs P0 mobile-quality↓ on the corpus; keep
  per-archetype only where net-positive. Expected to capture most of the 0.053 (tailwind) + similar elsewhere.
- **P2 — Width-preserving FLOW (responsive-keeping alternative).** For sections we DON'T route to abs (keep
  responsive), set each text widget width = captured box.w so wrapping matches source (line counts → row
  heights → positions track). NOTE: a prior per-row min_height attempt REGRESSED (0.772→0.749) by amplifying
  wrap drift — width-preservation addresses the root (wrapping) instead; try in isolation, measure.
- **P3 — Per-section router.** Given P0's mobile-quality signal + visual, choose per section: raster (pixel,
  no edit) | flow (responsive, approximate) | abs (desktop-pixel, accurate). A small cost model picks the mode
  that maximizes the objective per section. This generalizes the current binary classify().

## Risks
- **Optimizing a blind metric** if P1 ships before P0 (the central risk — abs looks better while mobile silently
  degrades). P0 gates everything.
- abs over-spread erodes the "responsive default" the user values; the cost model (P3) + P0 keep it honest.
- Width-preservation (P2) can over-constrain text → clipping; needs min/auto fallbacks.
- custom_css bloat as more sections go abs (build-absolute's bounded-rule discipline applies).

## Decisions needed
1. **Sequencing**: build P0 (mobile-quality grader) FIRST (recommended — else we optimize blind), or accept
   mobile-fit-only and broaden abs now (faster, but the headline overstates abs)?
2. **Responsive priority**: how much mobile-layout quality are we willing to trade for desktop visual? (sets the
   P0 weight + the P3 cost model). The user has signaled responsive matters.
3. **abs breadth**: cap abs at a fraction of sections (keep flow majority) or let the cost model decide freely?

## Effort
Medium-large. P0 is the gating prerequisite (a new grader signal — moderate). P1 is small (trigger + reuse
existing abs builder). P2 medium. P3 medium. Expected payoff: visual lever (0.159, 4/7) substantially closed,
honestly bounded by a real mobile-quality measure. Recommendation: **P0 → P1 → measure → P2/P3 as warranted.**
