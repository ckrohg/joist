<?php
declare(strict_types=1);

namespace Joist\WidgetPack\ViewTransitions;

/**
 * @purpose Thin CSS emitter for View Transitions. Wave 4b (2026-05-26): the
 * 2026-03 baseline status of cross-document View Transitions (~85% global)
 * plus Chrome 147's element-scoped `element.startViewTransition()` mean the
 * widget no longer needs a JS runtime broker. We:
 *
 *   1. Register an admin option `joist_view_transitions_enabled` (default off).
 *      When on, emit `@view-transition { navigation: auto }` as a tiny site-
 *      wide stylesheet so cross-document VT lights up automatically.
 *   2. Add two element-level controls (on every Elementor element via the
 *      `section_advanced/after_section_end` hook): `joist_vt_name` and
 *      `joist_vt_class`. The `elementor/element/parse_css` filter stamps
 *      `view-transition-name: --slug` and (optionally) `view-transition-class`
 *      into the element's per-document CSS.
 *
 * Pure CSS. No JS file. Browsers without VT support degrade to instant nav
 * with no regression. WidgetPack spec §2.3 (2026-05-26 simplification).
 */

use Elementor\Controls_Manager;
use Elementor\Element_Base;

if (!defined('ABSPATH')) exit;

final class Emitter
{
    public const OPTION_ENABLED = 'joist_view_transitions_enabled';
    public const STYLE_HANDLE   = 'joist-view-transitions';

    public static function init(): void
    {
        if (!class_exists('\Elementor\Plugin')) return;

        // Site-wide @view-transition rule when admin option is on.
        add_action('wp_enqueue_scripts', [self::class, 'enqueueSiteCss']);

        // Per-element controls under Advanced > After.
        add_action('elementor/element/common/section_advanced/after_section_end', [self::class, 'registerElementControls'], 10, 2);
        add_action('elementor/element/container/section_advanced/after_section_end', [self::class, 'registerElementControls'], 10, 2);

        // Stamp view-transition-name / view-transition-class declarations.
        add_action('elementor/element/parse_css', [self::class, 'parseCss'], 10, 2);
    }

    public static function enqueueSiteCss(): void
    {
        if (!get_option(self::OPTION_ENABLED, false)) return;
        $url = defined('JOIST_URL') ? JOIST_URL . 'assets/widget-pack/view-transitions/view-transitions.css' : '';
        $ver = defined('JOIST_VERSION') ? JOIST_VERSION : '0.0.0';
        if ($url !== '') {
            wp_enqueue_style(self::STYLE_HANDLE, $url, [], $ver);
        } else {
            // Inline fallback when JOIST_URL is undefined (test harnesses).
            wp_register_style(self::STYLE_HANDLE, false, [], $ver);
            wp_enqueue_style(self::STYLE_HANDLE);
            wp_add_inline_style(self::STYLE_HANDLE, '@view-transition{navigation:auto}');
        }
    }

    public static function registerElementControls(Element_Base $element, array $args): void
    {
        $element->start_controls_section('joist_view_transitions', [
            'label' => __('Joist · View Transition', 'joist'),
            'tab'   => Controls_Manager::TAB_ADVANCED,
        ]);
        $element->add_control('joist_vt_name', [
            'label'       => __('view-transition-name slug', 'joist'),
            'type'        => Controls_Manager::TEXT,
            'default'     => '',
            'description' => __('Names this element for cross-document/element-scoped View Transitions. Slug only — leading "--" is added automatically. Must be unique per page.', 'joist'),
            'ai'          => ['active' => false],
        ]);
        $element->add_control('joist_vt_class', [
            'label'       => __('view-transition-class (optional)', 'joist'),
            'type'        => Controls_Manager::TEXT,
            'default'     => '',
            'description' => __('Shared class for grouping multiple transitioning elements.', 'joist'),
            'ai'          => ['active' => false],
        ]);
        $element->end_controls_section();
    }

    public static function parseCss($post_css, $element): void
    {
        $settings = $element->get_settings_for_display();
        $name  = isset($settings['joist_vt_name'])  ? trim((string) $settings['joist_vt_name'])  : '';
        $class = isset($settings['joist_vt_class']) ? trim((string) $settings['joist_vt_class']) : '';
        if ($name === '' && $class === '') return;

        $selector = '.elementor-element.elementor-element-' . $element->get_id();
        $decls = '';
        if ($name !== '') {
            $slug = preg_replace('/[^a-zA-Z0-9_-]/', '', $name);
            if ($slug !== '') $decls .= 'view-transition-name:--' . $slug . ';';
        }
        if ($class !== '') {
            $cls = preg_replace('/[^a-zA-Z0-9_\s-]/', '', $class);
            if ($cls !== '') $decls .= 'view-transition-class:' . trim($cls) . ';';
        }
        if ($decls === '') return;

        $stylesheet = $post_css->get_stylesheet();
        if (is_object($stylesheet) && method_exists($stylesheet, 'add_raw_css')) {
            $stylesheet->add_raw_css($selector . '{' . $decls . '}');
        }
    }
}
