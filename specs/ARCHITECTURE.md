# joist — v1 Architecture

Companion to `PLUGIN_API.md`. The API spec defines *what* the surface is; this doc defines *how* we build it.

**Status:** v0 draft, 2026-05-10. Scoped to v1.0 (production OSS release on wp.org + GitHub). v2+ (hosted SaaS, multi-site dashboard, autonomous post-launch agents) is roadmapped but explicitly out of scope here.

---

## 1. Goals & non-goals

### v1 goals
- A WordPress plugin (PHP) that exposes the full §1–§18 API surface from `PLUGIN_API.md`, enforces all 16 failure-mode constraints, and is GPL-licensed for wp.org distribution.
- A Claude Code MCP server (TypeScript) that calls the plugin and gives Claude a clean tool surface for building/editing Elementor sites.
- A Claude Code skill bundle (`/elementor-build`, `/elementor-edit`, `/elementor-audit`) that wires the above into chat workflows.
- A CLI (`joist`) that handles one-shot onboarding: install plugin, generate App Password, configure Claude Code.
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
joist/
├── plugin/                  # WordPress plugin (PHP). Ships to wp.org.
├── mcp-server/              # Claude Code MCP server (TypeScript/Node).
├── cli/                     # Setup CLI (Node, single binary via pkg/bun).
├── skills/                  # Claude Code skills (markdown + YAML).
├── docs/                    # User-facing docs (mkdocs / vitepress).
├── specs/                   # API + architecture specs (this dir).
├── knowledge/               # tenet-managed strategy docs.
└── (tenet workspace state)
```

Single monorepo. CI builds three artifacts: `joist.zip` (the WP plugin), `@joist/elementor-mcp` (npm), `@joist/cli` (npm with single-file binary).

---

## 3. Plugin file layout

```
plugin/
├── joist.php       # main plugin file (WP header, bootstrap)
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

