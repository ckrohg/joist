# tenet-elementor-agent — v1 Architecture

Companion to `PLUGIN_API.md`. The API spec defines *what* the surface is; this doc defines *how* we build it.

**Status:** v0 draft, 2026-05-10. Scoped to v1.0 (production OSS release on wp.org + GitHub). v2+ (hosted SaaS, multi-site dashboard, autonomous post-launch agents) is roadmapped but explicitly out of scope here.

---

## 1. Goals & non-goals

### v1 goals
- A WordPress plugin (PHP) that exposes the full §1–§18 API surface from `PLUGIN_API.md`, enforces all 16 failure-mode constraints, and is GPL-licensed for wp.org distribution.
- A Claude Code MCP server (TypeScript) that calls the plugin and gives Claude a clean tool surface for building/editing Elementor sites.
- A Claude Code skill bundle (`/elementor-build`, `/elementor-edit`, `/elementor-audit`) that wires the above into chat workflows.
- A CLI (`tenet-elementor`) that handles one-shot onboarding: install plugin, generate App Password, configure Claude Code.
- Plan Mode end-to-end: agent proposes, human approves in WP admin, executor runs with rollback.
- Anti-slop AI generation for copy + images (§19.5, §19.6) with quality gates (§19.15) enforced.

### v1 non-goals (explicitly cut)
- Hosted SaaS dashboard / multi-site management
- Autonomous post-launch agents (content refresh, SEO monitor, etc.)
- Native A/B testing & personalization
- Figma / URL / screenshot import
- Multilingual via WPML/Polylang adapter
- WooCommerce product/cart/checkout agent
- AEO citation tracking (`llms.txt` generation IS in v1; bot-citation monitoring is v2)
- Agency white-label features
- Code/HTML static export (Kit `.zip` export IS in v1; static HTML is v2)

### Non-goals always (product-level)
- Replacing Elementor's editor UI. We are a backbone, not a competing builder.
- Hiding what the agent does. Every edit is visible and revertible.
- Locking data into our system.

---

## 2. Three deliverables, three repos directories

```
tenet-elementor/
├── plugin/                  # WordPress plugin (PHP). Ships to wp.org.
├── mcp-server/              # Claude Code MCP server (TypeScript/Node).
├── cli/                     # Setup CLI (Node, single binary via pkg/bun).
├── skills/                  # Claude Code skills (markdown + YAML).
├── docs/                    # User-facing docs (mkdocs / vitepress).
├── specs/                   # API + architecture specs (this dir).
├── knowledge/               # tenet-managed strategy docs.
└── (tenet workspace state)
```

Single monorepo. CI builds three artifacts: `tenet-elementor-agent.zip` (the WP plugin), `@tenet/elementor-mcp` (npm), `@tenet/elementor-cli` (npm with single-file binary).

---

## 3. Plugin file layout

