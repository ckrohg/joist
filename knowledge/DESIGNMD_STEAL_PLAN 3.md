# DesignMD (Crowdlinker) — Steal Plan

@purpose Roadmap of concrete improvements to Joist distilled from reverse-engineering
[designmd.me](https://designmd.me) / `@crowdlinker/designmdme` and the open
[google-labs-code/design.md](https://github.com/google-labs-code/design.md) spec ecosystem
(2026-06-06). The product code is closed/hosted, so steals are the **format + architecture**,
verified against the deobfuscated CLI API calls and the open spec — not hand-waved.

## What it is (reverse-engineered)

DesignMD is a **closed, hosted, paid** spec-generator (4 credits/gen, Google-auth). `npx
@crowdlinker/designmdme <url>` is a thin client over a hosted API. From the deobfuscated
`dist/commands/generate.js` + `dist/lib/api.js`, the server pipeline is **three stages**:

1. `POST /api/analyze-url {url}` → `{generationId, tokens}` — **deterministic scrape → raw design tokens**
2. `POST /api/generate {sourceUrl, tokens}` *(SSE stream)* → the `DESIGN.md` text — **an LLM synthesizes**
   raw tokens into the tokens-front-matter + prose-rationale spec
3. `POST /api/generate-html {generationId}` → `preview.html` — **renders the DESIGN.md back to neutral HTML**
   so the user can eyeball whether the spec captured the look (8 credits; optional)

The **format** is open: `google-labs-code/design.md` = YAML token front-matter + canonical prose body.
Their moat is the hosted prompt + brand + the `VoltAgent/awesome-design-md` corpus — **not** a clever
extractor. The Chrome-extension cousin (`bergside/design-md-chrome`) is **raw per-element collection**
(280-element priority sweep; no primary/bg/accent inference, no scale extraction, no @font-face parse,
no color dedup — verified in `content-script.js`).

**We are NOT behind on capability.** We are a *builder* (capture→native-Elementor→grade, abs-positioning
1:1+editable); they are a *spec-generator* that builds nothing. The relationship is **complementary**:
Joist can *consume* DESIGN.md as input and *emit* it as a user-facing artifact.

The DESIGN.md token schema (open spec):
```yaml
---
name: <string>
colors:   { <token>: <Color> }          # any CSS: "#1A1C1E", "oklch(62% 0.18 250)"
typography: { <token>: { fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, fontFeature, fontVariation } }
rounded:  { sm: 4px, md: 8px }
spacing:  { sm: 8px, md: 16px }
components: { <name>: { backgroundColor, textColor, typography, rounded, padding, size, height, width } }
---
## Overview / ## Colors / ## Typography / ## Layout / ## Elevation & Depth / ## Shapes / ## Components / ## Do's and Don'ts
```
Token references resolve via `{path.to.token}` (e.g. `{colors.primary}`). CLI exports to
**Tailwind v3 JSON, Tailwind v4 CSS, W3C DTCG**.

Status legend: ✅ done · 🔜 wave-1 (cheap, no deps) · ⏭ wave-2 (medium) · 🧱 wave-3 (large) · 🚫 not doing

---

## ✅ 1. Adopt DESIGN.md as our design-system IR — P1+P2+P3 DONE (2026-06-06)
**Shipped:** `eval/grader/designmd.mjs` (pure, dep-free: `emitDesignMd` + `lintDesignMd` + `buildTokenModel` + WCAG `contrastRatio` + a tolerant `parseFrontMatter`). `build-structured.mjs` now emits a `DESIGN.md` next to the capture artifact after `finalizeGlobalTokens()` (offline; runs in dry/selftest/publish; opt path via `--designmd`). Token model = the existing `_colorClusters` (roles→slug token names, collisions deduped e.g. `bg-light-2`) + `_typoClusters` + **P2 NEW** spacing/radius/shadow clustering (`clusterScale`/`clusterShadows`, emit-only, zero render-path effect). Components are synthesized from roles (button/card/heading/body) with better-contrast foreground selection so the contrast lint is honest. **P3** `designmd-lint.mjs` CLI ports the file-only rules (broken-ref, orphaned-tokens, section-order, unknown-key) + contrast/missing-primary/missing-typography/token-summary/missing-sections; exits 1 on any error (gateable).
**Verified:** unit round-trip (emit→lint, 0 errors, orphaned/contrast/broken-ref/section-order all fire correctly on crafted inputs); real dry-build off a capture → 15 color/16 typo/4 spacing tokens, broken-ref clean, lint gate exit codes correct.
**FINDING the IR immediately surfaced:** severe **color-token sprawl** — 15 color tokens, mostly near-duplicate grays (#5B5B5B/#707070/#525252/#666666…). Our Kit-global color clustering (ΔE≤3) is too granular → 12 "orphaned" gray tokens. This is the DRY problem steal #1 promised to expose. **Next lever: tighten color clustering (raise ΔE, or cap to N role-anchored tokens).**
**NOT yet done (follow-ons):** emit only wired into `build-structured.mjs` — `build-hybrid.mjs`/`build-absolute.mjs` have parallel cluster code and need the same 3-line hook (corpus uses build-hybrid, so corpus DESIGN.md emit pending). P4 (consume an external DESIGN.md as token authority) + P5 (Tailwind/DTCG export) deferred. orphaned-tokens is noisy for auto-extracted IRs (few synthesized components) — high-signal for hand-authored/consumed files (P4).

## (original) Adopt DESIGN.md as our design-system intermediate representation (IR)
**Why:** today our capture→build design system is a private blob. Emitting/consuming the open DESIGN.md
schema gets us, for free: token-reference DRY (`{colors.primary}` kills the dedup drift we fight in
extraction), export to Tailwind/DTCG (interop + a non-Elementor escape hatch), and a format our own Joist
agent + external coding agents already understand.
**Where:** the design-system extraction stage feeding `eval/grader/clone.mjs`; emit `DESIGN.md` alongside
the capture-tree artifact. Map our extracted tokens → the schema above.
**Steal, don't copy:** format only (open spec). Our extractor is already ahead of theirs.

### SCOPE (mapped 2026-06-06 — read-only audit of the token data-flow)

**We already have the hard parts.** Token data-flow today:
- `capture-layout.mjs` extracts per-node tokens ad-hoc (`paintOf`/`typo`/`bgOf`/`boxModel` + per-node `radius`,`boxShadow`).
- `section-spec.mjs` `globalSpec()` (L256-263) ALREADY consolidates `{fonts[], typeScale[], palette[], pageBg}` + per-section `styleRefs{colors,fonts}` — schema `section-spec/v1`. **This is the natural DESIGN.md emit anchor.**
- `build-structured.mjs` ALREADY clusters into Elementor Kit globals: `tokenForColor()` (CIEDE2000 ΔE≤3 → `_colorClusters` with named roles: BG Light / Text Dark / Primary / Accent / Muted) + `typoCluster()` (fam/weight/transform/size±1 → `_typoClusters` with full typography settings). **These clusters ARE our canonical, deduped, role-named tokens — the source of truth for emit.**
- PHP `GlobalRefPreferrer.php` + Kit PUT (`/wp-json/joist/v1/kit`) ALREADY implement Elementor global colors/typography + Constraint-#26 literal→`globals/colors?id=` auto-rewrite (ΔE≤5). The **consumption layer exists and works.**
- GAPS: no on-disk design-system artifact; spacing/radius/shadow are NOT clustered (per-element inline); typography globals only matched at build (no post-hoc preferrer).

**Phased plan:**
- **P1 — Emitter (cheap, ~1 file `designmd-emit.mjs`).** Serialize `build-structured.mjs`'s `_colorClusters`+`_typoClusters` → a valid `DESIGN.md` (YAML token front-matter, roles → token names, full typography objects). Generate the canonical prose body (Overview/Colors/Typography/Layout/Components/Do's-and-Don'ts); inject our anti-slop list into Do's-and-Don'ts (overlap w/ steal #5). Write `DESIGN.md` next to the capture artifact in `clone.mjs`. **Unlocks: portable artifact + the product feature ("export cloned site's design system") + the IR file the file-level lint rules need.**
- **P2 — Round out token set (medium).** Add spacing + radius + shadow CLUSTERING (we collect the raw values; cluster like colors/typo) → `spacing`/`rounded` token scales + component shadow tokens. Needed for a complete DESIGN.md and to extend Kit-global dedup beyond color/type.
- **P3 — File-level lint (`designmd-lint.mjs`, cheap once P1 lands).** Port the 4 rules that need a file: `broken-ref` (refs resolve), `orphaned-tokens` (defined, never referenced by a component/section), `section-order`, `unknown-key`. Feed `orphaned-tokens`/`broken-ref` back into `grade-structure.mjs` designSystem dim OR run standalone in `corpus-run.mjs`.
- **P4 — Consume direction (medium, optional/later).** Reader: accept an external `DESIGN.md` as the token AUTHORITY the builder must honor (override extracted tokens) → "bring-your-own design system" / round-trip restyling. Reuses the existing cluster→Kit-global→ref machinery; just swaps the token source.
- **P5 — Export (cheap, optional).** `tokens → Tailwind v3 JSON / v4 CSS / W3C DTCG` serializers. Free interop + non-Elementor escape hatch once the IR exists.

**Recommendation:** **P1 → P3 → P2** first (emit, then unlock file-lint, then complete the token set). P1 is mostly serialization of data we already compute; P3 is the direct payoff that motivated steal #1; P4/P5 are independent follow-ons.
**Decision needed:** how far this pass — (a) P1 only (emit + product artifact), (b) P1+P3 (emit + full file-lint), (c) P1+P2+P3 (complete token set + lint), or (d) add P4 consume.
**Anchor decision (recommended, not blocking):** emit from `build-structured.mjs` clusters (deduped + role-named), shaped like `section-spec` global — NOT from raw `section-spec` palette (un-deduped).

## ✅ 2. Their 9 lint rules → new dimensions in `grade-structure.mjs` (DONE 2026-06-06)
Implemented as a real third composite dimension `designSystem` (10%; visual+editability now 45% each).
`designSystem = 0.35·paletteFidelity + 0.30·typeFidelity + 0.25·contrastPass(WCAG AA) + 0.10·completeness`.
In-page token extraction (palette by painted area, font scale, WCAG contrast pairs, radii, accent-detect)
added to the capture `evaluate()`; node-side fidelity (source↔clone deltaE<12 palette, 2px-bucket type
scale) + intrinsic lint (contrast 4.5:1/3:1-large, missing-primary, missing-typography) → `designLint`
report block. Verified: self-grade (stripe vs stripe) palette/type fidelity = 1.000, contrastPass 0.942
(Stripe's own light-gray text honestly flagged); negative control (stripe vs HN) designSystem 0.986→0.554,
typeFidelity 0.375, contrastPass 0.156 (HN's #828282 gray honestly flagged). Discriminates + honest.
NOT ported (need a DESIGN.md IR file, i.e. steal #1 first): broken-ref, orphaned-tokens, section-order,
unknown-key — they lint a *file*, not a rendered page.

### 🎯 PAYOFF — the contrast dimension caught a real builder bug (fixed 2026-06-06)
The designSystem contrast rule flagged resend (0.148) + framer (0.145) contrast — most text unreadable.
Root cause (found via a new `--dumpContrast` probe in `grade-structure.mjs`): **white-on-white**. Dark-canvas
sites (resend/framer) paint the bg on `<body>`/`<html>` with transparent sections; `build-hybrid` PUT used
`page_settings:{}` and never applied a root canvas bg → light text on the default white floor.
**Fix:** `build-hybrid.mjs` now captures `body/html` bg in the evaluate and paints it on the root container
when non-white (mirrors `build-structured`'s `rootBgFloor`). Results: resend composite 0.614→0.803
(contrastPass 0.148→0.774), framer 0.524→0.628 (contrastPass 0.145→0.961); **corpus mean 0.661→0.735**.
(Honest: contrast gains are 100% the fix; resend's editability jump was from rebuilding with current code.)
Remaining design-system defect: supabase contrastPass 0.612 (light site — separate cause).

Original plan — a ready-made *extraction-quality* QA pass. Port the rule set as grader sub-checks:
- `contrast-ratio` — WCAG AA 4.5:1 on component `backgroundColor`/`textColor` pairs → feeds
  [[grader_honesty_both_directions]] (the local-bg contrast work).
- `broken-ref` / `orphaned-tokens` — design-system coherence (unresolved refs / unused tokens).
- `missing-primary` / `missing-typography` / `section-order` / `unknown-key` — completeness checks that
  flip the same incentive `grade-structure.mjs` already targets ([[flywheel_objective_grader]]).
**Why:** turns "did we extract a coherent design system?" into a measurable grader dimension.
Aligns with [[grader_strictness_is_progress]] — a new honest dimension dropping the headline is a win.

## ⏭ 3. Motion tokens fill a measured blind spot
The Chrome ext captures per-element `transitionDuration/timingFunction` + `animationDuration/timingFunction`.
Crude, but it is *exactly* the vocabulary our grader measures **zero** of today
([[interaction_fidelity_requirement]]). Add raw per-element transition/animation token capture so the
grader can *start* scoring motion fidelity, then route to native settings + the GSAP escape hatch.

## ⏭ 4. Render-back self-check (their stage 3, applied upstream)
Their `/api/generate-html` renders the DESIGN.md → neutral HTML so the user verifies the *spec* before
trusting it. Steal the idea **upstream of Elementor**: render our extracted design system → a naive
neutral HTML and diff it against the source capture. If that fails, the **extraction** is wrong before we
ever touch the builder — isolating extraction error from build error (the attribution `corpus-run.mjs`
currently only does post-hoc). Cheap upstream gate.

## ⏭ 5. `awesome-design-md` = free corpus + "Do's and Don'ts" anti-slop
100+ real brand design systems already in the format → a builder test corpus and a few-shot taste library.
The canonical **"Do's and Don'ts"** prose section is [[taste_anti_slop_rules]] in a form the builder can
read at generation time — encode our anti-slop list there so it travels with the spec.

## 🧱 Product angle (not just internal)
"Export your cloned site's design system as a `DESIGN.md`" is a shippable Joist feature: we already do the
hard part (faithful multi-viewport capture). Emitting the open format makes Joist a *better* DesignMD as a
side effect, and gives users a portable token artifact + Tailwind/DTCG export they can take elsewhere.

## 🚫 Not stealing
- Their extractor / Chrome-ext capture algorithm — ours is ahead (3-viewport, native widget tree, abs 1:1).
- The hosted/paid/credits architecture — irrelevant to our model.
