<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use WP_REST_Request;
use WP_REST_Server;

final class OperatingModeController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/site/operating-mode', [
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'get'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'set'], 'permission_callback' => [$this, 'permissionsAdmin']],
        ]);
    }

    public function get(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', fn() => $this->ok(Container::get('opMode')->current()));
    }

    public function set(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $body = $req->get_json_params();
            $mode = (string) ($body['mode'] ?? 'live');
            $duration = isset($body['duration_minutes']) ? (int) $body['duration_minutes'] : null;
            $staging = isset($body['staging_mandatory']) ? (bool) $body['staging_mandatory'] : (bool) (Container::get('opMode')->current()['staging_mandatory'] ?? false);
            Container::get('opMode')->set($mode, $duration, $staging);
            return $this->ok(Container::get('opMode')->current());
        });
    }
}
