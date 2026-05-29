<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use Joist\Generate\Copy\BatchQueue;
use Joist\Generate\Copy\BrandBlockAssembler;
use Joist\Generate\Copy\CopyCostMeter;
use Joist\Generate\Copy\CopyGenerator;
use Joist\Generate\Copy\CopyResult;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * @purpose Wave 6c REST surface for copy generation.
 *
 * Endpoints:
 *   POST /joist/v1/generate/copy                 — single request, sync
 *   POST /joist/v1/generate/copy/batch           — N requests in one call, sync
 *   POST /joist/v1/generate/copy/enqueue         — add to per-site queue
 *   POST /joist/v1/generate/copy/flush/{site_id} — drain the queue
 *   GET  /joist/v1/generate/copy/cost-meter      — session running total + cap
 *   GET  /joist/v1/generate/copy/brand-block/{site_id} — introspection
 *
 * All endpoints use ControllerBase::handle() so they inherit HTTPS enforcement,
 * rate-limit buckets, error envelopes, and the X-Joist-Session-Id discipline.
 */
final class CopyGenController extends ControllerBase
{
    /** Recognised keys on POST /generate/copy body. */
    private const ALLOWED_BODY_KEYS = ['site_id', 'request', 'opts'];

    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/generate/copy', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'generate'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);

        register_rest_route(self::NAMESPACE, '/generate/copy/batch', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'batch'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);

        register_rest_route(self::NAMESPACE, '/generate/copy/enqueue', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'enqueue'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);

        register_rest_route(self::NAMESPACE, '/generate/copy/flush/(?P<site_id>[a-zA-Z0-9._-]+)', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'flush'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);

        register_rest_route(self::NAMESPACE, '/generate/copy/cost-meter', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'costMeter'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);

