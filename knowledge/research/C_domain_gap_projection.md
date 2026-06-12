# Track C — Domain Gap + Projection onto Expressible Sets

> @purpose Research synthesis: how other fields handle (a) the gap between a cheap preview
> simulator and the real rendering system (sim2real), and (b) projecting unconstrained
> input into a constrained output vocabulary (lossy projection), with concrete transfers
> to the Joist clone pipeline — especially the **Elementor Capability Atlas** and the
> **residual-channel policy** (custom CSS vs image fallback decided by projection error).
>
> Problem frame (keep central): websites are built in infinitely many ways (unconstrained
> input embodiment); we must reproduce the EXACT rendered result through Elementor's rigid
> widget/container vocabulary (constrained output embodiment). We cannot change the input.

Status: IN PROGRESS — sections appended incrementally (stall-proof protocol).
Date: 2026-06-12. Author: Track C research agent.

## Section map

1. Sim2real → calibrating the local-preview ↔ real-WP/Elementor render gap
2. Lossy projection in practice (image→SVG, photo→LEGO/voxel, music→MIDI, text→controlled vocabulary)
3. Style/constraint transfer — same CONTENT under a different generative system
4. Round-trip / cycle-consistency — as training signal AND runtime check
5. THE ELEMENTOR CAPABILITY ATLAS — concrete design (measured, not assumed)
6. RESIDUAL-CHANNEL POLICY — when custom CSS vs image fallback, decided by projection error
7. Transfer table — field lesson → concrete pipeline change

---

## 1. Sim2real → calibrating the local-preview ↔ real-WP/Elementor render gap

Our exact instance of the sim2real shape: the pipeline previews candidate output by rendering
generated HTML/CSS (or a local approximation of the Elementor tree) in local chromium ("sim"),
but the deployed truth is WordPress + theme CSS + Elementor frontend CSS + kit globals + kses
sanitization + font loading ("real"). Robotics has four mature answers, in order of preference.

### 1.1 System identification — calibrate the simulator FIRST (preferred when you can measure reality)

