# EMBODIMENT APPROACH — clone-to-Elementor as cross-embodiment program induction

@purpose The decisive synthesis of the four embodiment research tracks (knowledge/research/A–D)
into one architecture doctrine: what the clone pipeline IS (cross-embodiment program induction),
the five structural moves that follow, what changes vs today's plan (PATH_TO_TRUE_1TO1 §8c–8d),
and the sequenced, falsifier-gated plan. Read this BEFORE proposing pipeline architecture changes.

Date: 2026-06-12. Inputs: A_robotics_lessons.md, B_decompilation_inverse_graphics.md,
C_domain_gap_projection.md, D_data_flywheel.md; diffed against PATH_TO_TRUE_1TO1.md §8c–8d and
RESEARCH_STEALS_2026H1.md. Citations: (A §n) (B §n) (C §n) (D Sn) = the research files; external
papers named where load-bearing.

---

## 1. THE REFRAME

**Clone-to-Elementor is cross-embodiment program induction.** Websites are built in infinitely
many ways — arbitrary DOM, frameworks, canvas, CSS tricks. That is an unconstrained INPUT
embodiment we cannot change. Elementor's widget/container vocabulary + kses + schema is a
constrained OUTPUT embodiment we fully control. The task is not translation of mechanism; it is
inducing a program in the target's vocabulary whose *rendered outcome* matches the source's.

Three findings, each independently replicated across fields, pin the frame:

1. **The rendered outcome is the only task space.** Robotics spent 2020–2026 learning that when
   embodiments differ in DOF, *similarity of mechanism is the wrong objective*: kinematic
   retargeting (map human joints → robot joints) is "under-constrained"; what wins is an outcome
   invariant — force closure, object pose change — with mechanism similarity demoted to a
   tiebreaker (A §1: GenHand, Human2Sim2Robot). Our force closure = per-band pixel/box/text
   equivalence at each viewport. Widget-tree or DOM similarity is never a fidelity signal; at
   most it is an *editability* tiebreaker.

2. **Never imitate the source's mechanism (DOM structure).** DOM→widget tag-mapping heuristics
   are kinematic retargeting and fail the same way: plausible structure, broken outcome (A §1).
   Decompilation reached the same verdict from the other side: nobody recovers THE source; success
   is redefined as *observable equivalence* (re-executability — B §1: LLM4Decompile, SK²Decompile).
   Many DOMs map to one Elementor tree — that is the solved part, not a problem. We learn a
   canonicalization, not a bijection.

3. **Perception parses the source into the TARGET ontology.** Every GUI-inverse system that works
   emits a normalized constrained vocabulary, never real-world HTML/CSS: pix2code's DSL,
   pix2struct's simplified HTML, ScreenAI's typed-bbox schema (B §3). Elementor JSON as output
   vocabulary is the field-standard move, not a handicap. The perceptual front-end's job is
   therefore not "describe the DOM" but "describe the page in terms Elementor can say": containers,
   grids, gaps, typography presets, backgrounds — plus an explicit residual for what Elementor
   cannot say (C §2, §6).

One asymmetry makes this tractable where robotics suffers: **we own the compiler.** The forward
map (Elementor JSON → rendered pixels) is cheap, deterministic, and exact. Robotics pays heavily
for *approximate* outcome prediction and still wins with it (A §6); decompilation built its entire
corpus by running the forward direction (B §1, D S1). Every move below exploits this asymmetry.

The output embodiment's own feasibility constraint — **editability** — stays inside the objective,
exactly as LEGO "buildability" is a hard verifier pass, never folded into the visual score
(C §2.2). A raster clone that round-trips perfectly visually while destroying editability is the
error-cancellation trap the MT field documented (C §4.2.1); the deterministic rails exist to veto it.

---

## 2. THE FIVE STRUCTURAL MOVES

### (a) The Elementor CAPABILITY ATLAS — the DOF spec

You cannot plan into a body you haven't characterized. Every mature constrained-vocabulary field
maintains its expressible set as an **explicit, versioned, machine-checked artifact**: wpt.fyi
measures browser capability with executable tests run daily; caniuse is a machine-readable
versioned support matrix; every MIDI device ships an implementation chart (Transmit vs Recognize
columns); STE is a versioned dictionary with checker software (C §5.1, §2.4).

The atlas (full design in C §5.2):

