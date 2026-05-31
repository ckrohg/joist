/**
 * @purpose REST client for the /joist/v1/plans/* endpoints.
 *
 * Thin wrapper around `@wordpress/api-fetch`. We use api-fetch (not raw
 * `fetch`) so we inherit:
 *   - automatic X-WP-Nonce on same-origin calls
 *   - middleware chain (nonce refresh, root URL, preloading) that other
 *     WP packages register
 *   - consistent error envelope handling
 *
 * Every function maps 1:1 to a controller method in
 * plugin/src/REST/PlansController.php:
 *
 *   GET    /plans                   → listPlans()
 *   GET    /plans/{id}              → getPlan(id)
 *   POST   /plans                   → createPlan(body)
 *   POST   /plans/{id}/approve      → approvePlan(id, body)
 *   POST   /plans/{id}/reject       → rejectPlan(id, body)
 *   POST   /plans/{id}/execute      → executePlan(id)
 *
 * Errors: the Joist REST surface returns a typed error envelope on failure
 * (see ControllerBase::handle in PHP). We surface those as `JoistApiError`
 * with `.code`, `.message`, `.status`, and `.details` populated.
 */

import apiFetch from '@wordpress/api-fetch';

const NAMESPACE = 'joist/v1';

/**
 * Read window.joistConfig once, the first time anything in this module
 * needs it. AssetEnqueue.php localizes it on the `joist-admin-app` script.
 */
function readConfig() {
	if ( typeof window === 'undefined' ) {
		return {};
	}
	return window.joistConfig || {};
}

let nonceConfigured = false;
function ensureNonce() {
	if ( nonceConfigured ) {
		return;
	}
	const { nonce, restRoot } = readConfig();
	if ( nonce ) {
		apiFetch.use( apiFetch.createNonceMiddleware( nonce ) );
	}
	if ( restRoot ) {
		apiFetch.use( apiFetch.createRootURLMiddleware( restRoot ) );
	}
	nonceConfigured = true;
}

/**
 * Typed error class. Thrown when the REST surface returns a Joist envelope.
 *
 * Shape from PHP: `{ code: string, message: string, data?: { status: number }, details?: object, recovery_suggestions?: string[] }`
 *
 * api-fetch rejects with the parsed body directly; we re-wrap into this
 * class so callers can `instanceof`-check.
 */
export class JoistApiError extends Error {
	constructor( payload, fallback ) {
		const message =
			( payload && payload.message ) ||
			fallback ||
			'Unknown Joist API error';
		super( message );
		this.name = 'JoistApiError';
		this.code = ( payload && payload.code ) || 'unknown';
		this.status =
			( payload && payload.data && payload.data.status ) ||
			( payload && payload.status ) ||
			0;
		this.details = ( payload && payload.details ) || null;
		this.recoverySuggestions =
			( payload && payload.recovery_suggestions ) || [];
	}
}

/**
 * Internal: call apiFetch, normalize errors to JoistApiError.
 *
 * @param {Object} options apiFetch options.
 * @return {Promise<*>}
 */
