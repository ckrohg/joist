#!/bin/sh
# @purpose CI / pre-commit GATE — make it impossible for a stray reference to the PAUSED
# shared host (georges232.sg-host.com / 35.212.46.254) or a Finder-style numbered-duplicate
# file (" 2.bak", " 3.lock", ...) to (re-)enter the tracked tree. This is the static-text
# companion to sandbox/host-guard.mjs (which is the *runtime* allowlist rail): the runtime
# guard stops a stray base from leaving the process; this gate stops a stray host *string*
# or a junk dupe file from ever being committed.
#
# WHY: agents repeatedly strayed onto the user's paused shared SiteGround box and tanked it
# (PHP/CPU overload via parallel renders + per-post Elementor CSS regen, 2026-06-14). Once the
# host is purged from the tree, this gate keeps it out.
#
# WHAT IT CHECKS (TRACKED files only — `git ls-files`):
#   1. CONTENT: no tracked file may contain   sg-host | georges232 | 35.212.46.254
#   2. PATHS:   no tracked path may be a numbered duplicate  " <digits>"  or  " <digits>.<ext>"
#              (macOS/rsync collision marker, e.g. "build-absolute.mjs 2.bak",
#               "session-... 2.lock", "foo.lock 2.flock").
#
# EXCLUSIONS (content check only): files allowed to contain the patterns because they
# legitimately *define* or *document* the rule — see ALLOWLIST below. By default that is only
# this script, the runtime guard, the hook, and the CI workflow. If a doc must legitimately
# quote the host to explain the rule, add its exact tracked path to ALLOWLIST.
#
# RUN MANUALLY:     sh scripts/check-no-stray-host.sh
# OFFLINE SELFTEST: sh scripts/check-no-stray-host.sh --selftest   (touches NO host/network)
# INSTALL AS HOOK:  git config core.hooksPath .githooks
#                   (the tracked .githooks/pre-commit calls this script)
# CI:               wired in .github/workflows/no-stray-host.yml
#
# Exit 0 = clean, exit 1 = violation(s) found (prints offending file:line / path), exit 2 = usage.
# POSIX sh. No network, no host access. Fast: one `git grep` + one `git ls-files` pass.

set -eu

# ── Patterns ──────────────────────────────────────────────────────────────────
# Stray-host content pattern (ERE). We flag the host only when it appears as a LIVE URL TARGET
# (an http(s):// literal pointing at it) — that is the actual stray-render/PUT landmine. This
# deliberately does NOT match: shell/regex GUARD patterns (`*sg-host.com*`, `/\.sg-host\.com$/`),
# SSH-host examples (`ssh.example.sg-host.com`), prose docs, or historical runtime logs — none of
# which can cause a render/PUT. A bare host assignment without a scheme is still caught at RUNTIME
# by sandbox/host-guard.mjs (resolveBase/assertAllowedBase); this static gate guards the URL form.
CONTENT_RE='https?://[A-Za-z0-9._:@/-]*(sg-host|georges232|35\.212\.46\.254)'
# Numbered-duplicate path marker: a space, one+ digits, then a dot (extension start) or EOL.
# Catches " 2.bak", " 3.lock", " 2.lock.flock", and a bare trailing " 2".
DUPE_RE=' [0-9][0-9]*(\.|$)'

# ── Allowlist: tracked paths permitted to contain CONTENT_RE (they define/document the rule).
# One path per line; exact `git ls-files` path. Keep this MINIMAL.
ALLOWLIST='sandbox/host-guard.mjs
scripts/check-no-stray-host.sh
.githooks/pre-commit
.github/workflows/no-stray-host.yml
scripts/deploy/DEPLOY.md
scripts/deploy/deploy-plugin.sh
plugin/skills/joist-clone/pipeline/host-guard.mjs'

