<?php
declare(strict_types=1);

namespace Joist\Cache;

interface CacheAdapterInterface
{
    public function name(): string;
    public function detect(): bool;
    public function flushPage(int $postId): void;
    public function flushSite(): void;
}
