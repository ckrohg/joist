<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use Joist\Plan\SitePartFactory;
use WP_REST_Request;
use WP_REST_Server;

/**
 * @purpose /joist/v1/site-parts — site-wide chrome (header/footer) as native
 * Elementor Pro Theme Builder documents, with display-condition registration.
 *
 * Why this exists when /templates already creates elementor_library docs:
 * templates.create stops at the document — it never registers display
 * conditions, so Pro's conditions cache stays stale and the part NEVER
 * RENDERS (the e0d7228 failure mode). This controller is the complete path:
 * scaffold (SitePartFactory::create) → tree via DocumentWriter (full
 * Document::save semantics: validation, OCC, audit, revisions) → conditions
 * + server-side cache rebuild (SitePartFactory::applyConditions).
 *
 * POST   /site-parts          {type: header|footer, elements, conditions?, title?, status?}
 * GET    /site-parts          list header/footer documents + their conditions
 * GET    /site-parts/<id>     one document incl. elements + conditions + cache state
 * PUT    /site-parts/<id>     {elements?, expected_hash (required w/ elements), conditions?}
 *
 * conditions default to ["include/general"] (entire site). Per-page scoping —
 * ["include/singular/page/<id>"] — is what the transpiler uses so a clone's
 * header never leaks onto unrelated (e.g. graded-corpus) pages.
 *
 * Responses carry `render_check_required: true` — a created part is NOT
 * proven until a frontend render probe shows it (JupiterX header-location
 * support is an open question; see SitePartFactory header comment).
 */
