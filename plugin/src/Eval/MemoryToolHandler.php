<?php
declare(strict_types=1);

namespace Joist\Eval;

use Joist\Elementor\WriteException;

/**
 * @purpose Translate between Anthropic's memory_20250818 tool command surface
 *          and Joist's existing PreferenceMemory + Rule semantics.
 *
 * Background: as of 2026-05-28 (Wave 2a) we adopt the memory_20250818 tool as
 * the public transport for preference memory. Anthropic provides the command
 * vocabulary (view / create / str_replace / insert / delete / rename) but does
 * NOT provide per-site namespacing, dedup, confidence scoring, compaction, or
 * the 40-rule/800-token renderForPrompt cap — those stay in PreferenceMemory.
 *
 * Multi-tenancy: the memory_20250818 tool is single-tenant. Joist hosts many
 * sites, so we expose tenancy via a /memories/site/<site_id>/... path prefix.
 * The handler resolves <site_id> from the path, then asserts it matches the
 * authenticated site via PreferenceMemory::siteId(). Cross-site reads/writes
 * fail with permission.cross_site_denied (failure-mode constraint: site_id is
 * a hard partition key).
 *
 * Virtual filesystem:
 *   /memories                                       (root, view-only)
 *   /memories/site/<site_id>                        (dir; view shows kinds)
 *   /memories/site/<site_id>/render.md              (file; rendered prompt block)
 *   /memories/site/<site_id>/rules/<kind>           (dir; view lists rule ids)
 *   /memories/site/<site_id>/rules/<kind>/<rule_id> (file; one rule body)
 *
 * Rule file format (text/markdown-ish, deliberately human-readable so the
 * memory tool can roundtrip via str_replace / insert):
 *
 *   id: pref_abc123
 *   kind: forbidden_phrase
 *   scope: global
 *   confidence: 0.80
 *   status: active
 *   pattern: synergy
 *   directive: avoid corporate jargon like "synergy"
 *
 * `create` parses this and routes to PreferenceMemory::add() (which dedups by
 * site+kind+pattern). `str_replace` reads the file, mutates the body, writes
 * the result back through PreferenceMemory::update(). Unknown fields return
 * 422 (constraint #1: no silent passthrough).
 */
final class MemoryToolHandler
{
    /** Path prefix the memory tool is rooted at. */
    public const ROOT = '/memories';

    /** Subpath segment for site-scoped storage. */
    public const SITE_SEGMENT = 'site';

    /** Subpath segment for rule files. */
    public const RULES_SEGMENT = 'rules';

    /** Synthesised file: read-only renderForPrompt output. */
    public const RENDER_FILE = 'render.md';

    /** Whitelist of editable fields in a rule body (constraint #1). */
    private const EDITABLE_FIELDS = [
        'kind', 'scope', 'pattern', 'directive', 'confidence', 'status',
    ];

    public function __construct(private PreferenceMemory $memory) {}

    // ──────────────────────────────────────────────────────────────────────
    // Public command surface — one method per memory_20250818 command.
    // Each method returns an array shaped like the tool's success response.
    // Errors throw WriteException with mapped error codes.
    // ──────────────────────────────────────────────────────────────────────

