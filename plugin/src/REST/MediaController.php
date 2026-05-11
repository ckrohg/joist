<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use WP_REST_Request;
use WP_REST_Server;

/**
 * /joist/v1/media — list + URL-mode upload with SSRF defenses (constraint #21).
 * Direct multipart upload uses WP's own /wp/v2/media; we wrap URL-fetch here.
 */
final class MediaController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/media', [
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'list'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'uploadFromUrl'], 'permission_callback' => [$this, 'permissionsCheck']],
        ]);
        register_rest_route(self::NAMESPACE, '/media/(?P<id>\d+)/as-image-control', [
            'methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'asImageControl'], 'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    public function list(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $q = new \WP_Query([
                'post_type' => 'attachment',
                'post_status' => 'inherit',
                'post_mime_type' => $req->get_param('mime_type') ?: 'image',
                's' => $req->get_param('search') ?: null,
                'posts_per_page' => min(100, (int) ($req->get_param('per_page') ?: 50)),
                'paged' => max(1, (int) ($req->get_param('page') ?: 1)),
            ]);
            $items = [];
            foreach ($q->posts as $att) {
                $items[] = [
                    'id' => $att->ID,
                    'title' => $att->post_title,
                    'url' => wp_get_attachment_url($att->ID),
                    'mime_type' => $att->post_mime_type,
                    'alt' => get_post_meta($att->ID, '_wp_attachment_image_alt', true),
                ];
            }
            return $this->ok(['items' => $items, 'total' => (int) $q->found_posts]);
        });
    }

    public function uploadFromUrl(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            if (!current_user_can('upload_files')) {
                throw new WriteException('auth.upload_disabled', 'Media upload capability not granted to this user. Enable joist_agent_media_upload option.', 403);
            }
            $body = $req->get_json_params();
            $url = (string) ($body['url'] ?? '');
            if ($url === '') throw new WriteException('validation.url_required', 'url is required.', 400);

            // Constraint #21: SSRF defense.
            $urlValidator = Container::get('urlValidator');
            $urlValidator->validateExternal($url);

            // Download via WP's media sideload (after our pre-validation).
            require_once ABSPATH . 'wp-admin/includes/file.php';
            require_once ABSPATH . 'wp-admin/includes/media.php';
            require_once ABSPATH . 'wp-admin/includes/image.php';

            $tmp = download_url($url, 30);
            if (is_wp_error($tmp)) {
                throw new WriteException('media.download_failed', $tmp->get_error_message(), 502);
            }
            // Validate MIME post-download.
            $filetype = wp_check_filetype(basename(parse_url($url, PHP_URL_PATH) ?: 'image.png'));
            if (!str_starts_with((string) ($filetype['type'] ?? ''), 'image/')) {
                @unlink($tmp);
                throw new WriteException('media.invalid_mime', 'Only image files are accepted via URL upload.', 422);
            }

            $fileArray = [
                'name' => $body['filename_hint'] ?? basename(parse_url($url, PHP_URL_PATH) ?: 'image.png'),
                'tmp_name' => $tmp,
            ];
            $attachId = media_handle_sideload($fileArray, 0, $body['title'] ?? null);
            if (is_wp_error($attachId)) {
                @unlink($tmp);
                throw new WriteException('media.sideload_failed', $attachId->get_error_message(), 500);
            }
            if (!empty($body['alt_text'])) {
                update_post_meta($attachId, '_wp_attachment_image_alt', sanitize_text_field($body['alt_text']));
            }

            $meta = wp_get_attachment_metadata($attachId);
            return $this->ok([
                'id' => $attachId,
                'url' => wp_get_attachment_url($attachId),
                'sizes' => $meta['sizes'] ?? [],
                'mime_type' => get_post_mime_type($attachId),
                'width' => $meta['width'] ?? null,
                'height' => $meta['height'] ?? null,
            ], 201);
        });
    }

    public function asImageControl(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $id = (int) $req->get_param('id');
            $url = wp_get_attachment_url($id);
            if (!$url) throw new WriteException('not_found.media', "Attachment {$id} not found.", 404);
            return $this->ok([
                'id' => $id,
                'url' => $url,
                'alt' => get_post_meta($id, '_wp_attachment_image_alt', true),
                'source' => 'library',
            ]);
        });
    }
}
