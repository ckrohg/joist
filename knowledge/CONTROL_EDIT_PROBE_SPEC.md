# CONTROL-EDIT RENDER PROBE — spec (B1 round 1, design only)

@purpose Design spec for the control-edit render probe: the metric answering "does a panel edit
actually RENDER?" — pixel-level, on a crash-safe duplicate page. Distinct from
`joist_smoke_test_roundtrip`, which is DATA-level only (hash/settings round-trip; it cannot see
that an inline `style=""` on the inner `<a>`/`<div>` makes the setting inert — refine-clone.mjs:148-153).
Feeds `editability_quality`'s 0.30·control-edit term and the ≥90% hard gate (PATH_TO_TRUE_1TO1.md §2).

Status: SPEC ONLY — nothing built. Verified facts below were confirmed read-only on 2026-06-09/10.

---

## 0. Verified substrate facts this design rests on

| Fact | Evidence |
|---|---|
| CAS PUT flow: GET `joist/v1/pages/<id>` → `elementor.hash` → PUT `{expected_hash,...}`, on 409 re-read `details.current_hash`, ≤5 attempts | eval/grader/build-absolute.mjs:2632-2633 |
| id-map `_element_id → engine id` emitted at build time to `/tmp/joist-idmap-<page>.json` (read-back walk of `settings._element_id`) | build-absolute.mjs:2657-2668 |
| Widget emission: heading = native `heading` widget, NO inline style, `title_color` is the live lever | build-absolute.mjs:819-823 |
| button = `text-editor` whose `editor` root is an inline-styled `<a>`; generic text = `text-editor` with inline-styled `<div>` → widget-level `text_color`/typography settings are INERT (inline wins) | build-absolute.mjs:824-845; refine-clone.mjs:148-153 |
| form controls / recovered bands = `html` widgets (never panel-editable) | build-absolute.mjs:787-818 |
| `POST /joist/v1/pages` creates a page from a full `elements` tree + `page_settings`, sets `_elementor_edit_mode=builder`; supplied element ids are PRESERVED (only missing/`temp-` ids regenerated) | plugin/src/REST/PagesController.php:141-180 (meta at :156); plugin/src/Core/IdGenerator.php:61-64 (`fillMissing`) |
| `DELETE /joist/v1/pages/<id>?force=true` hard-deletes (`wp_delete_post(.., true)`) | PagesController.php:278-306 |
| `_elementor_page_settings` IS readable via core REST: `GET wp/v2/pages/<id>?context=edit` returns it as a structured object (verified live on 3146: `{custom_css: <20020 chars>}`; `template: elementor_canvas` also exposed) → faithful duplicate needs NO plugin change | live GET 2026-06-09 |
| CSS regen + cache flush run post-save (`Bootstrap::postSaveVerify` → `CSSRegenerator::regenerate` + `CacheFlusher::flushPage`) → a `title_color` edit reaches the rendered post CSS without manual busting | plugin/src/Bootstrap.php:229-242 |
| Probe the INNER render node, not the widget wrapper; rebuild/state isolation before probing | memory: clone_validation_pitfalls |
| Application passwords authenticate REST only, not the frontend → a `draft` scratch page cannot be screenshotted; scratch must be `publish` | WP core behavior |

---

## 1. Scratch strategy — DUPLICATE-PAGE lifecycle (chosen; CAS-revert rejected)

**Decision: duplicate-page.** CAS-revert mutates the graded page between two PUTs; no
verify step survives a SIGKILL inside that window, so "never a dirty graded page after any
crash" is unsatisfiable by construction. The duplicate makes graded-page corruption
*structurally impossible*: the graded page receives only GETs. Precedents pushing the same way:
the shared-scratch-page clobbering false-negative (clone_validation_pitfalls) and the 409
stale-hash CAS history. Cost is ~2 extra REST calls; render parity is not load-bearing anyway
(see caveat below).

Lifecycle (all writes target `dupId` only; hard guard asserts `dupId !== srcId &&
!CORPUS.has(dupId)` where `CORPUS = {3146,2986,2988,2990,4296,4297,4771,11067}` before EVERY write):

1. **SWEEP (pre-run):** `GET /joist/v1/pages?search=JOIST-PROBE-SCRATCH` → force-DELETE every
   page whose title matches `^JOIST-PROBE-SCRATCH ` and `modified` older than 60 min
   (`--sweep-all` ignores age). Removes any debris from prior crashes.
