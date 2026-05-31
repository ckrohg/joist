# Clone Authoring Playbook

The procedure for an AI agent (Claude Code, Cursor, etc.) to clone a real website into an Elementor page with **75% or better visual fidelity**, using Joist's MCP write surface.

**Read these first (in order):**
1. `WP_SITE_ACCESS_PATTERNS.md` — how to read source sites + write to target
2. `ELEMENTOR_V3_WIDGET_REFERENCE.md` — full V3 settings surface (the authoring vocabulary)
3. `V4_ATOMIC_NORMALIZATIONS.md` — what V4 strips/adds (why hash defense works the way it does)
4. `ELEMENTOR_V4_ATOMIC_AUTHORING.md` — V4 atomic shape rules (for the day content widgets register)
5. `ELEMENTOR_RENDERING_PIPELINE.md` — settings → CSS → render
6. `CASE_STUDY_DESIGNED_ELEMENTOR_PAGE.md` — what good looks like

This playbook is the synthesis. The other six are the working vocabulary.

---

## The honest problem this solves

A first-pass clone using only `{title, header_size, align, padding}` settings renders as a wireframe. **The MCP write path works fine — the missing piece is design judgment + full use of the widget control surface.** This playbook fixes that.

---

## The procedure

### Phase 1 — Read the source site

**Always start here.** Skipping this step is what produced the wireframe-quality page 155.

Run, in order:

1. **`WebFetch` the URL** asking for **structure** (section list, headlines verbatim, copy verbatim, layout hints). This catches the page outline.
2. **Re-`WebFetch` the same URL** asking for **visual language**:
   - Color palette (background colors per section, text colors, accent colors)
   - Typography (font families, size hierarchy desktop/mobile, weight)
   - Spacing rhythm (hero padding vs content padding vs CTA padding)
   - Section visual treatment (dark/light alternation, bordered, full-bleed)
   - Button styling (color, shape, padding, hover)
   - Image treatment (sizes, ratios, border radius, presence of overlays)
3. **Optional: SFTP/curl the rendered CSS** if you have file access — `https://target.com/wp-content/uploads/elementor/css/post-{id}.css` is publicly served and tells you the exact compiled rules.
4. **If admin access available**: `joist_get_page_tree` on the source site gives you the exact tree. 100% fidelity ceiling.

The deliverable from Phase 1 is a short design brief you write to yourself:

```
Source: https://peakinteractive.io/
Palette: #0E0E0C warm dark, #F3F2EC cream, #D4FF3A chartreuse accent, #A0A09B muted
Type: Fraunces (serif display) + Inter (sans body), h1 64/36, body 16/14
Rhythm: dark hero → cream social proof → dark stats → cream services → etc. (alternating)
Hero: full-bleed dark, 100vh, centered, h1 with chartreuse CTA button
Sections: 80-120px vertical padding, drops to 60px mobile
Buttons: chartreuse bg, dark text, 8px radius, generous padding
Images: subtle border-radius, neutral placeholders (no caption text)
```

If you can't articulate the design brief, you can't author the clone. Re-fetch until you can.

### Phase 2 — Draft the section list

From the design brief, list each top-level container as a numbered section with:
- Role (hero, social proof, services, etc.)
- Background treatment (color, full-bleed vs boxed)
- Vertical padding tier (hero / content / CTA)
- Children (headings, body, button, image, etc.)

Keep this in your context, not in code yet. This is the structural skeleton — usually 6-10 sections for a homepage.

### Phase 3 — Author each section with full styling

For EVERY section, use the V3 widget reference to populate:

**Container settings (always set):**
- `content_width`: `boxed` for content, `full` for hero/banner
- `padding`: `{unit:px, top, right, bottom, left, isLinked:false}` — see padding tier in brief
- `padding_tablet`, `padding_mobile`: drop by 30-50%
- `background_background`: `classic`
- `background_color`: from palette
- `flex_direction`, `flex_justify_content`, `flex_align_items` if needed for layout
- `min_height` on hero (use `vh` units)

**Heading widget (always set beyond title):**
- `title_color`: from palette (contrast against container bg)
- `typography_typography`: `custom`
- `typography_font_family`: from brief (Fraunces / Inter / etc.)
- `typography_font_size`: `{unit:px, size: N}` per hierarchy
- `typography_font_size_tablet`, `typography_font_size_mobile`: scaled per brief
- `typography_font_weight`: `500` or `600` typically
- `typography_line_height`: `{unit:em, size: 1.1}` for big headlines, `1.2-1.5` for smaller
- `typography_letter_spacing`: negative on serif display (`-0.5px`), positive on uppercase eyebrows (`+2px`)
- `typography_text_transform` if applicable