final class SitePartsController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/site-parts', [
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'list'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'create'], 'permission_callback' => [$this, 'permissionsCheck']],
        ]);
        register_rest_route(self::NAMESPACE, '/site-parts/(?P<id>\d+)', [
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'get'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::EDITABLE, 'callback' => [$this, 'update'], 'permission_callback' => [$this, 'permissionsCheck']],
        ]);
    }

    public function list(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $typeFilter = $req->get_param('type');
            $q = new \WP_Query([
                'post_type' => SitePartFactory::POST_TYPE,
                'post_status' => ['publish', 'draft', 'private'],
                'posts_per_page' => 100,
                'meta_query' => [[
                    'key' => '_elementor_template_type',
                    'value' => SitePartFactory::TYPES,
                    'compare' => 'IN',
                ]],
            ]);
            $items = [];
            foreach ($q->posts as $post) {
                $type = get_post_meta($post->ID, '_elementor_template_type', true);
                if ($typeFilter && $type !== $typeFilter) continue;
                $items[] = [
                    'id' => $post->ID,
                    'title' => $post->post_title,
                    'type' => $type,
                    'status' => $post->post_status,
                    'conditions' => SitePartFactory::conditionsFor($post->ID),
                    'cache_registered' => SitePartFactory::cacheRegistered($post->ID),
                    'hash' => Container::get('hasher')->forPage($post->ID),
                ];
            }
            return $this->ok(['items' => $items]);
        });
    }

    public function get(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $id = (int) $req->get_param('id');
            $this->assertSitePart($id);
            $document = \Elementor\Plugin::$instance->documents->get($id);
            if (!$document) throw new WriteException('not_found.site_part', "Site part {$id} is not an Elementor document.", 404);
            $elements = $document->get_elements_data();
            $elements = is_array($elements) ? $elements : [];
            return $this->ok([
                'id' => $id,
                'type' => get_post_meta($id, '_elementor_template_type', true),
                'status' => get_post_status($id) ?: null,
                'hash' => Container::get('hasher')->forElements($elements),
                'conditions' => SitePartFactory::conditionsFor($id),
                'cache_registered' => SitePartFactory::cacheRegistered($id),
                'elements' => $elements,
                'edit_url' => admin_url("post.php?post={$id}&action=elementor"),
            ]);
        });
    }

    public function create(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $body = $req->get_json_params();
            if (!is_array($body)) throw new WriteException('validation.invalid_body', 'JSON body required.', 400);

            $type = (string) ($body['type'] ?? '');
            $elements = is_array($body['elements'] ?? null) ? $body['elements'] : [];
            if ($elements === []) {
                throw new WriteException('validation.empty_elements', 'elements must be a non-empty Elementor tree — an empty site part would render as a blank band.', 400);
            }
            $conditions = is_array($body['conditions'] ?? null) && $body['conditions'] !== []
                ? $body['conditions']
                : ['include/general'];

            // Scaffold the Theme Builder document (validates type, asserts Pro).
            $postId = SitePartFactory::create(
                $type,
                (string) ($body['title'] ?? ''),
                (string) ($body['status'] ?? 'publish')
            );

            // Tree via the spine — full Document::save semantics. On failure the
            // scaffold post stays behind as a draft-grade artifact; surfacing the
            // id in the exception would be nicer but DocumentWriter throws typed
            // WriteExceptions we must not swallow. Conditions are applied ONLY
            // after a successful save so a failed part can never go live.
            $actor = $this->actorContext($req, $sessionId);
            $result = Container::get('documentWriter')->save(array_merge($actor, [
                'post_id' => $postId,
                'elements' => $elements,
                'page_settings' => is_array($body['page_settings'] ?? null) ? $body['page_settings'] : [],
                'intent' => $body['intent'] ?? "create {$type} site part",
            ]));

            $conditionsResult = SitePartFactory::applyConditions($postId, $conditions);

            return $this->ok([
                'id' => $postId,
                'type' => strtolower(trim($type)),
                'hash' => $result['new_hash'],
                'conditions' => $conditionsResult,
                'warnings' => $result['warnings'] ?? [],
                'edit_url' => admin_url("post.php?post={$postId}&action=elementor"),
                // A site part is NOT proven until a frontend page shows it.
                'render_check_required' => true,
            ], 201);
        });
    }

    public function update(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req, string $sessionId) {
            $id = (int) $req->get_param('id');
            $body = $req->get_json_params();
            if (!is_array($body)) throw new WriteException('validation.invalid_body', 'JSON body required.', 400);
            $this->assertSitePart($id);

            $hasElements = is_array($body['elements'] ?? null);
            $hasConditions = is_array($body['conditions'] ?? null);
            if (!$hasElements && !$hasConditions) {
                throw new WriteException('validation.nothing_to_update', 'Provide elements and/or conditions.', 400);
            }

            $out = ['id' => $id, 'render_check_required' => true];

            if ($hasElements) {
                if (!isset($body['expected_hash'])) {
                    throw new WriteException('validation.expected_hash_required', 'Updating elements requires expected_hash.', 400);
                }
                $actor = $this->actorContext($req, $sessionId);
                $result = Container::get('documentWriter')->save(array_merge($actor, [
                    'post_id' => $id,
                    'elements' => $body['elements'],
                    'page_settings' => is_array($body['page_settings'] ?? null) ? $body['page_settings'] : [],
                    'expected_hash' => $body['expected_hash'],
                    'intent' => $body['intent'] ?? 'update site part',
                ]));
                $out['new_hash'] = $result['new_hash'];
                $out['warnings'] = $result['warnings'] ?? [];
            }

            if ($hasConditions) {
                $out['conditions'] = SitePartFactory::applyConditions($id, $body['conditions']);
            }

            return $this->ok($out);
        });
    }

    /** @throws WriteException 404 unless $id is an elementor_library header/footer document. */
    private function assertSitePart(int $id): void
    {
        $post = get_post($id);
        if (!$post || $post->post_type !== SitePartFactory::POST_TYPE) {
            throw new WriteException('not_found.site_part', "Site part {$id} not found.", 404);
        }
        $type = get_post_meta($id, '_elementor_template_type', true);
        if (!in_array($type, SitePartFactory::TYPES, true)) {
            throw new WriteException(
                'not_found.site_part',
                "Post {$id} is an elementor_library document of type '{$type}', not a header/footer site part. Use /templates for other template types.",
                404
            );
        }
    }
}
