<?php
declare(strict_types=1);

namespace Joist\Elementor;

/**
 * Constraint #23: autodetect a site's layout mode (containers_only /
 * sections_only / mixed) and refuse cross-mode inserts.
 *
 * Detection runs nightly via `joist_daily_maintenance` cron, caching the
 * result in `joist_layout_mode` option. Manual refresh via
 * `POST /elementor/refresh-layout-mode`.
 */
final class ContainerModeAdapter
{
    public const MODE_CONTAINERS_ONLY = 'containers_only';
    public const MODE_SECTIONS_ONLY = 'sections_only';
    public const MODE_MIXED = 'mixed';

    /**
     * @return array{mode:string, confidence:float, sample_size:int}
     */
    public function detect(int $sampleSize = 20): array
    {
        global $wpdb;
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT post_id, meta_value FROM {$wpdb->postmeta}
                 WHERE meta_key = '_elementor_data'
                 ORDER BY post_id DESC LIMIT %d",
                $sampleSize
            ),
            ARRAY_A
        );

        if (!$rows || count($rows) === 0) {
            return ['mode' => self::MODE_CONTAINERS_ONLY, 'confidence' => 0.5, 'sample_size' => 0];
        }

        $containerCount = 0;
        $sectionCount = 0;
        foreach ($rows as $row) {
            $data = json_decode($row['meta_value'], true);
            if (!is_array($data)) continue;
            foreach ($data as $rootEl) {
                if (!is_array($rootEl)) continue;
                $type = $rootEl['elType'] ?? '';
                if ($type === 'container') $containerCount++;
                elseif ($type === 'section') $sectionCount++;
            }
        }

        $total = $containerCount + $sectionCount;
        if ($total === 0) {
            return ['mode' => self::MODE_CONTAINERS_ONLY, 'confidence' => 0.5, 'sample_size' => 0];
        }

        if ($sectionCount === 0) {
            return ['mode' => self::MODE_CONTAINERS_ONLY, 'confidence' => 1.0, 'sample_size' => count($rows)];
        }
        if ($containerCount === 0) {
            return ['mode' => self::MODE_SECTIONS_ONLY, 'confidence' => 1.0, 'sample_size' => count($rows)];
        }

        $dominantRatio = max($containerCount, $sectionCount) / $total;
        return [
            'mode' => self::MODE_MIXED,
            'confidence' => round($dominantRatio, 2),
            'sample_size' => count($rows),
        ];
    }

    public function refresh(): array
    {
        $result = $this->detect();
        update_option('joist_layout_mode', array_merge($result, ['scanned_at' => time()]), false);
        return $result;
    }

    public function current(): array
    {
        $stored = get_option('joist_layout_mode', null);
        if (!is_array($stored)) {
            return $this->refresh();
        }
        // Auto-refresh if older than 24h.
        if ((int) ($stored['scanned_at'] ?? 0) < time() - 86400) {
            return $this->refresh();
        }
        return $stored;
    }

    /**
     * Constraint #23: refuse cross-mode inserts at root.
     *
     * Called from DocumentWriter::save() before the write proceeds.
     * @throws InvalidSettingsException
     */
    public function validateInserts(int $postId, array $elements, bool $force = false): void
    {
        if ($force) return;

        $siteMode = $this->current()['mode'];

        // Inspect the proposed root elements.
        $rootTypes = [];
        foreach ($elements as $el) {
            if (!is_array($el)) continue;
            $rootTypes[$el['elType'] ?? ''] = true;
        }

        if ($siteMode === self::MODE_CONTAINERS_ONLY && isset($rootTypes['section'])) {
            throw new InvalidSettingsException(
                'layout.cross_mode_refused',
                "This site uses containers exclusively. Inserting an `elType: section` would create a mixed-mode layout. "
                . "Use `elType: container` instead, or set force: true in the patch op AND obtain plan approval.",
                ['site_mode' => $siteMode]
            );
        }

        if ($siteMode === self::MODE_SECTIONS_ONLY && isset($rootTypes['container'])) {
            throw new InvalidSettingsException(
                'layout.cross_mode_refused',
                "This site uses the legacy section/column hierarchy exclusively. Inserting an `elType: container` "
                . "as a root sibling would create misaligned layout. Use POST /pages/legacy-builder/section-with-column "
                . "to wrap content for legacy sites, or set force: true in the patch op AND obtain plan approval.",
                ['site_mode' => $siteMode]
            );
        }
    }
}
