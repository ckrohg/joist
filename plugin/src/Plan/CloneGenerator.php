<?php
declare(strict_types=1);

namespace Joist\Plan;

use Joist\Container;
use Joist\Elementor\WriteException;

/**
 * @purpose Cheap-substitute clone path: turn 1-3 screenshot images into a V3
 *          Elementor Plan via Claude Opus 4.7 vision.
 *
 * Two paths, mirroring PlanGenerator:
 *   - Configured Anthropic API key → real Claude vision call with a system
 *     prompt that constrains output to the same V3 shape the rest of Joist's
 *     pipeline expects
 *   - No key → deterministic stub plan so callers can exercise the flow
 *     without a paid API call
 *
 * Output contract is identical to PlanGenerator: an array of step shapes
 * suitable for PlanStore::create(). The controller wraps these into a Plan
 * row and the existing approve/execute flow takes over.
 *
 * Why a separate class from PlanGenerator? — different input contract
 * (image blocks instead of intent string), slightly different system prompt
 * (clone-the-screenshot vs. brand-aware ideation), and we want the unit
 * boundary so prompt drift on one doesn't bleed into the other.
 */
final class CloneGenerator
{
    private const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
    private const MODEL = 'claude-opus-4-7';
    private const MAX_TOKENS = 4096;

    /**
     * Generate a V3-compatible Plan from up to 3 vision image blocks.
     *
     * @param list<array{type:string,source:array{type:string,media_type:string,data:string}}> $imageBlocks
     *        Pre-built Anthropic vision blocks. The controller builds these
     *        from the multipart upload; this class never touches the
     *        filesystem so it's easy to test.
     * @param string   $intent Optional user-supplied "extra notes" — pasted
     *                         into the user message as guidance.
     * @param int|null $pageId Optional page id being edited (informational
     *                         only — the executor handles real binding).
     *
     * @return array<int, array<string, mixed>> Steps for PlanStore::create().
     */
    public function generateFromImages(array $imageBlocks, string $intent = '', ?int $pageId = null): array
    {
        if (count($imageBlocks) === 0) {
            throw new WriteException(
                'clone.no_images',
                'At least one image is required.',
                422
            );
        }
        if (count($imageBlocks) > 3) {
            throw new WriteException(
                'clone.too_many_images',
                'A maximum of 3 images is supported.',
                422
            );
        }

        $apiKey = $this->apiKey();
        if ($apiKey === '') {
            return $this->fallbackSteps(count($imageBlocks));
        }

        return $this->callClaude($imageBlocks, $intent, $pageId, $apiKey);
    }

    /**
     * Generate a V3-compatible Plan from a raw HTML page body.
     *
     * Text-mode clone: we hand Claude a sanitised, capped HTML extract instead
     * of a vision block. Lower fidelity than screenshot mode (no visual cues —
     * spacing, colors, hero treatment etc. are guessed) but no headless
     * browser is required. Used by /plans/clone-from-url.
     *
     * @param string   $html   Raw HTML body returned by wp_remote_get.
     * @param string   $url    Source URL (informational; included in the prompt
     *                         so Claude knows what site it's cloning).
     * @param string   $intent Optional user notes / brand guidance.
     * @param int|null $pageId Optional page being edited (informational only).
     *
     * @return array<int, array<string, mixed>> Steps for PlanStore::create().
     */
    public function generateFromHtml(string $html, string $url, string $intent = '', ?int $pageId = null): array
    {
        $sanitised = $this->sanitiseHtmlForPrompt($html);
        if ($sanitised === '') {
            throw new WriteException(
                'clone.empty_html',
                'Could not extract any usable HTML from the URL response.',
                422
            );
        }

        $apiKey = $this->apiKey();
        if ($apiKey === '') {
            return $this->fallbackStepsForUrl($url);
        }

        $system = $this->buildSystemPromptForHtml();
        $userText = "SOURCE URL: {$url}\n\n";
        if ($intent !== '') {
            $userText .= "Optional notes from the user: {$intent}\n\n";
        }
        if ($pageId) {
            $userText .= "PAGE_ID (existing page being edited): {$pageId}\n\n";
        }
        $userText .= "HTML EXTRACT (sanitised — scripts/styles/svg/comments stripped, body content only, cap 32KB):\n\n";
        $userText .= "```html\n{$sanitised}\n```\n\n";
        $userText .= "Return ONLY the Plan JSON.";

        $body = [
            'model' => self::MODEL,
            'max_tokens' => self::MAX_TOKENS,
            'system' => [
                ['type' => 'text', 'text' => $system, 'cache_control' => ['type' => 'ephemeral']],
            ],
            'messages' => [
                ['role' => 'user', 'content' => [['type' => 'text', 'text' => $userText]]],
            ],
        ];

        return $this->postAndParse($body, $apiKey, 'clone_url');
    }

