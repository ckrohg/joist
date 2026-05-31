<?php
declare(strict_types=1);

namespace Joist\MCP;

/**
 * Thrown by tool implementations when the call cannot complete as requested.
 * The MCP server catches these and surfaces them as `isError: true` content
 * blocks so the calling model can see the message and retry / adjust.
 *
 * Distinct from \Throwable so we can differentiate "tool said no" from
 * "server crashed" in the dispatcher.
 */
final class ToolException extends \RuntimeException
{
}
