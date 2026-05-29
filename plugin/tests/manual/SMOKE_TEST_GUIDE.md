# SiteGround Smoke Test — Pre-Flight Checklist

**Status:** Wave 7 prep — verify all sections before running `acceptance.sh` against a real SiteGround GrowBig install.
**Acceptance suite:** 1851 lines, ~272+ assertions across 6 build waves of work.
**Realistic runtime:** 3–6 minutes if everything passes; 10–15 if many failures cascade.

This is the first time anything we've built touches a real WordPress install. Go slow. Triage rigorously. Every failure is information — the goal is a punch-list, not a green tick.

---

## 0. Why we're running this

We've shipped ~15,000 LOC across 5 commits this session covering: substrate (memory tool, Connectors API, Elementor V3/V4 adapter), widgets (4 polish improvements), Plan Mode UI (React on DataViews/DataForm), and brand pipeline (anti-slop validator + image gen clients + copy gen with prompt caching). None of it has touched a live WP install yet. The smoke test is the first reality check.

We're **not** trying to prove every feature works end-to-end. We're trying to:
1. Confirm the REST surface registers cleanly on a real WP
2. Confirm Document::save() round-trips don't break anything
3. Identify which `TODO(*-verify-on-live-install)` markers actually bite
4. Surface platform-specific issues (SiteGround ModSecurity, OPcache, PHP 8.2 edge cases)
5. Generate a triage punch-list for Wave 7 fixes

---

## 1. Verify the host environment

The Wave 0 Stream F research identified 10 high-likelihood failure modes for this exact stack. Before running anything, verify the environment matches our **failure-mode-aware pins**:

