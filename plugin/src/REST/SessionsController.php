<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use WP_REST_Request;
use WP_REST_Server;

final class SessionsController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/sessions/start', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'start'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/sessions/(?P<id>[A-Za-z0-9_-]+)/end', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'end'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/pages/(?P<id>\d+)/iteration-context', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'iterationContext'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    public function start(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $body = $req->get_json_params();
            $user = wp_get_current_user();
            $id = Container::get('sessions')->start(
                (string) ($body['agent'] ?? 'unknown'),
                $body['agent_version'] ?? null,
                $body['intent'] ?? null,
                $body['user_facing_label'] ?? null,
                $user instanceof \WP_User ? (int) $user->ID : 0
            );
            return $this->ok(['session_id' => $id]);
        });
    }

    public function end(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            Container::get('sessions')->end((string) $req->get_param('id'));
            return $this->ok(['ended' => true]);
        });
    }

    public function iterationContext(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $pageId = (int) $req->get_param('id');
            global $wpdb;
            $recentPlans = $wpdb->get_results($wpdb->prepare(
                "SELECT id, intent, status, approval_at, executed_at FROM {$wpdb->prefix}joist_plans
                 WHERE page_id = %d ORDER BY created_at DESC LIMIT 10",
                $pageId
            ), ARRAY_A) ?: [];
            $recentHuman = Container::get('audit')->query([
                'post_id' => $pageId,
                'actor_type' => 'human',
                'from' => date('Y-m-d H:i:s', time() - 7 * 86400),
            ], 20);
            $backlog = $wpdb->get_results($wpdb->prepare(
                "SELECT id, intent, priority, created_at FROM {$wpdb->prefix}joist_backlog
                 WHERE page_id = %d AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 20",
                $pageId
            ), ARRAY_A) ?: [];

            return $this->ok([
                'page_id' => $pageId,
                'recent_plans' => $recentPlans,
                'recent_human_edits' => $recentHuman,
                'open_backlog' => $backlog,
            ]);
        });
    }
}
