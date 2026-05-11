<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use WP_REST_Request;
use WP_REST_Server;

/**
 * /joist/v1/plugins — admin-only. v0.5: list + install-by-slug (wp.org) +
 * activate/deactivate. zip_url install is gated by PolicyGuard +
 * JOIST_ALLOW_ARBITRARY_ZIP constant.
 */
final class PluginsController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/plugins', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'list'],
            'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
        register_rest_route(self::NAMESPACE, '/plugins/install', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'install'],
            'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
        register_rest_route(self::NAMESPACE, '/plugins/(?P<slug>[a-z0-9-]+)/activate', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'activate'], 'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
        register_rest_route(self::NAMESPACE, '/plugins/(?P<slug>[a-z0-9-]+)/deactivate', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'deactivate'], 'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
    }

    public function list(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function () {
            if (!function_exists('get_plugins')) require_once ABSPATH . 'wp-admin/includes/plugin.php';
            $all = get_plugins();
            $active = get_option('active_plugins', []);
            $out = [];
            foreach ($all as $file => $data) {
                $out[] = [
                    'file' => $file,
                    'slug' => dirname($file) === '.' ? basename($file, '.php') : dirname($file),
                    'name' => $data['Name'],
                    'version' => $data['Version'],
                    'active' => in_array($file, $active, true),
                ];
            }
            return $this->ok(['plugins' => $out]);
        });
    }

    public function install(WP_REST_Request $req)
    {
        return $this->handle($req, 'plugin_install', function (WP_REST_Request $req) {
            $body = $req->get_json_params();
            $user = wp_get_current_user();

            if (!empty($body['zip_url'])) {
                // PolicyGuard + constant gate.
                Container::get('policy')->assertAllowed('plugin.install_zip', [], $user instanceof \WP_User ? $user : null);
                if (empty($body['expected_sha256'])) {
                    throw new WriteException('validation.sha256_required', 'zip_url install requires expected_sha256.', 400);
                }
                Container::get('urlValidator')->validateExternal((string) $body['zip_url']);
                throw new WriteException('not_implemented', 'zip_url install path is gated but not yet implemented in v0.5. Use slug.', 501);
            }

            $slug = sanitize_key($body['slug'] ?? '');
            if ($slug === '') throw new WriteException('validation.slug_required', 'slug is required (wp.org repository slug).', 400);

            require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
            require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
            require_once ABSPATH . 'wp-admin/includes/plugin.php';

            $api = plugins_api('plugin_information', ['slug' => $slug, 'fields' => ['sections' => false]]);
            if (is_wp_error($api)) {
                throw new WriteException('plugin.not_found_on_wporg', "Plugin '{$slug}' not found on wp.org.", 404);
            }
            $upgrader = new \Plugin_Upgrader(new \WP_Ajax_Upgrader_Skin());
            $result = $upgrader->install($api->download_link);
            if (is_wp_error($result) || $result === false) {
                throw new WriteException('plugin.install_failed', is_wp_error($result) ? $result->get_error_message() : 'Install returned false.', 500);
            }

            if (!empty($body['activate'])) {
                $file = $upgrader->plugin_info();
                if ($file) {
                    activate_plugin($file);
                }
            }
            return $this->ok(['slug' => $slug, 'installed' => true, 'activated' => !empty($body['activate'])], 201);
        });
    }

    public function activate(WP_REST_Request $req)
    {
        return $this->handle($req, 'plugin_install', function (WP_REST_Request $req) {
            $slug = sanitize_key($req->get_param('slug'));
            $file = $this->pluginFileForSlug($slug);
            if (!$file) throw new WriteException('not_found.plugin', "Plugin '{$slug}' not installed.", 404);
            $r = activate_plugin($file);
            if (is_wp_error($r)) throw new WriteException('plugin.activate_failed', $r->get_error_message(), 500);
            return $this->ok(['slug' => $slug, 'active' => true]);
        });
    }

    public function deactivate(WP_REST_Request $req)
    {
        return $this->handle($req, 'plugin_install', function (WP_REST_Request $req) {
            $slug = sanitize_key($req->get_param('slug'));
            Container::get('policy')->assertAllowed('plugin.deactivate_core', ['slug' => $slug], wp_get_current_user());
            $file = $this->pluginFileForSlug($slug);
            if (!$file) throw new WriteException('not_found.plugin', "Plugin '{$slug}' not installed.", 404);
            deactivate_plugins($file);
            return $this->ok(['slug' => $slug, 'active' => false]);
        });
    }

    private function pluginFileForSlug(string $slug): ?string
    {
        if (!function_exists('get_plugins')) require_once ABSPATH . 'wp-admin/includes/plugin.php';
        foreach (array_keys(get_plugins()) as $file) {
            $s = dirname($file) === '.' ? basename($file, '.php') : dirname($file);
            if ($s === $slug) return $file;
        }
        return null;
    }
}
