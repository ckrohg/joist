<?php
declare(strict_types=1);

namespace Joist\Elementor;

/**
 * §6.7: parse + merge named custom-CSS blocks.
 *
 * Convention: blocks wrapped with /* TENET:BEGIN tag=X *\/ ... /* TENET:END *\/
 * Unnamed CSS is tagged `legacy` on first parse and never overwritten by the agent.
 *
 * Patch ops use { tag, css } instead of raw `custom_css` — the manager merges
 * preserving non-target blocks (kills msrbuilds #30 §1.2: append-only
 * accumulation).
 */
final class CustomCSSBlockManager
{
    private const BEGIN_PATTERN = '/\/\*\s*TENET:BEGIN\s+tag=([a-zA-Z0-9_-]+)\s*\*\//';
    private const END_PATTERN = '/\/\*\s*TENET:END\s*\*\//';

    /**
     * Parse a custom_css string into named blocks.
     *
     * @return list<array{tag:string, css:string, actor:string}>
     */
    public function parse(string $customCss): array
    {
        $blocks = [];
        $pos = 0;
        $len = strlen($customCss);
        $legacyBuffer = '';

        while ($pos < $len) {
            // Find the next BEGIN marker.
            if (!preg_match(self::BEGIN_PATTERN, $customCss, $beginMatch, PREG_OFFSET_CAPTURE, $pos)) {
                // No more markers — everything from pos to end is legacy.
                $legacyBuffer .= substr($customCss, $pos);
                break;
            }
            $beginPos = $beginMatch[0][1];
            $tag = $beginMatch[1][0];
            $afterBegin = $beginPos + strlen($beginMatch[0][0]);

            // Capture any pre-marker CSS as legacy.
            $legacyBuffer .= substr($customCss, $pos, $beginPos - $pos);

            // Find the matching END marker.
            if (!preg_match(self::END_PATTERN, $customCss, $endMatch, PREG_OFFSET_CAPTURE, $afterBegin)) {
                // Unterminated block — treat from BEGIN to end as that tag's content.
                $blocks[] = [
                    'tag' => $tag,
                    'css' => trim(substr($customCss, $afterBegin)),
                    'actor' => 'unknown',
                ];
                $pos = $len;
                break;
            }
            $endPos = $endMatch[0][1];
            $blocks[] = [
                'tag' => $tag,
                'css' => trim(substr($customCss, $afterBegin, $endPos - $afterBegin)),
                'actor' => 'unknown',
            ];
            $pos = $endPos + strlen($endMatch[0][0]);
        }

        if (trim($legacyBuffer) !== '') {
            $blocks[] = [
                'tag' => 'legacy',
                'css' => trim($legacyBuffer),
                'actor' => 'human', // assume legacy = human-written
            ];
        }

        return $blocks;
    }

    /**
     * Serialize blocks back to a single custom_css string with markers.
     */
    public function serialize(array $blocks): string
    {
        $parts = [];
        foreach ($blocks as $block) {
            if (empty($block['css'])) continue;
            $tag = (string) $block['tag'];
            if ($tag === 'legacy') {
                $parts[] = $block['css'];
            } else {
                $parts[] = "/* TENET:BEGIN tag={$tag} */\n" . $block['css'] . "\n/* TENET:END */";
            }
        }
        return implode("\n\n", $parts);
    }

    /**
     * Apply a block patch — replaces the block with matching tag, preserving others.
     * Inserts the block if no existing match.
     */
    public function mergeBlock(string $existingCss, string $tag, string $newCss): string
    {
        $blocks = $this->parse($existingCss);
        $replaced = false;
        foreach ($blocks as $i => $block) {
            if ($block['tag'] === $tag) {
                $blocks[$i]['css'] = $newCss;
                $blocks[$i]['actor'] = 'agent';
                $replaced = true;
                break;
            }
        }
        if (!$replaced) {
            $blocks[] = ['tag' => $tag, 'css' => $newCss, 'actor' => 'agent'];
        }
        return $this->serialize($blocks);
    }
}
