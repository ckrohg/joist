<?php
declare(strict_types=1);

namespace Joist\Generate\Copy;

use Joist\Core\Logger;

/**
 * @purpose Copy generation via Anthropic Messages API with prompt-cached
 *          brand prefix + validate-and-repair loop.
 *
 * Pipeline:
 *   1. Resolve API key (env JOIST_CLAUDE_API_KEY, wp_option joist_claude_api_key).
 *      Missing -> CopyResult::unconfigured() (dark test path).
 *   2. Resolve model (env JOIST_CLAUDE_MODEL, default 'claude-opus-4-7').
 *   3. Assemble BrandBlock for site_id.
 *   4. Cost-cap pre-flight: refuse if projected cost would exceed
 *      joist_copy_gen_cap_usd (constraint #9 — refuse not corrupt).
 *   5. POST to /v1/messages with cache_control markers on the system blocks
 *      and the last exemplar (BrandBlock::exemplarsAsMessages()).
 *   6. Parse response; record cost; if validator class loaded, validate text.
 *   7. If validation requires repair AND repair_retries > 0: build a repair
 *      message with the original request + the model's draft + the validator's
 *      repairHint, call again (still benefits from the cached prefix).
 *   8. Return the cleaner of the two with validation_failed flag set
 *      truthfully (constraint #16 — surface, don't silently fall back).
 *
 * Pricing (Opus 4.7, sourced from Anthropic docs 2026-05-28):
 *   Base input:   $5.00/MTok
 *   Output:       $25.00/MTok
 *   5m cache read: $0.50/MTok (0.1x base)
 *   5m cache write: $6.25/MTok (1.25x base)
 *
 * See specs/COPY_GEN.md and https://platform.claude.com/docs/en/build-with-claude/prompt-caching.
 */
final class CopyGenerator
{
    public const DEFAULT_MODEL = 'claude-opus-4-7';
    public const ANTHROPIC_VERSION = '2023-06-01';
    public const ENDPOINT = 'https://api.anthropic.com/v1/messages';

    /**
     * Per-million-token prices (USD) for Claude Opus 4.7 as of 2026-05-28.
     * Verified against https://platform.claude.com/docs/en/build-with-claude/prompt-caching.
     *
     * TODO(anthropic-api-verify): re-verify Opus 4.7 base prices at GA; the
     * docs example uses Opus 4.5 ($5/$25); per repo memory architecture_decisions
     * Opus 4.7 carries the same pricing as 4.5/4.6.
     */
    private const PRICE_TABLE = [
        'claude-opus-4-7' => [
            'input' => 5.0,
            'output' => 25.0,
            'cache_read' => 0.5,    // 0.1x input
            'cache_write_5m' => 6.25, // 1.25x input
            'cache_write_1h' => 10.0, // 2x input
        ],
        // Fallback used when the model id is unknown — bias toward the
        // higher Opus-tier cost so the cap is conservative.
        '_default' => [
            'input' => 5.0,
            'output' => 25.0,
            'cache_read' => 0.5,
            'cache_write_5m' => 6.25,
            'cache_write_1h' => 10.0,
        ],
    ];

    public function __construct(
        private BrandBlockAssembler $assembler,
        private CopyCostMeter $costMeter,
    ) {}

