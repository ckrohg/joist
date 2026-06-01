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
   - `knowledge/CLONE_AUTHORING_PLAYBOOK.md` — the 5-phase authoring procedure + must-follow rules
   - `knowledge/ELEMENTOR_V3_WIDGET_REFERENCE.md` — full V3 settings catalogue (1895 lines)
   - `knowledge/V4_ATOMIC_NORMALIZATIONS.md` — V4 site quirks
   - **`knowledge/MOTION_PLAYBOOK.md`** — synthesis of 6 motion research streams; the navigator. **READ THIS BEFORE PHASE 1** if the source site has any motion/animation/effects (most do).
   - **`skills/joist-clone/LESSONS.md`** — accumulated session lessons (the "tenet within" — the learning corpus seed)

   If these are missing, the agent has insufficient context to author. Stop and tell the user.

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

**Phase 1d — Motion delivery: pick Path A or B (GSAP escape-hatch).** For 2D scroll motion that V3 widget settings can't author (scroll reveals, parallax, pinning, split-text), Joist has a free-GSAP escape-hatch. Choose delivery per the hybrid model (see `knowledge/GSAP_ESCAPE_HATCH_SPEC.md`):

1. Call `joist_get_site_info`; read `capabilities.motion`.
2. **`capabilities.motion.scroll_reveal === true` → Path A:** author the effect by adding `joist-reveal joist-reveal--<effect>` to the target widget's `_css_classes` (effects: `fade-in`/`fade-up`/`fade-down`/`slide-left`/`slide-right`/`scale-in`). The installed plugin enqueues GSAP+ScrollTrigger and animates them — inject nothing else.
3. **`capabilities.motion` absent/null (older build) → Path B:** author the same classes AND inject the content-fallback runtime once per page as an `html` widget (source: `assets/widget-pack/motion/joist-motion-fallback.html`). Knowingly accepts caching-plugin (delay-JS) fragility.
4. Either path uses the **same `joist-reveal` classes**, so a Path-B page silently upgrades to Path A once the site's plugin gains the runtime. Per-element tuning: `data-reveal-duration` / `data-reveal-delay` / `data-reveal-start`. Scope is the `joist-` class namespace. NOT for 3D/WebGL (hard wall) or effects free CSS already covers.

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

### Phase 6 — Revise + iterate

If `overall_score >= target_score`, OR if all remaining gaps are in `uncloneable_in_v3`, OR if `iteration_count >= max_iterations`, STOP. Otherwise:

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

Always read `~/.claude/skills/joist-clone/LESSONS.md` first. It's the accumulated record of generation-time gotchas + their fixes. Update it after each session with any new lesson learned.

Examples of what lives there:
- "On V3 sites: `_flex_basis` doesn't compile to CSS reliably. Use `width: {unit:%, size:N}` on inner flex children instead."
- "placehold.co with `?text=` empty renders the dimensions text by default. Use `?text=+` for an invisible placeholder."
- "Joist's PageFactory creates pages as `draft`. Always POST `{status:publish}` before screenshotting publicly."
- "Source palette extraction: HTML alone misses brand colors. Curl the compiled `wp-content/uploads/elementor/css/post-<id>.css` and grep hex frequencies."

These lessons compound. Without LESSONS.md the loop has to re-discover them each session.
