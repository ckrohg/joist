<?php
/**
 * Plugin Name:       Joist
 * Plugin URI:        https://github.com/ckrohg/joist
 * Description:       Open-source agentic backbone for Elementor sites. Schema-validated, audit-logged, atomic-rollback writes via Claude Code or any MCP client.
 * Version:           0.10.14-alpha
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
 * STATUS: v0.5-alpha — full v1 API surface implemented; awaiting real-WP
 * validation. DO NOT INSTALL ON PRODUCTION SITES until v1.0.
 *
 * Implemented in v0.5:
 *   - Full REST surface: /site, /pages (+ patch with 8 ops, tree-summary,
 *     revisions, restore, legacy-builder helper), /widgets (+ schema +
 *     validate), /dynamic-tags, /kit (+ match-color), /templates, /media
 *     (URL-mode with SSRF defense), /menus, /plugins, /pages/{id}/seo,
 *     /sessions, /plans (Plan Mode), /webhooks, /audit-log (+ summary +
 *     html/csv), /health (real write test), /diagnostics, /site/
 *     operating-mode, /site/flush-cache, /site/regenerate-css,
 *     /elementor/refresh-layout-mode
 *   - Custom DB schema: 8 tables (revisions, audit, plans, sessions, locks,
 *     rate_limits, backlog, webhooks) + idempotent migration runner with
 *     db_version tracking
 *   - Custom joist_agent role with reduced caps (NOT Editor)
 *   - All 30 failure-mode constraints (#1-#30) — see specs/PLUGIN_API.md §20:
 *       #1  schema validation w/ Levenshtein + flex_* suggestions
 *       #2  read-after-write verification
 *       #3  atomic revision snapshot + rollback
 *       #5  full CSS regen file list (deferred async)
 *       #8  Elementor version pin (3.18–3.21 tested)
 *       #10 explicit ID generation
 *       #15,#30 hash-chained audit log
 *       #16 no silent failure — throw on rollback
 *       #17 async-by-default I/O (CSS regen + cache flush + CDN purge +
 *           webhook emission deferred to wp_schedule_single_event)
 *       #18 PolicyGuard refuse-list (force-delete, zip-url, kit-zero,
 *           front-page-delete, core-plugin-deactivate, user-CRUD)
 *       #19 chained-singleton plan-required trigger
 *       #20 HTTPS enforcement (421 over plain HTTP, skipped on .local)
 *       #21 SSRF defense (URLValidator: https-only, public-IP-only,
 *           IPv4+IPv6 banned ranges, no redirects)
 *       #22 custom locks table (not transients)
 *       #23 container-mode matching (autodetect + cross-mode refusal)
 *       #24 responsive-completeness warnings + auto-fill
 *       #25 dynamic tag references resolve (fuzzy-match suggestions)
 *       #26 global ref preference (delta-E auto-rewrite literal -> global)
 *       #27 inner-flag inference + rejection
 *       #28 deep ID regen on duplicate/wrap
 *       #29 skin-aware schema validation (stub — full per-skin in v0.7)
 *       #26 rate limiting (token bucket per session, 429 + Retry-After)
 *   - Operating modes: live / observer (default for new installs) / quiet /
 *     kill_switch / staging_mandatory
 *   - Host adapters: SiteGround, WP Engine, Kinsta, Cloudways, Pressable, Local
 *   - Cache adapters: SG Optimizer, WP Rocket, LiteSpeed, WP Engine native
 *   - CDN adapter: Cloudflare (encrypted token storage via libsodium)
 *   - SEO adapters: Yoast, RankMath, AIOSEO, native fallback
 *   - Plan Mode: PlanStore + PlanExecutor (atomic, plan-level rollback,
 *     approval_token + CSRF + approver-binding)
 *   - Hash-chained audit + daily integrity check
 *   - Logger with redact() chokepoint (strips API keys, App Passwords)
 *
 * NOT yet in v0.5 (lands v0.7+):
 *   - WP-admin React Plan Review UI (REST endpoints exist; UI is v0.7)
 *   - MCP adapter wiring (REST works standalone; Abilities API bridge v0.7)
 *   - Per-skin control validation depth (#29 — stub for now)
 *   - Kit .zip import/export (read works; import/export module v0.7)
 *   - Theme Builder display-condition assignment with priority (v0.7)
 *   - CIEDE2000 (using CIE76 deltaE for now)
 *   - DNS-rebinding curl handler (using wp_remote_* without CURLOPT_RESOLVE)
 *   - GDPR DSR exporters/erasers (v0.7)
 *   - Live preview rendering endpoint (v0.7)
 *   - Multisite per-site migration loop (single-site works; network-activate v0.7)
 *   - WooCommerce / Forms (Pro) endpoints (v1.5+)
 *
 * What's untested: ALL of it. This is code written against the spec without
 * a live WP environment. Real-WP validation is the next step. The smoke test
 * (tests/manual/smoke.sh) is the entry point.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('JOIST_VERSION', '0.10.14-alpha');
define('JOIST_FILE', __FILE__);
define('JOIST_DIR', plugin_dir_path(__FILE__));
define('JOIST_URL', plugin_dir_url(__FILE__));
define('JOIST_MIN_ELEMENTOR_VERSION', '3.18.0');
// Updated 2026-05-29 (Wave 7 live smoke): bumped from 3.21.99 to 4.1.99 to
// reflect current pins. Wave 1 / WAVE_0_2026-05-26.md updated the V3 happy
// path to 3.33-3.34.x; Wave 3 added the AtomicDocumentWriter so V4 atomic
// installs are also "supported" — the VersionRouter decides whether writes
// proceed (legacy_v3 / atomic_v4) or refuse (known_broken / unsupported).
define('JOIST_MAX_TESTED_ELEMENTOR_VERSION', '4.1.99');

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

// Optional wp-config constant — gates POST /plugins/install with zip_url.
// define('JOIST_ALLOW_ARBITRARY_ZIP', true); // default: not defined = disabled

register_activation_hook(__FILE__, [\Joist\Bootstrap::class, 'onActivate']);
register_deactivation_hook(__FILE__, [\Joist\Bootstrap::class, 'onDeactivate']);

add_action('plugins_loaded', [\Joist\Bootstrap::class, 'init']);
