# CONTAINER_INFERENCE_SPEC — build-flow.mjs

> Build spec for `eval/grader/build-flow.mjs` (+ optional `build-flow-*.mjs` helpers).
> A NATIVE Elementor V3 container/flex/grid builder that reconstructs the captured
> layout as a NESTED container tree instead of a flat absolute-pinned leaf list.
>
> **Reason for existing:** the ONE axis where flow can beat `build-absolute.mjs` is
> **responsiveness** (absolute is desktop-1440-pixel-locked, no reflow). Flow ALSO
> unlocks deeper per-element coverage (more leaves flow without collision). The price:
> flow cannot guarantee pixel-1:1 — it must instead keep `hRatio ≈ 1` and not regress
> color/typo/structural fidelity below absolute's bar.
>
> **HARD SAFETY (concurrent directed-fix round):** READ/RUN-only on
> `build-absolute.mjs`, `capture-layout.mjs`, `capture-ensemble.mjs`,
> `grade-sections.mjs`. ALL new code goes in `build-flow.mjs` (+ `build-flow-*.mjs`).
> Never use corpus page ids (2986/2988/2990/3146/4296/4297/4771) for output — create
> FRESH pages. `source /tmp/joist-auth.env` for WP auth; never print `JOIST_AUTH_B64`.
>
> Synthesized from 5 verified investigation streams + live reads of
> `build-absolute.mjs` (318L), `build-flextree.mjs`, `grade-sections.mjs`,
> `route-clone.mjs`, `clone.mjs` on 2026-06-03.

---

## (a) INPUT DATA CONTRACT

### Source of the layout JSON
- Consume the output of `capture-layout.mjs` **via `capture-ensemble.mjs`** (best-of-N
  passes by text-leaf count) — NOT a single `capture-layout` pass. Capture is
  non-deterministic on dynamic React sites (resend editability swung 0.39↔0.80;
  supabase editability swung 0.83). The ensemble picks the richest tree.
- CLI: `node build-flow.mjs --layout <layout.json> --page <freshId>`
  (mirror `build-absolute.mjs:12–15` arg parsing; exit 2 if `--layout`/`--page`/
  `JOIST_AUTH_B64` missing).

### Top-level object (`capture-layout.mjs:487`)
```
{
  url,            // re-capture target for any raster/perimeter operator
  title,
  pageBg,         // rgb of document.body — page root background fallback
  pageH,          // full scrollHeight px → root min_height
  vw,             // CAPTURE WIDTH = COORDINATE-SPACE BASIS, default 1440 (dpr 2)
  root,           // the NESTED box-tree (NOT a flat leaf list)
  fonts:[{family,weight,style}],
  fontFiles:[woff/woff2 urls],
  rasters:[{box,file}],       // WebGL/canvas regions (optional)
  stats:{ containers, leaves, maxDepth, capturedTexts, domVisibleTexts, coverage }
}
```

### Coordinate space (LOAD-BEARING)
- Every node has `box {x,y,w,h}` in **absolute PAGE pixels** (`y = getBoundingClientRect.top + scrollY`, `capture-layout.mjs:170`), rounded to ints, captured at width `vw` (default 1440).
- x/y are page-relative, NOT viewport-relative, NOT parent-relative.
- Flow inference works in **parent-relative** space: a child's flow position derives
  from its order + the parent's flex props, NOT its absolute box. But the OVERLAY
  escape hatch (below) reuses absolute offsets `child.x − parent.x`, `child.y − parent.y`.
- Boxes can be **negative or exceed `vw`** on overflow elements (resend list
  `x=-1934 w=6234` marquee; image `y=-22`). The builder must clamp/skip these in flow
  classification (do not let them poison gap/justify medians).

### Container node fields (`capture-layout.mjs:467/471`)
```
{ kind:'container', tag, box{x,y,w,h},
  layout:{ display, flexDirection, flexWrap, justify, align,
           gap(CSS string e.g.'12px'|'normal'),
           gridCols(grid-template-columns CSS string, ONLY on display:grid) },
  padding:[top,right,bottom,left],   // ARRAYS OF CSS STRINGS '0px','24px' — PARSE px yourself
  margin:[t,r,b,l],                  // same
  background:{color?|gradient?|image?}|null,
  bgSampled?,                        // pixel-sampled rgb (optional, box>=140x44)
  border, radius, boxShadow,         // raw CSS strings (radius can be '3.35544e+07px' = pill)
  position, children:[...] }
```

