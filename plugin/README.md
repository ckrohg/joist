# Joist plugin — v0.1 M0 spike

> ⚠️ This is the M0 proof-of-loop scaffold. **Do NOT install on production sites.** It implements a tiny subset of the full spec. v0.5 alpha lands in ~6 weeks with the full v1 surface.

## What M0 proves

> Claude (or curl) writes an Elementor page via REST → the human opens Elementor and edits any widget → the agent re-reads with the new content hash → no clobbering, no formatting break, no silent failure.

## What's implemented

- `GET /wp-json/joist/v1/site` — runtime introspection (WP/Elementor/Pro versions, registered widget count)
- `GET /wp-json/joist/v1/widgets` — list of installed widget types
- `GET /wp-json/joist/v1/pages/{id}` — read page + full Elementor tree + content hash
- `POST /wp-json/joist/v1/pages` — create page with Elementor data
- `POST /wp-json/joist/v1/pages/{id}/patch` — surgical updates (`update_settings` + `replace_element` only)

Each write:
1. Validates widget types against the live introspected catalog (constraint #1, partial — full schema validation in v0.5)
2. Optimistic-concurrency hash check on `expected_hash` if provided
3. Generates 8-hex IDs for any missing or `temp-*` placeholders (constraint #10)
4. Routes through `\Elementor\Plugin::$instance->documents->get($id)->save([...])` — Elementor's own write path
5. Returns the verified post-save element tree + new content hash (constraint #2)

## What's NOT in M0

Everything else in the spec (`/specs/PLUGIN_API.md` §1–§32). Most notably:
- PolicyGuard refuse-list (#18)
- Chained-singleton plan trigger (#19)
- HTTPS enforcement (#20) — set up your site to use HTTPS, but the plugin doesn't refuse plain HTTP yet
- SSRF defenses (#21)
- Custom locks table (#22) — no concurrent-edit locking in M0
- Custom revisions table (#3) — no atomic rollback yet
- Custom audit log with hash-chained tamper detection (#15, #30)
- Async-by-default I/O (#17) — CSS regen + cache flush still synchronous
- Container-mode matching (#23), responsive completeness (#24), dynamic tag validation (#25), global ref preference (#26), inner-flag inference (#27), deep ID regen on duplicate (#28), skin-aware schema (#29)
- Operating modes (observer/quiet/kill-switch/staging-mandatory)
- Custom `joist_agent` role (M0 uses `edit_pages` capability)
- Plan Mode
- Kit / Templates / Media / Menus / SEO / Plugins / Forms endpoints
- Fleet operations, client-facing reports
- Multisite

## Install (manual, for dev only)

```bash
# Symlink the plugin into a local WP install:
ln -s /Users/ckrohg/Documents/Claude/tenet-elementor/plugin \
      ~/Local\ Sites/your-site/app/public/wp-content/plugins/joist

# Activate:
wp --path=~/Local\ Sites/your-site/app/public plugin activate joist
```

Then create an Application Password for your admin user (WP Admin → Users → Profile → Application Passwords).

## Smoke test

See `tests/manual/smoke.sh` for copy-pasteable curl commands.

Quick version:

```bash
WP_URL="http://your-site.local"
USER="admin"
APP_PWD="xxxx xxxx xxxx xxxx xxxx xxxx"

# Health check
curl -u "$USER:$APP_PWD" "$WP_URL/wp-json/joist/v1/site" | jq .

# Create a page with a heading widget
curl -u "$USER:$APP_PWD" \
     -H "Content-Type: application/json" \
     -X POST "$WP_URL/wp-json/joist/v1/pages" \
     -d '{
       "title": "Joist test page",
       "status": "publish",
       "elements": [{
         "elType": "container",
         "settings": {"flex_direction": "column", "padding": {"unit":"px","top":"40"}},
         "elements": [{
           "elType": "widget",
           "widgetType": "heading",
           "settings": {"title": "Hello from Joist", "align": "center", "header_size": "h1"},
           "elements": []
         }]
       }]
     }'
```

Open the returned `edit_url` in your browser. Edit the heading text in the Elementor UI. Save. Re-fetch via `GET /pages/{id}` — verify the hash changed and the edit landed.

## Requirements

- WordPress 6.5+
- PHP 8.0+
- Elementor 3.18.0+ (3.21.0 is the tested target)

## License

GPL-2.0-or-later. See `/LICENSE` (TBD — repo currently doesn't ship a LICENSE file; add one for v0.5).

## Source of truth

Full API spec: `/specs/PLUGIN_API.md`
Architecture spec: `/specs/ARCHITECTURE.md`
Hardening notes (v1): `/specs/HARDENING_v1.md`
