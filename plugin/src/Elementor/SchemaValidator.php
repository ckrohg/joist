<?php
declare(strict_types=1);

namespace Joist\Elementor;

/**
 * Schema-validate widget settings against the live introspected catalog.
 *
 * Enforces:
 *   #1   Unknown keys → InvalidSettingsException (with Levenshtein-1
 *         + flex_*-aware suggestions).
 *   #24  Responsive-completeness warning when desktop differs from
 *         default but tablet/mobile are missing.
 *   #27  Inner-flag rejection (elType: section, isInner: false inside
 *         a column; container inside a container with different
 *         flex_direction → must be isInner: true).
 *   #29  Skin-aware validation (loop-grid etc. — settings validated
 *         against the skin's control set).
 */
final class SchemaValidator
{
    public function __construct(private WidgetCatalog $catalog) {}

    /**
     * Walk a tree, validate every widget + every nested layout.
     * Throws on first invalid widget (hard error). Returns array of
     * non-blocking warnings.
     *
     * @return list<array> Warnings (constraint #24 etc.) — non-blocking.
     * @throws InvalidSettingsException
     */
    public function validateTree(array $elements, ?array $parentContext = null): array
    {
        $warnings = [];
        $this->walkValidate($elements, $parentContext, $warnings);
        return $warnings;
    }

    /**
     * @throws InvalidSettingsException
     */
    public function validateWidget(string $widgetType, array $settings): array
    {
        $schema = $this->catalog->getSchema($widgetType);
        if ($schema === null) {
            throw new InvalidSettingsException(
                'schema.unknown_widget',
                "Widget type '{$widgetType}' is not registered on this site.",
                ['widget_type' => $widgetType]
            );
        }

        $validKeys = [];
        $controlByName = [];
        foreach ($schema['controls'] as $control) {
            $validKeys[] = $control['name'];
            $controlByName[$control['name']] = $control;
        }

        $errors = [];
        $warnings = [];

        foreach ($settings as $key => $value) {
            // Skip Elementor internal keys.
            if (in_array($key, ['_globals_', '__globals__', '__dynamic__', '_id', '_element_id', '_skin'], true)) {
                continue;
            }
            // Strip responsive suffix for control lookup.
            $baseKey = $this->stripResponsiveSuffix($key);
            if (!in_array($baseKey, $validKeys, true)) {
                $errors[] = [
                    'path' => "settings.{$key}",
                    'code' => 'schema.unknown_key',
                    'message' => "Widget '{$widgetType}' has no control named '{$baseKey}'.",
                    'suggestion' => $this->suggestControl($baseKey, $validKeys),
                ];
                continue;
            }

            // Skin-aware: if widget has skins and `_skin` is set, validate against that skin.
            // v0.7 deepens this; for v0.5 we just note the warning.

            // SELECT/SELECT2 enum validation — constraint #1 closure.
            // Surfaced during Wave 4c (DisplaySwap): the validator was rejecting
            // unknown keys but accepting any value for SELECT controls, so
            // `joist_display_mode: "wibble"` would round-trip into postmeta
            // silently. Now any control declaring an `options` array enforces
            // its enum; multi-select arrays are walked element-wise.
            $enumError = $this->validateEnumValue($key, $controlByName[$baseKey], $value);
            if ($enumError !== null) {
                $errors[] = $enumError;
            }
        }

        // Constraint #24 — UPDATED 2026-05-13 after research verification:
        // The earlier "responsive_incomplete" warning was based on a wrong
        // assumption. Elementor handles missing _tablet/_mobile keys via CSS
        // cascade (max-width media queries with desktop = unscoped base).
        // Missing keys are CORRECT, not incomplete. Human-edited posts NEVER
        // write per-breakpoint keys when values match desktop.
        // The previous warning misled the agent into "fixing" something that
        // isn't broken. Removed entirely. Responsive fill is now opt-in via
        // the `fill_responsive: true` op param, handled in ResponsiveFiller.

        if (!empty($errors)) {
            throw new InvalidSettingsException(
                'schema.invalid_settings',
                count($errors) === 1
                    ? $errors[0]['message']
                    : sprintf('%d schema errors on widget %s.', count($errors), $widgetType),
                ['errors' => $errors]
            );
        }

        return $warnings;
    }

    /**
     * Constraint #27: inner-flag rejection.
     *
     * Throws if:
     *   - elType: section, isInner: false, and any ancestor is a column
     *   - elType: container, isInner: false, inside a container with
     *     different flex_direction
     */
    private function checkInnerFlag(array $element, ?array $parentContext): void
    {
        if (!isset($element['elType'])) return;
        if (!empty($element['isInner'])) return;

        if ($parentContext === null) return;

        if ($element['elType'] === 'section' && in_array('column', $parentContext['ancestor_types'] ?? [], true)) {
            throw new InvalidSettingsException(
                'schema.inner_flag_mismatch',
                "Section inside a column must have isInner: true. Joist's PatchEngine should infer this automatically; if you're seeing this, the agent supplied an explicit isInner: false.",
                ['element_id' => $element['id'] ?? null]
            );
        }
    }

