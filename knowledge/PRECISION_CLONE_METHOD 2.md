# Precision Clone Method — getting an Elementor clone to 1:1

> Status: validated on Stripe.com 2026-06-01. Hero reached **4.7% pixel-diff locally / 7.1% live** in real, round-trip-editable Elementor. This is the canonical method the `joist-clone` skill drives. Read with `CLONE_AUTHORING_PLAYBOOK.md` (authoring rules) and `WIDGET_CONTROL_CHEATSHEET.md` (control IDs).

## Core principle

**Transcribe measured reality exactly — do not approximate.** The source browser already computed the perfect layout, fonts, and colors. Capture those exact values and reproduce them; never re-derive layout from heuristics or substitute "close enough" fonts. The pixel-diff against the source is the teacher: render → diff → fix the element the diff highlights → repeat to ~0.

The honest ceiling is **not** Elementor — it's **capture fidelity** on production DOM (gradient-clipped text, nested styled runs, SEO-duplicate elements, live tickers). Solve capture and Elementor reproduces it.

## The hybrid fidelity decision (per section)

Decide each section's treatment by its content, to get pixel-fidelity AND editability where it matters:

- **Text/structural sections (hero, headings, copy, CTAs, nav)** → **precision native widgets** (editable, reproduced from exact metrics + real font + positioning). This is the editable value.
- **Graphic-dense bands (bento grids, product mockups, dashboards, animated/gradient illustrations, footers)** → **capture the section as one image** (pixel-perfect, still editable as a swappable image widget). Rebuilding these as widgets is hopeless and wrong.
- A section is "graphic-heavy" when it has ≥2 content images OR a full-bleed visual; otherwise treat as widgets.
- **Card-grid sections also go to images, even if they look text-y.** A repeated card layout (news/blog/article grid, feature-card matrix with per-card thumbnails/backgrounds) reproduces poorly as flat precision widgets — validated on Stripe: clean text/link/CTA sections hit **2.5–3.1% diff** (s7 CTA, s8 footer links), but the s6 news card-grid hit **38%** because flat text positioning can't carry per-card imagery/structure. Heuristic: many repeated heading+text+link triples in a grid ⇒ capture as image (or do per-card hybrid). Reserve precision widgets for genuinely flat text sections (hero copy, CTA blocks, footer link columns, stat bands).

## Step 1 — Capture exact reality (same pass)

Capture the reference screenshot AND element coords/styles in **one Playwright pass** at a fixed width (1440). Cross-session coords drift → never reuse coords from a different capture (this caused a ~45px y-offset).

Per layout-significant element, capture: absolute `x/y/w/h`, `font-size`, `font-weight`, `line-height`, `letter-spacing`, `color`, `text-align`, `background`, `border-radius`. Plus:

- **Real fonts:** capture the source's `@font-face` woff2 URLs from the **network** (cross-origin `cssRules` throws). Watch `response` events for `\.woff2?`. These load fine from the source CDN via `@font-face` (no CORS issue for font *files*). Loading the real font is the single biggest fidelity lever.
- **Effect-aware color:** if an element has `background-clip:text` (gradient text), `getComputedStyle().color` returns a meaningless FALLBACK (e.g. Stripe's hero returns green `rgb(129,184,26)` — this is NOT a bug, it's the gradient fallback). Reproduce the actual `background-image` gradient via `custom_css`, or capture that text run as an image. Never blind-apply the computed color.
- **Salience floor:** text < ~14px inside a bounded cluster is almost always graphic-mockup interior, not content — drop it (capture the graphic as an image instead).

## Step 2 — Precision build in Elementor (the live gotchas)

Reproduce captured elements as native widgets, positioned exactly. Hard-won Elementor facts:

