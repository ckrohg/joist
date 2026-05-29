<?php
declare(strict_types=1);

namespace Joist\Generate\Image;

use Joist\Container;
use Joist\Core\Logger;
use Joist\Eval\Rule;

/**
 * @purpose fal.ai client for FLUX.2 [dev] + per-site LoRA training & inference.
 *
 * Primary entry point for hero/lifestyle imagery in Joist's brand pipeline.
 * Implements two flows:
 *
 *  1. train(siteId, referenceImages, opts)
 *     Submits a flux-lora-fast-training job and returns a TrainingJob handle.
 *     pollTraining(jobId) is the matching status check; on terminal completion
 *     we persist the resulting LoRA reference (path + scale) into the
 *     PreferenceMemory store under a 'lora_id' directive on the current site,
 *     so future generate() calls can refer to it without re-training.
 *
 *  2. generate(loraId, prompt, opts)
 *     Submits a fal-ai/flux-2/lora inference job referencing the trained LoRA
 *     and returns an ImageResult.
 *
 * Dark-test contract: every method first checks the API key. If absent it
 * returns the structured `unconfigured` variant — no upstream call is made.
 * The unconfigured path is the only "no key set" code branch; never a silent
 * downgrade (failure-mode constraint #16).
 *
 * Verified surfaces (May 2026 docs):
 *   - https://fal.ai/models/fal-ai/flux-2/lora             (inference, $0.021/MP)
 *   - https://fal.ai/models/fal-ai/flux-lora-fast-training (training, $2/run)
 *   - Queue submit at fal.queue.submit(<endpoint_id>, ...) — base
 *     URL https://queue.fal.run/<endpoint_id> for HTTP per their public OpenAPI;
 *     status/result return JSON with image[].url / diffusers_lora_file.url.
 *
 * Anything not 100% verified is annotated TODO(provider-api-verify); the
 * request-shaping is funneled through buildInferenceBody() / buildTrainingBody()
 * so the fix-up is single-call.
 */
final class FluxLoraClient
{
    public const PROVIDER = 'fal/flux-2-lora';
    public const ENV_VAR = 'JOIST_FAL_API_KEY';
    public const OPTION_KEY = 'joist_fal_api_key';

    public const ENDPOINT_INFERENCE = 'https://queue.fal.run/fal-ai/flux-2/lora';
    public const ENDPOINT_TRAINING = 'https://queue.fal.run/fal-ai/flux-lora-fast-training';

    /** Per-megapixel rate quoted on fal.ai/models/fal-ai/flux-2/lora as of 2026-05-28. */
    public const COST_PER_MEGAPIXEL_USD = 0.021;

    /** Flat training cost quoted on fal-ai/flux-lora-fast-training as of 2026-05-28. */
    public const COST_TRAINING_USD = 3.0;

    public function __construct(
        private readonly HttpTransport $http,
        private readonly ?string $apiKeyOverride = null,
    ) {}

    public function isConfigured(): bool
    {
        return $this->apiKey() !== null;
    }

