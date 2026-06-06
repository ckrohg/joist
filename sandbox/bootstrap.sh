#!/usr/bin/env bash
# Phase 0 bootstrap for ONE Joist WP sandbox. Idempotent. Run via:
#   docker compose run --rm wpcli-1 /bootstrap.sh
# Emits the JOIST_AUTH_B64 line for /tmp/joist-auth-1.env (printed at the end).
set -euo pipefail
URL="http://localhost:8001"
TITLE="joist-sbx-1"
ADMIN=joist
ADMINPW="${ADMIN_PW:-joist-sbx-pw}"
EMAIL="joist@example.com"
# PARITY: pin Elementor to sg-host's EXACT version. sg-host runs 4.0.9 (verified via its Joist API);
# on 4.1.1 the Joist PUT returns 200 but _elementor_data persists as [] (the V3 tree is dropped) -> blank render.
# This was the Phase-0 parity gap. Override with ELEMENTOR_VERSION if sg-host changes.
ELEMENTOR_VERSION="${ELEMENTOR_VERSION:-4.0.9}"

cd /var/www/html

if ! wp core is-installed 2>/dev/null; then
  wp core install --url="$URL" --title="$TITLE" --admin_user="$ADMIN" \
    --admin_password="$ADMINPW" --admin_email="$EMAIL" --skip-email
fi

# PRETTY permalinks: required for the /wp-json/ REST routes the BUILDER uses (sg-host parity).
# ?page_id= grade URLs still work under pretty permalinks. (Plain perms 404 the pretty REST route.)
wp rewrite structure '/%postname%/' >/dev/null 2>&1 || true
wp rewrite flush --hard >/dev/null 2>&1 || true

# Theme + Elementor (free; Pro NOT needed — verified 0 Pro refs in the pipeline)
wp theme is-installed hello-elementor || wp theme install hello-elementor
wp theme activate hello-elementor
if ! wp plugin is-installed elementor; then
  if [ -n "$ELEMENTOR_VERSION" ]; then wp plugin install elementor --version="$ELEMENTOR_VERSION";
  else wp plugin install elementor; fi
fi
wp plugin activate elementor
wp plugin activate joist   # live-mounted from ../plugin
# Grant the Joist REST API capability (Role::CAP_USE_API). The activation hook
# (Security/Role::register → administrator->add_cap) may not fire reliably under
# `wp plugin activate` + a :ro plugin mount, so grant it explicitly + idempotently.
wp cap add administrator joist_use_agent_api >/dev/null 2>&1 || true

# unfiltered_html parity: single-site + admin → kses admin-bypass matches sg-host findings (NOT multisite)

# App password for the REST API → JOIST_AUTH_B64
APPPW=$(wp user application-password create "$ADMIN" "joist-farm" --porcelain)
B64=$(printf '%s:%s' "$ADMIN" "$APPPW" | base64 | tr -d '\n')

# Seed corpus pages with FIXED ids so ?page_id= grade URLs match across instances.
# (blank published pages; the builder overwrites _elementor_data.)
for P in 3146 2986 2988 2990 4296 4297 4771 5404 5405; do
  wp post get "$P" --field=ID >/dev/null 2>&1 || \
    wp post create --post_type=page --post_status=publish --post_title="seed-$P" --import-id="$P" >/dev/null
done

echo "=== SANDBOX READY ==="
wp core version; wp plugin get elementor --field=version | sed 's/^/elementor /'
echo "JOIST_BASE=$URL"
echo "--- write this to /tmp/joist-auth-1.env (DO NOT echo elsewhere) ---"
echo "export JOIST_BASE=$URL"
echo "export JOIST_AUTH_B64=$B64"
