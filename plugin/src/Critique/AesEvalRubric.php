<?php
declare(strict_types=1);

namespace Joist\Critique;

/**
 * @purpose AesEval-Bench rubric substrate.
 *
 * AesEval-Bench (March 2026, arxiv 2603.01083, ICLR'26 under review) is the
 * closest thing to SWE-bench for design judgment quality: 4 dimensions x 12
 * indicators across 3 tasks (judgment / region selection / precise
 * localization), ~4,500 QA pairs, 30K-example training set. GPT-5 leads the
 * leaderboard at 72.5% judgment and 19.9% IoU on precise localization.
 *
 * Joist's v1.0 commitment is to publish a public AesEval-Bench score for
 * `/elementor-critique`. This class is the substrate: the textual indicator
 * prompts that get templated into the critique skill's input so the model's
 * output is bench-comparable. The actual benchmark run is a v1.0 deliverable;
 * Wave 11 ships the scoring scaffold so future work has a stable surface to
 * harness against.
 *
 * The four dimensions, paraphrased from the paper:
 *   1. Composition  — coherent whole, hierarchy, focal point
 *   2. Color        — palette discipline, contrast, restraint
 *   3. Typography   — type-scale, rhythm, line-length, weight discipline
 *   4. Functional   — usability, affordance clarity, mobile-readability
 *
 * Each dimension has three indicators (12 total). Each indicator is a textual
 * prompt that the model scores 0-10. The harness composes them into the
 * elementor-critique skill's input so the critique JSON output includes
 * per-indicator scores AesEval-Bench can read directly.
 *
 * Cited in failure-mode constraint #24 (no autonomous raw-VLM filter): even
 * GPT-5 hits only 19.9% IoU on precise flaw localization. So the rubric
 * supports judgment + region selection but NOT precise bbox auto-fix.
 *
 * See specs/WAVE_9_2026-05-29.md §7 (AesEval-Bench public targeting).
 */
final class AesEvalRubric
{
    public const VERSION = '1.0.0-aeseval-2026-03';

    /** Dimension keys (stable wire format). */
    public const DIM_COMPOSITION = 'composition';
    public const DIM_COLOR = 'color';
    public const DIM_TYPOGRAPHY = 'typography';
    public const DIM_FUNCTIONAL = 'functional';

    /**
     * The 4 dimensions x 3 indicators = 12 indicator catalogue.
     *
     * Each entry: {key, dimension, prompt, scoring_anchor}. The prompt is the
     * exact text templated into the critique skill input; the scoring_anchor
     * is the 0/5/10 calibration the skill is asked to apply.
     *
     * @return list<array{key:string,dimension:string,prompt:string,scoring_anchor:string}>
     */
    public static function indicators(): array
    {
        return [
            // ─── Composition (4 dimensions x 3 indicators = 12) ─────────────
            [
                'key' => 'comp_focal_point',
                'dimension' => self::DIM_COMPOSITION,
                'prompt' => 'Does the page have a single, unambiguous primary focal point? Score the strength of visual hierarchy where 0 means multiple competing focal points and 10 means one clear primary surface with deliberately graded secondary surfaces.',
                'scoring_anchor' => '0: three competing CTAs in the hero. 5: one focal point but secondary surfaces compete. 10: unambiguous primary, graded secondaries.',
            ],
            [
                'key' => 'comp_rhythm',
                'dimension' => self::DIM_COMPOSITION,
                'prompt' => 'Is the vertical rhythm between sections deliberate? Score how consciously the page modulates section heights and breathing room versus stacking equal-weight blocks.',
                'scoring_anchor' => '0: all sections same height, no rhythm. 5: rhythm present but mechanical. 10: rhythm is itself a design move.',
            ],
            [
                'key' => 'comp_coherence',
                'dimension' => self::DIM_COMPOSITION,
                'prompt' => 'Does the page read as a single composition or as a stack of independent widgets? Score the coherence of the whole versus the sum of parts.',
                'scoring_anchor' => '0: visibly assembled, not designed. 5: coherence in some sections but not throughout. 10: reads as one piece.',
            ],
            // ─── Color (3 indicators) ───────────────────────────────────────
            [
                'key' => 'color_palette_discipline',
                'dimension' => self::DIM_COLOR,
                'prompt' => 'How strictly does the page adhere to the supplied brand palette? Score the count of off-palette accents and the magnitude of drift.',
                'scoring_anchor' => '0: multiple off-palette colors. 5: one off-palette accent at near-tolerance. 10: no drift.',
            ],
            [
                'key' => 'color_contrast',
                'dimension' => self::DIM_COLOR,
                'prompt' => 'Do all text/background pairs pass WCAG-AA contrast (4.5:1 for normal text, 3:1 for large)? Score by counting violations.',
                'scoring_anchor' => '0: multiple AA failures including body text. 5: one borderline failure on a non-critical surface. 10: all pairs pass AA.',
            ],
            [
                'key' => 'color_restraint',
                'dimension' => self::DIM_COLOR,
                'prompt' => 'Does the page use color restraint, or does it lean on gradients, drop shadows, and tint variations to compensate for weak composition?',
                'scoring_anchor' => '0: stock-photo gradient hero, multiple gradients, shadow stacks. 5: occasional gradient. 10: composition does the lifting, color supports it.',
            ],
            // ─── Typography (3 indicators) ──────────────────────────────────
            [
                'key' => 'typo_scale',
                'dimension' => self::DIM_TYPOGRAPHY,
                'prompt' => 'Does the page use a coherent type scale (a deliberate ratio: 1.250, 1.333, 1.414 etc.) with consistent steps from caption to display?',
                'scoring_anchor' => '0: arbitrary type sizes, no ladder. 5: ladder present but with one off-scale jump. 10: clean ladder, every step has purpose.',
            ],
            [
                'key' => 'typo_rhythm',
                'dimension' => self::DIM_TYPOGRAPHY,
                'prompt' => 'Is the vertical rhythm of type consistent? Line-height, paragraph spacing, baseline alignment. Score against a baseline grid.',
                'scoring_anchor' => '0: drifted baselines, ragged paragraph spacing. 5: rhythm present, one slip. 10: snaps to baseline grid throughout.',
            ],
            [
                'key' => 'typo_line_length',
                'dimension' => self::DIM_TYPOGRAPHY,
                'prompt' => 'Body text line length: target 50-75 characters. Score against this range and penalize hard for extremes.',
                'scoring_anchor' => '0: body text under 30 or over 100 chars per line. 5: 80-90 chars (slightly long). 10: 55-72 chars throughout.',
            ],
            // ─── Functional (3 indicators) ──────────────────────────────────
            [
                'key' => 'func_affordance_clarity',
                'dimension' => self::DIM_FUNCTIONAL,
                'prompt' => 'Are interactive affordances (buttons, links, forms) visually distinct and unambiguous in their target?',
                'scoring_anchor' => '0: button styled like body text, link buried in paragraph. 5: most affordances clear, one ambiguous. 10: every interactive element reads as such.',
            ],
            [
                'key' => 'func_mobile_readability',
                'dimension' => self::DIM_FUNCTIONAL,
                'prompt' => 'Will this page hold up on mobile (375-414px)? Score against type-size (minimum 16px body), tap-target size, and content collapse behavior.',
                'scoring_anchor' => '0: body type under 14px or tap-targets under 40px. 5: type readable but layout collapse is awkward. 10: scales cleanly.',
            ],
            [
                'key' => 'func_overlap',
                'dimension' => self::DIM_FUNCTIONAL,
                'prompt' => 'Are there any overlapping elements, text obscured by images, or cut-off content visible without scroll?',
                'scoring_anchor' => '0: visible overlap or cut-off content above fold. 5: one borderline crop. 10: no overlap anywhere.',
            ],
        ];
    }

