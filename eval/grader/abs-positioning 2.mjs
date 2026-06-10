#!/usr/bin/env node
/**
 * @purpose Shared absolute-positioning primitives for native-but-pixel-pinned Elementor layout. Extracted
 * (in spirit) from build-absolute.mjs so build-hybrid can use abs positioning as a RARE EXCEPTION for very
 * specific designs (layered/overlapping sections that flex-flow fundamentally cannot represent) — NOT as the
 * default path. See knowledge/EDITABLE_LAYOUT_ENGINE_SCOPE.md. Widgets honor _position:absolute and these
 * settings are kses-safe (proven by build-absolute's 322 abs widgets round-tripping). CONTAINERS ignore
 * _position, so a container is pinned relative via scoped custom_css (relContainerCss).
 */

// Widget abs-position settings: pin a widget at box(x,y,w) relative to `origin` (the section/cell top-left).
export function absPos(box, z, origin) {
  const ox = origin ? origin.x : 0, oy = origin ? origin.y : 0;
  return {
    _position: 'absolute',
    _offset_orientation_h: 'start', _offset_x: { unit: 'px', size: Math.round(box.x - ox) }, _offset_x_end: { unit: 'px', size: 0 },
    _offset_orientation_v: 'start', _offset_y: { unit: 'px', size: Math.round(box.y - oy) }, _offset_y_end: { unit: 'px', size: 0 },
    _element_width: 'initial', _element_custom_width: { unit: 'px', size: Math.round(box.w) },
    ...(z != null ? { _z_index: String(z) } : {}),
  };
}

// Pin a CONTAINER (which ignores _position) as the positioning context: position:relative + min_height,
// scoped to its _element_id, so its abs children land section-relative and it occupies the right flow height.
// LEGACY (page custom_css form) — fragile under Elementor native CSS regen; prefer absSectionCss (per-element).
export function relContainerCss(eid, h) {
  return `#${eid}{position:relative!important;min-height:${Math.round(h)}px!important}`;
}

// HARDENED: per-ELEMENT custom_css for an abs section container. Stored in the element's own settings
// (_elementor_data), so Elementor's native CSS regen recompiles it — unlike PAGE custom_css, which native
// regen drops (the observed abs degradation). `selector` is Elementor's placeholder for the element's own
// selector. Carries BOTH the positioning context (relative + min_height) AND the <=1024 un-pin of its abs
// children (mobile reflow). Same durable channel FlexWidthFiller uses in production.
export function absSectionCss(h) {
  return `selector{position:relative!important;min-height:${Math.round(h)}px!important}` +
    '@media(max-width:1024px){selector .elementor-element.elementor-absolute{position:relative!important;left:auto!important;top:auto!important;right:auto!important;bottom:auto!important;width:100%!important;max-width:100%!important;height:auto!important;min-height:0!important;margin:0 0 12px 0!important;transform:none!important}selector .elementor-element.elementor-absolute *{height:auto!important;min-height:0!important}}';
}

// Global responsive un-pin: below 1024px release every abs widget to stacked flow (rough mobile reflow, not
// broken). Only matches .elementor-absolute, which exists ONLY inside abs sections — flow sections untouched.
export const RESPONSIVE_UNPIN_CSS =
  '@media(max-width:1024px){' +
  '.e-con .elementor-element.elementor-absolute{position:relative!important;left:auto!important;top:auto!important;right:auto!important;bottom:auto!important;width:100%!important;max-width:100%!important;height:auto!important;min-height:0!important;margin:0 0 12px 0!important;transform:none!important}' +
  '.e-con .elementor-element.elementor-absolute *{height:auto!important;min-height:0!important}' +
  '}';

// Heuristic: does a section's content genuinely require abs positioning (a "very specific design" flow can't
// represent)? TRUE only when leaves OVERLAP significantly (layered/stacked z-content) — standard grids and
// columns do NOT overlap, so this stays a RARE exception. Returns {abs, overlaps, reason}.
export function needsAbsLayout(leaves, opts = {}) {
  const minOverlapPairs = opts.minOverlapPairs ?? 2;
  const overlapFrac = opts.overlapFrac ?? 0.4;
  const boxes = (leaves || []).map((l) => l.box).filter((b) => b && b.w > 0 && b.h > 0);
  let overlaps = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const inter = ix * iy; if (inter <= 0) continue;
      const smaller = Math.min(a.w * a.h, b.w * b.h);
      if (smaller > 0 && inter / smaller >= overlapFrac) overlaps++;
    }
  }
  return { abs: overlaps >= minOverlapPairs, overlaps, reason: `overlapPairs=${overlaps}` };
}

// P1: MULTI-COLUMN detection — a section flow flattens into a centered single column (the visual-loss case),
// even when leaves DON'T overlap. True when ≥2 y-rows have items spread across distinct x-columns (side-by-side
// content). Routing these to abs preserves their column positions; the objective's responsive (mobile-order)
// term self-regulates the desktop-vs-mobile tradeoff. Returns {multi, wideRows, reason}.
export function isMultiColumn(leaves, opts = {}) {
  const minWideRows = opts.minWideRows ?? 2;
  const xSepFrac = opts.xSepFrac ?? 0.22; // x-center spread (frac of W) to count items as separate columns
  const W = opts.W ?? 1440;
  const boxes = (leaves || []).filter((l) => l && l.box && l.box.w > 0 && l.box.h > 0).map((l) => l.box);
  const rows = [];
  for (const b of boxes.slice().sort((a, c) => a.y - c.y)) {
    const r = rows.find((row) => Math.min(row.y1, b.y + b.h) - Math.max(row.y0, b.y) > Math.min(b.h, row.y1 - row.y0) * 0.5);
    if (r) { r.items.push(b); r.y1 = Math.max(r.y1, b.y + b.h); } else rows.push({ y0: b.y, y1: b.y + b.h, items: [b] });
  }
  let wideRows = 0;
  for (const r of rows) {
    if (r.items.length < 2) continue;
    const cx = r.items.map((b) => b.x + b.w / 2);
    if (Math.max(...cx) - Math.min(...cx) >= W * xSepFrac) wideRows++;
  }
  return { multi: wideRows >= minWideRows, wideRows, reason: `wideRows=${wideRows}` };
}
