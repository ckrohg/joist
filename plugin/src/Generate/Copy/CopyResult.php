<?php
declare(strict_types=1);

namespace Joist\Generate\Copy;

/**
 * @purpose Return-shape from CopyGenerator::generate(). Covers four states:
 *   - 'ok'           — text generated and (optionally) passed validation
 *   - 'unconfigured' — no JOIST_CLAUDE_API_KEY in env or wp_options; dark-test path
 *   - 'cost_capped'  — would exceed joist_copy_gen_cap_usd; refused (constraint #9)
 *   - 'provider_error' — wp_remote_post failed or Anthropic returned non-2xx
 *
 * The validation_failed flag is orthogonal to status: status == 'ok' AND
 * validation_failed == true means we got text back but the validator (W6a)
 * rejected both the first draft and the repair retry. Caller should route
 * such results to the human-review queue (constraint #16: refuse silently
 * failing operations — surface, don't bury).
 */
final class CopyResult
{
    public const STATUS_OK = 'ok';
    public const STATUS_UNCONFIGURED = 'unconfigured';
    public const STATUS_COST_CAPPED = 'cost_capped';
    public const STATUS_PROVIDER_ERROR = 'provider_error';

    /**
     * @param string $status
     * @param string $text
     * @param array{input_tokens:int,cache_creation_tokens:int,cache_read_tokens:int,output_tokens:int} $cacheMetrics
     * @param float $costUsd
     * @param int $latencyMs
     * @param string $generationId Anthropic msg_... id, or "" when status != 'ok'
     * @param bool $validationFailed True when validator rejected both draft and repair
     * @param string|null $reason Human-readable explainer (set when status != 'ok')
     * @param string|null $errorCode Typed error code (set when status != 'ok')
     * @param int|null $repairAttempts Number of repair retries actually performed
     */
    public function __construct(
        public readonly string $status,
        public readonly string $text,
        public readonly array $cacheMetrics,
        public readonly float $costUsd,
        public readonly int $latencyMs,
        public readonly string $generationId,
        public readonly bool $validationFailed = false,
        public readonly ?string $reason = null,
        public readonly ?string $errorCode = null,
        public readonly ?int $repairAttempts = 0,
    ) {}

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        $out = [
            'status' => $this->status,
            'text' => $this->text,
            'cache_metrics' => $this->cacheMetrics,
            'cost_usd' => round($this->costUsd, 6),
            'latency_ms' => $this->latencyMs,
            'generation_id' => $this->generationId,
            'validation_failed' => $this->validationFailed,
            'repair_attempts' => (int) ($this->repairAttempts ?? 0),
        ];
        if ($this->reason !== null) {
            $out['reason'] = $this->reason;
        }
        if ($this->errorCode !== null) {
            $out['error_code'] = $this->errorCode;
        }
        // Surface cache-hit rate for diagnostic UIs.
        $totalInput = (int) ($this->cacheMetrics['input_tokens']
            + $this->cacheMetrics['cache_creation_tokens']
            + $this->cacheMetrics['cache_read_tokens']);
        $out['cache_hit_rate'] = $totalInput > 0
            ? round($this->cacheMetrics['cache_read_tokens'] / $totalInput, 4)
            : 0.0;
        return $out;
    }

    public static function unconfigured(string $reason): self
    {
        return new self(
            status: self::STATUS_UNCONFIGURED,
            text: '',
            cacheMetrics: ['input_tokens' => 0, 'cache_creation_tokens' => 0, 'cache_read_tokens' => 0, 'output_tokens' => 0],
            costUsd: 0.0,
            latencyMs: 0,
            generationId: '',
            reason: $reason,
            errorCode: 'provider_unconfigured',
        );
    }

    public static function costCapped(string $reason, float $sessionTotalUsd, float $capUsd): self
    {
        return new self(
            status: self::STATUS_COST_CAPPED,
            text: '',
            cacheMetrics: ['input_tokens' => 0, 'cache_creation_tokens' => 0, 'cache_read_tokens' => 0, 'output_tokens' => 0],
            costUsd: 0.0,
            latencyMs: 0,
            generationId: '',
            reason: $reason . " (session total: \${$sessionTotalUsd}, cap: \${$capUsd})",
            errorCode: 'cost_cap_exceeded',
        );
    }

    public static function providerError(string $reason, int $latencyMs = 0): self
    {
        return new self(
            status: self::STATUS_PROVIDER_ERROR,
            text: '',
            cacheMetrics: ['input_tokens' => 0, 'cache_creation_tokens' => 0, 'cache_read_tokens' => 0, 'output_tokens' => 0],
            costUsd: 0.0,
            latencyMs: $latencyMs,
            generationId: '',
            reason: $reason,
            errorCode: 'provider_error',
        );
    }
}
