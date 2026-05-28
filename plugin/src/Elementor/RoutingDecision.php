<?php
declare(strict_types=1);

namespace Joist\Elementor;

/**
 * @purpose Typed value object returned by VersionRouter::detect(). Captures
 *          the routing decision for a single Elementor host so every write
 *          path can consult ONE source of truth (failure-mode constraint #17).
 *
 * Immutable. Construct via readonly properties; do not mutate. The fields are
 * shaped to be serializable into JSON for inclusion in /site / /health
 * payloads without further transformation.
 *
 * Field semantics:
 *   - $kind          one of VersionRouter::KIND_LEGACY_V3 / KIND_ATOMIC_V4 /
 *                    KIND_UNSUPPORTED. Branch on this for routing.
 *   - $version       raw `ELEMENTOR_VERSION` string (or env-override value).
 *                    Preserved verbatim, including beta/dev suffixes.
 *   - $major/$minor/$patch  ints, parsed defensively from $version.
 *   - $knownBroken   when true, the live Elementor on this host has open
 *                    upstream issues making writes unsafe — refuse with
 *                    `atomic_save_unstable_in_v4` (constraint #16). May be
 *                    true only when $kind == KIND_ATOMIC_V4.
 *   - $source        sentinel describing where the version came from
 *                    ('constant' | 'env_override' | 'constant_missing').
 *   - $notes         human-readable strings for logs / admin notices.
 */
final class RoutingDecision
{
    /**
     * @param string $kind
     * @param string $version
     * @param int $major
     * @param int $minor
     * @param int $patch
     * @param bool $knownBroken
     * @param string $source
     * @param list<string> $notes
     */
    public function __construct(
        public readonly string $kind,
        public readonly string $version,
        public readonly int $major,
        public readonly int $minor,
        public readonly int $patch,
        public readonly bool $knownBroken,
        public readonly string $source,
        public readonly array $notes,
    ) {}

    /**
     * Serializable shape for /site, /health, and the REST error envelope.
     *
     * @return array{
     *   kind: string,
     *   version: string,
     *   major: int,
     *   minor: int,
     *   patch: int,
     *   known_broken: bool,
     *   source: string,
     *   notes: list<string>
     * }
     */
    public function toArray(): array
    {
        return [
            'kind' => $this->kind,
            'version' => $this->version,
            'major' => $this->major,
            'minor' => $this->minor,
            'patch' => $this->patch,
            'known_broken' => $this->knownBroken,
            'source' => $this->source,
            'notes' => $this->notes,
        ];
    }

    /** Convenience: this host can accept writes via the legacy V3 path. */
    public function isLegacyV3(): bool
    {
        return $this->kind === VersionRouter::KIND_LEGACY_V3;
    }

    /** Convenience: this host is V4 atomic (may still be `known_broken`). */
    public function isAtomicV4(): bool
    {
        return $this->kind === VersionRouter::KIND_ATOMIC_V4;
    }

    /** Convenience: this host is unsupported (missing, < 3.x, or >= 5.x). */
    public function isUnsupported(): bool
    {
        return $this->kind === VersionRouter::KIND_UNSUPPORTED;
    }

    /**
     * Convenience: this host should refuse all writes. True for unsupported
     * majors AND for known-broken V4 versions. Centralizing this in one
     * predicate keeps the refusal policy single-sourced.
     */
    public function shouldRefuseWrites(): bool
    {
        return $this->isUnsupported() || ($this->isAtomicV4() && $this->knownBroken);
    }
}
