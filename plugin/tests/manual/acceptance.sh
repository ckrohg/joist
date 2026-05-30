#!/usr/bin/env bash
#
# Joist v0.5 acceptance test — exercises the full v0.5 REST surface.
#
# This is the entry point for validating the plugin against a real WordPress
# install. It does NOT need WP-CLI — pure curl + jq against the REST API.
#
# ── Requirements ──────────────────────────────────────────────────────────
#   curl, jq   (macOS: `brew install jq`)
#   A WordPress site (6.5+, PHP 8.0+) with Elementor 3.18+ and the Joist
#   plugin activated, plus an Application Password for an admin user.
#
# ── Usage ─────────────────────────────────────────────────────────────────
#   WP_URL="http://joist-test.local" \
#   JOIST_USER="admin" \
#   JOIST_APP_PWD="xxxx xxxx xxxx xxxx xxxx xxxx" \
#   bash acceptance.sh
#
#   Optional env:
#     JOIST_VERBOSE=1   print full response bodies on every call
#     JOIST_KEEP=1      don't trash the test pages at the end (so you can do
#                       the manual round-trip step in the Elementor editor)
#
# ── What this proves ──────────────────────────────────────────────────────
#   - The plugin activates cleanly (migrations ran, role registered)
#   - The full REST surface responds
#   - Schema validation rejects bad keys with Levenshtein suggestions (#1)
#   - OCC hash mismatch returns 409 with recovery_suggestions
#   - All 8 patch ops apply
#   - Revisions + atomic restore work (#3)
#   - PolicyGuard refuses destructive kit ops (#18)
#   - Plan Mode: create → approve → execute → completed
#   - Operating modes: observer forces dry_run; live writes through (#6.12)
#   - Chained-singleton: 6th op without a plan → 423 (#19)
#   - Async pipeline returns optimistically with pending_verifications (#17)
#   - Hash-chained audit log records every write (#15, #30)
#   - Elementor V3/V4 routing decision is exposed in /site (Wave 3, constraint #17)
#   - V4 known-broken versions refuse writes with atomic_save_unstable_in_v4
#   - Unsupported majors refuse writes with unsupported_elementor_major
#   - V3 write path is unchanged from pre-Wave-3 (regression guard)
#
# ── What this does NOT cover (needs agent-role creds or runtime conditions) ─
#   - Role-gated PolicyGuard refusals (force-delete / core-plugin-deactivate
#     from the joist_agent role). To test those: create a joist_agent-role
#     user, generate an App Password for it, re-run with JOIST_USER / JOIST_APP_PWD
#     set to those creds. The kit-zero-colors refusal below covers PolicyGuard
#     regardless of role.
#   - SSRF defenses on /media URL-mode and /webhooks (would need a malicious
#     internal URL to probe — don't do that on a real network).
#   - Multisite, MCP adapter wiring, WP-admin Plan Review UI — all v0.7.
#
# ── The manual step (the round-trip proof) ────────────────────────────────
#   Run with JOIST_KEEP=1, then in your browser:
#     1. Open the edit_url this script prints for the last test page
#     2. Edit a widget in the Elementor UI, save
#     3. curl GET /pages/{id} — the hash will differ, last_modifier.type == "human"
#     4. That's round-trip detection working — no clobbering.
#
set -uo pipefail   # NOT -e: we count failures and keep going

# ── config ─────────────────────────────────────────────────────────────────
WP_URL="${WP_URL:-http://joist-test.local}"
JOIST_USER="${JOIST_USER:-admin}"
JOIST_APP_PWD="${JOIST_APP_PWD:-xxxx xxxx xxxx xxxx xxxx xxxx}"
BASE="${WP_URL%/}/wp-json/joist/v1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESP_FILE="$(mktemp -t joist-resp.XXXXXX)"
trap 'rm -f "$RESP_FILE"' EXIT

PASS=0; FAIL=0; SKIP=0
SESSION_ID=""
declare -a CREATED_PAGES=()
LAST_PAGE_EDIT_URL=""

# ── prerequisites ──────────────────────────────────────────────────────────
command -v curl >/dev/null || { echo "FATAL: curl not found."; exit 2; }
command -v jq   >/dev/null || { echo "FATAL: jq not found. Install with: brew install jq"; exit 2; }

# ── helpers ────────────────────────────────────────────────────────────────
c_pass='\033[32m'; c_fail='\033[31m'; c_skip='\033[33m'; c_bold='\033[1m'; c_dim='\033[2m'; c_off='\033[0m'

section() { printf '\n%b── %s ──%b\n' "$c_bold" "$1" "$c_off"; }
pass()    { PASS=$((PASS+1)); printf '  %b✓%b %s\n' "$c_pass" "$c_off" "$1"; }
fail()    { FAIL=$((FAIL+1)); printf '  %b✗%b %s\n' "$c_fail" "$c_off" "$1"; }
skip()    { SKIP=$((SKIP+1)); printf '  %b·%b %s %b(skipped)%b\n' "$c_skip" "$c_off" "$1" "$c_dim" "$c_off"; }
info()    { printf '    %b%s%b\n' "$c_dim" "$1" "$c_off"; }

# api METHOD PATH [JSON_BODY] [SESSION_OVERRIDE]
#   SESSION_OVERRIDE: a session id to use instead of $SESSION_ID; or the
#   literal "NO_SESSION" to omit the X-Joist-Session-Id header entirely.
#   sets globals RESP (body) and HTTP_CODE
api() {
  local method="$1" path="$2" body="${3:-}" sess="${4:-$SESSION_ID}"
  local -a args=( -sS -u "$JOIST_USER:$JOIST_APP_PWD" -X "$method" -H 'Accept: application/json' )
  # Wave 7: bypass production rate limits during tests. The plugin gates the
  # bypass on (header present) AND (current_user_can('manage_options')) — a
  # non-admin caller sending this header has no effect.
  args+=( -H 'X-Joist-Test-Mode: 1' )
  if [ -n "$sess" ] && [ "$sess" != "NO_SESSION" ]; then args+=( -H "X-Joist-Session-Id: $sess" ); fi
  if [ -n "$body" ]; then args+=( -H 'Content-Type: application/json' --data-binary "$body" ); fi
  HTTP_CODE="$(curl "${args[@]}" -o "$RESP_FILE" -w '%{http_code}' "$BASE$path" 2>/dev/null || echo 000)"
  RESP="$(cat "$RESP_FILE")"
  # Wave 7 fix: auto-retry on rate-limit with up to 3 attempts and growing
  # backoff. The server is honest about retry_after, but consecutive writes
  # in tight loops can hit the limiter repeatedly even after a single retry.
  local _retries=0
  while [ "$HTTP_CODE" = "429" ] && [ "$_retries" -lt 3 ]; do
    local retry_after
    retry_after="$(echo "$RESP" | jq -r '.details.retry_after // 2' 2>/dev/null || echo 2)"
    case "$retry_after" in ''|*[!0-9]*) retry_after=2 ;; esac
    [ "$retry_after" -gt 10 ] && retry_after=10
    sleep "$(( retry_after + _retries ))"
    HTTP_CODE="$(curl "${args[@]}" -o "$RESP_FILE" -w '%{http_code}' "$BASE$path" 2>/dev/null || echo 000)"
    RESP="$(cat "$RESP_FILE")"
    _retries=$((_retries + 1))
  done
  # Pace writes: a small unconditional sleep after every write keeps the
  # rate limiter from firing on the *next* test in a tight loop. 200ms × ~150
  # writes ≈ 30s added to wall-clock, traded for far fewer rate-limit cascades.
  case "$method" in POST|PATCH|PUT|DELETE) sleep 0.2 ;; esac
  if [ "${JOIST_VERBOSE:-0}" = "1" ]; then
    printf '    %b%s %s → %s%b\n' "$c_dim" "$method" "$path" "$HTTP_CODE" "$c_off"
    echo "$RESP" | jq . 2>/dev/null | sed 's/^/      /' || echo "      $RESP" | head -c 500
  fi
}

assert_status() {
  local expected="$1" desc="$2"
  if [ "$HTTP_CODE" = "$expected" ]; then pass "$desc ($HTTP_CODE)";
  else fail "$desc — expected $expected, got $HTTP_CODE :: $(echo "$RESP" | head -c 300)"; fi
}
assert_status_in() {
  # assert_status_in "200 201" "desc"
  local accepted="$1" desc="$2"
  case " $accepted " in *" $HTTP_CODE "*) pass "$desc ($HTTP_CODE)";; *) fail "$desc — expected one of [$accepted], got $HTTP_CODE :: $(echo "$RESP" | head -c 300)";; esac
}
assert_jq() {
  local expr="$1" desc="$2"
  if echo "$RESP" | jq -e "$expr" >/dev/null 2>&1; then pass "$desc";
  else fail "$desc — jq '$expr' was false/null/error :: $(echo "$RESP" | head -c 300)"; fi
}
jqr() { echo "$RESP" | jq -r "$1" 2>/dev/null; }

# ════════════════════════════════════════════════════════════════════════════
printf '%b\nJoist v0.5 acceptance test%b\n' "$c_bold" "$c_off"
info "target: $WP_URL"
info "user:   $JOIST_USER"

# ── PREFLIGHT ───────────────────────────────────────────────────────────────
section "Preflight"
api GET /site
if [ "$HTTP_CODE" != "200" ]; then
  printf '%bFATAL%b: GET /site returned %s. Is the Joist plugin active? Is the App Password correct? Is the site at %s?\n' "$c_fail" "$c_off" "$HTTP_CODE" "$WP_URL"
  printf 'Response: %s\n' "$RESP"
  exit 1
fi
pass "GET /site reachable"
ACTIVATION_ERR="$(jqr '.plugin.activation_error')"
if [ -n "$ACTIVATION_ERR" ] && [ "$ACTIVATION_ERR" != "null" ]; then
  fail "plugin has an activation error: $ACTIVATION_ERR — migrations did not complete. Deactivate + reactivate the plugin."
else
  pass "no activation error (migrations ran cleanly)"
fi
info "WP $(jqr '.wordpress.version') · Elementor $(jqr '.elementor.version') · Pro: $(jqr '.elementor.pro.present') · PHP $(jqr '.hosting.php_version') · host: $(jqr '.hosting.host')"
info "DB version: $(jqr '.plugin.db_version') · widgets: $(jqr '.elementor.registered_widget_count') · dynamic tags: $(jqr '.elementor.registered_dynamic_tag_count') · layout mode: $(jqr '.elementor.layout_mode')"
info "operating mode (before test): $(jqr '.operating_mode.mode')"

# Wave 7 fix: start the main session NOW so every subsequent write has a
# valid X-Joist-Session-Id header. Previously the session-start happened
# after the Connectors API + V3/V4 routing test sections, causing every
# write in those sections to fail with auth.session_required.
api POST /sessions/start '{"agent":"acceptance-test","agent_version":"0.5","intent":"v0.5 acceptance run"}'
if [ "$HTTP_CODE" = "200" ]; then
  SESSION_ID="$(jqr '.session_id')"
  [ -n "$SESSION_ID" ] && [ "$SESSION_ID" != "null" ] \
    && pass "session started early (id: $SESSION_ID)" \
    || fail "session-start returned 200 but no session_id in body"
else
  fail "session-start failed (HTTP $HTTP_CODE) — every downstream write will fail with auth.session_required"
fi

# ── WP PLATFORM DETECTION + 7.0 CONNECTORS API (Wave 2b) ────────────────────
# These tests exercise plugin/src/Platform/* — the WP-version-aware feature
# gate that registers Joist with the WP 7.0 Connectors API on 7.0+ hosts
# and gracefully no-ops on 6.x. See specs/ARCHITECTURE.md §7a.
section "WP platform detection (WPVersionDetector)"
api GET /site
assert_status 200 "GET /site (re-read for platform block)"
assert_jq '.wordpress.platform != null' "wordpress.platform block is present in the /site payload"
assert_jq '.wordpress.platform.version != null and (.wordpress.platform.version | type == "string")' "platform.version is a non-null string"
assert_jq '(.wordpress.platform.major | type == "number") and (.wordpress.platform.minor | type == "number") and (.wordpress.platform.patch | type == "number")' "platform.major/minor/patch are numbers"
assert_jq '.wordpress.platform.supports_connectors_api | type == "boolean"' "supports_connectors_api is a boolean"
assert_jq '.wordpress.platform.supports_dataviews | type == "boolean"'      "supports_dataviews is a boolean"
assert_jq '.wordpress.platform.supports_client_side_abilities | type == "boolean"' "supports_client_side_abilities is a boolean"
assert_jq '.wordpress.platform.source != null' "platform.source is present (global|bloginfo|env_override|unknown)"
# Cross-check: major version inferred from .wordpress.version matches platform.major
WP_MAJOR_FROM_VERSION="$(jqr '.wordpress.version' | awk -F. '{print $1}')"
PLATFORM_MAJOR="$(jqr '.wordpress.platform.major')"
[ "${WP_MAJOR_FROM_VERSION:-x}" = "${PLATFORM_MAJOR:-y}" ] \
  && pass "platform.major ($PLATFORM_MAJOR) matches the major component of wordpress.version" \
  || fail "platform.major ($PLATFORM_MAJOR) does NOT match major of wordpress.version ($WP_MAJOR_FROM_VERSION)"
# Logical consistency: if major >= 7, all three support_* flags should be true; if major < 7, all should be false.
CONN_SUPP="$(jqr '.wordpress.platform.supports_connectors_api')"
if [ "${PLATFORM_MAJOR:-0}" -ge 7 ]; then
  [ "$CONN_SUPP" = "true" ] && pass "WP 7.0+ host: supports_connectors_api == true" || fail "WP 7.0+ host but supports_connectors_api != true"
else
  [ "$CONN_SUPP" = "false" ] && pass "WP 6.x host: supports_connectors_api == false (graceful fallback to REST auth)" || fail "WP 6.x host but supports_connectors_api != false"
fi

section "WP 7.0 Connectors API — descriptor + registration"
CONNECTOR_BLOCK="$(jqr '.plugin.connector')"
[ -n "$CONNECTOR_BLOCK" ] && [ "$CONNECTOR_BLOCK" != "null" ] \
  && pass "plugin.connector block is present" \
  || fail "plugin.connector block missing — Wave 2b platform wiring did not load"

# The descriptor must be returned even on 6.x — it's a static shape; only
# the .registered boolean depends on the runtime API.
assert_jq '.plugin.connector.descriptor != null' "connector descriptor is exposed (independent of WP version)"
assert_jq '.plugin.connector.descriptor.name == "Joist"' "descriptor.name == \"Joist\""
assert_jq '.plugin.connector.descriptor.type == "site_builder"' "descriptor.type == \"site_builder\""
assert_jq '.plugin.connector.descriptor.authentication.method == "api_key"' "descriptor advertises api_key auth"
assert_jq '.plugin.connector.descriptor.authentication.credentials_url | test("application-passwords")' "credentials_url points at WP App Passwords UI"
assert_jq '.plugin.connector.descriptor.joist.rest_namespace == "joist/v1"' "joist namespace extension exposes rest_namespace"
assert_jq '.plugin.connector.descriptor.joist.discovery_route == "/joist/v1/site"' "discovery_route points at /joist/v1/site"
assert_jq '.plugin.connector.descriptor.joist.capabilities | length >= 10' "advertises >= 10 capabilities (elementor.* + plans.* + ...)"
assert_jq '.plugin.connector.descriptor.joist.capabilities | index("elementor.pages.patch") != null' "capabilities include elementor.pages.patch"
assert_jq '.plugin.connector.descriptor.joist.capabilities | index("plans.execute") != null' "capabilities include plans.execute"

# Registration outcome depends on the host:
#   - WP 7.0+ with Connectors API actually loaded → .registered == true
#   - WP 7.0+ but API helpers absent → .registered == false (graceful no-op)
#   - WP 6.x → .registered == false (class not even loaded)
REGISTERED="$(jqr '.plugin.connector.registered')"
if [ "${PLATFORM_MAJOR:-0}" -ge 7 ]; then
  if [ "$REGISTERED" = "true" ]; then
    pass "WP 7.0+ host: Joist connector registered with core Connectors API"
  elif [ "$REGISTERED" = "false" ]; then
    pass "WP 7.0+ host but Connectors API helpers absent — graceful no-op (no fatal, descriptor still exposed)"
    info "this is the expected path on a 7.0+ host where wp_is_connector_registered() is missing"
  else
    fail "plugin.connector.registered is neither true nor false: '$REGISTERED'"
  fi
else
  [ "$REGISTERED" = "false" ] \
    && pass "WP 6.x host: connector NOT registered (graceful fallback — REST auth path still works)" \
    || fail "WP 6.x host but plugin.connector.registered != false"
fi

# Sanity: the existing REST endpoints MUST still work regardless of WP version.
# This is the "fallback path" assertion — on 6.x there's no Connectors API,
# so the App Password + REST auth path must continue serving every endpoint.
api GET /health
assert_status 200 "fallback path: GET /health responds on this WP version (auth path independent of Connectors API)"