    /**
     * Kick off a LoRA training job on the given reference images.
     *
     * @param string                $siteId          Joist site partition (PreferenceMemory::siteId()).
     * @param list<string>          $referenceImages URLs of images already uploaded
     *                                               (e.g. WP media library URLs) OR a single ZIP url.
     * @param array<string,mixed>   $opts            Optional overrides: 'trigger_word', 'steps', 'is_style'.
     */
    public function train(string $siteId, array $referenceImages, array $opts = []): TrainingJob
    {
        if (!$this->isConfigured()) {
            return TrainingJob::unconfigured(self::ENV_VAR);
        }
        if ($referenceImages === []) {
            return new TrainingJob(
                status: TrainingJob::STATUS_FAILED,
                jobId: null,
                loraId: null,
                etaSeconds: null,
                costUsd: 0.0,
                errorCode: 'training.no_references',
                errorMessage: 'At least one reference image URL is required.',
            );
        }

        $body = $this->buildTrainingBody($siteId, $referenceImages, $opts);

        try {
            $resp = $this->http->postJson(
                self::ENDPOINT_TRAINING,
                $body,
                ['Authorization' => 'Key ' . (string) $this->apiKey()],
            );
        } catch (TransportException $e) {
            return new TrainingJob(
                status: TrainingJob::STATUS_FAILED,
                jobId: null,
                loraId: null,
                etaSeconds: null,
                costUsd: 0.0,
                errorCode: $e->errorCode,
                errorMessage: $e->getMessage(),
                meta: $e->details,
            );
        }

        $json = $resp->json ?? [];
        // fal queue submit returns: {request_id, status_url, response_url, queue_position, status}
        // TODO(provider-api-verify): verify the exact field names for queue responses
        // when a working FAL key is available; the shape above matches the public OpenAPI dump
        // but the fields used below are read defensively.
        $requestId = (string) ($json['request_id'] ?? $json['requestId'] ?? '');
        $queuePos = isset($json['queue_position']) ? (int) $json['queue_position'] : null;

        if ($requestId === '') {
            return new TrainingJob(
                status: TrainingJob::STATUS_FAILED,
                jobId: null,
                loraId: null,
                etaSeconds: null,
                costUsd: 0.0,
                errorCode: 'training.submit_failed',
                errorMessage: 'fal queue did not return a request_id.',
                meta: ['response' => $json],
            );
        }

        return new TrainingJob(
            status: TrainingJob::STATUS_SUBMITTED,
            jobId: $requestId,
            loraId: null,
            etaSeconds: $queuePos !== null ? $queuePos * 60 : null,
            costUsd: self::COST_TRAINING_USD,
            meta: [
                'site_id' => $siteId,
                'reference_count' => count($referenceImages),
                'queue_position' => $queuePos,
                'status_url' => (string) ($json['status_url'] ?? ''),
                'response_url' => (string) ($json['response_url'] ?? ''),
            ],
        );
    }

    /**
     * Poll a previously-submitted training job. When it terminates successfully
     * we persist the resulting LoRA file URL into PreferenceMemory under a
     * `lora_id` directive on the current site.
     */
    public function pollTraining(string $jobId, ?string $siteId = null): TrainingJob
    {
        if (!$this->isConfigured()) {
            return TrainingJob::unconfigured(self::ENV_VAR);
        }
        if ($jobId === '') {
            return new TrainingJob(
                status: TrainingJob::STATUS_FAILED,
                jobId: null,
                loraId: null,
                etaSeconds: null,
                costUsd: 0.0,
                errorCode: 'training.missing_job_id',
                errorMessage: 'jobId is required.',
            );
        }

        $statusUrl = self::ENDPOINT_TRAINING . '/requests/' . rawurlencode($jobId) . '/status';
        $resultUrl = self::ENDPOINT_TRAINING . '/requests/' . rawurlencode($jobId);

        try {
            $statusResp = $this->http->get($statusUrl, ['Authorization' => 'Key ' . (string) $this->apiKey()]);
        } catch (TransportException $e) {
            return new TrainingJob(
                status: TrainingJob::STATUS_FAILED,
                jobId: $jobId,
                loraId: null,
                etaSeconds: null,
                costUsd: 0.0,
                errorCode: $e->errorCode,
                errorMessage: $e->getMessage(),
            );
        }

        $sj = $statusResp->json ?? [];
        $rawStatus = (string) ($sj['status'] ?? 'IN_PROGRESS');
        // fal status uses IN_QUEUE / IN_PROGRESS / COMPLETED (and an error variant).
        // TODO(provider-api-verify): exact terminal-error sentinel.
        if (in_array($rawStatus, ['IN_QUEUE', 'IN_PROGRESS'], true)) {
            return new TrainingJob(
                status: TrainingJob::STATUS_RUNNING,
                jobId: $jobId,
                loraId: null,
                etaSeconds: isset($sj['queue_position']) ? (int) $sj['queue_position'] * 60 : null,
                costUsd: self::COST_TRAINING_USD,
                meta: ['raw_status' => $rawStatus, 'queue_position' => $sj['queue_position'] ?? null],
            );
        }

        // Terminal — fetch the result.
        try {
            $resultResp = $this->http->get($resultUrl, ['Authorization' => 'Key ' . (string) $this->apiKey()]);
        } catch (TransportException $e) {
            return new TrainingJob(
                status: TrainingJob::STATUS_FAILED,
                jobId: $jobId,
                loraId: null,
                etaSeconds: null,
                costUsd: self::COST_TRAINING_USD,
                errorCode: $e->errorCode,
                errorMessage: $e->getMessage(),
            );
        }

        $body = $resultResp->json ?? [];
        $loraUrl = (string) ($body['diffusers_lora_file']['url'] ?? '');
        if ($loraUrl === '') {
            return new TrainingJob(
                status: TrainingJob::STATUS_FAILED,
                jobId: $jobId,
                loraId: null,
                etaSeconds: null,
                costUsd: self::COST_TRAINING_USD,
                errorCode: 'training.no_lora_url',
                errorMessage: 'Training completed but no LoRA file URL was returned.',
                meta: ['response' => $body],
            );
        }

        $effectiveSiteId = $siteId ?? $this->currentSiteId();
        if ($effectiveSiteId !== null) {
            $this->persistLoraReference($effectiveSiteId, $loraUrl, $body);
        } else {
            Logger::debug('joist.flux.persist_skipped', [
                'reason' => 'preferenceMemory unavailable; cannot persist lora_id',
            ]);
        }

        return new TrainingJob(
            status: TrainingJob::STATUS_COMPLETED,
            jobId: $jobId,
            loraId: $loraUrl,
            etaSeconds: 0,
            costUsd: self::COST_TRAINING_USD,
            meta: [
                'config_file' => $body['config_file']['url'] ?? null,
                'site_id' => $effectiveSiteId,
            ],
        );
    }

