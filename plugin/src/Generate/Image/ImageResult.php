<?php
declare(strict_types=1);

namespace Joist\Generate\Image;

/**
 * @purpose Value object returned by every image-provider generate() call.
 *
 * Shape is provider-agnostic — callers (AssetRouter, GenerateController)
 * never branch on provider when reading a successful result. Provider
 * identifier is preserved for cost-meter attribution and debugging.
 *
 * The `status` field carries one of:
 *   - 'ok'              normal success path
 *   - 'unconfigured'    dark-test path; API key not set, no call was made
 *   - 'error'           upstream error preserved for the caller
 *
 * Unconfigured + error results MUST still surface up to the REST layer as
 * typed errors, not silent downgrades (failure-mode constraint #16).
 */
final class ImageResult
{
    /**
     * @param array<string,mixed> $meta Provider-specific extras kept for audit.
     */
    public function __construct(
        public readonly string $status,
        public readonly string $provider,
        public readonly ?string $imageUrl,
        public readonly ?string $generationId,
        public readonly float $costUsd,
        public readonly int $latencyMs,
        public readonly array $meta = [],
        public readonly ?string $errorCode = null,
        public readonly ?string $errorMessage = null,
    ) {}

    /** Convenience constructor for the dark-test "no API key set" path. */
    public static function unconfigured(string $provider, string $envVar): self
    {
        return new self(
            status: 'unconfigured',
            provider: $provider,
            imageUrl: null,
            generationId: null,
            costUsd: 0.0,
            latencyMs: 0,
            meta: ['env_var' => $envVar],
            errorCode: 'provider_unconfigured',
            errorMessage: "Provider {$provider} has no API key configured. Set the {$envVar} env var or matching wp_option.",
        );
    }

    /** @return array<string,mixed> */
    public function toApi(): array
    {
        return [
            'status' => $this->status,
            'provider' => $this->provider,
            'image_url' => $this->imageUrl,
            'generation_id' => $this->generationId,
            'cost_usd' => $this->costUsd,
            'latency_ms' => $this->latencyMs,
            'meta' => $this->meta,
            'error_code' => $this->errorCode,
            'error_message' => $this->errorMessage,
        ];
    }
}
