# Motion Design Patterns 2026: Authoritative Taxonomy

**For:** Joist clone skill enhancement  
**Purpose:** Recognize, classify, and implement modern motion/interaction effects within Elementor V3/V4  
**Status:** Comprehensive taxonomy based on 2026 live web research  
**Last updated:** May 31, 2026

---

## Executive Summary

This document catalogues 28 named motion/interaction effects found in contemporary web design (May 2026). Each effect includes:
- **Visual & technical definition** – what users see and how it works
- **Detection signals** – HTML/CSS/JS markers to identify it in source code
- **Real 2026 examples** – Awwwards/FWA winners, agency portfolios, major brands
- **Implementation technique** – CSS, GSAP, Lottie, Three.js, Webflow native, etc.
- **Performance footprint** – light/medium/heavy GPU/CPU impact
- **Mobile behavior** – touch responsive? Degrades gracefully?
- **Elementor authoring** – native, Pro-only, custom CSS, or library embed?

The taxonomy is organized by **effect class** (scroll-based, hover/cursor, 3D/perspective, typography, layout, visual/effects). A quick lookup table at the end maps each effect to its Elementor implementability.

---

## Part 1: Scroll-Based Effects (9 patterns)

### 1. Parallax Scrolling (Background-Attachment Fixed)

**Visual description:**  
Background images or layers shift more slowly than foreground content as the user scrolls, creating the illusion of dimensional depth. Objects closer to the viewer appear to move faster than distant ones.

**Detection signals:**
- CSS: `background-attachment: fixed` on background containers
- CSS: Multiple overlapping containers with `background-position` animated
- Scroll event listeners: `window.scrollY` or scroll timeline
- Libraries: Parallax.js, Rellax.js imported in HTML

**Real 2026 examples:**
- **Vaulk** (Awwwards Site of the Day, May 31, 2026) – layered background parallax with staggered reveal
- **tinyPod** (Framer blog featured) – product reveal with hand-held parallax
- **Ouzo Matarellis** (Awwwards parallax collection) – multi-layer wine bottle parallax

**Technique class:**  
CSS Background-Attachment (fastest) | Layered CSS Transforms | JavaScript scroll multipliers | Parallax.js library

**Performance footprint:**  
**Light** (background-attachment) → **Medium** (JS + transforms) depending on layer count

**Mobile behavior:**  
Works on touch; background-attachment inconsistent on Safari iOS. Transform-based approach more reliable. Degrades gracefully to static layouts.

**Elementor authoring:**
- **V3 free:** Not native, requires custom CSS or library embed
- **V3 Pro:** Motion Effects add parallax natively
- **V4:** ScrollTimeline native support emerging
- **Workaround:** Container + custom CSS with `background-attachment: fixed` + multiple container stacking

---

### 2. Multi-Layer Parallax (Depth Stacking)

**Visual description:**  
3+ independent visual layers (foreground, mid-ground, background) scroll at different speeds, each triggered at different scroll thresholds. Creates cinematic camera-zoom illusion without actual zoom.

**Detection signals:**
- Multiple absolutely-positioned divs with `transform: translateY()`
- Speed multipliers: 0.2–0.5 applied to each layer
- GSAP ScrollTrigger with nested animation timelines
- Intersection Observer API detecting layer visibility

**Real 2026 examples:**
- **Mars Rejects** (Framer blog) – story cards drift while artwork stacks behind them
- **Unifiers of Japan** – hero image shifts and layers until character appears full-screen
- **Apple product pages** – premium multi-layer scroll reveals with 3D product rotations

**Technique class:**  
CSS Transforms (translateY/translateX) | GSAP ScrollTrigger | Motion React useScroll hook | Locomotive Scroll

**Performance footprint:**  
**Medium** – each layer = repaint/composite cost. GPU acceleration essential; use `will-change: transform`.

**Mobile behavior:**  
Touch-responsive if built with transforms. Reduce layer count on mobile (2–3 instead of 4+) for performance. Respects `prefers-reduced-motion`.

**Elementor authoring:**
- **V3 free:** Custom CSS + nested containers
- **V3 Pro:** Use Motion Effects + staggered container timing
- **V4 atomic:** e-container with scroll timeline CSS
- **Recommended:** Joist Pin-Scroll widget for multi-layer orchestration

---

### 3. Scroll-Triggered Reveals (Fade-Up, Slide-In, Scale-In)

**Visual description:**  
Elements remain hidden until they enter the viewport, then animate into place. Common variants: fade-up (opacity + translateY), slide-in (translateX from edge), scale-in (scaleX/Y from 0).

**Detection signals:**
- AOS (Animate On Scroll) library: `data-aos="fade-up"` attributes
- GSAP ScrollTrigger: `trigger:` element, `start:` offset
- Intersection Observer API: element.getBoundingClientRect() checks
- CSS: `animation-timeline: view()` for native scroll-driven animations (Chrome 115+)

**Real 2026 examples:**
- **Dropbox Brand Guidelines** – character illustrations fade-in with staggered timing
- **Uncommon Studio** – grid reveals with staggered stagger timing
- **Stripe.com** – statistics callouts animate on scroll into view

**Technique class:**  
AOS.js (lightweight) | GSAP ScrollTrigger (precise control) | CSS `animation-timeline: view()` (native, no JS) | Intersection Observer polyfills

**Performance footprint:**  
**Light–Medium** – depends on element count and animation complexity. CSS-only approach (view()) is fastest.

**Mobile behavior:**  
Excellent mobile support. Respects `prefers-reduced-motion`. AOS and ScrollTrigger handle touch without issues.

**Elementor authoring:**
- **V3 free:** None native; embed AOS library or custom CSS
- **V3 Pro:** Motion Effects → Entrance animations (scroll trigger)
- **V4 atomic:** Joist View-Transition emitter widget
- **Recommended:** Joist anchored-pop + visibility toggle on scroll

---

### 4. Pinned Scroll Sequences (Fixed Hero, Scrolling Content Below)

**Visual description:**  
A container (hero image, headline, product showcase) pins to the viewport while secondary content scrolls beneath it. On desktop, the pinned element doesn't move; on mobile, scroll behavior often reverts to natural flow.

**Detection signals:**
- CSS: `position: sticky` on container (modern) or `position: fixed` on hero
- GSAP: `pin: true` in ScrollTrigger config
- Scroll progress tied to nested timeline: `scrollTrigger: { trigger, scroller, pin: true }`
- `.block__wrapper { position: sticky; top: 0; }` wrapper pattern

**Real 2026 examples:**
- **Codrops Sticky Grid Scroll** (Mar 2026) – grid sticks while titles scroll above
- **BDSN Club** – full-screen project sticks while details scroll
- **Lusion** – portfolio project cards pin while metadata scrolls

**Technique class:**  
CSS `position: sticky` (simple, 90%+ browser support) | GSAP ScrollTrigger `pin: true` (precise control) | JavaScript calculation + fixed positioning (fallback)

**Performance footprint:**  
**Medium** – modern browsers optimize `sticky` efficiently. GSAP pinning requires more JS computation; test on lower-end mobile.

**Mobile behavior:**  
`sticky` works on mobile. `pin: true` often disabled on mobile (width < 768px) because vertical scroll real estate is limited. Gracefully degrades to normal scroll.

**Elementor authoring:**
- **V3 free:** Position Sticky on containers; no scroll-linked pin
- **V3 Pro:** Motion Effects + Pin settings
- **V4 atomic:** Joist Pin-Scroll widget (custom, W4 shipped)
- **Recommended:** Use Joist Pin-Scroll for choreographed pin sequences

---

### 5. Scrollytelling (Text Triggers Media Change)

**Visual description:**  
As user scrolls through narrative text, background video, images, or graphics change to match the story beat. Text and media are synchronized to scroll position.

**Detection signals:**
- Multiple video/image elements with `opacity` or `display` tied to scroll progress
- GSAP ScrollTrigger with `scrub: 1` (smooth scrubbing)
- Barba.js page transitions paired with video playback
- Data attributes: `data-scene="1"`, `data-media-src="video.mp4"`

**Real 2026 examples:**
- **Codrops scroll-revealed WebGL gallery** (Feb 2026) – WebGL shader reveal synced to scroll
- **Apple ecosystem pages** – product specs fade in/out as you read
- **Documentary-style agency portfolios** (Lusion, Active Theory) – story text triggers 3D scene morphs

