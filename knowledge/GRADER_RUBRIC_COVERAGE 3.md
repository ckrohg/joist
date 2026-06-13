# Grader Coverage vs the 100-pt 1:1 Cloning Rubric (2026-06-03)

User-supplied exhaustive rubric (7 categories, 100 pts). Mapped to what our self-grader ACTUALLY measures, to quantify how much of "true 1:1" we grade + prioritize gap-folds WITHOUT over-rotating.

**SCOPING (user-clarified 2026-06-03):** "1:1" = the RENDERED OUTPUT is indistinguishable — **PIXELS + INTERACTIONS** — NOT code-equivalence. We build in Elementor's format (like a human dev replicating a site in Elementor), so source HTML/CSS will never match and is NOT graded. Grade what a human / a screenshot+interaction diff perceives, not implementation. → Our grader is ALREADY correct on this: it renders BOTH source + clone and compares OUTPUTS; it never compares code. The rubric's CODE-fidelity items are therefore OUT OF SCOPE (see cat 5.3 partial + cat 7). Effective denominator ≈ 90 pts (the pixels+interactions+behavior+perf+a11y-output), of which we grade ~55–60; blind mostly to interaction + motion + perf.

| # | Rubric category (pts) | Our coverage | Verdict |
|---|---|---|---|
| 1 | **Visual Fidelity (25)** — layout, typography, color/effects, imagery, responsive | layout/position ✓ (perElement pos+SSIM), typography ✓ (typo sub), color ✓ (CIEDE2000), imagery ✓-ish (real uploads; object-fit partial), responsive ✓ (RLG, just added) | **MOSTLY COVERED.** GAP: effects (box-shadow / border-radius / backdrop-filter / blend-mode) — we CAPTURE border/radius/boxShadow but do NOT score them. |
| 2 | **Interaction Fidelity (20)** — click/form, hover/focus, scroll/gesture, state persistence | ~none (cloner is static; one scroll pos) | **BIG GAP** → motion/interaction track (hover-detection method banked in RESPONSIVE_AND_MOTION_GRADING.md). |
| 3 | **Motion/Parallax/3D (18)** — animations, parallax, WebGL, GSAP | none | **BIG GAP** → motion track (roadmapped; 4th grader dimension). |
| 4 | **Performance/Page Load (12)** — Core Web Vitals, asset opt, fps | none | **GAP** → addable as a Lighthouse shadow dimension (LCP/CLS/INP source-vs-clone). |
| 5 | **Meta/SEO/A11y/Code (10)** — head meta+OG+JSON-LD, ARIA/contrast/keyboard, semantic+console | A11y landmarks ✓ (completeness grader); head-meta/OG/SEO ✗, contrast ✗, console-errors ✗ | **PARTIAL.** Cheap folds (OUTPUT-side only): console-error count, head-meta/OG presence, contrast ratio. NOTE: 5.3 "code mirrors original class/BEM strategy" is OUT OF SCOPE (code-equivalence, not output) — keep only the OUTPUT-observable a11y (ARIA/landmark/contrast/keyboard) + no-console-errors. |
| 6 | **Cross-platform/Edge (8)** — multi-browser, real devices, print/dark/offline | single Chromium | **GAP** (multi-browser heavy; dark-mode the interesting slice). Output-observable, in scope. |
| 7 | **Polish/Docs/Deliverables (7)** — source, tokens, version history | N/A | **OUT OF SCOPE** — code-equivalence / human-deliverable, not rendered output. We build in Elementor's format; source-code traceability does not apply. |

## Fold-in plan (do NOT over-rotate — prioritized, cheap-first)
**CHEAP high-value (fold into the grader backlog now):**
1. **Effects sub-score** (cat 1) — score box-shadow / border-radius / backdrop-filter / blend-mode in the per-element metric. We ALREADY capture border/radius/boxShadow (capture-layout) — just add a small effects term (CIEDE-like tolerance). Closes a real cat-1 gap with data we already have.
2. **Console-error / no-error check** (cat 5.3) — count JS console errors on the clone vs source; a clean honest quality signal, ~trivial to add to grade-sections.
3. **Head-meta / OG / title presence** (cat 5.1) — does the clone reproduce title/description/OG? Cheap presence check (folds into the completeness grader nicely).

**MEDIUM (a real new dimension when prioritized):**
4. **Performance dimension** (cat 4) — Lighthouse on source vs clone (LCP/CLS/INP), as a shadow first (like responsive/completeness), then maybe a small composite weight.

**BIG (already on the roadmap — do NOT rush):**
5. **Interaction + Motion (cat 2+3 = 38 pts!)** — the motion/interaction track (hover via event-replay→state-diff; scroll/parallax via step-scroll trajectory; per RESPONSIVE_AND_MOTION_GRADING.md). This is the single largest blind spot and the 4th grader dimension, sequenced after the current responsive+completeness work matures. Interaction2Code research shows even frontier models do this poorly → high-value differentiator, but a deliberate build, not a fold.

## Discipline note
Per [[grader_strictness_is_progress]]: folding any of these in will DROP the composite (we currently score ~0 on motion/interaction/perf) — that's the honest re-baseline, the right pressure. But "don't over-rotate" = fold the CHEAP gaps (effects/console/meta) into the existing graders incrementally; treat motion+perf as their own deliberate dimensions, not a rush to implement all 100 points at once.
