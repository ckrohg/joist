<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * /joist/v1/audit-log — query + summary + client-facing report formats.
 */
final class AuditLogController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/audit-log', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'query'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/audit-log/summary', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'summary'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    public function query(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $filters = array_filter([
                'session_id' => $req->get_param('session_id'),
                'post_id' => $req->get_param('post_id'),
                'actor_type' => $req->get_param('actor'),
                'op' => $req->get_param('op'),
                'from' => $this->periodFrom($req->get_param('period'), $req->get_param('from')),
                'to' => $this->periodTo($req->get_param('period'), $req->get_param('to')),
            ]);
            $limit = min(500, (int) ($req->get_param('limit') ?: 100));
            $entries = Container::get('audit')->query($filters, $limit);

            $format = (string) ($req->get_param('format') ?: 'json');
            if ($format === 'csv') {
                return $this->csvResponse($entries);
            }
            if ($format === 'html') {
                return $this->htmlResponse($entries, (string) $req->get_param('period'));
            }
            return $this->ok(['entries' => $entries]);
        });
    }

    public function summary(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $period = (string) ($req->get_param('period') ?: 'last-30-days');
            $from = $this->periodFrom($period, null);
            $entries = Container::get('audit')->query(array_filter(['from' => $from]), 1000);
            $aiCount = 0; $humanCount = 0; $pages = [];
            $intents = [];
            foreach ($entries as $e) {
                if ($e['actor_type'] === 'agent') $aiCount++;
                elseif ($e['actor_type'] === 'human') $humanCount++;
                if (!empty($e['post_id'])) $pages[$e['post_id']] = true;
                if (!empty($e['intent'])) $intents[$e['intent']] = ($intents[$e['intent']] ?? 0) + 1;
            }
            arsort($intents);
            $total = $aiCount + $humanCount;
            return $this->ok([
                'period' => $period,
                'total_edits' => $total,
                'ai_edits' => $aiCount,
                'human_edits' => $humanCount,
                'ai_percent' => $total > 0 ? round($aiCount / $total * 100, 1) : 0,
                'pages_affected' => count($pages),
                'top_intents' => array_slice(array_map(fn($k, $v) => ['intent' => $k, 'count' => $v], array_keys($intents), array_values($intents)), 0, 10),
            ]);
        });
    }

    private function csvResponse(array $entries): WP_REST_Response
    {
        $lines = ['timestamp,op,post_id,actor_type,actor_id,intent'];
        foreach ($entries as $e) {
            $lines[] = sprintf('%s,%s,%s,%s,%s,"%s"',
                $e['timestamp'], $e['op'], $e['post_id'] ?? '', $e['actor_type'], $e['actor_id'] ?? '',
                str_replace('"', '""', (string) ($e['intent'] ?? ''))
            );
        }
        $response = new WP_REST_Response(implode("\n", $lines), 200);
        $response->header('Content-Type', 'text/csv');
        return $response;
    }

    private function htmlResponse(array $entries, string $period): WP_REST_Response
    {
        $rows = '';
        foreach ($entries as $e) {
            $badge = $e['actor_type'] === 'agent' ? 'AI' : ($e['actor_type'] === 'human' ? 'Human' : 'System');
            $rows .= sprintf(
                '<tr><td>%s</td><td><span class="badge %s">%s</span></td><td>%s</td><td>%s</td></tr>',
                esc_html($e['timestamp']),
                strtolower($badge),
                esc_html($badge),
                $e['post_id'] ? esc_html(get_the_title((int) $e['post_id']) ?: ('#' . $e['post_id'])) : '—',
                esc_html((string) ($e['intent'] ?? $e['op']))
            );
        }
        $html = "<!doctype html><html><head><meta charset='utf-8'><title>Activity report — " . esc_html($period) . "</title>"
            . "<style>body{font-family:system-ui;max-width:800px;margin:2rem auto;color:#1a1a1a}"
            . "h1{font-size:1.5rem}table{width:100%;border-collapse:collapse;margin-top:1rem}"
            . "td{padding:.5rem;border-bottom:1px solid #eee;font-size:.875rem}.badge{padding:.125rem .5rem;border-radius:.25rem;font-size:.75rem;font-weight:600}"
            . ".badge.ai{background:#e8f5e9;color:#2e7d32}.badge.human{background:#e3f2fd;color:#1565c0}.badge.system{background:#f5f5f5;color:#616161}</style></head>"
            . "<body><h1>Site activity — " . esc_html($period) . "</h1><p>" . count($entries) . " edits recorded.</p>"
            . "<table>{$rows}</table><p style='margin-top:2rem;color:#888;font-size:.75rem'>Generated by Joist.</p></body></html>";
        $response = new WP_REST_Response($html, 200);
        $response->header('Content-Type', 'text/html');
        return $response;
    }

    private function periodFrom(?string $period, ?string $explicitFrom): ?string
    {
        if ($explicitFrom) return $explicitFrom;
        if (!$period) return null;
        if ($period === 'last-30-days') return date('Y-m-d H:i:s', time() - 30 * 86400);
        if (preg_match('/^(\d{4})-(\d{2})$/', $period, $m)) return "{$m[1]}-{$m[2]}-01 00:00:00";
        return null;
    }

    private function periodTo(?string $period, ?string $explicitTo): ?string
    {
        if ($explicitTo) return $explicitTo;
        if ($period && preg_match('/^(\d{4})-(\d{2})$/', $period, $m)) {
            return date('Y-m-t 23:59:59', strtotime("{$m[1]}-{$m[2]}-01"));
        }
        return null;
    }
}
