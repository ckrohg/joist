# Motion Playbook — Synthesis of 6 Research Streams

This is the navigator. It points the joist-clone skill at the 6 source artifacts and gives a tier-decision framework. Read this first. Drill into the source artifacts only when you need their depth.

---

## The 6 source artifacts (what to read for what question)

| Question | Read |
|---|---|
| "What motion effects exist in modern web design? How do I recognize them?" | `MOTION_DESIGN_PATTERNS_2026.md` — taxonomy of 42 effects across 7 categories, with detection signals + real 2026 examples |
| "How do I recognize a specific effect on a source URL?" | `EFFECT_RECOGNITION_AND_DETECTION.md` — 10 effect classes with 4-layer detection (static HTML grep / Playwright runtime / DOM observation / screenshot diff) |
| "How do I author this in Elementor Pro?" | `ELEMENTOR_PRO_MOTION_EFFECTS.md` — exhaustive Pro Motion Effects reference with exact JSON setting shapes |
| "How do I author this in Elementor FREE (no Pro)?" | `CUSTOM_CSS_INJECTION_FOR_ELEMENTOR.md` — 30 CSS-only effects + 5 JS-light patterns, all copy-paste ready, free-tier verified |
| "What JS library do I embed via html widget?" | `THIRD_PARTY_MOTION_LIBRARIES.md` — 30+ libraries (GSAP, Three.js, Lottie, Lenis, Swiper, etc) with elementor/frontend/init lifecycle handling |
| "Where does Joist fall vs competitors on motion?" | `GENAI_WEB_BUILDERS_LATE_2026.md` — 21 AI builders compared on motion capabilities, fidelity, pricing |

---

## The 5-phase motion-aware clone workflow

This replaces / extends the basic 6-phase workflow in `joist-clone/SKILL.md`. Use this when the source has any motion.

### Phase 1 — Detect

Per `EFFECT_RECOGNITION_AND_DETECTION.md`, three detection passes against the source URL:

```
# Pass A — Static HTML/CSS signal grep
curl <source_url> | grep -oE "gsap|three\.min|lottie|lenis|locomotive|swiper|tilt|aos|splitting|particles|vanta"

# Pass B — Computed styles via Playwright
- position: sticky declarations
- transform-style: preserve-3d
- perspective() in transform
- backdrop-filter (glassmorphism)
- scroll-snap-type
- background-attachment: fixed (cheap parallax)
- will-change: transform (hint of motion)

# Pass C — Behavioral via Playwright
- Compare DOM at scroll=0 vs scroll=500 → class additions = scroll-triggered reveals
- Compare T=0 vs T=2s → pixel changes = loop animations
- Sample event listeners — mousemove count > 0 = cursor-following
```

Output: a list of detected effects with confidence levels (HIGH from library imports, MEDIUM from computed-style heuristics, LOW from behavioral inference).

### Phase 2 — Classify by tier

For each detected effect, look it up in this decision tree:

