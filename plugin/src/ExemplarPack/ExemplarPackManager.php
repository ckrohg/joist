<?php
declare(strict_types=1);

namespace Joist\ExemplarPack;

use Joist\Core\Logger;

/**
 * @purpose Layer 3 of the v0.9 three-tier taste substrate — the exemplar pack.
 *
 * 5-20 *approved* design references stored as cached message-history examples.
 * The model reasons against concrete examples, not abstract rules. Refreshed
 * on Plan approval; pruned on a daily cron unless marked pinned.
 *
 * Cost envelope at the 5-min cache TTL (Anthropic Opus 4.7):
 *   - cache write: 1.25x base; read: 0.10x base
 *   - 3+ reads inside the window to break even
 *   - ~50K-token exemplar pack: ~$0.15 write + ~$0.0125 per read
 *
 * Critical invariants:
 *   - Per-site partition (hard isolation; cross-site reads/writes refused).
 *   - Negative anchors come from OTHER sites — fights taste collapse / Basic
 *     B*** Effect (arxiv 2509.02910). Without these, 700/700 trajectories
 *     converged to 12 dominant motifs in published research.
 *   - Do NOT attach the pack on out-of-loop runs (scheduled rebuilds without
 *     active session). The 5-min TTL only pays off in active bursts; opt-in
 *     via $opts['include'] in renderForPrompt().
 *   - FIFO eviction at MAX_APPROVED per site — pinned exemplars survive.
 *
 * Backing store: wp_joist_exemplars (DB migration 013).
 *
 * Failure-mode constraints honoured:
 *   #1  Validate every input; unknown body fields rejected (controller).
 *   #2  Read-after-write — REST returns the post-record state (controller).
 *   #16 Refuse silently-failing operations: pin/delete return false on not-
 *       found and the controller raises an explicit 404 rather than a no-op
 *       success.
 *   + Path-traversal hardening: site_id / exemplar_id are restricted to
 *     [A-Za-z0-9._-]{1,64} at both the REST router and the manager API.
 *   + Per-site partition: siteId is a required argument on every public
 *     method; no implicit current-site fallback that could leak across
 *     multisite blogs.
 */
final class ExemplarPackManager
{
    /** Per-site cap for approved exemplars. Older rows FIFO-evicted on insert (unless pinned). */
    public const MAX_APPROVED = 20;

    /** Per-site cap for rejected exemplars. Smaller because they're noisier signal. */
    public const MAX_REJECTED = 30;

    /** Default exemplars returned to renderForPrompt() before truncation. */
    public const DEFAULT_RENDER_LIMIT = 10;

    /** Default age-out threshold for purgeStaleExemplars(). */
    public const DEFAULT_PURGE_AGE_DAYS = 180;

    /** Soft cap on total rendered tokens. Matches the v0.9 cost envelope. */
    public const RENDER_TOKEN_BUDGET = 50000;

    /** Rough chars-per-token heuristic (matches BrandBlock::CHARS_PER_TOKEN_ESTIMATE). */
    private const CHARS_PER_TOKEN = 4;

    /** Brand-token signature divergence required to qualify as a negative anchor. */
    private const NEGATIVE_ANCHOR_MIN_DIVERGENCE = 0.5;

    public function __construct(
        private \wpdb $wpdb,
    ) {}

    /** Resolve the backing table name. Public for tests. */
    public function tableName(): string
    {
        return $this->wpdb->prefix . 'joist_exemplars';
    }

    /**
     * Record an approved exemplar. Called when a Plan is approved and executes
     * successfully. Captures a compact rendering summary plus the full HTML
     * snapshot (for later embedding work) and the brand-token signature used
     * for negative-anchor divergence filtering.
     *
     * @param array{
     *   rendered_summary?: string,
     *   rendered_html?: string,
     *   brand_tokens?: array<string,mixed>,
     *   brand_tokens_signature?: string,
     *   plugin_source?: string,
     * } $rendered
     */
    public function recordApproval(string $siteId, int $planId, array $rendered): string
    {
        $this->assertValidSiteId($siteId);
        $exemplarId = $this->insertRow($siteId, $planId, $rendered, 'approved');
        $this->evictOverCap($siteId, 'approved', self::MAX_APPROVED);
        return $exemplarId;
    }

