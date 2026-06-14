<!--
@purpose CANONICAL structured-clone methodology for Joist. The ORDERED, HIERARCHICAL process a human
dev / best-in-class tool (Builder.io, Locofy LDM, DCGen, VIPS, DesignCoder) uses to clone a site:
global styles first → nav at nav-level → ordered top-level sections → classify each → blocks/grids
within → build section→container→widget with globals + reflow-ready containers → per-section refine.
Distilled from 4 research streams (human practitioners + commercial cloners + segmentation academia +
Elementor authoring) and GROUNDED in Joist's current flat-pin pipeline (capture-layout.mjs →
build-absolute.mjs / build-flow.mjs → grade-sections.mjs). Replaces the flat absolute pin with a
top-down segment tree. Read this BEFORE touching the builders. See also CONTAINER_INFERENCE_SPEC.md
(per-container classify, the Phase-2/Phase-4 grid rules) and CLONE_PIPELINE.md (consolidated state).
-->

# CLONE_METHODOLOGY — the structured, hierarchical clone process

## 0. Thesis: a clone is a flat-design → code-HIERARCHY transformation, not a pin

Every credible source converges on one shape: **never emit a flat list of pinned elements; always emit
a recursive containment tree** (`page → nav | section[] → block[] → widget`), built **top-down**, with a
**global design system extracted first**. Builder.io trains a dedicated model whose only job is to
"transform flat design structures into code hierarchies." Locofy's LDM runs a *Design Optimiser* that
re-groups stray layers into proper parents **before** anything else. DCGen recursively cuts on
horizontal-then-vertical separation lines. VIPS (the rule-based winner of the Webis-WebSeg-20 benchmark,
beating learned models) does the same top-down separator split. DesignCoder's user study found
hierarchical output materially beats flat div-soup on maintainability (4.32 vs 3.32) and — decisively for
us — *"only tree-based layout enables precise relative sizes/positions for seamless cross-device
adaptation, supporting responsiveness flat generation cannot achieve."*

**Joist today does the opposite on the default path.** `build-absolute.mjs` *preserves flatness as a
feature*: `flatten()` (build-absolute.mjs:560) walks the box-tree, discards the nesting, and pins every
leaf as an `.elementor-absolute` widget at its captured `(x,y,w,h)`. That bought us the proven 1:1
desktop fidelity (supabase 0.878) but it is the **direct cause of all three known gaps**:

| Gap | Flat-pin root cause |
|---|---|
| **Nav-misclassification** (HN: 195 content rows → 195-item nav-menu) | nav is detected by scooping anchors from a band, with no *page-level* nav-vs-content gate |
| **Responsive cap** (desktop-pixel only; crude un-pin to relative+w:100%) | no semantic section/grid containers exist to reflow → only `abs-vertical-reflow` un-pinning |
| **Shallow editability** (editable ≠ organized) | flat absolute pins carry inline hex/px; no `section→container→card` nesting, no global tokens |

The inputs to fix this **already exist** — `capture-layout.mjs` emits a *nested* box-tree with per-node
`box{x,y,w,h}`, `layout{display,flexDirection,flexWrap,justify,align,gap,gridCols}`, `position`
(sticky/fixed), `background`/`bgSampled`, `paint`, `typo`, `kind` (11-kind leaf taxonomy), `href`, and
`list{items}`. The gap is **purely in the build**: the builder throws this structure away. The whole
methodology below is *"stop flattening; insert a top-down segment+classify pass between capture and emit,
and let the existing per-container `classify()` (already in build-flow.mjs) run on real section
boundaries instead of guessing per raw container."*

---

## 1. THE METHODOLOGY — the ordered, hierarchical clone process

Run these **in order**. Each step's output is the next step's input. This is the converged human-dev /
SOTA-tool order (tokens → site-parts → sections → classify → blocks → build → refine).

### STEP A — Extract the GLOBAL DESIGN SYSTEM first (tokens before pixels)

> *"Colors and Typography are the building blocks of any website… a token edit updates everywhere."*
> — Elementor Academy. Every practitioner source starts here; it is the editability multiplier.

1. **Cluster colors.** Over every leaf's `paint.value` + every node `background.color`, quantize the page's
   colors (e.g. bucket in CIELAB / round to a small palette) into **2–6 dominant brand colors**. Map the
   strongest onto Elementor's four system globals `primary / secondary / text / accent`; promote the rest
   as `custom_colors`. Naively promoting every near-duplicate hex explodes the token set — **cluster
   first, then map widgets to the nearest token.**
