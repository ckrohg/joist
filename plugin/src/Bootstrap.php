<?php
declare(strict_types=1);

namespace Joist;

use Joist\DB\MigrationRunner;
use Joist\REST\PagesController;
use Joist\REST\SiteController;
use Joist\Security\Role;
use Joist\Webhooks\WebhookEmitter;

/**
 * Plugin bootstrap. Hooks WP, registers REST routes, performs pre-flight,
 * wires scheduled events.
 */
final class Bootstrap
{
    public static function init(): void
    {
        // Pre-flight: Elementor must be active + supported version.
        if (!self::elementorReady()) {
            add_action('admin_notices', [self::class, 'noticeElementorMissing']);
            return;
        }

        // Activation error surfacing.
        if (get_option('joist_activation_error')) {
            add_action('admin_notices', [self::class, 'noticeActivationError']);
        }

        // Platform-feature gating (WP 7.0 Connectors API + future 7.x surfaces).
        // Runs before REST so any AI client that probes via the Connectors
        // hub gets our descriptor *with* the discovery route already mounted.
        // See specs/ARCHITECTURE.md §7a "WP 7.0 Connectors API integration".
        if (class_exists(\Joist\Platform\PlatformBootstrap::class)) {
            \Joist\Platform\PlatformBootstrap::init();
        }

        // WP-admin React app foundation (Wave 5a). Registers the top-level
        // "Joist" menu + Plan Mode subpage and enqueues the compiled
        // React bundle from plugin/build/. See specs/WAVE_0_2026-05-26.md §5.
        if (class_exists(\Joist\Admin\AdminPage::class)) {
            \Joist\Admin\AdminPage::init();
        }
        if (class_exists(\Joist\Admin\AssetEnqueue::class)) {
            \Joist\Admin\AssetEnqueue::init();
        }

        add_action('rest_api_init', [self::class, 'registerRoutes']);

        // Widget Pack — Joist's custom Elementor widgets (v0.9-α).
        if (class_exists(\Joist\WidgetPack\PackBootstrap::class)) {
            \Joist\WidgetPack\PackBootstrap::init();
        }

        // Preference-memory capture hooks (v0.7-α).
        if (class_exists(\Joist\Eval\PreferenceCapture::class)) {
            \Joist\Eval\PreferenceCapture::init();
        }

        // Scheduled events.
        add_action('joist_post_save_verify', [self::class, 'postSaveVerify'], 10, 1);
        // Wave 6c — deferred copy-gen flush triggered by BatchQueue::flushAfter().
        if (class_exists(\Joist\Generate\Copy\BatchQueue::class)) {
            add_action(
                \Joist\Generate\Copy\BatchQueue::CRON_HOOK,
                [\Joist\Generate\Copy\BatchQueue::class, 'runScheduled'],
                10,
                1,
            );
        }
        add_action(WebhookEmitter::HOOK, [self::class, 'webhookDispatch'], 10, 2);
        add_action('joist_daily_maintenance', [self::class, 'dailyMaintenance']);
        if (!wp_next_scheduled('joist_daily_maintenance')) {
            wp_schedule_event(time() + 3600, 'daily', 'joist_daily_maintenance');
        }

        // Hourly eval-events rollup.
        if (class_exists(\Joist\Eval\RollupJob::class)) {
            add_action('joist_eval_rollup', [\Joist\Eval\RollupJob::class, 'run']);
            if (!wp_next_scheduled('joist_eval_rollup')) {
                wp_schedule_event(time() + 600, 'hourly', 'joist_eval_rollup');
            }
        }

        // Wave 9 (W10a) — daily confidence decay on preference_memory rules.
        // Rules whose last_reinforced_at is > 90 days old decay linearly;
        // confidence <= 0 marks the rule as archived. Stops 2025-era brand
        // preferences from hardening into law indefinitely.
        if (class_exists(\Joist\Eval\ConfidenceDecayJob::class)) {
            add_action(
                \Joist\Eval\ConfidenceDecayJob::HOOK,
                [\Joist\Eval\ConfidenceDecayJob::class, 'cronEntry']
            );
            if (!wp_next_scheduled(\Joist\Eval\ConfidenceDecayJob::HOOK)) {
                wp_schedule_event(time() + 86400, 'daily', \Joist\Eval\ConfidenceDecayJob::HOOK);
            }
        }

        // Wave 9 (W10c) — exemplar pack auto-capture hooks + daily purge.
        // Wires joist_plan_executed + joist_plan_rejected listeners; the
        // do_action callsites are upcoming (W11/W12). PackBootstrap::init()
        // also schedules the daily purge of stale exemplars > 180 days.
        if (class_exists(\Joist\ExemplarPack\PackBootstrap::class)) {
            \Joist\ExemplarPack\PackBootstrap::init();
        }

        // Recovery: any plan stuck in 'executing' > 5 min is marked failed.
        add_action('init', [self::class, 'recoverStaleExecutingPlans']);

        // Document save attribution.
        add_action('elementor/document/after_save', [self::class, 'onDocumentSaved'], 10, 2);

        // CEK W2.1 — register the [joist_nav_menu] free-tier single-source-of-truth nav shortcode.
        add_action('init', [self::class, 'registerShortcodes']);
    }

