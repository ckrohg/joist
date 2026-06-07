# Elementor Capability Matrix — per building block

<!-- @purpose: Front-loaded reconstruction knowledge for the Joist clone agent. One row per building
block from BUILDING_BLOCK_CURRICULUM.md (all 4 tiers). Tells the evolve/coder agent the right Elementor
mechanism + approach + realistic ceiling per block UPFRONT, so it stops rediscovering Elementor's limits
by trial. Living doc — update as recipes discover new truths. -->

**Date:** 2026-06-02 · **Status:** Reference (living document) · **Audience:** Joist clone/evolve agents.

**Target stack (confirmed):** Hello Elementor theme + **Elementor Pro** (`elementor-pro/v1` REST namespace present) +
WP native Font Library. Production node shape is **V3 widgets** (`container`/`heading`/`text-editor`/…); on a
4.0.x site they nest inside V4 structural elements and V4 auto-fields are stripped on write-back
(see `V4_ATOMIC_NORMALIZATIONS.md`). Atomic content widgets (`e-heading`, `e-paragraph`, …) are declared
upstream but **not yet registered** — do not author them yet.

## Hard constraints that shape every row (read once)

- **`wp_kses` strips `<style>` TAGS on REST save.** A site-wide/page HTML widget that relies on `<style>…</style>`
  is **stripped for the REST user** Joist authors as. What SURVIVES: (1) inline `style="…"` **attributes** inside
  `text-editor`/`html` content, (2) native widget settings (typography/color/spacing/border/etc.), and
  (3) **Elementor Pro per-page Custom CSS** (`_elementor_page_settings.custom_css`) + per-widget Advanced→Custom CSS
  (`custom_css` key) — these are stored as Elementor settings, not page HTML, so kses doesn't touch them.
  ⇒ **All "needs-custom_css" rows route through the per-widget/per-page Pro `custom_css` field, never a `<style>` HTML widget.**
- **Containers ignore `_position: absolute`; widgets honor it.** Put absolute-positioned decoration on a *widget*
  inside a `position:relative` container, not on a child container. Reserve absolute for decoration/badges/overlaps only —
  content always flows (flex/grid). (See LAYOUT_REARCHITECTURE + CLONE_CAPABILITY_SPEC §5.3.)
- **Native Grid container tiles where flex can't.** Use the **Grid container** for true 2D tiling / bento / equal-row
  card grids; use Flex container for 1D rows/stacks. Keep ≤3 nesting levels (Elementor perf/maintainability ceiling).
- **Control-name discipline:** the validator accepts 370–590 keys/widget — failures come from WRONG names, not too few.
  Confirmed corrections: `align` (not `text_align`); `_padding`/`_margin` (not bare `padding`); button `button_text_color`
  (not `text_color`); divider `color`/`weight` (not `divider_color`/`divider_weight`); image radius set on the container,
  not the widget; standalone `icon` widget controls are flaky → prefer Icon List or styled eyebrow text. (WIDGET_CONTROL_CHEATSHEET.)
- **Entrance animation key is `_animation` + `_animation_delay`** (NOT `animation`/`animation_duration`; duration is baked
  into the Animate.css class). Free in all tiers.
- **Numbers are strings**, image URLs HTTPS, links need a `url` key, omit responsive variants that match desktop (CSS cascades).

---

## Tier 1 — Static atoms

