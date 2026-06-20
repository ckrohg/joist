# Path to True 1:1 + Editable — V2 (research + fusion backed)

**Status:** authored 2026-06-19. Supersedes the spine of [PATH_TO_TRUE_1TO1.md](PATH_TO_TRUE_1TO1.md)
with a sharper reward architecture. Backed by: (a) this session's validated experiments, (b) web
research on SOTA (Design2Code benchmark, Perfect-Web-Clone, best-of-N theory, ELHSR), (c) a
**`/fusion` multi-model panel (Opus + Sonnet + GPT-5.5) that returned CONVERGENT — high confidence**;
both cross-vendor judges independently preferred the same answer.

---

## TL;DR — the call

The reward is the bottleneck, and **the human has been the reward function** — that is why progress
is human-time-bound, not compute-bound. The fix is **not** a better learned model and **not** a better
pixel metric. It is to make the reward a **deterministic element-correspondence *measurement*** between
the source box-tree and a **re-captured clone box-tree** (we already own the capture walk for both
sides), then let the already-built best-of-N orchestrator + a self-heal loop run against it. Everything
else is downstream of that one move.

> The single highest-leverage change: **Replace pixel-SSIM with a $0/eval deterministic
> element-correspondence reward (Block-Match + LLEM) computed over the bboxes/text/colors we already
> capture on *both* sides, and demote the LLM-judge to listwise *selection* only.**

Why it works where everything else failed: it is a **measurement, not a fitted model**, so it
structurally cannot overfit cross-site the way the cheap-hand-feature model did (its ρ = 0.20 / −0.9 was
the signature of *learning weights* on site-idiosyncratic pixel stats). It scores exactly the failure
modes SSIM is blind to — fine layout, color, missing/misplaced text — at $0. And we are **strictly
richer than Design2Code**: it has to OCR text-blocks out of screenshots; we own ground-truth DOM, text,
bboxes, and computed colors on both sides.

---

## 1. Where we are, and why we're far

- Corpus composite ~0.70 (mid-range); not close to true 1:1 at scale.
- The system is an RL loop with the loop cut open: **builder = policy, grader = reward, render = env.**
  Every "inch" of progress has been a human reading a failure and hand-coding a builder fix. That manual
  loop — not the builders — is the bottleneck.
- This session **proved generation is not the bottleneck**: best-of-6 independent LLM authorings of a
  hero produced multiple clean, faithful reconstructions. **The reward is the bottleneck:** pixel
  block-SSIM ranked the visibly-broken deterministic build #4 of 7 (above 3 clean ones); a blind 3-judge
  vision panel ranked it dead last (19/100). SSIM is ~flat on dark/sparse heroes (~85% matching
  background) and misranks broken-vs-clean.
- We then shipped a cheap LLM-judge (`reward-vision`), a ~10×-cheaper stable **listwise** judge, a $0
  **veto-floor**, a **per-section best-of-N** selector, and a **clone orchestrator** — all validated.
- And we proved a **negative**: a learned reward from cheap hand-crafted features (SSIM + veto flags +
  color-hist) does **not** generalize (leave-one-site-out ρ = 0.20; one held-out site ρ = −0.9). With no
  local neural-embedding capability, the cheap-feature learned model is empirically dead.

The V2 insight resolves that negative: **don't *learn* the anchor reward — *measure* it.**

---

## 2. What the SOTA does that works (researched)

- **Design2Code** (the standard UI-to-code benchmark) grades with a **multi-level metric stack**, not a
  single pixel score: CLIP-score (cosine of CLIP-ViT embeddings), CW-SSIM/SSIM, **Block-Match**
  (size-weighted recall/precision of matched text-block pairs by bbox overlap), **LLEM** = Low-Level
  Element Matching (existence + text + position + color, per block), TreeBLEU/htmlBLEU (code structure),
  and a multimodal-LLM **checklist judge** (0–10 per axis). SOTA models hit CLIP 83–89 / LLEM >80%;
  persistent failure modes are **fine-grained layout, color, and nested-structure hallucination**.
  Per-region "divide-and-conquer" generation gives **12–37%** gains.