    /**
     * view: list a directory or read a file.
     *
     * Spec:
     *   - path is required; must start with /memories.
     *   - On a directory path: return {type: "directory", entries: [...]}.
     *   - On a file path: return {type: "file", content: "..."}.
     *
     * @param array{path:string, view_range?:array<int,int>} $args
     * @return array<string,mixed>
     */
    public function view(array $args): array
    {
        $path = $this->requirePath($args, 'path');
        $parts = $this->parsePath($path);

        // /memories — list site directories the caller can see (just current site).
        if ($parts['mode'] === 'root') {
            return [
                'type' => 'directory',
                'path' => self::ROOT,
                'entries' => [
                    self::SITE_SEGMENT . '/' . $this->memory->siteId() . '/',
                ],
            ];
        }

        // /memories/site/<site_id> — listing for this site.
        if ($parts['mode'] === 'site') {
            $this->assertSameSite($parts['site_id']);
            $kinds = array_values(array_unique(array_map(
                fn (Rule $r) => $r->kind,
                $this->memory->listActive($parts['site_id'])
            )));
            $entries = [self::RENDER_FILE];
            foreach ($kinds as $k) {
                $entries[] = self::RULES_SEGMENT . '/' . $k . '/';
            }
            return [
                'type' => 'directory',
                'path' => $path,
                'entries' => $entries,
            ];
        }

        // /memories/site/<site_id>/render.md
        if ($parts['mode'] === 'render') {
            $this->assertSameSite($parts['site_id']);
            $content = $this->memory->renderForPrompt($parts['site_id']);
            return [
                'type' => 'file',
                'path' => $path,
                'content' => $this->applyViewRange($content, $args['view_range'] ?? null),
            ];
        }

        // /memories/site/<site_id>/rules/<kind>
        if ($parts['mode'] === 'kind_dir') {
            $this->assertSameSite($parts['site_id']);
            Rule::assertValidKind($parts['kind']);
            $rules = array_filter(
                $this->memory->listActive($parts['site_id']),
                fn (Rule $r) => $r->kind === $parts['kind']
            );
            return [
                'type' => 'directory',
                'path' => $path,
                'entries' => array_values(array_map(fn (Rule $r) => $r->id, $rules)),
            ];
        }

        // /memories/site/<site_id>/rules/<kind>/<rule_id>
        if ($parts['mode'] === 'rule_file') {
            $this->assertSameSite($parts['site_id']);
            $rule = $this->loadRuleAt($parts['site_id'], $parts['kind'], $parts['rule_id']);
            return [
                'type' => 'file',
                'path' => $path,
                'content' => $this->applyViewRange(self::serializeRule($rule), $args['view_range'] ?? null),
            ];
        }

        throw new WriteException('memory.unknown_path', "Path not recognised: {$path}", 404);
    }

    /**
     * create: create a new file (or overwrite an existing one).
     *
     * Routes to PreferenceMemory::add(), which dedups by (site_id, kind, pattern).
     * A duplicate `create` therefore bumps confidence + replaces the directive,
     * exactly as the existing semantics — but the response surfaces dedup=true
     * so callers can distinguish.
     *
     * @param array{path:string, file_text:string} $args
     * @return array<string,mixed>
     */
    public function create(array $args): array
    {
        $path = $this->requirePath($args, 'path');
        $fileText = (string) ($args['file_text'] ?? '');
        $parts = $this->parsePath($path);

        if ($parts['mode'] !== 'rule_file') {
            throw new WriteException(
                'memory.invalid_create_path',
                'create only supported on /memories/site/<site_id>/rules/<kind>/<rule_id> paths.',
                422
            );
        }
        $this->assertSameSite($parts['site_id']);
        Rule::assertValidKind($parts['kind']);

        $fields = $this->parseRuleBody($fileText);
        // The body may pin a different kind than the path — path wins, but
        // we surface 422 on mismatch (constraint #1: no silent passthrough).
        if (isset($fields['kind']) && $fields['kind'] !== $parts['kind']) {
            throw new WriteException(
                'memory.kind_path_mismatch',
                "Body kind '{$fields['kind']}' does not match path kind '{$parts['kind']}'.",
                422,
                ['expected_kind' => $parts['kind'], 'received_kind' => $fields['kind']]
            );
        }
        if (!isset($fields['pattern']) || $fields['pattern'] === '') {
            throw new WriteException('memory.missing_field', "Field 'pattern' is required.", 422);
        }
        if (!isset($fields['directive']) || $fields['directive'] === '') {
            throw new WriteException('memory.missing_field', "Field 'directive' is required.", 422);
        }

        $rule = Rule::create(
            siteId: $parts['site_id'],
            kind: $parts['kind'],
            pattern: $fields['pattern'],
            directive: $fields['directive'],
            provenance: ['source' => 'memory_tool', 'tool_path' => $path],
            scope: $fields['scope'] ?? 'global',
            confidence: isset($fields['confidence']) ? (float) $fields['confidence'] : 1.0,
            status: $fields['status'] ?? Rule::STATUS_ACTIVE,
        );

        // Detect dedup by looking up before/after — if add returns a rule with
        // a different id than the one we just minted, it merged with an existing.
        $stored = $this->memory->add($rule);
        $dedup = $stored->id !== $rule->id;

        return [
            'type' => 'file',
            'path' => $this->rulePath($stored),
            'content' => self::serializeRule($stored),
            'dedup' => $dedup,
            'rule_id' => $stored->id,
        ];
    }

