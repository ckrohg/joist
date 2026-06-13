# Clerk full page — local Elementor render + webfont registration

Closed loop: `eval/grader/local-fidelity/clerk.html` (responsive full page, sha256
`9c55f07e…`) → `transpile-html.mjs` → one Elementor tree → rendered in the LOCAL
Docker Elementor sandbox (port 8001, WP 7.0 + Elementor 3.28.4) via `sandbox/render.mjs`.
NO shared host (georges232) touched.

## 1. Webfont registration (Suisse Intl) — FIXED + VERIFIED

The hero residual was Suisse→Helvetica fallback (server lacked the font). Registered the
real captured clerk.com webfonts into the local stack:

- Copied 5 woff2 subsets (`/tmp/local-fidelity/fonts/SuisseIntl_{Regular,Book,Medium,SemiBold,Bold}.woff2`)
  into the WP container at `wp-content/uploads/clerk-fonts/` (served static, `font/woff2`, 200).
- Added a must-use plugin `wp-content/mu-plugins/joist-clerk-fonts.php`
  (copy archived here as `joist-clerk-fonts.mu-plugin.php`) that prints `@font-face`
  rules for `Suisse` (weights 400/450/500/600/700) in `wp_head` — fires on the Elementor
  canvas template too, so any `.elementor` page whose typography requests
  `typography_font_family:"Suisse"` resolves to the real face.

**Verification (DOM, not just declared):**
- Isolated control (page 82, a single `Suisse` heading): `renderedFamily:"Suisse, sans-serif"`,
  `document.fonts.check(...) = true`, loaded face `Suisse:700`. Helvetica fallback gone.
- Full page (page 83): every heading → `Suisse, sans-serif`, `suisseLoaded:true`;
  browser actually loaded all 5 Suisse weights (`Suisse:400/450/500/600/700`) + `JetBrains Mono:500`.
- LOOK (`hero-band-1440.png`): the H1 renders in genuine Suisse Intl Bold letterforms
  (single-story `a`, geometric `t`/`g`/`M`) — visibly NOT Helvetica.

Note: page 81 (the prior hero spike) still shows Helvetica because ITS tree was authored
with `typography_font_family:"Helvetica Neue"` (the value its standalone capture computed).
The fix is correct; a page only benefits if its tree actually requests Suisse — the full
clerk.html does, because its `<style>` sets `body{font-family:'Suisse',…}`.

## 2. Transpile — native widget census

`node transpile-html.mjs --html clerk.html --width 1440 --assets <manifest> --dry-run`
(assets manifest maps the 42 `assets/<name>` refs → `/tmp/local-fidelity/assets/<name>`,
all 42 resolved). Header+footer were extracted as P7 site-parts (Theme Builder docs);
for a single full-page render they were recomposed `[header, body, footer]` into one tree.

Combined full-page tree (as rendered) — **292 nodes, every element id-stamped (0 missing)**:

| widget        | count |
|---------------|-------|
| container     | 101   |
| text-editor   | 112   |
| image         | 43    |
| heading       | 22    |
| html          | 13    |
| button        | 1     |

- **Raster fallbacks: 0.** No region-raster / screenshot-of-a-band anywhere — the whole
  page is native widgets.
- Validation: `localErrors: []`. 0 PAIN items.
- 106 POLICY notes: 58 × P3 (responsive breakpoints mapped to native tablet/mobile controls
  + scoped `custom_css` for unmapped declarations), 42 × P6 (image uploads), 3 × P6 svg→html,
  3 × P7 (site-part extraction).

## 3. Transpiler GAPS (honest)

- **Inline SVG glyphs → html widgets (the one native gap).** 13 small inline SVGs
  (7–10px chevrons/arrows; 3 unique shapes) have no native Elementor home — Elementor has
  no inline-SVG widget and WP blocks `image/svg+xml` by default, so they ride html widgets
  carrying the verbatim `<svg>` markup. They render correctly but are not "native" widgets.
  (The 42 `assets/*.svg|png|webp` `<img>` logos/screenshots ARE native image widgets.)
- **CSS-math frozen to authoring width.** Any `clamp()/calc()/min()/max()` length is frozen
  to its computed px at 1440 (P2) — Elementor controls can't express CSS math. Desktop-exact;
  drifts off-width unless a P3 media rule also fired.
- **>1024 custom breakpoints ride `custom_css`.** Native Elementor breakpoints are tablet≤1024
  / mobile≤767; clerk's 1280/1340/900/640 queries land via scoped per-element `@media`
  `custom_css` (Pro selector channel) rather than native responsive controls.
- ~~**Images served from a static uploads dir, not the WP media library.**~~ **RESOLVED
  2026-06-12** — the 42 assets are now imported as REAL WP media attachments (ids 84–126,
  with width/height metadata) via `upload-assets-local.mjs` (`media_handle_sideload`, svg mime
  allowed for the local sandbox). Image widgets carry `image.id` + the captured pixel box.