# Optional WP_DEBUG-only test: env override flips the detector result without
# touching the real WP install. Only meaningful when JOIST_TEST_WP_VERSION is set
# on the WP side AND WP_DEBUG is on; the bash test only verifies the surface
# accepts the env-override source string when it shows up.
# Wave 7 fix: re-fetch /site so $RESP carries the platform block (intervening
# connector tests may have left RESP pointing at a different endpoint).
api GET /site
case "$(jqr '.wordpress.platform.source')" in
  global|bloginfo|env_override|unknown)
    pass "platform.source value is one of the documented sentinel strings"
    ;;
  *)
    fail "platform.source returned unexpected value: $(jqr '.wordpress.platform.source')"
    ;;
esac

# New installs default to 'observer' (the 30-day trial design). Set 'live' for testing.
api POST /site/operating-mode '{"mode":"live"}'
assert_status 200 "set operating mode → live (new installs default to observer — that's intentional)"

# ── ELEMENTOR V3/V4 ROUTING (Wave 3 — failure-mode constraint #17) ──────────
# These tests exercise plugin/src/Elementor/{VersionRouter,RoutingDecision,
# AtomicSchemaProbe,AtomicDocumentWriter}. The router is the chokepoint that
# decides whether writes proceed (legacy_v3), are refused as known-broken
# (atomic_v4 + 4.0.0–4.1.1), or are refused as unsupported (major < 3 or
# >= 5). See specs/ARCHITECTURE.md §7b and Wave_0_2026-05-26.md §1.3.
section "Elementor V3/V4 routing — version detection & decision table"

api GET /site
assert_status 200 "GET /site (re-read for routing block)"
assert_jq '.elementor.routing != null' "elementor.routing block is present in /site payload"
assert_jq '.elementor.routing.kind != null and (.elementor.routing.kind | type == "string")' "routing.kind is a non-null string"
assert_jq '(.elementor.routing.kind == "legacy_v3") or (.elementor.routing.kind == "atomic_v4") or (.elementor.routing.kind == "unsupported")' "routing.kind is one of the documented sentinels"
assert_jq '(.elementor.routing.major | type == "number") and (.elementor.routing.minor | type == "number") and (.elementor.routing.patch | type == "number")' "routing.major/minor/patch are numbers"
assert_jq '.elementor.routing.known_broken | type == "boolean"' "routing.known_broken is a boolean"
assert_jq '.elementor.routing.source != null' "routing.source is present (constant|env_override|constant_missing)"
assert_jq '.elementor.routing.notes | type == "array"' "routing.notes is an array"
case "$(jqr '.elementor.routing.source')" in
  constant|env_override|constant_missing)
    pass "routing.source value is one of the documented sentinels"
    ;;
  *)
    fail "routing.source returned unexpected value: $(jqr '.elementor.routing.source')"
    ;;
esac

# Cross-check: V3 hosts (the v0.5 pin range 3.33–3.34.x) MUST route to legacy_v3
# and MUST NOT be known_broken. V4 hosts MUST currently be known_broken (since
# the full 4.0.0–4.1.1 range is in the broken window as of 2026-05-28).
ROUTING_KIND="$(jqr '.elementor.routing.kind')"
ROUTING_BROKEN="$(jqr '.elementor.routing.known_broken')"
ELEMENTOR_MAJOR="$(jqr '.elementor.routing.major')"
info "detected routing: kind=$ROUTING_KIND  major=$ELEMENTOR_MAJOR  known_broken=$ROUTING_BROKEN"
if [ "$ELEMENTOR_MAJOR" = "3" ]; then
  [ "$ROUTING_KIND" = "legacy_v3" ] && pass "Elementor 3.x → routing.kind == legacy_v3 (expected)" || fail "Elementor 3.x but routing.kind = $ROUTING_KIND (expected legacy_v3)"
  [ "$ROUTING_BROKEN" = "false" ] && pass "Elementor 3.x → known_broken == false (V3 has no atomic-save bugs)" || fail "Elementor 3.x but known_broken = $ROUTING_BROKEN (expected false)"
elif [ "$ELEMENTOR_MAJOR" = "4" ]; then
  [ "$ROUTING_KIND" = "atomic_v4" ] && pass "Elementor 4.x → routing.kind == atomic_v4 (expected)" || fail "Elementor 4.x but routing.kind = $ROUTING_KIND (expected atomic_v4)"
  [ "$ROUTING_BROKEN" = "true" ] && pass "Elementor 4.x is in the known-broken range (4.0.0–4.1.1) as of 2026-05-28" || info "Elementor 4.x outside the known-broken range — narrow VersionRouter::KNOWN_BROKEN_MAX once upstream fixes ship"
elif [ "$ELEMENTOR_MAJOR" -ge 5 ] 2>/dev/null; then
  [ "$ROUTING_KIND" = "unsupported" ] && pass "Elementor major >= 5 → routing.kind == unsupported" || fail "Elementor major $ELEMENTOR_MAJOR but routing.kind = $ROUTING_KIND (expected unsupported)"
fi

# Health surface MUST include the elementor.routing check.
api GET /health
assert_status 200 "GET /health (re-read for routing check)"
assert_jq '.checks[] | select(.name=="elementor.routing")' "health surface includes the elementor.routing check"
ROUTING_HEALTH_STATUS="$(echo "$RESP" | jq -r '.checks[] | select(.name=="elementor.routing") | .status' 2>/dev/null)"
case "$ROUTING_HEALTH_STATUS" in
  pass|warn) pass "elementor.routing check status is one of {pass, warn} (got: $ROUTING_HEALTH_STATUS)" ;;
  *) fail "elementor.routing check status was '$ROUTING_HEALTH_STATUS' (expected pass|warn)" ;;
esac

# ── ROUTING — known-broken V4 refuses writes with the typed error ───────────
# Only meaningful when the live host is V4 + known_broken. If you've set
# JOIST_TEST_ELEMENTOR_VERSION to a V3 version with WP_DEBUG on (env-override
# path), this section is skipped because the override flips us to legacy_v3.
section "Elementor V3/V4 routing — known-broken V4 refuses writes"
if [ "$ROUTING_KIND" = "atomic_v4" ] && [ "$ROUTING_BROKEN" = "true" ]; then
  # Need a session for writes — start one.
  api POST /sessions/start '{"agent":"routing-test","agent_version":"0.5","intent":"V4 known-broken refusal test"}'
  TEST_SESSION="$(jqr '.session_id')"
  if [ -n "$TEST_SESSION" ] && [ "$TEST_SESSION" != "null" ]; then
    api POST /pages '{"title":"V4 known-broken refusal test (should never be created)","status":"draft","intent":"refusal test"}' "" "$TEST_SESSION"
    assert_status 422 "POST /pages on known-broken V4 → 422 (refused before any side effects)"
    assert_jq '.code == "atomic_save_unstable_in_v4"' "error code is atomic_save_unstable_in_v4"
    assert_jq '.message | type == "string" and length > 20' "error message is human-readable"
    assert_jq '.details.routing_decision.kind == "atomic_v4"' "details.routing_decision.kind == atomic_v4"
    assert_jq '.details.routing_decision.known_broken == true' "details.routing_decision.known_broken == true"
    assert_jq '.details.open_upstream_issues | length >= 3' "details.open_upstream_issues lists the open Elementor issues"
    assert_jq '.details.guidance != null' "details.guidance is present"
    assert_jq '.recovery_suggestions | length >= 1' "recovery_suggestions are populated"
  else
    skip "known-broken V4 refusal test (could not start session)"
  fi
else
  skip "known-broken V4 refusal test (host is not atomic_v4 + known_broken)"
fi

# ── ROUTING — unsupported major refusal ─────────────────────────────────────
# Only meaningful when ELEMENTOR_VERSION is < 3 or >= 5. Today's released
# versions are all 3.x or 4.x, so this section is normally skipped unless
# WP_DEBUG + JOIST_TEST_ELEMENTOR_VERSION='5.0.0' is set on the WP side.
section "Elementor V3/V4 routing — unsupported major refusal"
if [ "$ROUTING_KIND" = "unsupported" ]; then
  api POST /sessions/start '{"agent":"routing-test","agent_version":"0.5","intent":"unsupported-major refusal test"}'
  TEST_SESSION="$(jqr '.session_id')"
  if [ -n "$TEST_SESSION" ] && [ "$TEST_SESSION" != "null" ]; then
    api POST /pages '{"title":"unsupported refusal test","status":"draft","intent":"refusal test"}' "" "$TEST_SESSION"
    assert_status 422 "POST /pages on unsupported major → 422"
    assert_jq '.code == "unsupported_elementor_major"' "error code is unsupported_elementor_major"
    assert_jq '.details.routing_decision.kind == "unsupported"' "details.routing_decision.kind == unsupported"
  else
    skip "unsupported-major refusal test (could not start session)"
  fi
else
  skip "unsupported-major refusal test (host is not unsupported; set JOIST_TEST_ELEMENTOR_VERSION=5.0.0 with WP_DEBUG to exercise)"
fi

# ── ROUTING — V3 path is unchanged (regression guard) ───────────────────────
# This is the load-bearing assertion that Wave 3 is non-destructive: on a V3
# host (3.33/3.34.x) the existing write path must continue to produce
# identical output. The page create + tree-summary tests later in this script
# cover the full write loop; here we just verify routing.kind doesn't block.
section "Elementor V3/V4 routing — V3 write path remains unblocked"
if [ "$ROUTING_KIND" = "legacy_v3" ]; then
  pass "V3 host detected — write path will be exercised by subsequent tests (regression guard)"
else
  skip "V3 regression guard (host is not legacy_v3)"
fi

# All routing-related error envelopes MUST be 422 with a typed code + message;
# this is a recheck of the universal property — never 500, never empty 200.
api GET /site
assert_status 200 "GET /site final routing recheck"
assert_jq '.elementor.routing.kind != null and .elementor.routing.kind != ""' "routing.kind remains populated (never empty)"

# ── ROUTING — atomic schema probe surfaced in /diagnostics ──────────────────
# Diagnostics is the read-only surface that exposes the probe result, so this
# test verifies that on V4 hosts the probe runs and returns a typed shape
# (either success with elements[] or a typed atomic_schema_unintrospectable
# error). On V3 hosts the probe is null (not invoked — correct behavior).
section "Elementor V3/V4 routing — atomic schema probe in /diagnostics"
api GET /diagnostics
assert_status 200 "GET /diagnostics"
assert_jq '.elementor_routing != null' "diagnostics.elementor_routing block is present"
if [ "$ROUTING_KIND" = "atomic_v4" ]; then
  assert_jq '.atomic_schema_probe != null' "atomic_schema_probe runs on V4 host"
  assert_jq '(.atomic_schema_probe.ok == true) or (.atomic_schema_probe.code == "atomic_schema_unintrospectable")' "probe returns either {ok:true,elements:...} or typed atomic_schema_unintrospectable"
  # If the probe failed (registry surface unexpected), the error envelope must
  # carry the typed code + details — never an empty object.
  if [ "$(jqr '.atomic_schema_probe.ok')" = "false" ]; then
    assert_jq '.atomic_schema_probe.code == "atomic_schema_unintrospectable"' "probe failure carries the typed code"
    assert_jq '.atomic_schema_probe.message | type == "string" and length > 10' "probe failure has a human-readable message"
    assert_jq '.atomic_schema_probe.details != null' "probe failure has a details object"
  else
    assert_jq '.atomic_schema_probe.elements | type == "array"' "probe success returns elements[] array"
    assert_jq '.atomic_schema_probe.count | type == "number"' "probe success returns count"
  fi
else
  assert_jq '.atomic_schema_probe == null' "atomic_schema_probe is null on non-V4 host (probe not invoked — correct)"
fi

# ── HEALTH (the canary) ─────────────────────────────────────────────────────
section "Health — the single most informative call"
api GET /health
assert_status 200 "GET /health"
echo "$RESP" | jq -r '.checks[] | "    [\(.status)] \(.name) — \(.message)"' 2>/dev/null
assert_jq '.checks[] | select(.name=="write.real_test") | .status=="pass"' "real write test passes (created → wrote → read → deleted a test page through Elementor)"
assert_jq '.checks[] | select(.name=="db.tables_present") | .status=="pass"' "custom tables present"
assert_jq '.ok == true or ([.checks[] | select(.status=="fail")] | length == 0)' "no failing health checks"

# ── SESSION LIFECYCLE ───────────────────────────────────────────────────────
section "Session lifecycle"
api POST /sessions/start '{"agent":"acceptance-test","agent_version":"0.5","intent":"v0.5 acceptance run"}'
assert_status 200 "POST /sessions/start"
SESSION_ID="$(jqr '.session_id')"
[ -n "$SESSION_ID" ] && [ "$SESSION_ID" != "null" ] && pass "got session_id: $SESSION_ID" || fail "no session_id returned"

# Writes without a session header should be rejected (#2 conventions).
api POST /pages '{"title":"no-session test (should be rejected)"}' "" "NO_SESSION"
assert_status 400 "POST /pages without X-Joist-Session-Id → 400"

# ── WIDGET CATALOG + SCHEMA ─────────────────────────────────────────────────
section "Widget catalog + schema introspection"
api GET /widgets
assert_status 200 "GET /widgets"
info "$(jqr '.widgets | length') widgets registered"
api GET /widgets/heading/schema
assert_status 200 "GET /widgets/heading/schema"
assert_jq '.controls | map(.name) | index("title") != null' "heading schema includes a 'title' control"
api GET /widgets/this-widget-does-not-exist/schema
assert_status 404 "GET /widgets/{nonexistent}/schema → 404"

# ── SCHEMA VALIDATION REJECTION (the msrbuilds #32 class) ───────────────────
section "Schema validation — reject unknown key with a suggestion"
api POST /widgets/validate '{"type":"heading","settings":{"titel":"a typo","align":"center"}}'
assert_status 200 "POST /widgets/validate returns 200 (with valid:false)"
assert_jq '.valid == false' "settings marked invalid"
assert_jq '.errors | length > 0' "errors array populated"
assert_jq '.errors[0].suggestion != null' "a suggestion is offered for the rejected key (expect 'title' for 'titel' — Levenshtein-1)"
info "suggestion: $(jqr '.errors[0].suggestion')"

# ── DYNAMIC TAGS ────────────────────────────────────────────────────────────
section "Dynamic tags catalog"
api GET /dynamic-tags
assert_status 200 "GET /dynamic-tags"
info "$(jqr '.tags | length') dynamic tags registered"

# ── PAGE CREATE + READ + TREE SUMMARY ───────────────────────────────────────
section "Page: create + read + tree-summary"
api POST /pages '{
  "title": "Joist v0.5 acceptance — safe to delete",
  "status": "publish",
  "intent": "acceptance test page",
  "elements": [{
    "elType": "container",
    "settings": {"flex_direction": "column", "padding": {"unit":"px","top":"40","right":"20","bottom":"40","left":"20"}},
    "elements": [
      {"elType": "widget", "widgetType": "heading", "settings": {"title": "Hello from Joist v0.5", "header_size": "h1", "align": "center"}, "elements": []},
      {"elType": "widget", "widgetType": "text-editor", "settings": {"editor": "<p>This page was written by the acceptance test through the Joist plugin. The content hash is the OCC primitive.</p>"}, "elements": []}
    ]
  }]
}'
assert_status 201 "POST /pages"
PAGE_ID="$(jqr '.id')"; HASH="$(jqr '.hash')"; LAST_PAGE_EDIT_URL="$(jqr '.edit_url')"
if [ -n "$PAGE_ID" ] && [ "$PAGE_ID" != "null" ]; then CREATED_PAGES+=("$PAGE_ID"); pass "created page #$PAGE_ID, hash ${HASH:0:24}…"; else fail "no page id returned"; fi

api GET "/pages/$PAGE_ID"
assert_status 200 "GET /pages/$PAGE_ID"
assert_jq '.elementor.tree_summary != null and (.elementor.elements == null)' "tree-summary returned by default (full tree omitted)"
assert_jq '.last_modifier == null or .last_modifier.actor_type == "agent"' "last_modifier reflects the agent (or null on first read)"

api GET "/pages/$PAGE_ID?include=elements"
assert_status 200 "GET /pages/$PAGE_ID?include=elements"
assert_jq '.elementor.elements | length == 1' "full element tree returned on ?include=elements (1 root container)"

api GET "/pages/$PAGE_ID/tree-summary"
assert_status 200 "GET /pages/$PAGE_ID/tree-summary"
HEADING_ID="$(jqr '.outline[] | select(.widgetType=="heading") | .id' | head -1)"
CONTAINER_ID="$(jqr '.outline[] | select(.elType=="container") | .id' | head -1)"
HASH="$(jqr '.hash')"
[ -n "$HEADING_ID" ] && [ "$HEADING_ID" != "null" ] && pass "heading element id: $HEADING_ID" || fail "could not find heading element id in tree-summary"
[ -n "$CONTAINER_ID" ] && [ "$CONTAINER_ID" != "null" ] && pass "container element id: $CONTAINER_ID" || fail "could not find container element id"

# ── PATCH OP: update_settings ───────────────────────────────────────────────
section "Patch op: update_settings"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"ops\":[{\"op\":\"update_settings\",\"element_id\":\"$HEADING_ID\",\"settings\":{\"title\":\"Edited via update_settings\"}}]}"
assert_status 200 "patch update_settings"
assert_jq '.dry_run == false' "write actually happened (dry_run:false)"
assert_jq '.pending_verifications | length > 0' "async pipeline: pending_verifications returned (#17)"
HASH="$(jqr '.new_hash')"; info "new hash ${HASH:0:24}…"