```
plugin/
├── tenet-elementor-agent.php       # main plugin file (WP header, bootstrap)
├── readme.txt                       # wp.org plugin readme (markdown-ish)
├── uninstall.php                    # cleanup on uninstall
├── composer.json                    # PHP deps + PSR-4 autoload
├── composer.lock
├── languages/                       # i18n
│
├── src/
│   ├── Bootstrap.php                # plugin init: hooks, autoload, version check
│   ├── Container.php                # lightweight DI container
│   │
│   ├── Core/
│   │   ├── Hasher.php               # canonicalize + sha256 of element trees
│   │   ├── IDGenerator.php          # 8-hex unique element IDs
│   │   ├── Config.php               # plugin options access
│   │   └── Logger.php               # PSR-3-style, writes to wp_options + file
│   │
│   ├── Elementor/
│   │   ├── DocumentWriter.php       # ★ the spine — wraps Document::save()
│   │   ├── WidgetCatalog.php        # introspects widgets_manager
│   │   ├── SchemaValidator.php      # ★ validates settings against schema
│   │   ├── PatchEngine.php          # applies surgical ops to element tree
│   │   ├── CSSRegenerator.php       # wraps CSS regen
│   │   ├── KitImporter.php          # wraps `wp elementor kit import`
│   │   ├── KitExporter.php          # generates Kit .zip
│   │   ├── TemplateManager.php      # theme builder templates
│   │   └── ElementorAdapter.php     # version-aware shim (3.x vs 4.x Atomic)
│   │
│   ├── Concurrency/
│   │   ├── LockManager.php          # transient-backed page locks
│   │   ├── HashChecker.php          # OCC enforcement
│   │   └── SessionTracker.php       # agent session lifecycle
│   │
│   ├── Revisions/
│   │   ├── RevisionStore.php        # custom table CRUD (gzipped snapshots)
│   │   ├── RevisionPruner.php       # keep last N per page
│   │   └── RevisionRestorer.php     # atomic restore through DocumentWriter
│   │
│   ├── Audit/
│   │   ├── AuditLogger.php          # per-write attribution
│   │   └── ActorResolver.php        # human vs agent attribution
│   │
│   ├── Plan/
│   │   ├── PlanStore.php            # plan persistence
│   │   ├── PlanExecutor.php         # post-approval execution with rollback
│   │   └── PlanWebhook.php          # notify agent of approval/rejection
│   │
│   ├── REST/
│   │   ├── ControllerBase.php       # auth, error envelope, idempotency
│   │   ├── SiteController.php
│   │   ├── PagesController.php
│   │   ├── ElementsController.php
│   │   ├── WidgetsController.php
│   │   ├── KitController.php
│   │   ├── TemplatesController.php
│   │   ├── MediaController.php
│   │   ├── MenusController.php
│   │   ├── PluginsController.php
│   │   ├── SEOController.php
│   │   ├── SessionsController.php
│   │   ├── PlansController.php
│   │   ├── HealthController.php
│   │   └── WebhooksController.php
│   │
│   ├── MCP/
│   │   ├── AbilityRegistrar.php     # registers WP Abilities for each REST op
│   │   └── ToolMapper.php           # REST path → MCP tool naming
│   │
│   ├── Cache/
│   │   ├── CacheFlusher.php         # orchestrates all flushes
│   │   ├── SGOptimizerAdapter.php
│   │   ├── WPRocketAdapter.php
│   │   ├── LiteSpeedAdapter.php
│   │   └── W3TCAdapter.php
│   │
│   ├── Host/
│   │   ├── HostDetector.php         # SG / Kinsta / WPE / Cloudways / etc.
│   │   ├── SiteGroundAdapter.php
│   │   ├── KinstaAdapter.php
│   │   └── WPEngineAdapter.php
│   │
│   ├── SEO/
│   │   ├── SEOAdapter.php           # interface
│   │   ├── YoastAdapter.php
│   │   ├── RankMathAdapter.php
│   │   ├── AIOSEOAdapter.php
│   │   └── NativeAdapter.php        # our own meta keys if none installed
│   │
│   ├── Webhooks/
│   │   ├── WebhookStore.php
│   │   ├── WebhookEmitter.php
│   │   └── HMACSigner.php
│   │
│   ├── Health/
│   │   ├── HealthCheck.php          # individual check definitions
│   │   └── PreflightValidator.php   # hard pre-flight gate
│   │
│   └── Admin/
│       ├── AdminMenu.php
│       ├── PlanReviewPage.php       # human approval UI for Plan Mode
│       ├── AuditLogPage.php
│       ├── SettingsPage.php
│       └── HealthDashboard.php
│
├── migrations/                       # DB schema
│   ├── 001_create_revisions.php
│   ├── 002_create_audit.php
│   ├── 003_create_plans.php
│   ├── 004_create_webhooks.php
│   ├── 005_create_sessions.php
│   └── 006_create_bot_crawls.php
│
├── assets/                           # admin UI assets
│   ├── admin/                        # built React app for Plan Review page
│   ├── css/
│   └── js/
│
└── tests/
    ├── phpunit.xml
    ├── bootstrap.php
    ├── unit/
    └── integration/                  # requires Elementor installed
```

PSR-4 namespace root: `TenetElementor\`. Composer autoload. Min PHP 8.1 (Elementor 3.21 requires 7.4 but our codebase uses match expressions, readonly props, never types).

---

## 4. The critical pipeline — every write goes through here

`DocumentWriter::save()` is the spine. It enforces 6 of the 16 failure-mode constraints in one method:

```php
namespace TenetElementor\Elementor;

final class DocumentWriter
{
    public function __construct(
        private LockManager $locks,
        private HashChecker $hashes,
        private SchemaValidator $validator,
        private RevisionStore $revisions,
        private IDGenerator $idGen,
        private CSSRegenerator $cssRegen,
        private CacheFlusher $cacheFlusher,
        private AuditLogger $audit,
        private ElementorAdapter $elementor,
    ) {}

