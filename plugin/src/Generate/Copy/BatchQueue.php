<?php
declare(strict_types=1);

namespace Joist\Generate\Copy;

use Joist\Core\Logger;

/**
 * @purpose Tight batching of copy-generation requests to amortise the 5-min
 *          prompt-cache TTL. Same BrandBlock prefix is sent for every
 *          flush()'d request, so the FIRST call pays the cache-write
 *          (1.25x base input) and all subsequent calls within ~5 min pay
 *          the cache-read multiplier (0.1x base) — a 12.5x improvement
 *          per amortised request.
 *
 * Persistence: WordPress transient keyed by site_id. Transient TTL is
 * deliberately conservative (15 min) — far longer than the cache TTL,
 * but short enough that stale items don't pile up if a flush is never
 * called. flushAfter() schedules the flush via wp_schedule_single_event
 * so callers can enqueue, return immediately, and let WP-cron run the
 * batch on the configured delay.
 *
 * See specs/COPY_GEN.md §4 "Batch queue + 5-min TTL strategy".
 */
final class BatchQueue
{
    public const TRANSIENT_PREFIX = 'joist_copygen_queue_';
    public const TRANSIENT_TTL = 900; // 15 min
    public const CRON_HOOK = 'joist_copy_gen_flush';

    public function __construct(
        private CopyGenerator $generator,
    ) {}

    /**
     * Add a request to the per-site queue. Returns a request_id (caller-supplied
     * or auto-generated) so subsequent status checks can correlate.
     *
     * @param array{request:string,request_id?:string,opts?:array<string,mixed>} ...$_
     */
    public function enqueue(string $siteId, string $request, ?string $requestId = null, array $opts = []): string
    {
        $rid = $requestId !== null && $requestId !== '' ? $requestId : $this->genId();
        $queue = $this->loadQueue($siteId);
        $queue[] = [
            'request_id' => $rid,
            'request' => $request,
            'opts' => $opts,
            'enqueued_at' => time(),
        ];
        $this->saveQueue($siteId, $queue);
        return $rid;
    }

    public function depth(string $siteId): int
    {
        return count($this->loadQueue($siteId));
    }

    /**
     * Drain the queue and run every request in a tight loop. The BrandBlock
     * is assembled ONCE (so the cache prefix is bit-identical across calls
     * and the 5-min TTL window is exploited maximally).
     *
     * @param array<string,mixed> $sharedOpts Applied to every request unless overridden.
     * @return array{flushed:int,results:list<array<string,mixed>>}
     */
    public function flush(string $siteId, array $sharedOpts = []): array
    {
        $queue = $this->loadQueue($siteId);
        if (count($queue) === 0) {
            return ['flushed' => 0, 'results' => []];
        }

        // Clear the queue UP FRONT so a concurrent enqueue doesn't get
        // re-flushed. Anything that lands while the loop runs ends up in
        // the next batch.
        $this->saveQueue($siteId, []);

        // Resolve the model + assemble the BrandBlock ONCE per flush so the
        // cache_control breakpoint is bit-identical across every call in the
        // batch (the whole point of the queue — see specs/COPY_GEN.md §3).
        $model = (string) ($sharedOpts['model'] ?? $this->generator->resolveModel());
        /** @var BrandBlockAssembler $assembler */
        $assembler = \Joist\Container::get('brandBlockAssembler');
        $brandBlock = $assembler->assemble($siteId, $model);

        $results = [];
        foreach ($queue as $item) {
            $opts = array_merge($sharedOpts, (array) ($item['opts'] ?? []));
            $opts['brand_block'] = $brandBlock;
            $opts['model'] = $model;

            try {
                $r = $this->generator->generate($siteId, (string) $item['request'], $opts);
                $resultArr = $r->toArray();
                $resultArr['request_id'] = (string) $item['request_id'];
                $results[] = $resultArr;
            } catch (\Throwable $e) {
                Logger::warn('joist.copy.batch_item_error', [
                    'site_id' => $siteId,
                    'request_id' => (string) $item['request_id'],
                    'error' => $e->getMessage(),
                ]);
                $results[] = [
                    'request_id' => (string) $item['request_id'],
                    'status' => CopyResult::STATUS_PROVIDER_ERROR,
                    'error_code' => 'batch_item_error',
                    'reason' => $e->getMessage(),
                ];
            }
        }

        return ['flushed' => count($results), 'results' => $results];
    }

    /**
     * Schedule a flush() via WP-cron after $delaySeconds. Allows callers to
     * enqueue several items in quick succession (without each one round-
     * tripping to the model) and let the cron run the batch.
     *
     * NOTE: WP-cron is request-driven, so on low-traffic sites the actual
     * flush may run AFTER the requested delay. The 5-min cache TTL still
     * applies — schedule no later than ~3 min after the first enqueue to
     * benefit from caching.
     */
    public function flushAfter(string $siteId, int $delaySeconds): void
    {
        if (!function_exists('wp_schedule_single_event')) {
            return;
        }
        $when = time() + max(0, $delaySeconds);
        // Avoid scheduling duplicates within the same minute.
        if (!wp_next_scheduled(self::CRON_HOOK, [$siteId])) {
            wp_schedule_single_event($when, self::CRON_HOOK, [$siteId]);
        }
    }

    /**
     * Static cron callback. Bootstrap registers add_action(self::CRON_HOOK, ...).
     */
    public static function runScheduled(string $siteId): void
    {
        try {
            /** @var BatchQueue $queue */
            $queue = \Joist\Container::get('copyBatchQueue');
            $queue->flush($siteId);
        } catch (\Throwable $e) {
            Logger::warn('joist.copy.cron_flush_failed', [
                'site_id' => $siteId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /** @return list<array<string,mixed>> */
    private function loadQueue(string $siteId): array
    {
        if (!function_exists('get_transient')) {
            return [];
        }
        $stored = get_transient(self::TRANSIENT_PREFIX . $this->safeSiteKey($siteId));
        if (!is_array($stored)) {
            return [];
        }
        return array_values($stored);
    }

    private function saveQueue(string $siteId, array $queue): void
    {
        if (!function_exists('set_transient')) {
            return;
        }
        $key = self::TRANSIENT_PREFIX . $this->safeSiteKey($siteId);
        if (count($queue) === 0) {
            if (function_exists('delete_transient')) {
                delete_transient($key);
            }
            return;
        }
        set_transient($key, array_values($queue), self::TRANSIENT_TTL);
    }

    private function safeSiteKey(string $siteId): string
    {
        return preg_replace('/[^a-zA-Z0-9_.-]/', '_', $siteId) ?? 'unknown';
    }

    private function genId(): string
    {
        if (function_exists('wp_generate_uuid4')) {
            return wp_generate_uuid4();
        }
        return bin2hex(random_bytes(8));
    }
}
