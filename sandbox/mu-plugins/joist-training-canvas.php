<?php
/**
 * Plugin Name: Joist Training Canvas (elementor_canvas availability guard)
 * Description: Guarantees the `elementor_canvas` page template is registerable on the training WP
 *   even before a theme template scan, so the clone pipeline's createScratch()
 *   (eval/grader/scratch-harness.mjs) — which writes _wp_page_template=elementor_canvas — always
 *   resolves to the chrome-free full-bleed Elementor canvas (no theme navbar / no boxed column).
 *
 * @purpose The canvas template normally ships with the Elementor PLUGIN
 *   (modules/page-templates/templates/canvas.php) and is auto-registered when Elementor is active.
 *   This mu-plugin is a belt-and-suspenders no-op in the common case: it only acts if, on some host,
 *   'elementor_canvas' is missing from the page-templates list (e.g. a theme that filters
 *   theme_page_templates, or an Elementor build where the module is gated). It then re-adds the
 *   key and maps it to Elementor's own canvas.php so the template selector and Elementor's render
 *   path both see it. Idempotent, reversible (delete the file), and inert when Elementor already
 *   provides the template.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('joist_training_canvas_path')) {
    function joist_training_canvas_path() {
        if (defined('ELEMENTOR_PATH')) {
            $p = ELEMENTOR_PATH . 'modules/page-templates/templates/canvas.php';
            if (file_exists($p)) {
                return $p;
            }
        }
        // Fallback: scan the active plugins dir for the canonical canvas template.
        $guess = WP_PLUGIN_DIR . '/elementor/modules/page-templates/templates/canvas.php';
        return file_exists($guess) ? $guess : '';
    }
}

// Advertise the template in the page-attributes selector if Elementor somehow didn't.
add_filter('theme_page_templates', function ($templates) {
    if (!is_array($templates)) {
        $templates = array();
    }
    if (!isset($templates['elementor_canvas'])) {
        $templates['elementor_canvas'] = 'Elementor Canvas';
    }
    if (!isset($templates['elementor_header_footer'])) {
        $templates['elementor_header_footer'] = 'Elementor Full Width';
    }
    return $templates;
}, 99);

// Resolve the template file if WP asks for elementor_canvas and Elementor's own resolver didn't bind it.
add_filter('template_include', function ($template) {
    if (!is_singular()) {
        return $template;
    }
    $assigned = get_post_meta(get_queried_object_id(), '_wp_page_template', true);
    if ($assigned === 'elementor_canvas') {
        $canvas = joist_training_canvas_path();
        // Only override if the current $template is NOT already Elementor's canvas (avoid double-bind).
        if ($canvas && basename($template) !== 'canvas.php') {
            return $canvas;
        }
    }
    return $template;
}, 99);
