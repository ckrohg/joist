# Effect Recognition & Detection Playbook

**Purpose:** Diagnostic procedures for AI agents to identify motion, 3D, and interaction effects in source URLs before cloning. Enables honest assessment of what can be reproduced in Elementor at different authoring tiers.

**Date:** 2026-05-31  
**Audience:** Joist clone-pipeline planners, vision-grading systems, design agents  
**Status:** Foundational reference for Joist v0.9+ effect-grading harness

---

## The Problem This Solves

Joist's clone skill currently grades by **visual pixel comparison only**. For a motion-heavy site:

- Screenshot comparison shows "looks similar" ✓
- But the source has parallax, scroll-triggered reveals, 3D transforms, smooth-scroll, hover transitions
- Clone is static
- Grader gave it a 7/10 because it doesn't know what motion existed to score

This playbook fixes that gap. An AI agent cloning the site will **know what effects exist** before deciding how (or whether) to reproduce them.

---

## Part 1: Effect Classes & Detection Signals

### 1.1 Smooth Scroll / Scroll Hijacking

**What it is:**  
Custom scroll behavior replacing the native OS scroll (e.g., Lenis, SmoothScroll.js, or GSAP ScrollSmoother). Page scrolls with momentum easing, longer scroll-distance, or interpolated y-position. Often perceived as buttery/luxe.

#### Detection signals in static HTML

- Script imports: `lenis.min.js`, `locomotive-scroll`, `smooth-scroll`, `SmoothScroll`, `@studio-freight/lenis`
- CSS class names: `.smooth-scroll-active`, `.lenis`, `.locomotive-scroll`, `.smooth-scroll-wrapper`
- Data attributes: `data-scroll`, `data-scroll-speed`, `data-scroll-direction`

**Grep pattern:**
```bash
grep -i "lenis\|locomotive\|smoothscroll\|smooth.scroll\|@studio-freight" <html>
grep "data-scroll" <html>
```

#### Detection signals via Playwright (computed styles)

```javascript
// Check for scroll-behavior (standard CSS)
const scrollBehavior = window.getComputedStyle(document.documentElement).scrollBehavior;
// "auto" = native, "smooth" = CSS-only (trivial)
// If custom scroll lib, scrollBehavior will be "auto" but actual scroll is hijacked

// Check for scroll-related event listeners (rough signal)
// Run in DevTools: getEventListeners(window).scroll
// If multiple listeners and page feels smooth → likely custom scroll lib

// Inspect the scroll element
const scrollContainer = document.querySelector('[data-scroll-container], .lenis, .smooth-scroll');
if (scrollContainer) return 'smooth_scroll_detected: HIGH_CONFIDENCE';
```

#### Detection signals via DOM observation (runtime)

1. **Scroll event frequency:** Sample scroll events over 2 seconds of user scroll; if > 30 events/sec → browser-native. If < 10 events/sec with smooth visual motion → hijacked scroll.
2. **Window.scrollY vs element position delta:** During a scroll gesture, measure `window.scrollY` vs the visual position of a pinned header. If they diverge → scroll hijacking.
3. **Scroll velocity persistence:** Scroll to bottom quickly, release. In native scroll, momentum decelerates over ~1s. If scrolling continues smoothly for >2s → custom easing (Lenis pattern).

#### Detection via screenshot diff

1. Capture top-of-page screenshot (at `scrollY = 0`)
2. Scroll to middle (`scrollY = 500`) → capture
3. Scroll to bottom (`scrollY = max`) → capture
4. If the scroll felt unnaturally smooth (long tweens) relative to distance → smooth-scroll lib active

#### Authoring tier mapping

| Tier | Capability |
|------|-----------|
| V3 free | ❌ No — would need custom JS embed |
| V3 + custom JS | ✓ Can embed Lenis or similar via HTML widget |
| V3 + Pro | ✓ Pro Motion Effects can approximate with scroll triggers |
| Out of reach | ❌ Only if the effect is load-bearing (UX broken without it) |

**User message template:**
> Detected: Smooth scroll hijacking (Lenis library). Contributes ~15% to perceived polish. Can replicate with ~70% fidelity by embedding Lenis in an HTML widget, or accept native scroll (looks 85% as good). Recommend: embed Lenis for matching vibe.

---

### 1.2 Scroll-Triggered Reveals (AOS, Intersection Observer)

**What it is:**  
Elements fade in, slide in, scale up as they enter the viewport during scroll. Libraries: AOS (Animate On Scroll), GSAP ScrollTrigger, Framer Motion, vanilla Intersection Observer.

#### Detection signals in static HTML

- Script imports: `aos.min.js`, `gsap.min.js`, `gsap/ScrollTrigger`, `animate.style`, `motion`, `framer-motion`
- CSS classes: `.aos-init`, `.aos-animate`, `.aos-fade-up`, `.aos-fade-left`, `[data-aos]`, `.gsap-*`
- Data attributes: `data-aos`, `data-aos-duration`, `data-aos-delay`, `data-aos-offset`, `data-aos-easing`

**Grep pattern:**
```bash
grep -E "aos\.min\.js|gsap|ScrollTrigger|animate\.style|data-aos=" <html>
grep -oE 'data-aos="[^"]*"' <html> | sort -u
```

#### Detection signals via Playwright (computed styles)

```javascript
// 1. Check for AOS library presence
if (window.AOS) return 'aos_detected: HIGH_CONFIDENCE';
if (window.gsap?.registerPlugin) return 'gsap_scrolltrigger: HIGH_CONFIDENCE';

// 2. Scan for classes added during scroll
const initialClasses = new Set();
document.querySelectorAll('[data-aos]').forEach(el => {
  initialClasses.add(el.className);
});

// Scroll and re-scan
window.scrollBy(0, 200);
setTimeout(() => {
  const updatedClasses = new Set();
  document.querySelectorAll('[data-aos]').forEach(el => {
    updatedClasses.add(el.className);
  });
  // If class additions match .aos-animate or .is-visible → scroll-triggered reveal
}, 300);

// 3. Check for Intersection Observer (vanilla implementation)
// Can't directly detect, but if data-aos attributes exist without AOS library → likely observer
```

