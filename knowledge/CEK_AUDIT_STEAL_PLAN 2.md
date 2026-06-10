# CEK Audit — Steal Plan

@purpose Roadmap of concrete, evidence-grounded improvements to Joist distilled from auditing
[emersimeon/claude-elementor-kit](https://github.com/emersimeon/claude-elementor-kit) (2026-06-06). Each item
cites the file:line the audit verified, so it is traceable, not hand-waved.

## What the audit was

The kit is **not a cloner** — it is a `SKILL.md` + bash setup-wizard wrapping the third-party
`msrbuilds/elementor-mcp` (~75 granular tools), building from mockups with human review, and it
concedes it cannot do 1:1 ("Elementor's flexbox container model is the ceiling"). Joist is past it
on the core flywheel (autonomous capture→build→grade, absolute-positioning 1:1+editable). Value was
concentrated in ~7 places, verified by a 4-probe + adversarial-critic workflow against our tree.

**We are NOT behind on architecture. We ARE behind on: forms (total gap), surgical-edit
discoverability, packaging, whole-site templates, and responsive (the one place the kit's stay-in-flow
approach is genuinely not behind us).**

Status legend: ✅ done · 🔜 wave-1 (cheap, no deps) · ⏭ wave-2 (medium) · 🧱 wave-3 (large, milestone-gated) · 🚫 deliberately not doing

---

## ✅ DONE this session (Waves 1 + 3 + the two quick fixes)

Verification: all touched PHP files pass `php -l` (Docker php:8.2-cli); `SchemaValidator::checkEnableFlags`
passed a 13-case reflection logic test; all 6 `build-*.mjs` pass `node --check`. A Docker lint caught one
real parse error (raw apostrophe in `Tools.php:66`) → fixed. A 3-agent adversarial review + adjudicator
then found 1 HIGH + several real issues, all fixed + re-verified: **HeaderFooterFactory `_elementor_data`
now `wp_slash`-wrapped** (update_metadata's wp_unslash was corrupting nav-href JSON); MCP read tools
gated `edit_pages` not `read`; wizard HTML-challenge-before-header-stripping ordering; wizard backs up an
unparseable `.mcp.json` instead of clobbering (functionally tested); password `read -rs`; build-flow
`typoCss` emits `font-style`; docstring corrections; PatchEngine dead line removed.

Quick fixes:
- **Advertise hidden plan ops.** `joist_create_plan` docstring listed only 4 of the 8 ops `PlanExecutor`
  accepts (`PlanExecutor.php:140`). Added `move`/`duplicate`/`wrap`/`unwrap` with shapes + a nudge to
  prefer `duplicate` for repeated cards and `move` over delete+re-insert. `plugin/src/MCP/Tools.php`.
- **Fix bare flex key.** `build-hybrid.mjs` used `justify_content` (no `flex_` prefix → silently
  dropped). Now `flex_justify_content`. Swept all builders — only container instance.

Wave 1 (all done):
- **W1.1 Forms** ✅ — `shortcode` added to all 4 prompt allowlists + the MCP docstring; forms recipe in
  each build/clone prompt; `knowledge/FORMS_AUTHORING.md` (verified Fluent 6.x class map + kses guidance).
  Verified: shortcode survives kses (only bare `&` corrupts); no hard widget-type allowlist blocks it.
- **W1.2 find/get element** ✅ — `joist_find_element` + `joist_get_element` MCP tools + helpers in `Tools.php`.
- **W1.3 italic** ✅ — `typography_font_style` emitted in all 6 `nativeTypo`s; `build-hybrid` capture now
  carries `style:cs.fontStyle`. Additive (no non-italic regression).
- **W1.4 SchemaValidator enable-flags** ✅ — `checkEnableFlags` enforces typography/background/overlay/
  css_filters toggles; 13-case logic test green (catches traps, no false-positive on builder shapes).

Wave 3 (v1 — need live-WP/host validation):
- **W3.1 packaging wizard** ✅ v1 — `scripts/install/joist-connect.sh`: browser UA, HTTPS gate, auth-failure
  disambiguation (header-stripping vs disabled vs anti-bot vs DISALLOW_FILE_MODS), host playbook
  (WPE/SiteGround/Kinsta/Cloudways), app-password user-list fallback, MCP-route verify+recovery,
  `.mcp.json` merge-not-clobber. `bash -n` clean.
- **W3.2 HFE header/footer** ✅ v1 — `plugin/src/Plan/HeaderFooterFactory.php`: verified recipe
  (`elementor-hf` + `ehf_template_type` scalar + `basic-global` via `update_post_meta`). `php -l` clean.
  Follow-ups: route `_elementor_data` through DocumentWriter; expose via an MCP tool; live-validate.

Wave 2 (both wired):
- **W2.1 free-tier nav** ✅ — registered the `[joist_nav_menu menu="<slug>"]` shortcode (`Bootstrap::registerShortcodes`,
  wraps `wp_nav_menu` since core has none) + a reversible `JOIST_NAV_SHORTCODE=1` Path-C branch in `build-absolute`
  that emits a `shortcode` widget bound to the real per-page WP menu (single source of truth) instead of per-link
  text-editors. Default OFF preserves the tuned per-link fallback. `php -l` + `node --check` clean.
- **W2.2 id-map** ✅ — `build-absolute` post-PUT reads `GET /pages/{id}?include=elements`, walks the saved tree, and
  persists `authored _element_id → engine id` to `/tmp/joist-idmap-<pageId>.json`. Pure read-back + local file
  (never mutates the page, never fatal); substrate for surgical refine via `joist_find_element`/`update_settings`.
  Walk logic unit-tested.

Also captured the research wave into `knowledge/ELEMENTOR_FREE_TIER_LIMITS.md` (the critical
"page `custom_css` is itself Pro on free" finding + grid/nav/form Pro-gating + the kit's `[wp_nav_menu]`
error: core has no such shortcode).

---

## 🔜 Wave 1 — cheap, high-leverage, no dependencies

### W1.1 Forms: Fluent Forms shortcode path (BIGGEST functional gap) — size M
- **Why:** Joist authors **no forms and no shortcode widget at all**. Elementor's native Form widget is
  Pro-gated, so any cloned landing page with a contact/signup form yields a dead placeholder today.
- **Evidence:** `shortcode` absent from every allowlist — `PlanGenerator.php:312,352`,
  `CloneGenerator.php:494,566`, `Tools.php:66`. Hard gate is `SchemaValidator.validateWidget`
  (`SchemaValidator.php:44-49`) which passes any Elementor-registered slug, and `shortcode` IS a native
  Elementor widget — so enabling it is allowlist + recipe, not a new widget.
- **Approach:**
  1. Add `shortcode` to the four prompt allowlists above (+ the `Tools.php:66` docstring).
  2. Verify `joist_get_widget_schema('shortcode')` returns controls on a live site (introspectable).
  3. Encode the kit's verified free-tier recipe (kit `SKILL.md:261-294`) in a new
     `knowledge/FORMS_AUTHORING.md` and reference it from the generator prompts: detect a form region →
     emit `shortcode` widget with `[fluentform id="N"]` → scope a Fluent 6.x CSS block
     (`.fluentform_wrapper_<id>` + `--fluentform-*` CSS vars) into page `custom_css`.
  4. Flag honestly when no form plugin is wired ("visual only, doesn't capture submissions").
- **Acceptance:** a clone of a page with a contact form produces an editable `shortcode` widget bound to
  a real Fluent Forms form, themed to brand, passing `joist_validate_widget`.

### W1.2 `joist_find_element` + `joist_get_element` MCP primitives — size S/M
- **Why:** highest-value missing primitive for the **post-clone user-edit loop**. "Change the hero
  headline" on a 60–120-node page currently forces a full `joist_get_page_tree` dump + manual id-hunt.
- **Evidence:** no find route anywhere (`PatchEngine` has only a private `findElement(by-id)`). The
  single-element reader already exists at `ElementsController.php:19-22` (GET
  `/pages/{id}/elements/{eid}`) but is **not** registered as an MCP tool — `Tools.php` exposes only
  `get_page_tree` for reads.
- **Approach:**
  1. Add a find route to `ElementsController` (e.g. GET `/pages/{id}/elements?find=<text>&type=<slug>`)
     returning `[{element_id, widgetType, path, snippet}]` ranked by text-substring match.
  2. Register `joist_find_element` (locate by widgetType + text → ids+paths) and `joist_get_element`
     (~10-line wrap of the existing `ElementsController.get`, returns settings + current hash for CAS).
- **Acceptance:** an agent can locate + read one widget without dumping the whole tree; round-trips into
  a surgical `update_settings` op with the returned hash.

### W1.3 Stop dropping captured italic — size S
- **Why:** captured `fontStyle:italic` (`capture-layout.mjs:242`) is silently dropped, so italic source
  text loses emphasis. Latent fidelity bug.
- **Evidence:** builders never emit `typography_font_style`/`<em>` (0 hits). NOTE: the kit's
  `<em>`-in-title trick does **not** port — the native `heading` widget HTML-escapes `title`.
- **Approach:** emit `typography_font_style:'italic'` on whole-italic leaves; for partial emphasis,
  route that leaf to a `text-editor` widget with inline `<em>`. Touch `leafToWidget` / heading emitters
  across `build-structured.mjs`, `build-absolute.mjs`, `build-flow.mjs`, `build-hybrid.mjs`.
- **Acceptance:** an italic source headline renders italic in the clone.

### W1.4 SchemaValidator: enforce enable-flag dependencies — size M (structural, subsumes dormant traps)
- **Why:** the whole class of "silent-ignore" Elementor traps (the kit's hardest-won lessons) is
  invisible to our validator today, so correctness relies entirely on builder discipline. Turning them
  into validator errors catches them once, everywhere — and makes `joist_validate_widget` catch them
  pre-flight (the critic flagged it currently does NOT).
- **Evidence:** `SchemaValidator.php` checks key-existence + enums but no dependency flags. Builders
  handle the live cases correctly today (typography/background-type/padding — verified), but
  `css_filters_*` and `background_overlay_*` are dormant traps (0 hits = unexercised, not safe).
- **Approach:** add a dependency-flag rule set: if any `typography_*` set → require
  `typography_typography:'custom'`; any `background_*` (non-type) → require `background_background`; any
  `css_filters_*` → require `css_filters_css_filter:'custom'`; any `background_overlay_*` → require
  `background_overlay_background` first and `background_overlay_opacity` as `{unit:'px',size:0..1}`.
- **Acceptance:** `joist_validate_widget` returns a named error when a dependent key is set without its
  enable-flag; smoke-test covers all four families.

---

## ⏭ Wave 2 — medium, light dependencies

### W2.1 Free-tier nav = single-source-of-truth menu (NOT hardcoded links) — size S — ✅ WIRED
- **Why:** Path C (no-Pro) renders nav as per-link `<a>` text-editor widgets — nav lives in two places
  (WP menu + page), so edits don't propagate. The kit's principle (`SKILL.md:255`): never hardcode nav.
- **Evidence:** `build-structured.mjs` Path C + Pro gate at `:1165`; `build-absolute.mjs:1081`. We
  already create a real WP menu programmatically (kit can't), so the menu exists to point at.
- **CORRECTED by research:** core has **no `[wp_nav_menu]` shortcode** (it's a PHP template function) —
  the kit's suggestion doesn't work out of the box. Two valid free paths: (a) the **HFE `navigation-menu`
  widget** (free; `menu` setting takes the menu **slug**) when HFE is present; (b) register a server-side
  `[joist_nav_menu menu="<slug>"]` shortcode wrapping `wp_nav_menu(['menu'=>slug,'container'=>''])` and
  emit it via the now-whitelisted `shortcode` widget. (b) is HFE-independent and the more robust unlock.
- **Approach:** add the `[joist_nav_menu]` shortcode registration (PHP, ~15 lines) + in the builders'
  no-Pro nav branch emit a `shortcode` widget instead of per-link text editors.
- **Acceptance:** free-tier clone nav is editable from one place (the WP menu) and reflects edits.

### W2.2 Persist authored-id → engine-id map after PUT (refine-loop substrate) — size M — ✅ WIRED
- **Why:** our refine loop rebuilds the whole tree; a surgical second pass needs the stable engine id per
  authored element. We author deterministic `_element_id`s but never read back the engine-assigned ids.
- **Evidence:** authored ids at `build-structured.mjs:298,743,1001,1126`; only media IDs captured after
  PUT (`:97`); no id-map persisted.
- **Approach:** after PUT, call `get_page_tree`, build a map keyed by authored `_element_id`, persist
  alongside the clone artifact so refine/edit passes target `update_settings`/`move` surgically.
- **Acceptance:** refine pass can patch a single band without a full rebuild.

---

## 🧱 Wave 3 — large, milestone-gated

### W3.1 Packaging: one-command installer + onboarding wizard — size L — ✅ v1 SHIPPED (`scripts/install/joist-connect.sh`); harden against a live host before wp.org launch
- **Why:** Joist has **zero** user-facing onboarding (`cli/`, `mcp-server/` don't exist;
  `deploy-plugin.sh` is a dev-side rsync). This is the single biggest packaging lever and it's absent.
- **Evidence:** no `INSTALL.*`/setup wizard in repo; `plugin/README.md` is dev-only symlink install.
- **Steal wholesale from the kit's wizard** (`setup-elementor-mcp.sh`): app-password→user-list fallback
  on 401 (`:196-206`); install-then-**verify-activation**-took retry (`:250-330`); MCP-route verify +
  interactive recovery loop incl. permalink-flush hint (`:506-616`); `.mcp.json` merge-not-clobber
  (`:587-616`); Local MySQL-socket auto-discovery + bundled WP-CLI (`:460-486`); and **the
  non-browser-UA `/wp-json` 403 caveat** (`SKILL.md:430`) — this directly threatens Joist's
  MCP-over-App-Password runtime on Kinsta/SiteGround/Cloudways, our exact target hosts.
- **Acceptance:** a non-technical user runs one command and lands a working Joist+MCP wiring on Local or
  a live host, with self-serve recovery for the top failure modes.

### W3.2 Site-wide header/footer as `elementor-hf` template posts — size L — ✅ v1 factory SHIPPED (`HeaderFooterFactory.php`); wire to builders + live-validate for whole-site/multi-page
- **Why:** we bake chrome INTO each page; a multi-page clone duplicates chrome and edits don't
  propagate. Confirmed whole-site gap.
- **Evidence:** 0 hits for `elementor-hf`/`ehf_template_type` in builders; `elementor_header_footer` at
  `build-structured.mjs:1359` is only the page-template chrome toggle, not a HF template post.
- **Approach:** when building multi-page, author the header/footer once as `elementor-hf` posts
  (`ehf_template_type='type_header'`/`'type_footer'`, `display-on-canvas='yes'`) per kit
  `SKILL.md:240-259`; pages inherit them.
- **Acceptance:** a 3-page clone shares one editable header/footer; an edit to it shows on all pages.

---

## 🚫 Deliberately NOT doing (and why)

- **First-action "ask before building" menu** — correct for a *future interactive product mode*, wrong
  for the autonomous clone skill (would break the run-to-target loop). Layer it on the existing
  `approval_token` gate when/if the prompt-to-edit product ships, not now.
- **Per-element surgical refine loop for clone authoring** — our grader-directed keep-if-better whole
  rebuild is more powerful for 1:1 (can swap a band native↔raster by measurement). The surgical loop
  belongs to the separate post-clone user-edit story (served by W1.2/W2.2), not clone.
- **GitHub-zipball repack / flat-vs-nested params** — N/A: we ship a clean-slugged zip and author a
  uniformly-nested native tree; these are msrbuilds-MCP quirks we don't have.

## ⚠️ Honest caveat the audit underweighted — RESPONSIVE

"WE_AHEAD on fidelity" hides that we are **BEHIND on responsive**. Absolute positioning is
desktop-pixel-only (`build-absolute.mjs:4`); the kit's flexbox "ceiling" is also its responsive
*floor* — flow reflows for free. Until `abs-responsive-port` lands, a flow/hybrid fallback may beat abs
on mobile-critical sites. Keep that wave funded; do not let positioning bragging-rights mask the open tax.
