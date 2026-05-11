<?php
/**
 * Plugin Name:       Joist
 * Plugin URI:        https://github.com/ckrohg/joist
 * Description:       Open-source agentic backbone for Elementor sites. Schema-validated, audit-logged, atomic-rollback writes via Claude Code or any MCP client.
 * Version:           0.1.0-alpha
 * Requires at least: 6.5
 * Requires PHP:      8.0
 * Author:            Joist maintainers
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       joist
 * Domain Path:       /languages
 *
 * @package Joist
 *
 * STATUS: v0.1 — M0 spike. DO NOT INSTALL ON PRODUCTION SITES.
 * This is the bare-minimum proof-of-loop scaffold. It implements a small
 * subset of the full spec (see /specs/PLUGIN_API.md). The full surface
 * lands at v0.5; production hardening at v1.0.
 *
 * Implemented in M0:
 *   - GET  /wp-json/joist/v1/site
 *   - GET  /wp-json/joist/v1/pages/{id}
 *   - POST /wp-json/joist/v1/pages
 *   - POST /wp-json/joist/v1/pages/{id}/patch  (update_settings + replace_element only)
 *   - Basic schema introspection
 *   - SHA-256 hash of canonicalized _elementor_data
 *   - 8-hex unique element ID generation
 *   - Read-after-write verification
 *   - Routing every write through Elementor's Document::save()
 *
 * NOT in M0 (v0.5+):
 *   - PolicyGuard refuse-list
 *   - Chained-singleton plan-required trigger
 *   - Custom locks table (using WP transients for now)
 *   - Custom revisions/audit tables
 *   - PatchEngine's full op set (insert / delete / move / duplicate / wrap / unwrap)
 *   - Async CSS regen + cache flush
 *   - Rate limiting
 *   - SSRF defenses on URL inputs (no media URL upload yet)
 *   - Plan Mode UI
 *   - MCP adapter wiring
 *   - Operating modes (observer/quiet/kill-switch)
 *   - Multisite
 *   - SEO/Forms/Templates/Kit endpoints
 *
 * The thing M0 proves: Claude (or curl) can write an Elementor page via REST,
 * the human can open Elementor and edit it, and nothing breaks. Round-trip
 * confirmed via content hash.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('JOIST_VERSION', '0.1.0-alpha');
define('JOIST_FILE', __FILE__);
define('JOIST_DIR', plugin_dir_path(__FILE__));
define('JOIST_URL', plugin_dir_url(__FILE__));
define('JOIST_MIN_ELEMENTOR_VERSION', '3.18.0');
define('JOIST_MAX_TESTED_ELEMENTOR_VERSION', '3.21.99');

/**
 * PSR-4 autoloader (no Composer dependency in M0 — keep the plugin self-contained).
 * Maps `Joist\Foo\Bar` → `src/Foo/Bar.php`.
 */
spl_autoload_register(function (string $class): void {
    $prefix = 'Joist\\';
    $base_dir = JOIST_DIR . 'src/';
    $len = strlen($prefix);
    if (strncmp($prefix, $class, $len) !== 0) {
        return;
    }
    $relative = substr($class, $len);
    $file = $base_dir . str_replace('\\', '/', $relative) . '.php';
    if (file_exists($file)) {
        require $file;
    }
});

register_activation_hook(__FILE__, [\Joist\Bootstrap::class, 'onActivate']);
register_deactivation_hook(__FILE__, [\Joist\Bootstrap::class, 'onDeactivate']);

add_action('plugins_loaded', [\Joist\Bootstrap::class, 'init']);
