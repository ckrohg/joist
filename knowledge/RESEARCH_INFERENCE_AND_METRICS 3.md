# Research: Layout-Inference Algorithms + Fidelity Metrics (2026-06-03 wave)

Source: deep-research wave (103 agents, 21 sources, 95 claims → 22 confirmed / 3 killed, adversarially verified). Routed to tracks. Full transcript: tasks/wqo2rshy3.output.

**One-line:** the field validates our grader's per-element design (we already match Design2Code) and hands us a citable, near-complete blueprint for the flow builder (LayoutCoder) — plus two concrete grader upgrades (CLIP-ViT high-level metric; reweight toward position+coverage, drop text).

---

## → T2 (flow / container-inference builder) — adopt these algorithms

**LayoutCoder is the blueprint** (Wu et al., arXiv 2506.10376, ISSTA 2025). Near-complete recipe, geometry-driven, emits RESPONSIVE flex (not absolute):
1. element detection → bboxes; 2. spatial relation graph of direct-neighbor edges; 3. **BFS group search** merging neighbors by **alignment (consistent left/edge orientation) + spacing (consistent distances)**; 4. **2D block projection** to find dividing lines; 5. **Gestalt recursive division — split at the LARGEST gap first**; 6. classify each node container(row/column) vs atomic. Each node → a div; siblings flex row/col with proportional **`flex:[portion]`**; **codegen FORBIDS fixed width/height and forces margin/padding = 0**.

> **KEY REDIRECT for flow v4:** our v2/v3 fight against hRatio by *pinning `min_height`* may be backwards. LayoutCoder's overflow+height fix is the opposite: **no fixed dims + zero margin/padding + `flex:[portion]` proportions**, letting natural content height (correct font sizes + captured gaps) drive. The inflation is almost certainly *synthesized chrome* (added padding/gap/min-height), not missing pins. Test in v4: strip fixed heights, zero synthesized padding, drive columns by `flex:[portion]` from captured width ratios.

Supporting citable algorithms (domain-agnostic over bbox geometry; we supply our own relatedness signal):
- **Felzenszwalb proximity-merge** (Shi et al., arXiv 2201.05194): edge weight = **largest of {Euclidean, horizontal, vertical} distance**; sort edges ascending, merge groups iff relatedness≥T AND inter-group dist ≤ min internal dist (I(G)=max MST edge + τ/area); anneal T×0.9, τ×1.1 per level up the hierarchy.
- **Allen-interval row/col** (Sánchez Ramón, IST 2016): decide row-vs-column from Allen relations on X/Y bbox projections; discover layout-manager TYPE by pattern-matching → **generate MULTIPLE candidates, rank, pick best** (validates a generate-and-rank builder over one-shot).
- **DCGen separation-line** (Wan et al., FSE 2025; repo WebPAI/DCGen): recursive screenshot division — mark a separation line where window pixel-variance < `var_thresh:50` AND brightness-diff vs rows above/below > `diff_thresh:45` over > `diff_portion:0.9` of row length, `window:50`. Directly implementable params.

Open for v4: how to compute `flex:[portion]` values that provably sum-to-100%/wrap without multi-column overflow at target width; and the geometric signature that should pick **CSS-grid** over nested flex (regular multi-row alignment + equal gaps + spanning).

**Caveat (verified):** NONE of these run on rendered-DOM bbox geometry exactly (Figma nodes / screenshots / Swing GUIs). Techniques transfer; validate on our capture-tree.

---

## → T4 (grader / perception) — SUPERVISED objective upgrade, research-grounded

**Our grader already IS the Design2Code suite** (Hungarian/linear-sum-assignment matching + CIEDE2000 color + position + text-Dice + area-coverage/block-match). Round 39/40 design independently matched the field's converged best practice — **validated.** Two upgrades:

1. **Add CLIP-ViT-B/32 cosine** (resize to square, mask text via Telea inpainting) as the **high-level** metric to *supplement/replace SSIM*. SSIM is hue/layout-blind; CLIP correlates with human "looks-the-same" (coef 0.4929, p=0.000). This is the single biggest perception upgrade.
2. **Reweight per-element by human correlation** (Design2Code Table 2, logistic regression on 435 human pairwise prefs, 79.9% acc, normalized coeffs):
   - **Position 0.7605** (strongest) · **Block-Match/coverage 0.7429** · CLIP 0.4929 · **Color 0.3461** · **Text −0.3541 (NEGATIVE, least significant)**.
   - → bump **position + coverage** weights up, **drop text** (it's a negative predictor — humans judge by layout/color/existence-of-content, not exact text), keep color moderate. Current per-element weights (color .35 / typo .25 / pos .20 / text .20) are *miscalibrated vs human judgment* — too little position, too much text.
3. **LPIPS** (Zhang et al., CVPR 2018, arXiv 1801.03924): add as a *cross-check monitor*, NOT a gated target — it's **adversarially gameable** (E-LPIPS, NeurIPS 2019: small-LPIPS-yet-different and large-LPIPS-yet-identical pairs exist), exactly the generator/grader-loop regime where a learned metric gets exploited. Never optimize against it blind.

> This is a 2nd objective change (like the round-40 flip) → it re-baselines the whole flywheel → **SUPERVISED, needs user green-light.** Build CLIP-ViT as a *shadow* metric first (additive, non-gating, like the round-39 per-element shadow), report it alongside, THEN propose the flip-to-include + reweight as the supervised step.

---

## → T5 (next research wave) — the unanswered Elementor-2026 ceiling

The research wave got **zero verified claims** on Q3 (Elementor flex/grid/nested-container/global-classes 2026 caps). Critical open question that **de-risks T2 directly**:
- **Do Elementor grid / flex / nested containers survive the kses sanitization + `Document::save()` round-trip** the way absolute-positioning settings were verified to? (The flow builder ASSUMES yes — partly checked in the container-inference investigation, not independently confirmed against docs.)
- flex-`[portion]`/basis overflow-avoidance algorithm; flex-vs-CSS-grid decision rule from geometry; which Elementor container features are underused for fidelity.
- Research against Elementor docs/changelogs + our internal [[v4_atomic_normalizations]] / [[elementor_authoring_artifacts]].

---

## Refuted (do NOT repeat)
- Design2Code overall score is **NOT** an equal-weight 0.2-each average of its 5 components (killed 0-3) — reported separately.
- Do **NOT** cite DCGen's "85.34% elements omitted" motivating stat (killed 1-2) — cite the algorithm, not that number.
- Do **NOT** frame Sánchez Ramón as a clean two-phase geometry→graph→tree pipeline (killed 1-2) — architecture real, tidy framing overreached.

Related: [[clone_pipeline_architecture]] · CONTAINER_INFERENCE_SPEC.md · WP_SANDBOX_FARM_SPEC.md · RESEARCH_FINDINGS.md (prior wave)
