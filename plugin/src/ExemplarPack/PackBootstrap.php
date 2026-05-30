<?php
declare(strict_types=1);

namespace Joist\ExemplarPack;

use Joist\Container;
use Joist\Core\Logger;

/**
 * @purpose Wire the exemplar-pack auto-capture hooks + daily purge cron.
 *
 * Hook surface:
 *   - joist_plan_executed (action; fired by PlanExecutor on completed plan)
 *     → ExemplarPackManager::recordApproval()
 *   - joist_plan_rejected (action; existing — fired by PlanStore::reject())
 *     → ExemplarPackManager::recordRejection()
 *   - joist_exemplar_pack_purge (cron; daily) → purgeStaleExemplars()
 *
 * Open dependency (documented in W10c status report):
 *   PlanExecutor.php / PlansController.php do NOT yet fire joist_plan_executed.
 *   They emit a webhook ("plan.completed") instead. Until W11 (or a later
 *   wave) adds the do_action() call, recordApproval() will only run via
 *   explicit REST POST (or W11's critique-loop driver). The hook is wired
 *   eagerly here so the day the action is added, capture starts working
 *   without further changes.
 */
final class PackBootstrap
{
    public const PURGE_HOOK = 'joist_exemplar_pack_purge';

    public static function init(): void
    {
        // Auto-capture hooks (no-op until the upstream do_action() lands).
        add_action('joist_plan_executed', [self::class, 'onPlanExecuted'], 10, 2);
        add_action('joist_plan_rejected', [self::class, 'onPlanRejected'], 20, 2);

        // Daily purge cron — matches the W10a ConfidenceDecayJob daily pattern.
        add_action(self::PURGE_HOOK, [self::class, 'runPurge']);
        if (!wp_next_scheduled(self::PURGE_HOOK)) {
            wp_schedule_event(time() + 7200, 'daily', self::PURGE_HOOK);
        }
    }

    /**
     * Fired by PlanExecutor on plan completion (W11+).
     *
     * @param array<string,mixed> $plan
     * @param array<string,mixed> $result
     */
    public static function onPlanExecuted(array $plan, array $result = []): void
    {
        try {
            $manager = self::resolveManager();
            $siteId = self::resolveSiteId();
            $planId = (int) ($plan['id'] ?? $result['plan_id'] ?? 0);
            $rendered = [
                'rendered_summary' => (string) ($plan['intent'] ?? ''),
                'rendered_html' => '', // populated by the critique loop when it runs
                'brand_tokens' => $result['brand_tokens'] ?? [],
                'plugin_source' => 'plan_executor',
            ];
            $manager->recordApproval($siteId, $planId, $rendered);
        } catch (\Throwable $e) {
            // Capture must never break plan execution. Log and move on.
            Logger::warn('joist.exemplar_pack.capture_failed', [
                'plan_id' => $plan['id'] ?? null,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Fired by PlanStore::reject() (via PreferenceCapture's existing surface).
     *
     * @param array<string,mixed> $plan
     */
    public static function onPlanRejected(array $plan, ?string $note): void
    {
        try {
            $manager = self::resolveManager();
            $siteId = self::resolveSiteId();
            $planId = (int) ($plan['id'] ?? 0);
            $rendered = [
                'rendered_summary' => (string) ($plan['intent'] ?? ''),
                'rendered_html' => '',
                'brand_tokens' => [],
                'plugin_source' => 'plan_rejected',
            ];
            $manager->recordRejection($siteId, $planId, $rendered, (string) ($note ?? ''));
        } catch (\Throwable $e) {
            Logger::warn('joist.exemplar_pack.rejection_capture_failed', [
                'plan_id' => $plan['id'] ?? null,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /** Daily purge cron entry point. */
    public static function runPurge(): void
    {
        try {
            $manager = self::resolveManager();
            $removed = $manager->purgeStaleExemplars(ExemplarPackManager::DEFAULT_PURGE_AGE_DAYS);
            Logger::debug('joist.exemplar_pack.purge_completed', ['removed' => $removed]);
        } catch (\Throwable $e) {
            Logger::warn('joist.exemplar_pack.purge_failed', ['error' => $e->getMessage()]);
        }
    }

    private static function resolveManager(): ExemplarPackManager
    {
        if (class_exists(Container::class) && Container::has('exemplarPackManager')) {
            return Container::get('exemplarPackManager');
        }
        global $wpdb;
        return new ExemplarPackManager($wpdb);
    }

    private static function resolveSiteId(): string
    {
        if (class_exists(Container::class) && Container::has('preferenceMemory')) {
            return Container::get('preferenceMemory')->siteId();
        }
        // Defensive fallback — never throw out of the hook.
        if (is_multisite()) {
            return 'blog_' . (int) get_current_blog_id();
        }
        $host = wp_parse_url(home_url(), PHP_URL_HOST) ?: 'default';
        return 'host_' . preg_replace('/[^a-z0-9_.-]/i', '_', strtolower($host));
    }
}
