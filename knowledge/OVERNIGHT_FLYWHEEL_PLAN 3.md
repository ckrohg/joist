# Overnight Flywheel Plan — run end-to-end, never idle, until 1:1 across all metrics

**This is an executable runbook, not a description.** Any session (this one, or a fresh one spawned by the
heartbeat cron) drives the flywheel by following the **Driver Protocol** below against the durable state in
`eval/grader/overnight-state.json`. The loop stops ONLY at the 30-hour deadline. If the known curriculum is
finished before the deadline, the loop MUST keep going — discovering and closing metrics not yet enumerated
(Phase 5). Do not stop for input. Do not ask questions. Keep the flywheel spinning toward 1:1 + editable.

North star (verbatim): *clone ANY site into a round-trip-editable Elementor/WordPress page, perfectly 1:1, by
grading its own work and autonomously improving until everything is right end-to-end, no human, getting better
across all surfaces.*

---

## 0. Hard constraints / safety rails (NON-NEGOTIABLE — apply every round)

1. **Never fake-grade.** Every code change must pass the grader self-test BEFORE it is corpus-gated:
   `node grade-sections.mjs --source https://resend.com --selftest` must print **PASS / composite 1.0 /
   atTarget true**. The engine, not just the coder agent, verifies this. A change that breaks the self-test is
   auto-restored. For grader-extension rounds (Phase 2 / Phase 5) the self-test=1.0 requirement is the PRIMARY
   anti-gaming rail: a new detector that counts asymmetrically (source ≠ clone for identical input) drops the
   self-test below 1.0 and is rejected.
2. **Corpus-gate every keep** via the noise-hardened gate (`evolve.workflow.js`): re-clone+grade each site K=2×
   (median) before AND after; KEEP iff (corpus mean rises OR structural-fidelity rises) AND no per-site
   regression beyond `clamp(measured-noise, 0.025, 0.06)`. Else **auto-restore** all backed-up files.
3. **Back up before every change; restore on reject.** `cp` the file(s) to `/tmp/ev-bk-*` first.
4. **Redaction.** `JOIST_AUTH_B64` lives only in `/tmp/joist-auth.env` (sourced by agents). NEVER print it.
5. **Durable audit trail.** Every round appends to `recipe-library.json` (the recipe) AND
   `overnight-state.json` (metricsHistory) AND a journal entry (best-effort; manifest is the source of truth).
6. **One heavy round at a time.** Never run two capture/build/grade workflows concurrently — they share the
   corpus page IDs and would corrupt each other AND pollute the noise measurement. Read-only analysis may run
   in parallel.
7. **Commit only when the user asks.** This loop does NOT git-commit. It leaves a clean working tree + recipes.
8. **Edit scope per phase:** Phase-1 rounds edit ONLY `capture-layout.mjs` / `build-absolute.mjs`. Phase-2/5
   rounds additionally edit `grade-sections.mjs` (detector/dimension) and MUST re-validate self-test=1.0.

---

## 1. Time budget

- `startedEpoch` and `deadlineEpoch` (= started + 30h) are in `overnight-state.json`.
- **Every driver tick FIRST runs `date +%s`** and compares to `deadlineEpoch`.
  - `now >= deadlineEpoch` → **STOP**: write the final report into `overnight-state.json.finalReport`, delete
    the heartbeat cron (CronList → CronDelete), journal a wrap-up, and END. Do not launch more rounds.
  - `now < deadlineEpoch` → continue the protocol.

---

## 2. Durable state — `eval/grader/overnight-state.json`

The single source of truth. Schema (the driver reads + rewrites it each tick):
- `startedEpoch`, `deadlineEpoch`, `deadlineHuman`, `budgetHours`.
- `phase` (1..5) + `phaseName`.
- `corpus`: the 4 sites (name/url/page).
- `currentRound`: `{ n, engine, target, taskId, status: pending|running|done }`.
- `lastVerdict`: the most recent round's verdict string.
- `plateauStreak`: consecutive non-keep rounds in the current phase (drives phase advance).
- `metricsHistory[]`: one entry per finished round `{ n, ts, phase, engine, target, verdict, kept, mean,
  struct, perSite }` — the time series that proves we are climbing.
