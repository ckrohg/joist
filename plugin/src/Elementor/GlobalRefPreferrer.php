<?php
declare(strict_types=1);

namespace Joist\Elementor;

/**
 * Constraint #26: prefer __globals__ refs over literal color/font values.
 *
 * When the agent writes a literal that matches a kit global within delta-E < 5,
 * the plugin auto-rewrites to a global ref ("globals/colors/primary?id=primary")
 * and returns `transformations: ["color_to_global"]` in the response so the
 * agent learns.
 *
 * Suppression: caller can set `prefer_literals: true` on the patch op.
 */
final class GlobalRefPreferrer
{
    /** Configurable delta-E threshold for "close enough to be the same color". */
    private const DELTA_E_THRESHOLD = 5.0;

    /**
     * @return array{0:array, 1:list<string>} [transformedElements, transformationsApplied]
     */
    public function preferGlobals(array $elements, bool $preferLiterals = false): array
    {
        if ($preferLiterals) {
            return [$elements, []];
        }

        $kitColors = $this->loadKitColors();
        if (empty($kitColors)) {
            return [$elements, []];
        }

        $transformations = [];
        $transformed = $this->walkTransform($elements, $kitColors, $transformations);
        return [$transformed, $transformations];
    }

    public function matchColor(string $hex): ?array
    {
        $kitColors = $this->loadKitColors();
        if (empty($kitColors)) return null;

        $targetLab = $this->hexToLab($hex);
        if ($targetLab === null) return null;

        $best = null;
        $bestDelta = PHP_FLOAT_MAX;
        foreach ($kitColors as $global) {
            $globalLab = $this->hexToLab($global['color']);
            if ($globalLab === null) continue;
            $delta = $this->deltaE($targetLab, $globalLab);
            if ($delta < $bestDelta) {
                $bestDelta = $delta;
                $best = $global;
            }
        }

        if ($best === null || $bestDelta >= self::DELTA_E_THRESHOLD) {
            return null;
        }

        return [
            'global_ref' => "globals/colors/{$best['_id']}?id={$best['_id']}",
            'delta_e' => round($bestDelta, 2),
            'match_quality' => $bestDelta < 1 ? 'exact' : ($bestDelta < 3 ? 'close' : 'approximate'),
        ];
    }

    private function walkTransform(array $elements, array $kitColors, array &$transformations): array
    {
        foreach ($elements as $i => $el) {
            if (!is_array($el)) continue;

            if (isset($el['settings']) && is_array($el['settings'])) {
                $elements[$i]['settings'] = $this->transformSettings(
                    $el['settings'],
                    $kitColors,
                    $transformations,
                    (string) ($el['id'] ?? '')
                );
            }

            if (isset($el['elements']) && is_array($el['elements'])) {
                $elements[$i]['elements'] = $this->walkTransform($el['elements'], $kitColors, $transformations);
            }
        }
        return $elements;
    }

    private function transformSettings(array $settings, array $kitColors, array &$transformations, string $elementId): array
    {
        $globals = isset($settings['__globals__']) && is_array($settings['__globals__'])
            ? $settings['__globals__']
            : [];

        foreach ($settings as $key => $value) {
            if (!is_string($value)) continue;
            // Already a global ref.
            if (isset($globals[$key])) continue;
            // Must look like a hex.
            if (!preg_match('/^#[0-9a-fA-F]{6}$/', $value)) continue;

            $match = null;
            $matchDelta = PHP_FLOAT_MAX;
            $matchGlobal = null;
            $targetLab = $this->hexToLab($value);
            if ($targetLab === null) continue;

            foreach ($kitColors as $global) {
                $globalLab = $this->hexToLab($global['color']);
                if ($globalLab === null) continue;
                $delta = $this->deltaE($targetLab, $globalLab);
                if ($delta < $matchDelta) {
                    $matchDelta = $delta;
                    $matchGlobal = $global;
                }
            }

            if ($matchGlobal !== null && $matchDelta < self::DELTA_E_THRESHOLD) {
                $globals[$key] = "globals/colors/{$matchGlobal['_id']}?id={$matchGlobal['_id']}";
                $transformations[] = "color_to_global:{$elementId}.{$key}";
            }
        }

        if (!empty($globals)) {
            $settings['__globals__'] = $globals;
        }
        return $settings;
    }

