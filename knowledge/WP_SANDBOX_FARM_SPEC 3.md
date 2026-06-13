# WP Sandbox Farm — Spec for Scaling Build+Grade Parallelism

**Status:** spec (2026-06-03). **Owner decision pending:** execute Phase 0?
**Goal:** remove the single-WordPress bottleneck so N flywheel tracks can build+grade *concurrently* instead of contending on one DB. This is the one lever that scales parallel learning past ~3 tracks.

---

## 1. Why this is needed (the bottleneck, precisely)

The flywheel's software parallelism is already solved: capture (local Playwright) and agents (workflows, 16-wide) scale freely. The **build+grade** stage does not — every builder writes Elementor data to **one** WordPress instance (`georges232.sg-host.com`) via the Joist REST API. Concurrent writes contend on one DB + PHP worker pool; the existing **CAS hash + 5×409-retry loop** exists precisely to survive this. Page-id partitioning avoids *clobbering content* but not *DB/worker contention*. Net ceiling: ~2–3 concurrent build+grade tracks.

**Fix:** a pool of K **independent, byte-identical** WordPress sandboxes. Each track leases one, builds+grades against it with zero cross-track contention. K tracks compound in parallel.

## 2. Key finding — the pipeline is already ~90% farm-ready

Grounded in the actual code (2026-06-03):

| Concern | Reality | Implication |
|---|---|---|
| WP base URL | **Already** `process.env.JOIST_BASE` (build-absolute.mjs:13, build-flow.mjs:30; default sg-host) | No builder refactor — set env per instance |
| Clone URL for grading | `grade-sections.mjs --clone "<full url>"` (passed in) | Already per-instance |
| Auth | `process.env.JOIST_AUTH_B64` (app-password, base64) | One per instance |
| Elementor Pro | **Not used** (0 references; video=html iframe, tabs=`role=` html) | No license cap → spin up freely |
| Plugin | local `plugin/` (joist.php + src/ + build/); REST `/wp-json/joist/v1/{pages,plans,preferences}` + `wp/v2/{pages,media,font-families}` | Provision via wp-cli plugin install from local dir |
| Existing container config | none | Greenfield docker-compose |

**Real code changes required (small):**
1. **Namespace the image cache per instance.** `/tmp/joist-imgcache.json` maps `source-url → WP-media-id`; media IDs differ per instance, so a shared cache would hand instance B instance A's media IDs. → key the cache file by instance (`/tmp/joist-imgcache-<idx>.json`) or by `JOIST_BASE`.
2. **`JOIST_BASE` in the orchestration wrappers** that still hardcode sg-host (clone.mjs:20, route-clone.mjs:18, refine.mjs:21, font-register.mjs:11, upload.mjs:9, capture-band.mjs:6, clone-v2.mjs:17). The two core builders already honor it; these wrappers should too if used in the farm.

Everything else (capture, grade, the CAS write loop, kept recipes) works unchanged against any `JOIST_BASE`.

## 3. Topology

A pool of **K local WordPress sandboxes** via Docker Compose. Local (not remote) because: capture+grade are local Playwright → `localhost` removes network latency and rate limits; free; full DB isolation.

```
sandbox-1: wp-1 (php-fpm+nginx) :8001  + db-1 (mariadb)  + volume wp1
sandbox-2: wp-2                  :8002  + db-2           + volume wp2
...
sandbox-K: wp-K                  :800K  + db-K           + volume wpK
```

Each WP = WordPress core + **Hello theme + Elementor (free)** + **Joist plugin** (from `./plugin`) + an admin user with an application password. Each is a *clone of the same image* so any recipe verified on one is valid on all.

## 4. Provisioning (docker-compose + bootstrap sketch)

`docker-compose.yml` (parametrized; one service pair per index, or a single templated service scaled):
```yaml
# sketch — per-instance pair
services:
  db-${I}:
    image: mariadb:11
    environment: { MYSQL_DATABASE: wp, MYSQL_ROOT_PASSWORD: root }
    volumes: [ "db${I}:/var/lib/mysql" ]
  wp-${I}:
    image: wordpress:php8.3-apache   # pin EXACT version for parity
    ports: [ "800${I}:80" ]
    environment:
      WORDPRESS_DB_HOST: db-${I}
      WORDPRESS_DB_NAME: wp
      WORDPRESS_CONFIG_EXTRA: |
        define('WP_HOME','http://localhost:800${I}');
        define('WP_SITEURL','http://localhost:800${I}');
    volumes:
      - "wp${I}:/var/www/html"
      - "./plugin:/var/www/html/wp-content/plugins/joist:ro"   # live plugin mount
volumes: { db${I}:, wp${I}: }
```

`bootstrap.sh <idx>` (idempotent, via `wp-cli` in the container):
```
wp core install --url=localhost:800$I --title="joist-sbx-$I" --admin_user=joist --admin_password=… --admin_email=…
wp rewrite structure '/?page_id=%post_id%'   # keep ?page_id= URLs the grader uses
wp theme install hello-elementor --activate
wp plugin install elementor --version=<PINNED> --activate    # pin for parity (V3-on-V4 shape)
wp plugin activate joist
APPPW=$(wp user application-password create joist farm --porcelain)
echo -n "joist:$APPPW" | base64    # -> JOIST_AUTH_B64 for this instance
wp elementor kit import ./seed/joist-kit.zip      # SAME kit on every instance (render parity)
# seed the 7 corpus pages with FIXED ids so grade URLs are stable across instances:
for p in 2986 2988 2990 3146 4296 4297 4771; do wp post create --post_type=page --post_status=publish --import-id=$p …; done
```
Snapshot after bootstrap (`docker commit` or a DB+uploads export) → **"reset instance N"** = restore snapshot when an experiment poisons a sandbox.