#### Detection signals via DOM observation (runtime)

1. **Class mutation on scroll:** Monitor a div with `data-aos` attribute. Scroll it into view. If `.aos-animate` or similar class is added → scroll-triggered.
2. **opacity/transform mutations:** Use `MutationObserver` to watch for style changes during scroll. If `opacity` changes from `0` to `1` as element enters viewport → fade-in reveal.
3. **Staggered timing:** Scroll slowly past multiple elements with `data-aos`. If each reveals at slightly different times → stagger delay (typical AOS behavior).

#### Detection via screenshot diff

1. Capture screenshot with all content off-screen (`scrollY = 0`)
2. Scroll to middle → capture (elements should now be visible and animated-in)
3. If images/text appear brighter, larger, or different opacity in the second screenshot (relative to first) → scroll-triggered animation

#### Authoring tier mapping

| Tier | Capability |
|------|-----------|
| V3 free | ❌ No native support |
| V3 + custom CSS | ✓ Partial — can author `animation: slideIn 0.6s ease-out;` on all elements at once, but loses per-element delay |
| V3 + custom JS | ✓ Full — embed AOS or Intersection Observer |
| Pro Motion Effects | ✓ Full — native scroll triggers per element |
| Pro + custom code | ✓ Full + advanced timing |

**User message template:**
> Detected: Scroll-triggered reveals (AOS library with per-element stagger). Contributes ~20% visual appeal. Authoring options:
> - **Recommended:** Upgrade to Elementor Pro + enable Motion Effects. Native scroll triggers achieve 95% fidelity.
> - **Good:** Embed AOS library via HTML widget. Achieves ~85% fidelity.
> - **Free tier:** Static page (no reveals). Achieves ~60% fidelity.

---

### 1.3 Parallax Scroll & Depth Layers

**What it is:**  
Background elements move at a different rate than foreground during scroll, creating perceived depth. May use CSS `background-attachment: fixed`, GSAP ScrollTrigger with `y: gsap.utils.unitize(i => i * 100)`, or CSS scroll-driven animations.

#### Detection signals in static HTML

- CSS properties: `background-attachment:fixed`, `will-change:transform`, `perspective`, `transform-style:preserve-3d`
- Script imports: `gsap`, `ScrollTrigger`
- Classes: `.parallax`, `.depth-layer`, `.bg-fixed`
- Data attributes: `data-parallax`, `data-scroll-speed`, `data-scroll-offset`

**Grep pattern:**
```bash
grep -E "background-attachment:\s*fixed|parallax|data-scroll-speed|transform.*perspective" <css_text>
grep "gsap\|ScrollTrigger" <html>
```

#### Detection signals via Playwright (computed styles)

```javascript
// 1. Check for background-attachment: fixed
const elements = document.querySelectorAll('*');
for (const el of elements) {
  const bgAttach = window.getComputedStyle(el).backgroundAttachment;
  if (bgAttach === 'fixed') {
    console.log(`Parallax via background-attachment: ${el.className}`);
  }
}

// 2. Check for 3D transforms
for (const el of elements) {
  const transform = window.getComputedStyle(el).transform;
  if (transform.includes('matrix3d') || transform.includes('perspective')) {
    console.log(`3D transform detected: ${el.className}`);
  }
}

// 3. Check for will-change: transform (strong signal)
for (const el of elements) {
  const willChange = window.getComputedStyle(el).willChange;
  if (willChange === 'transform') {
    console.log(`Parallax candidate (will-change): ${el.className}`);
  }
}
```

#### Detection signals via DOM observation (runtime)

1. **Transform changes on scroll:** Monitor `.parallax` element. At scrollY=0, measure `element.getBoundingClientRect().top`. Scroll 200px. Re-measure top. If the delta is smaller than the scroll amount → element moved slower → parallax.
2. **Sampled scroll positions:** Capture screenshot at scrollY={0, 200, 400, 600}. Identify a background element (e.g., hero image). Measure its vertical pixel position in each screenshot. If position changes but doesn't scroll fully → parallax active.

#### Detection via screenshot diff

1. Top of page (scrollY=0) → capture
2. Scroll to hero bottom (e.g., scrollY=300) → capture
3. Measure the relative position of the hero background image in both screenshots
4. If the image appears to have moved less than 300px → parallax

#### Authoring tier mapping

| Tier | Capability |
|------|-----------|
| V3 free | ✓ Background-attachment: fixed (60% fidelity) |
| V3 + custom CSS | ✓ Custom scroll-driven CSS (75% fidelity) — requires `scroll-timeline` support check |
| V3 + custom JS | ✓ GSAP ScrollTrigger embed (95% fidelity) |
| Pro Motion Effects | ✓ Native parallax effect (90% fidelity, limited) |
| Pro + custom code | ✓ Full (99% fidelity) |

**User message template:**
> Detected: Parallax scroll effect (GSAP ScrollTrigger, 40px offset per 100px scroll). Contributes ~25% to hero appeal.
> - **Best:** Pro Motion Effects native parallax + GSAP embed: 95% fidelity.
> - **Good:** CSS background-attachment: fixed: 65% fidelity (less nuanced).
> - **Free:** Static background: 40% fidelity.

---

### 1.4 Hover Interactions & Transitions

**What it is:**  
Elements change color, scale, rotate, or slide when cursor hovers over them. CSS transitions, animations, or JavaScript event handlers.

#### Detection signals in static HTML

- CSS properties in `<style>`: `:hover { ... }`, `transition: all 0.3s ease`, `transition-duration`, `@keyframes`
- Classes: `.hover-*`, `.transition-*`
- Data attributes: `data-hover`, `data-animate-on-hover`

