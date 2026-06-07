# ULTRA PLAN — Autonomous Self-Grading 1:1 Clone Flywheel

**North star:** given any URL, autonomously produce an Elementor clone that is **1:1 (pixel-faithful AND editable)** by **grading its own work and improving until it's right — end to end, no human in the loop.**

This plan turns this session's parts (capture-layout, build-absolute/hybrid/raster, grade-structure, corpus-run,
route-clone, diag-text, font-register) into a closed-loop self-improving system. It has **three nested loops** and
four **safety rails** that make autonomy trustworthy (the same disciplines that caught ~8 wrong turns this session).

---

## The shape: three nested loops

```
OUTER loop  (system self-improvement, across a corpus)   ── makes the SYSTEM better at Elementor
  └─ INNER loop  (refine one clone to target)            ── makes ONE clone hit 1:1
       └─ OBJECTIVE  (grade + localize + attribute)      ── "grade your own work" engine
```

The OBJECTIVE judges. The INNER loop drives one site to 1:1 by repairing its worst defect, re-grading,
keeping-if-better. The OUTER loop watches residual defects across many sites, improves the *code* to kill the
most common defect class, and verifies against a regression suite. Autonomy = run these unattended with guardrails.

---

## Layer 0 — The Objective (the unfakeable, localized judge)
*Without an honest, specific judge, autonomous improvement optimizes the wrong thing or fakes success.*

- **Composite** = `0.5·visual + 0.5·editability` (have it; visual<0.5 floor + height-overflow penalty).
- **NEW — localized defects:** grade per **section** (not just per-200px band) and emit a ranked defect list:
  `{section, dimension (visual|editability|geometry|color|missing-text), severity, attribution (capture-lost |
  build-lost | wrong-font | wrong-bg | drift), example}`. This is what the inner loop repairs. (Extends
  grade-structure + diag-text from page-level to section-level.)
- **Target gate ("1:1"):** operationally `visual ≥ 0.97 AND editability ≥ 0.95 AND hRatio∈[0.99,1.01]`, per section.
  Honest: true pixel-100% is asymptotic (fonts/AA/dynamic content); the gate defines "done enough to be 1:1."
- **REBUILD-HONESTY (the bar is *actually rebuilt*, not screenshotted):** "1:1" means real editable elements,
  not pixels-over-text. The grader detects a clone section that's IMAGE-covered while the SOURCE there is TEXT
  (cloneNativeText < 30% of srcText, imgCover > 50%, srcText ≥ 4) → strips its visual credit (cap 0.35) + flags
  `rastered-text-cheat`. So rastering TEXT is a LOSING move; the flywheel cannot cheat toward visual via
  screenshots. Images/logos/photos where the SOURCE is genuinely an image → full credit (allowed). Validated:
  pure-raster page 0.61→0.48 (9/22 cheats), genuine-native clone preserved (1/15). Builders must rebuild text;
  raster operator + mockup detector restricted to graphical-only (srcText<4 / txtLen<120).
- **Wall detector:** a renderability probe (did the source content actually render in headless?). Distinguishes
  "fixable bug" from "real capture wall" (framer/Stripe) so the loop never spins forever on the impossible.
- **Anti-drift:** the `--validate` basket (known-good + deliberately-broken pages) must classify correctly on
  every run, so the judge can't silently rot. The grader is the most safety-critical component.

## Layer 1 — Inner Loop (`refine-loop.mjs`): drive ONE clone to 1:1
*"Grade your own work and improve until it's right" for a single site.*

```
capture → build → grade(localized) → while not(target) and improving:
    pick worst section-defect → apply its REPAIR OPERATOR → re-grade → KEEP-IF-BETTER (else revert)
  → stop at target OR K rounds with no gain → emit clone + residual "blocked" report
```
- **Repair operators** (a verified library; the loop selects by defect attribution):
  - capture-lost → re-capture that section with heavier settle / click-drive / scroll-into-view / mockup-off.
  - wrong-font → auto-register the section's real font (Font Library) + inject via custom_css.
  - wrong-bg → perimeter-sample the section bg (not whole-box) → absolute bg-rect.
  - drift/geometry → re-measure + correct widget offsets/sizes.
  - native-can't-hit-it → fall back THAT SECTION to raster (per-section router) — guarantees visual even when
    native reconstruction caps out, while keeping the rest editable.
  - build-lost → fix the builder filter dropping it.
