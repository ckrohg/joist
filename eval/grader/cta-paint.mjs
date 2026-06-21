// @purpose Shared CTA paint — the single source of truth for turning a captured button leaf
// ({bg,bgImage,border,radius,btnPad,boxShadow,...}) into a kses-safe inline-style string for a
// styled <a> pill. Extracted VERBATIM from build-absolute.mjs buttonPaint() so the builder and the
// self-heal loop (cta-heal.mjs) paint IDENTICALLY — no drift between build-time and heal-time fills.
// Behaviour is byte-identical to the old inline copy; build-absolute imports buttonPaint from here.
//
// Env flags (same names as the builder): BUILD_NO_CTA_PAINT, BUILD_NO_WHITEPILL, ABS_NO_DEINLINE,
// ABS_NO_CHROME_WRAP. DEINLINE defaults ON (color comes from the native text_color control; chrome
// stays inline). textColor is only consulted on the legacy !DEINLINE path and is injected by the
// caller (the builder passes its own; the heal path never needs it since DEINLINE is on).

const NO_CTA_PAINT = process.env.BUILD_NO_CTA_PAINT === '1';
const NO_WHITEPILL = process.env.BUILD_NO_WHITEPILL === '1';
const DEINLINE_DEFAULT = process.env.ABS_NO_DEINLINE !== '1';

export const px = (s) => { const m = String(s || '').match(/(-?\d+(?:\.\d+)?)px/); return m ? +m[1] : null; };

export const _solidBg = (v) => v && /^(#|rgb)/.test(v) && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent';

export const _padCss = (arr) => {
  // arr = [top,right,bottom,left] CSS px strings; keep only if at least one axis is a non-zero px value.
  if (!Array.isArray(arr) || arr.length < 4) return null;
  const p = arr.map((x) => px(x) || 0);
  if (!(p[0] || p[1] || p[2] || p[3])) return null;
  return `${p[0]}px ${p[1]}px ${p[2]}px ${p[3]}px`;
};

// returns an inline-css string (fill/border/radius/padding/shadow) iff the SOURCE styles this leaf as a
// button, else null (caller falls back to the bare-anchor path). Detection is conservative (anti-gaming:
// we never invent a pill on a plain link/prose leaf the source does not actually style).
export function buttonPaint(n, opts = {}) {
  const DEINLINE = opts.DEINLINE != null ? opts.DEINLINE : DEINLINE_DEFAULT;
  const textColor = opts.textColor || (() => null);
  if (NO_CTA_PAINT || !n || n.kind !== 'button') return null;
  const hasSolid = _solidBg(n.bg);
  const hasGrad = n.bgImage && /gradient|url\(/.test(n.bgImage);
  const hasBorder = n.border && /^\d/.test(String(n.border)) && !/^0px/.test(String(n.border));
  const tagSignal = n.tag === 'button' || (n.interactive && n.interactive.role === 'button');
  // WHITE-PILL / SHADOW-ELEVATED path: a transparent-bg, inset-ring/elevation box-shadow pill (e.g. react.dev
  // "Add React to your page") hits none of the fill/border/tag signals. A genuine captured box-shadow (color +
  // px geometry) is the distinguishing signal nav links / prose links do NOT carry.
  const hasShadow = !NO_WHITEPILL && !!n.boxShadow && /(#|rgb)/i.test(String(n.boxShadow)) && /-?\d*\.?\d+px/.test(String(n.boxShadow)) && !/^rgba\(0, 0, 0, 0\)/.test(String(n.boxShadow));
  const padOk = !!_padCss(n.btnPad);                         // genuine non-zero padding (a pill has interior padding)
  const shortText = ((n.text || '').trim().length <= 48);    // CTA/label length, not a prose paragraph
  const shadowPill = hasShadow && padOk && shortText;
  if (!hasSolid && !hasGrad && !hasBorder && !tagSignal && !shadowPill) return null;
  // If the ONLY signal is the tag, do NOT invent a pill — require a genuine paint (fill / border / shadow-pill).
  if (!hasSolid && !hasGrad && !hasBorder && !shadowPill) return null;
  const parts = ['display:inline-block', 'text-decoration:none', 'box-sizing:border-box'];
  if (hasGrad) parts.push(`background-image:${n.bgImage}`);
  if (hasSolid) parts.push(`background-color:${n.bg}`); // solid sits under/with the gradient; both kses-safe
  else if (shadowPill && !hasGrad) parts.push('background-color:#ffffff'); // synthesize white surface for ring pill
  if (hasBorder) parts.push(`border:${n.border}`);
  const rad = px(n.radius); if (rad) parts.push(`border-radius:${rad}px`);
  const pad = _padCss(n.btnPad) || '8px 18px'; parts.push(`padding:${pad}`);
  if (n.boxShadow) parts.push(`box-shadow:${n.boxShadow}`);
  parts.push('text-align:center');
  if (shortText || process.env.ABS_NO_CHROME_WRAP === '1') parts.push('white-space:nowrap');
  // DE-INLINE: anchor COLOR comes from the native text_color control (DEINLINE on). Only the legacy path inlines it.
  if (!DEINLINE) { const c = textColor(n); if (c) parts.push(`color:${c}`); }
  return parts.join(';');
}

// The text color the heal path should write to the native text_color control (chrome stays inline; color native).
export function ctaTextColor(n) {
  if (n && n.paint && n.paint.kind === 'solid' && n.paint.value) return n.paint.value;
  return null;
}
