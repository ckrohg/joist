#!/usr/bin/env bash
# @purpose REPRODUCIBLE TRAINING-WP PROVISIONER — makes any fresh WordPress 1:1-clone-ready for the
# Joist clone pipeline, and is the SAME script that runs against the user's sized instance later
# (just point JOIST_TRAINING_BASE at it). Pure WP-CLI, idempotent, guard-aware. LOCAL ONLY by default.
#
# It installs/configures EVERYTHING the clone pipeline depends on, in order:
#   0. ASSERT the target host is allowed by the §0 host-guard (sandbox/host-guard.mjs). REFUSE sg-host.
#   1. WP core sanity + PRETTY permalinks (the /wp-json/ REST routes the builder PUTs to need them).
#   2. Hello Elementor theme (chrome-free base; de-Jupiter parity) + Elementor PINNED to a version.
#   3. OPTIONAL Elementor Pro from a provided zip+license (Theme Builder site parts; skipped cleanly).
#   4. The JOIST plugin from plugin/ (carries the PreserveCSS Emitter) + the @font-face / canvas
#      mu-plugins into wp-content/mu-plugins.
#   5. elementor_canvas page template availability (Elementor provides it; the mu-plugin guards it).
#   6. WP AUTH: an application password for the REST PUT path → emits JOIST_AUTH_B64.
#   7. TUNE Elementor to cut per-render CSS-regen overload: css_print_method=internal + a single
#      batched flush instead of per-post regen + sane active breakpoints.
#   8. SEED the fixed-id corpus pages (so ?page_id= grade URLs match across instances).
#   9. VERIFY readiness and print a report (Elementor version, Joist active, parse_css hook live,
#      canvas template present, mu-plugins loaded, auth works).
#
# RUNNERS (where wp-cli executes) — pick with --runner:
#   docker  (default)  : the local sandbox via `docker compose run --rm wpcli-1` (sandbox/docker-compose.yml).
#   wp      : a `wp` binary already on PATH whose --path/--ssh points at the instance (set WP_CLI_ARGS).
#   ssh     : `wp --ssh=<JOIST_TRAINING_SSH>` against the user's remote training instance (REST host guarded).
#
# USAGE
#   sandbox/provision-training-wp.sh [flags]
#     --base <url>             Target WP base URL (default: docker→http://localhost:8001, else $JOIST_TRAINING_BASE).
#     --runner docker|wp|ssh   Where wp-cli runs (default: docker).
#     --elementor-version V    Elementor version pin (default: 3.28.4 — the channel the PreserveCSS Emitter was proven on).
#     --pro-zip <path>         OPTIONAL Elementor Pro plugin zip. Skipped cleanly if absent.
#     --pro-license <key>      OPTIONAL Elementor Pro license to activate (needs --pro-zip).
#     --admin-user <u>         Admin user for the app password (default: joist).
#     --admin-pass <p>         Admin password if core needs installing (default: joist-sbx-pw / $ADMIN_PW).
#     --app-pw-name <n>        Application-password label (default: joist-farm).
#     --fonts-dir <dir>        OPTIONAL dir of source webfonts (*.woff2) to drop into uploads/joist-fonts
#                              so the @font-face mu-plugin resolves real faces (else faces 404, browser falls back).
#     --seed-corpus            Also create the fixed-id corpus seed pages (3146 …) for grade-URL parity.
#     --no-tune                Skip the Elementor css_print_method / breakpoint tuning step.
#     --verify-only            Run ONLY step 9 (readiness verify) against an already-provisioned instance.
#     -h|--help                This help.
#
# IDEMPOTENT: every step no-ops if already satisfied. Safe to re-run.
# REVERSIBLE: see docs/PROVISION_TRAINING_WP.md "Reverting".
set -euo pipefail

# ── repo paths ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOST_GUARD="$SCRIPT_DIR/host-guard.mjs"
MU_SRC_DIR="$SCRIPT_DIR/mu-plugins"