    /**
     * Strip a raw HTML page down to a Claude-friendly extract:
     *   - drop <script>, <style>, <noscript>, <svg>, HTML comments
     *   - prefer the <body> if present; collapse whitespace
     *   - cap at 32KB so the prompt stays predictable in size and cost
     */
    private function sanitiseHtmlForPrompt(string $html): string
    {
        $html = preg_replace('/<!--.*?-->/s', '', $html) ?? '';
        $html = preg_replace('#<script\b[^>]*>.*?</script>#is', '', $html) ?? '';
        $html = preg_replace('#<style\b[^>]*>.*?</style>#is', '', $html) ?? '';
        $html = preg_replace('#<noscript\b[^>]*>.*?</noscript>#is', '', $html) ?? '';
        $html = preg_replace('#<svg\b[^>]*>.*?</svg>#is', '', $html) ?? '';
        // Prefer the body content if present.
        if (preg_match('#<body\b[^>]*>(.*)</body>#is', $html, $m)) {
            $html = (string) $m[1];
        }
        $html = preg_replace('/\s+/', ' ', $html) ?? '';
        $html = trim($html);
        $max = 32 * 1024;
        if (strlen($html) > $max) {
            $html = substr($html, 0, $max) . "\n<!-- truncated -->";
        }
        return $html;
    }

    /**
     * Render the current site's active PreferenceMemory rules as a markdown
     * block for prompt injection, wrapped so the model treats them as
     * binding corrections from past clones (the self-improve loop).
     *
     * Returns '' when there are no rules or the container isn't wired (unit
     * tests / no-WP contexts) — callers append unconditionally and a leading
     * "\n\n" + empty string is harmless.
     *
     * This is the consumption side of the fidelity flywheel: the grader POSTs
     * defect-derived Rules (missing_assets, page_truncation, static_scrape_miss,
     * typography_default_bold, motion_not_reproduced …) into PreferenceMemory;
     * CloneGenerator surfaces them here so the NEXT clone obeys them.
     */
    private function preferenceBlock(): string
    {
        try {
            $mem = Container::get('preferenceMemory');
        } catch (\Throwable $e) {
            return '';
        }
        if (!is_object($mem) || !method_exists($mem, 'renderForPrompt')) {
            return '';
        }
        $rules = (string) $mem->renderForPrompt();
        if (trim($rules) === '') {
            return '';
        }
        return "\n\n----\nLEARNED CORRECTIONS FROM PAST CLONES ON THIS SITE — these are BINDING. "
            . "They were derived from measured defects in earlier clones; obey every one. "
            . "If a rule and a default in this prompt conflict, the rule wins.\n\n"
            . $rules;
    }

    /** Source for the API key — env first, wp_option second. */
    private function apiKey(): string
    {
        $env = getenv('JOIST_CLAUDE_API_KEY');
        if (is_string($env) && $env !== '') return trim($env);
        $opt = get_option('joist_claude_api_key', '');
        return is_string($opt) ? trim($opt) : '';
    }

