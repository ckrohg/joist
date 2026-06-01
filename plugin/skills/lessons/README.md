# Joist Lessons Corpus — the "tenet within"

Accumulated, dated, cited generation/grading lessons. The generator→grader→learn loop
(the "audit ability") writes here so future runs don't rediscover the same gotchas. This
corpus is the compounding asset: it is what makes iteration N+1 cheaper than iteration N.

## Why the split

The audit loop produces two kinds of lessons, and they transfer differently across modes:

- **Mechanical** (`LESSONS_MECHANICAL.md`) — facts about *how Elementor compiles* and how
  Joist's write flow behaves (`_flex_basis` doesn't compile on V3, pages default to draft,
  V4 atomic fields trip the hash, the only safe JS init hook, screenshot-grading mechanics).
  These are **mode-agnostic** — every one improves clone, build, AND edit with zero
  adaptation. This is the half of the loop that transfers for free.

- **Mode-specific** — lessons about the grader's *reference signal*, which differs per mode:
  - `LESSONS_CLONE.md` — extracting ground truth from a live source (compiled-CSS palette,
    JS-loaded carousels, motion detection-before-authoring, the honest V3 fidelity ceiling).
  - `LESSONS_BUILD.md` — judging a blank-screen build against a *brief + taste rubric*
    (no source exists; the skeptical `elementor-critique` evaluator is the reference).
  - `LESSONS_EDIT.md` — verifying an edit landed AND nothing else regressed
    (intent satisfaction + structural before/after diff; insert-only executor constraints).

## How the loop writes here

After each graded iteration, the agent appends any new lesson to the correct file using the
format below. Mechanical lessons ALWAYS go in `LESSONS_MECHANICAL.md` even when discovered
during a clone run — that's how a clone-discovered gotcha (e.g. publish-default) becomes
available to the build and edit loops for free.

```
## <short title>
**Discovered:** <date> | <mode> <iteration>: <source/page/brief>
**Symptom:** <what went wrong visibly>
**Root cause:** <why>
**Fix:** <concrete change>
```

## Reading order

The clone/build/edit SKILLs each read `LESSONS_MECHANICAL.md` + their own mode file before
Phase 1. The mechanical file is the shared spine.

> Mirror note: `~/.claude/skills/joist-clone/LESSONS.md` historically held the clone corpus.
> It now points here. Keep the two in sync until the skills are repointed to this directory.