**Grep pattern:**
```bash
grep -E ":hover\s*\{|transition:|@keyframes" <style_tag>
grep -E "onmouseover|onmouseout|@hover|:hover" <html>
```

#### Detection signals via Playwright (computed styles)

```javascript
// 1. Scan for transition properties on interactive elements
const interactives = document.querySelectorAll('button, a, [role="button"]');
for (const el of interactives) {
  const transition = window.getComputedStyle(el).transition;
  if (transition && transition !== 'none') {
    console.log(`Hover transition: ${el.className} → ${transition}`);
  }
}

// 2. Check for :hover styles in stylesheets
const stylesheets = Array.from(document.styleSheets);
for (const sheet of stylesheets) {
  try {
    const rules = sheet.cssRules || [];
    for (const rule of rules) {
      if (rule.selectorText?.includes(':hover')) {
        console.log(`Hover rule found: ${rule.selectorText}`);
      }
    }
  } catch (e) {
    // CORS or cross-origin may block access
  }
}

// 3. Check for animation keyframes
const computedStyle = window.getComputedStyle(document.body);
const animationName = computedStyle.animationName;
if (animationName && animationName !== 'none') {
  console.log(`Animation active: ${animationName}`);
}
```

#### Detection signals via DOM observation (runtime)

1. **Hover state capture:** Position cursor over a button → capture computed styles. Move away → re-capture. Compare properties like `backgroundColor`, `transform`, `opacity`.
2. **CSS class mutation on hover:** Add a `MutationObserver` to watch for class changes on hover targets. Hover over element. If new classes added → hover state mutation.
3. **Transition duration measurement:** During a hover, measure the time from cursor-in to visual change. If >0ms and <1s, consistent across hovers → CSS transition active.

#### Detection via screenshot diff

1. Screenshot with cursor at neutral position (not hovering)
2. Position cursor over a button → screenshot
3. Compare button appearance (color, size, brightness)
4. If different → hover styling active

#### Authoring tier mapping

| Tier | Capability |
|------|-----------|
| V3 free | ✓ Button hover_color + basic state (70%) |
| V3 + custom CSS | ✓ Custom :hover styles (90%) |
| Pro | ✓ Same + hover animations (95%) |
| HTML widget | ✓ Full JS control (100%) |

**User message template:**
> Detected: Button hover effects (color shift + slight scale). Elementor V3 supports this natively via button widget `hover_color` setting. Contribution: ~5% polish. Fidelity: 95% native.

---

### 1.5 3D Transforms & Perspective

**What it is:**  
Elements use CSS 3D transforms (`rotateX`, `rotateY`, `perspective`), creating depth rotations or tilts. Often used on cards, images, or hero elements.

#### Detection signals in static HTML

- CSS properties: `perspective`, `transform-style:preserve-3d`, `rotateX(`, `rotateY(`, `rotateZ(`, `translateZ(`
- Libraries: `vanilla-tilt.min.js`, `tilt.js` (parallax tilt on hover)
- Classes: `.3d-*`, `.tilt`, `.perspective`
- Data attributes: `data-tilt`, `data-tilt-scale`, `data-tilt-speed`

**Grep pattern:**
```bash
grep -E "perspective|preserve-3d|rotateX|rotateY|translateZ|vanilla-tilt" <html_and_css>
grep "data-tilt" <html>
```

#### Detection signals via Playwright (computed styles)

```javascript
// 1. Check for perspective
const elements = document.querySelectorAll('*');
for (const el of elements) {
  const perspective = window.getComputedStyle(el).perspective;
  if (perspective && perspective !== 'none') {
    console.log(`Perspective element: ${el.className} → ${perspective}`);
  }
}

// 2. Check for 3D transforms
for (const el of elements) {
  const transform = window.getComputedStyle(el).transform;
  const matrix3d = 'matrix3d(' in transform;
  if (matrix3d || transform.match(/rotate[XYZ]/)) {
    console.log(`3D transform: ${el.className} → ${transform.substring(0, 50)}...`);
  }
}

// 3. Check for transform-style: preserve-3d
for (const el of elements) {
  const ts = window.getComputedStyle(el).transformStyle;
  if (ts === 'preserve-3d') {
    console.log(`Preserve-3d child: ${el.className}`);
  }
}

// 4. Detect vanilla-tilt library
if (window.VanillaTilt) {
  console.log('Vanilla-tilt library active');
  // Find all tiltable elements
  document.querySelectorAll('[data-tilt]').forEach(el => {
    console.log(`Tilt element: ${el.className}, scale: ${el.dataset.tiltScale || 'default'}`);
  });
}
```

#### Detection signals via DOM observation (runtime)

1. **Mouse position tracking:** Move cursor over a card/image marked `[data-tilt]`. If the element's `transform` changes in sync with cursor position (not just hover state) → 3D tilt active.
2. **Perspective transform sampling:** Capture `element.getBoundingClientRect()` as cursor moves across the element. Measure the `width` and `height` deltas. If they vary non-linearly (perspective projection) → 3D perspective.

#### Detection via screenshot diff

1. Screenshot of card at cursor neutral position
2. Move cursor to top-left of card → screenshot
3. Move cursor to bottom-right → screenshot
4. If the card appears tilted differently in each → 3D tilt effect

#### Authoring tier mapping

| Tier | Capability |
|------|-----------|
| V3 free | ❌ No native 3D transforms |
| V3 + custom CSS | ✓ Static 3D transforms (e.g., rotateY on initial load) — 60% |
| V3 + custom JS | ✓ Full vanilla-tilt or GSAP 3D (95%) |
| Pro Motion Effects | ✓ Limited 3D effects (70%) |

**User message template:**
> Detected: 3D tilt effect (vanilla-tilt library, triggered on hover). Contributes ~10% to card interactivity.
> - **Best:** Embed vanilla-tilt via HTML widget: 95% fidelity.
> - **Good:** Static rotateY CSS on initial load (no hover tracking): 50% fidelity.
> - **Free:** Flat cards: 20% fidelity.

