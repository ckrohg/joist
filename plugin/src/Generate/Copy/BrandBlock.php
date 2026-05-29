<?php
declare(strict_types=1);

namespace Joist\Generate\Copy;

/**
 * @purpose Value object describing the cacheable prompt prefix assembled for a
 *          given site_id: ordered system content blocks (each carrying its own
 *          cache_control marker), voice exemplar pairs (separately cached),
 *          and an estimated-tokens count so callers can short-circuit when the
 *          block is below Anthropic's per-model cache minimum.
 *
 * Built by BrandBlockAssembler; consumed by CopyGenerator + BatchQueue.
 * Stable across calls within a session so the 5-minute TTL is amortised.
 *
 * See specs/COPY_GEN.md §2 "Brand block layout" and
 * https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 */
final class BrandBlock
{
    /**
     * Anthropic prompt-cache minimums (tokens). Per the 2026-05-28 docs:
     *   - Opus 4.7 / 4.6 / 4.5: 4096
     *   - Sonnet 4.6 / 4.5, Opus 4.1: 1024
     *
     * We pessimise: a BrandBlock is "cacheable" if it clears the highest minimum
     * for any model in the supported set, since the same block content might be
     * re-used by callers that swap the model via JOIST_CLAUDE_MODEL.
     *
     * Verified against https://platform.claude.com/docs/en/build-with-claude/prompt-caching
     * on 2026-05-28.
     */
    public const CACHE_MIN_TOKENS = 4096;

    /**
     * Approximate chars-per-token ratio used for token estimation when no
     * tokenizer is available server-side. Anthropic's empirical guidance is
     * ~3.5–4 chars/token for English; we use 4 as the conservative side.
     */
    public const CHARS_PER_TOKEN_ESTIMATE = 4;

    /**
     * @param string $cacheKey A stable hex hash of the block content (telemetry).
     * @param list<array{type:string,text:string,cache_control?:array{type:string,ttl?:string}}> $systemBlocks
     *        Ordered list ready to drop into the Messages API `system` field.
     * @param list<array{role:string,content:string}> $exemplars
     *        Paired voice exemplars (user/assistant turns). The CopyGenerator
     *        injects these BEFORE the per-call request and marks the LAST
     *        assistant turn with cache_control so the whole exemplar batch
     *        sits inside the cached prefix.
     * @param int $estimatedTokens Sum of (system text chars + exemplar text chars)
     *        divided by CHARS_PER_TOKEN_ESTIMATE.
     * @param string $siteId
     * @param string $modelHint Model the block was sized against (for cacheable() gating).
     */
    public function __construct(
        public readonly string $cacheKey,
        public readonly array $systemBlocks,
        public readonly array $exemplars,
        public readonly int $estimatedTokens,
        public readonly string $siteId,
        public readonly string $modelHint = 'claude-opus-4-7',
    ) {}

    /**
     * True when the estimated token count clears the cache minimum for this
     * model. Cache writes below the minimum are silently dropped by Anthropic
     * (no error, just no caching), so callers should fall back to a plain
     * (uncached) system string when this returns false to avoid the 1.25x
     * write-multiplier penalty for nothing.
     *
     * Verified against https://platform.claude.com/docs/en/build-with-claude/prompt-caching
     */
    public function isCacheable(): bool
    {
        return $this->estimatedTokens >= self::CACHE_MIN_TOKENS;
    }

    /**
     * Return the exemplars as a messages-array suitable for the Messages API,
     * with the final assistant turn marked with cache_control so the whole
     * batch sits in the cached prefix.
     *
     * Per Anthropic docs: cache_control on a message content block caches
     * everything up to and including that block. Marking the last exemplar
     * means the next user-request message stays out of the cache (correct —
     * it's the per-call delta).
     *
     * @return list<array{role:string,content:string|list<array<string,mixed>>}>
     */
    public function exemplarsAsMessages(): array
    {
        $count = count($this->exemplars);
        if ($count === 0) {
            return [];
        }
        $out = [];
        foreach ($this->exemplars as $i => $ex) {
            $isLast = ($i === $count - 1);
            if ($isLast && $this->isCacheable()) {
                $out[] = [
                    'role' => $ex['role'],
                    'content' => [
                        [
                            'type' => 'text',
                            'text' => $ex['content'],
                            'cache_control' => ['type' => 'ephemeral'],
                        ],
                    ],
                ];
            } else {
                $out[] = [
                    'role' => $ex['role'],
                    'content' => $ex['content'],
                ];
            }
        }
        return $out;
    }

    /**
     * Public shape for /generate/copy/brand-block/{site_id} introspection.
     *
     * @return array<string, mixed>
     */
    public function toPublicArray(): array
    {
        return [
            'site_id' => $this->siteId,
            'cache_key' => $this->cacheKey,
            'estimated_tokens' => $this->estimatedTokens,
            'is_cacheable' => $this->isCacheable(),
            'cache_min_tokens' => self::CACHE_MIN_TOKENS,
            'system_block_count' => count($this->systemBlocks),
            'exemplar_count' => count($this->exemplars),
            'model_hint' => $this->modelHint,
        ];
    }
}