- `phase2queue[]`: blind-block priority order (card-grid first).
- `phase5backlog[]`: new metric dimensions discovered by Phase 5 (each becomes a grader-ext round).
- `enginesBuilt`: which JIT engines exist yet (`evolve-grader-ext`, `discovery`).
- `lastUpdatedEpoch`.

---

## 3. Driver Protocol (idempotent — run on EVERY trigger: workflow-completion notification OR heartbeat cron)

1. `date +%s` → if `>= deadlineEpoch`, do the STOP sequence (§1) and END.
2. Read `overnight-state.json`.
3. **Reconcile the in-flight round.** If `currentRound.taskId` is set and `currentRound.status==='running'`:
   - `TaskOutput(taskId, block:false)`. If still `running` → **do nothing this tick** (let it finish; the
     completion notification will re-trigger). END the tick.
   - If `completed`/`failed` → go to step 4 (record it).
4. **Record the finished round** (if not already recorded — check `metricsHistory` for `currentRound.n`):
   - Parse the workflow result `{verdict, recipe}`. Append a `recipe-library.json` entry (round number =
     `currentRound.n`). Append a `metricsHistory` entry. Update `lastVerdict`. Journal (best-effort).
   - Update `plateauStreak`: if `recipe.kept` → reset to 0; else → increment.
5. **Decide the next round** (see §4 phase logic). Determine `engine`, `target`, and the Workflow to launch.
   - If the chosen engine file does not exist yet, BUILD it first (§5 specs), then proceed.
6. **Launch** the next round: `Workflow({scriptPath/ name, args})`. Immediately set `currentRound = { n: n+1,
   engine, target, taskId: <returned id>, status:'running' }` and write `overnight-state.json`. (Setting this
   before the next trigger prevents a double-launch.)
7. END the tick. (The completion notification or the next heartbeat resumes at step 1.)

**Concurrency guard:** never launch in step 6 if a round is already `running` (step 3 catches this). The
heartbeat and the completion-notification are both idempotent against `currentRound`.

---

## 4. Phase logic (what the next round is)

**Phase 1 — Exhaust the current objective.** Engine: `evolve.workflow.js` (auto-targets the top structural
miss, then top defect class). Launch it with no args each round. Advance to Phase 2 when `plateauStreak >= 2`
(two consecutive non-keeps → the current grader can no longer drive gains). Reset `plateauStreak=0` on advance.

**Phase 2 — Expand structural breadth (blind blocks).** Engine: `evolve-grader-ext.workflow.js` (build it JIT
per §5.1 if absent). Each round: pop the next block from `phase2queue` (card-grid FIRST — it teaches
`flatten()` to keep role-tagged containers, unblocking stat-row/logo-wall/testimonial/pricing/gallery). Pass
`args={block}`. The engine adds the detector to `grade-sections.mjs` + capture + build, re-validates
self-test=1.0, then corpus-gates. After every 3 Phase-2 rounds, run ONE Phase-1 pass (a new detector can
surface new buildable misses). Advance to Phase 3 when `phase2queue` is empty OR `plateauStreak >= 3`.

**Phase 3 — Synthetic bench (clean signal).** Build `bench/` synthetic minimal pages (one per block) per §5.2,
then run evolve/grader-ext against the bench corpus for any block whose real-corpus signal was weak/noisy
(video, table, form on sites that lack them). This catches the long tail real sites under-reward. Advance when
the bench blocks all pass their gate.

**Phase 4 — Interactive + motion.** Wire Tier-3 interaction-function grading (does the tab switch / accordion
open / form submit-validate) and Tier-4 motion (the 8 existing motion slices + GSAP escape-hatch + the motion
knowledge docs). Capture DETECTS animation; builder APPLIES it (Elementor motion effects or scoped GSAP);
grader scores reproduction+function (DOM/Playwright assertions, not frame-matching). Advance when the motion
slices integrate cleanly + grader scores motion presence.

