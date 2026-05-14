# Joist Widget Pack — v0.9 work-stream spec

**Date:** 2026-05-13. **Status:** spec draft (no code yet). **Targets:** v0.9 (~weeks 11–13 of the v1 timeline).

The Widget Pack is the set of custom Elementor widgets + extensions Joist ships to break Elementor's structural walls. It's the prerequisite for the clone-pipeline's **90%+ native fidelity** target. Without it, the conversion has nowhere to land for 8 common-on-Awwwards patterns; with it, the realistic native-fidelity ceiling moves from ~85% to ~95%.

This is also a meaningful product evolution: Joist becomes a *parallel capability layer to Elementor Pro*, not just an editing backbone.

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

### 2.1 Subgrid toggle (extension on Grid Container)

CSS `subgrid` ships in all modern browsers (Chrome 117+, Safari 16+, Firefox 71+) — Elementor's Grid container just doesn't expose it in the GUI.

**Form:** Container extension. Adds a responsive `joist_subgrid` toggle that, when on, emits `grid-template-columns: subgrid; grid-template-rows: subgrid;` on the inner container via Elementor's selector token system.

**Public surface:**
- Container responsive control `joist_subgrid` (boolean, off by default)
- When parent is a Grid container, the child can opt into inheriting its tracks

**Implementation sketch:**
- `src/WidgetPack/Subgrid/SubgridControl.php` — registers the control via `elementor/element/container/section_grid_layout_container/after_section_end`
- `src/WidgetPack/Subgrid/Renderer.php` — hooks `elementor/element/parse_css` to emit the CSS

