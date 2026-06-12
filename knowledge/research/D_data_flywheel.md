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
---

## S3. The distribution-mismatch problem — random grammar samples ≠ realistic artifacts

**The trap:** uniform sampling from the output grammar (random widget trees, random colors/sizes)
produces a corpus whose distribution is nothing like real web pages; a model/exemplar library built on
it learns the grammar's quirks, not the web's. Decompilation hit this exact wall: grammar-generated C
(CSmith-style) trains parsers that fail on real binaries, which drove the field to compile REAL GitHub
code instead (S1).

Documented solutions (each maps to a Joist mechanism):
- **LLM-guided generation toward realism.** [WebSight](https://arxiv.org/abs/2403.09029) (HuggingFace,
  2M HTML↔screenshot pairs) did NOT sample HTML grammar randomly: an LLM first generated diverse
  *website concepts* (theme, business type), a second pass wrote Tailwind HTML for each concept, then
  headless rendering produced the screenshots. Realism comes from the LLM's prior over what real sites
  look like; the renderer guarantees label exactness. Surveyed broadly in
  [Synthetic Data Generation Using LLMs](https://arxiv.org/pdf/2503.14023).
- **Retrieval-anchored sampling (grounding).** Instead of free generation, condition each sample on a
  REAL artifact: take real layouts and re-express them in the output grammar. This is the
  general grounding recommendation in the LLM-synthetic-data literature ("dynamically ground generation
  via prompts on real instances", [Confident AI overview](https://www.confident-ai.com/blog/how-to-generate-synthetic-data-using-llms-part-1))
  and the de-facto winner in decompilation (compile real code). Strongest realism guarantee available.
- **Importance weighting / distribution matching.** When synthetic and real distributions still diverge:
  [Not All LLM-Generated Data Are Equal](https://arxiv.org/pdf/2410.21526) (2024) weights synthetic
  examples by alignment with the real distribution; [SynAlign / Few-shot distribution matching](https://arxiv.org/pdf/2502.08661)
  learns per-sample weights via Maximum Mean Discrepancy; [Real-Fake](https://arxiv.org/pdf/2310.10402)
  frames effective synthesis as explicit distribution matching. Weighting beats discarding.
- **Curriculum / stratification.** [Gretel synthetic_text_to_sql](https://huggingface.co/datasets/gretelai/synthetic_text_to_sql)
  stratifies by SQL complexity tier; [SQL-GEN](https://arxiv.org/html/2408.12733v1) seeds from
  tutorial-grade templates then escalates. Corpus difficulty tiers double as an eval ladder.

**Transfer to Joist:** the realism spectrum, strongest first:
1. **Retrieval-anchored (primary):** our capture corpus IS the real distribution. Every captured section
   (supabase/tailwind/linear/framer bands) gets re-expressed as a clean Elementor doc — by the agent,
   verified by the judge. Realistic by construction because the input was real.
2. **LLM-guided authoring (secondary, fills coverage holes):** WebSight's recipe verbatim — Claude
   generates section CONCEPTS ("SaaS pricing table, 3 tiers, annual toggle, dark"), then authors the
   Elementor doc, then we render. Use the S2 feature matrix to steer concepts into under-covered cells.
3. **Weighting (cheap insurance):** tag every exemplar with provenance (verified-clone > LLM-authored >
   grammar-swept) and retrieval-rank accordingly; archetype frequencies from the 20-archetype taxonomy
   (clone_pipeline_architecture) act as importance weights so the library matches the web's section mix.
4. **Curriculum:** tier exemplars by structural difficulty (single-column hero → 2-col split → card grid
   → overlapping/absolute compositions) — same ladder the refine-loop should climb when escalating.

---

## S4. Self-play / STaR-style bootstrapping — the judge is the verifier

**The pattern:** generate candidate solutions, keep ONLY those an automated verifier passes, fine-tune
(or build the exemplar library) on survivors, iterate. The model's own filtered outputs become its
training set; quality ratchets monotonically because the verifier gates entry.

Key evidence:
- **[STaR](https://openreview.net/pdf?id=_3ELRdg2sgI)** (Zelikman et al., NeurIPS 2022): few-shot
  generate → keep answers that check out → fine-tune → repeat. Iterations shift probability mass onto
  verified trajectories. **ReST-EM / Rejection-sampling FT** formalize the same loop at scale;
  **[V-STaR](https://openreview.net/pdf?id=stmqBSW2dV)** additionally trains a verifier on BOTH the kept
  and discarded samples — failures are signal too, not waste.
  **[STaR-SQL](https://aclanthology.org/2025.acl-long.1187.pdf)** (ACL 2025) shows it works where
  execution is the checker — directly our regime.
- **[UICoder](https://arxiv.org/abs/2406.07739)** (Apple, VL/HCC 2024) — the closest existing system to
  our flywheel: start from an LLM mediocre at SwiftUI; self-generate a large corpus of UI programs;
  filter with (a) the COMPILER (must build & render) and (b) a VISION model (CLIP relevance score);
  aggressively dedupe; fine-tune; repeat ~3 rounds. Result: compilation rate 0.82 (above GPT-4's 0.81)
  from a small open model, with NO human labels — automated compile+vision feedback was sufficient.
  ([Apple ML Research writeup](https://machinelearning.apple.com/research/uicoder))
- **[WebSight](https://arxiv.org/abs/2403.09029)/Sightseer:** the renderer-as-labeler variant — the pairs
  are perfect by construction, so the "verifier" is only needed for realism, not correctness.
- The loop's known failure mode: **diversity collapse** (model converges to easy templates that pass the
  verifier). Mitigations in the literature: dedupe (UICoder), balanced sampling across difficulty
  (B-STaR/AdaSTaR), and explicit coverage targets (our S2 matrix).

**Transfer to Joist — the verified-clone-section bootstrap, concretely:**
1. Every refine-loop already produces (source-section-render, Elementor-JSON, judge-verdict) triples.
   Add ONE step: when a section's judge score ≥ threshold (and editability gate ≥90% passes — the
   round-trip gate from PATH_TO_TRUE_1TO1), serialize the triple into the exemplar store. Zero new
   infrastructure; the flywheel is a side effect of work we already do.
2. UICoder's twin filter == our deterministic composite (compiles/renders/editable rails) + vision judge
   (looks right). We already have BOTH; UICoder proves the pair is sufficient signal without humans.
3. V-STaR's lesson: keep the FAILURES with their verdicts. A "what not to do + why the judge rejected
   it" negative library feeds the authoring prompts ("known failure: modalBg over-paint on split-bg
   sections") — this is how grader findings become reusable knowledge instead of session memory.
4. Anti-gaming note: STaR-style loops are only as honest as the verifier — grader hardening
   (grader_honesty_both_directions, GAME-TEST dims) is therefore not hygiene, it is the FLYWHEEL'S
   load-bearing wall. A gameable judge poisons the corpus permanently.