    /**
     * No-key fallback: emit a single-container stub plan that visibly tells
     * the user the clone path is in template mode. Mirrors PlanGenerator's
     * fallback in shape so the UI renders the steps identically.
     */
    private function fallbackSteps(int $imageCount): array
    {
        return [
            [
                'op' => 'insert',
                'position' => 999, // append at end; array_splice clamps to size
                'element' => [
                    'elType' => 'container',
                    'settings' => [
                        'content_width' => 'boxed',
                        'padding' => [
                            'unit' => 'px',
                            'top' => '80', 'right' => '20', 'bottom' => '80', 'left' => '20',
                            'isLinked' => false,
                        ],
                    ],
                    'elements' => [
                        [
                            'elType' => 'widget',
                            'widgetType' => 'heading',
                            'settings' => [
                                'title' => 'Screenshot clone (template fallback)',
                                'header_size' => 'h1',
                                'align' => 'center',
                            ],
                        ],
                        [
                            'elType' => 'widget',
                            'widgetType' => 'text-editor',
                            'settings' => [
                                'editor' => '<p style="text-align:center;font-size:18px;line-height:1.55;max-width:640px;margin:0 auto;">'
                                    . 'Received ' . (int) $imageCount . ' image(s). No Anthropic API key is configured, '
                                    . 'so Joist cannot perform vision-based cloning. Configure '
                                    . '<code>JOIST_CLAUDE_API_KEY</code> (env) or the '
                                    . '<code>joist_claude_api_key</code> option to engage the real generator.'
                                    . '</p>',
                            ],
                        ],
                    ],
                ],
            ],
        ];
    }

    /**
     * Call Anthropic's Messages API with the image blocks plus a clone-aware
     * system prompt. Throws WriteException on transport / parse failures —
     * shape matches PlanGenerator so the REST envelope is uniform.
     */
    private function callClaude(array $imageBlocks, string $intent, ?int $pageId, string $apiKey): array
    {
        $system = $this->buildSystemPrompt();

        // User content: all image blocks first, then a single text block.
        $userContent = $imageBlocks;
        $intent = trim($intent);
        $notesLine = $intent !== '' ? 'Optional notes from the user: ' . $intent . "\n\n" : '';
        $pageLine = $pageId ? 'PAGE_ID (existing page being edited): ' . $pageId . "\n\n" : '';
        $userContent[] = [
            'type' => 'text',
            'text' => $notesLine . $pageLine . 'Return ONLY the Plan JSON.',
        ];

        $body = [
            'model' => self::MODEL,
            'max_tokens' => self::MAX_TOKENS,
            'system' => [
                ['type' => 'text', 'text' => $system, 'cache_control' => ['type' => 'ephemeral']],
            ],
            'messages' => [
                ['role' => 'user', 'content' => $userContent],
            ],
        ];

        return $this->postAndParse($body, $apiKey, 'clone');
    }

