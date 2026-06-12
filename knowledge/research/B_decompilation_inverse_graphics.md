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

