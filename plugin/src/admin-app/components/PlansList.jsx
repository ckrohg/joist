/**
 * @purpose DataViews-driven list of plans.
 *
 * Fields (WAVE_0 §5):
 *   Plan ID    — primary, click → open detail view (state lift to App.jsx)
 *   Intent     — natural-language summary (plan.intent)
 *   Status     — pending / approved / executing / completed / failed / rejected / expired
 *   Created    — relative time
 *   Steps      — count + first 2 step type chips
 *   Blast      — severity badge (planned blast radius rollup)
 *
 * Default layout: list (per WAVE_0 §5 / Stream D synthesis).
 *
 * Actions:
 *   Approve  — isEligible: status === 'pending' (or 'awaiting_approval')
 *   Reject   — isEligible: status in ['pending','approved']
 *   Execute  — isEligible: status === 'approved'
 *   Open     — always; primary row action (the click target)
 *
 * Bulk: "Approve selected" / "Reject selected" — fire one POST per row,
 * with a typed-error tolerance (one failing plan does not block the rest).
 *
 * Note: the backend `PlanStore::listRecent` returns rows without their step
 * arrays (only the summary columns). To render the "Steps" / "Blast radius"
 * columns we accept the steps as `undefined` and render a graceful "—" + a
 * tooltip. A future endpoint expansion could `JOIN` or include a `step_count`
 * + `step_ops` summary; the UI is forward-compatible.
 */

import { useMemo, useState } from '@wordpress/element';
import { DataViews } from '@wordpress/dataviews';
import { Button, Notice } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

import BlastRadiusBadge from './BlastRadiusBadge.jsx';
import { classifyPlan } from '../lib/blastRadius.js';
import { stepShortLabel } from '../lib/stepTypes.js';
import { relativeTime } from '../lib/relativeTime.js';
import {
	approvePlan,
	rejectPlan,
	executePlan,
	deletePlan,
	JoistApiError,
} from '../api/plans.js';
import './PlansList.scss';

const TERMINAL_STATUSES = [ 'completed', 'failed', 'rejected', 'expired' ];

function statusLabel( s ) {
	switch ( s ) {
		case 'pending':            return __( 'Awaiting approval', 'joist' );
		case 'awaiting_approval':  return __( 'Awaiting approval', 'joist' );
		case 'approved':           return __( 'Approved', 'joist' );
		case 'executing':          return __( 'Executing', 'joist' );
		case 'completed':          return __( 'Completed', 'joist' );
		case 'executed':           return __( 'Completed', 'joist' );
		case 'failed':             return __( 'Failed', 'joist' );
		case 'rejected':           return __( 'Rejected', 'joist' );
		case 'expired':            return __( 'Expired', 'joist' );
		default:                   return s || __( 'Unknown', 'joist' );
	}
}

function StatusPill( { value } ) {
	const cls = `joist-statuspill joist-statuspill--${ value || 'unknown' }`;
	return <span className={ cls }>{ statusLabel( value ) }</span>;
}

function StepsCell( { plan } ) {
	const steps = Array.isArray( plan?.steps ) ? plan.steps : null;
	const count = steps ? steps.length : plan?.step_count ?? null;
	if ( count == null ) return <span className="joist-plans__steps">—</span>;
	const previews = steps
		? steps.slice( 0, 2 ).map( ( s, i ) => (
				<span key={ i } className="joist-plans__chip">
					{ stepShortLabel( s ) }
				</span>
		  ) )
		: null;
	return (
		<span className="joist-plans__steps">
			<span className="joist-plans__count">
				{ sprintf(
					/* translators: %d: step count */
					__( '%d step(s)', 'joist' ),
					count
				) }
			</span>
			{ previews && previews.length > 0 && (
				<span className="joist-plans__chips">{ previews }</span>
			) }
		</span>
	);
}

function BlastCell( { plan } ) {
	const steps = Array.isArray( plan?.steps ) ? plan.steps : null;
	if ( ! steps ) {
		return <span className="joist-plans__blast-unknown">—</span>;
	}
	const verdict = classifyPlan( steps );
	return <BlastRadiusBadge verdict={ verdict } compact />;
}

