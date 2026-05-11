<?php
declare(strict_types=1);

namespace Joist\Webhooks;

use Joist\Security\URLValidator;

/**
 * Webhook emission with HMAC-SHA256 signing + DNS rebinding defense +
 * circuit breaker.
 *
 * All emissions are scheduled via wp_schedule_single_event (constraint #17 —
 * never inline wp_remote_post in REST handler hot path).
 */
final class WebhookEmitter
{
    public const HOOK = 'joist_webhook_dispatch';

    public function __construct(
        private WebhookStore $store,
        private URLValidator $urlValidator,
    ) {}

    /**
     * Queue an event for async emission.
     */
    public function emit(string $event, array $data): void
    {
        $payload = [
            'event' => $event,
            'timestamp' => date('c'),
            'data' => $data,
        ];
        wp_schedule_single_event(time() + 1, self::HOOK, [$event, $payload]);
    }

    /**
     * Cron handler. Iterates active webhooks subscribed to this event and POSTs.
     */
    public function dispatch(string $event, array $payload): void
    {
        $payloadJson = (string) wp_json_encode($payload);
        $webhooks = $this->store->list();

        foreach ($webhooks as $webhook) {
            if (empty($webhook['active'])) continue;
            $events = (array) ($webhook['events'] ?? []);
            if (!in_array($event, $events, true) && !in_array('*', $events, true)) {
                continue;
            }

            try {
                // Re-validate URL at emission (DNS rebinding defense).
                $this->urlValidator->validateExternal($webhook['url']);

                $secret = $this->fetchSecret((int) $webhook['id']);
                $timestamp = (string) time();
                $signature = hash_hmac('sha256', $timestamp . '.' . $payloadJson, $secret);

                $response = wp_remote_post($webhook['url'], [
                    'timeout' => 5,
                    'redirection' => 0,
                    'sslverify' => true,
                    'headers' => [
                        'Content-Type' => 'application/json',
                        'X-Joist-Signature' => 'sha256=' . $signature,
                        'X-Joist-Timestamp' => $timestamp,
                        'X-Joist-Event' => $event,
                    ],
                    'body' => $payloadJson,
                ]);

                if (is_wp_error($response)) {
                    $this->store->recordFailure((int) $webhook['id']);
                    continue;
                }
                $code = (int) wp_remote_retrieve_response_code($response);
                if ($code >= 200 && $code < 300) {
                    $this->store->recordSuccess((int) $webhook['id']);
                } else {
                    $this->store->recordFailure((int) $webhook['id']);
                }
            } catch (\Throwable $e) {
                $this->store->recordFailure((int) $webhook['id']);
            }
        }
    }

    private function fetchSecret(int $id): string
    {
        global $wpdb;
        $row = $wpdb->get_row(
            $wpdb->prepare("SELECT secret FROM {$wpdb->prefix}joist_webhooks WHERE id = %d", $id),
            ARRAY_A
        );
        return (string) ($row['secret'] ?? '');
    }
}
