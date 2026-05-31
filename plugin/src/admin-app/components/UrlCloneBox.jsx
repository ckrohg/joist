/**
 * @purpose URL-to-plan surface — paste a live URL, server fetches HTML and
 *          hands it to Claude for a structured Plan. No headless browser, no
 *          manual screenshot step — single button.
 *
 * Fidelity is lower than the screenshot path (no visual cues — spacing,
 * colors, hero treatment etc. are inferred from HTML semantics only) but
 * it's the right default when the user just has a URL.
 *
 * Same Foundry styling tokens as GenerateBox + CloneBox; reuses CloneBox.scss
 * for visual consistency.
 */

import { useState, useCallback } from '@wordpress/element';
import { Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { cloneFromUrl, JoistApiError } from '../api/plans.js';
import './CloneBox.scss';

const URL_EXAMPLES = [
	'https://peakinteractive.io/',
	'https://stripe.com/',
	'https://linear.app/',
];

export default function UrlCloneBox( { defaultPageId, onPlanCreated } ) {
	const [ url, setUrl ] = useState( '' );
	const [ intent, setIntent ] = useState( '' );
	const [ pageId, setPageId ] = useState(
		defaultPageId ? String( defaultPageId ) : ''
	);
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState( null );

	const submit = useCallback( async () => {
		const trimmedUrl = url.trim();
		if ( ! /^https?:\/\/.+/i.test( trimmedUrl ) ) {
			setError( {
				message: 'Enter a fully-qualified http(s) URL.',
			} );
			return;
		}
		setBusy( true );
		setError( null );
		try {
			const body = { url: trimmedUrl };
			const trimmedIntent = intent.trim();
			if ( trimmedIntent ) body.intent = trimmedIntent;
			const pid = parseInt( pageId, 10 );
			if ( Number.isFinite( pid ) && pid > 0 ) body.page_id = pid;
			const plan = await cloneFromUrl( body );
			setUrl( '' );
			setIntent( '' );
			if ( onPlanCreated ) onPlanCreated( plan );
		} catch ( e ) {
			setError(
				e instanceof JoistApiError
					? { code: e.code, message: e.message }
					: { message: e?.message || 'Failed to clone URL.' }
			);
		} finally {
			setBusy( false );
		}
	}, [ url, intent, pageId, onPlanCreated ] );

	return (
		<section className="joist-clone" aria-label={ __( 'Clone from URL', 'joist' ) }>
			<div className="joist-clone__head">
				<span className="j-eyebrow">Clone from URL</span>
				<h2 className="joist-clone__title j-display">
					Paste a URL, get a <em className="j-display--italic">plan</em>.
				</h2>
				<p className="joist-clone__subhead">
					Joist fetches the page server-side and clones its structure.
					Lower fidelity than the screenshot path — text-mode only, no
					visual cues — but a single button instead of a screenshot
					workflow.
				</p>
			</div>

			<div className="joist-clone__form">
				<label className="joist-clone__field">
					<span className="j-eyebrow">URL</span>
					<input
						type="url"
						className="joist-clone__textarea j-mono"
						value={ url }
						onChange={ ( e ) => setUrl( e.target.value ) }
						placeholder="https://example.com/"
						spellCheck="false"
						style={ { minHeight: 0, padding: '14px 16px' } }
					/>
				</label>

				<label className="joist-clone__field">
					<span className="j-eyebrow">Extra notes (optional)</span>
					<textarea
						className="joist-clone__textarea"
						value={ intent }
						onChange={ ( e ) => setIntent( e.target.value ) }
						placeholder="Brand tone, sections to skip, copy direction…"
						rows={ 3 }
						spellCheck="false"
					/>
				</label>

				<div className="joist-clone__meta">
					<label className="joist-clone__pageid">
						<span className="j-eyebrow">Target page id</span>
						<input
							type="number"
							inputMode="numeric"
							className="j-mono"
							value={ pageId }
							onChange={ ( e ) => setPageId( e.target.value ) }
							placeholder="(new page)"
						/>
					</label>

					<button
						type="button"
						className="joist-clone__submit"
						onClick={ submit }
						disabled={ busy || url.trim().length < 8 }
					>
						{ busy
							? __( 'Cloning…', 'joist' )
							: __( 'Clone URL →', 'joist' ) }
					</button>
				</div>

				<div className="joist-gen__hints">
					<span className="j-eyebrow">Try</span>
					<ul>
						{ URL_EXAMPLES.map( ( u ) => (
							<li key={ u }>
								<button
									type="button"
									className="joist-gen__hint"
									onClick={ () => setUrl( u ) }
								>
									{ u }
								</button>
							</li>
						) ) }
					</ul>
				</div>

				{ error && (
					<Notice
						status="error"
						isDismissible
						onRemove={ () => setError( null ) }
					>
						{ error.code ? `${ error.code }: ` : '' }
						{ error.message }
					</Notice>
				) }
			</div>
		</section>
	);
}