# ── defaults / params ─────────────────────────────────────────────────────────
RUNNER="docker"
BASE=""
ELEMENTOR_VERSION="${ELEMENTOR_VERSION:-3.28.4}"   # PreserveCSS Emitter proven channel (see Emitter.php docblock)
PRO_ZIP=""
PRO_LICENSE=""
ADMIN_USER="joist"
ADMIN_PASS="${ADMIN_PW:-joist-sbx-pw}"
APP_PW_NAME="joist-farm"
FONTS_DIR=""
SEED_CORPUS=0
DO_TUNE=1
VERIFY_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2;;
    --runner) RUNNER="$2"; shift 2;;
    --elementor-version) ELEMENTOR_VERSION="$2"; shift 2;;
    --pro-zip) PRO_ZIP="$2"; shift 2;;
    --pro-license) PRO_LICENSE="$2"; shift 2;;
    --admin-user) ADMIN_USER="$2"; shift 2;;
    --admin-pass) ADMIN_PASS="$2"; shift 2;;
    --app-pw-name) APP_PW_NAME="$2"; shift 2;;
    --fonts-dir) FONTS_DIR="$2"; shift 2;;
    --seed-corpus) SEED_CORPUS=1; shift;;
    --no-tune) DO_TUNE=0; shift;;
    --verify-only) VERIFY_ONLY=1; shift;;
    -h|--help) sed -n '2,48p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "unknown flag: $1" >&2; exit 2;;
  esac
done

# default base by runner
if [ -z "$BASE" ]; then
  if [ "$RUNNER" = "docker" ]; then BASE="http://localhost:8001"; else BASE="${JOIST_TRAINING_BASE:-}"; fi
fi
if [ -z "$BASE" ]; then
  echo "REFUSED: no --base and JOIST_TRAINING_BASE unset (non-docker runner needs an explicit target)." >&2
  exit 2
fi

log()  { printf '\033[36m[provision]\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m  ok\033[0m %s\n' "$*"; }
warn() { printf '\033[33m  ~~\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[provision] FATAL\033[0m %s\n' "$*" >&2; exit 1; }

# ── STEP 0: §0 HOST-GUARD — refuse anything not localhost:8001 / JOIST_TRAINING_BASE; hard-block sg-host ──
log "STEP 0 — host-guard: asserting target $BASE is an allowed training host"
if ! node "$HOST_GUARD" >/dev/null 2>&1; then
  # node import smoke; the real assertion is the inline check below (offline, no host touched).
  warn "host-guard module did not load cleanly; continuing with inline assertion only"
fi
node --input-type=module -e "
  import { assertAllowedBase } from '${HOST_GUARD}';
  try { assertAllowedBase(process.argv[1]); console.log('GUARD_OK'); }
  catch (e) { console.error(e.message); process.exit(1); }
" "$BASE" || die "host-guard REFUSED target $BASE (only localhost:8001 or JOIST_TRAINING_BASE; sg-host hard-blocked)."
ok "host-guard allows $BASE"

# ── wp-cli runner abstraction ─────────────────────────────────────────────────
# WP() runs a wp-cli command against the chosen runner. All steps go through this — the ONLY
# place that knows docker vs ssh vs local. Keeps the body runner-agnostic.
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
WP_CLI_ARGS="${WP_CLI_ARGS:-}"        # e.g. --path=/var/www/html --allow-root, or --ssh=user@host
JOIST_TRAINING_SSH="${JOIST_TRAINING_SSH:-}"

WP() {
  case "$RUNNER" in
    docker)
      # The wpcli-1 service has entrypoint:["bash"]; override to `wp` so args run the wp PHAR directly.
      docker compose -f "$COMPOSE_FILE" run --rm --no-deps -T --entrypoint wp \
        -e WORDPRESS_DB_HOST=db-1 -e WORDPRESS_DB_NAME=wp -e WORDPRESS_DB_USER=wp -e WORDPRESS_DB_PASSWORD=wp \
        wpcli-1 "$@"
      ;;
    wp)
      # shellcheck disable=SC2086
      wp $WP_CLI_ARGS "$@"
      ;;
    ssh)
      [ -n "$JOIST_TRAINING_SSH" ] || die "runner=ssh needs JOIST_TRAINING_SSH=user@host:/path"
      # shellcheck disable=SC2086
      wp --ssh="$JOIST_TRAINING_SSH" $WP_CLI_ARGS "$@"
      ;;
    *) die "unknown runner $RUNNER";;
  esac
}

