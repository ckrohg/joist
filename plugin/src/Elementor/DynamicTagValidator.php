<?php
declare(strict_types=1);

namespace Joist\Elementor;

/**
 * Constraint #25: validate `__dynamic__` references against the live
 * registered-tags registry. Unregistered tag → 422 with fuzzy-match
 * suggestions.
 *
 * Elementor stores dynamic tag references as:
 *   "settings": {
 *     "title": "fallback static text",
 *     "__dynamic__": {
 *       "title": "[elementor-tag id=\"abc\" name=\"post-title\" settings=\"%7B%7D\"]"
 *     }
 *   }
 */
final class DynamicTagValidator
{
    /** @return list<array{name:string,label:string,category:string,plugin_source:string}> */
    public function listAll(): array
    {
        if (!class_exists('\Elementor\Plugin')) return [];

        $manager = \Elementor\Plugin::$instance->dynamic_tags;
        if (!is_object($manager) || !method_exists($manager, 'get_tags')) return [];

        $tags = $manager->get_tags();
        $out = [];
        foreach ($tags as $name => $tag) {
            $out[] = [
                'name' => (string) $name,
                'label' => method_exists($tag, 'get_title') ? $tag->get_title() : $name,
                'category' => $this->primaryCategory($tag),
                'plugin_source' => $this->pluginSource($tag),
            ];
        }
        return $out;
    }

    public function isRegistered(string $tagName): bool
    {
        if (!class_exists('\Elementor\Plugin')) return false;
        $manager = \Elementor\Plugin::$instance->dynamic_tags;
        if (!is_object($manager) || !method_exists($manager, 'get_tags')) return false;
        $tags = $manager->get_tags();
        return isset($tags[$tagName]);
    }

    /**
     * Walk an element tree, find every __dynamic__ key, validate each ref.
     *
     * @throws InvalidSettingsException on unknown tag.
     */
    public function validateTree(array $elements): void
    {
        $registry = $this->buildRegistry();

        $stack = $elements;
        while ($stack) {
            $node = array_pop($stack);
            if (!is_array($node)) continue;

            if (isset($node['settings']['__dynamic__']) && is_array($node['settings']['__dynamic__'])) {
                foreach ($node['settings']['__dynamic__'] as $controlKey => $tagRef) {
                    $this->validateReference((string) $tagRef, $registry, [
                        'element_id' => $node['id'] ?? null,
                        'control' => $controlKey,
                    ]);
                }
            }

            if (isset($node['elements']) && is_array($node['elements'])) {
                foreach ($node['elements'] as $child) {
                    $stack[] = $child;
                }
            }
        }
    }

    /**
     * @throws InvalidSettingsException
     */
    private function validateReference(string $ref, array $registry, array $context): void
    {
        // Parse the [elementor-tag name="X"] shortcode-ish syntax.
        if (!preg_match('/name="([a-z0-9_-]+)"/i', $ref, $m)) {
            // Some refs use single quotes or HTML entities. Try a broader regex.
            if (!preg_match('/name=[\'"\x{201C}\x{201D}]([a-z0-9_-]+)/iu', $ref, $m)) {
                return; // Malformed but we won't block here; could be a legitimate edge case.
            }
        }
        $tagName = $m[1];

        if (isset($registry[$tagName])) {
            return; // Valid.
        }

        // Suggest fuzzy matches.
        $suggestions = [];
        foreach (array_keys($registry) as $known) {
            if (levenshtein($tagName, $known) <= 2) {
                $suggestions[] = $known;
            }
        }

        throw new InvalidSettingsException(
            'dynamic_tag.unknown',
            "Dynamic tag '{$tagName}' is not registered on this site. "
                . (count($suggestions) > 0
                    ? 'Did you mean: ' . implode(', ', array_slice($suggestions, 0, 3)) . '?'
                    : 'Run GET /dynamic-tags to see available tags.'),
            array_merge($context, [
                'tag_name' => $tagName,
                'suggestions' => $suggestions,
            ])
        );
    }

    private function buildRegistry(): array
    {
        $registry = [];
        foreach ($this->listAll() as $tag) {
            $registry[$tag['name']] = $tag;
        }
        return $registry;
    }

    private function primaryCategory($tag): string
    {
        if (method_exists($tag, 'get_group')) return (string) $tag->get_group();
        return 'general';
    }

    private function pluginSource($tag): string
    {
        $class = get_class($tag);
        if (str_starts_with($class, 'ElementorPro\\')) return 'elementor-pro';
        if (str_starts_with($class, 'Elementor\\')) return 'elementor';
        if (str_starts_with($class, 'Jet')) return 'jet-engine';
        if (str_contains(strtolower($class), 'acf')) return 'acf';
        return 'unknown';
    }
}
