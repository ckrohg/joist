<?php
declare(strict_types=1);

namespace Joist\Elementor;

use Joist\Core\Hasher;
use Joist\Core\IDGenerator;

/**
 * THE SPINE. Every Elementor write in Joist routes through here.
 *
 * v0.1 M0 enforces:
 *   - Elementor version supported (#8)
 *   - Schema validation: widget type must exist on this site (#1, partial)
 *   - Optimistic concurrency hash check (the round-trip primitive)
 *   - Element ID generation for any temp- / missing IDs (#10)
 *   - Writes via Elementor's own Document::save() (the only sanctioned path)
 *   - Read-after-write verification (#2)
 *
 * v0.5 adds:
 *   - PolicyGuard refusals before any work (#18)
 *   - Chained-singleton plan-required trigger (#19)
 *   - Snapshot before write, atomic rollback (#3) via custom revisions table
 *   - Audit log entry with chain_hash (#15, #30)
 *   - Async CSS regen + cache flush via wp_schedule_single_event (#17)
 *   - Container-mode validation (#23), responsive completeness (#24),
 *     dynamic tag validation (#25), global ref preference (#26),
 *     inner-flag inference (#27), skin-aware schema (#29).
 *
 * For now we're proving the loop. The structure here mirrors the full v1
 * design so v0.5 is mostly adding orchestration around the same core call.
 */
final class DocumentWriter
{
    public function __construct(
        private Hasher $hasher,
        private IDGenerator $idGen,
        private WidgetCatalog $catalog,
    ) {}

    /**
     * @param int $postId
     * @param array $elements      Elementor element tree.
     * @param ?string $expectedHash  If set, write fails 409 unless current hash matches.
     * @param bool $dryRun          If true, return the would-be result without writing.
     * @return array Result: { new_hash, verified_elements, generated_ids, dry_run }
     * @throws \Joist\Elementor\WriteException On any failure.
     */
    public function save(int $postId, array $elements, ?string $expectedHash = null, bool $dryRun = false): array
    {
        if (!class_exists('\Elementor\Plugin')) {
            throw new WriteException('elementor.missing', 'Elementor plugin is not active.', 503);
        }

        // Constraint #8: pin to tested version range.
        if (defined('ELEMENTOR_VERSION') && version_compare(ELEMENTOR_VERSION, JOIST_MIN_ELEMENTOR_VERSION, '<')) {
            throw new WriteException(
                'elementor.version_unsupported',
                sprintf('Elementor %s+ required; site has %s.', JOIST_MIN_ELEMENTOR_VERSION, ELEMENTOR_VERSION),
                503
            );
        }

        $document = \Elementor\Plugin::$instance->documents->get($postId);
        if (!$document) {
            throw new WriteException('not_found.page', "Page {$postId} not found.", 404);
        }

        // Constraint #1 (partial): schema validation — widget types must exist.
        $this->validateTreeWidgetsRegistered($elements);

        // OCC: hash check.
        if ($expectedHash !== null) {
            $currentHash = $this->hasher->forPage($postId);
            if ($currentHash !== $expectedHash) {
                throw new WriteException(
                    'elementor.hash_mismatch',
                    'Page was modified by another writer.',
                    409,
                    ['current_hash' => $currentHash, 'expected_hash' => $expectedHash]
                );
            }
        }

        // Constraint #10: generate IDs for any missing/temp.
        $elements = $this->idGen->fillMissing($elements);

        if ($dryRun) {
            return [
                'dry_run' => true,
                'new_hash' => $this->hasher->forElements($elements),
                'verified_elements' => $elements,
                'generated_ids' => $this->idGen->lastGeneratedMap(),
            ];
        }

        // THE WRITE. Through Elementor's own path — slash handling, hooks,
        // version stamping, CSS regen all identical to a human edit.
        $document->save([
            'elements' => $elements,
            'settings' => [],
        ]);

        // Constraint #2: read-after-write. Never `{success: true}`.
        $verified = $document->get_elements_data();
        $newHash = $this->hasher->forElements(is_array($verified) ? $verified : []);

        return [
            'dry_run' => false,
            'new_hash' => $newHash,
            'verified_elements' => $verified,
            'generated_ids' => $this->idGen->lastGeneratedMap(),
        ];
    }

    /**
     * Walk tree, throw if any widget type isn't registered.
     */
    private function validateTreeWidgetsRegistered(array $elements): void
    {
        $stack = $elements;
        while ($stack) {
            $node = array_pop($stack);
            if (!is_array($node)) continue;

            if (isset($node['elType']) && $node['elType'] === 'widget' && !empty($node['widgetType'])) {
                if (!$this->catalog->isRegistered($node['widgetType'])) {
                    throw new WriteException(
                        'schema.unknown_widget',
                        "Widget type '{$node['widgetType']}' is not registered on this site.",
                        422,
                        ['widget_type' => $node['widgetType']]
                    );
                }
            }

            if (isset($node['elements']) && is_array($node['elements'])) {
                foreach ($node['elements'] as $child) {
                    $stack[] = $child;
                }
            }
        }
    }
}
