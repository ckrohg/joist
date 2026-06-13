# Eval Coverage Map — every stone, honestly graded

> The complete surface a "does the build match the source?" eval must cover, with current status. **HAVE** = built + validated. **PARTIAL** = some signal, not rigorous. **MISSING** = not graded at all. Goal: drive every row to HAVE, feed each into the [defect→lesson flywheel](CANONICAL_GRADER.md).

## A. Visual / Design — P0 (pixel-for-pixel)
| # | Dimension | Status | Where |
|---|---|---|---|
| A1 | Layout geometry (position/size/alignment) | HAVE | grader-v2 `geometry` IoU + `perceptual` |
| A2 | Content completeness (all text/sections present) | HAVE | grader-v2 `content` set-diff |
| A3 | Text color (painted, not computed) | HAVE | grader-v2 `textColor` ΔE + painted sampling |
| A4 | Font family (glyph shapes) | HAVE | grader-v2 `textRender` glyph-SSIM |
| A5 | Font size / weight / line-height / letter-spacing | PARTIAL | implied by glyph-SSIM; not measured per-property on painted output |
| A6 | Spacing (padding/margin/gap/vertical rhythm) | PARTIAL | perceptual + geometry; no explicit spacing metric |
| A7 | Gradients (text + background fidelity) | PARTIAL | captured + reapplied; not scored for gradient-accuracy |
| A8 | Imagery fidelity (right image, aspect, crop, sharpness, not placeholder) | HAVE | fidelity-grade real-vs-placeholder/broken + count ratio (per-image SSIM still TODO) |
| A9 | Effects (shadow/blur/filter/radius/opacity/blend) | HAVE | fidelity-grade effect-vocabulary histogram source-vs-clone |
| A10 | Icons / SVG correctness | MISSING | — |
| A11 | Z-order / overlap | HAVE | grader-v2 `layout` overlap |
| A12 | Overall per-region pixel match | HAVE | grader-v2 perceptual (SSIM+ΔE, MIN) |

## B. Responsive
| B1 | Breakpoint snapshots desktop/tablet/mobile | HAVE | committee 3 viewports |
| B2 | Intermediate widths + horizontal-overflow detection | MISSING | — |
| B3 | Reflow correctness (stacks like source) | PARTIAL | committee judges by eye |
| B4 | Touch-target sizing on mobile | MISSING | — |

## C. Dynamic / Motion / Interaction
| C1 | Looping motion (animated gradient/marquee/ticker) | HAVE | dynamic-grade motion gate |
| C2 | Scroll behavior (reveal/parallax/sticky) | HAVE | dynamic-grade scroll states |
| C3 | Hover state | HAVE | dynamic-grade hover deltas |
| C4 | Focus / active / disabled states | MISSING | — |
| C5 | Click-to-reveal (tabs/accordion/modal/dropdown/click-carousel) | MISSING | — |
| C6 | Animation TIMING / easing fidelity (speed+curve, not just presence) | MISSING | we detect presence, not fidelity |
| C7 | Cursor effects (magnetic / custom cursor) | MISSING | — |

## D. Function / Behavior
| D1 | Links resolve / correct hrefs | MISSING | — |
| D2 | Nav works (menu, mobile hamburger) | MISSING | — |
| D3 | Forms (focus/validate/submit) | MISSING | — |
| D4 | JS / console errors on the clone | MISSING | — |
| D5 | Broken assets (404 images/fonts) | MISSING | — |

## E. Performance — user-flagged CRITICAL (load speed)
| E1 | Load time (TTFB, DOMContentLoaded, load) | MISSING | — |
| E2 | LCP (Largest Contentful Paint) | MISSING | — |
| E3 | CLS (Cumulative Layout Shift) | MISSING | — |
| E4 | INP / interactivity | MISSING | — |
| E5 | Page weight (bytes) + request count | MISSING | — |
| E6 | Image optimization (size/format/lazy) | MISSING | — |
| E7 | Render-blocking resources | MISSING | — |
| E8 | Clone-vs-source relative perf | MISSING | — |

## F. SEO / Semantics / Meta
| F1 | Title + meta description | HAVE | seo-grade |
| F2 | Heading hierarchy (h1→h6) | HAVE | seo-grade + a11y-grade |
| F3 | Semantic HTML / landmarks | HAVE | a11y-grade landmarks |
| F4 | Structured data / OG / social | HAVE | seo-grade (JSON-LD + OG/Twitter) |

## G. Accessibility
| G1 | Color contrast (WCAG AA/AAA) | MISSING | — |
| G2 | Alt text on images | MISSING | — |
| G3 | ARIA / roles | MISSING | — |
| G4 | Keyboard nav / focus order | MISSING | — |
| G5 | Reduced-motion respect | MISSING | — |

## H. Round-trip / Elementor-native (product hard requirement)
| H1 | Native widgets, not html-blobs (editable) | PARTIAL | structural |
| H2 | Re-opens in Elementor editor uncorrupted | MISSING (tool exists) | joist_smoke_test_roundtrip not wired into eval |
| H3 | Schema validity / no 422s | PARTIAL | deploy surfaces some |

## Honest tally (updated)
HAVE: ~20 · PARTIAL: ~6 · MISSING: ~20. Now covered: performance + integrity (perf-grade), a11y contrast/alt/semantics (a11y-grade), responsive-overflow (responsive-grade), click-interactions (interaction-grade), SEO/meta/structured-data (seo-grade), effects + real-vs-placeholder imagery (fidelity-grade). Still MISSING: animation-timing/easing fidelity (C6), focus/active/disabled states (C4), touch targets (B4), per-image SSIM (A8 deep), ARIA/keyboard/reduced-motion (G3/G4/G5), round-trip smoke (H2). "100%" still false — but the surface is ~2.5x wider, and every layer feeds the same self-learning flywheel.

## Build order (highest leverage first)
1. **Performance layer (E)** — user-flagged; free to measure. → `perf-grade.mjs`
2. **Function/integrity (D4/D5/D1)** — console errors, broken assets, hrefs; cheap, catches silent breakage.
3. **A11y contrast (G1) + alt (G2)** — cheap, part of "perfect".
4. **Responsive overflow (B2)** + **click-to-reveal (C5)**.
5. **Effects/imagery fidelity (A8/A9)**, **animation-timing (C6)**, **SEO (F)**, **round-trip smoke (H2)**.
