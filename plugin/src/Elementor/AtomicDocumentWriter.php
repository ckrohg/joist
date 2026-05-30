<?php
declare(strict_types=1);

namespace Joist\Elementor;

use Joist\Core\Hasher;
use Joist\Core\Logger;

/**
 * @purpose The V4 atomic-elements write path. Counterpart of DocumentWriter
 *          (which handles V3). DocumentWriter remains THE SPINE for all
 *          write-cross-cutting concerns (policy, locks, audit, snapshots,
 *          OCC); this class is invoked ONLY from DocumentWriter::save() after
 *          all cross-cutting checks have passed, and only when the host is
 *          V4 atomic AND not in the known-broken range.
 *
 * Three behaviors based on the RoutingDecision passed in:
 *
 *   1. `kind == atomic_v4` AND `known_broken == true`
 *      ──────────────────────────────────────────────
 *      Refuse with `atomic_save_unstable_in_v4` (HTTP 422). This is the
 *      right behavior per failure-mode constraint #16 — never write to a
 *      broken target. The error message points at the open upstream issues
 *      so the user understands it's not a Joist bug.
 *
 *   2. `kind == atomic_v4` AND `known_broken == false`
 *      ────────────────────────────────────────────────
 *      Attempt write via `Document::save()`. After the save, read the data
 *      back through `$document->get_elements_data()` and confirm the post-
 *      save state matches the intended state (constraint #2 — read-after-
 *      write). If the read-back differs from what we tried to write, surface
 *      `atomic_save_silent_failure` (the #35888 class of breakage).
 *      Regenerate CSS via `\Elementor\Core\Files\CSS\Post::create($id)->update()`
 *      AND verify regeneration succeeded (constraint #5).
 *
 *   3. `kind == legacy_v3`
 *      ──────────────────────
 *      Should never reach this class. If it does (defensive), refuse with
 *      `atomic_writer_misrouted`. The V3 path lives entirely in
 *      `DocumentWriter::save()` → `$document->save()` and must remain
 *      behavior-identical to pre-Wave-3.
 *
 * As of 2026-05-28 the known_broken range (4.0.0..4.1.1) covers every
 * released V4 version. Path 2 above is therefore exercised only when:
 *   - Elementor merges fixes for #35888 / #35625 / #36008 and ships a new
 *     version that we then add to the safe range, OR
 *   - A test sets JOIST_TEST_ELEMENTOR_VERSION to a future version (e.g.
 *     "4.2.0") with WP_DEBUG on, to validate the happy-path code.
 *
 * V4 SAVE-PATH NOTES (verified 2026-05-28):
 *   - `Document::save(['elements' => $tree])` is still the public entry
 *     point on 4.x — the same path V3 uses. V4 atomic data flows through
 *     the same `_elementor_data` slot but the structure of the tree is
 *     different (elType values like `e-flexbox` / `e-heading` rather than
 *     `container` / `widget`).
 *   - CSS regeneration is still `\Elementor\Core\Files\CSS\Post::create($id)
 *     ->update()` on 4.x (the file path / generation pipeline differs but
 *     the public entry point is preserved).
 *   - `$document->get_elements_data()` continues to return the canonical
 *     read-back shape on 4.x.
 *   - We do NOT call `documents->getCurrent()` — that's the surface broken
 *     by #35888 and we have no legitimate need for it server-side.
 *
 * Source URLs:
 *   - https://github.com/elementor/elementor/blob/main/includes/managers/elements.php
 *   - https://github.com/elementor/elementor/blob/main/core/base/document.php
 *   - https://github.com/elementor/elementor/blob/main/core/files/css/post.php
 *   - https://github.com/elementor/elementor/issues/35888
 *   - https://github.com/elementor/elementor/issues/35625
 *   - https://github.com/elementor/elementor/issues/36008
 *
 * Failure-mode constraints addressed:
 *   - #2  Read-after-write verification (postSaveVerify)
 *   - #5  Auto-flush Elementor CSS post-write
 *   - #16 Refuse silently-failing operations (atomic_save_silent_failure)
 *   - #17 V3/V4 routing — refuse-or-adapt on detected major
 *   - #21 Forced Optimization gate (Wave 11; enforced upstream in
 *         DocumentWriter::save when invoked through the normal path. This
 *         class adds a defensive *direct-invocation* check: if a caller
 *         constructs and invokes AtomicDocumentWriter directly WITHOUT the
 *         `_fo_gate_handled_upstream` sentinel, AND a CritiqueRunner is
 *         loaded AND a critique_context is supplied, we run a local gate.
 *         When the sentinel is set OR there's no critique_context OR the
 *         runner is missing, the gate is inert — DocumentWriter has already
 *         enforced it OR the caller is in a dark-test environment.)
 */
