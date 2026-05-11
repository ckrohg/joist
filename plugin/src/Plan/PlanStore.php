<?php
declare(strict_types=1);

namespace Joist\Plan;

use Joist\Concurrency\SessionTracker;
use Joist\Elementor\WriteException;

/**
 * Plan Mode persistence (§19.1, §23).
 *
 * Plans are created by the agent, approved by a human in WP admin (with
 * approval_token + CSRF + approver-binding), then executed atomically by
 * PlanExecutor. Plans expire after 1 hour.
 */
final class PlanStore
{
    public function create(string $sessionId, ?int $pageId, string $intent, array $steps): array
    {
        $id = 'pln_' . SessionTracker::ulid();
        $approvalToken = bin2hex(random_bytes(32));
        $now = date('Y-m-d H:i:s');
        $expiresAt = date('Y-m-d H:i:s', time() + 3600);

        global $wpdb;
        $wpdb->insert($wpdb->prefix . 'joist_plans', [
            'id' => $id,
            'approval_token' => $approvalToken,
            'session_id' => $sessionId,
            'page_id' => $pageId,
            'intent' => $intent,
            'steps' => gzencode((string) wp_json_encode($steps)),
            'status' => 'pending',
            'created_at' => $now,
            'expires_at' => $expiresAt,
        ]);

        return [
            'plan_id' => $id,
            'approval_token' => $approvalToken,
            'approval_url' => admin_url("admin.php?page=joist-plan&id={$id}&token={$approvalToken}"),
            'expires_at' => $expiresAt,
        ];
    }

    public function get(string $planId): ?array
    {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM {$wpdb->prefix}joist_plans WHERE id = %s", $planId),
            ARRAY_A
        );
        if ($row === null) return null;
        $row['steps'] = json_decode(gzdecode($row['steps']) ?: '[]', true) ?: [];
        $row['result'] = $row['result'] ? (json_decode(gzdecode($row['result']) ?: 'null', true)) : null;
        return $row;
    }

    public function approve(string $planId, string $approvalToken, int $approverUserId, string $approverSessionId): array
    {
        $plan = $this->get($planId);
        if ($plan === null) {
            throw new WriteException('not_found.plan', "Plan {$planId} not found.", 404);
        }
        if (!hash_equals((string) $plan['approval_token'], $approvalToken)) {
            throw new WriteException('plan.token_mismatch', 'Approval token does not match.', 403);
        }
        if ($plan['status'] !== 'pending') {
            throw new WriteException('plan.not_pending', "Plan is in status '{$plan['status']}', cannot approve.", 409);
        }
        if (strtotime($plan['expires_at']) < time()) {
            $this->updateStatus($planId, 'expired');
            throw new WriteException('plan.expired', 'Plan has expired. Regenerate it.', 410);
        }

        global $wpdb;
        $wpdb->update($wpdb->prefix . 'joist_plans', [
            'status' => 'approved',
            'approval_user_id' => $approverUserId,
            'approval_at' => date('Y-m-d H:i:s'),
            'approver_session_id' => $approverSessionId,
        ], ['id' => $planId]);

        return $this->get($planId);
    }

    public function reject(string $planId, string $approvalToken, ?string $note = null): void
    {
        $plan = $this->get($planId);
        if ($plan === null) {
            throw new WriteException('not_found.plan', "Plan {$planId} not found.", 404);
        }
        if (!hash_equals((string) $plan['approval_token'], $approvalToken)) {
            throw new WriteException('plan.token_mismatch', 'Approval token does not match.', 403);
        }
        global $wpdb;
        $wpdb->update($wpdb->prefix . 'joist_plans', [
            'status' => 'rejected',
            'result' => gzencode((string) wp_json_encode(['rejection_note' => $note])),
        ], ['id' => $planId]);
    }

    public function updateStatus(string $planId, string $status, ?array $result = null): void
    {
        global $wpdb;
        $data = ['status' => $status];
        if ($result !== null) {
            $data['result'] = gzencode((string) wp_json_encode($result));
        }
        if ($status === 'executing') {
            // re-use created_at as the executing-start sentinel for stale recovery
        }
        if (in_array($status, ['completed', 'failed'], true)) {
            $data['executed_at'] = date('Y-m-d H:i:s');
        }
        $wpdb->update($wpdb->prefix . 'joist_plans', $data, ['id' => $planId]);
    }

    /** @return list<array> */
    public function listRecent(int $limit = 50): array
    {
        global $wpdb;
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT id, session_id, page_id, intent, status, approval_at, executed_at, created_at, expires_at
                 FROM {$wpdb->prefix}joist_plans ORDER BY created_at DESC LIMIT %d",
                $limit
            ),
            ARRAY_A
        );
        return $rows ?: [];
    }
}
