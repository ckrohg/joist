# Clone Pipeline — consolidated state + roadmap

**One-command entry point:** `node eval/grader/clone.mjs --source <url> --page <id> [--mode absolute|hybrid|raster]`
(needs `JOIST_AUTH_B64`; `source /tmp/joist-auth.env`). Orchestrates capture → build → grade → report.

## Architecture (validated)

```
capture-layout.mjs   → robust DOM box-tree (stealth + content-visibility override + click-drive + scroll;
                        mockup text-guard so text sections stay native, not rastered)
   ↓ layout.json
build-{absolute|hybrid|sectionraster}.mjs → Elementor page (PUT via joist API, CAS-retry, edit_mode=builder)
   ↓
grade-structure.mjs  → composite = 0.35·visual + 0.35·editability + 0.10·designSystem + 0.20·responsive
                        (3-term 0.45/0.45/0.10 fallback when responsive unmeasurable; visual<0.5 floor;
                        height-overflow penalty; invisible-text defect penalty — corrected 2026-06-09)
```

### Three builders — when each wins (the router picks by grade)
- **absolute** (default, BEST on most sites): every editable widget pinned to its captured `(x,y,w,h)` via
  Elementor absolute positioning → **1:1 structure AND native/editable**. Cannot overflow (no flow). Backgrounds
  = absolutely-positioned HTML widgets (containers ignore `_position:absolute`; widgets honor it). Real fonts via
  WP Font Library + Elementor Pro `custom_css` `@font-face` (Font Library alone doesn't enqueue on classic themes).
- **hybrid**: editable simple sections + rastered hard sections. Fallback when capture collapses (framer).
- **sectionraster**: full pixel-raster. 1:1 visual, **0 editable**. Last resort for headless-unrenderable sites.

### Flywheel tooling
- `grade-structure.mjs` — the objective function (rewards native editability, not rasterization; honest about
  height overflow). `grade-raster.mjs` — per-band pixel diagnosis. `diag-text.mjs` — splits text loss into
  capture-side vs builder-side. `corpus-run.mjs` — multi-site eval + ranked defect attribution + regression
  suite. `route-clone.mjs` — build N ways, pick best by grade. `font-register.mjs` — WP Font Library registration.
  `compose-overview.mjs` — side-by-side source|clone for LOOK.

## Validated numbers (4-site corpus, absolute builder, honest grader)
| site | composite | visual | editability | note |
|---|---|---|---|---|
| supabase | **0.878** | 0.93 | 0.83 | near-1:1 + editable (real font) — the proof point |
| resend | 0.727 | 0.89 | 0.56 | code-token capture is the tail |
| tailwind | 0.706 | 0.75 | 0.66 | lever = dark-panel backgrounds |
| framer | 0.396 | 0.79 | 0 | capture COLLAPSES headless (router → hybrid 0.509) |

**Adaptive mean (route to best per site) ≈ 0.705**, up from 0.589 (hybrid-only). Pages: tailwind 3146, supabase 2986, resend 2988, framer 2990.

## Hard-won truths (don't relearn these)
- Flow layout (flex/grid) CANNOT hit 1:1 on complex sites — Elementor forces flex children to width:100% →
  multi-column collapses → 2-8x overflow. Absolute positioning is the only structural fix.
- `_elementor_edit_mode` MUST = `builder` or the frontend renders the post_content fallback, not the tree.
- Container padding key is `padding`, not `_padding` (which is widget-only). Containers ignore `_position:absolute`.
- `wp_kses` strips `<style>` TAGS (REST user) — native typography + inline style ATTRS + Pro `custom_css` survive.
- The grader must be honest: it once over-scored a 3x-tall page (height blind-spot) → fixed with a height penalty.

## Roadmap — we still have a REALLY long way to go

> **2026-06-09: superseded by `knowledge/PATH_TO_TRUE_1TO1.md` for roadmap.** The section below is kept as
> historical context; consult PATH_TO_TRUE_1TO1.md for the current plan and workstreams.
**Fidelity tail (per-site, marginal):**
- Code-sample capture (syntax-highlighted token spans in dark editors) — resend/dev-site tail.
- Tailwind dark-panel backgrounds (perimeter-sampled, not whole-box modal which regressed).
- Font auto-mapping: currently the captured leaf-family ↔ real font-file mapping is MANUAL (supabase Circular).
  Automate: extract `data.fontFiles`, match to leaf families, auto-register + inject.

**Big structural gaps (the real distance):**
- **RESPONSIVE** — absolute positioning is DESKTOP-pixel-only; no mobile/tablet reflow. Major gap for a real product.
  Likely needs per-breakpoint capture + per-breakpoint absolute offsets, or a hybrid flow+absolute model.
- **Headless-unrenderable / dynamic sites** (framer, Stripe) — content doesn't render in automated capture.
  Needs headed/human-assisted capture or a heavier interaction harness. Currently router serves hybrid/raster.
- **Whole-site / multi-page** — pipeline clones ONE page; real sites are many pages + shared nav/footer + a Kit.
- **Real-world diversity** — only validated on modern SaaS marketing sites. Untested: e-commerce, forms,
  logins, blogs, dashboards-behind-auth, RTL, non-Latin, heavy-animation/Awwwards.
- **Product wiring** — this is a BENCH of scripts. Integrate into the Joist agent (MCP tools / skill) so it
  runs as an autonomous clone agent, not manual node commands.
- **Editability quality** — editable ≠ well-organized; reconstructed widgets are flat-positioned, not in a
  clean editable container hierarchy a human would want to edit. Structural editability is a separate axis.

## North-star status
Proven that **1:1-visual + fully-editable is achievable on a real flagship** (supabase 0.878). The architecture,
objective function, and flywheel are settled and generalize. The distance left is breadth (responsive, whole-site,
site diversity, product wiring) + the fidelity tail — not a fundamental wall.


---

## Session 2026-06-06 — Structured (reflow) builder: recipe suite + mature grader (15 verified improvements)

**Headline:** the `build-structured` reflow engine + an 8-recipe suite + a 5-dimension grader now clone diverse archetypes to **near-1:1, editable, no-horizontal-scroll, color-accurate, content-complete**. The user's "doesn't feel close" supabase clone went **heightRatio 2.05 (collapsed) → 1.142** (~7x vertical-drift reduction). Generalized with **zero cross-site regression**: supabase 1.142 / tailwind 1.129 / basecamp 1.209.

### Build recipes (in build-structured.mjs — corrected 2026-06-09: all six are now DEFAULT-ON, opt-out via `STRUCT_NO_<RECIPE>=1` or `STRUCT_LEGACY=1` ⇒ byte-identical legacy path; render-validated)
- **STRUCT_GRIDFIX** — dense mixed-size grids collapsed to 1 column (wide media overlapped narrow text); recover columns from narrow-member x-centers → CSS grid. (supabase #2 grids 3→7; root fix.)
- **STRUCT_COLWIDTH** — honor each section's SOURCE content-column width + alignment (height-safe: skip headings that would wrap). area-coverage +22%, zero height regression.
- **STRUCT_LINKCOLS** — long bare-anchor link lists (footer sitemaps) → CSS multi-column. (basecamp footer 2.51→1.09.)
- **STRUCT_BENTOGRID** — tile-bento (heading-x col-anchors × heading-y row-anchors) → CSS grid with col-span. (supabase #2 3.08→1.33, the dominant residual; "bento = architectural" SUPERSEDED — regular tile-bentos are auto-fixed.)
- **STRUCT_IMGFIT** — a section's oversized dominant image (overflowing its source band) clamped object-fit:cover to the band (matches source clip). (supabase #8 3.30→<2.0.)
- **STRUCT_CARDWALL** — heading-less MASONRY card-walls (tweet/testimonial walls; pitch-CV regularity guard) → CSS multi-column; full-bleed backdrop rendered via custom_css background-image (kses-safe). (supabase #9 1.60→1.09, #10 1.46→1.25.)

### Capture recipes (in capture-layout.mjs — corrected 2026-06-09: mixed defaults)
- **CAPTURE_BANDBG** — now DEFAULT-ON (opt out `CAPTURE_NO_BANDBG=1` or `CAPTURE_LEGACY=1`; capture-layout.mjs:1686) — sample each band's TRUE rendered bg from screenshot gutters; adopt dark/colored only (anti-false-darkening). Fixes dark/canvas/gradient sections rendering flat white. (framer 0→3 dark bands; supabase stays light.)
- **CAPTURE_DARK_SCHEME** (was CAPTURE_COLORSCHEME) — still OPT-IN (`CAPTURE_DARK_SCHEME=1`; default no-emulation is grader-aligned) — per-site prefers-color-scheme emulation; dark-default sites (vercel) capture their TRUE dark design; light sites unaffected. (vercel 0→7 dark bands.)

### Grader (grade-spec.mjs) — 5 honest dimensions, anti-gaming proven
structural coverage + textCoverage + **coalescing-aware** one-to-many matching (credits merged-but-present content) + **per-band y-anchor** (credits reflowed-but-present content) + **colorMatch** (redmean ΔE + dark/light agreement; transparent→page-default, not black). Plus **section-spec.mjs** (semantic per-section plan: role/archetype/blocks/styleRefs→globals/responsive/motion — the create_plan analog).

### Discipline (every recipe)
diagnosis (per-section attribution) → build behind default-OFF flag → gate (byte-identical-off + target metric down + no-h-scroll + corpus no-regression) → independent fresh-agent verify → auto-restore on fail. Foundational-file edits (capture-layout/build-structured) backed up + mtime-checked + restored on any failed/aborted run.

### Decisions teed up for the user
1. **FLIP the 8 recipes DEFAULT-ON to ship** — DONE (corrected 2026-06-09): the six build recipes above + STRUCT_SEMANTIC + CAPTURE_BANDBG run default-ON with `STRUCT_NO_*`/`CAPTURE_NO_*`/`*_LEGACY` opt-outs; CAPTURE_DARK_SCHEME stayed opt-in.
2. **Stripe/headed-capture** — JS/canvas-walled dynamic sites render blank/light in headless (vercel light, Stripe blank) ≠ real browser; needs a headed/real-browser capture path (deep, capture-environment).
3. **Truly-irregular bento/image-mosaics** (supabase #4, gcv 0.47) — regular tile-bentos are auto-fixed; genuinely-irregular overlap layouts still need the reflow-vs-positional architectural call (absolute would reintroduce the h-scroll the user hard-vetoed).

### Remaining small residuals (diminishing)
supabase #4 +292px (irregular image-mosaic), #9 +188px (cardwall column-balance), #8 +178px (small band). All <300px; hero/features now 1.02–1.06.
