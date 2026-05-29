<?php
declare(strict_types=1);

namespace Joist\AntiSlop;

/**
 * @purpose Outcome of ImageValidator::validate(). Plain DTO.
 *
 * verdict semantics:
 *   'clean'             — palette compliant, no flagged text regions, anatomy ok
 *   'flagged'           — at least one check returned a fail-state result
 *   'requires_review'   — anatomy check is unconfigured (no Python service URL)
 *                         and we cannot definitively clear the image
 */
final class ImageValidationResult
{
    public const VERDICT_CLEAN = 'clean';
    public const VERDICT_FLAGGED = 'flagged';
    public const VERDICT_REQUIRES_REVIEW = 'requires_review';

    public const ANATOMY_CLEAN = 'clean';
    public const ANATOMY_FLAGGED = 'flagged';
    public const ANATOMY_UNCHECKED = 'unchecked';

    /**
     * @param list<array{hex:string, percentage:float, brand_match:bool, deltaE:float}> $palette
     * @param list<array{x:int, y:int, width:int, height:int, area_pct:float, color:string}> $textRegions
     * @param list<string> $reasons
     */
    public function __construct(
        public bool $passed,
        public string $verdict,
        public array $palette,
        public array $textRegions,
        public string $anatomy,
        public bool $requiresHumanReview,
        public array $reasons,
    ) {}

    /** @return array<string,mixed> */
    public function toApi(): array
    {
        return [
            'passed' => $this->passed,
            'verdict' => $this->verdict,
            'palette' => $this->palette,
            'text_regions' => $this->textRegions,
            'anatomy' => $this->anatomy,
            'requires_human_review' => $this->requiresHumanReview,
            'reasons' => $this->reasons,
        ];
    }
}