**Text-editor (always set):**
- `text_color`: from palette
- `typography_*` group same as heading
- Use inline HTML in `editor` for layout-y things: `<p style="max-width:640px;margin:0 auto;text-align:center;">...</p>`
- Blockquotes: `<blockquote style="border-left:3px solid {accent};padding-left:24px;font-style:italic;">...</blockquote>`

**Button (always set beyond text/link):**
- `size`: `lg` for hero, `md` otherwise
- `background_color`: brand accent or palette
- `button_text_color`: contrasting
- `hover_color`, `button_background_hover_color`: inverted pair
- `border_radius`: `{unit:px, top:8, right:8, bottom:8, left:8, isLinked:true}`
- `text_padding`: `{unit:px, top:18, right:36, bottom:18, left:36, isLinked:false}`
- `typography_*`: font, size 16, weight 600, slight positive letter-spacing

**Image (always set):**
- `image.url`: `https://placehold.co/{w}x{h}/{bg}/{fg}?text=+` — **omit the descriptive text param** (use `+` which renders as a space, leaving the box neutral). Wireframe captions like `text=Client+logos+row` are forbidden — they read as "draft not finished."
- `alt`: accurate role description ("Client logos", "Tint Pros Plus screenshot")
- `image_size`: `full`
- `align`: `center` for hero / featured, otherwise default
- `border_radius` on case-study screenshots: `8-12px`

**Spacer between sections inside a container** when `flex_gap` won't work:
- `{space: {unit:px, size: N}}` — typically 16 (tight), 24 (medium), 32 (loose), 48+ (hero)

### Phase 4 — Submit + validate

1. Wrap the section list as plan steps (one section = one `op: insert, position: 999` step).
2. `joist_create_plan` with `intent`, `title`, and `steps[]`.
3. `joist_approve_plan` with the returned token.
4. `joist_execute_plan`. Expected: every step `verified_roots` grows by 1, final `status: completed`.
5. `joist_get_page_tree` on the new page — verify the saved tree matches what you authored. The lenient hash defense will normalize V4 auto-fields, but content + settings should be intact.
6. **Eyeball the rendered page** at `https://target.com/?page_id={id}`. This is the only honest test — pixel comparison against the source.
7. **Iterate** if anything looks off:
   - Wrong color → settings typo or theme override; check the rendered CSS
   - Wrong size → `typography_font_size` or `padding` wrong
   - Layout broken on mobile → missing `_mobile` variants
   - Section blends into next → missing background contrast
   - Button looks generic → settings beyond `text`/`align`/`link` weren't applied

### Phase 5 — Honest fidelity check

Compare side-by-side. Score yourself against the **75% fidelity bar**:

- ≥75% — the clone reads as a deliberate design. Same color story, same type rhythm, recognizable section layout. **Ship.**
- 50-75% — recognizable but obviously a knock-off. Typography wrong or palette muddy. **Re-author the offending sections.**
- <50% — looks like a wireframe (the page-155 case). **Start over from Phase 1 — the design brief was incomplete.**

---

## Authoring rules — must-follow

1. **No bare `settings: {}` on containers or widgets.** If you wrote `{}`, you skipped Phase 3 styling. Go back.
2. **No placeholder image URLs with descriptive caption text.** `https://placehold.co/1200x80/F3F2EC/A0A09B?text=+` is right. `?text=Client+logos+row` is wrong — it renders as a wireframe.
3. **Every heading bigger than 24px gets a `_mobile` variant.** Otherwise it overflows the viewport.
4. **Section backgrounds alternate.** Two adjacent containers with the same `background_color` looks like one section accidentally split.
5. **One serif + one sans, max.** Pick from the brief and stick to it. Never introduce a third font without a documented reason.
6. **Brand accent appears 1-3 times per page, not on every element.** Buttons + one stat headline + maybe one heading. Spread thin = unbranded.
7. **Padding tiers consistent across sections.** Hero 100-120, content 60-80, CTA 80-100. Different tiers per section = looks unintentional.
8. **No marketing-speak in substituted copy.** Forbidden words: "Empower your", "Revolutionize", "Unleash", "Leverage", "Synergy", "Game-changing", "Next-gen". From the Joist constitution. Write direct, concrete prose instead.
9. **Lorem ipsum gets replaced with plausible direct prose.** Never ship lorem.
10. **Verbatim headlines from source.** Do not paraphrase. Only substitute if the source headline is obviously poor or violates rule 8.