### Leaf taxonomy (11 kinds) — discriminator + fidelity fields
- `heading{level:1-6,text,typo,paint}` · `text{level:null,text,typo,paint}` ·
  `button{text,href,paint,typo,interactive,cfx}` ·
  `image{src,alt,objectFit,radius,boxShadow}` ·
  `svg{svg,raster?('SKIP'|/tmp path)}` · `video{provider,src,radius}` ·
  `code{text,typo,paint,bg}` · `list{ordered,items:[{text,href}]}` ·
  `tabs{items:[{title,content}]}` · `accordion{items:[{summary,open,content}]}` ·
  `mockup{box,bg,raster}`.
- `typo = {family(quotes stripped),size(int px),weight,style,lineHeight,letterSpacing,transform,align}`.
- `paint = {kind:'solid'|'gradient-text', value:rgb-or-gradient}`.

### Input gotchas the builder MUST handle
1. **Tree is hierarchical, NOT flat.** Consume `children[]` directly. Containment-from-rects is a FALLBACK only for the deep-subtree-flattened case (`capture-layout.mjs:463–467` flattens deep subtrees to ≤40 leaves) and for re-nesting the ~6% overlapping-sibling artifact.
2. **Containment is ~97%, not 100%.** Overflow/negative-margin/marquee children sit outside or far wider than the parent. Prefer explicit `children[]`; treat rect-containment as sanity check only.
3. **Pass-through wrappers are PRUNED** (`capture-layout.mjs:472–474`): a single-child container with no bg/border/radius/shadow and non-flex/grid layout is collapsed to its child. So a child's box may not sit literally inside the node it now sits under.
4. **`padding`/`margin`/`gap`/`radius`/`lineHeight`/`letterSpacing`/`boxShadow`/`border` are RAW CSS STRINGS** — parse px with the `px()` helper (`build-absolute.mjs:18`).
5. **Pill radius is a garbage huge value** (`'3.35544e+07px'`) — treat very-large radius as "fully rounded".
6. **Structural kinds (list/tabs/accordion/code/mockup) are ATOMIC** — internal text lives in `items`/`text`, NOT as child leaves. Special-case them or you MISS that content.
7. **`bgSampled`/`raster` added in a try/catch AFTER tree build** — treat as optional; `raster` may be the string `'SKIP'`.
8. **`stats.coverage` is the thin-capture signal** (resend 0.13 = heavy loss; supabase 1.08 / framer 0.96 = healthy). Read it, log a warning when < ~0.4, do not over-promise on thin captures.
9. **Coordinates are DESKTOP-1440-LOCKED.** No breakpoint data is emitted. Flow inference is what *adds* responsiveness on top — that is the payoff, but it must be A/B-verified at 768/390 (see §f).

---

## (b) INFERENCE ALGORITHM (implementable pseudocode)

Target: a nested `{elType:'container', settings, elements}` tree. Four phases —
**NORMALIZE → CLASSIFY → INFER props → OVERFLOW-FIX / OVERLAY escape**.

### Phase 1 — NORMALIZE / re-nest (`build-flow.mjs`)
```
function normalize(node):
  if node.kind != 'container': return node
  kids = node.children.filter(k => !isDropCaret(k))   // drop decorative SVG carets
  // isDropCaret: kind=='svg' && (raster=='SKIP' || max(w,h)<=22)

  // (a) DEDUPE overlapping sibling duplicates (~6%: <a> button + inner text span).
  //     56/924 supabase sibling pairs overlap >50% of the smaller box.
  for each pair (A,B) in kids where iouOfSmaller(A.box,B.box) > 0.8 AND sameText(A,B):
     keep the ACTIONABLE/outer node (button > text; container > leaf), drop the other
  // poisoned median-gap is the failure if you skip this.

  // (b) RE-NEST mis-emitted siblings: if container A.box fully contains sibling B
  //     (B inside A by > 0.9 area) AND A,B are siblings → move B under A.children.
  re-parent such B into A

  node.children = kids.map(normalize)   // recurse
  return node
```

### Phase 2 — CLASSIFY child layout per container
```
function classify(container):
  kids = container.children.filter(visible)   // box.w>=3 && box.h>=2, drop off-screen overflow (x<-200 or w>2*vw)
  if kids.length == 0: return {mode:'empty'}
  if kids.length == 1: return {mode:'column'}  // single child = trivial column

  // Y-BANDS: greedily group kids whose vertical centers overlap
  //   sameBand(a,b) iff |cyA - cyB| < 0.5 * min(a.h, b.h)
  sort kids by box.y then box.x
  bands = greedyGroup(kids, sameBand)   // each band sorted left→right by x

  trusted grid signal = (container.layout.display contains 'grid' AND layout.gridCols)

  if trustedGrid:                       // supabase #5 had real gridCols '82.3px x4'
     cols = parseGridColCount(layout.gridCols)
     return {mode:'grid', rows: bands.length, cols, uneven: parseGridTemplate(layout.gridCols)}

  if bands.length == 1 and bands[0].length >= 2 and xSpread > ySpread*1.5:
     return {mode:'row', kids: bands[0]}

  if all bands have exactly 1 kid:
     return {mode:'column', kids}

  if bands.length >= 2 and every band has M>=2 kids
        and columnStartsAlign(bands, tol=8px) and equalCounts(bands):
     return {mode:'grid', rows: bands.length, cols: M}

  // genuine z-overlap (NOT a dedup artifact): >50% area overlap among kids
  if anyGenuineOverlap(kids, areaFrac=0.5):
     return {mode:'overlay'}            // → escape hatch, Phase 4b

  return {mode:'column', bands}         // stacked bands = column structure
```