- **Perfect-Web-Clone** (current best open cloner): clones **from the source** (DOM/CSS/computed styles),
  **not screenshots**; a **multi-agent coordinator + parallel workers** each handle a chunk (avoids
  context overflow on 200KB+ DOM); extracts responsive flexible units + all media queries; preserves
  semantic HTML (not div-soup); and runs a **render → detect → diagnose → auto-fix self-heal loop**
  validated against the extracted source. Honest limit: complex animation is a crawler/extraction problem.
- **best-of-N theory:** best-of-k with a teacher reward has generalization error decaying as **Θ(1/k²)**;
  LLM judges are strongest at **selection/reranking**, weak at absolute scoring.
- **ELHSR / "Reward Inside the Model":** a frozen LLM + a lightweight **linear head** predicts correctness
  with <0.005% params and **few training samples** — but it needs hidden states the Claude CLI doesn't
  expose. The realizable analog: a linear head on **semantic features** (CLIP embeddings, or the judge's
  structured rubric vector), which are site-invariant — unlike the pixel-stat features that died.

Net: the SOTA converges on exactly our architecture (source-projection + segment + select + repair), and
tells us precisely what to fix — **the reward metric** (correspondence + CLIP + judge, not pixel-SSIM).

---

## 3. The reward / grader architecture (the keystone)

A three-layer stack producing one signal. **Default selection path = at most one batched LLM call per
section.** The human is kept only as a periodic auditor.

### Layer 0 — Veto + editability HARD GATE (binary, $0, mostly built)
Region detectors (missing-logo, blank-hero, invisible-heading, unstyled-CTA) **plus a hard editability
gate**: fail (score → 0, eliminate) on rasterized text, opaque-screenshot regions, raw-HTML blobs, or
non-native absolute overlays beyond tolerance; require a % of visible area as native widgets and % of
text/media editable as Heading/Text/Button/Image/Background controls. **Editability is a gate, not a
0.15 weight** — it is a hard product requirement. This layer is *orthogonal* to the optimization target,
so the loop cannot optimize past "the logo is missing" or "it's a screenshot."

### Layer 1 — Element-correspondence (the deterministic anchor, $0) ← **build this first**
Re-run the **same Playwright/CSSOM capture walk on the rendered clone**, then bipartite-match source↔clone:
- **Block-Match:** match source↔clone **text blocks**, edge weight = f(bbox IoU, text-similarity);
  Hungarian assignment with IoU > τ ∧ text-sim > θ. Size-weighted `recall = Σ(matched source sizes)/Σ(source
  sizes)`, precision symmetric. Combine as **F2 (β=2)** so **missing source content is penalized harder
  than hallucinated extras**.
- **LLEM per matched pair**, reported **per axis** (these axes are the *diagnosis* that drives Layer-2 /
  self-heal): existence; text = 1 − normalized edit-distance; position = (1 − ‖Δcenter‖/page-diagonal) +
  size error; color = 1 − ΔE/ΔE_max on **fg and bg**.
- **Visual-block term:** existence/size/aspect/placement/dominant-color (+ asset identity via perceptual
  hash or `src`) for imagery and section backgrounds — catches "correct text floating on a wrong/blank
  background" that a text-only metric misses.
- Trustworthy **because it is not learned** — a direct comparison of two structured representations we
  have ground truth for on both sides. **It also dissolves the partial-page height-ratio floor**:
  correspondence composes section-by-section without a full-height assembly.

