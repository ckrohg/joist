<?php
declare(strict_types=1);

namespace Joist\Eval;

/**
 * A single preference rule captured per site.
 *
 * Value-object-ish (mutable for compaction). Backed by wp_joist_preferences row.
 */
final class Rule
{
    public const KIND_FORBIDDEN_PHRASE   = 'forbidden_phrase';
    public const KIND_PREFERRED_VOCAB    = 'preferred_vocab';
    public const KIND_VOICE_RULE         = 'voice_rule';
    public const KIND_LAYOUT_PREFERENCE  = 'layout_preference';
    public const KIND_COLOR_PREFERENCE   = 'color_preference';
    public const KIND_ELEMENT_REFUSED    = 'element_refused';
    public const KIND_STRUCTURAL         = 'structural';

    public const STATUS_ACTIVE          = 'active';
    public const STATUS_ARCHIVED        = 'archived';
    public const STATUS_SUPERSEDED      = 'superseded';
    public const STATUS_PENDING_REVIEW  = 'pending_review';

    public const VALID_KINDS = [
        self::KIND_FORBIDDEN_PHRASE, self::KIND_PREFERRED_VOCAB, self::KIND_VOICE_RULE,
        self::KIND_LAYOUT_PREFERENCE, self::KIND_COLOR_PREFERENCE,
        self::KIND_ELEMENT_REFUSED, self::KIND_STRUCTURAL,
    ];

    public const VALID_STATUSES = [
        self::STATUS_ACTIVE, self::STATUS_ARCHIVED,
        self::STATUS_SUPERSEDED, self::STATUS_PENDING_REVIEW,
    ];

    public function __construct(
        public string $id,
        public string $siteId,
        public string $kind,
        public string $scope,
        public string $pattern,
        public string $directive,
        public array $provenance,
        public float $confidence,
        public string $status,
        public string $createdAt,
        public ?string $lastInvokedAt,
        public ?string $supersededBy,
        // Wave 10a (v0.9): rationale-bearing fields per WAVE_9 §5.
        public ?string $rationale = null,
        public ?string $lastReinforcedAt = null,
    ) {}

    /**
     * Construct a new rule with sensible defaults.
     *
     * `rationale` is REQUIRED on SlopFeedback-promoted rules (the SlopFeedback
     * caller generates one); manually-authored rules MAY omit it and the
     * REST/CLI surface emits a warning when they do. See WAVE_9_2026-05-29.md
     * §5 and memory/preference_memory_pattern.md Layer 2.
     *
     * `lastReinforcedAt` defaults to the creation timestamp so the confidence
     * decay clock starts at rule birth.
     */
    public static function create(
        string $siteId,
        string $kind,
        string $pattern,
        string $directive,
        array $provenance = [],
        string $scope = 'global',
        float $confidence = 1.0,
        string $status = self::STATUS_ACTIVE,
        ?string $rationale = null,
        ?string $lastReinforcedAt = null,
    ): self {
        self::assertValidKind($kind);
        self::assertValidStatus($status);
        $now = gmdate('Y-m-d H:i:s');
        return new self(
            id: 'pref_' . bin2hex(random_bytes(8)),
            siteId: $siteId,
            kind: $kind,
            scope: $scope,
            pattern: $pattern,
            directive: $directive,
            provenance: $provenance,
            confidence: max(0.0, min(1.0, $confidence)),
            status: $status,
            createdAt: $now,
            lastInvokedAt: null,
            supersededBy: null,
            rationale: $rationale !== null ? trim($rationale) : null,
            lastReinforcedAt: $lastReinforcedAt ?? $now,
        );
    }

    public static function fromRow(array $row): self
    {
        // Backwards compat: rows from pre-migration-012 databases (or rows
        // serialised by older callers) won't carry the v0.9 fields. NULL is
        // an acceptable default in both cases — the decay job will refresh
        // last_reinforced_at on the next reinforcement event.
        return new self(
            id: (string) $row['id'],
            siteId: (string) $row['site_id'],
            kind: (string) $row['kind'],
            scope: (string) $row['scope'],
            pattern: (string) $row['pattern'],
            directive: (string) $row['directive'],
            provenance: is_string($row['provenance'] ?? null)
                ? (json_decode((string) $row['provenance'], true) ?: [])
                : (array) ($row['provenance'] ?? []),
            confidence: (float) ($row['confidence'] ?? 1.0),
            status: (string) $row['status'],
            createdAt: (string) $row['created_at'],
            lastInvokedAt: $row['last_invoked_at'] ?? null,
            supersededBy: $row['superseded_by'] ?? null,
            rationale: isset($row['rationale']) && $row['rationale'] !== ''
                ? (string) $row['rationale']
                : null,
            lastReinforcedAt: isset($row['last_reinforced_at']) && $row['last_reinforced_at'] !== ''
                ? (string) $row['last_reinforced_at']
                : null,
        );
    }

