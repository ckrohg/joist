<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use WP_REST_Request;
use WP_REST_Server;

/**
 * /joist/v1/kit — global colors, fonts, typography + match-color helper.
 *
 * v0.5: read kit settings + match-color. Kit import/export .zip is v0.7
 * (requires Elementor's import/export module which we don't safely drive
 * without runtime testing).
 */
final class KitController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/kit', [
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'get'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::EDITABLE, 'callback' => [$this, 'update'], 'permission_callback' => [$this, 'permissionsCheck']],
        ]);
        register_rest_route(self::NAMESPACE, '/kit/match-color', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'matchColor'], 'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    public function get(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function () {
            if (!class_exists('\Elementor\Plugin')) throw new WriteException('elementor.missing', 'Elementor not active.', 503);
            $kits = \Elementor\Plugin::$instance->kits_manager;
            $kitId = (int) $kits->get_active_id();
            if ($kitId <= 0) throw new WriteException('not_found.kit', 'No active kit.', 404);
            $document = \Elementor\Plugin::$instance->documents->get($kitId);
            $settings = $document && method_exists($document, 'get_settings') ? $document->get_settings() : [];
            return $this->ok([
                'id' => $kitId,
                'hash' => Container::get('hasher')->forElements(['kit_settings' => $settings]),
                'settings' => $settings,
            ]);
        });
    }

    public function update(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $body = $req->get_json_params();
            $newSettings = is_array($body['settings'] ?? null) ? $body['settings'] : [];

            // PolicyGuard: refuse zeroing the color palette.
            if (isset($newSettings['system_colors']) && is_array($newSettings['system_colors'])) {
                $allEmpty = true;
                foreach ($newSettings['system_colors'] as $c) {
                    if (!empty($c['color'])) { $allEmpty = false; break; }
                }
                if ($allEmpty) {
                    Container::get('policy')->assertAllowed('kit.zero_colors', [], wp_get_current_user());
                }
            }

            $kits = \Elementor\Plugin::$instance->kits_manager;
            $kitId = (int) $kits->get_active_id();
            $document = \Elementor\Plugin::$instance->documents->get($kitId);
            if (!$document) throw new WriteException('not_found.kit', 'No active kit.', 404);

            $existing = method_exists($document, 'get_settings') ? $document->get_settings() : [];
            $merged = array_replace_recursive(is_array($existing) ? $existing : [], $newSettings);
            $document->save(['settings' => $merged]);

            // Kit changed → regen global + custom CSS, flush site cache.
            wp_schedule_single_event(time() + 1, 'joist_post_save_verify', [$kitId]);
            Container::get('cssRegen')->regenAll();

            return $this->ok(['id' => $kitId, 'updated' => true]);
        });
    }

    public function matchColor(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $body = $req->get_json_params();
            $hex = (string) ($body['hex'] ?? '');
            $match = Container::get('globals')->matchColor($hex);
            return $this->ok($match ?? ['global_ref' => null, 'delta_e' => null, 'match_quality' => 'no_match']);
        });
    }
}