    private function walkValidate(array $elements, ?array $parentContext, array &$warnings): void
    {
        $ancestorTypes = $parentContext['ancestor_types'] ?? [];

        foreach ($elements as $el) {
            if (!is_array($el)) continue;

            if (isset($el['elType'])) {
                $this->checkInnerFlag($el, $parentContext);
            }

            if (($el['elType'] ?? '') === 'widget' && !empty($el['widgetType'])) {
                $settings = is_array($el['settings'] ?? null) ? $el['settings'] : [];
                $warnings = array_merge($warnings, $this->validateWidget((string) $el['widgetType'], $settings));
            }

            if (isset($el['elements']) && is_array($el['elements'])) {
                $childContext = [
                    'ancestor_types' => array_merge($ancestorTypes, [(string) ($el['elType'] ?? '')]),
                    'parent_elType' => (string) ($el['elType'] ?? ''),
                    'parent_settings' => is_array($el['settings'] ?? null) ? $el['settings'] : [],
                ];
                $this->walkValidate($el['elements'], $childContext, $warnings);
            }
        }
    }

    private function stripResponsiveSuffix(string $key): string
    {
        foreach (['_mobile', '_tablet', '_widescreen', '_laptop'] as $suffix) {
            if (str_ends_with($key, $suffix)) {
                return substr($key, 0, -strlen($suffix));
            }
        }
        return $key;
    }

    /**
     * Validate a value against a SELECT control's enum. Returns an error
     * descriptor or null when the value is acceptable.
     *
     * Acceptable shapes:
     *   - Control has no `options` array (free-form input) → always valid
     *   - Control is not a SELECT-family type → always valid
     *   - Value is empty string or null → always valid (Elementor defaults
     *     often allow empty)
     *   - Value matches an option key (Elementor stores the key, displays
     *     the label)
     *   - Multi-select arrays are walked element-wise; the first invalid
     *     entry is reported
     */
    private function validateEnumValue(string $settingKey, array $control, $value): ?array
    {
        $type = (string) ($control['type'] ?? '');
        $enumTypes = ['select', 'select2', 'choose', 'icons'];
        if (!in_array($type, $enumTypes, true)) {
            return null;
        }
        $options = $control['options'] ?? null;
        if (!is_array($options) || $options === []) {
            return null;
        }

        $allowed = array_map('strval', array_keys($options));

        $checkOne = function ($v) use ($allowed, $settingKey, $type): ?array {
            if ($v === null || $v === '') return null;
            $vStr = is_scalar($v) ? (string) $v : '';
            if ($vStr === '' || in_array($vStr, $allowed, true)) {
                return null;
            }
            return [
                'path' => "settings.{$settingKey}",
                'code' => 'schema.invalid_enum',
                'message' => sprintf(
                    "'%s' is not one of the %d allowed values for '%s'.",
                    $vStr,
                    count($allowed),
                    $settingKey
                ),
                'allowed' => array_slice($allowed, 0, 20),
                'control_type' => $type,
            ];
        };

        // SELECT2 with multiple:true stores an array of keys.
        if (is_array($value)) {
            foreach ($value as $item) {
                $err = $checkOne($item);
                if ($err !== null) return $err;
            }
            return null;
        }

        return $checkOne($value);
    }

    private function suggestControl(string $supplied, array $valid): ?string
    {
        // 1. flex_ prefix (catches the msrbuilds #32 case directly).
        if (in_array('flex_' . $supplied, $valid, true)) {
            return 'flex_' . $supplied;
        }
        // 2. Underscore-prefixed variant: padding → _padding, margin → _margin
        //    (Elementor's flex-child wrapper controls; a top source of wrong guesses).
        if (in_array('_' . $supplied, $valid, true)) {
            return '_' . $supplied;
        }
        // 3. Token-suffix: supplied is a more-verbose form whose meaningful tail IS a valid
        //    control — text_align → align, divider_color → color. Prefer the longest tail.
        $suffixBest = null;
        foreach ($valid as $v) {
            if (strlen($v) >= 3 && str_ends_with($supplied, '_' . $v)) {
                if ($suffixBest === null || strlen($v) > strlen($suffixBest)) {
                    $suffixBest = $v;
                }
            }
        }
        if ($suffixBest !== null) {
            return $suffixBest;
        }
        // 4. Inverse: a valid control is a more-specific form of the supplied key —
        //    text_color → button_text_color. Prefer the shortest (closest) such key.
        $superBest = null;
        foreach ($valid as $v) {
            if (str_ends_with($v, '_' . $supplied)) {
                if ($superBest === null || strlen($v) < strlen($superBest)) {
                    $superBest = $v;
                }
            }
        }
        if ($superBest !== null) {
            return $superBest;
        }
        // 5. Levenshtein-≤2 fallback (real typos).
        $best = null;
        $bestDist = 99;
        foreach ($valid as $v) {
            $d = levenshtein($supplied, $v);
            if ($d < $bestDist) {
                $bestDist = $d;
                $best = $v;
            }
        }
        return $bestDist <= 2 ? $best : null;
    }
}
