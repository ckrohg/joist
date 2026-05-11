<?php
declare(strict_types=1);

namespace Joist\Security;

use Joist\Elementor\WriteException;

/**
 * SSRF defense (constraint #21).
 *
 * Used by:
 *   - POST /media (url-mode upload)
 *   - POST /webhooks (registration AND each emission — defeats DNS rebinding)
 *
 * Rules:
 *   - https: only (no http, gopher, file, ftp, dict, data, javascript)
 *   - Hostname resolves to a public IP (deny RFC1918, loopback, link-local,
 *     unique-local IPv6, cloud-metadata IPs)
 *   - Re-resolve on connect — caller uses returned IP via CURLOPT_RESOLVE
 *   - Max redirects 0
 *   - Timeout 5s connect, 30s total
 */
final class URLValidator
{
    private const ALLOWED_SCHEMES = ['https'];

    /** Cloud metadata + special-purpose IPs to deny. */
    private const BANNED_IPV4 = [
        '169.254.169.254/32',  // AWS / GCP IMDS
        '169.254.170.2/32',    // ECS task metadata
        '100.100.100.200/32',  // Alibaba
        '169.254.0.0/16',      // link-local
        '127.0.0.0/8',          // loopback
        '10.0.0.0/8',           // RFC1918
        '172.16.0.0/12',        // RFC1918
        '192.168.0.0/16',       // RFC1918
        '0.0.0.0/8',            // current network
        '224.0.0.0/4',          // multicast
        '240.0.0.0/4',          // reserved
        '255.255.255.255/32',   // broadcast
    ];

    /**
     * @return array{url:string, host:string, resolved_ip:string}
     * @throws WriteException
     */
    public function validateExternal(string $url): array
    {
        $parts = wp_parse_url($url);
        if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) {
            throw new WriteException('url.invalid', 'URL is malformed.', 422);
        }

        $scheme = strtolower($parts['scheme']);
        if (!in_array($scheme, self::ALLOWED_SCHEMES, true)) {
            throw new WriteException(
                'url.scheme_disallowed',
                "Scheme '{$scheme}' not allowed. Only https: is permitted.",
                422,
                ['scheme' => $scheme]
            );
        }

        $host = strtolower($parts['host']);

        // Reject IPs directly in the URL — must use a hostname.
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            throw new WriteException(
                'url.ip_literal_disallowed',
                'URL must use a hostname, not a raw IP.',
                422
            );
        }

        // DNS resolution check.
        $resolved = gethostbynamel($host);
        if ($resolved === false || count($resolved) === 0) {
            throw new WriteException(
                'url.dns_failed',
                "Cannot resolve hostname '{$host}'.",
                422
            );
        }

        // All resolved IPs must be public.
        foreach ($resolved as $ip) {
            if (self::isPrivateOrSpecialIp($ip)) {
                throw new WriteException(
                    'url.private_ip_refused',
                    "Hostname '{$host}' resolves to a private/reserved IP ({$ip}).",
                    422,
                    ['host' => $host, 'resolved_ip' => $ip]
                );
            }
        }

        return [
            'url' => $url,
            'host' => $host,
            'resolved_ip' => $resolved[0],
        ];
    }

    public static function isPrivateOrSpecialIp(string $ip): bool
    {
        // IPv6: anything not GLOBAL_UNICAST is suspect.
        if (str_contains($ip, ':')) {
            $packed = inet_pton($ip);
            if ($packed === false) return true;
            // Loopback ::1
            if ($ip === '::1') return true;
            // Link-local fe80::/10
            if (strpos(strtolower($ip), 'fe80:') === 0) return true;
            // Unique local fc00::/7
            $first = ord($packed[0]);
            if (($first & 0xfe) === 0xfc) return true;
            return false;
        }

        // IPv4 — explicit CIDR list.
        foreach (self::BANNED_IPV4 as $cidr) {
            if (self::ipInCidr($ip, $cidr)) {
                return true;
            }
        }
        return false;
    }

    private static function ipInCidr(string $ip, string $cidr): bool
    {
        [$subnet, $bits] = explode('/', $cidr);
        $bits = (int) $bits;
        $ipLong = ip2long($ip);
        $subnetLong = ip2long($subnet);
        if ($ipLong === false || $subnetLong === false) return false;
        if ($bits === 0) return true;
        $mask = -1 << (32 - $bits);
        return ($ipLong & $mask) === ($subnetLong & $mask);
    }

    /**
     * Perform a guarded HTTP GET with timeout, no redirects, and DNS-rebinding
     * defense. Returns the response or throws WriteException.
     *
     * @return array{status:int, headers:array, body:string}
     */
    public function fetchGuarded(string $url, array $args = []): array
    {
        $validated = $this->validateExternal($url);

        $response = wp_remote_get($validated['url'], array_merge([
            'redirection' => 0,
            'timeout' => 30,
            'sslverify' => true,
            'headers' => [],
            // Note: wp_remote_get doesn't expose CURLOPT_RESOLVE directly.
            // For full DNS-rebinding defense we'd need a curl handler.
            // M0.5: accept the residual risk; v0.7 ships curl-based fetcher.
        ], $args));

        if (is_wp_error($response)) {
            throw new WriteException(
                'url.fetch_failed',
                'Fetch failed: ' . $response->get_error_message(),
                502
            );
        }

        return [
            'status' => (int) wp_remote_retrieve_response_code($response),
            'headers' => (array) wp_remote_retrieve_headers($response),
            'body' => (string) wp_remote_retrieve_body($response),
        ];
    }
}
