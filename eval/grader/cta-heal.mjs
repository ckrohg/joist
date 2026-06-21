// @purpose Step-1 self-heal loop for the UNSTYLED-CTA defect class (Emergent-style gate-before-preview QA).
// Design locked by /fusion (CONVERGENT, both judges same leg). The discipline is TRIGGER != ACCEPTOR:
//   TRIGGER  = detectUnstyledCTA veto (binary, value-free: "source has accent CTAs, clone has zero").
//   FIX      = deterministic surgical re-paint from the FROZEN captured source CTA (cta-paint.buttonPaint),
//              patched onto the matched clone text-editor widget via /pages/{id}/patch update_settings.
//   ACCEPTOR = deterministic CTA-region correspondence (source-anchored ΔE2000 + geometry + editability +
//              no-collateral, plus a rendered-crop SSIM gate in live mode). The vision-judge is NOT the gate
//              (a single-CTA fix moves the tile score below the judge's own +/-0.08 noise floor) — telemetry only.
// The veto-clear is measured AFTER accept, never part of the accept predicate (clearing a binary "any accent?"
// veto is exactly the Goodhart target we refuse to reward). All live render/patch goes through host-guard.
//
// This module is pure + offline-testable (see _cta-heal-selftest.mjs); the live orchestrator healUnstyledCTA()
// ties GET tree -> localize -> patch -> re-render -> accept -> revert-on-reject and is host-guarded.

import { buttonPaint, ctaTextColor } from './cta-paint.mjs';

// ── Acceptor thresholds (deterministic; crop-SSIM values are Day-2 calibration targets) ──────────────────────
export const ACCEPT = {
  TEXT_DE: 10, BG_DE: 8, BORDER_DE: 10, BORDER_W: 1,          // ΔE2000 (perceptual JND scale) + border width px
  RADIUS_ABS: 4, RADIUS_PCT: 0.20, PAD_ABS: 6,                // shape tolerances (px / fraction)
  IOU_MIN: 0.50, CTR_X_ABS: 24, CTR_X_PCT: 0.20, CTR_Y_ABS: 18, CTR_Y_PCT: 0.35, WR: [0.65, 1.45],
  BAND_DROP: 0.02, COVERAGE_DROP: 0.005, EDIT_DROP: 0.005,    // no-collateral tolerances
  // rendered-crop confirm (live only): catches kses-strip / settings-vs-render gap
  SSIM_MIN: 0.68, EXACT_MIN: 0.25, CTASCORE_MIN: 0.66, CTASCORE_GAIN: 0.08, CTASCORE_ABS: 0.78,
};
const FORBIDDEN_RX = /<(img|canvas|svg|iframe|style)\b|data:/i;

// ── colour: parse + CIEDE2000 (the faithfulness metric; zero-noise, hash-bound) ──────────────────────────────
export function parseColor(s) {
  if (!s) return null;
  s = String(s).trim();
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) { const h = m[1]; return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) }; }
  m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) { const h = m[1]; return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }; }
  m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return null;
}
function rgb2lab({ r, g, b }) {
  let [R, G, B] = [r, g, b].map((v) => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; });
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let Y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.0;
  let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
export function deltaE2000(rgbA, rgbB) {
  if (!rgbA || !rgbB) return Infinity;
  const { L: L1, a: a1, b: b1 } = rgb2lab(rgbA);
  const { L: L2, a: a2, b: b2 } = rgb2lab(rgbB);
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hp = (bb, ap) => { let h = Math.atan2(bb, ap) * 180 / Math.PI; if (h < 0) h += 360; return h; };
  const h1p = hp(b1, a1p), h2p = hp(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);
  const Lbarp = (L1 + L2) / 2, Cbarp = (C1p + C2p) / 2;
  let hbarp;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else hbarp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
  const T = 1 - 0.17 * Math.cos(((hbarp - 30) * Math.PI) / 180) + 0.24 * Math.cos((2 * hbarp * Math.PI) / 180)
    + 0.32 * Math.cos(((3 * hbarp + 6) * Math.PI) / 180) - 0.20 * Math.cos(((4 * hbarp - 63) * Math.PI) / 180);
  const dtheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbarp, 7) / (Math.pow(Cbarp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const Sc = 1 + 0.045 * Cbarp, Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin((2 * dtheta * Math.PI) / 180) * Rc;
  return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh));
}

