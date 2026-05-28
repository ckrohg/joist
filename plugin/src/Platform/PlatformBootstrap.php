<?php
declare(strict_types=1);

namespace Joist\Platform;

use Joist\Core\Logger;

/**
 * @purpose Platform-feature gate. Runs early in plugin init, detects the
 *          host WP version, and selectively wires up 7.0-era integrations
 *          (Connectors API, etc.) while falling back cleanly on 6.x.
 *
 * Why a separate bootstrap (vs putting this in Bootstrap::init)? Two reasons:
 *   1. Platform-feature detection has its own lifecycle — it runs *before*
 *      REST route registration so the Connectors API has our descriptor
 *      before any AI client probes /wp-json/.
 *   2. Keeps Bootstrap.php focused on Elementor + DB + scheduled events;
 *      platform-feature gating is orthogonal to those concerns.
 *
 * See specs/WAVE_0_2026-05-26.md §3.2 — v1.0 launch differentiator vs Novamira.
 */
final class PlatformBootstrap
{
    /** Cached detector result. Set by init(); accessed by tests / health. */
    private static ?array $platform = null;

    /**
     * Wire platform-feature integrations. Call from Bootstrap::init() after
     * Container is available and before REST routes register.
     */
    public static function init(): void
    {
        $platform = WPVersionDetector::detect();
        self::$platform = $platform;

        if ($platform['supports_connectors_api']) {
            self::registerConnector();
        } else {
            Logger::debug('joist.platform.pre_7_0', [
                'wp_version' => $platform['version'],
                'source' => $platform['source'],
                'message' => 'WordPress < 7.0 detected — Connectors API unavailable; falling back to App Password / REST auth path.',
            ]);
        }
    }

    /**
     * Register Joist with the WP 7.0 Connectors API.
     *
     * Guarded — if the API surface looks different from what we expect
     * (because 7.0.x widened or renamed something), we log and continue.
     */
    private static function registerConnector(): void
    {
        // Sanity check the surface the dev note documented. We don't need
        // wp_register_connector() directly (we go through the registry on
        // the wp_connectors_init hook), but if NONE of the documented
        // query functions exist, the Connectors API isn't actually loaded
        // even though wp_version >= 7.0 — log + bail.
        if (
            !function_exists('wp_get_connectors')
            && !function_exists('wp_is_connector_registered')
            && !function_exists('wp_get_connector')
        ) {
            Logger::debug('joist.connector.api_missing', [
                'reason' => 'wp_version says 7.0+ but Connectors API helper functions are not loaded',
                'wp_version' => self::$platform['version'] ?? 'unknown',
            ]);
            return;
        }

        try {
            (new JoistConnector())->register();
        } catch (\Throwable $e) {
            // Last-line defense — register() itself should never throw,
            // but if it does we swallow and log rather than fatal.
            Logger::warn('joist.connector.bootstrap_failed', [
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Read the detected platform shape. Lazily detects on first call if
     * init() hasn't run yet (e.g. during unit tests).
     *
     * @return array<string, mixed>
     */
    public static function platform(): array
    {
        if (self::$platform === null) {
            self::$platform = WPVersionDetector::detect();
        }
        return self::$platform;
    }

    /** Reset state (used in tests). */
    public static function reset(): void
    {
        self::$platform = null;
    }
}
