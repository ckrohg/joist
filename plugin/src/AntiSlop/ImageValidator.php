<?php
declare(strict_types=1);

namespace Joist\AntiSlop;

use Joist\Core\Logger;

/**
 * @purpose Post-generation anti-slop validator for AI-generated images.
 *
 * Three layers, gated by capability:
 *   1. Palette compliance — required, runs in PHP via GD. Downsamples the image
 *      to a 50x50 grid, bins each pixel by 16-step RGB cubes, picks the top-5
 *      dominant bins, and compares each to the brand palette via Delta-E (CIE76
 *      in Lab space). Misses (no brand color within DELTA_E_THRESHOLD) flag.
 *   2. Text-render heuristic — required, runs in PHP via GD. Detects large
 *      uniformly-coloured rectangular blocks (≥5% of canvas, low colour
 *      variance) as candidate text overlays. This is a placeholder for full
 *      OCR; documented as v0.9 follow-up. We emit a warning, not a fail.
 *   3. Anatomy / body-distortion check — Python microservice (ViT-HD per
 *      arxiv 2503.00811). If JOIST_ANATOMY_SERVICE_URL (constant or wp_option
 *      'joist_anatomy_service_url') is unset OR the call fails, anatomy is
 *      'unchecked' and requires_human_review = true (failure-mode #16: no
 *      silent passes — surface the uncertainty).
 *
 * Python service contract (when configured):
 *   POST <url>/anatomy
 *   Content-Type: application/json
 *   Body: {"image_b64": "<base64-PNG>", "brand_profile_id": "<id?>"}
 *   200 OK: {"verdict": "clean"|"flagged", "score": 0..1, "reasons": [...]}
 *   non-200 or timeout → anatomy 'unchecked', requires_human_review = true.
 *   Timeout: 5 s (joist_anatomy_service_timeout option, default 5).
 *
 * Image source: $imagePath must be a local filesystem path the PHP process can
 * read. The REST controller is responsible for resolving image_url / image_b64
 * to a temp path before invoking this class.
 */
final class ImageValidator
{
    /** Delta-E threshold below which a colour is considered "matches brand". */
    public const DELTA_E_THRESHOLD = 25.0;

    /** Downsample target — small enough to be fast, large enough to be representative. */
    public const SAMPLE_SIZE = 50;

    /** Min fraction of canvas a uniform block must occupy to be flagged. */
    public const TEXT_REGION_MIN_AREA_PCT = 5.0;

    /** Default Python anatomy service timeout (seconds). */
    public const DEFAULT_ANATOMY_TIMEOUT_S = 5;

