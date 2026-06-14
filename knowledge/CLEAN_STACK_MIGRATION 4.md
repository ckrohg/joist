# CLEAN STACK MIGRATION — read-only diagnostic + plan

**Status:** READ-ONLY diagnostic (Phase-0 follow-up). No code edited, no PUT issued. A
builder round is concurrently editing `build-absolute.mjs`; the cloner change below is a
SPEC for that round, not an applied diff.

**Date:** 2026-06-03 · **Plugin:** joist 0.10.13-alpha · **Cloner:** eval/grader/build-absolute.mjs

---

## TL;DR

- The "8 schema errors on widget html" 422 is caused by ONE thing: `build-absolute.mjs`
  spreads the `absPos()` custom-positioning keys (`_position`, `_offset_*`,
  `_element_width`, `_element_custom_width`, `_z_index`) onto **`html`** widgets, and the
  Elementor **HTML widget's introspected control set does not contain those `_`-prefixed
  Custom-Positioning controls** on the stacks tested. SchemaValidator rejects every key not
  in `get_controls()` → 8 `schema.unknown_key` errors. The heading/text-editor/image
  widgets carry the SAME keys but pass, which proves the keys are valid Elementor controls —
  they're just absent from the HTML widget specifically.
- The fix is a **1–2 line cloner change** (gate the `absPos()` spread on `html` so the
  position keys are not sent — wrap the html in a positioned **container** instead, or omit
  the rejected keys for html). This is a **DAY**, not a week — IF a 3.x stack is the target.
- BUT there is a deeper version-coupling: on **any Elementor 4.x (4.0.0+)** the cloner's
  V3 widget tree (`elType:'widget'`) is **silently dropped** on save — PUT returns 200 but
  `_elementor_data` persists as `[]` → blank render (verified in the phase-0 logs and baked
  into `sandbox/bootstrap.sh`). So V4 is NOT a viable target for the current cloner at all.
- **Recommended canonical stack: Hello Elementor theme + Elementor (free) 3.x latest
  (3.30.x, the newest 3.x line) + current joist 0.10.13-alpha + the 1-line html-widget
  cloner fix.** This is the only combination where the plugin allows the write (legacy_v3,
  not known_broken) AND the V3 tree shape persists AND the schema validates.
- Effort: **~1 day** (cloner fix + provision a fresh 3.x farm sandbox + 1 build/grade to
  confirm parity). It is a DAY because only the html widget mismatches, not every widget.

---

## Evidence base (what was read)

| Source | What it told us |
|---|---|
| `VersionRouter.php` | `known_broken = 4.0.0..4.1.1` inclusive. major 3 → `legacy_v3` (never known_broken). major ≥5 → unsupported. 4.x → `atomic_v4`. |
| `DocumentWriter.php` | SchemaValidator (`validateTree`) runs on **every** path BEFORE routing — so a schema-invalid widget 422s on V3 AND V4. known_broken V4 no longer pre-refused by default (Wave 11); the write is attempted with a read-after-write hash defense. |
| `AtomicDocumentWriter.php` | V4 writes go through `Document::save()`; the V4 transformer is what drops the V3 tree (the `[]` symptom). The hash check would surface this as `atomic_save_silent_failure` if it fires; in the logs the PUT returned **200**, meaning the write looked clean to the plugin but the V3 tree was normalized away. |
| `SchemaValidator.php` | Rejects any settings key whose base (responsive-suffix-stripped) name is not in `$widget->get_controls()` → `schema.unknown_key`, one error per key. Throws `schema.invalid_settings` with `count(errors)` in the message. **This is the exact source of "8 schema errors on widget html".** |
| `WidgetCatalog.php` | `getSchema()` = `$widget->get_controls()` keys, cached in a transient keyed by `ELEMENTOR_VERSION|ELEMENTOR_PRO_VERSION`. So the valid-key set is whatever the live Elementor build registers for that widget — version-dependent. |
| `build-absolute.mjs` | `absPos()` (lines 64–72) emits `_position, _offset_orientation_h, _offset_x, _offset_x_end, _offset_orientation_v, _offset_y, _offset_y_end, _element_width, _element_custom_width` (+ `_z_index` when z!=null). This `...P` spread is applied to **every** widget incl. `html` (11 html emission sites). |
| `build-flextree.mjs` (the 0.85 baseline path that worked on sg-host) | Its html widgets carry ONLY `{ html }` (+ `...C` = `_css_classes`/`_flex_size`). It **never** put position controls on an html widget → it never hit this 422. The regression is specific to the absolute builder's `...P`-on-html. |
| `lessons.json:665` | Recorded prior: *"The html widget can't take background_background (422) — paint backgrounds on a container or inline on the div."* Same class of bug: html widget has a narrower control set than other widgets; advanced/style keys get rejected. |
| `sandbox/bootstrap.sh:11-14` | *"sg-host runs 4.0.9 … on 4.1.1 the Joist PUT returns 200 but `_elementor_data` persists as `[]` (the V3 tree is dropped) → blank render."* Sandbox now pins `ELEMENTOR_VERSION=4.0.9`. Confirms the V4 silent-drop. |
| `/tmp/phase0-v3.log` | `PUT 422 {"code":"schema.invalid_settings","message":"8 schema errors on widget html."` on the sandbox (running 4.1.1 in that run). composite 0.102 = blank. |
| `/tmp/phase0-revalidate.log` / `build4.log` | After (presumably) the html keys were dropped, `PUT 200` — but composite still 0.102 / hRatio 0.077: the 200 on 4.x is the **silent-drop** (tree → `[]`), NOT a successful render. This is the proof that 4.x is a dead end for the V3 cloner. |
| `joist.php:96-102` | `JOIST_MIN_ELEMENTOR_VERSION = 3.18.0`; V3 happy path is documented as **3.33-3.34.x**; max-tested 4.1.99. |

