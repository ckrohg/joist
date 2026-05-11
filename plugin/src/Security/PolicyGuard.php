<?php
declare(strict_types=1);

namespace Joist\Security;

use Joist\Concurrency\SessionTracker;
use Joist\Elementor\WriteException;

/**
 * Hardcoded refuse-list (constraint #18) — operations the agent role cannot
 * perform regardless of WP capabilities granted. Enforced at controller
 * entry, before capability check.
 *
 * Also implements chained-singleton plan-required trigger (constraint #19)
 * via SessionTracker counters.
 *
 * The refuse-list is NOT db-driven; it's a hardcoded list in this class.
 * An attacker who compromises the DB cannot bypass it. Adding entries
 * requires a plugin release.
 */
final class PolicyGuard
{
    public const REFUSE_FORCE_DELETE = 'policy.force_delete_refused';
    public const REFUSE_ZIP_URL = 'policy.zip_url_disallowed';
    public const REFUSE_KIT_DESTRUCTIVE = 'policy.kit_destructive_refused';
    public const REFUSE_FRONT_PAGE_DELETE = 'policy.front_page_delete_refused';
    public const REFUSE_CORE_PLUGIN_PROTECTION = 'policy.core_plugin_protection';
    public const REFUSE_USER_MANAGEMENT = 'policy.user_management_refused';
    public const PLAN_REQUIRED = 'policy.plan_required';

    public function __construct(private SessionTracker $sessions) {}

    /**
     * Refuse-list applied at the start of REST controllers.
     *
     * @param string $op Op identifier (e.g. 'page.delete_force', 'plugin.install_zip', 'kit.zero_colors')
     * @param array $context Op-specific context, e.g. ['post_id' => 123]
     * @throws WriteException On refusal.
     */
    public function assertAllowed(string $op, array $context = [], ?\WP_User $actor = null): void
    {
        $isAgent = $actor && in_array(Role::SLUG, (array) $actor->roles, true);
        $isAdmin = $actor && in_array('administrator', (array) $actor->roles, true);

        switch ($op) {
            case 'page.delete_force':
                // Agent role can never force-delete. Admin can.
                if ($isAgent && !$isAdmin) {
                    throw new WriteException(
                        self::REFUSE_FORCE_DELETE,
                        'Agent role cannot force-delete pages. Move to trash; admin restores or hard-deletes.',
                        403
                    );
                }
                break;

            case 'page.delete':
                // Refuse delete of published front page from agent.
                $postId = (int) ($context['post_id'] ?? 0);
                if ($isAgent && $postId > 0 && self::isPublishedFrontPage($postId)) {
                    throw new WriteException(
                        self::REFUSE_FRONT_PAGE_DELETE,
                        'Agent role cannot delete the published front page.',
                        403
                    );
                }
                break;

            case 'plugin.install_zip':
                // Only admin can install from zip_url, AND wp-config constant must be set.
                if (!$isAdmin) {
                    throw new WriteException(
                        self::REFUSE_ZIP_URL,
                        'zip_url install requires Administrator role.',
                        403
                    );
                }
                if (!defined('JOIST_ALLOW_ARBITRARY_ZIP') || !JOIST_ALLOW_ARBITRARY_ZIP) {
                    throw new WriteException(
                        self::REFUSE_ZIP_URL,
                        'zip_url install requires JOIST_ALLOW_ARBITRARY_ZIP constant in wp-config.php.',
                        403
                    );
                }
                break;

            case 'plugin.deactivate_core':
                // Protect Elementor and Elementor Pro from agent deactivation.
                $slug = (string) ($context['slug'] ?? '');
                if ($isAgent && !$isAdmin && in_array($slug, ['elementor', 'elementor-pro'], true)) {
                    throw new WriteException(
                        self::REFUSE_CORE_PLUGIN_PROTECTION,
                        "Agent role cannot deactivate {$slug}. Required dependency.",
                        403
                    );
                }
                break;

            case 'kit.zero_colors':
                throw new WriteException(
                    self::REFUSE_KIT_DESTRUCTIVE,
                    'Refusing to wipe global color palette. Use explicit per-color updates.',
                    403
                );

            case 'user.crud':
                if ($isAgent && !$isAdmin) {
                    throw new WriteException(
                        self::REFUSE_USER_MANAGEMENT,
                        'Agent role cannot perform user CRUD operations.',
                        403
                    );
                }
                break;
        }
    }

    /**
     * Constraint #19 — chained-singleton plan-required trigger.
     *
     * @throws WriteException 423 if a Plan Mode plan is required for this op.
     */
    public function checkPlanRequired(string $sessionId, string $proposedOp, ?int $pageId = null): void
    {
        $thresholds = get_option('joist_plan_thresholds', [
            'ops_per_session' => 5,
            'ops_per_page' => 10,
            'destructive_requires_plan' => true,
        ]);

        $isDestructive = in_array($proposedOp, ['delete', 'unwrap', 'replace_full'], true);

        $counters = $this->sessions->counters($sessionId);
        $hasApprovedPlan = $this->sessions->hasApprovedPlanForPage($sessionId, $pageId);

        if ($isDestructive && !empty($thresholds['destructive_requires_plan']) && !$hasApprovedPlan) {
            throw new WriteException(
                self::PLAN_REQUIRED,
                "Destructive op '{$proposedOp}' requires an approved Plan Mode plan.",
                423,
                ['threshold' => 'destructive_op']
            );
        }

        if ($counters['op_count'] > (int) $thresholds['ops_per_session'] && !$hasApprovedPlan) {
            throw new WriteException(
                self::PLAN_REQUIRED,
                'Session has accumulated more than ' . $thresholds['ops_per_session'] . ' ops; Plan Mode required.',
                423,
                ['threshold' => 'ops_per_session', 'current' => $counters['op_count']]
            );
        }

        if ($pageId !== null
            && ($counters['ops_per_page'][$pageId] ?? 0) > (int) $thresholds['ops_per_page']
            && !$hasApprovedPlan
        ) {
            throw new WriteException(
                self::PLAN_REQUIRED,
                'Page has accumulated more than ' . $thresholds['ops_per_page'] . ' ops; Plan Mode required.',
                423,
                ['threshold' => 'ops_per_page', 'current' => $counters['ops_per_page'][$pageId] ?? 0]
            );
        }
    }

    private static function isPublishedFrontPage(int $postId): bool
    {
        if (get_option('show_on_front') !== 'page') return false;
        if ((int) get_option('page_on_front') !== $postId) return false;
        $post = get_post($postId);
        return $post && $post->post_status === 'publish';
    }
}
