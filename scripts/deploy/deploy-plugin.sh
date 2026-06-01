#!/usr/bin/env bash
#
# deploy-plugin.sh — Build + ship the Joist plugin to a WordPress host.
#
# @purpose Parameterized, credential-free release pipeline for the Joist
#          plugin. Builds the wp-scripts bundle, assembles a clean dist
#          (dev-only paths excluded per .distignore), then syncs to the
#          target's wp-content/plugins/<dir> over ONE of two transports:
#            - rsync  : rsync over SSH       (preferred; needs SSH access)
#            - sftp   : lftp batch mirror     (when only SFTP is available)
#
# This script NEVER hardcodes hosts, paths, or credentials. Everything
# host-specific is read from environment variables (see ENV REFERENCE below)
# and the script fails loudly if a required one is missing.
#
# It performs NO destructive remote action under --dry-run, and refuses to
# proceed at all if required tooling or env vars are absent.
#
# ---------------------------------------------------------------------------
# ENV REFERENCE (set these before running; * = required)
# ---------------------------------------------------------------------------
#   JOIST_DEPLOY_TRANSPORT      rsync | sftp        (default: rsync)
# * JOIST_DEPLOY_HOST           SSH/SFTP hostname   (e.g. ssh.example.sg-host.com)
# * JOIST_DEPLOY_USER           SSH/SFTP username
# * JOIST_DEPLOY_REMOTE_PLUGIN_DIR
#                               ABSOLUTE remote path to the plugin dir, e.g.
#                               /home/customer/www/example.com/public_html/wp-content/plugins/joist
#                               (the on-host dir name is UNKNOWN — you must set it)
#   JOIST_DEPLOY_PORT           SSH/SFTP port       (default: 22; SiteGround often 18765)
#   JOIST_DEPLOY_KEY            Path to SSH/SFTP private key (rsync & sftp key auth)
#   JOIST_DEPLOY_PASSWORD       SFTP password       (sftp mode only; key auth strongly preferred)
#   JOIST_DEPLOY_SSH_OPTS       Extra raw ssh options (optional; advanced)
#
# ---------------------------------------------------------------------------
# USAGE
# ---------------------------------------------------------------------------
#   scripts/deploy/deploy-plugin.sh [--dry-run] [--skip-build] [--transport rsync|sftp] [-h]
#
#   --dry-run            Show exactly what WOULD transfer; make NO remote changes.
#   --skip-build         Reuse the existing build/ output (skip `npm run build`).
#   --transport <mode>   Override JOIST_DEPLOY_TRANSPORT (rsync | sftp).
#   --keep-staging       Do not delete the temp staging dist on exit (for inspection).
#   -h, --help           Print this help.
#
# EXIT CODES: 0 ok · 1 usage/precondition · 2 missing env · 3 build failed · 4 transfer failed
# ---------------------------------------------------------------------------

set -euo pipefail

# --- locate repo paths (script lives at scripts/deploy/ under the repo root) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/plugin"            # dir containing joist.php
DISTIGNORE="$SCRIPT_DIR/.distignore"

# --- colors (disabled when not a tty) ---
if [[ -t 1 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
fi
log()  { echo -e "${BLUE}▸${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
die()  { echo -e "${RED}✗ $*${NC}" >&2; exit "${2:-1}"; }

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//; /^set -euo/d'; }

# --- defaults / flags ---
DRY_RUN=0
SKIP_BUILD=0
KEEP_STAGING=0
TRANSPORT="${JOIST_DEPLOY_TRANSPORT:-rsync}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)      DRY_RUN=1 ;;
        --skip-build)   SKIP_BUILD=1 ;;
        --keep-staging) KEEP_STAGING=1 ;;
        --transport)    TRANSPORT="${2:-}"; shift ;;
        --transport=*)  TRANSPORT="${1#*=}" ;;
        -h|--help)      usage; exit 0 ;;
        *)              die "Unknown argument: $1 (try --help)" 1 ;;
    esac
    shift
done

case "$TRANSPORT" in
    rsync|sftp) ;;
    *) die "Invalid transport '$TRANSPORT' (expected: rsync | sftp)" 1 ;;
