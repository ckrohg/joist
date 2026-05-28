<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use Joist\Eval\ForbiddenPhraseValidator;
use Joist\Eval\MemoryToolHandler;
use Joist\Eval\PreferenceMemory;
use Joist\Eval\Rule;
use WP_REST_Request;
use WP_REST_Server;

/**
 * @purpose REST surface for per-site preference memory.
 *
 * As of the 2026-05-28 substrate refactor (Wave 2a), the canonical public
 * surface is the memory_20250818 command set under /joist/v1/memory/<command>.
 * Routes the six tool commands (view / create / str_replace / insert / delete
 * / rename) into MemoryToolHandler, which translates them into our existing
 * PreferenceMemory + Rule semantics — dedup, confidence, compact, and the
 * 40-rule / 800-token renderForPrompt cap all stay in the handler.
 *
 * Per-site multi-tenancy is exposed via the path prefix
 * /memories/site/<site_id>/...; the handler asserts site identity from
 * PreferenceMemory::siteId() and rejects cross-site access with 403.
 *
 * The original 7 /preferences endpoints below remain wired for v0.7/v0.8
 * backwards compatibility but are @deprecated — slated for removal in v0.9.
 */
final class PreferencesController extends ControllerBase
{
    public function register(): void
    {
        // ── memory_20250818 command surface (canonical as of 2026-05-28) ──
        // Per Anthropic spec, all six commands are POST with a JSON body
        // shaped like the tool I/O contract. Bodies vary per command; see
        // MemoryToolHandler for the exact arg shapes.
        register_rest_route(self::NAMESPACE, '/memory/view', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'memoryView'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/memory/create', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'memoryCreate'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/memory/str_replace', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'memoryStrReplace'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/memory/insert', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'memoryInsert'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/memory/delete', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'memoryDelete'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/memory/rename', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'memoryRename'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);

        // ── Legacy /preferences surface (@deprecated, removal v0.9) ──
        register_rest_route(self::NAMESPACE, '/preferences', [
            ['methods' => WP_REST_Server::READABLE,  'callback' => [$this, 'list'],   'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'create'], 'permission_callback' => [$this, 'permissionsCheck']],
        ]);
        register_rest_route(self::NAMESPACE, '/preferences/render', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'render'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/preferences/validate', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'validateText'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/preferences/compact', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'compact'],
            'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
        register_rest_route(self::NAMESPACE, '/preferences/(?P<id>[A-Za-z0-9_-]+)', [
            ['methods' => WP_REST_Server::READABLE,  'callback' => [$this, 'get'],     'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::EDITABLE,  'callback' => [$this, 'update'],  'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => 'DELETE',                  'callback' => [$this, 'delete'],  'permission_callback' => [$this, 'permissionsCheck']],
        ]);
    }

    // ──────────────────────────────────────────────────────────────────────
    // memory_20250818 command handlers
    // ──────────────────────────────────────────────────────────────────────

    public function memoryView(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            return $this->ok($this->handler()->view($this->jsonBody($req)));
        });
    }

