<?php
declare(strict_types=1);

namespace Joist\Generate\Copy;

/**
 * @purpose Per-session running cost meter for copy generation, gated by
 *          `joist_copy_gen_cap_usd` (default $5/session). Implements
 *          failure-mode constraint #9 (cost meter + per-task spending cap).
 *
 * SEPARATE from image-gen cost meter by design: copy cost dynamics differ
 * dramatically (cached input ~$0.50/MTok, cache-write ~$6.25/MTok, output
 * $25/MTok for Opus 4.7), so combining the buckets would obscure which
 * vertical is burning budget. Image gen runs $0.025–$0.08/image with very
 * different incident profile (a runaway loop costs orders of magnitude
 * more in copy than in image gen at equal call count). See
 * specs/COPY_GEN.md §5 "Cost meter — why separate from image gen".
 *
 * Storage: WordPress transient keyed by session_id, 60 min TTL (long enough
 * to span a single agent build run; short enough that abandoned sessions
 * don't pin storage). Falls back to in-memory static when no session_id is
 * available (CLI / unit tests).
 */
final class CopyCostMeter
{
    public const DEFAULT_CAP_USD = 5.0;
    public const TRANSIENT_PREFIX = 'joist_copygen_cost_';
    public const TRANSIENT_TTL = 3600; // 60 min

    /** In-memory fallback when no session_id is available. */
    private static array $memorySessions = [];

    public function capUsd(): float
    {
        if (!function_exists('get_option')) {
            return self::DEFAULT_CAP_USD;
        }
        $cap = get_option('joist_copy_gen_cap_usd', self::DEFAULT_CAP_USD);
        return is_numeric($cap) ? (float) $cap : self::DEFAULT_CAP_USD;
    }

    public function sessionTotal(string $sessionId): float
    {
        if ($sessionId === '') {
            return (float) (self::$memorySessions['_anon'] ?? 0.0);
        }
        if (function_exists('get_transient')) {
            $val = get_transient(self::TRANSIENT_PREFIX . $sessionId);
            return is_numeric($val) ? (float) $val : 0.0;
        }
        return (float) (self::$memorySessions[$sessionId] ?? 0.0);
    }

    public function remaining(string $sessionId): float
    {
        return max(0.0, $this->capUsd() - $this->sessionTotal($sessionId));
    }

    /**
     * Pre-flight check: would this projected cost push the session over the
     * cap? Returns true when the call should be REFUSED.
     */
    public function wouldExceed(string $sessionId, float $projectedUsd): bool
    {
        return ($this->sessionTotal($sessionId) + $projectedUsd) > $this->capUsd();
    }

    /**
     * Record actual spend after a successful API call.
     */
    public function record(string $sessionId, float $costUsd): void
    {
        if ($costUsd <= 0) return;
        $key = $sessionId !== '' ? $sessionId : '_anon';
        $current = $this->sessionTotal($sessionId);
        $next = $current + $costUsd;
        if ($sessionId !== '' && function_exists('set_transient')) {
            set_transient(self::TRANSIENT_PREFIX . $sessionId, $next, self::TRANSIENT_TTL);
        }
        self::$memorySessions[$key] = $next;
    }

    /** Reset a session's meter (admin-only — used by /cost-meter DELETE). */
    public function reset(string $sessionId): void
    {
        if ($sessionId !== '' && function_exists('delete_transient')) {
            delete_transient(self::TRANSIENT_PREFIX . $sessionId);
        }
        $key = $sessionId !== '' ? $sessionId : '_anon';
        unset(self::$memorySessions[$key]);
    }

    /** @return array<string,mixed> */
    public function snapshot(string $sessionId): array
    {
        $total = $this->sessionTotal($sessionId);
        $cap = $this->capUsd();
        return [
            'session_id' => $sessionId,
            'session_total_usd' => round($total, 6),
            'cap_usd' => round($cap, 6),
            'remaining_usd' => round(max(0.0, $cap - $total), 6),
            'separated_from_image_gen' => true,
        ];
    }
}
