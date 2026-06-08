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

---

## UPDATE 2026-06-07 — fixes A/B applied + measured; NO-GO confirmed; ceiling diagnosed

Fixes A (fuzzy absence), B (off-viewport clamp), and the matcher upgrade were **applied to
`reconcile-breakpoints.mjs` and live-measured** on supabase (same-stack before/after, throwaway pages,
deleted + 404-verified). The model is genuinely better — but **per-bp still does NOT beat the clean stack**,
and we now know *why* with renders + a control experiment. This is the honest "report it, don't force it"
outcome the acceptance section anticipated.

### What landed in `reconcile-breakpoints.mjs`
1. **Char-bigram Sørensen-Dice in `scoreLeaf`** — byte-mirrors `grade-responsive`'s `matchNodes` text rail
   (`dice≥0.5`), so a leaf is matched here IFF the grader could match it. Catches resegmented/reworded mobile
   text the old exact+substring rail missed.
2. **Global best-pair matching** (replaced ref-order greedy) — score every (desktop, target) pair in
   corresponding bands, assign highest-first. Order-independent → safe to lower `TEXT_THRESH` 0.7→0.5 (the
   grader's rail) without a 0.52 pair stealing a target a 0.9 pair wants.
3. **Fuzzy absence classifier** — the miss→absent reclassify now uses `dice≥0.5`/substring, not exact.
4. **Off-viewport `box` clamp** — a matched leaf whose mobile box lands outside `[-24, VW+24]` is dropped back
   to `miss` (the band-y=608 stat row that pinned to left=-73/right=548), so the build never pins off-screen.

### The measured numbers (same-stack, this session)
| build | responsiveScore | matched@390 | docH@390 | layout@390 |
|---|---|---|---|---|
| **status-quo stack** (flag OFF) | **0.3254** | 38 | 20371 | **0.8677** |
| per-bp **HIDE** (flag ON) | 0.2831 | 20 | **7064** ✓ | 0.8789 |
| per-bp **NOHIDE** | 0.3005 | 38 | 16058 | 0.7895 |

The fixes *did* lift per-bp (HIDE 0.2716→0.2831, NOHIDE 0.2889→0.3005 vs the prior handoff figures) — real
model gains, desktop byte-identical. **But the stack (0.3254) still wins.**

### Why it's a ceiling, not a remaining bug (three diagnoses, evidenced)
1. **Pixel-pinning collides — confirmed by LOOKING.** The @390 per-bp render shows the logo wall
   (betashares/GitHub/1Password) overprinting the hero, and the feature cards collapsing into colliding text.
   The RLG `layout` sub-score reacts: per-bp NOHIDE layout **0.7895 < stack 0.8677**. **Supabase mobile is a
   1-col vertical stack, so a clean blanket stack is structurally MORE faithful than reconstructed absolute
   positioning.** Pixel-pinning desktop-segmented leaves fights the grain.
2. **The HIDE loss is a CAPTURE disagreement, not the matcher.** Control experiment: `ABS_PERBP_NOHIDE=1`
   recovers matched@390 20→**38** (= the stack) — so repositioning is fine; **hiding** is the loss. The 18
   hidden-but-grader-matched leaves are present in the grader's own @390 source capture but absent from
   `capture-multi`'s 91 @390 leaves (or segmented so `dice<0.5`). i.e. `capture-multi@390` ≠ the grader's
   @390 node set. **The real fix C is capture/segmentation alignment, not matcher tuning.**
3. **The stack's height is NOT type — it's 1-col density.** Tested `ABS_FLUID_FLOOR=0.45` (shrink the 0.62
   floor that kept a 64px hero at 40px): docH@390 barely moved (20371→20260) and matched *dropped* 38→28.
   The 2.9× height is ≈206 leaves each stacking one-per-row at natural wrapped height — structural to 1-col
   stacking a content-dense page, which type-shrinking can't touch. (Edit reverted; build-absolute clean.)

### Revised strategic read
For **1-col-mobile site classes** (supabase, most marketing pages), per-breakpoint **absolute** repositioning
is the wrong tool — it can't out-score a clean stack because pixel-pinning collides. Two honest forward bets,
in priority:
- **(I) Capture-alignment (fix C, the genuine unlock):** make `capture-multi@390` extract the same node set
  the grader sees, so the absence classifier hides ONLY truly-absent content. Then per-bp HIDE could keep
  matched≈38 AND docH≈7064 — the only combination that beats the stack. This is a capture-layer task.
- **(II) True reflow, not pinning:** regroup mobile bands via CSS grid/flex (the source's own mobile
  structure) instead of absolute boxes — kills the collisions that cap the layout score. (The shallow
  2-col-direct-child detector was already proven inert; columns nest deeper — see [[../../knowledge/abs_responsive_ceiling]].)

`ABS_PERBP` stays **default-OFF**. The `reconcile-breakpoints.mjs` improvements are committed (they make the
Stage 1 model strictly more honest + grader-aligned regardless of whether the per-bp build ever ships). NOTE:
the 85% content-% gate now reads ~80% — that's the *honest* direction (fuzzy absence reveals fewer true
absences); treat content-% as a diagnostic, not pass/fail. The real gate is the build's `grade-responsive`.
