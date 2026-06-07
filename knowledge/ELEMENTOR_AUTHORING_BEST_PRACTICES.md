@purpose: Senior-Elementor-dev checklist of cross-cutting authoring rules that Joist's clone-specialized layer does NOT already encode — edit-safety, WP non-page surfaces, build taste, plus standard CWV/a11y/SEO/hierarchy/anti-slop hygiene. Each rule = one actionable line + WHY + the Joist path it improves.

> Distilled from external skills (jezweb `wordpress-elementor` / `wordpress-content`, Anthropic `frontend-design`) on 2026-06-05 to **complement, not replace**, the clone-specialized layer (`LESSONS_*.md`, `CLONE_METHODOLOGY.md`, `MOTION_PLAYBOOK.md`, widget references). Only rules genuinely absent from those docs are kept here. When a rule below sharpens a specific loop, the named seed belongs in that loop's `LESSONS_*.md`; this file is the senior-dev spine they hang off.

---

## Edit-safety (HIGHEST VALUE — collateral-damage vectors the per-page diff is blind to)

- **Global-widget blast-radius guard — check before you touch.** Before editing any node, detect whether it is a GLOBAL widget (its source is `post_type=elementor_library` with `_elementor_template_type=widget`, embedded by reference). If so, the edit silently rewrites EVERY page that embeds it — treat it as a multi-page change and confirm scope before patching.
  - *WHY:* Joist's `PatchEngine` snapshots + rolls back the ONE page it targets, so the `LESSONS_EDIT` regression axis (a before/after diff of a single page's tree) cannot see a change that propagates site-wide. A global-widget edit looks clean on the audited page and corrupts N others — a true data-loss vector, and round-trip editability is a hard product requirement.
  - *Improves:* `edit` — add this guard as the first step of Phase 0, before any op authoring; seed it into `LESSONS_EDIT.md`.

- **A global-widget edit is a deliberate site-wide operation, not an accident.** If the user genuinely wants the change everywhere, editing the global once is the RIGHT tool; the failure is doing it unknowingly. Surface "this is a global — N pages affected" and get intent.
  - *WHY:* The same mechanism is a footgun or a feature depending only on whether scope was confirmed. Senior devs make the blast radius explicit instead of discovering it in production.
  - *Improves:* `edit` — turns the guard above into a decision, not just a block.

## Build-from-prompt completeness (non-page WP surfaces Joist's page-tree model never touches)

- **Header nav often lives in a WP menu OBJECT, not the page tree.** On a Hello-theme site whose header is a Theme-Builder template, the nav is frequently a real `wp_nav_menu` the theme renders. Change links via `wp menu item add-post|add-custom|add-term|update --position|delete` (or REST), NOT by editing the Elementor tree.
  - *WHY:* Joist's entire model assumes nav lives in an Elementor container / nav-menu widget. Editing the page tree there does nothing — the rendered nav is a menu object. There is currently zero coverage of the WP menu surface, a structural gap for whole-site / header work.
  - *Improves:* `build-from-prompt`, `edit` — add the `wp menu` surface to the toolbelt; seed into `LESSONS_BUILD.md`.
  - *Gotcha:* `GET /wp/v2/navigation` only returns FSE block navs. CLASSIC menus (the common case on Hello/Theme-Builder sites) are NOT in that endpoint — use `wp menu` / `wp menu item`.

- **Set the featured image (`_thumbnail_id`) on every delivered page.** After importing media, run `wp post meta update {id} _thumbnail_id {att_id}` (or REST `featured_media`). This is separate from any in-page Elementor image widget.
  - *WHY:* A page can look perfect in Elementor yet have no `_thumbnail_id`, so its OG/social card, blog-grid thumbnail and theme-header image are all blank. Senior-dev-complete delivery wires the post thumbnail; Joist uploads images into the tree but never sets this meta.
  - *Improves:* `build-from-prompt` — completeness step at publish time; seed into `LESSONS_BUILD.md`.

