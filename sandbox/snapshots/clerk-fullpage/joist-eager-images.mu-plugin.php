<?php
/**
 * Plugin Name: Joist Eager Images (local sandbox)
 * Description: Disables WordPress/Elementor native `loading="lazy"` on front-end images so
 *   every <img> on a rendered page decodes immediately, regardless of viewport position.
 *
 *   WHY (clerk full-page render-fidelity loop, 2026-06-12): Elementor 3.28's image widget has
 *   no control that stamps width/height attributes onto the <img> (only image_size +
 *   image_custom_dimension, which size via CSS once decoded). For images far below the fold,
 *   `loading="lazy"` + no reserved intrinsic box means the element sits at height:0, never
 *   enters the lazy IntersectionObserver, never decodes → naturalWidth stays 0 → it paints as
 *   an empty "placeholder box". A headless full-page screenshot (no human scroll) never
 *   triggers those lazy loads, so 29/43 captured assets rendered as boxes. Forcing eager load
 *   makes the browser fetch+decode all images up front; the captured per-widget dimensions
 *   then size them correctly. Analogous to the Suisse webfont mu-plugin: a local-server render
 *   concern, NOT a change to the Elementor tree (the page stays genuinely Elementor).
 *
 * @purpose Eager image loading for the local Elementor render-fidelity loop. LOCAL SANDBOX ONLY.
 */
if (!defined('ABSPATH')) { exit; }

// Master switch: WP skips emitting loading="lazy" when this filter returns false.
add_filter('wp_lazy_loading_enabled', '__return_false', 99);
// Belt-and-suspenders: if any path still injects a loading attr, force it to eager.
add_filter('wp_get_attachment_image_attributes', function ($attr) {
    $attr['loading'] = 'eager';
    return $attr;
}, 99);
// Elementor emits its own <img> markup for image widgets — strip lazy from rendered content.
add_filter('the_content', function ($html) {
    return is_string($html) ? str_replace(' loading="lazy"', ' loading="eager"', $html) : $html;
}, 99);
add_filter('elementor/frontend/the_content', function ($html) {
    return is_string($html) ? str_replace(' loading="lazy"', ' loading="eager"', $html) : $html;
}, 99);