    /**
     * @param array{palette?:list<string>, palette_strict?:bool} $brandProfile
     *        palette: list of hex strings (#RRGGBB). palette_strict (default
     *        true) makes any unmatched dominant color flag the image. If false,
     *        we report the deltas but pass the image.
     */
    public function validate(string $imagePath, array $brandProfile): ImageValidationResult
    {
        $reasons = [];

        if (!function_exists('imagecreatefromstring')) {
            // GD missing — refuse loudly per #16.
            return new ImageValidationResult(
                passed: false,
                verdict: ImageValidationResult::VERDICT_REQUIRES_REVIEW,
                palette: [],
                textRegions: [],
                anatomy: ImageValidationResult::ANATOMY_UNCHECKED,
                requiresHumanReview: true,
                reasons: ['gd_extension_missing'],
            );
        }

        if (!is_string($imagePath) || $imagePath === '' || !is_readable($imagePath)) {
            return new ImageValidationResult(
                passed: false,
                verdict: ImageValidationResult::VERDICT_REQUIRES_REVIEW,
                palette: [],
                textRegions: [],
                anatomy: ImageValidationResult::ANATOMY_UNCHECKED,
                requiresHumanReview: true,
                reasons: ['image_unreadable'],
            );
        }

        $img = @imagecreatefromstring((string) @file_get_contents($imagePath));
        if ($img === false) {
            return new ImageValidationResult(
                passed: false,
                verdict: ImageValidationResult::VERDICT_REQUIRES_REVIEW,
                palette: [],
                textRegions: [],
                anatomy: ImageValidationResult::ANATOMY_UNCHECKED,
                requiresHumanReview: true,
                reasons: ['image_decode_failed'],
            );
        }

        $strict = (bool) ($brandProfile['palette_strict'] ?? true);
        $brandColors = $this->parseBrandPalette(is_array($brandProfile['palette'] ?? null) ? $brandProfile['palette'] : []);

        $sample = $this->downsample($img);
        $palette = $this->dominantColors($sample, $brandColors);
        $textRegions = $this->detectTextRegions($sample);

        imagedestroy($img);
        imagedestroy($sample);

        $paletteFails = 0;
        foreach ($palette as $entry) {
            if (!$entry['brand_match']) {
                $paletteFails++;
            }
        }

        $anatomyState = $this->callAnatomyService($imagePath, $brandProfile, $reasons);

        $flagged = false;
        if ($strict && $paletteFails > 0) {
            $flagged = true;
            $reasons[] = 'palette_off_brand';
        }
        if (count($textRegions) > 0) {
            // Warning only — does not fail by itself.
            $reasons[] = 'text_overlay_candidate';
        }
        if ($anatomyState === ImageValidationResult::ANATOMY_FLAGGED) {
            $flagged = true;
            $reasons[] = 'anatomy_flagged';
        }

        $requiresReview = $anatomyState === ImageValidationResult::ANATOMY_UNCHECKED;

        if ($flagged) {
            $verdict = ImageValidationResult::VERDICT_FLAGGED;
        } elseif ($requiresReview) {
            $verdict = ImageValidationResult::VERDICT_REQUIRES_REVIEW;
        } else {
            $verdict = ImageValidationResult::VERDICT_CLEAN;
        }

        return new ImageValidationResult(
            passed: $verdict === ImageValidationResult::VERDICT_CLEAN,
            verdict: $verdict,
            palette: $palette,
            textRegions: $textRegions,
            anatomy: $anatomyState,
            requiresHumanReview: $requiresReview,
            reasons: $reasons,
        );
    }

    /** @return list<array{r:int,g:int,b:int,hex:string}> */
    private function parseBrandPalette(array $hexList): array
    {
        $out = [];
        foreach ($hexList as $hex) {
            if (!is_string($hex)) continue;
            $h = ltrim($hex, '#');
            if (!preg_match('/^[0-9a-fA-F]{6}$/', $h)) continue;
            $out[] = [
                'r' => (int) hexdec(substr($h, 0, 2)),
                'g' => (int) hexdec(substr($h, 2, 2)),
                'b' => (int) hexdec(substr($h, 4, 2)),
                'hex' => '#' . strtolower($h),
            ];
        }
        return $out;
    }

    /**
     * Downsample to SAMPLE_SIZE x SAMPLE_SIZE for fast histogramming.
     *
     * @param \GdImage $img
     * @return \GdImage
     */
    private function downsample($img)
    {
        $w = imagesx($img);
        $h = imagesy($img);
        $dst = imagecreatetruecolor(self::SAMPLE_SIZE, self::SAMPLE_SIZE);
        imagecopyresampled($dst, $img, 0, 0, 0, 0, self::SAMPLE_SIZE, self::SAMPLE_SIZE, $w, $h);
        return $dst;
    }