    /**
     * Compose the rubric block as a single text string for templating into
     * the critique skill's input. Keep this stable across versions — the
     * AesEval-Bench harness will diff against this format.
     */
    public static function asPrompt(): string
    {
        $lines = [
            "# AesEval-Bench rubric (v" . self::VERSION . ")",
            "# Score each indicator 0-10 with the scoring_anchor as calibration.",
            "# Return scores in the `axes.aeseval` object of your JSON response.",
            "",
        ];
        $byDim = [];
        foreach (self::indicators() as $ind) {
            $byDim[$ind['dimension']][] = $ind;
        }
        foreach ([self::DIM_COMPOSITION, self::DIM_COLOR, self::DIM_TYPOGRAPHY, self::DIM_FUNCTIONAL] as $dim) {
            $lines[] = "## Dimension: {$dim}";
            foreach ($byDim[$dim] ?? [] as $ind) {
                $lines[] = "### {$ind['key']}";
                $lines[] = $ind['prompt'];
                $lines[] = "Anchor: {$ind['scoring_anchor']}";
                $lines[] = "";
            }
        }
        return implode("\n", $lines);
    }

    /**
     * The full public surface — for the introspection endpoint + AesEval-Bench
     * harness publication.
     *
     * @return array{
     *   version: string,
     *   dimensions: list<string>,
     *   indicators: list<array{key:string,dimension:string,prompt:string,scoring_anchor:string}>,
     *   indicator_count: int,
     *   dimension_count: int,
     *   citation: string
     * }
     */
    public static function publicSchema(): array
    {
        return [
            'version' => self::VERSION,
            'dimensions' => [
                self::DIM_COMPOSITION,
                self::DIM_COLOR,
                self::DIM_TYPOGRAPHY,
                self::DIM_FUNCTIONAL,
            ],
            'indicators' => self::indicators(),
            'indicator_count' => count(self::indicators()),
            'dimension_count' => 4,
            'citation' => 'AesEval-Bench (March 2026, arxiv 2603.01083, ICLR\'26 under review). Joist v1.0 commits to publishing a public benchmark score.',
        ];
    }

    /**
     * Compute per-dimension means from a raw indicator-score map.
     *
     * @param array<string,int> $scores  Indicator key => 0..10
     * @return array<string,float>       Dimension key => mean 0..10
     */
    public static function dimensionMeans(array $scores): array
    {
        $byDim = [];
        foreach (self::indicators() as $ind) {
            $key = $ind['key'];
            $dim = $ind['dimension'];
            if (!isset($scores[$key])) {
                continue;
            }
            $val = max(0, min(10, (int) $scores[$key]));
            $byDim[$dim][] = $val;
        }
        $out = [];
        foreach ($byDim as $dim => $vals) {
            $out[$dim] = count($vals) > 0 ? array_sum($vals) / count($vals) : 0.0;
        }
        return $out;
    }

    /**
     * Compute the composite (the AesEval-Bench judgment score, normalised to
     * 0..1). Mean of dimension means, then floored by the lowest dimension
     * divided by 10 — a 1/10 on composition cannot be hidden by 9s elsewhere.
     *
     * @param array<string,int> $scores
     */
    public static function composite(array $scores): float
    {
        $dimMeans = self::dimensionMeans($scores);
        if (count($dimMeans) === 0) {
            return 0.0;
        }
        $mean = array_sum($dimMeans) / count($dimMeans);
        $lowest = min($dimMeans);
        // Min-floor by lowest dimension; cap at the unfloored mean.
        $composite = min($mean, max($mean * 0.5, $lowest));
        return round($composite / 10.0, 4);
    }
}
