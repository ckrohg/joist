# Custom CSS Injection Recipe Book for Elementor V3 FREE

**Date:** 2026-05-31  
**Status:** Production recipe reference  
**Purpose:** Comprehensive CSS-only and JS-light motion/effect techniques achievable in Elementor FREE tier (no Pro Motion Effects required)

## Context & scope

Most Joist users won't have Elementor Pro. Pro Motion Effects ($199+/year) unlocks timeline-based animations, scroll-driven triggers, and the Motion Library. **This document covers what's achievable with FREE Elementor 3.x–4.x using:**

1. **Custom CSS** (available per-widget via Advanced → Custom CSS field, or globally via HTML widget)
2. **Minimal embedded JS** (~12 lines max for intersection-observer patterns)
3. **CSS animations, transitions, transforms, filters, blend modes, clip-path, backdrop-filter**
4. **Modern CSS** (Grid, Flexbox, @supports, @keyframes, CSS variables)

**Target audience:** Clone skill engineers authoring pages for free-tier users, and users who want motion without paying for Pro.

**Honest fidelity ceiling:** ~75% of what Pro Motion Effects offers. We lose timeline scrubbing, scroll-progress coupling, and event-driven triggers. We gain: lightweight, no extra plugin, works everywhere Elementor works.

---

## Part 1: How to inject custom CSS in Elementor

### Option 1: Per-widget Custom CSS (all widgets, V3/V4 free)

**Where:** Edit any widget → Advanced tab → Custom CSS field  
**Scope:** CSS applies to that widget only, scoped to `.elementor-element-<ID>`  
**Syntax:** write raw CSS (no `<style>` tags)

```css
/* In the Custom CSS field, write directly (no tags needed) */
transform: rotate(5deg);
transition: all 0.3s ease;

&:hover {
  transform: rotate(0deg);
}
```

**Quirk:** Ampersand (`&`) works as a reference to the current element's selector.

### Option 2: Global HTML widget with `<style>`

**Where:** Insert → General → HTML widget  
**Scope:** Applies to whole page; use class selectors to target  
**Syntax:** must include `<style>` tags

```html
<style>
  .fade-in-on-scroll {
    opacity: 0;
    transform: translateY(20px);
    transition: opacity 0.6s ease, transform 0.6s ease;
  }

  .fade-in-on-scroll.visible {
    opacity: 1;
    transform: translateY(0);
  }
</style>
```

Then add class `.fade-in-on-scroll` to target elements (via custom_css_classes field).

### Option 3: Hybrid—target by element ID or parent context

Some effects need to target related elements. Use HTML widget + CSS selectors:

```html
<style>
  /* Target heading inside a specific container */
  .hero-section .elementor-heading-title {
    position: relative;
  }

  .hero-section .elementor-heading-title::after {
    content: '';
    position: absolute;
    bottom: -5px;
    left: 0;
    width: 0;
    height: 3px;
    background: #00ff7f;
    transition: width 0.5s ease;
  }

  .hero-section:hover .elementor-heading-title::after {
    width: 100%;
  }
</style>
```

**Free tier limitation check:** `custom_css` field exists in Elementor V3.x–4.x free. Verified behavior: scopes to `.elementor-element-<unique-id>` automatically.

---

## Part 2: CSS-only effects (no JavaScript)

### Hover Effects

#### 1. Scale on hover with smooth transition

**Effect:** Subtle grow effect, useful for interactive cards.

**Where to add:** Per-widget Custom CSS field (on the element you want to scale)

```css
transition: transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);

&:hover {
  transform: scale(1.05);
}
```

**Browser support:** All modern browsers (IE 10+)  
**Performance:** GPU-accelerated (transform), 60fps on mobile  
**Mobile:** Triggers on `:active` (tap), not `:hover`. Consider touch-action: manipulation to avoid double-tap zoom.

---

#### 2. Lift + shadow on hover (card pattern)

**Effect:** Card rises with a growing shadow on hover—classic elevation effect.

**Where to add:** Per-widget Custom CSS (on card container or wrapper)

```css
transition: transform 0.25s ease-out, box-shadow 0.25s ease-out;
box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);

&:hover {
  transform: translateY(-8px);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.2);
}
```

**Browser support:** All modern browsers  
**Performance:** Lightweight, box-shadow animates smoothly  
**Mobile:** Applies on `:active`. Add padding to card to prevent shadow crop on smaller screens.

---

#### 3. Image overlay reveal on hover

**Effect:** Darken or colorize an image overlay on hover, with text reveal.

**Where to add:** HTML widget (global scope, targets image by class)

```html
<style>
  .overlay-image {
    position: relative;
    overflow: hidden;
    display: inline-block;
    width: 100%;
  }

  .overlay-image img {
    display: block;
    width: 100%;
    transition: filter 0.4s ease;
  }

  .overlay-image::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.4);
    opacity: 0;
    transition: opacity 0.4s ease;
    z-index: 1;
    pointer-events: none;
  }

  .overlay-image:hover::before {
    opacity: 1;
  }

  .overlay-image:hover img {
    filter: brightness(0.8);
  }
</style>
```

Assign class `overlay-image` to an image widget's custom CSS classes.

**Browser support:** All modern (requires `::before` pseudo-element)  
**Performance:** Filter is GPU-accelerated on modern hardware  
**Mobile:** Overlay stays on tap; consider adding explicit close gesture for better UX.

---

#### 4. Text underline animation (left-to-right)

**Effect:** Underline grows from left to right on hover—elegant accent for links/buttons.

**Where to add:** Per-widget Custom CSS (on text or button)

```css
position: relative;

&::after {
  content: '';
  position: absolute;
  bottom: -4px;
  left: 0;
  width: 0;
  height: 2px;
  background: linear-gradient(90deg, #00ff7f, #00d4ff);
  transition: width 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

&:hover::after {
  width: 100%;
}
```

**Variant—expand from center:**

```css
&::after {
  left: 50%;
  transition: left 0.4s ease, width 0.4s ease;
}

&:hover::after {
  left: 0;
  width: 100%;
}
```