// ── inline-style parsing ─────────────────────────────────────────────────────────────────────────────────────
export function parseInlineAnchor(editorHtml) {
  const html = String(editorHtml || '');
  const anchorCount = (html.match(/<a\b/gi) || []).length;
  const hrefM = html.match(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"/i);
  const styleM = html.match(/<a\b[^>]*\bstyle\s*=\s*"([^"]*)"/i);
  const style = {};
  if (styleM) for (const decl of styleM[1].split(';')) {
    const i = decl.indexOf(':'); if (i < 0) continue;
    const k = decl.slice(0, i).trim().toLowerCase(); const v = decl.slice(i + 1).trim();
    if (k) style[k] = v;
  }
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { anchorCount, href: hrefM ? hrefM[1] : null, style, text, hasForbidden: FORBIDDEN_RX.test(html) };
}
const norm = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
function parsePadding(v) {
  if (!v) return null;
  const ps = String(v).trim().split(/\s+/).map((x) => parseFloat(x) || 0);
  if (ps.length === 1) return [ps[0], ps[0], ps[0], ps[0]];
  if (ps.length === 2) return [ps[0], ps[1], ps[0], ps[1]];
  if (ps.length === 3) return [ps[0], ps[1], ps[2], ps[1]];
  return [ps[0], ps[1], ps[2], ps[3]];
}
function parseBorder(v) {
  if (!v) return null;
  const w = (String(v).match(/(-?\d+(?:\.\d+)?)px/) || [])[1];
  const c = (String(v).match(/rgba?\([^)]*\)|#[0-9a-f]{3,6}/i) || [])[0];
  return { w: w != null ? +w : null, color: c || null };
}

// ── geometry ─────────────────────────────────────────────────────────────────────────────────────────────────
export function iou(a, b) {
  if (!a || !b) return 0;
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}
const centerDist = (a, b) => ({ dx: Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)), dy: Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) });

export function geometryOk(srcBox, cloneBox, T = ACCEPT) {
  if (!srcBox || !cloneBox) return { ok: false, why: 'missing box', iou: 0 };
  const i = iou(srcBox, cloneBox);
  if (i >= T.IOU_MIN) return { ok: true, iou: +i.toFixed(3) };
  const { dx, dy } = centerDist(srcBox, cloneBox);
  const wr = cloneBox.w / (srcBox.w || 1), hr = cloneBox.h / (srcBox.h || 1);
  const ctrOk = dx <= Math.max(T.CTR_X_ABS, T.CTR_X_PCT * srcBox.w) && dy <= Math.max(T.CTR_Y_ABS, T.CTR_Y_PCT * srcBox.h);
  const ratioOk = wr >= T.WR[0] && wr <= T.WR[1] && hr >= T.WR[0] && hr <= T.WR[1];
  return { ok: ctrOk && ratioOk, iou: +i.toFixed(3), dx: +dx.toFixed(1), dy: +dy.toFixed(1), wr: +wr.toFixed(2), hr: +hr.toFixed(2) };
}

// ── editability cheat-guard (HARD gate): the fix must stay an editable text-editor <a>, no raster/blob ─────────
export function editabilityOk(widget, srcText) {
  const fails = [];
  if (!widget) return { ok: false, fails: ['widget missing'] };
  if (widget.widgetType !== 'text-editor') fails.push(`widgetType=${widget.widgetType}`);
  const a = parseInlineAnchor(widget.settings && widget.settings.editor);
  if (a.anchorCount !== 1) fails.push(`anchorCount=${a.anchorCount}`);
  if (a.hasForbidden) fails.push('forbidden-embed');
  if (srcText != null && norm(a.text) !== norm(srcText)) fails.push(`text "${a.text}" != "${srcText}"`);
  return { ok: fails.length === 0, fails };
}