1. **Elementor DROPS `_css_classes` on CONTAINERS** (it keeps them on widgets). For a positioning context, give the section container an **`_element_id`** (e.g. `czphero`) and target `#czphero` in CSS. Do NOT rely on a container class.
2. **Absolute-position via injected CSS** (one `html` widget holding a `<style>` block): `#scope{position:relative;height:Hpx;overflow:hidden}` + per-widget `.cls{position:absolute!important;left;top;width;z-index}`. Each widget carries its `.cls` via `_css_classes` (works on widgets). Widgets stay fully editable.
3. **Zero the widget-container box** or text sits BELOW its coordinate: `#scope .elementor-widget-container{padding:0!important;margin:0!important}`. (Elementor's default padding caused a consistent vertical text offset.)
4. **Don't clamp negative `y`** for decorative bleed images (e.g. a hero wave whose true top is `-107`) — let it bleed above with `overflow:hidden` on the scope, matching the source.
5. **Load the real font via `@font-face` — but SELF-HOST it.** Cross-origin fonts are CORS-blocked: a browser will NOT load `@font-face` from the source's CDN onto your WP origin (no `Access-Control-Allow-Origin`), so the live page silently falls back to a system font. (This passes locally over `file://`, which doesn't enforce font CORS — so it looks fine in local previews and breaks live.) Fix: download the woff2, upload to WP media (`Content-Type: font/woff2`), and reference that SAME-ORIGIN URL in the `@font-face`. Apply `font-family` on `#scope`; ideally register as a Global Font.
6. **Explicit `line-height` + `content_width` everywhere** — theme defaults (~1.5 line-height, boxed width) are the silent fidelity killers; the source is often ~1.1 line-height.
7. **Native custom-positioning keys** (Elementor Pro, on every element) are the alternative to injected CSS: `_position:"absolute"`, `_offset_x`/`_offset_y` `{unit,size}`, `_offset_orientation_h/v:"start"|"end"`, `_z_index`, `_element_custom_width`. Prefer container+flex+exact-spacing for primary text (responsive-safe); reserve absolute for decorative overlaps.
8. **Gradient text:** for the WHOLE heading, a Heading widget with `custom_css` = `selector .elementor-heading-title{background-image:linear-gradient(...);-webkit-background-clip:text;-webkit-text-fill-color:transparent;color:transparent;display:inline-block}`. For gradient on PART of a headline (e.g. Stripe's "grow your revenue"), use a **text-editor widget** whose `editor` HTML wraps just that phrase in a `<span style="…background-clip:text…">`. Detecting and reproducing this gradient is essential — pixel-diff barely penalises gradient-vs-flat fill, but the eye reads a flat headline as "not the brand" instantly.
9. **Inline the font on text-editor content.** Elementor's text-editor defaults override a font-size set via the widget-container CSS class (headline silently rendered ~16px instead of 48px). Put `font-size/weight/line-height/letter-spacing` INLINE on a wrapping `<div>` inside the `editor` HTML so it can't be shrunk.
10. **Add the brand wordmark.** Source nav logos are usually SVG/`<img>` that capture drops — the missing wordmark is an obvious "not the real site" tell. Place a positioned text (or captured logo image) at the nav's far left.

## Full-page assembly (precision sections + image bands)

Assemble in document order: precision sections (hero, CTA, footer-text) interleaved with captured image bands, stacked in a flex-column wrapper with one combined `<style>` (font-face + every scope's rules). Live gotchas:
- **Self-host the font** (see Step 2 #5) — the #1 silent live failure.
- **Captured bands render at the theme's boxed width (~1240), not 1440** — force full width: image widget `_css_classes:'czbandimg'` + `.czbandimg img{width:1440px!important;max-width:none!important;height:auto!important}`. Without this the whole page is scaled-narrow and every band shrinks.
- **A band image can collapse to height:0** if width isn't forced/loaded — the same full-width rule fixes it.
- **Whole-page pixel-diff accumulates vertical DRIFT**: image bands are pixel-exact individually, but tiny per-band height deltas vs the source's live section heights compound down the page, inflating the whole-page number (Stripe full-page landed ~13.5% even though hero 7.1% / CTA 3.1% / footer 2.5% / bands ~0 per-section). Trust per-section diffs as the fidelity measure; reduce whole-page drift by matching each band's height to the source section exactly.

## Generalizing precision beyond the hero (per-section)

The same capture→position→diff works for ANY text-dominant section (`precise-section.mjs --section N`). Two generalization rules learned on Stripe s7 ("Ready to get started?" CTA, driven to **3.1% diff / 96.9%**):

- **Re-anchor FRESH per section — never trust stale absolute coords.** Section absolute-Y drifts between page loads (lazy-load reflow), so a band filter using cached `tree.json` coords silently drops elements (Stripe's CTA buttons fell outside the stale band → 0 captured). Fix: find the section's first element by its text on the *current* page, derive `y0_fresh = anchorAbsY − anchorOffsetWithinSection`, and crop the reference band at that same `y0_fresh` so elements and reference align.
- **Capture coords RELATIVE to the section top** (`abs − y0_fresh`) and render inside a fixed-height `position:relative` section scope — identical to the hero, just per band. This makes each section a self-contained precision unit; assemble them in order (precision text sections + captured image bands + precision hero) for the full page.

## Step 3 — Pixel-diff convergence loop

Render the built page (or section) at 1440, screenshot, `pixelmatch` vs the source over the **section region only** (exclude neighbouring bands). The diff IMAGE shows exactly which element is off (misalignment shows as doubled text; wrong color as solid fill; missing element as solid block). Fix that element, redeploy, re-diff. Repeat until the diff is irreducible noise.

**Irreducible residual (~4–7%):** sub-pixel anti-aliasing between two independent renders, live-updating content (tickers/clocks), single-weight font glyph drift. These are not errors — stop chasing them.

## Toolkit (agent-side, eval/grader/)

Prototype reference implementations — the skill drives these or regenerates equivalents per clone:
- `capture-tree.mjs` — exact-geometry + section + font capture → tree JSON
- `precise-hero.mjs` — single-pass capture + precision render + section pixel-diff (the convergence harness)
- `build-precise.mjs` — LIVE Elementor precision build (native widgets + injected absolute CSS + real font) via the plan API
- `preview.mjs` / `refine.mjs` — hybrid composition + widgets-vs-image decision
- `grade.mjs` — honest grader (deterministic + vision gate)
- `crop-local.mjs` / `upload.mjs` — region-capture decorative bands → WP media

## Write discipline (rate limits)

The site's plan-write bucket exhausts under bursts (≈10+ builds). Pace writes (3s between create/approve/execute), retry 429 with escalating backoff, and **iterate locally (write-free preview + diff) — deploy only converged versions.** Deploy to a FRESH page or implement a wipe-before-insert; reusing a page with `insert` at root STACKS copies.

## Honest scope

Editable 1:1 across an entire complex SaaS page is hard: the hero + text sections reach ~93% as editable widgets; graphic bands are pixel-perfect but as images. Live WebGL/shader heroes and exotic SVG remain image-or-approximation. Drive the diff per section; let the honest grader say where it lands.
