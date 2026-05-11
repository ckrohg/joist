<?php
declare(strict_types=1);

namespace Joist\Concurrency;

use Joist\Elementor\WriteException;

/**
 * Per-page locks against custom table (constraint #22 — replaces transient-
 * backed locks which bloat wp_options autoload on no-object-cache hosts).
 *
 * Same session reusing the lock is a no-op (extends TTL). Different session
 * sees 423.
 */
final class LockManager
{
    public function acquire(int $postId, string $sessionId, int $ttlSeconds = 60, ?string $reason = null): void
    {
        global $wpdb;
        $table = $wpdb->prefix . 'joist_locks';
        $now = time();
        $expires = $now + max(10, $ttlSeconds);

        // Validate post exists.
        if (!get_post($postId)) {
            throw new WriteException('not_found.page', "Page {$postId} not found.", 404);
        }

        $existing = $wpdb->get_row(
            $wpdb->prepare("SELECT session_id, UNIX_TIMESTAMP(expires_at) AS exp FROM {$table} WHERE post_id = %d", $postId),
            ARRAY_A
        );

        if ($existing !== null && (int) $existing['exp'] > $now) {
            if ($existing['session_id'] !== $sessionId) {
                throw new WriteException(
                    'lock.held',
                    "Page {$postId} is locked by another session.",
                    423,
                    ['locked_by' => $existing['session_id'], 'expires_at' => date('c', (int) $existing['exp'])]
                );
            }
            // Same session — extend TTL.
            $wpdb->update($table,
                ['expires_at' => date('Y-m-d H:i:s', $expires)],
                ['post_id' => $postId]
            );
            return;
        }

        $wpdb->replace($table, [
            'post_id' => $postId,
            'session_id' => $sessionId,
            'acquired_at' => date('Y-m-d H:i:s', $now),
            'expires_at' => date('Y-m-d H:i:s', $expires),
            'reason' => $reason,
        ]);
    }

    public function release(int $postId, string $sessionId): void
    {
        global $wpdb;
        $wpdb->delete(
            $wpdb->prefix . 'joist_locks',
            ['post_id' => $postId, 'session_id' => $sessionId]
        );
    }

    /** Hard release ignoring session ID — admin-only operation. */
    public function forceRelease(int $postId): void
    {
        global $wpdb;
        $wpdb->delete($wpdb->prefix . 'joist_locks', ['post_id' => $postId]);
    }

    /** Prune expired locks. Called from daily cron. */
    public static function prune(): void
    {
        global $wpdb;
        $wpdb->query(
            $wpdb->prepare(
                "DELETE FROM {$wpdb->prefix}joist_locks WHERE expires_at < %s",
                date('Y-m-d H:i:s')
            )
        );
    }
}
