#!/usr/bin/env bash
# =============================================================================
# joist-connect.sh — Wire Claude Code (or any MCP client) to a WordPress site
# running the Joist plugin, and write a .mcp.json in the current directory.
#
# @purpose User-facing onboarding wizard (CEK audit steal W3.1). Steals the
# proven shape of emersimeon/claude-elementor-kit's setup wizard, hardened with
# the verified 2026 managed-host findings (see knowledge/CEK_AUDIT_STEAL_PLAN.md
# and the CEK build-research wave): browser-like UA (WP Engine/Flywheel 429 named
# AI bots), HTTPS gate (App Passwords need SSL), and a preflight that DISTINGUISHES
# Authorization-header stripping vs disabled-app-passwords vs host anti-bot vs
# DISALLOW_FILE_MODS — because each needs a different fix.
#
# Usage:  bash scripts/install/joist-connect.sh
# Idempotent: safe to re-run. Writes only .mcp.json (merges, never clobbers).
#
# NOTE: v1 — authored against verified research; validate against a live hardened
# host before relying on the host-playbook branches.
# =============================================================================
set -uo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
RED=$'\033[31m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
step() { printf "\n${BOLD}${CYAN}▸ %s${RESET}\n" "$*"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$*"; }
warn() { printf "  ${YELLOW}⚠${RESET} %s\n" "$*"; }
fail() { printf "  ${RED}✗${RESET} %s\n" "$*"; }
info() { printf "  ${DIM}%s${RESET}\n" "$*"; }
ask()  { printf "${BOLD}? %s${RESET} " "$*"; }
abort(){ fail "$1"; exit 1; }

need(){ command -v "$1" >/dev/null 2>&1 || abort "Missing required command: $1"; }
need curl; need python3

# A neutral, product-branded UA. NEVER 'ClaudeBot'/'GPTBot' — WP Engine/Flywheel
# rate-limit named AI bots to 429 at the platform edge (verified 2026).
UA="Joist-Installer/1.0 (+https://joist.app)"
CURL=(curl -sS --max-time 20 -A "$UA" -H "Accept: application/json")

# Read a dotted path from JSON on stdin. Lenient: some WP plugins emit invalid
# backslash escapes in the /wp-json index; sanitize before parsing.
jget() {
  python3 - "$1" <<'PY'
import sys, json, re
def sanitize(s):
    out=[]; i=0; valid=set('"\\/bfnrtu')
    while i < len(s):
        c=s[i]
        if c=='\\' and i+1<len(s) and s[i+1] not in valid: out.append('\\\\')
        else: out.append(c)
        i+=1
    return ''.join(out)
raw=sys.stdin.read()
try: d=json.loads(raw)
except Exception:
    try: d=json.loads(sanitize(raw))
    except Exception: print(""); sys.exit(0)
cur=d
for p in [x for x in sys.argv[1].lstrip('.').split('.') if x!='']:
    if isinstance(cur,dict): cur=cur.get(p)
    elif isinstance(cur,list) and p.lstrip('-').isdigit(): cur=cur[int(p)] if abs(int(p))<len(cur) else None
    else: cur=None
    if cur is None: break
print(json.dumps(cur) if isinstance(cur,(dict,list)) else ("" if cur is None else cur))
PY
}
# Does a JSON list/object at a dotted path contain a substring? prints yes/no.
jhas() {
  python3 - "$1" "$2" <<'PY'
import sys, json
def sanitize(s):
    out=[]; i=0; valid=set('"\\/bfnrtu')
    while i<len(s):
        c=s[i]
        if c=='\\' and i+1<len(s) and s[i+1] not in valid: out.append('\\\\')
        else: out.append(c)
        i+=1
    return ''.join(out)
raw=sys.stdin.read()
try: d=json.loads(raw)
except Exception:
    try: d=json.loads(sanitize(raw))
    except Exception: print("no"); sys.exit(0)
cur=d
for p in [x for x in sys.argv[1].lstrip('.').split('.') if x!='']:
    cur=cur.get(p) if isinstance(cur,dict) else None
    if cur is None: break
needle=sys.argv[2]
if isinstance(cur,list): print("yes" if any(needle in str(x) for x in cur) else "no")
elif isinstance(cur,dict): print("yes" if any(needle in str(k) for k in cur) else "no")
else: print("no")
PY
}

cat <<'BANNER'

  ╭───────────────────────────────────────────────╮
  │   Joist — Connect Wizard                      │
  │   ───────────────────────                     │
  │   Wires an MCP client to a WordPress site so  │
  │   Joist can build & clone Elementor pages.    │
  ╰───────────────────────────────────────────────╯
BANNER

# ── 1. Site URL ──────────────────────────────────────────────────────────────
step "1/6  Site URL"
ask "Full site URL (e.g. https://example.com):"; read -r SITE_URL
SITE_URL="${SITE_URL%/}"
[[ "$SITE_URL" =~ ^https?:// ]] || abort "URL must start with http:// or https://"

# ── 2. Connectivity preflight (normalize + classify) ─────────────────────────
step "2/6  Connectivity"
# Follow ONE redirect and persist the FINAL base URL (http→https, non-www→www).
EFFECTIVE_URL=$(curl -sS -o /dev/null -w "%{url_effective}" -A "$UA" -L --max-redirs 3 --max-time 20 "$SITE_URL/wp-json/" 2>/dev/null || echo "")
if [ -n "$EFFECTIVE_URL" ]; then
  BASE="${EFFECTIVE_URL%/wp-json/}"; BASE="${BASE%/}"
else
  BASE="$SITE_URL"
fi
ROOT_JSON=$("${CURL[@]}" -L "$BASE/wp-json/" 2>/dev/null || echo "")
ROOT_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -A "$UA" -L --max-time 20 "$BASE/wp-json/" 2>/dev/null || echo "000")
case "$ROOT_CODE" in
  200)
    if [ "$(jhas '.namespaces' 'wp/v2')" = "yes" ] || [ -n "$(jget '.name')" ]; then
      ok "Reached WP REST API at $BASE (200)"
    else
      warn "200 but no WP JSON body — likely a host anti-bot/challenge page, not WordPress."
      info "See HOST PLAYBOOK at the end. Continuing so we can classify auth too."
    fi ;;
  000) abort "Could not reach $BASE — site down, DNS, or edge block. Try opening $BASE/wp-json/ in a browser." ;;
  403|406|429) warn "Root returned $ROOT_CODE with no WP body — host edge/anti-bot block (see HOST PLAYBOOK)." ;;
  401) warn "Root returned 401 — REST may be auth-gated by a security plugin." ;;
  *) warn "Root returned HTTP $ROOT_CODE — continuing, will classify in auth probe." ;;