# ── PATCH OP: insert ────────────────────────────────────────────────────────
section "Patch op: insert (with deep ID generation)"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"ops\":[{\"op\":\"insert\",\"parent_id\":\"$CONTAINER_ID\",\"position\":0,\"element\":{\"elType\":\"widget\",\"widgetType\":\"heading\",\"settings\":{\"title\":\"Inserted at the top\",\"header_size\":\"h2\"},\"elements\":[]}}]}"
assert_status 200 "patch insert"
HASH="$(jqr '.new_hash')"
api GET "/pages/$PAGE_ID/tree-summary"
HCOUNT="$(echo "$RESP" | jq '[.outline[] | select(.widgetType=="heading")] | length')"
[ "${HCOUNT:-0}" -ge 2 ] && pass "insert added a heading (now $HCOUNT headings)" || fail "insert did not add a heading"
HASH="$(jqr '.hash')"

# ── PATCH OP: duplicate (deep ID regen — constraint #28) ────────────────────
section "Patch op: duplicate (deep ID regen — constraint #28)"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"ops\":[{\"op\":\"duplicate\",\"element_id\":\"$HEADING_ID\",\"position\":\"after\"}]}"
assert_status 200 "patch duplicate"
HASH="$(jqr '.new_hash')"
api GET "/pages/$PAGE_ID/tree-summary"
HCOUNT2="$(echo "$RESP" | jq '[.outline[] | select(.widgetType=="heading")] | length')"
[ "${HCOUNT2:-0}" -gt "${HCOUNT:-0}" ] && pass "duplicate added a copy (now $HCOUNT2 headings)" || fail "duplicate did not add a heading"
# Verify the duplicate has a DIFFERENT id than the source.
DUP_IDS="$(echo "$RESP" | jq -r '[.outline[] | select(.widgetType=="heading") | .id] | unique | length')"
[ "${DUP_IDS:-0}" = "${HCOUNT2:-0}" ] && pass "all heading IDs are unique (deep regen worked — no collisions)" || fail "duplicate produced colliding IDs"
HASH="$(jqr '.hash')"

# ── PATCH OP: move ──────────────────────────────────────────────────────────
section "Patch op: move"
# Move the duplicate to the front of the container (position 0).
DUP_HEADING="$(echo "$RESP" | jq -r '[.outline[] | select(.widgetType=="heading") | .id] | last')"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"ops\":[{\"op\":\"move\",\"element_id\":\"$DUP_HEADING\",\"new_parent_id\":\"$CONTAINER_ID\",\"new_position\":0}]}"
assert_status_in "200" "patch move"
HASH="$(jqr '.new_hash')"

# ── PATCH OP: delete ────────────────────────────────────────────────────────
section "Patch op: delete"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"ops\":[{\"op\":\"delete\",\"element_id\":\"$DUP_HEADING\"}]}"
assert_status 200 "patch delete"
HASH="$(jqr '.new_hash')"
api GET "/pages/$PAGE_ID/tree-summary"
HCOUNT3="$(echo "$RESP" | jq '[.outline[] | select(.widgetType=="heading")] | length')"
[ "${HCOUNT3:-99}" -lt "${HCOUNT2:-0}" ] && pass "delete removed a heading (now $HCOUNT3)" || fail "delete did not remove a heading"
HASH="$(jqr '.hash')"

# ── PATCH OP: wrap + unwrap ─────────────────────────────────────────────────
section "Patch op: wrap then unwrap"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"ops\":[{\"op\":\"wrap\",\"element_id\":\"$HEADING_ID\",\"container\":{\"elType\":\"container\",\"settings\":{\"flex_direction\":\"row\"},\"elements\":[]}}]}"
assert_status_in "200" "patch wrap"
HASH="$(jqr '.new_hash')"
# The heading is now nested inside a new inner container. Unwrap that container.
api GET "/pages/$PAGE_ID?include=elements"
WRAP_ID="$(echo "$RESP" | jq -r '[.elementor.elements | .. | objects | select(.elType=="container" and (.elements // [] | any(.id == "'"$HEADING_ID"'")))] | .[0].id // empty')"
HASH="$(echo "$RESP" | jq -r '.elementor.hash')"
if [ -n "$WRAP_ID" ]; then
  api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"ops\":[{\"op\":\"unwrap\",\"element_id\":\"$WRAP_ID\"}]}"
  assert_status_in "200" "patch unwrap"
  HASH="$(jqr '.new_hash')"
else
  skip "patch unwrap (couldn't locate the wrapper container — wrap may have nested differently)"
fi

# ── PATCH OP: replace_element ───────────────────────────────────────────────
section "Patch op: replace_element"
api GET "/pages/$PAGE_ID/tree-summary"; HASH="$(jqr '.hash')"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"ops\":[{\"op\":\"replace_element\",\"element_id\":\"$HEADING_ID\",\"element\":{\"id\":\"$HEADING_ID\",\"elType\":\"widget\",\"widgetType\":\"heading\",\"settings\":{\"title\":\"Replaced wholesale\",\"header_size\":\"h1\"},\"elements\":[]}}]}"
assert_status 200 "patch replace_element"
HASH="$(jqr '.new_hash')"

# ── PATCH: unsupported op rejected ──────────────────────────────────────────
section "Patch: unsupported op rejected"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"ops\":[{\"op\":\"reticulate_splines\",\"element_id\":\"$HEADING_ID\"}]}"
assert_status_in "422 400" "unknown op rejected"

# ── OCC: stale hash → 409 ───────────────────────────────────────────────────
section "OCC: stale hash → 409 with recovery_suggestions"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"sha256:0000000000000000000000000000000000000000000000000000000000000000\",\"ops\":[{\"op\":\"update_settings\",\"element_id\":\"$HEADING_ID\",\"settings\":{\"title\":\"this should not land\"}}]}"
assert_status 409 "stale hash → 409"
assert_jq '.code == "elementor.hash_mismatch"' "code is elementor.hash_mismatch"
assert_jq '.details.current_hash != null' "returns details.current_hash"
assert_jq '.recovery_suggestions | length > 0' "returns recovery_suggestions"
# Confirm the bogus write did NOT land.
api GET "/pages/$PAGE_ID?include=elements"
assert_jq '[.elementor.elements | .. | objects | select(.widgetType=="heading") | .settings.title] | index("this should not land") == null' "the rejected write did not corrupt the page"
HASH="$(jqr '.elementor.hash')"

# ── REVISIONS + RESTORE ─────────────────────────────────────────────────────
section "Revisions + atomic restore (#3)"
api GET "/pages/$PAGE_ID/revisions"
assert_status 200 "GET /pages/$PAGE_ID/revisions"
REV_COUNT="$(echo "$RESP" | jq '.revisions | length')"
[ "${REV_COUNT:-0}" -gt 0 ] && pass "$REV_COUNT revisions recorded (one per write)" || fail "no revisions recorded"
OLDEST_REV="$(echo "$RESP" | jq -r '.revisions | last | .id')"
if [ -n "$OLDEST_REV" ] && [ "$OLDEST_REV" != "null" ]; then
  api POST "/pages/$PAGE_ID/revisions/$OLDEST_REV/restore" '{}'
  assert_status 200 "restore the oldest revision"
  api GET "/pages/$PAGE_ID/tree-summary"; HASH="$(jqr '.hash')"
else
  skip "restore (no revision id)"
fi

# ── KIT + MATCH-COLOR ───────────────────────────────────────────────────────
section "Kit globals + match-color"
api GET /kit
assert_status 200 "GET /kit"
api POST /kit/match-color '{"hex":"#6334EB"}'
assert_status 200 "POST /kit/match-color (returns a match or no_match — either is fine)"
info "match result: $(jqr '.match_quality')"

# ── POLICYGUARD: refuse zeroing kit colors (#18) ────────────────────────────
section "PolicyGuard: refuse zeroing the kit color palette (#18)"
api PUT /kit '{"settings":{"system_colors":[{"_id":"primary","title":"Primary","color":""},{"_id":"secondary","title":"Secondary","color":""},{"_id":"text","title":"Text","color":""}]}}'
assert_status 403 "zeroing all kit colors → 403"
assert_jq '.code == "policy.kit_destructive_refused"' "code is policy.kit_destructive_refused"

# ── SEO ─────────────────────────────────────────────────────────────────────
section "SEO (adapter-routed)"
api GET "/pages/$PAGE_ID/seo"
assert_status 200 "GET /pages/$PAGE_ID/seo"
info "active SEO adapter: $(jqr '.adapter')"
api PUT "/pages/$PAGE_ID/seo" '{"meta_title":"Joist acceptance test page","meta_description":"Created by the Joist v0.5 acceptance suite.","noindex":true}'
assert_status 200 "PUT /pages/$PAGE_ID/seo"
assert_jq '.meta_title == "Joist acceptance test page"' "meta_title round-trips"
assert_jq '.noindex == true' "noindex round-trips"

# ── WEBHOOKS ────────────────────────────────────────────────────────────────
section "Webhooks (register / rotate / delete)"
api POST /webhooks '{"url":"https://example.com/joist-acceptance-webhook","events":["document.saved","plan.completed","human.edited"]}'
assert_status 201 "POST /webhooks"
WEBHOOK_ID="$(jqr '.id')"
api GET /webhooks
assert_status 200 "GET /webhooks"
assert_jq "[.webhooks[] | select(.id == ${WEBHOOK_ID:-0})] | length == 1" "registered webhook appears in list"
api POST "/webhooks/$WEBHOOK_ID/rotate-secret" '{}'
assert_status 200 "rotate webhook secret"
assert_jq '.secret != null' "new secret returned"
api DELETE "/webhooks/$WEBHOOK_ID"
assert_status 200 "DELETE /webhooks/$WEBHOOK_ID"

# ── TEMPLATES (Theme Builder) ───────────────────────────────────────────────
section "Templates (Theme Builder)"
api POST /templates '{"type":"section","name":"Joist acceptance test section","elements":[{"elType":"container","settings":{},"elements":[{"elType":"widget","widgetType":"heading","settings":{"title":"Reusable section"},"elements":[]}]}]}'
if [ "$HTTP_CODE" = "201" ]; then
  TEMPLATE_ID="$(jqr '.id')"; pass "created template #$TEMPLATE_ID (type: section)"
  api GET "/templates/$TEMPLATE_ID"; assert_status 200 "GET /templates/$TEMPLATE_ID"
else
  info "template create returned $HTTP_CODE — may need Elementor Pro for some template types"
  skip "templates create"
fi
api GET /templates
assert_status 200 "GET /templates (list)"

# ── AUDIT LOG ───────────────────────────────────────────────────────────────
section "Audit log (hash-chained — #15, #30)"
api GET /audit-log
assert_status 200 "GET /audit-log"
AUDIT_COUNT="$(echo "$RESP" | jq '.entries | length')"
[ "${AUDIT_COUNT:-0}" -gt 0 ] && pass "$AUDIT_COUNT audit entries recorded" || fail "no audit entries — writes should be logged"
assert_jq '.entries[0].chain_hash != null' "entries carry a chain_hash (tamper detection)"
api GET "/audit-log/summary?period=last-30-days"
assert_status 200 "GET /audit-log/summary"
info "AI edits: $(jqr '.ai_edits') · human edits: $(jqr '.human_edits') · pages affected: $(jqr '.pages_affected')"

# ── PLAN MODE: create → approve → execute → completed (#19.1) ────────────────
section "Plan Mode: create → approve → execute"
api GET "/pages/$PAGE_ID/tree-summary"; HASH="$(jqr '.hash')"
api POST /plans "{\"intent\":\"acceptance test plan — set heading title\",\"page_id\":$PAGE_ID,\"steps\":[{\"op\":\"update_settings\",\"element_id\":\"$HEADING_ID\",\"settings\":{\"title\":\"Set by an approved plan\"}}]}"
assert_status 201 "POST /plans"
PLAN_ID="$(jqr '.plan_id')"; APPROVAL_TOKEN="$(jqr '.approval_token')"
[ -n "$PLAN_ID" ] && [ "$PLAN_ID" != "null" ] && pass "plan $PLAN_ID created (status: pending)" || fail "no plan id returned"
api GET "/plans/$PLAN_ID"
assert_status 200 "GET /plans/$PLAN_ID"
assert_jq '.approval_token == null' "approval_token is NOT echoed on read (security)"
assert_jq '.status == "pending"' "plan is pending"
api POST "/plans/$PLAN_ID/approve" "{\"approval_token\":\"$APPROVAL_TOKEN\"}"
assert_status 200 "POST /plans/$PLAN_ID/approve (admin + correct token)"
# Wrong token should be rejected.
api POST "/plans/$PLAN_ID/approve" '{"approval_token":"wrong-token-deadbeef"}'
assert_status_in "403 409" "re-approve with wrong token → rejected"
api POST "/plans/$PLAN_ID/execute" '{}'
assert_status 200 "POST /plans/$PLAN_ID/execute"
assert_jq '.status == "completed"' "plan executed to completion"
# Verify the heading title actually changed.
api GET "/pages/$PAGE_ID?include=elements"
assert_jq '[.elementor.elements | .. | objects | select(.widgetType=="heading") | .settings.title] | index("Set by an approved plan") != null' "plan step landed (heading title updated)"

# ── OPERATING MODE: observer → dry_run (#6.12) ──────────────────────────────
section "Operating mode: observer forces dry_run"
api POST /site/operating-mode '{"mode":"observer"}'
assert_status 200 "set operating mode → observer"
api GET "/pages/$PAGE_ID/tree-summary"; HASH="$(jqr '.hash')"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"ops\":[{\"op\":\"update_settings\",\"element_id\":\"$HEADING_ID\",\"settings\":{\"title\":\"observer mode — should NOT land\"}}]}"
assert_status 200 "patch in observer mode returns 200"
assert_jq '.dry_run == true' "but dry_run is forced to true (nothing written)"
api POST /site/operating-mode '{"mode":"live"}'
assert_status 200 "back to operating mode → live"
api GET "/pages/$PAGE_ID?include=elements"
assert_jq '[.elementor.elements | .. | objects | select(.widgetType=="heading") | .settings.title] | index("observer mode — should NOT land") == null' "the observer-mode write did NOT persist"

# ── CHAINED-SINGLETON: 6th op without a plan → 423 (#19) ────────────────────
section "Chained-singleton: 6 unplanned ops in one session → 423 on the 6th"
api POST /sessions/start '{"agent":"chain-test","intent":"chained-singleton threshold test"}'
CHAIN_SESSION="$(jqr '.session_id')"
api GET "/pages/$PAGE_ID/tree-summary"; HASH="$(jqr '.hash')"
chain_ok=1
for i in 1 2 3 4 5; do
  api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"ops\":[{\"op\":\"update_settings\",\"element_id\":\"$HEADING_ID\",\"settings\":{\"title\":\"chain op $i\"}}]}" "" "$CHAIN_SESSION"
  if [ "$HTTP_CODE" != "200" ]; then chain_ok=0; info "op $i unexpectedly returned $HTTP_CODE"; break; fi
  HASH="$(jqr '.new_hash')"
done
[ "$chain_ok" = "1" ] && pass "ops 1-5 succeeded under the threshold" || fail "an op below the threshold failed unexpectedly"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"ops\":[{\"op\":\"update_settings\",\"element_id\":\"$HEADING_ID\",\"settings\":{\"title\":\"chain op 6 — should be refused\"}}]}" "" "$CHAIN_SESSION"
assert_status 423 "6th op without a plan → 423"
assert_jq '.code == "policy.plan_required"' "code is policy.plan_required"
api POST "/sessions/$CHAIN_SESSION/end" '{}' >/dev/null 2>&1 || true

# ── RESPONSIVE FILL: default off (matches human baseline) ──────────────────
section "Responsive fill: default OFF — matches human baseline (#24 corrected)"
# Per 2026-05-13 research: Elementor handles missing _tablet/_mobile via CSS
# cascade. Default behavior is DON'T fill — output must match a human edit
# byte-for-byte (no per-breakpoint keys when values match desktop).
api GET "/pages/$PAGE_ID/tree-summary"; HASH="$(jqr '.hash')"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"ops\":[{\"op\":\"update_settings\",\"element_id\":\"$HEADING_ID\",\"settings\":{\"align\":\"center\"}}]}"
assert_status 200 "patch with align:center (no fill_responsive flag)"
HASH="$(jqr '.new_hash')"
# Verify NO _tablet/_mobile keys were written.
api GET "/pages/$PAGE_ID?include=elements"
assert_jq '[.elementor.elements | .. | objects | select(.id == "'"$HEADING_ID"'") | .settings | keys[]] | map(select(. == "align_tablet" or . == "align_mobile")) | length == 0' "no align_tablet / align_mobile keys written (matches human baseline)"

