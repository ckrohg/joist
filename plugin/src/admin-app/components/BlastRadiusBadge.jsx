/**
 * @purpose Colored chip + tooltip rendering a blast-radius verdict.
 *
 * Receives the structured verdict from lib/blastRadius.js. Color rules:
 *   - flagged (irreversible + public)   → red   (joist-br-flagged)
 *   - severity === 'high' (not flagged) → red   (joist-br-high)
 *   - severity === 'medium'             → amber (joist-br-medium)
 *   - severity === 'low'                → neutral
 *
 * The chip is intentionally compact so it fits in a DataViews column. The
 * tooltip lists the reasons array.
 */

import { Tooltip } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import './BlastRadiusBadge.scss';

function visibilityLabel( v ) {
	switch ( v ) {
		case 'public':   return __( 'public', 'joist' );
		case 'site':     return __( 'site-wide', 'joist' );
		case 'template': return __( 'template', 'joist' );
		case 'page':
		default:
			return __( 'page', 'joist' );
	}
}

function countLabel( verdict ) {
	if ( verdict.affectedCount == null ) {
		return visibilityLabel( verdict.visibility );
	}
	if ( verdict.affectedCount === 1 ) return __( '1 element', 'joist' );
	return `${ verdict.affectedCount } ${ __( 'elements', 'joist' ) }`;
}

export default function BlastRadiusBadge( { verdict, compact = false } ) {
	if ( ! verdict ) return null;

	const className = [
		'joist-br',
		`joist-br--${ verdict.severity }`,
		verdict.flagged ? 'joist-br--flagged' : '',
		compact ? 'joist-br--compact' : '',
	]
		.filter( Boolean )
		.join( ' ' );

	const label = verdict.flagged
		? __( 'Irreversible', 'joist' )
		: verdict.severity === 'high'
		? __( 'High', 'joist' )
		: verdict.severity === 'medium'
		? __( 'Medium', 'joist' )
		: __( 'Low', 'joist' );

	const tooltipText = [
		`${ __( 'Blast radius', 'joist' ) }: ${ label }`,
		`${ __( 'Scope', 'joist' ) }: ${ countLabel( verdict ) }`,
		`${ __( 'Reversibility', 'joist' ) }: ${ verdict.reversibility }`,
		'',
		...verdict.reasons.map( ( r ) => '• ' + r ),
	].join( '\n' );

	return (
		<Tooltip text={ tooltipText } placement="top">
			<span className={ className } role="status" aria-label={ tooltipText }>
				<span className="joist-br__dot" aria-hidden="true" />
				<span className="joist-br__label">{ label }</span>
				{ ! compact && (
					<span className="joist-br__scope">{ countLabel( verdict ) }</span>
				) }
			</span>
		</Tooltip>
	);
}
