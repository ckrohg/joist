<?php
declare(strict_types=1);

namespace Joist\Eval;

/**
 * Fans out from the existing audit log path into a queryable
 * wp_joist_eval_events table. Rollup job aggregates hourly into
 * wp_joist_eval_rollups for fast dashboard queries.
 *
 * Synchronous single INSERT — cheap enough on the audit hot path.
 */
final class EvalRecorder
{
    public const METRIC_FIDELITY        = 'fidelity';
    public const METRIC_PLAN_ACCEPTED   = 'plan_accepted';
    public const METRIC_PLAN_REJECTED   = 'plan_rejected';
    public const METRIC_SCHEMA_INVALID  = 'schema_invalid';
    public const METRIC_POLICY_REFUSE   = 'policy_refuse';
    public const METRIC_HASH_MISMATCH   = 'hash_mismatch';
    public const METRIC_ROLLBACK        = 'rollback';
    public const METRIC_DURATION_MS     = 'duration_ms';
    public const METRIC_TOKENS          = 'tokens';
    public const METRIC_RETRIES         = 'retries';

    public static function tableName(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'joist_eval_events';
    }

    /**
     * Record a metric event. Context may include session_id, plan_id, page_id, section_id.
     *
     * @param string $metricKey
     * @param int|float $value
     * @param array<string,mixed> $context
     */
    public static function record(string $metricKey, $value, array $context = []): void
    {
        global $wpdb;

        // Pull site_id from the same source PreferenceMemory uses, kept in sync.
        $siteId = self::siteId();

        $row = [
            'ts' => gmdate('Y-m-d H:i:s'),
            'site_id' => $siteId,
            'session_id' => $context['session_id'] ?? null,
            'plan_id' => $context['plan_id'] ?? null,
            'page_id' => isset($context['page_id']) ? (int) $context['page_id'] : null,
            'section_id' => $context['section_id'] ?? null,
            'metric_key' => $metricKey,
            'metric_value' => (float) $value,
            'agent_version' => $context['agent_version'] ?? null,
            'plugin_version' => defined('JOIST_VERSION') ? JOIST_VERSION : null,
            'prompt_hash' => $context['prompt_hash'] ?? null,
        ];

        $wpdb->insert(self::tableName(), $row);
    }

    private static function siteId(): string
    {
        if (is_multisite()) {
            return 'blog_' . (int) get_current_blog_id();
        }
        $host = wp_parse_url(home_url(), PHP_URL_HOST) ?: 'default';
        return 'host_' . preg_replace('/[^a-z0-9_.-]/i', '_', strtolower($host));
    }
}
