<?php
declare(strict_types=1);

namespace Joist\Platform;

use Joist\Core\Logger;

/**
 * @purpose Register Joist with the WordPress 7.0 Connectors API so that
 *          users authenticate once and every WP 7.0 AI client (Claude
 *          Code, Claude Desktop, third-party SDKs) discovers our REST
 *          surface without re-auth. v1.0 launch differentiator vs
 *          Novamira — see specs/WAVE_0_2026-05-26.md §3.2.
 *
 * Lifecycle:
 *   - PlatformBootstrap::init() (plugins_loaded) decides whether to load
 *     us at all. If WP < 7.0, this class is never instantiated.
 *   - register() hooks `wp_connectors_init`. The Connectors API fires that
 *     during the `init` action *after* core + auto-discovered connectors
 *     have been registered (per Make WordPress Core dev note 2026-03-18).
 *   - On the hook, we receive a `WP_Connector_Registry` instance and call
 *     `$registry->register('joist', $metadata)`.
 *
 * TODO(connectors-api-stability): the Connectors API is 8 days old at
 * implementation time. Verified surface via these canonical sources
 * (checked 2026-05-28):
 *   - https://make.wordpress.org/core/2026/03/18/introducing-the-connectors-api-in-wordpress-7-0/
 *   - https://make.wordpress.org/core/2026/05/14/wordpress-7-0-field-guide/
 * The connector metadata shape, registry method names, and hook arg are
 * pulled from those dev notes. If 7.0.1 widens or renames any of them we
 * only need to update the metadata array + the one `register()` call.
 *
 * Connector ID slug pattern is /^[a-z0-9_-]+$/ (enforced by core).
 *
 * Graceful degradation: every interaction with the Connectors API is
 * guarded by `function_exists` / `class_exists` / `method_exists`. If
 * any guard fails we log a debug-level note and return — no PHP error,
 * no fatal, no admin notice. Falls back to the existing App Password +
 * REST auth path which works on every WP version we support.
 */
final class JoistConnector
{
    /** Connector ID — must match /^[a-z0-9_-]+$/. */
    public const CONNECTOR_ID = 'joist';

    /** Discovery REST route (mounted by REST/SiteController; exposed via
     *  the Connectors metadata so any AI client can find our entrypoint). */
    public const DISCOVERY_ROUTE = '/joist/v1/site';

    /**
     * Hook our registration into the Connectors API.
     *
     * Idempotent — safe to call twice; WP add_action will dedupe by
     * (hook, callback) tuple.
     */
    public function register(): void
    {
        if (!function_exists('add_action')) {
            // No WP at all — nothing to do. (Unit tests can call register()
            // without booting WP; we silently no-op.)
            return;
        }
        add_action('wp_connectors_init', [$this, 'onConnectorsInit'], 10, 1);
    }

    /**
     * Fired by core during `init` (priority varies by core) after built-in
     * connectors are seeded. Receives a `WP_Connector_Registry` instance.
     *
     * @param mixed $registry  expected to be \WP_Connector_Registry; typed
     *                         loosely so a stub/null doesn't fatal.
     */
    public function onConnectorsInit($registry): void
    {
        if (!is_object($registry) || !method_exists($registry, 'register')) {
            Logger::debug('joist.connector.skipped', [
                'reason' => 'wp_connectors_init fired but registry has no register() method',
            ]);
            return;
        }

        // Don't double-register if a previous load (or another instance)
        // already populated us.
        if (method_exists($registry, 'is_registered') && $registry->is_registered(self::CONNECTOR_ID)) {
            Logger::debug('joist.connector.already_registered', [
                'connector_id' => self::CONNECTOR_ID,
            ]);
            return;
        }

        try {
            $registry->register(self::CONNECTOR_ID, $this->descriptor());
            Logger::debug('joist.connector.registered', [
                'connector_id' => self::CONNECTOR_ID,
                'discovery_route' => self::DISCOVERY_ROUTE,
            ]);
        } catch (\Throwable $e) {
            // The Connectors API may evolve between 7.0.0 and 7.0.x —
            // if our metadata shape drifts, we want a log line, not a
            // fatal on every page load.
            Logger::warn('joist.connector.register_failed', [
                'connector_id' => self::CONNECTOR_ID,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * The Connector descriptor.
     *
     * Shape per Make WordPress Core dev note 2026-03-18:
     *   - name, description, type, authentication{}, plugin{}
     *
     * We extend it with a `joist` namespace for capability advertising —
     * core ignores unknown top-level keys, and any future AI client that
     * understands "ai-builder" capabilities can read them.
     *
     * @return array<string, mixed>
     */
    public function descriptor(): array
    {
        return [
            'name' => __('Joist', 'joist'),
            'description' => __(
                'Joist is an agentic backbone for Elementor sites — schema-validated, audit-logged, atomic-rollback writes via Claude Code or any MCP client.',
                'joist'
            ),
            'logo_url' => defined('JOIST_URL') ? JOIST_URL . 'assets/logo.svg' : '',
            'type' => 'site_builder',
            'authentication' => [
                // App Passwords are the primary auth path. The Connectors
                // hub will surface our credentials link; users still
                // generate App Passwords in WP admin → Users → Profile.
                'method' => 'api_key',
                'credentials_url' => admin_url('profile.php#application-passwords-section'),
                'setting_name' => 'connectors_site_builder_joist_api_key',
                'env_var_name' => 'JOIST_APP_PASSWORD',
                'constant_name' => 'JOIST_APP_PASSWORD',
            ],
            'plugin' => [
                'file' => defined('JOIST_FILE') ? plugin_basename(JOIST_FILE) : 'joist/joist.php',
            ],

            // Joist-specific extensions. Core ignores these; AI clients
            // that grok the "ai-builder" capability set can use them.
            'joist' => [
                'plugin_version' => defined('JOIST_VERSION') ? JOIST_VERSION : '0.0.0',
                'rest_namespace' => 'joist/v1',
                'discovery_route' => self::DISCOVERY_ROUTE,
                'mcp_namespace' => 'mcp/v1',
                'capabilities' => $this->capabilities(),
                'docs_url' => 'https://github.com/ckrohg/joist',
            ],
        ];
    }

    /**
     * The advertised capability surface — what an AI client can do
     * via this connector. Sourced from the v0.5 REST API + Plan Mode.
     *
     * @return list<string>
     */
    public function capabilities(): array
    {
        return [
            'elementor.pages.read',
            'elementor.pages.write',
            'elementor.pages.patch',
            'elementor.widgets.introspect',
            'elementor.templates.read',
            'elementor.templates.write',
            'elementor.kit.read',
            'elementor.kit.write',
            'elementor.revisions.restore',
            'plans.create',
            'plans.approve',
            'plans.execute',
            'sessions.lifecycle',
            'webhooks.manage',
            'audit_log.read',
            'health.read',
        ];
    }
}
