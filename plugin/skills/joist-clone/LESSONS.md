# joist-clone — Accumulated Lessons (the "tenet within")

> **Canonical corpus moved.** Lessons now live in `plugin/skills/lessons/` split into
> `LESSONS_MECHANICAL.md` (shared across clone/build/edit) + `LESSONS_CLONE.md` (clone-specific).
> Write new lessons there. This file is retained for the existing skill reference until the
> skill is repointed. Mechanical gotchas → the shared file, so build and edit inherit them.

Every generation gotcha discovered through the iteration loop lands here. Future runs of the skill consult this file FIRST so they don't rediscover the same issues. This is the seed of the cross-session learning corpus — eventually fed by `joist_log_iteration` telemetry across all installations.

Format per lesson:
```
## <short title>
**Discovered:** <date> | <iteration>: <source_url>
**Symptom:** <what went wrong visibly>
**Root cause:** <why>
**Fix:** <concrete change>
```

---

## Joist auto-created pages are status=draft by default

**Discovered:** 2026-05-31 | v4 clone of peakinteractive.io  
**Symptom:** Anonymous visitors (including Playwright screenshot) saw JupiterX 404 "Whoops, no result found!" — clones were only viewable by logged-in admins.  
**Root cause:** `PageFactory::createBlankElementorPage` defaults pages to `draft`. Joist's MCP write flow never publishes them.  
**Fix:** After `joist_execute_plan` always POST `{"status":"publish"}` to `/wp-json/wp/v2/pages/<id>` with admin credentials. Or wait for plugin patch.

---

## `_flex_basis` on inner containers doesn't compile to CSS on V3

**Discovered:** 2026-05-31 | v6 clone (case study card layout)  
**Symptom:** Cards meant to be horizontal (text-left + image-right) rendered stacked vertically despite flex_direction:row + flex_wrap:nowrap on parent. DOM inspection showed inner containers at full parent width (~1320px) instead of 480/520px.  
**Root cause:** Elementor V3 inner containers' `_flex_basis` setting (with leading underscore) is silently dropped during CSS compilation when `_flex_size` isn't also set. Grep of the compiled post CSS showed zero `--flex-basis` rules even though the saved tree had `_flex_basis: {unit:px, size:480}`.  
**Fix:** Use explicit `width: {unit:%, size:N}` on inner containers instead. e.g. text col `width: 45%`, image col `width: 53%`. The `width` setting reliably compiles to `--width` CSS variable.

---

## placehold.co `?text=` empty renders the dimensions text

**Discovered:** 2026-05-31 | v2 clone (Trust by logos section)  
**Symptom:** `https://placehold.co/1200x100/F3F2EC/F3F2EC` rendered the literal text "1200 × 100" inside the placeholder — looks like an obviously-broken wireframe.  
**Root cause:** placehold.co default behavior is to show dimensions when no text param is given.  
**Fix:** Append `?text=+` (the `+` URL-encodes to a space which renders invisibly). Or use a colored block via `/1200x100/F3F2EC/F3F2EC?text=+`.

---

## V4 atomic auto-fields trip hash defense unless stripped

**Discovered:** 2026-05-30 | v0.10 Joist plugin work  
**Symptom:** Plans that authored cleanly on V4 sites (e.g. Elementor 4.0.9) failed `atomic_save_silent_failure` even though Document::save() returned success.  
**Root cause:** V4 atomic transformer adds `id`, `isInner`, `styles`, `interactions`, `editor_settings`, `version`, and `elements:[]` (on widget nodes) to every save. Joist's strict-hash check interpreted this as silent corruption.  
**Fix:** Use `Hasher::forElementsLenient()` for the silent-save check on V4 sites. Strips the auto-added fields before hashing. See `knowledge/V4_ATOMIC_NORMALIZATIONS.md`.

---

## Source visual language requires fetching compiled CSS, not just HTML