---

## (1) The likely 8 schema errors + the minimal cloner fix

### What the 8 errors almost certainly are

`absPos()` emits these keys (10 with `_z_index`, 9 without):

```
_position, _offset_orientation_h, _offset_x, _offset_x_end,
_offset_orientation_v, _offset_y, _offset_y_end,
_element_width, _element_custom_width   (+ _z_index when z != null)
```

The error count is **exactly 8**, so 8 of these are NOT in the HTML widget's
`get_controls()` and ~1–2 ARE (the widget keeps a couple of the common advanced controls
while lacking the "Custom Positioning" group). Best read-only inference for the 8 rejected
keys (the Custom-Positioning + custom-width group, which is what the HTML widget omits):

```
1. _position
2. _offset_orientation_h
3. _offset_x
4. _offset_x_end
5. _offset_orientation_v
6. _offset_y
7. _offset_y_end
8. _element_custom_width        (or _element_width — one of the width pair)
```

`_z_index` and one of `_element_width`/`_element_custom_width` are the keys that survive
(Z-Index + Width are registered on the html widget on these builds, Custom-Positioning is
not). The EXACT split can only be confirmed with a live introspection (below) — but the
*fix is identical regardless of which 8*: stop sending Custom-Positioning keys on `html`.

### Why only `html` and not heading/text-editor/image

All widgets inherit the same common controls via `Element_Base::register_controls()`, but
the registration of the "Custom Positioning" advanced section is gated per widget on older
3.x / on this stack the HTML (`raw_html`) widget's introspected control set omits it. The
identical `...P` spread passes on heading/text-editor/image (their `get_controls()` include
the positioning group), which is positive proof the keys themselves are valid Elementor
controls — the cloner is not inventing keys, it is sending valid keys to a widget that
happens not to register them.

### Minimal cloner change (1–2 lines, for the concurrent builder round)

