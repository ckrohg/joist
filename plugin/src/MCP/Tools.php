<?php
declare(strict_types=1);

namespace Joist\MCP;

use Joist\Container;
use Joist\Plan\CloneGenerator;
use Joist\Plan\PageFactory;

/**
 * @purpose Tool registry + implementations for Joist's MCP server.
 *
 * Each tool has:
 *   - a name (joist_foo) and human description. Names use underscores
 *     (not dots) so they pass Claude Code's MCP tool-name validator
 *     (^[a-zA-Z0-9_]{1,64}$ — stricter than the MCP spec). Dotted names
 *     get silently dropped by the client.
 *   - a JSON Schema for inputs (what the model passes)
 *   - a PHP method that does the work and returns `content` blocks
 *
 * Tools wrap existing Joist services (PlanStore, PageFactory, CloneGenerator,
 * etc.) rather than re-implementing logic, so the MCP surface stays in sync
 * with the REST surface and the React UI.
 *
 * Auth is per-call via current_user_can(). The MCP controller has already
 * verified the caller is a logged-in WP user (via Basic Auth + App Password);
 * here we enforce per-tool capability requirements.
 */
final class Tools
{
    /**
     * Return the full tool list with JSON Schemas for `tools/list`.
     *
     * @return list<array<string, mixed>>
     */
    public function schemas(): array
    {
        return [
            [
                'name' => 'joist_get_site_info',
                'description' => 'Return WordPress + Elementor + Joist version info, active theme, and counts of pages/plans. Use this first when you need to understand the site you are operating on.',
                'inputSchema' => $this->objectSchema([], []),
            ],
            [
                'name' => 'joist_list_pages',
                'description' => 'List recent WordPress pages (id, title, status, modified date). Use this to find a page_id to target with create_plan or get_page_tree.',
                'inputSchema' => $this->objectSchema([
                    'limit' => ['type' => 'integer', 'description' => 'Max pages to return (default 20, max 100).'],
                    'status' => ['type' => 'string', 'description' => 'Post status: any|publish|draft|private. Default: any.'],
                ], []),
            ],
            [
                'name' => 'joist_get_page_tree',
                'description' => 'Return the Elementor V3 tree of a page (containers + widgets with their settings). Essential for prompt-to-edit: load the tree, identify element_ids to target with update_settings / replace_element / delete ops.',
                'inputSchema' => $this->objectSchema([
                    'page_id' => ['type' => 'integer', 'description' => 'The WordPress page ID.'],
                ], ['page_id']),
            ],
            [
                'name' => 'joist_list_plans',
                'description' => 'List recent Joist plans (id, status, page_id, intent, step_count, created_at).',
                'inputSchema' => $this->objectSchema([], []),
            ],
            [
                'name' => 'joist_create_plan',
                'description' => 'Create a Joist plan from a pre-built array of steps. If page_id is omitted, Joist auto-creates a blank Elementor draft page. Steps must follow PatchEngine ops: insert {op:"insert", element:{...}, position:int, parent_id?:string}, update_settings {op:"update_settings", element_id:string, settings:{...}}, replace_element {op:"replace_element", element_id:string, element:{...}}, delete {op:"delete", element_id:string}. Element shape: container or widget with elType, settings, optional elements[]. Allowed widget slugs: heading, text-editor, button, image, icon, divider, spacer, video, html, social-icons, icon-list, star-rating. Image URLs must use https://placehold.co/{w}x{h}/0E0E0C/F3F2EC?text=label or be left empty — never invent real CDN URLs.',
                'inputSchema' => $this->objectSchema([
                    'intent' => ['type' => 'string', 'description' => 'Short description of what this plan does (shown in the UI).'],
                    'page_id' => ['type' => 'integer', 'description' => 'Existing page to target. Omit to auto-create a new draft.'],
                    'title' => ['type' => 'string', 'description' => 'Title for the auto-created page. Ignored if page_id is supplied.'],
                    'steps' => [
                        'type' => 'array',
                        'description' => 'Array of step ops. Must have at least one.',
                        'items' => ['type' => 'object'],
                    ],
                ], ['intent', 'steps']),
            ],
            [
                'name' => 'joist_clone_url',
                'description' => 'Fetch a live URL, sanitise its HTML, send to the in-WP CloneGenerator, and get back a V3 Elementor Plan. Auto-creates a draft page if page_id omitted. Lower fidelity than vision (text-mode only) but no headless browser needed. SSRF-guarded against loopback/RFC1918/.local hosts.',
                'inputSchema' => $this->objectSchema([
                    'url' => ['type' => 'string', 'description' => 'Fully-qualified http(s) URL to clone.'],
                    'intent' => ['type' => 'string', 'description' => 'Optional notes / brand guidance for the generator.'],
                    'page_id' => ['type' => 'integer', 'description' => 'Existing page to target. Omit to auto-create.'],
                    'title' => ['type' => 'string', 'description' => 'Title for the auto-created page. Default: "Clone — <host>".'],
                ], ['url']),
            ],
            [
                'name' => 'joist_approve_plan',
                'description' => 'Approve a plan so it can be executed. Requires the approval_token returned when the plan was created. Admin-only (manage_options).',
                'inputSchema' => $this->objectSchema([
                    'plan_id' => ['type' => 'string', 'description' => 'The plan ID (pln_…).'],
                    'approval_token' => ['type' => 'string', 'description' => 'The approval_token from plan creation.'],
                ], ['plan_id', 'approval_token']),
            ],
            [
                'name' => 'joist_execute_plan',
                'description' => 'Run an approved plan against its bound page. Returns step-by-step results.',
                'inputSchema' => $this->objectSchema([
                    'plan_id' => ['type' => 'string', 'description' => 'The plan ID (pln_…).'],
                ], ['plan_id']),
            ],
            [
                'name' => 'joist_introspect_atomic_schema',
                'description' => 'Probe the live Elementor V4 atomic-element registry and return registered atomic element types with their props_schema + controls. Use this before authoring V4 atomic plans (e-flexbox, e-heading, etc.) to know the real settings shape each element accepts. Only meaningful on V4 sites; returns an error envelope when routing is legacy_v3 or unsupported.',
                'inputSchema' => $this->objectSchema([], []),
            ],
            [
                'name' => 'joist_smoke_test_roundtrip',
                'description' => 'Run canonical create→approve→execute round-trip tests against the live site and report pass/fail per shape. Tests V3 container shape always; tests V4 e-flexbox hybrid shape when site is V4. Use after any Joist deploy to verify the hash defense + V4_AUTO_FIELDS strip-list still covers the live Elementor version. Each test creates a real draft page; the pages remain after the test so they can be visually verified in Elementor.',
                'inputSchema' => $this->objectSchema([], []),
            ],
        ];
    }

