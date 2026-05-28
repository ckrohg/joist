<?php
declare(strict_types=1);

namespace Joist\Elementor;

/**
 * @purpose Detect the host Elementor major version and decide whether writes
 *          must route through the legacy V3 (`_elementor_data` JSON tree) or
 *          the V4 atomic-elements schema path. Pure function; no side effects,
 *          no hooks, no logging — safe to call before `plugins_loaded`.
 *
 * This is the chokepoint enforcing failure-mode constraint #17 (see
 * memory: failure_mode_constraints.md — "Detect Elementor major version on
 * connect; refuse-or-adapt"). The decision lives in ONE place and every
 * write must consult it; never silently write the wrong schema.
 *
 * Pattern mirrors `Joist\Platform\WPVersionDetector::detect()` — read a
 * global constant defensively, version_compare(), and feature-gate on the
 * result. Honors a `JOIST_TEST_ELEMENTOR_VERSION` env override but ONLY when
 * `WP_DEBUG` is on, so production cannot be tricked.
 *
 * Routing kinds returned in `RoutingDecision::kind`:
 *   - `legacy_v3`   — Elementor 3.x; write via existing DocumentWriter (no
 *                     behavior change from pre-Wave-3).
 *   - `atomic_v4`   — Elementor 4.x. If `known_broken` is also true, refuse;
 *                     otherwise route through AtomicDocumentWriter.
 *   - `unsupported` — Elementor missing, major < 3, or major >= 5. Refuse
 *                     all writes with `unsupported_elementor_major`.
 *
 * The `known_broken` flag marks versions where Elementor itself has open
 * confirmed-broken save issues. As of 2026-05-28 this is 4.0.0 through 4.1.1
 * inclusive — see notes below. We refuse writes against these versions per
 * failure-mode constraint #16 (refuse silently-failing operations), pointing
 * the user at the upstream issue so they understand it's not a Joist bug.
 *
 * Open Elementor bugs informing the known_broken range (verified 2026-05-28):
 *   - https://github.com/elementor/elementor/issues/35888 (open) — atomic
 *     element saves fail silently with `this.view.container is undefined`
 *     and `elementor.documents.getCurrent() is null`. Affects 4.0.x + 4.1.x.
 *   - https://github.com/elementor/elementor/issues/35625 (open) — V4 atomic
 *     styling embedded in V3 templates throws `Argument #2 ($post) must be
 *     of type WP_Post, null given`. Affects 4.0.4 confirmed.
 *   - https://github.com/elementor/elementor/issues/36008 (open) — cannot
 *     save site settings (Style Kit) when Atomic Editor enabled. Affects
 *     4.1.0 confirmed.
 *   - https://github.com/orgs/elementor/discussions/35627 (open, no official
 *     workaround) — "Atomic Editor breaks the site when activated".
 *   - https://github.com/elementor/elementor/issues/33000 (open) — V4 atomic
 *     element settings save returns an error (persistent across 4.0.x).
 *
 * V4 ATOMIC API REFERENCE (verified 2026-05-28 via source):
 *   - Module namespace: `Elementor\Modules\AtomicWidgets`
 *   - Module class: `Elementor\Modules\AtomicWidgets\Module` extends BaseModule
 *   - Base atomic element: `Elementor\Modules\AtomicWidgets\Elements\Base\Atomic_Element_Base`
 *     extends `Element_Base` (V3 base class)
 *   - Base atomic widget: `Elementor\Modules\AtomicWidgets\Elements\Base\Atomic_Widget_Base`
 *     extends `Widget_Base` (V3 base class)
 *   - Schema introspection trait: `Elementor\Modules\AtomicWidgets\Elements\Base\Has_Atomic_Base`
 *     - `public function get_atomic_controls(): array` — control schema with validation
 *     - `public static function get_props_schema(): array<string, Prop_Type>`
 *     - `public function get_atomic_settings(): array` — resolved settings
 *   - Element registration: `\Elementor\Plugin::$instance->elements_manager->register_element_type($el)`
 *     fired on `elementor/elements/elements_registered` action
 *   - Element enumeration: `\Elementor\Plugin::$instance->elements_manager->get_element_types(): Element_Base[]`
 *     (returns BOTH legacy and atomic elements; filter by instanceof)
 *   - Atomic element type slugs: `e-flexbox`, `e-div-block`, `e-grid`, `e-heading`,
 *     `e-paragraph`, `e-button`, `e-image`, `e-svg`, `e-youtube`, `e-divider`,
 *     `e-self-hosted-video`, `e-component`, atomic-tabs/atomic-form variants.
 *   - Save path: Document::save() — same as V3, but the V4 atomic schema goes
 *     into the same `_elementor_data` slot. The broken save reports above all
 *     stem from this overloaded slot + the V4 transformer pipeline.
 *
 * Source URLs for V4 API claims:
 *   - https://github.com/elementor/elementor/blob/main/modules/atomic-widgets/module.php
 *   - https://github.com/elementor/elementor/blob/main/modules/atomic-widgets/elements/base/atomic-element-base.php
 *   - https://github.com/elementor/elementor/blob/main/modules/atomic-widgets/elements/base/atomic-widget-base.php
 *   - https://github.com/elementor/elementor/blob/main/modules/atomic-widgets/elements/base/has-atomic-base.php
 *   - https://github.com/elementor/elementor/blob/main/includes/managers/elements.php
 *   - https://raw.githubusercontent.com/elementor/elementor/main/changelog.txt
 */