    /**
     * Pick top-5 dominant colors via 16-step RGB cube binning, then evaluate
     * each against the brand palette.
     *
     * @param \GdImage $sample
     * @param list<array{r:int,g:int,b:int,hex:string}> $brandColors
     * @return list<array{hex:string, percentage:float, brand_match:bool, deltaE:float}>
     */
    private function dominantColors($sample, array $brandColors): array
    {
        $bins = [];
        $total = 0;
        for ($y = 0; $y < self::SAMPLE_SIZE; $y++) {
            for ($x = 0; $x < self::SAMPLE_SIZE; $x++) {
                $rgb = imagecolorat($sample, $x, $y);
                $r = ($rgb >> 16) & 0xFF;
                $g = ($rgb >> 8) & 0xFF;
                $b = $rgb & 0xFF;
                $key = sprintf('%d:%d:%d', intdiv($r, 16), intdiv($g, 16), intdiv($b, 16));
                if (!isset($bins[$key])) {
                    $bins[$key] = ['count' => 0, 'r' => 0, 'g' => 0, 'b' => 0];
                }
                $bins[$key]['count']++;
                $bins[$key]['r'] += $r;
                $bins[$key]['g'] += $g;
                $bins[$key]['b'] += $b;
                $total++;
            }
        }
        if ($total === 0) {
            return [];
        }
        uasort($bins, fn($a, $b) => $b['count'] <=> $a['count']);
        $top = array_slice($bins, 0, 5, true);
        $out = [];
        foreach ($top as $bin) {
            $r = (int) round($bin['r'] / max(1, $bin['count']));
            $g = (int) round($bin['g'] / max(1, $bin['count']));
            $b = (int) round($bin['b'] / max(1, $bin['count']));
            $hex = sprintf('#%02x%02x%02x', $r, $g, $b);
            [$bestDeltaE, $bestMatch] = $this->bestBrandMatch($r, $g, $b, $brandColors);
            $out[] = [
                'hex' => $hex,
                'percentage' => round(($bin['count'] / $total) * 100, 2),
                'brand_match' => $bestDeltaE <= self::DELTA_E_THRESHOLD,
                'deltaE' => round($bestDeltaE, 2),
                'closest_brand_hex' => $bestMatch,
            ];
        }
        return $out;
    }

    /**
     * Return [deltaE, closest_brand_hex] for the closest brand color.
     * If brand palette is empty, returns [INF, null] — every color flags.
     *
     * @param list<array{r:int,g:int,b:int,hex:string}> $brandColors
     */
    private function bestBrandMatch(int $r, int $g, int $b, array $brandColors): array
    {
        if (empty($brandColors)) {
            return [INF, null];
        }
        $best = INF;
        $bestHex = null;
        $lab1 = $this->rgbToLab($r, $g, $b);
        foreach ($brandColors as $bc) {
            $lab2 = $this->rgbToLab($bc['r'], $bc['g'], $bc['b']);
            $de = sqrt(
                ($lab1[0] - $lab2[0]) ** 2 +
                ($lab1[1] - $lab2[1]) ** 2 +
                ($lab1[2] - $lab2[2]) ** 2
            );
            if ($de < $best) {
                $best = $de;
                $bestHex = $bc['hex'];
            }
        }
        return [$best, $bestHex];
    }

    /**
     * CIE76 RGB → Lab via XYZ. Good-enough Delta-E for slop detection;
     * not radiometrically perfect.
     *
     * @return array{0:float,1:float,2:float}
     */
    private function rgbToLab(int $r, int $g, int $b): array
    {
        // sRGB → linear
        $rn = $r / 255.0; $gn = $g / 255.0; $bn = $b / 255.0;
        $rn = $rn > 0.04045 ? (($rn + 0.055) / 1.055) ** 2.4 : $rn / 12.92;
        $gn = $gn > 0.04045 ? (($gn + 0.055) / 1.055) ** 2.4 : $gn / 12.92;
        $bn = $bn > 0.04045 ? (($bn + 0.055) / 1.055) ** 2.4 : $bn / 12.92;
        // linear → XYZ (D65)
        $X = $rn * 0.4124564 + $gn * 0.3575761 + $bn * 0.1804375;
        $Y = $rn * 0.2126729 + $gn * 0.7151522 + $bn * 0.0721750;
        $Z = $rn * 0.0193339 + $gn * 0.1191920 + $bn * 0.9503041;
        // XYZ → Lab (D65 white)
        $Xn = 0.95047; $Yn = 1.0; $Zn = 1.08883;
        $fx = $this->labF($X / $Xn);
        $fy = $this->labF($Y / $Yn);
        $fz = $this->labF($Z / $Zn);
        $L = 116 * $fy - 16;
        $a = 500 * ($fx - $fy);
        $bL = 200 * ($fy - $fz);
        return [$L, $a, $bL];
    }

