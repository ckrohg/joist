<?php
declare(strict_types=1);

namespace Joist\Cache;

use Joist\Core\Logger;

/**
 * Orchestrates cache flushing across detected adapters.
 * Detects host-level (SG Optimizer, WPE native) + plugin-level
 * (WP Rocket, LiteSpeed) and CDN-level (Cloudflare) caches.
 */
final class CacheFlusher
{
    /** @var list<CacheAdapterInterface> */
    private array $adapters;

    public function __construct(?array $adapters = null)
    {
        $this->adapters = $adapters ?? $this->detectAll();
    }

    public function flushPage(int $postId): void
    {
        foreach ($this->adapters as $adapter) {
            try {
                $adapter->flushPage($postId);
            } catch (\Throwable $e) {
                Logger::warn('cache adapter flushPage failed', [
                    'adapter' => $adapter::class,
                    'post_id' => $postId,
                    'error' => $e->getMessage(),
                ]);
            }
        }
        // Clear standard WP object cache for the post.
        clean_post_cache($postId);
    }

    public function flushSite(): void
    {
        foreach ($this->adapters as $adapter) {
            try {
                $adapter->flushSite();
            } catch (\Throwable $e) {
                Logger::warn('cache adapter flushSite failed', [
                    'adapter' => $adapter::class,
                    'error' => $e->getMessage(),
                ]);
            }
        }
        wp_cache_flush();
    }

    /** @return list<array{name:string, detected:bool}> */
    public function detectedAdapters(): array
    {
        $out = [];
        foreach ($this->adapters as $a) {
            $out[] = ['name' => $a->name(), 'detected' => true];
        }
        return $out;
    }

    /** @return list<CacheAdapterInterface> */
    private function detectAll(): array
    {
        $candidates = [
            new SGOptimizerAdapter(),
            new WPRocketAdapter(),
            new LiteSpeedAdapter(),
            new WPEngineAdapter(),
        ];
        return array_values(array_filter($candidates, fn($a) => $a->detect()));
    }
}
