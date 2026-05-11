<?php
declare(strict_types=1);

namespace Joist\Elementor;

/**
 * Introspects installed Elementor widgets via `widgets_manager->get_widget_types()`.
 *
 * v0.1 M0: lists widget types only. v0.5 returns full control schemas with
 * `breakpoints[]`, `supports_globals`, `skins[]` to drive constraints #24/#26/#29.
 */
final class WidgetCatalog
{
    /** @return list<array{type:string,label:string,is_pro:bool}> */
    public function listAll(): array
    {
        if (!class_exists('\Elementor\Plugin')) {
            return [];
        }
        $types = \Elementor\Plugin::$instance->widgets_manager->get_widget_types();
        $out = [];
        foreach ($types as $type => $widget) {
            $out[] = [
                'type' => $type,
                'label' => method_exists($widget, 'get_title') ? $widget->get_title() : $type,
                'is_pro' => $this->isPro($widget),
            ];
        }
        return $out;
    }

    public function isRegistered(string $widgetType): bool
    {
        if (!class_exists('\Elementor\Plugin')) {
            return false;
        }
        $types = \Elementor\Plugin::$instance->widgets_manager->get_widget_types();
        return isset($types[$widgetType]);
    }

    private function isPro($widget): bool
    {
        if (!method_exists($widget, 'get_categories')) {
            return false;
        }
        $cats = $widget->get_categories();
        return is_array($cats) && (in_array('pro-elements', $cats, true) || in_array('elementor-pro', $cats, true));
    }
}
