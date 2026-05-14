<?php
declare(strict_types=1);

namespace Joist\WidgetPack\PinScroll;

use Elementor\Controls_Manager;
use Elementor\Repeater;
use Elementor\Widget_Base;
use Joist\WidgetPack\PackBootstrap;

if (!defined('ABSPATH')) exit;

/**
 * Joist Pin-Scroll — sticky section + horizontally-translating inner track.
 *
 * Apple-product-page style. CSS-first via `animation-timeline: view()` where
 * supported (Chrome 115+, Safari 17+), JS fallback runtime for Firefox/older.
 *
 * Editor preview renders a static first-panel preview (no scroll, no JS) per
 * the research-validated pattern — Elementor's editor iframe doesn't reliably
 * report viewport-scroll state, so dynamic preview is unsafe.
 *
 * Accessibility:
 *   - `prefers-reduced-motion`: panels stack vertically, no transform.
 *   - `aria-roledescription="carousel"` on the section.
 *   - Focus on off-screen panel scrolls viewport into the pin range (JS).
 */
final class Widget extends Widget_Base
{
    public function get_name(): string
    {
        return 'joist-pin-scroll';
    }

    public function get_title(): string
    {
        return __('Pin-Scroll', 'joist');
    }

    public function get_icon(): string
    {
        // Use a built-in eicon as fallback per research stream F — external SVG
        // icons hit known Elementor SVG bugs (#23272/#23915). Once Joist ships
        // its inline-SVG icon map, switch via $this->get_icon_url() override.
        return 'eicon-slider-push';
    }

    public function get_categories(): array
    {
        return [PackBootstrap::CATEGORY_SLUG];
    }

    public function get_keywords(): array
    {
        return ['joist', 'pin', 'scroll', 'horizontal', 'apple', 'stripe', 'linear', 'motion'];
    }

    public function get_script_depends(): array
    {
        return ['joist-pin-scroll'];
    }

    public function get_style_depends(): array
    {
        return ['joist-pin-scroll'];
    }

    protected function register_controls(): void
    {
        $this->start_controls_section('section_panels', [
            'label' => __('Panels', 'joist'),
            'tab' => Controls_Manager::TAB_CONTENT,
        ]);

        $repeater = new Repeater();
        $repeater->add_control('panel_content', [
            'label' => __('Panel content', 'joist'),
            'type' => Controls_Manager::WYSIWYG,
            'default' => __('Panel content', 'joist'),
        ]);
        $repeater->add_control('panel_background', [
            'label' => __('Background color', 'joist'),
            'type' => Controls_Manager::COLOR,
        ]);

        $this->add_control('panels', [
            'label' => __('Panels', 'joist'),
            'type' => Controls_Manager::REPEATER,
            'fields' => $repeater->get_controls(),
            'default' => [
                ['panel_content' => __('Panel 1', 'joist')],
                ['panel_content' => __('Panel 2', 'joist')],
                ['panel_content' => __('Panel 3', 'joist')],
            ],
            'title_field' => '{{{ panel_content.replace(/<[^>]*>/g, "").substring(0, 30) }}}',
        ]);

        $this->end_controls_section();

        $this->start_controls_section('section_motion', [
            'label' => __('Pin behavior', 'joist'),
            'tab' => Controls_Manager::TAB_CONTENT,
        ]);

        $this->add_control('pin_distance', [
            'label' => __('Horizontal distance (vw)', 'joist'),
            'type' => Controls_Manager::NUMBER,
            'min' => 50,
            'max' => 1000,
            'step' => 25,
            'default' => 200,
            'description' => __('Total horizontal translation of the inner track, in viewport widths.', 'joist'),
        ]);

        $this->add_control('pin_duration', [
            'label' => __('Pin duration (vh)', 'joist'),
            'type' => Controls_Manager::NUMBER,
            'min' => 100,
            'max' => 1000,
            'step' => 50,
            'default' => 300,
            'description' => __('How many viewport heights the section stays pinned.', 'joist'),
        ]);

        $this->add_control('easing', [
            'label' => __('Easing', 'joist'),
            'type' => Controls_Manager::SELECT,
            'default' => 'linear',
            'options' => [
                'linear' => 'Linear',
                'ease-out' => 'Ease out',
                'ease-in-out' => 'Ease in-out',
            ],
        ]);

        $this->add_control('engine', [
            'label' => __('Engine', 'joist'),
            'type' => Controls_Manager::SELECT,
            'default' => 'auto',
            'options' => [
                'auto' => __('Auto (CSS-first w/ JS fallback)', 'joist'),
                'css' => __('CSS only', 'joist'),
                'js' => __('JS only', 'joist'),
            ],
            'description' => __('"Auto" uses CSS animation-timeline where supported.', 'joist'),
        ]);

        $this->add_control('disable_below_px', [
            'label' => __('Disable below width (px)', 'joist'),
            'type' => Controls_Manager::NUMBER,
            'default' => 768,
            'description' => __('On screens narrower than this, panels stack vertically.', 'joist'),
        ]);

        $this->add_control('respect_reduced_motion', [
            'label' => __('Respect prefers-reduced-motion', 'joist'),
            'type' => Controls_Manager::SWITCHER,
            'default' => 'yes',
            'return_value' => 'yes',
        ]);

        $this->end_controls_section();

        $this->start_controls_section('section_style', [
            'label' => __('Style', 'joist'),
            'tab' => Controls_Manager::TAB_STYLE,
        ]);

        $this->add_control('panel_min_width', [
            'label' => __('Panel min-width', 'joist'),
            'type' => Controls_Manager::SLIDER,
            'size_units' => ['vw', '%', 'px'],
            'range' => [
                'vw' => ['min' => 30, 'max' => 100],
                '%' => ['min' => 30, 'max' => 100],
                'px' => ['min' => 200, 'max' => 1600],
            ],
            'default' => ['unit' => 'vw', 'size' => 100],
            'selectors' => [
                '{{WRAPPER}} .joist-pin__panel' => 'min-width: {{SIZE}}{{UNIT}};',
            ],
        ]);

        $this->add_control('panel_padding', [
            'label' => __('Panel padding', 'joist'),
            'type' => Controls_Manager::DIMENSIONS,
            'size_units' => ['px', '%', 'em'],
            'default' => ['top' => '40', 'right' => '40', 'bottom' => '40', 'left' => '40', 'unit' => 'px', 'isLinked' => true],
            'selectors' => [
                '{{WRAPPER}} .joist-pin__panel' => 'padding: {{TOP}}{{UNIT}} {{RIGHT}}{{UNIT}} {{BOTTOM}}{{UNIT}} {{LEFT}}{{UNIT}};',
            ],
        ]);

        $this->end_controls_section();
    }