    /**
     * Dispatch a tool call.
     *
     * @param array<string, mixed> $args
     * @return array{content: list<array<string, mixed>>, isError?: bool}
     */
    public function call(string $name, array $args): array
    {
        switch ($name) {
            case 'joist_get_site_info':     return $this->toolSiteInfo();
            case 'joist_list_pages':        return $this->toolListPages($args);
            case 'joist_get_page_tree':     return $this->toolGetPageTree($args);
            case 'joist_list_plans':        return $this->toolListPlans();
            case 'joist_create_plan':       return $this->toolCreatePlan($args);
            case 'joist_clone_url':         return $this->toolCloneUrl($args);
            case 'joist_approve_plan':      return $this->toolApprovePlan($args);
            case 'joist_execute_plan':      return $this->toolExecutePlan($args);
            case 'joist_introspect_atomic_schema': return $this->toolIntrospectAtomicSchema();
            case 'joist_smoke_test_roundtrip': return $this->toolSmokeTestRoundtrip();
            default:
                throw new ToolException("Unknown tool: {$name}");
        }
    }

    // ── Tool implementations ────────────────────────────────────────────

    private function toolSiteInfo(): array
    {
        $this->requireCap('read');
        $info = [
            'joist_version' => defined('JOIST_VERSION') ? JOIST_VERSION : 'unknown',
            'wp_version' => get_bloginfo('version'),
            'elementor_version' => defined('ELEMENTOR_VERSION') ? ELEMENTOR_VERSION : null,
            'theme' => function_exists('wp_get_theme') ? (string) wp_get_theme()->get('Name') : null,
            'site_url' => get_site_url(),
            'page_count' => (int) wp_count_posts('page')->publish + (int) wp_count_posts('page')->draft,
            'plan_count_recent' => count(Container::get('planStore')->listRecent()),
        ];
        return $this->resultText('Site info:', $info);
    }

