<?php
declare(strict_types=1);

namespace Joist\Webhooks;

use Joist\Elementor\WriteException;
use Joist\Security\URLValidator;

final class WebhookStore
{
    public function __construct(private URLValidator $urlValidator) {}

    public function register(string $url, array $events): array
    {
        // Constraint #21 — validate URL at registration.
        $this->urlValidator->validateExternal($url);

        $secret = bin2hex(random_bytes(32));

        global $wpdb;
        $wpdb->insert($wpdb->prefix . 'joist_webhooks', [
            'url' => $url,
            'secret' => $secret,
            'events' => (string) wp_json_encode($events),
            'active' => 1,
            'created_at' => date('Y-m-d H:i:s'),
            'failure_count' => 0,
        ]);

        return [
            'id' => (int) $wpdb->insert_id,
            'url' => $url,
            'secret' => $secret,
            'events' => $events,
        ];
    }

    public function list(): array
    {
        global $wpdb;
        $rows = $wpdb->get_results("SELECT id, url, events, active, last_success, last_failure, failure_count FROM {$wpdb->prefix}joist_webhooks", ARRAY_A);
        if (!$rows) return [];
        foreach ($rows as &$row) {
            $row['events'] = json_decode($row['events'] ?? '[]', true) ?: [];
        }
        return $rows;
    }

    public function delete(int $id): void
    {
        global $wpdb;
        $wpdb->delete($wpdb->prefix . 'joist_webhooks', ['id' => $id]);
    }

    public function rotateSecret(int $id): string
    {
        global $wpdb;
        $newSecret = bin2hex(random_bytes(32));
        $existing = $wpdb->get_row(
            $wpdb->prepare("SELECT secret FROM {$wpdb->prefix}joist_webhooks WHERE id = %d", $id),
            ARRAY_A
        );
        if ($existing === null) {
            throw new WriteException('not_found.webhook', "Webhook {$id} not found.", 404);
        }
        $wpdb->update(
            $wpdb->prefix . 'joist_webhooks',
            [
                'secret' => $newSecret,
                'secret_previous' => $existing['secret'],
                'secret_rotated_at' => date('Y-m-d H:i:s'),
            ],
            ['id' => $id]
        );
        return $newSecret;
    }

    public function recordFailure(int $id): void
    {
        global $wpdb;
        $table = $wpdb->prefix . 'joist_webhooks';
        $wpdb->query($wpdb->prepare(
            "UPDATE {$table} SET failure_count = failure_count + 1, last_failure = %s,
                                  active = IF(failure_count >= 10, 0, active)
             WHERE id = %d",
            date('Y-m-d H:i:s'),
            $id
        ));
    }

    public function recordSuccess(int $id): void
    {
        global $wpdb;
        $wpdb->update(
            $wpdb->prefix . 'joist_webhooks',
            ['last_success' => date('Y-m-d H:i:s'), 'failure_count' => 0],
            ['id' => $id]
        );
    }
}
