# Lessons — Clone (reference signal = the live source)

Lessons about extracting ground truth from a source site and grading a clone against it.
Mode-specific to clone. Read alongside `LESSONS_MECHANICAL.md` before Phase 1 of a clone run.

For *how Elementor compiles* (mode-agnostic), see `LESSONS_MECHANICAL.md`.

---

## Source visual language requires fetching compiled CSS, not just HTML

**Discovered:** 2026-05-31 | clone v2: palette extraction
**Symptom:** WebFetch returned structure (sections, headlines) but no palette/type/weights.
First clones used generic dark/cream/chartreuse instead of the source's real orange/black.
**Root cause:** WebFetch is HTML-only; it doesn't follow `<link rel=stylesheet>`. The brand
palette + fonts live in the compiled per-post Elementor CSS.
**Fix:** `curl <origin>/wp-content/uploads/elementor/css/post-<id>.css`, then
`grep -oE "#[0-9a-fA-F]{6}" | sort | uniq -c | sort -rn` for the palette by frequency;
`grep -oE "font-family:[^;]+"` and `font-size:` for the type vocabulary.

---

## Client logo carousels are JS-loaded; static HTML scrape misses them

**Discovered:** 2026-05-31 | clone v3: social proof section
**Symptom:** Static curl returned only 3 partner badges; the rendered site shows 10+ rotating
client logos.
**Root cause:** Logo carousels (Elementor Pro Logo Carousel) lazy-load via JS.
**Fix:** Use Playwright DOM extraction (`knowledge/PLAYWRIGHT_DOM_EXTRACTION_DESIGN.md`) to get
the rendered DOM with all images. MVP without it: degrade gracefully, no misleading
"placeholder" annotations.

---

## Source-CDN image labels don't match the displayed business

**Discovered:** 2026-05-31 | clone v7: case study card rotation
**Symptom:** Card "Tint Pros Plus" showed a Wessell mockup; "Wessell" showed Quinn Brothers.
**Root cause:** Source image URLs are tool-generated random slugs (`smartmockups_lkw...png`) —
no semantic hint to which business each shows.
**Fix:** Either (a) visually inspect each source image in Phase 1 and build a manual mapping,
or (b) scrape alt-text + nearby business name. Don't assume URL order matches section order.

---

## Run effect detection BEFORE authoring on any motion-bearing source

**Discovered:** 2026-05-31 | post research wave
**Insight:** Authoring top-down without motion knowledge yields a clone that's ~90% right
structurally but lands 0% of the source's motion — reads as "feels dead."
**Fix:** Phase 1b motion detection is mandatory for any non-trivial source. See
`MOTION_PLAYBOOK.md` + `EFFECT_RECOGNITION_AND_DETECTION.md`. Make the tier decision (free CSS
/ custom CSS / Pro / library / uncloneable) before any plan authoring.

---

## Pre-flight motion summary BEFORE authoring sets honest expectations

**Discovered:** 2026-05-31 | playbook synthesis
**Insight:** If a source has 6 motion effects and 5 are uncloneable at the user's tier, telling
them after authoring feels like bait-and-switch.
**Fix:** Phase 1c — list detected effects, tier required for each, projected fidelity. User
confirms tier (or upgrades to Pro / accepts the gap) before authoring.

---

## Score motion-class separately, not just overall visual

**Discovered:** 2026-05-31 | MOTION_PLAYBOOK synthesis
**Insight:** A clone with perfect static layout (90%) but 5 missing motion classes (all 0%)
should NOT score 90 — the motion gaps are visible, and a static pixel diff can't see them.
**Fix:** Phase 5 grader includes a `motion_scores` object with per-class breakdown, weighted
by visual prominence in the source.

---

## After 3+ iterations with no score change, you've found the V3 ceiling

**Discovered:** 2026-05-31 | clone v5→v6→v7 sequence
**Observation:** Iterations moved the score 5+ points while there was room; when remaining gaps
were animation-class (parallax / logo carousel), iteration stopped helping.
**Implication:** Stop when score plateaus AND remaining gaps are all in `uncloneable_in_v3`.
Report those gaps with the source elements they correspond to.

