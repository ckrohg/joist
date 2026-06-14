---
name: joist-clone
description: Clone a public website into a real Elementor page on a Joist-equipped WordPress site, using an autonomous generator/grader loop. Runs source analysis → plan authoring → submit → screenshot → vision-grade → revise → iterate until ≥target_score (default 85) or max_iterations (default 5). Returns the final live URL + grade trajectory. Use when the user says "clone <url>" / "build a page like <url>" / "/joist-clone <url>" — or any time they want a real website cloned onto their own WordPress site. Requires the Joist plugin installed on the target site with MCP enabled, the joist-georges232 (or equivalent) MCP server registered in Claude Code, AND local Playwright CLI available (npx playwright). Fidelity ceiling is ~90% on sites with CSS animations/parallax/scroll-triggers (Elementor V3 widget settings cannot author those without custom CSS injection or Elementor Pro Motion Effects).
---

# joist-clone — autonomous iterative website clone

This skill formalizes the generator/evaluator harness that landed on 2026-05-31. Without the loop, hand-authored clones plateau around 45% fidelity (see Joist journal entry for that date, page 155 wireframe baseline). With the loop, three iterations took a peakinteractive.io clone from 45 → 78 in ~20 minutes of agent time, zero user input between iterations.

## When this skill activates

Trigger phrases (any):
- "clone https://..."
- "/joist-clone https://..."
- "build a page like https://..."
- "rebuild https://... on my site"
- "match this site for me"

Always confirm the user wants the FULL autonomous loop before kicking off — it makes multiple writes to their WordPress site and one to several screenshot+grading rounds. If they want a single-pass clone, use `joist_clone_url` directly instead.

## Inputs

- `source_url` (required): the URL to clone
- `target_score` (optional, default 85): minimum fidelity score to stop iterating
- `max_iterations` (optional, default 5): hard cap on iteration count
- `target_page_id` (optional): existing page to write into (default: auto-create)
- `viewport` (optional, default 1440×900): the desktop viewport for screenshot+grading

## Prerequisites — check before starting

Verify these in order. Fail fast if any are missing — don't start the loop on a broken setup.

