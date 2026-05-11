<?php
declare(strict_types=1);

namespace Joist\Core;

/**
 * Generate Elementor-compatible element IDs (8-char lowercase hex).
 *
 * Elementor's own ID generator uses `dechex(rand(...))` truncated to 7-8 chars.
 * We use 8 chars from `random_bytes` to keep collision probability negligible
 * across a single page and to match the format the editor emits on save.
 *
 * v0.1 M0: fillMissing only. v0.5 adds regenerateTree(deep:bool) for
 * duplicate/wrap ops (constraint #28).
 */
final class IDGenerator
{
    /** @var array<string, string> Map of temp-id -> generated-id from the last fillMissing call. */
    private array $lastGeneratedMap = [];

    public function generate(): string
    {
        return bin2hex(random_bytes(4));
    }

    /**
     * Walk an element tree and assign IDs to any element missing one,
     * OR any element whose ID looks like a placeholder (temp-N).
     *
     * @param array $elements Element tree (recursive).
     * @return array Tree with all IDs populated.
     */
    public function fillMissing(array $elements): array
    {
        $this->lastGeneratedMap = [];
        $existingIds = $this->collectIds($elements);
        return $this->walkAssign($elements, $existingIds);
    }

    /** @return array<string, string> */
    public function lastGeneratedMap(): array
    {
        return $this->lastGeneratedMap;
    }

    private function walkAssign(array $elements, array &$existingIds): array
    {
        foreach ($elements as $i => $el) {
            if (!is_array($el)) {
                continue;
            }
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
        // Astronomically unlikely; fall back to a longer ID.
        return bin2hex(random_bytes(6));
    }
}
