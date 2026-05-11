<?php
declare(strict_types=1);

namespace Joist\Elementor;

use Joist\Core\IDGenerator;

/**
 * Apply surgical operations to an Elementor element tree. Pure function —
 * no side effects. Result feeds into DocumentWriter::save().
 *
 * Eight op types supported:
 *   - update_settings    Merge new settings into a widget
 *   - replace_element    Replace an entire subtree at element_id
 *   - insert             Insert a new element at parent_id + position
 *   - delete             Remove an element by id
 *   - move               Re-parent and/or reorder an element
 *   - duplicate          Clone an element (deep ID regen — #28)
 *   - wrap               Wrap an element in a new container/section (deep regen)
 *   - unwrap             Promote an element's children to its parent
 */
final class PatchEngine
{
    public function __construct(
        private IDGenerator $idGen,
        private CustomCSSBlockManager $cssBlocks,
    ) {}

    /**
     * @return array{0:array, 1:array<string,string>} [tree, generatedIds]
     */
    public function apply(array $elements, array $ops): array
    {
        $generatedIds = [];
        foreach ($ops as $op) {
            if (!is_array($op) || empty($op['op'])) {
                throw new InvalidSettingsException(
                    'patch.invalid_op',
                    'Op missing or malformed.',
                    ['op' => $op]
                );
            }
            $elements = match ($op['op']) {
                'update_settings' => $this->opUpdateSettings($elements, $op),
                'replace_element' => $this->opReplace($elements, $op),
                'insert' => $this->opInsert($elements, $op, $generatedIds),
                'delete' => $this->opDelete($elements, $op),
                'move' => $this->opMove($elements, $op),
                'duplicate' => $this->opDuplicate($elements, $op, $generatedIds),
                'wrap' => $this->opWrap($elements, $op, $generatedIds),
                'unwrap' => $this->opUnwrap($elements, $op),
                default => throw new InvalidSettingsException(
                    'patch.unsupported_op',
                    "Op '{$op['op']}' is not supported. Supported: update_settings, replace_element, insert, delete, move, duplicate, wrap, unwrap.",
                    ['op' => $op['op']]
                ),
            };
        }
        return [$elements, $generatedIds];
    }

    private function opUpdateSettings(array $elements, array $op): array
    {
        $targetId = (string) ($op['element_id'] ?? '');
        $newSettings = is_array($op['settings'] ?? null) ? $op['settings'] : [];
        $customCssBlock = $op['custom_css_block'] ?? null;

        return $this->walkUpdate($elements, $targetId, function (array $el) use ($newSettings, $customCssBlock) {
            $settings = is_array($el['settings'] ?? null) ? $el['settings'] : [];

            // Merge regular settings.
            foreach ($newSettings as $k => $v) {
                $settings[$k] = $v;
            }

            // Custom CSS block — merge by tag, don't replace whole.
            if (is_array($customCssBlock) && !empty($customCssBlock['tag']) && isset($customCssBlock['css'])) {
                $existing = (string) ($settings['custom_css'] ?? '');
                $settings['custom_css'] = $this->cssBlocks->mergeBlock(
                    $existing,
                    (string) $customCssBlock['tag'],
                    (string) $customCssBlock['css']
                );
            }

            $el['settings'] = $settings;
            return $el;
        });
    }

    private function opReplace(array $elements, array $op): array
    {
        $targetId = (string) ($op['element_id'] ?? '');
        $newElement = is_array($op['element'] ?? null) ? $op['element'] : null;
        if ($newElement === null) {
            throw new InvalidSettingsException('patch.invalid_op', 'replace_element requires `element`.', $op);
        }
        return $this->walkUpdate($elements, $targetId, fn($_) => $newElement);
    }