2. **READ source (GETs only):**
   - `GET joist/v1/pages/<src>?include=elements` → full tree + hash;
   - `GET wp/v2/pages/<src>?context=edit&_fields=meta,template` → `meta._elementor_page_settings`
     (incl. `custom_css` — REQUIRED for honesty: scoped `!important` rules like the fluid-font
     clamp can mask panel edits and MUST be present on the duplicate) + `template`.
3. **CREATE:** `POST joist/v1/pages` with
   `{title: "JOIST-PROBE-SCRATCH <srcId> <ISO-ts>", slug: "probe-scratch-<srcId>-<epoch>",
   status: "publish", elements: <copied tree>, page_settings: <copied settings>}` → `dupId`.
   (`publish` because app-password auth does not cover frontend rendering of drafts.)
4. **TEMPLATE:** `POST wp/v2/pages/<dupId>` `{template:'elementor_canvas',
   meta:{_wp_page_template:'elementor_canvas'}}` with the exact 400-fallback dance of
   build-absolute.mjs:2640-2654.
5. **REGISTER:** write `/tmp/joist-probe-active.json` `{dupId, srcId, ts}` BEFORE any probe write;
   delete the file after teardown succeeds (sweep + forensics anchor).
6. **PROBE** (§3-4). Exactly ONE batched CAS PUT on `dupId` (rail: one PUT at a time per page id).
7. **TEARDOWN (finally + SIGINT/SIGTERM trap):** `DELETE joist/v1/pages/<dupId>?force=true`;
   verify by re-GET (expect 404). On failure: leave active.json, exit non-zero — next sweep cleans.

**Crash invariant:** a crash at any point leaves either nothing or one inert published scratch
page that the next sweep deletes. The graded page is never written. This is strictly stronger
than CAS-revert-with-verify.

**Render-parity caveat (recorded, harmless):** the duplicate has a different post id → fresh
`post-<dupId>.css`; theme/kit CSS identical. The probe's baseline is the duplicate's OWN
before-screenshot, so only internal before/after consistency is load-bearing, not parity with
the graded page.

---

## 2. Denominator — SOURCE text runs; html/raster = FAIL, never "unsampled"

**Universe:** text leaves of the captured source layout (`/tmp/abs-cache/<slug>/layout.json`,
else `/tmp/clone-layout-<slug>.json`; slug rule = clone.mjs:26) with kind ∈
{heading, button, text} and non-empty `stripEmoji(text)` — the same admission filter as
build-absolute.mjs:819. `--layout <path>` overrides (used by the self-test fixture).

