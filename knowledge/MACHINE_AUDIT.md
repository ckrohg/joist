# Machine Audit — why the cloner isn't producing 1:1, and what to fix

> Written 2026-06-01 after the live Stripe clone was *still* broken (green gradient subhead, overlapping text, layout breaks) despite a "green = 0" local result. The honest trigger: **that result was a local HTML preview I never deployed — I validated on a proxy while the real machine still produced garbage.** This audits the MACHINE (my skills + process), not the Stripe example.

## 0. The brutal reckoning (own this first)

Three failures the user named, restated honestly:
1. **I don't yet build Elementor correctly.** The live page overlaps, the subhead renders the gradient-fallback green, the layout breaks — even after source-verified research handed me the exact keys/gates. So either the deploy path has bugs the preview hid, or I'm mis-applying the mechanics. Skill gap, real.
2. **The grader passes garbage.** It reported `fontFamily PASS`, `structural 0.5`, etc. on pages a human instantly sees are broken. A measure that green-lights this is worse than no measure — it manufactures false confidence. Process gap, critical.
3. **The 1:1 loop doesn't converge.** I patch symptoms, validate on proxies/stale deploys, trust a lying grader, and burn the write quota — so the "perfect to 1:1" cycle never actually closes.

The deepest one, which caused this exact moment: **PROXY ≠ REALITY.** I repeatedly declared success on a local HTML preview or a stale deploy instead of the actual live Elementor page. The HTML proxy is not what Elementor renders. **Every claim must be made against the real deployed Elementor page, screenshotted, and graded — nothing else counts.**

## 1. The machine — everything it does (the pipeline)

```
SOURCE URL → [1 CAPTURE] → [2 REPRESENT/BUILD] → [3 DEPLOY] → [4 GRADE] → [5 ITERATE] → 1:1
```

| # | Step | What it should do | What I actually built |
|---|---|---|---|
| 1 | **Capture** | Read the source's true rendered appearance + geometry + assets faithfully | capture-fx / clone-v2 capture: computed style + bounding rect + rasterize-classify; effect-aware (gradient/fonts) |
| 2 | **Represent/Build** | Turn capture into a clean, faithful, editable Elementor element tree | clone-v2: faithful absolute layout + rasterized display text + native keys/gates + embedded fonts |
| 3 | **Deploy** | Publish to the live WP/Elementor page via the plan API | jp() create→approve→execute, paced + 429 retry |
| 4 | **Grade** | Measure fidelity HONESTLY against the source, gate the loop | honest-grade: per-region×viewport, MIN, DOM hard-fail gates, vision crops |
| 5 | **Iterate** | Build→deploy→grade→fix-worst→repeat until the grader AND the eye agree | (never reliably closed) |

## 2. Gap analysis — per step (skill vs process, with evidence)

### Step 1 — CAPTURE  ·  state: ~OK, with holes
- **GAP (skill):** `getComputedStyle` can't read effected paint (gradient text → fallback green). *Mitigated* by rasterizing display text/effects, but the classifier is heuristic (≥30px) and untuned across sites. **Severity: med.**
- **GAP (skill):** doesn't capture effect-bearing *containers* (card shadows) — only text/img/svg leaves. **Severity: med.**
- **What's needed:** rasterize-classification driven by *comparing computed color to actually-painted pixels* (sample the screenshot at the element box), not a px-size heuristic; capture container backgrounds/effects as boxes.

### Step 2 — BUILD  ·  state: BROKEN on the live artifact  ·  **highest-severity skill gap**
- **GAP (skill):** the live Elementor page overlaps and breaks even though the local HTML proxy looked fine. Evidence: live subhead green + overlapping "Flexible solutions/Grow your business" text. **I do not actually know how my emitted JSON renders in Elementor** — I've been inferring from a non-equivalent HTML proxy. **Severity: critical.**
- **GAP (process):** absolute-positioning everything via injected CSS is brittle and fights Elementor; I haven't verified the *rendered* result of each construct (heading widget vs the box, line-height, the `czimg` rule, z-index) in the real editor.
- **What's needed:** (a) **stop using an HTML proxy as the validation surface** — build small, deploy, and inspect the REAL Elementor DOM/screenshot to learn how each construct renders; (b) genuinely master the handful of constructs I use (heading/text-editor/image/container + the gates + position) by *observing the live render*, not assuming; (c) likely simplify — fewer, well-understood constructs beat many half-understood ones.

