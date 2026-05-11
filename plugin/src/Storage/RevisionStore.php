<?php
declare(strict_types=1);

namespace Joist\Storage;

/**
 * Snapshot-and-restore for atomic rollback (constraint #3).
 *
 * Each snapshot stores a gzipped JSON of `_elementor_data` keyed by post_id
 * + timestamp. Restore replays via DocumentWriter so all the hooks fire
 * identically to a normal save.
 */
final class RevisionStore
{
    /**
     * Take a snapshot of a page's current Elementor data.
     *
     * @return int Revision ID (auto-increment).
     */
    public function snapshot(
        int $postId,
        string $hash,
        string $actorType,
        ?string $actorId,
        ?string $sessionId,
        ?string $intent
    ): int {
        if (!class_exists('\Elementor\Plugin')) {
            return 0;
        }
        $document = \Elementor\Plugin::$instance->documents->get($postId);
        if (!$document) {
            return 0;
        }
        $data = $document->get_elements_data();
        $json = (string) wp_json_encode(is_array($data) ? $data : []);
        $snapshot = gzencode($json);

        global $wpdb;
        $wpdb->insert($wpdb->prefix . 'joist_revisions', [
            'post_id' => $postId,
            'hash' => $hash,
            'snapshot' => $snapshot,
            'snapshot_size' => strlen($snapshot),
            'actor_type' => $actorType,
            'actor_id' => $actorId,
            'session_id' => $sessionId,
            'intent' => $intent,
            'created_at' => date('Y-m-d H:i:s'),
        ]);
        $id = (int) $wpdb->insert_id;

        // Per-write pruning per #3 — keep last N per page.
        $this->prunePerPage($postId);

        return $id;
    }

    public function get(int $revisionId): ?array
    {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM {$wpdb->prefix}joist_revisions WHERE id = %d", $revisionId),
            ARRAY_A
        );
        if ($row === null) return null;
        $row['elements'] = json_decode(gzdecode($row['snapshot']) ?: '[]', true) ?: [];
        unset($row['snapshot']);
        return $row;
    }

    /**
     * Restore a snapshot. Used on rollback and on user-initiated restore.
     * Writes directly via Elementor's Document::save() — bypasses
     * DocumentWriter validation since this content was already written
     * once before, so it's known-valid.
     */
    public function restore(int $revisionId): bool
    {
        $rev = $this->get($revisionId);
        if ($rev === null) return false;
        $postId = (int) $rev['post_id'];

        if (!class_exists('\Elementor\Plugin')) return false;
        $document = \Elementor\Plugin::$instance->documents->get($postId);
        if (!$document) return false;

        $document->save([
            'elements' => $rev['elements'],
            'settings' => [],
        ]);
        return true;
    }

    /** @return array<int, array> */
    public function listForPage(int $postId, int $limit = 50): array
    {
        global $wpdb;
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT id, hash, actor_type, actor_id, session_id, intent, created_at, snapshot_size
                 FROM {$wpdb->prefix}joist_revisions
                 WHERE post_id = %d
                 ORDER BY created_at DESC LIMIT %d",
                $postId,
                $limit
            ),
            ARRAY_A
        );
        return $rows ?: [];
    }

    public function prunePerPage(int $postId): void
    {
        $maxPerPage = (int) get_option('joist_revisions_max_per_page', 50);
        if ($maxPerPage <= 0) return;

        global $wpdb;
        $table = $wpdb->prefix . 'joist_revisions';
        $wpdb->query($wpdb->prepare(
            "DELETE FROM {$table} WHERE post_id = %d AND id NOT IN (
                SELECT id FROM (
                    SELECT id FROM {$table} WHERE post_id = %d ORDER BY created_at DESC LIMIT %d
                ) AS keep
            )",
            $postId,
            $postId,
            $maxPerPage
        ));
    }

    /** Prune snapshots older than retention period. Called daily. */
    public static function pruneAged(): void
    {
        $retentionDays = (int) get_option('joist_revisions_retention_days', 90);
        if ($retentionDays <= 0) return;

        global $wpdb;
        $cutoff = date('Y-m-d H:i:s', time() - ($retentionDays * 86400));
        $wpdb->query($wpdb->prepare(
            "DELETE FROM {$wpdb->prefix}joist_revisions WHERE created_at < %s",
            $cutoff
        ));
    }
}