async function call( options ) {
	ensureNonce();
	try {
		return await apiFetch( options );
	} catch ( e ) {
		// api-fetch rejects with the JSON body when the server returns one.
		// If the body matches the Joist envelope, wrap. Otherwise re-throw
		// a generic JoistApiError so callers always have one type to handle.
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

/**
 * GET /plans — list recent plans.
 *
 * @return {Promise<{plans: Array}>}
 */
export function listPlans() {
	return call( { path: `/${ NAMESPACE }/plans`, method: 'GET' } );
}

/**
 * GET /plans/{id} — fetch a single plan by id.
 *
 * @param {string} id Plan id.
 * @return {Promise<object>}
 */
export function getPlan( id ) {
	if ( ! id ) {
		return Promise.reject(
			new JoistApiError( {
				code: 'validation.id_required',
				message: 'plan id is required',
			} )
		);
	}
	return call( {
		path: `/${ NAMESPACE }/plans/${ encodeURIComponent( id ) }`,
		method: 'GET',
	} );
}

/**
 * POST /plans — create a plan.
 *
 * @param {{intent: string, page_id?: number, steps: Array}} body
 * @return {Promise<object>}
 */
export function createPlan( body ) {
	return call( {
		path: `/${ NAMESPACE }/plans`,
		method: 'POST',
		data: body || {},
	} );
}

/**
 * POST /plans/{id}/approve — approve a plan (requires approval_token).
 *
 * @param {string}                   id
 * @param {{approval_token: string}} body
 * @return {Promise<object>}
 */
export function approvePlan( id, body ) {
	return call( {
		path: `/${ NAMESPACE }/plans/${ encodeURIComponent( id ) }/approve`,
		method: 'POST',
		data: body || {},
	} );
}

/**
 * POST /plans/{id}/reject — reject a plan.
 *
 * @param {string}                                                    id
 * @param {{approval_token?: string, note?: string, reason?: string}} body
 * @return {Promise<object>}
 */
export function rejectPlan( id, body ) {
	return call( {
		path: `/${ NAMESPACE }/plans/${ encodeURIComponent( id ) }/reject`,
		method: 'POST',
		data: body || {},
	} );
}

/**
 * POST /plans/{id}/execute — execute an approved plan.
 *
 * @param {string}                    id
 * @param {{step_indices?: number[]}} [body]
 *                                           Optional. If the backend grows to support per-step execution it will
 *                                           accept a `step_indices` array — in W5b we forward the body if provided
 *                                           so the UI is forward-compatible. The current PlansController does not
 *                                           yet read step_indices (see open question in W5b status report).
 * @return {Promise<object>}
 */
export function executePlan( id, body ) {
	return call( {
		path: `/${ NAMESPACE }/plans/${ encodeURIComponent( id ) }/execute`,
		method: 'POST',
		data: body || {},
	} );
}

/**
 * DELETE /plans/{id} — admin-only. Permanently removes the row. Used by the
 * Plan Mode UI to clean up test plans and cancelled drafts.
 *
 * @param {string} id Plan id.
 * @return {Promise<object>}
 */
export function deletePlan( id ) {
	return call( {
		path: `/${ NAMESPACE }/plans/${ encodeURIComponent( id ) }`,
		method: 'DELETE',
	} );
}

/**
 * POST /plans/generate — translate a natural-language intent into a Plan.
 *
 * Body: { intent: string, page_id?: number }
 * Returns: the freshly-created Plan row + step_count.
 *
 * When no Anthropic API key is configured on the server, the generator falls
 * back to a deterministic template so the loop can be demoed without paid
 * API calls.
 *
 * @param {object} body { intent, page_id? }
 * @return {Promise<object>}
 */
export function generatePlan( body ) {
	return call( {
		path: `/${ NAMESPACE }/plans/generate`,
		method: 'POST',
		data: body || {},
	} );
}

/**
 * POST /plans/clone-from-url — fetch a URL server-side and synthesise a Plan
 * via Claude in text-mode (HTML extract, not vision). Lower fidelity than
 * the screenshot path but no headless browser required and it's a single
 * button rather than a manual screenshot workflow.
 *
 * Body: { url: string, intent?: string, page_id?: number, title?: string }
 *
 * @param {object} body
 * @return {Promise<object>}
 */
export function cloneFromUrl( body ) {
	return call( {
		path: `/${ NAMESPACE }/plans/clone-from-url`,
		method: 'POST',
		data: body || {},
	} );
}

/**
 * POST /plans/clone-from-screenshots — cheap-substitute clone path.
 *
 * Uploads 1-3 PNG/JPG screenshots (≤ 5 MB each) plus an optional `intent`
 * note as multipart/form-data. The server hands the images to Claude Opus
 * 4.7 with vision and returns a freshly-created V3 Plan row.
 *
 * Why a separate function (vs. extending generatePlan)? — multipart payload
 * does not flow through apiFetch's JSON-by-default `data:` parameter; we
 * pass FormData via `body:` and let the browser set the correct
 * Content-Type with boundary. The middleware chain still applies the
 * X-WP-Nonce header and rest root.
 *
 * @param {FormData} formData FormData containing one or more `images[]`
 *                            File entries, plus optional `intent` and
 *                            `page_id` string fields.
 * @return {Promise<object>}  Plan row + step_count + image_count.
 */
export function cloneFromScreenshots( formData ) {
	if ( ! ( formData instanceof FormData ) ) {
		return Promise.reject(
			new JoistApiError( {
				code: 'validation.formdata_required',
				message:
					'cloneFromScreenshots expects a FormData instance.',
			} )
		);
	}
	return call( {
		path: `/${ NAMESPACE }/plans/clone-from-screenshots`,
		method: 'POST',
		body: formData,
	} );
}

/**
 * POST /plans/{id}/steps/{index} — patch a single step's structured fields.
 *
 * This endpoint does NOT yet exist on the backend (W5b open question).
 * The function is wired so the UI's Edit-step modal can submit; if the
 * server returns rest_no_route we surface that as a typed error and the
 * modal will refuse-not-corrupt rather than fall back to a full-plan
 * replace. See WAVE_5b §D and failure_mode_constraints.md #16.
 *
 * @param {string} id    Plan id.
 * @param {number} index Step index (0-based).
 * @param {Object} patch Partial step body to merge.
 * @return {Promise<object>}
 */
export function updatePlanStep( id, index, patch ) {
	if ( ! id ) {
		return Promise.reject(
			new JoistApiError( {
				code: 'validation.id_required',
				message: 'plan id is required',
			} )
		);
	}
	if ( typeof index !== 'number' || index < 0 ) {
		return Promise.reject(
			new JoistApiError( {
				code: 'validation.index_required',
				message: 'step index must be a non-negative integer',
			} )
		);
	}
	return call( {
		path: `/${ NAMESPACE }/plans/${ encodeURIComponent(
			id
		) }/steps/${ encodeURIComponent( String( index ) ) }`,
		method: 'POST',
		data: patch || {},
	} );
}

/**
 * GET /plans/{id}/blast-radius — fetch real affected-page counts.
 *
 * Forward-looking (not implemented in v0.5/v0.7). Returns structured
 * counts the UI can render in place of "site-wide". Until the endpoint
 * exists this call will resolve with a 404 envelope; callers should
 * treat the error as a "data not available" signal and render the
 * static-table classification verbatim.
 *
 * @param {string} id
 * @return {Promise<object>}
 */
export function getBlastRadius( id ) {
	if ( ! id ) {
		return Promise.reject(
			new JoistApiError( {
				code: 'validation.id_required',
				message: 'plan id is required',
			} )
		);
	}
	return call( {
		path: `/${ NAMESPACE }/plans/${ encodeURIComponent(
			id
		) }/blast-radius`,
		method: 'GET',
	} );
}

export default {
	listPlans,
	getPlan,
	createPlan,
	approvePlan,
	rejectPlan,
	executePlan,
	generatePlan,
	cloneFromScreenshots,
	deletePlan,
	updatePlanStep,
	getBlastRadius,
	JoistApiError,
};
