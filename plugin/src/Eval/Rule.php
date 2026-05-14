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
    ) {}

    /**
     * Construct a new rule with sensible defaults.
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
    ): self {
        self::assertValidKind($kind);
        self::assertValidStatus($status);
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
            createdAt: gmdate('Y-m-d H:i:s'),
            lastInvokedAt: null,
            supersededBy: null,
        );
    }

    public static function fromRow(array $row): self
    {
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
        ];
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
