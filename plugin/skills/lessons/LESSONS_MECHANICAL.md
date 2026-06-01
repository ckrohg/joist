# Lessons — Mechanical (shared across clone / build / edit)

Facts about how Elementor compiles and how Joist's write flow behaves. **Mode-agnostic.**
Every lesson here improves all three modes with no adaptation. Read this file before Phase 1
of any clone/build/edit run.

See `README.md` for the lesson format and why this file is shared.

---

## No `joist_publish` MCP tool — the grader loop needs separate WP credentials (PRODUCT GAP)

**Discovered:** 2026-05-31 | build/clone baseline prep
**Symptom:** The generator→grader loop screenshots pages anonymously via Playwright, which
requires them to be `publish`. But the MCP surface has no publish tool, and Joist creates pages
as `draft`. So grading is blocked unless the operator has a separate WordPress application
password to POST `{"status":"publish"}` over REST. Anonymous GET of a draft 301-redirects.
**Implication:** every clone/build grading session needs a WP app-password as a Phase-0
prerequisite — it is NOT derivable from the MCP connection (which authenticates as `joist_agent`
with `manage_options` but exposes no publish path).
**Fix (operator):** keep a WP app-password available for the publish step.
**Fix (product, recommended):** expose a `joist_publish_page` MCP tool, OR add a
`publish: true` option to `execute_plan` / `create_plan`, so the autonomous loop never needs a
second credential channel. This is the single biggest friction point in closing the loop
unattended. Edit grading is unaffected — it uses `get_page_tree` diffing, no publish needed.

---

## Strict schema validator rejects many plausible setting keys — agents waste retries rediscovering them

**Discovered:** 2026-05-31 | builds B3 + B5 (each burned many validate-fix retries)
**Symptom:** Generators lost large numbers of tool calls (B3: ~75 tool uses / 279k tokens) probing
which setting keys each widget accepts, because the SchemaValidator rejects plausible-but-wrong keys
with no up-front allow-list. Confirmed rejections on this build:
- **button:** use `button_text_color` (NOT `text_color`); margins use `_margin` (NOT `margin`)
- **image:** rejects `border_radius`, `max_width`, `border_*` — keep `image`, `image_size`, `width`
- **heading / container:** reject `max_width` and `margin` — use `_margin` for spacing
- **icon-list:** rejects `space_between` and `typography_*` — keep `icon_list` (repeater w/
  `selected_icon`), `icon_color`, `icon_size`, `text_color`
- **star-rating:** rejects `star_size`, `stars_color`, `star_style` — only `rating` compiles
- **divider:** use `color` / `weight` (NOT `divider_color` / `divider_weight`)
- **social-icons:** use `social_icon_list`, `icon_size`, `align`
- **heading AND text-editor:** use `align` (NOT `text_align`) for text alignment — BOTH widgets reject
  `text_align`. Confirmed clone C1 v2: 34 `text_align` keys cost 2 full rollback iterations.
- **button:** also rejects bare `padding` — use `_padding` (confirmed clone C3 v2).
**Additional rejections confirmed by B1 (dental), which needed 10 iterations:**
- **button:** `background_background` also rejected (besides `text_color`)
- **icon (standalone widget):** ALL of `icon` / `icon_color` / `icon_size` rejected — the icon
  widget is effectively UNUSABLE on this site. Substitute styled eyebrow text or an accent border.
- **icon-list:** rejects enough keys to be impractical — B1 fell back to a styled `<ul>` inside a
  text-editor widget.
- **divider:** rejects `divider_width` / `gap`; wants `color`.
- Failures are atomic (page rolls back to empty on each rejected plan — verified), so a single bad
  key costs a whole iteration.

