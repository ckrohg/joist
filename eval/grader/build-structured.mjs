#!/usr/bin/env node
/**
 * @purpose The REFLOW-AND-editable path. Where build-absolute.mjs pins every leaf to its captured (x,y,w,h)
 * — pixel-faithful at 1440 but ZERO reflow and a guaranteed desktop-pixel horizontal floor — build-structured.mjs
 * drives the build from segment.mjs's STRUCTURAL band tree ({nav, sections[], footer}) and emits a NATIVE
 * Elementor FLEX-CONTAINER tree whose only invariant is: NO HORIZONTAL SCROLL. Every container is width:100%
 * with a max-width on the boxed content; columns inside a section are flex children with a PERCENT flex-basis
 * (column width / section width) + min-width:0 so they shrink; no widget carries a fixed-px width
 * (_element_custom_width) and nothing is position:absolute. The page therefore reflows at any viewport and
 * scrollWidth never exceeds the viewport.
 *
 * ARCHITECTURE (the whole point):
 *   • Each segment SECTION → a full-width Elementor container (elType container, content_width=full,
 *     flex-direction=column, width 100%) carrying the section bg + min_height from its bbox + vertical padding.
 *   • INSIDE each section the members are clustered by X-position into COLUMNS (gap-split on x). The columns are
 *     emitted as an inner flex-ROW container; each column is a flex child with flex-basis = (colW/sectionW)% and
 *     min-width:0. Each member widget (heading/text/button/image/list/...) is placed into its column by Y-order.
 *   • NAV → a full-width flex ROW: logo (brand/wordmark image or first nav text) left + nav links center/right +
 *     CTA right. Pro → Elementor nav-menu widget; no-Pro → a flex row of per-link text-editor widgets.
 *   • FOOTER → a full-width container with the footer members clustered into columns (same x-cluster machinery).
 *
 * REUSE (read, not rewritten): the widget-emission shapes (heading/text/button/image/svg/mockup/code/video/list/
 * tabs/accordion), the global-token Kit clustering + __globals__ refs + kit PUT, the asset upload+cache, the font
 * registration, and the joist page PUT machinery are PORTED from build-absolute.mjs. The NEW logic is ONLY the
 * structural driver (segment-tree → section/column containers) and the INLINE-only widget styling (no absPos,
 * no fixed-px width) — flex layout positions every leaf, the parent container is never absolute.
 *
 * RE-JOIN: segment.mjs emits THIN member refs (kind, box, text, tag, href) — it drops typo/paint/src/items the
 * widget functions need for fidelity. So we build a geometry index of the FULL capture leaves and re-join each
 * thin member back to its full leaf by exact (rounded) box geometry. The full leaf carries typo/paint/src/raster/
 * items so the ported widget functions render with full fidelity.
 *
 * CLI: node build-structured.mjs --layout <capture.json> --page <id> [--publish]
 *        (internally runs segment.mjs on the capture; or accept a precomputed --seg <segjson>)
 *      node build-structured.mjs --layout <capture.json> --seg <segjson> --selftest   (DRY tree-dump + invariants)
 *      node build-structured.mjs --layout <capture.json> --dry                          (DRY tree-dump only)
 * Env: JOIST_BASE (default georges232.sg-host.com), JOIST_AUTH_B64 (source /tmp/joist-auth.env).
 *      STRUCT_NO_GLOBALS=1 → inline-only (no kit write); ABS_GLOBAL_TYPO=1 → bind typography globals too.
 */
import fs from 'fs';
import { segment } from './segment.mjs';
import { buildSpec } from './section-spec.mjs';
import { emitDesignMd } from './designmd.mjs';

// SECTION-SPEC layer (default OFF ⇒ byte-identical build). When JOIST_SECTIONSPEC=1, the validated per-section
// spec (role/archetype) drives the semantic section title + the hero/CTA-styling decision instead of the crude
// y<700 heuristic. SPEC is assigned in main() and read by buildSection; null ⇒ legacy behavior unchanged.
const USE_SPEC = process.env.JOIST_SECTIONSPEC === '1';
let SPEC = null;

// STRUCT_SEMANTIC (default ON since promotion — corrected 2026-06-09; opt out STRUCT_NO_SEMANTIC=1 or STRUCT_LEGACY=1 ⇒ byte-identical legacy build). When on, each TOP-LEVEL structural container
// carries an Elementor HTML-Tag (`html_tag`) set from its STRUCTURAL ROLE so the page renders real HTML5 landmarks:
// the nav band → <nav>, each per-section full-width container (#sec-N) → <section>, the footer container → <footer>,
// and the page ROOT container → <main>. CONFIRMED on this 4.0.9 stack (page 12446 live probe): `html_tag` survives
// the Joist save + kses intact and Elementor renders the real semantic tag on the container element (e.g.
// <nav class="e-con … " id="clone-header">). Inner/boxed wrappers + widgets are UNTOUCHED (stay div/default). The
// key is additive: with STRUCT_NO_SEMANTIC=1 (or STRUCT_LEGACY=1) no html_tag is ever emitted ⇒ byte-identical OFF.
const SEMANTIC = process.env.STRUCT_LEGACY !== '1' && process.env.STRUCT_NO_SEMANTIC !== '1'; // default ON. STRUCT_LEGACY=1 or STRUCT_NO_SEMANTIC=1 ⇒ byte-identical legacy path. Semantic HTML5 landmarks (nav/section/footer/main) for SEO/a11y/round-trip editability.
// semTag(role) → { html_tag } when SEMANTIC is on, else {} (so a `...semTag(...)` spread is a no-op when OFF).
const semTag = (role) => SEMANTIC ? { html_tag: role } : {};

// ---------------------------------------------------------------------------
// CLI + env (mirror build-absolute.mjs:12-16; --dry/--selftest added for structural sanity)
// ---------------------------------------------------------------------------
const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const DRY = process.argv.includes('--dry');
const SELFTEST = process.argv.includes('--selftest');
const PUBLISH = process.argv.includes('--publish');
const base = process.env.JOIST_BASE || 'https://georges232.sg-host.com';
const b64 = process.env.JOIST_AUTH_B64;
const layoutPath = arg('layout'), pageId = arg('page'), segPath = arg('seg');
// DRY / selftest only need --layout; a real write needs --layout + --page + auth.
const NEEDS_WRITE = !DRY && !SELFTEST;
if (!layoutPath || (NEEDS_WRITE && (!b64 || !pageId))) { console.error('need --layout --page + JOIST_AUTH_B64 (or --layout --dry / --selftest)'); process.exit(2); }
const L = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
const VW = L.vw || 1440;
const pageH = L.pageH || 6000;
// content max-width: the captured content column (widest section bbox.w, ~1280 boxed) so boxed sections center.
const PAGE_DEFAULT = (L.root && L.root.bgSampled) || (L.root && L.root.background && L.root.background.color) || L.pageBg || 'rgb(255, 255, 255)';

// ---------------------------------------------------------------------------
// STRUCT_MOTION — HOVER REPRODUCTION (INCH 1 of the motion loop; default OFF, explicit opt-in).
// ---------------------------------------------------------------------------
// The motion grader (grade-motion.mjs) can SEE hover: it forces :hover on each interactive and diffs computed
// style. A hover transition manifests ONLY on :hover ⇒ the DEFAULT/static render is pixel-identical ⇒ reproducing
// hover CANNOT regress the visual/struct/responsive composite, yet it DIRECTLY climbs the motion score.
//
// GATING (the recipe stays OFF even on the new default — it REQUIRES source motion signals as input, so it can
// never "house-style" motion the source lacks): MOTION is on ONLY when STRUCT_MOTION=1 (explicit) AND not under
// the legacy revert AND not explicitly disabled. The actual hover emission is further gated on a signals file
// (STRUCT_MOTION_SIGNALS=/path, a grade-motion --dump JSON) whose hoverProfile.hasHover is true. FAITHFUL: a
// static source (no hover) ⇒ MOTION_HOVER false ⇒ NOTHING is attached ⇒ byte-identical to motion-off.
const MOTION = process.env.STRUCT_LEGACY !== '1' && process.env.STRUCT_NO_MOTION !== '1' && process.env.STRUCT_MOTION === '1';
let HOVER_PROFILE = null;            // the source's distilled hover vocabulary (from the --dump signals file)
if (MOTION) {
  const sigPath = process.env.STRUCT_MOTION_SIGNALS;
  if (sigPath) {
    try {
      const sig = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
      const hp = sig.hoverProfile || (sig.raw && sig.raw.hover ? null : null);
      if (hp && hp.hasHover && hp.withEffect > 0) HOVER_PROFILE = hp;
    } catch (e) { console.error(`[STRUCT_MOTION] could not read signals ${sigPath}: ${e.message}`); }
  } else {
    console.error('[STRUCT_MOTION] STRUCT_MOTION=1 but no STRUCT_MOTION_SIGNALS=<dump.json> — attaching NO motion (a signals file is required so we never house-style motion the source lacks).');
  }
}
// MOTION_HOVER = motion is on AND the source actually hovers. Drives every hover attachment below.
const MOTION_HOVER = !!(MOTION && HOVER_PROFILE);
// color-string passthrough — grade-motion records delta values as computed-style color strings; Elementor color
// controls + every modern browser accept ANY valid CSS color value verbatim (and they survive kses on this stack —
// verified live for oklch()/lab()). So we pass the source color string THROUGH unchanged. Beyond legacy rgb()/rgba()/#hex
// we now also accept the modern color functions a 2026 site emits (tailwind→lab(), basecamp→oklch()): lab() / lch() /
// oklab() / oklch() / color(...) / hsl()/hsla(). LENIENT start-match (mirrors the prior rgb behavior, which also
// accepted multi-token border shorthands like `rgb(..) rgb(..) rgba(..)`). Returns null for an absent/empty/unparseable
// value so we never emit an empty or garbage key. (Pass-through; an rgb()-convert fallback is added below ONLY if the
// live kses gate ever shows a modern function stripped — verified NOT stripped, so pass-through stands.)
const motColor = (v) => (v && typeof v === 'string' && /^(#[0-9a-f]{3,8}|(rgba?|hsla?|lab|lch|oklab|oklch|color)\s*\()/i.test(v.trim())) ? v.trim() : null;
// the source button-hover delta (to-values) + duration, distilled once. Used by the native-button emitters.
const BTN_HOVER = (() => {
  if (!MOTION_HOVER) return null;
  const k = HOVER_PROFILE.kinds && HOVER_PROFILE.kinds.button;
  if (!k || !k.count) return null;
  const d = k.delta || {};
  const out = {};
  if (d.color && motColor(d.color.to)) out.hover_color = motColor(d.color.to);
  if (d.backgroundColor && motColor(d.backgroundColor.to)) out.button_background_hover_color = motColor(d.backgroundColor.to);
  if (d.borderColor && motColor(d.borderColor.to)) out.button_hover_border_color = motColor(d.borderColor.to);
  out.durMs = k.durMs || HOVER_PROFILE.durMs || 200;
  // only meaningful if at least one color delta is reproducible
  return (out.hover_color || out.button_background_hover_color || out.button_hover_border_color) ? out : null;
})();
// native-button hover settings spread — verified kses-safe keys on this 4.0.9 stack (CASE_STUDY: hover_color +
// button_background_hover_color persist; CLONE_CAPABILITY_SPEC: + button_hover_border_color + transition_duration).
// Returns {} when motion is off / source has no button hover ⇒ a `...btnHoverSettings()` spread is a no-op.
const MOTIONSTATS = { buttons: 0, cards: 0 };
function btnHoverSettings() {
  if (!BTN_HOVER) return {};
  const s = {};
  if (BTN_HOVER.hover_color) s.hover_color = BTN_HOVER.hover_color;
  if (BTN_HOVER.button_background_hover_color) s.button_background_hover_color = BTN_HOVER.button_background_hover_color;
  if (BTN_HOVER.button_hover_border_color) s.button_hover_border_color = BTN_HOVER.button_hover_border_color;
  s.button_hover_transition_duration = { unit: 's', size: +(((BTN_HOVER.durMs || 200) / 1000).toFixed(3)) };
  MOTIONSTATS.buttons++;
  return s;
}
// the source card-hover delta (to-values) + props + duration. Drives the scoped kses-safe `#cardid:hover{…}` CSS.
const CARD_HOVER = (() => {
  if (!MOTION_HOVER) return null;
  const k = HOVER_PROFILE.kinds && HOVER_PROFILE.kinds.card;
  if (!k || !k.count) return null;
  const d = k.delta || {};
  const decls = [];
  if (d.borderColor && motColor(d.borderColor.to)) decls.push(`border-color:${motColor(d.borderColor.to)}`);
  if (d.backgroundColor && motColor(d.backgroundColor.to)) decls.push(`background-color:${motColor(d.backgroundColor.to)}`);
  if (d.color && motColor(d.color.to)) decls.push(`color:${motColor(d.color.to)}`);
  if (d.boxShadow && d.boxShadow.to && d.boxShadow.to !== 'none') decls.push(`box-shadow:${d.boxShadow.to}`);
  if (!decls.length) return null;
  const props = (k.props || []).map((p) => ({ transform: 'transform', opacity: 'opacity', backgroundColor: 'background-color', color: 'color', boxShadow: 'box-shadow', borderColor: 'border-color', filter: 'filter' }[p] || p));
  return { decls, props: props.length ? props : ['border-color'], durMs: k.durMs || HOVER_PROFILE.durMs || 150 };
})();
const MOTIONCSS = []; // scoped kses-safe `#cardid{transition:…} #cardid:hover{…}` rules, injected page-wide via custom_css.
// CARD-LIKE container id matcher — the cardwall/bento card ids the grid machinery stamps (`cardwall-N-cI`,
// `bento-N-K`) and any id literally containing `card`. NOT sections/nav/footer/grids (those aren't card-like).
const CARD_ID_RX = /(^cardwall-\d+-c\d+$)|(^bento-)|card/i;
// Walk the tree; for each card-like container (_element_id matches CARD_ID_RX) emit a scoped, kses-safe hover rule
// reproducing the source card hover vocabulary. No-op when CARD_HOVER is null (motion off / no source card hover).
function emitCardHoverCss(node) {
  if (!CARD_HOVER) return;
  const s = node && node.settings;
  const eid = s && s._element_id;
  if (eid && node.elType === 'container' && CARD_ID_RX.test(eid)) {
    const trans = CARD_HOVER.props.map((p) => `${p} ${(CARD_HOVER.durMs / 1000).toFixed(3)}s ease`).join(',');
    MOTIONCSS.push(`#${eid}{transition:${trans}}#${eid}:hover{${CARD_HOVER.decls.join(';')}}`);
    MOTIONSTATS.cards++;
  }
  if (node && Array.isArray(node.elements)) node.elements.forEach(emitCardHoverCss);
}

// ---------------------------------------------------------------------------
// STRUCT_MOTION_REVEAL — SCROLL-ENTRANCE REPRODUCTION (INCH 2 of the motion loop; default OFF, explicit opt-in).
// ---------------------------------------------------------------------------
// The motion grader (grade-motion.mjs --dump) emits a REVEAL PROFILE: whether the source reveals top-level sections
// on scroll, the dominant entrance KIND (fade/fadeInUp/fadeInDown/zoomIn), the typical duration, and the marker/IO/
// stuck-invisible evidence. When the source reveals, we attach Elementor's NATIVE entrance animation to each TOP-LEVEL
// SECTION container: the `animation` setting (e.g. "fadeInUp"), `animation_duration` (slow/normal/fast — Elementor's
// preset bucket) + `_animation_delay`. NATIVE ONLY — NO custom JS, NO GSAP, NO fixed-px, NO position, NO h-scroll.
//
// THE HARD PART: Elementor entrance animations set the element to opacity:0 + class `elementor-invisible` until
// elementor-frontend.js reveals it on scroll. So if a capture does NOT scroll-reveal + finish the animation, the
// section stays invisible → the static composite regresses. The LIVE composite capture (capture-layout.mjs) already
// has the recipe-#96 reveal-pass: it step-scrolls to TRIGGER the IntersectionObserver reveal, then getAnimations()+
// finish() LANDS every entrance animation at opacity:1 / final transform, then scrolls back to top. So the section
// content is captured VISIBLE at rest. The gate-3 composite no-regression test PROVES this empirically.
//
// GATING (mirrors STRUCT_MOTION exactly): on ONLY when STRUCT_MOTION_REVEAL=1 (explicit) AND not legacy AND not
// disabled, AND a signals file (STRUCT_MOTION_SIGNALS, a grade-motion --dump JSON) whose revealProfile.hasReveal is
// true. FAITHFUL: a static source (no reveal) ⇒ MOTION_REVEAL_ON false ⇒ NOTHING attached ⇒ byte-identical to off.
const MOTION_REVEAL = process.env.STRUCT_LEGACY !== '1' && process.env.STRUCT_NO_MOTION_REVEAL !== '1' && process.env.STRUCT_MOTION_REVEAL === '1';
let REVEAL_PROFILE = null;           // the source's distilled scroll-entrance vocabulary (from the --dump signals file)
if (MOTION_REVEAL) {
  const sigPath = process.env.STRUCT_MOTION_SIGNALS;
  if (sigPath) {
    try {
      const sig = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
      const rp = sig.revealProfile || null;
      if (rp && rp.hasReveal) REVEAL_PROFILE = rp;
    } catch (e) { console.error(`[STRUCT_MOTION_REVEAL] could not read signals ${sigPath}: ${e.message}`); }
  } else {
    console.error('[STRUCT_MOTION_REVEAL] STRUCT_MOTION_REVEAL=1 but no STRUCT_MOTION_SIGNALS=<dump.json> — attaching NO entrance animation (a signals file is required so we never house-style motion the source lacks).');
  }
}
// MOTION_REVEAL_ON = the recipe is on AND the source actually reveals. Drives every entrance attachment below.
const MOTION_REVEAL_ON = !!(MOTION_REVEAL && REVEAL_PROFILE);
// map the captured reveal KIND → the Elementor `animation` key (Elementor ships fadeIn/fadeInUp/fadeInDown/zoomIn/
// slideInUp natively under _animation). The profile kinds are already named to match Elementor's vocabulary.
const REVEAL_ANIM = (() => {
  if (!MOTION_REVEAL_ON) return null;
  const k = REVEAL_PROFILE.dominantKind || 'fadeInUp';
  const ALLOWED = new Set(['fadeIn', 'fadeInUp', 'fadeInDown', 'fadeInLeft', 'fadeInRight', 'zoomIn', 'slideInUp']);
  return ALLOWED.has(k) ? k : 'fadeInUp';
})();
// Elementor's animation_duration is a PRESET bucket (slow≈2s / ''≈normal 1.2s / fast≈800ms), not a free ms value.
// Map the profile's durMs onto the nearest bucket (faithful: a ~600ms source tween → 'fast', ~800 → 'fast', longer
// → normal/slow). Returns '' for the normal bucket (Elementor's default), which is a valid persisted value.
const REVEAL_DUR_BUCKET = (() => {
  if (!MOTION_REVEAL_ON) return null;
  const ms = REVEAL_PROFILE.durMs || 800;
  if (ms <= 850) return 'fast';
  if (ms >= 1600) return 'slow';
  return ''; // normal
})();
const MOTION_REVEAL_STATS = { sections: 0 };
// sectionRevealSettings(idx) → native Elementor entrance-animation settings for a TOP-LEVEL section container, or {}
// (a no-op spread) when the recipe is off / source has no reveal. Elementor reads `animation` (the entrance class),
// `animation_duration` (preset bucket) and `_animation_delay` (ms) under the Motion-Effects "Entrance Animation"
// group; these survive the Joist save + kses on this 4.0.9 stack (plain string / int values, no markup). The element
// renders with `.elementor-invisible` until scrolled into view, then plays the entrance — exactly the source behavior.
// A small per-section stagger (idx·60ms, capped) reproduces the natural cascade of AOS/Framer section reveals.
function sectionRevealSettings(idx) {
  if (!MOTION_REVEAL_ON || !REVEAL_ANIM) return {};
  MOTION_REVEAL_STATS.sections++;
  const delay = Math.min((idx || 0) * 60, 300);
  const s = { animation: REVEAL_ANIM };
  if (REVEAL_DUR_BUCKET) s.animation_duration = REVEAL_DUR_BUCKET; // omit for the normal bucket (Elementor default)
  if (delay > 0) s._animation_delay = delay;
  return s;
}

// ---------------------------------------------------------------------------
// STRUCT_MOTION_MARQUEE — CONTINUOUS-LOOP (logo/customer strip) REPRODUCTION (INCH 3; default OFF, explicit opt-in).
// ---------------------------------------------------------------------------
// The motion grader (grade-motion.mjs --dump) emits a MARQUEE PROFILE: the source's infinite-iteration horizontal
// loops (supabase = a customer/logo strip that translateX-loops forever), each with its page-Y band, track width,
// clip width, member count, direction and duration. This is a distinct motion class the hover + reveal channels are
// blind to (it never collapses to rest and isn't pointer-triggered). Reproducing it climbs grade-motion's
// `marquee/loop-animation` sub-metric (animInfinite: 0 → present) — that metric is purely a COUNT of infinite
// animations, so any faithfully-emitted infinite CSS loop registers.
//
// THE HARD PART (the v1 blocker): a marquee needs a 2× member set so translateX(-50%) loops seamlessly. v1 doubled
// the members INLINE — and the structured builder's clusterRows/rowColumns then re-clustered the doubled members
// into EXTRA ROWS, inflating section height (hRatio 1.09→1.25 ⇒ visual −0.087). THE FIX (height-neutral): the
// marquee TRACK is a SINGLE non-wrapping horizontal row (flex-wrap:nowrap; width:max-content; white-space:nowrap),
// wrapped in a CLIP (overflow:hidden; max-width:100%). The 2× duplicate is emitted as DIRECT children of the track
// (NEVER re-fed to clusterRows/rowColumns), so both sets sit in ONE row at the natural single-row height and the
// duplicate extends SIDEWAYS, clipped — adding ZERO height. NATIVE ONLY: scoped custom_css @keyframes + animation
// (the same kses-safe channel that already carries card-hover transitions). NO JS, NO GSAP, NO position:absolute,
// NO bare fixed-px wrapper.
//
// GATING (mirrors STRUCT_MOTION/REVEAL exactly): on ONLY when STRUCT_MOTION_MARQUEE=1 (explicit) AND not legacy AND
// not disabled, AND a signals file (STRUCT_MOTION_SIGNALS, a grade-motion --dump JSON) whose marqueeProfile.hasMarquee
// is true. FAITHFUL: a static source (no marquee) ⇒ MARQUEE_ON false ⇒ NOTHING attached ⇒ byte-identical to off.
const MOTION_MARQUEE = process.env.STRUCT_LEGACY !== '1' && process.env.STRUCT_NO_MOTION_MARQUEE !== '1' && process.env.STRUCT_MOTION_MARQUEE === '1';
let MARQUEE_PROFILE = null;          // the source's distilled continuous-loop vocabulary (from the --dump signals file)
if (MOTION_MARQUEE) {
  const sigPath = process.env.STRUCT_MOTION_SIGNALS;
  if (sigPath) {
    try {
      const sig = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
      const mp = sig.marqueeProfile || null;
      if (mp && mp.hasMarquee && Array.isArray(mp.marquees) && mp.marquees.length) MARQUEE_PROFILE = mp;
    } catch (e) { console.error(`[STRUCT_MOTION_MARQUEE] could not read signals ${sigPath}: ${e.message}`); }
  } else {
    console.error('[STRUCT_MOTION_MARQUEE] STRUCT_MOTION_MARQUEE=1 but no STRUCT_MOTION_SIGNALS=<dump.json> — attaching NO marquee (a signals file is required so we never house-style motion the source lacks).');
  }
}
// MARQUEE_ON = the recipe is on AND the source actually has a continuous loop. Drives every marquee attachment below.
const MARQUEE_ON = !!(MOTION_MARQUEE && MARQUEE_PROFILE);
const MARQUEECSS = [];               // scoped kses-safe `@keyframes joist-mq-N{…}` + `#joist-mq-clip-N{…}` + `#joist-mq-track-N{…}` rules, injected page-wide via custom_css.
const MARQUEESTATS = { tracks: 0 };
let _mqId = 0; const mqId = () => (++_mqId);
// marqueeMatchRow(row) → the matching marquee descriptor from the profile, or null. A row is a marquee iff (a) its
// vertical center is within ~half-a-band of a captured marquee's yBand AND (b) the captured marquee clipOverflows
// (the track is genuinely wider than its clip — a real horizontal loop, not a static centered strip). yBand is in
// the same page-Y space as the captured member boxes, so the row's member-y matches the profile yBand directly.
function marqueeMatchRow(row) {
  if (!MARQUEE_ON || !row || !row.members || !row.members.length) return null;
  const cy = (row.top + row.bottom) / 2;
  let best = null, bestD = Infinity;
  for (const m of MARQUEE_PROFILE.marquees) {
    if (!m || !m.clipOverflows) continue;                      // only genuinely-overflowing loops are real marquees
    const tol = Math.max(120, (m.trackH || 48) * 1.5);          // a band-height-scaled match window
    const d = Math.abs((m.yBand || 0) - cy);
    if (d <= tol && d < bestD) { best = m; bestD = d; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Shared scalar/string helpers (verbatim from build-absolute.mjs / build-flow.mjs)
// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const px = (s) => { const m = String(s || '').match(/(-?\d+(?:\.\d+)?)px/); return m ? +m[1] : null; };
const stripEmoji = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n) => Math.round(n || 0);
const median = (arr) => { const a = (arr || []).filter((v) => v != null && !Number.isNaN(v)).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
const opaque = (c) => c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent' && !/,\s*0\)\s*$/.test(c);
const container = (settings, elements = []) => ({ elType: 'container', settings, elements });
// WRAP — guarantee no single text leaf can exceed the viewport (long URLs/code/hashes). build-flow.mjs:211
const WRAP = 'overflow-wrap:anywhere;word-break:break-word;max-width:100%';
const styleAttr = (css) => css ? ` style="${css}"` : '';

// ---------------------------------------------------------------------------
// Fonts (verbatim build-absolute.mjs:22-26)
// ---------------------------------------------------------------------------
const GOOGLE = [[/ibm.?plex.?mono|plex.?mono/, 'IBM Plex Mono'], [/source.?code/, 'Source Code Pro'], [/jetbrains/, 'JetBrains Mono'], [/space.?mono/, 'Space Mono'], [/fira.?code/, 'Fira Code'], [/inter/, 'Inter'], [/poppins/, 'Poppins'], [/montserrat/, 'Montserrat'], [/open.?sans/, 'Open Sans'], [/^lato|[^a-z]lato/, 'Lato'], [/nunito.?sans/, 'Nunito Sans'], [/nunito/, 'Nunito'], [/work.?sans/, 'Work Sans'], [/dm.?sans/, 'DM Sans'], [/space.?grotesk/, 'Space Grotesk'], [/manrope/, 'Manrope'], [/raleway/, 'Raleway'], [/rubik/, 'Rubik'], [/mulish|muli/, 'Mulish'], [/playfair/, 'Playfair Display'], [/merriweather/, 'Merriweather'], [/roboto.?slab/, 'Roboto Slab'], [/roboto.?mono/, 'Roboto Mono'], [/roboto/, 'Roboto']];
const gFont = (fam) => { const b = (fam || '').toLowerCase(); if (!b) return null; for (const [re, name] of GOOGLE) if (re.test(b)) return name; if (/tiempos|times|georgia|garamond|serif/.test(b)) return 'Georgia'; if (/mono|code|courier|consol/.test(b)) return 'Roboto Mono'; return 'Inter'; };
let REGFONTS = {}; try { REGFONTS = JSON.parse(fs.readFileSync('/tmp/joist-fonts.json', 'utf8')); } catch {}
const usedFonts = new Set();

// ---------------------------------------------------------------------------
// Image upload + cache (verbatim build-absolute.mjs:113-117)
// ---------------------------------------------------------------------------
const IMG_CACHE = '/tmp/joist-imgcache.json'; let imgMap = {}; try { imgMap = JSON.parse(fs.readFileSync(IMG_CACHE, 'utf8')); } catch {}
const mimeOf = (u) => { const e = (u.split('?')[0].split('.').pop() || '').toLowerCase(); return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' })[e] || 'image/jpeg'; };
async function uploadImage(url) { if (!url || url.startsWith('data:')) return; if (imgMap[url] && imgMap[url].full) return; try { let buf; if (url.startsWith('/')) buf = fs.readFileSync(url); else { const r = await fetch(url); if (!r.ok) { imgMap[url] = { full: url }; return; } buf = Buffer.from(await r.arrayBuffer()); } const name = (url.split('/').pop().split('?')[0] || 'img') + (/\.[a-z0-9]+$/i.test(url.split('?')[0]) ? '' : '.jpg'); const up = await fetch(base + '/wp-json/wp/v2/media', { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': mimeOf(url), 'Content-Disposition': `attachment; filename="${name}"` }, body: buf }); const j = await up.json(); imgMap[url] = (up.ok && j.source_url) ? { id: j.id, full: j.source_url } : { full: url }; } catch { imgMap[url] = { full: url }; } }
const localSrc = (s) => (imgMap[s] && imgMap[s].full) || s;
const localId = (s) => imgMap[s] && imgMap[s].id;

// ---------------------------------------------------------------------------
// Color helpers (CIEDE2000) — verbatim build-absolute.mjs:470-474 (needed for global-token clustering + bg gates)
// ---------------------------------------------------------------------------
function parseRgb(s) { const m = String(s || '').match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/); return m ? [+m[1], +m[2], +m[3]] : null; }
function rgb2lab(rgb) { let [r, g, b] = rgb.map((v) => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; }); let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = (r * 0.2126 + g * 0.7152 + b * 0.0722), z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883; [x, y, z] = [x, y, z].map((v) => v > 0.008856 ? Math.cbrt(v) : (7.787 * v + 16 / 116)); return [116 * y - 16, 500 * (x - y), 200 * (y - z)]; }
function deltaE(c1, c2) { const p1 = parseRgb(c1), p2 = parseRgb(c2); if (!p1 || !p2) return 0; const A = rgb2lab(p1), B = rgb2lab(p2); const L1 = A[0], a1 = A[1], b1 = A[2], L2 = B[0], a2 = B[1], b2 = B[2]; const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2); const avgC = (C1 + C2) / 2; const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7)))); const a1p = a1 * (1 + G), a2p = a2 * (1 + G); const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2); const avgCp = (C1p + C2p) / 2; let h1p = Math.atan2(b1, a1p) * 180 / Math.PI; if (h1p < 0) h1p += 360; let h2p = Math.atan2(b2, a2p) * 180 / Math.PI; if (h2p < 0) h2p += 360; const dLp = L2 - L1, dCp = C2p - C1p; let dhp = 0; if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; } const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360); const avgLp = (L1 + L2) / 2; let avghp = h1p + h2p; if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) avghp += (avghp < 360 ? 360 : -360); avghp /= 2; } const T = 1 - 0.17 * Math.cos((avghp - 30) * Math.PI / 180) + 0.24 * Math.cos((2 * avghp) * Math.PI / 180) + 0.32 * Math.cos((3 * avghp + 6) * Math.PI / 180) - 0.20 * Math.cos((4 * avghp - 63) * Math.PI / 180); const dTheta = 30 * Math.exp(-Math.pow((avghp - 275) / 25, 2)); const Rc = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7))); const Sl = 1 + (0.015 * Math.pow(avgLp - 50, 2)) / Math.sqrt(20 + Math.pow(avgLp - 50, 2)); const Sc = 1 + 0.045 * avgCp; const Sh = 1 + 0.015 * avgCp * T; const Rt = -Math.sin(2 * dTheta * Math.PI / 180) * Rc; return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh)); }

