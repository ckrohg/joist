# PATH TO TRUE 1:1 — V3: reward-autonomy first

**Date:** 2026-06-20 · **Status:** plan for review · **Supersedes** the *sequencing* (not the analysis) of
`PATH_TO_TRUE_1TO1_V2.md`. The V2 reward thesis (deterministic element-correspondence, gate→anchor→selector)
is intact and largely BUILT; V3 decides what to do **next** now that the spine exists and the local WP sandbox
is up.

**Provenance:** repo-verified state review + a `/fusion` panel (3 legs — Opus, Sonnet, GPT-5.5; Gemini leg died)
that returned **CONVERGENT (high confidence)** — both cross-vendor judges independently preferred the same
answer. The verdict is relayed verbatim in §4 and folded into the workstreams.

---

## 0. TL;DR — the one move

**Make the reward trustworthy enough to retire the per-build human LOOK — and pay for it with the breadth
builds you're already producing.**

The flywheel's entire premise is "a reward you can trust without looking every time," and the binding resource
is **one human reviewer**. Reward-autonomy is the only next move that *elevates* that constraint instead of
consuming it, and it is **nearly free** because the generalization test already generates the builds it needs.

The sharp insight from the panel: **rewire what each LOOK spends on.** Today a human LOOK answers *"is this clone
good?"* — disposable QA that evaporates. Rewired, the same LOOK on the same build also answers *"does the reward
agree with me?"* — a permanent (reward-score, human-verdict) calibration pair. Same builds, same minutes, but they
**compound into autonomy** instead of vanishing.

Then flip **only the binary broken-vs-clean half** of the gate to enforce (the part with the trustworthy 22.6-pt
separation margin); keep the continuous fine-ranker advisory until its cross-site CI tightens. Guard it with a
permanent known-broken negative control that **halts the flywheel** if it ever passes.

---

## 1. Progress to date — what is genuinely proven

| Claim | Evidence (verified) |
|---|---|
| **1:1 + truly editable is real on a flagship** | resend projection build passed a *real* editability audit (`editability-audit.mjs`): 473 native editable widgets, 49 html-widgets that are ALL svg-icons with **zero** trapped text/layout, and a sentinel panel edit propagated to the frontend (LOOK-verified). supabase absolute build = 0.878 (visual 0.93 / editable 0.83). |
| **The architecture settled** | After two pivots (absolute-positioning → LLM-author → **deterministic source-projection**), the pipeline is: `capture-assets.mjs` (inline computed CSS + @media rules + real assets + true page-bg) → `transpile-html.mjs` (project DOM → native Elementor tree, **no LLM in the core**) → render → grade. Doctrine in `EMBODIMENT_APPROACH.md`: clone = cross-embodiment program induction; grade on rendered outcome, never DOM similarity. |
| **Generalization is starting to hold** | Harness-first test on 2/8 unseen archetypes (linear dark-SaaS, tailwind-docs light-docs). Both initially FAILED; both failures produced **general shipped fixes**: page-bg carry (commit 65d96e7) and multi-column-layout-collapse (c01acc5). Height-blowup is now a confirmed cross-site defect class. |
| **The reward spine is BUILT** | `correspondence-reward.mjs` (deterministic, $0, hash-bound, passes selftest + 4-archetype generalization battery, catastrophic-defect always ranked last). Plus `gate.mjs`, `live-gate.mjs`, `veto-detectors.mjs` (4 catastrophic-static detectors), `cta-heal.mjs` (one self-heal loop, TRIGGER≠ACCEPTOR proven), `bestofn-select.mjs`. All with `_*-selftest.mjs`. |
| **The live target is UP** | Local docker WordPress at **localhost:8001** (31h uptime) is rendering clones now (resend=834, linear=857, tailwind=859). The "WP-gated" label across older docs is **stale** for rendering. |
| **Calibration infra is ready** | `eval/grader/calibration/`: blind `SCORING_SHEET_V2.html` (+ `v2-shots/`), an out-of-sample `HOLDOUT_SHEET.html` + `HOLDOUT_GRADER_KEY.json`, the free degradation `ladders/`, V1 `human-results.json`. |

## 2. Challenges to date — the honest tail

1. **Instruments keep lying (the meta-challenge).** 5–6 times an automated judge scored a *faithful* clone broken
   (a vision model gave a good clone 0/100; SSIM ranked a broken build above three clean ones; pixel rewards are
   fooled by dark-bg dominance). **Every** one was caught only by human/Claude LOOK, never by another metric. The
   key asymmetry: those were all **false-negatives** (good looks broken = GO-SAFE); a wrongful *ship* can only come
   from a **false-positive** (broken looks good). The gate's job is to automate the safe direction and keep the
   human only on the narrow false-positive path.
