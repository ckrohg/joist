<?php
declare(strict_types=1);

namespace Joist\WidgetPack\AnchoredPop;

use Elementor\Controls_Manager;
use Elementor\Widget_Base;
use Joist\WidgetPack\PackBootstrap;

if (!defined('ABSPATH')) exit;

/**
 * @purpose Joist Anchored Pop widget — pure-CSS tooltip / popover / callout
 * tethered to any other element via CSS Anchor Positioning (Baseline 2026:
 * Chrome 125+, Safari 26+, Firefox 147+).
 *
 * Closes the single largest "browsers have it, Elementor doesn't" gap as of
 * 2026-05-26: Elementor exposes nothing for `position-anchor` / `anchor()` /
 * `@position-try`. This widget exposes the primitive natively-editably.
 *
 * Architecture:
 *   - Pure CSS. No JS module. `popover` attribute (Baseline 2024) drives
 *     click-to-open behavior. Hover mode uses CSS `:hover`. Manual mode
 *     leaves the popover visible for site-author-controlled visibility logic
 *     (e.g. inline anchored callouts that are always shown).
 *   - Inline-scoped per-instance CSS via {@see Renderer::renderCss}.
 *   - Inline content authored as WYSIWYG; full-Elementor inner editing is
 *     deferred to v0.9-γ when nested-element infrastructure lands across
 *     the Pack (matches PinScroll's repeater fallback).
 *
 * Accessibility:
 *   - `popover` semantics handle focus-trap + Esc + ARIA via browser.
 *   - Trigger gets `popovertarget` and `aria-expanded` automatically when
 *     using the `popover` attribute.
 *   - Hover mode uses `tabindex="0"` on the trigger so keyboard users can
 *     surface the pop via :focus-within.
 *
 * Failure-mode invariants honored:
 *   - #18 (WP 7.0 iframed editor): no `document.*` access. Pure CSS.
 *   - #29 (schema introspection): every control is registered with
 *     Elementor's standard controls so `WidgetCatalog` picks it up.
 *
 * @see specs/WIDGET_PACK.md §2.9 (the spec being implemented)
 * @see specs/WAVE_0_2026-05-26.md §4 (architecture decision)
 */
final class Widget extends Widget_Base
{
    /**
     * Inline-SVG icon map. Per the Widget Pack truths memo, Elementor's
     * external-SVG icon path has multiple open bugs (#23272/#23915/#24130);
     * we render the icon inline via Elementor's `svg-inline` icon type.
     *
     * @var array<string,string>
     */
    private const JOIST_ICONS = [
        'anchored-pop' =>
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" '
            . 'stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">'
            . '<rect x="2.5" y="3.5" width="9" height="6" rx="1.5"/>'
            . '<rect x="13" y="14" width="8.5" height="6.5" rx="1.5"/>'
            . '<path d="M8 9.5 L14 14"/>'
            . '<circle cx="14" cy="14" r="1.2" fill="currentColor" stroke="none"/>'
            . '</svg>',
    ];

    public function get_name(): string
    {
        return 'joist-anchored-pop';
    }

    public function get_title(): string
    {
        return __('Anchored Pop', 'joist');
    }

    public function get_icon(): string
    {
        // Elementor renders `eicon-` strings as <i class>. For inline SVG
        // we rely on `get_icon_url()` being absent and the icon string being
        // safe-fallback. Until the central JOIST_ICONS pipeline lands, use a
        // stable eicon that visually matches anchored-pop semantics.
        return 'eicon-tooltip';
    }

    /**
     * Inline-SVG icon HTML (used by editor extensions that surface the icon
     * via the JOIST_ICONS map). Public for the central icon registry.
     */
    public static function inlineIcon(): string
    {
        return self::JOIST_ICONS['anchored-pop'];
    }

    public function get_categories(): array
    {
        return [PackBootstrap::CATEGORY_SLUG];
    }

    public function get_keywords(): array
    {
        return ['joist', 'anchored', 'pop', 'tooltip', 'popover', 'callout', 'dropdown', 'anchor'];
    }

    public function get_style_depends(): array
    {
        return ['joist-anchored-pop'];
    }