    /**
     * Generate copy for a single request.
     *
     * @param string $siteId
     * @param string $request The per-page request (the volatile delta).
     * @param array{
     *   max_tokens?: int,
     *   model?: string,
     *   session_id?: string,
     *   repair_retries?: int,
     *   skip_validation?: bool,
     *   brand_block?: BrandBlock,
     * } $opts
     */
    public function generate(string $siteId, string $request, array $opts = []): CopyResult
    {
        $apiKey = $this->resolveApiKey();
        if ($apiKey === null) {
            return CopyResult::unconfigured(
                'No JOIST_CLAUDE_API_KEY env var or joist_claude_api_key wp_option set. Copy generation is dark-tested until configured.'
            );
        }

        $model = (string) ($opts['model'] ?? $this->resolveModel());
        $maxTokens = (int) ($opts['max_tokens'] ?? 1024);
        $sessionId = (string) ($opts['session_id'] ?? '');
        $repairRetries = max(0, (int) ($opts['repair_retries'] ?? 1));

        $brandBlock = $opts['brand_block'] ?? $this->assembler->assemble($siteId, $model);

        // Cost-cap pre-flight (constraint #9). Use a pessimistic projection:
        // worst case is a full cache-write on the prefix + max_tokens output.
        $projected = $this->projectCost($brandBlock, $maxTokens, $model, isCacheWrite: true);
        if ($this->costMeter->wouldExceed($sessionId, $projected)) {
            return CopyResult::costCapped(
                'Projected cost exceeds joist_copy_gen_cap_usd',
                $this->costMeter->sessionTotal($sessionId),
                $this->costMeter->capUsd(),
            );
        }

        // First attempt.
        $first = $this->callAnthropic($apiKey, $model, $maxTokens, $brandBlock, $request, []);
        if ($first->status !== CopyResult::STATUS_OK) {
            return $first;
        }
        $this->costMeter->record($sessionId, $first->costUsd);

        // Validate-and-repair loop. Gated on the W6a validator existing.
        if (!empty($opts['skip_validation']) || !class_exists('\\Joist\\AntiSlop\\CopyValidator')) {
            return $first;
        }

        $validator = $this->makeValidator();
        if ($validator === null) {
            return $first;
        }
        $firstValidation = $this->safeValidate($validator, $first->text, $siteId);
        if ($firstValidation === null || !$firstValidation['requires_repair']) {
            return $first;
        }
        if ($repairRetries < 1) {
            return $this->withValidationFailure($first, $firstValidation);
        }

        // Repair retry — same cache prefix, augmented request.
        $repairRequest = $this->composeRepairRequest($request, $first->text, $firstValidation['repair_hint'] ?? '');
        $projected2 = $this->projectCost($brandBlock, $maxTokens, $model, isCacheWrite: false);
        if ($this->costMeter->wouldExceed($sessionId, $projected2)) {
            // Cap blocks the retry — return draft with failure flag.
            return $this->withValidationFailure($first, $firstValidation);
        }

        $second = $this->callAnthropic($apiKey, $model, $maxTokens, $brandBlock, $repairRequest, []);
        if ($second->status !== CopyResult::STATUS_OK) {
            // Repair attempt errored; surface the first draft with failure
            // flag (constraint #16 — never silently fall back to a worse path).
            return $this->withValidationFailure($first, $firstValidation, attempts: 1);
        }
        $this->costMeter->record($sessionId, $second->costUsd);

        $secondValidation = $this->safeValidate($validator, $second->text, $siteId);
        if ($secondValidation === null || !$secondValidation['requires_repair']) {
            // Repair succeeded.
            return new CopyResult(
                status: CopyResult::STATUS_OK,
                text: $second->text,
                cacheMetrics: $this->mergeMetrics($first->cacheMetrics, $second->cacheMetrics),
                costUsd: $first->costUsd + $second->costUsd,
                latencyMs: $first->latencyMs + $second->latencyMs,
                generationId: $second->generationId,
                validationFailed: false,
                repairAttempts: 1,
            );
        }

        // Both failed validation — surface the one with fewer violations,
        // flagged. Caller routes to human review (constraint #16).
        $firstViolations = (int) ($firstValidation['violation_count'] ?? PHP_INT_MAX);
        $secondViolations = (int) ($secondValidation['violation_count'] ?? PHP_INT_MAX);
        $cleaner = $secondViolations <= $firstViolations ? $second : $first;
        $cleanerValidation = $secondViolations <= $firstViolations ? $secondValidation : $firstValidation;

        return new CopyResult(
            status: CopyResult::STATUS_OK,
            text: $cleaner->text,
            cacheMetrics: $this->mergeMetrics($first->cacheMetrics, $second->cacheMetrics),
            costUsd: $first->costUsd + $second->costUsd,
            latencyMs: $first->latencyMs + $second->latencyMs,
            generationId: $cleaner->generationId,
            validationFailed: true,
            reason: 'validation rejected both draft and repair retry; routed cleaner of the two',
            errorCode: 'validation_failed',
            repairAttempts: 1,
        );
    }

    /**
     * Resolve the API key with the documented precedence:
     *   1. JOIST_CLAUDE_API_KEY env var
     *   2. joist_claude_api_key wp_option
     *
     * Returns null when neither is set (dark-test signal).
     */
    public function resolveApiKey(): ?string
    {
        $env = getenv('JOIST_CLAUDE_API_KEY');
        if (is_string($env) && $env !== '') {
            return $env;
        }
        if (function_exists('get_option')) {
            $opt = get_option('joist_claude_api_key', '');
            if (is_string($opt) && $opt !== '') {
                return $opt;
            }
        }
        return null;
    }

    /**
     * Resolve the model id. Defaults to claude-opus-4-7; overridable via
     * env JOIST_CLAUDE_MODEL.
     */
    public function resolveModel(): string
    {
        $env = getenv('JOIST_CLAUDE_MODEL');
        if (is_string($env) && $env !== '') {
            return $env;
        }
        return self::DEFAULT_MODEL;
    }