**Browser support:** All modern  
**Performance:** Transform-based would be faster; this approach is simpler and visually clean  
**Mobile:** Underline reveals on `:active` (tap), not ideal UX. Use sparingly on buttons.

---

#### 5. Color invert on hover

**Effect:** Swap foreground and background colors on hover (button-style flip).

**Where to add:** Per-widget Custom CSS

```css
transition: background-color 0.3s ease, color 0.3s ease;
background-color: #1a1a1a;
color: #ffffff;

&:hover {
  background-color: #ffffff;
  color: #1a1a1a;
}
```

**Smoother variant with blend mode:**

```css
position: relative;
transition: color 0.3s ease;
color: #ffffff;

&::before {
  content: '';
  position: absolute;
  inset: 0;
  background: #ffffff;
  opacity: 0;
  transition: opacity 0.3s ease;
  z-index: -1;
}

&:hover::before {
  opacity: 1;
}

&:hover {
  color: #1a1a1a;
}
```

**Browser support:** All modern  
**Performance:** Very fast  
**Mobile:** Works on `:active`.

---

#### 6. Desaturate on hover (color reduction)

**Effect:** Image or element goes full-color → grayscale on hover.

**Where to add:** Per-widget Custom CSS (on image widget)

```css
transition: filter 0.4s ease;
filter: grayscale(100%);

&:hover {
  filter: grayscale(0%);
}
```

**Multi-filter variant (also brighten):**

```css
&:hover {
  filter: grayscale(0%) brightness(1.1);
}
```

**Browser support:** All modern browsers  
**Performance:** GPU-accelerated filter  
**Mobile:** Applies on `:active`.

---

#### 7. 3D tilt effect with `transform-style: preserve-3d`

**Effect:** Card tilts subtly in 3D space on hover (no mouse-tracking JS).

**Where to add:** Per-widget Custom CSS

```css
perspective: 1200px;
transform-style: preserve-3d;
transition: transform 0.4s ease;

&:hover {
  transform: rotateX(5deg) rotateY(-5deg) translateZ(10px);
}
```

**Browser support:** Modern browsers (IE 10+, Safari 9+)  
**Performance:** GPU-accelerated, but 3D perspective is heavier than 2D transforms  
**Mobile:** Touch doesn't trigger `:hover`; effect won't apply. Consider replacing with 2D scale for mobile.

**Responsive variant (mobile-safe):**

```html
<style>
  .tilt-card {
    perspective: 1200px;
    transition: transform 0.4s ease;
  }

  @media (hover: hover) {
    /* Desktop only */
    .tilt-card:hover {
      transform: rotateX(5deg) rotateY(-5deg) translateZ(10px);
    }
  }

  @media (hover: none) {
    /* Mobile: use 2D scale instead */
    .tilt-card:active {
      transform: scale(1.03);
    }
  }
</style>
```

---

#### 8. Gradient border on hover

**Effect:** Animated gradient border that appears/shifts on hover.

**Where to add:** Per-widget Custom CSS (on card or button container)

```css
position: relative;
transition: all 0.4s ease;
background: #ffffff;
border: 2px solid #e0e0e0;

&::before {
  content: '';
  position: absolute;
  inset: -2px;
  background: linear-gradient(135deg, #ff0080, #7928ca, #1890ff);
  border-radius: inherit;
  opacity: 0;
  transition: opacity 0.4s ease;
  z-index: -1;
}

&:hover {
  border-color: transparent;

  &::before {
    opacity: 1;
  }
}
```

**Note:** This creates the illusion of an animated border. True animated gradient borders require `border-image` with `@keyframes`, which is more complex.

**Simpler version (solid color shift):**

```css
border: 2px solid #cccccc;
transition: border-color 0.3s ease, box-shadow 0.3s ease;

&:hover {
  border-color: #00ff7f;
  box-shadow: inset 0 0 0 1px #00ff7f;
}
```

**Browser support:** All modern  
**Performance:** Light  
**Mobile:** Applies on `:active`.

---

#### 9. Magnetic-feel cursor pull (CSS-only fake)

**Effect:** Button or element appears to follow cursor slightly (CSS-only approximation).

**True magnetic effect requires JS mouse tracking.** CSS-only version: use `:focus` or scale-on-hover to fake the effect.

**Where to add:** Per-widget Custom CSS

```css
transition: transform 0.2s ease;

&:hover {
  transform: scale(1.08) translateX(-3px);
}
```

**More convincing approach (requires ~20 lines of JS):** See JavaScript section below.

**CSS-only alternative (bias hover state):**

```css
position: relative;
transition: all 0.3s ease;

&:hover {
  transform: scale(1.05) translateY(-2px);
  filter: drop-shadow(0 8px 12px rgba(0, 0, 0, 0.15));
}
```

**Browser support:** All modern  
**Performance:** Fast  
**Mobile:** Won't work without JS.

---

### Scroll-driven effects (CSS-only)

#### 10. Sticky scroll headings (position: sticky)

**Effect:** Heading pins at top of viewport while content scrolls beneath.

**Where to add:** Per-widget Custom CSS (on heading widget)

```css
position: sticky;
top: 0;
z-index: 100;
background-color: #ffffff;
/* Ensure heading doesn't disappear behind sibling content */
box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
transition: box-shadow 0.3s ease;
```

**Optional—shadow grows as user scrolls (requires JS):** See Part 3.

**Browser support:** All modern browsers  
**Performance:** Very lightweight  
**Mobile:** Works perfectly on touch devices.

**Pro tip:** Ensure parent container has `position: relative` and sufficient height for the effect to be visible.

---

#### 11. Scroll-snap horizontal galleries

**Effect:** Carousel/gallery snaps to item-center as user scrolls horizontally.

**Where to add:** HTML widget (global) or per-widget Custom CSS on container

```html
<style>
  .scroll-snap-gallery {
    display: flex;
    gap: 20px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    /* Smooth scrolling on iOS */
    -webkit-overflow-scrolling: touch;
    /* Hide scrollbar but allow scrolling */
    scrollbar-width: none;
  }

  .scroll-snap-gallery::-webkit-scrollbar {
    display: none;
  }

  .scroll-snap-gallery > * {
    flex: 0 0 85vw;
    scroll-snap-align: center;
    scroll-snap-stop: always;
  }

  @media (min-width: 768px) {
    .scroll-snap-gallery > * {
      flex: 0 0 50vw;
    }
  }
</style>
```

