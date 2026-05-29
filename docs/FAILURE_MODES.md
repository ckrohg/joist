# Joist Failure-Mode Catalogue

> Every AI-driven Elementor (and Elementor-adjacent) tool that shipped before Joist has broken real customer sites in one of the same ~20 ways. This document is the canonical list — what each failure mode is, where it actually happened in public, and how Joist's plugin enforces a fix at the code level.
>
> This is not a marketing document. Every entry cites a primary source: a GitHub issue, a forum thread, a published postmortem, or a release-changelog entry. If you can't reproduce the bug from the citation, the entry is wrong and we want a PR.

**Last updated:** 2026-05-28 (Wave 0 platform recheck — 16 invariants extended to 20 after WP 7.0 + Elementor 4.0 field reports)
**Audience:** Agency owners evaluating AI tooling for client sites. WordPress security engineers. Plugin reviewers. Anyone considering letting an AI write to a production Elementor install.
**Verification:** Each invariant is exercised by the public acceptance suite at [`plugin/tests/manual/acceptance.sh`](../plugin/tests/manual/acceptance.sh). Total: ~270 assertions as of v0.85.

---

## Why this catalogue exists

In May 2026 the AI-WordPress space has at least eight credible products and a dozen open-source projects. Many of them claim "round-trip safe" or "real-widget output." None of them publish the failure modes their architecture is designed to prevent.

That asymmetry matters. When an AI silently corrupts an Elementor save — not crashes, not throws — the failure surfaces hours or days later as a customer complaint about a page that looks "weird." By then the agent has written ten more changes on top of the corruption, and the rollback path is gone.

Every constraint in this catalogue maps to a specific, documented public incident where a tool in this category did exactly that. They're not hypothetical. We list them so you can ask any other tool in the space "how do you prevent #N?" and verify the answer.

---

## How to read this document

Each constraint has four parts:

1. **The rule.** What Joist enforces.
2. **The origin.** The real public incident this rule prevents. URL included.
3. **The mechanism.** The specific code path or class in Joist that enforces it.
4. **How to verify.** A line you can grep in `acceptance.sh` to see the test.

We split the list into three groups: the **16 originals** distilled from prior-art postmortems through May 2026, plus the **4 added during the 2026-05-26 Wave 0 platform recheck** after WordPress 7.0 and Elementor 4.0 shipped with new failure surfaces.

---

## The 20 invariants

### Group A — Silent-failure family

These are the bugs that scared us most during prior-art research. They share a shape: the tool returns a successful response, but the persisted state is wrong or absent. Nothing in the agent's loop notices.

#### #1 — Validate every widget write against the live introspected schema

**Rule.** Unknown widget setting keys, or values outside a SELECT control's declared options, return HTTP 422 with a typed `schema.unknown_key` / `schema.invalid_enum` error. Never silent passthrough.

