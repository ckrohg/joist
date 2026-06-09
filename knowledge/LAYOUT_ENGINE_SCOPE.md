# Layout Engine — Project Scope (faithful complex-section reconstruction)

@purpose Scope the one genuine remaining hard lever: reconstruct COMPLEX sections faithfully so they look right
AND stay editable. Grounded in concrete failure diagnosis (Stripe/clerk/tailwind) + everything tried this
session. Supersedes/absorbs VISUAL_FIDELITY_SCOPE.md and EDITABLE_LAYOUT_ENGINE_SCOPE.md. (2026-06-08)

## The problem, diagnosed concretely (not hand-waved)

On the un-gameable grader, complex sites reconstruct at visual ~0.5–0.6 (Stripe 0.49, clerk 0.56) vs ~0.8–0.9
on simple ones (supabase 0.84, notion 0.82, cal.com 0.80). LOOKED at the Stripe clone vs source:

- **What RASTERS well (keep):** gradient heroes, illustration bands, dashboard mockups, big media → captured as
  one image, pixel-faithful. Not the problem.
- **What FAILS (the target):** dense MULTI-COLUMN feature/card grids. Source = a grid of cards, each `icon +
  heading + body`. Clone = `buildEditableSection` flow-flattens it into scattered sparse text — losing the grid
  columns, the per-card grouping, the icons, and the spacing. Whitespace where structure should be → low SSIM.
- Secondary losses: decorative ICONS (SVG/background, not captured as widgets → cards look empty); subtle section
  BACKGROUND tints (clone mostly white).

So the lever is precise: **faithfully reconstruct dense multi-column card/feature grids** (structure + per-cell
content + widths + spacing + icons), while keeping them editable. The good cases work because their grids are
simpler; the bad cases have denser/more-precise grids flow can't represent.

## What's been tried this session (and why each is insufficient ALONE)

- **Flow** (`buildEditableSection`, default): rows by y-overlap, no width/position preservation → flattens
  multi-column to a centered stack. WORKS for simple/stacked; FAILS for dense grids (the failure above).
- **Abs (x,y,w,h pin)** (`abs-positioning.mjs`, build-absolute): preserves positions 1:1. But desktop-pixel
  (rough mobile un-pin), and P1 broadening it to multi-col REGRESSED (corpus 0.807<0.836, tailwind drift 0.583 —
  abs sections stacked too tall). Now render-stable (hardened to per-element custom_css). Good for genuinely
  LAYERED sections, not a general grid answer (drift + mobile cost).
- **Sub-section raster** (Wave B): rasterize a non-reconstructable sub-block (code/illustration) in place, keep
  surrounding text editable. WORKS + LOOK-validated. The escape hatch for un-reconstructable cells.
- **Width-preserving flow:** set each widget's width = captured box.w so wrapping (and row heights) match source.
  NOT yet tried in isolation (an earlier per-row min_height attempt addressed the wrong thing and regressed).

## Proposed architecture: per-section reconstruction strategy

A small router that picks a strategy per section (the grader + LOOK gate every change):

- **P1 — Grid reconstruction (the core new capability).** Detect a card-grid (≥2 columns of repeated
  `icon?/heading/body` cells, non-overlapping). Build a REAL responsive grid: outer flex-wrap/grid container with
  the captured column count + gap; each cell a sub-container with width=captured cell width, holding the cell's
  heading/text widgets + the icon (captured as a small image — sub-section raster of the icon's bbox). Preserves
  structure + widths + icons + spacing, stays editable, reflows on mobile. This directly fixes the diagnosed
  failure. Reuses Wave B's sub-block slicer for icons.
- **P2 — Width-preserving flow** for non-grid multi-element rows (set widget width=box.w so wrapping matches).
- **P3 — Section background capture** — subtle section tints/gradients → container background (extends the
  existing pageBg/section-bg capture).
- **P4 — Strategy router** — per section: raster (big media) | grid (P1) | flow/width-preserve (P2) | abs (layered,
  rare) | sub-section-raster cells (Wave B). A small cost model + the trustworthy grader pick; LOOK-validate.

## Methodology (hard-won this session — non-negotiable)

- **LOOK at every change** (screenshot source vs clone) — the grader is trustworthy but a human confirms. The
  whole grader-gaming detour came from not looking.
- **Small, reverted-on-regression steps** — every prior broad change (P1 abs, text-dominance) regressed; gate each
  on the corpus AND the eye.
- **The grader can't see everything** — band-SSIM under-credits faithful-but-misaligned content (Wave B reactdev
  was flat despite a clear visual win). Trust the LOOK when it and the grader diverge in the LOOK's favor.

## Risks
- Grid DETECTION false-positives/negatives → wrong strategy → regression. Mitigate: conservative detection + router
  fallback to flow + per-section LOOK.
- custom_css / widget bloat as cells get sub-containers + icon images. Bound it (build-absolute's discipline).
- Abs's mobile/drift cost if the router over-uses it — keep abs rare (layered only).
- Re-sync the skill bundle (`plugin/skills/joist-clone/pipeline/`) after pipeline changes — it's a snapshot.

## Decisions needed before building
1. **Start point:** P1 grid reconstruction (highest-leverage, directly fixes the diagnosed failure) — recommended —
   vs P2 width-preserving flow (cheaper, smaller win)?
2. **Editable vs faithful on cells the engine can't reconstruct:** sub-section raster the cell (faithful, not
   editable) or leave editable-but-rough? (Recommend: raster the cell — Wave B showed it looks right.)
3. **Scope of the router (P4):** build it now, or land P1+P2 as direct improvements first and add routing later?

## Effort
Large — a dedicated multi-session effort. P1 (grid reconstruction) is the core and itself substantial (detection +
cell sub-containers + icon slicing + responsive grid emit + LOOK-validation across the corpus). P2–P4 follow.
Expected payoff: the complex-site ceiling (~0.5 visual) lifts toward the simple-site level (~0.85) — the biggest
remaining fidelity lever, now measurable on an un-gameable grader. Recommendation: **P1 first, LOOK-first, one
section archetype at a time.**