| Effect class | Free V3 CSS | V3 + custom CSS | V3 + Pro Motion Effects | V3 + JS library | Uncloneable in V3 |
|---|---|---|---|---|---|
| Background-attachment parallax | ✅ trivial | ✅ better | — | — | — |
| Multi-layer scroll parallax | ❌ | ⚠️ approximation | ✅ native (vertical/horizontal scroll) | ✅ GSAP ScrollTrigger | — |
| Scroll-triggered fade reveals | ❌ | ⚠️ @scroll-timeline (Chrome 115+) | ✅ Scroll Effects opacity | ✅ AOS / GSAP | — |
| Pinned scroll sequences | ❌ | ⚠️ position:sticky basic | ⚠️ Sticky widget basic | ✅ GSAP pin | — |
| Scrollytelling (multi-trigger) | ❌ | ❌ | ❌ | ✅ GSAP timeline | — |
| Scroll-driven video scrubbing | ❌ | ❌ | ❌ | ✅ GSAP + video | — |
| Sticky stacking cards | ❌ | ✅ position:sticky pattern | ⚠️ partial | ✅ GSAP | — |
| Horizontal scroll sections | ❌ | ✅ scroll-snap-x | ❌ | ✅ GSAP horizontalScroll | — |
| Magnetic cursor | ❌ | ⚠️ CSS approximation 40% | ❌ | ✅ vanilla JS | — |
| Tilt-on-hover | ⚠️ basic | ✅ preserve-3d | ⚠️ Mouse 3D Tilt | ✅ vanilla-tilt | — |
| Cursor-following blob | ❌ | ❌ | ❌ | ✅ vanilla JS | — |
| Image swap on hover | ✅ trivial | ✅ | — | — | — |
| Hover gradient mesh | ❌ | ✅ backdrop-filter + transition | — | — | — |
| Hover underline animation | ✅ trivial | ✅ | — | — | — |
| CSS 3D card flip | ⚠️ basic | ✅ preserve-3d | — | — | — |
| Three.js / WebGL hero | ❌ | ❌ | ❌ | ✅ Three.js / Vanta | ⚠️ ~75% cap |
| Mouse-parallax 3D layers | ❌ | ⚠️ approximation | ⚠️ Mouse Track | ✅ vanilla JS | — |
| WebGL shader effects | ❌ | ❌ | ❌ | ✅ Three.js / OGL | ⚠️ ~75% cap |
| 3D model viewer (glTF) | ❌ | ❌ | ❌ | ✅ Three.js / model-viewer | — |
| Variable font axis animation | ❌ | ✅ font-variation-settings | — | — | — |
| Split-text character reveal | ❌ | ⚠️ minimal | — | ✅ Splitting.js / SplitType | — |
| Marquee text | ❌ | ✅ @keyframes translate | — | ⚠️ overkill | — |
| Animated gradient text | ❌ | ✅ background-clip:text | — | — | — |
| Lottie animations | ❌ | ❌ | ❌ | ✅ lottie-web | — |
| Particle backgrounds | ❌ | ❌ | ❌ | ✅ tsparticles / Vanta | — |
| Smooth scroll inertia | ❌ | ❌ | ❌ | ✅ Lenis | ⚠️ a11y concerns |
| Bento grid + scroll reveals | ⚠️ static | ✅ grid + @scroll-timeline | ⚠️ + Scroll Effects | ✅ GSAP + grid | — |
| Glassmorphism | ✅ backdrop-filter | ✅ | — | — | — |
| Liquid blob backgrounds | ❌ | ✅ SVG path morph | — | ✅ Three.js / OGL | — |
| Entrance animations (fade/slide) | ✅ Elementor free (37 presets) | ✅ | — | ✅ AOS | — |
| Counter / number animation | ❌ | ⚠️ JS-light snippet | — | ✅ Anime.js / countUp.js | — |
| Sticky header (hide on scroll) | ❌ | ✅ scroll JS snippet | ✅ Sticky widget | ✅ Headroom.js | — |
| Carousel / slider | ⚠️ basic Image Carousel widget | ⚠️ Swiper CSS | ✅ Pro Slides widget | ✅ Swiper.js | — |

### Phase 3 — Choose authoring path

Per effect, pick the lowest tier that achieves acceptable fidelity. Order of preference:
1. **Free V3 CSS** — zero cost, no dependencies
2. **V3 + custom CSS injection** via html widget — zero cost, free tier
3. **V3 + Pro Motion Effects** — $59/yr Pro license required; native + reliable
4. **V3 + JS library embed** — free, but adds bundle weight + a11y risk
5. **Mark uncloneable** — be honest

The skill's report should label each effect with its tier choice + estimated per-effect fidelity %.

### Phase 4 — Author motion

For each effect, the implementation path:

- **Free V3 CSS:** use widget-level custom_css field. See `CUSTOM_CSS_INJECTION_FOR_ELEMENTOR.md` for the exact snippet per effect.
- **Pro Motion Effects:** set the motion_fx_* keys in widget settings JSON. See `ELEMENTOR_PRO_MOTION_EFFECTS.md` for exact key names.
- **JS library:** add an html widget with the library's CDN load + init template. See `THIRD_PARTY_MOTION_LIBRARIES.md` for the elementor/frontend/init-aware template per library.

Always add `@media (prefers-reduced-motion: reduce) { ... }` overrides — accessibility table-stakes.

### Phase 5 — Grade by motion class (not just overall visual)

Update the grader rubric to include per-class scores:

```json
{
  "overall_score": 0-100,
  "motion_scores": {
    "scroll_effects": { "score": 0-100, "detected_in_source": [...], "implemented_in_clone": [...] },
    "hover_effects":  { ... },
    "3d_perspective": { ... },
    "typography":     { ... },
    "loop_animations": { ... }
  },
  "uncloneable_in_chosen_tier": [
    { "effect": "scrollytelling", "source_url": "...", "reason": "GSAP timelines not authorable in V3 free without library embed" }
  ]
}
```

