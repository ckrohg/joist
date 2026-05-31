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

        // Wave 11 architecture fix (2026-05-30): the known_broken flag is now
        // a WARNING + attempt-with-hash-defense by default, not a hard refusal.
        // The read-after-write hash check in doSafeWrite() is the actual safety
        // mechanism — if Elementor's #35888 silent-corruption bug fires, the
        // hash mismatch detects it and we throw atomic_save_silent_failure,
        // restore the snapshot, and surface the typed error. Refusing
        // preemptively on every released V4 made the plugin unusable on the
        // default Elementor install for any new WP site since 2026-03-30.
        // The hash check is the contract; the version range was a heuristic.
        //
        // Paranoid opt-in: set wp_option 'joist_strict_v4_refusal' = '1' to
        // preserve the previous refuse-preemptively behavior. Off by default.
        $strictV4Refusal = get_option('joist_strict_v4_refusal', false);
        if ($decision->knownBroken && (bool) $strictV4Refusal === true) {
            throw new WriteException(
                'atomic_save_unstable_in_v4',
                sprintf(
                    'Elementor %s is in the known-broken range (%s..%s) AND joist_strict_v4_refusal is enabled. Disable strict refusal to attempt the write with read-after-write hash defense.',
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
                    'guidance' => "delete_option('joist_strict_v4_refusal') to use the default attempt-with-hash-defense behavior.",
                ]
            );
        }
        // Default path on known_broken: log a warning so operators see it,
        // then proceed to the safe-write path. doSafeWrite()'s read-after-write
        // hash check is the actual safety net.
        if ($decision->knownBroken && class_exists(\Joist\Core\Logger::class)) {
            \Joist\Core\Logger::warn('atomic_v4.known_broken_attempt', [
                'version' => $decision->version,
                'broken_range' => VersionRouter::KNOWN_BROKEN_MIN . '..' . VersionRouter::KNOWN_BROKEN_MAX,
                'open_issues' => ['#35888', '#35625', '#36008'],
                'defense' => 'read_after_write_hash_compare',
            ]);
        }

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

        // Wave 11 debugging (2026-05-30): defensive tracing through the V4
        // happy path. Each step logs a breadcrumb so we can pinpoint where
        // failures occur without needing WP_DEBUG enabled on production.
        $trace = ['v4_path' => 'enter', 'post_id' => $postId, 'elements_count' => count($elements)];
        Logger::info('joist.atomic.dosafewrite_start', $trace);

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

        try {
            $document = \Elementor\Plugin::$instance->documents->get($postId);
        } catch (\Throwable $e) {
            Logger::error('joist.atomic.documents_get_threw', [
                'post_id' => $postId,
                'error' => $e->getMessage(),
                'class' => get_class($e),
            ]);
            throw new WriteException(
                'atomic_documents_get_failed',
                sprintf('Elementor documents->get(%d) threw: %s', $postId, $e->getMessage()),
                500,
                ['post_id' => $postId, 'error_class' => get_class($e)]
            );
        }
        if (!$document) {
            throw new WriteException(
                'not_found.page',
                sprintf('Page %d not found.', $postId),
                404
            );
        }
        Logger::info('joist.atomic.document_loaded', ['post_id' => $postId, 'doc_class' => get_class($document)]);

        // Always include both keys — Document::save expects elements present
        // even when empty. (My earlier omit-on-empty change was wrong for
        // legacy V3 documents; V4 atomic might still want a populated tree
        // but for empty + legacy V3 doc the right shape is elements: [].)
        $savePayload = [
            'elements' => $elements,
            'settings' => $pageSettings,
        ];
        $docClass = get_class($document);

        // Hash the intended state BEFORE the save so we can compare deterministically
        // after the read-back. We hash the canonicalized intended tree.
        $intendedHash = $this->hasher->forElements($elements);
        // Wave 2 (2026-05-31) — also compute the lenient hash that ignores
        // V4 auto-added fields (isInner, id). The silent-save check uses
        // the lenient hash; the strict one is logged for observability.
        $intendedShape = $this->hasher->forElementsLenient($elements);

        // Wave 2: capture the *pre-save* state so we can detect the true
        // #35888 symptom (save returns success but tree is unchanged). The
        // strict intended==verified check could not tell silent-drop from
        // benign normalization apart; before-vs-after disambiguates.
        $beforeShape = null;
        try {
            $beforeData = $document->get_elements_data();
            $beforeShape = $this->hasher->forElementsLenient(is_array($beforeData) ? $beforeData : []);
        } catch (\Throwable $e) {
            // Pre-save snapshot is best-effort; if it fails we still attempt
            // the write and fall back to Check B (intended==verified lenient).
            Logger::warn('joist.atomic.presave_snapshot_failed', [
                'post_id' => $postId,
                'error' => $e->getMessage(),
            ]);
        }

        // The write. Same public API on 3.x and 4.x; the divergence is in
        // the tree shape (legacy element types vs. atomic e-* slugs).
        Logger::info('joist.atomic.about_to_save', [
            'post_id' => $postId,
            'doc_class' => $docClass,
            'elements_count' => count($elements),
        ]);
        try {
            $document->save($savePayload);
            Logger::info('joist.atomic.save_returned', ['post_id' => $postId]);
        } catch (\Throwable $e) {
            Logger::error('joist.atomic.save_threw', [
                'post_id' => $postId,
                'doc_class' => $docClass,
                'error' => $e->getMessage(),
                'class' => get_class($e),
            ]);
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
        try {
            $verified = $document->get_elements_data();
        } catch (\Throwable $e) {
            Logger::error('joist.atomic.get_elements_data_threw', [
                'post_id' => $postId,
                'error' => $e->getMessage(),
                'class' => get_class($e),
            ]);
            throw new WriteException(
                'atomic_get_elements_data_failed',
                sprintf('Elementor get_elements_data() threw after save: %s', $e->getMessage()),
                500,
                ['post_id' => $postId, 'error_class' => get_class($e)]
            );
        }
        Logger::info('joist.atomic.elements_read_back', [
            'post_id' => $postId,
            'verified_type' => gettype($verified),
            'verified_count' => is_array($verified) ? count($verified) : 0,
        ]);
        $verified = is_array($verified) ? $verified : [];
        $verifiedHash = $this->hasher->forElements($verified);
        // Wave 2: lenient hash strips V4 auto-fields. Drives the actual
        // silent-save check below; strict $verifiedHash is informational.
        $verifiedShape = $this->hasher->forElementsLenient($verified);

        // Wave 2 — two-layer silent-save check (replaces the old strict
        // intended==verified equality).
        //
        // Check A (silent-drop detection, when pre-save snapshot succeeded):
        //   shape_after must differ from shape_before when intended is
        //   non-empty. If shape_after == shape_before, the save was a no-op
        //   — the canonical #35888 symptom.
        //
        // Check B (silent-corruption detection):
        //   shape_after must equal shape_intended (lenient). If lenient
        //   shapes differ, V4 mutated something beyond the known-benign
        //   auto-fields list; we refuse and surface the structural_diff
        //   so we can extend V4_AUTO_FIELDS or design Wave 3 properly.
        $checkAFailed = false;
        $checkBFailed = false;
        if ($beforeShape !== null && count($elements) > 0 && $beforeShape === $verifiedShape) {
            // Save had no effect AND we were trying to write content.
            // This is the genuine #35888 silent-drop.
            $checkAFailed = true;
        }
        if ($verifiedShape !== $intendedShape) {
            $checkBFailed = true;
        }

        if ($checkAFailed || $checkBFailed) {
            // This is the #35888 class — save returned without error but
            // the state isn't what we wrote. Refuse silently-failing
            // operations (constraint #16).
            //
            // Wave 1 diagnostic (2026-05-31): hash mismatch alone tells us
            // 'different' but not 'how'. We compute a compact structural
            // diff so callers can see what V4's transformer mutated. This
            // unblocks designing the V4-aware hash check (Wave 2).
            $structuralDiff = $this->structuralDiff($elements, $verified);
            // Wave 2.1 (2026-05-31): when Check B trips, also include the
            // *full* first-root subtrees so we can see every field V4
            // mutated, including deep nested settings the structural_diff
            // root-level view doesn't surface. Capped at 20 KB total to
            // stay polite to the error envelope.
            $fullTreeSample = null;
            if ($checkBFailed) {
                $fullTreeSample = [
                    'intended_root_0' => $this->truncateForEnvelope($elements[0] ?? null, 8192),
                    'verified_root_0' => $this->truncateForEnvelope($verified[0] ?? null, 8192),
                ];
            }
            $failureReason = $checkAFailed
                ? 'silent_drop_check_a'   // save returned ok but tree unchanged
                : 'shape_divergence_check_b'; // verified shape != intended shape (V4 mutated beyond known auto-fields)
            Logger::error('joist.atomic.silent_save_failure', [
                'post_id' => $postId,
                'failure_reason' => $failureReason,
                'intended_hash' => $intendedHash,
                'verified_hash' => $verifiedHash,
                'intended_shape' => $intendedShape,
                'verified_shape' => $verifiedShape,
                'before_shape' => $beforeShape,
                'elementor_version' => $decision->version,
                'structural_diff' => $structuralDiff,
            ]);
            $message = $checkAFailed
                ? 'Elementor Document::save() returned without error but the page tree is unchanged. This is the #35888 silent-drop failure mode; refused per failure-mode constraint #16.'
                : 'Elementor Document::save() returned without error but the post-save read-back diverges from the intended state beyond known-benign V4 normalizations. Refused per failure-mode constraint #16; extend Hasher::V4_AUTO_FIELDS if structural_diff shows a new V4-introduced field.';
            throw new WriteException(
                'atomic_save_silent_failure',
                $message,
                422,
                [
                    'routing_decision' => $decision->toArray(),
                    'post_id' => $postId,
                    'failure_reason' => $failureReason,
                    'intended_hash' => $intendedHash,
                    'verified_hash' => $verifiedHash,
                    'intended_shape' => $intendedShape,
                    'verified_shape' => $verifiedShape,
                    'before_shape' => $beforeShape,
                    'structural_diff' => $structuralDiff,
                    'full_tree_sample' => $fullTreeSample,
                    'open_upstream_issue' => 'https://github.com/elementor/elementor/issues/35888',
                    'guidance' => $checkAFailed
                        ? 'Save returned success but the tree on disk is unchanged from the pre-save state. Investigate Elementor logs for the JS error (this.view.container is undefined).'
                        : 'V4 transformer added or modified fields beyond the known-benign list. Compare full_tree_sample.intended_root_0 vs verified_root_0 to identify new V4-added fields; extend Hasher::V4_AUTO_FIELDS and re-deploy.',
                ]
            );
        }

        // Wave 2: log when strict hashes differ but lenient passed — useful
        // for surfacing what V4 normalized on successful saves. Informational
        // only; not an error.
        if ($verifiedHash !== $intendedHash) {
            Logger::info('joist.atomic.benign_v4_normalization', [
                'post_id' => $postId,
                'intended_hash' => $intendedHash,
                'verified_hash' => $verifiedHash,
                'lenient_match' => true,
                'elementor_version' => $decision->version,
            ]);
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
     * Wave 1 (2026-05-31) — compute a compact structural diff between the
     * intended elements tree and the post-save read-back. The hash check
     * alone tells us 'different'; this tells us *how*.
     *
     * Output budget ~5-10 KB. Surfaces:
     *   - root_count: intended vs verified
     *   - root_shape: per-index elType + widgetType for both sides
     *   - per_root_settings_diff: which keys were added/removed/changed,
     *     with sample diverging values truncated to 200 chars
     *   - children_count_per_root
     *   - widget_type_summary: counts of each widgetType in both trees
     *
     * The point is to feed Wave-2 design. We're looking for patterns like:
     *   - "V4 always strips key X"
     *   - "V4 renames widgetType heading → e-heading"
     *   - "V4 wraps top-level widgets in containers"
     *   - "V4 normalizes padding shape to nested object"
     *
     * @param list<array<string,mixed>> $intended
     * @param list<array<string,mixed>> $verified
     * @return array<string, mixed>
     */
    private function structuralDiff(array $intended, array $verified): array
    {
        $diff = [
            'root_count' => [
                'intended' => count($intended),
                'verified' => count($verified),
            ],
            'root_shape' => [],
            'per_root_settings_diff' => [],
            'children_count_per_root' => [],
            'widget_type_summary' => [
                'intended' => $this->summarizeWidgetTypes($intended),
                'verified' => $this->summarizeWidgetTypes($verified),
            ],
        ];

        $maxRoots = max(count($intended), count($verified));
        // Cap at 5 roots to keep envelope small. Real plans rarely have
        // >5 top-level containers; if they do the first 5 are diagnostic
        // enough to find the pattern.
        $maxRoots = min($maxRoots, 5);

        for ($i = 0; $i < $maxRoots; $i++) {
            $intendedRoot = $intended[$i] ?? null;
            $verifiedRoot = $verified[$i] ?? null;

            $diff['root_shape'][] = [
                'index' => $i,
                'intended' => $this->describeNode($intendedRoot),
                'verified' => $this->describeNode($verifiedRoot),
            ];

            $diff['children_count_per_root'][] = [
                'index' => $i,
                'intended' => is_array($intendedRoot['elements'] ?? null) ? count($intendedRoot['elements']) : 0,
                'verified' => is_array($verifiedRoot['elements'] ?? null) ? count($verifiedRoot['elements']) : 0,
            ];

            $intendedSettings = is_array($intendedRoot['settings'] ?? null) ? $intendedRoot['settings'] : [];
            $verifiedSettings = is_array($verifiedRoot['settings'] ?? null) ? $verifiedRoot['settings'] : [];
            $diff['per_root_settings_diff'][] = [
                'index' => $i,
                'settings_diff' => $this->keysDiff($intendedSettings, $verifiedSettings),
            ];
        }

        return $diff;
    }

    /**
     * Compact node descriptor: elType, widgetType (if widget), settings-key
     * count, children count. Used in root_shape.
     *
     * @param array<string,mixed>|null $node
     * @return array<string, mixed>|null
     */
    private function describeNode(?array $node): ?array
    {
        if ($node === null) return null;
        return [
            'elType' => $node['elType'] ?? null,
            'widgetType' => $node['widgetType'] ?? null,
            'settings_key_count' => is_array($node['settings'] ?? null) ? count($node['settings']) : 0,
            'children_count' => is_array($node['elements'] ?? null) ? count($node['elements']) : 0,
            'top_level_keys' => is_array($node) ? array_keys($node) : [],
        ];
    }

    /**
     * Diff two assoc arrays by key: added (in B not A), removed (in A not B),
     * changed (in both, value differs). For changed keys, attach a truncated
     * sample of both values so the V4 transformer's behavior is visible.
     *
     * @param array<string, mixed> $a intended
     * @param array<string, mixed> $b verified
     * @return array<string, mixed>
     */
    private function keysDiff(array $a, array $b): array
    {
        $aKeys = array_keys($a);
        $bKeys = array_keys($b);
        $added = array_values(array_diff($bKeys, $aKeys));
        $removed = array_values(array_diff($aKeys, $bKeys));
        $common = array_values(array_intersect($aKeys, $bKeys));

        $changed = [];
        foreach ($common as $k) {
            if ($a[$k] !== $b[$k]) {
                $changed[] = [
                    'key' => $k,
                    'intended_sample' => $this->truncSample($a[$k]),
                    'verified_sample' => $this->truncSample($b[$k]),
                ];
            }
        }
        // Cap changed-key sample at 8 to keep envelope bounded.
        if (count($changed) > 8) {
            $changed = array_slice($changed, 0, 8);
            $changed[] = ['key' => '__truncated__', 'note' => 'additional changed keys omitted'];
        }

        return [
            'added_in_verified' => $added,
            'removed_from_intended' => $removed,
            'changed_values' => $changed,
            'intended_key_count' => count($aKeys),
            'verified_key_count' => count($bKeys),
        ];
    }

    /**
     * Truncate a value to a JSON snippet ≤200 chars so error envelopes
     * stay bounded even when transformer output is verbose.
     */
    private function truncSample(mixed $val): string
    {
        $json = wp_json_encode($val, JSON_UNESCAPED_SLASHES);
        if (!is_string($json)) {
            return '[unencodable]';
        }
        if (strlen($json) > 200) {
            return substr($json, 0, 197) . '...';
        }
        return $json;
    }

    /**
     * Wave 2.1: serialize a subtree as JSON with a soft size cap. When the
     * JSON exceeds the cap, returns a wrapper with `{__truncated_at: N,
     * sample: '…first N chars…'}` so the caller still sees the start.
     *
     * @param mixed $val
     * @return mixed JSON-decodable structure (array/string)
     */
    private function truncateForEnvelope(mixed $val, int $maxBytes): mixed
    {
        $json = wp_json_encode($val, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($json)) {
            return ['__unencodable' => true];
        }
        if (strlen($json) <= $maxBytes) {
            // Decode back so it nests as structured data in the envelope.
            $decoded = json_decode($json, true);
            return $decoded ?? $val;
        }
        return [
            '__truncated_at' => $maxBytes,
            '__total_bytes' => strlen($json),
            'sample' => substr($json, 0, $maxBytes),
        ];
    }

    /**
     * Walk a tree and count occurrences of each widgetType (or elType for
     * non-widget nodes). Reveals slug renames like heading → e-heading.
     *
     * @param array<int, mixed> $tree
     * @return array<string, int>
     */
    private function summarizeWidgetTypes(array $tree): array
    {
        $counts = [];
        $walk = function ($nodes) use (&$walk, &$counts) {
            if (!is_array($nodes)) return;
            foreach ($nodes as $n) {
                if (!is_array($n)) continue;
                $elType = (string) ($n['elType'] ?? '');
                $widgetType = (string) ($n['widgetType'] ?? '');
                $key = $elType === 'widget' ? "widget:{$widgetType}" : ($elType !== '' ? "el:{$elType}" : 'unknown');
                $counts[$key] = ($counts[$key] ?? 0) + 1;
                if (isset($n['elements']) && is_array($n['elements'])) {
                    $walk($n['elements']);
                }
            }
        };
        $walk($tree);
        return $counts;
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
