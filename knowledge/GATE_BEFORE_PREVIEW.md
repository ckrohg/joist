# Gate-Before-Preview: the Direction-A deploy spine

**Status (2026-06-20):** built + offline-proven; **live execution is WP-gated.** This doc maps the architecture so the
live wiring is a one-command run when a guarded WordPress instance returns.

## Why this exists

From the Emergent teardown (`memory/emergent_teardown.md`): the transferable lesson was their **self-healing QA loop
that gates the preview** — nothing is shown until automated + vision verification passes, with the agent autonomously
root-causing and re-fixing. A `/fusion` panel (CONVERGENT) ratified an **A→B plan**: build the gate-before-preview
reliability spine **first** (Direction A, a *floor* play — raise the corpus minimum + cut veto-rate), then promote the
preserve/custom-CSS ceiling arm (Direction B) gated strictly behind it. This is Direction A.

Guiding objective (`memory/motor_cortex_floor_lens.md`): optimize the corpus **MINIMUM + veto-rate** (the "always works"
floor), **not** the mean.

## The pipeline

```
 build clone ──▶ grade-structure ──▶ GATE ──────────────────────────────────────▶ publish | hold
 (build-absolute)   (report.json)     │
                                       ├─ fired veto? ──no──▶ publish
                                       ├─ has a registered healer? ──no──▶ HOLD
                                       ├─ heal (self-heal loop, deterministic + revert-on-reject)
                                       ├─ RE-CHECK (authoritative re-grade against the FROZEN source)
                                       │     └─ any catastrophic-static veto still fired? ──yes──▶ HOLD
                                       └─ publish  (+ correspondence score as INERT corpusBar metadata)
```

The gate is **BINARY + THRESHOLD-FREE**: it owns zero acceptor thresholds (those live inside each self-heal loop). Its
only bar is the calibration-independent **veto-floor** (zero catastrophic-static defects post-heal). `liveValidated`
rides on every decision as **metadata, not a third routing outcome**.

## Components (all in `eval/grader/`, all with `_*-selftest.mjs`)

| File | Role | Key contract |
|---|---|---|
| `veto-detectors.mjs` | The 4 catastrophic-static detectors (wrong-logo, invisible-heading, broken-hero, unstyled-CTA) | `runVetoes(ctx) → {fired[], all[]}`; deterministic, no LLM |
| `gate.mjs` | The pre-preview gate (outer routing) | `gate(report, registry, hooks) → {decision, actions[], liveValidated, corpusBar?}` |
| `cta-heal.mjs` | Self-heal loop for unstyled-CTA (the one built loop) | `healUnstyledCTA(ctx) → {healed[], rejected[], refused[], unmatched[], nullPaint[]}`; **trigger ≠ acceptor** |
| `cta-paint.mjs` | Shared CTA paint (build ≡ heal) | `buttonPaint(leaf, opts)`; byte-identical to build-absolute (proven) |
| `cta-render-crop.mjs` | Live crop+SSIM confirm for the CTA acceptor | `makeRenderAndCrop({srcCapturePng, screenshotFn})`; injectable screenshot |
| `cta-heal-sweep.mjs` | Live 7-site sweep scaffold | degrade fixtures + CONTROL A/B + pass-bar verdict (WP-glue injected) |
| `correspondence-reward.mjs` | Deterministic $0 element-correspondence reward (the "anchor") | `gradeCorrespondence(srcTree, cloneTree) → {score, axes}`; hash-bound, no LLM |
| `bestofn-select.mjs` | Listwise selector | `bestOfNCorr(...)` selects argmax-correspondence candidate |
| `live-gate.mjs` | **Live wiring** — composes the gate with real WP/grade/capture hooks | `runLiveGate(cfg, deps)`; built offline, executes live |

## The two anti-Goodhart properties that make it trustworthy

