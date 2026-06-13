<?php
declare(strict_types=1);

namespace Joist\Plan;

use Joist\Elementor\WriteException;

/**
 * @purpose Author site-wide chrome (header/footer) as NATIVE Elementor Pro
 * Theme Builder documents — the no-extra-plugin path mandated when the
 * HFE-based HeaderFooterFactory was removed (commit e0d7228).
 *
 * Ground-truth recipe (captured from the live site, template 6727 postmortem):
 *   post_type=elementor_library, _elementor_edit_mode=builder,
 *   _elementor_template_type=header|footer, elements via Document::save
 *   semantics (Joist's DocumentWriter — the controller calls it, not this
 *   factory), _elementor_conditions=['include/general'] (entire site) or
 *   ['include/singular/page/<id>'] (single page).
 *
 * THE e0d7228 GOTCHA, fixed here: meta-only creation does NOT render. Pro
 * resolves which theme documents to print from a server-side CONDITIONS CACHE
 * (wp_option `elementor_pro_theme_builder_conditions`), not from postmeta.
 * Writing `_elementor_conditions` alone leaves the cache stale and the header
 * invisible. applyConditions() therefore routes through Pro's own
 * Conditions_Manager::save_conditions() (meta + cache in one call), with a
 * defensive meta-write + Conditions_Cache::regenerate() fallback for Pro
 * versions where the manager surface differs. cacheRegistered() reads the
 * cache option back so callers can assert the registration actually landed.
 *
 * Theme caveat (documented, unresolved until a live render probe): the live
 * stack is JupiterX + Pro. Pro replaces theme headers via registered Elementor
 * locations or its get_header() fallback; JupiterX's own header builder may
 * still win. The render check is the ONLY truth — see the site-parts REST
 * response's `render_check_required` flag.
 */
final class SitePartFactory
{
    public const POST_TYPE = 'elementor_library';

    /** Site-part template types this factory may author. */
    public const TYPES = ['header', 'footer'];

    /** Pro condition strings: include|exclude / location segments. */
    private const CONDITION_RE = '/^(include|exclude)(\/[a-z0-9_\-]+)*$/';

    /**
     * Pro's Theme Builder conditions-cache option (Conditions_Cache::OPTION_NAME).
     * Read-only here — writes go through Pro's own classes.
     */
    private const CONDITIONS_CACHE_OPTION = 'elementor_pro_theme_builder_conditions';

    /**
     * Scaffold a header/footer Theme Builder document (no elements yet — the
     * caller saves the tree through DocumentWriter so every Document::save
     * invariant applies). Returns the new elementor_library post ID.
     *
     * @throws WriteException bad type (400), Pro missing (412), insert failure (500)
     */
    public static function create(string $type, string $title = '', string $status = 'publish'): int
    {
        $type = strtolower(trim($type));
        if (!in_array($type, self::TYPES, true)) {
            throw new WriteException(
                'site_part.bad_type',
                sprintf("type must be one of [%s], got '%s'.", implode(', ', self::TYPES), $type),
                400
            );
        }
        self::assertProThemeBuilder();

        if ($title === '') {
            $title = 'Site ' . ucfirst($type);
        }
        if (!in_array($status, ['publish', 'draft', 'private'], true)) {
            $status = 'publish'; // must be published to render on the frontend
        }

        try {
            $result = wp_insert_post([
                'post_type' => self::POST_TYPE,
                'post_status' => $status,
                'post_title' => sanitize_text_field($title),
                'post_author' => (int) get_current_user_id(),
                'post_content' => '',
            ], true);
        } catch (\Throwable $e) {
            throw new WriteException('site_part.create_failed', $e->getMessage(), 500);
        }
        if (is_wp_error($result)) {
            throw new WriteException('site_part.create_failed', $result->get_error_message(), 500);
        }
        $postId = (int) $result;
        if ($postId <= 0) {
            throw new WriteException('site_part.create_failed', 'wp_insert_post returned 0.', 500);
        }

        $version = defined('ELEMENTOR_VERSION') ? (string) ELEMENTOR_VERSION : '3.21.0';
        update_post_meta($postId, '_elementor_edit_mode', 'builder'); // MANDATORY else frontend renders post_content fallback
        update_post_meta($postId, '_elementor_version', $version);
        update_post_meta($postId, '_elementor_template_type', $type);
        update_post_meta($postId, '_elementor_data', '[]'); // so the first save has a tree to replace
        // Source_Local resolves document types through this taxonomy too —
        // without the term the Templates library mis-buckets the document.
        wp_set_object_terms($postId, $type, 'elementor_library_type');

        return $postId;
    }

