// @purpose FROZEN verbatim copy of build-absolute.mjs buttonPaint() + its pure deps, as of the extraction into
// cta-paint.mjs (build-absolute lines 28, 771-836). This is the EQUIVALENCE ORACLE for the differential test
// (_cta-paint-equiv.mjs): cta-paint.buttonPaint must produce byte-identical output to THIS over a fixture battery.
// DO NOT "improve" or refactor this file — it must mirror the original exactly. If build-absolute's buttonPaint
// ever changes, update cta-paint.mjs AND re-sync this frozen copy, then re-run the differential test.
//
// Wrapped as a factory so the differential test can exercise both the DEINLINE-on (default) and !DEINLINE
// (ABS_NO_DEINLINE=1) branches, and both env-flag states, without relying on process.env at import time.

export function makeOriginalButtonPaint({ DEINLINE = true, textColor = () => null, NO_CTA_PAINT = false, NO_WHITEPILL = false, NO_CHROME_WRAP = false } = {}) {
  // ---- verbatim: build-absolute.mjs:28 ----
  const px = (s) => { const m = String(s || '').match(/(-?\d+(?:\.\d+)?)px/); return m ? +m[1] : null; };
  // ---- verbatim: build-absolute.mjs:772 ----
  const _solidBg = (v) => v && /^(#|rgb)/.test(v) && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent';
  // ---- verbatim: build-absolute.mjs:773-779 ----
  const _padCss = (arr) => {
    if (!Array.isArray(arr) || arr.length < 4) return null;
    const p = arr.map((x) => px(x) || 0);
    if (!(p[0] || p[1] || p[2] || p[3])) return null;
    return `${p[0]}px ${p[1]}px ${p[2]}px ${p[3]}px`;
  };
  // ---- verbatim: build-absolute.mjs:788-836 (process.env.ABS_NO_CHROME_WRAP swapped to the NO_CHROME_WRAP param) ----
  return function buttonPaint(n) {
    if (NO_CTA_PAINT || n.kind !== 'button') return null;
    const hasSolid = _solidBg(n.bg);
    const hasGrad = n.bgImage && /gradient|url\(/.test(n.bgImage);
    const hasBorder = n.border && /^\d/.test(String(n.border)) && !/^0px/.test(String(n.border));
    const tagSignal = n.tag === 'button' || (n.interactive && n.interactive.role === 'button');
    const hasShadow = !NO_WHITEPILL && !!n.boxShadow && /(#|rgb)/i.test(String(n.boxShadow)) && /-?\d*\.?\d+px/.test(String(n.boxShadow)) && !/^rgba\(0, 0, 0, 0\)/.test(String(n.boxShadow));
    const padOk = !!_padCss(n.btnPad);
    const shortText = ((n.text || '').trim().length <= 48);
    const shadowPill = hasShadow && padOk && shortText;
    if (!hasSolid && !hasGrad && !hasBorder && !tagSignal && !shadowPill) return null;
    if (!hasSolid && !hasGrad && !hasBorder && !shadowPill) return null;
    const parts = ['display:inline-block', 'text-decoration:none', 'box-sizing:border-box'];
    if (hasGrad) parts.push(`background-image:${n.bgImage}`);
    if (hasSolid) parts.push(`background-color:${n.bg}`);
    else if (shadowPill && !hasGrad) parts.push('background-color:#ffffff');
    if (hasBorder) parts.push(`border:${n.border}`);
    const rad = px(n.radius); if (rad) parts.push(`border-radius:${rad}px`);
    const pad = _padCss(n.btnPad) || '8px 18px'; parts.push(`padding:${pad}`);
    if (n.boxShadow) parts.push(`box-shadow:${n.boxShadow}`);
    parts.push('text-align:center');
    if (shortText || NO_CHROME_WRAP) parts.push('white-space:nowrap');
    if (!DEINLINE) { const c = textColor(n); if (c) parts.push(`color:${c}`); }
    return parts.join(';');
  };
}

// ---- verbatim: build-absolute.mjs:676-699 (the !DEINLINE-branch color source; faithful copy for the oracle) ----
export function originalTextColor(n) {
  if (!n.paint) return null;
  if (n.paint.kind === 'gradient-text') {
    if (process.env.BUILD_NO_GRADIENT_HEADING) return null;
    if (n.paint.color && /^(#|rgb)/.test(n.paint.color)) return n.paint.color;
    const stop = String(n.paint.value || '').match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/);
    return stop ? stop[0] : null;
  }
  return (n.paint.value && /^(#|rgb)/.test(n.paint.value)) ? n.paint.value : null;
}
