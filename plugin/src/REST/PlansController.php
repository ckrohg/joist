<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use WP_REST_Request;
use WP_REST_Server;

/**
 * /joist/v1/plans — Plan Mode (§19.1).
 *
 * Create (agent) → approve in WP admin with approval_token + CSRF +
 * approver-binding → execute atomically.
 */
final class PlansController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/plans', [
            ['methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'create'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'list'], 'permission_callback' => [$this, 'permissionsCheck']],
        ]);
        register_rest_route(self::NAMESPACE, '/plans/(?P<id>[A-Za-z0-9_-]+)', [
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'get'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => 'DELETE', 'callback' => [$this, 'delete'], 'permission_callback' => [$this, 'permissionsAdmin']],
        ]);
        register_rest_route(self::NAMESPACE, '/plans/(?P<id>[A-Za-z0-9_-]+)/approve', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'approve'], 'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
        register_rest_route(self::NAMESPACE, '/plans/(?P<id>[A-Za-z0-9_-]+)/reject', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'reject'], 'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
        register_rest_route(self::NAMESPACE, '/plans/(?P<id>[A-Za-z0-9_-]+)/execute', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'execute'], 'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/plans/generate', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'generate'], 'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    /**
     * POST /plans/generate — translate a natural-language intent into a Plan.
     *
     * Body: { intent: string, page_id?: int }
     * Returns: the freshly-created Plan row (same shape as POST /plans).
     *
     * Falls back to a deterministic template plan when no Anthropic API key
     * is configured so the loop can be demoed without a paid call.
     */
    public function generate(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req, string $sessionId) {
            $body = $req->get_json_params();
            $intent = trim((string) ($body['intent'] ?? ''));
            $pageId = isset($body['page_id']) ? (int) $body['page_id'] : null;
            if ($intent === '') {
                throw new WriteException('validation.intent_required', 'intent is required.', 422);
            }
            $generator = new \Joist\Plan\PlanGenerator();
            $steps = $generator->generate($intent, $pageId);
            $plan = Container::get('planStore')->create($sessionId, $pageId, $intent, $steps);
            Container::get('webhooks')->emit('plan.created', [
                'plan_id' => $plan['plan_id'],
                'page_id' => $pageId,
                'intent' => $intent,
                'step_count' => count($steps),
                'generated' => true,
                'source' => 'plan_generator',
            ]);
            return $this->ok(array_merge($plan, ['step_count' => count($steps)]), 201);
        });
    }

    public function create(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req, string $sessionId) {
            $body = $req->get_json_params();
            $intent = (string) ($body['intent'] ?? 'unspecified');
            $pageId = isset($body['page_id']) ? (int) $body['page_id'] : null;
            $steps = is_array($body['steps'] ?? null) ? $body['steps'] : [];
            if (count($steps) === 0) throw new WriteException('validation.empty_steps', 'A plan needs at least one step.', 400);

            $plan = Container::get('planStore')->create($sessionId, $pageId, $intent, $steps);
            Container::get('webhooks')->emit('plan.created', [
                'plan_id' => $plan['plan_id'],
                'page_id' => $pageId,
                'intent' => $intent,
                'step_count' => count($steps),
                'approval_url' => $plan['approval_url'],
            ]);
            return $this->ok($plan, 201);
        });
    }

    /**
     * DELETE /plans/{id} — admin-only permanent delete. Used by the Plan Mode
     * UI to clean up test plans and cancelled drafts. Returns 204-shape ok
     * envelope after the row is gone.
     */
    public function delete(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $planId = (string) $req['id'];
            Container::get('planStore')->delete($planId);
            Container::get('webhooks')->emit('plan.deleted', ['plan_id' => $planId]);
            return $this->ok(['deleted' => true, 'plan_id' => $planId]);
        });
    }

    public function list(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', fn() => $this->ok(['plans' => Container::get('planStore')->listRecent()]));
    }

    public function get(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $plan = Container::get('planStore')->get((string) $req->get_param('id'));
            if ($plan === null) throw new WriteException('not_found.plan', 'Plan not found.', 404);
            unset($plan['approval_token']); // never echo the token in a read
            return $this->ok($plan);
        });
    }

    public function approve(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $planId = (string) $req->get_param('id');
            $body = $req->get_json_params();
            $token = (string) ($body['approval_token'] ?? $req->get_param('token') ?? '');
            if ($token === '') throw new WriteException('validation.token_required', 'approval_token is required.', 400);

            $user = wp_get_current_user();
            $plan = Container::get('planStore')->approve(
                $planId, $token, (int) $user->ID, 'wp-admin:' . substr(wp_get_session_token() ?: '', 0, 16)
            );
            return $this->ok(['plan_id' => $planId, 'status' => 'approved', 'page_id' => $plan['page_id']]);
        });
    }

    public function reject(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $planId = (string) $req->get_param('id');
            $body = $req->get_json_params();
            $token = (string) ($body['approval_token'] ?? $req->get_param('token') ?? '');
            Container::get('planStore')->reject($planId, $token, $body['note'] ?? null);
            return $this->ok(['plan_id' => $planId, 'status' => 'rejected']);
        });
    }

    public function execute(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $planId = (string) $req->get_param('id');
            $result = Container::get('planExecutor')->execute($planId);
            return $this->ok($result);
        });
    }
}