**Mapping cascade** (per run, against the DUPLICATE's live tree from `GET ?include=elements`):
1. **id-map:** `_element_id → engine id`. Element ids are preserved on create
   (IdGenerator.php:61-64) and `_element_id` is settings content, so the source's map transfers —
   but the probe RE-DERIVES the map from the duplicate read-back with the build-absolute.mjs:2663
   walk and uses ONLY the re-derived map (the `/tmp/joist-idmap-<srcId>.json` file may be stale or
   absent for corpus pages; keep it diagnostics-only).
2. **Text fallback:** normalized-text equality, then ≥4-char containment, tiebreak by center
   distance — reuse refine-clone.mjs `findWidget` (:126-146) verbatim.

**Classification (exhaustive — every run gets a bucket):**
- `mapped-panel` — widget is `heading` or `text-editor` → probe-eligible.
- `mapped-html` — widget is `html` (form recovery, raster band, mockup) → **FAIL_NOT_PANEL**.
  Counted in the denominator, never probed. This is the anti-gaming clause: rasterizing text can
  only LOWER the metric.
- `unmatched` — no widget carries the text → **FAIL_NOT_AUTHORED**.

**Strata** (within mapped-panel): `heading` (widgetType heading); `button` (text-editor whose
`editor` root tag is `<a>` — build-absolute.mjs:837); `text` (text-editor, root `<div>`/other — :845).

---

## 3. Per-probe edit + assertions

**Edit channel = COLOR** (the discriminating channel per refine-clone.mjs:148-153):
heading → `title_color`; text/button → `text_color`. v2 may add a typography_font_size channel
(catches `!important` clamp masking) — out of scope for round 1.

**Sentinel:** unique per probe, assigned by probe index from a fixed ordered palette of
max-saturation hues (`#FF00AA, #00FF11, #FF6600, #0033FF, #AA00FF, #00FFEE, #FFD400, #FF0044`,
then deterministic HSL steps). **Precondition:** the BEFORE screenshot must contain <5 px within
ΔE2000<12 of the probe's sentinel inside its box; else rotate to the next palette entry;
palette exhausted → `ERROR_SENTINEL`. Unique-per-probe also detects cross-widget leakage.

**Transport — ONE batched CAS PUT:** GET hash → set all sampled widgets' color settings in the
JS tree → PUT `{expected_hash,...}` with the :2632-2633 409-retry loop. Color edits never
reflow, so batching is render-safe; 1 PUT total satisfies the serialization rail and costs
2 screenshots instead of 2·n.

**Post-PUT data verify:** `GET ?include=elements` → each sampled widget's setting equals its
sentinel. Mismatch → `ERROR_WRITE` for that probe (that failure belongs to
`joist_smoke_test_roundtrip`'s data-level territory, not this metric).

**Render asserts** (screenshots via `node` + `timeout`, NEVER mcp__playwright; settleLazy +
injected `*{animation:none!important;transition:none!important;caret-color:transparent}` freeze
in BOTH shots; identical waits):
- **Boxes (AFTER page, DOM eval):** inner render node, not wrapper —
  heading: `[data-id="<eid>"] .elementor-heading-title`;
  text-editor: first element child of `[data-id="<eid>"] .elementor-widget-container`
  (the inline-styled `<div>`/`<a>`). Record `getComputedStyle(inner).color` for diagnosis
  (not gating — pixels gate).
- **TARGET CHANGED:** AFTER pixels inside the box (inset 1px) with ΔE2000<12 vs sentinel
  ≥ `max(20 px, 0.4% of box area)` (glyph coverage scale).
- **UNRELATED UNCHANGED:** BEFORE-vs-AFTER full-page diff at 1440; every pixel differing by
  >16/255 in any channel must fall inside `union(sampled inner boxes, padded 4px)`. Outside
  mass >0.05% of page pixels → `FAIL_SIDE_EFFECT` attributed to the nearest probe + run flag.
- **Layout stability:** `|beforeH − afterH| ≤ 2px`, else `ERROR_RENDER` (a color batch must not
  reflow; if it did, all pixel asserts are void).
- **390 assert (one per page):** designated probe = first heading-stratum probe in document
  order (fallback: first probe overall). One 390-width AFTER screenshot; recompute the box at
  390 via the same DOM eval. Element hidden at 390 by design (mobileAbsenceHide / mpbHide) →
  `SKIP_390_HIDDEN` (info, not FAIL). Visible but sentinel pixels < `max(10 px, 0.4% box)` →
  `FAIL_MOBILE_MASKED` (catches `!important` mobile custom_css masking — plan §6 row "round-trip /
  custom_css masks panel edits on mobile").

---

## 4. Sampling — stratified, deterministic, seed-free

- k = 6 per stratum (`PROBE_N_PER_STRATUM` env override), chosen **first-k by document order**
  (pre-order walk of the duplicate's elements tree). No RNG anywhere.
- Within a stratum, dedupe identical normalized text (keep first) so a repeated footer link
  cannot eat the stratum.
- Stratum has <k → take all. Total target 12-18, hard cap 20; if total mapped-panel <12 →
  take all mapped-panel.
- Runs that are mapped-panel but beyond first-k → `NOT_SAMPLED` (mapping stats only; excluded
  from probe rates).

---

## 5. Taxonomy + report JSON

Per-run statuses:

| Status | Meaning | In probe-rate denom? |
|---|---|---|
| `PASS` | data verify OK + target sentinel ≥ threshold + no attributed side-effect (+ 390 leg OK if designated) | yes |
| `FAIL_INERT` | data verify OK, sentinel pixels < threshold — setting is render-inert (THE indictment; expected today for text/button) | yes |
| `FAIL_MOBILE_MASKED` | desktop pass, 390 leg failed while element visible | yes |
| `FAIL_SIDE_EFFECT` | out-of-box diff mass attributed to this probe | yes |
| `FAIL_NOT_PANEL` | denominator-level: text run authored as html-widget/raster | mapping only |
| `FAIL_NOT_AUTHORED` | denominator-level: text run not present in any widget | mapping only |
| `NOT_SAMPLED` | mapped-panel, beyond first-k | mapping only |
| `SKIP_390_HIDDEN` | designated probe's 390 leg: element hidden by design | info |
| `ERROR_WRITE` / `ERROR_SENTINEL` / `ERROR_MAP_AMBIG` / `ERROR_RENDER` / `ERROR_INFRA` | probe could not be evaluated | excluded |

Run validity: probes with ERROR_* > 20% of sampled, or any lifecycle-level `ERROR_INFRA`
(create/template/teardown failure) → run `INVALID`, no metric emitted.

Metrics:
```
mapped_panel_rate     = mappedPanel / textRunsTotal
probe_pass_rate       = PASS / (PASS + FAIL_INERT + FAIL_MOBILE_MASKED + FAIL_SIDE_EFFECT)   [overall + per stratum]
control_edit_roundtrip = mapped_panel_rate × probe_pass_rate          ← the §2 0.30-weight term & ≥90% gate input
```

Report (`/tmp/probe-roundtrip-<srcId>.json` + stdout):
```json
{
  "version": 1,
  "src_page": 3146,
  "scratch_page": 0,
  "run": { "status": "VALID|INVALID", "started": "ISO", "ms": 0,
           "screenshots": { "before1440": "path", "after1440": "path", "after390": "path" } },
  "denominator": { "text_runs_total": 0, "mapped_panel": 0, "mapped_html": 0, "unmatched": 0,
                   "by_stratum": { "heading": 0, "text": 0, "button": 0 } },
  "sampling": { "k_per_stratum": 6, "sampled": 0,
                "by_stratum": { "heading": 0, "text": 0, "button": 0 } },
  "probes": [ { "run_text": "…", "stratum": "heading", "engine_id": "abc123",
                "element_id": "pb12-34-56-78|null", "map_via": "idmap|text|none",
                "setting": "title_color", "sentinel": "#FF00AA",
                "data_verified": true, "target_px": 0, "target_px_required": 20,
                "computed_color": "rgb(...)", "side_effect_px": 0,
                "designated_390": false, "status_390": "PASS|FAIL_MOBILE_MASKED|SKIP_390_HIDDEN|null",
                "status": "PASS" } ],
  "metrics": { "mapped_panel_rate": 0.0,
               "probe_pass_rate": { "overall": 0.0, "heading": 0.0, "text": 0.0, "button": 0.0 },
               "control_edit_roundtrip": 0.0 },
  "errors": []
}
```
The per-stratum split IS the deliverable headline (B1: "headings pass, text-editor/button inert
— that differentiated number is the indictment").

---

## 6. Self-test (synthetic page) + triple-test mapping

`eval/grader/_probe-roundtrip-selftest.mjs` (planned):
1. POST a 3-widget synthetic page (no custom_css, canvas template):
   - heading `{title:"PROBE SELFTEST HEADING", header_size:"h2"}` → expect **PASS**;
   - text-editor `{editor:'<div style="color:#111111">PROBE SELFTEST INLINE TEXT</div>'}` →
     expect **FAIL_INERT** (inline wins — refine-clone.mjs:149-153);
   - html widget containing `PROBE SELFTEST RASTER TEXT` → expect **FAIL_NOT_PANEL**.
2. Supply a 3-run fixture layout via `--layout` (no capture dependency).
3. Self-test passes iff statuses are exactly `[PASS, FAIL_INERT, FAIL_NOT_PANEL]`,
   `mapped_panel_rate == 2/3`, `probe_pass_rate == 0.5`, `control_edit_roundtrip == 1/3`,
   AND teardown verified (search returns 0 scratch pages).
4. Negative control: run once with the palette's first entry forced equal to the heading's
   actual color → assert the precondition rotates the sentinel (exercises `ERROR_SENTINEL` path).

Dim-shipping triple-test: (1) self-test = fixed-expectation source-vs-source; (2) injected
defect = the inline-styled editor (dim must move); (3) game-test = a build that paints
sentinel-colored pixels via a page-covering html overlay must NOT raise the dim — its text runs
classify `FAIL_NOT_PANEL`, and the overlay trips the side-effect assert.

---

## 7. Build plan (next round, not this one)

- `eval/grader/scratch-page.mjs` — shared duplicate-lifecycle helper (sweep/create/register/
  teardown); reused by C's `sectionVisual` per B1's "built ONCE here".
- `eval/grader/probe-roundtrip.mjs` — the probe
  (`node probe-roundtrip.mjs --page <srcId> [--layout <path>] [--sweep-all]`).
- `eval/grader/_probe-roundtrip-selftest.mjs` — §6.
- Env: `JOIST_AUTH_B64` (source /tmp/joist-auth.env; never print), `JOIST_BASE`,
  `PROBE_N_PER_STRATUM` (default 6), `PROBE_KEEP_SCRATCH=1` (debug only: skip teardown,
  sweep still removes it later).
- Cost/page ≈ 3 GETs + 2 POSTs + 1 CAS PUT + 1 read-back GET + 3 screenshots + 1 DELETE ≈ 2-3 min.

Expected baseline once built (prediction to falsify): heading stratum ≈ 1.0, text/button strata
≈ 0.0 (FAIL_INERT), mapped_panel_rate well under 1.0 on html-heavy pages → corpus
control_edit_roundtrip FAR below the 0.90 gate. That number unblocks C's de-inline pass.