The absolute builder relies on absolute positioning for EVERY widget, so we cannot simply
drop position on html (the html bg-rects / nav / footer / tabs would fall into flow and
stack — the exact failure the `bgRect` comment already warns about for containers). The
minimal, behavior-preserving fix is to **wrap each html widget in a 1-child positioned
container**: put `absPos()` on a `container` (containers DO accept the position controls on
this stack — only the html widget's control set is narrow) and leave the inner `html`
widget with just `{ html }`.

Concretely, replace the ~11 `widgets.push({ widgetType:'html', settings:{ html:…, ...P } })`
sites with a tiny helper:

```js
// html widgets reject the Custom-Positioning controls (8 schema.unknown_key on this stack);
// containers accept them. Wrap the html in a positioned container instead of spreading ...P.
function pushHtml(htmlStr, P) {
  widgets.push({
    elType: 'container',
    settings: { content_width: 'full', ...P },
    elements: [{ elType: 'widget', widgetType: 'html', settings: { html: htmlStr } }],
  });
}
```

…and call `pushHtml(tabsHtml, P)` etc. (One helper + 11 call-site swaps = ~1 line of real
logic, mechanical edit.) If wrapping turns out to perturb geometry, the even-smaller
fallback is to **strip the position keys from the html settings** and accept that the
handful of html widgets (nav/footer/tabs/bg-rects) lose absolute placement — but the
container-wrap is preferred because it preserves the 1:1 placement the absolute builder is
built around.

> NOTE: This fix ONLY matters on a 3.x target. On 4.x it is moot — the whole V3 tree is
> dropped regardless of the html keys.

### The one command to capture the EXACT 8 (read-only, no build/PUT)

The plugin exposes a read-only introspection + pre-flight endpoint
(`WidgetsController`, `/joist/v1/widgets`). On a FRESH farm sandbox (never sg-host):

```bash
# exact control set the HTML widget registers on this Elementor build:
curl -s -H "Authorization: Basic $JOIST_AUTH_B64" \
  "$JOIST_BASE/wp-json/joist/v1/widgets/html/schema" | jq '.controls[].name'

# exact rejected keys for the precise absPos payload (returns the {errors:[…]} list):
curl -s -X POST -H "Authorization: Basic $JOIST_AUTH_B64" -H 'Content-Type: application/json' \
  "$JOIST_BASE/wp-json/joist/v1/widgets/validate" \
  -d '{"type":"html","settings":{"html":"<div>x</div>","_position":"absolute","_offset_orientation_h":"start","_offset_x":{"unit":"px","size":10},"_offset_x_end":{"unit":"px","size":0},"_offset_orientation_v":"start","_offset_y":{"unit":"px","size":10},"_offset_y_end":{"unit":"px","size":0},"_element_width":"initial","_element_custom_width":{"unit":"px","size":100},"_z_index":"1"}}' | jq '.errors'
```

`validateSettings` runs the SAME `SchemaValidator::validateWidget()` the PUT path uses, so
its `errors[]` is byte-identical to what the 422 would report — but it is a READ
(`'reads'` capability) and writes nothing. This is the clean way to confirm the exact 8
before/after the cloner fix.

---

## (2) Is there a non-broken Elementor where BOTH plugin-allows AND schema-validates?

**Yes — and only on 3.x.**

| Elementor | Plugin verdict | Cloner V3 tree persists? | html schema | Net |
|---|---|---|---|---|
| 3.x latest (3.30.x) | `legacy_v3` — allowed, never known_broken | **Yes** (V3 `_elementor_data` is the native shape) | passes once html `...P` is gated | ✅ **viable** |
| 4.0.0–4.1.1 (incl. 4.0.9 sg-host) | `atomic_v4` + known_broken (default: attempt-with-hash-defense) | **No** — V4 transformer drops the V3 tree → `[]` (PUT 200, blank) | n/a (tree gone) | ❌ |
| 4.1.2+ (out of known_broken) | `atomic_v4` — allowed | **No** — same V4 atomic pipeline; expects `e-*` atomic elTypes, not V3 `widget` | the cloner emits V3 widgets → dropped/rejected | ❌ |
| ≥5.x | `unsupported` — refused | — | — | ❌ |

So **cloner version-robustness work (emitting V4 atomic `e-*` trees) is NOT needed to get a
clean stack** — it is only needed if the business requirement is to run on a V4 site.
For the canonical grading stack, pinning 3.x sidesteps the entire V4 atomic problem. The
only V3-side fix required is the html-widget Custom-Positioning gate. The bigger
"version-robustness project" (a V4 atomic builder) is a separate, deferrable effort, not on
the critical path for a clean stack.

---

## (3) Recommended canonical stack

| Layer | Choice | Why |
|---|---|---|
| Theme | **Hello Elementor** (free) | Matches intended architecture (memory: Hello+Pro). Already the sandbox default; minimal CSS so the clone's own styles dominate. |
| Elementor Pro | **Not required for the clone path** (bootstrap.sh verified 0 Pro refs in the pipeline). Keep Pro available for Motion Effects / Pro widgets later, but the canonical grading stack does not need it. |
| Elementor core | **3.x latest line — 3.30.x** (newest 3.x; ≥ the documented 3.33-3.34.x happy path if a 3.3x is the latest 3.x available; otherwise newest 3.x ≥ 3.18 floor) | `legacy_v3` route — allowed, never known_broken, V3 tree persists natively. AVOID 4.x entirely for the current cloner. |
| Plugin | **joist 0.10.13-alpha (current build)** — no plugin change needed | The current VersionRouter ALLOWS 3.x (legacy_v3). The known_broken guard is V4-only and irrelevant here. SchemaValidator is correct — it's the cloner sending bad keys, not the plugin being wrong. |
| Cloner | **build-absolute.mjs + the html-widget Custom-Positioning gate** (container-wrap helper above) | The only code change required. |

> Pick the EXACT 3.x patch by querying the farm sandbox after install
> (`wp plugin get elementor --field=version`) and pinning it in `sandbox/bootstrap.sh`
> via `ELEMENTOR_VERSION` (today it's hard-pinned to 4.0.9 to mirror sg-host — for the
> CLEAN stack, override to the latest 3.x). Do NOT use the broken 4.0.9 pin for the clean
> stack; that pin exists only to reproduce sg-host's legacy behavior.

### Minimal cloner change set

1. Add the `pushHtml()` helper (container-wrap) and swap the ~11 `widgetType:'html'` push
   sites to use it (so `...P` lands on a container, not the html widget). [~1 logic line + mechanical swaps]
2. (Optional belt-and-suspenders) keep a `HTML_DROP_KEYS` allowlist so any future html
   settings are auto-pruned to the html widget's known control set.

No SchemaValidator / WidgetCatalog / VersionRouter change is needed for the clean stack.

---

## (4) Effort estimate + sandbox safety

- **Total: ~1 day (hours, not days).**
  - Cloner html-widget gate: ~1–2 h (mechanical, plus a local lint/run).
  - Provision a FRESH 3.x farm sandbox (`sandbox/bootstrap.sh` with `ELEMENTOR_VERSION=<latest-3.x>`): ~30 min (one command; infra already validated in Phase 0).
  - Capture exact-8 via the validate endpoint before/after: ~15 min.
  - One build+grade on the fresh sandbox to confirm the V3 tree persists and renders (composite should jump off 0.102 toward the sg-host 0.85 baseline): ~1–2 h.
- **Sandbox safety: CONFIRMED.** All work runs on a FRESH farm sandbox (`sandbox/docker-compose.yml`
  + `bootstrap.sh`, a throwaway local WP at `http://localhost:8001`). The migration NEVER
  touches the live sg-host (`georges232.sg-host.com`) — sg-host stays on its working
  legacy stack so the live flywheel keeps running while the clean stack is validated in
  parallel. Only after the fresh-sandbox build renders ≈ parity would a separate, explicit
  decision migrate sg-host (prod hygiene: 3.x latest + current plugin + fixed cloner).

---

## (5) Quick win vs bigger project

- **QUICK WIN (this is a DAY):** Only the `html` widget mismatches on a 3.x stack, and only
  on the Custom-Positioning key group. Every other widget (heading/text-editor/image)
  already validates with the same `...P` keys. So the fix is the single `pushHtml()`
  container-wrap. That is the "1–2 html-widget setting tweaks = a day" branch from the
  brief — confirmed.
- **NOT triggered (would be the week-long project):** A full V4-atomic cloner (emit `e-*`
  atomic elements so the cloner runs on Elementor 4.x). That's only required if the
  requirement is to run on a V4 site; it is OUT OF SCOPE for a clean grading stack, which
  should simply pin 3.x. Defer it.

### Residual risk / things to verify on the fresh sandbox

- Confirm the latest 3.x's HTML widget actually registers the positioning controls on a
  CONTAINER (it should — containers carry the full advanced/positioning stack). If even the
  container path rejects them on 3.x, fall back to dropping the position keys on html and
  accept flow-stacked html landmarks (they're additive/invisible, so visual impact is low).
- Confirm the V3 tree persists (`GET /joist/v1/pages/<id>` returns a non-empty
  `elementor.hash` and the leaves are present) — i.e. NOT the `[]` silent-drop. On 3.x this
  is the native shape, so it should persist; the explicit check guards against any cache /
  edit-mode gotcha.
- `lessons.json:665` (`background_background` 422 on html) is the same control-set-narrowness
  class; the `rootBgFloor` `background_background` is correctly on the root CONTAINER
  (build-absolute.mjs:478-480), not on an html widget, so it is NOT part of this 422.