---

### 1.6 Lottie Animations & SVG Motion

**What it is:**  
Lightweight JSON-based animations (Lottie), or hand-crafted SVG animations with `<animate>` or `<animateMotion>` elements.

#### Detection signals in static HTML

- Script imports: `lottie.min.js`, `lottie-web`, `lottie-react`
- SVG elements: `<animate>`, `<animateMotion>`, `<animateTransform>`
- Data attributes: `data-lottie`, `data-animation-path`, `data-lottie-direction`, `data-lottie-speed`
- Iframe embeds from `lottie.host` or Rive (`rive.app`)

**Grep pattern:**
```bash
grep -E "lottie|rive.app|<animate|<animateMotion" <html>
grep "data-lottie" <html>
```

#### Detection signals via Playwright (computed styles)

```javascript
// 1. Check for Lottie library
if (window.lottie) {
  console.log('Lottie library active');
  // Lottie doesn't expose registered animations easily, but we can detect from DOM
}

// 2. Find SVG animations
const svgs = document.querySelectorAll('svg');
for (const svg of svgs) {
  const animates = svg.querySelectorAll('animate, animateMotion, animateTransform');
  if (animates.length > 0) {
    console.log(`SVG animations found: ${animates.length} animations in ${svg.className}`);
    for (const anim of animates) {
      console.log(`  - ${anim.tagName}: attributeName=${anim.getAttribute('attributeName')}, dur=${anim.getAttribute('dur')}`);
    }
  }
}

// 3. Check for Rive animations
if (window.rive) {
  console.log('Rive animation runtime active');
}

// 4. Detect lottie-web via container class
const lotties = document.querySelectorAll('[data-lottie], .lottie-container, [class*="lottie"]');
console.log(`Potential Lottie containers: ${lotties.length}`);
```

#### Detection signals via DOM observation (runtime)

1. **Canvas mutation detection:** Lottie renders to `<canvas>` or `<svg>`. Monitor for animation frames (via `requestAnimationFrame` hooking or visual diff of canvas contents).
2. **SVG path mutations:** Watch for `<animate>` elements executing. Measure the `offset` attribute of an animated path over time.

#### Detection via screenshot diff

1. Screenshot at T=0 (page load)
2. Wait 500ms → screenshot at T=0.5s
3. Wait 1000ms more → screenshot at T=1.5s
4. If SVG/canvas content changed between screenshots → animation active

#### Authoring tier mapping

| Tier | Capability |
|------|-----------|
| V3 free | ❌ No native Lottie support |
| V3 + custom HTML | ✓ Embed Lottie via HTML widget (95%) |
| Pro | ✓ Limited via custom code (90%) |
| Lottie widget (3rd-party) | ✓ Full native (100%) |

**User message template:**
> Detected: Lottie animation (looping checkmark, 2s loop). Can be embedded as static HTML widget or via Lottie 3rd-party widget if available. Contributes ~8% to visual interest. Fidelity: 95% via embed.

---

### 1.7 Sticky / Pinned Navigation & Scroll Snapping

**What it is:**  
Header stays at top during scroll (`position: sticky`), or page locks to section boundaries during scroll (`scroll-snap-type`).

#### Detection signals in static HTML

- CSS properties: `position:sticky`, `position:fixed`, `top:0`, `scroll-snap-type:mandatory`, `scroll-snap-align:start`
- Classes: `.sticky`, `.sticky-header`, `.pinned`, `.scroll-snap-*`

**Grep pattern:**
```bash
grep -E "position:\s*sticky|position:\s*fixed|scroll-snap" <css_text>
```

#### Detection signals via Playwright (computed styles)

```javascript
// 1. Find sticky elements
const stickies = document.querySelectorAll('[style*="position"]');
for (const el of stickies) {
  const pos = window.getComputedStyle(el).position;
  const top = window.getComputedStyle(el).top;
  if (pos === 'sticky' || pos === 'fixed') {
    console.log(`Sticky/fixed element: ${el.className} (position=${pos}, top=${top})`);
  }
}

// 2. Check for scroll-snap
const scrollers = document.querySelectorAll('[style*="scroll-snap"]');
for (const el of scrollers) {
  const snapType = window.getComputedStyle(el).scrollSnapType;
  if (snapType && snapType !== 'none') {
    console.log(`Scroll-snap container: ${el.className} → ${snapType}`);
  }
}
```

#### Detection signals via DOM observation (runtime)

1. **Sticky offset measurement:** During scroll, measure a sticky header's `getBoundingClientRect().top`. If it remains constant (e.g., always 0 or 64px) despite scrolling → sticky active.
2. **Scroll-snap lock detection:** Scroll by small increments (e.g., 10px at a time). If the page snaps back to section boundaries → scroll-snap.

#### Detection via screenshot diff

1. Top of page → capture
2. Scroll 50% down → capture
3. If the header/nav is in the same vertical position in both → sticky active

#### Authoring tier mapping

| Tier | Capability |
|------|-----------|
| V3 free | ✓ Sticky positioning via CSS (100%) |
| V3 + custom CSS | ✓ Sticky + enhanced styling (100%) |
| Scroll-snap | ⚠️ CSS standard, but browser support varies — 85% |

**User message template:**
> Detected: Sticky navigation header (position: sticky, top: 0). Elementor native support: full. Fidelity: 100%.

---

### 1.8 Text Animations (Type-effects, Splitting, Shuffling)

**What it is:**  
Text animates character-by-character, word-by-word, or line-by-line (via SplitType, Anime.js, Framer Motion). Words fade in, slide in, or appear in sequence.

#### Detection signals in static HTML

- Script imports: `split-type.min.js`, `anime.min.js`, `mo.js`, `charming.js`
- Classes: `.split-*`, `.char`, `.word`, `.line`, `.animated-text`
- Data attributes: `data-split-text`, `data-animation-type`