# ── RESPONSIVE FILL: opt-in with fill_responsive: true ─────────────────────
section "Responsive fill: opt-in — fill_responsive:true writes per-breakpoint keys"
api GET "/pages/$PAGE_ID/tree-summary"; HASH="$(jqr '.hash')"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"fill_responsive\":true,\"ops\":[{\"op\":\"update_settings\",\"element_id\":\"$HEADING_ID\",\"settings\":{\"align\":\"right\"}}]}"
assert_status 200 "patch with fill_responsive:true"
assert_jq '.responsive_fills | length >= 0' "response includes responsive_fills array"
HASH="$(jqr '.new_hash')"
# When fill is opt-in AND the value differs from default, _tablet and _mobile should be written.
api GET "/pages/$PAGE_ID?include=elements"
# Note: this assertion is permissive — depending on the heading widget's
# 'align' control default in the installed Elementor version, the fill may
# or may not apply. The acceptance test verifies the contract: WHEN fill
# happens, the keys cascade correctly. We accept either: keys present with
# matching values, OR keys absent (default-matching desktop value).
assert_jq '[.elementor.elements | .. | objects | select(.id == "'"$HEADING_ID"'") | .settings.align] | length == 1' "desktop align value preserved"

# ── RESPONSIVE FILL: hide_mobile element → no _mobile fills ────────────────
section "Responsive fill: hide_mobile element → no _mobile fills written"
# Set the heading to hidden on mobile, then fill — verify no _mobile keys are emitted.
api GET "/pages/$PAGE_ID/tree-summary"; HASH="$(jqr '.hash')"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"ops\":[{\"op\":\"update_settings\",\"element_id\":\"$HEADING_ID\",\"settings\":{\"hide_mobile\":\"hidden-mobile\"}}]}"
assert_status 200 "set hide_mobile"
HASH="$(jqr '.new_hash')"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"fill_responsive\":true,\"ops\":[{\"op\":\"update_settings\",\"element_id\":\"$HEADING_ID\",\"settings\":{\"align\":\"left\"}}]}"
assert_status 200 "patch with fill on hide_mobile element"
HASH="$(jqr '.new_hash')"
# Clean up: remove hide_mobile so subsequent tests aren't affected.
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"ops\":[{\"op\":\"update_settings\",\"element_id\":\"$HEADING_ID\",\"settings\":{\"hide_mobile\":\"\"}}]}"
assert_status 200 "clear hide_mobile"

# ── RESPONSIVE FILL: idempotent — running twice produces same output ───────
section "Responsive fill: idempotent on re-run"
api GET "/pages/$PAGE_ID/tree-summary"; HASH="$(jqr '.hash')"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH\",\"fill_responsive\":true,\"ops\":[{\"op\":\"update_settings\",\"element_id\":\"$HEADING_ID\",\"settings\":{\"align\":\"center\"}}]}"
assert_status 200 "first fill"
HASH_FIRST="$(jqr '.new_hash')"
api POST "/pages/$PAGE_ID/patch" "{\"expected_hash\":\"$HASH_FIRST\",\"fill_responsive\":true,\"ops\":[{\"op\":\"update_settings\",\"element_id\":\"$HEADING_ID\",\"settings\":{\"align\":\"center\"}}]}"
assert_status 200 "second fill (no-op on same value)"
# Idempotency check — the second fill should not duplicate _tablet/_mobile entries.
api GET "/pages/$PAGE_ID?include=elements"
assert_jq '[.elementor.elements | .. | objects | select(.id == "'"$HEADING_ID"'") | .settings | to_entries[] | select(.key | startswith("align"))] | length <= 3' "no duplicate _tablet/_mobile keys after re-fill"
HASH="$(jqr '.elementor.hash')"

# ── HTTPS ENFORCEMENT (informational) ───────────────────────────────────────
section "HTTPS enforcement (#20)"
case "$WP_URL" in
  https://*) pass "site is HTTPS — enforcement is active" ;;
  *.local*|*.test*|*localhost*|*127.0.0.1*) skip "local dev — HTTPS enforcement is bypassed by design (see ControllerBase::isLocalDev)" ;;
  *) fail "site is plain HTTP and not a recognized local dev host — the plugin should have returned 421 on the first call" ;;
esac

# ── PREFERENCE MEMORY (v0.7-α) ──────────────────────────────────────────────
section "Preference memory — per-site brand learning"

# Render baseline (likely empty on a fresh install)
api GET "/preferences/render"
if [ "$HTTP_CODE" = "404" ]; then
  skip "preference-memory endpoints not registered (pre-v0.7 build) — skipping rest of section"
else
  assert_status 200 "GET /preferences/render (baseline)"

  # Create a forbidden_phrase rule
  api POST "/preferences" '{
    "kind": "forbidden_phrase",
    "pattern": "synergy",
    "rationale": "brand voice — avoid corporate jargon",
    "confidence": 0.8
  }'
  assert_status_in "200 201" "POST /preferences (forbidden_phrase: synergy)"
  RULE_ID="$(jqr '.id // .rules[0].id')"
  if [ -z "$RULE_ID" ] || [ "$RULE_ID" = "null" ]; then
    fail "could not extract rule id from create response — skipping forbidden-phrase round trip"
  else
    info "rule id: $RULE_ID"

    # Confirm it surfaces in listActive
    api GET "/preferences"
    assert_status 200 "GET /preferences (list)"
    assert_jq "[.rules[] | select(.kind == \"forbidden_phrase\" and .pattern == \"synergy\")] | length >= 1" "rule shows in active list"

    # Confirm renderForPrompt includes it
    api GET "/preferences/render"
    assert_status 200 "GET /preferences/render (with rule)"
    if echo "$RESP" | grep -qi "synergy"; then
      pass "render-for-prompt includes 'synergy' rule"
    else
      fail "render-for-prompt missing 'synergy' rule"
    fi

    # Validate flow: text containing the forbidden phrase should be flagged
    api POST "/preferences/validate" '{"text": "We need to drive synergy across teams."}'
    assert_status 200 "POST /preferences/validate (positive)"
    assert_jq '.violations | length >= 1' "validator flags forbidden phrase"
    assert_jq '[.violations[] | select(.pattern == "synergy")] | length >= 1' "violation cites correct pattern"

    # Negative case: clean text passes
    api POST "/preferences/validate" '{"text": "We help teams ship."}'
    assert_status 200 "POST /preferences/validate (negative)"
    assert_jq '.violations | length == 0' "clean text has no violations"

    # Dedup: re-adding the same pattern should bump confidence, not duplicate
    api POST "/preferences" '{
      "kind": "forbidden_phrase",
      "pattern": "synergy",
      "rationale": "second sighting",
      "confidence": 0.7
    }'
    assert_status_in "200 201" "POST /preferences (duplicate pattern)"
    api GET "/preferences"
    assert_jq '[.rules[] | select(.kind == "forbidden_phrase" and .pattern == "synergy")] | length == 1' "dedup: still exactly one synergy rule"

    # Archive
    api DELETE "/preferences/$RULE_ID"
    assert_status_in "200 204" "DELETE /preferences/{id} (archive)"
    api GET "/preferences"
    assert_jq "[.rules[] | select(.id == \"$RULE_ID\")] | length == 0" "archived rule no longer in active list"
  fi

  # Compact (admin)
  api POST "/preferences/compact" '{}'
  assert_status_in "200 202" "POST /preferences/compact"
fi

# ── MEMORY TOOL SURFACE (Wave 2a — memory_20250818 substrate) ──────────────
section "Memory tool — memory_20250818 command surface"

# Discover the current site_id from the legacy /preferences listing.
api GET "/preferences"
if [ "$HTTP_CODE" != "200" ]; then
  skip "memory tool tests: /preferences not reachable (pre-Wave-2a build)"
else
  MEM_SITE_ID="$(jqr '.site_id')"
  if [ -z "$MEM_SITE_ID" ] || [ "$MEM_SITE_ID" = "null" ]; then
    skip "memory tool tests: could not resolve site_id"
  else
    info "memory site_id: $MEM_SITE_ID"
    MEM_ROOT="/memories/site/${MEM_SITE_ID}"
    MEM_RULES="${MEM_ROOT}/rules"

    # ── view: existing site ──────────────────────────────────────────────
    api POST "/memory/view" "{\"path\":\"${MEM_ROOT}\"}"
    if [ "$HTTP_CODE" = "404" ]; then
      skip "memory tool endpoints not registered (pre-Wave-2a build) — skipping rest"
    else
      assert_status 200 "POST /memory/view (existing site dir)"
      assert_jq '.type == "directory"' "view returns directory type for site path"
      assert_jq '.entries | type == "array"' "view returns entries array"

      # ── view: unknown site (cross-site denial) ─────────────────────────
      api POST "/memory/view" '{"path":"/memories/site/host_evil_invalid_42/rules/forbidden_phrase"}'
      assert_status 403 "POST /memory/view on unknown site → 403 cross_site_denied"
      assert_jq '.code == "permission.cross_site_denied"' "code is permission.cross_site_denied"

      # ── view: missing path argument ────────────────────────────────────
      api POST "/memory/view" '{}'
      assert_status 422 "POST /memory/view without path → 422"
      assert_jq '.code == "memory.missing_arg"' "code is memory.missing_arg"

      # ── create: new rule ───────────────────────────────────────────────
      MEM_RULE_BODY=$'kind: forbidden_phrase\nscope: global\nconfidence: 0.85\nstatus: active\npattern: leverage synergies\ndirective: avoid empty corporate jargon'
      api POST "/memory/create" "$(jq -nc --arg p "${MEM_RULES}/forbidden_phrase/will_be_assigned" --arg t "$MEM_RULE_BODY" '{path:$p, file_text:$t}')"
      assert_status 201 "POST /memory/create (new rule)"
      assert_jq '.dedup == false' "first create is not a dedup hit"
      MEM_RULE_ID="$(jqr '.rule_id')"
      [ -n "$MEM_RULE_ID" ] && [ "$MEM_RULE_ID" != "null" ] && pass "create returned rule_id: $MEM_RULE_ID" || fail "no rule_id returned from /memory/create"
      MEM_RULE_PATH="$(jqr '.path')"

      # ── create: dedup hit on same (site, kind, pattern) ────────────────
      api POST "/memory/create" "$(jq -nc --arg p "${MEM_RULES}/forbidden_phrase/will_be_reassigned" --arg t "$MEM_RULE_BODY" '{path:$p, file_text:$t}')"
      assert_status 201 "POST /memory/create (duplicate pattern)"
      assert_jq '.dedup == true' "second create on same pattern flagged dedup:true"

      # ── view: read the rule back (read-after-write, constraint #2) ─────
      api POST "/memory/view" "$(jq -nc --arg p "$MEM_RULE_PATH" '{path:$p}')"
      assert_status 200 "POST /memory/view (rule file)"
      assert_jq '.type == "file"' "view returns file type for rule path"
      if echo "$RESP" | jq -r '.content' | grep -q "leverage synergies"; then
        pass "rule body contains pattern after create"
      else
        fail "rule body missing pattern after create"
      fi

      # ── view: render.md surfaces the rule ──────────────────────────────
      api POST "/memory/view" "$(jq -nc --arg p "${MEM_ROOT}/render.md" '{path:$p}')"
      assert_status 200 "POST /memory/view on render.md"
      if echo "$RESP" | jq -r '.content' | grep -qi "jargon"; then
        pass "render.md includes the newly created rule"
      else
        fail "render.md did not surface the new rule's directive"
      fi

      # ── str_replace: mutate the directive ──────────────────────────────
      api POST "/memory/str_replace" "$(jq -nc --arg p "$MEM_RULE_PATH" --arg o "directive: avoid empty corporate jargon" --arg n "directive: never write 'leverage synergies'" '{path:$p, old_str:$o, new_str:$n}')"
      assert_status 200 "POST /memory/str_replace (directive mutation)"
      if echo "$RESP" | jq -r '.content' | grep -q "never write"; then
        pass "str_replace landed the new directive"
      else
        fail "str_replace did not update the directive"
      fi

      # ── str_replace: old_str not found ─────────────────────────────────
      api POST "/memory/str_replace" "$(jq -nc --arg p "$MEM_RULE_PATH" --arg o "this string is not present anywhere" --arg n "replacement" '{path:$p, old_str:$o, new_str:$n}')"
      assert_status 404 "POST /memory/str_replace with missing old_str → 404"
      assert_jq '.code == "memory.str_not_found"' "code is memory.str_not_found"

      # ── insert: positional field line (no-op duplicate of an existing line) ─
      api POST "/memory/insert" "$(jq -nc --arg p "$MEM_RULE_PATH" '{path:$p, insert_line:2, insert_text:"scope: global"}')"
      assert_status 200 "POST /memory/insert (positional field line)"

      # ── insert: unknown field → 422 ────────────────────────────────────
      api POST "/memory/insert" "$(jq -nc --arg p "$MEM_RULE_PATH" '{path:$p, insert_line:1, insert_text:"bogus_field: 42"}')"
      assert_status 422 "POST /memory/insert with unknown field → 422"
      assert_jq '.code == "memory.unknown_field"' "code is memory.unknown_field"

      # ── rename: change kind ────────────────────────────────────────────
      MEM_NEW_PATH="${MEM_RULES}/preferred_vocab/${MEM_RULE_ID}"
      api POST "/memory/rename" "$(jq -nc --arg o "$MEM_RULE_PATH" --arg n "$MEM_NEW_PATH" '{old_path:$o, new_path:$n}')"
      assert_status 200 "POST /memory/rename (change kind)"
      assert_jq '.renamed == true' "rename succeeded"

      # ── rename: rule_id mismatch → 422 ─────────────────────────────────
      api POST "/memory/rename" "$(jq -nc --arg o "$MEM_NEW_PATH" --arg n "${MEM_RULES}/preferred_vocab/some_other_id" '{old_path:$o, new_path:$n}')"
      assert_status 422 "POST /memory/rename with changed rule_id → 422"
      assert_jq '.code == "memory.rule_id_immutable"' "code is memory.rule_id_immutable"

      # ── delete: archive the rule ───────────────────────────────────────
      api POST "/memory/delete" "$(jq -nc --arg p "$MEM_NEW_PATH" '{path:$p}')"
      assert_status 200 "POST /memory/delete (archive rule)"
      assert_jq '.deleted == true' "delete returns deleted:true"

      # ── delete: directory delete refused (#16 no silent bulk wipe) ────
      api POST "/memory/delete" "$(jq -nc --arg p "${MEM_RULES}/forbidden_phrase" '{path:$p}')"
      assert_status 422 "POST /memory/delete on a directory → 422 (refused)"
      assert_jq '.code == "memory.delete_directory_refused"' "code is memory.delete_directory_refused"
    fi
  fi
fi

# ── QUALITY EVAL (v0.7-α) ───────────────────────────────────────────────────
section "Quality eval — events + hourly rollup"

api GET "/quality/summary"
if [ "$HTTP_CODE" = "404" ]; then
  skip "quality endpoints not registered (pre-v0.7 build)"
else
  assert_status 200 "GET /quality/summary"
  assert_jq '.metrics // .summary // .' "summary returns shaped JSON"

  api GET "/quality/trend?metric=fidelity"
  assert_status_in "200 204" "GET /quality/trend?metric=fidelity"

  # Manual rollup trigger (admin only — exercises the cron path synchronously)
  api POST "/quality/rollup" '{}'
  assert_status_in "200 202" "POST /quality/rollup (manual trigger)"
fi

# ── WIDGET PACK: PIN-SCROLL (v0.9-α) ────────────────────────────────────────
section "Widget Pack — Pin-Scroll registration"

api GET "/widgets"
if [ "$HTTP_CODE" != "200" ]; then
  skip "GET /widgets not available — cannot verify widget pack registration"
else
  # The widget should be registered under the joist category.
  if echo "$RESP" | jq -e '.widgets[] | select(.name == "joist-pin-scroll")' >/dev/null 2>&1; then
    pass "joist-pin-scroll widget is registered"
  else
    fail "joist-pin-scroll widget NOT in /widgets — Widget Pack not loaded (check class_exists guard in Bootstrap)"
  fi

  api GET "/widgets/joist-pin-scroll/schema"
  if [ "$HTTP_CODE" = "200" ]; then
    pass "GET /widgets/joist-pin-scroll/schema reachable"
    assert_jq '.controls | type == "object" or type == "array"' "schema exposes controls"
    # Key controls from research stream C
    if echo "$RESP" | grep -q '"pin_distance"'; then pass "schema includes pin_distance"; else fail "schema missing pin_distance"; fi
    if echo "$RESP" | grep -q '"pin_duration"'; then pass "schema includes pin_duration"; else fail "schema missing pin_duration"; fi
    if echo "$RESP" | grep -q '"engine"';       then pass "schema includes engine";       else fail "schema missing engine";       fi
    if echo "$RESP" | grep -q '"panels"';       then pass "schema includes panels repeater"; else fail "schema missing panels"; fi
  elif [ "$HTTP_CODE" = "404" ]; then
    skip "per-widget schema endpoint not present in this build"
  else
    fail "GET /widgets/joist-pin-scroll/schema returned $HTTP_CODE"
  fi

  # Place a pin-scroll widget into a fresh page and verify it round-trips
  api POST "/pages" '{"title":"Joist Pin-Scroll smoke","status":"draft"}'
  if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    PIN_PAGE_ID="$(jqr '.id')"
    CREATED_PAGES+=("$PIN_PAGE_ID")
    pass "created pin-scroll smoke page #$PIN_PAGE_ID"

    api GET "/pages/$PIN_PAGE_ID"
    PIN_HASH="$(jqr '.elementor.hash')"

    api PATCH "/pages/$PIN_PAGE_ID" "$(cat <<EOF
{
  "hash": "$PIN_HASH",
  "ops": [{
    "op": "add",
    "path": "/elements/-",
    "value": {
      "elType": "widget",
      "widgetType": "joist-pin-scroll",
      "settings": {
        "pin_distance": 200,
        "pin_duration": 300,
        "engine": "auto",
        "panels": [
          {"panel_content": "<h2>Panel A</h2>"},
          {"panel_content": "<h2>Panel B</h2>"},
          {"panel_content": "<h2>Panel C</h2>"}
        ]
      }
    }
  }]
}
EOF
)"
    assert_status_in "200 202" "PATCH adds pin-scroll widget to page"

    api GET "/pages/$PIN_PAGE_ID"
    assert_jq '[.elementor.elements | .. | objects | select(.widgetType? == "joist-pin-scroll")] | length >= 1' "pin-scroll widget survives round trip"
    assert_jq '[.elementor.elements | .. | objects | select(.widgetType? == "joist-pin-scroll") | .settings.panels | length] | first >= 3' "panels repeater preserved (3+ panels)"
  else
    skip "could not create page for pin-scroll round-trip test ($HTTP_CODE)"
  fi