// ── paint faithfulness (PRIMARY deterministic gate): patched widget's actual paint vs source intent ───────────
export function paintFaithfulOk(srcLeaf, patchedWidget, T = ACCEPT) {
  const fails = [];
  const a = parseInlineAnchor(patchedWidget.settings && patchedWidget.settings.editor);
  const st = a.style;
  // text colour (DEINLINE: lives on the native text_color setting, not inline)
  const srcText = parseColor(ctaTextColor(srcLeaf));
  const gotText = parseColor(patchedWidget.settings && patchedWidget.settings.text_color);
  if (srcText) { const de = deltaE2000(srcText, gotText); if (de > T.TEXT_DE) fails.push(`textΔE=${de.toFixed(1)}`); }
  // solid bg
  if (srcLeaf.bg && /^(#|rgb)/.test(srcLeaf.bg) && srcLeaf.bg !== 'rgba(0, 0, 0, 0)') {
    const de = deltaE2000(parseColor(srcLeaf.bg), parseColor(st['background-color']));
    if (de > T.BG_DE) fails.push(`bgΔE=${de === Infinity ? 'missing' : de.toFixed(1)}`);
  }
  // gradient/image fill — presence match (ΔE on gradients is ill-defined)
  const srcGrad = srcLeaf.bgImage && /gradient|url\(/.test(srcLeaf.bgImage);
  if (srcGrad && !(st['background-image'] && /gradient|url\(/.test(st['background-image']))) fails.push('bgImage missing');
  // border colour + width
  if (srcLeaf.border && /^\d/.test(String(srcLeaf.border)) && !/^0px/.test(String(srcLeaf.border))) {
    const s = parseBorder(srcLeaf.border), g = parseBorder(st.border);
    if (!g) fails.push('border missing');
    else {
      if (s.color && deltaE2000(parseColor(s.color), parseColor(g.color)) > T.BORDER_DE) fails.push('borderΔE');
      if (s.w != null && g.w != null && Math.abs(s.w - g.w) > T.BORDER_W) fails.push('borderW');
    }
  }
  // radius
  const srcRad = parseFloat(srcLeaf.radius) || 0;
  if (srcRad > 0) { const gotRad = parseFloat(st['border-radius']) || 0; if (Math.abs(gotRad - srcRad) > Math.max(T.RADIUS_ABS, T.RADIUS_PCT * srcRad)) fails.push(`radius ${gotRad}!=${srcRad}`); }
  // padding (per side)
  const sp = parsePadding(Array.isArray(srcLeaf.btnPad) ? srcLeaf.btnPad.join(' ') : srcLeaf.btnPad);
  if (sp) { const gp = parsePadding(st.padding) || [0, 0, 0, 0]; if (sp.some((v, i) => Math.abs(v - gp[i]) > T.PAD_ABS)) fails.push('padding'); }
  // shadow presence
  if (srcLeaf.boxShadow && !(st['box-shadow'])) fails.push('shadow missing');
  return { ok: fails.length === 0, fails };
}

// ── no-collateral: the patch must not regress any other band / coverage / editability ────────────────────────
export function collateralOk(before, after, target, T = ACCEPT) {
  const fails = [];
  const bb = before.bands || [], ab = after.bands || [];
  for (let i = 0; i < Math.min(bb.length, ab.length); i++) {
    if (i === target.bandIndex) continue;                          // the CTA's own band is allowed to change
    if (ab[i] < bb[i] - T.BAND_DROP) fails.push(`band${i} ${ab[i].toFixed(2)}<${bb[i].toFixed(2)}`);
  }
  if (after.textCoverage < before.textCoverage - T.COVERAGE_DROP) fails.push('textCoverage dropped');
  if (after.editability < before.editability - T.EDIT_DROP) fails.push('editability dropped');
  return { ok: fails.length === 0, fails };
}

// ── the accept predicate (trigger != acceptor; deterministic; crop optional/live) ────────────────────────────
export function acceptCTA({ srcLeaf, patchedWidget, srcBox, cloneBox, before, after, target, crop } = {}, T = ACCEPT) {
  const edit = editabilityOk(patchedWidget, srcLeaf.text);
  const paint = paintFaithfulOk(srcLeaf, patchedWidget, T);
  const geom = geometryOk(srcBox, cloneBox, T);
  const collat = (before && after && target) ? collateralOk(before, after, target, T) : { ok: true, fails: [] };
  let cropOk = true, cropWhy = 'skipped(offline)';
  if (crop) {
    const ctaScore = 0.5 * crop.ssim + 0.5 * crop.exact;
    cropOk = crop.ssim >= T.SSIM_MIN && crop.exact >= T.EXACT_MIN && ctaScore >= T.CTASCORE_MIN
      && (ctaScore - (crop.pre ?? 0) >= T.CTASCORE_GAIN || ctaScore >= T.CTASCORE_ABS);
    cropWhy = `ssim=${crop.ssim.toFixed(2)} exact=${crop.exact.toFixed(2)} cta=${ctaScore.toFixed(2)}`;
  }
  const ok = edit.ok && paint.ok && geom.ok && collat.ok && cropOk;
  const why = ok ? 'accept' : [
    !edit.ok && `editability[${edit.fails.join(',')}]`,
    !paint.ok && `paint[${paint.fails.join(',')}]`,
    !geom.ok && `geometry[iou=${geom.iou}]`,
    !collat.ok && `collateral[${collat.fails.join(',')}]`,
    !cropOk && `crop[${cropWhy}]`,
  ].filter(Boolean).join(' ');
  return { ok, why, evidence: { editability: edit, paint, geometry: geom, collateral: collat, crop: cropWhy } };
}

// ── Task-2 sidecar (§6 null-paint mitigation): the builder calls this AFTER applyAncestorChrome() has mutated
// leaf paint in place, and writes the result to /tmp/joist-ctapaint-{pageId}.json. The heal loop then reads the
// POST-PROPAGATION paint (not a stale re-read where ancestor chrome looks null), and FAILS LOUD on any CTA whose
// resolved paint is null. Pure here (takes the button leaves + buttonPaint); the build call-site is wired on
// WP-return so a real build confirms applyAncestorChrome genuinely yields the null case. Schema is locked + tested.
export function buildCtaPaintLedger(buttonLeaves) {
  const ctas = (buttonLeaves || []).map((n) => {
    const paint = buttonPaint(n);
    return {
      text: (n.text || '').slice(0, 60), href: n.href || null, box: n.box || null,
      paint, textColor: ctaTextColor(n), nullPaint: paint == null,
      styledSource: !!(n.bg || n.bgImage || n.border || n.boxShadow || (n.interactive && n.interactive.role === 'button') || n.tag === 'button'),
    };
  });
  // a "loud" null is a leaf the SOURCE styled (styledSource) that nonetheless resolved to null paint — the §6 trap.
  const loudNulls = ctas.filter((c) => c.nullPaint && c.styledSource);
  return { ctas, nullPaintCount: ctas.filter((c) => c.nullPaint).length, loudNulls };
}

// ── trigger: read the unstyled-CTA veto off the grade report (value-free; never sees a colour) ───────────────
export function triggerFired(report) {
  const fired = report && report.honesty && report.honesty.vetoes && report.honesty.vetoes.fired;
  return Array.isArray(fired) && fired.some((v) => v.veto === 'unstyled-CTA');
}

// ── localize: which clone text-editor widget is each source CTA? refuse-on-ambiguity (the §6 risk guard) ──────
// cloneWidgets: [{ id, widgetType, settings:{editor}, box:{x,y,w,h} }]  (box from _offset_x/_offset_y in live mode)
// srcCTAs: [{ text, box, leaf }]  (leaf = the captured button leaf; box = its source rect)
export function localizeCTAs(cloneWidgets, srcCTAs, opts = {}) {
  const BBOX_MATCH = opts.bboxMatch ?? 140;                         // center-dist (px) within which a candidate "matches"
  const anchorEds = cloneWidgets.filter((w) => w.widgetType === 'text-editor' && /<a\b/i.test((w.settings && w.settings.editor) || ''));
  const matched = [], refused = [], unmatched = [];
  for (const cta of srcCTAs) {
    const byText = anchorEds.filter((w) => norm((w.settings && w.settings.editor)) === norm(cta.text));
    if (byText.length === 0) { unmatched.push({ cta, reason: 'no text match' }); continue; }
    if (byText.length === 1) { matched.push({ cta, widget: byText[0] }); continue; }
    // multiple same-text candidates → disambiguate by bbox; refuse if >=2 are within the bbox threshold
    const within = byText
      .map((w) => ({ w, d: w.box && cta.box ? Math.hypot(...Object.values(centerDist(w.box, cta.box))) : Infinity }))
      .sort((a, b) => a.d - b.d);
    if (within.filter((c) => c.d <= BBOX_MATCH).length >= 2) {
      refused.push({ cta, reason: 'ambiguous', candidates: within.map((c) => ({ id: c.w.id, dist: +(+c.d).toFixed(1) })) });
      continue;
    }
    matched.push({ cta, widget: within[0].w, disambiguatedBy: 'bbox', dist: +within[0].d.toFixed(1) });
  }
  return { matched, refused, unmatched };
}

// ── build the surgical re-paint settings from the frozen captured source leaf ────────────────────────────────
export function buildRepaint(srcLeaf, cloneHref) {
  const style = buttonPaint(srcLeaf);                              // null only if leaf is genuinely not button-styled
  if (!style) return null;                                         // caller fails LOUD (the §6 null-paint trap)
  const href = cloneHref || srcLeaf.href || '#';
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const settings = { editor: `<a href="${esc(href)}" style="${style}">${esc(srcLeaf.text)}</a>` };
  const tc = ctaTextColor(srcLeaf); if (tc) settings.text_color = tc;
  return settings;
}

// ── flatten an Elementor tree into widgets carrying a box read from absolute-offset settings (live mode) ──────
export function flattenWidgets(nodes, out = []) {
  for (const n of nodes || []) {
    if (n && n.elType === 'widget') {
      const s = n.settings || {};
      const box = (s._offset_x != null || s._offset_y != null) ? {
        x: +(s._offset_x && s._offset_x.size != null ? s._offset_x.size : s._offset_x) || 0,
        y: +(s._offset_y && s._offset_y.size != null ? s._offset_y.size : s._offset_y) || 0,
        w: +(s._element_custom_width && s._element_custom_width.size != null ? s._element_custom_width.size : 0) || 0,
        h: 0,
      } : null;
      out.push({ id: n.id, widgetType: n.widgetType, settings: s, box });
    }
    if (Array.isArray(n.elements)) flattenWidgets(n.elements, out);
  }
  return out;
}

// ── live orchestrator: GET tree -> localize -> patch -> (re-render+crop) -> accept -> revert-on-reject ────────
// Host-guarded. NOTE: the re-render+crop gate is the Day-2 live confirm; offline tests exercise the gates above.
// renderAndCrop(m) -> { ssim, exact, pre, cloneBox } : the rendered crop AND the measured clone bbox (the offset
// box from flattenWidgets has no height, so acceptance geometry uses the rendered cloneBox when available).
// fetchImpl / resolveBaseImpl are injectable so the whole control flow (CAS retry, revert-on-reject, null-paint,
// refuse) is testable OFFLINE with no WordPress (see _cta-heal-selftest.mjs orchestrator section).
export async function healUnstyledCTA({ pageId, base, b64, srcCTAs, renderAndCrop = null, log = () => {}, fetchImpl, resolveBaseImpl } = {}) {
  const resolveBase = resolveBaseImpl || (await import('../../sandbox/host-guard.mjs')).resolveBase;
  const _fetch = fetchImpl || fetch;
  const safeBase = resolveBase((base || process.env.JOIST_BASE || 'http://localhost:8001').replace(/\/$/, ''));
  const headers = { Authorization: 'Basic ' + b64, 'Content-Type': 'application/json', 'X-Joist-Session-Id': 'cta-heal-' + pageId };
  const g = await _fetch(`${safeBase}/wp-json/joist/v1/pages/${pageId}?include=elements`, { headers });
  if (!g.ok) throw new Error(`GET tree ${g.status}`);
  const payload = await g.json();
  const tree = (payload.elementor && payload.elementor.elements) || [];
  let expected = payload.elementor && payload.elementor.hash;
  const widgets = flattenWidgets(tree);
  const { matched, refused, unmatched } = localizeCTAs(widgets, srcCTAs);
  const results = { healed: [], rejected: [], refused, unmatched, nullPaint: [] };

  for (const m of matched) {
    const prior = { editor: m.widget.settings.editor, text_color: m.widget.settings.text_color };
    const repaint = buildRepaint(m.cta.leaf, parseInlineAnchor(m.widget.settings.editor).href);
    if (!repaint) { results.nullPaint.push({ id: m.widget.id, text: m.cta.text }); log(`NULL-PAINT (fail loud): ${m.cta.text}`); continue; }
    const patch = async (settings) => {
      for (let a = 0; a < 5; a++) {
        const r = await _fetch(`${safeBase}/wp-json/joist/v1/pages/${pageId}/patch`, {
          method: 'POST', headers,
          body: JSON.stringify({ ops: [{ op: 'update_settings', element_id: m.widget.id, settings }], expected_hash: expected, intent: `cta-heal ${m.widget.id}` }),
        });
        const txt = await r.text();
        if (r.status === 409) { try { expected = JSON.parse(txt).details.current_hash; } catch {} await new Promise((res) => setTimeout(res, 250)); continue; }
        if (!r.ok) throw new Error(`PATCH ${r.status} ${txt.slice(0, 160)}`);
        try { expected = JSON.parse(txt).new_hash || expected; } catch {}
        return;
      }
      throw new Error('PATCH exhausted CAS retries');
    };
    await patch(repaint);
    // build a re-read widget reflecting the applied settings for the deterministic gates
    const patchedWidget = { id: m.widget.id, widgetType: 'text-editor', settings: { ...m.widget.settings, ...repaint } };
    const crop = renderAndCrop ? await renderAndCrop(m) : null;
    const cloneBox = (crop && crop.cloneBox) || m.widget.box;   // rendered bbox preferred (offset box has no height)
    const verdict = acceptCTA({ srcLeaf: m.cta.leaf, patchedWidget, srcBox: m.cta.box, cloneBox, crop });
    if (verdict.ok) { results.healed.push({ id: m.widget.id, text: m.cta.text, why: verdict.why }); log(`HEAL accepted: ${m.cta.text}`); }
    else { await patch(prior); results.rejected.push({ id: m.widget.id, text: m.cta.text, why: verdict.why }); log(`HEAL rejected -> reverted: ${m.cta.text} (${verdict.why})`); }
  }
  return results;
}
