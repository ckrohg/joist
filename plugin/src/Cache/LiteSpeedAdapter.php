<?php
declare(strict_types=1);

namespace Joist\Cache;

final class LiteSpeedAdapter implements CacheAdapterInterface
{
    public function name(): string { return 'litespeed-cache'; }

    public function detect(): bool
    {
        return defined('LSCWP_V') || class_exists('\LiteSpeed\Cache');
    }

    public function flushPage(int $postId): void
    {
        do_action('litespeed_purge_post', $postId);
    }

    public function flushSite(): void
    {
        do_action('litespeed_purge_all');
    }
}