// ---------------------------------------------------------------------------
// Native typography + inline color-stamp (ported build-absolute.mjs:120/165-176 → INLINE css form, build-flow.mjs:185-206)
// All text routes through inline-styled <hN>/<div>/<a> in a text-editor (the heading-widget schema on this stack
// rejects typography_*), so typoCss() folds font + color into one inline-style string. Fonts that map to a Google
// equivalent render natively; registered real fonts inject @font-face (usedFonts).
// ---------------------------------------------------------------------------
const textColor = (n) => (n.paint && n.paint.value && n.paint.kind !== 'gradient-text' && /^(#|rgb)/.test(n.paint.value)) ? n.paint.value : null;
// colorCss now routes through effectiveColor: where a Kit color token is in tolerance, it emits color:var(--e-global-color-…)
// (so token edits propagate) instead of baking the literal. Falls back to the literal when no token applies.
const colorCss = (n) => effectiveColor(n).css;
// FIX 2 — does this node have a matching Kit TYPOGRAPHY token whose family/size we can replace with the global var?
// True iff assignGlobals snapped n._gTypoTok AND the cluster carries a usable family or size signature. When so,
// typoCss emits font-family/font-size as `var(--e-global-typography-<tok>-…)` (stripping the inline literal) so a
// Kit typography edit propagates; weight/line-height/letter-spacing/transform also ride the matching var.
function effectiveTypoTok(n) {
  if (NO_EFFECTIVE || NO_GLOBALS || !n || !n._gTypoTok) return null;
  const c = typoCluster(n._gTypoTok);
  if (!c || !c.sig || !(c.sig.fam || c.sig.size)) return null;
  return c;
}
function typoCss(n) {
  const t = n.typo || {}; const out = [];
  const tc = effectiveTypoTok(n);
  const tok = tc && tc.id;
  const s = (tc && tc.sig) || {};
  // FIX 2 — font-family: a matching typo token → emit the global var and STRIP the inline literal; else inline literal.
  if (tok && s.fam) { out.push(`font-family:${typoVar(tok, 'font-family')}`); if (REGFONTS[s._rawFam]) usedFonts.add(s._rawFam); n._fontStripped = true; }
  else { const fam = t.family && (REGFONTS[t.family] ? t.family : gFont(t.family)); if (fam) { out.push(`font-family:'${fam}'`); if (REGFONTS[t.family]) usedFonts.add(t.family); } }
  const dSize = t.size ? round(t.size) : 0;
  // FIX 2 — font-size: a matching typo token that carries a size → emit the global var; else the inline literal.
  if (tok && s.size) out.push(`font-size:${typoVar(tok, 'font-size')}`);
  else if (dSize) out.push(`font-size:${dSize}px`);
  const lhPx = px(t.lineHeight);
  if (tok && s.lh) out.push(`line-height:${typoVar(tok, 'line-height')}`);
  else if (lhPx) out.push(dSize > 0 ? `line-height:${(lhPx / dSize).toFixed(3)}` : `line-height:${round(lhPx)}px`);
  if (tok && s.weight) out.push(`font-weight:${typoVar(tok, 'font-weight')}`);
  else if (t.weight && /^\d+$/.test(String(t.weight))) out.push(`font-weight:${t.weight}`);
  const ls = px(t.letterSpacing);
  if (tok && s.ls !== null && s.ls !== undefined) out.push(`letter-spacing:${typoVar(tok, 'letter-spacing')}`);
  else if (ls !== null && t.letterSpacing !== 'normal') out.push(`letter-spacing:${(+ls.toFixed(1))}px`);
  if (tok && s.tr) out.push(`text-transform:${typoVar(tok, 'text-transform')}`);
  else if (t.transform && t.transform !== 'none') out.push(`text-transform:${t.transform}`);
  // FIX 1 — color: effectiveColor emits the global var when a Kit color token is in tolerance (else the literal).
  const cc = colorCss(n); if (cc) out.push(cc);
  return out.join(';');
}
const textCss = (n, extra) => [typoCss(n), extra].filter(Boolean).join(';') + ';' + WRAP;
// dominant solid stop of a CSS gradient (build-flow.mjs:215) — gradient bg fallback.
function gradientColor(grad) { const cols = [...String(grad).matchAll(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/gi)].map((m) => m[0]); if (!cols.length) return null; const dark = cols.find((c) => { const m = c.match(/(\d+),\s*(\d+),\s*(\d+)/); if (!m) return false; return (+m[1] + +m[2] + +m[3]) / 3 < 90; }); return dark || cols[0]; }

// ===========================================================================
// GLOBAL-TOKEN Kit clustering + __globals__ refs (ported VERBATIM-in-spirit from build-absolute.mjs:490-621).
// Cluster captured text/bg colors (CIEDE2000 dE<=3) → ~6-12 Kit color tokens; typography signatures → ~4-8 typo
// tokens; write them to the Kit once per clone; emit each text widget with a __globals__ ref to the nearest token
// AND keep the captured inline value as a fallback (so render is byte-identical even if a global ref fails).
// ===========================================================================
const NO_GLOBALS = process.env.STRUCT_NO_GLOBALS === '1' || process.env.ABS_NO_GLOBALS === '1';
const GLOBALS_DE = 3;
const gColorTokens = []; const gTypoTokens = [];
const normHex = (c) => { const p = parseRgb(c); if (!p) return null; return `rgb(${Math.round(p[0])}, ${Math.round(p[1])}, ${Math.round(p[2])})`; };
function hash32(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; }
function colorRole(rgb, idx) { const lab = rgb2lab(rgb); const Lp = lab[0], chroma = Math.hypot(lab[1], lab[2]); if (Lp >= 92) return 'BG Light'; if (Lp <= 12) return 'Text Dark'; if (chroma >= 28) return idx === 0 ? 'Primary' : 'Accent'; if (Lp >= 55) return 'Muted'; return 'Text'; }
const _colorClusters = [];
function tokenForColor(cssColor) {
  if (NO_GLOBALS) return null;
  const key = normHex(cssColor); if (!key) return null;
  const rgb = parseRgb(key); if (!rgb) return null;
  let best = null, bestDE = Infinity;
  for (const c of _colorClusters) { const de = deltaE(key, c.key); if (de < bestDE) { bestDE = de; best = c; } }
  if (best && bestDE <= GLOBALS_DE) { best.count++; return best.id; }
  const id = `clr_${(_colorClusters.length).toString(36)}${Math.abs(hash32(key)).toString(36).slice(0, 4)}`;
  _colorClusters.push({ key, rgb, count: 1, id, title: colorRole(rgb, _colorClusters.length) });
  return id;
}
const _typoClusters = [];
function typoSig(n) { const t = n.typo || {}; if (!(t.size || t.family)) return null; const fam = REGFONTS[t.family] ? t.family : gFont(t.family); return { fam, size: t.size ? Math.round(t.size) : null, weight: (t.weight && /^\d+$/.test(String(t.weight))) ? String(t.weight) : null, lh: px(t.lineHeight), ls: (t.letterSpacing && t.letterSpacing !== 'normal') ? px(t.letterSpacing) : null, tr: (t.transform && t.transform !== 'none') ? t.transform : null, _rawFam: t.family }; }
function typoRole(sig, idx) { if (sig.size && sig.size >= 40) return 'Display'; if (sig.size && sig.size >= 24) return 'Heading'; if (sig.size && sig.size <= 13) return 'Small'; return idx === 0 ? 'Body' : 'Text'; }
function tokenForTypo(n) {
  if (NO_GLOBALS) return null;
  const sig = typoSig(n); if (!sig) return null;
  for (const c of _typoClusters) { if (c.sig.fam === sig.fam && c.sig.weight === sig.weight && c.sig.tr === sig.tr && ((c.sig.size == null && sig.size == null) || (c.sig.size != null && sig.size != null && Math.abs(c.sig.size - sig.size) <= 1))) return c.id; }
  const id = `typ_${(_typoClusters.length).toString(36)}${Math.abs(hash32((sig.fam || '') + sig.size + sig.weight)).toString(36).slice(0, 4)}`;
  const settings = { typography_typography: 'custom' };
  if (sig.fam) settings.typography_font_family = sig.fam;
  if (sig.size) settings.typography_font_size = { unit: 'px', size: sig.size };
  if (sig.weight) settings.typography_font_weight = sig.weight;
  if (sig.lh) settings.typography_line_height = { unit: 'px', size: Math.round(sig.lh) };
  if (sig.ls !== null && sig.ls !== undefined) settings.typography_letter_spacing = { unit: 'px', size: +sig.ls.toFixed(1) };
  if (sig.tr) settings.typography_text_transform = sig.tr;
  _typoClusters.push({ sig, id, title: typoRole(sig, _typoClusters.length), settings });
  return id;
}
function assignGlobals(n) {
  if (NO_GLOBALS || !n) return;
  if (n.kind === 'container') { const bg = n.background; if (bg && bg.color && opaque(bg.color)) { const t = tokenForColor(bg.color); if (t) n._gBgTok = t; } (n.children || []).forEach(assignGlobals); }
  else { const tc = textColor(n); if (tc) { const t = tokenForColor(tc); if (t) n._gColorTok = t; } const tp = tokenForTypo(n); if (tp) n._gTypoTok = tp; }
}
// __globals__ sibling for a text widget. colorKey selects the native control (text_color for text-editor); the
// inline value is ALWAYS still emitted as the fallback. Typography binding gated behind ABS_GLOBAL_TYPO (default OFF).
function globalRefSettings(n, colorKey) {
  if (NO_GLOBALS) return {};
  const g = {};
  if (n._gColorTok && colorKey) g[colorKey] = `globals/colors?id=${n._gColorTok}`;
  // FIX 2 — bind typography_typography to the matching Kit typography global. The inline editor HTML now carries the
  // font-* CSS VARS (typoCss), so the render is identical regardless of how the widget control resolves — the prior
  // system-fallback-drift concern (which gated this behind ABS_GLOBAL_TYPO) no longer applies. Bind it unconditionally
  // when effective-globals is on + the node has a matching typo token; the legacy ABS_GLOBAL_TYPO flag still forces it.
  if (n._gTypoTok && ((!NO_EFFECTIVE && effectiveTypoTok(n)) || process.env.ABS_GLOBAL_TYPO === '1')) g.typography_typography = `globals/typography?id=${n._gTypoTok}`;
  return Object.keys(g).length ? { __globals__: g } : {};
}
function finalizeGlobalTokens() {
  for (const c of _colorClusters) gColorTokens.push({ _id: c.id, title: `${c.title}`, color: hexOf(c.key) });
  for (const t of _typoClusters) gTypoTokens.push({ _id: t.id, title: `${t.title}`, ...t.settings });
}
function hexOf(css) { const p = parseRgb(css); if (!p) return (String(css).match(/#[0-9a-fA-F]{3,8}/) || ['#000000'])[0]; const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); return `#${h(p[0])}${h(p[1])}${h(p[2])}`.toUpperCase(); }

// ===========================================================================
// DESIGN.md token rounding-out (P2): cluster spacing / radius / shadow — the categories the Kit-globals
// pass does NOT dedup (color+typo only). Collected for the DESIGN.md IR (emit only; no render-path effect).
// ===========================================================================
const _radii = [], _spaces = []; const _shadowsRaw = new Map();
const parsePx = (v) => { if (typeof v === 'number') return v; const m = String(v || '').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };
function collectDsScales(n) {
  if (!n) return;
  if (!/[%]/.test(String(n.radius || ''))) { const r = parsePx(n.radius); if (r != null && r > 0) _radii.push(Math.round(r)); }
  const sh = n.boxShadow; if (sh && !/^none/i.test(String(sh).trim())) { const k = String(sh).trim(); _shadowsRaw.set(k, (_shadowsRaw.get(k) || 0) + 1); }
  if (Array.isArray(n.padding)) for (const p of n.padding) { const v = parsePx(p); if (v != null && v > 0) _spaces.push(Math.round(v)); }
  (n.children || []).forEach(collectDsScales);
}
const SCALE_NAMES = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'];
function clusterScale(values, maxTokens = 6, tol = 3) {
  if (!values.length) return [];
  const freq = new Map(); for (const v of values) freq.set(v, (freq.get(v) || 0) + 1);
  const uniq = [...freq.entries()].map(([px, count]) => ({ px, count })).sort((a, b) => a.px - b.px);
  const merged = [];
  for (const u of uniq) { const near = merged.find((m) => Math.abs(m.px - u.px) <= tol); if (near) { if (u.count > near.count) near.px = u.px; near.count += u.count; } else merged.push({ ...u }); }
  const top = merged.sort((a, b) => b.count - a.count).slice(0, maxTokens).sort((a, b) => a.px - b.px);
  return top.map((t, i) => ({ name: SCALE_NAMES[i] || `s${i}`, px: t.px, count: t.count }));
}
function clusterShadows(map, maxTokens = 4) {
  const arr = [...map.entries()].map(([value, count]) => ({ value, count })); if (!arr.length) return [];
  const mag = (s) => (String(s).match(/-?\d+(?:\.\d+)?px/g) || []).reduce((a, x) => a + Math.abs(parseFloat(x)), 0);
  const top = arr.sort((a, b) => b.count - a.count).slice(0, maxTokens).sort((a, b) => mag(a.value) - mag(b.value));
  return top.map((t, i) => ({ name: SCALE_NAMES[i] || `e${i}`, value: t.value, count: t.count }));
}
// Build the DESIGN.md model from the finalized clusters + the spacing/radius/shadow scales, and write the file.
function writeDesignMd() {
  if (NO_GLOBALS) return;
  collectDsScales(L.root);
  let siteName = 'Captured';
  try { const su = L.source || L.url; if (su) siteName = new URL(su).hostname.replace(/^www\./, ''); } catch {}
  if (siteName === 'Captured') { const b = (layoutPath.split('/').pop() || '').replace(/\.[^.]+$/, ''); if (b) siteName = b; }
  const model = {
    name: siteName,
    pageBg: hexOf(PAGE_DEFAULT),
    colors: _colorClusters.map((c) => ({ id: c.id, role: c.title, hex: hexOf(c.key), count: c.count })),
    typography: _typoClusters.map((t) => ({ id: t.id, role: t.title, fontFamily: t.sig.fam, fontSize: t.sig.size, fontWeight: t.sig.weight, lineHeight: t.sig.lh ? Math.round(t.sig.lh) : null, letterSpacing: (t.sig.ls != null) ? +(+t.sig.ls).toFixed(1) : null, textTransform: t.sig.tr })),
    rounded: clusterScale(_radii, 5),
    spacing: clusterScale(_spaces, 6),
    shadows: clusterShadows(_shadowsRaw, 4),
  };
  const dmPath = arg('designmd') || layoutPath.replace(/\.[^.]+$/, '') + '.DESIGN.md';
  try { fs.writeFileSync(dmPath, emitDesignMd(model)); console.log(`DESIGN.md → ${dmPath} (${model.colors.length} color, ${model.typography.length} typo, ${model.rounded.length} radius, ${model.spacing.length} spacing, ${model.shadows.length} shadow token(s))`); } catch (e) { console.log('DESIGN.md emit failed: ' + String((e && e.message) || e)); }
}

// ===========================================================================
// GLOBALS-EFFECTIVE (re-implemented; proven then reverted on a measurement bug).
// The kit PUT regenerates `--e-global-color-<_id>` and `--e-global-typography-<_id>-<prop>` CSS custom properties
// (verified against /tmp/kit7.css: a token _id `jptok_primary` → `--e-global-color-jptok_primary`; typography →
// `--e-global-typography-jptok_head-font-family|font-size|font-weight|line-height|letter-spacing|text-transform`).
// Because every text leaf here renders through a text-editor whose `editor` field is RAW inline-styled HTML, a
// sibling `__globals__` color/typography ref can NEVER win — the inline `color:rgb(...)` in the HTML always paints.
// So to make Kit token edits actually PROPAGATE we must emit the CSS VAR itself inline (`color:var(--e-global-...)`)
// instead of baking the literal value. The var resolves to the EXACT token value at first render (dE<=3 by cluster
// construction → pixel-identical) and re-resolves whenever the Kit token is edited (round-trip editability). Where no
// global exists, snap to the nearest finalized token within dE<=5 and bind that. The `__globals__` ref is STILL
// emitted (additive — it wires the native editor control), but the var is what makes the render itself live.
// REVERSIBILITY: STRUCT_NO_EFFECTIVE_GLOBALS=1 → bake literal inline values exactly as before (no CSS-var emission).
const NO_EFFECTIVE = process.env.STRUCT_NO_EFFECTIVE_GLOBALS === '1';
const EFFECTIVE_COLOR_DE = 5; // nearest-token snap tolerance for the "no global yet" path (clusters are dE<=3)
const STATS = { textRelyGlobal: 0, fontStripped: 0, wrappersUnwrapped: 0, sectionsNamed: 0 };
const colorVar = (tok) => `var(--e-global-color-${tok})`;
const typoVar = (tok, prop) => `var(--e-global-typography-${tok}-${prop})`;
// the materialized hex value a finalized color token will carry (the cluster anchor key).
function tokenColorValue(tok) { const c = _colorClusters.find((c) => c.id === tok); return c ? c.key : null; }
// the typo cluster (carries .sig + .settings) for a typography token id.
function typoCluster(tok) { return _typoClusters.find((c) => c.id === tok) || null; }
// Resolve the EFFECTIVE color token for a text node + return the inline color CSS to emit.
// (a) node already has _gColorTok (assignGlobals snapped it at dE<=3) AND token value dE<=3 of the inline color
//     → emit color:var(...) (do NOT bake the literal — let the global win so token edits propagate).
// (b) no token yet → find nearest finalized cluster within dE<=5; if found, bind it + emit the var.
// (c) otherwise → fall back to the literal inline color (exact prior behavior). Returns {css, tok} (tok may be null).
function effectiveColor(n) {
  const lit = textColor(n); if (!lit) return { css: '', tok: null };
  if (NO_EFFECTIVE || NO_GLOBALS) return { css: `color:${lit}`, tok: null };
  let tok = n._gColorTok || null;
  if (tok) { const tv = tokenColorValue(tok); if (!(tv && deltaE(tv, lit) <= GLOBALS_DE)) tok = null; }
  if (!tok) { let best = null, bd = Infinity; for (const c of _colorClusters) { const de = deltaE(c.key, lit); if (de < bd) { bd = de; best = c; } } if (best && bd <= EFFECTIVE_COLOR_DE) { tok = best.id; n._gColorTok = tok; } }
  // mark the node (counted ONCE per node at finalize, not per call — typoCss + a bare colorCss both hit this).
  if (tok) { n._reliesGlobalColor = true; return { css: `color:${colorVar(tok)}`, tok }; }
  return { css: `color:${lit}`, tok: null };
}

async function writeKitGlobals(sessionHeaders) {
  if (NO_GLOBALS || (!gColorTokens.length && !gTypoTokens.length)) return { colors: 0, typos: 0, ok: false };
  try {
    const body = { settings: { custom_colors: gColorTokens, custom_typography: gTypoTokens } };
    const r = await fetch(`${base}/wp-json/joist/v1/kit`, { method: 'PUT', headers: sessionHeaders, body: JSON.stringify(body) });
    const txt = await r.text(); const ok = r.ok || r.status === 200;
    console.log(`kit globals WRITE: PUT /joist/v1/kit ${r.status} ${txt.slice(0, 80)} — ${gColorTokens.length} color + ${gTypoTokens.length} typography token(s)`);
    return { colors: gColorTokens.length, typos: gTypoTokens.length, ok };
  } catch (e) { console.log('kit globals WRITE error', String(e).slice(0, 120)); return { colors: 0, typos: 0, ok: false }; }
}

// ===========================================================================
// NATIVE-WIDGET PROMOTION (default ON; STRUCT_NO_NATIVE=1 reverts to the inline html/text-editor shapes below).
// Headings → native `heading` widget (real <hN> + #37 global color/typo refs), CTA/buttons → native `button`
// widget (#34 green-fill primary), <img>/svg-raster leaves → native `image` widget. The PROVEN native-image shape
// on this stack is settings.image={url,id} + image_size (NO top-level alt — that field is stripped/rejected). The
// CRITICAL fix: a native image widget defaults to image_size:'full' → it renders at the INTRINSIC/full pixel size,
// which balloons the page height ~6x (a 330×430 SVG painted at 1140×1721). So we CAP it to the captured box exactly
// like recipe #33 caps the html<img> path: settings.width={unit:'px',size:<capturedW>} pins the rendered width to
// the captured box, and a scoped custom_css rule keyed to the widget's _element_id pins max-width:100% + height:auto
// + max-height:<capturedH> + aspect-ratio:<w/h> so the image renders at the SAME size recipe #33 gives the inline
// <img> — never intrinsic/full. max-width:100% keeps it responsive (shrinks on narrow columns); the no-h-scroll
// guard is preserved because width:Npx is always paired with max-width:100% (validateTree's IMGCAP exception).
// ===========================================================================
const NO_NATIVE = process.env.STRUCT_NO_NATIVE === '1';
const NATIVE = { headings: 0, buttons: 0, images: 0 };
// native-image scoped caps keyed to #nimg-N (joined into page custom_css alongside RAMCSS) — this is what holds the
// captured-box size cap on the native image widget so it never paints intrinsic/full (the 6.057x-height bug).
const NATIVEIMG_CSS = [];
let _nimgSeq = 0;
// STRUCT_IMGFIT (default ON since promotion — corrected 2026-06-09; opt out STRUCT_NO_IMGFIT=1 or STRUCT_LEGACY=1 ⇒ byte-identical) — SOURCE-CLIP image clamp. The native-image cap above pins max-height
// to the CAPTURED box height (recipe #33 size). But some sections show a DOMINANT image whose captured box is far
// TALLER than the section band the source paints it into — the source CLIPS/scales it to the visible band crop (e.g.
// supabase #8: a 620px-tall mockup inside a 261px band; the source shows only ~150px of it). The contain-to-620 cap
// then renders it full-height and the section balloons (hRatio 3.3). IMGFIT lets buildSection register an OVERRIDE
// max-height (the available band height) for that one leaf, keyed by the resolved leaf object; nativeImageWidget then
// emits max-height:<availH> + object-fit:COVER (fill+crop, matching the source clip) instead of contain-to-capturedH.
// REVERSIBILITY: with IMGFIT disabled (STRUCT_NO_IMGFIT=1) the map is never populated, so every nativeImageWidget takes the unchanged path.
const IMGFIT = process.env.STRUCT_LEGACY !== '1' && process.env.STRUCT_NO_IMGFIT !== '1';
const IMGFIT_CLAMP = new Map();   // resolved-leaf object → clamped available band height (px)
const IMGFITSTATS = { clamped: 0 };
// build a native IMAGE widget capped to its captured box. settings.image={url,id?} + image_size + width pin + a
// scoped #nimg-N custom_css rule (max-width:100%;height:auto;max-height:<h>;aspect-ratio) = recipe #33 size, native.
// `leaf` (optional) = the resolved source leaf; if STRUCT_IMGFIT tagged it as a source-clipped dominant image, the
// cap is rewritten to clamp height to the available band + object-fit:cover (the visible source crop).
function nativeImageWidget(url, box, leaf) {
  const w = round(box.w), h = Math.max(1, round(box.h));
  const id = localId(url);
  const image = id ? { url, id } : { url };               // PROVEN shape: {url,id}; NO top-level alt (stripped on this stack)
  const eid = `nimg-${_nimgSeq++}`;
  // STRUCT_IMGFIT clamp (only ever set when IMGFIT=1 AND buildSection registered this leaf): the image's captured box
  // overflows its section band, so the source clips it. Clamp the rendered height to the available band height and use
  // object-fit:COVER (fill the box, crop the overflow) — matching the source's visible crop, NOT the full image.
  const clampH = (IMGFIT && leaf) ? IMGFIT_CLAMP.get(leaf) : undefined;
  if (clampH != null) {
    const ch = Math.max(1, round(clampH));
    // width:Wpx;max-width:100% keeps the no-h-scroll invariant (validateTree IMGCAP exception). height:Hpx + object-
    // fit:cover crops the tall image into the band crop. NO aspect-ratio (it would re-derive the full height).
    NATIVEIMG_CSS.push(`#${eid} img{display:block!important;width:${w}px!important;max-width:100%!important;height:${ch}px!important;max-height:${ch}px!important;object-fit:cover!important;object-position:center top!important}`);
    NATIVE.images++; IMGFITSTATS.clamped++;
    return { elType: 'widget', widgetType: 'image', settings: { image, image_size: 'full', width: { unit: 'px', size: w }, _element_id: eid } };
  }
  // CAP: pin the rendered width to the captured px + scope a rule that caps height/aspect to the captured box. This
  // gives the EXACT size recipe #33's html<img> gets (display:block;width:Wpx;max-width:100%;height:auto;
  // max-height:Hpx;aspect-ratio:W/H;object-fit:contain) — never intrinsic/full → kills the 6x-height balloon.
  NATIVEIMG_CSS.push(`#${eid} img{display:block!important;width:${w}px!important;max-width:100%!important;height:auto!important;max-height:${h}px!important;aspect-ratio:${w}/${h}!important;object-fit:contain!important}`);
  NATIVE.images++;
  return { elType: 'widget', widgetType: 'image', settings: {
    image, image_size: 'full',
    width: { unit: 'px', size: w },                       // captured-width cap (paired with max-width:100% in the CSS rule)
    _element_id: eid,
  } };
}

// ===========================================================================
// LEAF → WIDGET — INLINE-STYLE ONLY (NO absPos, NO _element_custom_width fixed px). Same native shapes
// build-absolute.mjs:201-288 / build-flow.mjs:275-380 produce (heading/text/button/image/svg/mockup/code/video/
// list/tabs/accordion), but the parent flex column positions them, so we never spread the absolute-position keys.
// Images render at width:100% of their column with the captured aspect ratio (NO fixed-px floor) so they shrink.
// ===========================================================================
function leafWidget(n) {
  const box = n.box; if (!box || box.w < 3 || box.h < 2) return null;
  // IMAGE — width:100% of the flex column, aspect-ratio from the captured box so height tracks. NO fixed px width
  // (that would pin a desktop floor and force horizontal overflow); object-fit:cover fills like the source region.
  const sizedImg = (url) => {
    const w = round(box.w), h = round(box.h);
    // IMGCAP: pin width to captured px (max-width:100% AGREES with Elementor's img{max-width:100%} instead of being
    // overridden to 100% -> the prior bug rendered a 330x430 SVG at 1140x1721 and blew page height to ~9x). height:auto
    // + max-height caps SVGs whose intrinsic box is tall. Stays responsive: max-width:100% shrinks it on narrow columns.
    const style = `display:block;width:${w}px;max-width:100%;height:auto;max-height:${Math.max(1, h)}px;aspect-ratio:${w}/${Math.max(1, h)};object-fit:contain;${WRAP}`;
    return { elType: 'widget', widgetType: 'html', settings: { html: `<img src="${esc(url)}" alt="${esc(n.alt || '')}" style="${style}" loading="eager">` } };
  };
  // NATIVE IMAGE promotion (default ON): an <img> / svg-raster leaf → a real native `image` widget, CAPPED to the
  // captured box (settings.width + scoped #nimg-N custom_css) so it renders at recipe #33 size, NOT intrinsic/full.
  if (!NO_NATIVE && n.kind === 'image') return nativeImageWidget(localSrc(n.src), box, n);
  if (!NO_NATIVE && (n.kind === 'svg' || n.kind === 'mockup') && n.raster && n.raster !== 'SKIP') return nativeImageWidget(localSrc(n.raster), box, n);
  if (n.kind === 'image') return sizedImg(localSrc(n.src));
  if ((n.kind === 'svg' || n.kind === 'mockup') && n.raster && n.raster !== 'SKIP') return sizedImg(localSrc(n.raster));
  if (n.kind === 'svg' || n.kind === 'mockup') return null; // SKIP / no-raster decorative
  // CODE — clipped <pre> capped to the captured panel height (overflow:auto), fluid width (max-width:100%).
  if (n.kind === 'code') {
    const fs2 = (n.typo && n.typo.size) || 14; const cc = colorCss(n); const capH = round(box.h);
    const clip = capH >= 40 ? `max-height:${capH}px;overflow:auto;` : '';
    return { elType: 'widget', widgetType: 'html', settings: { html: `<pre style="${clip}white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:${fs2}px;margin:0${cc ? ';' + cc : ''};${WRAP}">${esc(n.text || '')}</pre>` } };
  }
  // VIDEO — always-present <iframe>/<video> in an html widget (fluid; aspect-ratio holds the box). build-flow.mjs:328
  if (n.kind === 'video') {
    const w = round(box.w), h = round(box.h);
    const ytId = (u) => { if (!u) return null; let m = u.match(/[?&]v=([\w-]{6,})/); if (m) return m[1]; m = u.match(/youtu\.be\/([\w-]{6,})/); if (m) return m[1]; m = u.match(/\/embed\/([\w-]{6,})/); if (m) return m[1]; m = u.match(/\/shorts\/([\w-]{6,})/); if (m) return m[1]; return null; };
    const vimeoId = (u) => { if (!u) return null; const m = u.match(/(?:player\.vimeo\.com\/video\/|vimeo\.com\/(?:video\/)?)(\d{6,})/); return m ? m[1] : null; };
    let embedSrc = null, hostedSrc = null;
    if (n.provider === 'youtube') { const id = ytId(n.src); embedSrc = id ? `https://www.youtube.com/embed/${id}` : (n.src || null); }
    else if (n.provider === 'vimeo') { const id = vimeoId(n.src); embedSrc = id ? `https://player.vimeo.com/video/${id}` : (n.src || null); }
    else if (n.provider === 'hosted') { if (n.src && /^https?:/.test(n.src)) hostedSrc = n.src; }
    else if (n.src) { embedSrc = n.src; }
    let inner;
    if (embedSrc) inner = `<iframe src="${esc(embedSrc)}" width="${w}" height="${h}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="width:100%;height:100%;border:0"></iframe>`;
    else if (hostedSrc) inner = `<video src="${esc(hostedSrc)}" width="${w}" height="${h}" controls playsinline style="width:100%;height:100%;object-fit:cover"></video>`;
    else inner = `<video width="${w}" height="${h}" controls playsinline style="width:100%;height:100%;object-fit:cover"></video>`;
    return { elType: 'widget', widgetType: 'html', settings: { html: `<div style="width:100%;max-width:${w}px;aspect-ratio:${w}/${h || 1}">${inner}</div>` } };
  }
  // LIST — native <ul>/<ol><li> via text-editor.
  if (n.kind === 'list') {
    const cc = colorCss(n);
    const items = (n.items || []).map((it) => { const t = stripEmoji(it.text); if (!t) return ''; return `<li>${it.href ? `<a href="${esc(it.href)}"${styleAttr(cc)}>${esc(t)}</a>` : esc(t)}</li>`; }).filter(Boolean).join('');
    if (!items) return null; const tagName = n.ordered ? 'ol' : 'ul';
    // STRUCT_LINKCOLS (default ON since promotion — corrected 2026-06-09; opt out STRUCT_NO_LINKCOLS=1) — a LONG BARE-ANCHOR index list (≥8 short anchors, ≥80% with href) renders as a
    // CSS MULTI-COLUMN block so it occupies the SAME compact band the source <ul> did (basecamp footer: 27 anchors in
    // ~6 columns @143px) instead of stacking 1-per-row into a tall single column (the +743px footer inflator). The
    // scoped #linkcols-N{columns:<colW>px;column-gap:32px} rule auto-flows the <li> anchors into as many columns as
    // fit width:100%; each <li> is display:block;break-inside:avoid so an anchor never splits across a column. CSS
    // multi-column ADDS columns (never width) → kses-safe, cannot cause horizontal scroll. OFF ⇒ byte-identical.
    const lq = linkListQualify(n);
    if (lq.ok) {
      const eid = `linkcols-${++_linkcolsId}`;
      const colW = linkColWidth(lq.boxW, lq.K);
      LINKCOLSCSS.push(`#${eid}{columns:${colW}px;column-gap:${LINKCOL_GAP}px;list-style:none;margin:0;padding:0;width:100%;max-width:100%}#${eid} li{display:block;break-inside:avoid;-webkit-column-break-inside:avoid;page-break-inside:avoid;margin:0 0 4px}#${eid} li a{display:block;text-decoration:none}`);
      LINKCOLSSTATS.lists++;
      return { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<${tagName} id="${eid}" style="${textCss(n)}">${items}</${tagName}>`, ...globalRefSettings(n, 'text_color') } };
    }
    return { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<${tagName} style="${textCss(n)}">${items}</${tagName}>`, ...globalRefSettings(n, 'text_color') } };
  }
  // TABS — real role=tablist/tab/tabpanel in an html widget.
  if (n.kind === 'tabs') {
    const its = (n.items || []).map((it) => ({ title: stripEmoji(it.title), content: stripEmoji(it.content || '') })).filter((it) => it.title);
    if (its.length < 2) return null;
    const cc = colorCss(n);
    const tabBtns = its.map((it, i) => { const longTitle = it.title.length > 24; const nowrap = longTitle ? '' : 'white-space:nowrap;'; return `<div role="tab" aria-selected="${i === 0 ? 'true' : 'false'}" style="display:inline-block;padding:6px 14px;margin:0 4px 0 0;cursor:pointer;max-width:100%;${nowrap}${WRAP}${cc ? ';' + cc : ''}">${esc(it.title)}</div>`; }).join('');
    const panels = its.map((it) => it.content ? `<div role="tabpanel" style="padding:8px 0${cc ? ';' + cc : ''}">${esc(it.content)}</div>` : '').filter(Boolean).join('');
    const tabsHtml = `<div role="tablist" style="display:flex;flex-wrap:wrap;align-items:center;min-height:32px;width:100%;max-width:100%">${tabBtns}</div>${panels}`;
    return { elType: 'widget', widgetType: 'html', settings: { html: tabsHtml } };
  }
  // ACCORDION — native <details>.
  if (n.kind === 'accordion') {
    const cc = colorCss(n);
    const html = (n.items || []).map((it) => { const inner = (it.content || []).map((c) => c.href ? `<a href="${esc(c.href)}"${styleAttr(cc)}>${esc(c.text)}</a>` : `<p${styleAttr(cc)}>${esc(c.text)}</p>`).join(''); return `<details${it.open ? ' open' : ''}><summary${styleAttr(cc)}>${esc(it.summary)}</summary><div>${inner}</div></details>`; }).join('');
    if (!html) return null; return { elType: 'widget', widgetType: 'html', settings: { html } };
  }
  const text = stripEmoji(n.text); if (!text) return null;
  // NATIVE HEADING promotion (default ON): captured tag h1-h6 → a real native `heading` widget (header_size from the
  // tag) so the page carries true <hN> semantics. Typography rides nativeTypoSettings; color via title_color + the
  // #37 __globals__ ref (globalRefSettings) so a Kit token edit propagates. margin:0 keeps the flex stack tight.
  if (n.kind === 'heading') {
    const hn = 'h' + Math.min(6, Math.max(1, n.level || 2));
    if (!NO_NATIVE) {
      const tc = textColor(n);
      NATIVE.headings++;
      return { elType: 'widget', widgetType: 'heading', settings: {
        title: text, header_size: hn,
        ...nativeTypoSettings(n),
        ...(tc ? { title_color: tc } : {}),
        _margin: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
        ...globalRefSettings(n, 'title_color'),           // #37: title_color global ref + (gated) typography global ref
      } };
    }
    return { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<${hn} style="${textCss(n)}">${esc(text)}</${hn}>`, ...globalRefSettings(n, 'text_color') } };
  }
  // NATIVE BUTTON promotion (default ON): a CTA <a>/button → a real native `button` widget. #34 green-fill for the
  // primary CTA copy; everything else → a neutral/default button. text + link survive kses on the native widget.
  if (n.kind === 'button') {
    if (!NO_NATIVE) {
      NATIVE.buttons++;
      const isPrimary = SECTION_CTA_RX.test(text) && /start your project|get started|sign ?up|create( an)? account|start( now| free| building)?/i.test(text);
      const size = round((n.typo && n.typo.size) || 16);
      const settings = {
        text, button_type: isPrimary ? 'success' : 'default', size: 'sm',
        ...(n.href ? { link: { url: n.href, is_external: '', nofollow: '' } } : {}),
        typography_typography: 'custom', typography_font_size: { unit: 'px', size: size }, typography_font_weight: '600',
        border_radius: { unit: 'px', top: '6', right: '6', bottom: '6', left: '6', isLinked: true },
        text_padding: { unit: 'px', top: '9', right: '18', bottom: '9', left: '18', isLinked: false },
      };
      // #34: primary CTA gets the source green-fill; secondary stays the theme default skin (no forced bg).
      if (isPrimary) { settings.background_color = BRAND_FILL; settings.button_text_color = '#1c1c1c'; }
      // STRUCT_MOTION (default OFF): native button hover — text/bg/border hover color + hover transition duration
      // from the SOURCE hover profile. Manifests only on :hover ⇒ default render is byte-identical ⇒ no static
      // regression. A spread of {} when motion is off / source has no button hover ⇒ byte-identical to legacy.
      Object.assign(settings, btnHoverSettings());
      return { elType: 'widget', widgetType: 'button', settings };
    }
    return { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<a${n.href ? ` href="${esc(n.href)}"` : ''} style="${textCss(n)}">${esc(text)}</a>`, ...globalRefSettings(n, 'text_color') } };
  }
  // BODY TEXT → text-editor (keep the #37 inline-strip: typoCss emits CSS vars for globalized font/color, the
  // __globals__ sibling wires the native control). Unchanged — body copy stays a rich-text editor for editability.
  return { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<div style="${textCss(n)}">${esc(text)}</div>`, ...globalRefSettings(n, 'text_color') } };
}
// NATIVE TYPOGRAPHY settings for a native heading widget (the heading widget DOES accept typography_* controls,
// unlike the text-editor path which routes typography through inline CSS). Mirrors build-absolute.mjs:120 nativeTypo
// but reuses the local gFont/REGFONTS so registered real fonts inject @font-face (usedFonts). When a Kit typography
// token applies (#37), the __globals__ ref (globalRefSettings) binds typography_typography to the global on top.
function nativeTypoSettings(n) {
  const t = n.typo || {}; const s = {}; if (!(t.size || t.family)) return s;
  s.typography_typography = 'custom';
  const fam = t.family && (REGFONTS[t.family] ? t.family : gFont(t.family));
  if (fam) { s.typography_font_family = fam; if (REGFONTS[t.family]) usedFonts.add(t.family); }
  if (t.size) s.typography_font_size = { unit: 'px', size: round(t.size) };
  if (t.weight && /^\d+$/.test(String(t.weight))) s.typography_font_weight = String(t.weight);
  const lh = px(t.lineHeight); if (lh && t.size) s.typography_line_height = { unit: 'em', size: +(lh / t.size).toFixed(3) };
  else if (lh) s.typography_line_height = { unit: 'px', size: round(lh) };
  const ls = px(t.letterSpacing); if (ls !== null && t.letterSpacing !== 'normal') s.typography_letter_spacing = { unit: 'px', size: +ls.toFixed(1) };
  if (t.transform && t.transform !== 'none') s.typography_text_transform = t.transform;
  if (t.style && t.style !== 'normal') s.typography_font_style = t.style.startsWith('oblique') ? 'oblique' : 'italic';
  return s;
}

// ===========================================================================
// RE-JOIN — segment members are THIN refs (kind, box, text, tag, href). Build a geometry index of the FULL capture
// leaves and look each member up by exact (rounded) box so the ported widget functions get typo/paint/src/items.
// ===========================================================================
function gatherFullLeaves(root) { const out = []; const g = (n) => { if (!n) return; if (n.kind === 'container') (n.children || []).forEach(g); else if (n.box) out.push(n); }; g(root); return out; }
const FULL_LEAVES = gatherFullLeaves(L.root);
const leafKey = (b) => `${round(b.x)}:${round(b.y)}:${round(b.w)}:${round(b.h)}`;
const FULL_INDEX = new Map();
for (const lf of FULL_LEAVES) { if (lf.box) { const k = leafKey(lf.box); if (!FULL_INDEX.has(k)) FULL_INDEX.set(k, lf); } }
// resolve a thin member to its full leaf: exact box key first, else nearest-center leaf with the same kind+text.
function resolveMember(m) {
  const exact = FULL_INDEX.get(leafKey(m.box));
  if (exact) return exact;
  const mt = stripEmoji(m.text || '');
  let best = null, bd = Infinity;
  const mcx = m.box.x + m.box.w / 2, mcy = m.box.y + m.box.h / 2;
  for (const lf of FULL_LEAVES) {
    if (lf.kind !== m.kind) continue;
    if (mt && stripEmoji(lf.text || '') !== mt) continue;
    const d = Math.hypot((lf.box.x + lf.box.w / 2) - mcx, (lf.box.y + lf.box.h / 2) - mcy);
    if (d < bd) { bd = d; best = lf; }
  }
  // accept only a close geometric match; else synthesize a minimal leaf from the thin ref so nothing is dropped.
  if (best && bd < 24) return best;
  return { kind: m.kind, box: m.box, text: m.text, tag: m.tag, href: m.href, level: m.level };
}

// ===========================================================================
// COLUMN CLUSTERING — partition a band's members into COLUMNS by x-position (gap-split). Members whose x-intervals
// overlap (or whose left edges are within the gap tolerance) share a column; a real horizontal gap starts a new
// column. Returns an ordered (left→right) array of columns, each {x0,x1,members[]} with members sorted by y.
// ===========================================================================
function clusterColumns(members, sectionBox) {
  const ms = members.filter((m) => m && m.box && m.box.w > 0 && m.box.h > 0);
  if (!ms.length) return [];
  // sort by left edge; greedily grow column intervals — a member joins the current column iff its left edge starts
  // before the column's running right edge + a gap tolerance (so members that horizontally overlap or nearly abut
  // are the same column); a real horizontal gap larger than the tolerance opens a new column.
  const sorted = [...ms].sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y);
  const sw = Math.max(1, (sectionBox && sectionBox.w) || VW);
  const GAP = Math.max(24, sw * 0.03); // a >3%-of-section horizontal gap (min 24px) separates columns
  const cols = [];
  for (const m of sorted) {
    const x0 = m.box.x, x1 = m.box.x + m.box.w;
    let placed = false;
    for (const col of cols) { if (x0 <= col.x1 + GAP && x1 >= col.x0 - GAP) { col.x0 = Math.min(col.x0, x0); col.x1 = Math.max(col.x1, x1); col.members.push(m); placed = true; break; } }
    if (!placed) cols.push({ x0, x1, members: [m] });
  }
  // merge any columns that ended up overlapping after growth (transitive merge pass), then sort each column by y.
  cols.sort((a, b) => a.x0 - b.x0);
  const merged = [];
  for (const col of cols) { const last = merged[merged.length - 1]; if (last && col.x0 <= last.x1 + GAP) { last.x1 = Math.max(last.x1, col.x1); last.members.push(...col.members); } else merged.push(col); }
  for (const col of merged) col.members.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return merged;
}

// ===========================================================================
// FIX 1 — ROW (Y-band) CLUSTERING. Before column-clustering, partition a band's members into horizontal ROWS by
// vertical-center band: a member joins the current row iff its TOP starts within the row's running bottom + a
// y-gap tolerance (~0.5× median member height); a larger vertical gap opens a NEW row. A same-y logo strip (12
// logos all at one y) collapses into ONE row; a 3×2 card region splits into 2 card rows → a grid. The running
// bottom is what makes a CARD (its stacked image/heading/text/button overlap the card image vertically) stay one
// row rather than fragmenting. Each row is then split into X-COLUMNS via rowColumns() so the logo strip becomes a
// row of N single-logo columns and a card row becomes a row of N card-columns. A row with one column per member
// is unchanged (single member → stacked, exactly as before).
// ===========================================================================
function clusterRows(members) {
  const ms = members.filter((m) => m && m.box && m.box.w > 0 && m.box.h > 0).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  if (!ms.length) return [];
  const hs = ms.map((m) => m.box.h).sort((a, b) => a - b);
  const medH = hs[Math.floor(hs.length / 2)] || 24;
  const GAP = Math.max(12, medH * 0.5); // a vertical gap > ~0.5× median row height opens a new row
  const rows = [];
  let cur = null;
  for (const m of ms) {
    const top = m.box.y, bot = m.box.y + m.box.h;
    if (!cur || top > cur.bottom + GAP) { cur = { top, bottom: bot, members: [m] }; rows.push(cur); }
    else { cur.bottom = Math.max(cur.bottom, bot); cur.members.push(m); }
  }
  return rows;
}
// X-split the members of ONE row into ordered (left→right) COLUMNS. Members whose x-intervals overlap (within a
// small tolerance) share a column; a real horizontal gap opens a new column. Tighter tolerance than clusterColumns
// (1.2%-of-section, min 12px) so tightly-packed logos in a strip each become their own column (12 logos → 12 cols).
const GRIDFIX = process.env.STRUCT_LEGACY !== '1' && process.env.STRUCT_NO_GRIDFIX !== '1'; // default ON. STRUCT_LEGACY=1 or STRUCT_NO_GRIDFIX=1 ⇒ byte-identical legacy path. Recovers dense mixed-size card grids.
function rowColumns(rowMembers, sectionW) {
  const sw = Math.max(1, sectionW || VW);
  // GRIDFIX (default ON since promotion — corrected 2026-06-09; opt out STRUCT_NO_GRIDFIX=1) — dense MIXED-SIZE card grids (a feature grid of icon+heading+body cells beside WIDE
  // mockups/screenshots) collapse to ONE column under the naive x-overlap merge below: the wide media overlaps the
  // narrow text columns AND each other, chaining everything into a single column → RAM-grid can't qualify (<2 cells)
  // → the section becomes a tall full-width vertical stack (the measured supabase root cause: heightRatio 2.05).
  // FIX: derive the column STRUCTURE from the NARROW members (text/headings/icons align to the real grid columns),
  // then assign EVERY member (incl wide media) to its nearest column center. ≥2 recovered columns are tagged
  // ._gridfix so ramGridQualify trusts them as a grid (the narrow-member alignment IS the grid evidence — bypasses
  // the comparable-width gate that wide media would otherwise fail). A logo strip (1 narrow cell per column) does
  // NOT trigger this (it needs ≥2 narrow cells per column) and falls through to the unchanged legacy path.
  if (GRIDFIX) {
    const narrow = rowMembers.filter((m) => m.box && m.box.w > 0 && m.box.w < sw * 0.45);
    if (narrow.length >= 4) {
      const cgap = Math.max(24, sw * 0.04);                       // a real inter-column gutter measured on CENTERS
      const centers = narrow.map((m) => m.box.x + m.box.w / 2).sort((a, b) => a - b);
      const cc = []; let g = null;
      for (const c of centers) { if (!g || c > g.max + cgap) { g = { sum: c, n: 1, max: c }; cc.push(g); } else { g.sum += c; g.n++; g.max = c; } }
      const colCenters = cc.filter((k) => k.n >= 2).map((k) => k.sum / k.n).sort((a, b) => a - b); // a real column repeats ≥2 narrow cells
      if (colCenters.length >= 2) {
        const cols = colCenters.map((cx) => ({ cx, x0: Infinity, x1: -Infinity, members: [] }));
        for (const m of rowMembers) {
          const mcx = m.box.x + m.box.w / 2;
          let bi = 0, bd = Infinity; for (let i = 0; i < colCenters.length; i++) { const d = Math.abs(mcx - colCenters[i]); if (d < bd) { bd = d; bi = i; } }
          const col = cols[bi]; col.members.push(m); col.x0 = Math.min(col.x0, m.box.x); col.x1 = Math.max(col.x1, m.box.x + m.box.w);
        }
        const used = cols.filter((c) => c.members.length);
        if (used.length >= 2) {
          for (const col of used) col.members.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
          used.sort((a, b) => a.cx - b.cx);
          used._gridfix = true;                                   // trusted grid → ramGridQualify bypasses comparable-width gate
          return used;
        }
      }
    }
  }
  const GAP = Math.max(12, sw * 0.012);
  const sorted = [...rowMembers].sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y);
  const cols = [];
  for (const m of sorted) {
    const x0 = m.box.x, x1 = m.box.x + m.box.w;
    let col = null;
    for (const c of cols) { if (x0 < c.x1 + GAP && x1 > c.x0 - GAP) { col = c; break; } }
    if (col) { col.x0 = Math.min(col.x0, x0); col.x1 = Math.max(col.x1, x1); col.members.push(m); }
    else cols.push({ x0, x1, members: [m] });
  }
  cols.sort((a, b) => a.x0 - b.x0);
  for (const col of cols) col.members.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return cols;
}

// ===========================================================================
// FIX 3 — STYLED BUTTON emitter (reuses the build-absolute button shape: padding + radius + fill/outline) in the
// flex-safe INLINE form (NO absPos, NO fixed-px width — width:auto + max-width:100% keeps the no-h-scroll guard
// happy). primary=source green-fill (#3ECF8E) for the main CTA; secondary=outline/ghost. Emitted as a native
// Elementor BUTTON widget so it reads as a real CTA (not plain text).
// ===========================================================================
const BRAND_FILL = '#3ECF8E'; // supabase green-fill primary CTA
function styledButton(text, href, variant, typo) {
  const t = stripEmoji(text); if (!t) return null;
  const size = round((typo && typo.size) || 16);
  const fam = (typo && typo.family) ? (REGFONTS[typo.family] ? typo.family : gFont(typo.family)) : null;
  if (fam && REGFONTS[typo.family]) usedFonts.add(typo.family);
  const famCss = fam ? `font-family:'${fam}';` : '';
  // fill (primary) vs outline/ghost (secondary). width:auto + max-width:100% = flex-safe, never overflows.
  const skin = variant === 'primary'
    ? `background:${BRAND_FILL};color:#1c1c1c;border:1px solid ${BRAND_FILL};`
    : `background:transparent;color:currentColor;border:1px solid currentColor;`;
  const style = `display:inline-block;padding:9px 18px;border-radius:6px;${skin}${famCss}font-size:${size}px;font-weight:600;text-decoration:none;white-space:nowrap;width:auto;max-width:100%;line-height:1.2;${WRAP}`;
  return { elType: 'widget', widgetType: 'button', settings: {
    text: t, button_type: variant === 'primary' ? 'success' : 'default', size: 'sm', align: 'left',
    // also render an inline-styled <a> twin in the button's "text" so the captured skin survives kses + theme rules.
    button_css_id: '',
    _struct_cta_html: `<a${href ? ` href="${esc(href)}"` : ''} style="${style}">${esc(t)}</a>`,
  } };
}
// We emit the styled CTA as an html widget carrying the inline <a> (button widget typography controls are unreliable
// on this stack; the inline <a> is byte-faithful + kses-safe), tagged as a button via role for the CTA detector.
function styledButtonWidget(text, href, variant, typo) {
  const sb = styledButton(text, href, variant, typo);
  if (!sb) return null;
  return { elType: 'widget', widgetType: 'html', settings: { html: sb.settings._struct_cta_html } };
}
// SECTION-LEVEL CTA DEDUP — the source layers a wrapping <a> button leaf OVER its own inner text-leaf at a near-
// identical box (hero "Start your project": button@576 + inner text@593). And a section can repeat the same CTA
// pair twice. Drop (a) any text-leaf wholly contained in a same-text button leaf, and (b) the 2nd+ occurrence of a
// repeated CTA-text. Returns {members:[…filtered], ctas:[…surviving CTA button leaves in x-order]}.
const SECTION_CTA_RX = /\b(get started|start( now| free| building| your project)?|sign ?up|sign ?in|log ?in|try( it)?( free| now)?|get( a)? demo|book( a)? demo|request( a)? demo|buy|subscribe|join|download|contact( sales| us)?|get( the)? app|talk to|view template|learn more)\b/i;
function dedupSectionCtas(members) {
  const ms = members.filter((m) => m && m.box);
  const drop = new Set();
  const norm = (m) => stripEmoji(m.text || '');
  const buttons = ms.filter((m) => m.kind === 'button' && norm(m));
  // (a) drop an inner text-leaf that is wholly inside a same-text button leaf (the duplicate inner <span>).
  for (const tx of ms) {
    if (tx.kind !== 'text' || !norm(tx)) continue;
    for (const b of buttons) {
      if (norm(b) !== norm(tx)) continue;
      const inside = tx.box.x >= b.box.x - 4 && tx.box.y >= b.box.y - 4 && (tx.box.x + tx.box.w) <= (b.box.x + b.box.w) + 4 && (tx.box.y + tx.box.h) <= (b.box.y + b.box.h) + 4;
      if (inside) { drop.add(tx); break; }
    }
  }
  // (b) drop the 2nd+ button with the same CTA text that sits at the SAME x,y band (true repeat within the section).
  const seen = new Map();
  for (const b of buttons.slice().sort((a, c) => a.box.y - c.box.y || a.box.x - c.box.x)) {
    const key = norm(b).toLowerCase();
    if (seen.has(key)) { const prev = seen.get(key); if (Math.abs(prev.box.x - b.box.x) < 12 && Math.abs(prev.box.y - b.box.y) > 20) drop.add(b); }
    else seen.set(key, b);
  }
  const kept = ms.filter((m) => !drop.has(m));
  return { members: kept, droppedCtas: drop.size };
}

// emit the widgets for a list of members (already a single column), in y-order, dropping nulls. When ctaCtx is set
// (hero), button members that read as a CTA render as STYLED button widgets (FIX 3) instead of plain text <a>.
function emitColumnWidgets(members, ctaCtx) {
  const out = [];
  for (const m of members) {
    const full = resolveMember(m);
    if (ctaCtx && full && full.kind === 'button' && SECTION_CTA_RX.test(stripEmoji(full.text || ''))) {
      const t = stripEmoji(full.text || '');
      // primary = the source primary-CTA copy ("start your project"); everything else → outline/ghost secondary.
      const variant = /start your project|get started|sign ?up|create( an)? account/i.test(t) ? 'primary' : 'secondary';
      const w = styledButtonWidget(t, full.href, variant, full.typo);
      if (w) { out.push(w); continue; }
    }
    const w = leafWidget(full); if (w) out.push(w);
  }
  return out;
}

// ===========================================================================
// SECTION → full-width flex CONTAINER. content_width=full, flex column, width 100%, section bg + min_height from
// bbox + vertical padding. Inside: cluster members into columns; if >1 column emit an inner flex ROW container
// whose children are the columns (each a flex child with flex-basis=(colW/sectionW)% + min-width:0); else emit the
// single column's widgets directly into the section column. Backgrounds use the segment band bg descriptor.
// ===========================================================================
function bandBgSettings(bg) {
  if (!bg || bg.kind === 'default' || !bg.value) return {};
  if (bg.kind === 'color' && opaque(bg.value)) return { background_background: 'classic', background_color: bg.value };
  if (bg.kind === 'gradient') { const c = gradientColor(bg.value); return c ? { background_background: 'classic', background_color: c } : {}; }
  if (bg.kind === 'image') return { background_background: 'classic', background_image: { url: localSrc(bg.value) }, background_size: 'cover', background_position: 'center center' };
  return {};
}
// CONTENT max-width: the boxed content column. Sections whose bbox spans nearly the full viewport are full-bleed
// (background runs edge-to-edge) but the INNER content row is capped to the boxed width and centered, so the
// section reflows without horizontal scroll. We pin the inner row's max-width, never a fixed px on a widget.
const CONTENT_MAXW = (() => {
  // the widest section bbox that is NOT full-bleed ≈ the content column; default 1280 (typical boxed Elementor).
  return Math.min(1280, Math.round(VW * 0.92));
})();

// build ONE column container: a flex child with PERCENT flex-basis (colW/sectionW) + min-width:0 so it shrinks.
// gridChild=true → the parent is a CSS GRID (RAM-grid path): the grid track governs the cell width, so we DROP the
// fixed %-flex-basis/width pin entirely and let the cell be an in-flow grid child (width:100% of its track). This is
// what makes the RAM grid reflow N→…→1: a %-basis cell would shrink-but-stay-N-up; a grid child re-tracks by width.
function columnContainer(col, sectionW, totalCols, ctaCtx, gridChild) {
  const widgets = emitColumnWidgets(col.members, ctaCtx);
  if (!widgets.length) return null;
  if (gridChild) {
    // GRID CHILD — no width/flex-basis pin; the auto-fit minmax track sizes it. Just a column stack of its widgets.
    const settings = {
      content_width: 'full', flex_direction: 'column',
      flex_gap: { unit: 'px', size: 12, column: '12', row: '12' },
      padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
    };
    return container(settings, widgets);
  }
  const colW = Math.max(1, col.x1 - col.x0);
  const basisPct = Math.max(8, Math.min(100, Math.round((colW / Math.max(1, sectionW)) * 100)));
  const settings = {
    content_width: 'full', flex_direction: 'column',
    // PERCENT flex-basis (NOT a fixed px width) + grow/shrink so the column reflows; min-width:0 via _element css
    // so a wide child cannot force the column past its basis. width:100% at narrow viewports (flex wraps the row).
    width: { unit: '%', size: basisPct }, _flex_basis: { unit: '%', size: basisPct },
    _flex_grow: '1', _flex_shrink: '1',
    flex_gap: { unit: 'px', size: 12, column: '12', row: '12' },
    padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
  };
  return container(settings, widgets);
}

// RAM-GRID stat (reported in the OK line): how many multi-column grid/card rows were emitted as a CSS grid track.
const RAMSTATS = { gridRows: 0 };
const RAMCSS = []; // scoped #id{display:grid;…} rules, injected page-wide via custom_css alongside the nav fallback.
let _ramId = 0; const idCounter = () => (++_ramId);
const NO_RAMGRID = process.env.STRUCT_NO_RAMGRID === '1' || process.env.FLOW_NO_RAMGRID === '1';

// ===========================================================================
// STRUCT_BENTOGRID (default ON since promotion — corrected 2026-06-09; opt out STRUCT_NO_BENTOGRID=1 or STRUCT_LEGACY=1 ⇒ byte-identical) — TILE-BENTO recipe. THE DOMINANT CLONE RESIDUAL: a dense
// feature-BENTO section (an N-col × M-row tile grid of icon/heading/body/mockup cells) stacks TALL under the
// clusterRows→rowColumns→flex path: the wide media in one tile overlaps the narrow text columns, chaining the row
// X-cluster into a single column, so each TILE stacks vertically and the M source rows render as one tall column
// (supabase #2: hRatio 3.08, +2182px = 42% of the page overage). RAM-grid (#35) only fires on a SINGLE row of
// comparable-width cells (M=1); GRIDFIX recovers ONE row's columns but still emits ONE flex row — neither places
// the 7 tiles across 2 ROWS. THE FIX: detect a true tile-grid (N≥2 cols × M≥2 rows × ≥4 headings) from the section
// HEADINGS (each tile is anchored by its heading), GROUP every non-heading member to its nearest heading (→ a tile
// = heading + its body/image stacked in a column), then EMIT ALL tiles into ONE CSS GRID (reusing the RAM-grid kses-
// safe channel: container_type:grid + grid_columns_grid custom unit + #ramgrid-N display:grid custom_css) so the
// tiles sit M rows × N cols instead of stacking → recovers the ~855px. A col-span-2 tile (its content ≈2× a column
// pitch, e.g. supabase's Postgres tile) gets grid-column:span 2. Track = auto-fit minmax(min(<colpitch>px,100%),1fr)
// so it reflows N→1 on narrow (no media query, no h-scroll — the min(...,100%) guard caps every track to the
// container). A hero/cta (no tile grid) or a single-ROW feature row (M=1, the RAM-grid case) NEVER qualifies.
// REVERSIBILITY: STRUCT_NO_BENTOGRID=1 ⇒ buildSection takes the unchanged clusterRows path → byte-identical.
const BENTOGRID = process.env.STRUCT_LEGACY !== '1' && process.env.STRUCT_NO_BENTOGRID !== '1';
const BENTOSTATS = { sections: 0, tiles: 0 };
const BENTO_HEAD_TOL = 28;     // x/y snap tolerance for clustering heading anchors into column/row anchors
const BENTO_MIN_HEADINGS = 4;  // a real tile grid has ≥4 heading-anchored tiles
// is THIS member a tile-anchoring heading? a captured heading, or a SHORT large-ish text leaf that reads as a tile
// title (segment.mjs often tags tile titles kind:'text' with no hN). We accept kind 'heading', plus a short text
// whose typo size is heading-ish (≥15px) and which is short (≤40 chars, single line h<56) — the tile-title shape.
function bentoIsHeading(m) {
  if (!m || !m.box) return false;
  if (m.kind === 'heading') return !!stripEmoji(m.text || '');
  return false; // conservative: only true headings anchor tiles (avoids hijacking body/label text)
}
// 1-D anchor clustering: snap values into anchor groups within tol; returns sorted group-mean anchors.
function clusterAnchors(vals, tol) {
  const sorted = [...vals].sort((a, b) => a - b);
  const groups = [];
  for (const v of sorted) {
    const g = groups[groups.length - 1];
    if (g && v <= g.max + tol) { g.sum += v; g.n++; g.max = v; g.min = Math.min(g.min, v); }
    else groups.push({ sum: v, n: 1, max: v, min: v });
  }
  return groups.map((g) => ({ mean: g.sum / g.n, n: g.n, min: g.min, max: g.max }));
}
// DETECT a tile-bento from a section's members. Returns { ok, colAnchors[], rowAnchors[], headings[], pitch } or
// { ok:false }. Qualify iff N(cols)≥2 AND M(rows)≥2 AND headings≥4 (a real N×M tile grid). A single-ROW feature
// row (M=1) is the RAM-grid case — NOT hijacked. A hero/cta (no tile grid) fails (too few headings / no 2nd row).
function bentoDetect(members) {
  if (!BENTOGRID) return { ok: false };
  const ms = (members || []).filter((m) => m && m.box && m.box.w > 0 && m.box.h > 0);
  const headings = ms.filter(bentoIsHeading);
  if (headings.length < BENTO_MIN_HEADINGS) return { ok: false };
  const colAnchors = clusterAnchors(headings.map((h) => h.box.x), BENTO_HEAD_TOL).map((g) => g.mean);
  const rowAnchors = clusterAnchors(headings.map((h) => h.box.y), BENTO_HEAD_TOL).map((g) => g.mean);
  if (colAnchors.length < 2 || rowAnchors.length < 2) return { ok: false };  // N≥2 AND M≥2 (M=1 is the RAM-grid case)
  // column pitch = median inter-anchor spacing (used for the auto-fit minmax track + col-span detection).
  const gaps = []; for (let i = 1; i < colAnchors.length; i++) gaps.push(colAnchors[i] - colAnchors[i - 1]);
  const pitch = gaps.length ? median(gaps) : 283;
  return { ok: true, colAnchors, rowAnchors, headings, pitch, N: colAnchors.length, M: rowAnchors.length };
}
// snap a value to the nearest anchor index in a sorted anchor list.
function snapAnchor(v, anchors) {
  let bi = 0, bd = Infinity; for (let i = 0; i < anchors.length; i++) { const d = Math.abs(v - anchors[i]); if (d < bd) { bd = d; bi = i; } }
  return bi;
}
// GROUP members into TILES. Each heading is a tile seed (assigned to its (col,row) anchor cell). Each NON-heading
// member is assigned to its NEAREST heading by CENTER distance, biased to the SAME column (a member in heading H's
// column is pulled to H even if a heading in the next column is geometrically a hair closer). Returns an ordered
// (row-major: top→bottom, then left→right) array of tiles, each { col, row, members:[…in y-order], heading }.
function bentoTiles(det, members) {
  const ms = (members || []).filter((m) => m && m.box && m.box.w > 0 && m.box.h > 0);
  const { colAnchors, rowAnchors, headings } = det;
  // seed one tile per heading at its (col,row) CELL.
  const tiles = headings.map((h) => {
    const col = snapAnchor(h.box.x, colAnchors), row = snapAnchor(h.box.y, rowAnchors);
    return { col, row, heading: h, members: [h], cx: colAnchors[col], cy: rowAnchors[row], hx: h.box.x };
  });
  const headSet = new Set(headings);
  // assign each non-heading member to the heading that OWNS its (col,row) CELL. A tile owns its own column AND every
  // empty column to its right up to the next heading in the SAME ROW (this is the col-span case: the Postgres tile
  // heading sits at col0 with NO heading at col1, so it owns col0+col1 — its wide mockup, which centers in col1,
  // belongs to Postgres, not to the col2 Authentication heading). Algorithm: snap the member to its (col,row); among
  // the tiles IN THAT ROW, pick the one whose column is the nearest-at-or-LEFT of the member's column (the tile that
  // "starts" the member's column run). If no tile is at-or-left in that row, fall back to the nearest-center tile
  // (handles a member that drifts above its row band or a degenerate row). This makes wide media span-aware WITHOUT
  // raw center distance pulling it to a geometrically-closer neighbour in the next column.
  for (const m of ms) {
    if (headSet.has(m)) continue;
    const mcx = m.box.x + m.box.w / 2, mcy = m.box.y + m.box.h / 2;
    // a WIDE member (≥1.5× the column pitch) is span-bearing — anchor it by its LEFT-EDGE column (where the span
    // STARTS); a narrow member is anchored by its CENTER column. This is what keeps a 2-pitch mockup with the tile
    // it sits beneath (left edge) instead of the column its center happens to land in.
    const wide = m.box.w >= det.pitch * 1.5;
    const mcol = snapAnchor(wide ? m.box.x : mcx, colAnchors);
    const mrow = snapAnchor(mcy, rowAnchors);
    const inRow = tiles.filter((t) => t.row === mrow).sort((a, b) => a.col - b.col);
    let best = null;
    // OWNER = the tile in the member's row whose column is the nearest-at-or-LEFT of the member's column (the tile
    // that starts the column run containing the member — owns its own column + empty columns to its right).
    for (const t of inRow) if (t.col <= mcol && (!best || t.col > best.col)) best = t;
    if (!best) { // no at-or-left tile in this row → nearest-center across all tiles (degenerate fallback)
      let bd = Infinity; for (const t of tiles) { const d = Math.hypot(t.cx - mcx, t.cy - mcy); if (d < bd) { bd = d; best = t; } }
    }
    if (best) best.members.push(m);
  }
  // TILE-INTERNAL IMAGE-LAYER COLLAPSE — a source tile composites its mockup as several OVERLAPPING image/svg/mockup
  // layers in the SAME visual band (e.g. supabase's Data APIs tile: 3 images at y≈1211-1248 all overlapping). A
  // vertical tile stack would render those 3 layers as 3 stacked ~390px images → a ~1180px tile (the residual that
  // kept sec-2 hRatio ~2.0). Since the source paints them ON TOP of each other (one visual), keep only the LARGEST
  // image-layer per overlapping cluster and drop the rest. Strictly image-kind layers that VERTICALLY OVERLAP (their
  // y-spans intersect by >50% of the smaller) collapse; text/heading/list are never touched. This recovers the row-2
  // height without changing the tile's visual (the dominant layer is the one the source shows on top).
  for (const t of tiles) {
    const imgs = t.members.filter((m) => m.kind === 'image' || m.kind === 'svg' || m.kind === 'mockup');
    if (imgs.length < 2) continue;
    const drop = new Set();
    const byArea = [...imgs].sort((a, b) => (b.box.w * b.box.h) - (a.box.w * a.box.h));
    for (let i = 0; i < byArea.length; i++) {
      if (drop.has(byArea[i])) continue;
      const A = byArea[i].box, ay0 = A.y, ay1 = A.y + A.h;
      for (let j = i + 1; j < byArea.length; j++) {
        if (drop.has(byArea[j])) continue;
        const B = byArea[j].box, by0 = B.y, by1 = B.y + B.h;
        const ov = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
        const minH = Math.max(1, Math.min(A.h, B.h));
        if (ov / minH > 0.5) drop.add(byArea[j]);          // a smaller layer overlapping the larger → it is a layer, drop it
      }
    }
    if (drop.size) t.members = t.members.filter((m) => !drop.has(m));
  }
  for (const t of tiles) t.members.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  // row-major DOM order so grid auto-flow:row places them across N columns, M rows (top row left→right, then next).
  tiles.sort((a, b) => a.row - b.row || a.col - b.col);
  return tiles;
}
// BUILD the tile-bento as ONE CSS GRID (reuses the RAM-grid kses-safe channel). Each tile → a column stack (its
// heading + body/image, via columnContainer gridChild=true so no width pin). A tile that owns an EMPTY column to its
// right (i.e. there is a GAP between its heading column and the next heading column IN ITS ROW, e.g. supabase's
// Postgres tile at col0 in a row whose next heading is col2 → it spans col0+col1) gets grid-column:span 2 via a
// scoped per-tile #bento-N-K{grid-column:span 2} rule. Track = repeat(auto-fit, minmax(min(<pitch>px,100%),1fr)) so
// N tiles fit the content width AND it reflows N→1 on narrow (no media query, no h-scroll: the min(…,100%) inner
// guard caps every track to the container). Returns the grid container element, or null if <2 tiles survive.
function buildBentoGrid(det, members, sectionW, ctaCtx) {
  const tiles = bentoTiles(det, members);
  const built = tiles.map((t) => ({ t, el: columnContainer({ members: t.members, x0: 0, x1: 1 }, sectionW, tiles.length, ctaCtx, true) })).filter((x) => x.el);
  if (built.length < 2) return null;
  const gridId = `ramgrid-${idCounter()}`;          // REUSE the RAM-grid scoped channel (#ramgrid-N display:grid)
  // TIGHT gaps for a tile-bento: the source tiles pack densely (a row pitch barely larger than one tile's media),
  // so a generous 24px grid gap inflates each of the M rows. A 16px grid gap separates tiles without padding rows.
  const gap = 16;
  const N = det.N;
  // TRACK FLOOR — size the auto-fit minmax floor so EXACTLY N columns fit the boxed content width (NOT the raw source
  // pitch). The source heading-anchor pitch (~283px on supabase) INCLUDES the inter-column gap; using it as the track
  // floor makes 4×283 + 3×gap > the ~1140px boxed content → only 3 tracks fit → the span-2 + singles WRAP into >2 rows
  // → staggered, inflated height (the residual that kept hRatio ~2.0). Deriving the floor from contentW/N − gap fits N
  // tracks reliably AND the min(…,100%) guard still reflows N→fewer→1 on narrow (no media query, no h-scroll).
  const contentW = Math.min(CONTENT_MAXW, round(sectionW));
  const fitFloor = Math.floor((contentW - (N - 1) * gap) / N);     // px per track so N fit the content width
  const colPitch = Math.max(140, Math.min(fitFloor, round(sectionW * 0.45)));
  // COL-SPAN from the GRID STRUCTURE (not raw member extent — a stray overflow image must not widen a tile): per
  // ROW, the sorted heading-occupied columns; a tile spans from its column to the NEXT occupied column in its row
  // (or to N if it is the last). span = nextCol − ownCol; a span ≥2 → grid-column:span <span>. Row1 here is fully
  // occupied {0,1,2,3} → every span=1 (no spurious spans); Row0 is {0,2,3} → col0 spans 2 (Postgres), col2/col3 span 1.
  // Computed BEFORE the track so maxSpan can size the mobile-safe inner cap below.
  const occByRow = {};
  for (const { t } of built) { (occByRow[t.row] = occByRow[t.row] || []).push(t.col); }
  for (const r in occByRow) occByRow[r].sort((a, b) => a - b);
  const spanRules = [];
  let maxSpan = 1;
  for (const { t, el } of built) {
    BENTOSTATS.tiles++;
    const occ = occByRow[t.row] || [t.col];
    const idxInRow = occ.indexOf(t.col);
    const nextCol = (idxInRow >= 0 && idxInRow < occ.length - 1) ? occ[idxInRow + 1] : N;
    const span = Math.max(1, Math.min(nextCol - t.col, N));      // columns this tile occupies before the next heading
    if (span > maxSpan) maxSpan = span;
    if (span >= 2) {
      const tid = `bento-${gridId}-${spanRules.length}`;
      el.settings._element_id = tid;
      spanRules.push(`#${tid}{grid-column:span ${span}}`);
    }
  }
  // SPAN-AWARE MOBILE-SAFE TRACK FLOOR — a `grid-column:span S` tile FORCES auto-fit to materialize S column tracks
  // even when the container is too narrow to hold S floor-sized tracks. The plain `min(<floor>px,100%)` inner cap only
  // caps ONE track to the container, so the FIRST track eats `min(floor,100%)` (≈ the whole narrow viewport) and the
  // remaining (S−1) tracks collapse to slivers whose min-content content spills past the viewport (supabase #2: the
  // 308px floor == the 350px mobile content box → the span-2's 2nd track squeezed to 26px, its 74px content overflowed
  // +28px → body scrollWidth 418 at 390). FIX: cap each track at a per-track SHARE = (100% − (maxSpan−1)·gap)/maxSpan,
  // so even when maxSpan tracks are forced they (plus their gaps) fit the container at ANY width. Desktop is unchanged
  // (the px floor still governs there — the share only bites once the container narrows below maxSpan·floor). No fixed
  // px width is introduced: the cap is a calc() of 100% and the gap. maxSpan==1 ⇒ share==100% ⇒ byte-identical track.
  const innerCap = maxSpan > 1 ? `calc((100% - ${(maxSpan - 1) * gap}px) / ${maxSpan})` : '100%';
  const track = `repeat(auto-fit, minmax(min(${colPitch}px, ${innerCap}), 1fr))`;
  const gridChildren = built.map((x) => x.el);
  const gridEl = container({
    content_width: 'full', container_type: 'grid',
    grid_columns_grid: { unit: 'custom', size: track },
    grid_rows_grid: { unit: 'fr', size: 'auto' },
    grid_gaps: { column: String(gap), row: String(gap), unit: 'px', isLinked: false },
    grid_auto_flow: 'row', flex_align_items: 'flex-start',
    width: { unit: '%', size: 100 },
    padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
    _element_id: gridId,
  }, gridChildren);
  RAMSTATS.gridRows++;
  RAMCSS.push(`#${gridId}{display:grid !important;grid-template-columns:${track} !important;gap:${gap}px !important;align-items:start}`);
  for (const r of spanRules) RAMCSS.push(r);
  return gridEl;
}

// ===========================================================================
// STRUCT_CARDWALL (default ON since promotion — corrected 2026-06-09; opt out STRUCT_NO_CARDWALL=1 or STRUCT_LEGACY=1 ⇒ byte-identical) — HEADING-LESS MASONRY CARD-WALL recipe. A dense, heading-light
// wall of many comparable-WIDTH cards laid out at regularly-pitched x-anchors (supabase #9: 14 cards across the
// "Build in a weekend / Scale to billions" feature wall; #10: 6 cards). Under the clusterRows→rowColumns→flex path
// these stack TALL (#9 hRatio 1.60, #10 1.46) because a wide member chains the x-cluster into one column. THE FIX:
// detect the wall (≥6 comparable-width cards at ≥3 REGULARLY-pitched x-anchors — the pitch-regularity CV guard is the
// LOAD-BEARING discriminator that produced ZERO corpus false-positives), then emit ALL cards as ONE CSS MULTI-COLUMN
// block (#cardwall-N{columns:<pitch>px;column-gap} + per-card break-inside:avoid). CSS columns auto-flow N→…→1 by
// width with NO media query, NO fixed-px container width (columns:<pitch>px is a track HINT not a width) → no h-scroll.
// A full-bleed member (≥85% section width, e.g. #9's mockup backdrop) is EXCLUDED from the card set and instead
// rendered BEHIND the cards via the scoped custom_css background-image channel (#<secId>{background-image:url(...)}),
// the SAME kses-safe channel as RAMCSS/COLWCSS/LINKCOLS — the element-tree background_image setting is kses-STRIPPED
// on this 4.0.9 stack, but custom_css is not. REVERSIBILITY: STRUCT_NO_CARDWALL=1 ⇒ buildSection takes the unchanged
// path → byte-identical.
const CARDWALL = process.env.STRUCT_LEGACY !== '1' && process.env.STRUCT_NO_CARDWALL !== '1';
const CARDWALLCSS = []; // scoped #cardwall-N{columns:<pitch>px;column-gap} + #cardwall-N>*{break-inside:avoid} + #<secId>{background-image:…} rules, injected page-wide via custom_css.
const CARDWALLSTATS = { walls: 0, cards: 0, backdrops: 0 };
const CARDWALL_GAP = 24;           // column-gap between masonry tracks (matches the inner flex gap)
const CARDWALL_CARD_GAP_Y = 56;    // a vertical gap > this within a column opens a new CARD (matches proto)
// DETECT a heading-less masonry card-wall from a section's resolved members. Returns { ok, pitch, cols[], backdrop }
// where cols[] = ordered (left→right) column buckets of card members and backdrop = the excluded full-bleed member
// (or null). Qualify iff: ≥6 cards, ≥3 columns at REGULARLY-pitched x-anchors (gap-CV ≤ 0.25 — the guard), heading-
// light (≤30% of cards carry a heading), ≥1.3 cards/column. A hero, a feature-tile bento (heading-heavy), a logo
// strip (few cards), an irregular image-mosaic (high pitch-CV, e.g. supabase #4) all FAIL → fall through unchanged.
function cardwallDetect(members, sb, isHero) {
  if (!CARDWALL || isHero) return { ok: false };
  const sectionW = (sb && sb.w) || VW;
  const ms = (members || []).filter((m) => m && m.box && m.box.w > 0 && m.box.h > 0);
  // EXCLUDE any full-bleed member (≥85% section width) from the card set — it is a backdrop/banner, not a card.
  const fullBleed = ms.filter((m) => m.box.w >= 0.85 * sectionW);
  const backdrop = fullBleed.filter((m) => m.kind === 'image' || m.kind === 'svg' || m.kind === 'mockup')
    .sort((a, b) => (b.box.w * b.box.h) - (a.box.w * a.box.h))[0] || null;
  let cand = ms.filter((m) => m.box.w < 0.85 * sectionW);
  if (cand.length < 8) return { ok: false };
  const wides = cand.filter((m) => m.box.w >= 100).map((m) => m.box.w);
  if (wides.length < 6) return { ok: false };
  const cardW = median(wides);
  // drop SPAN-bearing members (>1.4× card width) — they are not single cards (a banner/wide media chains the cluster).
  cand = cand.filter((m) => m.box.w <= cardW * 1.4);
  if (cand.length < 6) return { ok: false };
  const bodies = cand.filter((m) => Math.abs(m.box.w - cardW) <= 0.25 * cardW);
  if (bodies.length < 3) return { ok: false };
  // X-ANCHOR clustering of the body-width members → the column anchors of the wall.
  const atol = Math.max(40, cardW * 0.25);
  const aGroups = [];
  for (const m of [...bodies].sort((a, b) => a.box.x - b.box.x)) {
    let g = aGroups.find((G) => Math.abs(G.x - m.box.x) <= atol);
    if (!g) { g = { x: m.box.x, n: 0, sum: 0 }; aGroups.push(g); }
    g.n++; g.sum += m.box.x; g.x = g.sum / g.n;
  }
  const anchors = aGroups.map((g) => g.x).sort((a, b) => a - b);
  if (anchors.length < 3) return { ok: false };
  // PITCH-REGULARITY (THE GUARD): inter-anchor gaps must be UNIFORM (a real masonry grid). CV = stdev/mean of gaps.
  // An irregular layout (image mosaic, mixed-width hero collage — supabase #4 gcv≈0.47) has a high CV → rejected.
  const gaps = []; for (let i = 1; i < anchors.length; i++) gaps.push(anchors[i] - anchors[i - 1]);
  const gm = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const gv = gaps.reduce((a, b) => a + (b - gm) * (b - gm), 0) / gaps.length;
  const gcv = gm ? Math.sqrt(gv) / gm : 99;
  // assign each candidate card to its nearest anchor (within 1.5× tol) → column buckets.
  const cols = anchors.map((a) => ({ x: a, members: [] }));
  for (const m of cand) { let bi = 0, bd = Infinity; for (let i = 0; i < anchors.length; i++) { const d = Math.abs(m.box.x - anchors[i]); if (d < bd) { bd = d; bi = i; } } if (bd <= atol * 1.5) cols[bi].members.push(m); }
  const realCols = cols.filter((c) => c.members.length >= 2);
  if (realCols.length < 3) return { ok: false };
  // count CARDS per column (a vertical gap > CARD_GAP_Y opens a new card) + how many carry a heading (heading-light).
  let totalCards = 0, headingCards = 0;
  for (const c of realCols) {
    const sorted = [...c.members].sort((a, b) => a.box.y - b.box.y);
    let card = null;
    for (const m of sorted) {
      if (!card || (m.box.y - card.y1) > CARDWALL_CARD_GAP_Y) { card = { y1: m.box.y + m.box.h, hasH: m.kind === 'heading' }; totalCards++; }
      else { card.y1 = Math.max(card.y1, m.box.y + m.box.h); card.hasH = card.hasH || m.kind === 'heading'; }
      if (card.hasH && card._counted !== true) { /* count once per card below */ }
    }
    // recount heading-cards cleanly (a card with ≥1 heading member)
    let cc = null; const cardsArr = [];
    for (const m of sorted) { if (!cc || (m.box.y - cc.y1) > CARDWALL_CARD_GAP_Y) { cc = { y1: m.box.y + m.box.h, hasH: false }; cardsArr.push(cc); } else cc.y1 = Math.max(cc.y1, m.box.y + m.box.h); cc.hasH = cc.hasH || m.kind === 'heading'; }
    for (const cd of cardsArr) if (cd.hasH) headingCards++;
  }
  const cardsPerCol = totalCards / realCols.length;
  const headingLight = headingCards <= Math.max(1, Math.floor(totalCards * 0.30));
  const ok = totalCards >= 6 && realCols.length >= 3 && headingLight && cardsPerCol >= 1.3 && gcv <= 0.25;
  if (!ok) return { ok: false };
  // pitch for the CSS columns track = the median inter-anchor gap (the natural card pitch).
  const pitch = Math.max(160, Math.round(median(gaps)));
  return { ok: true, pitch, cols: realCols, cardW: Math.round(cardW), totalCards, backdrop, gcv };
}
// BUILD the card-wall as ONE CSS MULTI-COLUMN block. Each card member is emitted as a leaf widget; cards are wrapped
// per-card so break-inside:avoid keeps a card intact across column breaks. The container is given #cardwall-N and a
// scoped #cardwall-N{columns:<pitch>px;column-gap:<gap>px} rule auto-flows them into as many tracks as fit width:100%
// (reflows N→…→1 with no media query, no fixed-px width). Returns the container element, or null if <2 cards survive.
function buildCardwall(det, sectionW, ctaCtx) {
  // re-derive cards in DOM order (column-major: each column top→bottom, columns left→right) — masonry CSS columns
  // fill column-by-column, so emitting column-major preserves the source reading order within each track.
  const cardEls = [];
  for (const c of det.cols) {
    const sorted = [...c.members].sort((a, b) => a.box.y - b.box.y);
    let cur = null; const cards = [];
    for (const m of sorted) {
      if (!cur || (m.box.y - cur.y1) > CARDWALL_CARD_GAP_Y) { cur = { y1: m.box.y + m.box.h, members: [m] }; cards.push(cur); }
      else { cur.y1 = Math.max(cur.y1, m.box.y + m.box.h); cur.members.push(m); }
    }
    for (const cd of cards) {
      cd.members.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
      // each card = a flex column of its widgets (no width pin — the CSS column track governs width). gridChild=true
      // reuses columnContainer's pin-free shape so break-inside:avoid is the only width constraint.
      const el = columnContainer({ members: cd.members, x0: 0, x1: 1 }, sectionW, det.cols.length, ctaCtx, true);
      if (el) cardEls.push(el);
    }
  }
  if (cardEls.length < 2) return null;
  const wallId = `cardwall-${idCounter()}`;
  // tag each card so break-inside:avoid applies per card (keeps a card from splitting across a column break).
  for (let i = 0; i < cardEls.length; i++) {
    const cid = `${wallId}-c${i}`;
    cardEls[i].settings._element_id = cid;
    CARDWALLCSS.push(`#${cid}{break-inside:avoid;-webkit-column-break-inside:avoid;margin:0 0 ${CARDWALL_GAP}px}`);
    CARDWALLSTATS.cards++;
  }
  // the wall container: a plain full-width block; the scoped rule turns it into a CSS multi-column track. NEVER a
  // bare fixed-px width — columns:<pitch>px is a track-size HINT (the browser fits as many <pitch>px columns as the
  // width allows), so it reflows down to 1 column on narrow with no horizontal scroll.
  const wallEl = container({
    content_width: 'full', flex_direction: 'column',
    width: { unit: '%', size: 100 },
    padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
    _element_id: wallId,
  }, cardEls);
  CARDWALLCSS.push(`#${wallId}{display:block !important;columns:${det.pitch}px;column-gap:${CARDWALL_GAP}px}`);
  CARDWALLSTATS.walls++;
  return wallEl;
}

// ===========================================================================
// STRUCT_IRREGBENTO (default ON since promotion — corrected 2026-06-09; opt out STRUCT_NO_IRREGBENTO=1 or STRUCT_LEGACY=1 ⇒ byte-identical) — IRREGULAR IMAGE-MOSAIC recipe. The genuinely-irregular cousin
// of BENTOGRID/CARDWALL that NEITHER claims: a designed customer-stories / logo-mosaic / case-study collage of media
// cards laid out across columns with VARYING cell sizes + spans on a COARSE grid (supabase #4: gcv≈0.47, +292px,
// hRatio 1.31 — the largest remaining residual). BENTOGRID requires ≥4 tile HEADINGS (this mosaic has 1); CARDWALL
// requires a REGULAR pitch (gcv ≤ 0.25 — this mosaic's high pitch-CV is exactly what makes it irregular). So it falls
// to the flex path, where a wide member chains the x-cluster into one column and every card STACKS → a tall section.
//
// DIAGNOSIS (the load-bearing fact): the members do NOT overlap — ZERO member-pairs intersect in both x AND y. It is
// IRREGULAR-NON-OVERLAP (uneven cells on a coarse grid), NOT true free-form overlap. So a REFLOWING CSS grid with
// per-column stacks fully represents it — NO z-index layering, NO position:absolute, NO h-scroll. THE FIX: split off
// the section HEADER (title/subtitle/CTAs above the mosaic band), cluster the mosaic media+caption members into
// COLUMN x-anchors, stack each column's members vertically, and emit all columns into ONE CSS GRID whose track is
// repeat(auto-fit, minmax(min(<pitch>px,100%),1fr)) — the SAME kses-safe channel as BENTOGRID/RAM-grid. The
// min(...,100%) inner guard caps every track to the container so a source-clipped carousel item that overflows past
// the viewport (supabase #4 has caption right-edges at x1≈1681) is CONTAINED, never a fixed-px width → no h-scroll.
// REVERSIBILITY: STRUCT_NO_IRREGBENTO=1 (or STRUCT_LEGACY=1) ⇒ buildSection never calls this → byte-identical.
const IRREGBENTO = process.env.STRUCT_LEGACY !== '1' && process.env.STRUCT_NO_IRREGBENTO !== '1'; // default ON. STRUCT_LEGACY=1 or STRUCT_NO_IRREGBENTO=1 ⇒ byte-identical legacy path. Packs irregular image-mosaics via CSS grid (no absolute, no h-scroll).
const IRREGBENTOSTATS = { sections: 0, cols: 0 };
const IRREG_COL_TOL = 40;          // x-start snap tolerance for clustering members into column anchors
const IRREG_HEADER_GAP = 48;       // a vertical gap > this between the header band and the first media row splits them
const IRREG_MIN_MEDIA = 4;         // a real image-mosaic has ≥4 media cells
// is this member media (image/svg/mockup)?
function irregIsMedia(m) { return m && (m.kind === 'image' || m.kind === 'svg' || m.kind === 'mockup'); }
// DETECT an irregular image-mosaic from a section's resolved members. Returns { ok, header[], cols[], pitch, gcv } or
// { ok:false }. Conservative — qualifies ONLY when: ≥4 media members, an IRREGULAR coarse-grid layout (≥3 media
// column x-anchors AND the inter-anchor pitch is IRREGULAR, gcv > 0.25 — the discriminator CARDWALL rejects), the
// mosaic is MULTI-ROW (≥1 column stacks ≥2 members, i.e. it is a true 2-D mosaic not a single logo strip), and the
// members do NOT free-form overlap (≤1 media-media pair intersects in both axes — confirms a reflowing grid suffices;
// a heavily-overlapping collage that genuinely needs layering is REPORTED, not faked with an h-scroll/absolute build).
// A hero/cta (handled by isHero gate at the call site), a heading-heavy bento (BENTOGRID claims it first), a regular
// card-wall (low gcv → CARDWALL claims it first), or a normal single-row grid (no 2nd row) all FALL THROUGH unchanged.
function irregBentoDetect(members, sb) {
  if (!IRREGBENTO) return { ok: false };
  const sectionW = (sb && sb.w) || VW;
  const ms = (members || []).filter((m) => m && m.box && m.box.w > 0 && m.box.h > 0);
  const media = ms.filter(irregIsMedia);
  if (media.length < IRREG_MIN_MEDIA) return { ok: false };
  // FREE-FORM-OVERLAP GUARD: count media-media pairs that intersect in BOTH x and y by >10% of the smaller box. A
  // true reflowing grid only works if cells do NOT layer. >1 such pair ⇒ free-form collage → DO NOT fake it.
  let overlapPairs = 0;
  for (let i = 0; i < media.length; i++) for (let j = i + 1; j < media.length; j++) {
    const A = media[i].box, B = media[j].box;
    const ox = Math.max(0, Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x));
    const oy = Math.max(0, Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y));
    if (ox > 4 && oy > 4 && (ox * oy) / Math.max(1, Math.min(A.w * A.h, B.w * B.h)) > 0.10) overlapPairs++;
  }
  if (overlapPairs > 1) return { ok: false, freeform: true };
  // SPLIT the HEADER (the title/subtitle/CTA band above the mosaic). The mosaic starts at the first media row's top;
  // a member whose top is above (firstMediaTop − IRREG_HEADER_GAP) is header, the rest is mosaic body.
  const firstMediaTop = Math.min(...media.map((m) => m.box.y));
  const header = ms.filter((m) => m.box.y + m.box.h <= firstMediaTop - IRREG_HEADER_GAP + (m.box.h));
  const headerSet = new Set(ms.filter((m) => (m.box.y) < firstMediaTop - IRREG_HEADER_GAP));
  const body = ms.filter((m) => !headerSet.has(m));
  const bodyMedia = body.filter(irregIsMedia);
  if (bodyMedia.length < IRREG_MIN_MEDIA) return { ok: false };
  // COLUMN x-ANCHORS from the body members' LEFT edges (clusterAnchors reused). The mosaic body is a set of columns.
  const colAnchors = clusterAnchors(body.map((m) => m.box.x), IRREG_COL_TOL).map((g) => g.mean);
  // count anchors driven by MEDIA (a real mosaic column has a media card) — must be ≥3 for a true mosaic.
  const mediaAnchors = clusterAnchors(bodyMedia.map((m) => m.box.x), IRREG_COL_TOL).map((g) => g.mean);
  if (mediaAnchors.length < 3) return { ok: false };
  // PITCH-IRREGULARITY (THE DISCRIMINATOR) — computed THE SAME WAY CARDWALL computes its reject-guard: over the
  // anchors of the DOMINANT-WIDTH media cards (the comparable-size cards, within ±25% of the median media width).
  // This is the gcv CARDWALL SAW when it declined this section (supabase #4: anchors {0,266,998} → gaps {266,732} →
  // gcv≈0.47). gcv > 0.25 ⇒ IRREGULAR (this recipe's domain); gcv ≤ 0.25 ⇒ a REGULAR grid CARDWALL declined for a
  // non-pitch reason (too few cards, etc.) — those are RAM-grid/flex cases, not irregular mosaics → fall through.
  const medW = median(bodyMedia.map((m) => m.box.w));
  const domCards = bodyMedia.filter((m) => Math.abs(m.box.w - medW) <= 0.25 * medW);
  const domAnchors = clusterAnchors(domCards.map((m) => m.box.x), Math.max(40, medW * 0.25)).map((g) => g.mean);
  if (domAnchors.length < 2) return { ok: false };
  const gaps = []; for (let i = 1; i < domAnchors.length; i++) gaps.push(domAnchors[i] - domAnchors[i - 1]);
  const gm = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const gv = gaps.length ? gaps.reduce((a, b) => a + (b - gm) * (b - gm), 0) / gaps.length : 0;
  const gcv = gm ? Math.sqrt(gv) / gm : 99;
  if (gcv <= 0.25) return { ok: false };  // regular pitch → CARDWALL/RAM-grid territory, not our irregular case
  // ASSIGN each body member to its nearest column anchor (by left edge) → per-column vertical stacks.
  const cols = colAnchors.map((a) => ({ x: a, members: [] }));
  for (const m of body) { let bi = 0, bd = Infinity; for (let i = 0; i < colAnchors.length; i++) { const d = Math.abs(m.box.x - colAnchors[i]); if (d < bd) { bd = d; bi = i; } } cols[bi].members.push(m); }
  const realCols = cols.filter((c) => c.members.length >= 1);
  if (realCols.length < 3) return { ok: false };
  // MULTI-ROW guard: a TRUE mosaic stacks ≥2 members in ≥1 column (so it is 2-D); a single logo strip (every column
  // exactly 1 member, all at one y) is NOT this recipe's case (RAM-grid / logo-strip handles it) → fall through.
  const multiRow = realCols.some((c) => c.members.length >= 2);
  if (!multiRow) return { ok: false };
  // pitch for the grid track floor = the median MEDIA card width (the natural column width), not the source anchor
  // pitch (which includes the inter-column gap and the carousel overflow). Clamped ≥140 so a stray narrow logo cannot
  // collapse the track. The grid then fits as many <pitch>-floored tracks as the content width allows.
  const mediaW = median(bodyMedia.map((m) => m.box.w));
  const pitch = Math.max(140, Math.round(mediaW));
  return { ok: true, header, cols: realCols, pitch, gcv, nMedia: bodyMedia.length };
}
// BUILD the irregular mosaic: the HEADER band (rendered as its own row stack, unchanged shape) followed by ONE CSS
// GRID of per-column stacks. Track = repeat(auto-fit, minmax(min(<pitch>px,100%),1fr)) so N columns fit the content
// width AND reflow N→…→1 on narrow (the min(...,100%) guard caps every track to the container — NO h-scroll, NO
// fixed-px width, NO position:absolute). Each column is a pin-free grid child (columnContainer gridChild=true).
// Returns { headerEls[], gridEl } or null if <2 columns survive.
function buildIrregBento(det, sectionW, ctaCtx) {
  const cols = [...det.cols].sort((a, b) => a.x - b.x);
  const built = cols.map((c) => {
    c.members.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    return columnContainer({ members: c.members, x0: 0, x1: 1 }, sectionW, cols.length, ctaCtx, true);
  }).filter(Boolean);
  if (built.length < 2) return null;
  const gridId = `ramgrid-${idCounter()}`;            // REUSE the kses-safe RAM-grid scoped channel (#ramgrid-N grid)
  const gap = 16;                                       // tight gap (matches BENTOGRID — dense mosaic cells)
  const N = built.length;
  // TRACK FLOOR — fit N columns into the boxed content width (NOT the raw source pitch which includes gaps+overflow).
  // contentW/N − gap gives each track room for N to fit; the min(...,100%) guard still reflows on narrow. We floor at
  // the natural media card width (det.pitch) so cards never balloon, and cap at contentW/N so all N fit one row.
  const contentW = Math.min(CONTENT_MAXW, round(sectionW));
  const fitFloor = Math.floor((contentW - (N - 1) * gap) / N);
  const colPitch = Math.max(140, Math.min(det.pitch, fitFloor));
  const track = `repeat(auto-fit, minmax(min(${colPitch}px, 100%), 1fr))`;
  const gridEl = container({
    content_width: 'full', container_type: 'grid',
    grid_columns_grid: { unit: 'custom', size: track },
    grid_rows_grid: { unit: 'fr', size: 'auto' },
    grid_gaps: { column: String(gap), row: String(gap), unit: 'px', isLinked: false },
    grid_auto_flow: 'row', flex_align_items: 'flex-start',
    width: { unit: '%', size: 100 },
    padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
    _element_id: gridId,
  }, built);
  RAMSTATS.gridRows++;
  RAMCSS.push(`#${gridId}{display:grid !important;grid-template-columns:${track} !important;gap:${gap}px !important;align-items:start}`);
  IRREGBENTOSTATS.sections++; IRREGBENTOSTATS.cols += built.length;
  // HEADER as a normal row stack (each header member → a leaf; the buildSection inner box stacks them above the grid).
  const headerEls = [];
  if (det.header && det.header.length) {
    const rows = clusterRows(det.header);
    for (const r of rows) { const b = rowContainer(r, sectionW, ctaCtx); if (b.rowEl) headerEls.push(b.rowEl); else if (b.widgets && b.widgets.length) headerEls.push(...b.widgets); }
  }
  return { headerEls, gridEl };
}

// ===========================================================================
// STRUCT_LINKCOLS (default ON since promotion — corrected 2026-06-09; opt out STRUCT_NO_LINKCOLS=1 or STRUCT_LEGACY=1 ⇒ byte-identical) — CSS MULTI-COLUMN recipe for LONG BARE-ANCHOR LINK LISTS
// (footer sitemaps, index lists, "And there's more" link grids). THE BUG (measured on basecamp, the dominant
// height inflator): the source footer index is one COMPACT CSS-columns <ul> (box 1257×143: 27 short anchors auto-
// flowed into ~6 short columns). The builder renders that <ul> as a PLAIN block list — every <li> stacks 1-per-row
// into ONE tall full-width column → the 143px source list becomes ~27 rows (~770px) → footer 492→1235px (ratio
// 2.51, +743px). RAM-grid (#35) only fires on comparable-width card/GRID cells (≥2 cells per X-cluster), NEVER on a
// bare-anchor list (it has no columns to compare), so there is NO multi-column-list recipe — until this one.
//
// THE FIX: detect a LINK-LIST and emit it as a CSS MULTI-COLUMN block instead of a vertical stack. Two source shapes:
//   (a) LIST-WIDGET (the basecamp shape): a `list` leaf whose items[] are ≥8 SHORT bare anchors (≥80% have href) —
//       render the <ul> with a scoped #linkcols-N{columns:<colW>px;column-gap:32px} rule (CSS multi-column auto-flows
//       the <li> anchors into as many columns as fit). Each <li> is display:block;break-inside:avoid.
//   (b) ANCHOR-CLUSTER (the spec shape): a run of ≥8 bare-anchor MEMBERS (kind button+href OR tag a), each SHORT
//       (h<56), with little/no large non-anchor text interleaved, currently stacking into a single x-column (a tall
//       narrow run) — wrap them into ONE container carrying the same #linkcols-N columns rule.
// A nav ROW (few links, one y-row) NEVER triggers: require ≥8 members AND a multi-ROW stack (≥3 distinct y-rows).
//
// colW derivation: if the source anchors sit in K distinct x-clusters (the list already flowed into K columns), set
// colW so ~K columns fit (colW ≈ containerWidth/K − gap). For the list-widget shape K is inferred from the box
// (rowsPerCol ≈ box.h/lineHeight → K ≈ ceil(nItems/rowsPerCol)). Else default colW ≈ 200px (a typical sitemap col).
//
// NO-H-SCROLL: columns + column-gap inside a width:100% container is kses-safe and CANNOT overflow horizontally —
// CSS multi-column ADDS columns, never width. No bare fixed-px width is ever emitted (validateTree's guard untouched;
// the `columns:<N>px` property is a column-WIDTH hint, not an element width — the column count flexes to fit 100%).
// REVERSIBILITY: STRUCT_LINKCOLS unset ⇒ leafWidget's list path + buildSection/buildFooter are byte-identical.
const LINKCOLS = process.env.STRUCT_LEGACY !== '1' && process.env.STRUCT_NO_LINKCOLS !== '1';
const LINKCOLSCSS = []; // scoped #linkcols-N{columns:<colW>px;column-gap:32px} rules, injected page-wide via custom_css.
const LINKCOLSSTATS = { lists: 0, clusters: 0 };
let _linkcolsId = 0;
const LINKCOL_GAP = 32;          // inter-column gap (px) — a generous sitemap gutter
const LINKCOL_DEFAULT_W = 200;   // default column width when no source column structure is recoverable
const LINKCOL_MIN_MEMBERS = 8;   // conservative floor — fewer links is a nav row, not an index list
const LINKCOL_SHORT_H = 56;      // an anchor taller than this is a card/CTA, not a bare list link
// derive the column-WIDTH hint for a link list from the source. Given the container width + (optional) inferred
// source column count K, colW ≈ containerW/K − gap (so ~K columns fit); clamped to [120, 320] and never wider than
// the container. K<=1 (or unknown) → the typical sitemap default (200px). Returns an integer px.
function linkColWidth(containerW, K) {
  const cw = Math.max(120, Math.round(containerW || VW));
  if (K && K >= 2) { const w = Math.floor(cw / K) - LINKCOL_GAP; return Math.max(120, Math.min(320, Math.max(w, 120))); }
  return Math.min(LINKCOL_DEFAULT_W, Math.max(120, cw - LINKCOL_GAP));
}
// is THIS list leaf a long bare-anchor index list? ≥LINKCOL_MIN_MEMBERS items, ≥80% with an href, none very tall.
// Returns { ok, n, anchors, K } where K = the inferred source column count (box.h / lineHeight rows-per-col).
function linkListQualify(n) {
  if (!LINKCOLS || !n || n.kind !== 'list') return { ok: false };
  const items = (n.items || []).filter((it) => stripEmoji(it.text || ''));
  if (items.length < LINKCOL_MIN_MEMBERS) return { ok: false };
  const anchors = items.filter((it) => it.href);
  if (anchors.length / items.length < 0.8) return { ok: false };       // ≥80% bare anchors (else mixed text content)
  // infer the source column count K from the captured box: a multi-column <ul> is WIDE (box.w near a content column)
  // and SHORT (box.h ≈ rowsPerCol × lineHeight). rowsPerCol = round(box.h / lineHeight); K = ceil(nItems / rowsPerCol).
  const lh = px(n.typo && n.typo.lineHeight) || Math.max(18, Math.round((n.typo && n.typo.size) || 16) * 1.4);
  const box = n.box || { w: VW, h: lh };
  const rowsPerCol = Math.max(1, Math.round(box.h / Math.max(1, lh)));
  const K = Math.max(1, Math.ceil(items.length / rowsPerCol));
  return { ok: true, n: items.length, anchors: anchors.length, K, boxW: box.w };
}
// ANCHOR-CLUSTER detector (the spec shape) — a run of bare-anchor MEMBERS that currently stack into one tall narrow
// x-column. Conservative so it never mis-fires on real stacked content: from a band's members, find the LARGEST set
// that (1) are bare anchors (kind button+href OR tag a), (2) are SHORT (h<LINKCOL_SHORT_H), (3) share one x-column
// (left edges within a tolerance), AND (4) span ≥3 distinct y-rows (a multi-row STACK, never a single nav row). The
// set must be ≥LINKCOL_MIN_MEMBERS and dominate its x-column (no large non-anchor text interleaved at that x). Returns
// { ok, members:[…in y-order], rest:[…everything else], box } or { ok:false }.
function isBareAnchor(m) {
  if (!m || !m.box) return false;
  const tagA = (m.tag || '').toLowerCase() === 'a';
  const btnHref = m.kind === 'button' && !!m.href;
  if (!tagA && !btnHref) return false;
  if (m.box.h >= LINKCOL_SHORT_H) return false;       // a tall anchor is a card/CTA, not a bare list link
  return !!stripEmoji(m.text || '');
}
function anchorClusterQualify(members) {
  if (!LINKCOLS) return { ok: false };
  const ms = (members || []).filter((m) => m && m.box && m.box.w > 0 && m.box.h > 0);
  const anchors = ms.filter(isBareAnchor);
  if (anchors.length < LINKCOL_MIN_MEMBERS) return { ok: false };
  // group anchors by left-edge x-cluster (tolerance ~ 6% of viewport): a single stacked sitemap column shares ~one x.
  const xtol = Math.max(24, VW * 0.06);
  const groups = [];
  for (const a of [...anchors].sort((p, q) => p.box.x - q.box.x)) {
    let g = groups.find((G) => Math.abs(G.x - a.box.x) <= xtol);
    if (!g) { g = { x: a.box.x, members: [] }; groups.push(g); }
    g.members.push(a); g.x = (g.x * (g.members.length - 1) + a.box.x) / g.members.length;
  }
  // pick the largest x-group that is a MULTI-ROW stack (≥3 distinct y-rows) and meets the member floor.
  let best = null;
  for (const g of groups) {
    if (g.members.length < LINKCOL_MIN_MEMBERS) continue;
    const ys = [...new Set(g.members.map((m) => Math.round(m.box.y / 10)))];
    if (ys.length < 3) continue;                       // a single y-row (nav strip) NEVER qualifies
    if (!best || g.members.length > best.members.length) best = g;
  }
  if (!best) return { ok: false };
  // GUARD against mis-firing on real stacked content: no LARGE non-anchor text may sit inside the cluster's x-band +
  // y-extent (a heading/paragraph interleaved means this is real content, not a bare link index).
  const set = new Set(best.members);
  const y0 = Math.min(...best.members.map((m) => m.box.y)), y1 = Math.max(...best.members.map((m) => m.box.y + m.box.h));
  const colX0 = Math.min(...best.members.map((m) => m.box.x)), colX1 = Math.max(...best.members.map((m) => m.box.x + m.box.w));
  for (const m of ms) {
    if (set.has(m)) continue;
    if (isBareAnchor(m)) continue;
    const mcx = m.box.x + m.box.w / 2, mcy = m.box.y + m.box.h / 2;
    const inBand = mcx >= colX0 - 8 && mcx <= colX1 + 8 && mcy >= y0 && mcy <= y1;
    if (inBand && (m.box.h >= LINKCOL_SHORT_H || stripEmoji(m.text || '').length > 40)) return { ok: false }; // large content interleaved
  }
  const ordered = best.members.slice().sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const box = { x: colX0, y: y0, w: Math.max(1, colX1 - colX0), h: Math.max(1, y1 - y0) };
  const rest = ms.filter((m) => !set.has(m));
  return { ok: true, members: ordered, rest, box };
}
// build a CSS multi-column CONTAINER from a set of bare-anchor members. Each anchor → an inline <a> in a text-editor
// li-less; the wrapper carries a scoped #linkcols-N{columns:<colW>px;column-gap:32px} rule that auto-flows them. We
// derive K (source column count) from the band geometry: the band is one tall narrow column → K columns should fit
// the FULL content width, so colW = content-column / (a sane K). Here the source already collapsed to 1 column, so we
// target the typical sitemap default width (200px) which fits ~ contentW/200 columns. width:100% → no h-scroll.
function buildAnchorColsContainer(members, containerW) {
  const eid = `linkcols-${++_linkcolsId}`;
  const colW = linkColWidth(containerW, 0);            // default-width path (the stacked source gives no K signal)
  const lis = members.map((m) => { const t = stripEmoji(m.text || ''); if (!t) return ''; const cc = textColor(m) ? `color:${textColor(m)}` : ''; return `<li>${m.href ? `<a href="${esc(m.href)}"${cc ? ` style="${cc}"` : ''}>${esc(t)}</a>` : esc(t)}</li>`; }).filter(Boolean).join('');
  if (!lis) return null;
  LINKCOLSCSS.push(`#${eid}{columns:${colW}px;column-gap:${LINKCOL_GAP}px;list-style:none;margin:0;padding:0;width:100%;max-width:100%}#${eid} li{display:block;break-inside:avoid;-webkit-column-break-inside:avoid;page-break-inside:avoid;margin:0 0 4px}#${eid} li a{display:block;text-decoration:none}`);
  LINKCOLSSTATS.clusters++;
  const widget = { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<ul id="${eid}" style="${WRAP}">${lis}</ul>` } };
  return container({ content_width: 'full', flex_direction: 'column', width: { unit: '%', size: 100 }, padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } }, [widget]);
}

// ===========================================================================
// STRUCT_COLWIDTH (default ON since promotion — corrected 2026-06-09; opt out STRUCT_NO_COLWIDTH=1 or STRUCT_LEGACY=1 ⇒ byte-identical) — HEIGHT-SAFE per-section CONTENT-COLUMN narrowing. By default the
// inner content wrapper is content_width:'boxed' (the theme's wide boxed cap, ~1280). The source frequently lays its
// content into a NARROWER column (a hero copy block at 672, a centered body band at ~700). Narrowing the inner box to
// the source content-column width recovers the horizontal-fidelity / area-coverage that a too-wide boxed inner loses.
//
// WHY HEIGHT-SAFE (the v1 regression): v1 narrowed EVERY section incl. the HERO, whose heading nearly FILLS its source
// column — at the clone's font (renders ~10-15% wider than the source) a narrowed hero heading wrapped to 2 lines,
// +1.2% whole-page height → auto-reverted. Fix: SKIP narrowing for any section whose widest single TEXT/heading
// member nearly fills its content column (wText >= targetWidth * COLW_SKIP_RATIO). A near-full heading is the wrap
// risk; a body block well inside the column is safe. This keeps the area-win on the safe sections (#3/#5/#7/#8/#11 on
// supabase) with NO height regression (those sections had ZERO height change in v1; the hero was the sole regressor).
//
// NO-H-SCROLL INVARIANT: the narrowing is a SCOPED #colw-N{max-width:<targetW>px;width:100%;margin:auto} rule injected
// via page custom_css — NEVER a bare fixed-px width. max-width + width:100% means the column shrinks below targetW on
// narrow viewports (no overflow) and centers within the full-bleed section band. validateTree's bare-width guard is
// untouched (it scans the element tree, not page_settings; and the rule uses max-width, which that guard excludes).
const COLWIDTH = process.env.STRUCT_LEGACY !== '1' && process.env.STRUCT_NO_COLWIDTH !== '1';
// a heading/text whose width is >= this fraction of its content column nearly FILLS the column → narrowing it risks a
// new wrap (clone font renders wider than source). 0.85 skips the supabase hero (ratio 1.0) + the dense-heading band
// (#2, ratio 0.875) while still narrowing every well-inside body band. Tunable via STRUCT_COLW_SKIP_RATIO.
const COLW_SKIP_RATIO = (() => { const v = parseFloat(process.env.STRUCT_COLW_SKIP_RATIO || ''); return (v > 0 && v <= 1) ? v : 0.85; })();
const COLWCSS = []; // scoped #colw-N{max-width:Wpx;width:100%;margin:auto} rules, injected page-wide via custom_css.
const COLWSTATS = { narrowed: 0, skipped: 0, heroSkipped: false };
let _colwId = 0;
// HEIGHT-SAFE colwidth decision for ONE section. Returns { apply, targetW, align } where apply=false ⇒ leave the
// inner full-width/legacy (byte-identical). Offline-computable from the segment members + bbox alone.
//   targetW = the source CONTENT-COLUMN width = the section's own boxed bbox width (the boxed content extent), capped
//             to the viewport. A FULL-BLEED section (bbox spans ~the whole viewport) has no narrower content column to
//             recover → not narrowed (its background already runs edge-to-edge; the inner is the boxed cap already).
//   wText   = the widest single TEXT/button member (the wrap-risk element). Images/svg/mockups are excluded (they
//             scale with max-width:100% and never wrap).
//   SKIP iff wText >= targetW * COLW_SKIP_RATIO (a near-full heading → wrap risk) — this is the hero guard.
//   align   = derived from where the content extent sits vs the section center: a clearly LEFT-anchored column keeps
//             its left edge (margin-right:auto); else centered (margin:auto) — matching the boxed inner's centering.
// height (px) above which the widest text reads as a LARGE/already-multi-line display heading — the wrap-sensitive
// case where narrowing risks an extra line. A short single-line body/label (height below this) cannot grow taller
// when the box shrinks to its own rendered width, so it is height-safe even at ratio ~1.0. Tunable.
const COLW_WRAP_TEXT_H = (() => { const v = parseFloat(process.env.STRUCT_COLW_WRAP_H || ''); return v > 0 ? v : 60; })();
function colwidthDecision(sec, sb, idx) {
  const ms = (sec.members || []).filter((m) => m && m.box && m.box.w > 0 && m.box.h > 0);
  if (!ms.length) return { apply: false };
  // CONTENT-COLUMN width = extent (min member.x .. max member.x1) over the NON-FULL-BLEED members (a member that spans
  // ~the whole viewport is a background/full-bleed strip and would force the extent to the full width). This is the
  // source's boxed content band — the column we narrow the inner box to.
  const nfb = ms.filter((m) => m.box.w < VW * 0.92);
  const xs = nfb.length ? nfb : ms;
  const minX = Math.min(...xs.map((m) => m.box.x)), maxX1 = Math.max(...xs.map((m) => m.box.x + m.box.w));
  const targetW = Math.round(Math.min(maxX1 - minX, VW));
  // FULL-BLEED / no-narrowing guard: nothing to recover when the content column already ≈ the boxed cap (the inner is
  // already capped there) or ≈ the viewport. A targetW within ~2% of min(CONTENT_MAXW,VW) is a byte-churning no-op.
  if (targetW >= Math.min(CONTENT_MAXW, VW) - 2) return { apply: false, noNarrowing: true };
  if (targetW < 80) return { apply: false, tooSmall: true }; // degenerate extent → leave legacy boxed inner
  // widest single TEXT/button member — the wrap-risk element (images scale with max-width:100%, never wrap).
  const texts = xs.filter((m) => m.kind === 'text' || m.kind === 'button' || /^h[1-6]$/i.test(m.tag || ''));
  const widest = texts.length ? texts.slice().sort((a, b) => b.box.w - a.box.w)[0] : null;
  const wText = widest ? Math.round(widest.box.w) : 0;
  const wTextH = widest ? Math.round(widest.box.h) : 0;
  // HERO/WRAP guard (HEIGHT-SAFE) — SKIP iff the widest text NEARLY FILLS the column (wText >= targetW*ratio) AND that
  // text is a LARGE/already-multi-line display heading (height >= COLW_WRAP_TEXT_H). Such a heading, re-boxed to the
  // narrower column at the clone's wider font, gains a line → +page height (the v1 hero regression). A SHORT single-
  // line text that fills the column is safe: shrinking the box to its own rendered width cannot make it taller.
  if (wText >= targetW * COLW_SKIP_RATIO && wTextH >= COLW_WRAP_TEXT_H) return { apply: false, wrapRisk: true, targetW, wText, wTextH };
  // source alignment: content extent center vs section center. A column whose left edge hugs the section's left edge
  // (and whose right edge stops well short of the section's right) is LEFT-anchored; else centered.
  const secCx = (sb.x || 0) + (sb.w || VW) / 2, extCx = (minX + maxX1) / 2;
  const leftAnchored = (minX - (sb.x || 0)) < (sb.w || VW) * 0.06 && ((maxX1 - minX) < (sb.w || VW) * 0.85) && (extCx < secCx - (sb.w || VW) * 0.08);
  return { apply: true, targetW, wText, wTextH, align: leftAnchored ? 'left' : 'center' };
}
// RAM-GRID QUALIFIER — is this row a multi-column GRID/CARD row (>=2 comparable-width cells)? A real grid/card row
// has >=2 cells whose widths are within ~25% of the narrowest (the SAME comparable-cell notion build-flow's RAM
// branch keys off). A hero|sidebar split (one cell 3-4x another) or a logo-strip mix never qualifies — those stay
// the flex-%-basis path. Returns {ok, medianCellPx, n} where medianCellPx = the median captured CELL width.
function ramGridQualify(cols) {
  if (NO_RAMGRID) return { ok: false };
  if (!cols || cols.length < 2) return { ok: false };
  const cellWs = cols.map((c) => Math.max(1, c.x1 - c.x0)).filter((w) => w > 0);
  if (cellWs.length < 2) return { ok: false };
  const mn = Math.min(...cellWs), mx = Math.max(...cellWs);
  const comparable = mx <= mn * 1.25; // comparable-width gate (mixed-width rows excluded — stay flex)
  const medianCellPx = round(median(cellWs));
  // GRIDFIX-recovered grids are trusted as grids (the narrow-member column alignment is the evidence) — bypass the
  // comparable-width gate, which a wide-media-bearing cell would otherwise fail. Only set on the GRIDFIX path.
  if (cols._gridfix && medianCellPx > 0) return { ok: true, medianCellPx: Math.max(160, Math.min(medianCellPx, round(VW * 0.32))), n: cols.length };
  if (!comparable || medianCellPx <= 0) return { ok: false };
  return { ok: true, medianCellPx, n: cols.length };
}

// FIX 1 — build ONE Y-ROW as an inner container. Split the row's members into X-columns; if >1 column emit a
// container whose children are the column containers; if 1 column, return its widgets to be stacked directly (a
// one-member-per-row section is unchanged).
//
// RAM-GRID (the responsive recipe, default ON; STRUCT_NO_RAMGRID=1 reverts): for a multi-column GRID/CARD row
// (>=2 comparable-width cells), emit the wrapper as a CSS GRID — container_type:'grid' with
//   grid_columns_grid = { unit:'custom', size:'repeat(auto-fit, minmax(min(<medianCellPx>px,100%), 1fr))' }
// (the SAME proven kses-safe channel build-flow's RAM branch rides). The cells become in-flow grid children with
// NO fixed %-flex-basis (columnContainer gridChild=true drops the width pin). This renders byte-identical at 1440
// (the same N columns fit the content width) but auto-fit auto-reflows 3→2→1 as the width narrows and STACKS to
// 1-col at 390 (kills the mobile overflow + matches the source grid→1col recomposition). The inner min(<cell>px,
// 100%) guard means a track can never demand more than the container, so there is NO horizontal scroll at any width.
// A mixed-width row (hero|sidebar) or a single-column row stays the OLD flex-%-basis path, unchanged.
// ===========================================================================
// STRUCT_MOTION_MARQUEE — HEIGHT-NEUTRAL continuous-loop track. The v1 blocker was that doubling the members inline
// let clusterRows/rowColumns re-cluster the doubled set into EXTRA ROWS (taller section, −0.087 visual). FIX: build a
// CLIP container (overflow:hidden; max-width:100%) holding ONE TRACK container that is forced to a SINGLE non-wrapping
// horizontal row (display:flex; flex-wrap:nowrap; width:max-content; white-space:nowrap; align-items:center). The
// track's children are the row's column containers PLUS a SECOND identical set (the 2× duplicate) appended directly —
// NEVER re-fed to clusterRows/rowColumns — so both sets sit in ONE row at the natural single-row height; the duplicate
// extends SIDEWAYS and is clipped, adding ZERO height. A scoped @keyframes joist-mq-N translateX(0→−50%) (reversed for
// 'right') slides the track; the clip window always shows a full single row. NATIVE: custom_css only (kses-safe — the
// same channel card-hover transitions use). Returns the clip container, or null if the columns yield no widgets.
// ===========================================================================
function buildMarqueeTrack(cols, sectionW, ctaCtx, mq) {
  // build each captured column as a non-flex-basis grid-style child (no width pin — the nowrap track sizes them by
  // content); skip empties. We build the set TWICE: the originals + an exact duplicate set for the seamless −50% loop.
  const buildSet = () => cols.map((c) => columnContainer(c, sectionW, cols.length, ctaCtx, true)).filter(Boolean);
  const setA = buildSet();
  if (setA.length < 2) return null;                            // not a real multi-cell strip → let the caller fall through? (we already gated ≥4 cols; this is belt+braces)
  const setB = buildSet();                                     // the 2× duplicate (rebuilt, never re-clustered)
  const n = mqId();
  const trackId = `joist-mq-track-${n}`;
  const clipId = `joist-mq-clip-${n}`;
  const durS = Math.max(10, Math.round((mq.durMs || 40000) / 1000)); // faithful loop duration (s); clamp ≥10s
  const gapPx = 48;                                            // the inter-member gutter inside the strip (single value, applied via CSS)
  // TRACK — a flex ROW with NOWRAP. Native flex_wrap:'nowrap' + the scoped CSS (width:max-content) keep it one row.
  const track = container({
    content_width: 'full', flex_direction: 'row', flex_wrap: 'nowrap', flex_align_items: 'center',
    flex_gap: { unit: 'px', size: gapPx, column: String(gapPx), row: String(gapPx) },
    padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
    _element_id: trackId,
  }, [...setA, ...setB]);
  // CLIP — overflow:hidden window (max-width:100%, full width). flex COLUMN so the single track row is the only child.
  const clip = container({
    content_width: 'full', flex_direction: 'column', width: { unit: '%', size: 100 },
    padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
    _element_id: clipId,
  }, [track]);
  // scoped, kses-safe CSS. The CLIP clips the over-wide track; the TRACK is forced to a single nowrap row at max-content
  // width and carries the infinite animation. translateX(0 → −50%) loops seamlessly because the 2× duplicate makes the
  // first 50% identical to the second 50%. 'right' reverses the slide. !important defeats the theme's flex defaults.
  const from = mq.direction === 'right' ? '-50%' : '0';
  const to = mq.direction === 'right' ? '0' : '-50%';
  MARQUEECSS.push(
    `#${clipId}{overflow:hidden!important;max-width:100%!important}` +
    `#${trackId}{display:flex!important;flex-wrap:nowrap!important;width:max-content!important;max-width:none!important;white-space:nowrap!important;align-items:center;column-gap:${gapPx}px;animation:joist-mq-${n} ${durS}s linear infinite}` +
    `#${trackId}>*{flex:0 0 auto!important;width:auto!important}` +
    `@keyframes joist-mq-${n}{from{transform:translateX(${from})}to{transform:translateX(${to})}}`
  );
  MARQUEESTATS.tracks++;
  return clip;
}

function rowContainer(row, sectionW, ctaCtx) {
  const cols = rowColumns(row.members, sectionW);
  if (!cols.length) return { widgets: [], rowEl: null };
  // STRUCT_MOTION_MARQUEE (default OFF) — a continuous-loop strip. BEFORE the 1-col / grid / flex paths: if this row's
  // y-band matches a captured marquee AND it is a genuine multi-cell strip (≥4 columns), emit it as a HEIGHT-NEUTRAL
  // single-row nowrap track (clip→track, 2× duplicate sideways, scoped @keyframes CSS) instead. No-op when off.
  if (MARQUEE_ON && cols.length >= 4) {
    const mq = marqueeMatchRow(row);
    if (mq) { const mEl = buildMarqueeTrack(cols, sectionW, ctaCtx, mq); if (mEl) return { widgets: [], rowEl: mEl }; }
  }
  if (cols.length === 1) {
    // a single-column row → its widgets stack directly into the parent (no extra wrapper). Unchanged behavior.
    return { widgets: emitColumnWidgets(cols[0].members, ctaCtx), rowEl: null };
  }
  // band tightness → align-items: if the row's members are short relative to the band, center them; else top-align.
  const bandH = Math.max(1, row.bottom - row.top);
  const medMemberH = (() => { const hs = row.members.map((m) => m.box.h).sort((a, b) => a - b); return hs[Math.floor(hs.length / 2)] || bandH; })();
  const align = (medMemberH / bandH > 0.7) ? 'center' : 'flex-start';
  // RAM-GRID PATH — a multi-column grid/card row of comparable-width cells → a CSS grid that auto-reflows.
  const ram = ramGridQualify(cols);
  if (ram.ok) {
    const gridChildren = cols.map((c) => columnContainer(c, sectionW, cols.length, ctaCtx, true)).filter(Boolean);
    if (gridChildren.length >= 2) {
      RAMSTATS.gridRows++;
      // captured grid gap → reuse the source-ish gutter (24px, matching the prior flex row gap); applied once per track.
      const gap = 24;
      const track = `repeat(auto-fit, minmax(min(${ram.medianCellPx}px, 100%), 1fr))`;
      const rowEl = container({
        content_width: 'full',
        // NATIVE container grid — drives --e-con-grid-template-columns from grid_columns_grid (custom unit). The
        // auto-fit minmax(min(Wpx,100%),1fr) track reflows N→…→1 by width with ZERO media query (kses-safe).
        container_type: 'grid',
        grid_columns_grid: { unit: 'custom', size: track },
        grid_rows_grid: { unit: 'fr', size: 'auto' },
        grid_gaps: { column: String(gap), row: String(gap), unit: 'px', isLinked: false },
        grid_auto_flow: 'row',
        flex_align_items: align,
        width: { unit: '%', size: 100 },
        padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
        // BELT-AND-SUSPENDERS — a scoped inline display:grid via _element_id so the track applies even if the
        // native container_type:'grid' control is ignored on this stack (kses-safe: no position, no bare px width;
        // the min(<cell>px,100%) inner guard caps every track to the container so there is no horizontal scroll).
        _element_id: `ramgrid-${idCounter()}`,
      }, gridChildren);
      // scoped custom CSS for this grid (injected page-wide via the collector) — mirrors ram-grid-responsive.workflow.
      RAMCSS.push(`#${rowEl.settings._element_id}{display:grid !important;grid-template-columns:${track} !important;gap:${gap}px !important;align-items:${align}}`);
      return { widgets: [], rowEl };
    }
  }
  // FLEX PATH (unchanged) — single-cell-survivor or mixed-width row.
  const colContainers = cols.map((c) => columnContainer(c, sectionW, cols.length, ctaCtx)).filter(Boolean);
  if (colContainers.length < 2) {
    // every column but one was empty → fall back to a flat stack of whatever survived.
    return { widgets: colContainers[0] ? colContainers[0].elements : [], rowEl: null };
  }
  const rowEl = container({
    content_width: 'full', flex_direction: 'row', flex_wrap: 'wrap', flex_align_items: align, flex_justify_content: 'center',
    flex_gap: { unit: 'px', size: 24, column: '24', row: '24' }, width: { unit: '%', size: 100 },
    padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
  }, colContainers);
  return { widgets: [], rowEl };
}

// ===========================================================================
// NATIVE <table> EMISSION (table/comparison-matrix regions ONLY). The capture retains the source <table> node with
// its <thead>/<tbody>/<tr>/<th>/<td> semantics (segment.mjs flattens those into thin leaf members, which the row-
// grid path then decomposes into per-row flex grids — a comparison matrix loses its table-ness). Here we read the
// FULL capture tree (L.root), find every <table> node, and re-emit it as a SEMANTIC native <table> inside an html
// widget: header row → <thead><tr><th>; body rows → <tbody><tr> with the feature-label as a row-header <th> and the
// data cells as <td> snapped to the captured plan columns by x-position; full-width category rows → a colspan <th>.
// SCOPE: this only fires for sections whose content IS a captured table (matchTableForSection); every other section
// is built byte-identically by the unchanged row-grid path below. Style is minimal + bounded (width:100%; max-width:
// 100%; overflow-x:auto wrapper) so the no-h-scroll invariant holds even for very wide matrices.
// ===========================================================================
const NO_TABLE = process.env.STRUCT_NO_TABLE === '1';
const TABLESTATS = { tables: 0 };
function gatherTables(root) {
  const out = [];
  const g = (n) => { if (!n || typeof n !== 'object') return; if (n.tag === 'table') { out.push(n); return; } (n.children || []).forEach(g); };
  g(root);
  return out;
}
const CAPTURED_TABLES = NO_TABLE ? [] : gatherTables(L.root);
// collect the visible text under a node, splitting on hard newlines (a single capture leaf may carry a whole stacked
// cell, e.g. "ENTERPRISE\n\nCustom\n\nContact Us"); each non-empty line becomes a text fragment.
function cellLines(n) {
  const acc = [];
  const walk = (x) => { if (!x || typeof x !== 'object') return; const t = x.text; if (t) { for (const piece of String(t).split('\n')) { const p = stripEmoji(piece); if (p) acc.push(p); } } (x.children || []).forEach(walk); };
  walk(n);
  return acc;
}
const cellText = (n) => cellLines(n).join(' ');
// find the direct <tr> rows of a table: a <thead>/<tbody> wraps <tr>s; some captures put header/data cells as DIRECT
// children of <tbody> (a th category row, or a tr-less leading cell). We normalize to {head:[trCells…], body:[…]}.
function tableSections(tbl) {
  const kids = tbl.children || [];
  let headEl = kids.find((k) => k.tag === 'thead');
  let bodyEl = kids.find((k) => k.tag === 'tbody');
  // a table with no thead/tbody (cells direct under <table>) — treat all rows as body.
  const headRows = headEl ? (headEl.children || []).filter((r) => r.tag === 'tr') : [];
  // body: each child that is a <tr> is a row; each child that is a bare <th>/<td> (no tr wrapper) is a full-width row.
  const bodyKids = bodyEl ? (bodyEl.children || []) : kids.filter((k) => k.tag !== 'thead' && k.tag !== 'tbody');
  return { headRows, bodyKids };
}
// derive the canonical DATA columns of a comparison matrix: the x-centers of the header-row cells AFTER the leading
// (label) column. Falls back to the union of data-cell x positions if there is no usable header row.
function deriveColumns(tbl) {
  const { headRows, bodyKids } = tableSections(tbl);
  let cells = null;
  if (headRows.length) { const hc = (headRows[0].children || []).filter((c) => c.box); if (hc.length >= 2) cells = hc; }
  if (!cells) {
    // no header row → infer from the most-populated tr's data cells.
    const trs = bodyKids.filter((k) => k.tag === 'tr');
    let best = null; for (const tr of trs) { const dc = (tr.children || []).filter((c) => c.box); if (!best || dc.length > best.length) best = dc; }
    cells = best || [];
  }
  // the leading column is the feature-LABEL column (leftmost); the rest are the plan/data columns. A matrix has its
  // label column at the table's left edge; the header row may itself omit the label cell (label col blank in <thead>).
  const tblX0 = (tbl.box && tbl.box.x) || 0;
  const sorted = [...cells].sort((a, b) => a.box.x - b.box.x);
  // if the leftmost header cell starts at the table's left edge it IS a data column too (no separate label col in head);
  // we still reserve a label column band [tblX0 .. firstDataX) for the body row-headers.
  const dataCells = sorted;
  const cols = dataCells.map((c) => ({ x0: c.box.x, x1: c.box.x + c.box.w, cx: c.box.x + c.box.w / 2, label: cellText(c) }));
  return { cols, labelX1: cols.length ? cols[0].x0 : tblX0 + 1 };
}
// snap a data cell to the nearest derived column by x-center; returns the column index or -1.
function snapCol(cell, cols) {
  if (!cell.box || !cols.length) return -1;
  const cx = cell.box.x + cell.box.w / 2;
  let bi = -1, bd = Infinity;
  for (let i = 0; i < cols.length; i++) { const d = Math.abs(cx - cols[i].cx); if (d < bd) { bd = d; bi = i; } }
  // accept only if within half the inter-column pitch (else it is really the label column / spans).
  const pitch = cols.length > 1 ? Math.abs(cols[1].cx - cols[0].cx) : 9999;
  return bd <= pitch * 0.6 ? bi : -1;
}
// emit ONE captured <table> node as a semantic native <table> in an html widget (with an overflow-x:auto wrapper).
function buildTableWidget(tbl) {
  const { headRows, bodyKids } = tableSections(tbl);
  const { cols, labelX1 } = deriveColumns(tbl);
  const nCols = cols.length;
  if (!nCols) return null;
  // border/padding/typo lifted from a representative captured cell (first data cell of the header, else table border).
  const sampleCell = (headRows[0] && (headRows[0].children || [])[0]) || null;
  const bd = (tbl.border && tbl.border.color && opaque(tbl.border.color)) ? tbl.border.color : 'rgba(0,0,0,0.12)';
  const cellPad = '10px 12px';
  const totalCols = nCols + 1; // + the leading feature-label column
  const esc2 = esc;
  const headerLabel = (c) => { const lines = cellLines(c); return lines.map((l) => esc2(l)).join('<br>'); };
  // THEAD — a leading (label) corner cell + one <th> per data column.
  let thead = '';
  if (headRows.length) {
    const hcells = (headRows[0].children || []).filter((c) => c.box).sort((a, b) => a.box.x - b.box.x);
    const ths = hcells.map((c) => `<th scope="col" style="text-align:left;padding:${cellPad};border-bottom:2px solid ${bd};vertical-align:top">${headerLabel(c)}</th>`).join('');
    thead = `<thead><tr><th scope="col" style="padding:${cellPad};border-bottom:2px solid ${bd}"></th>${ths}</tr></thead>`;
  }
  // TBODY — each bare <th>/<td> child is a full-width category row (colspan); each <tr> is a feature row: leftmost cell
  // (label-column) → row-header <th>, the rest snapped into <td> columns by x.
  const bodyRows = [];
  for (const k of bodyKids) {
    if (k.tag === 'tr') {
      const cells = (k.children || []).filter((c) => c.box).sort((a, b) => a.box.x - b.box.x);
      // the label cell = any cell whose center is left of the first data column; the rest are data cells.
      const tds = new Array(nCols).fill('');
      let labelCell = null;
      for (const c of cells) {
        const ci = snapCol(c, cols);
        const cx = c.box.x + c.box.w / 2;
        if (ci < 0 || cx < labelX1) { if (!labelCell) labelCell = c; else { /* extra left text → fold into label */ const extra = cellText(c); if (extra) labelCell = { ...labelCell, _extra: (labelCell._extra || '') + ' ' + extra }; } }
        else { const txt = cellLines(c).map(esc2).join('<br>'); tds[ci] = txt; }
      }
      const labTxt = labelCell ? (cellLines(labelCell).map(esc2).join('<br>') + (labelCell._extra ? ' ' + esc2(labelCell._extra.trim()) : '')) : '';
      const tdHtml = tds.map((t) => `<td style="text-align:left;padding:${cellPad};border-bottom:1px solid ${bd};vertical-align:top">${t}</td>`).join('');
      bodyRows.push(`<tr><th scope="row" style="text-align:left;padding:${cellPad};border-bottom:1px solid ${bd};font-weight:500;vertical-align:top">${labTxt}</th>${tdHtml}</tr>`);
    } else if (k.tag === 'th' || k.tag === 'td') {
      // a bare cell directly under tbody = a full-width category header row spanning every column.
      const txt = cellLines(k).map(esc2).join('<br>');
      if (!txt) continue;
      bodyRows.push(`<tr><th colspan="${totalCols}" scope="colgroup" style="text-align:left;padding:${cellPad};border-bottom:1px solid ${bd};font-weight:700;background:rgba(0,0,0,0.03)">${txt}</th></tr>`);
    }
  }
  const tbody = `<tbody>${bodyRows.join('')}</tbody>`;
  const tableStyle = `width:100%;max-width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px;line-height:1.4;${WRAP}`;
  const html = `<div style="width:100%;max-width:100%;overflow-x:auto"><table style="${tableStyle}">${thead}${tbody}</table></div>`;
  TABLESTATS.tables++;
  return { elType: 'widget', widgetType: 'html', settings: { html } };
}
// is THIS section essentially a captured table? Match a captured <table> whose bbox is contained in (and dominates)
// the section's bbox. Returns the captured table node or null. Strict: the table must overlap >=60% of the section
// height AND share the section's left edge band (so only true table sections are intercepted; everything else falls
// through to the byte-identical row-grid path).
function matchTableForSection(sb) {
  if (!CAPTURED_TABLES.length || !sb) return null;
  for (const tbl of CAPTURED_TABLES) {
    const tb = tbl.box; if (!tb) continue;
    const secTop = sb.y, secBot = sb.y + (sb.h || 0);
    const tblTop = tb.y, tblBot = tb.y + (tb.h || 0);
    const overlap = Math.max(0, Math.min(secBot, tblBot) - Math.max(secTop, tblTop));
    const secH = Math.max(1, sb.h || 0);
    if (overlap / secH < 0.6) continue;                       // table must fill most of the section vertically
    if (Math.abs((tb.x) - (sb.x)) > Math.max(40, sb.w * 0.1)) continue; // and share the section's left edge band
    return tbl;
  }
  return null;
}

// ===========================================================================
// FIX 3 — HYGIENE. (a) Unwrap redundant single-child CONTAINER wrappers: a container whose elements are exactly ONE
// child that is ITSELF a container, where the wrapper adds no own paint/min-height/grid identity, is collapsed —
// the lone child is lifted up (its content_width/_element_id are merged so the inner row still applies). This kills
// the empty "div in a div" nesting the row/column machinery leaves behind (e.g. a 1-column row whose single column
// is a 1-row inner, or a boxed-inner wrapping a single grid row). (b) auto-name section containers with a human
// `_title` (Hero / Logo wall / Pricing table / Footer / Section N) so the Elementor navigator is legible.
// SCOPE: only container→container nesting is collapsed; a heading/button/image widget is NEVER promoted (out of
// scope — we keep every leaf widget exactly where the layout placed it). REVERSIBILITY: STRUCT_NO_HYGIENE=1.
const NO_HYGIENE = process.env.STRUCT_NO_HYGIENE === '1';
// a wrapper is "redundant" iff it carries no paint/background, no min_height pin, no grid identity, and no its-own
// CTA/element-id semantics that the child lacks — i.e. it exists only to nest. We keep the child's settings and
// fold the wrapper's content_width/_element_id onto it so nothing visible changes.
function isRedundantWrapper(node) {
  if (!node || node.elType !== 'container' || !Array.isArray(node.elements) || node.elements.length !== 1) return false;
  const child = node.elements[0];
  if (!child || child.elType !== 'container') return false;          // only collapse container→container (never lift a widget)
  const s = node.settings || {};
  if (s.background_background || s.background_color || s.background_image) return false; // wrapper paints → keep
  if (s.min_height && s.min_height.size && +s.min_height.size > 40) return false;       // wrapper holds band height → keep
  if (s.container_type === 'grid' || s.grid_columns_grid) return false;                 // wrapper IS the grid track → keep
  if (s._title) return false;                                        // a named section wrapper is meaningful → keep
  // STRUCT_MOTION_MARQUEE: a marquee CLIP (#joist-mq-clip-N) carries the overflow:hidden window via scoped CSS keyed
  // to its own _element_id — collapsing it would drop the clip and let the over-wide track h-scroll. Its TRACK
  // (#joist-mq-track-N) likewise carries the nowrap/animation CSS. Never unwrap either (id-keyed scoped CSS depends
  // on the id surviving on the right node, and the clip must stay distinct from the track).
  if (typeof s._element_id === 'string' && /^joist-mq-(clip|track)-\d+$/.test(s._element_id)) return false;
  return true;
}
function unwrapRedundant(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node.elements)) node.elements = node.elements.map(unwrapRedundant);
  if (NO_HYGIENE) return node;
  let cur = node;
  // collapse a chain of redundant single-container wrappers (transitive), preserving content_width/_element_id.
  while (isRedundantWrapper(cur)) {
    const child = cur.elements[0];
    const ps = cur.settings || {}, cs = child.settings || {};
    if (ps._element_id && !cs._element_id) cs._element_id = ps._element_id;
    if (ps.content_width && !cs.content_width) cs.content_width = ps.content_width;
    child.settings = cs;
    STATS.wrappersUnwrapped++;
    cur = child;
  }
  return cur;
}
// derive a human section title from its members (best-effort, used only for the navigator label).
function deriveSectionTitle(sec, idx, sb) {
  const ms = (sec.members || []).map(resolveMember).filter(Boolean);
  const texts = ms.filter((m) => m.text).map((m) => stripEmoji(m.text).toLowerCase());
  const blob = texts.join(' ');
  const imgs = ms.filter((m) => m.kind === 'image' || m.kind === 'svg' || m.kind === 'mockup');
  if ((sb && (sb.y || 0) < 700)) return 'Hero';
  if (matchTableForSection(sb) || /\b(per month|\/mo|\/month|pricing|free\b.*\$|\$\d)/.test(blob) && /\b(plan|tier|pricing|pro|enterprise|starter|free)\b/.test(blob)) return 'Pricing table';
  // a logo wall: several images on one Y band with little/no text.
  if (imgs.length >= 4 && texts.join('').length < 60) return 'Logo wall';
  if (/\b(testimonial|customers say|loved by|trusted by)\b/.test(blob)) return 'Testimonials';
  if (/\b(frequently asked|faq|questions)\b/.test(blob)) return 'FAQ';
  // else: the first heading's text (trimmed) or a positional fallback.
  const head = ms.find((m) => m.kind === 'heading' && stripEmoji(m.text));
  if (head) { const t = stripEmoji(head.text); return t.length > 40 ? t.slice(0, 40) + '…' : t; }
  return `Section ${idx + 1}`;
}
// SECTION-SPEC title — map the validated semantic role to a human Navigator label, preferring the section's own
// heading for content/list sections (where the role carries no display name). Only used when JOIST_SECTIONSPEC=1.
const ROLE_TITLE = { hero: 'Hero', logos: 'Logo wall', features: 'Features', pricing: 'Pricing table', faq: 'FAQ', stats: 'Stats', testimonial: 'Testimonials', cta: 'Call to action', gallery: 'Gallery' };
function specTitle(specSec, fallback) {
  if (!specSec) return fallback;
  if (ROLE_TITLE[specSec.role]) return ROLE_TITLE[specSec.role];
  const h = specSec.contentSlots && specSec.contentSlots.heading;
  if (h) { const t = stripEmoji(h); return t.length > 40 ? t.slice(0, 40) + '…' : t; }
  return fallback;
}

// STRUCT_IMGFIT — register the band's DOMINANT source-clipped image (if any) for height-clamping. Offline-computable
// from the segment members + band height alone. The DOMINANT image is the largest-AREA media member (image/svg/
// mockup). AVAILABLE height = the band height minus the summed heights of the stacked NON-image members (the heading
// + body text the image sits behind/around). FIRE only when the dominant image's captured height is far taller than
// that available height (overflow ratio >= IMGFIT_MIN_RATIO, default 1.8) — the source must be clipping it. The clamp
// value = the available height (what the source band actually shows). Tunables: STRUCT_IMGFIT_MIN_RATIO (overflow
// trigger), STRUCT_IMGFIT_MIN_AREA_FRAC (the image must dominate — its area >= this fraction of the band's area box).
const IMGFIT_MIN_RATIO = (() => { const v = parseFloat(process.env.STRUCT_IMGFIT_MIN_RATIO || ''); return v > 0 ? v : 1.8; })();
const IMGFIT_MIN_AREA_FRAC = (() => { const v = parseFloat(process.env.STRUCT_IMGFIT_MIN_AREA_FRAC || ''); return v > 0 ? v : 0.55; })();
function imgfitTagDominant(members, sb, minH) {
  const ms = (members || []).map(resolveMember).filter((m) => m && m.box && m.box.w > 2 && m.box.h > 2);
  if (!ms.length) return;
  const isMedia = (m) => m.kind === 'image' || m.kind === 'mockup' || (m.kind === 'svg' && m.raster && m.raster !== 'SKIP');
  const media = ms.filter(isMedia);
  if (!media.length) return;
  // dominant = largest captured AREA media member.
  const dom = media.slice().sort((a, b) => (b.box.w * b.box.h) - (a.box.w * a.box.h))[0];
  const domArea = dom.box.w * dom.box.h;
  const bandH = Math.max(1, round(minH));
  const bandArea = (sb.w || VW) * bandH;
  // it must genuinely DOMINATE the band (a small avatar/logo never qualifies) — area >= a fraction of the band box.
  if (domArea < bandArea * IMGFIT_MIN_AREA_FRAC) return;
  const domH = round(dom.box.h);
  // TRIGGER (the source-clip test): the captured image must be far TALLER than the BAND ITSELF. If domH ≈ bandH (or
  // shorter), the image FITS the band — the source is NOT clipping it, so we leave it (the contain-cap is correct).
  // Comparing to bandH (not the text-deflated availH) is what keeps a full-bleed band-screenshot — e.g. the tweet-wall
  // mockup whose 524px ≈ its 572px band — from being wrongly crushed: 524 < 572*1.8, so it never fires.
  if (domH < bandH * IMGFIT_MIN_RATIO) return;
  // CLAMP value = the visible band crop: the band height minus the stacked NON-image members (the heading + body text
  // the clipped image backs/sits beside). Floored at HALF the band so a text-misread can never crush the crop to a
  // sliver; capped at the band height. For supabase #8: 261 band − 83px text → ~178px crop (matches the source).
  const nonMedia = ms.filter((m) => !isMedia(m) && (m.kind === 'heading' || m.kind === 'text' || m.kind === 'button'));
  const stackedH = nonMedia.reduce((s, m) => s + Math.max(0, round(m.box.h)), 0);
  const availH = Math.min(bandH, Math.max(Math.round(bandH * 0.5), bandH - stackedH));
  IMGFIT_CLAMP.set(dom, availH);
}

function buildSection(sec, idx) {
  const sb = sec.bbox || { x: 0, y: sec.y0 || 0, w: VW, h: (sec.y1 || 0) - (sec.y0 || 0) };
  const sectionW = sb.w || VW;
  const minH = Math.max(40, round((sec.y1 != null && sec.y0 != null) ? (sec.y1 - sec.y0) : sb.h));
  // SECTION-SPEC (default OFF): the validated per-section spec for this index, if the layer is enabled.
  const specSec = SPEC && SPEC.sections ? SPEC.sections[idx] : null;
  // FIX 3 — auto-name the section container for the Elementor navigator. With the spec layer on, the semantic
  // role drives the title (Hero/Features/Pricing table/Call to action/…); else the legacy heuristic.
  const baseTitle = NO_HYGIENE ? null : deriveSectionTitle(sec, idx, sb);
  const secTitle = (specSec && !NO_HYGIENE) ? specTitle(specSec, baseTitle) : baseTitle;
  if (secTitle) STATS.sectionsNamed++;
  // NATIVE TABLE — if this section's content IS a captured <table>/comparison-matrix, emit a semantic native <table>
  // instead of decomposing it into per-row flex grids. SCOPE: only a true table section (matchTableForSection) is
  // intercepted; non-table sections fall through to the unchanged row-grid path and build byte-identically.
  const tblNode = matchTableForSection(sb);
  if (tblNode) {
    const tableWidget = buildTableWidget(tblNode);
    if (tableWidget) {
      const innerSettings = { content_width: 'boxed', flex_direction: 'column', flex_gap: { unit: 'px', size: 24, column: '24', row: '24' }, width: { unit: '%', size: 100 }, padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } };
      const inner = container(innerSettings, [tableWidget]);
      const sectionSettings = {
        content_width: 'full', flex_direction: 'column', flex_align_items: 'center', flex_justify_content: 'flex-start',
        width: { unit: '%', size: 100 },
        min_height: { unit: 'px', size: minH }, min_height_tablet: { unit: 'px', size: 0 }, min_height_mobile: { unit: 'px', size: 0 },
        padding: { unit: 'px', top: '40', right: '20', bottom: '40', left: '20', isLinked: false },
        _element_id: `sec-${idx}`,
        ...semTag('section'),                                // STRUCT_SEMANTIC: this per-section container → <section>
        ...sectionRevealSettings(idx),                       // STRUCT_MOTION_REVEAL: native entrance animation when the source reveals (no-op spread when off)
        ...(secTitle ? { _title: secTitle } : {}),
        ...bandBgSettings(sec.bg),
      };
      return container(sectionSettings, [inner]);
    }
    // buildTableWidget returned null (no usable columns) → fall through to the row-grid path (no regression).
  }
  // FIX 3 — section-level CTA dedup (drop the inner text-leaf duplicated under a same-text button + repeated CTAs).
  const ded = dedupSectionCtas(sec.members || []);
  // hero CTA styling: the hero band renders CTAs as styled buttons. With the spec layer on, use the validated
  // role (so a mis-placed first band, or a tall hero past 700px, is classified correctly); else the y<700 heuristic.
  const isHero = specSec ? specSec.role === 'hero' : ((sb.y || 0) < 700);
  const ctaCtx = isHero;
  // STRUCT_IMGFIT (default ON — corrected 2026-06-09; opt out STRUCT_NO_IMGFIT=1) — SOURCE-CLIP image clamp pre-pass. Find the DOMINANT image (largest captured area)
  // in this band. If its captured height is far taller (>~1.8x) than the band's AVAILABLE height (the section band
  // height minus the stacked NON-image heading/text member heights), the source clips/scales it into the band crop
  // and the contain-cap would otherwise render it full-height → the section balloons. Register an override clamp
  // (the available band height) for that leaf so nativeImageWidget emits max-height:<availH> + object-fit:cover.
  // CONSERVATIVE: only one dominant image per band, only when it CLEARLY overflows; normally-sized images untouched.
  if (IMGFIT) imgfitTagDominant(ded.members || [], sb, minH);
  // STRUCT_LINKCOLS (default ON — corrected 2026-06-09; opt out STRUCT_NO_LINKCOLS=1) — ANCHOR-CLUSTER pre-pass: pull a tall narrow run of ≥8 short bare-anchor members
  // out of the band, emit it as ONE CSS multi-column container (instead of 8+ stacked rows), and run the REST through
  // the unchanged row machinery. The cluster container is re-inserted by its y-position so the stack order holds.
  let secMembers = ded.members, linkClusterEl = null, linkClusterY = Infinity;
  if (LINKCOLS) {
    const fullMs = (ded.members || []).map(resolveMember).filter(Boolean);
    const acq = anchorClusterQualify(fullMs);
    if (acq.ok) {
      linkClusterEl = buildAnchorColsContainer(acq.members, sectionW);
      if (linkClusterEl) { linkClusterY = acq.box.y; const keep = new Set(acq.rest); secMembers = ded.members.filter((m) => { const f = resolveMember(m); return keep.has(f); }); }
    }
  }
  // STRUCT_BENTOGRID (default ON — corrected 2026-06-09; opt out STRUCT_NO_BENTOGRID=1) — TILE-BENTO pre-pass, BEFORE the clusterRows/rowColumns path. Detect a true
  // N≥2-col × M≥2-row tile grid (≥4 headings) from the section's resolved members; if it qualifies, group the
  // members into per-heading TILES and emit ALL tiles into ONE CSS GRID (M rows × N cols) instead of the flex path
  // that stacks them tall. A col-span-2 tile (content ≈2× the column pitch) gets grid-column:span 2. A hero/cta or a
  // single-ROW feature row (M=1, the RAM-grid case) does NOT qualify → falls through to the unchanged path below.
  const innerEls = [];
  let bentoApplied = false;
  if (BENTOGRID && !isHero) {
    const fullMs = (secMembers || []).map(resolveMember).filter(Boolean);
    const det = bentoDetect(fullMs);
    if (det.ok) {
      const gridEl = buildBentoGrid(det, fullMs, sectionW, ctaCtx);
      if (gridEl) {
        BENTOSTATS.sections++;
        // preserve the linkcols cluster (if any pre-pass pulled one) by y-order around the grid; else just the grid.
        if (linkClusterEl && linkClusterY < (det.rowAnchors[0] || 0)) { innerEls.push(linkClusterEl); innerEls.push(gridEl); }
        else if (linkClusterEl) { innerEls.push(gridEl); innerEls.push(linkClusterEl); }
        else innerEls.push(gridEl);
        bentoApplied = true;
      }
    }
  }
  // STRUCT_CARDWALL (default ON — corrected 2026-06-09; opt out STRUCT_NO_CARDWALL=1) — HEADING-LESS MASONRY pre-pass, AFTER the bento check. Detect a dense, heading-
  // light wall of ≥6 comparable-width cards at ≥3 regularly-pitched x-anchors (the pitch-CV guard); if it qualifies,
  // emit ALL cards as ONE CSS multi-column block instead of the flex path that stacks them tall. Any full-bleed
  // backdrop is EXCLUDED from the cards and rendered behind them via the scoped custom_css background-image channel
  // (#sec-N{background-image:…}) — the element-tree bg-image setting is kses-stripped on this 4.0.9 stack, custom_css
  // is not. A hero/cta/feature-tile-bento/logo-strip/irregular-mosaic does NOT qualify → falls through unchanged.
  if (CARDWALL && !bentoApplied) {
    const fullMs = (secMembers || []).map(resolveMember).filter(Boolean);
    const cw = cardwallDetect(fullMs, sb, isHero);
    if (cw.ok) {
      const wallEl = buildCardwall(cw, sectionW, ctaCtx);
      if (wallEl) {
        if (linkClusterEl && linkClusterY < (cw.cols[0] ? cw.cols[0].x : 0)) { innerEls.push(linkClusterEl); innerEls.push(wallEl); }
        else if (linkClusterEl) { innerEls.push(wallEl); innerEls.push(linkClusterEl); }
        else innerEls.push(wallEl);
        bentoApplied = true;
        // BACKDROP: render the excluded full-bleed member behind the cards via the scoped custom_css bg-image channel
        // (kses-safe; survives where the element-tree background_image setting is stripped). Keyed to the section id.
        if (cw.backdrop) {
          const bsrc = localSrc(cw.backdrop.raster || cw.backdrop.src);
          if (bsrc && bsrc !== 'SKIP' && !/^data:/.test(bsrc)) {
            CARDWALLCSS.push(`#sec-${idx}{background-image:url(${bsrc});background-size:cover;background-position:center}`);
            CARDWALLSTATS.backdrops++;
          }
        }
      }
    }
  }
  // STRUCT_IRREGBENTO (default ON — corrected 2026-06-09; opt out STRUCT_NO_IRREGBENTO=1) — IRREGULAR IMAGE-MOSAIC pre-pass, AFTER bento + cardwall (the "neither claims"
  // fallback). Detect a designed image-mosaic (≥4 media cells, ≥3 IRREGULARLY-pitched media columns, multi-row, no
  // free-form overlap) that BENTOGRID (needs ≥4 headings) and CARDWALL (needs a regular pitch) both declined; emit
  // its HEADER as a row stack + the mosaic columns as ONE CSS GRID (auto-fit minmax min(...,100%) — reflows, no
  // h-scroll, no absolute) instead of the flex path that stacks the cards tall. A hero/cta/heading-bento/regular-
  // card-wall/single-row-logo-strip does NOT qualify → falls through unchanged.
  if (IRREGBENTO && !bentoApplied && !isHero) {
    const fullMs = (secMembers || []).map(resolveMember).filter(Boolean);
    const det = irregBentoDetect(fullMs, sb);
    if (det.ok) {
      const out = buildIrregBento(det, sectionW, ctaCtx);
      if (out && out.gridEl) {
        // header rows first (they sit above the mosaic), then the grid; preserve any linkcols cluster by y-order.
        if (linkClusterEl) { innerEls.push(linkClusterEl); }
        for (const h of out.headerEls) innerEls.push(h);
        innerEls.push(out.gridEl);
        bentoApplied = true;
      }
    }
  }
  // FIX 1 — cluster members into Y-ROWS first; each row becomes an inner flex container of X-columns (a grid). A
  // same-y logo strip → ONE row of N logo-columns; a 3×N card region → rows of card-columns. Single-member rows
  // stack unchanged. SKIPPED when the bento pre-pass already emitted the section as one CSS grid (above).
  let linkClusterPlaced = bentoApplied;
  if (!bentoApplied) {
    const rows = clusterRows(secMembers);
    for (const r of rows) {
      if (linkClusterEl && !linkClusterPlaced && (r.top > linkClusterY)) { innerEls.push(linkClusterEl); linkClusterPlaced = true; }
      const built = rowContainer(r, sectionW, ctaCtx);
      if (built.rowEl) innerEls.push(built.rowEl);
      else if (built.widgets && built.widgets.length) innerEls.push(...built.widgets);
    }
  }
  if (linkClusterEl && !linkClusterPlaced) innerEls.push(linkClusterEl);
  if (!innerEls.length) return null; // empty section → drop (keeps invariant: every emitted section has content)
  // the inner content wrapper: a BOXED flex COLUMN (rows stack vertically) capped to the content width + centered.
  // Each row child is itself a flex-row that wraps at narrow widths, so the page reflows with no horizontal scroll.
  const innerSettings = { content_width: 'boxed', flex_direction: 'column', flex_gap: { unit: 'px', size: 24, column: '24', row: '24' }, width: { unit: '%', size: 100 }, padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } };
  // STRUCT_COLWIDTH (default ON — corrected 2026-06-09; opt out STRUCT_NO_COLWIDTH=1) — HEIGHT-SAFE per-section content-column narrowing. When a section's source content
  // column is meaningfully narrower than the boxed cap AND its widest heading does NOT nearly fill that column (the
  // hero/wrap guard), pin the inner box to the source width via a scoped #colw-N{max-width:Wpx;width:100%;margin:auto}
  // rule (NEVER a bare fixed px). Skipped sections stay byte-identical to the legacy boxed inner.
  if (COLWIDTH) {
    const dec = colwidthDecision(sec, sb, idx);
    if (dec.apply) {
      const cid = `colw-${++_colwId}`;
      innerSettings._element_id = cid;
      const mar = dec.align === 'left' ? 'margin-left:0;margin-right:auto' : 'margin-left:auto;margin-right:auto';
      // max-width caps the column to the source content width; width:100% lets it shrink below that on narrow
      // viewports (no overflow); margin centers (or left-anchors) it within the full-bleed section band.
      COLWCSS.push(`#${cid}{max-width:${dec.targetW}px;width:100%;${mar}}`);
      COLWSTATS.narrowed++;
    } else {
      COLWSTATS.skipped++;
      if (dec.wrapRisk && (idx === 0 || (sb.y || 0) < 700)) COLWSTATS.heroSkipped = true;
    }
  }
  const inner = container(innerSettings, innerEls);
  // SECTION container — FULL-WIDTH (content_width:full → background runs edge-to-edge), flex column, width 100%,
  // section bg + min_height from bbox + vertical padding. The boxed inner is centered via align-items:center.
  const sectionSettings = {
    content_width: 'full', flex_direction: 'column', flex_align_items: 'center', flex_justify_content: 'flex-start',
    width: { unit: '%', size: 100 },
    min_height: { unit: 'px', size: minH }, min_height_tablet: { unit: 'px', size: 0 }, min_height_mobile: { unit: 'px', size: 0 },
    padding: { unit: 'px', top: '40', right: '20', bottom: '40', left: '20', isLinked: false },
    _element_id: `sec-${idx}`,
    ...semTag('section'),                                  // STRUCT_SEMANTIC: this per-section container → <section>
    ...sectionRevealSettings(idx),                         // STRUCT_MOTION_REVEAL: native entrance animation when the source reveals (no-op spread when off)
    ...(secTitle ? { _title: secTitle } : {}),
    ...bandBgSettings(sec.bg),
  };
  return container(sectionSettings, [inner]);
}