    private function toolListPages(array $args): array
    {
        $this->requireCap('read');
        $limit = max(1, min(100, (int) ($args['limit'] ?? 20)));
        $status = (string) ($args['status'] ?? 'any');
        $posts = get_posts([
            'post_type' => 'page',
            'post_status' => $status === 'any' ? ['publish', 'draft', 'private'] : $status,
            'posts_per_page' => $limit,
            'orderby' => 'modified',
            'order' => 'DESC',
        ]);
        $pages = [];
        foreach ($posts as $p) {
            $pages[] = [
                'id' => (int) $p->ID,
                'title' => (string) $p->post_title,
                'status' => (string) $p->post_status,
                'modified' => (string) $p->post_modified_gmt,
                'edit_url' => admin_url("post.php?post={$p->ID}&action=elementor"),
            ];
        }
        return $this->resultText(sprintf('%d page(s):', count($pages)), $pages);
    }

    private function toolGetPageTree(array $args): array
    {
        $this->requireCap('read');
        $pageId = (int) ($args['page_id'] ?? 0);
        if ($pageId <= 0) throw new ToolException('page_id is required');
        $raw = get_post_meta($pageId, '_elementor_data', true);
        if (!is_string($raw) || $raw === '') {
            return $this->resultText("Page {$pageId} has no Elementor data (empty or non-Elementor page).", ['page_id' => $pageId, 'tree' => []]);
        }
        $tree = json_decode($raw, true);
        if (!is_array($tree)) {
            throw new ToolException("Page {$pageId} has malformed _elementor_data.");
        }
        return $this->resultText(sprintf('Tree for page %d (%d root elements):', $pageId, count($tree)), ['page_id' => $pageId, 'tree' => $tree]);
    }

    private function toolListPlans(): array
    {
        $this->requireCap('read');
        $plans = Container::get('planStore')->listRecent();
        // Strip approval_tokens from list view (callers must use plan_id->get for the token).
        $safe = array_map(static function ($p) {
            unset($p['approval_token']);
            return $p;
        }, $plans);
        return $this->resultText(sprintf('%d recent plan(s):', count($safe)), $safe);
    }

    private function toolCreatePlan(array $args): array
    {
        $this->requireCap('manage_options');
        $intent = trim((string) ($args['intent'] ?? ''));
        $steps = is_array($args['steps'] ?? null) ? $args['steps'] : [];
        $suppliedPageId = (int) ($args['page_id'] ?? 0);
        $title = trim((string) ($args['title'] ?? ''));

        if ($intent === '') throw new ToolException('intent is required');
        if (count($steps) === 0) throw new ToolException('steps must contain at least one op');

        $createdNewPage = false;
        if ($suppliedPageId > 0) {
            $pageId = $suppliedPageId;
        } else {
            try {
                $pageId = PageFactory::createBlankElementorPage($intent, $title);
                $createdNewPage = true;
            } catch (\Throwable $e) {
                throw new ToolException('Failed to create blank page: ' . $e->getMessage());
            }
        }

        $sessionId = 'mcp:' . (string) get_current_user_id();
        $plan = Container::get('planStore')->create($sessionId, $pageId, $intent, $steps);
        Container::get('webhooks')->emit('plan.created', [
            'plan_id' => $plan['plan_id'],
            'page_id' => $pageId,
            'intent' => $intent,
            'step_count' => count($steps),
            'source' => 'mcp',
            'created_new_page' => $createdNewPage,
        ]);
        return $this->resultText(
            sprintf('Plan %s created with %d step(s). %s', $plan['plan_id'], count($steps), $createdNewPage ? "Auto-created page {$pageId}." : "Targets page {$pageId}."),
            [
                'plan_id' => $plan['plan_id'],
                'approval_token' => $plan['approval_token'] ?? null,
                'approval_url' => $plan['approval_url'] ?? null,
                'page_id' => $pageId,
                'step_count' => count($steps),
                'created_new_page' => $createdNewPage,
            ]
        );
    }

