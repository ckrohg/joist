<?php
declare(strict_types=1);

namespace Joist\Concurrency;

/**
 * Per-session counters for chained-singleton plan-required detection (#19),
 * cost tracking, and audit attribution.
 *
 * Sessions auto-expire after 1 hour inactivity.
 */
final class SessionTracker
{
    public function start(string $agentName, ?string $agentVersion, ?string $intent, ?string $userLabel, int $appPasswordUserId): string
    {
        global $wpdb;
        $id = 'ses_' . self::ulid();
        $now = date('Y-m-d H:i:s');
        $wpdb->insert($wpdb->prefix . 'joist_sessions', [
            'id' => $id,
            'agent_name' => $agentName,
            'agent_version' => $agentVersion,
            'app_password_user_id' => $appPasswordUserId,
            'intent' => $intent,
            'user_label' => $userLabel,
            'started_at' => $now,
            'last_activity' => $now,
            'op_count' => 0,
            'ops_destructive' => 0,
            'ops_per_page' => null,
            'cost_tokens' => 0,
        ]);
        return $id;
    }

    public function end(string $sessionId): void
    {
        global $wpdb;
        $wpdb->update(
            $wpdb->prefix . 'joist_sessions',
            ['ended_at' => date('Y-m-d H:i:s')],
            ['id' => $sessionId]
        );
    }

    public function recordOp(string $sessionId, string $op, ?int $pageId = null): void
    {
        global $wpdb;
        $table = $wpdb->prefix . 'joist_sessions';
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT op_count, ops_destructive, ops_per_page FROM {$table} WHERE id = %s", $sessionId),
            ARRAY_A
        );
        if ($row === null) {
            return;
        }

        $isDestructive = in_array($op, ['delete', 'unwrap', 'replace_full'], true);
        $opsPerPage = $row['ops_per_page'] ? (array) json_decode(gzdecode($row['ops_per_page']) ?: '[]', true) : [];
        if ($pageId !== null) {
            $opsPerPage[$pageId] = ($opsPerPage[$pageId] ?? 0) + 1;
        }

        $wpdb->update($table, [
            'op_count' => ((int) $row['op_count']) + 1,
            'ops_destructive' => ((int) $row['ops_destructive']) + ($isDestructive ? 1 : 0),
            'ops_per_page' => gzencode((string) wp_json_encode($opsPerPage)),
            'last_activity' => date('Y-m-d H:i:s'),
        ], ['id' => $sessionId]);
    }

    /** @return array{op_count:int, ops_destructive:int, ops_per_page:array<int,int>} */
    public function counters(string $sessionId): array
    {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT op_count, ops_destructive, ops_per_page FROM {$wpdb->prefix}joist_sessions WHERE id = %s",
                $sessionId
            ),
            ARRAY_A
        );
        if ($row === null) {
            return ['op_count' => 0, 'ops_destructive' => 0, 'ops_per_page' => []];
        }
        $perPage = $row['ops_per_page'] ? (array) json_decode(gzdecode($row['ops_per_page']) ?: '[]', true) : [];
        return [
            'op_count' => (int) $row['op_count'],
            'ops_destructive' => (int) $row['ops_destructive'],
            'ops_per_page' => $perPage,
        ];
    }

    public function hasApprovedPlanForPage(string $sessionId, ?int $pageId): bool
    {
        if ($pageId === null) return false;
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT last_approved_plan_id FROM {$wpdb->prefix}joist_sessions WHERE id = %s",
                $sessionId
            ),
            ARRAY_A
        );
        if ($row === null || empty($row['last_approved_plan_id'])) return false;

        // Verify the plan is approved AND covers this page.
        $plan = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT status, page_id FROM {$wpdb->prefix}joist_plans WHERE id = %s",
                $row['last_approved_plan_id']
            ),
            ARRAY_A
        );
        return $plan !== null
            && in_array($plan['status'], ['approved', 'executing'], true)
            && (int) $plan['page_id'] === $pageId;
    }

    public function markPlanApproved(string $sessionId, string $planId): void
    {
        global $wpdb;
        $wpdb->update(
            $wpdb->prefix . 'joist_sessions',
            [
                // Reset counters when a plan is approved.
                'op_count' => 0,
                'ops_destructive' => 0,
                'ops_per_page' => null,
                'last_approved_plan_id' => $planId,
                'last_activity' => date('Y-m-d H:i:s'),
            ],
            ['id' => $sessionId]
        );
    }

    /** Crockford-like ULID (time-prefixed, but with random suffix). */
    public static function ulid(): string
    {
        $time = base_convert((string) (int) (microtime(true) * 1000), 10, 36);
        $rand = bin2hex(random_bytes(8));
        return strtoupper($time) . $rand;
    }
}
