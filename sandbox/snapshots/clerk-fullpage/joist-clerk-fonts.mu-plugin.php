<?php
/**
 * Plugin Name: Joist Clerk Webfonts (local sandbox)
 * Description: Registers the real clerk.com Suisse Intl webfonts (woff2 subsets captured
 *   from clerk.com) as @font-face on every front-end page so .elementor pages that set
 *   typography_font_family:"Suisse" render in the true family/weight instead of the
 *   Helvetica fallback the server otherwise picks. Printed in wp_head — fires on the
 *   Elementor canvas template too. LOCAL SANDBOX ONLY.
 * @purpose Webfont registration for local Elementor render-fidelity loop (clerk full page).
 */
if (!defined('ABSPATH')) { exit; }

add_action('wp_head', function () {
    $base = content_url('/uploads/clerk-fonts');
    // weight → captured woff2 file (Suisse Intl subsets pulled from clerk.com)
    $faces = array(
        array(400, 'SuisseIntl_Regular.woff2'),
        array(450, 'SuisseIntl_Book.woff2'),
        array(500, 'SuisseIntl_Medium.woff2'),
        array(600, 'SuisseIntl_SemiBold.woff2'),
        array(700, 'SuisseIntl_Bold.woff2'),
    );
    echo "\n<!-- joist-clerk-fonts -->\n<style id=\"joist-clerk-fonts\">\n";
    foreach ($faces as $f) {
        printf(
            "@font-face{font-family:'Suisse';src:url('%s/%s') format('woff2');font-weight:%d;font-style:normal;font-display:swap}\n",
            esc_url($base), $f[1], $f[0]
        );
    }
    // Elementor sometimes emits the family verbatim ("Suisse Intl") on some controls;
    // alias it so either spelling resolves to the same captured files.
    foreach ($faces as $f) {
        printf(
            "@font-face{font-family:'Suisse Intl';src:url('%s/%s') format('woff2');font-weight:%d;font-style:normal;font-display:swap}\n",
            esc_url($base), $f[1], $f[0]
        );
    }
    echo "</style>\n";
}, 5);
