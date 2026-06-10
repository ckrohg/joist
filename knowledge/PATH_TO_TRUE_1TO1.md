# PATH TO TRUE 1:1 — the corrected roadmap

**Provenance:** synthesized 2026-06-09 by a 21-agent workflow (8 subsystem readers → 3 diagnostic lenses → 3 competing proposals → 3-judge panel → synthesis → 3 adversarial critics). PERCEPTION-LOOP won 2/3 judges; SEMANTIC-RECONSTRUCTION won the strategist. All three critics returned *sound-with-corrections*; every fatal flaw and correction is folded in below and repo-verified at HEAD (89daec3).

**One-line bet:** spend on the eyes first (a human-calibrated, gaming-resistant grader), let the directed-fix loop pull the build — but commit to SEMANTIC's hard numeric gates (control-edit round-trip ≥90%, hRatio∈[0.98,1.02], navigator ≤25 *with containment*) so editability gets **fixed**, not just measured, and run motion/diversity as parallel tracks instead of a serial tail.

**The falsifier for the whole bet:** if after B+C the out-of-sample human-estimate is flat for 3+ weeks while the residual is small and round-trip ≥90%, the binding constraint was the substrate, not the ruler → escalate to the supervised emitSection wave immediately and re-sequence E behind it.

---

## 0. Where we actually are (honest, repo-verified 2026-06-09)

- Adaptive corpus mean ~0.705; best single site supabase 0.878 — but the grader **overstates human-perceived fidelity by 17–26 pts** (true human ~55–70). The 1:1+editable north star is PROVEN on supabase; the distance left is honesty + breadth + the missing axes, not a wall.
- All 13 KEPT build/capture fixes + 5 grader de-deflations are **committed at HEAD** (swept by 89daec3 — which also committed 45 stray .png/.bak debris files needing cleanup).
- Three axes of the user's hard requirements are essentially **unmeasured and unbuilt**: motion/hover (honest supabase motionScore 0.17), true responsive (abs is desktop-pixel; the 2.9x vertical blowup @390 is *invisible* to every current term), and editability QUALITY (panel edits on text-editor/button widgets are inert — inline styles win; headings work).
- Flywheel history (~315 rounds): grader-honesty rounds keep at ~19/4 (best category), blind discovery waves at ~5/14 (worst), per-widget patching ≈ noise. **Every plateau was a measurement ceiling.** Directed fixes off ranked defect lists keep at ~80%.
- Clean per-site recoverables on the 7-site corpus are thinning; remaining buckets = grader-invisible human-salient defects (~20pts), the three missing axes, site diversity, and product wiring.

---

## 1. "True 1:1" — the measurable bar

True 1:1 = a human cannot tell clone from source in the first 10 seconds, AND their first panel edit renders, AND it holds at 390/768, AND it moves where the source moves — across a site distribution that includes the actual Elementor buyer.

