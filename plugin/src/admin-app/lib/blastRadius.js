/**
 * @purpose Pure-JS blast-radius classifier for plan steps.
 *
 * Returns a structured verdict — severity, reversibility, visibility,
 * affected count, reasons, flagged — that the BlastRadiusBadge renders into
 * a chip + tooltip. Per WAVE_0 §5 ("delight"), this is the differentiator
 * versus every other plan-mode UI: nobody else surfaces the *blast radius*
 * of an individual step.
 *
 * Design notes:
 *   - Static lookup table on `stepTypeKey(step)` — see lib/stepTypes.js.
 *     This is intentionally a pure function so it can run cheap in
 *     DataViews row-render with no API call.
 *   - `affectedCount` is `null` for site-wide / template-wide ops in W5b.
 *     A follow-up backend endpoint (`GET /plans/{id}/blast-radius`) will
 *     surface real counts ("modifies 14 pages") — the UI should already
 *     handle the populated case; today it renders "site-wide" instead.
 *   - `flagged === true` whenever reversibility is irreversible AND
 *     visibility is public. That's the red-flag bucket that the badge
 *     paints red.
 *
 * The classifier is *defensive* — unknown step types default to medium /
 * reversible / page / unknown, never auto-low. We never under-report risk.
 *
 * See WAVE_0_2026-05-26.md §5 "delight" and
 * memory/failure_mode_constraints.md #2, #4, #16.
 */

import { stepTypeKey } from './stepTypes.js';

/**
 * Severity, visibility, reversibility table per canonical step type.
 * Keyed by `stepTypeKey(step)`. See lib/stepTypes.js for the keys.
 *
 * Note on `count`:
 *   number = static count (e.g. 1 for a single-element insert)
 *   null   = unknown without a backend query (site/template-wide)
 *
 * Note on `visibility`:
 *   'page'     = mutation scoped to one page (live URL is one page)
 *   'template' = mutation affects every page using a template
 *   'site'     = mutation affects globals (color/font/kit) — every page
 *   'public'   = mutation affects something visible to public visitors
 *                (used together with reversibility=irreversible for the
 *                 red-flag case: deletes of pages, templates, tokens)
 */
const TABLE = {
	// Tree-mutation (single-page, reversible via plan rollback)
	update_settings: { severity: 'low',    reversibility: 'reversible',   visibility: 'page', count: 1 },
	replace_element: { severity: 'low',    reversibility: 'reversible',   visibility: 'page', count: 1 },
	insert:          { severity: 'low',    reversibility: 'reversible',   visibility: 'page', count: 1 },
	delete:          { severity: 'medium', reversibility: 'reversible',   visibility: 'page', count: 1 },
	move:            { severity: 'low',    reversibility: 'reversible',   visibility: 'page', count: 1 },
	duplicate:       { severity: 'low',    reversibility: 'reversible',   visibility: 'page', count: 1 },
	wrap:            { severity: 'low',    reversibility: 'reversible',   visibility: 'page', count: 1 },
	unwrap:          { severity: 'low',    reversibility: 'reversible',   visibility: 'page', count: 1 },

	// Widget-pack-friendly aliases
	add_widget:      { severity: 'low',    reversibility: 'reversible',   visibility: 'page', count: 1 },
	delete_widget:   { severity: 'medium', reversibility: 'reversible',   visibility: 'page', count: 1 },

	// Page-level
	create_page:     { severity: 'low',    reversibility: 'reversible',   visibility: 'page', count: 1 },
	update_page:     { severity: 'low',    reversibility: 'reversible',   visibility: 'page', count: 1 },
	delete_page:     { severity: 'high',   reversibility: 'irreversible', visibility: 'public', count: 1 },

	// Site/kit-level — site-wide, count unknown without backend
	update_global_color: { severity: 'medium', reversibility: 'reversible',   visibility: 'site', count: null },
	update_global_font:  { severity: 'medium', reversibility: 'reversible',   visibility: 'site', count: null },
	delete_global_token: { severity: 'high',   reversibility: 'irreversible', visibility: 'public', count: null },
	apply_kit:           { severity: 'high',   reversibility: 'irreversible', visibility: 'public', count: null },

	// Template-level
	delete_template:     { severity: 'high',   reversibility: 'irreversible', visibility: 'public', count: null },
};