| Block | Tier | Elementor mechanism | Approach | V3 vs V4 notes | Gotchas / kses / positioning | Ceiling |
|---|---|---|---|---|---|---|
| heading | 1 | **Heading widget** (`heading`) | native | V3 `heading`; V4 `e-heading` declared, not registered → keep V3 | Use `align` not `text_align`; `header_size` h1–h6; full `typography_*`. Gradient-text headline ⇒ `needs-custom_css` (`background-clip:text`) | **~100%** visual + fully editable |
| paragraph | 1 | **Text Editor widget** (`text-editor`) | native | V3 `text-editor` stores HTML; V4 `e-paragraph` future | Inline `style=""` attrs survive kses (use for inline emphasis/max-width); `text_color` for color | **~100%** |
| button / link | 1 | **Button widget** (`button`) | native | V3 `button`; V4 `e-button` future | `button_text_color` (NOT `text_color`); `hover_color`/`button_background_hover_color` native; `hover_animation` Hover.css presets | **~100%** |
| image | 1 | **Image widget** (`image`) | native | same V3/V4 | Set `border_radius` on the wrapping container, not the widget. Upload to media library (sized variants + alt); never fake CDN URLs | **~100%** |
| icon (svg) | 1 | **Icon widget** (`icon`) — FontAwesome/eicons | native (mostly) | V3 `icon` | Standalone `icon` controls are flaky on this stack — substitute **Icon List** item or inline SVG via `html` widget. Custom brand SVG ⇒ `html` widget (inline `<svg>`) | **~90%** (lib icon) / ~100% via inline-SVG html |
| list (ul/ol) | 1 | **Icon List widget** (`icon-list`) OR `text-editor` `<ul>/<ol>` | native | V3 `icon-list` | Icon List = checkmark/feature lists (per-item icon + text). Plain prose list ⇒ `<ul>` inside text-editor. `space_between`/`icon_color` | **~100%** |
| blockquote | 1 | **Text Editor** `<blockquote>` OR styled container + heading | native | V3 | No dedicated quote widget in core; large-quote styling (oversized mark, rule) ⇒ inline-style attrs or per-widget `custom_css` | **~95%** |
| badge / tag | 1 | **Heading** or **Text Editor** in a styled container (bg + radius + padding) | native | V3 | Pill = small text widget w/ container `background_color` + `border_radius` + inline padding. Absolute-pinned badge ⇒ on a *widget* in a relative container | **~95%** |
| divider | 1 | **Divider widget** (`divider`) | native | V3 | Use `color`/`weight` (NOT `divider_color`/`divider_weight`); `style`, `width`, `gap`, optional `text`/`icon` | **~100%** |
| code block | 1 | **HTML widget** (`html`) with `<pre><code>` + inline styles, OR Text Editor `<code>` | needs-CSS | V3 `html` | Syntax highlighting (token colors) needs inline `style` attrs per span (kses-safe) or a per-widget `custom_css`; live highlighter JS is `<script>`-stripped | **~90%** static / no live re-highlight |

---

## Tier 2 — Static composites

