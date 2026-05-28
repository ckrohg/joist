<?php
declare(strict_types=1);

namespace Joist\WidgetPack;

/**
 * Joist Widget Pack — registers Joist's custom Elementor widgets, the `joist`
 * widget category, and the Container extensions / site-wide emitters that
 * ship as part of the Pack. Wired from main Bootstrap on plugin init.
 *
 * v0.9-α: PinScroll widget shipped as proof-of-pattern.
 * v0.9-β (Wave 4): Anchored Pop widget, View Transitions emitter,
 * Display-swap extension, Pin-Scroll Chrome 145+ trigger gate (CSS-only).
 * v0.9-γ planned: Variable Heading, Masonry Grid, Morph SVG, Reparent.
 */
final class PackBootstrap
{
    public const CATEGORY_SLUG = 'joist';

    public static function init(): void
    {
        if (!class_exists('\Elementor\Plugin')) return;

        add_action('elementor/elements/categories_registered', [self::class, 'registerCategory']);
        add_action('elementor/widgets/register', [self::class, 'registerWidgets']);
        add_action('elementor/frontend/after_register_scripts', [self::class, 'registerScripts']);
        add_action('elementor/frontend/after_register_styles', [self::class, 'registerStyles']);

        \Joist\WidgetPack\ViewTransitions\Emitter::init();
        \Joist\WidgetPack\DisplaySwap\Extension::init();
    }

    public static function registerCategory($elements_manager): void
    {
        $elements_manager->add_category(
            self::CATEGORY_SLUG,
            [
                'title' => __('Joist', 'joist'),
                'icon' => 'eicon-spinner',
            ]
        );
    }

    public static function registerWidgets($widgets_manager): void
    {
        $widgets_manager->register(new \Joist\WidgetPack\PinScroll\Widget());
        $widgets_manager->register(new \Joist\WidgetPack\AnchoredPop\Widget());
    }

    public static function registerScripts(): void
    {
        wp_register_script(
            'joist-pin-scroll',
            self::assetsUrl() . 'pin-scroll/pin-scroll.js',
            [],
            JOIST_VERSION,
            true
        );
    }

    public static function registerStyles(): void
    {
        wp_register_style(
            'joist-pin-scroll',
            self::assetsUrl() . 'pin-scroll/pin-scroll.css',
            [],
            JOIST_VERSION
        );
        wp_register_style(
            'joist-anchored-pop',
            self::assetsUrl() . 'anchored-pop/anchored-pop.css',
            [],
            JOIST_VERSION
        );
    }

    public static function assetsUrl(): string
    {
        return JOIST_URL . 'assets/widget-pack/';
    }
}
