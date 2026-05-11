<?php
declare(strict_types=1);

namespace Joist\CDN;

use Joist\Core\Logger;

/**
 * CDN purge orchestrator. v0.5 ships Cloudflare adapter only.
 *
 * Tokens stored in joist_cdn_config option, encrypted at rest with
 * libsodium symmetric encryption keyed off AUTH_KEY from wp-config.php.
 */
final class CDNFlusher
{
    public function purgePage(int $postId): void
    {
        $config = $this->loadConfig();
        if (!$config || empty($config['adapter'])) return;

        try {
            if ($config['adapter'] === 'cloudflare') {
                $token = $this->decrypt($config['token_encrypted'] ?? '');
                $zoneId = (string) ($config['zone_id'] ?? '');
                if ($token === null || $zoneId === '') return;

                $url = get_permalink($postId);
                if (!$url) return;

                (new CloudflareAdapter($token, $zoneId))->purgeUrls([$url]);
            }
        } catch (\Throwable $e) {
            Logger::warn('CDN purge failed', ['post_id' => $postId, 'error' => $e->getMessage()]);
        }
    }

    public function purgeUrls(array $urls): void
    {
        $config = $this->loadConfig();
        if (!$config || empty($config['adapter'])) return;

        try {
            if ($config['adapter'] === 'cloudflare') {
                $token = $this->decrypt($config['token_encrypted'] ?? '');
                $zoneId = (string) ($config['zone_id'] ?? '');
                if ($token === null || $zoneId === '') return;
                (new CloudflareAdapter($token, $zoneId))->purgeUrls($urls);
            }
        } catch (\Throwable $e) {
            Logger::warn('CDN purge URLs failed', ['urls_count' => count($urls), 'error' => $e->getMessage()]);
        }
    }

    public function configure(string $adapter, array $config): void
    {
        // Encrypt sensitive fields.
        if (isset($config['token']) && is_string($config['token'])) {
            $config['token_encrypted'] = $this->encrypt($config['token']);
            unset($config['token']);
        }
        update_option('joist_cdn_config', array_merge(['adapter' => $adapter], $config), false);
    }

    private function loadConfig(): ?array
    {
        $cfg = get_option('joist_cdn_config', null);
        return is_array($cfg) ? $cfg : null;
    }

    private function encrypt(string $plain): string
    {
        if (!function_exists('sodium_crypto_secretbox')) {
            return base64_encode($plain); // Fallback (insecure, but the option access is admin-only).
        }
        $key = $this->keyDerive();
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = sodium_crypto_secretbox($plain, $nonce, $key);
        return base64_encode($nonce . $cipher);
    }

    private function decrypt(string $encoded): ?string
    {
        if ($encoded === '') return null;
        if (!function_exists('sodium_crypto_secretbox_open')) {
            return base64_decode($encoded) ?: null;
        }
        $raw = base64_decode($encoded);
        if ($raw === false || strlen($raw) < SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) return null;
        $key = $this->keyDerive();
        $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $plain = sodium_crypto_secretbox_open($cipher, $nonce, $key);
        return $plain === false ? null : $plain;
    }

    private function keyDerive(): string
    {
        $material = defined('AUTH_KEY') ? AUTH_KEY : 'joist-default-insecure-key';
        return hash('sha256', 'joist-cdn-key:' . $material, true);
    }
}
