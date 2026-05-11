<?php
declare(strict_types=1);

namespace Joist\Elementor;

/**
 * Introspects installed Elementor widgets via `widgets_manager->get_widget_types()`.
 *
 * Schema is cached in a transient keyed by Elementor version + Pro version,
 * invalidated on plugin activate/update/deactivate.
 *
 * Returns control schemas with `breakpoints[]`, `supports_globals`, `skins{}`
 * to drive constraints #24/#26/#29.
 */
final class WidgetCatalog
{
    private const CACHE_TRANSIENT = 'joist_widget_schemas';
    private const CACHE_VERSION_OPT = 'joist_widget_schemas_version';

    /** @return list<array{type:string,label:string,category:string,is_pro:bool,plugin_source:string}> */
    public function listAll(): array
    {
        if (!class_exists('\Elementor\Plugin')) return [];
        $types = \Elementor\Plugin::$instance->widgets_manager->get_widget_types();
        $out = [];
        foreach ($types as $type => $widget) {
            $out[] = [
                'type' => $type,
                'label' => method_exists($widget, 'get_title') ? $widget->get_title() : $type,
                'category' => $this->primaryCategory($widget),
                'is_pro' => $this->isPro($widget),
                'plugin_source' => $this->pluginSource($widget),
            ];
        }
        return $out;
    }

    public function isRegistered(string $widgetType): bool
    {
        if (!class_exists('\Elementor\Plugin')) return false;
        $types = \Elementor\Plugin::$instance->widgets_manager->get_widget_types();
        return isset($types[$widgetType]);
    }

    /**
     * Full control schema for one widget — what `settings` keys are valid,
     * their types, defaults, responsive flag, breakpoints, global support,
     * skin variants.
     *
     * @return ?array{type:string, label:string, category:string, controls:array, supports_inner_section:bool, skins:?array}
     */
    public function getSchema(string $widgetType): ?array
    {
        $cached = $this->loadCachedSchemas();
        if (isset($cached[$widgetType])) {
            return $cached[$widgetType];
        }

        if (!class_exists('\Elementor\Plugin')) return null;
        $types = \Elementor\Plugin::$instance->widgets_manager->get_widget_types();
        if (!isset($types[$widgetType])) return null;

        $widget = $types[$widgetType];
        $schema = $this->buildSchemaForWidget($widget, $widgetType);

        $cached[$widgetType] = $schema;
        set_transient(self::CACHE_TRANSIENT, $cached, 6 * HOUR_IN_SECONDS);

        return $schema;
    }

    /**
     * Build a list of valid widget control names — useful for schema suggestions.
     *
     * @return list<string>
     */
    public function controlNames(string $widgetType): array
    {
        $schema = $this->getSchema($widgetType);
        if ($schema === null) return [];
        return array_map(fn($c) => $c['name'], $schema['controls']);
    }

    public function invalidateCache(): void
    {
        delete_transient(self::CACHE_TRANSIENT);
        update_option(self::CACHE_VERSION_OPT, $this->currentVersion(), false);
    }

    private function loadCachedSchemas(): array
    {
        $cached = get_transient(self::CACHE_TRANSIENT);
        if (!is_array($cached)) return [];
        $storedVersion = get_option(self::CACHE_VERSION_OPT, '');
        if ($storedVersion !== $this->currentVersion()) {
            delete_transient(self::CACHE_TRANSIENT);
            update_option(self::CACHE_VERSION_OPT, $this->currentVersion(), false);
            return [];
        }
        return $cached;
    }

    private function currentVersion(): string
    {
        $el = defined('ELEMENTOR_VERSION') ? ELEMENTOR_VERSION : '0';
        $pro = defined('ELEMENTOR_PRO_VERSION') ? ELEMENTOR_PRO_VERSION : '0';
        return $el . '|' . $pro;
    }

