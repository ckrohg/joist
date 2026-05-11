<?php
declare(strict_types=1);

namespace Joist\Elementor;

/**
 * Thrown by SchemaValidator. The REST layer turns this into 422 + the
 * spec's error envelope with recovery_suggestions[].
 */
final class InvalidSettingsException extends \RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly array $errorDetails = [],
    ) {
        parent::__construct($message);
    }
}