### Phase 3 — INFER flex props (the row/column case)
```
function inferFlexProps(container, cls):
  s = { content_width:'full', flex_direction: cls.mode=='row' ? 'row' : 'column' }

  // GAP — ALWAYS set explicitly (even 0). Elementor's default ~20px gap ballooned a
  // clone 1.96x too tall (build-flextree:214).
  g = pxParse(container.layout.gap)        // prefer captured CSS gap
  if g == null: g = median(interChildGapsAlongMainAxis(cls.kids))  // clamp >= 0
  s.flex_gap = { unit:'px', size: String(round(g)) }

  // JUSTIFY (main-axis): from leading/trailing space + inter-gap distribution
  //   small+equal inter gaps with large leading==trailing → 'center'
  //   ~0 leading, large trailing                          → 'flex-start'
  //   large equal inter gaps                              → 'space-between'
  //   map captured 'start'/'end' → 'flex-start'/'flex-end' (build-flextree jc():154)
  s.flex_justify_content = inferJustify(container, cls.kids)

  // ALIGN (cross-axis): share cross-start within 8px → 'flex-start';
  //   share cross-center → 'center'; span full cross → 'stretch'
  //   normal/default → 'stretch' (build-flextree ai():155)
  s.flex_align_items = inferAlign(container, cls.kids)

  // WRAP: from layout.flexWrap, OR if single-band total child width+gaps > container width
  s.flex_wrap = (container.layout.flexWrap=='wrap' || overflowsMainAxis(cls)) ? 'wrap' : 'nowrap'

  // PADDING — key is `padding` NOT `_padding` on containers. _padding is widget-only,
  // IGNORED on .e-con → default ~10px padding ballooned 3x (hRatio 3.04). Emit 0 when none.
  [pt,pr,pb,pl] = container.padding.map(pxParse)   // strings → px
  s.padding = { unit:'px', top:String(pt||0), right:String(pr||0), bottom:String(pb||0), left:String(pl||0), isLinked:false }

  // MARGIN — key is `_margin` (WITH underscore) on containers (round-tripped page 2852).
  if anyMargin(container.margin): s._margin = padShape(container.margin)

  // BACKGROUND — background_background:'classic' is the MANDATORY type switch.
  if bg.color:   s.background_background='classic'; s.background_color=bg.color
  if bg.image:   s.background_background='classic'; s.background_image={url:localSrc(bg.image)}; s.background_size='cover'; s.background_position='center center'
  if bg.gradient: rasterize-to-bg-image OR solid dominant-stop (gradientColor());  // gradients are NOT a reliable native container setting
  if container.radius: s.border_radius = radiusDim(container.radius)   // native, survives; pill→large value treated as fully-rounded

  // MIN-HEIGHT pin — bound flow drift: pin section bands to captured band height.
  if isSectionBand(container): s.min_height = { unit:'px', size: round(container.box.h) }
  return s
```

### Phase 4 — THE MULTI-COLUMN OVERFLOW FIX (what killed build-tree/flextree)
> **HARD CONSTRAINT (proven by 4 scratch experiments, build-flextree:240–242,
> probe page 317):** Elementor's `.e-con` forces flex-item CONTAINER children to
> `width:100%`. `_element_custom_width`, `_flex_size:custom`, `content_width`,
> `_flex_basis` ALL fail to size container children → a multi-column ROW OF
> CONTAINERS reproduced as flex collapses to a vertical stack → 2–8x height
> overflow (hRatio up to 8.14) → grader height penalty tanks the score. This is
> the exact wall that made absolute beat flow.

