<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\MCP\Server;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * @purpose WordPress REST route → Joist MCP server bridge.
 *
 * Exposes two endpoints under /wp-json/joist-mcp/v1/:
 *   POST /messages — JSON-RPC request/response (the synchronous tool-call path)
 *   GET  /messages — Streamable HTTP server→client stream (we return an empty
 *                    text/event-stream so spec-compliant clients can connect
 *                    without hanging; we never push server-initiated messages)
 *
 * Auth model: any logged-in WordPress user (read capability minimum) can
 * connect, and per-tool capability checks live inside MCP\Tools. Application
 * Passwords work out of the box via WP's existing Basic Auth handling — no
 * custom token scheme.
 *
 * Why a separate namespace from /joist/v1/: keeping the MCP surface isolated
 * means we can evolve the wire format / protocol-version independently of
 * the public REST API, and it makes the URL Claude Code is given visually
 * distinct (joist-mcp vs joist).
 */
final class McpController
{
    public const NAMESPACE = 'joist-mcp/v1';

    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/messages', [
            [
                'methods' => WP_REST_Server::CREATABLE,
                'callback' => [$this, 'post'],
                'permission_callback' => [$this, 'permissionsCheck'],
            ],
            [
                'methods' => WP_REST_Server::READABLE,
                'callback' => [$this, 'get'],
                'permission_callback' => [$this, 'permissionsCheck'],
            ],
        ]);

        // Discovery: GET /wp-json/joist-mcp/v1/info returns a small advertisement
        // of server identity + endpoint URL. We register at /info (not /) to
        // avoid colliding with WP's auto-generated REST namespace-index route.
        register_rest_route(self::NAMESPACE, '/info', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'discovery'],
            'permission_callback' => '__return_true',
        ]);
    }

    /**
     * Minimum auth: must be a logged-in WP user. Per-tool capability
     * enforcement lives in MCP\Tools::requireCap.
     */
    public function permissionsCheck(WP_REST_Request $req): bool|WP_Error
    {
        if (!is_user_logged_in()) {
            return new WP_Error(
                'rest_forbidden',
                'Authentication required (use an Application Password).',
                ['status' => 401]
            );
        }
        return true;
    }

    public function discovery(WP_REST_Request $req): WP_REST_Response
    {
        return new WP_REST_Response([
            'name' => Server::SERVER_NAME,
            'protocolVersion' => Server::PROTOCOL_VERSION,
            'version' => defined('JOIST_VERSION') ? JOIST_VERSION : 'unknown',
            'endpoints' => [
                'messages' => rest_url(self::NAMESPACE . '/messages'),
            ],
            'transports' => ['streamable_http'],
            'notes' => 'Authenticate via Basic Auth with a WordPress Application Password.',
        ], 200);
    }

    /**
     * POST /messages — JSON-RPC dispatch.
     *
     * Accepts either a single envelope or a batch (array). Returns 200 with
     * the response envelope(s), or 202 No Content when the request was purely
     * notifications (no response payload).
     */
    public function post(WP_REST_Request $req): WP_REST_Response
    {
        $body = $req->get_json_params();
        if (!is_array($body)) {
            // Malformed JSON or non-JSON body — return a JSON-RPC parse error.
            return new WP_REST_Response([
                'jsonrpc' => '2.0',
                'id' => null,
                'error' => ['code' => -32700, 'message' => 'Parse error: JSON body required.'],
            ], 400);
        }

        $server = new Server();

        // Batch vs single envelope.
        $isBatch = isset($body[0]) && is_array($body[0]);
        if ($isBatch) {
            $responses = $server->handleBatch($body);
            if ($responses === null) {
                return new WP_REST_Response(null, 202);
            }
            return new WP_REST_Response($responses, 200);
        }

        $response = $server->handle($body);
        if ($response === null) {
            // Notification — per JSON-RPC 2.0 we MUST NOT respond.
            return new WP_REST_Response(null, 202);
        }
        return new WP_REST_Response($response, 200);
    }

    /**
     * GET /messages — Streamable HTTP server-stream half.
     *
     * MCP spec requires the same endpoint accept GET with Accept: text/event-stream
     * for server-initiated messages. Joist never pushes server-initiated messages
     * (all our tool calls are synchronous request/response), so we return an
     * empty stream + comment line so the client connection succeeds without
     * hanging waiting for events.
     *
     * Some clients fall back to long-polling on the POST endpoint if the GET
     * is unavailable; for those we'd be invisible. For Claude Code we just
     * need the connection to succeed.
     */
    public function get(WP_REST_Request $req): WP_REST_Response
    {
        $response = new WP_REST_Response('', 200);
        $response->header('Content-Type', 'text/event-stream');
        $response->header('Cache-Control', 'no-cache, no-transform');
        $response->header('X-Accel-Buffering', 'no');
        // Empty body — just a comment line so the stream is technically valid.
        $response->set_data(": joist-mcp idle\n\n");
        return $response;
    }
}
