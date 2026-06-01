<?php
declare(strict_types=1);

namespace Joist\Elementor;

/**
 * @purpose Auto-inject the flex-sizing CSS that Elementor 4.0.9 (atomic) silently
 *          drops, so multi-column rows actually render side-by-side.
 *
 * Verified 2026-05-31 (eval baseline, probe pages 317 + 367): on this atomic
 * Elementor build, a flex-child container's `width:{%}` and `_flex_basis` controls
 * do NOT compile to CSS — only flex-grow/shrink do. Result: any `flex_direction:row`
 * + `flex_wrap:wrap` row whose children carry intrinsic/large content (images) wraps
 * to separate lines and STACKS. `_flex_size:custom` does not rescue it.
 *
 * The one mechanism that DOES compile is per-element `custom_css` (the `selector`
 * placeholder → `.elementor-element-{id}`). Probe 367 confirmed three cards with
 * injected `flex:0 0 calc(W% - gap)` render in correct thirds in the hard wrap case.
 *
 * This filler turns the `width:{%}` the agent already authors into that CSS, so the
 * generator never has to hand-write a <style> block (builds B1/B3/B5 each lost
 * iterations doing it manually, and B1/B3 shipped stacked because they didn't).
 *
 * Scope is deliberately conservative:
 *   - Only containers whose PARENT has an explicit `flex_direction:row`. A child of a
 *     column container with width:% means something else — left alone.
 *   - Only `width` unit `%`. Pixel widths are a different intent.
 *   - Idempotent: skips a child whose custom_css already declares a `flex:` rule
 *     (agent authored it) or already carries our marker (re-run safe).
 *   - Existing custom_css is preserved; our block is appended.
 *
 * Always-on correctness fix — unlike ResponsiveFiller it is NOT opt-in. A row that
 * stacks is never the intended output.
 */
final class FlexWidthFiller
{
    private const MARKER = '/*joist-fw*/';

    /**
     * Walk an element tree and inject flex-width custom_css on `%`-sized flex-row children.
     *
     * @return array{0: array, 1: list<array>} [tree, log of injections]
     */
    public function fill(array $elements): array
    {
        $log = [];
        $tree = $this->walk($elements, null, $log);
        return [$tree, $log];
    }

    /**
     * @param array      $elements  siblings at this level
     * @param array|null $parent    the parent container's settings (null at root)
     */
    private function walk(array $elements, ?array $parent, array &$log): array
    {
        // How many of these siblings are containers? Used for gap math.
        $siblingContainers = 0;
        foreach ($elements as $el) {
            if (is_array($el) && ($el['elType'] ?? '') === 'container') {
                $siblingContainers++;
            }
        }

        $parentIsRow = is_array($parent)
            && (($parent['flex_direction'] ?? '') === 'row');
        $parentGapPx = $this->gapPx($parent);

        foreach ($elements as $i => $el) {
            if (!is_array($el)) {
                continue;
            }

            if (($el['elType'] ?? '') === 'container') {
                $settings = is_array($el['settings'] ?? null) ? $el['settings'] : [];

                if ($parentIsRow) {
                    $pct = $this->widthPercent($settings);
                    if ($pct !== null && !$this->alreadyHandled($settings)) {
                        $css = $this->buildCss($pct, $parentGapPx, $siblingContainers);
                        $settings['custom_css'] = $this->mergeCss($settings['custom_css'] ?? '', $css);
                        $elements[$i]['settings'] = $settings;
                        $log[] = [
                            'element_id' => (string) ($el['id'] ?? ''),
                            'width_pct'  => $pct,
                            'gap_px'     => $parentGapPx,
                            'siblings'   => $siblingContainers,
                        ];
                    }
                }

                // v2 row-intent inference: if THIS container has 2+ %-width child
                // containers but isn't already a row, the author meant columns (e.g. a
                // text+image card where flex_direction was left unset → Elementor default
                // column → children stacked, clone C6). Promote it to a wrapping row so its
                // children get sized on the recursion below. `--flex-direction:row` DOES
                // compile on 4.0.9 (only child `width` doesn't) — so this is safe + cheap.
                // Guarded at 2+ to avoid promoting a single centered width:50% block.
                if (($settings['flex_direction'] ?? '') !== 'row'
                    && $this->pctWidthChildCount($el['elements'] ?? []) >= 2) {
                    $settings['flex_direction'] = 'row';
                    if (empty($settings['flex_wrap'])) {
                        $settings['flex_wrap'] = 'wrap';
                    }
                    $elements[$i]['settings'] = $settings;
                    $log[] = [
                        'element_id' => (string) ($el['id'] ?? ''),
                        'promoted_to_row' => true,
                        'pct_children' => $this->pctWidthChildCount($el['elements'] ?? []),
                    ];
                }

                // Recurse with THIS container's settings as the new parent context.
                if (isset($el['elements']) && is_array($el['elements'])) {
                    $elements[$i]['elements'] = $this->walk(
                        $el['elements'],
                        is_array($elements[$i]['settings'] ?? null) ? $elements[$i]['settings'] : $settings,
                        $log
                    );
                }
            } elseif (isset($el['elements']) && is_array($el['elements'])) {
                // Non-container node with children (rare) — recurse, no row context.
                $elements[$i]['elements'] = $this->walk($el['elements'], null, $log);
            }
        }

        return $elements;
    }