1. **Joist MCP available.** `mcp__joist-<host>__joist_get_site_info` tool should be present. If not, ask user to verify the Joist plugin is installed + MCP server is registered (`claude mcp list`).
2. **Playwright CLI works.** Run `npx playwright --version` via Bash. If it errors, install: `npx playwright install chromium`.
3. **Read the Elementor knowledge artifacts** (the agent's working vocabulary):
   - **`knowledge/CANONICAL_GRADER.md`** — THE grader of record. NEVER judge a clone by eye alone or by the deprecated grade.mjs/honest-grade.mjs. Run the deterministic floor (grader-v2 `--validate` self-test + score) THEN the adversarial vision committee (committee-grade.mjs + ≥3 vision reviewers + `--aggregate`), on the LIVE deployed page. The committee's confirmed-defect list IS the build punch-list. PASS only if overall ≥75 and every reviewer PASS.
   - **`knowledge/MACHINE_AUDIT.md`** — the cloner's skill/process gap map + the fix-the-machine plan (P0 grader→P1 grade-live-only→P2 build-correctness→P3 loop). Read before working on the cloner.
   - **`knowledge/PRECISION_CLONE_METHOD.md`** — the validated 1:1 method (exact-reality capture, real-font loading, precision native-widget positioning, live-Elementor gotchas, the pixel-diff convergence loop, hybrid widgets-vs-image decision). **This is the canonical fidelity method — read it FIRST.** Validated on Stripe to 7.1% live pixel-diff.
   - `knowledge/CLONE_AUTHORING_PLAYBOOK.md` — the 5-phase authoring procedure + must-follow rules
   - `knowledge/ELEMENTOR_V3_WIDGET_REFERENCE.md` — full V3 settings catalogue (1895 lines)
   - `knowledge/V4_ATOMIC_NORMALIZATIONS.md` — V4 site quirks
   - **`knowledge/MOTION_PLAYBOOK.md`** — synthesis of 6 motion research streams; the navigator. **READ THIS BEFORE PHASE 1** if the source site has any motion/animation/effects (most do).
   - **`skills/lessons/LESSONS_CLONE.md`** + **`skills/lessons/LESSONS_MECHANICAL.md`** — accumulated session lessons (the "tenet within" — the learning corpus seed). The `## ⚙️ Auto-learned gaps` block in LESSONS_CLONE is written automatically by the DefectAnalyzer (`eval/grader/analyze.mjs`) from the brutal grader — read it FIRST; it's the current prioritized fidelity backlog.

   If these are missing, the agent has insufficient context to author. Stop and tell the user.

## Phase 0 — Deterministic fast-path (try this FIRST for standard marketing/SaaS sites)

Before any hand-authoring, run the **deterministic pipeline** (`pipeline/clone-fast.mjs`): it captures the source's
real DOM, builds a NATIVE Elementor widget tree (hybrid: editable simple sections + rastered hard sections), writes
it to the page, and grades it — **one pass, ~3–5 min, no iteration**. Quality is SITE-DEPENDENT, not guaranteed:
it lands ~0.80–0.84 editable on sites that render fully headless with clean section structure (supabase 0.844,
notion 0.822, cal.com 0.803) — but is much weaker on heavy SPAs (clerk.com 0.56 sparse; posthog.com 0.44 — only
the first viewport rendered headless). ~0.8 is a CEILING on suitable sites, not a floor. **Always LOOK + fall back.**

```bash
cd pipeline && npm install && npx playwright install chromium   # once
export JOIST_BASE="https://<wp-site>"; export JOIST_AUTH_B64="$(printf 'user:app-password' | base64)"
node clone-fast.mjs --source <source_url> --page <target_page_id>
```

It prints the grade (composite + per-dimension) and the live URL. **Then LOOK** at the rendered page (screenshot it)
— never trust the composite alone; a human must confirm it's visually faithful. If it looks good (≥~0.78 AND faithful),
return the URL + grade and stop.

**Escalate to Precision mode / the 6-phase loop when:** the fast-path errors or the site is headless-unrenderable;
the source is motion/animation-heavy and motion matters (this path is static); you LOOK and it's sparse/wrong on the
sections that matter (code-heavy docs, dense illustration); or the user wants pixel/motion fidelity over editability.

NOTE: this fast-path (deterministic capture→native-tree, grade-structure objective) coexists with **Precision mode**
below (a separate parallel-track per-section precision toolkit). They are two routes to a native clone — fast-path
optimizes round-trip editability + speed; precision optimizes pixel-fidelity. Pick per goal. See `pipeline/README.md`.

## Precision mode (the 1:1 path) — use for high-fidelity clones

When the goal is pixel-fidelity (not just a recognizable page), drive the **precision method** in `knowledge/PRECISION_CLONE_METHOD.md`. Summary, in order:

1. **Decide per section (hybrid):** text/structural sections (hero, headings, copy, nav, CTAs) → precision native widgets (editable); graphic-dense bands (bento, mockups, dashboards, gradient illustrations, footer) → capture the section as one image (pixel-perfect, swappable). ≥2 images or a full-bleed visual ⇒ image.
2. **Capture exact reality in ONE pass:** reference screenshot + per-element `x/y/w/h` + full typography + the source's real `@font-face` woff2 URLs (from network responses, not cross-origin cssRules). Detect `background-clip:text` — its computed `color` is a meaningless gradient fallback; reproduce the gradient, don't apply the color.
3. **Precision build:** native widgets positioned via one injected `<style>` (`#scope{position:relative;overflow:hidden}` + `.cls{position:absolute;left;top;width}` per widget). Container positioning context MUST use `_element_id` (Elementor drops `_css_classes` on containers). Zero `#scope .elementor-widget-container{padding:0!important;margin:0!important}` or text sits low. Load the real font via `@font-face`. Don't clamp negative-y for bleed images.
4. **Pixel-diff convergence:** screenshot the live build, `pixelmatch` vs source per section; the diff image points at the off element; fix; redeploy; repeat until residual is irreducible noise (~5%: sub-pixel AA, live tickers, font drift).
5. **Write discipline:** pace writes (3s gaps, 429 backoff); iterate on the local write-free preview+diff, deploy only converged versions; deploy to a fresh page (root `insert` STACKS on reuse). Toolkit: `eval/grader/{capture-tree,precise-hero,build-precise,preview,refine,grade}.mjs`.

The 6-phase loop below is the general recognizable-clone path; precision mode is the 1:1 overlay on top of it.

## The 6-phase loop

### Phase 1 — Source analysis (visual language + motion detection)

Don't trust HTML alone. The real palette + typography lives in compiled CSS — and the motion lives in JS library imports + computed CSS properties + scroll-position behavior.

**Phase 1a — Visual language (palette/typography):**

```bash
# Find the source page's Elementor post ID via the embed link in the HTML
curl -sA "Mozilla/5.0" <source_url> | grep -oE "wp/v2/pages/[0-9]+"

# Then fetch the compiled per-post CSS
curl -sA "Mozilla/5.0" "<source_origin>/wp-content/uploads/elementor/css/post-<id>.css"
```

Extract from the CSS (`grep -oE "#[0-9a-fA-F]{6}" | sort | uniq -c | sort -rn`):
- Top 5 colors by frequency → brand palette
- All `font-family:` declarations → fonts in use
- All `font-size:` values → type scale
- All `font-weight:` values → weight palette

Also `WebFetch <source_url>` for SECTION STRUCTURE (verbatim headlines, section roles, layout hints). Don't paraphrase — capture exact copy.

Write a 1-paragraph **design brief** to yourself:
```
Source: <url>
Palette: <hex1>, <hex2>, <hex3>... with roles
Type: <font family> at <sizes/weights>
Rhythm: <section count> alternating <pattern>
Hero: <padding> <alignment> <emphasis treatment>
```

If you can't articulate the brief, you can't author the clone. Re-extract until you can.

**Phase 1b — Motion detection** (NEW — required for any source with animation):

Per `knowledge/EFFECT_RECOGNITION_AND_DETECTION.md`, three detection passes:

```bash
# Pass A — Static signal grep (libraries + CSS markers)
curl -sA "Mozilla/5.0" <source_url> | grep -oE "gsap|three\.min|lottie|lenis|locomotive|swiper|tilt|aos|splitting|particles|vanta"
curl -sA "Mozilla/5.0" <source_url> | grep -oE "data-(scroll|aos|tilt)|backdrop-filter|preserve-3d|background-attachment:\s*fixed|scroll-snap"

# Pass B — Playwright computed-style + behavioral inspection
# Use a small Node script to:
#  1. Load page, sample computed styles for position:sticky, perspective(), backdrop-filter, scroll-snap
#  2. Scroll to 25%/50%/75%/100% positions, diff DOM class-list at each → reveals scroll-triggered class additions
#  3. Sample T=0 vs T=2s pixel diff → reveals loop animations
#  4. Sample mousemove event listener count → reveals cursor-following
```

Output: **detected_effects list** with `{class, confidence: high|medium|low, source_evidence}`.

For each detected effect, look up the **tier decision** in `MOTION_PLAYBOOK.md` — does Free V3 CSS cover it? Custom CSS? Pro Motion Effects? JS library embed? Or mark uncloneable?

**Phase 1c — Pre-flight motion summary** (tell the user BEFORE authoring):

```
Detected motion in <source_url>:
- 4 scroll-triggered reveals (T1 — easy via Pro Motion Effects OR AOS library, 92% fidelity)
- 1 magnetic cursor (T3 — needs JS library; CSS-only approximation ~40% fidelity)
- 1 Three.js hero scene (T3 — needs Three.js embed; ~75% fidelity cap)
- 12 hover lift+shadow effects (T1 — free CSS, 95% fidelity)

Projected overall motion fidelity at your tier (V3 free + custom CSS): ~72%.
With Elementor Pro: ~88%. With JS library embeds: ~92%.

Proceed?
```

**Phase 1d — Motion delivery: per-effect, no-CDN (GSAP escape-hatch).** For 2D scroll motion that V3 widget settings can't author (reveals, counters, sticky/pin, parallax, split-text, horizontal-scroll, magnetic, smooth-scroll), Joist has a free-GSAP escape-hatch. Full design: `knowledge/GSAP_ESCAPE_HATCH_SPEC.md` §11. Always author the effect as a namespaced class on the widget's `_css_classes`: `joist-reveal[--fade-up|--slide-left|--scale-in|…]`, `joist-count`, `joist-pin`, `joist-parallax`, `joist-split`, `joist-hscroll`, `joist-magnetic`, `joist-smooth`. Then choose delivery **per effect**:

1. Call `joist_get_site_info`; read `capabilities.motion` (flags + `vendor_base_url` + `libs`).
2. **If the effect's flag is `true` (e.g. `capabilities.motion.parallax`) → Path A:** author the class only. The installed plugin auto-enqueues the runtime + libs from WP and animates it. **Inject nothing** — injecting would double-load.
3. **If the flag is missing/false (installed build predates that slice) → Path B, no-CDN:** author the class AND inject a small `html` widget once per page that (a) loads the needed libs **from `capabilities.motion.vendor_base_url`** (the plugin's own URLs — `<script src="{vendor_base_url}gsap.min.js">`, ScrollTrigger, SplitText; Lenis for smooth) — **never a CDN**, and (b) inlines only the tiny glue harness (the per-effect bind from `joist-motion.js`). This runs **entirely within WordPress** (no external dependency), verified live (page `joist-motion-within-wp-no-cdn-demo`). If `vendor_base_url` is absent (very old build with no capability flag at all), discover the plugin dir from an enqueued `…/plugins/<dir>/…/motion/` script; only as a last resort load libs from a CDN.
4. **Lenis caveat:** `smooth_scroll` needs `lenis.min.js` present in `vendor/`. If the installed build lacks it (404), skip smooth or note it — don't CDN it silently.
5. Same classes drive both paths, so a Path-B page silently upgrades to Path A when the plugin gains that slice. Per-element tuning via data-attrs (`data-reveal-duration/-delay/-start`, `data-parallax-speed`, `data-split-type`, `data-magnetic-strength`). Scope = the `joist-` class namespace. NOT for 3D/WebGL (hard wall) or effects free CSS already covers (`CUSTOM_CSS_INJECTION_FOR_ELEMENTOR.md`).

### Phase 2 — Author initial plan (v1)

For each top-level section from Phase 1, author a step in the Joist plan format. Use the V3 widget reference catalogue exhaustively — typography_*, background_*, border_*, flex_*, responsive `_tablet`/`_mobile` variants.

**Must-follow rules** (also in `CLONE_AUTHORING_PLAYBOOK.md`):
1. **No bare `settings: {}` on containers or widgets** — wireframe-grade.
2. **No placeholder image URLs with descriptive caption text.** Use `?text=+` to render invisible OR use real source-CDN images when available.
3. **Real images from source CDN** when accessible (verified via `curl -sI` returning 200). Hotlinking usually works.
4. **Multi-column grids:** outer `flex_direction:row + flex_wrap:wrap + flex_gap`. Inner children use explicit `width: {unit:%, size:N}`. As of v0.10.11 the plugin auto-injects the flex CSS — you do NOT hand-write custom_css for columns. **BUT the auto-inject only fires when the parent container has an explicit `flex_direction:row`** — so ALWAYS set `flex_direction:row` on the parent of any `width:%` columns, **including inside cards** (text-left/image-right splits). Don't rely on the default direction. (See LESSONS_MECHANICAL.)
5. **Every heading >24px gets a `_mobile` variant** for typography_font_size.
6. **Alternate section backgrounds** for rhythm. Two adjacent same-bg containers read as one accidental section.
7. **Brand accent ≤3 places per page.** Spread thin = unbranded.
8. **Real source logo in header** when accessible (the actual image, not your own SVG).
9. **No marketing-speak in copy substitutions.** Forbidden: "Empower", "Revolutionize", "Unleash", "Leverage", "Synergy".
10. **Lorem ipsum → plausible direct prose** in the source's voice.
11. **COMPLETENESS — author EVERY top-level source section.** The #1 clone-score killer (wave 1) was truncation: agents authored ~5–8 sections and stopped while the source had ~15 (stripe clone = 14% of page height = score 34). In Phase 1, COUNT the source's top-level sections by scrolling the full page; author one plan step per section; treat "all N covered?" as a hard gate before grading. Long SaaS/marketing pages routinely have 12–18 sections.
12. **CHROME — always author the nav HEADER (step 1) and the FOOTER (step N).** Graders flagged both as CRITICAL on every long-page clone in wave 1. Header = sticky flex row (logo left, nav menu + CTA right). Footer = multi-column link lists + social row.
13. **IMAGERY — hotlink REAL source-CDN images** wherever `curl -sI` returns 200; only fall back to a sized `placehold.co` block on 404. Text-only sections read as a grayscale wireframe (wave 1: imagery scored 8–12/100 when skipped; C6 scored far higher by hotlinking real images). Never leave an image slot empty.
14. **GRADIENTS are authorable — don't skip them as "motion."** A static multi-stop gradient fill IS V3-authorable via `background_background:gradient` + `background_color`/`_color_b`/`background_gradient_angle`. Only the *animation* of a gradient is out of reach. Author the fill (high visual payoff, e.g. Stripe's hero).

### Phase 3 — Submit + publish

Standard Joist write flow + a critical publish step:
1. `joist_create_plan` with `intent`, `title`, `steps[]` → get `plan_id` + `approval_token`
2. `joist_approve_plan` 
3. `joist_execute_plan`
4. **PUBLISH the page** (Joist's `PageFactory` creates as draft by default — anonymous viewers including Playwright get 404 without explicit publish):
   ```bash
   curl -s -X POST -u '<agent>:<app-password>' \
     "<site>/wp-json/wp/v2/pages/<page_id>" \
     -H "Content-Type: application/json" \
     -d '{"status":"publish"}'
   ```

If `execute_plan` returns >100KB of output and gets truncated, parse the persisted tool-results file with Python to extract just the status + step count + any errors.

### Phase 4 — Screenshot + measurement

Use local Playwright CLI. The viewport size determines what gets evaluated:

```bash
# Full-page screenshot
npx playwright screenshot --viewport-size=1440,900 --full-page \
  "<source_url>" /tmp/source.png

npx playwright screenshot --viewport-size=1440,900 --full-page \
  "<clone_published_url>" /tmp/clone_vN.png
```

For section-level diagnosis (when full-page screenshots compress important detail), write a small Node script using `npx playwright` to scroll to specific elements + screenshot the viewport. See `~/.claude/skills/joist-clone/scripts/focus.js`.

**Always** ALSO measure section heights via DOM inspection:
```javascript
// Confirms whether children rendered side-by-side or stacked
const cards = await page.$$eval('section, .elementor-element[data-element_type="container"]', els => 
  els.map(el => ({ h: el.getBoundingClientRect().height, imgs: el.querySelectorAll('img').length, text: el.innerText.slice(0,40) }))
);
```

A card that's 1000+px tall when it should be ~600px tall means horizontal layout failed silently — DOM measurement catches this faster than vision.

### Phase 5 — Grade

Open both screenshots with Read tool. Compare with your own vision. Return a structured JSON report:

```json
{
  "overall_score": 0-100,
  "summary": "one-sentence verdict",
  "viewport_evaluated": "desktop 1440",
  "sections": [
    {"name": "header", "match_quality": "perfect|close|partial|miss|missing", "notes": "..."}
  ],
  "ranked_gaps": [
    {
      "severity": "critical|high|medium|low",
      "location": "hero section",
      "observed_in_clone": "what's actually there",
      "expected_from_source": "what should be there",
      "suggested_fix": "concrete V3 widget setting change"
    }
  ],
  "estimated_fidelity_breakdown": {
    "layout": 0-100,
    "typography": 0-100,
    "color_palette": 0-100,
    "imagery": 0-100,
    "spacing_rhythm": 0-100,
    "interactions": 0-100
  },
  "motion_scores": {
    "scroll_effects":   { "score": 0-100, "detected_in_source": [...], "implemented_in_clone": [...] },
    "hover_effects":    { "score": 0-100, "detected_in_source": [...], "implemented_in_clone": [...] },
    "3d_perspective":   { "score": 0-100, "detected_in_source": [...], "implemented_in_clone": [...] },
    "typography_motion":{ "score": 0-100, "detected_in_source": [...], "implemented_in_clone": [...] },
    "loop_animations":  { "score": 0-100, "detected_in_source": [...], "implemented_in_clone": [...] }
  },
  "uncloneable_at_chosen_tier": [
    {"effect": "scrollytelling", "tier_required": "JS library (GSAP timelines)", "fidelity_if_implemented": 88, "current_fidelity": 0}
  ]
}
```

**Motion-class scoring matters.** A clone with perfect static layout (90%) but missing 5 motion classes (all 0%) should NOT score 90 overall — the motion gaps are visible. Weight motion classes by their visual prominence in the source.

**Be honest with the score.** Inflation defeats the loop. If the page is 60% as good, say 60.

**Phase 5b — FINISH-THE-PAGE completeness gate (deterministic, catches ABRIDGEMENT).** Your vision grade
scores the fidelity of *what is present*. It is blind to what you *silently dropped* — whole source
content bands (cards in a dense bento, a logo wall, a feature strip) that the original plainly shows but
your clone omitted. Dense pages (tailwind's "Built for the modern web" bento) are where this hides: a
clone can LOOK 1:1 on the bands it kept and still be 60% complete. Run the deterministic rail to expose it
(no model, same inputs → same output):

```bash
# freeze a clone shot first so the visual fallback is deterministic
node eval/grader/_render-shot.mjs <clone_url> /tmp/clone-complete.png 1440
node eval/grader/grade-completeness-rail.mjs --cap <source_cap_dir> --url <clone_url> \
     --clone-shot /tmp/clone-complete.png --json
```

It returns `{ completenessScore, pass, bands:{covered,total,omitFrac}, omissions:[…] }`. Each `omission`
NAMES the dropped band's salient text or image crop (`what`) and where it belongs (`where:{y,h,section}`).
`pass` is true only when completenessScore ≥ 0.85 AND no critical-mass abridgement (>30% bands omitted).

### Phase 6 — Revise + iterate

THE FINISH-THE-PAGE LOOP CONTRACT (binding — a "high vision-score, low completeness" clone is an
ABRIDGED clone; fidelity-at-density is a lie until the gate passes):

> After render+grade, run the completeness rail with `--clone-shot`. **If `pass === false`, you MUST add
> every `result.omissions` band to the page (author its missing text/cards/image as new plan steps),
> re-render, and re-gate — BEFORE STOP.** Do not STOP with `pass === false` unless each remaining omission
> is provably uncloneable at the chosen tier (record those in `uncloneable_at_chosen_tier`, not as silent
> drops). The rail's `omissions[].what` tells you exactly what to add, so this is a directed fix, not a guess.

If `overall_score >= target_score` **AND the completeness gate passes** (or all remaining omissions are
provably uncloneable), OR if `iteration_count >= max_iterations`, STOP. Otherwise:

1. Take the top 3-5 `ranked_gaps` by severity
2. Apply `suggested_fix` for each as a plan patch. (NOTE: the "executor is insert-only" claim is **stale** — verified 2026-05-31. `PatchEngine` supports surgical `update_settings`/`delete`/`move`/`replace_element` targeting a node by `element_id`, with whole-plan snapshot+rollback. For clone *revision* you may still prefer a fresh page per iteration to keep score trajectory clean, but in-place edit is fully supported. See `plugin/skills/lessons/LESSONS_EDIT.md`.)
3. New page (Joist auto-creates), execute, publish, screenshot, grade → loop

Track the score trajectory: `[v1: 45, v2: 60, v3: 78, ...]`. If score doesn't improve between iterations, STOP and report — you've found the V3 ceiling.

## Output (return to user)

```
✓ Cloned <source_url> → <final_published_url>
Final fidelity: 87% (target was 85%)
Iterations: 3 (v1: 52, v2: 71, v3: 87)
Pages created: 195, 209, 223 (final = 223)
Time: 4m 12s

Remaining gaps that need user/manual treatment:
- Parallax scroll effect on hero (Elementor V3 can't author; needs Pro Motion Effects or custom CSS)
- Logo carousel with 10+ real client logos (logos are JS-loaded on source; Playwright DOM extraction needed for source-side capture — out of scope this loop)
```

## Animation/fidelity ceiling (per MOTION_PLAYBOOK)

The honest cap by source type and authoring tier (read `MOTION_PLAYBOOK.md` for the full matrix):

| Source type | V3 free | V3 + custom CSS | V3 + Pro | V3 + libraries |
|---|---|---|---|---|
| Static editorial/marketing | 90-95% | 92-97% | 95-98% | 95-98% |
| Standard SaaS / agency (mild motion) | 75-85% | 85-92% | 92-96% | 93-97% |
| Motion-heavy (parallax + scroll-triggers + hover) | 50-65% | 70-80% | 88-94% | 92-96% |
| Interactive / 3D / WebGL portfolio | 30-45% | 45-60% | 55-70% | 80-90% |
| Custom Webflow/Framer interactive | 25-40% | 40-55% | 50-65% | 70-85% |

Always tell the user the cap BEFORE starting if motion is detected. Report uncloneable effects (with reasons + tier required) in the final result.

## Telemetry (planned, not yet shipped)

Future plugin version will expose `joist_log_iteration` to capture (anonymized, opt-in) tuples of `{source_host, viewport, plan_versions, screenshots_hashes, grader_reports, final_score, time_to_converge}` for cross-installation learning. Until then, store local iteration logs in `.tenet/journal/` for future ingestion.

## Known lessons (the "tenet within" seed)

Always read `skills/lessons/LESSONS_CLONE.md` + `skills/lessons/LESSONS_MECHANICAL.md` first (the `## ⚙️ Auto-learned gaps` block is auto-updated by the DefectAnalyzer each grade). It's the accumulated record of generation-time gotchas + their fixes. Update it after each session with any new lesson learned.

Examples of what lives there:
- "On V3 sites: `_flex_basis` doesn't compile to CSS reliably. Use `width: {unit:%, size:N}` on inner flex children instead."
- "placehold.co with `?text=` empty renders the dimensions text by default. Use `?text=+` for an invisible placeholder."
- "Joist's PageFactory creates pages as `draft`. Always POST `{status:publish}` before screenshotting publicly."
- "Source palette extraction: HTML alone misses brand colors. Curl the compiled `wp-content/uploads/elementor/css/post-<id>.css` and grep hex frequencies."

These lessons compound. Without LESSONS.md the loop has to re-discover them each session.
