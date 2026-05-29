/**
 * @purpose Mount the Joist Plan Mode React app onto the admin page.
 *
 * Entry point compiled by @wordpress/scripts. Output lands at
 * `plugin/build/index.js` + `plugin/build/index.asset.php` and is enqueued
 * by `src/Admin/AssetEnqueue.php`.
 *
 * We use `createRoot` (React 18+ / WP 6.4+ shipping point). All Joist v0.5
 * minimum-WP versions ship a compatible @wordpress/element, so the fallback
 * `render` path is intentionally not included — if it's ever needed, gate
 * on `typeof createRoot === 'function'` here.
 */

import { createRoot, StrictMode } from '@wordpress/element';
import App from './App.jsx';

const MOUNT_ID = 'joist-plan-mode-root';

function mount() {
	const node = document.getElementById( MOUNT_ID );
	if ( ! node ) {
		// AssetEnqueue scopes its enqueue to Joist admin pages, so the
		// mount node should always exist when this script loads. If it
		// doesn't, log once and exit — no throw.
		// eslint-disable-next-line no-console
		console.warn( '[joist] mount node #' + MOUNT_ID + ' not found' );
		return;
	}
	const root = createRoot( node );
	root.render(
		<StrictMode>
			<App />
		</StrictMode>
	);
}

// WP enqueues the script in the footer (last arg of wp_enqueue_script is
// true), so the DOM is ready by the time we run — but guard anyway.
if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', mount );
} else {
	mount();
}