**Grep pattern:**
```bash
grep -E "split-type|anime\.js|charming|mo\.js" <html>
grep "data-split" <html>
```

#### Detection signals via Playwright (computed styles)

```javascript
// 1. Check for SplitType library
if (window.SplitType) {
  console.log('SplitType library active');
}

// 2. Scan for split elements
const splits = document.querySelectorAll('[class*="split"], [class*="char"], [class*="word"], [class*="line"]');
console.log(`Text-split containers found: ${splits.length}`);

// 3. Check for dynamically wrapped characters/words
const textEls = document.querySelectorAll('h1, h2, h3, .prose');
for (const el of textEls) {
  const hasCharWraps = el.querySelectorAll('.char, span[class*="char"]').length > 0;
  const hasWordWraps = el.querySelectorAll('.word, span[class*="word"]').length > 0;
  if (hasCharWraps || hasWordWraps) {
    console.log(`Text splitting detected: ${el.className}`);
  }
}
```

#### Detection signals via DOM observation (runtime)

1. **DOM structure mutation:** Page load → inspect a heading's children. If it contains many `<span>` wrappers (one per character or word) → text splitting active.
2. **Staggered animation timing:** Observe character-level animation. If each character animates in sequence with a delay → text splitting.

#### Detection via screenshot diff

1. Load page → wait 100ms → capture (text partially revealed)
2. Wait 500ms more → capture (text fully revealed)
3. If text appears in stages (character-by-character or word-by-word) → text animation active

#### Authoring tier mapping

| Tier | Capability |
|------|-----------|
| V3 free | ❌ No native text splitting |
| V3 + custom JS | ✓ Embed SplitType + GSAP (95%) |
| HTML widget | ✓ Full control (100%) |
| Free tier | ❌ Static text only |

**User message template:**
> Detected: Text animation (character-by-character fade-in via SplitType). Contributes ~12% to hero appeal.
> - **Recommended:** Embed SplitType + GSAP via HTML widget: 95% fidelity.
> - **Alternative:** Static headings: 50% visual impact.

---

### 1.9 Video Backgrounds & Media Autoplay

**What it is:**  
Hero sections or full-bleed containers with video backgrounds (MP4, WebM), often autoplaying and muted.

#### Detection signals in static HTML

- HTML tags: `<video autoplay muted playsinline>`, `<source src="*.mp4">`
- iFrame embeds: `<iframe src="https://vimeo.com/...">`, `<iframe src="https://youtube.com/embed/...">`
- Script embeds: Vimeo Player API, YouTube Embed API
- CSS backgrounds: `background-image:url(*.mp4)` (rare)

**Grep pattern:**
```bash
grep -E "<video|<source.*\.mp4|<iframe.*vimeo|<iframe.*youtube" <html>
grep "autoplay\|muted\|playsinline" <html>
```

#### Detection signals via Playwright (computed styles)

```javascript
// 1. Find video elements
const videos = document.querySelectorAll('video');
for (const video of videos) {
  console.log(`Video: autoplay=${video.autoplay}, muted=${video.muted}, src=${video.querySelector('source')?.src}`);
}

// 2. Find iframe embeds
const iframes = document.querySelectorAll('iframe');
for (const iframe of iframes) {
  const src = iframe.src;
  if (src.includes('vimeo') || src.includes('youtube')) {
    console.log(`Video embed: ${src.split('/').pop()}`);
  }
}

// 3. Check for video in background
// Harder to detect — would require inspecting parent container's computed styles
// and checking for data-video attributes or similar
```

#### Detection signals via DOM observation (runtime)

1. **Playback state:** Check `video.paused`, `video.currentTime` over time. If playing → video background active.
2. **Iframe observer:** If iframe loads and plays content → media embed.

#### Detection via screenshot diff

1. Screenshot of hero at page load
2. Wait 1s → screenshot
3. If visual content changed (not just animations, but new frames) → video playing

#### Authoring tier mapping

| Tier | Capability |
|------|-----------|
| V3 free | ✓ Video widget with HTML5 `<video>` (100%) |
| V3 + custom HTML | ✓ Full control (100%) |
| iFrame embeds | ✓ iFrame widget (100%) |

**User message template:**
> Detected: Video background (MP4 hero loop). Elementor native video widget fully supports this. Fidelity: 100%.

---

### 1.10 Animated Counter / Number Animations

**What it is:**  
Numbers count up from 0 to final value during scroll-into-view (e.g., "1000+ projects" animates from 0).

#### Detection signals in static HTML

- Scripts: `countUp.min.js`, `jquery.countTo`, `odometer.min.js`
- Classes: `.counter`, `.count-up`, `.odometer`, `.animate-number`
- Data attributes: `data-count-to`, `data-target`, `data-value`

**Grep pattern:**
```bash
grep -E "countUp|countTo|odometer|data-count" <html>
```

#### Detection signals via Playwright (computed styles)

```javascript
// 1. Find counter elements
const counters = document.querySelectorAll('[data-count-to], [data-target], [class*="counter"]');
for (const counter of counters) {
  console.log(`Counter: target=${counter.dataset.countTo || counter.dataset.target}`);
}

// 2. Check for CountUp library
if (window.CountUp) {
  console.log('CountUp library active');
}

// 3. Check for odometer
if (window.Odometer) {
  console.log('Odometer library active');
}
```

#### Detection signals via DOM observation (runtime)

1. **Text content mutation:** Monitor counter element text. Scroll it into view. If the text changes from "0" to "1000+" over ~1s with intermediate values → counter animation.

#### Detection via screenshot diff

1. Page load (counter off-screen) → capture
2. Scroll counter into view → wait 0.5s → capture
3. If number text changed → counter animation

#### Authoring tier mapping

| Tier | Capability |
|------|-----------|
| V3 free | ❌ No native counter animation |
| V3 + custom JS | ✓ Embed CountUp library (95%) |
| HTML widget | ✓ Full control (100%) |

