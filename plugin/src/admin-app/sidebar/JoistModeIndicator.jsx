/**
 * @purpose Joist mode indicator — bespoke pill, not the WP-components default.
 *
 * Three modes:
 *   plan      — read-only browsing. nothing writes until approval.
 *   execute   — approved plans will write.
 *   observer  — backend forces dry_run regardless of approval.
 *
 * The pill is small, deliberate, sits at the top of every Plan Mode view.
 * Countermeasure to Claude-Code-style plan-mode-leakage (per WAVE_0 §5).
 */

import { __ } from '@wordpress/i18n';
import './JoistModeIndicator.scss';

function readConfig() {
	if ( typeof window === 'undefined' ) return {};
	return window.joistConfig || {};
}

export function modeFromConfig( cfg ) {
	const operating = String( cfg.operatingMode || cfg.operating_mode || '' );
	if ( operating === 'observer' ) {
		return {
			key: 'observer',
			label: __( 'Observer mode', 'joist' ),
			hint: __( 'Writes dry-run. Approvals are visibility-only.', 'joist' ),
		};
	}
	if ( operating === 'live' ) {
		return {
			key: 'execute',
			label: __( 'Execute mode', 'joist' ),
			hint: __( 'Approved plans write to the live site.', 'joist' ),
		};
	}
	return {
		key: 'plan',
		label: __( 'Plan mode', 'joist' ),
		hint: __( 'Browsing plans. Nothing writes until you approve.', 'joist' ),
	};
}

export default function JoistModeIndicator( { mode: forced } ) {
	const cfg = readConfig();
	const mode = forced || modeFromConfig( cfg );

	return (
		<div
			className={ `joist-mode joist-mode--${ mode.key }` }
			role="status"
			aria-label={ `${ mode.label }. ${ mode.hint }` }
		>
			<span className="joist-mode__indicator" aria-hidden="true">
				<span className="joist-mode__dot" />
				<span className="joist-mode__ring" />
			</span>
			<span className="joist-mode__text">
				<span className="joist-mode__label">{ mode.label }</span>
				<span className="joist-mode__hint">{ mode.hint }</span>
			</span>
		</div>
	);
}