    /**
     * Generate an image from a trained LoRA (or no LoRA, for bootstrap/no-brand mode).
     *
     * @param string              $loraId Empty string -> generate without LoRA reference.
     * @param array<string,mixed> $opts   Optional: 'image_size', 'num_inference_steps', 'guidance_scale', 'seed'.
     */
    public function generate(string $loraId, string $prompt, array $opts = []): ImageResult
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

        $body = $this->buildInferenceBody($loraId, $prompt, $opts);

        try {
            $resp = $this->http->postJson(
                self::ENDPOINT_INFERENCE,
                $body,
                ['Authorization' => 'Key ' . (string) $this->apiKey()],
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
        // The fal queue.submit response is either:
        //   - synchronous when sync_mode=true: {images: [{url, ...}], seed, prompt, ...}
        //   - async by default:               {request_id, status_url, response_url, ...}
        // We default to sync_mode for inference (latency budget); fall back to the
        // async shape for resilience.
        $images = (array) ($json['images'] ?? []);
        if ($images !== []) {
            $first = (array) $images[0];
            $url = (string) ($first['url'] ?? '');
            $w = (int) ($first['width'] ?? 1024);
            $h = (int) ($first['height'] ?? 1024);
            $cost = $this->estimateInferenceCost($w, $h);
            return new ImageResult(
                status: 'ok',
                provider: self::PROVIDER,
                imageUrl: $url,
                generationId: (string) ($json['seed'] ?? $json['request_id'] ?? ''),
                costUsd: $cost,
                latencyMs: $resp->durationMs,
                meta: [
                    'width' => $w,
                    'height' => $h,
                    'has_nsfw' => $json['has_nsfw_concepts'] ?? null,
                    'lora_id' => $loraId,
                ],
            );
        }

        // Async (queued) — caller will need to poll. We don't loop inside the
        // PHP request because hosting boxes (SiteGround GrowBig) cap at 120s
        // wall-clock (failure-mode constraint #20). Surface the request_id.
        $requestId = (string) ($json['request_id'] ?? '');
        if ($requestId !== '') {
            return new ImageResult(
                status: 'ok',
                provider: self::PROVIDER,
                imageUrl: null,
                generationId: $requestId,
                costUsd: 0.0,
                latencyMs: $resp->durationMs,
                meta: [
                    'queued' => true,
                    'status_url' => (string) ($json['status_url'] ?? ''),
                    'response_url' => (string) ($json['response_url'] ?? ''),
                    'lora_id' => $loraId,
                ],
            );
        }

        return new ImageResult(
            status: 'error',
            provider: self::PROVIDER,
            imageUrl: null,
            generationId: null,
            costUsd: 0.0,
            latencyMs: $resp->durationMs,
            errorCode: 'generate.unexpected_response',
            errorMessage: 'fal returned neither an images[] payload nor a queued request_id.',
            meta: ['response' => $json],
        );
    }

    /**
     * Resolve the active LoRA id for a site, reading the PreferenceMemory store.
     * Used by AssetRouter when an inbound request specifies a site_id but no
     * explicit lora_id.
     */
    public function loraIdForSite(string $siteId): ?string
    {
        if (!Container::has('preferenceMemory')) {
            return null;
        }
        try {
            $mem = Container::get('preferenceMemory');
            foreach ($mem->listActive($siteId) as $rule) {
                if (str_starts_with($rule->directive, 'lora_id:')) {
                    return trim(substr($rule->directive, strlen('lora_id:')));
                }
            }
        } catch (\Throwable $e) {
            Logger::warn('joist.flux.lora_lookup_failed', [
                'site_id' => $siteId,
                'error' => $e->getMessage(),
            ]);
        }
        return null;
    }

    /**
     * Build the fal-ai/flux-2/lora inference body. Single chokepoint so the
     * provider-shape can be fixed in one place once verified against a live key.
     *
     * @param array<string,mixed> $opts
     * @return array<string,mixed>
     */
    private function buildInferenceBody(string $loraId, string $prompt, array $opts): array
    {
        $body = [
            'prompt' => $prompt,
            'image_size' => (string) ($opts['image_size'] ?? 'landscape_4_3'),
            'num_inference_steps' => (int) ($opts['num_inference_steps'] ?? 28),
            'guidance_scale' => (float) ($opts['guidance_scale'] ?? 2.5),
            'num_images' => (int) ($opts['num_images'] ?? 1),
            'output_format' => (string) ($opts['output_format'] ?? 'png'),
            'enable_safety_checker' => (bool) ($opts['enable_safety_checker'] ?? true),
            'sync_mode' => (bool) ($opts['sync_mode'] ?? true),
        ];
        if (isset($opts['seed'])) {
            $body['seed'] = (int) $opts['seed'];
        }
        if ($loraId !== '') {
            $body['loras'] = [[
                'path' => $loraId,
                'scale' => (float) ($opts['lora_scale'] ?? 1.0),
            ]];
        }
        return $body;
    }

    /**
     * Build the fal-ai/flux-lora-fast-training body. The trainer expects a
     * single zip (images_data_url). When the caller hands us individual image
     * URLs we pass the first one through and warn — we don't try to zip
     * server-side here (that's a hosting-budget hazard; do it client-side or
     * in a separate job).
     *
     * @param list<string>        $referenceImages
     * @param array<string,mixed> $opts
     * @return array<string,mixed>
     */
    private function buildTrainingBody(string $siteId, array $referenceImages, array $opts): array
    {
        $first = (string) $referenceImages[0];
        $isZip = (bool) preg_match('/\.zip(\?|$)/i', $first);
        if (!$isZip && count($referenceImages) > 1) {
            Logger::warn('joist.flux.training_multi_url', [
                'site_id' => $siteId,
                'reference_count' => count($referenceImages),
                'note' => 'Caller passed multiple URLs but flux-lora-fast-training expects a ZIP URL. Only the first URL will be sent. Zip the references first.',
            ]);
        }

        $body = [
            'images_data_url' => $first,
            'trigger_word' => (string) ($opts['trigger_word'] ?? 'joistsite'),
            'steps' => (int) ($opts['steps'] ?? 1000),
            'is_style' => (bool) ($opts['is_style'] ?? false),
        ];
        if (isset($opts['create_masks'])) {
            $body['create_masks'] = (bool) $opts['create_masks'];
        }
        return $body;
    }

    private function persistLoraReference(string $siteId, string $loraUrl, array $rawResponse): void
    {
        if (!Container::has('preferenceMemory')) {
            Logger::debug('joist.flux.persist_skipped', ['reason' => 'no preferenceMemory in Container']);
            return;
        }
        try {
            $mem = Container::get('preferenceMemory');
            $rule = Rule::create(
                siteId: $siteId,
                kind: Rule::KIND_STRUCTURAL,
                pattern: 'flux_lora',
                directive: 'lora_id: ' . $loraUrl,
                provenance: [
                    'source' => 'flux_lora_training',
                    'config_file' => (string) ($rawResponse['config_file']['url'] ?? ''),
                ],
                scope: 'global',
                confidence: 1.0,
            );
            $mem->add($rule);
            Logger::info('joist.flux.lora_persisted', [
                'site_id' => $siteId,
                'lora_id' => $loraUrl,
            ]);
        } catch (\Throwable $e) {
            Logger::warn('joist.flux.persist_failed', [
                'site_id' => $siteId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function estimateInferenceCost(int $width, int $height): float
    {
        $megapixels = max(0.25, ($width * $height) / 1_000_000);
        return round($megapixels * self::COST_PER_MEGAPIXEL_USD, 4);
    }

    private function currentSiteId(): ?string
    {
        if (!Container::has('preferenceMemory')) return null;
        try {
            return Container::get('preferenceMemory')->siteId();
        } catch (\Throwable) {
            return null;
        }
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