# ── Self-test: offline, builds a throwaway git repo with a known-bad file + a clean file and
#    asserts the gate fails on bad and passes on clean. Touches NO network/host.
if [ "${1:-}" = "--selftest" ]; then
  selfsh=$0
  case $selfsh in /*) : ;; *) selfsh=$(pwd)/$selfsh ;; esac
  tmp=$(mktemp -d) || { echo "selftest: mktemp failed" >&2; exit 2; }
  trap 'rm -rf "$tmp"' EXIT
  (
    cd "$tmp"
    git init -q
    git config user.email t@t.t; git config user.name t
    # clean baseline
    mkdir -p ok; printf 'hello clean\n' > ok/clean.txt
    git add -A; git commit -qm init
  )
  rc=0
  # 1) clean tree must PASS
  if ! ( cd "$tmp" && sh "$selfsh" >/dev/null 2>&1 ); then
    echo "selftest FAIL: clean tree did not pass"; rc=1
  fi
  # 2) stray-host content must FAIL
  ( cd "$tmp" && printf 'const u = "https://georges232.sg-host.com/wp-json/x"\n' > ok/bad.mjs && git add -A && git commit -qm bad )
  if ( cd "$tmp" && sh "$selfsh" >/dev/null 2>&1 ); then
    echo "selftest FAIL: stray-host URL target was not caught"; rc=1
  fi
  ( cd "$tmp" && git rm -q ok/bad.mjs && git commit -qm rmbad )
  # 3) IP-literal URL target must FAIL
  ( cd "$tmp" && printf 'fetch("http://35.212.46.254/wp-json/wp/v2/media")\n' > ok/ip.mjs && git add -A && git commit -qm ip )
  if ( cd "$tmp" && sh "$selfsh" >/dev/null 2>&1 ); then
    echo "selftest FAIL: IP literal was not caught"; rc=1
  fi
  ( cd "$tmp" && git rm -q ok/ip.mjs && git commit -qm rmip )
  # 4) numbered-duplicate path must FAIL
  ( cd "$tmp" && printf 'x\n' > "ok/note 2.bak" && git add -A && git commit -qm dupe )
  if ( cd "$tmp" && sh "$selfsh" >/dev/null 2>&1 ); then
    echo "selftest FAIL: numbered-duplicate path was not caught"; rc=1
  fi
  ( cd "$tmp" && git rm -q "ok/note 2.bak" && git commit -qm rmdupe )
  # 5) multi-extension dupe must FAIL
  ( cd "$tmp" && printf 'x\n' > "ok/note.lock 2.flock" && git add -A && git commit -qm dupe2 )
  if ( cd "$tmp" && sh "$selfsh" >/dev/null 2>&1 ); then
    echo "selftest FAIL: multi-extension dupe was not caught"; rc=1
  fi
  ( cd "$tmp" && git rm -q "ok/note.lock 2.flock" && git commit -qm rmdupe2 )
  # 6) after cleanup, tree must PASS again
  if ! ( cd "$tmp" && sh "$selfsh" >/dev/null 2>&1 ); then
    echo "selftest FAIL: cleaned tree did not pass"; rc=1
  fi
  if [ "$rc" -eq 0 ]; then echo "check-no-stray-host --selftest: ALL PASS"; else echo "check-no-stray-host --selftest: FAILURES"; fi
  exit "$rc"
fi

case "${1:-}" in
  -h|--help)
    echo "usage: sh scripts/check-no-stray-host.sh [--selftest]"; exit 0 ;;
  "" ) : ;;
  * )
    echo "unknown argument: $1" >&2
    echo "usage: sh scripts/check-no-stray-host.sh [--selftest]" >&2
    exit 2 ;;
esac

# Resolve repo root so the gate works from any cwd (the hook runs from repo root anyway).
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "check-no-stray-host: not inside a git work tree" >&2
  exit 2
}
cd "$ROOT"

# Build a grep -F filter of allowlisted paths (anchored full-line via -x).
ALLOWFILE=$(mktemp) || { echo "check-no-stray-host: mktemp failed" >&2; exit 2; }
trap 'rm -f "$ALLOWFILE"' EXIT
printf '%s\n' "$ALLOWLIST" > "$ALLOWFILE"

fail=0

# ── Check 1: stray-host content in tracked files. ──────────────────────────────────────────
# `git grep -I -n -E` searches TRACKED files only and skips binaries. Drop allowlisted paths
# by full-path match on the "path:line:content" hit lines.
content_hits=$(git grep -I -n -E "$CONTENT_RE" -- '*.mjs' '*.js' '*.cjs' '*.ts' '*.php' '*.sh' 2>/dev/null || true)
if [ -n "$content_hits" ]; then
  # Keep only hits whose path (field before first ':') is NOT allowlisted.
  filtered=$(printf '%s\n' "$content_hits" | while IFS= read -r line; do
    path=${line%%:*}
    if grep -Fxq -- "$path" "$ALLOWFILE"; then
      continue
    fi
    printf '%s\n' "$line"
  done)
  if [ -n "$filtered" ]; then
    echo "STRAY-HOST CONTENT found in tracked files (sg-host / georges232 / 35.212.46.254):" >&2
    printf '%s\n' "$filtered" | sed 's/^/  /' >&2
    fail=1
  fi
fi

# ── Check 2: numbered-duplicate tracked paths. ─────────────────────────────────────────────
dupe_hits=$(git ls-files | grep -E -- "$DUPE_RE" || true)
if [ -n "$dupe_hits" ]; then
  echo "NUMBERED-DUPLICATE tracked paths (Finder/rsync collision markers — delete or rename):" >&2
  printf '%s\n' "$dupe_hits" | sed 's/^/  /' >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "check-no-stray-host: FAILED. Remove the stray host references / dupe files above." >&2
  echo "  (If a file legitimately documents the rule, add its path to ALLOWLIST in this script.)" >&2
  exit 1
fi

echo "check-no-stray-host: OK — no stray-host strings, no numbered-duplicate paths."
exit 0