final class AtomicDocumentWriter
{
    public function __construct(
        private Hasher $hasher,
    ) {}

    /**
     * Write a V4 atomic document.
     *
     * Contract: caller (DocumentWriter::save) has already:
     *   - Performed policy / lock / OCC / snapshot / schema-validation steps
     *   - Generated/filled element IDs
     *   - Run the dry-run short-circuit if applicable
     *   - Confirmed $decision is fresh from VersionRouter::detect()
     *
     * What this method does:
     *   - Re-checks $decision (defense-in-depth — never assume caller's right)
     *   - Refuses with `atomic_save_unstable_in_v4` when known_broken
     *   - Writes via Document::save()
     *   - Reads back, hashes both, compares — surfaces silent corruption
     *   - Regenerates CSS + verifies regeneration didn't throw
     *
     * @param array $req {
     *   post_id: int,
     *   elements: array,
     *   page_settings: ?array,
     *   intent: ?string,
     * }
     * @return array{
     *   verified_elements: array,
     *   new_hash: string,
     *   css_regenerated: bool,
     *   atomic_warnings: list<string>
     * }
     * @throws WriteException
     */
    public function save(RoutingDecision $decision, array $req): array
    {
        // Defense-in-depth: refuse if we shouldn't be here at all.
        if ($decision->isLegacyV3()) {
            throw new WriteException(
                'atomic_writer_misrouted',
                'AtomicDocumentWriter was invoked for a legacy_v3 host. This is a routing bug — V3 must go through DocumentWriter\'s legacy path.',
                500,
                ['routing_decision' => $decision->toArray()]
            );
        }
        if ($decision->isUnsupported()) {
            throw new WriteException(
                'unsupported_elementor_major',
                sprintf(
                    'Elementor %s is not supported by Joist v0.85 (kind=%s). Refuse-or-adapt per failure-mode constraint #17.',
                    $decision->version,
                    $decision->kind
                ),
                422,
                [
                    'routing_decision' => $decision->toArray(),
                    'supported_majors' => [3, 4],
                    'guidance' => 'Install a supported Elementor major (3.33–3.34.x recommended for v0.5 smoke test; future v0.85 builds will broaden V4 support once upstream fixes ship).',
                ]
            );
        }

        // Refuse on known-broken V4 — constraint #16.
        if ($decision->knownBroken) {
            throw new WriteException(
                'atomic_save_unstable_in_v4',
                sprintf(
                    'Elementor %s is in the known-broken range (%s..%s). Open upstream bugs cause atomic-element saves to fail silently or corrupt state. Joist refuses writes against this version per failure-mode constraint #16.',
                    $decision->version,
                    VersionRouter::KNOWN_BROKEN_MIN,
                    VersionRouter::KNOWN_BROKEN_MAX
                ),
                422,
                [
                    'routing_decision' => $decision->toArray(),
                    'open_upstream_issues' => [
                        'https://github.com/elementor/elementor/issues/35888',
                        'https://github.com/elementor/elementor/issues/35625',
                        'https://github.com/elementor/elementor/issues/36008',
                        'https://github.com/orgs/elementor/discussions/35627',
                    ],
                    'guidance' => 'Downgrade Elementor to 3.33–3.34.x for the v0.5 smoke test, or wait for an Elementor release outside the known-broken range. Joist will broaden the safe range once upstream fixes ship.',
                ]
            );
        }

        // Happy path — atomic_v4 + not known_broken. This block is currently
        // exercised only via JOIST_TEST_ELEMENTOR_VERSION (no released 4.x is
        // outside our known-broken range as of 2026-05-28). Code is in place
        // so the moment Elementor ships a safe 4.x, narrowing the known-broken
        // range is the only change needed.

        // Wave 11: Forced Optimization gate (constraint #21).
        // Inert when DocumentWriter has already enforced it upstream (the
        // normal call path sets _fo_gate_handled_upstream=true). Active only
        // when a caller invokes this writer directly AND supplies critique
        // context AND the runner is loaded.
        $beforeScore = $this->forcedOptimizationBefore($req);

        $result = $this->doSafeWrite($decision, $req);

        $this->forcedOptimizationAfter($req, $beforeScore);

        return $result;
    }

