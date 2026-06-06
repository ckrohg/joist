# Forms Authoring (Elementor + Joist)

@purpose How Joist authors working contact/signup forms on an Elementor site. Elementor's native Form
widget is **Pro**; raw `<input>`s are not authorable as native widgets. The free, round-trip-editable
path is the **native Shortcode widget** bound to a **Fluent Forms** form. Recipe + class map verified
against live plugin source 2026-06-06 (CEK build-research wave).

## The widget

The Elementor **Shortcode** widget is **free core** (`includes/widgets/shortcode.php`,
`get_name() === 'shortcode'`). Its single control key is also `shortcode` (a TEXTAREA). It renders
`do_shortcode( shortcode_unautop( $shortcode ) )` — so any registered plugin shortcode executes.

```json
{ "elType": "widget", "widgetType": "shortcode", "settings": { "shortcode": "[fluentform id=\"1\"]" } }
```

- **widgetType** and the **control key** are both literally `shortcode`.
- Embed shortcode is `[fluentform id="N"]` where N is the numeric form ID
  (WP Admin → Fluent Forms → All Forms → Shortcode/ID column).
- Keep `id="1"` as a placeholder when the real form ID isn't known yet; wire to the real form after.

## kses survival (REST / Application-Password saves) — VERIFIED

Shortcode strings **survive** `wp_kses_post`. kses only splits on HTML tags (`<…>`); `[`, `]`, `"` are
never delimiters, so `[fluentform id="1"]` passes intact. This is **categorically different from
`<style>`/`<script>` tags** (which kses strips). **Do NOT route shortcodes through the page `custom_css`
escape hatch** — they don't need it.

- The **only** kses corruption is a bare `&` → `&amp;` (Elementor #23302) on the non-`unfiltered_html`
  save path. `[fluentform id="N"]` has no `&`, so it's safe. If a shortcode attribute ever needs a `&`
  (a URL with query params), either grant the agent user `unfiltered_html` (Administrator/Editor on
  single-site short-circuits sanitization entirely) or encode `&` as `&#38;`.
- There is **no** `elementor/files/allow_unfiltered_html` filter — don't look for one. The gate is core
  `current_user_can('unfiltered_html')` inside Elementor's `sanitize_post_data()`.
- **Runtime self-test** (recommended on first connect): write a throwaway node with
  `[joist_probe x="1&2"]`, read it back; if `&` became `&amp;` you're on the kses path → sanitize bare
  `&` in authored shortcodes. Version-independent, beats inferring from role tables.

## Brand theming (Fluent Forms 6.x — verified class map)

Fluent Forms declares CSS custom properties on `:root`; **redefining them on the per-form wrapper
cascades over the defaults with no specificity fights** (~80% of the restyle). Inject this as a
page-level CSS block scoped to the form wrapper (on Pro sites via Elementor page `custom_css`; see
[[../knowledge/ELEMENTOR_FREE_TIER_LIMITS.md]] for the free-tier injection caveat — page custom_css is
itself Pro).

```css
.fluentform_wrapper_<id> {
  --fluentform-primary: <brand-accent>;     /* submit bg, input focus border, progress */
  --fluentform-secondary: <brand-text>;     /* input/help text color (NOT a 2nd accent) */
  --fluentform-border-color: <brand-border>;
  --fluentform-border-radius: <brand-radius>;
}
/* explicit overrides the variables don't fully cover (Form Styler can inline per-form rules that beat vars): */
.fluentform_wrapper_<id> .ff-el-form-control { background:<bg>; font-family:<font>; padding:14px 0; }
.fluentform_wrapper_<id> .ff-el-form-control:focus { border-color:<brand-accent>; box-shadow:none; }
.fluentform_wrapper_<id> .ff-el-input--label label { color:<label>; font-size:11px; letter-spacing:.2em; text-transform:uppercase; }
.fluentform_wrapper_<id> button.ff-btn.ff-btn-submit { background:<brand-accent>; color:#fff; }
.fluentform_wrapper_<id> button.ff-btn.ff-btn-submit:hover { background:<brand-accent-dark>; }
.fluentform_wrapper_<id> .ff-el-is-required label::after { color:<brand-accent>; }
```

Verified selector map (all current in Fluent Forms 6.x source):

| Element | Selector |
|---|---|
| Outer wrapper `<div>` | `.fluentform.ff-default.fluentform_wrapper_<id>` |
| `<form>` | `form.frm-fluent-form.fluent_form_<id>` |
| Field group | `.ff-el-group` |
| Label | `.ff-el-input--label label` |
| Input/textarea/select | `.ff-el-form-control` |
| Two-column row / cell | `.ff-t-container` / `.ff-t-cell` |
| Submit | `.ff_submit_btn_wrapper` → `button.ff-btn.ff-btn-submit` |
| Required marker | `.ff-el-is-required` (asterisk is `label::after`) |

> Caveat: Fluent's front-end CSS (incl. the `:root` variables) is enqueued only when a `[fluentform]`
> shortcode is present on the page. The native Shortcode widget renders the real shortcode, so the
> stylesheet loads. Include literal fallback values (not only `var(--…)`) in case of a non-native render path.

## What's wired where (this commit)

- `shortcode` added to the allowed-widget-slug lists in `PlanGenerator` (build + edit), `CloneGenerator`
  (URL + screenshot), and the `joist_create_plan` MCP docstring (`Tools.php`).
- Generators are instructed to detect a form region and emit a `shortcode` widget bound to
  `[fluentform id="1"]` rather than faking inputs with text-editor HTML.
- No hard server-side widget-type allowlist exists; `SchemaValidator` passes `shortcode` because it's a
  registered core widget.

## Still TODO (scoped in [[../knowledge/CEK_AUDIT_STEAL_PLAN.md]])

- Auto-create a Fluent Forms form (Contact template) via its API and substitute the real ID, so the
  placeholder becomes a live form end-to-end (today it lands as `id="1"`).
- Emit the brand CSS block automatically from the captured palette during a clone.
