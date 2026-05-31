/**
 * @purpose REST client for the /joist/v1/settings/* endpoints.
 *
 * Thin wrapper around @wordpress/api-fetch. The settings surface is admin-
 * gated server-side; the client just forwards the request and normalises
 * errors to JoistApiError so the UI handles them uniformly.
 */

import apiFetch from '@wordpress/api-fetch';
import { JoistApiError } from './plans.js';

const NAMESPACE = 'joist/v1';

async function call( options ) {
	try {
		return await apiFetch( options );
	} catch ( e ) {
		if ( e && typeof e === 'object' && 'code' in e ) {
			throw new JoistApiError( e );
		}
		throw new JoistApiError(
			{
				code: 'network_error',
				message: ( e && e.message ) || String( e ),
			},
			'Network or transport error'
		);
	}
}

export function getSettings() {
	return call( { path: `/${ NAMESPACE }/settings`, method: 'GET' } );
}

export function setClaudeKey( key ) {
	return call( {
		path: `/${ NAMESPACE }/settings/claude-key`,
		method: 'POST',
		data: { key },
	} );
}

export function deleteClaudeKey() {
	return call( {
		path: `/${ NAMESPACE }/settings/claude-key`,
		method: 'DELETE',
	} );
}

export function testClaudeKey() {
	return call( {
		path: `/${ NAMESPACE }/settings/claude-key/test`,
		method: 'POST',
		data: {},
	} );
}