**User message template:**
> Detected: Animated counters (counting to 1000+). Can embed CountUp library via HTML widget. Fidelity: 90%.

---

## Part 2: Central Detection Function (Reference Implementation)

This pseudocode outlines the main detection pipeline an agent should follow:

```python
def detect_motion_effects(source_url, playwright_page=None, fetch_html=None):
    """
    Detect all motion/3D/interaction effects in a source URL.
    
    Args:
        source_url: URL to analyze
        playwright_page: Playwright Page object (if available for runtime detection)
        fetch_html: Static HTML string (fallback if Playwright unavailable)
    
    Returns:
        {
            'detected_effects': [
                {
                    'class': 'smooth_scroll',
                    'confidence': 'high',
                    'signals': ['lenis.min.js', 'data-scroll attrs'],
                    'estimated_weight': 0.15,  # % of visual impact (0-1)
                    'authoring_tiers': {
                        'v3_free': False,
                        'v3_custom_css': True,
                        'v3_custom_js': True,
                        'pro_motion_effects': True,
                        'html_widget': True
                    },
                    'fidelity_per_tier': {
                        'v3_custom_css': 0.65,
                        'v3_custom_js': 0.95,
                        'pro_motion_effects': 0.90,
                        'html_widget': 0.95
                    }
                },
                # ... more effects
            ],
            'overall_motion_density': 'moderate',  # 'none', 'light', 'moderate', 'heavy'
            'would_clone_rating_suffer': True,
            'estimated_touch_up_hours': 3.5
        }
    """
    
    effects = []
    html = fetch_html or fetch(source_url)
    
    # ─────────────────────────────────────────────────────────
    # PHASE 1: Static HTML / CSS detection (cheap, high signal)
    # ─────────────────────────────────────────────────────────
    
    # 1.1 Smooth scroll
    if any(lib in html.lower() for lib in ['lenis', 'locomotive', 'smoothscroll', '@studio-freight']):
        effects.append({
            'class': 'smooth_scroll',
            'confidence': 'high',
            'signals': ['library import found'],
            'estimated_weight': 0.15,
            'authoring_tiers': {
                'v3_free': False,
                'v3_custom_js': True,
                'pro_motion_effects': True,
                'html_widget': True
            }
        })
    
    if 'data-scroll' in html:
        effects.append({
            'class': 'smooth_scroll',
            'confidence': 'medium',
            'signals': ['data-scroll attributes'],
            'estimated_weight': 0.12
        })
    
    # 1.2 Scroll-triggered reveals
    if any(lib in html.lower() for lib in ['aos.min.js', 'data-aos', 'gsap', 'scrolltrigger']):
        effects.append({
            'class': 'scroll_triggered_reveals',
            'confidence': 'high',
            'signals': ['AOS or GSAP detected'],
            'estimated_weight': 0.20,
            'authoring_tiers': {
                'v3_free': False,
                'pro_motion_effects': True,
                'html_widget': True
            }
        })
    
    # 1.3 Parallax
    if any(pat in html for pat in ['background-attachment:fixed', 'data-parallax', 'parallax']):
        effects.append({
            'class': 'parallax_scroll',
            'confidence': 'high',
            'signals': ['CSS or data attributes'],
            'estimated_weight': 0.25,
            'authoring_tiers': {
                'v3_free': True,  # via background-attachment:fixed
                'v3_custom_js': True,
                'html_widget': True
            }
        })
    
    # 1.4 3D transforms
    if any(pat in html for pat in ['perspective', 'preserve-3d', 'rotateX', 'rotateY', 'vanilla-tilt']):
        effects.append({
            'class': 'css_3d_transforms',
            'confidence': 'high',
            'signals': ['3D CSS found'],
            'estimated_weight': 0.10,
            'authoring_tiers': {
                'v3_free': False,
                'v3_custom_js': True,
                'html_widget': True
            }
        })
    
    # 1.5 Lottie / SVG animations
    if any(lib in html.lower() for lib in ['lottie', 'rive.app']):
        effects.append({
            'class': 'lottie_animation',
            'confidence': 'high',
            'signals': ['library import'],
            'estimated_weight': 0.08,
            'authoring_tiers': {
                'v3_free': False,
                'v3_custom_html': True,
                'html_widget': True
            }
        })
    
    if '<animate' in html or 'animateMotion' in html:
        effects.append({
            'class': 'svg_animation',
            'confidence': 'high',
            'signals': ['SVG animate elements'],
            'estimated_weight': 0.12,
            'authoring_tiers': {
                'v3_free': False,
                'v3_custom_html': True,
                'html_widget': True
            }
        })
    
    # 1.6 Text splitting
    if any(lib in html.lower() for lib in ['split-type', 'anime.js', 'charming']):
        effects.append({
            'class': 'text_animation',
            'confidence': 'high',
            'signals': ['text-splitting library'],
            'estimated_weight': 0.12,
            'authoring_tiers': {
                'v3_free': False,
                'v3_custom_js': True,
                'html_widget': True
            }
        })
    
    # 1.7 Video backgrounds
    if '<video' in html and 'autoplay' in html:
        effects.append({
            'class': 'video_background',
            'confidence': 'high',
            'signals': ['<video autoplay>'],
            'estimated_weight': 0.15,
            'authoring_tiers': {
                'v3_free': True,  # video widget
                'pro': True
            }
        })
    
    # 1.8 Sticky / scroll-snap
    if 'position:sticky' in html or 'scroll-snap-type' in html:
        effects.append({
            'class': 'sticky_positioning',
            'confidence': 'high',
            'signals': ['CSS position:sticky or scroll-snap'],
            'estimated_weight': 0.05,
            'authoring_tiers': {
                'v3_free': True
            }
        })
    
    # ─────────────────────────────────────────────────────────
    # PHASE 2: Runtime detection (if Playwright available)
    # ─────────────────────────────────────────────────────────
    
    if playwright_page:
        # Execute detection JS in the page context
        runtime_signals = playwright_page.evaluate("""() => {
            const signals = {};
            
            // Smooth scroll detection
            signals.smooth_scroll_hijacked = (() => {
                const scrollContainer = document.querySelector('[data-scroll-container], .lenis');
                return !!scrollContainer;
            })();
            
            // Hover transitions
            signals.hover_transitions = (() => {
                const buttons = document.querySelectorAll('button, a');
                for (const btn of buttons) {
                    const trans = window.getComputedStyle(btn).transition;
                    if (trans && trans !== 'none') return true;
                }
                return false;
            })();
            
            // 3D transforms
            signals.css_3d = (() => {
                const els = document.querySelectorAll('[style*="perspective"], [style*="rotateX"], [style*="rotateY"]');
                return els.length > 0;
            })();
            
            // Animation keyframes
            signals.css_animations = (() => {
                const rules = [];
                try {
                    for (const sheet of document.styleSheets) {
                        for (const rule of sheet.cssRules || []) {
                            if (rule.selectorText?.includes(':hover') || rule.keyText) {
                                rules.push(rule.selectorText);
                            }
                        }
                    }
                } catch (e) { }
                return rules.length > 0;
            })();
            
            // Sticky elements
            signals.sticky_elements = (() => {
                const stickies = document.querySelectorAll('[style*="position"]');
                for (const el of stickies) {
                    if (window.getComputedStyle(el).position === 'sticky') return true;
                }
                return false;
            })();
            
            // Lottie
            signals.lottie_active = !!window.lottie;
            
            // Video elements
            signals.video_elements = document.querySelectorAll('video').length > 0;
            
            return signals;
        }""")
        
        # Merge runtime signals into effects
        if runtime_signals.get('hover_transitions'):
            effects.append({
                'class': 'hover_interactions',
                'confidence': 'high',
                'signals': ['hover transitions detected at runtime'],
                'estimated_weight': 0.05,
                'authoring_tiers': {
                    'v3_free': True,  # button hover_color
                    'v3_custom_css': True,
                    'pro': True
                }
            })
        
        if runtime_signals.get('css_3d'):
            effects.append({
                'class': 'css_3d_transforms',
                'confidence': 'high',
                'signals': ['3D CSS at runtime'],
                'estimated_weight': 0.10,
                'authoring_tiers': {
                    'v3_custom_js': True,
                    'html_widget': True
                }
            })
    
    # ─────────────────────────────────────────────────────────
    # PHASE 3: Scoring & recommendations
    # ─────────────────────────────────────────────────────────
    
    # Deduplicate effects by class
    unique_effects = {}
    for effect in effects:
        key = effect['class']
        if key not in unique_effects or effect['confidence'] == 'high':
            unique_effects[key] = effect
    
    # Estimate motion density
    total_weight = sum(e.get('estimated_weight', 0) for e in unique_effects.values())
    if total_weight < 0.05:
        motion_density = 'none'
    elif total_weight < 0.15:
        motion_density = 'light'
    elif total_weight < 0.35:
        motion_density = 'moderate'
    else:
        motion_density = 'heavy'
    
    # Estimate touch-up hours
    estimated_hours = len(unique_effects) * 0.5 + total_weight * 3
    if motion_density == 'heavy':
        estimated_hours *= 1.5
    
    return {
        'detected_effects': list(unique_effects.values()),
        'overall_motion_density': motion_density,
        'total_motion_weight': total_weight,
        'would_clone_rating_suffer': total_weight > 0.20,
        'estimated_touch_up_hours': round(estimated_hours, 1),
        'summary': f"Detected {len(unique_effects)} effect classes ({motion_density} motion). "
                   f"Clone fidelity likely {85 - int(total_weight * 100)}% vs source."
    }
```

