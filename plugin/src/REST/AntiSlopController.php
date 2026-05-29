<?php
declare(strict_types=1);

namespace Joist\REST;

use Joist\AntiSlop\BannedLexicon;
use Joist\AntiSlop\CopyValidator;
use Joist\AntiSlop\ImageValidator;
use Joist\AntiSlop\SlopFeedback;
use Joist\Container;
use Joist\Elementor\WriteException;
use Joist\Eval\PreferenceMemory;
use WP_REST_Request;
use WP_REST_Server;

/**
 * @purpose REST surface for the Wave 6a anti-slop validators.
 *
 * Routes:
 *   POST /joist/v1/anti-slop/copy
 *        body: {text: string, site_id?: string}
 *        -> ValidationResult JSON
 *
 *   POST /joist/v1/anti-slop/image
 *        body: {image_url?: string, image_b64?: string, brand_profile: object}
 *        -> ImageValidationResult JSON
 *
 *   POST /joist/v1/anti-slop/feedback
 *        body: {site_id: string, text: string, violation_match: object}
 *        -> {result, state} JSON (read-after-write per #2)
 *
 *   GET  /joist/v1/anti-slop/lexicon
 *        -> banned-lexicon summary (for prompt-cache builders + admin UI)
 *
 * Cross-cutting:
 *   - Unknown body fields → 422 (failure-mode #1).
 *   - Missing required fields → 422.
 *   - All endpoints surface a recovery_suggestions[] via ControllerBase.
 */
final class AntiSlopController extends ControllerBase
{
    private const ALLOWED_COPY_FIELDS = ['text', 'site_id'];
    private const ALLOWED_IMAGE_FIELDS = ['image_url', 'image_b64', 'brand_profile', 'site_id'];
    private const ALLOWED_FEEDBACK_FIELDS = ['site_id', 'text', 'violation_match', 'threshold'];