    private function opInsert(array $elements, array $op, array &$generatedIds): array
    {
        $parentId = (string) ($op['parent_id'] ?? '');
        $position = (int) ($op['position'] ?? 0);
        $newElement = is_array($op['element'] ?? null) ? $op['element'] : null;
        if ($newElement === null) {
            throw new InvalidSettingsException('patch.invalid_op', 'insert requires `element`.', $op);
        }

        // Generate IDs for the new subtree.
        $existingIds = $this->collectAllIds($elements);
        $newElement = $this->idGen->regenerateTree([$newElement], true, $existingIds)[0];
        $generatedIds = array_merge($generatedIds, $this->idGen->lastGeneratedMap());

        if ($parentId === '' || $parentId === 'root') {
            array_splice($elements, max(0, $position), 0, [$newElement]);
            return $elements;
        }

        return $this->walkInsert($elements, $parentId, $position, $newElement);
    }

    private function opDelete(array $elements, array $op): array
    {
        $targetId = (string) ($op['element_id'] ?? '');
        return $this->walkDelete($elements, $targetId);
    }

    private function opMove(array $elements, array $op): array
    {
        $targetId = (string) ($op['element_id'] ?? '');
        $newParentId = (string) ($op['new_parent_id'] ?? '');
        $newPosition = (int) ($op['new_position'] ?? 0);

        $moved = $this->extractElement($elements, $targetId);
        if ($moved === null) {
            throw new InvalidSettingsException(
                'patch.element_not_found',
                "move: element {$targetId} not found.",
                $op
            );
        }
        [$elements, $movedElement] = $moved;

        if ($newParentId === '' || $newParentId === 'root') {
            array_splice($elements, max(0, $newPosition), 0, [$movedElement]);
            return $elements;
        }
        return $this->walkInsert($elements, $newParentId, $newPosition, $movedElement);
    }

    private function opDuplicate(array $elements, array $op, array &$generatedIds): array
    {
        $targetId = (string) ($op['element_id'] ?? '');
        $position = (string) ($op['position'] ?? 'after'); // 'before' | 'after'

        $found = $this->findElement($elements, $targetId);
        if ($found === null) {
            throw new InvalidSettingsException(
                'patch.element_not_found',
                "duplicate: element {$targetId} not found.",
                $op
            );
        }
        [$_, $parentList, $indexInParent] = $found;

        // Deep regen (constraint #28).
        $existingIds = $this->collectAllIds($elements);
        $sourceSubtree = json_decode((string) wp_json_encode($parentList[$indexInParent]), true);
        $dupSubtree = $this->idGen->regenerateTree([$sourceSubtree], true, $existingIds)[0];
        $generatedIds = array_merge($generatedIds, $this->idGen->lastGeneratedMap());

        $insertAt = $position === 'before' ? $indexInParent : $indexInParent + 1;

        // Walk again and insert.
        return $this->walkInsertNextToTarget($elements, $targetId, $position === 'before', $dupSubtree);
    }

    private function opWrap(array $elements, array $op, array &$generatedIds): array
    {
        $targetId = (string) ($op['element_id'] ?? '');
        $container = is_array($op['container'] ?? null) ? $op['container'] : null;
        if ($container === null) {
            throw new InvalidSettingsException('patch.invalid_op', 'wrap requires `container`.', $op);
        }

        // The container wraps the target. Deep-regen the container's own ID.
        $existingIds = $this->collectAllIds($elements);
        $container['id'] = $this->generateUnique($existingIds);
        $generatedIds[$container['id'] . '_original'] = $container['id'];

        return $this->walkUpdate($elements, $targetId, function (array $target) use ($container) {
            $container['elements'] = [$target];
            return $container;
        });
    }

    private function opUnwrap(array $elements, array $op): array
    {
        $targetId = (string) ($op['element_id'] ?? '');
        // Replace target with its children — the target itself disappears.
        return $this->walkUnwrap($elements, $targetId);
    }

    // ---------- Tree walk helpers ----------

    private function walkUpdate(array $elements, string $targetId, callable $mutator): array
    {
        foreach ($elements as $i => $el) {
            if (!is_array($el)) continue;
            if (($el['id'] ?? '') === $targetId) {
                $elements[$i] = $mutator($el);
                return $elements;
            }
            if (isset($el['elements']) && is_array($el['elements'])) {
                $elements[$i]['elements'] = $this->walkUpdate($el['elements'], $targetId, $mutator);
            }
        }
        return $elements;
    }

