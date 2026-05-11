<?php
declare(strict_types=1);

namespace Joist;

use Joist\REST\PagesController;
use Joist\REST\SiteController;

/**
 * Plugin bootstrap. Hooks WP, registers REST routes, performs pre-flight checks.
 *
 * v0.1 M0: minimum viable. v0.5 adds migration runner, role registration,
 * webhook listener, scheduled events, etc.
 */
final class Bootstrap
{
    public static function init(): void
    {
        if (!self::elementorReady()) {
            add_action('admin_notices', [self::class, 'noticeElementorMissing']);
            return;
        }

        add_action('rest_api_init', [self::class, 'registerRoutes']);
    }

    public static function onActivate(): void
    {
        // M0: no migrations yet (using post meta + WP transients).
        // v0.5: create custom tables (revisions, audit, locks, plans, sessions, rate_limits, backlog).
        update_option('joist_db_version', 0, false);
        update_option('joist_activated_at', time(), false);
    }

    public static function onDeactivate(): void
    {
        // M0: nothing to tear down.
    }

    public static function registerRoutes(): void
    {
        (new SiteController())->register();
        (new PagesController())->register();
    }

    private static function elementorReady(): bool
    {
        if (!did_action('elementor/loaded') && !class_exists('\Elementor\Plugin')) {
            return false;
        }
        if (defined('ELEMENTOR_VERSION') && version_compare(ELEMENTOR_VERSION, JOIST_MIN_ELEMENTOR_VERSION, '<')) {
            return false;
        }
        return true;
    }

    public static function noticeElementorMissing(): void
    {
        echo '<div class="notice notice-error"><p><strong>Joist:</strong> ';
        echo esc_html(sprintf(
            __('Elementor %s+ is required. Install or update Elementor before activating Joist.', 'joist'),
            JOIST_MIN_ELEMENTOR_VERSION
        ));
        echo '</p></div>';
    }
}
