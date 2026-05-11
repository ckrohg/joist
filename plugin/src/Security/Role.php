<?php
declare(strict_types=1);

namespace Joist\Security;

/**
 * Custom `joist_agent` role with reduced capabilities (NOT Editor).
 *
 * The agent role intentionally lacks: unfiltered_html, manage_categories,
 * manage_options, edit_users, install_plugins, activate_plugins, edit_themes,
 * delete_users, create_users. Even if the App Password leaks, the blast
 * radius is contained.
 *
 * `upload_files` is granted only when image-gen is enabled (configurable
 * via tenet_el_agent_caps option). Defaults to disabled in v0.5.
 */
final class Role
{
    public const SLUG = 'joist_agent';
    public const CAP_USE_API = 'joist_use_agent_api';

    /** @return array<string, bool> */
    public static function capabilities(bool $allowMediaUpload = false): array
    {
        $caps = [
            'read' => true,
            'edit_pages' => true,
            'edit_others_pages' => true,
            'publish_pages' => true,
            'edit_published_pages' => true,
            'delete_pages' => true,
            'edit_posts' => true,
            'edit_others_posts' => true,
            'publish_posts' => true,
            'edit_published_posts' => true,
            'delete_posts' => true,
            self::CAP_USE_API => true,
        ];
        if ($allowMediaUpload) {
            $caps['upload_files'] = true;
        }
        return $caps;
    }

    /** Register the role on activation. Idempotent. */
    public static function register(): void
    {
        $existing = get_role(self::SLUG);
        $caps = self::capabilities((bool) get_option('joist_agent_media_upload', false));

        if ($existing === null) {
            add_role(self::SLUG, __('Joist Agent', 'joist'), $caps);
        } else {
            // Sync caps in case of upgrade.
            foreach ($caps as $cap => $grant) {
                $existing->add_cap($cap, $grant);
            }
        }

        // Also grant the API capability to Administrator so admins can use it directly.
        $admin = get_role('administrator');
        if ($admin !== null) {
            $admin->add_cap(self::CAP_USE_API);
        }
    }

    /** Remove the role on uninstall (only if user opted in). */
    public static function unregister(): void
    {
        remove_role(self::SLUG);
        $admin = get_role('administrator');
        if ($admin !== null) {
            $admin->remove_cap(self::CAP_USE_API);
        }
    }
}