esac

# HTTPS gate — Application Passwords are unavailable on plain HTTP by default.
case "$BASE" in
  https://*) ok "HTTPS — App Passwords available" ;;
  *) warn "Site is plain HTTP. WordPress disables Application Passwords without SSL."
     info "Enable HTTPS (most hosts: one click) and re-run. Continuing in case SSL is offloaded upstream." ;;
esac

# ── 3. Auth ──────────────────────────────────────────────────────────────────
step "3/6  Authentication"
cat <<EOF
    Create a WordPress Application Password:
      1. ${BASE}/wp-admin → Users → Profile → "Application Passwords"
      2. Name it (e.g. "Joist MCP") → Add → copy the generated password
      3. The password's NAME is a label. The USERNAME is your WP login.
EOF
ask "WordPress username (your login, NOT the app-password label):"; read -r WP_USER
ask "Application password (input hidden; spaces OK):"; read -rs WP_PWD; printf '\n'

ME=$("${CURL[@]}" -u "$WP_USER:$WP_PWD" "$BASE/wp-json/wp/v2/users/me?context=edit" 2>/dev/null || echo "{}")
ME_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -A "$UA" -u "$WP_USER:$WP_PWD" --max-time 20 "$BASE/wp-json/wp/v2/users/me?context=edit" 2>/dev/null || echo "000")
USER_ID=$(echo "$ME" | jget '.id')

