<?php
declare(strict_types=1);

namespace Joist\Concurrency;

use Joist\Elementor\WriteException;

/**
 * Per-site operating mode (§24): live / observer / quiet / kill_switch
 * + orthogonal staging_mandatory flag.
 *
 * Mode is checked at the start of every REST write controller. Observer
 * mode auto-applies dry_run; quiet/kill_switch refuse with 423.
 */
final class OperatingMode
{
    public const MODE_LIVE = 'live';
    public const MODE_OBSERVER = 'observer';
    public const MODE_QUIET = 'quiet';
    public const MODE_KILL_SWITCH = 'kill_switch';

    /** @return array{mode:string, expires_at:?string, staging_mandatory:bool} */
    public function current(): array
    {
        $raw = get_option('joist_operating_mode', [
            'mode' => self::MODE_OBSERVER, // safer default for new installs
            'expires_at' => null,
            'staging_mandatory' => false,
        ]);
        if (!is_array($raw)) {
            $raw = ['mode' => self::MODE_OBSERVER, 'expires_at' => null, 'staging_mandatory' => false];
        }

        // Auto-expire quiet mode.
        if ($raw['mode'] === self::MODE_QUIET
            && !empty($raw['expires_at'])
            && strtotime($raw['expires_at']) < time()
        ) {
            $raw['mode'] = self::MODE_LIVE;
            $raw['expires_at'] = null;
            $this->set($raw['mode'], null, (bool) $raw['staging_mandatory']);
        }

        return $raw;
    }

    public function set(string $mode, ?int $durationMinutes = null, bool $stagingMandatory = false): void
    {
        $valid = [self::MODE_LIVE, self::MODE_OBSERVER, self::MODE_QUIET, self::MODE_KILL_SWITCH];
        if (!in_array($mode, $valid, true)) {
            throw new WriteException('operating_mode.invalid', "Invalid mode '{$mode}'.", 422);
        }
        $expiresAt = null;
        if ($mode === self::MODE_QUIET && $durationMinutes !== null && $durationMinutes > 0) {
            $expiresAt = date('Y-m-d H:i:s', time() + ($durationMinutes * 60));
        }
        update_option('joist_operating_mode', [
            'mode' => $mode,
            'expires_at' => $expiresAt,
            'staging_mandatory' => $stagingMandatory,
        ], false);

        do_action('joist_operating_mode_changed', $mode, $expiresAt, $stagingMandatory);
    }

    /**
     * Called at the start of every write REST handler. Returns true if
     * the request should proceed normally, false if observer mode should
     * coerce dry_run, throws if quiet/kill_switch.
     *
     * @param ?string $requestOrigin Origin header value, for staging_mandatory check.
     * @return bool true = proceed; false = force dry_run (observer mode)
     * @throws WriteException 423 for quiet/kill_switch
     */
    public function intercept(?string $requestOrigin = null): bool
    {
        $state = $this->current();

        // Staging mandatory check.
        if (!empty($state['staging_mandatory'])) {
            $pattern = get_option('joist_staging_url_pattern', '');
            if ($pattern !== '' && (!$requestOrigin || !preg_match("#{$pattern}#", $requestOrigin))) {
                throw new WriteException(
                    'operating_mode.staging_required',
                    'Site is in staging-mandatory mode. Writes must originate from the configured staging URL.',
                    423
                );
            }
        }

        return match ($state['mode']) {
            self::MODE_LIVE => true,
            self::MODE_OBSERVER => false,
            self::MODE_QUIET => throw new WriteException(
                'operating_mode.quiet',
                'Site is in quiet mode. Writes paused until ' . ($state['expires_at'] ?? 'further notice') . '.',
                423,
                ['expires_at' => $state['expires_at']]
            ),
            self::MODE_KILL_SWITCH => throw new WriteException(
                'operating_mode.killed',
                'Site is in kill-switch mode. All agent writes refused.',
                423
            ),
            default => true,
        };
    }
}
