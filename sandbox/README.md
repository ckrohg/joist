# sandbox/ — LOCAL Docker WordPress + Elementor render environment

**Purpose:** a self-contained, reusable localhost endpoint that renders Elementor pages
from a JSON element tree — with **zero dependency on the shared host**
(`georges232.sg-host.com`). The product is editable Elementor, and
**Elementor-rendered pixels are the only fidelity metric**; this is where we generate them
locally. Local Elementor = independence from the fragile shared host.

> **HARD RULE:** never touch `georges232.sg-host.com`. Everything here is local Docker.

---

## TL;DR — the working render path

```bash
# 0. Docker Desktop must be running.
# 1. Bring the stack up (db + wp). First run pulls images (~1–2 min); reruns are instant.
cd sandbox && docker compose up -d db-1 wp-1

# 2. (first time only) provision WP core + Hello theme + Elementor + Joist + app-pw + seed pages
docker compose run --rm wpcli-1 /bootstrap.sh

# 3. Render an Elementor tree → localhost URL + screenshot:
node render.mjs --tree _smoke-tree.json --slug demo --shot /tmp/demo.png
```

The render endpoint is **http://localhost:8001/?page_id=<id>**.

### Verified end-to-end (the proof)

A tiny known page (flex container → `heading` + `button`) injected via `render.mjs`
renders **fully styled**:

| widget    | source setting        | computed at localhost          |
|-----------|-----------------------|--------------------------------|
| container | bg `#0B0B0C`          | `rgb(11, 11, 12)` ✓            |
| heading   | color `#C7F25B`, 48px | `rgb(199, 242, 91)`, `48px` ✓  |
| button    | bg `#C7F25B`, r=8px   | bg `rgb(199,242,91)`, `8px` ✓  |

9 `link[href*="elementor"]` stylesheets load → **Elementor's per-page CSS generation
works locally**. This is the whole point: we no longer need the shared host to see
Elementor pixels.

---

## Which write path works (and the fallback ladder)

The task asked for the Joist-plugin path first, then an Elementor-native fallback.
**Both work on this local WP**, but `render.mjs` deliberately uses the **most
self-contained** one:

1. **Joist plugin REST PUT** — `PUT /wp-json/joist/v1/pages/{id}` with app-password +
   hash-handshake. The plugin (`joist 0.10.15-alpha`) **activates cleanly on local WP**
   (WP 7.0, Elementor 3.28.4) and is what `eval/grader/build-absolute.mjs` uses for the
   real clone pipeline. Needs: running plugin, `joist_use_agent_api` cap, app password,
   409-retry hash handshake.

