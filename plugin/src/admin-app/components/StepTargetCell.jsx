/**
 * @purpose Render the "Target" cell for a step row.
 *
 * Different step types target different things — a page id, a widget type,
 * a global token name. We render a short human label per step type, with a
 * monospace fallback for raw ids so the cell never collapses to empty.
 */

import { stepTypeKey } from '../lib/stepTypes.js';

function shortId( id ) {
	if ( ! id ) return '';
	const s = String( id );
	if ( s.length <= 12 ) return s;
	return s.slice( 0, 6 ) + '…' + s.slice( -4 );
}

export default function StepTargetCell( { step } ) {
	if ( ! step ) return null;
	const key = stepTypeKey( step );

	// Page-level steps point at a page id / title.
	if ( key === 'create_page' || key === 'update_page' || key === 'delete_page' ) {
		const title = step.title || step.page_title || step.page_id;
		if ( title ) {
			return (
				<span className="joist-target joist-target--page">
					<code>{ shortId( title ) }</code>
				</span>
			);
		}
	}

	// Widget add/insert/replace target a widget type + container.
	if ( key === 'add_widget' || key === 'insert' || key === 'replace_element' ) {
		const widgetType = step.widget_type || step.element?.widgetType;
		const targetContainer = step.target_container_id || step.parent_id;
		if ( widgetType || targetContainer ) {
			return (
				<span className="joist-target joist-target--widget">
					{ widgetType && <code>{ widgetType }</code> }
					{ widgetType && targetContainer && <span> in </span> }
					{ targetContainer && <code>{ shortId( targetContainer ) }</code> }
				</span>
			);
		}
	}

	// Global tokens target a token name.
	if (
		key === 'update_global_color' ||
		key === 'update_global_font' ||
		key === 'delete_global_token'
	) {
		const token = step.token_name || step.token_id;
		if ( token ) {
			return (
				<span className="joist-target joist-target--token">
					<code>{ token }</code>
				</span>
			);
		}
	}

	// Template-level.
	if ( key === 'delete_template' || key === 'apply_kit' ) {
		const tpl = step.template_id || step.kit_id || step.kit_url;
		if ( tpl ) {
			return (
				<span className="joist-target joist-target--template">
					<code>{ shortId( tpl ) }</code>
				</span>
			);
		}
	}

	// Default: element_id is the most common field on tree-mutation ops.
	const elementId = step.element_id || step.target_id;
	if ( elementId ) {
		return (
			<span className="joist-target joist-target--element">
				<code>{ shortId( elementId ) }</code>
			</span>
		);
	}

	return <span className="joist-target joist-target--unknown">—</span>;
}
