# TRACK D — The Data Flywheel Design

@purpose Research synthesis: how fields build training/few-shot corpora by SAMPLING THE OUTPUT SPACE
(we control the renderer — Elementor), and what transfers concretely to the Joist clone flywheel.

**Problem frame (keep central):** websites are built in infinitely many ways (unconstrained input
embodiment); we must reproduce the EXACT rendered result through Elementor's rigid widget/container
vocabulary (constrained output embodiment). We cannot change the input. We CAN sample the output
grammar (author Elementor JSON, render it, get perfect (render, JSON) pairs for free).

Status: IN PROGRESS — sections appended incrementally (stall-proof protocol).

---

## S1. Neural decompilation & code translation — the compile-and-invert pattern

**The field's shape match:** decompilation has the SAME embodiment asymmetry inverted — unconstrained
input (arbitrary binaries from any compiler/flags) but the corpus is built by going the EASY direction:
you control the compiler, so you sample SOURCE, compile it, and learn the inverse map. Nobody hand-labels
(binary → source) pairs; every corpus is manufactured by running the forward (cheap, deterministic)
transform.

Key evidence:
- **Compile-and-invert at scale:** corpora are built by compiling large repositories of existing C
  uniformly (e.g. all of Debian's packages auto-built; GitHub C code compiled at multiple `-O` levels),
  yielding unlimited exact (asm, source) pairs. [Beyond the C / BTC, NDSS BAR 2022](https://www.ndss-symposium.org/wp-content/uploads/bar2022_23009_paper.pdf),
  [LLM4Decompile, EMNLP 2024](https://aclanthology.org/2024.emnlp-main.203.pdf).
- **Two corpus families:** (a) *synthetic generators* — sample programs from a restricted grammar
  (à la Katz et al. RNN decompilation, [SANER 2018](https://www.cs.unm.edu/~eschulte/data/katz-saner-2018-preprint.pdf)) —
  unlimited but unrealistic; (b) *real-source compilation* — compile real-world code (AnghaBench/ExeBench
  style, used by [SLaDe](https://arxiv.org/pdf/2305.12520) and LLM4Decompile) — realistic by construction.
  The field decisively moved to (b): grammar-sampled programs taught syntax but failed on real binaries
  (distribution mismatch — see S3).
- **Verifier-filtered self-training (the strongest transfer):** [TransCoder-ST](https://arxiv.org/pdf/2110.06773)
  (ICLR 2022) made unsupervised Java↔Python↔C++ translation work by generating candidate translations,
  running auto-generated unit tests (EvoSuite), and KEEPING ONLY translations that pass — the surviving
  pairs become the parallel fine-tuning corpus. +12.6% CA@1 absolute, ~25% relative over prior SOTA;
  the entire gain comes from *automated verification replacing human labels*.
  ([repo/docs](https://github.com/facebookresearch/CodeGen/blob/main/docs/TransCoder-ST.md))
- Recent LLM-era refinements add inference-time refinement loops on top of the fine-tuned base
  ([code-aware fine-tuning + refinement, OpenReview 2025](https://openreview.net/forum?id=m4MhSqtaPC)) —
  i.e. corpus-trained prior + per-instance verify-and-fix, exactly our author→grade→revise loop.

**Transfer to Joist:**
1. We own the renderer (WordPress+Elementor) the way decompilation owns the compiler. The forward map
   (Elementor JSON → rendered pixels) is cheap and deterministic → every authored document is a free,
   PERFECT training pair. There is no label noise in this direction, ever.
2. Like the field's (a)→(b) migration: do NOT only random-sample widget trees from the schema grammar.
   Prefer "compile real designs": take real captured layouts (our corpus) and re-express them as
   Elementor docs (the analog of compiling real GitHub code, not CSmith programs).
3. TransCoder-ST's filter = our grader/vision-judge. Candidate clone sections that pass the judge
   threshold are kept as (source-render, Elementor-JSON) pairs; failures are discarded or routed to a
   "hard cases" pool. This is the verified-clone-section bootstrap, with 4 years of evidence it works.

---

## S2. Text-to-SQL / semantic parsing — sample the output grammar, generate the input

**The field's shape match:** SQL/logical forms are a rigid constrained grammar (like Elementor's widget
vocabulary); natural-language questions are unconstrained (like arbitrary websites). The canonical move:
because you can ENUMERATE/SAMPLE the constrained side and EXECUTE it, you generate programs first and
manufacture the unconstrained side afterwards.

Key evidence:
- **OVERNIGHT (Wang, Berant & Liang, ACL 2015)** — the founding pattern: a synchronous grammar samples
  logical forms PAIRED with "canonical utterances" (stilted but understandable pseudo-language); crowd
  workers then paraphrase them into natural questions. A full-domain parser is built "overnight" with
  zero hand-annotated programs. ([paper](https://www.semanticscholar.org/paper/Building-a-Semantic-Parser-Overnight-Wang-Berant/25369f56a933e3bfb1d8e1588cdc6c50df93ecae))
  The 2026 version replaces the crowd with an LLM paraphraser.
- **Two directions, asymmetric quality** (surveyed in [Text2SQL-Flow](https://arxiv.org/pdf/2511.10192)
  and [SING-SQL](https://arxiv.org/abs/2509.25672)): *SQL-to-question* (sample query → generate NL) gives
  HIGH-FIDELITY pairs because the label is exact by construction; *question-to-SQL* (generate NL → infer
  SQL with a model) is more natural but suffers error propagation (the label itself may be wrong).
  Lesson: when you control the executable side, generate FROM it — labels stay perfect.
- **Coverage-engineered sampling:** [SING-SQL](https://arxiv.org/abs/2509.25672) (2025) auto-generates
  high-COVERAGE in-domain corpora for any target DB — it partitions the schema and systematically sweeps
  SQL feature combinations (joins, aggregations, window functions) so the corpus tiles the output grammar
  rather than clumping. [SQL-GEN](https://arxiv.org/html/2408.12733v1) does the same per SQL *dialect*
  with tutorial-derived templates. [Gretel synthetic_text_to_sql](https://huggingface.co/datasets/gretelai/synthetic_text_to_sql)
  (~100k pairs) stratifies explicitly by complexity tier — deliberate curriculum structure in the corpus.
- **Cycle-consistency filtering:** GAZP-style grounded adaptation and modern variants keep a synthetic
  pair only if a forward model maps the generated question back to a program that EXECUTES to the same
  result — execution is the verifier (same role as TransCoder-ST's unit tests).
- **Retrieval-side use of the same corpus:** [SAFE-SQL](https://arxiv.org/pdf/2502.11438) (2025)
  self-generates examples and selects fine-grained, similarity-filtered exemplars for in-context learning
  — no fine-tuning at all; the synthetic corpus's value is realized purely through retrieval (see S5).

**Transfer to Joist:**
1. Our "SQL" is the Elementor doc; our "execution" is the render. SQL-to-question == **doc-to-screenshot**:
   author Elementor JSON → render → the (render, JSON) pair is exact by construction. Never build corpus
   pairs in the question-to-SQL direction (screenshot → guessed JSON) without the judge verifying — that's
   the error-propagation trap.
2. SING-SQL's coverage sweep == a **widget×layout feature matrix**: enumerate (container direction ×
   column count × bg type × widget mix × spacing regime × breakpoint behavior) and author docs that tile
   the matrix, so the exemplar library has no holes where the transpiler will improvise.
3. OVERNIGHT's canonical-utterance trick has a direct analog: each authored doc gets a **canonical
   structural description** ("3-col card grid, dark bg, icon+h4+p per card, 64px section padding") —
   that string is the retrieval KEY linking a new captured section to its matched exemplars.
