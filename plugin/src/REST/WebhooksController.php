<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use WP_REST_Request;
use WP_REST_Server;

final class WebhooksController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/webhooks', [
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'list'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'create'], 'permission_callback' => [$this, 'permissionsCheck']],
        ]);
        register_rest_route(self::NAMESPACE, '/webhooks/(?P<id>\d+)', [
            'methods' => 'DELETE', 'callback' => [$this, 'delete'], 'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/webhooks/(?P<id>\d+)/rotate-secret', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'rotate'], 'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    public function list(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', fn() => $this->ok(['webhooks' => Container::get('webhookStore')->list()]));
    }

    public function create(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $body = $req->get_json_params();
            $url = (string) ($body['url'] ?? '');
            $events = is_array($body['events'] ?? null) ? $body['events'] : [];
            if ($url === '' || count($events) === 0) throw new WriteException('validation.invalid_webhook', 'url and events[] are required.', 400);
            return $this->ok(Container::get('webhookStore')->register($url, $events), 201);
        });
    }

    public function delete(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            Container::get('webhookStore')->delete((int) $req->get_param('id'));
            return $this->ok(['deleted' => true]);
        });
    }

    public function rotate(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $secret = Container::get('webhookStore')->rotateSecret((int) $req->get_param('id'));
            return $this->ok(['secret' => $secret, 'old_secret_valid_until' => date('c', time() + 86400)]);
        });
    }
}
