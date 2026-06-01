# GSAP Motion Escape-Hatch — Spec (DRAFT, pre-proof)

**Date:** 2026-05-31 · **Status:** DRAFT design, gated on round-trip proof · **Owner:** Joist core
**Provenance:** deep-research workflow (105 agents, 23 sources, 22/25 claims confirmed 3-0) + source-extraction of 4 Claude-skill repos. See `MOTION_PLAYBOOK.md` "2026 Verified Update" section and TENET memory #57.

> ⚠️ This is a design spec, not an approved feature. It MUST NOT be built into the Joist plugin or baked into `joist-clone/SKILL.md` until the **round-trip kill-switch probe** (§5) passes on a supported-Elementor target site.

---

## 1. Goal & non-goals

**Goal:** let Joist reclaim the **2D scroll-motion fidelity** it cannot author through Elementor V3 widget settings (scroll-triggered reveals, pinning, parallax, SplitText, stagger, marquee, smooth-scroll) by authoring scoped, free-GSAP-powered motion — delivered safely, not via a naive CDN tag.

**Non-goals:**
- **Three.js / WebGL 3D.** Research validated GSAP injection ONLY. 3D stays in the ~75% hard-wall tier and, if ever attempted, needs a dedicated full-bleed section type — NOT this widget-scoped path. Out of scope here.
- Replacing Elementor Pro Motion Effects where Pro is present and sufficient. The escape-hatch is the path for free-tier + effects Pro can't express.

## 2. Why (one line)

GSAP is now 100% free incl. all plugins; this *undercuts Elementor Pro Motion Effects* ($199/yr) for the motion use-case, and the technique is market-validated (Animation Addons for Elementor, 10k+ installs). The reclaimable gap is 2D scroll motion — the largest slice of the documented 75→90% fidelity gap.

## 3. Delivery method — enqueue via PHP, NOT a CDN `<script>` tag

