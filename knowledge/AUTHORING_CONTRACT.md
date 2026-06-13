# Joist Authoring Contract v2 — atlas-constrained HTML/CSS (P2)

@purpose The constrained authoring spec the vision-author writes AGAINST, derived from the
capability atlas (`eval/grader/atlas/atlas.json`, v0.1.0, commit e9b49af) and grounded in what
`eval/grader/transpile-html.mjs` (the hardened spike transpiler) PROVABLY transpiles today.
Enforced by `eval/grader/atlas/lint-authoring.mjs`. EMBODIMENT_APPROACH.md §P2 deliverable.

**The deal:** the author emits ONE self-contained HTML file (head `<style>` + body). It is never
shipped raw — it is rendered in local chromium, style-resolved, and deterministically transpiled
to a native Elementor container tree. Everything in this contract exists so that transpilation is
TOTAL: every construct the author may emit has a transpile rule and a known Elementor target.
What has no rule is BANNED here, with a residual-channel pointer (C §6 ladder: native →
widget-composition → inline-style → custom_css → html-widget → gsap → region-raster).

Calibration: the contract is gated AGAINST the proven clerk-hero spike (`/tmp/htmlfirst/hero.html`,
judge tiles 72/82/78/72) — a contract that spike fails ≥10% of is too strict (P2 gate (a)).

---

## 1. Document shape

- Single file: `<head>` with exactly one `<style>` block; all content in `<body>`. No external
  stylesheets (`<link rel=stylesheet>` BANNED — fonts come from system stacks / the kit), no
  `<style>` in body, no `<script>` anywhere (kses strips it; JS behavior routes to the gsap /
  packaged-handler channel, never inline).
- Landmarks: at most one `<header>` (or top-level `<nav>`) and one `<footer>`, depth ≤2 under
  body. The transpiler detaches them as Theme Builder SITE PARTS (P7) — author page chrome there,
  never as plain page sections.
- Desktop-first at 1440px. Responsive behavior ONLY via `@media (max-width: …)` (§7.4).
  `min-width` queries are BANNED (transpiler PAIN-skips them).

## 2. Closed structural vocabulary

The transpiler maps exactly these shapes. Nothing else.

| Shape | HTML | Transpiles to |
|---|---|---|
| Container | `div/section/header/footer/nav/main/ul/ol/li/article/aside/figure/blockquote` with element children, `display:flex` (column or row, optional `flex-wrap`) or block | `container` (flex_direction, flex_gap, padding, bg color, border, radius, box-shadow, width, min_height) |
| Boxed wrapper | container with declared px `max-width` + `margin:0 auto` | `content_width:boxed` + `boxed_width` |
| Heading | `h1`–`h6` leaf | `heading` widget (header_size, typography_*, title_color, align) |
| Text leaf | `p/div/a/span/li` whose children are only `<span>`/`<br>` | `text-editor` (inline-styled spans preserved) |
| Button | `<a>` with `border-radius ≥ 10px` | `button` widget (P1 icon-lift, colors, border, text_padding) |
| Image | `<img>` with manifest-resolvable src | `image` widget (WP media upload) |
| Inline SVG | `<svg>` element | svg upload → `image`, or `html` widget fallback |
| Empty box | leaf with no text (divider line, dot, filler) | styled empty `container` |

**Leaf discipline:** inside a text leaf, ONLY `<span>` (with inline `style`) and `<br>`.
`strong/em/b/i/u/small/code` as children break leaf detection and shatter the text into multiple
widgets — BANNED (V-INLINE-TAG); use `<span style="font-weight:700">`.

**Element whitelist:** html, head, meta, title, style(head), body, div, section, header, footer,
nav, main, article, aside, figure, figcaption, blockquote, h1–h6, p, a, span, br, img, svg (+svg
internals), ul, ol, li, pre, code, hr. Anything else → V-ELEMENT.

## 3. CSS rules

- **Computed-value discipline:** the transpiler reads COMPUTED styles, so CSS custom properties
  (`var(--x)`) are ALLOWED — they resolve at extraction and never reach Elementor. (Deliberate
  divergence from the atlas seed constraint "no CSS vars" — that cell predates the hardened
  extractor; vars are leak-free by construction.)
- **CSS math** (`clamp()/calc()/min()/max()`) in lengths is TOLERATED-WITH-WARNING (W-CSSMATH):
  the transpiler freezes it to the computed px at the authoring width (P2 policy, logged).
  Prefer fixed px.
- **Allowed property families** (everything the mapper consumes): display:flex/block,
  flex-direction, flex-wrap, justify-content, align-items, flex (grow/shrink/basis), gap
  (row/column), padding, margin (incl. `auto` for centering/justify heuristics P5), width,
  max-width, height, min-height, background-color, border (width/color, solid), border-radius,
  box-shadow, color, font-family, font-size, font-weight, line-height, letter-spacing,
  text-align, text-decoration, opacity (on logo bands), vertical-align (inline spans).