    protected function render(): void
    {
        $s = $this->get_settings_for_display();
        $panels = is_array($s['panels'] ?? null) ? $s['panels'] : [];
        $panelCount = max(1, count($panels));
        $distance = (int) ($s['pin_distance'] ?? 200);
        $duration = (int) ($s['pin_duration'] ?? 300);
        $isEdit = class_exists('\Elementor\Plugin') && \Elementor\Plugin::$instance->editor->is_edit_mode();

        $data = [
            'distance' => $distance,
            'duration' => $duration,
            'easing' => (string) ($s['easing'] ?? 'linear'),
            'engine' => (string) ($s['engine'] ?? 'auto'),
            'disable_below' => (int) ($s['disable_below_px'] ?? 768),
            'reduced_motion' => ($s['respect_reduced_motion'] ?? 'yes') === 'yes' ? '1' : '0',
        ];
        $dataAttrs = '';
        foreach ($data as $k => $v) {
            $dataAttrs .= ' data-' . esc_attr(str_replace('_', '-', $k)) . '="' . esc_attr((string) $v) . '"';
        }

        $style = sprintf(
            '--joist-pin-panels:%d;--joist-pin-distance:%dvw;--joist-pin-duration:%dvh;',
            $panelCount,
            $distance,
            $duration
        );

        printf(
            '<section class="joist-pin" aria-roledescription="carousel" style="%s"%s>',
            esc_attr($style),
            $dataAttrs
        );

        if ($isEdit) {
            echo '<div class="joist-pin__editor-preview">';
            echo '<div class="joist-pin__editor-notice">' . esc_html__('Pin-Scroll preview — first panel shown. View on the front-end for full behavior.', 'joist') . '</div>';
            $first = $panels[0]['panel_content'] ?? '';
            echo '<div class="joist-pin__panel">' . wp_kses_post($first) . '</div>';
            echo '</div></section>';
            return;
        }

        echo '<div class="joist-pin__sticky"><div class="joist-pin__track">';
        foreach ($panels as $i => $panel) {
            $bg = !empty($panel['panel_background']) ? 'background:' . esc_attr($panel['panel_background']) . ';' : '';
            printf(
                '<div class="joist-pin__panel" data-panel-index="%d" style="%s">%s</div>',
                $i,
                $bg,
                wp_kses_post($panel['panel_content'] ?? '')
            );
        }
        echo '</div></div></section>';
    }

    protected function content_template(): void
    {
        ?>
        <#
            var count = settings.panels.length || 1;
            var style = '--joist-pin-panels:' + count +
                        ';--joist-pin-distance:' + settings.pin_distance + 'vw' +
                        ';--joist-pin-duration:' + settings.pin_duration + 'vh;';
        #>
        <section class="joist-pin joist-pin--editor" style="{{ style }}">
            <div class="joist-pin__editor-preview">
                <div class="joist-pin__editor-notice">
                    <?php echo esc_html__('Pin-Scroll preview — first panel shown. View on the front-end for full behavior.', 'joist'); ?>
                </div>
                <# if (settings.panels && settings.panels[0]) { #>
                    <div class="joist-pin__panel">{{{ settings.panels[0].panel_content }}}</div>
                <# } #>
            </div>
        </section>
        <?php
    }
}
