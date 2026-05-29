/**
 * @purpose Structured-fields modal for editing a single plan step.
 *
 * Per WAVE_0 §5: refinement is "edit-the-plan (structured form) > reject-and-
 * reprompt." A free-text body invites slop; per-step structured fields keep
 * the agent honest.
 *
 * Implementation note (DataForm):
 *   The Wave 0 spec calls for `<DataForm>` from `@wordpress/dataform`. As
 *   of WP 7.0 the DataForm component ships inside `@wordpress/dataviews`,
 *   but the package.json in this repo (W5a) pins dataviews ^5.30 which
 *   does not yet re-export DataForm in a stable API. To avoid a runtime
 *   dep change in W5b (constraint: no new external runtime deps), this
 *   modal renders the structured fields directly with primitive
 *   `@wordpress/components` controls. The field schemas are kept as a
 *   plain data structure so swapping to DataForm later is mechanical.
 *
 * Refuse-not-corrupt (failure_mode_constraints #16):
 *   If the per-step backend endpoint (POST /plans/{id}/steps/{index}) is
 *   not yet implemented, this modal will:
 *     a. attempt the patch
 *     b. surface a typed error if it 404s ('rest_no_route')
 *     c. NOT fall back to a destructive full-plan replace
 *   The user keeps their edits in form state and can cancel cleanly.
 */

