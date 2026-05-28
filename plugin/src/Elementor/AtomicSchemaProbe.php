<?php
declare(strict_types=1);

namespace Joist\Elementor;

use Joist\Core\Logger;

/**
 * @purpose Introspect the live Elementor V4 atomic-elements registry and
 *          surface the registered atomic element types + their attribute
 *          schemas. This is the V4 counterpart of WidgetCatalog (which
 *          handles V3 widgets).
 *
 * V4 ATOMIC INTROSPECTION SURFACE (verified 2026-05-28 from main):
 *   - Enumeration: `\Elementor\Plugin::$instance->elements_manager->get_element_types()`
 *     returns `Element_Base[]`. We filter to atomic by `instanceof`:
 *       * `\Elementor\Modules\AtomicWidgets\Elements\Base\Atomic_Element_Base`
 *       * `\Elementor\Modules\AtomicWidgets\Elements\Base\Atomic_Widget_Base`
 *   - Per-element schema (trait `Has_Atomic_Base`):
 *       * `public static function get_props_schema(): array<string, Prop_Type>`
 *       * `public function get_atomic_controls(): array`
 *       * `public function get_atomic_settings(): array`
 *   - V3 widget enumeration (for comparison; not used here):
 *       * `\Elementor\Plugin::$instance->widgets_manager->get_widget_types()`
 *
 * SOURCE URLS:
 *   - https://github.com/elementor/elementor/blob/main/modules/atomic-widgets/module.php
 *   - https://github.com/elementor/elementor/blob/main/modules/atomic-widgets/elements/base/atomic-element-base.php
 *   - https://github.com/elementor/elementor/blob/main/modules/atomic-widgets/elements/base/atomic-widget-base.php
 *   - https://github.com/elementor/elementor/blob/main/modules/atomic-widgets/elements/base/has-atomic-base.php
 *   - https://github.com/elementor/elementor/blob/main/includes/managers/elements.php
 *
 * DESIGN PRINCIPLES (failure-mode constraints):
 *   - #1  Validate every write against the live introspected schema.
 *         This class provides the introspected schema; SchemaValidator
 *         consumes it for V4 ops in a future wave.
 *   - #2  Read-after-write — not this class's job; AtomicDocumentWriter
 *         handles it.
 *   - #16 Refuse silently-failing operations — if the registry surface is
 *         missing or shaped differently than we expect, we return a typed
 *         `atomic_schema_unintrospectable` error and let the caller refuse.
 *         We do NOT pretend to know an empty schema.
 *   - #17 Detect Elementor major before introspecting — caller must pass
 *         a RoutingDecision with `kind == atomic_v4` (we sanity-check it).
 *
 * IMPORTANT: this class MUST work even when issue #35888 is open. The
 * #35888 breakage is on the editor JS side (`elementor.documents.getCurrent()
 * is null`), not server-side introspection — server-side `Elements_Manager`
 * enumeration is stable across the broken-save window. We never depend on
 * `documents->getCurrent()`.
 */
final class AtomicSchemaProbe
{
    /** Atomic element-base FQCN (verified from main). */
    public const ATOMIC_ELEMENT_BASE_CLASS =
        '\\Elementor\\Modules\\AtomicWidgets\\Elements\\Base\\Atomic_Element_Base';
    /** Atomic widget-base FQCN (verified from main). */
    public const ATOMIC_WIDGET_BASE_CLASS =
        '\\Elementor\\Modules\\AtomicWidgets\\Elements\\Base\\Atomic_Widget_Base';