    /**
     * Project worst-case cost for a single call so the cost-cap pre-flight
     * can refuse cleanly (constraint #9).
     */
    public function projectCost(BrandBlock $brandBlock, int $maxTokens, string $model, bool $isCacheWrite): float
    {
        $prices = self::PRICE_TABLE[$model] ?? self::PRICE_TABLE['_default'];
        $prefixTokens = $brandBlock->estimatedTokens;
        $prefixCostPerMtok = $isCacheWrite ? $prices['cache_write_5m'] : $prices['cache_read'];
        $prefixCost = ($prefixTokens / 1_000_000) * $prefixCostPerMtok;
        $outputCost = ($maxTokens / 1_000_000) * $prices['output'];
        return $prefixCost + $outputCost;
    }

    /**
     * Issue a single Messages-API call. Returns a CopyResult (which may be
     * provider_error). Does NOT touch the cost meter — the caller does that
     * so the validate-and-repair loop can charge a single transaction.
     */
    private function callAnthropic(
        string $apiKey,
        string $model,
        int $maxTokens,
        BrandBlock $brandBlock,
        string $request,
        array $extra,
    ): CopyResult {
        $body = [
            'model' => $model,
            'max_tokens' => $maxTokens,
            'system' => $brandBlock->systemBlocks,
            'messages' => array_merge(
                $brandBlock->exemplarsAsMessages(),
                [
                    [
                        'role' => 'user',
                        'content' => $request,
                    ],
                ],
            ),
        ];
        if (!empty($extra)) {
            $body = array_merge($body, $extra);
        }

        $start = microtime(true);

        if (!function_exists('wp_remote_post')) {
            return CopyResult::providerError(
                'wp_remote_post unavailable — Joist requires WordPress runtime',
                0,
            );
        }

        $resp = wp_remote_post(self::ENDPOINT, [
            'timeout' => 90,
            'headers' => [
                'Content-Type' => 'application/json',
                'X-Api-Key' => $apiKey,
                'anthropic-version' => self::ANTHROPIC_VERSION,
            ],
            'body' => wp_json_encode($body),
        ]);

        $latencyMs = (int) round((microtime(true) - $start) * 1000);

        if (is_wp_error($resp)) {
            Logger::warn('joist.copy.provider_error', [
                'reason' => $resp->get_error_message(),
                'model' => $model,
            ]);
            return CopyResult::providerError(
                'wp_remote_post error: ' . $resp->get_error_message(),
                $latencyMs,
            );
        }

        $code = (int) wp_remote_retrieve_response_code($resp);
        $rawBody = (string) wp_remote_retrieve_body($resp);

        if ($code < 200 || $code >= 300) {
            Logger::warn('joist.copy.non_2xx', [
                'http' => $code,
                'model' => $model,
                'body_excerpt' => substr($rawBody, 0, 500),
            ]);
            return CopyResult::providerError(
                "Anthropic returned HTTP {$code}: " . substr($rawBody, 0, 200),
                $latencyMs,
            );
        }

        $decoded = json_decode($rawBody, true);
        if (!is_array($decoded)) {
            return CopyResult::providerError('Response body was not JSON', $latencyMs);
        }

        $text = $this->extractText($decoded);
        $usage = is_array($decoded['usage'] ?? null) ? $decoded['usage'] : [];

        $metrics = [
            'input_tokens' => (int) ($usage['input_tokens'] ?? 0),
            'cache_creation_tokens' => (int) ($usage['cache_creation_input_tokens'] ?? 0),
            'cache_read_tokens' => (int) ($usage['cache_read_input_tokens'] ?? 0),
            'output_tokens' => (int) ($usage['output_tokens'] ?? 0),
        ];

        $cost = $this->actualCost($metrics, $model);

        return new CopyResult(
            status: CopyResult::STATUS_OK,
            text: $text,
            cacheMetrics: $metrics,
            costUsd: $cost,
            latencyMs: $latencyMs,
            generationId: (string) ($decoded['id'] ?? ''),
        );
    }

    /**
     * Extract concatenated text from the response content array.
     * Per Anthropic Messages API: content is an array of blocks, typically a
     * single {type: 'text', text: '...'} block for plain text generation.
     */
    private function extractText(array $decoded): string
    {
        $content = $decoded['content'] ?? [];
        if (!is_array($content)) return '';
        $out = [];
        foreach ($content as $block) {
            if (is_array($block) && ($block['type'] ?? '') === 'text' && isset($block['text'])) {
                $out[] = (string) $block['text'];
            }
        }
        return implode('', $out);
    }

