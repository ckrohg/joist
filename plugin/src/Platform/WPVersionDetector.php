<?php
declare(strict_types=1);

namespace Joist\Platform;

/**
 * @purpose Detect the host WordPress version and which 7.0-era platform
 *          surfaces are available (Connectors API, AI Client, DataViews
 *          DataForm, Client-Side Abilities). Pure function — no side
 *          effects, no hooks, no logging. Safe to call before plugins_loaded.
 *
 * Pattern mirrors the Elementor version-detection pattern used in
 * Bootstrap::elementorReady() and HealthController — read a global
 * constant defensively, version_compare(), and feature-gate on the result.
 * See memory: failure_mode_constraints.md #7 (host preflight) and #17
 * (Elementor version detection — same shape applies to WP version).
 *
 * Sources for the 7.0 surface (verified 2026-05-28):
 *   - https://make.wordpress.org/core/2026/03/18/introducing-the-connectors-api-in-wordpress-7-0/
 *   - https://make.wordpress.org/core/2026/03/24/introducing-the-ai-client-in-wordpress-7-0/
 *   - https://make.wordpress.org/core/2026/03/04/dataviews-dataform-et-al-in-wordpress-7-0/
 *   - https://make.wordpress.org/core/2026/05/14/wordpress-7-0-field-guide/
 */
final class WPVersionDetector
{
    /** Minimum version that ships the Connectors API + AI Client + DataViews update. */
    public const CONNECTORS_API_MIN_VERSION = '7.0';
    public const DATAVIEWS_DATAFORM_MIN_VERSION = '7.0';
    public const CLIENT_SIDE_ABILITIES_MIN_VERSION = '7.0';

    /**
     * Detect the WP version and feature flags.
     *
     * Reads `$GLOBALS['wp_version']` first (set by WP at load time, also
     * settable via env-override for tests — see JOIST_TEST_WP_VERSION).
     * Falls back to `get_bloginfo('version')` when the global is absent
     * (e.g. very-early-init contexts) and finally to '0.0.0' if WP has not
     * yet loaded at all.
     *
     * @return array{
     *   version: string,
     *   major: int,
     *   minor: int,
     *   patch: int,
     *   supports_connectors_api: bool,
     *   supports_dataviews: bool,
     *   supports_client_side_abilities: bool,
     *   source: string
     * }
     */
    public static function detect(): array
    {
        // Test-only override. Used by plugin/tests/manual/acceptance.sh
        // to simulate 6.x vs 7.0 hosts without spinning up two WP installs.
        // Honored ONLY when WP_DEBUG is on, so production cannot be tricked.
        $envOverride = getenv('JOIST_TEST_WP_VERSION');
        if ($envOverride !== false && $envOverride !== '' && defined('WP_DEBUG') && WP_DEBUG) {
            return self::shape((string) $envOverride, 'env_override');
        }

        if (isset($GLOBALS['wp_version']) && is_string($GLOBALS['wp_version']) && $GLOBALS['wp_version'] !== '') {
            return self::shape((string) $GLOBALS['wp_version'], 'global');
        }

        if (function_exists('get_bloginfo')) {
            $v = (string) get_bloginfo('version');
            if ($v !== '') {
                return self::shape($v, 'bloginfo');
            }
        }

        return self::shape('0.0.0', 'unknown');
    }

    /**
     * Build the structured result from a version string.
     *
     * @return array{
     *   version: string,
     *   major: int,
     *   minor: int,
     *   patch: int,
     *   supports_connectors_api: bool,
     *   supports_dataviews: bool,
     *   supports_client_side_abilities: bool,
     *   source: string
     * }
     */
    private static function shape(string $version, string $source): array
    {
        [$major, $minor, $patch] = self::splitVersion($version);

        // Use version_compare on the *full* string so beta/RC suffixes
        // (e.g. 7.0-RC2, 7.0.1-beta) compare correctly.
        $supportsConnectors = version_compare($version, self::CONNECTORS_API_MIN_VERSION, '>=');
        $supportsDataViews = version_compare($version, self::DATAVIEWS_DATAFORM_MIN_VERSION, '>=');
        $supportsClientSideAbilities = version_compare($version, self::CLIENT_SIDE_ABILITIES_MIN_VERSION, '>=');

        return [
            'version' => $version,
            'major' => $major,
            'minor' => $minor,
            'patch' => $patch,
            'supports_connectors_api' => $supportsConnectors,
            'supports_dataviews' => $supportsDataViews,
            'supports_client_side_abilities' => $supportsClientSideAbilities,
            'source' => $source,
        ];
    }

    /**
     * Split a WP version string into major/minor/patch ints.
     * Tolerates suffixes (7.0-RC1 → 7, 0, 0) and short forms (7.0 → 7, 0, 0).
     *
     * @return array{0:int,1:int,2:int}
     */
    private static function splitVersion(string $version): array
    {
        // Strip any pre-release suffix before splitting (e.g. "7.0-RC2" → "7.0").
        $core = preg_replace('/[^0-9.].*$/', '', $version) ?? $version;
        $parts = explode('.', $core);
        $major = isset($parts[0]) ? (int) $parts[0] : 0;
        $minor = isset($parts[1]) ? (int) $parts[1] : 0;
        $patch = isset($parts[2]) ? (int) $parts[2] : 0;
        return [$major, $minor, $patch];
    }
}