### Layer 2 — LLM-judge as the RANKER (cheap, built)
Restricted to its proven-strong job: **relative/listwise selection** among candidates that pass Layer 0
and sit in a Layer-1 frontier band — one batched Haiku call ranks all K. Plus a **mandatory single
adversarial check on every winner** ("right text/positions/colors but broken surrounding context — wrong
background, missing imagery, layout collapse?") at ~$0.002/section. **Never** used as a free-floating
absolute scalar to chase.

### Combination
- **Selection (default):** Layer 0 gate → Layer 1 narrows to a frontier band → Layer 2 listwise picks →
  adversarial winner-check. Prefer **rank aggregation** (median rank across {correspondence, CLIP,
  listwise-LLM}) over an absolute scalar — kills calibration drift.
- **Absolute progress number (tracking / regression / RL reward only):**
  `score = veto_gate × editability_gate × [ w₁·BlockMatchF2 + w₂·LLEM + w₃·CLIP + w₄·rubric_head ]`
  **Freeze the weights from the human-anchor calibration set (the 18 blind pairs + the tailwind verdict)
  — do not learn them from cheap features.** The rubric-head (WS4) is the *only* fitted component, and it
  fits **semantic** judge sub-scores on a few human samples, not pixel stats.

### Goodhart guards (non-negotiable)
1. an orthogonal hard veto/editability gate you can't optimize past; 2. a deterministic anchor tier you
can't satisfy without actually placing the right text/color/box/image; 3. the judge is *relative*, never
an absolute number to inflate; 4. the mandatory adversarial winner-check plugs the text-only-LLEM hole;
5. **seed adversarial cheat examples from day one** (invisible text, screenshot hero, raw-HTML blob,
correct-pixels/wrong-widget-tree) into the regression set; 6. the standing human-anchor audit (§6) as the
tether; 7. the existing **falsifier discipline** (selftest + injected-defect + game-test) gates every
reward change.

---

## 4. Top 5 workstreams (ranked by leverage)

**WS1 — Element-correspondence reward (`correspondence-reward.mjs`) — the keystone.**
- *Deliverable:* re-capture the clone with the source walk → bipartite text-block match → Block-Match
  (F2) + per-axis LLEM + visual-block term (above).
- *Why:* directly measures the SOTA-identified persistent failures SSIM can't see, over ground-truth DOM,
  with no OCR and no learned weights; per-block, so it dissolves the partial-page floor.
- *Success metric:* on the degradation-ladder + injected-defect set, recover monotone order at
  **Spearman ρ ≥ 0.85 leave-one-site-out** (vs the dead model's 0.20) and rank the broken deterministic
  hero **last** where SSIM put it 4/7.

**WS2 — Close the loop: render → detect → diagnose → auto-fix self-heal.**
- *Deliverable:* an automated repair pass. Use the **per-axis LLEM breakdown as the diagnosis**
  (color-axis low → regenerate with color correction; position-axis low → fix layout), regenerate only
  the worst block(s) via native widget edits, re-render, re-score, keep-if-improved. Bounded ~2
  rounds/section. **No human edit.**
- *Why:* the manual fix-loop is the proven meta-bottleneck; Perfect-Web-Clone validates self-healing;
  per-region regeneration is the 12–37% "divide-and-conquer" lever; WS1's per-axis reward makes
  "diagnose" *targeted* instead of blind resampling.
- *Success metric:* corpus composite rises with **zero human edits per cycle**; veto-rate keeps falling;
  N cycles strictly improve both **mean and minimum** on held-out sites.

**WS3 — Harden per-section best-of-N; listwise judge as the *selector*.**
- *Deliverable:* tighten the orchestrator — Tier-0 veto pre-filter → Tier-1 correspondence narrows to a
  frontier band → one batched listwise call selects → assemble → render.
- *Why:* generation isn't the bottleneck; best-of-k error decays Θ(1/k²); LLM judges are strongest at
  selection — the exact role that already killed our cross-run winner variance.
- *Success metric:* best-of-N section composite beats single-shot by a **stable** margin (no
  winner-variance across runs) and scales with k as theory predicts.

**WS4 — CLIP capability + ELHSR-style linear head on semantic judge sub-scores.**
- *Deliverable:* (a) add a **quantized CLIP-ViT (ViT-B/32) as an isolated inference sidecar** —
  onnxruntime-node or a version-pinned Python subprocess, *not* a torch/training stack — giving
  CLIP-cosine between source-section and clone-section renders; (b) have the judge emit a **structured
  rubric vector** (layout / color / text / hierarchy / completeness, each 0–10) and fit a *tiny*
  human-anchored **linear head** → one calibrated absolute scalar.
- *Why:* CLIP is SOTA's single most robust metric (83–89) and is *semantic*, patching the dark/sparse-hero
  flatness that sank SSIM (prefer CLIP over LPIPS, which is still low-level and inherits a softer version
  of the same flatness). The rubric-head is ELHSR adapted to a CLI with no hidden states: its features are
  **semantic and site-invariant** ("a 4 on color" means the same on any site), so a few-sample linear head
  generalizes where a head on pixel-stats catastrophically did not.
- *Success metric:* absolute-scalar correlation to the human-anchor set improves over WS1-alone, and CLIP
  separates the dark-hero broken/clean pair where SSIM was flat.

**WS5 — Responsive correspondence (native controls), then multi-page.**  *(measurement + emission BUILT 2026-06-20)*
- *Deliverable:* capture + correspond at **3 viewports**; emit native `_tablet`/`_mobile` Elementor
  controls instead of routing font-size + off-grid breakpoints through a `custom_css @media` channel that
  Hello+Free strips; grade per-breakpoint correspondence. Slot **multi-page / whole-site round-trip** as
  the explicit next epic once single-page is honest.
- *Why:* desktop-pixel non-responsiveness is the largest *capability* hole once the reward is trustworthy;
  correspondence extends per-viewport trivially.
- *Success metric:* per-breakpoint Block-Match/LLEM at 768/390 within tolerance of desktop; native controls
  firing (**zero `@media` in `custom_css`**).
- *Status (2026-06-20):*
  - **Measurement DONE** — `correspondence-responsive.mjs` (per-bp grade + desktop/mobile-min/GAP),
    `_correspondence-responsive-selftest.mjs` hermetic ALL PASS. Live: a desktop-only fixture collapses
    59.6→38.63→11.66 (gap 47.94) — quantifies the gap. `_ws5-quantify.mjs`.
  - **Emission ALREADY EXISTS** in `transpile-html.mjs`: MOVE-1 `responsiveTypo` emits native
    `typography_font_size_tablet/_mobile` (+ line-height); MOVE-2 native grid regroup → `width_tablet/_mobile`;
    P3 custom-breakpoint tablet controls + scoped css; mobile width-pin clears. Reversible:
    `RESPONSIVE_NO_NATIVE_FONTSIZE=1`. Deterministically VERIFIED firing (h1 64→40→28 → native controls in tree).
  - **Emission A/B** (`_ws5-emission-ab.mjs` + `_ws5-responsive-hero.html`): responsive-source fixture →
    clone gap ON vs OFF, proves the native controls SURVIVE Hello+Free and close the gap live. [result pending live run]
  - **LEFT:** multi-page / whole-site round-trip epic; responsive on the *absolute* builder (still desktop-pin).

*(Riding all five, not a workstream: round-trip editability stays a hard green gate — every output is
native V3 widgets, never raster.)*

---

## 5. What to STOP doing

- **Stop pixel-SSIM** as any part of selection or the absolute reward — it misranks and goes flat on
  dark/sparse content. The evidence is closed; no variant fixes it (background pixels dominate).
- **Stop trying to *learn* a reward from cheap low-level features** (multi-scale SSIM, color-hist, veto
  flags). ρ = 0.20 / −0.9. The features are the problem, not the count — don't revive it with "more features."
- **Stop hand-crafting grader dimensions as the path to truth.** Dimensions live only as $0 vetoes/anchors.
- **Stop hand-coding per-failure builder fixes as the primary improvement mechanism** — that *is* the
  human-time-bound loop. Allowed only as a fallback, and every manual fix must be converted into a
  self-heal capability (WS2).
- **Stop grading hero-only / partial assemblies as a standalone signal** — per-block correspondence
  replaces the need.
- **Stop chasing the absolute LLM-judge scalar as the optimization target** — judges are weak at absolute
  scoring; it's the obvious Goodhart attractor.
- **Stop running best-of-N at the page level** — per-section select → assemble is the only valid shape.
- **Stop investing in absolute desktop-pin layout except as one fallback candidate generator** — non-responsive.
- **Never rasterize.** It's the reward-hacking attractor the whole stack exists to resist.

---

## 6. Biggest risk + mitigation

**Risk — the reward gets Goodharted once the human leaves the loop.** The plan's entire value is removing
the human, which means no one is watching when best-of-N/RL learns to satisfy Block-Match/LLEM/CLIP/judge
while drifting from true perceived fidelity (right text in right boxes with right colors but wrong gestalt;
or a stable judge bias the loop exploits). Unmitigated, this silently reproduces the original SSIM-misrank
failure — now self-inflicted at compute scale: "improving the number while the product gets worse."

**Mitigation — a standing out-of-sample human-anchor audit as a hard CI gate**, fed without re-creating the
human bottleneck. Keep a rotating held-out set of human-scored pairs (extend the 18 blind-calibration
pairs). Every reward change *and* every K-th auto-fix cycle must reproduce the human ranking within
tolerance (**Spearman ρ ≥ threshold**) on **fresh, never-optimized-against** sites, or the loop halts and
flags. Bound the human cost by (a) collecting **pairwise/triplet** judgments (faster + more reliable than
absolute scores), (b) **active learning** — only adjudicate cases where deterministic-rank and LLM-rank
*disagree* (the informative samples), and (c) auditing a weekly **sample**, not every section. Human-time
now scales with reward-**drift**, not with throughput.

---

## 7. 90-day sequencing (small team)

- **Weeks 1–3 — WS1 + its falsifier gate.** Build `correspondence-reward.mjs` (re-capture clone via the
  existing `capture-layout` walk → Hungarian block-match → Block-Match F2 + per-axis LLEM + visual-block).
  Gate it on the ladders + injected-defect set: **LOO ρ ≥ 0.85**, broken hero ranked last, all existing
  falsifiers pass. This unblocks everything. Also: **score the 18 blind calibration pairs** (the
  human-anchor set the whole stack tethers to) and seed the adversarial cheat-example regression set.
- **Weeks 3–6 — WS3 + WS2 v1.** Wire correspondence in as Tier-1 of `bestofn-select` (frontier band → one
  listwise call). Build the self-heal pass (per-axis diagnosis → regenerate worst block → keep-if-improved,
  ≤2 rounds). Run on the corpus with the **full-page diverse authoring pipeline** (the queued generation
  effort) → the **first compute-bound improvement** (mean *and* minimum rise, zero human edits).
- **Weeks 6–9 — WS4 + the audit CI gate.** Stand up the CLIP sidecar (onnxruntime-node or pinned-python
  subprocess); add the judge rubric vector + tiny linear head for the absolute number; make the
  out-of-sample human-anchor audit a hard CI gate (pairwise/triplet + active-learning on disagreements).
- **Weeks 9–12 — WS5.** Capture + correspond at 3 viewports; emit native `_tablet`/`_mobile` controls
  (zero `@media` in `custom_css`); per-breakpoint correspondence grading. Kick off the multi-page epic.

**Assets we already have for this:** `capture-layout.mjs` (the source walk we re-run on the clone — WS1's
core dependency already exists), `section-bounds.mjs` (segmentation), `reward-vision`/`bestofn-select`/
`bestofn-clone` (the judge + selector + orchestrator), the degradation ladders + injected-defect game-tests
+ 18 blind calibration pairs (the human anchor + falsifier discipline).

---

## Provenance

- **Fusion panel** (`/fusion`, tag `design`): Opus + Sonnet + GPT-5.5 legs, Opus + GPT-5.5 judges →
  **CONVERGENT (high confidence)**; both judges independently preferred the same answer. (Gemini leg
  dropped; 3-leg ensemble.) The §3 reward architecture and §1 single-move are the panel's committed call.
- **Web research (2026):** Design2Code benchmark metrics
  ([emergentmind](https://www.emergentmind.com/topics/design2code-benchmark)); Perfect-Web-Clone
  architecture ([GitHub](https://github.com/ericshang98/perfect-web-clone)); Same.new approach
  ([Medium](https://medium.com/top-python-libraries/same-new-ai-powered-pixel-perfect-website-cloning-boon-or-nightmare-for-developers-39c311e73a4b));
  best-of-N / inference-time scaling ([arXiv 2512.19905](https://arxiv.org/abs/2512.19905)); ELHSR
  hidden-state reward ([arXiv 2505.12225](https://arxiv.org/pdf/2505.12225)); perceptual metrics LPIPS/CLIP
  ([DEV: screenshot diffing](https://dev.to/dennis-ddev/screenshot-diffing-pixel-level-comparison-techniques-18k)).
- **This session's evidence:** see journal 2026-06-19 + memory `bestofN_reward_is_bottleneck`,
  `grader_overstates_top_end`, `responsive_customcss_stripped`, `figma_source_projection_reframe`.
