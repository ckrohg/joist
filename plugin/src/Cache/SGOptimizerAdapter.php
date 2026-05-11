<?php
declare(strict_types=1);

namespace Joist\Cache;

final class SGOptimizerAdapter implements CacheAdapterInterface
{
    public function name(): string { return 'sg-optimizer'; }

    public function detect(): bool
    {
        return function_exists('sg_cachepress_purge_cache') || class_exists('\SiteGround_Optimizer\Supercacher\Supercacher');
    }

    public function flushPage(int $postId): void
    {
        if (function_exists('sg_cachepress_purge_cache')) {
            $url = get_permalink($postId);
            if ($url) {
                @sg_cachepress_purge_cache($url);
            }
        }
        if (class_exists('\SiteGround_Optimizer\Supercacher\Supercacher')) {
            $url = get_permalink($postId);
            if ($url) {
                @\SiteGround_Optimizer\Supercacher\Supercacher::purge_cache_request($url);
            }
        }
    }

    public function flushSite(): void
    {
        if (function_exists('sg_cachepress_purge_cache')) {
            @sg_cachepress_purge_cache();
        }
    }
}