**Discovered:** 2026-05-31 | v2 clone (initial palette extraction)  
**Symptom:** WebFetch on source URL returned only structural content (section list, headlines) but no palette / typography / weights. First-pass clones used generic dark/cream/chartreuse instead of source's real orange/black/white.  
**Root cause:** WebFetch is HTML-only and doesn't follow `<link rel=stylesheet>`. Site's brand palette + fonts live in the compiled per-post Elementor CSS, not in the HTML.  
**Fix:** Curl the compiled CSS directly: `curl <origin>/wp-content/uploads/elementor/css/post-<id>.css`, then `grep -oE "#[0-9a-fA-F]{6}" | sort | uniq -c | sort -rn` to find the brand palette by frequency. Also `grep -oE "font-family:[^;]+"` and `grep -oE "font-size:[^;]+"` for type vocabulary.

---

## Full-page screenshots compress detail; use focused captures for grading

**Discovered:** 2026-05-31 | v7 clone (case study card verification)  
**Symptom:** Full-page screenshot of a tall page (multi-thousand pixels) compressed each section so small that images appeared missing on lower cards — looked like cards 2-4 had no images despite DOM inspection confirming all 4 had `imgs:1`.  
**Root cause:** The screenshot was full-page but rendered in a thumbnail proportional to the agent's image-viewing size, so details below the fold became too compressed to evaluate.  
**Fix:** Capture viewport-sized (not full-page) screenshots focused on specific sections by scrolling target elements into view first. Use a small Node script with Playwright's `locator.scrollIntoViewIfNeeded()` then `page.screenshot({fullPage: false})`. ALSO measure DOM bounding boxes — a card that's 600px tall renders horizontally; 1000px+ means it stacked.

---

## Client logo carousels are JS-loaded; static HTML scrape misses them

**Discovered:** 2026-05-31 | v3 clone (social proof section)  
**Symptom:** Static HTML curl of peakinteractive.io returned only 3 partner badges in image tags, even though the rendered site shows 10+ rotating client logos.  
**Root cause:** Logo carousels (Elementor Pro Logo Carousel widget) lazy-load logo data via JS on page render. Static HTML doesn't include the actual image URLs.  
**Fix:** Use Playwright DOM extraction (the path from `knowledge/PLAYWRIGHT_DOM_EXTRACTION_DESIGN.md`) to get the rendered DOM with all images. For MVP without Playwright extraction: degrade gracefully — use whatever logos are accessible without misleading "placeholder" annotations.

---

## Source-CDN image labels don't match the displayed business

**Discovered:** 2026-05-31 | v7 clone (case study card image rotation)  
**Symptom:** Card labeled "Tint Pros Plus" displayed a Wessell-branded mockup; card labeled "Wessell" displayed Quinn Brothers, etc. Filenames like `smartmockups_lkwsonub-1024x847.png` give no hint to which business they show.  
**Root cause:** The source's image URLs aren't semantically named — they're generated by the smartmockups tool with random slugs. Author can't infer which mockup belongs to which case study without visually inspecting each image.  
**Fix:** Either (a) visually inspect each source image during Phase 1 source analysis and build a manual mapping, OR (b) scrape the source HTML for image alt-text + nearby business name to derive the pairing. Don't assume URL ordering matches case-study ordering.

---

## Joist hashing logs canonical "benign V4 normalization" but agent should re-check live state

**Discovered:** 2026-05-31 | v0.10.6 Joist deploy  
**Symptom:** Successful saves on V4 sites emit `joist.atomic.benign_v4_normalization` info logs (strict hash differs but lenient matches). Some agents misinterpret these as warnings.  
**Root cause:** Logger::info level for diagnostic-only; not actionable.  
**Fix:** Ignore these log entries during normal iteration. Only worry about `joist.atomic.silent_save_failure` (error level).

---

## After 3+ iterations with no score change, you've found the V3 ceiling

