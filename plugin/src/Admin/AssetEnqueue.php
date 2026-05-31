<?php
declare(strict_types=1);

namespace Joist\Admin;

use Joist\Core\Logger;

/**
 * @purpose Enqueue the compiled React admin app on Joist admin pages.
 *
 * Reads `plugin/build/index.asset.php` (produced by `npm run build` via
 * @wordpress/scripts) for the dependency array + content-hash version, then
 * enqueues the bundle. Localizes `window.joistConfig` with the REST base
 * URL, nonce, current user shape, and plugin version — the API client in
 * src/admin-app/api/plans.js reads from there.
 *
 * Graceful degradation: if `build/index.asset.php` doesn't exist (typical
 * during dev before the first `npm run build`), we log a debug notice and
 * skip the enqueue. This MUST NOT throw — the admin page still has to
 * render (with an empty root div + a "build not present" notice the React
 * app would otherwise have replaced).
 *
 * Scope: only enqueues on Joist admin pages. We match the hook suffix
 * returned by add_menu_page (cached on AdminPage::$planModeHook) and the
 * subpage variant `_page_joist-plan-mode` to be safe across WP versions.
 */
final class AssetEnqueue
{
    public const HANDLE = 'joist-admin-app';
    public const STYLE_HANDLE = 'joist-admin-app';

    public static function init(): void
    {
        add_action('admin_enqueue_scripts', [self::class, 'maybeEnqueue']);
    }

    public static function maybeEnqueue(string $hook): void
    {
        if (!self::isJoistAdminPage($hook)) {
            return;
        }

        $buildDir = JOIST_DIR . 'build';
        $assetFile = $buildDir . '/index.asset.php';
        $scriptFile = $buildDir . '/index.js';

        if (!file_exists($assetFile) || !file_exists($scriptFile)) {
            Logger::debug('joist.admin.build_missing', [
                'reason' => 'build/index.asset.php or build/index.js not found — run `npm install && npm run build` in plugin/',
                'expected_asset_file' => $assetFile,
                'expected_script_file' => $scriptFile,
                'hook' => $hook,
            ]);
            return;
        }

        // wp-scripts' asset file returns ['dependencies' => [...], 'version' => '...'].
        $asset = require $assetFile;
        if (!is_array($asset) || !isset($asset['dependencies'], $asset['version'])) {
            Logger::warn('joist.admin.bad_asset_manifest', [
                'reason' => 'build/index.asset.php did not return the expected shape',
                'asset_file' => $assetFile,
            ]);
            return;
        }

        wp_enqueue_style('wp-components');

        wp_enqueue_script(
            self::HANDLE,
            JOIST_URL . 'build/index.js',
            (array) $asset['dependencies'],
            (string) $asset['version'],
            true
        );

        // An optional CSS bundle — wp-scripts emits this when the React tree
        // imports stylesheets. Absent on the first build (no CSS imports
        // yet), so we guard the enqueue.
        $styleFile = $buildDir . '/index.css';
        if (file_exists($styleFile)) {
            wp_enqueue_style(
                self::STYLE_HANDLE,
                JOIST_URL . 'build/index.css',
                ['wp-components'],
                (string) $asset['version']
            );
        }

        wp_localize_script(self::HANDLE, 'joistConfig', self::buildConfig());

        // i18n — translates strings inside the React app via wp.i18n.
        // No-op on sites without a translation file; safe to always call.
        if (function_exists('wp_set_script_translations')) {
            wp_set_script_translations(self::HANDLE, 'joist');
        }
    }

    /**
     * Build the localized config object exposed as `window.joistConfig`.
     *
     * Intentionally narrow: only the REST base, a fresh nonce, a minimal
     * user shape, and a build/version marker. No tokens, no app passwords,
     * no plan secrets — those flow through authenticated REST calls.
     *
     * @return array<string, mixed>
     */
    private static function buildConfig(): array
    {
        $user = wp_get_current_user();
        // Read the build asset's version hash — wp-scripts emits this hash on
        // every build, so it's our deterministic "build SHA" for the React
        // bundle. Surfaces as version pill in the admin UI so progress is
        // visible (the SHA changes on every commit-then-build).
        $buildSha = 'dev';
        $assetPhp = JOIST_DIR . 'build/index.asset.php';
        if (file_exists($assetPhp)) {
            $asset = include $assetPhp;
            if (is_array($asset) && isset($asset['version'])) {
                $buildSha = substr((string) $asset['version'], 0, 8);
            }
        }
        return [
            'apiUrl' => esc_url_raw(rest_url('joist/v1/')),
            'restRoot' => esc_url_raw(rest_url()),
            'nonce' => wp_create_nonce('wp_rest'),
            'currentUser' => [
                'id' => (int) $user->ID,
                'name' => (string) $user->display_name,
            ],
            'joistVersion' => defined('JOIST_VERSION') ? JOIST_VERSION : 'unknown',
            'buildSha' => $buildSha,
            'wpVersion' => get_bloginfo('version'),
            'elementorVersion' => defined('ELEMENTOR_VERSION') ? ELEMENTOR_VERSION : null,
            'planModeUrl' => AdminPage::planModeUrl(),
            'claudeKey' => self::claudeKeyStatus(),
        ];
    }

    /**
     * Redacted Claude-key status surfaced on initial render so the UI doesn't
     * need a round-trip to know whether to show a "key not configured" banner.
     * Mirrors the redacted shape from SettingsController::claudeKeyStatus().
     *
     * @return array{configured: bool, source: string, tail: string|null}
     */
    private static function claudeKeyStatus(): array
    {
        $env = getenv('JOIST_CLAUDE_API_KEY');
        if (is_string($env) && $env !== '') {
            return ['configured' => true, 'source' => 'env', 'tail' => '…' . substr(trim($env), -4)];
        }
        $opt = get_option('joist_claude_api_key', '');
        if (is_string($opt) && $opt !== '') {
            return ['configured' => true, 'source' => 'option', 'tail' => '…' . substr(trim($opt), -4)];
        }
        return ['configured' => false, 'source' => 'none', 'tail' => null];
    }

    /**
     * True when the admin_enqueue_scripts hook is firing on a Joist page.
     *
     * We accept several variants because the hook suffix returned by
     * add_menu_page can differ between WP versions and locales; matching
     * the slug substring keeps us robust without being a wildcard.
     */
    private static function isJoistAdminPage(string $hook): bool
    {
        $cached = AdminPage::planModeHook();
        if ($cached !== null && $hook === $cached) {
            return true;
        }
        // Defensive fallback: any hook ending with our menu slug counts.
        return str_contains($hook, AdminPage::MENU_SLUG);
    }
}