## 5. IMAGERY + SECTION-ORDER fix (2026-06-12)

Two located full-page bugs fixed; re-rendered to page 83.

### (A) Imagery rendered as placeholder boxes → FIXED (43/43 real images)
Root cause was a chain: (1) image widgets pointed at bare static URLs with NO WP attachment
id; (2) Elementor 3.28's image widget has no standalone width/height control (only
`image_size` + `image_custom_dimension`, which needs an attachment to size) — the transpiler's
old `width:{unit,size}` was silently dropped; (3) so far-below-the-fold `loading="lazy"`
images reserved no box, collapsed to height:0, never entered the lazy IntersectionObserver,
never decoded → 29/43 painted as empty grey boxes. Fixes:
- **`eval/grader/transpile-html.mjs` imageWidget** (~L496–547): emit `image_size:'custom'` +
  `image_custom_dimension:{width,height}` from the captured box (raster); for SVG attachments
  (vector — Elementor skips the dimension CSS) keep `image_size:'full'` and pin the box on the
  wrapper via the native `_element_custom_width` control. Capture now also records
  `attrH/natW/natH` (~L202) for the aspect derivation.
- **`sandbox/upload-assets-local.mjs`** (NEW asset-upload helper): import the 42 captured
  assets into WP media → ids + dimensions; idempotent (re-uses by `_joist_src` meta).
- **`sandbox/snapshots/clerk-fullpage/joist-eager-images.mu-plugin.php`** (NEW, local sandbox,
  analogous to the Suisse font mu-plugin): `wp_lazy_loading_enabled => false` so every image
  decodes regardless of viewport — a headless full-page screenshot never scroll-triggers lazy
  loads. Copy lives in the container at `mu-plugins/joist-eager-images.php`.

LOOK + DOM probe (page 83 @1440): `brokenCount 0`, `zeroRenderCount 0`, all 43 image widgets
`naturalWidth>0` + `rect.w/h>0`. 43/43 image.url point at the local WP media library;
43/43 attachment-backed; 0 placeholders.

### (B) Announcement bar below nav (order inverted) → FIXED
Source `<body>` order is `<a class="annc">` (the "Clerk raises $50m Series C" bar) FIRST, then
`<header class="hdr">`. `splitSiteParts()` detached `<header>` and the ad-hoc full-page
recompose prepended it at the very top — above the announcement bar — so nav rendered ABOVE
announce. Fix: the full-page driver runs `transpile({ siteParts:false })` so the header stays
INLINE at its true DOM position; announcement-above-nav then holds by construction (the Theme
Builder site-part split is still the default for the production/per-page path — only the single
full-page sandbox render opts out). Driver: **`sandbox/render-clerk-fullpage.mjs`** (NEW).
LOOK + DOM probe: announce top=0, nav (Products) top=51 → announce ABOVE nav, `orderCorrect:true`.

### Final state (re-rendered)
- 292 nodes, 0 missing ids (id-stamping intact). Suisse webfont intact.
- Native census UNCHANGED: container 101 · text-editor 112 · image 43 · heading 22 · html 13 ·
  button 1. **0 raster fallbacks** — still entirely native widgets.
- Self-test `_transpile-selftest.mjs`: **42 passed, 0 failed** (updated the P6 sizing assertion
  to the custom-dimension contract; hero icon-button count now walks site parts too).
- As-stored (id-stamped) tree `sha256 e6c1c8af54686e6ca23fc64d3501d39097fbba688448713eab01fcdf7c6968df`;
  composed (pre-id, deterministic) tree `sha1 41e65ef1b02b1a76f8f4cce6c6647bcdcd9a063d`.
- Reproduce: `node sandbox/render-clerk-fullpage.mjs --page 83` (omit `--no-upload` to re-import).

## Artifacts

- Rendered page: `http://localhost:8001/?page_id=83` (→ `/clerk-fullpage/`)
- `clerk-fullpage-1440.png` — full page @1440
- `hero-band-1440.png` — hero band (Suisse LOOK)
- `tree-composed.json` — id-less composed tree fed to render.mjs
- `tree-rendered.json` — as-stored tree (ids stamped by render.mjs `ensureIds`)
- `transpile-report.json`, `assets-manifest.json`, `joist-clerk-fonts.mu-plugin.php`

**Tree hash (as-rendered, id-stamped):**
`sha256 680173d4acd1c1e74154fb410f56ac12684bca30c0d95a6cdc1f1dd87e4a82b6`
(composed pre-id tree: `sha256 701656777b1e9041686bf3f0b521ce3f4e6b6f09b0a7792678b0f056c3568b4f`)

## render.mjs change

