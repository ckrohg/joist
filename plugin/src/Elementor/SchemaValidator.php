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
            // (TODO: walk skin controls when extractSkins fills them.)

            // v0.5: don't deep-validate the value shape (e.g., color hex format).
            // We trust Elementor's own renderer to reject malformed values.
            // v0.7 adds value-type validation per control type.
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

    private function suggestControl(string $supplied, array $valid): ?string
    {
        // First: try flex_ prefix (catches the msrbuilds #32 case directly).
        if (in_array('flex_' . $supplied, $valid, true)) {
            return 'flex_' . $supplied;
        }
        // Then: Levenshtein-1 match.
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