    private function toolCloneUrl(array $args): array
    {
        $this->requireCap('manage_options');
        $url = trim((string) ($args['url'] ?? ''));
        if ($url === '') throw new ToolException('url is required');
        if (!preg_match('#^https?://#i', $url)) throw new ToolException('url must be a fully-qualified http(s) URL');

        $resp = wp_remote_get($url, [
            'timeout' => 20,
            'redirection' => 5,
            'user-agent' => 'JoistCloneBot/' . (defined('JOIST_VERSION') ? JOIST_VERSION : 'dev'),
        ]);
        if (is_wp_error($resp)) throw new ToolException('URL fetch failed: ' . $resp->get_error_message());
        $code = (int) wp_remote_retrieve_response_code($resp);
        if ($code < 200 || $code >= 300) throw new ToolException("URL returned HTTP {$code}");
        $html = (string) wp_remote_retrieve_body($resp);
        if (strlen($html) < 200) throw new ToolException('URL body was empty or too small to clone');
        if (strlen($html) > 10 * 1024 * 1024) throw new ToolException('URL body exceeds 10 MB cap');

        $intent = trim((string) ($args['intent'] ?? ''));
        $suppliedPageId = (int) ($args['page_id'] ?? 0);
        $title = trim((string) ($args['title'] ?? ''));
        $host = (string) (parse_url($url, PHP_URL_HOST) ?: 'website');

        $createdNewPage = false;
        if ($suppliedPageId > 0) {
            $pageId = $suppliedPageId;
        } else {
            $derivedTitle = $title !== '' ? $title : ('Clone — ' . $host);
            $pageId = PageFactory::createBlankElementorPage($intent !== '' ? $intent : ('Clone of ' . $url), $derivedTitle);
            $createdNewPage = true;
        }

        $generator = new CloneGenerator();
        $steps = $generator->generateFromHtml($html, $url, $intent, $pageId);

        $sessionId = 'mcp:' . (string) get_current_user_id();
        $plan = Container::get('planStore')->create($sessionId, $pageId, $intent !== '' ? $intent : ('Clone of ' . $url), $steps);
        Container::get('webhooks')->emit('plan.created', [
            'plan_id' => $plan['plan_id'],
            'page_id' => $pageId,
            'intent' => $intent,
            'step_count' => count($steps),
            'source' => 'mcp.clone_url',
            'source_url' => $url,
            'created_new_page' => $createdNewPage,
        ]);
        return $this->resultText(
            sprintf('Cloned %s into plan %s (%d step(s)). %s', $url, $plan['plan_id'], count($steps), $createdNewPage ? "Auto-created page {$pageId}." : "Targets page {$pageId}."),
            [
                'plan_id' => $plan['plan_id'],
                'approval_token' => $plan['approval_token'] ?? null,
                'approval_url' => $plan['approval_url'] ?? null,
                'page_id' => $pageId,
                'step_count' => count($steps),
                'source_url' => $url,
                'created_new_page' => $createdNewPage,
            ]
        );
    }

    private function toolApprovePlan(array $args): array
    {
        $this->requireCap('manage_options');
        $planId = (string) ($args['plan_id'] ?? '');
        $token = (string) ($args['approval_token'] ?? '');
        if ($planId === '' || $token === '') throw new ToolException('plan_id and approval_token are required');

        $user = wp_get_current_user();
        try {
            $plan = Container::get('planStore')->approve($planId, $token, (int) $user->ID, 'mcp:' . (string) $user->ID);
        } catch (\Throwable $e) {
            throw new ToolException('Approve failed: ' . $e->getMessage());
        }
        return $this->resultText("Plan {$planId} approved.", [
            'plan_id' => $planId,
            'status' => 'approved',
            'page_id' => $plan['page_id'] ?? null,
        ]);
    }

