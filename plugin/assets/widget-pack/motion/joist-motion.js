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

  function bindReveals(els) {
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
  }

  // Count up from 0 to the number shown in the element's text on scroll-enter,
  // preserving prefix ($), suffix (%, +, K) and thousands separators/decimals.
  function bindCounters(els) {
    Array.prototype.forEach.call(els, function (el) {
      if (el.getAttribute('data-joist-count-bound')) return;
      var m = el.textContent.trim().match(/^(\D*?)([\d.,]+)(\D*)$/);
      if (!m) return;
      var prefix = m[1], numStr = m[2], suffix = m[3];
      var target = parseFloat(numStr.replace(/,/g, ''));
      if (isNaN(target)) return;
      el.setAttribute('data-joist-count-bound', '1');

      var hasComma = numStr.indexOf(',') > -1;
      var decimals = (numStr.split('.')[1] || '').length;
      var obj = { v: 0 };
      var tween = gsap.to(obj, {
        v: target,
        duration: num(el, 'data-count-duration', 2),
        ease: 'power1.out',
        scrollTrigger: {
          trigger: el,
          start: el.getAttribute('data-reveal-start') || 'top 85%',
          once: true
        },
        onUpdate: function () {
          var val = decimals ? obj.v.toFixed(decimals) : Math.round(obj.v);
          if (hasComma) {
            val = Number(val).toLocaleString('en-US', decimals
              ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
              : {});
          }
          el.textContent = prefix + val + suffix;
        }
      });
      if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
    });
  }

  // ScrollTrigger pinning breaks under a transformed/filtered ancestor (it
  // becomes the containing block for the pinned fixed element). Elementor
  // sections routinely carry transforms from entrance/motion effects — so we
  // detect and degrade to position:sticky rather than ship a broken pin.
  function transformedAncestor(el) {
    var p = el.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      var s = getComputedStyle(p);
      if ((s.transform && s.transform !== 'none') ||
          (s.perspective && s.perspective !== 'none') ||
          (s.filter && s.filter !== 'none') ||
          (s.willChange && s.willChange.indexOf('transform') > -1)) {
        return p;
      }
      p = p.parentElement;
    }
    return null;
  }

  function bindPins(els) {
    Array.prototype.forEach.call(els, function (el) {
      if (el.getAttribute('data-joist-pin-bound')) return;
      el.setAttribute('data-joist-pin-bound', '1');

      var bad = transformedAncestor(el);
      if (bad) {
        // GUARDRAIL: can't ScrollTrigger-pin under a transformed ancestor.
        // Degrade to CSS sticky (unaffected by ancestor transforms) + warn.
        if (window.console && console.warn) {
          console.warn('[joist-motion] joist-pin: a transformed ancestor breaks ScrollTrigger pinning; falling back to position:sticky.', { pinned: el, ancestor: bad });
        }
        el.style.position = 'sticky';
        el.style.top = el.getAttribute('data-pin-top') || '0px';
        el.setAttribute('data-joist-pin-mode', 'sticky-fallback');
        return;
      }

      el.setAttribute('data-joist-pin-mode', 'pin');
      var st = ScrollTrigger.create({
        trigger: el,
        start: el.getAttribute('data-pin-start') || 'top top',
        end: el.getAttribute('data-pin-end') || '+=100%',
        pin: true,
        pinSpacing: true
      });
      triggers.push(st);
    });
  }

  // Parallax: scrub the element's translateY across its journey through the
  // viewport. transform-only (yPercent) to protect INP. Speed via
  // data-parallax-speed (0..1, default 0.2).
  function bindParallax(els) {
    Array.prototype.forEach.call(els, function (el) {
      if (el.getAttribute('data-joist-parallax-bound')) return;
      el.setAttribute('data-joist-parallax-bound', '1');
      var speed = parseFloat(el.getAttribute('data-parallax-speed'));
      if (isNaN(speed)) speed = 0.2;
      var dist = 100 * speed;
      var tween = gsap.fromTo(el,
        { yPercent: -dist },
        { yPercent: dist, ease: 'none',
          scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
      if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
    });
  }

  // Split-text reveal: split into chars/words/lines and stagger in on
  // scroll-enter. Requires the (now-free) SplitText plugin. type via
  // data-split-type (chars|words|lines, default chars). Splits are tracked
  // for revert() on cleanup.
  function bindSplit(els) {
    if (!window.SplitText) return;
    Array.prototype.forEach.call(els, function (el) {
      if (el.getAttribute('data-joist-split-bound')) return;
      el.setAttribute('data-joist-split-bound', '1');
      var type = el.getAttribute('data-split-type') || 'chars';
      var split = new SplitText(el, { type: type });
      var targets = split[type] || split.chars || split.words || split.lines || [el];
      (window.__joistSplits = window.__joistSplits || []).push(split);
      var tween = gsap.from(targets, {
        autoAlpha: 0, yPercent: 40, ease: 'power3.out',
        duration: 0.6, stagger: 0.025,
        scrollTrigger: { trigger: el, start: 'top 85%', once: true }
      });
      if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
    });
  }

  // Horizontal scroll: pin the section and scrub its inner .joist-hscroll-track
  // left as the user scrolls vertically. Reuses the pin guardrail — degrades to
  // native overflow-x scroll under a transformed ancestor.
  function bindHScroll(els) {
    Array.prototype.forEach.call(els, function (el) {
      if (el.getAttribute('data-joist-hscroll-bound')) return;
      el.setAttribute('data-joist-hscroll-bound', '1');
      var track = el.querySelector('.joist-hscroll-track') || el.firstElementChild;
      if (!track) return;
      if (transformedAncestor(el)) {
        el.style.overflowX = 'auto';
        el.setAttribute('data-joist-hscroll-mode', 'overflow-fallback');
        if (window.console && console.warn) console.warn('[joist-motion] joist-hscroll: transformed ancestor breaks pinning; native overflow-x fallback.', el);
        return;
      }
      el.setAttribute('data-joist-hscroll-mode', 'pin');
      var amount = function () { return Math.max(0, track.scrollWidth - el.offsetWidth); };
      var tween = gsap.to(track, {
        x: function () { return -amount(); }, ease: 'none',
        scrollTrigger: { trigger: el, pin: true, scrub: 1, end: function () { return '+=' + amount(); }, invalidateOnRefresh: true }
      });
      if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
    });
  }

  // Magnetic cursor: element eases toward the pointer within its bounds
  // (desktop only — pointer:fine). No ScrollTrigger. strength via
  // data-magnetic-strength (default 0.4).
  function bindMagnetic(els) {
    if (!window.matchMedia || !matchMedia('(pointer: fine)').matches) return;
    Array.prototype.forEach.call(els, function (el) {
      if (el.getAttribute('data-joist-magnetic-bound')) return;
      el.setAttribute('data-joist-magnetic-bound', '1');
      var strength = parseFloat(el.getAttribute('data-magnetic-strength'));
      if (isNaN(strength)) strength = 0.4;
      var xTo = gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power3' });
      var yTo = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power3' });
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * strength);
        yTo((e.clientY - (r.top + r.height / 2)) * strength);
      });
      el.addEventListener('mouseleave', function () { xTo(0); yTo(0); });
    });
  }

  // Smooth scroll (Lenis). OPT-IN via a .joist-smooth marker, OFF by default —
  // Elementor's native CSS smooth-scroll (v3.25+) collides with injected
  // smooth-scroll. Never forced under reduced-motion (a11y). autoRaf:false so
  // GSAP's ticker drives the RAF (the detail everyone gets wrong).
  function initSmooth(active) {
    if (!active || REDUCED || !window.Lenis || !window.gsap || window.__joistLenis) return;
    var lenis = new Lenis({ autoRaf: false });
    window.__joistLenis = lenis;
    lenis.on('scroll', function () { if (window.ScrollTrigger) ScrollTrigger.update(); });
    var raf = function (time) { lenis.raf(time * 1000); }; // ticker secs -> ms
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    window.__joistLenisRaf = raf;
  }

  function build() {
    var reveals = document.querySelectorAll('.joist-reveal');
    var counts = document.querySelectorAll('.joist-count');
    var pins = document.querySelectorAll('.joist-pin');
    var parallax = document.querySelectorAll('.joist-parallax');
    var splits = document.querySelectorAll('.joist-split');
    var hscroll = document.querySelectorAll('.joist-hscroll');
    var magnetic = document.querySelectorAll('.joist-magnetic');
    var smooth = !!document.querySelector('.joist-smooth') || (document.body && document.body.classList.contains('joist-smooth'));
    if (!reveals.length && !counts.length && !pins.length && !parallax.length && !splits.length && !hscroll.length && !magnetic.length && !smooth) return;

    // Accessibility / no-gsap: reveals shown, counters keep their final value.
    if (REDUCED || !window.gsap || !window.ScrollTrigger) {
      Array.prototype.forEach.call(reveals, function (el) {
        el.style.opacity = '';
        el.style.visibility = '';
      });
      return;
    }

    gsap.registerPlugin(ScrollTrigger);
    bindReveals(reveals);
    bindCounters(counts);
    bindPins(pins);
    bindParallax(parallax);
    bindSplit(splits);
    bindHScroll(hscroll);
    bindMagnetic(magnetic);
    initSmooth(smooth);

    // Trigger positions go stale once images/fonts load and shift layout.
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
    if (window.__joistSplits) {
      window.__joistSplits.forEach(function (s) { try { s.revert(); } catch (e) {} });
      window.__joistSplits = [];
    }
    if (window.__joistLenis) {
      try { if (window.__joistLenisRaf && window.gsap) gsap.ticker.remove(window.__joistLenisRaf); } catch (e) {}
      try { window.__joistLenis.destroy(); } catch (e) {}
      window.__joistLenis = null;
    }
  };

  ready(build);
})();
