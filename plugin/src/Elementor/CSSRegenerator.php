<?php
declare(strict_types=1);

namespace Joist\Elementor;

use Joist\Core\Logger;

/**
 * CSS regeneration wrapper (constraint #5).
 *
 * Full file list per Elementor specialist critique:
 *   - Post CSS (per-page)
 *   - Global CSS (kit-wide)
 *   - Custom CSS (kit additional)
 *   - Manager flush (clears file cache)
 *   - _elementor_element_cache postmeta
 *   - _elementor_inline_svg postmeta
 */
final class CSSRegenerator
{
    public function regenerate(int $postId): void
    {
        $this->regenPost($postId);
        $this->clearElementCache($postId);
    }

    public function regenAll(): void
    {
        $this->regenGlobal();
        $this->regenCustom();
        $this->flushManager();
    }

    public function regenPost(int $postId): void
    {
        try {
            if (class_exists('\Elementor\Core\Files\CSS\Post')) {
                \Elementor\Core\Files\CSS\Post::create($postId)->update();
            }
        } catch (\Throwable $e) {
            Logger::warn('CSS regen (post) failed', ['post_id' => $postId, 'error' => $e->getMessage()]);
        }
    }

    public function regenGlobal(): void
    {
        try {
            if (class_exists('\Elementor\Core\Files\CSS\Global_CSS')) {
                \Elementor\Core\Files\CSS\Global_CSS::create()->update();
            }
        } catch (\Throwable $e) {
            Logger::warn('CSS regen (global) failed', ['error' => $e->getMessage()]);
        }
    }

    public function regenCustom(): void
    {
        try {
            if (class_exists('\Elementor\Core\Files\CSS\Custom_CSS')) {
                \Elementor\Core\Files\CSS\Custom_CSS::create()->update();
            }
        } catch (\Throwable $e) {
            Logger::warn('CSS regen (custom) failed', ['error' => $e->getMessage()]);
        }
    }

    public function flushManager(): void
    {
        try {
            if (class_exists('\Elementor\Plugin')) {
                $manager = \Elementor\Plugin::$instance->files_manager ?? null;
                if (is_object($manager) && method_exists($manager, 'clear_cache')) {
                    $manager->clear_cache();
                }
            }
        } catch (\Throwable $e) {
            Logger::warn('CSS regen (manager flush) failed', ['error' => $e->getMessage()]);
        }
    }

    private function clearElementCache(int $postId): void
    {
        delete_post_meta($postId, '_elementor_element_cache');
        delete_post_meta($postId, '_elementor_inline_svg');
        delete_post_meta($postId, '_elementor_css');
    }
}
