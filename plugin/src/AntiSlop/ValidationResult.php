<?php
declare(strict_types=1);

namespace Joist\AntiSlop;

/**
 * @purpose Outcome of CopyValidator::validate(). Plain DTO; JSON-serialisable
 *          via toApi().
 *
 * Score semantics:
 *   100  clean — no violations across all four layers
 *   90+  trace-level violations (low-severity tokens only)
 *   <70  slop — caller should run the bounded repair retry
 *   0    drowning in slop
 */
final class ValidationResult
{
    /**
     * @param list<array{layer:string, kind:string, match:string, severity:string, position:int, replacement_suggestion:?string, hint:?string, category:string}> $violations
     */
    public function __construct(
        public bool $passed,
        public int $score,
        public array $violations,
        public bool $requiresRepair,
        public string $repairHint,
    ) {}

    /** @return array<string,mixed> */
    public function toApi(): array
    {
        return [
            'passed' => $this->passed,
            'score' => $this->score,
            'violations' => $this->violations,
            'violation_count' => count($this->violations),
            'requires_repair' => $this->requiresRepair,
            'repair_hint' => $this->repairHint,
        ];
    }
}
