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

