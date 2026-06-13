# Layout Re-Architecture — DOM-mirrored native flex tree

> Decision (2026-06): the IR/cluster builder caps at "structurally approximate" (vision committee on page 805: unanimous FAIL, S1 text-collision + S2 lost-backgrounds + S3 cards-as-text). Re-architect the layout reconstruction. This is the design.

## Root cause of the ceiling
The current pipeline reconstructs layout by **absolute-positioning individual leaves**:
`capture-fx` → flat leaf list → `build-ir` XY-cut → "clusters" → `build-ir-elementor` places each leaf at a captured `left/top` via injected CSS.

Why that fails structurally:
- **Text collision (S1):** a widget's intrinsic size (text wrap width, font metrics) ≠ the source's, but it's pinned at an absolute coord with no flow → boxes overlap and stack. Illegible.
- **Lost section backgrounds (S2):** the flat model carries band `bg` weakly and drops gradients/dark bands → signature dark sections render white.
- **Cards collapse (S3):** XY-cut flattens the DOM, so a "card" (bg+border+padding+children) becomes loose text leaves with no container.
- **Dead whitespace (S4):** absolute placement + mismatched min-heights + missing media → voids.

The flat-leaf + absolute-position model is the ceiling. It cannot express flow, containers, cards, or responsive behavior.

## The new principle
**Elementor flex containers ARE CSS flexbox.** So mirror the source's **container hierarchy** directly into Elementor's container tree and let **native flow + flex** do the layout — no absolute positioning. This is the production DOM→builder pattern (Builder.io Visual Copilot, Anima). Text flows (no collision); backgrounds live on containers; cards are containers; widths are %/flex so it's responsive.

## New pipeline
1. **`capture-layout.mjs`** — capture the DOM BOX TREE (recursive), not a flat list. Per node:
   - **container:** `{box, display, flexDirection, flexWrap, justify, align, gap, padding, margin, background{color|gradient|image}, border, radius, boxShadow, position, children[]}`
   - **leaf:** text/heading/button (text, typo, painted color, hover, interaction/panel) | image (src, objectFit, box) | svg
   - **Prune (critical):** drop invisible/sr-only/clipped; collapse pass-through wrappers (single child + no bg/border/padding/flex → replace with child); cap depth (~7); coalesce inline text spans into parent.
   - Reuse `capture-fx`'s leaf extraction wholesale: painted-color sampler, hover pass, interaction/panel capture, font harvest, gradient-text.
2. **`build-flextree.mjs`** — map node tree → Elementor container tree:
   - container node → Elementor **flex container** carrying `flex_direction / flex_gap / flex_justify_content / flex_align_items / _padding / background_* (incl gradient) / border / radius`. `content_width` boxed/full by width.
   - CSS `display:grid` → Elementor **grid container** if the schema supports it (introspect `/widgets` or container schema), else `flex_wrap` + item basis.
   - leaf → native widget (heading / text-editor / button / image / html-details), styled by per-node settings + the existing gc-class system.
   - **NO absolute positioning** — EXCEPT nodes with real `position:absolute` in source (badges, overlaps) → a narrow absolute path inside a `position:relative` parent.
   - Widths from source (`%`/`max-width`/`flex-basis`), not fixed px → responsive for free.
   - Reuse asset pipeline: `uploadImage` (sized variants + alt + dedup), fonts, `<details>` disclosures, hover keys, painted colors.
3. Grade with the **canonical grader** (already built: grader-v2, dynamic, perf, a11y, responsive, interaction, seo, fidelity, committee) → flywheel.

## Key decisions / forks
- **A. Pruning aggressiveness:** collapse pass-through wrappers, KEEP structural nodes (bg/border/flex/grid/multi-child). Target ≤ ~600 elements (Elementor perf).
- **B. Grid:** detect `display:grid`; prefer a native Elementor grid container (verify the key via schema, same discipline as the html_tag lesson), else flex-wrap.
- **C. Reuse vs rewrite:** REUSE `capture-fx` leaf extraction + asset upload (they work); REPLACE only the tree structure (box-tree vs flat) and the builder (flex-tree vs absolute clusters). Lowest-risk, keeps every leaf-level win (painted color, hover, details).
- **D. Schema-first:** before emitting any new container key (grid, gap units, background gradient gate), verify it against the live `/widgets` + container introspection — no guessed keys (we paid 2x for that already).

## Risks & mitigations
- **Element explosion** → pruning + depth cap + element-count guard in --dry.
- **Elementor flex ≠ CSS flex edge cases** → per-node injected-CSS fallback on `#id` scope for unsupported props.
- **Genuine overlaps** (hero text over gradient swoosh) → keep a narrow absolute path for `position:absolute` source nodes only.
- **Grid key unknown** → schema-verify; fall back to flex-wrap.

## Implementation waves
- **W1 — capture-layout.mjs:** DOM box-tree + prune; validate on Stripe (node count, depth, backgrounds/gradients captured, cards intact as containers). Free, no writes.
- **W2 — build-flextree.mjs:** tree → Elementor container tree (flow layout, backgrounds, cards); --dry element-count + structure check; schema-verify new keys.
- **W3 — deploy (--page 805 reuse) + full eval-all + committee:** measure S1–S4 against the old build; iterate.
- **Reuse throughout:** capture-fx leaf extraction, asset pipeline, canonical grader + flywheel.

## Success criteria (vs the cluster build's committee FAIL 31/14/31)
- S1 text-collision: ZERO overlapping text (deterministic `overlap` gate clean + committee confirms legible).
- S2: dark/gradient sections render correctly (fidelity gradient count recovers; committee confirms dark bands).
- S3: cards reproduce as containers with bg/border/image.
- Composite (MIN-of-8) measurably > 0; visual `perceptual` > 0.44 baseline; committee > 31%.