```
function emitRow(container, cls):
  containerKids = cls.kids.filter(k => k.kind=='container')
  leafKids      = cls.kids.filter(k => k.kind != 'container')

  // CASE A — row contains >=2 CONTAINER children (cards/columns):
  //   MUST become a NATIVE Elementor GRID container, NOT flex. (the only fix that works)
  if containerKids.length >= 2:
     return emitGrid(container, containerKids ∪ leafKids,
                     cols = clamp(containerKids.length, 2, 6))

  // CASE B — row of LEAF children only (nav links, button groups, inline text):
  //   stay flex-row. Leaves side-by-side fine (no .e-con width override on inline leaves).
  return emitFlexRow(container, cls)

function emitGrid(container, kids, cols):
  s = inferFlexProps(container, {mode:'row', kids})   // reuse padding/bg/margin/gap inference
  s.container_type = 'grid'
  s.grid_columns_grid = { unit:'fr', size: String(cols) }
  g = pxParse(container.layout.gap) ?? 16
  s.grid_gaps = { column:String(g), row:String(g), unit:'px', isLinked:true }
  // uneven columns → grid_template_columns from captured width ratios
  if widthsUneven(kids):
     fr = kids.map(k => round(k.box.w / minWidth))   // ratio of widths
     s.grid_template_columns = { unit:'custom', size:'', custom: fr.map(f=>f+'fr').join(' ') }
  delete s.flex_wrap; delete s.flex_direction        // grid container has neither
  return container(s, kids.map(buildNode))

function emitFlexRow(container, cls):
  s = inferFlexProps(container, cls)   // flex_direction:'row' already set
  return container(s, cls.kids.map(buildNode))
```

#### Phase 4 guard-rails (do NOT regress the way flextree did)
- **Do NOT gridify a 2-LEAF top row** — narrow inferred columns forced text-wrap →
  hRatio 2.87→8.14 WORSE (build-flextree:194–198, REVERTED). Gate grid strictly:
  **≥2 CONTAINER children** with comparable widths in a genuine horizontal arrangement,
  OR a trusted `display:grid`+`gridCols` source signal. Never gridify rows of leaves.
- **isGrid mapping bug to avoid:** a `display:grid` container reports
  `flexDirection:'row'` but FAILS the `/flex/.test(display)` test → was mapped to
  COLUMN → a 19-logo grid stacked into a 9088px section. Use
  `isRow = isGrid || (/row/.test(flexDirection) && /flex/.test(display))`
  (build-flextree:166) and route grid to a NATIVE grid container.
- **No global direction-flip heuristic.** Children-box-geometry direction inference
  RIPPLES unpredictably across color/overlap/geometry (flextree reverted it twice).
  Trust the captured `layout.display`/`flexDirection` first; geometry only confirms.
- **content_width stays 'full'** everywhere. `'inline'` regressed textColor 0.999→0.1
  and layout 1.0→0.6 (flextree REVERTED). Do not globally use inline.

#### Phase 4b — OVERLAY / absolute escape hatch
When `classify` returns `mode:'overlay'` (genuine z-stack: badge over image, text over
hero gradient — NOT a dedup artifact), do NOT force flow. Reuse `build-absolute.mjs`'s
proven absolute recipe **scoped to that subtree**:
```
function emitOverlay(container):
  s = inferFlexProps(container, {mode:'column'})
  s.position handled via children — the CONTAINER stays in flow (containers IGNORE
  _position:'absolute'), so set min_height to container.box.h and emit the OVERLAY
  CHILDREN as absolutely-positioned WIDGETS pinned to (child.x - container.x, child.y - container.y, w, h)
  using absPos() shape from build-absolute.mjs:64 (only WIDGETS honor absolute).
  // structural children (cards) that themselves overlap → keep nesting; leaf overlays → flatten to abs widgets
  return container({...s, min_height:{unit:'px',size:round(container.box.h)}}, [ ...absWidgets ])
```
This preserves exactly what absolute already does at 1:1 for the hard z-layered cases,
while the rest of the page stays responsive flow.

#### Leaf widgets inside flow (reuse build-absolute leaf logic WITHOUT absPos)
For every non-container leaf inside a flow/grid container, emit the SAME native widget
shapes `build-absolute.mjs:75–157` produces — heading / text-editor / button /
image / list / tabs / code / video — but **without** the `...P` (absPos) spread, since
the parent flex/grid now positions them. Keep all the kept-recipe fidelity (color
inline-stamp, nativeTypo, video iframe, list <ul>, tabs role=) verbatim (see §d).

---

## (c) OUTPUT — nested Elementor container tree + write path

### Root container (mirror build-absolute.mjs:334 / build-flextree.mjs:285)
```
root = { elType:'container',
  settings:{ content_width:'full', flex_direction:'column',
             flex_gap:{unit:'px',size:'0'},            // ALWAYS explicit 0
             min_height:{unit:'px',size:round(pageH)},
             padding:{unit:'px',top:'0',right:'0',bottom:'0',left:'0',isLinked:true},
             _padding:{unit:'px',top:'0',right:'0',bottom:'0',left:'0',isLinked:true}, // belt-and-suspenders
             ...(pageBg ? {background_background:'classic', background_color:pageBg} : {}) },
  elements:[ ...sectionContainers ] }
```

