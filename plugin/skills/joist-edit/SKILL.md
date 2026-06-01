---
name: joist-edit
description: Make a precise, verified edit to an existing Elementor page on a Joist-equipped WordPress site — change copy, restyle, add/remove/reorder a section — and PROVE it caused no collateral damage via a before/after element-tree diff. Use when the user says "change X on page N", "edit <page> to ...", "update the <section>", "swap the <thing>", "remove the <section>". Requires the Joist MCP (joist_get_page_tree, joist_create_plan/approve/execute) and, on v0.10.12+, joist_validate_widget for pre-flight. The executor is surgical + atomic (whole-plan snapshot + rollback); this skill adds the agent-side intent→element_id translation and the regression gate.
---

# joist-edit — verified in-place page editing

The Joist executor already does surgical ops (`update_settings`/`insert`/`delete`/`move`/
`replace_element`/`duplicate`/`wrap`/`unwrap`) targeting any node by `element_id`, wrapped in a
whole-plan snapshot with rollback (verified 6/6 in the 2026-05-31 edit baseline). What this skill
adds is the half the agent owns:

1. **Translate** a natural-language intent into the right `element_id` + op.
2. **Gate on zero regression** — diff the element tree before/after; every changed node must be
   explainable by the intent. Unexplained deltas = collateral damage.

Round-trip editability is a hard product requirement, so the regression gate is the PRIMARY axis
here — an edit that silently corrupts the rest of the page is a data-loss event, not a low score.

## When this activates

Trigger phrases: "change X on page N", "edit <page> to …", "update the <section>", "rewrite the
<copy>", "make the <element> <bigger/blue/…>", "add a <section> to <page>", "remove/swap/reorder …".

## Inputs
- `page_id` (required — or identify it via `joist_list_pages` from a title/URL the user gives)
- `intent` (required — the edit, in the user's words)

## The loop

### Phase 0 — Prereqs
- `joist_get_site_info` → confirm MCP reachable + note version (validate tool needs ≥0.10.12).
- Read `plugin/skills/lessons/LESSONS_EDIT.md` + `LESSONS_MECHANICAL.md` + `knowledge/WIDGET_CONTROL_CHEATSHEET.md`.

### Phase 1 — Capture BEFORE + locate the target
- `joist_get_page_tree(page_id)` → this is the **BEFORE tree**. Persist it (every node's `id` +
  the settings you might touch).
- Map the intent to target node(s): search the tree by visible text (headings/editor HTML),
  `widgetType`, section role, or position. Produce an explicit **change plan**:
  `[{element_id, op, what_changes, why_it_matches_intent}]`.
- If the intent is ambiguous (multiple candidate nodes), pick the best match and say which; don't
  guess silently across many nodes.
- **V4 id stability is verified** — ids read here are stable across saves (only newly-inserted
  nodes get fresh ids). Safe to target ids read once. (See LESSONS_EDIT.)

### Phase 2 — Pre-flight the ops
- For each `update_settings`/`replace_element`/`insert` op, validate the settings BEFORE submitting:
  on v0.10.12+ call `joist_validate_widget(widget_type, settings)` → fix any key the error names
  (it suggests the right one, e.g. `text_align`→`align`). Otherwise lean on the cheat-sheet.
- `update_settings` is a MERGE — pass ONLY the keys you want to change; never resend the whole
  settings object (you'd risk clobbering). Use `replace_element` only when swapping a whole node.

### Phase 3 — Apply (atomic)
- `joist_create_plan(page_id, steps)` → `joist_approve_plan` → `joist_execute_plan`.
- A whole-plan snapshot is taken; any step failure rolls the ENTIRE page back. So a multi-op edit
  is all-or-nothing — good. If execute fails, read the error, fix the op, re-plan.

### Phase 4 — Regression gate (the load-bearing step)
- `joist_get_page_tree(page_id)` → **AFTER tree**.
- Diff AFTER vs BEFORE. Classify every difference:
  - **intended** — a node your change plan said you'd touch, changed the way you intended.
  - **benign** — V4 atomic auto-fields (`id` on new nodes, `styles`/`interactions`/`version`/
    `editor_settings`/`isInner`/`elements:[]`); ignore these (see LESSONS_MECHANICAL).
  - **auto-injected** — `custom_css` added by FlexWidthFiller (`/*joist-fw*/…`) or `flex_direction`
    promoted to `row` on a column container; expected when your edit added/sized columns.
  - **UNEXPLAINED** — anything else. A changed/removed/reordered node you did NOT intend = collateral
    damage. STOP, report it, and roll back (re-snapshot or restore the BEFORE tree).
- `regression_score` = 100 if zero unexplained deltas; subtract per unexplained changed node.

### Phase 5 — Verify intent + taste
- Confirm the intended change is actually present in the AFTER tree (and, for visual edits, publish
  + screenshot to confirm it rendered).
- Quick taste check: did the edit keep the page coherent (didn't introduce a slop pattern, off-palette
  accent, or broken rhythm)? Use the `elementor-critique` lens if the edit was substantial.

## Output
```
✓ Edited page <id>: <intent>
Ops: <N> (<update_settings×a, insert×b, …>)
Regression: <score>/100 — <"zero unexplained tree deltas" | list of collateral nodes>
Intent satisfied: <yes/no, evidence>
<published URL if visual>
```

## Grading (for the eval harness)
- `intent_satisfied` (bool + 0–100), `regression_score` (0–100, primary), `taste_delta` (−/0/+).
- An edit with a perfect visual result but unexplained collateral nodes FAILS — regression is the gate.

## Known truths (from the edit baseline)
- Executor is NOT insert-only — full surgical op set works (the old skill note was stale).
- V4 element-ids are STABLE across saves; `update_settings` MERGES.
- `move` works through MCP even though the create_plan tool description omits it.
- Always set `flex_direction:row` on a column parent (or rely on FlexWidthFiller v2's row-intent
  inference, v0.10.13+) when an edit introduces `width:%` columns.
