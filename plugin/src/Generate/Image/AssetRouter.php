<?php
declare(strict_types=1);

namespace Joist\Generate\Image;

use Joist\Elementor\WriteException;

/**
 * @purpose Dispatcher for the brand-faithful image pipeline (Wave 6b).
 *
 * Fans out by asset_type:
 *   hero_image / lifestyle  -> FluxLoraClient (per-site LoRA via fal.ai)
 *   vector_icon / logo      -> RecraftClient (format=svg)
 *   text_on_image           -> IdeogramClient (text-rendering accuracy)
 *   stock_replacement       -> FluxLoraClient WITHOUT LoRA (no brand yet);
 *                              the Imagen 4 Fast fallback hook is wired but
 *                              gated behind a future config flag (the synth
 *                              recommends Imagen for bootstrap, but we don't
 *                              ship a fourth client this wave; see TODO).
 *
 * Refuse-not-corrupt:
 *   - Unknown asset_type        -> 422 unknown_asset_type
 *   - Required field missing    -> 422 validation.missing_field
 *   - Cost cap exceeded         -> 429 cost_cap_exceeded (constraint #9)
 *   - Routed provider lacks key -> 422 provider_unconfigured + env var hint
 *     (NOT a silent fallback — constraint #16 / refuse-not-corrupt rule)
 *
 * Cost meter:
 *   - Per-session total tracked via WP transients keyed by session_id
 *   - Default cap $10/session, configurable via joist_image_gen_cap_usd option
 *   - The cap is checked BEFORE the call; rejected calls don't add cost
 *   - costMeter() exposes a read surface for the dashboard
 */
final class AssetRouter
{
    public const ASSET_HERO_IMAGE = 'hero_image';
    public const ASSET_LIFESTYLE = 'lifestyle';
    public const ASSET_VECTOR_ICON = 'vector_icon';
    public const ASSET_LOGO = 'logo';
    public const ASSET_TEXT_ON_IMAGE = 'text_on_image';
    public const ASSET_STOCK_REPLACEMENT = 'stock_replacement';

    public const VALID_ASSET_TYPES = [
        self::ASSET_HERO_IMAGE, self::ASSET_LIFESTYLE,
        self::ASSET_VECTOR_ICON, self::ASSET_LOGO,
        self::ASSET_TEXT_ON_IMAGE, self::ASSET_STOCK_REPLACEMENT,
    ];

    public const DEFAULT_CAP_USD = 10.0;
    public const COST_METER_OPTION_KEY = 'joist_image_gen_cap_usd';
    private const COST_METER_TRANSIENT_PREFIX = 'joist_imggen_cost_';
    private const COST_METER_TTL_SECONDS = 86400;

    public function __construct(
        private readonly FluxLoraClient $flux,
        private readonly RecraftClient $recraft,
        private readonly IdeogramClient $ideogram,
    ) {}

    /**
     * Render a single image-generation request.
     *
     * @param array<string,mixed> $request {
     *   site_id: string,
     *   asset_type: string (one of VALID_ASSET_TYPES),
     *   prompt: string,
     *   brand_profile?: array,
     *   constraints?: { width?: int, height?: int, format?: string },
     *   lora_id?: string (override; otherwise resolved from PreferenceMemory)
     * }
     * @param string $sessionId The X-Joist-Session-Id (for the cost meter).
     */
    public function render(array $request, string $sessionId): ImageResult
    {
        $this->assertValid($request);

        $assetType = (string) $request['asset_type'];
        $prompt = (string) $request['prompt'];
        $siteId = (string) $request['site_id'];
        $brand = (array) ($request['brand_profile'] ?? []);
        $constraints = (array) ($request['constraints'] ?? []);

        // Cost cap check BEFORE the call (constraint #9).
        $this->assertWithinCap($sessionId);

        $result = match ($assetType) {
            self::ASSET_HERO_IMAGE,
            self::ASSET_LIFESTYLE       => $this->routeFlux($siteId, $prompt, $brand, $constraints, $request, requireLora: true),
            self::ASSET_VECTOR_ICON,
            self::ASSET_LOGO            => $this->routeRecraft($prompt, $brand, $constraints),
            self::ASSET_TEXT_ON_IMAGE   => $this->routeIdeogram($prompt, $brand, $constraints),
            self::ASSET_STOCK_REPLACEMENT => $this->routeFlux($siteId, $prompt, $brand, $constraints, $request, requireLora: false),
            // assertValid() already gated the asset_type; this is unreachable
            // but kept for type-completeness.
            default => throw $this->unknownAssetType($assetType),
        };

        // Constraint #16: never silently downgrade. Unconfigured providers
        // bubble up as a typed 422; the REST layer surfaces the env-var hint.
        if ($result->status === 'unconfigured') {
            throw new WriteException(
                'provider_unconfigured',
                $result->errorMessage ?? 'Required image provider is not configured.',
                422,
                [
                    'provider' => $result->provider,
                    'asset_type' => $assetType,
                    'env_var' => (string) ($result->meta['env_var'] ?? ''),
                    'wp_option' => $this->wpOptionForProvider($result->provider),
                ],
            );
        }

        // Add successful (status=ok) cost to the running meter.
        if ($result->status === 'ok' && $result->costUsd > 0) {
            $this->addToMeter($sessionId, $result->costUsd);
        }

        return $result;
    }

