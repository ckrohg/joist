<?php
declare(strict_types=1);

namespace Joist\WidgetPack\DisplaySwap;

/**
 * @purpose Wave 4c (2026-05-26): per-breakpoint `display` swap on Elementor
 * Containers via pure CSS code-gen. Replaces the earlier JS conflict-matrix
 * approach now that name-only `@container` queries have shipped Firefox 149
 * + Safari 26.4 (March 2026) and Container Queries have been Baseline since
 * 2023 — the per-mode property block is scoped automatically by the cascade
 * and (when consumers query the container) by container-query name lookup.
 *
 * Public surface:
 *   - Container responsive control `joist_display_mode` with values
 *     `flex` / `grid` / `block`, registered after Elementor's existing
 *     Layout container section.
 *
 * Emission:
 *   - Desktop value (base):  <selector> { display: <mode>; }
 *   - Tablet / mobile via Elementor's responsive suffixes
 *     (joist_display_mode_tablet / _mobile) emitted as `@media (max-width: …)`
 *     blocks using the active Elementor breakpoint thresholds.
 *
 * Pure CSS — no JS file, no runtime logic. WidgetPack spec §2.8.
 */

use Elementor\Controls_Manager;
use Elementor\Element_Base;

if (!defined('ABSPATH')) exit;

final class Extension
{
    private const CONTROL = 'joist_display_mode';

    /** Allowed values — the source of truth, also surfaced via WidgetCatalog. */
    public const MODES = ['' => 'Default', 'flex' => 'Flex', 'grid' => 'Grid', 'block' => 'Block'];

    public static function init(): void
    {
        if (!class_exists('\Elementor\Plugin')) return;

        // Register the control on Container elements, after the existing
        // Layout section. Elementor's Container element uses the section id
        // `section_layout_container`.
        add_action(
            'elementor/element/container/section_layout_container/after_section_end',
            [self::class, 'registerControl'],
            10,
            2
        );

        // Emit the per-breakpoint CSS via the standard parse_css filter.
        add_action('elementor/element/parse_css', [self::class, 'parseCss'], 10, 2);
    }

    public static function registerControl(Element_Base $element, array $args): void
    {
        $element->start_controls_section('joist_display_swap', [
            'label' => __('Joist · Display mode', 'joist'),
            'tab'   => Controls_Manager::TAB_LAYOUT,
        ]);

        $element->add_responsive_control(self::CONTROL, [
            'label'       => __('Display mode', 'joist'),
            'type'        => Controls_Manager::SELECT,
            'default'     => '',
            'options'     => self::MODES,
            'description' => __('Per-breakpoint container display value. Empty = inherit from Elementor Layout. Container queries scope mode-specific child rules automatically.', 'joist'),
            'ai'          => ['active' => false],
        ]);

        $element->end_controls_section();
    }

    public static function parseCss($post_css, $element): void
    {
        // Only operate on Container elements.
        $type = method_exists($element, 'get_type') ? $element->get_type() : '';
        if ($type !== 'container') return;

        $settings = $element->get_settings_for_display();
        $selector = '.elementor-element.elementor-element-' . $element->get_id();

        $stylesheet = $post_css->get_stylesheet();
        if (!is_object($stylesheet) || !method_exists($stylesheet, 'add_raw_css')) return;

        // Desktop / base.
        $desktop = self::sanitize($settings[self::CONTROL] ?? '');
        if ($desktop !== '') {
            $stylesheet->add_raw_css($selector . '{display:' . $desktop . ';}');
        }

        // Tablet + mobile via max-width media queries (matches Elementor's own
        // mobile-first → max-width cascade for the legacy 3-breakpoint set).
        foreach (self::breakpointMaxWidths() as $device => $maxPx) {
            $mode = self::sanitize($settings[self::CONTROL . '_' . $device] ?? '');
            if ($mode === '') continue;
            $stylesheet->add_raw_css('@media(max-width:' . $maxPx . 'px){' . $selector . '{display:' . $mode . ';}}');
        }
    }

    /** @return array<string,int> Device-key => max-width-px. */
    private static function breakpointMaxWidths(): array
    {
        $defaults = ['tablet' => 1024, 'mobile' => 767];
        if (!class_exists('\Elementor\Plugin')) return $defaults;
        try {
            $mgr = \Elementor\Plugin::$instance->breakpoints ?? null;
            if ($mgr === null || !method_exists($mgr, 'get_active_breakpoints')) return $defaults;
            $active = $mgr->get_active_breakpoints();
            $out = [];
            foreach (['tablet', 'mobile'] as $device) {
                if (isset($active[$device]) && is_object($active[$device]) && method_exists($active[$device], 'get_value')) {
                    $out[$device] = (int) $active[$device]->get_value();
                } else {
                    $out[$device] = $defaults[$device];
                }
            }
            return $out;
        } catch (\Throwable $e) {
            return $defaults;
        }
    }

    private static function sanitize(string $mode): string
    {
        return in_array($mode, ['flex', 'grid', 'block'], true) ? $mode : '';
    }
}