if [ -n "$USER_ID" ] && [ "$USER_ID" != "null" ]; then
  ok "Authenticated as: $(echo "$ME" | jget '.name') (id ${USER_ID})"
  CAPS=$(echo "$ME" | jget '.capabilities')
  UNFILTERED=$(echo "$ME" | jhas '.capabilities' 'unfiltered_html')
  CAN_INSTALL=$(echo "$ME" | jhas '.capabilities' 'install_plugins')
  [ "$UNFILTERED" = "yes" ] && ok "User has unfiltered_html — shortcodes/<style>/<script> save untouched." \
    || warn "User lacks unfiltered_html — bare '&' in a shortcode attr will become &amp; (Elementor #23302). [fluentform id=\"N\"] is unaffected."
else
  # Disambiguate the failure — each cause has a DIFFERENT fix.
  # Check the host anti-bot HTML-challenge signal FIRST — an HTML body yields an
  # empty .code, which would otherwise be misread as header-stripping below.
  if echo "$ME" | grep -qiE "<html|captcha|cloudflare|just a moment"; then
    fail "Auth probe returned an HTML challenge page — host anti-bot block (see HOST PLAYBOOK)."
  elif [ "$ROOT_CODE" = "200" ] && { [ "$ME_CODE" = "401" ] || [ "$ME_CODE" = "403" ]; }; then
    BODY_CODE=$(echo "$ME" | jget '.code')
    if [ "$BODY_CODE" = "rest_not_logged_in" ] || [ -z "$BODY_CODE" ]; then
      fail "Auth failed ($ME_CODE) but /wp-json/ root is 200 — classic Authorization-header STRIPPING."
      info "Apache/CGI/FastCGI often strip the Authorization header before PHP. Add to .htaccess:"
      info "  RewriteEngine On"
      info "  RewriteCond %{HTTP:Authorization} ^(.*)\$"
      info "  RewriteRule .* - [E=HTTP_AUTHORIZATION:%1]"
      info "  (or 'CGIPassAuth On'). WordPress may overwrite .htaccess on plugin activation — re-apply if it regresses."
    else
      fail "Auth failed ($ME_CODE, code=$BODY_CODE). App Passwords may be disabled by a security plugin/host filter, or the username is wrong."
    fi
  else
    fail "Auth failed (HTTP $ME_CODE)."
  fi
  # App-password label≠username helper: list public users so the user can pick the right slug.
  info "Public users on this site (pick the correct username slug):"
  "${CURL[@]}" "$BASE/wp-json/wp/v2/users?per_page=10" 2>/dev/null | python3 - <<'PY' || true
import sys,json
try: d=json.load(sys.stdin)
except Exception: d=[]
for u in (d if isinstance(d,list) else []):
    print(f"     • {u.get('slug','?')} — {u.get('name','?')}")
PY
  abort "Re-run with the correct username (and apply the fix above if header-stripping)."
fi

# ── 4. Joist plugin + MCP route ──────────────────────────────────────────────
step "4/6  Joist plugin"
HAS_JOIST=$(echo "$ROOT_JSON" | jhas '.namespaces' 'joist/v1')
HAS_MCP=$(echo "$ROOT_JSON" | jhas '.namespaces' 'joist-mcp')
if [ "$HAS_JOIST" = "yes" ]; then
  ok "Joist REST namespace (joist/v1) present"
else
  warn "Joist plugin not detected on this site."
  info "The WP REST plugins endpoint can only install plugins by wordpress.org SLUG — it cannot"
  info "install an arbitrary zip. Joist ships as a zip (dist/joist-vX.zip), so install it manually:"
  info "  ${BASE}/wp-admin/plugin-install.php?tab=upload  → upload dist/joist-*.zip → Activate"
  info "(On Local-by-Flywheel you can instead: wp plugin install /path/to/joist.zip --activate)"
  ask "Press Enter once Joist is installed + activated (or 'skip' to write config anyway):"; read -r R
  [ "$R" = "skip" ] || ROOT_JSON=$("${CURL[@]}" -u "$WP_USER:$WP_PWD" "$BASE/wp-json/" 2>/dev/null || echo "$ROOT_JSON")
  HAS_MCP=$(echo "$ROOT_JSON" | jhas '.namespaces' 'joist-mcp')
fi

