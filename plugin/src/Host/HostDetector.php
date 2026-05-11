<?php
declare(strict_types=1);

namespace Joist\Host;

/**
 * Detect the hosting environment for host-specific guidance.
 */
final class HostDetector
{
    /** @return array{host:string, plan:?string, notes:list<string>} */
    public function detect(): array
    {
        $notes = [];

        if (defined('IS_PRESSABLE') && IS_PRESSABLE) {
            return ['host' => 'pressable', 'plan' => null, 'notes' => $notes];
        }

        if (class_exists('\WpeCommon')) {
            $notes[] = 'WP Engine: Mercury security layer may rate-limit REST writes from non-allowlisted IPs.';
            return ['host' => 'wp-engine', 'plan' => null, 'notes' => $notes];
        }

        if (file_exists('/etc/kinsta-tool-kit') || (defined('KINSTAMU_VERSION'))) {
            return ['host' => 'kinsta', 'plan' => null, 'notes' => $notes];
        }

        if (function_exists('sg_cachepress_purge_cache')
            || class_exists('\SiteGround_Optimizer\Helper\Helper')
            || (isset($_SERVER['HTTP_X_HELPER_PLUGIN']) && stripos((string) $_SERVER['HTTP_X_HELPER_PLUGIN'], 'siteground') !== false)
        ) {
            // SG plan detection isn't reliable; defer to user config or doctor.
            $plan = (string) get_option('joist_sg_plan', 'unknown');
            $notes[] = 'SiteGround detected. SG Security and SG Optimizer plugin compatibility auto-configured if present.';
            if (in_array($plan, ['startup', 'growbig'], true)) {
                $notes[] = "Plan '{$plan}' does not include SSH/WP-CLI; staging unavailable — falls back to draft-mode.";
            }
            return ['host' => 'siteground', 'plan' => $plan === 'unknown' ? null : $plan, 'notes' => $notes];
        }

        if (defined('CLOUDWAYS_PHPSTORM_IMAGE') || file_exists('/etc/cloudways')) {
            return ['host' => 'cloudways', 'plan' => null, 'notes' => $notes];
        }

        if (defined('LOCAL_WP_VERSION') || (isset($_SERVER['HTTP_HOST']) && str_ends_with((string) $_SERVER['HTTP_HOST'], '.local'))) {
            $notes[] = 'Local development environment detected.';
            return ['host' => 'local', 'plan' => null, 'notes' => $notes];
        }

        return ['host' => 'unknown', 'plan' => null, 'notes' => $notes];
    }
}