## Build-from-prompt taste (Anthropic frontend-design — affirmative direction, not just anti-slop)

- **Commit to ONE bold aesthetic axis per page; never converge to a default.** Before authoring, pick a single extreme direction (brutalist / editorial / luxe-minimal / maximalist / retro-futurist …) and lean all the way in. Deliberately VARY the axis across generations so two prompts never produce the same look.
  - *WHY:* Generators regress to a safe mean (the named anti-default: Space Grotesk + purple-on-white centered hero). Anti-slop rules say what to refuse; this is the affirmative complement — what to actively commit to. A committed extreme reads as designed; a hedged blend reads as generated.
  - *Improves:* `build-from-prompt` — pairs with the existing 7-axis taste rubric (originality / craft); seed into `LESSONS_BUILD.md`.

---

## Standard hygiene (senior-dev checklist — applies to every authored page; lower novelty, still worth the gate)

### Responsive
- **Author mobile first, then layer up.** Set base (mobile) values, then desktop overrides — Elementor's cascade inherits down, so unset breakpoints fall through cleanly. *WHY:* matches the documented Elementor cascade (mobile = base), fewer per-breakpoint overrides to drift. *Improves:* all paths' responsive grading.
- **Never lock heights/widths in px where content reflows.** Prefer min-height + auto, `%`/`vw`/`rem`; reserve fixed px for absolute-positioned desktop-pixel clones only. *WHY:* fixed px is the #1 source of mobile overflow and clipping. *Improves:* `build`, `hybrid` responsive axis.

### Performance / Core Web Vitals
- **Width-size and lazy-load all but the LCP image; the hero/LCP image must NOT be lazy-loaded.** *WHY:* lazy-loading the LCP element delays it and tanks LCP. *Improves:* `build-from-prompt` delivery quality.
- **Reserve space for media (explicit dimensions / aspect-ratio) to kill CLS.** *WHY:* late-loading images without reserved boxes shift layout — a direct CWV penalty. *Improves:* `build`, `clone` post-import.

### Accessibility / WCAG
- **One `<h1>` per page; headings descend without skipping levels.** *WHY:* screen-reader/document outline + an SEO signal; Elementor lets you pick any tag per widget, so it's easy to ship five h1s. *Improves:* `build` hierarchy axis, `clone` structural fidelity.
- **Body text ≥ 4.5:1 contrast, large text ≥ 3:1; never convey meaning by color alone.** *WHY:* WCAG AA floor; the local-bg contrast grader already enforces this — authoring should pre-satisfy it. *Improves:* all paths.
- **Every image needs intentful `alt`; decorative images get empty `alt=""`.** *WHY:* missing/auto-filename alt is both an a11y fail and an SEO miss. *Improves:* `build`, `clone`.

### SEO
- **Set the SEO title + meta description as post fields, distinct from the on-page H1.** *WHY:* the H1 is for readers, the title tag is for SERP/OG; they are different surfaces and both must be filled. *Improves:* `build-from-prompt` completeness (pairs with the featured-image rule).

### Hierarchy / craft
- **Establish ONE type scale and ONE spacing rhythm per page; reuse, don't reinvent per section.** *WHY:* inconsistent scales are the loudest "generated" tell; a single ratio reads as designed. *Improves:* `build` craft axis. (When the V4 site supports it, express these as Variables / a Global Class rather than N inlined copies — see RESEARCH_FINDINGS D6.)

### Anti-slop (affirmative-direction reminders that complement taste_anti_slop_rules)
- **Asymmetry and intentional negative space over centered-everything.** *WHY:* dead-center stacks are the default-generator signature; deliberate offset reads as composed. *Improves:* `build` originality axis.
- **Differentiate section rhythm — don't ship N identical full-width bands.** *WHY:* uniform band stacking is template-slop; vary width, alignment, and density to create pace. *Improves:* `build` craft/originality.
