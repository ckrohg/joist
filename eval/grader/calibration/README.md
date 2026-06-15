# Calibration corpus — `corpus-manifest.json`

The sequestered, archetype-diverse human corpus that calibrates the **upleveled grader**
(`grade-element-crops.mjs` axis-delta tolerances + `region-judge.mjs` rollup). It is the
**denominator** the path-to-1:1 protocol regresses against. Nothing here is a grader output —
every `human_ledger` is either a **real recorded human audit** (slotted from labels we already
own) or `null` (a fresh out-of-sample audit is still owed).

## What's in the manifest

An array of `pairs`, each:

| field | meaning |
|---|---|
| `page_id` | local WP page id (null when the labeled artifact is a screenshot pair with no live clone) |
| `archetype` | `blog` \| `marketing` \| `saas` |
| `source_url` | the public source the clone was built from (captured read-only) |
| `clone_page` / `clone_url` | live local clone (only `localhost:8001`; null for screenshot-only anchors) |
| `split` | `DEV` (tune on these) \| `HOLDOUT` (sequestered — never tuned on) |
| `compare_blob` | path to the `compare-capture` DOM-correspondence blob, when one exists |
| `human_ledger` | the human audit, or `null` |

### `human_ledger` schema

```jsonc
{
  "overall_0_100": 5,                 // scalar anchor: 0 = worthless, 100 = indistinguishable
  "per_defect": [                     // human-ticked defect classes (align 1:1 with grader axis `class`)
    { "defect_class": "wrong-logo", "severity": "high", "note": "..." }
  ],
  "scored_by": "ctkrohg@gmail.com",
  "scored_at_utc": "2026-06-14",
  "blind": true,                       // true = scored WITHOUT seeing a grader number first
  "source_label_file": "human-results.json",   // provenance
  "source_label_id": "P01"
}
```

`defect_class` ∈ `wrong-logo | missing-logo | invisible-heading | invisible-text | blank-hero |
unstyled-cta | missing-imagery | missing-section | overlapping-sections | wrong-layout | color-off |
font-off | image-missing` — the union of `grade-element-crops` axis classes and `region-judge`
`FATAL_OF` buckets, so a human tick can be matched to a fired axis row.

## Where the 22 existing labels slot in

- **`human-results.json`** — 18 broken clones (`P01`–`P18`, human 0–6/100). Slotted at their real
  screenshot pairs (most have **no** live `clone_page`; their `source_img`/`clone_img` paths are
  carried so `region-judge` PNG calibration still works). All `DEV`.
- **`midrange-human-results.json`** — 4 projection clones (`M01`–`M04`, human 0–5/100).
  `M03` (overreacted) and `M01` (tailwind) have **live** local pages **341** and **268** — the two
  pairs the resolution-win proof runs on, where `grade-element-crops` works end-to-end via DOM
  correspondence. `M02`/`M04` (vercel/stripe) are screenshot-only. All `DEV`.

## The honest gap (read this before calibrating)

**Every existing human score is in the 0–6/100 BROKEN band.** The user audited the grader's own
"best" outputs and found them worthless, so the corpus currently anchors only the **floor**.
Calibrating tolerances on a 0–6 band alone fits the lower range and tells you nothing about the
upper range. The `HOLDOUT` split exists to fix this and is **sequestered**:

- 3 holdout pairs (`supabase` saas, `posthog` marketing, `react.dev` blog), `human_ledger: null`,
  `_needs_fresh_human_audit: true`.
- supabase is the known **good** 1:1+editable clone — exactly the mid/high anchor the corpus lacks.
- **Do not** fill a HOLDOUT ledger from grader output. A human scores it **blind** (no grader number
  shown) so the holdout is a true generalization test and cannot leak into tolerance tuning.
- `react.dev` caveat: its source assets are blocked in this network → unstyled/~3.5× too tall source
  render (see memory `reactdev_source_render_blocked`). Swap in a second blog source at audit time if
  it cannot be captured.

## How the corpus is consumed

```bash
# DEV pairs with a live clone_page + compare blob → full element-crop grade:
node grade-element-crops.mjs --compare /tmp/compare-341.json --widths 1440 --no-vision
node grade-element-crops.mjs --compare /tmp/compare-341.json --widths 1440   # + vision

# screenshot-only DEV anchors → region-judge PNG calibration:
node region-judge.mjs --source <source_img> --clone <clone_img> --no-vision
```

Calibration loop: tune `TOL` (in `grade-element-crops.mjs`) + the `region-judge` rollup caps on the
**DEV** split, then run the **HOLDOUT** split once (after its blind human audit) to measure
generalization. Tolerances ride `uncalibrated: true` until this loop closes.