    private function buildSchemaForWidget($widget, string $type): array
    {
        $controls = method_exists($widget, 'get_controls') ? $widget->get_controls() : [];
        $controlSchemas = [];

        foreach ($controls as $name => $control) {
            if (!is_array($control)) continue;
            $controlSchemas[] = $this->normalizeControl($name, $control);
        }

        $skins = $this->extractSkins($widget);

        return [
            'type' => $type,
            'label' => method_exists($widget, 'get_title') ? $widget->get_title() : $type,
            'category' => $this->primaryCategory($widget),
            'controls' => $controlSchemas,
            'supports_inner_section' => false, // updated below per-widget if needed
            'skins' => $skins, // null if no skins
        ];
    }

    private function normalizeControl(string $name, array $control): array
    {
        $type = (string) ($control['type'] ?? 'text');

        // Detect responsive support.
        $isResponsive = false;
        if (isset($control['responsive']) && $control['responsive']) {
            $isResponsive = true;
        }
        if (isset($control['is_responsive']) && $control['is_responsive']) {
            $isResponsive = true;
        }

        // Detect global support (color + typography controls).
        $supportsGlobals = in_array($type, ['color', 'colors', 'typography', 'font'], true);
        if (isset($control['global']) && is_array($control['global']) && !empty($control['global']['active'])) {
            $supportsGlobals = true;
        }

        $schema = [
            'name' => $name,
            'type' => strtoupper($type),
            'label' => (string) ($control['label'] ?? $name),
            'default' => $control['default'] ?? null,
            'tab' => (string) ($control['tab'] ?? 'content'),
            'section' => (string) ($control['section'] ?? ''),
            'responsive' => $isResponsive,
            'breakpoints' => $isResponsive ? $this->breakpoints() : [],
            'supports_globals' => $supportsGlobals,
            'dynamic_supported' => isset($control['dynamic']) && is_array($control['dynamic']) && !empty($control['dynamic']['active']),
        ];

        if (isset($control['options']) && is_array($control['options'])) {
            $schema['options'] = $control['options'];
        }
        if (isset($control['condition'])) {
            $schema['condition'] = $control['condition'];
        }
        if (isset($control['min'])) $schema['min'] = $control['min'];
        if (isset($control['max'])) $schema['max'] = $control['max'];

        return $schema;
    }

    private function extractSkins($widget): ?array
    {
        if (!method_exists($widget, 'get_skins')) return null;
        $skins = $widget->get_skins();
        if (!is_array($skins) || count($skins) === 0) return null;
        $out = [];
        foreach ($skins as $skinId => $skin) {
            $out[$skinId] = [
                'id' => $skinId,
                'title' => method_exists($skin, 'get_title') ? $skin->get_title() : (string) $skinId,
                // Note: per-skin control listings require deeper Elementor introspection
                // than is safe to do in v0.5 without runtime testing. v0.7 expands this.
                'controls' => [],
            ];
        }
        return $out;
    }

    private function breakpoints(): array
    {
        // Default Elementor breakpoints; v0.7 reads custom kit breakpoints from
        // `_elementor_page_settings.system_typography` / kit defaults.
        return ['desktop', 'tablet', 'mobile'];
    }

    private function primaryCategory($widget): string
    {
        if (!method_exists($widget, 'get_categories')) return 'general';
        $cats = $widget->get_categories();
        if (!is_array($cats) || count($cats) === 0) return 'general';
        return (string) $cats[0];
    }

    private function isPro($widget): bool
    {
        if (!method_exists($widget, 'get_categories')) return false;
        $cats = $widget->get_categories();
        return is_array($cats) && (in_array('pro-elements', $cats, true) || in_array('elementor-pro', $cats, true));
    }

    private function pluginSource($widget): string
    {
        $class = get_class($widget);
        if (str_starts_with($class, 'Elementor\\Pro\\')) return 'elementor-pro';
        if (str_starts_with($class, 'Elementor\\')) return 'elementor';
        if (str_starts_with($class, 'Jet')) return 'jet-engine';
        if (str_contains(strtolower($class), 'crocoblock')) return 'crocoblock';
        return 'unknown';
    }
}