### Step 3 — DEPLOY  ·  state: works but rate-limited + path-divergent
- **GAP (process):** the deploy path emits different code than the preview path, so "preview good" ≠ "deploy good" (the green-not-deployed trap). **Severity: high.**
- **GAP (process):** write-quota exhaustion (~30 deploys/session) repeatedly breaks the loop.
- **What's needed:** ONE build path that is the SAME thing I verify; pace/batch writes; reuse one page with a wipe; never declare a result without the deploy succeeding (execute 200) AND screenshotting it.

### Step 4 — GRADE  ·  state: NOT TRUSTWORTHY  ·  **must fix FIRST**
- **GAP (process):** passes garbage — `fontFamily PASS` while glyphs are fallback (checks the *name* not the rendered glyph); doesn't reliably catch the green (it's a "color" to ΔE unless region-sampled right); didn't flag overlapping text; graded proxies/wrong artifacts. **Severity: critical — this is the measure; if it lies, nothing converges.**
- **What's needed:** the grader must (a) ALWAYS run on the live deployed page screenshot; (b) detect **font-fallback by rendered glyphs** (render a known string in the claimed font vs a fallback and compare), not the family string; (c) detect **gradient-fallback green / wrong text color** by sampling painted text pixels vs source; (d) detect **overlapping / out-of-bounds boxes**; (e) per-region perceptual that actually tanks on a broken region; (f) a vision pass that must enumerate defects. Until the grader's number matches an honest eye on a basket of pages, it is not trusted and no build claim is valid.

### Step 5 — ITERATE  ·  state: never closes
- **GAP (process):** no tight loop on the REAL artifact; I hand-build variants, eyeball proxies, and trust a lying grader. **Severity: critical.**
- **What's needed:** an automated loop: build → deploy (verify execute 200) → screenshot LIVE → grade (trusted) → fix the single worst defect → repeat, write-frugally, until the grader + eye agree. No proxies in the loop.

## 3. The systemic meta-gaps (the real problem)

1. **Proxy ≠ reality.** I validate on local HTML / stale deploys. → *Always verify the live deployed Elementor page.*
2. **The grader is not ground truth.** → *Fix it first; it must catch font-fallback, wrong color, overlap, layout drift, per-region, and agree with the eye on a basket before anything else is trusted.*
3. **No closed convergence loop on the real artifact.** → *Build the loop; gate it on the trusted grader.*
4. **Insufficient Elementor skill** (real-render understanding). → *Learn by observing the live render of each construct, not by assuming from docs/proxy.*
5. **Write-frugality.** → *One build path, paced writes, reuse+wipe one page, deploy only to verify.*

## 4. What's needed for 1:1 — the fix-the-machine plan (priority order)

**Do NOT build more example variants until the machine is trustworthy.** Order forced by dependency:

- **P0 — Make the grader GROUND TRUTH (+ always grade the LIVE page).** Add: rendered-glyph font check; painted-text-color check (catches green); overlap/out-of-bounds detection; per-region perceptual that tanks broken regions; mandatory vision-enumerate. *Done = on a basket of deliberately-broken and known-good pages, the grader's verdict matches an honest human eye every time. This is the keystone.*
- **P1 — Kill proxy≠reality.** The ONLY validation surface is the live deployed Elementor page, screenshotted and graded by P0. Delete reliance on the HTML preview for *claims* (keep it only as a fast pre-deploy sanity check, never as the verdict).
- **P2 — Diagnose & fix BUILD correctness in real Elementor.** Deploy minimal probes (one heading, one positioned box, one image) and *inspect the live render* to learn exactly how each construct behaves (line-height, box, z-index, font, position). Fix the overlap/green/layout at the source. Master the few constructs I use by observation.
- **P3 — Close the convergence loop** on the live artifact, write-frugal, gated on P0.
- **P4 — Then, and only then, push specific examples** (Stripe + basket) through the trusted loop to 1:1.

## 5. Honest verdict
The machine has the right *ideas* now (faithful capture, rasterize effects, clean keys/gates, an honest-grader design) but is **not trustworthy end-to-end** because I validate on proxies and the grader lies. **Fixing the grader to be ground truth — and only ever judging the live deployed page — is the keystone.** Everything else (build correctness, the loop, Elementor skill) becomes measurable and fixable once the measure is honest and pointed at reality. Until then, every "win" is suspect, exactly as this session has shown.
