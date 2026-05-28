<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use WP_REST_Request;
use WP_REST_Server;

/**
 * GET /joist/v1/site — site identity, plugin status, runtime env.
 * Plus /site/flush-cache and /elementor/refresh-layout-mode.
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
        register_rest_route(self::NAMESPACE, '/site/flush-cache', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'flushCache'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/elementor/refresh-layout-mode', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'refreshLayoutMode'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/site/regenerate-css', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'regenerateCss'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    public function getSite(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function () {
            $catalog = Container::get('catalog');
            $dynamicTags = Container::get('dynamicTags');
            $layoutMode = Container::get('layoutMode')->current();
            $opMode = Container::get('opMode')->current();
            $host = Container::get('hostDetector')->detect();
            $cacheAdapters = Container::get('cacheFlusher')->detectedAdapters();

            // Platform-feature detection (WP 7.0 Connectors API + family).
            // See specs/ARCHITECTURE.md §7a.
            $platform = class_exists(\Joist\Platform\PlatformBootstrap::class)
                ? \Joist\Platform\PlatformBootstrap::platform()
                : ['version' => get_bloginfo('version'), 'supports_connectors_api' => false, 'supports_dataviews' => false, 'supports_client_side_abilities' => false];

            $connectorDescriptor = null;
            $connectorRegistered = false;
            if (class_exists(\Joist\Platform\JoistConnector::class)) {
                $connector = new \Joist\Platform\JoistConnector();
                $connectorDescriptor = $connector->descriptor();
                // Ask core whether our connector landed in the registry.
                if (function_exists('wp_is_connector_registered')) {
                    $connectorRegistered = (bool) wp_is_connector_registered(\Joist\Platform\JoistConnector::CONNECTOR_ID);
                }
            }

            return $this->ok([
                'site' => [
                    'url' => home_url(),
                    'title' => get_bloginfo('name'),
                    'tagline' => get_bloginfo('description'),
                    'language' => get_locale(),
                    'timezone' => wp_timezone_string(),
                    'permalink_structure' => get_option('permalink_structure'),
                ],
                'wordpress' => [
                    'version' => get_bloginfo('version'),
                    'multisite' => is_multisite(),
                    'https' => is_ssl(),
                    'platform' => $platform,
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
                    'registered_dynamic_tag_count' => count($dynamicTags->listAll()),
                    'layout_mode' => $layoutMode['mode'] ?? 'unknown',
                    'layout_mode_confidence' => $layoutMode['confidence'] ?? null,
                    // Wave 3 (2026-05-28): V3/V4 routing decision. The single
                    // source of truth for "can we write to this Elementor?"
                    // See specs/ARCHITECTURE.md §7b "Elementor V3/V4 routing".
                    'routing' => class_exists(\Joist\Elementor\VersionRouter::class)
                        ? \Joist\Elementor\VersionRouter::detect()->toArray()
                        : null,
                ],
                'operating_mode' => [
                    'mode' => $opMode['mode'],
                    'expires_at' => $opMode['expires_at'],
                    'staging_mandatory' => (bool) $opMode['staging_mandatory'],
                ],
                'hosting' => [
                    'host' => $host['host'],
                    'plan' => $host['plan'],
                    'php_version' => PHP_VERSION,
                    'notes' => $host['notes'],
                    'cache_adapters' => $cacheAdapters,
                ],
                'plugin' => [
                    'name' => 'Joist',
                    'version' => JOIST_VERSION,
                    'db_version' => (int) get_option('joist_db_version', 0),
                    'activation_error' => get_option('joist_activation_error', null),
                    'connector' => [
                        'registered' => $connectorRegistered,
                        'descriptor' => $connectorDescriptor,
                    ],
                ],
            ]);
        });
    }

    public function flushCache(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $body = $req->get_json_params();
            $scope = (string) ($body['scope'] ?? 'all');
            $pageId = (int) ($body['page_id'] ?? 0);

            $flusher = Container::get('cacheFlusher');
            $regen = Container::get('cssRegen');
            if ($scope === 'page' && $pageId > 0) {
                $regen->regenerate($pageId);
                $flusher->flushPage($pageId);
            } else {
                $regen->regenAll();
                $flusher->flushSite();
            }
            return $this->ok(['flushed' => true, 'scope' => $scope]);
        });
    }

    public function regenerateCss(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $body = $req->get_json_params();
            $scope = (string) ($body['scope'] ?? 'all');
            $regen = Container::get('cssRegen');
            match ($scope) {
                'page' => $regen->regenPost((int) ($body['page_id'] ?? 0)),
                'global' => $regen->regenGlobal(),
                'kit' => $regen->regenCustom(),
                default => $regen->regenAll(),
            };
            return $this->ok(['regenerated' => true, 'scope' => $scope]);
        });
    }

    public function refreshLayoutMode(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function () {
            $result = Container::get('layoutMode')->refresh();
            return $this->ok($result);
        });
    }
}
