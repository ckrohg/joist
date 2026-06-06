# Structural Round Playbook — ready-to-apply specs for the corpus-gated evolve engine

This document front-loads the knowledge so each future `evolve.workflow.js` round — which auto-targets the single most-impactful structural miss (`evolve.workflow.js` L47-51: it aggregates `blockMisses` where `clone===0 && source>0`, ranks by total source-count, and emits `topClass = 'structural:' + structRanked[0][0]`) — can apply the correct **two-file change** (capture-layout.mjs detect + build-absolute.mjs emit) or, for a grader-blind block, the **three-file change** (+ grade-sections.mjs detector) in ONE shot. Each spec below mirrors the grader's exact detector gate and the `knowledge/ELEMENTOR_CAPABILITY_MATRIX.md` capability row the propose-prompt already tells the coder to read (`evolve.workflow.js` L57), so the round does not have to rediscover Elementor's limits, kses survival rules, or the symmetric-counting discipline that keeps the source-vs-source self-test at 1.0.

**The proven template is the round-3 `structural:list` recipe** (recipe-library.json entry `structural:list`): capture-layout.mjs `walk()` gained a `list` node-kind detector — placed after accordion, before generic recursion — matching the grader's exact gate (`<ul>/<ol>` with `>=3` DIRECT visible `<li>`, not in nav), emitting one `{kind:'list',tag,ordered,box,typo,items[{text,href}]}` node; build-absolute.mjs `leafWidget()` gained an `n.kind==='list'` branch emitting a native `text-editor` widget whose `editor` is a real `<ul>/<ol><li>…` (single-link items kept as `<a href>`), kses-safe, routing automatic via `flatten()`→`leafWidget()`. Result: **+0.042 corpus mean (0.559→0.601), self-test PASS, no per-site regression.** Every spec below is cut to this same shape: purely-additive, gate-mirroring, matrix-grounded, self-`return`ing branch.

How scoring rewards these (verbatim from `grade-sections.mjs` L119-126): `structuralFidelity = (sum over present source block-types of min(clone,source)/source) / types`, folded into `composite = 0.4·visual + 0.3·editability + 0.3·structuralFidelity` (L124), and `atTarget` (L126) additionally requires `structuralFidelity >= 0.95`. Recovering a block type from 0→matched moves that page's `structuralFidelity` by `1/types` and the composite by up to `0.3/types`, and can flip `atTarget`.

---

## Section A — Build-out blocks (grader already detects; builder must emit)

The grader already counts these block types in its `blocks` object (`grade-sections.mjs` L55-63): `form` (L54/56), `video` (L57), `table` (L58), `list` (L59 — DONE, round 3), `tabs` (L60), `accordion` (L61), `nav` (L62). For each remaining type the **detector is already live** — the only work is teaching capture-layout.mjs to emit the node kind and build-absolute.mjs to emit the matching Elementor widget. These are pure two-file rounds. Pasted below in order of expected impact.

### A1 — video

**Grader detector** (verbatim, `grade-sections.mjs:57`, inside the `blocks` object built from `visN = (sel) => [...document.querySelectorAll(sel)].filter(vis)`):
```js
video: visN('video').length + visN('iframe').filter((f) => /youtube|vimeo|wistia|loom/.test(f.src || '')).length,
```
So a source/clone is credited one video block per visible `<video>` element PLUS each visible `<iframe>` whose `src` matches `/youtube|vimeo|wistia|loom/`. `vis` requires non-zero box, not `display:none`/`visibility:hidden`, and `opacity >= 0.05`. The structural-miss penalty (`grade-sections.mjs:118`) fires when the source has this block but the clone rebuilt it as text/raster.

**Already built?** YES — both patches are already present in the working tree (the concurrent editor added them since this task was framed). This spec documents the existing, verified implementation so a coder agent can confirm or re-apply it identically; nothing new needs inventing.

**Capture patch** — `capture-layout.mjs`, inside `walk(el, depth)`. Insertion point is EARLY (lines 114–136), immediately after the `if (tag === 'img' || tag === 'svg') return leaf(el, cs);` line and before the `<pre>`/code-block detectors — NOT after the accordion block. This differs from the `list` template (which sits at line 230, after accordion at 199–223) for a load-bearing reason: a `<video>`/`<iframe>` is a single tag whose children (`<source>`/`<track>`, or nothing) carry no text, so the generic recursion at line 261 would return `null` and DROP it. It must be intercepted before any recursion can swallow it. Lists (`<ul>/<ol>`) can sit later because their `<li>` children survive recursion as text leaves; videos cannot. The verbatim existing block:
```js
if (tag === 'iframe') {
  const src = el.src || el.getAttribute('src') || ''; const box = rectOf(el);
  if (/youtube|youtu\.be|vimeo|wistia|loom/.test(src) && box.w >= 40 && box.h >= 30) {
    const provider = /vimeo/.test(src) ? 'vimeo' : (/wistia/.test(src) ? 'wistia' : (/loom/.test(src) ? 'loom' : 'youtube'));
    return { kind: 'video', provider, src, box, radius: nz(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : null };
  }
  return null; // non-media iframe → drop (matches grader's video gate; avoids leaking ad/tracking frames)
}
if (tag === 'video') {
  const box = rectOf(el); if (box.w < 40 || box.h < 30) return null;
  let src = el.currentSrc || el.src || el.getAttribute('src') || '';
  if (!src) { const s = el.querySelector('source'); if (s) src = s.src || s.getAttribute('src') || ''; }
  if (src && !src.startsWith('blob:')) return { kind: 'video', provider: 'hosted', src, box, radius: nz(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : null };
  return { kind: 'video', provider: 'hosted', src: '', box, radius: nz(cs.borderTopLeftRadius) ? cs.borderTopLeftRadius : null };
}
```
- Node kind: `'video'`. Fields: `provider` (`youtube`|`vimeo`|`wistia`|`loom`|`hosted`), `src` (string, may be `''`), `box`, `radius`.
- Gate-mirroring: the iframe `src` regex (`/youtube|youtu\.be|vimeo|wistia|loom/`) is a superset of the grader's `/youtube|vimeo|wistia|loom/` (adds `youtu\.be` short-links, which the grader's check on the resolved `f.src` still catches since Elementor re-renders to a full `youtube.com` embed). `<video>` is captured unconditionally (matching `visN('video').length`). The `box.w >= 40 && box.h >= 30` min-size guard prevents counting tracking-pixel iframes — slightly stricter than the grader, but only excludes elements `vis` would likely also count as too-small noise; symmetric for real videos. NOTE: `<video>` with a `blob:`/MSE src still emits a node (`src: ''`) so the structural type rebuilds — this is intentional and keeps clone count == source count for streamed players.

**Build patch** — `build-absolute.mjs`, inside `leafWidget(n)`. Branch sits at lines 74–92, after the `code` branch and before the `list` branch (routing is automatic: `flatten()` at line 133 sends every non-container leaf to `leafWidget`; `collectBg`/image-upload only descend into containers, so a top-level `video` leaf reaches here cleanly). Verbatim:
```js
if (n.kind === 'video') {
  const w = Math.round(box.w), h = Math.round(box.h);
  const ar = (h > 0 && w > 0) ? (w / h >= 1.55 ? '169' : (w / h >= 1.25 ? '43' : (w / h >= 0.9 ? '11' : '916'))) : '169';
  if (n.provider === 'youtube' && n.src) {
    widgets.push({ elType: 'widget', widgetType: 'video', settings: { video_type: 'youtube', youtube_url: n.src, aspect_ratio: ar, width: { unit: 'px', size: w }, ...P } });
  } else if (n.provider === 'vimeo' && n.src) {
    widgets.push({ elType: 'widget', widgetType: 'video', settings: { video_type: 'vimeo', vimeo_url: n.src, aspect_ratio: ar, width: { unit: 'px', size: w }, ...P } });
  } else if (n.provider === 'hosted' && n.src && /^https?:/.test(n.src)) {
    widgets.push({ elType: 'widget', widgetType: 'video', settings: { video_type: 'hosted', hosted_url: { url: n.src }, aspect_ratio: ar, width: { unit: 'px', size: w }, ...P } });
  } else {
    const inner = n.src
      ? `<iframe src="${esc(n.src)}" width="${w}" height="${h}" frameborder="0" allowfullscreen style="width:100%;height:100%;border:0"></iframe>`
      : `<video width="${w}" height="${h}" controls style="width:100%;height:100%"></video>`;
    widgets.push({ elType: 'widget', widgetType: 'html', settings: { html: `<div style="width:${w}px;height:${h}px">${inner}</div>`, ...P } });
  }
  return;
}
```
- elType/widgetType: `widget` / `video` (native Elementor Video widget) for youtube/vimeo/hosted; `widget` / `html` fallback for wistia/loom (no native type) and blob/unresolved hosted.
- Key settings: `video_type` ∈ `youtube`|`vimeo`|`hosted`; URL key is `youtube_url`/`vimeo_url` (bare string) or `hosted_url` ({url} object) — matching the matrix "video embed" row exactly. `aspect_ratio` is the dimensionless string Elementor expects (`169`/`43`/`11`/`916`), derived from captured box ratio. `width` pins desktop px; `...P` (= `absPos(box, z++)`) provides absolute x/y/w/h positioning consistent with all other leaves.
- kses note: the native Video widget stores `video_type`/`*_url` as widget SETTINGS (survive REST save — no HTML at all to strip). The html-widget fallback emits `<iframe>`/`<video>` tags + inline `style=""` attributes, both of which survive kses on this path (only `<style>` TAGS and `<script>` are stripped). Confirmed kses-safe. The fallback `<iframe src>` still carries the original wistia/loom URL so the grader's `/youtube|vimeo|wistia|loom/` src check still credits it.

**Gotchas**
- URL-key TYPE mismatch is the classic bug: `youtube_url`/`vimeo_url` are bare strings; `hosted_url` is a `{ url }` object. The code already gets this right — do not "normalize" them to one shape.
- The Video widget renders nothing if `*_url` is empty, so empty-src youtube/vimeo never reach the native branch (`&& n.src` guard) — they fall to the html fallback. Hosted requires `/^https?:/` (rejects relative/blob).
- Wistia/Loom have NO native Elementor video_type → must use the html-iframe fallback, never the native widget (would silently render blank).
- `box.w < 40 || box.h < 30` capture guard means tiny tracking iframes are dropped on BOTH source and clone capture — keep grader and capture symmetric; do not loosen one side.
- `youtu.be` short-links: capture regex catches them; Elementor's Video widget resolves them to a full `youtube.com/embed` iframe, so the grader's resolved-`src` check still passes.
- Aspect ratio is approximated to Elementor's 4 discrete buckets; off-ratio source videos get the nearest bucket plus the `width` px pin — fine for absolute mode (desktop-pixel), but the iframe won't letterbox-match a truly oddball ratio.

