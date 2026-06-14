# Metric bake-off — deterministic metrics vs vision-judge tile scores

@purpose Correlation study answering: which deterministic visual metrics can
pre-filter / sanity-check / regression-guard the vision-judge layer, and which
roles each metric should play in the layered stack. 2026-06-12.

## Data & setup

- 214 judged side-by-side tiles (source-left | 14px divider | clone-right) from
  6 persisted runs: blog=80, htmlfirst=39, resend=28, tailwind=28, supabase=20,
  clerk(held-out)=19; widths 1440 + 1100; judge = claude-sonnet-4-6 tile score 0-100.
- `split.mjs` halves each tile into src/clone PNGs (pngjs, label-width slice).
- `metrics.py` computes 6 metrics per tile, appends incrementally to `results.jsonl`.
- `correlate.py` reproduces every table below.
- **Installs (honest):** zero failures. PEP-668 blocked `pip install --user`; used
  venv `/tmp/mb-venv`. numpy 2.4.6, scipy 1.17.1, scikit-image 0.26.0,
  torch 2.12.0 CPU (py3.14 wheel exists), lpips alex weights downloaded fine.
  Full 6-metric pass over all 214 tiles ~90s single-threaded (~0.2-0.5s/tile;
  LPIPS at 512px-wide downscale).

## Metrics

| metric | what | direction |
|---|---|---|
| ssim | grayscale SSIM, full res | higher better |
| edge_iou | canny(sigma=2) + dilate(disk 3), IoU | higher better |
| hist_sim | 8x8x8 RGB histogram intersection | higher better |
| block_luma_std | mean abs diff of per-30px-block luma std | lower better |
| mean_abs_diff | mean abs pixel diff | lower better |
| lpips | LPIPS(alex), 512px downscale | lower better |

## Correlation vs judge (Spearman per site; pooled Spearman + Pearson, n=214)

| metric | blog | clerk | htmlfirst | resend | supabase | tailwind | POOLED sp | POOLED pe |
|---|---|---|---|---|---|---|---|---|
| ssim | 0.224 | 0.161 | 0.276 | -0.050 | 0.576 | 0.771 | 0.489 | 0.462 |
| **edge_iou** | 0.533 | 0.454 | 0.585 | 0.366 | 0.756 | 0.714 | **0.679** | 0.615 |
| hist_sim | 0.487 | 0.099 | 0.191 | 0.382 | 0.740 | 0.671 | 0.504 | 0.540 |
| block_luma_std | 0.265 | 0.255 | 0.145 | 0.635 | 0.692 | 0.750 | 0.342 | 0.329 |
| mean_abs_diff | 0.338 | 0.018 | 0.235 | 0.303 | 0.592 | 0.806 | 0.473 | 0.532 |
| lpips | 0.341 | 0.215 | 0.571 | 0.549 | 0.690 | 0.840 | 0.644 | 0.642 |
| **combo edge+lpips** (rank-avg) | 0.428 | 0.376 | 0.625 | 0.472 | 0.741 | 0.767 | **0.690** | 0.689 |
| combo edge+hist | 0.571 | 0.323 | 0.584 | 0.355 | 0.768 | 0.746 | 0.663 | 0.669 |
| combo edge+lpips+hist | 0.503 | 0.318 | 0.593 | 0.467 | 0.755 | 0.773 | 0.677 | 0.685 |
| combo ssim+edge | 0.401 | 0.265 | 0.586 | 0.248 | 0.720 | 0.778 | 0.651 | 0.627 |
| combo all-6 rank-avg | 0.372 | 0.235 | 0.575 | 0.453 | 0.719 | 0.815 | 0.624 | 0.621 |

Headline: **edge_iou is the best single deterministic correlate (rho=0.679
pooled), edge_iou+lpips the best combo (0.690)**. No metric or combo gets past
~0.7 — a deterministic layer explains rank order only roughly; about half the
judge's variance is invisible to pixels-only comparison. SSIM — the metric the
old grader leaned on — is one of the WORST pooled correlates (0.489) and goes
*negative* on resend. Correlations are strong on clean static sites
(supabase/tailwind 0.7-0.84) and weak exactly where judgment matters
(blog/clerk: doubled text, wrong-content sections).

## Q-a: pre-filter thresholds — how much can the deterministic layer pre-classify?

Bands: obvious-bad = judge <=65, obvious-good = judge >=70 (judge dist:
<=50: 80, 51-69: 38, >=70: 96).

Rank-combo (edge+lpips) sweep:

| required precision | obvious-bad | obvious-good | contested middle (judge runs) |
|---|---|---|---|
| 100% | 8% | 7% | **85%** |
| >=95% | 29% | 14% | **57%** |
| >=90% | 33% | 18% | **49%** |

Deployable raw-value conjunction rules (no dataset-relative ranks):

| rule | coverage | precision |
|---|---|---|
| BAD: edge_iou<=0.10 AND lpips>=0.45 | 54/214 = 25% | 93% (judge<=65) |
| GOOD: edge_iou>=0.50 AND lpips<=0.20 | 34/214 = 16% | 94% (judge>=70) |