    /**
     * The 12 named `position-area` values (per CSS Anchor Positioning spec,
     * Baseline 2026). Used both for the primary `position` control and the
     * `fallback_chain` multi-select.
     *
     * @return array<string,string>
     */
    public static function positionAreaOptions(): array
    {
        return [
            'top'          => __('Top', 'joist'),
            'top-start'    => __('Top start', 'joist'),
            'top-end'      => __('Top end', 'joist'),
            'right'        => __('Right', 'joist'),
            'right-start'  => __('Right start', 'joist'),
            'right-end'    => __('Right end', 'joist'),
            'bottom'       => __('Bottom', 'joist'),
            'bottom-start' => __('Bottom start', 'joist'),
            'bottom-end'   => __('Bottom end', 'joist'),
            'left'         => __('Left', 'joist'),
            'left-start'   => __('Left start', 'joist'),
            'left-end'     => __('Left end', 'joist'),
        ];
    }

    protected function register_controls(): void
    {
        // ── Anchor section ────────────────────────────────────────────────
        $this->start_controls_section('section_anchor', [
            'label' => __('Anchor', 'joist'),
            'tab' => Controls_Manager::TAB_CONTENT,
        ]);

        $this->add_control('anchor_target', [
            'label' => __('Anchor target', 'joist'),
            'type' => Controls_Manager::TEXT,
            'description' => __('Element ID (without #) or sibling reference. Maps to anchor-name --joist-anchor-{id}.', 'joist'),
            'placeholder' => 'hero-cta',
        ]);

        $this->add_control('position', [
            'label' => __('Position', 'joist'),
            'type' => Controls_Manager::SELECT,
            'default' => 'top',
            'options' => self::positionAreaOptions(),
            'description' => __('Where the pop sits relative to the anchor element.', 'joist'),
        ]);

        $this->add_responsive_control('offset_px', [
            'label' => __('Offset (px)', 'joist'),
            'type' => Controls_Manager::NUMBER,
            'min' => 0,
            'max' => 200,
            'step' => 1,
            'default' => 8,
            'description' => __('Gap between the pop and the anchor edge.', 'joist'),
        ]);

        $this->add_control('auto_arrow', [
            'label' => __('Show pointer arrow', 'joist'),
            'type' => Controls_Manager::SWITCHER,
            'default' => 'yes',
            'return_value' => 'yes',
            'description' => __('Draws a CSS-only triangle pointing at the anchor.', 'joist'),
        ]);

        $this->add_control('fallback_chain', [
            'label' => __('Fallback positions', 'joist'),
            'type' => Controls_Manager::SELECT2,
            'multiple' => true,
            'default' => ['bottom', 'right', 'left'],
            'options' => self::positionAreaOptions(),
            'description' => __('Alternate positions tried in order when the primary position would overflow the viewport.', 'joist'),
        ]);

        $this->end_controls_section();

        // ── Trigger section ───────────────────────────────────────────────
        $this->start_controls_section('section_trigger', [
            'label' => __('Trigger', 'joist'),
            'tab' => Controls_Manager::TAB_CONTENT,
        ]);

        $this->add_control('trigger_mode', [
            'label' => __('Open on', 'joist'),
            'type' => Controls_Manager::SELECT,
            'default' => 'hover',
            'options' => [
                'hover' => __('Hover (CSS :hover / :focus-within)', 'joist'),
                'click' => __('Click (native popover attribute)', 'joist'),
                'manual' => __('Manual / always visible', 'joist'),
            ],
            'description' => __('Hover and click are pure-CSS; manual leaves the pop visible for inline anchored callouts.', 'joist'),
        ]);

        $this->add_control('trigger_label', [
            'label' => __('Trigger label', 'joist'),
            'type' => Controls_Manager::TEXT,
            'default' => __('Show details', 'joist'),
            'condition' => ['trigger_mode!' => 'manual'],
            'description' => __('Visible label on the trigger button.', 'joist'),
        ]);

        $this->end_controls_section();

        // ── Content section ───────────────────────────────────────────────
        $this->start_controls_section('section_content', [
            'label' => __('Pop content', 'joist'),
            'tab' => Controls_Manager::TAB_CONTENT,
        ]);

        $this->add_control('inner_content', [
            'label' => __('Inner content', 'joist'),
            'type' => Controls_Manager::WYSIWYG,
            'default' => __('Anchored pop content goes here.', 'joist'),
            'description' => __('Pop content. Full Elementor inner-container editing arrives in v0.9-γ.', 'joist'),
        ]);

        $this->end_controls_section();

        // ── Style section ─────────────────────────────────────────────────
        $this->start_controls_section('section_style', [
            'label' => __('Style', 'joist'),
            'tab' => Controls_Manager::TAB_STYLE,
        ]);

        $this->add_control('pop_background', [
            'label' => __('Background', 'joist'),
            'type' => Controls_Manager::COLOR,
            'default' => '#1a1a1a',
            'selectors' => [
                '{{WRAPPER}} .joist-anchored-pop__pop' => 'background: {{VALUE}};',
                '{{WRAPPER}} .joist-anchored-pop__arrow' => 'background: {{VALUE}};',
            ],
        ]);

        $this->add_control('pop_text', [
            'label' => __('Text color', 'joist'),
            'type' => Controls_Manager::COLOR,
            'default' => '#ffffff',
            'selectors' => [
                '{{WRAPPER}} .joist-anchored-pop__pop' => 'color: {{VALUE}};',
            ],
        ]);

        $this->add_control('pop_padding', [
            'label' => __('Padding', 'joist'),
            'type' => Controls_Manager::DIMENSIONS,
            'size_units' => ['px', 'em', '%'],
            'default' => ['top' => '8', 'right' => '12', 'bottom' => '8', 'left' => '12', 'unit' => 'px', 'isLinked' => false],
            'selectors' => [
                '{{WRAPPER}} .joist-anchored-pop__pop' => 'padding: {{TOP}}{{UNIT}} {{RIGHT}}{{UNIT}} {{BOTTOM}}{{UNIT}} {{LEFT}}{{UNIT}};',
            ],
        ]);

        $this->add_control('pop_radius', [
            'label' => __('Border radius', 'joist'),
            'type' => Controls_Manager::SLIDER,
            'size_units' => ['px', 'em'],
            'range' => ['px' => ['min' => 0, 'max' => 32]],
            'default' => ['unit' => 'px', 'size' => 6],
            'selectors' => [
                '{{WRAPPER}} .joist-anchored-pop__pop' => 'border-radius: {{SIZE}}{{UNIT}};',
            ],
        ]);

        $this->end_controls_section();
    }

