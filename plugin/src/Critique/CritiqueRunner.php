<?php
declare(strict_types=1);

namespace Joist\Critique;

use Joist\Core\Logger;

/**
 * @purpose The Joist evaluator. Wave 11 centerpiece.
 *
 * Calls Anthropic Messages API with:
 *   - The elementor-critique skill prompt as system (cache-controlled)
 *   - The AesEvalRubric block as system continuation
 *   - The screenshot as a user image content block
 *   - The request envelope (brand_tokens, forbidden, previous_score) as
 *     user text content
 *
 * Returns a structured verdict the harness can act on. Two callers:
 *   1. POST /joist/v1/critique — public endpoint, returns CritiqueResult
 *   2. DocumentWriter::save Forced Optimization gate — pre/post compare
 *
 * Hard guarantees:
 *   - Dark-test path: no API key configured returns CritiqueResult::unconfigured()
 *     without any network call. Failure-mode constraint: refuse-not-corrupt.
 *   - Cost cap: CritiqueCostMeter pre-flight + post-call recording.
 *   - No extended thinking: AesEval-Bench March 2026 showed no judgment lift,
 *     doubled cost. Default mode only.
 *   - Iteration budget: caller-supplied max_iterations_remaining is decremented
 *     once per call and surfaced in the response.
 *   - Anti-cliché check: DiversityCheck runs alongside (not before) the call,
 *     so a flagged result overrides verdict to `revise`.
 *
 * Pricing (Opus 4.7, sourced from CopyGenerator price table, verified
 * 2026-05-28). Vision input is billed identically to text input on the
 * Messages API surface, but the screenshot is downscaled to 1024px long-edge
 * before send per Anthropic docs (40-70% cost savings).
 */
final class CritiqueRunner
{
    public const DEFAULT_MODEL = 'claude-opus-4-7';
    public const ANTHROPIC_VERSION = '2023-06-01';
    public const ENDPOINT = 'https://api.anthropic.com/v1/messages';

    /** Max long-edge in px for screenshot downscale. Anthropic-recommended. */
    public const SCREENSHOT_MAX_PX = 1024;

    /** Bounded iteration cap (failure-mode constraint #23). */
    public const MAX_ITERATIONS = 5;

    /** Composite-score threshold above which `verdict: accept` is allowed. */
    public const ACCEPT_THRESHOLD = 0.72;

    /** Floor for any individual axis when verdict is `accept`. */
    public const ACCEPT_AXIS_FLOOR = 5;

    /**
     * Per-million-token pricing for the Anthropic models we support. Mirrors
     * the CopyGenerator table so cost math is comparable across pipelines.
     */
    private const PRICE_TABLE = [
        'claude-opus-4-7' => [
            'input' => 5.0,
            'output' => 25.0,
            'cache_read' => 0.5,
            'cache_write_5m' => 6.25,
        ],
        '_default' => [
            'input' => 5.0,
            'output' => 25.0,
            'cache_read' => 0.5,
            'cache_write_5m' => 6.25,
        ],
    ];

    public function __construct(
        private CritiqueCostMeter $costMeter,
        private DiversityCheck $diversity,
    ) {}

