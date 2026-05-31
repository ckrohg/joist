<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Elementor\WriteException;
use WP_REST_Request;
use WP_REST_Server;

/**
 * /joist/v1/settings — admin-only configuration surface.
 *
 * Today this is small (just the Claude API key + connectivity test) but it
 * exists so users never have to drop to SSH or edit wp-config.php to get the
 * AI features working. Future settings (default model, cost cap, brand
 * presets) bolt onto this same controller.
 *
 * Security:
 *   - All write/test endpoints require manage_options (permissionsAdmin).
 *   - Reads are gated to manage_options too — we never echo the secret back,
 *     only a `configured: bool`, `source: env|option|none`, and a masked tail.
 *
 * The key is stored in the `joist_claude_api_key` wp_option. We never store
 * it as autoload=yes (would be loaded into memory on every WP request even
 * when not needed); explicit add_option with autoload=no for first writes.
 */
final class SettingsController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/settings', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'get'],
            'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
        register_rest_route(self::NAMESPACE, '/settings/claude-key', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'setClaudeKey'],
            'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
        register_rest_route(self::NAMESPACE, '/settings/claude-key', [
            'methods' => 'DELETE',
            'callback' => [$this, 'deleteClaudeKey'],
            'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
        register_rest_route(self::NAMESPACE, '/settings/claude-key/test', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'testClaudeKey'],
            'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
    }

    /**
     * GET /settings — return a redacted snapshot of Joist's configuration.
     *
     * Never echoes the API key. Returns `source` (`env` if the env var is set,
     * `option` if the wp_option is set, `none` otherwise) and `tail` (last 4
     * chars of the key, useful for the user to confirm which key is active).
     */
    public function get(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function () {
            return $this->ok(['claude_key' => $this->claudeKeyStatus()]);
        });
    }

    /**
     * POST /settings/claude-key — save the Claude API key.
     *
     * Body: { key: string }. We do minimal shape validation (prefix `sk-`
     * is conventional for Anthropic; reject obviously-wrong values).
     */
    public function setClaudeKey(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $body = $req->get_json_params();
            $key = trim((string) ($body['key'] ?? ''));
            if ($key === '') {
                throw new WriteException('validation.key_required', 'key is required.', 422);
            }
            if (strlen($key) < 20 || strlen($key) > 200) {
                throw new WriteException('validation.key_shape', 'Key length looks wrong (expected 20-200 chars).', 422);
            }
            if (!preg_match('/^[A-Za-z0-9_-]+$/', $key)) {
                throw new WriteException('validation.key_shape', 'Key contains characters that look wrong for an Anthropic API key.', 422);
            }
            // autoload=no so it's not in memory on every WP request.
            if (get_option('joist_claude_api_key', null) === null) {
                add_option('joist_claude_api_key', $key, '', 'no');
            } else {
                update_option('joist_claude_api_key', $key, false);
            }
            return $this->ok(['claude_key' => $this->claudeKeyStatus()]);
        });
    }

    /** DELETE /settings/claude-key — remove the wp_option (env-set keys still apply). */
    public function deleteClaudeKey(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function () {
            delete_option('joist_claude_api_key');
            return $this->ok(['claude_key' => $this->claudeKeyStatus()]);
        });
    }

    /**
     * POST /settings/claude-key/test — make a minimal Anthropic call to verify
     * the configured key works. Returns latency + the model echo on success,
     * or a typed error if Anthropic rejects.
     */
    public function testClaudeKey(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function () {
            $status = $this->claudeKeyStatus();
            if (!$status['configured']) {
                throw new WriteException('settings.no_key', 'No Claude API key is configured.', 422);
            }
            $key = $this->loadKey();
            $started = microtime(true);
            $resp = wp_remote_post('https://api.anthropic.com/v1/messages', [
                'timeout' => 15,
                'headers' => [
                    'content-type' => 'application/json',
                    'x-api-key' => $key,
                    'anthropic-version' => '2023-06-01',
                ],
                'body' => wp_json_encode([
                    'model' => 'claude-haiku-4-5-20251001',
                    'max_tokens' => 8,
                    'messages' => [['role' => 'user', 'content' => 'Reply OK.']],
                ]),
            ]);
            $elapsedMs = (int) round((microtime(true) - $started) * 1000);

            if (is_wp_error($resp)) {
                throw new WriteException('settings.transport_failed', $resp->get_error_message(), 502);
            }
            $code = (int) wp_remote_retrieve_response_code($resp);
            $raw = (string) wp_remote_retrieve_body($resp);
            if ($code === 401) {
                throw new WriteException('settings.key_invalid', 'Anthropic rejected the key (401).', 401, ['anthropic_status' => 401]);
            }
            if ($code !== 200) {
                throw new WriteException('settings.api_error', "Anthropic returned HTTP {$code}.", 502, ['anthropic_status' => $code, 'body_head' => mb_substr($raw, 0, 200)]);
            }
            return $this->ok([
                'ok' => true,
                'latency_ms' => $elapsedMs,
                'model' => 'claude-haiku-4-5-20251001',
            ]);
        });
    }

    /** Internal — read the live key (env wins). */
    private function loadKey(): string
    {
        $env = getenv('JOIST_CLAUDE_API_KEY');
        if (is_string($env) && $env !== '') return trim($env);
        $opt = get_option('joist_claude_api_key', '');
        return is_string($opt) ? trim($opt) : '';
    }

    /**
     * Redacted status snapshot — never includes the raw key.
     *
     * @return array{configured: bool, source: string, tail: string|null}
     */
    private function claudeKeyStatus(): array
    {
        $env = getenv('JOIST_CLAUDE_API_KEY');
        if (is_string($env) && $env !== '') {
            return ['configured' => true, 'source' => 'env', 'tail' => $this->tail($env)];
        }
        $opt = get_option('joist_claude_api_key', '');
        if (is_string($opt) && $opt !== '') {
            return ['configured' => true, 'source' => 'option', 'tail' => $this->tail($opt)];
        }
        return ['configured' => false, 'source' => 'none', 'tail' => null];
    }

    private function tail(string $key): string
    {
        $key = trim($key);
        if (strlen($key) <= 4) return '****';
        return '…' . substr($key, -4);
    }
}