A clone that captures static layout perfectly (90%) but misses 5 motion classes (all 0%) should score honestly — maybe 75%, not 90%. The motion gaps are visible to the user.

---

## Fidelity caps by source type

The honest cap for what Joist can clone, by tier:

| Source type | V3 free fidelity | V3 + custom CSS | V3 + Pro | V3 + libraries |
|---|---|---|---|---|
| Static editorial / marketing | 90-95% | 92-97% | 95-98% | 95-98% |
| Standard SaaS / agency (mild scroll + hover) | 75-85% | 85-92% | 92-96% | 93-97% |
| Motion-heavy (parallax + scroll-triggers + hover-rich) | 50-65% | 70-80% | 88-94% | 92-96% |
| Interactive / 3D / WebGL portfolio | 30-45% | 45-60% | 55-70% | 80-90% |
| Custom Webflow/Framer-level interactive | 25-40% | 40-55% | 50-65% | 70-85% |

Always communicate these honestly in the skill's pre-flight summary AND in the final grade report.

---

## Competitive context (per Stream 6)

**Joist is currently behind on motion authoring** — Webflow + Framer have 5-10× more mature motion ecosystems. The opportunity:
- **Multi-page motion orchestration is unserved.** No competitor has "apply motion theme across all pages." Joist could own this.
- **Elementor Angie 4.1 (May 2026) generates atomic components but NOT motion.** Widens Joist's window to ship motion-aware authoring first in the WP+Elementor space.
- **Novamira Pro (May 15, 2026)** is the first direct WP+Elementor+typed-memory competitor. Lacks multi-page orchestration / clone pipeline / failure-mode catalogue. Joist still wins on those axes.
- **Declarative animation specs** (JSON-first, Replit/Remotion style) are the trajectory. Joist's plan format is already declarative — natural fit.

Three things to steal:
1. **Framer's timeline-based animation primitive** → maps cleanly to V4 atomic interactions when they land
2. **Webflow's CSS Scroll-Driven Animations** (`@scroll-timeline`) → modern Chromium feature; can ship to V3 via custom CSS today
3. **Replit/Remotion's declarative animation-as-data** → Joist's plan format extends naturally to motion specs

---

## Top T1 effects to nail first (highest ROI per Stream 1)

If we ship motion support incrementally, prioritize these — they're the most common AND have clean free-tier or Pro authoring paths:

1. **Scroll-triggered reveals** (fade-up, slide-in, scale-in) — 67% of top 100 SaaS pages have these. Pro Motion Effects native, OR AOS via html widget for free tier.
2. **Hover lift + shadow on cards** — table stakes. Free CSS, trivial.
3. **Sticky scroll headers** — 70%+ of modern marketing pages. Free CSS or Pro Sticky widget.
4. **Bento grids with scroll reveals** — hot in 2026. Free CSS grid + @scroll-timeline OR Pro Scroll Effects + grid.
5. **Marquee logo/text strips** — common in social proof + footer. Free @keyframes CSS.
6. **Image swap on hover** — case study cards everywhere. Free CSS, trivial.
7. **Glassmorphism cards** — premium aesthetic with backdrop-filter. Free CSS.
8. **Lottie animations** — 30%+ of modern portfolios. lottie-web via html widget, free.
9. **Counter / number animation** — stats sections. JS-light snippet, free.
10. **Smooth scroll inertia (Lenis)** — premium UX feel. Free library embed (but a11y caveat).

These 10 alone close maybe 60% of the motion gap. T2 (parallax, magnetic cursor, split-text reveals) and T3 (Three.js scenes, WebGL shaders, scrollytelling) come later.

---

## What to do RIGHT NOW after this playbook lands

1. Update `joist-clone/SKILL.md` Phase 1 to add the effect-detection step (per EFFECT_RECOGNITION + this playbook's tier decision tree)
2. Update `joist-clone/SKILL.md` Phase 5 (grading) to score per motion-class, not just overall visual
3. Update `joist-clone/LESSONS.md` with motion-specific gotchas (mobile prefers-reduced-motion, Lenis a11y, library lifecycle via elementor/frontend/init)
4. Add a new section to SKILL.md: "Pre-flight motion summary" — before authoring, tell user what's detected and what tier each effect needs

After these updates the joist-clone skill should be the **first AI clone tool that honestly grades motion fidelity** rather than ignoring it. That's the moat.