**Technique class:**  
GSAP ScrollTrigger with nested Video API | Barba.js page routing + WebGL | React Suspense + lazy video loading | Framer Motion scroll timeline

**Performance footprint:**  
**Heavy** – video playback + DOM updates + scroll listener. Cache video frames; use WebP format. Codec: h.264 for broad mobile support.

**Mobile behavior:**  
Video playback limited on iOS (fullscreen-only older Safari). Use IntersectionObserver to pause videos offscreen. Fallback to static images on < 2GB RAM devices.

**Elementor authoring:**
- **V3 free/Pro:** Manual video swap via custom JS + scroll trigger
- **V4:** Joist Media-Trigger widget (not yet shipped; planned W5)
- **Workaround:** HTML embed with scrollytelling library (ScrollMagic, GSAP)

---

### 6. Horizontal Scroll Sections (Vertical Page → Lateral Content)

**Visual description:**  
Within a vertical page, a section scrolls horizontally. User scrolls down with mouse wheel, but content in that section moves left-to-right. Often uses tall container + sticky wrapper + transform: translateX.

**Detection signals:**
- Tall container: `height: 300vh` (3x viewport height)
- Wrapper: `position: sticky; top: 0; overflow: hidden`
- Inner scrollable: `display: flex; width: 400%` or `transform: translateX(calc(-75vw * var(--scroll-progress)))`
- GSAP: `transform: translateX()` animated by scroll progress

**Real 2026 examples:**
- **Motion React docs** – "Horizontal Scrolling Sections" demo
- **Unseen Studio** – project showcase carousel driven by vertical scroll
- **Portfolio galleries** (Agency sites) – work items slide horizontally while scrolling vertically

**Technique class:**  
CSS Sticky + Transform (native) | GSAP ScrollTrigger transform | Locomotive Scroll horizontal plugin | Framer Motion ScrollTimeline

**Performance footprint:**  
**Medium** – constant `translateX` calculation; GPU-accelerated on modern browsers. Test on iPad/Android tablets.

**Mobile behavior:**  
Desktop-primary effect. Often hidden or reverts to vertical carousel on mobile. Touch-friendly alternative: swipe-to-scroll native gesture.

**Elementor authoring:**
- **V3/Pro:** Not native; requires custom JavaScript
- **V4:** Sticky container + custom animation timeline
- **Workaround:** Carousel plugin (Swiper, Splide) styled to respond to scroll

---

### 7. Scroll-Driven Video Scrubbing

**Visual description:**  
User scrolls to "scrub" through video frames (like a timeline scrubber in video editing). No autoplay; scroll position directly controls video playhead. Creates interactive visual storytelling.

**Detection signals:**
- Video element with `currentTime` bound to scroll position
- GSAP: `duration` = video length, timeline scrubbed by ScrollTrigger
- Canvas-based frame extraction (convert video to image sequence)
- Intersection Observer to pause playback when offscreen

**Real 2026 examples:**
- **Apple 3D product reveals** – scroll to "spin" product 360°
- **Codrops WebGL gallery** – scroll position drives shader animation progress
- **Motion design studios** (Lusion, Active Theory) – cinematic sequences scrubbed on scroll

**Technique class:**  
HTML5 Video API + scroll listener | GSAP timeline scrubbed by ScrollTrigger | WebGL/Canvas frame-by-frame rendering | Three.js + scroll UV mapping

**Performance footprint:**  
**Heavy** – video playback requires codec support, frame buffering. Offscreen pause essential. Canvas rendering adds CPU load.

**Mobile behavior:**  
iOS: Video must be user-initiated (autoplay blocked). Use image sequence fallback on low-power devices. Respect `prefers-reduced-motion`.

**Elementor authoring:**
- **V3/Pro:** HTML embed with custom JS
- **V4:** Joist Scroll-Video widget (prototype, W6+)
- **Practical:** Use Elementor video widget + add scroll scrub via `<script>` tag in footer

---

### 8. Sticky Stacking Cards

**Visual description:**  
A deck of cards stacks vertically; as user scrolls, each card peels away or scales up, revealing the next card beneath. Creates tactile, playful reveal effect. Each card stays pinned until scroll position advances it.

**Detection signals:**
- CSS: `position: sticky; top: 0` on cards with staggered `margin-top` or `z-index`
- Transforms: `scale()` increases as card enters viewport (0.9 → 1)
- GSAP: `pin: true` per card with offset calculation
- Alternative: `position: absolute; transform: translateY()` per card

**Real 2026 examples:**
- **Codrops stacking cards demo** (CSS scroll-driven animations) – cards peel in order
- **3D sticky card stack** (ScrollTrigger YouTube tutorials) – cards rotate in 3D as they peel
- **SaaS product landing pages** (Substack, Notion clones) – feature cards stack-peel reveal

**Technique class:**  
CSS `position: sticky` with stagger | GSAP ScrollTrigger per-card pinning | CSS `animation-timeline: view()` native | Three.js for 3D peel

**Performance footprint:**  
**Light–Medium** – CSS sticky is efficient; GSAP per-card pinning is JS-heavy if many cards.

**Mobile behavior:**  
Sticky works on mobile; peel effect may feel janky on lower-end devices. Disable 3D transforms on mobile; use 2D scale instead.

**Elementor authoring:**
- **V3 free:** Nested containers with Position Sticky
- **V3 Pro:** Motion Effects + stagger delay per card
- **V4 atomic:** Container with `position: sticky` + Joist Card-Stack widget (prototype)
- **Recommended:** Stacking Cards widget (W5 roadmap)

---

### 9. Infinite/Wrap-Around Scroll (Carousel Loop, Marquee)

**Visual description:**  
A horizontal carousel or text marquee loops infinitely. Elements scroll off the right edge and reappear on the left without a visible seam. Often used for testimonials, logos, or moving text.

**Detection signals:**
- CSS: `@keyframes` animation with `100% { transform: translateX(-100%) }`
- Duplicated content HTML (items appear twice in DOM)
- Libraries: Marquee.js, Embla Carousel with `loop: true`, Swiper with `loop: true`
- JavaScript: Clone elements and reset position on scroll end

**Real 2026 examples:**
- **Client logo carousels** (Apple, Stripe, major brand sites) – infinite logo loop
- **Testimonial marquees** (SaaS landing pages) – endless quote carousel
- **Social proof widgets** – customer face carousel looping

**Technique class:**  
CSS `@keyframes` animation (pure CSS, fastest) | Swiper/Embla with loop flag | Custom JS clone + reset | GSAP with yoyo/repeat

**Performance footprint:**  
**Light–Medium** – CSS animation is GPU-accelerated; JS cloning approach requires more computation.

**Mobile behavior:**  
Excellent mobile support. Pause on user tap/swipe (auto-pause libraries handle this). Respects reduced-motion.

**Elementor authoring:**
- **V3 free/Pro:** Carousel widget with "loop" setting native
- **V4:** Carousel atomic element with loop
- **Recommended:** Elementor carousel widget + custom loop JavaScript if needed

---

### 10. Bento Grid Scroll Reveals (Bonus: Layout + Scroll)

**Visual description:**  
A modular grid (masonry, bento-style) where items reveal with staggered scroll-triggered animations (scale-in, fade-in, slide). 67% of top 100 SaaS on ProductHunt use bento grids (2026).

**Detection signals:**
- CSS Grid: `display: grid; grid-template-columns: repeat(auto-fit, ...)`
- Staggered animation: each child has `animation-delay: calc(var(--index) * 0.1s)`
- GSAP: ScrollTrigger + stagger config on grid children
- Data attribute: `data-index="0"`, `data-index="1"` for stagger calc

**Real 2026 examples:**
- **Pixlspace Creative Studio** (Awwwards interactive bento) – hover + scroll reveals
- **Aceternity UI bento grid** (shadcn/aceternity) – 2026 component library standard
- **SaaS landing pages** (Figma, Notion clones) – feature bento grids

**Technique class:**  
CSS Grid + `animation-timeline: view()` (native) | GSAP stagger on grid items | Framer Motion staggerChildren | Webflow native interactions

**Performance footprint:**  
**Light–Medium** – grid layout efficient; animation cost scales with item count.

**Mobile behavior:**  
Grid collapses to 1–2 columns on mobile. Stagger timing remains. Works great on touch.