**Discovered:** 2026-05-31 | v5→v6→v7 sequence  
**Observation:** Each iteration moved the score by 5+ points when there was room. When the remaining gaps were animation-class (parallax / logo carousel), iteration didn't help — those are V3-uncloneable.  
**Implication:** Stop the loop when score plateaus AND remaining gaps are all in `uncloneable_in_v3`. Report the gaps to the user with the source elements they correspond to.

---

## Always confirm the loop's prerequisites before iterating

**Pattern across all sessions:** Sessions fail when Playwright isn't installed, when the Joist MCP isn't connected, when the user is logged out (can't view drafts), when the source URL is paywalled, or when the source needs JavaScript to render.

**Run prereq checks in Phase 0:**
- `npx playwright --version` (CLI present)
- `mcp__joist-<host>__joist_get_site_info` (MCP connected)
- `curl -sI <source_url>` (URL reachable)
- If source returns minimal HTML and full body via JS, warn the user that visual extraction will be poor.

---

*Append new lessons as discovered. Date each one. Cite the iteration that surfaced it. The corpus compounds.*

---

## MOTION-class lessons (added 2026-05-31 from research-wave synthesis)

## Always run effect detection BEFORE authoring on any motion-bearing source

**Discovered:** 2026-05-31 | post research wave  
**Insight:** Static-site clones author top-down without motion knowledge. Motion-bearing sites need detection FIRST so the tier decision (free CSS / custom CSS / Pro / library / uncloneable) is made before any plan authoring. Otherwise the clone looks 90% right structurally but 0% of the source's motion lands — visible to users as "feels dead."  
**Fix:** Phase 1b (motion detection) is mandatory for any non-trivial source. See MOTION_PLAYBOOK.md + EFFECT_RECOGNITION_AND_DETECTION.md.

## Lenis smooth scroll has accessibility cost

**Discovered:** 2026-05-31 | THIRD_PARTY_MOTION_LIBRARIES research  
**Insight:** Lenis (and Locomotive) hijack native browser scroll to add inertia. Looks premium but breaks screen-reader scroll, breaks ctrl+F find-on-page focus, breaks prefers-reduced-motion respect unless explicitly guarded. ~190 KB total when combined with GSAP+ScrollTrigger.  
**Fix:** Wrap Lenis init in `@media (prefers-reduced-motion: no-preference)` check. Always include the disable path. Don't ship by default — opt in per-page based on the source's actual smooth-scroll signal.

## elementor/frontend/init is the only safe lifecycle hook for embedded libraries

**Discovered:** 2026-05-31 | THIRD_PARTY_MOTION_LIBRARIES research  
**Insight:** Elementor renders widgets via its own JS pipeline. Libraries that depend on DOM elements (GSAP targeting `.elementor-element-X`, Splitting.js wrapping text, etc.) fail intermittently if initialized on plain DOMContentLoaded — the elements may not exist yet.  
**Fix:** Wrap every library init in `document.addEventListener('elementor/frontend/init', () => { ... })`. This fires AFTER Elementor's widget JS has mounted. Universal pattern for all html-widget library embeds.

## Three.js scenes have a ~75% fidelity ceiling regardless of effort

**Discovered:** 2026-05-31 | MOTION_DESIGN_PATTERNS_2026 + recognition research  
**Insight:** Source Three.js scenes are usually custom shaders + bespoke geometry + scroll-driven uniforms. Generic Three.js embed templates (drop-in Vanta backgrounds, premade glTF viewers) hit maybe 75% of what a hand-coded source scene does. Beyond that requires reading the source's custom JS and porting it.  
**Fix:** Detect Three.js, offer Vanta as the cheap stand-in (~75%), explicitly mark "custom-shader scenes" as out-of-reach without source code access.

## Magnetic cursor is JS-only — CSS approximations cap at 40%

**Discovered:** 2026-05-31 | EFFECT_RECOGNITION research  
**Insight:** True magnetic cursor (element snaps toward cursor proximity) requires mousemove + getBoundingClientRect math. CSS `:hover` translate can approximate "cursor near this button" but loses the smooth attraction physics.  
**Fix:** Detect magnetic cursor. If user is on free tier without library embeds, ship CSS approximation but report fidelity at ~40%. Otherwise embed a ~25-line vanilla JS magnetic cursor pattern.

## Pre-flight motion summary BEFORE authoring sets honest expectations

**Discovered:** 2026-05-31 | playbook synthesis  
**Insight:** Mid-iteration grader reports are useful but late. If the source has 6 motion effects and 5 are uncloneable at user's tier, telling them after authoring feels like a bait-and-switch. Tell them BEFORE.  
**Fix:** Phase 1c — pre-flight motion summary lists detected effects, tier required for each, projected fidelity. User confirms tier (or decides to upgrade to Pro / accept the gap) before any plan authoring starts.

## Score motion-class separately, not just overall visual

**Discovered:** 2026-05-31 | MOTION_PLAYBOOK synthesis  
**Insight:** A clone with perfect static layout (90%) but missing 5 motion classes (all 0%) should NOT score 90 overall. The motion gaps are visible to the user even if the screenshot looks similar. Pixel diff of static screenshots doesn't capture motion. Vision grader can compare what's animated AND inspect the source's motion via Phase 1b detection.  
**Fix:** Phase 5 grader includes `motion_scores` object with per-class breakdown. Weight motion classes by visual prominence in source. A "Webflow-class motion-rich" source weighted heavily on motion would top out maybe 60% in V3 free even with perfect static fidelity.

## Top 10 T1 effects deliver ~60% of motion gap closure

**Discovered:** 2026-05-31 | MOTION_PLAYBOOK synthesis  
**Insight:** Per Stream 1 research, 67% of top 100 SaaS pages use scroll-triggered reveals. 70%+ use sticky scroll headers. Common patterns dominate. Hand-implementing 10 reusable T1 patterns (scroll reveals, hover lift, sticky headers, bento grids, marquee, image swap, glassmorphism, Lottie, counters, smooth scroll) closes the majority of typical-site motion gaps.  
**Fix:** When time-boxed, prioritize T1 effects. Defer T3 (Three.js scenes, magnetic cursors, scrollytelling) explicitly.

## GSAP escape-hatch: deliver via plugin runtime (Path A) or content fallback (Path B), gated on capability

**Discovered:** 2026-05-31 | escape-hatch Slice 1, verified live on georges232  
**Insight:** Joist can reclaim 2D scroll motion (reveals/parallax/pin/split-text) with free GSAP. Two delivery paths: **A** — the plugin enqueues vendored GSAP+ScrollTrigger when a page contains `joist-reveal` classes (robust, delay-JS-safe; needs a runtime-bearing plugin build on the site); **B** — inject GSAP+harness as an `html` widget (works on any install, no deploy, but fragile under WP Rocket delay-JS). Pick via `joist_get_site_info` → `capabilities.motion`.  
**Fix:** Author `joist-reveal joist-reveal--<effect>` on the widget's `_css_classes`. If `capabilities.motion` present → Path A only. If absent → also inject `joist-motion-fallback.html`. Same classes drive both, so a Path-B page upgrades to A automatically when the plugin updates.

## Never deliver GSAP as a CDN `<script>` and expect it to run (WP Rocket delay-JS)

**Discovered:** 2026-05-31 | deep-research (22/25 claims @3-0)  
**Insight:** A CDN `<script>` in an HTML widget is the intuitive approach but is REFUTED: WP Rocket "Delay JavaScript Execution" defers ALL in-HTML scripts until user interaction, so it never runs on load. GSAP's own guidance is `wp_enqueue_script`.  
**Fix:** Path A enqueues vendored GSAP via PHP (excludable from delay-JS). Path B is the knowing-fragile fallback only. Verified separately: injected `<script>` blocks DO survive Joist's round-trip hash verbatim (transformations:[]) — so authoring them is safe; *executing* them under caching plugins is the risk.

## Injected scripts survive Joist round-trip; watch for site-level Mixed Content

**Discovered:** 2026-05-31 | Slice 1 live verify  
**Insight:** On georges232 (Elementor 4.0.9, V4) an authored `html`-widget `<script>` + `joist-reveal` classes round-tripped verbatim and the harness ran live (GSAP loaded, all elements bound + revealed). A *separate, pre-existing* site bug surfaced: Elementor's `base-desktop.css` is served over `http://` on an `https://` page → Mixed Content block. Not a motion issue, but it degrades the page; flag site-URL/SSL config to the user.  
**Fix:** Don't conflate site-config errors with motion failures during grading. Check console errors' source before attributing.

## Container `_css_classes` doesn't render to the DOM on V4; widget classes do

**Discovered:** 2026-05-31 | Slice 3 guardrail test, Elementor 4.0.9 (V4)  
**Insight:** A CONTAINER authored with `_css_classes: "joist-xform"` persisted in plan data but the rendered container carried only Elementor's own classes — the custom class never reached the DOM class list. WIDGET `_css_classes` (e.g. `joist-pin`/`joist-reveal`/`joist-count` on headings) DID render. So container-level scoping/utility classes silently don't apply on V4.  
**Fix:** For motion/scoping that targets a CONTAINER on V4, don't rely on its `_css_classes` — put the class on a widget, or target the auto-generated `.elementor-element-<id>` class (which is always present). Re-check on V3 sites; this may be V4-specific. Relevant to the GSAP escape-hatch `data-anim-scope`/container-scoping plans.

## ScrollTrigger pin guardrail: detect transformed ancestor, degrade to sticky

**Discovered:** 2026-05-31 | Slice 3, verified live  
**Insight:** ScrollTrigger `pin:true` silently breaks if any ancestor has a CSS `transform`/`perspective`/`filter`/`will-change:transform` (the ancestor becomes the fixed-positioning containing block). Elementor sections routinely carry transforms from entrance/motion effects, so this WILL hit real clones. Verified: a pin under a transformed ancestor degrades cleanly to `position:sticky` + a console.warn naming the offending ancestor; a pin in a clean container pins normally.  
**Fix:** Before pinning, walk the ancestor chain for transform/perspective/filter/will-change; if found, fall back to `position:sticky` rather than ship a broken pin. Implemented in joist-motion.js `transformedAncestor()`/`bindPins()`.

## Within-WP, no-CDN motion: load libs from the plugin's OWN vendor URLs

**Discovered:** 2026-05-31 | verified live (page joist-motion-within-wp-no-cdn-demo)  
**Insight:** Path B doesn't need a CDN. Any installed Joist build already serves the vendored GSAP libs as static assets at `…/wp-content/plugins/<dir>/assets/widget-pack/motion/vendor/`. So an injected runtime can load them from the plugin's own URLs and inline only the tiny glue — entirely within WordPress, no external dependency, no plugin update. Confirmed live: `externalCDNscripts: []`, split (47 char nodes) + parallax + magnetic all working. `joist_get_site_info` → `capabilities.motion.vendor_base_url` + `libs` tells the agent exactly where they are.  
**Fix:** In Phase 1d, build injected `<script src>` from `capabilities.motion.vendor_base_url`, never a CDN. Inject ONLY for effects whose capability flag is false (effects the plugin already supports run via Path A automatically — injecting double-loads GSAP). Lenis (`smooth_scroll`) needs `lenis.min.js` in vendor/ (added Slice 8); if a build predates it, skip smooth rather than CDN it. CDN is last-resort only when `vendor_base_url` is absent and the plugin dir can't be discovered.
