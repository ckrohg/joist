<?php
declare(strict_types=1);

namespace Joist\Plan;

use Joist\Elementor\WriteException;

/**
 * @purpose Scaffold a blank Elementor-ready WordPress page.
 *
 * Joist's product promise is "we handle the WordPress + Elementor mechanics".
 * Every plan-creation entrypoint (raw-steps /plans, AI /plans/generate,
 * screenshot /plans/clone-from-screenshots, URL /plans/clone-from-url) must
 * be able to auto-provision a target page when the caller doesn't pass one —
 * otherwise the user has to leave the admin and create the page manually,
 * which defeats the point.
 *
 * V3-compatible: sets the four postmeta keys Elementor's editor looks for on
 * first load + initialises `_elementor_data='[]'` so the first patch has a
 * tree to walk. Falls back from `elementor_canvas` to `default` if the active
 * theme doesn't ship the canvas template (Hello/Astra/GP have it; generic
 * themes don't).
 */
final class PageFactory
{
    /**
     * Create a blank Elementor page and return its post ID.
     *
     * @param string $intent Used to derive a title when $title is empty.
     * @param string $title  Explicit title, optional.
     * @param string $status Post status. Default `publish` so anonymous viewers
     *                       (including Playwright-driven grader screenshots) can
     *                       see the page immediately. Set to `draft` if the
     *                       caller wants editor-only preview before publishing.
     *                       Bug fix 2026-05-31: was `draft` by default, which
     *                       hid every Joist-created page from non-admins and
     *                       broke the autonomous grader loop (Playwright fetch
     *                       returned theme 404 instead of the rendered clone).
     * @return int           New post ID.
     * @throws WriteException On wp_insert_post failure or 0-return.
     */
    public static function createBlankElementorPage(string $intent, string $title = '', string $status = 'publish'): int
    {
        // Derive a title — explicit > intent-derived > generic fallback.
        if ($title === '') {
            $title = trim((string) preg_replace('/\s+/', ' ', $intent));
            if (strlen($title) > 60) {
                $title = substr($title, 0, 60);
            }
            $title = rtrim($title, " \t\n\r\0\x0B.,;:!?-—");
            if ($title === '') {
                $intentSnippet = substr(trim($intent), 0, 40);
                $title = 'Joist draft — ' . $intentSnippet;
            }
        }

        // `elementor_canvas` is only registered if the theme (Hello, Astra,
        // GP, etc.) ships it. Fall back to the WP default so the page still
        // renders with theme chrome rather than 404ing the template.
        $template = 'elementor_canvas';
        $available = function_exists('wp_get_theme') ? wp_get_theme()->get_page_templates(null, 'page') : [];
        if (!is_array($available) || !array_key_exists('elementor_canvas', $available)) {
            $template = 'default';
        }

        // Validate status — accept only known WP page statuses.
        $allowedStatuses = ['publish', 'draft', 'private', 'pending'];
        if (!in_array($status, $allowedStatuses, true)) {
            $status = 'publish';
        }

        $insert = [
            'post_type' => 'page',
            'post_status' => $status,
            'post_title' => $title,
            'post_author' => (int) get_current_user_id(),
            'post_content' => '',
        ];

        try {
            $result = wp_insert_post($insert, true);
        } catch (\Throwable $e) {
            throw new WriteException('page_factory.create_failed', $e->getMessage(), 500);
        }

        if (is_wp_error($result)) {
            throw new WriteException('page_factory.create_failed', $result->get_error_message(), 500);
        }
        $pageId = (int) $result;
        if ($pageId <= 0) {
            throw new WriteException('page_factory.create_failed', 'wp_insert_post returned 0.', 500);
        }

        $version = defined('ELEMENTOR_VERSION') ? (string) ELEMENTOR_VERSION : '3.21.0';
        update_post_meta($pageId, '_elementor_edit_mode', 'builder');
        update_post_meta($pageId, '_elementor_version', $version);
        update_post_meta($pageId, '_elementor_template_type', 'wp-page');
        update_post_meta($pageId, '_wp_page_template', $template);
        update_post_meta($pageId, '_elementor_data', '[]');

        return $pageId;
    }
}
