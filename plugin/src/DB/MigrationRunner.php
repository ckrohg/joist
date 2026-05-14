<?php
declare(strict_types=1);

namespace Joist\DB;

/**
 * Idempotent migration runner with db_version tracking + admin-notice on failure.
 *
 * Wraps every CREATE TABLE in IF NOT EXISTS, uses VARCHAR + app-validation
 * instead of ENUM (dbDelta alter on ENUM fails silently), appends
 * $wpdb->get_charset_collate() to every CREATE.
 *
 * On multisite: callers must wrap in switch_to_blog() per site. Network-
 * activated installs iterate get_sites() during activation.
 */
final class MigrationRunner
{
    public const DB_VERSION = 11;

    public static function run(): void
    {
        $current = (int) get_option('joist_db_version', 0);
        if ($current >= self::DB_VERSION) {
            return;
        }

        $steps = [
            1 => [self::class, 'migration001CreateRevisions'],
            2 => [self::class, 'migration002CreateAudit'],
            3 => [self::class, 'migration003CreatePlans'],
            4 => [self::class, 'migration004CreateSessions'],
            5 => [self::class, 'migration005CreateLocks'],
            6 => [self::class, 'migration006CreateRateLimits'],
            7 => [self::class, 'migration007CreateBacklog'],
            8 => [self::class, 'migration008CreateWebhooks'],
            9 => [self::class, 'migration009CreatePreferences'],
            10 => [self::class, 'migration010CreateEvalEvents'],
            11 => [self::class, 'migration011CreateEvalRollups'],
        ];

        foreach ($steps as $version => $callable) {
            if ($version <= $current) {
                continue;
            }
            try {
                call_user_func($callable);
                update_option('joist_db_version', $version, false);
                delete_option('joist_activation_error');
            } catch (\Throwable $e) {
                update_option('joist_activation_error', [
                    'version' => $version,
                    'message' => $e->getMessage(),
                    'time' => time(),
                ], false);
                return;
            }
        }
    }

    private static function tableName(string $suffix): string
    {
        global $wpdb;
        return $wpdb->prefix . 'joist_' . $suffix;
    }

    private static function exec(string $sql): void
    {
        if (!function_exists('dbDelta')) {
            require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        }
        dbDelta($sql);
    }

    public static function migration001CreateRevisions(): void
    {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        $table = self::tableName('revisions');
        self::exec("CREATE TABLE {$table} (
            id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL,
            post_id BIGINT UNSIGNED NOT NULL,
            hash CHAR(72) NOT NULL,
            snapshot LONGBLOB NOT NULL,
            snapshot_size INT UNSIGNED NOT NULL,
            actor_type VARCHAR(16) NOT NULL,
            actor_id VARCHAR(64) NULL,
            session_id VARCHAR(64) NULL,
            intent VARCHAR(500) NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY idx_post_created (post_id, created_at),
            KEY idx_session (session_id)
        ) {$charset};");
    }

    public static function migration002CreateAudit(): void
    {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        $table = self::tableName('audit');
        self::exec("CREATE TABLE {$table} (
            id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL,
            timestamp DATETIME NOT NULL,
            op VARCHAR(64) NOT NULL,
            post_id BIGINT UNSIGNED NULL,
            actor_type VARCHAR(16) NOT NULL,
            actor_id VARCHAR(64) NULL,
            app_password_user_id BIGINT UNSIGNED NULL,
            session_id VARCHAR(64) NULL,
            before_hash CHAR(72) NULL,
            after_hash CHAR(72) NULL,
            duration_ms INT UNSIGNED NULL,
            intent VARCHAR(500) NULL,
            payload LONGBLOB NULL,
            chain_hash CHAR(64) NOT NULL,
            PRIMARY KEY  (id),
            KEY idx_post_time (post_id, timestamp),
            KEY idx_session (session_id),
            KEY idx_op_time (op, timestamp)
        ) {$charset};");
    }

    public static function migration003CreatePlans(): void
    {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        $table = self::tableName('plans');
        self::exec("CREATE TABLE {$table} (
            id VARCHAR(64) NOT NULL,
            approval_token CHAR(64) NOT NULL,
            session_id VARCHAR(64) NOT NULL,
            page_id BIGINT UNSIGNED NULL,
            intent VARCHAR(500) NOT NULL,
            steps LONGBLOB NOT NULL,
            status VARCHAR(16) NOT NULL,
            approval_user_id BIGINT UNSIGNED NULL,
            approval_at DATETIME NULL,
            approver_session_id VARCHAR(64) NULL,
            executed_at DATETIME NULL,
            result LONGBLOB NULL,
            created_at DATETIME NOT NULL,
            expires_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY idx_status_created (status, created_at)
        ) {$charset};");
    }

    public static function migration004CreateSessions(): void
    {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        $table = self::tableName('sessions');
        self::exec("CREATE TABLE {$table} (
            id VARCHAR(64) NOT NULL,
            agent_name VARCHAR(64) NOT NULL,
            agent_version VARCHAR(32) NULL,
            app_password_user_id BIGINT UNSIGNED NOT NULL,
            intent VARCHAR(500) NULL,
            user_label VARCHAR(200) NULL,
            started_at DATETIME NOT NULL,
            last_activity DATETIME NOT NULL,
            ended_at DATETIME NULL,
            op_count INT UNSIGNED NOT NULL DEFAULT 0,
            ops_destructive INT UNSIGNED NOT NULL DEFAULT 0,
            ops_per_page LONGBLOB NULL,
            last_approved_plan_id VARCHAR(64) NULL,
            cost_tokens INT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY  (id),
            KEY idx_started (started_at)
        ) {$charset};");
    }

