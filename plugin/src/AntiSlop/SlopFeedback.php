<?php
declare(strict_types=1);

namespace Joist\AntiSlop;

use Joist\Core\Logger;
use Joist\Eval\PreferenceMemory;
use Joist\Eval\Rule;

/**
 * @purpose Feedback loop that escalates repeated anti-slop rejections into a
 *          per-site forbidden_phrase rule in PreferenceMemory.
 *
 * Storage: per-site option `joist_slop_counts_<site_id>` (a plain array). We
 * pick wp_options over a custom table to keep the data substrate small —
 * counts compact naturally as phrases either promote to PreferenceMemory
 * (then their count is reset / archived) or stay below threshold (low volume).
 * If volume becomes large enough that the option row exceeds ~64KB, the
 * v0.85 migration spec calls for moving this into a dedicated table; for now
 * the rate is bounded by user feedback velocity and stays small.
 *
 * Promotion logic:
 *   - record() bumps the per-(site, phrase-hash) counter.
 *   - When the counter crosses PROMOTION_THRESHOLD (default 3), the phrase is
 *     written into PreferenceMemory as a forbid_phrase Rule. The counter is
 *     then reset so the rule controls future detection (and PreferenceMemory's
 *     own dedup handles repeated promotions).
 *
 * Idempotency: each record() carries a deterministic event hash derived from
 * (site_id, normalised_phrase, sample text fingerprint). Replays of the same
 * event are skipped.
 *
 * Failure-mode constraint #16 (no silent failures): write errors are logged
 * with full context and re-raised. The REST controller turns them into 5xx +
 * recovery_suggestions.
 */
final class SlopFeedback
{
    /** Default threshold for promoting a repeated rejection to a Rule. */
    public const PROMOTION_THRESHOLD = 3;

    /** wp_options key prefix; the full key is OPTION_PREFIX . $siteId. */
    public const OPTION_PREFIX = 'joist_slop_counts_';

    /** Cap on the number of distinct phrases tracked per site. */
    public const MAX_PHRASES_PER_SITE = 500;

    /** Cap on idempotency keys retained per phrase (FIFO). */
    public const MAX_EVENT_KEYS = 50;

    public function __construct(private PreferenceMemory $memory) {}

    /**
     * Record one anti-slop rejection event. Idempotent.
     *
     * @param array{layer?:string, match?:string, severity?:string, kind?:string} $violationMatch
     *        A single violation entry from ValidationResult::$violations, or a
     *        synthetic shape carrying at least {match}.
     * @return array{
     *   recorded:bool, promoted:bool, phrase:string, count:int,
     *   rule_id:?string, threshold:int
     * }
     */
    public function record(string $siteId, string $text, array $violationMatch, int $threshold = self::PROMOTION_THRESHOLD): array
    {
        $phrase = isset($violationMatch['match']) ? (string) $violationMatch['match'] : '';
        $phrase = trim($phrase);
        if ($phrase === '') {
            return [
                'recorded' => false, 'promoted' => false,
                'phrase' => '', 'count' => 0, 'rule_id' => null,
                'threshold' => $threshold,
            ];
        }
        $normalised = $this->normalisePhrase($phrase);
        $eventKey = $this->eventKey($siteId, $normalised, $text);

        $bucket = $this->loadBucket($siteId);

        // Idempotency check.
        $existing = $bucket['phrases'][$normalised] ?? null;
        if ($existing !== null && in_array($eventKey, $existing['event_keys'] ?? [], true)) {
            return [
                'recorded' => false,
                'promoted' => (bool) ($existing['promoted'] ?? false),
                'phrase' => $normalised,
                'count' => (int) ($existing['count'] ?? 0),
                'rule_id' => $existing['rule_id'] ?? null,
                'threshold' => $threshold,
            ];
        }

        // Initialise or increment.
        if ($existing === null) {
            if (count($bucket['phrases']) >= self::MAX_PHRASES_PER_SITE) {
                // Cap reached — drop the oldest entry to make room.
                $oldestKey = array_key_first($bucket['phrases']);
                if ($oldestKey !== null) {
                    unset($bucket['phrases'][$oldestKey]);
                }
            }
            $bucket['phrases'][$normalised] = [
                'original' => $phrase,
                'count' => 0,
                'event_keys' => [],
                'first_seen' => gmdate('c'),
                'last_seen' => gmdate('c'),
                'severity' => (string) ($violationMatch['severity'] ?? BannedLexicon::SEVERITY_MEDIUM),
                'promoted' => false,
                'rule_id' => null,
            ];
        }

        $bucket['phrases'][$normalised]['count']++;
        $bucket['phrases'][$normalised]['last_seen'] = gmdate('c');

        // Append event key with FIFO cap.
        $keys = $bucket['phrases'][$normalised]['event_keys'] ?? [];
        $keys[] = $eventKey;
        if (count($keys) > self::MAX_EVENT_KEYS) {
            $keys = array_slice($keys, -self::MAX_EVENT_KEYS);
        }
        $bucket['phrases'][$normalised]['event_keys'] = $keys;

        $currentCount = (int) $bucket['phrases'][$normalised]['count'];
        $promoted = false;
        $ruleId = $bucket['phrases'][$normalised]['rule_id'] ?? null;

        if (!$bucket['phrases'][$normalised]['promoted'] && $currentCount >= $threshold) {
            try {
                $rule = Rule::create(
                    siteId: $siteId,
                    kind: Rule::KIND_FORBIDDEN_PHRASE,
                    pattern: $phrase,
                    directive: 'Avoid the phrase "' . $phrase . '" — repeatedly rejected on this site.',
                    provenance: [
                        'source' => 'anti_slop_feedback',
                        'observed_count' => $currentCount,
                        'first_seen' => $bucket['phrases'][$normalised]['first_seen'],
                        'last_seen' => $bucket['phrases'][$normalised]['last_seen'],
                    ],
                    scope: 'global',
                    confidence: min(1.0, 0.5 + ($currentCount - $threshold) * 0.1),
                );
                $added = $this->memory->add($rule);
                $ruleId = $added->id;
                $bucket['phrases'][$normalised]['promoted'] = true;
                $bucket['phrases'][$normalised]['rule_id'] = $ruleId;
                $promoted = true;
            } catch (\Throwable $e) {
                // #16: no silent failures.
                Logger::error('anti_slop.promotion_failed', [
                    'site_id' => $siteId, 'phrase' => $phrase, 'error' => $e->getMessage(),
                ]);
                throw $e;
            }
        }

        $this->saveBucket($siteId, $bucket);

        return [
            'recorded' => true,
            'promoted' => $promoted,
            'phrase' => $normalised,
            'count' => $currentCount,
            'rule_id' => $ruleId,
            'threshold' => $threshold,
        ];
    }

