# Joist Eval Corpus — the frozen golden set

> **Status: DRAFT — awaiting confirmation of URLs/briefs before freeze.**
> Once frozen, this set does not change casually. It is the fixed yardstick: we re-run it after
> every lessons-corpus change to confirm the score trajectory actually climbs (Forced-Optimization
> discipline). Changing the corpus invalidates cross-run comparison, so changes are versioned.

## Why a frozen set

To date, essentially all Joist testing has hit **two sources** (peakinteractive.io, stripe.com)
across 46 pages. That measures those two sites well and the general case poorly. The corpus fixes
two things at once:
- **Coverage** — span the difficulty ladder AND the real ICP (agency / small-business sites), not
  just famous SaaS marketing pages.
- **Repeatability** — a held-out set means we can tell whether a new lesson *actually* helps or
  just overfits the last site.

Each entry has an **expected ceiling** (from the SKILL fidelity matrix). The baseline measures how
close we get to ceiling today; the gap is the work.

---

## A. CLONE corpus — 8 sources across difficulty × ICP

Reachability is curl-verified before freeze (`curl -sI` → 200, body not JS-only). Swap any URL
that's paywalled or client-rendered.

**FROZEN 2026-05-31 (v1).** All curl-verified 200 + server-rendered. ICP slots use reachable
stand-ins (aspendental/mrrooter) — swap for real local competitors later without bumping the version
if archetype-equivalent.

| # | Source | Archetype | Tier | Expected ceiling (V3 free / +custom CSS) | Role |
|---|---|---|---|---|---|
| C1 | aspendental.com | Dental clinic (professional services) | Static editorial | 88–94% | ICP-real, easy |
| C2 | mrrooter.com | Plumbing/trades service | Static / mild | 85–92% | ICP-real, easy |
| C3 | basecamp.com | Opinionated editorial marketing | Static editorial | 88–94% | Calibration, easy |
| C4 | stripe.com | B2B SaaS, mild motion | Standard SaaS | 75–85% | **Regression anchor** (cloned x2) |
| C5 | hellomonday.com | Agency, mild–med motion | Standard SaaS | 70–82% | ICP-real, medium |
| C6 | peakinteractive.io | Agency, motion-heavy | Motion-heavy | 50–65% / 70–80% | **Regression anchor** (primary subject; v7=78) |
| C7 | cuberto.com | Awwwards motion agency | Motion-heavy | 45–60% / 65–78% | Motion stress test |
| C8 | bruno-simon.com | WebGL / Three.js portfolio | Interactive / 3D | 25–40% | **Honest-floor calibration** |

C4 + C6 are deliberately reused so we can confirm we haven't regressed against the best scores
already achieved (stripe v2; peakinteractive v7 = 78). C1/C2/C5 are the ICP-real additions — the
sites Joist's actual buyers will clone. C7/C8 calibrate the honest floor so the grader doesn't
inflate on hard sources.

---

## B. BUILD corpus — 6 blank-screen briefs (ICP archetypes)

No source. Graded on (1) **brief satisfaction** (right sections/intent/audience) and (2) the
`elementor-critique` **7-axis taste rubric**, scored separately. A high taste score on the wrong
page is still a miss.

| # | Brief (one line, as a user would type it) | Tests |
|---|---|---|
| B1 | "Homepage for a modern dental clinic — book-appointment focus." | Local-service archetype, single clear CTA |
| B2 | "Portfolio landing for a freelance brand designer." | Editorial/visual, originality axis |
| B3 | "Landing page for a B2B project-management SaaS." | Most-common archetype; slop-magnet (anti-slop axis) |
| B4 | "Homepage for a neighborhood Italian restaurant." | Imagery-led, warmth of voice |
| B5 | "Pricing page for a SaaS with 3 tiers." | Structured layout — columns/tables, functionality axis |
| B6 | "Homepage for a boutique strategy consultancy." | Trust/credibility, restraint (anti-slop) |

---

## C. EDIT corpus — 6 scenarios (intent + regression + taste)

Each runs against a known existing page (we'll fix the target page_ids at freeze). The set is
designed to immediately answer the open question: **is in-place edit even supported, or is the
executor insert-only?** (see `LESSONS_EDIT.md`).

| # | Edit intent | Expected blast radius | Tests |
|---|---|---|---|
| E1 | "Change the hero headline to '<X>'." | 1 text node | Targeted intent; zero collateral |
| E2 | "Make all the primary buttons larger and rounder." | N button nodes (style) | Style cascade; regression on non-buttons |
| E3 | "Add a 3-testimonial section just before the footer." | +1 section (insert) | Insertion — the executor's native mode |
| E4 | "Remove the pricing section entirely." | −1 section (delete) | **Deletion — does insert-only executor support it?** |
| E5 | "Swap the order of the features and about sections." | reorder, 0 content change | **Move — supported? tree integrity preserved?** |
| E6 | "Rewrite the about-section copy in a more formal voice." | M text nodes, 0 structure | Multi-node content edit; structure must not drift |

E4 and E5 are the load-bearing tests. If they fail because the executor is insert-only, that is the
#1 finding of the whole sweep and it sets the edit-loop architecture.

---

## Scoring protocol (all modes)

- **Honest scores only.** Inflation defeats the loop. If it's 60% as good, it's a 60.
- Clone: `overall_score` + `estimated_fidelity_breakdown` + `motion_scores` (per SKILL Phase 5).
- Build: `brief_satisfaction` (0–100) + `taste_composite` (elementor-critique 7-axis, min-floored).
- Edit: `intent_satisfied` (bool + 0–100) + `regression_score` (100 = zero unexplained tree delta,
  drops per unexplained changed node) + `taste_delta` (did it get better/worse).
- Results land in `eval/BASELINE.md` as a dated table with the score trajectory per entry.

## Freeze checklist

- [ ] URLs C1, C2, C5, C7, C8 chosen + curl-verified reachable
- [ ] Build briefs confirmed (swap any that aren't ICP-representative)
- [ ] Edit target page_ids fixed
- [ ] Corpus version stamped (v1) — future changes bump the version