    /**
     * Wave 11: capture before-score for direct-invocation Forced Optimization
     * gate. Returns null when the gate is inert (which is the common case).
     *
     * @param array<string,mixed> $req
     */
    private function forcedOptimizationBefore(array $req): ?float
    {
        if (!empty($req['_fo_gate_handled_upstream'])) {
            return null; // DocumentWriter is enforcing.
        }
        if (!empty($req['force_save'])) {
            return null; // Bypass set.
        }
        if (!class_exists('\\Joist\\Critique\\CritiqueRunner')) {
            return null;
        }
        $ctx = is_array($req['critique_context'] ?? null) ? $req['critique_context'] : null;
        if ($ctx === null) {
            return null; // No context, no gate (refuse-not-corrupt).
        }
        $before = is_array($ctx['before'] ?? null) ? $ctx['before'] : null;
        if ($before === null || (!isset($before['screenshot_url']) && !isset($before['screenshot_b64']))) {
            return null;
        }
        try {
            if (!class_exists('\\Joist\\Container')) {
                return null;
            }
            $runner = \Joist\Container::get('critiqueRunner');
            $payload = $before + [
                'site_id' => (string) ($ctx['site_id'] ?? ''),
                'session_id' => (string) ($req['session_id'] ?? ''),
            ];
            return $runner->scoreOnly($payload);
        } catch (\Throwable $e) {
            Logger::warn('joist.atomic.fo_gate_before_failed', ['error' => $e->getMessage()]);
            return null;
        }
    }

    /**
     * Wave 11: after-score check for direct-invocation Forced Optimization.
     * Throws WriteException on refusal.
     *
     * @param array<string,mixed> $req
     */
    private function forcedOptimizationAfter(array $req, ?float $beforeScore): void
    {
        if ($beforeScore === null) {
            return; // Gate was inert.
        }
        $ctx = is_array($req['critique_context'] ?? null) ? $req['critique_context'] : null;
        $after = is_array($ctx['after'] ?? null) ? $ctx['after'] : null;
        if ($after === null || (!isset($after['screenshot_url']) && !isset($after['screenshot_b64']))) {
            throw new WriteException(
                'critique.forced_optimization_refused',
                'V4 atomic writer: Forced Optimization gate enforced but no after-context supplied. Constraint #21.',
                422,
                [
                    'before_score' => $beforeScore,
                    'after_score' => null,
                    'reason' => 'missing_after_context',
                    'writer' => 'atomic_v4_direct',
                ]
            );
        }
        try {
            $runner = \Joist\Container::get('critiqueRunner');
            $payload = $after + [
                'site_id' => (string) ($ctx['site_id'] ?? ''),
                'session_id' => (string) ($req['session_id'] ?? ''),
                'previous_score' => $beforeScore,
            ];
            $afterScore = $runner->scoreOnly($payload);
        } catch (\Throwable $e) {
            throw new WriteException(
                'critique.forced_optimization_refused',
                'V4 atomic writer: Forced Optimization gate could not score after-state: ' . $e->getMessage(),
                502,
                ['before_score' => $beforeScore, 'reason' => 'after_critique_threw'],
            );
        }
        if ($afterScore === null) {
            throw new WriteException(
                'critique.forced_optimization_refused',
                'V4 atomic writer: Forced Optimization gate could not produce an after-score.',
                422,
                ['before_score' => $beforeScore, 'reason' => 'after_critique_unavailable'],
            );
        }
        if ($afterScore <= $beforeScore) {
            throw new WriteException(
                'critique.forced_optimization_refused',
                sprintf(
                    'V4 atomic writer: Forced Optimization gate refused: after-score (%s) not strictly greater than before-score (%s). Constraint #21.',
                    (string) round($afterScore, 4),
                    (string) round($beforeScore, 4),
                ),
                422,
                [
                    'before_score' => round($beforeScore, 4),
                    'after_score' => round($afterScore, 4),
                    'delta' => round($afterScore - $beforeScore, 4),
                    'reason' => 'score_did_not_improve',
                    'writer' => 'atomic_v4_direct',
                ]
            );
        }
    }