### Container settings vocabulary that SURVIVES Document::save + kses (verified pages 2551 & 2852)
- **flex:** `content_width`('full'), `flex_direction`('row'|'column'),
  `flex_wrap`('wrap'|'nowrap'), `flex_justify_content`(FLEX values: flex-start/flex-end/
  center/space-between/space-around/space-evenly), `flex_align_items`(flex-start/flex-end/
  center/stretch/baseline), `flex_gap`({unit:'px',size:STRING}).
- **box:** `padding`(NOT `_padding` — STRING values, the load-bearing key),
  `_margin`(WITH underscore, STRING values), `min_height`({unit:'px',size:NUMBER}),
  `border_radius`(radiusDim, STRING values isLinked:true).
- **bg:** `background_background:'classic'`(MANDATORY switch) + `background_color` OR
  `background_image{url}` + `background_size:'cover'` + `background_position`.
- **grid:** `container_type:'grid'` + `grid_columns_grid`({unit:'fr',size:STRING}) +
  `grid_gaps`({column,row,unit:'px',isLinked}) + `grid_template_columns`({unit:'custom',
  size:'',custom:'12fr 22fr'}). DELETE flex_wrap/flex_direction when grid.
- For COLUMN containers main-axis centering, the plain `justify_content:'center'` key is
  what Elementor uses (build-hybrid:67) — NOT interchangeable with `flex_justify_content`.

### Mixed string/number convention (copy helper shapes exactly — do not hand-roll)
- STRING `.size`: `flex_gap`, `padding`/`_margin` top/right/bottom/left, `grid_columns_grid`,
  `grid_gaps`. NUMBER `.size`: `min_height`, `_offset_x`/`_offset_y` (overlay widgets only).
- Helpers to copy: `dim()` ({unit:'px',size:String(round(n))}), `padDim()`/`radiusDim()`
  from build-flextree; `absPos()` from build-absolute.mjs:64 for overlay widgets.

### KSES-SAFE invariant (referenced throughout)
- Only `<style>` and `<script>` TAGS are stripped. `<div>/<a>/<nav>/<iframe>/<video>/
  <img>/<ul>/<li>/<pre>` tags + inline `style=` ATTRS + `role=`/`href=` attrs ALL SURVIVE.
- A bare `<svg>` IS stripped (use `<img>` probe child, never `<svg>`).
- **Container `_css_classes` does NOT reach the DOM on V4** (only WIDGET _css_classes
  render). Container `#id{...}` CSS injection is in a stripped `<style>` → no-op. So
  container styling MUST go through NATIVE settings only (the vocabulary above).
  Gradients/borders/shadows on containers via injected CSS are UNRELIABLE — gradients →
  rasterize to bg image; border_radius is the one native exception that survives.
- `page_settings.custom_css` survives kses and is the ONLY working @font-face channel.

### WP write path — REUSE build-absolute's proven CAS flow verbatim (build-absolute.mjs:336–346)
```
headers = { Authorization:'Basic '+b64, 'Content-Type':'application/json',
            'X-Joist-Session-Id':'flow-'+Date.now() }

// 1. font @font-face injection for actually-used registered fonts (build-absolute:339)
fontCss = [...usedFonts].flatMap(fam => REGFONTS[fam].map(f =>
   `@font-face{font-family:'${fam}';font-weight:${f.weight};font-style:${f.style||'normal'};font-display:swap;src:url('${f.url}') format('woff2')}`)).join('\n')
page_settings = fontCss ? { custom_css: fontCss } : {}

// 2. CAS loop — GET hash, PUT with expected_hash, retry up to 5x on 409
expected = (GET ${base}/wp-json/joist/v1/pages/${pageId}).elementor.hash
for a in 0..4:
   r = PUT ${base}/wp-json/joist/v1/pages/${pageId}
       body { expected_hash:expected, elements:[root], page_settings,
              title:'Flow native clone', intent:'native flex/grid container tree' }
   if r.status != 409 AND not /atomic_save_silent/ in body: break
   expected = JSON.parse(body).details.current_hash   // re-read each retry
   sleep(400)   // (flextree uses 1500 for the atomic-save transient — use 1500 if that error appears)

// 3. LOAD-BEARING: set edit_mode=builder or the frontend serves the post_content FALLBACK
POST ${base}/wp-json/wp/v2/pages/${pageId}  body { meta:{ _elementor_edit_mode:'builder' } }
```
- Endpoint is the **custom Joist REST route** `/wp-json/joist/v1/pages/{id}` (GET hash,
  PUT with `expected_hash` CAS) — **NOT** `wp/v2 _elementor_data` and **NOT** raw
  `Document::save`. (The PUT is what eventually calls `Document::save` server-side.)