    public static function onActivate(): void
    {
        // Pre-flight versions.
        if (version_compare(PHP_VERSION, '8.0.0', '<')) {
            wp_die('Joist requires PHP 8.0 or higher. Current: ' . PHP_VERSION);
        }
        if (version_compare(get_bloginfo('version'), '6.5', '<')) {
            wp_die('Joist requires WordPress 6.5 or higher.');
        }

        // Run migrations. Logs joist_activation_error if any fail.
        MigrationRunner::run();

        // Register custom role.
        Role::register();

        update_option('joist_activated_at', time(), false);
        update_option('joist_version_installed', JOIST_VERSION, false);
    }

    public static function onDeactivate(): void
    {
        // Don't delete data; just unschedule events.
        wp_clear_scheduled_hook('joist_daily_maintenance');
        wp_clear_scheduled_hook('joist_eval_rollup');
        // Wave 9 cron cleanup.
        if (class_exists(\Joist\Eval\ConfidenceDecayJob::class)) {
            wp_clear_scheduled_hook(\Joist\Eval\ConfidenceDecayJob::HOOK);
        }
        if (class_exists(\Joist\ExemplarPack\PackBootstrap::class)) {
            wp_clear_scheduled_hook(\Joist\ExemplarPack\PackBootstrap::PURGE_HOOK);
        }
    }

    /**
     * CEK W2.1 — register [joist_nav_menu menu="<slug>"]. WordPress core has NO
     * [wp_nav_menu] shortcode (wp_nav_menu is a template function), so this wraps
     * it: a clone's free-tier header points at ONE real WP menu, and edits to that
     * menu propagate everywhere — instead of hardcoding nav links in two places.
     * `container=''` drops the wrapping <div> so the caller controls layout.
     */
    public static function registerShortcodes(): void
    {
        add_shortcode('joist_nav_menu', static function ($atts): string {
            $atts = shortcode_atts(['menu' => '', 'class' => 'joist-nav'], $atts, 'joist_nav_menu');
            $menu = is_string($atts['menu'] ?? null) ? trim($atts['menu']) : '';
            if ($menu === '') {
                return '';
            }
            $html = wp_nav_menu([
                'menu' => $menu,                              // accepts slug, name, or term id
                'container' => '',
                'menu_class' => sanitize_html_class($atts['class']) ?: 'joist-nav',
                'fallback_cb' => '__return_empty_string',
                'echo' => false,
            ]);
            return is_string($html) ? $html : '';
        });
    }

    public static function registerRoutes(): void
    {
        (new SiteController())->register();
        (new PagesController())->register();
        // v0.5 controllers — registered if the class exists.
        $controllers = [
            \Joist\REST\WidgetsController::class,
            \Joist\REST\ElementsController::class,
            \Joist\REST\KitController::class,
            \Joist\REST\TemplatesController::class,
            \Joist\REST\MediaController::class,
            \Joist\REST\MenusController::class,
            \Joist\REST\PluginsController::class,
            \Joist\REST\SEOController::class,
            \Joist\REST\SessionsController::class,
            \Joist\REST\PlansController::class,
            \Joist\REST\WebhooksController::class,
            \Joist\REST\AuditLogController::class,
            \Joist\REST\HealthController::class,
            \Joist\REST\OperatingModeController::class,
            \Joist\REST\PreferencesController::class,
            \Joist\REST\QualityController::class,
            \Joist\REST\AntiSlopController::class,
            // Wave 6b — FLUX.2 + Recraft + Ideogram + AssetRouter (image gen pipeline).
            \Joist\REST\GenerateController::class,
            // Wave 6c — Anthropic Messages API + cached brand block + batch queue.
            \Joist\REST\CopyGenController::class,
            // Wave 9 (v0.9) — three-tier taste substrate + generator/evaluator harness.
            // W10b: agency constitution + per-site override GET/PUT/DELETE.
            \Joist\REST\ConstitutionController::class,
            // W10c: exemplar pack (5-20 approved designs as cached messages + negative anchors).
            \Joist\REST\ExemplarPackController::class,
            // W11: /critique endpoint + cost-meter + rubric introspection.
            \Joist\REST\CritiqueController::class,
            // v0.9.5: admin settings UI so users never need SSH or wp-config to set the Claude key.
            \Joist\REST\SettingsController::class,
            // v0.10: MCP server — Joist as a tool surface for Claude Code (and any MCP client).
            \Joist\REST\McpController::class,
        ];
        foreach ($controllers as $c) {
            if (class_exists($c)) {
                (new $c())->register();
            }
        }
    }

