<?php
declare(strict_types=1);

namespace Joist\Eval;

use Joist\Core\Logger;

/**
 * @purpose v0.9 Wave 10a — daily confidence-decay job for Rule rows.
 *
 * Per WAVE_9_2026-05-29.md §5 and memory/preference_memory_pattern.md Layer 2:
 * site preferences should not harden into law just because they were captured
 * in 2025. Confidence decays linearly over 90 days unless re-reinforced
 * (manual edit, re-promotion, /memory/str_replace, recordInvocation, etc.).
 *
 *   elapsed_days = (now - last_reinforced_at) in days
 *   confidence  -= elapsed_days / 90  (clamped to [0, 1])
 *
 * Rules whose decayed confidence falls to <= 0 are archived (status =
 * archived). They're not deleted — superseded_by traversal still works,
 * and the user can revive them via the admin UI / /preferences endpoints.
 *
 * Scheduling: registered as a daily WP-cron hook from Bootstrap. Hook name
 * `joist_confidence_decay_daily`. The job is idempotent — running it twice
 * the same day decays by the elapsed time since the LAST decay (which is
 * 0 if it already ran today), so duplicate runs are no-ops.
 *
 * Multisite: invoked per blog by callers that walk get_sites(); the job
 * itself is single-site (uses PreferenceMemory::siteId() implicitly via the
 * preferences table site_id partition column, and walks ALL site partitions
 * in one pass).
 *
 * Failure-mode constraint #16: errors are logged with context and re-raised
 * so wp-cron records the failure. Partial runs are safe — each rule is
 * updated independently.
 */
final class ConfidenceDecayJob
{
    /** Cron hook name. Bootstrap wires this to wp_schedule_event(...,'daily',...). */
    public const HOOK = 'joist_confidence_decay_daily';

    /** Decay horizon in days. 90 days → full decay from confidence=1.0. */
    public const DECAY_HORIZON_DAYS = 90;

    /** Batch size for the per-site sweep. Keeps memory bounded on huge sites. */
    public const BATCH_SIZE = 500;

    public function tableName(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'joist_preferences';
    }

    /**
     * Cron entry point. Sweep all active rules across all site partitions,
     * decay confidence, archive rules that fall to zero.
     *
     * @return array{
     *   scanned:int, decayed:int, archived:int,
     *   sites:int, finished_at:string
     * }
     */
    public function run(): array
    {
        global $wpdb;
        $table = $this->tableName();
        $now = time();
        $scanned = 0; $decayed = 0; $archived = 0;
        $siteSet = [];

        try {
            $offset = 0;
            while (true) {
                $rows = $wpdb->get_results(
                    $wpdb->prepare(
                        "SELECT id, site_id, confidence, last_reinforced_at, created_at, status
                         FROM {$table}
                         WHERE status = %s
                         ORDER BY id ASC
                         LIMIT %d OFFSET %d",
                        Rule::STATUS_ACTIVE,
                        self::BATCH_SIZE,
                        $offset
                    ),
                    ARRAY_A
                );
                if (!$rows) break;

                foreach ($rows as $row) {
                    $scanned++;
                    $siteSet[(string) $row['site_id']] = true;

                    $anchor = $row['last_reinforced_at'] ?: $row['created_at'];
                    if (!$anchor) continue;
                    $anchorTs = strtotime((string) $anchor . ' UTC');
                    if ($anchorTs === false) continue;

                    $elapsedDays = max(0.0, ($now - $anchorTs) / 86400.0);
                    if ($elapsedDays <= 0.0) continue;

                    $currentConfidence = (float) $row['confidence'];
                    $newConfidence = max(0.0, min(1.0,
                        $currentConfidence - ($elapsedDays / self::DECAY_HORIZON_DAYS)
                    ));
                    if (abs($newConfidence - $currentConfidence) < 0.0001 && $newConfidence > 0.0) {
                        continue;
                    }

                    $update = [
                        'confidence' => $newConfidence,
                        // Update the reinforcement anchor to "now" — the next
                        // decay pass measures from this point so we don't
                        // double-count elapsed time on consecutive runs.
                        'last_reinforced_at' => gmdate('Y-m-d H:i:s'),
                    ];
                    if ($newConfidence <= 0.0) {
                        $update['status'] = Rule::STATUS_ARCHIVED;
                        $archived++;
                    } else {
                        $decayed++;
                    }
                    $wpdb->update($table, $update, ['id' => (string) $row['id']]);
                }

                if (count($rows) < self::BATCH_SIZE) break;
                $offset += self::BATCH_SIZE;
            }
        } catch (\Throwable $e) {
            Logger::error('confidence_decay.run_failed', [
                'scanned' => $scanned,
                'decayed' => $decayed,
                'archived' => $archived,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }

        $result = [
            'scanned' => $scanned,
            'decayed' => $decayed,
            'archived' => $archived,
            'sites' => count($siteSet),
            'finished_at' => gmdate('Y-m-d H:i:s'),
        ];
        Logger::info('confidence_decay.run_ok', $result);
        return $result;
    }

    /**
     * Static cron callback. Lives behind a static so add_action can use it
     * without needing Container::get('confidenceDecayJob') at hook-fire time.
     */
    public static function cronEntry(): void
    {
        (new self())->run();
    }
}
