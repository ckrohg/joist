/**
 * @purpose Stable setInterval hook for React functional components.
 *
 * Standard "Dan Abramov useInterval" pattern: the callback is stored in a
 * ref so consumers can pass a fresh closure without re-arming the interval
 * every render. Passing `null` or `0` as the delay pauses the timer.
 *
 * Used by hooks/usePlanPolling.js to revalidate executing plans every 2.5s.
 */

import { useEffect, useRef } from '@wordpress/element';

/**
 * @param {Function} callback Function invoked every `delay` ms.
 * @param {number|null} delay  Interval in ms; falsy = paused.
 */
export function useInterval( callback, delay ) {
	const savedCallback = useRef( callback );

	useEffect( () => {
		savedCallback.current = callback;
	}, [ callback ] );

	useEffect( () => {
		if ( ! delay && delay !== 0 ) return undefined;
		if ( delay <= 0 ) return undefined;
		const id = setInterval( () => {
			try {
				savedCallback.current();
			} catch ( e ) {
				// Never let a callback throw kill the interval — we'd lose
				// poll updates silently if we did. Log once and continue.
				// eslint-disable-next-line no-console
				console.error( '[joist] useInterval callback threw', e );
			}
		}, delay );
		return () => clearInterval( id );
	}, [ delay ] );
}
