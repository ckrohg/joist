<?php
declare(strict_types=1);

namespace Joist\Generate\Image;

/**
 * @purpose Typed exception for image-provider HTTP transport failures.
 *
 * Raised by HttpTransport on:
 *   - non-JSON response body in strict mode
 *   - 5xx upstream status
 *   - wp_remote_* WP_Error (network failure, timeout, DNS)
 *
 * The REST layer translates these into a 502/504 envelope; AssetRouter
 * surfaces them in the provider-error path. Never thrown from the
 * "unconfigured" dark-test branch — that returns a structured payload
 * instead so dark tests stay deterministic.
 */
final class TransportException extends \RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $upstreamStatus,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }
}
