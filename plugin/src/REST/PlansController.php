<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\Container;
use Joist\Elementor\WriteException;
use Joist\Plan\PageFactory;
use WP_REST_Request;
use WP_REST_Server;

/**
 * /joist/v1/plans — Plan Mode (§19.1).
 *
 * Create (agent) → approve in WP admin with approval_token + CSRF +
 * approver-binding → execute atomically.
 */
final class PlansController extends ControllerBase
{
    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/plans', [
            ['methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'create'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'list'], 'permission_callback' => [$this, 'permissionsCheck']],
        ]);
        register_rest_route(self::NAMESPACE, '/plans/(?P<id>[A-Za-z0-9_-]+)', [
            ['methods' => WP_REST_Server::READABLE, 'callback' => [$this, 'get'], 'permission_callback' => [$this, 'permissionsCheck']],
            ['methods' => 'DELETE', 'callback' => [$this, 'delete'], 'permission_callback' => [$this, 'permissionsAdmin']],
        ]);
        register_rest_route(self::NAMESPACE, '/plans/(?P<id>[A-Za-z0-9_-]+)/approve', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'approve'], 'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
        register_rest_route(self::NAMESPACE, '/plans/(?P<id>[A-Za-z0-9_-]+)/reject', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'reject'], 'permission_callback' => [$this, 'permissionsAdmin'],
        ]);
        register_rest_route(self::NAMESPACE, '/plans/(?P<id>[A-Za-z0-9_-]+)/execute', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'execute'], 'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/plans/generate', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'generate'], 'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/plans/clone-from-screenshots', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'cloneFromScreenshots'], 'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/plans/clone-from-url', [
            'methods' => WP_REST_Server::CREATABLE, 'callback' => [$this, 'cloneFromUrl'], 'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    /**
     * POST /plans/generate — translate a natural-language intent into a Plan.
     *
     * Body: { intent: string, page_id?: int, title?: string }
     * Returns: the freshly-created Plan row (same shape as POST /plans),
     *          plus `created_new_page: bool` and `created_page_id: ?int`
     *          when we had to scaffold a blank Elementor page first.
     *
     * Falls back to a deterministic template plan when no Anthropic API key
     * is configured so the loop can be demoed without a paid call.
     *
     * When `page_id` is omitted or 0 we create a blank Elementor-ready WP page
     * so the executor has a real target to write into — `create_page` is not
     * yet a supported plan op and PlanExecutor would otherwise blow up on a
     * `documents->get(0)` lookup.
     */
    public function generate(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req, string $sessionId) {
            $body = $req->get_json_params();
            $intent = trim((string) ($body['intent'] ?? ''));
            $suppliedPageId = isset($body['page_id']) ? (int) $body['page_id'] : 0;
            $title = isset($body['title']) ? trim((string) $body['title']) : '';
            if ($intent === '') {
                throw new WriteException('validation.intent_required', 'intent is required.', 422);
            }

            $createdNewPage = false;
            if ($suppliedPageId > 0) {
                $pageId = $suppliedPageId;
            } else {
                $pageId = PageFactory::createBlankElementorPage($intent, $title);
                $createdNewPage = true;
            }

            $generator = new \Joist\Plan\PlanGenerator();
            $steps = $generator->generate($intent, $pageId);
            $plan = Container::get('planStore')->create($sessionId, $pageId, $intent, $steps);
            Container::get('webhooks')->emit('plan.created', [
                'plan_id' => $plan['plan_id'],
                'page_id' => $pageId,
                'intent' => $intent,
                'step_count' => count($steps),
                'generated' => true,
                'source' => 'plan_generator',
                'created_new_page' => $createdNewPage,
            ]);
            return $this->ok(array_merge($plan, [
                'step_count' => count($steps),
                'created_new_page' => $createdNewPage,
                'created_page_id' => $createdNewPage ? $pageId : null,
            ]), 201);
        });
    }


    public function create(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req, string $sessionId) {
            $body = $req->get_json_params();
            $intent = (string) ($body['intent'] ?? 'unspecified');
            $title = isset($body['title']) ? trim((string) $body['title']) : '';
            $suppliedPageId = isset($body['page_id']) ? (int) $body['page_id'] : 0;
            $steps = is_array($body['steps'] ?? null) ? $body['steps'] : [];
            if (count($steps) === 0) throw new WriteException('validation.empty_steps', 'A plan needs at least one step.', 400);

            $createdNewPage = false;
            if ($suppliedPageId > 0) {
                $pageId = $suppliedPageId;
            } else {
                $pageId = PageFactory::createBlankElementorPage($intent, $title);
                $createdNewPage = true;
            }

            $plan = Container::get('planStore')->create($sessionId, $pageId, $intent, $steps);
            Container::get('webhooks')->emit('plan.created', [
                'plan_id' => $plan['plan_id'],
                'page_id' => $pageId,
                'intent' => $intent,
                'step_count' => count($steps),
                'approval_url' => $plan['approval_url'],
                'created_new_page' => $createdNewPage,
            ]);
            return $this->ok(array_merge($plan, [
                'created_new_page' => $createdNewPage,
                'created_page_id' => $createdNewPage ? $pageId : null,
            ]), 201);
        });
    }

    /**
     * DELETE /plans/{id} — admin-only permanent delete. Used by the Plan Mode
     * UI to clean up test plans and cancelled drafts. Returns 204-shape ok
     * envelope after the row is gone.
     */
    public function delete(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $planId = (string) $req['id'];
            Container::get('planStore')->delete($planId);
            Container::get('webhooks')->emit('plan.deleted', ['plan_id' => $planId]);
            return $this->ok(['deleted' => true, 'plan_id' => $planId]);
        });
    }

    public function list(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', fn() => $this->ok(['plans' => Container::get('planStore')->listRecent()]));
    }

    public function get(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $plan = Container::get('planStore')->get((string) $req->get_param('id'));
            if ($plan === null) throw new WriteException('not_found.plan', 'Plan not found.', 404);
            unset($plan['approval_token']); // never echo the token in a read
            return $this->ok($plan);
        });
    }

    public function approve(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $planId = (string) $req->get_param('id');
            $body = $req->get_json_params();
            $token = (string) ($body['approval_token'] ?? $req->get_param('token') ?? '');
            if ($token === '') throw new WriteException('validation.token_required', 'approval_token is required.', 400);

            $user = wp_get_current_user();
            $plan = Container::get('planStore')->approve(
                $planId, $token, (int) $user->ID, 'wp-admin:' . substr(wp_get_session_token() ?: '', 0, 16)
            );
            return $this->ok(['plan_id' => $planId, 'status' => 'approved', 'page_id' => $plan['page_id']]);
        });
    }

    public function reject(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $planId = (string) $req->get_param('id');
            $body = $req->get_json_params();
            $token = (string) ($body['approval_token'] ?? $req->get_param('token') ?? '');
            Container::get('planStore')->reject($planId, $token, $body['note'] ?? null);
            return $this->ok(['plan_id' => $planId, 'status' => 'rejected']);
        });
    }

    public function execute(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $planId = (string) $req->get_param('id');
            $result = Container::get('planExecutor')->execute($planId);
            return $this->ok($result);
        });
    }

    /**
     * POST /plans/clone-from-screenshots — cheap-substitute clone path.
     *
     * Multipart upload of up to 3 PNG/JPG images (≤5 MB each) plus optional
     * intent + page_id. Server re-detects MIME with finfo (never trusts the
     * client filename), converts each accepted image to a base64 vision
     * block, and hands the blocks to CloneGenerator which produces a V3
     * Plan via Claude Opus 4.7 (or a deterministic stub when no key is
     * configured).
     *
     * Same rate-limit bucket as /plans/generate ('reads').
     *
     * @return WP_REST_Response Plan row + step_count + image_count.
     */
    public function cloneFromScreenshots(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req, string $sessionId) {
            $files = $req->get_file_params();
            $intent = trim((string) ($req->get_param('intent') ?? ''));
            $suppliedPageId = (int) ($req->get_param('page_id') ?? 0);

            $imageBlocks = $this->validateAndPrepareImageBlocks($files);

            $createdNewPage = false;
            if ($suppliedPageId > 0) {
                $pageId = $suppliedPageId;
            } else {
                $pageId = PageFactory::createBlankElementorPage(
                    $intent !== '' ? $intent : 'Screenshot clone'
                );
                $createdNewPage = true;
            }

            $generator = new \Joist\Plan\CloneGenerator();
            $steps = $generator->generateFromImages($imageBlocks, $intent, $pageId);

            $plan = Container::get('planStore')->create(
                $sessionId,
                $pageId,
                $intent !== '' ? $intent : 'Screenshot clone',
                $steps
            );
            Container::get('webhooks')->emit('plan.created', [
                'plan_id' => $plan['plan_id'],
                'page_id' => $pageId,
                'intent' => $intent,
                'step_count' => count($steps),
                'generated' => true,
                'source' => 'clone_from_screenshots',
                'image_count' => count($imageBlocks),
                'created_new_page' => $createdNewPage,
            ]);
            return $this->ok(array_merge($plan, [
                'step_count' => count($steps),
                'image_count' => count($imageBlocks),
                'source' => 'clone_from_screenshots',
                'created_new_page' => $createdNewPage,
                'created_page_id' => $createdNewPage ? $pageId : null,
            ]), 201);
        });
    }

    /**
     * POST /plans/clone-from-url — fetch a URL server-side, hand the HTML to
     * Claude, get a V3 Plan back. Cheap-substitute for the headless-Chromium
     * pipeline: structure + copy fidelity only, no visual cues.
     *
     * Body: { url: string, intent?: string, page_id?: int, title?: string }
     *
     * Defenses:
     *   - URL must be http(s)
     *   - SSRF guard: reject loopback / RFC1918 / link-local hosts in production
     *     (admins can opt-in via the `joist_allow_local_url_clone` filter)
     *   - 10 MB max response body; HTML/XHTML content-type only
     *   - 20-second fetch timeout
     */
    public function cloneFromUrl(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req, string $sessionId) {
            $body = $req->get_json_params();
            $url = trim((string) ($body['url'] ?? ''));
            $intent = trim((string) ($body['intent'] ?? ''));
            $title = isset($body['title']) ? trim((string) $body['title']) : '';
            $suppliedPageId = isset($body['page_id']) ? (int) $body['page_id'] : 0;

            if ($url === '') {
                throw new WriteException('validation.url_required', 'url is required.', 422);
            }
            $parsed = parse_url($url);
            if (!is_array($parsed) || !in_array(($parsed['scheme'] ?? ''), ['http', 'https'], true) || empty($parsed['host'])) {
                throw new WriteException('clone_url.invalid_url', 'URL must be a fully-qualified http(s) URL.', 422);
            }
            $this->guardSsrf((string) $parsed['host']);

            // Fetch (HEAD + GET — but skip HEAD because some sites 405 it; go straight to GET with size cap).
            $resp = wp_remote_get($url, [
                'timeout' => 20,
                'redirection' => 5,
                'user-agent' => 'JoistCloneBot/0.9 (+https://github.com/ckrohg/joist)',
                'headers' => ['accept' => 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'],
            ]);
            if (is_wp_error($resp)) {
                throw new WriteException('clone_url.fetch_failed', 'URL fetch failed: ' . $resp->get_error_message(), 502, ['url' => $url]);
            }
            $code = (int) wp_remote_retrieve_response_code($resp);
            if ($code < 200 || $code >= 300) {
                throw new WriteException('clone_url.fetch_failed', "URL returned HTTP {$code}", 502, ['url' => $url, 'status' => $code]);
            }
            $contentType = (string) wp_remote_retrieve_header($resp, 'content-type');
            if ($contentType !== '' && stripos($contentType, 'html') === false && stripos($contentType, 'xml') === false) {
                throw new WriteException('clone_url.not_html', "URL returned content-type {$contentType}; only HTML pages can be cloned.", 415, ['content_type' => $contentType]);
            }
            $html = (string) wp_remote_retrieve_body($resp);
            $maxBytes = 10 * 1024 * 1024;
            if (strlen($html) > $maxBytes) {
                throw new WriteException('clone_url.too_large', 'URL body exceeds 10 MB cap.', 413, ['bytes' => strlen($html)]);
            }
            if (strlen($html) < 200) {
                throw new WriteException('clone_url.empty_body', 'URL body was empty or too small to clone.', 422, ['bytes' => strlen($html)]);
            }

            // Provision a page if one wasn't supplied.
            $createdNewPage = false;
            if ($suppliedPageId > 0) {
                $pageId = $suppliedPageId;
            } else {
                $derivedTitle = $title !== '' ? $title : ('Clone — ' . ($parsed['host'] ?? 'website'));
                $pageId = PageFactory::createBlankElementorPage($intent !== '' ? $intent : ('Clone of ' . $url), $derivedTitle);
                $createdNewPage = true;
            }

            $generator = new \Joist\Plan\CloneGenerator();
            $steps = $generator->generateFromHtml($html, $url, $intent, $pageId);

            $plan = Container::get('planStore')->create(
                $sessionId,
                $pageId,
                $intent !== '' ? $intent : ('Clone of ' . $url),
                $steps
            );
            Container::get('webhooks')->emit('plan.created', [
                'plan_id' => $plan['plan_id'],
                'page_id' => $pageId,
                'intent' => $intent,
                'step_count' => count($steps),
                'generated' => true,
                'source' => 'clone_from_url',
                'source_url' => $url,
                'created_new_page' => $createdNewPage,
            ]);
            return $this->ok(array_merge($plan, [
                'step_count' => count($steps),
                'source' => 'clone_from_url',
                'source_url' => $url,
                'created_new_page' => $createdNewPage,
                'created_page_id' => $createdNewPage ? $pageId : null,
            ]), 201);
        });
    }

    /**
     * Block obvious SSRF targets: loopback, RFC1918, link-local, .local hosts.
     * Admins can opt-in (e.g. for local dev) via the `joist_allow_local_url_clone` filter.
     */
    private function guardSsrf(string $host): void
    {
        if (apply_filters('joist_allow_local_url_clone', false, $host)) return;
        $hostLower = strtolower($host);
        if (in_array($hostLower, ['localhost', 'localhost.localdomain'], true) || str_ends_with($hostLower, '.local') || str_ends_with($hostLower, '.localhost')) {
            throw new WriteException('clone_url.local_blocked', 'Localhost / .local URLs are blocked by default.', 422, ['host' => $host]);
        }
        $ip = filter_var($host, FILTER_VALIDATE_IP) ? $host : gethostbyname($host);
        if ($ip === $host && !filter_var($host, FILTER_VALIDATE_IP)) return; // resolution failed — let wp_remote_get surface it
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
            throw new WriteException('clone_url.private_blocked', 'Private/loopback/reserved IPs are blocked by default.', 422, ['resolved_ip' => $ip]);
        }
    }

    /**
     * Validate the multipart `images[]` field and convert each accepted file
     * to an Anthropic vision block. Enforces:
     *   - 1..3 images total
     *   - per-file size ≤ 5 MB
     *   - PHP upload status === UPLOAD_ERR_OK
     *   - server-side finfo MIME re-detection (never trust client name/MIME)
     *   - only image/png and image/jpeg accepted
     *
     * @param array<string, mixed> $files $req->get_file_params() output.
     * @return list<array{type:string,source:array{type:string,media_type:string,data:string}}>
     */
    private function validateAndPrepareImageBlocks(array $files): array
    {
        $bucket = $files['images'] ?? null;
        if (!is_array($bucket) || empty($bucket['tmp_name'])) {
            throw new WriteException(
                'clone.invalid_upload',
                'Upload field "images" is required (multipart/form-data with images[] entries).',
                422
            );
        }

        // PHP's multi-upload shape: each key is an array indexed by upload slot.
        // For single-file uploads PHP gives scalars instead — normalize both.
        $tmpNames = (array) ($bucket['tmp_name'] ?? []);
        $sizes    = (array) ($bucket['size'] ?? []);
        $errors   = (array) ($bucket['error'] ?? []);
        $names    = (array) ($bucket['name'] ?? []);
        // Normalize: ensure all arrays are 0-indexed lists of the same length.
        $tmpNames = array_values($tmpNames);
        $sizes    = array_values($sizes);
        $errors   = array_values($errors);
        $names    = array_values($names);

        $count = count($tmpNames);
        if ($count === 0) {
            throw new WriteException(
                'clone.invalid_upload',
                'At least one image file is required.',
                422
            );
        }
        if ($count > 3) {
            throw new WriteException(
                'clone.invalid_upload',
                'A maximum of 3 images is supported.',
                422,
                ['received' => $count]
            );
        }

        if (!class_exists('finfo')) {
            throw new WriteException(
                'clone.finfo_missing',
                'Server is missing the fileinfo extension required to validate uploads.',
                500
            );
        }
        $finfo = new \finfo(FILEINFO_MIME_TYPE);

        $allowed = ['image/png' => 'image/png', 'image/jpeg' => 'image/jpeg'];
        $maxBytes = 5 * 1024 * 1024;

        $blocks = [];
        for ($i = 0; $i < $count; $i++) {
            $tmp = (string) ($tmpNames[$i] ?? '');
            $err = (int) ($errors[$i] ?? \UPLOAD_ERR_NO_FILE);
            $size = (int) ($sizes[$i] ?? 0);
            $name = (string) ($names[$i] ?? "image[$i]");

            if ($err !== \UPLOAD_ERR_OK || $tmp === '' || !is_uploaded_file($tmp)) {
                throw new WriteException(
                    'clone.invalid_upload',
                    "Upload slot {$i} failed (error code {$err}).",
                    422,
                    ['slot' => $i, 'name' => $name, 'php_upload_error' => $err]
                );
            }
            if ($size <= 0 || $size > $maxBytes) {
                throw new WriteException(
                    'clone.invalid_upload',
                    "Image {$name} is " . number_format($size) . " bytes; max is 5 MB.",
                    422,
                    ['slot' => $i, 'name' => $name, 'size' => $size, 'max' => $maxBytes]
                );
            }
            $detected = (string) $finfo->file($tmp);
            if (!isset($allowed[$detected])) {
                throw new WriteException(
                    'clone.invalid_upload',
                    "Image {$name} has detected MIME {$detected}; only PNG or JPEG are accepted.",
                    422,
                    ['slot' => $i, 'name' => $name, 'detected_mime' => $detected]
                );
            }

            $bytes = @file_get_contents($tmp);
            if ($bytes === false || $bytes === '') {
                throw new WriteException(
                    'clone.invalid_upload',
                    "Could not read uploaded file {$name}.",
                    500,
                    ['slot' => $i, 'name' => $name]
                );
            }

            $blocks[] = [
                'type' => 'image',
                'source' => [
                    'type' => 'base64',
                    'media_type' => $allowed[$detected],
                    'data' => base64_encode($bytes),
                ],
            ];
        }

        return $blocks;
    }
}