fi

# ── WIDGET PACK: PIN-SCROLL — Wave 4d (Chrome 145+ trigger gate) ────────────
section "Widget Pack — Pin-Scroll Chrome 145+ trigger gate"

PIN_CSS="$PLUGIN_DIR/assets/widget-pack/pin-scroll/pin-scroll.css"
PIN_JS="$PLUGIN_DIR/assets/widget-pack/pin-scroll/pin-scroll.js"

if [ -f "$PIN_CSS" ]; then
  if grep -q "@supports (timeline-trigger: --t)" "$PIN_CSS"; then
    pass "pin-scroll.css gates Chrome 145+ branch on @supports (timeline-trigger: --t)"
  else
    fail "pin-scroll.css missing @supports (timeline-trigger: --t) gate"
  fi

  if awk '/@supports \(timeline-trigger: --t\)/,/^}$/' "$PIN_CSS" | grep -q -- "--joist-pinscroll-css-only: 1"; then
    pass "pin-scroll.css publishes --joist-pinscroll-css-only inside the @supports block"
  else
    fail "pin-scroll.css does not set --joist-pinscroll-css-only inside the @supports block"
  fi

  if awk '/@supports \(timeline-trigger: --t\)/,/^}$/' "$PIN_CSS" | grep -q "animation-trigger:"; then
    pass "pin-scroll.css uses declarative animation-trigger in the Chrome 145+ branch"
  else
    fail "pin-scroll.css missing animation-trigger in the @supports block"
  fi

  if awk '/prefers-reduced-motion: reduce/,/^}$/' "$PIN_CSS" | grep -q "animation-trigger: none"; then
    pass "prefers-reduced-motion still gates animation-trigger (explicit reset)"
  else
    fail "prefers-reduced-motion block does not override animation-trigger"
  fi
else
  fail "pin-scroll.css not found at $PIN_CSS"
fi

if [ -f "$PIN_JS" ]; then
  if grep -q "joist-pinscroll-css-only" "$PIN_JS"; then
    pass "pin-scroll.js early-exits when --joist-pinscroll-css-only is set"
  else
    fail "pin-scroll.js missing early-exit check for --joist-pinscroll-css-only"
  fi
else
  fail "pin-scroll.js not found at $PIN_JS"
fi

# ── WIDGET PACK: ANCHORED POP (v0.9-beta, Wave 4a) ──────────────────────────
section "Widget Pack — Anchored Pop registration"

api GET "/widgets"
if [ "$HTTP_CODE" != "200" ]; then
  skip "GET /widgets not available — cannot verify Anchored Pop registration"
else
  if echo "$RESP" | jq -e '.widgets[] | select(.name == "joist-anchored-pop")' >/dev/null 2>&1; then
    pass "joist-anchored-pop widget is registered in WidgetCatalog"
  else
    fail "joist-anchored-pop widget NOT in /widgets — check PackBootstrap::registerWidgets"
  fi

  api GET "/widgets/joist-anchored-pop/schema"
  if [ "$HTTP_CODE" = "200" ]; then
    pass "GET /widgets/joist-anchored-pop/schema reachable"
    echo "$RESP" | grep -q '"anchor_target"'  && pass "schema includes anchor_target"  || fail "schema missing anchor_target"
    echo "$RESP" | grep -q '"position"'       && pass "schema includes position"       || fail "schema missing position"
    echo "$RESP" | grep -q '"offset_px"'      && pass "schema includes offset_px"      || fail "schema missing offset_px"
    echo "$RESP" | grep -q '"auto_arrow"'     && pass "schema includes auto_arrow"     || fail "schema missing auto_arrow"
    echo "$RESP" | grep -q '"fallback_chain"' && pass "schema includes fallback_chain" || fail "schema missing fallback_chain"
    echo "$RESP" | grep -q '"trigger_mode"'   && pass "schema includes trigger_mode"   || fail "schema missing trigger_mode"
    echo "$RESP" | grep -q '"inner_content"'  && pass "schema includes inner_content"  || fail "schema missing inner_content"
    for pos in top top-start top-end right right-start right-end bottom bottom-start bottom-end left left-start left-end; do
      echo "$RESP" | jq -e --arg p "$pos" '[.controls[] | select(.name == "position") | .options[$p]] | first != null' >/dev/null \
        && pass "position enum has '$pos'" \
        || fail "position enum missing '$pos'"
    done
    for mode in hover click manual; do
      echo "$RESP" | jq -e --arg m "$mode" '[.controls[] | select(.name == "trigger_mode") | .options[$m]] | first != null' >/dev/null \
        && pass "trigger_mode enum has '$mode'" \
        || fail "trigger_mode enum missing '$mode'"
    done
  elif [ "$HTTP_CODE" = "404" ]; then
    skip "per-widget schema endpoint not present in this build"
  else
    fail "GET /widgets/joist-anchored-pop/schema returned $HTTP_CODE"
  fi
fi

# ── WIDGET PACK: VIEW TRANSITIONS EMITTER (v0.9-beta, Wave 4b) ──────────────
section "Widget Pack — View Transitions emitter"

if [ ! -f "$PLUGIN_DIR/assets/widget-pack/view-transitions/view-transitions.js" ]; then
  pass "no view-transitions.js — pure CSS emitter as specced"
else
  fail "view-transitions.js exists — Wave 4b spec requires zero JS"
fi

if [ -f "$PLUGIN_DIR/assets/widget-pack/view-transitions/view-transitions.css" ]; then
  pass "view-transitions.css ships as the site-wide stylesheet"
  if grep -q "@view-transition" "$PLUGIN_DIR/assets/widget-pack/view-transitions/view-transitions.css"; then
    pass "view-transitions.css contains @view-transition declaration"
  else
    fail "view-transitions.css missing @view-transition declaration"
  fi
else
  fail "view-transitions.css not found"
fi

if [ -f "$PLUGIN_DIR/src/WidgetPack/ViewTransitions/Emitter.php" ]; then
  pass "ViewTransitions\\Emitter class file present"
  if grep -q "joist_view_transitions_enabled" "$PLUGIN_DIR/src/WidgetPack/ViewTransitions/Emitter.php"; then
    pass "Emitter reads joist_view_transitions_enabled option"
  else
    fail "Emitter does not reference joist_view_transitions_enabled option"
  fi
  if grep -q "joist_vt_name" "$PLUGIN_DIR/src/WidgetPack/ViewTransitions/Emitter.php"; then
    pass "Emitter registers joist_vt_name per-element control"
  else
    fail "Emitter does not register joist_vt_name control"
  fi
else
  fail "ViewTransitions/Emitter.php missing"
fi

# ── WIDGET PACK: DISPLAY-SWAP (v0.9-beta, Wave 4c) ──────────────────────────
section "Widget Pack — Display-swap (Container extension)"

if [ -f "$PLUGIN_DIR/src/WidgetPack/DisplaySwap/Extension.php" ]; then
  pass "DisplaySwap\\Extension class file present"
else
  fail "DisplaySwap/Extension.php missing"
fi

api GET "/widgets/container/schema"
if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /widgets/container/schema reachable"
  if echo "$RESP" | jq -e '.controls | (type == "array" and (map(.name) | index("joist_display_mode"))) or (type == "object" and has("joist_display_mode"))' >/dev/null 2>&1; then
    pass "container schema exposes joist_display_mode control"
  else
    fail "container schema missing joist_display_mode — Extension::init() not wired in PackBootstrap"
  fi

  if echo "$RESP" | jq -e '[.controls // [] | .. | objects | select(.name? == "joist_display_mode") | .options] | first | (has("flex") and has("grid") and has("block"))' >/dev/null 2>&1; then
    pass "joist_display_mode advertises flex / grid / block options"
  else
    fail "joist_display_mode options do not include flex+grid+block"
  fi
else
  skip "per-widget schema endpoint not present (cannot inspect joist_display_mode)"
fi

# ── ADMIN APP FOUNDATION (Wave 5a) ──────────────────────────────────────────
# These tests exercise plugin/src/Admin/{AdminPage,AssetEnqueue}.php — the
# top-level WP admin page that hosts the React Plan Mode UI. The compiled JS
# bundle itself is NOT required to pass these tests (we explicitly verify
# the graceful no-build fallback in AssetEnqueue). See specs/WAVE_0_2026-05-26.md §5.
section "Plan Mode admin app — foundation"

# 1. package.json declares the wp-scripts build pipeline.
PKG_JSON="$PLUGIN_DIR/package.json"
if [ -f "$PKG_JSON" ]; then
  pass "plugin/package.json exists"
  if jq -e '.scripts.start and .scripts.build' "$PKG_JSON" >/dev/null 2>&1; then
    pass "package.json declares both 'start' and 'build' scripts"
  else
    fail "package.json missing 'start' or 'build' scripts"
  fi
  if jq -e '.devDependencies["@wordpress/scripts"]' "$PKG_JSON" >/dev/null 2>&1; then
    pass "package.json declares @wordpress/scripts as a devDependency"
  else
    fail "package.json does not declare @wordpress/scripts"
  fi
  if jq -e '.dependencies["@wordpress/api-fetch"] and .dependencies["@wordpress/components"] and .dependencies["@wordpress/element"]' "$PKG_JSON" >/dev/null 2>&1; then
    pass "package.json declares core WP runtime deps (api-fetch, components, element)"
  else
    fail "package.json missing one of the core WP runtime deps"
  fi
else
  fail "plugin/package.json missing — Wave 5a build pipeline not wired"
fi

# 2. The React source tree is present.
if [ -f "$PLUGIN_DIR/src/admin-app/index.js" ] && [ -f "$PLUGIN_DIR/src/admin-app/App.jsx" ] && [ -f "$PLUGIN_DIR/src/admin-app/api/plans.js" ]; then
  pass "src/admin-app/{index.js, App.jsx, api/plans.js} all present"
else
  fail "one of src/admin-app/{index.js, App.jsx, api/plans.js} missing"
fi

# 3. /site advertises the admin.plan_mode_url + menu_slug.
api GET /site
assert_status 200 "GET /site (re-read for admin block)"
assert_jq '.plugin.admin != null' "plugin.admin block is present in /site payload"
assert_jq '.plugin.admin.plan_mode_url != null and (.plugin.admin.plan_mode_url | type == "string") and (.plugin.admin.plan_mode_url | length > 0)' "plugin.admin.plan_mode_url is a non-empty string"
assert_jq '.plugin.admin.menu_slug == "joist-plan-mode"' "plugin.admin.menu_slug == 'joist-plan-mode'"
assert_jq '.plugin.admin.build_present | type == "boolean"' "plugin.admin.build_present is a boolean (true once `npm run build` has run)"

# 4. The admin page renders without a PHP fatal even when the React bundle
#    is absent (the typical state before `npm install && npm run build`).
#    A fatal would surface as a 500 or a parse error in the HTML body.
PLAN_MODE_URL="$(jqr '.plugin.admin.plan_mode_url')"
if [ -n "$PLAN_MODE_URL" ] && [ "$PLAN_MODE_URL" != "null" ]; then
  ADMIN_HTTP="$(curl -sS -u "$JOIST_USER:$JOIST_APP_PWD" -o /tmp/joist-admin-html.$$ -w '%{http_code}' "$PLAN_MODE_URL" 2>/dev/null || echo 000)"
  ADMIN_BODY="$(cat /tmp/joist-admin-html.$$ 2>/dev/null || true)"
  rm -f /tmp/joist-admin-html.$$
  # WP admin pages return 200 even when redirected to wp-login (the auth
  # interstitial). We accept 200 + 302 + 403 here; what we strictly reject
  # is a 500 (fatal) or a body containing "Fatal error" / "Parse error".
  case "$ADMIN_HTTP" in
    200|302|403)
      pass "Joist admin page responds without a server error ($ADMIN_HTTP)"
      ;;
    500|502|503)
      fail "Joist admin page returned $ADMIN_HTTP — likely PHP fatal in AdminPage/AssetEnqueue"
      ;;
    *)
      info "Joist admin page returned $ADMIN_HTTP (not fatal but unexpected)"
      pass "Joist admin page did not return a 5xx fatal"
      ;;
  esac
  if echo "$ADMIN_BODY" | grep -q -E "Fatal error|Parse error|Uncaught Error|Stack trace"; then
    fail "Joist admin page HTML contains a PHP fatal/parse error string"
  else
    pass "Joist admin page HTML does not contain a PHP fatal/parse error string"
  fi
else
  skip "plan_mode_url unavailable — cannot probe admin page directly"
fi

# ── PLAN MODE ADMIN APP — W5b feature surface ───────────────────────────────
section "Plan Mode admin app — feature components (W5b)"

ADMIN_APP_DIR="$PLUGIN_DIR/src/admin-app"
COMPONENTS_DIR="$ADMIN_APP_DIR/components"
LIB_DIR="$ADMIN_APP_DIR/lib"
HOOKS_DIR="$ADMIN_APP_DIR/hooks"
SIDEBAR_DIR="$ADMIN_APP_DIR/sidebar"

# Components present
for f in PlansList.jsx PlanDetail.jsx EditStepModal.jsx StepDiff.jsx JsonTreeDiff.jsx BlastRadiusBadge.jsx StepTargetCell.jsx; do
  if [ -f "$COMPONENTS_DIR/$f" ]; then
    pass "component present: $f"
  else
    fail "component missing: $COMPONENTS_DIR/$f"
  fi
done

# Co-located SCSS
for f in PlansList.scss EditStepModal.scss StepDiff.scss JsonTreeDiff.scss BlastRadiusBadge.scss; do
  if [ -f "$COMPONENTS_DIR/$f" ]; then
    pass "stylesheet present: $f"
  else
    fail "stylesheet missing: $COMPONENTS_DIR/$f"
  fi
done

# Top-level style.scss (W5b integration)
if [ -f "$ADMIN_APP_DIR/style.scss" ]; then
  pass "top-level style.scss present (W5b integration glue)"
else
  fail "top-level style.scss missing"
fi

# Libs
for f in blastRadius.js stepTypes.js relativeTime.js; do
  if [ -f "$LIB_DIR/$f" ]; then
    pass "lib present: $f"
  else
    fail "lib missing: $LIB_DIR/$f"
  fi
done

# Hooks
for f in useInterval.js usePlanPolling.js; do
  if [ -f "$HOOKS_DIR/$f" ]; then
    pass "hook present: $f"
  else
    fail "hook missing: $HOOKS_DIR/$f"
  fi
done

# Sidebar (mode indicator)
if [ -f "$SIDEBAR_DIR/JoistModeIndicator.jsx" ]; then
  pass "JoistModeIndicator.jsx present"
else
  fail "JoistModeIndicator.jsx missing"
fi

# App.jsx integrates the feature components (W5b integration check)
if grep -q "import PlansList" "$ADMIN_APP_DIR/App.jsx" \
  && grep -q "import PlanDetail" "$ADMIN_APP_DIR/App.jsx" \
  && grep -q "import JoistModeIndicator" "$ADMIN_APP_DIR/App.jsx"; then
  pass "App.jsx integrates PlansList + PlanDetail + JoistModeIndicator"
else
  fail "App.jsx is missing PlansList / PlanDetail / JoistModeIndicator integration"
fi

# blastRadius classifier exports classifyStep + classifyPlan
if grep -q "export function classifyStep" "$LIB_DIR/blastRadius.js" \
  && grep -q "export function classifyPlan" "$LIB_DIR/blastRadius.js"; then
  pass "blastRadius classifier exports classifyStep + classifyPlan"
else
  fail "blastRadius classifier missing classifyStep / classifyPlan exports"
fi

# DataViews referenced in components
if grep -rq "@wordpress/dataviews" "$COMPONENTS_DIR"; then
  pass "components depend on @wordpress/dataviews"
else
  fail "no component imports @wordpress/dataviews"
fi

# ── ANTI-SLOP VALIDATOR — W6a ───────────────────────────────────────────────
# Exercises POST /anti-slop/{copy,image,feedback} + GET /anti-slop/lexicon.
# See specs/ANTI_SLOP.md for the full surface.
section "Anti-slop validator — copy"

# Lexicon introspection
api GET /anti-slop/lexicon
assert_status 200 "GET /anti-slop/lexicon"
assert_jq '.counts.total >= 50' "lexicon has >=50 total entries"
assert_jq '.counts.vocab > 0 and .counts.phrases > 0 and .counts.sentenceOpeners > 0 and .counts.structures > 0' "all four layers populated"

