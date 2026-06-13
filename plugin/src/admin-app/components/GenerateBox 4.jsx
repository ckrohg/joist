/**
 * @purpose Prompt-to-plan surface.
 *
 * Editorial textarea + Generate button. On submit, calls POST /plans/generate
 * which translates the intent into a structured Plan via the server-side
 * generator (Anthropic call or template fallback). The new plan lands in the
 * plans list immediately; user approves and executes from there.
 *
 * Optional `page_id` — when set, the plan targets that existing page
 * (patches it). When omitted, the plan execution will use the default
 * page binding (current PlanExecutor wiring).
 */

import { useState, useCallback } from '@wordpress/element';
import { Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { generatePlan, JoistApiError } from '../api/plans.js';
import './GenerateBox.scss';

const PROMPT_EXAMPLES = [
	'Build a landing page for a craft joinery business.',
	'Build a hero + 3 value props + CTA for a Stripe-style developer tool.',
	'Draft an about page for an independent design studio.',
];

export default function GenerateBox( { defaultPageId, onPlanCreated } ) {
	const [ intent, setIntent ] = useState( '' );
	const [ pageId, setPageId ] = useState( defaultPageId ? String( defaultPageId ) : '' );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState( null );

	const submit = useCallback( async () => {
		const trimmed = intent.trim();
		if ( trimmed.length < 5 ) {
			setError( { message: 'Intent must be at least 5 characters.' } );
			return;
		}
		setBusy( true );
		setError( null );
		try {
			const body = { intent: trimmed };
			const pid = parseInt( pageId, 10 );
			if ( Number.isFinite( pid ) && pid > 0 ) body.page_id = pid;
			const plan = await generatePlan( body );
			setIntent( '' );
			if ( onPlanCreated ) onPlanCreated( plan );
		} catch ( e ) {
			setError(
				e instanceof JoistApiError
					? { code: e.code, message: e.message }
					: { message: e?.message || 'Failed to generate plan.' }
			);
		} finally {
			setBusy( false );
		}
	}, [ intent, pageId, onPlanCreated ] );

	return (
		<section className="joist-gen" aria-label={ __( 'Generate a plan', 'joist' ) }>
			<div className="joist-gen__head">
				<span className="j-eyebrow">Generate</span>
				<h2 className="joist-gen__title j-display">
					Describe the page <em className="j-display--italic">you want</em>.
				</h2>
				<p className="joist-gen__subhead">
					Joist turns intent into a structured plan. You review and approve
					before anything writes.
				</p>
			</div>

			<div className="joist-gen__form">
				<label className="joist-gen__field">
					<span className="j-eyebrow">Intent</span>
					<textarea
						className="joist-gen__textarea"
						value={ intent }
						onChange={ ( e ) => setIntent( e.target.value ) }
						placeholder="Build a landing page for…"
						rows={ 4 }
						spellCheck="false"
					/>
				</label>

				<div className="joist-gen__meta">
					<label className="joist-gen__pageid">
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
						className="joist-gen__submit"
						onClick={ submit }
						disabled={ busy || intent.trim().length < 5 }
					>
						{ busy ? __( 'Generating…', 'joist' ) : __( 'Generate plan →', 'joist' ) }
					</button>
				</div>

				<div className="joist-gen__hints">
					<span className="j-eyebrow">Try</span>
					<ul>
						{ PROMPT_EXAMPLES.map( ( p ) => (
							<li key={ p }>
								<button
									type="button"
									className="joist-gen__hint"
									onClick={ () => setIntent( p ) }
								>
									{ p }
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
