<?php
declare(strict_types=1);

namespace Joist\Eval;

/**
 * Per-site preference memory — Joist's "self-improve" loop.
 *
 * Captures user corrections (initially from plan rejection notes), persists them
 * scoped to the site, and surfaces them at session start so the agent stops
 * making the same mistakes.
 *
 * Convergent pattern across 8 systems (see memory/preference_memory_pattern.md):
 * small, named, human-readable, agent-self-edited, loaded at session start, with
 * deliberate compaction discipline.
 *
 * Backing store: wp_joist_preferences custom table.
 */
final class PreferenceMemory
{
    /** Max active rules pre-loaded into prompt at session start. */
    public const RENDER_RULE_CAP = 40;

    /** Approximate token budget for the rendered preferences block. */
    public const RENDER_TOKEN_BUDGET = 800;

    public function tableName(): string
    {
        global $wpdb;
        return $wpdb->prefix . 'joist_preferences';
    }

    /**
     * Identify the current site partition key. On multisite this is the blog ID;
     * on single-site it's the home URL host. Always a stable string.
     */
    public function siteId(): string
    {
        if (is_multisite()) {
            return 'blog_' . (int) get_current_blog_id();
        }
        $host = wp_parse_url(home_url(), PHP_URL_HOST) ?: 'default';
        return 'host_' . preg_replace('/[^a-z0-9_.-]/i', '_', strtolower($host));
    }

    public function add(Rule $rule): Rule
    {
        // Dedup: same site + same kind + same pattern → bump confidence, update directive.
        $existing = $this->findByPattern($rule->siteId, $rule->kind, $rule->pattern);
        if ($existing !== null) {
            $existing->confidence = min(1.0, $existing->confidence + 0.1);
            $existing->directive = $rule->directive; // last-write-wins
            $existing->status = Rule::STATUS_ACTIVE;
            // Merge provenance arrays preserving history.
            $existing->provenance = array_slice(
                array_merge([$rule->provenance], $existing->provenance),
                0,
                10
            );
            // v0.9: a fresh add() of an existing rule is a reinforcement event —
            // reset the decay clock. Also prefer the new rationale when supplied.
            if ($rule->rationale !== null && $rule->rationale !== '') {
                $existing->rationale = $rule->rationale;
            }
            $existing->reinforce();
            $this->update($existing);
            return $existing;
        }

        global $wpdb;
        $wpdb->insert($this->tableName(), $rule->toRow());
        return $rule;
    }

    public function update(Rule $rule): void
    {
        global $wpdb;
        // v0.9: any explicit update is a reinforcement event — stops decay.
        $rule->reinforce();
        $row = $rule->toRow();
        unset($row['id']);
        $wpdb->update($this->tableName(), $row, ['id' => $rule->id]);
    }

    public function archive(string $id): void
    {
        global $wpdb;
        $wpdb->update(
            $this->tableName(),
            ['status' => Rule::STATUS_ARCHIVED],
            ['id' => $id]
        );
    }

