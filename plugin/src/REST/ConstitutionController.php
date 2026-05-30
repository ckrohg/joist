<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Constitution\ConstitutionLoader;
use Joist\Container;
use Joist\Elementor\WriteException;
use WP_REST_Request;
use WP_REST_Server;

/**
 * @purpose REST surface for the v0.9 constitution substrate (Wave 10b).
 *
 * Routes:
 *   GET    /joist/v1/constitution/{site_id}
 *          -> {constitution, source, token_estimate, cache_key}
 *          Read-only, requires the agent capability.
 *
 *   PUT    /joist/v1/constitution/{site_id}
 *          body: {markdown: string}
 *          -> {constitution, source, token_estimate, cache_key, path}
 *          Admin-only (manage_options). Read-after-write per failure-mode #2.
 *
 *   DELETE /joist/v1/constitution/{site_id}
 *          -> {removed: bool, constitution, source, token_estimate, cache_key}
 *          Admin-only. Removes the override; subsequent GET returns
 *          agency_default unless the bundled file is also empty.
 *
 * Cross-cutting:
 *   #1  Unknown body fields are rejected with 422.
 *   #2  PUT/DELETE return the post-write effective constitution.
 *   #16 No silent failures: every error path carries a typed error code.
 *   Path traversal hardened: site_id must match ^[A-Za-z0-9_-]{1,64}$ AND the
 *       resolved override path must live inside wp-content/uploads/joist/sites/.
 */
final class ConstitutionController extends ControllerBase
{
    private const ALLOWED_PUT_FIELDS = ['markdown'];

    /**
     * Hard upper bound on a single override body. 256 KiB is ~64K tokens —
     * far past any reasonable hand-authored constitution and well inside
     * Anthropic's 200K context. Anything larger is almost certainly a paste
     * accident.
     */
    private const MAX_OVERRIDE_BYTES = 262144;

    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/constitution/(?P<site_id>[A-Za-z0-9_-]{1,64})', [
            [
                'methods' => WP_REST_Server::READABLE,
                'callback' => [$this, 'get'],
                'permission_callback' => [$this, 'permissionsCheck'],
            ],
            [
                'methods' => WP_REST_Server::EDITABLE, // PUT + PATCH; we accept both.
                'callback' => [$this, 'put'],
                'permission_callback' => [$this, 'permissionsAdmin'],
            ],
            [
                'methods' => 'DELETE',
                'callback' => [$this, 'delete'],
                'permission_callback' => [$this, 'permissionsAdmin'],
            ],
        ]);
    }

    public function get(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $siteId = $this->resolveSiteId($req);
            $loader = $this->loader();
            $markdown = $loader->effective($siteId);
            $source = $loader->effectiveSource($siteId);
            return $this->ok([
                'site_id' => $siteId,
                'constitution' => $markdown,
                'source' => $source,
                'token_estimate' => $loader->tokenEstimate($markdown),
                'cache_key' => $loader->cacheKey($siteId),
            ]);
        });
    }

    public function put(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $siteId = $this->resolveSiteId($req);
            $body = $this->jsonBody($req);
            $this->rejectUnknownFields($body, self::ALLOWED_PUT_FIELDS);

            if (!isset($body['markdown']) || !is_string($body['markdown'])) {
                throw new WriteException(
                    'constitution.missing_field',
                    'Required field: markdown (string).',
                    422,
                    ['missing_field' => 'markdown']
                );
            }
            $markdown = (string) $body['markdown'];
            if (strlen($markdown) > self::MAX_OVERRIDE_BYTES) {
                throw new WriteException(
                    'constitution.too_large',
                    'Constitution override exceeds ' . self::MAX_OVERRIDE_BYTES . ' bytes.',
                    422,
                    ['max_bytes' => self::MAX_OVERRIDE_BYTES, 'got_bytes' => strlen($markdown)]
                );
            }

            $loader = $this->loader();
            try {
                $path = $loader->writeSiteOverride($siteId, $markdown);
            } catch (\InvalidArgumentException $e) {
                throw new WriteException('constitution.invalid_site_id', $e->getMessage(), 422);
            } catch (\RuntimeException $e) {
                throw new WriteException('constitution.write_failed', $e->getMessage(), 500);
            }

            // #2 read-after-write: return the post-write effective state.
            $effective = $loader->effective($siteId);
            return $this->ok([
                'site_id' => $siteId,
                'constitution' => $effective,
                'source' => $loader->effectiveSource($siteId),
                'token_estimate' => $loader->tokenEstimate($effective),
                'cache_key' => $loader->cacheKey($siteId),
                'path' => $path,
            ]);
        });
    }

    public function delete(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $siteId = $this->resolveSiteId($req);
            $loader = $this->loader();
            try {
                $removed = $loader->deleteSiteOverride($siteId);
            } catch (\InvalidArgumentException $e) {
                throw new WriteException('constitution.invalid_site_id', $e->getMessage(), 422);
            }
            $effective = $loader->effective($siteId);
            return $this->ok([
                'site_id' => $siteId,
                'removed' => $removed,
                'constitution' => $effective,
                'source' => $loader->effectiveSource($siteId),
                'token_estimate' => $loader->tokenEstimate($effective),
                'cache_key' => $loader->cacheKey($siteId),
            ]);
        });
    }

    /**
     * Resolve and validate the site_id path param. The route regex already
     * gates the URL, but a defensive check keeps the contract intact if the
     * route is ever loosened.
     */
    private function resolveSiteId(WP_REST_Request $req): string
    {
        $siteId = (string) $req->get_param('site_id');
        try {
            $this->loader()->assertValidSiteId($siteId);
        } catch (\InvalidArgumentException $e) {
            throw new WriteException('constitution.invalid_site_id', $e->getMessage(), 422);
        }
        return $siteId;
    }

    /**
     * @return array<string,mixed>
     */
    private function jsonBody(WP_REST_Request $req): array
    {
        $body = $req->get_json_params();
        if (!is_array($body)) {
            throw new WriteException('constitution.invalid_body', 'JSON body required.', 400);
        }
        return $body;
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
                'constitution.unknown_field',
                'Unknown field(s): ' . implode(', ', $unknown) . '. Valid: ' . implode(', ', $allowed) . '.',
                422,
                ['unknown_fields' => $unknown, 'valid_fields' => $allowed]
            );
        }
    }

    private function loader(): ConstitutionLoader
    {
        return Container::get('constitutionLoader');
    }
}
