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
grade-structure.mjs  → composite = 0.5·visual + 0.5·editability (visual<0.5 floor; height-overflow penalty)
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
