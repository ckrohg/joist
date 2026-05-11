<?php
declare(strict_types=1);

namespace Joist\Cache;

final class WPRocketAdapter implements CacheAdapterInterface
{
    public function name(): string { return 'wp-rocket'; }

    public function detect(): bool
    {
        return defined('WP_ROCKET_VERSION');
    }

    public function flushPage(int $postId): void
    {
        if (function_exists('rocket_clean_post')) {
            rocket_clean_post($postId);
        }
    }

    public function flushSite(): void
    {
        if (function_exists('rocket_clean_domain')) {
            rocket_clean_domain();
        }
    }
}
