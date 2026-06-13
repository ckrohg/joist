# Clerk HERO — closed loop: HTML → Elementor → render (transpilation-loss notes)

<!-- @purpose First real Elementor-render of authored content, end-to-end on the LOCAL Docker
sandbox (no shared-host requests). Records the render path, the honest HTML-vs-Elementor
transpilation-loss delta, and the load-bearing render.mjs fix this loop surfaced. -->

Date: 2026-06-12 · branch `docs-rot-fixes-20260609` · sandbox port 8001 · Elementor 3.28.4 (V3) ·
WordPress 7.0 · hello-elementor · ZERO requests to georges232.sg-host.com.

## What this is
Closes the loop on ONE section. We take the **proven clerk-hero spike** content (the HTML that the
vision judge scored ~82/91 on its HTML render), isolate the HERO section, transpile it to a native
Elementor element tree, and render that tree in **real Elementor** on a local Docker WordPress.
The number we wanted was the *Elementor*-render fidelity for the SAME content — not the HTML-render.

## Inputs
- Source content: `/tmp/htmlfirst/hero.html` (the proven spike) → HERO section extracted to
  `hero-section.html` (same CSS rules as the spike hero; pure CSS, no external images).
- Transpiler: `eval/grader/transpile-html.mjs` (hardened, `--dry-run` → tree.json + report.json).
- Render primitive: `sandbox/render.mjs` (direct postmeta + `wp elementor flush_css`, local only).

## Render path used
**Direct POSTMETA via wp-cli inside the `wpcli-1` container, then `wp elementor flush_css`.**
No app-password, no Joist REST hash-handshake, no plugin dependency — only Elementor itself.
- write `_elementor_data` (the transpiled tree) + `_elementor_edit_mode=builder` +
  `_wp_page_template=elementor_canvas` + `_elementor_template_type=wp-page` + `_elementor_version`
- `wp elementor flush_css` regenerates `wp-content/uploads/elementor/css/post-<id>.css`
- screenshot at 1440 via the grader's playwright install.
This is the canonical primitive (fewest moving parts). The Joist REST PUT path also works on local,
but the postmeta path is the most self-contained.

## Transpiled tree (the artifact)
- `tree.json` — 4 containers, 1 heading, 1 text-editor, 2 buttons, 0 image, 0 html.
- **sha256(tree.json) = `d6afd8e60807bb5d2810271c16b78027636622a86630245e6be31c1b792c8633`**
  (sha1 in report.json = `aba1f80c9c709e1fdde69a7b274338106640b132`).
- Transpiler POLICY/pain: ZERO pain entries; one policy note — the trailing `▾` chevron on
  "Build with agents" correctly became a native button icon (`fas fa-caret-down`, right-aligned).

## THE FINDING — an ID-less tree defeats Elementor's per-element CSS scoping
The FIRST render (`elementor-render-raw.png`) was badly broken vs the HTML ceiling:
- heading rendered **left-aligned and clipped** ("authenticatio" cut off), not centered;
- heading / sub-text / button-row laid out **side-by-side (row)**, not stacked (column);
- the purple primary button rendered **white/ghost** — BOTH buttons came out identical ghost style.

