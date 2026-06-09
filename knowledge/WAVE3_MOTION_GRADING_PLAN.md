# Wave 3 — Motion fidelity: GRADE first, then author

@purpose Concrete implementation plan for Wave 3 (motion), scoped 2026-06-08. Follows the Wave-1 grader-truth
principle: the grader measures ZERO motion today, so it OVERSTATES motion-heavy sites (a dead static clone scores
like the animated original). MEASURE the motion gap first; author second. Builds on knowledge/MOTION_PLAYBOOK.md.

## Why grade-first (not author-first)
- We can't tell whether motion authoring helps until the grader can see motion. Same lesson as Wave 1 (source-cache
  determinism + invisible-text penalty had to land before reconstruction waves were measurable).
- A motion-gap dimension immediately makes the headline honest on framer/linear/stripe-class sites (the
  grader_overstates_top_end memory: 17-26pt overstatement; motion is a big slice of it).

## Wave 3a — motion-fidelity grading dimension (report-only first, then weight in)
New pass `detectMotion(page)` run on BOTH source and clone (clone is our WP page; source uses the frozen-capture
discipline — but motion needs LIVE re-visit, so cache the motion VOCAB per source URL like the source-shot cache).

Three detection passes (per EFFECT_RECOGNITION_AND_DETECTION.md / playbook Phase 1):
- **A. Library/static grep** — page HTML + loaded script URLs for: gsap, three, lottie, lenis, locomotive, swiper,
  aos, splitting, tilt, particles, vanta. (HIGH-confidence signal.)
- **B. Computed-style scan** — count elements with: position:sticky, transform-style:preserve-3d, perspective(),
  backdrop-filter, scroll-snap-type, background-attachment:fixed, will-change:transform, transition on transform/opacity.
- **C. Behavioral** — DOM mutation at scroll=0 vs scroll=600/1200 (class/style additions = scroll reveals);
  fullPage pixel-diff T=0 vs T=2s with reducedMotion OFF (loop animations); hover a sample of cards and diff
  (hover lift/shadow/underline). Sample mousemove listeners (cursor effects).

Output vocab: `{ libraries:[], scrollReveal:n, hover:n, parallax:bool, sticky:bool, marquee:bool, loop:bool, count:n }`.

**Score:** `motionFidelity = weighted overlap(sourceVocab, cloneVocab)`. Source has reveals/hover/parallax the clone
lacks → gap. Clone reproduces them → credit. Report-only first (a `motion` field + per-class breakdown like the
playbook Phase-5 rubric), validate it separates animated-source clones correctly, THEN fold into composite
(re-weight; per grader_strictness_is_progress, the headline dropping on motion-heavy sites is the WIN).
Gate GRADER_MOTION. Watch the void-detector lesson: a static clone of a hover effect ISN'T visibly broken — only
penalize motion that's actually absent, and only LIVE-detectable motion (don't over-credit source noise).

## Wave 3b — author the top-ROI effects (gated, per-effect LOOK + the new motion grade)
Per playbook "Top T1 effects", lowest-tier-that-works, each gated + validated by the 3a motion grade:
1. Scroll-triggered reveals (fade-up/slide-in) — 67% of SaaS. Free: AOS via html widget, OR custom_css
   @scroll-timeline (Chromium). Emit on editable section/widget custom_css with prefers-reduced-motion override.
2. Hover lift+shadow on cards — free CSS, trivial; emit on grid card containers (Wave-2/grid cards already exist).
3. Sticky header — free CSS/JS snippet.
4. Marquee logo/text strips — free @keyframes.
5. (later) GSAP escape-hatch for parallax/pin — enqueue via PHP per the playbook's failure-mode checklist
   (ancestor-transform, ScrollTrigger.refresh, idempotent init, scoped selectors, cleanup). NOT a CDN tag.

Each effect: detect in source (3a) → author → re-grade motion → LOOK (hover/scroll the clone). Animate transform/
opacity ONLY (CWV). Always add prefers-reduced-motion.

## Sequencing
3a (grading) is the unlock + is non-destructive (report-only). Build it, validate separation on framer/linear vs
static sites, then 3b authoring one effect at a time, each measured by 3a. The reconstruction waves (grid/talltext/
mediasplit) gave us editable native widgets to ATTACH motion to — motion on a rastered section is impossible, so
Wave 3 depends on the editability waves already shipped.

## Honest scope
Wave 3 is multi-session: 3a is one focused build (a detectMotion pass + scoring + validation); 3b is per-effect
increments. Fidelity caps by source type are in MOTION_PLAYBOOK.md (motion-heavy V3+CSS ~70-80%, +libraries ~92%).