    /**
     * str_replace: replace the first occurrence of old_str with new_str.
     *
     * Operates on the editable fields of a rule's serialised body. We avoid
     * implementing free-text substring replace because Rule fields are typed —
     * a user editing a 'kind' line would otherwise smuggle invalid kinds in.
     * Instead, str_replace is parsed as field-level: it must hit exactly one
     * "field: value" line, and the new text must respect the same field format.
     *
     * @param array{path:string, old_str:string, new_str:string} $args
     * @return array<string,mixed>
     */
    public function strReplace(array $args): array
    {
        $path = $this->requirePath($args, 'path');
        $oldStr = (string) ($args['old_str'] ?? '');
        $newStr = (string) ($args['new_str'] ?? '');
        if ($oldStr === '') {
            throw new WriteException('memory.invalid_arg', "old_str must not be empty.", 422);
        }

        $parts = $this->parsePath($path);
        if ($parts['mode'] !== 'rule_file') {
            throw new WriteException(
                'memory.invalid_str_replace_path',
                'str_replace only supported on rule file paths.',
                422
            );
        }
        $this->assertSameSite($parts['site_id']);
        $rule = $this->loadRuleAt($parts['site_id'], $parts['kind'], $parts['rule_id']);

        $body = self::serializeRule($rule);
        $occurrences = substr_count($body, $oldStr);
        if ($occurrences === 0) {
            throw new WriteException('memory.str_not_found', "old_str not found in file.", 404);
        }
        if ($occurrences > 1) {
            throw new WriteException(
                'memory.str_ambiguous',
                "old_str appears {$occurrences} times; provide more context to disambiguate.",
                422
            );
        }

        $newBody = (string) preg_replace('/' . preg_quote($oldStr, '/') . '/', $newStr, $body, 1);
        $newFields = $this->parseRuleBody($newBody);
        $this->applyEdits($rule, $newFields, $path);
        $this->memory->update($rule);

        return [
            'type' => 'file',
            'path' => $this->rulePath($rule),
            'content' => self::serializeRule($rule),
        ];
    }

    /**
     * insert: insert text at the given line number (1-indexed; 0 = prepend).
     *
     * Appended/inserted text must still parse as a valid field assignment.
     * Inserts that introduce non-whitelisted field names → 422.
     *
     * @param array{path:string, insert_line:int, insert_text:string} $args
     * @return array<string,mixed>
     */
    public function insert(array $args): array
    {
        $path = $this->requirePath($args, 'path');
        $insertLine = (int) ($args['insert_line'] ?? -1);
        $insertText = (string) ($args['insert_text'] ?? '');
        if ($insertLine < 0) {
            throw new WriteException('memory.invalid_arg', "insert_line must be >= 0.", 422);
        }

        $parts = $this->parsePath($path);
        if ($parts['mode'] !== 'rule_file') {
            throw new WriteException(
                'memory.invalid_insert_path',
                'insert only supported on rule file paths.',
                422
            );
        }
        $this->assertSameSite($parts['site_id']);
        $rule = $this->loadRuleAt($parts['site_id'], $parts['kind'], $parts['rule_id']);

        $lines = explode("\n", self::serializeRule($rule));
        if ($insertLine > count($lines)) {
            throw new WriteException(
                'memory.line_out_of_range',
                "insert_line {$insertLine} exceeds file length " . count($lines) . '.',
                422
            );
        }
        array_splice($lines, $insertLine, 0, [$insertText]);
        $newBody = implode("\n", $lines);

        $newFields = $this->parseRuleBody($newBody);
        $this->applyEdits($rule, $newFields, $path);
        $this->memory->update($rule);

        return [
            'type' => 'file',
            'path' => $this->rulePath($rule),
            'content' => self::serializeRule($rule),
        ];
    }