        register_rest_route(self::NAMESPACE, '/generate/copy/brand-block/(?P<site_id>[a-zA-Z0-9._-]+)', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'brandBlock'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    public function generate(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $body = $this->jsonBody($req);
            $this->rejectUnknownKeys($body, self::ALLOWED_BODY_KEYS);
            $siteId = $this->requireString($body, 'site_id');
            $request = $this->requireString($body, 'request');
            $opts = is_array($body['opts'] ?? null) ? $body['opts'] : [];
            $opts['session_id'] = $sessionId;

            /** @var CopyGenerator $gen */
            $gen = Container::get('copyGenerator');
            $result = $gen->generate($siteId, $request, $opts);

            return $this->resultToResponse($result);
        });
    }

    public function batch(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $body = $this->jsonBody($req);
            $this->rejectUnknownKeys($body, ['site_id', 'requests', 'opts']);
            $siteId = $this->requireString($body, 'site_id');
            $requests = $body['requests'] ?? null;
            if (!is_array($requests) || count($requests) === 0) {
                throw new WriteException('validation.required', 'requests[] is required and must be non-empty', 422);
            }
            $sharedOpts = is_array($body['opts'] ?? null) ? $body['opts'] : [];
            $sharedOpts['session_id'] = $sessionId;

            /** @var CopyGenerator $gen */
            $gen = Container::get('copyGenerator');
            /** @var BrandBlockAssembler $assembler */
            $assembler = Container::get('brandBlockAssembler');
            $brandBlock = $assembler->assemble($siteId, (string) ($sharedOpts['model'] ?? $gen->resolveModel()));
            $sharedOpts['brand_block'] = $brandBlock;

            $results = [];
            foreach ($requests as $r) {
                if (!is_array($r) || !isset($r['request']) || !is_string($r['request'])) {
                    $results[] = [
                        'status' => CopyResult::STATUS_PROVIDER_ERROR,
                        'error_code' => 'validation.invalid_item',
                        'reason' => 'each requests[] item must be {request: string, request_id?: string}',
                    ];
                    continue;
                }
                $itemRid = isset($r['request_id']) && is_string($r['request_id']) ? $r['request_id'] : '';
                $result = $gen->generate($siteId, $r['request'], $sharedOpts);
                $arr = $result->toArray();
                if ($itemRid !== '') {
                    $arr['request_id'] = $itemRid;
                }
                $results[] = $arr;
            }

            return $this->ok([
                'site_id' => $siteId,
                'count' => count($results),
                'results' => $results,
            ]);
        });
    }

    public function enqueue(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $body = $this->jsonBody($req);
            $this->rejectUnknownKeys($body, ['site_id', 'request', 'request_id', 'opts', 'flush_after_seconds']);
            $siteId = $this->requireString($body, 'site_id');
            $request = $this->requireString($body, 'request');
            $rid = isset($body['request_id']) && is_string($body['request_id']) ? $body['request_id'] : null;
            $opts = is_array($body['opts'] ?? null) ? $body['opts'] : [];
            $opts['session_id'] = $sessionId;

            /** @var BatchQueue $queue */
            $queue = Container::get('copyBatchQueue');
            $newId = $queue->enqueue($siteId, $request, $rid, $opts);

            // Optional: schedule a deferred flush on the same call.
            if (isset($body['flush_after_seconds']) && is_int($body['flush_after_seconds'])) {
                $queue->flushAfter($siteId, (int) $body['flush_after_seconds']);
            }

            return $this->ok([
                'request_id' => $newId,
                'status' => 'queued',
                'queue_depth' => $queue->depth($siteId),
                'site_id' => $siteId,
            ]);
        });
    }

    public function flush(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $siteId = (string) $req->get_param('site_id');
            if ($siteId === '') {
                throw new WriteException('validation.required', 'site_id is required', 422);
            }
            $body = $this->jsonBody($req, allowEmpty: true);
            $this->rejectUnknownKeys($body, ['opts']);
            $sharedOpts = is_array($body['opts'] ?? null) ? $body['opts'] : [];
            $sharedOpts['session_id'] = $sessionId;

            /** @var BatchQueue $queue */
            $queue = Container::get('copyBatchQueue');
            return $this->ok($queue->flush($siteId, $sharedOpts));
        });
    }

    public function costMeter(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req, string $sessionId) {
            /** @var CopyCostMeter $meter */
            $meter = Container::get('copyCostMeter');
            return $this->ok($meter->snapshot($sessionId));
        });
    }

    public function brandBlock(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req, string $sessionId) {
            $siteId = (string) $req->get_param('site_id');
            if ($siteId === '') {
                throw new WriteException('validation.required', 'site_id is required', 422);
            }

            /** @var BrandBlockAssembler $assembler */
            $assembler = Container::get('brandBlockAssembler');
            /** @var CopyGenerator $gen */
            $gen = Container::get('copyGenerator');
            $model = $gen->resolveModel();
            $block = $assembler->assemble($siteId, $model);
            $shape = $block->toPublicArray();
            $shape['model_in_use'] = $model;
            $shape['model_default'] = CopyGenerator::DEFAULT_MODEL;
            $shape['api_key_configured'] = $gen->resolveApiKey() !== null;
            return $this->ok($shape);
        });
    }

    // ───────── helpers ─────────

    /**
     * @return array<string,mixed>
     */
    private function jsonBody(WP_REST_Request $req, bool $allowEmpty = false): array
    {
        $raw = $req->get_body();
        if ($raw === null || $raw === '') {
            if ($allowEmpty) return [];
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
     * Reject unknown body fields (constraint #1 — typed errors, never silent
     * passthrough). Loud at write time saves "why is the agent ignoring this
     * field?" debugging later.
     *
     * @param array<string,mixed> $body
     * @param list<string> $allowed
     */
    private function rejectUnknownKeys(array $body, array $allowed): void
    {
        $unknown = [];
        foreach (array_keys($body) as $k) {
            if (!in_array($k, $allowed, true)) {
                $unknown[] = $k;
            }
        }
        if (count($unknown) > 0) {
            throw new WriteException(
                'validation.unknown_keys',
                'Unknown body fields: ' . implode(', ', $unknown) . '. Allowed: ' . implode(', ', $allowed),
                422,
                ['unknown_keys' => $unknown, 'allowed_keys' => $allowed],
            );
        }
    }

    private function resultToResponse(CopyResult $result): WP_REST_Response
    {
        $body = $result->toArray();
        return match ($result->status) {
            CopyResult::STATUS_OK => $this->ok($body, 200),
            CopyResult::STATUS_UNCONFIGURED => new WP_REST_Response([
                'code' => $result->errorCode ?? 'provider_unconfigured',
                'message' => $result->reason ?? 'Copy generation provider not configured.',
                'details' => $body,
                'recovery_suggestions' => [[
                    'op' => 'configure_api_key',
                    'args' => [],
                    'rationale' => 'Set JOIST_CLAUDE_API_KEY env var or joist_claude_api_key wp_option, then retry.',
                ]],
            ], 422),
            CopyResult::STATUS_COST_CAPPED => (function () use ($result, $body) {
                $r = new WP_REST_Response([
                    'code' => $result->errorCode ?? 'cost_cap_exceeded',
                    'message' => $result->reason ?? 'Per-session copy generation cap exceeded.',
                    'details' => $body,
                    'recovery_suggestions' => [[
                        'op' => 'increase_cap',
                        'args' => ['option' => 'joist_copy_gen_cap_usd'],
                        'rationale' => 'Raise joist_copy_gen_cap_usd or wait for next session.',
                    ]],
                ], 429);
                $r->header('Retry-After', '0');
                return $r;
            })(),
            CopyResult::STATUS_PROVIDER_ERROR => new WP_REST_Response([
                'code' => $result->errorCode ?? 'provider_error',
                'message' => $result->reason ?? 'Anthropic API call failed.',
                'details' => $body,
                'recovery_suggestions' => [[
                    'op' => 'retry',
                    'args' => [],
                    'rationale' => 'Transient provider failure. Retry once; if it persists, check logs.',
                ]],
            ], 502),
            default => $this->ok($body, 200),
        };
    }
}
