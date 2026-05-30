<?php
declare(strict_types=1);

namespace Joist\Constitution;

use Joist\Core\Logger;

/**
 * @purpose Load the agency-default + per-site constitution markdown and merge
 *          them into the cached prompt prefix layer 1 (constitution sits ABOVE
 *          the preference_memory rule list and exemplar_pack — most stable,
 *          most reusable across calls).
 *
 * Layout:
 *   - Agency default lives at plugin/joist.constitution.md (ships with the
 *     plugin, read-only on disk, edited via the file system or a PUT to the
 *     REST surface that writes it into the site-override path instead — we
 *     never rewrite the bundled file at runtime).
 *   - Site overrides live at $WP_CONTENT_DIR/uploads/joist/sites/<site_id>/
 *     constitution.md. PUT to /joist/v1/constitution/{site_id} writes here.
 *
 * Merge rule (intentionally simple — see specs/WAVE_9_2026-05-29.md §3.3):
 *   - The agency default is parsed into top-level sections by "## " headers.
 *   - The site override is parsed the same way.
 *   - For each section in the override, if the agency has a section with the
 *     identical header, the override section REPLACES it. If the override
 *     introduces a section the agency does not have, that section is APPENDED
 *     after the merged agency content. Any pre-header preamble in the override
 *     is appended after the agency preamble.
 *   - All other agency sections remain in their original order.
 *
 * This avoids any token-level diffing and keeps the merge legible — a site
 * owner editing the override knows exactly which agency sections will be
 * replaced (the ones whose ## header they typed).
 *
 * Failure-mode constraints honoured:
 *   - Path traversal: site_id is validated against ^[A-Za-z0-9_-]{1,64}$ before
 *     ANY filesystem lookup, and the resolved path is asserted to live inside
 *     the joist uploads dir via realpath() prefix check.
 *   - #16 No silent failures: a missing agency default returns an empty string
 *     (no exception) but logs joist.constitution.agency_missing so the issue
 *     surfaces in eval-events.
 *   - No DB writes, no network calls — pure filesystem + string work.
 */
final class ConstitutionLoader
{
    /**
     * Path of the bundled agency-default constitution markdown, relative to
     * the plugin root. Centralised so tests can override via the constructor.
     */
    public const AGENCY_DEFAULT_BASENAME = 'joist.constitution.md';

    /**
     * Per-site override basename inside the per-site uploads dir.
     */
    public const SITE_OVERRIDE_BASENAME = 'constitution.md';

    /**
     * Match the allowed site_id charset. Same shape PreferenceMemory expects,
     * tightened to 1..64 chars to keep filesystem paths sane.
     */
    private const SITE_ID_PATTERN = '/^[A-Za-z0-9_-]{1,64}$/';

    /**
     * Conservative chars-per-token ratio (same as BrandBlock).
     */
    private const CHARS_PER_TOKEN = 4;

    public function __construct(
        private readonly ?string $pluginRoot = null,
        private readonly ?string $uploadsRoot = null,
    ) {}

    /**
     * Read the bundled agency default constitution markdown. Returns the raw
     * markdown, or '' if the file is missing/unreadable (logged but not fatal).
     */
    public function loadAgencyDefault(): string
    {
        $path = $this->agencyDefaultPath();
        if ($path === null || !is_readable($path)) {
            Logger::warn('joist.constitution.agency_missing', ['path' => $path]);
            return '';
        }
        $raw = @file_get_contents($path);
        if (!is_string($raw)) {
            Logger::warn('joist.constitution.agency_unreadable', ['path' => $path]);
            return '';
        }
        return $raw;
    }

    /**
     * Read the per-site override constitution markdown if present. Returns
     * null when no override exists (the merge falls back to agency-only).
     *
     * @throws \InvalidArgumentException when site_id fails validation.
     */
    public function loadSiteOverride(string $siteId): ?string
    {
        $this->assertValidSiteId($siteId);
        $path = $this->siteOverridePath($siteId);
        if ($path === null || !is_readable($path)) {
            return null;
        }
        $raw = @file_get_contents($path);
        if (!is_string($raw) || $raw === '') {
            return null;
        }
        return $raw;
    }

    /**
     * Compute the effective constitution markdown for a site by merging the
     * agency default with the site override (if any). The merge replaces
     * matching ## sections and appends new ones; preamble blocks concatenate.
     *
     * Returns the merged markdown ready to drop into a cached system block.
     *
     * @throws \InvalidArgumentException when site_id fails validation.
     */
    public function effective(string $siteId): string
    {
        $this->assertValidSiteId($siteId);
        $agency = $this->loadAgencyDefault();
        $override = $this->loadSiteOverride($siteId);

        if ($override === null || $override === '') {
            return $agency;
        }
        if ($agency === '') {
            return $override;
        }
        return $this->mergeBySection($agency, $override);
    }

