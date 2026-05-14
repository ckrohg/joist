<?php
declare(strict_types=1);

namespace Joist\Elementor;

/**
 * Responsive fill — OPT-IN (corrected 2026-05-13).
 *
 * Earlier spec (#24) had this as default-on auto-fill. Research verified
 * Elementor handles missing `_tablet`/`_mobile` keys via CSS cascade
 * (max-width media queries, desktop = unscoped base rule). Missing keys
 * are CORRECT, not incomplete. Human-edited posts never write per-breakpoint
 * keys when values match desktop.
 *
 * Default: don't fill. Match human baseline byte-for-byte.
 * Opt-in: caller sets `fill_responsive: true` on the patch op.
 *
 * When filling, honors edge cases verified in research stream:
 *   - Schema-declared `tablet_default`/`mobile_default` → skip (clobbering
 *     would override intentional per-breakpoint defaults from the widget)
 *   - Control `condition` evaluates false against current desktop settings → skip
 *   - `hide_tablet`/`hide_mobile` flags on the element → skip ALL fills for it
 *   - Compound value shapes preserved verbatim (dimension/typography/slider)
 *   - Cascade-correct: mobile fills from tablet if tablet was explicitly set,
 *     else from desktop
 *   - `widescreen` is min-width (cascades up from desktop), NEVER auto-fill
 *   - Idempotent: existing `_tablet` values never overwritten
 */
final class ResponsiveFiller
{
    /** Breakpoints in cascade order (largest → smallest), excluding desktop+widescreen. */
    private const CASCADE_ORDER = ['laptop', 'tablet_extra', 'tablet', 'mobile_extra', 'mobile'];

    public function __construct(private WidgetCatalog $catalog) {}

    /**
     * Walk an element tree and fill responsive controls on widget settings.
     * Returns the tree with fills applied (or unchanged if fill_responsive is false).
     *
     * @param list<string> $kitBreakpoints  Active breakpoints in the kit; empty = use defaults.
     * @return array{0: array, 1: list<array>}  [tree, fills_applied_log]
     */
    public function fill(array $elements, bool $optIn, array $kitBreakpoints = []): array
    {
        if (!$optIn) {
            return [$elements, []];
        }
        $breakpoints = empty($kitBreakpoints)
            ? ['tablet', 'mobile']
            : array_values(array_intersect(self::CASCADE_ORDER, $kitBreakpoints));

        $log = [];
        $tree = $this->walk($elements, $breakpoints, $log);
        return [$tree, $log];
    }

    private function walk(array $elements, array $breakpoints, array &$log): array
    {
        foreach ($elements as $i => $el) {
            if (!is_array($el)) continue;

            if (($el['elType'] ?? '') === 'widget' && !empty($el['widgetType'])) {
                $settings = is_array($el['settings'] ?? null) ? $el['settings'] : [];

                // Edge case: hide_tablet / hide_mobile → skip all fills for this element.
                $hideTablet = !empty($settings['hide_tablet']);
                $hideMobile = !empty($settings['hide_mobile']);
                if ($hideTablet && $hideMobile) {
                    continue;
                }

                $elements[$i]['settings'] = $this->fillWidgetSettings(
                    (string) $el['widgetType'],
                    $settings,
                    $breakpoints,
                    (string) ($el['id'] ?? ''),
                    $log
                );
            }

            if (isset($el['elements']) && is_array($el['elements'])) {
                $elements[$i]['elements'] = $this->walk($el['elements'], $breakpoints, $log);
            }
        }
        return $elements;
    }

    private function fillWidgetSettings(string $widgetType, array $settings, array $breakpoints, string $elementId, array &$log): array
    {
        $schema = $this->catalog->getSchema($widgetType);
        if ($schema === null) {
            return $settings; // Unknown widget — leave alone (SchemaValidator will catch elsewhere).
        }

        foreach ($schema['controls'] as $control) {
            $name = $control['name'];
            if (empty($control['responsive'])) continue;
            if (!isset($settings[$name])) continue; // No desktop value to propagate.

            $default = $control['default'] ?? null;
            if ($settings[$name] === $default || $settings[$name] === null) {
                continue; // Desktop matches default — nothing to cascade.
            }

            // Condition-aware skip: if the control has a condition and it's not satisfied
            // by current desktop settings, the control isn't active — don't bloat.
            if (!$this->conditionMet($control, $settings)) {
                continue;
            }

            // Schema-declared tablet_default/mobile_default — sacred, never clobber.
            $hasTabletDefault = array_key_exists('tablet_default', $control)
                && $control['tablet_default'] !== $default;
            $hasMobileDefault = array_key_exists('mobile_default', $control)
                && $control['mobile_default'] !== $default;

            // Cascade-correct fill: tablet fills from desktop; mobile fills from tablet if set, else desktop.
            $lastValue = $settings[$name];
            foreach ($breakpoints as $bp) {
                $bpKey = $name . '_' . $bp;
                if (isset($settings[$bpKey])) {
                    // Idempotent — never overwrite an explicit value.
                    $lastValue = $settings[$bpKey];
                    continue;
                }
                if ($bp === 'tablet' && $hasTabletDefault) continue;
                if ($bp === 'mobile' && $hasMobileDefault) continue;
                if (str_starts_with($bp, 'tablet') && $this->isHidden($settings, 'tablet')) continue;
                if (str_starts_with($bp, 'mobile') && $this->isHidden($settings, 'mobile')) continue;

                // Deep-copy compound values (dimension/typography/slider objects).
                $settings[$bpKey] = $this->deepCopy($lastValue);
                $log[] = [
                    'element_id' => $elementId,
                    'widget_type' => $widgetType,
                    'control' => $name,
                    'breakpoint' => $bp,
                    'value_source' => $lastValue === $settings[$name] ? 'desktop' : 'cascade',
                ];
            }
        }

        return $settings;
    }

    /**
     * Evaluate a control's `condition` array against current settings.
     * Condition is `{control_name: expected_value}` — all keys must match.
     * Missing condition key means the control is always active.
     */
    private function conditionMet(array $control, array $settings): bool
    {
        if (!isset($control['condition']) || !is_array($control['condition'])) {
            return true;
        }
        foreach ($control['condition'] as $k => $expected) {
            $actual = $settings[$k] ?? null;
            if (is_array($expected)) {
                if (!in_array($actual, $expected, true)) return false;
            } else {
                if ($actual !== $expected) return false;
            }
        }
        return true;
    }

    private function isHidden(array $settings, string $bp): bool
    {
        return !empty($settings['hide_' . $bp]);
    }

    /**
     * Deep copy compound values (associative arrays for dimension / typography /
     * slider controls preserve their full shape including unit, isLinked, etc.).
     *
     * @param mixed $value
     * @return mixed
     */
    private function deepCopy($value)
    {
        if (is_array($value)) {
            $out = [];
            foreach ($value as $k => $v) {
                $out[$k] = $this->deepCopy($v);
            }
            return $out;
        }
        return $value;
    }
}
