<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Elementor\WriteException;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Common base for all REST controllers.
 *
 * v0.1 M0: error envelope formatting, capability check.
 * v0.5: rate limiting, HTTPS enforcement, PolicyGuard hook, operating-mode check.
 */
abstract class ControllerBase
{
    protected const NAMESPACE = 'joist/v1';

    abstract public function register(): void;

    /**
     * Permission callback for all routes — requires the agent capability.
     * v0.1 M0: falls back to `edit_pages` since the joist_agent custom role
     * isn't registered yet. v0.5 registers the role and switches to
     * `joist_use_agent_api` exclusively.
     */
    public function permissionsCheck(WP_REST_Request $request): bool|WP_Error
    {
        if (current_user_can('joist_use_agent_api') || current_user_can('edit_pages')) {
            return true;
        }
        return new WP_Error(
            'auth.capability_missing',
            __('You do not have permission to use the Joist API.', 'joist'),
            ['status' => 403]
        );
    }

    /**
     * Turn an exception (or generic error) into the spec's error envelope.
     */
    protected function errorResponse(\Throwable $e): WP_REST_Response
    {
        if ($e instanceof WriteException) {
            return new WP_REST_Response(
                [
                    'code' => $e->errorCode,
                    'message' => $e->getMessage(),
                    'details' => $e->errorDetails,
                    'recovery_suggestions' => $this->recoveryFor($e->errorCode, $e->errorDetails),
                ],
                $e->httpStatus
            );
        }
        return new WP_REST_Response(
            [
                'code' => 'internal.unhandled',
                'message' => defined('WP_DEBUG') && WP_DEBUG ? $e->getMessage() : 'Internal error.',
                'details' => [],
                'recovery_suggestions' => [],
            ],
            500
        );
    }

    /**
     * Generate context-appropriate recovery suggestions (spec §3).
     * v0.1 M0: tiny library. v0.5 expands per error class.
     *
     * @return list<array{op:string,args:array,rationale:string}>
     */
    private function recoveryFor(string $code, array $details): array
    {
        return match ($code) {
            'elementor.hash_mismatch' => [[
                'op' => 'get_page',
                'args' => ['id' => $details['post_id'] ?? null],
                'rationale' => 'Re-read with new hash, then re-plan the edit.',
            ]],
            'schema.unknown_widget' => [[
                'op' => 'list_widgets',
                'args' => [],
                'rationale' => 'List installed widgets to find a valid type.',
            ]],
            default => [],
        };
    }

    protected function ok(array $payload, int $status = 200): WP_REST_Response
    {
        return new WP_REST_Response($payload, $status);
    }
}