- **Taxonomy from the corpus, not spec-reading**: frequency histogram of visual/layout constructs
  over our own captures = the prioritized feature list.
- **Per feature × expression strategy, an executable PROBE** (strategies in editability order:
  native setting → widget composition → custom CSS → HTML widget → region raster).
- **Two verdict columns, MIDI-style**: AUTHOR (survives Document::save() + kses + V4
  normalization byte-stably) and RENDER (frontend matches ground truth; PASS / DEGRADED-with-
  measured-Δ / FAIL).
- **Versioned per environment** (Elementor version, theme, plugins, kit hash); re-probed on
  update — the atlas doubles as a regression suite.
- **Probe-on-miss** for the long tail: first unknown construct triggers a live probe, caches the
  verdict.

This replaces our *assumed* atlases (V3 widget reference, expressive-ceiling study, WIDGET_PACK
truths) with probes that cannot rot — the docs-rot disease this branch exists to fix (C §5.2.6).
The atlas is the load-bearing input to moves (c) and (d): the authoring contract is defined BY it,
and the residual policy decides AGAINST it.

### (b) SAMPLE-RENDER-INVERT corpus + visual-pattern-keyed EXEMPLAR LIBRARY

We control the compiler — the exact precondition for the field's single most replicated data
trick (B §1: LLM4Decompile's 4B tokens, Decompile-Bench's 2M pairs; B §3: WebSight/WebCode2M's 2M
HTML↔screenshot pairs; B §2: CSGNet bootstrap, PLAD; D S1). Author Elementor JSON → render → a
PERFECT (render, JSON) pair, free, with zero label noise, forever. Augmentation = vary the
compiler knobs: same tree at multiple viewports/themes/kit settings, the analog of -O0..-O3
(B §1). This is also robotics' teleop lesson: pairs collected in the target's own action space
are the only zero-embodiment-gap data (A §3).

Three corpus inlets, by realism (D S3, S6.2):
1. **Verified-clone bootstrap** (primary, free): judge-passed sections from real runs — realistic
   by construction (the input was real).
2. **LLM-authored matrix sweep** (coverage): enumerate the widget×layout feature matrix
   (SING-SQL's coverage sweep, D S2) and author docs into under-covered cells (WebSight's
   concept→code recipe, D S3).
3. **Re-expression of real captures** the cloner hasn't conquered (compile-real-code analog).
Never build pairs in the screenshot→guessed-JSON direction without the judge verifying — that is
the error-propagation trap (D S2).

**Retrieval replaces fine-tuning at our scale.** Many-shot ICL beats LoRA fine-tuning;
DAIL-SQL hit #1 on Spider with pure in-context learning; Voyager compounds a verified skill
library with zero weight updates (D S5). So the corpus is delivered as an **exemplar library**:
each record = (source render at 3 viewports, verified Elementor JSON fragment, OVERNIGHT-style
canonical description, DAIL-style structural skeleton, feature tags, provenance, judge scores,
difficulty tier) — full schema in D S6.1. Retrieval is dual-keyed (visual descriptor of the
source section AND skeleton of a draft plan), with coverage-set completion so every feature tag
in the target has an exemplar in context (D S5). Library coverage matters more than selector
sophistication — optimize the selector LAST (D S5: long-context ICL result).

### (c) CONSTRAINED AUTHORING — the contract is the atlas

VLA models never emit free-form motor text: the action decoder is structurally constrained to the
target's action space (256-bin tokens — the model *cannot* express an infeasible action; A §5).
Grammar-constrained decoding gives the same guarantee for program emission: validity by
construction, not by retry (B §4: Outlines/XGrammar/llguidance). And FAST proved the compression
of the action space is itself a first-class lever — a well-chosen coarse op vocabulary beats a
smarter model emitting raw output (A §5).

The move: **the authoring contract = atlas-expressible constructs only.**

- The vision-author may only emit constructs whose atlas cells read PASS (or DEGRADED within the
  saliency threshold — see (d)). An STE-style **conformance linter** checks authored output
  against the atlas before transpile (C §2.4: HyperSTE/Acrolinx pattern; the DesignMD
  lint-rules steal is the same move).
- **Transpile becomes total by construction**: every lint-clean construct has a known native
  mapping. Today's transpiler hardening is reactive whack-a-mole against a pain list
  (PATH_TO_TRUE_1TO1 §8c); under the contract, a transpiler gap is by definition an atlas/lint
  bug, found at authoring time, not as render drift.
