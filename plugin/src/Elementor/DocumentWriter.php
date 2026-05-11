<?php
declare(strict_types=1);

namespace Joist\Elementor;

use Joist\Audit\AuditLogger;
use Joist\Concurrency\LockManager;
use Joist\Concurrency\OperatingMode;
use Joist\Concurrency\SessionTracker;
use Joist\Core\Hasher;
use Joist\Core\IDGenerator;
use Joist\Core\Logger;
use Joist\Security\PolicyGuard;
use Joist\Storage\RevisionStore;
use Joist\Webhooks\WebhookEmitter;

/**
 * THE SPINE. v0.5 hardened version.
 *
 * Every Elementor write in Joist routes through here. Enforces 9 of the
 * 30 failure-mode constraints in one method, defers expensive work to
 * scheduled events (constraint #17 async I/O), and returns optimistically.
 *
 * Sync portion (~200ms):
 *   #18 PolicyGuard refuse-list
 *   #19 Chained-singleton plan-required check
 *   #20 (Controller-level) HTTPS enforcement
 *   #6.12 Operating mode interception
 *   #8  Elementor version pin
 *   #23 Container-mode matching
 *   #25 Dynamic-tag references resolve
 *   #1, #24, #27, #29 Schema validation (covers responsive completeness,
 *       inner-flag, skin-aware)
 *   #26 Global ref preference (auto-transform)
 *   #10, #28 ID generation
 *   §6.7 Custom CSS block merging (handled by PatchEngine; here we pass-through)
 *   #3  Revision snapshot
 *   OCC  Hash check
 *   Write via Elementor's Document::save()
 *   #2  Read-after-write verification
 *   #15, #30 Hash-chained audit log entry
 *
 * Async portion (deferred to wp_schedule_single_event):
 *   #5  CSS regen + cache flush + CDN purge
 *   Frontend verification HTTP fetch
 *   Webhook emission to subscribers
 */
final class DocumentWriter
{
    public function __construct(
        private Hasher $hasher,
        private IDGenerator $idGen,
        private WidgetCatalog $catalog,
        private SchemaValidator $validator,
        private DynamicTagValidator $dynamicTags,
        private GlobalRefPreferrer $globals,
        private ContainerModeAdapter $layoutMode,
        private LockManager $locks,
        private OperatingMode $opMode,
        private SessionTracker $sessions,
        private PolicyGuard $policy,
        private RevisionStore $revisions,
        private AuditLogger $audit,
        private WebhookEmitter $webhooks,
    ) {}

