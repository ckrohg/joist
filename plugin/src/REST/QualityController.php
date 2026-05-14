<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Eval\RollupJob;
use WP_REST_Request;
use WP_REST_Server;

/**
 * /joist/v1/quality — quality eval metrics dashboard API.
 * Queries wp_joist_eval_rollups (not raw events) for speed.
 */
final class QualityController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/quality/summary', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'summary'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/quality/trend', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'trend'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/quality/compare', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'compare'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/quality/rollup', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'manualRollup'],
            'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
    }

    public function summary(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $period = (string) ($req->get_param('period') ?: 'last-7-days');
            [$from, $to] = $this->periodRange($period);
            return $this->ok($this->aggregateRange($from, $to));
        });
    }

    public function trend(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $metric = (string) ($req->get_param('metric') ?: 'fidelity');
            $period = (string) ($req->get_param('period') ?: 'last-30-days');
            [$from, $to] = $this->periodRange($period);

            global $wpdb;
            $rollups = RollupJob::rollupsTable();
            $rows = $wpdb->get_results(
                $wpdb->prepare(
                    "SELECT bucket_ts, agent_version, plugin_version, sample_count, p50, p95, avg_value, rate
                     FROM {$rollups}
                     WHERE bucket_ts >= %s AND bucket_ts < %s AND metric_key = %s
                     ORDER BY bucket_ts",
                    $from,
                    $to,
                    $metric
                ),
                ARRAY_A
            );
            return $this->ok([
                'metric' => $metric,
                'period' => $period,
                'points' => $rows ?: [],
            ]);
        });
    }

    public function compare(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $aRange = (string) ($req->get_param('a') ?: '');
            $bRange = (string) ($req->get_param('b') ?: '');
            if (!preg_match('/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/', $aRange) ||
                !preg_match('/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/', $bRange)) {
                return new \WP_REST_Response([
                    'code' => 'validation.invalid_range',
                    'message' => 'a and b must be in the form YYYY-MM-DD..YYYY-MM-DD',
                ], 400);
            }

            $aParts = explode('..', $aRange);
            $bParts = explode('..', $bRange);
            $aMetrics = $this->aggregateRange($aParts[0] . ' 00:00:00', $aParts[1] . ' 23:59:59');
            $bMetrics = $this->aggregateRange($bParts[0] . ' 00:00:00', $bParts[1] . ' 23:59:59');

            $deltas = [];
            foreach ($aMetrics as $key => $val) {
                if (!is_numeric($val) || !is_numeric($bMetrics[$key] ?? null)) continue;
                $deltas[$key] = (float) $bMetrics[$key] - (float) $val;
            }
            return $this->ok(['a' => $aMetrics, 'b' => $bMetrics, 'deltas' => $deltas]);
        });
    }

    public function manualRollup(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function () {
            RollupJob::run();
            return $this->ok(['rolled_up' => true, 'at' => gmdate('c')]);
        });
    }

    private function aggregateRange(string $from, string $to): array
    {
        global $wpdb;
        $rollups = RollupJob::rollupsTable();
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT metric_key,
                        SUM(sample_count) AS samples,
                        AVG(avg_value) AS avg_value,
                        AVG(rate) AS avg_rate,
                        AVG(p50) AS avg_p50,
                        AVG(p95) AS avg_p95
                 FROM {$rollups}
                 WHERE bucket_ts >= %s AND bucket_ts < %s
                 GROUP BY metric_key",
                $from,
                $to
            ),
            ARRAY_A
        );
        $out = ['period' => ['from' => $from, 'to' => $to]];
        foreach ($rows ?: [] as $r) {
            $out[$r['metric_key']] = [
                'samples' => (int) $r['samples'],
                'avg_value' => $r['avg_value'] !== null ? (float) $r['avg_value'] : null,
                'rate' => $r['avg_rate'] !== null ? (float) $r['avg_rate'] : null,
                'p50' => $r['avg_p50'] !== null ? (float) $r['avg_p50'] : null,
                'p95' => $r['avg_p95'] !== null ? (float) $r['avg_p95'] : null,
            ];
        }
        return $out;
    }

    private function periodRange(string $period): array
    {
        $now = gmdate('Y-m-d H:i:s');
        if (preg_match('/^last-(\d+)-days$/', $period, $m)) {
            $from = gmdate('Y-m-d H:i:s', time() - ((int) $m[1]) * 86400);
            return [$from, $now];
        }
        if ($period === 'last-7-days') return [gmdate('Y-m-d H:i:s', time() - 7 * 86400), $now];
        if ($period === 'last-30-days') return [gmdate('Y-m-d H:i:s', time() - 30 * 86400), $now];
        if ($period === 'last-90-days') return [gmdate('Y-m-d H:i:s', time() - 90 * 86400), $now];
        return [gmdate('Y-m-d H:i:s', time() - 7 * 86400), $now];
    }
}