PSR-4 namespace root: `Joist\`. Composer autoload. **Min PHP 8.0** (decision 2026-05-10 after hardening pass — `match`, named args, enums-as-classes, throw expressions, but NOT readonly props or `never` returns which are 8.1). Elementor 3.21 supports PHP 7.4 but the ~10% of installs still on 7.4 are declining fast and not worth the engineering regression to support.

**Admin UI:** built with `@wordpress/element` (WP's bundled React) and `@wordpress/components` for accessibility-by-default and Gutenberg compatibility. Bundler: `@wordpress/scripts` (matches Gutenberg's webpack config + React version). NOT custom React or shadcn — those cause version conflicts and fail wp.org accessibility expectations. CSS scoped to `.joist-admin` namespace, loaded only on plugin screens via `admin_enqueue_scripts` screen checks.

---

## 4. The critical pipeline — every write goes through here

`DocumentWriter::save()` is the spine. It enforces 9 of the 30 failure-mode constraints in one method. Critically: **the synchronous portion does the minimum** (lock, validate, snapshot, write, return). CSS regen, cache flush, frontend verify, webhook emission all defer to `shutdown` hook or `wp_schedule_single_event` — no inline `wp_remote_*` calls. Response returns optimistically; webhook fires on async-verification completion or failure.

```php
namespace Joist\Elementor;

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
        private PolicyGuard $policy,
        private SessionTracker $sessions,
        private OperatingMode $opMode,
        private ContainerModeAdapter $layoutMode,
        private GlobalRefPreferrer $globals,
        private DynamicTagValidator $dynamicTags,
        private CustomCSSBlockManager $cssBlocks,
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
        // Constraint #20: HTTPS enforced at controller, but assert here as defense-in-depth
        // Constraint #18: PolicyGuard refusals BEFORE any work
        $this->policy->assertAllowed($req);

        // Constraint #6.12: operating mode check
        $modeResult = $this->opMode->intercept($req);
        if ($modeResult !== null) {
            return $modeResult; // observer mode → dry_run; quiet/kill_switch → 423
        }

        // Constraint #19: chained-singleton plan-required trigger
        $this->sessions->recordOp($req->sessionId, $req->op, $req->postId);
        $this->policy->checkPlanRequired($req->sessionId, $req->op, $req->postId);

        $lock = $this->locks->acquire($req->postId, $req->sessionId);
        $revisionId = null;
        try {
            // Constraint #8: pin to tested Elementor version range
            $this->elementor->assertSupportedVersion();

            // Constraint #23: container-mode matching
            $this->layoutMode->validateInserts($req->postId, $req->elements);

            // Constraint #25: dynamic tag references resolve
            $this->dynamicTags->validateTree($req->elements);

            // Constraint #1, #24, #27, #29: schema validation
            // (covers responsive-completeness warnings, inner-flag check, skin-aware validation)
            $validation = $this->validator->validateTree($req->elements);
            if (!$validation->valid) {
                throw new InvalidSettingsException($validation->errors);
            }

            // Constraint #26: prefer global refs over literals (auto-transform)
            [$elements, $transformations] = $this->globals->preferGlobals($req->elements);

            // Constraint #10: explicit ID generation; deep-regen on duplicate/wrap
            $elements = $this->idGen->fillMissing($elements);

            // Custom CSS blocks merged (not replaced) — preserves human-written blocks
            $elements = $this->cssBlocks->mergeBlocks($elements, $req->postId);

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

            // Dry run shortcut
            if ($req->dryRun) {
                return SaveResult::dryRun($elements, $this->hashes->forElements($elements), $transformations);
            }

            // The actual save — synchronous, fast portion only
            // Goes through Elementor's own path
            $document = $this->elementor->getDocument($req->postId);
            $document->save([
                'elements' => $elements,
                'settings' => $req->pageSettings,
            ]);

            // Constraint #2: read-after-write verify (synchronous — confirms the write landed)
            $verified = $document->get_elements_data();
            $newHash = $this->hashes->forElements($verified);

            // Constraint #15, #30: audit every edit with hash-chained entry
            $this->audit->log(
                op: 'document.save',
                postId: $req->postId,
                actor: $req->actor,
                sessionId: $req->sessionId,
                beforeHash: $req->expectedHash,
                afterHash: $newHash,
                intent: $req->intent,
            );

            // Constraint #17: ASYNC the expensive stuff
            // CSS regen + cache flush + frontend verify + webhook emission all deferred
            wp_schedule_single_event(time() + 1, 'joist_post_save_verify', [
                'post_id' => $req->postId,
                'expected_hash' => $newHash,
                'session_id' => $req->sessionId,
                'revision_id' => $revisionId,
            ]);

            return new SaveResult(
                newHash: $newHash,
                verifiedElements: $verified,
                generatedIds: $this->idGen->lastGeneratedMap(),
                revisionId: $revisionId,
                transformations: $transformations,
                cssRegenerated: false, // happens async; webhook fires when done
                pendingVerifications: ['css_regen', 'cache_flush', 'frontend_verify'],
                warnings: $validation->warnings, // responsive_incomplete et al.
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
        $key = "joist_lock_page_{$postId}";
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

### New classes added in v1 hardening pass

These were added after the 2026-05-10 red-team critique. Each has a one-paragraph contract here; full signatures are in code.

**`PolicyGuard`** — runs FIRST in every controller. Hardcoded refuse-list (constraint #18) of "agent role must never" operations. Also implements `checkPlanRequired($session_id, $op, $page_id)` for chained-singleton enforcement (constraint #19). Refusals throw `PolicyRefusedException` → controller renders 403 `policy.<reason>` or 423 `policy.plan_required`.

**`RateLimiter`** — token-bucket per session, persisted in `wp_joist_rate_limits` table. Buckets: writes, reads, plugin-install, webhook-emit, AI-passthrough. Configurable via `joist_rate_limits` option. Returns 429 + Retry-After when exhausted.

**`URLValidator`** — SSRF defense (constraint #21). `validateExternal($url)` checks: scheme whitelist, DNS resolution returns public IP only, no banned schemes. Called by MediaController (url mode) and WebhooksController. Returns pre-resolved IP for `CURLOPT_RESOLVE` to defeat DNS rebinding.

**`DynamicTagValidator`** — walks element trees, finds every `__dynamic__` key, validates each tag reference against the live registered-tags registry (constraint #25). Suggests fuzzy matches on unknown tags.

**`CustomCSSBlockManager`** — parses and merges named custom CSS blocks (constraint #10 / §6.7 of PLUGIN_API.md). `mergeBlocks($elements, $page_id)` runs before save; reads existing CSS, identifies named blocks via TENET:BEGIN/END markers, replaces the named block being updated, preserves all others.

**`GlobalRefPreferrer`** — scans settings for color/typography literals, computes delta-E against kit globals, rewrites to `__globals__` refs when within threshold (constraint #26). `preferGlobals($elements)` returns `[$elements, $transformations]`; transformations surfaced in save response so the agent learns to use globals directly next time.

**`ContainerModeAdapter`** — autodetects site's layout mode (containers_only / sections_only / mixed) and enforces cross-mode refusal (constraint #23). `validateInserts($post_id, $elements)` walks proposed inserts and rejects mode mismatches.

**`SessionTracker`** — maintains per-session counters in `wp_joist_sessions` for `op_count`, `ops_destructive`, `ops_per_page`. `recordOp()` increments; `lastApprovedPlan` resets counters on plan approval.

**`OperatingMode`** — intercepts every write to apply per-site mode (`live` / `observer` / `quiet` / `kill_switch` / `staging_mandatory`). Returns SaveResult early for observer mode (dry_run); throws for quiet/kill_switch.

**`PrivacyExporter` / `PrivacyEraser`** — register `wp_privacy_personal_data_exporters` and `..._erasers` filters for GDPR DSR (§29 of PLUGIN_API.md). Audit log entries, revisions, sessions attributed to a subject user are exportable / anonymizable.

**`Logger`** — PSR-3-style with mandatory `redact()` chokepoint. Every log call runs through `redact()` which strips App Passwords, Anthropic keys, HMAC secrets, OAuth tokens by pattern match. Writes to `wp_upload_dir() . '/joist-logs/'` (with `.htaccess` deny rule) + `wp_options` rolling buffer (last 200 entries).

**Extended `SchemaValidator`** methods:
- `validateTree($elements)` — full tree (existing)
- `validateResponsiveCompleteness($settings, $schema)` — constraint #24, returns warnings (not errors)
- `validateInnerFlag($element, $parent_context)` — constraint #27, throws on mismatch
- `validateSkinAware($settings, $schema)` — constraint #29, validates against `settings._skin`'s control set
- `validateGlobalsPreferred($settings, $schema)` — informational, encourages globals
- `validateDynamicTagsResolve($settings)` — delegates to `DynamicTagValidator`

**Extended `IDGenerator`** methods:
- `fillMissing($elements)` — existing
- `regenerateTree($subtree, deep: bool = true)` — constraint #28, deep regen on duplicate/wrap

**Extended `LockManager`** — replaces transient-backed implementation with custom-table-backed (`wp_joist_locks`); same external API.

**Extended `CSSRegenerator`** — `regenerate($post_id)` now calls Post + Global_CSS + Custom_CSS + Manager flush + clears `_elementor_element_cache` + `_elementor_inline_svg` postmeta (Elementor specialist critique).

---

## 6. DB schema — custom tables

All tables prefixed `wp_<prefix>_joist_` (using `$wpdb->prefix`, NOT `base_prefix` — works on multisite). Created in migrations on plugin activation with `db_version` tracking + idempotent CREATE IF NOT EXISTS; cleaned up in `uninstall.php` ONLY if `joist_delete_data_on_uninstall` option is true (default false).

Every CREATE TABLE appends `$wpdb->get_charset_collate()`. ENUMs replaced with VARCHAR(16) + application-level CHECK (dbDelta alter on ENUM fails silently — see WP plugin engineer critique).

### `wp_joist_revisions`
```sql
CREATE TABLE wp_joist_revisions (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    post_id      BIGINT UNSIGNED NOT NULL,
    hash         CHAR(72) NOT NULL,           -- 'sha256:' + 64 hex
    snapshot     LONGBLOB NOT NULL,            -- gzipped JSON of _elementor_data
    snapshot_size INT UNSIGNED NOT NULL,
    actor_type   VARCHAR(16) NOT NULL,         -- 'agent' | 'human' | 'system' (app-validated)
    actor_id     VARCHAR(64),                  -- user ID for human, session ID for agent
    session_id   VARCHAR(64),
    intent       VARCHAR(500),
    created_at   DATETIME NOT NULL,
    INDEX idx_post_created (post_id, created_at DESC),
    INDEX idx_session (session_id)
) {$charset_collate};
```

Pruning: keep last N (default 50) per page; older entries pruned daily via WP cron. Per-write pruning also runs if a page's revision count exceeds the cap.

### `wp_joist_audit`
```sql
CREATE TABLE wp_joist_audit (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    timestamp    DATETIME NOT NULL,
    op           VARCHAR(64) NOT NULL,         -- 'document.save', 'kit.import', etc.
    post_id      BIGINT UNSIGNED,
    actor_type   VARCHAR(16) NOT NULL,         -- 'agent' | 'human' | 'system'
    actor_id     VARCHAR(64),
    app_password_user_id BIGINT UNSIGNED,      -- the WP user the App Password belongs to (separate from session attribution)
    session_id   VARCHAR(64),
    before_hash  CHAR(72),
    after_hash   CHAR(72),
    duration_ms  INT UNSIGNED,
    intent       VARCHAR(500),
    payload      LONGBLOB,                     -- gzipped op-specific payload, nullable
    chain_hash   CHAR(64) NOT NULL,            -- sha256(prev_row.chain_hash || sha256(row_payload)) — tamper detection (constraint #30)
    INDEX idx_post_time (post_id, timestamp DESC),
    INDEX idx_session (session_id),
    INDEX idx_op_time (op, timestamp DESC)
) {$charset_collate};
```

`chain_hash` is computed at write time. A daily integrity check verifies the chain; any break is surfaced as an admin notice ("Audit log tampering detected — row IDs X-Y"). Erasure via GDPR DSR (§29 of PLUGIN_API.md) anonymizes `actor_id` but preserves the chain by re-computing chain_hash forward from the erasure point.

### `wp_joist_plans`
```sql
CREATE TABLE wp_joist_plans (
    id              VARCHAR(64) PRIMARY KEY,        -- 'pln_01HXY...' (ULID)
    approval_token  CHAR(64) NOT NULL,              -- 32-byte random hex, REQUIRED in approval URL (defense against ULID enumeration)
    session_id      VARCHAR(64) NOT NULL,
    page_id         BIGINT UNSIGNED,
    intent          VARCHAR(500) NOT NULL,
    steps           LONGBLOB NOT NULL,              -- gzipped JSON
    status          VARCHAR(16) NOT NULL,           -- 'pending'|'approved'|'rejected'|'executing'|'completed'|'failed'|'expired'
    approval_user_id BIGINT UNSIGNED,
    approval_at     DATETIME,
    approver_session_id VARCHAR(64),                -- WP session ID at approval time (CSRF nonce defense)
    executed_at     DATETIME,
    result          LONGBLOB,
    created_at      DATETIME NOT NULL,
    expires_at      DATETIME NOT NULL,
    INDEX idx_status_created (status, created_at DESC)
) {$charset_collate};
```

Approval URL: `https://example.com/wp-admin/admin.php?page=joist-plan&id=pln_01HXY...&token=<approval_token>`. Plan can only be approved by the user who created the agent session, OR by an admin in a configured approvers list. CSRF nonce required on the Approve button.

On `init` after a plugin update or activation, any plan with `status: executing` older than 5 minutes is marked `failed` with reason `plugin_updated_mid_execution`; webhook fires.

### `wp_joist_sessions`
```sql
CREATE TABLE wp_joist_sessions (
    id              VARCHAR(64) PRIMARY KEY,        -- 'ses_01HXY...'
    agent_name      VARCHAR(64) NOT NULL,
    agent_version   VARCHAR(32),
    app_password_user_id BIGINT UNSIGNED NOT NULL,  -- which WP user's App Password initiated
    intent          VARCHAR(500),
    user_label      VARCHAR(200),
    started_at      DATETIME NOT NULL,
    last_activity   DATETIME NOT NULL,
    ended_at        DATETIME,
    op_count        INT UNSIGNED DEFAULT 0,         -- chained-singleton counter (constraint #19)
    ops_destructive INT UNSIGNED DEFAULT 0,
    ops_per_page    LONGBLOB,                       -- gzipped JSON map {page_id: count}
    last_approved_plan_id VARCHAR(64),              -- resets counters when a plan covering the page is approved
    cost_tokens     INT UNSIGNED DEFAULT 0,
    INDEX idx_started (started_at DESC)
) {$charset_collate};
```

### `wp_joist_webhooks`
```sql
CREATE TABLE wp_joist_webhooks (
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

### `wp_joist_locks` (replaces transient locks — constraint #22)
```sql
CREATE TABLE wp_joist_locks (
    post_id      BIGINT UNSIGNED PRIMARY KEY,
    session_id   VARCHAR(64) NOT NULL,
    acquired_at  DATETIME NOT NULL,
    expires_at   DATETIME NOT NULL,
    reason       VARCHAR(500),
    INDEX idx_expires (expires_at)
) {$charset_collate};
```

Validated `post_id` (must exist) before insert. Daily WP-Cron prunes expired locks. Avoids the wp_options autoload bloat problem on no-object-cache hosts.

### `wp_joist_rate_limits` (per-session token buckets — §26 of PLUGIN_API.md)
```sql
CREATE TABLE wp_joist_rate_limits (
    session_id   VARCHAR(64) NOT NULL,
    bucket_class VARCHAR(32) NOT NULL,           -- 'writes' | 'reads' | 'plugin_install' | etc.
    tokens       INT UNSIGNED NOT NULL,
    last_refill  DATETIME NOT NULL,
    PRIMARY KEY (session_id, bucket_class)
) {$charset_collate};
```

Pruned hourly.

### `wp_joist_backlog` (per-page "we'll come back to this" — §31 of PLUGIN_API.md)
```sql
CREATE TABLE wp_joist_backlog (
    id           VARCHAR(64) PRIMARY KEY,        -- 'back_01HXY...'
    page_id      BIGINT UNSIGNED NOT NULL,
    intent       VARCHAR(500) NOT NULL,
    priority     VARCHAR(16) NOT NULL DEFAULT 'medium',
    created_by_user_id BIGINT UNSIGNED,
    created_by_session_id VARCHAR(64),
    created_at   DATETIME NOT NULL,
    resolved_at  DATETIME,
    resolved_plan_id VARCHAR(64),
    INDEX idx_page_priority (page_id, priority)
) {$charset_collate};
```

### `wp_joist_bot_crawls` (v1.5 — `llms.txt` traffic logging)
```sql
CREATE TABLE wp_joist_bot_crawls (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    timestamp    DATETIME NOT NULL,
    bot          VARCHAR(64) NOT NULL,         -- 'GPTBot', 'ClaudeBot', 'PerplexityBot', etc.
    user_agent   VARCHAR(500),
    path         VARCHAR(500) NOT NULL,
    status_code  SMALLINT UNSIGNED,
    referer      VARCHAR(500),
    INDEX idx_bot_time (bot, timestamp DESC)
) {$charset_collate};
```

### Activation / version tracking

Plugin stores `joist_db_version` option (integer). Activation runs migrations idempotently:
```php
function joist_run_migrations(): void {
    $current = (int) get_option('joist_db_version', 0);
    $migrations = [
        1 => 'migration_001_create_revisions',
        2 => 'migration_002_create_audit',
        3 => 'migration_003_create_plans',
        4 => 'migration_004_create_sessions',
        5 => 'migration_005_create_locks',
        6 => 'migration_006_create_rate_limits',
        7 => 'migration_007_create_backlog',
        8 => 'migration_008_create_webhooks',
    ];
    foreach ($migrations as $version => $fn) {
        if ($version <= $current) continue;
        try {
            $fn();
            update_option('joist_db_version', $version);
        } catch (\Throwable $e) {
            update_option('joist_activation_error', [
                'version' => $version,
                'message' => $e->getMessage(),
                'time' => time(),
            ]);
            return; // halt; admin notice surfaces
        }
    }
}
```

Admin notice fires if `joist_activation_error` is set, surfacing the failure with retry button.

### Multisite (constraint #29)

On `wpmu_new_blog`, plugin's bootstrap re-runs migrations against the new site's `$wpdb->prefix`. Network-admin settings page (separate from per-site settings) controls fleet-wide defaults: operating-mode default for new sites, rate-limit defaults, host detection overrides. Network-activated installs iterate `get_sites()` on first activation.

`$wpdb->prefix` (per-site) used throughout — NEVER `$wpdb->base_prefix`. Tested with `wp-env` multisite fixtures in CI.

---

## 7. WP Abilities + MCP wiring

WordPress 6.9 ships the Abilities API; `WordPress/mcp-adapter` bridges abilities to MCP. Our flow:

1. On plugin activate, `AbilityRegistrar` registers one ability per public operation:

```php
wp_register_ability('joist/get_page', [
    'label' => __('Get an Elementor page', 'joist'),
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

2. `mcp-adapter` (configured via plugin settings) discovers all `joist/*` abilities and exposes them on an MCP endpoint at `/wp-json/mcp/v1/`.

3. Our Claude Code MCP server (next section) connects to that endpoint.

**Tool naming convention:**
- REST `GET /pages` → ability `joist/list_pages` → MCP tool `elementor_list_pages`
- REST `POST /pages/{id}/patch` → ability `joist/patch_page` → MCP tool `elementor_patch_page`
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
- Auth handling — App Password loaded via Claude Code's credential manager (Keychain on macOS / libsecret on Linux / DPAPI on Windows). **Never plaintext in `.mcp.json`.**
- Anthropic / OpenAI / image-gen API keys — same credential manager delegation. Never plaintext, never logged.
- Type generation from `PLUGIN_API.md` (manual at v0, codegen in v0.5)
- Quality gates that run *before* writes (SlopDetector pre-validates AI-generated content)
- Plan composition (helping the agent produce well-structured plans)
- **Error enrichment** — `errors.ts` takes plugin error responses and amplifies the `recovery_suggestions[]` (e.g., 422 `schema.unknown_key` becomes "I tried to set X, that key doesn't exist on widget Y, but Z does — should I try Z?" rather than raw 422).
- **AI generation** (the `/ai/*` endpoints) — copy, headline, image, schema construction. Lives HERE not in the PHP plugin (wp.org review blocker — see HARDENING_v1.md §1.1).
- **`OperatingMode` client-side check** — before any write tool call, server checks the site's operating_mode and intercepts (observer → all dry_run, quiet/kill_switch → refuses with explanation).
- **Untrusted content wrapping** — when reading widget content back into the model's context, wrap in `<untrusted_content>...</untrusted_content>` tags to defeat prompt injection from page text (security review item).
- **Cost tracking** — every Anthropic call logged with input/output tokens + computed USD via published pricing. Per-session totals exposed to the agent and surfaced in Plan Mode "estimated cost" line.

Why have the server at all instead of letting Claude call the REST API directly? Four reasons:
1. **Tool surface ergonomics** — MCP tools are nicer than raw HTTP for Claude
2. **Quality gates close to the model** — SlopDetector / SchemaBuilder run in Node before any network round-trip, saving tokens
3. **Error enrichment + injection defense** — best place to wrap untrusted content + amplify recovery suggestions
4. **Future: aggregation** — `elementor_build_landing_page` (multi-step composite tool) can live here without polluting the WP plugin

**Distribution:** `npm install -g @joist/elementor-mcp` OR `npx @joist/elementor-mcp` OR drop-in to `.mcp.json` via the CLI. Published with **npm provenance + Sigstore attestations**; maintainer accounts require 2FA hardware key (supply chain defense per security review).

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
    │   ├── init.ts                 # `joist init` — top-level wizard
    │   ├── connect.ts              # `joist connect <site-url>` — single-site
    │   ├── connect_bulk.ts         # `joist connect --config sites.yaml` — fleet
    │   ├── fleet.ts                # `joist fleet status|broadcast` — fleet ops
    │   ├── install-plugin.ts       # downloads + activates plugin via REST or WP-CLI
    │   ├── connect_cdn.ts          # `joist connect-cdn cloudflare` — CDN purge setup
    │   ├── doctor.ts               # diagnoses connection + permission issues; runs REAL write test
    │   ├── status.ts               # current connection info
    │   ├── operating_mode.ts       # `joist mode observer|live|quiet|kill --site=` 
    │   └── disconnect.ts
    ├── lib/
    │   ├── ClaudeCodeConfig.ts     # reads/writes ~/.claude/.mcp.json
    │   ├── WordPressDetector.ts    # probes for plugin presence
    │   ├── AppPassword.ts          # generation helper
    │   ├── FleetRegistry.ts        # reads/writes ~/.joist/fleet.json
    │   ├── ParallelRunner.ts       # bounded concurrency for bulk operations
    │   └── prompts.ts
```

**User flow — "I have a SiteGround site, I want Claude Code to edit it"** (v1 happy path):

```bash
$ npx @joist/cli connect https://example.com

? Site URL detected: https://example.com  ✓
? WordPress detected: 6.5.2  ✓
? Elementor detected: 3.21.0 + Pro 3.21.0  ✓
? SiteGround host detected — will configure SG Optimizer + SG Security compatibility  ✓
?
? Plugin not installed. Install joist? (Y/n) Y
? Need admin credentials to install the plugin.
  Username: ckrohg
  Application Password: ····················
?
✓ Plugin installed and activated
✓ Created dedicated `joist-agent` user (role: Editor)
✓ Generated App Password for joist-agent
✓ Configured Claude Code MCP at ~/.claude/.mcp.json
✓ Verified connection — health check passed (12/12 checks)
✓ Webhook endpoint configured

You're ready. Try in Claude Code:
  /elementor-build hero section for my homepage with a new headline
  /elementor-audit my-page
```

If WP-CLI is unavailable (SiteGround StartUp/GrowBig plans), the CLI falls back to: download plugin zip, upload via REST `/wp/v2/plugins`, activate via REST.

**Bulk fleet mode** (constraint #1 of agency adoption — see HARDENING_v1.md §1.5):

```bash
$ joist connect --config sites.yaml --concurrency 5

# sites.yaml format:
# - url: https://client1.com
#   admin_user: marcus
#   admin_app_password: "xxxx xxxx xxxx xxxx xxxx xxxx"
#   operating_mode: observer        # default for new sites
#   staging_mandatory: true
#   brand_kit: ./kits/client1.json
# - url: https://client2.com
#   ...
```

Per-site flow identical to single-site; runs in parallel up to `--concurrency` limit. Per-site outcome reported as a table; failures listed for retry. Failed sites can be re-tried with `--retry-failed`.

`~/.joist/fleet.json` registry maintained locally for subsequent `fleet status` and `fleet broadcast` operations.

---

## 11. Plan Mode end-to-end flow

The most important user-visible workflow. Sequence:

```
1. User: "/elementor-build a 3-tile bento features section on /home"

2. Claude Code (skill):
   - checks operating_mode (observer mode → all writes return dry_run)
   - calls elementor_list_widgets → knows what's available
   - calls elementor_get_widget_schema('container'), ('heading'), ('image'), ('icon-box')
   - calls elementor_get_page(123) → has current state + hash_A
   - calls elementor_iteration_context(123) → loads recent plans + human edits
   - SchemaBuilder constructs valid element tree
   - SlopDetector rejects the AI's first draft headline ("Build the future of features")
   - regenerates with concrete copy from the brand kit
   - composes a plan: 3 ops (insert container, insert 3 child widgets)
   - calls elementor_preview_render(prospective_elements) → preview_url for human review
   - calls elementor_create_plan(...)

3. Plugin:
   - generates plan_id (ULID) + approval_token (32-byte random hex)
   - persists plan
   - returns plan_id + approval_url with both id AND token: 
     /wp-admin/admin.php?page=joist-plan&id=pln_01HXY...&token=abc123...
   - emits webhook to user's Slack/email/Claude Code: "Plan ready for review"

4. User opens approval_url in browser (WP admin):
   - approval page validates: token matches, plan not expired, user has manage_options
     OR is in the configured approvers list, OR is the user who created the session
   - shows plan structure, side-by-side preview iframe (desktop/tablet/mobile), CSS-diff,
     estimated cost in tokens + USD
   - CSRF nonce on the Approve button
   - clicks Approve

5. Plugin:
   - validates CSRF nonce
   - records approval_user_id + approval_at + approver_session_id
   - PlanExecutor begins execution synchronously (small ops) OR via wp_schedule_single_event (large)
   - acquires page lock on post 123
   - runs each op through DocumentWriter::save() (which respects all 30 constraints)
   - on any step failure: rollback ALL prior steps via revision snapshot taken at plan-start
   - resets session's chained-singleton counters
   - emits webhook: "Plan completed" with new hash

6. Claude Code (skill) receives webhook:
   - confirms to user: "Done. New section added. View at https://example.com/home"
   - calls elementor_audit_page(123) → reports a11y/SEO/perf scores against the new content
```

A failed step rolls back the entire plan via the snapshot. If the plugin updates mid-execution (plan stuck in `executing` for > 5 min), `init` action marks it `failed` with reason `plugin_updated_mid_execution` and fires a webhook.

**Plan expiration:** plans expire after 1 hour by default (configurable). Expired plans cannot be approved; they must be regenerated. This is intentional — stale plans operating on stale page state are dangerous.

---

## 12. Auth model

- **Plugin operations:** every REST request requires HTTP Basic auth with WP Application Password. The CLI configures Claude Code with a password tied to the dedicated `joist-agent` user (Editor role default, configurable to Administrator if needed for plugin install).
- **Webhook callbacks (plugin → agent):** HMAC-SHA256 signed. Agent verifies signature before acting.
- **Plan approval:** WP admin session — only logged-in users with `edit_pages` capability can approve.
- **No bearer tokens, no OAuth in v1.** App Passwords are sufficient and don't require an OAuth provider.

---

## 13. Failure-mode constraint mapping (where each rule lives)

| # | Constraint | Enforced in |
|---|---|---|
| 1 | Validate writes against live schema | `SchemaValidator::validateTree` → throws before `DocumentWriter::save` proceeds |
| 2 | Read-after-write | `DocumentWriter::save` returns `verifiedElements` from `$document->get_elements_data()` post-save |
| 3 | Snapshot before multi-step | `PlanExecutor` snapshots at plan-start; `DocumentWriter::save` snapshots per-call |
| 4 | Surgical diff-based edits only | REST `POST /pages/{id}/patch` primary; `PUT /pages/{id}` requires `expected_hash` |
| 5 | Auto-flush cache + verify | Deferred async (constraint #17); `CSSRegenerator` + `CacheFlusher` + `verifyFrontendUpdated` in `joist_post_save_verify` cron event |
| 6 | Token-budgeted reads | `PagesController::get` returns `tree_summary` by default; `?include=full` for full; per-element supports `?depth=N` |
| 7 | Hard pre-flight | `PreflightValidator` runs on every controller's `permission_callback` |
| 8 | Pin Elementor version range | `ElementorAdapter::assertSupportedVersion` runs in every write |
| 9 | Cost meter | MCP server tracks tokens per session; refuses retry > N on same error class |
| 10 | Append vs replace explicit | All write ops require explicit `op` field; "append" never default; `CustomCSSBlockManager` enforces named-block replace |
| 11 | Tool-count discipline | ~50 MCP tools total; parameterized over specialized |
| 12 | Scope guards | `PatchEngine` only mutates element IDs listed in `ops[].element_id` |
| 13 | Performance budgets | `PerformanceBudget` quality gate pre-write; rejects oversized images, banned widgets |
| 14 | First-class export | `GET /kit/export`, `GET /pages/{id}/export?format=...` always available |
| 15 | Audit-tagged edits | `AuditLogger` writes to `wp_joist_audit` + adds WP revision comment |
| 16 | No silent failures | Every controller's error envelope; `DocumentWriter::save` throws on rollback |
| 17 | Async-by-default I/O | `wp_schedule_single_event('joist_post_save_verify', ...)` defers all `wp_remote_*` and expensive ops |
| 18 | PolicyGuard refusals | `PolicyGuard::assertAllowed()` runs FIRST in every controller; hardcoded refuse-list |
| 19 | Chained-singleton plan trigger | `SessionTracker::recordOp` + `PolicyGuard::checkPlanRequired` enforced in `DocumentWriter::save` |
| 20 | HTTPS-only | `ControllerBase` checks `is_ssl()` first; returns 421 |
| 21 | SSRF guards on URLs | `URLValidator::validateExternal($url)` called by MediaController + WebhooksController |
| 22 | Custom locks table | `LockManager` uses `wp_joist_locks` (not transients); validated `post_id` |
| 23 | Container-mode matching | `ContainerModeAdapter::validateInserts` in `DocumentWriter::save` |
| 24 | Responsive completeness | `SchemaValidator::validateResponsiveCompleteness` + auto-fill in `PatchEngine` |
| 25 | Dynamic tag references resolve | `DynamicTagValidator::validateTree` in `DocumentWriter::save` |
| 26 | Global refs preferred | `GlobalRefPreferrer::preferGlobals` transforms tree before write |
| 27 | Inner-flag inference | `PatchEngine::insert` auto-sets `isInner`; `SchemaValidator::validateInnerFlag` rejects mismatches |
| 28 | Deep ID regen on duplicate/wrap | `IDGenerator::regenerateTree(deep: true)` default for those ops |
| 29 | Skin-aware schema validation | `WidgetCatalog::getSchema` returns per-skin; `SchemaValidator::validateSkinAware` enforces |
| 30 | Hash-chained audit log | `AuditLogger::log` computes `chain_hash = sha256(prev.chain_hash \|\| payload_hash)` |

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
  - Publish `@joist/elementor-mcp` to npm
  - Publish `@joist/cli` to npm with bundled binaries for darwin/linux/win
- **wp.org:** plugin reviewed + listed. Standard wp.org process: trunk + tags in SVN, readme.txt formatting, no obfuscation.
- **Documentation site:** `docs.joist.dev` (or similar), built from `docs/` via mkdocs/vitepress, deployed to Cloudflare Pages.

---

## 16. What we explicitly DON'T build in v1

Repeated from §1, deliberately. The discipline of cutting matters more than the ambition of adding.

- ❌ Hosted SaaS dashboard
- ❌ Hosted standalone Plan Review approval surface (v1 uses wp-admin)
- ❌ Multi-site management dashboard (v1 ships bulk CLI; web dashboard is v2)
- ❌ Autonomous background agents (post-launch content/SEO/perf monitors)
- ❌ Native A/B testing
- ❌ Figma / URL / screenshot import
- ❌ Multilingual adapter
- ❌ WooCommerce
- ❌ Static HTML export (Kit `.zip` + WXR + Elementor template JSON cover v1 export)
- ❌ Custom WordPress theme builder (Hello + Pro is enough)
- ❌ Real-time collaboration (use WP's existing post-lock UX + our locks/operating-mode)
- ❌ Mobile app
- ❌ Per-step plan approval / plan forking / variant branches (v1 = single-approval atomic execution)
- ❌ Visual-diff screenshots with pixel-delta human review (v1 ships CSS-diff JSON only; screenshots are v1.5)
- ❌ AI-edit canvas badge inside the Elementor editor itself (audit log + revision tags substitute in v1)
- ❌ Real-time presence indicators (locks for exclusion; presence is v2)
- ❌ Live cost meter UI in chat (session-level cost tracking + per-task estimates in plans is v1)

These are roadmapped (see `knowledge/ROADMAP.md`) but explicit non-goals for v1.0.

---

## 17. Multisite handling

WordPress Network installs are ~10% of plugin installs (per WP plugin engineer critique). Supported from v1.

- All custom tables use `$wpdb->prefix` (per-site), NOT `$wpdb->base_prefix`. Tested with `wp-env` multisite fixtures in CI.
- On `wpmu_new_blog` action, plugin's `Bootstrap::onNewBlog($blog_id)` calls `switch_to_blog($blog_id)`, runs migrations, restores. Idempotent.
- Network-activated installs iterate `get_sites()` once on activation.
- Network-admin settings page (separate from per-site settings) controls fleet-wide defaults:
  - Default operating mode for new sites (recommend `observer`)
  - Default rate-limit thresholds
  - Host detection adapter overrides (e.g., "we're on a custom-configured Kinsta — use this adapter")
  - Default Anthropic API key (per-site override allowed)
- Audit log + revisions are per-site. Webhook config is per-site.
- The `joist_agent` role is registered on every site in the network.

---

## 18. Async I/O discipline

Hard rule (constraint #17): no `wp_remote_*` calls or expensive filesystem ops in REST controller hot path. Inventory of what runs sync vs async:

**Synchronous (inside REST handler):**
- App Password auth
- HTTPS check (`is_ssl()`)
- PolicyGuard refusals
- Operating mode check
- Rate limit token bucket
- Hash compute (in-memory)
- Schema validation (in-memory; widget catalog is cached)
- Element ID generation
- OCC hash check
- Revision snapshot (single DB write — gzipped LONGBLOB)
- Elementor `Document::save()` (the actual postmeta write; happens inside Elementor's own code)
- Read-after-write of `_elementor_data` (single DB read)
- Hash chain audit row write (single DB write)

**Deferred via `wp_schedule_single_event(time() + 1, ...)`:**
- Elementor CSS regeneration (Post + Global + Custom + Manager flush — see §5 CSSRegenerator)
- Host cache flush (SG Optimizer, WP Rocket, LiteSpeed, etc.)
- CDN cache purge (Cloudflare, BunnyCDN, KeyCDN)
- Frontend verification fetch (HEAD against the rendered page to confirm hash matches)
- Webhook emission to subscribers

**Deferred via `shutdown` action:**
- Session counter persistence (`ops_per_page` map update)
- Rate limit bucket refill
- Cleanup of expired idempotency keys

**Result:** typical write latency on a 5MB page drops from 1.5–3s (sync everything) to ~200–400ms (sync minimum), with full verification completing 2–10s after via webhook. Agent treats the webhook as the canonical "this is done" signal; the initial response is provisional. SKILL.md prompts the model to surface "Applied (verification pending)" then update once webhook fires.

If `wp_schedule_single_event` fails (some hosts disable WP-Cron), the scheduled work runs in `shutdown` instead. Both paths log failures to `wp_joist_async_log` for triage.

---

## 19. Custom `joist_agent` role + capabilities

Constraint #18 + security review. The default Editor role gives way too much capability for an automated agent.

```php
add_role('joist_agent', __('Joist Agent', 'joist'), [
    // What it CAN do:
    'read' => true,
    'edit_pages' => true,
    'edit_others_pages' => true,
    'publish_pages' => true,
    'edit_published_pages' => true,
    'delete_pages' => true,                // soft-delete to trash only — PolicyGuard refuses ?force=true
    'edit_posts' => true,                  // for blog posts
    'edit_others_posts' => true,
    'publish_posts' => true,
    'edit_published_posts' => true,
    'delete_posts' => true,
    'upload_files' => true,                // ONLY if image-gen enabled; disabled by default
    'joist_use_agent_api' => true,         // custom cap, checked by REST controllers
    
    // What it CANNOT do (NOT granted):
    // 'unfiltered_html' => never
    // 'manage_categories' => never
    // 'manage_options' => never
    // 'edit_users' => never
    // 'install_plugins' => never
    // 'activate_plugins' => never
    // 'edit_themes' => never
    // 'delete_users' => never
    // 'create_users' => never
]);
```

CLI setup wizard creates the `joist-agent` user with this role by default. If the user wants Administrator-tier access (for `POST /plugins/install` with `slug`, for example), the CLI prompts with explicit warning: "Administrator role expands blast radius. Recommended only if you understand the risk. The PolicyGuard refuse-list (§27 of PLUGIN_API.md) still applies, but Administrator capability grants broader DB access. Continue? [y/N]"

REST controllers check `current_user_can('joist_use_agent_api')` first (works for both `joist_agent` and Administrator). Specific destructive endpoints additionally check `current_user_can('manage_options')` (Administrator only).

---

## 20. Host adapter matrix

Specific behaviors per detected host. Each adapter is a class implementing `HostAdapterInterface`:

| Host | Plan | SSH/WP-CLI | App Password auth | Cache | Notes |
|---|---|---|---|---|---|
| SiteGround StartUp | shared | No | Works if SG Security default-off | SG Optimizer | SG Security: must auto-allowlist REST writes via SG-FW-XMLRPC-1 rule toggle. No staging — draft-mode fallback. |
| SiteGround GrowBig | shared | No | Same | SG Optimizer | Same as StartUp. Most common agency target — fully documented compat matrix shipped with plugin. |
| SiteGround GoGeek+ | shared+ | Yes | Same | SG Optimizer | SSH/WP-CLI available. Native staging via SG dashboard — we trigger via unofficial REST API; mark as "best-effort" in docs. |
| Kinsta | managed | Yes | Works | Kinsta CDN + native cache | Native staging via Kinsta API (with API token). REST writes unrestricted. Recommended host. |
| Cloudways | managed | Yes | Works | Varies by stack | Most permissive. Recommended host. |
| WP Engine | managed | Yes | Mercury security layer may rate-limit | WPE native cache | Mercury blocks REST writes from non-allowlisted IPs. Doctor surfaces specific allowlist instructions. |
| Pressable | managed | Yes | Works | Native | Similar to Kinsta. |
| Local by WP Engine | local dev | Yes | Works | None | Recommended dev environment. |
| GoDaddy Managed WP | shared | No | Often blocked | Varies | Not recommended. Doctor warns. |
| Budget shared hosts (Bluehost, HostGator, Namecheap basic) | shared | Varies | Often blocked | Varies | Not recommended. Doctor warns. |

Each adapter implements: `detect()` (UA / file-marker / config detection), `flushCache($post_id)`, `restApiWriteCompatibility()` (returns specific blockers), `setupInstructions()` (doctor command output).

SiteGround GrowBig gets the deepest treatment in v1 — it's the most common agency target. A separate document `docs/hosts/siteground.md` ships with the plugin documenting exact configuration steps.

---

## 21. Cache adapter matrix

Page cache + object cache adapters. Each implements `CacheAdapterInterface { flushPage($id), flushSite(), detect() }`.

| Adapter | Detection | Flush mechanism | v1 priority |
|---|---|---|---|
| SG Optimizer | `function_exists('sg_cachepress_purge_cache')` | Direct fn call | **v1 must-have** |
| WP Rocket | `defined('WP_ROCKET_VERSION')` | `rocket_clean_post`, `rocket_clean_domain` | **v1 must-have** (largest install base) |
| LiteSpeed Cache | `class_exists('LiteSpeed\Cache')` | `do_action('litespeed_purge_post', $id)` | **v1 must-have** (shared host favorite) |
| WP Engine native | `class_exists('WpeCommon')` | `WpeCommon::purge_varnish_cache_post()` | **v1 must-have** (no plugin, host-controlled) |
| W3 Total Cache | `function_exists('w3tc_pgcache_flush')` | Direct fn calls | v1.5 |
| WP Super Cache | `function_exists('wp_cache_post_change')` | Direct fn call | v1.5 |
| WP Fastest Cache | `function_exists('wpfc_clear_post_cache_by_id')` | Direct fn call | v1.5 |
| Cloudflare APO | API call to CF | REST API with token | v1.5 |
| Comet Cache | `class_exists('comet_cache')` | Direct fn calls | v1.5 |

Object cache adapters: Redis (`wp_cache_flush`), Memcached, native non-persistent (fallback). All v1.

---

## 22. CDN flusher

Separate from cache (which is server-side). CDN purges run at the edge.

Each adapter implements `CDNAdapterInterface { purgePage($url), purgeAssets($urls), detect() }`.

| Adapter | Detection | Auth | v1 |
|---|---|---|---|
| Cloudflare | DNS lookup → CF nameservers OR `cf-ray` header on response | User-provided API token (Zone:Edit:Edit + Cache Purge:Edit), encrypted via libsodium with `AUTH_KEY` | **v1 must-have** |
| BunnyCDN | URL contains `b-cdn.net` OR explicit config | API token | v1.5 |
| KeyCDN | Explicit config | API token | v1.5 |
| Fastly | Explicit config | API token | v2 |

API tokens stored in `wp_options.joist_cdn_config` JSON, **encrypted at rest** using libsodium symmetric encryption keyed off `AUTH_KEY` from `wp-config.php` (so unauthorized DB access doesn't yield tokens directly).

Cloudflare adapter setup via CLI:
```bash
$ joist connect-cdn cloudflare
? Cloudflare API token: ****
? Zone ID: example.com → 0123abc...
✓ Verified token permissions
✓ Stored encrypted in wp_options
✓ Tested purge of /wp-content/uploads/elementor/css/post-1.css
```

Async purge: invoked from `joist_post_save_verify` cron event (along with cache flush). Failures retry with exponential backoff up to 3 times; persistent failure → admin notice.
