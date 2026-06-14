# Clone Capability Spec — true 1:1 Elementor cloning

> Status: DRAFT in progress (2026-06-01). Framing + architecture + dependency graph + honest-grader design are settled below; the four capability deep-dives (responsive, motion, hover, effect-aware capture) and the architecture/ceiling section are being filled from 6 parallel research streams. This is the design-of-record that replaces tactical Stripe iteration.

## ⭐ REVISED APPROACH v2 (post-step-back-2, 2026-06-01) — supersedes the XY-cut/IR/injected-CSS build below

Two deep research streams (read Builder.io/SnapDOM/Anima source + Elementor source & real template JSON) proved the prior build was the *wrong family* AND used the wrong Elementor mechanics. Every failure (green headline, font-not-loading, 1.6× height, mispositioning) now has a root cause + fix. The new pipeline:

**1. Faithful 1:1 capture (delete XY-cut re-derivation).** Walk `querySelectorAll('*')` (pierce shadow DOM); per node read `getComputedStyle` + `getBoundingClientRect`; emit at the browser's *already-resolved* absolute coordinates; root height = `scrollHeight`. Re-derivation is what inflates height — good tools never re-flow. (Family lesson: 10Web + my XY-cut = "re-derivers" = lossy; Builder.io/Anima/html.to.design/SnapDOM = "faithful capturers".)

**2. Rasterize unrepresentable paint (HIGHEST-leverage fix).** Classify each node. If it has `background-clip:text` / transparent `-webkit-text-fill-color` / a CSS gradient / `filter` / `backdrop-filter` / `mix-blend-mode` / `clip-path` / `mask` → **do NOT model it as a styled widget. Screenshot that exact element @2× DPR (`elementHandle.screenshot`), upload PNG, place an Image widget pinned to its measured box.** The green gradient headline becomes a crisp gradient PNG. The tell: `color` transparent/fallback ⇒ route to rasterizer, never emit the fallback color.

