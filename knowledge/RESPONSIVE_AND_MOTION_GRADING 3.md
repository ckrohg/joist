# Responsive + Motion Grading (research 2026-06-03, wave w8zxa9aec)

Adversarially-verified (20/25 claims confirmed). Answers the user's "does the grader test responsiveness / motion?" — it does NOT (single 1440px, one scroll pos). Here's how to add both.

## RESPONSIVE FIDELITY — the metric: Responsive Layout Graph (RLG)

**RLG** (ReDeCheck, Walsh/Kapfhammer/McMinn, ISSTA 2017, DOI 10.1145/3092703.3092712): model a page as a graph — **nodes = visible DOM elements**, **edges = pairwise alignment constraints `(amin, amax, t, P)`** where `amin–amax` is the inclusive viewport-width RANGE over which elements e1,e2 hold relationship `t` (∈ {parent-child, sibling}) with alignment set `P` (left-of, right-of, above, below, overlap, contains). Worked example: a sibling pair flips from `above (320,767,s,{A})` to `left-of (768,1400,s,{L})` at the 768 breakpoint.

→ **Grade responsiveness = edge-set agreement between the source RLG and the clone RLG**: for each source element-pair, does the clone reproduce the same relationship + alignment + breakpoint width-range? This is the per-element cross-width "reflows correctly" metric — NOT per-width pixel diff.

**Extraction recipe (RQ1b):** render in a real browser (Playwright) and read layout via the DOM at sampled widths **320–1400 in 60px steps**, PLUS boundary-sample the page's **declared CSS breakpoints** (parse `@media` rules / CDP `CSS.getMediaQueries`), then **binary-search between adjacent differing samples** to localize exact change widths. Derive from the rendered DOM, not source CSS alone. CDP `CSS.getMatchedStylesForNode` gives matched rules/inheritance; `CSSMedia` exposes the query string.

**Oracle-free self-consistency:** a relationship holding over a wide range but breaking at one adjacent width = likely failure; always-holding = intended. Lets the flywheel flag clone divergences without trusting the source as a perfect oracle.

**Production VRT converges on the same insight — pixel diff is wrong across breakpoints:** Applitools **"Layout" match level** grades *relative element positions* while ignoring content/color/style, and is the explicitly-recommended mode for cross-viewport testing (Ultrafast Grid renders one captured DOM snapshot across all environments). For per-width *static* scoring, our existing Design2Code per-element decomposition (block-match/text/position/color + CLIP) is the right complement.

**Breakpoints to grade:** mobile 390 · tablet 768 · laptop 1024 · desktop 1440 · extra-wide 1920 (+ binary-searched declared breakpoints).

## MOTION / INTERACTION — we'd be BEYOND prior art

Honest SOTA: leading screenshot-to-code research treats motion as **OUT OF SCOPE** — Design2Code strips all script/svg/iframe and tests ONE static screenshot. The one benchmark tackling it (**Interaction2Code, ASE 2025**) shows even Claude-3.5/GPT-4o reproduce interactions markedly worse than static layout (Implement Rate 0.71–0.79). So **detecting + grading motion is novel** — a differentiator, not table stakes.

**Detection approach (our proposed instrumentation, not contradicted):** step-scroll the page and record each element's transform/opacity vs scroll position (scroll-reveal, parallax, pin/sticky); capture `:hover` computed-style deltas (hover effects); detect `IntersectionObserver` / GSAP / ScrollTrigger / Lenis / Framer Motion usage from the page's scripts. **Grading:** compare source vs clone animation triggers/timelines/easing.

**Motion-DETECTION method (the technique stands on its own merits — NOT Autotab-validated):** the right way to detect dynamic states is to dispatch the input event into a fully-rendered Chromium, let the browser recompute layout/paint/style, then snapshot the delta: (1) HOVER — for each candidate interactive element dispatch mouseenter, diff getComputedStyle before/after (+ a viewport screenshot diff) → non-trivial delta = a hover effect to record + reproduce. (2) SCROLL/PARALLAX/PIN — step-scroll in increments, record each tracked element's transform/opacity/position vs scrollY → a trajectory = scroll animation; constant-position-while-scrolling = sticky/pin. This is corroborated by ReDeCheck (multi-width DOM sampling) + the Interaction2Code benchmark, and is the obvious correct approach regardless of any vendor.

CAVEAT — Autotab (user-supplied 2026-06-03, then VERIFIED against the repo): the pasted "technical reference" OVER-CREDITED it. The actual OSS repo (github.com/Planetary-Computers/autotab-starter) is a DEPRECATED (Dec 2023, "no longer supported") Python Selenium record-replay → AI-codegen starter for TASK AUTOMATION; its README does NOT document the hover/scroll-detection mechanics in that reference (those describe the closed V1 product, with marketing embellishment). So treat Autotab as a weak/unverifiable corroboration, NOT a validating production system. The detection technique above is sound on its own (browser recomputes; we snapshot) — credit the method, not the vendor. Lesson: verify a shared reference against its primary source before banking it as validation.

## Routed plan
- **(b) NOW:** build `grade-responsive.mjs` (NEW shadow module) — RLG capture at 5 widths + source-vs-clone edge-set agreement + Applitools-Layout per-width. Self-test source-vs-source=1.0. Smoke: absolute builder (desktop-frozen → should score LOW) vs flow builder (reflows → HIGHER) to prove the metric DISCRIMINATES. → then make it a graded dimension so the flywheel + flow builder optimize it.
- **Motion:** later track — detection module (step-scroll instrument) → reproduce (existing GSAP/Pro authoring research) → grade. Novel; sequence after responsive lands.

Related: [[motion_vocabulary_artifacts]] (authoring) · RESEARCH_INFERENCE_AND_METRICS.md · CONTAINER_INFERENCE_SPEC.md
