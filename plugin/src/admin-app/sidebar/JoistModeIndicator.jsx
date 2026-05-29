/**
 * @purpose Live "mode" badge — Read-only Plan Mode vs Execute Mode.
 *
 * Background — per WAVE_0 §5, Claude Code's plan-mode-leakage bug is the
 * cautionary tale: a sidebar/admin-bar indicator MUST tell the user which
 * mode they're in so writes can't slip out unobserved.
 *
 * Implementation choice (documented):
 *   The Wave 5b brief asks for `registerPlugin` + `<PluginSidebar>`. That
 *   SlotFill is provided by the block editor's edit-post UI — it is NOT
 *   available on a standalone admin page (which is what the Joist Plan
 *   Mode page is). We therefore render this component as a status pill at
 *   the top of the Plan Mode page itself (`App.jsx` mounts it inline).
 *
 *   The `registerPlugin` registration in `index.js` is still useful — it
 *   reserves a plugin name and (on WP 7.0+ block-editor pages where Joist
 *   may grow a SlotFill in v0.9) is a no-op-safe call.
 *
 * Mode source-of-truth: derived from `joistConfig.operatingMode`, with a
 * fallback to "plan" when not set. The acceptance suite already covers
 * "operating_mode: observer forces dry_run" — that detection feeds this
 * badge too.
 */

import { __ } from '@wordpress/i18n';

import './JoistModeIndicator.scss';

function readConfig() {
	if ( typeof window === 'undefined' ) return {};
	return window.joistConfig || {};
}

/**
 * Compute mode + label + color from the localized config.
 *
 * Operating-mode values from the backend (Joist\Core\OperatingMode):
 *   observer | live
 * UI mode values:
 *   plan      → read-only, no writes will fire
 *   execute   → an approved plan is being run / mode is `live`
 *   observer  → backend forces dry_run regardless of plan approval
 *
 * @param {object} cfg joistConfig.
 * @return {{key: string, label: string, hint: string}}
 */
export function modeFromConfig( cfg ) {
	const operating = String( cfg.operatingMode || cfg.operating_mode || '' );
	if ( operating === 'observer' ) {
		return {
			key: 'observer',
			label: __( 'Observer mode', 'joist' ),
			hint: __( 'All writes dry-run. Approve plans for visibility only.', 'joist' ),
		};
	}
	if ( operating === 'live' ) {
		return {
			key: 'execute',
			label: __( 'Execute mode', 'joist' ),
			hint: __( 'Approved plans will write to the live site.', 'joist' ),
		};
	}
	return {
		key: 'plan',
		label: __( 'Plan mode (read-only)', 'joist' ),
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
			aria-label={ `${ mode.label } — ${ mode.hint }` }
			title={ mode.hint }
		>
			<span className="joist-mode__dot" aria-hidden="true" />
			<span className="joist-mode__label">{ mode.label }</span>
			<span className="joist-mode__hint">{ mode.hint }</span>
		</div>
	);
}