2. **Reward trustworthiness is built-but-unvalidated cross-site.** Single-site Spearman vs the vision verdict is
   0.714 but imprecise (95% CI **[0.036, 1.000]**); clean-only fine-ranking is weak (0.543); only **broken-vs-clean
   separation** (22.6-pt margin) is trustworthy so far. `enforceCorpusBar` is deliberately **false** until ≥3
   freshly-built real sites validate it.
3. **The reward is anchored to a model teacher, not humans.** `SCORING_SHEET_V2.html` is still **unscored** →
   Goodhart risk (we'd be distilling Claude, not the user's eye).
4. **Responsive — the stated destination — is scoped + sandbox-proven but not live-wired.** A per-breakpoint
   correspondence metric measured a 47.9-pt @media gap on a sandbox fixture; an A/B proved native `_tablet`/`_mobile`
   controls close it (WS5). Projection output today is still desktop-pixel.
5. **Architectural fragmentation.** 4–5 builder lineages survive (projection, absolute, hybrid, raster, server-side
   `CloneGenerator.php`); `clone.mjs`'s auto-router can still fall back to the desktop-only absolute builder.
6. **Product wiring + whole-site.** Still a bench of node scripts, not one invokable agent; clones one page, not a
   multi-page site with shared Theme-Builder header/footer + a Kit.

## 3. Where the binding constraint actually is

The 315-round flywheel history says every plateau was a **measurement ceiling**, and the program's own retro says
the bottleneck is the **one human reviewer** who must LOOK at every build because no instrument can be trusted.
V3 attacks that constraint directly. Everything else (breadth, responsive, product) stays throttled to the
reviewer's serial throughput until a trustworthy reward retires the per-build LOOK.

---

## 4. The fusion verdict (CONVERGENT — both judges, relayed)

> **#1 highest-leverage:** Convert the breadth builds you're already producing into the **cross-site calibration
> corpus** for the correspondence reward — score the blind human sheet first (anchor to humans, not the model
> teacher), then flip **only** the binary broken-vs-clean gate to enforce while the continuous ranker stays
> advisory — because the one human reviewer is the binding constraint, and every other track stays throttled
> until a trustworthy reward retires the per-build LOOK.
>
> **Ranked top 4:** (1) Reward-autonomy + human-calibration as step 0; (2) Breadth builds, explicitly rewired to
> emit calibration pairs (it is simultaneously the defect-class engine *and* the reward's cross-site data);
> (3) Responsive — the destination, but it must follow the reward and rides on desktop layout being solid;
> (4) Consolidation + product — only after projection's cross-site ceiling is proven (productizing on an untrusted
> reward just ships false-positives).
>
> **Biggest risk:** flipping the gate on thin evidence enshrines a *lying instrument* as the autonomous judge —
> the exact meta-failure, now with no human to catch it. **Mitigation — asymmetric autonomy + live negative
> control:** flip only the binary gate (22.6-pt margin); keep the continuous reward advisory; make a known-broken
> fixture a **permanent per-run tripwire** — if it ever passes, the flywheel HALTS and pages the human.
>
> **STOP:** running the absolute-positioning builder as an active router fallback (demote to `--mode absolute`
> only); and optimizing the headline composite against the vision-model teacher until the reward is human-anchored.
>
> **Falsifier (~2 weeks):** across 3–4 fresh unseen sites (include a hard one — forms / dynamic-JS), #1 was wrong
> if (a) a known-broken build scores *above* the binary gate on a fresh site, or (b) pooled broken-vs-clean
> separation collapses toward within-class noise. **Secondary:** if the human turns out *not* to be the bottleneck
> (they can comfortably review every build; the real limit is WP/build throughput), then Responsive (C) should
> take #1.

This matches the independently-derived state review. Confidence is high; the one caveat is the smaller-than-intended
3-leg panel (Gemini died).

---

## 5. The plan — workstreams, sequenced

**Operating constraints (house rules):** ≤2 concurrent tracks; reversible env-flags + byte-equivalent off-paths;
deterministic-metric + LOOK gating; one live WP instance, never parallelize writes within a page; inch-by-inch,
each stage exits on a numeric gate.

### W0 — Human anchor + asymmetric gate (≤3 days; serial, blocks W1) — **START HERE**

The cheapest unlock. Two pieces:

- **W0a — Score the blind sheet (the one action only the user can do).** Open
  `eval/grader/calibration/SCORING_SHEET_V2.html`, score the pairs blind; results become the **human ground-truth
  anchor**. ~15–30 min. Until this exists, the reward is distilling a model, not the user's eye. Pull `v2-shots/`
  forward if any pair is stale.