2. **Direct postmeta via wp-cli** ← **what `render.mjs` uses.** Writes `_elementor_data`
   straight into postmeta inside the `wpcli-1` container, sets
   `_elementor_edit_mode=builder` + `_wp_page_template=elementor_canvas`
   + `_elementor_template_type=wp-page` + `_elementor_version`, then runs
   **`wp elementor flush_css`** (Elementor's own CSS regen). **No app-password, no hash
   handshake, no Joist plugin required — only Elementor itself.** This is the canonical
   local-render primitive precisely because it has the fewest moving parts.

---

## `render.mjs` — the canonical local-render primitive

```js
import { render, injectTree, snapshot, BASE, PORT } from './render.mjs';

// full primitive: inject tree → flush CSS → screenshot + style-probe
const { pageId, url, screenshot, styled } = await render(tree, {
  slug:  'my-page',        // page slug (reused → idempotent update). OR:
  page:  3146,             // pin to a fixed page id (uses --import-id on create)
  title: 'My Page',
  shot:  '/tmp/out.png',   // screenshot path
  width: 1200,             // viewport width (default 1200)
  noShot: false,           // skip the screenshot (inject only)
});
```

- `tree` = the Elementor `_elementor_data` value: an **array** of top-level
  containers/sections (a single root node object is auto-wrapped).
- Returns `{ pageId, url, screenshot, styled }`. `styled` is the computed-style probe
  (`headingColor`, `buttonBg`, `containerBg`, `elementorCssLinks`, …) — use it to assert
  the render actually styled, not just that DOM nodes exist. `null` when `noShot`.
- `injectTree(tree, opts)` → `{pageId, url}` (no browser). `snapshot(url, opts)` →
  `{screenshot, styled}` (browser only). `render` = both.

**CLI:**
```bash
node render.mjs --tree path/to/tree.json [--slug s] [--page id] \
                [--shot out.png] [--width 1200] [--no-shot]
node render.mjs --tree -   < tree.json     # read tree from stdin
```

Env overrides: `JOIST_LOCAL_PORT` (default 8001), `JOIST_LOCAL_BASE`,
`JOIST_CLI_SERVICE` (default `wpcli-1`).

**Companion:** `../eval/grader/_render-shot.mjs` is the Playwright screenshot+probe
script. It lives in `eval/grader/` on purpose — that's where the shared `playwright`
install resolves from. `render.mjs` invokes it there.

---

## Setup gotchas (hard-won — do not relearn these)

1. **Elementor version matters for the V3 tree.** This instance runs **Elementor 3.28.4**
   (the V3 stable line) — V3 widget trees round-trip cleanly. The bootstrap script *pins*
   `4.0.9` for sg-host parity, but **on Elementor 4.1.1 a PUT returns 200 yet
   `_elementor_data` persists as `[]`** (the V3 tree is silently dropped → blank render).
   If you re-provision, keep Elementor on the 3.x / 4.0.x line for V3 authoring.

2. **`_elementor_edit_mode=builder` is mandatory.** Without it the front end renders the
   classic `post_content` fallback (usually blank), **not** the Elementor tree.

3. **`wp elementor flush_css` after every write.** Elementor caches per-page CSS; the
   front end is unstyled until you regenerate it. `render.mjs` always does this.

4. **Pretty permalinks** (`/%postname%/`) are required for the `/wp-json/` REST routes the
   Joist builder uses. `?page_id=<id>` URLs work regardless. `bootstrap.sh` sets them.

5. **Playwright resolution.** Node ESM resolves `playwright` from the *script file's*
   directory, not cwd — hence `_render-shot.mjs` lives in `eval/grader/` (which has the
   install), and a one-off `/tmp` screenshot script will fail with `ERR_MODULE_NOT_FOUND`.

6. **Passing big JSON to wp-cli.** Command-arg JSON is fragile (quotes/unicode). The
   helper writes the tree to a temp file and **bind-mounts it** into the container
   (`-v file:/tree.json:ro`), then `cat`s it. Don't inline large trees as shell args.

7. **`WP_ENVIRONMENT_TYPE=local`** (set in compose) lets WordPress accept Application-
   Password auth over plain HTTP — needed for the Joist REST path (#1) on localhost.

---

## Snapshot / reset the DB volume

The whole sandbox state lives in two named volumes: `joist-sandbox_db1`,
`joist-sandbox_wp1`.

**Snapshot the DB** (fast, captures all page/postmeta state):
```bash
docker compose exec -T db-1 mariadb-dump -uroot -proot wp > sandbox/snapshots/wp-$(date +%Y%m%d).sql
```

**Restore a DB snapshot:**
```bash
docker compose exec -T db-1 mariadb -uroot -proot wp < sandbox/snapshots/wp-YYYYMMDD.sql
docker compose run --rm -T wpcli-1 -c 'wp elementor flush_css; wp cache flush'
```

**Full reset (nuke everything, re-provision from scratch):**
```bash
docker compose down -v          # removes containers + BOTH volumes
docker compose up -d db-1 wp-1
docker compose run --rm wpcli-1 /bootstrap.sh
```

**Stop without losing state:** `docker compose stop` (volumes persist; `up -d` resumes).

---

## Files

| file                  | role                                                            |
|-----------------------|-----------------------------------------------------------------|
| `docker-compose.yml`  | `mariadb:11` + `wordpress:php8.3-apache` + `wordpress:cli` (8001)|
| `bootstrap.sh`        | one-shot provision: WP + Hello + Elementor + Joist + app-pw + seed|
| `render.mjs`          | **canonical local-render primitive** (tree JSON → URL + shot)   |
| `../eval/grader/_render-shot.mjs` | Playwright screenshot + computed-style probe        |
| `_smoke-tree.json`    | tiny known tree (container → heading + button) for the verify   |
| `run-phase0*.sh`      | (legacy) sg-host parity harness — not needed for local render   |
