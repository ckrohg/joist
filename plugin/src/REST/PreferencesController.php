<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use Joist\Eval\ForbiddenPhraseValidator;
use Joist\Eval\PreferenceMemory;
use Joist\Eval\Rule;
use WP_REST_Request;
use WP_REST_Server;

/**
 * /joist/v1/preferences — per-site preference memory CRUD + render.
 */
final class PreferencesController extends ControllerBase
{
    public function register(): void
    {
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

    public function compact(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function () {
            return $this->ok(Container::get('preferenceMemory')->compact());
        });
    }

    private static function camelOrPassthrough(string $field): string
    {
        // Rule properties happen to match these snake_case names except for last_invoked_at etc.
        return $field;
    }
}
