/**
 * @purpose Inline admin settings strip — currently exposes the Claude API key.
 *
 * Mounted at the top of the Joist admin so users can paste a key and verify
 * connectivity without ever leaving the admin (previously required SSH or a
 * wp-config edit). Other settings (default model, cost cap, brand presets)
 * will land here over time.
 *
 * Three states:
 *   - configured + healthy: collapsed badge "Claude key …xxxx (option) · Test"
 *   - configured + untested: same shape, "Test" button highlighted
 *   - not configured: expanded form with paste field + save + inline help
 */

import { useCallback, useState } from '@wordpress/element';
import { Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import {
	setClaudeKey,
	deleteClaudeKey,
	testClaudeKey,
} from '../api/settings.js';
import { JoistApiError } from '../api/plans.js';
import McpInfoCard from './McpInfoCard.jsx';
import './SettingsStrip.scss';
import './McpInfoCard.scss';

export default function SettingsStrip( { keyStatus, onChange } ) {
	const [ expanded, setExpanded ] = useState( ! keyStatus?.configured );
	const [ keyInput, setKeyInput ] = useState( '' );
	const [ busy, setBusy ] = useState( null ); // 'save' | 'test' | 'delete' | null
	const [ error, setError ] = useState( null );
	const [ testResult, setTestResult ] = useState( null );

	const save = useCallback( async () => {
		const key = keyInput.trim();
		if ( key.length < 20 ) {
			setError( { message: 'Key looks too short (expected 20+ chars).' } );
			return;
		}
		setBusy( 'save' );
		setError( null );
		try {
			const result = await setClaudeKey( key );
			setKeyInput( '' );
			setExpanded( false );
			setTestResult( null );
			if ( onChange ) onChange( result?.claude_key );
		} catch ( e ) {
			setError(
				e instanceof JoistApiError
					? { code: e.code, message: e.message }
					: { message: e?.message || 'Failed to save key.' }
			);
		} finally {
			setBusy( null );
		}
	}, [ keyInput, onChange ] );

	const test = useCallback( async () => {
		setBusy( 'test' );
		setError( null );
		setTestResult( null );
		try {
			const result = await testClaudeKey();
			setTestResult( {
				ok: true,
				latency: result?.latency_ms,
				model: result?.model,
			} );
		} catch ( e ) {
			setTestResult( null );
			setError(
				e instanceof JoistApiError
					? { code: e.code, message: e.message }
					: { message: e?.message || 'Test failed.' }
			);
		} finally {
			setBusy( null );
		}
	}, [] );

	const remove = useCallback( async () => {
		setBusy( 'delete' );
		setError( null );
		try {
			const result = await deleteClaudeKey();
			setTestResult( null );
			if ( onChange ) onChange( result?.claude_key );
			setExpanded( true );
		} catch ( e ) {
			setError(
				e instanceof JoistApiError
					? { code: e.code, message: e.message }
					: { message: e?.message || 'Failed to remove key.' }
			);
		} finally {
			setBusy( null );
		}
	}, [ onChange ] );

	const configured = !! keyStatus?.configured;

	return (
		<section className="joist-settings" aria-label={ __( 'Settings', 'joist' ) }>
			<div className="joist-settings__bar">
				<span className="j-eyebrow">Claude API key</span>
				{ configured ? (
					<>
						<span className="joist-settings__badge j-mono">
							{ keyStatus.tail || '…' }
						</span>
						<span className="joist-settings__source">
							via { keyStatus.source }
						</span>
						<button
							type="button"
							className="joist-settings__btn"
							onClick={ test }
							disabled={ busy === 'test' }
						>
							{ busy === 'test' ? __( 'Testing…', 'joist' ) : __( 'Test connection', 'joist' ) }
						</button>
						{ keyStatus.source === 'option' && (
							<button
								type="button"
								className="joist-settings__btn joist-settings__btn--ghost"
								onClick={ remove }
								disabled={ busy === 'delete' }
							>
								{ __( 'Remove', 'joist' ) }
							</button>
						) }
						{ ! expanded && (
							<button
								type="button"
								className="joist-settings__btn joist-settings__btn--ghost"
								onClick={ () => setExpanded( true ) }
							>
								{ __( 'Replace', 'joist' ) }
							</button>
						) }
					</>
				) : (
					<span className="joist-settings__warning">
						{ __( 'Not configured — AI generation falls back to template stubs.', 'joist' ) }
					</span>
				) }
				{ testResult?.ok && (
					<span className="joist-settings__test-ok">
						✓ { testResult.latency }ms · { testResult.model }
					</span>
				) }
			</div>

			{ expanded && (
				<div className="joist-settings__form">
					<label className="joist-settings__field">
						<span className="j-eyebrow">Paste your Anthropic API key</span>
						<input
							type="password"
							className="joist-settings__input j-mono"
							value={ keyInput }
							onChange={ ( e ) => setKeyInput( e.target.value ) }
							placeholder="sk-ant-…"
							spellCheck="false"
							autoComplete="off"
						/>
					</label>
					<div className="joist-settings__actions">
						<button
							type="button"
							className="joist-settings__btn joist-settings__btn--primary"
							onClick={ save }
							disabled={ busy === 'save' || keyInput.trim().length < 20 }
						>
							{ busy === 'save' ? __( 'Saving…', 'joist' ) : __( 'Save key', 'joist' ) }
						</button>
						{ configured && (
							<button
								type="button"
								className="joist-settings__btn joist-settings__btn--ghost"
								onClick={ () => setExpanded( false ) }
							>
								{ __( 'Cancel', 'joist' ) }
							</button>
						) }
					</div>
					<p className="joist-settings__hint">
						Saved to the <code>joist_claude_api_key</code> option (not autoloaded).
						Anthropic console:{ ' ' }
						<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
							console.anthropic.com/settings/keys
						</a>
					</p>
				</div>
			) }

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

			<McpInfoCard />
		</section>
	);
}