- **Banned properties** (no transpile rule — each routes to a residual channel, §5):
  `display:grid`, `position:absolute|fixed|sticky`, `background-image` (incl. gradients),
  `animation`/`@keyframes`, `transition` (non-zero), `transform`, `filter`, `float`,
  `background-clip:text` (gradient glyphs).
- **Fonts:** system stacks or kit-known families only (generic-font fallback is
  'Helvetica Neue'). Unknown webfont families → W-FONT.

## 4. Per-construct contract (the 20 EXPRESSIBLE atlas constructs)

Snippets and constraints are the atlas `authoringContract` cells, tightened to transpiler truth.

| Atlas construct | Author exactly | Constraints (lintable) |
|---|---|---|
| body-text | `<p style="font-size:16px;color:#333">…</p>` | leaf discipline §2; emphasis via styled spans |
| heading | `<h2 style="font-size:48px;font-weight:600">…</h2>` | h1–h6 only; solid paint (gradient → BANNED §5) |
| button-cta | `<a class="btn" href="/x" style="background:…;border-radius:999px;padding:…">Label ▸</a>` | MUST be `<a>` with radius ≥10px (detection threshold; squarer → W-SQUARE-BTN, maps to text); trailing/leading glyph span lifts to native icon (P1); styled spans with real text get FLATTENED (W-BTN-SPAN) |
| image | `<img src="https://…" alt="…">` | https or assets-manifest src (else V-IMG-SRC / hot-link PAIN); alt required (W-ALT) |
| icon-svg | inline `<svg>` | survives as svg upload or html widget |
| logo | `<img>`/`<svg>` of the EXACT source asset | wrong-logo = top human-salient defect |
| stat-number | `<span style="font-size:56px;font-weight:700">99.9%</span>` + label | STATIC only (count-up → §5 scroll/anim ban) |
| badge-pill | `<span style="background:…;border-radius:999px;padding:4px 12px">New</span>` | flows inline; absolute pin BANNED §5 |
| nav-links | `<ul>`/`<div>` of `<a>` leaves | plain link rows/columns; functional dropdown = Pro nav-menu (post-transpile concern) |
| inline-styled-text | `<h1>Ship <span style="color:#0cf">faster</span></h1>` | color/size/weight/spacing spans only; gradient-clip spans BANNED §5 |
| code-panel | `<pre style="background:#0d1117">…<span style="color:#ff7b72">const</span> x;<br>…</pre>` | line breaks MUST be `<br>` (raw newlines collapse — V-PRE-NEWLINE); token colors = inline spans; no highlighter JS |
| divider | `<hr style="border-top:1px solid #e5e7eb">` or empty box | — |
| section-stack | `<section style="display:flex;flex-direction:column;gap:24px;padding:96px 0">` | flex-first; ≤4 container nesting (§7.1) |
| nav-row | `<header style="display:flex;justify-content:space-between;align-items:center">` | landmark → site part; depth ≤2 under body |
| hero-stack | flex-col section, centered, h1+p+CTA row | bg = flat color only (image/gradient → §5) |
| card | `<div style="background:#fff;border:1px solid #eee;border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:12px">` | card = ONE container, never loose sibling leaves; hover-lift → §5 |
| split-2col | flex-row, two `flex:1` children | responsive stack via max-width query (§7.4) |
| logo-band | flex-row of imgs/styled cells | static only; scrolling → marquee §5 |
| footer-columns | `<footer>` flex-row of column containers | landmark → site part; grid layout → author as flex |
| cta-band | flat-bg section + heading + button | full-bleed via boxed wrapper inside full section |

## 5. BANNED constructs — everything not atlas↔transpiler expressible

Each ban names its lint rule, the atlas construct it strands, and the residual channel that
carries it INSTEAD of authored HTML (escalations are ledgered, never silent).

