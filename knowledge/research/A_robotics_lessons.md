# Track A — Robotics Cross-Embodiment Lessons for Website→Elementor Cloning

@purpose Research notes: how robotics solves "unconstrained input embodiment → constrained output embodiment",
and what transfers concretely to cloning arbitrary websites through Elementor's rigid widget/container vocabulary.

## The Problem Frame (keep central)

Websites are built in infinitely many ways — arbitrary DOM, frameworks, canvas, CSS tricks (unconstrained INPUT
embodiment). We must reproduce the EXACT rendered result through Elementor's rigid widget/container vocabulary
(constrained OUTPUT embodiment). We cannot change the input.

Robotics has the same shape: humans (and other robots) demonstrate tasks with bodies we don't control —
five-fingered hands, 7-DOF arms, full bodies in video — and the learner must reproduce the *outcome* with a
different, usually poorer, actuator set (2-finger gripper, 6-DOF arm). The field's 2020–2026 arc is essentially
a list of answers to: "what do you copy, what do you refuse to copy, and in what space do you plan?"

Mapping used throughout:

| Robotics | Website→Elementor |
|---|---|
| Human/demo embodiment (hands, body, other robots) | Source site's DOM/CSS/framework mechanism |
| Robot embodiment (gripper, joint limits) | Elementor widget/container vocabulary + kses + schema |
| Task space / outcome (object poses, scene change) | Rendered pixels at each viewport (screenshots, text, boxes) |
| Joint space / mechanism (motor commands) | Widget tree JSON, container nesting, settings |
| Retargeting (mapping human joints→robot joints) | DOM-tag→widget mapping heuristics |
| Teleoperation (collect data IN robot action space) | Authoring directly in Elementor + grading rendered result |
| Action head / discretized action manifold | Constrained decoding into valid widget schema |
| World model / MPC | Predict-then-verify: render preview, grade, revise |

Sections below: (1) learning from human video, (2) embodiment-agnostic intermediate representations,
(3) the ALOHA/teleop lesson, (4) Open X-Embodiment pooling, (5) VLA action-decoding constraints,
(6) world models & MPC. Each ends with **Transfer** — the concrete steal.

---
## 1. Learning from Human Video — Retargeting Across a DOF Gap

**What the field found (2020–2026):**