- Form-validity ≠ semantic-validity: the constrained layer guarantees the tree is *expressible*,
  never that it is *right* (B §4: GAD's lesson). The judge remains the semantic authority.
- Every render-truth we own ("container padding key is `padding`", "absolute children require
  `_element_custom_width`") gets encoded as a schema/lint invariant — moving semantic bugs into
  the guaranteed-form layer (B §4.3).

### (d) PROJECTION + RESIDUAL POLICY — escalation decided by measured projection error

Every lossy-projection field converged on the same four moves (C §2): make the expressible set
explicit (the atlas); project by minimizing PERCEPTUAL error, not symbol error (DiffVG/LIVE);
give the residual a principled channel, never silently drop it (pandoc RawBlock, MIDI pitch
bend/MPE); allocate the output budget greedily where residual error is largest (LIVE's layer-wise
greedy addition).

The policy (full design in C §6):
1. **Channel ladder** by editability cost: native setting → widget composition → Elementor
   custom CSS → HTML widget → region raster. Raster is legitimate — the sin is silent or
   unbudgeted use.
2. **Decision rule = measured projection error**: for feature F in region R, take the FIRST
   channel whose atlas-predicted render error ≤ threshold(R). Thresholds are saliency-weighted —
   logos/headings/CTAs strict, decorative texture loose — which directly answers the
   grader-overstates-top-end finding (C §6.2, §2.2).
3. **Standardized residual** (the MPE lesson): allowed-property whitelist + structured per-widget
   storage, machine-parseable, round-trip-surviving — not free-form CSS blobs (C §6.3). The
   residual is a first-class node in the IR, visible to grader/refine/round-trip (pandoc, C §3.1).
4. **Error conservation** (Floyd–Steinberg): carry quantization residuals (spacing) down the page
   in a running vertical-error accumulator so whole-page alignment holds (C §2.5, §6.4).
5. **Budget + RESIDUAL LEDGER**: per-page channel budgets enforced by the build; every escalation
   logged with predicted/measured error. The ledger is the anti-gaming counterweight, the ranked
   defect attribution, and the empirical native-coverage roadmap (C §6.5).
6. **Demake boundary**: simplification (e.g. 1-col stacking) is permitted ONLY when the atlas
   proves inexpressibility at that viewport, and is always ledgered (C §3.3).

This subsumes §8b PIVOT 2: region-raster completeness stops being a blanket "guarantee" and
becomes the ladder's last rung — principled, budgeted, ledgered.

### (e) SEE-FIX AS MPC + VERIFIED-SECTION BOOTSTRAP — the compounding flywheel

Robotics' converged architecture is MPC: sample candidate action sequences, predict outcomes,
execute only the first action, observe, replan (A §6). Our "world model" is EXACT — render the
candidate headless and look — so we should be *more* MPC-like than robots, not less:

- **k candidates per section, render all, keep the best** (counterfactual comparison is cheap
  when the simulator is truth), judged candidate-vs-incumbent PAIRWISE (absolute visual judges
  are noisy — RESEARCH_STEALS #3: UI2Code^N RVPO).
- **Re-capture actual page state between ops** — never refine against the stale plan (A §6; the
  shared-scratch-page lesson, memory: clone_validation_pitfalls).
- **Score executed partial states**, not just finished pages (B §2: Write-Execute-Assess); later,
  a cheap learned value function pre-filters candidates before paying for full render+grade.

Then close the loop: **judge-passed sections enter the exemplar library.** This is STaR /
TransCoder-ST / UICoder, with four years of evidence that an automated verifier substitutes for
human labels (D S1, S4 — UICoder: compile+vision filtering alone beat GPT-4's compilation rate
from a small open model). Keep failures WITH verdicts as a negative library (V-STaR: failures are
signal); dedupe by structural skeleton to prevent diversity collapse; re-validate the library
whenever the grader gains a dimension (D S6.4). Verifier-based test-time scaling provably
dominates verifier-free imitation (B §5: Ω(√H) separation) — the loop is the spine; the library
is the ratchet that makes each search cheaper (DreamCoder's wake/sleep, B §5).

Two non-negotiables inherited from the evidence: **judge hardening precedes corpus growth** — a
gamed judge poisons the library permanently (D S4; A §6: MPC with a biased reward model
confidently does the wrong thing). And the eval-integrity protocol (§8d: hash-bound scores,
separation of duties, write post-conditions) is therefore not bureaucracy — it is the flywheel's
load-bearing wall.

---

## 3. WHAT CHANGES vs today (diff against PATH_TO_TRUE_1TO1 §8c–8d)

### Survives intact

- **The HTML-first spike result (§8c).** Vision-author → deterministic transpile (+37–40 on all
  four tiles vs DOM transplant) is exactly the field-standard shape: amortized proposer +
  deterministic compiler, nondeterminism confined to a constrained IR (B §3: the pix2code-DSL
  lineage; RESEARCH_STEALS #1: Builder.io's model→compiler split). The vehicle stays. What changes
  is what grounds the contract — see below.
- **The vision judge as headline objective (§8b PIVOT 1).** It IS the perceptual task-space
  metric every projection field optimizes (C §2.1: perceptual loss, never symbol loss), with
  pairwise candidate-vs-incumbent judging per RESEARCH_STEALS #3. The deterministic composite
  stays demoted to rails/vetoes — required, because round-trip visual checks error-cancel on
  rasters (C §4.2.1).
- **Capture machinery + E′ tri-viewport correspondence (§8a, falsifier-locked).** The capture
  tree is our embodiment-agnostic intermediate representation (A §2) — the interface contract
  everything upstream compiles into. E′ is task-space recovery of the *generating layout system*,
  the responsive analog of outcome-space planning. Nothing here is throwaway.
- **The eval-integrity protocol (§8d).** Re-grounded as the flywheel's load-bearing wall (move e),
  it gets MORE binding, not less.
- **Elementor-idioms mandate (§8d):** header/footer as Theme Builder site parts, kit-as-design-
  system, repeated blocks as patterns — all are "author in the target's ontology" before the
  ontology was named.

### Gets RE-GROUNDED

- **The authoring IR: from free HTML to Elementor-ontology-constrained.** This is the single
  biggest change. Today the vision-author writes free HTML/CSS under a heuristic contract
  (flex-first, ≤4 nesting, computed values — §8c) and transpile.mjs is hardened reactively
  against a pain list. Re-grounded: the contract is *derived from the atlas* — the author may
  only say what Elementor can express (the surface syntax may stay HTML-shaped, but every
  construct must map to a PASS atlas cell), checked by the conformance linter at authoring time,
  making transpile total by construction (move c). Transpiler gaps flip from render-drift
  surprises to lint-time atlas lookups.
- **The see-fix loop: from sequential patcher to MPC.** k candidates per section, pairwise keep,
  re-capture between ops (move e). The loop shape, not the loop's existence, changes.
- **Region-raster (§8b PIVOT 2): from blanket guarantee to ladder rung.** Same capability, now
  entered only via measured projection error, budgeted, and ledgered (move d).
- **The knowledge base: from assumed prose to probe-backed cells.** The expressive-ceiling study,
  V3 widget reference, and WIDGET_PACK truths become atlas probes; prose survives as commentary
  on measured cells (move a; C §5.2.6).
- **Refine-loop distillation: from session memory to exemplar records.** "Refine-loop+distill is
  the canonical scalable lever" (memory) gets its mechanism: verified sections → library inserts
  with dual retrieval keys (moves b+e).

### DIES

- **DOM-structure mapping as a fidelity mechanism.** Tag-mapping heuristics are kinematic
  retargeting (A §1). The DOM is read as capture *evidence* only; it is never the plan. (The
  heuristic HTML-blob builder was already retired; this kills the residue.)
- **Free-form HTML as a durable IR.** Authoring constructs the transpiler may not cover — the
  whole partial-transpile failure class — becomes unrepresentable, not debugged.
- **Silent fallbacks.** Un-ledgered rasters, un-ledgered 1-col demakes, silent feature drops: the
  residual policy makes every loss explicit, budgeted, and attributable (C §3.3, §6).
- **One-shot whole-page builds + sequential patching** as the default loop shape.
- **Hand-crafted per-defect grader dims as the objective** — already dead per §8b; the
  Design2Code/CITL evidence (B §3; RESEARCH_STEALS #3) confirms the burial.
- **Worrying about non-injectivity.** "Many DOMs → one tree" is the solved part of the problem
  (B §1): we canonicalize; we never needed the source's HTML.

---

## 4. SEQUENCED PLAN — falsifier-gated, WP-free until the sandbox phase

Cadence rule inherited from PATH_TO_TRUE_1TO1: quality-gated, not calendar-gated; sizes are
estimates. Phases P1–P3 need ZERO WordPress (they run on existing captures, existing run
artifacts, and pure-node tooling). WP enters at P4.

| Phase | What | Size | Falsifier (refute-by-default) | User-visible artifact |
|---|---|---|---|---|
| **P1 — Atlas v0 (WP-free half)** | Feature-frequency histogram over existing corpus captures → taxonomy head; atlas.json schema (feature × strategy × {AUTHOR, RENDER} × environment); pre-fill cells from measured-truth memories with `provenance: assumed-pending-probe` | 2–3 d | Taxonomy head (~top 50 constructs) must cover ≥95% of captured section features across the 6-site corpus; if the long tail dominates, the eager-head + probe-on-miss design re-scopes | `knowledge/atlas/atlas.json` + coverage stats table |
| **P2 — Authoring contract v2 + conformance linter** | Contract = atlas-expressible constructs only; pure-node linter over vision-author HTML output; transpile TOTALITY check (enumerate: every lint-clean construct has a transpile rule, assert no gaps) | 2–3 d | Re-run the clerk-hero spike's authored output through the linter: if lint-CLEAN output still hits a transpiler gap, the atlas↔transpiler mapping is incomplete — fix before P3 | Lint report on the spike pages + the totality matrix |
| **P3 — Exemplar library v0 + retrieval** | D S6.1 record schema; backfill from existing judge-passed sections (renders already on disk); dual-key retrieval (canonical-desc + skeleton) wired into the authoring prompt, 5–30 exemplars | 3–4 d | A/B author 3 held-out sections with vs without exemplars, judged pairwise: exemplars must win ≥2/3. If not, the KEYS are wrong — re-key before adding volume (D S5: coverage > selector) | The exemplar store + the A/B verdict table |
| **P4 — MPC see-fix loop** (sandbox entry) | k=3 candidates/section, pairwise judge keep, re-capture between ops, residual-ledger entries on every channel escalation | ~1 wk | MPC loop must beat the sequential single-candidate loop on identical sections within the SAME render budget; deterministic gates as pre-filters throughout | A corpus-page clone with its trajectory + residual ledger |
| **P5 — Atlas probe suite (WP)** | Execute AUTHOR/RENDER columns (save-survival + frontend-vs-ground-truth probes); system-ID calibration table (C §1.1: probe page, computed-style diff); residual-policy thresholds wired to measured cells; real2sim CSS-bundle import for the local preview (C §1.2) | ~1 wk | Sample 10 known render-drift bugs from memory: ≥8 must be probe-detectable. An atlas whose RENDER column can't predict observed failures is decoration | Atlas dashboard (PASS/DEGRADED/FAIL counts) + update-triggered regression run |
| **P6 — Flywheel close** | Verified-section bootstrap DEFAULT-ON (judge ≥ threshold AND editability gate → library insert); negative library (V-STaR); skeleton dedupe; library re-validation hook on grader upgrades | ~1 wk, then continuous | Corpus mean must improve across 2 successive full corpus runs while the library grows; flat = retrieval isn't transferring (audit coverage/keys, not the concept) | Library growth + corpus-mean trend chart |

Standing gates across all phases: eval-integrity protocol (§8d) on every score; deterministic
rails/vetoes never bypassed; round-trip ≥90% editability gate unchanged; judge hardening precedes
any library growth (D S4).

### Immediate next 3 actions

1. **Build the feature-frequency histogram** over existing corpus captures (computed styles are
   already extracted) → the taxonomy head that seeds atlas.json. Pure node, hours, WP-free.
2. **Write the atlas.json schema and backfill assumed cells** from the measured-truth memories
   (container `padding` key, `_element_custom_width`, kses survivals, V4 normalizations…), each
   marked `assumed-pending-probe`; emit the conformance-linter rule list FROM the schema so P2
   starts grounded.
3. **Define the exemplar record schema (D S6.1) + backfill script** over existing run artifacts —
   every judge-passed section with renders on disk becomes a library record with canonical-desc +
   skeleton keys.

