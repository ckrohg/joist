# Elementor Rendering Pipeline

How an Elementor element tree turns into a visible rendered page. Compact reference for understanding why a saved plan looks the way it does (or doesn't).

---

## The pipeline (V3 + V4 share most of this)

```
_elementor_data (postmeta JSON)
        │
        ▼
Document::save()           ──► triggers CSS regeneration hook
        │                              │
        ▼                              ▼
Atomic transformer        Elementor\Core\Files\CSS\Post
(V4: re-shape props to                  │
internal storage form)                  ▼
        │              Walk element tree → emit CSS rules
        ▼                              │
postmeta written                       ▼
                          Write to wp-content/uploads/elementor/css/post-{id}.css
                                       │
                                       ▼
                          (frontend) <link rel=stylesheet> in <head>
                                       │
                                       ▼
                          Browser renders
```

## Where the CSS actually lives

| File | What's in it | Generated when |
|---|---|---|
| `wp-content/uploads/elementor/css/post-{id}.css` | Per-page CSS — widget settings compiled to rules scoped to `.elementor-{id} .elementor-element-{el_id}` | On every `Document::save()` + on demand via `wp elementor regenerate-css {id}` |
| `wp-content/uploads/elementor/css/global.css` | Site-wide kit CSS — global colors, fonts, typography presets from the Elementor Kit | On Kit update |
| `wp-content/uploads/elementor/css/custom-frontend.css` | Custom CSS from theme + plugin overrides | On theme/plugin save |
| Theme's own `style.css` + theme-bundled scripts | Theme styles (JupiterX adds *significant* overrides; Hello is near-empty) | On theme activation |
| V4 atomic `styles` array (in postmeta) | Atomic-element specific styles synthesized from props | On every save; **Joist strips this on hash compare via `V4_AUTO_FIELDS`** |

## Cascade order on the frontend

1. WordPress core (`wp-includes/css/`)
2. Theme `style.css` + theme-enqueued sheets
3. Elementor frontend bundle (`elementor.min.css`, `frontend.min.css`)
4. Elementor global kit CSS
5. Per-post compiled CSS
6. Inline `custom_css` from widget settings (highest)

If a widget setting "doesn't show up" visually, suspect:
- The theme overriding it (JupiterX is the usual culprit — see CASE_STUDY for why we recommend Hello)
- A typo in the settings key (Elementor silently ignores unknown keys — they get stripped on save)
- The CSS regen failed (check `joist.atomic.css_regen_failed` log entries — Joist returns this as a warning, not an error)
- The widget setting genuinely doesn't render that property (see `ELEMENTOR_V3_WIDGET_REFERENCE.md` gotchas)

## Responsive breakpoints (V3)

| Tier | Max width | Settings suffix | Example |
|---|---|---|---|
| Desktop | (default) | (none) | `typography_font_size: 64` |
| Tablet | 1024px | `_tablet` | `typography_font_size_tablet: 48` |
| Mobile | 767px | `_mobile` | `typography_font_size_mobile: 36` |

Custom breakpoints (`mobile_extra`, `tablet_extra`, `laptop`, `widescreen`) exist but are off by default — enable via Elementor → Settings → Experiments → Additional Custom Breakpoints. Don't author for them unless the site has them enabled.

Settings WITHOUT a `_tablet` / `_mobile` variant are not responsive — they apply at all breakpoints. See the V3 widget reference for the per-widget list of which settings *do* take responsive variants.

## What triggers a CSS regen

- `Document::save()` (synchronous — happens during the save call)
- WP-CLI: `wp elementor regenerate-css [post-id]`
- Elementor admin → Tools → Regenerate CSS (site-wide)
- Theme switch (regenerates ALL post CSS)
- Plugin update (sometimes — Elementor's own updates trigger global regen)
- Joist's `AtomicDocumentWriter::regenCssVerified()` (called after every Joist write — fails-soft with a warning)

## Inspecting compiled CSS after a write

Two paths:

**A. SFTP read** (when you have file access):
```bash
sftp -i ~/.ssh/key deploy@site.com
> get /var/www/html/wp-content/uploads/elementor/css/post-155.css -
```

**B. Direct fetch** (the CSS file is publicly served at the same URL path):
```bash
curl -s https://site.com/wp-content/uploads/elementor/css/post-155.css
```

Either path lets you verify whether your settings actually produced the CSS you expected.

## V4 atomic specifics

V4's atomic transformer mutates the saved tree on every save:
- Adds `isInner`, `id`, `styles`, `interactions`, `editor_settings`, `version` (see `V4_ATOMIC_NORMALIZATIONS.md`)
- Re-shapes inline settings into the prop system (see `ELEMENTOR_V4_ATOMIC_AUTHORING.md`)
- Regenerates the `styles` array from Classes + Variables references

The `styles` array on atomic elements **is** the per-element CSS, expressed as structured prop values rather than CSS strings. Joist's V4_AUTO_FIELDS strips it on hash compare because it's regenerated on every save — the source of truth is the prop settings.

When authoring V4 atomic plans, **don't put styling in the `styles` array** — it'll be silently overwritten. Put it in:
- `settings.classes` for class references
- A separate Classes definition in the design system

## Performance notes

- A single post's CSS regen is fast (~50-200ms typical)
- Site-wide regen on a large site (1000+ pages) can take minutes — kicks off async
- Cache plugins (W3 Total Cache, WP Rocket, SiteGround Optimizer) cache the rendered HTML; need to flush after a save or the new CSS doesn't show
- Joist auto-flushes via `pending_verifications: ["css_regen", "cache_flush", "frontend_verify"]` (the executor returns these as a TODO list)

## What this means for authoring

1. Write your plan with full settings — `typography_*`, `background_*`, etc. (See V3 reference.)
2. After `joist_execute_plan` returns success, the per-post CSS regenerates synchronously.
3. If you suspect rendering is wrong, fetch the compiled CSS and verify it matches expectations.
4. If the CSS is right but the page still looks wrong, suspect theme overrides (JupiterX) or cache stale.
