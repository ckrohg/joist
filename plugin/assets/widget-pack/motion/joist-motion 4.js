/**
 * Joist Motion — scroll-reveal harness (escape-hatch Slice 1).
 *
 * Plain vanilla JS (no jQuery — jQuery interop is a documented Elementor
 * conflict source). Reads a namespaced `joist-reveal[--effect]` class on any
 * element and animates it in on scroll via GSAP ScrollTrigger.
 *
 * Guardrails (see knowledge/GSAP_ESCAPE_HATCH_SPEC.md §4):
 *  - prefers-reduced-motion: reveal everything, no motion.
 *  - transform/opacity only (composite-only; protects INP).
 *  - idempotent bind (data-joist-motion-bound) — survives editor re-renders.
 *  - ScrollTrigger.refresh() after window load + fonts (lazy-load staleness).
 *  - window.__joistMotionCleanup() kills all triggers (teardown/SPA).
 *  - `joist-` class namespace is the anti-collision scope (won't touch theme
 *    or Elementor-Pro animations).
 *
 * Per-element tuning via data-attributes (optional):
 *   data-reveal-duration (s) · data-reveal-delay (s) · data-reveal-start
 *   (ScrollTrigger start, default "top 85%").
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__joistMotionBooted) return;        // don't double-run with the Path B fallback
  window.__joistMotionBooted = true;

  var REDUCED = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Hidden "from" state per effect. transform/opacity only.
  var PRESETS = {
    'fade-in':     { y: 0,   x: 0,   scale: 1 },
    'fade-up':     { y: 40,  x: 0,   scale: 1 },
    'fade-down':   { y: -40, x: 0,   scale: 1 },
    'slide-left':  { y: 0,   x: 60,  scale: 1 },
    'slide-right': { y: 0,   x: -60, scale: 1 },
    'scale-in':    { y: 0,   x: 0,   scale: 0.92 }
  };

  var triggers = [];

  function ready(fn) {
    if (document.readyState !== 'loading') { fn(); }
    else { document.addEventListener('DOMContentLoaded', fn); }
  }

  function effectOf(el) {
    var m = ('' + (el.className || '')).match(/joist-reveal--([a-z-]+)/);
    return (m && PRESETS[m[1]]) ? m[1] : 'fade-up';
  }

  function num(el, attr, fallback) {
    var v = parseFloat(el.getAttribute(attr));
    return isNaN(v) ? fallback : v;
  }

  function build() {
    var els = document.querySelectorAll('.joist-reveal');
    if (!els.length) return;

    // Accessibility: honor reduced-motion — show everything, animate nothing.
    if (REDUCED || !window.gsap || !window.ScrollTrigger) {
      Array.prototype.forEach.call(els, function (el) {
        el.style.opacity = '';
        el.style.visibility = '';
      });
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    Array.prototype.forEach.call(els, function (el) {
      if (el.getAttribute('data-joist-motion-bound')) return; // idempotent
      el.setAttribute('data-joist-motion-bound', '1');

      var from = PRESETS[effectOf(el)];
      var tween = gsap.from(el, {
        autoAlpha: 0,            // opacity + visibility (no-FOUC once bound)
        y: from.y,
        x: from.x,
        scale: from.scale,
        duration: num(el, 'data-reveal-duration', 0.7),
        delay: num(el, 'data-reveal-delay', 0),
        ease: 'power2.out',
        scrollTrigger: {
          trigger: el,
          start: el.getAttribute('data-reveal-start') || 'top 85%',
          once: true
        }
      });
      if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
    });

    // Trigger positions are computed at creation and go stale once
    // images/fonts finish loading and shift layout. Refresh on both.
    window.addEventListener('load', function () { ScrollTrigger.refresh(); });
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
    }
  }

  // Teardown hook — Elementor editor re-renders, SPA nav, manual cleanup.
  window.__joistMotionCleanup = function () {
    triggers.forEach(function (t) { try { t.kill(); } catch (e) {} });
    triggers = [];
    if (window.ScrollTrigger) {
      ScrollTrigger.getAll().forEach(function (t) { try { t.kill(); } catch (e) {} });
    }
  };

  ready(build);
})();