**Elementor authoring:**
- **V3 free:** Grid widget (not native) + custom CSS
- **V3 Pro:** Grid widget + Motion Effects stagger
- **V4 atomic:** e-grid with scroll-reveal native support planned
- **Recommended:** Joist Bento-Grid widget (W7 roadmap)

---

## Part 2: Hover/Cursor Effects (7 patterns)

### 11. Magnetic Cursor (Button Snap)

**Visual description:**  
Interactive elements (buttons, links) appear to attract the cursor. When the cursor approaches, the element moves toward the cursor position, creating a "magnetic" pull. Label may also pull toward cursor via `useMagneticPull`.

**Detection signals:**
- Mouse move listener: `document.addEventListener('mousemove', (e) => { ... })`
- CSS: `--mouse-x`, `--mouse-y` custom properties updated
- Transform: `translate(var(--dx), var(--dy))` on button
- Libraries: Motion React's `useMagneticCursor`, custom implementations
- Distance calculation: `Math.sqrt((dx*dx) + (dy*dy))`

**Real 2026 examples:**
- **Motion Magazine "Introducing Magnetic Cursors"** – official Motion+ Cursor feature
- **BDSN Club** – experimental hover interactions with magnetic snap
- **Creative agency portfolios** (Lusion, Unseen Studio) – link hover magnetic pull

**Technique class:**  
Vanilla JS + requestAnimationFrame | Motion React `useMagneticCursor` | GSAP Draggable + proximity calc | TweakPan.js library

**Performance footprint:**  
**Medium** – requestAnimationFrame + mousemove listener on every pixel movement. Debounce/throttle recommended.

**Mobile behavior:**  
Desktop-only (no cursor on touch). Gracefully disabled on mobile or use touch-equivalent (tap snap).

**Elementor authoring:**
- **V3/Pro:** HTML embed with custom magnetic JS
- **Not native to Elementor V3/V4**
- **Workaround:** Custom Code embed + link hover JavaScript

---

### 12. Cursor-Following Blob/Circle

**Visual description:**  
A custom cursor shape (blob, circle, ring) follows the mouse pointer with slight lag/easing, creating a smooth trailing effect. Often reacts to hover states (size change, color shift).

**Detection signals:**
- Hidden default cursor: `cursor: none` on body
- Custom div styled as cursor: `position: fixed; pointer-events: none`
- Mouse position stored: `window.mouseX`, `window.mouseY`
- Smooth follow via interpolation: `lerp(current, target, 0.1)`
- Libraries: Cursor.js, Cursor-Effects.js, custom implementations

**Real 2026 examples:**
- **Creative Cruise 2026** (Merlin Studio, Awwwards) – custom cursor blob
- **Agency portfolios** (Lusion, Unseen Studio, Active Theory) – branded cursor shapes
- **Interactive product demos** – cursor reacts to hover targets

**Technique class:**  
Vanilla JS + requestAnimationFrame (lightweight) | GSAP morphSVG for blob shape changes | Rive for real-time cursor animations | Cursor library

**Performance footprint:**  
**Light–Medium** – constant requestAnimationFrame; optimize by reducing DOM repaints.

**Mobile behavior:**  
Desktop-only. Hidden on touch devices.

**Elementor authoring:**
- **Not native**
- **Workaround:** Header/footer custom code embed with cursor JS library

---

### 13. Tilt-on-Hover (3D Card Tilt)

**Visual description:**  
A card or element tilts in 3D space based on cursor position. Tilting responds to mouse X/Y relative to card center, creating pseudo-3D depth effect. Common on portfolio cards, product showcases.

**Detection signals:**
- CSS: `perspective: 1000px` on parent
- Transform: `rotateX()` and `rotateY()` based on mouse offset
- Mouse position relative to element: `getBoundingClientRect()` + offset calc
- Libraries: Vanilla Tilt.js, custom implemention
- Easing: spring animation on tilt rotation

**Real 2026 examples:**
- **Figma UI experiments** – card hover tilt
- **SaaS bento grids** – "Scale + Elevation" 2026 trend = tilt + shadow boost
- **Portfolio cards** (designer portfolios) – project card tilts on hover

**Technique class:**  
Vanilla Tilt.js library (12KB, easy) | GSAP + getMousePos | Framer Motion useMotionValue + transform | Webflow native 3D transforms

**Performance footprint:**  
**Light–Medium** – GPU-accelerated transforms; test on mobile.

**Mobile behavior:**  
Tilt disabled on touch; may use device gyroscope on iOS/Android (advanced). Fallback to scale on hover.

**Elementor authoring:**
- **V3 Pro:** 3D Transforms in Motion Effects
- **V4:** Atomic perspective + rotateX/Y transforms
- **Practical:** Vanilla Tilt library embed via footer script + CSS

---

### 14. Liquid Distortion on Hover

**Visual description:**  
Hovering over an element causes a liquid-like morphing or bulging deformation. Button border-radius shrinks, color shifts, and a "liquid" conic gradient pools. SVG morphing or WebGL shader distortion.

**Detection signals:**
- SVG `<path>` with `d` attribute animated
- GSAP MorphSVG plugin: `.to(morphPath, { morphSVG: ... })`
- WebGL shader distortion: GLSL fragment shader with noise
- CSS: `border-radius` animated, gradient-conic shift
- Libraries: Swiper.js liquid effect, custom SVG/WebGL

**Real 2026 examples:**
- **Modern CSS buttons** (2026 roundup) – liquid morphing button on hover
- **Interactive demos** (Agency sites) – liquid lens compare effect
- **Product showcases** – distortion magnifying glass effect

**Technique class:**  
SVG MorphSVG (vector) | WebGL GLSL shader (advanced 3D) | CSS morphing + gradients (limited but lightweight) | Canvas 2D distortion

**Performance footprint:**  
**Medium–Heavy** – SVG morphing requires DOM updates; WebGL shader heavy on GPU but smooth if optimized.

**Mobile behavior:**  
Disable WebGL shader on mobile; use SVG fallback. CSS morphing works universally.

**Elementor authoring:**
- **V3/Pro:** SVG widget + custom animation CSS
- **Not easily native**
- **Workaround:** HTML embed with Three.js or SVG library

---

### 15. Image Swap on Hover

**Visual description:**  
Hovering over an element swaps the background image or replaces an image element with another. Often paired with fade transition for smooth reveal. Used heavily in fashion/e-commerce.

**Detection signals:**
- `background-image` URL changed via `:hover` CSS
- Image `src` attribute changed via JavaScript
- GSAP: `.to(image, { autoAlpha: 0, duration: 0.3 })` then src swap then fade-in
- Data attribute: `data-hover-src="image2.jpg"`
- Intersection Observer: preload hover image when element visible

**Real 2026 examples:**
- **E-commerce sites** (Shopify) – product image swaps on hover
- **Fashion brand sites** – color variant preview on hover
- **Portfolio image galleries** – hover reveals alternate version

**Technique class:**  
CSS `:hover { background-image: ... }` (simple, instant) | JavaScript src swap + fade transition (smooth) | GSAP autoAlpha + setTimeout | Lazy loading with Intersection

**Performance footprint:**  
**Light** – CSS hover instant; JS swap + fade is smooth with minimal cost.

**Mobile behavior:**  
CSS `:hover` doesn't exist on touch. Use `:active` or JavaScript `ontouchstart/end` for touch equivalent.

**Elementor authoring:**
- **V3 free:** Image widget + CSS `:hover { background-image: ... }` custom CSS
- **V3 Pro:** Motion Effects + opacity fade on hover
- **V4:** Atomic with CSS `@media (hover: hover)` fallback for touch

---

### 16. Hover Gradient Mesh Transition

**Visual description:**  
Background gradient morphs when hovering, shifting from one color mesh to another. Often uses multiple radial gradients with animated `background-position`. Stripe-style ambient gradient effect.

**Detection signals:**
- CSS: `background: radial-gradient(at var(--x) var(--y), ...)`
- Mouse move updates `--x`, `--y` custom properties
- Multiple gradient layers: 2–3 overlapping `radial-gradient`
- GSAP: `background` color string animated
- SVG `<defs><filter>` mesh gradient (advanced)

**Real 2026 examples:**
- **Stripe.com** – ambient gradient mesh background
- **SaaS landing pages** – gradient mesh hero background
- **Modern agency sites** – ambient color shift on section hover

**Technique class:**  
CSS custom properties + JavaScript mouse tracking (lightweight) | GSAP `.to(element, { '--color-1': '...' })` | SVG mesh gradients (advanced) | Webflow native gradients

