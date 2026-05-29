<?php
declare(strict_types=1);

namespace Joist\Generate\Image;

/**
 * @purpose Recraft V4.1 client.
 *
 * Used by AssetRouter for vector_icon, logo, and any asset that benefits
 * from Style Lock — Recraft's Style Lock keeps a fixed palette + visual
 * grammar across calls, which matches Joist's per-site brand discipline.
 *
 * Verified surfaces (May 2026 docs):
 *   - Base: https://external.api.recraft.ai/v1
 *   - POST /v1/images/generations (default model recraftv4_1)
 *   - Authorization: Bearer <token>
 *   - Body: { prompt, model, style, substyle, style_id, size, n,
 *            response_format ("url" | "b64_json"),
 *            controls: { colors: [ { rgb: [r,g,b] } ] } }
 *   - Response: { created: <timestamp>, data: [ { url: "...", b64_json?: "..." } ] }
 *
 * SVG vs raster: model `recraftv3_svg` (or style `vector_illustration`) returns
 * vector output. We default to raster (recraftv4_1) and switch when the request
 * asks for SVG (AssetRouter sets this for vector_icon / logo).
 *
 * Source: https://www.recraft.ai/docs/api-reference/endpoints.md (verified
 * 2026-05-28). Pricing-per-call is documented behind the dashboard, so we
 * use the spec rates here: $0.04 raster / $0.08 vector.
 */
final class RecraftClient
{
    public const PROVIDER = 'recraft/v4.1';
    public const ENV_VAR = 'JOIST_RECRAFT_API_KEY';
    public const OPTION_KEY = 'joist_recraft_api_key';

    public const ENDPOINT_GENERATE = 'https://external.api.recraft.ai/v1/images/generations';

    public const COST_RASTER_USD = 0.04;
    public const COST_VECTOR_USD = 0.08;

    public function __construct(
        private readonly HttpTransport $http,
        private readonly ?string $apiKeyOverride = null,
    ) {}

    public function isConfigured(): bool
    {
        return $this->apiKey() !== null;
    }

    /**
     * @param array<string,mixed> $opts Supported keys:
     *   - format       : 'svg' | 'png' | 'jpg'  (default png)
     *   - style_id     : Recraft Style Lock id
     *   - style        : top-level style string (e.g. 'digital_illustration')
     *   - substyle     : substyle slug
     *   - size         : 'WxH' string (default '1024x1024')
     *   - n            : 1-6 (default 1)
     *   - colors       : list of hex strings ('#D4FF3A') enforced by Style Lock
     *   - response_format : 'url' (default) | 'b64_json'
     */
    public function generate(string $prompt, array $opts = []): ImageResult
    {
        if (!$this->isConfigured()) {
            return ImageResult::unconfigured(self::PROVIDER, self::ENV_VAR);
        }
        if (trim($prompt) === '') {
            return new ImageResult(
                status: 'error',
                provider: self::PROVIDER,
                imageUrl: null,
                generationId: null,
                costUsd: 0.0,
                latencyMs: 0,
                errorCode: 'generate.empty_prompt',
                errorMessage: 'prompt is required.',
            );
        }

        $format = strtolower((string) ($opts['format'] ?? 'png'));
        $body = $this->buildBody($prompt, $format, $opts);

        try {
            $resp = $this->http->postJson(
                self::ENDPOINT_GENERATE,
                $body,
                ['Authorization' => 'Bearer ' . (string) $this->apiKey()],
            );
        } catch (TransportException $e) {
            return new ImageResult(
                status: 'error',
                provider: self::PROVIDER,
                imageUrl: null,
                generationId: null,
                costUsd: 0.0,
                latencyMs: 0,
                errorCode: $e->errorCode,
                errorMessage: $e->getMessage(),
                meta: $e->details,
            );
        }

        $json = $resp->json ?? [];
        $data = (array) ($json['data'] ?? []);
        if ($data === []) {
            return new ImageResult(
                status: 'error',
                provider: self::PROVIDER,
                imageUrl: null,
                generationId: null,
                costUsd: 0.0,
                latencyMs: $resp->durationMs,
                errorCode: 'generate.no_images',
                errorMessage: 'Recraft returned an empty data array.',
                meta: ['response' => $json],
            );
        }
        $first = (array) $data[0];
        $url = (string) ($first['url'] ?? '');
        $b64 = $first['b64_json'] ?? null;

        $isVector = ($format === 'svg');
        $cost = $isVector ? self::COST_VECTOR_USD : self::COST_RASTER_USD;
        $cost *= max(1, (int) ($opts['n'] ?? 1));

        return new ImageResult(
            status: 'ok',
            provider: self::PROVIDER,
            imageUrl: $url !== '' ? $url : null,
            generationId: (string) ($json['created'] ?? ''),
            costUsd: round($cost, 4),
            latencyMs: $resp->durationMs,
            meta: [
                'format' => $format,
                'b64_json' => is_string($b64) ? $b64 : null,
                'style_id' => $opts['style_id'] ?? null,
                'all_images' => array_map(static fn($d) => (string) ($d['url'] ?? ''), $data),
            ],
        );
    }

