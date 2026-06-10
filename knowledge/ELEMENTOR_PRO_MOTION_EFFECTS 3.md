# Elementor Pro Motion Effects — Comprehensive Reference

**Purpose:** Exhaustive technical reference of all Motion Effects capabilities in Elementor Pro (v2.5+), including exact JSON settings shapes for `_elementor_data`, what's authoring-ready vs beyond reach, and which effects require Pro vs are free.

**Date:** 2026-05-31  
**Status:** Reference (living document)  
**Audience:** Joist's clone skill + agents authoring Elementor plans; team building motion-heavy sites

---

## Table of Contents

1. [Overview & Architecture](#overview--architecture)
2. [Motion Effects Subsystems](#motion-effects-subsystems)
3. [Scrolling Effects (Pro)](#scrolling-effects-pro)
4. [Mouse Effects (Pro)](#mouse-effects-pro)
5. [Sticky Scrolling (Pro)](#sticky-scrolling-pro)
6. [Floating Animation (Free in Core Widget)](#floating-animation-free-in-core-widget)
7. [Entrance Animations (Free)](#entrance-animations-free)
8. [Custom CSS Hooks (Pro)](#custom-css-hooks-pro)
9. [What Elementor Pro Cannot Do](#what-elementor-pro-cannot-do)
10. [Authoring Decision Matrix](#authoring-decision-matrix)

---

## Overview & Architecture

### What Is Motion Effects?

**Motion Effects** is Elementor Pro's subsystem for applying frame-by-frame animations triggered by scroll position, mouse movement, or page load. Introduced in Elementor Pro v2.5 (2019), it consists of three independent subsystems:

1. **Scrolling Effects** — animations triggered as user scrolls (parallax, blur, rotate, scale, transparency)
2. **Mouse Effects** — animations triggered by cursor position (mouse track, 3D tilt)
3. **Sticky** — element fixed to viewport edge with optional offset
4. **Floating** — continuous looping motion (translate, rotate, scale) without user input

Additionally:
- **Entrance Animations** are *free in all Elementor versions* (50+ preset classes)
- **Custom CSS** per widget is Pro-only (scoped auto-selectors)

### Setting Storage

Motion Effects settings are stored in the widget's `settings` object in `_elementor_data` JSON under these keys:

- `animation` — entrance animation (free)
- `motion_fx_motion_fx_scrolling` — scrolling effects enabled flag
- `motion_fx_motion_fx_[effect_type]` — scrolling effect settings
- `motion_fx_motion_fx_mouse_track` — mouse track effect settings
- `motion_fx_motion_fx_3d_tilt` — 3D tilt effect settings
- `motion_fx_sticky` — sticky settings
- `motion_fx_floating` — floating effect settings (may be in Elementor Pro or as a separate module)
- `custom_css` — per-widget custom CSS (Pro-only)

**Critical:** Elementor **does not auto-fill responsive variants** for motion effects. If a responsive variant (`_tablet`, `_mobile`) is omitted, the desktop setting applies.

---

## Motion Effects Subsystems

### 1. Scrolling Effects (Pro)

**What:** Animations that trigger as the user scrolls; element movement is bound to viewport scroll position.

**Availability:** Elementor Pro only (Pro v2.5+)

**How It Works:**
- User scrolls → Elementor measures viewport height and element position
- Animation plays between defined viewport anchors (e.g., "start when widget is 50% of viewport away, end when fully visible")
- Motion is **continuous** and **linear** with scroll position (not a separate timing animation)

**Configuration Options (All Scrolling Effects):**
- **Direction:** `up` | `down` (for vertical), `left` | `right` (for horizontal), or effect-specific (blur direction)
- **Speed:** 0–10 (intensity of effect; internally scales the translation/opacity/blur amount)
- **Viewport:** viewport-based anchor points (0–100% of screen height)
  - Default: `motion_fx_viewport_anchor`: {`anchor_start`: "0", `anchor_end`: "100"}` (start when entering viewport, end when exiting)
  - Custom range: e.g., `{"anchor_start": "50", "anchor_end": "100"}` (effect only during upper half of element visibility)
- **Effects Relative To:** `default` | `viewport` | `entire_page` (determines scroll reference frame)
- **Device:** desktop, tablet, mobile (can enable/disable per breakpoint)

---

### 2. Scrolling Effect — Vertical Scroll (translateY)

**Visual:** Element moves up or down as page scrolls, creating classic parallax depth.

**Settings Shape (in `_elementor_data`):**

```javascript
"settings": {
  "motion_fx_motion_fx_scrolling": "yes",  // Enable scrolling effects
  "motion_fx_motion_fx_translateY": {
    "direction": "up",                      // "up" | "down"
    "speed": "4",                           // 0–10 (string)
    "effects_relative_to": "viewport",      // "default" | "viewport" | "entire_page"
    "motion_fx_viewport_anchor": {
      "anchor_start": "0",
      "anchor_end": "100"
    }
  },
  "motion_fx_viewport_anchor": {
    "anchor_start": "0",
    "anchor_end": "100"
  }
}
```

**Configurable:**
- Direction (up/down)
- Speed (0–10)
- Viewport range (anchor_start, anchor_end)
- Effects relative to (viewport or entire page)

**Device-Specific:** Can be enabled only on desktop, tablet, or mobile via `motion_fx_translateY_tablet` / `motion_fx_translateY_mobile` keys.

---

### 3. Scrolling Effect — Horizontal Scroll (translateX)

**Visual:** Element moves left or right as page scrolls vertically (counter-intuitive parallax).

**Settings Shape:**

```javascript
"settings": {
  "motion_fx_motion_fx_scrolling": "yes",
  "motion_fx_motion_fx_translateX": {
    "direction": "left",                    // "left" | "right"
    "speed": "3",
    "effects_relative_to": "viewport",
    "motion_fx_viewport_anchor": {
      "anchor_start": "0",
      "anchor_end": "100"
    }
  }
}
```

**Configurable:**
- Direction (left/right)
- Speed (0–10)
- Viewport range
- Effects relative to

---

### 4. Scrolling Effect — Transparency (Opacity)

**Visual:** Element fades in/out/cycles as user scrolls.

**Settings Shape:**

```javascript
"settings": {
  "motion_fx_motion_fx_scrolling": "yes",
  "motion_fx_motion_fx_opacity": {
    "direction": "fade_in",                 // "fade_in" | "fade_out" | "fade_out_in" | "fade_in_out"
    "speed": "5",
    "effects_relative_to": "viewport",
    "motion_fx_viewport_anchor": {
      "anchor_start": "0",
      "anchor_end": "100"
    }
  }
}
```

**Directions:**
- `fade_in` — element starts transparent, becomes opaque
- `fade_out` — element starts opaque, becomes transparent
- `fade_out_in` — opaque → transparent → opaque
- `fade_in_out` — transparent → opaque → transparent

**Configurable:**
- Direction (4 fade modes)
- Speed (0–10)
- Viewport range
- Effects relative to

---

### 5. Scrolling Effect — Blur

**Visual:** Element transitions between blurred and sharp as user scrolls.

**Settings Shape:**

```javascript
"settings": {
  "motion_fx_motion_fx_scrolling": "yes",
  "motion_fx_motion_fx_blur": {
    "direction": "fade_in",                 // Same 4 fade directions
    "speed": "5",                           // Blur intensity (0–10)
    "effects_relative_to": "viewport",
    "motion_fx_viewport_anchor": {
      "anchor_start": "0",
      "anchor_end": "100"
    }
  }
}
```

**Configurable:**
- Direction (4 fade modes, controlling blur phase)
- Speed (blur strength, 0–10)
- Viewport range
- Effects relative to

---

### 6. Scrolling Effect — Rotate

**Visual:** Element rotates clockwise or counterclockwise as user scrolls.

**Settings Shape:**

```javascript
"settings": {
  "motion_fx_motion_fx_scrolling": "yes",
  "motion_fx_motion_fx_rotate": {
    "direction": "clockwise",               // "clockwise" | "counterclockwise"
    "speed": "3",                           // Rotation speed (0–10)
    "effects_relative_to": "viewport",
    "motion_fx_viewport_anchor": {
      "anchor_start": "0",
      "anchor_end": "100"
    },
    "motion_fx_rotate_anchor_point": {
      "x": "center",                        // "left" | "center" | "right"
      "y": "center"                         // "top" | "center" | "bottom"
    }
  }
}
```

**Anchor Points (NEW):** When Rotate or Scale is enabled, **two new controls appear**: X and Y anchor points, which determine the pivot axis of rotation.

**Configurable:**
- Direction (clockwise/counterclockwise)
- Speed (0–10)
- Viewport range
- X anchor point (left, center, right)
- Y anchor point (top, center, bottom)
- Effects relative to

---

### 7. Scrolling Effect — Scale

**Visual:** Element grows or shrinks as user scrolls.

**Settings Shape:**

```javascript
"settings": {
  "motion_fx_motion_fx_scrolling": "yes",
  "motion_fx_motion_fx_scale": {
    "direction": "grow",                    // "grow" | "shrink" | "grow_shrink" | "shrink_grow"
    "speed": "4",                           // Scale intensity (0–10)
    "effects_relative_to": "viewport",
    "motion_fx_viewport_anchor": {
      "anchor_start": "0",
      "anchor_end": "100"
    },
    "motion_fx_scale_anchor_point": {
      "x": "center",                        // "left" | "center" | "right"
      "y": "center"                         // "top" | "center" | "bottom"
    }
  }
}
```

**Directions:**
- `grow` — scale from small to large
- `shrink` — scale from large to small
- `grow_shrink` — grow then shrink
- `shrink_grow` — shrink then grow

**Anchor Points:** Same as Rotate (determines scale origin).

**Configurable:**
- Direction (4 scale modes)
- Speed (0–10)
- Viewport range
- X anchor point
- Y anchor point
- Effects relative to

---

## Mouse Effects (Pro)

**What:** Animations triggered by cursor position; element motion follows mouse movement.

**Availability:** Elementor Pro only

**Note:** **Avoid combining mouse effects with scroll effects on the same element** — Elementor can produce glitches. Separate widgets if both are needed.

---

### 8. Mouse Effect — Mouse Track

**Visual:** Element follows cursor with parallax offset (cursor moves → element lags slightly).

**Settings Shape:**

```javascript
"settings": {
  "motion_fx_motion_fx_mouse_track": {
    "direction": "opposite",                // "opposite" | "direct"
    "speed": "3",                           // Parallax intensity (0–10, string)
    "enable_mobile": "no"                   // "yes" | "no"
  }
}
```

**Directions:**
- `opposite` — element moves opposite to cursor (feels like element is "behind" cursor)
- `direct` — element moves same direction as cursor (element "chases" cursor)

**Configurable:**
- Direction (opposite/direct)
- Speed (0–10)
- Mobile support (enable/disable on mobile)

---

### 9. Mouse Effect — 3D Tilt

**Visual:** Element tilts toward cursor with 3D perspective, creating depth illusion (like element is staring at cursor).

**Settings Shape:**

```javascript
"settings": {
  "motion_fx_motion_fx_3d_tilt": {
    "direction": "opposite",                // "opposite" | "direct"
    "speed": "5",                           // Tilt intensity (0–10, string)
    "enable_mobile": "no"                   // Recommended off on mobile
  }
}
```

**Directions:**
- `opposite` — element tilts away from cursor (appears convex to cursor)
- `direct` — element tilts toward cursor (appears concave to cursor)

**Configurable:**
- Direction (opposite/direct)
- Speed (0–10)
- Mobile support

---

## Sticky Scrolling (Pro)

**What:** Element stays fixed to viewport top or bottom as page scrolls; stops at container boundary.

**Availability:** Elementor Pro only

**Settings Shape:**

```javascript
"settings": {
  "motion_fx_sticky": {
    "enable_sticky": "yes",                 // "yes" | "no"
    "sticky_on": {
      "desktop": true,                      // true | false
      "tablet": true,
      "mobile": false
    },
    "sticky_offset": {
      "unit": "px",
      "size": "20"                          // Pixels from edge (top or bottom)
    },
    "sticky_effects_offset": {
      "unit": "px",
      "size": "0"                           // Pixels to scroll before sticky activates
    },
    "sticky_parent_option": "column",       // "column" | "section" | "body"
    "sticky_top_bottom": "top"              // "top" | "bottom"
  }
}
```

**Configurable:**
- Enable/disable
- Devices (desktop, tablet, mobile)
- Offset from edge (in px)
- Effects offset (when to start sticking)
- Parent scope (stay within parent container or section)
- Anchor (top or bottom of viewport)

**Behavior:**
- Element sticks to top/bottom of viewport while scrolling
- Offset pushes element inward (e.g., 20px offset = 20px gap between element and viewport edge)
- Effects offset determines scroll distance before stickiness begins
- Stops sticking when user scrolls past parent container

---

## Floating Animation (Free in Core Widget)

**What:** Continuous looping motion (not scroll-triggered); element animates indefinitely without user input.

**Availability:** Free (native Elementor Core or Pro widget)

**Settings Shape:**

```javascript
"settings": {
  "motion_fx_floating": {
    "motion_type": "translate",             // "translate" | "rotate" | "scale"
    "translate_x": {
      "value": "10"                         // Pixels to move horizontally
    },
    "translate_y": {
      "value": "-20"                        // Pixels to move vertically
    },
    "rotate_value": {
      "value": "5"                          // Degrees to rotate
    },
    "scale_value": {
      "value": "1.05"                       // Scale factor (1.0 = 100%)
    },
    "duration": "2000",                     // Animation cycle duration (ms)
    "delay": "0"                            // Animation start delay (ms)
  }
}
```

**Motion Types:**
- `translate` — element moves smoothly (configurable X/Y pixels)
- `rotate` — element rotates continuously (configurable degrees)
- `scale` — element scales up/down in loop (configurable scale factor)

**Configurable:**
- Motion type (translate, rotate, scale)
- Translate X/Y (pixels)
- Rotate amount (degrees)
- Scale factor (multiplier)
- Duration (ms, default ~2000)
- Delay (ms, when to start)

**Behavior:**
- Animation loops infinitely at constant speed
- All 3 motion types can **coexist** on same element (translate + rotate + scale simultaneously)
- No scroll or mouse trigger needed

---

## Entrance Animations (Free)

**What:** Animations applied when widget/container enters viewport during scroll; plays once per load (or on interaction).

**Availability:** Elementor Free and Pro

**Complete List of Entrance Animations:**

Elementor provides **37+ preset entrance animation classes** (based on Animate.css or custom library). Common families:

### Fade Animations
- fadeIn
- fadeInUp, fadeInDown, fadeInLeft, fadeInRight
- fadeInTopLeft, fadeInTopRight, fadeInBottomLeft, fadeInBottomRight

### Slide Animations
- slideInUp, slideInDown, slideInLeft, slideInRight

### Zoom Animations
- zoomIn
- zoomInUp, zoomInDown, zoomInLeft, zoomInRight

### Bounce Animations
- bounceIn
- bounceInUp, bounceInDown, bounceInLeft, bounceInRight

### Rotate Animations
- rotateIn
- rotateInDownLeft, rotateInDownRight, rotateInUpLeft, rotateInUpRight

### Flip Animations
- flipInX, flipInY

### Light Speed Animations
- lightSpeedInLeft, lightSpeedInRight

### Roll Animations
- rollIn

### Attention/Pulse Animations
- pulse, heartBeat, swing, wobble, jello, rubber

### Settings Shape:**

```javascript
"settings": {
  "animation": "fadeInUp",                  // Animation class name (string)
  "animation_duration": "1",                // Duration in seconds (string)
  "animation_delay": "0.5",                 // Delay before animation starts (seconds, string)
  "animation_repeat": "once",               // "once" | "infinite" (rarely used)
  
  // Responsive variants (optional, inherit desktop if omitted)
  "animation_tablet": "fadeIn",             // Different animation per breakpoint
  "animation_mobile": "slideInUp",
  
  "animation_duration_tablet": "1.5",
  "animation_duration_mobile": "0.8"
}
```

**Configurable:**
- Animation class (37+ presets)
- Duration (0.1–10 seconds)
- Delay (0–5 seconds)
- Per-breakpoint animation variant
- Repeat mode (usually `once`)

**Viewport Trigger:**
- Plays when widget's **top edge enters viewport** (configurable via global Motion Effects viewport settings)

---

## Custom CSS Hooks (Pro)

**What:** Per-widget CSS field in Advanced tab; scoped CSS that loads only on pages using that widget.

**Availability:** Elementor Pro only

**Settings Shape:**

```javascript
"settings": {
  "custom_css": ".elementor-element.elementor-element-{ID} { ... CSS here ... }"
}
```

**Selector Pattern:**
- `.elementor-element.elementor-element-{ID}` — Elementor **auto-replaces `{ID}`** with the actual widget ID at render time
- `:hover` — target hover state on the element
- `::before`, `::after` — pseudo-elements
- Child selectors — e.g., `.elementor-element-{ID} .heading-text`

**Example:**

```javascript
"custom_css": `
  .elementor-element.elementor-element-{ID} {
    animation: customFloat 3s ease-in-out infinite;
  }
  .elementor-element.elementor-element-{ID}:hover {
    transform: scale(1.05);
  }
  @keyframes customFloat {
    0% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
    100% { transform: translateY(0); }
  }
`
```

**Use Cases:**
- Custom animations (GSAP-like effects via CSS @keyframes)
- Advanced hover states
- CSS transitions (not possible in Motion Effects UI)
- Magnetic cursor effects (requires JS, CSS alone insufficient)
- Parallax via CSS `transform` (though Motion Effects already handles this)

**Limitations:**
- No JavaScript execution (JS animations require HTML widget with `<script>`)
- No access to DOM events (no scroll listener, no resize handler)
- CSS is scoped to widget, cannot affect siblings or parents

---

## What Elementor Pro Cannot Do

Even with Pro + Custom CSS, these effects are **out of reach** without third-party plugins or custom JS:

### 1. **Scrollytelling with Multiple Phases**
**What:** Text reveals, image swaps, color changes triggered at specific scroll distances (e.g., "at 30% scroll of this section, fade in text X; at 60%, swap image Y").

**Why Not Possible:**
- Motion Effects are **continuous** and **linear** with scroll (not discrete phases)
- No "if scroll > 50% AND scroll < 75%, do X" logic
- Would require JavaScript + event listeners

**Alternative:** Third-party plugins (Scroll Sequence Widget, Unlimited Elements) or custom GSAP + ScrollTrigger embedding.

---

### 2. **Pinned/Sticky Scroll Sequences**
**What:** Element pins to viewport, content inside scrolls independently (like "scroll within scroll").

**Why Not Possible:**
- Elementor's Sticky only fixes element to edge; content inside scrolls normally
- No way to pin multiple sequential sections, each with independent scroll triggers

**Alternative:** GSAP ScrollTrigger with `pin` and `pinSpacing` options (requires JS embed).

---

### 3. **WebGL / 3D Scenes**
**What:** Interactive 3D models, WebGL canvas, Three.js scenes.

**Why Not Possible:**
- Elementor has no native 3D engine
- 3D Tilt is a **CSS perspective illusion**, not actual 3D geometry

**Alternative:** HTML widget with Three.js embed, or third-party plugins (Gloo 3D Model Widget, PausAR, Exclusive WebGL).

---

### 4. **Magnetic Cursor / Blob Following**
**What:** Cursor-following shape that deforms/stretches toward cursor (trendy 2024+ effect).

**Why Not Possible:**
- Requires real-time mouse tracking with canvas/SVG path calculation
- CSS alone cannot deform shapes dynamically
- JavaScript required

**Alternative:** Custom JS in HTML widget or third-party plugins.

---

### 5. **GSAP / Advanced Easing**
**What:** Non-linear animation timing (ease-out-bounce, cubic-bezier, etc.) for scroll effects.

**Why Not Possible:**
- Motion Effects use linear scroll interpolation
- No easing curve control in Motion Effects UI
- Custom CSS @keyframes can use easing, but only for **continuous animations**, not scroll-linked

**Alternative:** GSAP ScrollTrigger (via JS embed) or Animation Addons plugin.

---

### 6. **Parallax with Fixed Layers**
**What:** Multiple elements at different depths, each parallaxing at different speeds, creating depth illusion.

**Why Not Possible:**
- Motion Effects parallax each element independently
- No way to sync multiple elements' scroll timelines or create "depth layers"
- Can approximate by manually setting different speeds per element, but not true depth perspective

**Alternative:** Custom CSS with clever layering, or GSAP + ScrollTrigger for precise control.

---

### 7. **Entrance Animation with Stagger Sequence**
**What:** Multiple widgets fade in one-by-one with delays (e.g., hero, then text below, then CTA).

**Why Not Possible:**
- Entrance animations have global delay, but no "stagger across siblings" option
- Each widget must have its own explicit delay entered manually

**Alternative:** Use increasing `animation_delay` per widget (tedious but works), or third-party Sequence Entrance Animation plugin.

---

## Authoring Decision Matrix

Use this matrix to decide which Motion Effects tier each detected effect requires:

| Effect Class | Free Elementor | Pro Motion Effects | Pro + Custom CSS | Pro + JS Embed | Out of Reach |
|---|---|---|---|---|---|
| **Entrance Animation (fade, slide, zoom, bounce, rotate, etc.)** | ✅ Yes | — | — | — | — |
| **Entrance Animation with Custom Timing** | ❌ No (37 presets only) | — | ✅ (via @keyframes CSS) | — | — |
| **Vertical Scroll (parallax Y)** | ❌ No | ✅ Yes | — | — | — |
| **Horizontal Scroll (parallax X)** | ❌ No | ✅ Yes | — | — | — |
| **Transparency on Scroll** | ❌ No | ✅ Yes | — | — | — |
| **Blur on Scroll** | ❌ No | ✅ Yes | — | — | — |
| **Rotate on Scroll** | ❌ No | ✅ Yes | — | — | — |
| **Scale on Scroll** | ❌ No | ✅ Yes | — | — | — |
| **Mouse Track Parallax** | ❌ No | ✅ Yes | — | — | — |
| **3D Tilt on Hover** | ❌ No | ✅ Yes | — | — | — |
| **Sticky Header/Element** | ❌ No | ✅ Yes | — | — | — |
| **Floating Animation (continuous loop)** | ✅ (Free widget) | — | — | — | — |
| **Custom CSS Animation (@keyframes)** | ❌ No | — | ✅ Yes | — | — |
| **Hover State Transition** | ❌ No | — | ✅ (via :hover CSS) | — | — |
| **Scrollytelling (multi-phase)** | ❌ No | ❌ No | ❌ No | ✅ (GSAP ScrollTrigger) | — |
| **Pinned Scroll Sequence** | ❌ No | ❌ No | ❌ No | ✅ (GSAP pin) | — |
| **Magnetic Cursor** | ❌ No | ❌ No | ❌ No | ✅ (canvas JS) | — |
| **WebGL / 3D Scene** | ❌ No | ❌ No | ❌ No | — | ✅ (third-party plugin) |
| **Stagger Sequence (multiple widgets)** | ❌ No | — | ✅ (manual delays) | ✅ (GSAP stagger) | — |

---

## Joist Clone Skill Integration

### Current State
- Clone skill caps at ~70% fidelity on motion-heavy sites
- Reasons: No awareness of which effects are Pro-only, no JSON shape knowledge, motion effects not yet in plan authoring

### Next Steps (for Joist team)

1. **Update joist_create_plan** to accept motion_fx settings in steps
   - Add `motion_fx_scrolling`, `motion_fx_sticky`, `motion_fx_floating` to step schema
   - Validate Pro license before attempting to author scrolling/mouse effects

2. **Update PatchEngine** to handle motion_fx settings merges
   - Merge entrance animation + scrolling effect on same widget (both can coexist)
   - Warn if both scroll + mouse effects on same widget

3. **Add pre-flight checks to clone skill**
   - Detect motion effects in source HTML/CSS via Playwright
   - Cross-reference against this matrix
   - Exclude out-of-reach effects from plan; note in grading

4. **Entrance Animation Library**
   - Build a lookup table mapping common animation names (e.g., "fade in", "slide up", "bounce in") to Elementor class names
   - Use in grading to suggest matching entrance animation if text/image appears to animate in source

5. **Fidelity Model Update**
   - Scrolling effects: +3–5% fidelity if authored correctly
   - Entrance animations: +2–3% fidelity
   - Mouse effects: +2% fidelity
   - Out-of-reach effects: note as "75% fidelity ceiling" in design brief

---

## References & Sources

- **Elementor Pro Motion Effects Blog Post:** https://elementor.com/blog/introducing-motion-effects/
- **Elementor Knowledge Base — Motion Effects:** https://elementor.com/help/motion-effects/
- **Elementor Scrolling Effects — Vertical Scroll:** https://elementor.com/help/scrolling-effects-vertical-scroll/
- **Elementor Scrolling Effects — Scale:** https://elementor.com/help/scrolling-effects-scale/
- **Elementor Scrolling Effects — Blur:** https://elementor.com/help/scrolling-effects-blur/
- **Elementor Mouse Effects — 3D Tilt:** https://elementor.com/help/mouse-effects-3d-tilt/
- **Elementor Mouse Effects — Mouse Track:** https://elementor.com/help/mouse-effects-mouse-track/
- **Elementor Sticky Scrolling Effect:** https://elementor.com/help/sticky-scrolling-effect-pro/
- **Elementor Motion Effects Viewport Settings:** https://elementor.com/academy/how-to-use-motion-effects-viewport-settings-in-elementor/
- **Elementor Custom CSS:** https://elementor.com/help/custom-css-in-elementor/
- **Elementor Free vs Pro:** https://elementor.com/help/elementor-pro-vs-free/
- **Scrollytelling Guide:** https://elementor.com/blog/guide-to-scrollytelling/
- **GSAP ScrollTrigger Integration (Discussion):** https://github.com/orgs/elementor/discussions/31839

---

**Version:** 1.0  
**Last Updated:** 2026-05-31  
**Author:** Joist Research (Claude Code)  
**Status:** Ready for Joist skill integration