**Phase 5 — Open-ended discovery (metrics not yet enumerated). NEVER-IDLE TAIL.** Build
`discovery.workflow.js` (§5.3). It runs a multi-lens completeness critic over the corpus (color accuracy,
typography/font-family rendering, spacing rhythm, border-radius/shadow/gradient fidelity, z-order/overlap,
hover/focus states, responsive breakpoints @ 3 viewports, accessibility, load performance, exact-position
drift, image fidelity / rebuild-honesty). Each lens proposes a NEW symmetric grader dimension + a capture/build
fix. The top-ranked new dimension is enqueued to `phase5backlog` and run as a grader-ext-style round (add
dimension → self-test=1.0 → build to satisfy it → corpus-gate). **This phase loops until the deadline.** If the
corpus mean is already high, raise the bar: add harder real sources (e.g. stripe.com, linear.app, a
framer/3D-heavy page) to the corpus and/or tighten thresholds, then keep discovering. The point is to keep
getting closer to true 1:1 across dimensions we have not thought of yet.

---

## 4b. Idea-exhaustion ESCALATION LADDER (external research is now a standing tier of the flywheel)

The flywheel must never silently die at a plateau. When the loop runs out of ideas, it ESCALATES — internal
first (cheap), external last (expensive). Three tiers:

- **Tier 1 — directed-fix:** drain the ranked backlog (`directed-fix.workflow.js`, corpus-gated). Normal operation.
- **Tier 2 — internal discovery:** when the backlog is empty, run `discovery.workflow.js` (lens-critic over OUR
  corpus) → fresh backlog → Tier 1. Cheap/fast, but BOUNDED by what is observable in our own pipeline.
- **Tier 3 — EXTERNAL RESEARCH RE-FUEL:** reaches OUTWARD (WebSearch/WebFetch) for the ecosystem's solved
  knowledge, GROUNDED in the current frontier (`research-refuel.workflow.js`). Fires on TWO triggers now:
  (a) DEEP plateau (`plateauStreak >= 6`, OR a discovery wave fully rejected, OR directedFixBacklog EXHAUSTED); AND
  (b) **CADENCE (USER 2026-06-04): every `researchEvery` (=3) rounds, regardless of plateau** — external knowledge
  folded in aggressively, not only when stuck. **DRIVER RULE at pick-next-round (step 4):** if
  `roundsSinceResearch >= researchEvery` → next round = research-refuel (refresh its FRONTIER const from the current
  open walls + kept/rejected scorecard FIRST), then set `roundsSinceResearch = 0`; else pick a normal cloner/grader
  round and `roundsSinceResearch += 1`. Research is read-only (no cloner edits) so it may overlap a build round, but
  default is one heavy round at a time. Fold its output: `autonomousSafe[]` → `directedFixBacklog` (gated rounds),
  `supervised[]` → `supervisedQueue`, `topInsight` → journal.

**Tier-3 trigger + protocol (the driver runs this when a deep plateau is detected):**
1. Update `research-refuel.workflow.js`'s `FRONTIER` const from the manifest: the OPEN walls + the kept/rejected
   scorecard (so it targets the frontier and NEVER re-researches solved walls — this is what keeps it cheap+useful).
2. Launch it (read-only on cloner code → safe to run PARALLEL to a Tier-1 round; web-heavy, no capture contention).
3. It returns a ranked backlog `[{rank, change, file, wall, autonomousSafe, expectedImpact}]` + writes
   `knowledge/RESEARCH_FINDINGS.md`.
4. **The driver records it into the manifest, then SPLITS by `autonomousSafe`:**
   - `autonomousSafe:true` (pure measurement / capture-only / additive build the corpus-gate can keep) →
     appended to `directedFixBacklog`; the loop resumes Tier 1 draining them (gate still decides each).
   - `autonomousSafe:false` (grader-objective change, core-build rewrite, plugin security, big architecture) →
     appended to `supervisedQueue` — NEVER auto-applied; surfaced for the user. The autonomous loop does not
     rewrite its own objective or core build output blind.