**Ceiling** — native `video` widget, **~98%** per matrix row (youtube/vimeo/hosted). Wistia/loom html-iframe fallback ~90% (functional embed, just not panel-editable as a Video widget). Blob/MSE-streamed players (no resolvable URL) drop to the empty-`<video>` shell ~50% visual but still satisfy the structural gate. No Pro requirement, no custom_css, no raster needed for the common case. V3 `video` widget; renders identically on V4 (per memory, V3 widgets round-trip on V4.0.x).

**Expected impact** — The corpus carries 25 source videos that previously rebuilt as ZERO widgets (each a structural miss tanking `structuralFidelity`, which is 0.3 of composite). Closing those 25 misses lifts `structuralFidelity` materially on video-bearing pages and, for native youtube/vimeo/hosted, adds full editability with no visual cost (the native widget renders the real iframe/video the grader counts). Largest gains on landing pages with hero/demo videos.

**Regression risk** — LOW. (1) Both detectors `return` on a matched tag before generic recursion, so no other node kind's path changes. (2) The iframe branch now `return null` for non-media iframes — previously these fell through to generic recursion which also returned null for childless iframes, so behavior is unchanged for ad/tracking frames (and it now explicitly avoids leaking them). (3) The native Video widget and html-iframe are both kses-safe, so no save-time stripping surprises. (4) Watch: the iframe branch runs for ALL iframes now — confirm no legitimately-cloned non-media iframe (e.g. an embedded form or codepen) was previously surviving via some other path; current code drops all non-`/youtube|vimeo|wistia|loom/` iframes, which matches the grader's gate (those weren't credited anyway, so dropping them is symmetric, not a loss). (5) The `box.w >= 40 && box.h >= 30` guard is slightly stricter than the grader's pure `vis` check — verify no real but small inline video player (<40×30) exists in the corpus.

Files: `/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/grade-sections.mjs` (detector L57), `/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/capture-layout.mjs` (capture L114–136), `/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/build-absolute.mjs` (build L74–92), `/Users/ckrohg/Documents/Claude/tenet-elementor/knowledge/ELEMENTOR_CAPABILITY_MATRIX.md` (video embed row L90).

### A2 — table

**Grader detector** (verbatim) — `grade-sections.mjs:58`, inside the in-page `capture()` evaluate (`visN` is defined at L53 as `const visN = (sel) => [...document.querySelectorAll(sel)].filter(vis);`):
```js
table: visN('table').filter((t) => t.querySelectorAll('tr').length >= 2).length,
```
So the gate is: visible `<table>` elements that contain `>= 2` `<tr>` descendants (any depth — `querySelectorAll('tr')`, not `:scope > tr`). Structural credit is `min(clone,source)/source` per block type (`grade-sections.mjs:121`). A `<table>` rebuilt as loose text/divs → `cB.table = 0` → structural miss → fails `structuralFidelity >= 0.95` → `atTarget=false`.

**Already built?** **No.** `build-absolute.mjs` `leafWidget()` has branches for `image`, `svg/mockup`, `code`, `video`, `list`, `heading`, `button`, and a generic text-editor fallback — there is no `n.kind === 'table'` branch. And `capture-layout.mjs` `walk()` has no `table` detector, so a `<table>` currently falls through to generic recursion: it recurses into `<tr>/<td>` and emits per-cell text-editor leaves (or gets flattened), so the clone DOM contains zero `<table>` elements. Confirmed structural miss.

**Capture patch** — `capture-layout.mjs`, in `walk(el, depth)`. Insert the new node kind **immediately after the LIST block (after line 242, the closing `}` of the `if ((tag === 'ul' || tag === 'ol') …)` block) and before line 243** (`const kidEls = …`, the start of generic recursion) — exactly the slot the `list` detector occupies relative to the accordion block above it. Node kind `table`; gate mirrors the grader (`tagName==='TABLE'` + `>= 2` `<tr>` at any depth + `visible`):
```js
// TABLE (>=2 rows): a real data table = a <table> with >=2 <tr> (matches grade-sections.mjs:58 exactly:
// visN('table').filter(t => t.querySelectorAll('tr').length >= 2)). The generic walk recurses into <tr>/<td>
// → per-cell text leaves (or flatten) so the clone DOM had ZERO <table> elements → structural miss. Capture
// the whole table as ONE 'table' node carrying its row/cell text grid + which row is the header (<thead>/<th>),
// so the builder re-emits a real <table><tr><td> in a text-editor widget (table tags survive kses). Gate on
// rows>=2 (NOT :scope — querySelectorAll, same as the grader) so source-vs-clone counting stays symmetric.
if (tag === 'table' && el.querySelectorAll('tr').length >= 2) {
  const trs = [...el.querySelectorAll('tr')].filter(visible);
  const rows = trs.map((tr) => {
    const cells = [...tr.children].filter((c) => /^(td|th)$/i.test(c.tagName) && visible(c));
    return {
      header: cells.length > 0 && cells.every((c) => c.tagName === 'TH'),
      cells: cells.map((c) => ({ text: clean(c.innerText || c.textContent).slice(0, 240), th: c.tagName === 'TH' })),
    };
  }).filter((r) => r.cells.length);
  if (rows.length >= 2) return { kind: 'table', box: rectOf(el), typo: typo(cs), rows };
}
```
Fields: `kind:'table'`, `box` (via `rectOf` — required by `leafWidget`'s `box.w/box.h` guard at line 64 and by `absPos`), `typo` (via `typo(cs)` — feeds `nativeTypo`), `rows[]` where each row is `{ header, cells: [{ text, th }] }`. Returning the node (like `list`/`accordion`/`video`) stops recursion into `<tr>/<td>`. Because it returns a non-container leaf, `flatten()` → `leafWidget()` routing is automatic, and `collectBg`/image-upload skip it (they only descend into `kind==='container'`).

**Build patch** — `build-absolute.mjs`, in `leafWidget(n)`. Insert **immediately after the LIST branch (after line 102, the `}` closing `if (n.kind === 'list')`) and before line 103** (`const text = stripEmoji(n.text); …`). `elType: 'widget'`, `widgetType: 'text-editor'` (the Matrix "table" row mandates the `html`/`text-editor` `<table>` path — no native core data-table widget; text-editor matches the `list` precedent and keeps the editor's visual HTML handle):
```js
// TABLE: emit a real <table> via a text-editor widget. Matrix (ELEMENTOR_CAPABILITY_MATRIX "table" row):
// no native core data-table widget → <table> markup in a text-editor/html widget, ~90% visual. table/tr/td/th
// tags + inline style ATTRS survive kses (only <style> TAGS are stripped); editing is raw-HTML (editability
// dips, as the Matrix notes). Header row (<th>) bolded inline; cells get a light inline border so zebra/grid
// reads. Mirrors the grader's gate — the rendered DOM is a <table> with >=2 <tr>, exactly what visN counts.
if (n.kind === 'table') {
  const cell = (c) => `<${c.th ? 'th' : 'td'} style="border:1px solid #ddd;padding:6px 10px;text-align:left${c.th ? ';font-weight:600' : ''}">${esc(stripEmoji(c.text) || '')}</${c.th ? 'th' : 'td'}>`;
  const trs = (n.rows || []).map((r) => `<tr>${r.cells.map(cell).join('')}</tr>`).join('');
  if (trs) widgets.push({ elType: 'widget', widgetType: 'text-editor', settings: { editor: `<table style="border-collapse:collapse;width:100%">${trs}</table>`, ...nativeTypo(n), ...P } });
  return;
}
```
**kses note:** confirmed safe. Emits only `<table>/<tr>/<td>/<th>` structural tags plus inline `style="…"` attributes — all of which survive `wp_kses` (only `<style>` TAGS are stripped). No `<script>`, no `<style>`. `esc()`/`stripEmoji()` reused exactly as the `list` branch does.

**Gotchas**
- The grader uses `querySelectorAll('tr')` (any depth, includes `<thead>/<tbody>/<tfoot>` rows). The capture gate MUST also use `el.querySelectorAll('tr').length >= 2` (NOT `:scope > tr`) or a `<thead>`+`<tbody>` table would be counted by the grader but missed by capture → asymmetric counting → self-test drift.
- Don't double-count nested tables: a `table` node returns and halts recursion, so an inner `<table>` inside an outer table's cell collapses into the outer's cell text — acceptable (rare; matches how the grader sees the outer as one table).
- `<th>` detection: a header row is `every cell is TH`; if a source uses `<td>` styled as a header, it renders as a plain row — still a valid `<table>`, grader-passing; only the bold styling is lost.
- `width:100%` + `absPos`'s `_element_custom_width: box.w` keeps the table inside its captured width band (prevents overflow). Do not omit it.
- `border-collapse:collapse` is required for the per-cell `1px` borders to read as a single grid.
- Empty-text guard: `if (trs)` + `.filter((r) => r.cells.length)` prevent emitting an empty `<table>`.

**Ceiling** — Matrix "table" row: mechanism = HTML/text-editor `<table>` + inline `style` attrs; **native:** none (verify if a Pro/3rd-party Table widget is installed — if so, prefer it). **raster:** not needed for a static table. Realistic **~90% visual fidelity, LOW editability** (edits happen in raw HTML, not a visual panel — exactly as the Matrix flags). V3 path (`text-editor` stores HTML; identical on V4-on-4.0.x). Purely a structural-fidelity recovery (gets `table` from 0 → matched count).

**Expected impact** — On any corpus page with a real data table (pricing/comparison/feature/spec tables), `cB.table` goes from `0` to `min(clone,source)/source = 1`, full credit for the `table` type in `structuralFidelity` and removes a `blockMiss` entry. On pages where a missed table was the only thing blocking `structuralFidelity >= 0.95`, this flips `atTarget` to true (L126). No impact on table-free pages (gate fails → falls through unchanged).

**Regression risk** — **Low**, symmetric by construction. Capture gate is an exact mirror of the grader gate, so the self-test stays consistent. Insertion is purely additive (new `if` returning before generic recursion), matching the proven `list`/`accordion`/`video` pattern. One thing to watch: a layout-only `<table>` with `>= 2` rows would now be captured as a data table — acceptable (the grader counts it on BOTH sides, so it stays symmetric; worst case bordered cells where the source had borderless layout cells). Do NOT add a `>= 2` cells-per-row or `<th>` requirement — that is NOT in the grader gate, so it would break symmetry.

Files: `/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/grade-sections.mjs` (detector L58), `/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/capture-layout.mjs` (insert after L242 in `walk()`), `/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/build-absolute.mjs` (insert after L102 in `leafWidget()`), `/Users/ckrohg/Documents/Claude/tenet-elementor/knowledge/ELEMENTOR_CAPABILITY_MATRIX.md` (table row L73).

### A3 — form

**Grader detector** (verbatim, `grade-sections.mjs` L53-54 — the `visN` helper + the `forms` count that feeds `blocks.form`):
```js
const visN = (sel) => [...document.querySelectorAll(sel)].filter(vis);
const forms = visN('form').filter((f) => f.querySelector('input,textarea,select')).length || (visN('input,textarea,select').length >= 2 ? 1 : 0);
```
Used at L56 as `blocks = { form: forms, … }`. Credit when the clone DOM contains either (a) a visible `<form>` that itself contains an `input`/`textarea`/`select`, or (b) ≥2 visible bare `input`/`textarea`/`select` elements anywhere. `vis` (L42) = nonzero bbox AND not `display:none`/`visibility:hidden`/`opacity<0.05`.

**Already built?** **No.** `leafWidget()` has branches for image/svg/mockup/code/video/list/heading/button/text — no `form` branch; `capture-layout.mjs` `walk()` has no `form` node kind. A source `<form>` recurses generically: its controls carry no own text → `leaf()` returns `null`, `<label>` text becomes a loose `text` widget, the submit `<button>` becomes a `text-editor` `<a>`. Net: zero `input`/`textarea`/`select`/`<form>` in the clone DOM → `blocks.form` clone count = 0 → structural miss every time the source has a form.

**Capture patch** — insert a new `n.kind==='form'` node in `walk()` in `capture-layout.mjs`, in the same slot the `list` detector occupies: **after the accordion block (closes at line 223) and before the LIST block (line 224)**. Gate mirrors the grader exactly:
```js
// FORM: a <form> carrying >=1 input/textarea/select, OR a fieldset-less container with >=2 such controls
// (no enclosing <form> — common on JS-driven signup widgets). Mirrors grade-sections.mjs's `forms` gate
// EXACTLY so source-vs-clone form counts stay symmetric. The generic walk drops every control (inputs have
// no innerText → leaf() returns null) so the clone rebuilt ZERO forms while the corpus has them. Capture the
// whole form as ONE 'form' node carrying each field's {type,label,name,placeholder,required,options} + the
// submit label, so the builder emits a native Elementor Pro Form widget (real <form><input>… in the DOM).
{
  const isFormEl = tag === 'form' && el.querySelector('input,textarea,select');
  const ctrlSel = 'input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select';
  const ctrls = [...el.querySelectorAll(ctrlSel)].filter(visible);
  const tightestCtrls = ctrls.length >= 2 && !el.closest('form') &&
    ![...el.children].some((c) => c.querySelectorAll && [...c.querySelectorAll(ctrlSel)].filter(visible).length === ctrls.length);
  if (isFormEl || tightestCtrls) {
    const fb = rectOf(el);
    if (fb.w >= 120 && fb.h >= 40 && fb.h <= 1400) {
      const scope = isFormEl ? el : el;
      const fields = [];
      for (const c of [...scope.querySelectorAll('input,textarea,select')].filter(visible)) {
        const ct = c.tagName.toLowerCase();
        let type = ct === 'textarea' ? 'textarea' : (ct === 'select' ? 'select' : (c.getAttribute('type') || 'text').toLowerCase());
        if (type === 'submit' || type === 'button' || type === 'hidden') continue;
        const map = { email: 'email', tel: 'tel', number: 'number', url: 'url', password: 'password', checkbox: 'checkbox', radio: 'radio', date: 'date', time: 'time', textarea: 'textarea', select: 'select' };
        type = map[type] || 'text';
        const id = c.id; let label = '';
        if (id) { const lab = scope.querySelector(`label[for="${CSS.escape(id)}"]`); if (lab) label = clean(lab.innerText); }
        if (!label) { const wrap = c.closest('label'); if (wrap) label = clean(wrap.innerText); }
        if (!label) label = clean(c.getAttribute('aria-label') || c.getAttribute('placeholder') || '');
        const options = ct === 'select' ? [...c.querySelectorAll('option')].map((o) => clean(o.textContent)).filter(Boolean).slice(0, 30) : null;
        fields.push({ type, label: (label || '').slice(0, 80), name: (c.getAttribute('name') || '').slice(0, 60), placeholder: clean(c.getAttribute('placeholder')).slice(0, 80), required: c.required || c.getAttribute('aria-required') === 'true', width: '100', options });
      }
      const submitEl = scope.querySelector('button[type=submit], input[type=submit], button:not([type])') ||
        [...scope.querySelectorAll('button,[role=button]')].find(visible);
      const submit = submitEl ? (clean(submitEl.value || submitEl.innerText) || 'Submit').slice(0, 40) : 'Submit';
      if (fields.length) return { kind: 'form', box: fb, fields, submit, bg: (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : null), typo: typo(cs) };
    }
  }
}
```
The `tightestCtrls` "no child holds all controls" test is copied from the accordion `tightest` pattern (L212). The `fb.h <= 1400` size guard mirrors accordion's (L208). `form`/`mockup`/`code`/`video`/`list` are non-container leaves, so `collectBg`/`doSvg`/`doMockup` and image-upload `collect` won't descend into it.

**Build patch** — add this `n.kind==='form'` branch in `leafWidget()` in `build-absolute.mjs`, **immediately after the `list` branch (after line 102, before `const text = stripEmoji(n.text)` at 103)**:
```js
// FORM: emit a NATIVE Elementor Pro Form widget (ELEMENTOR_CAPABILITY_MATRIX "FORM" row — Form widget [Pro],
// ~90%, native fields + validation + submit, editable). The widget renders a real <form> with <input>/
// <select>/<textarea> in the DOM — exactly what the grader's form gate counts. "Form rebuilt as text = the
// cardinal structural-fidelity failure" — this fixes it. form_fields is a REPEATER; each row needs a stable
// _id; field_type maps text/email/select/textarea/checkbox/tel/number/url/date; field_options newline-joined.
if (n.kind === 'form') {
  const allowed = new Set(['text', 'email', 'textarea', 'tel', 'url', 'number', 'date', 'time', 'password', 'select', 'checkbox', 'radio']);
  const form_fields = (n.fields || []).slice(0, 12).map((f, i) => {
    const ft = allowed.has(f.type) ? f.type : 'text';
    const row = {
      _id: 'f' + i.toString(36) + Math.random().toString(36).slice(2, 6),
      field_type: ft,
      field_label: stripEmoji(f.label) || '',
      placeholder: stripEmoji(f.placeholder) || '',
      required: f.required ? 'true' : '',
      width: '100',
    };
    if ((ft === 'select' || ft === 'radio' || ft === 'checkbox') && f.options && f.options.length) {
      row.field_options = f.options.map((o) => stripEmoji(o)).filter(Boolean).join('\n');
    }
    return row;
  }).filter((r) => r.field_label || r.placeholder || r.field_type !== 'text');
  if (form_fields.length) {
    widgets.push({ elType: 'widget', widgetType: 'form', settings: {
      form_name: 'Cloned Form',
      form_fields,
      button_text: stripEmoji(n.submit) || 'Submit',
      button_size: 'sm',
      ...P,
    } });
  }
  return;
}
```
**elType/widgetType:** `widget` / `form` (the Pro Form widget — `elementor-pro/v1` REST namespace confirmed on the target stack). **kses note:** kses-safe — this emits native widget SETTINGS (a `form` widget repeater), not raw HTML; no `<script>` is authored (the Pro widget's submit handler is server-side).

**Gotchas**
- **Pro-only.** `widgetType: 'form'` requires Pro. On a free-only site this won't register and the PUT may validate-fail or render empty. No free fallback in this spec; if Pro absence is ever detected, the future free fallback is a raw `<form>` in an `html` widget (visual-only, no submit), out of scope here.
- `form_fields` is a repeater; each row needs a unique `_id`. Reused/empty `_id`s collapse rows.
- `required` is the string `'true'`/`''`, not a boolean (Elementor switcher controls are strings).
- Field-type whitelist: raw HTML `type=range`/`color`/`file`/`search` etc. collapse to `text`. `select`/`radio`/`checkbox` need `field_options` (newline-joined).
- Capture excludes `type=hidden`/`submit`/`button`; the grader's `visN('input,textarea,select')` counts all visible such tags. The Pro Form widget renders exactly one real control per field plus the wrapping `<form>` → the grader's primary path matches regardless of count, so symmetry holds.
- Every field emitted at `width:'100'` (full-width stacked). Multi-column source forms will stack — acceptable.
- Don't double-capture: `!el.closest('form')` defers to the real `<form>`; `tightestCtrls` defers down to the tightest wrapper.

**Ceiling** — **native (Pro): ~90%** (matrix "FORM" row verbatim). Field structure, labels, placeholders, required-flags, select options, submit text all reproduce as native, editable Pro Form controls. CSS/raster not needed. Lost ~10%: exact field styling, real submit-action wiring (recipient/redirect/integrations — not captured), validation beyond `required`, multi-step/conditional logic. No raster path (rasterizing zeroes the structural credit).

**Expected impact** — On every corpus source whose `blocks.form > 0`, the clone's `blocks.form` flips from 0 to matched. For a page where `form` is one of N present block types, this raises `structuralFidelity` by `1/N` and composite by `0.3/N`, and clears the `atTarget` blocker on form-bearing pages. Bonus: the form's labels become editable text the editability metric can match.

**Regression risk** — **Low, isolated.** Both insertions are new, self-`return`ing branches gated by a strict tag/control test; cannot alter the path for any non-form node (matches the `list`/`video`/`accordion` precedent). The `!el.closest('form')` + `tightest` + `h <= 1400` guards pre-empt the section-swallow failure mode. One real risk: a search box / single newsletter `<input>+button` in nav with ≥2 controls could match the bare-controls path — but the grader does NOT exclude nav for forms (unlike list/accordion), so to keep counts symmetric the capture gate must ALSO not exclude nav. Do NOT add a nav exclusion unilaterally — if over-capture appears in testing, add `&& !el.closest('nav,header,[role=search]')` to BOTH the capture gate AND the grader's `forms` line in the same PR (keep them identical). Smoke-test one form page and confirm `blocksClone.form` increments and PUT returns non-409/non-400 before merging.

Files: `/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/grade-sections.mjs` (detector L53-54), `/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/capture-layout.mjs` (insert after L223 in `walk()`), `/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/build-absolute.mjs` (insert after L102 in `leafWidget()`), `/Users/ckrohg/Documents/Claude/tenet-elementor/knowledge/ELEMENTOR_CAPABILITY_MATRIX.md` (FORM row).

### A4 — accordion

**Grader detector** (verbatim, `grade-sections.mjs` L61):
```js
accordion: visN('details').length >= 2 ? 1 : (visN('[aria-expanded][aria-controls]').filter((b) => !b.closest('nav,header')).length >= 2 ? 1 : 0),
```
Counts at most **1** per page: fires if there are `>=2` visible `<details>`, OR `>=2` visible `[aria-expanded][aria-controls]` toggles not inside `nav`/`header`.

**Already built?** **Partly.** The **capture half already exists and is correct** — `capture-layout.mjs` `walk()` L199-223 already emit `{ kind: 'accordion', box, items:[{summary, open, content:[{text,href?}…]}] }` with the size guard (`accBox.h <= 1400 && >= 40`), the nav/header guard, the tightest-container guard, and `items.length >= 2`. **The build half is MISSING** — `build-absolute.mjs` `leafWidget()` has no `n.kind==='accordion'` branch. So an accordion node reaches `leafWidget`, skips every `if`, hits `const text = stripEmoji(n.text)` (L103) where `n.text` is `undefined` → `if (!text) return;` → the accordion is **silently dropped**. This is the one-shot fix: add the build branch.

**Capture patch** — **No change required to land the win**; the node already exists (L199-223, gated on `accBox.h <= 1400 && >= 40` and `!el.closest('nav,header,[role=banner],[role=menubar]')`, selector `'button[aria-expanded][aria-controls]:not([aria-haspopup])'` with the tightest-container defer, producing `return { kind: 'accordion', box: rectOf(el), items };`). OPTIONAL full-symmetry polish (the grader ALSO fires on `>=2 <details>` with no aria requirement, which capture does not detect): add a `<details>`-group detector BEFORE the existing aria block:
```js
// <details>-based accordion (grader's first clause: >=2 visible <details>). Group sibling <details>.
if (!el.closest('nav,header,[role=banner],[role=menubar]') && accBox.h <= 1400 && accBox.h >= 40) {
  const dets = [...el.querySelectorAll(':scope details, :scope > details')].filter(visible);
  const tightestD = dets.length >= 2 && ![...el.children].some((c) => c.querySelectorAll && c.querySelectorAll('details').length === dets.length);
  if (tightestD) {
    const items = dets.map((d) => { const sm = d.querySelector('summary'); const summary = clean((sm||d).innerText||'').slice(0,90); const body = clean(d.innerText||'').slice(summary.length).trim().slice(0,240); return { summary, open: d.hasAttribute('open'), content: body ? [{ text: body }] : [] }; }).filter((it) => it.summary);
    if (items.length >= 2) return { kind: 'accordion', box: rectOf(el), items };
  }
}
```
This is OPTIONAL polish, not needed for the primary fix. If added, re-run `--selftest` and verify no double-count of a page that ALSO has aria toggles.

**Build patch** — add this branch to `build-absolute.mjs` `leafWidget(n)`, **right after the `if (n.kind === 'list') { … return; }` block (after line 102) and before `const text = stripEmoji(n.text);` (line 103)**:
```js
// ACCORDION: emit a NATIVE <details>/<summary> group inside a text-editor widget. Matrix "accordion" row:
// Pro Accordion widget is native, but the FREE <details>/<summary> path is pure-HTML, kses-safe (no <script>),
// genuinely functional (browser-native open/close), and renders >=2 real <details> in the DOM — which is the
// grader's FIRST accordion clause (visN('details').length >= 2), so source-vs-clone structuralFidelity stays
// symmetric from ONE widget. <details>/<summary>/<ul>/<li> tags + inline style attrs survive kses (only <style>
// TAGS are stripped). First item gets `open` if the source had it expanded. Body keeps a single <a href> if the
// captured content item carried one (navigable + editable), else plain text per panel.
if (n.kind === 'accordion') {
  const blocks = (n.items || []).map((it) => {
    const sm = stripEmoji(it.summary); if (!sm) return '';
    const body = (it.content || []).map((c) => { const ct = stripEmoji(c.text); if (!ct) return ''; return c.href ? `<a href="${esc(c.href)}">${esc(ct)}</a>` : esc(ct); }).filter(Boolean).join('<br>');
    return `<details${it.open ? ' open' : ''}><summary>${esc(sm)}</summary><div>${body}</div></details>`;
  }).filter(Boolean).join('');
  if (blocks) widgets.push({ elType: 'widget', widgetType: 'text-editor', settings: { editor: blocks, ...nativeTypo(n), ...P } });
  return;
}
```
- elType/widgetType: `widget` / `text-editor` (carrying raw `<details>` markup). NOT the Pro `accordion` widget — `<details>` hits the grader's primary clause from a single editable widget, consistent with how `list`/`code`/`video` fallbacks are emitted.
- `...nativeTypo(n)` is a safe no-op when the node carries no `typo` (returns `{}`). `...P` = `absPos(box, z++)` pins the widget.
- **kses note — SAFE.** Only `<details>`, `<summary>`, `<div>`, `<br>`, `<a href>`, `esc()`-escaped text. No `<style>` tags, no `<script>`. The `open` boolean attribute survives.

**Gotchas**
- **`n.text` undefined → silent drop is the current bug.** The new branch must `return;` after pushing (it does).
- summary vs body split symmetry: put `summary` in `<summary>` and `content` in the panel `<div>` — do NOT concatenate.
- Grader clause matched is `<details>`, not aria. Need `>=2` items (capture already guarantees `items.length >= 2`).
- `open` on multiple items: native `<details>` allows several open simultaneously; source rarely has >1 open. Do not force-close all.
- Visual band delta expected: source was likely captured panels-OPEN (capture click-drives `button[aria-expanded]` triggers, L70) while the clone shows them collapsed → approximate visual on accordion bands.
- `esc`/`stripEmoji`/`nativeTypo`/`absPos`/`P` all already in scope (no new imports).

**Ceiling** — Matrix "accordion" row, free `<details>/<summary>` path: **~85%** (Matrix). Structural + editability ≈ full credit (real `<details>` DOM + editable HTML). Visual ~80-90% depending on expanded-vs-collapsed capture and chevron/border styling (closing the chevron/border gap needs per-widget `custom_css`, out of scope). NOT raster.

**Expected impact** — On any corpus page whose source trips the accordion gate, `blocksClone.accordion` goes `0` → `1`, that block type's credit goes `0/1` → `1/1`, lifting composite by up to `0.3 × (1/types)`. Also removes the dropped-text editability hit on that band. Pages with no accordion unaffected.

**Regression risk** — **Very low.** The branch only executes for `n.kind === 'accordion'`, a node kind that previously produced nothing — strictly additive (dropped → emitted), exactly like the `list`/`video` branches. No new file-level wiring. If the optional capture clause IS added, re-run `--selftest` (must score `>=0.99`) and verify the `<details>` group detector doesn't double-count a page that ALSO has aria toggles.

Files: `/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/grade-sections.mjs` (detector L61), `/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/capture-layout.mjs` (capture node L199-223 — already present), `/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/build-absolute.mjs` (insert build branch after L102, before L103), `/Users/ckrohg/Documents/Claude/tenet-elementor/knowledge/ELEMENTOR_CAPABILITY_MATRIX.md` (accordion row, Tier 3).

### A5 — tabs

**Grader detector** — `grade-sections.mjs` L60 (`visN` defined at L53):
```js
tabs: visN('[role=tablist]').length || (visN('[role=tab]').length >= 2 ? 1 : 0),
```
A section counts as `tabs` when there is `>=1` visible `[role=tablist]`, OR `>=2` visible `[role=tab]`. Critically, the tabs gate keys on ARIA roles, NOT on `<details>` (that is the accordion gate, L61). Capture and build must BOTH key on `role=tablist`/`role=tab` so source-vs-clone counting stays symmetric and the SELFTEST stays ~1.0.

**Already built?** No. `capture-layout.mjs walk()` has detectors for video, code, mockup, accordion, list — none for tabs. The accordion detector (L199-223) keys on `<details>` / `[aria-expanded][aria-controls]` and skips nav/header; a `role=tablist` widget without `aria-expanded` is NOT caught, so today a tablist falls through to generic recursion → collapsed tab panels (`hidden`/`display:none`) drop as invisible and tab buttons leak as loose text. `build-absolute.mjs leafWidget()` has no `n.kind === 'tabs'` branch. `cln.blocks.tabs` is 0 whenever `src.blocks.tabs > 0`.

**Capture patch** — insert a `tabs` detector **immediately AFTER the LIST block (ends at line 242) and BEFORE** `const kidEls = …` at line 243. Node kind `'tabs'`; fields `{ kind: 'tabs', box: rectOf(el), typo: typo(cs), items: [{ title, content }] }`:
```js
// TABS: a [role=tablist] grouping >=2 [role=tab]; each tab's panel is referenced by aria-controls and is
// typically COLLAPSED/hidden so the generic walk drops it → tab labels leak as loose text, panels lost.
// Capture the tablist as ONE 'tabs' node carrying each tab's title + its panel text. Gate MIRRORS
// grade-sections.mjs line 60: a visible [role=tablist], OR >=2 visible [role=tab]. SIZE+tightest guards
// mirror accordion (lines 208-212): a tabs widget is a compact region; defer to the tightest child.
{
  const tabBox = rectOf(el);
  const isTablist = el.getAttribute('role') === 'tablist';
  const tablistEl = isTablist ? el : el.querySelector('[role=tablist]');
  if (tablistEl && tabBox.h <= 1400 && tabBox.h >= 30 && !el.closest('nav,[role=navigation]')) {
    const tabs = [...el.querySelectorAll('[role=tab]')].filter(visible);
    const tightest = tabs.length >= 2 && ![...el.children].some((c) => c.querySelectorAll && c.querySelectorAll('[role=tab]').length === tabs.length);
    if (tabs.length >= 2 && tightest) {
      const items = tabs.map((tb) => {
        const title = clean(tb.innerText || tb.textContent).slice(0, 90);
        const pid = tb.getAttribute('aria-controls'); let panel = pid && document.getElementById(pid);
        if (!panel) { const lbl = tb.id; if (lbl) panel = document.querySelector(`[role=tabpanel][aria-labelledby="${lbl}"]`); }
        const content = [];
        if (panel) {
          for (const a of panel.querySelectorAll('a[href]')) { const txt = clean(a.innerText); if (txt) content.push({ text: txt.slice(0, 90), href: a.href }); }
          if (!content.length) { const txt = clean(panel.innerText); if (txt) content.push({ text: txt.slice(0, 600) }); }
        }
        return { title, content };
      }).filter((it) => it.title);
      if (items.length >= 2) return { kind: 'tabs', box: tabBox, typo: typo(cs), items };
    }
  }
}
```
The pre-capture click-driver (L70) already clicks `[role="tab"]:not(a)` to render gated panels; this detector reads panels via `aria-controls`/`getElementById` regardless of current visibility. The gate (`tabs.length >= 2` + is/has a tablist) is a conservative SUBSET of the grader's OR-gate — symmetric on the dominant real shape. Place AFTER list / BEFORE generic recursion.

**Build patch** — insert a `n.kind === 'tabs'` branch **immediately AFTER the LIST branch (after line 102) and before `const text = stripEmoji(n.text)` at 103**. elType/widgetType: **`html`** (NOT the Pro `tabs` widgetType, NOT `text-editor`):
```js
// TABS: emit a NATIVE-HTML tabs widget via the `html` widget (NOT the Pro `tabs` widgetType — Pro isn't
// guaranteed on this REST/Document::save path; a missing Pro widget renders EMPTY → re-introduces the
// structural miss). Matrix "tabs" row: Pro native ~90%; no-Pro fallback = <details>/role-based HTML, kses-safe.
// The grader's tabs gate (grade-sections.mjs line 60) counts role=tablist + role=tab — so we MUST carry those
// ARIA roles (NOT a bare <details>, which would count as ACCORDION). Use a <details name="…"> radio group
// (Baseline 2024 exclusive-accordion): clicking one summary closes the others → real tab switching with NO
// <script> and NO <style> TAG — all styling via inline style ATTRIBUTES (survive kses).
if (n.kind === 'tabs') {
  const grp = 'jt' + (z);
  const panels = [];
  (n.items || []).forEach((it, i) => {
    const title = stripEmoji(it.title); if (!title) return;
    const open = i === 0 ? ' open' : '';
    const body = (it.content || []).map((c) => {
      const ct = stripEmoji(c.text); if (!ct) return '';
      return c.href ? `<a href="${esc(c.href)}" style="display:block">${esc(ct)}</a>` : `<div>${esc(ct)}</div>`;
    }).filter(Boolean).join('');
    panels.push(
      `<details name="${esc(grp)}"${open} style="border-bottom:1px solid rgba(0,0,0,0.1)">` +
        `<summary role="tab" style="cursor:pointer;list-style:none;padding:10px 14px;font-weight:600">${esc(title)}</summary>` +
        `<div role="tabpanel" style="padding:0 14px 14px">${body}</div>` +
      `</details>`
    );
  });
  if (panels.length >= 2) {
    const html = `<div role="tablist" style="width:${Math.round(box.w)}px">${panels.join('')}</div>`;
    widgets.push({ elType: 'widget', widgetType: 'html', settings: { html, ...nativeTypo(n), ...P } });
  }
  return;
}
```
**kses note:** safe — `<div>`/`<details>`/`<summary>`/`<a>` survive, `role=`/`name=`/`open`/inline `style=` are plain attributes (only `<style>`/`<script>` TAGS stripped). The `html` widget's `html` field does NOT run `wpautop` (unlike `text-editor.editor`) and does not strip `<details>`/`role`. The `<details name>` exclusive-group toggle (Baseline 2024) gives one-open-at-a-time switching with zero JS.

**Gotchas**
- **Do NOT emit `widgetType: 'tabs'` (the Pro widget).** No Pro-installed guarantee on georges232; a missing Pro widget renders empty → structural miss persists. (Same lesson as the `form` spec.) The Pro `tabs` repeater is a later upgrade gated on detecting Pro via `joist_introspect_atomic_schema`.
- **Use `html`, not `text-editor`.** `text-editor.editor` runs `wpautop` + stricter kses that mangles `<details>`/`<summary>`/`role`.
- **Carry `role="tablist"` + `role="tab"`, not a bare `<details>` stack** — a bare `<details>` group satisfies the *accordion* gate (L61), not *tabs* (L60).
- Avoid colliding with the accordion gate's `<details>` count (L61, `visN('details').length >= 2`): the tabs fallback also emits `>=2 <details>`, so on a tabs-only source the clone may register a spurious `accordion`. This is benign — `structuralFidelity` only credits/penalizes block types where `sB[k] > 0` (L121, `if ((sB[k]||0) <= 0) continue`), so a clone-only accordion is not scored. (If a future grader penalizes clone-only blocks, switch to `role=tab` on plain `<div>`s with a `:has`/`:checked` radio toggle — but that costs zero-JS switching, so keep `<details>` for now.)
- `<details name>` exclusive grouping needs a unique `name` per widget (derive from `z`), else two tabs widgets cross-toggle. Do NOT increment `z` extra times inside the branch.
- First tab `open` by default matches typical source rendering → better SSIM in that band.

**Ceiling** — Matrix tabs row (tier 3): Pro `tabs` = ~90%. The fallback (matrix no-Pro `<details>`/role path) ≈ **~85%** — structural type fully credited, genuine zero-JS click-to-switch, all titles + panel text present and grader-matchable. Editability moderate (raw-HTML field, not a visual repeater). Visual desktop-pixel-faithful via `absPos`. The ~15% gap vs Pro = no visual-panel per-tab editing, no Pro tab-bar styling.

**Expected impact** — On any corpus page with a real tab widget (`src.blocks.tabs > 0`, currently `cln.blocks.tabs === 0`), this flips the block from 0-credit to full credit; each recovered tabs page lifts that page's `structuralFidelity` by `1/types` and composite by `0.3 × that`. Also recovers tab-panel TEXT that today leaks/drops → editability rises.

**Regression risk** — Low and bounded. Capture sits in the same dead-zone slot as list/accordion and early-returns ONLY on a `[role=tablist]` (or is one) with `>=2` visible `[role=tab]` and the tightest-child + size guards pass; tab-free pages untouched. Build branch fires only on the new node kind and `return`s. SELFTEST symmetry: the capture gate is a conservative subset of the grader OR-gate (both fire identically on the dominant tablist + `>=2` tabs shape). The one benign asymmetry (clone registering an extra `accordion`) cannot lower the composite (clone-only block types not scored). No new imports/deps; no change to `collectBg`/`flatten`/upload routing.

Files: `/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/grade-sections.mjs` (detector L60), `/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/capture-layout.mjs` (insert after L242 in `walk()`), `/Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader/build-absolute.mjs` (insert after L102 in `leafWidget()`), `/Users/ckrohg/Documents/Claude/tenet-elementor/knowledge/ELEMENTOR_CAPABILITY_MATRIX.md` (tabs row, tier 3, L81).

---

## Section B — Grader blind spots (extend detection FIRST)

> **⚠️ WARNING — these are THREE-FILE rounds, not two-file rounds.** Each block below is currently INVISIBLE to the grader: there is no `blocks.*` key for it, so the corpus gate cannot reward or punish it. You MUST FIRST add the detector to `grade-sections.mjs` (inside the in-page `capture()` evaluate `blocks` object, L55-63), AND THEN re-validate the source-vs-source self-test scores **exactly 1.0** (`node grade-sections.mjs --source <url> --selftest` → must print PASS / composite 1.0 / atTarget true), BEFORE the corpus gate keeps anything. The propose-prompt's hard rule "edit ONLY capture-layout.mjs and/or build-absolute.mjs … Do NOT touch grade-sections.mjs/scoring" (`evolve.workflow.js` L59) is written for the Section-A two-file rounds — a Section-B round is a DIFFERENT, supervised change that deliberately edits the grader and therefore CANNOT run through the standard auto-pilot propose-prompt unmodified. The self-test stays 1.0 by construction only because `--selftest` sets `cln = src` (L75) so `Math.min(cB[k],sB[k])/sB[k] === 1` for every key; the REAL symmetry risk is source-vs-CLONE, which is why each detector below is written against generic DOM/geometry/ARIA/semantics that the build patch reproduces in the clone DOM (real `<blockquote>`, real `<ul>`, real overflow-x track, real `[popover]`, real maps iframe), NEVER against Elementor-specific classes.

### Grader detects today
form, video, table, list, tabs, accordion, nav.

### B1 — card-grid / card (Tier 2, priority 1)

**Why blind** — The `blocks` map has no card/card-grid signal. A "card" rebuilt as loose absolutely-positioned leaves (the #1 structural-fidelity failure named in the matrix) scores identically to a card rebuilt as a real container. `build-absolute.mjs::flatten()` drops all container structure, so cards never survive — and nothing measures the loss.

**Grader detector to add** (symmetric, DOM-geometry based, never class names) — a card-grid is a parent whose direct children are ≥3 sibling boxes that are (a) near-equal width (stdev/mean of width < 0.12), (b) share a row band or wrap into a regular grid, (c) each child is a "card" = a box with a non-transparent background OR visible border OR box-shadow AND ≥2 distinct descendant text/media leaves. Count grids, not individual cards.
```js
const cardOf = (el) => { const cs = getComputedStyle(el); const hasSkin = (cs.backgroundColor!=='rgba(0, 0, 0, 0)'&&cs.backgroundColor!=='transparent') || /^(?!0px)/.test(cs.borderTopWidth)&&cs.borderTopStyle!=='none' || (cs.boxShadow&&cs.boxShadow!=='none'); const kids=[...el.querySelectorAll('h1,h2,h3,h4,h5,h6,p,img,svg,a,button')].filter(vis); return hasSkin && kids.length>=2; };
const cardGrid = [...document.querySelectorAll('body *')].filter(vis).filter((el)=>{ const sib=[...el.children].filter(vis); const cards=sib.filter(cardOf); if(cards.length<3) return false; const ws=cards.map(c=>c.getBoundingClientRect().width); const m=ws.reduce((a,b)=>a+b,0)/ws.length; const sd=Math.sqrt(ws.reduce((a,b)=>a+(b-m)**2,0)/ws.length); return m>0 && sd/m<0.12; }).length;
// blocks.cardGrid = cardGrid;  // and blocks.card = total card count if a finer signal is wanted
```
Filter parents to the tightest match (skip a grandparent wrapping a single grid child) to avoid double-counting, mirroring the accordion `tightest` guard.

**Capture patch** (`capture-layout.mjs`) — before generic recursion, add a `walk()` branch: when a container's direct visible children satisfy `cardOf` + equal-width, tag the emitted container node `kind:'container', role:'card-grid'` and each qualifying child `role:'card'`, preserving their bg/border/radius/boxShadow. Do NOT flatten card children to leaves — keep the card as a real sub-container node.

**Build patch** (`build-absolute.mjs`) — `flatten()` currently discards every container. Add: when a node has `role:'card'`, emit a real Elementor `container` widget (bg/border/radius/boxShadow → native container settings) absolutely positioned at the card's box, then recurse its children. For `role:'card-grid'`, optionally emit a Grid container (`gridTemplateColumns: repeat(N,1fr)`). Minimum viable: emit the card container so the clone DOM contains the same N bordered boxes the detector counts.

**Self-test note** — reads only computed geometry + paint; identical on source-vs-source → ratio 1.0. Never references Elementor classes or `data-*`.

### B2 — icon / svg (Tier 1, priority 2)

**Why blind** — capture already captures `kind:'svg'` and rasterizes it, build emits it as an image widget — but the *grader* has no `icon`/`svg` count, so structural fidelity is blind to icons being dropped (tiny decorative svgs are SKIP'd in capture; an icon-heavy feature row that loses all icons scores 1.0 structurally). Icons are the highest-frequency Tier-1 atom after text.

**Grader detector to add** — count "meaningful" icons symmetrically: visible `<svg>` OR `<img>` whose rendered box is small-and-square-ish (both dims ~14–96px, aspect 0.5–2.0), excluding `nav,header` and the hero/photo images. Count BOTH tags under the same rule (so a clone that rasterizes an svg into an `<img>` counts equal).
```js
const isIcon = (el) => { const r=el.getBoundingClientRect(); const d=Math.min(r.width,r.height),D=Math.max(r.width,r.height); return d>=14 && D<=96 && D/d<=2.2 && !el.closest('nav,header,[role=navigation]'); };
blocks.icon = [...document.querySelectorAll('svg,img')].filter(vis).filter(isIcon).length;
```

**Capture patch** — largely present. Tighten only so the count matches: ensure `doSvg`'s SKIP threshold (≤22px max-dim) does not drop icons the grader counts (grader floor is 14px) — align the floors. No new node kind.

**Build patch** — already emits rasterized svg/icon as an image widget (one `<img>` per icon the detector counts). To raise the quality ceiling (matrix: inline-SVG via html ≈100% vs raster ~90%), optionally emit small svgs as an `html` widget with inline `<svg>`. The patch is to guarantee one emitted element per captured icon.

**Self-test note** — pure geometry on the rendered box, identical source-vs-source. Counting svg AND img under the same rule keeps raster-to-img symmetric → 1.0.

### B3 — carousel / slider (Tier 3, priority 3)

**Why blind** — no carousel signal anywhere. `reducedMotion:'reduce'` + scroll passes mean a slider is captured as whatever slide is visible, flattened to leaves; the grader sees text coverage but never "there was a horizontally-scrolling track of N equal slides." A carousel rebuilt as a static stack scores fine.

**Grader detector to add** (behavior + geometry — avoid Swiper class matching):
```js
const carousels = [...document.querySelectorAll('body *')].filter(vis).filter((el)=>{ const cs=getComputedStyle(el); const ar=(el.getAttribute('aria-roledescription')||'').toLowerCase(); if(ar==='carousel') return true; const clipped=/auto|scroll/.test(cs.overflowX); const track=el.scrollWidth>el.clientWidth+24; if(!clipped&&!track) return false; const sib=[...el.children].filter(vis); if(sib.length<3) return false; const tops=sib.map(s=>Math.round(s.getBoundingClientRect().top)); const oneRow=new Set(tops).size<=2; const ws=sib.map(s=>s.getBoundingClientRect().width); const m=ws.reduce((a,b)=>a+b,0)/ws.length, sd=Math.sqrt(ws.reduce((a,b)=>a+(b-m)**2,0)/ws.length); return oneRow && m>40 && sd/m<0.15; }).length;
blocks.carousel = carousels;
```

**Capture patch** — add a `walk()` branch before generic recursion: detect the overflow-x track / aria carousel; emit `kind:'carousel'` carrying each slide's harvested leaf content (mirroring `accordion` items) + slide count + ordered flag. Reuse the accordion size guards.

**Build patch** — emit, at minimum, a real horizontally-overflowing track: an `html` widget whose inner div is `display:flex;overflow-x:auto` with N equal-width slide divs (inline styles, kses-safe), so the clone DOM satisfies the same overflow+equal-width detector. Higher ceiling: route to Pro `image-carousel`/`slides`/`media-carousel` when slides are image-dominant. Pin absolutely.

**Self-test note** — keys on `overflowX`, `scrollWidth>clientWidth`, equal child widths, single-row tops, ARIA — rendered facts identical source-vs-source. The free build reproduces exactly those facts → 1.0.

### B4 — stat / counter row (Tier 2, priority 4)

**Why blind** — no counter/stat signal. A "10,000+ / 99.9% / 4.8★" stat row is captured as heading+text leaves; the grader counts the text but is blind to the grouped repeated metric pattern. Animated count-up is also invisible (reducedMotion freezes it).

**Grader detector to add** (DOM + content heuristic):
```js
const isStatItem = (el)=>{ const t=(el.innerText||'').trim(); return /^[\s$€£]*[\d][\d.,\s]*[%+kKmMbB★]*$/.test(t.split('\n')[0]) && t.split('\n')[0].length<=12; };
const statRows = [...document.querySelectorAll('body *')].filter(vis).filter((el)=>{ const sib=[...el.children].filter(vis); if(sib.length<3) return false; const stats=sib.filter(s=>[...s.querySelectorAll('*')].concat([s]).some(isStatItem)); if(stats.length<3) return false; const tops=stats.map(s=>Math.round(s.getBoundingClientRect().top)); return new Set(tops).size<=2; }).length;
blocks.statRow = statRows;
```

**Capture patch** — add a `walk()` branch tagging the row `kind:'container', role:'stat-row'` and each metric child `role:'stat'` with `{value, label}` harvested leaves. Don't let depth-flatten scatter them.

**Build patch** — emit a flex-row container of stat sub-containers (number heading + label text) — native ~90% static; or Pro `counter` widget when an animated count-up is detected (Tier-4 overlap). Minimum: emit the grouped row so the "≥3 numeric siblings in a row" detector holds on the clone.

**Self-test note** — numeric regex + sibling geometry are content/layout facts, identical source-vs-source → 1.0.

### B5 — logo wall (Tier 2, priority 5)

**Why blind** — no logo-wall signal. A trust-bar of ≥4 small brand logos is either rasterized as a mockup or scattered as image leaves; the grader counts neither as a structural type, so logo rows baked into a raster are invisible to structural fidelity.

**Grader detector to add**:
```js
const logoWalls = [...document.querySelectorAll('body *')].filter(vis).filter((el)=>{ const media=[...el.querySelectorAll('img,svg')].filter(vis).filter(m=>{const r=m.getBoundingClientRect(); return r.height>=16&&r.height<=120&&r.width>=24;}); if(media.length<4) return false; const hs=media.map(m=>m.getBoundingClientRect().height); const mh=hs.reduce((a,b)=>a+b,0)/hs.length, sd=Math.sqrt(hs.reduce((a,b)=>a+(b-mh)**2,0)/hs.length); const txt=(el.innerText||'').replace(/\s/g,'').length; return mh>0 && sd/mh<0.35 && txt<120; }).length;
blocks.logoWall = logoWalls;
```
Guard to the tightest container (the one whose own children ARE the logos) to avoid counting a section wrapper and its inner row twice.

**Capture patch** — logo walls currently fall into the mockup rasterizer (low-text + media≥4) and get baked into one PNG → individual logos lost. Add a branch: when the logo-wall test passes, emit `kind:'container', role:'logo-wall'` with each logo as an `image`/`svg` leaf instead of one mockup raster.

**Build patch** — emit a flex/grid row of image widgets (one per logo), each pinned, matching matrix's logo-wall row. This replaces the single baked raster with N counted images.

**Self-test note** — keys on child media count, height-uniformity, low text — identical source-vs-source → 1.0. (Note: this REQUIRES the capture change to stop rasterizing them, or source-vs-CLONE diverges; self-test itself stays 1.0 because both sides are the source.)

### B6 — testimonial (Tier 2, priority 6)

**Why blind** — no testimonial signal. A quote + avatar + name/title block is captured as text + image leaves; rebuilt as scattered text it scores 1.0 structurally. Frequent, often inside a carousel.

**Grader detector to add** (semantic + structural):
```js
const isQuoteText=(el)=>{ const t=(el.innerText||'').trim(); return t.length>=40 && t.length<=400 && /[.!?"”']$/.test(t); };
const testimonials=[...document.querySelectorAll('body *')].filter(vis).filter((el)=>{ const hasQuote = !!el.querySelector('blockquote') || [...el.children].filter(vis).some(isQuoteText); if(!hasQuote) return false; const avatar=[...el.querySelectorAll('img,svg')].filter(vis).some(m=>{const r=m.getBoundingClientRect(); const d=Math.min(r.width,r.height),D=Math.max(r.width,r.height); return d>=24&&D<=96&&D/d<1.4;}); const r=el.getBoundingClientRect(); return hasQuote && avatar && r.height<=700; }).length;
blocks.testimonial = testimonials;
```

**Capture patch** — add a `walk()` branch: when the test passes, tag `kind:'container', role:'testimonial'` carrying the quote text leaf + avatar image leaf + attribution leaf; keep them as a sub-container.

**Build patch** — emit a container (matrix free-composition path: text-editor `<blockquote>` + image + heading) — fully faithful + editable. The clone DOM then has a `<blockquote>`/quote + avatar in one group → counted.

**Self-test note** — keys on blockquote/sentence-shaped text + square avatar + grouping → 1.0. "blockquote OR sentence-shaped text" keeps it symmetric whether the clone emits a real `<blockquote>` or a styled text div.

### B7 — blockquote (Tier 1, priority 7)

**Why blind** — no quote signal. A standalone pull-quote is captured as a text leaf and rebuilt as a plain `<div>` text-editor; the grader never checks that a `<blockquote>` element exists.

**Grader detector to add**:
```js
blocks.blockquote = [...document.querySelectorAll('blockquote')].filter(vis).filter(b=>(b.innerText||'').trim().length>=20).length;
```

**Capture patch** — in `leaf()`, when `tag==='blockquote'` (or `<q>`), tag the node `role:'blockquote'`.

**Build patch** — for a `role:'blockquote'` text node, emit a `text-editor` whose `editor` is `<blockquote>…</blockquote>` (matrix Tier-1 blockquote row: native ~95%, kses-safe). The clone DOM then contains a real `<blockquote>` → counted.

**Self-test note** — counts `<blockquote>` elements with ≥20 chars; a pure tag count, identical source-vs-source → 1.0.

### B8 — divider (Tier 1, priority 8)

**Why blind** — no divider signal. Horizontal rules / separators are captured as nothing (thin textless boxes get pruned) or a thin container; rebuilt, they vanish. Low visual weight but high frequency; their absence shifts vertical rhythm.

**Grader detector to add** (geometry, symmetric across `<hr>` and styled divs):
```js
const isDivider=(el)=>{ const r=el.getBoundingClientRect(); const cs=getComputedStyle(el); if(el.tagName==='HR') return r.width>=W*0.1; const txt=(el.innerText||'').trim(); const painted=(cs.backgroundColor!=='rgba(0, 0, 0, 0)'&&cs.backgroundColor!=='transparent')||(cs.borderBottomWidth!=='0px'&&cs.borderBottomStyle!=='none'); return !txt && r.height<=4 && r.height>=1 && r.width>=W*0.25 && painted; };
blocks.divider = [...document.querySelectorAll('hr,div,span')].filter(vis).filter(isDivider).length;
```

**Capture patch** — in `walk()`, detect `<hr>` or the thin-painted-box pattern and emit `kind:'divider'` with box + color/weight.

**Build patch** — emit a native `divider` widget using `color`/`weight`/`width` (matrix Tier-1 divider row — corrected control names `color`/`weight`, NOT `divider_color`/`divider_weight`), pinned absolutely. Or a thin `html` div.

**Self-test note** — geometry+paint+text-absence; counting `<hr>` AND thin painted divs keeps it symmetric (Elementor's divider renders as a div) → 1.0.

### B9 — pricing table (Tier 2, priority 9)

**Why blind** — no pricing signal. A pricing card (price + period + feature list + CTA, often a "featured" column) is captured as a card of leaves; rebuilt as scattered text it loses the column grouping. Mid-frequency, high business value.

**Grader detector to add** (composite, builds on card + numeric + list):
```js
const priceRe=/[$€£]\s*\d|^\d+\s*\/\s*(mo|month|yr|year)/i;
const pricingTables=[...document.querySelectorAll('body *')].filter(vis).filter((el)=>{ const cols=[...el.children].filter(vis).filter((c)=>{ const t=c.innerText||''; const hasPrice=priceRe.test(t); const hasList=[...c.querySelectorAll('ul,ol')].some(l=>l.querySelectorAll(':scope>li').length>=3)||[...c.querySelectorAll('svg,img')].filter(vis).length>=3; const hasCta=!!c.querySelector('a,button'); return hasPrice&&hasList&&hasCta; }); if(cols.length<2) return false; const tops=cols.map(c=>Math.round(c.getBoundingClientRect().top)); return new Set(tops).size<=2; }).length;
blocks.pricingTable = pricingTables;
```

**Capture patch** — add a `walk()` branch tagging `kind:'container', role:'pricing-table'` with each column as `role:'price-column'` (price leaf + feature list node + button leaf). Reuse the `list` capture.

**Build patch** — emit per matrix: Pro `price-table` widget if available, else free composition (container + heading price + Icon List / `<ul>` + button); "featured" ribbon as an absolute badge widget. The clone columns then satisfy price+list+CTA → counted.

**Self-test note** — composes already-symmetric primitives (numeric regex, list-with-≥3-li, a/button, equal-width columns) → 1.0.

### B10 — image gallery (Tier 2, priority 10)

**Why blind** — no gallery signal (distinct from logo wall: galleries are larger photo grids/masonry, lightbox-enabled). Captured as image leaves or rasterized as a mockup; a gallery rebuilt as a single raster scores fine visually and is structurally invisible.

**Grader detector to add**:
```js
const galleries=[...document.querySelectorAll('body *')].filter(vis).filter((el)=>{ const imgs=[...el.querySelectorAll('img')].filter(vis).filter(m=>{const r=m.getBoundingClientRect(); return Math.max(r.width,r.height)>=120;}); if(imgs.length<4) return false; const tops=imgs.map(m=>Math.round(m.getBoundingClientRect().top/40)); const rows=new Set(tops).size; const txt=(el.innerText||'').replace(/\s/g,'').length; return rows>=2 && txt<200; }).length;
blocks.gallery = galleries;
```

**Capture patch** — add a `walk()` branch (before the mockup rasterizer claims it) tagging `kind:'container', role:'gallery'` with each photo as an `image` leaf.

**Build patch** — emit per matrix: native `image-gallery` widget, or a Grid container of image widgets (masonry → `autoFlow:dense` approximation). ≥4 large images in a multi-row grid → counted.

**Self-test note** — keys on `<img>` count, size threshold (≥120px vs logo wall's ≤120px height), multi-row tops, low text → 1.0; the size split keeps gallery and logo-wall detectors from double-firing.

### B11 — dropdown / mega-menu (Tier 3, priority 11)

**Why blind** — the grader counts `nav` as binary 0/1 (L62) but never checks whether the nav has dropdowns/submenus. A mega-menu rebuilt as a flat link row counts the same as the original. (capture already routes `aria-haspopup` away from accordion, acknowledging dropdowns exist — but nothing scores them.)

**Grader detector to add** (within nav, ARIA + nested-list):
```js
const ddTriggers=[...document.querySelectorAll('nav [aria-haspopup], header [aria-haspopup], nav [aria-expanded][aria-controls], header [aria-expanded][aria-controls]')].filter(vis).length;
const nestedSubmenus=[...document.querySelectorAll('nav li ul, header li ul, [role=menubar] [role=menu]')].length;
blocks.dropdown = (ddTriggers + nestedSubmenus) ? 1 : 0;  // binary: nav HAS dropdown structure or not
```

**Capture patch** — extend the nav capture (currently nav falls through generic recursion) to emit a `kind:'nav'` node flagged `hasDropdown:true` with submenu items harvested via `aria-controls`/nested `<ul>`.

**Build patch** — emit Pro `nav-menu` with submenu items (matrix dropdown row), so the clone exposes the same `aria-haspopup`/nested-`<ul>` structure. Free fallback (`:hover` dropdown via per-widget custom_css) still produces nested `<ul>` markup the detector counts.

**Self-test note** — keys on ARIA + nested `<ul>`; binary count is robust to differing submenu counts → 1.0.

### B12 — modal / dialog (Tier 3, priority 12)

**Why blind** — no modal signal. Modals are hidden by default so they never render in the capture scroll; their trigger button is captured but the dialog is dropped entirely.

**Grader detector to add** (presence of dialog markup, ignoring visibility):
```js
blocks.modal = [...document.querySelectorAll('dialog, [role=dialog], [role=alertdialog], [popover]')].length;
```

**Capture patch** — the visibility gate currently drops hidden modals. Add a dedicated pre-walk pass that finds `dialog,[role=dialog],[popover]` ignoring visibility, capturing each as `kind:'modal'` with its trigger reference + inner content leaves.

**Build patch** — emit per matrix: Pro Popup, or free native `<dialog>`/`popover` markup in an `html` widget (`popover` attribute + button `popovertarget`, kses-safe, no JS). The clone DOM then contains a `[popover]`/`<dialog>` element → counted.

**Self-test note** — counts dialog/popover markup by attribute, ignoring visibility → 1.0. Counting `<dialog>` AND `[popover]` AND `role=dialog` keeps it symmetric across modal mechanisms.

### B13 — search (Tier 3, priority 13)

**Why blind** — no search signal. A site search box is a `<form>` with a search input — the `form` detector would actually count it as a generic form, masking it; there's no distinct search type, so a search box rebuilt as a decorative text field is mis-credited.

**Grader detector to add** (role/type based):
```js
blocks.search = [...document.querySelectorAll('form[role=search], input[type=search], [role=search]')].filter(vis).length || ([...document.querySelectorAll('input')].filter(vis).some(i=>/search/i.test(i.getAttribute('aria-label')||i.placeholder||'')) ? 1 : 0);
```
Adjust the existing `form` detector to subtract search forms so the two don't double-count (keeps per-block signal clean and self-test exact).

**Capture patch** — extend the (Section-A) form capture to tag a `role=search` / `type=search` form as `kind:'search'` rather than generic form, harvesting placeholder + submit label.

**Build patch** — emit Pro `search-form` widget (matrix search row), or free `<form role="search"><input type="search">…</form>` in an `html` widget. The clone DOM then carries `role=search`/`type=search` → counted.

**Self-test note** — keys on `role=search` / `type=search` / search-labeled input → 1.0. Subtracting search from the generic form count on BOTH sides keeps the two detectors mutually exclusive and self-test exact.

### B14 — map embed (Tier 3, priority 14)

**Why blind** — the `video` detector matches iframes only for `youtube|vimeo|wistia|loom`; a Google-Maps iframe (or any `maps`/`mapbox` iframe) is not counted as anything. A map rebuilt as a static screenshot scores fine. Lowest frequency (contact pages), hence lowest priority.

**Grader detector to add** (iframe-host symmetric, disjoint from the video iframe detector):
```js
blocks.map = [...document.querySelectorAll('iframe')].filter(vis).filter(f=>/google\.[a-z.]+\/maps|maps\.google|mapbox|openstreetmap|maps\.googleapis/i.test(f.src||'')).length;
```

**Capture patch** — add an `iframe` branch in `leaf()`/`walk()` (iframes are currently invisible to the walk): emit `kind:'embed', embedType:'map'` carrying the iframe `src`, for matching hosts.

**Build patch** — emit Pro `google_maps` widget, or free `<iframe>` in an `html` widget (matrix map row — VERIFY iframe survives kses for the REST role). The clone DOM then has a maps-host iframe → counted.

**Self-test note** — matches iframe `src` host against map providers; a stable URL fact identical source-vs-source → 1.0. Disjoint host regex from the video detector means no double-count.

### Cross-cutting notes for whoever implements Section B

- **Composite reweight already assumed.** `grade-sections.mjs` already computes `structuralFidelity = correctly-typed blocks / source block-types present` and folds it at `0.3` into the composite (L119-124), matching the locked `0.4·visual + 0.3·editability + 0.3·structuralFidelity`. Every new `blocks.*` key plugs into that loop automatically with no scoring change — just add the detector inside the `capture()` page-evaluate `blocks` object (L55-63).
- **Tightest-match guard is mandatory for the container-grouping detectors** (card-grid, carousel, stat-row, logo-wall, testimonial, pricing, gallery): without it a section wrapper AND its inner row both count, inflating the source denominator and breaking source-vs-clone consistency the moment capture/build emit a slightly different nesting depth. Reuse the exact pattern in the accordion branch: `![...el.children].some(c => c.querySelectorAll(sel).length === all.length)`.
- **The self-test stays 1.0 for all of these by construction** because `--selftest` sets `cln = src` (L75): both `sB` and `cB` are the same object → `Math.min(cB[k],sB[k])/sB[k] === 1` for every key. The REAL symmetry risk is source-vs-CLONE: each detector above is written against generic DOM/geometry/ARIA/semantics that the build patch reproduces in the clone DOM, never against Elementor classes — that is what keeps the clone counted equal to the source.
- **Highest leverage = the container-grouping family (priorities 1, 3, 4, 5, 6, 9, 10).** They share one root cause: `build-absolute.mjs::flatten()` discards every container, so the clone has zero grouped boxes regardless of source. The single highest-impact build change is teaching `flatten()` to emit `role`-tagged containers as real Elementor `container`/Grid widgets — that one change unblocks card-grid, stat-row, logo-wall, testimonial, pricing, and gallery at once.

---

## Section C — Recommended round order

Sequenced by: (1) build-out blocks first (grader already sees them → pure two-file rounds, auto-pilotable through `evolve.workflow.js` unmodified, highest confidence), ordered by expected corpus impact; then (2) grader-blind extensions by priority (three-file rounds requiring a supervised grader edit + self-test re-validation); honoring curriculum tiers (static/composite before interactive; motion last). The container-grouping build change in Section B is called out as a force multiplier.

1. **video** (A1) — *files: capture-layout.mjs + build-absolute.mjs (ALREADY APPLIED in working tree — verify/confirm only).* 25 source-video misses across the corpus rebuilt as ZERO widgets; native youtube/vimeo/hosted widget ~98%, full editability, no visual cost. Highest single build-out impact. **Effect:** materially lifts `structuralFidelity` on every video-bearing page.

2. **table** (A2) — *files: capture-layout.mjs (insert after L242) + build-absolute.mjs (insert after L102).* Pricing/comparison/spec tables currently leak as a vertical ladder of text widgets; `<table>` in a text-editor widget ~90% visual, full structural credit (`cB.table` 0→1). Can flip `atTarget` on table-bearing pages. **Effect:** `structuralFidelity +1/types` per table page.

3. **form** (A3) — *files: capture-layout.mjs (insert after L223) + build-absolute.mjs (insert after L102).* The cardinal structural failure — a form rebuilt as text. Native Pro Form widget ~90%, full structural + editable. **Pro dependency** (confirmed on georges232); smoke-test PUT returns non-409/non-400 before merge. **Effect:** clears the automatic `atTarget` fail on form-bearing pages, recovers field labels as editable text.

4. **accordion** (A4) — *files: build-absolute.mjs ONLY (insert after L102; capture already present at L199-223).* Cheapest round — capture half done, build branch missing (accordion nodes silently dropped at L103). Free `<details>/<summary>` ~85%, full structural + editable. **Effect:** `blocksClone.accordion` 0→1 wherever the source trips the gate; near-zero risk.

5. **tabs** (A5) — *files: capture-layout.mjs (insert after L242) + build-absolute.mjs (insert after L102).* Interactive (later in the tier order than the static/composite blocks above). NATIVE-HTML `<details name>`-radio `html`-widget fallback carrying `role=tablist`/`role=tab` (NOT the Pro `tabs` widgetType — would render empty without Pro) ~85%, zero-JS switching. Benign clone-only `accordion` side-count (not scored). **Effect:** flips `tabs` 0→full credit + recovers tab-panel text.

— end of Section-A build-out blocks; the grader now sees everything it detects rebuilt natively —

6. **card-grid / card** (B1, priority 1) — *THREE-FILE: grade-sections.mjs (add `blocks.cardGrid`/`blocks.card`) + capture-layout.mjs (role-tag containers) + build-absolute.mjs (teach `flatten()` to emit `container`/Grid widgets).* **The force-multiplier round** — this single build change (containers survive `flatten()`) simultaneously unblocks B1, B4, B5, B6, B9, B10. Do this FIRST among the blind blocks; addresses the #1 structural-fidelity failure (cards rebuilt as loose leaves). Re-validate self-test = 1.0 before gating.

7. **icon / svg** (B2, priority 2) — *THREE-FILE, but capture/build largely present.* Add `blocks.icon` (svg+img, 14–96px square-ish, non-nav), align `doSvg` SKIP floor (≤22px) to the grader floor (14px). Highest-frequency Tier-1 atom after text. Mostly a detector + threshold-alignment round.

8. **stat / counter row** (B4, priority 4) — *THREE-FILE; build largely free once B1 lands.* Add `blocks.statRow`; flex-row container of stat sub-containers, native ~90%. Rides the B1 container change.

9. **logo wall** (B5, priority 5) — *THREE-FILE.* Add `blocks.logoWall`; STOP rasterizing logo walls in capture (currently baked by the mockup rasterizer), emit per-logo image widgets. Rides B1.

10. **testimonial** (B6, priority 6) — *THREE-FILE.* Add `blocks.testimonial`; container with `<blockquote>` + avatar + attribution. Rides B1.

11. **blockquote** (B7, priority 7) — *THREE-FILE; cheap.* Add `blocks.blockquote` (tag count); emit `text-editor` `<blockquote>` (~95%). Tier-1 atom.

12. **divider** (B8, priority 8) — *THREE-FILE; cheap.* Add `blocks.divider` (`<hr>` + thin painted divs); native `divider` widget (control names `color`/`weight`). Restores vertical rhythm.

13. **pricing table** (B9, priority 9) — *THREE-FILE; composite, rides B1.* Add `blocks.pricingTable` (price + ≥3-item list + CTA columns); Pro `price-table` or free composition. High business value.

14. **image gallery** (B10, priority 10) — *THREE-FILE; rides B1.* Add `blocks.gallery` (≥4 images ≥120px, multi-row); native `image-gallery` or Grid of images. Size-split from logo wall avoids double-fire.

— interactive Tier-3 blind blocks (after static/composite) —

15. **dropdown / mega-menu** (B11, priority 11) — *THREE-FILE.* Add `blocks.dropdown` (ARIA haspopup/expanded + nested `<ul>`, binary); Pro `nav-menu` with submenus or `:hover` custom_css fallback. Upgrades the binary `nav` signal.

16. **modal / dialog** (B12, priority 12) — *THREE-FILE.* Add `blocks.modal` (dialog/popover by attribute, ignore visibility); pre-walk pass to capture hidden modals; Pro Popup or free `<dialog>`/`[popover]` html widget.

17. **search** (B13, priority 13) — *THREE-FILE; must also subtract search from the `form` count on BOTH sides.* Add `blocks.search` (role=search/type=search); Pro `search-form` or free `<form role=search>`. Keep the two detectors mutually exclusive for an exact self-test.

18. **map embed** (B14, priority 14) — *THREE-FILE; lowest frequency.* Add `blocks.map` (maps-host iframe, disjoint regex from video); Pro `google_maps` or free `<iframe>` html widget. Contact pages only.

— **motion last** (per curriculum): scroll-triggered/parallax/count-up animation recovery is explicitly deferred behind all structural rounds; the Elementor V3 expressive ceiling (~90% on animated sources, per the MEMORY clone-pipeline note) means motion is a separate program (Pro Motion Effects / custom_css injection), not a structural-round target.

---

**Summary**

- **5 build-out blocks** (Section A — grader already detects): video, table, form, accordion, tabs. Two-file rounds (accordion is build-only; capture already present). video is already applied in the working tree.
- **14 grader-blind blocks** (Section B — detector missing): card-grid, icon, carousel, stat-row, logo-wall, testimonial, blockquote, divider, pricing-table, gallery, dropdown, modal, search, map. Each is a THREE-FILE round requiring a grade-sections.mjs detector edit + self-test = 1.0 re-validation before the corpus gate keeps anything.
- **Top 3 recommended next rounds:** (1) **table** — highest-impact remaining two-file build-out, flips `atTarget` on data-table pages; (2) **accordion** — cheapest possible win (build branch only; capture done; nodes currently silent-dropped at L103); (3) **card-grid/card (B1)** — the force-multiplier: teaching `flatten()` to keep `role`-tagged containers unblocks six blind blocks (stat-row, logo-wall, testimonial, pricing, gallery) at once and fixes the #1 structural failure.
- Proven template throughout: round-3 `structural:list` recipe (+0.042 corpus mean, self-test PASS, no regression).
- File: `/Users/ckrohg/Documents/Claude/tenet-elementor/knowledge/STRUCTURAL_ROUND_PLAYBOOK.md`
