# Per-Breakpoint Capture — Stage 1 (detailed)

@purpose Detailed design for Stage 1 of the per-breakpoint arc (parent: [[PER_BREAKPOINT_CAPTURE_SCOPE]];
Stage 0 = GO, [[../../knowledge/abs_responsive_ceiling]]). Stage 1 builds the **unified multi-breakpoint
leaf model + the cross-breakpoint matcher** — the make-or-break primitive Stage 0 named. It does NOT build
the page (that's Stage 2); its deliverable is the *model* + a *measured matching accuracy*.

## Deliverable

A `reconcile-breakpoints.mjs` that takes three single-width captures and emits a **unified leaf model**:
```
leaf = {
  key,                         // stable cross-breakpoint identity
  kind, content,               // 'heading'|'button'|'text'|'image'|… + text/src
  band,                        // matched band index
  box:     { 1440, 768, 390 }, // captured box per width  (null if absent at that width)
  typo:    { 1440, 768, 390 }, // captured font-size/line-height/weight per width
  visible: { 1440, 768, 390 }, // present-and-visible per width
  confidence,                  // match confidence (so Stage 2 can degrade, not mis-pin)
}
```
plus a **matching-accuracy report** (% of desktop content leaves confidently matched @390/@768).

## Grounding (verified)

- Leaf descriptor (`capture-layout.mjs`): `{ kind, tag, box{x,y,w,h}, text, level, href, paint, typo{family,
  size,weight,style,lineHeight,letterSpacing,transform,align}, src, alt, … }`. `root` is a container tree;
  leaves are terminals. → matching signals available: **text, src/alt, kind/tag, box, band/order**.
- Builder (`build-absolute.mjs`) consumes `n.box` (abs-pin) + `nativeTypo(n)` (from `n.typo`) + `n.src`. So
  the model just needs per-width `box` + `typo` + `visible` attached to each identified leaf.
- kses channels (Track C + Stage 0): **position → `custom_css @media`** (offset keys are stripped; Stage 0
  proved the @media override). **Typography → NATIVE responsive keys** (`typography_font_size_mobile/_tablet`
  already used by build-flow and survive kses) — cleaner than custom_css for type. So Stage 2 emits position
  via custom_css and typography via native `_mobile/_tablet` keys.

## Components

### 1a. Multi-breakpoint capture — `capture-multi.mjs` (wrapper, low-risk)
Run the EXISTING `capture-layout.mjs --width {1440,768,390}` three times (do NOT refactor the tuned
single-width capture — it carries heavy scroll/reveal/lazy-load handling that must run per width). Output
`{ w1440, w768, w390 }`. Cost: 3× capture (~30–60s each). Risk: a site serving different content under
repeated headless loads — capture each width in a fresh isolated context (already the pattern).

### 1b. The matcher — `reconcile-breakpoints.mjs` (the make-or-break)
1. **Flatten** each width's `root` to a flat leaf list (reuse the builder's flatten), keeping band
   (top-level container index) + DOM order.
2. **Match bands first** across widths — top-level sections are the stable scaffold. Match by content
   signature (concatenated text / dominant image / order). Detect 1:1, **split (desktop band → 2 mobile
   bands), merge**, and unmatched. Band correspondence constrains leaf matching (only match leaves within
   corresponding bands).
3. **Match leaves** within corresponding bands by **scored bipartite assignment** (greedy/Hungarian),
   signals weighted:
   - exact normalized-text match → strong (text/heading/button)
   - `alt` + position match → strong for **images** (NOTE: `src` differs per width via srcset/`currentSrc`
     — do NOT key images on src alone; use alt + DOM-order + position)
   - same `kind`/`tag` → hard gate (never cross-match kinds)
   - normalized (x,y) position-nearest within band → tiebreak (handles reordering — never match by order alone)
   - fuzzy text (substring/similarity) → for responsive-truncated copy (mobile shows shorter text)
4. **Classify unmatched:**
   - present@1440, absent@390 → `visible.390=false` (Stage 2 → `hidden_mobile`)
   - present@390, absent@1440 → mobile-only (the **hamburger/mobile-menu** case) → emit @mobile, hidden_desktop
   - low-confidence → FLAG; Stage 2 keeps that leaf's desktop pin + blanket un-pin (a wrong per-bp pin is
     worse than none).
5. **Emit** the unified model (box@each, typo@each, visible@each, confidence).

### 1c. Per-breakpoint typography
Already captured per width (each leaf's `typo.size`/`lineHeight` differ by width). Carry into the model;
Stage 2 emits `typography_font_size` + `_tablet` + `_mobile` (native, kses-safe). Stage 0 proved position
alone overflows text — typography is a required companion channel.

## Measurable acceptance (the gate)

- On **supabase + ≥1 other headless-renderable site** (tailwind/resend), report **matching accuracy** =
  % of desktop CONTENT leaves (text+image; chrome/hamburger excluded and flagged separately) confidently
  matched @390 and @768, spot-validated by hand. **Target ≥85% on content.**
- A `--validate` overlay mode: render each width and overlay matched leaves' captured boxes for a sanity LOOK.
- The matcher SELF-REPORTS confidence + the unmatched/low-confidence set (graceful degradation is the point).

## Risks Stage 1 must solve (from Stage 0 + the descriptor)

1. **Images** — responsive `srcset`/`currentSrc` means the src DIFFERS per width → match by `alt`+position+order, not src.
2. **Reordering** — handled by scored assignment (never order-only).
3. **Restructured chrome** (nav → hamburger) — different DOM, no match → DETECT + flag breakpoint-specific
   (Stage 2 dual-emits with visibility). The hard tail; Stage 1 detects, Stage 2 handles.
4. **Band split/merge** — desktop 2-col → 1 stacked mobile band (or split) → band matching by content overlap.
5. **Responsive-truncated copy** — fuzzy text match, not exact.

## Out of scope (Stage 2)
The BUILD — emitting per-element `@media` position + native `_mobile/_tablet` typography + visibility into
`build-absolute`. Stage 1 produces + validates the MODEL; Stage 2 consumes it.

## First move within Stage 1
Build `capture-multi.mjs` (small) + a v1 `reconcile-breakpoints.mjs` (band-match + text/image leaf-match),
run it on supabase, and report the matching-accuracy number + the unmatched set. That number is the Stage 1
gate: ≥85% on content → proceed to Stage 2; lower → the matcher (not the build) is where the effort goes.