    /**
     * Probe the live atomic-elements registry. Returns either:
     *   - `['ok' => true, 'elements' => [...]]`  on success
     *   - `['ok' => false, 'code' => 'atomic_schema_unintrospectable', 'message' => '...', 'details' => [...]]`
     *     when the live registry is missing or shaped differently than we expect
     *
     * The success shape is:
     *   elements: list<array{
     *     element_type: string,          // e.g. 'e-flexbox', 'e-heading'
     *     class: string,                 // FQCN of the registered element
     *     is_widget: bool,               // true if Atomic_Widget_Base, false if Atomic_Element_Base
     *     controls: array,               // raw output of get_atomic_controls() if available
     *     props_schema: array,           // keys + types from get_props_schema()
     *     introspection_notes: list<string>
     *   }>
     *
     * @return array{ok: true, elements: list<array<string, mixed>>}
     *       | array{ok: false, code: string, message: string, details: array<string, mixed>}
     */
    public function probe(RoutingDecision $decision): array
    {
        // Sanity: caller should have already routed to this class only on
        // atomic_v4. We don't trust the caller — re-check defensively.
        if (!$decision->isAtomicV4()) {
            return [
                'ok' => false,
                'code' => 'atomic_schema_unintrospectable',
                'message' => sprintf(
                    'AtomicSchemaProbe called with kind=%s; only atomic_v4 is introspectable.',
                    $decision->kind
                ),
                'details' => [
                    'routing_decision' => $decision->toArray(),
                    'reason' => 'wrong_routing_kind',
                ],
            ];
        }

        if (!class_exists('\\Elementor\\Plugin')) {
            return $this->unintrospectable(
                'Elementor\\Plugin class is not loaded; cannot probe atomic registry.',
                ['reason' => 'elementor_plugin_class_missing']
            );
        }

        if (!class_exists(self::ATOMIC_ELEMENT_BASE_CLASS) && !class_exists(self::ATOMIC_WIDGET_BASE_CLASS)) {
            return $this->unintrospectable(
                sprintf(
                    'Neither %s nor %s exist on this Elementor install. Atomic-Widgets module is not loaded.',
                    self::ATOMIC_ELEMENT_BASE_CLASS,
                    self::ATOMIC_WIDGET_BASE_CLASS
                ),
                [
                    'reason' => 'atomic_base_classes_missing',
                    'expected_classes' => [
                        self::ATOMIC_ELEMENT_BASE_CLASS,
                        self::ATOMIC_WIDGET_BASE_CLASS,
                    ],
                    'elementor_version' => $decision->version,
                ]
            );
        }

        // Walk the elements_manager. We avoid touching documents->getCurrent()
        // entirely (which is the surface broken by #35888) — this is a pure
        // registry read.
        $instance = \Elementor\Plugin::$instance ?? null;
        if (!is_object($instance)) {
            return $this->unintrospectable(
                'Elementor\\Plugin::$instance is not an object.',
                ['reason' => 'plugin_instance_missing']
            );
        }

        $elementsManager = $instance->elements_manager ?? null;
        if (!is_object($elementsManager) || !method_exists($elementsManager, 'get_element_types')) {
            return $this->unintrospectable(
                'Elementor\\Plugin::$instance->elements_manager does not expose get_element_types().',
                [
                    'reason' => 'elements_manager_surface_drift',
                    'has_manager' => is_object($elementsManager),
                    'has_method' => is_object($elementsManager) ? method_exists($elementsManager, 'get_element_types') : false,
                    // TODO(v4-api-verify-on-live-install): if Elementor renames
                    // get_element_types() in a future release, this surfaces it
                    // as a typed error rather than a fatal.
                ]
            );
        }

        try {
            $allTypes = $elementsManager->get_element_types();
        } catch (\Throwable $e) {
            return $this->unintrospectable(
                'elements_manager->get_element_types() threw: ' . $e->getMessage(),
                [
                    'reason' => 'enumeration_threw',
                    'error' => $e->getMessage(),
                ]
            );
        }

        if (!is_array($allTypes)) {
            return $this->unintrospectable(
                'elements_manager->get_element_types() did not return an array.',
                ['reason' => 'enumeration_wrong_shape', 'actual_type' => gettype($allTypes)]
            );
        }

        $elements = [];
        foreach ($allTypes as $el) {
            if (!is_object($el)) {
                continue;
            }
            $isWidget = is_a($el, ltrim(self::ATOMIC_WIDGET_BASE_CLASS, '\\'));
            $isElement = is_a($el, ltrim(self::ATOMIC_ELEMENT_BASE_CLASS, '\\'));
            if (!$isWidget && !$isElement) {
                // Legacy V3 element; skip — handled by WidgetCatalog.
                continue;
            }

            $shaped = $this->shapeElement($el, $isWidget);
            if ($shaped !== null) {
                $elements[] = $shaped;
            }
        }

        // It's legitimately possible to have an atomic-capable install with
        // zero registered atomic types (e.g. all opt-in modules disabled).
        // That's NOT an introspection failure — it's an empty registry.
        // We surface the empty-array success path with a note.
        $note = count($elements) === 0
            ? 'Elements_Manager enumerated successfully but no atomic element types are registered on this install.'
            : sprintf('Probed %d atomic element type(s).', count($elements));

        Logger::debug('joist.atomic_schema.probed', [
            'count' => count($elements),
            'elementor_version' => $decision->version,
            'note' => $note,
        ]);

        return [
            'ok' => true,
            'elements' => $elements,
            'count' => count($elements),
            'note' => $note,
        ];
    }