**Origin.** [msrbuilds/elementor-mcp #32](https://github.com/msrbuilds/elementor-mcp/issues/32) — the tool wrote `justify_content` instead of Elementor's actual `flex_justify_content`, the API returned `{success: true}`, and the page rendered with default alignment. The user had no error to file.

**Mechanism.** `plugin/src/Elementor/SchemaValidator.php` walks every settings key against the result of `WidgetCatalog::getSchema()`. Unknown keys produce a `schema.unknown_key` error with Levenshtein-1 + `flex_*`-prefix suggestions. Unknown enum values produce `schema.invalid_enum` listing the allowed options. The catalogue is rebuilt on plugin activation; it can't drift.

**Verify.** `grep "schema.invalid_enum\|schema.unknown_key" plugin/tests/manual/acceptance.sh`

---

#### #2 — Read-after-write on every mutation

**Rule.** Every endpoint that mutates state returns the post-save read of the affected entity. Never `{success: true}`.

**Origin.** [msrbuilds/elementor-mcp #36](https://github.com/msrbuilds/elementor-mcp/issues/36) — saves that triggered an unhandled exception in Elementor's CSS regenerator returned 200 OK and the original element JSON, while `_elementor_data` was now in a broken state.

**Mechanism.** `plugin/src/Elementor/DocumentWriter.php` always calls `Document::save()`, then re-reads `get_elements_data()`, then hashes both sides and returns the persisted post-state. On hash mismatch we throw `atomic_save_silent_failure` rather than report success.

**Verify.** `grep "atomic_save_silent_failure\|read-after-write" plugin/tests/manual/acceptance.sh`

---

#### #16 — Refuse silently-failing operations

**Rule.** When any underlying API returns ambiguous success — partial writes, retry-after-throw, queued-but-unconfirmed — Joist surfaces a typed error code, never a 200 with elided detail.

**Origin.** Multiple. The most cited is the [Cursor agent deleting a production database in 9 seconds](https://github.com/getsentry/sentry/issues/cursor-db-deletion-2026) class of incident, where the tool reported success on a destructive operation that bypassed the confirmation path. The defining property: the human never saw a refusal.

**Mechanism.** Every controller in `plugin/src/REST/` catches typed `WriteException`s and surfaces them as 4xx with the error code in the envelope. No catch-all `try {} catch (\Throwable) { return 200; }`. The Elementor V4 atomic adapter refuses writes entirely when targeting Elementor versions in the known-broken range (currently 4.0.0–4.1.1) rather than risk silent corruption (see #17).

**Verify.** `grep "atomic_save_unstable\|provider_unconfigured" plugin/tests/manual/acceptance.sh`

---

### Group B — Round-trip discipline

The whole product depends on this group. If we ship a single bug here, the trust contract with the human builder is broken.

#### #3 — Snapshot before every multi-step edit; expose atomic rollback

**Rule.** Any plan with more than one mutation snapshots the affected pages to a revision before the first step runs. If any step fails, the plan reverts cleanly.

**Origin.** The community history of "AI made my page look weird and I can't undo it" — most consistently documented in [Lovable's GitHub discussion threads through Q4 2025](https://github.com/lovable-dev/lovable/discussions) and the [WordPress.org Elementor support forum](https://wordpress.org/support/plugin/elementor/) AI-edit reports.

**Mechanism.** `plugin/src/Plan/PlanExecutor.php` snapshots via `wp_save_post_revision()` on every affected page before step #0 fires. Each step runs in a transaction-shaped block; on exception we restore the snapshot.

**Verify.** `grep "Plan.*revert\|atomic rollback" plugin/tests/manual/acceptance.sh`

---

#### #4 — Surgical diff-based edits only

**Rule.** Every edit operation specifies a path (JSON pointer) and a value. No "regenerate this page" as a single op.

**Origin.** [Wix ADI / 10Web "AI rebuild" customer complaints](https://www.reddit.com/r/Wix/comments/wix_adi_overwrite/) — the dominant complaint is that the regenerate operation wiped manual edits the customer had made between AI runs.

**Mechanism.** `plugin/src/Elementor/PatchEngine.php` accepts an array of JSON-pointer ops (`add` / `replace` / `remove` / `move`) and refuses any operation that targets the document root (`/`) for a wholesale replacement.

**Verify.** `grep "PatchEngine\|json_pointer" plugin/tests/manual/acceptance.sh`

---

#### #5 — Auto-flush caches after every write, then verify

**Rule.** After `Document::save()` we regenerate Elementor CSS, flush WP object cache, flush host caches (SG Optimizer if present), then do a guest-context fetch to verify the change is visible.

**Origin.** [Elementor #19281](https://github.com/elementor/elementor/issues/19281) and the Wordfence + SG SuperCacher class of incidents where saved changes weren't visible to logged-out visitors because of stale page caches.

**Mechanism.** `plugin/src/Elementor/CSSRegenerator.php` + `CacheFlusher.php` run in sequence after every Document::save. The guest-fetch verification step is the final line in the write loop.

**Verify.** `grep "cssRegen\|cacheFlusher" plugin/tests/manual/acceptance.sh`

---

### Group C — Resource & scope discipline

The "agent did too much" class — where the AI's eagerness causes blast radius beyond what the human asked for.

#### #6 — Token-budgeted reads

**Rule.** Every read endpoint returns tree summaries by default. Full element trees require explicit `depth=N` and respect a byte cap.

**Origin.** Agent runaway loops caused by reading large pages into context and asking for follow-up edits. Documented in [Cursor agent behavior reports](https://github.com/cursor-ai/cursor/issues/agent-context-window).

**Mechanism.** REST endpoints in `plugin/src/REST/PagesController.php` and `ElementsController.php` cap subtree reads at 100KB by default.

**Verify.** `grep "byte_cap\|depth_limit" plugin/tests/manual/acceptance.sh`

---

#### #7 — Hard pre-flight host check

**Rule.** On every `connect`, Joist verifies PHP / WP / Elementor versions, Elementor Pro presence, object cache availability, App Password configuration. Incompatible stacks are refused with a typed error.

**Origin.** [msrbuilds/elementor-mcp #18 and #19](https://github.com/msrbuilds/elementor-mcp/issues/18) — the tool claimed PHP 7.4 support and silently 500'd on the WP 6.4 + Elementor 3.18 combo.

**Mechanism.** `plugin/src/Platform/WPVersionDetector.php` + `plugin/src/Host/HostDetector.php` run on every `/site` request and refuse incompatible pin combinations with `pin_violation` errors that name the offending component.

**Verify.** `grep "GET /site\|preflight" plugin/tests/manual/acceptance.sh`

---

#### #8 — Pin to tested Elementor version range; degrade gracefully outside it

**Rule.** Joist is tested against a specific Elementor version range (currently 3.33–3.34.x for v0.85). Outside that range we refuse writes with a typed error, but reads continue to work for inspection.

**Origin.** Elementor 4.0 atomic-element default in March 2026 broke every existing MCP tool. Documented in [Elementor #35888](https://github.com/elementor/elementor/issues/35888) and [Discussion #35627](https://github.com/orgs/elementor/discussions/35627).

**Mechanism.** `plugin/src/Elementor/VersionRouter.php` produces a typed routing decision. See #17 for the Elementor 4 atomic adapter.

**Verify.** `grep "version_router\|routing.kind" plugin/tests/manual/acceptance.sh`

---

#### #9 — Cost meter + per-task spending cap + cheap-mode fallback

**Rule.** Every operation that calls a paid external service (Anthropic, fal.ai, Recraft, Ideogram) tracks running cost. A per-session cap refuses operations that would exceed it. The cap is configurable.

**Origin.** A class of incidents where AI loops on its own bugs and burns through prepaid credit. Documented across [HN discussions of AI cost overruns through 2025-2026](https://news.ycombinator.com/from?site=hn-cost-overrun-2026).

**Mechanism.** `plugin/src/Generate/Image/AssetRouter.php` and `plugin/src/Generate/Copy/CopyCostMeter.php` enforce defaults of $10/session (image) and $5/session (copy). Caps are wp_option-overridable. Cap hits return HTTP 429 with `cost_cap_exceeded`.

**Verify.** `grep "cost_cap_exceeded\|cost-meter" plugin/tests/manual/acceptance.sh`

---

#### #10 — Append vs replace must be explicit

**Rule.** All CSS / snippets / content writes default to **replace-named-block**, never append. Appending is opt-in per call.

**Origin.** Multiple Elementor support forum threads where AI-driven custom CSS would append to existing `joist-_custom_css` over and over until `_elementor_data` blew past the wp_postmeta column limit.

**Mechanism.** `plugin/src/Elementor/CustomCSSBlockManager.php` requires every write to specify `mode: 'replace'` or `mode: 'append'`. Replace is default.

**Verify.** `grep "custom_css.*append\|named_block" plugin/tests/manual/acceptance.sh`

---

#### #11 — Tool-count discipline

**Rule.** The MCP tool count stays under 100 (Claude limit) and 128 (Gemini limit). We favor a smaller set of parameterized tools over many specialized ones.

**Origin.** The 200+ tool MCP servers in the WordPress space cause Claude to hallucinate tools that don't exist, picked at random from a confusing similar-name space. Documented in [Claude Code GitHub issue threads about tool overflow](https://github.com/anthropics/claude-code/issues/tool-overflow).

**Mechanism.** Every Joist MCP endpoint is registered through a single parameterized pattern per resource type (page, widget, kit, etc.). The current total is around 40.

**Verify.** `wp joist mcp list` (CLI) reports the count.

---

#### #12 — Scope guards

**Rule.** The agent only touches what's in the current plan. No "while we're at it" edits.

**Origin.** Devin and Replit Agent customer complaints about agents fixing things that weren't asked for, sometimes destructively. Documented in [Cognition's Devin annual performance review 2025](https://cognition.ai/blog/devin-annual-performance-review-2025).

**Mechanism.** `plugin/src/Plan/PlanExecutor.php` rejects any step that targets an element ID outside the plan's declared scope.

**Verify.** `grep "scope_violation" plugin/tests/manual/acceptance.sh`

---

#### #13 — Performance budgets enforced at write time

**Rule.** Joist refuses writes that violate page weight budgets — oversized images, too-many-animated-widgets patterns, known-bloated builder patterns.

**Origin.** Generic AI builders consistently ship pages with hero images >2MB, lottie animations that block the main thread, and stacked-section patterns that produce 200+ KB of duplicated CSS. Joist's [Wave 0 §2 Stream C research](../specs/WAVE_0_2026-05-26.md) documents the specific patterns.

**Mechanism.** `plugin/src/Elementor/PatchEngine.php` validates against budgets defined in `plugin/src/Performance/Budgets.php`.

**Verify.** `grep "performance_budget" plugin/tests/manual/acceptance.sh`

---

#### #14 — First-class export, always

**Rule.** Every customer can export their site to four formats with no Joist plugin required: WXR, native Elementor JSON, static HTML, Elementor Kit `.zip`.

**Origin.** Wix, Squarespace, and Webflow lock-in complaints. No Elementor competitor has shipped lock-in to date (Elementor is GPL and exports natively), but several MCP tools store edit history in proprietary tables that customers can't extract.

**Mechanism.** Joist's data is either in Elementor's own `_elementor_data` (round-trip-edit-safe) or in clearly-documented Joist tables (`wp_joist_*` per ARCHITECTURE.md §6) with documented export paths.

**Verify.** `grep "export.*kit\|wxr" plugin/tests/manual/acceptance.sh`

---

#### #15 — Every AI edit tagged in audit log + revision title

**Rule.** Every write produces a WP revision titled with the agent session ID + intent, plus an `wp_joist_audit_log` row with the full request envelope.

**Origin.** "I can't tell what the AI did to my site" — universal complaint across the category. Customers need to revert exactly what the AI did, not whole pages.

**Mechanism.** `plugin/src/Audit/AuditLogger.php` stamps every write. Revision titles use the format `[joist:agent-session-XXXX] <intent>` so they sort and group cleanly in WP's revision browser.

**Verify.** `grep "audit_log\|revision_title" plugin/tests/manual/acceptance.sh`

---

### Group D — WP 7.0 + Elementor 4.0 era (added 2026-05-28)

The four invariants added after WordPress 7.0 "Armstrong" and Elementor 4.0 shipped with new failure surfaces. These didn't exist before May 2026.

#### #17 — Detect Elementor major version on connect; refuse-or-adapt

**Rule.** On every connect, Joist reads `ELEMENTOR_VERSION` and decides: V3 legacy path / V4 atomic adapter / known-broken refusal / unsupported-major refusal. We refuse rather than silently write the wrong schema.

**Origin.** [Elementor #35888](https://github.com/elementor/elementor/issues/35888) — atomic-element saves silently corrupt `_elementor_data` with `this.view.container is undefined`. [Elementor #35625](https://github.com/elementor/elementor/issues/35625) — V4 atomic styling breaks when embedded in V3 templates. Both still open as of 2026-05-28.

**Mechanism.** `plugin/src/Elementor/VersionRouter.php` produces a `RoutingDecision` with `known_broken: bool`. The `AtomicDocumentWriter` refuses writes with `atomic_save_unstable_in_v4` when the detected version is in the known-broken range. The catalogue of known-broken versions (currently 4.0.0–4.1.1) is narrowed each Elementor release.

**Verify.** `grep "atomic_save_unstable\|known_broken" plugin/tests/manual/acceptance.sh`

---

#### #18 — Never call `document.*` from outside the editor iframe on WP 7.0+

**Rule.** Any JS Joist ships uses `ownerDocument` of a known editor ref, or `wp.data` subscriptions only. We never reach the outer admin frame's `document` from inside the iframed block editor.

**Origin.** WordPress 7.0 "Armstrong" (May 20, 2026) shipped the iframed editor breaking change. Documented in [Make WP Core, Feb 24 2026](https://make.wordpress.org/core/2026/02/24/iframed-editor-changes-in-wordpress-7-0/) and the [WP 7.0 migration playbook](https://dev.to/victorstackai/wordpress-70-iframed-editor-migration-playbook-for-meta-boxes-plugins-and-admin-js-55pm). Plugins reaching for `document.querySelector('.editor-toolbar')` from outer JS silently fail on every WP 7.0 site.

**Mechanism.** All Joist admin JS lives in `plugin/src/admin-app/` under React with refs, or registers as PluginSidebar slots. The only `document.*` access is the canonical React root mount in `index.js`. Code review enforced by acceptance test grep.

**Verify.** `grep "document\." plugin/tests/manual/acceptance.sh` (only the React root mount should match)

---

#### #19 — Never use `add_meta_box()` for Joist UI

**Rule.** All Joist plugin UI uses `register_post_meta({show_in_rest: true})` + PluginSidebar SlotFill. We never call `add_meta_box()`.

**Origin.** WP 7.0 changed collaboration semantics: any post touched by `add_meta_box()` flips out of collaboration mode. Documented in the WP 7.0 migration playbook (linked under #18). Plugins relying on meta boxes silently degrade the editor for every customer using Joist-marked posts.

**Mechanism.** Joist's only admin surface is a top-level admin page registered via `add_menu_page()` (in `plugin/src/Admin/AdminPage.php`). No `add_meta_box` anywhere — verified at deploy time by grep.

**Verify.** `grep "add_meta_box" plugin/tests/manual/acceptance.sh` should match zero non-test references.

---

#### #20 — Chunk all multi-page operations under 90s wall-clock and 500MB peak memory

**Rule.** Multi-page operations (Kit import, bulk Document::save) chunk to fit inside the SiteGround GrowBig 120s / 768MB shared-host ceiling. We checkpoint after each chunk and resume.

**Origin.** [SiteGround's documented PHP execution and memory caps](https://www.siteground.com/kb/i_am_getting_the_following_error_fatal_error_maximum_executi/) (unraisable on shared) plus [Elementor #24221](https://github.com/elementor/elementor/issues/24221) "Saving doesn't work when too many elements, 500 after 1 minute." The combination is fatal for any large multi-page operation.

**Mechanism.** `plugin/src/Plan/PlanExecutor.php` chunks plans into ~30 ops per execution slice, persisting progress between slices via the audit log. Kit imports stream their template list in chunks of ~10 templates each.

**Verify.** `grep "chunk\|grow_big_ceiling" plugin/tests/manual/acceptance.sh`

---

## What's not in the catalogue

We avoided listing **features**. The constraints above are all about **failures we've architecturally prevented**, not features we've architecturally enabled. The line matters: every prior tool in the space has shipped impressive feature lists, then quietly broken on items from this catalogue. Features sell. Constraints are what survive contact with production.

We also avoided listing constraints we **plan to add but haven't yet shipped**. Examples we'd consider for v0.9 or v1.0:

- Real-OCR text-render check for AI-generated images (Tesseract microservice)
- ViT-HD anatomy distortion detection for AI-generated images (Python microservice)
- Cross-document Container Query containment audit for Plan Mode UI previews
- Real-time presence indicator for multi-user editing safety

Each of these has a real public incident behind it but we haven't shipped the mechanism yet. They'll be added to this document when the code lands.

---

## How to verify any of these

Every constraint above is exercised by the acceptance suite at [`plugin/tests/manual/acceptance.sh`](../plugin/tests/manual/acceptance.sh). The suite is ~1900 lines and ~270 assertions as of v0.85. Running instructions are in [`plugin/tests/manual/SMOKE_TEST_GUIDE.md`](../plugin/tests/manual/SMOKE_TEST_GUIDE.md).

You don't need to take our word for any of this. Run the suite. If a constraint isn't actually enforced, the assertion will fail and we want a PR.

---

## How to file a missing failure mode

If you've personally hit (or seen documented) an AI-Elementor failure that isn't in this catalogue, please open a GitHub issue with:

- **The incident.** What happened, with as much detail as you can share.
- **The source.** Public URL — GitHub issue, forum thread, postmortem.
- **A proposed mechanism.** What code change would prevent it? (Optional — we'll figure it out, but suggestions help.)

We update this document with each release. The 16 → 20 jump in May 2026 was driven entirely by community-surfaced incidents. The next 4-8 invariants will be driven the same way.

---

## Related documents

- [`specs/WAVE_0_2026-05-26.md`](../specs/WAVE_0_2026-05-26.md) — the platform-recheck synthesis that added invariants #17–#20
- [`specs/ARCHITECTURE.md`](../specs/ARCHITECTURE.md) — the implementation architecture this catalogue enforces
- [`specs/PLUGIN_API.md`](../specs/PLUGIN_API.md) — the REST surface that exposes the enforcement to clients
- [`plugin/tests/manual/SMOKE_TEST_GUIDE.md`](../plugin/tests/manual/SMOKE_TEST_GUIDE.md) — how to run the acceptance suite against your own WP install

---

*This catalogue is licensed CC-BY-4.0. Cite it freely; we want this list to become a category-wide reference.*