    /**
     * The only sanctioned write path. Every controller funnels here.
     *
     * @throws HashMismatchException        on OCC fail (409)
     * @throws InvalidSettingsException     on schema fail (422)
     * @throws ElementorVersionException    if Elementor not in tested range (503)
     * @throws LockException                if page locked by another session (423)
     */
    public function save(SaveRequest $req): SaveResult
    {
        $lock = $this->locks->acquire($req->postId, $req->sessionId);
        $revisionId = null;
        try {
            // Constraint #8: pin to tested Elementor version range
            $this->elementor->assertSupportedVersion();

            // Constraint #1: validate against live schema
            $validation = $this->validator->validateTree($req->elements);
            if (!$validation->valid) {
                throw new InvalidSettingsException($validation->errors);
            }

            // OCC: hash check
            if ($req->expectedHash !== null) {
                $current = $this->hashes->forPage($req->postId);
                if ($current !== $req->expectedHash) {
                    throw new HashMismatchException(
                        currentHash: $current,
                        lastModifier: $this->audit->lastModifierFor($req->postId)
                    );
                }
            }

            // Constraint #3: snapshot for rollback
            $revisionId = $this->revisions->snapshot(
                $req->postId,
                actor: $req->actor,
                sessionId: $req->sessionId,
                intent: $req->intent,
            );

            // Constraint #10: explicit ID generation (don't let Elementor invent silently)
            $elements = $this->idGen->fillMissing($req->elements);

            // Dry run shortcut
            if ($req->dryRun) {
                return SaveResult::dryRun($elements, $this->hashes->forElements($elements));
            }

            // The actual save — goes through Elementor's own path
            $document = $this->elementor->getDocument($req->postId);
            $document->save([
                'elements' => $elements,
                'settings' => $req->pageSettings,
            ]);

            // Constraint #5: regen CSS + flush host caches
            $this->cssRegen->regenerate($req->postId);
            $this->cacheFlusher->flushPage($req->postId);

            // Constraint #2: read-after-write verify
            $verified = $document->get_elements_data();
            $newHash = $this->hashes->forElements($verified);
            $this->cacheFlusher->verifyFrontendUpdated($req->postId, $newHash);

            // Constraint #15: audit every edit
            $this->audit->log(
                op: 'document.save',
                postId: $req->postId,
                actor: $req->actor,
                sessionId: $req->sessionId,
                beforeHash: $req->expectedHash,
                afterHash: $newHash,
                intent: $req->intent,
            );

            return new SaveResult(
                newHash: $newHash,
                verifiedElements: $verified,
                generatedIds: $this->idGen->lastGeneratedMap(),
                revisionId: $revisionId,
                cssRegenerated: true,
            );

        } catch (\Throwable $e) {
            // Constraint #16: refuse silent failure; always rollback on error
            if ($revisionId !== null) {
                $this->revisions->rollback($revisionId);
            }
            throw $e;
        } finally {
            $this->locks->release($lock);
        }
    }
}
```

The `PatchEngine` (for surgical ops) produces a new element tree and hands it to `DocumentWriter::save()`. There is no other write path. `update_post_meta('_elementor_data', …)` is grep-banned in the codebase.

---

## 5. Core class contracts

### `SchemaValidator` — constraint #1 lives here

```php
final class SchemaValidator
{
    public function __construct(private WidgetCatalog $catalog) {}

    public function validateWidget(string $widgetType, array $settings): ValidationResult
    {
        $schema = $this->catalog->getSchema($widgetType);
        if ($schema === null) {
            return ValidationResult::fail([
                new ValidationError('schema.unknown_widget', "Widget type '{$widgetType}' is not registered on this site", '')
            ]);
        }

        $errors = [];
        foreach ($settings as $key => $value) {
            $control = $schema->controlByName($key);
            if ($control === null) {
                // The msrbuilds #32 class: agent wrote a key Elementor doesn't accept.
                $errors[] = new ValidationError(
                    'schema.unknown_key',
                    "Widget '{$widgetType}' has no control named '{$key}'. Did you mean: " . $this->suggest($key, $schema),
                    "settings.{$key}"
                );
                continue;
            }
            if (!$control->accepts($value)) {
                $errors[] = new ValidationError(
                    'schema.invalid_value',
                    "Value for '{$key}' does not match control type '{$control->type}': " . $control->explainRejection($value),
                    "settings.{$key}"
                );
            }
        }
        return $errors ? ValidationResult::fail($errors) : ValidationResult::ok();
    }

