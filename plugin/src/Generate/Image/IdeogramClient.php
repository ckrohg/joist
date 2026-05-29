<?php
declare(strict_types=1);

namespace Joist\Generate\Image;

/**
 * @purpose Ideogram 3.0 client.
 *
 * Used by AssetRouter for text_on_image (and any other case where in-image
 * typography matters — Ideogram 3.0's differentiator is text-rendering
 * accuracy). We default magic_prompt=OFF because Joist owns the prompt
 * (the Ozigi anti-slop pipeline + brand voice block already curated it);
 * Ideogram's magic_prompt would otherwise re-write our carefully built input.
 *
 * Verified surfaces (May 2026 docs):
 *   - POST https://api.ideogram.ai/v1/ideogram-v3/generate (multipart/form-data)
 *   - Api-Key: <key> header
 *   - Fields: prompt (req), aspect_ratio, style_type, magic_prompt, num_images,
 *     rendering_speed, seed, negative_prompt, color_palette
 *   - Response: { created, data: [ { url, prompt, resolution, is_image_safe,
 *                                     seed, style_type } ] }
 *
 * Source: https://developer.ideogram.ai/api-reference/api-reference/generate-v3
 * (verified 2026-05-28). Per-call pricing not in the public docs; using
 * the stream-E synthesis estimate of $0.06/image as a placeholder.
 * TODO(provider-api-verify): replace per-call cost with the rate from a
 * live billing-page check once a key is available.
 */
final class IdeogramClient
{
    public const PROVIDER = 'ideogram/v3';
    public const ENV_VAR = 'JOIST_IDEOGRAM_API_KEY';
    public const OPTION_KEY = 'joist_ideogram_api_key';

    public const ENDPOINT_GENERATE = 'https://api.ideogram.ai/v1/ideogram-v3/generate';

    /** Placeholder until verified against a live billing surface. */
    public const COST_PER_IMAGE_USD = 0.06;

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
     *   - aspect_ratio   : '1x1' | '16x9' | '9x16' | ...
     *   - style          : 'REALISTIC' (default) | 'GENERAL' | 'DESIGN' | 'FICTION' | 'AUTO'
     *   - magic_prompt   : 'AUTO' | 'ON' | 'OFF' (we default to OFF — see class docblock)
     *   - num_images     : 1..8
     *   - seed           : int
     *   - negative_prompt: string
     *   - rendering_speed: 'FLASH' | 'TURBO' | 'DEFAULT' | 'QUALITY'
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

        [$body, $contentType] = $this->buildMultipart($prompt, $opts);

        try {
            $resp = $this->http->postRaw(
                self::ENDPOINT_GENERATE,
                $body,
                [
                    'Api-Key' => (string) $this->apiKey(),
                    'Content-Type' => $contentType,
                ],
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
                errorMessage: 'Ideogram returned an empty data array.',
                meta: ['response' => $json],
            );
        }
        $first = (array) $data[0];
        $url = (string) ($first['url'] ?? '');
        $n = max(1, (int) ($opts['num_images'] ?? 1));
        $cost = round($n * self::COST_PER_IMAGE_USD, 4);

        return new ImageResult(
            status: 'ok',
            provider: self::PROVIDER,
            imageUrl: $url !== '' ? $url : null,
            generationId: (string) ($first['seed'] ?? ''),
            costUsd: $cost,
            latencyMs: $resp->durationMs,
            meta: [
                'resolution' => (string) ($first['resolution'] ?? ''),
                'is_image_safe' => $first['is_image_safe'] ?? null,
                'style_type' => (string) ($first['style_type'] ?? ''),
                'prompt_used' => (string) ($first['prompt'] ?? ''),
            ],
        );
    }

    /**
     * Ideogram v3 uses multipart/form-data even when no file is attached.
     * Build the body by hand — no curl handle, no streaming, fits in
     * memory by definition (we're not attaching style reference images
     * from this surface; that's a v0.8 feature).
     *
     * @param array<string,mixed> $opts
     * @return array{0:string,1:string} body, content-type
     */
    private function buildMultipart(string $prompt, array $opts): array
    {
        $boundary = '----joist-' . bin2hex(random_bytes(8));
        $fields = ['prompt' => $prompt];

        $aspect = (string) ($opts['aspect_ratio'] ?? '16x9');
        $style = strtoupper((string) ($opts['style'] ?? 'REALISTIC'));
        // We own the prompt — see class docblock. Override via opts if needed.
        $magic = strtoupper((string) ($opts['magic_prompt'] ?? 'OFF'));

        $fields['aspect_ratio'] = $aspect;
        $fields['style_type'] = $style;
        $fields['magic_prompt'] = $magic;
        $fields['num_images'] = (string) max(1, min(8, (int) ($opts['num_images'] ?? 1)));
        if (isset($opts['seed'])) $fields['seed'] = (string) (int) $opts['seed'];
        if (!empty($opts['negative_prompt'])) $fields['negative_prompt'] = (string) $opts['negative_prompt'];
        if (!empty($opts['rendering_speed'])) {
            $fields['rendering_speed'] = strtoupper((string) $opts['rendering_speed']);
        }

        $body = '';
        foreach ($fields as $name => $value) {
            $body .= "--{$boundary}\r\n";
            $body .= "Content-Disposition: form-data; name=\"{$name}\"\r\n\r\n";
            $body .= $value . "\r\n";
        }
        $body .= "--{$boundary}--\r\n";

        return [$body, 'multipart/form-data; boundary=' . $boundary];
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
