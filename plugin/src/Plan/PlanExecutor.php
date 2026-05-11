<?php
declare(strict_types=1);

namespace Joist\Plan;

use Joist\Concurrency\SessionTracker;
use Joist\Core\Hasher;
use Joist\Core\Logger;
use Joist\Elementor\DocumentWriter;
use Joist\Elementor\PatchEngine;
use Joist\Elementor\WriteException;
use Joist\Storage\RevisionStore;
use Joist\Webhooks\WebhookEmitter;

/**
 * Execute an approved plan atomically.
 *
 * Sequence:
 *   1. Mark plan executing.
 *   2. Snapshot the page at plan-start (rollback target for the WHOLE plan).
 *   3. Run each step through DocumentWriter (which itself snapshots per-call,
 *      but we keep the plan-level snapshot for full rollback).
 *   4. On any step failure: restore the plan-start snapshot, mark plan failed.
 *   5. On success: mark plan completed, reset session counters, fire webhook.
 */
final class PlanExecutor
{
    public function __construct(
        private PlanStore $store,
        private DocumentWriter $writer,
        private PatchEngine $patchEngine,
        private RevisionStore $revisions,
        private Hasher $hasher,
        private SessionTracker $sessions,
        private WebhookEmitter $webhooks,
    ) {}

    public function execute(string $planId): array
    {
        $plan = $this->store->get($planId);
        if ($plan === null) {
            throw new WriteException('not_found.plan', "Plan {$planId} not found.", 404);
        }
        if ($plan['status'] !== 'approved') {
            throw new WriteException('plan.not_approved', "Plan is '{$plan['status']}', must be 'approved' to execute.", 409);
        }

        $pageId = (int) ($plan['page_id'] ?? 0);
        $sessionId = (string) $plan['session_id'];

        $this->store->updateStatus($planId, 'executing');

        // Mark this plan as the approved-plan for the session so PolicyGuard
        // permits the steps.
        $this->sessions->markPlanApproved($sessionId, $planId);

        // Plan-level snapshot.
        $planSnapshotId = null;
        if ($pageId > 0) {
            $beforeHash = $this->hasher->forPage($pageId);
            $planSnapshotId = $this->revisions->snapshot(
                $pageId, $beforeHash, 'agent', $sessionId, $sessionId, 'plan:' . $planId
            );
        }

        $stepResults = [];
        try {
            $currentHash = $pageId > 0 ? $this->hasher->forPage($pageId) : null;

            foreach ($plan['steps'] as $i => $step) {
                $op = $step['op'] ?? '';
                $result = $this->executeStep($pageId, $sessionId, $plan['intent'] ?? '', $step, $currentHash);
                $stepResults[] = ['order' => $i + 1, 'op' => $op, 'result' => $result];
                $currentHash = $result['new_hash'] ?? $currentHash;
            }

            $this->store->updateStatus($planId, 'completed', [
                'steps' => $stepResults,
                'final_hash' => $currentHash,
            ]);

            $this->webhooks->emit('plan.completed', [
                'plan_id' => $planId,
                'page_id' => $pageId,
                'final_hash' => $currentHash,
                'step_count' => count($stepResults),
            ]);

            return [
                'plan_id' => $planId,
                'status' => 'completed',
                'final_hash' => $currentHash,
                'steps' => $stepResults,
            ];

        } catch (\Throwable $e) {
            // Roll back the WHOLE plan.
            if ($planSnapshotId !== null) {
                try {
                    $this->revisions->restore($planSnapshotId);
                } catch (\Throwable $rollbackErr) {
                    Logger::error('plan rollback failed', [
                        'plan_id' => $planId,
                        'snapshot_id' => $planSnapshotId,
                        'error' => $rollbackErr->getMessage(),
                    ]);
                }
            }
            $this->store->updateStatus($planId, 'failed', [
                'error' => $e->getMessage(),
                'failed_at_step' => count($stepResults) + 1,
                'completed_steps' => $stepResults,
            ]);
            $this->webhooks->emit('plan.failed', [
                'plan_id' => $planId,
                'page_id' => $pageId,
                'error' => $e->getMessage(),
                'failed_at_step' => count($stepResults) + 1,
            ]);
            throw $e;
        }
    }

    private function executeStep(int $pageId, string $sessionId, string $intent, array $step, ?string $expectedHash): array
    {
        $op = $step['op'] ?? '';

        // Steps that mutate the element tree go through PatchEngine then DocumentWriter.
        if (in_array($op, ['update_settings', 'replace_element', 'insert', 'delete', 'move', 'duplicate', 'wrap', 'unwrap'], true)) {
            $document = \Elementor\Plugin::$instance->documents->get($pageId);
            if (!$document) {
                throw new WriteException('not_found.page', "Page {$pageId} not found.", 404);
            }
            $current = $document->get_elements_data();
            $current = is_array($current) ? $current : [];

            [$newTree, $generatedIds] = $this->patchEngine->apply($current, [$step]);

            return $this->writer->save([
                'post_id' => $pageId,
                'elements' => $newTree,
                'expected_hash' => $expectedHash,
                'session_id' => $sessionId,
                'intent' => $intent . ' [plan step: ' . $op . ']',
                'actor_type' => 'agent',
                'actor_id' => $sessionId,
            ]);
        }

        if ($op === 'create_page') {
            // Step-based page creation handled separately; for v0.5 throw.
            throw new WriteException(
                'plan.create_page_in_step_unsupported',
                'create_page steps are not yet supported in plan execution; create the page first, then patch it.',
                400
            );
        }

        throw new WriteException('plan.unknown_step_op', "Unknown plan step op '{$op}'.", 400);
    }
}
