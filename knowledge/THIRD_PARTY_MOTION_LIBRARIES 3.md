# Third-Party Motion & Animation Libraries for Elementor

> **Purpose**: Reference guide for embedding JavaScript motion, 3D, and animation libraries into Elementor pages via the HTML widget. When custom CSS alone can't achieve an effect (GSAP, Three.js, Lottie, Lenis, Splitting, Swiper, etc.), these libraries can theoretically work because Elementor's HTML widget supports arbitrary `<script>` tags.

> **Scope**: For Joist clone fidelity improvement and designer capablity expansion. Currently, Joist's clone skill caps at low fidelity (~75%) on sites using advanced motion libraries because these aren't native Elementor capabilities.

---

## Table of Contents

1. [Lifecycle & Integration Strategy](#lifecycle--integration-strategy)
2. [Animation & Scroll Libraries](#animation--scroll-libraries)
3. [Typography Animation](#typography-animation)
4. [3D & WebGL](#3d--webgl)
5. [Hover & Interactive Effects](#hover--interactive-effects)
6. [Vector Animations & Lottie](#vector-animations--lottie)
7. [Carousels & Sliders](#carousels--sliders)
8. [Particle & Background Effects](#particle--background-effects)
9. [Utility & Specialized](#utility--specialized)
10. [When to Use What Matrix](#when-to-use-what-matrix)
11. [Performance & Mobile Checklist](#performance--mobile-checklist)

---

## Lifecycle & Integration Strategy

### DOM Lifecycle in Elementor

Elementor uses a custom frontend rendering pipeline. Libraries need to account for:

1. **DOMContentLoaded** — fires when the initial HTML is parsed. Widgets exist but may not be fully rendered.
2. **elementor/frontend/init** — custom Elementor event fired after frontend scripts load and the page is ready. **Use this for most libraries.**
3. **Elementor widget-render events** — individual widgets emit events on render (advanced use).

### Integration Patterns

**Pattern A: Wait for Elementor Frontend Init (Recommended)**

```html
<script src="https://cdn.jsdelivr.net/npm/library@version/dist/library.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    // Initialize library here
    // Elementor widgets are now ready
  });
</script>
```

**Pattern B: Fallback to DOMContentLoaded (for libs that don't wait)**

```html
<script src="https://cdn.jsdelivr.net/npm/library@version/dist/library.min.js"></script>
<script>
  document.addEventListener('DOMContentLoaded', function() {
    // Initialize library
  });
</script>
```

**Pattern C: Vanilla Script Tag (for auto-executing libs)**

Some libraries (like Splitting.js or lottie-player web component) work with just a script tag and HTML attributes. No explicit init code needed.

### Important Gotchas

- **Elementor renders widgets via JS.** If your script runs before Elementor finishes rendering, selectors won't find elements. Always use `elementor/frontend/init` or ensure DOMContentLoaded fires after Elementor's own scripts.
- **CSS Transforms create stacking context.** Libraries that use fixed positioning (e.g., ScrollSmoother with fixed headers) must place fixed elements outside the main content wrapper.
- **Mobile touch events.** Touch libraries (Swiper, Atropos, vanilla-tilt) must explicitly handle both mouse and touch. Check `pointer-events` support.
- **Prefers-reduced-motion.** Respect `prefers-reduced-motion: reduce` for accessibility. Many animation libraries offer this natively.

---

## Animation & Scroll Libraries

### GSAP (GreenSock Animation Platform)

**Version:** 3.15.x  
**CDN:** `https://cdn.jsdelivr.net/npm/gsap@3.15.5/dist/gsap.min.js`  
**What it does:** Industry-standard JavaScript animation library. Animates CSS properties, attributes, SVGs, canvas, and custom objects with precise timing, easing, and callbacks.

**Effect classes enabled:**
- Fade in/out (opacity)
- Slide/translate (x, y)
- Scale (scale)
- Rotate (rotation)
- Stagger (sequential element delays)
- Keyframe sequences

**Integration template:**

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.5/dist/gsap.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    // Simple fade-in on load
    gsap.from('.my-element', {
      duration: 1,
      opacity: 0,
      y: 20
    });
  });
</script>
```

**DOM lifecycle gotcha:** GSAP can run immediately on DOMContentLoaded, but if targeting Elementor widgets, wait for `elementor/frontend/init` to ensure the widget HTML is final.

**Mobile/touch:** GSAP itself has no touch dependencies. Works on all devices. However, scroll-triggered effects need ScrollTrigger plugin (see below).

**Performance budget:** ~30 KB minified gzipped. Lightweight for what it offers. Timeline objects are memory-efficient.

**Common conflicts:**
- **Elementor Pro animations** — both try to animate the same properties. Order matters; GSAP will override Pro settings if it runs after Pro's init.
- **jQuery (legacy)** — GSAP is framework-agnostic and doesn't conflict with jQuery.
- **CSS animations** — GSAP takes precedence if both run on same element.

---

### GSAP ScrollTrigger

**Version:** 3.15.x (included in GSAP suite)  
**CDN:** `https://cdn.jsdelivr.net/npm/gsap@3.15.5/dist/ScrollTrigger.min.js` (load after GSAP core)  
**What it does:** Scroll-driven animations. Pins elements, scrubs timelines to scroll position, reveals on scroll, parallax, and more.

**Effect classes enabled:**
- Reveal on scroll (fade + translate)
- Pin sections (sticky scroll)
- Parallax (speed multiplier based on scroll)
- Scrub timeline (animation progress = scroll progress)
- Snap to sections
- Horizontal scroll sequences

**Integration template:**

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.5/dist/ScrollTrigger.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    gsap.registerPlugin(ScrollTrigger);
    
    // Reveal on scroll pattern
    gsap.utils.toArray('.reveal-on-scroll').forEach(el => {
      gsap.from(el, {
        scrollTrigger: {
          trigger: el,
          start: 'top 80%',
          end: 'top 20%',
          markers: false // set true for debugging
        },
        duration: 0.8,
        opacity: 0,
        y: 60
      });
    });
  });
</script>
```

**DOM lifecycle gotcha:** ScrollTrigger calculates scroll positions on init. If DOM changes after init (rare in Elementor), call `ScrollTrigger.refresh()` to recalculate.

**Mobile/touch:** Works on mobile with native scroll. High-performance because it only watches scroll position, not element visibility during scroll.

**Performance budget:** ~20 KB. Uses requestAnimationFrame for 60fps animations. Heavy parallax on many elements can cause jank; limit to 3-5 per viewport.

**Common conflicts:**
- **Smooth scroll libraries (Lenis)** — ScrollTrigger hooks into native `window.scrollY`. If Lenis intercepts scroll, ScrollTrigger may desync. Solution: use Lenis with ScrollTrigger-aware config.
- **Position sticky** — ScrollTrigger's pin uses CSS transforms; sticky elements may not work as expected in the same space.
- **Elementor Pro Motion Effects** — Elementor Pro includes its own scroll animations. They can conflict if both target the same element. Best practice: use one OR the other per element.

---

### GSAP ScrollSmoother

**Version:** 3.15.x (premium, but documented)  
**License:** Requires GSAP Club membership (or use free alternative Lenis)  
**CDN:** Not on free CDN; requires npm/import or GSAP's hosting  
**What it does:** Native-feeling smooth scroll with parallax support via `data-speed` attributes. Alternative to Lenis for those in GSAP ecosystem.

**Effect classes enabled:**
- Smooth scroll
- Parallax (data-speed multiplier)
- Lag/catch-up effect (data-lag)

**DOM structure required:**

```html
<div id="smooth-wrapper">
  <div id="smooth-content">
    <!-- All page content here -->
  </div>
</div>
```

**Integration template:**

```html
<!-- Only works via npm/import for Elementor; not recommended for HTML widget -->
<!-- If using: -->
<script>
  document.addEventListener('elementor/frontend/init', function() {
    gsap.registerPlugin(ScrollTrigger, ScrollSmoother);
    ScrollSmoother.create({
      smooth: 1,
      effects: true,
      normalizeScroll: true,
      smoothTouch: 0.1
    });
  });
</script>
```

**Gotcha for Elementor:** ScrollSmoother requires wrapping the entire page in a special container. Elementor's page structure isn't designed for this. **Not recommended for Elementor integration.** Use Lenis instead.

**Alternative:** See Lenis below.

---

### Lenis (Smooth Scroll)

**Version:** 0.9.x  
**CDN:** `https://cdn.jsdelivr.net/npm/@studio-freight/lenis@latest/dist/lenis.min.js`  
**What it does:** Free, lightweight smooth scroll library. No dependencies. Intercepts native scroll and applies easing. Perfectly compatible with ScrollTrigger.

**Effect classes enabled:**
- Smooth scroll (with easing)
- Native scroll integration (works with scrollbar, wheel, keyboard)

**Integration template:**

```html
<script src="https://cdn.jsdelivr.net/npm/@studio-freight/lenis@latest/dist/lenis.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    const lenis = new Lenis({
      duration: 1.2,
      easing: function(t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
      direction: 'vertical',
      gestureDirection: 'vertical',
      smooth: true,
      smoothTouch: false,
      touchMultiplier: 2
    });

    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    // Optional: integrate with ScrollTrigger
    if (window.ScrollTrigger) {
      gsap.registerPlugin(ScrollTrigger);
      lenis.on('scroll', ScrollTrigger.update);
      ScrollTrigger.defaults({ scroller: window });
    }
  });
</script>
```

**DOM lifecycle gotcha:** Lenis hijacks scroll events. If other scripts read `window.scrollY` before Lenis is init, they'll get stale values. Always init Lenis early.

**Mobile/touch:** Excellent mobile support. Handles touch gestures naturally. `touchMultiplier` controls sensitivity.

**Performance budget:** ~8 KB minified. Uses requestAnimationFrame, so no jank. Very efficient.

**Common conflicts:**
- **ScrollTrigger** — actually compatible if initialized together (see template above).
- **Native scroll listeners** — libraries listening to `scroll` event directly should work fine; Lenis fires scroll events.
- **CSS scroll-behavior: smooth** — Lenis will override. Remove CSS smooth scroll if using Lenis.

---

### AOS (Animate on Scroll)

**Version:** 2.3.1  
**CDN (CSS):** `https://unpkg.com/aos@2.3.1/dist/aos.css`  
**CDN (JS):** `https://unpkg.com/aos@2.3.1/dist/aos.js`  
**What it does:** Lightweight, zero-dependency library. Reveals elements with animations as they scroll into view. Very beginner-friendly.

**Effect classes enabled:**
- Fade (up, down, left, right, in)
- Flip (horizontal, vertical)
- Zoom (in, out)
- Bounce
- Slide (up, down, left, right)

**Integration template:**

```html
<link rel="stylesheet" href="https://unpkg.com/aos@2.3.1/dist/aos.css" />
<script src="https://unpkg.com/aos@2.3.1/dist/aos.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    AOS.init({
      duration: 800,
      easing: 'ease-in-out-quad',
      once: true,
      offset: 120
    });
  });
</script>

<!-- Apply to any element: -->
<!-- <div class="my-element" data-aos="fade-up" data-aos-duration="1000"></div> -->
```

**DOM lifecycle gotcha:** AOS scans for `data-aos` attributes on init. If elements are added dynamically after init, call `AOS.refreshHard()` to detect them.

**Mobile/touch:** Very mobile-friendly. No touch interactions needed; just scroll-triggered.

**Performance budget:** ~7 KB minified. Very lightweight. Uses Intersection Observer API under the hood for efficiency.

**Common conflicts:**
- **Lottie** — no conflicts, different purposes.
- **GSAP** — both can animate the same element. AOS is simpler; GSAP is more powerful. Choose one per element to avoid double-animation.

---

### ScrollReveal.js

**Version:** 4.x  
**CDN:** `https://unpkg.com/scrollreveal@4.1.1/dist/scrollreveal.min.js`  
**What it does:** Similar to AOS but with more granular control. Reveals elements on scroll with configurable stagger, delay, and easing.

**Effect classes enabled:**
- Fade (opacity only or with transform)
- Slide + rotate
- Scale
- Stagger (sequential reveals)

**Integration template:**

```html
<script src="https://unpkg.com/scrollreveal@4.1.1/dist/scrollreveal.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    ScrollReveal().reveal('.reveal-element', {
      delay: 200,
      distance: '50px',
      duration: 1000,
      easing: 'cubic-bezier(0.645, 0.045, 0.355, 1)',
      origin: 'bottom',
      interval: 100,
      reset: false
    });
  });
</script>
```

**DOM lifecycle gotcha:** Like AOS, ScrollReveal scans the DOM on init. Call `ScrollReveal().sync()` after dynamic content changes.

**Mobile/touch:** Mobile-friendly. Scroll-only, no touch gestures.

**Performance budget:** ~11 KB minified. Efficient with Intersection Observer.

**Common conflicts:**
- **AOS** — very similar purpose. Use one or the other.
- **Parallel animations** — ScrollReveal and GSAP can work together if they target different elements.

---

## Typography Animation

### Splitting.js

**Version:** 0.0.4  
**CDN:** `https://cdn.jsdelivr.net/npm/splitting@latest/dist/splitting.min.js`  
**What it does:** Splits text, images, and grids into sub-elements (`<span>`s with CSS variables). Enables per-character, per-word, per-line, or per-image animations. Extremely powerful for typography.

**Effect classes enabled:**
- Per-character fade/slide/scale
- Per-word stagger
- Per-line effects
- Grid layouts
- Image grid effects

**Integration template:**

```html
<script src="https://cdn.jsdelivr.net/npm/splitting@latest/dist/splitting.min.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/splitting@latest/dist/splitting.css" />
<script>
  document.addEventListener('elementor/frontend/init', function() {
    // Split all elements with data-splitting attribute
    Splitting();
    
    // Animate each character
    gsap.from('[data-splitting] .char', {
      duration: 0.8,
      opacity: 0,
      y: 10,
      stagger: 0.05,
      delay: 0.2
    });
  });
</script>

<!-- In HTML: -->
<!-- <p data-splitting class="fancy-text">Hello World</p> -->
```

**DOM lifecycle gotcha:** Splitting() modifies the DOM. Call it after Elementor finishes rendering. Safe to call multiple times.

**Mobile/touch:** No touch interactions. Performance depends on number of characters/words being animated. Limit to <200 characters per animation on mobile.

**Performance budget:** ~3 KB. Splitting itself is tiny. The animation performance depends on how many animated elements you create. Each character becomes a DOM node; 1000 characters = 1000 animated elements = potential jank.

**Common conflicts:**
- **Text editors** — don't use Splitting on contenteditable or user-editable text. It breaks the editor.
- **Kerning/typography** — because Splitting wraps text in spans, custom font kerning may shift. Test on target font.

---

### SplitType

**Version:** Latest (npm: `split-type`)  
**CDN:** `https://cdn.jsdelivr.net/npm/split-type@0.3.5/umd/index.min.js`  
**What it does:** Modern alternative to Splitting.js. Splits text by character, word, or line with similar CSS variable support. Lighter-weight than Splitting.

**Effect classes enabled:**
- Per-character/word/line effects
- Cleaner DOM structure than Splitting

**Integration template:**

```html
<script src="https://cdn.jsdelivr.net/npm/split-type@0.3.5/umd/index.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    const split = new SplitType('.my-text', { types: 'chars' });
    
    gsap.from(split.chars, {
      duration: 0.8,
      opacity: 0,
      y: 20,
      stagger: 0.05
    });
  });
</script>
```

**DOM lifecycle gotcha:** SplitType modifies the DOM. Store the instance to access `.chars`, `.words`, `.lines` arrays.

**Mobile/touch:** Similar to Splitting. Watch DOM size.

**Performance budget:** ~2 KB. Slightly lighter than Splitting.

**Common conflicts:** Same as Splitting.js (text editors, kerning).

---

### Typed.js

**Version:** 3.0.0 (Jan 2026)  
**CDN:** `https://unpkg.com/typed.js@3.0.0/dist/typed.umd.js`  
**What it does:** Typing animation. Animates a string character-by-character, with optional backspace, loops, and pauses mid-string.

**Effect classes enabled:**
- Typing animation
- Backspace (remove chars)
- Pause mid-string
- Loop sequences
- Cursor animation

**Integration template:**

```html
<script src="https://unpkg.com/typed.js@3.0.0/dist/typed.umd.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    const typed = new Typed('.typing-element', {
      strings: [
        'Hello World',
        'Welcome to Elementor',
        'Amazing animations'
      ],
      typeSpeed: 50,
      backSpeed: 30,
      backDelay: 1000,
      startDelay: 500,
      loop: true,
      showCursor: true,
      cursorChar: '|'
    });
  });
</script>

<!-- HTML: -->
<!-- <div class="typing-element"></div> -->
```

**DOM lifecycle gotcha:** Typed replaces element innerHTML. Make sure the target element is empty or contains only placeholder text.

**Mobile/touch:** No touch interactions. Text output is standard DOM, works on all devices.

**Performance budget:** ~10 KB. Very efficient. Single interval loop.

**Common conflicts:**
- **Dynamic content** — don't use Typed on elements that might be updated by other scripts.
- **SSR/hydration** — if using with server-side rendering, manage hydration carefully.

---

## 3D & WebGL

### Three.js

**Version:** r164 (Dec 2024)  
**CDN:** `https://cdn.jsdelivr.net/npm/three@r164/build/three.min.js`  
**What it does:** Full-featured 3D graphics library using WebGL. Create 3D scenes, meshes, lighting, cameras, and complex 3D interactions in the browser.

**Effect classes enabled:**
- 3D mesh rendering
- 3D camera controls (orbit, first-person)
- Lighting (ambient, directional, point, spot)
- Post-processing effects (bloom, depth of field, SSAO)
- Animated 3D models (GLTF/FBX)
- Particle systems (3D)

**Integration template (minimal scene):**

```html
<div id="canvas-container" style="width: 100%; height: 400px;"></div>

<script src="https://cdn.jsdelivr.net/npm/three@r164/build/three.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    const container = document.getElementById('canvas-container');
    if (!container) return;
    
    // Scene setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0x000000, 0.1);
    container.appendChild(renderer.domElement);
    
    // Create a rotating cube
    const geometry = new THREE.BoxGeometry(2, 2, 2);
    const material = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    
    // Lighting
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(5, 5, 5);
    scene.add(light);
    
    camera.position.z = 5;
    
    // Animation loop
    function animate() {
      requestAnimationFrame(animate);
      mesh.rotation.x += 0.01;
      mesh.rotation.y += 0.01;
      renderer.render(scene, camera);
    }
    animate();
  });
</script>
```

**DOM lifecycle gotcha:** Three.js needs a container element. Ensure it exists before calling `renderer.setSize()`. Handle window resize for responsive scenes.

**Mobile/touch:** WebGL support varies. Test on target devices. Performance degrades with complex geometries on mobile. Use LOD (level of detail) for mobile.

**Performance budget:** ~600 KB (minified core). Heavy library. Load only on pages that use it. Consider lazy loading.

**Common conflicts:**
- **ScrollTrigger** — Three.js runs its own animation loop. If ScrollTrigger tries to pause/scrub it, manage both carefully.
- **Other canvas libraries** — don't mix Three.js with Babylon.js or Cesium on same page.
- **Mobile rendering** — reduce geometry complexity and texture resolution on mobile.

---

### Vanta.js

**Version:** Latest  
**CDN:** Depends on effect. See vantajs.com for per-effect CDN.  
**What it does:** Drop-in 3D animated backgrounds. Uses Three.js under the hood. Pre-built effects: WAVES, NET, FOG, DOTS, RINGS, etc. Very easy to use.

**Effect classes enabled:**
- 3D animated backgrounds (WAVES, NET, FOG, DOTS, RINGS, RINGS_GRADIENT, TRUNK, TOPOLOGY)
- Interactive (hover/mouse moves background)
- Parallax (subtle 3D depth)

**Integration template (WAVES effect):**

```html
<div id="vanta-background" style="width: 100%; height: 400px;"></div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/vanta@latest/dist/vanta.waves.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    VANTA.WAVES({
      el: '#vanta-background',
      mouseControls: true,
      touchControls: true,
      gyroControls: false,
      minHeight: 200.0,
      minWidth: 200.0,
      scale: 1.0,
      scaleMobile: 1.0,
      color: 0x1e90ff,
      shininess: 100.0,
      waveHeight: 15.0,
      waveSpeed: 1.0,
      zoom: 0.75
    });
  });
</script>
```

**DOM lifecycle gotcha:** Vanta hijacks the target container. Don't nest other elements inside unless absolutely necessary. Vanta may re-render and discard child elements.

**Mobile/touch:** Mobile compatibility varies by effect. NET and TOPOLOGY are heavier. DOTS is lighter. Test on target devices. Set `scaleMobile` to reduce resolution on mobile.

**Performance budget:** ~2-3 MB including Three.js. Very heavy. Use only one Vanta effect per page. Load lazily if not immediately visible.

**Common conflicts:**
- **ScrollTrigger** — Vanta runs continuously. If using ScrollTrigger to animate Vanta intensity, manage the two animation loops carefully.
- **Other Three.js effects** — don't mix Vanta with custom Three.js on same page.
- **Mobile performance** — test extensively. Vanta can kill mobile UX if not optimized.

---

### OGL (Minimalist WebGL)

**Version:** Latest (git-based)  
**CDN:** Not commonly CDN-served. Use npm or bundle.  
**What it does:** Lightweight WebGL library. More minimal than Three.js but still powerful. Used by high-performance creative studios.

**Effect classes enabled:**
- 3D rendering (simpler API than Three.js)
- Shader support
- Lightweight post-processing

**Integration template:**

```html
<!-- OGL is best used via npm/bundler, not CDN. Skip for Elementor HTML widget. -->
<!-- If you need it: use Three.js or Vanta instead. -->
```

**Recommendation for Elementor:** OGL lacks good CDN distribution and is harder to set up in an HTML widget. Use Three.js or Vanta instead.

---

## Hover & Interactive Effects

### Vanilla Tilt

**Version:** 1.8.0  
**CDN:** `https://cdn.jsdelivr.net/npm/vanilla-tilt@1.8.0/dist/vanilla-tilt.min.js`  
**What it does:** 3D tilt effect on mouse hover. Element tilts toward mouse cursor. Very popular for product showcases.

**Effect classes enabled:**
- 3D tilt on hover
- Parallax layers (nested elements)
- Mouse-tracked depth

**Integration template:**

```html
<div class="tilt-element" style="width: 300px; height: 400px; background: linear-gradient(45deg, #667eea 0%, #764ba2 100%);">
  <h3>Hover me!</h3>
</div>

<script src="https://cdn.jsdelivr.net/npm/vanilla-tilt@1.8.0/dist/vanilla-tilt.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    VanillaTilt.init(document.querySelector('.tilt-element'), {
      max: 25,
      scale: 1.05,
      speed: 400,
      transition: true,
      easing: 'cubic-bezier(.03,.98,.52,.99)'
    });
  });
</script>
```

**DOM lifecycle gotcha:** Vanilla Tilt attaches to specific elements. Use a class or data attribute and init all matching elements.

**Mobile/touch:** Vanilla Tilt supports touch via device orientation (gyroscope). Disable on mobile if you prefer no effect: `disable: () => window.innerWidth < 768`.

**Performance budget:** ~3 KB. Very lightweight. Uses requestAnimationFrame for tilt angle updates.

**Common conflicts:**
- **Atropos.js** — similar purpose, choose one or the other.
- **CSS perspective** — Vanilla Tilt applies its own perspective transform. Ensure parent doesn't conflict.

---

### Atropos.js

**Version:** 2.0.2  
**CDN:** `https://cdn.jsdelivr.net/npm/atropos@2.0.2/umd/index.min.js`  
**What it does:** Modern alternative to Vanilla Tilt. 3D parallax hover effect with multiple layers. Zero dependencies. Slightly more polished than Vanilla Tilt.

**Effect classes enabled:**
- 3D parallax on hover/touch
- Multi-layer depth
- Responsive design

**Integration template:**

```html
<div class="atropos" style="width: 300px;">
  <div class="atropos-scale">
    <div class="atropos-rotate">
      <div class="atropos-inner" style="background: linear-gradient(45deg, #667eea 0%, #764ba2 100%); padding: 40px; text-align: center;">
        <h3>3D Parallax</h3>
        <p data-atropos-offset="5">Layer 1</p>
        <p data-atropos-offset="10">Layer 2</p>
      </div>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/atropos@2.0.2/umd/index.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    Atropos({
      el: '.atropos',
      rotateTouch: true,
      shadow: true,
      shadowOffset: 40,
      shadowScale: 1.2,
      highlight: true,
      nft: false,
      rotateXMax: 15,
      rotateYMax: 15,
      rotateZMax: 8
    });
  });
</script>
```

**DOM lifecycle gotcha:** Atropos requires specific DOM structure with `.atropos-scale` and `.atropos-rotate` wrapper divs. Follow the template exactly.

**Mobile/touch:** Excellent mobile support via touch and device orientation (gyroscope). Touch works as well as mouse hover.

**Performance budget:** ~2 KB. Minimal dependencies. Very efficient.

**Common conflicts:**
- **Vanilla Tilt** — similar effect, choose one.
- **CSS 3D transforms** — Atropos applies transforms; ensure parent transform doesn't override.

---

## Vector Animations & Lottie

### Lottie-web

**Version:** 5.12.2  
**CDN:** `https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js`  
**What it does:** Renders Adobe After Effects animations as JSON in the browser. Lightweight, scalable vector animations. Source: lottie.airbnb.tech

**Effect classes enabled:**
- Complex animated sequences (created in After Effects)
- SVG rendering
- Loop, reverse, speed control
- Segment playback (play only frame X-Y)

**Integration template:**

```html
<div id="lottie-container" style="width: 300px; height: 300px;"></div>

<script src="https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    const animation = lottie.loadAnimation({
      container: document.getElementById('lottie-container'),
      renderer: 'svg',
      loop: true,
      autoplay: true,
      path: 'https://example.com/animations/animation.json' // URL to exported Bodymovin JSON
    });
    
    // Optional: control via code
    animation.setSpeed(0.5); // half speed
    // animation.pause();
    // animation.play();
  });
</script>
```

**DOM lifecycle gotcha:** Lottie needs the container to exist and be rendered before init. Use `elementor/frontend/init` to ensure timing.

**Mobile/touch:** Excellent mobile performance. SVG rendering is GPU-accelerated. Canvas rendering available as fallback.

**Performance budget:** ~80 KB for lottie-web. Animation file size depends on complexity; typically 10-50 KB per animation.

**Common conflicts:**
- **Canvas libraries** — lottie-web defaults to SVG; switch to canvas if needed for complex layers.
- **Scroll animations** — can trigger Lottie to play on scroll via ScrollTrigger's `onUpdate` callback.

---

### Lottie-player Web Component

**Version:** 2.0.1 (deprecated; migrate to @lottiefiles/dotlottie-wc)  
**CDN:** `https://unpkg.com/@lottiefiles/lottie-player@latest/dist/lottie-player.js`  
**What it does:** Web component wrapper around Lottie. Drop-in `<lottie-player>` element. No JavaScript needed for basic use.

**Effect classes enabled:** Same as lottie-web (Lottie animations from After Effects).

**Integration template (simplest form):**

```html
<script src="https://unpkg.com/@lottiefiles/lottie-player@latest/dist/lottie-player.js"></script>

<lottie-player
  autoplay
  controls
  loop
  src="https://assets3.lottiefiles.com/packages/lf20_UJNc2t.json"
  style="width: 100%; height: 400px;">
</lottie-player>
```

**No JavaScript init needed** — the web component handles everything via attributes.

**DOM lifecycle gotcha:** Web component takes a moment to upgrade. Safe to use in Elementor HTML widget; doesn't need special event timing.

**Mobile/touch:** Works great on mobile. Respects user's device orientation.

**Performance budget:** ~15 KB for the web component + animation JSON file.

**Common conflicts:** None significant. Can coexist with lottie-web on the same page.

**Deprecation note:** The old `@lottiefiles/lottie-player` is deprecated. New projects should use `@lottiefiles/dotlottie-wc`. For Elementor, the old version still works; upgrade when convenient.

---

### Anime.js

**Version:** 4.0.0  
**CDN:** `https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js`  
**What it does:** General-purpose animation library with timeline, stagger, SVG morphing, draggable, and scroll observer. More versatile than Lottie but requires manual animation authoring.

**Effect classes enabled:**
- Custom keyframe animations
- SVG morphing
- Stagger effects
- Draggable elements
- Scroll observer (scroll-linked animation)
- Complex timeline sequences

**Integration template:**

```html
<svg id="morph-svg" width="100" height="100" viewBox="0 0 100 100">
  <path id="morph-path" d="M 50, 50 m -40, 0 a 40,40 0 1,0 80,0 a 40,40 0 1,0 -80,0" fill="none" stroke="blue" stroke-width="2"></path>
</svg>

<script src="https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    anime.timeline()
      .add({
        targets: '#morph-path',
        strokeDashoffset: [anime.setDashoffset, 0],
        easing: 'easeInOutQuad',
        duration: 1500,
        delay: 250
      });
  });
</script>
```

**DOM lifecycle gotcha:** Anime.js targets elements by selector. Ensure elements exist before running anime().

**Mobile/touch:** No inherent touch support, but can be combined with touch listeners.

**Performance budget:** ~15 KB. Efficient timeline system.

**Common conflicts:**
- **GSAP** — both can animate the same elements. Avoid double-animation.
- **Scroll animations** — use Anime's `.add()` with ScrollTrigger for scroll-linked timelines.

---

### Motion One

**Version:** 12.40.0 (primarily React, but JS version exists)  
**CDN:** `https://cdn.jsdelivr.net/npm/motion@12.40.0/dist/index.es.min.js`  
**What it does:** Modern animation library by Framer. Lighter than GSAP for simple use cases. Hybrid JS + CSS acceleration. Strong focus on React but works with vanilla JS.

**Effect classes enabled:**
- Lightweight animations
- Spring physics
- Stagger
- Gesture-driven (hover, drag)
- Variants and timeline sequences

**Integration template (vanilla JS):**

```html
<div id="animated-box" style="width: 100px; height: 100px; background: blue;"></div>

<script src="https://cdn.jsdelivr.net/npm/motion@12.40.0/dist/index.es.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    const box = document.getElementById('animated-box');
    
    // Using Motion API
    motion.animate(box, { x: 100, rotate: 90 }, { duration: 0.5 });
  });
</script>
```

**DOM lifecycle gotcha:** Motion runs on any element. No special timing required.

**Mobile/touch:** Excellent mobile performance. Uses GPU acceleration where possible.

**Performance budget:** ~30 KB. Lighter than GSAP for simple animations. Overkill if you only need one effect.

**Common conflicts:**
- **GSAP** — Motion has overlapping capabilities. Choose one based on animation complexity.
- **React** — Motion is designed for React; vanilla JS support is secondary.

---

## Carousels & Sliders

### Swiper.js

**Version:** 12.2.0 (May 2026)  
**CDN (CSS):** `https://cdn.jsdelivr.net/npm/swiper@12.2.0/swiper-bundle.min.css`  
**CDN (JS):** `https://cdn.jsdelivr.net/npm/swiper@12.2.0/swiper-bundle.min.js`  
**What it does:** Mobile-focused slider library. Supports touch, lazy loading, parallax, virtual slides, and more. Industry-standard for carousels.

**Effect classes enabled:**
- Carousel/slider
- Touch swipe
- Parallax transitions
- Lazy loading
- Pagination and navigation
- Keyboard control

**Integration template:**

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swiper@12.2.0/swiper-bundle.min.css" />

<div class="swiper">
  <div class="swiper-wrapper">
    <div class="swiper-slide"><img src="image1.jpg" /></div>
    <div class="swiper-slide"><img src="image2.jpg" /></div>
    <div class="swiper-slide"><img src="image3.jpg" /></div>
  </div>
  <div class="swiper-pagination"></div>
  <div class="swiper-button-prev"></div>
  <div class="swiper-button-next"></div>
</div>

<script src="https://cdn.jsdelivr.net/npm/swiper@12.2.0/swiper-bundle.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    const swiper = new Swiper('.swiper', {
      loop: true,
      pagination: { el: '.swiper-pagination' },
      navigation: {
        nextEl: '.swiper-button-next',
        prevEl: '.swiper-button-prev'
      },
      autoplay: { delay: 5000 },
      effect: 'slide' // or 'fade', 'cube', 'flip', 'coverflow', 'cards'
    });
  });
</script>
```

**DOM lifecycle gotcha:** Swiper needs the `.swiper-wrapper` and `.swiper-slide` structure to exist before init. If dynamically adding slides, call `swiper.update()`.

**Mobile/touch:** Excellent touch support. Native feel. Supports gesture multiplier for sensitivity.

**Performance budget:** ~50 KB. Includes all effects pre-loaded. Minify unused effects if you need to trim.

**Common conflicts:**
- **Elementor carousel widget** — Elementor Pro includes Swiper under the hood. Avoid mixing custom Swiper with Elementor's native carousel on the same page.
- **CSS scroll-snap** — Swiper and scroll-snap can conflict. Use one or the other.

---

### Embla Carousel

**Version:** Latest (npm: `embla-carousel`)  
**CDN:** `https://cdn.jsdelivr.net/npm/embla-carousel@latest/dist/embla-carousel.umd.min.js`  
**What it does:** Modern carousel library. Lightweight, highly extensible. Smooth animations, great mobile support, plugin-based.

**Effect classes enabled:**
- Carousel/slider
- Smooth transitions
- Plugin system (autoplay, dots, arrows, wheel scroll, etc.)

**Integration template:**

```html
<div class="embla">
  <div class="embla__viewport">
    <div class="embla__container">
      <div class="embla__slide">Slide 1</div>
      <div class="embla__slide">Slide 2</div>
      <div class="embla__slide">Slide 3</div>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/embla-carousel@latest/dist/embla-carousel.umd.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    const emblaNode = document.querySelector('.embla');
    const embla = EmblaCarousel(emblaNode, { loop: true });
    
    // Optional: add plugins
    // embla.on('settle', () => console.log('Slid'));
  });
</script>
```

**DOM lifecycle gotcha:** Embla works with the existing DOM structure. No special timing required.

**Mobile/touch:** Excellent mobile support. Very smooth swipe.

**Performance budget:** ~15 KB (core). Plugins add to size.

**Common conflicts:**
- **Swiper** — both are carousels; choose one per page.
- **Touch events** — if other touch listeners conflict, ensure Embla has priority.

---

### Glide.js

**Version:** 3.5.0  
**CDN (CSS):** `https://cdn.jsdelivr.net/npm/@glidejs/glide@latest/dist/glide.core.min.css`  
**CDN (JS):** `https://cdn.jsdelivr.net/npm/@glidejs/glide@latest/dist/glide.min.js`  
**What it does:** Lightweight, vanilla JS carousel. Minimal dependencies. Good for simple sliders.

**Effect classes enabled:**
- Basic carousel
- Touch swipe
- Autoplay
- Custom controls

**Integration template:**

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@glidejs/glide@latest/dist/glide.core.min.css" />

<div class="glide">
  <div class="glide__track" data-glide-el="track">
    <ul class="glide__slides">
      <li class="glide__slide">Slide 1</li>
      <li class="glide__slide">Slide 2</li>
      <li class="glide__slide">Slide 3</li>
    </ul>
  </div>
  <div class="glide__bullets" data-glide-el="controls[nav]">
    <button class="glide__bullet" data-glide-dir="=0"></button>
    <button class="glide__bullet" data-glide-dir="=1"></button>
    <button class="glide__bullet" data-glide-dir="=2"></button>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/@glidejs/glide@latest/dist/glide.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    new Glide('.glide', {
      type: 'carousel',
      startAt: 0,
      perView: 3,
      autoplay: 5000,
      gap: 20
    }).mount();
  });
</script>
```

**DOM lifecycle gotcha:** Glide parses `data-glide-el` attributes. Ensure structure matches the template.

**Mobile/touch:** Good touch support. Lighter than Swiper.

**Performance budget:** ~8 KB. Very lightweight.

**Common conflicts:**
- **Swiper / Embla** — choose one carousel library.
- **Responsive design** — Glide's `perView` is static. For responsive perView, manage with media queries outside Glide.

---

## Particle & Background Effects

### tsparticles

**Version:** Latest (npm: `tsparticles`)  
**CDN:** `https://cdn.jsdelivr.net/npm/tsparticles@2.12.0/tsparticles.bundle.min.js`  
**What it does:** Modern, highly flexible particle system library. Drop-in particle backgrounds with config. Successor to particles.js, much more powerful.

**Effect classes enabled:**
- Particle effects (circles, squares, images)
- Interactions (hover, click)
- Motion (random, straight, Perlin noise)
- Canvas or DOM rendering

**Integration template:**

```html
<div id="particles"></div>

<script src="https://cdn.jsdelivr.net/npm/tsparticles@2.12.0/tsparticles.bundle.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', async function() {
    await tsParticles.load('particles', {
      particles: {
        number: { value: 80 },
        color: { value: '#ffffff' },
        shape: { type: 'circle' },
        opacity: { value: 0.5 },
        size: { value: 3 },
        move: { enable: true, speed: 2 }
      },
      interactivity: {
        events: { onHover: { enable: true, mode: 'push' } }
      }
    });
  });
</script>
```

**DOM lifecycle gotcha:** tsparticles needs the container element to exist. Initialize after `elementor/frontend/init`.

**Mobile/touch:** Good mobile support. Reduce particle count on mobile for performance.

**Performance budget:** ~70 KB minified. Moderate overhead depending on particle count and effects.

**Common conflicts:**
- **Vanta.js** — both are background effects; choose one.
- **Multiple instances** — each particle container is separate; can have multiple on page if needed.

---

### particles.js

**Version:** 2.0.0  
**CDN:** `https://cdn.jsdelivr.net/npm/particles.js@2.0.0/particles.min.js`  
**What it does:** Classic particle system library. Similar to tsparticles but simpler/older. Still widely used.

**Effect classes enabled:**
- Particle effects
- Interactions (hover, click, grab)
- Configuration via JSON

**Integration template:**

```html
<div id="particles-js"></div>

<script src="https://cdn.jsdelivr.net/npm/particles.js@2.0.0/particles.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    particlesJS('particles-js', {
      particles: {
        number: { value: 80 },
        color: { value: '#ffffff' },
        shape: { type: 'circle' },
        opacity: { value: 0.5 },
        size: { value: 5 },
        move: { enable: true, speed: 2 }
      },
      interactivity: {
        detect_on: 'canvas',
        events: { onHover: { enable: true, mode: 'grab' } }
      }
    });
  });
</script>
```

**DOM lifecycle gotcha:** Like tsparticles, particles.js needs the container element.

**Mobile/touch:** Simpler than tsparticles; less optimized for mobile. Use sparingly on mobile.

**Performance budget:** ~40 KB. Lighter than tsparticles.

**Common conflicts:** Same as tsparticles.

**Note:** particles.js is older and less actively maintained. Prefer tsparticles for new projects.

---

## Utility & Specialized

### Headroom.js

**Version:** 0.12.0  
**CDN:** `https://cdn.jsdelivr.net/npm/headroom.js@0.12.0/dist/headroom.min.js`  
**What it does:** Hide/show header (or any element) based on scroll direction. Fades out when scrolling down, shows when scrolling up.

**Effect classes enabled:**
- Hide on scroll down
- Show on scroll up
- Pinning (keep element visible)

**Integration template:**

```html
<header id="my-header" class="headroom">
  <!-- Header content -->
</header>

<script src="https://cdn.jsdelivr.net/npm/headroom.js@0.12.0/dist/headroom.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    const header = document.getElementById('my-header');
    const headroom = new Headroom(header, {
      offset: 205,
      tolerance: 5,
      classes: {
        initial: 'headroom',
        pinned: 'headroom--pinned',
        unpinned: 'headroom--unpinned',
        top: 'headroom--top',
        notTop: 'headroom--not-top'
      }
    });
    headroom.init();
  });
</script>

<!-- CSS to handle show/hide: -->
<style>
  .headroom { transition: transform 0.2s ease-in-out; }
  .headroom--unpinned { transform: translateY(-100%); }
  .headroom--pinned { transform: translateY(0); }
</style>
```

**DOM lifecycle gotcha:** Headroom reads element height on init. If header height changes dynamically, call `headroom.destroy()` and reinit.

**Mobile/touch:** Works on mobile. Touch scroll is detected.

**Performance budget:** ~5 KB. Very lightweight.

**Common conflicts:**
- **Position sticky** — Headroom uses CSS transforms; sticky positioning may conflict. Use one or the other.

---

### Flickity

**Version:** 2.3.0  
**CDN (CSS):** `https://cdn.jsdelivr.net/npm/flickity@2.3.0/dist/flickity.min.css`  
**CDN (JS):** `https://cdn.jsdelivr.net/npm/flickity@2.3.0/dist/flickity.pkgd.min.js`  
**What it does:** Physics-based carousel with momentum. Touch gestures feel natural with inertia. Great for product galleries.

**Effect classes enabled:**
- Carousel with physics
- Draggable items
- Momentum-based scrolling
- Fade in/out on edges

**Integration template:**

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flickity@2.3.0/dist/flickity.min.css" />

<div class="carousel" data-flickity='{ "cellAlign": "left", "contain": true }'>
  <div class="carousel-cell">Slide 1</div>
  <div class="carousel-cell">Slide 2</div>
  <div class="carousel-cell">Slide 3</div>
</div>

<script src="https://cdn.jsdelivr.net/npm/flickity@2.3.0/dist/flickity.pkgd.min.js"></script>
<script>
  document.addEventListener('elementor/frontend/init', function() {
    // Flickity auto-initializes via data attribute, but explicit init:
    const carousel = document.querySelector('.carousel');
    const flicky = new Flickity(carousel, {
      cellAlign: 'left',
      contain: true,
      autoPlay: 5000
    });
  });
</script>
```

**DOM lifecycle gotcha:** Flickity can auto-init via `data-flickity` attribute. No explicit JS needed if using attribute.

**Mobile/touch:** Excellent touch support with momentum physics.

**Performance budget:** ~55 KB. Moderate size.

**Common conflicts:**
- **Other carousels** — choose one.
- **jQuery** — Flickity works with or without jQuery (it's included in `.pkgd` version).

**Licensing:** Flickity is open source (GPLv3) but available under commercial license. Check licensing for your project.

---

## When to Use What Matrix

| Effect Type | Recommended Library | Alternative | Notes |
|---|---|---|---|
| **Scroll-triggered fade/slide** | AOS or GSAP ScrollTrigger | ScrollReveal | ScrollTrigger more powerful but heavier |
| **Complex scroll animations** | GSAP + ScrollTrigger | Anime.js | GSAP is industry standard |
| **Smooth scroll** | Lenis | GSAP ScrollSmoother | Lenis is free; ScrollSmoother is premium |
| **Per-character animation** | Splitting.js + GSAP | SplitType | Both excellent; Splitting more mature |
| **Typing effect** | Typed.js | TypeIt | Typed.js newer and more maintained |
| **3D hover effect** | Atropos.js | Vanilla Tilt | Atropos more modern; Vanilla Tilt still solid |
| **3D rotating cube/object** | Three.js | OGL | Three.js more mature; OGL lighter |
| **3D animated background** | Vanta.js | Three.js + custom | Vanta easiest, but heavier |
| **Adobe AE animation** | Lottie-web or lottie-player | Anime.js (manual) | Lottie is standard for AE export |
| **Carousel/slider** | Swiper.js | Embla or Glide | Swiper most flexible; Glide lightest |
| **Particle background** | tsparticles | particles.js | tsparticles more modern; particles.js simpler |
| **Stagger/timeline sequences** | GSAP Timeline | Anime.js | GSAP more powerful |
| **General animations** | Motion One (simple) or GSAP (complex) | Anime.js | Motion lightweight; GSAP comprehensive |
| **Hide header on scroll** | Headroom.js | Custom + ScrollTrigger | Headroom simplest |
| **Parallax** | GSAP ScrollTrigger + data-speed | Locomotive Scroll (legacy) | ScrollTrigger most reliable |

---

## Performance & Mobile Checklist

### Bundle Size Summary

| Library | Minified Size | Common Use |
|---|---|---|
| GSAP Core | ~30 KB | Animation foundation |
| GSAP ScrollTrigger | ~20 KB | Scroll animations |
| Lenis | ~8 KB | Smooth scroll |
| AOS | ~7 KB | Scroll reveals |
| Splitting.js | ~3 KB | Text splitting |
| Typed.js | ~10 KB | Typing animation |
| Atropos.js | ~2 KB | 3D tilt |
| Vanilla Tilt | ~3 KB | 3D tilt (older) |
| Three.js | ~600 KB | Full 3D graphics |
| Vanta.js | ~2-3 KB (+ Three.js ~600 KB) | 3D backgrounds |
| Swiper.js | ~50 KB | Carousel |
| Embla Carousel | ~15 KB | Lightweight carousel |
| Glide.js | ~8 KB | Minimal carousel |
| tsparticles | ~70 KB | Particle system |
| particles.js | ~40 KB | Particle system (older) |
| Lottie-web | ~80 KB | AE animations |
| Anime.js | ~15 KB | General animation |
| Motion One | ~30 KB | Modern animation |
| Flickity | ~55 KB | Physics carousel |

### Mobile Performance Checklist

- [ ] **Test on real devices** — not just browser DevTools. Mobile performance varies greatly.
- [ ] **Reduce particle count** — tsparticles with 800 particles will tank on mobile. Limit to 50-100.
- [ ] **Disable heavy effects on mobile** — use `matchMedia` or viewport checks to skip initialization:
  ```javascript
  if (window.innerWidth < 768) { return; } // skip 3D effects
  ```
- [ ] **Respect prefers-reduced-motion** — honor user accessibility preferences:
  ```javascript
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { 
    // skip animations 
  }
  ```
- [ ] **Lazy load libraries** — don't load Three.js if no 3D on page:
  ```javascript
  if (document.querySelector('[data-three-js]')) {
    // load Three.js dynamically
  }
  ```
- [ ] **Limit simultaneous animations** — don't animate 100 elements at once. Stagger or batch.
- [ ] **Avoid rapid scroll events** — debounce custom scroll listeners:
  ```javascript
  function debounce(fn, delay) {
    let timeout; 
    return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => fn(...args), delay); };
  }
  ```
- [ ] **Test on slow networks** — use DevTools throttling. Large animation files (Lottie) may take seconds to load.
- [ ] **Monitor CPU usage** — on mobile, 60fps requires <16ms per frame. Use Chrome DevTools Performance tab.

### Common Performance Pitfalls

1. **Loading too many libraries.** GSAP + ScrollTrigger + Lenis + Swiper = ~100 KB. Be selective.
2. **Animating too many DOM elements.** Each animated element = more CPU. Limit to <50 per page.
3. **Heavy 3D on mobile.** Three.js + Vanta are WebGL-heavy. Test on low-end phones.
4. **Unoptimized Lottie animations.** Complex AE exports can be 200+ KB. Use LottieFiles' optimize tool.
5. **Blocking scroll with JavaScript.** If animation handler runs on every scroll event, it blocks the thread. Use passive listeners or throttle.

### Lazy-Loading Pattern

For libraries used conditionally, lazy-load them:

```javascript
document.addEventListener('elementor/frontend/init', async function() {
  // Only load GSAP if ScrollTrigger elements exist
  if (document.querySelector('[data-scroll-trigger]')) {
    const gsap = await import('https://cdn.jsdelivr.net/npm/gsap@3.15.5/dist/gsap.min.js');
    const ScrollTrigger = await import('https://cdn.jsdelivr.net/npm/gsap@3.15.5/dist/ScrollTrigger.min.js');
    gsap.registerPlugin(ScrollTrigger);
    // Initialize...
  }
});
```

---

## Elementor-Specific Integration Notes

### HTML Widget Limitations

1. **No direct Elementor widget styling** — HTML widget content isn't styled by Elementor's widget controls. Style via inline CSS or `<style>` tags in the widget.
2. **Script scope** — scripts in HTML widget run in global scope. Namespace your variables to avoid conflicts:
   ```javascript
   window.myAnimation = { init: () => { ... } };
   ```
3. **Refresh on edit** — if editing HTML widget, Elementor refreshes the page. Avoid losing state; reload data from DOM.

### Responsive Design in HTML Widget

Use CSS media queries within the widget to adjust library parameters:

```html
<div id="swiper-container" class="swiper"></div>