**Runtime cost:** 0KB (pure CSS via Elementor's existing CSS pipeline).
**LOC estimate:** ~50 PHP.
**Native fidelity:** 100%.

### 2.2 Pin-Scroll Container (custom widget)

Apple-product-page-style: section pins to viewport while inner content scrolls horizontally as user scrolls vertically.

**Public surface:**
- Widget name: `joist-pin-scroll`
- Settings: `horizontal_distance` (default 100%vw × N children), `easing` (linear / ease-out / spring), `pin_duration` (number of viewport-heights to pin)
- Inner children render as flex-row with auto-sized items; outer wrapper has `position: sticky; height: 100vh; overflow: hidden;`
- Children authored as Elementor inner containers — full Elementor editing of pinned content

**Implementation sketch:**
- `src/WidgetPack/PinScroll/Widget.php` — registers `joist-pin-scroll`; uses container's nested children
- `src/WidgetPack/PinScroll/render.js` — IntersectionObserver + scroll-progress listener; translates inner wrapper via `transform: translate3d()`. Uses CSS `animation-timeline: scroll()` (Chrome 115+, Safari 17+) where supported; vanilla JS fallback for older Safari.
- ~3KB minified JS, lazy-loaded only when widget is present (Elementor's `wp_enqueue_scripts` per-widget pattern)

**Runtime cost:** 3KB JS (lazy).
**LOC estimate:** ~150 PHP + ~3KB JS source.
**Native fidelity:** 100%.

### 2.3 View Transitions runtime (site-wide) + Toggle widget

The View Transitions API (`document.startViewTransition`) lets WordPress pages feel SPA-smooth between navigations. Same-page transitions for accordions/tabs.

**Public surface:**
- Site-wide setting: `joist_view_transitions_enabled` (default off; on adds the navigation hook)
- Widget: `joist-view-transition-toggle` wrapping tabs/accordions with the API call
- Auto-stamps `view-transition-name` from Elementor element IDs

**Implementation sketch:**
- `src/WidgetPack/ViewTransitions/Runtime.php` — enqueues `view-transitions.js` site-wide when the option is on; admin toggle in Joist settings page
- `src/WidgetPack/ViewTransitions/runtime.js` — Navigation API hook (Chrome 102+), intercepts internal `<a>` clicks, calls `document.startViewTransition()`, fetches via `fetch()` + `DOMParser`, swaps `<main>` content. Degrades to instant nav on unsupported browsers (which is fine — no regression).
- `src/WidgetPack/ViewTransitions/ToggleWidget.php` — Tabs/Accordion wrapper widget

**Runtime cost:** 5KB JS (site-wide when enabled).
**LOC estimate:** ~330 PHP + ~5KB JS source.
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

### 2.8 Display-swap extension on Container

Per-breakpoint `display` value — flex on desktop, grid on tablet/mobile (or vice versa). The current Container "Layout" control is single-value.

**Public surface:**
- Container responsive control `joist_display_mode` with values `flex` / `grid` / `block` per breakpoint
- Resolves cross-mode property conflicts (justify-content vs grid-template) by emitting properties scoped to active mode at each breakpoint

**Implementation sketch:**
- `src/WidgetPack/DisplaySwap/Extension.php` — registers the responsive control after Elementor's existing Layout section
- Emits CSS via `elementor/element/parse_css` filter that, per breakpoint, sets `display:` and namespaces conflicting properties

**Runtime cost:** 0KB (pure CSS).
**LOC estimate:** ~80 PHP.
**Native fidelity:** 100%.

---

## 3. Roll-up

| Capability | Form | LOC | Bundle size |
|---|---|---|---|
| Subgrid toggle | Container extension | ~50 PHP | 0KB |
| Pin-Scroll | Custom widget | ~150 + 3KB JS | 3KB lazy |
| View Transitions | Site-wide runtime + widget | ~330 + 5KB JS | 5KB site-wide if enabled |
| Variable Heading | Custom widget | ~120 + 1.5KB JS | 1.5KB lazy |
| Masonry Grid | Custom widget | ~100 + 4KB JS | 0–4KB |
| Morph SVG | Custom widget + lazy Flubber | ~90 + 6KB JS | 0–6KB lazy |
| Reparent | Optional runtime + control | ~80 + 0.6KB JS | 0.6KB conditional |
| Display-swap | Container extension | ~80 | 0KB |
| **Total** | | **~1,000 LOC PHP, ~20KB JS sources** | **~15KB worst-case page bundle** |

**Worst-case page weight contribution** (all 8 capabilities present): ~15KB minified compressed. Typical page (~2 widgets from the pack): ~5KB. Negligible.

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
        \Joist\WidgetPack\Subgrid\SubgridControl::init();
        \Joist\WidgetPack\DisplaySwap\Extension::init();
        \Joist\WidgetPack\Reparent\Control::init();
        // site-wide runtime
        \Joist\WidgetPack\ViewTransitions\Runtime::init();
    }

    public static function registerWidgets($widgets_manager): void {
        $widgets_manager->register(new \Joist\WidgetPack\PinScroll\Widget());
        $widgets_manager->register(new \Joist\WidgetPack\ViewTransitions\ToggleWidget());
        $widgets_manager->register(new \Joist\WidgetPack\VariableHeading\Widget());
        $widgets_manager->register(new \Joist\WidgetPack\Masonry\Widget());
        $widgets_manager->register(new \Joist\WidgetPack\MorphSVG\Widget());
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

## 6. Roadmap & dependencies

| Wave | Capability | Reason for order |
|---|---|---|
| v0.9-α | Pin-Scroll, Variable Heading, Display-swap | High-fidelity-impact, scoped, single-widget patterns |
| v0.9-β | Masonry Grid, Subgrid toggle | Layout primitives — both clone-pipeline-critical |
| v0.9-γ | Morph SVG, Reparent, View Transitions | Highest-complexity / largest runtime; ship last |

Each wave is ~3–5 days of focused work. Total Widget Pack delivery: ~2–3 weeks.

**Hard dependencies (must land before):**
- Elementor 3.21+ (current minimum) — Grid container w/ col/row span
- Joist `WidgetCatalog` schema introspection — already in v0.5

**Soft dependencies (improves quality, not blocking):**
- CSS `animation-timeline` Chrome ≥ 115, Safari ≥ 17 — progressive enhancement
- CSS Grid Level 3 `masonry` value — eventual transparent upgrade

---

## 7. Testing strategy

- Unit tests for each PHP widget's `register_controls` and `render` methods (PHPUnit, headless WP via `wp-env`)
- Schema-introspection tests — each Pack widget's schema returns expected breakpoints/controls
- Visual regression tests via Playwright — for each widget, render a fixture page, screenshot, diff against committed baseline at desktop/tablet/mobile viewports
- Lazy-load assertion — fixture page without any Pack widget should NOT enqueue Pack JS
- Browser compatibility matrix — Chrome 117+, Safari 16+, Firefox 71+ for "modern", Safari 14 / Chrome 100 for "fallback"

---

## 8. What this unlocks for the clone pipeline

With Widget Pack shipped, **CLONE_PIPELINE.md §X (Elementor expressive ceiling)** drops from 8 structural walls to 2:

| Wall | Status with Widget Pack |
|---|---|
| Subgrid | ✅ Joist Subgrid toggle |
| Scroll-driven horizontal pin | ✅ Joist Pin-Scroll widget |
| View Transitions | ✅ Joist View Transitions runtime + widget |
| Variable-font axis scroll | ✅ Joist Variable Heading widget |
| True masonry | ✅ Joist Masonry Grid widget |
| Animated SVG morph | ✅ Joist Morph SVG widget |
| DOM reparenting | ✅ Joist Reparent (or duplicate-and-hide fallback) |
| Flex↔grid swap | ✅ Joist Display-swap extension |
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