- `base = JOIST_BASE || http://localhost:8001`; `b64 = JOIST_AUTH_B64`.

### Page CREATION (fresh pages only — never corpus ids)
- `build-flow.mjs` itself, like `build-absolute.mjs`, **requires `--page <freshId>` and
  PUTs to an existing page** (exit 2 if missing). It does NOT create pages internally.
- Fresh page creation happens UPSTREAM and supplies the id. Two supported paths:
  1. **MCP:** `joist_list_pages` to find/confirm an id, or create a blank page via the
     plans path (`joist_create_plan` insert-at-root → `joist_approve_plan` →
     `joist_execute_plan`) and pass the resulting page id.
  2. **A/B harness (§f):** the test driver creates two fresh blank pages (one for flow,
     one for absolute) via the same plans path and passes each id to the respective builder.
- **NEVER** reuse 2986/2988/2990/3146/4296/4297/4771 for output (directive).

---

## (d) KEPT-RECIPE FIDELITY TO REUSE (verbatim from build-absolute.mjs)

These are leaf-level, orthogonal to layout inference. Port them EXACTLY or the
per-element grader (`grade-sections.mjs`) regresses. Cite by build-absolute line.

| Recipe | build-absolute ref | grader gate (grade-sections.mjs) | How build-flow reuses it |
|---|---|---|---|
| **Color inline-stamp (r41)** | `textColor():49`, `colorCss():60`, `styleAttr():61`; applied in leaf emitters 147–156 | per-element COLOR (weight 0.35 of perElement; visual=0.5·SSIM+0.5·perElement, line 32/163) — grader re-reads each glyph's rendered `cs.color` via CIEDE2000 | Stamp `color:<captured>` INLINE on the glyph-painting element (`<a>/<div>/<li>/<pre>`/tab divs) — inline beats theme `a{color}`, kses-safe. Headings ALSO keep `title_color` + inline stamp. Identical inside flow widgets. |
| **Background color (r44) incl. PROBE CHILD** | `bgRectSolid():198`, `PROBE_IMG:299` | per-element COLOR + areaCoverage | A flow container with REAL text children does NOT need the probe child — its children survive `capture-layout:470` so the bg color-container is re-emitted naturally. **Only emit the opacity-0.06 8x8 `<img>` probe inside a SOLID-bg container that would otherwise be CHILDLESS** (rare in flow). Reuse `PROBE_IMG` selection logic (first WP-hosted non-data: uploaded url with an id). Set `background_background:'classic'`+`background_color` natively first. |
| **Gradient bg (r45)** | `bgRectGradient():228`, `gradientColor():161` | COLOR | Native container gradients are kses-fragile → emit the captured gradient VERBATIM as an inline-style bg on an absolute html WIDGET behind the section (z0), same as absolute, OR solid dominant-stop fallback. (Containers can't carry reliable gradient settings.) |
| **Video landing** | leaf emitter 98–114 | video gate **grade-sections.mjs:87** (`visN('video')` + `visN('iframe')` src matching `/youtube|vimeo|wistia|loom/`) | Emit ALWAYS-PRESENT `<iframe>`/`<video>` in an `html` widget (NOT native video widget — it lazy-loads, grader sees 0 iframes). youtube→`/embed/<id>`, vimeo→`player.vimeo.com/video/<id>`, hosted→`<video controls>`, wistia/loom→keep src. Inside flow: drop `...P`, wrap in sized `<div style="width:100%">`. |
| **Header nav-wrap** | `emitHeaderNav():262` | nav gate **grade-sections.mjs:92** (`visN('nav,[role=navigation]').length?1:0`, binary) | Flow may emit a real `<nav>` IF the top-band container is naturally a nav row of link leaves — wrap those `<a href>` items in ONE `<nav>` html widget. If flow doesn't produce a `<nav>`, additively emit the same single `<nav>` widget build-absolute does (ADDITIVE, binary gate, editability unaffected). |
| **Tabs role=** | leaf emitter 135–146 | tabs gate **grade-sections.mjs:90** (`visN('[role=tablist]')` OR `visN('[role=tab]').length>=2`) | Emit `html` widget with real `<div role=tablist>`/`<div role=tab>` + stacked `<div role=tabpanel>` (all panels RENDERED, not hidden). role= survives kses. Identical inside flow. |
| **List** | leaf emitter 120–124 | list gate **grade-sections.mjs:89** (`visN('ul,ol')` with ≥3 direct `<li>`, not in nav) | `text-editor` widget whose editor is a real `<ul>/<ol><li>`; single-link items keep `<a href>`. Identical. |
| **Code** | leaf emitter 84 | — | `<pre white-space:pre-wrap>` in html widget. |
| **Font register/reuse** | `nativeTypo():48`, `gFont():23`, `GOOGLE:22`, REGFONTS:25, custom_css inject:339 | per-element TYPO (weight 0.25) | `nativeTypo(n)` → `typography_*` settings; prefer registered family (`REGFONTS` from `/tmp/joist-fonts.json`, written by `font-register.mjs`), else `gFont()` Google-equivalent (auto-loads, no `<style>`), else Inter/Georgia/Roboto Mono fallback. Inject `@font-face` for used registered fonts via `page_settings.custom_css`. **Never** rely on a `<style>` @font-face (kses-stripped). |
| **stripEmoji** | `:19` | — | Avoid wp-smiley balloon on all text. |
| **Image upload + cache** | `uploadImage():43`, `localSrc()/localId():44–45`, `/tmp/joist-imgcache.json` | — | Reuse the shared cache so flow & absolute don't double-upload during A/B. |

> **NOTE on stale grader line refs:** build-absolute's INLINE COMMENTS cite
> grade-sections.mjs:57(video)/:60(tabs)/:62(nav) — those are STALE. The VERIFIED
> live lines are **:87 video, :89 list, :90 tabs, :92 nav** (confirmed this session).
> Gate LOGIC is unchanged; use the actual lines above.

---

## (e) EXPLICIT FIXES — why build-tree/build-flextree lost to absolute

The prior two flow generations plateaued at **corpus composite ~0.589** (absolute hit
0.705; supabase 0.878). Each failure mode and its fix in build-flow:

1. **THE WALL — flex-child width never compiles.** `width:%` / `_flex_basis` /
   `_flex_size:custom` / `_element_custom_width` / `content_width` ALL fail to size
   container children on Elementor 4.0.9 (`.e-con` forces width:100%; proven page 317 +
   4 scratch experiments build-flextree:240–242). Multi-column row → vertical stack →
   2–8x height → hRatio blows up (grader height penalty tanks it).
   **FIX (Phase 4 CASE A):** a row with ≥2 CONTAINER children becomes a **native
   `container_type:'grid'`** container (`grid_columns_grid` + `grid_gaps` +
   `grid_template_columns` for uneven). Grid does NOT depend on flex-child width. This is
   non-negotiable and is the precise reason absolute beat flow.
   - Optional lean: the v0.10.13 **FlexWidthFiller** plugin service auto-injects scoped
     `flex:0 0 calc(N% - 16px)` CSS when a parent is `flex_direction:row` with 2+ %-width
     children — but it is SERVER-SIDE (not in eval scripts) and has a KNOWN GAP (only fires
     on EXPLICIT `flex_direction:row`; a 2-child card with unset direction did NOT inject,
     C6 page 403). **Do not rely on it.** Use native grid. If you ever lean on it, set
     `flex_direction:'row'` EXPLICITLY on every %-width column parent.

2. **Height overflow from default container gap (~20px) → 1.96x too tall.**
   **FIX:** ALWAYS emit `flex_gap` explicitly (0 if none) on every container
   (Phase 3 + root). Same for `grid_gaps`.

3. **Height overflow from default container padding (~10px) → 3.04x too tall.**
   The control is `padding` NOT `_padding` (widget-only, IGNORED on .e-con).
   **FIX:** emit `padding` explicitly (0 when source has none) on every container; set
   BOTH `padding` and `_padding` to 0 on the root (belt-and-suspenders, build-absolute:334).

4. **Naive geometry-gridification of any 2-item row → hRatio 2.87→8.14 WORSE**
   (flextree:194–198, REVERTED). Narrow inferred columns forced heavy text-wrap.
   **FIX (Phase 4 gate):** gridify ONLY ≥2 CONTAINER children with comparable widths in a
   genuine horizontal arrangement, or a trusted `display:grid`+`gridCols` source signal.
   Never gridify rows of LEAF children.

5. **`content_width:'inline'` globally regressed textColor 0.999→0.1, layout 1.0→0.6**
   (flextree REVERTED). **FIX:** keep `content_width:'full'` everywhere.

6. **Global children-box direction-flip rippled into overlap/color regressions**
   (flextree reverted twice). **FIX:** trust captured `layout.display`/`flexDirection`;
   use geometry only to confirm, never a global flip. No global geometric direction guessing.

7. **isGrid→column misroute stacked a 19-logo grid into 9088px.**
   **FIX:** `isRow = isGrid || (/row/.test(flexDirection) && /flex/.test(display))`; route
   any grid to a native grid container.

8. **Container CSS / @font-face / `_css_classes` silently stripped or dropped.**
   **FIX:** all container styling via NATIVE settings only; fonts via Google-name
   `typography_font_family` (auto-load) or `page_settings.custom_css` @font-face — never a
   `<style>` tag, never container `_css_classes`.

9. **`_elementor_edit_mode` not set → frontend renders unstyled post_content fallback**
   (the prior "raster 1:1" was actually this fallback). **FIX:** POST
   `{meta:{_elementor_edit_mode:'builder'}}` after every PUT (build-absolute:345).

10. **min_height drift unbounded in flow.** **FIX:** pin each section band's `min_height`
    to its captured `box.h` (hybrid drift fix 0.606→0.894). Bounds flow height drift.

11. **Capture non-determinism on dynamic sites.** **FIX:** consume `capture-ensemble.mjs`
    (best-of-N), not a single capture pass.

---

## (f) A/B + RESPONSIVENESS TEST PLAN

### Objective function (verified grade-sections.mjs:32–34, 172)
```
composite        = 0.4·visualMean + 0.3·editabilityMean + 0.3·structuralFidelity
visual           = 0.5·SSIM + 0.5·perElement
perElement       = 0.35·color + 0.25·typo + 0.20·position + 0.20·text
atTarget (1:1)   = no sections failing AND structuralFidelity>=0.95 AND hRatio∈[hLo,hHi] (line 174)
hRatio           = cloneHeight / sourceHeight   (line 108) — the multi-column-overflow tell
```
`grade-structure.mjs` is the router's objective (0.5·visual + 0.5·editability +
height-overflow penalty). Use BOTH: `grade-sections.mjs` for per-element + hRatio
diagnosis, `grade-structure.mjs` for the head-to-head composite the router keeps.

