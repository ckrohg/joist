/**
 * @purpose Tiny relative-time formatter ("5 min ago" / "3 hr ago" / "2 days ago").
 *
 * No new external deps — see WAVE_5b constraints. The backend stores plan
 * `created_at` as a MySQL-format string ("YYYY-MM-DD HH:MM:SS" in UTC); we
 * normalize to a Date and diff against `Date.now()`.
 *
 * We intentionally do not pull in `@wordpress/date` here — that package
 * isn't in plugin/package.json and adding a runtime dep is out of W5b scope.
 * Intl.RelativeTimeFormat is core JS and available on every WP-supported
 * browser (2026); we lean on it.
 */

const RTF = ( () => {
	try {
		return new Intl.RelativeTimeFormat( undefined, { numeric: 'auto' } );
	} catch ( e ) {
		return null;
	}
} )();

/**
 * Parse a MySQL-format datetime as UTC. WordPress stores timestamps in
 * UTC in this format and the REST surface echoes them unchanged.
 *
 * @param {string} mysql "YYYY-MM-DD HH:MM:SS"
 * @return {Date|null}
 */
function parseMySQL( mysql ) {
	if ( ! mysql || typeof mysql !== 'string' ) {
		return null;
	}
	const m = mysql.match(
		/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/
	);
	if ( ! m ) {
		const fallback = new Date( mysql );
		return isNaN( fallback.getTime() ) ? null : fallback;
	}
	return new Date(
		Date.UTC(
			Number( m[ 1 ] ),
			Number( m[ 2 ] ) - 1,
			Number( m[ 3 ] ),
			Number( m[ 4 ] ),
			Number( m[ 5 ] ),
			Number( m[ 6 ] )
		)
	);
}

/**
 * Format a timestamp as a relative time string.
 *
 * @param {string|Date|null} when MySQL-format string OR a Date OR null.
 * @return {string} A short relative-time label, or '' if we can't parse.
 */
export function relativeTime( when ) {
	let d = null;
	if ( when instanceof Date ) {
		d = when;
	} else if ( typeof when === 'string' ) {
		d = parseMySQL( when );
	}
	if ( ! d ) {
		return '';
	}

	const deltaSec = Math.round( ( d.getTime() - Date.now() ) / 1000 );
	const abs = Math.abs( deltaSec );

	const units = [
		[ 60, 'second' ],
		[ 60, 'minute' ],
		[ 24, 'hour' ],
		[ 30, 'day' ],
		[ 12, 'month' ],
		[ Number.POSITIVE_INFINITY, 'year' ],
	];

	let value = abs;
	let chosenUnit = 'second';
	for ( let i = 0; i < units.length; i++ ) {
		const [ step, unit ] = units[ i ];
		if ( value < step ) {
			chosenUnit = unit;
			break;
		}
		value = Math.floor( value / step );
	}

	if ( RTF ) {
		return RTF.format( deltaSec < 0 ? -value : value, chosenUnit );
	}
	// Manual fallback if Intl.RelativeTimeFormat isn't available.
	const direction = deltaSec < 0 ? 'ago' : 'from now';
	return `${ value } ${ chosenUnit }${
		value === 1 ? '' : 's'
	} ${ direction }`;
}
