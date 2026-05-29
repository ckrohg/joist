<?php
declare(strict_types=1);

namespace Joist\AntiSlop;

use Joist\Eval\PreferenceMemory;
use Joist\Eval\Rule;

/**
 * @purpose Post-generation anti-slop validator for AI-generated copy.
 *
 * Two-layer pattern per the 2026 Ozigi essay: a banned-lexicon system block is
 * injected at prompt time (W6c copy-gen handles that side); THIS file is the
 * post-generation code validator that catches what survived. Detected slop
 * triggers a single bounded repair retry (caller's responsibility — this
 * validator only returns the verdict + a repair hint).
 *
 * Layers screened (in order):
 *   1. vocab            — whole-word match for single-token slop
 *   2. phrases          — case-insensitive substring match for multi-word slop
 *   3. sentenceOpeners  — per-sentence regex against sentence-leading text
 *   4. structures       — whole-text regex + em-dash density check
 *   5. site overlay     — if siteId provided, merge in PreferenceMemory
 *                         forbid_phrase rules so per-site preferences are
 *                         honoured at validation time
 *
 * Performance notes:
 *   - Vocab uses a single compiled regex of word boundaries to avoid N walks.
 *   - Phrases use mb_stripos so we walk the text once per phrase.
 *   - Sentence-opener regex is anchored at sentence start; we split sentences
 *     once and probe each opener regex per sentence (small fixed set).
 *   - Multibyte-safe throughout via mb_* string functions.
 *   - Target: ~5ms on a 500-word draft. We don't measure here but the design
 *     stays in linear time over text length.
 */
final class CopyValidator
{
    /** Score threshold below which the caller should run the repair retry. */
    public const REPAIR_THRESHOLD = 70;

    /** Score floor / ceiling. */
    public const SCORE_FLOOR = 0;
    public const SCORE_CEIL = 100;

    /** Em-dash density limit: more than this per 200 chars is flagged. */
    public const EM_DASH_DENSITY_LIMIT = 3;
    public const EM_DASH_DENSITY_WINDOW = 200;

    public function __construct(private ?PreferenceMemory $memory = null) {}

    public function validate(string $text, ?string $siteId = null): ValidationResult
    {
        $violations = [];

        if (trim($text) === '') {
            return new ValidationResult(
                passed: true,
                score: self::SCORE_CEIL,
                violations: [],
                requiresRepair: false,
                repairHint: '',
            );
        }

        $this->scanVocab($text, $violations);
        $this->scanPhrases($text, $violations);
        $this->scanSentenceOpeners($text, $violations);
        $this->scanStructures($text, $violations);

        if ($siteId !== null && $this->memory !== null) {
            $this->scanSiteRules($text, $siteId, $violations);
        }

        $score = $this->computeScore($violations);
        // A strict pass means: nothing tripped at all. Anything tripped is at
        // most a soft-pass with warnings; the caller decides whether to surface.
        $passed = count($violations) === 0;
        $requiresRepair = $score < self::REPAIR_THRESHOLD;
        $repairHint = $requiresRepair ? $this->buildRepairHint($violations) : '';

        return new ValidationResult(
            passed: $passed,
            score: $score,
            violations: $violations,
            requiresRepair: $requiresRepair,
            repairHint: $repairHint,
        );
    }

    /** @param list<array> $violations */
    private function scanVocab(string $text, array &$violations): void
    {
        foreach (BannedLexicon::vocab() as $entry) {
            $token = $entry['token'];
            // Whole-word, case-insensitive, multibyte-safe.
            // \b doesn't handle hyphenated tokens well; allow hyphen as a token-internal char.
            $pattern = '/(?<![\\p{L}\\p{N}_])' . preg_quote($token, '/') . '(?![\\p{L}\\p{N}_])/iu';
            if (preg_match_all($pattern, $text, $matches, PREG_OFFSET_CAPTURE) === false) {
                continue;
            }
            foreach ($matches[0] as $m) {
                [$literal, $byteOffset] = $m;
                $violations[] = [
                    'layer' => 'vocab',
                    'kind' => $entry['category'],
                    'match' => (string) $literal,
                    'severity' => $entry['severity'],
                    'position' => (int) $byteOffset,
                    'replacement_suggestion' => $entry['replacement'] ?? null,
                    'hint' => null,
                    'category' => $entry['category'],
                ];
            }
        }
    }