    private function walkInsert(array $elements, string $parentId, int $position, array $newElement): array
    {
        foreach ($elements as $i => $el) {
            if (!is_array($el)) continue;
            if (($el['id'] ?? '') === $parentId) {
                $children = is_array($el['elements'] ?? null) ? $el['elements'] : [];
                array_splice($children, max(0, $position), 0, [$newElement]);
                $elements[$i]['elements'] = $children;
                return $elements;
            }
            if (isset($el['elements']) && is_array($el['elements'])) {
                $elements[$i]['elements'] = $this->walkInsert($el['elements'], $parentId, $position, $newElement);
            }
        }
        return $elements;
    }

    private function walkInsertNextToTarget(array $elements, string $targetId, bool $before, array $newElement): array
    {
        foreach ($elements as $i => $el) {
            if (!is_array($el)) continue;
            if (($el['id'] ?? '') === $targetId) {
                array_splice($elements, $before ? $i : $i + 1, 0, [$newElement]);
                return $elements;
            }
            if (isset($el['elements']) && is_array($el['elements'])) {
                $elements[$i]['elements'] = $this->walkInsertNextToTarget(
                    $el['elements'], $targetId, $before, $newElement
                );
            }
        }
        return $elements;
    }

    private function walkDelete(array $elements, string $targetId): array
    {
        $out = [];
        foreach ($elements as $el) {
            if (!is_array($el)) continue;
            if (($el['id'] ?? '') === $targetId) {
                continue; // drop
            }
            if (isset($el['elements']) && is_array($el['elements'])) {
                $el['elements'] = $this->walkDelete($el['elements'], $targetId);
            }
            $out[] = $el;
        }
        return $out;
    }

    private function walkUnwrap(array $elements, string $targetId): array
    {
        $out = [];
        foreach ($elements as $el) {
            if (!is_array($el)) continue;
            if (($el['id'] ?? '') === $targetId) {
                $children = is_array($el['elements'] ?? null) ? $el['elements'] : [];
                foreach ($children as $child) {
                    $out[] = $child;
                }
                continue;
            }
            if (isset($el['elements']) && is_array($el['elements'])) {
                $el['elements'] = $this->walkUnwrap($el['elements'], $targetId);
            }
            $out[] = $el;
        }
        return $out;
    }

    private function extractElement(array $elements, string $targetId): ?array
    {
        foreach ($elements as $i => $el) {
            if (!is_array($el)) continue;
            if (($el['id'] ?? '') === $targetId) {
                $extracted = $el;
                array_splice($elements, $i, 1);
                return [$elements, $extracted];
            }
            if (isset($el['elements']) && is_array($el['elements'])) {
                $r = $this->extractElement($el['elements'], $targetId);
                if ($r !== null) {
                    [$updatedChildren, $extracted] = $r;
                    $elements[$i]['elements'] = $updatedChildren;
                    return [$elements, $extracted];
                }
            }
        }
        return null;
    }

    /** @return ?array{0:array, 1:array, 2:int} [tree, parentList, indexInParent] */
    private function findElement(array $elements, string $targetId): ?array
    {
        foreach ($elements as $i => $el) {
            if (!is_array($el)) continue;
            if (($el['id'] ?? '') === $targetId) {
                return [$elements, $elements, $i];
            }
            if (isset($el['elements']) && is_array($el['elements'])) {
                $r = $this->findElement($el['elements'], $targetId);
                if ($r !== null) return $r;
            }
        }
        return null;
    }

    private function collectAllIds(array $elements): array
    {
        $ids = [];
        $stack = $elements;
        while ($stack) {
            $node = array_pop($stack);
            if (!is_array($node)) continue;
            if (isset($node['id'])) {
                $ids[(string) $node['id']] = true;
            }
            if (isset($node['elements']) && is_array($node['elements'])) {
                foreach ($node['elements'] as $child) {
                    $stack[] = $child;
                }
            }
        }
        return $ids;
    }

    private function generateUnique(array $existing): string
    {
        for ($i = 0; $i < 16; $i++) {
            $c = bin2hex(random_bytes(4));
            if (!isset($existing[$c])) return $c;
        }
        return bin2hex(random_bytes(6));
    }
}