    /**
     * Record a rejected exemplar. Used by the v0.9 promotion gate's
     * BASIL-lite Bayesian-consistency check (see specs/WAVE_9_2026-05-29.md §5).
     */
    public function recordRejection(string $siteId, int $planId, array $rendered, string $reason): string
    {
        $this->assertValidSiteId($siteId);
        $rendered['rejection_reason'] = $reason;
        $exemplarId = $this->insertRow($siteId, $planId, $rendered, 'rejected');
        $this->evictOverCap($siteId, 'rejected', self::MAX_REJECTED);
        return $exemplarId;
    }

    /**
     * Fetch the last N approved exemplars for a site. Newest first.
     *
     * @return list<array{
     *   exemplar_id:string,
     *   rendered_summary:string,
     *   brand_tokens:array<string,mixed>,
     *   captured_at:string,
     *   pinned:bool,
     * }>
     */
    public function recentApproved(string $siteId, int $limit = self::DEFAULT_RENDER_LIMIT): array
    {
        $this->assertValidSiteId($siteId);
        $limit = max(1, min(self::MAX_APPROVED, $limit));
        $sql = $this->wpdb->prepare(
            "SELECT exemplar_id, rendered_summary, brand_tokens_signature, captured_at, pinned, rendered_html
             FROM {$this->tableName()}
             WHERE site_id = %s AND kind = %s
             ORDER BY pinned DESC, captured_at DESC
             LIMIT %d",
            $siteId,
            'approved',
            $limit
        );
        $rows = $this->wpdb->get_results($sql, ARRAY_A) ?: [];
        return array_map(fn($r) => $this->rowToApi($r), $rows);
    }

    /**
     * Return 5-10 references from OTHER sites flagged as "do not copy" anchors.
     *
     * Selection heuristic:
     *   1. Sample only from other sites (cross-site, never current-site domain).
     *   2. Prefer exemplars whose brand_tokens_signature differs by >=
     *      NEGATIVE_ANCHOR_MIN_DIVERGENCE from the current site's most-recent
     *      approved signature (cosine-approximated via Hamming-on-hash).
     *   3. Span at least 3 distinct other-site sources where available.
     *
     * Returns empty array on single-site installs (no cross-site exemplars
     * exist yet) — the controller passes this straight through and the
     * renderForPrompt() block degrades gracefully.
     *
     * @return list<array{
     *   exemplar_id:string,
     *   rendered_summary:string,
     *   source_site_id:string,
     *   brand_tokens_signature:string,
     *   divergence:float,
     * }>
     */
    public function negativeAnchors(string $siteId, int $limit = 5): array
    {
        $this->assertValidSiteId($siteId);
        $limit = max(1, min(10, $limit));

        $currentSig = $this->mostRecentSignature($siteId);

        // Sample 3x the requested limit so we can post-filter on divergence
        // without paying a per-row query cost.
        $sampleSize = $limit * 3;
        $sql = $this->wpdb->prepare(
            "SELECT exemplar_id, site_id, rendered_summary, brand_tokens_signature, captured_at
             FROM {$this->tableName()}
             WHERE site_id != %s AND kind = %s
             ORDER BY captured_at DESC
             LIMIT %d",
            $siteId,
            'approved',
            $sampleSize
        );
        $rows = $this->wpdb->get_results($sql, ARRAY_A) ?: [];

        // Bucket by source site so we span at least 3 distinct sources.
        $bySite = [];
        foreach ($rows as $row) {
            $src = (string) ($row['site_id'] ?? '');
            $sig = (string) ($row['brand_tokens_signature'] ?? '');
            $divergence = $currentSig === ''
                ? 1.0
                : $this->signatureDivergence($currentSig, $sig);
            if ($currentSig !== '' && $divergence < self::NEGATIVE_ANCHOR_MIN_DIVERGENCE) {
                continue;
            }
            $bySite[$src][] = [
                'exemplar_id' => (string) ($row['exemplar_id'] ?? ''),
                'rendered_summary' => (string) ($row['rendered_summary'] ?? ''),
                'source_site_id' => $src,
                'brand_tokens_signature' => $sig,
                'divergence' => round($divergence, 3),
            ];
        }

        // Round-robin across sources to span 3+ where possible.
        $out = [];
        $keys = array_keys($bySite);
        $idx = 0;
        while (count($out) < $limit && !empty($keys)) {
            $src = $keys[$idx % count($keys)];
            if (!empty($bySite[$src])) {
                $out[] = array_shift($bySite[$src]);
            }
            // If this source is exhausted, drop it from the round-robin set.
            if (empty($bySite[$src])) {
                $keys = array_values(array_filter($keys, fn($k) => !empty($bySite[$k])));
            }
            $idx++;
            // Safety: avoid an infinite loop if we exhaust before reaching limit.
            if (empty($keys)) break;
        }

        return $out;
    }