## 5. Parity requirements (CRITICAL — non-negotiable)

A recipe verified on instance 3 must be valid on instance 7, so all instances are **byte-identical** in the dimensions recipes depend on:

- **Single-site, NOT multisite.** The kept kses findings rely on the `unfiltered_html` cap that **admins bypass on single-site but NOT multisite** ([[failure_mode_constraints]]). Multisite would silently change what survives kses → invalidate every kses recipe.
- **Pinned WordPress + Elementor versions** (the V3-on-V4 production shape per [[v4_atomic_normalizations]]). Same on all instances.
- **Same theme (Hello) + same imported Kit** → identical theme CSS, so the r41/r44 color-override findings (theme `a{color}` beating wrapper color) reproduce identically.
- **Same Joist plugin build.**
- A `parity-check.mjs`: hash {wp version, elementor version, plugin git sha, theme version, kit id} across all instances; refuse to lease a divergent one.

## 6. Pool registry + lease scheduler

`eval/grader/sandbox-pool.json`:
```json
[ { "idx":1, "baseUrl":"http://localhost:8001", "authEnv":"/tmp/joist-auth-1.env",
    "corpusPages":{"tailwind":3146,"supabase":2986,...}, "status":"free" }, ... ]
```
`lease.mjs acquire` → atomically marks a `free` instance `leased` (file-lock / `O_EXCL` lockfile per instance), prints `JOIST_BASE` + auth path + corpus page map; `lease.mjs release <idx>` frees it. A track:
```
eval = $(node lease.mjs acquire)         # -> JOIST_BASE, JOIST_AUTH_B64, page ids
source $auth ; export JOIST_BASE
node build-absolute.mjs --layout … --page <leased corpus id>
node grade-sections.mjs --clone "$JOIST_BASE/?page_id=<id>" …
node lease.mjs release <idx>
```
The directed-fix / flow workflows change only by wrapping their build+grade in acquire/release (a few lines in the agent prompts). Stale-lease reaper (TTL) for crashed tracks.

## 7. Sizing & cost

- Local Docker; **~400–600 MB RAM per WP+DB pair**. K=6 ≈ 3–4 GB + the Playwright browsers. Free.
- Real ceiling = **CPU** (concurrent PHP-FPM + Playwright capture). Recommend `K = min(physicalCores/2, ramBudgetGB / 0.6)`; **start K=4**, measure, grow.
- Capture is *already* unbounded (local, not WP-bound) — only build+grade gain from the farm, but that is exactly the serialized stage.

## 8. Phased rollout

- **Phase 0 (prove parity):** stand up ONE Dockerized sandbox; clone+grade tailwind on it; confirm the composite matches the sg-host result within noise. Validates the image + bootstrap + that recipes reproduce locally. *(½ day)*
- **Phase 1 (pool):** scale to K=4 via compose; add `sandbox-pool.json` + `lease.mjs` + `parity-check.mjs`; namespace imgcache per instance. *(½ day)*
- **Phase 2 (wire the flywheel):** each parallel track (T1 directed-fix, T2 flow, future T3/T4) leases an instance. Heartbeat can now run **K directed-fix variants concurrently** (e.g. different fix directives) instead of one. *(½ day)*
- Keep `georges232.sg-host.com` as the **canonical "prod-like" confirm instance**: a recipe proven on the farm gets a final single-confirm on sg-host before it's fully trusted (guards against local-vs-hosted drift).

## 9. Risks / gotchas

- **imgcache cross-instance collision** (§2.1) — must namespace; otherwise wrong media IDs.
- **Corpus page-id seeding must be deterministic** (`--import-id`) so `?page_id=` grade URLs are identical across instances.
- **Parity drift** is the silent killer (§5) — a single divergent Elementor/kses config produces grades that don't transfer. The parity-check gate is mandatory.
- **Within-instance writes still serialize** via CAS (fine — that's one track's own builds).
- **sg-host vs local render drift** — fonts, https, caching plugins differ; hence the Phase-2 final-confirm on sg-host.
- **Capture determinism** is upstream of WP and unaffected — don't expect the farm to fix thin-capture (that's the perception/T3 track).

## 10. Bottom line

Because `JOIST_BASE` already exists and Pro isn't needed, this is **~1.5 engineering-days**, mostly Docker provisioning + a lease scheduler — *not* a pipeline rewrite. Payoff: build+grade parallelism goes from ~3 → K (start 4, scale with cores), so the recipe-compounding rate scales with the farm. Combined with the standing research (T5) + perception (T3) + grader (T4) tracks, this is what turns the serial flywheel into the parallel world-builder.

Related: [[clone_pipeline_architecture]] · [[failure_mode_constraints]] · [[v4_atomic_normalizations]] · CLONE_PIPELINE.md · OVERNIGHT_FLYWHEEL_PLAN.md §4b
