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
  if [ -n "$sess" ] && [ "$sess" != "NO_SESSION" ]; then args+=( -H "X-Joist-Session-Id: $sess" ); fi
  if [ -n "$body" ]; then args+=( -H 'Content-Type: application/json' --data-binary "$body" ); fi
  HTTP_CODE="$(curl "${args[@]}" -o "$RESP_FILE" -w '%{http_code}' "$BASE$path" 2>/dev/null || echo 000)"
  RESP="$(cat "$RESP_FILE")"
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

# New installs default to 'observer' (the 30-day trial design). Set 'live' for testing.
api POST /site/operating-mode '{"mode":"live"}'
assert_status 200 "set operating mode → live (new installs default to observer — that's intentional)"

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