    /** @return array<string,mixed> */
    public function toRow(): array
    {
        return [
            'id' => $this->id,
            'site_id' => $this->siteId,
            'kind' => $this->kind,
            'scope' => $this->scope,
            'pattern' => $this->pattern,
            'directive' => $this->directive,
            'provenance' => wp_json_encode($this->provenance),
            'confidence' => $this->confidence,
            'status' => $this->status,
            'created_at' => $this->createdAt,
            'last_invoked_at' => $this->lastInvokedAt,
            'superseded_by' => $this->supersededBy,
            'rationale' => $this->rationale,
            'last_reinforced_at' => $this->lastReinforcedAt,
        ];
    }

    /** @return array<string,mixed> */
    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'kind' => $this->kind,
            'scope' => $this->scope,
            'pattern' => $this->pattern,
            'directive' => $this->directive,
            'provenance' => $this->provenance,
            'confidence' => $this->confidence,
            'status' => $this->status,
            'created_at' => $this->createdAt,
            'last_invoked_at' => $this->lastInvokedAt,
            'superseded_by' => $this->supersededBy,
            'rationale' => $this->rationale,
            'last_reinforced_at' => $this->lastReinforcedAt,
        ];
    }

    /**
     * Hydrate from an arbitrary array (e.g. a JSON envelope). Tolerates either
     * snake_case (DB-row shape) or camelCase (API shape) input. Unknown keys
     * are ignored — callers MUST validate upstream (failure-mode constraint
     * #1 on unknown fields applies at the REST surface, not here).
     *
     * @param array<string,mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $pick = static fn(string $snake, string $camel, mixed $default = null) =>
            $data[$snake] ?? $data[$camel] ?? $default;

        return new self(
            id: (string) ($pick('id', 'id') ?? ('pref_' . bin2hex(random_bytes(8)))),
            siteId: (string) ($pick('site_id', 'siteId') ?? ''),
            kind: (string) ($pick('kind', 'kind') ?? self::KIND_FORBIDDEN_PHRASE),
            scope: (string) ($pick('scope', 'scope') ?? 'global'),
            pattern: (string) ($pick('pattern', 'pattern') ?? ''),
            directive: (string) ($pick('directive', 'directive') ?? ''),
            provenance: (array) ($pick('provenance', 'provenance') ?? []),
            confidence: (float) ($pick('confidence', 'confidence') ?? 1.0),
            status: (string) ($pick('status', 'status') ?? self::STATUS_ACTIVE),
            createdAt: (string) ($pick('created_at', 'createdAt') ?? gmdate('Y-m-d H:i:s')),
            lastInvokedAt: $pick('last_invoked_at', 'lastInvokedAt'),
            supersededBy: $pick('superseded_by', 'supersededBy'),
            rationale: $pick('rationale', 'rationale'),
            lastReinforcedAt: $pick('last_reinforced_at', 'lastReinforcedAt'),
        );
    }

    /**
     * Alias of toApi() for callers that prefer the array-shape verb. Useful
     * when bundling rules into a JSON envelope (e.g. /agents-md emitter).
     *
     * @return array<string,mixed>
     */
    public function toArray(): array
    {
        return $this->toApi();
    }

    /**
     * Reset the reinforcement clock. Called on any update event that should
     * stop confidence decay (manual edit, re-promotion, /memory/str_replace).
     */
    public function reinforce(): void
    {
        $this->lastReinforcedAt = gmdate('Y-m-d H:i:s');
    }

    /** Test whether a piece of text violates this rule (forbidden_phrase only). */
    public function matches(string $text): bool
    {
        if ($this->kind !== self::KIND_FORBIDDEN_PHRASE) return false;
        if ($this->status !== self::STATUS_ACTIVE) return false;
        // Regex if surrounded by /…/flags, else literal substring case-insensitive.
        if (preg_match('|^/(.+)/([imsxu]*)$|', $this->pattern, $m)) {
            return (bool) @preg_match('/' . $m[1] . '/' . $m[2], $text);
        }
        return stripos($text, $this->pattern) !== false;
    }

    public static function assertValidKind(string $kind): void
    {
        if (!in_array($kind, self::VALID_KINDS, true)) {
            throw new \InvalidArgumentException("Invalid Rule kind: {$kind}");
        }
    }

    public static function assertValidStatus(string $status): void
    {
        if (!in_array($status, self::VALID_STATUSES, true)) {
            throw new \InvalidArgumentException("Invalid Rule status: {$status}");
        }
    }
}