**Performance footprint:**  
**Light–Medium** – mouse tracking + gradient update; GPU handles rendering efficiently.

**Mobile behavior:**  
Gradient fixed on mobile (no mouse tracking). Static fallback gradient works well.

**Elementor authoring:**
- **V3/Pro:** Background gradient + custom CSS for mouse tracking
- **Not fully native**
- **Workaround:** Custom JS + CSS custom properties in style tag

---

### 17. Text Reveal Underline Animations

**Visual description:**  
On hover, text underline (border-bottom or custom line) animates in from one side or expands from center. Creates emphasis without color shift. Used on links, headings.

**Detection signals:**
- CSS: `position: relative; ::after { content: ''; border-bottom: 2px solid; }`
- Animation: `width: 0 → 100%` or `scaleX: 0 → 1` on `:hover ::after`
- Transform-origin: `left`, `center`, `right` depending on direction
- GSAP: `.to(underline, { scaleX: 1, transformOrigin: 'left', duration: 0.3 })`

**Real 2026 examples:**
- **Navigation links** (nearly all modern websites) – underline grow from left
- **Portfolio links** (designer sites) – animated link underline
- **CTA buttons** – underline accent animation

**Technique class:**  
Pure CSS `:hover ::after` animation (fastest) | GSAP scaleX transform | CSS `::before` underline alternative

**Performance footprint:**  
**Light** – GPU-accelerated transform; instant browser paint.

**Mobile behavior:**  
Touch-friendly; use `:active` for touch equivalent or disable on mobile.

**Elementor authoring:**
- **V3/Pro:** Link with custom CSS pseudo-element animation
- **Straightforward:** Add to heading/link via Custom CSS tab

---

### 18. Hover Blur/Desaturate Adjacent Items

**Visual description:**  
Hovering one item blurs, desaturates, or dims sibling items, creating focus hierarchy. Often paired with opacity changes. Draws attention to hovered element.

**Detection signals:**
- CSS: `filter: blur(5px) saturate(0.5)` on non-hovered siblings
- Parent `:hover` selector: `&:hover ~ .item { filter: blur(5px); }`
- JavaScript: Add/remove `.blurred` class on siblings
- Transition: `filter` property animated smoothly

**Real 2026 examples:**
- **Gallery hover effects** – hover image stays sharp; others blur
- **Team member cards** – hover card highlighted; others dim
- **Feature grids** – hover feature emphasized via sibling blur

**Technique class:**  
Pure CSS `:hover ~ .sibling { filter: blur(...) }` (adjacent selector) | JavaScript classList toggle | GSAP filter animation

**Performance footprint:**  
**Medium** – `filter: blur()` can be expensive on many elements; test on mobile.

**Mobile behavior:**  
Touch: hover not available. Use `:active` or tap-to-focus state.

**Elementor authoring:**
- **V3/Pro:** Custom CSS with `:hover ~ selector` or JavaScript
- **Workaround:** Add filter CSS to sibling elements in custom style

---

## Part 3: 3D/Perspective Effects (4 patterns)

### 19. CSS 3D Card Flip

**Visual description:**  
A card rotates 180° around the Y-axis, revealing a back side with different content. Often used for skill cards, feature reveals, testimonials. Requires CSS 3D Transforms and perspective.

**Detection signals:**
- CSS: `perspective: 1000px` on parent
- Child: `transform-style: preserve-3d; transform: rotateY(0deg)`
- Front/back pseudo-elements: `:before`, `:after` with `backface-visibility: hidden`
- On hover/click: `transform: rotateY(180deg)` applied
- Transition: `transform 0.6s` for smooth flip

**Real 2026 examples:**
- **Skill cards** (portfolio sites) – flip to reveal tech stack
- **Feature reveal cards** – front has icon, back has description
- **Testimonial cards** – front photo, back quote

**Technique class:**  
Pure CSS 3D Transforms (no JS needed for setup) | JavaScript click to trigger | GSAP for choreographed multi-card flips

**Performance footprint:**  
**Light–Medium** – 3D transform GPU-accelerated; check Safari mobile support.

**Mobile behavior:**  
Works on mobile; perspective may feel odd on small screens. Disable 3D perspective on mobile, use 2D fade instead.

**Elementor authoring:**
- **V3/Pro:** 3D Transforms in Motion Effects or custom CSS `@supports (transform: rotateY(0deg))`
- **V4 atomic:** 3D container with flip animations

---

### 20. Three.js / R3F Embedded Hero Scene

**Visual description:**  
Full 3D scene (geometries, lights, materials) rendered in a WebGL canvas, embedded in page hero. Scene may rotate automatically, respond to mouse movement, or be scrollable. Requires JavaScript 3D library.

**Detection signals:**
- HTML: `<canvas id="webgl-canvas"></canvas>`
- JS imports: `import * as THREE from 'three'`, `import { Canvas } from '@react-three/fiber'`
- Network: .glb, .gltf, or .obj 3D model files loaded
- CPU profile: GPU-heavy during scroll/interaction
- Libraries: Three.js, Babylon.js, Oimo.js, Cannon.js (physics)

**Real 2026 examples:**
- **Lusion** – immersive 3D environment responding to mouse, project cards morph in
- **Active Theory** – full-screen WebGL hero with choreographed transitions
- **Product showcase sites** – 3D model viewer with interactive controls
- **Nike, Gucci, luxury brands** – 3D product configurators

**Technique class:**  
Three.js (most popular) | Babylon.js (enterprise) | Spline (no-code 3D) | React Three Fiber (R3F, React integration) | Oimo.js (physics simulation)

**Performance footprint:**  
**Heavy** – GPU-intensive; model size, shader complexity, and update frequency impact performance. Offload to Web Worker if possible.

**Mobile behavior:**  
Reduced geometry/textures on mobile. Use device-pixel-ratio detection. Low-end Android: disable WebGL, fallback to video or static image.

**Elementor authoring:**
- **V3/Pro:** HTML/Custom Code embed with Three.js canvas
- **Not native to Elementor**
- **Workaround:** Spline embed (no-code 3D) or custom Three.js script

---

### 21. Mouse-Parallax 3D Layers

**Visual description:**  
Multiple image or DOM layers tilt in 3D space based on mouse position. As cursor moves across element, each layer shifts by a proportional amount, creating pseudo-depth. Similar to tilt-on-hover but without full tilt rotation.

**Detection signals:**
- CSS: `perspective: 1000px; transform-style: preserve-3d`
- Mouse position calculation: normalized X/Y from element center
- 3D transform: `translate3d(calc(mouseX * 0.5), calc(mouseY * 0.3), 0)`
- Multiple nested divs with increasing scale of translation (foreground moves more)
- Libraries: Vanilla Tilt.js offers parallax mode, custom implementations

**Real 2026 examples:**
- **Unseen Studio** – layered card parallax on mouse move
- **Apple product pages** – subtle 3D parallax on hero images
- **Portfolio galleries** – mouse-responsive depth effect on project cards

**Technique class:**  
Vanilla JS + getBoundingClientRect + mouse listener | Vanilla Tilt.js `data-tilt-scale="1"` | GSAP with `onMouseMove` callback

**Performance footprint:**  
**Medium** – per-pixel mouse tracking; throttle or requestAnimationFrame. Test on lower-end devices.

**Mobile behavior:**  
Gyroscope-based parallax on iOS/Android (device orientation). Fallback: static or disabled.

**Elementor authoring:**
- **V3/Pro:** Nested containers with custom JS mouse parallax
- **Not fully native**
- **Workaround:** Vanilla Tilt library embed or custom mouse listener

---

### 22. WebGL Shaders (Distortion, Ripple, Noise)

**Visual description:**  
Custom GLSL fragment shaders distort, ripple, or add noise to images/geometry. Effects include: fish-eye lens distortion, wave ripple propagation, Perlin noise textures, fluid dynamics simulation. Highly customizable but complex.

**Detection signals:**
- GLSL code: `#version 300 es`, `uniform sampler2D`, `varying vec2 vUv`
- Three.js material: `THREE.ShaderMaterial({ vertexShader, fragmentShader })`
- TWGL (Tiny WebGL): shader uniform updates via JavaScript
- Canvas-based shader: WebGL context + program compilation
- Libraries: Shader Forge, Babylone.js playground, custom GLSL

