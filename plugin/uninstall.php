<?php
/**
 * Joist uninstall.
 *
 * Runs when the user deletes the plugin via WP admin. WP automatically
 * deletes the plugin files. This script handles plugin DATA cleanup —
 * but ONLY if the user has explicitly opted in via the
 * `joist_delete_data_on_uninstall` option.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

$delete = (bool) get_option('joist_delete_data_on_uninstall', false);
if (!$delete) {
    return;
}

// Drop custom tables.
require_once __DIR__ . '/src/DB/MigrationRunner.php';
\Joist\DB\MigrationRunner::dropAll();

// Unregister custom role.
if (file_exists(__DIR__ . '/src/Security/Role.php')) {
    require_once __DIR__ . '/src/Security/Role.php';
    \Joist\Security\Role::unregister();
}

// Delete plugin options.
$options = [
    'joist_db_version',
    'joist_activated_at',
    'joist_version_installed',
    'joist_activation_error',
    'joist_delete_data_on_uninstall',
    'joist_operating_mode',
    'joist_staging_url_pattern',
    'joist_plan_thresholds',
    'joist_rate_limits',
    'joist_revisions_max_per_page',
    'joist_revisions_retention_days',
    'joist_agent_media_upload',
    'joist_log_buffer',
    'joist_audit_chain_broken',
];
foreach ($options as $opt) {
    delete_option($opt);
}

// Clear scheduled events.
wp_clear_scheduled_hook('joist_daily_maintenance');
wp_clear_scheduled_hook('joist_post_save_verify');
wp_clear_scheduled_hook(\Joist\Webhooks\WebhookEmitter::HOOK);

// Note: log files in wp-content/uploads/joist-logs/ are NOT deleted automatically.
// Admin can purge manually if needed.