    /** Count direct child CONTAINERS that carry a `%` width — the row-intent signal. */
    private function pctWidthChildCount(array $kids): int
    {
        $n = 0;
        foreach ($kids as $k) {
            if (is_array($k)
                && ($k['elType'] ?? '') === 'container'
                && $this->widthPercent(is_array($k['settings'] ?? null) ? $k['settings'] : []) !== null) {
                $n++;
            }
        }
        return $n;
    }

    /** Extract a `%` width size, or null if width isn't a percentage. */
    private function widthPercent(array $settings): ?float
    {
        $w = $settings['width'] ?? null;
        if (!is_array($w)) {
            return null;
        }
        if (($w['unit'] ?? '') !== '%') {
            return null;
        }
        if (!isset($w['size']) || !is_numeric($w['size'])) {
            return null;
        }
        $size = (float) $w['size'];
        return ($size > 0 && $size <= 100) ? $size : null;
    }

    /** Parent flex_gap column size in px (0 if unset / non-px). */
    private function gapPx(?array $parent): int
    {
        if (!is_array($parent)) {
            return 0;
        }
        $gap = $parent['flex_gap'] ?? null;
        if (!is_array($gap)) {
            return 0;
        }
        // flex_gap shape: {unit, size, column, row}. Prefer explicit column, else size.
        $col = $gap['column'] ?? ($gap['size'] ?? null);
        if (($gap['unit'] ?? 'px') !== 'px') {
            return 0;
        }
        return is_numeric($col) ? (int) round((float) $col) : 0;
    }

    /** True if the child already carries a flex rule or our marker — don't double-inject. */
    private function alreadyHandled(array $settings): bool
    {
        $css = (string) ($settings['custom_css'] ?? '');
        if ($css === '') {
            return false;
        }
        return str_contains($css, self::MARKER) || str_contains($css, 'flex:');
    }

    /**
     * Build the scoped CSS. For N items sharing a row with gap G, each item must shed
     * G*(N-1)/N of the gap from its basis so N items + (N-1) gaps fit one line.
     * Mobile (<=767px) restacks to full width.
     */
    private function buildCss(float $pct, int $gapPx, int $siblings): string
    {
        $pctStr = rtrim(rtrim(sprintf('%.4f', $pct), '0'), '.');
        if ($gapPx > 0 && $siblings > 1) {
            $sub = (int) round($gapPx * ($siblings - 1) / $siblings);
            $basis = "calc({$pctStr}% - {$sub}px)";
        } else {
            $basis = "{$pctStr}%";
        }
        return self::MARKER
            . "selector{flex:0 0 {$basis};max-width:{$basis};}"
            . '@media(max-width:767px){selector{flex:0 0 100%;max-width:100%;}}';
    }

    /** Append our block to any existing custom_css, separated by a newline. */
    private function mergeCss(string $existing, string $injected): string
    {
        $existing = trim($existing);
        return $existing === '' ? $injected : ($existing . "\n" . $injected);
    }
}
