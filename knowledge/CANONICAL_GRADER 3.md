# Canonical Grader (grader of record)

> The ONLY trusted way to judge a clone. Three layers: a validated deterministic STATIC floor + a deterministic DYNAMIC floor + an adversarial vision committee. Always graded against the **live deployed page**, never a local HTML proxy. Supersedes `grade.mjs` and `honest-grade.mjs` (deprecated — do not use).

## Why this exists
Every prior grader flattered itself (pixel-% at a lenient threshold; checked font *names* and *computed* values that lie). The canonical grader judges **painted reality** (deterministic) and **element-by-element fidelity** (vision committee), and its score is provably honest — its verdict matches an honest human eye on a known basket, and an adversarial committee enumerates every flaw a designer would see.

## What it covers (the full layer set)
**STATIC (`grader-v2.mjs`, all MIN-aggregated, all painted-reality):**
- `perceptual` — per-region shift-tolerant SSIM + LAB ΔE (wrong font glyphs, broken regions)
- `textRender` — matched-text-box glyph-SSIM (catches wrong font even when names lie)
- `textColor` — painted-text-color ΔE per matched region (catches the green-headline gradient-fallback)
- `geometry` — **median IoU of matched text boxes, normalized to each page** (catches "present but mispositioned" — an element with right glyphs/color in the wrong place)
- `content` — **set-diff of source-vs-clone text strings** (catches whole MISSING sections deterministically, even when the gap aligns with whitespace)
- `layout` — overlap / out-of-bounds from the clone DOM
- blank/empty gate

**DYNAMIC (`dynamic-grade.mjs`, MIN-aggregated):**
- `motion` — time-lapse inter-frame diff at rest + `document.getAnimations()`/CSS-animation/infinite-loop counts → **motion-presence GATE**: source clearly moves (animated gradient/WebGL wave, marquee, auto-carousel, ticker) but clone is dead → fail
- `scroll` — source-vs-clone perceptual at N scroll depths (scroll reveals, parallax, sticky, scrolling banners)
- `hover` — does the clone react to hover/focus on the interactive elements where the source does?
- Emits committee MONTAGES: `scroll-*.png` (depth pairs) and `hover-*.png` (before|after, source row over clone row)

**VISION COMMITTEE (`committee-grade.mjs`)** — element-by-element adversarial review of all of the above, now including a `motion` dimension when dynamic montages are supplied.

## The pipeline (run in this order, on the LIVE deployed URL)

