#!/usr/bin/env bash
# Joist v0.1 M0 smoke test — copy-paste-runnable.
#
# Edit the three vars below to match your local WP install.
# Then `bash smoke.sh` (or run line-by-line).

set -euo pipefail

WP_URL="${WP_URL:-http://your-site.local}"
USER="${USER:-admin}"
APP_PWD="${APP_PWD:-xxxx xxxx xxxx xxxx xxxx xxxx}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }

bold "[1/5] Health: GET /site"
curl -sS -u "$USER:$APP_PWD" "$WP_URL/wp-json/joist/v1/site" | jq .

bold "[2/5] List widgets: GET /widgets"
curl -sS -u "$USER:$APP_PWD" "$WP_URL/wp-json/joist/v1/widgets" | jq '.widgets | length, .widgets[:5]'

bold "[3/5] Create page with one container + one heading widget"
CREATE_RESP=$(curl -sS -u "$USER:$APP_PWD" \
  -H "Content-Type: application/json" \
  -X POST "$WP_URL/wp-json/joist/v1/pages" \
  -d '{
    "title": "Joist M0 smoke test",
    "status": "publish",
    "elements": [{
      "elType": "container",
      "settings": {"flex_direction": "column", "padding": {"unit":"px","top":"40","right":"20","bottom":"40","left":"20"}},
      "elements": [{
        "elType": "widget",
        "widgetType": "heading",
        "settings": {
          "title": "Hello from Joist v0.1",
          "align": "center",
          "header_size": "h1"
        },
        "elements": []
      }, {
        "elType": "widget",
        "widgetType": "text-editor",
        "settings": {
          "editor": "<p>This page was written by Claude via the Joist plugin. The hash above is the OCC primitive — re-fetch the page after a human edit in Elementor and you will see a different hash.</p>"
        },
        "elements": []
      }]
    }]
  }')
echo "$CREATE_RESP" | jq .
PAGE_ID=$(echo "$CREATE_RESP" | jq -r '.id')
HASH_A=$(echo "$CREATE_RESP" | jq -r '.hash')
LIVE_URL=$(echo "$CREATE_RESP" | jq -r '.live_url')
EDIT_URL=$(echo "$CREATE_RESP" | jq -r '.edit_url')
dim "Created page #$PAGE_ID with hash $HASH_A"
dim "View live: $LIVE_URL"
dim "Edit in Elementor: $EDIT_URL"

bold "[4/5] Read back: GET /pages/$PAGE_ID"
READ_RESP=$(curl -sS -u "$USER:$APP_PWD" "$WP_URL/wp-json/joist/v1/pages/$PAGE_ID")
echo "$READ_RESP" | jq '{id, title, elementor: {hash: .elementor.hash, version: .elementor.version, element_count: (.elementor.elements | length)}}'
HASH_B=$(echo "$READ_RESP" | jq -r '.elementor.hash')
if [ "$HASH_A" = "$HASH_B" ]; then
  dim "Hash on read matches hash on create — round-trip stable ✓"
else
  echo "WARN: hash drift between create and read. A=$HASH_A B=$HASH_B"
fi

bold "[5/5] Patch: change the heading text via update_settings"
# Find the heading widget's element ID
HEADING_ID=$(echo "$READ_RESP" | jq -r '.elementor.elements[0].elements[] | select(.widgetType=="heading") | .id')
dim "Heading element ID: $HEADING_ID"
PATCH_RESP=$(curl -sS -u "$USER:$APP_PWD" \
  -H "Content-Type: application/json" \
  -X POST "$WP_URL/wp-json/joist/v1/pages/$PAGE_ID/patch" \
  -d "{
    \"expected_hash\": \"$HASH_B\",
    \"ops\": [{
      \"op\": \"update_settings\",
      \"element_id\": \"$HEADING_ID\",
      \"settings\": {\"title\": \"Edited by the agent — round-trip safe\"}
    }]
  }")
echo "$PATCH_RESP" | jq .

bold "Done. Manual step:"
echo "  1. Open $EDIT_URL in your browser"
echo "  2. Edit the heading text in the Elementor UI, save"
echo "  3. Re-run: curl -u \"$USER:\$APP_PWD\" \"$WP_URL/wp-json/joist/v1/pages/$PAGE_ID\" | jq '.elementor.hash'"
echo "  4. The hash should differ from $(echo "$PATCH_RESP" | jq -r '.new_hash')"
echo "  5. That's the round-trip detection working."