    /**
     * delete: remove a file (archive a rule).
     *
     * Maps to PreferenceMemory::archive() — soft delete. Matches the existing
     * DELETE /joist/v1/preferences/{id} semantics. Directories cannot be
     * deleted; that would risk wiping all rules of a kind in one call (#16).
     *
     * @param array{path:string} $args
     * @return array<string,mixed>
     */
    public function delete(array $args): array
    {
        $path = $this->requirePath($args, 'path');
        $parts = $this->parsePath($path);
        if ($parts['mode'] !== 'rule_file') {
            throw new WriteException(
                'memory.delete_directory_refused',
                'delete only supported on rule file paths. Directory delete refused to prevent accidental bulk archive.',
                422
            );
        }
        $this->assertSameSite($parts['site_id']);
        $rule = $this->loadRuleAt($parts['site_id'], $parts['kind'], $parts['rule_id']);
        $this->memory->archive($rule->id);

        return [
            'deleted' => true,
            'path' => $path,
            'rule_id' => $rule->id,
        ];
    }

    /**
     * rename: move a file from old_path to new_path.
     *
     * For rule files, the only meaningful rename is changing the kind segment
     * (which reclassifies the rule) — the rule_id segment is immutable. If the
     * new path collides with an existing rule on (site, kind, pattern), the
     * existing dedup logic in PreferenceMemory::add() would merge them; we
     * surface that explicitly here so callers see the collision.
     *
     * @param array{old_path:string, new_path:string} $args
     * @return array<string,mixed>
     */
    public function rename(array $args): array
    {
        $oldPath = $this->requirePath($args, 'old_path');
        $newPath = $this->requirePath($args, 'new_path');

        $oldParts = $this->parsePath($oldPath);
        $newParts = $this->parsePath($newPath);
        if ($oldParts['mode'] !== 'rule_file' || $newParts['mode'] !== 'rule_file') {
            throw new WriteException(
                'memory.invalid_rename_path',
                'rename only supported between rule file paths.',
                422
            );
        }
        $this->assertSameSite($oldParts['site_id']);
        $this->assertSameSite($newParts['site_id']);
        if ($oldParts['site_id'] !== $newParts['site_id']) {
            throw new WriteException(
                'memory.cross_site_rename_refused',
                'Cannot rename a rule between sites.',
                422
            );
        }
        if ($oldParts['rule_id'] !== $newParts['rule_id']) {
            throw new WriteException(
                'memory.rule_id_immutable',
                'rule_id segment is immutable; renames may only change kind.',
                422
            );
        }
        Rule::assertValidKind($newParts['kind']);

        $rule = $this->loadRuleAt($oldParts['site_id'], $oldParts['kind'], $oldParts['rule_id']);

        // Collision check: would the new (site, kind, pattern) clash with an existing rule?
        $existing = array_filter(
            $this->memory->listActive($newParts['site_id']),
            fn (Rule $r) => $r->kind === $newParts['kind']
                && $r->pattern === $rule->pattern
                && $r->id !== $rule->id
        );
        if (count($existing) > 0) {
            throw new WriteException(
                'memory.path_collision',
                "Rename would collide with existing rule on (site, kind, pattern).",
                409,
                ['existing_rule_id' => array_values($existing)[0]->id]
            );
        }

        $rule->kind = $newParts['kind'];
        $this->memory->update($rule);

        return [
            'renamed' => true,
            'old_path' => $oldPath,
            'new_path' => $this->rulePath($rule),
        ];
    }