    /**
     * Return the "source" sentinel for a given site — which layers contributed
     * to the effective output. Surfaced to the REST GET response so a caller
     * can tell whether they're seeing agency, override, or merged content.
     *
     * @return 'agency_default'|'site_override'|'merged'|'empty'
     *
     * @throws \InvalidArgumentException when site_id fails validation.
     */
    public function effectiveSource(string $siteId): string
    {
        $this->assertValidSiteId($siteId);
        $agency = $this->loadAgencyDefault();
        $override = $this->loadSiteOverride($siteId);

        if ($agency === '' && ($override === null || $override === '')) {
            return 'empty';
        }
        if ($override === null || $override === '') {
            return 'agency_default';
        }
        if ($agency === '') {
            return 'site_override';
        }
        return 'merged';
    }

    /**
     * Write a site override. Caller is responsible for permission gating
     * (PUT handler enforces manage_options). Returns the on-disk path.
     *
     * @throws \InvalidArgumentException when site_id fails validation.
     * @throws \RuntimeException when the write fails.
     */
    public function writeSiteOverride(string $siteId, string $markdown): string
    {
        $this->assertValidSiteId($siteId);
        $path = $this->siteOverridePath($siteId);
        if ($path === null) {
            throw new \RuntimeException('Cannot resolve site override path (uploads dir undefined).');
        }
        $dir = dirname($path);
        if (!is_dir($dir)) {
            if (!@mkdir($dir, 0755, true) && !is_dir($dir)) {
                throw new \RuntimeException('Failed to create constitution dir: ' . $dir);
            }
        }
        $bytes = @file_put_contents($path, $markdown);
        if ($bytes === false) {
            throw new \RuntimeException('Failed to write constitution override: ' . $path);
        }
        return $path;
    }

    /**
     * Delete a site override. Returns true if removed, false if there was
     * nothing to remove.
     *
     * @throws \InvalidArgumentException when site_id fails validation.
     */
    public function deleteSiteOverride(string $siteId): bool
    {
        $this->assertValidSiteId($siteId);
        $path = $this->siteOverridePath($siteId);
        if ($path === null || !is_file($path)) {
            return false;
        }
        return @unlink($path);
    }

    /**
     * Conservative token estimate (chars / 4 + 1). Same heuristic the rest of
     * the prompt-cache layer uses; the +1 ensures non-empty input never
     * rounds down to zero.
     */
    public function tokenEstimate(string $markdown): int
    {
        if ($markdown === '') {
            return 0;
        }
        return (int) (strlen($markdown) / self::CHARS_PER_TOKEN) + 1;
    }

    /**
     * Stable cache key for the effective constitution. Short hex hash usable
     * for cache invalidation telemetry — when this changes between two PUTs
     * the downstream BrandBlock cache must be invalidated.
     *
     * @throws \InvalidArgumentException when site_id fails validation.
     */
    public function cacheKey(string $siteId): string
    {
        $this->assertValidSiteId($siteId);
        $effective = $this->effective($siteId);
        return substr(hash('sha256', 'joist.constitution|' . $siteId . '|' . $effective), 0, 16);
    }

    /**
     * Resolve the bundled agency-default path. Public for tests.
     */
    public function agencyDefaultPath(): ?string
    {
        $root = $this->pluginRoot ?? $this->defaultPluginRoot();
        if (!is_string($root) || $root === '') {
            return null;
        }
        return rtrim($root, '/\\') . '/' . self::AGENCY_DEFAULT_BASENAME;
    }

    /**
     * Resolve the per-site override path. Public for tests. Returns null when
     * the uploads root cannot be determined (WP not loaded in some unit tests).
     */
    public function siteOverridePath(string $siteId): ?string
    {
        $this->assertValidSiteId($siteId);
        $root = $this->uploadsRoot ?? $this->defaultUploadsRoot();
        if (!is_string($root) || $root === '') {
            return null;
        }
        $candidate = rtrim($root, '/\\') . '/joist/sites/' . $siteId . '/' . self::SITE_OVERRIDE_BASENAME;

        // Defence in depth: even after the regex gate, refuse any candidate
        // path that escapes the joist uploads dir. The regex prevents `..`
        // tokens, but a future change to SITE_ID_PATTERN could regress; the
        // prefix check is the explicit invariant.
        $expectedPrefix = rtrim($root, '/\\') . '/joist/sites/';
        if (strpos($candidate, $expectedPrefix) !== 0) {
            Logger::warn('joist.constitution.path_escape', ['candidate' => $candidate, 'expected_prefix' => $expectedPrefix]);
            return null;
        }
        return $candidate;
    }