Root cause (verified, not guessed):
- The transpiler emits a tree with **no element `id` fields** ("server assigns ids").
- Elementor's CSS generator scopes each widget's rules to `.elementor-element-{id}`. With no ids,
  `flush_css` emits **bare, un-scoped** rules (literally `.elementor-button{...}`), and the LAST
  one written wins for ALL same-type widgets via the cascade. The generated `post-79.css` contained
  `.elementor-button{background-color:#ffffff}` (ghost) and **did not contain `#6c47ff` at all** —
  the purple was in the *tree* but never made it into the *CSS*. Same mechanism collapsed the
  per-container `flex-direction:column` (only one of four containers kept it → the rest fell back to
  Elementor's `row` default → the layout broke).
- The Joist REST PUT path never hits this because `Document::save()` assigns ids; the **raw-postmeta
  primitive must stamp them itself.**

Falsification: re-rendered the SAME tree with ids assigned → purple came back
(`buttonBg rgb(108,71,255)`), column stacking + centering came back, heading no longer clipped
(`elementor-render-ided.png`). Hypothesis confirmed.

### Fix shipped (load-bearing)
`sandbox/render.mjs` now stamps a stable 7-char `id` on every node (`ensureIds`) before the
postmeta write. Re-running the ORIGINAL id-less `tree.json` through the fixed primitive now
self-corrects → `elementor-render.png` (page_id 81) is the canonical, correct Elementor render.

## Residual transpilation-loss delta (Elementor `elementor-render.png` vs HTML `html-render-1440.png`)
After the id fix, the two renders are near-identical. Measured residuals (1440, computed styles):

| dimension            | HTML (ceiling)                | Elementor                       | delta |
|----------------------|-------------------------------|---------------------------------|-------|
| heading font-size/lh | 64px / 72px                   | 64px / 72px                     | none  |
| heading y / height   | y=121, h=144 (2 lines)        | y=121, h=144 (2 lines)          | none  |
| heading text-align   | center                        | center                          | none  |
| heading font-family  | `ui-sans-serif` system stack  | `"Helvetica Neue"`              | **glyph metrics/weight differ slightly** (transpiler froze the computed first-available family; the system `ui-sans-serif` is unavailable inside WP, so Elementor falls to Helvetica Neue → letters render a touch wider/heavier) |
| sub-text max-width   | 780px → wraps to 2 lines (h52)| 100% → 626px box → 3 lines (h78)| **REAL LOSS** — the 780px constraint lives on an inline `<div style="max-width:780px">` *inside* the text-editor widget, but the widget's own box is 100%; with the system-font swap the text reflows to 3 lines and sits ~26px taller. Visible as a slightly taller, narrower paragraph. |
| sub-text color/size  | #5e5f6e / 17px                | #5e5f6e / 17px                  | none  |
| primary button       | bg #6c47ff, white, 34h, r999, pad18 | bg #6c47ff, white, 34h, r999, pad18 | **none — byte-identical** |
| ghost button + icon  | white, #e3e3e6 border, ▾      | white, #e3e3e6 border, fa-caret-down | none (glyph is FontAwesome caret vs unicode ▾ — visually equivalent) |
| vertical rhythm      | gaps from margins             | gaps from margins               | ~minor (a few px from the sub-text reflow) |

## Honest gaps / caveats
1. **System-font swap is the dominant residual.** Authored CSS uses `ui-sans-serif`/`-apple-system`;
   those don't exist server-side, so the transpiler freezes the *computed* first-available family
   (`Helvetica Neue`) and the render inherits whatever the headless browser has. Real 1:1 needs an
   explicit webfont decision (load the brand font, or pin a known-present family), not a frozen
   system-stack head.
2. **Sub-paragraph width constraint didn't bind the widget.** The `max-width:780px` rides an inline
   style on a `<div>` inside the text-editor HTML rather than the text-editor widget's `_element_width`
   / `max-width` control, so on font swap it reflows. A cleaner transpile would map the paragraph's
   max-width onto the widget box.
3. **This loop is desktop @1440 only.** No responsive breakpoints exercised here (the spike's @1100
   behavior wasn't re-rendered in Elementor in this loop).
4. **Not self-scored.** Per the task, the Elementor-vs-HTML fidelity *number* is left to the separate
   judge — this note describes the delta, it does not grade it.
5. The id-stamp fix is now part of the canonical primitive, so any future transpiled tree (id-less by
   design) renders correctly without the caller having to know about ids.

## Artifacts (this dir)
- `triptych-1440.png` — 3-way: SOURCE (real clerk.com @1440 crop) | ELEMENTOR render | HTML render.
- `elementor-render.png` — canonical Elementor render (page_id 81, fixed primitive).
- `elementor-render-raw.png` — the BROKEN first render (id-less) — kept as the before/after evidence.
- `html-render-1440.png` — Chromium render of the same hero (authoring ceiling).
- `source-hero.png` — real clerk.com hero band @1440 (from the capture).
- `hero-section.html` — the isolated hero input.
- `tree.json` + `report.json` — the transpiled Elementor tree + transpiler report.
