/**
 * @purpose Plan-detail view — per-step DataViews + Approve/Reject + step-level Edit/Diff modals.
 *
 * Companion to PlansList. Opened when a row in the plans list is selected;
 * subscribes via usePlanPolling so an executing plan animates its rows.
 *
 * Per-step actions per WAVE_0 §5:
 *   Edit         → EditStepModal (structured DataForm)
 *   Show diff    → StepDiff (preview iframe + JSON-tree diff)
 *   Skip         → local toggle (UI-only; W5b backend lacks step-skip endpoint)
 *   Run only     → backend has /plans/{id}/execute; per-step execute is v0.9
 *
 * Plan-level Approve / Reject hit the existing REST endpoints.
 */

import { useCallback, useMemo, useState } from '@wordpress/element';
import { DataViews } from '@wordpress/dataviews';
import {
	Button,
	Card,
	CardHeader,
	CardBody,
	CardFooter,
	Flex,
	FlexItem,
	Notice,
	Spinner,
	TextareaControl,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

import BlastRadiusBadge from './BlastRadiusBadge.jsx';
import StepTargetCell from './StepTargetCell.jsx';
import EditStepModal from './EditStepModal.jsx';
import StepDiff from './StepDiff.jsx';
import { classifyStep } from '../lib/blastRadius.js';
import { stepShortLabel } from '../lib/stepTypes.js';
import { relativeTime } from '../lib/relativeTime.js';
import { usePlanPolling } from '../hooks/usePlanPolling.js';
import { approvePlan, rejectPlan, JoistApiError } from '../api/plans.js';

const STATUS_APPROVABLE = [ 'pending', 'awaiting_approval' ];
const STATUS_REJECTABLE = [ 'pending', 'awaiting_approval', 'approved' ];

export default function PlanDetail( { planId, onBack, onMutated } ) {
	const { plan, loading, error, refresh } = usePlanPolling( planId, {} );
	const reload = refresh;

	const [ editingStep, setEditingStep ] = useState( null );
	const [ diffingStep, setDiffingStep ] = useState( null );
	const [ skipped, setSkipped ] = useState( () => new Set() );
	const [ busy, setBusy ] = useState( false );
	const [ actionError, setActionError ] = useState( null );
	const [ rejectReason, setRejectReason ] = useState( '' );
	const [ showRejectForm, setShowRejectForm ] = useState( false );

	const steps = Array.isArray( plan?.steps ) ? plan.steps : [];

	const rows = useMemo(
		() =>
			steps.map( ( step, index ) => ( {
				id: `${ planId }:${ index }`,
				index,
				step,
				skipped: skipped.has( index ),
			} ) ),
		[ steps, skipped, planId ]
	);

	const [ view, setView ] = useState( {
		type: 'list',
		page: 1,
		perPage: 100,
		search: '',
		fields: [ 'type', 'target', 'blast', 'skipped' ],
		layout: {},
	} );

	const fields = useMemo(
		() => [
			{
				id: 'type',
				label: __( 'Step', 'joist' ),
				render: ( { item } ) => (
					<span className="joist-stepcell__type">
						{ sprintf( '#%d ', item.index + 1 ) }
						{ stepShortLabel( item.step ) }
					</span>
				),
			},
			{
				id: 'target',
				label: __( 'Target', 'joist' ),
				render: ( { item } ) => <StepTargetCell step={ item.step } />,
			},
			{
				id: 'blast',
				label: __( 'Blast radius', 'joist' ),
				render: ( { item } ) => (
					<BlastRadiusBadge verdict={ classifyStep( item.step ) } compact />
				),
			},
			{
				id: 'skipped',
				label: __( 'Status', 'joist' ),
				render: ( { item } ) =>
					item.skipped ? (
						<span className="joist-step--skipped">{ __( 'Skipped', 'joist' ) }</span>
					) : (
						<span className="joist-step--included">{ __( 'Included', 'joist' ) }</span>
					),
			},
		],
		[]
	);

	const actions = useMemo(
		() => [
			{
				id: 'edit',
				label: __( 'Edit', 'joist' ),
				isPrimary: true,
				callback: ( items ) => setEditingStep( items[ 0 ] ),
			},
			{
				id: 'diff',
				label: __( 'Show diff', 'joist' ),
				callback: ( items ) => setDiffingStep( items[ 0 ] ),
			},
			{
				id: 'skip',
				label: __( 'Skip / include', 'joist' ),
				callback: ( items ) => {
					const next = new Set( skipped );
					for ( const it of items ) {
						if ( next.has( it.index ) ) next.delete( it.index );
						else next.add( it.index );
					}
					setSkipped( next );
				},
			},
		],
		[ skipped ]
	);

	const onApprove = useCallback( async () => {
		setBusy( true );
		setActionError( null );
		try {
			await approvePlan( planId, {} );
			await reload();
			onMutated?.();
		} catch ( e ) {
			setActionError( e instanceof JoistApiError ? e.message : String( e ) );
		} finally {
			setBusy( false );
		}
	}, [ planId, reload, onMutated ] );

	const onReject = useCallback( async () => {
		setBusy( true );
		setActionError( null );
		try {
			await rejectPlan( planId, { reason: rejectReason || '(no reason provided)' } );
			await reload();
			onMutated?.();
			setShowRejectForm( false );
			setRejectReason( '' );
		} catch ( e ) {
			setActionError( e instanceof JoistApiError ? e.message : String( e ) );
		} finally {
			setBusy( false );
		}
	}, [ planId, rejectReason, reload, onMutated ] );

	if ( loading && ! plan ) {
		return (
			<Card>
				<CardBody>
					<Spinner />
					<span style={ { marginLeft: 8 } }>{ __( 'Loading plan…', 'joist' ) }</span>
				</CardBody>
			</Card>
		);
	}

	if ( error || ! plan ) {
		return (
			<Card>
				<CardBody>
					<Notice status="error" isDismissible={ false }>
						{ error?.message || __( 'Plan not found.', 'joist' ) }
					</Notice>
					<Button variant="secondary" onClick={ onBack }>
						{ __( 'Back to plans', 'joist' ) }
					</Button>
				</CardBody>
			</Card>
		);
	}

	const canApprove = STATUS_APPROVABLE.includes( plan.status );
	const canReject = STATUS_REJECTABLE.includes( plan.status );

	return (
		<>
			<Card className="joist-plan-detail">
				<CardHeader>
					<Flex justify="space-between" align="center">
						<FlexItem>
							<Button variant="tertiary" onClick={ onBack }>
								{ __( '← Back', 'joist' ) }
							</Button>
						</FlexItem>
						<FlexItem isBlock>
							<div className="joist-plan-detail__title">
								<strong>{ plan.intent || __( '(no intent)', 'joist' ) }</strong>
								<span className="joist-plan-detail__meta">
									{ ` · ${ plan.plan_id || plan.id || '' } · ` }
									{ relativeTime( plan.created_at || plan.created ) }
								</span>
							</div>
						</FlexItem>
					</Flex>
				</CardHeader>

				<CardBody>
					{ actionError && (
						<Notice
							status="error"
							onRemove={ () => setActionError( null ) }
						>
							{ actionError }
						</Notice>
					) }

					<DataViews
						data={ rows }
						fields={ fields }
						view={ view }
						onChangeView={ setView }
						actions={ actions }
						paginationInfo={ { totalItems: rows.length, totalPages: 1 } }
						defaultLayouts={ { list: {}, table: {} } }
						getItemId={ ( item ) => item.id }
					/>
				</CardBody>

				<CardFooter>
					<Flex justify="flex-end" gap={ 2 }>
						{ canApprove && (
							<Button
								variant="primary"
								isBusy={ busy }
								disabled={ busy }
								onClick={ onApprove }
							>
								{ skipped.size > 0
									? sprintf(
											/* translators: %d: count of included steps */
											__( 'Approve plan (%d steps)', 'joist' ),
											steps.length - skipped.size
									  )
									: __( 'Approve plan', 'joist' ) }
							</Button>
						) }
						{ canReject && ! showRejectForm && (
							<Button
								variant="secondary"
								isDestructive
								disabled={ busy }
								onClick={ () => setShowRejectForm( true ) }
							>
								{ __( 'Reject', 'joist' ) }
							</Button>
						) }
					</Flex>

					{ showRejectForm && (
						<div style={ { marginTop: 12 } }>
							<TextareaControl
								label={ __( 'Reason for rejection', 'joist' ) }
								value={ rejectReason }
								onChange={ setRejectReason }
								rows={ 2 }
							/>
							<Flex justify="flex-end" gap={ 2 }>
								<Button
									variant="tertiary"
									onClick={ () => {
										setShowRejectForm( false );
										setRejectReason( '' );
									} }
								>
									{ __( 'Cancel', 'joist' ) }
								</Button>
								<Button
									variant="primary"
									isDestructive
									isBusy={ busy }
									disabled={ busy }
									onClick={ onReject }
								>
									{ __( 'Confirm reject', 'joist' ) }
								</Button>
							</Flex>
						</div>
					) }
				</CardFooter>
			</Card>

			{ editingStep && (
				<EditStepModal
					plan={ plan }
					step={ editingStep.step }
					stepIndex={ editingStep.index }
					onClose={ () => setEditingStep( null ) }
					onSaved={ async () => {
						setEditingStep( null );
						await reload();
					} }
				/>
			) }

			{ diffingStep && (
				<StepDiff
					plan={ plan }
					step={ diffingStep.step }
					onClose={ () => setDiffingStep( null ) }
				/>
			) }
		</>
	);
}