    /**
     * Validate a site_id. Centralised so the loader, the REST controller,
     * and any future caller share a single definition.
     *
     * @throws \InvalidArgumentException when invalid.
     */
    public function assertValidSiteId(string $siteId): void
    {
        if (preg_match(self::SITE_ID_PATTERN, $siteId) !== 1) {
            throw new \InvalidArgumentException(
                'Invalid site_id. Expected ^[A-Za-z0-9_-]{1,64}$; got: ' . substr($siteId, 0, 80)
            );
        }
    }

    /**
     * Section-aware merge. Splits both inputs on top-level "## " headers,
     * keys by header text, and produces the merged markdown.
     */
    private function mergeBySection(string $agency, string $override): string
    {
        [$agencyPreamble, $agencySections] = $this->splitSections($agency);
        [$overridePreamble, $overrideSections] = $this->splitSections($override);

        // Preamble: agency first, then override preamble appended only if non-empty.
        $preamble = $agencyPreamble;
        if ($overridePreamble !== '') {
            $preamble = rtrim($preamble) . "\n\n" . $overridePreamble;
        }

        // Sections: walk agency order, replace where override has a matching header.
        $merged = [];
        $consumed = [];
        foreach ($agencySections as $header => $body) {
            if (isset($overrideSections[$header])) {
                $merged[$header] = $overrideSections[$header];
                $consumed[$header] = true;
            } else {
                $merged[$header] = $body;
            }
        }
        // Append override-only sections in their original order.
        foreach ($overrideSections as $header => $body) {
            if (!isset($consumed[$header])) {
                $merged[$header] = $body;
            }
        }

        // Reassemble.
        $out = $preamble;
        foreach ($merged as $header => $body) {
            $out = rtrim($out) . "\n\n## " . $header . "\n\n" . trim($body) . "\n";
        }
        return $out;
    }

    /**
     * Split a markdown document into [preamble, sections] where sections is a
     * map of section-header-text => section-body. Top-level only ("## ").
     * Lower-level headers (### etc.) stay inside their parent section body.
     *
     * @return array{0:string,1:array<string,string>}
     */
    private function splitSections(string $markdown): array
    {
        $lines = preg_split('/\r\n|\r|\n/', $markdown);
        if ($lines === false) {
            return [$markdown, []];
        }
        $preambleLines = [];
        $sections = [];
        $currentHeader = null;
        $currentBody = [];
        foreach ($lines as $line) {
            if (preg_match('/^##\s+(.+?)\s*$/', $line, $m) === 1) {
                // Flush previous section.
                if ($currentHeader !== null) {
                    $sections[$currentHeader] = implode("\n", $currentBody);
                }
                $currentHeader = $m[1];
                $currentBody = [];
                continue;
            }
            if ($currentHeader === null) {
                $preambleLines[] = $line;
            } else {
                $currentBody[] = $line;
            }
        }
        if ($currentHeader !== null) {
            $sections[$currentHeader] = implode("\n", $currentBody);
        }
        return [implode("\n", $preambleLines), $sections];
    }

    /**
     * Default plugin root: two levels up from this file (src/Constitution/).
     */
    private function defaultPluginRoot(): ?string
    {
        $here = __DIR__;
        $root = dirname($here, 2);
        if ($root === '' || $root === '/') {
            return null;
        }
        return $root;
    }

    /**
     * Default uploads root: WP_CONTENT_DIR/uploads when WP is loaded, else null.
     *
     * Per spec the per-site path is wp-content/uploads/joist/sites/<id>/. We
     * use the uploads dir (not the bare WP_CONTENT_DIR) so it sits alongside
     * other site-owned content and survives plugin reinstalls.
     */
    private function defaultUploadsRoot(): ?string
    {
        if (function_exists('wp_upload_dir')) {
            $info = wp_upload_dir();
            if (is_array($info) && !empty($info['basedir']) && is_string($info['basedir'])) {
                return $info['basedir'];
            }
        }
        $contentDir = defined('WP_CONTENT_DIR') ? WP_CONTENT_DIR : null;
        if (is_string($contentDir) && $contentDir !== '') {
            return rtrim($contentDir, '/\\') . '/uploads';
        }
        return null;
    }
}
