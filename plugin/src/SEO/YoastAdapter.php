<?php
declare(strict_types=1);

namespace Joist\SEO;

final class YoastAdapter implements SEOAdapterInterface
{
    public function name(): string { return 'yoast'; }
    public function detect(): bool { return defined('WPSEO_VERSION'); }

    public function read(int $postId): array
    {
        return [
            'meta_title' => get_post_meta($postId, '_yoast_wpseo_title', true) ?: null,
            'meta_description' => get_post_meta($postId, '_yoast_wpseo_metadesc', true) ?: null,
            'og_image_id' => (int) get_post_meta($postId, '_yoast_wpseo_opengraph-image-id', true) ?: null,
            'noindex' => get_post_meta($postId, '_yoast_wpseo_meta-robots-noindex', true) === '1',
        ];
    }

    public function write(int $postId, array $seo): void
    {
        if (isset($seo['meta_title'])) update_post_meta($postId, '_yoast_wpseo_title', sanitize_text_field($seo['meta_title']));
        if (isset($seo['meta_description'])) update_post_meta($postId, '_yoast_wpseo_metadesc', sanitize_text_field($seo['meta_description']));
        if (isset($seo['og_image_id'])) {
            $id = (int) $seo['og_image_id'];
            update_post_meta($postId, '_yoast_wpseo_opengraph-image-id', $id);
            $url = wp_get_attachment_url($id);
            if ($url) update_post_meta($postId, '_yoast_wpseo_opengraph-image', $url);
        }
        if (isset($seo['noindex'])) update_post_meta($postId, '_yoast_wpseo_meta-robots-noindex', $seo['noindex'] ? '1' : '0');
    }
}