    /** @param list<array> $violations */
    private function scanPhrases(string $text, array &$violations): void
    {
        foreach (BannedLexicon::phrases() as $entry) {
            $phrase = $entry['phrase'];
            $offset = 0;
            // mb_stripos in a loop — case-insensitive, multibyte-safe.
            while (($pos = mb_stripos($text, $phrase, $offset)) !== false) {
                // Convert char offset to byte offset for consistency with PCRE positions.
                $prefix = mb_substr($text, 0, $pos);
                $byteOffset = strlen($prefix);
                $literal = mb_substr($text, $pos, mb_strlen($phrase));
                $violations[] = [
                    'layer' => 'phrases',
                    'kind' => $entry['category'],
                    'match' => $literal,
                    'severity' => $entry['severity'],
                    'position' => $byteOffset,
                    'replacement_suggestion' => $entry['replacement'] ?? null,
                    'hint' => null,
                    'category' => $entry['category'],
                ];
                $offset = $pos + mb_strlen($phrase);
            }
        }
    }

    /** @param list<array> $violations */
    private function scanSentenceOpeners(string $text, array &$violations): void
    {
        // Patterns are anchored with ^ in the lexicon. We need to test each
        // sentence's leading text against them — but some openers (e.g. the
        // "It's not X. It's Y." contrastive pattern) span TWO grammatical
        // sentences. So we run each pattern in TWO modes:
        //   (a) anchored at start of each sentence (one-sentence opener regex)
        //   (b) anchored at start of any sentence, allowing internal "." —
        //       implemented by replacing the ^ with a sentence-boundary
        //       lookbehind and using preg_match_all on the whole text.
        $sentences = $this->splitSentences($text);

        foreach (BannedLexicon::sentenceOpeners() as $entry) {
            $body = $entry['regex'];
            // Single-sentence match.
            $perSentencePattern = '/' . $body . '/u';
            foreach ($sentences as $sentence) {
                if (preg_match($perSentencePattern, $sentence['text'], $m) === 1) {
                    $violations[] = [
                        'layer' => 'openers',
                        'kind' => $entry['name'],
                        'match' => (string) $m[0],
                        'severity' => $entry['severity'],
                        'position' => (int) $sentence['offset'],
                        'replacement_suggestion' => null,
                        'hint' => $entry['hint'],
                        'category' => $entry['category'],
                    ];
                    continue 2; // one hit per opener pattern is enough
                }
            }
            // Cross-sentence match: replace leading ^ with a sentence-boundary
            // assertion that admits start-of-string OR (period|exclam|question) + ws.
            if (str_starts_with($body, '^')) {
                $bodyCross = '(?:^|(?<=[\\.!?])\\s+)' . substr($body, 1);
                $crossPattern = '/' . $bodyCross . '/u';
                if (preg_match($crossPattern, $text, $m, PREG_OFFSET_CAPTURE) === 1) {
                    [$literal, $offset] = $m[0];
                    $violations[] = [
                        'layer' => 'openers',
                        'kind' => $entry['name'],
                        'match' => trim((string) $literal),
                        'severity' => $entry['severity'],
                        'position' => (int) $offset,
                        'replacement_suggestion' => null,
                        'hint' => $entry['hint'],
                        'category' => $entry['category'],
                    ];
                }
            }
        }
    }

    /** @param list<array> $violations */
    private function scanStructures(string $text, array &$violations): void
    {
        foreach (BannedLexicon::structures() as $entry) {
            if ($entry['kind'] === 'regex') {
                $pattern = '/' . $entry['regex'] . '/u';
                if (preg_match_all($pattern, $text, $matches, PREG_OFFSET_CAPTURE) === false) {
                    continue;
                }
                foreach ($matches[0] as $m) {
                    [$literal, $byteOffset] = $m;
                    $violations[] = [
                        'layer' => 'structures',
                        'kind' => $entry['name'],
                        'match' => (string) $literal,
                        'severity' => $entry['severity'],
                        'position' => (int) $byteOffset,
                        'replacement_suggestion' => null,
                        'hint' => $entry['hint'],
                        'category' => $entry['category'],
                    ];
                }
                continue;
            }
            if ($entry['kind'] === 'em_dash_density') {
                $this->scanEmDashDensity($text, $entry, $violations);
            }
        }
    }

    /** @param list<array> $violations */
    private function scanEmDashDensity(string $text, array $entry, array &$violations): void
    {
        $totalDashes = mb_substr_count($text, "\u{2014}"); // em dash U+2014
        $textLen = max(1, mb_strlen($text));
        $density = ($totalDashes / $textLen) * self::EM_DASH_DENSITY_WINDOW;
        if ($density > self::EM_DASH_DENSITY_LIMIT) {
            // Locate first em-dash for position.
            $firstByte = strpos($text, "\u{2014}");
            $violations[] = [
                'layer' => 'structures',
                'kind' => $entry['name'],
                'match' => "\u{2014}",
                'severity' => $entry['severity'],
                'position' => $firstByte === false ? 0 : (int) $firstByte,
                'replacement_suggestion' => null,
                'hint' => $entry['hint'] . ' (observed density: ' . round($density, 1) . ' per 200 chars)',
                'category' => $entry['category'],
            ];
        }
    }

