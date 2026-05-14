<?php
declare(strict_types=1);

namespace Joist\WidgetPack;

/**
 * Joist Widget Pack — registers Joist's custom Elementor widgets and the
 * `joist` widget category. Wired from main Bootstrap on plugin init.
 *
 * v0.9-α (this commit): PinScroll widget shipping as the proof of the pattern.
 * v0.9 will add: Variable Heading, Display-swap extension, Masonry Grid,
 * Subgrid toggle, Morph SVG, Reparent, View Transitions runtime + widget.
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
    }

    private static function assetsUrl(): string
    {
        return JOIST_URL . 'assets/widget-pack/';
    }
}