2. **Cluster typography.** Over every leaf's `typo{family,size,weight}`, build a **type scale** (a handful
   of size/weight steps) + the 1–3 font families in use. Write as `system_typography` / `custom_typography`.
3. **Write to the active Kit**, not the page: `system_colors`/`custom_colors` (`{_id,title,color}`),
   `system_typography`/`custom_typography` (`{_id,title,typography_typography:"custom",
   typography_font_family,typography_font_weight,…}`).
4. Now every widget emitted downstream **references** a token via the `__globals__` object instead of
   baking inline values: `settings.__globals__ = { title_color: "globals/colors?id=primary" }`,
   typography → `globals/typography?id=primary`. One edit restyles the whole clone.

**Output:** a `tokens` object `{colors[], typeScale[], families[]}` + the kit written; downstream widgets
carry `__globals__` references, not inline hex/px.
**Pitfall:** globals don't travel on cross-site JSON import unless the kit travels too — **write the kit
on the target site before referencing it.**

### STEP B — Detect + build the NAV at the NAV level (separate from page content)

> Header/footer "are visible on multiple pages but separate from the page's content — built via Theme
> Builder." — Elementor. Building nav first and *separately* is exactly what prevents the
> nav-misclassification failure.

A band is **NAV** only if it passes a *multi-signal* gate (NOT "has links" — that is the 195-row bug):

- **top-anchored:** `y ≈ 0` (first band), AND
- **short:** band height `h ≲ 120px` (the documented header upper-N-pixel heuristic), AND
- **horizontal link-row:** a single horizontal run of short link-text leaves (anchors/buttons), a logo
  `image`/`svg` adjacent, AND
- **sane item count:** ~3–15 items, AND
- **low text-area fraction** / `position:fixed|sticky` corroboration.

A 195-row content list **fails on height + item-count + vertical-stacking + non-sticky** → it is
**content**, emitted as native `list`/`text`/`heading` widgets, not a nav. (Footer link rows, breadcrumb
bars, tab strips are nav-*like* → disambiguate by **position**: footer is bottom-most + multi-column link
clusters; nav is top-most + single horizontal row.)

