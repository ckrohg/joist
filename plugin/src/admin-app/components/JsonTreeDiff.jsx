/**
 * @purpose Recursive JSON-tree diff renderer (no external deps).
 *
 * Compares two arbitrary JSON values and renders an indented tree with:
 *   - additions in green (right-only keys)
 *   - removals in red   (left-only keys)
 *   - changes in amber  (different values at same key)
 *   - unchanged in neutral
 *
 * Per WAVE_0 §5: nested-widget JSON deserves a *tree* diff, not a generic
 * line diff. Line-diff loses the structure; tree-diff stays readable when
 * a deep widget tree changes one leaf.
 *
 * Stays under ~150 LOC and uses only colored <span>s + indentation —
 * faithful to "no new external runtime deps."
 */

import './JsonTreeDiff.scss';

const KIND_NULL = 'null';
const KIND_PRIM = 'primitive';
const KIND_ARR = 'array';
const KIND_OBJ = 'object';

function kindOf( v ) {
	if ( v === null || v === undefined ) return KIND_NULL;
	if ( Array.isArray( v ) ) return KIND_ARR;
	if ( typeof v === 'object' ) return KIND_OBJ;
	return KIND_PRIM;
}

function renderPrim( v ) {
	if ( v === null || v === undefined ) return 'null';
	if ( typeof v === 'string' ) return JSON.stringify( v );
	return String( v );
}

function unionKeys( a, b ) {
	const seen = new Set();
	if ( a && typeof a === 'object' && ! Array.isArray( a ) ) {
		for ( const k of Object.keys( a ) ) seen.add( k );
	}
	if ( b && typeof b === 'object' && ! Array.isArray( b ) ) {
		for ( const k of Object.keys( b ) ) seen.add( k );
	}
	return Array.from( seen ).sort();
}

function diffNode( before, after, name, depth, status ) {
	const indent = '  '.repeat( depth );
	const lineCls = `joist-jdiff__line joist-jdiff__line--${ status }`;
	const labelEl = name !== undefined && (
		<span className="joist-jdiff__key">{ JSON.stringify( name ) }: </span>
	);

	const kA = kindOf( before );
	const kB = kindOf( after );

	// Added (left missing).
	if ( status === 'added' ) {
		return (
			<div className={ lineCls } key={ `${ depth }-${ name }-add` }>
				<span className="joist-jdiff__indent">{ indent }</span>
				<span className="joist-jdiff__sign">+ </span>
				{ labelEl }
				<span className="joist-jdiff__val">
					{ stringify( after ) }
				</span>
			</div>
		);
	}

	// Removed (right missing).
	if ( status === 'removed' ) {
		return (
			<div className={ lineCls } key={ `${ depth }-${ name }-rm` }>
				<span className="joist-jdiff__indent">{ indent }</span>
				<span className="joist-jdiff__sign">- </span>
				{ labelEl }
				<span className="joist-jdiff__val">
					{ stringify( before ) }
				</span>
			</div>
		);
	}

	// Same kind, both objects → recurse on key union.
	if ( kA === KIND_OBJ && kB === KIND_OBJ ) {
		const keys = unionKeys( before, after );
		return (
			<div className="joist-jdiff__group" key={ `${ depth }-${ name }-obj` }>
				<div className="joist-jdiff__line joist-jdiff__line--unchanged">
					<span className="joist-jdiff__indent">{ indent }</span>
					{ labelEl }
					<span className="joist-jdiff__brace">{ '{' }</span>
				</div>
				{ keys.map( ( k ) => {
					const inA = Object.prototype.hasOwnProperty.call( before, k );
					const inB = Object.prototype.hasOwnProperty.call( after, k );
					let childStatus = 'unchanged';
					if ( ! inA ) childStatus = 'added';
					else if ( ! inB ) childStatus = 'removed';
					else if ( JSON.stringify( before[ k ] ) !== JSON.stringify( after[ k ] ) ) {
						childStatus = 'changed';
					}
					return diffNode(
						before[ k ],
						after[ k ],
						k,
						depth + 1,
						childStatus
					);
				} ) }
				<div className="joist-jdiff__line joist-jdiff__line--unchanged">
					<span className="joist-jdiff__indent">{ indent }</span>
					<span className="joist-jdiff__brace">{ '}' }</span>
				</div>
			</div>
		);
	}

	// Same kind, both arrays → diff by index up to max length.
	if ( kA === KIND_ARR && kB === KIND_ARR ) {
		const max = Math.max( before.length, after.length );
		const arr = [];
		for ( let i = 0; i < max; i++ ) {
			const inA = i < before.length;
			const inB = i < after.length;
			let s = 'unchanged';
			if ( ! inA ) s = 'added';
			else if ( ! inB ) s = 'removed';
			else if ( JSON.stringify( before[ i ] ) !== JSON.stringify( after[ i ] ) ) {
				s = 'changed';
			}
			arr.push(
				diffNode(
					inA ? before[ i ] : undefined,
					inB ? after[ i ] : undefined,
					`[${ i }]`,
					depth + 1,
					s
				)
			);
		}
		return (
			<div className="joist-jdiff__group" key={ `${ depth }-${ name }-arr` }>
				<div className="joist-jdiff__line joist-jdiff__line--unchanged">
					<span className="joist-jdiff__indent">{ indent }</span>
					{ labelEl }
					<span className="joist-jdiff__brace">[</span>
				</div>
				{ arr }
				<div className="joist-jdiff__line joist-jdiff__line--unchanged">
					<span className="joist-jdiff__indent">{ indent }</span>
					<span className="joist-jdiff__brace">]</span>
				</div>
			</div>
		);
	}

	// Primitives or mixed kinds → show "before → after".
	if ( status === 'changed' ) {
		return (
			<div className={ lineCls } key={ `${ depth }-${ name }-ch` }>
				<span className="joist-jdiff__indent">{ indent }</span>
				{ labelEl }
				<span className="joist-jdiff__val joist-jdiff__val--was">
					{ renderPrim( before ) }
				</span>
				<span className="joist-jdiff__arrow"> → </span>
				<span className="joist-jdiff__val joist-jdiff__val--now">
					{ renderPrim( after ) }
				</span>
			</div>
		);
	}

	return (
		<div className={ lineCls } key={ `${ depth }-${ name }-eq` }>
			<span className="joist-jdiff__indent">{ indent }</span>
			{ labelEl }
			<span className="joist-jdiff__val">{ renderPrim( after ) }</span>
		</div>
	);
}

/**
 * Compact one-line stringification for "added" / "removed" leaf rendering
 * when the value is a non-primitive. We intentionally limit depth so the
 * rendered output stays readable; deep diffs should be opened side-by-side.
 */
function stringify( value ) {
	try {
		const s = JSON.stringify( value );
		if ( s == null ) return 'null';
		return s.length > 120 ? s.slice( 0, 117 ) + '…' : s;
	} catch ( e ) {
		return String( value );
	}
}

export default function JsonTreeDiff( { before, after } ) {
	const a = before === undefined ? {} : before;
	const b = after === undefined ? {} : after;
	const kA = kindOf( a );
	const kB = kindOf( b );
	let status = 'unchanged';
	if ( JSON.stringify( a ) !== JSON.stringify( b ) ) {
		if ( kA !== kB ) status = 'changed';
		else if ( kA === KIND_OBJ || kA === KIND_ARR ) status = 'unchanged'; // recurse handles it
		else status = 'changed';
	}
	return (
		<pre className="joist-jdiff" aria-label="JSON tree diff">
			{ diffNode( a, b, undefined, 0, status ) }
		</pre>
	);
}