5. If a research wave returns ONLY supervised items (autonomous frontier truly exhausted) → the loop keeps
   running Tier-2 discovery + corpus-broadening (a 7th/8th harder vertical) so it never idles, and parks the
   supervised items for the next supervised session.

**Cadence guard:** Tier-3 is EXPENSIVE (~250-500k tokens/wave) and over-predicts (autonomous-safe items still
get gated; the wave-1 hit-rate was ~33%). So fire it only on a genuine deep plateau, never on every empty
backlog (Tier 2 handles those), and always seed it with the tried/rejected scorecard so each wave attacks the
frontier. This is the mechanism that makes the flywheel SELF-RE-FUELING from external knowledge instead of
dying at the resolution limit of its own internal idea-space.

---

## 4c. Outer-loop EVAL tier — held-out eval + grader calibration (USER 2026-06-05)

The per-clone grade (inner loop) cannot tell you two things: whether recipes are OVERFITTING the dev corpus, and
whether the GRADER ITSELF is honest. The user exposed the second directly — grader said 0.586, their eye said
"not close" (a horizontal-scroll + wrong-nav clone the composite barely penalized). So the outer loop has TWO
standing guards, not one:

- **Tier-R — EXTERNAL RESEARCH** (`research-refuel.workflow.js`, §4b): imports the ecosystem's solved knowledge so
  the loop learns from the world, not only self-play. Cadence: every `researchEvery` (=3) rounds.
- **Tier-E — HELD-OUT EVAL + CALIBRATION** (`eval-harness.workflow.js`, NEW): the anti-overfit + grader-honesty
  guard. Cadence: every `evalEvery` (=4) rounds. Two jobs:
  1. **Held-out trajectory.** Clone+grade a FIXED EVAL-ONLY set (`stripe/github/clerk/notion`, pages 9101-9104),
     DISJOINT from the dev corpus (tailwind/supabase/resend/framer/linear/vercel/reactdev) and the breadth corpus.
     A gain here is real GENERALIZATION; a held-out drop while the dev mean rises = OVERFIT → flag + stop crediting
     the offending recipe.
  2. **Grader calibration.** Per held-out clone, compute the grader composite AND an independent LIVED-EXPERIENCE
     score from objective probes the grader may miss — `horizontalScroll@1280`, `overflow@390`, `navBrandRight`,
     `rendersContent`, `contentStacked`. `calibrationGap = composite − experienceScore`; a large positive gap = the
     grader OVER-credits vs reality (the exact "0.586 vs not close" failure). The gap's `missedDimensions` become
     grader-honesty fixes (e.g. a viewport-overflow penalty + nav-brand check in `grade-sections.mjs`).

**DRIVER RULE at pick-next-round (step 4), checked alongside the research cadence:** if
`roundsSinceEval >= evalEvery` → next round = `eval-harness` (read-only on cloner code; may overlap a build round;
web/Playwright-heavy), then record its return into `evalHistory[]` (stamp ts), set `roundsSinceEval = 0`, and fold
its `nextEvalTarget` into the backlog (grader-honesty fix → `supervisedQueue` since it edits the objective; builder
defect → `directedFixBacklog`); else `roundsSinceEval += 1`. The eval NEVER edits the grader/builder itself (it only
measures + proposes) so it can never fake-improve the number it reports.

**Why both:** research without a held-out eval drifts toward plausible-but-unproven changes; a held-out eval
without research plateaus at the limit of internal ideas. Together they keep the outer loop honest AND fed.

---

## 5. JIT engine specs (build these when the phase needs them; reuse evolve.workflow.js's structure)