**Real 2026 examples:**
- **Codrops WebGL shader gallery** (Feb 2026) – image reveal via distortion shader
- **Apple product pages** – subtle ripple/wave effects on hero
- **Music/visual sites** – audio-reactive shader distortion
- **Generative art** – Perlin noise, fractal Brownian motion shaders

**Technique class:**  
GLSL fragment shaders (custom, low-level) | Three.js ShaderMaterial | Babylon.js ShaderStore | TWGL (simplified WebGL)

**Performance footprint:**  
**Heavy** – GPU-intensive; shader complexity, texture resolution, and frame rate impact. Optimize for mobile (lower resolution, simpler shader).

**Mobile behavior:**  
WebGL 2.0 support limited on older mobile. Use WebGL 1.0 fallback or disable shaders on low-end. Desktop-primary effect.

**Elementor authoring:**
- **Not native to Elementor**
- **Advanced:** Custom Three.js/Babylon.js implementation via HTML embed
- **Simpler:** Use Spline, Sketchfab embed for pre-built 3D with shaders

---

### 23. 3D Model Viewer (glTF Embeds)

**Visual description:**  
Embedded 3D model (glTF/.glb, .obj, .fbx converted) displayed in page. User can rotate, zoom, inspect model. Interactive model viewer common in e-commerce, CAD tools, AR previews.

**Detection signals:**
- Network: .glb, .gltf, .obj model file request
- JavaScript: model loader library (three.js GLTFLoader, Babylon.js, Sketchfab API)
- HTML: `<div id="model-viewer"></div>` with WebGL canvas
- Touch/mouse handlers: rotate, zoom, pan event listeners
- Libraries: three.js + GLTFLoader, model-viewer web component, Sketchfab embed

**Real 2026 examples:**
- **3D product configurators** (Nike, Gucci, automotive) – spin and inspect 3D product
- **AR preview** (Snapchat, Instagram) – glTF in AR viewer
- **AEC (Architecture/Engineering)** – building model inspector
- **Sketchfab embeds** – 3D artist portfolio

**Technique class:**  
Three.js GLTFLoader + OrbitControls | Babylon.js ImportMesh | Google model-viewer web component | Sketchfab iframe embed

**Performance footprint:**  
**Heavy–Very Heavy** – model file size (10–50 MB uncompressed), parsing, and real-time rendering. Draco compression essential for web.

**Mobile behavior:**  
Model-viewer web component handles mobile touch gestures natively. Test on 4G; 5G recommended for large models. Fallback to image if model load fails.

**Elementor authoring:**
- **V3/Pro:** HTML embed with model-viewer web component or three.js
- **Not native**
- **Easiest:** Sketchfab iframe embed or Google model-viewer `<model-viewer>` tag

---

## Part 4: Typography Effects (4 patterns)

### 24. Variable Font Axis Animation

**Visual description:**  
Font weight, width, or slant animate in real time. Weight shifts from light (100) to bold (900) smoothly. Width morphs from condensed to expanded. Uses variable fonts with multiple axes (wght, wdth, ital, opsz).

**Detection signals:**
- CSS: `font-family: 'Variable Font Name'`
- CSS: `font-variation-settings: 'wght' 400, 'wdth' 75` (variable settings)
- Animation: `@keyframes { from { font-variation-settings: 'wght' 300; } to { font-variation-settings: 'wght' 800; } }`
- JavaScript: DOM element `style.fontVariationSettings = 'wght ' + weight`
- Google Fonts variable font imported: `?display=swap&variation=wght@100..900`

**Real 2026 examples:**
- **Typography trend sites** (Typekit, Google Fonts showcases) – variable weight animation demo
- **Kinetic typography videos** (Renderforest, After Effects) – animated variable font sequences
- **Agency sites** (Baseline, other typography-forward studios) – animated heading font weight

**Technique class:**  
CSS `@keyframes` + `font-variation-settings` (simple) | JavaScript variable font parameter interpolation | GSAP `attr` plugin for font-variation-settings

**Performance footprint:**  
**Light–Medium** – font rendering cached by browsers; smooth 60fps possible. Variable font files slightly larger than static fonts.

**Mobile behavior:**  
Full mobile support. Respects `prefers-reduced-motion`.

**Elementor authoring:**
- **V3/Pro:** Heading widget + custom CSS @keyframes animation
- **V4:** Typography control with variable font axis sliders (planned, future)
- **Practical:** Add `@keyframes` + `animation` to heading CSS

---

### 25. Split-Text Character Reveal

**Visual description:**  
Text splits into individual characters, words, or lines. Each unit animates in (fade-up, scale, rotate) with staggered timing. Creates sophisticated, choreographed text entrance. GSAP SplitText is industry standard.

**Detection signals:**
- GSAP SplitText library imported: `gsap.registerPlugin(SplitText)`
- Text wrapped in spans: `<span class="char">A</span><span class="char">B</span>...`
- Stagger animation: `.to(chars, { y: 0, opacity: 1, stagger: 0.05, duration: 0.6 })`
- Cleanup: `split.revert()` on destroy
- Alternative: Splitting.js library for lightweight splitting

**Real 2026 examples:**
- **Lusion, Active Theory, Unseen Studio** – choreographed SplitText reveals
- **10 state-of-the-art text animations** (Codrops) – character reveal showcase
- **Portfolio sites** – animated headline reveal on page load
- **High-end landing pages** – dramatic text entrance

**Technique class:**  
GSAP SplitText (licensed free since 2024) | Splitting.js (lightweight alternative) | Custom JavaScript char-wrapping + CSS animation | Framer Motion + text-splitting

**Performance footprint:**  
**Light–Medium** – DOM element count increases per character; test with long text blocks.

**Mobile behavior:**  
Full mobile support. May feel janky on low-end devices with long text; consider disabling on mobile.

**Elementor authoring:**
- **V3/Pro:** Text widget + GSAP SplitText via footer script
- **Not native to Elementor**
- **Workaround:** HTML embed with SplitText script tag

---

### 26. Marquee Text (Horizontal Scroll Text)

**Visual description:**  
Text scrolls horizontally across the page continuously, like an old-school news ticker. Can loop infinitely, pause on hover, or be user-draggable. Often used for taglines, credits, or dynamic copy.

**Detection signals:**
- CSS: `@keyframes` `transform: translateX(100%) → translateX(-100%)`
- Duplicated text content (appears twice in DOM for seamless loop)
- Animation: `animation: marquee 20s linear infinite` (or reverse)
- Libraries: Marquee.js, Marquee3k, custom CSS + JS
- Pause on hover: `animation-play-state: paused` on `:hover`

**Real 2026 examples:**
- **News/media sites** – scrolling headline ticker
- **Design portfolio** (portfolio sites) – tagline or studio name marquee
- **Event sites** – speaker/sponsor name scroll
- **Credits sequences** – movie/game-style scrolling credits

**Technique class:**  
Pure CSS `@keyframes` + `animation: linear infinite` (simplest) | JavaScript position reset on scroll end | Marque3k library (physics-based easing)

**Performance footprint:**  
**Light** – CSS animation GPU-accelerated; very efficient.

**Mobile behavior:**  
Excellent mobile support. Text may appear cramped on small screens; consider disabling or reducing speed.

**Elementor authoring:**
- **V3/Pro:** Text widget + custom CSS `@keyframes` marquee animation
- **Straightforward:** Add animation to text element via Custom CSS

---

### 27. Mask-Reveal Text Fills

**Visual description:**  
Text reveals through an animated mask shape (diagonal wipe, circular reveal, wave mask). Text color fills as mask animates. Creates cinematic, elegant text entrance. Often used on landing page headlines.

**Detection signals:**
- CSS: `clip-path: polygon(...)` animated, or `mask-image: linear-gradient()`
- SVG: `<mask>` element with animated `<rect>` or `<path>`
- GSAP: `.to(element, { clipPath: 'polygon(0% 0%, 100% 0%, ...) })`
- Animation: element progressively reveals left-to-right, top-to-bottom, or via custom shape

**Real 2026 examples:**
- **Landing page headlines** (SaaS, product launches) – text reveals via diagonal wipe
- **Portfolio intro animations** – name/tagline reveals with custom mask
- **Premium web experiences** (Apple, luxury brands) – sophisticated text entrance

**Technique class:**  
CSS `clip-path` + @keyframes (modern, no JS) | SVG `<mask>` + animation (precise) | GSAP `clip-path` string animation (flexible)