    public static function postSaveVerify(int $postId): void
    {
        if (!class_exists('\Joist\Elementor\CSSRegenerator')) return;
        try {
            $regen = new \Joist\Elementor\CSSRegenerator();
            $regen->regenerate($postId);
            if (class_exists('\Joist\Cache\CacheFlusher')) {
                (new \Joist\Cache\CacheFlusher())->flushPage($postId);
            }
            do_action('joist_post_save_verified', $postId);
        } catch (\Throwable $e) {
            \Joist\Core\Logger::error('post_save_verify failed', ['post_id' => $postId, 'error' => $e->getMessage()]);
        }
    }

    public static function webhookDispatch(string $event, array $payload): void
    {
        if (!class_exists(\Joist\Webhooks\WebhookEmitter::class)) return;
        $emitter = new WebhookEmitter(
            new \Joist\Webhooks\WebhookStore(new \Joist\Security\URLValidator()),
            new \Joist\Security\URLValidator(),
        );
        $emitter->dispatch($event, $payload);
    }

    public static function dailyMaintenance(): void
    {
        \Joist\Concurrency\LockManager::prune();
        \Joist\Security\RateLimiter::prune();
        \Joist\Storage\RevisionStore::pruneAged();

        // Verify audit chain; surface tampering.
        if (class_exists(\Joist\Audit\AuditLogger::class)) {
            $broken = (new \Joist\Audit\AuditLogger())->verifyChain();
            if (!empty($broken)) {
                update_option('joist_audit_chain_broken', $broken, false);
                \Joist\Core\Logger::error('audit chain integrity violation', ['broken_row_ids' => $broken]);
            }
        }
    }

    public static function recoverStaleExecutingPlans(): void
    {
        global $wpdb;
        $cutoff = date('Y-m-d H:i:s', time() - 300);
        $wpdb->query($wpdb->prepare(
            "UPDATE {$wpdb->prefix}joist_plans
             SET status = 'failed', result = %s
             WHERE status = 'executing' AND created_at < %s",
            gzencode(wp_json_encode(['reason' => 'plugin_updated_mid_execution'])),
            $cutoff
        ));
    }

    public static function onDocumentSaved($document, $data): void
    {
        // Hook for plan-mode attribution + human.edited webhook emission.
        // The full implementation lives in v0.7+; for now the audit log
        // captures the actor via REST controllers.
        do_action('joist_document_saved', $document, $data);
    }

    private static function elementorReady(): bool
    {
        if (!did_action('elementor/loaded') && !class_exists('\Elementor\Plugin')) {
            return false;
        }
        if (defined('ELEMENTOR_VERSION') && version_compare(ELEMENTOR_VERSION, JOIST_MIN_ELEMENTOR_VERSION, '<')) {
            return false;
        }
        return true;
    }

    public static function noticeElementorMissing(): void
    {
        echo '<div class="notice notice-error"><p><strong>Joist:</strong> ';
        echo esc_html(sprintf(
            __('Elementor %s+ is required. Install or update Elementor before activating Joist.', 'joist'),
            JOIST_MIN_ELEMENTOR_VERSION
        ));
        echo '</p></div>';
    }

    public static function noticeActivationError(): void
    {
        $error = get_option('joist_activation_error');
        if (!is_array($error)) return;
        echo '<div class="notice notice-error"><p><strong>Joist activation error:</strong> ';
        echo esc_html(sprintf(
            __('Migration v%d failed: %s. Plugin will retry on next activation.', 'joist'),
            (int) ($error['version'] ?? 0),
            (string) ($error['message'] ?? 'unknown')
        ));
        echo '</p></div>';
    }
}