// ===========================================================================
// NAV → full-width flex ROW: logo left + nav links (center/right) + CTA right. Pro → nav-menu widget bound by a
// per-page slug; no-Pro → a flex row of per-link text-editor widgets. The header is content_width:full + width:100%
// so it reflows; NO absolute positioning, NO fixed-px width (so it never causes horizontal scroll).
// ===========================================================================
const CTA_RX = /\b(get started|start( now| free| building| your project)?|sign ?up|sign ?in|log ?in|try( it)?( free| now)?|get( a)? demo|book( a)? demo|request( a)? demo|buy|subscribe|join|download|contact( sales| us)?|get( the)? app|talk to)\b/i;
// FIX 2 — derive the site BRAND text from the page itself (URL hostname or document title), NOT from a nav link.
// e.g. https://supabase.com/ → "Supabase"; "Supabase | The Postgres…" → "Supabase". Used only when the nav has no
// captured brand image/svg, so the logo slot never falls back to an arbitrary menu label like "Pricing".
function brandFromPage() {
  // 1) URL hostname → strip www + TLD, take the registrable name, Title-Case it.
  try {
    if (L.url) {
      const host = new URL(L.url).hostname.replace(/^www\./, '');
      const core = host.split('.').filter((p) => !/^(com|org|net|io|co|app|dev|ai|xyz|gg|so|sh|me|us|uk|inc)$/i.test(p)).pop() || host.split('.')[0];
      if (core && core.length >= 2) return core.charAt(0).toUpperCase() + core.slice(1);
    }
  } catch {}
  // 2) document title before the first separator (| - – — :).
  if (L.title) { const lead = String(L.title).split(/[|\-–—:]/)[0].trim(); if (lead && lead.length <= 40) return lead; }
  return null;
}
function analyzeNav(navSeg) {
  if (!navSeg || !navSeg.members || !navSeg.members.length) return null;
  const full = navSeg.members.map(resolveMember);
  const anchors = full.filter((n) => n.kind === 'button' && stripEmoji(n.text)).sort((a, b) => a.box.x - b.box.x);
  if (!anchors.length) return null;
  const firstAnchorX = anchors[0].box.x;
  // FIX 2 — BRAND element: the leftmost image/svg/mockup IN the nav band that sits at/left-of the first nav anchor
  // (the wordmark), never a centered hero mockup. Must be a real renderable asset (src or raster, not SKIP).
  const logo = full
    .filter((n) => (n.kind === 'image' || n.kind === 'svg' || n.kind === 'mockup'))
    .filter((n) => n.box && n.box.x <= firstAnchorX + 20 && ((n.src && !/^data:/.test(n.src)) || (n.raster && n.raster !== 'SKIP')))
    .sort((a, b) => a.box.x - b.box.x)[0] || null;
  // brand TEXT — used only when there is NO brand image. Prefer a captured short text/heading that sits LEFT of the
  // first nav anchor (a real wordmark text); else fall back to the page-derived brand. NEVER a nav menu link.
  let logoText = null, logoTextStr = null;
  if (!logo) {
    const leftText = full
      .filter((n) => (n.kind === 'heading' || n.kind === 'text') && stripEmoji(n.text) && stripEmoji(n.text).length <= 24 && n.box && n.box.x < firstAnchorX - 8)
      .sort((a, b) => a.box.x - b.box.x)[0] || null;
    if (leftText) { logoText = leftText; logoTextStr = stripEmoji(leftText.text); }
    else { logoTextStr = brandFromPage(); }
  }
  const ctaCand = [...anchors].sort((a, b) => (b.box.x - a.box.x));
  let cta = ctaCand.find((n) => CTA_RX.test(stripEmoji(n.text))) || null;
  // FIX 2 — never let the brand element leak into the menu links: drop the logo/logoText anchor + any anchor whose
  // text equals the brand string from the menu-links list.
  const brandStr = (logoTextStr || '').toLowerCase();
  let navAnchors = anchors.filter((n) => n !== cta && n !== logoText && (!brandStr || stripEmoji(n.text).toLowerCase() !== brandStr));
  if (!navAnchors.length) { navAnchors = anchors.filter((n) => n !== logoText); cta = null; }
  const items = navAnchors.map((n) => ({ title: stripEmoji(n.text), url: n.href || '#', typo: n.typo || {}, color: textColor(n) }));
  const navTypo = (items[0] && items[0].typo) || {};
  const navColor = (items.find((it) => it.color) || {}).color || '#111111';
  // header bg: scan the nav band's container ancestor in the capture for a solid/gradient bg at the top.
  let headerBg = null;
  const findBandBg = (n) => { if (!n || n.kind !== 'container' || headerBg) return; const b = n.background; if (b && n.box && n.box.y < 60 && n.box.h < 220) { if (b.color && opaque(b.color)) { headerBg = b.color; return; } if (b.gradient) { const g = gradientColor(b.gradient); if (g) { headerBg = g; return; } } } (n.children || []).forEach(findBandBg); };
  findBandBg(L.root);
  console.log(`nav brand: ${logo ? 'image/svg wordmark' : (logoTextStr ? `text "${logoTextStr}"` : 'none')}; ${items.length} menu link(s)${cta ? ' + CTA' : ''}`);
  return { items, cta, logo, logoText, logoTextStr, navTypo, navColor, headerBg };
}
const navSlug = (pid) => `clone-${pid}-nav`;
async function createNavMenu(items, pid, basicAuthHeaders) {
  const slug = navSlug(pid);
  try {
    let termId = null;
    try { const list = await (await fetch(`${base}/wp-json/wp/v2/menus?slug=${encodeURIComponent(slug)}`, { headers: basicAuthHeaders })).json(); if (Array.isArray(list) && list[0] && list[0].id) termId = list[0].id; } catch {}
    if (!termId) { const cr = await fetch(`${base}/wp-json/wp/v2/menus`, { method: 'POST', headers: basicAuthHeaders, body: JSON.stringify({ name: slug, slug }) }); const cj = await cr.json(); termId = cj && cj.id; if (!termId) { console.log('nav menu CREATE failed', cr.status); return null; } }
    else { try { const cur = await (await fetch(`${base}/wp-json/wp/v2/menu-items?menus=${termId}&per_page=100`, { headers: basicAuthHeaders })).json(); if (Array.isArray(cur)) for (const it of cur) { try { await fetch(`${base}/wp-json/wp/v2/menu-items/${it.id}?force=true`, { method: 'DELETE', headers: basicAuthHeaders }); } catch {} } } catch {} }
    let added = 0;
    for (const it of items) { const r = await fetch(`${base}/wp-json/wp/v2/menu-items`, { method: 'POST', headers: basicAuthHeaders, body: JSON.stringify({ title: it.title, url: it.url || '#', status: 'publish', menus: termId }) }); if (r.ok) added++; }
    console.log(`nav menu ITEMS: ${added}/${items.length} attached to ${slug}`);
    return added > 0 ? slug : null;
  } catch (e) { console.log('nav menu error', String(e).slice(0, 120)); return null; }
}
function buildNavHeader(nav, proMode, slug) {
  const navSize = round((nav.navTypo && nav.navTypo.size) || 16);
  const navColor = nav.navColor || '#111111';
  const headerSettings = {
    content_width: 'full', flex_direction: 'row', flex_justify_content: 'space-between', flex_align_items: 'center', flex_wrap: 'wrap',
    width: { unit: '%', size: 100 },
    padding: { unit: 'px', top: '14', right: '40', bottom: '14', left: '40', isLinked: false },
    _element_id: 'clone-header',
    ...semTag('nav'),                                      // STRUCT_SEMANTIC: the nav band container → <nav>
    ...(NO_HYGIENE ? {} : { _title: 'Header' }),
    ...(nav.headerBg ? { background_background: 'classic', background_color: nav.headerBg } : {}),
  };
  const elements = [];
  const logoWidget = (() => {
    if (nav.logo) { const src = localSrc(nav.logo.src || nav.logo.raster); if (src && src !== 'SKIP') { const h = round(Math.min(48, (nav.logo.box && nav.logo.box.h) || 32)); return { elType: 'widget', widgetType: 'html', settings: { html: `<img src="${esc(src)}" alt="${esc(nav.logo.alt || 'logo')}" style="display:block;height:${h}px;width:auto;max-width:200px">` } }; } }
    // FIX 2 — brand TEXT: the captured wordmark text if present, else the page-derived brand (logoTextStr). NEVER a
    // nav menu link (those were excluded from logoText/logoTextStr upstream).
    const lt = (nav.logoText ? stripEmoji(nav.logoText.text) : '') || (nav.logoTextStr || '');
    if (lt) return { elType: 'widget', widgetType: 'text-editor', settings: { editor: `<div style="font-weight:700;font-size:20px;${navColor ? `color:${navColor}` : ''}">${esc(lt)}</div>` } };
    return null;
  })();
  if (logoWidget) elements.push(logoWidget);
  if (proMode && slug) {
    // dropdown:'tablet' → Pro's own nav-menu collapses to the burger at <=1024px (the source collapses by 768; the
    // tablet breakpoint covers it). toggle:'burger' keeps the hamburger icon.
    elements.push({ elType: 'widget', widgetType: 'nav-menu', settings: { menu: slug, menu_name: slug, layout: 'horizontal', align_items: 'end', pointer: 'underline', dropdown: 'tablet', toggle: 'burger', menu_typography_typography: 'custom', menu_typography_font_size: { unit: 'px', size: navSize }, color_menu_item: navColor, color_menu_item_hover: navColor } });
    if (nav.cta) { const t = stripEmoji(nav.cta.text); const cc = textColor(nav.cta) || '#ffffff'; elements.push({ elType: 'widget', widgetType: 'text-editor', settings: { editor: `<a href="${esc(nav.cta.href || '#')}" style="display:inline-block;padding:8px 18px;border-radius:6px;background:${cc === '#ffffff' ? '#111' : 'transparent'};color:${cc};text-decoration:none;font-weight:600;font-size:${navSize}px;white-space:nowrap">${esc(t)}</a>` } }); }
    // DEFENSIVE HAMBURGER (mirrors Path C's @media checkbox-hamburger): even if the dropdown:'tablet' control is
    // ignored on this stack, force the Pro nav-menu's desktop list hidden and its burger toggle shown at <=1024px so
    // the desktop menu collapses to a burger at narrow widths like the source. Scoped to #clone-header (no leak).
    const proHamburgerCss = ['@media(max-width:1024px){',
      '#clone-header .elementor-nav-menu--main .elementor-nav-menu:not(.elementor-nav-menu--dropdown){display:none!important}',
      '#clone-header .elementor-menu-toggle{display:flex!important;align-items:center}',
      '}'].join('');
    console.log(`nav EMIT (Pro): full-width flex row → logo${logoWidget ? '✓' : '✗'} + nav-menu(slug=${slug}, dropdown=tablet burger) + CTA${nav.cta ? '✓' : '✗'} + <=1024 hamburger CSS`);
    return { container: container(headerSettings, elements), fallbackCss: proHamburgerCss };
  }
  // PATH C — per-link text-editor widgets in a flex sub-row + native CTA + checkbox-hack hamburger.
  const linkChildren = nav.items.map((it) => ({ elType: 'widget', widgetType: 'text-editor', settings: { editor: `<a href="${esc(it.url || '#')}" style="display:inline-block;margin:0 14px;text-decoration:none;font-size:${navSize}px;${it.color ? `color:${it.color}` : (navColor ? `color:${navColor}` : '')};white-space:nowrap">${esc(it.title)}</a>`, _flex_grow: '0' } }));
  const linksContainer = container({ flex_direction: 'row', flex_align_items: 'center', flex_justify_content: 'flex-end', flex_wrap: 'wrap', _flex_grow: '0', _element_id: 'clone-navlinks' }, linkChildren);
  const burgerWidget = { elType: 'widget', widgetType: 'html', settings: { _element_id: 'clone-burger-wrap', html: `<input type="checkbox" id="burger" style="display:none"><label for="burger" style="display:none;cursor:pointer;font-size:26px;line-height:1;${navColor ? `color:${navColor}` : ''}">&#9776;</label>` } };
  elements.push(burgerWidget, linksContainer);
  if (nav.cta) { const t = stripEmoji(nav.cta.text); const cc = textColor(nav.cta) || navColor; elements.push({ elType: 'widget', widgetType: 'text-editor', settings: { editor: `<a href="${esc(nav.cta.href || '#')}" style="display:inline-block;padding:8px 18px;border-radius:6px;border:1px solid currentColor;color:${cc};text-decoration:none;font-weight:600;font-size:${navSize}px;white-space:nowrap">${esc(t)}</a>`, _flex_grow: '0' } }); }
  const fallbackCss = ['#clone-burger-wrap label{display:none}', '@media(max-width:1024px){', '#clone-burger-wrap label{display:inline-block!important}', '#clone-navlinks{display:none!important;position:absolute;top:100%;left:0;right:0;flex-direction:column!important;align-items:flex-start!important;padding:12px 24px}', '#burger:checked ~ #clone-navlinks,#clone-burger-wrap:has(#burger:checked) ~ #clone-navlinks{display:flex!important}', '}'].join('');
  console.log(`nav EMIT (fallback Path C): full-width flex row → logo${logoWidget ? '✓' : '✗'} + ${linkChildren.length} per-link widget(s) + burger + CTA${nav.cta ? '✓' : '✗'}`);
  return { container: container(headerSettings, elements), fallbackCss };
}
async function detectPro(basicAuthHeaders) {
  try { const r = await fetch(`${base}/wp-json`, { headers: basicAuthHeaders }); const j = await r.json(); const ns = (j && j.namespaces) || []; const blob = JSON.stringify(j || {}).toLowerCase(); const pro = ns.some((n) => /elementor-pro|pro\/v1/.test(n)) || /elementor-pro|elementor_pro/.test(blob); console.log(`Pro gate: ${pro ? 'Pro DETECTED → nav-menu widget' : 'no Pro → Path C fallback'}`); return pro; }
  catch (e) { console.log('Pro gate probe failed → default Pro', String(e).slice(0, 80)); return true; }
}

