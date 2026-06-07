# Discovery Gap Map

> **DISCOVERY WAVE 4 synthesis.** Objective FLIPPED (round 40): visual = 0.5·SSIM + 0.5·perElement;
> perElement = 0.35·color[CIEDE2000] + 0.25·typo + 0.20·position + 0.20·text, each × symmetric
> areaCoverage. composite = 0.4·visual + 0.3·editability + 0.3·structural. Honest corpus mean **~0.768**
> across 7 sites (tailwind / supabase / resend / framer / linear / vercel / reactdev), 12 recipes kept.
> Verified research: POSITION (human-corr 0.76) and areaCoverage/block-match (0.74) DOMINATE; COLOR moderate
> (0.35); TEXT is a NEGATIVE predictor (−0.35). Favor position + areaCoverage; do NOT chase text fidelity.
> The OLD wave-3 "visual is saturated / don't propose color" stance is OBSOLETE — color is now the productive
> axis. (Wave 1 kept 2/6, wave 2 2/3 — impact claims below are down-weighted; every keep gates on a re-grade.)

## Honest summary — where the clone stands per dimension

The build side places, fonts, and re-hosts what capture hands it nearly losslessly; the residual loss is
now almost entirely upstream (capture fidelity + a handful of build-side seams the FLIPPED metric exposed),
and bimodal by site type. **Color (0.42) is the corpus floor and the single biggest movable lever**:
light-theme sites sit at 0.50–0.60, but the dark/gradient React cluster (linear 0.24, vercel 0.21,
reactdev 0.28) collapses because `build-absolute.mjs:collectBg` reads only `n.background` and **never
`n.bgSampled`** — yet the grader scores color `bgSampled > background.color > bg` (perelement-score.mjs:219)
and **63% of linear / 49% of vercel containers carry color ONLY via `bgSampled`**. Those areas paint
transparent → fall through to Elementor white → ΔE explodes over ~60% of the page. The build-side
*computed-bg* color vein is genuinely EXHAUSTED (r46 audit: collectBg already emits for every
`background.color`/gradient container); this `bgSampled` seam is a different, untouched code path.
**Typography (0.78)** is good where matched (real fonts hosted + resolved correctly); the one true bug is
`gFont`'s unanchored `/serif/` test matching `sans-serif`/`ui-sans-serif` → Georgia, serifing ~70% of
framer's text. **Structural (0.62)** is clean where coverage is high (tailwind/linear/vercel ≥0.90) but
collapses on resend (0.444) / framer (0.575): the mockup raster gate (capture-layout.mjs:281)
short-circuits BEFORE the tabs/list detectors with only a `hasEmbeddableVideo` escape hatch, rasterizing
whole interactive widgets; capture also has **no `kind:'table'` emit path at all** while the grader counts
`<table>` blocks (grade-sections.mjs:88). **Image (0.74)** loses on standalone `<img>` aspect: `objectFit`
is captured (L175) but the build image branch (build-absolute.mjs:82) emits width-only, so cover-fit heroes
(71/95 framer, 11/33 tailwind) render at wrong height → high-ΔE bands + downstream drift. **Position
(raw 0.87–0.98, reported 0.32–0.43)** and **text/editability (per-element 0.35–0.50 on the React sites)**
are ~90% a *coverage* artifact (position = posRaw × areaCoverage) — the builder places what it has nearly
pixel-exact. The dominant coverage loss is the deep-leaf wall owned by the supervised container-inference
flow; the one piece addressable here is the code-block flatten shred (capture-layout.mjs:463-466 re-runs
list/tabs rescue but NOT the code detector → token-shred + 40-cap truncation).

## Ranked fixes

| Rank | Dimension | Fix | File | Expected lift | Confidence | Risk |
|------|-----------|-----|------|---------------|------------|------|
| 1 | Color / background | `collectBg`: add a final `else if (n.bgSampled) bgRectSolid(n.box, n.bgSampled)` branch (reuses the proven r44 solid-bg + probe-child path) so sampled-only containers paint; set root container `background_color = root.bgSampled ‖ root.background.color` as a page-level dark floor. Skip emit when `bgSampled` ≈ page default (ΔE<3) to avoid redundant rects. | build-absolute.mjs | linear/vercel/reactdev color 0.24→~0.50; corpus color 0.42→~0.52; composite **+0.03–0.05** | high | low–med |
| 2 | Structural | Extend the `hasEmbeddableVideo` short-circuit (capture-layout.mjs:276) to `hasStructuralWidget`: if subtree has `[role=tablist]`/≥2 `[role=tab]`, OR `<table>` w/ ≥2 `tr`, OR `<ul>/<ol>` ≥3 direct `<li>` not-in-nav, OR ≥2 accordion triggers → do NOT rasterize, fall through to recursion. Mirror the exact predicates the grader counts (grade-sections.mjs:88-90). | capture-layout.mjs | resend structural 0.444→~0.67, framer list 6→7; corpus structural +0.03; **secondary coverage lift** on resend (0.13→higher) multiplies into color/pos/text → likely the larger win | high | low–med |
| 3 | Image / asset | Image branch: when captured `objectFit==='cover'\|'fill'`, emit an `html` widget `<div w×h overflow:hidden><img style="width:100%;height:100%;object-fit:cover;object-position:center"></div>` (mirrors the proven kses-safe video path) instead of width-only native image; keep the native `image` widget for contain/none/scale-down. Gate strictly on captured objectFit (no-op otherwise). | build-absolute.mjs | framer visual +0.04–0.07, tailwind +0.03–0.05 on hero/card bands; secondary position gain from removed downstream vertical drift | high | low |
| 4 | Editability / coverage | In the `depth>=MAXD` flatten block, add a code-block rescue pass (mirror the list/tabs rescue): for `pre,[class*=code],[class*=highlight]` with `monoTextFrac>=0.6 && cleanText>=20`, emit ONE `kind:'code'` node whole + mark descendants in `inCode` so the flat-leaf loop skips them. Collapses ~59 leaked token-leaves → frees the 40-cap budget for surrounding prose. | capture-layout.mjs | reactdev coverage 0.23→~0.55, text/pos sub-scores 0.375→~0.65; composite **+0.05–0.08** on reactdev, smaller on vercel | high (mechanism) / med (magnitude) | low |
| 5 | Typography | `gFont`: short-circuit CSS generics first — `if (/^(ui-)?sans-serif$\|^system-ui$/.test(b)) return 'Inter'` BEFORE the serif test; make the `REGFONTS` lookup in `nativeTypo` case-insensitive (lowercase index). | build-absolute.mjs | framer typo 0.583→~0.69 + small framer pos/SSIM gain; corpus composite +0.01–0.02 (framer-concentrated), eliminates an embarrassing serif-on-sans tell | high | low |
| 6 | Position (centroid) | `absPos`: add captured HEIGHT (`_element_custom_height:{px,box.h}` + the height analogue of `_element_width`), gated to multi-line leaves (`box.h > 1 line-height`), vertical-center not top-clip. Makes clone leaf center-y match source by construction → raw position ~1.0 on text leaves. | build-absolute.mjs | raw position +0.06–0.10 on text-dense sites; reported position +0.01–0.03 after coverage multiply; corpus composite +0.01 | med | med (`_element_custom_height` honoring on absolute Elementor widgets unverified on this stack) |