    /**
     * Read the cost-meter for a session.
     *
     * @return array{session_id:string, session_total_usd:float, cap_usd:float, remaining_usd:float}
     */
    public function costMeter(string $sessionId): array
    {
        $cap = $this->capUsd();
        $total = $this->meterRead($sessionId);
        return [
            'session_id' => $sessionId,
            'session_total_usd' => round($total, 4),
            'cap_usd' => round($cap, 4),
            'remaining_usd' => round(max(0.0, $cap - $total), 4),
        ];
    }

    /**
     * Resolve the LoRA id for the given site. Used by the REST controller
     * to surface the current LoRA state in GET /lora/{site_id}.
     */
    public function loraIdForSite(string $siteId): ?string
    {
        return $this->flux->loraIdForSite($siteId);
    }

    /** Hand the FLUX client back for callers that need to drive training/polling. */
    public function fluxClient(): FluxLoraClient
    {
        return $this->flux;
    }

    /** Reset the cost meter for a session (admin/test path). */
    public function resetMeter(string $sessionId): void
    {
        delete_transient($this->meterKey($sessionId));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Routing implementations
    // ──────────────────────────────────────────────────────────────────────

    private function routeFlux(string $siteId, string $prompt, array $brand, array $constraints, array $request, bool $requireLora): ImageResult
    {
        $loraId = (string) ($request['lora_id'] ?? '');
        if ($loraId === '' && $requireLora) {
            $resolved = $this->flux->loraIdForSite($siteId);
            $loraId = (string) ($resolved ?? '');
        }
        $opts = [];
        if (isset($constraints['width'], $constraints['height'])) {
            $opts['image_size'] = (string) ($constraints['width']) . 'x' . (string) ($constraints['height']);
        }
        if (!empty($constraints['format'])) {
            $opts['output_format'] = (string) $constraints['format'];
        }
        if (!empty($brand['lora_scale'])) {
            $opts['lora_scale'] = (float) $brand['lora_scale'];
        }
        return $this->flux->generate($loraId, $prompt, $opts);
    }

    private function routeRecraft(string $prompt, array $brand, array $constraints): ImageResult
    {
        $format = strtolower((string) ($constraints['format'] ?? 'svg'));
        $opts = [
            'format' => $format,
            'size' => $this->sizeFromConstraints($constraints, '1024x1024'),
        ];
        if (!empty($brand['style_id']))       $opts['style_id'] = (string) $brand['style_id'];
        if (!empty($brand['style']))          $opts['style']    = (string) $brand['style'];
        if (!empty($brand['palette']) && is_array($brand['palette'])) {
            $opts['colors'] = array_values(array_map('strval', $brand['palette']));
        }
        return $this->recraft->generate($prompt, $opts);
    }

    private function routeIdeogram(string $prompt, array $brand, array $constraints): ImageResult
    {
        $opts = [];
        if (!empty($constraints['aspect_ratio'])) {
            $opts['aspect_ratio'] = (string) $constraints['aspect_ratio'];
        } elseif (isset($constraints['width'], $constraints['height'])) {
            $opts['aspect_ratio'] = $this->inferAspectRatio((int) $constraints['width'], (int) $constraints['height']);
        }
        if (!empty($brand['ideogram_style'])) {
            $opts['style'] = (string) $brand['ideogram_style'];
        }
        return $this->ideogram->generate($prompt, $opts);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Validation / cost-meter helpers
    // ──────────────────────────────────────────────────────────────────────

    private function assertValid(array $request): void
    {
        foreach (['site_id', 'asset_type', 'prompt'] as $field) {
            if (!isset($request[$field]) || trim((string) $request[$field]) === '') {
                throw new WriteException(
                    'validation.missing_field',
                    "Required field '{$field}' is missing.",
                    422,
                    ['field' => $field, 'required' => ['site_id', 'asset_type', 'prompt']],
                );
            }
        }
        if (!in_array((string) $request['asset_type'], self::VALID_ASSET_TYPES, true)) {
            throw $this->unknownAssetType((string) $request['asset_type']);
        }
    }

    private function unknownAssetType(string $given): WriteException
    {
        return new WriteException(
            'unknown_asset_type',
            "asset_type '{$given}' is not recognised.",
            422,
            ['given' => $given, 'valid' => self::VALID_ASSET_TYPES],
        );
    }

    private function assertWithinCap(string $sessionId): void
    {
        $cap = $this->capUsd();
        $total = $this->meterRead($sessionId);
        if ($total >= $cap) {
            throw new WriteException(
                'cost_cap_exceeded',
                "Image-generation cost cap reached for this session (\${$total} / \${$cap}).",
                429,
                [
                    'session_total_usd' => round($total, 4),
                    'cap_usd' => round($cap, 4),
                    'retry_after' => 0,
                ],
            );
        }
    }

    private function addToMeter(string $sessionId, float $costUsd): void
    {
        $current = $this->meterRead($sessionId);
        set_transient(
            $this->meterKey($sessionId),
            $current + $costUsd,
            self::COST_METER_TTL_SECONDS,
        );
    }

    private function meterRead(string $sessionId): float
    {
        $val = get_transient($this->meterKey($sessionId));
        return is_numeric($val) ? (float) $val : 0.0;
    }

    private function meterKey(string $sessionId): string
    {
        // WP transient keys must be <= 172 chars and safe; hash sessionId.
        return self::COST_METER_TRANSIENT_PREFIX . substr(md5($sessionId), 0, 24);
    }

    private function capUsd(): float
    {
        $opt = get_option(self::COST_METER_OPTION_KEY, null);
        if (is_numeric($opt) && (float) $opt > 0) {
            return (float) $opt;
        }
        return self::DEFAULT_CAP_USD;
    }

    private function sizeFromConstraints(array $constraints, string $default): string
    {
        if (isset($constraints['width'], $constraints['height'])) {
            return (string) ((int) $constraints['width']) . 'x' . (string) ((int) $constraints['height']);
        }
        return $default;
    }

    private function inferAspectRatio(int $w, int $h): string
    {
        if ($w === 0 || $h === 0) return '1x1';
        $ratio = $w / $h;
        $pairs = [
            ['1x1', 1.0], ['16x9', 16/9], ['9x16', 9/16],
            ['4x3', 4/3], ['3x4', 3/4], ['3x2', 3/2], ['2x3', 2/3],
        ];
        $best = $pairs[0];
        $bestDiff = abs($ratio - $best[1]);
        foreach ($pairs as $p) {
            $d = abs($ratio - $p[1]);
            if ($d < $bestDiff) { $best = $p; $bestDiff = $d; }
        }
        return (string) $best[0];
    }

    private function wpOptionForProvider(string $provider): string
    {
        return match (true) {
            str_starts_with($provider, 'fal/')      => FluxLoraClient::OPTION_KEY,
            str_starts_with($provider, 'recraft/')  => RecraftClient::OPTION_KEY,
            str_starts_with($provider, 'ideogram/') => IdeogramClient::OPTION_KEY,
            default => '',
        };
    }
}
