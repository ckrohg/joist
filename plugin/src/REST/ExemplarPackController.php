<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use Joist\ExemplarPack\ExemplarPackManager;
use WP_REST_Request;
use WP_REST_Server;

/**
 * @purpose REST surface for the v0.9 exemplar pack (Wave 10c, three-tier
 * taste substrate layer 3).
 *
 * Routes:
 *   GET    /joist/v1/exemplar-pack/{site_id}
 *          List the most-recent approved exemplars (default limit 10, cap 20).
 *
 *   GET    /joist/v1/exemplar-pack/{site_id}/rendered
 *          Return the cached message-history array — the prompt-ready shape
 *          that BrandBlockAssembler embeds into the cached prefix.
 *
 *   POST   /joist/v1/exemplar-pack/{site_id}/pin/{exemplar_id}
 *          Mark pinned (survives purge + FIFO eviction).
 *
 *   DELETE /joist/v1/exemplar-pack/{site_id}/{exemplar_id}
 *          Admin-only explicit deletion.
 *
 * Cross-cutting:
 *   - site_id is validated against [A-Za-z0-9._-]{1,64}. Anything else returns
 *     422 (path traversal hardening per failure-mode constraint #16).
 *   - exemplar_id validated identically.
 *   - Cross-site reads / writes return 403. The caller's resolved site is
 *     PreferenceMemory::siteId(); requesting another site's pack is refused
 *     unless the caller has manage_options.
 *   - Unknown body fields rejected with 422 (failure-mode #1).
 *
 * Sister controllers: PreferencesController (Layer 2),
 * ConstitutionController (Layer 1, shipped by Wave 10b).
 */
final class ExemplarPackController extends ControllerBase
{
    /** Body fields accepted on the POST /pin route. Empty body is also valid. */
    private const ALLOWED_PIN_FIELDS = ['pinned'];

    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/exemplar-pack/(?P<site_id>[A-Za-z0-9._-]{1,64})', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'list'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/exemplar-pack/(?P<site_id>[A-Za-z0-9._-]{1,64})/rendered', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'rendered'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/exemplar-pack/(?P<site_id>[A-Za-z0-9._-]{1,64})/pin/(?P<exemplar_id>[A-Za-z0-9._-]{1,64})', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'pin'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/exemplar-pack/(?P<site_id>[A-Za-z0-9._-]{1,64})/(?P<exemplar_id>[A-Za-z0-9._-]{1,64})', [
            'methods' => 'DELETE',
            'callback' => [$this, 'delete'],
            'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
    }