Large full-page trees (100s of KB) blew past `ARG_MAX` on the old
`wp post meta update _elementor_data "$(cat …)"` argv-inlining path. `injectTree` now
writes the meta from the mounted file via `wp eval-file /update-meta.php`
(`update_post_meta($id,'_elementor_data',wp_slash(file_get_contents('/tree.json')))`),
so any page size renders. Verified round-trip: stored meta decodes to 292 nodes, 0 missing ids.

## 4. Page-scale fidelity — JUDGED (gated vision-judge, median-of-3)

Hash-bound to the as-rendered tree `sha256 680173d4…` (VERIFIED on disk == build report).
Source = live clerk.com, pinned judge 46ef7bb (overlays dismissed, marquee/anim frozen,
labels off-content). Clone = the LOCAL Elementor render (`/clerk-fullpage/`, page 83).
`judge/results.json`, `judge/run.log`, 32 tiles, cost $5.3.

| width | Elementor pageScore | base | penalty | hRatio | HTML ceiling | raw loss |
|-------|--------------------|------|---------|--------|-------------|----------|
| 1440  | **41.7**           | 59.7 | 18      | 0.903  | 65.6        | 23.9     |
| 1250  | **12.3**           | 47.3 | 35      | 0.777  | 45.7        | 33.4     |

Hero-only Elementor (page 82, single band, no recompose/marquee/reflow) = **82**.

### Judge-hygiene (artifact flags — the page number is artifact-DEFLATED)
3 sev5s total:
- **1440 t03** (score 28, align=unmatched) — sev5 "white bg vs dark" + sev4 "contrast
  inverted": **ARTIFACT.** Band-boundary: src=hero/dark-band-start vs clone=white
  components-intro. The clone is correctly white there, NOT inverted. LOOK-confirmed.
- **1440 t16** (score 30, sev4 "white wedge in dark"): **ARTIFACT.** Dark→white
  section-boundary offset by cumulative hRatio (clnY 5075 vs srcY 5515). LOOK-confirmed.
- **1250 t02** (score 18, align=unmatched) — sev5 "bottom 60% black void / content absent":
  **ARTIFACT.** clnSpan 0.62× srcSpan; the clone window slid into the next dark section
  because of hRatio 0.777. The clone content IS present at a different y. LOOK-confirmed.
- **1250 t04** (score 32) — sev5 "grid destroyed to single column": **REAL but OVERSTATED.**
  Clone bento IS a multi-column dark grid (reordered/misaligned), not single-column;
  flex-bento regroup at off-authoring width = authoring-limit.

At 1250 the band-matcher squeezed clone windows to 30–63% of source span on **t02/t03/t06/t10**
(hRatio 0.777) → those "void/collapsed/absent" defects are GEOMETRIC artifacts of the squeeze.
Artifact-adjusted: 1440 base excl t03+t16 = **64.3** → honest 1440 pageScore ≈ **52–58**
(loss vs ceiling ≈ **8–13**). 1250 raw 12.3 is heavily deflated; honest 1250 is well above 12.3.

### Worst REAL tiles (classified)
1. **1440 t00 (38)** — header/announce in REVERSED vertical order (announce-below-nav vs
   source announce-above-nav) + nav bg dark vs white + "PricingSign in" merged.
   → **TRANSPILATION-LOSS** (P7 site-part recompose flipped order). FIXABLE.
2. **1250 t00 (52)** — same header reversal + hero PRIMARY CTA "Start building for free"
   (purple) dropped/unstyled at 1250 (renders correct #6c47ff/r17 at 1440).
   → **RESPONSIVE-AUTHORING-LIMIT** (CTA regroup off authoring width) + frozen-marquee.
3. **1440 t02 (32)** — logo wall shows different customer logos (marquee-phase divergence)
   + boxed cells vs borderless. → **AUTHORING-LIMIT** (frozen static row can't match a live
   marquee's pinned phase; cell-border is a real minor defect).

### Page-scale verdict
The page-scale transpilation loss is **LARGER** than the hero-only 6pt (88→82): the hero was
one band with no site-part recompose, no marquee, no responsive reflow, no multi-section
height accumulation. Genuine page-scale residuals: (1) header/announce recompose ORDER bug
[transpilation-loss, FIXABLE]; (2) frozen-marquee logo divergence [authoring-limit];
(3) hero CTA drop at 1250 [responsive-authoring-limit]; (4) desktop-frozen CSS-math vertical
compression at 1250 (hRatio 0.777) [transpilation-loss — the abs/desktop-only ceiling].
ZERO new undeclared breakage; 292 native widgets, 0 raster fallback, Suisse webfont correct.
Grader-hygiene item recurs (band-boundary transition tiles t03/t16 + height-squeeze unmatched
tiles deflate the headline) — fold band-boundary-tile suppression into the next round.