**3. Emit CLEAN Elementor (no injected CSS) using EXACT keys + the GATES.** Elementor emits layout as CSS *variables* (`--flex-direction` …); injected raw CSS *competes* → soup. Set the setting keys instead:
- **GATES (the silent-fallback traps that caused the font + bg bugs):** `typography_typography:"custom"` (WITHOUT IT every `typography_*` key is ignored → font falls back) and `background_background:"classic"` (without it `background_color` does nothing). Emit these EVERY time.
- **Container layout:** `flex_direction`, `flex_justify_content`, `flex_align_items`, `flex_gap` (a GAPS object `{column,row,unit,isLinked}`), `flex_wrap`, `content_width`, `min_height` (px, not vh), `padding` (UNPREFIXED on containers).
- **Child sizing:** `_flex_size:"grow"`/`_flex_basis`/`_flex_align_self`; WIDGET spacing is `_padding`/`_margin` (PREFIXED). Mixing prefixed/unprefixed = ignored settings = injected-CSS soup.
- **Per-widget color:** heading `title_color`, text-editor `text_color`, button `button_text_color`+`background_color`.
- **EXPLICIT `typography_line_height`** every text node (theme default ~1.5 vs design ~1.1 compounding is THE 1.6× height-inflation cause).
- **The green headline alt-cause:** a non-empty `__globals__:{title_color:"globals/colors?id=accent"}` OVERRIDES the literal color. Set `__globals__:{title_color:""}` to use your literal (or rasterize per #2).

**4. Fonts = embed BYTES + the gate + verify glyphs.** Register the source's woff2 as an `elementor_font` post + set as Global Font (or inject `@font-face`), upload ALL referenced weights, set the `typography_typography:"custom"` gate, **verify glyphs actually rendered** (`document.fonts.check()` + woff2 returns 200), Regenerate CSS. Never trust the family name alone.

**5. Layout = absolute-capture first, conservative flex post-pass with PINNED heights.** Only collapse boxes into a flex container when they form a provably-1:1 row/column with consistent gaps (Anima CV heuristic); pin measured heights so containers can't auto-inflate; keep fixed geometry where ambiguous (Webflow determinism rule).

**6. Seed the Kit** (global colors/fonts/theme-style) and reference via `__globals__` for editability + DRY.

**7. Grader fix:** verify fonts actually RENDER (glyph/pixel check), not just the family-name string — the honest grader was fooled by `fontFamily PASS` on a fallback-rendered page.

> Sections 1–7 below remain valid (capture-fx's effect detection, the IR component/style ideas, the honest grader design, the responsive/motion/hover key tables). The CHANGE is the build spine: faithful-capture + rasterize-effects + clean-keyed Elementor emit, replacing XY-cut re-derivation + injected-CSS.

---

## 0. The goal, stated honestly

Clone an arbitrary public website into a **round-trip-editable Elementor page** that is, on every axis a human evaluates:
- **Pixel-accurate** at desktop (layout, type, color, spacing, imagery, effects)
- **Responsive** — matches the source at mobile/tablet/desktop, not just 1440
- **Motion-faithful** — entrance/scroll/parallax animations reproduced
- **Interaction-faithful** — hover/focus/active states reproduced
- and **editable** in the Elementor editor afterward.

The bar is "a designer comparing the two tabs cannot quickly tell which is the clone."

## 1. Why we keep falling short (root causes, from hard experience)

1. **Capture is the real ceiling, not Elementor.** We read a handful of computed-style props and get fooled by effects: gradient-clipped text returns a garbage fallback `color` (the v5 "green"); we miss pseudo-elements, exact gradients, shadows, transforms, the real webfont. **If the capture doesn't see the truth, nothing downstream can reproduce it.**
2. **The grader flatters itself.** Naive pixelmatch at a lenient threshold scored a clone ~93% while the eye instantly saw a flat headline where the source had gradient text. A single global pixel-% hides localized catastrophic misses and treats gradient-vs-flat as "match." We repeatedly believed a number over our eyes.
3. **No responsive / motion / hover at all.** Everything so far is desktop-static. Three whole axes of the deliverable are unbuilt.
4. **Tactical, not architected.** We hand-patched per-defect (gradient, wordmark, wave) instead of a capture→represent→build→verify pipeline that generalizes.
5. **Editable-vs-exact tension, unresolved per-section.** Precision widgets are editable but drift; image-capture is exact but not editable. We need a principled per-element decision, not ad hoc.

## 2. Architecture — the pipeline (capture → IR → build → verify)

```
SOURCE URL
  │
  ▼  ① CAPTURE (effect-aware, multi-viewport, multi-state)
  │     full computed style + geometry per element, at 3 breakpoints,
  │     + hover-state deltas + motion descriptors + real fonts/assets
  ▼
  │  ② NORMALIZE → INTERMEDIATE REPRESENTATION (IR)
  │     a clean component/style tree: nodes with {box, type, style(full),
  │     responsive variants, states(hover…), motion, role}; de-duped,
  │     visible-truth resolved, sections segmented
  ▼
  │  ③ DECIDE per node (hybrid policy): native precision widget │ custom-CSS
  │     │ captured image. Driven by reproducibility + editability value.
  ▼
  │  ④ BUILD → Elementor element-JSON tree
  │     containers + widgets + responsive (_tablet/_mobile) + hover (_hover)
  │     + motion (motion_fx / GSAP escape) + injected CSS (gradients, exact pos)
  │     + self-hosted fonts; deploy via plan API (paced, fresh page)
  ▼
  │  ⑤ VERIFY (brutally honest grader) — per region × per viewport × per state
  │     perceptual + structural + effect-presence + vision-judge; localized
  │     misses TANK the score. Diff drives the next fix.
  ▼
  └──── iterate ③–⑤ until the honest grader + the eye agree.
```

The **IR is the keystone** (this is what the good design-to-code tools have and we don't): one normalized tree carrying *all* axes (style, responsive, state, motion) so build and grade both operate on the same complete truth. [RESEARCH F: confirm IR shape from Builder.io/Anima/Locofy]

## 3. Capability dependency graph

Build order is forced by dependencies (lower must exist before higher is meaningful):

```
                          ┌─────────────────────────┐
                          │ L0 HONEST GRADER (gate)  │  ← build FIRST; everything
                          │  perceptual+struct+vision │     is measured by it
                          └─────────────┬────────────┘
                                        │ measures
        ┌───────────────────────────────┼───────────────────────────────┐
        ▼                                ▼                                ▼
┌───────────────────┐        ┌────────────────────┐         ┌──────────────────────┐
│ L1 EFFECT-AWARE   │───────▶│ L2 IR / NORMALIZE   │────────▶│ L3 PRECISION BUILD    │
│   CAPTURE (desktop)│ feeds  │  (component tree)   │  feeds  │  (native+CSS+image)   │
└───────────────────┘        └─────────┬──────────┘         └──────────┬───────────┘
        │                              │                                │
        │ extends to                   │ extends to                     │ extends to
        ▼                              ▼                                ▼
┌───────────────────┐        ┌────────────────────┐         ┌──────────────────────┐
│ L4 MULTI-VIEWPORT │        │ (IR carries          │         │ L5 RESPONSIVE BUILD   │
│   CAPTURE (resp.) │───────▶│  responsive variants)│────────▶│  (_tablet/_mobile)    │
└───────────────────┘        └────────────────────┘         └──────────────────────┘
        │                                                              │
        ▼                                                              ▼
┌───────────────────┐                                       ┌──────────────────────┐
│ L6 STATE + MOTION │──────────────────────────────────────▶│ L7 STATE+MOTION BUILD │
│   CAPTURE (hover, │                                        │  (_hover, motion_fx,  │
│   scroll, anim)   │                                        │   GSAP escape)        │
└───────────────────┘                                        └──────────────────────┘
```

**Critical-path insight:** the HONEST GRADER (L0) and EFFECT-AWARE CAPTURE (L1) are the two foundations — without an honest grader we can't tell if anything improved; without faithful capture there's nothing true to build. Responsive/motion/hover are *extensions* of capture+IR+build, not separate systems. Build L0 + L1 + L2 first.

## 4. The brutally-honest grader (detailed design — the anti-self-deception gate)

Hard rules, from watching the grader lie this session:

- **No single global pixel-%. Ever.** Report a vector of dimension scores AND a final score that is a **penalized min**, not an average — one catastrophic localized miss must tank the total. A page that's 99% right everywhere but renders a flat headline where the source has gradient text is NOT a 95%; it's failed on the hero.
- **Grade per REGION × per VIEWPORT × per STATE.** Tile each section; score tiles; the worst tiles dominate. Grade at mobile/tablet/desktop and on hover, not just desktop-rest.
- **Perceptual, not lenient pixelmatch.** Use SSIM/MS-SSIM (+ a perceptual metric) so blur/gradient/color shifts are penalized; CIEDE2000 for color. Tune so gradient-vs-flat and wrong-font do NOT pass. [RESEARCH E: exact metrics/libraries + thresholds]
- **Structural + text + font checks** independent of pixels: per-element bounding-box IoU, DOM/text-content diff, and **font-family match** (the typography dimension MUST fail on a font substitution — our current one ignores family).
- **Effect-presence assertions:** does the clone actually HAVE the gradient/shadow/animation/hover the source has? A boolean per effect; missing effect = penalty. (Catches the exact thing that fooled us.)
- **Vision-judge as mandatory arbiter, with a HARSH rubric.** A vision LLM (me, or an API model) must view source-vs-clone crops side by side and *enumerate concrete differences*, scoring each criterion, biased toward finding faults (default to "different" when unsure). It CAPS the deterministic score, never inflates it. [RESEARCH E: rubric design to defeat leniency bias]
- **The grader must justify every point.** Output the specific evidence for each dimension (which region, which prop, which effect) so a high score is auditable. If it can't point to evidence, it can't award the points.
- **Look is law.** The metric is a regression guard; the side-by-side LOOK is the truth. The grader's job is to make the number agree with an honest eye — when they disagree, the eye wins and the metric is wrong and must be fixed.

Dimensions (each 0–1, final = penalized aggregate): `layout`, `typography(incl. family)`, `color`, `imagery`, `effects_present`, `responsive(mobile/tablet)`, `hover`, `motion`, `visual_integrity(perceptual per-region)`.

**✅ RESEARCH E — concrete, validated design (this is the rebuild):**
- **THE ROOT CAUSE of our 93% lie, named:** pixelmatch's `threshold` is a **per-pixel YIQ color tolerance**, NOT "percent of image matched." At a lenient threshold a gradient headline reads as a flat one (each pixel within tolerance), and the whole-frame **mean** drowns a localized catastrophe in matching background. Three structural fixes, all mandatory: **(1) MIN not mean, (2) per-region × per-viewport not whole-frame, (3) deterministic computed-style HARD-FAIL gates** a lenient number or agreeable LLM cannot override.
- **Metric stack (per region crop):** **LPIPS** (primary — best human-perception correlation; Python sidecar via `lpips`/`piq`) + **MS-SSIM** (structure); **CIEDE2000 ΔE₀₀** via `culori` on sampled key colors (headline fill, CTA bg, section bg — ΔE>2.3 noticeable, >5 obviously wrong); **pHash/Hamming** (`sharp-phash`) as imagery pre-filter ONLY (never a grade). pixelmatch alone is disqualified.
- **Deterministic HARD-FAIL gates (computed-style, no vision can override):** (a) source has `background-clip:text`+gradient but clone `color` is solid → **gradient-text miss**; (b) `font-family` mismatch → typography fail (our current grader ignores family entirely); (c) per-element **bounding-box IoU < 0.7** → layout fail; (d) effect-presence: source node has `box-shadow`/`background-image`/`filter`/`animation`/`transition`/hover-delta and clone doesn't → **effect miss**; (e) wrong hero image → large LPIPS+Hamming. Any gate trip caps the page ≤60.
- **Vision-judge protocol (defeats LLM leniency/central-tendency bias):** feed **region CROPS** side-by-side (not full frame — a wrong hero gets rationalized in a full screenshot, is obvious alone); **enumerate every concrete difference BEFORE scoring**; **loss-framed** ("start at 100, subtract per listed defect, justify every point NOT subtracted"); ≤5 axes; balanced A/B ordering; "cannot determine → route to review." The judge names *what's* wrong; deterministic metrics *prove* the number. Calibrate against hand-grades periodically.
- **Aggregation:** per-region score = **MIN across its axes**; page score = **MIN across regions**; overall = **MIN across viewports** (desktop 1440 / tablet 768 / mobile 375) — a clone that nails desktop but breaks mobile scores like a broken mobile page. **Output a vector + worst-region + enumerated defect list + hard-fails — never a lone %.** The defect list IS the deliverable; the number is just its min.
- **Pin the environment** (highest-leverage noise reduction): fonts `document.fonts.ready`, animations frozen for the static pass, dynamic content stabilized, fixed headless/viewports.
- Steal from **Applitools' multi-mode philosophy** (Strict/Layout/Content match levels — different signals for different questions), not Backstop/pixelmatch single-diff.

## 5. Capability deep-dives (filled from research)

### 5.1 Effect-aware capture (L1) — ✅ researched
The core fix for our gradient-text class of bug: **read the FULL resolved style set and interpret props JOINTLY**, never trust one prop in isolation.
- **Full extraction:** loop `cs.length`/`cs[i]` over `getComputedStyle(el)` → all ~350 longhands; then interpret. (getComputedStyle returns *resolved* values, so `background-image` holds the real gradient string even when `color` is `transparent`.)
- **Paint-resolution layer (joint interpretation):** if `-webkit-background-clip:text` + `background-image:gradient` → `kind:gradient-text` (reproduce the gradient, NOT the color); `-webkit-text-fill-color` overrides `color` when set; multi-layer `box-shadow`/`text-shadow`; `filter`/`backdrop-filter`/`mix-blend-mode`/`clip-path`/`mask` flagged for custom-CSS when not natively authorable.
- **Pseudo-elements:** `getComputedStyle(el,'::before'/'::after')`; skip `content:none`; promote decorative pseudos (gradient bars, shapes, icons) to real Elementor boxes.
- **Fonts:** after `document.fonts.ready` (+ re-scan post-scroll), iterate `document.fonts` for `status==='loaded'`; harvest `ff.src` (the woff2 to **self-host**), `ff.weight/style/unicodeRange`; intersect each element's family stack to know which actually painted.
- **Imagery:** base64-inline `<img>`/`background-image` (CORS-proxy fallback); serialize inline `<svg>` verbatim (resolve `clip-path:url(#id)` defs); **canvas/WebGL/video → region-screenshot via Playwright** and treat as static image (no tool reproduces WebGL — accept it).
- **Visible-truth pruning:** `el.checkVisibility({opacityProperty,visibilityProperty,contentVisibilityAuto})` + geometry tests (clientRects, 1px/clip/offscreen) per viewport; de-dupe SEO/mobile copies; sort overlaps by z-index *within stacking context*; `document.elementsFromPoint(x,y)` to break ties.
- **Prior-art convergence:** html-to-image/dom-to-image/modern-screenshot/Builder.io all do "clone + inline FULL computed style + recreate pseudo-elements + embed fonts/images." Even best-in-class self-reports **80–90%**; the gap is overwhelmingly *effects + imagery*, not structure → confirms our honest ceiling and where to invest.

### 5.2 Intermediate Representation + clone-tool architecture (L2) — ✅ researched
**The winning pattern (every close tool; the ones that fail skip a step):** `capture (DOM+computed, multi-viewport) → INFER a semantic flex/grid hierarchy (NOT absolute positioning) → a framework-agnostic component/style IR → map to target primitives → refine per-section in a loop.`
- **Reference architectures:** Builder.io Visual Copilot = capture→hierarchy-model→**Mitosis IR**→LLM refine (~75% verified). Locofy = **Large Design Models** + Design-Optimizer→Tagging→**Auto-Components** (dedupe repeats); introduces a **"preview match score"** end-to-end accuracy metric (we should publish ours). TeleportHQ = **UIDL** IR + a visual editor between import and codegen. **Anima = the cautionary tale**: literal absolute-positioning rebuild → visually close, structurally useless/un-editable (the failure mode we must avoid).
- **Our IR (specialize to Elementor):** typed node tree `{role, layoutModel: flex|grid|flow, box, style(full, effect-resolved), styleRef→globalClass, responsiveVariants{tablet,mobile}, states{hover,focus,active}, motion, children}` with two mandatory passes: **component-extraction** (dedupe repeated cards → reusable) and **wrapper-flattening** (stay ≤3 container levels — auto-trees blow past Elementor's practical nesting/perf ceiling). Our element-JSON is the *map target*, not a dump — the IR is the normalize/optimize stage we're missing.
- **Per-section generation, never whole-page:** v0/bolt collapse past ~15–20 components (context loss) → our generator/grader loop must run **per section**.
- **Differentiation vs 10Web** (the direct precedent — "recreate any site" but per-URL, ~5-page cap, no sitemap/links, generic regenerated content, fidelity publicly **untested**): our edges = faithful content/imagery preservation, multi-page+links, a *published measured* fidelity score, and round-trip editability via V4 global classes.

### 5.3 Responsive capture + build (L4/L5) — ✅ researched
- **Data model:** desktop = base key (no suffix); overrides = same key + suffix. **Default 3-viewport model: desktop / `_tablet` (≤1024 max-width) / `_mobile` (≤767 max-width).** Extra breakpoints (`_widescreen` 2400 min-width, `_laptop` 1366, `_tablet_extra` 1200, `_mobile_extra` 880) require the custom-breakpoints experiment.
- **THE key emitter rule:** Elementor cascades max-width, inheriting down (missing `_mobile`→`_tablet`→desktop). **Emit a suffixed key ONLY when it differs from the next-larger breakpoint** — omission = "same as desktop," the correct idiom. Over-emitting is the failure mode (matches our `fill_responsive` opt-in / "cascade handles inheritance" memory).
- **High-leverage overrides (few!):** `flex_direction`→`column` (mobile stacking), child `width`→`100%` (prefer %), section `padding`/`flex_gap` shrink, headline `typography_font_size` shrink, `hide_desktop/_tablet/_mobile` (value = class string `hidden-*`, NOT boolean) for nav↔hamburger swaps.
- **Capture algorithm:** (1) detect SOURCE breakpoints from its media queries (`styleSheets.cssRules` MEDIA_RULE, regex `(max|min)-width:(\d+)px`; try/catch CORS, refetch cross-origin CSS as text); (2) capture computed styles at one width *inside each band* (e.g. 1280/768/375); (3) diff smaller→larger, emit suffixed key only on change; (4) map reflows: flex row→column, width %→100, `display:none`→`hide_*`, appearing element (hamburger)→emit with `hide_desktop`+`hide_tablet`. The rendered computed `display:flex`/`flex-direction`/`gap` IS the "auto-layout constraint" signal (we don't have Figma metadata, but multi-viewport diff substitutes).
- **Absolute positioning is responsive-hostile:** `_position`/`_offset_x/y` have `_mobile` variants, but reserve absolute for **decoration only**, use %/vw offsets, edge-anchor orientation, and `_position_mobile:""` (static) or `hide_mobile` on stack. Content = always flex/flow.
- **GOTCHA:** `_widescreen` is the only min-width breakpoint (inverted cascade) and has confirmed CSS-emission bugs (#33559, #16055, #35108) — **avoid unless the source truly reflows there AND the experiment is verified active**; verify on live frontend, not the editor.

### 5.4 Motion capture + build (L6/L7) — ✅ researched
### 5.4 Motion capture + build (L6/L7) — ✅ researched

**Detect (3-pass scan in `page.evaluate`):**
- **(A) Declared motion** — walk all elements, read computed *longhands* (`animationName`, `animationDuration/Delay/TimingFunction/IterationCount/Direction`, `transitionProperty/Duration/TimingFunction`); `iterationCount:"infinite"` ⇒ marquee/loop. Resolve `@keyframes` bodies via `CSSRule.KEYFRAMES_RULE` (try/catch CORS). **Best single call: `document.getAnimations()`** → each has `.effect.getKeyframes()` + `.getComputedTiming()` + `.timeline` (a `ScrollTimeline`/`ViewTimeline` flags CSS scroll-driven animation — only catchable this way).
- **(B) Runtime scroll-sampling (framework-agnostic workhorse)** — scroll in ~12 steps, double-`rAF` between, snapshot each element's `transform`(parse `matrix()`→translateY)/`opacity`/`filter`/rect; diff the series. Classify: **reveal** = one-shot opacity 0→1 / translate settles, irreversible (confirm via an IntersectionObserver-added class toggling at viewport entry); **parallax** = translate changes monotonically & continuously with scrollY, reverses on scroll-up (rate = Δtransform/ΔscrollY, ~0.05–0.6); **blur-on-scroll**; trigger point = scrollY where change starts (express as % of viewport). Also patch `IntersectionObserver` via `addInitScript` to record observed targets + thresholds.
- **(C) load-entrance** (style settles on a timer w/o scroll) and **hover-motion** (probe hover, diff). Must `page.emulateMedia({reducedMotion:'no-preference'})` or entrances suppress.

**Reproduce — exact Elementor JSON keys** (source-verified; full shapes in `knowledge/ELEMENTOR_PRO_MOTION_EFFECTS.md`):
- Entrance (Free): **`_animation`** (e.g. `"fadeInUp"`) + **`_animation_delay`** (ms). ⚠️ CORRECTION: it's `_animation`/`_animation_delay`, NOT `animation`/`animation_duration` (verified `common-base.php` L838/L865; duration is baked into the Animate.css class — only delay is exposed). **Action: fix ELEMENTOR_PRO_MOTION_EFFECTS.md L496–508.**
- Scrolling (Pro): `motion_fx_motion_fx_scrolling:"yes"` + `motion_fx_motion_fx_translateY/translateX/opacity/blur/rotate/scale/mouse_track/3d_tilt`, each with `direction`/`speed`/`effects_relative_to`/`motion_fx_viewport_anchor:{anchor_start,anchor_end}`. Sticky: `motion_fx_sticky:{...}`. Floating loop (Free): `motion_fx_floating:{motion_type,translate_x/y,rotate_value,scale_value,duration,delay}`.
- **Native ceiling:** motion-fx interpolates LINEARLY (no cubic-bezier on scroll), no multi-phase/pinned/scrollytelling, no synced depth parallax, no stagger. Those → custom `@keyframes` (CSS, continuous-only) or **GSAP+ScrollTrigger escape** (scroll-linked bespoke).

**GSAP escape hatch (no plugin deploy):** inject via HTML widget (page) or Elementor Custom Code → Body End (site). Guard double-init (`window.__joistGsapInit`); `ScrollTrigger.refresh()` on `load`+`resize` (Elementor lazy-load shifts trigger positions); `transition:none!important` on GSAP targets (Elementor's `transition:all` fights inline tweens); trigger off **your own classes**, not generated `.elementor-element-xxxx` IDs; exclude GSAP from caching-plugin JS-defer/combine. (Matches our existing GSAP_ESCAPE_HATCH_SPEC.)

**Fidelity:** ~90–100% automatable for entrance reveals, single-element parallax, opacity/blur/scale-on-scroll, sticky, hover transforms, marquees (detection params map directly). ~50–80% (needs GSAP + hand-tune) for eased scroll mappings, depth parallax, pinned scrollytelling, staggers, split-text, magnetic cursor; WebGL needs a real embed. **Honest ceiling: ~75% native-only / ~90% with GSAP on motion-heavy sites.**

### 5.5 Hover/state capture + build (L6/L7) — [RESEARCH C — pending]
### 5.5 Hover/state capture + build (L6/L7) — ✅ researched
- **Capture (delta algorithm):** snapshot computed style (longhands) at rest → `locator.hover()` (real mouse, fires `:hover` + JS handlers) → **wait `el.getAnimations({subtree:true})` then `Promise.all(a.finished)`** (Playwright has no transition-wait API) → re-snapshot → diff. **Snapshot `::before`/`::after` AND all descendants** (group/parent hover `:hover .child` is the #1 miss — visible change is on a child). Repeat for focus (`locator.focus()`, also `:focus-visible`) and active (`mouse.down()`, real press). Capture `transition-duration/timing/delay` from the REST snapshot (source-of-truth timing). Find non-obvious targets by scanning `styleSheets` for `:hover`/`:focus` selectors. Chromium only (cross-engine getComputedStyle shorthand differences).
- **Reproduce — verified Elementor `_hover` keys:** Button (in button-trait): `hover_color`, `button_background_hover_color`, `button_hover_border_color`, `hover_animation` (Hover.css presets: grow/pulse/float/…), `button_hover_transition_duration` (seconds). Container groups on `{{WRAPPER}}:hover`: `background_hover_*`, `border_hover_*`, `box_shadow_hover_box_shadow`, `css_filters_hover_*`. Transform-on-hover: `_transform_translateY_effect_hover`/`_scale_effect_hover`/etc. **+ the matching `_transform_*_popover_hover:"transform"` toggle (required to enable) + `_transform_transition_hover` (ms)** — this is the faithful path for card-lift & image-zoom.
- **Native vs custom_css:** native covers color/bg/border/shadow swaps, scale/translate/rotate, presets, filters. **custom_css required** for: group/parent hover (`:hover .child`), pseudo-element animations (underline sweep), custom easing/`transition-delay`/different in-out durations, `background-position`/`background-size` animation, cursor/magnetic effects (also need JS → outside the editable envelope).

### 5.6 Elementor capability ceiling + editable-vs-exact verdict — ✅ researched
- **Layout:** Flexbox Containers (1D) + Grid Containers (2D); map source flex→Flex, CSS grid→Grid. Containers cut DOM 50–70% vs legacy sections. **Keep ≤3 nesting levels** (perf/maintainability ceiling — normalizer must flatten redundant wrappers).
- **V4 atomic / CSS-first (default ~Apr 2026; beta 3.35):** single-DIV wrappers + **styles in a global Classes system + Variables + Components** (not inline). Major lever — emit a **design-system of global classes + variables**, apply by class → smaller DOM, real editability, one-place restyle. Adopt this as the build target.
- **Native escape-hatch zone (CANNOT do natively):** rich/sequenced/scroll-triggered/eased motion, cursor effects, child-node targeting, `background-position` animation, custom easing → **custom CSS/JS or GSAP**. Even native parallax has a browser-inconsistent easing artifact (#7804, #13671).
- **THE HONEST VERDICT:** *"pixel-perfect AND fully native-editable" is NOT simultaneously achievable for any non-trivial site — there is an inherent tradeoff.* Every credible source converges: **~85–95% is the realistic professional ceiling even by hand.** Static layout/type/color/spacing clones to ~90% natively (Elementor's strength); **motion + bespoke micro-interactions live outside the native authoring surface**, so reproducing them injects custom CSS/JS, which erodes "fully editable in the visual panel." Our prior Stripe ~65% and ~90% targets are *consistent with reality, not pessimism.* The product decision: maximize the editable-native fidelity, isolate the unavoidable escape-hatch into clearly-flagged custom-code blocks, and **report honestly which parts are editable vs injected.**

## 6. Phased build plan

Sequenced strictly by the dependency graph (§3). **Every phase is gated by the honest grader (Phase 0) on a BASKET of ~5 diverse test sites, not just Stripe** — generality is the bar, not Stripe-tuning.

- **Phase 0 — Honest grader (L0) [BUILD FIRST].** Rebuild `grade.mjs` per §4: per-region × per-viewport, **MIN-not-mean** aggregation, deterministic computed-style **hard-fail gates** (gradient-text, font-family, IoU<0.7, effect-presence, wrong-image), perceptual stack (LPIPS+MS-SSIM via Python sidecar, CIEDE2000 via culori), enumerate-then-penalize **vision-judge on region crops**, output a defect-vector not a lone %. *Exit:* it scores our existing v4 Stripe page HONESTLY (catches the wave/font/effect gaps the eye sees) and its number tracks a hand-grade on the test basket. Nothing else is trusted until this exists.
- **Phase 1 — Effect-aware capture (L1).** Rewrite capture per §5.1: full computed style + joint effect interpretation (gradient-text!), pseudo-elements, `document.fonts` self-host, visible-truth pruning, canvas/WebGL region-capture. *Exit:* capture of Stripe hero correctly records the gradient headline + real söhne + pseudo decorations (no garbage fallback color).
- **Phase 2 — Intermediate Representation (L2).** Normalize capture → typed flex/grid component+style tree (§5.2) with component-extraction + wrapper-flatten (≤3 levels). *Exit:* IR round-trips a test site's structure; repeated cards dedupe to one component.
- **Phase 3 — Precision build from IR (L3).** Map IR → Elementor (V4 global classes + variables where available; native widgets; custom_css escape for gradient-text/effects; self-hosted fonts), per-section, paced writes, fresh page. *Exit:* honest grader ≥ target on desktop-static for the test basket.
- **Phase 4 — Responsive (L4/L5).** Multi-viewport capture + media-query breakpoint detection + smaller→larger diff → minimal `_tablet`/`_mobile` overrides + `hide_*` swaps (§5.3). *Exit:* honest grader's mobile/tablet viewport scores clear target.
- **Phase 5 — Motion + hover (L6/L7).** Detect (3-pass scan / hover-delta) + reproduce (`_animation`/`motion_fx_*`/`_hover` keys + GSAP escape for bespoke) (§5.4, §5.5). *Exit:* grader's motion/hover dimensions clear target; escape-hatch blocks clearly flagged.
- **Cross-cutting:** fold each capability into the agent-side product (joist-clone skill + knowledge + toolkit) as it lands; mirror to plugin CloneGenerator.php when deployable. Publish the grader's "fidelity score" as the product's honest metric (the 10Web differentiation).

## 7. The honest north star
True literal 1:1-on-every-axis-while-fully-editable is not achievable for bespoke sites (the research is unanimous: ~85–95% pro ceiling, motion forces escape hatches). What IS achievable and what we commit to: **a clone that a designer comparing tabs cannot quickly distinguish on the static + responsive axes (~90%+), with motion/hover reproduced via flagged escape-hatches, and a grader honest enough that its number never exceeds what the eye sees.** The grader (Phase 0) is the keystone — it is what stops us fooling ourselves and makes every subsequent phase measurable.