---

## What to read when you hit specific problems

| Problem | Read |
|---|---|
| "What settings does the heading widget take?" | `ELEMENTOR_V3_WIDGET_REFERENCE.md` → heading section |
| "What does V4 atomic do differently?" | `ELEMENTOR_V4_ATOMIC_AUTHORING.md` + `V4_ATOMIC_NORMALIZATIONS.md` |
| "Why doesn't my background_color show?" | `ELEMENTOR_RENDERING_PIPELINE.md` → "If a widget setting doesn't show up visually" |
| "How do I read the source site if I don't have admin?" | `WP_SITE_ACCESS_PATTERNS.md` → "Introspecting a Third-Party Elementor Page" |
| "What does a real designed page tree look like?" | `CASE_STUDY_DESIGNED_ELEMENTOR_PAGE.md` |
| "What's the right pattern for a 3-column grid?" | `CASE_STUDY_DESIGNED_ELEMENTOR_PAGE.md` → Section 3 (flex container with `_flex_basis`) |
| "What's the responsive breakpoint?" | `ELEMENTOR_RENDERING_PIPELINE.md` → "Responsive breakpoints" |
| "How do I author a V4 atomic e-flexbox with real styling?" | `ELEMENTOR_V4_ATOMIC_AUTHORING.md` → Part 2 |

---

## Working with versions

**V3 sites (Elementor 3.x):** Use V3 shapes throughout. `container` for layout, `widget` + `widgetType` for content. Reference: `ELEMENTOR_V3_WIDGET_REFERENCE.md`.

**V4 sites (Elementor 4.x):**
- For now: V3 shapes are the production path (see `V4_ATOMIC_NORMALIZATIONS.md`). They round-trip cleanly via Joist's lenient hash defense.
- V4 atomic hybrid (e-flexbox container + V3 widgets inside) works but loses styling expressiveness — atomic structurals require Classes/Variables for styling and Joist doesn't author those yet.
- Atomic content widgets (`e-heading`, `e-paragraph`, `e-button`) are **not registered** on Elementor 4.0.x as of 2026-05-31. Use V3 widgets.
- When atomic content widgets register upstream, re-read `ELEMENTOR_V4_ATOMIC_AUTHORING.md` and revisit this section.

**Site detection:** Always call `joist_get_site_info` first. Use `elementor_version` to know which shape to author.

---

## Anti-patterns observed (don't repeat)

| Anti-pattern | Observed | Fix |
|---|---|---|
| Bare-minimum settings, default everything | page 155 (peakinteractive clone, 2026-05-31) | Phase 3 of this playbook |
| Placeholder URLs with descriptive caption text | page 155 — `text=Client+logos+row` | Use `?text=+` for neutral boxes |
| No responsive variants → broken mobile | n/a yet | Set `_tablet` + `_mobile` on padding + typography_font_size at minimum |
| No section background variation → wall of white | page 155 | Alternate `background_color` between sections |
| Single column instead of multi-column | page 155 (4 case studies stacked instead of 2x2) | `flex_direction: row, flex_wrap: wrap, flex_gap: 32` on outer container, `_flex_basis` on children |
| Marketing-speak substitution | (not yet, watch for it) | Read the Joist constitution; rule 8 above |

---

## When this playbook fails

If you follow Phases 1-5 and still get <75% fidelity:

1. The source site uses an Elementor add-on or theme (JupiterX, Hello Plus, etc.) that registers widgets V3's standard surface doesn't cover. Document the gap — the right move is to extend `ELEMENTOR_V3_WIDGET_REFERENCE.md`, not work around.
2. The source uses heavy custom CSS that the rendered HTML+CSS scrape doesn't surface. Document and either skip cloning that aspect or get admin access for `joist_get_page_tree` (100% fidelity ceiling).
3. The source uses animations/interactions Elementor V3 doesn't have. These genuinely can't be cloned at 75% — note the limit honestly in your design brief.

The fidelity bar is honest — don't pretend a wireframe is a clone.

---

## After every clone session

Update `CASE_STUDY_DESIGNED_ELEMENTOR_PAGE.md` with what you learned. The case study is meant to grow over time as real pages get cloned successfully.
