# Clone Fidelity System — Brutal Evaluator + Self-Reinforcing Loop (SPEC)

**Date:** 2026-05-31 · **Status:** design of record for the fidelity overhaul · **Mandate:** user-critical

## Principles (non-negotiable)
1. **Brutal honesty.** The grader reports *measured* pixel/behavior fidelity, never a vibe. Default to failing; earn points only for verified matches. If it's not pixel-matching, it says so with a number.
2. **No ceiling, no excuses.** There is NO "uncloneable" verdict. Anything not reproduced — including animated WebGL gradients — is a **defect tagged with the capability we must build** (e.g. asset-capture), not an inherent limit. "Can't" is banned; it becomes a tracked capability gap.
3. **Self-reinforcing / compounding.** Every clone makes the next one better: grade → root-cause → feed back into pipeline + technique library → measure the fidelity trend on a frozen golden set. Capability compounds.

This overhauls the current vision-only grader (joist-clone Phase 5 / `Critique/CritiqueRunner` + `AesEvalRubric`), which is subjective, has no pixel-diff, no hover/scroll capture, and an `uncloneable_at_chosen_tier` escape. Build ON the existing eval substrate, not beside it.

---

## Part A — The Brutal Evaluator

**Runs on BOTH the source and the clone** (capture/diff is skill-side where local Playwright lives; scores/history persist to the plugin `Eval` substrate via `EvalRecorder`).

### A1. Capture protocol (matched states, source vs clone)
- **Static**: full-page + per-section screenshots at matched viewports — **desktop (1440) AND mobile (390)**.
- **Hover**: programmatically hover EVERY interactive element (buttons, links, cards, nav) on both; screenshot each state.
- **Scroll**: capture at 0 / 25 / 50 / 75 / 100% on both; diff per step (reveals, parallax, pinning, sticky).
- **Time-lapse**: T=0 vs T=2s at rest (loop animations, gradients, marquees).

### A2. Measurement passes (objective, before any vision call)
- **Structural/layout diff** — element counts, section count + heights, grid/flex column verification (are columns actually side-by-side?), layout-density heatmap. Catches truncation + silent column-stack.
- **Color** — dominant-palette ΔE + histogram diff vs source (catches "flat blue instead of white+gradient").
- **Typography** — computed `font-size`/`weight`/`family`/`line-height`/`letter-spacing` per text node vs source.
- **Asset presence** — does the clone use a REAL captured asset where the source has an image/video/gradient, or a placeholder/flat fill? Placeholder where source has art = severe defect.
- **Per-region pixel diff** — aligned regions, % mismatch.
- **Dynamic reproduction** — for each effect detected on the source (Phase 1b), assert the SAME visual change occurs in the clone's hover/scroll/time-lapse captures. Not detected-in-source-only; **verified-in-clone**.

### A3. Scoring — inverted & evidence-gated (no inflation)
- Start at **0**; the **measured** passes set hard caps the vision model **cannot exceed**. Vision adds qualitative defects only; it can never inflate past what measurement allows.
- Report a **hard fidelity %** (overall + per dimension: layout, type, color, imagery/assets, spacing, motion-static, motion-dynamic, mobile).
- Output a **concrete defect list** — each: `{location, observed, expected, severity, root_cause_tag, capability_gap_tag, remedy}`.
- **Remove** `uncloneable_at_chosen_tier`. Replace with `capability_gap_tag`.

---

## Part B — No-ceiling defect taxonomy (every gap → a capability to build)
Each defect carries a `root_cause_tag` ∈ { `extraction_miss`, `hallucinated_placeholder`, `asset_not_captured`, `type_mismatch`, `color_mismatch`, `structure_mismatch` / `truncation` / `column_stack`, `motion_not_reproduced`, `authoring_bug`, `responsive_miss` } and a `capability_gap_tag` pointing at the system capability to build/strengthen. Examples:
- flat-blue-instead-of-gradient → `asset_not_captured` → **build asset-capture** (screenshot/record source art → host in WP media → use real URL). Animated gradient → capture as **looping video/sprite**.
- "Stripe Dashboard" box → `hallucinated_placeholder` → **generator guard: never fabricate labeled placeholders; represent real element or omit honestly.**
- split heading vs one flowing line → `extraction_miss` → **structure parser fidelity.**
- missing logos/ticker → `extraction_miss` (JS-loaded) → **render-then-extract (Playwright DOM, not static HTML).**
Capability gaps accumulate into a backlog with frequency weighting (most-common gap = highest priority).

---

## Part C — The self-reinforcing flywheel
```
clone → BRUTAL GRADE (A) → DefectAnalyzer: defect → root_cause → remedy → lesson/rule
      → auto-append joist-clone/LESSONS.md  +  PreferenceMemory Rule(confidence)
      → next run inherits lessons+rules (rendered into prompt)  +  capability backlog reprioritized
      → fidelity TREND tracked on frozen CORPUS.md golden set via EvalRecorder/RollupJob
      → measure compounding (Stripe 34 → ↑ each run); regressions caught by the trend
```
- **Reuses**: `Critique/CritiqueRunner` (+ forced-optimization gate), `Eval/PreferenceMemory`+`Rule`+`ConfidenceDecayJob`, `Eval/EvalRecorder`+`RollupJob`, `Critique/DiversityCheck`, `eval/CORPUS.md`+`BASELINE.md`, `Quality*`/`Critique*` REST.
- **New**: `Eval/DefectAnalyzer` (defect→root-cause→remedy→lesson), the brutal capture+measurement grader (skill-side), motion-reproduction verifier.
- Proof the loop works already exists: BASELINE wave 2 took aspendental **54→84** by hand-encoding gaps into rules. This overhaul makes that extraction **automatic + brutal**, so it compounds without a human in the loop.

---

## Part D — Build sequence
1. **Brutal grader first** (you can't improve what you can't honestly measure): capture protocol + measurement passes + inverted scoring + honest %/defect list. Re-grade the Stripe clone → expect a brutally low, *honest* score with a localized defect list.
2. **DefectAnalyzer + auto-feedback** — close the loop to LESSONS.md + PreferenceMemory; track trend on the corpus.
3. **Asset-capture capability** — screenshot/record + host real assets (gradient video, logos); the single biggest fidelity lever (and unblocks the Lenis file too).
4. **Re-clone Stripe on the loop** — iterate until the *automated* output matches the hand-authored v2 bar, with the trend proving compounding.

## Honest architecture note
Capture + diff run **skill-side** (local Playwright drives source + clone). Scores, defects, rules, and trend persist in the **plugin Eval substrate** so history/learning survive across sessions and sites. The grader is the foundation of the flywheel — build it first, make it merciless.
