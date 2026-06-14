<?php
/**
 * Plugin Name: Joist Training Fonts (@font-face registration)
 * Description: Site-wide @font-face registration for the 1:1-clone training WP. Headings on
 *   cloned pages must resolve to the SOURCE typeface (e.g. Suisse / Söhne), not the
 *   Helvetica/Arial fallback. The clone builders (build-absolute.mjs) ALSO self-host fonts
 *   per-page via page_settings.custom_css; this mu-plugin is the COMPLEMENTARY site-level
 *   channel so eval/grader/_font-probe.mjs (document.fonts.check('… Suisse')) passes and so
 *   the editor preview + any page that did NOT carry its own @font-face still renders the face.
 *
 * @purpose The "@font-face mu-plugin referenced by eval/grader/_font-probe.mjs" — provisioned by
 *   sandbox/provision-training-wp.sh into wp-content/mu-plugins. Pure CSS injection, no JS, kses-free
 *   (mu-plugins run before kses and outside post content).
 *
 * MECHANISM: emit one <style id="joist-training-fonts"> into <head> on BOTH the frontend
 *   (wp_head) and the Elementor editor preview (elementor/editor/wp_head fallback to wp_head).
 *   Each face points at a self-hosted woff2 under wp-content/uploads/joist-fonts/<file>.woff2.
 *   The provisioner drops the woff2 files there from a caller-supplied --fonts-dir (or leaves the
 *   directory empty, in which case the @font-face rules simply 404 and the browser falls back —
 *   no error, the probe just reports usingSuisse=false until real faces are supplied).
 *
 * EXTEND: to register additional source faces, append to $faces below (family/file/weight/style)
 *   OR — preferred for the live instance — set the JOIST_FONT_FACES env/constant to a JSON array
 *   so the same file serves any corpus without edits. Reversible: delete this file from mu-plugins.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('joist_training_font_faces')) {
    /**
     * The source faces to register. Default set covers the corpus' proprietary headings
     * (Suisse / Söhne). Override wholesale by defining JOIST_FONT_FACES (JSON) in wp-config
     * or by editing this array. Each entry: family, file (basename under uploads/joist-fonts),
     * weight (e.g. '400' or '400 700'), style ('normal'|'italic').
     */
    function joist_training_font_faces() {
        if (defined('JOIST_FONT_FACES')) {
            $decoded = json_decode(JOIST_FONT_FACES, true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }
        return array(
            array('family' => 'Suisse',     'file' => 'suisse-regular.woff2', 'weight' => '400', 'style' => 'normal'),
            array('family' => 'Suisse',     'file' => 'suisse-medium.woff2',  'weight' => '500', 'style' => 'normal'),
            array('family' => 'Suisse',     'file' => 'suisse-bold.woff2',    'weight' => '700', 'style' => 'normal'),
            array('family' => 'Söhne',      'file' => 'sohne.woff2',          'weight' => '400 700', 'style' => 'normal'),
        );
    }
}

if (!function_exists('joist_training_font_css')) {
    function joist_training_font_css() {
        $base = content_url('uploads/joist-fonts');
        $out  = '';
        foreach (joist_training_font_faces() as $f) {
            if (empty($f['family']) || empty($f['file'])) {
                continue;
            }
            $url    = esc_url_raw($base . '/' . ltrim($f['file'], '/'));
            $family = str_replace(array('"', "\\"), '', $f['family']);
            $weight = isset($f['weight']) ? preg_replace('/[^0-9 ]/', '', (string) $f['weight']) : '400';
            $style  = (isset($f['style']) && $f['style'] === 'italic') ? 'italic' : 'normal';
            $out   .= sprintf(
                "@font-face{font-family:\"%s\";src:url(\"%s\") format(\"woff2\");font-weight:%s;font-style:%s;font-display:swap;}\n",
                $family,
                $url,
                $weight,
                $style
            );
        }
        return $out;
    }
}

if (!function_exists('joist_training_font_emit')) {
    function joist_training_font_emit() {
        $css = joist_training_font_css();
        if ($css === '') {
            return;
        }
        echo "<style id=\"joist-training-fonts\">\n" . $css . "</style>\n"; // phpcs:ignore WordPress.Security.EscapeOutput
    }
}

// Frontend + Elementor editor preview head.
add_action('wp_head', 'joist_training_font_emit', 5);
add_action('elementor/editor/wp_head', 'joist_training_font_emit', 5);
