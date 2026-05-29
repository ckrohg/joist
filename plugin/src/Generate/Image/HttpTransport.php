<?php
declare(strict_types=1);

namespace Joist\Generate\Image;

use Joist\Core\Logger;

/**
 * @purpose Thin wrapper over wp_remote_post / wp_remote_get for image-provider
 *          HTTP calls. Centralises:
 *           - User-Agent header (Joist/<JOIST_VERSION>)
 *           - JSON encode/decode with strict mode
 *           - Configurable timeout (JOIST_HTTP_TIMEOUT_MS env, default 30000ms)
 *           - Duration + status logging via Joist\Core\Logger (which redacts secrets)
 *           - TransportException on 5xx / WP_Error / non-JSON-in-strict
 *
 * Why a wrapper instead of calling wp_remote_post directly: every provider
 * client needs the same logging, the same UA, the same timeout source, and
 * the same strict-decode discipline. Without this, a single forgotten
 * timeout default starts blocking PHP-FPM workers on a hosting box.
 *
 * No new runtime deps — pure wp_remote_*.
 */
final class HttpTransport
{
    public const DEFAULT_TIMEOUT_MS = 30000;

    /** @var array<string,string> */
    private array $defaultHeaders;

    public function __construct(array $defaultHeaders = [])
    {
        $version = defined('JOIST_VERSION') ? (string) JOIST_VERSION : 'dev';
        $this->defaultHeaders = array_merge([
            'User-Agent' => "Joist/{$version}",
            'Accept' => 'application/json',
        ], $defaultHeaders);
    }

    /**
     * POST JSON. Returns a normalised {status,headers,body} response.
     *
     * @param array<string,mixed>  $body    Will be json_encoded.
     * @param array<string,string> $headers Merged over defaults.
     * @param bool                 $strict  If true, non-JSON body or 5xx throws TransportException.
     */
    public function postJson(string $url, array $body, array $headers = [], bool $strict = true): HttpResponse
    {
        $json = wp_json_encode($body);
        if ($json === false) {
            throw new TransportException(
                'transport.json_encode_failed',
                'Failed to JSON-encode request body.',
                0,
            );
        }
        $mergedHeaders = array_merge(
            $this->defaultHeaders,
            ['Content-Type' => 'application/json'],
            $headers,
        );
        return $this->request('POST', $url, $mergedHeaders, $json, $strict);
    }

    /**
     * Raw POST (caller-controlled body, e.g. multipart). $body is sent verbatim.
     *
     * @param array<string,string> $headers
     */
    public function postRaw(string $url, string $body, array $headers, bool $strict = true): HttpResponse
    {
        $mergedHeaders = array_merge($this->defaultHeaders, $headers);
        return $this->request('POST', $url, $mergedHeaders, $body, $strict);
    }

    /**
     * GET. JSON body in the response is decoded under strict mode.
     *
     * @param array<string,string> $headers
     */
    public function get(string $url, array $headers = [], bool $strict = true): HttpResponse
    {
        $mergedHeaders = array_merge($this->defaultHeaders, $headers);
        return $this->request('GET', $url, $mergedHeaders, null, $strict);
    }

    private function request(string $method, string $url, array $headers, ?string $body, bool $strict): HttpResponse
    {
        $timeoutSec = max(1, (int) round($this->timeoutMs() / 1000));
        $args = [
            'method' => $method,
            'headers' => $headers,
            'timeout' => $timeoutSec,
            // Force WP to not blindly follow redirects to credentialed endpoints.
            'redirection' => 3,
        ];
        if ($body !== null) {
            $args['body'] = $body;
        }

        $started = microtime(true);
        $raw = wp_remote_request($url, $args);
        $durationMs = (int) round((microtime(true) - $started) * 1000);

        if (is_wp_error($raw)) {
            Logger::warn('joist.image.http_error', [
                'url' => $url,
                'method' => $method,
                'duration_ms' => $durationMs,
                'wp_error' => $raw->get_error_code(),
                'wp_message' => $raw->get_error_message(),
            ]);
            throw new TransportException(
                'transport.network_error',
                'Network error contacting image provider: ' . $raw->get_error_message(),
                0,
                ['wp_error' => $raw->get_error_code()],
            );
        }

        $status = (int) wp_remote_retrieve_response_code($raw);
        $bodyStr = (string) wp_remote_retrieve_body($raw);
        $hdrs = (array) wp_remote_retrieve_headers($raw);

        Logger::info('joist.image.http', [
            'url' => $url,
            'method' => $method,
            'status' => $status,
            'duration_ms' => $durationMs,
            'bytes' => strlen($bodyStr),
        ]);

        if ($strict && $status >= 500) {
            throw new TransportException(
                'transport.upstream_5xx',
                "Image provider returned {$status}.",
                $status,
                ['body_preview' => substr($bodyStr, 0, 500)],
            );
        }

        $decoded = null;
        if ($bodyStr !== '') {
            $decoded = json_decode($bodyStr, true);
            if ($decoded === null && json_last_error() !== JSON_ERROR_NONE) {
                if ($strict) {
                    throw new TransportException(
                        'transport.invalid_json',
                        'Image provider returned non-JSON body.',
                        $status,
                        ['json_error' => json_last_error_msg(), 'body_preview' => substr($bodyStr, 0, 500)],
                    );
                }
                $decoded = null;
            }
        }

        return new HttpResponse($status, $hdrs, $bodyStr, is_array($decoded) ? $decoded : null, $durationMs);
    }

    private function timeoutMs(): int
    {
        $env = getenv('JOIST_HTTP_TIMEOUT_MS');
        if ($env !== false && ctype_digit((string) $env)) {
            return max(500, (int) $env);
        }
        return self::DEFAULT_TIMEOUT_MS;
    }
}
