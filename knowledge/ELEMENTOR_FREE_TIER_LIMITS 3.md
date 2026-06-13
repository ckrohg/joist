# Elementor FREE-tier limits that silently degrade Joist clones

@purpose Verified map (CEK build-research wave, 2026-06-06; Elementor 3.27–3.35 / V4 beta) of what
silently breaks when a Joist clone lands on **free** Elementor instead of Pro. Joist's own target is
Hello+**Pro** ([[architecture_decisions]]), so none of this bites us today — but it's the guard list for
ever serving free-tier users, and it corrects two things the claude-elementor-kit got wrong.

## The silent-degradation table

| Joist emits | Free Elementor reality | Guard |
|---|---|---|
| **Page-level `custom_css`** (our escape hatch: fonts, RAM-grid CSS, nav fallback, Fluent theming) | **PRO-ONLY.** Free Elementor has **no** page Custom CSS field and no Custom Code area. Anything we write to page `custom_css` is **silently dropped on free.** | Inject page CSS via child-theme stylesheet / a Custom-CSS plugin / `wp_head`, NOT Elementor's field. **This is the biggest free-tier gap** — most of our fidelity rides on the CSS hatch. |
| **Per-element `custom_css`** (node settings) | PRO-ONLY (Advanced → Custom CSS). Silently dropped on free. | Strip per-element `custom_css` on free; re-route to the page-level mechanism above. |
| `container_type:'grid'` card rows | **FREE core** (since 3.13, matured 3.27) — but (a) **experiment-gated** on older installs (Settings → Features), and (b) native grid is **fixed column-count per breakpoint; cannot emit `repeat(auto-fit, minmax())`**. | Probe the grid experiment at build time. If off/uncertain, **downgrade to a Flexbox container** (`flex-wrap:wrap` + `min-width`/`flex-basis` on children) — wraps responsively, no Pro/auto-fit dependency. |
| `nav-menu` widget | **PRO-ONLY** (won't register on free; renders nothing). Joist already Pro-gates this. | Free fallback: HFE **`navigation-menu`** widget (free; `menu` setting takes the menu **slug**) if HFE present, else a Flexbox row of link Buttons. |
| `form`, `posts`, `loop-grid` | PRO-ONLY; node won't register. | Substitute: Button CTA for forms (or Fluent Forms via `shortcode` — see [[../knowledge/FORMS_AUTHORING.md]]); manually-authored card grid for posts/loop. |
| Motion Effects / Sticky | PRO-ONLY. | Already routed through the free GSAP+HTML-widget escape hatch — keep doing that; never write Elementor Motion settings on free. |

**Free-safe widgets** (no guard needed): heading, text-editor, button, image, icon, divider, spacer,
video, social-icons, icon-list, star-rating, html, image-box, icon-box, counter, progress-bar, alert,
google-maps, image-gallery, nested-tabs, nested-accordion, image-carousel. All of Joist's currently-emitted
widgets are free-safe **except** the CSS-hatch dependency above.

## Two kit corrections (verified)

1. **Core has no `[wp_nav_menu]` shortcode.** `wp_nav_menu()` is a PHP template function, not a registered
   shortcode — the kit's "render nav via `[wp_nav_menu]` shortcode" doesn't work out of the box. Options:
   the free HFE `navigation-menu` widget, or register our own `[joist_nav_menu]` shortcode wrapping
   `wp_nav_menu(['menu'=>X,'container'=>''])`. The robust free path is the HFE widget (real editable menu).
2. **Page Custom CSS is Pro**, so on free Elementor the kit's (and our) page-`custom_css` approach is
   itself unavailable — must inject via theme/plugin/`wp_head`.

## How to apply

Add a free/Pro capability guard keyed on `joist_get_site_info` Pro-detection. When target is FREE:
downgrade grid→flex, never emit nav-menu/form/posts/loop-grid, strip per-element & page custom_css and
re-route, keep motion on the GSAP hatch, and emit a **per-clone "degraded-on-free" report** so fidelity
loss is visible, not silent. Scoped in [[../knowledge/CEK_AUDIT_STEAL_PLAN.md]] (currently a documented
guard, not yet wired into the eval builders — they assume Pro).