    /**
     * @param array<string,mixed> $opts
     * @return array<string,mixed>
     */
    private function buildBody(string $prompt, string $format, array $opts): array
    {
        $isVector = ($format === 'svg');
        // model selection follows Recraft's vector model naming convention.
        // TODO(provider-api-verify): confirm recraftv4_1 vs recraftv3_svg
        // is still the right pair for V4.1's vector pathway when a working
        // RECRAFT key is available; the choice is funneled here.
        $model = (string) ($opts['model'] ?? ($isVector ? 'recraftv3_svg' : 'recraftv4_1'));

        $body = [
            'prompt' => $prompt,
            'model' => $model,
            'size' => (string) ($opts['size'] ?? '1024x1024'),
            'n' => max(1, min(6, (int) ($opts['n'] ?? 1))),
            'response_format' => (string) ($opts['response_format'] ?? 'url'),
        ];
        if (!empty($opts['style']))    $body['style']    = (string) $opts['style'];
        if (!empty($opts['substyle'])) $body['substyle'] = (string) $opts['substyle'];
        if (!empty($opts['style_id'])) $body['style_id'] = (string) $opts['style_id'];

        // controls.colors[].rgb is the enforced-palette mechanism (Style Lock).
        if (!empty($opts['colors']) && is_array($opts['colors'])) {
            $colors = [];
            foreach ($opts['colors'] as $hex) {
                $rgb = $this->hexToRgb((string) $hex);
                if ($rgb !== null) $colors[] = ['rgb' => $rgb];
            }
            if ($colors !== []) {
                $body['controls'] = ['colors' => $colors];
            }
        }
        return $body;
    }

    /** Convert "#D4FF3A" -> [212, 255, 58]; null if input isn't a valid hex. */
    private function hexToRgb(string $hex): ?array
    {
        $hex = ltrim($hex, '#');
        if (strlen($hex) === 3) {
            $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        }
        if (!preg_match('/^[0-9a-fA-F]{6}$/', $hex)) return null;
        return [
            (int) hexdec(substr($hex, 0, 2)),
            (int) hexdec(substr($hex, 2, 2)),
            (int) hexdec(substr($hex, 4, 2)),
        ];
    }

    private function apiKey(): ?string
    {
        if ($this->apiKeyOverride !== null && $this->apiKeyOverride !== '') {
            return $this->apiKeyOverride;
        }
        $env = getenv(self::ENV_VAR);
        if ($env !== false && $env !== '') {
            return (string) $env;
        }
        $opt = (string) get_option(self::OPTION_KEY, '');
        return $opt !== '' ? $opt : null;
    }
}