    public function register(): void
    {
        register_rest_route(self::NAMESPACE, '/anti-slop/copy', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'validateCopy'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/anti-slop/image', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'validateImage'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/anti-slop/feedback', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [$this, 'recordFeedback'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
        register_rest_route(self::NAMESPACE, '/anti-slop/lexicon', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [$this, 'lexicon'],
            'permission_callback' => [$this, 'permissionsCheck'],
        ]);
    }

    public function validateCopy(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $body = $this->jsonBody($req);
            $this->rejectUnknownFields($body, self::ALLOWED_COPY_FIELDS, 'copy');
            if (!isset($body['text']) || !is_string($body['text'])) {
                throw new WriteException('anti_slop.missing_field', 'Required field: text (string).', 422, ['missing_field' => 'text']);
            }
            $siteId = isset($body['site_id']) && is_string($body['site_id']) ? $body['site_id'] : null;
            $validator = new CopyValidator(Container::get('preferenceMemory'));
            $result = $validator->validate((string) $body['text'], $siteId);
            return $this->ok($result->toApi());
        });
    }

    public function validateImage(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function (WP_REST_Request $req) {
            $body = $this->jsonBody($req);
            $this->rejectUnknownFields($body, self::ALLOWED_IMAGE_FIELDS, 'image');

            if (empty($body['image_url']) && empty($body['image_b64'])) {
                throw new WriteException(
                    'anti_slop.missing_field',
                    'One of image_url, image_b64 is required.',
                    422,
                    ['missing_field' => 'image_url|image_b64']
                );
            }
            if (!isset($body['brand_profile']) || !is_array($body['brand_profile'])) {
                throw new WriteException(
                    'anti_slop.missing_field',
                    'Required field: brand_profile (object).',
                    422,
                    ['missing_field' => 'brand_profile']
                );
            }

            $tmpPath = $this->resolveImageToTemp($body);
            try {
                $validator = new ImageValidator();
                $result = $validator->validate($tmpPath, $body['brand_profile']);
                return $this->ok($result->toApi());
            } finally {
                if ($tmpPath !== '' && is_file($tmpPath)) {
                    @unlink($tmpPath);
                }
            }
        });
    }

    public function recordFeedback(WP_REST_Request $req)
    {
        return $this->handle($req, 'writes', function (WP_REST_Request $req) {
            $body = $this->jsonBody($req);
            $this->rejectUnknownFields($body, self::ALLOWED_FEEDBACK_FIELDS, 'feedback');

            $missing = [];
            foreach (['site_id', 'text', 'violation_match'] as $f) {
                if (!isset($body[$f])) $missing[] = $f;
            }
            if (!empty($missing)) {
                throw new WriteException(
                    'anti_slop.missing_field',
                    'Required field(s): ' . implode(', ', $missing) . '.',
                    422,
                    ['missing_fields' => $missing]
                );
            }
            if (!is_string($body['site_id']) || !is_string($body['text']) || !is_array($body['violation_match'])) {
                throw new WriteException(
                    'anti_slop.invalid_field',
                    'site_id and text must be strings; violation_match must be an object.',
                    422
                );
            }

            $threshold = isset($body['threshold']) ? (int) $body['threshold'] : SlopFeedback::PROMOTION_THRESHOLD;
            if ($threshold < 1 || $threshold > 100) {
                throw new WriteException(
                    'anti_slop.invalid_field',
                    'threshold must be 1..100.',
                    422
                );
            }

            $feedback = new SlopFeedback(Container::get('preferenceMemory'));
            $result = $feedback->record(
                (string) $body['site_id'],
                (string) $body['text'],
                (array) $body['violation_match'],
                $threshold
            );
            // #2 read-after-write: return the post-record state.
            $state = $feedback->getState(
                (string) $body['site_id'],
                (string) ($body['violation_match']['match'] ?? '')
            );
            return $this->ok([
                'result' => $result,
                'state' => $state,
            ], 201);
        });
    }

    public function lexicon(WP_REST_Request $req)
    {
        return $this->handle($req, 'reads', function () {
            return $this->ok([
                'counts' => BannedLexicon::counts(),
                'vocab' => array_map(fn($e) => ['token' => $e['token'], 'severity' => $e['severity'], 'category' => $e['category']], BannedLexicon::vocab()),
                'phrases' => array_map(fn($e) => ['phrase' => $e['phrase'], 'severity' => $e['severity'], 'category' => $e['category']], BannedLexicon::phrases()),
                'sentence_openers' => array_map(fn($e) => ['name' => $e['name'], 'severity' => $e['severity']], BannedLexicon::sentenceOpeners()),
                'structures' => array_map(fn($e) => ['name' => $e['name'], 'severity' => $e['severity'], 'kind' => $e['kind']], BannedLexicon::structures()),
            ]);
        });
    }

    /**
     * Resolve the image source (URL or base64) into a temp file on local disk
     * and return its path. Caller must unlink the returned path.
     *
     * @param array<string,mixed> $body
     */
    private function resolveImageToTemp(array $body): string
    {
        $tmp = wp_tempnam('joist-antislop-');
        if (!is_string($tmp) || $tmp === '') {
            throw new WriteException('anti_slop.tmp_unavailable', 'Could not allocate temp file.', 500);
        }
        if (!empty($body['image_b64'])) {
            $bytes = base64_decode((string) $body['image_b64'], true);
            if ($bytes === false || $bytes === '') {
                @unlink($tmp);
                throw new WriteException('anti_slop.invalid_image', 'image_b64 is not valid base64.', 422);
            }
            $written = @file_put_contents($tmp, $bytes);
            if ($written === false) {
                @unlink($tmp);
                throw new WriteException('anti_slop.tmp_write_failed', 'Could not write decoded image to temp file.', 500);
            }
            return $tmp;
        }
        // image_url path — fetch via wp_remote_get with a small timeout.
        $url = (string) $body['image_url'];
        if (!wp_http_validate_url($url)) {
            @unlink($tmp);
            throw new WriteException('anti_slop.invalid_image_url', 'image_url is not a valid URL.', 422);
        }
        $resp = wp_remote_get($url, ['timeout' => 5]);
        if (is_wp_error($resp)) {
            @unlink($tmp);
            throw new WriteException('anti_slop.image_fetch_failed', 'Failed to fetch image_url: ' . $resp->get_error_message(), 422);
        }
        $code = (int) wp_remote_retrieve_response_code($resp);
        if ($code !== 200) {
            @unlink($tmp);
            throw new WriteException('anti_slop.image_fetch_failed', "image_url returned HTTP {$code}.", 422);
        }
        $body = (string) wp_remote_retrieve_body($resp);
        if ($body === '') {
            @unlink($tmp);
            throw new WriteException('anti_slop.image_empty', 'image_url returned an empty body.', 422);
        }
        $written = @file_put_contents($tmp, $body);
        if ($written === false) {
            @unlink($tmp);
            throw new WriteException('anti_slop.tmp_write_failed', 'Could not write fetched image to temp file.', 500);
        }
        return $tmp;
    }

    /**
     * @return array<string,mixed>
     */
    private function jsonBody(WP_REST_Request $req): array
    {
        $body = $req->get_json_params();
        if (!is_array($body)) {
            throw new WriteException('anti_slop.invalid_body', 'JSON body required.', 400);
        }
        return $body;
    }

    /**
     * Reject unknown body fields with 422 + the list of valid fields.
     * Implements failure-mode constraint #1.
     *
     * @param array<string,mixed> $body
     * @param list<string> $allowed
     */
    private function rejectUnknownFields(array $body, array $allowed, string $surface): void
    {
        $unknown = [];
        foreach (array_keys($body) as $k) {
            if (!in_array($k, $allowed, true)) {
                $unknown[] = (string) $k;
            }
        }
        if (!empty($unknown)) {
            throw new WriteException(
                'anti_slop.unknown_field',
                "Unknown field(s) on /anti-slop/{$surface}: " . implode(', ', $unknown) . '. Valid: ' . implode(', ', $allowed) . '.',
                422,
                ['unknown_fields' => $unknown, 'valid_fields' => $allowed]
            );
        }
    }
}