    private function labF(float $t): float
    {
        return $t > 0.008856 ? $t ** (1 / 3) : (7.787 * $t + 16 / 116);
    }

    /**
     * Lightweight heuristic for "text overlay" candidate detection: find large
     * rectangular regions with very low color variance. Not OCR; documented as
     * a placeholder for the v0.9 Tesseract integration.
     *
     * @param \GdImage $sample
     * @return list<array{x:int, y:int, width:int, height:int, area_pct:float, color:string}>
     */
    private function detectTextRegions($sample): array
    {
        // Tile the 50x50 sample into 10x10 cells (5x5 each). A cell is "flat"
        // if its color variance is below a threshold. Adjacent flat cells of
        // matching color form a candidate block.
        $cell = 5;
        $cols = (int) (self::SAMPLE_SIZE / $cell);
        $rows = (int) (self::SAMPLE_SIZE / $cell);
        $grid = []; // [row][col] = ['flat'=>bool, 'r','g','b']
        for ($cy = 0; $cy < $rows; $cy++) {
            for ($cx = 0; $cx < $cols; $cx++) {
                $sumR = $sumG = $sumB = 0; $sumR2 = $sumG2 = $sumB2 = 0;
                for ($y = 0; $y < $cell; $y++) {
                    for ($x = 0; $x < $cell; $x++) {
                        $rgb = imagecolorat($sample, $cx * $cell + $x, $cy * $cell + $y);
                        $r = ($rgb >> 16) & 0xFF;
                        $g = ($rgb >> 8) & 0xFF;
                        $b = $rgb & 0xFF;
                        $sumR += $r; $sumG += $g; $sumB += $b;
                        $sumR2 += $r * $r; $sumG2 += $g * $g; $sumB2 += $b * $b;
                    }
                }
                $n = $cell * $cell;
                $mr = $sumR / $n; $mg = $sumG / $n; $mb = $sumB / $n;
                $vr = ($sumR2 / $n) - $mr * $mr;
                $vg = ($sumG2 / $n) - $mg * $mg;
                $vb = ($sumB2 / $n) - $mb * $mb;
                $variance = $vr + $vg + $vb;
                $grid[$cy][$cx] = [
                    'flat' => $variance < 80, // empirical threshold; tune later
                    'r' => (int) $mr, 'g' => (int) $mg, 'b' => (int) $mb,
                ];
            }
        }

        // Connected-component scan: greedy rectangle growth from each unvisited flat cell.
        $visited = [];
        $blocks = [];
        for ($cy = 0; $cy < $rows; $cy++) {
            for ($cx = 0; $cx < $cols; $cx++) {
                if (isset($visited[$cy][$cx])) continue;
                if (!$grid[$cy][$cx]['flat']) continue;
                $seedColor = [$grid[$cy][$cx]['r'], $grid[$cy][$cx]['g'], $grid[$cy][$cx]['b']];
                // Grow right then down with a colour-similarity tolerance.
                $w = 1; $h = 1;
                while ($cx + $w < $cols && $grid[$cy][$cx + $w]['flat'] && $this->colorSim($grid[$cy][$cx + $w], $seedColor)) {
                    $w++;
                }
                $growMore = true;
                while ($growMore && $cy + $h < $rows) {
                    for ($i = 0; $i < $w; $i++) {
                        if (!$grid[$cy + $h][$cx + $i]['flat'] || !$this->colorSim($grid[$cy + $h][$cx + $i], $seedColor)) {
                            $growMore = false; break;
                        }
                    }
                    if ($growMore) $h++;
                }
                // Mark visited.
                for ($yy = 0; $yy < $h; $yy++) {
                    for ($xx = 0; $xx < $w; $xx++) {
                        $visited[$cy + $yy][$cx + $xx] = true;
                    }
                }
                $area = $w * $h;
                $areaPct = ($area / ($cols * $rows)) * 100;
                if ($areaPct >= self::TEXT_REGION_MIN_AREA_PCT) {
                    $blocks[] = [
                        'x' => $cx * $cell,
                        'y' => $cy * $cell,
                        'width' => $w * $cell,
                        'height' => $h * $cell,
                        'area_pct' => round($areaPct, 2),
                        'color' => sprintf('#%02x%02x%02x', $seedColor[0], $seedColor[1], $seedColor[2]),
                    ];
                }
            }
        }
        return $blocks;
    }