    /**
     * Build the cached message-history array for prompt assembly.
     *
     * Shape returned (matches Anthropic Messages API):
     *   [
     *     ['role' => 'user',      'content' => '<original brief or stub>'],
     *     ['role' => 'assistant', 'content' => '<approved rendering summary>'],
     *     ... up to N alternating pairs ...
     *     ['role' => 'user',      'content' => 'Anti-pattern references...'],
     *     ['role' => 'assistant', 'content' => 'Acknowledged. Avoiding ...'],
     *   ]
     *
     * The final assistant turn gets cache_control: ephemeral so the entire
     * pack sits in the cached prefix. The per-call request (added by the
     * CopyGenerator caller) lands OUTSIDE the cache, which is correct.
     *
     * @param array{
     *   limit?:int,
     *   include_negative?:bool,
     *   negative_limit?:int,
     *   include?:bool,
     * } $opts
     * @return list<array{role:string,content:string|list<array<string,mixed>>}>
     */
    public function renderForPrompt(string $siteId, array $opts = []): array
    {
        $this->assertValidSiteId($siteId);

        // The opt-in gate: callers that are out-of-loop (scheduled rebuilds
        // without an active session) pass include=false so we don't burn the
        // cache-write multiplier for nothing.
        if (array_key_exists('include', $opts) && $opts['include'] === false) {
            return [];
        }

        $limit = isset($opts['limit']) ? (int) $opts['limit'] : self::DEFAULT_RENDER_LIMIT;
        $includeNegative = $opts['include_negative'] ?? true;
        $negativeLimit = isset($opts['negative_limit']) ? (int) $opts['negative_limit'] : 5;

        $approved = $this->recentApproved($siteId, $limit);
        if (empty($approved) && !$includeNegative) {
            return [];
        }

        $messages = [];
        $budgetChars = self::RENDER_TOKEN_BUDGET * self::CHARS_PER_TOKEN;
        $charsUsed = 0;

        // Approved pairs (oldest-first in the message history so the model
        // sees recency as the trailing context — the latest approval is the
        // "most recent answer the user blessed").
        $approvedOldestFirst = array_reverse($approved);
        foreach ($approvedOldestFirst as $ex) {
            $userTurn = $this->approvedUserTurn($ex);
            $assistantTurn = $this->approvedAssistantTurn($ex);
            $pairChars = strlen($userTurn) + strlen($assistantTurn);
            if ($charsUsed + $pairChars > $budgetChars) {
                break;
            }
            $messages[] = ['role' => 'user', 'content' => $userTurn];
            $messages[] = ['role' => 'assistant', 'content' => $assistantTurn];
            $charsUsed += $pairChars;
        }

        // Negative anchors (anti-pattern reference messages).
        if ($includeNegative) {
            $anchors = $this->negativeAnchors($siteId, $negativeLimit);
            if (!empty($anchors)) {
                $antiUser = $this->negativeAnchorsUserTurn($anchors);
                $antiAssistant = $this->negativeAnchorsAssistantTurn();
                if ($charsUsed + strlen($antiUser) + strlen($antiAssistant) <= $budgetChars) {
                    $messages[] = ['role' => 'user', 'content' => $antiUser];
                    $messages[] = ['role' => 'assistant', 'content' => $antiAssistant];
                }
            }
        }

        if (empty($messages)) {
            return [];
        }

        // Mark the final assistant content with cache_control: ephemeral so
        // the entire pack lives in the cached prefix. Matches the pattern
        // used by BrandBlock::exemplarsAsMessages().
        $lastIdx = count($messages) - 1;
        $last = $messages[$lastIdx];
        $messages[$lastIdx] = [
            'role' => $last['role'],
            'content' => [
                [
                    'type' => 'text',
                    'text' => is_string($last['content']) ? $last['content'] : '',
                    'cache_control' => ['type' => 'ephemeral'],
                ],
            ],
        ];

        return $messages;
    }

