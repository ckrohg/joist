<?php
declare(strict_types=1);

namespace Joist\Audit;

/**
 * Hash-chained audit log (constraints #15, #30).
 *
 * Each row's `chain_hash = sha256(prev_row.chain_hash || sha256(row_payload))`.
 * If an attacker deletes a row from the middle of the chain, the next row's
 * chain_hash no longer matches when recomputed. Daily integrity check
 * surfaces tampering as an admin notice.
 */
final class AuditLogger
{
    /**
     * Append an audit entry. Returns the new row ID.
     */
    public function log(
        string $op,
        ?int $postId,
        string $actorType,
        ?string $actorId,
        ?int $appPasswordUserId,
        ?string $sessionId,
        ?string $beforeHash,
        ?string $afterHash,
        ?int $durationMs,
        ?string $intent,
        ?array $payload = null
    ): int {
        global $wpdb;
        $table = $wpdb->prefix . 'joist_audit';
        $now = date('Y-m-d H:i:s');

        $payloadBlob = $payload !== null ? gzencode((string) wp_json_encode($payload)) : null;

        $rowMaterial = [
            'timestamp' => $now,
            'op' => $op,
            'post_id' => $postId,
            'actor_type' => $actorType,
            'actor_id' => $actorId,
            'app_password_user_id' => $appPasswordUserId,
            'session_id' => $sessionId,
            'before_hash' => $beforeHash,
            'after_hash' => $afterHash,
            'duration_ms' => $durationMs,
            'intent' => $intent,
            'payload_hash' => $payloadBlob ? hash('sha256', $payloadBlob) : null,
        ];

        $prevChainHash = $wpdb->get_var(
            "SELECT chain_hash FROM {$table} ORDER BY id DESC LIMIT 1"
        );
        $prevChainHash = $prevChainHash ?: str_repeat('0', 64);

        $rowHash = hash('sha256', (string) wp_json_encode($rowMaterial));
        $chainHash = hash('sha256', $prevChainHash . $rowHash);

        $wpdb->insert($table, [
            'timestamp' => $now,
            'op' => $op,
            'post_id' => $postId,
            'actor_type' => $actorType,
            'actor_id' => $actorId,
            'app_password_user_id' => $appPasswordUserId,
            'session_id' => $sessionId,
            'before_hash' => $beforeHash,
            'after_hash' => $afterHash,
            'duration_ms' => $durationMs,
            'intent' => $intent,
            'payload' => $payloadBlob,
            'chain_hash' => $chainHash,
        ]);
        return (int) $wpdb->insert_id;
    }

    /**
     * @return list<array<string,mixed>>
     */
    public function query(array $filters = [], int $limit = 100): array
    {
        global $wpdb;
        $where = ['1=1'];
        $values = [];

        if (!empty($filters['session_id'])) {
            $where[] = 'session_id = %s';
            $values[] = $filters['session_id'];
        }
        if (!empty($filters['post_id'])) {
            $where[] = 'post_id = %d';
            $values[] = (int) $filters['post_id'];
        }
        if (!empty($filters['actor_type'])) {
            $where[] = 'actor_type = %s';
            $values[] = $filters['actor_type'];
        }
        if (!empty($filters['op'])) {
            $where[] = 'op = %s';
            $values[] = $filters['op'];
        }
        if (!empty($filters['from'])) {
            $where[] = 'timestamp >= %s';
            $values[] = $filters['from'];
        }
        if (!empty($filters['to'])) {
            $where[] = 'timestamp <= %s';
            $values[] = $filters['to'];
        }
        $values[] = $limit;

        $sql = "SELECT id, timestamp, op, post_id, actor_type, actor_id, app_password_user_id,
                       session_id, before_hash, after_hash, duration_ms, intent, chain_hash
                FROM {$wpdb->prefix}joist_audit
                WHERE " . implode(' AND ', $where) . "
                ORDER BY timestamp DESC LIMIT %d";

        $rows = $wpdb->get_results($wpdb->prepare($sql, ...$values), ARRAY_A);
        return $rows ?: [];
    }

    public function lastModifierFor(int $postId): ?array
    {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT actor_type, actor_id, app_password_user_id, session_id, timestamp
                 FROM {$wpdb->prefix}joist_audit
                 WHERE post_id = %d AND op IN ('document.save', 'document.patch')
                 ORDER BY timestamp DESC LIMIT 1",
                $postId
            ),
            ARRAY_A
        );
        return $row ?: null;
    }

    /**
     * Verify the chain. Returns IDs of any rows whose chain_hash is broken.
     * Run daily; surface results as admin notice.
     *
     * @return list<int>
     */
    public function verifyChain(): array
    {
        global $wpdb;
        $rows = $wpdb->get_results(
            "SELECT id, timestamp, op, post_id, actor_type, actor_id, app_password_user_id,
                    session_id, before_hash, after_hash, duration_ms, intent, payload, chain_hash
             FROM {$wpdb->prefix}joist_audit
             ORDER BY id ASC",
            ARRAY_A
        );
        if (!$rows) return [];

        $broken = [];
        $prevHash = str_repeat('0', 64);
        foreach ($rows as $row) {
            $material = [
                'timestamp' => $row['timestamp'],
                'op' => $row['op'],
                'post_id' => $row['post_id'] !== null ? (int) $row['post_id'] : null,
                'actor_type' => $row['actor_type'],
                'actor_id' => $row['actor_id'],
                'app_password_user_id' => $row['app_password_user_id'] !== null ? (int) $row['app_password_user_id'] : null,
                'session_id' => $row['session_id'],
                'before_hash' => $row['before_hash'],
                'after_hash' => $row['after_hash'],
                'duration_ms' => $row['duration_ms'] !== null ? (int) $row['duration_ms'] : null,
                'intent' => $row['intent'],
                'payload_hash' => $row['payload'] !== null ? hash('sha256', $row['payload']) : null,
            ];
            $rowHash = hash('sha256', (string) wp_json_encode($material));
            $expected = hash('sha256', $prevHash . $rowHash);
            if (!hash_equals($expected, (string) $row['chain_hash'])) {
                $broken[] = (int) $row['id'];
            }
            $prevHash = (string) $row['chain_hash'];
        }
        return $broken;
    }
}