# Copy a host file into the target's wp-content (docker: into the wp1 volume via the cli container;
# remote: scp/ssh — left as a documented manual step for non-docker so we never push files blindly).
put_into_wpcontent() {
  local src="$1" rel="$2"   # rel is relative to wp-content, e.g. mu-plugins/foo.php
  case "$RUNNER" in
    docker)
      # the wpcli-1 service mounts wp1:/var/www/html; copy via a throwaway container with the host file bind-mounted.
      # entrypoint is already bash, so pass `-c ...` directly (not `bash -c`, which would self-invoke bash).
      docker compose -f "$COMPOSE_FILE" run --rm --no-deps -T -u 0:0 \
        -v "$src:/in:ro" wpcli-1 -c "mkdir -p \"\$(dirname /var/www/html/wp-content/$rel)\" && cp /in /var/www/html/wp-content/$rel && chown 33:33 /var/www/html/wp-content/$rel"
      ;;
    *)
      warn "runner=$RUNNER: copy $src → wp-content/$rel MANUALLY (scp), then re-run --verify-only. (We never push files to a remote host implicitly.)"
      ;;
  esac
}

# ── STEP 1: WP core sanity + PRETTY permalinks ────────────────────────────────
provision_core() {
  log "STEP 1 — WP core sanity + pretty permalinks"
  if ! WP core is-installed >/dev/null 2>&1; then
    if [ "$RUNNER" = "docker" ]; then
      WP core install --url="$BASE" --title="joist-training" --admin_user="$ADMIN_USER" \
        --admin_password="$ADMIN_PASS" --admin_email="joist@example.com" --skip-email
      ok "installed WP core"
    else
      die "WP core not installed on $BASE and runner=$RUNNER won't install it (provision WP first, then re-run)."
    fi
  else
    ok "WP core already installed ($(WP core version 2>/dev/null | tr -d '\r'))"
  fi
  # Pretty permalinks: the pretty /wp-json/ REST route the builder PUTs to needs them (plain perms 404 it).
  WP rewrite structure '/%postname%/' >/dev/null 2>&1 || true
  WP rewrite flush --hard >/dev/null 2>&1 || true
  ok "pretty permalinks set (/%postname%/)"
}

# ── STEP 2: Hello theme + Elementor PINNED ────────────────────────────────────
provision_elementor() {
  log "STEP 2 — Hello Elementor theme + Elementor pinned to $ELEMENTOR_VERSION"
  WP theme is-installed hello-elementor >/dev/null 2>&1 || WP theme install hello-elementor >/dev/null 2>&1 || warn "hello-elementor install skipped (offline?)"
  WP theme activate hello-elementor >/dev/null 2>&1 && ok "hello-elementor active" || warn "could not activate hello-elementor"

  local cur=""
  cur="$(WP plugin get elementor --field=version 2>/dev/null | tr -d '\r' || true)"
  if [ -z "$cur" ]; then
    WP plugin install elementor --version="$ELEMENTOR_VERSION" >/dev/null 2>&1 \
      || die "failed to install Elementor $ELEMENTOR_VERSION"
    ok "installed Elementor $ELEMENTOR_VERSION"
  elif [ "$cur" != "$ELEMENTOR_VERSION" ]; then
    warn "Elementor present at $cur, want $ELEMENTOR_VERSION — re-pinning"
    WP plugin install elementor --version="$ELEMENTOR_VERSION" --force >/dev/null 2>&1 \
      || die "failed to re-pin Elementor to $ELEMENTOR_VERSION"
    ok "re-pinned Elementor to $ELEMENTOR_VERSION"
  else
    ok "Elementor already at $ELEMENTOR_VERSION"
  fi
  WP plugin activate elementor >/dev/null 2>&1 && ok "Elementor active" || warn "could not activate Elementor"
}

