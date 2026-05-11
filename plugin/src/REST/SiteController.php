<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Elementor\WidgetCatalog;
use WP_REST_Request;
use WP_REST_Server;

/**
 * GET /joist/v1/site — site identity, plugin status, runtime env.
 * Used by the agent (or CLI doctor) at session start to know what stack
 * it's talking to.
 *
 * v0.1 M0: minimal shape. v0.5 adds layout_mode autodetect, host adapter
 * detection (SiteGround / Kinsta / WPE / Cloudways), operating mode,
 * dynamic tag count, etc.
 */
final class SiteController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/site', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'getSite'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);

        register_rest_route(self::NAMESPACE, '/widgets', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'listWidgets'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    public function getSite(WP_REST_Request $request)
    {
        try {
            $catalog = new WidgetCatalog();

            $payload = [
                'site' => [
                    'url' => home_url(),
                    'title' => get_bloginfo('name'),
                    'tagline' => get_bloginfo('description'),
                    'language' => get_locale(),
                    'timezone' => wp_timezone_string(),
                ],
                'wordpress' => [
                    'version' => get_bloginfo('version'),
                    'multisite' => is_multisite(),
                    'https' => is_ssl(),
                ],
                'theme' => [
                    'slug' => get_stylesheet(),
                    'name' => wp_get_theme()->get('Name'),
                    'version' => wp_get_theme()->get('Version'),
                ],
                'elementor' => [
                    'version' => defined('ELEMENTOR_VERSION') ? ELEMENTOR_VERSION : null,
                    'pro' => [
                        'present' => defined('ELEMENTOR_PRO_VERSION'),
                        'version' => defined('ELEMENTOR_PRO_VERSION') ? ELEMENTOR_PRO_VERSION : null,
                    ],
                    'registered_widget_count' => count($catalog->listAll()),
                ],
                'plugin' => [
                    'name' => 'Joist',
                    'version' => JOIST_VERSION,
                    'status' => 'v0.1-alpha-m0-spike',
                    'db_version' => (int) get_option('joist_db_version', 0),
                ],
            ];

            return $this->ok($payload);
        } catch (\Throwable $e) {
            return $this->errorResponse($e);
        }
    }

    public function listWidgets(WP_REST_Request $request)
    {
        try {
            $catalog = new WidgetCatalog();
            return $this->ok(['widgets' => $catalog->listAll()]);
        } catch (\Throwable $e) {
            return $this->errorResponse($e);
        }
    }
}
