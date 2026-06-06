# Joist Plugin Deploy Runbook

Ready-to-run scaffolding for shipping the Joist plugin from this repo to a
WordPress host. **No credentials are stored here** — everything host-specific
comes from environment variables you set at run time.

> The live target today is the SiteGround-hosted site **georges232** (an
> `*.sg-host.com` deploy), currently running Joist `0.10.x-alpha`, deployed
> **manually via SFTP or SSH/WP-CLI** (see `knowledge/WP_SITE_ACCESS_PATTERNS.md`,
> patterns #4 and #5). This pipeline replaces that manual step. It does **not**
> embed georges232's host or path — you supply those.

---

## 0. What ships vs. what doesn't

The dist is assembled by `rsync --exclude-from .distignore`. Summary:

| Ships ✅ | Excluded ❌ |
|---|---|
| `joist.php`, `uninstall.php` | `node_modules/` |
| `README.md`, `joist.constitution.md` | `package.json`, `package-lock.json` |
| `src/` **PHP** (PSR-4) | `src/admin-app/` (React **source**) |
| `assets/` (incl. `assets/widget-pack/motion/` runtime) | `tests/`, `phpunit.*` |
| `build/` (compiled wp-scripts bundle) | `*.map`, `*.log`, `.cache/` |
| `languages/` (if present) | `.git/`, `.github/`, `scripts/`, `.tenet/`, `skills/` |

Key subtlety: **`src/admin-app/` source is excluded, but its compiled output in
`build/` ships** — that compiled bundle is what `AssetEnqueue` loads in wp-admin.
Always build (or `--skip-build` only when `build/` is known current).

---

## 1. Prerequisites

### Tooling (local machine)
- **rsync transport:** `rsync` + `ssh`
- **sftp transport:** `lftp`
- Either way: `npm` (unless `--skip-build`), `bash`

### Host access — pick ONE transport
- **rsync over SSH (preferred):** requires SSH enabled on the host and an SSH
  **key**. On SiteGround, SSH/SFTP is enabled per-site in **Site Tools → Devs →
  SSH Keys Manager**; you generate/upload a key there. SiteGround SSH/SFTP
  commonly listens on a **non-22 port (often `18765`)** — set `JOIST_DEPLOY_PORT`.
- **lftp/sftp batch (fallback):** when SSH shell is unavailable but SFTP is.
  Same SiteGround key works for SFTP. Key auth strongly preferred over password.

> **SiteGround availability is UNCONFIRMED here.** This scaffolding assumes SG
> offers SSH/SFTP (it does on most plans), but verify the plan tier and grab
> the exact hostname/port/user from Site Tools before the first real run.

### Credentials — never commit, never hardcode
Store the SSH/SFTP key in `~/.ssh/` (or ssh-agent) and reference it via
`JOIST_DEPLOY_KEY`. Never place keys or passwords in the repo or in CI logs.

---

## 2. Environment variable reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `JOIST_DEPLOY_TRANSPORT` | no | `rsync` | `rsync` or `sftp` (or use `--transport`) |
| `JOIST_DEPLOY_HOST` | **yes** | — | SSH/SFTP hostname (e.g. `ssh.example.sg-host.com`) |
| `JOIST_DEPLOY_USER` | **yes** | — | SSH/SFTP username |
| `JOIST_DEPLOY_REMOTE_PLUGIN_DIR` | **yes** | — | **Absolute** remote path to the plugin dir (see §3) |
| `JOIST_DEPLOY_PORT` | no | `22` | SSH/SFTP port (SiteGround often `18765`) |
| `JOIST_DEPLOY_KEY` | no¹ | — | Path to SSH/SFTP private key |
| `JOIST_DEPLOY_PASSWORD` | no¹ | — | SFTP password (sftp mode only; discouraged) |
| `JOIST_DEPLOY_SSH_OPTS` | no | — | Extra raw `ssh` options (advanced) |

¹ For `sftp` you must provide **either** `JOIST_DEPLOY_KEY` (preferred) or
`JOIST_DEPLOY_PASSWORD`. For `rsync`, key auth (or an ssh-agent identity) is
expected.

Missing a required var → the script **fails loudly** with exit code `2` and
lists exactly what's missing.

---

## 3. The remote plugin directory (you MUST set this)

The on-host plugin folder name is **unknown** and must be parameterized. The
WordPress plugins dir is `…/wp-content/plugins/`. On SiteGround the doc root is
typically:

```
/home/customer/www/<site-domain>/public_html/wp-content/plugins/<joist-dir>
```

`<joist-dir>` is whatever the plugin folder is currently named on the host
(commonly `joist`, but it could differ if it was uploaded under another name).
**Confirm via SFTP listing or `wp plugin list --path=…` before deploying**, then
set the full absolute path:

```bash
export JOIST_DEPLOY_REMOTE_PLUGIN_DIR="/home/customer/www/example.com/public_html/wp-content/plugins/joist"
```

> ⚠️ The script syncs *into* this dir with `--delete`. Point it at the wrong
> path and you could delete unrelated files. Always run `--dry-run` first.

---

## 4. Deploy — dry-run, then real

```bash
# 1) Set env (example values — replace with real ones; do NOT commit)
export JOIST_DEPLOY_TRANSPORT=rsync
export JOIST_DEPLOY_HOST="ssh.example.sg-host.com"
export JOIST_DEPLOY_USER="u1234-deploy"
export JOIST_DEPLOY_PORT=18765
export JOIST_DEPLOY_KEY="$HOME/.ssh/joist_deploy_ed25519"
export JOIST_DEPLOY_REMOTE_PLUGIN_DIR="/home/customer/www/example.com/public_html/wp-content/plugins/joist"

# 2) DRY RUN — builds + stages locally, shows exactly what would transfer, no remote writes
scripts/deploy/deploy-plugin.sh --dry-run

# 3) Real deploy (after reviewing the dry-run itemized list)
scripts/deploy/deploy-plugin.sh

# Reuse an already-built build/ (skip npm):
scripts/deploy/deploy-plugin.sh --skip-build

# SFTP transport instead of rsync:
scripts/deploy/deploy-plugin.sh --transport sftp --dry-run
```

The script: validates env → `npm run build` (unless `--skip-build`) → stages a
clean dist via `.distignore` → sanity-checks the dist (must contain `joist.php`
+ `build/`, must NOT contain `node_modules`/`tests`/`src/admin-app`) → syncs.

---

## 4b. Manual wp-admin upload (no SSH) — folder-name caveat

When there are no SSH/SFTP creds, the fallback is **WP Admin → Plugins → Add New → Upload Plugin**
with `dist/joist-v<ver>.zip`. **Gotcha (hit live 2026-06-06):** WordPress keys "is this an update vs a
new plugin?" off the **top-level folder name inside the zip**, not the plugin header. If the zip's folder
(`joist/`) differs from the *installed* folder, WP installs a **duplicate** instead of updating — you end
up with two "Joist" entries (e.g. 0.10.13 + 0.10.14). Two copies of `\Joist\*` classes active at once =
fatal redeclare, so only one may be active.

- **Fix when it happens:** activate the new one, **deactivate + Delete the old** (its folder differs from
  `joist/`). Confirm the survivor via `joist_get_site_info` → `capabilities.motion.vendor_base_url`
  (should be `…/plugins/joist/…`).
- **Avoid it:** name the zip's top folder to **match the installed folder** before zipping, or use the
  rsync/SFTP path (§4), which syncs *into* the existing dir and never renames. Once the active plugin is at
  `plugins/joist/`, future `joist/`-folder uploads update it in place.

## 5. Post-sync: flush caches & opcache

Plugin files are PHP — **PHP OPcache** and any page/object cache must be cleared
or the host may keep serving the old `joist.php` / `src/`.

**If you have SSH + WP-CLI on the host:**
```bash
ssh -p "$JOIST_DEPLOY_PORT" -i "$JOIST_DEPLOY_KEY" "$JOIST_DEPLOY_USER@$JOIST_DEPLOY_HOST" '
  cd /home/customer/www/example.com/public_html && \
  wp cache flush && \
  wp elementor flush-css || true
'
```
- `wp cache flush` clears the object cache.
- Elementor CSS: `wp elementor flush-css` (regenerate on next view).

**OPcache** (cleared on PHP-FPM reload, or via WP-CLI eval if not disabled):
```bash
wp eval 'opcache_reset();'   # only if OPcache + WP-CLI permit it
```

**Common cache plugins — clear via their UI or WP-CLI:**
- **SiteGround SG Optimizer:** `wp sg purge` (SG's CLI), or *SG Optimizer →
  Caching → Purge*. Also purge **Dynamic Cache** + **Memcached** if enabled.
- **WP Rocket:** `wp rocket clean --confirm` / *Settings → Clear Cache*.
  Note WP Rocket **delay-JS** can defer scripts — relevant to motion (see §7).
- **LiteSpeed Cache:** `wp litespeed-purge all`.
- **WP Engine native:** purge via *WP Engine → Caching* in wp-admin.
- **Cloudflare/CDN:** purge if fronting the site.

If none of the above are available (pure SFTP, no SSH/WP-CLI): clear caches from
each plugin's wp-admin screen, and ask the host to reload PHP-FPM if OPcache is
serving stale code.

---

## 6. Rollback

This pipeline does **not** create remote backups for you. Choose one before the
real deploy:

1. **Pre-deploy snapshot (recommended).** Tar the live plugin dir first:
   ```bash
   ssh -p "$JOIST_DEPLOY_PORT" -i "$JOIST_DEPLOY_KEY" "$JOIST_DEPLOY_USER@$JOIST_DEPLOY_HOST" \
     "cd \$(dirname '$JOIST_DEPLOY_REMOTE_PLUGIN_DIR') && \
      tar czf joist-backup-\$(date +%Y%m%d-%H%M%S).tgz \$(basename '$JOIST_DEPLOY_REMOTE_PLUGIN_DIR')"
   ```
   To roll back: extract that tarball over the plugin dir, then re-flush caches (§5).
2. **Re-deploy a known-good git tag.** `git checkout <prev-tag>` in this repo and
   re-run `deploy-plugin.sh`. Because the sync is `--delete`, the remote returns
   to exactly the prior tree.
3. **SiteGround daily backups / staging.** SG keeps automatic backups; restore
   from Site Tools as a last resort (coarse — restores the whole site).

> ⚠️ `--delete` means an interrupted/partial sync can leave the plugin in a
> broken half-state. If a deploy fails mid-transfer, re-run it to completion (or
> restore the snapshot) before leaving the site.

---

## 7. POST-DEPLOY VERIFICATION CHECKLIST — motion escape-hatch (Path A)

This release is the **first runtime-bearing build**: it ships the plugin-bundled
GSAP motion runtime so motion flows through **Path A** (plugin-enqueued) instead
of the **Path B** content-injected CDN fallback. After deploying, confirm Path A
is actually live. Reference: `knowledge/GSAP_ESCAPE_HATCH_SPEC.md` §11.

### (i) Capability flag is now advertised
`joist_get_site_info` (MCP) — or `GET /wp-json/joist/v1/site` — must now return a
`capabilities.motion` block. **Before this build there was no `motion` key**;
the agent's path selection keys off exactly this:

- [ ] `capabilities.motion.scroll_reveal === true`
- [ ] `capabilities.motion.effects` is a non-empty array (e.g. `fade-up`, …)
- [ ] `capabilities.motion.runtime_version` equals the deployed `JOIST_VERSION`
      (e.g. `0.10.12-alpha`) — confirms the *new* build is what's serving, not a
      cached old one.

Via MCP:
```
joist_get_site_info()  →  inspect .capabilities.motion
```
Via REST:
```bash
curl -s --basic --user "agent@example.com:APP_PASSWORD" \
  https://example.com/wp-json/joist/v1/site | jq '.capabilities.motion'
# expect: { "scroll_reveal": true, "effects": [ ... ], "runtime_version": "0.10.12-alpha" }
```
If `motion` is absent → the new build isn't active (cache/OPcache stale, or the
sync didn't land). Re-flush (§5) and re-check before doing anything else.

### (ii) Round-trip still passes (no regression)
The motion runtime must not have broken core write/read. Confirm:

- [ ] `joist_smoke_test_roundtrip` returns success (kill-switch probe green).

```
joist_smoke_test_roundtrip()  →  expect pass
```
This is the §5 gate from the GSAP spec ("round-trip kill-switch probe — do
first"). A failure here is a hard stop; consider rollback (§6).

### (iii) A page with `joist-reveal` enqueues the Path A scripts (NOT the fallback)
On a published page whose Elementor data contains `joist-reveal` classes, the
`WidgetPack\Motion\Emitter` should enqueue the three vendored handles. Confirm
**all three** appear in the rendered front-end HTML:

- [ ] `joist-gsap`        (`assets/widget-pack/motion/vendor/gsap.min.js`)
- [ ] `joist-scrolltrigger` (`…/vendor/ScrollTrigger.min.js`)
- [ ] `joist-motion`      (`…/joist-motion.js`)
- [ ] These are served **from the plugin** (URLs under
      `…/wp-content/plugins/<joist-dir>/assets/widget-pack/motion/…`), **not** a
      CDN `<script>` injected as an html widget (that would be the Path B
      fallback).
- [ ] No `joist-motion-fallback.html` inline block / CDN GSAP `<script>` is
      present on the page (its presence means the site fell back to Path B —
      i.e. the runtime wasn't detected).

Quick check (replace with a real page URL that has reveal classes):
```bash
curl -s https://example.com/some-page-with-reveals/ | \
  grep -Eo "joist-(gsap|scrolltrigger|motion)[^\"']*\.js" | sort -u
# expect all three handles, all under .../wp-content/plugins/.../motion/
```

> A site on an **older** build will (correctly) report no `capabilities.motion`
> and the agent auto-selects Path B. The point of this checklist is to confirm
> *this* deploy flipped the target from B → A with no re-authoring needed —
> pages authored under Path B render identically under Path A (same
> `joist-reveal[--effect]` classes; §11 invariants).

### Sign-off
- [ ] (i) capability flag present + `runtime_version` matches deployed version
- [ ] (ii) `joist_smoke_test_roundtrip` passes
- [ ] (iii) reveal page enqueues `joist-gsap` + `joist-scrolltrigger` +
      `joist-motion` from the plugin (Path A), no fallback artifact
- [ ] Caches/OPcache flushed (§5)
- [ ] Rollback artifact captured (§6)
