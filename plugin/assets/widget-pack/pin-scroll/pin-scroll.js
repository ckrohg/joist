/*!
 * Joist Pin-Scroll runtime — JS fallback for browsers without
 * `animation-timeline` support. ~1.5KB minified target.
 *
 * Pattern: IntersectionObserver gates a rAF loop that reads
 * `getBoundingClientRect()` and writes `transform: translate3d(...)` on the
 * inner track. Stops when the section leaves the viewport.
 */
(function () {
  'use strict';

  function init() {
    var sections = document.querySelectorAll('.joist-pin');
    if (!sections.length) return;

    var supportsTimeline = window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()');
    var reducedMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    sections.forEach(function (section) {
      var engine = section.dataset.engine || 'auto';
      var respectReduced = section.dataset.reducedMotion !== '0';
      var disableBelow = parseInt(section.dataset.disableBelow || '768', 10);

      // No JS needed in these cases — CSS handles everything.
      if (reducedMotion && respectReduced) return;
      if (window.innerWidth <= disableBelow) return;
      if (engine === 'auto' && supportsTimeline) return;
      if (engine === 'css') return;

      var track = section.querySelector('.joist-pin__track');
      if (!track) return;

      var distance = parseFloat(section.dataset.distance) || 200; // vw
      var active = false;
      var rafId = 0;
      var lastTranslate = 0;

      function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

      function tick() {
        var rect = section.getBoundingClientRect();
        var scrollSpan = rect.height - window.innerHeight;
        if (scrollSpan <= 0) {
          if (active) rafId = requestAnimationFrame(tick);
          return;
        }
        var progress = clamp(-rect.top / scrollSpan, 0, 1);
        var translate = -progress * distance; // in vw
        if (Math.abs(translate - lastTranslate) > 0.05) {
          track.style.transform = 'translate3d(' + translate + 'vw, 0, 0)';
          lastTranslate = translate;
        }
        if (active) rafId = requestAnimationFrame(tick);
      }

      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          active = entry.isIntersecting;
          if (active) {
            rafId = requestAnimationFrame(tick);
          } else {
            cancelAnimationFrame(rafId);
          }
        });
      }, { rootMargin: '100% 0px' });

      io.observe(section);

      // Re-evaluate on resize — if user resizes below disable_below threshold,
      // tear down the transform.
      var resizeHandler = function () {
        if (window.innerWidth <= disableBelow) {
          cancelAnimationFrame(rafId);
          active = false;
          track.style.transform = '';
        }
      };
      window.addEventListener('resize', resizeHandler, { passive: true });

      // Accessibility: focus on an off-screen panel scrolls into pin range.
      section.addEventListener('focusin', function (e) {
        var panel = e.target.closest('.joist-pin__panel');
        if (!panel) return;
        var idx = parseInt(panel.dataset.panelIndex || '0', 10);
        var panels = parseInt(getComputedStyle(section).getPropertyValue('--joist-pin-panels'), 10) || 1;
        if (panels <= 1) return;
        var sectionTop = section.getBoundingClientRect().top + window.scrollY;
        var sectionHeight = section.offsetHeight - window.innerHeight;
        var targetY = sectionTop + (idx / (panels - 1)) * sectionHeight;
        window.scrollTo({ top: targetY, behavior: 'smooth' });
      });

      // Cleanup hook for Elementor editor iframe re-mount.
      section.__joistPinDestroy = function () {
        cancelAnimationFrame(rafId);
        active = false;
        io.disconnect();
        window.removeEventListener('resize', resizeHandler);
      };
    });
  }

  // Wire into Elementor's frontend init if present; otherwise standalone DOM ready.
  if (window.elementorFrontend && window.elementorFrontend.hooks) {
    window.elementorFrontend.hooks.addAction('frontend/element_ready/joist-pin-scroll.default', function () {
      init();
    });
  } else if (document.readyState !== 'loading') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
