<?php
declare(strict_types=1);

namespace Joist\Security;

use Joist\Elementor\WriteException;

/**
 * Token-bucket rate limiter (spec §26).
 *
 * Per-session, per-bucket. Defaults configurable via joist_rate_limits option.
 * Buckets are persisted in wp_joist_rate_limits (custom table to avoid
 * wp_options autoload bloat).
 *
 * Refilled lazily on each check based on elapsed time × refill rate.
 */
final class RateLimiter
{
    /** @var array<string, array{rate:int, burst:int}> Bucket class → tokens/min + max. */
    private array $config;

    public function __construct()
    {
        $defaults = [
            'writes' => ['rate' => 30, 'burst' => 10],
            'reads' => ['rate' => 300, 'burst' => 50],
            'plugin_install' => ['rate' => 5, 'burst' => 2],
            'webhook_emit' => ['rate' => 100, 'burst' => 20],
        ];
        $configured = get_option('joist_rate_limits', []);
        $this->config = is_array($configured) ? array_replace_recursive($defaults, $configured) : $defaults;
    }

    /**
     * Consume one token from the bucket. Throws 429 if exhausted.
     */
    public function consume(string $sessionId, string $bucketClass): void
    {
        if (!isset($this->config[$bucketClass])) {
            return; // Unknown bucket = unlimited (fail open in dev; admin can configure).
        }

        global $wpdb;
        $table = $wpdb->prefix . 'joist_rate_limits';
        $now = time();
        $config = $this->config[$bucketClass];

        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT tokens, UNIX_TIMESTAMP(last_refill) AS refill_ts FROM {$table} WHERE session_id = %s AND bucket_class = %s",
                $sessionId,
                $bucketClass
            ),
            ARRAY_A
        );

        if ($row === null) {
            $tokens = (int) $config['burst'];
            $wpdb->insert($table, [
                'session_id' => $sessionId,
                'bucket_class' => $bucketClass,
                'tokens' => max(0, $tokens - 1),
                'last_refill' => date('Y-m-d H:i:s', $now),
            ]);
            return;
        }

        // Refill: rate is tokens/minute.
        $elapsed = max(0, $now - (int) $row['refill_ts']);
        $refill = (int) floor($elapsed * ((int) $config['rate'] / 60));
        $tokens = min((int) $config['burst'], (int) $row['tokens'] + $refill);

        if ($tokens <= 0) {
            $retryAfter = (int) ceil(60 / max(1, (int) $config['rate']));
            throw new WriteException(
                'rate_limit.' . $bucketClass,
                "Rate limit exceeded for {$bucketClass}. Retry in {$retryAfter}s.",
                429,
                ['retry_after' => $retryAfter, 'bucket_class' => $bucketClass]
            );
        }

        $wpdb->update(
            $table,
            [
                'tokens' => $tokens - 1,
                'last_refill' => date('Y-m-d H:i:s', $now),
            ],
            ['session_id' => $sessionId, 'bucket_class' => $bucketClass]
        );
    }

    /** Prune rows older than 24h. Called from daily cron. */
    public static function prune(): void
    {
        global $wpdb;
        $table = $wpdb->prefix . 'joist_rate_limits';
        $cutoff = date('Y-m-d H:i:s', time() - 86400);
        $wpdb->query($wpdb->prepare("DELETE FROM {$table} WHERE last_refill < %s", $cutoff));
    }
}