// ===========================================================================
// FOOTER → full-width container; footer members clustered into columns (same machinery).
// ===========================================================================
function buildFooter(footSeg) {
  if (!footSeg || !footSeg.members || !footSeg.members.length) return null;
  const fb = footSeg.bbox || { x: 0, y: pageH - 200, w: VW, h: 200 };
  // STRUCT_LINKCOLS (default ON — corrected 2026-06-09; opt out STRUCT_NO_LINKCOLS=1) — ANCHOR-CLUSTER pre-pass (footer sitemap of stacked bare anchors). Pull the
  // tall narrow anchor run into ONE CSS multi-column container; run the rest through the unchanged row machinery.
  let footMembers = footSeg.members, linkClusterEl = null, linkClusterY = Infinity;
  if (LINKCOLS) {
    const fullMs = (footSeg.members || []).map(resolveMember).filter(Boolean);
    const acq = anchorClusterQualify(fullMs);
    if (acq.ok) {
      linkClusterEl = buildAnchorColsContainer(acq.members, fb.w || VW);
      if (linkClusterEl) { linkClusterY = acq.box.y; const keep = new Set(acq.rest); footMembers = footSeg.members.filter((m) => { const f = resolveMember(m); return keep.has(f); }); }
    }
  }
  // FIX 1 — footer uses the same Y-ROW → X-COLUMN machinery so a single footer link row becomes a horizontal row.
  const rows = clusterRows(footMembers);
  const innerEls = [];
  let linkClusterPlaced = false;
  for (const r of rows) {
    if (linkClusterEl && !linkClusterPlaced && (r.top > linkClusterY)) { innerEls.push(linkClusterEl); linkClusterPlaced = true; }
    const built = rowContainer(r, fb.w || VW, false); if (built.rowEl) innerEls.push(built.rowEl); else if (built.widgets && built.widgets.length) innerEls.push(...built.widgets);
  }
  if (linkClusterEl && !linkClusterPlaced) innerEls.push(linkClusterEl);
  if (!innerEls.length) return null;
  const innerSettings = { content_width: 'boxed', flex_direction: 'column', flex_gap: { unit: 'px', size: 16, column: '16', row: '16' }, width: { unit: '%', size: 100 }, padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true } };
  const inner = container(innerSettings, innerEls);
  const footerSettings = {
    content_width: 'full', flex_direction: 'column', flex_align_items: 'center', width: { unit: '%', size: 100 },
    min_height: { unit: 'px', size: Math.max(40, round(fb.h)) }, min_height_tablet: { unit: 'px', size: 0 }, min_height_mobile: { unit: 'px', size: 0 },
    padding: { unit: 'px', top: '40', right: '20', bottom: '40', left: '20', isLinked: false },
    _element_id: 'clone-footer',
    ...semTag('footer'),                                   // STRUCT_SEMANTIC: the footer band container → <footer>
    ...(NO_HYGIENE ? {} : { _title: 'Footer' }),
    ...bandBgSettings(footSeg.bg || { kind: 'default' }),
  };
  if (!NO_HYGIENE) STATS.sectionsNamed++;
  return container(footerSettings, [inner]);
}