    protected function render(): void
    {
        $settings = $this->get_settings_for_display();
        $widgetId = $this->get_id();

        $isEdit = class_exists('\Elementor\Plugin')
            && \Elementor\Plugin::$instance->editor->is_edit_mode();

        echo Renderer::renderInstance($widgetId, $settings, $isEdit); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped — Renderer escapes per-field
    }

    protected function content_template(): void
    {
        // Editor template — show the pop in its "open" state with a notice so
        // designers can edit content directly. Real anchor positioning + the
        // popover attribute do not behave inside Elementor's editor iframe
        // (constraint #18 + popover-in-iframe quirks), so we always show
        // an inline preview.
        ?>
        <div class="joist-anchored-pop joist-anchored-pop--editor">
            <div class="joist-anchored-pop__editor-notice">
                <?php echo esc_html__('Anchored Pop — editor preview is static. View on the front-end for anchor-positioned behavior.', 'joist'); ?>
            </div>
            <# if (settings.trigger_mode !== 'manual') { #>
                <button type="button" class="joist-anchored-pop__trigger">{{{ settings.trigger_label }}}</button>
            <# } #>
            <div class="joist-anchored-pop__pop joist-anchored-pop__pop--editor">
                {{{ settings.inner_content }}}
                <# if (settings.auto_arrow === 'yes') { #>
                    <span class="joist-anchored-pop__arrow" aria-hidden="true"></span>
                <# } #>
            </div>
        </div>
        <?php
    }
}
