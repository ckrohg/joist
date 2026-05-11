# Hardening Pass v1 — Synthesis of Red-Team Critiques

**Date:** 2026-05-10. **Inputs:** five independent critiques (Elementor specialist, WP plugin engineer, security engineer, Webflow-tier competitor, Marcus the agency user). **Output:** a decisions-and-deltas document that maps every meaningful finding to its disposition (fix-in-v1 / fix-in-v1.5 / fix-in-v2 / accept-the-tradeoff).

This document is **canonical** for what changed and why. PLUGIN_API.md and ARCHITECTURE.md are updated in lockstep — read this for the *reasoning*, read those for the *current truth*.

---

## 1. Convergent themes (where ≥2 critiques agreed)

### 1.1 The `/ai/*` endpoints cannot live in the PHP plugin
**Identified by:** WP plugin engineer (review blocker), security review (cost-exhaustion vector + key storage).
**Decision:** All AI generation (copy, headline, image, schema) lives in the Node MCP server with user-provided keys. The PHP plugin exposes no `/ai/*` endpoints. PLUGIN_API.md §19.5 and §19.6 are rewritten as MCP-server-side capabilities, not REST endpoints.
**v1 target.**

### 1.2 The agent's Editor-role default is too much capability
**Identified by:** Security review (blast radius), WP plugin engineer (privilege minimization).
**Decision:** Custom `joist_agent` role with: `edit_pages`, `edit_others_pages`, `publish_pages`, `read`, custom `joist_use_agent_api`. `upload_files` only when image-gen enabled. NEVER `unfiltered_html`. Admin-role escalation requires explicit user confirmation in the CLI with a warning.
**v1 target.**