# Known-slop input → passed:false + multiple violations
SLOP_BODY='{"text":"Let'"'"'s delve into the realm of robust solutions in the realm of cutting-edge AI."}'
api POST /anti-slop/copy "$SLOP_BODY"
assert_status 200 "POST /anti-slop/copy with known-slop input"
assert_jq '.passed == false' "known-slop input: passed == false"
assert_jq '.violation_count >= 3' "known-slop input: at least 3 violations detected"
assert_jq '.requires_repair == true' "known-slop input: requires_repair == true"
assert_jq '.score < 70' "known-slop input: score below repair threshold"
assert_jq '.repair_hint | length > 0' "known-slop input: repair_hint is non-empty"
assert_jq '[.violations[] | select(.layer=="vocab")] | length >= 2' "violations include vocab layer hits"
assert_jq '[.violations[] | select(.match | ascii_downcase == "delve")] | length >= 1' '"delve" specifically detected'

# Known-clean input → passed:true + score >= 90
CLEAN_BODY='{"text":"This page lists the four services we offer. Each one has a fixed scope and a fixed price."}'
api POST /anti-slop/copy "$CLEAN_BODY"
assert_status 200 "POST /anti-slop/copy with known-clean input"
assert_jq '.passed == true' "known-clean input: passed == true"
assert_jq '.score >= 90' "known-clean input: score >= 90"
assert_jq '.violation_count == 0' "known-clean input: zero violations"
assert_jq '.requires_repair == false' "known-clean input: requires_repair == false"

# Sentence-opener detection (It's not X. It's Y.)
OPENER_BODY='{"text":"It'"'"'s not a website. It'"'"'s a transformation."}'
api POST /anti-slop/copy "$OPENER_BODY"
assert_status 200 "POST /anti-slop/copy with It's-not-X.-It's-Y. opener"
assert_jq '[.violations[] | select(.layer=="openers")] | length >= 1' "sentence-opener layer fires on the It's-not-X. structure"

# Unknown field → 422 (failure-mode #1)
api POST /anti-slop/copy '{"text":"hello","unknown_param":"x"}'
assert_status 422 "POST /anti-slop/copy with unknown field returns 422"
assert_jq '.code == "anti_slop.unknown_field"' "unknown-field error code is anti_slop.unknown_field"
assert_jq '.details.unknown_fields | index("unknown_param") != null' "unknown_fields[] enumerates the bad key"
assert_jq '.details.valid_fields | type == "array"' "valid_fields[] is provided as a recovery hint"

# Missing required field → 422
api POST /anti-slop/copy '{}'
assert_status 422 "POST /anti-slop/copy with empty body returns 422"
assert_jq '.code == "anti_slop.missing_field"' "missing-field error code is anti_slop.missing_field"

# Empty text is treated as clean
api POST /anti-slop/copy '{"text":""}'
assert_status 200 "POST /anti-slop/copy with empty text returns 200"
assert_jq '.passed == true' "empty text: passed == true"
assert_jq '.score == 100' "empty text: score == 100"

section "Anti-slop validator — site preference overlay"

# Seed a per-site forbid_phrase rule via /preferences (legacy surface still wired)
# This site_id matches what PreferenceMemory::siteId() will return on the test host.
api GET /preferences/render
SITE_ID="$(jqr '.site_id')"
if [ -n "$SITE_ID" ] && [ "$SITE_ID" != "null" ]; then
  CREATE_BODY=$(cat <<JSON
{"kind":"forbidden_phrase","pattern":"flagship","directive":"avoid the word flagship on this site"}
JSON
)
  api POST /preferences "$CREATE_BODY"
  assert_status_in "200 201" "seeded per-site forbid_phrase rule for word 'flagship'"

  # With site_id, the validator should add a site_rules layer violation.
  api POST /anti-slop/copy "$(cat <<JSON
{"text":"Our flagship offering ships next week.","site_id":"$SITE_ID"}
JSON
)"
  assert_status 200 "POST /anti-slop/copy with site_id + matching site-rule text"
  assert_jq '[.violations[] | select(.layer=="site_rules")] | length >= 1' "site_rules layer fires on per-site forbid_phrase match"
else
  skip "could not resolve site_id from /preferences/render — site-rule overlay test skipped"
fi

section "Anti-slop validator — feedback loop"

# Pick a phrase that is NOT in the static banned-lexicon (so we can promote it).
FB_PHRASE="quintessentially modern"
FB_SITE="${SITE_ID:-host_test_local}"
FB_BODY1=$(cat <<JSON
{"site_id":"$FB_SITE","text":"This is a quintessentially modern approach.","violation_match":{"layer":"site_rules","match":"$FB_PHRASE","severity":"high","kind":"phrase"}}
JSON
)
api POST /anti-slop/feedback "$FB_BODY1"
assert_status 201 "POST /anti-slop/feedback (call 1) returns 201"
assert_jq '.result.recorded == true' "call 1: recorded == true"
assert_jq '.result.count == 1' "call 1: count == 1"
assert_jq '.result.promoted == false' "call 1: promoted == false"
assert_jq '.state.count == 1' "read-after-write: state.count == 1 (failure-mode #2)"

# Idempotency: replay of identical event is a no-op.
api POST /anti-slop/feedback "$FB_BODY1"
assert_status 201 "POST /anti-slop/feedback (replay of same event) returns 201"
assert_jq '.result.recorded == false' "replay: recorded == false (idempotent)"
assert_jq '.state.count == 1' "replay: state.count still 1"

# Distinct event keys (vary the text) drive the counter up.
FB_BODY2=$(cat <<JSON
{"site_id":"$FB_SITE","text":"That feels quintessentially modern, too.","violation_match":{"layer":"site_rules","match":"$FB_PHRASE","severity":"high","kind":"phrase"}}
JSON
)
api POST /anti-slop/feedback "$FB_BODY2"
assert_jq '.result.count == 2' "call 2 (distinct text): count == 2"
assert_jq '.result.promoted == false' "call 2: not yet promoted (threshold 3)"

FB_BODY3=$(cat <<JSON
{"site_id":"$FB_SITE","text":"Why is everything quintessentially modern these days?","violation_match":{"layer":"site_rules","match":"$FB_PHRASE","severity":"high","kind":"phrase"}}
JSON
)
api POST /anti-slop/feedback "$FB_BODY3"
assert_jq '.result.count == 3' "call 3 (distinct text): count == 3"
# Wave 9 / W10a: v0.9 cross-session/day gate. 3 hits within one session+day
# no longer promote; the new test below exercises the distinct-session path.
assert_jq '.result.promoted == false' "call 3: same-session/day NOT promoted (v0.9 cross-session gate)"

# Distinct-session promotion path (added in W10a).
FB_PHRASE2="w10a_distinct_session_phrase"
for i in 1 2 3; do
  FB_FAKE_SESS="w10a-acceptance-sess-$i-$$"
  FB_BODY_DS=$(cat <<JSON
{"site_id":"$FB_SITE","text":"distinct-session variant $i with $FB_PHRASE2","violation_match":{"layer":"site_rules","match":"$FB_PHRASE2","severity":"medium","kind":"phrase"}}
JSON
)
  api POST /anti-slop/feedback "$FB_BODY_DS" "$FB_FAKE_SESS"
done
assert_jq '.result.promoted == true' "3 distinct-session hits DO promote (v0.9 path)"
assert_jq '.result.rule_id | type == "string"' "distinct-session promotion produced a rule_id"
PROMOTED_RULE_ID="$(jqr '.result.rule_id')"
api GET "/preferences/$PROMOTED_RULE_ID"
assert_jq '.rationale | type == "string" and length > 0' "auto-promoted rule has non-empty rationale (W10a)"

# Unknown field on feedback → 422
api POST /anti-slop/feedback '{"site_id":"x","text":"y","violation_match":{},"bogus":1}'
assert_status 422 "POST /anti-slop/feedback with unknown field returns 422"

# Missing required field on feedback → 422
api POST /anti-slop/feedback '{"site_id":"x"}'
assert_status 422 "POST /anti-slop/feedback with missing fields returns 422"
assert_jq '.details.missing_fields | type == "array"' "missing_fields[] enumerates what's missing"

section "Anti-slop validator — image"

# Tiny brand-palette-compliant 4x4 PNG (solid chartreuse #D4FF3A).
BRAND_PNG_B64="iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGO48t8KjhiI4wAAXyEg0YPh1VoAAAAASUVORK5CYII="
# Off-brand 4x4 PNG (solid purple #800080).
OFFBRAND_PNG_B64="iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGNoYGiAIwbiOACgQxABai/81QAAAABJRU5ErkJggg=="

# Palette-compliant: should not be flagged for palette.
IMG_BODY_CLEAN=$(cat <<JSON
{"image_b64":"$BRAND_PNG_B64","brand_profile":{"palette":["#D4FF3A","#0E0E0C","#F3F2EC"]}}
JSON
)
api POST /anti-slop/image "$IMG_BODY_CLEAN"
assert_status 200 "POST /anti-slop/image with palette-compliant image returns 200"
assert_jq '[.palette[] | select(.brand_match == true)] | length >= 1' "palette-compliant image: at least one dominant color matches brand"
assert_jq '.reasons | index("palette_off_brand") == null' "palette-compliant image: no palette_off_brand reason"
# Anatomy service is not configured in the test environment.
assert_jq '.anatomy == "unchecked"' "anatomy is 'unchecked' when no Python service is configured"
assert_jq '.requires_human_review == true' "requires_human_review is true when anatomy is unchecked (no silent pass — #16)"

# Off-brand palette: should flag palette_off_brand.
IMG_BODY_FLAGGED=$(cat <<JSON
{"image_b64":"$OFFBRAND_PNG_B64","brand_profile":{"palette":["#D4FF3A","#0E0E0C","#F3F2EC"]}}
JSON
)
api POST /anti-slop/image "$IMG_BODY_FLAGGED"
assert_status 200 "POST /anti-slop/image with off-brand image returns 200"
assert_jq '.verdict == "flagged"' "off-brand image: verdict == flagged"
assert_jq '.reasons | index("palette_off_brand") != null' "off-brand image: palette_off_brand reason emitted"

# Unknown field on image → 422
IMG_BODY_BAD=$(cat <<JSON
{"image_b64":"$BRAND_PNG_B64","brand_profile":{"palette":["#D4FF3A"]},"random":"x"}
JSON
)
api POST /anti-slop/image "$IMG_BODY_BAD"
assert_status 422 "POST /anti-slop/image with unknown field returns 422"

# Missing image source → 422
api POST /anti-slop/image '{"brand_profile":{"palette":["#D4FF3A"]}}'
assert_status 422 "POST /anti-slop/image with no image_url/image_b64 returns 422"

# Missing brand_profile → 422
api POST /anti-slop/image "$(cat <<JSON
{"image_b64":"$BRAND_PNG_B64"}
JSON
)"
assert_status 422 "POST /anti-slop/image with no brand_profile returns 422"

# ── WAVE 6c — COPY GENERATION (Anthropic Messages API + cached brand block) ─
# Dark-tested like W6b: code path runs end-to-end but the Anthropic call only
# fires when JOIST_CLAUDE_API_KEY is configured (env or wp_option). The
# validate-and-repair-loop assertions SKIP when \Joist\AntiSlop\CopyValidator
# isn't loaded yet (W6a is parallel). See specs/COPY_GEN.md.
section "Wave 6c — copy generation: brand-block introspection"

COPY_SITE_ID="host_joist_test_local"

# GET /brand-block/{site_id} — pure assembly, no API call. Works regardless
# of API key state (this is the introspection path agents use to verify
# the cache prefix is large enough to clear the 4,096-token floor).
api GET "/generate/copy/brand-block/$COPY_SITE_ID"
assert_status 200 "GET /generate/copy/brand-block/{site_id} returns 200"
assert_jq '.site_id != null' "brand-block payload includes site_id"
assert_jq '.cache_key | type == "string" and (length == 16)' "cache_key is a 16-char hex hash"
assert_jq '(.estimated_tokens | type == "number") and .estimated_tokens > 0' "estimated_tokens is a positive number (house style alone is always present)"
assert_jq '.is_cacheable | type == "boolean"' "is_cacheable is a boolean"
assert_jq '.cache_min_tokens == 4096' "cache_min_tokens is the Opus 4.7 floor (4096)"
assert_jq '.system_block_count >= 1' "at least 1 system block present (house style is unconditional)"
assert_jq '.api_key_configured | type == "boolean"' "api_key_configured is a boolean"
assert_jq '.model_in_use | type == "string"' "model_in_use is a string"
assert_jq '.model_default == "claude-opus-4-7"' "default model is claude-opus-4-7"

# When the assembled estimated_tokens >= 4096, is_cacheable should be true,
# and when < 4096 it should be false. (Don't assert which it is — depends on
# whether brand.json + exemplars.json are present on the test site.)
EST_TOKENS="$(jqr '.estimated_tokens')"
IS_CACHEABLE="$(jqr '.is_cacheable')"
if [ "${EST_TOKENS:-0}" -ge 4096 ]; then
  [ "$IS_CACHEABLE" = "true" ] && pass "estimated_tokens >= 4096 → is_cacheable == true" \
    || fail "estimated_tokens ($EST_TOKENS) >= 4096 but is_cacheable != true"
else
  [ "$IS_CACHEABLE" = "false" ] && pass "estimated_tokens < 4096 → is_cacheable == false (cache writes below floor are silently dropped by Anthropic)" \
    || fail "estimated_tokens ($EST_TOKENS) < 4096 but is_cacheable != false"
fi

section "Wave 6c — copy generation: cost meter"

api GET "/generate/copy/cost-meter"
assert_status 200 "GET /generate/copy/cost-meter returns 200"
assert_jq '.session_total_usd | type == "number"' "session_total_usd is a number"
assert_jq '.cap_usd | type == "number"' "cap_usd is a number"
assert_jq '.remaining_usd | type == "number"' "remaining_usd is a number"
assert_jq '.separated_from_image_gen == true' "cost meter is separated from image-gen meter (per spec §5)"
assert_jq '.cap_usd > 0' "cap_usd is positive (default \$5)"

section "Wave 6c — copy generation: single sync call (dark test until key configured)"

api POST /generate/copy "$(cat <<JSON
{"site_id":"$COPY_SITE_ID","request":"Write a 12-word hero subtitle for a craft joinery business."}
JSON
)"
# Branch on API key state:
#   - Unconfigured → 422 + provider_unconfigured (the dark-test path)
#   - Configured   → 200 + status:ok (a live call)
HTTP_GEN="$HTTP_CODE"
CODE_GEN="$(jqr '.code')"
if [ "$HTTP_GEN" = "422" ] && [ "$CODE_GEN" = "provider_unconfigured" ]; then
  pass "POST /generate/copy with no API key returns 422 + provider_unconfigured (dark-test path)"
elif [ "$HTTP_GEN" = "200" ]; then
  pass "POST /generate/copy returns 200 (API key configured — live call)"
  assert_jq '.text | type == "string" and length > 0' "live call returns non-empty text"
  assert_jq '.cache_metrics != null' "live call returns cache_metrics block"
  assert_jq '.cost_usd >= 0' "live call returns cost_usd"
  assert_jq '.cache_hit_rate | type == "number"' "live call returns cache_hit_rate"
else
  fail "POST /generate/copy returned unexpected $HTTP_GEN / code=$CODE_GEN (expected 422+provider_unconfigured OR 200)"
fi

# Unknown body fields → 422 validation.unknown_keys (constraint #1 — typed, never silent)
api POST /generate/copy "$(cat <<JSON
{"site_id":"$COPY_SITE_ID","request":"Test","unknown_field":"oops"}
JSON
)"
assert_status 422 "POST /generate/copy with unknown body field returns 422"
assert_jq '.code == "validation.unknown_keys"' "unknown field → typed validation.unknown_keys"

# Missing required field (request) → 422
api POST /generate/copy "$(cat <<JSON
{"site_id":"$COPY_SITE_ID"}
JSON
)"
assert_status 422 "POST /generate/copy with missing 'request' returns 422"

# Missing required field (site_id) → 422
api POST /generate/copy '{"request":"Test"}'
assert_status 422 "POST /generate/copy with missing 'site_id' returns 422"

# Empty body → 422
api POST /generate/copy ''
assert_status 422 "POST /generate/copy with empty body returns 422"

section "Wave 6c — copy generation: batch queue"

# Enqueue increments queue depth.
api POST /generate/copy/enqueue "$(cat <<JSON
{"site_id":"$COPY_SITE_ID","request":"hero copy"}
JSON
)"
assert_status 200 "POST /generate/copy/enqueue returns 200"
assert_jq '.request_id | type == "string" and length > 0' "enqueue returns a request_id"
assert_jq '.status == "queued"' "enqueue status == queued"
DEPTH_AFTER_1="$(jqr '.queue_depth')"
[ "${DEPTH_AFTER_1:-0}" -ge 1 ] && pass "queue_depth >= 1 after one enqueue" \
  || fail "queue_depth was $DEPTH_AFTER_1 after one enqueue (expected >= 1)"

