<?php
declare(strict_types=1);

namespace Joist\WidgetPack\AnchoredPop;

if (!defined('ABSPATH')) exit;

/**
 * @purpose Per-instance HTML + scoped CSS renderer for Anchored Pop. Emits
 * `position-anchor` / `position-area` / `position-try-fallbacks` /
 * `@position-try` rules sized to a single widget instance ID, so multiple
 * Anchored Pops on the same page never collide on anchor names.
 *
 * Kept distinct from Widget.php so the CSS-emission contract is unit-testable
 * without instantiating an Elementor widget (the agent's schema validator
 * exercises this path directly).
 */
final class Renderer
{
    /**
     * Render the full widget instance (markup + scoped CSS) for a single
     * Anchored Pop.
     *
     * @param array<string,mixed> $settings
     */
    public static function renderInstance(string $widgetId, array $settings, bool $isEdit): string
    {
        $anchorTarget = self::sanitizeAnchorName((string) ($settings['anchor_target'] ?? ''));
        $position = self::sanitizePosition((string) ($settings['position'] ?? 'top'));
        $triggerMode = self::sanitizeTrigger((string) ($settings['trigger_mode'] ?? 'hover'));
        $autoArrow = ($settings['auto_arrow'] ?? 'yes') === 'yes';
        $fallbacks = self::sanitizeFallbacks(is_array($settings['fallback_chain'] ?? null) ? $settings['fallback_chain'] : []);
        $offsetPx = (int) ($settings['offset_px'] ?? 8);
        $triggerLabel = (string) ($settings['trigger_label'] ?? '');
        $innerContent = (string) ($settings['inner_content'] ?? '');

        $popId = 'joist-pop-' . $widgetId;
        $anchorVarName = '--joist-anchor-' . ($anchorTarget !== '' ? $anchorTarget : $widgetId);
        $tryName = '--joist-try-' . $widgetId;

        $css = self::buildCss($widgetId, $popId, $anchorVarName, $tryName, $position, $offsetPx, $fallbacks, $autoArrow);

        $arrow = $autoArrow
            ? '<span class="joist-anchored-pop__arrow" aria-hidden="true"></span>'
            : '';

        $usePopover = ($triggerMode === 'click');
        $popoverAttr = $usePopover ? ' popover="auto" id="' . esc_attr($popId) . '"' : '';

        $popAttrs = ' class="joist-anchored-pop__pop" data-trigger="' . esc_attr($triggerMode) . '"';
        if (!$usePopover) {
            // Hover + manual modes still need a stable id for the
            // anchor reference (anchor names are CSS-side; the id is for
            // a11y references like aria-describedby).
            $popAttrs .= ' id="' . esc_attr($popId) . '"';
        }

        $triggerHtml = '';
        if ($triggerMode !== 'manual') {
            $triggerAttrs = ' type="button" class="joist-anchored-pop__trigger" tabindex="0"';
            if ($usePopover) {
                $triggerAttrs .= ' popovertarget="' . esc_attr($popId) . '"';
            } else {
                // Hover mode: aria-describedby ties the trigger to the pop
                // for screen-reader users; :focus-within reveals it.
                $triggerAttrs .= ' aria-describedby="' . esc_attr($popId) . '"';
            }
            $triggerHtml = '<button' . $triggerAttrs . '>' . esc_html($triggerLabel) . '</button>';
        }

        $editorNotice = $isEdit
            ? '<div class="joist-anchored-pop__editor-notice">'
                . esc_html__('Anchored Pop — editor preview is static. View on the front-end for anchor-positioned behavior.', 'joist')
                . '</div>'
            : '';

        $wrapperClass = 'joist-anchored-pop'
            . ($isEdit ? ' joist-anchored-pop--editor' : '')
            . ' joist-anchored-pop--trigger-' . $triggerMode;

        return '<style>' . $css . '</style>'
            . '<div class="' . esc_attr($wrapperClass) . '" data-anchor-target="' . esc_attr($anchorTarget) . '">'
            . $editorNotice
            . $triggerHtml
            . '<div' . $popAttrs . '>'
            . wp_kses_post($innerContent)
            . $arrow
            . '</div>'
            . '</div>';
    }