### 1.3 Plan Mode is bypassable via chained singleton patches
**Identified by:** Security review (#4), competitor red-team (Plan Mode is one-shot, not real).
**Decision:** Define **destructive threshold** — Plan required if cumulative ops in session > M (default 5), OR any single call contains `delete`/`unwrap`/full-replace, OR cumulative ops on same page > K (default 10). Single-op patches under threshold still pass; threshold tracked server-side per session.
**v1 target.**

### 1.4 The Elementor data-model gaps are the "messes up formatting" risks
**Identified by:** Elementor specialist (Top 5 risks), competitor red-team (brand drift).
**Decision:** Eight v1 additions to the spec — see §3 of this document. All fixable inside SchemaValidator / PatchEngine / WidgetCatalog. The spine doesn't move.
**v1 target.**

### 1.5 No real bulk/fleet support kills the agency segment entirely
**Identified by:** Marcus (the agency user), competitor red-team (distribution).
**Decision:** Bring `joist connect --config sites.yaml` forward to v1 OSS CLI. SaaS multi-site dashboard remains v2, but the bulk-onboard primitive is v1. Without this, the agency thesis fails.
**v1 target.**

### 1.6 The wp-admin Plan Review surface drags the UX into "WP plugin uncanny valley"
**Identified by:** Competitor red-team (Webflow-craft concern), Marcus implicitly (designer team can't drive).
**Decision:** For v1, embrace wp-admin's strengths (dense, fast, utilitarian) and don't pretend it's Webflow. Build the Plan Review page with `@wordpress/components` (accessible by default, matches WP chrome). v2 SaaS ships a standalone hosted approval surface at `approve.<brand>.dev/pln_...` for users who want the polished version. State this tradeoff in NARRATIVE.md.
**v1 accepts the tradeoff. v2 fixes.**

### 1.7 No live diff preview, no iteration loop, no "more bold" affordance
**Identified by:** Competitor red-team (multiple).
**Decision:** v1 ships `POST /preview/render` returning a sandboxed iframe URL + CSS-diff JSON. v1 also ships `GET /pages/{id}/iteration-context` returning recent plans + accept/reject status + reasons. Per-step plan approval and plan forking are v1.5.
**v1 partial (preview + iteration context); v1.5 (per-step approval, fork).**

### 1.8 Multisite (network) is silently unhandled
**Identified by:** WP plugin engineer.
**Decision:** Multisite supported from v1. `wpmu_new_blog` hook runs per-site migrations. `$wpdb->prefix` discipline (not `base_prefix`). Network-admin settings page. ~10% of plugin installs are multisite — non-trivial.
**v1 target.**

### 1.9 PHP 8.1 minimum cuts off ~25% of the install base
**Identified by:** WP plugin engineer.
**Decision:** Drop to PHP 8.0 minimum. Rewrite the 8.1-only bits (readonly props → private + getter, `never` returns → docblock). Lose enums-on-arrays, keep enums (which are 8.1) → use class constants where needed.
**v1 target.**

### 1.10 No security audit, no support channel, no maintainer SLA
**Identified by:** Marcus.
**Decision:** Before v1.0 wp.org submission: (a) third-party security audit (engage a WP-specialist firm; budget $5–15k); (b) Discord channel established with at least one weekly office-hour; (c) README states "best-effort, business-hours US, 48h critical bug triage" SLA; (d) "what survives if maintainer disappears" paragraph (plugin is GPL, schema validator is self-contained, here's how to fork).
**v1 target.**

---

## 2. Spec deltas by file

### 2.1 PLUGIN_API.md changes

| Section | Change | Source critique |
|---|---|---|
| §1 design principles | Add #9 *async-by-default* + #10 *refuse-list independent of caps* | WP eng, security |
| §2 conventions | Add HTTPS enforcement (`is_ssl()` check, 421 on plain HTTP); note App Password storage strategy (Keychain/libsecret/DPAPI delegated to Claude Code) | Security |
| §3 error contract | Every error envelope adds `recovery_suggestions: [{op, args}]`; SKILL.md mandates narrate-and-propose | Competitor red-team |
| §4 site | `GET /site` adds `elementor.layout_mode: containers_only \| sections_only \| mixed` + `elementor.bot_crawl_logging_enabled` | Elementor specialist |
| §6 pages | New §6.5 container-vs-section policy; §6.6 responsive-controls protocol; §6.7 custom-CSS-blocks; §6.8 global-refs preferred; §6.9 inner-element handling; §6.10 deep-ID regen rules; §6.11 chained-singleton plan trigger; §6.12 observer/dry-only mode flag | Elementor + security |
| §7 elements | Note that `tree-summary` is the default for `GET /pages/{id}`; full tree requires `?include=elements` | Performance / WP eng |
| §8 widget catalog | Schema returns `breakpoints[]`, `supports_globals: bool`, `skins[]` per control. New `POST /widgets/validate` enforces all three. | Elementor |
| §9 globals | `PUT /kit` triggers global+page+kit CSS regen. New `POST /kit/match-color` (delta-E nearest global). | Elementor |
| §11 media | URL-mode upload tightened: https only, public-IP only, max-redirect 0, banned schemes, MIME-sniff post-download, size cap pre-download (HEAD then GET). | Security |
| §13 plugins | `POST /plugins/install` with `zip_url` requires `JOIST_ALLOW_ARBITRARY_ZIP` constant in `wp-config.php` (default false). v1 restricts to wp.org slugs. | Security |
| §15 webhooks | URL validated at registration AND each emission (DNS rebinding); circuit breaker after failure_count > 10; HMAC dual-secret rotation. | Security |
| §16 health | Doctor performs real write test, not just config flags. Surfaces specific Wordfence/iThemes/SG rule IDs to fix. | WP eng + Marcus |
| §17 MCP | Tool surface includes `elementor_iteration_context`, `elementor_preview_render`, `elementor_match_color`, `elementor_list_dynamic_tags` | Competitor + Elementor |
| §19 ext. capabilities | Major rewrite — see §3 of this doc for new and changed subsections | All five |
| **NEW §23** | Fleet & bulk operations (`POST /agents/bulk-connect`, `GET /agents/fleet-status`) | Marcus |
| **NEW §24** | Operating modes — observer / quiet / kill-switch / staging-mandatory | Marcus |
| **NEW §25** | Client-facing reports (`GET /audit-log?format=html&period=last-month`) | Marcus |
| **NEW §26** | Rate limiting (token bucket per session) | Security |
| **NEW §27** | PolicyGuard refuse-list (deny ops independent of caps) | Security |
| **NEW §28** | Dynamic tags catalog + validation (`GET /dynamic-tags`) | Elementor |
| **NEW §29** | GDPR / DSR endpoints (`wp_privacy_personal_data_exporter`, eraser registration; retention settings) | Security + WP eng |
| **NEW §30** | Live preview rendering (`POST /preview/render` → sandboxed iframe + CSS-diff JSON) | Competitor |
| **NEW §31** | Iteration context (`GET /pages/{id}/iteration-context`) | Competitor |
| §20 failure-mode constraints | Add #17 through #30 — see §4 of this doc | All five |
| §21 output quality | Add concrete performance budget numbers; tighten image-source policy | Competitor + Elementor |

### 2.2 ARCHITECTURE.md changes

| Section | Change | Source critique |
|---|---|---|
| §3 (3 deliverables) | Add hosted "approval surface" (v2, optional standalone for paid tier) | Competitor |
| §3 (PHP min) | Drop 8.1 → 8.0 | WP eng |
| §3 (admin UI) | Use `wp.element` + `@wordpress/components`, NOT custom React/shadcn. Bundler: `@wordpress/scripts` for compatibility with Gutenberg | WP eng |
| §4 DocumentWriter spine | Add async-by-default contract: CSS regen + cache flush + frontend verify → scheduled via `wp_schedule_single_event(time() + 1, ...)`; method returns optimistically; webhook fires on completion. NEVER inline `wp_remote_*` calls. | WP eng |
| §4 DocumentWriter spine | Add chained-singleton detection: `SessionTracker::recordOp()` increments per-session counter; `PolicyGuard::requirePlan()` throws 423 once threshold hit | Security + competitor |
| §5 class catalog | NEW `PolicyGuard` (refuse-list, chained-singleton enforcement) | Security |
| §5 class catalog | NEW `RateLimiter` (token-bucket at ControllerBase) | Security |
| §5 class catalog | NEW `URLValidator` (SSRF defense for /media url + /webhooks) | Security |
| §5 class catalog | NEW `DynamicTagValidator` (validates `__dynamic__` references) | Elementor |
| §5 class catalog | NEW `CustomCSSBlockManager` (TENET:BEGIN/END markers, merge preserving) | Elementor |
| §5 class catalog | NEW `GlobalRefPreferrer` (prefers __globals__ over literal values where match) | Elementor |
| §5 class catalog | NEW `ContainerModeAdapter` (autodetect + cross-mode refusal) | Elementor |
| §5 class catalog | NEW `PrivacyExporter` / `PrivacyEraser` (WP DSR filter registration) | WP eng + security |
| §5 class catalog | NEW `Logger.redact()` chokepoint for credentials/keys | Security |
| §5 class catalog | NEW `OperatingMode` (observer / quiet / kill-switch / staging-only enforcement at ControllerBase) | Marcus |
| §5 SchemaValidator | Extend with: `validateResponsiveCompleteness()`, `validateSkinAware()`, `validateInnerFlag()`, `validateGlobalsPreferred()`, `validateDynamicTagsResolve()` | Elementor |
| §5 IDGenerator | Add `regenerateTree($subtree, deep: bool)` default `true` for duplicate/wrap | Elementor |
| §5 LockManager | Replace transient-backed locks with custom `wp_joist_locks` table (autoload=no, validated post_id) | WP eng + security |
| §5 CSSRegenerator | Add `Global_CSS::create()->update()`, `Custom_CSS::create()->update()`, `Manager` flush, `_elementor_element_cache` + `_elementor_inline_svg` clearance | Elementor |
| §6 DB schema | Replace all ENUM columns with VARCHAR(16) + CHECK or app-level validation. Add `$wpdb->get_charset_collate()` to every CREATE TABLE. | WP eng |
| §6 DB schema | NEW `wp_joist_locks` table replacing transient locks | WP eng + security |
| §6 DB schema | `wp_joist_audit` adds `chain_hash CHAR(64)` for hash-chained tamper detection | Security |
| §6 DB schema | `wp_joist_plans` adds `approval_token CHAR(64) NOT NULL` (32-byte random) alongside ULID id | Security |
| §6 DB schema | `db_version` option, idempotent migrations, last-success tracking, admin-notice on failure | WP eng |
| §7 MCP wiring | Tool list explicitly under 80 tools; parameterized over specialized — confirmed | WP eng |
| §8 MCP server | NEW `OperatingMode` client-side enforcement before any write call | Marcus |
| §8 MCP server | Anthropic key storage delegates to Claude Code's credential manager (Keychain/libsecret/DPAPI) — NEVER plaintext in `.mcp.json` | Security |
| §8 MCP server | NEW `errors.ts` enriches every plugin error response with `recovery_suggestions[]` based on error code class | Competitor |
| §10 CLI | NEW `connect --config sites.yaml` for bulk fleet onboarding | Marcus |
| §10 CLI | NEW `doctor` performs real write test on staging URL, surfaces specific host-adapter recommendations | WP eng + Marcus |
| §11 Plan Mode flow | Sequence updated: approval URL contains separate `approval_token`; CSRF nonce on Approve button; approver-binding (same user who created session OR designated approvers) | Security |
| **NEW §17** | Multisite handling (`wpmu_new_blog`, per-site migrations, network-admin settings, `$wpdb->prefix` discipline) | WP eng |
| **NEW §18** | Async I/O discipline (full inventory of deferred operations, what runs sync vs async) | WP eng |
| **NEW §19** | Custom `joist_agent` role definition + capability whitelist | Security |
| **NEW §20** | Host adapter matrix (SiteGround GrowBig/GoGeek+, Kinsta, WPE, Cloudways, Local) with specific behaviors per host | Marcus + WP eng |
| **NEW §21** | Cache adapter matrix (SG Optimizer, WP Rocket, LiteSpeed, W3TC, WP Super Cache, WPE native, Cloudflare APO) | WP eng |
| **NEW §22** | CDN flusher interface (Cloudflare, BunnyCDN; encrypted token storage in options) | WP eng |

### 2.3 README.md changes

- Move "Status: pre-v0.1 — no code yet" callout to immediately under the H1 — currently buried (Marcus's record-scratch).
- Add **Support** section: Discord URL placeholder, 48h critical-bug SLA, "what survives if maintainer disappears" paragraph.
- Add **Staging recommended** advisory under Quickstart.
- Add **Recommended for** section: "Solo Elementor builders and small studios. Multi-site agencies should wait for v2 SaaS for the bulk dashboard." Honest framing — not everyone is the target customer in v1.

### 2.4 ROADMAP.md changes

- Move bulk-fleet CLI from v2 SaaS into v1 (now a prerequisite for v1.0 ship).
- Add v1.0 milestones: third-party security audit, Discord channel setup, cost-per-task benchmark publication.
- Add v1.0 explicit deliverable: "SiteGround GrowBig compat matrix document with falsifiable claims per host plan."
- Move standalone hosted approval surface to v2 (was implicit in v1 design — now explicit deferral).

### 2.5 BRAND_BRIEF.md changes

- Add "Marcus quote" as audience confirmation — agency user persona is right, the spec needs to talk to him.
- Tighten visual direction with new constraint: typography choices must work in dense WP-admin chrome (Editorial New display may not — verify in mockup before committing).

---

## 3. New PLUGIN_API.md subsections — content draft

### §6.5 Container vs section policy

`GET /site` includes:
```json
"elementor": {
  "layout_mode": "containers_only" | "sections_only" | "mixed",
  "layout_mode_confidence": 0.95
}
```

Autodetect runs nightly: sample N pages, classify root elements, set the mode. `mixed` if both styles present.

`POST /pages/{id}/patch` with `op: insert`:
- If parent's `elType` is `section` or `column` → inserted child must be `widget` (in column) or `section`/`column` (legacy hierarchy).
- If parent's `elType` is `container` → inserted child must be `container` or `widget`.
- Cross-mode (`container` as sibling of `section` at root) requires `force: true` in the patch body AND a Plan-Mode approval. Default refusal returns 422 `layout.cross_mode_refused`.

When agent must add a hero to a `sections_only` site, the helper `POST /elementor/legacy-builder/section-with-column` creates the wrapping section + column + widget tree.

### §6.6 Responsive controls protocol

`GET /widgets/{type}/schema` extends each control with:
```json
{
  "name": "align",
  "type": "CHOOSE",
  "responsive": true,
  "breakpoints": ["desktop", "tablet", "mobile"]
}
```

Suffixed keys: `align_tablet`, `align_mobile`. Custom kit breakpoints (set via `viewport_md`, `viewport_lg`, `widescreen`, etc.) reflected here.

Default policy on write: when desktop value differs from control default, plugin populates `_tablet` and `_mobile` equal to desktop unless the patch op carries `responsive: "explicit"` (agent claims it has covered breakpoints intentionally).

Validation warning `validation.responsive_incomplete` returned in the success response when desktop is set, breakpoints support tablet/mobile, and either is missing — agent may proceed but is informed.

### §6.7 Custom CSS blocks

The `custom_css` setting on widgets/containers is parsed into named blocks:
```css
/* TENET:BEGIN tag=hero_fade_in */
.elementor-element-abc12345 { transition: opacity .3s ease; }
/* TENET:END */

/* TENET:BEGIN tag=user_override */
/* human-written */
/* TENET:END */
```

Read response includes:
```json
{
  "custom_css_blocks": [
    {"tag": "hero_fade_in", "actor": "agent", "session_id": "ses_..."},
    {"tag": "user_override", "actor": "human", "user_id": 5}
  ]
}
```

`update_settings` op accepts `custom_css_block: {tag, css}` instead of raw `custom_css`. Plugin merges into the existing value, replacing the named block, preserving all others. Unnamed CSS is preserved as a block tagged `legacy` and never overwritten by the agent.

### §6.8 Global references preferred

`GET /widgets/{type}/schema` extends color/typography controls with `supports_globals: true`.

`POST /pages/{id}/patch` with `op: update_settings`:
- If `settings.title_color: "#6334EB"` is supplied AND the value matches a kit global (delta-E < 5), plugin auto-rewrites to `settings.__globals__.title_color = "globals/colors/primary?id=primary"` and returns `transformations: ["color_to_global"]` in response.
- Agent can suppress with `prefer_literals: true` in the patch body (rare).

New `POST /kit/match-color`:
```json
{"hex": "#6334EB"}
→ {"global_ref": "globals/colors/primary?id=primary", "delta_e": 2.1}
```

### §6.9 Inner-element handling

`PatchEngine::insert` with `parent.elType: "column"` (legacy) auto-sets `isInner: true` on inserted `section` children.

`PatchEngine::insert` with `parent.elType: "container"` and inserted `container` child auto-sets `isInner: true` on the inserted container if its `flex_direction` differs from the parent.

`SchemaValidator::validateInnerFlag` rejects (`schema.inner_flag_mismatch` 422):
- `elType: section, isInner: false` whose ancestor includes a `column`
- `elType: container, isInner: false` nested inside another container

### §6.10 Deep ID regeneration

`IDGenerator::regenerateTree($subtree, deep: bool = true)`:
- `op: duplicate` → deep regen of entire subtree (every nested ID gets a fresh 8-hex value).
- `op: wrap` → deep regen.
- `op: move` → IDs preserved (move doesn't fork).
- `op: insert` → IDs assigned only where omitted (agent may pre-supply, but new IDs validated for uniqueness against the existing tree).

Response includes `generated_ids: {temp-1 → real-8hex, temp-2 → real-8hex, ...}` for every replacement.

### §6.11 Chained-singleton plan trigger

`SessionTracker::recordOp()` increments per-session counters:
- `ops_total`
- `ops_destructive` (count of `delete`, `unwrap`, full-replace)
- `ops_per_page[$page_id]`

`PolicyGuard::checkPlanRequired($session_id, $proposed_op)` throws 423 `policy.plan_required` if any:
- proposed op is `delete`/`unwrap`/full-replace AND session has not been associated with an approved plan
- `ops_total > 5` since last approved plan
- `ops_per_page[$page_id] > 10` since last approved plan

Configurable thresholds via `joist_plan_thresholds` option.

### §6.12 Observer / dry-only mode

Per-site option `joist_operating_mode`:
- `live` (default for v1.0+ once user opts in)
- `observer` — all writes return 200 with `dry_run: true` automatically applied; nothing persisted; webhook fires `plan.would_have` event for offline review. Default for new installs in v1.0.
- `quiet` — writes refused for N minutes (`quiet_until` timestamp); returns 423 `operating_mode.quiet`.
- `kill_switch` — all REST writes refused indefinitely; returns 423 `operating_mode.killed`.

Mode togglable in WP admin (one click). Kill switch surfaced to all admin users + visible to clients (separate from "agent disabled" UI in case a client wants to flip it themselves).

Marcus's "I'd run it in observer mode for 30 days before allowing writes" use case is the primary motivation.

### New §23 Fleet & bulk operations

CLI:
```bash
$ joist connect --config sites.yaml
# sites.yaml format:
# - url: https://client1.com
#   admin_user: marcus
#   admin_app_password: "xxxx xxxx xxxx xxxx xxxx xxxx"
#   operating_mode: observer
#   brand_kit: ./kits/client1.json
# - url: https://client2.com
#   ...
```

CLI flow per site is identical to single-site but parallelized with concurrency cap.

`GET /fleet/status` (when configured as a fleet client locally — doesn't require SaaS):
```json
{
  "sites": [
    {"url": "https://client1.com", "health": "ok", "operating_mode": "observer", "open_plans": 0, "last_activity": "..."},
    ...
  ]
}
```

`POST /fleet/broadcast-brand-kit`:
```json
{
  "site_urls": ["https://client1.com", ...],
  "brand_kit_patch": {"voice": {...}, "anti_refs": [...]},
  "dry_run": true
}
```

Applies a brand-kit patch to N sites; dry-run by default; returns per-site diff.

### New §24 Operating modes

See §6.12 above. Plus:

`POST /site/operating-mode`:
```json
{"mode": "observer" | "live" | "quiet" | "kill_switch", "duration_minutes": 30 /* for quiet */}
→ {"mode": "...", "expires_at": "..."}
```

Plugin renders mode in:
- WP admin top-bar badge (visible to all admins).
- Elementor editor canvas badge (if `kill_switch` or `quiet`).
- Health check (`GET /health` reports current mode).
- Webhook `operating_mode.changed` event.

`joist_staging_mandatory` site option — when true, REST writes refused unless request `Origin` header matches a configured staging URL pattern. v1 includes this; users can opt in per site.

### New §25 Client-facing reports

`GET /audit-log?format=html&period=2026-04` returns rendered HTML report (printable, brand-styled) summarizing:
- AI edits vs human edits (count, percentage)
- Pages affected
- Plain-language intent per AI edit
- Cost summary if cost-tracking enabled
- Designed for client deliverable (PDF export via headless Chrome in MCP server)

Also `GET /audit-log?format=csv` for spreadsheet workflows.

`?format=json` remains the default for agent consumption.

### New §28 Dynamic tags catalog

`GET /dynamic-tags`:
```json
{
  "tags": [
    {"name": "post-title", "label": "Post Title", "category": "post", "plugin_source": "elementor-pro"},
    {"name": "acf-text", "label": "ACF Text", "category": "acf", "plugin_source": "acf"},
    {"name": "jet-cct-field", "label": "JetEngine Field", "category": "jet-engine", "plugin_source": "jet-engine"}
  ]
}
```

`POST /pages/{id}/patch` with a `__dynamic__` reference to an unregistered tag → 422 `dynamic_tag.unknown` with list of available tags whose name fuzzy-matches.

SchemaValidator runs DynamicTagValidator on every write that touches a `__dynamic__` key.

### New §30 Live preview render

`POST /preview/render`:
```json
{
  "page_id": 123,
  "prospective_elements": [/* element tree the agent wants to evaluate */],
  "viewport": "desktop" | "tablet" | "mobile",
  "include_css_diff": true
}
→ {
  "preview_url": "https://example.com/?joist_preview=tok_...",
  "preview_token": "tok_...",
  "expires_at": "...",
  "css_diff": [/* changed CSS rules with selectors + before/after */]
}
```

The preview URL serves a one-shot rendered page derived from the prospective elements WITHOUT mutating `_elementor_data`. Token-scoped, expires in 30 min, requires same App Password.

Implementation: copy current `_elementor_data`, apply patch in-memory, write to a transient post (`joist_preview_*` post type), render via Elementor's frontend handler with the transient post as context. Cleanup cron after expiry.

Used by the v1 Plan Review UI for side-by-side before/after.

### New §31 Iteration context

`GET /pages/{id}/iteration-context`:
```json
{
  "recent_plans": [
    {"plan_id": "pln_...", "intent": "Build hero", "status": "completed", "satisfaction_signal": "accepted_no_followup"},
    {"plan_id": "pln_...", "intent": "Try a different headline", "status": "rejected", "rejection_note": "too generic"}
  ],
  "recent_human_edits": [
    {"user_id": 5, "summary": "Changed primary color", "timestamp": "..."}
  ],
  "open_backlog": [/* items in joist_backlog table */],
  "brand_kit_version": "kit_v_..."
}
```

Lets the agent re-load conversational state without re-RAGing the audit log every turn.

---

## 4. New failure-mode constraints — extending §20

These are appended to PLUGIN_API.md §20 as constraints #17 through #30. Each maps to a specific finding in a critique:

| # | Constraint | Source |
|---|---|---|
| 17 | **Async-by-default for I/O.** No `wp_remote_*` calls or filesystem ops inside REST controller hot path. Defer via `wp_schedule_single_event` or `shutdown` hook. `DocumentWriter::save()` returns optimistically; CSS regen + cache flush + frontend verify run async; webhook fires on completion. *(Kills synchronous-timeout failures on large pages and shared hosts.)* | WP eng |
| 18 | **PolicyGuard refusals independent of capabilities.** Hardcoded deny-list of operations the agent role can never perform regardless of WP capabilities granted: `DELETE /pages/{id}?force=true`, `POST /plugins/install` with `zip_url` outside an admin-initiated session with the `JOIST_ALLOW_ARBITRARY_ZIP` constant, `PUT /kit` with all-zero color palette, `DELETE` on a page where `is_front_page()` AND `status: publish`. *(Kills accidental destructive ops; defense against jailbroken agents.)* | Security |
| 19 | **Chained-singleton ops force Plan Mode.** Cumulative ops/session > 5, OR cumulative ops/page > 10, OR any single op of `delete`/`unwrap`/full-replace → 423 `policy.plan_required` until a Plan Mode plan is approved. *(Kills the Plan Mode bypass via N back-to-back single-op patches.)* | Security + competitor |
| 20 | **HTTPS-only.** Every REST controller checks `is_ssl()`; returns 421 `transport.https_required` over plain HTTP. *(Kills passive credential interception on misconfigured hosts.)* | Security |
| 21 | **SSRF defense on every URL input.** `POST /media` (url mode) and `POST /webhooks`: scheme whitelist (`https:` only), public-IP-only resolution check (deny RFC1918 / loopback / link-local / cloud-metadata), re-resolve on connect (DNS rebinding), max-redirect 0, timeout 5s, banned schemes explicitly enumerated. *(Kills SSRF to internal services + cloud-metadata exfil.)* | Security |
| 22 | **Custom locks table.** Per-page locks live in `wp_joist_locks` (custom table) with validated `post_id`, explicit TTL column, daily prune cron. NOT in transients. *(Kills wp_options autoload bloat on hosts without persistent object cache.)* | WP eng + security |
| 23 | **Container-mode matching.** Plugin autodetects layout mode (`containers_only` / `sections_only` / `mixed`). Cross-mode inserts refused without `force: true` and Plan Mode approval. *(Kills the legacy-site formatting break where agent inserts container as sibling of section at root.)* | Elementor |
| 24 | **Responsive-completeness default.** When desktop control value differs from default, plugin auto-populates `_tablet` and `_mobile` equal to desktop unless `responsive: "explicit"` set in patch op. *(Kills the "looks fine on desktop, broken on mobile" failure mode that would otherwise occur on every responsive control the agent touches.)* | Elementor |
| 25 | **Dynamic tag references must resolve.** Every `__dynamic__` reference validated against the live registered-tags registry; 422 on unregistered. *(Kills silent blank-content failures from dangling dynamic tag refs.)* | Elementor |
| 26 | **Global refs preferred over literals.** Agent writing a color/font literal that matches a kit global (delta-E < 5) auto-rewritten to a global ref. Agent may suppress with `prefer_literals: true`. *(Kills brand drift where literal hex values don't respond to kit recolors.)* | Elementor |
| 27 | **Inner-flag inference.** `PatchEngine::insert` auto-sets `isInner: true` based on parent context; SchemaValidator rejects mismatches. *(Kills the "Elementor editor refuses to load" failure mode from wrong isInner.)* | Elementor |
| 28 | **Deep ID regen on duplicate/wrap.** `IDGenerator::regenerateTree(deep: true)` is the default for `duplicate` and `wrap`. *(Kills nested-ID collisions that break custom CSS selectors, anchor links, scroll targets.)* | Elementor |
| 29 | **Skin-aware schema validation.** `GET /widgets/{type}/schema` returns per-skin control sets for skin-bearing widgets (Loop Grid, Posts, Portfolio, Archive Posts). Settings validated against the selected `_skin`'s schema, not the default. *(Kills the "looks broken because settings were validated against the wrong skin" failure mode.)* | Elementor |
| 30 | **Hash-chained audit log.** Each row's `chain_hash = sha256(prev_row.chain_hash || row_payload_hash)`. Tamper detection even when an attacker with DB access deletes rows. *(Kills silent audit-log erasure by attackers with admin access.)* | Security |

---

## 5. Tradeoffs accepted (deliberate non-goals)

Items raised by critiques that we **explicitly defer or refuse** for v1:

| Item | Source | Decision | Why |
|---|---|---|---|
| Standalone hosted Plan Review approval surface | Competitor red-team | v2 SaaS | Building a hosted control plane is the v2 product. v1 ships wp-admin Plan Review using `@wordpress/components` — accepts the UX tradeoff, documents it honestly. |
| Per-step plan approval, plan forking, plan branching | Competitor red-team | v1.5 | The basic plan + atomic execution is enough discipline for v1. Multi-step UX is real product work; not blocking. |
| Visual-diff screenshots (pixel-delta human-review) | Marcus | v1.5 | Requires headless Chrome in MCP server. Defer. v1 ships CSS-diff JSON which is enough for the React Plan Review to render inline diff. |
| Real-time collaborative presence (different from locks) | Competitor red-team | v2 SaaS | Requires WebSocket infrastructure or polling. Not v1 OSS scope. v1 has locks for exclusion. |
| AI-edit canvas badge in Elementor editor itself | Marcus | v1.5 | Requires Elementor editor JS extension point — investigate feasibility. Audit log + revision tags are v1 substitute. |
| Multi-stakeholder direction artifact above plans | Competitor red-team | v2 SaaS | The plan-with-intent is sufficient discipline for v1 solo-builder + small-studio use. Multi-stakeholder coordination is agency-tier. |
| Site graph / coherence scoring | Competitor red-team | v2 SaaS | Cross-page consistency is real but not v1-blocking. Plan Mode prevents the worst drift; v2 adds proactive detection. |
| Live cost meter UI in chat | Competitor red-team | v1.5 | v1 ships session-level cost tracking + per-task estimates in plans. Live-during-execution meter is polish. |
| Curated starter kit gallery | Competitor red-team | v1.5 | v1 ships Kit `.zip` import; curating + hosting starter kits is content work that follows the product launch. |
| Static HTML export | WP eng + Marcus | v1.5 | Kit `.zip` + WXR + Elementor template JSON are v1. Full static HTML export is bigger engineering work. |
| Hosted approval surface for paid tier | Competitor red-team | v2 SaaS | The bet is wp-admin Plan Review is "good enough" for v1 OSS. v2 SaaS upgrades. |
| Multi-site management dashboard | Marcus | v2 SaaS | Bulk-fleet CLI in v1 OSS is the substitute. Web dashboard is the paid upgrade. |

---

## 6. Open questions requiring user decision

These are decisions I cannot make unilaterally. They affect v1 scope.

1. **Third-party security audit budget + vendor.** $5–15k range. Recommendation: schedule for week -3 in the v1 timeline (post-feature-complete, pre-wp.org-submission). User to approve budget + select vendor (WP Tavern can recommend specialists; Wordfence offers paid audits).

2. **PHP minimum: 8.0 vs 7.4.** Spec says 8.0. PHP 7.4 EOL was Nov 2022 but still ~10% of installs. WordPress core supports it. If we want maximum reach, drop to 7.4 (significant rewrite — no readonly props, no enums-as-class, no `match`, no `never` returns). I recommend sticking at 8.0 and accepting the ~10% gap, but the call is yours.

3. **Hosted preview rendering** (the `POST /preview/render` endpoint) requires temporary post creation + cleanup cron. Adds DB load. Default ON or OPT-IN? Recommendation: ON by default, configurable.

4. **Discord vs GitHub Discussions vs both.** Discord is what agency users expect; GitHub Discussions is where OSS contributors are. Recommendation: ship both. Discord for support, Discussions for technical/contributor talk.

5. **Cost-tracking telemetry.** Per-session token tracking lives in the MCP server (Node), but to power the client-facing reports (§25), the plugin needs to record cost-per-plan. That's per-site data. Should it phone home anywhere? Recommendation: NO — strictly local to each site. v2 SaaS could opt-in aggregate.

---

## 7. Updated roadmap

The v1.0 ship date moves out by 2-3 weeks to absorb the hardening + bulk CLI + security audit. New phase plan:

- **v0.1** (1–2 days) — M0 spike unchanged.
- **v0.5** (4–6 weeks) — full §1–§22 API + 30 failure-mode constraints + multisite + custom role + PolicyGuard + async I/O.
- **v0.7** (NEW, 2 weeks) — bulk fleet CLI, observer/quiet/kill-switch modes, client changelog export, Discord channel live.
- **v0.9** (8–12 weeks) — Plan Mode end-to-end + anti-slop AI gen + SiteGround tested + preview render + iteration context.
- **v0.95** (NEW, 1 week) — third-party security audit + remediation pass.
- **v1.0** (14–16 weeks) — wp.org submission with all of the above.

The OSS phase is no longer 12 weeks. It's 14–16. **Take the time. The thing that ships first is the thing that ships forever.**

---

## 8. What's BAKED IN that critiques validated

Three of the four critiques independently called out the things we got *right* that competitors miss. Worth preserving as we extend:

1. **`Document::save()` as the only write path** + `update_post_meta('_elementor_data', …)` grep-banned in CI. Marcus called this "the right answer." Webflow critic called this "the kind of discipline that takes competitors a year of bug reports to discover."

2. **Live schema introspection + Levenshtein-1 + flex_*-aware suggestions.** The Elementor specialist confirmed this is "structurally hard to copy without doing it right from day one." Don't compromise it.

3. **§21 anti-slop taste constraints, codified.** Webflow critic: "a real differentiator that compounds … a recruiting magnet for designers and a marketing wedge no one else can credibly claim." Marcus: "the first AI tool pitch I've read in a year that doesn't read like ChatGPT wrote it."

These three compound. Every hardening change in this document should *strengthen* them, not dilute them.

---

## Next actions (ordered)

1. Apply this doc's §2 deltas to PLUGIN_API.md and ARCHITECTURE.md. (Critical — propagates from this synthesis doc to canonical specs.)
2. Update §20 of PLUGIN_API.md with constraints #17–#30. (Already drafted in §4 above; mechanical paste.)
3. Update README.md per §2.3. (Quick — status + support + recommended-for.)
4. Update ROADMAP.md per §2.4. (Quick — v0.7, v0.95 added.)
5. User decides §6 open questions.
6. Brand decision still pending (name, palette, type) — separate track, doesn't block hardening.
7. Begin v0.1 M0 spike (orthogonal to all of the above — proves the loop).