---

## Part 3: Quick Lookup Table

### Detection Signal → Effect Class → Confidence → Tier

| Static HTML Signal | Effect Class | Confidence | V3 Free | V3 Custom CSS | V3 Custom JS | Pro Motion | HTML Widget |
|---|---|---|---|---|---|---|---|
| `lenis.min.js`, `data-scroll` | smooth_scroll | HIGH | ❌ | ✓ | ✓ | ✓ | ✓ |
| `aos.min.js`, `data-aos` | scroll_triggered_reveals | HIGH | ❌ | ❌ | ✓ | ✓ | ✓ |
| `background-attachment:fixed` | parallax_scroll | HIGH | ✓ | ✓ | ✓ | ✓ | ✓ |
| `perspective`, `rotateX`, `rotate Y` | css_3d_transforms | HIGH | ❌ | ✓ | ✓ | ✓ | ✓ |
| `vanilla-tilt.min.js`, `data-tilt` | hover_3d_tilt | HIGH | ❌ | ❌ | ✓ | ⚠️ | ✓ |
| `:hover { ... }`, `transition:` | hover_interactions | MEDIUM | ✓ | ✓ | ✓ | ✓ | ✓ |
| `lottie.min.js`, `lottie-web` | lottie_animation | HIGH | ❌ | ❌ | ✓ | ⚠️ | ✓ |
| `<animate`, `<animateMotion` | svg_animation | HIGH | ❌ | ❌ | ✓ | ⚠️ | ✓ |
| `split-type.min.js`, `data-split` | text_animation | HIGH | ❌ | ❌ | ✓ | ⚠️ | ✓ |
| `<video autoplay`, `playsinline` | video_background | HIGH | ✓ | ✓ | ✓ | ✓ | ✓ |
| `position:sticky`, `scroll-snap` | sticky_positioning | HIGH | ✓ | ✓ | ✓ | ✓ | ✓ |
| Counter libs (CountUp, Odometer) | animated_counters | HIGH | ❌ | ❌ | ✓ | ⚠️ | ✓ |