- The canonical survey ([From Human Videos to Robot Manipulation, arXiv 2606.00054](https://arxiv.org/html/2606.00054v1), [project page](https://aaronfengzy.github.io/HumanCentricToVLA-Survey/)) classifies all approaches to bridging the human→robot embodiment gap into **four routes**: (a) latent action abstraction, (b) predictive world modeling, (c) explicit 2D cues (keypoints, flow, trajectories), (d) explicit 3D structure. All four are ways of NOT copying the human mechanism directly.
- **Kinematic retargeting** (map human joints/fingertips → robot joints; DemoDiffusion, OKAMI, R+X, EgoZero) is the naive route and the survey's verdict is blunt: "embodiment and viewpoint mismatches make retargeting **under-constrained** and observations inconsistent. More robust transfer likely requires … **representations anchored to interaction outcomes instead of appearance**."
- Five-finger→two-finger retargeting fails specifically because matching *shape* (fingertip positions) does not preserve *function*: "kinematic motion alone does not establish stable contacts" ([Kinematic Motion Retargeting for Contact-Rich Manipulation, arXiv 2402.04820](https://arxiv.org/pdf/2402.04820)). The 2026 fix, [GenHand (npj Robotics)](https://www.nature.com/articles/s44182-026-00076-1), optimizes **force closure** (the outcome property: "can the contacts resist any external wrench") with kinematic similarity only as a *secondary* regularizer.
- One-demonstration transfer works when sim/RL is used to *re-solve* the task under the robot's own constraints rather than replaying the human's motion ([Human2Sim2Robot, arXiv 2504.12609](https://arxiv.org/pdf/2504.12609)); modular pipelines filter human-video-derived plans by *simulated outcome success*, not by motion similarity ([arXiv 2602.13197](https://arxiv.org/pdf/2602.13197)).

**The shape of the lesson:** when source and target embodiments differ in DOF, *similarity of mechanism is the wrong objective*. The winning objective is always an outcome invariant (contact/force closure, object pose change), with mechanism-similarity demoted to a tiebreaker/regularizer.

**Transfer to website→Elementor:**

- DOM→widget tag-mapping heuristics (`<nav>`→nav widget, flex div→container) are *kinematic retargeting*: under-constrained for exactly our reasons — infinitely many DOMs render identically, and matching DOM "shape" does not preserve rendered function. Expect them to fail the same way fingertip-matching fails: plausible structure, broken outcome (overlaps, wrong wrap, dead hero).
- Our "force closure" = a **rendered-outcome invariant**: per-band pixel/box/text equivalence at each viewport. Optimize that; let structural similarity to the source DOM be at most a tiebreaker (prefer semantically matching widget *when outcomes tie* — for editability, not fidelity).
- The Human2Sim2Robot pattern = our refine loop: don't replay the source's "motion" (DOM); re-solve the layout inside Elementor's constraint set, scored by the simulator (headless render + grader). This is already the pipeline's direction (capture-tree → native tree → grade → refine) — robotics says it's the *only* route that survived.

---

## 2. Embodiment-Agnostic Intermediate Representations — Plan in Task Space, Not Mechanism Space

**What the field found:**

- The converged 2024–2026 answer to cross-embodiment transfer is a **mid-level, object-centric representation** that excludes the embodiment entirely: object keypoints, sparse/dense optical flow, object-part scene flow, 3D object trajectories ([Embodiment-Agnostic Representations overview](https://www.emergentmind.com/topics/embodiment-agnostic-representations); [Object-Part Scene Flow, arXiv 2409.10032](https://arxiv.org/pdf/2409.10032); [3DFlowAction, arXiv 2506.06199](https://arxiv.org/html/2506.06199v1); [Dream2Flow, arXiv 2512.24766](https://arxiv.org/pdf/2512.24766)).
- The key design move: "flows defined on scene elements **excluding robot embodiments**, enabling fully object-centric and embodiment-agnostic task specifications." You describe *what the world should do*, never *what the body should do*. Any body that produces the same scene flow has succeeded.
- [RT-Trajectory (arXiv 2311.01977)](https://arxiv.org/abs/2311.01977) ([site](https://rt-trajectory.github.io/), [DeepMind](https://deepmind.google/research/publications/48757/)) is the sharpest datapoint on *granularity*: language conditioning ("pick up the cup") under-specifies; full joint trajectories over-specify. A **coarse 2D trajectory sketch** in task space "strikes a balance — detailed enough to express low-level motion-centric guidance while coarse enough to allow the learned policy to interpret it in the context of situational visual observations." It beat both language- and goal-image-conditioned policies on unseen tasks *with the same training data*, and sketches can come from humans, LLMs, or image-generating VLMs.
- WHY task-space planning beats mechanism imitation: (a) the task-space signal is *shared* across embodiments, so data/skills pool (see §4); (b) it is *checkable* — outcome achieved or not, no correspondence problem; (c) it leaves the target's controller free to satisfy its own constraints (joint limits / widget schema) without fighting an over-specified plan.

**Transfer to website→Elementor:**

- Our embodiment-agnostic representation already exists: the **capture tree** (per-band boxes, text, colors, imagery at 3 viewports). The robotics lesson is to treat it as the *interface contract*: everything upstream (any DOM/framework) compiles INTO it; everything downstream (any builder — absolute, hybrid, per-breakpoint) compiles OUT of it. Never let a builder peek at raw DOM mechanism.
- RT-Trajectory's granularity lesson maps to plan representation for the refine loop: don't hand the builder a pixel-perfect target alone (over-specified, like a joint trajectory — forces rasterization) and don't hand it "make a hero section" (under-specified, like language). The sweet spot is a **coarse layout sketch in outcome space**: band boxes + role labels + key text + alignment relations, letting the Elementor-side "controller" choose widget mechanics. This is precisely why grade-structure's composite (visual+editability) flipped the rasterization incentive — it scores outcome while keeping the output embodiment's own constraint (editability) in the objective.
- Scene-flow-for-motion maps to the interaction-fidelity gap: represent hover/scroll behavior as *element-trajectory deltas* (what moves/fades, when), not as the source's JS/CSS mechanism — then re-author with native Motion Effects or the GSAP escape hatch.

---
