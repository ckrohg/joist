# WordPress Site Access Patterns

Comparative reference of eight access patterns an AI agent (or Joist) can use to read and modify a WordPress + Elementor site. For each: what it can do, what it can't, auth, latency, risk, concrete commands, and when it's right or wrong. Decision matrix at the end.

---

## 1. WordPress REST API (Custom Routes via Joist)

**Pattern:** HTTP POST/GET/PUT/DELETE against `https://example.com/wp-json/joist/v1/*` (and Joist's MCP namespace `joist-mcp/v1/messages`).

**Can do:**
- Read/write `_elementor_data` via `GET /pages/{id}` + `POST /pages/{id}/patch`.
- Create/list/delete/restore versions of pages.
- Query site metadata (theme, plugins, WP version) via `GET /site`.
- Trigger plan-based edits with approval workflow.
- Per-tool capability enforcement, async CSS regen + cache flush deferred to scheduled events.

**Can't do:**
- Write arbitrary post meta outside the Elementor schema.
- Execute WP-CLI commands or PHP.
- Direct filesystem operations (upload plugin zips, read source).
- Bypass Joist operating modes (observer/quiet/kill prevent writes even with valid auth).
- Modify WordPress core or `.htaccess`.

**Auth:**
- Application Password (Basic Auth over HTTPS only).
- Minimum capability: `read` (reads) or `edit_pages` (writes).
- `X-Joist-Session-Id` header required for writes (session tracking).

**Latency/scale:** 200–800ms per write (sync ~200ms; CSS regen + cache flush async). Rate-limited via token bucket; 429 with `Retry-After`. Safe for concurrent requests (OCC hash checks). Large pages (5000+ elements) return 202 optimistically.

**Risk:** **Low.** All writes schema-validated; revisions snapshot before each write; hash-chain audit log; cannot break WP core or sidestep WP capability system. HTTPS enforced (constraint #20).

**Example:**
```bash
# Get page tree
curl -X GET https://example.com/wp-json/joist/v1/pages/42?include=elements \
  --basic --user agent@example.com:appPassword \
  -H "X-Joist-Session-Id: session_abc"

# Patch with surgical ops
curl -X POST https://example.com/wp-json/joist/v1/pages/42/patch \
  --basic --user agent@example.com:appPassword \
  -H "X-Joist-Session-Id: session_abc" \
  -H "Content-Type: application/json" \
  -d '{"expected_hash":"abc...","ops":[{"op":"update_settings","element_id":"xyz","settings":{"content":"New"}}]}'
```

**Right when:** Joist is installed; you need round-trip editability; multi-actor concurrency; async I/O acceptable; audit + rollback required.

**Wrong when:** Need to touch wp-config.php / core files; need WP-CLI; need to bypass schema; host has REST blocked and can't allowlist; sub-ms latency required.

---

## 2. MCP (Model Context Protocol) via Joist

**Pattern:** Claude Code (or any MCP client) connects to `https://example.com/wp-json/joist-mcp/v1/messages` over Streamable HTTP.

**Can do:** Call tools — `joist_list_pages`, `joist_get_page_tree`, `joist_create_plan`, `joist_approve_plan`, `joist_execute_plan`, `joist_clone_url`, `joist_introspect_atomic_schema`, `joist_smoke_test_roundtrip`. Thin wrapper on the REST API with native tool calling + per-tool capability checks.

**Can't do:** Anything not registered in `MCP/Tools.php`. Joist's MCP is synchronous request/response — no server-initiated push.

**Auth:** Application Password (same as REST). Must be logged-in WP user. Per-tool capability lives in `MCP\Tools::requireCap`.

**Latency:** Same as REST (thin wrapper).

**Risk:** Identical to REST.

**Right when:** Using Claude Code / Cursor / Continue; want native tool-use looping; want the model to see recovery suggestions.

**Wrong when:** Not using an MCP client; need tools not yet registered (add them to `Tools.php`).

---

## 3. WP-CLI Local (Same Container as WordPress)

**Pattern:** Run `wp` commands directly in the WP container: `wp post list`, `wp option get`, `wp elementor`, `wp eval-file`.

**Can do:** Read/write any WP table; run `wp elementor kit import/export`, CSS regen; bulk operations (`wp post list | xargs ...`); arbitrary PHP via `wp eval`. No rate limits, no HTTPS overhead.

**Can't do:** Be called remotely without SSH; bypass WordPress hooks (they fire); fix things that aren't in WP's data layer.

**Auth:** Shell access to the server. Runs as web server user (www-data).

**Latency:** Very fast (local process). Bulk reads of 100k posts in seconds.

**Risk:** **High if careless.** Bypasses REST's permission model entirely. Can delete tables, corrupt DB, no automatic audit trail.

**Example:**
```bash
wp post list --post_type=page --meta_key=_elementor_edit_mode --format=ids | \
  xargs -I {} wp elementor regenerate-css {}

# Dangerous — bypasses validation
wp eval 'echo get_option("joist_rate_limits");'
```

**Right when:** Have shell (VPS, managed WP with SSH); bulk operations REST is too slow for; debugging a broken site; migrating Elementor data locally.

**Wrong when:** No shell (shared hosting); operating remote sites from CI without SSH plumbing; need audit/rollback; agent doesn't know which commands are safe.

---

## 4. WP-CLI via SSH (Remote)

**Pattern:** `ssh deploy@server 'wp post list ...'` from CI/CD or agent.

**Can do:** Everything WP-CLI can; orchestrate multi-site bulk operations; CI/CD deployment-time setup; work on private staging with no DNS/HTTPS.

**Can't do:** Work without SSH (most shared hosts deny it); achieve zero latency (~200–500ms per call); be secure without careful key rotation.

**Auth:** SSH key pair (Ed25519). SSH enabled on host (SG/Kinsta/WP Engine offer it). Firewall allowance for agent IP.

**Latency:** SSH handshake + command ~200–500ms. Slow for high-frequency loops; good for batch.

**Risk:** Same as local WP-CLI plus SSH key exposure. Keys in CI must be short-lived or rotated.

**Example (CI):**
```yaml
- name: Regen CSS on deploy
  run: |
    ssh -i ~/.ssh/deploy_key deploy@example.com \
      'cd /var/www/html && wp elementor regenerate-css'
```

**Right when:** Have SSH; doing deployment-time setup or bulk migrations; integrating with CI/CD; want to skip REST auth overhead for infrequent ops.

**Wrong when:** Need real-time high-frequency edits; can't control the key; need audit trail; agent shouldn't have server shell access (REST + Application Password is least-privilege safer).

---

## 5. SFTP / Direct File Access

**Pattern:** Connect via SFTP (or FTP — avoid) to read/write files: plugins, themes, wp-content/uploads, wp-config.php.

**Can do:** Upload/download plugin + theme files; read wp-content/uploads (media backups); inspect wp-config / .htaccess / nginx; read compiled Elementor CSS (`wp-content/uploads/elementor/css/post-{id}.css` or `wp-content/cache/elementor/`); upload Joist plugin zip directly to `wp-content/plugins/`; full-site backup.

**Can't do:** Execute code; trigger WordPress hooks; query the DB; have wp-config edits take effect without restart.

**Auth:** SFTP key pair (most hosts provide SFTP even when denying SSH). Stored in OS credential manager.

**Latency:** Slow (TCP handshake + per-file round-trip). Good for one-time uploads / inspections, bad for high-frequency loops.

**Risk:** **Very high.** Means you can upload arbitrary code. No WP permission model. No audit trail on FS writes. Easy to delete production files.

**Example:**
```bash
sftp -i ~/.ssh/sftp_key deploy@example.com
> put joist.zip /var/www/html/wp-content/plugins/
> get /var/www/html/wp-content/uploads/elementor/css/post-42.css -
```

**Right when:** Initial plugin upload (one-time setup); inspect compiled CSS / config / logs; full-site backup; debugging server-side issues.

**Wrong when:** Frequent edits (REST is faster + safer); automated loops; no human oversight; should be edits-via-git.

---

## 6. Direct Database Access (MySQL / phpMyAdmin)

**Pattern:** Direct SQL against the WP database.

**Can do:** Read/write any table; bulk SQL; inspect Joist's custom tables (`wp_joist_audit_log`, `wp_joist_revisions`, etc.); recover deleted posts before purge.

**Can't do:** Execute PHP or trigger hooks; flush caches (those are code-side); regenerate Elementor CSS; respect WP filters.

**Auth:** MySQL user + password (usually localhost-only). Some hosts expose phpMyAdmin.

**Latency:** Fast for bulk; depends on network if remote.

**Risk:** **Extreme.** No WP permission model. No audit trail. Easy to corrupt `_elementor_data` JSON by direct meta updates and brick the editor. No rollback without backups.

**Example:**
```sql
-- Read raw _elementor_data
SELECT meta_value FROM wp_postmeta WHERE post_id=42 AND meta_key='_elementor_data' \G

-- Dangerous: bypasses WordPress filters
UPDATE wp_posts SET post_title='New' WHERE ID=42;

-- Inspect Joist's audit log
SELECT * FROM wp_joist_audit_log ORDER BY created_at DESC LIMIT 10;
```

**Right when:** Emergency recovery; analyzing schema or Joist internals; one-time migration script (carefully tested in staging); bulk SELECT for analytics.

**Wrong when:** Routine edits; production automation; you don't understand WP serialization; need CSS regen or cache flush.

---

## 7. Rendered HTML Scraping + Vision

**Pattern:** `curl https://example.com/page` → strip scripts/styles → feed to Claude vision → get back an Elementor plan.

**Can do:** Introspect public Elementor page design without admin access. Understand layout, colors, fonts, spacing from rendered output. Clone competitor designs. Works on any public Elementor site.

**Can't do:** Read `_elementor_data` JSON (not in the rendered HTML). Modify anything (read-only). Understand exact widget structure (skin values, repeater counts). Access private/unpublished pages.

**Auth:** None for public pages. Optional cookies for member content.

**Latency:** Network (~100–500ms) + vision API (2–10s).

**Risk:** **Very low** for reading. SSRF risk on untrusted input URLs (Joist guards via SSRF check).

**Example:**
```bash
curl -X POST https://yoursite.com/wp-json/joist/v1/plans/clone-from-url \
  --basic --user agent:password \
  -H "Content-Type: application/json" \
  -d '{"url":"https://competitor.com/page","intent":"clone this design"}'
```

**Fidelity:** ~75% per Joist's stated target. Loses animations, hover states, custom CSS details, exact spacing.

**Right when:** Cloning a published competitor; no admin access to target; inspiration generation; can tolerate ~25% fidelity loss.

**Wrong when:** Need to modify the source; need exact Elementor structure; page behind login; need 100% fidelity.

---

## 8. WordPress.com REST / Jetpack

**Pattern:** `https://public-api.wordpress.com/rest/v1.1/sites/...` with OAuth token.

**Can do:** Read/write posts and pages on WordPress.com sites; query media + menus; access WordPress.com-hosted Jetpack features.

**Can't do:** Access Elementor pages (WordPress.com doesn't allow Elementor by default). Install custom plugins. Introspect `_elementor_data`.

**Auth:** WordPress.com OAuth token. Business plan required for full API access.

**Right when:** Operating a WordPress.com site (no Elementor — use block editor).

**Wrong when:** Self-hosted WP + Elementor (use Joist REST).

---

## Decision Matrix

| Task | Best Pattern | Alternatives | Reasoning |
|---|---|---|---|
| Agent edits Elementor page (live) | REST API / MCP | — | Round-trip + schema + audit + rollback |
| Agent inspects Elementor tree | REST API (`GET /pages/{id}`) | Scrape + vision (lower fidelity) | Direct, complete |
| Clone competitor design | Scrape + vision (`/plans/clone-from-url`) | Screenshot → vision | URL scrape avoids headless browser |
| Bulk CSS regeneration | WP-CLI local/SSH | REST (slower) | WP-CLI faster for bulk |
| Initial plugin upload | SFTP | — | One-time, straightforward |
| Inspect compiled CSS | SFTP read or WP-CLI | DB query | Simpler than postmeta wrangling |
| Migrate Elementor data between sites | WP-CLI kit export/import | DB dump | Fast + safe; DB is nuclear |
| Debug broken site | Direct DB / WP-CLI | SSH + logs | DB for corruption, WP-CLI to reset options |
| Emergency rollback | Joist revision restore | DB restore | Purpose-built |
| Audit who edited what | Joist audit log | DB query | Purpose-built |
| Operate on private page | REST API (with creds) | WP-CLI local | REST respects WP caps |
| Zero-auth introspection (public) | Scrape + vision | — | Only option |

---

## Introspecting a Third-Party Elementor Page

**With admin access — full fidelity:**
```bash
curl -X GET https://site.com/wp-json/joist/v1/pages/42?include=elements \
  --basic --user admin:appPassword
```
Returns exact `_elementor_data` JSON.

**Without admin — ~75% fidelity via Joist scrape:**
```bash
curl -X POST https://yoursite.com/wp-json/joist/v1/plans/clone-from-url \
  --basic --user agent:appPassword \
  -d '{"url":"https://target.com/page","intent":"clone hero"}'
```

**Without admin — ~80% fidelity via screenshots:**
```bash
curl -X POST https://yoursite.com/wp-json/joist/v1/plans/clone-from-screenshots \
  --basic --user agent:appPassword \
  -F "images[]=@page-shot1.png" \
  -F "images[]=@page-shot2.png"
```
Higher than HTML scrape because color/spacing are visible.

**Without admin — direct vision via WebFetch + agent-as-generator (proved working 2026-05-31):**
1. Agent fetches public HTML
2. Agent authors V3 plan (using `knowledge/ELEMENTOR_V3_WIDGET_REFERENCE.md` to know the control surface)
3. Submit via Joist MCP `joist_create_plan` → approve → execute

The third path makes the plugin Anthropic key irrelevant — the agent brings its own LLM.

---

## Credential Storage

- **REST App Passwords:** OS Keychain / libsecret / DPAPI. Never plaintext. Rotate freely (no code changes).
- **SSH keys:** ssh-agent. Rotate per deployment or quarterly. Never in git.
- **SFTP keys:** Same as SSH.
- **DB credentials:** Localhost-only; `.my.cnf` or env. Never hardcoded.

---

## Summary: Joist's Stance

Joist standardizes on **REST + MCP** for agent-driven changes because:

1. **Round-trip editability** — change, verify, inspect, iterate.
2. **Schema validation** — every write checked against widget schemas.
3. **Concurrency-safe** — OCC hash checks prevent lost updates.
4. **Async I/O** — large ops backgrounded; fast responses.
5. **Audit trail** — actor + before/after hashes per write.
6. **Rollback** — per-write revisions.
7. **Least privilege** — agent role has minimal capabilities.
8. **Host-resilient** — auto-detects SG/Kinsta/WPE and adapts.

**Joist delegates elsewhere when:**
- URL cloning → scrape public HTML + Claude vision.
- Bulk operations → WP-CLI via SSH (deployment-time).
- Debugging → direct DB / WP-CLI (rare, with human oversight).
