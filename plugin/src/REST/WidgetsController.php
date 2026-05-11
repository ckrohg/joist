<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use WP_REST_Request;
use WP_REST_Server;

/**
 * /joist/v1/widgets — schema introspection + pre-flight validation.
 * Also /dynamic-tags.
 */
final class WidgetsController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/widgets', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'listWidgets'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/widgets/(?P<type>[a-z0-9_-]+)/schema', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'getSchema'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/widgets/validate', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'validateSettings'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/dynamic-tags', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'listDynamicTags'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    public function listWidgets(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', fn() => $this->ok(['widgets' => Container::get('catalog')->listAll()]));
    }

    public function getSchema(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $type = (string) $req->get_param('type');
            $schema = Container::get('catalog')->getSchema($type);
            if ($schema === null) {
                throw new WriteException('not_found.widget', "Widget type '{$type}' is not registered on this site.", 404);
            }
            return $this->ok($schema);
        });
    }

    public function validateSettings(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $body = $req->get_json_params();
            $type = (string) ($body['type'] ?? '');
            $settings = is_array($body['settings'] ?? null) ? $body['settings'] : [];
            try {
                $warnings = Container::get('schemaValidator')->validateWidget($type, $settings);
                return $this->ok(['valid' => true, 'errors' => [], 'warnings' => $warnings]);
            } catch (\Joist\Elementor\InvalidSettingsException $e) {
                return $this->ok([
                    'valid' => false,
                    'errors' => $e->errorDetails['errors'] ?? [['message' => $e->getMessage()]],
                    'warnings' => [],
                ]);
            }
        });
    }

    public function listDynamicTags(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', fn() => $this->ok(['tags' => Container::get('dynamicTags')->listAll()]));
    }
}
