<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use Joist\Generate\Image\AssetRouter;
use Joist\Generate\Image\FluxLoraClient;
use WP_REST_Request;
use WP_REST_Server;

/**
 * @purpose REST surface for the Wave 6b image-generation pipeline.
 *
 * Endpoints:
 *   POST /joist/v1/generate/image                — single-asset render via AssetRouter
 *   POST /joist/v1/generate/image/train-lora     — kick off per-site LoRA training
 *   GET  /joist/v1/generate/image/lora/{site_id} — current LoRA id + status for a site
 *   GET  /joist/v1/generate/image/cost-meter     — session-scoped cost meter
 *
 * Every endpoint surfaces typed errors via ControllerBase's WriteException
 * envelope; AssetRouter raises `provider_unconfigured` / `cost_cap_exceeded`
 * / `unknown_asset_type` / `validation.missing_field` directly.
 *
 * Note: no permissionsAdmin gate on the generate endpoint — agent role can
 * call it under the same caps as the other write endpoints (it consumes the
 * 'writes' rate-limit bucket).
 */
final class GenerateController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/generate/image', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'image'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/generate/image/train-lora', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'trainLora'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/generate/image/lora/(?P<site_id>[A-Za-z0-9_.-]+)', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'loraForSite'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/generate/image/cost-meter', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'costMeter'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    public function image(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $body = $req->get_json_params();
            if (!is_array($body)) {
                throw new WriteException('validation.invalid_body', 'JSON body required.', 400);
            }
            // Constraint #1: reject unknown top-level keys outright so callers
            // get a 422 instead of silent passthrough.
            $allowed = ['site_id', 'asset_type', 'prompt', 'brand_profile', 'constraints', 'lora_id'];
            $unknown = array_diff(array_keys($body), $allowed);
            if ($unknown !== []) {
                throw new WriteException(
                    'schema.unknown_key',
                    'Unknown top-level keys in generate request: ' . implode(', ', $unknown),
                    422,
                    ['unknown_keys' => array_values($unknown), 'allowed' => $allowed],
                );
            }

            $result = $this->router()->render($body, $sessionId);
            return $this->ok($result->toApi(), $result->status === 'ok' ? 200 : 502);
        });
    }

    public function trainLora(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $body = $req->get_json_params();
            if (!is_array($body)) {
                throw new WriteException('validation.invalid_body', 'JSON body required.', 400);
            }
            $siteId = (string) ($body['site_id'] ?? '');
            $refs = (array) ($body['reference_urls'] ?? []);
            if ($siteId === '') {
                throw new WriteException(
                    'validation.missing_field',
                    "Required field 'site_id' is missing.",
                    422,
                    ['field' => 'site_id'],
                );
            }
            if ($refs === []) {
                throw new WriteException(
                    'validation.missing_field',
                    "Required field 'reference_urls' is missing or empty.",
                    422,
                    ['field' => 'reference_urls'],
                );
            }

            $flux = $this->fluxClient();
            $opts = (array) ($body['opts'] ?? []);
            $job = $flux->train($siteId, array_values(array_map('strval', $refs)), $opts);

            if ($job->status === 'unconfigured') {
                throw new WriteException(
                    'provider_unconfigured',
                    $job->errorMessage ?? 'fal.ai is not configured.',
                    422,
                    [
                        'provider' => FluxLoraClient::PROVIDER,
                        'env_var' => FluxLoraClient::ENV_VAR,
                        'wp_option' => FluxLoraClient::OPTION_KEY,
                    ],
                );
            }
            $status = $job->status === 'failed' ? 502 : 202;
            return $this->ok($job->toApi(), $status);
        });
    }

    public function loraForSite(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $siteId = (string) $req->get_param('site_id');
            if ($siteId === '') {
                throw new WriteException('validation.missing_field', 'site_id path param required.', 422);
            }
            $loraId = $this->router()->loraIdForSite($siteId);
            return $this->ok([
                'site_id' => $siteId,
                'lora_id' => $loraId,
                'status' => $loraId === null ? 'none' : 'ready',
            ]);
        });
    }

    public function costMeter(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req, string $sessionId) {
            return $this->ok($this->router()->costMeter($sessionId));
        });
    }

    private function router(): AssetRouter
    {
        return Container::get('assetRouter');
    }

    private function fluxClient(): FluxLoraClient
    {
        return Container::get('fluxClient');
    }
}
