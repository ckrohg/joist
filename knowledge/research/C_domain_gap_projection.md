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

