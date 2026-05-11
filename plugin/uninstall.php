<?php
/**
 * Joist uninstall.
 *
 * Runs when the user deletes the plugin via WP admin. WP automatically
 * deletes the plugin files. This script handles plugin DATA cleanup —
 * but ONLY if the user has explicitly opted in.
 *
 * v0.1 M0: only options are stored (no custom tables yet). v0.5+ will
 * additionally drop the wp_joist_* custom tables.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

// Only delete data if the user explicitly opted in. Default: preserve.
$delete = (bool) get_option('joist_delete_data_on_uninstall', false);

if (!$delete) {
    return;
}

delete_option('joist_db_version');
delete_option('joist_activated_at');
delete_option('joist_delete_data_on_uninstall');

// v0.5: DROP TABLE wp_joist_revisions, wp_joist_audit, wp_joist_plans,
// wp_joist_sessions, wp_joist_locks, wp_joist_rate_limits, wp_joist_backlog,
// wp_joist_webhooks, wp_joist_bot_crawls. Multisite: iterate get_sites().
