# Per-Breakpoint Capture — Scope

@purpose Architecture + staged plan to break the absolute builder's responsive ceiling (measured 0.2547,
[[../../knowledge/abs_responsive_ceiling]] / Track C) by capturing the source at multiple breakpoints and
authoring per-breakpoint Elementor output — while keeping desktop 1:1 + round-trip editability. Scoped
2026-06-07. Corroborated independently by the "AI Website Cloner" Claude-Code skill ("resize through every
breakpoint") — per-breakpoint capture is the validated lever, not more abs-builder detector tuning.

## The problem (measured, honest)

- Absolute build is **desktop-pixel-pinned**: it captures the source at 1440 and pins every widget's
  desktop (x,y,w,h). Desktop is a flawless 1:1 (composite 0.911, hRatio 1.0).
- The responsive tax is **vertical height blowup** (@390 the clone is 2.43× too tall) because the blanket
  `@media(max-width:1024px)` un-pin stacks everything 1-per-row at *desktop vertical rhythm*. The source
  *reflows* (2-col→1-col, reorders, hides) at mobile; the clone can't, because it only ever saw 1440.
- Track C tried to *infer* reflow from the desktop capture (2-col-split detector) → inert (the source's
  columns nest deeper than direct children). **You can't infer the mobile layout from the desktop DOM —
  you have to capture it.**

## Grounding facts (verified this session)

1. `capture-layout.mjs` captures ONE viewport (`--width`, default 1440). No multi-width, no stable
   cross-breakpoint element identity. (`rectOf` → box; DOM-walk `root` tree.)
2. `grade-responsive.mjs` is **relationship-based** (ReDeCheck RLG): `0.6·edgeSetAgreement +
   0.4·meanPerWidthLayout`, matching elements by identity. It rewards reproducing the source's pairwise
   element **alignments** (L/R/T/B/Cx/Cy, range-overlap weighted) at each width — NOT pixels. So a clone
   that puts the same elements in the same *relative relationships* at each width scores, even if not
   pixel-exact.
3. **kses channel constraint** (Track C): Elementor per-breakpoint OFFSET keys (`_offset_x_tablet`,
   `_element_custom_width_mobile`, …) are **stripped** by the REST/kses save path. The page-level
   **`custom_css @media` channel SURVIVES** and is proven to reflow an abs element at ≤1024. So
   per-breakpoint *position* must ride `custom_css @media`, not native offset keys. Native responsive
   keys that DO survive + work: `grid_columns_grid_tablet/_mobile`, `typography_*_tablet/_mobile`,
   `hidden_tablet`/`hidden_mobile` (responsive visibility), padding/margin `_tablet/_mobile`.

## Architecture (recommended: per-breakpoint custom_css position override)

Direction I — keep the abs desktop 1:1, ADD captured tablet/mobile positions via the proven kses-safe
channel. Three steps:

1. **Capture at N breakpoints** (390 / 768 / 1440) → 3 layout passes.
2. **Reconcile by element identity** — match each source element across the 3 captures via a *stable
   selector* (deterministic DOM path, or a hash of tag+depth+text). Output a unified element list where
   each element carries `{box_1440, box_768, box_390, visible@each}`.
3. **Build ONE Elementor tree**: desktop abs-pin (as today) + per-element `custom_css @media`:
   - `@media(max-width:1024px){#eid{...captured tablet box...}}` and
     `@media(max-width:767px){#eid{...captured mobile box...}}` (position/size/relative un-pin),
   - `display:none` (or `hidden_mobile`) for elements present at desktop but absent at that breakpoint,
   - reordering falls out for free (positions encode it); responsive font/spacing already partly done
     (fluid fonts). Emit overrides ONLY for elements whose box materially changes (most don't) to bound
     custom_css volume.

Why this is the right altitude (not a bandaid): it reuses the ONE channel that survives kses to express
exactly what Elementor's native offset keys can't, and it reproduces the *relationships* the RLG grader
rewards at each graded width. Desktop (>1024) is byte-identical (all overrides scoped to ≤1024).

Direction II — per-breakpoint-informed NATIVE reflow (use the mobile capture to drive native flex/grid +
responsive settings instead of abs-pinning each breakpoint). Fluid (not discrete), "more proper", but
much harder (structure inference from positions). **Defer**: evolve toward II for bands where I is janky,
once I proves the lift.

## Staged plan (inch-by-inch; each stage independently gradeable)

- **Stage 0 — Prove the channel on ONE band — ✅ DONE, GO (2026-06-07).** Captured supabase @1440 + @390,
  matched the hero's 5 text leaves 5/5, built it two ways and graded @390: the captured-390
  `@media(max-width:767px){#eid{position:absolute;left/top/width}}` per-leaf override **survived the
  PUT/kses verbatim** and rendered at the **exact** source@390 boxes (Δleft=Δtop=Δw=0, **anchor-IoU 1.000**),
  **recovering the side-by-side CTA pair** the status-quo blanket un-pin destroys (status-quo anchor-IoU
  **0.106**, stacks the CTAs; Δleft 60.6px / Δtop 106.4px). **+0.894** vs status-quo; **desktop @1440
  byte-identical** (override scoped ≤767). LOOKED: confirmed visually (`pbc-{source,statusquo,perbp}-390.png`).
  CAVEAT seen: position alone isn't visual-1:1 — the probe hardcoded 48px font so headings overflowed their
  captured ~40px boxes. ⇒ **per-breakpoint typography is a REQUIRED channel alongside position.**
- **Stage 1 — Multi-breakpoint capture + identity + per-bp typography (days).** Add
  `capture-layout --widths 390,768,1440`; capture each element with a STABLE identity AND its
  per-breakpoint font-size/line-height (the captured box height implies it — Stage 0 proved position-only
  isn't enough); emit a per-element multi-box + multi-type model. **The make-or-break is cross-breakpoint
  element IDENTITY** (Stage 0's hero matched 5/5 only because it's text-stable; real bands have images,
  reordering, breakpoint-specific show/hide). Mitigate with a deterministic selector + position-nearest
  fallback; validate on image/composite leaves, not just text.
- **Stage 2 — Reconcile + full per-breakpoint emit (days).** Match across breakpoints; in `build-absolute`
  emit per-element `@media` position + visibility overrides page-wide. Handle: present-at-desktop /
  absent-at-mobile (visibility), restructured chrome (desktop nav ↔ mobile hamburger = DIFFERENT DOM →
  emit both, toggle by breakpoint), and custom_css volume (skip unchanged boxes; minify).
- **Stage 3 — Grade + iterate (ongoing).** grade-responsive at 390/768/1024/1440; prove the lift vs 0.2547
  with desktop byte-identical (composite stays ~0.911, hRatio ~1.0).

## Honest caveats / acceptance

- **Discrete, not fluid.** Pinning 3 captured widths scores at the GRADED widths (the grader samples
  discrete widths) but is janky between (e.g. 500px). A real improvement for the grader + most users; not
  true fluid responsiveness. Note it; don't oversell.
- **Restructured chrome is the hard tail.** Where the source's mobile DOM ≠ desktop DOM (hamburger,
  collapsed menus), identity matching fails by design → handle as breakpoint-specific dual-emit. This is
  where the last fidelity points live.
- **Target, honestly:** a SUBSTANTIAL lift (0.25 → plausibly 0.5–0.7 once Stage 2 lands), not 1.0 — the RLG
  is strict and some restructuring is unreproducible in editable Elementor. Re-grade decides; if Stage 0
  shows the channel reproduces source@390 relationships cleanly, the arc is worth funding.
- **Desktop is sacred:** every override scoped ≤1024; >1024 untouched. Regression gate on every stage:
  desktop composite must hold ~0.911.

## Adjacent (not in this scope, but composes)

- **Chrome-MCP real-browser capture** — the cloner skill uses a real browser, which cracks the
  dynamic/auth-walled capture gap (Framer/Stripe) our headless Playwright hits ([[../../knowledge/CLONE_PIPELINE]]
  notes Stripe as the headless outlier). Per-breakpoint capture composes with it (capture N widths in the
  real browser). Sequence: prove per-breakpoint on a headless-renderable source (supabase) FIRST, then add
  Chrome-MCP capture for the dynamic tail.
- **Interaction/hover capture** — the cloner also captures hover/click states; feeds
  [[../../knowledge/interaction_fidelity_requirement]]. Separate lever.

## Status / next move

**Stage 0 is done and it's a GO** (anchor-IoU 1.000 vs status-quo 0.106; +0.894; CTA pairing recovered;
kses-safe; desktop byte-identical; LOOK-confirmed). The load-bearing unknown — "do captured-390 positions,
pinned via `@media custom_css`, reproduce the source mobile geometry?" — cleared cleanly. **Fund Stage 1.**

Stage 1's two required channels (per Stage 0): (a) **cross-breakpoint element IDENTITY** — the make-or-break
(match the same leaf across 390/768/1440 so each carries three coordinate sets; the hero matched 5/5 only
because it was text-stable — images/reorder/show-hide are the hard part); (b) **per-breakpoint typography**
(font-size/line-height per width) alongside position, or text overflows its captured box (seen in Stage 0).
Direction II (native reflow) is NOT needed for the geometry — Stage 0 proved the override channel; it remains
the fallback only for bands where restructured chrome makes identity matching impossible.
