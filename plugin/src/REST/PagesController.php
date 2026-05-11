<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Core\Hasher;
use Joist\Core\IDGenerator;
use Joist\Elementor\DocumentWriter;
use Joist\Elementor\WidgetCatalog;
use Joist\Elementor\WriteException;
use WP_REST_Request;
use WP_REST_Server;

/**
 * /joist/v1/pages — the core read/write surface.
 *
 * v0.1 M0 implements:
 *   - GET  /pages/{id}                 read with hash + elements
 *   - POST /pages                       create with Elementor data
 *   - POST /pages/{id}/patch            update_settings + replace_element ops
 *
 * v0.5 adds: insert, delete, move, duplicate, wrap, unwrap ops; surgical
 * tree-summary endpoint; revisions endpoint; lock endpoint; full §6.5-6.12
 * Elementor correctness rules.
 */
final class PagesController extends ControllerBase
{
    private DocumentWriter $writer;
    private Hasher $hasher;

    public function __construct()
    {
        $this->hasher = new Hasher();
        $this->writer = new DocumentWriter(
            $this->hasher,
            new IDGenerator(),
            new WidgetCatalog(),
        );
    }

    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/pages/(?P<id>\d+)', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'getPage'],
            'permission_callback' => [$this, 'permissionsCheck'],
            'args' => [
                'id' => ['validate_callback' => fn($v) => is_numeric($v)],
            ],
        ]);

        register_rest_route(self::NAMESPACE, '/pages', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'createPage'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);

        register_rest_route(self::NAMESPACE, '/pages/(?P<id>\d+)/patch', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'patchPage'],
            'permission_callback' => [$this, 'permissionsCheck'],
            'args' => [
                'id' => ['validate_callback' => fn($v) => is_numeric($v)],
            ],
        ]);
    }

    public function getPage(WP_REST_Request $request)
    {
        try {
            $postId = (int) $request->get_param('id');
            $post = get_post($postId);
            if (!$post) {
                throw new WriteException('not_found.page', "Page {$postId} not found.", 404);
            }

            $document = \Elementor\Plugin::$instance->documents->get($postId);
            if (!$document) {
                throw new WriteException('not_found.page', "Page {$postId} not an Elementor document.", 404);
            }

            $elements = $document->get_elements_data();
            $elements = is_array($elements) ? $elements : [];

            $payload = [
                'id' => $postId,
                'title' => $post->post_title,
                'slug' => $post->post_name,
                'status' => $post->post_status,
                'type' => $post->post_type,
                'modified' => mysql2date('c', $post->post_modified_gmt, false),
                'edit_url' => admin_url("post.php?post={$postId}&action=elementor"),
                'live_url' => get_permalink($postId),
                'elementor' => [
                    'hash' => $this->hasher->forElements($elements),
                    'version' => defined('ELEMENTOR_VERSION') ? ELEMENTOR_VERSION : null,
                    'template_type' => get_post_meta($postId, '_elementor_template_type', true) ?: 'wp-page',
                    'elements' => $elements,
                ],
            ];

            return $this->ok($payload);
        } catch (\Throwable $e) {
            return $this->errorResponse($e);
        }
    }

    public function createPage(WP_REST_Request $request)
    {
        try {
            $body = $request->get_json_params();
            if (!is_array($body)) {
                throw new WriteException('validation.invalid_body', 'Request body must be JSON.', 400);
            }

            $title = sanitize_text_field($body['title'] ?? 'Untitled');
            $slug = isset($body['slug']) ? sanitize_title($body['slug']) : '';
            $status = isset($body['status']) && in_array($body['status'], ['draft', 'publish', 'private'], true)
                ? $body['status']
                : 'draft';
            $elements = is_array($body['elements'] ?? null) ? $body['elements'] : [];
            $dryRun = (bool) ($body['dry_run'] ?? false);

            // Insert the post bare; mark as Elementor-built.
            $postId = wp_insert_post([
                'post_title' => $title,
                'post_name' => $slug,
                'post_status' => $status,
                'post_type' => 'page',
            ], true);

            if (is_wp_error($postId)) {
                throw new WriteException(
                    'wp.insert_failed',
                    'wp_insert_post failed: ' . $postId->get_error_message(),
                    500
                );
            }

            // Required postmeta so Elementor recognizes the page.
            update_post_meta($postId, '_elementor_edit_mode', 'builder');
            update_post_meta($postId, '_elementor_template_type', 'wp-page');
            update_post_meta($postId, '_elementor_version', ELEMENTOR_VERSION);

            // Route the write through the spine.
            $result = $this->writer->save($postId, $elements, null, $dryRun);

            return $this->ok([
                'id' => $postId,
                'hash' => $result['new_hash'],
                'edit_url' => admin_url("post.php?post={$postId}&action=elementor"),
                'live_url' => get_permalink($postId),
                'generated_ids' => $result['generated_ids'],
                'dry_run' => $result['dry_run'],
            ], 201);
        } catch (\Throwable $e) {
            return $this->errorResponse($e);
        }
    }

    public function patchPage(WP_REST_Request $request)
    {
        try {
            $postId = (int) $request->get_param('id');
            $body = $request->get_json_params();
            if (!is_array($body)) {
                throw new WriteException('validation.invalid_body', 'Request body must be JSON.', 400);
            }

            $expectedHash = isset($body['expected_hash']) && is_string($body['expected_hash'])
                ? $body['expected_hash']
                : null;
            $ops = is_array($body['ops'] ?? null) ? $body['ops'] : [];
            $dryRun = (bool) ($body['dry_run'] ?? false);

            $document = \Elementor\Plugin::$instance->documents->get($postId);
            if (!$document) {
                throw new WriteException('not_found.page', "Page {$postId} not found.", 404);
            }

            $current = $document->get_elements_data();
            $current = is_array($current) ? $current : [];

            // M0: apply two op types only.
            foreach ($ops as $op) {
                $current = $this->applyOp($current, $op);
            }

            $result = $this->writer->save($postId, $current, $expectedHash, $dryRun);

            return $this->ok([
                'new_hash' => $result['new_hash'],
                'applied_ops' => count($ops),
                'generated_ids' => $result['generated_ids'],
                'dry_run' => $result['dry_run'],
            ]);
        } catch (\Throwable $e) {
            return $this->errorResponse($e);
        }
    }

    /**
     * M0 op support: update_settings + replace_element.
     * v0.5 PatchEngine handles insert / delete / move / duplicate / wrap / unwrap.
     */
    private function applyOp(array $elements, array $op): array
    {
        if (!isset($op['op']) || !is_string($op['op'])) {
            throw new WriteException('validation.invalid_op', 'Op missing or not a string.', 400);
        }

        return match ($op['op']) {
            'update_settings' => $this->opUpdateSettings($elements, $op),
            'replace_element' => $this->opReplaceElement($elements, $op),
            default => throw new WriteException(
                'op.unsupported_in_m0',
                "Op '{$op['op']}' not supported in v0.1 M0. Supported: update_settings, replace_element.",
                400
            ),
        };
    }

    private function opUpdateSettings(array $elements, array $op): array
    {
        $targetId = $op['element_id'] ?? '';
        $newSettings = is_array($op['settings'] ?? null) ? $op['settings'] : [];
        return $this->walkAndUpdate($elements, $targetId, function (array $el) use ($newSettings): array {
            $el['settings'] = array_merge(is_array($el['settings'] ?? null) ? $el['settings'] : [], $newSettings);
            return $el;
        });
    }

    private function opReplaceElement(array $elements, array $op): array
    {
        $targetId = $op['element_id'] ?? '';
        $newElement = is_array($op['element'] ?? null) ? $op['element'] : null;
        if ($newElement === null) {
            throw new WriteException('validation.invalid_op', 'replace_element requires element payload.', 400);
        }
        return $this->walkAndUpdate($elements, $targetId, fn(array $_) => $newElement);
    }

    private function walkAndUpdate(array $elements, string $targetId, callable $mutator): array
    {
        foreach ($elements as $i => $el) {
            if (!is_array($el)) continue;
            if (($el['id'] ?? '') === $targetId) {
                $elements[$i] = $mutator($el);
                return $elements;
            }
            if (isset($el['elements']) && is_array($el['elements'])) {
                $elements[$i]['elements'] = $this->walkAndUpdate($el['elements'], $targetId, $mutator);
            }
        }
        return $elements;
    }
}