    public static function migration005CreateLocks(): void
    {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        $table = self::tableName('locks');
        self::exec("CREATE TABLE {$table} (
            post_id BIGINT UNSIGNED NOT NULL,
            session_id VARCHAR(64) NOT NULL,
            acquired_at DATETIME NOT NULL,
            expires_at DATETIME NOT NULL,
            reason VARCHAR(500) NULL,
            PRIMARY KEY  (post_id),
            KEY idx_expires (expires_at)
        ) {$charset};");
    }

    public static function migration006CreateRateLimits(): void
    {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        $table = self::tableName('rate_limits');
        self::exec("CREATE TABLE {$table} (
            session_id VARCHAR(64) NOT NULL,
            bucket_class VARCHAR(32) NOT NULL,
            tokens INT UNSIGNED NOT NULL,
            last_refill DATETIME NOT NULL,
            PRIMARY KEY  (session_id, bucket_class)
        ) {$charset};");
    }

    public static function migration007CreateBacklog(): void
    {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        $table = self::tableName('backlog');
        self::exec("CREATE TABLE {$table} (
            id VARCHAR(64) NOT NULL,
            page_id BIGINT UNSIGNED NOT NULL,
            intent VARCHAR(500) NOT NULL,
            priority VARCHAR(16) NOT NULL DEFAULT 'medium',
            created_by_user_id BIGINT UNSIGNED NULL,
            created_by_session_id VARCHAR(64) NULL,
            created_at DATETIME NOT NULL,
            resolved_at DATETIME NULL,
            resolved_plan_id VARCHAR(64) NULL,
            PRIMARY KEY  (id),
            KEY idx_page_priority (page_id, priority)
        ) {$charset};");
    }

    public static function migration008CreateWebhooks(): void
    {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        $table = self::tableName('webhooks');
        self::exec("CREATE TABLE {$table} (
            id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL,
            url VARCHAR(500) NOT NULL,
            secret VARCHAR(64) NOT NULL,
            secret_previous VARCHAR(64) NULL,
            secret_rotated_at DATETIME NULL,
            events LONGTEXT NOT NULL,
            active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            last_success DATETIME NULL,
            last_failure DATETIME NULL,
            failure_count INT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY  (id)
        ) {$charset};");
    }

    public static function migration009CreatePreferences(): void
    {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        $table = self::tableName('preferences');
        self::exec("CREATE TABLE {$table} (
            id VARCHAR(64) NOT NULL,
            site_id VARCHAR(64) NOT NULL,
            kind VARCHAR(32) NOT NULL,
            scope VARCHAR(100) NOT NULL DEFAULT 'global',
            pattern TEXT NOT NULL,
            directive TEXT NOT NULL,
            provenance LONGTEXT NULL,
            confidence DECIMAL(3,2) NOT NULL DEFAULT 1.00,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            created_at DATETIME NOT NULL,
            last_invoked_at DATETIME NULL,
            superseded_by VARCHAR(64) NULL,
            PRIMARY KEY  (id),
            KEY idx_site_status (site_id, status),
            KEY idx_site_kind (site_id, kind)
        ) {$charset};");
    }

    public static function migration010CreateEvalEvents(): void
    {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        $table = self::tableName('eval_events');
        self::exec("CREATE TABLE {$table} (
            id BIGINT UNSIGNED AUTO_INCREMENT NOT NULL,
            ts DATETIME NOT NULL,
            site_id VARCHAR(64) NOT NULL,
            session_id VARCHAR(64) NULL,
            plan_id VARCHAR(64) NULL,
            page_id BIGINT UNSIGNED NULL,
            section_id VARCHAR(64) NULL,
            metric_key VARCHAR(64) NOT NULL,
            metric_value DECIMAL(12,4) NOT NULL,
            agent_version VARCHAR(32) NULL,
            plugin_version VARCHAR(32) NULL,
            prompt_hash CHAR(16) NULL,
            PRIMARY KEY  (id),
            KEY idx_ts (ts),
            KEY idx_site_metric_ts (site_id, metric_key, ts),
            KEY idx_plan (plan_id)
        ) {$charset};");
    }

    public static function migration011CreateEvalRollups(): void
    {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        $table = self::tableName('eval_rollups');
        self::exec("CREATE TABLE {$table} (
            bucket_ts DATETIME NOT NULL,
            site_id VARCHAR(64) NOT NULL,
            metric_key VARCHAR(64) NOT NULL,
            agent_version VARCHAR(32) NOT NULL DEFAULT '',
            plugin_version VARCHAR(32) NOT NULL DEFAULT '',
            sample_count INT UNSIGNED NOT NULL DEFAULT 0,
            p50 DECIMAL(12,4) NULL,
            p95 DECIMAL(12,4) NULL,
            avg_value DECIMAL(12,4) NULL,
            rate DECIMAL(5,4) NULL,
            PRIMARY KEY  (bucket_ts, site_id, metric_key, agent_version, plugin_version)
        ) {$charset};");
    }

    /** Drop all custom tables. Called ONLY from uninstall.php when user opts in. */
    public static function dropAll(): void
    {
        global $wpdb;
        $suffixes = ['revisions', 'audit', 'plans', 'sessions', 'locks', 'rate_limits', 'backlog', 'webhooks', 'preferences', 'eval_events', 'eval_rollups'];
        foreach ($suffixes as $s) {
            $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}joist_{$s}");
        }
    }
}