🔴 **Hard rule (refuted alternative, 0-3):** never ship a bare CDN `<script>` in an Elementor HTML widget as the load mechanism.
- **Reason:** WP Rocket "Delay JavaScript Execution" defers *all in-HTML scripts until user interaction* → CDN tags don't run on load. Common caching plugins silently break the naive approach.
- **Method:** the Joist plugin registers/enqueues GSAP + required plugins via `wp_enqueue_script` (proper handle `gsap-js` + dependency ordering, per GSAP's own WP guidance). Only the **scoped init JS** is emitted into the page (and even that should be enqueued, not inlined raw where caching can defer it — or marked with the caching-plugin exclusion attribute).
- **Load only what's used** ("smart loading"): enqueue ScrollTrigger/SplitText/etc. per-page only when the authored plan uses them.

## 4. Init contract — the 7 verified guardrails (all 3-0)

Every emitted init MUST:
1. **Check the ancestor chain for CSS `transform`/`will-change` before pinning** — pinning silently breaks under an ancestor transform, and Elementor sections routinely carry them from entrance effects. Refuse/relocate the pin if found.
2. **Call `ScrollTrigger.refresh()`** after images/fonts load and on layout change (start/end positions are computed at creation and go stale on lazy-load).
3. **Be idempotent / re-bindable** across Elementor editor re-renders and nested-element reloads.
4. **Prefer pure JS; avoid jQuery interop** (documented nav-menu/jQuery conflict source).
5. **Feature-flag injected smooth-scroll (Lenis/Locomotive)** — Elementor v3.25 added native CSS smooth-scroll active-by-default with no disable filter and broke ~20 sites. Treat injected smooth-scroll as fragile to core updates; default it OFF.
6. **Scope every selector to a `data-anim-scope` (or element-id) container** — never global `.box`/`document`.
7. **Register a cleanup path:** `ScrollTrigger.getAll().forEach(t=>t.kill())`, `gsap.ticker.remove(cb)`, `lenis.destroy()`.

**Lenis+GSAP init (the detail everyone gets wrong):** `new Lenis({ autoRaf:false })`, `lenis.on('scroll', ScrollTrigger.update)`, delegate `lenis.raf(time*1000)` to `gsap.ticker.add(...)`, `gsap.ticker.lagSmoothing(0)`. Without `autoRaf:false` → double-RAF, scrub breaks.

**Performance:** animate `transform`/`opacity` only (composite-only; layout props wreck INP). Always emit `@media (prefers-reduced-motion: reduce)` / `matchMedia` early-return.

## 5. Round-trip kill-switch probe (GATES EVERYTHING — do first)

> ✅ **RESULT (2026-05-31): PASS (data-layer leg).** Ran on georges232 (Elementor 4.0.9, V4) via real create→approve→execute (plan `pln_MPUGKP9W…`, page 416). An injected HTML-widget `<script>` (marker `JOIST_PROBE_MARKER v1`) survived **verbatim**: `transformations: []`, no warnings, stable hash `sha256:6e95f5c2…`, and independently confirmed persisted to stored `_elementor_data` via `joist_get_page_tree`. It passed *through* the read-after-write #35888 defense on a known-broken version with no corruption. **The escape-hatch is alive.** Remaining sub-checks (do not block the build): (a) Elementor editor re-save survival — manual (open page 416, Update, re-read); (b) frontend execution — Playwright on the published URL, assert `[data-joist-probe="bound"]`.
>
> **Design refinement from the probe:** the in-HTML `<script>` that round-trips cleanly is the same thing WP Rocket delay-JS defers — but its survival is *desirable* for the round-trip-editability hard requirement. **Resolution:** PHP-enqueue the GSAP *library* (shared/heavy, dodges delay-JS), keep the per-page *init* in the html widget (round-trips + editable), and tag the init for delay-JS exclusion (`nowprocket`/WP Rocket excluded-JS). This supersedes any reading of §3 that implied the init must also be PHP-injected.

**Question:** does Joist's lenient round-trip hash survive a page containing an injected custom-code/`<script>` block?
**Test (needs a supported-Elementor target, see §7):**
1. Author a minimal Joist plan with one HTML/custom-code widget containing a scoped GSAP init `<script>`.
2. Execute → fetch → re-hash. Confirm `final_hash` stability across a no-op round-trip (same as the canonical smoke test does for V3/V4 shapes).
3. Open in Elementor editor, save, re-fetch — confirm the injected block isn't stripped/normalized away by the V4 auto-field normalization.
**Outcome:** PASS → proceed to build (§6). FAIL → escape-hatch is dead in this form; fall back to documented Pro/CSS tiers and report honestly.
*This requires NO new feature — it uses existing Joist plan + custom-code-widget capability.*

## 6. Build (only after §5 passes)

PHP-enqueue registrar + per-page "motion manifest" (which plugins + which scoped inits) emitted from the Joist plan. Init templates per effect class drawn from `THIRD_PARTY_MOTION_LIBRARIES.md` (corrected per §4). Caching-plugin exclusion attribute on the init handle.

## 7. Eval plan (the "prove" step) — progressive, all 3 targets

Target site: **Local (Flywheel) Hello + Elementor 3.x** (documented production shape), Joist + MCP wired. Keep georges232 (4.0.9) as V4-broken-band canary.
1. **Scroll-animated SaaS page** — common case; scroll-reveals, sticky, parallax, stagger. Validates the production path most users need.
2. **Awwwards-tier agency site** — ceiling; SplitText, pinned timelines, magnetic cursor, Lenis. Stresses hardest failure modes.
3. **WebGL/3D showcase** — hard wall; confirms 3D needs a section not a widget, ~75% cap.
Each: clone via `joist-clone` with escape-hatch → vision-grade (per-motion-class rubric) → round-trip smoke-test → record fidelity uplift vs. CSS-only baseline.

## 8. Licensing note (clear, not a blocker)

GSAP 100% free incl. all plugins (eff. Apr 30 2025, current May 2026). Only residual: Webflow "Prohibited Uses / Competitive Products" clause barring GSAP in a *no-code visual animation builder competing with Webflow*. Joist injects **authored** GSAP into delivered sites → "Permitted Uses"; FAQ confirms AI-generated GSAP code is permitted. **Action:** one-line legal re-read of this clause against Joist's exact product framing before public ship.

## 9. Honest open risks (measure, don't assume)

- **No independent CWV/INP benchmark** of GSAP-in-Elementor exists — measure Lighthouse/INP in the eval, don't trust vendor "smart loading" copy.
- **Three.js/3D injection unvalidated** — do not extend this path to WebGL without separate research.
- **Caching-plugin behavior** only reproduces on a real host — final shippability check should run on a hosted staging site with WP Rocket active (eval target D), not just Local.
- **Named AI competitors** (Framer/Lovable/v0/Spline) not directly benchmarked — revisit for positioning.

---

## 10. Slice roadmap — tackle one by one

Each slice is a **vertical slice through the whole pipeline** and is shipped only when it meets the Definition of Done below. Order = ROI desc, then complexity/risk asc, respecting dependencies. Reorder freely; the dependency arrows are the only hard constraint.

### Definition of Done (per slice)
1. **Enqueue** — any new GSAP plugin/lib registered via `wp_enqueue_script` (dependency-ordered), loaded only when the page uses it.
2. **Author** — Joist can emit the scoped init for this effect into an html widget from a plan.
3. **Guardrails** — the slice's specific guardrails from §4 implemented (scoping, cleanup, `refresh()`, reduced-motion, delay-JS exclusion).
4. **Round-trip** — a page using the effect passes create→execute→`get_page_tree` with stable hash (the §5 method, now automatable per slice).
5. **Render+grade** — effect runs on the rendered page (Playwright assert) and is graded by the per-motion-class rubric on one real example. Record fidelity vs. CSS-only baseline.
6. **Doc** — fold the verified init into `THIRD_PARTY_MOTION_LIBRARIES.md`; note gotchas in `joist-clone/LESSONS.md`.

### The slices

| # | Slice | Lib (new enqueue?) | Slice-specific guardrails | Deps | Why here |
|---|---|---|---|---|---|
| **1** | **Foundation + Scroll Reveal** (fade/slide/scale-in on enter) | GSAP core + ScrollTrigger (new) | Builds the shared harness: enqueue registrar, init emitter, `data-anim-scope` scoping, cleanup, `ScrollTrigger.refresh()` on load/font, reduced-motion guard, delay-JS exclusion | — | Highest ROI (~67% of SaaS pages); **everything else extends its infra** |
| **2** | **Counter / number animation** | ScrollTrigger (reuse) | `once: true`; format/locale; integer snapping | 1 | Cheap; validates a 2nd effect rides the infra cleanly with minimal complexity |
| **3** | **Sticky / pinned section** | ScrollTrigger pin (reuse) | 🔴 ancestor-transform-breaks-pin check (verified); `pinSpacing`; animate children not the pinned node | 1 | Introduces the hardest verified failure mode early, in isolation |
| **4** | **Parallax (multi-layer scroll)** | ScrollTrigger scrub (reuse) | transform-only (INP); mobile fallback; `ease:none` + scrub | 1 | Common, transform-discipline drill |
| **5** | **Split-text reveal** (char/word/line stagger) | GSAP **SplitText** (new — now free) | `SplitText.revert()` on cleanup; re-split + refresh after font load; ARIA/text-copy preserved | 1 | Premium feel; first new-plugin enqueue beyond ScrollTrigger |
| **6** | **Horizontal scroll section** | ScrollTrigger pin + x-translate (reuse) | pin + container width math; mobile opt-out | 3 | Builds directly on pinning (Slice 3) |
| **7** | **Magnetic cursor / cursor-follow** | vanilla JS or `gsap.quickTo` (reuse) | desktop-only `@media (pointer:fine)`; no-touch; throttle | 1 | Niche, desktop-only; lower ROI |
| **8** | **Smooth scroll (Lenis)** | **Lenis** (new) | 🔴 `autoRaf:false` + `gsap.ticker` (s→ms) + `lagSmoothing(0)`; **FEATURE-FLAG OFF by default** (Elementor v3.25 native CSS smooth-scroll collision, no disable filter); a11y caveat; `lenis.destroy()` | 1 | **Highest-risk slice** (core-update collision) → last of the core set |
| **S1** | *(stretch)* GSAP **Flip** layout transitions | Flip (new) | state capture/cleanup | 1 | Advanced, niche |
| **S2** | *(stretch)* scroll-driven video scrub | ScrollTrigger + video | mobile autoplay/decoding limits | 1,4 | Heavy; demo-grade |

### Explicitly OUT of escape-hatch scope (do NOT add as slices)
- **Three.js / WebGL 3D, particle fields, shaders** — the hard wall (§1). Needs a dedicated full-bleed *section type*, separate research, and carries unvalidated mobile-GPU risk. Stays in the ~75% cap tier.
- **Lottie** — different runtime (`lottie-web`, not GSAP). If wanted, it's a *separate* lib track, not part of this GSAP escape-hatch.
- **CSS-tier effects** (hover, glassmorphism, gradient/stroked text, CSS card-flip, marquee, `@scroll-timeline` reveals) — already covered free by `CUSTOM_CSS_INJECTION_FOR_ELEMENTOR.md`. The escape-hatch is only for what CSS *can't* do.

### Tackle protocol
Do them strictly in order (deps permitting). After each slice meets DoD, journal a `feature` entry + update this table's status, then start the next. Slice 1 is the gate — its infra correctness determines every later slice's reliability, so it gets the most adversarial eval.

---

## 11. Hybrid runtime delivery (DECIDED 2026-05-31)

Motion has two layers. **Authoring** (which elements animate — `joist-reveal[--effect]` on `_css_classes`) always flows through MCP as plan data, zero redeploy, on any installed Joist (proven: page 441). Only the **runtime** (GSAP + harness) has a delivery choice. Decision: **hybrid, plugin-preferred with content fallback.**

### Path A — Plugin-bundled runtime (preferred)
`WidgetPack\Motion\Emitter` enqueues vendored GSAP + ScrollTrigger + `joist-motion.js` on pages whose data contains `joist-reveal`. Robust, delay-JS-excluded, audited, single controlled source. **Gated on the installed plugin build having the runtime.** Reaches sites via the plugin release/update channel (a deploy pipeline the product needs regardless).

### Path B — Content-injected runtime (fallback)
When the installed build lacks the runtime, the agent injects `assets/widget-pack/motion/joist-motion-fallback.html` (GSAP via CDN + the same harness inline, tagged `data-no-optimize`/`data-cfasync`) as an html widget. Works on **any** Joist install with no plugin update. **Accepted tradeoff:** fragile under aggressive caching (WP Rocket delay-JS may defer it) and per-page script weight. This is the compromise the hybrid knowingly takes for coverage.

### Path selection (agent-side, in joist-clone skill)
```
caps = joist_get_site_info()
if caps.capabilities?.motion?.scroll_reveal === true:
    PATH A — author joist-reveal classes only (plugin enqueues runtime)
else:
    PATH B — author joist-reveal classes + inject joist-motion-fallback.html as an html widget
```
An old build reports no `capabilities.motion` → agent falls back automatically. No coordination needed.

### Capability flag (plugin, additive)
`joist_get_site_info` / HealthController gains `capabilities.motion = { scroll_reveal: true, effects: [...], runtime_version }`. Emitted by the Motion module so the flag and the runtime ship together — a build either has both or neither. This is what makes motion "always flow through the plugin" *safely*: the agent never authors Path-A-only when the runtime is absent.

### Invariants
- Both paths use the **same harness logic** (`joist-motion.js` ↔ inline in `joist-motion-fallback.html`) — keep them in sync; the fallback is the canonical harness + a CDN GSAP loader.
- Both paths key off the **same `joist-reveal[--effect]` classes**, so a page authored for one path renders on the other — and a site that later updates its plugin silently upgrades from Path B → Path A with no re-authoring.
- DoD per slice now covers **both paths** (render+grade on Path B is testable today on georges232; Path A render+grade unlocks on first runtime-bearing deploy).
