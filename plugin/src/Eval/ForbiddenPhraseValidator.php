<?php
declare(strict_types=1);

namespace Joist\Eval;

/**
 * Pre-plan validator that checks generated text against per-site forbidden_phrase
 * rules. Lets the agent self-correct BEFORE the plan reaches the user.
 *
 * Cheap regex pass over visible text content of the agent's proposed element tree.
 * Runs on the v0.7 hot path. Returns violations the agent should address.
 */
final class ForbiddenPhraseValidator
{
    public function __construct(private PreferenceMemory $memory) {}

    /**
     * Walk an element tree, extract text content, check against rules.
     *
     * @return list<array{rule_id:string, kind:string, pattern:string, directive:string, where:string, sample:string}>
     */
    public function validateTree(array $elements, ?string $siteId = null): array
    {
        $rules = array_filter(
            $this->memory->listActive($siteId),
            fn(Rule $r) => $r->kind === Rule::KIND_FORBIDDEN_PHRASE
        );
        if (count($rules) === 0) {
            return [];
        }

        $violations = [];
        $this->walk($elements, $rules, $violations);
        return $violations;
    }

    /**
     * Validate a single block of text against the rules.
     *
     * @return list<array{rule_id:string, pattern:string, directive:string}>
     */
    public function validateText(string $text, ?string $siteId = null): array
    {
        $violations = [];
        foreach ($this->memory->listActive($siteId) as $rule) {
            if ($rule->kind !== Rule::KIND_FORBIDDEN_PHRASE) continue;
            if ($rule->matches($text)) {
                $violations[] = [
                    'rule_id' => $rule->id,
                    'pattern' => $rule->pattern,
                    'directive' => $rule->directive,
                ];
                $this->memory->recordInvocation($rule->id);
            }
        }
        return $violations;
    }

    private function walk(array $elements, array $rules, array &$violations): void
    {
        foreach ($elements as $el) {
            if (!is_array($el)) continue;

            $settings = is_array($el['settings'] ?? null) ? $el['settings'] : [];
            $elementId = (string) ($el['id'] ?? '');
            $widgetType = (string) ($el['widgetType'] ?? $el['elType'] ?? '');

            // Common text-bearing setting keys.
            foreach (['title', 'heading', 'text', 'editor', 'description', 'subtitle', 'button_text', 'caption'] as $key) {
                if (!isset($settings[$key]) || !is_string($settings[$key])) continue;
                $stripped = trim(wp_strip_all_tags($settings[$key]));
                if ($stripped === '') continue;
                foreach ($rules as $rule) {
                    if ($rule->matches($stripped)) {
                        $violations[] = [
                            'rule_id' => $rule->id,
                            'kind' => $rule->kind,
                            'pattern' => $rule->pattern,
                            'directive' => $rule->directive,
                            'where' => "{$widgetType}:{$elementId}.settings.{$key}",
                            'sample' => mb_substr($stripped, 0, 120),
                        ];
                        $this->memory->recordInvocation($rule->id);
                    }
                }
            }

            if (isset($el['elements']) && is_array($el['elements'])) {
                $this->walk($el['elements'], $rules, $violations);
            }
        }
    }
}