### A/B harness (mirror route-clone.mjs structure)
1. **Fixed corpus** (NON-corpus output pages — create FRESH blank pages per run):
   supabase (the proof point, coverage 1.08), resend (thin React, coverage 0.13 → stress),
   framer (coverage 0.96), tailwind, vercel, linear, stripe (the headless-render outlier).
2. **Per site:** `capture-ensemble.mjs --source <url> --out layout-<name>.json`. Then run
   BOTH builders concurrently to two FRESH pages:
   - `build-flow.mjs --layout layout-<name>.json --page <freshFlowId>`
   - `build-absolute.mjs --layout layout-<name>.json --page <freshAbsId>` (baseline)
3. **Grade both** with `grade-structure.mjs --source <url> --clone ${base}/?page_id=<id>`.
   KEEP THE HIGHER composite (route-clone:56–58). Report per-site `flow vs absolute → WINNER`.
4. **Pass bar:** flow must (a) NOT regress mean composite below absolute's 0.705, AND
   (b) WIN on ≥1 site on the responsive axis (below). Track per-defect attribution
   (corpus-run.mjs ranked-defect style) to catch silent regressions like flextree's.
5. **Regression suite:** re-run after every change; flat-or-down = revert (the flywheel
   caught 4 non-improvements via this discipline).

