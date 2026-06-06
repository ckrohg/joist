# Building-Block Curriculum — systematic, surgical, exponential training

**Thesis:** the web has a *finite, enumerable* vocabulary of building blocks. Instead of cloning whole messy
sites and reacting to whatever defect dominates (noisy, mixed signal), **enumerate the vocabulary, ace each
block in ISOLATION (clean signal), and compose.** Unit-tests before integration-tests. Each aced block becomes
a recipe every future clone inherits → exponential, not linear.

This plan plugs directly into the flywheel we already built (honest grader → inner refine-loop → corpus-gated
`evolve` self-improvement engine → recipe library). It adds the three things that make training *systematic*.

## LOCKED DECISIONS (approved before kickoff)
- **Bench sources: BOTH** — a synthetic minimal page per block (clean, deterministic signal) AND ≥1 real-site
  instance per block (guards against synthetic-overfitting). The existing 4 real sites = the integration test.
- **Sequencing: STRICT TIERS** — fully ace Tier-1 (atoms) + Tier-2 (composites) before Tier-3 (interactive),
  then Tier-4 (motion). Walk-before-run; cleanest compounding.
- **Grader composite reweight: `0.4·visual + 0.3·editability + 0.3·structural-fidelity`** — element-type
  fidelity becomes a real driver of the evolve engine's keep decisions (a form-rebuilt-as-text is penalized).

---

## The 3 honest gaps this fixes
1. **Capture is vocabulary-blind** — `capture-layout` collapses the DOM to ~9 kinds (container/heading/text/
   button/image/svg/mockup/code/accordion). It does NOT recognize forms, inputs, `<video>`, iframes, tables,
   real lists, selects, tabs, carousels, etc.
2. **Grader is vocabulary-blind** — it scores pixels + text-coverage + rebuild-honesty, NOT *element-type
   fidelity*. A form rebuilt as plain text scores fine. We measure "looks right + text present," not "right blocks."
3. **Whole-site signal is noisy** — a "missing-text" defect was really `mockup-rasterizer × logo-wall`. Mixed
   blocks → can't tell which block we're bad at. Isolation fixes this.

---

## Component 1 — The Building-Block Taxonomy (the finite vocabulary)
~30 canonical blocks, tiered (walk → run). (Synthesizes the 20-archetype taxonomy + DOM element set.)
- **Tier 1 — Static atoms:** heading, paragraph, button/link, image, icon (svg), list (ul/ol), blockquote,
  badge/tag, divider, code block.
- **Tier 2 — Static composites:** hero, nav bar, card, card-grid, feature row, stat/counter row, logo wall,
  testimonial, pricing table, footer-columns, CTA band, image gallery, two-column split, table.
- **Tier 3 — Interactive:** tabs, accordion, dropdown/mega-menu, carousel/slider, modal/dialog, FORM
  (text/email/select/textarea/checkbox/submit), search, sticky header, off-canvas/hamburger, video embed, map embed.
- **Tier 4 — Motion:** scroll-reveal, parallax, counter animation, split-text reveal, horizontal-scroll,
  sticky-pin, hover effects, marquee, smooth-scroll, lottie/animated-svg.

Each block gets: an ID, a tier, a detection signature (DOM pattern), a target Elementor reconstruction, and a
gate (visual ≥X, editability ≥Y, structural-fidelity = correct widget type).

## Component 2 — Element-Type-Aware Grader (the measurement that makes it systematic) — KEYSTONE
Add a **structural-fidelity** dimension to `grade-sections`:
- **Detect** each source block-type instance (form = has input/select/textarea; video = video/youtube-iframe;
  table = `<table>`; list = ul/ol+li; tabs = role=tab; accordion; carousel = slider pattern; nav; etc.).
- **Check** the clone reproduces the *correct Elementor widget type* at that location (form→form widget,
  video→video widget, tabs→tabs, accordion→accordion, list→icon-list, table→table) — not text/raster.
- **Score** `structuralFidelity = correctly-typed blocks / source blocks`. New composite (proposal):
  `0.4·visual + 0.3·editability + 0.3·structuralFidelity`. Re-validate the self-test (source vs source = 1.0).
- This converts vague "missing-text" into precise "rebuilt the FORM as text" → the engine knows exactly what to fix.

## Component 3 — The Building-Block Bench (the clean-signal test corpus)
A set of **isolated minimal reference pages, one per block** — each exercises ONE block on an otherwise-empty
page. Two sources per block: (a) a **synthetic** minimal page (clean, deterministic) and (b) ≥1 **real-site
instance** (avoid synthetic-overfitting). The clone→grade→fix loop runs per block → a *clean per-block signal*.
The existing 4 real sites become the **integration test** (validates composed blocks).

