# Elementor V3 Widget Settings Reference

**Purpose:** Complete catalogue of valid settings for 13 core Elementor V3 widgets that Joist authors in plans. This is the source of truth for authoring V3-compatible Elementor plans from an AI agent — it documents the full settings surface so that generated plans actually look designed, not like unstyled wireframes.

**Date:** 2026-05-30. **Status:** Reference (living document; updated as Elementor upstream changes).

**Audience:** AI agents (Claude Code, mcp tools) authoring Elementor plans via `PlanGenerator` + `CloneGenerator`. Human Elementor users editing in the UI will discover many of these settings via the UI; agents need the exhaustive list to author production-quality plans.

---

## Table of Contents

1. [V3 Schema Overview](#v3-schema-overview)
2. [Responsive & Breakpoint Convention](#responsive--breakpoint-convention)
3. [Common Settings Patterns](#common-settings-patterns)
4. [Container (elType: container)](#container-eltype-container)
5. [Heading (widgetType: heading)](#heading-widgettype-heading)
6. [Text Editor (widgetType: text-editor)](#text-editor-widgettype-text-editor)
7. [Button (widgetType: button)](#button-widgettype-button)
8. [Image (widgetType: image)](#image-widgettype-image)
9. [Icon (widgetType: icon)](#icon-widgettype-icon)
10. [Divider (widgetType: divider)](#divider-widgettype-divider)
11. [Spacer (widgetType: spacer)](#spacer-widgettype-spacer)
12. [Video (widgetType: video)](#video-widgettype-video)
13. [HTML (widgetType: html)](#html-widgettype-html)
14. [Social Icons (widgetType: social-icons)](#social-icons-widgettype-social-icons)
15. [Icon List (widgetType: icon-list)](#icon-list-widgettype-icon-list)
16. [Star Rating (widgetType: star-rating)](#star-rating-widgettype-star-rating)
17. [Common Composition Patterns](#common-composition-patterns)
18. [Gotchas & Anti-patterns](#gotchas--anti-patterns)

---

## V3 Schema Overview

### Top-level Element Structure

Every element in Elementor V3's `_elementor_data` JSON tree has this shape:

```javascript
{
  "id": "string",              // 8-char lowercase hex, auto-generated if omitted
  "elType": "container" | "widget" | "column" | "section",
  "settings": { ... },         // widget/container-specific settings
  "elements": [ ... ],         // child elements (only for containers/columns/sections)
  
  // Optional metadata (set by Elementor, not usually by agent):
  "isInner": false,            // true if nested inside another container (auto-set by PatchEngine)
  "_id": "...",                // internal Elementor ID (rarely used by agents)
  "_element_id": "..."         // for Elementor Pro
}
```

### Settings Shape — the Core Pattern

Every control in Elementor has a `type` (TEXT, COLOR, SELECT, TYPOGRAPHY, BACKGROUND, BORDER, DIMENSIONS, etc.). The `settings` object maps control `name` → control `value`.

**Critical:** Responsive controls have suffix variants:
- `my_setting` (desktop)
- `my_setting_tablet` (tablet breakpoint)
- `my_setting_mobile` (mobile breakpoint)

Elementor uses **CSS cascade inheritance** — if a responsive variant is omitted, the desktop value is used. **Do NOT auto-fill responsive variants unless the user explicitly requests `fill_responsive: true`** (constraint #24 from `SchemaValidator`).

### Data Types by Control Type

| Control Type | Value Type | Examples |
|---|---|---|
| TEXT, TEXTAREA | `string` | `"Hello world"` |
| NUMBER | `string` (!)* | `"42"`, `"3.5"` (*Elementor stores as strings internally) |
| SELECT, SELECT2 | `string` (single) or `array<string>` (multi) | `"left"`, `["opt1", "opt2"]` |
| COLOR | `string` (hex/rgb/rgba) | `"#FF5733"`, `"rgba(255,87,51,0.8)"` |
| CHOOSE (icon picker) | `string` (key) | `"left"`, `"center"`, `"right"` |
| ICON (Elementor icon) | `string` (icon class/slug) | `"fas fa-star"`, `"eicon-star"` |
| DIMENSIONS (padding/margin) | `object` | `{ "unit": "px", "top": "10", "right": "20", "bottom": "10", "left": "20", "isLinked": false }` |
| BACKGROUND | `object` | `{ "background": "classic", "color": "#fff", ... }` or `{ "background": "gradient", ... }` |
| TYPOGRAPHY | `object` | `{ "typography_typography": "custom", "typography_font_family": "Roboto", ... }` |
| BORDER | `object` | `{ "border_border": "solid", "border_width": {...}, "border_color": "#000", "border_radius": {...} }` |
| REPEATER | `array<object>` | `[{ "item_key": "value" }, ...]` |

---

## Responsive & Breakpoint Convention

Elementor's breakpoints (as defined in the kit):
- **desktop** — base (no suffix)
- **tablet** — `_tablet` suffix
- **mobile** — `_mobile` suffix
- (sometimes widescreen/laptop, but 3-viewport is standard)

### Example: Responsive Heading Title Color

```javascript
// Desktop color only — tablet/mobile inherit via CSS cascade
"settings": {
  "title_color": "#FF5733"
}

// Explicit per-breakpoint (rare — only when you need different colors)
"settings": {
  "title_color": "#FF5733",           // desktop
  "title_color_tablet": "#FF5733",    // tablet
  "title_color_mobile": "#FFFFFF"     // mobile (different)
}
```

**Rule:** Omit responsive variants unless they differ from the desktop value. Elementor's CSS layer-handles the cascade correctly; missing keys are not incomplete.

---

## Common Settings Patterns

### Spacing (Padding/Margin)

Dimensions follow a linked/unlinked shape:

```javascript
// Linked (all sides equal)
"padding": {
  "unit": "px",
  "top": "20",
  "right": "20",
  "bottom": "20",
  "left": "20",
  "isLinked": true
}

// Unlinked (different per side)
"padding": {
  "unit": "px",
  "top": "40",
  "right": "20",
  "bottom": "40",
  "left": "20",
  "isLinked": false
}

// Can also use em, rem, %, vh, vw
"padding": {
  "unit": "em",
  "top": "1.5",
  "right": "1",
  "bottom": "1.5",
  "left": "1",
  "isLinked": false
}
```

### Typography

Full typography control shape (when `typography_typography: "custom"`):

```javascript
"settings": {
  "typography_typography": "custom",
  "typography_font_family": "Roboto",           // exact font name from kit
  "typography_font_size": { "unit": "px", "size": "18" },
  "typography_font_weight": "700",               // "100" to "900" or "normal", "bold"
  "typography_font_style": "normal",             // "normal", "italic", "oblique"
  "typography_text_decoration": "none",          // "none", "underline", "overline", "line-through"
  "typography_text_transform": "none",           // "none", "uppercase", "lowercase", "capitalize"
  "typography_line_height": { "unit": "em", "size": "1.5" },
  "typography_letter_spacing": { "unit": "px", "size": "0.5" },
  "typography_word_spacing": { "unit": "px", "size": "0" }
}
```

If you want to use a kit preset instead of custom:

```javascript
"settings": {
  "typography_typography": "primary",  // or "secondary", or any kit preset slug
  // Leave all other typography_* keys empty or omit them
}
```

### Colors & Globals

Elementor supports **global color references** (constraint #26):

```javascript
// Literal color
"title_color": "#FF5733"

// Global reference (preferred by SchemaValidator when available)
"title_color": "var(--e-global-color-primary)",
"__globals__": { "title_color": "globals/colors?id=primary" }
```

When authoring, use literal hex/rgb for simple cases. Global references are automatically preferred by the `GlobalRefPreferrer` transformer in DocumentWriter.

### Background

Classic background (most common):

```javascript
"settings": {
  "background_background": "classic",
  "background_color": "#F3F2EC",
  "background_image": {
    "id": 123,                        // media library ID
    "url": "https://...",
    "source": "library"
  },
  "background_attachment": "scroll",  // "scroll" or "fixed"
  "background_size": "cover",         // "cover", "contain", "auto"
  "background_position": "center center",
  "background_repeat": "no-repeat"
}
```

Gradient background:

```javascript
"settings": {
  "background_background": "gradient",
  "background_gradient_angle": 45,
  "background_gradient_stops": [
    { "color": "#FF5733", "position": 0 },
    { "color": "#FFFFFF", "position": 100 }
  ]
}
```

### Border

```javascript
"settings": {
  "border_border": "solid",              // "none", "solid", "dotted", "dashed", "groove", "ridge", "inset", "outset"
  "border_width": {
    "unit": "px",
    "top": "1",
    "right": "1",
    "bottom": "1",
    "left": "1",
    "isLinked": true
  },
  "border_color": "#CCCCCC",
  "border_radius": {
    "unit": "px",
    "top": "8",
    "right": "8",
    "bottom": "8",
    "left": "8",
    "isLinked": true
  }
}
```

### Box Shadow

```javascript
"settings": {
  "box_shadow": "yes",
  "box_shadow_blur": { "unit": "px", "size": "10" },
  "box_shadow_spread": { "unit": "px", "size": "2" },
  "box_shadow_color": "rgba(0,0,0,0.3)",
  "box_shadow_horizontal": { "unit": "px", "size": "0" },
  "box_shadow_vertical": { "unit": "px", "size": "5" }
}
```

---

## Container (elType: container)

The **fundamental layout element** in Elementor V3. Every page is a tree of containers + widgets. Containers define layout via flexbox; widgets are leaf nodes.

### Required Settings

| Setting | Type | Notes |
|---|---|---|
| (none) | | Container requires no settings to render, but typically includes layout + spacing |

### Key Layout Settings (Content Layout)

| Setting | Type | Values | Default | Notes |
|---|---|---|---|---|
| `content_width` | SELECT | `full` \| `boxed` | `full` | Width constraint; `boxed` = max-width from kit |
| `min_height` | DIMENSIONS | object | `none` | Minimum height of container (e.g., hero full-height) |
| `min_height_unit` | SELECT | `px` \| `%` \| `vh` | `px` | |

### Key Flex Layout Settings

**Containers are flex-direction row by default.** These settings control the flex layout:

| Setting | Type | Values | Default | Notes |
|---|---|---|---|---|
| `flex_direction` | SELECT | `row` \| `column` | `row` | Main axis direction |
| `flex_wrap` | SELECT | `nowrap` \| `wrap` | `wrap` | Wrapping behavior |
| `flex_justify_content` | SELECT | `flex-start` \| `flex-end` \| `center` \| `space-between` \| `space-around` \| `space-evenly` | `flex-start` | Main axis alignment |
| `flex_align_items` | SELECT | `flex-start` \| `flex-end` \| `center` \| `stretch` \| `baseline` | `stretch` | Cross axis alignment |
| `flex_gap` | DIMENSIONS | object | `0` | Gap between children |

**Flex examples:**

```javascript
// 3-column grid with gap
"settings": {
  "flex_direction": "row",
  "flex_wrap": "wrap",
  "flex_justify_content": "space-between",
  "flex_gap": { "unit": "px", "size": "20" },
  "flex_align_items": "stretch"
}

// Vertical stack (column)
"settings": {
  "flex_direction": "column",
  "flex_gap": { "unit": "px", "size": "30" },
  "flex_align_items": "center"
}
```

### Styling Settings (Fully Applicable)

Containers support ALL the common styling settings:
- **Typography:** `typography_*` family
- **Colors:** `background_background`, `background_color`, `border_*`, `box_shadow_*`
- **Spacing:** `padding`, `margin`
- **Border & Radius:** `border_border`, `border_width`, `border_color`, `border_radius`

**Example: Dark Hero Container**

```javascript
{
  "elType": "container",
  "settings": {
    "content_width": "boxed",
    "min_height": { "unit": "vh", "size": "80" },
    "padding": { "unit": "px", "top": "100", "right": "40", "bottom": "100", "left": "40", "isLinked": false },
    "background_background": "classic",
    "background_color": "#0E0E0C",
    "flex_direction": "column",
    "flex_justify_content": "center",
    "flex_align_items": "center",
    "flex_gap": { "unit": "px", "size": "20" }
  },
  "elements": [
    // heading + text + button nested inside
  ]
}
```

### Full Settings Catalogue (Container)

| Setting Name | Type | Responsive | Section | Notes |
|---|---|---|---|---|
| `content_width` | SELECT | No | Layout | `boxed` \| `full` |
| `min_height` | NUMBER | Yes | Layout | With `min_height_unit` |
| `min_height_unit` | SELECT | No | Layout | `px` \| `%` \| `vh` |
| `flex_direction` | SELECT | No | Layout | `row` \| `column` |
| `flex_wrap` | SELECT | No | Layout | `nowrap` \| `wrap` |
| `flex_justify_content` | SELECT | Yes | Layout | Main axis alignment |
| `flex_align_items` | SELECT | Yes | Layout | Cross axis alignment |
| `flex_align_content` | SELECT | No | Layout | Multi-line alignment |
| `flex_gap` | DIMENSIONS | Yes | Layout | Gap between children |
| `flex_child_width` | SELECT | No | Layout | Child width control |
| `flex_child_height` | SELECT | No | Layout | Child height control |
| `padding` | DIMENSIONS | Yes | Style | Top/right/bottom/left |
| `margin` | DIMENSIONS | Yes | Style | Top/right/bottom/left |
| `background_background` | SELECT | No | Style | `classic` \| `gradient` |
| `background_color` | COLOR | Yes | Style | Background color |
| `background_image` | MEDIA | No | Style | Background image |
| `background_attachment` | SELECT | No | Style | `scroll` \| `fixed` |
| `background_size` | SELECT | No | Style | `cover` \| `contain` \| `auto` |
| `background_position` | SELECT | No | Style | e.g. `center center` |
| `background_repeat` | SELECT | No | Style | `repeat` \| `no-repeat` |
| `background_gradient_angle` | NUMBER | No | Style | Gradient angle (0–360) |
| `background_gradient_stops` | REPEATER | No | Style | Color + position pairs |
| `border_border` | SELECT | No | Style | `none` \| `solid` \| `dotted` \| `dashed` |
| `border_width` | DIMENSIONS | Yes | Style | Border width |
| `border_color` | COLOR | Yes | Style | Border color |
| `border_radius` | DIMENSIONS | Yes | Style | Corner radius |
| `box_shadow` | SELECT | No | Style | `yes` \| empty (no) |
| `box_shadow_color` | COLOR | Yes | Style | Shadow color |
| `box_shadow_horizontal` | DIMENSIONS | Yes | Style | X offset |
| `box_shadow_vertical` | DIMENSIONS | Yes | Style | Y offset |
| `box_shadow_blur` | DIMENSIONS | Yes | Style | Blur radius |
| `box_shadow_spread` | DIMENSIONS | Yes | Style | Spread radius |
| `custom_css_classes` | TEXT | No | Advanced | Space-separated classes |
| `custom_css` | TEXTAREA | No | Advanced | Raw CSS (scoped to element) |

---

## Heading (widgetType: heading)

The fundamental text-hierarchy widget. Renders as `<h1>` through `<h6>`.

### Minimal Example (Unstyled)

```javascript
{
  "elType": "widget",
  "widgetType": "heading",
  "settings": {
    "title": "Welcome to Joist"
  }
}
// Renders: <h2 class="elementor-heading-title">Welcome to Joist</h2>
```

### Required Settings

| Setting | Type | Default |
|---|---|---|
| `title` | TEXT | (empty) |

### Core Content Settings

| Setting | Type | Values | Default | Notes |
|---|---|---|---|---|
| `title` | TEXT | any string | (empty) | The heading text |
| `header_size` | SELECT | `h1`, `h2`, `h3`, `h4`, `h5`, `h6` | `h2` | HTML tag |
| `align` | SELECT | `left`, `center`, `right` | `left` | Horizontal alignment |

### Typography Settings

All standard typography controls apply:

```javascript
"settings": {
  "title": "Engineering the floor up.",
  "header_size": "h1",
  "align": "center",
  "typography_typography": "custom",
  "typography_font_family": "Fraunces",
  "typography_font_size": { "unit": "px", "size": "56" },
  "typography_font_weight": "700",
  "typography_line_height": { "unit": "em", "size": "1.2" },
  "typography_letter_spacing": { "unit": "px", "size": "0" },
  "typography_text_transform": "none"
}
```

Or use a kit preset:

```javascript
"settings": {
  "title": "...",
  "typography_typography": "primary"  // Kit preset slug
}
```

### Color Settings

```javascript
"settings": {
  "title": "...",
  "title_color": "#FF5733"  // Text color
}
```

With responsive variants:

```javascript
"settings": {
  "title_color": "#FF5733",           // desktop
  "title_color_tablet": "#FF5733",    // tablet
  "title_color_mobile": "#FFFFFF"     // mobile
}
```

### Spacing & Advanced

```javascript
"settings": {
  "title": "...",
  "margin": {
    "unit": "px",
    "top": "0",
    "right": "0",
    "bottom": "20",
    "left": "0",
    "isLinked": false
  },
  "custom_css_classes": "my-heading",
  "custom_css": ".my-heading { ... }"
}
```

### Full Settings Catalogue (Heading)

| Setting Name | Type | Responsive | Section | Notes |
|---|---|---|---|---|
| `title` | TEXT | No | Content | The heading text |
| `header_size` | SELECT | No | Content | h1–h6 |
| `align` | SELECT | Yes | Content | left/center/right |
| `title_color` | COLOR | Yes | Style | Text color |
| `typography_typography` | SELECT | No | Style | custom \| kit preset slug |
| `typography_font_family` | SELECT | Yes | Style | Font name from kit |
| `typography_font_size` | DIMENSIONS | Yes | Style | With unit (px/em/rem) |
| `typography_font_weight` | SELECT | Yes | Style | 100–900 \| normal \| bold |
| `typography_font_style` | SELECT | Yes | Style | normal \| italic \| oblique |
| `typography_text_decoration` | SELECT | Yes | Style | none \| underline \| overline \| line-through |
| `typography_text_transform` | SELECT | Yes | Style | none \| uppercase \| lowercase \| capitalize |
| `typography_line_height` | DIMENSIONS | Yes | Style | Line height (unit: em, px, %) |
| `typography_letter_spacing` | DIMENSIONS | Yes | Style | Letter spacing |
| `typography_word_spacing` | DIMENSIONS | Yes | Style | Word spacing |
| `padding` | DIMENSIONS | Yes | Style | |
| `margin` | DIMENSIONS | Yes | Style | |
| `background_background` | SELECT | No | Style | classic \| gradient |
| `background_color` | COLOR | Yes | Style | |
| `box_shadow` | SELECT | No | Style | |
| `box_shadow_*` | * | Yes | Style | Color, blur, spread, offsets |
| `border_border` | SELECT | No | Style | |
| `border_width` | DIMENSIONS | Yes | Style | |
| `border_color` | COLOR | Yes | Style | |
| `border_radius` | DIMENSIONS | Yes | Style | |
| `custom_css_classes` | TEXT | No | Advanced | |
| `custom_css` | TEXTAREA | No | Advanced | |

---

## Text Editor (widgetType: text-editor)

Rich text content. Stores **HTML** (not plain text).

### Minimal Example

```javascript
{
  "elType": "widget",
  "widgetType": "text-editor",
  "settings": {
    "editor": "<p>This is a paragraph.</p>"
  }
}
```

### Required Settings

| Setting | Type | Default |
|---|---|---|
| `editor` | HTML | (empty) |

### Content Settings

| Setting | Type | Notes |
|---|---|---|
| `editor` | WYSIWYG/HTML | The actual content. Can include `<p>`, `<h1>`–`<h6>`, `<strong>`, `<em>`, `<ul>`, `<ol>`, `<li>`, `<a>`, `<blockquote>`, `<code>` |

### Full Typography & Styling

```javascript
"settings": {
  "editor": "<p>Read our case study.</p>",
  "typography_typography": "custom",
  "typography_font_family": "Inter",
  "typography_font_size": { "unit": "px", "size": "18" },
  "typography_line_height": { "unit": "em", "size": "1.55" },
  "text_color": "#333333",
  "background_color": "transparent"
}
```

### Alignment & Spacing

```javascript
"settings": {
  "editor": "...",
  "align": "center",  // left, center, right
  "margin": { "unit": "px", "top": "20", "right": "0", "bottom": "20", "left": "0", "isLinked": false }
}
```

### Responsive Typography

```javascript
"settings": {
  "editor": "...",
  "typography_font_size": { "unit": "px", "size": "18" },
  "typography_font_size_tablet": { "unit": "px", "size": "16" },
  "typography_font_size_mobile": { "unit": "px", "size": "14" }
}
```

### Full Settings Catalogue (Text Editor)

| Setting Name | Type | Responsive | Notes |
|---|---|---|---|
| `editor` | HTML | No | Rich content |
| `align` | SELECT | Yes | left/center/right |
| `text_color` | COLOR | Yes | Text color |
| `typography_typography` | SELECT | No | custom \| kit preset |
| `typography_font_family` | SELECT | Yes | |
| `typography_font_size` | DIMENSIONS | Yes | |
| `typography_font_weight` | SELECT | Yes | |
| `typography_line_height` | DIMENSIONS | Yes | |
| `typography_letter_spacing` | DIMENSIONS | Yes | |
| `typography_text_transform` | SELECT | Yes | |
| `padding` | DIMENSIONS | Yes | |
| `margin` | DIMENSIONS | Yes | |
| `background_background` | SELECT | No | |
| `background_color` | COLOR | Yes | |
| `border_*` | * | Yes | All border controls |
| `box_shadow_*` | * | Yes | All shadow controls |
| `custom_css_classes` | TEXT | No | |
| `custom_css` | TEXTAREA | No | |

---

## Button (widgetType: button)

Clickable button widget. Supports text + icon + link.

### Minimal Example

```javascript
{
  "elType": "widget",
  "widgetType": "button",
  "settings": {
    "text": "Get started",
    "link": { "url": "https://example.com/signup" }
  }
}
```

### Required Settings

| Setting | Type | Default |
|---|---|---|
| `text` | TEXT | (empty) |

### Content Settings

| Setting | Type | Values | Default | Notes |
|---|---|---|---|---|
| `text` | TEXT | any string | (empty) | Button label |
| `link` | LINK | object | `{}` | URL + attributes |
| `link.url` | TEXT | URL | (empty) | Destination |
| `link.is_external` | SELECT | `on` \| empty | empty | Open in new tab |
| `link.custom_attributes` | TEXT | (free text) | (empty) | Raw HTML attributes |
| `button_type` | SELECT | `primary` \| `secondary` | `primary` | Style preset |
| `size` | SELECT | `sm` \| `md` \| `lg` \| `xl` | `md` | Size preset |
| `icon` | ICON | icon class | (empty) | Icon from set (e.g. `fas fa-arrow-right`) |
| `icon_align` | SELECT | `left` \| `right` | `left` | Icon position relative to text |

### Typography & Styling

```javascript
"settings": {
  "text": "Read the docs",
  "link": { "url": "https://docs.example.com", "is_external": "on" },
  "typography_typography": "custom",
  "typography_font_size": { "unit": "px", "size": "16" },
  "typography_font_weight": "700",
  "text_color": "#FFFFFF",
  "background_background": "classic",
  "background_color": "#FF5733",
  "border_radius": { "unit": "px", "top": "4", "right": "4", "bottom": "4", "left": "4", "isLinked": true },
  "padding": { "unit": "px", "top": "12", "right": "24", "bottom": "12", "left": "24", "isLinked": false }
}
```

### Hover State (Text/Background)

Elementor automatically generates hover CSS. You can control colors:

```javascript
"settings": {
  "text": "...",
  "text_hover_color": "#FF5733",         // Color on hover
  "background_hover_color": "#FFFFFF"    // Background on hover (if applicable)
}
```

### Full Settings Catalogue (Button)

| Setting Name | Type | Responsive | Notes |
|---|---|---|---|
| `text` | TEXT | No | |
| `link` | LINK | No | URL object |
| `button_type` | SELECT | No | primary/secondary |
| `size` | SELECT | No | sm/md/lg/xl |
| `icon` | ICON | No | Icon class |
| `icon_align` | SELECT | No | left/right |
| `align` | SELECT | Yes | left/center/right |
| `text_color` | COLOR | Yes | |
| `text_hover_color` | COLOR | Yes | Hover state |
| `background_background` | SELECT | No | |
| `background_color` | COLOR | Yes | |
| `background_hover_color` | COLOR | Yes | |
| `border_border` | SELECT | No | |
| `border_color` | COLOR | Yes | |
| `border_radius` | DIMENSIONS | Yes | |
| `padding` | DIMENSIONS | Yes | |
| `margin` | DIMENSIONS | Yes | |
| `typography_font_family` | SELECT | Yes | |
| `typography_font_size` | DIMENSIONS | Yes | |
| `typography_font_weight` | SELECT | Yes | |
| `typography_text_transform` | SELECT | Yes | |
| `typography_line_height` | DIMENSIONS | Yes | |
| `typography_letter_spacing` | DIMENSIONS | Yes | |
| `box_shadow_*` | * | Yes | All shadow controls |
| `custom_css_classes` | TEXT | No | |
| `custom_css` | TEXTAREA | No | |

---

## Image (widgetType: image)

Static or linked image widget.

### Minimal Example

```javascript
{
  "elType": "widget",
  "widgetType": "image",
  "settings": {
    "image": {
      "url": "https://placehold.co/800x600/0E0E0C/F3F2EC?text=Hero",
      "alt": "Hero banner"
    }
  }
}
```

### Required Settings

| Setting | Type | Default |
|---|---|---|
| `image` | MEDIA | `{}` (empty) |

### Content Settings

| Setting | Type | Notes |
|---|---|---|
| `image.url` | TEXT | Full HTTPS URL |
| `image.alt` | TEXT | Alt text (accessibility + SEO) |
| `image.id` | NUMBER | Media library ID (optional; Elementor fills if omitted) |
| `image_size` | SELECT | `thumbnail`, `medium`, `large`, `full` (for library images) |
| `link` | LINK | Optional link wrapper |
| `link.url` | TEXT | Destination URL if image is clickable |
| `link.is_external` | SELECT | `on` if external |

### Sizing & Styling

```javascript
"settings": {
  "image": {
    "url": "https://...",
    "alt": "Feature image"
  },
  "width": { "unit": "%", "size": "100" },     // Responsive width
  "max_width": { "unit": "px", "size": "600" },
  "aspect_ratio": "16:9",                       // If supported
  "border_radius": {
    "unit": "px",
    "top": "8",
    "right": "8",
    "bottom": "8",
    "left": "8",
    "isLinked": true
  },
  "box_shadow": "yes",
  "box_shadow_color": "rgba(0,0,0,0.1)"
}
```

### Spacing

```javascript
"settings": {
  "image": { ... },
  "align": "center",
  "margin": { "unit": "px", "top": "0", "right": "0", "bottom": "30", "left": "0", "isLinked": false },
  "padding": { "unit": "px", "top": "10", "right": "10", "bottom": "10", "left": "10", "isLinked": true }
}
```

### Full Settings Catalogue (Image)

| Setting Name | Type | Responsive | Notes |
|---|---|---|---|
| `image` | MEDIA | No | URL object |
| `image.url` | TEXT | No | |
| `image.alt` | TEXT | No | |
| `image.id` | NUMBER | No | Library ID |
| `image_size` | SELECT | No | For library images |
| `link` | LINK | No | Optional link |
| `align` | SELECT | Yes | left/center/right |
| `width` | DIMENSIONS | Yes | |
| `max_width` | DIMENSIONS | Yes | |
| `aspect_ratio` | SELECT | No | Preset or custom |
| `border_radius` | DIMENSIONS | Yes | |
| `border_border` | SELECT | No | |
| `border_color` | COLOR | Yes | |
| `border_width` | DIMENSIONS | Yes | |
| `margin` | DIMENSIONS | Yes | |
| `padding` | DIMENSIONS | Yes | |
| `box_shadow` | SELECT | No | |
| `box_shadow_*` | * | Yes | Color, blur, spread, offset |
| `opacity` | NUMBER | Yes | 0–1 |
| `caption` | TEXT | No | Optional caption below image |
| `caption_text_color` | COLOR | Yes | |
| `custom_css_classes` | TEXT | No | |
| `custom_css` | TEXTAREA | No | |

---

## Icon (widgetType: icon)

Single icon widget from Elementor's icon library (FontAwesome, eicons, etc.).

### Minimal Example

```javascript
{
  "elType": "widget",
  "widgetType": "icon",
  "settings": {
    "icon": { "value": "fas fa-star", "library": "fa-solid" }
  }
}
```

### Required Settings

| Setting | Type | Default |
|---|---|---|
| `icon` | ICON | `{}` |

### Content Settings

| Setting | Type | Values | Notes |
|---|---|---|---|
| `icon.value` | TEXT | icon class (e.g. `fas fa-star`) | The actual icon |
| `icon.library` | TEXT | `fa-solid`, `fa-regular`, `eicons` | Icon set |
| `link` | LINK | object | Optional link |
| `view` | SELECT | `default`, `stacked` | Stacked displays icon in circle/square |

### Styling

```javascript
"settings": {
  "icon": { "value": "fas fa-check", "library": "fa-solid" },
  "icon_color": "#FF5733",
  "icon_size": { "unit": "px", "size": "48" },
  "icon_color_hover": "#FFFFFF",       // Hover color
  "view": "stacked",
  "background_background": "classic",
  "background_color": "#0E0E0C",
  "border_radius": { "unit": "px", "size": "50", "isLinked": true }  // Perfect circle
}
```

### Full Settings Catalogue (Icon)

| Setting Name | Type | Responsive | Notes |
|---|---|---|---|
| `icon` | ICON | No | Value + library |
| `link` | LINK | No | Optional link |
| `view` | SELECT | No | default/stacked |
| `icon_color` | COLOR | Yes | Icon color |
| `icon_color_hover` | COLOR | Yes | Hover color |
| `icon_size` | DIMENSIONS | Yes | |
| `background_background` | SELECT | No | For stacked view |
| `background_color` | COLOR | Yes | |
| `border_radius` | DIMENSIONS | Yes | |
| `padding` | DIMENSIONS | Yes | For stacked view |
| `margin` | DIMENSIONS | Yes | |
| `align` | SELECT | Yes | left/center/right |
| `box_shadow_*` | * | Yes | |
| `custom_css_classes` | TEXT | No | |
| `custom_css` | TEXTAREA | No | |

---

## Divider (widgetType: divider)

Horizontal or vertical line. Useful for visual separation.

### Minimal Example

```javascript
{
  "elType": "widget",
  "widgetType": "divider",
  "settings": {
    "style": "solid"
  }
}
// Renders: <hr class="elementor-divider">
```

### Content Settings

| Setting | Type | Values | Default | Notes |
|---|---|---|---|---|
| `style` | SELECT | `solid`, `dotted`, `dashed`, `double`, `groove`, `ridge`, `inset`, `outset` | `solid` | Border style |

### Styling

```javascript
"settings": {
  "style": "solid",
  "divider_width": { "unit": "px", "size": "2" },
  "divider_color": "#CCCCCC",
  "margin": { "unit": "px", "top": "20", "right": "0", "bottom": "20", "left": "0", "isLinked": false }
}
```

### Full Settings Catalogue (Divider)

| Setting Name | Type | Responsive | Notes |
|---|---|---|---|
| `style` | SELECT | No | solid/dotted/dashed/etc. |
| `divider_width` | DIMENSIONS | Yes | Width of line |
| `divider_color` | COLOR | Yes | Line color |
| `margin` | DIMENSIONS | Yes | |
| `padding` | DIMENSIONS | Yes | |
| `align` | SELECT | Yes | left/center/right |
| `custom_css_classes` | TEXT | No | |
| `custom_css` | TEXTAREA | No | |

---

## Spacer (widgetType: spacer)

Invisible spacing element. Used to add whitespace between elements.

### Minimal Example

```javascript
{
  "elType": "widget",
  "widgetType": "spacer",
  "settings": {
    "space": { "unit": "px", "size": "40" }
  }
}
```

### Required Settings

| Setting | Type | Default |
|---|---|---|
| `space` | DIMENSIONS | `{ "unit": "px", "size": "20" }` |

### Content Settings

| Setting | Type | Notes |
|---|---|---|
| `space` | DIMENSIONS | Height of spacer |

### Responsive Spacing

```javascript
"settings": {
  "space": { "unit": "px", "size": "80" },
  "space_tablet": { "unit": "px", "size": "60" },
  "space_mobile": { "unit": "px", "size": "40" }
}
```

### Full Settings Catalogue (Spacer)

| Setting Name | Type | Responsive | Notes |
|---|---|---|---|
| `space` | DIMENSIONS | Yes | Height of spacer |
| `custom_css_classes` | TEXT | No | |
| `custom_css` | TEXTAREA | No | |

---

## Video (widgetType: video)

Embedded video from YouTube, Vimeo, or self-hosted.

### Minimal Example (YouTube)

```javascript
{
  "elType": "widget",
  "widgetType": "video",
  "settings": {
    "video_type": "youtube",
    "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  }
}
```

### Required Settings (one of these)

| Setting | Condition |
|---|---|
| `youtube_url` | if `video_type: youtube` |
| `vimeo_url` | if `video_type: vimeo` |
| `hosted_url` | if `video_type: hosted` |

### Content Settings

| Setting | Type | Values | Notes |
|---|---|---|---|
| `video_type` | SELECT | `youtube`, `vimeo`, `hosted` | Source type |
| `youtube_url` | TEXT | URL | Full YouTube URL |
| `vimeo_url` | TEXT | URL | Full Vimeo URL |
| `hosted_url` | MEDIA | object | Self-hosted video file |
| `aspect_ratio` | SELECT | `169` (16:9), `43` (4:3), `square`, `custom` | |
| `custom_aspect_ratio` | TEXT | e.g. `16/9` | If `aspect_ratio: custom` |
| `controls` | SELECT | `yes` \| empty (no) | Show player controls |
| `autoplay` | SELECT | `yes` \| empty | Auto-start on page load |
| `loop` | SELECT | `yes` \| empty | Loop on end |
| `muted` | SELECT | `yes` \| empty | Mute by default |

### Styling

```javascript
"settings": {
  "video_type": "youtube",
  "youtube_url": "https://...",
  "aspect_ratio": "169",
  "autoplay": "yes",
  "controls": "yes",
  "width": { "unit": "%", "size": "100" },
  "max_width": { "unit": "px", "size": "800" },
  "border_radius": { "unit": "px", "size": "8", "isLinked": true },
  "margin": { "unit": "px", "top": "0", "right": "0", "bottom": "30", "left": "0", "isLinked": false }
}
```

### Full Settings Catalogue (Video)

| Setting Name | Type | Responsive | Notes |
|---|---|---|---|
| `video_type` | SELECT | No | youtube/vimeo/hosted |
| `youtube_url` | TEXT | No | |
| `vimeo_url` | TEXT | No | |
| `hosted_url` | MEDIA | No | |
| `aspect_ratio` | SELECT | No | 169/43/square/custom |
| `custom_aspect_ratio` | TEXT | No | If aspect_ratio: custom |
| `controls` | SELECT | No | yes or empty |
| `autoplay` | SELECT | No | yes or empty |
| `loop` | SELECT | No | yes or empty |
| `muted` | SELECT | No | yes or empty |
| `width` | DIMENSIONS | Yes | |
| `max_width` | DIMENSIONS | Yes | |
| `align` | SELECT | Yes | left/center/right |
| `border_radius` | DIMENSIONS | Yes | |
| `border_border` | SELECT | No | |
| `border_color` | COLOR | Yes | |
| `border_width` | DIMENSIONS | Yes | |
| `margin` | DIMENSIONS | Yes | |
| `padding` | DIMENSIONS | Yes | |
| `box_shadow_*` | * | Yes | |
| `custom_css_classes` | TEXT | No | |
| `custom_css` | TEXTAREA | No | |

---

## HTML (widgetType: html)

Raw HTML widget. Used for code/embed that doesn't fit native widgets. **Last resort only** — breaks responsive editing in the UI.

### Minimal Example

```javascript
{
  "elType": "widget",
  "widgetType": "html",
  "settings": {
    "html": "<div class='custom'>...</div>"
  }
}
```

### Required Settings

| Setting | Type |
|---|---|
| `html` | HTML/CODE |

### Content Settings

| Setting | Type | Notes |
|---|---|---|
| `html` | TEXTAREA (HTML) | Raw HTML — will not be escaped |

### Full Settings Catalogue (HTML)

| Setting Name | Type | Responsive | Notes |
|---|---|---|---|
| `html` | HTML | No | Raw HTML content |
| `margin` | DIMENSIONS | Yes | |
| `padding` | DIMENSIONS | Yes | |
| `align` | SELECT | Yes | left/center/right |
| `custom_css_classes` | TEXT | No | |
| `custom_css` | TEXTAREA | No | |

---

## Social Icons (widgetType: social-icons)

List of social media icons (clickable).

### Minimal Example

```javascript
{
  "elType": "widget",
  "widgetType": "social-icons",
  "settings": {
    "social_icon_list": [
      { "social_icon": "fab fa-facebook", "link": { "url": "https://facebook.com/..." } },
      { "social_icon": "fab fa-twitter", "link": { "url": "https://twitter.com/..." } },
      { "social_icon": "fab fa-linkedin", "link": { "url": "https://linkedin.com/..." } }
    ]
  }
}
```

### Required Settings

| Setting | Type | Default |
|---|---|---|
| `social_icon_list` | REPEATER | `[]` |

### Content Settings (Repeater Items)

Each item in `social_icon_list`:

| Setting | Type | Notes |
|---|---|---|
| `social_icon` | ICON | Icon class (e.g. `fab fa-facebook`) |
| `link` | LINK | URL object with `url` and optional `is_external` |

### Styling

```javascript
"settings": {
  "social_icon_list": [ ... ],
  "align": "center",
  "icon_size": { "unit": "px", "size": "24" },
  "icon_color": "#FFFFFF",
  "icon_color_hover": "#FF5733",
  "background_background": "classic",
  "background_color": "rgba(0,0,0,0.1)",
  "border_radius": { "unit": "px", "size": "50", "isLinked": true },
  "gap": { "unit": "px", "size": "12" }
}
```

### Full Settings Catalogue (Social Icons)

| Setting Name | Type | Responsive | Notes |
|---|---|---|---|
| `social_icon_list` | REPEATER | No | Array of social items |
| `align` | SELECT | Yes | left/center/right |
| `icon_size` | DIMENSIONS | Yes | |
| `icon_color` | COLOR | Yes | |
| `icon_color_hover` | COLOR | Yes | |
| `background_background` | SELECT | No | |
| `background_color` | COLOR | Yes | |
| `border_radius` | DIMENSIONS | Yes | |
| `gap` | DIMENSIONS | Yes | Space between icons |
| `padding` | DIMENSIONS | Yes | |
| `margin` | DIMENSIONS | Yes | |
| `custom_css_classes` | TEXT | No | |
| `custom_css` | TEXTAREA | No | |

---

## Icon List (widgetType: icon-list)

List of icons with text labels (not clickable by default; links optional).

### Minimal Example

```javascript
{
  "elType": "widget",
  "widgetType": "icon-list",
  "settings": {
    "icon_list": [
      { "icon": "fas fa-check", "text": "Fast shipping" },
      { "icon": "fas fa-shield-alt", "text": "Secure checkout" },
      { "icon": "fas fa-redo", "text": "30-day returns" }
    ]
  }
}
```

### Required Settings

| Setting | Type | Default |
|---|---|---|
| `icon_list` | REPEATER | `[]` |

### Content Settings (Repeater Items)

Each item in `icon_list`:

| Setting | Type | Notes |
|---|---|---|
| `icon` | ICON | Icon class |
| `text` | TEXT | Label text |
| `link` | LINK | Optional link (icon or text clickable) |

### Styling

```javascript
"settings": {
  "icon_list": [ ... ],
  "icon_color": "#FF5733",
  "icon_size": { "unit": "px", "size": "20" },
  "text_color": "#333333",
  "text_indent": { "unit": "px", "size": "10" },
  "gap": { "unit": "px", "size": "12" }
}
```

### Full Settings Catalogue (Icon List)

| Setting Name | Type | Responsive | Notes |
|---|---|---|---|
| `icon_list` | REPEATER | No | Array of icon-text pairs |
| `icon_color` | COLOR | Yes | |
| `icon_size` | DIMENSIONS | Yes | |
| `text_color` | COLOR | Yes | |
| `text_indent` | DIMENSIONS | Yes | Space between icon and text |
| `gap` | DIMENSIONS | Yes | Space between list items |
| `align` | SELECT | Yes | left/center/right |
| `padding` | DIMENSIONS | Yes | |
| `margin` | DIMENSIONS | Yes | |
| `typography_font_family` | SELECT | Yes | |
| `typography_font_size` | DIMENSIONS | Yes | |
| `typography_font_weight` | SELECT | Yes | |
| `typography_line_height` | DIMENSIONS | Yes | |
| `custom_css_classes` | TEXT | No | |
| `custom_css` | TEXTAREA | No | |

---

## Star Rating (widgetType: star-rating)

Star rating display (not interactive, for display only).

### Minimal Example

```javascript
{
  "elType": "widget",
  "widgetType": "star-rating",
  "settings": {
    "rating": "5"
  }
}
```

### Required Settings

| Setting | Type | Default |
|---|---|---|
| `rating` | NUMBER | `5` |

### Content Settings

| Setting | Type | Values | Notes |
|---|---|---|---|
| `rating` | NUMBER | 0–5 (decimal OK, e.g. 4.5) | Star count |
| `unmarked_style` | SELECT | `outline` \| `solid` | Unfilled star style |

### Styling

```javascript
"settings": {
  "rating": "4.5",
  "unmarked_style": "outline",
  "star_size": { "unit": "px", "size": "20" },
  "star_color": "#FFB800",
  "align": "center",
  "margin": { "unit": "px", "top": "10", "right": "0", "bottom": "10", "left": "0", "isLinked": false }
}
```

### Full Settings Catalogue (Star Rating)

| Setting Name | Type | Responsive | Notes |
|---|---|---|---|
| `rating` | NUMBER | No | 0–5 (decimal OK) |
| `unmarked_style` | SELECT | No | outline/solid |
| `star_size` | DIMENSIONS | Yes | |
| `star_color` | COLOR | Yes | |
| `align` | SELECT | Yes | left/center/right |
| `margin` | DIMENSIONS | Yes | |
| `padding` | DIMENSIONS | Yes | |
| `custom_css_classes` | TEXT | No | |
| `custom_css` | TEXTAREA | No | |

---

## Common Composition Patterns

Actual, production-quality examples of real Elementor plan JSON you'd author.

### Dark Hero Section (Full Width, Centered)

```javascript
{
  "elType": "container",
  "settings": {
    "content_width": "full",
    "min_height": { "unit": "vh", "size": "100" },
    "flex_direction": "column",
    "flex_justify_content": "center",
    "flex_align_items": "center",
    "padding": { "unit": "px", "top": "80", "right": "40", "bottom": "80", "left": "40", "isLinked": false },
    "background_background": "classic",
    "background_color": "#0E0E0C",
    "gap": { "unit": "px", "size": "30" }
  },
  "elements": [
    {
      "elType": "widget",
      "widgetType": "heading",
      "settings": {
        "title": "Engineering the floor up.",
        "header_size": "h1",
        "align": "center",
        "typography_typography": "custom",
        "typography_font_family": "Fraunces",
        "typography_font_size": { "unit": "px", "size": "72" },
        "typography_font_weight": "700",
        "typography_line_height": { "unit": "em", "size": "1.1" },
        "title_color": "#F3F2EC"
      }
    },
    {
      "elType": "widget",
      "widgetType": "text-editor",
      "settings": {
        "editor": "<p style=\"text-align:center;font-size:18px;line-height:1.6;max-width:600px;margin:0 auto;\">Joist is the agentic backbone for Elementor. AI that builds sites the way builders would — honest, audited, round-trip-editable.</p>",
        "text_color": "#F3F2EC"
      }
    },
    {
      "elType": "widget",
      "widgetType": "button",
      "settings": {
        "text": "Get started",
        "link": { "url": "https://example.com/start", "is_external": "on" },
        "text_color": "#0E0E0C",
        "background_color": "#A4E86D",
        "padding": { "unit": "px", "top": "14", "right": "32", "bottom": "14", "left": "32", "isLinked": false },
        "border_radius": { "unit": "px", "size": "6", "isLinked": true },
        "typography_font_weight": "700"
      }
    }
  ]
}
```

### 3-Column Feature Grid (Horizontal Layout)

```javascript
{
  "elType": "container",
  "settings": {
    "content_width": "boxed",
    "flex_direction": "row",
    "flex_wrap": "wrap",
    "flex_gap": { "unit": "px", "size": "40" },
    "padding": { "unit": "px", "top": "60", "right": "30", "bottom": "60", "left": "30", "isLinked": false },
    "background_background": "classic",
    "background_color": "#FFFFFF"
  },
  "elements": [
    {
      "elType": "container",
      "settings": {
        "flex_direction": "column",
        "flex_basis": "calc(33.333% - 27px)",  // Approximate 3-column split
        "flex_gap": { "unit": "px", "size": "16" },
        "align_items": "stretch"
      },
      "elements": [
        {
          "elType": "widget",
          "widgetType": "image",
          "settings": {
            "image": {
              "url": "https://placehold.co/400x300/0E0E0C/F3F2EC?text=Feature+1",
              "alt": "Feature 1"
            },
            "border_radius": { "unit": "px", "size": "8", "isLinked": true },
            "margin": { "unit": "px", "bottom": "16", "isLinked": false }
          }
        },
        {
          "elType": "widget",
          "widgetType": "heading",
          "settings": {
            "title": "Built for scale",
            "header_size": "h3",
            "align": "left",
            "title_color": "#0E0E0C"
          }
        },
        {
          "elType": "widget",
          "widgetType": "text-editor",
          "settings": {
            "editor": "<p>Handles thousands of pages without breaking a sweat.</p>",
            "text_color": "#666666"
          }
        }
      ]
    },
    {
      "elType": "container",
      "settings": {
        "flex_direction": "column",
        "flex_basis": "calc(33.333% - 27px)",
        "flex_gap": { "unit": "px", "size": "16" }
      },
      "elements": [
        {
          "elType": "widget",
          "widgetType": "image",
          "settings": {
            "image": {
              "url": "https://placehold.co/400x300/0E0E0C/F3F2EC?text=Feature+2",
              "alt": "Feature 2"
            },
            "border_radius": { "unit": "px", "size": "8", "isLinked": true },
            "margin": { "unit": "px", "bottom": "16", "isLinked": false }
          }
        },
        {
          "elType": "widget",
          "widgetType": "heading",
          "settings": {
            "title": "Audited by default",
            "header_size": "h3",
            "align": "left",
            "title_color": "#0E0E0C"
          }
        },
        {
          "elType": "widget",
          "widgetType": "text-editor",
          "settings": {
            "editor": "<p>Every edit logged, hashed, revertible.</p>",
            "text_color": "#666666"
          }
        }
      ]
    },
    {
      "elType": "container",
      "settings": {
        "flex_direction": "column",
        "flex_basis": "calc(33.333% - 27px)",
        "flex_gap": { "unit": "px", "size": "16" }
      },
      "elements": [
        {
          "elType": "widget",
          "widgetType": "image",
          "settings": {
            "image": {
              "url": "https://placehold.co/400x300/0E0E0C/F3F2EC?text=Feature+3",
              "alt": "Feature 3"
            },
            "border_radius": { "unit": "px", "size": "8", "isLinked": true },
            "margin": { "unit": "px", "bottom": "16", "isLinked": false }
          }
        },
        {
          "elType": "widget",
          "widgetType": "heading",
          "settings": {
            "title": "Open source",
            "header_size": "h3",
            "align": "left",
            "title_color": "#0E0E0C"
          }
        },
        {
          "elType": "widget",
          "widgetType": "text-editor",
          "settings": {
            "editor": "<p>On wp.org, licensed GPL. Yours to fork and extend.</p>",
            "text_color": "#666666"
          }
        }
      ]
    }
  ]
}
```

### Alternating Text-Image Sections

```javascript
// Left: Text, Right: Image
{
  "elType": "container",
  "settings": {
    "content_width": "boxed",
    "flex_direction": "row",
    "flex_wrap": "wrap",
    "flex_gap": { "unit": "px", "size": "60" },
    "flex_align_items": "center",
    "padding": { "unit": "px", "top": "60", "right": "30", "bottom": "60", "left": "30", "isLinked": false }
  },
  "elements": [
    {
      "elType": "container",
      "settings": {
        "flex_direction": "column",
        "flex_basis": "50%",
        "flex_gap": { "unit": "px", "size": "20" }
      },
      "elements": [
        {
          "elType": "widget",
          "widgetType": "heading",
          "settings": {
            "title": "Why Joist",
            "header_size": "h2",
            "title_color": "#0E0E0C"
          }
        },
        {
          "elType": "widget",
          "widgetType": "text-editor",
          "settings": {
            "editor": "<p>The first production AI agent for Elementor that doesn't hide what it does. Every edit is logged, hashed, audited, and revertible.</p><p>Joist speaks your language: Elementor. It builds sites the way you would — with taste, discipline, and honesty.</p>"
          }
        }
      ]
    },
    {
      "elType": "widget",
      "widgetType": "image",
      "settings": {
        "image": {
          "url": "https://placehold.co/500x400/0E0E0C/F3F2EC?text=About",
          "alt": "About Joist"
        },
        "width": { "unit": "%", "size": "50" },
        "border_radius": { "unit": "px", "size": "12", "isLinked": true }
      }
    }
  ]
}
```

### Centered Narrow Text Block (Max-Width Constraint)

```javascript
{
  "elType": "container",
  "settings": {
    "content_width": "boxed",
    "flex_direction": "column",
    "flex_align_items": "center",
    "padding": { "unit": "px", "top": "80", "right": "40", "bottom": "80", "left": "40", "isLinked": false },
    "background_background": "classic",
    "background_color": "#F9F9F9"
  },
  "elements": [
    {
      "elType": "widget",
      "widgetType": "heading",
      "settings": {
        "title": "How it works",
        "header_size": "h2",
        "align": "center",
        "title_color": "#0E0E0C"
      }
    },
    {
      "elType": "widget",
      "widgetType": "text-editor",
      "settings": {
        "editor": "<p style=\"text-align:center;max-width:640px;margin:0 auto;font-size:18px;line-height:1.6;\">Joist reads your intent in plain English, shapes it into an Elementor plan, and asks you to review before applying. No surprises. No locked-in changes.</p>",
        "text_color": "#666666",
        "margin": { "unit": "px", "top": "30", "bottom": "0", "isLinked": false }
      }
    }
  ]
}
```

---

## Gotchas & Anti-patterns

### 1. Numbers are Strings

Elementor internally stores numbers (font-size, padding, etc.) as strings, not JSON numbers:

```javascript
// WRONG
"typography_font_size": { "unit": "px", "size": 18 }

// CORRECT
"typography_font_size": { "unit": "px", "size": "18" }
```

The schema validator will accept either, but the read-back will return strings. Be consistent.

### 2. Responsive Variants Should Be Omitted if They Match Desktop

Don't auto-fill `_tablet` and `_mobile` suffixes unless they differ from the desktop value. Elementor's CSS cascade handles inheritance correctly via media queries. **Constraint #24 was updated to reflect this** — the old warning about responsive-incomplete was based on a wrong assumption.

```javascript
// CORRECT — desktop only, responsive values inherit via CSS
"typography_font_size": { "unit": "px", "size": "18" }

// UNNECESSARY (but harmless if values match)
"typography_font_size": { "unit": "px", "size": "18" },
"typography_font_size_tablet": { "unit": "px", "size": "18" },
"typography_font_size_mobile": { "unit": "px", "size": "18" }
```

### 3. Links Need `url` Key (Even if Empty)

Button links must have a `url` key even if empty:

```javascript
// CORRECT — minimal link
"link": { "url": "https://example.com" }

// CORRECT — with new-tab flag
"link": { "url": "https://example.com", "is_external": "on" }

// WRONG — missing url key
"link": { "is_external": "on" }
```

### 4. Icon Classes Must Be Exact

Icon values must match Elementor's registered icon library exactly:

```javascript
// CORRECT (FontAwesome v5+)
"icon": { "value": "fas fa-star", "library": "fa-solid" }

// CORRECT (Elementor icons)
"icon": { "value": "eicon-star", "library": "eicons" }

// WRONG — won't render
"icon": { "value": "star", "library": "fa-solid" }
```

### 5. Image URLs Must Be HTTPS

Elementor rejects non-HTTPS image URLs in security-hardened environments. Always use `https://`:

```javascript
// CORRECT
"image": { "url": "https://placehold.co/800x600/...", "alt": "..." }

// WRONG (will fail in many environments)
"image": { "url": "http://example.com/image.jpg", "alt": "..." }
```

### 6. Don't Invent Real-Looking Image URLs

Never generate fake CDN URLs for placeholder images. Use `placehold.co` or leave `url` empty:

```javascript
// CORRECT
"image": {
  "url": "https://placehold.co/800x600/0E0E0C/F3F2EC?text=Hero",
  "alt": "Hero banner"
}

// CORRECT (leave blank for user to fill)
"image": { "url": "", "alt": "Hero banner" }

// WRONG (fake unsplash URL — will 404 or hotlink block)
"image": { "url": "https://images.unsplash.com/...", "alt": "..." }
```

### 7. Container Min-Height Units Matter

`min_height` requires a separate `min_height_unit` control:

```javascript
// CORRECT
"settings": {
  "min_height": "100",
  "min_height_unit": "vh"  // Must specify
}

// INCOMPLETE (won't set height without unit)
"settings": {
  "min_height": "100"
}
```

### 8. Flex Basis for Multi-Column Layouts

To create N-column layouts with flex, use `flex_basis` on child containers:

```javascript
// Parent: 3-column layout with gap
"settings": {
  "flex_direction": "row",
  "flex_wrap": "wrap",
  "flex_gap": { "unit": "px", "size": "40" }
}

// Child 1 of 3 (accounting for gap math):
"settings": {
  "flex_basis": "calc(33.333% - 27px)"  // (100% - total gap) / 3
}

// Child 2 of 3:
"settings": {
  "flex_basis": "calc(33.333% - 27px)"
}
```

### 9. Don't Use Responsive Padding/Margin on Text Widgets Without Testing

Text widget responsive padding can cause text reflow issues on very narrow viewports. Prefer reducing font-size instead:

```javascript
// SAFER for responsive
"typography_font_size": { "unit": "px", "size": "18" },
"typography_font_size_mobile": { "unit": "px", "size": "14" }

// RISKY for responsive
"padding_mobile": { "unit": "px", "size": "0" }  // Might reflow text unexpectedly
```

### 10. Typography Presets Can't Mix with Custom Settings

If `typography_typography` is set to a kit preset (e.g. `primary`), don't also set `typography_font_family`, `typography_font_size`, etc. They'll conflict:

```javascript
// CORRECT — use preset
"settings": {
  "typography_typography": "primary"
}

// CORRECT — full custom
"settings": {
  "typography_typography": "custom",
  "typography_font_family": "Roboto",
  "typography_font_size": { "unit": "px", "size": "18" }
}

// WRONG — mixing preset + custom (preset wins, custom ignored)
"settings": {
  "typography_typography": "primary",
  "typography_font_size": { "unit": "px", "size": "24" }  // Ignored
}
```

### 11. Background Overlays (Not Covered in V3 Native)

Elementor V3 doesn't have native `background_overlay_*` controls on regular containers. Use a separate container with opacity instead:

```javascript
// Pattern: text over image via stacked containers
{
  "elType": "container",
  "settings": {
    "background_background": "classic",
    "background_image": { "url": "https://...", "alt": "..." },
    "background_size": "cover",
    "background_attachment": "fixed",
    "position": "relative"
  },
  "elements": [
    {
      "elType": "container",
      "settings": {
        "background_background": "classic",
        "background_color": "rgba(0,0,0,0.5)",  // Dark overlay
        "position": "absolute",
        "top": "0", "left": "0", "width": "100%", "height": "100%"
      },
      "elements": []
    },
    {
      "elType": "widget",
      "widgetType": "heading",
      "settings": {
        "title": "Text over image",
        "title_color": "#FFFFFF"
      }
    }
  ]
}
```

### 12. Avoid Nested Sections (V3 Only Containers)

In V3 with containers-only mode, don't emit `elType: "section"`. Always use `elType: "container"`:

```javascript
// CORRECT
"elType": "container"

// WRONG (legacy, will fail in V3 containers-only)
"elType": "section"
```

### 13. The `isInner` Flag Auto-Detection

Don't manually set `isInner: true` unless you're wrapping a section inside a column (rare). The `PatchEngine` sets it automatically:

```javascript
// CORRECT — let PatchEngine set isInner
"elType": "container",
"settings": { ... }

// WRONG — unnecessary manual flag
"elType": "container",
"isInner": true,
"settings": { ... }
```

### 14. V4 Auto-Fields

If the site is Elementor 4.0.x, the plugin silently strips these fields on write-back (per `V4_AUTO_FIELDS`). Don't include them:

```javascript
// CORRECT — omit V4 fields
"elType": "widget",
"widgetType": "heading",
"settings": { ... }

// OK (will be auto-stripped on V4)
"elType": "widget",
"widgetType": "heading",
"settings": { ... },
"styles": [],
"interactions": []
```

### 15. Don't Hardcode Kit Global Colors

Instead of guessing color hex values, prefer leaving them blank or using a light default. The `GlobalRefPreferrer` transformer will inject `__globals__` references if the color is in the kit:

```javascript
// GOOD — let the transformer prefer globals
"title_color": "#FF5733"

// Also good — leave blank and let humans customize
"title_color": ""

// AVOID — hardcoded kit color (won't auto-link to kit on update)
"title_color": "var(--e-global-color-primary)"  // Joist will transform this
```

---

## Summary Table: Which Settings Are Responsive?

Most settings can take `_tablet` and `_mobile` suffixes. The table below shows the **exceptions** — settings that do NOT support responsive variants:

| Widget | Non-Responsive Settings |
|---|---|
| **Container** | `content_width`, `flex_direction`, `flex_wrap`, `flex_align_content`, `min_height_unit`, `flex_child_width`, `flex_child_height`, `background_background`, `background_image`, `background_attachment`, `background_size`, `background_position`, `background_repeat`, `background_gradient_angle`, `background_gradient_stops`, `border_border`, `box_shadow`, `custom_css_classes`, `custom_css` |
| **Heading** | `title`, `header_size`, `typography_typography`, `custom_css_classes`, `custom_css` |
| **Text Editor** | `editor`, `background_background`, `border_border`, `custom_css_classes`, `custom_css` |
| **Button** | `text`, `link`, `button_type`, `size`, `icon`, `icon_align`, `background_background`, `custom_css_classes`, `custom_css` |
| **Image** | `image`, `image.url`, `image.alt`, `image.id`, `image_size`, `link`, `aspect_ratio`, `custom_aspect_ratio`, `border_border`, `custom_css_classes`, `custom_css` |
| **Icon** | `icon`, `icon.value`, `icon.library`, `link`, `view`, `background_background`, `custom_css_classes`, `custom_css` |
| **Divider** | `style`, `custom_css_classes`, `custom_css` |
| **Spacer** | `custom_css_classes`, `custom_css` |
| **Video** | `video_type`, `youtube_url`, `vimeo_url`, `hosted_url`, `aspect_ratio`, `custom_aspect_ratio`, `controls`, `autoplay`, `loop`, `muted`, `border_border`, `custom_css_classes`, `custom_css` |
| **HTML** | `html`, `custom_css_classes`, `custom_css` |
| **Social Icons** | `social_icon_list`, `background_background`, `custom_css_classes`, `custom_css` |
| **Icon List** | `icon_list`, `custom_css_classes`, `custom_css` |
| **Star Rating** | `rating`, `unmarked_style`, `custom_css_classes`, `custom_css` |

**Rule:** If a setting is not in the table, it supports responsive variants (`_tablet`, `_mobile`).

---

## References & Source Authority

- **Local introspection:** `plugin/src/Elementor/WidgetCatalog.php` — reads live widget schema from Elementor installation
- **Schema validation:** `plugin/src/Elementor/SchemaValidator.php` — constraints #1, #24, #27, #29
- **Plan generators:** `plugin/src/Plan/PlanGenerator.php`, `plugin/src/Plan/CloneGenerator.php` — system prompts document min-required settings
- **V4 auto-fields:** `knowledge/V4_ATOMIC_NORMALIZATIONS.md` — fields auto-added on V4 saves
- **Elementor upstream:** Elementor's GitHub `includes/widgets/` — source of truth for each widget's control definitions (inspect at https://github.com/elementor/elementor)

---

**Last Updated:** 2026-05-30  
**Status:** Reference (living document)  
**Audience:** Claude Code agents authoring Elementor V3 plans