**Performance footprint:**  
**Light–Medium** – clip-path can trigger repaints on older browsers; use GPU-accelerated CSS where possible.

**Mobile behavior:**  
Excellent mobile support. Clip-path works universally.

**Elementor authoring:**
- **V3/Pro:** Heading + custom CSS `clip-path` animation
- **Not fully native**
- **Workaround:** Add `@keyframes` + `clip-path` to heading Custom CSS

---

### 28. Animated Gradient Text

**Visual description:**  
Text color shifts through a gradient animation. Background gradient moves behind text (via `background-clip: text`), or gradient itself animates via color keyframes. Creates vibrant, dynamic typography.

**Detection signals:**
- CSS: `background: linear-gradient(...)`, `background-clip: text`, `-webkit-background-clip: text`
- Animation: `background-position` animates left-to-right/up-down (requires large gradient)
- Alternative: `@keyframes` with `color` property changing across stops
- GSAP: `.to(element, { '--color-1': 'blue', '--color-2': 'purple' })` using custom properties

**Real 2026 examples:**
- **Tech/AI landing pages** – animated gradient headings
- **SaaS brands** – gradient text in hero
- **Design trends showcase** – 2026 color trend demonstrations
- **Gaming/NFT projects** – eye-catching gradient typography

**Technique class:**  
CSS `background-clip: text` + `animation: background-position` (pure CSS) | CSS custom properties + @keyframes | GSAP color animation via custom properties

**Performance footprint:**  
**Light** – if using custom properties; medium if animating `background-position` (larger gradient = more paint).

**Mobile behavior:**  
Full mobile support. Custom property approach most performant on mobile.

**Elementor authoring:**
- **V3/Pro:** Heading + custom CSS background-clip: text + animation
- **Straightforward:** Add gradient + animation to heading Custom CSS

---

## Part 5: Layout/Structural Effects (4 patterns)

### 29. Drag-to-Scroll Horizontal Galleries

**Visual description:**  
User can drag horizontally to scroll through a gallery of items (images, cards, projects). Often combined with snap-to-grid for smooth item alignment. Touch-friendly; also supports mouse drag.

**Detection signals:**
- HTML: Horizontal scrollable container with `overflow-x: scroll; scroll-snap-type: x mandatory`
- Library imports: Swiper.js, Embla Carousel, Splide
- Event listeners: `onMouseDown`, `onTouchStart`, `onMouseMove`, `onTouchMove`
- CSS: `scroll-snap-align: start` on gallery items
- Touch action: `touch-action: pan-y` to allow only vertical default scroll

**Real 2026 examples:**
- **Product carousels** (e-commerce, Shopify stores) – drag through product options
- **Portfolio galleries** (creative sites) – swipe through project images
- **Social proof carousels** (testimonials) – drag through customer quotes
- **Native apps** (iOS, Android) replicated in web – horizontal scroll galleries

**Technique class:**  
CSS Scroll Snap (native, no JS) | Swiper.js (most popular for production) | Embla Carousel (lightweight) | Splide (accessible, no jQuery)

**Performance footprint:**  
**Light–Medium** – native scroll snap very efficient; library overhead depends on feature set.

**Mobile behavior:**  
Excellent mobile support; native touch gesture. Snap alignment critical for usability.

**Elementor authoring:**
- **V3/Pro:** Carousel widget with drag settings
- **V4:** Native carousel atomic element
- **Recommended:** Elementor carousel or Swiper embed

---

### 30. Modal Carousels with Thumbnails

**Visual description:**  
Modal/lightbox opens with main image + thumbnail strip below. User clicks thumbnail to swap main image or drags main image to slide to next. Often seen in e-commerce product galleries, photo portfolios.

**Detection signals:**
- Modal structure: `display: flex`, main image + thumbnails sidebar
- Click listener on thumbnails: swaps main image `src`
- Swiper.js: dual carousel (main + thumbs) with `thumbsSlider: true` config
- Fade/scale animation on image swap
- Libraries: Swiper with thumbs, Lightbox2, GLightbox, custom modal

**Real 2026 examples:**
- **E-commerce product pages** (Shopify, WooCommerce) – image gallery with thumbnails
- **Photography portfolios** – lightbox with thumbnail grid
- **Fashion sites** – color/size variant selection via thumbnail

**Technique class:**  
Swiper Thumbs Gallery (built-in feature) | Custom JavaScript + image swap | GLightbox (lightweight lightbox) | Fancybox (feature-rich modal)

**Performance footprint:**  
**Light–Medium** – image preloading essential; lazy-load thumbnails if many items.

**Mobile behavior:**  
Responsive thumbnail layout (may stack on mobile). Touch-friendly swipe/drag built-in.

**Elementor authoring:**
- **V3/Pro:** Carousel widget + image widget in modal
- **Not fully native; requires custom JS**
- **Workaround:** Swiper.js with modal container via HTML embed

---

## Part 6: Visual/Effects (5 patterns)

### 31. Lottie Animations (Designer-Authored Vectors)

**Visual description:**  
Animations created in Adobe After Effects, exported as JSON via Bodymovin plugin, and rendered via Lottie.js in browser. Highly customizable, lightweight (vector-based), and interactive. Used for icons, mascots, transitions, full-page animations.

**Detection signals:**
- JSON file request: `.lottie` or `.json` from LottieFiles CDN or custom host
- Script import: `import Lottie from 'lottie-web'` or Lottie react component
- HTML: `<div id="lottie-container"></div>`
- Initialization: `lottie.loadAnimation({ container, renderer: 'svg', path: 'animation.json' })`
- Interactivity: `setSpeed()`, `play()`, `pause()`, `seek(frame)` methods

**Real 2026 examples:**
- **Duolingo** – Lottie mascot animations
- **Spotify Wrapped** – Lottie animations throughout experience
- **Micro-interactions** (SaaS, apps) – loading spinners, success checkmarks, error states
- **LottieFiles library** – 10,000+ free/paid animations

**Technique class:**  
Lottie.js (React, Vue, vanilla JS) | dotLottie.js (web component, new standard) | Rive.app (alternative, interactive vector animations) | After Effects export + Bodymovin

**Performance footprint:**  
**Light** – JSON file size small (10–50 KB typical); rendering efficient. SVG or Canvas renderer options.

**Mobile behavior:**  
Excellent mobile support. Reduce animation frame rate on low-end devices if needed.

**Elementor authoring:**
- **V3/Pro:** HTML embed with Lottie.js script
- **Not native; no Lottie widget yet**
- **Workaround:** Custom HTML with Lottie CDN + container div

---

### 32. Particle Backgrounds (tsparticles, p5.js)

**Visual description:**  
Animated background of moving particles (dots, lines, circles) with physics (velocity, collision, attraction). Often interactive (particles follow cursor or react to click). Used for ambient, generative backgrounds.

**Detection signals:**
- Canvas element: `<canvas id="particles"></canvas>`
- Library: tsparticles (most popular), p5.js, Three.js particle system, PixiJS
- JavaScript: Particle class with position, velocity, acceleration
- Animation loop: `requestAnimationFrame` updates particle positions, redraws canvas
- Configuration: color, size, speed, density, interaction parameters

**Real 2026 examples:**
- **SaaS landing pages** (background particles during scroll)
- **Portfolio intro animations** (animated particle background on load)
- **Music visualizers** (audio-reactive particle effects)
- **Generative art galleries** (interactive particle systems)

**Technique class:**  
tsparticles.js (customizable, 100+ effects) | p5.js (creative coding) | Three.js ParticleSystem | PixiJS (WebGL accelerated) | Babylon.js particles

**Performance footprint:**  
**Medium–Heavy** – depends on particle count (100–10,000+). Canvas rendering CPU-intensive; GPU acceleration via WebGL recommended for many particles.

**Mobile behavior:**  
Reduce particle count on mobile (100–500 instead of 5000). Use lower frame rate if performance drops below 30 fps.

**Elementor authoring:**
- **V3/Pro:** HTML embed with tsparticles script
- **Not native; no particle widget**
- **Workaround:** tsparticles CDN + canvas container

---

### 33. Noise Textures + Grain Overlays

**Visual description:**  
Perlin noise texture or grainy overlay applied to background or image layer. Creates analog film grain, aged paper, or textural depth effect. Often combined with low opacity for subtle visual interest.

