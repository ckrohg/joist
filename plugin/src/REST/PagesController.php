<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use WP_REST_Request;
use WP_REST_Server;

/**
 * /joist/v1/pages — the core read/write surface (v0.5, hardened).
 */
final class PagesController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/pages', [
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'list'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'create'], 'permission_callback' => [$this, 'permissionsCheck']],
        ]);
        register_rest_route(self::NAMESPACE, '/pages/(?P<id>\d+)', [
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'get'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::EDITABLE, 'callback' => [$this, 'replace'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => 'DELETE', 'callback' => [$this, 'delete'], 'permission_callback' => [$this, 'permissionsCheck']],
        ]);
        register_rest_route(self::NAMESPACE, '/pages/(?P<id>\d+)/patch', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'patch'], 'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/pages/(?P<id>\d+)/tree-summary', [
            'methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'treeSummary'], 'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/pages/(?P<id>\d+)/revisions', [
            'methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'revisions'], 'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/pages/(?P<id>\d+)/revisions/(?P<rev>\d+)/restore', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'restoreRevision'], 'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/pages/legacy-builder/section-with-column', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'legacyWrap'], 'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    public function list(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $perPage = min(100, max(1, (int) $req->get_param('per_page') ?: 50));
            $page = max(1, (int) $req->get_param('page') ?: 1);
            $status = $req->get_param('status') ?: 'publish,draft';
            $statuses = array_map('trim', explode(',', (string) $status));
            $search = (string) ($req->get_param('search') ?: '');

            $q = new \WP_Query([
                'post_type' => $req->get_param('type') ?: 'page',
                'post_status' => $statuses,
                's' => $search ?: null,
                'posts_per_page' => $perPage,
                'paged' => $page,
                'meta_key' => '_elementor_edit_mode',
                'orderby' => 'modified',
                'order' => 'DESC',
            ]);

            $hasher = Container::get('hasher');
            $items = [];
            foreach ($q->posts as $post) {
                $document = \Elementor\Plugin::$instance->documents->get($post->ID);
                $hasData = $document && method_exists($document, 'is_built_with_elementor') && $document->is_built_with_elementor();
                $items[] = [
                    'id' => $post->ID,
                    'title' => $post->post_title,
                    'slug' => $post->post_name,
                    'status' => $post->post_status,
                    'type' => $post->post_type,
                    'has_elementor_data' => (bool) $hasData,
                    'hash' => $hasData ? $hasher->forPage($post->ID) : null,
                    'modified' => mysql2date('c', $post->post_modified_gmt, false),
                ];
            }
            return $this->ok(['items' => $items, 'total' => (int) $q->found_posts]);
        });
    }

    public function get(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $postId = (int) $req->get_param('id');
            $post = get_post($postId);
            if (!$post) throw new WriteException('not_found.page', "Page {$postId} not found.", 404);

            $document = \Elementor\Plugin::$instance->documents->get($postId);
            if (!$document) throw new WriteException('not_found.page', "Page {$postId} is not an Elementor document.", 404);

            $hasher = Container::get('hasher');
            $elements = $document->get_elements_data();
            $elements = is_array($elements) ? $elements : [];
            $includeFull = $req->get_param('include') === 'elements';

            $modifier = Container::get('audit')->lastModifierFor($postId);

            $payload = [
                'id' => $postId,
                'title' => $post->post_title,
                'slug' => $post->post_name,
                'status' => $post->post_status,
                'type' => $post->post_type,
                'modified' => mysql2date('c', $post->post_modified_gmt, false),
                'edit_url' => admin_url("post.php?post={$postId}&action=elementor"),
                'live_url' => get_permalink($postId),
                'last_modifier' => $modifier,
                'elementor' => [
                    'hash' => $hasher->forElements($elements),
                    'version' => defined('ELEMENTOR_VERSION') ? ELEMENTOR_VERSION : null,
                    'template_type' => get_post_meta($postId, '_elementor_template_type', true) ?: 'wp-page',
                ],
            ];
            if ($includeFull) {
                $payload['elementor']['elements'] = $elements;
            } else {
                $payload['elementor']['tree_summary'] = $this->buildTreeSummary($elements);
            }
            return $this->ok($payload);
        });
    }

    public function treeSummary(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $postId = (int) $req->get_param('id');
            $document = \Elementor\Plugin::$instance->documents->get($postId);
            if (!$document) throw new WriteException('not_found.page', "Page {$postId} not found.", 404);
            $elements = $document->get_elements_data();
            $elements = is_array($elements) ? $elements : [];
            return $this->ok([
                'hash' => Container::get('hasher')->forElements($elements),
                'outline' => $this->buildTreeSummary($elements),
            ]);
        });
    }

    public function create(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $body = $req->get_json_params();
            if (!is_array($body)) throw new WriteException('validation.invalid_body', 'JSON body required.', 400);

            $postId = wp_insert_post([
                'post_title' => sanitize_text_field($body['title'] ?? 'Untitled'),
                'post_name' => isset($body['slug']) ? sanitize_title($body['slug']) : '',
                'post_status' => in_array($body['status'] ?? '', ['draft','publish','private'], true) ? $body['status'] : 'draft',
                'post_type' => $body['type'] ?? 'page',
            ], true);
            if (is_wp_error($postId)) {
                throw new WriteException('wp.insert_failed', $postId->get_error_message(), 500);
            }
            update_post_meta($postId, '_elementor_edit_mode', 'builder');
            update_post_meta($postId, '_elementor_template_type', 'wp-page');
            update_post_meta($postId, '_elementor_version', ELEMENTOR_VERSION);

            $actor = $this->actorContext($req, $sessionId);
            $result = Container::get('documentWriter')->save(array_merge($actor, [
                'post_id' => $postId,
                'elements' => is_array($body['elements'] ?? null) ? $body['elements'] : [],
                'page_settings' => is_array($body['page_settings'] ?? null) ? $body['page_settings'] : [],
                'intent' => $body['intent'] ?? 'create page',
                'dry_run' => (bool) ($body['dry_run'] ?? false),
            ]));

            return $this->ok([
                'id' => $postId,
                'hash' => $result['new_hash'],
                'edit_url' => admin_url("post.php?post={$postId}&action=elementor"),
                'live_url' => get_permalink($postId),
                'generated_ids' => $result['generated_ids'],
                'transformations' => $result['transformations'] ?? [],
                'warnings' => $result['warnings'] ?? [],
                'dry_run' => $result['dry_run'],
            ], 201);
        });
    }

    public function replace(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $postId = (int) $req->get_param('id');
            $body = $req->get_json_params();
            if (!is_array($body)) throw new WriteException('validation.invalid_body', 'JSON body required.', 400);
            if (!isset($body['expected_hash'])) throw new WriteException('validation.expected_hash_required', 'PUT requires expected_hash.', 400);

            // Full replace counts as a destructive op for the chained-singleton check.
            Container::get('sessions')->recordOp($sessionId, 'replace_full', $postId);

            $actor = $this->actorContext($req, $sessionId);
            $result = Container::get('documentWriter')->save(array_merge($actor, [
                'post_id' => $postId,
                'elements' => is_array($body['elements'] ?? null) ? $body['elements'] : [],
                'page_settings' => is_array($body['page_settings'] ?? null) ? $body['page_settings'] : [],
                'expected_hash' => $body['expected_hash'],
                'intent' => $body['intent'] ?? 'full page replace',
                'dry_run' => (bool) ($body['dry_run'] ?? false),
            ]));

            if (!empty($body['title']) || isset($body['slug']) || isset($body['status'])) {
                wp_update_post(array_filter([
                    'ID' => $postId,
                    'post_title' => isset($body['title']) ? sanitize_text_field($body['title']) : null,
                    'post_name' => isset($body['slug']) ? sanitize_title($body['slug']) : null,
                    'post_status' => isset($body['status']) && in_array($body['status'], ['draft','publish','private'], true) ? $body['status'] : null,
                ], fn($v) => $v !== null));
            }

            return $this->ok([
                'new_hash' => $result['new_hash'],
                'css_regenerated' => false,
                'pending_verifications' => $result['pending_verifications'] ?? [],
                'transformations' => $result['transformations'] ?? [],
                'warnings' => $result['warnings'] ?? [],
                'dry_run' => $result['dry_run'],
            ]);
        });
    }

    public function patch(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $postId = (int) $req->get_param('id');
            $body = $req->get_json_params();
            if (!is_array($body)) throw new WriteException('validation.invalid_body', 'JSON body required.', 400);

            $ops = is_array($body['ops'] ?? null) ? $body['ops'] : [];
            if (count($ops) === 0) throw new WriteException('validation.empty_ops', 'ops array is empty.', 400);

            $document = \Elementor\Plugin::$instance->documents->get($postId);
            if (!$document) throw new WriteException('not_found.page', "Page {$postId} not found.", 404);
            $current = $document->get_elements_data();
            $current = is_array($current) ? $current : [];

            // Apply the ops.
            [$newTree, $generatedFromPatch] = Container::get('patchEngine')->apply($current, $ops);

            // Record destructive ops for the chained-singleton check.
            foreach ($ops as $op) {
                if (in_array($op['op'] ?? '', ['delete', 'unwrap'], true)) {
                    Container::get('sessions')->recordOp($sessionId, $op['op'], $postId);
                }
            }

            $actor = $this->actorContext($req, $sessionId);
            $result = Container::get('documentWriter')->save(array_merge($actor, [
                'post_id' => $postId,
                'elements' => $newTree,
                'expected_hash' => $body['expected_hash'] ?? null,
                'intent' => $body['intent'] ?? ('patch: ' . count($ops) . ' ops'),
                'dry_run' => (bool) ($body['dry_run'] ?? false),
                'force_layout_cross_mode' => (bool) ($body['force'] ?? false),
                'prefer_literals' => (bool) ($body['prefer_literals'] ?? false),
                'fill_responsive' => (bool) ($body['fill_responsive'] ?? false),
                // Wave 11: Forced Optimization gate (constraint #21) — pass
                // through the bypass flag and the critique context the gate
                // needs to score before/after states.
                'force_save' => (bool) ($body['force_save'] ?? false),
                'critique_context' => is_array($body['critique_context'] ?? null) ? $body['critique_context'] : null,
            ]));

            return $this->ok([
                'new_hash' => $result['new_hash'],
                'applied_ops' => count($ops),
                'generated_ids' => array_merge($generatedFromPatch, $result['generated_ids']),
                'transformations' => $result['transformations'] ?? [],
                'responsive_fills' => $result['responsive_fills'] ?? [],
                'warnings' => $result['warnings'] ?? [],
                'pending_verifications' => $result['pending_verifications'] ?? [],
                'dry_run' => $result['dry_run'],
            ]);
        });
    }

    public function delete(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $postId = (int) $req->get_param('id');
            $force = (bool) ($req->get_param('force') === 'true' || $req->get_param('force') === true);

            $actor = wp_get_current_user();
            $policy = Container::get('policy');
            $policy->assertAllowed($force ? 'page.delete_force' : 'page.delete', ['post_id' => $postId], $actor instanceof \WP_User ? $actor : null);

            Container::get('sessions')->recordOp($sessionId, 'delete', $postId);
            $policy->checkPlanRequired($sessionId, 'delete', $postId);

            if ($force) {
                $result = wp_delete_post($postId, true);
            } else {
                $result = wp_trash_post($postId);
            }
            if (!$result) throw new WriteException('wp.delete_failed', "Could not delete page {$postId}.", 500);

            Container::get('audit')->log(
                $force ? 'page.delete_force' : 'page.trash',
                $postId, $actor instanceof \WP_User && in_array('joist_agent', (array)$actor->roles, true) ? 'agent' : 'human',
                $sessionId, $actor instanceof \WP_User ? (int)$actor->ID : null, $sessionId, null, null, null, 'delete page', null
            );

            return $this->ok(['id' => $postId, 'force' => $force, 'deleted' => true]);
        });
    }

    public function revisions(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $postId = (int) $req->get_param('id');
            $list = Container::get('revisions')->listForPage($postId, min(200, (int) ($req->get_param('limit') ?: 50)));
            return $this->ok(['revisions' => $list]);
        });
    }

    public function restoreRevision(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $revId = (int) $req->get_param('rev');
            $ok = Container::get('revisions')->restore($revId);
            if (!$ok) throw new WriteException('not_found.revision', "Revision {$revId} not found.", 404);

            $postId = (int) $req->get_param('id');
            wp_schedule_single_event(time() + 1, 'joist_post_save_verify', [$postId]);
            return $this->ok(['restored_revision' => $revId, 'page_id' => $postId]);
        });
    }

    public function legacyWrap(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $body = $req->get_json_params();
            $widths = is_array($body['column_widths'] ?? null) ? $body['column_widths'] : [100];
            $widgets = is_array($body['widgets'] ?? null) ? $body['widgets'] : [];

            $columns = [];
            foreach ($widths as $colIndex => $width) {
                $colWidgets = array_values(array_filter($widgets, fn($w) => ((int) ($w['column'] ?? 0)) === $colIndex));
                $columns[] = [
                    'id' => bin2hex(random_bytes(4)),
                    'elType' => 'column',
                    'isInner' => false,
                    'settings' => ['_column_size' => (int) $width],
                    'elements' => array_map(function ($w) {
                        unset($w['column']);
                        $w['id'] = $w['id'] ?? bin2hex(random_bytes(4));
                        $w['elements'] = $w['elements'] ?? [];
                        return $w;
                    }, $colWidgets),
                ];
            }
            $section = [
                'id' => bin2hex(random_bytes(4)),
                'elType' => 'section',
                'isInner' => false,
                'settings' => is_array($body['section_settings'] ?? null) ? $body['section_settings'] : [],
                'elements' => $columns,
            ];
            return $this->ok(['element' => $section]);
        });
    }

    private function buildTreeSummary(array $elements, int $depth = 0): array
    {
        $out = [];
        foreach ($elements as $el) {
            if (!is_array($el)) continue;
            $entry = [
                'id' => $el['id'] ?? null,
                'elType' => $el['elType'] ?? 'unknown',
                'depth' => $depth,
            ];
            if (($el['elType'] ?? '') === 'widget') {
                $entry['widgetType'] = $el['widgetType'] ?? null;
                $entry['preview'] = $this->widgetPreview($el);
            }
            if (isset($el['elements']) && is_array($el['elements'])) {
                $entry['child_count'] = count($el['elements']);
                $out[] = $entry;
                $out = array_merge($out, $this->buildTreeSummary($el['elements'], $depth + 1));
            } else {
                $out[] = $entry;
            }
        }
        return $out;
    }

    private function widgetPreview(array $widget): string
    {
        $s = is_array($widget['settings'] ?? null) ? $widget['settings'] : [];
        foreach (['title', 'editor', 'text', 'heading_text', 'button_text'] as $k) {
            if (!empty($s[$k]) && is_string($s[$k])) {
                return mb_substr(wp_strip_all_tags($s[$k]), 0, 60);
            }
        }
        return '';
    }
}