**Answer: ~40% of tiles can be confidently pre-classified at ~93-94% precision
(25% obvious-bad + 16% obvious-good), leaving ~60% contested middle for the
judge. At 100% precision only ~15% is classifiable — there is no clean
separation.** Practical guidance: use the GOOD rule to *skip* judging (errs
rarely); use the BAD rule to skip judging only when iterating fast — its ~7%
false-bads are precisely the alignment-shift tiles (see Q-b #5) where the judge
is kinder, so never let BAD auto-publish a defect list, only a "needs work" flag.

## Q-b: 5 largest |metric - judge| disagreements — who is right? (LOOKED at all 5)

| # | tile | judge | metric-pred | verdict |
|---|---|---|---|---|
| 1 | htmlfirst w1440 idx06 | 100 | 48 | **JUDGE right.** Near-black spacer band both sides; src has invisible faint texture. Edge/LPIPS hallucinate failure in noise on near-empty dark bands (edge_iou ill-defined at near-zero edge density). |
| 2 | clerk w1440 idx00 | 32 | 79 | **JUDGE right.** Clone hero renders catastrophic doubled/ghosted headline text + duplicated nav/footer. hist 0.983, lpips 0.189 — metrics nearly blind to human-salient text corruption when global layout/colors match. |
| 3 | htmlfirst w1440 idx11 | 10 | 56 | **JUDGE right.** Clone shows a *different section* (signup card + drop-in-components copy) than src ("easy solution to multi-tenancy"). Wrong-content-same-style: white bg + text = high hist/ssim. |
| 4 | clerk w1440 idx03 | 14 | 54 | **JUDGE right.** Dark feature grid with a giant garbled base64/raw-text dump down the middle of the clone. Dark bg dominates every global metric. |
| 5 | resend w1100 idx10 | 72 | 33 | **JUDGE right.** All content present (heading, copy, metrics dashboard) but left-aligned instead of centered + y-shifted. Pixel-aligned metrics collapse under translation (edge_iou 0.024!); judge correctly scores content-preserved-layout-shifted ~72. |

**Score: judge 5/5.** The disagreements are not judge noise — they are the four
canonical blind spots of pixels-only metrics: (1) near-empty bands -> false-bad,
(2) text corruption -> false-good, (3) wrong content, right style -> false-good,
(4) translation/alignment shift -> false-bad. Direct evidence for the
vision-judge pivot: the deterministic layer must stay rails/pre-filter, never
headline.

## Q-c: most stable cross-run regression check

All 6 metrics are pure functions of pixels — cross-run variance comes entirely
from re-screenshot (lazy-load, animation phase, AA). Proxy used: 104 matched
same-site same-idx pairs across the two widths (harsher than re-screenshot —
content actually reflows):

| metric | rank stability (Spearman 1440<->1100) | meanAbsDelta / dynamic range |
|---|---|---|
| ssim | **0.512** (best; judge itself = 0.442) | 32.7% |
| hist_sim | 0.405 | **18.5% (least drift)** |
| edge_iou | 0.291 | 40.2% |
| block_luma_std | 0.289 | 43.3% |
| mean_abs_diff | 0.287 | 28.7% |
| lpips | 0.339 | 48.5% (most drift) |

**Answer: hist_sim is the most stable cross-run regression sentinel** (smallest
relative drift under re-render, trivially cheap, no torch dependency), with
ssim as the secondary rank-stability check. lpips and edge_iou — the best
*quality* correlates — are the *least* stable, so treat their single-run deltas
< ~0.1 as noise (consistent with the known +/-0.08 visual-term noise memory).

## Layered-stack role recommendation per metric

| metric | role in the stack | never use for |
|---|---|---|
| **edge_iou** | Primary deterministic *ranking* signal: pre-filter conjunctions (Q-a rules), iteration-loop progress ordering, contested-middle routing to judge. | Headline score; shifted-but-present content (false-bad); near-empty bands. |
| **lpips** | Perceptual tie-breaker paired with edge_iou (best combo 0.690). CPU-cheap at 512px (~0.1s/tile). | Cross-run regression deltas (noisiest metric); dark/empty bands. |
| **hist_sim** | Cross-run regression sentinel (most stable) + palette/bg-flip veto (a bg inversion craters it). | Quality scoring — it scored the doubled-text clerk hero 0.983. |
| **ssim** | Same-capture byte-level regression diff (did this build change pixels at all?); rank-stable across re-render. | Quality correlate — pooled 0.489, negative on resend; retire from any scoring role. |
| **block_luma_std** | Texture/void detector (essentially the content-void signal): flags empty-where-source-has-content bands. Good on card-grid sites (resend 0.635). | Pooled scoring (worst pooled rho=0.342). |
| **mean_abs_diff** | Trivial smoke check only (clone rendered at all / not blank). Redundant with ssim+lpips. | Everything else. |
| **vision judge** | Headline, per the 2026-06-10 pivot — confirmed by Q-b 5/5. Run it only on the ~60% contested middle (Q-a) for ~40% cost cut at ~93% precision. | — |

Anti-gaming note: every false-GOOD in Q-b (wrong content, garbled text) is a
shape a generator could converge to if the deterministic layer were the
objective. The deterministic layer may *veto downward* (rails) and *skip
judging upward* (obvious-good), but must never raise a score the judge lowered.

## Files

- `split.mjs` — tile halver (pngjs; reads /tmp/vj-*; writes /tmp/metric-bakeoff/halves)
- `metrics.py` — 6 metrics -> `results.jsonl` (incremental, idempotent; venv /tmp/mb-venv)
- `correlate.py` — all tables above
- `results.jsonl` — 214 rows: {site, width, idx, judge, 6 metrics}