1. **Self-test BOTH deterministic floors (regression gate):**
   `node grader-v2.mjs --validate` → MUST print "✅ GRADER IS TRUSTWORTHY" (static basket: known-good + deliberately-broken).
   `node dynamic-grade.mjs --validate` → MUST print "✅ DYNAMIC GRADER IS TRUSTWORTHY" (7-case basket isolating each gate with negative controls: motion good/dead/static, hover good/missing, scroll good/broken — proves all three gates fire AND don't false-fire). If either is red, the grader is broken — fix before trusting any score.

2. **Deterministic STATIC floor** (fast, provable hard-fails — green text, wrong font glyphs, overlap, blank, missing-content, geometry, per-region perceptual):
   `node grader-v2.mjs --source <live-source> --clone <live-clone> --out gv2` → gives `overall_pct` (the static FLOOR) + hard-fails.

2b. **Deterministic DYNAMIC floor** (motion-presence gate + scroll/hover fidelity; produces committee montages):
   `node dynamic-grade.mjs --source <live-source> --clone <live-clone> --out dyn` → `dynamic_overall` + hard-fails (`motion-missing`/`scroll-state`/`hover-missing`) + `scroll-*.png`/`hover-*.png` montages. The combined deterministic floor = **MIN(static overall_pct, dynamic_overall)**.

3. **Committee artifact prep:**
   `node committee-grade.mjs --source <live-source> --clone <live-clone> --out cm` → captures source+clone at desktop/tablet/mobile + 8 per-section SIDE-BY-SIDE crops + `manifest.json` (with the harsh rubric).

4. **Adversarial vision committee (≥3 independent reviewers):** spawn N vision agents (Agent tool). Each one Reads the `pair-{desktop,tablet,mobile}.png` + several `section-*.png` + the dynamic `scroll-*.png`/`hover-*.png` montages, and applies `manifest.committee_rubric` — review ELEMENT BY ELEMENT (nav, hero, every section, footer: presence, alignment, spacing, typography, color/gradients, effects, responsiveness) AND motion/interaction, **enumerate every defect first, then score loss-framed (start 100, subtract), default-to-worse**. Each returns strict JSON `{overall_pct, dimensions{alignment,spacing,typography,color,imagery,responsiveness,motion,completeness}, defects[], verdict, worst_section}`. Save the array to `verdicts.json`.

5. **Aggregate (deterministic):**
   `node committee-grade.mjs --aggregate verdicts.json --floor <combined deterministic floor>` → final verdict: **per-dimension MIN** across reviewers, **overall = MIN(reviewer overalls, deterministic floor = MIN(static, dynamic))**, **confirmed defects = flagged by ≥2 reviewers**, plus the full defect list. **PASS only if overall ≥ 75 AND every reviewer PASS.**

## Hard rules
- **Live only.** Grade the deployed Elementor page (screenshot), never a local HTML preview. A preview is at most a pre-deploy sanity check, never the verdict.
- **MIN, never mean.** One broken region/dimension/reviewer tanks the score.
- **The defect list is the deliverable** — it doubles as the build punch-list (fix confirmed defects first).
- **PASS bar:** a designer comparing the two tabs could not quickly tell which is the clone.
- **Don't trust the number while `--validate` is red.** Re-run the self-test after any grader change.

## The defect→lesson flywheel (shrinks build cycles)
The grader's job isn't just to score — it's to make the builder better so fewer cycles are needed. `eval/grader/lessons.json` is the ledger: each defect class → root cause → builder rule → an automated GUARD. `eval/grader/lessons.mjs`:
- **`--audit`** runs every guard against the build artifacts (capture / IR / `--dry` tree) **before deploy, for free**. A guard failing on a *fixed* lesson = REGRESSION (blocks deploy, exit 1); a guard failing on an *open* candidate = known gap (informational). This is the lever: solved defects can't silently come back, and you never spend a deploy+grade cycle rediscovering them.
- **`--classify <grade reports>`** maps a fresh grade's defects to the ledger → RECURRENCE (apply the known rule, no re-diagnosis) vs NEW (candidate lesson — where the next learning is). Run it on a POST-fix grade so a match means a real regression.

**Pre-deploy sequence:** `build-ir-elementor --dry` (dumps tree) → `lessons.mjs --audit` (must be green) → `build-ir-elementor --page <id>` (deploy) → grade → `lessons.mjs --classify`. Seeded lessons: text-color-lie (green headline), pill-buttons, full-bleed→bg, gradient-text-preserve, _css_classes-on-containers, line-height-inflation; open candidates: layout-shift, hover-states.

## Files
- `eval/grader/grader-v2.mjs` — deterministic STATIC floor (perceptual/textRender/textColor/geometry/content/layout) + `--validate` regression basket.
- `eval/grader/dynamic-grade.mjs` — deterministic DYNAMIC floor (motion-presence gate + scroll/hover; motion sampled at every scroll depth, not just the hero) + committee montages + built-in `--validate` self-test basket (mover/dead/static synthetic pages).
- `eval/grader/committee-grade.mjs` — artifact prep + `--aggregate` (per-dim MIN incl. `motion`).
- `eval/grader/perf-grade.mjs` — non-visual layer: performance (TTFB/LCP/CLS/load/weight/requests) + integrity (console errors, failed requests, broken images), source-vs-clone.
- `eval/grader/a11y-grade.mjs` — accessibility: WCAG contrast + alt + semantics (landmarks/lang/h1/heading-order).
- `eval/grader/responsive-grade.mjs` — horizontal-overflow sweep across 9 viewport widths, source-vs-clone.
- `eval/grader/interaction-grade.mjs` — click-to-reveal probing (tabs/accordions/dropdowns/menus), source-vs-clone.
- `eval/grader/eval-all.mjs` — autonomous cycle driver: runs every layer → composite (MIN) → self-learn → worklist. See `knowledge/FLYWHEEL_AUTONOMY.md` for the L0–L5 autonomy ladder.
- `eval/grader/lessons.json` + `eval/grader/lessons.mjs` — the defect→lesson flywheel (`--audit` pre-deploy guard gate incl. `--perf`, `--classify` defect router, `--tips` Elementor build knowledge).
- `knowledge/EVAL_COVERAGE_MAP.md` — the full ~48-dimension coverage taxonomy (HAVE/PARTIAL/MISSING); the harsher-critic roadmap. Eval is NOT 100% — this map is the honest scoreboard.
- DEPRECATED: `eval/grader/grade.mjs`, `eval/grader/honest-grade.mjs` (flattered themselves; kept only for history).

## Proven
On the live `stripe-full-page-precision-v4` clone vs real Stripe: 3-reviewer committee → unanimous **FAIL, overall 58%**, responsiveness 35 / color 45 / typography 50, confirmed defects = wrong CTA treatment, missing logo strip, broken mobile; single-reviewer-but-real = missing dark stats section, white-bar/empty-box artifacts, washed gradients, vertical-rhythm inflation, purple cast. That defect list is now the build punch-list.
