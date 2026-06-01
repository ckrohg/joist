# Lessons — Edit (reference signal = before-state + intent, gated on zero regression)

Lessons about modifying an existing page. The edit grader answers three questions the other
modes don't all need:

1. **Did the intended change land?** (intent satisfaction)
2. **Did anything ELSE change?** (regression / collateral damage — a structural before/after
   tree diff, not just a screenshot)
3. **Is the result still good?** (taste rubric, as in build)

Edit is the riskiest mode: **round-trip editability is a hard product requirement.** A clone
that's 70% is a useful draft; an edit that silently corrupts the rest of the page is a
data-loss event. The regression axis is therefore the primary axis here, not a secondary one.

Read alongside `LESSONS_MECHANICAL.md` before any edit run.

---

## CORRECTED: the executor is NOT insert-only — surgical in-place edit is fully implemented

**Discovered:** 2026-05-31 | code audit of `PlanExecutor` + `PatchEngine` (baseline prep)
**Stale claim:** The clone skill (SKILL.md Phase 6) says *"Joist's executor is insert-only —
create a new page, don't edit in place."* This is **false against the current plugin** and
actively harmful: it steers agents away from a capability that exists.
**Verified truth:** `PlanExecutor::executeStep` routes a full op vocabulary through
`PatchEngine`: `update_settings`, `replace_element`, `insert`, `delete`, `move`, `duplicate`,
`wrap`, `unwrap`. Each op targets a node by its element `id` and recursively walks the tree.
`PlanExecutor` snapshots the whole page before the plan and **restores on any step failure**
(atomic, with rollback). So true surgical in-place edit — modify / delete / move a single
existing node while preserving the rest — is real today.
**Implication for the baseline:** the real question is no longer "does edit exist" but
"**can the agent author correct ops?**" — i.e. (a) read the page tree, (b) pick the right
`element_id`, (c) emit a valid op shape, (d) not cause collateral damage. The regression axis
is about *agent op-authoring accuracy*, not executor capability.
**Follow-up to fix:** correct the stale line in `plugin/skills/joist-clone/SKILL.md` Phase 6.

## RESOLVED: V4 element-ids are STABLE across saves

**Discovered:** 2026-05-31 | edit baseline E1, page 254 (build→edit on Elementor 4.0.9)
**Verified:** Built a 4-node page (container + heading + text + button), captured ids, then ran a
single `update_settings` on the heading. Re-fetched tree: **all four ids identical**
(`0b6be33a`/`ac64683a`/`fe7da29a`/`4d4cdd92`) before and after. V4 preserves existing ids on save;
it only assigns ids to *new* nodes. So edit plans can safely target ids read once, and repeat
edits against the same page are safe. (Still re-read the tree if a prior step *inserted* nodes —
those get fresh ids in `generated_ids`.)

## VERIFIED: `update_settings` is a merge, not a clobber

**Discovered:** 2026-05-31 | edit baseline E1, page 254
**Verified:** `update_settings {element_id, settings:{title:"..."}}` changed only `title`; the
heading's `title_color`, `typography_*`, font size and weight all survived untouched, and the
sibling text/button nodes were byte-identical. So a targeted text edit is genuinely surgical —
you pass only the keys you want to change, not the whole settings object. (Use `replace_element`
when you intend to swap the entire node.)

---

## (seed) Regression detection needs a structural diff, not a screenshot

**Status:** principle
**Insight:** A screenshot diff can miss regressions that aren't visible above the fold or that
only manifest on tablet/mobile breakpoints. The reliable signal is the element tree:
`get_page_tree` before, apply edit, `get_page_tree` after, diff the JSON. Every node that
changed should be explainable by the intent. Unexplained deltas = collateral damage.
**Implication:** The edit loop captures the before-tree as part of Phase 0 and diffs after
every apply. This is cheaper and more reliable than vision for the regression axis.

---

*This file is intentionally thin — the edit loop hasn't been run under measurement yet. The
baseline sweep will populate it, starting with the insert-only question above. Mechanical
gotchas discovered during an edit run go in `LESSONS_MECHANICAL.md`.*
