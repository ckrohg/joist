# Joist plugin — v0.5 alpha

> ⚠️ **Do NOT install on production sites.** This is the full v1 API surface implemented against the spec — **but untested against a live WordPress environment.** Real-WP validation is the next step. v1.0 (production-ready, wp.org-listed) targets ~14–16 weeks from focused-engineering start.

## What v0.5 delivers

The complete v1 plugin surface — every REST endpoint, every one of the 30 failure-mode constraints, custom DB tables, custom role, Plan Mode, host/cache/CDN/SEO adapters. The thing it hasn't done yet is **run on a real WordPress install.**

### REST endpoints

| Endpoint | What it does |
|---|---|
| `GET /joist/v1/site` | Runtime introspection — WP/Elementor/Pro versions, layout_mode, operating_mode, host, cache adapters, registered widget + dynamic-tag counts |
| `GET /joist/v1/health` | Pass/fail checks **including a real write test** (creates → writes → reads → deletes a test page through Elementor) |
| `GET /joist/v1/diagnostics` | Verbose — PHP/WP/plugins/host/recent-log/audit-chain status |
| `GET /joist/v1/widgets` · `/widgets/{type}/schema` · `POST /widgets/validate` | Widget catalog + full control schemas (breakpoints, supports_globals, skins) + pre-flight validation |
| `GET /joist/v1/dynamic-tags` | Registered dynamic tag classes (Pro, ACF, JetEngine) |
| `GET /joist/v1/pages` · `POST /pages` · `GET/PUT/DELETE /pages/{id}` | Page CRUD |
| `POST /joist/v1/pages/{id}/patch` | Surgical edits — 8 ops: update_settings, replace_element, insert, delete, move, duplicate, wrap, unwrap |
| `GET /joist/v1/pages/{id}/tree-summary` | Lightweight outline (token-budgeted reads — constraint #6) |
| `GET /joist/v1/pages/{id}/revisions` · `POST .../restore` | Atomic rollback target list + restore |
| `GET /joist/v1/pages/{id}/elements/{eid}` | Single-element read |
| `GET /joist/v1/pages/{id}/iteration-context` | Recent plans + human edits + backlog (cheap conversational re-priming) |
| `GET /joist/v1/pages/{id}/seo` · `PUT` | SEO meta routed through Yoast/RankMath/AIOSEO/native |
| `POST /joist/v1/pages/legacy-builder/section-with-column` | Wraps content for legacy `sections_only` sites |
| `GET /joist/v1/kit` · `PUT` · `POST /kit/match-color` | Global colors/fonts/typography + delta-E nearest-global helper |
| `GET /joist/v1/templates` · `POST` · `GET/PUT /templates/{id}` | Theme Builder templates (headers/footers/single/archive/popups) |
| `GET /joist/v1/media` · `POST /media` (URL-mode w/ SSRF) · `GET /media/{id}/as-image-control` | Media list + URL-fetch upload |
| `GET /joist/v1/menus` · `POST` | Nav menus |
| `GET /joist/v1/plugins` · `POST /plugins/install` (slug-only by default) · activate/deactivate | Admin-only plugin management |
| `POST /joist/v1/sessions/start` · `.../end` | Agent session lifecycle (powers chained-singleton detection) |
| `POST /joist/v1/plans` · `GET` · `.../approve` · `.../reject` · `.../execute` | Plan Mode |
| `GET /joist/v1/webhooks` · `POST` · `DELETE` · `.../rotate-secret` | Webhook subscriptions (HMAC, circuit breaker, dual-secret rotation) |
| `GET /joist/v1/audit-log` · `?format=html\|csv` · `/audit-log/summary` | Hash-chained audit log + client-facing report formats |
| `GET /joist/v1/site/operating-mode` · `POST` | live / observer / quiet / kill_switch / staging_mandatory |
| `POST /joist/v1/site/flush-cache` · `/site/regenerate-css` · `/elementor/refresh-layout-mode` | Manual cache/CSS/layout-mode operations |

### All 30 failure-mode constraints

See `joist.php` header comment for the full mapping, or `specs/PLUGIN_API.md §20`. Highlights: schema validation with Levenshtein+flex_* suggestions (#1, the msrbuilds #32 fix), read-after-write (#2), atomic rollback (#3), async-by-default I/O (#17), PolicyGuard refuse-list (#18), chained-singleton plan trigger (#19), HTTPS enforcement (#20), SSRF defense (#21), custom locks table (#22), container-mode matching (#23), responsive completeness (#24), dynamic tag validation (#25), global-ref preference (#26), inner-flag inference (#27), deep ID regen (#28), hash-chained audit (#30), rate limiting (§26).

### Architecture

- `src/Container.php` — lazy-singleton service factory
- `src/Bootstrap.php` — activation (migrations + role), REST registration, scheduled events (post-save verify, webhook dispatch, daily maintenance)
- `src/DB/MigrationRunner.php` — 8 custom tables, idempotent, db_version-tracked
- `src/Security/` — Role (joist_agent reduced caps), PolicyGuard (refuse-list + plan trigger), RateLimiter (token bucket), URLValidator (SSRF)
- `src/Concurrency/` — SessionTracker, OperatingMode, LockManager (custom table)
- `src/Storage/RevisionStore.php` — gzipped snapshots + atomic restore
- `src/Audit/AuditLogger.php` — hash-chained + daily integrity check
- `src/Webhooks/` — WebhookStore + WebhookEmitter (async HMAC POSTs)
- `src/Core/` — Hasher (canonicalize + sha256), IDGenerator (8-hex + deep regen), Logger (redact chokepoint)
- `src/Elementor/` — DocumentWriter (THE SPINE — 9 constraints sync, rest deferred), SchemaValidator, PatchEngine (8 ops), WidgetCatalog, DynamicTagValidator, GlobalRefPreferrer, CustomCSSBlockManager, ContainerModeAdapter, CSSRegenerator
- `src/Cache/` — CacheFlusher + SGOptimizer/WPRocket/LiteSpeed/WPEngine adapters
- `src/Host/HostDetector.php` — SiteGround/WPE/Kinsta/Cloudways/Pressable/Local
- `src/CDN/` — CDNFlusher + CloudflareAdapter (encrypted token storage)
- `src/SEO/` — adapter interface + Yoast/RankMath/AIOSEO/Native
- `src/Plan/` — PlanStore + PlanExecutor (atomic, plan-level rollback)
- `src/REST/` — 16 controllers, all extending ControllerBase (HTTPS check + rate limit + error envelope with recovery_suggestions[])

### What's NOT yet in v0.5

WP-admin React Plan Review UI (REST exists, UI is v0.7) · MCP adapter wiring (REST standalone works; Abilities bridge v0.7) · per-skin control validation depth · Kit .zip import/export · Theme Builder display-condition priority · CIEDE2000 (using CIE76) · DNS-rebinding curl handler · GDPR DSR exporters · live preview rendering · multisite per-site migration loop · WooCommerce/Forms endpoints.

## Install (manual, for dev only)

1. Install [Local](https://localwp.com), spin up a site — WordPress 6.5+, PHP 8.0+.
2. Install **Elementor** (the free version is enough for v0.5 — we don't use Pro-only features yet) and the **Hello Elementor** theme.
3. Symlink the plugin into the site:
   ```bash
   ln -s /Users/ckrohg/Documents/Claude/tenet-elementor/plugin \
         ~/Local\ Sites/your-site/app/public/wp-content/plugins/joist
   ```
4. Activate (this runs the 8 migrations + registers the `joist_agent` role):
   ```bash
   wp --path=~/Local\ Sites/your-site/app/public plugin activate joist
   # ...or just activate it in WP Admin → Plugins
   ```
5. Generate an Application Password: WP Admin → Users → Profile → Application Passwords.

**New installs default to operating mode `observer`** — every write returns `dry_run: true` and persists nothing. That's the 30-day trial-mode design. To do real writes, set mode to `live`:
```bash
curl -u "USER:APP_PWD" -X POST "$WP_URL/wp-json/joist/v1/site/operating-mode" \
     -H 'Content-Type: application/json' -d '{"mode":"live"}'
```
(The acceptance test does this for you.)

## Testing

### `tests/manual/acceptance.sh` — the full v0.5 suite

~80 assertions exercising the entire surface: health (incl. a real write test), sessions, page CRUD, all 8 patch ops, OCC hash-mismatch (409 + recovery_suggestions), schema-validation rejection with Levenshtein suggestion, revisions + atomic restore, kit + match-color, PolicyGuard kit-zero-colors refusal (403), SEO read/write, webhooks register/rotate/delete, Theme Builder templates, hash-chained audit log, Plan Mode (create → approve → execute → completed), operating mode (observer forces dry_run), and the chained-singleton trigger (6th unplanned op → 423).

Requires `curl` + `jq` (`brew install jq`). Doesn't need WP-CLI.

```bash
WP_URL="http://your-site.local" \
JOIST_USER="admin" \
JOIST_APP_PWD="xxxx xxxx xxxx xxxx xxxx xxxx" \
bash tests/manual/acceptance.sh
```

Useful env vars: `JOIST_VERBOSE=1` (print full responses), `JOIST_KEEP=1` (don't trash the test pages — needed for the manual round-trip step below).

**First run will surface plugin bugs** — this code was written against the spec without a live WP. Expect failures; fix them in `src/`, re-run. The `GET /health` real-write-test is the single most informative check — if that passes, the core spine works.

### `tests/manual/smoke.sh` — 30-second quick check

A minimal create-a-page-and-read-it-back script, predates the full suite. Still works as a sanity check.

### The manual round-trip step (the proof)

Run with `JOIST_KEEP=1`, then in your browser:
1. Open the `edit_url` the test prints for the last test page.
2. Edit a widget in the Elementor UI, save.
3. `curl GET /pages/{id}` — the hash will differ from the test's last write, and `last_modifier.actor_type` will be `human`.
4. That's round-trip detection working — the agent's next write would see the mismatch and re-read instead of clobbering. No "the AI deleted my work" failure mode.

## Requirements

- WordPress 6.5+
- PHP 8.0+
- Elementor 3.18.0+ (3.21.0 is the tested target)

## License

GPL-2.0-or-later. See `/LICENSE` (TBD — repo currently doesn't ship a LICENSE file; add one for v0.5).

## Source of truth

Full API spec: `/specs/PLUGIN_API.md`
Architecture spec: `/specs/ARCHITECTURE.md`
Hardening notes (v1): `/specs/HARDENING_v1.md`
