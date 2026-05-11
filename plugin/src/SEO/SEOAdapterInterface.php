<?php
declare(strict_types=1);

namespace Joist\SEO;

interface SEOAdapterInterface
{
    public function name(): string;
    public function detect(): bool;
    /** @return array{meta_title:?string, meta_description:?string, og_image_id:?int, noindex:bool} */
    public function read(int $postId): array;
    public function write(int $postId, array $seo): void;
}