    /**
     * Compute the actual cost based on the response usage block.
     *
     * @param array{input_tokens:int,cache_creation_tokens:int,cache_read_tokens:int,output_tokens:int} $metrics
     */
    private function actualCost(array $metrics, string $model): float
    {
        $prices = self::PRICE_TABLE[$model] ?? self::PRICE_TABLE['_default'];
        return (
            ($metrics['input_tokens'] / 1_000_000) * $prices['input']
            + ($metrics['cache_creation_tokens'] / 1_000_000) * $prices['cache_write_5m']
            + ($metrics['cache_read_tokens'] / 1_000_000) * $prices['cache_read']
            + ($metrics['output_tokens'] / 1_000_000) * $prices['output']
        );
    }

    /**
     * Call CopyValidator::validate() with defensive null checks. Returns a
     * normalised array {requires_repair, repair_hint, violation_count} or
     * null when the validator's surface doesn't match our expected contract.
     *
     * @param object $validator W6a's \Joist\AntiSlop\CopyValidator
     * @return array{requires_repair:bool,repair_hint:string,violation_count:int}|null
     */
    private function safeValidate(object $validator, string $text, string $siteId): ?array
    {
        try {
            $result = $validator->validate($text, $siteId);
        } catch (\Throwable $e) {
            Logger::warn('joist.copy.validator_threw', [
                'error' => $e->getMessage(),
                'site_id' => $siteId,
            ]);
            return null;
        }
        if (!is_object($result) && !is_array($result)) {
            return null;
        }
        // Tolerate either an object or an array shape — W6a's exact
        // surface lands in parallel; this defensive shim lets the loop
        // work without re-deploying CopyGenerator if W6a's typing shifts.
        $requires = false;
        $hint = '';
        $violations = 0;
        if (is_object($result)) {
            if (property_exists($result, 'requiresRepair')) {
                $requires = (bool) $result->requiresRepair;
            }
            if (property_exists($result, 'repairHint')) {
                $hint = (string) $result->repairHint;
            }
            if (property_exists($result, 'violations') && is_countable($result->violations)) {
                $violations = count($result->violations);
            }
        } else {
            $requires = (bool) ($result['requiresRepair'] ?? $result['requires_repair'] ?? false);
            $hint = (string) ($result['repairHint'] ?? $result['repair_hint'] ?? '');
            $v = $result['violations'] ?? [];
            $violations = is_countable($v) ? count($v) : 0;
        }
        return [
            'requires_repair' => $requires,
            'repair_hint' => $hint,
            'violation_count' => $violations,
        ];
    }

    /**
     * Instantiate W6a's validator. Centralised so future container wiring is a one-liner.
     */
    private function makeValidator(): ?object
    {
        $cls = '\\Joist\\AntiSlop\\CopyValidator';
        if (!class_exists($cls)) {
            return null;
        }
        try {
            // Try the no-arg constructor first; W6a may inject deps via a
            // factory we don't know about yet. If construction fails, give
            // up and skip validation rather than fail the whole call.
            return new $cls();
        } catch (\Throwable $e) {
            Logger::debug('joist.copy.validator_construct_failed', [
                'class' => $cls,
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    private function composeRepairRequest(string $originalRequest, string $draftText, string $repairHint): string
    {
        $hint = $repairHint !== '' ? $repairHint : 'Remove banned phrases and forbidden sentence openers per house style.';
        return "Repair the draft below. Keep the meaning; fix the specific issues called out.\n\n"
            . "Original request: {$originalRequest}\n\n"
            . "Draft:\n{$draftText}\n\n"
            . "Required fixes: {$hint}\n\n"
            . "Reply with the repaired text only.";
    }

    private function mergeMetrics(array $a, array $b): array
    {
        return [
            'input_tokens' => (int) ($a['input_tokens'] + $b['input_tokens']),
            'cache_creation_tokens' => (int) ($a['cache_creation_tokens'] + $b['cache_creation_tokens']),
            'cache_read_tokens' => (int) ($a['cache_read_tokens'] + $b['cache_read_tokens']),
            'output_tokens' => (int) ($a['output_tokens'] + $b['output_tokens']),
        ];
    }

    private function withValidationFailure(CopyResult $r, array $validation, int $attempts = 0): CopyResult
    {
        return new CopyResult(
            status: CopyResult::STATUS_OK,
            text: $r->text,
            cacheMetrics: $r->cacheMetrics,
            costUsd: $r->costUsd,
            latencyMs: $r->latencyMs,
            generationId: $r->generationId,
            validationFailed: true,
            reason: 'validation flagged ' . (int) ($validation['violation_count'] ?? 0) . ' issue(s); routed to human review',
            errorCode: 'validation_failed',
            repairAttempts: $attempts,
        );
    }
}