// ===========================================================================
// STRUCTURAL VALIDATION (used by --selftest + as a build-time invariant). The hard requirement: the emitted tree
// uses FLEX CONTAINERS with %-columns and contains NO position:absolute and NO fixed-px widths.
// ===========================================================================
function validateTree(root) {
  const blob = JSON.stringify(root);
  const fails = [];
  // 1) no absolute positioning anywhere (the whole point — flex reflow, not pins)
  if (/"_position"\s*:\s*"absolute"/.test(blob)) fails.push('found _position:absolute');
  if (/position\s*:\s*absolute/i.test(blob)) fails.push('found inline position:absolute');
  if (/position\s*:\s*fixed/i.test(blob)) fails.push('found inline position:fixed');
  if (/elementor-absolute/.test(blob)) fails.push('found elementor-absolute class');
  // 2) no fixed-px width pins on widgets (no _element_custom_width; no _offset_x/_offset_y)
  if (/"_element_custom_width"/.test(blob)) fails.push('found _element_custom_width (fixed px width pin)');
  if (/"_offset_x"|"_offset_y"/.test(blob)) fails.push('found _offset_x/_offset_y (absolute offset)');
  // 3) presence checks — at least one elType:container with a flex layout + at least one %-width column
  const containerCount = (blob.match(/"elType"\s*:\s*"container"/g) || []).length;
  if (containerCount < 1) fails.push('no elType:container emitted');
  const hasFlex = /"flex_direction"\s*:\s*"(row|column)"/.test(blob);
  if (!hasFlex) fails.push('no flex_direction on any container');
  const hasPctWidth = /"width"\s*:\s*\{\s*"unit"\s*:\s*"%"/.test(blob);
  if (!hasPctWidth) fails.push('no percent-width container (columns not %-based)');
  // 4) guard against an inline fixed-px WIDTH on a widget wrapper (images use max-width + width:100%, which is OK;
  //    a bare `width:<N>px` with NO max-width companion on a block element would risk overflow). We allow
  //    `max-width:<N>px` and `width:100%`; flag a `width:<N>px` that is NOT immediately a max-width.
  // IMGCAP: a `width:<N>px` is SAFE when immediately paired with a `max-width:100%` companion — it cannot overflow
  // the container (max-width:100% caps it), and that is exactly how images now carry their captured width. Flag only a
  // BARE fixed-px width with NO max-width companion (the real overflow risk). The negative lookahead keeps the no-h-scroll
  // protection fully intact for everything except the provably-safe `width:Npx;max-width:100%` image pattern.
  const badWidthPx = [...blob.matchAll(/[^-]width:(\d+)px(?!;max-width)/g)].map((m) => m[0]);
  // (images deliberately carry max-width:<px>; the regex above already excludes "max-width" via the [^-] guard —
  //  it only matches a leading non-dash before "width", so "max-width" won't match. Any hit is a real bare width.)
  if (badWidthPx.length) fails.push(`found ${badWidthPx.length} bare fixed-px width(s) e.g. "${badWidthPx[0]}"`);
  return { ok: fails.length === 0, fails, containerCount, hasFlex, hasPctWidth };
}

// ===========================================================================
// MAIN — assemble the structured tree, optionally write it.
// ===========================================================================
async function main() {
  // (1) segment the capture (or load a precomputed --seg).
  let seg;
  if (segPath && fs.existsSync(segPath)) { seg = JSON.parse(fs.readFileSync(segPath, 'utf8')); console.log(`seg: loaded ${segPath} — ${seg.sections.length} section(s)`); }
  else { seg = segment(L); console.log(`seg: ran segment.mjs on capture — ${seg.sections.length} section(s), nav=${!!seg.nav}, footer=${!!seg.footer}`); }

  // (1b) SECTION-SPEC layer (JOIST_SECTIONSPEC=1; default OFF ⇒ SPEC stays null + build is byte-identical). Classify
  // each band into a semantic role + layout archetype BEFORE building — the inspectable plan (≈ create_plan) that
  // drives the section title + hero/CTA decision and unlocks per-section grading.
  if (USE_SPEC) {
    try {
      SPEC = buildSpec(seg, L);
      const roles = SPEC.sections.map((s) => `${s.idx}:${s.role}/${s.layoutArchetype}@${s.confidence}`).join('  ');
      console.log(`section-spec: ${SPEC.sections.length} section(s) classified — ${roles}`);
      const lowConf = SPEC.sections.filter((s) => s.confidence < 0.5).map((s) => s.idx);
      if (lowConf.length) console.log(`section-spec: low-confidence (refine targets): [${lowConf.join(', ')}]`);
    } catch (e) { console.log('section-spec: FAILED to build (' + String((e && e.message) || e) + ') — falling back to legacy'); SPEC = null; }
  }

  // (2) upload images referenced by leaves (skip on selftest — no network in --selftest). Collect from full leaves
  // + segment band image backgrounds so the section/footer bg + member images resolve to WP-hosted URLs.
  if (!SELFTEST && !DRY) {
    const srcs = new Set();
    for (const lf of FULL_LEAVES) { if (lf.kind === 'image' && lf.src) srcs.add(lf.src); else if ((lf.kind === 'svg' || lf.kind === 'mockup') && lf.raster && lf.raster !== 'SKIP') srcs.add(lf.raster); }
    const collectBg = (n) => { if (!n) return; if (n.kind === 'container') { if (n.background && n.background.image) srcs.add(n.background.image); (n.children || []).forEach(collectBg); } }; collectBg(L.root);
    const fresh = [...srcs].filter((u) => u && !u.startsWith('data:') && !(imgMap[u] && imgMap[u].full));
    console.log(`images: ${srcs.size} total, ${fresh.length} to upload…`);
    for (const u of fresh) { await uploadImage(u); await sleep(200); }
    try { fs.writeFileSync(IMG_CACHE, JSON.stringify(imgMap, null, 2)); } catch {}
  }

  // (3) GLOBAL-TOKEN pre-pass — cluster captured colors/typography into Kit tokens BEFORE tree build.
  if (!NO_GLOBALS) {
    assignGlobals(L.root); finalizeGlobalTokens();
    console.log(`globals: ${gColorTokens.length} color + ${gTypoTokens.length} typography token(s)`);
    writeDesignMd(); // emit the DESIGN.md IR artifact (offline; runs in dry/selftest/publish)
  } else console.log('globals: OFF (inline-only)');

  // (4) build the structural tree: [nav?, sections…, footer?] as flex containers.
  const navInfo = seg.nav ? analyzeNav(seg.nav) : null;
  const sectionContainers = [];
  for (let i = 0; i < seg.sections.length; i++) { const c = buildSection(seg.sections[i], i); if (c) sectionContainers.push(c); }
  const footerContainer = buildFooter(seg.footer);
  console.log(`structured tree: ${sectionContainers.length} section container(s)${navInfo ? ' + nav' : ''}${footerContainer ? ' + footer' : ''}`);

  // ROOT — full-width flex column carrying the whole page. Background floor = the captured canvas color so the
  // page matches the source canvas (kses-safe; behind all content). NO min_height pin in px on widgets → reflow.
  const rootBgFloor = (PAGE_DEFAULT && deltaE(PAGE_DEFAULT, 'rgb(255, 255, 255)') > 3) ? { background_background: 'classic', background_color: PAGE_DEFAULT } : {};
  const rootEls = [...sectionContainers]; if (footerContainer) rootEls.push(footerContainer);
  const root = container({ content_width: 'full', flex_direction: 'column', width: { unit: '%', size: 100 }, padding: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true }, ...semTag('main'), ...rootBgFloor }, rootEls);

  // FIX 3 — HYGIENE: unwrap redundant single-child container wrappers. We recurse into each TOP-LEVEL element (never
  // collapse the page root itself — it carries the bg floor + is the document root) so the empty "div in a div" nesting
  // the row/column machinery leaves behind is lifted out. Container→container only; no leaf widget is ever promoted.
  root.elements = root.elements.map(unwrapRedundant);
  // count globals-reliance over the FULL leaves (flags set once per node during emit; never double-counted).
  for (const lf of FULL_LEAVES) { if (lf._reliesGlobalColor) STATS.textRelyGlobal++; if (lf._fontStripped) STATS.fontStripped++; }
  console.log(`globals-effective: ${STATS.textRelyGlobal} text widget(s) rely on a color global (inline literal stripped), ${STATS.fontStripped} font(s) bound to a typo global; hygiene: ${STATS.wrappersUnwrapped} wrapper(s) unwrapped, ${STATS.sectionsNamed} section(s) named`);

  // (5) DRY / SELFTEST — validate the emitted tree (the load-bearing structural assertions) and dump.
  const v = validateTree(root);
  if (DRY || SELFTEST) {
    const dumpPath = arg('dump') || (SELFTEST ? null : '/tmp/struct-tree.json');
    if (dumpPath) { try { fs.writeFileSync(dumpPath, JSON.stringify(root)); console.log(`tree dump → ${dumpPath}`); } catch {} }
    console.log(`VALIDATE containers=${v.containerCount} flex=${v.hasFlex} pctWidth=${v.hasPctWidth}`);
    if (!v.ok) { console.log('FAIL: ' + v.fails.join('; ')); process.exit(1); }
    // count %-columns + confirm absence of abs/fixed-px
    const blob = JSON.stringify(root);
    const pctCols = (blob.match(/"_flex_basis"\s*:\s*\{\s*"unit"\s*:\s*"%"/g) || []).length;
    const widgetCount = (blob.match(/"elType"\s*:\s*"widget"/g) || []).length;
    const tableTags = (blob.match(/<table/g) || []).length;
    const nativeHeadingTags = (blob.match(/"widgetType"\s*:\s*"heading"/g) || []).length;
    const nativeButtonTags = (blob.match(/"widgetType"\s*:\s*"button"/g) || []).length;
    const nativeImageTags = (blob.match(/"widgetType"\s*:\s*"image"/g) || []).length;
    const colwNote = COLWIDTH ? `; colwidth: ${COLWSTATS.narrowed} narrowed + ${COLWSTATS.skipped} skipped (heroSkipped=${COLWSTATS.heroSkipped}), ${COLWCSS.length} #colw-N rule(s)` : '';
    const linkColsNote = LINKCOLS ? `; linkcols: ${LINKCOLSSTATS.lists} list + ${LINKCOLSSTATS.clusters} cluster → ${LINKCOLSCSS.length} #linkcols-N rule(s)` : '';
    const bentoNote = BENTOGRID ? `; bentogrid: ${BENTOSTATS.sections} tile-bento section(s) → ${BENTOSTATS.tiles} tile(s) in CSS grid(s)` : '';
    const cardwallNote = CARDWALL ? `; cardwall: ${CARDWALLSTATS.walls} masonry wall(s) → ${CARDWALLSTATS.cards} card(s) in CSS multi-column + ${CARDWALLSTATS.backdrops} #sec-N backdrop(s) (${CARDWALLCSS.length} rule(s))` : '';
    const irregNote = IRREGBENTO ? `; irregbento: ${IRREGBENTOSTATS.sections} irregular-mosaic section(s) → ${IRREGBENTOSTATS.cols} column(s) in CSS grid(s)` : '';
    console.log(`OK: flex-container tree — ${v.containerCount} containers, ${pctCols} %-flex-basis column(s), ${widgetCount} widget(s), ${TABLESTATS.tables} native table(s) (${tableTags} <table tag(s)); native widgets: ${nativeHeadingTags} heading + ${nativeButtonTags} button + ${nativeImageTags} image (capped to captured box via ${NATIVEIMG_CSS.length} #nimg-N rule(s)); globals-effective: ${STATS.textRelyGlobal} text rely-on-global (inline stripped) + ${STATS.fontStripped} font(s) bound, ${STATS.wrappersUnwrapped} wrapper(s) unwrapped, ${STATS.sectionsNamed} section(s) named${colwNote}${linkColsNote}${bentoNote}${cardwallNote}${irregNote}; NO position:absolute, NO elementor-absolute, NO _element_custom_width/_offset, NO bare fixed-px width`);
    // DRY/SELFTEST CSS dump (STRUCT_DUMP_CSS=<path>) — the scoped custom_css channels are populated during the tree
    // build above, so we can emit the assembled rules offline (no network) for gate inspection. Publish path emits
    // the identical channels into pageSettings.custom_css below; this is inspection-only and never changes the tree.
    if (process.env.STRUCT_DUMP_CSS) { try { fs.writeFileSync(process.env.STRUCT_DUMP_CSS, [RAMCSS.join('\n'), NATIVEIMG_CSS.join('\n'), COLWCSS.join('\n'), LINKCOLSCSS.join('\n'), CARDWALLCSS.join('\n'), MARQUEECSS.join('\n')].filter(Boolean).join('\n')); console.log(`STRUCT_DUMP_CSS → ${process.env.STRUCT_DUMP_CSS}`); } catch {} }
    return;
  }
  if (!v.ok) { console.log('FAIL (refusing to publish a tree that violates the no-h-scroll invariant): ' + v.fails.join('; ')); process.exit(1); }

  if (!PUBLISH) { console.log('built structured tree (pass --publish to write). Use --dry to dump.'); return; }

  // (6) WRITE — kit globals → nav menu → page PUT → edit_mode/template meta (ported build-absolute.mjs:1382-1522).
  // SESSION: writes are bucketed behind X-Joist-Session-Id. The plugin now requires a REAL session id issued by
  // POST /sessions/start (an arbitrary client string yields atomic_save_silent_failure on Document::save). Honor an
  // explicit JOIST_SESSION_ID; else start one. Falls back to a synthetic id if /sessions/start is unavailable.
  let sessionId = process.env.JOIST_SESSION_ID || null;
  if (!sessionId) {
    try {
      const sr = await fetch(`${base}/wp-json/joist/v1/sessions/start`, { method: 'POST', headers: { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'structured reflow clone' }) });
      const sj = await sr.json(); sessionId = sj && sj.session_id ? sj.session_id : null;
      if (sessionId) console.log(`session: started ${String(sessionId).slice(0, 12)}…`);
    } catch {}
  }
  if (!sessionId) sessionId = 'structured-' + Date.now();
  const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': sessionId };
  const basicHeaders = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json' };
  await writeKitGlobals(headers);

  let navFallbackCss = '';
  if (navInfo) {
    const proMode = await detectPro(basicHeaders);
    let slug = null;
    if (proMode) slug = await createNavMenu(navInfo.items, pageId, basicHeaders);
    const built = buildNavHeader(navInfo, !!(proMode && slug), slug);
    root.elements.unshift(built.container);
    navFallbackCss = built.fallbackCss || '';
  }

  // @font-face for registered real source fonts + the Path C nav CSS via page custom_css.
  const fontCss = [...usedFonts].flatMap((fam) => (REGFONTS[fam] || []).map((f) => `@font-face{font-family:'${fam}';font-weight:${f.weight};font-style:${f.style || 'normal'};font-display:swap;src:url('${f.url}') format('woff2')}`)).join('\n');
  // defensive no-h-scroll guard (the flex tree already reflows; this is belt-and-suspenders for any inner-HTML px).
  const noScrollCss = 'html,body{max-width:100vw;overflow-x:hidden}.e-con .elementor-widget-html img{max-width:100%;height:auto}';
  // RAM-GRID scoped rules — each #ramgrid-N{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(Wpx,100%),1fr))}
  // so a qualifying grid/card row reflows 3→2→1 by width with NO media query (belt-and-suspenders for the native
  // container_type:'grid' channel; kses-safe — no position, no bare fixed-px width, every track capped to 100%).
  const ramGridCss = RAMCSS.join('\n');
  if (RAMSTATS.gridRows) console.log(`RAM-grid: ${RAMSTATS.gridRows} multi-column grid/card row(s) emitted as auto-fit CSS grid (3→2→1 reflow, no media query)`);
  // NATIVE-IMAGE caps — each #nimg-N{img{width:Wpx;max-width:100%;height:auto;max-height:Hpx;aspect-ratio:W/H}} so
  // the native image widget renders at the captured-box size (recipe #33 parity), never intrinsic/full → no 6x balloon.
  const nativeImgCss = NATIVEIMG_CSS.join('\n');
  if (NATIVE.images) console.log(`native-image cap: ${NATIVE.images} native image widget(s) pinned to captured box (#nimg-N width+max-height+aspect cap)`);
  if (IMGFIT && IMGFITSTATS.clamped) console.log(`imgfit: ${IMGFITSTATS.clamped} source-clipped dominant image(s) clamped to available band height (object-fit:cover crop)`);
  // STRUCT_COLWIDTH scoped rules — each #colw-N{max-width:Wpx;width:100%;margin:auto} narrows a safe section's inner
  // content box to the source content-column width (height-safe: wrap-risk sections were skipped). kses-safe: no
  // position, no bare fixed-px width (max-width + width:100% only) → no horizontal scroll at any viewport.
  const colwCss = COLWCSS.join('\n');
  if (COLWIDTH) console.log(`colwidth: ${COLWSTATS.narrowed} section(s) narrowed to source content-column, ${COLWSTATS.skipped} skipped (hero/wrap-risk/full-bleed); heroSkipped=${COLWSTATS.heroSkipped}`);
  // STRUCT_LINKCOLS scoped rules — each #linkcols-N{columns:<colW>px;column-gap:32px} auto-flows a long bare-anchor
  // list into as many columns as fit width:100% (the source's compact multi-column band), instead of a tall 1-per-row
  // stack. kses-safe: CSS multi-column ADDS columns, never width → no horizontal scroll at any viewport.
  const linkColsCss = LINKCOLSCSS.join('\n');
  if (LINKCOLS) console.log(`linkcols: ${LINKCOLSSTATS.lists} list-widget(s) + ${LINKCOLSSTATS.clusters} anchor-cluster(s) emitted as CSS multi-column (${LINKCOLSCSS.length} #linkcols-N rule(s))`);
  // STRUCT_BENTOGRID — tile-bento sections emitted as ONE CSS grid (M rows × N cols) via the RAM-grid #ramgrid-N
  // scoped channel (already folded into ramGridCss); a col-span-2 tile gets a #bento-…{grid-column:span 2} rule.
  if (BENTOGRID) console.log(`bentogrid: ${BENTOSTATS.sections} tile-bento section(s) → ${BENTOSTATS.tiles} tile(s) placed in a CSS grid (reuses #ramgrid-N display:grid channel; col-span-2 via #bento-… rule)`);
  // STRUCT_CARDWALL scoped rules — each #cardwall-N{columns:<pitch>px;column-gap} auto-flows a heading-less masonry
  // card-wall into as many tracks as fit width:100% (per-card break-inside:avoid keeps cards intact), plus an optional
  // #sec-N{background-image:…} that renders the excluded full-bleed backdrop behind the cards (kses-safe — custom_css
  // is not stripped like the element-tree bg-image setting). kses-safe: CSS multi-column ADDS columns, never width.
  const cardwallCss = CARDWALLCSS.join('\n');
  if (CARDWALL) console.log(`cardwall: ${CARDWALLSTATS.walls} masonry card-wall(s) → ${CARDWALLSTATS.cards} card(s) in CSS multi-column, ${CARDWALLSTATS.backdrops} backdrop(s) via #sec-N background-image (${CARDWALLCSS.length} rule(s))`);
  // STRUCT_MOTION card-hover (publish-time; default OFF) — walk the tree for card-like containers (the cardwall/
  // bento card ids the grid machinery already stamps) and emit a scoped kses-safe `#cardid{transition:…}
  // #cardid:hover{<delta>}` rule reproducing the SOURCE card hover vocabulary. Manifests only on :hover ⇒ the
  // default render is unchanged ⇒ no static regression. SKIPPED entirely when motion is off / source has no card
  // hover (CARD_HOVER is null) ⇒ MOTIONCSS stays empty ⇒ byte-identical custom_css to motion-off.
  emitCardHoverCss(root);
  const motionCss = MOTIONCSS.join('\n');
  if (MOTION_HOVER) console.log(`motion(hover): ${MOTIONSTATS.buttons} native button(s) given source hover (color/bg/border + ${BTN_HOVER ? BTN_HOVER.durMs : 0}ms) + ${MOTIONSTATS.cards} card(s) given scoped :hover (${MOTIONCSS.length} rule(s))`);
  if (MOTION_REVEAL_ON) console.log(`motion(reveal): ${MOTION_REVEAL_STATS.sections} top-level section(s) given native entrance animation=${REVEAL_ANIM} duration=${REVEAL_DUR_BUCKET || 'normal'} (source reveal: ${REVEAL_PROFILE.source}, markers=${REVEAL_PROFILE.revealMarkers} io=${REVEAL_PROFILE.ioCount} stuck=${REVEAL_PROFILE.stuckInvisible})`);
  // STRUCT_MOTION_MARQUEE (publish-time; default OFF) — the continuous-loop CSS was collected into MARQUEECSS during
  // the tree build (buildMarqueeTrack), keyed to the per-track #joist-mq-clip-N/#joist-mq-track-N ids. Inject it here.
  // Height-neutral: the track is a single nowrap row, the 2× duplicate is clipped sideways. SKIPPED entirely when
  // marquee is off / source has no loop (MARQUEE_ON false) ⇒ MARQUEECSS stays empty ⇒ byte-identical custom_css.
  const marqueeCss = MARQUEECSS.join('\n');
  if (MARQUEE_ON) console.log(`motion(marquee): ${MARQUEESTATS.tracks} continuous-loop track(s) emitted as height-neutral single-row nowrap clip→track (${MARQUEECSS.length} scoped @keyframes rule(s); source marquees=${MARQUEE_PROFILE.count}, dir=${MARQUEE_PROFILE.dominantDirection})`);
  const customCss = [fontCss, noScrollCss, ramGridCss, nativeImgCss, colwCss, linkColsCss, cardwallCss, motionCss, marqueeCss, navFallbackCss].filter(Boolean).join('\n');
  const pageSettings = customCss ? { custom_css: customCss } : {};
  if (fontCss) console.log(`injecting ${usedFonts.size} real font(s) via custom_css: ${[...usedFonts].join(', ')}`);

  if (process.env.STRUCT_DUMP_TREE) { try { fs.writeFileSync(process.env.STRUCT_DUMP_TREE, JSON.stringify(root)); console.log(`STRUCT_DUMP_TREE → ${process.env.STRUCT_DUMP_TREE}`); } catch {} }

  // PUBLISH-ONLY background-flag normalization (does NOT run on --dry/--selftest, so the gate-1 dry dumps stay
  // byte-identical). The plugin schema (4.0.x) REJECTS the whole PUT with 422 schema.missing_enable_flag when ANY
  // node supplies a dependent background_* key (background_color/_image/_size/_position) WITHOUT background_background
  // set to a type — "without it the dependent key(s) are silently ignored on render". A pre-existing emission (e.g. a
  // primary button's background_color at line ~454) trips this, blocking persistence of the WHOLE page. Walk the tree
  // and, for every node carrying a dependent bg key but no background_background, add background_background:'classic'
  // (the type the plugin itself suggests). This only ADDS the enable flag the key already implies — it never changes
  // a node that has no bg key, and never touches layout/position/width. Orthogonal to every recipe.
  (function normalizeBgFlags(node) {
    const s = node && node.settings;
    if (s && typeof s === 'object') {
      const hasDependentBg = ['background_color', 'background_image', 'background_size', 'background_position', 'background_gradient_type', 'background_overlay_image'].some((k) => s[k] != null && s[k] !== '');
      if (hasDependentBg && !s.background_background) s.background_background = 'classic';
    }
    if (node && Array.isArray(node.elements)) node.elements.forEach(normalizeBgFlags);
  })(root);

  let r, txt, expected = (await (await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { headers })).json()).elementor?.hash;
  for (let a = 0; a < 5; a++) { const body = { expected_hash: expected, elements: [root], page_settings: pageSettings, title: 'Structured reflow clone', intent: 'structured flex-container reflow' }; r = await fetch(`${base}/wp-json/joist/v1/pages/${pageId}`, { method: 'PUT', headers, body: JSON.stringify(body) }); txt = await r.text(); if (r.status !== 409) break; try { expected = JSON.parse(txt).details.current_hash; } catch {} await sleep(400); }
  console.log('PUT', r.status, txt.slice(0, 90));

  // edit_mode=builder + elementor_canvas template (else frontend serves the post_content fallback, not the tree).
  const metaHeaders = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json' };
  try {
    const mr = await fetch(`${base}/wp-json/wp/v2/pages/${pageId}`, { method: 'POST', headers: metaHeaders, body: JSON.stringify({ status: 'publish', template: 'elementor_canvas', meta: { _elementor_edit_mode: 'builder', _wp_page_template: 'elementor_canvas' } }) });
    console.log('set edit_mode=builder + template=elementor_canvas', mr.status);
    if (mr.status === 400) {
      try { await fetch(`${base}/wp-json/wp/v2/pages/${pageId}`, { method: 'POST', headers: metaHeaders, body: JSON.stringify({ meta: { _elementor_edit_mode: 'builder', _wp_page_template: 'elementor_canvas' } }) }); } catch {}
      for (const tmpl of ['elementor_canvas', 'elementor_header_footer']) { const tr = await fetch(`${base}/wp-json/wp/v2/pages/${pageId}`, { method: 'POST', headers: metaHeaders, body: JSON.stringify({ template: tmpl }) }); if (tr.ok) { console.log(`set template=${tmpl}`); break; } }
    }
  } catch {}
  console.log('PAGE:', `${base}/?page_id=${pageId}`);
}

main().catch((e) => { console.error('FAIL:', String(e && e.stack || e)); process.exit(1); });
