<?php
declare(strict_types=1);

namespace Joist\Generate\Image;

/**
 * @purpose Value object returned by HttpTransport.
 *
 * Carries everything a provider client needs to interpret the response:
 *   - integer status code
 *   - the raw header bag (whatever wp_remote_retrieve_headers returned)
 *   - the raw body string (kept for debugging / non-JSON paths)
 *   - the decoded JSON array (null when body was empty or non-JSON in
 *     non-strict mode)
 *   - duration_ms for telemetry / cost-per-second tracking
 *
 * Intentionally immutable / readonly — no setters. Clients build their
 * domain types (ImageResult, TrainingJob) from this.
 */
final class HttpResponse
{
    public function __construct(
        public readonly int $status,
        public readonly array $headers,
        public readonly string $body,
        public readonly ?array $json,
        public readonly int $durationMs,
    ) {}

    public function isOk(): bool
    {
        return $this->status >= 200 && $this->status < 300;
    }
}
