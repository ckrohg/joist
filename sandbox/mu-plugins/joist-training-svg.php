<?php
/**
 * Plugin Name: Joist training — allow SVG uploads
 * @purpose Lets the projection pipeline upload the real <img src="*.svg"> logos/icons a clone references.
 * Stock WordPress blocks the image/svg+xml MIME, so capture-assets → media import previously FATAL'd with
 * `rest_upload_sideload_error` on the first SVG (every marketing site has SVG logos). This is a SANDBOX/training
 * convenience for a single-tenant local instance — SVGs can embed scripts, so the allow is scoped to users who can
 * already upload+edit content (upload_files), never anonymous. Mirrors the @font-face / canvas-guard mu-plugins
 * the provisioner installs. Reversible: delete this file (or `define('JOIST_NO_SVG', true)`).
 */
if (defined('JOIST_NO_SVG') && JOIST_NO_SVG) { return; }

add_filter('upload_mimes', function ($mimes) {
    if (current_user_can('upload_files')) {
        $mimes['svg']  = 'image/svg+xml';
        $mimes['svgz'] = 'image/svg+xml';
    }
    return $mimes;
});

// WP's real-MIME sniff rejects SVG (XML, not a binary image) → pin ext/type for .svg so the sideload check passes.
add_filter('wp_check_filetype_and_ext', function ($data, $file, $filename, $mimes) {
    if (substr(strtolower((string) $filename), -4) === '.svg') {
        $data['ext']             = 'svg';
        $data['type']            = 'image/svg+xml';
        $data['proper_filename'] = $filename;
    }
    return $data;
}, 10, 4);
