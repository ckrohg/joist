<?php
declare(strict_types=1);

namespace Joist\SEO;

/**
 * All in One SEO (v4+) stores meta in a custom table, not postmeta.
 * v0.5 falls back to native meta keys; full AIOSEO v4 table integration is v0.7.
 */
final class AIOSEOAdapter implements SEOAdapterInterface
{
    public function name(): string { return 'aioseo'; }
    public function detect(): bool { return defined('AIOSEO_VERSION') || function_exists('aioseo'); }

    public function read(int $postId): array
    {
        if (function_exists('aioseo')) {
            $post = \aioseo()->meta?->metaData?->getMetaData($postId) ?? null;
            if ($post) {
                return [
                    'meta_title' => $post->title ?? null,
                    'meta_description' => $post->description ?? null,
                    'og_image_id' => null,
                    'noindex' => isset($post->robots_noindex) ? (bool) $post->robots_noindex : false,
                ];
            }
        }
        return ['meta_title' => null, 'meta_description' => null, 'og_image_id' => null, 'noindex' => false];
    }

    public function write(int $postId, array $seo): void
    {
        // AIOSEO v4 writes go through its own model; safest approach without
        // runtime testing is to use its filter hook if available.
        if (function_exists('aioseo')) {
            $aioseoPost = \aioseo()->meta?->metaData?->getMetaData($postId) ?? null;
            if ($aioseoPost) {
                if (isset($seo['meta_title'])) $aioseoPost->title = sanitize_text_field($seo['meta_title']);
                if (isset($seo['meta_description'])) $aioseoPost->description = sanitize_text_field($seo['meta_description']);
                if (isset($seo['noindex'])) $aioseoPost->robots_noindex = (bool) $seo['noindex'];
                if (method_exists($aioseoPost, 'save')) $aioseoPost->save();
                return;
            }
        }
        // Fallback to native keys.
        (new NativeAdapter())->write($postId, $seo);
    }
}
