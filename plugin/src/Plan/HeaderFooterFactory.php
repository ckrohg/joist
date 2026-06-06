<?php
declare(strict_types=1);

namespace Joist\Plan;

use Joist\Elementor\WriteException;

/**
 * @purpose Author a site-wide header/footer template on Elementor FREE via the
 * Header Footer Elementor (HFE) plugin — the free workaround for Elementor's
 * Pro-only Theme Builder. CEK audit steal W3.2: the unlock for multi-page /
 * whole-site clones, where chrome must live in ONE reusable template (edits
 * propagate) instead of being baked into every page.
 *
 * Recipe verified against live HFE plugin source (CEK build-research wave,
 * 2026-06-06): post_type 'elementor-hf' + ehf_template_type 'type_header'|
 * 'type_footer' (SCALAR string) + ehf_target_include_locations =
 * ['rule'=>['basic-global'],'specific'=>[]] for "Entire Website". The location
 * meta MUST be written via update_post_meta (WordPress serializes it) so HFE's
 * `meta_value LIKE '%"basic-global"%'` selection query matches — never raw SQL.
 *
 * NOTE: v1 — needs live-HFE validation. _elementor_data is written as postmeta
 * here (the recipe). Routing it through DocumentWriter for hash/kses parity is a
 * hardening follow-up (see knowledge/CEK_AUDIT_STEAL_PLAN.md W3.2).
 */
final class HeaderFooterFactory
{
    /** HFE template post type. */
    private const POST_TYPE = 'elementor-hf';

    /**
     * Create a site-wide HFE header or footer template and return its post ID.
     *
     * @param string                     $type     'header' or 'footer'.
     * @param list<array<string,mixed>>  $elements V3 Elementor tree (the chrome layout).
     * @param string                     $title    Template title (e.g. "Site Header").
     * @param bool                       $siteWide When true (default), applies to the Entire Website.
     * @return int  New elementor-hf post ID.
     * @throws WriteException When HFE isn't active, $type is invalid, or insert fails.
     */
    public static function create(string $type, array $elements, string $title = '', bool $siteWide = true): int
    {
        $type = strtolower(trim($type));
        if ($type !== 'header' && $type !== 'footer') {
            throw new WriteException('hf_factory.bad_type', "type must be 'header' or 'footer', got '{$type}'.", 400);
        }

        // HFE must be active — the post type is only registered by the plugin.
        if (!post_type_exists(self::POST_TYPE)) {
            throw new WriteException(
                'hf_factory.hfe_missing',
                "Header Footer Elementor (post type 'elementor-hf') is not active. Site-wide header/footer on Elementor Free requires HFE/UAE.",
                412
            );
        }

        if ($title === '') {
            $title = 'Site ' . ucfirst($type);
        }

        $insert = [
            'post_type' => self::POST_TYPE,
            'post_status' => 'publish', // must be published to render site-wide
            'post_title' => $title,
            'post_author' => (int) get_current_user_id(),
            'post_content' => '',
        ];

        try {
            $result = wp_insert_post($insert, true);
        } catch (\Throwable $e) {
            throw new WriteException('hf_factory.create_failed', $e->getMessage(), 500);
        }
        if (is_wp_error($result)) {
            throw new WriteException('hf_factory.create_failed', $result->get_error_message(), 500);
        }
        $postId = (int) $result;
        if ($postId <= 0) {
            throw new WriteException('hf_factory.create_failed', 'wp_insert_post returned 0.', 500);
        }

        // Elementor editor meta — _elementor_edit_mode='builder' is MANDATORY,
        // else the frontend renders the post_content fallback instead of the
        // tree (a known failure mode in this repo, see hybrid_clone_and_render_truths).
        $version = defined('ELEMENTOR_VERSION') ? (string) ELEMENTOR_VERSION : '3.21.0';
        update_post_meta($postId, '_elementor_edit_mode', 'builder');
        update_post_meta($postId, '_elementor_version', $version);
        update_post_meta($postId, '_elementor_template_type', 'wp-post');
        // wp_slash is MANDATORY: update_metadata() runs wp_unslash() before
        // storing, which would strip one backslash level from the JSON (\/, \", \uXXXX)
        // and corrupt the tree on Elementor decode. Mirrors Elementor Document::save().
        update_post_meta($postId, '_elementor_data', wp_slash(wp_json_encode(array_values($elements))));

        // HFE designation — SCALAR string, not an array.
        update_post_meta($postId, 'ehf_template_type', 'type_' . $type);

        // Display rule. ['rule'=>['basic-global'],'specific'=>[]] = "Entire Website".
        // Written through update_post_meta so WP serializes it for HFE's
        // `LIKE '%"basic-global"%'` selection query.
        if ($siteWide) {
            update_post_meta($postId, 'ehf_target_include_locations', [
                'rule' => ['basic-global'],
                'specific' => [],
            ]);
        }
        update_post_meta($postId, 'ehf_target_exclude_locations', ['rule' => [], 'specific' => []]);
        update_post_meta($postId, 'ehf_target_user_roles', ['rule' => []]);

        return $postId;
    }
}
