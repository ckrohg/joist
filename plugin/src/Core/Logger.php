<?php
declare(strict_types=1);

namespace Joist\Core;

/**
 * PSR-3-style logger with mandatory redact() chokepoint.
 *
 * Every log call runs through redact() which strips App Passwords,
 * Anthropic/OpenAI API keys, HMAC secrets, OAuth tokens by pattern match.
 *
 * Writes to wp_upload_dir() . '/joist-logs/' (with .htaccess deny rule)
 * + rolling buffer in wp_options (last 200 entries) for fast admin UI.
 */
final class Logger
{
    public const LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical'];

    public static function info(string $message, array $context = []): void
    {
        self::log('info', $message, $context);
    }
    public static function warn(string $message, array $context = []): void
    {
        self::log('warning', $message, $context);
    }
    public static function error(string $message, array $context = []): void
    {
        self::log('error', $message, $context);
    }
    public static function debug(string $message, array $context = []): void
    {
        if (!(defined('WP_DEBUG') && WP_DEBUG)) return;
        self::log('debug', $message, $context);
    }

    private static function log(string $level, string $message, array $context): void
    {
        $entry = [
            'ts' => date('c'),
            'lv' => $level,
            'msg' => self::redact($message),
            'ctx' => self::redact($context),
        ];

        // File output.
        $dir = trailingslashit(wp_upload_dir()['basedir']) . 'joist-logs';
        if (!is_dir($dir)) {
            @mkdir($dir, 0750, true);
            @file_put_contents($dir . '/.htaccess', "Order Deny,Allow\nDeny from all\n");
            @file_put_contents($dir . '/index.html', '<!-- silence -->');
        }
        $logFile = $dir . '/joist-' . date('Y-m-d') . '.log';
        @file_put_contents($logFile, wp_json_encode($entry) . "\n", FILE_APPEND);

        // Rolling buffer in options for fast admin UI access.
        $buffer = get_option('joist_log_buffer', []);
        if (!is_array($buffer)) $buffer = [];
        $buffer[] = $entry;
        if (count($buffer) > 200) {
            $buffer = array_slice($buffer, -200);
        }
        update_option('joist_log_buffer', $buffer, false);
    }

    /**
     * Strip secrets from strings and arrays.
     *
     * @param mixed $input
     * @return mixed
     */
    public static function redact($input)
    {
        if (is_string($input)) {
            return self::redactString($input);
        }
        if (is_array($input)) {
            $out = [];
            foreach ($input as $key => $value) {
                $keyLower = strtolower((string) $key);
                if (in_array($keyLower, ['secret', 'password', 'app_password', 'api_key', 'apikey', 'token', 'authorization'], true)) {
                    $out[$key] = '[REDACTED]';
                    continue;
                }
                $out[$key] = self::redact($value);
            }
            return $out;
        }
        return $input;
    }

    private static function redactString(string $s): string
    {
        // Anthropic / OpenAI API keys (sk-ant-..., sk-...)
        $s = preg_replace('/sk-ant-[a-zA-Z0-9_-]{20,}/', 'sk-ant-[REDACTED]', $s) ?? $s;
        $s = preg_replace('/sk-[a-zA-Z0-9]{20,}/', 'sk-[REDACTED]', $s) ?? $s;
        // WP Application Passwords (24 chars in 4-char chunks separated by spaces)
        $s = preg_replace('/\b[a-zA-Z0-9]{4}( [a-zA-Z0-9]{4}){5}\b/', '[APP_PWD_REDACTED]', $s) ?? $s;
        // Bearer tokens
        $s = preg_replace('/Bearer [a-zA-Z0-9_.\-]{20,}/', 'Bearer [REDACTED]', $s) ?? $s;
        return $s;
    }
}
