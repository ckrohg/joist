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
 * Promotion logic (v0.9 tightening per WAVE_9_2026-05-29.md §5):
 *   - record() bumps the per-(site, phrase-hash) counter.
 *   - When the counter crosses PROMOTION_THRESHOLD (default 3), the phrase is
 *     written into PreferenceMemory as a forbid_phrase Rule. The counter is
 *     then reset so the rule controls future detection (and PreferenceMemory's
 *     own dedup handles repeated promotions).
 *   - **Cross-session/day threshold (v0.9):** the 3 rejections must come from
 *     distinct sessions OR distinct calendar dates in the site timezone. A
 *     single Plan Mode burst of 3 clicks no longer promotes. Mitigates the
 *     "bad day" overfitting failure mode.
 *   - **BASIL-lite Bayesian-consistency check (v0.9):** if the
 *     ExemplarPackManager class is available (W10c is building it in
 *     parallel), sample up to 3 approved exemplars and refuse to promote if
 *     the rejected phrase ALSO appears in approvals. Probably noise, not a
 *     real preference. See [BASIL — arxiv 2508.16846].
 *   - **Promotion rate limit (v0.9):** max 1 auto-promotion per 10 minutes
 *     per session. Prevents rage-click poisoning of the rule store.
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

    /** v0.9: cap on rejection-context entries we keep per phrase (session_id + day). */
    public const MAX_CONTEXTS_PER_PHRASE = 20;

    /** v0.9: rate-limit window for auto-promotions (per session). */
    public const PROMOTION_RATE_LIMIT_SECONDS = 600;

    /** v0.9: how many distinct sessions OR days are required to promote. */
    public const DISTINCT_CONTEXTS_REQUIRED = 3;

    /** v0.9: maximum exemplars sampled for the BASIL-lite consistency check. */
    public const BASIL_SAMPLE_SIZE = 3;

    public function __construct(private PreferenceMemory $memory) {}

    /**
     * Record one anti-slop rejection event. Idempotent.
     *
     * v0.9: callers SHOULD pass $sessionId so the cross-session/day promotion
     * gate can run. When omitted (legacy callers), the gate falls back to
     * synthetic session ids derived from the text fingerprint — i.e. every
     * distinct text counts as a distinct session, preserving v0.85 behavior.
     *
     * @param array{layer?:string, match?:string, severity?:string, kind?:string} $violationMatch
     *        A single violation entry from ValidationResult::$violations, or a
     *        synthetic shape carrying at least {match}.
     * @return array{
     *   recorded:bool, promoted:bool, phrase:string, count:int,
     *   rule_id:?string, threshold:int,
     *   gate?: array{passed:bool, reason?:string, distinct_contexts?:int}
     * }
     */
    public function record(
        string $siteId,
        string $text,
        array $violationMatch,
        int $threshold = self::PROMOTION_THRESHOLD,
        ?string $sessionId = null
    ): array {
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
                'contexts' => [], // v0.9: list<{session_id, day}>
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

        // v0.9: record (session_id, day) context for the cross-session/day gate.
        // Falls back to a per-text synthetic session id when callers don't
        // supply one — keeps v0.85 callers' behavior intact (1 text = 1 ctx).
        $effectiveSessionId = $sessionId !== null && $sessionId !== ''
            ? $sessionId
            : 'anon_' . substr(hash('sha256', $text), 0, 12);
        $day = $this->siteLocalDay();
        $contexts = $bucket['phrases'][$normalised]['contexts'] ?? [];
        $contexts[] = [
            'session_id' => $effectiveSessionId,
            'day' => $day,
            'ts' => gmdate('c'),
        ];
        if (count($contexts) > self::MAX_CONTEXTS_PER_PHRASE) {
            $contexts = array_slice($contexts, -self::MAX_CONTEXTS_PER_PHRASE);
        }
        $bucket['phrases'][$normalised]['contexts'] = $contexts;

        $currentCount = (int) $bucket['phrases'][$normalised]['count'];
        $promoted = false;
        $ruleId = $bucket['phrases'][$normalised]['rule_id'] ?? null;
        $gate = ['passed' => false, 'reason' => 'below_threshold', 'distinct_contexts' => 0];

        if (!$bucket['phrases'][$normalised]['promoted'] && $currentCount >= $threshold) {
            $gate = $this->evaluatePromotionGate(
                $siteId,
                $normalised,
                $phrase,
                $contexts,
                $effectiveSessionId,
                $bucket
            );

            if ($gate['passed']) {
                try {
                    $rationale = $this->buildRationale(
                        $phrase,
                        $currentCount,
                        $gate['distinct_contexts'] ?? 0,
                        $bucket['phrases'][$normalised]['first_seen'] ?? gmdate('c')
                    );
                    $rule = Rule::create(
                        siteId: $siteId,
                        kind: Rule::KIND_FORBIDDEN_PHRASE,
                        pattern: $phrase,
                        directive: 'Avoid the phrase "' . $phrase . '" — repeatedly rejected on this site.',
                        provenance: [
                            'source' => 'anti_slop_feedback',
                            'observed_count' => $currentCount,
                            'distinct_contexts' => $gate['distinct_contexts'] ?? 0,
                            'first_seen' => $bucket['phrases'][$normalised]['first_seen'],
                            'last_seen' => $bucket['phrases'][$normalised]['last_seen'],
                            'session_id' => $effectiveSessionId,
                            'gate_version' => 'v0.9',
                        ],
                        scope: 'global',
                        confidence: min(1.0, 0.5 + ($currentCount - $threshold) * 0.1),
                        rationale: $rationale,
                    );
                    $added = $this->memory->add($rule);
                    $ruleId = $added->id;
                    $bucket['phrases'][$normalised]['promoted'] = true;
                    $bucket['phrases'][$normalised]['rule_id'] = $ruleId;
                    $promoted = true;
                    // Stamp the rate-limit window so the next promotion on
                    // this session can't happen for PROMOTION_RATE_LIMIT_SECONDS.
                    $bucket['session_last_promotion'][$effectiveSessionId] = time();
                } catch (\Throwable $e) {
                    // #16: no silent failures.
                    Logger::error('anti_slop.promotion_failed', [
                        'site_id' => $siteId, 'phrase' => $phrase, 'error' => $e->getMessage(),
                    ]);
                    throw $e;
                }
            } else {
                Logger::info('anti_slop.promotion_deferred', [
                    'site_id' => $siteId,
                    'phrase' => $normalised,
                    'reason' => $gate['reason'] ?? 'unknown',
                    'count' => $currentCount,
                    'distinct_contexts' => $gate['distinct_contexts'] ?? 0,
                ]);
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
            'gate' => $gate,
        ];
    }

    /**
     * v0.9 promotion gate. Returns {passed, reason, distinct_contexts}.
     *
     * Gate sequence:
     *   1. Cross-session/day: distinct (session OR day) count >= DISTINCT_CONTEXTS_REQUIRED.
     *   2. Per-session rate limit: at most 1 promotion / 10min / session.
     *   3. BASIL-lite Bayesian-consistency check against the exemplar pack
     *      (when ExemplarPackManager is available — W10c).
     *
     * @param array<int,array{session_id:string,day:string,ts:string}> $contexts
     * @param array<string,mixed> $bucket
     * @return array{passed:bool, reason:string, distinct_contexts:int}
     */
    private function evaluatePromotionGate(
        string $siteId,
        string $normalisedPhrase,
        string $rawPhrase,
        array $contexts,
        string $effectiveSessionId,
        array $bucket
    ): array {
        // 1. Cross-session/day threshold.
        $distinctSessions = [];
        $distinctDays = [];
        foreach ($contexts as $ctx) {
            if (!empty($ctx['session_id'])) $distinctSessions[(string) $ctx['session_id']] = true;
            if (!empty($ctx['day']))        $distinctDays[(string) $ctx['day']] = true;
        }
        $distinct = max(count($distinctSessions), count($distinctDays));
        if ($distinct < self::DISTINCT_CONTEXTS_REQUIRED) {
            return [
                'passed' => false,
                'reason' => 'cross_session_or_day_threshold_not_met',
                'distinct_contexts' => $distinct,
            ];
        }

        // 2. Per-session rate limit.
        $lastPromotion = (int) ($bucket['session_last_promotion'][$effectiveSessionId] ?? 0);
        if ($lastPromotion > 0 && (time() - $lastPromotion) < self::PROMOTION_RATE_LIMIT_SECONDS) {
            return [
                'passed' => false,
                'reason' => 'rate_limited',
                'distinct_contexts' => $distinct,
            ];
        }

        // 3. BASIL-lite consistency check (guarded by class_exists — W10c).
        if (class_exists('\\Joist\\ExemplarPack\\ExemplarPackManager')) {
            try {
                if (!$this->basilConsistent($siteId, $rawPhrase, $normalisedPhrase)) {
                    return [
                        'passed' => false,
                        'reason' => 'basil_consistency_failed',
                        'distinct_contexts' => $distinct,
                    ];
                }
            } catch (\Throwable $e) {
                // BASIL check failing internally MUST NOT block promotion —
                // but it MUST be logged (#16). Fail open is the right call
                // here: BASIL is advisory, the cross-session gate is the
                // hard guard.
                Logger::warn('anti_slop.basil_check_failed', [
                    'site_id' => $siteId,
                    'phrase' => $normalisedPhrase,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return ['passed' => true, 'reason' => 'ok', 'distinct_contexts' => $distinct];
    }

    /**
     * BASIL-lite: sample up to BASIL_SAMPLE_SIZE approved exemplars. If any
     * of them contain the rejected phrase as a substring, the new rejection
     * is INCONSISTENT with prior approvals → refuse promotion.
     *
     * Lives behind class_exists() — W10c (ExemplarPackManager) is building
     * in parallel; we don't import the class to avoid an autoload hard
     * dependency.
     */
    private function basilConsistent(string $siteId, string $rawPhrase, string $normalisedPhrase): bool
    {
        $class = '\\Joist\\ExemplarPack\\ExemplarPackManager';
        if (!class_exists($class) || !method_exists($class, 'sampleApproved')) {
            return true; // open
        }
        // Call via callable to avoid PHPStan / static analyzers tracking a
        // non-existent class through hard references.
        $callable = [$class, 'sampleApproved'];
        if (!is_callable($callable)) return true;

        $samples = $callable($siteId, self::BASIL_SAMPLE_SIZE);
        if (!is_array($samples) || empty($samples)) return true;

        foreach ($samples as $sample) {
            $text = '';
            if (is_string($sample)) {
                $text = $sample;
            } elseif (is_array($sample)) {
                $text = (string) ($sample['text'] ?? $sample['copy'] ?? $sample['content'] ?? '');
            }
            if ($text === '') continue;
            // Direct substring match (case-insensitive) on the normalised phrase.
            if (stripos($text, $normalisedPhrase) !== false) {
                return false; // approved exemplar contains the phrase → noise
            }
        }
        return true;
    }

    /**
     * Build a rationale string for the promoted rule. The agent reads this
     * back at session start (renderForPrompt) so it knows WHY the rule
     * exists. Per WAVE_9 §5 / preference_memory_pattern.md Layer 2.
     */
    private function buildRationale(string $phrase, int $count, int $distinctContexts, string $firstSeen): string
    {
        return sprintf(
            'Promoted after %d rejections across %d distinct sessions/days '
            . '(first seen %s); pattern: "%s". Source: anti-slop feedback loop.',
            $count,
            $distinctContexts,
            $firstSeen,
            $phrase
        );
    }

    /**
     * Site-local calendar day (Y-m-d) for the cross-day promotion gate.
     * Uses the WP-configured timezone via wp_timezone() so 2 hits at
     * 23:55 and 00:05 (site time) count as distinct days, matching user
     * expectation.
     */
    private function siteLocalDay(): string
    {
        $tz = function_exists('wp_timezone') ? wp_timezone() : new \DateTimeZone('UTC');
        return (new \DateTimeImmutable('now', $tz))->format('Y-m-d');
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