| Axis | Bar (measured, not claimed) | Grader change that makes the bar honest |
|---|---|---|
| **Visual** | Out-of-sample **human-estimate ≥ 85** with **zero above-the-fold human-salient defects** (correct logo/hero media-identity, styled CTAs, no invisible headings) | media-identity dim; CTA-styling detector (authored fresh — none exists today; scales with count/area of failing above-fold CTAs); above-fold salience weighting; font-family term; calibration against a labeled human-verdict corpus with a fixed holdout |
| **Editability** | **Control-edit round-trip ≥ 90%** (panel edit → targeted pixels change, unrelated pixels don't, incl. one 390 assert); ≤ 25 top-level navigator nodes **passing the containment test**; named sections ≈ source bands; backgrounds native | editability-QUALITY dim: selectable-text + round-trip probe + hierarchy/containment + named-sections — all read from the **live WP tree** (`joist_get_page_tree`), never builder self-reports |
| **Responsive** | Zero h-scroll at 390 AND 768 (composite-level veto); **mobile hRatio @390 within tolerance** (kills the invisible 2.9x blowup); ≥2 sites with tablet states derived from the NEW @media harvest (beyond existing cardReflow); harvest coverage ≥60% on same-origin-styled sites | 768 term in grade-structure (grade-sections already runs RESP_WIDTHS 390/768/1440); mobile hRatio term; fit checks hardened against `overflow-x:hidden` (max rightmost leaf extent vs viewport, not scrollWidth alone) |
| **Motion** | Source-present hover/reveal/marquee reproduced: motion dim ≥ 0.7 on **matched element pairs**; hover deltas captured for ≥80% of source CTAs (requires raising capture-fx's 28-CTA cap + inview gate); **zero invented motion**, enforced per-type | grade-motion rewritten to element-level correspondence via data-cfx ids; library-fingerprint Jaccard demoted to diagnostic; promoted to ~0.15 weight only after passing the game-test |
| **Diversity** | "ANY site" claimed only on ≥10 sites incl. ≥3 non-SaaS archetypes (blog, SMB/PDP, forms-heavy, one non-Latin/RTL); blog text coverage ≥90%; a real form renders | sentinel-grade intake (ranked defects, non-gating); sentinel means reported separately from the frozen core |

**The published number** after B is the **out-of-sample human-estimate** + its residual trend. The raw composite is the internal hill-climb objective only. A dropping composite on a truer grader is recorded as progress (user-validated principle).

---

## 2. Objective v2 — internal hill-climb heuristic (NOT the convergence criterion)

```
composite_v2 = VETO-CAPS( 0.30·visual_salient
                        + 0.25·editability_quality
                        + 0.20·responsive
                        + 0.15·motion
                        + 0.10·designSystem )

VETO-CAPS are COMPOSITE-level (not term multipliers — today a fully h-scroll-broken
page can still publish ~0.5-0.6 because the h-overflow "veto" floors only the visual
term): h-overflow at ANY graded width ⇒ composite ≤ 0.35; widget-overlap, content-void
(with TEXT-GUARD + media-identity backstop), rastered-text, invisible-text likewise.

visual_salient      = band SSIM/exact × above-fold salience (×2-3)
                      × media-identity (perceptual-hash/patch-ΔE per band)
                      × CTA-styling penalty (scales with failing-CTA count/area)
editability_quality = 0.40·selectable-text + 0.30·control-edit round-trip
                      + 0.20·hierarchy (nativeRatio + containment-tested navigator ≤25)
                      + 0.10·named-section count
                      — denominator = SOURCE text runs via the id-map; content authored
                      as html-widget/raster counts as FAIL, never "unsampled"
responsive          = 0.40·fit@390 + 0.30·fit+order@768 + 0.30·order@390,
                      × mobile-hRatio tolerance band
motion              = matched-pair correspondence (data-cfx ids); static sites = 1.0
designSystem        = current + font-family at real weight
```

**Convergence criterion** = out-of-sample human residual + the zero-above-fold-defect checklist — never the composite itself. If the residual widens >5pts, build waves halt pending a dim re-audit.

**Dim-shipping pipeline (mandatory, three tests):** report-only → `GRADER_NO_*` flag → (1) source-vs-source selftest == 1.0, (2) injected-defect test (the dim must move), (3) **GAME-TEST: the cheapest known trick build must NOT raise the dim** — seeded from in-tree precedents: the 8px probe-img container hack, transparent pointer-events:none twins, phantom forms, occluded text-dumps, void-textguard immunization, generic hover-stamps, lib-script-tag loading.

**Calibration (hardened against curve-fitting):** human_estimate is regressed on a labeled corpus where labels are ground truth and the vision-tile judge is only a scale-out proxy (itself regressed against labels). Gates use **out-of-sample residual on fresh pages labeled AFTER the changes under test**; in-sample fit never gates anything. Label policy: seed ≥25 pages mixing desktop + 390 screenshots + hover clips (motion and mobile MUST be represented, else both hard requirements are excluded from ground truth by construction); refresh at every rebaseline / workstream exit / default-on flip; era-tagged; fixed holdout.

**Known divergence to schedule, not paper over:** page-level (grade-structure 0.35/0.35/0.10/0.20) and section-level (grade-sections 0.35/0.20/0.20/0.25 + structuralFidelity) composites differ today; grade-structure.mjs:10's header still claims 0.5/0.5 (doc-rot). Unification is an A/B work item with a size, and until done the two roles stay explicitly split: grade-structure = corpus headline, grade-sections = refine objective.

### §2 ADDENDUM 2026-06-10 — media-identity FOLD DECISION (B1 round 4) — **RECOMMENDATION, pending user/main-loop sign-off; composite weights NOT changed**

**RECOMMENDATION: FOLD.** In grade-sections only (the refine objective; grade-structure untouched): `visual_b ×= (0.45 + 0.55·M_b)` on bands where source media covers ≥10% of the band (`MI_FOLD_FLOOR=0.45`, gate `srcMediaFrac ≥ 0.10`) — i.e., flip the already-computed `projected.*` chain to live, at its existing insertion point (pre-rastered-text cap re-application). Reversibility contract stays: `GRADER_NO_MEDIAID=1` → byte-identical legacy. **Stays report-only telemetry (NOT folded):** page-level `mediaIdentityMean` (the fold consumes per-band M only), per-band id/presence/leaf counts, `cloneOnlyMediaArea` (hallucinated-imagery blind spot), and all sub-0.10-frac bands (header/footer brand logos — exempt from the fold, still reported).

**Max-gamed analysis (the safety case, all four labs post-T13/T14, commit d05d28b):** best surviving trick per archetype — photo hero: LQIP blur-stamp **0.336** (grain-over-LQIP ≤0.323, wrong-busy ≤0.090, gradient 0.015 — all below); logo wall: LQIP-stamp **0.336** ceiling (wrong-logo substitution ≤0.09); mixed hero+icons: icon-stuffing **+0.004** band M (area weighting); video band: junk-`<video>`-tag **1.0** = the residual by-design ceiling (a real playback surface gets full geometric credit since animated frames are uncomparable; cost to attacker = shipping an actual painting video, wrong pixels still priced by band SSIM; worst-case single-band recoup ≈0.006 composite on a 15-band page); flat-pooled fine-texture (N5, rare): faint-noise **0.60**, documented un-priced. Valid per-band upper bound: `M_gamed ≤ M + 0.336·(1−M)` (identity bands) / 1.0 (presence-only). **Full trick-bundle on the live pages (zz-mi-foldcalc.tmp.mjs, reconstructs published projected.* exactly): tailwind 3146 max recoup +0.003 vs honest fold cost −0.010 (gamed-folded 0.851 < unfolded 0.858, margin 0.007); supabase 2986 max recoup +0.002 vs −0.006 (0.810 < 0.814, margin 0.004). SAFE both pages: a maximally-gamed clone still lands below the unfolded composite, and honest compliance (region-raster the media boxes → M 1.0, recoups the full fold cost) out-earns the best trick bundle ~3×.**

**Measured caveat (round-5 work, does NOT block the fold):** live miMean is NOT value-stable post-T14 — tailwind 0.772→0.498, supabase 0.763→0.705 (fold cost grew −0.006→−0.010 / −0.004→−0.006). LOOK-characterized tonight, two channels, both KNOWN-COST classes already in the flag block: (a) tailwind §4 randomized logo wall re-priced (wrong 12→34 of 36; same logo SET shuffled per load — per-leaf honest, band-level under-credit = the documented nondeterministic-wall caveat amplified); (b) tailwind §19 drift false-deflation (0.793→0.351 on visually same template-collage with small layout drift — the F2 deep-drift cost biting a real band). Supabase video band §8 kept legit 1.0 post-T13. Worst-band ranking unchanged. Round-5 priors, in order: marquee/nondeterministic-wall carve-out (set-identity not cell-identity), drift tolerance beyond ±1 fine-cell, then **small-imagery omission — EVALUATED + DEFERRED round 4**: N3 (8/9 icons missing) scores 0.929 area-weighted; count-weighting → 0.111 but opens a 13× stuffing surface (+0.051 vs +0.004; sub-`MI_FINE_MIN` boxes are mag-only); per-leaf floor /32 → 0.788 at +0.012 stuffing but unbounded false-low risk on logo-dense pages — harden small-leaf identity first, then floor-weight with live A/B.

---

## 3. Workstreams

### A — Lock the substrate (week 1, ~3–4 days; serial, blocks everything)
**Goal:** every later signal means what we think it means; gains become reset-proof.
- Verify the 89daec3 sweep (done — all marker symbols at HEAD) and **clean the 45 .png/.bak debris files it committed** (incl. 5,055-line overnight-state.json.bak, three grader/capture .baks).
- **Fix the silent >600-char text-leaf drop** (capture-layout.mjs:729 — chunk, don't `return null`) AND the grader's matching blindness (grade-structure.mjs:100 drops >200-char runs from BOTH denominators) in the same slot — **before** the rebaseline (ordering matters: the fix changes captured text corpus-wide).
- Repoint corpus-run.mjs:52 from build-hybrid.mjs to `clone.mjs --mode absolute`; add `--cache/--refresh` forwarding to clone.mjs (else every corpus run pays 7×3-pass ensemble capture). One-time rebaseline **after** the text fixes, with era note.
- Port grade-structure's source-capture cache (:216-241) into grade-sections' capture(); also freeze/cache the responsive subprocess's source signals — or scope the determinism exit to full composite honestly.
- Demote react.dev source-side from gating (network-verified broken here). **framer: keep as sentinel with a measured infra-stall log — do NOT silently drop the corpus's hardest reconstruction case** (mean inflation).
- Doc-rot fixes: grade-structure.mjs:10 header; LAYOUT_ENGINE_ROADMAP #2-#4; CEK W3.2 (HeaderFooterFactory.php was REMOVED in e0d7228 — the ✅ is rot); EDITABLE_LAYOUT_ENGINE_SCOPE responsive claim; MOTION_PLAYBOOK Phase-4 CDN text; build-structured stale "default OFF" comments; CLONE_PIPELINE.md:82. Document the two-composite role split.
- **Week-1 visible proof:** one blog-page demo clone after the 600-char fix (minutes of cost; otherwise the fix's value is invisible until F).

**Exit:** debris cleaned; corpus builds via clone.mjs; two consecutive grade-sections runs on a static clone differ <0.01 on the FULL composite; long-form text survives end-to-end on the blog demo; rebaselined mean published with era note.

### B1 — Human-salient eyes, gating slice (weeks 1–3, ~2 weeks; serial after A)
**Goal:** the defects humans see in 3 seconds become graded, fixable signal; C is unblocked.
- **Shared scratch-page/CAS-revert harness — built ONCE here**, reused by the round-trip probe now and C's sectionVisual later. Per-track scratch-page-id pool + per-page-id PUT serialization (the shared-scratch-page clobbering false-negative is documented precedent). Probes never touch the graded artifact.
- **Control-edit render probe** (named distinctly from `joist_smoke_test_roundtrip`, which is data-level only): denominator/sampling spec per §2; expected baseline is differentiated — headings pass (no inline style), text-editor/button-class widgets inert (inline style on inner node wins). That differentiated number is the indictment.
- **media-identity dim** + its capture-side feed pulled forward from F (srcset best-variant + natW/natH + objectPosition as additive img-leaf fields, extending the mockup-recovery pattern at capture-layout.mjs:1230-1237) — dims must price defects the builder can actually fix (the dim-before-feed inversion was a fatal flaw).
- **CTA-styling detector** — authored fresh (no whitelist exists in grade-raster.mjs; it's pixels-only by design).
- **editability-QUALITY dim** per §2, read from the live WP tree.
- **Defect-injector + game-test harnesses** as named, sized items (wrong-logo/unstyled-CTA injection; the trick-build library).

**Exit:** ≥3 dims folded after the triple-test; baseline round-trip measured; C starts.

### B2 — Calibration + remaining dims (~1 week; parallel with early C)
Above-fold salience; font-family term (the serif-inversion round proved a correct font fix is composite-flat today); 768 + mobile-hRatio terms in grade-structure only; overflow-x:hidden-proof fit check; calibration loop + labeled corpus per §2; publish the human-estimate. C's keep gates are deterministic+LOOK and never consume the human-estimate, so this off-critical-path placement costs nothing.

### C — Surgical hands: per-section refine loop + de-inline (weeks 3–6, ~3 weeks; main track)
**Goal:** fix the unit of iteration AND close the editability trust-killer with a number.
- **Day 1, half-day falsifier:** strip inline styles on ONE existing clone, add the canvas-reset rule (`.elementor a{color:inherit}` etc.), hand-probe ~10 leaves — test "canvas-reset neutralizes theme bleed" BEFORE committing two weeks to it.
- **sectionVisual(tree, sec) primitive** (PUT one band to scratch → render → capture), riskiest new piece, built first and alone on the B1 harness; tolerance-based selftest vs perSection[].visual with enumerated divergence causes (kit CSS, cumulative custom_css incl. the canvas-reset itself, lazy-load context).
- Wire refine into `clone.mjs --refine`; this **replaces** the whole-page refine-loop.mjs (which gates on the noisy composite at KEEP_EPS 0.004); deterministic keep gates + LOOK; hard 3-iteration cap; <10 min/page excluding ensemble capture.
- Operator vocabulary: split-wrapper-at-vertical-bg-discontinuity (**executes the fix-ready tailwind §9 dark-on-dark lever**; CAPTURE_SPLITBG + _bgsample exist), wrong-font registration, recapture-lost-text, re-parent-into-section (absPos origin parameter, build-absolute.mjs:602-618).
- **De-inline pass** with the canvas-reset; color/typography moved onto native controls + kit `__globals__`; inline kept only as per-leaf-class flagged fallback where bleed is measured. **Exit gate: round-trip → ≥90% corpus-wide.** D rebases motion measurements after this lands (it changes the cascade hover CSS is measured against).
- Distillation formalized: operator KEPT with same defect attribution on ≥2 sites → auto-promoted to default-on env-flag recipe + ledger entry — **and promotion must also pass page-level B-dims** (the section gates optimize a narrower objective; that's a known Goodhart channel). Re-point lessons.mjs at the live stack; add a `--dry` tree-dump flag to build-absolute (new work — none exists).
- From the structured harvest C takes ONLY html_tag landmarks + the BRAND_FILL de-hardcode (build-structured.mjs:916 → captured primary CTA token). Full emitter harvest + retiring structured/flow = severable cleanup, off the critical path.

**Escalation (numeric):** if editability-quality is flat (<+0.02 on the frozen-core mean) across 2 waves (wave = one corpus-gated operator rollout, ≤4 working days) → supervised **emitSection** wave from the shelf spec: flow-stacked band sections, min_height pinned to source band, native background controls replacing bgRect-div + 8px-probe-img hacks (build-absolute.mjs:908-938), split-at-bg-discontinuity at emit, byte-equivalent degenerate fallback, **hRatio∈[0.98,1.02] hard gate on ANY section emission** (the hybrid cycle-2 hRatio→1.86 failure, pre-gated). Cost of escalating ≈ 1–2 weeks because the measuring dim already exists.

### D — Motion & interaction (parallel track from B1-exit, ~2 weeks)
**Goal:** the hard 2026-06-05 requirement from motionScore 0.17 to a measured, gaming-proof baseline. Grader-first; never invent motion.
- **Rewrite grade-motion to matched element pairs** (the data-cfx ids stamped at capture-layout.mjs:738); library Jaccard → diagnostic-only (loading gsap.js is not motion); invented-motion penalized per-type on animated sources, not just the static control; promote to ~0.15 weight only after the game-test (a generic `transition:0.15s` hover-stamp build must NOT raise the dim).
- Capture: CSSOM :hover harvest first (zero mutation; donor code already at grade-motion.mjs:184-189), then capture-fx's mouse hover-delta pass strictly post-screenshot — **raise the 28-CTA cap + inview gate** (else the 80% bar is unreachable) — then effectsOf()/pseudo() ported as additive leaf fields (transform, text-shadow, ::before/::after, filter, clip-path, transition).
- Emitters (assigned to D ONLY): the 3 STRUCT_MOTION emitters + build-hybrid's HYBRID_MOTION hover-lift (commit 09f8532 — the newest render-validated motion path, `.elementor-element-XXXX:hover` via custom_css). GSAP escape-hatch slices in spec order — runtime already live at **plugin/src/WidgetPack/Motion/Emitter.php** (vendored gsap/ScrollTrigger/SplitText/lenis; a190e61/ecdea2c lineage).
- Coordination: capture-layout's leaf() block (:725-740) is a **serialized merge point** with F's img fields — land sequentially, not flat-merge.

**Exit:** motion dim folded after triple-test incl. game-test; static-control no-op; supabase vocab >0.7 (implies marquee+reveal emitters, not just hover — honest today is 0.17); before/after hover pixel-diff LOOK on ≥3 matched CTAs per site; hover deltas for ≥80% of CTAs on 3 sites.

### E — Responsive: source breakpoints as ground truth (event-triggered at C's operator-vehicle exit, ~2 weeks)
**Goal:** mobile from "doesn't break" to "matches the source's responsive intent" — without re-attacking the confirmed per-breakpoint ceiling (ABS_PERBP stays OFF).
- @media harvest from same-origin CSSOM; map the 3 highest-frequency patterns (display:none hides, grid-template-columns counts, font-size steps) onto Elementor responsive controls + @media custom_css; **harvest coverage ≥60%** numeric exit, cross-origin honestly reported.
- Per-band reflow where structured's qualifiers fire (ramGridQualify/bentoDetect/cardwallDetect). Note: build-absolute.mjs:1406-1424 is the already-default-ON **card-row** reflow (3/2/1 via container grid) — E's tablet-state exit therefore requires states derived from the NEW harvest, beyond what cardReflow already produces.
- LINKCOLS + IMGFIT ports live HERE (assigned to E only). min_height pinned to source band + hRatio gate on any reflow emission.
- Gates: deterministic mobileFit/mobileOrder + 768 term + **mobile hRatio @390** + 390/768 screenshot LOOK — the 2.9x vertical blowup must be visible to the gate, never single-run visual.

**Exit:** zero h-scroll at 390/768 corpus-wide (now a composite-level veto); ≥2 harvest-derived media-query behaviors on ≥3 sites; ≥2 sites with genuine new tablet states.

### F — Diversity treadmill (parallel worktree track from B1, ~2 weeks then continuous)
**Goal:** make "ANY site" an evidenced claim; feed the loop fresh defect distributions.
- Intake script: cheap recon → capture → build → grade → ranked defects → archetype tag (recon is 5-for-5 historically). Onboard 3–5 sentinels: long-form blog, SMB/restaurant, e-commerce PDP, forms-heavy, one non-Latin/RTL. Sentinel-grade, non-gating; means reported separately; **sentinels inform (not block) every default-on flip**.
- **Forms — clone-pipeline scope** (plugin side already shipped: commit 918d792, Fluent Forms shortcode widget + verified recipe in knowledge/FORMS_AUTHORING.md): detect `<form>`/input clusters in capture, emit the shortcode from build-absolute instead of today's dead inline `<input>`s.
- Stripe generalization pair: accordion recipe + phantom-block suppression (the sentinel logged both).
- Imagery capture bundle ships in B1; F extends it (capture-ensemble's text-only winner criterion gets a media term, capture-ensemble.mjs:27-30).

**Exit:** ≥3 sentinels with ranked defect lists; ≥2 recipes promoted from off-archetype defects; blog text coverage ≥90% (now measurable post-A); a real form renders.

### G1 — Product wiring + cheap moat falsifier (~weeks 3–4; UNGATED, internal only)
- **Resolve the joist_clone_url collision:** the MCP tool already exists backed by plugin-side CloneGenerator.php (a third live clone lineage the pipeline work never touches — server-side one-shot, can't run the node/Playwright pipeline). Decide: replace backend / rename / dual-path; interim stance: label CloneGenerator experimental so the public tool and the benchmarked pipeline stop diverging. The skill-side fast-path wiring already exists (cd4c718, mirrors under .claude/skills/joist-clone/pipeline/).
- **Skill-mirror sync rule:** C/D/E edits to the pipeline must sync the skill mirror (build step or explicit check) — executable doc-rot otherwise.
- **Internal competitor falsifier** (~one Web2Elementor credit + a 10Web trial): grade their output on our grader NOW — if it grades comparably, the moat framing and C/D priorities change. Costs near-zero, de-risks 5 weeks of assumption.

### G2 — Publish + whole-site (weeks 9–10; HARD-GATED on out-of-sample residual ≤8 AND round-trip ≥90%)
- Benchmark publishing (ours vs theirs, honest grader — nobody else dares publish numbers).
- Whole-site slice: Pro Theme Builder shared chrome (path unbuilt — HeaderFooterFactory removed), sitemap crawl capped 3–5 pages, internal-link rewriting (10Web's worst public complaint), chrome dedup, site-level rollup.
**Exit:** fresh URL → graded editable page via one MCP call; benchmark doc; 3-page site with ONE editable shared header and 100% resolving links.

---

## 4. Ordering & parallelism

**Serial spine:** A → B1 → C-start. A first because every later signal is meaningless against the wrong builder and a noisy objective. B1 before build work because the loop only recovers points the objective sees (315 rounds of evidence). Within C, the falsifier and sectionVisual come first.

**Parallel tracks after B1** (disjoint footprints, named merge points):
- **Track 1 (main):** C — refine loop, de-inline, distillation (build-absolute.mjs, refine plumbing, lessons.mjs).
- **Track 2:** D — motion (grade-motion.mjs, capture additive passes, motion emitters). Starts at B1-exit.
- **Track 3:** F — intake + forms + imagery extension (new intake script, plugin recipe, sentinel pages — not the frozen core).
- **E** is event-triggered on C's operator vehicle, not calendar-scheduled; B2 rides beside early C; G1 is a small early slice.

**Known merge points (serialize, don't flat-merge):** capture-layout's leaf() emission block (D hover/effects fields vs F img fields); build-absolute flag blocks. The flat-merge memory pattern was validated on flat class-name arrays — it does NOT extend to a 1,900-line function body.

**WP-instance contention:** one live instance (georges232.sg-host.com); per-track scratch-page-id pool; per-page-id PUT serialization; parallelize across sites, never within a page.

**The binding resource is the human:** every LOOK gate, default-on flip, and calibration label routes through one reviewer. **Cap at 2 concurrent tracks whenever the review queue exceeds a day.** A track that misses its exit two weeks running gets cut — the serial spine never moves.

---

## 5. Stop doing / keep doing

**STOP:**
- Blind autonomous discovery waves on the 7-site corpus (worst keep-rate category). All improvement flows recon → ranked human-salient defects → directed fix or operator.
- Per-widget live patching as an improvement engine (below noise); surgical-edit survives only as the patch primitive inside operators/probes.
- Any re-attack on per-breakpoint absolute matching @390 (CONFIRMED ceiling).
- Building the corpus via build-hybrid (corpus-run.mjs:52) and maintaining route-clone's stale bench.
- Desktop geometry/spacing polish on the existing corpus — that grader-visible bucket is saturated (~2–3 human pts).
- build-structured/build-flow as standalone modes — harvest (assigned: C=landmarks+brandfill, D=motion, E=linkcols/imgfit), then retire.
- Headed/stealth capture work (no headless bot-wall exists — verified).
- Treating framer/react.dev-source as gating signal (framer stays a sentinel with logged evidence).
- Chasing the raw composite headline — the tracked number is the out-of-sample human-estimate.
- The emitSection mega-refactor as opening move — it's the numerically-triggered escalation.
- Refine loops past 3 iterations; the whole-page refine-loop.mjs gate on noisy composite.

**KEEP:**
- Grader-honesty work (best keep-rate), now with the mandatory triple-test (selftest + injected-defect + game-test).
- Cheap recon before any wave; directed fixes off ranked defect lists.
- Deterministic-metric + LOOK gating; single-run visual deltas <0.08 never decision-bearing; median-of-2 where visual must decide.
- Reversible env-flags; byte-equivalent off-paths; per-band corpus-gated rollouts; sentinels informing default flips.
- The distill-to-recipe channel, formalized as the ≥2-site auto-promotion rule (plus page-level B-dim check).
- VERDICT-line-first adversarial reviews; API-error failures recorded as infra, never plateau.
- Committing KEPT work promptly (no more 18-fix uncommitted exposure); era notes on every rebaseline; clean commits (89daec3's 45 debris files are the counterexample).

---

## 6. Anti-gaming analysis (per new dim — the Goodhart ledger)

Co-evolution of builder-vs-grader gaming has already happened twice in-tree (the 8px probe-img container hack; invisible pointer-events:none twins). Every new dim ships with its cheapest-known counterfeit and the game-test that detects it:

| Dim | Cheapest game | Detection (in the dim's game-test) |
|---|---|---|
| media-identity | reproduce band text, omit imagery (void-textguard immunization) | band loses media-identity even when text-guard passes — this exact injected-defect test is a B1 exit |
| CTA-styling | style 1 of 10 CTAs | penalty scales with count/area of failing above-fold CTAs |
| round-trip | probe only controls that exist | denominator = SOURCE text runs via id-map; html/raster content = FAIL |
| round-trip | `!important` custom_css masks panel edits on mobile | one 390-width assert per probe |
| hierarchy/navigator | 25 arbitrary y-band wrappers | containment test: a named section counts only if it natively carries the band bg AND its children are exactly the band's leaves; read from live WP tree |
| selectable-text | text dump occluded behind an opaque raster | round-trip probe (occluded text can't pass pixel-change asserts); vis() never tests paint order — the probe is the backstop |
| motion | generic hover-stamp on every anchor + loading source's gsap script tags | matched-pair correspondence; library Jaccard diagnostic-only; per-type invented-motion penalty |
| responsive fit | `overflow-x:hidden` clips while content is cut | rightmost leaf extent vs viewport; mobile hRatio tolerance |

**Standing requirement:** maintain a max-gamed-score estimate — the full trick-bundle build must score BELOW the publish bar, or dims tighten until it does.

---

## 7. Risk register

| Risk | Early signal | Response |
|---|---|---|
| **B undersized** (the serial spine's foundation: 6 dims + a WP-mutating probe primitive + injector harnesses + labeling) | B1 misses its 2-week exit | B1/B2 split already de-serializes; further slips push B2 items report-only and start C on B1's three core dims |
| **Calibration circularity** (estimate regresses to the proxy, not humans) | Out-of-sample residual disagrees with spot human checks on 2+ pages | Labels are ground truth from day one; out-of-sample-only gating; grow labels before trusting trend; ≥25-page seed with motion+mobile representation |
| **Re-parenting plateaus short of clean hierarchy** | editability-quality flat <+0.02 across 2 defined waves | Numeric escalation → emitSection from the shelf (gates pre-built); cost ≈ 1–2 weeks |
| **sectionVisual flaky** (C/D/E ride it) | Tolerance selftest fails; scratch renders diverge from in-page bands | Built first, alone, on the shared harness; fall back to whole-page deterministic gates while fixing |
| **De-inline re-exposes theme bleed** (inline stamping exists because theme rules won) | Round-trip climbs but visual drops on themed leaves | Half-day falsifier BEFORE the pass; per-leaf-class fallback behind flag; the probe is the gate |
| **Seam drift on section/reflow emission** (hybrid cycle-2: hRatio→1.86) | hRatio outside [0.98,1.02] anywhere | Hard gate + min_height pin (proven); per-band rollout; byte-equivalent fallback |
| **New dims lie** (both directions in history) | Triple-test failure; sentinel moves on byte-identical builds | Dim stays report-only until all three tests pass |
| **Headline drops erode confidence** (rebaseline, B-dims, motion fold = 3+ drops) | Pressure to revert a truer dim | Era notes; human-estimate is the stable published number; drops are documented win conditions |
| **Parallel tracks dilute** | Track misses exit 2 weeks; review queue >1 day | Track-cut rule; 2-track cap; serial spine never moves |
| **Reviewer/label bandwidth** | LOOK queue backs up | Same cap; labels batched at rebaseline points |
| **Pro-only custom_css dependency deepens** (motion, @media, pins) | n/a — known | Accepted, named product caveat; free-tier channel stays an open product item |
| **Probe mutates graded artifact** | Mid-probe crash leaves dirty page | Scratch-duplicate/CAS-revert harness is the only probe path — rule, not preference |
| **CloneGenerator divergence** (public MCP tool ≠ benchmarked pipeline) | User runs joist_clone_url, gets third-lineage output | G1 interim stance lands early (label experimental / rename) |

---

## 8a. ADDENDUM 2026-06-09 (user directive): deadline dropped, responsive elevated — the bet re-weighted

The user dropped the deadline and set the goal as **perfect 1:1 RESPONSIVE sites**. That changes one thing: **semantic layout-system recovery moves from contingency to destination.**

Rationale: an absolute-pinned page is a *projection* of the source at 1440px; the 390px page is a different projection of the same layout system. The second projection cannot be generated from the first (information loss — this is WHY the per-breakpoint matcher ceiling exists: it matched projections to each other instead of recovering the generating system). Perfect responsive = reconstruct the system ("3-col card grid that stacks at 768"), not the pixels. The structured recipes already proved Elementor flow works when handed confident structure; the gap is inference, and the unexploited signal is **tri-viewport correspondence**: leaves that regroup between 1440/768/390 reveal true container membership. Using breakpoint *differences* as structure evidence is the inversion of the failed approach (matching absolute *boxes* across breakpoints) and does not re-attack the confirmed ceiling. @media harvest corroborates where same-origin.

Mechanism — **graded per-section architecture migration** (no big-bang): build each section both ways (absolute + inferred responsive archetype from ~6 archetypes: grid-N→1, split→stack, link-cols, marquee, hero, nav); the grader referees at ALL THREE widths; flow wins a section only if it beats absolute at 1440 AND 768 AND 390 with hRatio∈[0.98,1.02] everywhere + zero-h-scroll veto + byte-equivalent absolute fallback on low confidence. Losing sections stay absolute (desktop-perfect, honestly non-responsive) and feed ranked defects to the next inference round. The flywheel migrates its own substrate inch-by-inch.

Changes to the workstreams above:
- **B:** tri-viewport grading is the FRAME, not a term — composite graded at 1440/768/390 against per-viewport source captures. Bar for "perfect": human-estimate ≥85 at every width, zero h-scroll, round-trip ≥90%, motion ≥0.7.
- **C:** unchanged EXCEPT drop incremental re-parenting as the default hierarchy strategy (it polishes a substrate that can't reflow). C's vehicle (sectionVisual, refine loop, de-inline, probe) is substrate-agnostic — nothing is throwaway.
- **E → E′ "layout-system recovery":** promoted to the main architecture track. Tri-viewport correspondence → container semantics → native responsive archetype emission, per-section graded migration as above. The old emitSection escalation trigger is superseded — emission is now planned, still gated per section by the same numbers.
- **Falsifier FIRST (runs with B1, ~2 days):** supabase's 3 captured viewports, correspondence on 3 sections (card grid, split hero, footer) — if regrouping signal can't identify containers on the easiest cases, E′ re-scopes around @media harvest as the primary signal.
- **FALSIFIER VERDICT (2026-06-10, ran refute-by-default): HYPOTHESIS SURVIVES — tri-viewport correspondence is E′'s primary signal; @media harvest demoted to corroborative.** Footer CLEAN (6→3→2 col migration recovered, pair-precision 1.0); split-header CLEAN and the purest proof (only the 1440×390 conjunction disambiguates — each single viewport alone scores P≈0.4); grid PARTIAL→CLEAN with a cross-kind rescue (image-alt ↔ heading text) because capture collapses 4/7 cards into composite images at 1440 while 390 captures them pristine. E′ design sharpenings now locked: (1) **trees-first, leaves-as-glue** — per-viewport resolved DOM trees carry most structure (they ARE the @media output, and work cross-origin); leaf correspondence aligns trees; breakpoint-diff regrouping verifies + parameterizes archetypes; (2) **768 is the structural keystone** (information-richest width; 390 actively lies about adjacency); (3) **capture asymmetry is the #1 obstacle** (composite-collapse — the "capture-alignment" lever the ceiling memo named; fix = alt/aria cross-kind identity + consistent decomposition across widths); (4) genuine mobile absence (~60% of desktop leaves: nav/marquee/walls) is filterable by band leaf-count ratio → route those bands to archetype emission + hidden_mobile; (5) full-width leaves bridge columns — exclude ≥0.85-section-width leaves at the WIDEST viewport only. CAVEAT (now resolved): supabase is the easy case (same DOM at all widths) — second falsifier run on a restructuring-class site required before final design lock. Artifacts /tmp/triview-falsifier/.
- **FALSIFIER RUN 2 (2026-06-10, stripe+notion hard cases): SURVIVES — E′ DESIGN LOCKED.** Headline: **the restructuring class is empty at the DOM level** — raw-DOM similarity across 1440/768/390 is ≥0.993 on stripe/notion/linear/vercel (5/5 flagships incl. supabase are same-DOM); ALL restructuring is rendered-layer (visibility/display swaps: linear hides ~38% at 390, stripe swaps grid→carousel via visibility), which is exactly what capture sees. 6/6 sections CLEAN or PARTIAL with grouping never wrong (impurities traced to matching-layer or bridge gaps, all with verified minimal fixes); zero true content reordering (tau=1.00); no desktop-table→mobile-cards swap exists in this class; **no restructuring detector/fallback path needed**. Decisive insight: **trees and boxes are mutually covering** — trees fail only where capture flattens (boxes scored perfect there), boxes fail only at tight-gap/full-width bridging (trees perfect there). E′ implementation order: (1) content-based band alignment (band-index equality is NOT safe — stripe nav collapses 9→8 bands), (2) **union-of-viewports inventory, not 1440-anchored** (carousel ghosts carry content desktop never renders), (3) matching rescues: kind-flip XKIND2 + 0×0-ghost handling + art-direction src-normalize (`-desktop`/`-mobile`), (4) capture svg-identity fix (empty-svg leaves need outerHTML hash/raster fingerprint), (5) per-viewport bridge veto (pair fails at ANY viewport where either leaf ≥0.85 section width — footer P 0.80→1.00), (6) marquee/carousel bands route to motion archetypes (absence ≠ design truth under animation). Artifacts /tmp/triview-falsifier2/.
- **Cadence:** quality-gated, not calendar-gated. Every stage exits on its numeric gate; week labels above are sizing estimates only.

## 8. What the user SEES in the first two weeks (inch-by-inch, visible)

1. **Week 1:** a long-form blog page clones with its body text intact (today it silently vanishes) — first new-archetype demo.
2. **Week 1:** clean tree — debris gone, corpus running through the real entry point, honest rebaselined mean with era note.
3. **Week 2:** the round-trip indictment number (differentiated: headings pass, body text inert) + the first human-salient dims live — wrong logos and unstyled CTAs finally COST something.
4. **Week 2–3:** tailwind §9 white-on-dark fixed via the first refine operator; C's falsifier verdict on de-inline.
5. **Week 3–4:** `joist_clone_url` dogfooding path decided + internal competitor grading — the moat thesis tested for one API credit.