**Root issue (3/3 builds hit it):** `ELEMENTOR_V3_WIDGET_REFERENCE.md` is OUT OF SYNC with this
site's live `SchemaValidator` / WidgetCatalog. Agents burn 9–10 iterations reconciling it by trial.
**Fix (operator/agent):** keep the confirmed-rejection list above at hand; prefer `_margin`/
`_padding` for spacing.
**Fix (product, top priority — tied with the width bug):** (a) regenerate
`ELEMENTOR_V3_WIDGET_REFERENCE.md` from the real WidgetCatalog so the reference == the validator, OR
(b) ship a `joist_introspect_widget_schema` MCP tool (the atomic-schema introspector already exists)
so the generator fetches allowed keys instead of probing. Either cuts build/clone authoring cost by
roughly an order of magnitude and removes the main reliability risk.

**✅ SHIPPED (v0.10.12):** both halves done.
- **`knowledge/WIDGET_CONTROL_CHEATSHEET.md`** — curated correct control names per widget, generated
  from the LIVE schema, with a wrong→right table at the top. READ THIS before authoring; it ends the
  guessing.
- **`joist_validate_widget(widget_type, settings)`** MCP tool — pre-flight a widget's settings against
  the live validator and get `{valid, errors[]}` BEFORE it costs an execute_plan rollback. Validate
  any setting you're unsure about. Plus **`joist_get_widget_schema(widget_type, name_filter)`** to
  discover the real control names live. NOTE: the validator accepts a HUGE surface (370–590 controls/
  widget) — failures are wrong NAMES, not missing permissions. Validate, don't guess.

---

## Joist auto-created pages are status=draft by default

**Discovered:** 2026-05-31 | clone v4: peakinteractive.io
**Symptom:** Anonymous visitors (including Playwright screenshot) saw the theme's 404 — pages
were only viewable by logged-in admins.
**Root cause:** `PageFactory::createBlankElementorPage` defaults pages to `draft`; the MCP
write flow never publishes them.
**Fix:** After `joist_execute_plan` POST `{"status":"publish"}` to
`/wp-json/wp/v2/pages/<id>` with admin credentials, before any screenshot/grade step.

---

## ⭐ CRITICAL: child `width:%` does NOT compile to `--width` on Elementor 4.0.9 → columns stack

**Discovered:** 2026-05-31 | build B5 (page 273) + verified against clone stripe v2 (page 244)
**Severity:** This is the single biggest fidelity cap on multi-column layouts across ALL modes.
It was previously mis-diagnosed as the `_flex_basis` issue (below) — that's only one symptom.

**Symptom:** A row of cards/columns authored with `flex_direction:row` + child
`width:{unit:%,size:32}` renders **stacked vertically** instead of side-by-side. Confirmed visually
on the stripe clone (page 244): its 3-card bento ("Phone & payment / Dashboard / Analytics") stacks,
even though the page's *other* row (bottom 3 headings) renders side-by-side.

**Verified root cause (compiled-CSS evidence):**
- `--flex-direction:row` **DOES** compile (244: 5 row rules; 273: 4 row rules).
- `--flex-wrap` **DOES** compile (both wrap and nowrap present).
- `--width` rules compiled: **ZERO** on both pages, despite many explicit `width:%` child settings.
  So flex children get no width → fall back to full width.
- Interaction with wrap: full-width children in a `flex_wrap:wrap` row **wrap to their own lines →
  stack**. In a `flex_wrap:nowrap` row they stay on one line (which is why stripe's bottom heading
  row survived — it used nowrap).

**Proven by controlled probe (page 317), 3 sibling variants in a nowrap row:**
| Variant set in tree | Compiled to CSS |
|---|---|
| `width:30%` only | nothing |
| `width:30%` + `_flex_size:custom` | `--flex-grow`,`--flex-shrink` only — NO width |
| `_flex_size:custom` + `_flex_basis:30%` | `--flex-grow`,`--flex-shrink` only — NO basis |

So **`_flex_size:custom` does NOT rescue it** — on this atomic 4.0.9 site, the V3 container size
controls (`width`, `_flex_basis`) never emit a size rule; only grow/shrink compile. Custom column
RATIOS are not authorable through V3 size controls here at all.