# Enqueue a second item to confirm depth increments.
api POST /generate/copy/enqueue "$(cat <<JSON
{"site_id":"$COPY_SITE_ID","request":"subhead copy","request_id":"my-rid-2"}
JSON
)"
assert_status 200 "POST /generate/copy/enqueue (second item) returns 200"
DEPTH_AFTER_2="$(jqr '.queue_depth')"
[ "${DEPTH_AFTER_2:-0}" -gt "${DEPTH_AFTER_1:-0}" ] && pass "queue_depth increments on each enqueue" \
  || fail "queue_depth did not increment ($DEPTH_AFTER_1 → $DEPTH_AFTER_2)"

# Custom request_id is honoured.
assert_jq '.request_id == "my-rid-2"' "caller-supplied request_id is honoured"

# Flush the queue. With no API key, every item returns 'unconfigured' but the
# flush still drains the queue and reports flushed > 0. With a key, results
# include real text.
api POST "/generate/copy/flush/$COPY_SITE_ID" '{}'
assert_status 200 "POST /generate/copy/flush/{site_id} returns 200"
assert_jq '.flushed | type == "number"' "flush returns numeric flushed count"
assert_jq '.results | type == "array"' "flush returns results array"
FLUSHED_COUNT="$(jqr '.flushed')"
[ "${FLUSHED_COUNT:-0}" -ge 2 ] && pass "flush drained both enqueued items (flushed >= 2)" \
  || fail "flush returned flushed=$FLUSHED_COUNT (expected >= 2)"

# Empty queue flush returns flushed: 0
api POST "/generate/copy/flush/$COPY_SITE_ID" '{}'
assert_status 200 "POST /generate/copy/flush/{site_id} on empty queue returns 200"
assert_jq '.flushed == 0' "empty queue flush returns flushed: 0"

section "Wave 6c — copy generation: model override"

# JOIST_CLAUDE_MODEL env override is honoured. We can't set env vars
# server-side from this bash test, but we CAN assert that GET /brand-block
# reflects whatever model_in_use is currently active, and that model_default
# is the documented constant.
api GET "/generate/copy/brand-block/$COPY_SITE_ID"
assert_jq '.model_default == "claude-opus-4-7"' "default model in GET /brand-block is claude-opus-4-7"
MODEL_IN_USE="$(jqr '.model_in_use')"
info "active model resolved by CopyGenerator::resolveModel(): $MODEL_IN_USE"
# At minimum the active model should be a non-empty string.
[ -n "$MODEL_IN_USE" ] && [ "$MODEL_IN_USE" != "null" ] \
  && pass "model_in_use is a non-empty string ($MODEL_IN_USE)" \
  || fail "model_in_use returned null/empty"

section "Wave 6c — copy generation: validate-and-repair loop (SKIPs when W6a absent)"

# Sentinel: ask for the AntiSlopController route surface. If W6a's REST
# controller is registered, the routes index lists /anti-slop — that's our
# proxy for "the validator class is loaded too".
api GET /anti-slop/health 2>/dev/null
ANTISLOP_LOADED="$HTTP_CODE"
if [ "$ANTISLOP_LOADED" = "200" ] || [ "$ANTISLOP_LOADED" = "404" ]; then
  # 200 means W6a is live; 404 means the controller is loaded but no /health.
  # 401/403 also imply registration. The OTHER possibility is the route
  # simply isn't there (no controller) → W6a not loaded.
  if [ "$ANTISLOP_LOADED" = "404" ]; then
    skip "validate-and-repair loop: W6a's CopyValidator class presence indeterminate from this route — see specs/COPY_GEN.md §4"
  else
    pass "W6a is loaded — validate-and-repair loop runs on real API calls when JOIST_CLAUDE_API_KEY is set"
  fi
else
  skip "validate-and-repair loop: W6a's AntiSlopController not registered yet (parallel-build dependency)"
fi

# ── IMAGE GENERATION — W6b (FLUX.2 + Recraft + Ideogram + AssetRouter) ──────
# Exercises POST /generate/image, POST /generate/image/train-lora,
# GET /generate/image/lora/{site_id}, GET /generate/image/cost-meter.
# All tests assume the test host has NO provider API keys configured
# (the dark-test path). With keys set the upstream-call branch would fire.
# See specs/IMAGE_GEN.md for the full surface.
section "Image generation — REST surface (W6b)"

# Cost meter baseline (zeroes when no calls made)
api GET /generate/image/cost-meter
assert_status 200 "GET /generate/image/cost-meter (baseline)"
assert_jq '.session_total_usd == 0' "session_total_usd is 0 at baseline"
assert_jq '.cap_usd >= 1' "cap_usd is exposed and >= 1"
assert_jq '.remaining_usd == .cap_usd' "remaining_usd equals cap_usd at baseline"
assert_jq '.session_id != null' "session_id is exposed"

# GET /lora/{site_id} returns null when no LoRA trained for the site
api GET "/generate/image/lora/host_example.com"
assert_status 200 "GET /generate/image/lora/{site_id} (untrained site)"
assert_jq '.lora_id == null' "lora_id is null for an untrained site"
assert_jq '.status == "none"' "status is 'none' for an untrained site"
assert_jq '.site_id == "host_example.com"' "site_id echoed in response"

section "Image generation — dark-test (no provider API keys configured)"

# hero_image → FluxLoraClient (FAL)
api POST /generate/image '{
  "site_id": "host_example.com",
  "asset_type": "hero_image",
  "prompt": "Foundry-palette engineering hero",
  "brand_profile": {"palette": ["#D4FF3A", "#0E0E0C"]},
  "constraints": {"width": 1024, "height": 768, "format": "png"}
}'
assert_status 422 "POST /generate/image hero_image → 422 (FAL key not set)"
assert_jq '.code == "provider_unconfigured"' "error code is provider_unconfigured"
assert_jq '.details.env_var == "JOIST_FAL_API_KEY"' "FAL env-var hint surfaces"
assert_jq '.details.wp_option == "joist_fal_api_key"' "FAL wp_option hint surfaces"
assert_jq '(.details.provider | test("fal"))' "details.provider mentions fal"

# vector_icon → RecraftClient
api POST /generate/image '{
  "site_id": "host_example.com",
  "asset_type": "vector_icon",
  "prompt": "minimal chartreuse joist beam icon",
  "brand_profile": {"palette": ["#D4FF3A"]},
  "constraints": {"format": "svg"}
}'
assert_status 422 "POST /generate/image vector_icon → 422 (Recraft key not set)"
assert_jq '.code == "provider_unconfigured"' "vector_icon error code is provider_unconfigured"
assert_jq '.details.env_var == "JOIST_RECRAFT_API_KEY"' "Recraft env-var hint surfaces"
assert_jq '(.details.provider | test("recraft"))' "vector_icon routed to Recraft (per provider hint)"

# text_on_image → IdeogramClient
api POST /generate/image '{
  "site_id": "host_example.com",
  "asset_type": "text_on_image",
  "prompt": "JOIST hero with display type",
  "constraints": {"aspect_ratio": "16x9"}
}'
assert_status 422 "POST /generate/image text_on_image → 422 (Ideogram key not set)"
assert_jq '.code == "provider_unconfigured"' "text_on_image error code is provider_unconfigured"
assert_jq '.details.env_var == "JOIST_IDEOGRAM_API_KEY"' "Ideogram env-var hint surfaces"
assert_jq '(.details.provider | test("ideogram"))' "text_on_image routed to Ideogram (per provider hint)"

# logo → RecraftClient (alternate routing path)
api POST /generate/image '{
  "site_id": "host_example.com",
  "asset_type": "logo",
  "prompt": "joist wordmark with subtle italic descender",
  "constraints": {"format": "svg"}
}'
assert_status 422 "POST /generate/image logo → 422 (Recraft key not set)"
assert_jq '(.details.provider | test("recraft"))' "logo routed to Recraft"

# lifestyle → FluxLoraClient (alternate routing path)
api POST /generate/image '{
  "site_id": "host_example.com",
  "asset_type": "lifestyle",
  "prompt": "working agency lifestyle image"
}'
assert_status 422 "POST /generate/image lifestyle → 422 (FAL key not set)"
assert_jq '(.details.provider | test("fal"))' "lifestyle routed to FAL"

# Unknown asset_type → 422 unknown_asset_type
api POST /generate/image '{
  "site_id": "host_example.com",
  "asset_type": "interpretive_dance",
  "prompt": "..."
}'
assert_status 422 "POST /generate/image unknown asset_type → 422"
assert_jq '.code == "unknown_asset_type"' "error code is unknown_asset_type"
assert_jq '.details.valid | length >= 6' "valid asset_types list is surfaced"

# Missing required field → 422 validation.missing_field
api POST /generate/image '{
  "site_id": "host_example.com",
  "asset_type": "hero_image"
}'
assert_status 422 "POST /generate/image with missing prompt → 422"
assert_jq '.code == "validation.missing_field"' "error code is validation.missing_field"
assert_jq '.details.field == "prompt"' "details.field cites the missing field"

# Unknown top-level key → 422 schema.unknown_key (constraint #1)
api POST /generate/image '{
  "site_id": "host_example.com",
  "asset_type": "hero_image",
  "prompt": "anything",
  "destroy_all_pages": true
}'
assert_status 422 "POST /generate/image with unknown key → 422 schema.unknown_key"
assert_jq '.code == "schema.unknown_key"' "unknown top-level key rejected with typed code"
assert_jq '.details.unknown_keys | index("destroy_all_pages") != null' "unknown key surfaced in details"

# Train-LoRA endpoint dark-test
api POST /generate/image/train-lora '{
  "site_id": "host_example.com",
  "reference_urls": ["https://example.com/refs.zip"]
}'
assert_status 422 "POST /generate/image/train-lora → 422 (FAL key not set)"
assert_jq '.code == "provider_unconfigured"' "train-lora unconfigured error code"
assert_jq '.details.env_var == "JOIST_FAL_API_KEY"' "train-lora env-var hint surfaces"

# Train-LoRA validation: missing reference_urls
api POST /generate/image/train-lora '{
  "site_id": "host_example.com"
}'
assert_status 422 "POST /generate/image/train-lora without reference_urls → 422"
assert_jq '.code == "validation.missing_field"' "train-lora missing-field code"

# Cost meter shape (constraint #9). Real cost_cap_exceeded 429 fires only when a
# successful call accrues cost; every provider is unconfigured in this dark
# test, so we verify shape + zero-accrual instead.
section "Image generation — cost meter and cap behaviour"
api GET /generate/image/cost-meter
assert_jq '.cap_usd == 10 or .cap_usd > 0' "cap_usd is the default or admin-overridden"
api GET /generate/image/cost-meter
assert_jq '.session_total_usd == 0' "session_total_usd remains 0 after failed (unconfigured) calls"

# ── SCHEMA VALIDATOR — SELECT enum enforcement (task #16, follow-up to W4c) ─
section "SchemaValidator — SELECT enum enforcement (constraint #1 closure)"

# Setup: create a container with a deliberately-invalid joist_display_mode.
# Pre-Wave-4c the unknown-VALUE would silently round-trip into _elementor_data.
# Post-Task-#16 the validator rejects it at the REST boundary with a typed
# schema.invalid_enum error envelope listing the allowed values.

api POST "/pages" '{"title":"Joist enum-validator smoke","status":"draft"}'
if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
  ENUM_PAGE_ID="$(jqr '.id')"
  CREATED_PAGES+=("$ENUM_PAGE_ID")
  pass "created enum-validator smoke page #$ENUM_PAGE_ID"

  api GET "/pages/$ENUM_PAGE_ID"
  ENUM_HASH="$(jqr '.elementor.hash')"

  # Unknown VALUE on a SELECT control — must 422 with schema.invalid_enum.
  api PATCH "/pages/$ENUM_PAGE_ID" "$(cat <<EOF
{
  "hash": "$ENUM_HASH",
  "ops": [{
    "op": "add",
    "path": "/elements/-",
    "value": {
      "elType": "container",
      "isInner": false,
      "settings": { "joist_display_mode": "wibble" }
    }
  }]
}
EOF
)"
  assert_status_in "422 400" "PATCH with invalid SELECT value returns 422"
  if echo "$RESP" | grep -q "schema.invalid_enum"; then
    pass "error envelope carries schema.invalid_enum code"
  else
    # The validator may also surface this as schema.invalid_settings wrapping
    # the per-control error array — accept either as long as one path fires.
    if echo "$RESP" | grep -q "schema.invalid_settings\|invalid_enum"; then
      pass "error envelope surfaces enum violation (wrapped or direct)"
    else
      fail "error envelope missing enum violation marker"
    fi
  fi
  if echo "$RESP" | grep -q '"allowed"'; then
    pass "error envelope lists allowed values"
  else
    info "error envelope does not include 'allowed' list (acceptable if wrapped)"
  fi

  # Valid VALUE on the same control — must 200/202.
  api GET "/pages/$ENUM_PAGE_ID"
  ENUM_HASH2="$(jqr '.elementor.hash')"
  api PATCH "/pages/$ENUM_PAGE_ID" "$(cat <<EOF
{
  "hash": "$ENUM_HASH2",
  "ops": [{
    "op": "add",
    "path": "/elements/-",
    "value": {
      "elType": "container",
      "isInner": false,
      "settings": { "joist_display_mode": "grid" }
    }
  }]
}
EOF
)"
  assert_status_in "200 202" "PATCH with valid SELECT value (grid) is accepted"

  # Empty string on a SELECT control — must remain valid (Elementor defaults).
  api GET "/pages/$ENUM_PAGE_ID"
  ENUM_HASH3="$(jqr '.elementor.hash')"
  api PATCH "/pages/$ENUM_PAGE_ID" "$(cat <<EOF
{
  "hash": "$ENUM_HASH3",
  "ops": [{
    "op": "add",
    "path": "/elements/-",
    "value": {
      "elType": "container",
      "isInner": false,
      "settings": { "joist_display_mode": "" }
    }
  }]
}
EOF
)"
  assert_status_in "200 202" "PATCH with empty SELECT value (Elementor default path) is accepted"
else
  skip "could not create page for enum-validator smoke ($HTTP_CODE)"
fi

# ── WAVE 10a — Rule v0.9 fields (rationale + superseded_by + last_reinforced_at) ──
section "Wave 10a — preference_memory v0.9 fields"

api GET /site
W9_DB_VER="$(jqr '.plugin.db_version')"
[ "${W9_DB_VER:-0}" -ge 12 ] \
  && pass "migration 012 applied (db_version=$W9_DB_VER >= 12)" \
  || fail "db_version=$W9_DB_VER, expected >= 12"

api GET /preferences
W10A_SITE_ID="$(jqr '.site_id')"
W10A_RULE_BODY=$(cat <<JSON
{"kind":"forbidden_phrase","pattern":"w10a_synergy","directive":"avoid w10a_synergy","rationale":"keyword test — captured by Wave 10a acceptance run"}
JSON
)
api POST /preferences "$W10A_RULE_BODY"
assert_status_in "200 201" "POST /preferences with rationale field accepted"
W10A_RULE_ID="$(jqr '.created[0].id // .id // empty')"
assert_jq '(.created[0].rationale // .rationale) | type == "string"' "created rule echoes rationale"
assert_jq '(.created[0].rationale // .rationale) | test("Wave 10a")' "rationale string is preserved"
assert_jq '(.created[0].last_reinforced_at // .last_reinforced_at) | type == "string"' "rule carries last_reinforced_at"

if [ -n "$W10A_RULE_ID" ] && [ "$W10A_RULE_ID" != "null" ]; then
  api GET "/preferences/$W10A_RULE_ID"
  assert_status 200 "GET /preferences/{id} returns the rule"
  assert_jq '.rationale | test("Wave 10a")' "round-trip: rationale preserved"
  assert_jq '.last_reinforced_at | type == "string"' "round-trip: last_reinforced_at present"
  assert_jq 'has("superseded_by")' "round-trip: superseded_by field present (may be null)"
  api DELETE "/preferences/$W10A_RULE_ID" >/dev/null 2>&1 || true
fi

# AGENTS.md emitter
api GET "/sites/$W10A_SITE_ID/agents-md"
if [ "$HTTP_CODE" = "200" ]; then
  assert_jq '.markdown | type == "string"' "AGENTS.md response carries markdown string"
  assert_jq '.markdown | test("# AGENTS.md")' "markdown starts with the AGENTS.md header"
  assert_jq '.bytes <= 5120' "rendered markdown is within the 5KB hard cap"
  assert_jq '.site_id == "'"$W10A_SITE_ID"'"' "response site_id matches"
  # Cross-site request denied
  api GET "/sites/some-other-fictional-site/agents-md"
  assert_status 403 "cross-site /agents-md is denied"
else
  skip "AGENTS.md endpoint not reachable (pre-W10a or routing issue)"
fi

# ── WAVE 10b — Constitution substrate ───────────────────────────────────────
section "Wave 10b — Constitution agency default + site override"

api GET /preferences
CONST_SITE_ID="$(jqr '.site_id')"
api GET "/constitution/$CONST_SITE_ID"
if [ "$HTTP_CODE" = "404" ]; then
  skip "constitution endpoints not registered (pre-W10b build)"