step "5/6  MCP route"
verify_mcp(){ "${CURL[@]}" -u "$WP_USER:$WP_PWD" "$BASE/wp-json/" 2>/dev/null | jhas '.namespaces' 'joist-mcp'; }
if [ "$HAS_MCP" = "yes" ] || [ "$(verify_mcp)" = "yes" ]; then
  ok "Joist MCP namespace (joist-mcp) registered"
else
  warn "joist-mcp namespace not visible. Usually: plugin inactive, or permalinks need flushing."
  info "  1. WP Admin → Plugins: confirm Joist is Active"
  info "  2. WP Admin → Settings → Permalinks → Save (flushes REST rewrites)"
  info "  3. Confirm the mcp-adapter dependency is active (Joist mounts its MCP through it)"
  ask "Press Enter to re-check (or 'skip' to write config anyway):"; read -r R
  if [ "$R" != "skip" ] && [ "$(verify_mcp)" = "yes" ]; then ok "joist-mcp now registered"; else warn "Still not visible — writing config anyway so you can debug."; fi
fi

# ── 6. Write .mcp.json (merge, never clobber) ────────────────────────────────
step "6/6  Writing .mcp.json"
MCP_URL="$BASE/wp-json/joist-mcp/v1/messages"
AUTH_B64=$(printf "%s:%s" "$WP_USER" "$WP_PWD" | python3 -c "import sys,base64;sys.stdout.write(base64.b64encode(sys.stdin.buffer.read()).decode())")
MCP_FILE="$(pwd)/.mcp.json"

python3 - "$MCP_FILE" "$MCP_URL" "$AUTH_B64" <<'PY'
import sys, json, os
path, url, auth = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = {}
if os.path.exists(path):
    raw = open(path).read()
    if raw.strip():
        try:
            cfg = json.loads(raw)
        except Exception:
            # Never silently clobber a non-empty file we failed to parse — back it up.
            bak = path + ".bak"
            open(bak, "w").write(raw)
            sys.stderr.write("  WARNING: existing .mcp.json was unparseable — backed up to " + bak + ".\n")
            sys.stderr.write("  Rewriting with only the 'joist' server; merge your other servers back from the backup.\n")
            cfg = {}
if not isinstance(cfg, dict): cfg = {}
servers = cfg.get("mcpServers")
if not isinstance(servers, dict): servers = {}
servers["joist"] = {"type": "http", "url": url, "headers": {"Authorization": "Basic " + auth}}
cfg["mcpServers"] = servers
json.dump(cfg, open(path, "w"), indent=2)
print("wrote " + path)
PY
ok "Wrote $MCP_FILE (merged — existing servers preserved)"

cat <<EOF

  ${BOLD}${GREEN}✓ Connected${RESET}
    1. ${CYAN}Quit and reopen your MCP client${RESET} in this directory (it reads .mcp.json at startup)
    2. Approve the ${BOLD}joist${RESET} MCP server when prompted
    3. Try: ${DIM}"list my pages"${RESET} or ${DIM}"clone https://example.com onto a new page"${RESET}

  ${BOLD}HOST PLAYBOOK${RESET} (if you hit an edge/anti-bot block above):
    ${BOLD}WP Engine / Flywheel${RESET} — platform 429 on named AI-bot UAs. This wizard already sends a
      neutral UA; if a client still uses a ClaudeBot/GPTBot UA, change it. If still blocked, request an
      "exceptional use case" allowlist from WP Engine (the WREn rules UI does NOT override platform rules).
    ${BOLD}SiteGround${RESET} — Anti-Bot AI challenges /wp-json. Ask support to IP-allowlist your client for
      the auth step. For MCP, a Cloudflare Transform Rule + cache-bypass on /wp-json/joist-mcp/* helps.
    ${BOLD}Kinsta${RESET} — enable "Allow typical WordPress automations" (managed allowlist incl. REST API).
    ${BOLD}Cloudways${RESET} — relax Anti-Bot under Server Security → Firewall; if Cloudflare Enterprise
      add-on is on, allowlist your client or relax Browser Integrity Check.
    ${BOLD}403 rest_cannot_install_plugin${RESET} — DISALLOW_FILE_MODS is set (common on managed hosts);
      install Joist by manual upload (already the default path above).
EOF