**Options, in order of preference:**
1. **`flex_wrap:nowrap` for EQUAL columns (free, no CSS):** N equal flex items in a nowrap row split
   evenly via flex defaults — this is why stripe's bottom 3-heading row rendered as thirds while its
   `flex_wrap:wrap` bento stacked. Good enough whenever the columns are meant to be equal width.
   Caveats: no custom ratios, and it does NOT restack on mobile (needs a breakpoint).
2. **CSS injection for custom ratios + responsive (verified working):** scoped `<style>` (via an
   `html` widget, or a container's `custom_css` — the stripe header already uses `custom_css`)
   targeting the stable `.elementor-element-{id}` classes: `flex:0 0 calc(31% - 16px)` per card +
   a `max-width:767px` restack query. B5 confirmed all 3 cards side-by-side via DOM after this.
3. **(Product fix — highest leverage)** Joist should AUTO-INJECT option 2 whenever a flex-child
   container carries a `width:%`. The infra already exists — `Container.php` wires a `cssBlocks`
   service and containers support `custom_css` — so the authoring/normalization path can synthesize
   the scoped flex CSS from the `width` value the agent already provides. One fix turns every
   multi-column build + clone correct without the agent hand-writing `<style>` each time. (NOTE:
   `_flex_size:custom` is the WRONG fix — verified above — don't pursue it.)

**Implication for the eval:** prior clone fidelity scores are **overstated** — the stripe anchor's
centerpiece bento is visibly broken and was never caught because the page wasn't screenshotted
carefully. Re-grade anchors against screenshots, not vibes. This finding belongs at the TOP of any
clone/build authoring checklist.

### v0.10.11 FlexWidthFiller — DEPLOYED + VERIFIED, with one known gap

Shipped `FlexWidthFiller` (v0.10.11): auto-injects the flex CSS for any `%`-width container whose
parent is `flex_direction:row`. Verified live (page 378: 3 cols from `width:33%` alone; clone wave 1:
24 working injections on peakinteractive). Equal/standard column rows now Just Work.

**KNOWN GAP (clone C6, page 403):** the filler only fires when the parent has an EXPLICIT
`flex_direction:row`. A text+image case-study card where the agent set child `width:48%/44%` but left
the card's own `flex_direction` UNSET (Elementor default → column) did NOT get injected → the image
wrapped below the text. Compiled CSS confirmed: 24× `calc(31% - 16px)` (the explicit-row rows) but
zero `48%/44%` rules.
- **Agent-side fix (now):** ALWAYS set `flex_direction:row` on the parent of any `width:%` columns —
  including inside cards. Don't rely on default direction. (Added to authoring guidance.)
- **✅ Product v2 SHIPPED + VERIFIED (v0.10.13):** the filler now infers row-intent — when a container
  has 2+ child containers with `width:%` but isn't already `flex_direction:row`, it promotes the parent
  to a wrapping row and injects the child widths. Verified on page 496: a card submitted with NO
  flex_direction got `flex_direction:row` + `flex_wrap:wrap` auto-set and both children got the
  `/*joist-fw*/` CSS. Guarded at 2+ children to avoid promoting a single centered `width:50%` block.

---

## `_flex_basis` on inner containers doesn't compile to CSS on V3

**Discovered:** 2026-05-31 | clone v6: case study card layout
**Symptom:** Cards meant to be horizontal rendered stacked; DOM showed inner containers at
full parent width (~1320px) instead of 480/520px.
**Root cause:** V3 inner containers' `_flex_basis` is silently dropped during CSS compilation
when `_flex_size` isn't also set. Compiled post CSS had zero `--flex-basis` rules.
**Fix:** Use explicit `width: {unit:%, size:N}` on inner containers. `width` reliably compiles
to the `--width` CSS variable.

---

## placehold.co `?text=` empty renders the dimensions text

**Discovered:** 2026-05-31 | clone v2: trust-by-logos section
**Symptom:** `placehold.co/1200x100/...` rendered literal "1200 × 100" text — looks broken.
**Root cause:** placehold.co shows dimensions when no text param is given.
**Fix:** Append `?text=+` (the `+` encodes to a space, rendering invisibly).

---

## V4 atomic auto-fields trip hash defense unless stripped

**Discovered:** 2026-05-30 | v0.10 plugin work
**Symptom:** Plans that authored cleanly on V4 (Elementor 4.0.9) failed
`atomic_save_silent_failure` even though `Document::save()` succeeded.
**Root cause:** The V4 atomic transformer adds `id`, `isInner`, `styles`, `interactions`,
`editor_settings`, `version`, and `elements:[]` to every save. Joist's strict-hash check read
this as silent corruption.
**Fix:** Use `Hasher::forElementsLenient()` for the silent-save check on V4 sites. See
`knowledge/V4_ATOMIC_NORMALIZATIONS.md`.

---

## Joist logs canonical "benign V4 normalization" — not actionable

**Discovered:** 2026-05-31 | v0.10.6 deploy
**Symptom:** Successful V4 saves emit `joist.atomic.benign_v4_normalization` info logs (strict
hash differs, lenient matches). Easy to misread as warnings.
**Root cause:** `Logger::info` level, diagnostic-only.
**Fix:** Ignore during normal iteration. Only `joist.atomic.silent_save_failure` (error level)
is actionable.

---

## Full-page screenshots compress detail; use focused captures for grading

**Discovered:** 2026-05-31 | clone v7: card verification
**Symptom:** Full-page screenshot of a tall page compressed each section so small that images
appeared missing on lower cards, despite DOM confirming all had `imgs:1`.
**Root cause:** Full-page render scaled to a thumbnail; below-the-fold detail too compressed
to evaluate.
**Fix:** Capture viewport-sized screenshots focused on sections (scroll target into view,
`page.screenshot({fullPage:false})`). ALSO measure DOM bounding boxes — a card 600px tall
rendered horizontally; 1000px+ means it stacked. DOM measurement catches silent layout
failures faster than vision.

---

## `elementor/frontend/init` is the only safe lifecycle hook for embedded libraries

**Discovered:** 2026-05-31 | THIRD_PARTY_MOTION_LIBRARIES research
**Insight:** Elementor mounts widgets via its own JS pipeline. Libraries that target DOM
elements (GSAP on `.elementor-element-X`, Splitting.js) fail intermittently on plain
DOMContentLoaded — elements may not exist yet.
**Fix:** Wrap every library init in
`document.addEventListener('elementor/frontend/init', () => { ... })`. Universal for all
html-widget library embeds.

---

## Embedded smooth-scroll (Lenis/Locomotive) has an accessibility cost

**Discovered:** 2026-05-31 | THIRD_PARTY_MOTION_LIBRARIES research
**Insight:** Lenis/Locomotive hijack native scroll for inertia. Breaks screen-reader scroll,
ctrl+F focus, and `prefers-reduced-motion` unless guarded. ~190KB with GSAP+ScrollTrigger.
**Fix:** Wrap init in `@media (prefers-reduced-motion: no-preference)`. Always include the
disable path. Opt in per-page based on the source's actual smooth-scroll signal.

---

## Motion-fidelity ceilings are physical, not effort-bound

**Discovered:** 2026-05-31 | MOTION_DESIGN_PATTERNS_2026 + recognition research
**Insight:** Three.js custom-shader scenes cap ~75% via generic embeds (Vanta/glTF). True
magnetic cursor is JS-only; CSS `:hover` approximations cap ~40%. No amount of iteration moves
these without porting the source's custom JS.
**Fix:** Detect these effects, offer the cheap stand-in at its honest cap, and explicitly mark
custom-shader / physics-based effects as out-of-reach without source code. Applies to any mode
that embeds motion, not just clone.

---

*Append new mechanical lessons here as discovered — even when found during a clone or edit
run. A mechanical lesson written once becomes available to all three modes for free.*