    // ──────────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @param array<string,mixed> $args
     */
    private function requirePath(array $args, string $key): string
    {
        $val = $args[$key] ?? null;
        if (!is_string($val) || $val === '') {
            throw new WriteException('memory.missing_arg', "Argument '{$key}' is required.", 422);
        }
        if (!str_starts_with($val, self::ROOT)) {
            throw new WriteException(
                'memory.invalid_root',
                "Path must start with " . self::ROOT . '.',
                422,
                ['received' => $val]
            );
        }
        // No path traversal.
        if (str_contains($val, '..')) {
            throw new WriteException('memory.path_traversal', 'Path may not contain "..".', 422);
        }
        return $val;
    }

    /**
     * Parse a memory path into structured parts.
     *
     * @return array{mode:string, site_id?:string, kind?:string, rule_id?:string}
     */
    private function parsePath(string $path): array
    {
        $trim = rtrim($path, '/');
        if ($trim === self::ROOT) {
            return ['mode' => 'root'];
        }
        $rest = substr($trim, strlen(self::ROOT) + 1); // strip "/memories/"
        $segs = explode('/', $rest);

        // /memories/site/<site_id>
        if (count($segs) >= 2 && $segs[0] === self::SITE_SEGMENT) {
            $siteId = $segs[1];
            if ($siteId === '') {
                throw new WriteException('memory.invalid_path', 'site_id segment empty.', 422);
            }
            if (count($segs) === 2) {
                return ['mode' => 'site', 'site_id' => $siteId];
            }
            // /memories/site/<site_id>/render.md
            if (count($segs) === 3 && $segs[2] === self::RENDER_FILE) {
                return ['mode' => 'render', 'site_id' => $siteId];
            }
            // /memories/site/<site_id>/rules/<kind>
            if (count($segs) === 4 && $segs[2] === self::RULES_SEGMENT) {
                return [
                    'mode' => 'kind_dir',
                    'site_id' => $siteId,
                    'kind' => $segs[3],
                ];
            }
            // /memories/site/<site_id>/rules/<kind>/<rule_id>
            if (count($segs) === 5 && $segs[2] === self::RULES_SEGMENT) {
                return [
                    'mode' => 'rule_file',
                    'site_id' => $siteId,
                    'kind' => $segs[3],
                    'rule_id' => $segs[4],
                ];
            }
        }
        throw new WriteException('memory.unknown_path', "Path not recognised: {$path}", 404);
    }

    private function assertSameSite(string $pathSiteId): void
    {
        $current = $this->memory->siteId();
        if ($pathSiteId !== $current) {
            throw new WriteException(
                'permission.cross_site_denied',
                "Path site_id '{$pathSiteId}' does not match current site '{$current}'. Cross-site memory access is denied.",
                403
            );
        }
    }

    private function loadRuleAt(string $siteId, string $kind, string $ruleId): Rule
    {
        $rule = $this->memory->get($ruleId);
        if ($rule === null) {
            throw new WriteException('memory.rule_not_found', "Rule '{$ruleId}' not found.", 404);
        }
        if ($rule->siteId !== $siteId) {
            // Read-after-write: never return a rule belonging to another site (#2, #16).
            throw new WriteException('memory.rule_not_found', "Rule '{$ruleId}' not found on this site.", 404);
        }
        if ($rule->kind !== $kind) {
            throw new WriteException(
                'memory.kind_path_mismatch',
                "Rule '{$ruleId}' has kind '{$rule->kind}', but path requested '{$kind}'.",
                404,
                ['expected_kind' => $kind, 'actual_kind' => $rule->kind]
            );
        }
        return $rule;
    }

    private function rulePath(Rule $rule): string
    {
        return self::ROOT
            . '/' . self::SITE_SEGMENT . '/' . $rule->siteId
            . '/' . self::RULES_SEGMENT . '/' . $rule->kind . '/' . $rule->id;
    }

