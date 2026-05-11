<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Elementor\WriteException;
use Joist\SEO\SEOAdapterFactory;
use WP_REST_Request;
use WP_REST_Server;

/**
 * /joist/v1/pages/{id}/seo — meta title/description/og-image/noindex,
 * routed through the detected SEO plugin (Yoast / RankMath / AIOSEO) or
 * Joist's own meta keys.
 */
final class SEOController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/pages/(?P<id>\d+)/seo', [
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'get'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::EDITABLE, 'callback' => [$this, 'set'], 'permission_callback' => [$this, 'permissionsCheck']],
        ]);
    }

    public function get(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $postId = (int) $req->get_param('id');
            if (!get_post($postId)) throw new WriteException('not_found.page', "Page {$postId} not found.", 404);
            $adapter = SEOAdapterFactory::active();
            return $this->ok(array_merge(['adapter' => $adapter->name()], $adapter->read($postId)));
        });
    }

    public function set(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $postId = (int) $req->get_param('id');
            if (!get_post($postId)) throw new WriteException('not_found.page', "Page {$postId} not found.", 404);
            $body = $req->get_json_params();
            if (!is_array($body)) throw new WriteException('validation.invalid_body', 'JSON body required.', 400);
            $adapter = SEOAdapterFactory::active();
            $adapter->write($postId, $body);
            return $this->ok(array_merge(['adapter' => $adapter->name(), 'updated' => true], $adapter->read($postId)));
        });
    }
}
