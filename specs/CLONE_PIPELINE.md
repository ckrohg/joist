# Joist Clone Pipeline — design spec

**Date:** 2026-05-13. **Status:** v0 design doc, no code. **Targets:** v1.5+ (post v1.0 OSS launch).

Designed against the **90%+ native-fidelity** target (not the 75% industry baseline). Grounded in 6 parallel research streams covering prior art, vision-LLM SOTA, headless browser tooling, Elementor expressiveness ceiling, and design-system extraction. See `memory/clone_pipeline_architecture.md` for the source-of-record on the research synthesis.

---

## 1. Goals & honest non-goals

### Goals
- URL → Elementor page clone with **90%+ section-level native widget fidelity** on marketing pages
- Visual fidelity **SSIM ≥ 0.97 at all three viewports** (desktop / tablet / mobile)
- Time-to-clone: **< 90 seconds** for a typical marketing page (10–15 sections)
- **First-class "Won't Convert" report** as output, not afterthought — every skipped pattern named with touch-up time estimate
- **Editable output** — clone produces real Elementor widgets the user can immediately edit in the UI, not opaque HTML widgets (except where genuinely necessary)
- Multi-pass refinement loop — never accept first-attempt fidelity if it falls short of gates
- Constrained scope as quality strategy — refuse to clone what we can't do well, frame it as a positive signal

### Non-goals (explicit)
- **Pixel-perfect bit-equal cloning of arbitrary URLs** — not achievable in 2026. Anyone selling it is selling fiction.
- Clone of Awwwards-style art-directed sites with heavy WebGL / custom motion — flagged out of scope at preflight
- Clone of authentication-gated, geo-fenced, or anti-bot-protected sites without human-supplied HAR file
- Form action wiring, integration credentials, CMS query reproduction — structure transfers; wiring doesn't
- Page-relationship preservation (nav menus across cloned pages auto-wiring) — v3
- Multi-language site clone — v3 with i18n adapter (Polylang/WPML)

### What "90%+" actually means

Three orthogonal metrics, all enforced as hard gates:

1. **Structural fidelity** (≥ 90%): fraction of source-page widget weight (by visual area) that lands in native Elementor widgets (including Joist Widget Pack — see §3) vs. HTML-widget fallback
2. **Visual fidelity** (SSIM ≥ 0.97 per viewport): pixel-level structural similarity between clone and source render
3. **Content fidelity** (≥ 99% text accuracy, 100% image presence): every text node, image asset, link target preserved exactly

Sections that fail any gate after multi-pass refinement → flagged in the "Won't Convert" report with a specific diff overlay. Never silently shipped.

---

## 2. Pipeline overview

The Builder.io Visual Copilot pattern, adapted for Elementor + iterative refinement:

```
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 1 — Preflight                                                │
│    URL classifier: marketing-page (clone) / app (refuse) /          │
│    art-direction (warn + reduced scope) / blocked (anti-bot path)   │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 2 — Scrape (Playwright Chromium dedicated worker)            │
│    3 viewports captured separately: 1440 / 768 / 390                │
│    DOM + computed styles + bounding rects per viewport              │
│    Cross-viewport correspondence via stamped data-scrape-ids        │
│    Asset inventory (images, fonts, videos, stylesheets)             │
│    Anti-bot: vanilla → playwright-extra-stealth → paid unblocker    │
│    Output: scrape_id.json + assets/ in R2                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 3 — Design system extraction (deterministic, Dembrandt-ish)  │
│    UI-element pass + pixel-pass tiebreaker, OKLCH clustering        │
│    Outputs: palette (6–10 tokens), type stack + scale, spacing,     │
│      radii, shadows — DTCG-compatible JSON                          │
│    Quality gates: sample-count + round-trip CSS + visual diff       │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 4 — Section segmentation (VIPS-style on DOM + styles)        │
│    Vertical-band detection: visual coherence groups                 │
│    Output: ordered list of candidate sections with bounding boxes   │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 5 — Archetype classification (Claude Opus 4.7 vision)        │
│    Per-section crop → archetype label from 20-pattern taxonomy      │
│    Confidence < 0.7 → HTML-widget faithful fallback                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 6 — Content extraction (per-archetype, deterministic)        │
│    Archetype-specific extractors pull structured content from DOM   │
│    (hero: headline/sub/CTA/media; pricing: tier×N; etc.)            │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 7 — IR composition (Mitosis-pattern framework-agnostic IR)   │
│    Sections × content × design tokens → IR tree                     │
│    Single IR can later target Bricks / Gutenberg / Breakdance       │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 8 — Elementor emitter                                        │
│    IR → Elementor element tree (containers + native widgets +       │
│      Joist Widget Pack widgets where applicable)                    │
│    Kit setup: write inferred system_colors + system_typography       │
│    Apply widget_defaults for spacing/radii/shadows                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 9 — Multi-pass refinement loop  ◀──────────────┐             │
│    Render Elementor output, screenshot at 3 viewports │             │
│    Diff vs source: SSIM + CIEDE2000 + Butteraugli     │             │
│    SSIM < 0.97 in any section? → re-attempt that      │             │
│      section with concrete diff feedback to vision    │             │
│      model. Max N=5 iterations.                       │             │
│    SSIM ≥ 0.97 all sections all viewports?  ──── YES ─┘             │
│                  │                                                  │
│                  ▼  NO after N iterations                           │
│    Flag section in "Won't Convert" report                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STAGE 10 — Plan Mode presentation                                  │
│    Whole site bundled into a Plan Mode plan (one step per page)     │
│    "Won't Convert" report attached                                  │
│    User reviews in WP admin, approves, PlanExecutor commits         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Dependency: the Joist Widget Pack (v0.9)

**The clone pipeline depends on the Widget Pack** (see `specs/WIDGET_PACK.md`). Without it, the 8 structural walls in Elementor's expressiveness ceiling force HTML-widget fallback for common marketing-page patterns, dropping native fidelity below 90%.

With Widget Pack shipped:
- Subgrid layouts → Joist Subgrid toggle
- Scroll-driven horizontal pin → Joist Pin-Scroll widget
- View Transitions → Joist View Transitions runtime
- Variable-font axis animation → Joist Variable Heading widget
- True masonry → Joist Masonry Grid widget
- Animated SVG morphs → Joist Morph SVG widget
- DOM reparenting per breakpoint → Joist Reparent (or duplicate-and-hide)
- Flex↔grid swap → Joist Display-swap extension

**Two unsolvable patterns remain** (Container Queries crossing widget boundaries, `:has()` crossing widget boundaries) — both genuinely edge cases in marketing pages.

The Widget Pack moves the structural-fidelity ceiling from ~85% (Elementor + Pro alone) to ~95% (Elementor + Pro + Joist Widget Pack). The remaining 5% gets HTML-widget *faithful* fallback (captured CSS preserved), which is visually 100% but structurally code-not-widgets.

---

## 4. Stage details

### 4.1 Preflight (URL classifier)

Single agent call: fetch the URL meta + small headless screenshot, classify into:

- **`marketing-page-standard`** (proceed): site uses semantic HTML, sections detected, no detected anti-bot, ≤ 6 of the 20 archetypes recognized → high-confidence clone target.
- **`marketing-page-art-directed`** (proceed with warning): heavy WebGL, custom-cursor JS, scroll-driven full-page effects, non-semantic div-soup. User sees a confidence warning before paying for the clone.
- **`app`** (refuse): React/Vue SPA with auth-gate detected, heavy state, dynamic content. "This is an application, not a marketing page — clone tool can't faithfully represent it."
- **`blocked`** (anti-bot path): Cloudflare Turnstile / DataDome / CAPTCHA detected. Offer (a) paid-unblocker retry (v2 feature), (b) human-supplied HAR/screenshot bundle path.

Implemented as a Claude Opus 4.7 vision call on a single desktop screenshot + small DOM sample.

### 4.2 Scrape layer

**Tool:** Playwright (Chromium channel), Node SDK. **Hosting:** dedicated Node worker on Fly.io running `mcr.microsoft.com/playwright:v1.50-jammy`, Redis-backed BullMQ queue, R2 storage. **Not** Vercel functions (Chromium and serverless are structurally incompatible at scale).

**Three viewport captures, each in a separate `BrowserContext` (parallelized):**
- **Desktop** 1440 × 900 (canonical)
- **Tablet** 768 × 1024
- **Mobile** 390 × 844
- **Optional hero pass** 1920 × 1080 (for hero asset capture at native resolution)

**Per-viewport sequence:**
1. `context.newPage()` with viewport + device-scale + Chrome 130 user-agent
2. `page.emulateMedia({ reducedMotion: 'reduce' })` (kills CSS animations)
3. Inject CSS override: `*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }` (belt-and-suspenders)
4. `page.goto(url, { waitUntil: 'domcontentloaded' })`
5. Settle wait: `waitForLoadState('load')` + mutation-observer idle for 750ms (**NOT `networkidle`** — hangs on SPAs with analytics/chat widgets)
6. Cookie banner dismissal via dictionary of ~25 known selectors + regex fallback
7. Throttled auto-scroll to bottom (steps of `viewport.height * 0.8`, 400ms pause each) to trigger IntersectionObserver lazy-loads, then scroll back to top
8. Stamp **`data-scrape-id`** on every element during the desktop pass: `sha1(tagName + class + textContent.slice(0,40) + nthChildPath)` — survives reflow ~95% of static marketing sites
9. Full-page screenshot (`animations: 'disabled', caret: 'hide'`)
10. Extract DOM + filtered computed styles + bounding rects via `page.evaluate`
11. Drain network log for asset inventory

**Cross-viewport correspondence:** preferred — stamped `data-scrape-id`. Fallback for sites where the DOM swaps between viewports (rare): similarity matching on `(tagName, textContent, ancestor-chain)`.

**Anti-bot escalation ladder:**
1. Vanilla Playwright + Chrome 130 UA
2. `playwright-extra-stealth` (gets past basic detection)
3. Camoufox patched Firefox (free, substantially better)
4. Paid unblocker (Bright Data / ZenRows / Scrapfly) — v2 feature, gated behind user flag

**Computed-styles filter — Elementor-relevant subset only** (~40 properties): layout, typography, background/border, effects.

**Scrape output contract** — single JSON document per scrape:
```jsonc
{
  "scrape_id": "scr_...",
  "source_url": "...",
  "captured_at": "...",
  "success": true,
  "warnings": [],
  "viewports": {
    "desktop": {
      "width": 1440, "height": 900,
      "screenshot_key": "r2://...",
      "dom": "<serialized tree with scrape_id stamps>",
      "computed_styles": { "<scrape_id>": { "...filtered props" } },
      "bounding_rects": { "<scrape_id>": {"x":0,"y":0,"w":0,"h":0} }
    },
    "tablet": { "..." },
    "mobile": { "..." }
  },
  "assets": {
    "images": [...], "fonts": [...], "videos": [...],
    "stylesheets": [...], "svgs_inline": [...]
  },
  "meta": { "title": "...", "description": "...", "lang": "en", "framework_guess": "wordpress|react|webflow|..." },
  "diagnostics": { "cookie_banner_dismissed": true, "scroll_passes": 4, "anti_bot_detected": false, "timing": {...} }
}
```

### 4.3 Design-system extraction

**Two-stream evidence approach (Dembrandt-pattern).** Output: DTCG-compatible JSON, fed into Stage 8's kit setup.

**Color palette:**
- UI-element pass (high signal, weight 1.0): walk DOM, sample `color`/`backgroundColor`/`borderColor`/`fill`/`stroke` per element, tag by role (heading/body/link/button-bg/etc.). Buttons + links + H1-H3 weighted highest.
- Pixel pass (low signal, capped 20%): MMCQ on hero screenshot with `<img>`/`<video>` elements masked. Tiebreaker only.
- Cluster in **OKLCH** with `ΔE_OK < 0.02` merge threshold. Snap near-greys (chroma < 0.02) to neutral ramp.
- Solves "skin tones from founder photo" by weighting UI elements over photography.
- Role assignment: primary (button bg), accent (link/icon highlight), secondary (hover/derived), text, text-muted, background, surface, border, success/warn/error/info.
- Output: 6–10 named tokens.

**Typography:**
- Per-text-node collection: `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`, `font-variation-settings`.
- Use CSS Font Loading API: `document.fonts.check('16px "Inter"')` to identify *rendered* face vs. declared stack.
- Web-font discovery: parse `CSSFontFaceRule` from `document.styleSheets`, capture `src` URLs + axis info via `opentype.js` on the `.woff2`.
- Clustering: largest avg `font-size` on `h1..h3` = **display**; most-common face on `p/li/span` = **body**; any `mono|code|courier|menlo` family = **mono**.
- Type scale: collect unique `font-size` values, compute pairwise ratios, fit against canonical ratios (1.125 / 1.2 / 1.25 / 1.333 / 1.414 / 1.5 / 1.618). RMSE < 0.04 → emit modular scale; else literal sizes.

**Spacing scale:** collect all `padding`/`margin`/`gap`, 1px binning + k-means (or GCD), snap to canonical `[4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128]` with ±2px tolerance.

**Radii:** snap to `none(0) / sm(2–6) / md(8–14) / lg(16–28) / full(≥9999)`.

**Shadows:** parse multi-shadow `box-shadow`, normalize layers, cluster by `offsetY + blur/2`, output 3–5 elevation buckets.

**Three quality gates before commit:**
1. **Sample-count gate** — each token must have ≥ N supporting samples (3 spacing/radii, 5 colors, 8 type sizes)
2. **Round-trip CSS test** — re-render with inferred tokens, measure: CIEDE2000 ΔE < 3 per role color, computed-font-family equality on display/body, px-diff < 4 on top-20 selectors' spacing
3. **Visual diff** — SSIM ≥ 0.97 at 360/768/1280 viewports

Failure of any gate → surface diff artifacts to the agent for token-level correction before commit. Never silently use a low-confidence token.

**Elementor Kit mapping:**
- `system_colors` (4 slots): primary, secondary, text, accent — populated from inferred tokens
- `custom_colors`: all semantic + surface + border tokens with stable kebab-case `_id`s
- `system_typography` (4 slots): primary (display/h1), secondary (h2/h3), text (body), accent (subheads/eyebrows)
- `custom_typography`: caption, overline, mono, etc.
- **Spacing/radii/shadows → `widget_defaults.json`** (NOT the Kit — Elementor has no Kit slot for them). Every Button, Container, Card pulls from the same scale at widget-emit time.

### 4.4 Section segmentation

**VIPS-style algorithm** (Vision-based Page Segmentation, 2003 — still canonical):

Walk the DOM bottom-up. For each container element, score visual coherence of its children:
- All children share background-color / background-image? Coherent.
- Visual-block boundary detected (full-width child with distinct background)? Section break.
- Use computed styles + bounding rects, not just DOM tree.

Output: ordered list of root-level "section candidates" with bounding rects and DOM-subtree pointers.

Modern hybrid: combine VIPS structural pass with vision-LLM agreement check on borderline cases (≥ 2 candidate boundaries within 50px).

### 4.5 Archetype classification

For each candidate section: crop the screenshot to the section's bounding box, send to Claude Opus 4.7 with the 20-archetype taxonomy + few-shot examples.

**Prompt (sketch):**
> Classify this section of a marketing page into one of: navbar, hero (centered / split / video-bg / with-screenshot / with-form), announcement-bar, logo-cloud, stats-row, testimonials (single / carousel / grid), case-study-grid, feature-grid (2 / 3 / 4-col), alternating-feature, feature-with-screenshot, bento-grid, how-it-works-steps, comparison-table, pricing-table (2 / 3 / 4-tier), cta-banner, newsletter-signup, contact-form, faq-accordion, blog-index, team-grid, footer, unknown.
> Return JSON: `{archetype, sub_variant, confidence_0_to_1, rationale}`.

**Confidence-based routing:**
- ≥ 0.7 confidence → proceed to per-archetype content extraction (Stage 6)
- < 0.7 confidence → HTML-widget faithful fallback (preserve source HTML + CSS for that section)

### 4.6 Content extraction (per-archetype)

Each archetype has a **deterministic** extractor that walks the section's DOM subtree and produces a typed content payload:

```ts
// Examples
HeroCentered: { headline, subhead, primary_cta, secondary_cta?, media? }
PricingTable: { tiers: [{ name, price, period, features: string[], cta }] }
FeatureGrid: { columns: number, items: [{ icon?, headline, body }] }
FaqAccordion: { items: [{ question, answer }] }
LogoCloud: { logos: [{ alt, src }] }
```

The extractor is the *most reliable* part of the pipeline — it works against semantic DOM (headings, lists, buttons) with stable selectors per archetype. Quality bar: extractor accuracy > 95% for well-structured sites.

**HTML-widget faithful fallback** path: capture section HTML + computed-styles-resolved CSS + asset references. Output: a single Elementor HTML widget per fallback section, with the CSS inlined in a scoped `<style>` block. Visually 100% faithful; not editable as widgets.

### 4.7 IR composition

Framework-agnostic intermediate representation (Mitosis pattern):

```ts
type IRNode = {
  type: 'container' | 'widget' | 'fallback';
  archetype?: ArchetypeId;           // for typed containers
  widget?: WidgetType;                // for specific widgets
  content?: TypedContent;             // archetype payload
  layout?: LayoutSpec;                // grid/flex/etc., per-viewport
  style?: StyleSpec;                  // bound to tokens, not literals
  children?: IRNode[];
  fallback_html?: string;             // HTML-widget content if type === 'fallback'
};
```

IR is the boundary between extraction and emission. The same IR can later target Bricks (`@joist/bricks-emitter`), Gutenberg (`@joist/gutenberg-emitter`), Breakdance, etc.

### 4.8 Elementor emitter

IR → Elementor element tree.

For each IRNode:
- `type: 'container'`: emit Elementor container with `flex_direction`, `flex_align_items`, etc. from `layout`. Bind colors/typography to kit globals via `__globals__` references (per constraint #26).
- `type: 'widget'`: emit specific widget (native Elementor or Joist Widget Pack) with settings bound from `content` + `style`.
- `type: 'fallback'`: emit single HTML widget containing the captured HTML + scoped `<style>`.

Output: Elementor `_elementor_data` JSON ready to `POST /joist/v1/pages`.

**Kit setup:** before emitting pages, `PUT /joist/v1/kit` with the inferred design system → all subsequent widget settings reference kit globals.

**Widget defaults:** apply spacing/radii/shadows from `widget_defaults.json` as widget settings during emit. Every Button gets the same default padding/radius/shadow combo derived from the source's inferred scale.

### 4.9 Multi-pass refinement loop

**The architectural commitment that gets us from 75% → 90%+.**

```
do {
  emit_elementor_pages()
  render_via_headless_chrome_at_3_viewports()
  diff_against_source()
  worst_section = section_with_lowest_ssim()
  if (worst_section.ssim >= 0.97) break

  re_attempt_section(
    worst_section,
    diff_overlay: pixel_diff_image,
    failure_modes: detected_issues  // "padding off by 12px", "wrong font weight", etc.
  )
} while (iterations < 5 && any_section_below_threshold())
```

**Refinement strategies the loop can apply** (vision model picks one per failure mode):
- Adjust widget padding/margin from inferred scale
- Switch widget type (e.g., from `feature-grid-3col` to `feature-grid-with-icon`)
- Inject Custom CSS to nudge alignment
- Toggle the Joist Widget Pack equivalent if a native widget produced low fidelity
- Last resort: convert the section to HTML-widget faithful fallback

**Hard gate:** any section that fails to reach SSIM ≥ 0.97 after 5 iterations is flagged in the "Won't Convert" report with the pixel-diff overlay shown to the user.

### 4.10 Plan Mode presentation

The clone produces a multi-page Plan Mode plan:
- One plan step per source page
- Steps include: kit-setup, page-create, per-page-patches
- Plan attached: scrape diagnostics, design-system inference confidence scores, per-section fidelity scores, "Won't Convert" report
- User reviews in WP admin Plan Review page (Joist v0.7+ UI), approves, PlanExecutor commits atomically with full rollback

---

## 5. The "Won't Convert" report

A first-class output of every clone, NOT an afterthought. Shown alongside the converted page in Plan Mode.

```jsonc
{
  "clone_id": "cln_...",
  "summary": {
    "sections_total": 14,
    "sections_native": 13,
    "sections_html_fallback": 1,
    "structural_fidelity_pct": 95.2,
    "visual_fidelity_ssim": {"desktop": 0.984, "tablet": 0.971, "mobile": 0.968},
    "estimated_touch_up_minutes": 25
  },
  "skipped_or_flagged": [
    {
      "section_index": 4,
      "archetype": "hero-with-screenshot",
      "issue": "scroll-driven horizontal pinning detected — captured as Joist Pin-Scroll widget but pin distance differs from source by 18%",
      "diff_overlay": "r2://...",
      "touch_up_estimate_minutes": 5
    },
    {
      "section_index": 7,
      "archetype": "unknown",
      "confidence": 0.42,
      "issue": "section pattern not recognized; captured as HTML widget (visually faithful, code-not-widgets)",
      "diff_overlay": "r2://...",
      "touch_up_estimate_minutes": 15
    },
    {
      "section_index": 11,
      "archetype": "feature-grid-3col",
      "issue": "GSAP scroll animation not transferred — section is static",
      "diff_overlay": "r2://...",
      "touch_up_estimate_minutes": 5
    }
  ],
  "assets_status": {
    "images_imported": 23, "images_failed": 0,
    "fonts_imported": 2, "fonts_failed": 0,
    "videos_external_links": 1
  }
}
```

**Why this matters strategically:** every prior tool either silently drops things or pretends to convert them. Surfacing exactly what was skipped + the touch-up time estimate is what differentiates a serious product from another "100% editable" marketing claim. It's also a quality signal — "we got 95% on this page, here's what we missed" beats a dishonest "perfect clone."

---

## 6. Fidelity targets (the hard numbers)

| Target | Bar | Enforcement |
|---|---|---|
| Structural fidelity | ≥ 90% widget-mapped natively (incl. Joist Widget Pack) | Multi-pass refinement loop; HTML-widget fallback below 90% triggers per-section flag |
| Visual fidelity | SSIM ≥ 0.97 at all 3 viewports | Hard gate; sections failing after 5 iterations → flag |
| Content fidelity | ≥ 99% text accuracy, 100% image presence | Deterministic extractors; image asset count match |
| Time-to-clone | < 90s for typical marketing page | Scrape ~30s + stages 3–8 ~30s + refinement loop ~30s budget |
| Touch-up time | < 30 min average per cloned page | Set by archetype coverage; flagged in report |

---

## 7. Five must-have architectural decisions (validated by research)

1. **DOM access via headless Chromium is non-negotiable.** Static fetch never works; every serious tool extracts from the live computed-style tree. The Fly.io worker is budgeted from day one.
2. **Insert an IR between extraction and emission** (Mitosis pattern). Gives optionality and survives Elementor data-model changes.
3. **Three viewports captured separately** — not inferred. This is `html.to.design`'s honest design choice and it's correct.
4. **Ship "Won't Convert" report as first-class output** — every prior tool silently drops things; we surface them with touch-up estimates.
5. **Multi-pass refinement loop with hard SSIM gates is non-negotiable** — this is the architectural commitment that pushes us from 75% to 90%+. Single-pass is the industry baseline; iteration is the differentiator.

---

## 8. Phased delivery

| Phase | Scope | When |
|---|---|---|
| **v0.5–v0.9** | Plugin foundation + Widget Pack (8 widgets/extensions) — prerequisite | Weeks 1–13 of v1 timeline (already in motion) |
| **v1.0** | OSS launch — plugin only, no clone pipeline yet | Week 14–16 |
| **v1.5** | Clone pipeline α — preflight + scrape layer + design-system extraction. Reads URL, produces inferred design system + asset inventory, no page generation. | Months 4–6 post-v1.0 |
| **v1.7** | Clone pipeline β — full pipeline end-to-end on the 20 archetypes. Single-pass conversion. Honest reporting. | Months 6–9 post-v1.0 |
| **v2.0** | Clone pipeline GA — multi-pass refinement loop, hard SSIM gates, per-archetype specialized extractors, hosted SaaS surface for the scrape layer | Months 9–12 post-v1.0 |
| **v2.5+** | Per-archetype quality improvements driven by usage telemetry, custom user-trained patterns, alternative emitters (Bricks/Gutenberg) | Year 2 |

---

## 9. Open questions

1. **Pricing model for clones in v2 SaaS** — per-clone usage fee + monthly limits? Free with watermark? TBD with SaaS launch.
2. **HTML-widget fallback styling** — preserve source CSS verbatim, or run it through a sanitizer/normalizer? Sanitization risks breaking visual fidelity; verbatim risks XSS. Recommendation: verbatim with CSP, KSES strip on save.
3. **Multi-page clone scope** — when cloning a 10-page site, do we re-run scrape per page or hold one browser context across all pages? Recommendation: shared context for nav-linked pages, fresh context otherwise.
4. **Author attribution / provenance** — should cloned pages carry metadata about the source URL and clone date? Recommendation: yes, in postmeta, for audit and legal CYA.

To resolve before v1.5 begins.

---

## 10. Hard constraints (what we don't promise even with multi-pass)

- **Custom JS interactions** (calculators, configurators, sliders with custom behavior) — captured as HTML widget, functionality preserved only if source JS is included verbatim
- **Form action endpoints + integrations** (Mailchimp, HubSpot, custom webhooks) — structure transfers, wiring requires human re-configuration
- **CMS-driven dynamic content** (e.g., "Featured products" pulled from Shopify) — snapshot only; user re-binds to their own CMS
- **A/B-tested variants** behind feature flags — we capture whatever instance was served
- **Authentication-gated content** — refuse at preflight
- **Geo-fenced content** — captured from the worker's location (US East by default)
- **Real-time content** (live feeds, chat embeds, dynamic stock) — snapshot or skip

All of these are surfaced in the "Won't Convert" report. None are silent.
