# LEVER A — Distilled Cheap Reward (scope)

**Status:** scoped 2026-06-19, not yet built. Origin: the best-of-N vertical slice + blind vision-panel confirmation
(see journal 2026-06-19; memory [[bestofN_reward_is_bottleneck]]).

## Why this is the gate
The slice proved the system is an RL setup with the loop cut open: builder = policy, grader = reward, render = env. Two
experiments settled where the leverage is:
- **Generation is NOT the bottleneck.** Best-of-6 LLM authorings of the resend hero produced multiple clean, faithful
  reconstructions (H2/H5/H6), all far better than the deterministic build (D0, broken nav/logo/headline).
- **The cheap reward IS the bottleneck.** Block-SSIM ranked the *broken* D0 **#4 of 7 — above three clean reconstructions**,
  and "beat" deterministic by only +0.019. The blind 3-judge **vision** panel ranked that same D0 **dead last (19.3/100,
  judges 22/18/18)**, with a 19→78 spread (vs SSIM's 0.045). Vision is reliable (tiny panel variance) and **distillable**.

Conclusion: **you cannot RL against the cheap pixel reward; the vision reward is trustworthy and distillable.** Lever A =
turn that trustworthy-but-expensive vision signal into a **cheap, Goodhart-resistant** reward that runs thousands of times
inside best-of-N / RL. Lever B (best-of-N harness, `_boN-reward.mjs`) is already built and waits only on this.

## Success criteria (what "done" means)
A reward `R(source, render, tree) → scalar (+ pairwise pref)` that is:
1. **Trustworthy** — Spearman ≥ 0.9 vs the vision teacher / human anchors on a *held-out* set, and **zero rank-inversions
   on broken-vs-clean** (the D0 failure must not recur).
2. **Cheap** — ≤ ~$0.001/eval or fully-local, so best-of-N at K≥16 across the corpus and many RL iterations is affordable.
3. **Goodhart-resistant** — passes the injected-defect game-tests + adversarial probes (raster-gaming, dark-bg, invisible-
   text, source A/B) *before* loop use. Drops on every real defect.
4. **Editability-aware** — includes the native round-trip term so rasterization can't game it (the historical exploit).

## Assets to reuse (do NOT rebuild)
- **Teacher:** the blind vision-judge panel (this session) — reliable, distillable.
- **Human anchors:** V2 blind sheet (`eval/grader/calibration/SCORING_SHEET_V2.html`, still unscored), midrange sheet,
  the **degradation ladders** (free ground-truth ordered pairs L0>L1>L2>L3>L4 at zero label cost), annotation JSONL.
- **Cheap deterministic features:** region-judge vetoes (missing-logo / invisible-heading / blank-hero / unstyled-CTA),
  grade-structure (textCoverage, editability, hRatio, designSystem, contrast), dark-ink/contrast signals, round-trip cert.
- **Pipeline:** capture → author/transpile/build → `render.mjs` → features. Selection harness `_boN-reward.mjs`.

## Architecture of the reward
```
R = g( visual_sem(source, render),  editability(tree, roundtrip),  defect_vetoes(render, tree) )
```
- **visual_sem** — image-embedding (CLIP/SigLIP) cosine of source-crop vs render-crop, **per section**. Replaces SSIM
  (which is fooled by dark-bg dominance + pixel misalignment). Optionally patch/region embeddings for locality.
- **editability** — native-widget round-trip coverage (existing cert). Keeps the flywheel objective; anti-raster.
- **defect_vetoes** — the existing deterministic detectors as **hard penalties** (they already encode hard-won failure
  modes; they are the Goodhart guards that don't depend on the learned head).
- **g** — a small **learned combiner** trained on the teacher's *pairwise preference* (Bradley-Terry / ranking loss;
  ranking is all best-of-N needs and is more robust than absolute scores). Start hand-weighted, learn weights once data exists.

## Staged plan
- **Stage 0 — cheap-LLM-judge baseline (fastest value).** Wrap the vision panel as a callable reward `judgeRender(source,
  render) → score` (Haiku, batched, blind, the panel rubric). Immediately usable for best-of-N at modest scale; proves the
  closed loop end-to-end. Re-run the slice → expect best-of-N to select H2 over D0 cleanly. **Deliverable:** `reward-vision.mjs`.
- **Stage 1 — label dataset.** Generate a few hundred (source, candidate) renders across sites/sections (author→transpile→
  render at temperature for diversity + existing builders for breadth + ladders for free ordered pairs). Label with the
  teacher panel; fold in human anchors. **Deliverable:** `reward-dataset.jsonl` + a generator.
- **Stage 2 — train the cheap learned reward.** Compute features (embeddings + region-judge vetoes + editability) per
  render; train `g` (pairwise/ranking loss) to predict teacher preference. Local, ~$0/eval. **Deliverable:** `reward-cheap.mjs` + model.
- **Stage 3 — adversarial certification gate (BEFORE loop use).** Run injected-defect game-tests + adversarial probes;
  require: drops on every real defect, no broken-vs-clean inversion, Spearman ≥ 0.9 held-out. **Deliverable:** `_reward-cheap-gametest.mjs`.
- **Stage 4 — close the loop.** Plug the certified cheap reward into best-of-N per-section (lever C) in `clone.mjs`;
  measure corpus lift vs deterministic. Folds into levers B/C.

## Risks → mitigations
- **Distilling Claude, not humans** → anchor on human V2/ladder labels, not the teacher alone; periodically re-check vs human.
- **Goodhart in the loop** → keep deterministic vetoes as hard floors; re-run the adversarial gate after any reward change;
  loop-until-dry adversarial mining of whatever the policy starts exploiting.
- **Embedding blind spots (e.g. exact text)** → add an OCR/text-match feature; keep the defect vetoes.
- **Label cost** → ladders give free ordered pairs; teacher only labels the ambiguous middle band.
- **Section granularity** → start whole-hero (proven), move per-section once stable.

## Open decisions for the user
1. **Cheap target:** ship the **Haiku-judge (Stage 0) now** for an immediately-usable loop, *and* build the learned-on-
   features model (Stage 2) for zero-per-eval scale? (Recommended: both, staged.)
2. **Anchor authority:** trust the vision panel as teacher, or gate every reward release on fresh **human** pairs (the V2
   sheet still needs scoring)? Recommended: teacher for volume, human anchors as the calibration ground-truth + drift check.

**Recommended first build: Stage 0** (`reward-vision.mjs`) — smallest, proves the closed loop, and unblocks best-of-N today.