    /** @param array{r:int,g:int,b:int} $cell @param array{0:int,1:int,2:int} $seed */
    private function colorSim(array $cell, array $seed): bool
    {
        $dr = $cell['r'] - $seed[0]; $dg = $cell['g'] - $seed[1]; $db = $cell['b'] - $seed[2];
        return ($dr * $dr + $dg * $dg + $db * $db) < 30 * 30; // 30-unit euclidean radius
    }

    /**
     * Call the Python anatomy microservice, if configured. On error or absence,
     * return 'unchecked'. On non-200, log and return 'unchecked' (no silent
     * pass — caller observes requires_human_review = true).
     *
     * @param list<string> $reasons
     */
    private function callAnatomyService(string $imagePath, array $brandProfile, array &$reasons): string
    {
        $url = $this->anatomyServiceUrl();
        if ($url === '') {
            $reasons[] = 'anatomy_service_not_configured';
            return ImageValidationResult::ANATOMY_UNCHECKED;
        }

        $b64 = @base64_encode((string) @file_get_contents($imagePath));
        if ($b64 === '' || $b64 === false) {
            $reasons[] = 'anatomy_image_read_failed';
            return ImageValidationResult::ANATOMY_UNCHECKED;
        }

        $timeout = $this->anatomyServiceTimeout();
        $response = wp_remote_post(rtrim($url, '/') . '/anatomy', [
            'timeout' => $timeout,
            'headers' => ['Content-Type' => 'application/json'],
            'body' => wp_json_encode([
                'image_b64' => $b64,
                'brand_profile_id' => $brandProfile['id'] ?? null,
            ]),
        ]);

        if (is_wp_error($response)) {
            Logger::warn('anti_slop.anatomy_service_error', [
                'url' => $url, 'error' => $response->get_error_message(),
            ]);
            $reasons[] = 'anatomy_service_unreachable';
            return ImageValidationResult::ANATOMY_UNCHECKED;
        }

        $code = (int) wp_remote_retrieve_response_code($response);
        if ($code !== 200) {
            Logger::warn('anti_slop.anatomy_service_http', ['url' => $url, 'status' => $code]);
            $reasons[] = 'anatomy_service_status_' . $code;
            return ImageValidationResult::ANATOMY_UNCHECKED;
        }

        $bodyRaw = (string) wp_remote_retrieve_body($response);
        $body = json_decode($bodyRaw, true);
        if (!is_array($body) || !isset($body['verdict'])) {
            $reasons[] = 'anatomy_service_invalid_body';
            return ImageValidationResult::ANATOMY_UNCHECKED;
        }

        if ((string) $body['verdict'] === 'flagged') {
            return ImageValidationResult::ANATOMY_FLAGGED;
        }
        return ImageValidationResult::ANATOMY_CLEAN;
    }

    private function anatomyServiceUrl(): string
    {
        if (defined('JOIST_ANATOMY_SERVICE_URL')) {
            return (string) constant('JOIST_ANATOMY_SERVICE_URL');
        }
        return (string) get_option('joist_anatomy_service_url', '');
    }

    private function anatomyServiceTimeout(): int
    {
        $opt = (int) get_option('joist_anatomy_service_timeout', self::DEFAULT_ANATOMY_TIMEOUT_S);
        return $opt > 0 ? $opt : self::DEFAULT_ANATOMY_TIMEOUT_S;
    }
}