    /**
     * Register Pro display conditions for a theme document AND rebuild the
     * server-side conditions cache (the e0d7228 missing piece).
     *
     * @param int          $postId     elementor_library post ID.
     * @param list<string> $conditions e.g. ['include/general'] or ['include/singular/page/123'].
     * @return array{applied:list<string>,path:string,cache_registered:bool}
     * @throws WriteException invalid conditions (400), Pro missing (412), both write paths failed (500)
     */
    public static function applyConditions(int $postId, array $conditions): array
    {
        $conditions = array_values(array_map(static fn($c) => (string) $c, $conditions));
        if ($conditions === []) {
            throw new WriteException('site_part.empty_conditions', 'conditions must be a non-empty list (e.g. ["include/general"]).', 400);
        }
        foreach ($conditions as $c) {
            if (!preg_match(self::CONDITION_RE, $c)) {
                throw new WriteException(
                    'site_part.bad_condition',
                    "Condition '{$c}' is not a valid Pro condition string (expected e.g. 'include/general' or 'include/singular/page/123').",
                    400
                );
            }
        }
        self::assertProThemeBuilder();

        $manager = self::conditionsManager();
        $path = null;

        // Preferred: Pro's own save path — updates _elementor_conditions meta
        // AND the conditions cache in one call (what the Theme Builder UI does).
        if ($manager !== null && method_exists($manager, 'save_conditions')) {
            try {
                $manager->save_conditions($postId, $conditions);
                $path = 'pro.conditions_manager.save_conditions';
            } catch (\Throwable $e) {
                \Joist\Core\Logger::error('site_part.save_conditions threw — falling back to meta+regenerate', [
                    'post_id' => $postId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // Fallback: write the meta ourselves, then force a full cache rebuild.
        if ($path === null) {
            update_post_meta($postId, '_elementor_conditions', $conditions);
            $regenerated = self::regenerateCache($manager);
            if (!$regenerated) {
                throw new WriteException(
                    'site_part.conditions_cache_unreachable',
                    'Pro Conditions_Manager::save_conditions unavailable AND the conditions cache could not be regenerated. The document would not render (e0d7228 failure mode); refusing to report success.',
                    500,
                    ['post_id' => $postId, 'conditions' => $conditions]
                );
            }
            $path = 'meta+cache_regenerate';
        }

        return [
            'applied' => $conditions,
            'path' => $path,
            'cache_registered' => self::cacheRegistered($postId),
        ];
    }

    /** Conditions currently stored on the document (postmeta truth). @return list<string> */
    public static function conditionsFor(int $postId): array
    {
        $meta = get_post_meta($postId, '_elementor_conditions', true);
        return is_array($meta) ? array_values(array_map('strval', $meta)) : [];
    }

    /**
     * Read the Pro conditions-cache option back and confirm this post ID is
     * registered — the render-side source of truth meta alone cannot prove.
     */
    public static function cacheRegistered(int $postId): bool
    {
        $cache = get_option(self::CONDITIONS_CACHE_OPTION, []);
        if (!is_array($cache)) {
            return false;
        }
        // Shape: [ template_type => [ post_id => conditions[] ] ] — tolerate
        // either int or string keys and unknown nesting variations.
        foreach ($cache as $byType) {
            if (is_array($byType) && (array_key_exists($postId, $byType) || array_key_exists((string) $postId, $byType))) {
                return true;
            }
        }
        return false;
    }

    /** @throws WriteException 412 when Elementor Pro's Theme Builder is not loadable. */
    public static function assertProThemeBuilder(): void
    {
        if (!class_exists('\ElementorPro\Modules\ThemeBuilder\Module')) {
            throw new WriteException(
                'site_part.pro_missing',
                'Elementor Pro (Theme Builder module) is not active. Native header/footer site parts require Pro.',
                412
            );
        }
    }

    /** Pro's Conditions_Manager, or null when the surface differs. */
    private static function conditionsManager(): ?object
    {
        if (!class_exists('\ElementorPro\Modules\ThemeBuilder\Module')) {
            return null;
        }
        try {
            $module = \ElementorPro\Modules\ThemeBuilder\Module::instance();
            if (is_object($module) && method_exists($module, 'get_conditions_manager')) {
                $manager = $module->get_conditions_manager();
                return is_object($manager) ? $manager : null;
            }
        } catch (\Throwable $e) {
            \Joist\Core\Logger::error('site_part.conditions_manager unreachable', ['error' => $e->getMessage()]);
        }
        return null;
    }

    /** Best-effort full rebuild of the Pro conditions cache. True on success. */
    private static function regenerateCache(?object $manager): bool
    {
        if ($manager === null || !method_exists($manager, 'get_cache')) {
            return false;
        }
        try {
            $cache = $manager->get_cache();
            if (is_object($cache) && method_exists($cache, 'regenerate')) {
                $cache->regenerate();
                return true;
            }
        } catch (\Throwable $e) {
            \Joist\Core\Logger::error('site_part.cache_regenerate failed', ['error' => $e->getMessage()]);
        }
        return false;
    }
}