/**
 * Default verdict for unknown step types. Defensive: medium severity, not low.
 */
const DEFAULT_VERDICT = {
	severity: 'medium',
	reversibility: 'reversible',
	visibility: 'page',
	count: null,
};

/**
 * Classify a step's blast radius.
 *
 * @param {object} step A plan step object.
 * @return {{
 *   severity: 'low'|'medium'|'high',
 *   reversibility: 'reversible'|'irreversible',
 *   visibility: 'page'|'template'|'site'|'public',
 *   affectedCount: number|null,
 *   reasons: string[],
 *   flagged: boolean,
 *   stepKey: string,
 * }}
 */
export function classifyStep( step ) {
	const key = stepTypeKey( step );
	const base = TABLE[ key ] || DEFAULT_VERDICT;

	// Reasons — short human strings the tooltip will render.
	const reasons = [];

	if ( base.visibility === 'site' || base.visibility === 'public' ) {
		reasons.push(
			base.count == null
				? 'site-wide effect'
				: `affects ${ base.count } page(s)`
		);
	} else if ( base.visibility === 'template' ) {
		reasons.push( 'affects every page using this template' );
	} else if ( base.count != null ) {
		reasons.push( `affects ${ base.count } element` );
	}

	if ( base.reversibility === 'irreversible' ) {
		reasons.push( 'irreversible — cannot be undone by plan rollback' );
	} else {
		reasons.push( 'reversible via plan rollback' );
	}

	if ( key === 'unknown' || ! TABLE[ key ] ) {
		reasons.push( 'unknown step type — defensive classification' );
	}

	const flagged =
		base.reversibility === 'irreversible' && base.visibility === 'public';

	return {
		severity: base.severity,
		reversibility: base.reversibility,
		visibility: base.visibility,
		affectedCount: base.count,
		reasons,
		flagged,
		stepKey: key,
	};
}

/**
 * Roll up a list of step verdicts into a single plan-level verdict.
 * Used for the plan-row blast-radius column on the list view.
 *
 * Severity is the max severity over all steps; flagged is OR over all steps.
 *
 * @param {Array} steps Plan steps.
 * @return {ReturnType<typeof classifyStep>}
 */
export function classifyPlan( steps ) {
	const list = Array.isArray( steps ) ? steps : [];
	if ( list.length === 0 ) {
		return {
			severity: 'low',
			reversibility: 'reversible',
			visibility: 'page',
			affectedCount: 0,
			reasons: [ 'empty plan' ],
			flagged: false,
			stepKey: 'unknown',
		};
	}
	const verdicts = list.map( classifyStep );
	const rank = { low: 0, medium: 1, high: 2 };
	const top = verdicts.reduce( ( a, b ) =>
		rank[ b.severity ] > rank[ a.severity ] ? b : a
	);
	const flagged = verdicts.some( ( v ) => v.flagged );
	const totalKnown = verdicts.reduce(
		( acc, v ) => ( v.affectedCount == null ? acc : acc + v.affectedCount ),
		0
	);
	const anyUnknown = verdicts.some( ( v ) => v.affectedCount == null );
	return {
		severity: top.severity,
		reversibility: verdicts.some( ( v ) => v.reversibility === 'irreversible' )
			? 'irreversible'
			: 'reversible',
		visibility: verdicts.some( ( v ) => v.visibility === 'public' )
			? 'public'
			: verdicts.some( ( v ) => v.visibility === 'site' )
			? 'site'
			: 'page',
		affectedCount: anyUnknown ? null : totalKnown,
		reasons: [
			`${ list.length } step(s)`,
			...( flagged ? [ 'contains irreversible public step' ] : [] ),
		],
		flagged,
		stepKey: 'plan',
	};
}