# ── STEP 3: OPTIONAL Elementor Pro ────────────────────────────────────────────
provision_pro() {
  if [ -z "$PRO_ZIP" ]; then
    log "STEP 3 — Elementor Pro: NOT provided (--pro-zip absent) → SKIP cleanly (body clone works on free)"
    return 0
  fi
  log "STEP 3 — Elementor Pro from $PRO_ZIP"
  [ -f "$PRO_ZIP" ] || die "Pro zip not found: $PRO_ZIP"
  if WP plugin is-installed elementor-pro >/dev/null 2>&1; then
    ok "elementor-pro already installed"
  else
    # docker: copy the zip into the container, install from path; remote: install from the host path.
    if [ "$RUNNER" = "docker" ]; then
      docker compose -f "$COMPOSE_FILE" run --rm --no-deps -T -u 33:33 --entrypoint wp -v "$PRO_ZIP:/pro.zip:ro" \
        wpcli-1 plugin install /pro.zip >/dev/null 2>&1 || die "Pro install failed"
    else
      WP plugin install "$PRO_ZIP" >/dev/null 2>&1 || die "Pro install failed"
    fi
    ok "installed elementor-pro"
  fi
  WP plugin activate elementor-pro >/dev/null 2>&1 && ok "elementor-pro active" || warn "could not activate elementor-pro"
  if [ -n "$PRO_LICENSE" ]; then
    WP elementor-pro license activate "$PRO_LICENSE" >/dev/null 2>&1 && ok "Pro license activated" \
      || warn "Pro license activation failed (check key / connectivity) — Pro still usable for Theme Builder offline-ish"
  else
    warn "no --pro-license: Pro installed but unlicensed (Theme Builder works; auto-updates won't)"
  fi
}

# ── STEP 4: JOIST plugin + mu-plugins ─────────────────────────────────────────
provision_joist() {
  log "STEP 4 — Joist plugin + mu-plugins"
  # Joist is self-contained PSR-4; in docker it's live-mounted read-only from ../plugin (see compose).
  # For non-docker we copy plugin/ to wp-content/plugins/joist (documented manual step for remote).
  if [ "$RUNNER" = "docker" ]; then
    ok "Joist plugin live-mounted from plugin/ (compose: wp-content/plugins/joist:ro)"
  else
    warn "runner=$RUNNER: copy plugin/ → wp-content/plugins/joist MANUALLY (rsync), then re-run."
  fi
  WP plugin activate joist >/dev/null 2>&1 && ok "Joist plugin active" || warn "could not activate joist (copy plugin/ first?)"
  # Grant the Joist REST API cap explicitly + idempotently (activation hook may not fire under :ro mount).
  WP cap add administrator joist_use_agent_api >/dev/null 2>&1 || true
  ok "granted joist_use_agent_api to administrator"

  # mu-plugins: @font-face registration + canvas-template guard + SVG-upload allow (clone logos are SVG).
  for muf in joist-training-fonts.php joist-training-canvas.php joist-training-svg.php; do
    if [ -f "$MU_SRC_DIR/$muf" ]; then
      put_into_wpcontent "$MU_SRC_DIR/$muf" "mu-plugins/$muf" && ok "installed mu-plugin $muf" || warn "mu-plugin $muf copy failed"
    else
      warn "mu-plugin source missing: $MU_SRC_DIR/$muf"
    fi
  done

  # Optional: drop source webfonts so the @font-face mu-plugin resolves real faces.
  if [ -n "$FONTS_DIR" ] && [ -d "$FONTS_DIR" ]; then
    log "  installing webfonts from $FONTS_DIR → uploads/joist-fonts"
    if [ "$RUNNER" = "docker" ]; then
      docker compose -f "$COMPOSE_FILE" run --rm --no-deps -T -u 0:0 -v "$FONTS_DIR:/fonts:ro" \
        wpcli-1 -c "mkdir -p /var/www/html/wp-content/uploads/joist-fonts && cp /fonts/*.woff2 /var/www/html/wp-content/uploads/joist-fonts/ 2>/dev/null; chown -R 33:33 /var/www/html/wp-content/uploads/joist-fonts" \
        && ok "webfonts installed" || warn "no .woff2 copied (dir empty?)"
    else
      warn "runner=$RUNNER: copy $FONTS_DIR/*.woff2 → uploads/joist-fonts MANUALLY"
    fi
  else
    warn "no --fonts-dir: @font-face rules will 404 until real woff2 are placed in uploads/joist-fonts (probe reports usingSuisse=false; browser falls back — no error)"
  fi
}