**Detection signals:**
- SVG `<filter><feTurbulence>` for Perlin noise (CSS filters can't generate noise)
- Canvas-based noise generation (draw frame with noise, blend via CSS `mix-blend-mode`)
- CSS filter: `filter: contrast(1.2) brightness(0.9)` mimicking grain (limited)
- Image overlay: semi-transparent PNG noise image
- Libraries: p5.js `noise()`, Perlin noise shaders, noise texture PNGs

**Real 2026 examples:**
- **Modern design trend** – film grain effect on hero images
- **Vintage brand sites** – aged texture overlay
- **Design showcases** – texture/material demonstrations
- **Glassmorphism cards** – subtle grain under frosted glass

**Technique class:**  
SVG `<feTurbulence>` filter (simple, but limited) | Canvas noise rendering (flexible) | WebGL shader Perlin/Simplex noise (high-end) | PNG texture overlay (fastest)

**Performance footprint:**  
**Light–Medium** – SVG filter very efficient; Canvas noise generation adds CPU cost. PNG overlay = zero cost.

**Mobile behavior:**  
PNG overlay approach best for mobile. Canvas noise may impact performance; consider static texture.

**Elementor authoring:**
- **V3/Pro:** Background image + transparent noise PNG overlay
- **Advanced:** SVG filter embed via custom code
- **Practical:** PNG grain image + blend-mode CSS

---

### 34. Glassmorphism (Backdrop-Filter)

**Visual description:**  
Elements have semi-transparent background with frosted-glass appearance. Background blur via `backdrop-filter: blur(10px)` + `background-color: rgba(255,255,255,0.1)`. Creates modern, iOS-inspired aesthetic. Pairs well with particle backgrounds.

**Detection signals:**
- CSS: `backdrop-filter: blur(10px)` property
- Background: `background-color: rgba(...)` with low opacity (0.1–0.3)
- Border: often thin white/light border for definition
- Fallback: `@supports (backdrop-filter: blur())` for browser detection

**Real 2026 examples:**
- **SaaS UI cards** (2026 design trend) – navigation, cards, modals
- **Apple design inspiration** – system UI aesthetic on web
- **Modern landing pages** – frosted glass sections over particle/gradient backgrounds
- **LottieFiles glassmorphism pack** – pre-designed components

**Technique class:**  
Pure CSS `backdrop-filter: blur()` (modern, clean) | SVG blur filter fallback (IE) | Canvas blur (fallback, heavy) | Webflow native glassmorphism component

**Performance footprint:**  
**Medium** – `backdrop-filter` can be GPU-heavy on many stacked elements. Test on mobile; disable if FPS drops below 50.

**Mobile behavior:**  
Safari iOS/Chrome Android support strong. Performance impact varies; reduce blur amount or element count on low-end devices.

**Elementor authoring:**
- **V3/Pro:** Container + custom CSS `backdrop-filter: blur(10px); background-color: rgba(...)`
- **Straightforward:** Add to container Custom CSS

---

### 35. Liquid Blobs (SVG Path Morphing)

**Visual description:**  
SVG `<path>` morphs smoothly between blob shapes (amorphous, organic forms). Often animated on scroll or hover, or used as background shape that morphs. Creates playful, modern aesthetic.

**Detection signals:**
- SVG element: `<svg><path d="M...Z" /></svg>`
- GSAP MorphSVG plugin: `.to(path, { morphSVG: 'M new-path-d Z' })`
- JavaScript: path `d` attribute animated or morphed via JavaScript library
- Animation: smooth easing (ease-in-out) for natural blob motion
- Libraries: GSAP MorphSVG (best), SVG.js, Snap.svg, custom `<animate>` tags

**Real 2026 examples:**
- **Playful SaaS landing pages** – blob-shaped sections
- **Portfolio intro animations** – organic blob shapes frame text/image
- **Button hover effects** – blob morphs on cursor approach
- **Splash screens** – blob animations on app load

**Technique class:**  
GSAP MorphSVG (industry standard) | SVG native `<animate>` tags (limited control) | Canvas-based blob drawing (Marching Squares algorithm) | Spline.app (no-code blob shapes)

**Performance footprint:**  
**Light–Medium** – SVG morphing smooth on modern browsers. GPU-accelerated on supported platforms.

**Mobile behavior:**  
Full mobile support. Touch-friendly if interactive (tap to re-morph).

**Elementor authoring:**
- **V3/Pro:** SVG embed + GSAP MorphSVG script
- **Not fully native**
- **Workaround:** SVG in HTML widget + footer script with GSAP

---

### 36. Smooth Scroll Inertia (Lenis, Locomotive Scroll)

**Visual description:**  
Page scroll has physics-based "momentum" or "inertia" – when user releases scroll, content continues to decelerate smoothly rather than stopping abruptly. Creates buttery, app-like scroll feeling. Lenis (2024 modern standard) provides smoothest experience.

**Detection signals:**
- Library: Lenis imported (`import Lenis from '@studio-freight/lenis'`)
- Initialization: `const lenis = new Lenis({ ... }); lenis.on('scroll', ...)`
- Alternative: Locomotive Scroll (older but still used)
- Effect: visual scroll feels "heavier" and more premium
- Configuration: `duration`, `easing`, `lerp` parameters tune feel

**Real 2026 examples:**
- **Premium agency sites** (Lusion, Basement, Active Theory) – smooth scroll standard
- **SaaS landing pages** – Lenis adoption increasing for polish
- **Webflow sites** – Lenis often embedded as standard
- **High-end brands** – Apple, Stripe ecosystem

**Technique class:**  
Lenis (modern, lightweight, recommended) | Locomotive Scroll (heavier, more features) | GSAP ScrollSmoother (plugin for GSAP users) | Custom requestAnimationFrame scroll interpolation

**Performance footprint:**  
**Light–Medium** – Lenis optimized for minimal overhead. Locomotive slightly heavier. Test on low-end mobile.

**Mobile behavior:**  
Lenis handles mobile well; momentum scrolling already native on iOS. Android support growing. May override native scroll on some devices.

**Elementor authoring:**
- **Not native to Elementor**
- **Workaround:** Global script tag in footer with Lenis initialization
- **Easiest:** Elementor Pro custom JS footer code

---

## Part 7: Emerging/Specialty Effects (3 patterns)

### 37. SVG Icon Animations on Scroll

**Visual description:**  
SVG icons (strokes, fills, paths) animate as they enter viewport. Common: stroke dasharray animation (drawing effect), fill color change, path morphing, scale-in. Creates visual interest for feature/benefit lists.

**Detection signals:**
- SVG: `<svg><path stroke-dasharray="100" stroke-dashoffset="100" /></svg>`
- CSS/GSAP: `stroke-dashoffset` animated from 100 to 0 (draw effect)
- Scroll trigger: animation triggered when icon enters viewport
- Fill animation: color animated via GSAP `.to(path, { fill: 'newColor' })`

**Real 2026 examples:**
- **Feature lists** (SaaS landing pages) – icon draws in as you scroll
- **Timeline infographics** – milestone icons animate on scroll
- **Icon showcase sites** – animated icon reveals

**Technique class:**  
CSS `@keyframes` + `animation-timeline: view()` (native) | GSAP ScrollTrigger on SVG paths | Lottie SVG icons (designer-authored)

**Performance footprint:**  
**Light** – SVG rendering efficient.

**Mobile behavior:**  
Excellent mobile support.

**Elementor authoring:**
- **V3/Pro:** SVG widget + custom CSS stroke animation
- **V4:** SVG atomic element with scroll trigger

---

### 38. Counter Animations (Number Increment)

**Visual description:**  
Numbers animate from 0 to target value when element enters viewport. Often paired with "$", "K", "M" units. Commonly used for statistics, metrics, testimonial counts.

**Detection signals:**
- HTML: `<span class="counter" data-target="1000">0</span>`
- JavaScript: `setInterval` or `requestAnimationFrame` incrementing text content
- Libraries: CountUp.js, AOS counter support
- GSAP: `{ value: 0, onUpdate() { ... } }` for smooth counting
- Trigger: Intersection Observer or ScrollTrigger

**Real 2026 examples:**
- **SaaS metrics sections** – animated stat counters
- **Testimonial cards** – "Rated 4.9 out of 5" counters
- **Portfolio statistics** – project/client count animations

**Technique class:**  
CountUp.js library | GSAP tweening numeric values | JavaScript `setInterval` (simple, janky) | CSS counters (limited to integer CSS values)

**Performance footprint:**  
**Light** – minimal impact.

**Mobile behavior:**  
Full mobile support.

**Elementor authoring:**
- **V3/Pro:** Text widget with counter JavaScript via footer script
- **Not fully native**
- **Workaround:** CountUp.js embed or custom counter JS

---

### 39. View Transitions API (Chrome 111+, Cross-Document)

**Visual description:**  
Seamless animated transition between pages (MPAs) or views (SPAs). Browser captures old page state, updates DOM, animates transition. Modern W3C standard replacing older transition techniques. Zero JavaScript required (opt-in via CSS).

**Detection signals:**
- CSS: `@view-transition { navigation: auto; }` (opt-in)
- JavaScript (SPA): `document.startViewTransition(() => { /* DOM update */ })`
- Chrome DevTools: View Transitions panel shows transition details
- Header: `Supports: navigation-transitions` (server-side opt-in)
- Browser support: Chrome 111+, Edge 111+; Safari/Firefox in development

**Real 2026 examples:**
- **Modern next-gen SPAs** – smooth client-side route transitions
- **E-commerce** – product detail page transitions with grid item expanding
- **Portfolio navigation** – project card transitions to full project page

**Technique class:**  
CSS `@view-transition` + native browser API (modern, recommended) | GSAP + Barba.js (legacy, still used) | Framer Motion page transitions | Custom CSS animations

**Performance footprint:**  
**Light** – browser-optimized, hardware-accelerated.

**Mobile behavior:**  
Chrome Android supports. iOS Safari in development.

**Elementor authoring:**
- **Not yet native to Elementor**
- **Future:** Plugin support likely in Elementor 4.2+
- **Current workaround:** Custom header/footer code for MPA opt-in; SPA difficult without custom JS

---

## Implementation Reference: Quick Lookup Table

| Effect Name | Detection Signal | V3 Free? | V3 Pro? | V4 Atomic? | Custom CSS? | Library Embed? |
|---|---|---|---|---|---|---|
| **Parallax (bg-attachment)** | `background-attachment: fixed` | ❌ | ❌ | ⏳ | ✅ | ✅ |
| **Multi-layer Parallax** | `transform: translateY()` × 3+ | ❌ | ✅* | ✅ | ✅ | ✅ |
| **Scroll Reveals** | `data-aos="fade-up"` | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Pinned Sections** | `position: sticky; top: 0` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Scrollytelling** | Video + scroll sync | ❌ | ❌ | ⏳ | ✅ | ✅ |
| **Horizontal Scroll** | `transform: translateX()` | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Video Scrubbing** | `video.currentTime = scrollY` | ❌ | ❌ | ⏳ | ✅ | ✅ |
| **Stacking Cards** | `position: sticky` × N | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| **Marquee Text** | `@keyframes infinite` | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Magnetic Cursor** | `mousemove` + transform | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Cursor Blob** | `position: fixed; pointer-events: none` | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Tilt-on-Hover** | `rotateX/Y` + mouse tracking | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Liquid Distortion** | `MorphSVG` or WebGL shader | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Image Swap** | `background-image: url(new)` | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Hover Gradient Mesh** | `radial-gradient(at var(--x))` | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Text Underline** | `::after { scaleX: 0→1 }` | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Blur Adjacent Items** | `filter: blur()` on `:hover ~` | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **3D Card Flip** | `rotateY(180deg)` + preserve-3d | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Three.js Scene** | Canvas + `import THREE` | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Mouse Parallax 3D** | `perspective + mouse offset` | ❌ | ✅ | ✅ | ✅ | ✅ |
| **WebGL Shaders** | GLSL fragment shader code | ❌ | ❌ | ❌ | ✅ | ✅ |
| **3D Model Viewer** | `.glb/.gltf` + GLTFLoader | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Variable Font Anim** | `font-variation-settings` | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Split-Text Reveal** | `SplitText` per-character | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Mask-Reveal Text** | `clip-path` or SVG `<mask>` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Animated Gradient Text** | `background-clip: text` | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Drag-to-Scroll Gallery** | `scroll-snap-type: x` or Swiper | ⚠️ | ⚠️ | ✅ | ✅ | ✅ |
| **Modal with Thumbnails** | Swiper Thumbs gallery | ❌ | ❌ | ⚠️ | ✅ | ✅ |
| **Lottie Animations** | `lottie.loadAnimation()` | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Particle Backgrounds** | Canvas + tsparticles | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Noise/Grain Overlay** | SVG filter or PNG texture | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Glassmorphism** | `backdrop-filter: blur()` | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Liquid Blobs** | SVG `MorphSVG` path | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Smooth Scroll (Lenis)** | Lenis library | ❌ | ❌ | ❌ | ✅ | ✅ |
| **SVG Icon Animations** | `stroke-dashoffset` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Counter Animations** | CountUp.js or JS `setInterval` | ❌ | ❌ | ❌ | ✅ | ✅ |
| **View Transitions API** | `@view-transition` CSS | ❌ | ❌ | ⏳ | ✅ | ⏳ |

**Legend:**
- ✅ = Native, straightforward support
- ⚠️ = Partial support or requires minor setup
- ❌ = Not natively supported; requires custom code
- ⏳ = Planned, in development, or upcoming version

---

## Performance & Mobile Optimization Checklist

When implementing any effect:

### Desktop
- [ ] Target 60 FPS on modern browsers (Chrome 100+, Safari 14+, Edge 100+)
- [ ] Use GPU-accelerated properties: `transform`, `opacity` (avoid `top`, `left`, `width`, `height`)
- [ ] Test on high-refresh displays (120 Hz, 144 Hz)
- [ ] Profile with Chrome DevTools Performance tab

### Mobile
- [ ] Reduce particle counts, animation iteration counts
- [ ] Disable heavy effects (WebGL shaders, 3D transforms) on low-power devices
- [ ] Respect `prefers-reduced-motion` media query
- [ ] Use Intersection Observer to pause animations when offscreen
- [ ] Test on actual devices (iPhone 12, Samsung Galaxy A50 representative)

### Accessibility
- [ ] Always check `@media (prefers-reduced-motion: reduce)` and disable/simplify animations
- [ ] Ensure text remains readable under animated backgrounds
- [ ] Provide alt text for decorative animated SVGs
- [ ] Test with screen readers on animated page sections

---

## 2026 Trends Summary

**What's hot:**
1. **Bento grids + scroll reveals** – 67% of top 100 SaaS use this pattern
2. **Glassmorphism + particle backgrounds** – premium 2026 aesthetic
3. **Smooth scroll (Lenis)** – becoming table stakes for premium UX
4. **Variable font animations** – kinetic typography gaining traction
5. **Stacking cards + peel effects** – playful, tactile feel
6. **View Transitions API** – modern MPAs adopting cross-document transitions

**What's flat/declining:**
- Oversized parallax (skrollr-era heavy parallax) → subtle parallax
- Overly complex hover effects → purposeful micro-interactions
- Auto-playing video backgrounds → scroll-driven video

---

## Resources & Credits

Research based on live inspection of:
- Awwwards.com (May 2026 winners)
- FWA.com (Site of the Day features)
- Framer.com blog (parallax examples)
- Codrops.com (scroll-driven animations research)
- SchoolOfMotion.com (animation tutorials & trends)
- Motion.dev documentation (React motion library)
- GSAP docs (animation best practices)
- MDN & web.dev (CSS/Web Platform specs)
- Agency sites: Lusion, Active Theory, Unseen Studio, Basement, Locomotive

---

## Next Steps for Joist Clone Skill

To recognize and author these effects within Joist:

1. **Detection Phase:** Parse source HTML/CSS/JS for library imports and effect markers
2. **Taxonomy Mapping:** Match detected patterns to this taxonomy
3. **Fidelity Assessment:** Score each effect's implementability in Elementor (0–100%)
4. **Authoring Strategy:** Determine Elementor native vs. custom code approach
5. **Fallback Plan:** Define graceful degradation for unsupported effects

**Priority tier for Joist implementation:**
- **T1 (High ROI, easy):** Scroll reveals, sticky sections, parallax, hover underlines, image swap
- **T2 (Medium ROI):** Stacking cards, bento grids, counter animations, marquee
- **T3 (Lower ROI, complex):** Three.js scenes, WebGL shaders, magnetic cursors, Lottie (embed-only)

---

**Document compiled:** May 31, 2026  
**For:** Joist Clone Skill v0.9+  
**Author context:** AI agent taxonomy for motion design recognition in modern web design