    /**
     * Shared transport + response-parsing for both image and HTML clone paths.
     * Throws WriteException with a code prefix scoped to the calling path so
     * the diagnostics log differentiates `clone.api_error` (screenshots) from
     * `clone_url.api_error` (URL fetch).
     *
     * @param array<string, mixed> $body  Anthropic request body.
     * @param string               $apiKey
     * @param string               $codePrefix `clone` or `clone_url`.
     * @return array<int, array<string, mixed>>
     */
    private function postAndParse(array $body, string $apiKey, string $codePrefix): array
    {
        $resp = wp_remote_post(self::ANTHROPIC_URL, [
            'timeout' => 90,
            'headers' => [
                'content-type' => 'application/json',
                'x-api-key' => $apiKey,
                'anthropic-version' => '2023-06-01',
            ],
            'body' => wp_json_encode($body),
        ]);

        if (is_wp_error($resp)) {
            throw new WriteException(
                "{$codePrefix}.transport_failed",
                'Anthropic API transport failed: ' . $resp->get_error_message(),
                502
            );
        }
        $code = (int) wp_remote_retrieve_response_code($resp);
        $raw = (string) wp_remote_retrieve_body($resp);
        if ($code !== 200) {
            throw new WriteException(
                "{$codePrefix}.api_error",
                "Anthropic API returned HTTP {$code}",
                502,
                ['anthropic_status' => $code, 'body_head' => mb_substr($raw, 0, 300)]
            );
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded) || empty($decoded['content'])) {
            throw new WriteException(
                "{$codePrefix}.unexpected_response",
                'Anthropic API returned an unexpected response shape.',
                502
            );
        }
        $text = '';
        foreach ($decoded['content'] as $block) {
            if (is_array($block) && ($block['type'] ?? '') === 'text') {
                $text .= (string) ($block['text'] ?? '');
            }
        }
        $text = trim($text);
        // Tolerate optional ```json fences.
        $text = preg_replace('/^```(?:json)?\s*/i', '', $text);
        $text = preg_replace('/\s*```$/', '', $text);
        $plan = json_decode((string) $text, true);
        if (!is_array($plan) || !isset($plan['steps']) || !is_array($plan['steps'])) {
            throw new WriteException(
                "{$codePrefix}.invalid_plan_json",
                'Clone response did not contain a valid steps array.',
                502,
                ['response_head' => mb_substr((string) $text, 0, 300)]
            );
        }
        $this->assertNoForbiddenImageHosts($plan['steps'], $codePrefix);
        return $plan['steps'];
    }

    /**
     * No-placeholder / no-hallucinated-URL guard.
     *
     * Walks every element subtree in the generated steps and rejects the plan
     * if any image widget points at a real photo-stock or source-CDN host. The
     * model is prompt-forbidden from inventing these, but a guard turns a silent
     * hallucination (hotlink-blocked image, fabricated CDN path) into a loud,
     * actionable error that the fidelity loop can act on instead of shipping a
     * broken clone. `placehold.co` and `data:` URIs are allowed (honest
     * placeholders / captured assets).
     *
     * @param array<int, mixed> $steps
     */
    private function assertNoForbiddenImageHosts(array $steps, string $codePrefix): void
    {
        $forbidden = [
            'unsplash.com', 'images.unsplash.com', 'pexels.com', 'images.pexels.com',
            'pixabay.com', 'cdn.pixabay.com', 'istockphoto.com', 'shutterstock.com',
            'gettyimages.com', 'freepik.com', 'lorempixel.com', 'picsum.photos',
            'placeimg.com', 'placekitten.com', 'loremflickr.com',
        ];
        $offenders = [];

        $visit = function ($node) use (&$visit, $forbidden, &$offenders): void {
            if (!is_array($node)) {
                return;
            }
            if (($node['elType'] ?? '') === 'widget' && ($node['widgetType'] ?? '') === 'image') {
                $url = (string) ($node['settings']['image']['url'] ?? '');
                if ($url !== '' && stripos($url, 'data:') !== 0) {
                    $host = strtolower((string) (parse_url($url, PHP_URL_HOST) ?: ''));
                    foreach ($forbidden as $bad) {
                        if ($host === $bad || str_ends_with($host, '.' . $bad) || str_contains($host, $bad)) {
                            $offenders[] = $url;
                            break;
                        }
                    }
                }
            }
            foreach (($node['elements'] ?? []) as $child) {
                $visit($child);
            }
        };

        foreach ($steps as $step) {
            if (is_array($step) && isset($step['element'])) {
                $visit($step['element']);
            }
        }

        if ($offenders !== []) {
            throw new WriteException(
                "{$codePrefix}.hallucinated_image_url",
                'Clone generator produced image URLs pointing at forbidden stock/CDN hosts. '
                . 'Real source assets must be captured + hosted, or an honest placehold.co box used — '
                . 'never a fabricated stock/CDN URL.',
                502,
                ['offending_urls' => array_slice(array_values(array_unique($offenders)), 0, 10)]
            );
        }
    }

    /**
     * URL-mode no-key fallback: emit a single-container stub plan that
     * acknowledges the URL was received and explains the configuration gap.
     */
    private function fallbackStepsForUrl(string $url): array
    {
        $safeUrl = esc_html($url);
        return [
            [
                'op' => 'insert',
                'position' => 999,
                'element' => [
                    'elType' => 'container',
                    'settings' => [
                        'content_width' => 'boxed',
                        'padding' => ['unit' => 'px', 'top' => '80', 'right' => '20', 'bottom' => '80', 'left' => '20', 'isLinked' => false],
                    ],
                    'elements' => [
                        [
                            'elType' => 'widget',
                            'widgetType' => 'heading',
                            'settings' => ['title' => 'URL clone (template fallback)', 'header_size' => 'h1', 'align' => 'center'],
                        ],
                        [
                            'elType' => 'widget',
                            'widgetType' => 'text-editor',
                            'settings' => [
                                'editor' => '<p style="text-align:center;font-size:18px;line-height:1.55;max-width:640px;margin:0 auto;">'
                                    . 'Received URL: <code>' . $safeUrl . '</code>. No Anthropic API key is configured, '
                                    . 'so Joist cannot run the URL→Plan generator. Configure '
                                    . '<code>JOIST_CLAUDE_API_KEY</code> (env) or the '
                                    . '<code>joist_claude_api_key</code> option to engage the real generator.'
                                    . '</p>',
                            ],
                        ],
                    ],
                ],
            ],
        ];
    }

    /**
     * System prompt for HTML-mode (URL clone) — same V3 contract and brand
     * voice as the screenshot path, but framed for text-only input.
     */
    private function buildSystemPromptForHtml(): string
    {
        return $this->buildHtmlPromptBody() . $this->preferenceBlock();
    }

    /** Static body of the HTML-mode system prompt (kept separate so the
     *  PreferenceMemory block appends cleanly without disturbing the heredoc). */
    private function buildHtmlPromptBody(): string
    {
        return <<<PROMPT
You are Joist's URL-clone generator. You turn a sanitised HTML extract of a webpage into a structured Elementor Plan — a JSON object the rest of Joist's pipeline executes through schema-validated, audited, hash-checked saves.

You cannot see the page visually. You have only the HTML body content (scripts, styles, svg, comments already stripped). Infer hierarchy and content density from semantic tags + visible text. Capture the real copy verbatim where it's a heading or short body paragraph; summarise long blocks.

OUTPUT CONTRACT
Return strict JSON with this exact top-level shape (no prose, no markdown fence):
{
  "steps": [
    { "op": "insert", "position": <int>, "element": { … } },
    …
  ]
}

OP SHAPE — URL-clone mode emits only `insert` ops appending top-level containers:
- `op` MUST be the string "insert"
- `parent_id` MUST be omitted (inserts at the page root)
- `position` is the insertion index among siblings. Use 999 to append at the end (PHP's array_splice clamps to the array size). Sequential steps with position:999 will stack in the order you emit them.
- `element` is the new element subtree. Do NOT include element IDs — the engine generates IDs.
- Do NOT include a `path` field. JSON-Patch paths are not supported.

ELEMENT SHAPE — V3-compatible only:
- Containers: `{ "elType": "container", "settings": {...}, "elements": [...] }`
- Widgets:   `{ "elType": "widget", "widgetType": "<slug>", "settings": {...} }`
- Allowed widget slugs (only these): heading, text-editor, button, image, icon, divider, spacer, video, html, social-icons, icon-list, star-rating, shortcode
- Forms (contact/signup/newsletter): do NOT rebuild input fields — Elementor's native Form widget is Pro and raw inputs are not authorable. Emit a shortcode widget bound to a real Fluent Forms form: widgetType "shortcode", single setting key also "shortcode", set to the literal string [fluentform id="1"] (keep id="1" when the real form ID is unknown — the section is wired to the live form afterward). Pair it with a heading + short intro. Do NOT fake inputs with text-editor HTML.
- Heading settings: title, header_size (h1..h6), align (left|center|right)
- Text-editor settings: editor (HTML string)
- Button settings: text, align, link ({url, is_external})
- Image settings: image ({url, alt}) — see IMAGE POLICY below
- Container settings: content_width (boxed|full), padding ({unit:"px",top,right,bottom,left,isLinked:false})

IMAGE POLICY — never reuse the source page's image URLs (they often hotlink-block):
- For every image widget, set `settings.image` to:
  `{ "url": "https://placehold.co/{w}x{h}/0E0E0C/F3F2EC?text=<short+label>", "alt": "<accurate alt describing the image's role>" }`
- Valid sizes: 1600x900 (hero/banner), 1200x600 (wide), 800x600 (standard), 600x400 (card), 400x400 (square thumbnail). Pick the size that matches the apparent role.
- NEVER use unsplash.com, pexels.com, pixabay.com, picsum.photos, istockphoto/shutterstock/getty, or any real photo URL — and NEVER use the source site's CDN URLs either. Plans containing such URLs are REJECTED by a server-side guard.

NO-HALLUCINATION GUARD (critical — past clones failed here):
- NEVER fabricate a labeled UI/product placeholder that asserts something the source doesn't literally show — e.g. do NOT invent a "Stripe Dashboard", "Analytics Panel", or "App Screenshot" box. If the source has a product screenshot you cannot reproduce, use a neutral placehold.co box whose `text=` label describes the GENERIC role ("product screenshot", "dashboard image"), never a fabricated brand/product name.
- The placehold.co `text=` value is a generic role label, NOT invented marketing/product chrome. When in doubt, OMIT the image widget rather than invent one.

CLONE GUIDELINES
- Walk the HTML top to bottom. One major section per top-level container.
- Match the visible section count and rough rhythm. Hero → social proof → about → services/features → stats → case studies → testimonials → CTA → (skip the site footer; that's theme-level).
- Transcribe headlines/body copy verbatim from `<h1>..<h6>` and short `<p>` tags. Summarise long paragraphs to ≤2 sentences in Joist's voice.
- Lorem-ipsum or obvious placeholder text on the source → replace with a plausible substitute in the same voice as nearby real copy.
- 3-/4-column grids → one outer container with `flex_direction:"row"`, `flex_wrap:"wrap"` and N child containers.
- Skip site headers (logo+nav) and footers (legal/nav). Page content only.

DESIGN VOICE — apply to substituted copy:
- Editorial-engineering. Direct sentences, concrete nouns, scannable hierarchy.
- Forbidden: "Empower your", "Revolutionize", "Unleash", "Build the future of", "next-gen", "synergy", "leverage", "game-changing".

OUTPUT ONLY THE JSON OBJECT. NO PROSE. NO MARKDOWN FENCE.
PROMPT;
    }

    /**
     * System prompt — same structural V3 rules as PlanGenerator, plus an
     * explicit clone framing so the model captures hierarchy/density rather
     * than chasing pixel-perfect styling we can't reliably reproduce in
     * Elementor at ~75% fidelity.
     */
    private function buildSystemPrompt(): string
    {
        return $this->buildImagePromptBody() . $this->preferenceBlock();
    }

    /** Static body of the screenshot-mode system prompt (kept separate so the
     *  PreferenceMemory block appends cleanly without disturbing the heredoc). */
    private function buildImagePromptBody(): string
    {
        return <<<PROMPT
You are Joist's screenshot-clone generator. You turn 1-3 screenshots of a web page into a structured Elementor Plan — a JSON object the rest of Joist's pipeline executes through schema-validated, audited, hash-checked saves.

You are cloning the visual structure of the screenshot(s) below. Capture hierarchy, content density, and typographic rhythm — NOT pixel-perfect styling. Produce a V3-compatible Elementor Plan that approximates the screenshot at ~75% fidelity. Image content (text, image URLs) should be transcribed from the screenshot where readable; placeholder where not.

OUTPUT CONTRACT
Return strict JSON with this exact top-level shape (no prose, no markdown fence):
{
  "steps": [
    { "op": "insert", "position": <int>, "element": { … } },
    …
  ]
}

OP SHAPE — clone mode produces only `insert` ops appending top-level containers:
- `op` MUST be the string "insert"
- `parent_id` MUST be omitted (inserts at the page root)
- `position` is the insertion index among siblings. Use 999 to append at the end (PHP's array_splice clamps to the array size). Sequential steps with position:999 will stack in the order you emit them.
- `element` is the new element subtree to insert. Do NOT include element IDs — the engine generates IDs.
- Do NOT include a `path` field. JSON-Patch paths are not supported.

ELEMENT SHAPE — use V3-compatible Elementor structures only:
- Root nodes are containers: `{ "elType": "container", "settings": {...}, "elements": [...] }`
- Inside containers, nest widgets: `{ "elType": "widget", "widgetType": "<slug>", "settings": {...} }`
- Allowed widget slugs (and only these): heading, text-editor, button, image, icon, divider, spacer, video, html, social-icons, icon-list, star-rating, shortcode
- Forms (contact/signup/newsletter): do NOT rebuild input fields — Elementor's native Form widget is Pro and raw inputs are not authorable. Emit a shortcode widget bound to a real Fluent Forms form: widgetType "shortcode", single setting key also "shortcode", set to the literal string [fluentform id="1"] (keep id="1" when the real form ID is unknown — the section is wired to the live form afterward). Pair it with a heading + short intro. Do NOT fake inputs with text-editor HTML.
- Heading settings: `title` (string), `header_size` (h1|h2|h3|h4|h5|h6), `align` (left|center|right)
- Text-editor settings: `editor` (HTML string)
- Button settings: `text` (string), `align`, `link` ({ url, is_external })
- Image settings: `image` ({ url, alt }) — see IMAGE POLICY below
- Container settings should include `content_width` (boxed|full) and reasonable `padding` ({ unit:"px", top, right, bottom, left, isLinked:false })

IMAGE POLICY — never invent real-looking URLs:
- You CANNOT see live image URLs from the screenshot, only pixels. Do NOT guess CDN paths or invent stock-photo URLs.
- For every image widget, set `settings.image` to:
  `{ "url": "https://placehold.co/{w}x{h}/0E0E0C/F3F2EC?text=<short+label>", "alt": "<accurate alt describing what was in the screenshot>" }`
- Valid sizes: 1600x900 (hero/banner), 1200x600 (wide), 800x600 (standard), 600x400 (card), 400x400 (square thumbnail). Pick the size that matches the screenshot's aspect ratio.
- NEVER use unsplash.com, pexels.com, pixabay.com, picsum.photos, istockphoto/shutterstock/getty, or any real photo URL. Plans containing such URLs are REJECTED by a server-side guard.

NO-HALLUCINATION GUARD (critical — past clones failed here):
- NEVER fabricate a labeled UI/product placeholder that asserts something the screenshot doesn't literally show — e.g. do NOT invent a "Stripe Dashboard", "Analytics Panel", or "App Screenshot" box where the screenshot just shows a generic image region. The placehold.co `text=` label must describe the GENERIC role ("product screenshot", "hero image"), never an invented brand/product name.
- When the screenshot region is illegible or you are guessing what it contains, OMIT the image widget rather than invent one.

DESIGN AESTHETIC — Joist's Foundry brand language (apply when the screenshot doesn't pin specific copy):
- Editorial-engineering: confident wordmark-grade typography, generous whitespace, warm dark surfaces (although we don't set background colors at the element level)
- Forbidden: indigo/purple gradients, "Build the future of X", "Empower your", "Revolutionize", "Unleash", AI-stock-photo aesthetics, marketing-speak superlatives
- Preferred: direct sentences, concrete nouns, scannable hierarchy.

CLONE GUIDELINES
- One screenshot → one page worth of containers. Multiple screenshots → treat as additional sections to stack vertically in document order.
- Match the section count and rough proportions of the screenshot. If the screenshot shows a hero + 3-col features + CTA + footer-like closer, produce that exact rhythm.
- Transcribe headlines/body copy where legible. Where text is illegible or stock-photo placeholder, write a plausible substitute in Joist's voice (specific, opinionated, no fluff).
- Follow IMAGE POLICY above for every image widget.
- Containers with multiple visible columns: emit one container with N child containers side-by-side, or N stacked widgets if the layout collapses cleanly.

OUTPUT ONLY THE JSON OBJECT. NO PROSE. NO MARKDOWN FENCE.
PROMPT;
    }
}