| Banned | Lint rule | Atlas construct | Residual channel |
|---|---|---|---|
| `display:grid` | V-GRID | card-grid | author flex rows NOW; native grid-container transpile rule = pre-P3 totality fix |
| `position:absolute/fixed` | V-POSITION | absolute-overlay | region-raster (decorative) / custom_css post-transpile |
| `position:sticky` | V-POSITION | sticky-chrome | custom_css (per-widget, kses-safe) |
| `background-image` / gradients | V-BGIMAGE | bg-image-section | region-raster; flat-color fallback inline |
| `animation` / `@keyframes` | V-ANIM | marquee, scroll-reveal | custom_css (marquee PRIMARY per atlas) / gsap; native `_animation` rule = post-P2 add |
| `transition` / `transform` / `filter` | V-ANIM | card hover-lift, logo greyscale | custom_css / HYBRID_MOTION (commit 09f8532) |
| `background-clip:text` | V-GRADIENT-TEXT | inline-styled-text (gradient) | per-widget custom_css (clone_validation_pitfalls) |
| `<video>/<iframe>/<audio>` | V-ELEMENT | video-embed | html-widget; native video widget rule = post-P2 add |
| `<form>/<input>/<select>/<textarea>/<button>` | V-ELEMENT | form | Pro form widget (post-transpile); NEVER text-rebuild a form |
| `<details>/<dialog>` | V-ELEMENT | accordion, modal | html-widget (`<details>` is kses-safe there) |
| `popover`/`popovertarget` attrs | V-POPOVER | modal | html-widget |
| `role=tablist` interactive tabs | V-ELEMENT (interactive) | tabs | region-raster (Pro tabs post-transpile) |
| `<script>`, inline handlers | V-SCRIPT | — | gsap/packaged-handler channel only |
| `<table>` et al. (off-whitelist) | V-ELEMENT | — | html-widget |
| `@media (min-width…)` | V-MINWIDTH | — | rewrite desktop-first |
| `<link rel=stylesheet>`, body `<style>` | V-EXTERNAL-CSS / V-STYLE-BODY | — | inline into the head block |

## 6. Totality matrix — atlas (31) × transpile rule

OK = rule exists & proven · PARTIAL = rule exists, named pains · GAP = no rule → §5 ban.

- **OK (15):** body-text, heading, image, icon-svg, logo, badge-pill, divider, section-stack,
  nav-row, hero-stack, card, split-2col, logo-band, footer-columns, cta-band
- **PARTIAL (5):** button-cta (span flatten, square-corner detection), stat-number (static only),
  nav-links (no functional dropdown), inline-styled-text (no gradient glyphs), code-panel
  (`<br>` discipline, no re-highlight)
- **GAP (11):** card-grid, absolute-overlay, sticky-chrome, bg-image-section, marquee,
  scroll-reveal, video-embed, form, accordion, tabs, modal

Lint-clean output therefore CANNOT hit a transpiler gap: every GAP construct is V-banned, every
OK/PARTIAL construct has a rule in `transpile-html.mjs` (assert: no lint-clean construct without
a transpile rule — checked by the selftest fixture pair). The 11 GAPs are the P2→P3 work queue,
top-down by histogram weight: **card-grid** (43 raw grid occurrences) and **bg-image-section**
first.

## 7. Section-level rules

1. **Nesting ≤4:** at most 4 CONTAINER levels inside any top-level section (section root = level
   1; leaves/widgets don't count). Deeper → V-NEST. Flatten decorative wrappers.
2. **Namespacing:** classes are lowercase-kebab (`^[a-z][a-z0-9-]*$`), section-scoped, no
   Elementor-reserved prefixes (`elementor-`, `e-`, `joist-`) → V-CLASS-NS.
3. **Real assets:** every `<img>` src must be an https URL or resolve through the capture assets
   manifest (`/tmp/…/cap/assets` → P6 upload). No data: URIs, no placeholder CDNs (V-IMG-SRC).
   Logos are the exact source assets.
4. **Media queries → Elementor responsive controls (P3 mapping):** `max-width ≤767` → `*_mobile`
   controls; `768–1024` → `*_tablet`; `>1024` → tablet controls + exact-width scoped custom_css.
   Mapped properties: flex-direction, align-items, justify-content, padding, text-align, width,
   display:none (→ hide_*). Anything else rides the per-element custom_css channel — keep media
   blocks to the mapped set where possible.
5. **One section = one top-level child of body** (plus the landmark site parts). Author section
   by section; the per-section refine loop operates at this grain.

## 8. Lint rule registry

Violations (gate-affecting): V-SCRIPT, V-STYLE-BODY, V-EXTERNAL-CSS, V-ELEMENT, V-POPOVER,
V-GRID, V-POSITION, V-BGIMAGE, V-ANIM, V-GRADIENT-TEXT, V-INLINE-TAG, V-PRE-NEWLINE, V-IMG-SRC,
V-CLASS-NS, V-NEST, V-MINWIDTH.
Warnings (logged, not gate-affecting): W-CSSMATH, W-BTN-SPAN, W-SQUARE-BTN, W-FONT, W-ALT.

Linter: `node eval/grader/atlas/lint-authoring.mjs --html <file>` → `{clean, constructs,
cleanConstructs, violations:[{construct, rule, element, fixHint, residualChannel}], warnings}`.
Selftest: `--selftest` (fixtures: one clean file, one with 5 planted violations).