**Legend:**
- ✓ = Native support, 90%+ fidelity
- ⚠️ = Partial support or workaround, 70-89% fidelity
- ❌ = Not supported, requires fallback or 3rd-party

---

## Part 4: User-Facing Reporting Template

When an effect is detected but can't be cloned at the target tier, use this template:

```
EFFECT DETECTION REPORT
═══════════════════════════════════════════════════════════════

Source URL: {url}
Target Tier: {v3_free | v3_custom_css | v3_custom_js | pro}
Overall Motion Density: {none | light | moderate | heavy}

DETECTED EFFECTS
─────────────────────────────────────────────────────────────

1. SMOOTH SCROLL HIJACKING
   Library: Lenis
   Detected via: lenis.min.js import, data-scroll attributes
   Visual Impact: ~15% (contributes to perceived polish)
   
   Authoring Options at Your Tier:
   • {tier_name}: {capability}. Fidelity: {X}%.
   • {next_tier}: {capability}. Fidelity: {Y}%.
   
   Recommendation: 
   > {recommendation}

2. SCROLL-TRIGGERED REVEALS
   Library: AOS (Animate On Scroll)
   Detected via: aos.min.js, [data-aos] attributes on 14 elements
   Visual Impact: ~20% (elements fade in during scroll)
   
   Authoring Options:
   • Free tier: Static page (no reveals). Fidelity: 60%.
   • Pro Motion Effects: Native scroll triggers. Fidelity: 95%.
   
   Recommendation:
   > This effect contributes significantly to the page's visual appeal. 
   > Recommend upgrading to Elementor Pro to reproduce natively, or 
   > embed AOS library via HTML widget for ~85% fidelity on free tier.

─────────────────────────────────────────────────────────────

SUMMARY

Effects detected: 3
Total visual impact: ~40%
Clone fidelity at your tier: ~{fidelity}%
Estimated touch-up time: {hours} hours

Action: 
{action}
```

**Example output for a user targeting V3 Free:**

```
EFFECT DETECTION REPORT
═══════════════════════════════════════════════════════════════

Source URL: https://example.com/hero-motion-site
Target Tier: Elementor V3 (Free)
Overall Motion Density: MODERATE

DETECTED EFFECTS
─────────────────────────────────────────────────────────────

1. SMOOTH SCROLL HIJACKING (Lenis)
   Impact: ~15% of visual appeal
   
   At V3 Free: ❌ Not supported natively. 
   → Workaround: Use native scroll (looks 85% as good, sacrifice is minimal)
   → Upgrade: Pro + HTML widget embed = 95% fidelity (cost: time/money)
   
   Recommendation: Accept native scroll. This site is 80% about content 
   and layout; the smooth scroll adds ~2% to the experience.

2. SCROLL-TRIGGERED REVEALS (AOS Library)
   Impact: ~20% of visual appeal
   
   At V3 Free: ❌ Not supported natively.
   → Workaround: Embed AOS + GSAP via HTML widget = 85% fidelity (1 hr work)
   → Upgrade: Pro Motion Effects = 95% fidelity (30 min work)
   
   Recommendation: RECOMMENDED — This is the #1 visual lever on this site. 
   Embed AOS library in an HTML widget (cost: 1 hour). Skip if timeline is tight.

3. PARALLAX SCROLL (CSS background-attachment:fixed)
   Impact: ~8% of visual appeal
   
   At V3 Free: ✓ Fully supported natively via CSS.
   Fidelity: 90% (matches source)
   
   Recommendation: Native support — no action needed.

─────────────────────────────────────────────────────────────

BOTTOM LINE

Clone fidelity at V3 Free: ~72% (acceptable)
Effort to reach 85%: 1-2 hours (embed AOS + smooth scroll)

NEXT STEPS

If timeline allows (≤2 hrs): Embed AOS library → reach 85% fidelity
If timeline tight: Ship with native scroll + static reveals → reach 72% fidelity (still respectable)
If quality critical: Upgrade to Pro + Motion Effects → reach 95% fidelity with minimal effort
```

---

## Part 5: Integration Checklist

For Joist clone agents, before starting authoring, check:

- [ ] Ran detection on source URL
- [ ] Documented all effects with confidence > MEDIUM
- [ ] Identified the 3-5 highest-impact effects (by `estimated_weight`)
- [ ] For each high-impact effect, chosen an authoring strategy (native / embed / fallback / upgrade)
- [ ] Updated the design brief with authoring limits (e.g., "smooth scroll will be native, not hijacked")
- [ ] Explained to user any effects that will be lost or degraded
- [ ] Set user expectations: "This clone will achieve 78% fidelity vs 95% if you upgrade to Pro"

---

## References & Related Docs

- `CLONE_AUTHORING_PLAYBOOK.md` — full workflow for cloning a page (uses detection output)
- `PLAYWRIGHT_DOM_EXTRACTION_DESIGN.md` — technical details on runtime extraction
- `ELEMENTOR_V3_WIDGET_REFERENCE.md` — settings surface for native widget authoring
- `ELEMENTOR_RENDERING_PIPELINE.md` — how settings → CSS → render
- `V4_ATOMIC_NORMALIZATIONS.md` — V4-specific rendering differences

---

## Appendix: Confidence Scoring Heuristic

Each detected effect is scored on **confidence** (likelihood the effect actually exists and will be visible to users):

- **HIGH** (0.85–1.0):
  - Library detected in HTML + confirmed at runtime
  - Specific data attributes or CSS properties present
  - Multiple independent signals point to same effect
  
- **MEDIUM** (0.55–0.85):
  - Library detected but not confirmed at runtime
  - CSS property present but inferred effect (e.g., `will-change:transform` suggests parallax but not certain)
  - Runtime signal detected but single source
  
- **LOW** (0.25–0.55):
  - Ambiguous signal (e.g., `transition:` could be any hover effect)
  - Library present but not certain if used on this page
  - Requires manual verification

In practice, only report effects with confidence **≥ MEDIUM** to users.

