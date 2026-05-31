/**
 * @purpose Screenshot-to-plan surface — cheap substitute for the full clone
 *          pipeline (specs/CLONE_PIPELINE.md needs headless Chromium + DOM
 *          extraction; this path is "upload 1-3 PNGs, get back a V3 Plan").
 *
 * Foundry-styled drop-zone / file picker. User drops up to 3 images
 * (≤ 5 MB each, PNG/JPG only), optionally adds notes, hits "Clone this →".
 * Calls POST /plans/clone-from-screenshots which routes through the
 * CloneGenerator (Claude Opus 4.7 vision, with a template-mode fallback).
 *
 * On success calls the same onPlanCreated callback that GenerateBox uses,
 * so the new plan auto-opens in the detail view exactly like a prompt-
 * generated plan.
 *
 * Constraints (mirrored server-side):
 *   - Max 3 files
 *   - Max 5 MB per file
 *   - Only image/png and image/jpeg
 *   - No new npm dependencies — vanilla <input type=file> + native drag/drop
 */

import { useState, useCallback, useRef } from '@wordpress/element';
import { Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { cloneFromScreenshots, JoistApiError } from '../api/plans.js';
import './CloneBox.scss';

const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED_MIMES = [ 'image/png', 'image/jpeg' ];

function validateFiles( fileList ) {
	const files = Array.from( fileList || [] );
	if ( files.length === 0 ) {
		return { ok: false, message: 'No files selected.' };
	}
	if ( files.length > MAX_FILES ) {
		return {
			ok: false,
			message: `A maximum of ${ MAX_FILES } images is supported.`,
		};
	}
	for ( const file of files ) {
		if ( ! ACCEPTED_MIMES.includes( file.type ) ) {
			return {
				ok: false,
				message: `${ file.name } is ${
					file.type || 'an unknown type'
				}; only PNG or JPEG are accepted.`,
			};
		}
		if ( file.size > MAX_BYTES ) {
			return {
				ok: false,
				message: `${ file.name } is ${ Math.round(
					file.size / 1024 / 1024
				) } MB; max is 5 MB.`,
			};
		}
	}
	return { ok: true, files };
}

export default function CloneBox( { defaultPageId, onPlanCreated } ) {
	const [ files, setFiles ] = useState( [] );
	const [ previews, setPreviews ] = useState( [] );
	const [ intent, setIntent ] = useState( '' );
	const [ pageId, setPageId ] = useState(
		defaultPageId ? String( defaultPageId ) : ''
	);
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState( null );
	const [ dragOver, setDragOver ] = useState( false );
	const inputRef = useRef( null );

	const acceptFiles = useCallback( ( fileList ) => {
		const result = validateFiles( fileList );
		if ( ! result.ok ) {
			setError( { message: result.message } );
			return;
		}
		setError( null );
		setFiles( result.files );
		// Generate object-URL previews; cleanup happens when component
		// unmounts or files change (effect would be ideal but we're keeping
		// this minimal — the URLs are short-lived and small).
		setPreviews(
			result.files.map( ( f ) => ( {
				name: f.name,
				size: f.size,
				url: URL.createObjectURL( f ),
			} ) )
		);
	}, [] );

	const onPick = useCallback(
		( e ) => {
			acceptFiles( e.target.files );
			// Reset value so re-selecting the same file re-fires onChange.
			if ( inputRef.current ) inputRef.current.value = '';
		},
		[ acceptFiles ]
	);

	const onDrop = useCallback(
		( e ) => {
			e.preventDefault();
			setDragOver( false );
			acceptFiles( e.dataTransfer?.files );
		},
		[ acceptFiles ]
	);

	const submit = useCallback( async () => {
		if ( files.length === 0 ) {
			setError( {
				message: 'Pick at least one screenshot to clone from.',
			} );
			return;
		}
		setBusy( true );
		setError( null );
		try {
			const fd = new FormData();
			for ( const f of files ) {
				fd.append( 'images[]', f, f.name );
			}
			const trimmed = intent.trim();
			if ( trimmed ) fd.append( 'intent', trimmed );
			const pid = parseInt( pageId, 10 );
			if ( Number.isFinite( pid ) && pid > 0 ) {
				fd.append( 'page_id', String( pid ) );
			}
			const plan = await cloneFromScreenshots( fd );
			// Cleanup previews + reset.
			previews.forEach( ( p ) => URL.revokeObjectURL( p.url ) );
			setFiles( [] );
			setPreviews( [] );
			setIntent( '' );
			if ( onPlanCreated ) onPlanCreated( plan );
		} catch ( e ) {
			setError(
				e instanceof JoistApiError
					? { code: e.code, message: e.message }
					: { message: e?.message || 'Failed to clone screenshots.' }
			);
		} finally {
			setBusy( false );
		}
	}, [ files, previews, intent, pageId, onPlanCreated ] );

	return (
		<section
			className="joist-clone"
			aria-label={ __( 'Clone from screenshots', 'joist' ) }
		>
			<div className="joist-clone__head">
				<span className="j-eyebrow">Clone from screenshot</span>
				<h2 className="joist-clone__title j-display">
					Drop a page, get a{ ' ' }
					<em className="j-display--italic">plan</em>.
				</h2>
				<p className="joist-clone__subhead">
					Up to 3 PNGs or JPEGs (≤ 5 MB each). Joist clones the
					structure at roughly 75% fidelity — hierarchy, density,
					typographic rhythm. Not pixel-perfect.
				</p>
			</div>

			<div className="joist-clone__form">
				<div
					className={ `joist-clone__drop${
						dragOver ? ' is-dragover' : ''
					}${ files.length > 0 ? ' has-files' : '' }` }
					onDragOver={ ( e ) => {
						e.preventDefault();
						setDragOver( true );
					} }
					onDragLeave={ () => setDragOver( false ) }
					onDrop={ onDrop }
					onClick={ () => inputRef.current?.click() }
					role="button"
					tabIndex={ 0 }
					onKeyDown={ ( e ) => {
						if ( e.key === 'Enter' || e.key === ' ' ) {
							e.preventDefault();
							inputRef.current?.click();
						}
					} }
				>
					<input
						ref={ inputRef }
						type="file"
						multiple
						accept="image/png,image/jpeg"
						onChange={ onPick }
						className="joist-clone__file"
					/>
					{ previews.length === 0 ? (
						<div className="joist-clone__prompt">
							<span className="j-eyebrow">Drop or pick</span>
							<span className="joist-clone__prompt-text">
								Drag images here or click to browse
							</span>
							<span className="joist-clone__prompt-hint">
								PNG / JPG · max 3 · ≤ 5 MB each
							</span>
						</div>
					) : (
						<ul className="joist-clone__previews">
							{ previews.map( ( p ) => (
								<li
									key={ p.url }
									className="joist-clone__preview"
								>
									<img src={ p.url } alt={ p.name } />
									<div className="joist-clone__preview-meta">
										<span className="joist-clone__preview-name">
											{ p.name }
										</span>
										<span className="joist-clone__preview-size j-mono">
											{ Math.round( p.size / 1024 ) } KB
										</span>
									</div>
								</li>
							) ) }
						</ul>
					) }
				</div>

				<label className="joist-clone__field">
					<span className="j-eyebrow">Extra notes (optional)</span>
					<textarea
						className="joist-clone__textarea"
						value={ intent }
						onChange={ ( e ) => setIntent( e.target.value ) }
						placeholder="Anything to emphasize — copy direction, sections to skip, brand tone…"
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
							onChange={ ( e ) =>
								setPageId( e.target.value )
							}
							placeholder="(new page)"
						/>
					</label>

					<button
						type="button"
						className="joist-clone__submit"
						onClick={ submit }
						disabled={ busy || files.length === 0 }
					>
						{ busy
							? __( 'Cloning…', 'joist' )
							: __( 'Clone this →', 'joist' ) }
					</button>
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
