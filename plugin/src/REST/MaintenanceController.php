<?php
declare(strict_types=1);

namespace Joist\REST;

use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * @purpose /joist/v1/maintenance — admin-only DB hygiene endpoints.
 *
 * Why this exists: WordPress core hard-blocks revision deletion over REST
 * (403 `rest_cannot_delete` even for administrators), so a host that has hit
 * its database size quota cannot be cleaned up through the standard API. Joist
 * owns this plugin, so it ships a server-side prune that calls the core
 * `wp_delete_post_revision()` directly — the one sanctioned way to drop a
 * revision without orphaning its postmeta.
 *
 * Routes (both POST, manage_options-only):
 *   /maintenance/prune-revisions  {page_id?, keep?=2, dry_run?=true, batch?=50}
 *     Deletes all but the newest `keep` revisions of the target page (or every
 *     page when page_id is omitted). Time- and batch-bounded so it can be
 *     called repeatedly until `remaining` reaches 0 without tripping a request
 *     timeout. Never touches non-revision rows.
 *   /maintenance/db-stats
 *     information_schema table-size report (so the DB footprint is observable
 *     before/after a prune).
 *
 * Both bypass the ControllerBase rate-limiter / session-header machinery (this
 * is a break-glass admin tool that may be polled in a tight loop), but remain
 * gated on the manage_options capability via permissionsAdmin().
 */