export default function PlansList( {
	plans,
	onOpenPlan,
	onReload,
} ) {
	const [ view, setView ] = useState( {
		type: 'list',
		page: 1,
		perPage: 25,
		search: '',
		fields: [ 'intent', 'status', 'created', 'steps', 'blast' ],
		layout: {},
	} );

	const [ bulkBusy, setBulkBusy ] = useState( false );
	const [ bulkError, setBulkError ] = useState( null );

	// DataViews expects items to have a stable id key. `plan.id` is the
	// canonical id from PlanStore; some envelopes use `plan_id`. Normalize.
	const data = useMemo(
		() =>
			( plans || [] ).map( ( p ) => ( {
				...p,
				id: p.id || p.plan_id,
			} ) ),
		[ plans ]
	);

	const fields = useMemo(
		() => [
			{
				id: 'id',
				label: __( 'Plan ID', 'joist' ),
				enableHiding: false,
				render: ( { item } ) => (
					<button
						type="button"
						className="joist-plans__id"
						onClick={ () => onOpenPlan && onOpenPlan( item ) }
						aria-label={ sprintf(
							/* translators: %s: plan id */
							__( 'Open plan %s', 'joist' ),
							item.id
						) }
					>
						<code>{ item.id }</code>
					</button>
				),
				enableGlobalSearch: true,
			},
			{
				id: 'intent',
				label: __( 'Intent', 'joist' ),
				render: ( { item } ) => (
					<span className="joist-plans__intent">
						{ item.intent || <em>—</em> }
					</span>
				),
				enableGlobalSearch: true,
			},
			{
				id: 'status',
				label: __( 'Status', 'joist' ),
				render: ( { item } ) => <StatusPill value={ item.status } />,
				elements: [
					{ value: 'pending', label: __( 'Awaiting approval', 'joist' ) },
					{ value: 'approved', label: __( 'Approved', 'joist' ) },
					{ value: 'executing', label: __( 'Executing', 'joist' ) },
					{ value: 'completed', label: __( 'Completed', 'joist' ) },
					{ value: 'failed', label: __( 'Failed', 'joist' ) },
					{ value: 'rejected', label: __( 'Rejected', 'joist' ) },
					{ value: 'expired', label: __( 'Expired', 'joist' ) },
				],
				filterBy: { operators: [ 'is', 'isNot', 'isAny', 'isNone' ] },
			},
			{
				id: 'created',
				label: __( 'Created', 'joist' ),
				render: ( { item } ) => (
					<span className="joist-plans__created" title={ item.created_at || '' }>
						{ relativeTime( item.created_at ) || '—' }
					</span>
				),
				enableSorting: true,
			},
			{
				id: 'steps',
				label: __( 'Steps', 'joist' ),
				render: ( { item } ) => <StepsCell plan={ item } />,
			},
			{
				id: 'blast',
				label: __( 'Blast radius', 'joist' ),
				render: ( { item } ) => <BlastCell plan={ item } />,
			},
		],
		[ onOpenPlan ]
	);

	const actions = useMemo(
		() => [
			{
				id: 'open',
				label: __( 'Open', 'joist' ),
				isPrimary: true,
				icon: 'visibility',
				callback: ( items ) => {
					if ( items.length === 1 && onOpenPlan ) onOpenPlan( items[ 0 ] );
				},
			},
			{
				id: 'approve',
				label: __( 'Approve', 'joist' ),
				supportsBulk: true,
				icon: 'yes-alt',
				isEligible: ( item ) =>
					item.status === 'pending' || item.status === 'awaiting_approval',
				callback: async ( items ) => {
					await runBulk( items, ( i ) =>
						approvePlan( i.id, { approval_token: i.approval_token || '' } )
					);
				},
			},
			{
				id: 'execute',
				label: __( 'Execute', 'joist' ),
				icon: 'controls-play',
				isEligible: ( item ) => item.status === 'approved',
				callback: async ( items ) => {
					await runBulk( items, ( i ) => executePlan( i.id ) );
				},
			},
			{
				id: 'reject',
				label: __( 'Reject', 'joist' ),
				supportsBulk: true,
				icon: 'no',
				isDestructive: true,
				isEligible: ( item ) =>
					! TERMINAL_STATUSES.includes( String( item.status || '' ) ),
				callback: async ( items ) => {
					const reason = window.prompt(
						__( 'Rejection note (optional)', 'joist' ),
						''
					);
					if ( reason === null ) return; // user cancelled
					await runBulk( items, ( i ) =>
						rejectPlan( i.id, {
							approval_token: i.approval_token || '',
							note: reason,
						} )
					);
				},
			},
			{
				id: 'delete',
				label: __( 'Delete', 'joist' ),
				supportsBulk: true,
				icon: 'trash',
				isDestructive: true,
				callback: async ( items ) => {
					const count = items.length;
					const ok = window.confirm(
						count === 1
							? __( 'Permanently delete this plan? This cannot be undone.', 'joist' )
							: `Permanently delete ${ count } plans? This cannot be undone.`
					);
					if ( ! ok ) return;
					await runBulk( items, ( i ) => deletePlan( i.id ) );
					if ( onReload ) await onReload();
				},
			},
		],
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[ onOpenPlan, onReload ]
	);

	async function runBulk( items, fn ) {
		setBulkBusy( true );
		setBulkError( null );
		const failures = [];
		for ( const item of items ) {
			try {
				await fn( item );
			} catch ( e ) {
				failures.push( { id: item.id, error: e } );
			}
		}
		setBulkBusy( false );
		if ( failures.length > 0 ) {
			setBulkError(
				new JoistApiError( {
					code: 'bulk.partial_failure',
					message: sprintf(
						/* translators: 1: count of failures, 2: count of attempts */
						__( '%1$d of %2$d failed', 'joist' ),
						failures.length,
						items.length
					),
					details: failures,
				} )
			);
		}
		if ( onReload ) await onReload();
	}

	const paginationInfo = {
		totalItems: data.length,
		totalPages: Math.max( 1, Math.ceil( data.length / ( view.perPage || 25 ) ) ),
	};

	return (
		<div className="joist-plans">
			<div className="joist-plans__pagetitle">
				<h1>
					Plan <em>queue</em>
				</h1>
				<span className="j-eyebrow">
					{ data.length } { data.length === 1 ? 'plan' : 'plans' }
				</span>
			</div>
			{ bulkError && (
				<Notice
					status="warning"
					isDismissible
					onRemove={ () => setBulkError( null ) }
				>
					<strong>{ bulkError.message }</strong>
					{ Array.isArray( bulkError.details ) && (
						<ul className="joist-plans__bulk-errors">
							{ bulkError.details.map( ( f ) => (
								<li key={ f.id }>
									<code>{ f.id }</code>:{ ' ' }
									{ f.error?.message || String( f.error ) }
								</li>
							) ) }
						</ul>
					) }
				</Notice>
			) }
			{ bulkBusy && (
				<div className="joist-plans__busy">
					{ __( 'Running bulk action…', 'joist' ) }
				</div>
			) }
			{ data.length === 0 ? (
				<EmptyState onReload={ onReload } />
			) : (
				<DataViews
					data={ data }
					view={ view }
					onChangeView={ setView }
					fields={ fields }
					actions={ actions }
					getItemId={ ( item ) => item.id }
					paginationInfo={ paginationInfo }
					defaultLayouts={ {
						list: {},
						table: {},
					} }
					search
					searchLabel={ __( 'Search plans', 'joist' ) }
				/>
			) }
		</div>
	);
}

function EmptyState( { onReload } ) {
	return (
		<div className="joist-plans__empty">
			<div className="joist-plans__empty-glyph" aria-hidden="true">
				<svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
					<rect x="6" y="14" width="44" height="3" rx="1.5" fill="currentColor" opacity="0.35" />
					<rect x="6" y="26.5" width="32" height="3" rx="1.5" fill="currentColor" opacity="0.22" />
					<rect x="6" y="39" width="20" height="3" rx="1.5" fill="currentColor" opacity="0.14" />
				</svg>
			</div>
			<h2 className="joist-plans__empty-title j-display">
				No plans <em className="j-display--italic">yet</em>.
			</h2>
			<p className="joist-plans__empty-hint">
				{ __(
					'Plans appear here when an agent submits work. Approve each one before anything writes — no silent execution.',
					'joist'
				) }
			</p>
			{ onReload && (
				<Button variant="tertiary" onClick={ onReload } className="joist-plans__empty-reload">
					{ __( '↻ Refresh', 'joist' ) }
				</Button>
			) }
		</div>
	);
}
