# Editable-Layout Engine — Project Scope

@purpose Scope for fixing the last significant clone-quality lever — VISUAL fidelity of reconstructed
editable sections — by giving build-hybrid's editable sections true (x,y,w,h) positioning instead of
naive flex-flow. Grounded in build-absolute.mjs's existing pinning machinery (2026-06-06).

## Why (the lever)

On the deterministic corpus (mean 0.793), VISUAL is the sole remaining significant lever: **0.181 mean-gap,
2/4 sites** (tailwind visGap 0.271, framer 0.226). Root cause, confirmed by looking at screenshots:
build-hybrid's `buildEditableSection` flattens rich MULTI-COLUMN sections into a single centered flex
column. Proven on tailwind section [8] (3872px, 246 text leaves): the source is a dense card/column grid;
the clone is mostly whitespace → SSIM collapses. A naive vertical-rhythm tweak REGRESSED (per-row min_height
amplified wrap drift, 0.772→0.749) — flex-flow heuristics cannot solve multi-column. This is the documented
"editability QUALITY" gap ([[absolute_positioning_breakthrough]], [[hybrid_clone_and_render_truths]]).

## What already exists (leverage — build-absolute.mjs)

The whole-page build-absolute builder ALREADY solves 1:1 positioning + editability. Reusable primitives:
- **`absPos(box, z, origin)`** (build-absolute.mjs:191) → widget settings `_position:'absolute'` +
  `_offset_x/_offset_y` (relative to `origin` = section/cell top-left) + `_element_custom_width`. WIDGETS
  honor `_position:absolute`; settings are **kses-safe** (proven — 322 abs text widgets round-trip).
- **Container pinning via CSS** (build-absolute.mjs:923): CONTAINERS *ignore* `_position:absolute`, so a
  container is pinned with `#eid{position:absolute;left;top;width;min-height}` injected as scoped custom_css.
- **`page_settings.custom_css` channel**: per-element scoped rules joined into the page PUT (imgCapCss,
  fluidFontCss, cardRowCss…). build-hybrid currently PUTs `page_settings:{}` — must wire this.
- **Responsive un-pin** (build-absolute.mjs:~1393): `@media(max-width:1024px)` rules release `.elementor-absolute`
  to `position:relative;width:100%` so the page stacks/reflows on mobile (rough but not broken).
- **Grid/card-row pattern** (build-absolute.mjs:855-934): pins a grid container at band geometry, with cells,
  leaves abs-positioned within cells — the EXACT multi-column reconstruction the editable sections need.

build-hybrid already captures each leaf's `box{x,y,w,h}` and classifies sections node-side (`classify()`),
so the inputs are in hand.

## The design tension (MUST surface)

**STATUS (corrected 2026-06-09):** two claims in this section rotted.
1. `grade-structure.mjs` NOW MEASURES responsive: composite carries a 0.20-weight responsive term
   (`0.5*mobileFit + 0.5*mobileOrder` at 390px; `grade-structure.mjs` ~line 318-326). The "blind headline"
   risk below is closed — decision #4 was answered YES and shipped.
2. The responsive tension was RESOLVED at a CONFIRMED CEILING ([[abs_responsive_ceiling]]): the absolute
   builder remains **desktop-only**; per-breakpoint matching was built (`per-breakpoint`) and the 2026-06-07
   model fixes (commit `de3af44`: dice+best-pair+fuzzy-absence+clamp) improved it, but it STILL loses to the
   clean 1-col stack (collisions + capture-disagreement + 1-col density). The vertical tax is ~2.9x height
   blowup @390. Do NOT re-do the matcher; next levers are capture-alignment or true reflow.

Original framing (kept for context): build-absolute is **DESKTOP-PIXEL**: pinned at 1440, un-pinned to rough
stacking at ≤1024 — NOT true responsive. build-hybrid's flex-flow is responsive-ish but visually wrong on
complex sections. So abs editable sections **raise visual/composite while lowering responsive quality**.
**Track the responsive term alongside every change** ([[grader_strictness_is_progress]]: a truer grader is
the point; don't optimize a blind headline).

## Phased plan

- **P1 — Shared primitives + CSS channel (foundation).** Factor `absPos`, the custom_css join, and the
  ≤1024 un-pin rule out of build-absolute into a small shared `abs-positioning.mjs` (avoid divergence), OR
  copy minimal. Wire build-hybrid's PUT to send `page_settings.custom_css` (today `{}`).
- **P2 — Abs editable-section builder.** `buildAbsEditableSection(sec)`: section container `position:relative`
  (via CSS) + `min_height = sec.h`; each leaf abs-pinned with `absPos(box, z, {x:0,y:sec.y0})` + width;
  images get pinned width/height; z by DOM order. Drop-in alternative to `buildEditableSection`.
- **P3 — Per-section selection (hybrid flow+abs).** Choose abs vs flow per section: multi-column (leaves form
  ≥2 distinct x-columns at shared y, or high x-spread with row count) → abs; simple single-column → keep flow
  (preserves responsiveness where it's cheap). Tune on the deterministic corpus.
- **P4 — Responsive un-pin.** Port the ≤1024 un-pin so abs sections stack on mobile (rough reflow, not
  broken). DECISION: ship rough-reflow vs desktop-only.
- **P5 — Measure both axes.** Corpus (deterministic) for visual/composite; `grade-responsive.mjs` for the
  responsive cost. Keep per-section only where composite rises without unacceptable responsive loss
  (per-section A/B is now possible because the corpus is deterministic).

## Risks
- **Responsive regression** (the core tradeoff) — invisible to the objective grader; mitigate via P4 + always
  running grade-responsive.
- **custom_css bloat** — per-leaf rules could grow large; build-absolute bounds this (small body text stays
  fixed-px, only large text gets scoped rules) — reuse that discipline.
- **Complexity creep** in the "simple" hybrid builder — mitigate by sharing primitives, not forking logic.
- **Edge cases**: image width/height pinning, overlapping z-order, section-relative origin math.
- kses: abs widget settings + scoped custom_css are proven kses-safe in build-absolute.

## Decisions needed (before building)
1. **Scope**: abs for ALL editable sections, or only complex multi-column (recommended — keep simple sections
   responsive via flow)?
2. **Responsive**: ANSWERED (2026-06-09) — per-breakpoint matching was tried and hit a confirmed ceiling
   ([[abs_responsive_ceiling]]); abs ships desktop-only with the rough ≤1024 un-pin; true reflow is a
   separate future lever.
3. **Reuse**: factor a shared `abs-positioning.mjs` from build-absolute (recommended) or copy primitives?
4. **Objective grader**: ANSWERED YES (2026-06-09) — `grade-structure.mjs` composite now carries a
   0.20-weight responsive term (mobileFit + mobileOrder); the tradeoff is visible in the headline.

## Effort
Medium-large — a dedicated effort, not an inch. P1+P2 are the core (one focused session); P3 tuning + P4
responsive + P5 dual-axis measurement iterate. Expected payoff: visual lever (0.181, 2/4) → largely closed
on desktop, at a responsive cost that P4 bounds and grade-responsive quantifies.
