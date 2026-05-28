# Joist Widget Pack — v0.9 work-stream spec

**Date:** 2026-05-13. **Last updated:** 2026-05-26 (Wave 0 web-platform recheck). **Status:** spec draft; Pin-Scroll shipped 2026-05-13. **Targets:** v0.9 (~weeks 11–13 of the v1 timeline).

The Widget Pack is the set of custom Elementor widgets + extensions Joist ships to break Elementor's structural walls. It's the prerequisite for the clone-pipeline's **90%+ native fidelity** target. Without it, the conversion has nowhere to land for common-on-Awwwards patterns; with it, the realistic native-fidelity ceiling moves from ~85% to ~95%.

This is also a meaningful product evolution: Joist becomes a *parallel capability layer to Elementor Pro*, not just an editing backbone.

## 2026-05-26 web-platform recheck — what changed

The May 2026 baseline-status review (Wave 0 Stream C) verified per-widget viability against current cross-browser support. Net changes:

- **DELETED:** §2.1 Subgrid toggle — CSS Subgrid Baseline Widely Available 2026-03-15; Elementor 3.26+ exposes native subgrid switches. Plan-Mode mapping flips the existing Elementor control instead.
- **SIMPLIFIED:** §2.3 View Transitions runtime — Chrome 147 shipped element-scoped `startViewTransition()`. The JS runtime broker collapses to a ~10-line CSS emitter.
- **SIMPLIFIED:** §2.8 Display-swap — name-only `@container` queries shipped Firefox 149 + Safari 26.4 (March 2026). Container-query CSS handles the entire pattern. ~30 LOC of generated CSS, no JS, no conflict-matrix.
- **ADDED:** §2.9 Anchored Pop — Anchor Positioning hit Baseline 2026. Pure-CSS tooltips/dropdowns/callouts/sticky labels tethered to any other widget. Biggest current "browsers have it, Elementor doesn't" gap.
- **AMENDED:** §2.2 Pin-Scroll — Chrome 145+ ships declarative `timeline-trigger` / `animation-trigger`; add `@supports (timeline-trigger: --t)` gate.

Pack count remains 8 (Subgrid out, Anchored Pop in). See [[wave-0-synthesis-2026-05-26]] §4 for full reasoning.

---

## 1. Goals & non-goals

### Goals
- Native Elementor-citizen widgets for 8 capabilities Elementor doesn't natively express
- ~1,000 LOC PHP + ~15KB JS bundle baseline (lazy-loaded per widget detection)
- Each widget editable in the Elementor UI like any first-party widget
- Schema-introspectable via Joist's WidgetCatalog (constraints #1, #24, #29 still apply)
- No external runtime dependencies (no GSAP, no Lottie) — Joist owns the runtime
- Progressive enhancement: use modern CSS where browsers support it, JS fallback otherwise

### Non-goals
- Not a general-purpose Elementor addon competing with Crocoblock/PowerPack/etc. — these are *specifically* the patterns our clone pipeline needs
- Not a theme builder — Theme Builder remains Elementor Pro's domain
- Not custom blocks for the Gutenberg editor — Elementor-only
- No third-party widget compatibility shims — JetEngine etc. continue to work alongside, not through, Joist

---

## 2. The 8 capabilities

### 2.1 ~~Subgrid toggle~~ — REMOVED 2026-05-26

CSS Subgrid hit **Baseline Widely Available 2026-03-15** (~92%+). Elementor 3.26+ exposes native subgrid switches on Container/Section. We no longer ship a widget for this — the Joist Plan-Mode mapping layer flips the existing Elementor control directly.

What replaces this slot: §2.9 Anchored Pop.

### 2.2 Pin-Scroll Container (custom widget — SHIPPED 2026-05-13)

Apple-product-page-style: section pins to viewport while inner content scrolls horizontally as user scrolls vertically.