    /**
     * Mark an exemplar as pinned (or unpinned). Pinned rows survive purge
     * and FIFO eviction. Returns true on success, false if the row was not
     * found or did not belong to the supplied site.
     */
    public function setPinned(string $siteId, string $exemplarId, bool $pinned): bool
    {
        $this->assertValidSiteId($siteId);
        $this->assertValidExemplarId($exemplarId);

        $affected = $this->wpdb->update(
            $this->tableName(),
            ['pinned' => $pinned ? 1 : 0],
            ['exemplar_id' => $exemplarId, 'site_id' => $siteId],
            ['%d'],
            ['%s', '%s']
        );
        return is_int($affected) && $affected > 0;
    }

    /**
     * Delete an exemplar explicitly (admin-only at the REST surface).
     */
    public function delete(string $siteId, string $exemplarId): bool
    {
        $this->assertValidSiteId($siteId);
        $this->assertValidExemplarId($exemplarId);

        $affected = $this->wpdb->delete(
            $this->tableName(),
            ['exemplar_id' => $exemplarId, 'site_id' => $siteId],
            ['%s', '%s']
        );
        return is_int($affected) && $affected > 0;
    }

    /**
     * Daily cron — drop exemplars older than ageDays unless pinned.
     * Returns the count of removed rows.
     */
    public function purgeStaleExemplars(int $ageDays = self::DEFAULT_PURGE_AGE_DAYS): int
    {
        $ageDays = max(1, $ageDays);
        $cutoff = gmdate('Y-m-d H:i:s', time() - ($ageDays * 86400));
        $sql = $this->wpdb->prepare(
            "DELETE FROM {$this->tableName()}
             WHERE captured_at < %s AND pinned = 0",
            $cutoff
        );
        $deleted = $this->wpdb->query($sql);
        $count = is_int($deleted) ? $deleted : 0;
        Logger::debug('joist.exemplar_pack.purge', [
            'cutoff' => $cutoff,
            'removed' => $count,
        ]);
        return $count;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ──────────────────────────────────────────────────────────────────────

    /**
     * Hard validate the site_id format. Used by every public method to
     * prevent path traversal / cross-site bleed (failure-mode constraint #16).
     *
     * Rule: alphanumeric, underscore, hyphen, period only; length 1-64.
     */
    public function assertValidSiteId(string $siteId): void
    {
        if ($siteId === '' || strlen($siteId) > 64) {
            throw new \InvalidArgumentException('exemplar_pack.invalid_site_id: length 1-64 required.');
        }
        if (!preg_match('/^[A-Za-z0-9._\-]+$/', $siteId)) {
            throw new \InvalidArgumentException('exemplar_pack.invalid_site_id: alphanumeric + . _ - only.');
        }
    }

    /** Same hardening for exemplar_id (used in path params). */
    public function assertValidExemplarId(string $exemplarId): void
    {
        if ($exemplarId === '' || strlen($exemplarId) > 64) {
            throw new \InvalidArgumentException('exemplar_pack.invalid_exemplar_id: length 1-64 required.');
        }
        if (!preg_match('/^[A-Za-z0-9._\-]+$/', $exemplarId)) {
            throw new \InvalidArgumentException('exemplar_pack.invalid_exemplar_id: alphanumeric + . _ - only.');
        }
    }

    /** @param array<string,mixed> $rendered */
    private function insertRow(string $siteId, int $planId, array $rendered, string $kind): string
    {
        $exemplarId = $this->generateId($siteId, $planId, $kind);
        $summary = isset($rendered['rendered_summary']) && is_string($rendered['rendered_summary'])
            ? $rendered['rendered_summary']
            : '';
        $html = isset($rendered['rendered_html']) && is_string($rendered['rendered_html'])
            ? $rendered['rendered_html']
            : '';
        // Brand-token signature: caller can supply an explicit one, else we
        // derive a stable hash from the brand_tokens array if present.
        $signature = '';
        if (isset($rendered['brand_tokens_signature']) && is_string($rendered['brand_tokens_signature'])) {
            $signature = substr($rendered['brand_tokens_signature'], 0, 128);
        } elseif (isset($rendered['brand_tokens']) && is_array($rendered['brand_tokens'])) {
            $signature = substr(hash('sha256', (string) wp_json_encode($rendered['brand_tokens'])), 0, 64);
        }

        // Persist the brand_tokens object inside rendered_summary as a JSON
        // sentinel suffix so consumers can recover it without a separate
        // column. Keeps the migration schema minimal.
        $payload = [
            'summary' => $summary,
            'brand_tokens' => $rendered['brand_tokens'] ?? null,
            'plugin_source' => $rendered['plugin_source'] ?? 'unknown',
            'rejection_reason' => $rendered['rejection_reason'] ?? null,
        ];
        $renderedSummaryStored = (string) wp_json_encode($payload);

        $this->wpdb->insert(
            $this->tableName(),
            [
                'exemplar_id' => $exemplarId,
                'site_id' => $siteId,
                'plan_id' => $planId > 0 ? $planId : null,
                'kind' => $kind,
                'rendered_summary' => $renderedSummaryStored,
                'rendered_html' => $html,
                'brand_tokens_signature' => $signature,
                'pinned' => 0,
                'captured_at' => gmdate('Y-m-d H:i:s'),
            ],
            ['%s', '%s', '%d', '%s', '%s', '%s', '%s', '%d', '%s']
        );

        return $exemplarId;
    }

    private function generateId(string $siteId, int $planId, string $kind): string
    {
        // Site + plan + kind + microtime gives uniqueness within a single
        // millisecond; the random suffix protects against same-tick collisions
        // when multiple plans complete in parallel.
        $material = $siteId . ':' . $planId . ':' . $kind . ':' . microtime(true) . ':' . wp_generate_password(8, false);
        return 'ex_' . substr(hash('sha256', $material), 0, 32);
    }

    /**
     * FIFO-evict unpinned rows beyond the per-site cap (oldest first).
     */
    private function evictOverCap(string $siteId, string $kind, int $cap): void
    {
        $sql = $this->wpdb->prepare(
            "SELECT exemplar_id FROM {$this->tableName()}
             WHERE site_id = %s AND kind = %s AND pinned = 0
             ORDER BY captured_at DESC
             LIMIT 9999 OFFSET %d",
            $siteId,
            $kind,
            $cap
        );
        $stale = $this->wpdb->get_col($sql) ?: [];
        if (empty($stale)) {
            return;
        }
        foreach ($stale as $id) {
            $this->wpdb->delete(
                $this->tableName(),
                ['exemplar_id' => $id, 'site_id' => $siteId, 'pinned' => 0],
                ['%s', '%s', '%d']
            );
        }
    }

    /** @param array<string,mixed> $row */
    private function rowToApi(array $row): array
    {
        $summaryRaw = (string) ($row['rendered_summary'] ?? '');
        $decoded = json_decode($summaryRaw, true);
        $brandTokens = is_array($decoded) && isset($decoded['brand_tokens']) && is_array($decoded['brand_tokens'])
            ? $decoded['brand_tokens']
            : [];
        $summary = is_array($decoded) && isset($decoded['summary']) && is_string($decoded['summary'])
            ? $decoded['summary']
            : $summaryRaw;
        return [
            'exemplar_id' => (string) ($row['exemplar_id'] ?? ''),
            'rendered_summary' => $summary,
            'brand_tokens' => $brandTokens,
            'captured_at' => (string) ($row['captured_at'] ?? ''),
            'pinned' => (int) ($row['pinned'] ?? 0) === 1,
        ];
    }

    private function mostRecentSignature(string $siteId): string
    {
        $sql = $this->wpdb->prepare(
            "SELECT brand_tokens_signature
             FROM {$this->tableName()}
             WHERE site_id = %s AND kind = 'approved' AND brand_tokens_signature != ''
             ORDER BY captured_at DESC
             LIMIT 1",
            $siteId
        );
        return (string) ($this->wpdb->get_var($sql) ?? '');
    }

    /**
     * Approximate cosine-similarity divergence from two signature hashes.
     *
     * We don't have embeddings in v0.9; the brand_tokens_signature is a
     * sha256 prefix. Hamming distance on the hex string is a coarse but
     * directional proxy — identical hashes → 0.0, totally different → ~1.0.
     */
    private function signatureDivergence(string $a, string $b): float
    {
        if ($a === '' || $b === '' || $a === $b) {
            return $a === $b ? 0.0 : 1.0;
        }
        $len = min(strlen($a), strlen($b));
        if ($len === 0) {
            return 1.0;
        }
        $different = 0;
        for ($i = 0; $i < $len; $i++) {
            if ($a[$i] !== $b[$i]) {
                $different++;
            }
        }
        return $different / $len;
    }

    /** @param array<string,mixed> $ex */
    private function approvedUserTurn(array $ex): string
    {
        $summary = (string) ($ex['rendered_summary'] ?? '');
        // The user turn synthesises the original brief from the rendered
        // summary's leading sentence (a reasonable proxy when we don't have
        // the literal brief on hand). If the summary is itself short, fall
        // back to a generic prompt — the assistant turn carries the signal.
        $lead = $this->firstSentence($summary);
        if ($lead === '') {
            return 'Approved reference (no recorded brief).';
        }
        return 'Approved reference. Brief: ' . $lead;
    }

    /** @param array<string,mixed> $ex */
    private function approvedAssistantTurn(array $ex): string
    {
        $summary = (string) ($ex['rendered_summary'] ?? '');
        if ($summary === '') {
            return 'Approved render (summary unavailable).';
        }
        return $summary;
    }

    /** @param list<array<string,mixed>> $anchors */
    private function negativeAnchorsUserTurn(array $anchors): string
    {
        $lines = [
            'Anti-pattern references (do NOT copy). These are renders from other',
            'sites included only as negative anchors to fight taste collapse.',
            '',
        ];
        foreach ($anchors as $i => $a) {
            $summary = (string) ($a['rendered_summary'] ?? '');
            $divergence = (float) ($a['divergence'] ?? 0.0);
            $lines[] = sprintf(
                '%d. [divergence=%.2f] %s',
                $i + 1,
                $divergence,
                $this->firstSentence($summary) ?: '(summary unavailable)'
            );
        }
        return implode("\n", $lines);
    }

    private function negativeAnchorsAssistantTurn(): string
    {
        return 'Acknowledged. These anti-patterns will not appear in this site\'s design.';
    }

    private function firstSentence(string $text): string
    {
        $text = trim($text);
        if ($text === '') return '';
        // Try JSON shape first — recorded summaries are JSON-encoded payloads.
        $decoded = json_decode($text, true);
        if (is_array($decoded) && isset($decoded['summary']) && is_string($decoded['summary'])) {
            $text = $decoded['summary'];
        }
        $text = (string) preg_replace('/\s+/', ' ', $text);
        $cut = preg_split('/(?<=[.!?])\s+/', $text, 2);
        $lead = is_array($cut) && isset($cut[0]) ? (string) $cut[0] : $text;
        return mb_substr($lead, 0, 240);
    }
}