final class VersionRouter
{
    /** Kind sentinel: legacy V3 (3.x) write path; no behavior change. */
    public const KIND_LEGACY_V3 = 'legacy_v3';
    /** Kind sentinel: V4 atomic-elements write path. */
    public const KIND_ATOMIC_V4 = 'atomic_v4';
    /** Kind sentinel: unsupported or missing Elementor. Refuse all writes. */
    public const KIND_UNSUPPORTED = 'unsupported';

    /**
     * The V4 version range we treat as `known_broken`. Both endpoints
     * inclusive (uses version_compare semantics). When Elementor merges
     * fixes for #35888 / #35625 / #36008 we narrow this range.
     *
     * As of 2026-05-28: 4.0.0 through 4.1.1 inclusive — every released
     * 4.x version has confirmed-open save issues. We expect to narrow
     * this once #35888 closes.
     *
     * TODO(elementor-v4-known-broken-narrow): re-evaluate on every
     * Elementor release; narrow the upper bound when the trio of open
     * save issues closes. Track via the URLs in the class docblock.
     */
    public const KNOWN_BROKEN_MIN = '4.0.0';
    public const KNOWN_BROKEN_MAX = '4.1.1';

    /** Major version we consider supported on the legacy path. */
    public const LEGACY_V3_MIN_MAJOR = 3;
    /** First V4 major. */
    public const ATOMIC_V4_MAJOR = 4;
    /** Anything >= this major is unsupported until we ship an adapter. */
    public const UNSUPPORTED_MAJOR_FLOOR = 5;

    /**
     * Detect the host Elementor version and produce a routing decision.
     *
     * Reads the `ELEMENTOR_VERSION` constant Elementor itself defines.
     * Honors `JOIST_TEST_ELEMENTOR_VERSION` env override only when
     * `WP_DEBUG` is on (test-only — used by tests/manual/acceptance.sh).
     *
     * Pure function; no logging, no hooks, no state.
     */
    public static function detect(): RoutingDecision
    {
        // Test-only env override. Honored ONLY when WP_DEBUG is on.
        // Same shape as Joist\Platform\WPVersionDetector::detect().
        $envOverride = getenv('JOIST_TEST_ELEMENTOR_VERSION');
        if (
            $envOverride !== false
            && $envOverride !== ''
            && defined('WP_DEBUG') && WP_DEBUG
        ) {
            return self::buildDecision((string) $envOverride, 'env_override');
        }

        // Defensively: if Elementor's main bootstrap hasn't loaded the
        // constant yet, treat as unsupported rather than throw.
        if (!defined('ELEMENTOR_VERSION')) {
            return new RoutingDecision(
                kind: self::KIND_UNSUPPORTED,
                version: '0.0.0',
                major: 0,
                minor: 0,
                patch: 0,
                knownBroken: false,
                source: 'constant_missing',
                notes: [
                    'ELEMENTOR_VERSION constant is not defined; Elementor is not active or has not yet loaded.',
                ],
            );
        }

        return self::buildDecision((string) ELEMENTOR_VERSION, 'constant');
    }