    public function get(string $id): ?Rule
    {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT * FROM {$this->tableName()} WHERE id = %s",
                $id
            ),
            ARRAY_A
        );
        return $row ? Rule::fromRow($row) : null;
    }

    /** @return list<Rule> */
    public function listActive(?string $siteId = null): array
    {
        $siteId = $siteId ?? $this->siteId();
        global $wpdb;
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM {$this->tableName()}
                 WHERE site_id = %s AND status = %s
                 ORDER BY confidence DESC, last_invoked_at DESC, created_at DESC",
                $siteId,
                Rule::STATUS_ACTIVE
            ),
            ARRAY_A
        );
        return array_map([Rule::class, 'fromRow'], $rows ?: []);
    }

    /** @return list<Rule> */
    public function listAll(?string $siteId = null, int $limit = 200): array
    {
        $siteId = $siteId ?? $this->siteId();
        global $wpdb;
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT * FROM {$this->tableName()}
                 WHERE site_id = %s
                 ORDER BY created_at DESC LIMIT %d",
                $siteId,
                $limit
            ),
            ARRAY_A
        );
        return array_map([Rule::class, 'fromRow'], $rows ?: []);
    }

    private function findByPattern(string $siteId, string $kind, string $pattern): ?Rule
    {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare(
                "SELECT * FROM {$this->tableName()}
                 WHERE site_id = %s AND kind = %s AND pattern = %s
                 LIMIT 1",
                $siteId,
                $kind,
                $pattern
            ),
            ARRAY_A
        );
        return $row ? Rule::fromRow($row) : null;
    }

    /**
     * Render the active rules as a compact markdown block for prompt injection.
     * Cap to RENDER_RULE_CAP rules and roughly RENDER_TOKEN_BUDGET tokens
     * (estimated at 4 chars/token).
     */
    public function renderForPrompt(?string $siteId = null): string
    {
        $rules = $this->listActive($siteId);
        if (count($rules) === 0) {
            return '';
        }

        $rules = array_slice($rules, 0, self::RENDER_RULE_CAP);

        $byKind = [];
        foreach ($rules as $r) {
            $byKind[$r->kind][] = $r;
        }

        $out = ["## Site preferences (from past edits — honor these)"];

        $kindLabels = [
            Rule::KIND_FORBIDDEN_PHRASE => "Forbidden phrases (never write these)",
            Rule::KIND_PREFERRED_VOCAB => "Preferred vocabulary",
            Rule::KIND_VOICE_RULE => "Brand voice",
            Rule::KIND_LAYOUT_PREFERENCE => "Layout preferences",
            Rule::KIND_COLOR_PREFERENCE => "Color preferences",
            Rule::KIND_ELEMENT_REFUSED => "Refused element types",
            Rule::KIND_STRUCTURAL => "Structural preferences",
        ];

        $budgetChars = self::RENDER_TOKEN_BUDGET * 4;
        $total = strlen($out[0]);

        foreach ($kindLabels as $kind => $label) {
            if (empty($byKind[$kind])) continue;
            $section = ["", "**{$label}:**"];
            foreach ($byKind[$kind] as $r) {
                // v0.9: surface rationale inline when present — explanation
                // generalises better than the rule directive alone.
                $line = '- ' . $r->directive;
                if ($r->rationale !== null && $r->rationale !== '') {
                    $line .= ' _(' . $r->rationale . ')_';
                }
                $section[] = $line;
            }
            $sectionText = implode("\n", $section);
            if ($total + strlen($sectionText) > $budgetChars) break;
            $out[] = $sectionText;
            $total += strlen($sectionText);
        }

        return implode("\n", $out);
    }

    /**
     * Mark a rule as invoked (drives last_invoked_at and confidence promotion).
     */
    public function recordInvocation(string $id): void
    {
        global $wpdb;
        $now = gmdate('Y-m-d H:i:s');
        $wpdb->update(
            $this->tableName(),
            [
                'last_invoked_at' => $now,
                // v0.9: an invocation is also a reinforcement signal.
                'last_reinforced_at' => $now,
                'confidence' => min(1.0, $this->get($id)?->confidence + 0.05 ?? 1.0),
            ],
            ['id' => $id]
        );
    }

    /**
     * Daily compaction job. v0.7: last-write-wins on (site_id, kind, pattern).
     * v1.5+ adds LLM-driven semantic dedup + frequency-weighted promotion.
     */
    public function compact(?string $siteId = null): array
    {
        $siteId = $siteId ?? $this->siteId();
        global $wpdb;

        // Archive duplicate (site_id, kind, pattern) keeping the highest-confidence one.
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT id, kind, pattern, confidence, created_at
                 FROM {$this->tableName()}
                 WHERE site_id = %s AND status = %s
                 ORDER BY confidence DESC, created_at DESC",
                $siteId,
                Rule::STATUS_ACTIVE
            ),
            ARRAY_A
        );
        $seen = [];
        $archived = [];
        foreach ($rows as $row) {
            $key = $row['kind'] . '|' . $row['pattern'];
            if (isset($seen[$key])) {
                $wpdb->update(
                    $this->tableName(),
                    ['status' => Rule::STATUS_SUPERSEDED, 'superseded_by' => $seen[$key]],
                    ['id' => $row['id']]
                );
                $archived[] = $row['id'];
            } else {
                $seen[$key] = $row['id'];
            }
        }

        // Also archive any rule with last_invoked_at older than 180 days and confidence < 0.4
        // (stale + low-confidence = probably wrong).
        $staleCutoff = gmdate('Y-m-d H:i:s', time() - 180 * 86400);
        $stale = $wpdb->get_col(
            $wpdb->prepare(
                "SELECT id FROM {$this->tableName()}
                 WHERE site_id = %s AND status = %s
                 AND confidence < 0.4
                 AND (last_invoked_at IS NULL OR last_invoked_at < %s)
                 AND created_at < %s",
                $siteId,
                Rule::STATUS_ACTIVE,
                $staleCutoff,
                $staleCutoff
            )
        );
        foreach ($stale as $id) {
            $wpdb->update(
                $this->tableName(),
                ['status' => Rule::STATUS_ARCHIVED],
                ['id' => $id]
            );
            $archived[] = $id;
        }

        return [
            'archived' => $archived,
            'site_id' => $siteId,
            'compacted_at' => gmdate('Y-m-d H:i:s'),
        ];
    }
}
