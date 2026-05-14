<?php
declare(strict_types=1);

namespace Joist\Eval;

/**
 * Hourly rollup of wp_joist_eval_events → wp_joist_eval_rollups.
 *
 * Computes p50, p95, avg, rate (for boolean-like metrics) per (hour bucket,
 * site_id, metric_key, agent_version, plugin_version). Dashboard queries hit
 * rollups, not raw events.
 */
final class RollupJob
{
    public const HOOK = 'joist_eval_rollup';

    public static function rollupsTable(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'joist_eval_rollups';
    }

    public static function eventsTable(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'joist_eval_events';
    }

    /** Called by WP-cron hourly. Idempotent. */
    public static function run(): void
    {
        global $wpdb;
        $rollups = self::rollupsTable();
        $events = self::eventsTable();

        // Last 90 days, rolled into hour buckets. Idempotent ON DUPLICATE.
        $cutoff = gmdate('Y-m-d H:i:s', time() - 90 * 86400);

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT
                DATE_FORMAT(ts, '%%Y-%%m-%%d %%H:00:00') AS bucket_ts,
                site_id, metric_key,
                COALESCE(agent_version, '') AS agent_version,
                COALESCE(plugin_version, '') AS plugin_version,
                COUNT(*) AS sample_count,
                AVG(metric_value) AS avg_value
             FROM {$events}
             WHERE ts >= %s
             GROUP BY bucket_ts, site_id, metric_key, agent_version, plugin_version",
            $cutoff
        ), ARRAY_A);

        if (!$rows) return;

        foreach ($rows as $row) {
            // Percentile + rate via separate query for the boolean-like metrics.
            $p50 = self::percentile($row, 0.50);
            $p95 = self::percentile($row, 0.95);
            $rate = self::isBooleanMetric($row['metric_key'])
                ? (float) ($row['avg_value'] ?? 0)
                : null;

            $wpdb->query($wpdb->prepare(
                "INSERT INTO {$rollups}
                    (bucket_ts, site_id, metric_key, agent_version, plugin_version,
                     sample_count, p50, p95, avg_value, rate)
                 VALUES (%s, %s, %s, %s, %s, %d, %f, %f, %f, %s)
                 ON DUPLICATE KEY UPDATE
                    sample_count = VALUES(sample_count),
                    p50 = VALUES(p50),
                    p95 = VALUES(p95),
                    avg_value = VALUES(avg_value),
                    rate = VALUES(rate)",
                $row['bucket_ts'],
                $row['site_id'],
                $row['metric_key'],
                $row['agent_version'],
                $row['plugin_version'],
                (int) $row['sample_count'],
                $p50,
                $p95,
                (float) ($row['avg_value'] ?? 0),
                $rate === null ? null : sprintf('%.4f', $rate)
            ));
        }
    }

    private static function percentile(array $bucketRow, float $p): float
    {
        global $wpdb;
        $events = self::eventsTable();
        $bucketStart = $bucketRow['bucket_ts'];
        $bucketEnd = gmdate('Y-m-d H:i:s', strtotime($bucketStart) + 3600);
        $values = $wpdb->get_col($wpdb->prepare(
            "SELECT metric_value FROM {$events}
             WHERE ts >= %s AND ts < %s
                AND site_id = %s AND metric_key = %s
                AND COALESCE(agent_version,'') = %s
                AND COALESCE(plugin_version,'') = %s
             ORDER BY metric_value",
            $bucketStart, $bucketEnd,
            $bucketRow['site_id'], $bucketRow['metric_key'],
            $bucketRow['agent_version'], $bucketRow['plugin_version']
        ));
        if (!$values) return 0.0;
        $idx = (int) floor((count($values) - 1) * $p);
        return (float) $values[$idx];
    }

    private static function isBooleanMetric(string $key): bool
    {
        return in_array($key, [
            EvalRecorder::METRIC_PLAN_ACCEPTED,
            EvalRecorder::METRIC_PLAN_REJECTED,
            EvalRecorder::METRIC_SCHEMA_INVALID,
            EvalRecorder::METRIC_POLICY_REFUSE,
            EvalRecorder::METRIC_HASH_MISMATCH,
            EvalRecorder::METRIC_ROLLBACK,
        ], true);
    }

    /** Prune raw events older than 30 days (rollups persist longer). */
    public static function pruneRawEvents(): void
    {
        global $wpdb;
        $cutoff = gmdate('Y-m-d H:i:s', time() - 30 * 86400);
        $wpdb->query($wpdb->prepare(
            "DELETE FROM " . self::eventsTable() . " WHERE ts < %s",
            $cutoff
        ));
    }
}