### 5.1 `evolve-grader-ext.workflow.js` (Phase 2)
A parameterized clone of the hardened `evolve.workflow.js` with these deltas:
- Reads `args.block` (the target blind block). Defaults to `phase2queue[0]` if absent.
- Propose prompt: read `knowledge/STRUCTURAL_ROUND_PLAYBOOK.md` Section B entry for `args.block`. Make the
  **THREE-file** change: (a) `grade-sections.mjs` — add a `blocks.<block>` detector inside the in-page
  `capture()` evaluate, using a GENERIC, source/clone-SYMMETRIC DOM signature (never Elementor class names);
  (b) `capture-layout.mjs` — detect the node kind; (c) `build-absolute.mjs` — emit the matching widget. Back up
  ALL THREE files.
- **HARD self-test gate (engine-verified, not agent-trusted):** after propose, run a dedicated agent:
  `node grade-sections.mjs --source <each corpus url> --selftest` → require **composite 1.0 / PASS** on every
  site. If any site < 1.0 → restore all three, verdict `REJECTED (asymmetric detector)`.
- **Gate criterion (grader changed → mean is NOT cross-comparable, so do NOT gate on mean):** require the grade
  agent to report per-site `visual`, `editability`, and `targetClone`/`targetSource` for `args.block`. KEEP iff:
  self-test PASS **AND** the block is built (`sum(targetClone) >= 0.8·sum(targetSource)` across sites with the
  block, OR structuralFidelity rose) **AND** no per-site `visual` or `editability` regression beyond noise tol.
  (visual + editability are grader-stable across a block-type addition, so they ARE comparable.)
- Else restore all three files. Log the recipe (note it added a grader dimension).

### 5.2 Synthetic bench (Phase 3)
`eval/grader/bench/<block>.html` — one minimal, deterministic page per block (a single instance on an
otherwise-empty page). Serve via a local static server or `file://` capture. A `bench-evolve` variant points
the corpus at these pages so each block gets a clean, strong, isolated signal (no 4-site dilution/noise). The
gate is per-block: visual ≥ target, editability ≥ target, structural = correct widget type. Keep the existing
4 real sites as the **integration** corpus.

### 5.3 `discovery.workflow.js` (Phase 5)
Read-only multi-lens completeness critic. Parallel agents, one per lens (color / typography / spacing / shadow
+gradient+radius / z-order / hover+focus / responsive@3vw / a11y / perf / position-drift / image-fidelity).
Each captures source+clone for the corpus, scores its dimension, names the worst offenders, and proposes a
CONCRETE new symmetric grader dimension (+ the capture/build fix to satisfy it). A synthesis agent ranks the
proposals by (impact × feasibility) and writes the top N to `overnight-state.json.phase5backlog`. The driver
then runs each as a grader-ext-style dimension-addition round (self-test=1.0 → build → corpus-gate). This is
the mechanism that closes metrics not yet enumerated.

---

## 6. Convergence / stop

- **Only hard stop:** `now >= deadlineEpoch` (30h).
- **No early stop.** "Soft convergence" (corpus mean ≥ 0.95 on all dimensions, discovery finds nothing new for
  3 rounds) does NOT end the loop — it triggers **bar-raising** in Phase 5 (harder sources, stricter
  thresholds), then keeps discovering. The loop is designed to always have a next-most-valuable gap.

## 7. Cost (transparency)
Each round ≈ 9–11 agents, ~200–430k subagent tokens, ~12–35 min wall. Over 30h that is dozens of rounds and
multiple million tokens. This is authorized: the user asked for an all-night autonomous run; token cost is not
a constraint for this task. The dev WP site (georges232.sg-host.com) is hammered with hundreds of PUTs; the
page-reuse wipe prevents stacking and the corpus-gate + self-test + auto-restore keep the code safe.

## 8. Resumption (cold session via heartbeat cron)
A fresh session reads THIS file + `overnight-state.json` + `recipe-library.json` + `STRUCTURAL_ROUND_PLAYBOOK.md`
+ CLAUDE.md/memory, then executes the Driver Protocol (§3) from the current state. Auth is in
`/tmp/joist-auth.env`. The journal MCP may be absent in a headless run — that is fine; the manifest is the
source of truth. Never stop for input; drive to the deadline.
