# Case Study: What a Polished Elementor Page Looks Like in JSON

## Provenance & honest limitation

The original goal was to fetch a real designed Elementor page's `_elementor_data` tree and annotate it. **Three approaches were tried and all failed:**

1. **WP REST API on peakinteractive.io + elementor.com** — `/wp-json/wp/v2/pages` exposes page metadata but **NOT** the `_elementor_data` postmeta (Elementor doesn't register it in REST for security reasons). No custom `/wp-json/elementor/v1/*` route exists on public sites.
2. **Elementor's public template library** — 100+ kits at `elementor.com/library/` but raw JSON downloads are not exposed; kits ship as importable `.zip` files via the editor only.
3. **GitHub kit examples** — Elementor's repo does not contain exported real-design kits with the kind of design density we want to study.

**So this file is synthesis, not extraction.** It documents what a polished Elementor page tree *should* look like, based on the V3 control surface (see `ELEMENTOR_V3_WIDGET_REFERENCE.md`) and observed conventions. Treat it as a fidelity target, not a verbatim source.

**If you ever do get admin access to a designed Elementor site, run `joist_get_page_tree` on a polished page and replace this file with the real annotated tree. The real thing is always better than synthesis.**

---

## What separates a wireframe from a designed page

The page-155 clone (peakinteractive.io attempt, 2026-05-31) captured **structure** perfectly — correct sections, correct headlines, correct hierarchy. But it rendered as a wireframe because it omitted ALL of these settings categories:

| Category | What was missing | Visual consequence |
|---|---|---|
| Section backgrounds | No `background_background` / `background_color` on any container | Plain white, no rhythm between sections |
| Heading typography | No `typography_typography: "custom"`, no font family / size / weight / line-height | Default theme font, default sizes, no hierarchy |
| Body typography | No typography on text-editor | Same |
| Color | No `title_color`, no `text_color`, no `background_color` | No palette, no brand identity |
| Responsive | No `_tablet` / `_mobile` variants on anything | Desktop sizes shown on phone, layout collapses ugly |
| Padding objects | Used basic padding but no per-section variation | No spacing hierarchy (hero vs content vs footer-CTA) |
| Button styling | Default Elementor gray button, no brand color | Reads as "demo button" |
| Flex layout | No `flex_direction` / `flex_wrap` / `gap` on multi-child containers | 3-col grids stacked vertically instead of side-by-side |
| `min_height` on hero | Hero collapses to its content height | Hero is short and ungenerous instead of viewport-filling |
| Image styling | No `border_radius` on case-study images | Images look like raw inserts |
| Text-editor inline HTML | Used `<p>` tags only | Couldn't style blockquotes, lists, callouts |

That list IS the gap. Every item is a settings-category I had access to but didn't use.

---

## A polished agency-page tree — annotated synthesis

This is a hypothetical 7-section agency homepage written in the V3 shape Joist commits to. Use as a template when authoring real clones.

### Section 1 — Hero (dark, full-viewport, centered)

```json
{
  "elType": "container",
  "settings": {
    "content_width": "full",
    "min_height": {"unit": "vh", "size": 100},
    "min_height_tablet": {"unit": "vh", "size": 80},
    "min_height_mobile": {"unit": "vh", "size": 70},
    "padding": {"unit": "px", "top": "120", "right": "40", "bottom": "120", "left": "40", "isLinked": false},
    "padding_tablet": {"unit": "px", "top": "80", "right": "24", "bottom": "80", "left": "24", "isLinked": false},
    "padding_mobile": {"unit": "px", "top": "60", "right": "20", "bottom": "60", "left": "20", "isLinked": false},
    "background_background": "classic",
    "background_color": "#0E0E0C",
    "flex_direction": "column",
    "flex_justify_content": "center",
    "flex_align_items": "center"
  },
  "elements": [
    {
      "elType": "widget",
      "widgetType": "heading",
      "settings": {
        "title": "We create custom digital solutions for traditional businesses.",
        "header_size": "h1",
        "align": "center",
        "title_color": "#F3F2EC",
        "typography_typography": "custom",
        "typography_font_family": "Fraunces",
        "typography_font_size": {"unit": "px", "size": 64},
        "typography_font_size_tablet": {"unit": "px", "size": 48},
        "typography_font_size_mobile": {"unit": "px", "size": 36},
        "typography_font_weight": "500",
        "typography_line_height": {"unit": "em", "size": 1.1},
        "typography_letter_spacing": {"unit": "px", "size": -0.5}
      }
    },
    {
      "elType": "widget",
      "widgetType": "spacer",
      "settings": {"space": {"unit": "px", "size": 48}}
    },
    {
      "elType": "widget",
      "widgetType": "button",
      "settings": {
        "text": "Book a call",
        "align": "center",
        "link": {"url": "#contact", "is_external": ""},
        "size": "lg",
        "background_color": "#D4FF3A",
        "button_text_color": "#0E0E0C",
        "hover_color": "#0E0E0C",
        "button_background_hover_color": "#F3F2EC",
        "border_radius": {"unit": "px", "top": "8", "right": "8", "bottom": "8", "left": "8", "isLinked": true},
        "text_padding": {"unit": "px", "top": "18", "right": "36", "bottom": "18", "left": "36", "isLinked": false},
        "typography_typography": "custom",
        "typography_font_family": "Inter",
        "typography_font_size": {"unit": "px", "size": 16},
        "typography_font_weight": "600",
        "typography_letter_spacing": {"unit": "px", "size": 0.3}
      }
    }
  ]
}
```

**Why this works:**
- Full-bleed dark background (`content_width: full` + `min_height: 100vh` + dark bg) makes the hero feel like a section, not just a centered paragraph.
- Editorial-grade serif heading (Fraunces) at 64px desktop / 36px mobile — confident, scannable, drops cleanly responsively.
- Negative letter-spacing on big type (`-0.5px`) for that designed feel.
- Button uses brand chartreuse on dark — high contrast, looks intentional. Hover inverts to off-white. Generous padding (`18/36`).
- Flex column + center justify + center align makes the layout robust without depending on body margins.

### Section 2 — Social proof (light, narrow band)

```json
{
  "elType": "container",
  "settings": {
    "content_width": "boxed",
    "padding": {"unit": "px", "top": "60", "right": "40", "bottom": "60", "left": "40", "isLinked": false},
    "background_background": "classic",
    "background_color": "#F3F2EC"
  },
  "elements": [
    {
      "elType": "widget",
      "widgetType": "heading",
      "settings": {
        "title": "Trusted by the best in the business.",
        "header_size": "h6",
        "align": "center",
        "title_color": "#5A5A55",
        "typography_typography": "custom",
        "typography_font_family": "Inter",
        "typography_font_size": {"unit": "px", "size": 13},
        "typography_font_weight": "500",
        "typography_text_transform": "uppercase",
        "typography_letter_spacing": {"unit": "px", "size": 2.5}
      }
    },
    {"elType": "widget", "widgetType": "spacer", "settings": {"space": {"unit": "px", "size": 32}}},
    {
      "elType": "widget",
      "widgetType": "image",
      "settings": {
        "image": {"url": "https://placehold.co/1200x80/F3F2EC/A0A09B?text=+", "alt": "Client logos"},
        "align": "center",
        "image_size": "full"
      }
    }
  ]
}
```

**Why this works:**
- Cream background creates contrast against the dark hero above — section rhythm.
- "Trusted by" is treated as an **eyebrow label** (h6, 13px, uppercase, +2.5px tracking) — not a hero headline. Tells the eye "this is supporting context".
- Placeholder URL omits the descriptive text (`text=+`) so the box is neutral — looks like a placeholder for content, not a wireframe caption.

### Section 3 — Services 3-column grid (flex layout)

```json
{
  "elType": "container",
  "settings": {
    "content_width": "boxed",
    "padding": {"unit": "px", "top": "100", "right": "40", "bottom": "100", "left": "40", "isLinked": false},
    "padding_mobile": {"unit": "px", "top": "60", "right": "20", "bottom": "60", "left": "20", "isLinked": false},
    "flex_direction": "row",
    "flex_wrap": "wrap",
    "flex_gap": {"unit": "px", "size": 32, "column": "32", "row": "32"},
    "flex_justify_content": "space-between"
  },
  "elements": [
    {
      "elType": "container",
      "settings": {
        "_flex_size": "none",
        "_flex_basis": {"unit": "px", "size": 320},
        "_flex_grow": 1,
        "padding": {"unit": "px", "top": "32", "right": "32", "bottom": "32", "left": "32", "isLinked": true},
        "background_background": "classic",
        "background_color": "#FFFFFF",
        "border_radius": {"unit": "px", "top": "12", "right": "12", "bottom": "12", "left": "12", "isLinked": true},
        "box_shadow_box_shadow_type": "yes",
        "box_shadow_box_shadow": {"horizontal": 0, "vertical": 2, "blur": 16, "spread": 0, "color": "rgba(14,14,12,0.06)"}
      },
      "elements": [
        {
          "elType": "widget",
          "widgetType": "heading",
          "settings": {
            "title": "Website design & development",
            "header_size": "h3",
            "title_color": "#0E0E0C",
            "typography_typography": "custom",
            "typography_font_family": "Fraunces",
            "typography_font_size": {"unit": "px", "size": 24},
            "typography_font_weight": "500"
          }
        },
        {
          "elType": "widget",
          "widgetType": "text-editor",
          "settings": {
            "editor": "<p>Custom-built sites that hold up. No drag-and-drop templates dressed up to look bespoke.</p>",
            "text_color": "#3A3A35",
            "typography_typography": "custom",
            "typography_font_family": "Inter",
            "typography_font_size": {"unit": "px", "size": 16},
            "typography_line_height": {"unit": "em", "size": 1.55}
          }
        }
      ]
    }
    // two more service-card containers with the same shape
  ]
}
```

**Why this works:**
- Outer container uses `flex_direction: row` + `flex_wrap: wrap` + `flex_gap: 32` for the 3-col grid. Each child sets `_flex_basis: 320` + `_flex_grow: 1` so they fill evenly on desktop and wrap to 1-col under 320px width naturally.
- Each card is its own container (white, 12px rounded, soft shadow). The shadow is what gives the section depth.
- Card content uses `padding: 32` on all sides (linked) for consistent internal spacing.

### Section 4 — Stats banner (alternating dark band)

```json
{
  "elType": "container",
  "settings": {
    "content_width": "full",
    "padding": {"unit": "px", "top": "80", "right": "40", "bottom": "80", "left": "40", "isLinked": false},
    "background_background": "classic",
    "background_color": "#0E0E0C",
    "flex_align_items": "center"
  },
  "elements": [
    {
      "elType": "widget",
      "widgetType": "heading",
      "settings": {
        "title": "50+ businesses enhanced.",
        "header_size": "h2",
        "align": "center",
        "title_color": "#D4FF3A",
        "typography_typography": "custom",
        "typography_font_family": "Fraunces",
        "typography_font_size": {"unit": "px", "size": 56},
        "typography_font_size_mobile": {"unit": "px", "size": 36},
        "typography_font_weight": "500",
        "typography_letter_spacing": {"unit": "px", "size": -0.5}
      }
    },
    {"elType": "widget", "widgetType": "spacer", "settings": {"space": {"unit": "px", "size": 16}}},
    {
      "elType": "widget",
      "widgetType": "text-editor",
      "settings": {
        "editor": "<p style=\"text-align:center;max-width:680px;margin:0 auto;\">Bringing American businesses to life with custom-tailored websites and marketing.</p>",
        "text_color": "#A0A09B",
        "typography_typography": "custom",
        "typography_font_family": "Inter",
        "typography_font_size": {"unit": "px", "size": 18},
        "typography_line_height": {"unit": "em", "size": 1.55}
      }
    }
  ]
}
```

**Why this works:**
- Dark band picks up the hero color — creates visual rhyme.
- The 50+ headline is chartreuse — the brand accent gets one dramatic moment instead of being used everywhere.
- Supporting text in `#A0A09B` (muted on dark) so it reads as quiet supporting context.

### Sections 5, 6, 7 — case studies, testimonials, final CTA

Same patterns: alternating bg colors, real typography, button reuse from hero, blockquote styling inline in text-editor's `editor` HTML for testimonials.

---

## Design principles distilled

These are the rules that turn a structurally-correct plan into a designed page. Reference list when authoring:

### 1. Section rhythm
- **Alternate background colors** between sections. Dark → cream → white → dark → ... creates the band-rhythm that makes a long page legible. Without alternation it reads as one undifferentiated wall.
- **Padding tiers:** hero gets `120px` vertical, content sections `80px`, dense sections (CTA, banner) `60-100px`. Mobile drops everything 40-50%.

### 2. Typography hierarchy
- **One serif + one sans + one mono.** Joist's brand is Fraunces (display serif) + Inter (sans) + JetBrains Mono (code). Two fonts max, three only if there's a real role for the third.
- **Sizes go 64 → 48 → 36 → 24 → 18 → 16 → 14 → 13** roughly. Pick from this scale. Avoid arbitrary values.
- **Mobile drops:** `64 → 36`, `48 → 32`, `36 → 24`. Always set `typography_font_size_mobile`.
- **Letter-spacing:** negative on big serif (`-0.5px` on h1), positive on uppercase eyebrows (`+2.5px`).
- **Line-height:** `1.1-1.2em` on big headlines, `1.55-1.6em` on body.

### 3. Color discipline
- **One brand accent, one dark, two neutrals.** Don't introduce a 5th color. Joist brand: `#0E0E0C` warm dark + `#F3F2EC` cream + `#D4FF3A` chartreuse accent + `#A0A09B` muted.
- **Brand accent gets ONE dramatic moment per section**, not spread across every widget. Buttons + key stat numbers, that's it.
- **Body text in low-contrast color on dark sections** (`#A0A09B` on `#0E0E0C`) so headlines pop.

### 4. Spacing
- Use **`flex_gap`** on containers for predictable spacing between children. Spacer widgets are a fallback when flex-gap isn't enough.
- **Linked padding** (`isLinked: true`) for cards and inset elements. Unlinked (vertical ≠ horizontal) only when you have a real reason.

### 5. Responsive
- Always set `_tablet` AND `_mobile` variants on:
  - `padding` (sections and cards)
  - `typography_font_size` (every heading and body block bigger than 14px)
  - `min_height` (hero sections)
- Use `flex_wrap: wrap` + `_flex_basis: 320` on grid children so they wrap naturally without needing per-viewport overrides.

### 6. Buttons
- Brand color background, contrasting text, generous padding (`18/36` or `20/40`), `8px` border radius, font weight `600`, font size `16px`.
- Always set hover states.
- Reuse the same button styling across the page — consistency reads as design discipline.

### 7. Images
- **Placeholder URLs without descriptive text** when you don't have real images. `https://placehold.co/1200x80/F3F2EC/A0A09B?text=+` (the `+` becomes invisible) — not `text=Client+logos+row` which renders as a literal wireframe caption.
- For real images: HTTPS only, `image_size: "full"`, `border_radius: 8-12px` on case-study screenshots.

### 8. Text-editor inline HTML
- Use the `editor` HTML to apply paragraph-level styling that the heading widget can't:
  - Centered constrained-width paragraphs (`<p style="max-width:640px;margin:0 auto;text-align:center;">`)
  - Blockquotes (`<blockquote style="border-left:3px solid #D4FF3A;padding-left:24px;font-style:italic;">`)
  - Inline emphasis with the accent color
- The HTML widget is for raw HTML embeds (codepens, scripts); use text-editor for prose.

---

## What's NOT in this case study (limitations)

- **Real fetched `_elementor_data` from a polished site.** We couldn't get it without admin credentials.
- **V4 atomic page tree.** See `ELEMENTOR_V4_ATOMIC_AUTHORING.md` (pending) for atomic-style equivalents — most of the styling lives in Classes/Variables there, not in inline settings.
- **Theme-specific quirks.** JupiterX adds its own settings keys. Hello theme is closer to vanilla and recommended for production sites Joist authors.
- **Custom CSS.** Real designers sometimes resort to `custom_css` (an advanced setting on every widget). This case study uses no custom CSS — every effect comes from documented control surface.

When you next have admin access to a real designed Elementor site, run `joist_get_page_tree`, paste the result here, and treat the synthesis above as the second half of the document — what good *should* look like vs. what good actually *is* in real production trees.
