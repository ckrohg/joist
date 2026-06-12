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