## Component 4 — Elementor Capability Matrix (front-load the knowledge; stop trial-and-error)
A table built from our knowledge docs (V3 widget ref, V4 atomic, motion artifacts, GSAP research, widget pack):
each block → `{Elementor widget, approach (native | needs-CSS | needs-GSAP | raster-only), V3/V4, gotchas}`.
Tells the `evolve` coder agent the *achievable ceiling + right approach per block upfront*, so it doesn't
rediscover Elementor's limits by trial. Flags blocks Elementor can't do natively → hybrid/GSAP/raster routing.

## Component 5 — The Acing Loop (how each block gets to 1:1)
Per block, run the corpus-gated `evolve` engine **against the bench** (not whole sites):
```
capture block → build → grade (visual+editability+structuralFidelity) → if < gate:
   coder agent proposes a builder/capture fix (guided by the capability matrix) → re-grade →
   KEEP iff bench mean rises + no block regresses → recipe → repeat until the block hits its gate
```
Most blocks need a **builder upgrade** to emit the right widget type (build-absolute today emits only
heading/text/button/image/html — not form/video/tabs/list/table widgets). The element-aware grader measures
the gap; the acing loop closes it; the recipe makes every future clone inherit it.

## Component 6 — Curriculum sequence + milestones
- **Phase A (foundation):** element-type-aware grader (Component 2) + capability matrix (Component 4) +
  Tier-1/2 bench (Component 3). *Deliverable: systematic measurement + clean static-block bench.*
- **Phase B (ace static):** evolve-per-block over Tier 1 + 2 until each hits its gate → recipes. *Deliverable:
  static + structural blocks ~1:1 + editable across the bench AND the real-site integration corpus.*
- **Phase C (interactive — Tier 3):** capture must recognize tabs/accordion/forms/carousel/video; builder emits
  the Pro widgets; grader scores interaction reproduced (does the tab/accordion/form *exist + function*).
- **Phase D (motion — Tier 4):** integrate the **8 existing motion slices** + GSAP escape-hatch + motion
  knowledge: capture **detects** animations (scroll-reveal/parallax/counter/hover/marquee), builder **applies**
  them (Elementor motion effects or scoped GSAP), grader scores motion reproduced. Walk→run honored (motion last).

## Component 7 — Integration with the existing flywheel (reuse, don't rebuild)
- `evolve.workflow.js` (corpus-gated engine) targets the **bench** as its corpus → block-level clean signal.
- `grade-sections` gains the structural-fidelity dimension (Component 2) → the upgraded objective.
- The capability matrix guides the coder agent's proposals.
- The recipe library compounds aced blocks; whole-site clones inherit them.
- The honest grader + self-test + corpus-gate + keep-if-better remain the safety rails throughout.

## Component 8 — Risks + mitigations
- **Synthetic overfitting** → every block also tested on ≥1 real-site instance; integration corpus is real.
- **Grader gaming** → structural-fidelity must be honest; extend the source-vs-source self-test to it (=1.0).
- **Interaction/motion grading is hard** (can't pixel-compare frames) → grade by *reproduction + function*:
  the interaction/animation EXISTS and FIRES (tab switches, accordion opens, counter animates, reveal triggers),
  measured via DOM/Playwright assertions, not frame-matching. Visual graded on a representative state.
- **Capability-matrix staleness** → it's a living doc, updated as recipes discover new Elementor truths.
- **Scope creep** → strictly tier-by-tier; a tier isn't "done" until its bench blocks pass the gate on real instances.

## Component 9 — Why this is exponential
Each aced block is a permanent recipe that lifts *every* future clone containing that block; the bench + matrix
front-load the knowledge so the engine works targeted; isolation gives clean signal so fixes converge; and the
`evolve` engine runs the acing unattended. Curriculum = "better across all surfaces" made concrete (each block
is a surface). Interactive + motion become explicit tiers, not someday.

## Build order (review gate before kickoff)
1. **Phase A** — element-type-aware grader (keystone) + capability matrix + Tier-1/2 bench.
2. **Phase B** — ace static/structural via evolve-on-bench → recipes; validate on real corpus.
3. **Phase C** — interactive tier (capture + Pro widgets + function-grading).
4. **Phase D** — motion tier (integrate slices + GSAP + motion-grading).
Each phase leaves a working, strictly-more-capable system, measured by the (now element-aware) grader.
