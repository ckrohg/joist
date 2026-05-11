<?php
declare(strict_types=1);

namespace Joist\Core;

/**
 * Generate Elementor-compatible element IDs (8-char lowercase hex).
 *
 * Extended in v0.5 with regenerateTree(deep:bool) for duplicate/wrap ops
 * (constraint #28 — deep regen prevents nested-ID collisions that would
 * break custom CSS selectors, anchor links, scroll targets).
 */
final class IDGenerator
{
    /** @var array<string, string> Map of temp-id / original-id -> generated-id from the last fillMissing/regenerate call. */
    private array $lastGeneratedMap = [];

    public function generate(): string
    {
        return bin2hex(random_bytes(4));
    }

    /**
     * Walk an element tree and assign IDs to any element missing one,
     * OR any element whose ID looks like a placeholder (temp-N).
     */
    public function fillMissing(array $elements): array
    {
        $this->lastGeneratedMap = [];
        $existingIds = $this->collectIds($elements);
        return $this->walkAssign($elements, $existingIds);
    }

    /**
     * Constraint #28: regenerate IDs across an entire subtree.
     *
     * `deep:true` means EVERY nested element gets a fresh ID — used for
     * `duplicate` and `wrap` ops to prevent collisions with the source
     * tree's nested IDs.
     *
     * `deep:false` only regenerates the root element — used internally
     * for sanity, not exposed to op callers.
     */
    public function regenerateTree(array $subtree, bool $deep = true, array $existingIds = []): array
    {
        $this->lastGeneratedMap = [];
        return $this->walkRegen($subtree, $deep, $existingIds);
    }

    /** @return array<string, string> */
    public function lastGeneratedMap(): array
    {
        return $this->lastGeneratedMap;
    }

    private function walkAssign(array $elements, array &$existingIds): array
    {
        foreach ($elements as $i => $el) {
            if (!is_array($el)) continue;

            $needsNew = !isset($el['id'])
                || !is_string($el['id'])
                || $el['id'] === ''
                || str_starts_with($el['id'], 'temp-');

            if ($needsNew) {
                $originalId = isset($el['id']) && is_string($el['id']) ? $el['id'] : '';
                $newId = $this->generateUnique($existingIds);
                $existingIds[$newId] = true;
                if ($originalId !== '') {
                    $this->lastGeneratedMap[$originalId] = $newId;
                }
                $elements[$i]['id'] = $newId;
            } else {
                $existingIds[$el['id']] = true;
            }

            if (isset($el['elements']) && is_array($el['elements'])) {
                $elements[$i]['elements'] = $this->walkAssign($el['elements'], $existingIds);
            }
        }
        return $elements;
    }

    private function walkRegen(array $elements, bool $deep, array &$existingIds): array
    {
        foreach ($elements as $i => $el) {
            if (!is_array($el)) continue;

            $originalId = (string) ($el['id'] ?? '');
            $newId = $this->generateUnique($existingIds);
            $existingIds[$newId] = true;
            if ($originalId !== '') {
                $this->lastGeneratedMap[$originalId] = $newId;
            }
            $elements[$i]['id'] = $newId;

            if (isset($el['elements']) && is_array($el['elements'])) {
                if ($deep) {
                    $elements[$i]['elements'] = $this->walkRegen($el['elements'], true, $existingIds);
                } else {
                    // Track child IDs in existingIds but don't regenerate them.
                    foreach ($el['elements'] as $child) {
                        if (is_array($child) && isset($child['id'])) {
                            $existingIds[$child['id']] = true;
                        }
                    }
                }
            }
        }
        return $elements;
    }

    private function collectIds(array $elements): array
    {
        $ids = [];
        $stack = $elements;
        while ($stack) {
            $node = array_pop($stack);
            if (!is_array($node)) continue;
            if (isset($node['id']) && is_string($node['id']) && !str_starts_with($node['id'], 'temp-')) {
                $ids[$node['id']] = true;
            }
            if (isset($node['elements']) && is_array($node['elements'])) {
                foreach ($node['elements'] as $child) {
                    $stack[] = $child;
                }
            }
        }
        return $ids;
    }

    private function generateUnique(array $existingIds): string
    {
        for ($attempts = 0; $attempts < 16; $attempts++) {
            $candidate = $this->generate();
            if (!isset($existingIds[$candidate])) {
                return $candidate;
            }
        }
        return bin2hex(random_bytes(6));
    }
}
