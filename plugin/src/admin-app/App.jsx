/**
 * @purpose Top-level component for the Joist Plan Mode admin app.
 *
 * Two views, swapped via local state (no router — this is a single admin page):
 *   list   → PlansList (DataViews of all plans, bulk actions)
 *   detail → PlanDetail (per-step DataViews, Edit / Show diff modals,
 *            Approve / Reject)
 *
 * Mode indicator (Read-only Plan Mode vs Execute Mode vs Observer) is mounted
 * at the top of both views — countermeasure to the Claude-Code-style
 * plan-mode-leakage class of bug.
 */

import { useCallback, useEffect, useState } from '@wordpress/element';
import { Card, CardBody, Notice, Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import { listPlans, JoistApiError } from './api/plans.js';
import PlansList from './components/PlansList.jsx';
import PlanDetail from './components/PlanDetail.jsx';
import JoistModeIndicator from './sidebar/JoistModeIndicator.jsx';
import './style.scss';

export default function App() {
	const [ status, setStatus ] = useState( 'loading' );
	const [ plans, setPlans ] = useState( [] );
	const [ error, setError ] = useState( null );
	const [ selectedPlanId, setSelectedPlanId ] = useState( null );

	const fetchPlans = useCallback( async () => {
		setStatus( 'loading' );
		setError( null );
		try {
			const result = await listPlans();
			const list = Array.isArray( result )
				? result
				: Array.isArray( result?.plans )
				? result.plans
				: [];
			setPlans( list );
			setStatus( 'ready' );
		} catch ( e ) {
			setError( e );
			setStatus( 'error' );
		}
	}, [] );

	useEffect( () => {
		let cancelled = false;
		( async () => {
			try {
				const result = await listPlans();
				if ( cancelled ) return;
				const list = Array.isArray( result )
					? result
					: Array.isArray( result?.plans )
					? result.plans
					: [];
				setPlans( list );
				setStatus( 'ready' );
			} catch ( e ) {
				if ( cancelled ) return;
				setError( e );
				setStatus( 'error' );
			}
		} )();
		return () => {
			cancelled = true;
		};
	}, [] );

	const openPlan = useCallback( ( plan ) => {
		setSelectedPlanId( plan?.plan_id || plan?.id || null );
	}, [] );

	const closePlan = useCallback( () => {
		setSelectedPlanId( null );
		fetchPlans();
	}, [ fetchPlans ] );

	return (
		<div className="joist-plan-mode">
			<JoistModeIndicator />

			{ status === 'loading' && (
				<Card>
					<CardBody>
						<Spinner />
						<span style={ { marginLeft: 8 } }>
							{ __( 'Loading plans…', 'joist' ) }
						</span>
					</CardBody>
				</Card>
			) }

			{ status === 'error' && (
				<Notice status="error" isDismissible={ false }>
					{ error instanceof JoistApiError
						? `${ error.code }: ${ error.message }`
						: error?.message || __( 'Failed to load plans.', 'joist' ) }
				</Notice>
			) }

			{ status === 'ready' && ! selectedPlanId && (
				<PlansList
					plans={ plans }
					onOpenPlan={ openPlan }
					onReload={ fetchPlans }
				/>
			) }

			{ status === 'ready' && selectedPlanId && (
				<PlanDetail
					planId={ selectedPlanId }
					onBack={ closePlan }
					onMutated={ fetchPlans }
				/>
			) }
		</div>
	);
}