**Emit:** a real **Pro `nav-menu` widget** inside a dedicated **sticky full-width header container**
(logo + nav-menu + CTA), bound by a per-page WP menu slug; Path C structural fallback (per-link widgets +
checkbox-hack hamburger, `_flex_grow:0` never `width:0`) when Pro is absent. For multi-page, lift to a
Theme Builder `type:"header"` document. **Build nav before the sections** (10Web's "menus" step order).

**Output:** a header container/document; the nav band's leaves are marked consumed so the section pass
skips them.

### STEP C — Segment the page into ordered top-level SECTIONS (VIPS, top-down)

Cut the page into an **ordered top-to-bottom list of section bands** using VIPS-style separator detection
over the box-tree (geometry, not a pixel scan — the gutters are already measured):

1. **Normalize / clean:** reuse the existing dedupe/re-nest; **exclude negative/overflow boxes**
   (`x<-200 || w>2·vw`) from all gap math (they poison separators — the resend marquee `x=-1934 w=6234`).
2. **Project top-level nodes onto Y.** A **horizontal separator** = a maximal empty Y-band that no box
   crosses across the content width. Weight each separator by: `gapPx` + `Δbackground-color` +
   `Δfont-regime` + presence of an `<hr>`/border. Color/background-change separators weigh **higher** than
   gap-only (Bain: "a new section begins at a change in colour, change of layout, or a large gap").
3. **Cut on the strongest separators first** → ordered top-level bands. **Recurse** into a band only until
   it is coherent "enough" (a VIPS *PDoC* analog) — use ~3 effective levels (section / block / leaf);
   don't over-split. Guard with a **minimum-section-height** and a **minimum-gap-before-cut** so a
   full-bleed background image spanning two logical sections doesn't get falsely merged or split.

**Output:** `sections[]` in document order, each a `{box, bg, children[]}` band.
**Pitfall:** full-bleed backgrounds erase the gutter (no whitespace to cut on); a decorative hairline
fabricates one. Weight gap + color jointly; require a minimum gap. Where geometry is degenerate (one giant
flat div-soup), fall back to **1-D Y-clustering** of box centers (HDBSCAN/OPTICS-style, gap-break
threshold scaled to the page's own median gap) — geometry-only segmentation is "significantly effective."

### STEP D — CLASSIFY each section (archetype labeling)

Label each band with a **soft/scored** archetype (sum of signals, not hard if/else, so atypical bands
degrade to `generic` rather than mislabel). Signals = `kind`-histogram + `box.y`/position + dominant
`typo.size` + link-density + repeated-region presence:

| archetype | signature |
|---|---|
| **hero** | directly below nav, tall, **one dominant largest heading** + short sub-text + 1–2 buttons + a large visual; low link density |
| **feature-grid** | a repeated region of ≥3 equal cards (icon/image + heading + text) |
| **logo-row** | one band of repeated small near-equal-height images, no headings |
| **cta** | short band, centered heading + 1–2 buttons, contrasting bg, low text volume |
| **footer** | bottom-most band, high link density but **many short link groups in columns**, small font |
| **generic** | none of the above → a plain section container |

Classification also lets you apply **per-archetype global styles** (hero heading → primary H1 global, card
→ a reusable card class) — the editability nesting a human wants.

**Output:** each section tagged `{archetype}`; drives recipe selection + which global token to bind.

### STEP E — Within each section, detect BLOCKS / columns / grids (divide-and-conquer)

Recurse **inside** each section (DCGen's "vertical cut inside a horizontal band"; DesignCoder's grouping
chain). **Joist already has this** as `classify()` (build-flow.mjs:589) — promote it from a per-raw-container
helper to run on each *segmented section*:

1. **Vertical separators / column split:** within the band, find x-gaps with no overlap → columns. Cluster
   leaves into `column` / `row` / `grid` / `overlay` (the existing `greedyBands` + `colStartsAlign(tol=8)`
   + `geometryGridCols` + `anyVbandOverlay` logic).
2. **Repeated-block detection (DEPTA/MDR, the card-grid detector):** for each sibling under the section,
   compute a **structural signature** = `(kind-sequence, child-count, approx aspect ratio, has-image?,
   has-heading?, has-button?)`. When **≥3 adjacent siblings share a signature** AND widths match within
   ~10% (`width-CV < 10%`) AND inter-gaps are regular → tag the region `repeat:{count,cols,template}`.
   This catches **wrapped grids** (12 cards as 3×4) and **carousels** (off-screen overflow siblings) that
   the per-band check misses. Require structural **AND** size **AND** spacing match so a featured/larger
   card or one-with-a-badge is treated as its own widget, not flattened into the uniform grid.

**Output:** each section's children resolved to `{mode: row|column|grid|overlay, repeat?}` blocks.
**Pitfall:** pure geometry mis-groups two visually-adjacent-but-unrelated elements — use `kind`/`typo`/
`text` role cues as tie-breakers (DesignCoder groups by *semantic* relationship, not pure geometry).

### STEP F — Build hierarchically: section → container → widget, with globals + reflow-ready containers

Assemble **top-to-bottom across sections, bottom-up within a section** (widgets before their parent so
geometry is known when the parent is built — DCGen "leaves first, integrate upward"). Emit the canonical
3–4-level Elementor nesting (**no deeper** — deeper hurts editability + cascade reasoning):

```
container (section)   html_tag:"section"  content_width:"full"   background  min_height:<band.h>
└─ container (inner)  content_width:"boxed" width:~1140px  flex_direction:"column"  gap   ← readable measure
   ├─ widget(s)       heading / text / button   (single-column stack, __globals__ refs)
   └─ container (block)  per STEP-E mode:
        • grid:    container_type:"grid"  grid_columns_grid:{unit:"fr",size:N}  grid_gaps   ← card rows
        • row:     flex_direction:"row"  flex_gap (set explicitly, even 0)                  ← leaf-rows / nav links
        • column:  flex_direction:"column"
        • overlay: scoped ABSOLUTE pins inside THIS section (free-form/z-layered art only)
```

**Hard rules (don't relearn — proven in Joist's own experiments, CONTAINER_INFERENCE_SPEC §Phase-4):**
- A multi-column row of **container** children **must be Grid, never flex** — `.e-con` forces flex
  *container* children to `width:100%` → vertical collapse → 2–8× height overflow (the wall that made
  absolute win). Use `container_type:"grid"`; for uneven widths set `grid_template_columns` from per-record
  width ratios (only for small ≤4-col genuinely-uneven grids).
- Background on the **full-width outer** container (paints edge-to-edge); boxed width on the **inner** one.
- `padding` key (not `_padding`); `_margin` *with* underscore; set `flex_gap` explicitly (the ~20px
  default balloons height up to 3×). Nested containers need `isInner:true`. Keep emitting **V3 container
  shape** (V4 auto-adds normalization fields; the lenient hash strips them).
- **POSITIONING is a per-block decision (LaTCoder hybrid):** clean flex/grid blocks → semantic container
  (reflows). Genuinely overlap/free-form blocks (layered hero art) → keep the proven absolute-pin recipe,
  **scoped inside that one section's container**, not page-global. This preserves today's 1:1 fidelity
  exactly where needed and unlocks reflow everywhere else.

**Output:** a real Elementor element tree `page → header → section[] → inner → block[] → widget[]`, widgets
binding `__globals__` tokens.

### STEP G — Per-section refine + per-breakpoint reflow

1. **Per-breakpoint (responsive falls out of the structure):** because sections/blocks are now real
   containers, reflow is a **per-device override**, not a rebuild — set `_tablet`/`_mobile`
   `flex_direction:"column"` and collapse `grid_columns_grid` to 1 (3-col grid → 1-col on mobile), adjust
   `flex_gap`/`padding` per device. These kses-surviving keys already persist through Joist's PUT. This
   **replaces the crude `abs-vertical-reflow` un-pin** with true semantic reflow — for every band that
   became a real container. (Absolute-scoped overlay bands stay desktop-pixel; set that expectation.)
2. **Per-section refine loop:** grade each section (visual SSIM + per-element + responsive RLG via
   `grade-sections.mjs`), and **route per section**: where the structured emit regresses fidelity vs an
   absolute pin, fall back to absolute for *that section only*. Grade **both** fidelity and editability so
   the router can choose per section (per the project's "grader strictness IS progress" stance — a
   correctly-reflowing grid that drifts a few desktop px is the right trade; don't let a flat-pin's higher
   desktop SSIM veto the structured emit).

---

## 2. RESTRUCTURE PLAN — mapping each step to concrete code changes

**Architecture change:** insert a new **`segment.mjs`** between `capture-layout.mjs` and the builders. It
consumes the existing box-tree and emits a **typed segment tree** `{tokens, header, sections[]}`. Then a
new **`build-structured.mjs`** (or a `--structured` mode on `build-flow.mjs`, which already has the
container/grid emit logic) realizes that tree; `build-absolute.mjs`'s pinning is retained only as the
**per-block overlay fallback** invoked *inside* a section. No new network capture is required.

| Step | What EXISTS today | What to BUILD |
|---|---|---|
| **A globals** | nothing — every pin carries inline hex/px (build-absolute leaf emit) | `segment.mjs` token extractor (cluster `paint`/`typo`); write Kit `custom_colors`/`custom_typography`; emit `__globals__` refs in the widget builder |
| **B nav** | `detectHeaderNav` (build-absolute.mjs:803) scoops anchors → over-fires (195-row bug); `buildRealHeader`/Path A Pro nav-menu exists in build-flow.mjs:1271 + `real-nav-build.workflow.js`; `nav-misclassification-fix.workflow.js` in flight | promote nav detection to a **page-level multi-signal gate** (top-anchored + h≤120 + 3–15 items + horizontal + low text-area) BEFORE sectioning; reuse the existing Pro nav-menu emit; emit nav first |
| **C sections** | `classify()`/`greedyBands` run **per raw container** (build-flow.mjs:480-645), bottom-up — no page-level section split; `build-absolute.flatten()` (560) discards nesting | new **VIPS section pass** in `segment.mjs`: Y-projection separators weighted by gap+Δbg+Δfont; ordered top-level bands → top-level full-width section containers w/ `min_height` |
| **D classify** | none — no archetype labeling | `segment.mjs` soft-scored archetype labeler (kind-histogram + position + dominant typo + link-density) → tag each section |
| **E blocks** | `classify()` modes (row/column/grid/overlay) + `geometryGridCols` + `colStartsAlign` exist but only per-container | run `classify()` **on each segmented section**; add **DEPTA repeated-region detector** (structural signature + width-CV<10% + regular gap) for card grids/carousels |
| **F build** | `build-flow.mjs` emits native grid/flex containers (the `container_type:'grid'` Phase-4 fix, mode handlers); `build-absolute.mjs` does scoped abs (overlay/card-row recipes at :686,:717) | `build-structured.mjs` assembles section→inner→block→widget with `__globals__`; route per-block to flow-container vs scoped-absolute (LaTCoder) |
| **G refine** | `grade-sections.mjs` (SSIM + per-element + responsive RLG + detectors); `abs-vertical-reflow` un-pin (build-absolute.mjs:46+) | per-container `_tablet`/`_mobile` overrides (replaces un-pin); per-section grade + per-section router fallback |

**Why a new file, not an in-place edit of build-absolute.mjs:** build-absolute's entire design is
`flatten → pin`; bolting a tree onto it fights its grain. `build-flow.mjs` already *thinks in containers*
(it has `classify`, `buildGrid`, the `.e-con` grid fix, the Pro header) — it is the natural host for
STEP F. The new `segment.mjs` is the missing *front half* that gives both builders clean nav/section/block
boundaries instead of guessing.

---

## 3. RANKED BACKLOG — implementable changes

Dimension key: **R**=robustness, **Re**=responsive, **E**=editability. `autonomousSafe` = behind a flag
with a self-test + no-regression gate on the corpus (safe to run unattended); `supervised` = an
architectural change wanting a human checkpoint.

1. **Page-level nav gate** (multi-signal: top-anchored + h≤120 + 3–15 items + horizontal + low text-area;
   else → content). *File:* `build-absolute.mjs` (+ `build-flow.mjs`). *Dim:* **R**. *autonomousSafe* —
   this is `nav-misclassification-fix.workflow.js`, reversible, gated on HN-structural-up +
   supabase/tailwind real-nav-still-detected. **Highest ROI; fixes the headline failure; generalizes to
   ecommerce grids / search results / comment threads / changelogs.**

2. **`segment.mjs` — VIPS top-down section pass** (Y-projection separators weighted gap+Δbg+Δfont →
   ordered top-level section bands; overflow-box exclusion; min-height + min-gap guards). *File:* new
   `segment.mjs`. *Dim:* **Re, E, R**. *supervised* — the architectural keystone; everything else hangs
   off real section boundaries. Validate PDoC granularity on the corpus.

3. **Global-token extraction + `__globals__` emit** (cluster `paint`/`typo` → Kit colors/fonts; widgets
   reference tokens). *File:* `segment.mjs` (extract) + widget builder (emit). *Dim:* **E**. *autonomousSafe* —
   purely additive, visually identical (tokens = captured values); gated on no visual regression. **Biggest
   single editability upgrade; missing entirely today.**

4. **DEPTA repeated-region → native grid** (≥3 adjacent siblings, signature + width-CV<10% + regular gap →
   one card template ×N in a grid container). *File:* `build-flow.mjs` (extends `classify`/`geometryGridCols`).
   *Dim:* **E, Re**. *autonomousSafe* — reuses the proven `container_type:'grid'` fix; gated on no
   height-overflow regression. One editable card, N instances, reflows on mobile.

5. **Per-breakpoint container overrides** (`_tablet`/`_mobile` `flex_direction:column` + grid→1-col on
   semantic-container sections; replaces `abs-vertical-reflow` un-pin). *File:* `build-structured.mjs` /
   `build-flow.mjs`. *Dim:* **Re**. *autonomousSafe* once sections exist (depends on #2); gated on
   responsive-RLG grade up at 768/390, no desktop regression.

6. **`build-structured.mjs` — hierarchical assembler with per-block positioning router** (section→inner→
   block→widget; LaTCoder hybrid: flow-container for clean grids/rows, scoped-absolute for overlay/free-form;
   per-section grade + fallback). *File:* new `build-structured.mjs`. *Dim:* **Re, E, R**. *supervised* —
   the integration that turns #2–#5 into a single pipeline + router; A/B vs absolute on the corpus.

(Lower-priority follow-ons: section-archetype labeler (D) feeding per-archetype global styles; Theme
Builder header/footer documents for multi-page; geometry-cluster fallback for div-soup pages.)

---

## 4. How this fixes the three known gaps

- **Nav-misclassification (R):** nav becomes a *page-level multi-signal classification* (top-anchored +
  short + sane item-count + horizontal link-row + low text-area), decided **before** sectioning and built
  at the nav level as a Pro nav-menu. The 195-row content list fails the height/item-count/vertical-stack
  test → emits as native content. (Backlog #1, in flight.)

- **Responsive cap (Re):** the cap exists *only because there are no semantic containers to reflow*. The
  VIPS section pass (#2) + native grid blocks (#4) create real flex/grid containers, so reflow is a
  per-breakpoint container override (#5) — `flex_direction:column`, grid→1-col on mobile — instead of the
  crude absolute un-pin. Bands that stay scoped-absolute remain desktop-pixel (honest scope).

- **Shallow editability (E):** flat absolute pins become a clean `section → inner → block/card → widget`
  hierarchy (#2, #4, #6) with color/typography bound to **Kit global tokens** (#3), so the clone is
  restyleable from one place and organized the way a human would want to edit — the structural-editability
  axis CLONE_PIPELINE.md flags as a separate, currently-unmet dimension.

**Net:** keep the proven 1:1 absolute fidelity exactly where free-form layout needs it (scoped per
section), and gain human-dev structure — robust nav, semantic reflow, global-token editability —
everywhere else. The inputs already exist in `capture-layout.mjs`; the work is a top-down
segment+classify pass (`segment.mjs`) plus a hierarchical assembler (`build-structured.mjs`) that lets
the container logic already living in `build-flow.mjs` run on real section/block boundaries instead of a
flat pin.

---

## External validation — how a practitioner actually teaches the build (WordPress Bootcamp, 6-wk course)

Transcribed the user's own training videos (7 lessons, `WordPress Trainual/`, mlx-whisper). The instructor
(self-taught, 5 yrs agency) teaches an Elementor build flow that **matches this restructure almost 1:1** —
it confirms the spine, it doesn't redirect it. The order and emphasis he uses, mapped to our steps:

1. **Decompose the page as header / sections / footer first.** "Everything above this line is the header
   (navigation + logo); everything below is the footer; a visual break means I've *subconsciously entered a
   new section*." → exactly the `segment.mjs` nav→section[]→footer pass (**backlog #2, KEYSTONE**). The
   human reads sections by *perceived breaks*, which is what VIPS top-down segmentation approximates.

2. **Build the homepage above-the-fold FIRST, then duplicate/reuse.** "I start with the homepage hero
   because once it's created you have the stylistic system, then you copy-paste elements across the site."
   → **order of operations: nav + hero + global style system first, then reuse.** New emphasis the
   restructure should honor: establish globals/nav/hero, *then* fan out the remaining sections.

3. **Section anatomy = `section ▸ column(s) ▸ widget`.** Drop a section → add columns with explicit width
   (he uses 75/25) → drop a text/image/button widget into the column. → the hierarchical
   `build-structured.mjs` `section → inner → block → widget` tree (**#6**), not a flat pin.

4. **Section height = min-height / fit-to-screen / fixed px** (hero is usually "fit to screen" = full
   viewport). → our `min_height` band-pinning (already the hybrid drift fix) belongs in the structured
   builder per-section.

5. **Spacing = per-section + per-column padding** ("add 40px into this section", "padding left/right on the
   column"). → padding bands between/inside sections, not absolute gaps.

6. **Color is "pulled through" from one element to the next for harmony.** → **Kit global tokens (backlog
   #3)** — direct validation of the STEP-A globals round running right now. A human keeps one palette and
   references it; that *is* global-token extraction.

7. **Responsive = the per-element "Responsive" tab under Advanced** — hide-on-mobile, and column render
   order ("renders column one then column two", i.e. columns *stack* on mobile). → per-breakpoint container
   overrides (**#5**): `flex_direction:column` + reorder, not the crude absolute un-pin.

8. **Mobile nav = a recognizable hamburger / mobile-menu icon**, and he explicitly flags that "the
   hamburger icon is *not fully recognizable as navigation*" — you must style it. → **mobile-menu-fidelity
   (B+ backlog):** detect + reproduce the source's actual mobile-nav pattern (hamburger vs Apple horizontal
   scroll vs app-footer), don't just drop a generic toggle.

9. **H1 first** ("the first thing Google scrapes"). → semantic heading hierarchy — reinforces *words must be
   rebuilt semantically* (not rasterized), and the structural-fidelity axis.

**Net:** the curriculum is an independent confirmation that the nav→section→block hierarchy, homepage/
hero-first ordering, global-token color system, per-element responsive reflow, and mobile-menu fidelity are
the *right* levers — the same ones already in this backlog. The one ordering nuance to adopt: **globals +
nav + hero establish the style system first, then the remaining sections reuse it** (build order, not just
structure). No direction change; higher confidence.
