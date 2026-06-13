# Research steals — mid-2026 sweep (cloning, design-to-code, responsive)

Full sourced report in journal 2026-06-10; this is the actionable distillation. Ranked.

## Headline validations
1. **HTML-first pivot validated twice externally**: Builder.io Visual Copilot = specialized model → deterministic compiler → LLM polish (nondeterminism confined to a constrained IR); shipping plugin **AI to Elementor** already transpiles v0/Bolt/Lovable HTML → native Elementor flex containers with a published mapping table. The transpile half is a solved shape; differentiation = upstream faithful authoring + honest grading, downstream round-trip editability + responsive.
2. **Nobody infers breakpoints from pixels.** Industry answers: (a) extract media-query rules from SOURCE CSS at capture (Perfect-Web-Clone — applies directly to cloning); (b) train flat→flex-hierarchy models (Builder.io); (c) author flow HTML and let it reflow (v0/Lovable ~71-72% fidelity ceiling). → E′ update: per-element matched-media-rules at our 3 captured viewports → diff → Elementor `_tablet`/`_mobile` controls = the PRIMARY deterministic responsive channel; tri-viewport correspondence verifies; box-tree recursive flex grouping (READ/SSH-AE lineage) is the fallback where source CSS is unreadable.
3. **Refine-loop science matches our experience**: ~3 cycles max (+10-18%); absolute visual judges are noisy → **judge candidate-vs-incumbent PAIRWISE** (UI2Code^N RVPO) for keep/revert; visual pressure DEGRADES code quality unless the judge holds a structure axis (our editability dim is the published fix nobody else has); multi-axis judges 69.5% human agreement vs 48.5% single-score (CITL); rubric-itemized judging hits 96% (WebVR). Zero-reward invalid renders + monotonic accept (ReLook) = our KEPT discipline, formalized. Distillation captures only ~25% of late-cycle gains — keep critics in the loop.

## Transpiler spec (steal #1 — AI to Elementor's table + contract)
Mapping: h1-h6→Heading, p/span→Text Editor, styled a→Button, img→Image, iframe→Video, hr→Divider, details→Accordion, div/section/article→Flex Container; resolve CSS vars + clamp() to computed; Google Fonts auto-register. THE AUTHORING CONTRACT (prompt-side for our vision model): single-file HTML, embedded CSS, flex-first (we can also target Elementor grid containers — their "no grid" claim is stale), fixed px, ≤4 nesting levels. Their gaps = our edge: desktop-only, HTML-input only, no capture, no grading loop, no round-trip.

## Other adopted steals
- **Block merge → Elementor global widgets/saved templates** (ComUICoder): detect repeated cards/sections in capture, emit ONE pattern instantiated N times → editability + multi-page consistency. Our DOM capture-tree gives ground-truth section boundaries (their weakness is heuristic segmentation).
- **Semantic labeling pass** (ScreenCoder): label header/sidebar/footer/main before emission → correct Elementor document parts (header/footer templates vs page content).
- **Per-section divide-and-conquer generation** (DCGen, +14-15%) = our quadrant/see-fix loop, externally confirmed.
- **CITL defect taxonomy** for judge categories: visual polish 42.8%, missing elements 25.6%, implementation 18.9%, content 5.6%, responsive 0.9%.
- **Angie PCM consolidation** (Elementor Engineers): collapse atomic MCP tools into ~10 category tools w/ action enums → 1.96x faster, 3.17x cheaper — apply to Joist MCP if planner confusion appears.
- **Royal Plugins clone-and-customize**: ID-regeneration + opaque-internals swap = cheap variant-page capability; their "build-from-scratch JSON is brittle" validates our lenient-hash/V4 work.

## Competitive standing (our uncontested edges)
- 10Web recreate: no fidelity metric, JS-heavy sites degrade, hosted lock-in. Web2Elementor: zero technical transparency. same.new: React output, no CMS editability. msrbuilds-mcp v2.2: ~120 tools, still no responsive tools, no cloning/grading. Angie: 2.4★, unreliable for production builds.
- **Nobody has: a fidelity grader, responsive output, or round-trip discipline.** Our grader honesty + editability axis + responsive dimension are ahead of the field.
