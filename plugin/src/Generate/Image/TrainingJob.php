<?php
declare(strict_types=1);

namespace Joist\Generate\Image;

/**
 * @purpose Value object describing a fal.ai LoRA training job.
 *
 * Lifecycle: `submitted` (queue accepted) -> `running` -> `completed` |
 * `failed`. We also surface `unconfigured` (dark-test branch, no API key
 * available — no upstream call was made) so the caller can format a
 * deterministic 422.
 *
 * loraId is only populated when status === 'completed'; it's the value
 * that gets persisted to PreferenceMemory under the `lora_id` directive
 * for the current site_id, so future generate() calls can refer to it.
 *
 * costUsd is the *final* cost when terminal; before that, fal.ai exposes
 * a per-job estimate via the queue/result envelope (kept in `meta`).
 */
final class TrainingJob
{
    public const STATUS_SUBMITTED = 'submitted';
    public const STATUS_RUNNING = 'running';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_FAILED = 'failed';
    public const STATUS_UNCONFIGURED = 'unconfigured';

    /**
     * @param array<string,mixed> $meta
     */
    public function __construct(
        public readonly string $status,
        public readonly ?string $jobId,
        public readonly ?string $loraId,
        public readonly ?int $etaSeconds,
        public readonly float $costUsd,
        public readonly array $meta = [],
        public readonly ?string $errorCode = null,
        public readonly ?string $errorMessage = null,
    ) {}

    public static function unconfigured(string $envVar): self
    {
        return new self(
            status: self::STATUS_UNCONFIGURED,
            jobId: null,
            loraId: null,
            etaSeconds: null,
            costUsd: 0.0,
            meta: ['env_var' => $envVar],
            errorCode: 'provider_unconfigured',
            errorMessage: "fal.ai has no API key configured. Set the {$envVar} env var or joist_fal_api_key wp_option.",
        );
    }

    public function isTerminal(): bool
    {
        return in_array($this->status, [self::STATUS_COMPLETED, self::STATUS_FAILED, self::STATUS_UNCONFIGURED], true);
    }

    /** @return array<string,mixed> */
    public function toApi(): array
    {
        return [
            'status' => $this->status,
            'job_id' => $this->jobId,
            'lora_id' => $this->loraId,
            'eta_seconds' => $this->etaSeconds,
            'cost_usd' => $this->costUsd,
            'meta' => $this->meta,
            'error_code' => $this->errorCode,
            'error_message' => $this->errorMessage,
        ];
    }
}
