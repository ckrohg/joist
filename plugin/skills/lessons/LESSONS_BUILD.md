# Lessons — Build (reference signal = brief + taste rubric)

Lessons about blank-screen generation, where there is **no source** to match. The grader's
ground truth is the user's brief plus the `elementor-critique` 7-axis taste rubric (design
quality, originality, craft, functionality, brand fidelity, widget-pack utilization,
anti-slop). Read alongside `LESSONS_MECHANICAL.md` before authoring.

Because there is no objective pixel target, the **separation of generator and evaluator is the
lever** — the generator skews positive on its own work (Anthropic verified). The evaluator must
disagree well. See `plugin/skills/elementor-critique/SKILL.md`.

---

## (seed) The build grader's reference is the brief, not a screenshot

**Status:** principle, not yet a battle-tested lesson
**Insight:** Clone grading asks "does this match the source?" Build grading asks two different
questions: (1) does this satisfy the *brief* (right sections, right intent, right audience),
and (2) is it *good* (taste rubric)? A build can be 95% on craft and still fail the brief if it
built a SaaS hero for a dental-clinic prompt.
**Implication:** The build loop needs BOTH a brief-satisfaction check and the taste rubric —
and they're scored separately. A high taste score on the wrong page is still a miss.

---

## (seed) Forced-Optimization gate prevents critique-loop degradation

**Status:** principle (from Wave 9 research, failure-mode #21)
**Insight:** Naive critique→revise loops can *degrade* output — the generator chases the
critic's notes into a worse local optimum. VisRefiner (Feb 2026) and the AesEval-Bench work
both cite this.
**Implication:** A build revision that scores worse than its predecessor must be rejected, not
shipped. Keep the best-so-far; only accept a revision that strictly improves the gated score.

---

*This file is intentionally thin — the build loop hasn't been run under measurement yet. The
baseline sweep will populate it. Mechanical gotchas discovered during a build run go in
`LESSONS_MECHANICAL.md`.*
