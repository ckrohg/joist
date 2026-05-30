/**
 * @purpose Poll a single plan's status while it's running.
 *
 * Backend statuses (see PlanStore.php updateStatus): pending, approved,
 * executing, completed, failed, rejected, expired. We poll only while
 * status === 'executing'; everything else is a terminal-or-static state.
 *
 * Default poll interval: 2500ms — sits inside the 2-3s window §H specifies.
 *
 * Returns the latest plan object + a manual `refresh()` trigger callers
 * can fire after they perform a mutation (approve / reject / execute).
 *
 * Important: this hook owns the polling lifecycle. It will *not* fight a
 * caller that also calls getPlan() — the manual refresh path simply runs
 * the same fetcher inline.
 */

import { useCallback, useEffect, useState } from '@wordpress/element';

import { getPlan } from '../api/plans.js';
import { useInterval } from './useInterval.js';

const ACTIVE_STATUSES = [ 'executing' ];
const DEFAULT_POLL_MS = 2500;

/**
 * @param {string|null}                         planId  Plan id to track. Null pauses the hook.
 * @param {{initial?: object, pollMs?: number}} options
 * @return {{
 *   plan: object|null,
 *   loading: boolean,
 *   error: Error|null,
 *   refresh: () => Promise<object|null>,
 *   isPolling: boolean,
 * }}
 */
export function usePlanPolling( planId, options = {} ) {
	const { initial = null, pollMs = DEFAULT_POLL_MS } = options;
	const [ plan, setPlan ] = useState( initial );
	const [ loading, setLoading ] = useState( ! initial && !! planId );
	const [ error, setError ] = useState( null );

	const fetcher = useCallback( async () => {
		if ( ! planId ) {
			return null;
		}
		try {
			const fresh = await getPlan( planId );
			setPlan( fresh );
			setError( null );
			setLoading( false );
			return fresh;
		} catch ( e ) {
			setError( e );
			setLoading( false );
			return null;
		}
	}, [ planId ] );

	useEffect( () => {
		if ( ! planId ) {
			setPlan( null );
			setLoading( false );
			return undefined;
		}
		setLoading( true );
		let cancelled = false;
		( async () => {
			const fresh = await fetcher();
			if ( cancelled ) {
				return;
			}
			void fresh;
		} )();
		return () => {
			cancelled = true;
		};
	}, [ planId, fetcher ] );

	const isPolling =
		!! planId &&
		!! plan &&
		ACTIVE_STATUSES.includes( String( plan.status || '' ) );

	useInterval( fetcher, isPolling ? pollMs : null );

	return { plan, loading, error, refresh: fetcher, isPolling };
}