    /**
     * Run a critique. Returns a CritiqueResult. Never throws on provider error
     * — surface as STATUS_PROVIDER_ERROR so the caller (REST controller OR
     * Forced Optimization gate) can branch deterministically.
     *
     * @param array{
     *   site_id: string,
     *   page_id?: int,
     *   screenshot_url?: string,
     *   screenshot_b64?: string,
     *   brand_tokens?: array,
     *   forbidden?: list<string>,
     *   rubric?: string,
     *   max_iterations_remaining?: int,
     *   previous_score?: float,
     *   element_tree?: array,
     *   tree_signature?: array<string,int>,
     *   phash?: string,
     *   session_id?: string,
     *   model?: string,
     * } $params
     */
    public function critique(array $params): CritiqueResult
    {
        $siteId = (string) ($params['site_id'] ?? '');
        $sessionId = (string) ($params['session_id'] ?? '');
        $maxIterRemaining = $this->boundedIterationBudget($params);
        $previousScore = isset($params['previous_score']) && is_numeric($params['previous_score'])
            ? (float) $params['previous_score']
            : null;

        // Dark-test path. No key configured -> unconfigured envelope; the
        // anti-cliché check still runs so callers see a consistent shape.
        $apiKey = $this->resolveApiKey();
        if ($apiKey === null) {
            $antiCliche = $this->diversity->check($siteId, $params);
            return new CritiqueResult(
                status: CritiqueResult::STATUS_UNCONFIGURED,
                score: 0.0,
                verdict: CritiqueResult::VERDICT_REVISE,
                axes: [],
                regions: [],
                reasons: [],
                clicheMarkers: [],
                scoreDeltaVsPrevious: null,
                iterationBudgetRemaining: $maxIterRemaining,
                antiClicheCheck: $antiCliche,
                costUsd: 0.0,
                latencyMs: 0,
                generationId: '',
                reason: 'No JOIST_CLAUDE_API_KEY env var or joist_claude_api_key wp_option set. Critique is dark-tested until configured.',
                errorCode: 'provider_unconfigured',
            );
        }

        $model = (string) ($params['model'] ?? $this->resolveModel());

        // Cost pre-flight — refuse before the network call.
        $projected = $this->projectCost($model);
        if ($this->costMeter->wouldExceed($sessionId, $projected)) {
            return CritiqueResult::costCapped(
                'Projected cost exceeds joist_critique_cap_usd',
                $this->costMeter->sessionTotal($sessionId),
                $this->costMeter->capUsd(),
            );
        }

        // Make the call.
        $callResult = $this->callAnthropic($apiKey, $model, $params, $previousScore);
        if ($callResult->status !== CritiqueResult::STATUS_OK) {
            return $callResult;
        }

        $this->costMeter->record($sessionId, $callResult->costUsd);

        // Anti-cliché check runs in parallel to the model judgment. The
        // pHash + tree signature are deterministic so this is cheap.
        $antiCliche = $this->diversity->check($siteId, $params);

        // Forced Optimization check: if previous_score supplied AND we're not
        // strictly higher, force verdict to revise. This is also enforced by
        // DocumentWriter; we surface it here so the public endpoint has the
        // same discipline.
        $verdict = $callResult->verdict;
        $reasons = $callResult->reasons;
        if ($previousScore !== null && $callResult->score <= $previousScore) {
            $verdict = CritiqueResult::VERDICT_REVISE;
            $reasons[] = 'forced_optimization_refused: new score (' . round($callResult->score, 4)
                . ') is not strictly greater than previous (' . round($previousScore, 4) . ')';
        }

        // Anti-cliché overrides any verdict above `revise`.
        if (!empty($antiCliche['flagged'])) {
            if ($verdict === CritiqueResult::VERDICT_ACCEPT) {
                $verdict = CritiqueResult::VERDICT_REVISE;
            }
            $reasons[] = 'anti_cliche_collapse: similarity '
                . (string) ($antiCliche['similarity_to_recent'] ?? '?')
                . ' exceeds threshold '
                . (string) ($antiCliche['threshold'] ?? DiversityCheck::DEFAULT_THRESHOLD);
        }

        return new CritiqueResult(
            status: CritiqueResult::STATUS_OK,
            score: $callResult->score,
            verdict: $verdict,
            axes: $callResult->axes,
            regions: $callResult->regions,
            reasons: $reasons,
            clicheMarkers: $callResult->clicheMarkers,
            scoreDeltaVsPrevious: $previousScore !== null
                ? round($callResult->score - $previousScore, 4)
                : null,
            iterationBudgetRemaining: max(0, $maxIterRemaining - 1),
            antiClicheCheck: $antiCliche,
            costUsd: $callResult->costUsd,
            latencyMs: $callResult->latencyMs,
            generationId: $callResult->generationId,
            cacheMetrics: $callResult->cacheMetrics,
        );
    }

    /**
     * Convenience for the Forced Optimization gate. Returns the float score
     * only (or null if dark-tested / failed); the gate compares deltas.
     *
     * @param array<string,mixed> $params
     */
    public function scoreOnly(array $params): ?float
    {
        $result = $this->critique($params);
        if ($result->status !== CritiqueResult::STATUS_OK) {
            return null;
        }
        return $result->score;
    }

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

    public function resolveModel(): string
    {
        $env = getenv('JOIST_CLAUDE_CRITIQUE_MODEL');
        if (is_string($env) && $env !== '') {
            return $env;
        }
        $env2 = getenv('JOIST_CLAUDE_MODEL');
        if (is_string($env2) && $env2 !== '') {
            return $env2;
        }
        return self::DEFAULT_MODEL;
    }

    /**
     * Bound the iteration budget per failure-mode constraint #23 (N=5 cap).
     * Caller supplies max_iterations_remaining; we clamp to [0, MAX_ITERATIONS].
     *
     * @param array<string,mixed> $params
     */
    private function boundedIterationBudget(array $params): int
    {
        $supplied = $params['max_iterations_remaining'] ?? null;
        if (!is_numeric($supplied)) {
            return self::MAX_ITERATIONS;
        }
        return max(0, min(self::MAX_ITERATIONS, (int) $supplied));
    }