import { useState } from '@wordpress/element';
import {
	Modal,
	Button,
	TextControl,
	TextareaControl,
	SelectControl,
	ColorPicker,
	Notice,
	Spinner,
	__experimentalText as Text,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import { stepTypeKey, stepTypeMeta, STEP_TYPES } from '../lib/stepTypes.js';
import { updatePlanStep, JoistApiError } from '../api/plans.js';
import './EditStepModal.scss';

/**
 * Field schemas per step type. Each entry is a list of fields the modal
 * renders. Field kinds: 'string' | 'textarea' | 'json' | 'select' | 'color' | 'number'.
 */
const FIELD_SCHEMAS = {
	create_page: [
		{ name: 'title', label: __( 'Title', 'joist' ), kind: 'string', required: true },
		{ name: 'slug', label: __( 'Slug', 'joist' ), kind: 'string' },
		{
			name: 'template',
			label: __( 'Template', 'joist' ),
			kind: 'select',
			options: [
				{ value: '', label: __( 'Default', 'joist' ) },
				{ value: 'blank', label: __( 'Blank', 'joist' ) },
				{ value: 'canvas', label: __( 'Elementor Canvas', 'joist' ) },
				{ value: 'full-width', label: __( 'Full Width', 'joist' ) },
			],
		},
	],
	add_widget: [
		{
			name: 'widget_type',
			label: __( 'Widget type', 'joist' ),
			kind: 'select',
			options: [
				{ value: 'heading', label: 'heading' },
				{ value: 'text-editor', label: 'text-editor' },
				{ value: 'button', label: 'button' },
				{ value: 'image', label: 'image' },
				{ value: 'spacer', label: 'spacer' },
				{ value: 'divider', label: 'divider' },
				{ value: 'icon', label: 'icon' },
				{ value: 'video', label: 'video' },
			],
			required: true,
		},
		{ name: 'target_container_id', label: __( 'Target container id', 'joist' ), kind: 'string' },
		{
			name: 'settings',
			label: __( 'Settings (JSON)', 'joist' ),
			kind: 'json',
			placeholder: '{"title": "My heading"}',
		},
	],
	insert: [
		{ name: 'element_id', label: __( 'Parent element id', 'joist' ), kind: 'string', required: true },
		{
			name: 'element',
			label: __( 'Element payload (JSON)', 'joist' ),
			kind: 'json',
			placeholder: '{"elType":"widget","widgetType":"heading","settings":{"title":"Hello"}}',
			required: true,
		},
	],
	update_settings: [
		{ name: 'element_id', label: __( 'Element id', 'joist' ), kind: 'string', required: true },
		{
			name: 'settings',
			label: __( 'Settings patch (JSON)', 'joist' ),
			kind: 'json',
			placeholder: '{"title": "Updated title"}',
			required: true,
		},
	],
	update_global_color: [
		{ name: 'token_name', label: __( 'Token name', 'joist' ), kind: 'string', required: true },
		{ name: 'new_value', label: __( 'New color', 'joist' ), kind: 'color', required: true },
	],
	update_global_font: [
		{ name: 'token_name', label: __( 'Token name', 'joist' ), kind: 'string', required: true },
		{ name: 'new_value', label: __( 'New font family', 'joist' ), kind: 'string', required: true },
	],
	delete: [
		{ name: 'element_id', label: __( 'Element id', 'joist' ), kind: 'string', required: true },
	],
	move: [
		{ name: 'element_id', label: __( 'Element id', 'joist' ), kind: 'string', required: true },
		{ name: 'target_parent_id', label: __( 'New parent id', 'joist' ), kind: 'string', required: true },
		{ name: 'position', label: __( 'Position', 'joist' ), kind: 'number' },
	],
};

/**
 * Get the active schema for a step. Unknown types get a generic "raw JSON"
 * fallback so the user can still inspect + edit, but it's flagged.
 */
function schemaForStep( step ) {
	const key = stepTypeKey( step );
	if ( FIELD_SCHEMAS[ key ] ) return { key, fields: FIELD_SCHEMAS[ key ], known: true };
	return {
		key,
		known: false,
		fields: [
			{
				name: '__raw',
				label: __( 'Raw step payload (JSON)', 'joist' ),
				kind: 'json',
			},
		],
	};
}

function readValue( step, field ) {
	if ( ! step ) return '';
	if ( field.name === '__raw' ) {
		try {
			return JSON.stringify( step, null, 2 );
		} catch ( e ) {
			return '';
		}
	}
	const v = step[ field.name ];
	if ( field.kind === 'json' ) {
		if ( v === undefined || v === null ) return '';
		if ( typeof v === 'string' ) return v;
		try {
			return JSON.stringify( v, null, 2 );
		} catch ( e ) {
			return '';
		}
	}
	if ( v === undefined || v === null ) return '';
	return String( v );
}

/**
 * Build the patch object the backend will see, by applying typed coercion
 * back from string state to canonical types. JSON fields parse; if a JSON
 * field is invalid, returns null so the submit handler can surface it.
 */
function buildPatch( values, schema ) {
	if ( ! schema.known ) {
		// Single raw-JSON field — caller submits a full replacement.
		try {
			return JSON.parse( values.__raw || '{}' );
		} catch ( e ) {
			return null;
		}
	}
	const out = { op: schema.key };
	for ( const field of schema.fields ) {
		const v = values[ field.name ];
		if ( v === undefined ) continue;
		if ( field.kind === 'json' ) {
			if ( v === '' ) continue;
			try {
				out[ field.name ] = JSON.parse( v );
			} catch ( e ) {
				return null;
			}
			continue;
		}
		if ( field.kind === 'number' ) {
			if ( v === '' ) continue;
			out[ field.name ] = Number( v );
			continue;
		}
		out[ field.name ] = v;
	}
	return out;
}

export default function EditStepModal( {
	plan,
	step,
	stepIndex,
	onClose,
	onSaved,
} ) {
	const schema = schemaForStep( step );
	const meta = stepTypeMeta( schema.key );

	const [ values, setValues ] = useState( () => {
		const initial = {};
		for ( const f of schema.fields ) {
			initial[ f.name ] = readValue( step, f );
		}
		return initial;
	} );
	const [ submitting, setSubmitting ] = useState( false );
	const [ error, setError ] = useState( null );

	const update = ( name, value ) =>
		setValues( ( prev ) => ( { ...prev, [ name ]: value } ) );

	const handleSubmit = async ( e ) => {
		if ( e && e.preventDefault ) e.preventDefault();
		setError( null );

		// Required-field validation.
		for ( const field of schema.fields ) {
			if (
				field.required &&
				( values[ field.name ] === undefined ||
					String( values[ field.name ] ).trim() === '' )
			) {
				setError(
					new JoistApiError( {
						code: 'validation.required',
						message: `${ field.label } is required`,
					} )
				);
				return;
			}
		}

		const patch = buildPatch( values, schema );
		if ( patch === null ) {
			setError(
				new JoistApiError( {
					code: 'validation.invalid_json',
					message: __( 'One of the JSON fields is invalid.', 'joist' ),
				} )
			);
			return;
		}

		setSubmitting( true );
		try {
			const result = await updatePlanStep( plan.id || plan.plan_id, stepIndex, patch );
			onSaved && onSaved( result );
			onClose && onClose();
		} catch ( err ) {
			setError( err );
		} finally {
			setSubmitting( false );
		}
	};

	const isMissingBackend =
		error instanceof JoistApiError &&
		( error.code === 'rest_no_route' ||
			error.status === 404 ||
			( error.message && /rest_no_route|no route/i.test( error.message ) ) );

	return (
		<Modal
			title={ `${ __( 'Edit step', 'joist' ) }: ${ meta.label }` }
			onRequestClose={ onClose }
			className="joist-editstep-modal"
		>
			<form onSubmit={ handleSubmit } className="joist-editstep">
				{ ! schema.known && (
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'Unknown step type — falling back to raw JSON editing. Submitting will attempt a full step replacement, which the backend may reject.',
							'joist'
						) }
					</Notice>
				) }
				{ isMissingBackend && (
					<Notice status="error" isDismissible={ false }>
						<strong>
							{ __( 'Per-step edits require a newer backend.', 'joist' ) }
						</strong>
						<div>
							{ __(
								'POST /joist/v1/plans/{id}/steps/{index} is not registered on this site. To avoid a destructive full-plan replace, this modal will not silently fall back — see the v0.9 backlog. Cancel and revise via Reject + re-plan instead.',
								'joist'
							) }
						</div>
					</Notice>
				) }
				{ error && ! isMissingBackend && (
					<Notice status="error" isDismissible={ false }>
						<strong>
							{ error instanceof JoistApiError
								? `${ error.code }: ${ error.message }`
								: error.message }
						</strong>
					</Notice>
				) }
				<div className="joist-editstep__fields">
					{ schema.fields.map( ( field ) =>
						renderField(
							field,
							values[ field.name ],
							( v ) => update( field.name, v )
						)
					) }
				</div>
				<div className="joist-editstep__actions">
					<Button variant="tertiary" onClick={ onClose } disabled={ submitting }>
						{ __( 'Cancel', 'joist' ) }
					</Button>
					<Button variant="primary" type="submit" isBusy={ submitting } disabled={ submitting }>
						{ submitting ? <Spinner /> : __( 'Save step', 'joist' ) }
					</Button>
				</div>
				<Text variant="muted" size={ 11 }>
					{ __( 'Step type', 'joist' ) }: <code>{ schema.key }</code>
					{ ' • ' }
					{ __( 'Index', 'joist' ) }: <code>{ String( stepIndex ) }</code>
				</Text>
			</form>
		</Modal>
	);
}

