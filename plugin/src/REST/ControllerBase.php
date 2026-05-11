<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\InvalidSettingsException;
use Joist\Elementor\WriteException;
use Joist\Security\Role;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Common base for all REST controllers (v0.5).
 *
 * Cross-cutting concerns applied via wrap():
 *   #20  HTTPS enforcement (is_ssl() — return 421 over plain HTTP)
 *   §26  Rate limiting (token bucket per session)
 *   Standard error envelope with recovery_suggestions[]
 *   X-Joist-Session-Id header requirement for agent-role writes
 */
abstract class ControllerBase
{
    protected const NAMESPACE = 'joist/v1';

    abstract public function register(): void;

    /** Permission callback — requires the agent capability. */
    public function permissionsCheck(WP_REST_Request $request): bool|WP_Error
    {
        if (current_user_can(Role::CAP_USE_API) || current_user_can('edit_pages')) {
            return true;
        }
        return new WP_Error(
            'auth.capability_missing',
            __('You do not have permission to use the Joist API.', 'joist'),
            ['status' => 403]
        );
    }

    public function permissionsAdmin(WP_REST_Request $request): bool|WP_Error
    {
        if (current_user_can('manage_options')) {
            return true;
        }
        return new WP_Error(
            'auth.admin_required',
            __('This operation requires Administrator privileges.', 'joist'),
            ['status' => 403]
        );
    }

    /**
     * Wrap a handler with HTTPS check, rate limiting, error envelope.
     *
     * @param string $bucketClass One of 'reads' | 'writes' | 'plugin_install' | 'webhook_emit'
     */
    protected function handle(WP_REST_Request $request, string $bucketClass, callable $handler): WP_REST_Response
    {
        try {
            // #20 HTTPS enforcement (skip on local dev where HTTPS isn't set up).
            if (!is_ssl() && !$this->isLocalDev()) {
                throw new WriteException(
                    'transport.https_required',
                    'Joist requires HTTPS. Configure SSL on this site.',
                    421
                );
            }

            // §26 Rate limiting.
            $sessionId = (string) $request->get_header('X-Joist-Session-Id');
            if ($sessionId === '') {
                // Reads tolerated without a session; writes require one.
                if (in_array($bucketClass, ['writes', 'plugin_install'], true)) {
                    throw new WriteException(
                        'auth.session_required',
                        'Writes require an X-Joist-Session-Id header. Start a session via POST /sessions/start.',
                        400
                    );
                }
                $sessionId = 'anon-' . substr(md5((string) ($request->get_header('X-WP-Nonce') ?: $request->get_route())), 0, 16);
            }
            Container::get('rateLimiter')->consume($sessionId, $bucketClass);

            $result = $handler($request, $sessionId);
            if ($result instanceof WP_REST_Response) {
                return $result;
            }
            return $this->ok(is_array($result) ? $result : ['result' => $result]);

        } catch (WriteException $e) {
            return $this->writeException($e);
        } catch (InvalidSettingsException $e) {
            return new WP_REST_Response([
                'code' => $e->errorCode,
                'message' => $e->getMessage(),
                'details' => $e->errorDetails,
                'recovery_suggestions' => $this->recoveryFor($e->errorCode, $e->errorDetails),
            ], 422);
        } catch (\Throwable $e) {
            return new WP_REST_Response([
                'code' => 'internal.unhandled',
                'message' => (defined('WP_DEBUG') && WP_DEBUG) ? $e->getMessage() : 'Internal error.',
                'details' => (defined('WP_DEBUG') && WP_DEBUG) ? ['trace' => $e->getTraceAsString()] : [],
                'recovery_suggestions' => [],
            ], 500);
        }
    }

    private function writeException(WriteException $e): WP_REST_Response
    {
        $response = new WP_REST_Response([
            'code' => $e->errorCode,
            'message' => $e->getMessage(),
            'details' => $e->errorDetails,
            'recovery_suggestions' => $this->recoveryFor($e->errorCode, $e->errorDetails),
        ], $e->httpStatus);
        if ($e->httpStatus === 429 && isset($e->errorDetails['retry_after'])) {
            $response->header('Retry-After', (string) $e->errorDetails['retry_after']);
        }
        return $response;
    }

    /** @return list<array{op:string,args:array,rationale:string}> */
    private function recoveryFor(string $code, array $details): array
    {
        return match ($code) {
            'elementor.hash_mismatch' => [[
                'op' => 'get_page',
                'args' => ['id' => $details['post_id'] ?? null],
                'rationale' => 'Re-read with the new hash, then re-plan the edit.',
            ]],
            'schema.unknown_widget' => [[
                'op' => 'list_widgets',
                'args' => [],
                'rationale' => 'List installed widget types to find a valid one.',
            ]],
            'schema.unknown_key', 'schema.invalid_settings' => array_filter([
                isset($details['errors'][0]['suggestion'])
                    ? [
                        'op' => 'update_settings',
                        'args' => ['settings' => [$details['errors'][0]['suggestion'] => '...']],
                        'rationale' => 'Levenshtein-1 + flex_*-aware match for the rejected key.',
                    ]
                    : null,
                [
                    'op' => 'get_widget_schema',
                    'args' => ['type' => $details['widget_type'] ?? '?'],
                    'rationale' => 'Re-read the widget schema to find valid control names.',
                ],
            ]),
            'dynamic_tag.unknown' => [[
                'op' => 'list_dynamic_tags',
                'args' => [],
                'rationale' => 'List registered dynamic tags. Suggestions: ' . implode(', ', (array) ($details['suggestions'] ?? [])),
            ]],
            'layout.cross_mode_refused' => [[
                'op' => 'patch_page',
                'args' => ['note' => 'Use elType matching the site layout_mode, OR set force: true + obtain plan approval.'],
                'rationale' => 'This site uses a single layout mode; cross-mode inserts need explicit force.',
            ]],
            'policy.plan_required' => [[
                'op' => 'create_plan',
                'args' => [],
                'rationale' => 'This op requires Plan Mode approval. Compose a plan and request approval.',
            ]],
            'lock.held' => [[
                'op' => 'get_page',
                'args' => [],
                'rationale' => 'Another session holds the lock. Wait for it to release or re-read state.',
            ]],
            default => [],
        };
    }

    protected function ok(array $payload, int $status = 200): WP_REST_Response
    {
        return new WP_REST_Response($payload, $status);
    }

    protected function actorContext(WP_REST_Request $request, string $sessionId): array
    {
        $user = wp_get_current_user();
        $isAgent = $user instanceof \WP_User && in_array(Role::SLUG, (array) $user->roles, true);
        return [
            'session_id' => $sessionId,
            'actor_type' => $isAgent ? 'agent' : 'human',
            'actor_id' => $isAgent ? $sessionId : (string) ($user->ID ?? ''),
            'app_password_user_id' => $user instanceof \WP_User ? (int) $user->ID : null,
        ];
    }

    private function isLocalDev(): bool
    {
        $host = $_SERVER['HTTP_HOST'] ?? '';
        return str_ends_with($host, '.local') || str_ends_with($host, '.test') || $host === 'localhost' || str_starts_with($host, '127.0.0.1') || str_starts_with($host, 'localhost:');
    }
}