**Public surface:**
- Widget name: `joist-pin-scroll`
- Settings: `horizontal_distance` (default 100%vw × N children), `easing` (linear / ease-out / spring), `pin_duration` (number of viewport-heights to pin)
- Inner children render as flex-row with auto-sized items; outer wrapper has `position: sticky; height: 100vh; overflow: hidden;`
- Children authored as Elementor inner containers — full Elementor editing of pinned content

**Implementation sketch (shipped):**
- `plugin/src/WidgetPack/PinScroll/Widget.php` — registers `joist-pin-scroll`; uses container's nested children
- `plugin/assets/widget-pack/pin-scroll/pin-scroll.js` — IntersectionObserver + scroll-progress listener; translates inner wrapper via `transform: translate3d()`
- `plugin/assets/widget-pack/pin-scroll/pin-scroll.css` — CSS `animation-timeline: scroll()` first, with `@supports` gate, JS fallback otherwise

**2026-05-26 amendment:** Chrome 145+ ships declarative `timeline-trigger` and `animation-trigger` — replaces IntersectionObserver for pin/unpin. Add `@supports (timeline-trigger: --t)` branch that drops JS payload for Chrome users; keep JS fallback for Safari/Firefox until they ship triggers. ~50 LOC CSS delta to Pin-Scroll asset, ~0 PHP delta.

**Runtime cost:** 3KB JS (lazy) → ~1.5KB on Chrome with new gate.
**LOC estimate:** ~150 PHP + ~3KB JS source (shipped).
**Native fidelity:** 100%.

### 2.3 View Transitions — thin opt-in CSS emitter (SIMPLIFIED 2026-05-26)

Cross-document View Transitions hit 85.5% global support (Chrome 126+, Safari 18.2+, Firefox 144+ partial). **Chrome 147 also shipped element-scoped `element.startViewTransition()`** — meaning per-widget transitions don't need a runtime broker anymore.

The widget collapses to a thin Elementor control that emits CSS — no JS module. Pure progressive enhancement: works where supported, no-op elsewhere.

**Public surface:**
- Site-wide setting: `joist_view_transitions_enabled` (default off; emits `@view-transition { navigation: auto }` in site CSS when on)
- Widget: `joist-view-transition-name` — minimal control that stamps `view-transition-name: <slug>` on the chosen element via Elementor's selector token system; optional `view-transition-class` for grouping

**Implementation sketch:**
- `src/WidgetPack/ViewTransitions/Emitter.php` — registers the site-wide setting + per-element control; hooks `elementor/element/parse_css` to emit `view-transition-name` / `view-transition-class` and the site-level `@view-transition` at-rule
- Optional ~10-line CSS template for default transition timing
- **No JS runtime.** Browsers without support degrade to instant nav (no regression).

**Runtime cost:** 0KB JS, ~200 bytes site-wide CSS when enabled.
**LOC estimate:** ~50 PHP (down from ~330).
**Native fidelity:** 100% (with progressive degradation).

### 2.4 Variable Heading (custom widget)

Variable-font axis animation tied to scroll position. The Pangram-Pangram-on-Awwwards effect.

