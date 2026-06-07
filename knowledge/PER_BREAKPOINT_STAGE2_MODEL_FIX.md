# Per-Breakpoint Stage 2 — Model-Quality Fix (HANDOFF for the next agent)

@purpose The per-breakpoint responsive arc is mechanically PROVEN end-to-end but blocked on ONE thing:
model fidelity. This is the exact, reproducible next task. Parents: [[PER_BREAKPOINT_CAPTURE_SCOPE]],
[[PER_BREAKPOINT_STAGE1]], [[../../knowledge/abs_responsive_ceiling]]. Lives on branch **`per-breakpoint`**.

## Where the arc stands (all on `per-breakpoint`)

- **Stage 0 — GO.** Captured-390 positions pinned via `@media custom_css` reproduce the source mobile
  geometry (anchor-IoU 1.000 vs status-quo 0.106; kses-safe; desktop byte-identical). The channel works.
- **Stage 1 — gate PASS + generalizes.** `capture-multi.mjs` + `reconcile-breakpoints.mjs` (band-aware
  matcher + svg-markup/image-src identity + a global-counterpart absence classifier + dual metric).
  Content-match: supabase 88.5% @390, tailwind 93.5% @390. Two sites, both ≥85%.
- **Stage 2 — mechanism PROVEN, but NO-GO on the grade.** `build-absolute.mjs` has a flag-gated
  (`ABS_PERBP=1`, default OFF) build that emits per-element `@media` re-pin from the model + native
  `_mobile/_tablet` typography + `display:none` for absent leaves + a root height floor. Desktop >1024 is
  byte-identical (verified by tree-diff). The @390 render reproduces the correct source mobile **band order
  + exact docH 7064**. BUT grade-responsive went **0.3115 → 0.2716 (worse)**.
- **Grader — CLEARED as sound.** `grade-responsive` is source-anchored (`matchNodes` matches source→clone;
  score = `reproduced × (0.7 + 0.3·presence)`, reproduced dominant). It is NOT presence-biased. **Do NOT
  change the grader.** The loss is genuinely the model.

## The blocker (diagnosed, not guessed)

The per-bp clone matched only **20** source@390 nodes vs the generic stack's **37** — it lost on the grader
because the MODEL fed it bad data, in three specific ways:

1. **The absence classifier OVER-HIDES.** It hid 116 leaves; **91 carry real text and several ARE present
   in source mobile.** Root cause: the counterpart-existence check in `reconcile-breakpoints.mjs` is
   **EXACT text match** — so a leaf whose text is present-but-segmented-differently at mobile (mobile
   coalesces/wraps text differently) fails the exact check and is **falsely marked absent**, then hidden.
   Hiding source-present content tanks both `presence` and the matchable-pair count on the grader.
2. **`box[390]` mis-maps for the band-y=608 stat row** → 3 leaves land off-viewport (left=-73,
   right=418–548). The matcher assigned wrong mobile boxes to that row (likely a band split/merge or a
   bad leaf assignment). grade-structure's mobile-fit sub-term (1.0→0.769) is reacting to exactly these.
3. **Text segmentation differs source vs clone** → even correctly-positioned text leaves collide/overprint
   in the render (visible in the @390 screenshot), because the captured box doesn't match the clone text's
   actual wrapped extent, and per-breakpoint font-size/line-height isn't fully carried.

## The fix (in priority order)

**A. Make the absence classifier FAITHFUL (biggest lever).** In `reconcile-breakpoints.mjs`, the
reclassify pass (the block that turns 'miss' → 'absent' when no counterpart exists at the target width)
uses EXACT match (`targetTextSet.has(d.text)` etc.). Change the counterpart check to **FUZZY** — text
dice/substring (the same `dice ≥ 0.5` rail grade-responsive's `matchNodes` uses), so a leaf whose text is
present-but-resegmented isn't falsely hidden. Net goal: a leaf is 'absent' ONLY if it's *genuinely* not on
source mobile, not when the matcher merely failed to find it. Re-check: matched@390 should rise well above
20 toward the ~90 source-present nodes; the over-hide count (currently 116) should drop sharply.

**B. Fix the `box[390]` mis-maps.** Investigate the band-y=608 correspondence + leaf matching there
(`correspond()` candidate bands + the scored leaf match). Likely a band split/merge or an order/aspect
mis-assignment. Add a sanity guard: never emit a `box[390]` whose x is < 0 or x+w > the mobile viewport
(390) — clamp or drop (fall back to desktop-pin + blanket un-pin for that leaf rather than pin off-screen).

**C. Carry per-breakpoint typography + box-extent for text.** Ensure the build emits the captured
`typo[390]/[768]` font-size/line-height (Stage 0 flagged this; Stage 2's build did it via native
`typography_font_size_mobile/_tablet` but check it's actually applied, not hardcoded), and that text leaves'
`box[390]` reflects the mobile rendered extent so they don't overlap. Stage 0 caveat: position alone isn't
visual-1:1 — typography is a required companion.

## Reproduce (exact commands)

```bash
# 1. capture (or reuse /tmp/pbc-s1/multi.json from this session)
node eval/grader/capture-multi.mjs --source https://supabase.com --widths 1440,768,390 --out /tmp/pbc-s1
# 2. reconcile → model (this is the file to FIX)
node eval/grader/reconcile-breakpoints.mjs --multi /tmp/pbc-s1/multi.json --out /tmp/pbc-s1/model.json
# 3. build per-breakpoint (flag-gated; ABS_PERBP_NOHIDE=1 to test reposition-without-hide)
ABS_PERBP=1 ABS_PERBP_MODEL=/tmp/pbc-s1/model.json ABS_PERBP_H390=7064 ABS_PERBP_H768=8235 \
  JOIST_AUTH_B64=<b64> node eval/grader/build-absolute.mjs --layout /tmp/pbc-s1/layout-1440.json --page <id>
# 4. grade responsive + desktop gate
node eval/grader/grade-responsive.mjs --source https://supabase.com --clone <clone-url> --widths 390,768,1024,1440
# (+ grade-structure on the clone @1440 for the desktop composite gate)
```
Auth: `source /tmp/joist-auth.env` (JOIST_BASE + JOIST_AUTH_B64; derive from ~/.claude.json joist-georges232 Authorization, strip `Basic `).

## Acceptance (the gate Stage 2 must clear)

- grade-responsive **moves UP** vs the **same-stack** status-quo (0.3115 on this stack — NOT the older
  0.2547 figure) at widths 390/768/1024/1440.
- Desktop **composite holds ~0.911**, **hRatio ~1.0**, no new >1024 overflow (all overrides ≤1024-scoped —
  this is already true; keep it true).
- `matched@390` recovers from 20 toward the source's ~90 present nodes (proves over-hiding fixed).
- **LOOK @390**: no text collisions, no off-viewport leaves, bands reflow to the captured mobile layout.

If after A–C it still doesn't beat the stack, the honest read is the editable-Elementor responsive ceiling
is below the grader's bar for this site class — report that, don't force it.

## Don'ts
- Don't change `grade-responsive` (cleared as sound this session).
- Don't ship `ABS_PERBP` until it clears the gate (keep it default-OFF).
- Don't touch desktop emission (>1024 must stay byte-identical — verified by dumped-tree diff).