    /** @param list<array> $violations */
    private function scanSiteRules(string $text, string $siteId, array &$violations): void
    {
        $rules = $this->memory->listActive($siteId);
        foreach ($rules as $rule) {
            if ($rule->kind !== Rule::KIND_FORBIDDEN_PHRASE) {
                continue;
            }
            if (!$rule->matches($text)) {
                continue;
            }
            // Best-effort position: case-insensitive substring search for literal patterns.
            $pos = 0;
            $literal = $rule->pattern;
            if (!preg_match('|^/(.+)/([imsxu]*)$|', $rule->pattern)) {
                $found = mb_stripos($text, $rule->pattern);
                if ($found !== false) {
                    $pos = strlen(mb_substr($text, 0, $found));
                    $literal = mb_substr($text, $found, mb_strlen($rule->pattern));
                }
            }
            $violations[] = [
                'layer' => 'site_rules',
                'kind' => 'forbid_phrase',
                'match' => $literal,
                'severity' => BannedLexicon::SEVERITY_HIGH,
                'position' => $pos,
                'replacement_suggestion' => null,
                'hint' => $rule->directive,
                'category' => 'site_rule',
                'rule_id' => $rule->id,
            ];
            $this->memory->recordInvocation($rule->id);
        }
    }

    /**
     * Naive sentence splitter — splits on [.!?] followed by whitespace or end.
     * Multibyte-safe; returns [{text, offset}] preserving byte offsets.
     *
     * @return list<array{text:string, offset:int}>
     */
    private function splitSentences(string $text): array
    {
        // Trim leading whitespace from the very first match; collect byte offsets.
        $offsets = [];
        $cursor = 0;
        $len = strlen($text);
        // Walk to find sentence starts: position 0 (skip leading ws) + every char
        // after a [.!?] + whitespace gap.
        // Use a regex to find the start of each sentence.
        preg_match_all('/(?:^|[\\.!?]\\s+)(\\S)/u', $text, $matches, PREG_OFFSET_CAPTURE);
        $starts = [];
        if (!empty($matches[1])) {
            foreach ($matches[1] as $m) {
                $starts[] = (int) $m[1];
            }
        }
        if (empty($starts)) {
            $starts = [0];
        }
        $sentences = [];
        for ($i = 0, $n = count($starts); $i < $n; $i++) {
            $start = $starts[$i];
            $end = $starts[$i + 1] ?? $len;
            $body = substr($text, $start, $end - $start);
            // Strip trailing whitespace introduced by the lookahead.
            $body = rtrim($body);
            if ($body === '') {
                continue;
            }
            $sentences[] = ['text' => $body, 'offset' => $start];
        }
        return $sentences;
    }

    /** @param list<array{severity:string}> $violations */
    private function computeScore(array $violations): int
    {
        $score = self::SCORE_CEIL;
        foreach ($violations as $v) {
            $weight = BannedLexicon::SCORE_WEIGHT[$v['severity']] ?? 0;
            $score -= $weight;
        }
        return max(self::SCORE_FLOOR, min(self::SCORE_CEIL, $score));
    }

    /** @param list<array> $violations */
    private function buildRepairHint(array $violations): string
    {
        // Group by layer and surface the worst offenders.
        $byLayer = [];
        foreach ($violations as $v) {
            $byLayer[$v['layer']][] = $v;
        }
        $lines = ['The previous draft tripped the anti-slop validator. Repair these specific issues:'];
        $count = 0;
        foreach ($byLayer as $layer => $items) {
            if ($count >= 5) break;
            $matches = array_unique(array_map(fn($x) => (string) $x['match'], $items));
            $shown = array_slice($matches, 0, 4);
            $sample = implode('", "', $shown);
            switch ($layer) {
                case 'vocab':
                    $lines[] = '- Replace these banned tokens: "' . $sample . '". Use plainer synonyms.';
                    break;
                case 'phrases':
                    $lines[] = '- Cut these slop phrases entirely: "' . $sample . '".';
                    break;
                case 'openers':
                    $lines[] = '- Rewrite sentence openings — these patterns read as AI: "' . $sample . '".';
                    break;
                case 'structures':
                    $hints = array_unique(array_filter(array_map(fn($x) => $x['hint'] ?? null, $items)));
                    $hintText = $hints ? ' (' . implode('; ', array_slice($hints, 0, 2)) . ')' : '';
                    $lines[] = '- Fix slop structure' . $hintText . '.';
                    break;
                case 'site_rules':
                    $lines[] = '- Site preference violation: "' . $sample . '" is on this site\'s forbidden list.';
                    break;
            }
            $count++;
        }
        $lines[] = 'Keep the meaning. Cut the slop. Rewrite, do not paraphrase.';
        return implode("\n", $lines);
    }
}