- **W0b — Asymmetric-autonomy gate.** In `gate.mjs` / `live-gate.mjs`: split the decision so the **binary
  broken-vs-clean veto** can enforce (it owns the trustworthy 22.6-pt margin) while `enforceCorpusBar` (the
  continuous fine-ranker) stays `false`. Add a **permanent known-broken negative control** as a per-run tripwire
  (reuse the rasterized-decoy fixture from commit 8d7c9c9): every gate run also scores the decoy; if it ever scores
  *above* the binary gate, the run HALTS and pages the human. This automates the GO-SAFE direction and guards the
  self-heal circularity (a "heal" that smuggles a catastrophic defect trips the control).

**Exit:** human anchor JSON committed; gate enforces the binary veto + the negative-control tripwire passes on
every build; continuous bar still inert; all `_*-selftest.mjs` green.

### W1 — Reward-autonomy: cross-site calibration (Track 1, ~1.5 weeks; main track)

Turn the offline-proven reward into a *validated* one, using live builds.

- Pool the **(correspondence-reward score, human/LOOK verdict)** pairs from the builds we already hold (resend 834,
  linear 857, tailwind 859) for a first read via `_correspondence-xval-stats.mjs`.
- As W2 produces fresh sites, append their pairs. Target: **pooled broken-vs-clean separation holds cross-site**
  and the binary gate's false-positive rate on the negative control is 0.
- Run the **live CTA self-heal sweep through the gate** (`cta-heal-sweep.mjs` + `live-gate.runLiveGate`) against the
  local sandbox: heal-rate ≥6/7, CONTROL-B reject 7/7, editability 7/7. Wire the `joist-ctapaint-{pageId}.json`
  sidecar call-site (the one remaining build-absolute → cta-paint glue).
- **Do NOT** flip `enforceCorpusBar` yet — only after pooled Spearman-vs-verdict across ≥3 fresh sites lands
  (per `GATE_BEFORE_PREVIEW.md` §"continuous bar is INERT").

**Exit:** binary gate enforced + validated on ≥3 fresh sites; live self-heal sweep passes; the per-build human LOOK
is downgraded from *acceptor* to *spot-audit + calibration label*.

### W2 — Breadth, rewired to feed W1 (Track 2, parallel; the defect-class engine)

Same generalization test as planned — but **every LOOK now also emits a calibration pair**, so the breadth work
*is* W1's cross-site data.

- Finish the 8-archetype table: stripe/dynamic-JS, e-commerce/PDP, news, gov, agency (+ keep the option of forms,
  RTL). **Include at least one hard surface (forms or dynamic-JS)** — the falsifier requires the reward be stressed,
  not cherry-picked for ease.