    private function toolExecutePlan(array $args): array
    {
        $this->requireCap('manage_options');
        $planId = (string) ($args['plan_id'] ?? '');
        if ($planId === '') throw new ToolException('plan_id is required');
        try {
            $result = Container::get('planExecutor')->execute($planId);
        } catch (\Throwable $e) {
            throw new ToolException('Execute failed: ' . $e->getMessage());
        }
        return $this->resultText("Plan {$planId} executed.", $result);
    }

    /**
     * Wave 3 (2026-05-31) — expose AtomicSchemaProbe via MCP so external
     * agents (Claude Code, Cursor, etc.) can query the live V4 atomic
     * registry before authoring plans. Returns the same shape AtomicSchemaProbe
     * returns: {ok: true, elements: [...]} on success or
     * {ok: false, code: '...', message: '...', details: {...}} on failure.
     */
    private function toolIntrospectAtomicSchema(): array
    {
        $this->requireCap('read');
        $routing = \Joist\Elementor\VersionRouter::detect();
        $probe = Container::get('atomicSchemaProbe');
        $result = $probe->probe($routing);
        $summary = ($result['ok'] ?? false) === true
            ? sprintf('Probed %d atomic element type(s) on Elementor %s.', $result['count'] ?? 0, $routing->version)
            : sprintf('Atomic schema probe failed: %s', $result['message'] ?? 'unknown error');
        return $this->resultText($summary, $result + ['routing_decision' => $routing->toArray()]);
    }

