/**
 * @purpose Single source of truth for Joist plan-step type metadata.
 *
 * The backend (PlanExecutor.php) currently accepts these `op` values for
 * tree-mutating steps:
 *   update_settings | replace_element | insert | delete | move | duplicate | wrap | unwrap
 *
 * The Wave 0 §5 design discusses a richer taxonomy that includes page-level
 * and kit-level operations (`create_page`, `update_page`, `delete_page`,
 * `update_global_color`, `update_global_font`, `apply_kit`, `delete_template`,
 * `delete_global_token`, `add_widget`, `delete_widget`). Those are forward-
 * looking — the UI renders them so it stays correct when the backend grows
 * to support them. Until then, plans created via the existing endpoint
 * primarily use the tree-mutation ops above.
 *
 * `op` is the canonical key on each step object. We also accept `type` and
 * `step_type` as aliases for forward-compat with future planners.
 */

/**
 * Canonical list of step types the UI knows how to render.
 * Order is the rough taxonomy: tree-mutation, then page, then site/kit, then templates.
 *
 * @type {Record<string, {
 *   label: string,
 *   short: string,
 *   icon: string,
 *   surface: 'tree'|'page'|'kit'|'template'|'unknown',
 * }>}
 */
export const STEP_TYPES = {
	// Tree-mutation (backend-supported today via PlanExecutor)
	update_settings: {
		label: 'Update settings',
		short: 'Update',
		icon: 'edit',
		surface: 'tree',
	},
	replace_element: {
		label: 'Replace element',
		short: 'Replace',
		icon: 'controls-repeat',
		surface: 'tree',
	},
	insert: {
		label: 'Insert element',
		short: 'Insert',
		icon: 'plus-alt2',
		surface: 'tree',
	},
	delete: {
		label: 'Delete element',
		short: 'Delete',
		icon: 'trash',
		surface: 'tree',
	},
	move: {
		label: 'Move element',
		short: 'Move',
		icon: 'move',
		surface: 'tree',
	},
	duplicate: {
		label: 'Duplicate element',
		short: 'Duplicate',
		icon: 'admin-page',
		surface: 'tree',
	},
	wrap: {
		label: 'Wrap element',
		short: 'Wrap',
		icon: 'archive',
		surface: 'tree',
	},
	unwrap: {
		label: 'Unwrap element',
		short: 'Unwrap',
		icon: 'open-folder',
		surface: 'tree',
	},

	// Tree-mutation with widget-pack-friendly aliases
	add_widget: {
		label: 'Add widget',
		short: 'Add',
		icon: 'plus-alt2',
		surface: 'tree',
	},
	delete_widget: {
		label: 'Delete widget',
		short: 'Delete widget',
		icon: 'trash',
		surface: 'tree',
	},

	// Page-level (forward-looking)
	create_page: {
		label: 'Create page',
		short: 'Create page',
		icon: 'admin-page',
		surface: 'page',
	},
	update_page: {
		label: 'Update page',
		short: 'Update page',
		icon: 'edit-page',
		surface: 'page',
	},
	delete_page: {
		label: 'Delete page',
		short: 'Delete page',
		icon: 'trash',
		surface: 'page',
	},

	// Site/kit-level (forward-looking)
	update_global_color: {
		label: 'Update global color',
		short: 'Color',
		icon: 'art',
		surface: 'kit',
	},
	update_global_font: {
		label: 'Update global font',
		short: 'Font',
		icon: 'editor-textcolor',
		surface: 'kit',
	},
	delete_global_token: {
		label: 'Delete global token',
		short: 'Delete token',
		icon: 'trash',
		surface: 'kit',
	},
	apply_kit: {
		label: 'Apply Kit',
		short: 'Apply kit',
		icon: 'archive',
		surface: 'kit',
	},

	// Template-level (forward-looking)
	delete_template: {
		label: 'Delete template',
		short: 'Delete template',
		icon: 'trash',
		surface: 'template',
	},
};

/**
 * Normalize a step's type/op field to a canonical key.
 *
 * @param {Object} step Step object from a plan.
 * @return {string} Canonical step type key, or 'unknown'.
 */
export function stepTypeKey( step ) {
	if ( ! step || typeof step !== 'object' ) {
		return 'unknown';
	}
	const raw = String( step.op || step.type || step.step_type || '' ).trim();
	if ( raw === '' ) {
		return 'unknown';
	}
	return raw;
}

/**
 * Lookup metadata for a step type. Falls back to a synthesized entry for
 * unknown keys so the UI never crashes on a step it doesn't recognize.
 *
 * @param {string} key
 * @return {{label: string, short: string, icon: string, surface: string}}
 */
export function stepTypeMeta( key ) {
	if ( STEP_TYPES[ key ] ) {
		return STEP_TYPES[ key ];
	}
	return {
		label: key && key !== 'unknown' ? key : 'Unknown step',
		short: key && key !== 'unknown' ? key : 'Unknown',
		icon: 'editor-help',
		surface: 'unknown',
	};
}

/**
 * Short human label for the step's primary action verb. Used in chip badges
 * on the plan-list rows ("first 2 step types" column).
 * @param step
 */
export function stepShortLabel( step ) {
	return stepTypeMeta( stepTypeKey( step ) ).short;
}
