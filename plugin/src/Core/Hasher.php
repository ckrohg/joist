<?php
declare(strict_types=1);

namespace Joist\Core;

/**
 * Canonicalize Elementor element trees into a deterministic byte sequence
 * and SHA-256 hash them. This is the OCC primitive — every read returns
 * a hash; every write echoes the hash it was planned against; mismatch
 * triggers a 409.
 *
 * Canonicalization rules:
 *   1. Recursively sort object keys.
 *   2. Strip transient render-time fields the editor adds.
 *   3. Normalize array vs object empty-state (PHP json_encode quirk: empty
 *      array → [], empty assoc → {}). We force objects for settings/elements.
 *   4. UTF-8 + JSON_UNESCAPED_SLASHES, no pretty-printing.
 */
final class Hasher
{
    /** @var list<string> Fields stripped during canonicalization. */
    private const TRANSIENT_FIELDS = [
        '_temp_id',
    ];

    public function forElements(array $elements): string
    {
        return 'sha256:' . hash('sha256', $this->canonicalize($elements));
    }

    public function forPage(int $postId): string
    {
        // Read through Elementor's documented API, not raw postmeta.
        $document = \Elementor\Plugin::$instance->documents->get($postId);
        if (!$document || !$document->is_built_with_elementor()) {
            return 'sha256:' . hash('sha256', '[]');
        }
        $data = $document->get_elements_data();
        return $this->forElements(is_array($data) ? $data : []);
    }

    private function canonicalize(array $elements): string
    {
        $normalized = $this->normalizeNode($elements);
        $json = wp_json_encode($normalized, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        return $json === false ? '[]' : $json;
    }

    /**
     * Recursively normalize: sort keys, strip transients.
     *
     * @param mixed $node
     * @return mixed
     */
    private function normalizeNode($node)
    {
        if (is_array($node)) {
            // Detect sequential array (list) vs assoc.
            if ($this->isList($node)) {
                return array_values(array_map([$this, 'normalizeNode'], $node));
            }
            $out = [];
            foreach ($node as $key => $value) {
                if (in_array($key, self::TRANSIENT_FIELDS, true)) {
                    continue;
                }
                $out[$key] = $this->normalizeNode($value);
            }
            ksort($out, SORT_STRING);
            return $out;
        }
        return $node;
    }

    private function isList(array $arr): bool
    {
        if (function_exists('array_is_list')) {
            return array_is_list($arr);
        }
        $i = 0;
        foreach ($arr as $k => $_) {
            if ($k !== $i++) return false;
        }
        return true;
    }
}