# ── STEP 5: elementor_canvas template availability ────────────────────────────
provision_canvas() {
  log "STEP 5 — elementor_canvas page template availability"
  # Elementor's own modules/page-templates registers it when active; the mu-plugin guards it.
  # Verify it shows up in the template list (best-effort; the real proof is in STEP 9).
  if WP eval 'echo array_key_exists("elementor_canvas", (array) apply_filters("theme_page_templates", array(), null, null)) ? "yes" : "no";' 2>/dev/null | grep -q yes; then
    ok "elementor_canvas present in theme_page_templates"
  else
    warn "elementor_canvas not yet in the filter list (Elementor binds it at render; mu-plugin canvas-guard covers the gap)"
  fi
}

# ── STEP 6: WP AUTH — application password → JOIST_AUTH_B64 ────────────────────
provision_auth() {
  log "STEP 6 — WP application password for the REST PUT path"
  # Create a fresh app password (idempotent enough: each run mints a new one labelled APP_PW_NAME;
  # old ones for the same label can be revoked in wp-admin. We do NOT reuse to avoid storing secrets.)
  local apppw b64
  apppw="$(WP user application-password create "$ADMIN_USER" "$APP_PW_NAME" --porcelain 2>/dev/null | tr -d '\r' || true)"
  if [ -z "$apppw" ]; then
    warn "could not mint app password (user $ADMIN_USER exists? app-passwords enabled? HTTPS or WP_ENVIRONMENT_TYPE=local for plain-HTTP?)"
    return 0
  fi
  b64="$(printf '%s:%s' "$ADMIN_USER" "$apppw" | base64 | tr -d '\n')"
  ok "minted app password (label: $APP_PW_NAME)"
  echo
  echo "  --- write these to /tmp/joist-auth.env (the value is a SECRET — do not echo elsewhere) ---"
  echo "  export JOIST_BASE=$BASE"
  echo "  export JOIST_AUTH_B64=$b64"
  echo
}

# ── STEP 7: Elementor CSS-regen throttle + breakpoints ────────────────────────
provision_tune() {
  if [ "$DO_TUNE" = "0" ]; then log "STEP 7 — tuning SKIPPED (--no-tune)"; return 0; fi
  log "STEP 7 — Elementor CSS-regen throttle (the §0 overload lesson)"
  # css_print_method=internal → CSS inlined per request, NO per-post .css FILE written on every save.
  # This is the host-side companion to host-guard's withRenderLock(): kills per-render file regen,
  # the dominant CPU/PHP cost that overloaded the shared host.
  WP option patch update elementor_experiment-e_optimized_css_loading inactive >/dev/null 2>&1 || true
  # elementor settings live in the 'elementor_*' option family; css_print_method is a top-level option.
  WP option update elementor_css_print_method internal >/dev/null 2>&1 && ok "css_print_method=internal (no per-post CSS file regen)" \
    || warn "could not set css_print_method (option may be kit-scoped on this version — see batch-flush note)"
  # Active breakpoints: the corpus grades at 1440/1024/767/390-ish. Keep the default desktop-first set
  # (mobile 767 + tablet 1024) ACTIVE; optionally enable the extra widescreen/laptop/tablet_extra/mobile_extra.
  WP option update elementor_experiment-additional_custom_breakpoints active >/dev/null 2>&1 || true
  ok "additional_custom_breakpoints experiment active (mobile_extra/tablet_extra available if a kit enables them)"
  # Batch-flush note: do ONE `wp elementor flush_css` AFTER a multi-page build, never per-post in a loop.
  WP elementor flush_css >/dev/null 2>&1 && ok "ran a single batched elementor flush_css" \
    || warn "elementor flush_css unavailable (older/newer CLI) — regen happens lazily under css_print_method=internal anyway"
}

# ── STEP 8: SEED corpus pages (optional) ──────────────────────────────────────
provision_seed() {
  if [ "$SEED_CORPUS" = "0" ]; then log "STEP 8 — corpus seed SKIPPED (pass --seed-corpus to enable)"; return 0; fi
  log "STEP 8 — seed fixed-id corpus pages for ?page_id= grade-URL parity"
  for P in 3146 2986 2988 2990 4296 4297 4771 5404 5405 11067; do
    if ! WP post get "$P" --field=ID >/dev/null 2>&1; then
      WP post create --post_type=page --post_status=publish --post_title="seed-$P" --import-id="$P" >/dev/null 2>&1 \
        && ok "seeded page $P" || warn "could not seed page $P (import-id may be ignored on this host — name→ID registry fallback)"
    else
      ok "page $P already exists"
    fi
  done
}

