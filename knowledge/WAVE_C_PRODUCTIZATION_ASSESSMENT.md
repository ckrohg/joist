# Wave C — Productization Assessment (honest step-back, 2026-06-08)

@purpose Strategic step-back after the grader-honesty correction. Answers: is the clone good enough to
productize, and what's actually in the way? Grounded in Wave A (grader-trust audit) + a wiring inspection.

## The capability is real (Wave A, on a now-trustworthy grader)

The deterministic capture→native-tree pipeline genuinely works on its **sweet spot — standard marketing/SaaS
landing pages**: supabase **0.844**, notion **0.822** (both *editable AND faithful*, verified by LOOKING).
Weaker on inherently-hard archetypes: code-heavy docs (tailwind 0.622, reactdev 0.716) and motion/image-heavy
(framer 0.702) — there the editable-vs-faithful tradeoff is intrinsic and we (correctly) rasterize to look right.

## The blocker is not fidelity — it's WIRING (the disconnect)

There are THREE clone paths and they are **not connected**:
1. **`eval/grader/` pipeline** (build-hybrid.mjs, clone.mjs, grade-structure.mjs) — deterministic DOM capture →
   native Elementor widget tree → the honest grader. **This is what the whole session improved.** It is a
   RESEARCH HARNESS — not referenced by the skill or plugin.
2. **`CloneGenerator` / `joist_clone_url` MCP tool** (plugin) — the PRODUCT's single-pass clone: screenshots →
   Claude **vision** → a V3 plan ("cheap-substitute clone path", per its own @purpose).
3. **`joist-clone` skill** — the PRODUCT's iterative clone: a **vision** generator/grader loop (self-described
   plateau ~78–90%), grading via Claude vision, NOT grade-structure.

So the measured 0.84 editable pipeline is **not what users run**. The product runs vision (paths 2 & 3), which
guesses widgets from screenshots — generally LESS faithful for round-trip editability than path 1's DOM-derived
native tree. The memory note "BIG gap: product wiring into Joist agent" is exactly this.

## The decision this teen surfaces

The deterministic pipeline (path 1) appears to be the intended NEXT-GEN clone path (per clone_rearchitecture:
"faithful capture-tree → native widget tree"), just never wired into the product surface. Two honest options:

- **A — Wire path 1 into the product.** Make `joist_clone_url` (or a new MCP tool) call the proven
  capture→build-hybrid→(optional grade) pipeline, with auto-scoping (detect site archetype, route, set
  expectations). Users get 0.84 editable clones on the sweet spot instead of the vision loop's plateau. This is
  the high-value build — and the real "productization." Substantial (Node pipeline must run server-side or via
  the agent harness; reconcile the two grading approaches).
- **B — Accept vision as the product; treat eval/grader as research that informs the vision prompt.** Lower
  effort, but leaves the better (deterministic, editable) capability on the bench.

## Honest capability statement (for either path, today)

"Clones standard marketing/SaaS landing pages to ~85% fidelity with real, editable Elementor widgets. Code-heavy
docs and motion/image-heavy sites are partially rasterized (faithful look, less editable). Not a pixel-perfect
or animation-faithful tool."

## Recommendation

**Option A is the real productization** and the natural payoff of all the pipeline work — but it's a dedicated
build, and after the grader-gaming episode it should be done LOOK-first with the trustworthy grader as the gate.
Before committing, the ONE thing to verify: can the Node capture→build pipeline run in the product's runtime
(server-side / agent harness), or does productizing mean porting its logic? That answer sizes the whole effort.

## Wave status
- A (grader-trust audit): DONE — grader trustworthy, scores track human judgment.
- B (editability-QUALITY): assessed — real win = sub-section hybrid reconstruction; deferred as a dedicated
  LOOK-first effort (diminishing returns vs the wiring gap).
- C (this): the gating issue is WIRING the proven pipeline into the product, not more fidelity. User decides A vs B.
