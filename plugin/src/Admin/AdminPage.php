<?php
declare(strict_types=1);

namespace Joist\Admin;

/**
 * @purpose Register the Joist top-level WP admin menu + Plan Mode subpage.
 *
 * The page callbacks intentionally render only a mount point + page title —
 * the React app (plugin/src/admin-app/) takes over from there. No server-
 * rendered controls, no add_meta_box (failure-mode constraint #19), no
 * outer-frame document.* access (constraint #18) — that all happens inside
 * the React tree which owns its own DOM subtree.
 *
 * Capability: manage_options for v0.5–v0.8. Will tighten to a dedicated
 * `joist_agent` capability in v0.9 once the Plan Mode UI flows are stable.
 *
 * See specs/WAVE_0_2026-05-26.md §5 for the Plan Mode UI architecture and
 * memory/architecture_decisions.md "Plan Mode UI substrate" for the
 * DataViews + DataForm rationale.
 */
final class AdminPage
{
    public const MENU_SLUG = 'joist-plan-mode';
    public const PARENT_SLUG = 'joist-plan-mode';
    public const PAGE_CAPABILITY = 'manage_options';

    /** Page hook suffix returned by add_menu_page — set during admin_menu. */
    private static ?string $planModeHook = null;

    public static function init(): void
    {
        add_action('admin_menu', [self::class, 'registerMenu']);
    }

    /**
     * Register the top-level Joist menu and its subpages.
     *
     * Position 30 sits below the core "Comments" group (25) and above the
     * "Appearance/Plugins" cluster (60) — a deliberate middle perch so we
     * don't collide with the Elementor / Elementor Pro entries which
     * register higher up.
     */
    public static function registerMenu(): void
    {
        $hook = add_menu_page(
            __('Joist', 'joist'),
            __('Joist', 'joist'),
            self::PAGE_CAPABILITY,
            self::MENU_SLUG,
            [self::class, 'renderPlanModePage'],
            'dashicons-superhero-alt',
            30
        );
        if (is_string($hook) && $hook !== '') {
            self::$planModeHook = $hook;
        }

        // Plan Mode is the default landing — re-register it as a subpage so
        // it shows up in the submenu with an explicit label (WP duplicates
        // the parent into slot 0 by default; renaming it via this call gives
        // us a clean "Plan Mode" label instead of "Joist").
        add_submenu_page(
            self::PARENT_SLUG,
            __('Plan Mode', 'joist'),
            __('Plan Mode', 'joist'),
            self::PAGE_CAPABILITY,
            self::MENU_SLUG,
            [self::class, 'renderPlanModePage']
        );

        // Placeholder slot for future pages (Audit log viewer, Settings,
        // Eval dashboard). Registered as a hidden-from-menu route so it can
        // be linked to from inside the React app without polluting the
        // sidebar before the W5b+ pages exist.
        // To make a future page user-visible, simply pass a label instead of
        // `null` to the menu_title arg of add_submenu_page().
    }

    /**
     * Render the Plan Mode page shell. The React app mounts on
     * #joist-plan-mode-root — keep this output minimal so we don't fight
     * the React tree's layout assumptions.
     */
    public static function renderPlanModePage(): void
    {
        if (!current_user_can(self::PAGE_CAPABILITY)) {
            wp_die(esc_html__('You do not have permission to access this page.', 'joist'));
        }
        // We render NO WP-standard chrome — no <h1>, no wp-heading-inline,
        // no .wrap. The React app is the page. It owns the full available
        // content area (#wpcontent inset by the left admin menu).
        echo '<div id="joist-plan-mode-root" class="joist-takeover"></div>';
    }

    /**
     * Page-hook suffix returned by add_menu_page. AssetEnqueue uses this to
     * scope its admin_enqueue_scripts callback to the Joist screens only.
     */
    public static function planModeHook(): ?string
    {
        return self::$planModeHook;
    }

    /** Stable slug for tests + cross-referencing. */
    public static function planModeUrl(): string
    {
        return admin_url('admin.php?page=' . self::MENU_SLUG);
    }
}