    /**
     * Serialise a Rule as a memory-tool-readable text block.
     * Order is stable so str_replace / insert behave predictably.
     */
    public static function serializeRule(Rule $rule): string
    {
        $lines = [
            'id: ' . $rule->id,
            'kind: ' . $rule->kind,
            'scope: ' . $rule->scope,
            'confidence: ' . sprintf('%.2f', $rule->confidence),
            'status: ' . $rule->status,
            'pattern: ' . $rule->pattern,
            'directive: ' . $rule->directive,
        ];
        return implode("\n", $lines);
    }

    /**
     * Parse a rule body into a field map. Unknown fields → 422.
     *
     * @return array<string,string>
     */
    private function parseRuleBody(string $text): array
    {
        $fields = [];
        foreach (preg_split('/\R/', $text) as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            $pos = strpos($line, ':');
            if ($pos === false) {
                throw new WriteException(
                    'memory.invalid_body',
                    "Body line is not 'field: value': {$line}",
                    422
                );
            }
            $field = strtolower(trim(substr($line, 0, $pos)));
            $value = trim(substr($line, $pos + 1));
            if ($field === 'id') {
                // id is informational/read-only; skip silently.
                continue;
            }
            if (!in_array($field, self::EDITABLE_FIELDS, true)) {
                throw new WriteException(
                    'memory.unknown_field',
                    "Field '{$field}' is not editable. Valid: " . implode(', ', self::EDITABLE_FIELDS) . '.',
                    422,
                    ['unknown_field' => $field, 'valid_fields' => self::EDITABLE_FIELDS]
                );
            }
            $fields[$field] = $value;
        }
        if (isset($fields['kind'])) {
            Rule::assertValidKind($fields['kind']);
        }
        if (isset($fields['status'])) {
            Rule::assertValidStatus($fields['status']);
        }
        if (isset($fields['confidence']) && !is_numeric($fields['confidence'])) {
            throw new WriteException(
                'memory.invalid_field',
                "confidence must be numeric, got '{$fields['confidence']}'.",
                422
            );
        }
        return $fields;
    }

    /**
     * Apply parsed fields onto a Rule in-place (preserves identity, provenance,
     * timestamps). Caller persists via PreferenceMemory::update().
     *
     * @param array<string,string> $fields
     */
    private function applyEdits(Rule $rule, array $fields, string $auditPath): void
    {
        // kind is mutable only via rename(); applyEdits never changes kind here.
        if (isset($fields['kind']) && $fields['kind'] !== $rule->kind) {
            throw new WriteException(
                'memory.kind_via_rename_only',
                "Use rename() to change a rule's kind; cannot mutate via str_replace/insert.",
                422
            );
        }
        if (isset($fields['scope']))     $rule->scope = $fields['scope'];
        if (isset($fields['pattern']))   $rule->pattern = $fields['pattern'];
        if (isset($fields['directive'])) $rule->directive = $fields['directive'];
        if (isset($fields['confidence'])) {
            $rule->confidence = max(0.0, min(1.0, (float) $fields['confidence']));
        }
        if (isset($fields['status']))    $rule->status = $fields['status'];

        // Append audit provenance entry.
        $rule->provenance = array_slice(
            array_merge(
                [['source' => 'memory_tool', 'op' => 'mutate', 'tool_path' => $auditPath, 'at' => gmdate('Y-m-d H:i:s')]],
                $rule->provenance
            ),
            0,
            10
        );
    }

    /**
     * Apply the [start, end] (1-indexed, inclusive) view_range to content.
     * Behaves like Anthropic's tool: bounds clamped to file length.
     *
     * @param array<int,int>|null $range
     */
    private function applyViewRange(string $content, ?array $range): string
    {
        if (!$range || count($range) !== 2) {
            return $content;
        }
        $lines = explode("\n", $content);
        $total = count($lines);
        $start = max(1, (int) $range[0]);
        $end = (int) $range[1];
        if ($end < 0 || $end > $total) $end = $total;
        if ($end < $start) return '';
        return implode("\n", array_slice($lines, $start - 1, $end - $start + 1));
    }
}
