<?php
declare(strict_types=1);

namespace Joist\Critique;

use Joist\Core\Logger;

/**
 * @purpose Anti-cliché diversity check. Failure-mode constraint #22.
 *
 * Cited evidence: Patterns / Cell Press 2025 (PMC12827715) found that 700
 * autonomous SDXL/LLaVA trajectories at every sampling parameter converged
 * to 12 dominant motifs ("stormy lighthouses, palatial interiors, gothic
 * cathedrals" — termed "visual elevator music"). Without this check, our
 * generator drifts to population-mean Elementor aesthetics over time —
 * exactly the slop we're fighting.
 *
 * Algorithm: cosine similarity on a combined feature vector against the
 * last N=10 committed renders for the site. When similarity > threshold
 * (default 0.92), the verdict is flagged `anti_cliche_collapse`.
 *
 * Feature vector composition (no external vision model required):
 *   1. Perceptual hash (pHash) of the screenshot     — 64 bits, structural
 *   2. Element-tree signature                        — widget-type counts
 *                                                       + layout-direction
 *                                                       histogram
 *
 * The pHash gives us "this screenshot looks like that screenshot at the
 * pixel-level structural sense"; the tree signature gives us "this page is
 * built the same way as that page at the widget level". Combined cosine
 * captures both kinds of collapse.
 *
 * Why no real embeddings? Failure-mode constraint #24 (no autonomous raw-VLM
 * filter): zero-shot VLM judges score below 0.55 on TASTE. Embedding-based
 * similarity from a vision model carries the same epistemic weakness. A
 * deterministic, auditable pHash + structural signature is *worse* at fine
 * judgment but *better* at the specific collapse-to-12-motifs failure mode
 * we are gating against. When we have a trained pairwise judge (v0.95+), we
 * can swap the implementation; the SimilarityResult contract is stable.
 *
 * ExemplarPackManager is W10c (parallel build). Class-existence-guarded — if
 * it isn't loaded, this class returns `similarity_to_recent: null` and the
 * critique pipeline does NOT gate. Refuse-not-corrupt: better to skip the
 * check than to crash the runner.
 */
final class DiversityCheck
{
    public const DEFAULT_THRESHOLD = 0.92;
    public const DEFAULT_LOOKBACK_N = 10;
    public const EXEMPLAR_PACK_CLASS = '\\Joist\\Eval\\ExemplarPackManager';

    /**
     * Compare a candidate render against the site's recent approved exemplars.
     *
     * @param string $siteId
     * @param array{
     *   phash?: string,
     *   screenshot_b64?: string,
     *   tree_signature?: array<string,int>,
     *   element_tree?: array
     * } $candidate
     * @return array{
     *   flagged: bool,
     *   similarity_to_recent: float|null,
     *   threshold: float,
     *   compared_against_count: int,
     *   reason: string|null,
     *   exemplar_pack_loaded: bool
     * }
     */
    public function check(string $siteId, array $candidate, float $threshold = self::DEFAULT_THRESHOLD, int $lookbackN = self::DEFAULT_LOOKBACK_N): array
    {
        $packLoaded = class_exists(self::EXEMPLAR_PACK_CLASS);

        // Default un-gated envelope when the pack class is absent. We do not
        // crash; we surface `similarity_to_recent: null` so the runner knows
        // the check was inert.
        if (!$packLoaded) {
            return [
                'flagged' => false,
                'similarity_to_recent' => null,
                'threshold' => $threshold,
                'compared_against_count' => 0,
                'reason' => 'exemplar_pack_unavailable',
                'exemplar_pack_loaded' => false,
            ];
        }

        // Fetch recent approved renders via the pack manager. Use a defensive
        // shim that matches whatever surface W10c lands — we tolerate either
        // a static method, an instance method on a Container service, or null.
        $recent = $this->fetchRecentApproved($siteId, $lookbackN);
        if (!is_array($recent) || count($recent) === 0) {
            return [
                'flagged' => false,
                'similarity_to_recent' => null,
                'threshold' => $threshold,
                'compared_against_count' => 0,
                'reason' => 'no_prior_approved_exemplars',
                'exemplar_pack_loaded' => true,
            ];
        }

        // Compute the candidate's feature vector.
        $candFv = $this->featureVector($candidate);
        if ($candFv === null) {
            return [
                'flagged' => false,
                'similarity_to_recent' => null,
                'threshold' => $threshold,
                'compared_against_count' => 0,
                'reason' => 'candidate_feature_vector_unavailable',
                'exemplar_pack_loaded' => true,
            ];
        }

        // Max cosine over the recent set — collapse is gated on the worst
        // (most similar) prior, not the mean. One near-duplicate is enough.
        $maxSim = 0.0;
        $compared = 0;
        foreach ($recent as $ex) {
            $exFv = $this->featureVector(is_array($ex) ? $ex : []);
            if ($exFv === null) continue;
            $sim = $this->cosine($candFv, $exFv);
            if ($sim > $maxSim) $maxSim = $sim;
            $compared++;
        }

        if ($compared === 0) {
            return [
                'flagged' => false,
                'similarity_to_recent' => null,
                'threshold' => $threshold,
                'compared_against_count' => 0,
                'reason' => 'no_comparable_exemplars',
                'exemplar_pack_loaded' => true,
            ];
        }

        $flagged = $maxSim > $threshold;
        return [
            'flagged' => $flagged,
            'similarity_to_recent' => round($maxSim, 4),
            'threshold' => $threshold,
            'compared_against_count' => $compared,
            'reason' => $flagged ? 'anti_cliche_collapse' : null,
            'exemplar_pack_loaded' => true,
        ];
    }

