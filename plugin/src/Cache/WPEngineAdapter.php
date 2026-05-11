<?php
declare(strict_types=1);

namespace Joist\Cache;

final class WPEngineAdapter implements CacheAdapterInterface
{
    public function name(): string { return 'wpengine-native'; }

    public function detect(): bool
    {
        return class_exists('\WpeCommon');
    }

    public function flushPage(int $postId): void
    {
        if (class_exists('\WpeCommon') && method_exists('\WpeCommon', 'purge_varnish_cache_post')) {
            @\WpeCommon::purge_varnish_cache_post($postId);
        }
    }

    public function flushSite(): void
    {
        if (class_exists('\WpeCommon')) {
            if (method_exists('\WpeCommon', 'purge_varnish_cache')) {
                @\WpeCommon::purge_varnish_cache();
            }
            if (method_exists('\WpeCommon', 'purge_memcached')) {
                @\WpeCommon::purge_memcached();
            }
        }
    }
}
