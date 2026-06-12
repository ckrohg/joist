# EMBODIMENT APPROACH — clone-to-Elementor as cross-embodiment program induction

@purpose The decisive synthesis of the four embodiment research tracks (knowledge/research/A–D)
into one architecture doctrine: what the clone pipeline IS (cross-embodiment program induction),
the five structural moves that follow, what changes vs today's plan (PATH_TO_TRUE_1TO1 §8c–8d),
and the sequenced, falsifier-gated plan. Read this BEFORE proposing pipeline architecture changes.

Date: 2026-06-12. Revised same day: the critic's 7 mustFixes + 3 notes (verdict preserved at
bottom) are applied in-body — phase gates hardened, citations corrected, sequencing reconciled.
Inputs: A_robotics_lessons.md, B_decompilation_inverse_graphics.md,
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
1. **Verified-clone bootstrap** (primary, free, but STARVATION-PRONE at birth: under honest
   calibration and the ≥90% round-trip gate, today's pass set is TENS of records, not hundreds —
   inventory before sizing; and NEVER admit exemplars verified by the old inflated grader without
   re-scoring — D S6.4's re-validation rule applies at birth, not only on upgrades): judge-passed
   sections from real runs — realistic by construction (the input was real).
2. **LLM-authored matrix sweep** (coverage): enumerate the widget×layout feature matrix
   (SING-SQL's coverage sweep, D S2) and author docs into under-covered cells (WebSight's
   concept→code recipe, D S3).
3. **Re-expression of real captures** the cloner hasn't conquered (compile-real-code analog).
Never build pairs in the screenshot→guessed-JSON direction without the judge verifying — that is
the error-propagation trap (D S2).

**Retrieval replaces fine-tuning at our scale.** Many-shot ICL beats LoRA fine-tuning — a result
the source qualifies as *on classification tasks* (D S5); the generation-side evidence is
DAIL-SQL's #1 on Spider with pure in-context learning, on a grammar far smaller than Elementor's,
plus Voyager compounding a verified skill library with zero weight updates (D S5). Scaling that
to our grammar is a bet the P3 falsifier exists to test, not a settled result. So the corpus is delivered as an **exemplar library**:
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
construction, not by retry (B §4: Outlines/XGrammar/llguidance). And FAST showed the compression
of the action space is itself a first-class lever — its coarse op vocabulary *matched* π₀ at 5×
less training and beat naive binning (A §5); it did not beat a smarter model emitting raw output.
The lever is efficiency and feasibility-by-construction, not supremacy over a better proposer.

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

**Sequencing vs the locked §8b order and the E′ mandate (user, 2026-06-10):** P1–P3 are the
ACTIVE track precisely because they are the WP-free work that fits the current site pause — they
do not displace the mandated sequence. E′ tri-viewport correspondence and V2 region-raster
completeness STAY promoted exactly as mandated; their *implementation* folds into P4+ when the
sandbox exists, because both need real renders to land (E′'s regrouping verification and V2's
raster fills are render-side by nature). Under PATH §4's 2-track cap: track 1 = P1–P3 (now),
track 2 = E′/V2 (resumes at sandbox entry), converging at P4.

| Phase | What | Size | Falsifier (refute-by-default) | User-visible artifact |
|---|---|---|---|---|
| **P1 — Atlas v0 (WP-free half)** | **Pre-register the construct unit (§4.1) BEFORE computing anything**, then: feature-frequency histogram over existing corpus captures → taxonomy head; atlas.json schema (feature × strategy × {AUTHOR, RENDER} × environment); pre-fill cells from measured-truth memories with `provenance: assumed-pending-probe` | 2–3 d | Taxonomy head = **top 50** under the PRE-REGISTERED construct unit, covering ≥95% of captured section features across the 6-site corpus. (Reconciled vs C §5.2's "~top 100": 50 is the day-0 head — a 6-site corpus cannot statistically distinguish 100 distinct heads; ~100 is the eventual probe-SUITE size after probe-on-miss accretion.) Coarsening the unit after seeing counts VOIDS the gate. If the long tail dominates, the eager-head + probe-on-miss design re-scopes | `eval/grader/atlas/atlas.json` + histogram + coverage stats table |
| **P2 — Authoring contract v2 + conformance linter** | Contract = atlas-expressible constructs only; pure-node linter over vision-author HTML output; transpile TOTALITY check (enumerate: every lint-clean construct has a transpile rule, assert no gaps) | 2–3 d | DUAL gate, both required: **(a)** ≥90% of the PROVEN clerk-hero spike output lint-clean AS-AUTHORED — a stricter linter makes "no gaps" vacuously true while strangling the author, so strictness itself is gated; **(b)** one section re-authored under the atlas-constrained contract HOLDS the spike's tile scores (72/82/78/72) within judge noise — GAD's constraint-distortion lesson (B §4) applied to our own biggest move: if the constraint regresses authoring quality vs the +37–40 proven win, fix the contract, not the author. Plus the original: lint-CLEAN output that still hits a transpiler gap = incomplete atlas↔transpiler mapping — fix before P3 | Lint report on the spike pages + the totality matrix + re-authored-section tile comparison |
| **P3 — Exemplar library v0 + retrieval** | D S6.1 record schema; backfill from existing judge-passed sections (day-0 inventory FIRST — expect TENS of records, not hundreds; NEVER admit exemplars verified by the old inflated grader without re-scoring under the current judge); dual-key retrieval (canonical-desc + skeleton) wired into the authoring prompt | 3–4 d | A/B author **≥10** held-out sections with vs without exemplars, judged PAIRWISE with randomized left/right tile order, judge run under §8d separation-of-duties (judge ≠ implementer): exemplars must win **≥8/10** (the old 2-of-3 bar passed a coin flip ~50% of the time — statistically vacuous). Render path is explicitly WP-FREE: authored HTML rendered in LOCAL CHROMIUM, judged PRE-transpile — no WP silently re-enters the phase. If the bar fails, the KEYS are wrong — re-key before adding volume (D S5: coverage > selector) | The exemplar store + the A/B verdict table |
| **P4 — MPC see-fix loop** (sandbox entry) | FIRST: real2sim CSS-bundle local preview (C §1.2) pulled FORWARD from P5 — candidate fan-out renders against the cheap LOCAL preview; the live WP render is paid ONLY for the kept candidate ("render is cheap, deterministic, free" is true vs robotics, FALSE vs one shared WP instance with PUT serialization). Then: k=3 candidates/section, pairwise judge keep, re-capture between ops, residual-ledger entries on every channel escalation | ~1.5 wk (re-sized: +preview import) | MPC loop must beat the sequential single-candidate loop on identical sections within the SAME LIVE-RENDER budget; deterministic gates as pre-filters throughout | A corpus-page clone with its trajectory + residual ledger + preview-vs-live agreement check |
| **P5 — Atlas probe suite (WP)** | Execute AUTHOR/RENDER columns (save-survival + frontend-vs-ground-truth probes); system-ID calibration table (C §1.1: probe page, computed-style diff); residual-policy thresholds wired to measured cells; preview-vs-live calibration of the real2sim bundle (the import itself moved forward to P4) | ~1 wk | 10 known render-drift bugs, list PRE-REGISTERED with the orchestrator BEFORE probe authoring (the implementing agent cannot select them): ≥8 must be probe-detectable. An atlas whose RENDER column can't predict observed failures is decoration | Atlas dashboard (PASS/DEGRADED/FAIL counts) + update-triggered regression run |
| **P6 — Flywheel close** | Verified-section bootstrap DEFAULT-ON (judge ≥ threshold AND editability gate → library insert); negative library (V-STaR); skeleton dedupe; library re-validation hook on grader upgrades | ~1 wk, then continuous | Metric = the VISION-JUDGE / human-estimate HEADLINE, never the demoted deterministic composite (measuring the flywheel on the rails metric would be metric-worship recidivism): headline must improve across 2 successive full corpus runs by MORE than the documented ±0.08 single-run visual-noise band, with §8d evidence bundles (hash-bound scores, separation of duties) on BOTH runs; flat-within-noise = retrieval isn't transferring (audit coverage/keys, not the concept) | Library growth + headline trend chart with noise band |

Standing gates across all phases: eval-integrity protocol (§8d) on every score; deterministic
rails/vetoes never bypassed; round-trip ≥90% editability gate unchanged; judge hardening precedes
any library growth (D S4). **Separation-of-duties extends to phase gates**: the orchestrator
re-executes at least one falsifier per phase by direct re-run — never by reading the implementing
agent's report — and pre-registered lists (P1 construct unit, P5 bug list) are held by the
orchestrator, not the implementer; the theater channel §8d closed for page scores must not reopen
one level up. The motion/interaction hard requirement (user, 2026-06-05) is explicitly ORTHOGONAL
to P1–P6: PATH track D continues unchanged — it is not silently dropped.

### 4.1 P1 pre-registration — the construct unit (LOCKED 2026-06-12, before histogram computation)

Registered and committed BEFORE any frequency counting (per mustFix 3). The P1 coverage gate is
evaluated under THIS unit; coarsening or re-keying after seeing counts VOIDS the gate.

**Unit of counting.** One construct occurrence = one capture-tree node (or manifest section band)
at one captured viewport that matches a construct key. The countable population = every visible
node (box.w × box.h > 0, inside captured page height) in the persisted capture trees
(`/tmp/abs-cache/*/layout.json` — 7 sites; `/tmp/local-fidelity/cap` manifest + style-facts —
clerk). Visual-only artifacts (vj tile sets, qa-stepback bands) are spot-validation EVIDENCE,
never counted — no double counting.

**Construct identity = a key-triple:**

1. **Structural signature** (closed enum, from `layout.display`/`flexDirection`/`gridCols`/
   `position`): `flex-row` | `flex-col` | `grid-2col` | `grid-3col` | `grid-4pluscol` |
   `absolute-overlay` (positioned children over a base) | `inline-flow` | `sticky-fixed-chrome` |
   `split-2col` (two ~half-width siblings, text+media) | `block-stack`.
2. **Content-class multiset**, presence-bucketed {0, 1, many}, classes from the closed list:
   `heading`, `body-text`, `inline-styled-rich-text` (mixed paint/weight inside one block),
   `button-cta`, `nav-links`, `image`, `background-image`, `icon-svg`, `logo` (image/svg in brand
   role), `code-mockup`, `form-control`, `video-embed`, `badge-pill`, `stat-number`, `list`,
   `divider`.
3. **Property classes** (enums, never raw values): bg ∈ {none, flat, gradient, image};
   border-or-shadow ∈ {yes, no}; radius-class ∈ {square, rounded, pill-circle}; dynamic-behavior
   ∈ {static, marquee, carousel, accordion, tabs, modal, sticky}.

**Granularity rules (anti-gaming, binding):**

- Value-level differences NEVER split a construct: exact colors, px gaps, font sizes, copy,
  child counts beyond the {1, many} bucket.
- Property-CLASS differences ALWAYS split: grid-3col vs flex-row, gradient vs flat bg, marquee
  vs static row.
- Named constructs (nav-row, hero-stack, logo-band, card-grid, footer-columns, code-panel,
  marquee, accordion, form, modal, sticky-chrome, bg-image-section, inline-styled-text, …) are
  ALIASES for specific key-triples, declared in `eval/grader/atlas/atlas.json` beside the cells.
  New aliases may be added during P1; the triple definition may not change.
- Counting is per occurrence per viewport-capture; nested constructs count at each level (one
  card-grid with 6 cards = 1 card-grid + 6 card occurrences), each node exactly once.
- The ≥95% coverage gate denominator = all countable occurrences as defined above; the numerator
  = occurrences whose key-triple is in the top-50 head.

### Immediate next 3 actions

1. **Pre-register the construct unit (§4.1), THEN build the feature-frequency histogram** over
   existing corpus captures (computed styles are already extracted) → the taxonomy head that
   seeds atlas.json. Pure node, hours, WP-free. Registration precedes computation — the coverage
   gate is void otherwise.
2. **Write the atlas.json schema and backfill assumed cells** from the measured-truth memories
   (container `padding` key, `_element_custom_width`, kses survivals, V4 normalizations…), each
   marked `assumed-pending-probe`; emit the conformance-linter rule list FROM the schema so P2
   starts grounded.
3. **Define the exemplar record schema (D S6.1) + backfill script** over existing run artifacts —
   every judge-passed section with renders on disk becomes a library record with canonical-desc +
   skeleton keys.

---

## Critic verdict 2026-06-12: **pass-with-notes**

Adversarial review, default-skeptical, against: the four research files at HEAD, PATH_TO_TRUE_1TO1
§8a–8d, RESEARCH_STEALS_2026H1, and the repo state (969bc1c == working tree, verified). ~14
citations spot-checked against A–D; 12 faithful, 2 inflated (mustFix 7), 1 fair-but-noted
simplification. The doctrine (outcome-space objective, own-the-compiler corpus, constrained
authoring, residual ledger, MPC loop) is genuinely grounded and consistent with the arc's proven
results — judge-as-headline kept, HTML-first vehicle kept, E′ capture kept, §8d inherited and
strengthened, DIES list matches what was already retired. What fails review is not the
architecture but several phase gates that are confirmable-by-construction as written, one
sequencing conflict with a user mandate, and two evidentiary overhangs.

### mustFix (blocking before P1 kickoff)

1. **P3's falsifier is statistically vacuous.** 3 held-out sections with a ≥2/3 win bar has a
   ~50% pass probability under the null (coin flip). Fix: ≥10 sections, ≥8/10 pairwise wins,
   randomized left/right tile order, judge run under §8d separation-of-duties. Also state the
   WP-free render path explicitly (authored HTML in local chromium, judged pre-transpile) — as
   written, judging authored output is the step that silently re-introduces WP into a "WP-free"
   phase.
2. **P2's falsifier passes-by-construction via linter strictness.** A linter that rejects most
   constructs makes "lint-clean output hits no transpiler gap" vacuously true while strangling
   the author. Dual gate required: (a) ≥90% of the PROVEN clerk-hero spike output lint-clean
   as-authored, AND (b) one section re-authored under the atlas-constrained contract holds the
   spike's tile scores (~72/82/78/72 minus judge noise). The doc cites GAD's
   constraint-distortion lesson (B §4) but never applies it to its own biggest move — the
   atlas-constrained contract could regress the arc's single largest proven win (+37–40) and no
   gate currently measures that.
3. **P1's head-coverage gate is gameable by taxonomy granularity.** Define the construct unit
   (property × value-class list) and pre-register it BEFORE computing the histogram, else
   "top-50 covers ≥95%" is satisfiable by coarsening definitions. Also reconcile P1's "~top 50"
   with C §5.2's "~top 100" probe head.
4. **Reconcile with the locked §8b sequence and the user-mandated E′ promotion (2026-06-10).**
   The P1–P6 table never mentions V2 region-raster or E′, which the user promoted to
   "immediately after V1/V2". State explicitly whether P1–P3 run beside E′ under PATH §4's
   2-track cap or re-sequence it. Silently displacing a user mandate is how this plan dies in
   its first contact with review.
5. **P6's metric is undefined and noise-blind.** "Corpus mean" must bind to the vision-judge /
   human-estimate headline (the deterministic composite is rails-only per §8b — measuring the
   flywheel on the demoted metric would be metric-worship recidivism), with §8d evidence bundles
   on both runs and a noise-aware improvement threshold (±0.08 single-run visual noise is
   documented; two runs of a noisy scalar is weak evidence in either direction).
6. **P4 (MPC) is scheduled before the cheap renderer exists.** real2sim CSS-bundle preview
   (C §1.2) lands in P5, yet P4's k=3 candidates/section × re-capture between ops runs on ONE
   shared live WP instance with PUT serialization. Pull the local-preview import forward into
   P4, or re-size P4 honestly. "Render is cheap, deterministic, free forever" is true relative
   to robotics, false relative to SiteGround.
7. **Two citation inflations to correct (they underwrite moves b and c).** (i) D S5's
   many-shot-ICL result is qualified "on classification" in the source; the generation-side
   evidence is DAIL-SQL — on a grammar far smaller than Elementor's. (ii) FAST *matched* π₀ at
   5× less training (and beat naive binning); it did not show a coarse vocabulary "beats a
   smarter model emitting raw output." Keep both moves; fix the evidentiary overhang so the doc
   doesn't claim more than its sources.

### Notes (sharpest first)

- **Flywheel bootstrap starvation.** Inlet 1 (verified-clone bootstrap, "primary, free")
  requires judge ≥ threshold AND the ≥90% round-trip gate. Under honest calibration (user's
  tailwind verdict ≤~50) and the round-trip indictment (text-editor/button panel edits inert),
  today's pass set may be near-empty — and repo recon shows run artifacts scattered across
  per-experiment `out-*` dirs with no per-section grade store. Do a day-0 inventory before
  sizing P3; expect tens of records, not hundreds; and never admit exemplars verified by the
  OLD inflated grader without re-scoring (D S6.4's re-validation rule applies at birth, not
  only on upgrades).
- **The theater channel moved up a level, it didn't close.** The falsifier discipline is real,
  but P1–P3 verdict artifacts (coverage table, totality matrix, A/B verdicts) are self-produced
  by the implementing agent — exactly the channel §8d closed for page scores. Extend
  separation-of-duties to phase gates: orchestrator re-executes one falsifier per phase by
  direct re-run, not by reading the report.
- **Grounding verdict with a caveat about the layer below.** The synthesis is faithful to A–D;
  but A–D themselves are the unverified layer (external papers not re-checked under this
  critique's constraints). Treat the research files as testimony, not ground truth, whenever a
  move gets expensive — e.g. "never real-world HTML/CSS" (B §3) is already a simplification
  (Design2Code/WebSight systems do emit HTML; the doc's own HTML-shaped-surface caveat absorbs
  it, barely).
- Smaller: the motion/interaction hard requirement (user 2026-06-05) has zero slots in P1–P6 —
  declare it explicitly orthogonal (PATH track D unchanged) or it reads as silently dropped.
  Atlas scope should eventually cover Theme Builder site-part constructs (§8d idioms), not only
  page-content widgets. P5's retro-validation falsifier (≥8/10 known drift bugs
  probe-detectable) is the best-designed gate in the table — pre-register the 10-bug list with
  the orchestrator so the implementing agent can't select them.

**Net:** the reframe earns its place as doctrine; the plan ships after the seven fixes. The
anti-detour protections (WP-free P1–P3, probe-on-miss, 2–4 day sizes) are adequate ON PAPER —
they hold only if the phase gates above are made refute-by-default in fact, not just in label.