- **KEEP-IF-BETTER** is the core discipline: every repair must raise the section's grade or it's reverted. This is
  what makes the loop converge instead of thrash (this session, blind tweaks regressed; verified tweaks compounded).

## Layer 2 — Outer Loop (`evolve.mjs`): make the SYSTEM better, autonomously
*The meta-flywheel: improve the capture/builder CODE so every future clone starts higher.*

```
run inner loop over CORPUS → aggregate residual defects → rank defect CLASSES by frequency×severity →
  for the top class: generate candidate code fix (in a worktree) → re-run corpus → 
  KEEP-IF corpus-mean rises AND no site regresses (regression suite) → add fix to RECIPE LIBRARY → repeat
```
- This is where parallel agents/Workflow earn their keep: fan out **candidate fixes** for the top defect class,
  judge each by the grader on the corpus, keep the winner. (Same pattern that found the mockup text-guard.)
- **Recipe library:** each kept fix is a permanent, named capability all future clones inherit. Knowledge
  compounds in the *code*, not just memory. This is the "exponential" engine.
- **Regression suite = the corpus.** Every site that reaches a grade is locked; the suite runs after every
  system change → gains are monotonic (no fixing A while breaking B — which happened this session before the suite).

## Layer 3 — Autonomy Harness: run it end-to-end, unattended
```
given target(s): inner-loop each to best achievable
  if a defect CLASS blocks many → trigger outer-loop system improvement → re-inner-loop
  if a site hits a real WALL (renderability probe) → route to fallback (hybrid/raster) + flag for human-assisted lane
  checkpoint every round; honest status log; budget/iteration caps; never report false-100%
```
- Guardrails (the trust layer): honest grader (no fake success) · regression suite (no backslide) · wall-detector
  (no infinite spin) · budget caps (bounded cost) · checkpointing (resumable). 
- **Wire into the Joist agent** (MCP tool / skill) so "clone this URL to 1:1" is one autonomous invocation.

## Layer 4 — Breadth (close the structural gaps that cap 1:1)
*These are prerequisites for "100% end-to-end" on real sites, beyond the desktop-marketing-page case.*
- **Responsive** — per-breakpoint capture + per-breakpoint absolute offsets (or hybrid flow+absolute). Today
  absolute is desktop-pixel-only; this is the biggest single gap to a real product.
- **Dynamic / headless-unrenderable sites** (framer, Stripe) — headed/human-assisted or recorded-interaction capture.
- **Whole-site / multi-page** — crawl pages, shared nav/footer as global templates, export a Kit.
- **Site-archetype diversity** — e-commerce, forms, logins, blogs, dashboards, RTL/non-Latin, heavy-animation.
- **Editability QUALITY** — reconstruct a clean, human-editable container hierarchy, not just flat-positioned widgets.

---

## Build order (each phase leaves a working, better system)
1. **Phase 0 — Objective hardening:** section-level localized defects + attribution + target-gate + wall-probe +
   validate-basket. *(Everything else depends on the judge being honest + specific.)*
2. **Phase 1 — Inner loop:** `refine-loop.mjs` + the verified repair-operator library + per-section raster fallback.
   *Deliverable: one command drives a site to its best achievable 1:1, autonomously.*
3. **Phase 2 — Outer loop:** `evolve.mjs` (corpus → ranked defect classes → agent-generated fixes → regression-gated
   keep → recipe library). *Deliverable: the system improves itself overnight, monotonically.*
4. **Phase 3 — Autonomy harness + Joist-agent wiring.** *Deliverable: "clone URL → 1:1" as one unattended call.*
5. **Phase 4 — Breadth:** responsive → whole-site → dynamic-capture → diversity. *Deliverable: 1:1 on real sites,
   not just desktop marketing pages.*

## Honesty clauses (non-negotiable, learned this session)
- The grader defines "done." It must never report a false 100% (it once over-scored a 3x-tall page → fixed).
- Every change — per-clone repair OR system fix — must be VERIFIED to improve the grade, else reverted.
- The loop must know a WALL from a BUG and stop spinning on the impossible (route to fallback + flag).
- "1:1" is gated + measured, not claimed. Some sites cap below the gate without human-assisted capture — say so.

## Current standing (the launch point)
Architecture proven (absolute = 1:1 structure + editable), objective honest, flywheel real; supabase 0.878
(visual 0.93 + 83% editable) shows the target is reachable; adaptive corpus mean 0.705. Phases 0–1 are the
immediate path from "I improve it by hand" to "it improves itself to 1:1." See [CLONE_PIPELINE.md] for the parts.