esac

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------
[[ -f "$PLUGIN_DIR/joist.php" ]] || die "Plugin main file not found at $PLUGIN_DIR/joist.php" 1
[[ -f "$DISTIGNORE" ]]          || die ".distignore not found at $DISTIGNORE" 1

# Required env vars (same set for both transports).
require_env() {
    local missing=()
    local v
    for v in "$@"; do
        if [[ -z "${!v:-}" ]]; then missing+=("$v"); fi
    done
    if (( ${#missing[@]} )); then
        echo -e "${RED}✗ Missing required environment variable(s):${NC}" >&2
        printf '    %s\n' "${missing[@]}" >&2
        echo "  See the ENV REFERENCE block at the top of this script, or DEPLOY.md." >&2
        exit 2
    fi
}
require_env JOIST_DEPLOY_HOST JOIST_DEPLOY_USER JOIST_DEPLOY_REMOTE_PLUGIN_DIR

PORT="${JOIST_DEPLOY_PORT:-22}"

# Tool availability per transport.
need_tool() { command -v "$1" >/dev/null 2>&1 || die "Required tool '$1' not found on PATH" 1; }
if [[ "$TRANSPORT" == "rsync" ]]; then
    need_tool rsync; need_tool ssh
else
    need_tool lftp
fi

# Read the version we are about to ship (informational + sanity).
JOIST_VERSION="$(grep -E "define\('JOIST_VERSION'" "$PLUGIN_DIR/joist.php" | sed -E "s/.*'([0-9][^']*)'.*/\1/" || true)"
[[ -n "$JOIST_VERSION" ]] || warn "Could not parse JOIST_VERSION from joist.php"

echo ""
log "Joist deploy"
echo "    version    : ${JOIST_VERSION:-unknown}"
echo "    transport  : $TRANSPORT"
echo "    host       : $JOIST_DEPLOY_USER@$JOIST_DEPLOY_HOST:$PORT"
echo "    remote dir : $JOIST_DEPLOY_REMOTE_PLUGIN_DIR"
echo "    dry-run    : $([[ $DRY_RUN == 1 ]] && echo yes || echo NO)"
echo ""

# ---------------------------------------------------------------------------
# 1. Build (unless --skip-build)
# ---------------------------------------------------------------------------
if [[ "$SKIP_BUILD" == 1 ]]; then
    warn "Skipping npm build (--skip-build) — shipping existing build/ as-is."
    [[ -f "$PLUGIN_DIR/build/index.js" ]] || warn "build/index.js missing; the admin app will not load!"
else
    need_tool npm
    log "Building admin-app bundle (npm run build)…"
    ( cd "$PLUGIN_DIR" && npm run build ) || die "npm run build failed" 3
    [[ -f "$PLUGIN_DIR/build/index.js" ]] || die "build/index.js not produced — aborting" 3
    ok "Build complete."
fi

# ---------------------------------------------------------------------------
# 2. Assemble a clean staging dist (dev-only paths excluded via .distignore)
# ---------------------------------------------------------------------------
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/joist-dist.XXXXXX")"
DIST="$STAGING/joist"     # mirror the plugin under a stable 'joist' folder name
mkdir -p "$DIST"

cleanup() {
    if [[ "$KEEP_STAGING" == 1 ]]; then
        warn "Staging kept at: $STAGING"
    else
        rm -rf "$STAGING"
    fi
}
trap cleanup EXIT

log "Assembling clean dist (excludes from .distignore)…"
# rsync is used LOCALLY here to build the dist regardless of the chosen
# transport — it gives us robust --exclude-from semantics. (This local rsync
# is independent of the rsync transport and is always available since the dist
# staging step requires it.)
need_tool rsync
rsync -a --delete --exclude-from="$DISTIGNORE" "$PLUGIN_DIR/" "$DIST/"
ok "Dist staged: $(du -sh "$DIST" | cut -f1) at $DIST"

# Hard sanity: dist MUST contain joist.php and build/, MUST NOT contain dev dirs.
[[ -f "$DIST/joist.php" ]]          || die "Dist missing joist.php — refusing to deploy" 1
[[ -d "$DIST/build" ]]              || warn "Dist has no build/ — admin app will not load on target"
[[ ! -d "$DIST/node_modules" ]]     || die "Dist leaked node_modules — check .distignore" 1
[[ ! -d "$DIST/tests" ]]            || die "Dist leaked tests/ — check .distignore" 1
[[ ! -d "$DIST/src/admin-app" ]]    || die "Dist leaked src/admin-app source — check .distignore" 1

# ---------------------------------------------------------------------------
# 3. Sync to the target
# ---------------------------------------------------------------------------
REMOTE="$JOIST_DEPLOY_REMOTE_PLUGIN_DIR"

deploy_rsync() {
    # Build the ssh command, honoring optional key/port/extra opts.
    local ssh_cmd="ssh -p $PORT -o StrictHostKeyChecking=accept-new"
    [[ -n "${JOIST_DEPLOY_KEY:-}" ]] && ssh_cmd+=" -i ${JOIST_DEPLOY_KEY}"
    [[ -n "${JOIST_DEPLOY_SSH_OPTS:-}" ]] && ssh_cmd+=" ${JOIST_DEPLOY_SSH_OPTS}"

    local rsync_flags=(-az --delete --human-readable --itemize-changes)
    if [[ "$DRY_RUN" == 1 ]]; then
        rsync_flags+=(--dry-run)
        warn "DRY RUN — no files will be written on the remote."
    fi

    # Trailing slash on source => sync contents INTO the remote plugin dir.
    log "rsync → $JOIST_DEPLOY_USER@$JOIST_DEPLOY_HOST:$REMOTE/"
    rsync "${rsync_flags[@]}" -e "$ssh_cmd" \
        "$DIST/" "$JOIST_DEPLOY_USER@$JOIST_DEPLOY_HOST:$REMOTE/" \
        || die "rsync transfer failed" 4
}

deploy_sftp() {
    # lftp drives an SFTP session in batch. Key auth preferred; password
    # fallback supported but discouraged. mirror -R = local->remote (reverse).
    local lftp_open
    if [[ -n "${JOIST_DEPLOY_KEY:-}" ]]; then
        lftp_open="open -u ${JOIST_DEPLOY_USER}, -p ${PORT} sftp://${JOIST_DEPLOY_HOST};
                   set sftp:connect-program \"ssh -a -x -i ${JOIST_DEPLOY_KEY} -o StrictHostKeyChecking=accept-new\";"
    elif [[ -n "${JOIST_DEPLOY_PASSWORD:-}" ]]; then
        warn "Using SFTP password auth — key auth is strongly preferred."
        lftp_open="open -u ${JOIST_DEPLOY_USER},${JOIST_DEPLOY_PASSWORD} -p ${PORT} sftp://${JOIST_DEPLOY_HOST};"
    else
        die "sftp transport needs JOIST_DEPLOY_KEY (preferred) or JOIST_DEPLOY_PASSWORD" 2
    fi

    local mirror_opts="--reverse --delete --verbose"
    [[ "$DRY_RUN" == 1 ]] && { mirror_opts+=" --dry-run"; warn "DRY RUN — lftp mirror --dry-run, no writes."; }

    log "lftp sftp mirror → $JOIST_DEPLOY_HOST:$REMOTE/"
    # shellcheck disable=SC2086
    lftp -c "
        set sftp:auto-confirm yes;
        set net:max-retries 2;
        set net:timeout 20;
        ${lftp_open}
        mirror ${mirror_opts} '${DIST}/' '${REMOTE}/';
        bye
    " || die "lftp/sftp transfer failed" 4
}

if [[ "$TRANSPORT" == "rsync" ]]; then
    deploy_rsync
else
    deploy_sftp
fi

echo ""
if [[ "$DRY_RUN" == 1 ]]; then
    ok "Dry run complete — nothing was changed on the remote."
    echo "  Re-run without --dry-run to perform the actual deploy."
else
    ok "Deploy complete: Joist ${JOIST_VERSION:-?} → $JOIST_DEPLOY_HOST:$REMOTE"
    echo ""
    echo "  NEXT: flush caches/opcache + run POST-DEPLOY VERIFICATION."
    echo "  See scripts/deploy/DEPLOY.md."
fi
echo ""