// Keep the unused-warning quiet — STEP_TYPES is intentionally re-exported for
// consumers wanting the full taxonomy.
void STEP_TYPES;

function renderField( field, value, onChange ) {
	const key = `field-${ field.name }`;
	if ( field.kind === 'select' ) {
		return (
			<SelectControl
				key={ key }
				label={ field.label }
				value={ value || '' }
				options={ field.options || [] }
				onChange={ onChange }
				__nextHasNoMarginBottom
			/>
		);
	}
	if ( field.kind === 'textarea' || field.kind === 'json' ) {
		return (
			<TextareaControl
				key={ key }
				label={ field.label }
				value={ value || '' }
				onChange={ onChange }
				placeholder={ field.placeholder || '' }
				rows={ field.kind === 'json' ? 8 : 4 }
				__nextHasNoMarginBottom
			/>
		);
	}
	if ( field.kind === 'color' ) {
		return (
			<div key={ key } className="joist-editstep__color">
				<div className="joist-editstep__color-label">{ field.label }</div>
				<ColorPicker
					color={ value || '#000000' }
					onChange={ ( v ) => onChange( typeof v === 'string' ? v : v?.hex || '' ) }
					enableAlpha={ false }
				/>
			</div>
		);
	}
	if ( field.kind === 'number' ) {
		return (
			<TextControl
				key={ key }
				type="number"
				label={ field.label }
				value={ value || '' }
				onChange={ onChange }
				__nextHasNoMarginBottom
			/>
		);
	}
	return (
		<TextControl
			key={ key }
			label={ field.label }
			value={ value || '' }
			onChange={ onChange }
			placeholder={ field.placeholder || '' }
			__nextHasNoMarginBottom
		/>
	);
}
