/**
 * @purpose PURE resolve / picker / store logic for the sticky-note annotation tool, factored out of
 * the DOM so it can be unit-tested OFFLINE on a synthetic element stack (no live render needed) and
 * imported VERBATIM by annotate.js in the page. Keeping the tested logic and the shipped logic the
 * SAME module is the anti-drift guarantee the prompt's offline self-test requires.
 *
 * The three load-bearing pure functions:
 *   • walkToStamp(el, read)        — from a hit element, walk ancestors to the nearest one carrying a
 *                                    non-empty --joist-src; return { stamp, owner }. (--joist-src INHERITS,
 *                                    so the walk is really a dedupe up to the OWNING wrapper.)
 *   • resolveZStack(hits, read, bbox) — for an ordered elementsFromPoint() hit list (topmost first),
 *                                    collect DISTINCT stamped widgets (dedupe by stamp), cap 4 → the
 *                                    z-stack picker candidates, topmost first.
 *   • makePin({...})               — assemble one annotation record (validated shape) from a chosen
 *                                    primary candidate + optional colliding_with + label fields.
 *
 * The stamp format (set by build-absolute.mjs's joistPreserve, read at runtime via
 * getComputedStyle(el).getPropertyValue('--joist-src')) is:  tagchain|nth|h<8hex>
 * getComputedStyle returns it QUOTED ("a>b|2|hdeadbeef") → stripStamp() strips the quotes + whitespace.
 *
 * Defect taxonomy = the grader's own vocabulary (veto-detectors.mjs + axisdelta-engine.mjs), so a human
 * pin's defect_class is directly join-able with what the grader emits. Severity 1-5 (human-facing 1=minor,
 * 5=page-breaking). The pin's element_ref / colliding_with are exactly the refs compare-capture /
 * axisdelta key on (the --joist-src stamp), so a pin aligns O(1) with the grader ledger.
 */

// ── Defect taxonomy (reused from the grader; see veto-detectors.mjs + axisdelta-engine.mjs) ───────────
// value = the canonical class string the grader emits; label = the human-facing dropdown text.
export const DEFECT_CLASSES = [
  { value: 'wrong-logo', label: 'Wrong / missing logo (brand mark swapped or absent)' },
  { value: 'invisible-heading', label: 'Invisible heading (text ≈ its background)' },
  { value: 'blank-hero', label: 'Blank / broken hero (top band empty or flat)' },
  { value: 'unstyled-cta', label: 'Unstyled CTA (button rendered with default styling)' },
  { value: 'overlapping-sections', label: 'Overlapping sections (collision — two boxes pile up)' },
  { value: 'missing-imagery', label: 'Missing imagery (image/graphic not reproduced)' },
  { value: 'recolor', label: 'Recolor (wrong colour vs source)' },
  { value: 'wrong-layout', label: 'Wrong layout (reading-order / containment / z-pile)' },
  { value: 'other', label: 'Other (free text)' },
];
export const DEFECT_VALUES = DEFECT_CLASSES.map((d) => d.value);

// Map the grader's internal class aliases → our canonical dropdown value, so a pin and the grader
// agree even where the grader's two engines name the same defect differently (broken-hero⇄blank-hero,
// collision/z-pile⇄overlapping-sections, containment-escape/reading-order⇄wrong-layout).
export const GRADER_CLASS_ALIASES = {
  'broken-hero': 'blank-hero',
  'collision': 'overlapping-sections',
  'z-pile': 'overlapping-sections',
  'containment-escape': 'wrong-layout',
  'reading-order': 'wrong-layout',
  'wrongly-sticky': 'wrong-layout',
  'h-overflow': 'overlapping-sections',
};
export function canonicalDefect(cls) {
  if (!cls) return 'other';
  if (DEFECT_VALUES.includes(cls)) return cls;
  return GRADER_CLASS_ALIASES[cls] || 'other';
}

// stamp shape: tagchain|nth|h<8hex>.  tagchain = root→leaf tags joined by '>', nth = 1-based int.
export const STAMP_RE = /^[a-z0-9>_-]+\|\d+\|h[0-9a-f]{8}$/i;
export function isStamp(s) { return typeof s === 'string' && STAMP_RE.test(s); }

/** getComputedStyle('--joist-src') returns a QUOTED, whitespace-padded value → normalize. */
export function stripStamp(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  // strip a single layer of matching quotes (CSS string value)
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s.trim();
}

/**
 * Walk from `el` up its ancestors to the nearest element carrying a non-empty --joist-src.
 * @param el    the start element (a DOM node, or in the selftest a synthetic node with .parentElement + .__stamp)
 * @param read  (node) => raw --joist-src string for that node (getComputedStyle in the page; node.__stamp in tests)
 * @returns { stamp, owner } | null   stamp is normalized (quotes stripped); owner is the element that carried it.
 */
export function walkToStamp(el, read) {
  let node = el;
  let guard = 0;
  while (node && guard++ < 64) {
    const raw = read(node);
    const s = stripStamp(raw);
    if (s) return { stamp: s, owner: node };
    node = node.parentElement || null;
  }
  return null;
}

/**
 * Resolve an ordered elementsFromPoint() hit list into the z-stack picker candidates.
 * @param hits  ordered hit elements, TOPMOST FIRST (document.elementsFromPoint order)
 * @param read  (node) => raw --joist-src (as in walkToStamp)
 * @param bbox  (node) => { x, y, w, h }  bounding box of the owning element (getBoundingClientRect in the page)
 * @param cap   max distinct stamped widgets to surface (default 4)
 * @returns [{ stamp, ownerTag, bbox, depth }]  distinct by stamp, in topmost-first order.
 */