| Component | Target | Why |
|---|---|---|
| **WordPress** | **6.9.4** (skip 7.0 until 7.0.1) | iframed editor + meta-box collaboration changes too fresh; 6.9.2 had a stringable regression fixed in 6.9.3 |
| **Elementor (free)** | **3.33–3.34.x** | Post PHP 8.4 nullable fixes (3.32+); predates V4 atomic default; avoids broken atomic saves (#35888 / #35625) |
| **Elementor Pro** | **Matching core minor version exactly** | Issue #31588: Pro/core desync forces template resaves |
| **PHP** | **8.2.x** | 8.4 + Elementor 3.x = unreadable deprecation log flood |
| **MySQL** | 8.0+ or MariaDB 10.6+ | Standard WP 6.9 floor |
| **Theme** | Hello Elementor (latest) | Clean Elementor-only canvas; not Jupiter X |
| **mcp-adapter** | Commit SHA post-#177 (vendored) | Latest tag has open auth/transport issues |

**Quick verification (run in SiteGround SSH / Site Tools shell):**

```bash
wp core version              # expect 6.9.4
wp plugin list --format=table | grep -E "elementor|hello"
wp --info | grep "PHP version"
```

Any deviation = fix before running acceptance.sh, or expect cascading failures that mask real bugs.

---

## 2. SiteGround GrowBig specific gotchas (from Stream F research)

GrowBig has hard caps that bite our chunking discipline. Verify before running:

- **PHP execution time:** 120s hard cap (unraisable on shared). Our `failure-mode-constraints` #20 says chunk multi-page ops under 90s wall-clock.
- **PHP memory:** 768MB hard cap (unraisable on shared). #20 also caps peak at 500MB.
- **ModSecurity:** blocks REST endpoints with no rule visibility. Set a clearly-identified User-Agent (`Joist/0.5`) and prepare for 403/406/500 with retry-and-backoff.
- **SuperCacher / Dynamic Cache:** caches REST responses by default and can serve stale JSON. **Disable both for the smoke test** via SiteGround Site Tools → Speed → Caching.
- **OPcache:** stays hot across requests; our adapter could read stale class definitions if we update a class file mid-test. SiteGround has no flush UI — restart PHP-FPM via SSH if needed.

---

## 3. Install the plugin

You have two paths:

### A. Direct upload (recommended for smoke)

```bash
# On your local box
cd /Users/ckrohg/Documents/Claude/tenet-elementor
zip -r joist-smoke.zip plugin/ -x "plugin/node_modules/*" "plugin/build/*"

# Upload joist-smoke.zip via WP Admin → Plugins → Add New → Upload Plugin
# Activate
```

### B. SSH clone

```bash
cd ~/www/<sitepath>/public_html/wp-content/plugins
git clone <repo-url> joist
cd joist
git checkout main  # last commit should be 392925e
```

After install: **activate it via WP Admin** and watch for activation errors in `wp-content/debug.log`.

---

## 4. Build the Plan Mode UI bundle (optional but recommended)

Without this step, `AssetEnqueue` will log a debug notice and the Plan Mode page renders empty (the admin shell still works — verified by acceptance tests). To actually see the React UI:

```bash
cd plugin
npm install   # ~2-3 min; downloads @wordpress/scripts 30.x + WP packages
npm run build # ~30-60s; produces build/index.js + build/index.asset.php
```

The `build/` directory is `.gitignore`-d. If you skip this step, the Plan Mode admin page renders the H1 only — acceptance.sh test "Joist admin page does not contain a PHP fatal" still passes.

---

## 5. Create the agent user + Application Password

The acceptance suite hits `/wp-json/joist/v1/*` via HTTP Basic with an Application Password.

```
WP Admin → Users → Add New
  Username: joist-agent
  Email: (any)
  Role: Editor   (will tighten to joist_agent custom role in v0.9)
  Send notification: NO
```

Then:

```
WP Admin → Users → joist-agent → Application Passwords
  Application name: "Joist smoke test"
  Click "Add New Application Password"
  Copy the displayed value (4 groups of 4 chars, space-separated) — you only see it once
```

You now have `JOIST_USER=joist-agent` and `JOIST_APP_PWD=xxxx xxxx xxxx xxxx xxxx xxxx`.

---

## 6. Configure env vars and pre-run sanity check

```bash
# Replace the obvious placeholders
export WP_URL="https://your-site.com"
export JOIST_USER="joist-agent"
export JOIST_APP_PWD="xxxx xxxx xxxx xxxx xxxx xxxx"

# Optional: verify the REST surface answers before running the full suite
curl -fsS -u "$JOIST_USER:$JOIST_APP_PWD" "$WP_URL/wp-json/joist/v1/site" | jq '{
  status: .status,
  wp: .wordpress.version,
  elementor: .elementor.routing.kind,
  elementor_version: .elementor.routing.version,
  known_broken: .elementor.routing.known_broken,
  plugin_admin: .plugin.admin.menu_slug,
  connector_registered: .plugin.connector.registered
}'
```

**Expected output shape (broadly):**

```json
{
  "status": "ok",
  "wp": "6.9.4",
  "elementor": "legacy_v3",
  "elementor_version": "3.34.x",
  "known_broken": false,
  "plugin_admin": "joist-plan-mode",
  "connector_registered": false
}
```

Interpretation:
- `status: "ok"` — REST is up, auth works
- `elementor: "legacy_v3"` and `known_broken: false` — version router correctly identifies our pin
- `connector_registered: false` — expected on WP 6.x; would be `true` on 7.0+
- `plugin_admin: "joist-plan-mode"` — admin page registered

If `status` is missing or you get an HTTP error, fix that **before** running the full suite or you'll get 200+ false failures.

---

## 7. Run the acceptance suite

```bash
cd /Users/ckrohg/Documents/Claude/tenet-elementor
bash plugin/tests/manual/acceptance.sh 2>&1 | tee /tmp/joist-smoke-$(date +%Y%m%d-%H%M%S).log
```

**To leave test pages in place for manual round-trip verification, prepend `JOIST_KEEP=1`.**

**To run a slice** (one section), grep the section heading from `acceptance.sh` and copy/run that block manually. Useful for iterative triage.

---

## 8. What to expect

### Section roll-up (in order)

The suite is divided into sections. Each section announces itself with a colored header:

1. **Site + identity** — early gate; if this fails everything cascades
2. **Pre-flight host checks** — verifies pins + capabilities
3. **REST surface registration** — every controller's routes exist
4. **Pages + Document::save() round-trip** — the round-trip discipline test
5. **Widgets schema introspection** — including new Anchored Pop, ViewTransitions, DisplaySwap
6. **Patch engine + OCC** — concurrent-edit safety
7. **Responsive fill** (opt-in)
8. **HTTPS enforcement**
9. **Preference memory + Memory tool** (W2a substrate)
10. **Quality eval + rollup**
11. **Widget Pack** — Pin-Scroll registration + Chrome 145+ gate (W4d) + Anchored Pop (W4a) + ViewTransitions emitter (W4b) + Display-swap (W4c)
12. **Plan Mode admin app — foundation** (W5a) + **feature components** (W5b)
13. **Image generation** — cost meter + cap behavior (W6b)
14. *(Anti-slop + Copy gen sections — added by W6a/W6c)*

### Counts

- `PASS=N` running total at the bottom — target is ≥ 270 across all assertions
- `FAIL=N` — anything > 0 needs triage
- `SKIP=N` — gracefully expected for unconfigured providers (W6b/c default state) and endpoints that don't exist yet

### What "good first run" looks like

- 5–15 SKIPs (provider keys not set, /preview/render not implemented, lora endpoint never trained, etc.) — **these are not failures**
- 0–10 FAILs that are environment-shape mismatches (SiteGround returning extra headers, mod_security cleaning a request, etc.)
- 0 FAILs in the "round-trip" and "Document::save()" assertions (these are the load-bearing ones)

### What a real failure looks like

- A FAIL with "constraint #N violated" — these are load-bearing; we fix immediately
- A FAIL on `_elementor_data` round-trip — the round-trip discipline is the whole product; this is P0
- A FAIL on `Joist admin page HTML contains a PHP fatal/parse error string` — PHP fatal in production code path; P0
- A FAIL on `atomic_save_unstable_in_v4` refusal — Elementor 4 protection didn't fire correctly; P0

---

## 9. Triage rubric

When you hit FAILs, classify by these buckets:

| Bucket | Marker | Action |
|---|---|---|
| **P0: round-trip safety** | Document::save() / `_elementor_data` / OCC / atomic refusal | Stop the suite; file as blocker; fix before continuing |
| **P0: PHP fatal** | "Fatal error" / "Parse error" / 500 from admin page | Stop; fix before continuing |
| **P1: REST surface registration** | Endpoint exists but returns wrong shape | Surface as fix-up; continue suite |
| **P1: failure-mode constraint violation** | Anything that violates #1–#20 in `memory/failure_mode_constraints.md` | Fix-up task; continue suite |
| **P2: schema introspection edge case** | Specific widget schema field shape | Note in punch-list; defer if not blocking |
| **P2: SiteGround / host-specific** | mod_security false positive, OPcache staleness, etc. | Document workaround; not a code bug |
| **P3: skip-eligible** | Provider unconfigured, build/ missing | Expected; document in run notes |

---

## 10. Likely failure modes (from Wave 0 Stream F)

These were identified as the 10 most-likely-to-bite. Watch for them specifically:

1. **Elementor V4 atomic default-on with broken save** — guarded by our VersionRouter; should refuse with typed error, not silently corrupt
2. **V4 atomic styling does not survive embed in V3 templates** — should not fire on our 3.34.x pin, but watch for it
3. **WP 7.0 iframed editor breaks `document.querySelector`** — not applicable on WP 6.9.4 pin; verify
4. **Classic meta boxes disable collaboration in WP 7.0** — same; verify
5. **mcp-adapter open auth/transport bugs** (#195, #177, #172, #161) — if you see "MCP error -32000: Connection closed" or constant-redeclaration fatals, this is the culprit
6. **SiteGround ModSecurity blocks REST endpoints** with no rule visibility — set the User-Agent; contact SG support for endpoint whitelisting
7. **SiteGround GrowBig PHP execution ceiling = 120s, memory = 768MB** — multi-page tests must chunk
8. **PHP 8.4 deprecation flood** from Elementor + php-di — not applicable on PHP 8.2 pin; verify
9. **WP 6.9.x stringable-object regression** — 6.9.2 was the bad one; pin to 6.9.4+
10. **Elementor 3.26 "Schemes" removal still strands third-party addons** — fixed in 3.33+; verify

---

## 11. After the run

1. Save the full log: `/tmp/joist-smoke-*.log`
2. Filter to FAILs only:

```bash
grep -E "FAIL|✗" /tmp/joist-smoke-*.log | sort -u > /tmp/joist-fails.txt
```

3. Apply the triage rubric (§9) — bucket each FAIL
4. Share the bucketed punch-list back — that becomes Wave 7's fix-up task list
5. If `JOIST_KEEP=1` was set, you have a draft page to open in Elementor — manually verify round-trip per the test suite's tail instructions

**The goal isn't "zero failures on first run."** It's a clean punch-list of real issues, sorted by severity, with environment noise filtered out.

---

## 12. After we fix issues — re-run cadence

- Fix one bucket (P0 first); commit; re-run; see what's now passing
- Track delta between runs — `diff` the FAIL lists
- Iterate until P0 and P1 are clean
- Document the P2/P3 backlog
- Wave 7 is "complete" when P0 + P1 are zero on a clean re-run

---

## 13. After Wave 7 — what's left

Per the synthesis doc §9 dependency graph:

- **Wave 8** — Acceptance suite expansion + public-artifact pass (v1.0 gate). The failure-mode-constraints catalogue becomes a public doc; the acceptance suite gets published as a positioning artifact vs Novamira (who has no equivalent).
- **v0.95** — Third-party WP-specialist security audit + remediation
- **v1.0** — wp.org submission + public launch

The smoke test is the gate that lets us move from "engineering-believes-it-works" to "shown-to-work-on-a-real-WP".

---

## Sources

- `specs/WAVE_0_2026-05-26.md` §2 Stream F — the 10 likely failure modes (cited with sources)
- `memory/failure_mode_constraints.md` — the 20 non-negotiable invariants
- `memory/architecture_decisions.md` — the version pins + the rationale
- `plugin/tests/manual/acceptance.sh` — the test suite itself, the canonical source for what's being verified
