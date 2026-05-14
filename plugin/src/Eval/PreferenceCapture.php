<?php
declare(strict_types=1);

namespace Joist\Eval;

use Joist\Audit\AuditLogger;

/**
 * Hooks plan rejection events and emits webhooks so the MCP server (or any
 * subscriber) can run Claude-side extraction and POST the result back via
 * /joist/v1/preferences. v0.7-α only wires the action; extraction runs out-of-
 * process.
 */
final class PreferenceCapture
{
    public function __construct(
        private AuditLogger $audit,
        private \Joist\Webhooks\WebhookEmitter $webhooks,
    ) {}

    public static function init(): void
    {
        add_action('joist_plan_rejected', [self::class, 'onPlanRejected'], 10, 2);
    }

    /**
     * Fired by PlansController::reject(). Payload: the plan row + the rejection note.
     */
    public static function onPlanRejected(array $plan, ?string $note): void
    {
        if (!$note) return;

        // Emit webhook so subscribers (MCP server) can run extraction.
        // The extracted rules come back via POST /joist/v1/preferences.
        if (class_exists(\Joist\Container::class)) {
            $emitter = \Joist\Container::get('webhooks');
            $emitter->emit('plan.rejected_with_note', [
                'plan_id' => $plan['id'] ?? null,
                'page_id' => $plan['page_id'] ?? null,
                'session_id' => $plan['session_id'] ?? null,
                'intent' => $plan['intent'] ?? null,
                'note' => $note,
                'steps' => $plan['steps'] ?? [],
            ]);
        }
    }
}