- FIX-FIRST each *confirmed cross-site* defect class (the page-bg + multi-column pattern that's working).
- Each build flows through the W0b gate; its (reward, verdict) pair appends to the calibration pool.

**Exit:** 8-archetype defect-class table complete; ≥2 new general fixes shipped; ≥5 fresh calibration pairs added.

### W3 — Responsive (event-triggered on W1 exit, ~2 weeks; the destination)

Only after the reward can score cross-site, and desktop layout is solid (W2's multi-column-collapse class closed).
Bounded wiring, not research — the channel is scoped + sandbox-proven.

- Wire **@media-harvest → native `_tablet`/`_mobile` controls** (already recorded per-element by `capture-assets`)
  into the live projection pipeline end-to-end. **Zero `@media` in custom_css** (it's stripped on Hello+free — see
  `responsive_customcss_stripped`).
- Grade tri-viewport (1440/768/390) via the per-breakpoint correspondence metric; zero h-scroll at 390/768 as a
  composite-level veto; mobile hRatio tolerance band.

**Exit:** ≥2 sites with genuine harvest-derived tablet/mobile states; zero h-scroll at 390/768 corpus-wide.

### W4 — Consolidation + product (after projection's cross-site ceiling is proven)

- **Demote the absolute builder out of the auto-router** (`clone.mjs`) to `--mode absolute` named-explicit-only
  (see STOP). Retire hybrid/raster/`CloneGenerator.php` divergence or label experimental; resolve the
  `joist_clone_url` third-lineage collision.
- Wire the validated pipeline into one invokable agent/skill (the `joist-clone` skill is the vehicle).
- Whole-site tail: Theme-Builder shared header/footer site-parts + Kit, capped 3–5-page crawl, internal-link
  rewrite. Presupposes a trustworthy single-page clone — strictly last.

---

## 6. The asymmetric-autonomy gate (the safety mechanism, explicit)

```
build ──▶ grade ──▶ GATE
                     ├─ negative-control tripwire: known-broken decoy scored every run
                     │     └─ decoy scores ABOVE binary gate?  ──▶ HALT + page human (flywheel stops)
                     ├─ binary broken-vs-clean veto  [ENFORCED — owns the 22.6pt margin]
                     │     └─ catastrophic-static defect fired? ──▶ HOLD (heal → re-check vs FROZEN source)
                     ├─ continuous correspondence bar  [ADVISORY — enforce=false until CI tightens]
                     └─ human LOOK  [SPOT-AUDIT + calibration label — no longer per-build acceptor]
```

Two invariants carry over from the built spine: **TRIGGER ≠ ACCEPTOR** inside each self-heal loop, and
**authoritative re-check against the FROZEN source cache** (never a live re-fetch — guards source A/B drift).

---

## 7. Risk register (V3-specific)

| Risk | Early signal | Response |
|---|---|---|
| **Flipping the gate enshrines a lying instrument** | negative-control decoy scores above the gate on a fresh site | Asymmetric autonomy (binary only) + the permanent tripwire HALT; continuous bar stays advisory |
| **Self-heal circularity** (a "heal" certified by the not-yet-trusted reward) | a healed build passes but LOOK disagrees on spot-audit | TRIGGER≠ACCEPTOR + the tripwire catches catastrophic heals; keep self-heal binary-gated, not continuous-bar-gated |
| **The human isn't actually the bottleneck** (WP/build throughput is) | reviewer comfortably clears every build; queue never backs up | Secondary falsifier fired → re-rank Responsive (W3) to #1 |
| **Distilling Claude, not the user** | reward tracks the model teacher but disagrees with human anchor | W0a human sheet is ground-truth; out-of-sample `HOLDOUT_SHEET` gates; periodic human re-check |
| **Breadth cherry-picked easy** | all fresh sites are clean SaaS marketing pages | W2 mandate: ≥1 hard surface (forms / dynamic-JS) |

## 8. Falsifier (commit to it)

After wiring LOOKs to calibration across **3–4 fresh unseen sites** (one hard surface included), V3's #1 was the
wrong call if **either**:
- **(a)** a known-broken build scores *above* the binary gate on a fresh site (true false-positive on the control), or
- **(b)** pooled broken-vs-clean separation collapses toward within-class noise (the 22.6-pt margin doesn't hold
  cross-site).

Either ⇒ the correspondence reward isn't trustable even as a binary veto; the human can't be removed; the right
move was a categorically better signal (e.g. a distilled cheap *vision* reward, `LEVER_A_REWARD_SCOPE.md` Stage 0)
**or** accept human-in-the-loop permanently and pour the constraint into Responsive + Breadth.

**Secondary falsifier:** if the human is *not* the bottleneck (WP/build throughput is), #1 optimized a
non-constraint → Responsive (W3) becomes #1.

## 9. What to STOP

1. **Stop auto-routing to the absolute-positioning builder.** Demote to `--mode absolute` named-explicit-only — it's
   desktop-pixel-only, structurally can't be responsive, and silently regresses some corpus builds to a dead-end
   architecture, polluting the cross-site data W1 depends on.
2. **Stop optimizing the headline composite against the vision-model teacher** until the reward is human-anchored —
   that's Goodhart fuel against an instrument we've already caught lying.
3. (Carried from V2) blind autonomous discovery waves; per-widget live patching as an engine; re-attacking the
   per-breakpoint absolute-matching ceiling; chasing the raw composite headline.

## 10. First five concrete actions (this week)

1. **[user]** Score `eval/grader/calibration/SCORING_SHEET_V2.html` (W0a) — the single highest-leverage 30 minutes.
2. **[W0b]** Split `gate.mjs` so the binary veto enforces while the continuous bar stays inert; add the
   rasterized-decoy negative-control tripwire (HALT-on-pass) + selftest.
3. **[W1]** Pool the 3 existing builds' (reward, verdict) pairs via `_correspondence-xval-stats.mjs` for a first
   cross-site read.
4. **[W2]** Run the next gen-test archetype (pick a hard one — forms or stripe/dynamic-JS) through the W0b gate;
   FIX-FIRST any confirmed cross-site defect; append its calibration pair.
5. **[W1]** Wire the `joist-ctapaint-{pageId}.json` sidecar + run the live CTA self-heal sweep against localhost:8001.

---

## Open decisions for the user

1. **Anchor authority:** trust the vision-judge panel as the volume teacher with your human sheet as the
   calibration ground-truth + drift check (recommended), **or** gate every reward release on fresh human pairs?
2. **Gate aggression:** enforce the binary veto as soon as W0b lands (recommended — it's GO-SAFE by construction),
   **or** wait for the full ≥3-site W1 validation before any enforcement?
3. **Is the human the bottleneck?** If you can comfortably review every build, the secondary falsifier fires and we
   should promote Responsive to #1 instead. Worth a gut-check before we commit the 2 weeks.
