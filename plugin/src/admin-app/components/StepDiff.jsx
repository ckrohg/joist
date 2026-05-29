/**
 * @purpose "Show diff" modal — iframe preview tab + JSON-tree diff tab.
 *
 * Per WAVE_0 §5 ("delight" + "anti-patterns"):
 *   - Generic line-diff for nested Elementor JSON is wrong — we render a
 *     tree-diff (see ./JsonTreeDiff.jsx).
 *   - iframe preview side-by-side: left = current page (Elementor preview
 *     URL), right = proposed-after. For W5b the right side is a documented
 *     placeholder — preview rendering needs `POST /joist/v1/preview/render`
 *     which lands in v0.9.
 *
 * iframe sourcing — we read `joistConfig.previewUrlBase` if AssetEnqueue
 * exposes it; otherwise fall back to constructing a `wp-admin/post.php?
 * post={id}&action=elementor` URL which Elementor reliably renders.
 *
 * Failure-mode constraint #18: this component renders inside the React
 * tree (App.jsx mount root) and only ever touches its own iframe via React
 * refs. No outer-frame document.* access.
 */

import { useMemo, useState } from '@wordpress/element';
import {
	Modal,
	TabPanel,
	Notice,
	__experimentalText as Text,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import JsonTreeDiff from './JsonTreeDiff.jsx';
import './StepDiff.scss';

function readConfig() {
	if ( typeof window === 'undefined' ) return {};
	return window.joistConfig || {};
}

/**
 * Build a best-effort "current page" preview URL from a page id.
 *
 * @param {number|string|null} pageId
 * @return {string|null}
 */
function buildPreviewUrl( pageId ) {
	if ( ! pageId ) return null;
	const cfg = readConfig();
	if ( cfg.previewUrlBase ) {
		return `${ cfg.previewUrlBase }${ encodeURIComponent( String( pageId ) ) }`;
	}
	if ( cfg.adminUrl ) {
		return `${ cfg.adminUrl }post.php?post=${ encodeURIComponent(
			String( pageId )
		) }&action=elementor`;
	}
	// As a last resort, reconstruct from window.location.
	if ( typeof window !== 'undefined' && window.location ) {
		const origin = window.location.origin || '';
		return `${ origin }/?p=${ encodeURIComponent( String( pageId ) ) }&preview=true`;
	}
	return null;
}

function PreviewTab( { pageId } ) {
	const url = useMemo( () => buildPreviewUrl( pageId ), [ pageId ] );

	return (
		<div className="joist-stepdiff__previews">
			<div className="joist-stepdiff__pane">
				<div className="joist-stepdiff__pane-header">
					{ __( 'Current', 'joist' ) }
				</div>
				{ url ? (
					<iframe
						className="joist-stepdiff__iframe"
						src={ url }
						title={ __( 'Current page preview', 'joist' ) }
						sandbox="allow-same-origin allow-scripts"
					/>
				) : (
					<div className="joist-stepdiff__placeholder">
						<Text>
							{ __(
								'No page id on this step — cannot render the "current" preview.',
								'joist'
							) }
						</Text>
					</div>
				) }
			</div>
			<div className="joist-stepdiff__pane">
				<div className="joist-stepdiff__pane-header">
					{ __( 'Proposed (after)', 'joist' ) }
				</div>
				<div className="joist-stepdiff__placeholder joist-stepdiff__placeholder--proposed">
					<Notice status="info" isDismissible={ false }>
						<strong>
							{ __( 'Proposed-state preview is a v0.9 feature.', 'joist' ) }
						</strong>
						<div>
							{ __(
								'Rendering the after-state requires POST /joist/v1/preview/render, which lands in v0.9. Switch to the JSON diff tab to inspect the proposed change today.',
								'joist'
							) }
						</div>
					</Notice>
				</div>
			</div>
		</div>
	);
}

function JsonTab( { step } ) {
	// Backend currently does not split step state into target_state /
	// proposed_state. We render an "everything new" view by diffing an
	// empty object against the step payload itself. When the backend
	// surfaces explicit before/after, this picks them up automatically.
	const before = step?.target_state ?? step?.before ?? {};
	const after =
		step?.proposed_state ??
		step?.after ??
		stripBookkeeping( step ) ??
		{};

	return (
		<div className="joist-stepdiff__json">
			<Text variant="muted" size={ 12 }>
				{ __(
					'Tree diff of the step. Green = added, red = removed, amber = changed.',
					'joist'
				) }
			</Text>
			<JsonTreeDiff before={ before } after={ after } />
		</div>
	);
}

/**
 * Drop UI-only / bookkeeping fields so the JSON tab focuses on the
 * substantive parts of the step.
 */
function stripBookkeeping( step ) {
	if ( ! step || typeof step !== 'object' ) return step;
	const {
		__index, // eslint-disable-line no-unused-vars
		_skip,   // eslint-disable-line no-unused-vars
		_local,  // eslint-disable-line no-unused-vars
		...rest
	} = step;
	return rest;
}

export default function StepDiff( { step, plan, onClose } ) {
	const [ tab, setTab ] = useState( 'preview' );
	if ( ! step ) return null;

	const title = step.op
		? `${ __( 'Diff', 'joist' ) }: ${ step.op }`
		: __( 'Step diff', 'joist' );

	return (
		<Modal
			title={ title }
			onRequestClose={ onClose }
			className="joist-stepdiff-modal"
			isFullScreen
		>
			<TabPanel
				className="joist-stepdiff__tabs"
				activeClass="is-active"
				initialTabName={ tab }
				onSelect={ setTab }
				tabs={ [
					{ name: 'preview', title: __( 'Preview', 'joist' ) },
					{ name: 'json', title: __( 'JSON diff', 'joist' ) },
				] }
			>
				{ ( current ) =>
					current.name === 'preview' ? (
						<PreviewTab pageId={ plan?.page_id } />
					) : (
						<JsonTab step={ step } />
					)
				}
			</TabPanel>
		</Modal>
	);
}