- Robotics: system ID "enhances simulator fidelity by calibrating its physical parameters before
  policy training, thereby reducing the need for the learned policy to compensate for modeling
  errors." Modern form: massively parallel sampling of parameter sets, picking those that minimize
  state-prediction error between simulated and real trajectories — [SPI-Active, arXiv:2505.14266](https://arxiv.org/abs/2505.14266);
  PACE does it for legged robots using only standard joint encoders — [leggedrobotics/pace-sim2real](https://github.com/leggedrobotics/pace-sim2real).
- The gap is "triggered by an inconsistency between physical parameters (friction, kp, damping,
  mass…) and, more fatally, incorrect physical modeling" — i.e. parameter error vs STRUCTURAL
  model error are different beasts ([MIT Sim2Real survey, T-ASE 2021](https://dspace.mit.edu/bitstream/handle/1721.1/138850/2021-04-Sim2Real_T-ASE.pdf)).
- **Transfer (concrete):** our "physical parameters" are enumerable and CHEAPLY measurable —
  unlike robotics we can query the real system deterministically:
  - Render a fixed PROBE PAGE of widgets through both paths (local preview vs real WP page),
    walk both DOMs, and diff `getComputedStyle` per element. The diff IS the system ID:
    theme reset rules, Elementor container default gap/padding, kit global colors/fonts,
    `frontend.min.css` defaults, font fallback metrics.
  - Output = a machine-readable CALIBRATION TABLE (`widgetType × property → wpValue`), versioned
    per (Elementor version, theme, kit hash). Re-run on plugin/theme update — this is robotics'
    "re-identify after hardware change".
  - Structural (non-parametric) gaps to flag separately because no parameter tweak fixes them:
    kses stripping attributes, Elementor wrapping every widget in `.elementor-widget-container`
    (extra box in the cascade), WP big-image 2560px splitting (already bitten us — memory:
    section_raster_1to1_proof), `_elementor_edit_mode` fallback rendering (memory:
    hybrid_clone_and_render_truths). These are MODEL errors, not parameter errors.

### 1.2 Real2sim — import reality into the simulator (our cheapest, biggest win)

- Robotics' "real-to-sim-to-real" iteratively uses real-world feedback to rebuild the simulator
  ([Real-to-Sim-to-Real methodology](https://www.emergentmind.com/topics/real-to-sim-to-real-methodology)).
  For robots this is expensive (scanning, inverse dynamics). For us it is nearly free, because our
  "physics" is CSS, and CSS is copyable:
- **Transfer (concrete):** snapshot the REAL site's full CSS environment once — theme stylesheet,
  `elementor/frontend.min.css`, the kit's `post-{id}.css`, uploaded fonts — and load that bundle
  into the local preview harness, rendering the candidate Elementor markup (Elementor's actual
  wrapper DOM, not our approximation) inside it. Then the preview is not a simulator of the
  cascade; it IS the cascade, minus PHP. The residual gap shrinks to: PHP-side render filters,
  kses, dynamic tags, and image pipeline — a short, auditable list. This inverts the default
  instinct ("make the preview prettier"): make the preview REAL by importing reality's assets.

### 1.3 Residual correction — learn the leftover delta, don't perfect the model

- Soft-robot sim2real: train a network to predict only the RESIDUAL between analytic simulation
  and reality; "outperforms traditional system identification up to 60%" on systems whose
  unmodeled effects (viscoelasticity, hysteresis) resist parameterization —
  [Sim-to-Real of Soft Robots with Learned Residual Physics, arXiv:2402.01086](https://arxiv.org/pdf/2402.01086).
- ASAP (RSS 2025): pre-train in sim, deploy, collect real trajectories, fit a DELTA ACTION model
  for the dynamics mismatch, then fine-tune the policy inside sim+delta; reduces real tracking
  error up to 52.7% — [arXiv:2502.01143](https://arxiv.org/pdf/2502.01143), [project](https://agile.human2humanoid.com/).
- **Transfer (concrete):** after 1.1/1.2, the remaining preview↔WP delta will be small but
  systematic (e.g. WP image resizing changes intrinsic sizes; font loading shifts line breaks).
  Keep a RESIDUAL TABLE keyed by widget type: measured Δheight/Δwidth/Δy between preview boxes
  and WP boxes across the corpus. The planner consumes preview + residual, exactly ASAP's
  "fine-tune inside sim+delta" — we plan against the corrected preview, never raw preview.
  Like ASAP, refresh the delta from each real deployment (every corpus grade run against real WP
  pages is free residual data — log it, don't discard it).

### 1.4 Domain randomization — robustness when you can't (or don't want to) identify

- Tobin et al. 2017: randomize textures/lighting/camera in sim so "the real world may appear to
  the model as just another variation" — [arXiv:1703.06907](https://arxiv.org/abs/1703.06907);
  survey of variants in [Lil'Log: Domain Randomization for Sim2Real](https://lilianweng.github.io/posts/2019-05-05-domain-randomization/).
  Theory work confirms DR trades optimality for robustness — it's the hedge you buy when
  identification is impossible ([Understanding DR, arXiv:2110.03239](https://arxiv.org/pdf/2110.03239)).
- **Transfer (concrete + a warning):** we CAN measure the real renderer cheaply, so system ID
  (1.1/1.2) dominates DR for the preview gap — don't randomize what you can identify. DR's real
  use for us is the CLIENT-SIDE gap we cannot identify: the visitor's browser/viewport/font
  availability. Grade candidate clones at randomized widths around each breakpoint (e.g.
  1440±60, 768±40) and with a fallback-font pass, so the builder can't overfit one pixel-exact
  preview — the same anti-overfitting logic as randomized textures. This also matches the
  tri-viewport correspondence finding (memory: triview_correspondence_proven).

### 1.5 The web world's own sim2real literature: visual regression testing

- The VRT industry hit the identical gap and converged on: (a) pixel-perfect diffs "fail nearly
  every run" due to anti-aliasing, sub-pixel rendering, GPU/OS font-smoothing variance; (b) fix =
  freeze ONE rendering environment in CI (consistent headless Chrome), mask dynamic regions, use
  similarity thresholds (~95–97%) rather than exactness —
  [Why Your Visual Regression Tests Are Failing](https://dev.to/maria_bueno/why-your-visual-regression-tests-are-failing-26kg),
  [Vitest visual regression docs](https://vitest.dev/guide/browser/visual-regression-testing);
  (c) when fidelity-to-user matters, render in REAL browsers at scale (Percy's pitch) —
  [Percy visual testing tools](https://percy.io/blog/visual-regression-testing-tools).
- **Transfer (concrete):** this independently validates two things we already learned the hard
  way: the ±0.08 visual-noise floor (memory: grader_visual_noise) is the industry-known
  anti-aliasing/dynamic-content noise, and the right response is deterministic-metric gating +
  masking, not tighter pixel thresholds. New steal: VRT's "mask dynamic regions" — maintain an
  explicit dynamic-region mask per source (carousels, video posters, timestamps) applied on BOTH
  sides of the diff, instead of letting those regions inject noise into composite scores.


## 2. Lossy projection in practice — when the target language cannot express everything

Every field below faces our exact shape: continuous/unbounded input, discrete/bounded output
vocabulary. Four convergent moves recur: (1) make the expressible set EXPLICIT (a dictionary/
atlas, not an assumption); (2) project by minimizing PERCEPTUAL error, not symbol-level error;
(3) give the residual a principled channel (escape hatch or diffusion), never silently drop it;
(4) allocate the output budget greedily where the residual error is largest.

### 2.1 Image → SVG (vectorization): perceptual-loss-guided, error-driven primitive budget

- DiffVG made rasterization of vector primitives differentiable, so vector parameters are
  optimized to match a target image by minimizing a deep PERCEPTUAL loss — not per-pixel RGB —
  ([DiffVG in PyTorch-SVGRender](https://pytorch-svgrender.readthedocs.io/en/latest/diffvg.html),
  [repo](https://github.com/ximinng/PyTorch-SVGRender)).
- LIVE (CVPR 2022) adds the key structural idea: LAYER-WISE GREEDY ADDITION — start with few
  Bézier paths, add the next path where reconstruction error is largest, producing "compact and
  semantically consistent" SVGs that preserve image topology with no redundant shapes —
  [LIVE: Towards Layer-wise Image Vectorization](https://ma-xu.github.io/LIVE/),
  [paper PDF](https://ma-xu.github.io/LIVE/index_files/CVPR22_LIVE_main.pdf).
- **Transfer (concrete):** LIVE is literally our refine loop with the right control law:
  (a) widget budget should be ALLOCATED BY RESIDUAL — after each build+grade, add/split widgets
  only in the section tiles with the worst perceptual error, not uniformly; (b) optimize against
  a perceptual metric (vision-judge tiles — already the new headline per the vision-judge pivot),
  not DOM-symbol similarity; (c) LIVE's "no redundancy" objective = our editability dimension:
  a clone made of fewer, semantically-aligned widgets is BOTH more editable and what LIVE calls
  topology-preserving. Same objective, two fields.

### 2.2 Photo → LEGO / voxel (legolization): project to grid, then merge under legality constraints

- The canonical pipeline is two-stage: voxelize the model (raw projection onto the grid), THEN
  merge voxels into larger legal bricks while analyzing/repairing structural problems on a
  connectivity graph; stability is optimized with stochastic search (simulated annealing) —
  [Legolizer](https://www.researchgate.net/publication/221337507_Legolizer_A_Real-Time_System_for_Modeling_and_Rendering_LEGO_R_Representations_of_Boundary_Models),
  [Image2Lego, arXiv:2108.08477](https://arxiv.org/pdf/2108.08477),
  [brick-optimization-builder](https://github.com/dzungpng/brick-optimization-builder).
- Newer work generates LEGO designs that must be PHYSICALLY STABLE AND BUILDABLE — feasibility
  is a hard constraint checked by a verifier, not a soft preference —
  [Generating Physically Stable and Buildable LEGO Designs from Text, arXiv:2505.05469](https://arxiv.org/html/2505.05469v1).
  And the "vivid sculptures" line prioritizes SALIENT visual features (repetition, shape detail,
  planarity) over uniform voxel fidelity — perceptual saliency-weighted projection —
  [Automatic Generation of Vivid LEGO Architectural Sculptures](https://www.researchgate.net/publication/331094372_Automatic_Generation_of_Vivid_LEGO_Architectural_Sculptures).
- **Transfer (concrete):** (a) our capture-tree → widget-tree mapping should formally be
  voxelize-then-merge: first project the source into a fine neutral grid (captured boxes), then
  MERGE into the largest legal Elementor constructs (a 2×3 card area becomes one grid container,
  not six absolute widgets) — merging is where editability is won, exactly as brick-merging is
  where stability is won; (b) "buildable" = a hard verifier (round-trip ≥90% editability gate in
  PATH_TO_TRUE_1TO1) run as a separate pass, like LEGO stability analysis — never folded into the
  visual score; (c) saliency-weighting: spend widget fidelity on human-salient features first
  (logos, headings, CTAs — exactly the grader_overstates_top_end finding) rather than uniform
  box-IoU.

### 2.3 Music → MIDI (automatic transcription): TWO targets, and residual channels in the spec

- MIDI's base vocabulary cannot express per-note expression: "MIDI code supports pitch bend only
  by channel, not note-by-note"; continuous timbre/dynamics within a note and microtonal
  inflection are inexpressible in the core spec —
  [What's Wrong with MIDI? (Perfect Circuit)](https://www.perfectcircuit.com/signal/whats-wrong-with-midi),
  [ViolinDiff, arXiv:2409.12477](https://arxiv.org/html/2409.12477v1),
  [IRMA Iranian classical corpus, arXiv:2508.19876](https://arxiv.org/pdf/2508.19876).
- The field's two answers: (1) EXTEND THE VOCABULARY with auxiliary continuous channels — pitch
  bend, CCs, and eventually MPE (per-note expression) — i.e. standardized residual channels
  bolted onto the constrained core; (2) split the TASK into two distinct targets:
  performance-level transcription (keep exact onset times, velocities — "what was played") vs
  score-level transcription (quantize to the rhythmic grid — "what was meant"); rhythm
  quantization is its own research problem because deliberate expressive deviations fight the
  grid — [Monte Carlo Tempo Tracking & Rhythm Quantization, arXiv:1106.4863](https://arxiv.org/pdf/1106.4863),
  [Musically Informed Evaluation of Piano Transcription, arXiv:2406.08454](https://arxiv.org/pdf/2406.08454).
- **Transfer (concrete):** (a) our absolute-vs-flow builder split IS performance-vs-score
  transcription: absolute positioning = performance MIDI (exact, desktop-pixel, not "musical");
  flow/grid layout = score (quantized to Elementor's layout grid, responsive, editable). Stop
  treating them as competing quality levels — they are different TARGETS, and the right product
  answer (like modern DAWs) is to keep BOTH and convert score→performance only where the source
  genuinely deviates from any grid; (b) MPE's lesson for the residual channel: standardize it.
  Per-widget custom CSS is our pitch-bend — define a fixed, small schema of allowed residual
  properties rather than free-form CSS, so the residual stays parseable/editable (MPE works
  because it's a SPEC, not ad-hoc sysex).

### 2.4 Text → controlled vocabulary (ASD-STE100): the dictionary is explicit, versioned, and machine-checked

- Simplified Technical English = 53 writing rules + ~900 approved words, one meaning per word
  (Jan 2025 edition); writers accept the expressiveness loss in exchange for unambiguity —
  [ASD-STE100](https://www.asd-ste100.org/about_STE.html), [Wikipedia: STE](https://en.wikipedia.org/wiki/Simplified_Technical_English),
  [CNL survey, arXiv:1507.01701](https://arxiv.org/pdf/1507.01701).
- Operationally, STE works because of CHECKER SOFTWARE (HyperSTE, Acrolinx) that flags
  non-conformant constructs at authoring time against the explicit dictionary —
  [HyperSTE](https://hyperste.ai/asd-ste100-simplified-technical-english-for-aerospace-and-defense/),
  [Acrolinx STE guide](https://www.acrolinx.com/blog/a-guide-to-simplified-technical-english-improving-your-technical-documentation/).
- **Transfer (concrete):** the Elementor Capability Atlas (§5) is our STE dictionary, and the
  transpiler needs an STE-style CONFORMANCE LINTER: before any build, every captured feature is
  classified against the atlas as expressible / expressible-with-loss / inexpressible, with the
  decision logged. Today that classification lives implicitly in builder code paths; STE shows
  it should be an explicit, versioned artifact that authoring tools check against. DesignMD's
  lint-rules-as-grader-dims steal (memory: designmd_steal_plan) is the same move.

### 2.5 Color quantization → error diffusion (Floyd–Steinberg): the residual is conserved, not dropped

- Floyd–Steinberg (1976): quantize each pixel to the limited palette, then PUSH the quantization
  error onto not-yet-quantized neighbors (7/16, 3/16, 5/16, 1/16); humans perceive "more colors
  than there actually are"; doing the diffusion in a perceptually uniform space (CIELAB) beats
  raw RGB — [Wikipedia: Floyd–Steinberg dithering](https://en.wikipedia.org/wiki/Floyd%E2%80%93Steinberg_dithering),
  [ScienceDirect: Error Diffusion](https://www.sciencedirect.com/topics/computer-science/error-diffusion),
  [Cloudinary glossary](https://cloudinary.com/glossary/floyd-steinberg-dithering).
- **Transfer (concrete):** when Elementor's vocabulary forces value quantization (spacing presets,
  container gaps, column units, font-size steps), do not absorb each error locally — CONSERVE the
  residual along the layout axis: if a section's expressible top-padding undershoots the source by
  9px, add those 9px to the next inter-section gap so cumulative vertical offsets (and therefore
  every downstream section's y-position) stay aligned. This is exactly why per-section grading can
  look fine while whole-page alignment drifts: un-diffused quantization error accumulates. A
  running "vertical error accumulator" in the builder is a ~20-line change with page-level payoff.


## 3. Style/constraint transfer — same CONTENT, different generative system

The clone task is not style transfer (we keep style AND content; we change the GENERATIVE
SUBSTRATE). The fields that do exactly this: universal document conversion, retro-hardware
ports/demakes, and constrained pixel art. Each contributes a distinct, transferable policy.

### 3.1 Pandoc: a deliberately less-expressive hub AST + an explicit raw escape hatch

- Pandoc's manual states it plainly: "Pandoc's intermediate representation of a document is less
  expressive than many of the formats it converts between, so one should not expect perfect
  conversions… Conversions from formats more expressive than pandoc's Markdown can be expected
  to be lossy" — [Pandoc User's Guide](https://pandoc.org/MANUAL.html). The architecture is
  readers → AST → writers ([Using the pandoc API](https://pandoc.org/using-the-pandoc-api.html)).
- The residual channel is FIRST-CLASS in the AST: `RawBlock`/`RawInline` carry format-specific
  markup that the AST cannot represent, flowing through conversion untouched and emitted only by
  writers of the matching format — [Pandoc Lua filters](https://pandoc.org/lua-filters.html),
  [Pandoc filters](https://pandoc.org/filters.html).
- **Transfer (concrete):** three lessons. (a) HONESTY AS SPEC: document the expressiveness
  ceiling of the Elementor projection the way pandoc does — a written contract of what is lossy,
  per construct class (the atlas in §5 makes it measurable). (b) RESIDUAL AS AST NODE: our
  intermediate capture-tree should carry the residual EXPLICITLY — a `raw` node type (custom CSS
  / raster region) inside the tree, not a post-hoc patch applied after building. Then every
  downstream stage (grader, editor-roundtrip, refine loop) sees and accounts for residual usage.
  (c) Pandoc survives BECAUSE the hub is small: resisting the urge to grow the intermediate
  representation toward "everything HTML can do" is what keeps N readers × M writers tractable.
  Our capture-tree should stay close to Elementor's semantics, not CSS's.

### 3.2 ZX Spectrum attribute clash: design INTO the constraint grid; exploit the renderer to exceed nominal limits

- The Spectrum allowed only 2 colors per 8×8 cell; a third color in a cell overwrites one —
  "attribute clash" — [Wikipedia: Attribute clash](https://en.wikipedia.org/wiki/Attribute_clash).
  Artists' three workarounds: (1) ALIGN the artwork to the cell grid so color boundaries fall on
  cell boundaries ("careful design could achieve impressive results"); (2) dithering within the
  2-color cell (ordered + error-diffusion) to fake intermediate shades; (3) "hi-color" tricks:
  re-write attributes per scanline in sync with the display refresh, effectively turning 8×8
  cells into 8×1 — exceeding the machine's nominal vocabulary by exploiting renderer timing —
  [PixelatedArcade: When Colors Clash](https://pixelatedarcade.com/news/when-colors-clash),
  [Grokipedia: ZX Spectrum graphic modes](https://grokipedia.com/page/ZX_Spectrum_graphic_modes).
- **Transfer (concrete):** (a) BOUNDARY ALIGNMENT is a projection-quality lever we can control:
  choose section/container cut lines to coincide with the source's own visual boundaries (bg
  changes, full-width bands) so Elementor's container edges never land mid-gradient or mid-card —
  misaligned cuts are our attribute clash (visible seams, wrong bg bleed; cf. the tailwind §9
  modalBg over-paint, which was exactly a cut landing inside a split-bg box). (b) The hi-color
  lesson: every rigid vocabulary has renderer-level exploits that expand it (for us: custom CSS
  injection, the HTML widget, per-container background layers). They are legitimate but EXPENSIVE
  (fragile, less editable) — exactly like racing the beam: use them deliberately, budgeted, where
  the atlas says the nominal vocabulary cannot reach (the §6 policy).

### 3.3 Demakes/ports: distill to salient structure when fidelity is impossible — but we must NOT

- Demakes recreate modern games under old hardware limits; the craft is "distilling complex
  modern games into simpler forms," preserving core mechanics/identity over graphical fidelity —
  [TV Tropes: Video Game Demake](https://tvtropes.org/pmwiki/pmwiki.php/Main/VideoGameDemake),
  [Celeste NES demake devlog](https://john-smit.itch.io/celeste-snes-demake/devlog/1312472/porting-it-to-the-nes).
  NES discipline: 8×8 tiles, 3 colors + shared black per sub-palette; "every shading step must be
  a hard edge or a dithered pattern" — [NES palette](https://www.pixel-editor.com/palettes/nes).
- **Transfer (concrete, mostly as a NEGATIVE boundary):** demakes are the regime where the output
  vocabulary is SO much weaker that the goal degrades from reproduction to evocation. Useful as a
  calibration: Elementor+CSS is NOT that weak — the expressive ceiling study already shows most
  static 2026 layouts are reachable (memory: clone_pipeline_architecture, 75%→raised). So when a
  build "demakes" a source (simplifies a layout into a generic 1-col stack), that is a BUILDER
  failure, not a vocabulary ceiling — the abs-responsive ceiling finding showed the 1-col stack
  winning only at 390px, where density physically can't survive. Policy: demake-style
  simplification is permitted ONLY when the atlas proves inexpressibility at that viewport, and
  it must be logged as a residual decision, never silent.


## 4. Round-trip / cycle-consistency — as training signal AND runtime check

### 4.1 What the fields established

- **CycleGAN (vision):** with no paired data, adversarial loss alone can't pin down WHICH output
  an input should map to; adding cycle-consistency loss ‖F(G(x)) − x‖₁ forces G and F to be
  "loose inverses," preserving content through the translation —
  [CycleGAN review](https://sh-tsang.medium.com/review-cyclegan-unpaired-image-to-image-translation-using-cycle-consistent-adversarial-networks-1c2602805be2),
  [PyImageSearch guide](https://pyimagesearch.com/2022/09/12/cyclegan-unpaired-image-to-image-translation-part-1/).
- **Machine translation:** round-trip translation (RTT) as a QUALITY CHECK was long criticized:
  "it is possible to get a good back translation from a bad forward translation" — errors cancel;
  early studies found no correlation with forward quality —
  [Wikipedia: Round-trip translation](https://en.wikipedia.org/wiki/Round-trip_translation).
  Recent work rehabilitates it for NMT (no copy-mechanism flaw) and uses RTT to expose what
  benchmarks miss — [arXiv:2604.12911](https://arxiv.org/html/2604.12911v1); and round-trip
  signal is now used as a TRAINING reward for low-resource MT —
  [Round-Trip RL, arXiv:2601.12535](https://arxiv.org/html/2601.12535v1). Back-translation as
  data augmentation has a known failure mode: weak initial models reinforce their own errors —
  [Investigating Backtranslation, arXiv:1804.06189](https://arxiv.org/pdf/1804.06189).
- **Property-based testing (compilers/serializers):** `parse(print(t)) == t` over GENERATED trees
  is the canonical strongest property ("No Exception → Type Preservation → Invariant →
  Idempotence → Roundtrip" strength hierarchy); generate a random valid AST, print, re-parse,
  compare — [UPenn PLClub: Round-trip properties](https://www.cis.upenn.edu/~plclub/blog/2023-12-07-round-trip-properties/),
  [Testing parsers with PBT](https://parkerlandon.com/posts/testing-parsers-thoroughly-with-property-based-testing).

### 4.2 Transfer — we have THREE distinct round-trips; keep them separate

1. **Render cycle (runtime check, per clone):** capture(source) → build → WP render →
   re-capture → compare against original capture. This is CycleGAN's cycle at inference. CRITICAL
   caveat from MT: error cancellation — a raster-image clone round-trips PERFECTLY visually while
   destroying editability. This is precisely why the deterministic composite must stay as
   rails/veto under the vision-judge headline (memory: vision_judge_pivot, flywheel_objective_grader).
   A round-trip check is only trustworthy when paired with an independent anti-gaming dimension.
2. **Edit cycle (the editability gate):** Elementor doc → editor open → save → doc unchanged
   (lenient hash modulo V4 auto-normalizations — memory: v4_atomic_normalizations;
   `joist_smoke_test_roundtrip` already implements the primitive). This is the PBT
   `parse∘print=id` property, and PBT says how to run it: not just on real clones but on
   GENERATED trees — fuzz random valid widget trees (from the §5 atlas generator), push through
   save/load, and diff. That converts the editability gate from anecdotal to property-tested,
   and directly feeds the PATH_TO_TRUE_1TO1 round-trip ≥90% gate.
3. **Cycle as TRAINING signal (free paired data):** the forward direction (Elementor tree → WP
   render → screenshot/DOM) is deterministic and cheap. Generating random-but-realistic trees and
   rendering them yields UNLIMITED PERFECTLY-PAIRED (render, tree) data for distilling the
   inverse model (capture→tree) — back-translation's trick, with one improvement: our "forward
   translator" is exact (a renderer), so the weak-model-reinforces-itself failure mode of
   back-translation does not apply on the forward side. Bias risk remains on the DISTRIBUTION
   side: generated trees must match real-site statistics or the inverse model overfits synthetic
   style (the classic back-translation domain-mismatch caveat). Seed the generator from the
   corpus's empirical widget/layout statistics.

