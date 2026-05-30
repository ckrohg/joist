<?php
declare(strict_types=1);

namespace Joist\Generate\Copy;

use Joist\Core\Logger;
use Joist\Eval\PreferenceMemory;
use Joist\Eval\Rule;

/**
 * @purpose Build the layered, cache-friendly prompt prefix for a given site.
 *
 * Layout (stable -> volatile, matching Anthropic prompt-caching guidance):
 *   0. Joist constitution (W10b, v0.9): ~50 rationale-bearing principles
 *      from plugin/joist.constitution.md plus optional per-site overrides at
 *      $WP_UPLOADS/joist/sites/<site_id>/constitution.md. Most stable layer;
 *      appears first so changes downstream don't bust its cache.
 *      — wrapped in cache_control: {type: 'ephemeral'}
 *   1. Joist house style (forbidden + preferred vocab from taste_anti_slop_rules)
 *      — wrapped in cache_control: {type: 'ephemeral'}
 *   2. Site-specific brand.json (palette names, type names, voice rules, taboo
 *      list) loaded from $WP_CONTENT_DIR/joist/sites/<site_id>/brand.json, or
 *      a derived profile from preference_memory if the file is missing.
 *      — wrapped in cache_control: {type: 'ephemeral'}
 *   3. 6-10 voice exemplars (paired user/assistant turns demonstrating the
 *      desired voice) — emitted as messages with cache_control on the LAST
 *      assistant turn (via BrandBlock::exemplarsAsMessages()).
 *
 * The per-page request is NOT part of the BrandBlock — that's the delta the
 * CopyGenerator adds per call.
 *
 * Anthropic max cache_control breakpoints: 4 per request. As of Wave 10b
 * (v0.9) we use up to 4 (constitution, house-style, brand.json, last
 * exemplar). When the constitution layer is absent (W6c-only deploys) the
 * count drops to 3, leaving one slot for the CopyGenerator.
 *
 * See specs/COPY_GEN.md §2 + specs/WAVE_0_2026-05-26.md §6.
 */