    /**
     * Execute the actual V4 write. Read-after-write verifies no silent
     * corruption (the #35888 failure mode). CSS regenerates and we verify
     * the regenerator didn't throw.
     *
     * @param array<string, mixed> $req
     * @return array{verified_elements: array, new_hash: string, css_regenerated: bool, atomic_warnings: list<string>}
     * @throws WriteException
     */
    private function doSafeWrite(RoutingDecision $decision, array $req): array
    {
        $postId = (int) ($req['post_id'] ?? 0);
        $elements = is_array($req['elements'] ?? null) ? $req['elements'] : [];
        $pageSettings = is_array($req['page_settings'] ?? null) ? $req['page_settings'] : [];
        $warnings = [];

        if ($postId <= 0) {
            throw new WriteException(
                'validation.post_id_required',
                'AtomicDocumentWriter requires a post_id.',
                400
            );
        }

        if (!class_exists('\\Elementor\\Plugin')) {
            throw new WriteException(
                'elementor.missing',
                'Elementor plugin is not active.',
                503
            );
        }

        $document = \Elementor\Plugin::$instance->documents->get($postId);
        if (!$document) {
            throw new WriteException(
                'not_found.page',
                sprintf('Page %d not found.', $postId),
                404
            );
        }

        // Hash the intended state BEFORE the save so we can compare deterministically
        // after the read-back. We hash the canonicalized intended tree.
        $intendedHash = $this->hasher->forElements($elements);

        // The write. Same public API on 3.x and 4.x; the divergence is in
        // the tree shape (legacy element types vs. atomic e-* slugs).
        try {
            $document->save([
                'elements' => $elements,
                'settings' => $pageSettings,
            ]);
        } catch (\Throwable $e) {
            // Constraint #16 — surface upstream save failures as typed errors
            // rather than swallowing.
            throw new WriteException(
                'atomic_save_threw',
                sprintf('Elementor Document::save() threw on V4 atomic write: %s', $e->getMessage()),
                500,
                [
                    'routing_decision' => $decision->toArray(),
                    'error' => $e->getMessage(),
                    'post_id' => $postId,
                ]
            );
        }

        // Constraint #2: read-after-write. The #35888 failure mode is that
        // the save APPEARS to succeed but the data isn't persisted; we
        // confirm by re-reading and comparing canonical hashes.
        $verified = $document->get_elements_data();
        $verified = is_array($verified) ? $verified : [];
        $verifiedHash = $this->hasher->forElements($verified);

        if ($verifiedHash !== $intendedHash) {
            // This is the #35888 class — save returned without error but
            // the state isn't what we wrote. Refuse silently-failing
            // operations (constraint #16).
            Logger::error('joist.atomic.silent_save_failure', [
                'post_id' => $postId,
                'intended_hash' => $intendedHash,
                'verified_hash' => $verifiedHash,
                'elementor_version' => $decision->version,
            ]);
            throw new WriteException(
                'atomic_save_silent_failure',
                'Elementor Document::save() returned without error but the post-save read-back does not match the intended state. This is the #35888 failure mode; refused per failure-mode constraint #16.',
                422,
                [
                    'routing_decision' => $decision->toArray(),
                    'post_id' => $postId,
                    'intended_hash' => $intendedHash,
                    'verified_hash' => $verifiedHash,
                    'open_upstream_issue' => 'https://github.com/elementor/elementor/issues/35888',
                    'guidance' => 'This is an upstream Elementor V4 bug. The write was attempted but did not persist correctly; the page is in the pre-save state. Investigate Elementor logs for the specific failure (see js error: this.view.container is undefined).',
                ]
            );
        }

        // Constraint #5: regenerate CSS post-write AND verify success.
        $cssRegenerated = $this->regenCssVerified($postId, $warnings);

        return [
            'verified_elements' => $verified,
            'new_hash' => $verifiedHash,
            'css_regenerated' => $cssRegenerated,
            'atomic_warnings' => $warnings,
        ];
    }

    /**
     * Regenerate post CSS via Elementor's own CSS\Post class. Confirms the
     * regenerator didn't throw. Returns true on success, false on failure
     * (failure appends a warning rather than throwing — CSS regen failure
     * is recoverable; the write itself succeeded).
     *
     * @param list<string> $warnings  (modified in place — appended on failure)
     */
    private function regenCssVerified(int $postId, array &$warnings): bool
    {
        if (!class_exists('\\Elementor\\Core\\Files\\CSS\\Post')) {
            $warnings[] = 'Elementor\\Core\\Files\\CSS\\Post class not available; CSS regeneration skipped.';
            return false;
        }
        try {
            $css = \Elementor\Core\Files\CSS\Post::create($postId);
            $css->update();
            return true;
        } catch (\Throwable $e) {
            $warnings[] = sprintf('CSS regeneration threw: %s', $e->getMessage());
            Logger::warn('joist.atomic.css_regen_failed', [
                'post_id' => $postId,
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }
}