| Block | Tier | Elementor mechanism | Approach | V3 vs V4 notes | Gotchas / kses / positioning | Ceiling |
|---|---|---|---|---|---|---|
| hero | 2 | **Container** (flex column, `min_height` vh) + heading/text/button children; bg `classic`/`gradient` | native | V3 container; V4 `e-flexbox` | Text-over-image overlay: stack a relative bg container + an absolute-positioned **widget** (containers ignore absolute). `background_overlay_*` absent in V3 core → use stacked layer | **~95%** |
| nav bar | 2 | **Nav Menu widget** (`nav-menu`) **[Pro]** — incl. mobile hamburger/dropdown | native (Pro) | V3 Pro `nav-menu`; V4 `e-*` n/a | Pro required for real menu widget + responsive toggle. Free fallback = Icon List / button row in a flex row (no dropdown). Mega-menu ⇒ Pro Mega Menu or Tier-3 dropdown row | **~90%** (Pro) / ~70% free |
| card | 2 | **Container** (bg/border/radius/padding) + image + heading + text + button children | native | V3 container; V4 `e-flexbox`/`e-div-block` | Card = a container, NOT loose leaves (the #1 structural-fidelity failure). Hover-lift ⇒ container `_transform_translateY_effect_hover` + `_transform_*_popover_hover:"transform"` toggle + `_transform_transition_hover` | **~95%** |
| card-grid | 2 | **Grid container** (`gridTemplateColumns: repeat(N,1fr)`, `gap`) of card containers | native | V3 grid container; V4 `e-grid` | **Grid tiles where flex can't** — equal rows/columns. CSS `display:grid` source → Grid container; verify the grid key via live schema before emitting. Flex-wrap fallback needs per-child `flex_basis: calc()` | **~95%** |
| feature row | 2 | **Container** (flex row, `flex_align_items:center`) — alternating text/image halves | native | V3 container | Two 50% child containers; on mobile emit `flex_direction_mobile:"column"`. Image radius on its container | **~95%** |
| stat / counter row | 2 | **Counter widget** (`counter`) **[Pro]** in a flex/grid row | native (Pro) | V3 Pro `counter` | Static number = heading. Animated count-up = Pro Counter (native) OR free JS-light snippet (Tier-4 "counter animation"). Free static ⇒ headings | **~95%** (Pro) / ~90% static free |
| logo wall | 2 | **Grid/Flex container** of **Image widgets**, OR **Image Carousel** [Pro] if it scrolls | native | V3 container | Greyscale-until-hover ⇒ per-widget `custom_css` (`filter:grayscale`). Marquee scroll ⇒ Tier-4 marquee | **~95%** |
| testimonial | 2 | **Testimonial widget** (`testimonial`) [Pro] OR container (text-editor quote + image + heading) | native | V3 Pro `testimonial`; free = container | Free composition is fully faithful + editable; Pro widget if exact stock layout wanted | **~95%** |
| pricing table | 2 | **Price Table widget** (`price-table`) **[Pro]** | native (Pro) | V3 Pro `price-table` | Pro = native price/features/CTA. Free fallback = container + heading + Icon List + button (faithful, more nodes). "Featured" ribbon = absolute **widget** badge | **~90%** (Pro) / ~90% composed free |
| footer-columns | 2 | **Container** (flex/grid row) of column containers (heading + Icon List/links + Social Icons) | native | V3 container | Social row ⇒ **Social Icons widget** (`social-icons`). Multi-column collapses to stack on mobile via `flex_direction_mobile` | **~95%** |
| CTA band | 2 | **Container** (bg color/gradient) + heading + button, OR **Call to Action widget** [Pro] | native | V3 container | Full-bleed band = `content_width:full`; inner boxed child. Trivial + editable | **~98%** |
| image gallery | 2 | **Gallery widget** (`image-gallery`) / **Basic Gallery**, or **Image Carousel** [Pro] for sliding | native | V3 `image-gallery` | Masonry layout ⇒ Grid container `autoFlow:dense` approximation or Joist Masonry pack widget; lightbox is native | **~90%** |
| two-column split | 2 | **Container** flex row, two 50% children (or Grid `1fr 1fr`) | native | V3 container | Same as feature row; pick Grid when both columns must be equal-height tiles | **~98%** |
| table | 2 | **HTML widget** (`html`) with `<table>` + inline `style` attrs; or **Table widget** if a pack provides one | needs-CSS | V3 `html` (no native data-table widget in core) | No native core table widget — `<table>` markup in `html` widget; inline `style=""` attrs survive kses for borders/zebra. Editing happens in raw HTML, not visual panel (editability dips). VERIFY if a Pro/3rd-party table widget is installed | **~90%** visual / **low editability** |

---

## Tier 3 — Interactive

| Block | Tier | Elementor mechanism | Approach | V3 vs V4 notes | Gotchas / kses / positioning | Ceiling |
|---|---|---|---|---|---|---|
| tabs | 3 | **Tabs widget** (`tabs`) **[Pro]** | native (Pro) | V3 Pro `tabs`; V4 `e-tabs*` registered (structural) | Pro present → native tabs (switching works, editable). No-Pro fallback = `<details>`/CSS `:target` or JS in `html` (`<script>` stripped → fragile). Grade = panel switches + content present | **~90%** (Pro) |
| accordion | 3 | **Accordion widget** (`accordion`) **[Pro]**; free fallback **`<details>/<summary>`** in `html` | native (Pro) / native-ish free | V3 Pro `accordion` | Pro = native open/close. Free `<details>` is pure-HTML (no `<script>`, kses-safe) and genuinely functional — good free fallback. Toggle widget similar | **~90%** (Pro) / ~85% `<details>` |
| dropdown / mega-menu | 3 | **Nav Menu** (`nav-menu`) **[Pro]** with submenu / **Mega Menu** [Pro] | native (Pro) | V3 Pro | Real dropdown behavior needs Pro Nav/Mega Menu. CSS-only `:hover` dropdown via per-widget `custom_css` possible but a11y-poor; JS via `<script>` is stripped | **~85%** (Pro) / ~50% free |
| carousel / slider | 3 | **Slides** (`slides`) / **Image Carousel** (`image-carousel`) / **Media Carousel** **[Pro]** | native (Pro) | V3 Pro | Pro carousels are native + editable. Free = Swiper.js in `html` (needs PHP-enqueued JS, not `<script>` tag — kses + caching-defer both bite). Prefer Pro | **~90%** (Pro) / ~60% free |
| modal / dialog | 3 | **Popup** (Theme Builder Popup) **[Pro]** OR native `<dialog>`/`popover` attr via `html` | native (Pro) / needs-custom_css | V3 Pro Popups | Pro Popup builder = full triggers (click/scroll/exit). Free = `popover` attribute (Baseline 2024) + button `popovertarget` in `html` (no JS needed) — kses-safe, decent fidelity | **~85%** (Pro) / ~70% free `popover` |
| FORM (text/email/select/textarea/checkbox/submit) | 3 | **Form widget** (`form`) **[Pro]** | native (Pro) | V3 Pro `form`; V4 `e-form*` registered (structural) | **Form rebuilt as text = the cardinal structural-fidelity failure.** Pro Form = native fields + validation + submit/actions, editable. Free fallback = raw `<form>` in `html` (no native submit handling; `<script>`/`<style>` stripped) → flag as non-functional. Capture field names/types/validation | **~90%** (Pro) / ~50% free (visual only, no submit) |
| search | 3 | **Search Form widget** (`search-form`) **[Pro]** | native (Pro) | V3 Pro `search-form` | Pro = native WP search. Free = `<form role=search>` in `html` (visual only). Header search box often part of Nav | **~85%** (Pro) / ~50% free |
| sticky header | 3 | **Sticky** (Motion Effects `motion_fx_sticky`) **[Pro]** on a header container; or Theme Builder sticky header | native (Pro) / needs-custom_css | V3 Pro | Pro Sticky = native pin + hide-on-scroll-down via effects-offset. Free = `position:sticky` per-widget `custom_css` (basic pin works); hide-on-scroll needs JS (stripped) | **~90%** (Pro) / ~75% free (basic pin) |
| off-canvas / hamburger | 3 | **Nav Menu** (`nav-menu`) **[Pro]** responsive toggle; or **Off-Canvas widget** [Pro] | native (Pro) | V3 Pro | Pro Nav Menu emits the hamburger + slide-in panel natively + responsive. Free hamburger = `checkbox`+`:checked`+`custom_css` hack (kses-safe but fragile) | **~85%** (Pro) / ~55% free |
| video embed | 3 | **Video widget** (`video`) — YouTube/Vimeo/self-hosted | native | V3 `video` | `video_type` + `youtube_url`/`vimeo_url`/`hosted_url`; `aspect_ratio`, `autoplay`/`mute`/`loop`/`controls`. Lightbox/poster native | **~98%** |
| map embed | 3 | **Google Maps widget** (`google_maps`) **[Pro]**; or iframe in `html` | native (Pro) / needs-html | V3 Pro `google_maps` | Pro = native embed. Free = `<iframe>` in `html` widget (iframes survive kses on this path — VERIFY iframe allowance for the REST role); interactive map JS otherwise stripped | **~90%** (Pro) / ~85% iframe |

---

## Tier 4 — Motion (honest ceilings; see MOTION_PLAYBOOK)

Order of preference per effect: **native widget setting → Pro Motion Effects → per-widget `custom_css` (NOT `<style>` HTML widget — stripped) → GSAP escape-hatch (PHP-enqueued, scoped) → raster/mark-uncloneable.** Motion-fx interpolates LINEARLY (no cubic-bezier-on-scroll, no multi-phase/pinned/stagger natively) — those reasons drive the GSAP rows.

| Block | Tier | Elementor mechanism | Approach | V3 vs V4 notes | Gotchas / kses / positioning | Ceiling |
|---|---|---|---|---|---|---|
| scroll-reveal (fade/slide/scale-in) | 4 | **Entrance Animation** `_animation` + `_animation_delay` (FREE) OR Scroll Effects opacity [Pro] | native | V3 free; key is `_animation` (NOT `animation`) | One-shot reveals = free Animate.css presets (37+). Eased/scrubbed reveal ⇒ Pro Scroll Effects or GSAP. `prefers-reduced-motion` gate required | **~95%** (one-shot) |
| parallax (single layer) | 4 | **Scrolling Effects** `motion_fx_motion_fx_translateY/X` **[Pro]**; free = `background-attachment:fixed` | native (Pro) | V3 Pro | Free bg-attachment parallax is trivial+cheap. Multi-layer/depth-synced parallax ⇒ GSAP. Native parallax has a browser-easing artifact (#7804) | **~90%** (Pro single) / ~50% free |
| counter animation | 4 | **Counter widget** (`counter`) **[Pro]** | native (Pro) / needs-GSAP-or-JS | V3 Pro | Pro Counter native count-on-view. Free = JS-light snippet (must be PHP-enqueued or per-widget — `<script>` in HTML widget is stripped) → use Pro or a packaged handler | **~95%** (Pro) |
| split-text reveal | 4 | **GSAP SplitText** (escape-hatch) | needs-GSAP | not native any tier | No native char/word split. Minimal CSS approximation only. SplitText now free in GSAP; scope to `data-anim-scope`, PHP-enqueue | **~80%** (GSAP) / ~30% native |
| horizontal-scroll section | 4 | CSS `scroll-snap-x` via per-widget `custom_css`; or **GSAP** pinned horizontalScroll | needs-custom_css / needs-GSAP | not native | Pro Motion Effects can't do pinned horizontal scroll. Scroll-snap is a decent free approximation; true pinned ⇒ GSAP (watch ancestor-transform pin breakage) | **~80%** (GSAP) / ~60% snap |
| sticky-pin (scrollytelling) | 4 | **GSAP ScrollTrigger** pin (escape-hatch) | needs-GSAP | not native | Pro Sticky only fixes to edge (content inside scrolls normally) — NOT a true pinned sequence. Multi-trigger scrollytelling ⇒ GSAP timeline only. Refresh on load/resize | **~80%** (GSAP) / ~40% native |
| hover effects | 4 | Native `_transform_*_effect_hover` + `_*_popover_hover` toggle + `_transform_transition_hover`; `hover_animation` presets | native / needs-custom_css | V3 | Native covers color/bg/border/shadow/scale/translate/rotate/filter swaps. **Parent→child hover (`:hover .child`), pseudo-element sweeps, custom easing/different in-out durations ⇒ per-widget `custom_css`** | **~95%** (native swaps) |
| marquee | 4 | Per-widget `custom_css` `@keyframes translateX` on a flex strip | needs-custom_css | not native | Pure CSS, kses-safe via per-widget `custom_css`; duplicate the track for seamless loop; pause-on-hover trivial | **~95%** |
| smooth-scroll (inertia) | 4 | **Lenis** via GSAP escape-hatch | needs-GSAP | not native | Elementor v3.25 native CSS smooth-scroll collides with Lenis (broke ~20 sites, no disable filter) → **feature-flag OFF by default**, fragile to core updates. `autoRaf:false` + delegate to `gsap.ticker`. a11y caveat | **~85%** (GSAP) / fragile |
| lottie / animated-svg | 4 | **Lottie widget** (`lottie`) **[Pro]**; free = lottie-web via PHP-enqueued init | native (Pro) / needs-GSAP-style-embed | V3 Pro `lottie` | Pro Lottie native. Free lottie-web needs PHP-enqueue (CDN `<script>` in HTML widget is stripped + caching-deferred). Animated SVG morph ⇒ Joist Morph pack widget / Flubber | **~95%** (Pro) |

---

## Approach legend & escape-hatch routing

- **native** — pure native widget settings; fully editable in the visual panel; highest fidelity. Default target.
- **needs-CSS** — achievable with native settings + inline `style=""` attributes (kses-safe) or container styling.
- **needs-custom_css** — requires the per-widget Advanced→Custom CSS or Pro per-page Custom CSS field
  (stored as an Elementor setting, survives kses). **Never** a `<style>` HTML widget (tag-stripped on REST save).
- **needs-GSAP** — outside Elementor's authoring surface; route to the GSAP escape-hatch
  (PHP-`wp_enqueue_script`, scoped to `data-anim-scope`, idempotent, `ScrollTrigger.refresh()`, cleanup). See `GSAP_ESCAPE_HATCH_SPEC.md`.
- **raster-only** — capture as image (WebGL/Three.js heroes, scroll-scrubbed video, shader effects). ~75% hard wall.

**The honest verdict (CLONE_CAPABILITY_SPEC §5.6):** "pixel-perfect AND fully native-editable" is not simultaneously
achievable for any non-trivial site. Static layout/type/color clones to ~90%+ natively (Elementor's strength);
motion + bespoke micro-interactions live outside the native panel, so reproducing them injects custom_css/GSAP, which
erodes editability. Maximize editable-native fidelity, isolate escape-hatch into clearly-flagged code blocks, report
which parts are editable vs injected.

**VERIFY flags:** (1) whether iframes survive kses for Joist's REST role (map embed free path);
(2) presence of a Table widget on this stack (no native core data-table); (3) exact live grid-container key before
emitting Grid (`/widgets` schema) — never guess; (4) standalone `icon` widget control acceptance on this exact install.