    /**
     * Build the routing decision from a known version string.
     */
    private static function buildDecision(string $version, string $source): RoutingDecision
    {
        // Empty string is the same as missing.
        if ($version === '') {
            return new RoutingDecision(
                kind: self::KIND_UNSUPPORTED,
                version: '0.0.0',
                major: 0,
                minor: 0,
                patch: 0,
                knownBroken: false,
                source: $source,
                notes: ['Empty Elementor version string; treating as unsupported.'],
            );
        }

        [$major, $minor, $patch] = self::splitVersion($version);
        $notes = [];

        // Major-version routing decision.
        if ($major < self::LEGACY_V3_MIN_MAJOR) {
            return new RoutingDecision(
                kind: self::KIND_UNSUPPORTED,
                version: $version,
                major: $major,
                minor: $minor,
                patch: $patch,
                knownBroken: false,
                source: $source,
                notes: [sprintf(
                    'Elementor major version %d is below the supported floor (%d).',
                    $major,
                    self::LEGACY_V3_MIN_MAJOR
                )],
            );
        }

        if ($major >= self::UNSUPPORTED_MAJOR_FLOOR) {
            return new RoutingDecision(
                kind: self::KIND_UNSUPPORTED,
                version: $version,
                major: $major,
                minor: $minor,
                patch: $patch,
                knownBroken: false,
                source: $source,
                notes: [sprintf(
                    'Elementor major %d is above what Joist v0.85 has implemented (last supported major: %d). Refuse-or-adapt per failure-mode constraint #17.',
                    $major,
                    self::ATOMIC_V4_MAJOR
                )],
            );
        }

        // V4 path.
        if ($major === self::ATOMIC_V4_MAJOR) {
            $knownBroken = self::isKnownBroken($version);
            if ($knownBroken) {
                $notes[] = sprintf(
                    'Elementor %s is in the known-broken range (%s..%s). Open upstream issues: #35888, #35625, #36008, discussion #35627. Writes will be refused per failure-mode constraint #16.',
                    $version,
                    self::KNOWN_BROKEN_MIN,
                    self::KNOWN_BROKEN_MAX
                );
            } else {
                $notes[] = sprintf(
                    'Elementor %s — V4 atomic-elements path. Writes will route through AtomicDocumentWriter.',
                    $version
                );
            }
            return new RoutingDecision(
                kind: self::KIND_ATOMIC_V4,
                version: $version,
                major: $major,
                minor: $minor,
                patch: $patch,
                knownBroken: $knownBroken,
                source: $source,
                notes: $notes,
            );
        }

        // V3 path (major == 3). knownBroken is always false for V3 — the
        // open save bugs are V4 atomic only.
        $notes[] = sprintf(
            'Elementor %s — legacy V3 (_elementor_data tree) write path.',
            $version
        );
        return new RoutingDecision(
            kind: self::KIND_LEGACY_V3,
            version: $version,
            major: $major,
            minor: $minor,
            patch: $patch,
            knownBroken: false,
            source: $source,
            notes: $notes,
        );
    }

    /**
     * Is this version inside our known-broken window? Uses version_compare
     * so beta/RC/dev suffixes (e.g. 4.1.0-dev1, 4.0.9-beta2) work correctly.
     */
    private static function isKnownBroken(string $version): bool
    {
        return version_compare($version, self::KNOWN_BROKEN_MIN, '>=')
            && version_compare($version, self::KNOWN_BROKEN_MAX, '<=');
    }

    /**
     * Split a version string into integer major/minor/patch. Tolerates
     * suffixes (4.0.9-beta2 → 4, 0, 9) and short forms (4.1 → 4, 1, 0).
     *
     * @return array{0:int,1:int,2:int}
     */
    private static function splitVersion(string $version): array
    {
        $core = preg_replace('/[^0-9.].*$/', '', $version) ?? $version;
        $parts = explode('.', $core);
        $major = isset($parts[0]) && $parts[0] !== '' ? (int) $parts[0] : 0;
        $minor = isset($parts[1]) && $parts[1] !== '' ? (int) $parts[1] : 0;
        $patch = isset($parts[2]) && $parts[2] !== '' ? (int) $parts[2] : 0;
        return [$major, $minor, $patch];
    }
}