    /**
     * Read the active kit's system_colors + custom_colors.
     *
     * @return list<array{_id:string,title:string,color:string}>
     */
    private function loadKitColors(): array
    {
        if (!class_exists('\Elementor\Plugin')) return [];
        $kits = \Elementor\Plugin::$instance->kits_manager;
        if (!is_object($kits) || !method_exists($kits, 'get_active_id')) return [];

        $kitId = (int) $kits->get_active_id();
        if ($kitId <= 0) return [];

        $document = \Elementor\Plugin::$instance->documents->get($kitId);
        if (!$document) return [];

        $settings = method_exists($document, 'get_settings') ? $document->get_settings() : [];
        $system = is_array($settings['system_colors'] ?? null) ? $settings['system_colors'] : [];
        $custom = is_array($settings['custom_colors'] ?? null) ? $settings['custom_colors'] : [];

        $out = [];
        foreach (array_merge($system, $custom) as $entry) {
            if (!is_array($entry)) continue;
            if (empty($entry['_id']) || empty($entry['color'])) continue;
            $out[] = [
                '_id' => (string) $entry['_id'],
                'title' => (string) ($entry['title'] ?? $entry['_id']),
                'color' => (string) $entry['color'],
            ];
        }
        return $out;
    }

    private function hexToLab(string $hex): ?array
    {
        $hex = ltrim($hex, '#');
        if (strlen($hex) !== 6) return null;
        $r = hexdec(substr($hex, 0, 2));
        $g = hexdec(substr($hex, 2, 2));
        $b = hexdec(substr($hex, 4, 2));
        return $this->rgbToLab($r, $g, $b);
    }

    /** Simplified sRGB → CIELAB conversion (D65 illuminant). */
    private function rgbToLab(int $r, int $g, int $b): array
    {
        $rs = $r / 255;
        $gs = $g / 255;
        $bs = $b / 255;
        // Linearize.
        $rs = $rs > 0.04045 ? (($rs + 0.055) / 1.055) ** 2.4 : $rs / 12.92;
        $gs = $gs > 0.04045 ? (($gs + 0.055) / 1.055) ** 2.4 : $gs / 12.92;
        $bs = $bs > 0.04045 ? (($bs + 0.055) / 1.055) ** 2.4 : $bs / 12.92;
        // RGB to XYZ.
        $x = ($rs * 0.4124 + $gs * 0.3576 + $bs * 0.1805) / 0.95047;
        $y = ($rs * 0.2126 + $gs * 0.7152 + $bs * 0.0722);
        $z = ($rs * 0.0193 + $gs * 0.1192 + $bs * 0.9505) / 1.08883;
        $fx = $x > 0.008856 ? $x ** (1/3) : 7.787 * $x + 16/116;
        $fy = $y > 0.008856 ? $y ** (1/3) : 7.787 * $y + 16/116;
        $fz = $z > 0.008856 ? $z ** (1/3) : 7.787 * $z + 16/116;
        return [
            'L' => 116 * $fy - 16,
            'a' => 500 * ($fx - $fy),
            'b' => 200 * ($fy - $fz),
        ];
    }

    /** CIE76 delta-E. (CIEDE2000 is more accurate but overkill for v0.5.) */
    private function deltaE(array $lab1, array $lab2): float
    {
        return sqrt(
            ($lab1['L'] - $lab2['L']) ** 2
            + ($lab1['a'] - $lab2['a']) ** 2
            + ($lab1['b'] - $lab2['b']) ** 2
        );
    }
}