### Responsiveness test (the ONLY axis flow can beat absolute — verify it pays off)
Capture is desktop-1440-locked, so the WIN must be PROVEN at narrower widths:
1. For each clone page, drive Playwright (`mcp__playwright__browser_resize` or a
   headless `screenshot-pair.mjs`-style script) to capture the LIVE clone at **768** and
   **390** widths.
2. **Reflow assertions** at 768/390:
   - No horizontal scrollbar (`document.documentElement.scrollWidth <= viewport.width + 2`).
   - Grid containers collapse columns gracefully (Elementor grid reflows; absolute pins do NOT).
   - No widget overflows the viewport right edge.
   - Text remains readable (no fixed px widths forcing 1440-wide rows).
3. **Compare:** screenshot the SAME pages built by `build-absolute.mjs` at 768/390 — they
   will show horizontal overflow / clipped pixel-pinned widgets (absolute's known
   trade-off). Flow PASSING reflow while absolute FAILS is the documented payoff.
4. **Guard:** if flow does NOT solve the width-compile wall (Phase 4 grid), it loses on
   visual 1:1 AND gains nothing on responsiveness — that combination = revert to absolute
   for that site (the router will pick absolute anyway).

### Self-consistency / honesty check
- Run the grader SELFTEST (grade-sections.mjs:196–200): source-vs-source composite must
  be ≥0.99 AND atTarget AND every per-element sub-score ≈1.0 — confirms the grader isn't
  drifting before trusting any flow-vs-absolute delta.
- On thin captures (`stats.coverage` < ~0.4, e.g. resend headless 0.13/0.06), LOG the
  warning and do not over-claim — the inference is only as good as the capture (a capture
  problem upstream of build-flow).
