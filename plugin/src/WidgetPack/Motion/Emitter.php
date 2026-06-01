<?php
declare(strict_types=1);

namespace Joist\WidgetPack\Motion;

/**
 * @purpose Site-wide motion runtime for the GSAP "escape-hatch" — Slice 1
 * (Foundation + Scroll Reveal). Conditionally enqueues vendored GSAP +
 * ScrollTrigger + the joist-motion harness on singular pages whose Elementor
 * data contains a `joist-reveal` class, letting scroll-reveal motion that
 * Elementor V3 widget settings cannot author run without a build step or CDN.
 *
 * Design (see knowledge/GSAP_ESCAPE_HATCH_SPEC.md):
 *  - Libraries are VENDORED + wp_enqueue_script'd, NOT CDN-injected: a CDN
 *    <script> inside an HTML widget is deferred by WP Rocket "Delay JS" and
 *    never runs on load (verified 2026-05-31). Enqueued handles can be
 *    excluded from that deferral; CDN-in-HTML cannot, reliably.
 *  - Per-page authoring is a namespaced `joist-reveal[--effect]` CSS class on
 *    the target widget (round-trips via Elementor `_css_classes`); the harness
 *    reads the class. The `joist-` namespace is the anti-collision scope.
 *  - GSAP is 100% free incl. commercial use (Webflow, effective 2026-04-30).
 *
 * Mirrors the WidgetPack\ViewTransitions\Emitter pattern (conditional
 * wp_enqueue_scripts). Wired from PackBootstrap::init().
 */

if (!defined('ABSPATH')) exit;

final class Emitter
{
    public const HANDLE_GSAP   = 'joist-gsap';
    public const HANDLE_ST     = 'joist-scrolltrigger';
    public const HANDLE_MOTION = 'joist-motion';
    public const HANDLE_SPLIT  = 'joist-splittext';
    public const HANDLE_LENIS  = 'joist-lenis';

    /** Marker classes that opt a page into the motion runtime. */
    public const MARKER = 'joist-reveal';
    public const MARKER_COUNT = 'joist-count';
    public const MARKER_PIN = 'joist-pin';
    public const MARKER_PARALLAX = 'joist-parallax';
    public const MARKER_SPLIT = 'joist-split';
    public const MARKER_HSCROLL = 'joist-hscroll';
    public const MARKER_MAGNETIC = 'joist-magnetic';
    public const MARKER_SMOOTH = 'joist-smooth';

    /** Supported scroll-reveal effects (Path A plugin + Path B fallback share these). */
    public const EFFECTS = ['fade-in', 'fade-up', 'fade-down', 'slide-left', 'slide-right', 'scale-in'];

    /**
     * Motion capability descriptor surfaced via joist_get_site_info so the
     * agent can choose Path A (plugin runtime present → author classes only)
     * vs Path B (runtime absent → inject the content fallback). Because this
     * lives in the Motion module, the flag and the runtime ship together — a
     * build either has both or neither.
     *
     * @return array{scroll_reveal:bool,effects:list<string>,runtime_version:string}
     */
    public static function capabilities(): array
    {
        return [
            'scroll_reveal' => true,
            'counter' => true,
            'sticky_pin' => true,
            'parallax' => true,
            'split_text' => true,
            'horizontal_scroll' => true,
            'magnetic_cursor' => true,
            'smooth_scroll' => true,
            'effects' => self::EFFECTS,
            'runtime_version' => defined('JOIST_VERSION') ? JOIST_VERSION : '0.0.0',
        ];
    }

    public static function init(): void
    {
        add_action('wp_enqueue_scripts', [self::class, 'maybeEnqueue']);

        // Keep our handles out of caching-plugin JS deferral so the motion
        // runtime actually executes on initial load (verified failure mode).
        add_filter('rocket_delay_js_exclusions', [self::class, 'cachingExclusions']);
        add_filter('rocket_exclude_defer_js', [self::class, 'cachingExclusions']);
    }

    /**
     * Enqueue the motion runtime only on singular pages that actually use it.
     */
    public static function maybeEnqueue(): void
    {
        if (!is_singular()) return;
        if (!defined('JOIST_URL')) return;

        $id = (int) get_queried_object_id();
        if ($id <= 0) return;

        $data = get_post_meta($id, '_elementor_data', true);
        if (!is_string($data) || $data === ''
            || (strpos($data, self::MARKER) === false
                && strpos($data, self::MARKER_COUNT) === false
                && strpos($data, self::MARKER_PIN) === false
                && strpos($data, self::MARKER_PARALLAX) === false
                && strpos($data, self::MARKER_SPLIT) === false
                && strpos($data, self::MARKER_HSCROLL) === false
                && strpos($data, self::MARKER_MAGNETIC) === false
                && strpos($data, self::MARKER_SMOOTH) === false)) {
            return;
        }

        $base = JOIST_URL . 'assets/widget-pack/motion/';
        $ver  = defined('JOIST_VERSION') ? JOIST_VERSION : '0.0.0';

        // Dependency-ordered: gsap -> ScrollTrigger -> harness. Footer load.
        wp_enqueue_script(self::HANDLE_GSAP, $base . 'vendor/gsap.min.js', [], $ver, true);
        wp_enqueue_script(self::HANDLE_ST, $base . 'vendor/ScrollTrigger.min.js', [self::HANDLE_GSAP], $ver, true);
        // SplitText only when a page uses split-text (it's an extra ~7KB).
        if (strpos($data, self::MARKER_SPLIT) !== false) {
            wp_enqueue_script(self::HANDLE_SPLIT, $base . 'vendor/SplitText.min.js', [self::HANDLE_GSAP], $ver, true);
        }
        // Lenis only when a page opts into smooth scroll (off by default).
        if (strpos($data, self::MARKER_SMOOTH) !== false) {
            wp_enqueue_script(self::HANDLE_LENIS, $base . 'vendor/lenis.min.js', [], $ver, true);
        }
        wp_enqueue_script(self::HANDLE_MOTION, $base . 'joist-motion.js', [self::HANDLE_ST], $ver, true);
    }

    /**
     * Add our vendored filenames to WP Rocket's delay-JS / no-defer
     * exclusion lists so the motion runtime is not held back until first
     * user interaction.
     *
     * @param mixed $excluded
     * @return array<int,string>
     */
    public static function cachingExclusions($excluded): array
    {
        $excluded = is_array($excluded) ? $excluded : [];
        $excluded[] = 'gsap.min.js';
        $excluded[] = 'ScrollTrigger.min.js';
        $excluded[] = 'joist-motion.js';
        return $excluded;
    }
}
