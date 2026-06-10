# Flywheel Autonomy — the path to a truly self-improving builder

> Goal: the grader doesn't just score — it makes the builder better every cycle, with less and less human steering. This is the explicit ladder, where we are, and what each next rung needs.

## The autonomy ladder
| Level | Capability | Status |
|---|---|---|
| **L0** | Human finds a defect by eye, writes the lesson, fixes the builder | superseded |
| **L1 — auto-detect** | Grader finds defects deterministically across many surfaces (visual, dynamic, perf, a11y, responsive, interaction) | **HAVE** |
| **L2 — auto-classify** | `lessons.mjs --classify` routes each defect to a known lesson (RECURRENCE) or flags NEW | **HAVE** |
| **L3 — auto-file + lifecycle** | `lessons.mjs --learn` updates the ledger itself: files unseen defects as candidates, tracks seen/recurred/first/last, escalates a fixed lesson to **regressed** ONLY if its build guard also fails (else stale-deploy), emits a prioritized worklist | **HAVE** |
| **L4 — auto-guard** | Each fixed lesson has an automated guard that blocks its regression pre-deploy, free. Most are built; auto-*generating* a guard for a newly-filed candidate is the gap | **PARTIAL** |
| **L5 — auto-fix** | Agent reads the worklist, implements the builder rule, re-verifies via audit+grade, loops. Human only on genuinely novel root-causes | **STARTED** — `autofix.mjs` drives select→present→verify→resolve; the agent writes the code |

## The cycle (one command: `eval-all.mjs`)
```
capture-fx → build-ir → build-ir-elementor --dry        # build the tree (free)
lessons.mjs --audit                                      # L4: block known regressions pre-deploy
build-ir-elementor --page <id>                           # deploy (write-frugal)
eval-all.mjs --source <src> --clone <live>               # L1: grade every layer → composite
   └─ internally runs lessons.mjs --learn                # L2+L3: self-update ledger + worklist
# agent acts on the worklist's top item → fixes builder → next cycle
```
Each turn the worklist shrinks (fixed lessons drop off; their guards keep them gone) and grows only with genuinely new defect classes — so cycles-to-perfect trend down.

## What makes it "self-learning" today (L3, real)
- The ledger **updates itself from grades** — no hand-editing to record a new defect class.
- **Regression vs stale-deploy is guard-verified**: a fixed lesson only escalates if the builder *actually* reproduces the defect (its `--audit` guard fails), not just because an old live page still shows it. This keeps the ledger honest.
- Lessons accumulate **frequency** (`seen`) and **recurrence** (`recurred`) → the worklist is auto-prioritized by what hurts most.
- Elementor build-tips (`--tips`) capture the *how-to-build-right-first-time* knowledge so fixes generalize, not just patch one site.

## Honest gaps to close (to climb the ladder)
1. **L4 auto-guard-gen**: when `--learn` files a NEW candidate, propose a guard config from the defect shape (color-near / count / ratio templates) instead of leaving `guard:manual`. Raises the share of regressions caught free, pre-deploy.
2. **L3 idempotency**: `--learn` double-counts if run twice on the same report; key by (report-hash, defect) so re-runs don't inflate `seen`.
3. **L5 auto-fix loop**: a driver that, for the top worklist lesson with a concrete `builder_rule`, applies the change (or drafts it for review), re-audits, re-grades — closing the loop with the human only on novel root-causes. This is the real prize and is agentic, not a deterministic script.
4. **Coverage**: ~30 dimensions still MISSING (see EVAL_COVERAGE_MAP.md) — each new layer feeds more defects into the same flywheel.
5. **Calibration**: a labeled corpus (human verdicts) to measure that the composite score tracks the human eye — turns "self-validated" into "proven".

## L5 driver (`autofix.mjs`) — how it works
- `--list` — the actionable worklist (lessons with a concrete rule), separated from BLOCKED (rule still `TBD` → needs diagnosis first, won't auto-attempt).
- `--next` — picks the top actionable lesson and presents the full fix task: root cause, builder rule, target file, current guard state, verify command.
- `--resolve <id> --file <f>` — re-runs the lesson's guard (via `lessons.mjs --audit --json`); only flips status to `fixed` if the guard passes. Verification uses the SAME guards as the pre-deploy gate.
- The agent writes the code between `--next` and `--resolve`. Full no-human auto-fix (driver invoking codegen) is the rung above.

## Files
- `eval/grader/autofix.mjs` — the L5 driver (select → present → verify → resolve).
- `eval/grader/eval-all.mjs` — the cycle driver (grade-all → learn → worklist).
- `eval/grader/lessons.{json,mjs}` — the ledger + engine (`--audit` / `--classify` / `--learn` / `--tips`).
- `knowledge/EVAL_COVERAGE_MAP.md` — the surface scoreboard the flywheel is driving toward.