final class MaintenanceController extends ControllerBase
{
    /** Wall-clock budget per prune call (seconds); leaves headroom under PHP max_execution_time. */
    private const TIME_BUDGET_SECONDS = 20.0;

    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/maintenance/prune-revisions', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'pruneRevisions'],
            'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
        register_rest_route(self::NAMESPACE, '/maintenance/db-stats', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'dbStats'],
            'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
    }

    /**
     * POST /maintenance/prune-revisions
     *
     * Keeps the newest `keep` revisions per page and deletes the rest in a
     * bounded batch. Stateless + idempotent: each call recomputes the excess
     * set, so a caller just repeats the request until `remaining` === 0.
     */
    public function pruneRevisions(WP_REST_Request $req): WP_REST_Response
    {
        return $this->guard(function () use ($req) {
            global $wpdb;

            $pageId = $req->get_param('page_id') !== null ? (int) $req->get_param('page_id') : null;
            $keep = $req->get_param('keep') !== null ? max(0, (int) $req->get_param('keep')) : 2;
            $batch = $req->get_param('batch') !== null ? max(1, min(500, (int) $req->get_param('batch'))) : 50;
            $estimateBytes = $req->get_param('estimate_bytes') !== null
                && filter_var($req->get_param('estimate_bytes'), FILTER_VALIDATE_BOOLEAN);
            // Default dry_run TRUE — destructive deletes require an explicit dry_run=false.
            $dryRunParam = $req->get_param('dry_run');
            $dryRun = $dryRunParam === null ? true : filter_var($dryRunParam, FILTER_VALIDATE_BOOLEAN);

            // All revision rows in scope, newest-first within each parent.
            if ($pageId !== null) {
                $rows = $wpdb->get_results($wpdb->prepare(
                    "SELECT ID, post_parent FROM {$wpdb->posts}
                     WHERE post_type = 'revision' AND post_parent = %d
                     ORDER BY post_parent ASC, post_date DESC, ID DESC",
                    $pageId
                ), ARRAY_A) ?: [];
            } else {
                $rows = $wpdb->get_results(
                    "SELECT ID, post_parent FROM {$wpdb->posts}
                     WHERE post_type = 'revision'
                     ORDER BY post_parent ASC, post_date DESC, ID DESC",
                    ARRAY_A
                ) ?: [];
            }

            // Per parent: keep the first `keep` (newest), queue the rest for deletion.
            $toDelete = [];
            $keptPerParent = [];
            foreach ($rows as $r) {
                $parent = (int) $r['post_parent'];
                $keptPerParent[$parent] = $keptPerParent[$parent] ?? 0;
                if ($keptPerParent[$parent] < $keep) {
                    $keptPerParent[$parent]++;
                    continue;
                }
                $toDelete[] = (int) $r['ID'];
            }

            $excessTotal = count($toDelete);

            if ($dryRun) {
                return $this->ok([
                    'dry_run' => true,
                    'page_id' => $pageId,
                    'keep' => $keep,
                    'scanned_revisions' => count($rows),
                    'pages_in_scope' => count($keptPerParent),
                    'deleted' => 0,
                    'would_delete' => $excessTotal,
                    'remaining' => $excessTotal,
                    'done' => $excessTotal === 0,
                ]);
            }

            // Real deletion — bounded by both batch count and wall-clock budget.
            $start = microtime(true);
            $deleted = 0;
            $failed = 0;
            $freedBytes = 0;
            foreach ($toDelete as $rid) {
                if ($deleted >= $batch) {
                    break;
                }
                if ((microtime(true) - $start) > self::TIME_BUDGET_SECONDS) {
                    break;
                }
                if ($estimateBytes) {
                    $freedBytes += $this->estimateRevisionBytes($rid);
                }
                $result = wp_delete_post_revision($rid);
                if ($result && !is_wp_error($result)) {
                    $deleted++;
                } else {
                    $failed++;
                }
            }

            $remaining = max(0, $excessTotal - $deleted);
            $payload = [
                'dry_run' => false,
                'page_id' => $pageId,
                'keep' => $keep,
                'scanned_revisions' => count($rows),
                'pages_in_scope' => count($keptPerParent),
                'deleted' => $deleted,
                'failed' => $failed,
                'remaining' => $remaining,
                'done' => $remaining === 0,
                'elapsed_ms' => (int) round((microtime(true) - $start) * 1000),
            ];
            if ($estimateBytes) {
                $payload['bytes_estimate'] = $freedBytes;
            }
            return $this->ok($payload);
        });
    }

    /**
     * POST /maintenance/db-stats
     *
     * Per-table size report from information_schema, ordered largest-first,
     * plus the current revision row count. Lets an operator see the DB
     * footprint before and after a prune.
     */
    public function dbStats(WP_REST_Request $req): WP_REST_Response
    {
        return $this->guard(function () {
            global $wpdb;

            $rows = $wpdb->get_results(
                "SELECT table_name AS name, table_rows AS row_estimate,
                        data_length, index_length, (data_length + index_length) AS total_bytes
                 FROM information_schema.TABLES
                 WHERE table_schema = DATABASE()
                 ORDER BY total_bytes DESC",
                ARRAY_A
            ) ?: [];

            $tables = [];
            $totalBytes = 0;
            foreach ($rows as $r) {
                $total = (int) $r['total_bytes'];
                $totalBytes += $total;
                $tables[] = [
                    'name' => (string) $r['name'],
                    'rows' => (int) $r['row_estimate'],
                    'data_mb' => round(((int) $r['data_length']) / 1048576, 2),
                    'index_mb' => round(((int) $r['index_length']) / 1048576, 2),
                    'total_mb' => round($total / 1048576, 2),
                ];
            }

            $revisionCount = (int) $wpdb->get_var(
                "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'revision'"
            );

            return $this->ok([
                'database' => $wpdb->dbname ?? null,
                'total_mb' => round($totalBytes / 1048576, 2),
                'table_count' => count($tables),
                'revision_count' => $revisionCount,
                'tables' => $tables,
            ]);
        });
    }

    /** Best-effort byte footprint of a single revision (post row + its postmeta). */
    private function estimateRevisionBytes(int $revisionId): int
    {
        global $wpdb;
        $post = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(LENGTH(post_content), 0) + COALESCE(LENGTH(post_title), 0)
                    + COALESCE(LENGTH(post_excerpt), 0)
             FROM {$wpdb->posts} WHERE ID = %d",
            $revisionId
        ));
        $meta = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(LENGTH(meta_value) + LENGTH(meta_key)), 0)
             FROM {$wpdb->postmeta} WHERE post_id = %d",
            $revisionId
        ));
        return $post + $meta;
    }

    /** Minimal try/catch envelope (admin capability is already enforced by permission_callback). */
    private function guard(callable $fn): WP_REST_Response
    {
        try {
            $result = $fn();
            return $result instanceof WP_REST_Response
                ? $result
                : $this->ok(is_array($result) ? $result : ['result' => $result]);
        } catch (\Throwable $e) {
            if (class_exists(\Joist\Core\Logger::class)) {
                \Joist\Core\Logger::error('maintenance.unhandled_throw', [
                    'message' => $e->getMessage(),
                    'file' => basename($e->getFile()) . ':' . $e->getLine(),
                ]);
            }
            return new WP_REST_Response([
                'code' => 'maintenance.error',
                'message' => (defined('WP_DEBUG') && WP_DEBUG) ? $e->getMessage() : 'Maintenance operation failed.',
                'details' => [],
                'recovery_suggestions' => [],
            ], 500);
        }
    }
}