    /**
     * @param array $req {
     *   post_id: int,
     *   elements: array,
     *   expected_hash: ?string,
     *   session_id: string,
     *   intent: ?string,
     *   actor_type: 'agent'|'human'|'system',
     *   actor_id: ?string,
     *   app_password_user_id: ?int,
     *   dry_run: bool,
     *   force_layout_cross_mode: bool,
     *   prefer_literals: bool,
     *   responsive: 'auto'|'explicit',
     * }
     * @return array
     * @throws WriteException
     * @throws InvalidSettingsException
     */
    public function save(array $req): array
    {
        $startMs = (int) (microtime(true) * 1000);
        $postId = (int) $req['post_id'];
        $elements = is_array($req['elements'] ?? null) ? $req['elements'] : [];
        $expectedHash = $req['expected_hash'] ?? null;
        $sessionId = (string) ($req['session_id'] ?? '');
        $dryRun = (bool) ($req['dry_run'] ?? false);

        // Constraint #18: PolicyGuard refuse-list BEFORE any work.
        $actor = wp_get_current_user();
        $this->policy->assertAllowed('page.write', ['post_id' => $postId], $actor instanceof \WP_User ? $actor : null);

        // Operating mode (§6.12) — observer forces dry_run; quiet/kill throw 423.
        $proceed = $this->opMode->intercept();
        if (!$proceed) {
            $dryRun = true; // observer mode
        }

        // Constraint #19: chained-singleton plan trigger.
        if ($sessionId !== '') {
            $this->sessions->recordOp($sessionId, 'document.save', $postId);
            $this->policy->checkPlanRequired($sessionId, 'document.save', $postId);
        }

        // Constraint #8: Elementor version pin.
        $this->assertElementorVersion();

        $document = \Elementor\Plugin::$instance->documents->get($postId);
        if (!$document) {
            throw new WriteException('not_found.page', "Page {$postId} not found.", 404);
        }

        // Acquire lock (if session set).
        $lockAcquired = false;
        if ($sessionId !== '') {
            $this->locks->acquire($postId, $sessionId, 60, $req['intent'] ?? null);
            $lockAcquired = true;
        }

        $revisionId = null;
        try {
            // Constraint #23: container-mode matching.
            $this->layoutMode->validateInserts($postId, $elements, (bool) ($req['force_layout_cross_mode'] ?? false));

            // Constraint #25: dynamic tag references resolve.
            $this->dynamicTags->validateTree($elements);

            // Constraint #1, #24, #27, #29: schema validation.
            $warnings = $this->validator->validateTree($elements);

            // Constraint #26: prefer globals over literals.
            [$elements, $transformations] = $this->globals->preferGlobals(
                $elements,
                (bool) ($req['prefer_literals'] ?? false)
            );

            // Constraint #10: ID generation for any missing/temp.
            $elements = $this->idGen->fillMissing($elements);

            // OCC hash check.
            if ($expectedHash !== null) {
                $currentHash = $this->hasher->forPage($postId);
                if ($currentHash !== $expectedHash) {
                    $lastModifier = $this->audit->lastModifierFor($postId);
                    throw new WriteException(
                        'elementor.hash_mismatch',
                        'Page was modified by another writer.',
                        409,
                        [
                            'current_hash' => $currentHash,
                            'expected_hash' => $expectedHash,
                            'last_modifier' => $lastModifier,
                            'post_id' => $postId,
                        ]
                    );
                }
            }

            // Constraint #3: snapshot before write (atomic rollback target).
            $beforeHash = $this->hasher->forPage($postId);
            $revisionId = $this->revisions->snapshot(
                $postId,
                $beforeHash,
                (string) ($req['actor_type'] ?? 'agent'),
                $req['actor_id'] ?? null,
                $sessionId,
                $req['intent'] ?? null
            );

            // Dry-run short-circuit.
            if ($dryRun) {
                $newHash = $this->hasher->forElements($elements);
                return [
                    'dry_run' => true,
                    'new_hash' => $newHash,
                    'verified_elements' => $elements,
                    'generated_ids' => $this->idGen->lastGeneratedMap(),
                    'transformations' => $transformations,
                    'warnings' => $warnings,
                ];
            }

            // The write — through Elementor's own path.
            $document->save([
                'elements' => $elements,
                'settings' => is_array($req['page_settings'] ?? null) ? $req['page_settings'] : [],
            ]);

            // Constraint #2: read-after-write verification.
            $verified = $document->get_elements_data();
            $verified = is_array($verified) ? $verified : [];
            $newHash = $this->hasher->forElements($verified);

            $durationMs = (int) (microtime(true) * 1000) - $startMs;

            // Constraints #15, #30: hash-chained audit log.
            $this->audit->log(
                'document.save',
                $postId,
                (string) ($req['actor_type'] ?? 'agent'),
                $req['actor_id'] ?? null,
                $req['app_password_user_id'] ?? null,
                $sessionId !== '' ? $sessionId : null,
                $beforeHash,
                $newHash,
                $durationMs,
                $req['intent'] ?? null,
                ['transformations' => $transformations, 'warnings' => $warnings]
            );

            // Constraint #17: ASYNC the expensive stuff.
            wp_schedule_single_event(time() + 1, 'joist_post_save_verify', [$postId]);

            // Emit webhook async.
            $this->webhooks->emit('document.saved', [
                'page_id' => $postId,
                'session_id' => $sessionId !== '' ? $sessionId : null,
                'actor' => ['type' => $req['actor_type'] ?? 'agent', 'id' => $req['actor_id'] ?? null],
                'before_hash' => $beforeHash,
                'after_hash' => $newHash,
            ]);

            return [
                'dry_run' => false,
                'new_hash' => $newHash,
                'verified_elements' => $verified,
                'generated_ids' => $this->idGen->lastGeneratedMap(),
                'revision_id' => $revisionId,
                'transformations' => $transformations,
                'warnings' => $warnings,
                'pending_verifications' => ['css_regen', 'cache_flush', 'frontend_verify'],
            ];

        } catch (\Throwable $e) {
            // Constraint #16: no silent failure. Rollback on error.
            if ($revisionId !== null) {
                try {
                    $this->revisions->restore($revisionId);
                } catch (\Throwable $rollbackErr) {
                    Logger::error('rollback after write failure also failed', [
                        'post_id' => $postId,
                        'revision_id' => $revisionId,
                        'original_error' => $e->getMessage(),
                        'rollback_error' => $rollbackErr->getMessage(),
                    ]);
                }
            }
            throw $e;
        } finally {
            if ($lockAcquired) {
                $this->locks->release($postId, $sessionId);
            }
        }
    }

    private function assertElementorVersion(): void
    {
        if (!class_exists('\Elementor\Plugin')) {
            throw new WriteException('elementor.missing', 'Elementor plugin is not active.', 503);
        }
        if (defined('ELEMENTOR_VERSION') && version_compare(ELEMENTOR_VERSION, JOIST_MIN_ELEMENTOR_VERSION, '<')) {
            throw new WriteException(
                'elementor.version_unsupported',
                sprintf('Elementor %s+ required; site has %s.', JOIST_MIN_ELEMENTOR_VERSION, ELEMENTOR_VERSION),
                503
            );
        }
    }
}
