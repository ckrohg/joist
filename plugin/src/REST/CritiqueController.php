<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Critique\AesEvalRubric;
use Joist\Critique\CritiqueResult;
use Joist\Critique\CritiqueRunner;
use Joist\Critique\CritiqueCostMeter;
use Joist\Elementor\WriteException;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * @purpose Wave 11 REST surface for the generator/evaluator harness.
 *
 * Endpoints:
 *   POST /joist/v1/critique             — judge a screenshot, return verdict
 *   GET  /joist/v1/critique/cost-meter  — session running total + cap
 *   GET  /joist/v1/critique/rubric      — public AesEval-Bench rubric schema
 *   GET  /joist/v1/critique/health      — dark-test sentinel for acceptance.sh
 *
 * All endpoints use ControllerBase::handle() so they inherit HTTPS enforcement,
 * rate-limit buckets, error envelopes, and the X-Joist-Session-Id discipline.
 */
final class CritiqueController extends ControllerBase
{
    private const ALLOWED_BODY_KEYS = [
        'site_id',
        'page_id',
        'screenshot_url',
        'screenshot_b64',
        'brand_tokens',
        'forbidden',
        'rubric',
        'max_iterations_remaining',
        'previous_score',
        'element_tree',
        'tree_signature',
        'phash',
        'model',
    ];

    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/critique', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'critique'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);

        register_rest_route(self::NAMESPACE, '/critique/cost-meter', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'costMeter'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);

        register_rest_route(self::NAMESPACE, '/critique/rubric', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'rubric'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);

        register_rest_route(self::NAMESPACE, '/critique/health', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'health'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    public function critique(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $body = $this->jsonBody($req);
            $this->rejectUnknownKeys($body, self::ALLOWED_BODY_KEYS);

            $siteId = $this->requireString($body, 'site_id');
            // Need at least one of screenshot_url, screenshot_b64.
            $hasUrl = isset($body['screenshot_url']) && is_string($body['screenshot_url']) && $body['screenshot_url'] !== '';
            $hasB64 = isset($body['screenshot_b64']) && is_string($body['screenshot_b64']) && $body['screenshot_b64'] !== '';
            if (!$hasUrl && !$hasB64) {
                throw new WriteException(
                    'critique.missing_screenshot',
                    'One of screenshot_url or screenshot_b64 is required.',
                    422,
                    ['missing_field' => 'screenshot_url|screenshot_b64'],
                );
            }

            $params = [
                'site_id' => $siteId,
                'session_id' => $sessionId,
            ];
            foreach (self::ALLOWED_BODY_KEYS as $k) {
                if (isset($body[$k])) {
                    $params[$k] = $body[$k];
                }
            }

            /** @var CritiqueRunner $runner */
            $runner = Container::get('critiqueRunner');
            $result = $runner->critique($params);

            return $this->resultToResponse($result);
        });
    }

    public function costMeter(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req, string $sessionId) {
            /** @var CritiqueCostMeter $meter */
            $meter = Container::get('critiqueCostMeter');
            return $this->ok($meter->snapshot($sessionId));
        });
    }

    public function rubric(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function () {
            return $this->ok([
                'rubric' => AesEvalRubric::publicSchema(),
                'composite_thresholds' => [
                    'accept' => CritiqueRunner::ACCEPT_THRESHOLD,
                    'accept_axis_floor' => CritiqueRunner::ACCEPT_AXIS_FLOOR,
                ],
                'iteration_cap' => CritiqueRunner::MAX_ITERATIONS,
                'failure_mode_constraints' => [
                    '#21' => 'Forced Optimization gate on Document::save',
                    '#22' => 'Anti-cliché diversity check',
                    '#23' => 'Bounded critique iteration (N=5)',
                    '#24' => 'No autonomous raw-VLM slop filter',
                ],
            ]);
        });
    }

    public function health(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req, string $sessionId) {
            /** @var CritiqueRunner $runner */
            $runner = Container::get('critiqueRunner');
            return $this->ok([
                'controller_loaded' => true,
                'runner_loaded' => true,
                'api_key_configured' => $runner->resolveApiKey() !== null,
                'model_in_use' => $runner->resolveModel(),
                'iteration_cap' => CritiqueRunner::MAX_ITERATIONS,
                'aeseval_rubric_version' => AesEvalRubric::VERSION,
                'exemplar_pack_loaded' => class_exists('\\Joist\\Eval\\ExemplarPackManager'),
                'forced_optimization_gate' => 'enforced_in_document_writer',
            ]);
        });
    }

    private function resultToResponse(CritiqueResult $result): WP_REST_Response
    {
        $body = $result->toApi();
        return match ($result->status) {
            CritiqueResult::STATUS_OK => $this->ok($body, 200),
            CritiqueResult::STATUS_UNCONFIGURED => $this->ok($body, 200),
            CritiqueResult::STATUS_COST_CAPPED => (function () use ($result, $body) {
                $r = new WP_REST_Response([
                    'code' => $result->errorCode ?? 'cost_cap_exceeded',
                    'message' => $result->reason ?? 'Per-session critique cap exceeded.',
                    'details' => $body,
                    'recovery_suggestions' => [[
                        'op' => 'increase_cap',
                        'args' => ['option' => 'joist_critique_cap_usd'],
                        'rationale' => 'Raise joist_critique_cap_usd or wait for next session.',
                    ]],
                ], 429);
                $r->header('Retry-After', '0');
                return $r;
            })(),
            CritiqueResult::STATUS_PROVIDER_ERROR => new WP_REST_Response([
                'code' => $result->errorCode ?? 'critique.provider_error',
                'message' => $result->reason ?? 'Critique provider call failed.',
                'details' => $body,
                'recovery_suggestions' => [[
                    'op' => 'retry',
                    'args' => [],
                    'rationale' => 'Transient provider error; retry with same body.',
                ]],
            ], 502),
            default => $this->ok($body, 200),
        };
    }

    // ───────── helpers ─────────

    /** @return array<string,mixed> */
    private function jsonBody(WP_REST_Request $req): array
    {
        $raw = $req->get_body();
        if ($raw === null || $raw === '') {
            throw new WriteException('validation.empty_body', 'Request body is required (application/json).', 422);
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new WriteException('validation.invalid_json', 'Request body must be a JSON object.', 422);
        }
        return $decoded;
    }

    private function requireString(array $body, string $key): string
    {
        if (!isset($body[$key]) || !is_string($body[$key]) || trim($body[$key]) === '') {
            throw new WriteException('validation.required', "{$key} is required and must be a non-empty string.", 422);
        }
        return $body[$key];
    }

    /**
     * Reject unknown body fields per failure-mode constraint #1.
     *
     * @param array<string,mixed> $body
     * @param list<string> $allowed
     */
    private function rejectUnknownKeys(array $body, array $allowed): void
    {
        $unknown = [];
        foreach (array_keys($body) as $k) {
            if (!in_array($k, $allowed, true)) {
                $unknown[] = (string) $k;
            }
        }
        if (count($unknown) > 0) {
            throw new WriteException(
                'critique.unknown_field',
                'Unknown body fields on /critique: ' . implode(', ', $unknown) . '. Valid: ' . implode(', ', $allowed),
                422,
                ['unknown_keys' => $unknown, 'valid_fields' => $allowed],
            );
        }
    }
}