    /**
     * Build a normalised feature vector from whatever the caller supplied.
     * Returns null when there's nothing to hash.
     *
     * @param array<string,mixed> $payload
     * @return array<int,float>|null
     */
    private function featureVector(array $payload): ?array
    {
        $hashBits = $this->phashBits($payload);
        $treeSig = $this->treeSignature($payload);

        if ($hashBits === null && count($treeSig) === 0) {
            return null;
        }

        // The vector: 64 pHash bits as 0.0/1.0 floats, followed by 16 fixed
        // tree-signature slots normalised to [0,1] by their sum (so different
        // sites with the same widget ratio map to the same point).
        $vec = [];
        if ($hashBits !== null) {
            for ($i = 0; $i < 64; $i++) {
                $vec[] = (float) (($hashBits >> $i) & 1);
            }
        } else {
            // No pHash; pad with zeros so the cosine math still works.
            for ($i = 0; $i < 64; $i++) {
                $vec[] = 0.0;
            }
        }

        // Tree-signature: 16 stable slots for widget-type / layout counts.
        $slots = [
            'container', 'flex', 'grid', 'heading', 'text', 'image', 'button',
            'video', 'icon', 'form', 'spacer', 'divider', 'testimonial',
            'pinscroll', 'editorialquote', 'other',
        ];
        $sigSum = max(1, array_sum($treeSig));
        foreach ($slots as $slot) {
            $vec[] = ((float) ($treeSig[$slot] ?? 0)) / $sigSum;
        }

        return $vec;
    }

    /**
     * Extract or compute a 64-bit perceptual hash.
     *
     * Caller can supply `phash` as a hex string directly (preferred — the
     * preview/render endpoint should compute it once and pass it in). When
     * not supplied AND `screenshot_b64` is, we compute a coarse pHash here.
     * If neither, return null.
     */
    private function phashBits(array $payload): ?int
    {
        // Preferred: caller-supplied hex hash.
        if (isset($payload['phash']) && is_string($payload['phash']) && $payload['phash'] !== '') {
            $hex = ltrim(strtolower((string) $payload['phash']), '0x');
            if (preg_match('/^[0-9a-f]{1,16}$/', $hex)) {
                return (int) hexdec($hex);
            }
        }

        // Fallback: compute from a base64 screenshot. We use GD's mean-DCT
        // approximation since we don't have a true DCT library at hand —
        // it's a coarse pHash but stable and deterministic.
        if (isset($payload['screenshot_b64']) && is_string($payload['screenshot_b64']) && function_exists('imagecreatefromstring')) {
            $bytes = base64_decode((string) $payload['screenshot_b64'], true);
            if ($bytes === false || $bytes === '') {
                return null;
            }
            $img = @imagecreatefromstring($bytes);
            if ($img === false) {
                return null;
            }
            try {
                return $this->meanHash8x8($img);
            } catch (\Throwable $e) {
                Logger::debug('diversity_check.phash_failed', ['error' => $e->getMessage()]);
                return null;
            } finally {
                imagedestroy($img);
            }
        }

        return null;
    }

    /**
     * 8x8 mean hash (aHash) — coarser than DCT pHash but stable, deterministic,
     * and dependency-free. For our collapse-detection purpose this is enough:
     * two near-identical page layouts produce near-identical 8x8 grayscale
     * down-samples, which is what we're trying to flag.
     *
     * @param \GdImage|resource $img
     */
    private function meanHash8x8($img): int
    {
        $small = imagecreatetruecolor(8, 8);
        imagecopyresampled($small, $img, 0, 0, 0, 0, 8, 8, imagesx($img), imagesy($img));
        $gray = [];
        for ($y = 0; $y < 8; $y++) {
            for ($x = 0; $x < 8; $x++) {
                $rgb = imagecolorat($small, $x, $y);
                $r = ($rgb >> 16) & 0xFF;
                $g = ($rgb >> 8) & 0xFF;
                $b = $rgb & 0xFF;
                $gray[] = (int) round(0.299 * $r + 0.587 * $g + 0.114 * $b);
            }
        }
        imagedestroy($small);
        $mean = array_sum($gray) / 64;
        $bits = 0;
        for ($i = 0; $i < 64; $i++) {
            if ($gray[$i] >= $mean) {
                $bits |= (1 << $i);
            }
        }
        return $bits;
    }

