<?php
declare(strict_types=1);

namespace Joist\Critique;

/**
 * @purpose Per-session running cost meter for critique calls.
 *
 * Separate from CopyCostMeter and image-gen meters by design: critique cost
 * dynamics differ — every call is vision (screenshot input) and most calls
 * use cache-read on the substrate prefix. Combining buckets would obscure
 * which vertical is burning budget when a runaway loop fires.
 *
 * Default cap: $5/session (configurable via `joist_critique_cap_usd`).
 * Storage: WordPress transient keyed by session_id, 60 min TTL (mirrors
 * CopyCostMeter). In-memory fallback when no session_id available.
 *
 * Implements failure-mode constraint #9 (cost meter + per-task spending cap)
 * scoped to the critique loop.
 */
final class CritiqueCostMeter
{
    public const DEFAULT_CAP_USD = 5.0;
    public const TRANSIENT_PREFIX = 'joist_critique_cost_';
    public const TRANSIENT_TTL = 3600; // 60 min

    /** In-memory fallback when no session_id is available. */
    private static array $memorySessions = [];

    public function capUsd(): float
    {
        if (!function_exists('get_option')) {
            return self::DEFAULT_CAP_USD;
        }
        $cap = get_option('joist_critique_cap_usd', self::DEFAULT_CAP_USD);
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
     * Pre-flight: would this projected cost push the session over the cap?
     * Returns true when the call should be REFUSED.
     */
    public function wouldExceed(string $sessionId, float $projectedUsd): bool
    {
        return ($this->sessionTotal($sessionId) + $projectedUsd) > $this->capUsd();
    }

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
            'separated_from_copy_and_image_gen' => true,
        ];
    }
}