export function resolveZStack(hits, read, bbox, cap = 4) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const w = walkToStamp(hit, read);
    if (!w) continue;
    if (seen.has(w.stamp)) continue;       // dedupe: the same owning wrapper reached from multiple hits
    seen.add(w.stamp);
    out.push({
      stamp: w.stamp,
      ownerTag: (w.owner && (w.owner.tagName || w.owner.__tag) || '').toLowerCase(),
      bbox: bbox ? bbox(w.owner) : null,
      depth: i, // 0 = topmost in the z-stack
    });
    if (out.length >= cap) break;
  }
  return out;
}

/** Round a numeric bbox to ints (defensive; getBoundingClientRect returns floats). */
function roundBox(b) {
  if (!b) return null;
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
}

/**
 * Assemble one annotation pin record from a chosen primary + optional colliding_with + label fields.
 * Throws on an invalid shape so a malformed pin can never be stored (validate-before-write).
 * @returns the pin record (the canonical JSONL line object).
 */
export function makePin({
  element_ref, colliding_with = null, bbox, viewport_w, scroll_y,
  defect_class, severity, note = '', page_id = null, created_at = null,
}) {
  const pin = {
    element_ref,
    bbox: roundBox(bbox),
    viewport_w: Math.round(viewport_w),
    scroll_y: Math.round(scroll_y || 0),
    defect_class: canonicalDefect(defect_class),
    severity: Math.round(severity),
    note: String(note || ''),
    page_id: page_id == null ? null : String(page_id),
    created_at: created_at || new Date().toISOString(),
  };
  if (colliding_with) pin.colliding_with = colliding_with;
  const errs = validatePin(pin);
  if (errs.length) throw new Error('invalid pin: ' + errs.join('; '));
  return pin;
}

/** Validate a pin record. Returns an array of error strings (empty = valid). */
export function validatePin(pin) {
  const errs = [];
  if (!pin || typeof pin !== 'object') return ['not an object'];
  if (!isStamp(pin.element_ref)) errs.push(`element_ref not a stamp: ${JSON.stringify(pin.element_ref)}`);
  if ('colliding_with' in pin && pin.colliding_with != null && !isStamp(pin.colliding_with)) {
    errs.push(`colliding_with not a stamp: ${JSON.stringify(pin.colliding_with)}`);
  }
  if (pin.colliding_with && pin.colliding_with === pin.element_ref) {
    errs.push('colliding_with equals element_ref (a box cannot collide with itself)');
  }
  if (!DEFECT_VALUES.includes(pin.defect_class)) errs.push(`defect_class not in taxonomy: ${JSON.stringify(pin.defect_class)}`);
  if (!(Number.isInteger(pin.severity) && pin.severity >= 1 && pin.severity <= 5)) errs.push(`severity not 1-5: ${JSON.stringify(pin.severity)}`);
  const b = pin.bbox;
  if (!b || ['x', 'y', 'w', 'h'].some((k) => !Number.isFinite(b[k]))) errs.push('bbox missing x/y/w/h');
  else if (!(b.w > 0 && b.h > 0)) errs.push('bbox has non-positive size');
  if (!Number.isFinite(pin.viewport_w) || pin.viewport_w <= 0) errs.push('viewport_w missing/non-positive');
  if (!Number.isFinite(pin.scroll_y) || pin.scroll_y < 0) errs.push('scroll_y missing/negative');
  if (typeof pin.note !== 'string') errs.push('note not a string');
  return errs;
}

// ── JSONL serialization (round-trip byte-stable) ──────────────────────────────────────────────────
// Canonical key order so a parse→serialize round-trip is byte-identical (the selftest asserts this).
const PIN_KEY_ORDER = ['element_ref', 'colliding_with', 'bbox', 'viewport_w', 'scroll_y', 'defect_class', 'severity', 'note', 'page_id', 'created_at'];
function orderPin(pin) {
  const o = {};
  for (const k of PIN_KEY_ORDER) if (k in pin && pin[k] !== undefined) o[k] = pin[k];
  // preserve any extra keys after the canonical ones (forward-compat) in stable sorted order
  for (const k of Object.keys(pin).sort()) if (!PIN_KEY_ORDER.includes(k) && pin[k] !== undefined) o[k] = pin[k];
  return o;
}
export function pinToLine(pin) { return JSON.stringify(orderPin(pin)); }
export function pinsToJsonl(pins) { return pins.map(pinToLine).join('\n') + (pins.length ? '\n' : ''); }
export function jsonlToPins(text) {
  return String(text || '')
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => JSON.parse(l));
}

// ── Source-region resolution (left pane highlight) ────────────────────────────────────────────────
/**
 * Given a clone pin's element_ref (a --joist-src stamp) and the captured source-bbox map
 * ({ meta, byPath: { <stamp>: {x,y,w,h} } } from prep-assets.mjs), return the SOURCE region to
 * highlight on the left pane, or null if the stamp has no captured source box (a synthetic Joist
 * wrapper with no 1:1 source — correctly NOT highlighted).
 */
export function resolveSourceRegion(stamp, sourceBbox) {
  if (!stamp || !sourceBbox || !sourceBbox.byPath) return null;
  const b = sourceBbox.byPath[stamp];
  if (!b) return null;
  return { x: b.x, y: b.y, w: b.w, h: b.h, scale: (sourceBbox.meta && sourceBbox.meta.scale) || 1 };
}