    /**
     * Reduce a single registered atomic element/widget object into the
     * serializable schema shape. Returns null if we can't extract anything
     * useful (which surfaces upstream as a missing entry, not a probe failure
     * — one weird element shouldn't fail the whole probe).
     *
     * @param object $el
     * @return array<string, mixed>|null
     */
    private function shapeElement(object $el, bool $isWidget): ?array
    {
        $class = get_class($el);
        $notes = [];

        // get_name() comes from the V3 Element_Base; on atomic elements it
        // returns the V4 slug ('e-heading', etc).
        $type = null;
        if (method_exists($el, 'get_name')) {
            try {
                $type = (string) $el->get_name();
            } catch (\Throwable $e) {
                $notes[] = sprintf('get_name() threw: %s', $e->getMessage());
            }
        }
        if ($type === null || $type === '') {
            // No type slug — useless to consumers. Skip.
            return null;
        }

        // Props schema: static method, returns array<string, Prop_Type>.
        $propsSchema = [];
        if (method_exists($el, 'get_props_schema')) {
            try {
                $raw = $class::get_props_schema();
                if (is_array($raw)) {
                    foreach ($raw as $key => $propType) {
                        $propsSchema[(string) $key] = $this->describePropType($propType);
                    }
                }
            } catch (\Throwable $e) {
                $notes[] = sprintf('get_props_schema() threw: %s', $e->getMessage());
            }
        } else {
            $notes[] = 'get_props_schema() not exposed; falling back to controls only.';
        }

        // Atomic controls: instance method via Has_Atomic_Base trait.
        $controls = [];
        if (method_exists($el, 'get_atomic_controls')) {
            try {
                $raw = $el->get_atomic_controls();
                if (is_array($raw)) {
                    $controls = $raw;
                }
            } catch (\Throwable $e) {
                $notes[] = sprintf('get_atomic_controls() threw: %s', $e->getMessage());
            }
        } else {
            $notes[] = 'get_atomic_controls() not exposed.';
        }

        return [
            'element_type' => $type,
            'class' => $class,
            'is_widget' => $isWidget,
            'controls' => $controls,
            'props_schema' => $propsSchema,
            'introspection_notes' => $notes,
        ];
    }

    /**
     * Reduce a Prop_Type object to a JSON-serializable descriptor. The full
     * Prop_Type API has many fields (kind, default, validators, etc.); we
     * pull the ones available via documented public methods and fall back
     * to a class-name marker when we can't extract more.
     *
     * @param mixed $propType
     * @return array<string, mixed>
     */
    private function describePropType($propType): array
    {
        if (!is_object($propType)) {
            return ['kind' => gettype($propType), 'raw' => true];
        }
        $out = ['class' => get_class($propType)];
        foreach (['get_key', 'get_kind', 'get_default', 'get_type'] as $accessor) {
            if (method_exists($propType, $accessor)) {
                try {
                    $val = $propType->{$accessor}();
                    // Normalize: stringify scalars, take class-name for objects.
                    if (is_scalar($val) || $val === null) {
                        $out[substr($accessor, 4)] = $val;
                    } elseif (is_object($val)) {
                        $out[substr($accessor, 4)] = ['class' => get_class($val)];
                    } elseif (is_array($val)) {
                        $out[substr($accessor, 4)] = $val;
                    }
                } catch (\Throwable $e) {
                    // Best-effort introspection; swallow individual accessor errors.
                }
            }
        }
        return $out;
    }

    /**
     * Build the typed `atomic_schema_unintrospectable` error envelope.
     *
     * @param array<string, mixed> $details
     * @return array{ok: false, code: string, message: string, details: array<string, mixed>}
     */
    private function unintrospectable(string $message, array $details = []): array
    {
        return [
            'ok' => false,
            'code' => 'atomic_schema_unintrospectable',
            'message' => $message,
            'details' => $details,
        ];
    }
}