final class BrandBlockAssembler
{
    /**
     * Joist house style. Locked here rather than fetched from memory because
     * (a) it's the most-stable layer (the whole point of layer 1 in the
     * cache hierarchy) and (b) it ships with the plugin — no IO required.
     * Sourced from memory/taste_anti_slop_rules.md + memory/brand_decisions.md.
     */
    private const HOUSE_STYLE = <<<'TXT'
# Joist house style (always honour these)

You are writing copy for a website. Your output goes straight to the page;
treat it as production text, not draft.

## Voice
Direct, specific, opinionated. Engineer-flavoured honesty. Prefer concrete
nouns and active verbs. One idea per sentence; cut adverbs that are not
load-bearing.

## Forbidden vocabulary (never use)
revolutionize, unleash, transform, empower, scale without limits,
all-in-one platform, the future of, next-gen, AI-powered, leverage,
synergy, mission-critical, game-changing, magic, magical, seamless,
seamlessly, journey, ecosystem, robust, cutting-edge, world-class,
unlock, supercharge, elevate, dive in, navigate, harness, holistic,
turnkey, frictionless, end-to-end (as a marketing adjective).

## Forbidden sentence openers
"In today's", "In the world of", "When it comes to", "As you know",
"It's no secret", "Imagine if", "Picture this", "Let's face it".

## Forbidden structures
- The em-dash bookend ("X — and Y — Z").
- The "not just X, but Y" construction.
- The rhetorical question opener ("Ever wondered why...").
- Tricolon padding ("fast, simple, and powerful").

## Preferred vocabulary
safe, validated, audited, revertible, surgical, schema-checked, native,
open, honest, deliberate, refusal-aware, round-trip-safe, plumb-correct,
foundational, discipline, build, ship, write, edit, save, refuse.

## Output contract
- Plain text only unless the request asks for markdown or HTML.
- No preamble ("Sure! Here's..."), no postamble ("Let me know if you'd
  like changes!"). The first character of your reply is the first
  character of the output the user wants.
- If the request is ambiguous, write the most defensible interpretation;
  do not ask clarifying questions.
TXT;

    public function __construct(
        private PreferenceMemory $memory,
    ) {}

    /**
     * Build a BrandBlock for the given site. Pure: no DB writes, no API calls.
     *
     * @param string $siteId
     * @param string $modelHint
     * @param bool $includeExemplars Wave 10c (v0.9). When true, prepend the
     *        site's recent approved exemplars + negative anchors to the
     *        voice-exemplar message history (cached prefix). Default true
     *        for Plan Mode burst calls; pass false for cron-driven scheduled
     *        rebuilds where the 5-min cache TTL won't pay off.
     */
    public function assemble(string $siteId, string $modelHint = 'claude-opus-4-7', bool $includeExemplars = true): BrandBlock
    {
        $systemBlocks = [];

        // Layer 0 — Joist constitution (Wave 10b, v0.9). The most-stable layer:
        // ~50 rationale-bearing principles that change rarely (months between
        // edits). Putting it FIRST in the cached prefix maximises hit-rate
        // across calls, because anything cached above it survives all changes
        // to lower layers. Gracefully no-ops if the v0.9 substrate hasn't
        // landed yet (W6c-only deploys won't have ConstitutionLoader).
        if (class_exists(\Joist\Constitution\ConstitutionLoader::class)) {
            try {
                $loader = new \Joist\Constitution\ConstitutionLoader();
                $constitution = $loader->effective($siteId);
                if ($constitution !== '') {
                    $systemBlocks[] = [
                        'type' => 'text',
                        'text' => $constitution,
                        'cache_control' => ['type' => 'ephemeral'],
                    ];
                }
            } catch (\Throwable $e) {
                // Constitution failures must never break copy gen — log and
                // proceed without the layer. The downstream cache key changes
                // anyway when the file content changes, so a missing layer
                // simply means a cache miss, not a corrupt prompt.
                Logger::warn('joist.copy.constitution_load_failed', [
                    'site_id' => $siteId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // Layer 1 — Joist house style (always present, always cached).
        $systemBlocks[] = [
            'type' => 'text',
            'text' => self::HOUSE_STYLE,
            'cache_control' => ['type' => 'ephemeral'],
        ];

        // Layer 2 — site-specific brand.json (or derived from prefmem).
        $brandProfile = $this->loadBrandProfile($siteId);
        if ($brandProfile !== '') {
            $systemBlocks[] = [
                'type' => 'text',
                'text' => $brandProfile,
                'cache_control' => ['type' => 'ephemeral'],
            ];
        }

        // Layer 3 — voice exemplars (6-10 paired turns).
        $exemplars = $this->loadExemplars($siteId);

        // Wave 10c (v0.9) — Layer 4: per-site approved exemplar pack (5-20
        // accepted renderings + negative anchors). The pack messages share
        // the message-history channel with the voice exemplars; we prepend
        // them so the voice-exemplar block stays as the trailing context
        // closest to the per-call request. Gated on $includeExemplars so
        // out-of-loop runs (scheduled rebuilds) don't burn the cache-write
        // multiplier on a TTL window they won't use. Gracefully no-ops if
        // the W10c substrate hasn't landed (no ExemplarPackManager class,
        // no exemplar table, or empty pack for this site).
        if ($includeExemplars && class_exists(\Joist\ExemplarPack\ExemplarPackManager::class)) {
            try {
                global $wpdb;
                $exemplarManager = new \Joist\ExemplarPack\ExemplarPackManager($wpdb);
                $packMessages = $exemplarManager->renderForPrompt($siteId, [
                    'include' => true,
                    'limit' => \Joist\ExemplarPack\ExemplarPackManager::DEFAULT_RENDER_LIMIT,
                ]);
                if (!empty($packMessages)) {
                    // Reduce to the {role, content-string} shape that
                    // loadExemplars() returns — BrandBlock::exemplarsAsMessages()
                    // re-applies cache_control on the LAST turn, so we strip
                    // the per-message cache_control here to avoid exceeding
                    // Anthropic's 4-breakpoint cap.
                    $flat = [];
                    foreach ($packMessages as $m) {
                        $role = (string) ($m['role'] ?? 'user');
                        $content = $m['content'] ?? '';
                        if (is_array($content)) {
                            $text = '';
                            foreach ($content as $block) {
                                if (is_array($block) && isset($block['text']) && is_string($block['text'])) {
                                    $text .= $block['text'];
                                }
                            }
                            $content = $text;
                        }
                        $flat[] = ['role' => $role, 'content' => (string) $content];
                    }
                    // Pack messages come FIRST in the message history (oldest
                    // context); voice exemplars stay closest to the request.
                    $exemplars = array_merge($flat, $exemplars);
                }
            } catch (\Throwable $e) {
                Logger::warn('joist.copy.exemplar_pack_load_failed', [
                    'site_id' => $siteId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $estTokens = $this->estimateTokens($systemBlocks, $exemplars);

        $cacheKey = $this->computeCacheKey($systemBlocks, $exemplars, $modelHint);

        return new BrandBlock(
            cacheKey: $cacheKey,
            systemBlocks: $systemBlocks,
            exemplars: $exemplars,
            estimatedTokens: $estTokens,
            siteId: $siteId,
            modelHint: $modelHint,
        );
    }

    /**
     * Load the per-site brand profile. Prefer $WP_CONTENT_DIR/joist/sites/<id>/brand.json;
     * fall back to a profile rendered from preference_memory rules. Returns ""
     * if neither is available (a brand-less site bootstraps with only the
     * house-style layer + any exemplars).
     */
    private function loadBrandProfile(string $siteId): string
    {
        // brand.json path — defaults to wp-content/joist/sites/<site_id>/brand.json.
        $path = $this->brandJsonPath($siteId);
        if ($path !== null && is_readable($path)) {
            $raw = @file_get_contents($path);
            if (is_string($raw) && $raw !== '') {
                $decoded = json_decode($raw, true);
                if (is_array($decoded)) {
                    return $this->renderBrandJson($decoded, $siteId);
                }
                Logger::debug('joist.copy.brand_json.invalid', [
                    'site_id' => $siteId,
                    'path' => $path,
                ]);
            }
        }

        // Fallback — render from preference_memory.
        $prefmem = $this->memory->renderForPrompt($siteId);
        if ($prefmem === '') {
            return '';
        }
        return "# Site brand profile (derived from preference_memory)\n\n" . $prefmem;
    }

    /**
     * Resolve the brand.json path for this site. Public for tests.
     */
    public function brandJsonPath(string $siteId): ?string
    {
        // Defensive: defined() check so this class can be instantiated in
        // unit tests without WP loaded.
        $contentDir = defined('WP_CONTENT_DIR') ? WP_CONTENT_DIR : null;
        if (!is_string($contentDir) || $contentDir === '') {
            return null;
        }
        // Sanitise site_id: only allow [a-zA-Z0-9._-] to prevent path traversal.
        $safe = preg_replace('/[^a-zA-Z0-9._-]/', '_', $siteId) ?? 'unknown';
        return rtrim($contentDir, '/\\') . '/joist/sites/' . $safe . '/brand.json';
    }

    /**
     * Render a parsed brand.json into a markdown system block.
     */
    private function renderBrandJson(array $brand, string $siteId): string
    {
        $lines = ['# Site brand (' . $siteId . ')'];

        if (!empty($brand['name'])) {
            $lines[] = '';
            $lines[] = '**Brand name:** ' . (string) $brand['name'];
        }
        if (!empty($brand['tagline'])) {
            $lines[] = '**Tagline:** ' . (string) $brand['tagline'];
        }
        if (!empty($brand['positioning'])) {
            $lines[] = '**Positioning:** ' . (string) $brand['positioning'];
        }

        if (!empty($brand['voice']) && is_array($brand['voice'])) {
            $lines[] = '';
            $lines[] = '## Voice';
            foreach ($brand['voice'] as $rule) {
                if (is_string($rule) && $rule !== '') {
                    $lines[] = '- ' . $rule;
                }
            }
        }

        if (!empty($brand['palette']) && is_array($brand['palette'])) {
            $lines[] = '';
            $lines[] = '## Palette (names only — never write the hex codes)';
            foreach ($brand['palette'] as $name => $hex) {
                if (is_string($name) && is_string($hex)) {
                    $lines[] = '- ' . $name . ': ' . $hex;
                }
            }
        }

        if (!empty($brand['typography']) && is_array($brand['typography'])) {
            $lines[] = '';
            $lines[] = '## Typography';
            foreach ($brand['typography'] as $role => $family) {
                if (is_string($role) && is_string($family)) {
                    $lines[] = '- ' . $role . ': ' . $family;
                }
            }
        }

        if (!empty($brand['forbidden']) && is_array($brand['forbidden'])) {
            $lines[] = '';
            $lines[] = '## Site-specific taboo (in addition to house style)';
            foreach ($brand['forbidden'] as $phrase) {
                if (is_string($phrase) && $phrase !== '') {
                    $lines[] = '- ' . $phrase;
                }
            }
        }

        if (!empty($brand['preferred']) && is_array($brand['preferred'])) {
            $lines[] = '';
            $lines[] = '## Site-specific preferred vocabulary';
            foreach ($brand['preferred'] as $word) {
                if (is_string($word) && $word !== '') {
                    $lines[] = '- ' . $word;
                }
            }
        }

        // Append preference_memory rules in a compact section if present —
        // this keeps the layered cache hierarchy intact (the brand.json is
        // the slow-moving site layer; prefmem-driven additions inherit
        // the same cache_control breakpoint).
        $prefmemBlock = $this->memory->renderForPrompt($siteId);
        if ($prefmemBlock !== '') {
            $lines[] = '';
            $lines[] = $prefmemBlock;
        }

        return implode("\n", $lines);
    }

    /**
     * Load voice exemplars from $WP_CONTENT_DIR/joist/sites/<id>/exemplars.json,
     * or fall back to a small canonical set so the cache prefix is never empty.
     *
     * Schema: [{"role": "user"|"assistant", "content": "..."}]
     *
     * @return list<array{role:string,content:string}>
     */
    private function loadExemplars(string $siteId): array
    {
        $contentDir = defined('WP_CONTENT_DIR') ? WP_CONTENT_DIR : null;
        if (is_string($contentDir) && $contentDir !== '') {
            $safe = preg_replace('/[^a-zA-Z0-9._-]/', '_', $siteId) ?? 'unknown';
            $path = rtrim($contentDir, '/\\') . '/joist/sites/' . $safe . '/exemplars.json';
            if (is_readable($path)) {
                $raw = @file_get_contents($path);
                if (is_string($raw) && $raw !== '') {
                    $decoded = json_decode($raw, true);
                    if (is_array($decoded)) {
                        $exemplars = $this->validateExemplars($decoded);
                        if (count($exemplars) >= 2) {
                            return $exemplars;
                        }
                    }
                }
            }
        }

        // Canonical fallback — paired turns demonstrating the Joist voice.
        // Pulled from memory/brand_decisions.md "Voice" section. Six turns
        // (three pairs). Sites that want more should provide exemplars.json.
        return [
            ['role' => 'user', 'content' => 'Hero copy for a homepage. Product: an Elementor plugin that lets AI agents edit WordPress sites safely.'],
            ['role' => 'assistant', 'content' => 'The open-source backbone for AI-edited Elementor sites. Every write is validated, every change is revertible, every edit survives the round-trip back to the visual editor.'],
            ['role' => 'user', 'content' => 'One-sentence description for a feature called Plan Mode.'],
            ['role' => 'assistant', 'content' => 'Plan Mode shows you every change the agent intends to make, ranked by blast radius, before a single write hits your database.'],
            ['role' => 'user', 'content' => 'Card heading + 12-word body for "round-trip safety".'],
            ['role' => 'assistant', 'content' => "Round-trip safe.\n\nEdit in Elementor, edit with the agent, edit in Elementor again. Same widgets, same hashes, no drift."],
        ];
    }

    /**
     * @param mixed $decoded
     * @return list<array{role:string,content:string}>
     */
    private function validateExemplars($decoded): array
    {
        if (!is_array($decoded)) return [];
        $out = [];
        foreach ($decoded as $turn) {
            if (!is_array($turn)) continue;
            $role = $turn['role'] ?? null;
            $content = $turn['content'] ?? null;
            if (($role !== 'user' && $role !== 'assistant') || !is_string($content) || $content === '') {
                continue;
            }
            $out[] = ['role' => $role, 'content' => $content];
        }
        // Cap at 10 (per spec recommendation).
        return array_slice($out, 0, 10);
    }

    private function estimateTokens(array $systemBlocks, array $exemplars): int
    {
        $chars = 0;
        foreach ($systemBlocks as $b) {
            if (isset($b['text']) && is_string($b['text'])) {
                $chars += strlen($b['text']);
            }
        }
        foreach ($exemplars as $ex) {
            if (isset($ex['content']) && is_string($ex['content'])) {
                $chars += strlen($ex['content']);
            }
        }
        return (int) ceil($chars / BrandBlock::CHARS_PER_TOKEN_ESTIMATE);
    }

    private function computeCacheKey(array $systemBlocks, array $exemplars, string $modelHint): string
    {
        $material = wp_json_encode([
            'model' => $modelHint,
            'system' => $systemBlocks,
            'exemplars' => $exemplars,
        ]);
        return substr(hash('sha256', (string) $material), 0, 16);
    }
}