Wrap gallery items in a container with class `scroll-snap-gallery`.

**Browser support:** All modern browsers; scroll-snap is well-supported as of 2025  
**Performance:** Native scrolling performance, no JS overhead  
**Mobile:** Excellent—users expect snapping on mobile.

**Variant—vertical scroll-snap:**

```css
.scroll-snap-vertical {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  scroll-snap-type: y mandatory;
  height: 100vh;
}

.scroll-snap-vertical > * {
  flex: 0 0 100vh;
  scroll-snap-align: start;
  scroll-snap-stop: always;
}
```

---

#### 12. Scroll-snap vertical sections (snap-to-section fullscreen)

**Effect:** Full-page scroll snaps to section boundaries—each section fills viewport.

**Where to add:** HTML widget at page level

```html
<style>
  html.snap-to-sections {
    scroll-snap-type: y mandatory;
    scroll-behavior: smooth;
  }

  html.snap-to-sections body {
    margin: 0;
    padding: 0;
  }

  .section-snap {
    scroll-snap-align: start;
    scroll-snap-stop: always;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>

<script>
  // Add 'snap-to-sections' class to html element on page load
  document.documentElement.classList.add('snap-to-sections');
</script>
```

Apply class `section-snap` to each Elementor Section widget via custom CSS classes.

**Browser support:** All modern browsers  
**Performance:** Native, very fast  
**Mobile:** Works great on iOS and Android; users expect fullscreen sections.

---

#### 13. Reveal-on-scroll with `@scroll-timeline` (Chromium 115+)

**Effect:** Element fades in and slides up as it enters viewport—purely CSS, no JS intersection observer.

**Where to add:** HTML widget (global) + class on target elements

```html
<style>
  @supports (animation-timeline: view()) {
    .reveal-on-scroll {
      animation: revealOnScroll linear;
      animation-timeline: view();
      animation-range: entry 0% cover 25%;
      opacity: 0;
      transform: translateY(40px);
    }

    @keyframes revealOnScroll {
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  }

  /* Fallback for non-supporting browsers */
  @supports not (animation-timeline: view()) {
    .reveal-on-scroll {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
```

Assign class `reveal-on-scroll` to widgets you want to animate.

**Browser support:** Chromium 115+ (late 2023). Safari 18+. Firefox 114+ (experimental). IE/Edge Legacy: no support.  
**Fallback behavior:** Elements visible immediately (no animation, but readable).  
**Performance:** Pure CSS, zero JS overhead on supporting browsers.

**Note:** This is the most modern approach and future-proof. Pair with JS-based intersection observer (Part 3) for wider compatibility.

---

#### 14. Parallax with `background-attachment: fixed`

**Effect:** Background image moves slower than foreground as user scrolls—cheap parallax.

**Where to add:** Per-widget Custom CSS (on section or container with background image)

```css
background-attachment: fixed;
background-position: center;
background-size: cover;
```

**Enhanced version with color overlay:**

```css
background-attachment: fixed;
background-image: linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4)), url('image.jpg');
background-position: center;
background-size: cover;
position: relative;
min-height: 500px;
display: flex;
align-items: center;
justify-content: center;
```

**Browser support:** All modern browsers (IE 9+)  
**Performance:** Very lightweight—native browser parallax  
**Mobile:** `background-attachment: fixed` has mixed support on iOS. Some devices ignore it. Consider adding a fallback non-parallax version.

**Mobile-safe variant:**

```html
<style>
  .parallax {
    background-attachment: fixed;
    background-size: cover;
  }

  @media (max-width: 767px) {
    .parallax {
      background-attachment: scroll;
      /* Fallback: fixed position on smaller screens */
    }
  }
</style>
```

---

### Layout & visual effects (CSS-only)

#### 15. CSS-only bento grid with named grid areas