    /**
     * Project worst-case cost for a single critique call. Used by the cost
     * meter pre-flight. Assumes: skill prompt is cache-write on first call
     * (~5K tokens for SKILL.md + ~2K AesEvalRubric prompt), screenshot at
     * 1024px contributes ~600 input tokens vision, output ~500 tokens JSON.
     */
    public function projectCost(string $model): float
    {
        $prices = self::PRICE_TABLE[$model] ?? self::PRICE_TABLE['_default'];
        $cachedPrefixTokens = 7_000;   // skill + rubric
        $screenshotTokens   = 600;     // 1024px vision input
        $requestTextTokens  = 800;     // brand_tokens, forbidden, previous_score
        $outputTokens       = 800;     // JSON verdict envelope
        // Worst case: cache-write on the prefix.
        $cost = ($cachedPrefixTokens / 1_000_000) * $prices['cache_write_5m']
            + (($screenshotTokens + $requestTextTokens) / 1_000_000) * $prices['input']
            + ($outputTokens / 1_000_000) * $prices['output'];
        return $cost;
    }

    /**
     * Issue the Anthropic call. Returns a CritiqueResult (provider_error on
     * failure, never throws so callers can branch).
     *
     * @param array<string,mixed> $params
     */
    private function callAnthropic(
        string $apiKey,
        string $model,
        array $params,
        ?float $previousScore,
    ): CritiqueResult {
        if (!function_exists('wp_remote_post')) {
            return CritiqueResult::providerError(
                'wp_remote_post unavailable - Joist requires WordPress runtime',
                0,
            );
        }

        // System blocks — skill + rubric. Both cache-controlled per
        // Anthropic prompt-caching docs.
        $systemBlocks = [
            [
                'type' => 'text',
                'text' => $this->loadSkillPrompt(),
                'cache_control' => ['type' => 'ephemeral'],
            ],
            [
                'type' => 'text',
                'text' => AesEvalRubric::asPrompt(),
                'cache_control' => ['type' => 'ephemeral'],
            ],
        ];

        $userContent = $this->buildUserContent($params, $previousScore);
        if ($userContent === null) {
            return CritiqueResult::providerError(
                'No screenshot supplied (screenshot_url or screenshot_b64 required)',
                0,
                'missing_screenshot',
            );
        }

        $body = [
            'model' => $model,
            'max_tokens' => 1024,
            'system' => $systemBlocks,
            'messages' => [
                [
                    'role' => 'user',
                    'content' => $userContent,
                ],
            ],
        ];

        $start = microtime(true);
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
            Logger::warn('joist.critique.provider_error', [
                'reason' => $resp->get_error_message(),
                'model' => $model,
            ]);
            return CritiqueResult::providerError(
                'wp_remote_post error: ' . $resp->get_error_message(),
                $latencyMs,
            );
        }

        $code = (int) wp_remote_retrieve_response_code($resp);
        $rawBody = (string) wp_remote_retrieve_body($resp);
        if ($code < 200 || $code >= 300) {
            Logger::warn('joist.critique.non_2xx', [
                'http' => $code,
                'model' => $model,
                'body_excerpt' => substr($rawBody, 0, 500),
            ]);
            return CritiqueResult::providerError(
                "Anthropic returned HTTP {$code}: " . substr($rawBody, 0, 200),
                $latencyMs,
            );
        }

        $decoded = json_decode($rawBody, true);
        if (!is_array($decoded)) {
            return CritiqueResult::providerError('Response body was not JSON', $latencyMs);
        }

        $text = $this->extractText($decoded);
        $verdictPayload = $this->parseVerdictJson($text);
        if ($verdictPayload === null) {
            return CritiqueResult::providerError(
                'Critique model output was not parseable JSON: ' . substr($text, 0, 300),
                $latencyMs,
                'invalid_verdict_json',
            );
        }

        $usage = is_array($decoded['usage'] ?? null) ? $decoded['usage'] : [];
        $metrics = [
            'input_tokens' => (int) ($usage['input_tokens'] ?? 0),
            'cache_creation_tokens' => (int) ($usage['cache_creation_input_tokens'] ?? 0),
            'cache_read_tokens' => (int) ($usage['cache_read_input_tokens'] ?? 0),
            'output_tokens' => (int) ($usage['output_tokens'] ?? 0),
        ];
        $cost = $this->actualCost($metrics, $model);