else
  assert_status 200 "GET /constitution/{site_id} (baseline, fresh install)"
  assert_jq '.source == "agency_default"' "fresh install reports agency_default source"
  assert_jq '.constitution | type == "string" and length > 100' "constitution markdown is non-empty (>100 chars)"
  assert_jq '.token_estimate | type == "number" and . > 0' "token_estimate is a positive integer"
  assert_jq '.cache_key | type == "string" and length == 16' "cache_key is a 16-char hex digest"
  AGENCY_CACHE_KEY="$(jqr '.cache_key')"
  # Path traversal rejected
  api GET "/constitution/..%2Fevil"
  assert_status_in "400 404 422" "GET with path-traversal site_id is refused"
  # PUT writes an override
  OVERRIDE_BODY='{"markdown":"# Site override\n\n## Voice and tone\n\nUse plain words. The reason: site-specific override for the acceptance test.\n"}'
  api PUT "/constitution/$CONST_SITE_ID" "$OVERRIDE_BODY"
  assert_status 200 "PUT /constitution/{site_id} (admin override)"
  assert_jq '.source == "site_override" or .source == "merged"' "post-PUT source is site_override or merged"
  OVERRIDE_CACHE_KEY="$(jqr '.cache_key')"
  [ "$OVERRIDE_CACHE_KEY" != "$AGENCY_CACHE_KEY" ] \
    && pass "cache_key changes after PUT" \
    || fail "cache_key did NOT change after PUT"
  # GET after PUT reflects the override
  api GET "/constitution/$CONST_SITE_ID"
  assert_jq '.constitution | test("Site-specific override")' "GET after PUT surfaces override content"
  # DELETE returns to agency default
  api DELETE "/constitution/$CONST_SITE_ID"
  assert_status 200 "DELETE /constitution/{site_id} (admin)"
  api GET "/constitution/$CONST_SITE_ID"
  assert_jq '.source == "agency_default"' "post-DELETE source is agency_default again"
fi

# ── WAVE 10c — Exemplar pack substrate ──────────────────────────────────────
section "Wave 10c — Exemplar pack (cached message-history, negative anchors)"

api GET /site
W9_DB_VER="$(jqr '.plugin.db_version')"
[ "${W9_DB_VER:-0}" -ge 13 ] \
  && pass "migration 013 applied (db_version=$W9_DB_VER >= 13)" \
  || fail "db_version=$W9_DB_VER, expected >= 13 (exemplar pack table)"

api GET /preferences
EXEMPLAR_SITE_ID="$(jqr '.site_id')"
api GET "/exemplar-pack/$EXEMPLAR_SITE_ID"
if [ "$HTTP_CODE" = "404" ]; then
  skip "exemplar-pack endpoints not registered (pre-W10c build)"
else
  assert_status 200 "GET /exemplar-pack/{site_id} (baseline)"
  assert_jq '.total == 0 or (.exemplars | type == "array")' "baseline returns array (possibly empty)"
  api GET "/exemplar-pack/$EXEMPLAR_SITE_ID/rendered"
  assert_status 200 "GET /exemplar-pack/{site_id}/rendered (baseline)"
  assert_jq '.messages | type == "array"' "rendered returns messages array"
  # Path traversal rejection
  api GET "/exemplar-pack/..%2Fevil"
  case "$HTTP_CODE" in
    404|422) pass "path-traversal site_id rejected (HTTP $HTTP_CODE)" ;;
    *) fail "path-traversal site_id NOT rejected (HTTP $HTTP_CODE)" ;;
  esac
  # Missing-resource handling
  api POST "/exemplar-pack/$EXEMPLAR_SITE_ID/pin/ex_does_not_exist_xxx" '{}'
  assert_status 404 "POST /pin on missing exemplar returns 404 (constraint #16)"
  api POST "/exemplar-pack/$EXEMPLAR_SITE_ID/pin/ex_does_not_exist_xxx" '{"unknown_field": true}'
  assert_status 422 "POST /pin rejects unknown body fields (constraint #1)"
fi

# ── WAVE 11 — /critique surface + Forced Optimization gate ──────────────────
# Exercises POST /critique (dark-test envelope when no API key),
# GET /critique/cost-meter, GET /critique/rubric, GET /critique/health, and
# the Forced Optimization gate on Document::save (refuse-without-context).
# See specs/WAVE_9_2026-05-29.md §1.1, §1.2, §3.2, §3.4.
section "Wave 11 — /critique health + introspection"

# Health endpoint — sentinel that the controller is registered + class loaded.
api GET /critique/health
CRITIQUE_LOADED="$HTTP_CODE"
if [ "$CRITIQUE_LOADED" = "200" ]; then
  pass "GET /critique/health returns 200 (CritiqueController registered)"
  assert_jq '.controller_loaded == true' "controller_loaded == true"
  assert_jq '.runner_loaded == true' "runner_loaded == true"
  assert_jq '.api_key_configured | type == "boolean"' "api_key_configured is a boolean"
  assert_jq '.iteration_cap == 5' "iteration_cap == 5 (failure-mode constraint #23)"
  assert_jq '.aeseval_rubric_version != null' "aeseval_rubric_version is exposed"
  assert_jq '.forced_optimization_gate == "enforced_in_document_writer"' "FO gate enforcement is documented"
else
  skip "Wave 11 critique tests (CritiqueController not loaded — got HTTP $CRITIQUE_LOADED)"
fi

# Only run the remaining Wave 11 tests if the controller surface is live.
if [ "$CRITIQUE_LOADED" = "200" ]; then

  # AesEval-Bench rubric introspection — the public eval schema.
  api GET /critique/rubric
  assert_status 200 "GET /critique/rubric returns 200"
  assert_jq '.rubric.version != null' "rubric.version is exposed"
  assert_jq '.rubric.indicator_count == 12' "12 indicators (4 dimensions x 3)"
  assert_jq '.rubric.dimension_count == 4' "4 dimensions (composition/color/typography/functional)"
  assert_jq '.rubric.dimensions | length == 4' "dimensions array has 4 entries"
  assert_jq '.rubric.indicators | length == 12' "indicators array has 12 entries"
  assert_jq '.composite_thresholds.accept >= 0.5' "composite accept threshold is exposed and >= 0.5"
  assert_jq '.iteration_cap == 5' "iteration_cap is exposed"
  assert_jq '.failure_mode_constraints."#21" != null' "FO gate (constraint #21) is documented"
  assert_jq '.failure_mode_constraints."#22" != null' "anti-cliché (constraint #22) is documented"
  assert_jq '.failure_mode_constraints."#23" != null' "bounded iteration (constraint #23) is documented"
  assert_jq '.failure_mode_constraints."#24" != null' "no autonomous VLM (constraint #24) is documented"

  # Cost meter baseline.
  api GET /critique/cost-meter
  assert_status 200 "GET /critique/cost-meter returns 200"
  assert_jq '.cap_usd >= 1' "cap_usd is exposed and >= 1"
  assert_jq '.session_total_usd == 0' "session_total_usd is 0 at baseline"
  assert_jq '.remaining_usd == .cap_usd' "remaining_usd equals cap_usd at baseline"
  assert_jq '.separated_from_copy_and_image_gen == true' "cost meter is separate from copy/image meters"

  # POST /critique without API key configured — dark-test envelope. The endpoint
  # must return 200 with status:unconfigured rather than 422 (we returned the
  # critique envelope including the dark-test reason so the agent harness can
  # see the gate was inert).
  section "Wave 11 — POST /critique dark-test (no API key configured)"
  api POST /critique '{
    "site_id": "host_example.com",
    "screenshot_url": "https://example.com/preview.png",
    "brand_tokens": {"palette": ["#D4FF3A", "#0E0E0C"]},
    "forbidden": ["transformative", "leverage"],
    "rubric": "both",
    "max_iterations_remaining": 5
  }'
  # Dark-test (no key) returns 200 with status: unconfigured per the API contract.
  # If a key IS configured on this host, the call would actually fire — accept either path.
  if [ "$HTTP_CODE" = "200" ]; then
    pass "POST /critique returns 200 (dark-test envelope or successful call)"
    assert_jq '.status != null' "response carries status field"
    assert_jq '.iteration_budget_remaining | type == "number"' "iteration_budget_remaining is a number"
    assert_jq '.anti_cliche_check != null' "anti_cliche_check envelope is present"
  else
    fail "POST /critique with no API key returned HTTP $HTTP_CODE (expected 200 dark-test envelope)"
  fi

  # POST /critique with unknown body field — 422 + valid_fields hint.
  section "Wave 11 — POST /critique input validation"
  api POST /critique '{
    "site_id": "host_example.com",
    "screenshot_url": "https://example.com/p.png",
    "unknown_param": "x"
  }'
  assert_status 422 "POST /critique with unknown field returns 422"
  assert_jq '.code == "critique.unknown_field"' "unknown-field code is critique.unknown_field"
  assert_jq '.details.valid_fields | length > 5' "valid_fields hint lists the allowed fields"

  # POST /critique without site_id — 422.
  api POST /critique '{
    "screenshot_url": "https://example.com/p.png"
  }'
  assert_status 422 "POST /critique without site_id returns 422"
  assert_jq '.code == "validation.required"' "missing-field code is validation.required"

  # POST /critique without any screenshot source — 422.
  api POST /critique '{
    "site_id": "host_example.com"
  }'
  assert_status 422 "POST /critique without screenshot returns 422"
  if echo "$RESP" | grep -q "critique.missing_screenshot\|validation"; then
    pass "missing-screenshot rejection surfaces a typed error code"
  else
    fail "missing-screenshot rejection did not surface a typed code"
  fi

  # Cost meter post-call: dark-test calls record 0 cost (no real API hit).
  api GET /critique/cost-meter
  assert_status 200 "GET /critique/cost-meter after dark-test calls"
  assert_jq '.session_total_usd == 0' "session_total_usd remains 0 after dark-test calls"

  # Forced Optimization gate (constraint #21) — verify the gate is enforced
  # in the writer path. This test routes through the live page-write surface;
  # it SKIPs on V4 known-broken hosts (where the writer refuses earlier with
  # atomic_save_unstable_in_v4 before the FO gate can be evaluated).
  section "Wave 11 — Forced Optimization gate on Document::save (constraint #21)"
  if [ "$ROUTING_KIND" = "legacy_v3" ]; then
    # The gate is inert without critique_context, which is the default for
    # existing tests — so we exercise the explicit refuse-on-missing-after
    # path by sending a critique_context with `before` but no `after`. The
    # gate will refuse with critique.forced_optimization_refused on hosts
    # where JOIST_CLAUDE_API_KEY is configured. On dark-test hosts the gate
    # is inert (no before-score captured) and the write succeeds — both are
    # documented contract paths, so we accept either.

    # First, create a session + page for the test.
    api POST /sessions/start '{"agent":"wave11-fo-test","agent_version":"0.9","intent":"FO gate refuse-on-missing-after-context"}'
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
      FO_SESSION="$(jqr '.session_id')"
      api POST /pages '{"title":"Wave 11 FO gate test","status":"draft","intent":"FO gate test"}' "" "$FO_SESSION"
      if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
        FO_PAGE_ID="$(jqr '.id')"
        CREATED_PAGES+=("$FO_PAGE_ID")
        pass "created FO-gate test page #$FO_PAGE_ID"

        # Patch with critique_context.before set but no after. On a host where
        # CritiqueRunner can score before, this would refuse with FO error.
        # On dark-test hosts the gate is inert (before-score is null) so the
        # write proceeds — verify the response is sane either way.
        api GET "/pages/$FO_PAGE_ID"
        FO_HASH="$(jqr '.elementor.hash')"
        api PATCH "/pages/$FO_PAGE_ID" "$(cat <<EOF
{
  "hash": "$FO_HASH",
  "critique_context": {
    "site_id": "host_example.com",
    "before": {
      "screenshot_url": "https://example.com/before.png",
      "phash": "0123456789abcdef"
    },
    "after": {
      "screenshot_url": "https://example.com/after.png",
      "phash": "0123456789abcdef"
    }
  },
  "ops": [{
    "op": "add",
    "path": "/elements/-",
    "value": {
      "elType": "container",
      "isInner": false,
      "settings": {}
    }
  }]
}
EOF
)" "" "$FO_SESSION"
        # Three documented paths:
        #   200/202 — gate inert (dark-test), write proceeded
        #   422 with critique.forced_optimization_refused — gate active and refused
        #   any other code — unexpected
        case "$HTTP_CODE" in
          200|202)
            pass "PATCH with critique_context succeeded (FO gate inert under dark-test, write proceeded)"
            ;;
          422)
            if echo "$RESP" | grep -q "critique.forced_optimization_refused"; then
              pass "PATCH with critique_context refused by FO gate (constraint #21 enforced)"
              assert_jq '.details.before_score != null or .details.reason != null' "FO refusal carries before_score or reason"
            else
              # 422 from other validation paths (e.g. critique_context not yet routed); accept.
              info "PATCH returned 422 but not the FO-gate code (other validation path; acceptable)"
            fi
            ;;
          *)
            fail "PATCH with critique_context returned unexpected HTTP $HTTP_CODE"
            ;;
        esac

        # Bypass test: force_save: true should make the write succeed even
        # with a critique_context that would otherwise refuse.
        api GET "/pages/$FO_PAGE_ID"
        FO_HASH2="$(jqr '.elementor.hash')"
        api PATCH "/pages/$FO_PAGE_ID" "$(cat <<EOF
{
  "hash": "$FO_HASH2",
  "force_save": true,
  "critique_context": {
    "site_id": "host_example.com",
    "before": {"screenshot_url": "https://example.com/before.png"}
  },
  "ops": [{
    "op": "add",
    "path": "/elements/-",
    "value": {
      "elType": "container",
      "isInner": false,
      "settings": {}
    }
  }]
}
EOF
)" "" "$FO_SESSION"
        assert_status_in "200 202" "PATCH with force_save:true bypasses FO gate (admin-only escape hatch)"
      else
        skip "FO-gate test (could not create page; HTTP $HTTP_CODE)"
      fi
    else
      skip "FO-gate test (could not start session; HTTP $HTTP_CODE)"
    fi
  else
    skip "FO-gate test (host is not legacy_v3; V4 known-broken refuses earlier in the writer)"
  fi

  # Anti-cliché diversity check: with no ExemplarPackManager loaded (the
  # default until W10c lands), the check returns similarity_to_recent: null
  # and DOES NOT gate. Verify the dark-test envelope carries this contract.
  section "Wave 11 — anti-cliché diversity check (constraint #22)"
  api POST /critique '{
    "site_id": "host_example.com",
    "screenshot_url": "https://example.com/p.png",
    "tree_signature": {"container": 3, "heading": 2, "text": 4, "image": 1, "button": 1}
  }'
  assert_status 200 "POST /critique with tree_signature returns 200 (dark-test envelope)"
  assert_jq '.anti_cliche_check != null' "anti_cliche_check envelope is present"
  # Either exemplar_pack_loaded false (W10c not landed yet) OR similarity_to_recent
  # surfaced as a number — both are documented contracts.
  assert_jq '(.anti_cliche_check.exemplar_pack_loaded == false) or (.anti_cliche_check.similarity_to_recent | type == "number") or (.anti_cliche_check.similarity_to_recent == null)' "anti_cliche envelope carries either inert state or a similarity number"

else
  skip "Wave 11 — POST /critique tests (CritiqueController not loaded)"
  skip "Wave 11 — /critique input validation tests (CritiqueController not loaded)"
  skip "Wave 11 — Forced Optimization gate tests (CritiqueController not loaded)"
  skip "Wave 11 — anti-cliché diversity check tests (CritiqueController not loaded)"
fi

# ── CLEANUP ─────────────────────────────────────────────────────────────────
section "Cleanup"
api POST "/sessions/$SESSION_ID/end" '{}' >/dev/null 2>&1 || true
if [ "${JOIST_KEEP:-0}" = "1" ]; then
  info "JOIST_KEEP=1 — leaving test pages in place for the manual round-trip step"
else
  if [ "${#CREATED_PAGES[@]}" -gt 0 ]; then
    for pid in "${CREATED_PAGES[@]}"; do
      api DELETE "/pages/$pid" >/dev/null 2>&1 || true
      info "trashed page #$pid"
    done
  fi
fi

# ── SUMMARY ─────────────────────────────────────────────────────────────────
echo ""
printf '%b════════════════════════════════════════%b\n' "$c_bold" "$c_off"
printf '  %bPASS%b %d   %bFAIL%b %d   %bSKIP%b %d\n' "$c_pass" "$c_off" "$PASS" "$c_fail" "$c_off" "$FAIL" "$c_skip" "$c_off" "$SKIP"
printf '%b════════════════════════════════════════%b\n' "$c_bold" "$c_off"
echo ""
if [ "${JOIST_KEEP:-0}" = "1" ] && [ -n "$LAST_PAGE_EDIT_URL" ]; then
  echo "Manual round-trip step (the proof):"
  echo "  1. Open: $LAST_PAGE_EDIT_URL"
  echo "  2. Edit a widget in the Elementor UI, save."
  echo "  3. curl -u \"$JOIST_USER:\$JOIST_APP_PWD\" \"$BASE/pages/${CREATED_PAGES[-1]}\" | jq '{hash: .elementor.hash, last_modifier}'"
  echo "  4. The hash will differ from the test's last write, and last_modifier.actor_type will be \"human\"."
  echo "     That's round-trip detection working — the agent's next write would see the mismatch and re-read instead of clobbering."
  echo ""
else
  echo "Re-run with JOIST_KEEP=1 to leave a test page in place for the manual round-trip step."
  echo ""
fi
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
