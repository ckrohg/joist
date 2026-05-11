<?php
declare(strict_types=1);

namespace Joist\SEO;

/** Joist's own meta keys when no SEO plugin is present. */
final class NativeAdapter implements SEOAdapterInterface
{
    public function name(): string { return 'native'; }
    public function detect(): bool { return true; }

    public function read(int $postId): array
    {
        return [
            'meta_title' => get_post_meta($postId, '_joist_meta_title', true) ?: null,
            'meta_description' => get_post_meta($postId, '_joist_meta_description', true) ?: null,
            'og_image_id' => (int) get_post_meta($postId, '_joist_og_image_id', true) ?: null,
            'noindex' => (bool) get_post_meta($postId, '_joist_noindex', true),
        ];
    }

    public function write(int $postId, array $seo): void
    {
        if (isset($seo['meta_title'])) update_post_meta($postId, '_joist_meta_title', sanitize_text_field($seo['meta_title']));
        if (isset($seo['meta_description'])) update_post_meta($postId, '_joist_meta_description', sanitize_text_field($seo['meta_description']));
        if (isset($seo['og_image_id'])) update_post_meta($postId, '_joist_og_image_id', (int) $seo['og_image_id']);
        if (isset($seo['noindex'])) update_post_meta($postId, '_joist_noindex', (bool) $seo['noindex']);
    }
}