**Public surface:**
- Widget name: `joist-variable-heading`
- Settings: `text`, `font_family`, `axis` (`wght` / `opsz` / `wdth` / `slnt` — read from the loaded font's `fvar` table), `from_value`, `to_value`, `trigger` (`viewport-progress` / `viewport-enter` / `hover` / `scroll-progress-of-parent`), `easing`
- Renders as `<h*>` with `font-variation-settings` updated via JS bound to IntersectionObserver + scroll listener

**Implementation sketch:**
- `src/WidgetPack/VariableHeading/Widget.php` — registers widget, validates axis is present in the loaded font
- `src/WidgetPack/VariableHeading/render.js` — Uses CSS `animation-timeline: view()` where supported; JS scroll listener fallback. Reads `font.fvar` axes via the CSS Font Loading API.
- Bundle size minimized — no font parsing in production, just reads axis range from a config baked into the widget settings at editor time

**Runtime cost:** 1.5KB JS (lazy).
**LOC estimate:** ~120 PHP + ~1.5KB JS source.
**Native fidelity:** 100%.

### 2.5 Masonry Grid (custom widget — Loop-Grid alternative)

Pinterest-style variable-height packing. Elementor's Loop Grid is row-based and leaves gaps under shorter items.

**Public surface:**
- Widget name: `joist-masonry-grid`
- Same query controls as Loop Grid (post_type, posts_per_page, taxonomy filters)
- Settings: `columns` (responsive), `gap` (responsive), `mode` (`css-columns` / `precise`)

**Implementation sketch:**
- `src/WidgetPack/Masonry/Widget.php` — registers widget, query subsystem reuses Elementor's WP_Query wrapping
- **`mode: css-columns`** (default, lighter): renders inner container with `column-count: var(--joist-cols); column-gap: var(--joist-gap);` — works everywhere, source-order preserved, ~0KB runtime
- **`mode: precise`** (opt-in for exact packing): bundles ~4KB Bricks.js-style positioner (vanilla JS, no jQuery) that runs after image load, positions absolutely. Re-runs on resize via ResizeObserver
- Progressive enhancement: when CSS Grid Level 3 `grid-template-rows: masonry` ships (Firefox-only in May 2026, Chrome landing), switch transparently

**Runtime cost:** 0KB default (CSS columns), 4KB if `mode: precise`.
**LOC estimate:** ~100 PHP + ~4KB JS source for precise mode.
**Native fidelity:** 100%.

### 2.6 Morph SVG (custom widget)

Smooth path-to-path SVG morphs for brand identity flourishes and hero illustrations.

**Public surface:**
- Widget name: `joist-morph-svg`
- Settings: `path_from`, `path_to`, `viewBox`, `fill`, `stroke`, `stroke_width`, `trigger` (`hover` / `viewport-enter` / `scroll-progress` / `autoplay-loop`), `duration_ms`, `easing`

**Implementation sketch:**
- `src/WidgetPack/MorphSVG/Widget.php` — registers widget, renders inline `<svg>` with the `from` path
- `src/WidgetPack/MorphSVG/render.js` — checks path point counts. If matching: pure CSS `path()` transitions (free, 0KB). If mismatched: lazy-loads Flubber (~6KB) for arbitrary path interpolation. Lazy-load means a page that uses only matched-count paths pays zero runtime cost.
- Editor preview shows the `to` path on hover so the designer can pre-visualize

**Runtime cost:** 0KB for matched-count paths, 6KB lazy for arbitrary.
**LOC estimate:** ~90 PHP + ~6KB Flubber bundle (lazy).
**Native fidelity:** 100%.

### 2.7 Reparent (optional runtime + control extension)

DOM reparenting per breakpoint. Joist agent's default behavior is "duplicate-and-hide" (industry standard); this widget is for users who need single-source-of-content with structural reflow.

**Public surface:**
- Element control extension (works on any container/widget): `joist_reparent_tablet` and `joist_reparent_mobile` accepting an element ID to reparent into at that breakpoint
- Site-wide runtime that watches matchMedia and moves DOM nodes accordingly
- **Default agent behavior**: emit duplicate-and-hide via Elementor's `hide_desktop`/`hide_tablet`/`hide_mobile` controls. Reparent capability is opt-in per element.

**Implementation sketch:**
- `src/WidgetPack/Reparent/Control.php` — adds the responsive control to the element advanced tab
- `src/WidgetPack/Reparent/runtime.js` — ~600 bytes, matchMedia listener + `parentNode.appendChild()`
- Accessibility safeguard: warns the editor when focus order would change; agent quality-gate flags reparent ops that move focused/interactive elements

**Runtime cost:** 0.6KB JS site-wide if any element on the page uses it; 0KB otherwise.
**LOC estimate:** ~80 PHP + ~0.6KB JS source.
**Native fidelity:** 100% functional, ~95% structural (vs. perfect reparent that would require server-side viewport detection — out of scope).

### 2.8 Display-swap extension on Container (SIMPLIFIED 2026-05-26)

Per-breakpoint `display` value — flex on desktop, grid on tablet/mobile (or vice versa). The current Container "Layout" control is single-value.

**2026-05-26 simplification:** Container queries have been Baseline since 2023, and name-only `@container` queries shipped Firefox 149 + Safari 26.4 (March 2026). The entire pattern collapses to ~30 LOC of generated CSS — no conflict-matrix needed at runtime, because container queries scope the per-mode property block automatically.

**Public surface:**
- Container responsive control `joist_display_mode` with values `flex` / `grid` / `block` per breakpoint

**Implementation sketch:**
- `src/WidgetPack/DisplaySwap/Extension.php` — registers the responsive control after Elementor's existing Layout section
- Emits `@container name (min-width: <bp>) { display: <mode>; /* mode-scoped properties */ }` blocks via `elementor/element/parse_css` filter

**Runtime cost:** 0KB (pure CSS).
**LOC estimate:** ~30 PHP (down from ~80).
**Native fidelity:** 100%.

### 2.9 Anchored Pop (NEW 2026-05-26 — replaces Subgrid slot)

Anchor Positioning hit **Baseline 2026** (Chrome 125+, Safari 26+, Firefox 147+ since Jan 13, 2026, ~83% global). Elementor exposes **nothing** for `position-anchor` / `anchor()` / `@position-try`. This is the single biggest "browsers have it, Elementor doesn't" gap right now.

Pure-CSS tooltips, dropdowns, callouts, sticky labels tethered to any other widget — without JS, without absolute-positioning gymnastics, without `position: sticky` workarounds.

**Public surface:**
- Widget name: `joist-anchored-pop`
- Settings: `anchor_target` (element selector or sibling-ref), `position` (`top` / `right` / `bottom` / `left` / `top-start` / etc., 12 named positions), `offset` (responsive distance from anchor), `fallback_position` (one or more `@position-try` alternatives), `auto_arrow` (boolean, draws CSS-only triangle pointing at anchor)
- Optionally tied to `:popover-open` for click-to-open behavior (Baseline 2024)
- Inner content authored as Elementor inner container — full Elementor editing of the pop content

**Implementation sketch:**
- `src/WidgetPack/AnchoredPop/Widget.php` — registers `joist-anchored-pop`; renders as `<div popover>` + anchor-positioning CSS
- `src/WidgetPack/AnchoredPop/render.php` — emits inline-scoped CSS: `position-anchor: --<id>; position-area: <position>; position-try-fallbacks: <list>;`
- Editor preview shows the pop fixed-open so the designer can edit its content
- No JS — `popover` attribute drives open/close behavior natively

**Runtime cost:** 0KB JS, ~150 bytes CSS per instance.
**LOC estimate:** ~120 PHP + 0 JS.
**Native fidelity:** 100% on Baseline-2026 browsers; degrades to inline-positioned content elsewhere (no regression).

**Why this is the right swap for Subgrid:** Subgrid was a control-exposure problem (Elementor had the data model). Anchored Pop is a missing-capability problem (Elementor has no equivalent at any layer). Strictly higher leverage.

---

## 3. Roll-up (updated 2026-05-26)

| Capability | Form | LOC | Bundle size |
|---|---|---|---|
| ~~Subgrid toggle~~ | — | — | — (DELETED — Elementor native) |
| Pin-Scroll (shipped) | Custom widget | ~150 + 3KB JS | 3KB lazy; ~1.5KB on Chrome with `@supports` gate |
| View Transitions | Thin CSS emitter | ~50 PHP | 0KB JS, ~200B CSS |
| Variable Heading | Custom widget | ~120 + 1.5KB JS | 1.5KB lazy |
| Masonry Grid | Custom widget | ~100 + 4KB JS | 0–4KB |
| Morph SVG | Custom widget + lazy Flubber | ~90 + 6KB JS | 0–6KB lazy |
| Reparent | Optional runtime + control | ~80 + 0.6KB JS | 0.6KB conditional |
| Display-swap | Container extension | ~30 | 0KB (CQ only) |
| **Anchored Pop** | Custom widget | ~120 + 0 JS | 0KB JS, ~150B CSS/instance |
| **Total** | | **~740 LOC PHP, ~15KB JS sources** | **~12KB worst-case page bundle** |

**Worst-case page weight contribution** (all 8 capabilities present): ~12KB minified compressed (was ~15KB). Typical page (~2 widgets from the pack): ~3KB. Negligible.

The 2026-05-26 deltas reduce PHP LOC by ~260 (Subgrid removed, View-Transition + Display-swap simplified, Anchored Pop added) and reduce worst-case JS by ~5KB (View-Transition runtime broker removed).

---

## 4. Architecture: how widgets register into Elementor

Standard pattern:

```php
// src/WidgetPack/PackBootstrap.php
final class PackBootstrap {
    public static function init(): void {
        add_action('elementor/widgets/register', [self::class, 'registerWidgets']);
        add_action('elementor/elements/categories_registered', [self::class, 'registerCategory']);
        // extensions
        \Joist\WidgetPack\DisplaySwap\Extension::init();
        \Joist\WidgetPack\Reparent\Control::init();
        \Joist\WidgetPack\ViewTransitions\Emitter::init();
    }

    public static function registerWidgets($widgets_manager): void {
        $widgets_manager->register(new \Joist\WidgetPack\PinScroll\Widget());
        $widgets_manager->register(new \Joist\WidgetPack\VariableHeading\Widget());
        $widgets_manager->register(new \Joist\WidgetPack\Masonry\Widget());
        $widgets_manager->register(new \Joist\WidgetPack\MorphSVG\Widget());
        $widgets_manager->register(new \Joist\WidgetPack\AnchoredPop\Widget());
        // ViewTransitions ships as an extension/emitter, not a widget
    }

    public static function registerCategory($elementsManager): void {
        $elementsManager->add_category('joist', [
            'title' => __('Joist', 'joist'),
            'icon' => 'fa fa-plug',
        ]);
    }
}
```

Bootstrap is wired into `Joist\Bootstrap` so Pack registration happens after Elementor loads.

Lazy-loading: each widget's `get_script_depends()` returns a handle registered via `wp_register_script(..., $deps, JOIST_VERSION, true)`. Elementor's frontend asset manifest only enqueues widget scripts when the widget is actually rendered on a page.

---

## 5. Schema introspection

Pack widgets are first-class citizens for Joist's `WidgetCatalog::getSchema()`:

- Each widget's controls are introspected via `widgets_manager->get_widget_types()['joist-pin-scroll']->get_controls()` — same path as Elementor's own widgets
- The agent can `GET /widgets/joist-pin-scroll/schema` like any other widget
- `SchemaValidator` rejects unknown keys on Pack widget settings with the same Levenshtein-1 + `flex_*`-aware suggestions

**Critical implication for the clone pipeline:** the converter can target Joist widgets *with confidence the agent will validate them*. No second class.

---

## 6. Roadmap & dependencies (updated 2026-05-26)

| Wave | Capability | Reason for order |
|---|---|---|
| v0.9-α (shipped 2026-05-13) | Pin-Scroll | Proof-of-pattern; CSS-first w/ JS fallback |
| v0.9-β | Anchored Pop, View Transitions emitter, Display-swap simplification, Pin-Scroll `@supports` gate | Net-new capability + simplifications; all near-zero LOC; ships fast |
| v0.9-γ | Variable Heading, Masonry Grid | Layout primitives + motion proof; share JoistTriggerableHandler |
| v0.9-δ | Morph SVG, Reparent | Highest-complexity / largest runtime; ship last |

Each wave is ~3–5 days of focused work. Total Widget Pack delivery (post Pin-Scroll): ~2 weeks.

**Hard dependencies (must land before):**
- Elementor 3.33–3.34.x (current pin per [[architecture-decisions]]) — Grid container w/ col/row span
- Joist `WidgetCatalog` schema introspection — already in v0.5
- Elementor 4 atomic adapter ([[failure-mode-constraints]] #17) — must land before any Pack widget is shipped against the V4 schema

**Soft dependencies (improves quality, not blocking):**
- CSS `animation-timeline` Chrome ≥ 115, Safari ≥ 17 — progressive enhancement (shipped)
- Chrome 145+ `timeline-trigger` — Pin-Scroll CSS-only fast path
- CSS Grid Level 3 `masonry` — eventual transparent upgrade
- Element-scoped `startViewTransition()` (Chrome 147+) — already accounted for in §2.3

---

## 7. Testing strategy

- Unit tests for each PHP widget's `register_controls` and `render` methods (PHPUnit, headless WP via `wp-env`)
- Schema-introspection tests — each Pack widget's schema returns expected breakpoints/controls
- Visual regression tests via Playwright — for each widget, render a fixture page, screenshot, diff against committed baseline at desktop/tablet/mobile viewports
- Lazy-load assertion — fixture page without any Pack widget should NOT enqueue Pack JS
- Browser compatibility matrix — Chrome 117+, Safari 16+, Firefox 71+ for "modern", Safari 14 / Chrome 100 for "fallback"

---

## 8. What this unlocks for the clone pipeline (updated 2026-05-26)

With Widget Pack shipped, **CLONE_PIPELINE.md (Elementor expressive ceiling)** drops from 10 structural walls to 2:

| Wall | Status with Widget Pack |
|---|---|
| Subgrid | ✅ Native Elementor 3.26+ (no Joist widget needed) |
| Scroll-driven horizontal pin | ✅ Joist Pin-Scroll widget (shipped) |
| View Transitions | ✅ Joist View Transitions emitter |
| Variable-font axis scroll | ✅ Joist Variable Heading widget |
| True masonry | ✅ Joist Masonry Grid widget |
| Animated SVG morph | ✅ Joist Morph SVG widget |
| DOM reparenting | ✅ Joist Reparent (or duplicate-and-hide fallback) |
| Flex↔grid swap | ✅ Joist Display-swap extension |
| Anchor-positioned UI (tooltips, dropdowns, callouts) | ✅ Joist Anchored Pop widget |
| Container queries crossing widget boundaries | ❌ Genuinely unsolvable (Elementor wrapper divs) |
| `:has()` crossing widget boundaries | ❌ Same root cause |

Two unsolvable items remain — both edge cases in marketing pages.

**Native-fidelity ceiling moves from ~85% to ~95% on marketing pages.** Combined with the clone pipeline's multi-pass refinement loop + per-archetype specialized extractors, the 90%+ target becomes architecturally reachable.

---

## 9. Open questions

1. **Should the Widget Pack be a separate plugin or bundled inside the main Joist plugin?** Recommendation: bundled. Splitting adds activation friction (users have to install + activate two plugins); the size is small (~25KB total assets); the conversion pipeline depends on it. Bundle.
2. **Should the View Transitions site-wide hook be on by default?** Recommendation: off by default; surface in Joist setup wizard with a preview. Site-wide JS hooks deserve explicit user consent.
3. **Naming convention for Pack widgets in the Elementor UI?** Recommendation: prefix all with "Joist" (e.g., "Joist Pin-Scroll", "Joist Variable Heading") + dedicated "Joist" category in the widget panel. Clear branding, no confusion with first-party.

To resolve before implementation begins.