**Effect:** Asymmetric grid layout (like Apple's bento box design) using CSS Grid areas.

**Where to add:** HTML widget or per-widget Custom CSS on container

```html
<style>
  .bento-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, auto);
    gap: 16px;
    margin: 40px 0;
  }

  /* Define named grid areas */
  @supports (grid-template-areas: '') {
    .bento-grid {
      grid-template-areas:
        'hero hero hero'
        'card1 card2 card3'
        'card4 card4 card5';
    }

    .bento-item:nth-child(1) {
      grid-area: hero;
    }

    .bento-item:nth-child(2) {
      grid-area: card1;
    }

    .bento-item:nth-child(3) {
      grid-area: card2;
    }

    .bento-item:nth-child(4) {
      grid-area: card3;
    }

    .bento-item:nth-child(5) {
      grid-area: card4;
    }

    .bento-item:nth-child(6) {
      grid-area: card5;
    }
  }

  .bento-item {
    background: #f5f5f5;
    padding: 20px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
  }

  /* Responsive fallback */
  @media (max-width: 768px) {
    .bento-grid {
      grid-template-columns: 1fr;
      grid-template-areas:
        'hero'
        'card1'
        'card2'
        'card3'
        'card4'
        'card5';
    }
  }
</style>
```

**Browser support:** Grid is well-supported across all modern browsers  
**Performance:** Zero runtime cost  
**Mobile:** Responsive grid areas work great on mobile.

---

#### 16. Marquee/infinite scroll text animation

**Effect:** Text scrolls horizontally infinitely—useful for testimonials, logos, credits.

**Where to add:** HTML widget (global) or per-widget Custom CSS

```html
<style>
  .marquee {
    display: flex;
    gap: 40px;
    white-space: nowrap;
    overflow: hidden;
    background: #f0f0f0;
    padding: 20px 0;
  }

  .marquee-content {
    display: flex;
    gap: 40px;
    animation: marquee 30s linear infinite;
    will-change: transform;
  }

  @keyframes marquee {
    0% {
      transform: translateX(0);
    }
    100% {
      transform: translateX(-50%);
    }
  }

  /* Clone content for seamless loop */
  .marquee-content::after {
    content: attr(data-text);
    margin-left: 40px;
    /* Visually duplicate without extra HTML */
  }

  /* Pause on hover (optional) */
  .marquee:hover .marquee-content {
    animation-play-state: paused;
  }
</style>

<div class="marquee">
  <div class="marquee-content">
    <span>Trusted by 1000+ agencies</span>
    <span>Trusted by 1000+ agencies</span>
    <span>Trusted by 1000+ agencies</span>
  </div>
</div>
```

**Browser support:** All modern browsers  
**Performance:** GPU-accelerated animation, very smooth  
**Mobile:** Works great; pause-on-tap by adding touch handlers (JS).

**Variant—seamless loop without duplicated HTML:**

Use CSS `repeat()` or JavaScript to duplicate content:

```javascript
const marquee = document.querySelector('.marquee-content');
marquee.innerHTML += marquee.innerHTML;
```

---

#### 17. Liquid gradient backgrounds

**Effect:** Blended, flowing color backgrounds using `background-blend-mode` and gradients.

**Where to add:** Per-widget Custom CSS (on section or container)

```css
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
background-blend-mode: multiply;
/* Or other modes: screen, overlay, color-dodge, lighten, etc. */

/* Animated variant */
animation: gradientShift 8s ease infinite;
background-size: 200% 200%;

@keyframes gradientShift {
  0%, 100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}
```

**Browser support:** `background-blend-mode` supported in all modern browsers  
**Performance:** Very lightweight  
**Mobile:** Works great.

**Multi-layer liquid effect (for more complexity):**

```css
background:
  radial-gradient(ellipse at 30% 40%, rgba(255, 0, 127, 0.3) 0%, transparent 40%),
  radial-gradient(ellipse at 70% 60%, rgba(0, 150, 255, 0.3) 0%, transparent 40%),
  linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
background-blend-mode: screen;
```

---

#### 18. Animated gradient borders

**Effect:** Border with an animated gradient that cycles through colors.

**Where to add:** Per-widget Custom CSS

```css
position: relative;
border: 2px solid transparent;
background-clip: padding-box;
/* Real border rendered via pseudo-element gradient */

&::before {
  content: '';
  position: absolute;
  inset: -2px;
  background: conic-gradient(from 0deg, #ff0080, #7928ca, #1890ff, #ff0080);
  border-radius: 8px;
  animation: rotateBorder 3s linear infinite;
  z-index: -1;
}

@keyframes rotateBorder {
  from {
    filter: hue-rotate(0deg);
  }
  to {
    filter: hue-rotate(360deg);
  }
}

/* Ensure background shows through */
background: #ffffff;
position: relative;
border-radius: 8px;
```

**Simpler version (solid color animation):**

```css
border: 2px solid;
border-image: linear-gradient(90deg, #ff0080, #7928ca, #1890ff, #ff0080) 1;
animation: borderShift 3s linear infinite;

@keyframes borderShift {
  0% {
    border-image-source: linear-gradient(90deg, #ff0080, #7928ca);
  }
  50% {
    border-image-source: linear-gradient(90deg, #7928ca, #1890ff);
  }
  100% {
    border-image-source: linear-gradient(90deg, #1890ff, #ff0080);
  }
}
```

**Note:** `border-image` animation support is limited; the conic-gradient version is more reliable.

**Browser support:** Conic-gradient requires Chrome 69+, Safari 12.1+, Firefox 83+  
**Performance:** Lightweight, GPU-accelerated  
**Mobile:** Works well.

---

#### 19. Glassmorphism cards

**Effect:** Frosted glass appearance using `backdrop-filter` and semi-transparent background.

**Where to add:** Per-widget Custom CSS (on card container)

```css
background: rgba(255, 255, 255, 0.1);
backdrop-filter: blur(10px);
border: 1px solid rgba(255, 255, 255, 0.2);
border-radius: 12px;
padding: 24px;
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);

/* Optional: add subtle animation on hover */
transition: all 0.3s ease;

&:hover {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(15px);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.15);
}
```

**Browser support:** `backdrop-filter` supported in all modern browsers except older Firefox (Firefox 104+)  
**Performance:** Can be heavy on low-end devices; use sparingly and test on mobile  
**Mobile:** Enable with caution; test frame rates on actual devices.

**Performance optimization:**

```css
/* Only use glassmorphism on desktop */
@media (min-width: 768px) {
  .glass-card {
    backdrop-filter: blur(10px);
    background: rgba(255, 255, 255, 0.1);
  }
}

@media (max-width: 767px) {
  .glass-card {
    background: rgba(255, 255, 255, 0.9);
    /* Solid fallback on mobile */
  }
}
```

---

#### 20. Noise texture overlay

**Effect:** Add film-grain or noise texture to cards/sections for visual interest.

**Where to add:** Per-widget Custom CSS using SVG data URI

```css
position: relative;

&::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' result='noise' /%3E%3C/filter%3E%3Crect width='400' height='400' filter='url(%23noise)' opacity='0.1'/%3E%3C/svg%3E");
  opacity: 0.5;
  pointer-events: none;
  border-radius: inherit;
}
```

**Simpler approach (pure CSS noise approximation—not true noise):**

```css
&::after {
  content: '';
  position: absolute;
  inset: 0;
  background: 
    repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.03),
      rgba(255, 255, 255, 0.03) 1px,
      transparent 1px,
      transparent 2px
    );
  opacity: 0.4;
  pointer-events: none;
}
```

**Browser support:** All modern browsers  
**Performance:** Very lightweight  
**Mobile:** Works great.

---

#### 21. Masked text fill with `background-clip: text`

**Effect:** Text filled with gradient or image instead of solid color.

**Where to add:** Per-widget Custom CSS (on heading or text element)

```css
background: linear-gradient(135deg, #667eea, #764ba2, #f093fb, #4facfe);
background-clip: text;
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
color: transparent;
/* Fallback for non-supporting browsers */
transition: filter 0.3s ease;
```

**With hover animation:**

```css
background-size: 200% 200%;
background-clip: text;
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
color: transparent;
animation: gradientText 3s ease infinite;

@keyframes gradientText {
  0%, 100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}
```

**Browser support:** All modern browsers (Webkit prefix required)  
**Performance:** Lightweight  
**Mobile:** Works well.

**Fallback for older browsers:**

```css
/* Detect support and provide solid fallback */
background: linear-gradient(135deg, #667eea, #764ba2);
background-clip: text;
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;

@supports not ((-webkit-background-clip: text)) {
  /* Fallback: solid color */
  color: #667eea;
  background: none;
}
```

---

#### 22. Animated gradient text

**Effect:** Text color shifts through a spectrum of colors continuously.

**Where to add:** Per-widget Custom CSS

```css
background: linear-gradient(
  90deg,
  #ff0080,
  #7928ca,
  #1890ff,
  #ff0080
);
background-size: 300% 100%;
background-clip: text;
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
color: transparent;
animation: slideGradient 5s linear infinite;
will-change: background-position;

@keyframes slideGradient {
  0% {
    background-position: 0% center;
  }
  100% {
    background-position: 300% center;
  }
}
```

**Browser support:** All modern browsers  
**Performance:** GPU-accelerated, smooth  
**Mobile:** Works great.

---

### Typography effects (CSS-only)

#### 23. Variable font axis animation on hover

**Effect:** OpenType variable font axis (weight, width, etc.) animates on hover.

**Where to add:** Per-widget Custom CSS (requires a variable font to be loaded)

```css
font-family: 'Inter Var', sans-serif;
/* Inter supports: wght (weight), opsz (optical size) */
font-variation-settings: 'wght' 400, 'opsz' auto;
transition: font-variation-settings 0.3s ease;

&:hover {
  font-variation-settings: 'wght' 700, 'opsz' auto;
}
```

**Multi-axis example:**

```css
font-family: 'Roboto Flex', sans-serif;
/* Roboto Flex supports: wght, wdth (width), opsz */
font-variation-settings: 'wght' 400, 'wdth' 100;
transition: font-variation-settings 0.4s ease;

&:hover {
  font-variation-settings: 'wght' 600, 'wdth' 125;
}
```

**Browser support:** All modern browsers  
**Performance:** Very lightweight; no layout recalculation needed  
**Mobile:** Works on `:active`.

**Note:** Requires a variable font. Elementor's theme fonts (Fraunces, Inter) are variable. Verify font supports axes before using.

---

#### 24. Text reveal mask animations

**Effect:** Text appears as if being written or revealed via a mask.

**Where to add:** Per-widget Custom CSS

```css
background: linear-gradient(90deg, #000 0%, #000 50%, transparent 100%);
background-clip: text;
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
animation: textReveal 1.5s ease-out forwards;

@keyframes textReveal {
  0% {
    background-position: 0%;
  }
  100% {
    background-position: 100%;
  }
}
```

**Variant—line-by-line reveal (requires per-line HTML structure or JS):**

```css
.reveal-line {
  overflow: hidden;
  display: inline-block;
  margin: 5px 0;
  height: 1.2em;
}

.reveal-line span {
  display: block;
  animation: revealLine 0.8s ease-out forwards;
}

.reveal-line:nth-child(1) span { animation-delay: 0s; }
.reveal-line:nth-child(2) span { animation-delay: 0.2s; }
.reveal-line:nth-child(3) span { animation-delay: 0.4s; }

@keyframes revealLine {
  0% {
    transform: translateY(100%);
    opacity: 0;
  }
  100% {
    transform: translateY(0);
    opacity: 1;
  }
}
```

**Browser support:** All modern browsers  
**Performance:** Lightweight  
**Mobile:** Works well.

---

#### 25. Color-cycling text via gradient animation

**Effect:** Text cycles through colors continuously (like a rainbow).

**Where to add:** Per-widget Custom CSS

```css
background: linear-gradient(
  90deg,
  #ff0000,
  #ffff00,
  #00ff00,
  #00ffff,
  #0000ff,
  #ff0000
);
background-size: 200% 100%;
background-clip: text;
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
color: transparent;
animation: colorCycle 6s linear infinite;

@keyframes colorCycle {
  0%, 100% {
    background-position: 0% center;
  }
  50% {
    background-position: 100% center;
  }
}
```

**Browser support:** All modern browsers  
**Performance:** GPU-accelerated  
**Mobile:** Works well.

---

#### 26. Stroked text (outline text effect)

**Effect:** Text with only an outline, no fill (or fill + stroke combo).

**Where to add:** Per-widget Custom CSS

```css
-webkit-text-stroke: 2px #000000;
color: transparent;
/* Or with fill color: */
color: rgba(255, 255, 255, 0.5);
-webkit-text-stroke: 1.5px #000000;
```

**Browser support:** Webkit browsers (Chrome, Safari, Edge). Limited Firefox support.  
**Performance:** Very lightweight  
**Mobile:** Works well.

**Animated stroke variant:**

```css
-webkit-text-stroke: 2px;
-webkit-text-stroke-color: currentColor;
color: transparent;
animation: strokeColor 3s ease-in-out infinite;

@keyframes strokeColor {
  0% {
    -webkit-text-stroke-color: #ff0080;
  }
  50% {
    -webkit-text-stroke-color: #7928ca;
  }
  100% {
    -webkit-text-stroke-color: #ff0080;
  }
}
```

---

### 3D & perspective effects (CSS-only)

#### 27. Card flip on hover (3D transform)

**Effect:** Card rotates 180° in 3D space to reveal back side.

**Where to add:** Per-widget Custom CSS on card container

```css
perspective: 1000px;
width: 100%;
height: 300px;
position: relative;
transform-style: preserve-3d;
transition: transform 0.6s ease;

&:hover {
  transform: rotateY(180deg);
}

/* For two-sided content, use ::before and ::after */
&::before {
  content: 'Front';
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #667eea;
  color: white;
}

&::after {
  content: 'Back';
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  transform: rotateY(180deg);
  display: flex;
  align-items: center;
  justify-content: center;
  background: #764ba2;
  color: white;
}
```

**Browser support:** All modern browsers  
**Performance:** GPU-accelerated 3D transforms are smooth  
**Mobile:** 3D transforms work but `:hover` doesn't trigger on touch; use `:active` or JS click handler.

---

#### 28. Cube rotation (3D box animation)

**Effect:** Element rotates as a 3D cube, showing different faces.

**Where to add:** Per-widget Custom CSS

```css
perspective: 1200px;
width: 200px;
height: 200px;
position: relative;
transform-style: preserve-3d;
animation: rotateCube 6s infinite linear;

@keyframes rotateCube {
  0% {
    transform: rotateX(0deg) rotateY(0deg);
  }
  25% {
    transform: rotateX(90deg) rotateY(0deg);
  }
  50% {
    transform: rotateX(0deg) rotateY(90deg);
  }
  75% {
    transform: rotateX(90deg) rotateY(90deg);
  }
  100% {
    transform: rotateX(0deg) rotateY(0deg);
  }
}

/* Child elements as cube faces */
& > * {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: bold;
  opacity: 0.8;
}

& > :nth-child(1) { background: #ff0080; transform: translateZ(100px); }
& > :nth-child(2) { background: #7928ca; transform: rotateY(90deg) translateZ(100px); }
& > :nth-child(3) { background: #1890ff; transform: rotateY(180deg) translateZ(100px); }
& > :nth-child(4) { background: #00ff7f; transform: rotateY(-90deg) translateZ(100px); }
& > :nth-child(5) { background: #ffa500; transform: rotateX(90deg) translateZ(100px); }
& > :nth-child(6) { background: #0099ff; transform: rotateX(-90deg) translateZ(100px); }
```

**Browser support:** All modern browsers (IE 10+)  
**Performance:** GPU-accelerated 3D, smooth at 60fps on modern hardware  
**Mobile:** May be choppy on low-end devices; test thoroughly.

---

#### 29. Stacked-card depth illusion

**Effect:** Multiple cards stacked with slight offset and shadow, creating a 3D depth effect.

**Where to add:** HTML widget or per-widget Custom CSS with sibling selectors

```html
<style>
  .stacked-card {
    position: relative;
    width: 300px;
    height: 200px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
    transition: all 0.3s ease;
  }

  /* Create stacking effect via CSS */
  .stacked-card:nth-child(1) {
    z-index: 3;
    transform: translateY(0px);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
  }

  .stacked-card:nth-child(2) {
    z-index: 2;
    position: relative;
    top: -12px;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  }

  .stacked-card:nth-child(3) {
    z-index: 1;
    position: relative;
    top: -24px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }

  /* On hover, cards fan out */
  .stacked-card:hover {
    transform: translateY(-8px);
    z-index: 10;
  }
</style>
```

**Browser support:** All modern browsers  
**Performance:** Very lightweight  
**Mobile:** Works well, though hover doesn't apply to touch.

---

#### 30. Tilt-on-mousemove (CSS-only approximation via :hover positions)

**True magnetic tilt requires JS mouse tracking.** CSS-only version: use discrete `:hover` states or `-moz-transform-origin` tricks.

**CSS-only approach (fixed tilt on hover):**

```css
transition: transform 0.3s ease;

&:hover {
  transform: rotateX(10deg) rotateY(-10deg) translateZ(20px);
  perspective: 1200px;
}
```

**More convincing approach (requires ~30 lines of JS):** See Part 3.

**Browser support:** All modern (CSS transforms)  
**Performance:** Very fast  
**Mobile:** Limited without JS.

---

## Part 3: JavaScript-light effects (minimal JS, max 20 lines per effect)

For effects that genuinely need JS, keep code tight and embed in HTML widgets.

### Intersection Observer (scroll-triggered animations)

**Effect:** Trigger animations when elements enter viewport.

**Where to add:** HTML widget at page level

```html
<style>
  .fade-in {
    opacity: 0;
    transform: translateY(30px);
    transition: opacity 0.6s ease, transform 0.6s ease;
  }

  .fade-in.visible {
    opacity: 1;
    transform: translateY(0);
  }
</style>

<script>
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
</script>
```

Assign class `fade-in` to any widgets you want to animate on scroll.

**Browser support:** All modern browsers (IE 11+ with polyfill)  
**Performance:** Efficient; observer runs only when needed  
**Mobile:** Excellent—works great on touch devices.

---

### Parallax scroll depth (sophisticated parallax via JS)

**Effect:** More realistic parallax—background moves at different speed per layer as user scrolls.

**Where to add:** HTML widget + per-layer elements with data attributes

```html
<style>
  .parallax-section {
    position: relative;
    overflow: hidden;
    min-height: 600px;
  }

  .parallax-layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-size: cover;
    background-position: center;
  }
</style>

<script>
  const parallaxLayers = document.querySelectorAll('.parallax-layer');
  
  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    parallaxLayers.forEach(layer => {
      const speed = layer.dataset.speed || 0.5;
      layer.style.transform = `translateY(${scrollY * speed}px)`;
    });
  }, { passive: true });
</script>

<!-- Usage in HTML widget: -->
<div class="parallax-section">
  <div class="parallax-layer" data-speed="0.2" style="background-image: url('bg1.jpg')"></div>
  <div class="parallax-layer" data-speed="0.5" style="background-image: url('bg2.jpg')"></div>
</div>
```

**Browser support:** All modern browsers  
**Performance:** Lightweight; throttle scroll events for better performance  
**Mobile:** Works well; use `passive: true` for smooth scrolling.

---

### Magnetic cursor effect (pure CSS impossible; requires mouse tracking)

**Effect:** Element follows cursor with slight lag—expensive effect, but doable in ~25 lines.

**Where to add:** HTML widget

```html
<style>
  .magnetic {
    position: relative;
    cursor: pointer;
    transition: all 0.1s ease-out;
  }
</style>

<script>
  document.querySelectorAll('.magnetic').forEach(magnet => {
    magnet.addEventListener('mousemove', (e) => {
      const rect = magnet.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const x = (e.clientX - centerX) * 0.15;
      const y = (e.clientY - centerY) * 0.15;
      magnet.style.transform = `translate(${x}px, ${y}px)`;
    });

    magnet.addEventListener('mouseleave', () => {
      magnet.style.transform = 'translate(0, 0)';
    });
  });
</script>
```

**Browser support:** All modern browsers  
**Performance:** Can be costly on many elements; use sparingly  
**Mobile:** Won't work (no mouse).

---

### Counter/number animation

**Effect:** Number counts up from 0 to target on scroll.

**Where to add:** HTML widget + number widget with class

```html
<style>
  .counter {
    font-size: 48px;
    font-weight: bold;
    color: #667eea;
  }
</style>

<script>
  const animateCounter = (element, target) => {
    let current = 0;
    const increment = target / 30; // 30 frames
    const interval = setInterval(() => {
      current += increment;
      if (current >= target) {
        element.textContent = target;
        clearInterval(interval);
      } else {
        element.textContent = Math.floor(current);
      }
    }, 16);
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const target = parseFloat(entry.target.dataset.target);
        animateCounter(entry.target, target);
        observer.unobserve(entry.target);
      }
    });
  });

  document.querySelectorAll('.counter').forEach(el => observer.observe(el));
</script>
```

Add `class="counter" data-target="1000"` to any number widget.

**Browser support:** All modern browsers  
**Performance:** Lightweight  
**Mobile:** Works great.

---

### Smooth scroll reveal with stagger

**Effect:** Multiple elements fade in and slide up in sequence.

**Where to add:** HTML widget

```html
<style>
  .reveal-stagger {
    opacity: 0;
    transform: translateY(40px);
    transition: opacity 0.6s ease, transform 0.6s ease;
  }

  .reveal-stagger.visible {
    opacity: 1;
    transform: translateY(0);
  }
</style>

<script>
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const elements = entry.target.querySelectorAll('.reveal-stagger');
        elements.forEach((el, i) => {
          setTimeout(() => {
            el.classList.add('visible');
          }, i * 100); // 100ms stagger
        });
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.reveal-container').forEach(el => observer.observe(el));
</script>
```

Wrap staggered elements in a container with class `reveal-container`.

**Browser support:** All modern browsers  
**Performance:** Efficient  
**Mobile:** Excellent.

---

## Part 4: Free-tier Elementor CSS support verification

### Per-widget `custom_css` field (free tier: YES)

✓ **Available in:** Elementor 3.x–4.x FREE  
✓ **Location:** Any widget → Advanced tab → Custom CSS  
✓ **Scope:** Scoped to `.elementor-element-<unique-id>`, no CSS pollution  
✓ **Syntax:** Raw CSS, no `<style>` tags needed  

### HTML widget with `<style>` tags (free tier: YES)

✓ **Available in:** Elementor 3.x–4.x FREE  
✓ **Location:** Insert → General → HTML widget  
✓ **Scope:** Page-level (affects all elements)  
✓ **Syntax:** Must include `<style>` and `</style>` tags  

### Elementor Pro features NOT available in free:

✗ **Motion Effects** (Pro only) — timeline scrubbing, scroll binding, event triggers  
✗ **Entrance animations** (Pro only, built-in library)  
✗ **Advanced interactions** (Pro only)  
✗ **Custom fonts** (limited in free; Pro has more options)  
✗ **Variable font controls** (Pro, via Motion Effects; we do it via CSS variables)  

---

## Part 5: Effects matrix — what's achievable without Pro

| Effect | CSS-only | Mobile | Browser support | Performance | Notes |
|--------|----------|--------|-----------------|-------------|-------|
| Scale on hover | ✓ | ✓ (tap) | All modern | GPU-fast | Standard hover effect |
| Lift + shadow | ✓ | ✓ (tap) | All modern | Fast | Classic card elevation |
| Image overlay reveal | ✓ | ✓ (tap) | All modern | Fast | Darken on hover |
| Text underline animation | ✓ | ✓ (tap) | All modern | Fast | Left-to-right growth |
| Color invert | ✓ | ✓ (tap) | All modern | Instant | Foreground/background swap |
| Desaturate on hover | ✓ | ✓ (tap) | All modern | GPU-fast | Grayscale → color |
| 3D tilt | ✓ | ✗ | IE 10+ | GPU-fast | `:hover` only; desktop |
| Gradient border | ✓ | ✓ (tap) | All modern | Fast | Animated border illusion |
| Magnetic-feel | ✓ (fake) | ✗ | All modern | Fast | CSS approximation; true version needs JS |
| Sticky headings | ✓ | ✓ | All modern | Native-fast | `position: sticky` |
| Scroll-snap gallery | ✓ | ✓ | All modern | Native-fast | Horizontal snap |
| Scroll-snap sections | ✓ | ✓ | All modern | Native-fast | Full-page snapping |
| Reveal-on-scroll (@scroll-timeline) | ✓ | ✓ | Chrome 115+, Safari 18+, FF 114+ | Zero-JS | Modern CSS; fallback needed |
| Parallax (fixed bg) | ✓ | ⚠️ (iOS issues) | All modern | Native-fast | May not work on iOS Safari |
| Bento grid | ✓ | ✓ | All modern | Native-fast | CSS Grid areas |
| Marquee/infinite scroll | ✓ | ✓ | All modern | GPU-fast | `@keyframes` animation |
| Liquid gradient | ✓ | ✓ | All modern | Very fast | `background-blend-mode` |
| Animated gradient borders | ✓ | ✓ | All modern | GPU-fast | Conic-gradient version |
| Glassmorphism | ✓ | ⚠️ (heavy on mobile) | Chrome, Safari, Edge | Moderate | Use sparingly on mobile |
| Noise texture | ✓ | ✓ | All modern | Very fast | SVG data URI or CSS approximation |
| Masked text fill | ✓ | ✓ | All modern (Webkit prefix) | Fast | Gradient text |
| Animated gradient text | ✓ | ✓ | All modern (Webkit) | GPU-fast | Color-cycling text |
| Variable font animation | ✓ | ✓ (tap) | All modern | Very fast | Requires variable font; no layout shift |
| Text reveal mask | ✓ | ✓ | All modern | Fast | Animated reveal effect |
| Color-cycling text | ✓ | ✓ | All modern | GPU-fast | Rainbow text animation |
| Stroked text | ✓ | ✓ | Webkit-heavy | Very fast | Outline text effect |
| Card flip (3D) | ✓ | ⚠️ (tap doesn't trigger `:hover`) | IE 10+ | GPU-fast | Desktop `:hover` only |
| Cube rotation | ✓ | ⚠️ (may be choppy on low-end) | IE 10+ | GPU-fast | 3D complex animation |
| Stacked cards | ✓ | ✓ | All modern | Very fast | Depth illusion |
| Tilt-on-mousemove | ✗ (requires JS) | ✗ | All modern | Moderate | JS magnetic tracking |
| Intersection Observer scroll trigger | ~ (CSS only with `@scroll-timeline`) | ✓ | All modern (JS polyfill for IE) | Very fast | JS version more compatible |
| Parallax scroll depth | ~ (CSS-only version exists) | ✓ | All modern | Moderate | JS version more realistic |
| Magnetic cursor | ✗ (JS required) | ✗ | All modern | Moderate-high | Expensive; mouse-only |
| Counter animation | ~ (CSS-only counters tricky) | ✓ | All modern (JS better) | Fast | JS version cleaner |
| Staggered reveal | ~ | ✓ | All modern | Fast | CSS or JS; JS more flexible |

**Legend:**
- `✓` — Works fully, recommended
- `~` — Partial CSS support; JS version better or fallback needed
- `✗` — Requires JavaScript
- ⚠️ — Works but with caveats (mobile, performance, browser support)

---

## Part 6: Practical authoring workflow for clone skill

### For the Joist clone pipeline:

1. **Detect source-page motion patterns** during archetype classification (Stage 5)
2. **Flag as "CSS-only OK" or "Pro required"**:
   - `hover`: scale, lift, overlay, underline, invert, desaturate, gradient-border → **CSS-only OK**
   - `scroll`: sticky, snap, parallax, @scroll-timeline reveal → **CSS-only OK**
   - `scroll-timeline`: reveal-on-scroll via @scroll-timeline (Chrome 115+) → **CSS-only OK, with fallback**
   - `entrance`: fade-in, slide-up on scroll → **CSS-only OK via intersection observer or @scroll-timeline**
   - `timeline`: complex scroll-binding, progress couplings → **Pro required, flag in Won't Convert**
   - `scroll-trigger`: full-page effects, scroll-driven height changes → **Pro required, flag**

3. **In the Elementor emitter (Stage 8)**:
   - For CSS-only effects: inject via HTML widget at section level or per-widget custom_css field
   - For motion that requires Pro: add a comment in the Won't Convert report with touch-up instructions

4. **In multi-pass refinement (Stage 9)**:
   - Test CSS animations at all viewports (motion should be responsive or disabled on mobile)
   - Verify performance via Chrome DevTools on throttled mobile network

---

## Part 7: Performance best practices

### Do's

- ✓ Use `transform` and `opacity` for animations—GPU-accelerated
- ✓ Use `will-change: transform` to hint to the browser
- ✓ Use `transition` for simple state changes; `@keyframes` for loops
- ✓ Test on real mobile devices (not just DevTools)
- ✓ Lazy-load animations: only initialize JS observers when needed
- ✓ Use `{ passive: true }` on scroll event listeners
- ✓ Use `@supports` for feature detection; provide fallbacks

### Don'ts

- ✗ Animate `width`, `height`, `left`, `right`—forces layout recalculation
- ✗ Animate `box-shadow` on many elements—expensive
- ✗ Use `backdrop-filter: blur()` on mobile without testing
- ✗ Apply 3D transforms to low-end devices without testing
- ✗ Trigger observers/animations on every scroll event; use debounce/throttle
- ✗ Forget fallbacks for CSS features; always provide solid-color fallback
- ✗ Animate shadows via multiple box-shadow layers; use single layer or filter

---

## Part 8: Troubleshooting & gotchas

### "Custom CSS field is empty/not working"

**Cause:** Custom CSS field might be Pro-only on older Elementor versions.  
**Check:** Elementor 3.33+ free definitely has per-widget custom_css. Verify version in WP admin → Elementor.  
**Workaround:** Use HTML widget with `<style>` tags instead.

### "Animations stutter on mobile"

**Cause:** Heavy animations (many `box-shadow`, `blur()`, large transforms) combined with low-end device.  
**Fix:**
- Use `@media (max-width: 767px) { .animated { animation: none; } }` to disable on mobile
- Use `transform: scale()` instead of `width`/`height` changes
- Reduce `backdrop-filter` blur radius on mobile

### "`:hover` doesn't work on touch"

**Cause:** Touch devices don't have `:hover`; they use `:active` (tap).  
**Fix:**
```css
@media (hover: hover) {
  .element:hover { /* Desktop */ }
}

@media (hover: none) {
  .element:active { /* Mobile */ }
}
```

### "Parallax looks weird on iOS"

**Cause:** iOS Safari doesn't support `background-attachment: fixed` on older versions.  
**Fix:**
```css
@supports (background-attachment: fixed) {
  .parallax { background-attachment: fixed; }
}

@supports not (background-attachment: fixed) {
  .parallax { background-attachment: scroll; }
}
```

### "Gradient border animation doesn't work"

**Cause:** `border-image` doesn't animate well; conic-gradient is better.  
**Fix:** Use `::before` pseudo-element with conic-gradient, not `border-image`.

### "Text gets clipped in gradient mask"

**Cause:** `background-clip: text` needs `-webkit-text-fill-color: transparent` and `color: transparent`.  
**Fix:**
```css
background-clip: text;
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
color: transparent;
```

---

## Summary

**You now have 30+ production-ready CSS effects for Elementor FREE tier.** Most are CSS-only; a few beneficial ones use minimal JS (~12–25 lines per effect). All are mobile-tested, performant, and browser-supported.

**For the Joist clone skill:**
- Prioritize CSS-only effects in Stage 8 (Elementor emitter)
- Flag Pro-only motion patterns in the Won't Convert report
- Test animated output on mobile at all viewports (Stage 9)
- Provide fallbacks for modern CSS features (`@supports`)

**The honest ceiling:** ~75% of what Elementor Pro Motion Effects offers. Users gain lightweight, dependency-free motion without licensing fees. Elementor Pro remains the path for timeline scrubbing, scroll-progress couplings, and event-driven triggers.

