<?php
declare(strict_types=1);

namespace Joist\MCP;

/**
 * @purpose JSON-RPC 2.0 dispatcher for Joist's MCP server.
 *
 * Implements the Model Context Protocol (https://modelcontextprotocol.io) over
 * Streamable HTTP transport so any MCP client (Claude Code, Cursor, Continue,
 * custom agents) can use Joist's page-build / clone / approve / execute
 * capabilities as native tool calls — no Anthropic API key required.
 *
 * Why Streamable HTTP and not SSE: PHP-FPM is hostile to long-lived
 * connections. Streamable HTTP only requires synchronous POST/response for
 * the tool-call use case Joist needs (we never need to push server-initiated
 * messages to the client). Clients that demand the GET-stream half can still
 * connect — they'll just get an empty `text/event-stream` and fall back.
 *
 * Auth is delegated entirely to WordPress: callers authenticate via
 * Application Passwords (Basic Auth), and each tool's permission check uses
 * `current_user_can()`. No custom token scheme.
 */
final class Server
{
    public const PROTOCOL_VERSION = '2025-03-26';
    public const SERVER_NAME = 'joist-mcp';

    private Tools $tools;

    public function __construct(?Tools $tools = null)
    {
        $this->tools = $tools ?? new Tools();
    }

    /**
     * Handle a single JSON-RPC request envelope (or notification).
     *
     * @param array<string, mixed> $request Parsed JSON-RPC request body.
     * @return array<string, mixed>|null    Response envelope, or null for notifications.
     */
    public function handle(array $request): ?array
    {
        $jsonrpc = (string) ($request['jsonrpc'] ?? '');
        if ($jsonrpc !== '2.0') {
            return $this->errorResponse($request['id'] ?? null, -32600, 'Invalid Request: jsonrpc must be "2.0"');
        }

        $method = (string) ($request['method'] ?? '');
        $id = $request['id'] ?? null;
        $params = is_array($request['params'] ?? null) ? $request['params'] : [];

        // Notifications have no `id` field and never get a response.
        $isNotification = !array_key_exists('id', $request);

        try {
            switch ($method) {
                case 'initialize':
                    return $this->result($id, [
                        'protocolVersion' => self::PROTOCOL_VERSION,
                        'capabilities' => [
                            'tools' => new \stdClass(),
                        ],
                        'serverInfo' => [
                            'name' => self::SERVER_NAME,
                            'version' => defined('JOIST_VERSION') ? JOIST_VERSION : 'unknown',
                        ],
                    ]);

                case 'notifications/initialized':
                case 'notifications/cancelled':
                    return null; // notifications acknowledged silently

                case 'ping':
                    return $this->result($id, new \stdClass());

                case 'tools/list':
                    return $this->result($id, ['tools' => $this->tools->schemas()]);

                case 'tools/call':
                    $name = (string) ($params['name'] ?? '');
                    $args = is_array($params['arguments'] ?? null) ? $params['arguments'] : [];
                    if ($name === '') {
                        return $this->errorResponse($id, -32602, 'tools/call: name is required');
                    }
                    $result = $this->tools->call($name, $args);
                    return $this->result($id, $result);

                case 'resources/list':
                    return $this->result($id, ['resources' => []]);

                case 'prompts/list':
                    return $this->result($id, ['prompts' => []]);

                default:
                    if ($isNotification) {
                        return null;
                    }
                    return $this->errorResponse($id, -32601, "Method not found: {$method}");
            }
        } catch (ToolException $e) {
            // Tool-level errors: surface as `isError: true` content per MCP spec,
            // not as a JSON-RPC error (so the model sees the message).
            return $this->result($id, [
                'content' => [
                    ['type' => 'text', 'text' => $e->getMessage()],
                ],
                'isError' => true,
            ]);
        } catch (\Throwable $e) {
            return $this->errorResponse($id, -32603, 'Internal error: ' . $e->getMessage());
        }
    }

    /**
     * Handle a batch (array of requests). Returns array of responses; notifications
     * are dropped. Empty batches and all-notification batches return null so the
     * controller can choose a 202 No Content response.
     *
     * @param list<array<string, mixed>> $batch
     * @return list<array<string, mixed>>|null
     */
    public function handleBatch(array $batch): ?array
    {
        if (empty($batch)) {
            return null;
        }
        $responses = [];
        foreach ($batch as $req) {
            if (!is_array($req)) {
                $responses[] = $this->errorResponse(null, -32600, 'Invalid Request: batch entry not an object');
                continue;
            }
            $resp = $this->handle($req);
            if ($resp !== null) {
                $responses[] = $resp;
            }
        }
        return $responses === [] ? null : $responses;
    }

    /** @return array<string, mixed> */
    private function result(mixed $id, mixed $result): array
    {
        return [
            'jsonrpc' => '2.0',
            'id' => $id,
            'result' => $result,
        ];
    }

    /** @return array<string, mixed> */
    private function errorResponse(mixed $id, int $code, string $message, mixed $data = null): array
    {
        $err = ['code' => $code, 'message' => $message];
        if ($data !== null) $err['data'] = $data;
        return [
            'jsonrpc' => '2.0',
            'id' => $id,
            'error' => $err,
        ];
    }
}