    public function memoryCreate(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            return $this->ok($this->handler()->create($this->jsonBody($req)), 201);
        });
    }

    public function memoryStrReplace(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            return $this->ok($this->handler()->strReplace($this->jsonBody($req)));
        });
    }

    public function memoryInsert(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            return $this->ok($this->handler()->insert($this->jsonBody($req)));
        });
    }

    public function memoryDelete(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            return $this->ok($this->handler()->delete($this->jsonBody($req)));
        });
    }

    public function memoryRename(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            return $this->ok($this->handler()->rename($this->jsonBody($req)));
        });
    }

    // ──────────────────────────────────────────────────────────────────────
    // Legacy /preferences handlers (@deprecated since 2026-05-28, removal v0.9)
    // Behaviour unchanged — kept for callers that haven't migrated yet.
    // ──────────────────────────────────────────────────────────────────────

    /** @deprecated 2026-05-28 — prefer POST /memory/view. Removed in v0.9. */
    public function list(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function () {
            $mem = Container::get('preferenceMemory');
            $rules = $mem->listAll();
            return $this->ok([
                'site_id' => $mem->siteId(),
                'rules' => array_map(fn(Rule $r) => $r->toApi(), $rules),
                'total' => count($rules),
            ]);
        });
    }

    /** @deprecated 2026-05-28 — prefer POST /memory/view on /memories/site/<id>/render.md. Removed in v0.9. */
    public function render(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function () {
            $mem = Container::get('preferenceMemory');
            $block = $mem->renderForPrompt();
            return $this->ok([
                'site_id' => $mem->siteId(),
                'preferences_block' => $block,
                'rule_count' => count($mem->listActive()),
            ]);
        });
    }

    /** @deprecated 2026-05-28 — prefer POST /memory/view on a rule file path. Removed in v0.9. */
    public function get(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $mem = Container::get('preferenceMemory');
            $rule = $mem->get((string) $req->get_param('id'));
            if (!$rule) throw new WriteException('not_found.rule', 'Preference rule not found.', 404);
            if ($rule->siteId !== $mem->siteId()) {
                throw new WriteException('not_found.rule', 'Rule does not belong to current site.', 404);
            }
            return $this->ok($rule->toApi());
        });
    }

    /** @deprecated 2026-05-28 — prefer POST /memory/create. Removed in v0.9. */
    public function create(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $body = $req->get_json_params();
            if (!is_array($body)) throw new WriteException('validation.invalid_body', 'JSON body required.', 400);

            // Support batch: body may be a single rule or {rules: [...]}.
            $items = isset($body['rules']) && is_array($body['rules']) ? $body['rules'] : [$body];

            $mem = Container::get('preferenceMemory');
            $created = [];
            foreach ($items as $item) {
                if (empty($item['kind']) || empty($item['pattern']) || empty($item['directive'])) {
                    throw new WriteException('validation.invalid_rule', 'kind, pattern, directive are required.', 400);
                }
                try {
                    Rule::assertValidKind((string) $item['kind']);
                } catch (\InvalidArgumentException $e) {
                    throw new WriteException('validation.invalid_kind', $e->getMessage(), 400);
                }
                $rule = Rule::create(
                    siteId: $mem->siteId(),
                    kind: (string) $item['kind'],
                    pattern: (string) $item['pattern'],
                    directive: (string) $item['directive'],
                    provenance: array_merge(
                        ['source' => $item['provenance']['source'] ?? 'unknown', 'session_id' => $sessionId],
                        is_array($item['provenance'] ?? null) ? $item['provenance'] : []
                    ),
                    scope: (string) ($item['scope'] ?? 'global'),
                    confidence: (float) ($item['confidence'] ?? 1.0),
                    status: (string) ($item['status'] ?? Rule::STATUS_ACTIVE),
                );
                $created[] = $mem->add($rule)->toApi();
            }

            return $this->ok(['created' => $created, 'count' => count($created)], 201);
        });
    }

    /** @deprecated 2026-05-28 — prefer POST /memory/str_replace or /memory/insert. Removed in v0.9. */
    public function update(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $id = (string) $req->get_param('id');
            $mem = Container::get('preferenceMemory');
            $rule = $mem->get($id);
            if (!$rule || $rule->siteId !== $mem->siteId()) {
                throw new WriteException('not_found.rule', 'Preference rule not found.', 404);
            }
            $body = $req->get_json_params() ?: [];
            foreach (['pattern', 'directive', 'scope', 'status'] as $f) {
                if (isset($body[$f])) $rule->{self::camelOrPassthrough($f)} = (string) $body[$f];
            }
            if (isset($body['confidence'])) {
                $rule->confidence = max(0.0, min(1.0, (float) $body['confidence']));
            }
            Rule::assertValidStatus($rule->status);
            $mem->update($rule);
            return $this->ok($rule->toApi());
        });
    }

    /** @deprecated 2026-05-28 — prefer POST /memory/delete. Removed in v0.9. */
    public function delete(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $mem = Container::get('preferenceMemory');
            $id = (string) $req->get_param('id');
            $rule = $mem->get($id);
            if (!$rule || $rule->siteId !== $mem->siteId()) {
                throw new WriteException('not_found.rule', 'Preference rule not found.', 404);
            }
            $mem->archive($id);
            return $this->ok(['id' => $id, 'archived' => true]);
        });
    }

    /** @deprecated 2026-05-28 — validator semantics unchanged; no direct memory-tool equivalent. Removed in v0.9 only after a replacement validation surface ships. */
    public function validateText(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $body = $req->get_json_params() ?: [];
            $text = (string) ($body['text'] ?? '');
            $mem = Container::get('preferenceMemory');
            $validator = new ForbiddenPhraseValidator($mem);
            $violations = $validator->validateText($text);
            return $this->ok(['valid' => count($violations) === 0, 'violations' => $violations]);
        });
    }

    /** @deprecated 2026-05-28 — compaction is a server-side cron, not a client tool command. May survive as /memory/compact in v0.9. */
    public function compact(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function () {
            return $this->ok(Container::get('preferenceMemory')->compact());
        });
    }

    // ──────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ──────────────────────────────────────────────────────────────────────

    private function handler(): MemoryToolHandler
    {
        return Container::get('memoryToolHandler');
    }

    /**
     * Extract a JSON body or throw a 400. The memory_20250818 tool always
     * sends structured JSON; an empty/missing body is a hard error.
     *
     * @return array<string,mixed>
     */
    private function jsonBody(WP_REST_Request $req): array
    {
        $body = $req->get_json_params();
        if (!is_array($body)) {
            throw new WriteException('memory.invalid_body', 'JSON body required.', 400);
        }
        return $body;
    }

    private static function camelOrPassthrough(string $field): string
    {
        // Rule properties happen to match these snake_case names except for last_invoked_at etc.
        return $field;
    }
}
