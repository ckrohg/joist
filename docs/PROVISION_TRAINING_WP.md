# Provisioning a Training WordPress for the Joist clone pipeline

`sandbox/provision-training-wp.sh` makes any fresh WordPress **1:1-clone-ready** for the Joist clone
pipeline. The **same** script runs against the local Docker sandbox today and against your sized
instance later — you only change `--base` / `JOIST_TRAINING_BASE`.

It is **pure WP-CLI, idempotent, and §0-host-guarded**: it refuses to touch anything that is not
`localhost:8001` or your declared `JOIST_TRAINING_BASE`, and hard-blocks the paused shared SiteGround
host (`*.sg-host.com` / `georges232`) even if you ask for it.

---

## What you must provide for a NEW instance

| Thing | Required? | How it's passed |
|---|---|---|
| **WP host base URL** (reachable, WP already installed for remote) | yes | `--base https://train.example.com` or `export JOIST_TRAINING_BASE=…` |
| **WP-CLI access to that host** | yes | `--runner ssh` + `export JOIST_TRAINING_SSH=user@host:/path/to/wp` (uses `wp --ssh`) |
| **Admin user** for the application password | yes | `--admin-user joist` (default `joist`) |
| **Admin password** (only if WP core isn't installed yet) | local only | `--admin-pass …` or `ADMIN_PW` env |
| **Elementor Pro zip** | optional | `--pro-zip /path/elementor-pro.zip` (skipped cleanly if absent — body clone works on free) |
| **Elementor Pro license key** | optional | `--pro-license XXXX` (needs `--pro-zip`) |
| **Source webfonts** (`*.woff2`, e.g. Suisse/Söhne) | optional | `--fonts-dir /path/to/woff2/` (else `@font-face` rules 404 and the browser falls back) |

The script mints a fresh **WP application password** and prints `JOIST_BASE` + `JOIST_AUTH_B64`
(base64 of `admin:app-pw`). That base64 is the credential the REST PUT path
(`eval/grader/transpile-html.mjs`, `scratch-harness.mjs`) uses.

---

## One-command runs

**Local Docker sandbox (default):**
```bash
sandbox/provision-training-wp.sh                # runner=docker, base=http://localhost:8001, Elementor 3.28.4
```

**Your sized remote instance** (point `JOIST_TRAINING_BASE`, run over SSH):
```bash
export JOIST_TRAINING_BASE=https://train.example.com
export JOIST_TRAINING_SSH=ssh-user@train.example.com:/var/www/html
sandbox/provision-training-wp.sh \
  --runner ssh \
  --base "$JOIST_TRAINING_BASE" \
  --elementor-version 3.28.4 \
  --admin-user joist \
  --pro-zip /path/elementor-pro.zip --pro-license YOUR-KEY \   # optional
  --fonts-dir /path/to/source-woff2                            # optional
```
> For a remote (`ssh`/`wp`) runner the script **does not push files implicitly**. It tells you to
> `rsync plugin/ → wp-content/plugins/joist` and `scp` the two `sandbox/mu-plugins/*.php` into
> `wp-content/mu-plugins/` (and any `--fonts-dir` woff2 into `uploads/joist-fonts/`), then re-run
> with `--verify-only`. This is deliberate: the §0 rail is "never write to a host you didn't name",
> and the same conservatism applies to file copies.

**Verify an already-provisioned instance (no mutation):**
```bash
sandbox/provision-training-wp.sh --runner docker --verify-only
# or:  --runner ssh --base "$JOIST_TRAINING_BASE" --verify-only
```

---

## The "point JOIST_TRAINING_BASE" step (local → sized instance)

1. `export JOIST_TRAINING_BASE=https://train.example.com` — this single env var:
   - **allowlists** that host in the §0 guard (`sandbox/host-guard.mjs` reads it at import), so every
     render/PUT in the pipeline is now allowed to target it (and still refuses everything else);
   - becomes the default `--base` for non-docker runners.
2. Run the provisioner against it (command above).
3. Source the printed creds: write `export JOIST_BASE=… / export JOIST_AUTH_B64=…` to
   `/tmp/joist-auth.env` (the harness reads it; the value is a secret — don't echo it elsewhere).
4. The whole clone pipeline now runs against your instance with **zero code changes**.

---

## What gets provisioned (ordered)

0. **§0 host-guard assertion** — refuse any target not `localhost:8001` / `JOIST_TRAINING_BASE`; hard-block sg-host.
1. **WP core sanity + pretty permalinks** (`/%postname%/`) — the pretty `/wp-json/` REST route the builder PUTs to needs them.
2. **Hello Elementor** theme (chrome-free, de-Jupiter) + **Elementor pinned to 3.28.4** — the channel the PreserveCSS Emitter was proven on.
3. **Elementor Pro** (optional) from your zip + license — only needed for Theme-Builder site parts; skipped cleanly otherwise.
4. **Joist plugin** (`plugin/`, carries `WidgetPack/PreserveCSS/Emitter.php`) + two **mu-plugins**:
   - `joist-training-fonts.php` — site-wide `@font-face` registration (the `_font-probe.mjs` font channel), JSON-parameterizable via `JOIST_FONT_FACES`.
   - `joist-training-canvas.php` — guards `elementor_canvas` template availability for `createScratch()`.
5. **`elementor_canvas` template** availability (Elementor provides it; the mu-plugin is a belt-and-suspenders guard).
6. **WP auth** — mints an application password → prints `JOIST_AUTH_B64`.
7. **CSS-regen throttle** — `elementor_css_print_method=internal` (no per-post `.css` file regen — the dominant overload cost) + active breakpoints + a **single batched** `wp elementor flush_css` (never per-post in a loop). This is the host-side companion to the guard's `withRenderLock()` / `JOIST_RENDER_SERIAL=1`.
8. **Corpus seed pages** (optional, `--seed-corpus`) — fixed ids (3146 …) so `?page_id=` grade URLs match across instances.
9. **Verify** — Elementor==3.28.4, Joist active, `elementor/element/parse_css` hook registered (preserve channel live), canvas template present, mu-plugins loaded, `css_print_method=internal`, REST namespace resolvable.

---

## Smoke (after provisioning)

```bash
source /tmp/joist-auth.env                     # JOIST_BASE + JOIST_AUTH_B64
# structural smoke — capture→hybrid build→render, NO grade, fresh local pages only:
JOIST_RENDER_SERIAL=1 node eval/grader/build-hybrid-flow.mjs --source <url> --no-grade
# or the REST PUT path directly:
node eval/grader/transpile-html.mjs --html /path/page.html --create --base "$JOIST_BASE"
```
`JOIST_RENDER_SERIAL=1` serializes renders so parallel callers don't stampede the host with concurrent
CSS regen (the overload that paused sg-host).

---

## Reverting (reversible / documented)

- **mu-plugins:** delete `wp-content/mu-plugins/joist-training-fonts.php` and `joist-training-canvas.php`.
- **CSS-regen throttle:** `wp option update elementor_css_print_method external` (back to per-post files).
- **App password:** revoke the `joist-farm` label in *wp-admin → Users → Profile → Application Passwords*.
- **Preserve channel** (without removing the plugin): `define('JOIST_PRESERVE_CSS_DISABLE', true);` in `wp-config.php`.
- **Pro:** `wp plugin deactivate elementor-pro && wp plugin delete elementor-pro`.
- Local sandbox is fully disposable: `docker compose -f sandbox/docker-compose.yml down -v` wipes it.

---

## Honest caveats (need the actual instance to fully verify)

- **Elementor version tension.** This provisioner pins **3.28.4** because that is the channel the
  PreserveCSS Emitter was *proven* on (`Emitter.php` docblock: "PRESERVE 72 vs FLOW 8 on a clean local
  3.28.4 stack"). The *legacy* `sandbox/bootstrap.sh` pins **4.0.9** for **sg-host parity**, and
  `eval/grader/overnight-state.json` records that the full `build-flow`/`build-absolute` +
  `SchemaValidator` path was coupled to **4.0.9's exact control schema** and threw 422s on 3.x. So:
  the **preserve channel + canvas + auth + REST** are verified on 3.28.4 here; whether the *absolute/
  flow* builders' full widget set validates cleanly on 3.28.4 on YOUR instance must be re-smoked
  (`--no-grade` build) — if they 422, either bump `--elementor-version 4.0.9` or run the
  version-robustness fix the overnight notes call "path B". Pass `--elementor-version` to match
  whatever you standardize on.
- **Fonts.** Without `--fonts-dir`, `@font-face` rules 404 and headings fall back (probe reports
  `usingSuisse=false`) — no error, just lower font fidelity. The existing
  `joist-clerk-fonts.php` mu-plugin (clerk Suisse from `uploads/clerk-fonts`) is the proven one for the
  clerk corpus; `joist-training-fonts.php` is its generalized, JSON-parameterizable successor for the
  live instance (coexist; different `<style>` ids and font dirs).
- **App-password over plain HTTP.** WP only accepts application-password auth over plain HTTP when
  `WP_ENVIRONMENT_TYPE=local` (the Docker compose sets this). **Your sized instance must be HTTPS**, or
  REST arrives unauthenticated.
- **`import-id` corpus seeding** may be ignored on some hosts (object-cache / sequence quirks); the
  pipeline falls back to a name→ID registry. Re-verify `?page_id=` URLs resolve on your instance.
- **Remote file copy is manual by design** (see the SSH note above). The script provisions config via
  WP-CLI but won't `scp` plugin/mu-plugin files to a host you named without you doing it — re-run
  `--verify-only` after copying.
