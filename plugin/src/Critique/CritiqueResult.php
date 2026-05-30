<?php
declare(strict_types=1);

namespace Joist\Critique;

/**
 * @purpose Value object for a single critique call.
 *
 * Mirrors the public POST /critique response envelope so the REST controller
 * can pass `$result->toApi()` straight through. Statuses follow the same
 * shape as CopyResult (ok / unconfigured / cost_capped / provider_error) so
 * callers can branch consistently.
 */
final class CritiqueResult
{
    public const STATUS_OK = 'ok';
    public const STATUS_UNCONFIGURED = 'unconfigured';
    public const STATUS_COST_CAPPED = 'cost_capped';
    public const STATUS_PROVIDER_ERROR = 'provider_error';

    public const VERDICT_ACCEPT = 'accept';
    public const VERDICT_REVISE = 'revise';
    public const VERDICT_REJECT = 'reject';

    public function __construct(
        public readonly string $status,
        public readonly float $score = 0.0,
        public readonly string $verdict = self::VERDICT_REVISE,
        public readonly array $axes = [],
        public readonly array $regions = [],
        public readonly array $reasons = [],
        public readonly array $clicheMarkers = [],
        public readonly ?float $scoreDeltaVsPrevious = null,
        public readonly int $iterationBudgetRemaining = 0,
        public readonly array $antiClicheCheck = [],
        public readonly float $costUsd = 0.0,
        public readonly int $latencyMs = 0,
        public readonly string $generationId = '',
        public readonly ?string $reason = null,
        public readonly ?string $errorCode = null,
        public readonly array $cacheMetrics = [],
    ) {}

    public static function unconfigured(string $reason): self
    {
        return new self(
            status: self::STATUS_UNCONFIGURED,
            verdict: self::VERDICT_REVISE,
            reason: $reason,
            errorCode: 'provider_unconfigured',
        );
    }

    public static function costCapped(string $reason, float $sessionTotal, float $cap): self
    {
        return new self(
            status: self::STATUS_COST_CAPPED,
            verdict: self::VERDICT_REVISE,
            reason: $reason,
            errorCode: 'cost_cap_exceeded',
            antiClicheCheck: [
                'session_total_usd' => round($sessionTotal, 6),
                'cap_usd' => round($cap, 6),
            ],
        );
    }

    public static function providerError(string $reason, int $latencyMs, ?string $errorCode = null): self
    {
        return new self(
            status: self::STATUS_PROVIDER_ERROR,
            verdict: self::VERDICT_REVISE,
            reason: $reason,
            latencyMs: $latencyMs,
            errorCode: $errorCode ?? 'provider_error',
        );
    }

    /**
     * Public API envelope per specs/WAVE_9_2026-05-29.md §3.2.
     *
     * @return array<string,mixed>
     */
    public function toApi(): array
    {
        return [
            'status' => $this->status,
            'score' => round($this->score, 4),
            'verdict' => $this->verdict,
            'axes' => $this->axes,
            'regions' => $this->regions,
            'reasons' => $this->reasons,
            'cliche_markers' => $this->clicheMarkers,
            'score_delta_vs_previous' => $this->scoreDeltaVsPrevious !== null
                ? round($this->scoreDeltaVsPrevious, 4)
                : null,
            'iteration_budget_remaining' => $this->iterationBudgetRemaining,
            'anti_cliche_check' => $this->antiClicheCheck,
            'cost_usd' => round($this->costUsd, 6),
            'latency_ms' => $this->latencyMs,
            'generation_id' => $this->generationId,
            'reason' => $this->reason,
            'error_code' => $this->errorCode,
            'cache_metrics' => $this->cacheMetrics,
        ];
    }
}
