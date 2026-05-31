/**
 * @purpose Settings card surfacing the Joist MCP server connection details.
 *
 * Shows the endpoint URL + a copy-to-clipboard button with a pre-built
 * Claude Code MCP config snippet (~/.claude/settings.json or per-project
 * .mcp.json). The user pastes it, restarts Claude Code, and gets
 * joist_* tools in every session.
 *
 * Connectivity test pings GET /wp-json/joist-mcp/v1/ (the discovery
 * endpoint) to confirm the server is reachable + correctly registered.
 */

import { useCallback, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { JoistApiError } from '../api/plans.js';
import './McpInfoCard.scss';

function readConfig() {
	if ( typeof window === 'undefined' ) return {};
	return window.joistConfig || {};
}

function mcpEndpointUrl() {
	const cfg = readConfig();
	if ( cfg.restRoot ) return `${ cfg.restRoot }joist-mcp/v1/messages`;
	if ( typeof window !== 'undefined' && window.location ) {
		return `${ window.location.origin }/wp-json/joist-mcp/v1/messages`;
	}
	return '/wp-json/joist-mcp/v1/messages';
}

function siteHost() {
	if ( typeof window === 'undefined' ) return 'joist';
	try {
		return new URL( window.location.origin ).host.replace( /[^a-z0-9]/gi, '-' ).toLowerCase();
	} catch {
		return 'joist';
	}
}

function buildConfigSnippet( endpoint ) {
	// Modern Claude Code MCP config uses `mcpServers` keyed by short name.
	// HTTP transport accepts `url` + optional `headers`.
	const serverKey = `joist-${ siteHost() }`;
	const snippet = {
		mcpServers: {
			[ serverKey ]: {
				url: endpoint,
				transport: 'streamable_http',
				headers: {
					Authorization: 'Basic <BASE64(username:app-password)>',
				},
			},
		},
	};
	return JSON.stringify( snippet, null, 2 );
}

export default function McpInfoCard() {
	const endpoint = mcpEndpointUrl();
	const snippet = buildConfigSnippet( endpoint );
	const [ copied, setCopied ] = useState( null );
	const [ pinging, setPinging ] = useState( false );
	const [ pingResult, setPingResult ] = useState( null );

	const copy = useCallback( async ( text, label ) => {
		try {
			await navigator.clipboard.writeText( text );
			setCopied( label );
			setTimeout( () => setCopied( null ), 1800 );
		} catch {
			// Fallback for older browsers: select the text manually.
			setCopied( 'fallback' );
		}
	}, [] );

	const ping = useCallback( async () => {
		setPinging( true );
		setPingResult( null );
		try {
			// Send an actual MCP `initialize` JSON-RPC request to the messages
			// endpoint. This exercises the real wire path Claude Code will use
			// (not a side-discovery endpoint), so a green result here means
			// the MCP protocol handler is alive and well.
			const res = await apiFetch( {
				path: '/joist-mcp/v1/messages',
				method: 'POST',
				data: {
					jsonrpc: '2.0',
					id: 1,
					method: 'initialize',
					params: {
						protocolVersion: '2025-03-26',
						capabilities: {},
						clientInfo: { name: 'joist-admin-reachability-test', version: '1' },
					},
				},
			} );
			if ( res?.error ) {
				setPingResult( {
					ok: false,
					code: `jsonrpc.${ res.error.code }`,
					message: res.error.message || 'JSON-RPC error',
				} );
				return;
			}
			const serverInfo = res?.result?.serverInfo || {};
			setPingResult( {
				ok: true,
				name: serverInfo.name || 'joist-mcp',
				protocol: res?.result?.protocolVersion || '?',
				version: serverInfo.version || '?',
			} );
		} catch ( e ) {
			const err = e instanceof JoistApiError ? e : null;
			setPingResult( {
				ok: false,
				code: err?.code || 'network_error',
				message: err?.message || ( e && e.message ) || String( e ),
			} );
		} finally {
			setPinging( false );
		}
	}, [] );

	return (
		<div className="joist-mcp-card">
			<div className="joist-mcp-card__head">
				<span className="j-eyebrow">MCP server</span>
				<h3 className="joist-mcp-card__title">
					Drive Joist from Claude Code (no API key)
				</h3>
				<p className="joist-mcp-card__subhead">
					Add Joist to any Claude Code session as a native tool surface.
					You'll get <code className="j-mono">joist_create_plan</code>,{ ' ' }
					<code className="j-mono">joist_clone_url</code>,{ ' ' }
					<code className="j-mono">joist_get_page_tree</code>, and{ ' ' }
					<code className="j-mono">joist_execute_plan</code> in every
					session — no Anthropic key consumed.
				</p>
			</div>

			<div className="joist-mcp-card__endpoint">
				<span className="j-eyebrow">Endpoint</span>
				<div className="joist-mcp-card__endpoint-row">
					<code className="joist-mcp-card__url j-mono">{ endpoint }</code>
					<button
						type="button"
						className="joist-settings__btn"
						onClick={ () => copy( endpoint, 'url' ) }
					>
						{ copied === 'url' ? __( 'Copied ✓', 'joist' ) : __( 'Copy URL', 'joist' ) }
					</button>
					<button
						type="button"
						className="joist-settings__btn"
						onClick={ ping }
						disabled={ pinging }
					>
						{ pinging ? __( 'Pinging…', 'joist' ) : __( 'Test reachability', 'joist' ) }
					</button>
				</div>
				{ pingResult?.ok && (
					<span className="joist-mcp-card__ping-ok j-mono">
						✓ { pingResult.name } · proto { pingResult.protocol } · v{ pingResult.version }
					</span>
				) }
				{ pingResult && ! pingResult.ok && (
					<span className="joist-mcp-card__ping-fail j-mono">
						✗ { pingResult.code }: { pingResult.message }
					</span>
				) }
			</div>

			<div className="joist-mcp-card__snippet">
				<div className="joist-mcp-card__snippet-head">
					<span className="j-eyebrow">Claude Code config</span>
					<button
						type="button"
						className="joist-settings__btn"
						onClick={ () => copy( snippet, 'snippet' ) }
					>
						{ copied === 'snippet'
							? __( 'Copied ✓', 'joist' )
							: __( 'Copy config snippet', 'joist' ) }
					</button>
				</div>
				<pre className="joist-mcp-card__pre j-mono">{ snippet }</pre>
				<p className="joist-mcp-card__steps">
					Paste into <code className="j-mono">~/.claude/settings.json</code>{ ' ' }
					(or a per-project <code className="j-mono">.mcp.json</code>). Replace the
					<code className="j-mono"> Authorization</code> placeholder with{ ' ' }
					<code className="j-mono">Basic $(echo -n 'user:app-password' | base64)</code>{ ' ' }
					— generate an Application Password under <em>Users → Your Profile → Application Passwords</em>.
					Restart Claude Code so it re-reads the config.
				</p>
			</div>
		</div>
	);
}
