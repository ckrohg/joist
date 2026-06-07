# Website-Completeness Grading (research wzdd8xxjs, 2026-06-03)

Adversarially-verified. Answers the user's critique: clones miss nav/footer + the grader has no top-down "is this a complete website" check. Gives a concrete, citable design — AND explains *why our clones lose the header/footer*.

## The metric vocabulary: ARIA landmark roles
The 8 concrete ARIA landmarks are the machine-detectable vocabulary for a page's canonical regions, mapping to HTML5 tags:
- `header → banner` · `nav → navigation` · `main → main` · `footer → contentinfo` · `aside → complementary` · `search` · `form` · `region`

A completeness audit = enumerate source landmarks/components → enforce cardinality → flag any the clone is MISSING.

## THE KEY FINDING — why Joist's clones silently lose header/footer
**`header→banner` and `footer→contentinfo` are CONDITIONAL**: the element carries the landmark role ONLY when it is a **direct child of `<body>` and NOT nested inside `main/article/aside/nav/section`** (MDN/W3C APG verbatim). 

→ **Elementor (and our absolute builder) re-wrap all content in `section`/`container` structures — which DEMOTES the global header/footer to a generic role even when the visual element is present.** That is precisely our bug. Two consequences:
1. **Grader side:** must detect the clone's footer/nav by **position + content** (top band w/ links = nav; bottom band w/ utility links + copyright = footer), NOT by landmark role (Elementor strips it). Check the *source* by role+tag+position; check the *clone* by position+content.
2. **Cloner side:** emit **explicit `role="banner"/"navigation"/"main"/"contentinfo"`** on the right containers (kses-safe — `role=` survives, proven by the tabs recipe) so the clone is both recognizable AND accessible. Plus a real footer/nav component emitter.

## Cardinality rules (enforce in the audit)
- exactly **one** `main`; **at most one** `banner` and **one** `contentinfo`; **many** `navigation` allowed but each should be uniquely labeled. Flag violations.

## Required components (UX/IA authorities — NN/g, Baymard)
Non-negotiable per page: **logo/identity** (upper-left), **primary nav** adjacent to main, **footer on every page** with utility links (**contact, privacy/legal, copyright**), often **social links + newsletter**. Site-wide dialogs: **cookie/consent**, newsletter. Page-type-dependent: hero + primary CTA (marketing/landing), breadcrumbs/search (docs/app), skip-link (a11y).

## Detection recipe
Per page (source AND clone), detect components via: (a) ARIA roles + semantic tags (computed role, not just tag — check body-context); (b) **position bands** (top band = header/nav, bottom band = footer); (c) content signatures (copyright/©/legal text → footer; logo upper-left; link-cluster top → nav); (d) optional vision/UI-element segmentation. axe-core operationalizes via CSS-selector + body-context (`footer:not([role])`, `[role=contentinfo]`).

## Why DOM cloners drop these (failure modes)
sticky/fixed headers (position:fixed → off normal flow), footers below the fold / lazy-rendered (need full scroll), off-canvas/hamburger menus (hidden until toggled), content in web components / shadow DOM, cookie banners in portals/overlays. (Our capture step-scrolls so it reaches the footer content — the loss is at recognition + role-demotion, not capture.)

## The grader dimension (build plan)
`grade-completeness.mjs` (NEW shadow module, mirrors the responsive path):
1. Enumerate SOURCE components (roles + tags + position bands + content signatures): header/nav, logo, hero, main sections, footer + footer sub-parts (footer-nav/legal/social/contact), cookie banner.
2. Detect the SAME in the CLONE — by **position + content** (Elementor strips roles).
3. `completenessScore` = weighted fraction of source components PRESENT + roughly correct in the clone; **heavily penalize missing critical components** (footer, nav, header); enforce cardinality.
4. self-test source-vs-source = 1.0. Smoke: does it correctly FLAG a clone that's missing its footer/nav?
5. Later (supervised): promote into the composite (like responsive), so the flywheel is forced to build complete sites.

Cloner follow-on: emit explicit landmark `role=` on header/nav/main/footer containers + a faithful footer/nav component emitter (the nav-wrap recipe is partial; footer has none).

Related: [[RESPONSIVE_AND_MOTION_GRADING]] · RESEARCH_INFERENCE_AND_METRICS.md