    /**
     * Build the scoped CSS block for one widget instance. Public for testing —
     * this is the parse_css smoke-test target.
     *
     * @param array<int,string> $fallbacks
     */
    public static function buildCss(
        string $widgetId,
        string $popId,
        string $anchorVarName,
        string $tryName,
        string $position,
        int $offsetPx,
        array $fallbacks,
        bool $autoArrow
    ): string {
        $scope = '.elementor-element-' . preg_replace('/[^a-zA-Z0-9_-]/', '', $widgetId);

        $css = '';

        // Anchor name on the referenced element. The site author marks the
        // anchor by adding a CSS ID matching `anchor_target`; we emit a rule
        // that assigns the anchor-name to that element.
        $css .= '[id="' . esc_attr(self::stripCssPrefix($anchorVarName)) . '"] { anchor-name: ' . esc_attr($anchorVarName) . '; }';

        // @position-try rules — one per fallback position. Emitted first so
        // the names exist when the pop selector references them.
        $tryRefs = [];
        foreach ($fallbacks as $i => $fb) {
            $name = $tryName . '-' . $i;
            $tryRefs[] = $name;
            $css .= '@position-try ' . esc_attr($name) . ' {';
            $css .= 'position-area: ' . esc_attr($fb) . ';';
            $css .= '}';
        }

        // The pop itself: position-anchor + position-area + fallback chain.
        $css .= $scope . ' .joist-anchored-pop__pop {';
        $css .= 'position: fixed;';
        $css .= 'position-anchor: ' . esc_attr($anchorVarName) . ';';
        $css .= 'position-area: ' . esc_attr($position) . ';';
        $css .= 'margin: ' . (int) $offsetPx . 'px;';
        if (!empty($tryRefs)) {
            $css .= 'position-try-fallbacks: ' . esc_attr(implode(', ', $tryRefs)) . ';';
        }
        $css .= '}';

        if ($autoArrow) {
            // CSS triangle pointing toward the anchor (rotated per position).
            $rotation = self::arrowRotationFor($position);
            $css .= $scope . ' .joist-anchored-pop__arrow {';
            $css .= 'position: absolute;';
            $css .= 'width: 10px; height: 10px;';
            $css .= 'transform: rotate(' . esc_attr($rotation) . 'deg);';
            $css .= 'clip-path: polygon(50% 0, 100% 100%, 0 100%);';
            $css .= '}';
        }

        return $css;
    }

    /**
     * Sanitize anchor name input to CSS-safe characters. Empty input keeps
     * downstream rules harmless (anchor-name is just unused).
     */
    private static function sanitizeAnchorName(string $raw): string
    {
        $raw = ltrim($raw, '#.');
        return preg_replace('/[^a-zA-Z0-9_-]/', '', $raw) ?? '';
    }

    /**
     * Strip the `--joist-anchor-` CSS-var prefix so we can use the suffix
     * as the actual element id selector value.
     */
    private static function stripCssPrefix(string $varName): string
    {
        return (string) preg_replace('/^--joist-anchor-/', '', $varName);
    }

    private static function sanitizePosition(string $raw): string
    {
        $valid = array_keys(Widget::positionAreaOptions());
        return in_array($raw, $valid, true) ? $raw : 'top';
    }

    private static function sanitizeTrigger(string $raw): string
    {
        return in_array($raw, ['hover', 'click', 'manual'], true) ? $raw : 'hover';
    }

    /**
     * @param array<int|string,mixed> $raw
     * @return array<int,string>
     */
    private static function sanitizeFallbacks(array $raw): array
    {
        $valid = array_keys(Widget::positionAreaOptions());
        $out = [];
        foreach ($raw as $val) {
            $val = (string) $val;
            if (in_array($val, $valid, true)) $out[] = $val;
        }
        return $out;
    }

    /**
     * Pick a rotation that points the arrow tip at the anchor. The arrow's
     * native orientation is "tip up" — rotate based on position-area.
     */
    private static function arrowRotationFor(string $position): int
    {
        // The arrow's tip points away from the pop body toward the anchor.
        // For position-area=top, the pop sits above the anchor, so the arrow
        // points down (180deg). And so on.
        if (str_starts_with($position, 'top')) return 180;
        if (str_starts_with($position, 'bottom')) return 0;
        if (str_starts_with($position, 'left')) return 90;
        if (str_starts_with($position, 'right')) return 270;
        return 180;
    }
}
