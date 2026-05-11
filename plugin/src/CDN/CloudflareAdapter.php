<?php
declare(strict_types=1);

namespace Joist\CDN;

use Joist\Elementor\WriteException;

final class CloudflareAdapter
{
    public function __construct(
        private string $apiToken,
        private string $zoneId,
    ) {}

    /**
     * Purge specific URLs from Cloudflare cache.
     */
    public function purgeUrls(array $urls): void
    {
        if (count($urls) === 0) return;
        $endpoint = "https://api.cloudflare.com/client/v4/zones/{$this->zoneId}/purge_cache";
        $response = wp_remote_post($endpoint, [
            'timeout' => 5,
            'headers' => [
                'Authorization' => 'Bearer ' . $this->apiToken,
                'Content-Type' => 'application/json',
            ],
            'body' => wp_json_encode(['files' => array_values($urls)]),
        ]);
        if (is_wp_error($response)) {
            throw new WriteException('cdn.cloudflare_failed', $response->get_error_message(), 502);
        }
        $code = (int) wp_remote_retrieve_response_code($response);
        if ($code < 200 || $code >= 300) {
            $body = wp_remote_retrieve_body($response);
            throw new WriteException('cdn.cloudflare_failed', "Cloudflare API returned {$code}: {$body}", 502);
        }
    }

    public function verifyToken(): bool
    {
        $endpoint = 'https://api.cloudflare.com/client/v4/user/tokens/verify';
        $response = wp_remote_get($endpoint, [
            'timeout' => 5,
            'headers' => ['Authorization' => 'Bearer ' . $this->apiToken],
        ]);
        if (is_wp_error($response)) return false;
        return (int) wp_remote_retrieve_response_code($response) === 200;
    }
}
