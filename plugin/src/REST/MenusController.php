<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Elementor\WriteException;
use WP_REST_Request;
use WP_REST_Server;

/**
 * /joist/v1/menus — basic nav-menu CRUD. v0.5 covers list + create + items;
 * deeper nesting + locations management is v0.7.
 */
final class MenusController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/menus', [
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'list'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'create'], 'permission_callback' => [$this, 'permissionsCheck']],
        ]);
    }

    public function list(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function () {
            $menus = wp_get_nav_menus();
            $locations = get_nav_menu_locations();
            $out = [];
            foreach ($menus as $menu) {
                $items = wp_get_nav_menu_items($menu->term_id) ?: [];
                $out[] = [
                    'id' => $menu->term_id,
                    'name' => $menu->name,
                    'slug' => $menu->slug,
                    'locations' => array_keys(array_filter($locations, fn($id) => $id === $menu->term_id)),
                    'item_count' => count($items),
                    'items' => array_map(fn($it) => [
                        'id' => $it->ID, 'title' => $it->title, 'url' => $it->url,
                        'type' => $it->type, 'object_id' => $it->object_id, 'parent' => $it->menu_item_parent,
                    ], $items),
                ];
            }
            return $this->ok(['menus' => $out]);
        });
    }

    public function create(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $body = $req->get_json_params();
            $name = sanitize_text_field($body['name'] ?? 'New Menu');
            $menuId = wp_create_nav_menu($name);
            if (is_wp_error($menuId)) throw new WriteException('wp.menu_create_failed', $menuId->get_error_message(), 500);

            $items = is_array($body['items'] ?? null) ? $body['items'] : [];
            foreach ($items as $item) {
                $type = $item['type'] ?? 'custom';
                $args = [
                    'menu-item-title' => sanitize_text_field($item['title'] ?? ''),
                    'menu-item-status' => 'publish',
                ];
                if ($type === 'custom') {
                    $args['menu-item-url'] = esc_url_raw($item['url'] ?? '#');
                    $args['menu-item-type'] = 'custom';
                } elseif (in_array($type, ['post_type', 'page'], true)) {
                    $args['menu-item-object'] = $item['object'] ?? 'page';
                    $args['menu-item-object-id'] = (int) ($item['object_id'] ?? 0);
                    $args['menu-item-type'] = 'post_type';
                } elseif ($type === 'post_type_archive') {
                    $args['menu-item-object'] = $item['object'] ?? 'post';
                    $args['menu-item-type'] = 'post_type_archive';
                }
                wp_update_nav_menu_item($menuId, 0, $args);
            }

            $locations = is_array($body['locations'] ?? null) ? $body['locations'] : [];
            if (!empty($locations)) {
                $current = get_nav_menu_locations();
                foreach ($locations as $loc) {
                    $current[$loc] = $menuId;
                }
                set_theme_mod('nav_menu_locations', $current);
            }

            return $this->ok(['id' => $menuId, 'name' => $name], 201);
        });
    }
}