---

## Confirm the loop's prerequisites before iterating

**Pattern across all clone sessions.** Runs fail when Playwright isn't installed, the Joist MCP
isn't connected, the user is logged out (can't view drafts), the source is paywalled, or the
source needs JS to render.
**Phase 0 checks:** `npx playwright --version`; `joist_get_site_info`; `curl -sI <source_url>`.
If the source returns minimal HTML and renders body via JS, warn that visual extraction will be
poor.

---

## ⭐ Clones get TRUNCATED — author EVERY source section, not just the top 5

**Discovered:** 2026-05-31 | clone baseline wave 1 (stripe C4 scored 34, aspendental C1 scored 54)
**Symptom:** The stripe clone reproduced ~5 of ~15 sections (1969px vs the source's 14374px — 14% of
page height) and stopped. The dominant score driver wasn't fidelity-per-section (those were clean) —
it was missing two-thirds of the page.
**Fix:** In Phase 1, ENUMERATE every top-level source section (scroll the full page; count them) and
author one plan step per section. Treat "did I cover all N sections?" as a hard gate before grading.
Long pages (SaaS marketing) routinely have 12–18 sections — budget for it.

## ⭐ Always author the nav HEADER and the FOOTER — agents skip both

**Discovered:** 2026-05-31 | clone baseline wave 1 (missing on C1, C4; partial on C3)
**Symptom:** Clones jump straight into the hero and end at the last body section. Graders flagged
"header missing" and "footer missing" as CRITICAL on every long-page clone — they're ~15% of page
height and the first/last thing a visitor sees.
**Fix:** Always author (1) a sticky header container (flex row: logo left, nav menu + CTA right) and
(2) a multi-column footer (link-list columns + social row). Make them step 1 and step N of the plan.

## ⭐ Use REAL source imagery — text-only sections read as a wireframe

**Discovered:** 2026-05-31 | clone baseline wave 1 (C1 & C4 imagery scored 8–12/100; C6 scored well
because it hotlinked real source-CDN images)
**Symptom:** Image-driven sources (dental portraits, product mockups, customer logos) cloned as
text-on-blank-white → graders called them "monochrome blueprints." C6 (peakinteractive) looked far
better because it hotlinked the actual smartmockups/logo URLs (verified 200 via `curl -sI`).
**Fix:** Per CLONE_AUTHORING_PLAYBOOK rule 3, hotlink real source-CDN images wherever they return
200. Only fall back to sized placehold.co blocks when the source image 404s. Never leave an image
slot empty — a blank beats nothing but a real image beats both.

**CLARIFICATION (clone C4 v2 misread):** the `joist_create_plan` tool description says *"never
invent real CDN URLs."* That means **don't HALLUCINATE** non-existent URLs — it does NOT forbid
using a real source image URL you have VERIFIED returns 200. Proof: clone C6 (page 403) saved a real
`https://peakinteractive.io/wp-content/uploads/.../peak-interactive-300x50.png` successfully. The
stripe-v2 agent misread the rule and used 100% placehold.co → imagery axis stayed low. RULE OF THUMB:
`curl -sI <url>` → if 200, use it; if you're guessing a URL, don't. (Product follow-up: reword the
tool description to say "verified-200 source URLs OK; don't fabricate URLs" so agents stop
over-applying the guardrail.)

## Authorable gradients are being skipped as if they were "motion"

**Discovered:** 2026-05-31 | clone baseline wave 1 (stripe C4 — hero gradient marked "miss")
**Insight:** Stripe's hero mesh-gradient was treated as uncloneable motion, but a static
multi-stop gradient IS authorable via `background_background:gradient` + `background_color`/
`_color_b`/`background_gradient_angle`. Only the *animation* of the gradient is V3-uncloneable.
**Fix:** Distinguish "gradient fill" (author it — free, high visual payoff) from "animated gradient"
(V3 ceiling). Don't drop the whole treatment because the animation is out of reach.

---

*Append new clone-specific lessons here. Mechanical gotchas discovered during a clone run go in
`LESSONS_MECHANICAL.md` instead, so build and edit inherit them.*