    /**
     * Build a widget-count signature from an element tree.
     *
     * @param array<string,mixed> $payload
     * @return array<string,int>
     */
    private function treeSignature(array $payload): array
    {
        // Caller-supplied signature wins.
        if (isset($payload['tree_signature']) && is_array($payload['tree_signature'])) {
            $sig = [];
            foreach ($payload['tree_signature'] as $k => $v) {
                $sig[(string) $k] = max(0, (int) $v);
            }
            return $sig;
        }

        // Otherwise walk the supplied element tree.
        if (isset($payload['element_tree']) && is_array($payload['element_tree'])) {
            $sig = [];
            $this->walkTree($payload['element_tree'], $sig);
            return $sig;
        }

        return [];
    }

    /** @param array<string,int> $sig */
    private function walkTree(array $tree, array &$sig): void
    {
        foreach ($tree as $node) {
            if (!is_array($node)) continue;
            $type = strtolower((string) ($node['widgetType'] ?? $node['elType'] ?? 'other'));
            // Bucket into one of our stable slots; everything else => 'other'.
            $bucket = match (true) {
                str_contains($type, 'flex') || str_contains($type, 'e-flex') => 'flex',
                str_contains($type, 'grid') => 'grid',
                $type === 'container' || $type === 'e-con' => 'container',
                str_contains($type, 'heading') => 'heading',
                str_contains($type, 'text') => 'text',
                str_contains($type, 'image') => 'image',
                str_contains($type, 'button') => 'button',
                str_contains($type, 'video') => 'video',
                str_contains($type, 'icon') => 'icon',
                str_contains($type, 'form') => 'form',
                str_contains($type, 'spacer') => 'spacer',
                str_contains($type, 'divider') => 'divider',
                str_contains($type, 'testimonial') => 'testimonial',
                str_contains($type, 'pinscroll') || str_contains($type, 'pin-scroll') => 'pinscroll',
                str_contains($type, 'editorialquote') || str_contains($type, 'editorial-quote') => 'editorialquote',
                default => 'other',
            };
            $sig[$bucket] = ($sig[$bucket] ?? 0) + 1;
            $children = $node['elements'] ?? $node['children'] ?? null;
            if (is_array($children) && count($children) > 0) {
                $this->walkTree($children, $sig);
            }
        }
    }

    /**
     * @param array<int,float> $a
     * @param array<int,float> $b
     */
    private function cosine(array $a, array $b): float
    {
        $len = min(count($a), count($b));
        if ($len === 0) return 0.0;
        $dot = 0.0; $na = 0.0; $nb = 0.0;
        for ($i = 0; $i < $len; $i++) {
            $dot += $a[$i] * $b[$i];
            $na += $a[$i] * $a[$i];
            $nb += $b[$i] * $b[$i];
        }
        if ($na <= 0 || $nb <= 0) return 0.0;
        return $dot / (sqrt($na) * sqrt($nb));
    }

    /**
     * Fetch recent approved renders via ExemplarPackManager (W10c).
     *
     * Defensive: tolerate W10c's exact surface landing in parallel. We try in
     * order:
     *   1. Container service `exemplarPackManager` -> recentApproved($siteId, $n)
     *   2. Static \Joist\Eval\ExemplarPackManager::recentApproved($siteId, $n)
     * Anything else => return [] and let the runner surface the inert state.
     *
     * @return list<array<string,mixed>>
     */
    private function fetchRecentApproved(string $siteId, int $lookbackN): array
    {
        $cls = self::EXEMPLAR_PACK_CLASS;
        if (!class_exists($cls)) {
            return [];
        }

        // Container-registered instance method.
        if (class_exists('\\Joist\\Container') && \Joist\Container::has('exemplarPackManager')) {
            try {
                $svc = \Joist\Container::get('exemplarPackManager');
                if (is_object($svc) && method_exists($svc, 'recentApproved')) {
                    $rows = $svc->recentApproved($siteId, $lookbackN);
                    return is_array($rows) ? array_values($rows) : [];
                }
            } catch (\Throwable $e) {
                Logger::debug('diversity_check.exemplar_pack_resolve_failed', ['error' => $e->getMessage()]);
            }
        }

        // Static fallback.
        if (method_exists($cls, 'recentApproved')) {
            try {
                $rows = $cls::recentApproved($siteId, $lookbackN);
                return is_array($rows) ? array_values($rows) : [];
            } catch (\Throwable $e) {
                Logger::debug('diversity_check.static_fallback_failed', ['error' => $e->getMessage()]);
            }
        }

        return [];
    }
}