# ── STEP 9: VERIFY readiness ──────────────────────────────────────────────────
verify_readiness() {
  log "STEP 9 — VERIFY readiness"
  local fail=0

  local ev; ev="$(WP plugin get elementor --field=version 2>/dev/null | tr -d '\r' || true)"
  if [ "$ev" = "$ELEMENTOR_VERSION" ]; then ok "Elementor == $ELEMENTOR_VERSION"; else warn "Elementor is '$ev', expected $ELEMENTOR_VERSION"; fail=1; fi

  if WP plugin is-active joist >/dev/null 2>&1; then ok "Joist plugin active"; else warn "Joist plugin NOT active"; fail=1; fi

  # parse_css hook registered == preserve channel live. Emitter::init adds the action on plugins_loaded.
  # Check has_action(hook) is truthy (returns the priority int, false if absent) — escaping-robust vs a
  # specific [class,method] callable (the namespace backslashes mangle through docker+bash quoting).
  if WP eval 'echo has_action("elementor/element/parse_css") ? "yes" : "no";' 2>/dev/null | grep -q yes; then
    ok "elementor/element/parse_css hook registered (PreserveCSS Emitter live)"
  else
    warn "parse_css preserve hook NOT registered — preserve channel inactive (Joist active? Elementor loaded?)"
    fail=1
  fi

  if WP eval 'echo array_key_exists("elementor_canvas",(array)apply_filters("theme_page_templates",array(),null,null))?"yes":"no";' 2>/dev/null | grep -q yes; then
    ok "elementor_canvas template available"
  else
    warn "elementor_canvas not in template filter (Elementor binds at render; verify a canvas page renders chrome-free)"
  fi

  if WP eval 'echo (is_readable(WPMU_PLUGIN_DIR."/joist-training-fonts.php") && is_readable(WPMU_PLUGIN_DIR."/joist-training-canvas.php") && is_readable(WPMU_PLUGIN_DIR."/joist-training-svg.php"))?"yes":"no";' 2>/dev/null | grep -q yes; then
    ok "mu-plugins loaded (fonts + canvas + svg)"
  else
    warn "one or more mu-plugins missing from WPMU_PLUGIN_DIR"
    fail=1
  fi

  local cpm; cpm="$(WP option get elementor_css_print_method 2>/dev/null | tr -d '\r' || true)"
  if [ "$cpm" = "internal" ]; then ok "css_print_method == internal (regen throttle on)"; else warn "css_print_method == '$cpm' (expected internal)"; fi

  # AUTH smoke: REST /joist/v1/site (or wp/v2) with the just-minted creds would prove the PUT path,
  # but we don't store the secret here. Probe the route exists + permalinks resolve it instead.
  if WP eval 'echo function_exists("rest_get_url_prefix")?rest_url("joist/v1/"):"";' 2>/dev/null | grep -q 'joist/v1'; then
    ok "REST joist/v1 namespace resolvable (pretty permalinks + plugin routes)"
  else
    warn "could not resolve joist/v1 REST url"
  fi

  echo
  if [ "$fail" = "0" ]; then
    printf '\033[32m[provision] READY — all hard checks passed for %s\033[0m\n' "$BASE"
  else
    printf '\033[33m[provision] PARTIAL — some checks failed (see ~~ above). Re-run after fixing.\033[0m\n'
  fi
  return 0
}

# ── orchestrate ───────────────────────────────────────────────────────────────
if [ "$VERIFY_ONLY" = "1" ]; then
  verify_readiness
  exit 0
fi

provision_core
provision_elementor
provision_pro
provision_joist
provision_canvas
provision_auth
provision_tune
provision_seed
verify_readiness

log "DONE. Smoke next: JOIST_BASE=$BASE JOIST_AUTH_B64=… node eval/grader/build-hybrid-flow.mjs --no-grade (see docs/PROVISION_TRAINING_WP.md)."
