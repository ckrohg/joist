/**
 * @purpose Top-level component for the Joist Plan Mode admin app.
 *
 * Foundry-themed shell — warm dark + chartreuse + Engineering Editorial type.
 * Drops WP-admin default chrome inside our root via #joist-plan-mode-root
 * scoped styles (see design-system.scss).
 *
 * Two views, swapped via local state (no router — this is a single admin page):
 *   list   → PlansList (editorial cards, custom status pills)
 *   detail → PlanDetail (per-step DataViews, Edit / Show diff modals)
 *
 * Mode indicator sits at the top of every view — countermeasure to the
 * Claude-Code-style plan-mode-leakage class of bug (WAVE_0 §5).
 */

import { useCallback, useEffect, useState } from '@wordpress/element';
import { Notice, Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import { listPlans, JoistApiError } from './api/plans.js';
import PlansList from './components/PlansList.jsx';
import PlanDetail from './components/PlanDetail.jsx';
import JoistMark from './components/JoistMark.jsx';
import JoistModeIndicator from './sidebar/JoistModeIndicator.jsx';
import './design-system.scss';
import './components/JoistMark.scss';
import './style.scss';

export default function App() {
	const [ status, setStatus ] = useState( 'loading' );
	const [ plans, setPlans ] = useState( [] );
	const [ error, setError ] = useState( null );
	const [ selectedPlanId, setSelectedPlanId ] = useState( null );

	const fetchPlans = useCallback( async () => {
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
		fetchPlans();
	}, [ fetchPlans ] );

	const openPlan = useCallback( ( plan ) => {
		setSelectedPlanId( plan?.plan_id || plan?.id || null );
	}, [] );

	const closePlan = useCallback( () => {
		setSelectedPlanId( null );
		fetchPlans();
	}, [ fetchPlans ] );

	return (
		<div className="joist-app">
			<header className="joist-app__header">
				<div className="joist-app__brand">
					<JoistMark size="md" />
					<span className="joist-app__build">v0.9-α</span>
				</div>
				<JoistModeIndicator />
			</header>

			<main className="joist-app__main">
				{ status === 'loading' && (
					<div className="joist-loading">
						<Spinner />
						<span>{ __( 'Loading plans…', 'joist' ) }</span>
					</div>
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
			</main>

			<footer className="joist-app__footer">
				<span className="j-eyebrow">
					Joist · WP{ ' ' }
					<span className="j-mono">
						{ ( window.joistConfig || {} ).wpVersion || '7.0' }
					</span>
					{ ' · ' }
					<span className="j-mono">
						{ ( window.joistConfig || {} ).joistVersion || '0.5.0-alpha' }
					</span>
				</span>
			</footer>
		</div>
	);
}