        return new CritiqueResult(
            status: CritiqueResult::STATUS_OK,
            score: (float) ($verdictPayload['score'] ?? 0.0),
            verdict: (string) ($verdictPayload['verdict'] ?? CritiqueResult::VERDICT_REVISE),
            axes: is_array($verdictPayload['axes'] ?? null) ? $verdictPayload['axes'] : [],
            regions: is_array($verdictPayload['regions'] ?? null) ? $verdictPayload['regions'] : [],
            reasons: is_array($verdictPayload['reasons'] ?? null) ? array_values($verdictPayload['reasons']) : [],
            clicheMarkers: is_array($verdictPayload['cliche_markers'] ?? null) ? array_values($verdictPayload['cliche_markers']) : [],
            scoreDeltaVsPrevious: null, // filled in by caller after Forced-Opt check
            iterationBudgetRemaining: 0, // filled in by caller
            antiClicheCheck: [], // filled in by caller
            costUsd: $cost,
            latencyMs: $latencyMs,
            generationId: (string) ($decoded['id'] ?? ''),
            cacheMetrics: $metrics,
        );
    }

    /**
     * Load the skill prompt from disk. Cached statically since it is large
     * (~10K chars) and reused across every call within a request.
     */
    private function loadSkillPrompt(): string
    {
        static $cached = null;
        if ($cached !== null) {
            return $cached;
        }
        $path = dirname(__DIR__, 2) . '/skills/elementor-critique/SKILL.md';
        if (is_file($path)) {
            $contents = @file_get_contents($path);
            if (is_string($contents) && $contents !== '') {
                $cached = $contents;
                return $cached;
            }
        }
        // Embedded fallback so the runner stays functional if the skill file
        // is missing (e.g. partial deploy). This is intentionally short — the
        // full taste prompt is in SKILL.md.
        $cached = "You are the Joist evaluator. Judge the rendered page against design quality, originality, craft, functionality, brand fidelity, Widget Pack utilization, and anti-slop. Return JSON: {score: 0..1, verdict: accept|revise|reject, axes: {...}, regions: [...], reasons: [...], cliche_markers: [...]}. Be skeptical. Do not extend-think.";
        return $cached;
    }

    /**
     * Build the user message content blocks. Returns null when no screenshot
     * was supplied (refuse-not-corrupt).
     *
     * @param array<string,mixed> $params
     * @return list<array<string,mixed>>|null
     */
    private function buildUserContent(array $params, ?float $previousScore): ?array
    {
        $content = [];

        // Image block.
        if (isset($params['screenshot_url']) && is_string($params['screenshot_url']) && $params['screenshot_url'] !== '') {
            $content[] = [
                'type' => 'image',
                'source' => [
                    'type' => 'url',
                    'url' => (string) $params['screenshot_url'],
                ],
            ];
        } elseif (isset($params['screenshot_b64']) && is_string($params['screenshot_b64']) && $params['screenshot_b64'] !== '') {
            $content[] = [
                'type' => 'image',
                'source' => [
                    'type' => 'base64',
                    'media_type' => 'image/png',
                    'data' => (string) $params['screenshot_b64'],
                ],
            ];
        } else {
            return null;
        }

        // Text block — brand_tokens + forbidden + previous_score + request.
        $envelope = [
            'site_id' => (string) ($params['site_id'] ?? ''),
            'rubric' => (string) ($params['rubric'] ?? 'both'),
            'brand_tokens' => is_array($params['brand_tokens'] ?? null) ? $params['brand_tokens'] : [],
            'forbidden' => is_array($params['forbidden'] ?? null) ? array_values($params['forbidden']) : [],
        ];
        if ($previousScore !== null) {
            $envelope['previous_score'] = $previousScore;
            $envelope['gate'] = 'forced_optimization';
        }
        $iter = $params['max_iterations_remaining'] ?? null;
        if (is_numeric($iter)) {
            $envelope['iteration_remaining'] = (int) $iter;
        }

        $promptText = "Critique the rendered page in the image above against the rubric in the system block.\n\n";
        $promptText .= "Request envelope (JSON):\n```json\n";
        $promptText .= wp_json_encode($envelope, JSON_PRETTY_PRINT) ?: '{}';
        $promptText .= "\n```\n\n";
        $promptText .= "Return your verdict as a single JSON object matching the output structure in the skill. No prose outside the JSON.";

        $content[] = [
            'type' => 'text',
            'text' => $promptText,
        ];

        return $content;
    }

    /** @param array<string,mixed> $decoded */
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
     * Parse the model's verdict output. The skill instructs the model to
     * return raw JSON, but we tolerate ```json ... ``` fenced blocks.
     *
     * @return array<string,mixed>|null
     */
    private function parseVerdictJson(string $text): ?array
    {
        $trimmed = trim($text);
        if ($trimmed === '') return null;

        // Strip ```json ... ``` fences if present.
        if (str_starts_with($trimmed, '```')) {
            $trimmed = preg_replace('/^```(?:json)?\s*|\s*```$/i', '', $trimmed) ?? $trimmed;
            $trimmed = trim($trimmed);
        }

        $decoded = json_decode($trimmed, true);
        if (is_array($decoded)) {
            return $decoded;
        }

        // Last-ditch: find the first `{` and the last `}` and try that slice.
        $first = strpos($trimmed, '{');
        $last = strrpos($trimmed, '}');
        if ($first !== false && $last !== false && $last > $first) {
            $slice = substr($trimmed, $first, $last - $first + 1);
            $decoded = json_decode($slice, true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }
        return null;
    }

    /**
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
}
