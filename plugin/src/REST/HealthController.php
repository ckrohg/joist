<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use WP_REST_Request;
use WP_REST_Server;

/**
 * GET /joist/v1/health — pass/fail health checks for monitoring, with a
 * REAL write test (not just config-flag introspection).
 * GET /joist/v1/diagnostics — verbose.
 */
final class HealthController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/health', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'health'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/diagnostics', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'diagnostics'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    public function health(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function () {
            $checks = [];
            $checks[] = $this->check('transport.https_enforced', is_ssl(), 'Site is served over HTTPS.');
            $checks[] = $this->check('elementor.active', class_exists('\Elementor\Plugin'), 'Elementor is active.');

            $elVersion = defined('ELEMENTOR_VERSION') ? ELEMENTOR_VERSION : '0';
            $supported = version_compare($elVersion, JOIST_MIN_ELEMENTOR_VERSION, '>=')
                && version_compare($elVersion, JOIST_MAX_TESTED_ELEMENTOR_VERSION, '<=');
            $checks[] = $this->check('elementor.version_supported', $supported, "Elementor {$elVersion} is within the tested range ("
                . JOIST_MIN_ELEMENTOR_VERSION . '–' . JOIST_MAX_TESTED_ELEMENTOR_VERSION . ').',
                ['version' => $elVersion]);

            // Wave 3: V3/V4 routing health check (failure-mode constraint #17).
            // Refusal-to-write is a 'warn', not a 'fail' — the plugin itself
            // is healthy; the host's Elementor version is what's broken.
            if (class_exists(\Joist\Elementor\VersionRouter::class)) {
                $routing = \Joist\Elementor\VersionRouter::detect();
                $routingHealthy = !$routing->shouldRefuseWrites();
                $checks[] = [
                    'name' => 'elementor.routing',
                    'status' => $routingHealthy ? 'pass' : 'warn',
                    'message' => $routingHealthy
                        ? sprintf('Routing: %s (writes will proceed).', $routing->kind)
                        : sprintf('Routing: %s (writes refused: %s).', $routing->kind, $routing->knownBroken ? 'known_broken_v4' : 'unsupported_major'),
                    'details' => $routing->toArray(),
                ];
            }

            $layoutMode = Container::get('layoutMode')->current();
            $checks[] = $this->check('elementor.layout_mode_detected', !empty($layoutMode['mode']), 'Layout mode autodetected.', $layoutMode);

            $checks[] = $this->check('pro.present', defined('ELEMENTOR_PRO_VERSION'), 'Elementor Pro is present (required for full-site builds).');

            // DB writable.
            global $wpdb;
            $tablesPresent = (int) $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}joist_audit'") > 0;
            $checks[] = $this->check('db.tables_present', $tablesPresent, 'Joist custom tables exist.', ['db_version' => (int) get_option('joist_db_version', 0)]);

            // Uploads writable.
            $uploadDir = wp_upload_dir();
            $checks[] = $this->check('uploads.writable', empty($uploadDir['error']) && wp_is_writable($uploadDir['basedir']), 'Uploads directory is writable.');

            // App Passwords enabled.
            $appPwd = function_exists('wp_is_application_passwords_available') ? wp_is_application_passwords_available() : true;
            $checks[] = $this->check('app_passwords.enabled', (bool) $appPwd, 'Application Passwords are available.');

            // Real write test — create + delete a transient draft page.
            $writeTest = $this->realWriteTest();
            $checks[] = $writeTest;

            // Host / cache adapters info.
            $host = Container::get('hostDetector')->detect();
            $hostCheck = ['name' => 'hosting.detected', 'status' => 'info', 'details' => $host];
            if ($host['host'] === 'wp-engine' || $host['host'] === 'siteground') {
                $hostCheck['status'] = 'warn';
                $hostCheck['details']['hint'] = 'Security layer may block REST writes from non-allowlisted IPs. See doctor output for specifics.';
            }
            $checks[] = $hostCheck;

            $ok = !in_array('fail', array_column($checks, 'status'), true);
            return $this->ok(['ok' => $ok, 'checks' => $checks]);
        });
    }

    public function diagnostics(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function () {
            global $wpdb;
            $activePlugins = get_option('active_plugins', []);
            $pluginData = [];
            foreach ($activePlugins as $plugin) {
                $path = WP_PLUGIN_DIR . '/' . $plugin;
                if (file_exists($path)) {
                    $h = get_plugin_data($path, false, false);
                    $pluginData[] = ['file' => $plugin, 'name' => $h['Name'] ?? $plugin, 'version' => $h['Version'] ?? '?'];
                }
            }
            // Wave 3: surface routing decision + atomic schema probe result
            // in diagnostics so curl/CI tests can verify the V3/V4 surface
            // without exercising an actual write. Read-only.
            $routing = class_exists(\Joist\Elementor\VersionRouter::class)
                ? \Joist\Elementor\VersionRouter::detect()
                : null;
            $atomicProbe = null;
            if ($routing !== null && $routing->isAtomicV4() && class_exists(\Joist\Elementor\AtomicSchemaProbe::class)) {
                $atomicProbe = Container::get('atomicSchemaProbe')->probe($routing);
            }

            return $this->ok([
                'php' => ['version' => PHP_VERSION, 'memory_limit' => ini_get('memory_limit'), 'max_upload' => size_format(wp_max_upload_size())],
                'wordpress' => ['version' => get_bloginfo('version'), 'multisite' => is_multisite()],
                'active_plugins' => $pluginData,
                'host' => Container::get('hostDetector')->detect(),
                'cache_adapters' => Container::get('cacheFlusher')->detectedAdapters(),
                'recent_log' => array_slice(get_option('joist_log_buffer', []), -50),
                'audit_chain_status' => empty(get_option('joist_audit_chain_broken', [])) ? 'ok' : 'broken',
                'elementor_routing' => $routing?->toArray(),
                'atomic_schema_probe' => $atomicProbe,
            ]);
        });
    }

    private function realWriteTest(): array
    {
        try {
            // Create a draft page, write a tiny Elementor tree, delete it.
            $postId = wp_insert_post([
                'post_title' => '[Joist health check — safe to delete]',
                'post_status' => 'draft',
                'post_type' => 'page',
            ], true);
            if (is_wp_error($postId)) {
                return $this->check('write.real_test', false, 'Could not create a test page: ' . $postId->get_error_message());
            }
            update_post_meta($postId, '_elementor_edit_mode', 'builder');
            $document = \Elementor\Plugin::$instance->documents->get($postId);
            $document->save(['elements' => [], 'settings' => []]);
            $readBack = $document->get_elements_data();
            $ok = is_array($readBack);
            wp_delete_post($postId, true);
            return $this->check('write.real_test', $ok, $ok
                ? 'Created, wrote, read back, and deleted a test page successfully through Elementor.'
                : 'Test page write did not round-trip cleanly.');
        } catch (\Throwable $e) {
            return $this->check('write.real_test', false, 'Write test threw: ' . $e->getMessage());
        }
    }

    private function check(string $name, bool $pass, string $message, array $details = []): array
    {
        return ['name' => $name, 'status' => $pass ? 'pass' : 'fail', 'message' => $message, 'details' => $details];
    }
}
