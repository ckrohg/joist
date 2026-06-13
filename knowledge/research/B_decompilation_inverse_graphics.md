# Track B — Neural Decompilation + Inverse Graphics / Program Induction

@purpose Research synthesis: how decompilation/inverse-graphics fields solve the
"unconstrained input embodiment → constrained output vocabulary" problem, and what
transfers concretely to the Joist clone pipeline (arbitrary website → Elementor tree).

**Problem frame (keep central):** websites are built in infinitely many ways
(unconstrained input embodiment); we must reproduce the EXACT rendered result through
Elementor's rigid widget/container vocabulary (constrained output embodiment). We
cannot change the input. We DO control the "compiler" (Elementor's renderer).

Status: IN PROGRESS (incremental writes; commit after every 2-3 sections).

---

## 1. Neural decompilation (binary → C): the canonical DATA TRICK

### What the field does

**LLM4Decompile** (Tan et al., EMNLP 2024 — [paper](https://arxiv.org/pdf/2403.05286), [repo](https://github.com/albertan017/LLM4Decompile)) is the canonical open recipe:

- **Data trick = own the compiler.** Take a large source corpus, compile it yourself, and you get unlimited PERFECT (binary, source) pairs — no human labeling. They built ~4B tokens of (assembly, C) pairs; **Decompile-Bench** ([arXiv 2505.12668](https://arxiv.org/pdf/2505.12668)) industrialized this to **2 million binary-source function pairs** for training + 70K for eval.
- **Augmentation = vary the compiler knobs.** The SAME source compiled at -O0/-O1/-O2/-O3 yields different binaries → 4x data and an inverse model robust to "many surface forms, same meaning". (decompile-ghidra-100k: 25k pairs per optimization level.)
- **Models**: fine-tune existing code LLMs (DeepSeek-Coder etc.), 1.3B–33B, seq2seq cross-entropy. No exotic architecture — the dataset IS the contribution.
- **Two-stage refinement beats end-to-end**: V2 models don't decompile raw bytes; they **refine Ghidra's deterministic-but-ugly pseudo-code** into clean C (trained on 2B tokens for just this). 6.7B-V2 (52.7%) beats 6.7B-V1.5 (45.4%); 9B-V2 hits 64.9% re-executability. A cheap deterministic front-end + learned polisher outperforms learning the whole inverse.
- **SK²Decompile** ([arXiv 2509.22114](https://arxiv.org/pdf/2509.22114)) splits the inverse further: phase 1 recovers STRUCTURE ("skeleton" — control flow, types), phase 2 recovers NAMES ("skin" — identifiers). ~70% re-executability on HumanEval-Decompile. Decomposing the inverse problem into structure-then-appearance stages wins again.

### How they handle "many sources compile to the same binary"

They **don't try to recover THE source — they redefine success as observable equivalence**:

- **Re-executability** is the headline metric: decompiled code must compile (GCC -O2) and pass the original's test cases ([Context-Guided Decompilation, arXiv 2511.01763](https://arxiv.org/abs/2511.01763)). Token-level match with the original source is explicitly NOT the target; any source in the equivalence class that produces the same behavior scores 100%.
- Training on compiler-generated pairs teaches the model ONE canonical representative per equivalence class (the corpus's style). Non-injectivity becomes a non-problem: the model learns a *canonicalization*, not a bijection.
- **Agent4Decompile** ([arXiv 2604.23940](https://arxiv.org/html/2604.23940)) adds inference-time constraint-guided repair: syntax validation → compilation validation → execution validation against the original binary. I.e., even the trained-model camp ends with a **verifier loop** at inference.

### Concrete transfer to Joist

1. **We control the compiler (Elementor's renderer) — this is the exact precondition for the data trick.** Sample Elementor trees (or take every page we've ever built, every corpus page, every template kit), render them headlessly, and we have unlimited perfect (rendered-DOM/screenshot → Elementor JSON) pairs. Augmentation knob analog: render the SAME tree at multiple viewports, themes, kit-variable settings — like -O0..-O3, this teaches invariance to surface variation with zero extra labeling.
2. **Our grader already embodies the right success metric.** Re-executability ≡ "renders to the same pixels + stays editable". We never needed source-identity (the original site's HTML); we need a member of the equivalence class. The field validates the grader-as-objective stance.
3. **The Ghidra pattern is our capture-tree pattern.** Deterministic front-end (capture-tree extraction) + learned/LLM refiner beats end-to-end screenshot→JSON. Our pipeline shape (capture-tree → native widget tree → refine loop) is the V2 architecture; the missing piece is the trained/amortized *refiner* distilled from our own refine-loop traces.
4. **Skeleton-then-skin maps to structure-then-style.** Recover container/section geometry first, then typography/colors/spacing as a second pass — matches our existing layered build and SK²Decompile's measured win.


## 2. Inverse procedural modeling / analysis-by-synthesis

### CSGNet — render-feedback as REWARD (no ground-truth programs needed)

**CSGNet** (Sharma et al., CVPR 2018 — [arXiv 1712.08290](https://arxiv.org/pdf/1712.08290)): CNN+RNN parses a 2D/3D shape into a CSG program (boolean ops over primitives).

- Bootstrap phase: supervised training on SYNTHETIC (program → rendered shape) pairs — sample programs from the grammar, execute them, learn the inverse. Same data trick as decompilation.
- Adaptation phase: on REAL shapes (no ground-truth program exists), switch to **policy-gradient RL where the reward is render-similarity** (Chamfer distance between the predicted program's render and the input). The renderer-in-the-loop substitutes for labels.
- Inference: beam search + a post-hoc **visually-guided refinement** of primitive parameters against the target image.

### Ellis et al. — neurally-guided proposal + symbolic search, and errors CORRECTED by the program layer

**Learning to Infer Graphics Programs from Hand-Drawn Images** (Ellis, Ritchie, Solar-Lezama, Tenenbaum, NeurIPS 2018 — [arXiv 1707.09627](https://arxiv.org/pdf/1707.09627)): hand drawing → LaTeX/TikZ program.

- Two-stage: CNN proposes primitives (lines, circles, rectangles) one at a time, rendering each accepted primitive back onto the canvas and DIFFING against the input ("trace hypothesis") — then constraint-based program synthesis (Sketch) finds loops/symmetry structure over the primitives. 63% top-1 exact program match.
- KEY: the program-synthesis layer **corrects the neural net's perceptual errors** — a primitive that breaks an inferred symmetry/loop pattern is rejected as noise. Structure acts as a prior that denoises perception.

**Write, Execute, Assess** (Ellis et al., NeurIPS 2019 — [arXiv 1906.04604](https://arxiv.org/pdf/1906.04604)): equips synthesis with a REPL: every partial program is EXECUTED immediately; a learned policy proposes the next line and a learned **value function scores the executed partial state**; Sequential Monte Carlo over (write → execute → assess). Addresses the core pain that tiny syntax changes cause huge semantic changes — you only ever evaluate semantics (renders), never syntax.

### PLAD — the bootstrapping trick when ground-truth programs DON'T exist

**PLAD** (Jones et al., CVPR 2022 — [arXiv 2011.13045](https://arxiv.org/pdf/2011.13045), [page](https://rkjones4.github.io/plad.html)): the cleanest statement of how to train an inverse model when real inputs have NO program labels.

- Family of techniques: wake-sleep (sample programs from a generative model, execute, train inverse on those pairs) and **self-training with executed pseudo-labels**: run the current recognition model on REAL shapes → get predicted programs → **execute the predicted programs and pair each program with ITS OWN render** (not the original shape). The pair is now PERFECT by construction (label mismatch impossible); only the input distribution is approximate — and it converges toward the real distribution as the model improves.
- Iterate: infer → execute → fine-tune (MLE) → infer better… a virtuous cycle. No human labels at any point.

### ShapeCoder — abstraction discovery (learn the LIBRARY, not just the programs)

**ShapeCoder** (Jones et al., SIGGRAPH 2023 — [arXiv 2305.05661](https://arxiv.org/pdf/2305.05661)): given shapes as unstructured primitives, jointly discovers reusable abstraction FUNCTIONS (macros) and rewrites programs to use them (e-graphs + conditional rewrites). Programs become shorter and more semantic; the dictionary of abstractions is mined from the corpus, not hand-designed.

### SVG/vector inference from raster — code-generation framing won

- **Im2Vec / DeepSVG** (2020-21): latent-variable + RNN decoders into path space — superseded.
- **StarVector** (CVPR 2025 — [arXiv 2312.11556](https://arxiv.org/pdf/2312.11556), [repo](https://github.com/joanrod/star-vector)): treats vectorization as **code generation** — VLM emits SVG source directly; trained on **SVG-Stack, 2M (image, svg) pairs** (again: render-the-corpus data trick). DinoScore 0.966–0.982 vs Im2Vec's 0.692–0.754. Lesson: emitting the textual program with a code-LLM beats bespoke latent geometric decoders, BUT it works best on icons/logos/diagrams — bounded-complexity outputs.

### Concrete transfer to Joist

1. **PLAD self-training is OUR distillation recipe, formalized.** Every clone run already produces (real-site capture → Elementor tree) attempts. Render each produced tree and store (clone-render → tree) pairs — perfect-by-construction, regardless of clone fidelity. Fine-tune/few-shot-mine on those; the input distribution approaches "real websites" exactly as the pipeline improves. This is the cheapest path to an amortized model and needs ZERO new labeling infrastructure — the corpus-run already renders everything.
2. **Value-function-over-executed-partial-states ≈ grade sections as you build.** Write-Execute-Assess says: don't grade only finished pages; render and score PARTIAL trees (per-section) and use that to steer/prune. Our per-section refine loop is the SMC outer loop; what's missing is the cheap learned value function to rank candidate section-builds before full grading.
3. **Ellis's "structure corrects perception"**: fit a symmetry/repetition model over captured elements (grids, repeated cards, consistent gutters) and REJECT capture outliers that violate it — directly applicable to capture-noise (our biggest per-bp matcher pain). The grammar isn't just output vocabulary; it's a denoiser for the input.
4. **ShapeCoder → mine OUR corpus for macro-widgets**: recurring (hero, pricing-grid, logo-marquee, testimonial-row) subtrees should be auto-mined into parameterized templates; shorter programs = fewer degrees of freedom = fewer ways to be wrong, and more-editable output (semantic units map to what a human would edit).
5. **StarVector's boundary is a warning**: pure end-to-end image→code saturates at icon-level complexity. Full pages need the decomposed pipeline (capture-tree front-end, per-section synthesis) — which is what we already have.


## 3. GUI/web inverse rendering: pix2code → pix2struct → ScreenAI → Design2Code

### Lineage and what representation won

- **pix2code** (Beltramelli 2017 — [arXiv 1705.07962](https://arxiv.org/pdf/1705.07962)): CNN+LSTM emits a **DSL** (not raw HTML) per platform, then a deterministic compiler DSL→code. 1,750 synthetic pairs; ~77% token accuracy on toy GUIs. Note: even the 2017 origin point chose a CONSTRAINED intermediate vocabulary + deterministic compiler — the pix2code DSL is structurally an "Elementor JSON" move.
- **pix2struct** (Google 2022): pretrained on masked-webpage-screenshot → **simplified HTML** parsing; key contributions were a screenshot-parsing objective and variable-resolution ViT patching. Representation: simplified/normalized HTML, not full source.
- **ScreenAI** (Google 2024 — [arXiv 2402.04615](https://arxiv.org/pdf/2402.04615), [blog](https://research.google/blog/screenai-a-visual-language-model-for-ui-and-visually-situated-language-understanding/)): 5B VLM, SOTA on UI tasks. Pipeline: a **DETR-based layout annotator** auto-labels screenshots into a **textual UI schema** (element type ∈ {IMAGE, PICTOGRAM, BUTTON, TEXT…}, bbox, OCR text, description — [dataset](https://github.com/google-research-datasets/screen_annotation)); LLMs then generate task data at scale from those schemas. The load-bearing representation is a FLAT TYPED ELEMENT LIST WITH BBOXES — i.e., our capture-tree, not nested HTML.
- **WebSight** (HuggingFace 2024) / **WebCode2M** ([arXiv 2404.06369](https://arxiv.org/pdf/2404.06369)): 2M (HTML, screenshot) synthetic pairs — LLM writes HTML, renderer screenshots it, train the inverse VLM. The decompilation data trick, already replicated in the web domain.
- **Design2Code** (Stanford SALT 2024 — [arXiv 2403.03163](https://arxiv.org/pdf/2403.03163), [site](https://salt-nlp.github.io/Design2Code/)): benchmark of 484 REAL webpages. Metrics decompose like ours: block-match / text / position / color + CLIP. GPT-4V direct prompting: block-match 0.624, text 0.977, position 0.779, color 0.707, CLIP 0.892. Findings: (a) **element RECALL and LAYOUT are where everything fails** (text/color are nearly solved or fixable by fine-tuning); (b) text-augmented prompting (feed extracted text) helps; (c) **self-revision prompting — show the model its own render vs the target — helps**, validating render-feedback loops even for frontier VLMs.

### Concrete transfer to Joist

1. **Design2Code's failure decomposition matches ours exactly** — geometry/recall is the hard residual, text/color are easy. Their numbers justify our lever priority (layout engine, completeness/coverage) and our grader's dimension split. Also: their CLIP-only number (0.892) vs block-match (0.624) is the SAME overstatement gap our grader memory documents — high-level visual metrics flatter, element-level metrics tell the truth.
2. **ScreenAI's annotator-then-LLM cascade**: a small cheap specialized detector produces the typed-bbox schema; the expensive model consumes SCHEMA not pixels. Endorses investing in capture-tree quality over bigger vision models, and suggests a cheap fine-tuned detector for element-type classification (BUTTON vs TEXT vs PICTOGRAM) where our heuristics misfire.
3. **Nobody in this lineage outputs full real-world HTML/CSS** — every system that works emits a normalized/simplified vocabulary (DSL, simplified HTML, UI schema). Elementor JSON as output vocabulary is not a handicap; it is the field-standard move. The handicap would be trying to emit arbitrary CSS.
4. **Self-revision = our refine loop**, but theirs is single-shot whole-page. Per-section revision with measured diffs (what we do) is strictly finer-grained than the published SOTA loop.


## 4. Grammar/schema-constrained decoding — guaranteed-valid program emission

### State of the art

- **Mechanism**: intercept token logits each step; mask everything that cannot extend to a valid string of the target grammar/JSON-schema. Validity is guaranteed BY CONSTRUCTION, not by retry. Mature implementations: **Outlines** (FSM/regex pre-compiled masks), **XGrammar** (fast portable CFG engine, in vLLM/TensorRT-LLM), **llguidance** ([repo](https://github.com/guidance-ai/llguidance) — ~50µs/token on a 128k vocab; full CFGs, negligible startup). Structured generation has standardized on JSON Schema as the constraint language ([benchmark study, arXiv 2501.10868](https://arxiv.org/html/2501.10868v1)).
- **The caveat — distortion**: greedy token-masking warps the model's distribution: outputs are grammatical but can be LOW-PROBABILITY-given-the-constraint, i.e. degraded quality. **Grammar-Aligned Decoding / ASAp** (NeurIPS 2024 — [arXiv 2405.21047](https://arxiv.org/abs/2405.21047)) proves the fix needs *expected future grammaticality* weighting (approximating rejection sampling), at extra cost. Practical reading: constraints guarantee FORM, they do not guarantee the model picks the GOOD valid output — you still need a semantic verifier.
- **Correctness-guaranteed code generation** ([arXiv 2508.15866](https://arxiv.org/pdf/2508.15866)) pushes beyond syntax toward semantic constraints (types, scoping) in the decoder — the trend is richer static checks during emission.

### Concrete transfer to Joist

1. **We already have the grammar** — Elementor widget JSON schemas (`joist_get_widget_schema`, `joist_validate_widget`). Today validity is enforced POST-HOC (validate→repair). If/when we run a local fine-tuned emitter (the amortized model of §5), wiring schemas into XGrammar/llguidance gives zero-invalid-JSON for free and removes the whole repair-loop tax. With hosted Claude, the equivalent is JSON-schema structured output + post-hoc `joist_validate_widget` — which we already do; the field says that's the right API-world fallback.
2. **GAD's lesson generalizes**: schema-valid ≠ good. A constrained decoder happily emits a valid tree with wrong geometry. Form-validity (schema) and semantic-validity (render-grade) are different layers; never collapse them. Our split — validate_widget (form) then grade-structure/vision-judge (semantics) — is the architecture the field converged to.
3. **Cheap win available now**: express more INVARIANTS as schema (e.g. "absolute children require _element_custom_width", "container padding key is `padding`") so they're caught at emission/validation rather than discovered as render drift. Every render-truth memory entry that can be encoded as a schema constraint should be — it moves a semantic bug into the guaranteed-form layer.


## 5. Amortized inference vs per-instance search — when to TRAIN vs when to SEARCH

### What the field says

- **DreamCoder** (Ellis et al., PLDI 2021 — [arXiv 2006.08381](https://arxiv.org/pdf/2006.08381)): the canonical hybrid. Wake phase: solve real tasks by neurally-GUIDED search (not pure model emission). Sleep phase: (a) grow a LIBRARY by compressing discovered solutions into reusable components, (b) retrain the recognition model on "dreams" — programs sampled from the library, executed, paired with their outputs. Amortization and search are not rivals; search generates the training data that makes the next search cheaper. Follow-up ([arXiv 2306.07856](https://arxiv.org/abs/2306.07856)) even "decompiles" the trained policy back into library components.
- **Verifier-based test-time scaling is provably stronger**: "Scaling Test-Time Compute Without Verification or RL is Suboptimal" ([arXiv 2502.12118](https://arxiv.org/pdf/2502.12118)) — verifier-based algorithms scale with compute by Ω(√H) over any verifier-free (pure distillation/imitation) approach. With a RELIABLE verifier, search dominates asymptotically; distillation alone caps out.
- **Expert iteration** (AlphaZero pattern, echoed in test-time-compute literature — [survey](https://arxiv.org/html/2508.16665v3)): search+verifier produces expert traces → distill into the policy → policy makes search cheaper → repeat. Amortization is a RATCHET on search, not a replacement.
- **When amortization pays**: many tasks sharing structure (DreamCoder), or millions of free synthetic pairs because you own the compiler (LLM4Decompile, StarVector, WebSight). **When per-instance search pays**: few/heterogeneous instances, expensive instances, reliable verifier, or output complexity beyond the amortized model's ceiling (Design2Code: end-to-end whole-page emission fails exactly on layout).

### Verdict for Joist at our scale

Per-instance search-with-verifier (our loop) is RIGHT today: corpus is small (~6–20 sites), instances are heterogeneous, and our verifier (grader + LOOK + vision-judge) is the most-developed asset. The literature unanimously says: keep the verifier loop as the spine, and amortize INCREMENTALLY as a ratchet:

1. **Now (no training infra)**: distill refine-loop traces into retrieval/few-shot assets — per-archetype playbooks, fix-pattern libraries (this is DreamCoder's library-learning sleep phase done with files instead of gradients, and matches the existing "refine-loop+distill" memory).
2. **Now (data accumulation)**: start the PLAD/Decompile-Bench corpus — every built tree gets rendered and stored as a (render, tree) pair; plus pure synthetic sampling (generate Elementor trees from templates/library, render at 3 viewports). Costs ~nothing, compounds, and doubles as grader test material (render a tree, inject a known defect, you have ground-truth for injected-defect grader tests).
3. **Later (when pairs ≈ 10⁴–10⁵)**: fine-tune a section-level proposer (capture-tree slice → widget subtree) and a cheap value model (rank candidate sections before expensive grading). Constrained decoding (§4) applies at that point. The proposer's job is only to make the FIRST shot land closer — the verifier loop remains the correctness authority.

---

## Synthesis — the five transfers, ranked

1. **PLAD-style pair mining (start immediately, zero risk).** Render every tree we build; store (clone-render → tree) + synthetic (sampled-tree-render → tree) pairs. We own the compiler; this is the field's single most replicated trick (LLM4Decompile, WebSight/WebCode2M, SVG-Stack, CSGNet bootstrap, DreamCoder dreams).
2. **Equivalence-class success metric is already right.** Re-executability ≡ render-equivalence + editability. The field never recovers THE source; it canonicalizes. Stop worrying that many DOMs map to one Elementor tree — that's the solved part.
3. **Deterministic front-end + learned refiner + per-section verifier loop** is the convergent architecture (Ghidra→LLM4Decompile-V2; DETR-annotator→ScreenAI; primitives→Ellis's synthesis; our capture-tree→builder→refine). Invest in capture-tree quality and a value-function-like cheap ranker for partial builds, not in end-to-end vision models.
4. **Structure-as-denoiser (Ellis 2018)**: fit repetition/symmetry/grid models over captured elements and reject outliers BEFORE building — attacks capture-disagreement, the documented per-breakpoint ceiling cause.
5. **Schema-constrained emission + library mining are cheap compounding wins**: encode render-truths as schema invariants (form layer); ShapeCoder-style mine recurring section subtrees into parameterized macro-templates (shorter programs, fewer failure modes, better editability).

Status: COMPLETE (sections 1–5 + synthesis).