    public function validateTree(array $elements): ValidationResult { /* recursive */ }

    private function suggest(string $key, WidgetSchema $schema): string
    {
        // Levenshtein-1 + flex_* prefix awareness — catch justify_content → flex_justify_content
    }
}
```

### `WidgetCatalog` — schema introspection

```php
final class WidgetCatalog
{
    public function refresh(): void
    {
        // Runs on plugin activation + admin trigger.
        $types = \Elementor\Plugin::$instance->widgets_manager->get_widget_types();
        foreach ($types as $type => $widget) {
            $controls = $widget->get_controls();
            $this->store($type, WidgetSchema::fromElementor($controls, $widget));
        }
    }

    public function getSchema(string $widgetType): ?WidgetSchema { ... }

    public function listAll(): array { /* returns [{type, label, category, is_pro, plugin_source}] */ }
}
```

Cached as a wp_option keyed by Elementor version + Pro version. Invalidated on plugin activate/update/deactivate.

### `Hasher` — canonicalization

```php
final class Hasher
{
    public function forElements(array $elements): string
    {
        return 'sha256:' . hash('sha256', $this->canonicalize($elements));
    }

    private function canonicalize(array $elements): string
    {
        // 1. Recursively sort object keys
        // 2. Normalize numeric strings ("10" → 10) where Elementor stores them inconsistently
        // 3. Strip transient _id-on-render fields the editor adds
        // 4. Strip empty objects/arrays consistently
        // 5. Emit deterministic JSON via json_encode + JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR off
    }

    public function forPage(int $postId): string
    {
        $document = \Elementor\Plugin::$instance->documents->get($postId);
        return $this->forElements($document->get_elements_data());
    }
}
```

### `PatchEngine` — surgical ops

```php
final class PatchEngine
{
    public function apply(array $elements, array $ops, IDGenerator $idGen): PatchResult
    {
        $generated = [];
        foreach ($ops as $op) {
            $elements = match($op['op']) {
                'update_settings' => $this->updateSettings($elements, $op),
                'replace_element' => $this->replaceElement($elements, $op),
                'insert'          => $this->insertElement($elements, $op, $idGen, $generated),
                'delete'          => $this->deleteElement($elements, $op),
                'move'            => $this->moveElement($elements, $op),
                'duplicate'       => $this->duplicateElement($elements, $op, $idGen, $generated),
                'wrap'            => $this->wrap($elements, $op, $idGen, $generated),
                'unwrap'          => $this->unwrap($elements, $op),
                default           => throw new InvalidOpException($op['op']),
            };
        }
        return new PatchResult($elements, $generated);
    }
}
```

Pure function over the element tree — no side effects. Called inside `DocumentWriter::save()` before the actual write.

### `LockManager` — per-page locks

```php
final class LockManager
{
    public function acquire(int $postId, ?string $sessionId, int $ttl = 60): Lock
    {
        $key = "tenet_lock_page_{$postId}";
        $existing = get_transient($key);
        if ($existing !== false && $existing['session_id'] !== $sessionId) {
            throw new LockHeldException($existing);
        }
        $lock = ['session_id' => $sessionId, 'acquired_at' => time(), 'expires_at' => time() + $ttl];
        set_transient($key, $lock, $ttl);
        return new Lock($postId, $sessionId, $lock['expires_at']);
    }