1. **TRIGGER ≠ ACCEPTOR** (in each self-heal loop). The CTA loop's trigger is a value-free saturation tripwire; its
   acceptor is source-anchored ΔE2000 + geometry + a hard editability cheat-guard. Disjoint channels → a fix can't pass
   by merely clearing the trigger. Proven by CONTROL B: a *wrong-but-saturated* repaint (which clears the binary veto)
   is **rejected** by the acceptor.
2. **AUTHORITATIVE RE-CHECK against the FROZEN source** (in the gate). After heal, the gate re-grades and publishes only
   if zero catastrophic-static vetoes fire — catching post-heal collateral too. The re-check uses the build's **frozen
   source cache** (not a live re-fetch), so it (a) can re-fire the healed veto, (b) is reproducible, (c) can't drift from
   the build (`source_ab_nondeterminism`).

## Soundness traps (and their guards) — read before wiring live

- **Source A/B drift** → recheck against the frozen source cache (`live-gate.seedFrozenSource` → `/tmp/grade-src-cache/<srcTag>.{json,png}`), never a live re-fetch, never a bare PNG (bare PNG returns empty `ctaRuns` → the unstyled-CTA veto self-disables → publishes broken).
- **Signal-absent ≡ "cleared"** (the publish-broken hole) → `live-gate.readRecheckReport` measurement-presence guard: for every veto we can heal, require live signal on BOTH sides on recheck; if absent/degenerate (`cloneCtas:0`), inject a synthetic `*-unmeasured` fired veto → HOLD.
- **Double-capture divergence** (heal's crop vs the recheck's independent screenshot) → harmless: divergence can only make the recheck re-fire → HOLD (conservative). Optional settle before recheck reduces false holds.
- **Fail-closed everywhere** → empty-ctaRuns bundle, missing/stale cache, recheck exec/parse failure all resolve to HOLD, never a silent publish.

## Why the continuous bar is INERT (and stays that way until WP)

`gate.mjs`'s `corpusBar` consumes the **correspondence** score (per G5: *not* the grade-structure composite — that stays
the headline/ceiling), but `enforceCorpusBar` defaults **false**. Evidence (`_correspondence-xval-stats.mjs`, pure stats):
the single-site Spearman-vs-vision is 0.714 but **significant-yet-imprecise** (exact permutation p=0.044; bootstrap 95%
CI **[0.036, 1.000]**); clean-only Spearman is **0.543** (fine-ranking among good candidates is weak); the *trustworthy*
signal is **broken-vs-clean separation** (22.6 pt margin) — which the **binary** veto floor already owns. So enforcing a
continuous bar on single-site evidence would manufacture false HOLDs. The reward's generalization across layout shapes
IS validated (`_correspondence-xval-corpus.mjs`: 4 archetypes, catastrophic-last) — but **cross-SITE** correlation needs
freshly-built clones = WP-gated. Flip `enforceCorpusBar` only after pooled Spearman-vs-vision across ≥3 real sites lands.

## What's left (all WP-gated)

1. Live CTA self-heal sweep **through the gate** (`cta-heal-sweep.mjs` + `live-gate.runLiveGate`): heal-rate ≥6/7,
   CONTROL-B reject 7/7, editability 7/7.
2. Build-absolute `buttonPaint` → `cta-paint` swap is **done**; the `joist-ctapaint-{pageId}.json` sidecar call-site
   (post-`applyAncestorChrome`) still needs wiring + a real build (`memory/cta_selfheal_step1.md`).
3. Cross-site reward correlation + the `enforceCorpusBar` flip.
4. Fan out self-heal to the other 3 catastrophic-static veto classes (premature until the live CTA sweep calibrates the
   pattern — `/fusion` ranked it after the live sweep).

## Run the offline suite

```
cd eval/grader
for t in _cta-paint-equiv _cta-heal-selftest _cta-render-crop-selftest _cta-heal-sweep-selftest \
         _gate-selftest _live-gate-selftest _correspondence-selftest _correspondence-xval-corpus \
         _correspondence-xval-stats; do node $t.mjs; done
```