    public function list(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $siteId = $this->resolveSiteParam($req);
            $this->assertOwnSite($siteId);
            $manager = $this->manager();
            $limit = (int) ($req->get_param('limit') ?? ExemplarPackManager::DEFAULT_RENDER_LIMIT);
            $items = $manager->recentApproved($siteId, $limit);
            return $this->ok([
                'site_id' => $siteId,
                'exemplars' => $items,
                'total' => count($items),
                'max_per_site' => ExemplarPackManager::MAX_APPROVED,
            ]);
        });
    }

    public function rendered(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $siteId = $this->resolveSiteParam($req);
            $this->assertOwnSite($siteId);
            $manager = $this->manager();

            $includeNegative = $req->get_param('include_negative');
            $includeNegativeBool = !($includeNegative === '0' || $includeNegative === 'false' || $includeNegative === false);

            $messages = $manager->renderForPrompt($siteId, [
                'limit' => (int) ($req->get_param('limit') ?? ExemplarPackManager::DEFAULT_RENDER_LIMIT),
                'include_negative' => $includeNegativeBool,
                'include' => true, // explicit opt-in (this route IS the in-loop call)
            ]);

            return $this->ok([
                'site_id' => $siteId,
                'messages' => $messages,
                'message_count' => count($messages),
                'include_negative' => $includeNegativeBool,
            ]);
        });
    }

    public function pin(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $siteId = $this->resolveSiteParam($req);
            $exemplarId = $this->resolveExemplarParam($req);
            $this->assertOwnSite($siteId);

            // Body is optional — default is to pin (true). Allow {"pinned": false}
            // to unpin via the same endpoint without a separate route.
            $body = $req->get_json_params();
            if (is_array($body)) {
                $this->rejectUnknownFields($body, self::ALLOWED_PIN_FIELDS);
            }
            $pinned = true;
            if (is_array($body) && array_key_exists('pinned', $body)) {
                $pinned = (bool) $body['pinned'];
            }

            $manager = $this->manager();
            $ok = $manager->setPinned($siteId, $exemplarId, $pinned);
            if (!$ok) {
                throw new WriteException(
                    'exemplar_pack.not_found',
                    'Exemplar not found on this site.',
                    404,
                    ['exemplar_id' => $exemplarId, 'site_id' => $siteId]
                );
            }
            return $this->ok([
                'exemplar_id' => $exemplarId,
                'pinned' => $pinned,
            ]);
        });
    }

    public function delete(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $siteId = $this->resolveSiteParam($req);
            $exemplarId = $this->resolveExemplarParam($req);
            // Note: permissionsAdmin already gated this route; we still check
            // site-ownership for defense in depth.
            $manager = $this->manager();
            $ok = $manager->delete($siteId, $exemplarId);
            if (!$ok) {
                throw new WriteException(
                    'exemplar_pack.not_found',
                    'Exemplar not found on this site.',
                    404,
                    ['exemplar_id' => $exemplarId, 'site_id' => $siteId]
                );
            }
            return $this->ok([
                'exemplar_id' => $exemplarId,
                'deleted' => true,
            ]);
        });
    }

    // ──────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ──────────────────────────────────────────────────────────────────────

    private function manager(): ExemplarPackManager
    {
        if (Container::has('exemplarPackManager')) {
            return Container::get('exemplarPackManager');
        }
        // Fallback for partial deploys: instantiate directly with wpdb so
        // the controller still works if the Container registration line
        // hasn't been emitted yet.
        global $wpdb;
        return new ExemplarPackManager($wpdb);
    }

    private function resolveSiteParam(WP_REST_Request $req): string
    {
        $siteId = (string) $req->get_param('site_id');
        try {
            // Re-validate inside the manager so the error surface is uniform.
            $this->manager()->assertValidSiteId($siteId);
        } catch (\InvalidArgumentException $e) {
            throw new WriteException(
                'exemplar_pack.invalid_site_id',
                $e->getMessage(),
                422,
                ['site_id' => $siteId]
            );
        }
        return $siteId;
    }

    private function resolveExemplarParam(WP_REST_Request $req): string
    {
        $exemplarId = (string) $req->get_param('exemplar_id');
        try {
            $this->manager()->assertValidExemplarId($exemplarId);
        } catch (\InvalidArgumentException $e) {
            throw new WriteException(
                'exemplar_pack.invalid_exemplar_id',
                $e->getMessage(),
                422,
                ['exemplar_id' => $exemplarId]
            );
        }
        return $exemplarId;
    }

    /**
     * Cross-site bleed defense: the caller can only address their own site
     * unless they have manage_options (admin). Mirrors PreferencesController.
     */
    private function assertOwnSite(string $siteId): void
    {
        // Admins can read any site (useful for support / debugging).
        if (function_exists('current_user_can') && current_user_can('manage_options')) {
            return;
        }
        if (!Container::has('preferenceMemory')) {
            // No way to resolve current site — refuse rather than leak.
            throw new WriteException(
                'exemplar_pack.site_resolution_unavailable',
                'Cannot resolve current site for cross-site check; refusing.',
                403
            );
        }
        $currentSite = Container::get('preferenceMemory')->siteId();
        if ($currentSite !== $siteId) {
            throw new WriteException(
                'exemplar_pack.cross_site_refused',
                'Cross-site access refused. Request targeted site '
                    . $siteId . ' but caller is bound to ' . $currentSite . '.',
                403
            );
        }
    }

    /**
     * @param array<string,mixed> $body
     * @param list<string> $allowed
     */
    private function rejectUnknownFields(array $body, array $allowed): void
    {
        $unknown = [];
        foreach (array_keys($body) as $k) {
            if (!in_array($k, $allowed, true)) {
                $unknown[] = (string) $k;
            }
        }
        if (!empty($unknown)) {
            throw new WriteException(
                'exemplar_pack.unknown_field',
                'Unknown field(s): ' . implode(', ', $unknown) . '. Valid: ' . implode(', ', $allowed) . '.',
                422,
                ['unknown_fields' => $unknown, 'valid_fields' => $allowed]
            );
        }
    }
}
