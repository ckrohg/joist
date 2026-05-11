<?php
declare(strict_types=1);

namespace Joist\Elementor;

/**
 * Typed exception for write failures. The REST layer turns these into
 * the standard error envelope (see specs/PLUGIN_API.md §3).
 */
final class WriteException extends \RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $httpStatus,
        public readonly array $errorDetails = [],
    ) {
        parent::__construct($message);
    }
}