<style>
  @media (max-width: 768px) {
    #swiper-container { max-width: 100%; }
  }
</style>

<script>
  document.addEventListener('elementor/frontend/init', function() {
    const perView = window.innerWidth < 768 ? 1 : 3;
    new Swiper('.swiper', { perView });
  });
</script>
```

### Conflict with Elementor Pro

Elementor Pro includes built-in animation and carousel capabilities. If using those, avoid parallel animations:

- **Motion Effects** — if enabled on a widget, don't add GSAP animations to the same widget.
- **Carousel widget** — uses Swiper. Don't add custom Swiper to the same section.

Check Elementor's controls first before reaching for a third-party library.

---

## Summary & Recommendations

**For Joist Clone Skill Enhancement:**

1. **Prioritize scroll-triggered effects** — GSAP ScrollTrigger covers 80% of common site effects. Add support for library detection in clone analysis.
2. **Add Lottie detection** — many modern sites use Lottie. Clone skill should recognize `<lottie-player>` and Lottie JSON references.
3. **Support basic 3D** — Vanta WAVES and DOTS are common. Add fallback background color if Vanta load fails.
4. **Carousel handling** — Swiper.js is ubiquitous. Clone should recognize Swiper instances and port them to Elementor (via HTML widget + Swiper init).
5. **Avoid heavy 3D on clone** — Three.js and custom WebGL are too complex to clone reliably. Accept fidelity ceiling of ~80% for these.

**For Designers Using Joist:**

1. Use **Lottie** for complex animations (export from After Effects).
2. Use **GSAP ScrollTrigger** for scroll-driven effects (parallax, reveals, pin).
3. Use **Swiper.js** for carousels (matches Elementor Pro's Swiper under the hood).
4. Use **Atropos.js** for hover effects (lightweight, touch-friendly).
5. Use **Splitting.js + GSAP** for per-character animations.
6. Avoid **Three.js** unless absolutely necessary (too heavy, poor mobile UX).

**CDN Preference:**
- Use `https://cdn.jsdelivr.net/npm/` for nearly all libraries.
- Fallback: `https://unpkg.com/` or `https://cdnjs.cloudflare.com/`.

---

## Further Reading & Resources

- **GSAP Docs:** https://gsap.com/docs/v3
- **Lottie Files:** https://lottiefiles.com (animation library + player)
- **Three.js Manual:** https://threejs.org/manual/
- **Elementor Hooks:** https://developers.elementor.com/docs/hooks/
- **Web Component best practices:** https://web.dev/web-components/

---

**Last Updated:** May 2026  
**Status:** Reference guide for Joist v1.0 clone skill enhancement  
**Maintainer:** Joist team
