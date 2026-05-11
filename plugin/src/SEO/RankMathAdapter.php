<?php
declare(strict_types=1);

namespace Joist\SEO;

final class RankMathAdapter implements SEOAdapterInterface
{
    public function name(): string { return 'rankmath'; }
    public function detect(): bool { return defined('RANK_MATH_VERSION') || class_exists('RankMath'); }

    public function read(int $postId): array
    {
        return [
            'meta_title' => get_post_meta($postId, 'rank_math_title', true) ?: null,
            'meta_description' => get_post_meta($postId, 'rank_math_description', true) ?: null,
            'og_image_id' => (int) get_post_meta($postId, 'rank_math_facebook_image_id', true) ?: null,
            'noindex' => in_array('noindex', (array) get_post_meta($postId, 'rank_math_robots', true), true),
        ];
    }

    public function write(int $postId, array $seo): void
    {
        if (isset($seo['meta_title'])) update_post_meta($postId, 'rank_math_title', sanitize_text_field($seo['meta_title']));
        if (isset($seo['meta_description'])) update_post_meta($postId, 'rank_math_description', sanitize_text_field($seo['meta_description']));
        if (isset($seo['og_image_id'])) {
            $id = (int) $seo['og_image_id'];
            update_post_meta($postId, 'rank_math_facebook_image_id', $id);
            $url = wp_get_attachment_url($id);
            if ($url) update_post_meta($postId, 'rank_math_facebook_image', $url);
        }
        if (isset($seo['noindex'])) {
            $robots = (array) get_post_meta($postId, 'rank_math_robots', true);
            $robots = array_values(array_diff($robots, ['index', 'noindex']));
            $robots[] = $seo['noindex'] ? 'noindex' : 'index';
            update_post_meta($postId, 'rank_math_robots', $robots);
        }
    }
}