### De-duplication notes
- **Three lenses converge on the capture flatten / mockup gate** (color via bgSampled is the exception). Split by mechanism: rank-2 = mockup-gate swallow of structural widgets (resend), rank-4 = code-block shred + 40-cap in the deep flatten (reactdev/vercel). Both are capture-side autonomous, but distinct code regions and distinct site victims — kept separate for clean attribution.
- **Color lens vs the exhausted build-bg vein:** rank-1 is explicitly NOT a re-proposal of solid/gradient bg emit (r46 proved that exhausted). It wires the *sampled* color the grader already scores but the builder never reads — a verified, untouched seam.
- **Image lens's "missing videos / dropped table" half is NOT this fix** — that's capture-coverage on client-rendered React (capture-stability vein). Rank-3 is the *aspect* half only, which is independently correct and surgical.
- **Position lens is mostly a coverage restatement** (reported/coverage ratio 0.91–0.99 corpus-wide). Rank-6 is the genuine ~10% centroid-drift residual; deliberately ranked last because coverage caps the gain on the very sites that score worst.

### Not re-proposed (out of scope / owned elsewhere / exhausted)
- More build-side solid/gradient/`background.color` emit — EXHAUSTED (r46 audit).
- Cramming more absolute nodes for the deep-prose coverage wall (linear/vercel/reactdev prose below MAXD) — owned by the supervised container-inference flow builder; r42 proved more absolute nodes regress via overlap/clutter.
- framer's 9 dropped videos / resend's dropped table *content* — capture-coverage on client-rendered React (capture-stability vein).
- Per-character text shred (vercel "S t a r t  D e p l o y i n g") and the nested-tablist `tightest`-guard miss (resend y=1976/2119) — real but low-yield; defer.
- Chasing text fidelity directly — verified NEGATIVE human-correlation (−0.35).

### Open gap worth a dedicated follow-up round (not in top 6)
Capture has **no `kind:'table'` node** and the builder has **no table widget**, yet the grader counts
`<table>` blocks (grade-sections.mjs:88). Rank-2 stops rasterizing tables but does not *emit* them, so
resend's table stays a structural miss. A small dedicated round — capture `<table>`→`kind:'table'`, build
→ native `text-editor` `<table>` HTML (kses-safe, same family as the list path) — closes it. Low frequency
(1 site), so it sits below the top 6; run only after rank-2 lands clean.

## Recommended next rounds (run first, in order)

All four leading fixes are build- or capture-autonomous. **No grader-side (3-file, self-test=1.0) round is
recommended this wave** — the r46 audit validated the grader's color/coverage matching as correct, so the
loss is real, not a grader artifact. Run each as its own attributable round, gated on a corpus re-grade
with no per-site regression. Ranks 2 and 4 touch the same `capture-layout.mjs` region — sequence and
re-grade between them.

1. **Round A — bgSampled background fallback (rank 1, build-absolute).** Single biggest FLIPPED-objective lever: paints the heaviest term (color 0.35) over the ~60% of dark-site area currently scoring zero. Self-evident mechanism, low regression (z0 under all foreground, the same property that made r44 safe). Gate: linear/vercel/reactdev color up, light sites unchanged.
2. **Round B — mockup-gate structural short-circuit (rank 2, capture).** Recovers whole interactive widgets AND lifts resend's catastrophic 0.13 coverage — likely a larger downstream win than its headline structural number. Gate: resend tabs/list counts up, structFidelity up; regression check on supabase/vercel lists-in-cards.
3. **Round C — image object-fit cover (rank 3, build-absolute).** Surgical, isolated to `kind:'image'` cover-fit leaves; fixes the two worst-visual media sites (framer/tailwind) with near-zero blast radius.
4. **Round D — code-block flatten rescue (rank 4, capture).** De-shreds reactdev/vercel code editors and frees the 40-leaf cap so surrounding prose survives — the single biggest editability/coverage lever on the React cluster.

Ranks 5 (typo regex) and 6 (absPos height) are cheap, low-blast-radius cleanups to fold in opportunistically behind the four above; both are framer/text-dense-concentrated modest movers. Hold the `kind:'table'` round until rank-2 lands clean.