    /**
     * Wave 4 (2026-05-31) — canonical round-trip smoke test. Exercises the
     * shapes Joist commits to supporting on production, against the live
     * Elementor install, and reports per-shape pass/fail. Catches regressions
     * in Hasher::V4_AUTO_FIELDS, AtomicDocumentWriter's silent-save check,
     * and PlanExecutor's failure plumbing in one call.
     *
     * Pages created by the smoke test remain so they can be visually
     * verified in Elementor admin — they aren't auto-cleaned.
     *
     * Shapes tested:
     *   1. v3_container   — elType:container + V3 heading + V3 text-editor
     *                        (the production path on all sites)
     *   2. v4_hybrid      — elType:e-flexbox + V3 heading
     *                        (only run when site routes to atomic_v4)
     */
    private function toolSmokeTestRoundtrip(): array
    {
        $this->requireCap('manage_options');
        $routing = \Joist\Elementor\VersionRouter::detect();
        $results = [];

        $shapes = [
            'v3_container' => [
                'title' => 'Joist smoke — v3 container',
                'always' => true,
                'steps' => [[
                    'op' => 'insert',
                    'position' => 999,
                    'element' => [
                        'elType' => 'container',
                        'settings' => [
                            'content_width' => 'boxed',
                            'padding' => ['unit' => 'px', 'top' => '40', 'right' => '20', 'bottom' => '40', 'left' => '20', 'isLinked' => false],
                        ],
                        'elements' => [
                            ['elType' => 'widget', 'widgetType' => 'heading', 'settings' => ['title' => 'v3 container smoke ✓', 'header_size' => 'h2', 'align' => 'center']],
                            ['elType' => 'widget', 'widgetType' => 'text-editor', 'settings' => ['editor' => '<p>If you can see this paragraph in Elementor, V3 container round-trip is healthy on this site.</p>']],
                        ],
                    ],
                ]],
            ],
            'v4_hybrid' => [
                'title' => 'Joist smoke — v4 e-flexbox hybrid',
                'always' => false, // only run on atomic_v4
                'steps' => [[
                    'op' => 'insert',
                    'position' => 999,
                    'element' => [
                        'elType' => 'e-flexbox',
                        'settings' => new \stdClass(),
                        'elements' => [
                            ['elType' => 'widget', 'widgetType' => 'heading', 'settings' => ['title' => 'v4 e-flexbox hybrid smoke ✓', 'header_size' => 'h2', 'align' => 'center']],
                        ],
                    ],
                ]],
            ],
        ];

        $sessionId = 'mcp:smoke:' . (string) get_current_user_id();
        $planStore = Container::get('planStore');
        $planExecutor = Container::get('planExecutor');

        foreach ($shapes as $key => $shape) {
            if (!$shape['always'] && !$routing->isAtomicV4()) {
                $results[$key] = ['status' => 'skipped', 'reason' => 'site is not atomic_v4'];
                continue;
            }
            try {
                $pageId = PageFactory::createBlankElementorPage('Joist smoke roundtrip ' . $key, $shape['title']);
                $plan = $planStore->create($sessionId, $pageId, 'smoke ' . $key, $shape['steps']);
                $planStore->approve($plan['plan_id'], $plan['approval_token'], (int) get_current_user_id(), $sessionId);
                $execResult = $planExecutor->execute($plan['plan_id']);
                $results[$key] = [
                    'status' => 'pass',
                    'plan_id' => $plan['plan_id'],
                    'page_id' => $pageId,
                    'final_hash' => $execResult['final_hash'] ?? null,
                    'edit_url' => admin_url("post.php?post={$pageId}&action=elementor"),
                ];
            } catch (\Throwable $e) {
                $detail = ['error' => $e->getMessage(), 'class' => get_class($e)];
                if ($e instanceof \Joist\Elementor\WriteException) {
                    $detail['error_code'] = $e->errorCode;
                    $detail['error_details'] = $e->errorDetails;
                }
                $results[$key] = ['status' => 'fail'] + $detail;
            }
        }

        $passCount = count(array_filter($results, static fn ($r) => ($r['status'] ?? '') === 'pass'));
        $failCount = count(array_filter($results, static fn ($r) => ($r['status'] ?? '') === 'fail'));
        $skipCount = count(array_filter($results, static fn ($r) => ($r['status'] ?? '') === 'skipped'));
        $summary = sprintf('Roundtrip smoke on Elementor %s: %d pass, %d fail, %d skipped.', $routing->version, $passCount, $failCount, $skipCount);

        return $this->resultText($summary, [
            'routing_decision' => $routing->toArray(),
            'results' => $results,
        ]);
    }

    // ── helpers ────────────────────────────────────────────────────────

    /** Throws ToolException if the current WP user lacks $capability. */
    private function requireCap(string $capability): void
    {
        if (!current_user_can($capability)) {
            throw new ToolException("Capability '{$capability}' required.");
        }
    }

    /**
     * Build an MCP `content` array combining a one-line summary + a JSON-encoded
     * structured payload. Models can read either the prose or parse the JSON.
     *
     * @param array<string, mixed>|list<mixed>|null $payload
     * @return array{content: list<array<string, mixed>>}
     */
    private function resultText(string $summary, mixed $payload = null): array
    {
        $content = [['type' => 'text', 'text' => $summary]];
        if ($payload !== null) {
            $json = wp_json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            $content[] = ['type' => 'text', 'text' => "```json\n{$json}\n```"];
        }
        return ['content' => $content];
    }

    /**
     * Tiny helper to build a JSON Schema for an object with named properties.
     *
     * @param array<string, array<string, mixed>> $properties
     * @param list<string> $required
     * @return array<string, mixed>
     */
    private function objectSchema(array $properties, array $required): array
    {
        // JSON Schema requires `properties` to be an object, never an array.
        // PHP serializes an empty array as `[]`, which strict MCP validators
        // (Claude Code) reject — failing the whole tools/list parse. Cast
        // empty to stdClass so it serializes as `{}`. Non-empty associative
        // arrays already serialize as objects.
        $schema = [
            'type' => 'object',
            'properties' => $properties === [] ? new \stdClass() : $properties,
        ];
        if ($required !== []) $schema['required'] = $required;
        $schema['additionalProperties'] = false;
        return $schema;
    }
}
