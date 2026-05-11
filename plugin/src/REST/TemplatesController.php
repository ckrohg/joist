<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use WP_REST_Request;
use WP_REST_Server;

/**
 * /joist/v1/templates — Elementor Theme Builder templates (Pro): headers,
 * footers, single, archive, popups, loop items.
 *
 * v0.5: list + read + create/update via the same DocumentWriter path as
 * pages. Display-condition assignment with priority is v0.7 (requires
 * Theme_Builder_Module internals not safe to drive without runtime testing).
 */
final class TemplatesController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/templates', [
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'list'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'create'], 'permission_callback' => [$this, 'permissionsCheck']],
        ]);
        register_rest_route(self::NAMESPACE, '/templates/(?P<id>\d+)', [
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'get'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::EDITABLE, 'callback' => [$this, 'update'], 'permission_callback' => [$this, 'permissionsCheck']],
        ]);
    }

    public function list(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $typeFilter = $req->get_param('type');
            $q = new \WP_Query([
                'post_type' => 'elementor_library',
                'posts_per_page' => 100,
                'meta_query' => [['key' => '_elementor_template_type', 'compare' => 'EXISTS']],
            ]);
            $items = [];
            foreach ($q->posts as $post) {
                $templateType = get_post_meta($post->ID, '_elementor_template_type', true);
                if ($typeFilter && $templateType !== $typeFilter) continue;
                $items[] = [
                    'id' => $post->ID,
                    'name' => $post->post_title,
                    'type' => $templateType,
                    'status' => $post->post_status,
                    'hash' => Container::get('hasher')->forPage($post->ID),
                ];
            }
            return $this->ok(['items' => $items]);
        });
    }

    public function get(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $id = (int) $req->get_param('id');
            $document = \Elementor\Plugin::$instance->documents->get($id);
            if (!$document) throw new WriteException('not_found.template', "Template {$id} not found.", 404);
            $elements = $document->get_elements_data();
            return $this->ok([
                'id' => $id,
                'type' => get_post_meta($id, '_elementor_template_type', true),
                'hash' => Container::get('hasher')->forElements(is_array($elements) ? $elements : []),
                'elements' => is_array($elements) ? $elements : [],
            ]);
        });
    }

    public function create(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $body = $req->get_json_params();
            $type = (string) ($body['type'] ?? 'header');
            $valid = ['header', 'footer', 'single', 'single-page', 'single-post', 'archive', 'popup', 'loop-item', 'error-404', 'search-results', 'section', 'page'];
            if (!in_array($type, $valid, true)) throw new WriteException('validation.invalid_template_type', "Invalid template type '{$type}'.", 400);

            $postId = wp_insert_post([
                'post_title' => sanitize_text_field($body['name'] ?? ucfirst($type)),
                'post_status' => 'publish',
                'post_type' => 'elementor_library',
            ], true);
            if (is_wp_error($postId)) throw new WriteException('wp.insert_failed', $postId->get_error_message(), 500);

            update_post_meta($postId, '_elementor_edit_mode', 'builder');
            update_post_meta($postId, '_elementor_template_type', $type);
            update_post_meta($postId, '_elementor_version', ELEMENTOR_VERSION);
            wp_set_object_terms($postId, $type, 'elementor_library_type');

            $actor = $this->actorContext($req, $sessionId);
            $result = Container::get('documentWriter')->save(array_merge($actor, [
                'post_id' => $postId,
                'elements' => is_array($body['elements'] ?? null) ? $body['elements'] : [],
                'intent' => "create {$type} template",
            ]));

            return $this->ok([
                'id' => $postId,
                'type' => $type,
                'hash' => $result['new_hash'],
                'edit_url' => admin_url("post.php?post={$postId}&action=elementor"),
            ], 201);
        });
    }

    public function update(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $id = (int) $req->get_param('id');
            $body = $req->get_json_params();
            if (!isset($body['expected_hash'])) throw new WriteException('validation.expected_hash_required', 'PUT requires expected_hash.', 400);
            $actor = $this->actorContext($req, $sessionId);
            $result = Container::get('documentWriter')->save(array_merge($actor, [
                'post_id' => $id,
                'elements' => is_array($body['elements'] ?? null) ? $body['elements'] : [],
                'expected_hash' => $body['expected_hash'],
                'intent' => 'update template',
            ]));
            return $this->ok(['id' => $id, 'new_hash' => $result['new_hash'], 'warnings' => $result['warnings'] ?? []]);
        });
    }
}