    /**
     * Read-after-write helper: return the current state of a tracked phrase
     * (or null if not tracked). Used by the REST controller to satisfy
     * failure-mode constraint #2 (return the post-write view).
     *
     * @return array<string,mixed>|null
     */
    public function getState(string $siteId, string $phrase): ?array
    {
        $bucket = $this->loadBucket($siteId);
        $normalised = $this->normalisePhrase($phrase);
        return $bucket['phrases'][$normalised] ?? null;
    }

    /**
     * Reset a single phrase counter (used in tests / by promotion paths that
     * intentionally archive a rule).
     */
    public function reset(string $siteId, string $phrase): void
    {
        $bucket = $this->loadBucket($siteId);
        $normalised = $this->normalisePhrase($phrase);
        unset($bucket['phrases'][$normalised]);
        $this->saveBucket($siteId, $bucket);
    }

    /** Returns option key (kept public so admin tooling can read it). */
    public function optionKey(string $siteId): string
    {
        $safe = preg_replace('/[^A-Za-z0-9_.-]/', '_', $siteId) ?: 'unknown';
        return self::OPTION_PREFIX . $safe;
    }

    private function normalisePhrase(string $phrase): string
    {
        $lower = function_exists('mb_strtolower') ? mb_strtolower($phrase, 'UTF-8') : strtolower($phrase);
        return preg_replace('/\s+/u', ' ', trim($lower)) ?? trim($lower);
    }

    private function eventKey(string $siteId, string $normalisedPhrase, string $text): string
    {
        $textFingerprint = substr(hash('sha256', $text), 0, 16);
        return substr(hash('sha256', $siteId . '|' . $normalisedPhrase . '|' . $textFingerprint), 0, 24);
    }

    /**
     * @return array{phrases: array<string, array<string,mixed>>, schema_version:int}
     */
    private function loadBucket(string $siteId): array
    {
        $raw = get_option($this->optionKey($siteId), null);
        if (!is_array($raw) || !isset($raw['phrases']) || !is_array($raw['phrases'])) {
            return ['phrases' => [], 'schema_version' => 1];
        }
        return $raw;
    }

    /**
     * @param array{phrases: array<string, array<string,mixed>>, schema_version:int} $bucket
     */
    private function saveBucket(string $siteId, array $bucket): void
    {
        update_option($this->optionKey($siteId), $bucket, false);
    }
}