    public function release(Lock $lock): void { ... }
}
```

Same session reusing the lock is a no-op (re-extends TTL). Different session sees 423.

---

## 6. DB schema — custom tables

All tables prefixed `wp_tenet_el_` to avoid collision. Created in migrations on plugin activation; cleaned up in `uninstall.php` only if the user opts in.

### `wp_tenet_el_revisions`
```sql
CREATE TABLE wp_tenet_el_revisions (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    post_id      BIGINT UNSIGNED NOT NULL,
    hash         CHAR(72) NOT NULL,           -- 'sha256:' + 64 hex
    snapshot     LONGBLOB NOT NULL,            -- gzipped JSON of _elementor_data
    snapshot_size INT UNSIGNED NOT NULL,
    actor_type   ENUM('agent','human','system') NOT NULL,
    actor_id     VARCHAR(64),                  -- user ID for human, session ID for agent
    session_id   VARCHAR(64),
    intent       VARCHAR(500),
    created_at   DATETIME NOT NULL,
    INDEX idx_post_created (post_id, created_at DESC),
    INDEX idx_session (session_id)
);
```

Pruning: keep last N (default 50) per page; older entries pruned daily via WP cron.

### `wp_tenet_el_audit`
```sql
CREATE TABLE wp_tenet_el_audit (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    timestamp    DATETIME NOT NULL,
    op           VARCHAR(64) NOT NULL,         -- 'document.save', 'kit.import', etc.
    post_id      BIGINT UNSIGNED,
    actor_type   ENUM('agent','human','system') NOT NULL,
    actor_id     VARCHAR(64),
    session_id   VARCHAR(64),
    before_hash  CHAR(72),
    after_hash   CHAR(72),
    duration_ms  INT UNSIGNED,
    intent       VARCHAR(500),
    payload      LONGBLOB,                     -- gzipped op-specific payload, nullable
    INDEX idx_post_time (post_id, timestamp DESC),
    INDEX idx_session (session_id),
    INDEX idx_op_time (op, timestamp DESC)
);
```

### `wp_tenet_el_plans`
```sql
CREATE TABLE wp_tenet_el_plans (
    id           VARCHAR(64) PRIMARY KEY,      -- 'pln_01HXY...'
    session_id   VARCHAR(64) NOT NULL,
    page_id      BIGINT UNSIGNED,
    intent       VARCHAR(500) NOT NULL,
    steps        LONGBLOB NOT NULL,            -- gzipped JSON
    status       ENUM('pending','approved','rejected','executing','completed','failed','expired') NOT NULL,
    approval_user_id BIGINT UNSIGNED,
    approval_at  DATETIME,
    executed_at  DATETIME,
    result       LONGBLOB,                     -- execution result gzipped
    created_at   DATETIME NOT NULL,
    expires_at   DATETIME NOT NULL,
    INDEX idx_status_created (status, created_at DESC)
);
```

### `wp_tenet_el_sessions`
```sql
CREATE TABLE wp_tenet_el_sessions (
    id            VARCHAR(64) PRIMARY KEY,     -- 'ses_01HXY...'
    agent_name    VARCHAR(64) NOT NULL,
    agent_version VARCHAR(32),
    intent        VARCHAR(500),
    user_label    VARCHAR(200),
    started_at    DATETIME NOT NULL,
    last_activity DATETIME NOT NULL,
    ended_at      DATETIME,
    op_count      INT UNSIGNED DEFAULT 0,
    cost_tokens   INT UNSIGNED DEFAULT 0,
    INDEX idx_started (started_at DESC)
);
```

### `wp_tenet_el_webhooks`
```sql
CREATE TABLE wp_tenet_el_webhooks (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    url          VARCHAR(500) NOT NULL,
    secret       VARCHAR(64) NOT NULL,
    events       JSON NOT NULL,
    active       TINYINT(1) NOT NULL DEFAULT 1,
    created_at   DATETIME NOT NULL,
    last_success DATETIME,
    last_failure DATETIME,
    failure_count INT UNSIGNED DEFAULT 0
);
```

### `wp_tenet_el_bot_crawls` (v1.5 — `llms.txt` traffic logging)
```sql
CREATE TABLE wp_tenet_el_bot_crawls (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    timestamp    DATETIME NOT NULL,
    bot          VARCHAR(64) NOT NULL,         -- 'GPTBot', 'ClaudeBot', 'PerplexityBot', etc.
    user_agent   VARCHAR(500),
    path         VARCHAR(500) NOT NULL,
    status_code  SMALLINT UNSIGNED,
    referer      VARCHAR(500),
    INDEX idx_bot_time (bot, timestamp DESC)
);
```

---

## 7. WP Abilities + MCP wiring

WordPress 6.9 ships the Abilities API; `WordPress/mcp-adapter` bridges abilities to MCP. Our flow:

1. On plugin activate, `AbilityRegistrar` registers one ability per public operation:

```php
wp_register_ability('tenet-elementor/get_page', [
    'label' => __('Get an Elementor page', 'tenet-elementor-agent'),
    'description' => 'Fetch the full Elementor element tree for a page, with content hash for OCC.',
    'input_schema' => [
        'type' => 'object',
        'properties' => [
            'id' => ['type' => 'integer'],
        ],
        'required' => ['id'],
    ],
    'output_schema' => [/* matches PLUGIN_API.md §6 GET /pages/{id} */],
    'callback' => [PagesController::class, 'getViaAbility'],
    'permission_callback' => fn() => current_user_can('edit_pages'),
]);
```

2. `mcp-adapter` (configured via plugin settings) discovers all `tenet-elementor/*` abilities and exposes them on an MCP endpoint at `/wp-json/mcp/v1/`.

3. Our Claude Code MCP server (next section) connects to that endpoint.

**Tool naming convention:**
- REST `GET /pages` → ability `tenet-elementor/list_pages` → MCP tool `elementor_list_pages`
- REST `POST /pages/{id}/patch` → ability `tenet-elementor/patch_page` → MCP tool `elementor_patch_page`
- All MCP tool names prefixed `elementor_` for namespace separation.

**Tool-count budget (constraint #11):** stay under 80 tools to leave headroom. Strategy: prefer parameterized tools over specialized. One `elementor_patch_page` with an `ops[]` array beats `elementor_update_widget`, `elementor_insert_element`, `elementor_delete_element`, etc. as separate tools.

---

## 8. Claude Code MCP server (TypeScript)

```
mcp-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # stdio MCP server entry
│   ├── server.ts                   # Server class, tool registration
│   │
│   ├── client/
│   │   ├── WordPressClient.ts      # auth, retries, error envelope parsing
│   │   ├── types.ts                # generated from PLUGIN_API.md (codegen step)
│   │   └── errors.ts
│   │
│   ├── tools/                      # MCP tool definitions (thin wrappers around client)
│   │   ├── site.ts
│   │   ├── pages.ts
│   │   ├── elements.ts
│   │   ├── widgets.ts
│   │   ├── kit.ts
│   │   ├── templates.ts
│   │   ├── media.ts
│   │   ├── sessions.ts
│   │   ├── plans.ts
│   │   ├── seo.ts
│   │   └── health.ts
│   │
│   ├── plan/
│   │   ├── PlanBuilder.ts          # composes multi-op plans
│   │   └── PlanExecutor.ts         # post-approval execution
│   │
│   ├── generation/
│   │   ├── CopyGenerator.ts        # routes to Anthropic/OpenAI/Google
│   │   ├── ImageGenerator.ts       # DALL-E / Imagen / Flux router
│   │   └── SchemaBuilder.ts        # build valid settings from introspected schema
│   │
│   ├── quality/
│   │   ├── SlopDetector.ts         # ★ refuses indigo-500, "Build the future", etc.
│   │   ├── BrandConsistency.ts
│   │   └── PerformanceBudget.ts
│   │
│   └── lib/
│       ├── retries.ts
│       ├── logger.ts
│       └── config.ts
│
└── tests/
```

The MCP server is a *thin* layer over the plugin's REST API. Its only complexity is:
- Auth handling (load WP URL + App Password from Claude Code config or env)
- Type generation from `PLUGIN_API.md` (manual at v0, codegen in v0.5)
- Quality gates that run *before* writes (SlopDetector pre-validates AI-generated content)
- Plan composition (helping the agent produce well-structured plans)

Why have the server at all instead of letting Claude call the REST API directly? Three reasons:
1. **Tool surface ergonomics** — MCP tools are nicer than raw HTTP for Claude
2. **Quality gates close to the model** — SlopDetector / SchemaBuilder run in Node before any network round-trip, saving tokens
3. **Future: aggregation** — `elementor_build_landing_page` (multi-step composite tool) can live here without polluting the WP plugin

**Distribution:** `npm install -g @tenet/elementor-mcp` OR `npx @tenet/elementor-mcp` OR drop-in to `.mcp.json` via the CLI.

---

## 9. Claude Code skills

Ships as a skill bundle in `skills/`:

```
skills/
├── elementor-build/
│   ├── SKILL.md                    # "Build a new Elementor site/page from a brief"
│   └── examples/
├── elementor-edit/
│   ├── SKILL.md                    # "Edit an existing Elementor page surgically"
│   └── examples/
└── elementor-audit/
    ├── SKILL.md                    # "Audit a site — SEO, a11y, perf, broken links"
    └── examples/
```

Each `SKILL.md` orchestrates a workflow over the MCP tools. The skills are *the user-facing entry points* (`/elementor-build`, etc.). The MCP tools are the building blocks.

---

## 10. Setup CLI

```
cli/
├── package.json
└── src/
    ├── index.ts                    # entry — picks subcommand
    ├── commands/
    │   ├── init.ts                 # `tenet-elementor init` — top-level wizard
    │   ├── connect.ts              # `tenet-elementor connect <site-url>` — wire up auth
    │   ├── install-plugin.ts       # downloads + activates plugin via REST or WP-CLI
    │   ├── doctor.ts               # diagnoses connection + permission issues
    │   ├── status.ts               # current connection info
    │   └── disconnect.ts
    ├── lib/
    │   ├── ClaudeCodeConfig.ts     # reads/writes ~/.claude/.mcp.json
    │   ├── WordPressDetector.ts    # probes for plugin presence
    │   ├── AppPassword.ts          # generation helper
    │   └── prompts.ts
```

**User flow — "I have a SiteGround site, I want Claude Code to edit it"** (v1 happy path):

```bash
$ npx @tenet/elementor-cli connect https://example.com

? Site URL detected: https://example.com  ✓
? WordPress detected: 6.5.2  ✓
? Elementor detected: 3.21.0 + Pro 3.21.0  ✓
? SiteGround host detected — will configure SG Optimizer + SG Security compatibility  ✓
?
? Plugin not installed. Install tenet-elementor-agent? (Y/n) Y
? Need admin credentials to install the plugin.
  Username: ckrohg
  Application Password: ····················
?
✓ Plugin installed and activated
✓ Created dedicated `tenet-agent` user (role: Editor)
✓ Generated App Password for tenet-agent
✓ Configured Claude Code MCP at ~/.claude/.mcp.json
✓ Verified connection — health check passed (12/12 checks)
✓ Webhook endpoint configured

You're ready. Try in Claude Code:
  /elementor-build hero section for my homepage with a new headline
  /elementor-audit my-page
```

If WP-CLI is unavailable (SiteGround StartUp/GrowBig plans), the CLI falls back to: download plugin zip, upload via REST `/wp/v2/plugins`, activate via REST.

---

## 11. Plan Mode end-to-end flow

The most important user-visible workflow. Sequence:

```
1. User: "/elementor-build a 3-tile bento features section on /home"

2. Claude Code (skill):
   - calls elementor_list_widgets → knows what's available
   - calls elementor_get_widget_schema('container'), ('heading'), ('image'), ('icon-box')
   - calls elementor_get_page(123) → has current state + hash_A
   - SchemaBuilder constructs valid element tree
   - SlopDetector rejects the AI's first draft headline ("Build the future of features")
   - regenerates with concrete copy from the brand kit
   - composes a plan: 3 ops (insert container, insert 3 child widgets)
   - calls elementor_create_plan(...)

3. Plugin:
   - persists plan, returns plan_id + approval_url
   - emits webhook to user's Slack/email: "Plan ready for review"

4. User opens approval_url in browser (WP admin):
   - sees plan structure, preview of changes, estimated cost
   - clicks Approve

5. Plugin:
   - PlanExecutor begins execution
   - acquires page lock on post 123
   - runs each op through DocumentWriter::save() (with rollback on any failure)
   - emits webhook: "Plan completed"

6. Claude Code (skill) receives webhook:
   - confirms to user: "Done. New section added. View at https://example.com/home"
   - calls elementor_audit_page(123) → reports a11y/SEO/perf scores
```

A failed step rolls back the entire plan via revision snapshot taken at plan-start.

---

## 12. Auth model

- **Plugin operations:** every REST request requires HTTP Basic auth with WP Application Password. The CLI configures Claude Code with a password tied to the dedicated `tenet-agent` user (Editor role default, configurable to Administrator if needed for plugin install).
- **Webhook callbacks (plugin → agent):** HMAC-SHA256 signed. Agent verifies signature before acting.
- **Plan approval:** WP admin session — only logged-in users with `edit_pages` capability can approve.
- **No bearer tokens, no OAuth in v1.** App Passwords are sufficient and don't require an OAuth provider.

---

## 13. Failure-mode constraint mapping (where each rule lives)

| # | Constraint | Enforced in |
|---|---|---|
| 1 | Validate writes against live schema | `SchemaValidator::validateTree` → throws before `DocumentWriter::save` proceeds |
| 2 | Read-after-write | `DocumentWriter::save` always returns `verifiedElements` from `$document->get_elements_data()` post-save |
| 3 | Snapshot before multi-step | `PlanExecutor` snapshots at plan-start; `DocumentWriter::save` snapshots per-call |
| 4 | Surgical diff-based edits only | REST: `POST /pages/{id}/patch` is the primary write; `PUT /pages/{id}` (full replace) requires explicit `expected_hash` |
| 5 | Auto-flush cache + verify | `CSSRegenerator` + `CacheFlusher` called inside `DocumentWriter::save`; `verifyFrontendUpdated()` confirms guest-cache invalidation |
| 6 | Token-budgeted reads | `PagesController::get` returns `tree_summary` by default; `?include=full` for full tree; per-element reads support `?depth=N` |
| 7 | Hard pre-flight | `PreflightValidator` runs on every controller's `permission_callback`; refuses on incompatible PHP/WP/Elementor |
| 8 | Pin Elementor version range | `ElementorAdapter::assertSupportedVersion` runs in every write |
| 9 | Cost meter | MCP server tracks tokens per session; refuses to retry > N times on same error class |
| 10 | Append vs replace explicit | All write ops require explicit `op` field; "append" never default |
| 11 | Tool-count discipline | ~50 MCP tools total; parameterized over specialized |
| 12 | Scope guards | `PatchEngine` only mutates element IDs listed in `ops[].element_id`; refuses ops with no target |
| 13 | Performance budgets | `PerformanceBudget` quality gate runs pre-write; rejects oversized images, banned widgets |
| 14 | First-class export | `GET /kit/export`, `GET /pages/{id}/export?format=...` always available |
| 15 | Audit-tagged edits | `AuditLogger` writes to `wp_tenet_el_audit` + adds line to WP's native revision comment |
| 16 | No silent failures | Every controller's error envelope; `DocumentWriter::save` throws on rollback rather than returning partial |

---

## 14. Testing strategy

- **Unit tests (PHP):** `Hasher`, `IDGenerator`, `SchemaValidator`, `PatchEngine` — pure logic, no WP needed. Target 95% coverage.
- **Integration tests (PHP):** spun up against real WP + Elementor in `wp-env` (`@wordpress/env`). Exercise every REST endpoint. Run on PR.
- **End-to-end tests (Node):** MCP server → real WP via `wp-env` → assert Elementor pages render correctly. The msrbuilds #32 test goes here: write `flex_justify_content`, assert frontend reflects it; write `justify_content`, assert 422.
- **Schema drift tests:** scheduled CI job daily — install latest Elementor, run schema introspection, diff against committed snapshot. Catches Elementor releases that change widget controls before users hit it in prod.

---

## 15. Distribution

- **GitHub:** monorepo. Releases tagged. Tagged release triggers:
  - Build plugin zip → upload to GitHub Releases → mirror to wp.org SVN
  - Publish `@tenet/elementor-mcp` to npm
  - Publish `@tenet/elementor-cli` to npm with bundled binaries for darwin/linux/win
- **wp.org:** plugin reviewed + listed. Standard wp.org process: trunk + tags in SVN, readme.txt formatting, no obfuscation.
- **Documentation site:** `docs.tenet-elementor.dev` (or similar), built from `docs/` via mkdocs/vitepress, deployed to Cloudflare Pages.

---

## 16. What we explicitly DON'T build in v1

Repeated from §1, deliberately. The discipline of cutting matters more than the ambition of adding.

- ❌ Hosted SaaS dashboard
- ❌ Multi-site management
- ❌ Autonomous background agents (post-launch content/SEO/perf monitors)
- ❌ Native A/B testing
- ❌ Figma / URL / screenshot import
- ❌ Multilingual adapter
- ❌ WooCommerce
- ❌ Static HTML export
- ❌ Custom WordPress theme builder (Hello + Pro is enough)
- ❌ Real-time collaboration (use WP's existing post-lock UX)
- ❌ Mobile app

These are roadmapped (see `knowledge/ROADMAP.md`) but explicit non-goals for v1.0.
